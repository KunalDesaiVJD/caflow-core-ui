// ─────────────────────────────────────────────────────────────────────────────
// CAFlow — TB Validation Engine
// N.10 — All validation rules for the imported trial balance.
//
// Usage:
//   const result = runValidation(nodes, { engagementId, importId });
//   result.issues   → TbValidationIssue[]
//   result.summary  → { errorCount, warningCount, infoCount, isBalanced, ... }
//   result.canPublish → true if errorCount === 0
//
// Rules:
//   BAL_001  Balance sheet must balance (Assets = Liabilities + Capital) [error]
//   BAL_002  P&L must balance (Income = Expense + Surplus) within tolerance [warning]
//   HIER_001 Every non-root node must have a valid parent [error]
//   HIER_002 Group node total must approximate sum of children [warning]
//   HIER_003 Circular parent reference detected [error]
//   DUPE_001 Two or more leaves with the same normalized name [warning]
//   SIGN_001 Dr-normal leaf with unexpected positive closing balance (credit) [info]
//   CLAS_001 Leaf with section = "unknown" [warning]
//   CLAS_002 Group with section = "unknown" [info]
//   CONF_001 Expected primary group for constitution type is absent [warning]
// ─────────────────────────────────────────────────────────────────────────────

import type { TbResolvedRow, TbValidationIssue, TbConstitutionType } from "./tb-types";

// ── Context passed to the engine ─────────────────────────────────────────────
export interface TbValidationContext {
  engagementId: string;
  importId: string;
  constitutionType?: TbConstitutionType;
  /** Tolerance for balance check in rupees (default 1) */
  balanceTolerance?: number;
  /** Tolerance for group-sum check as % of group total (default 0.5%) */
  groupSumTolerancePct?: number;
}

// ── Result ────────────────────────────────────────────────────────────────────
export interface TbValidationResult {
  issues: TbValidationIssue[];
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
    isBalanced: boolean;
    bsAssets: number;
    bsLiabilities: number;
    bsDifference: number;
    plIncome: number;
    plExpense: number;
    plSurplus: number;
    totalLeaves: number;
    unknownSectionLeaves: number;
  };
  canPublish: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeIssue(
  engagementId: string,
  importId: string,
  issueCode: string,
  severity: "error" | "warning" | "info",
  message: string,
  affectedNodeIds: string[] = [],
  suggestedFix?: string,
): TbValidationIssue {
  return {
    issueId: `${importId}_${issueCode}_${affectedNodeIds[0] ?? "all"}`,
    importId,
    engagementId,
    issueCode,
    severity,
    message,
    affectedNodeIds,
    suggestedFix,
    createdAt: new Date().toISOString(),
  };
}

function sumSection(nodes: TbResolvedRow[], section: string): number {
  return nodes
    .filter(n => n.isLeaf && n.section === section)
    .reduce((s, n) => s + (n.closing ?? 0), 0);
}

// ── Rule implementations ──────────────────────────────────────────────────────

/** BAL_001 — Balance sheet balance */
function checkBsBalance(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue | null {
  const tol = ctx.balanceTolerance ?? 1;
  const assets = sumSection(nodes, "bs_asset");
  const liabilities = sumSection(nodes, "bs_liability");
  const diff = Math.abs(assets - liabilities);

  if (diff > tol) {
    return makeIssue(
      ctx.engagementId, ctx.importId,
      "BAL_001", "error",
      `Balance sheet does not balance. Assets: ₹${assets.toLocaleString("en-IN", { maximumFractionDigits: 0 })}, ` +
      `Liabilities + Capital: ₹${liabilities.toLocaleString("en-IN", { maximumFractionDigits: 0 })}, ` +
      `Difference: ₹${diff.toLocaleString("en-IN", { maximumFractionDigits: 0 })}.`,
      [],
      "Check for misclassified ledgers (section = 'unknown' or wrong side) and sign errors on Dr-normal accounts with credit balances.",
    );
  }
  return null;
}

/** BAL_002 — P&L balance (informational — surplus goes to BS) */
function checkPlBalance(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue | null {
  const tol = ctx.balanceTolerance ?? 1;
  const income = sumSection(nodes, "pl_income");
  const expense = sumSection(nodes, "pl_expense");
  const surplus = income - expense;

  if (Math.abs(surplus) > 1_000_000 && Math.abs(surplus / Math.max(income, 1)) > 0.5) {
    // Only warn if surplus is >50% of income (likely classification error, not just profit/loss)
    return makeIssue(
      ctx.engagementId, ctx.importId,
      "BAL_002", "warning",
      `P&L surplus (₹${surplus.toLocaleString("en-IN", { maximumFractionDigits: 0 })}) is unusually large. ` +
      `Income: ₹${income.toLocaleString("en-IN", { maximumFractionDigits: 0 })}, ` +
      `Expenses: ₹${expense.toLocaleString("en-IN", { maximumFractionDigits: 0 })}.`,
      [],
      "Verify that all income and expense ledgers are correctly classified. Check for ledgers in 'unknown' section.",
    );
  }
  return null;
}

/** HIER_001 — Orphaned non-root nodes */
function checkOrphanedNodes(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue[] {
  const nodeIds = new Set(nodes.map(n => n.nodeId));
  const issues: TbValidationIssue[] = [];

  for (const node of nodes) {
    if (node.parentNodeId !== null && !nodeIds.has(node.parentNodeId)) {
      issues.push(makeIssue(
        ctx.engagementId, ctx.importId,
        "HIER_001", "error",
        `Node "${node.name}" references a parent node ID "${node.parentNodeId}" that does not exist in this import.`,
        [node.nodeId],
        `Re-run import or manually set the parent for "${node.name}" using the Override panel.`,
      ));
    }
  }
  return issues;
}

/** HIER_002 — Group sum check */
function checkGroupSums(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue[] {
  const tolPct = ctx.groupSumTolerancePct ?? 0.5;
  const issues: TbValidationIssue[] = [];
  const childrenByParent = new Map<string, TbResolvedRow[]>();

  for (const node of nodes) {
    if (node.parentNodeId) {
      const arr = childrenByParent.get(node.parentNodeId) ?? [];
      arr.push(node);
      childrenByParent.set(node.parentNodeId, arr);
    }
  }

  const groupNodes = nodes.filter(n => !n.isLeaf && childrenByParent.has(n.nodeId));

  for (const group of groupNodes) {
    const children = childrenByParent.get(group.nodeId) ?? [];
    const childSum = children.reduce((s, c) => s + (c.closing ?? 0), 0);
    const groupVal = group.closing ?? 0;
    const tol = Math.max(1, Math.abs(groupVal) * (tolPct / 100));

    if (Math.abs(groupVal) > 10 && Math.abs(groupVal - childSum) > tol) {
      issues.push(makeIssue(
        ctx.engagementId, ctx.importId,
        "HIER_002", "warning",
        `Group "${group.name}" has closing balance ₹${groupVal.toLocaleString("en-IN", { maximumFractionDigits: 0 })} ` +
        `but its children sum to ₹${childSum.toLocaleString("en-IN", { maximumFractionDigits: 0 })} ` +
        `(difference: ₹${Math.abs(groupVal - childSum).toLocaleString("en-IN", { maximumFractionDigits: 0 })}).`,
        [group.nodeId],
        "This may indicate a hierarchy resolution error. Check if children are correctly assigned to this group.",
      ));
    }
  }
  return issues;
}

/** HIER_003 — Circular parent reference */
function checkCircularRefs(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue[] {
  const parentMap = new Map(nodes.map(n => [n.nodeId, n.parentNodeId]));
  const issues: TbValidationIssue[] = [];

  for (const node of nodes) {
    const visited = new Set<string>();
    let cur: string | null = node.nodeId;
    while (cur !== null) {
      if (visited.has(cur)) {
        issues.push(makeIssue(
          ctx.engagementId, ctx.importId,
          "HIER_003", "error",
          `Circular parent reference detected involving "${node.name}" (nodeId: ${node.nodeId}).`,
          [node.nodeId],
          "Re-import the file. If the issue persists, use the Override panel to manually set the parent.",
        ));
        break;
      }
      visited.add(cur);
      cur = parentMap.get(cur) ?? null;
    }
  }
  return issues;
}

/** DUPE_001 — Duplicate leaf names */
function checkDuplicateNames(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue[] {
  const leaves = nodes.filter(n => n.isLeaf);
  const nameCount = new Map<string, string[]>();

  for (const leaf of leaves) {
    const arr = nameCount.get(leaf.normalizedName) ?? [];
    arr.push(leaf.nodeId);
    nameCount.set(leaf.normalizedName, arr);
  }

  const issues: TbValidationIssue[] = [];
  for (const [normalizedName, ids] of nameCount.entries()) {
    if (ids.length > 1) {
      issues.push(makeIssue(
        ctx.engagementId, ctx.importId,
        "DUPE_001", "warning",
        `${ids.length} leaf nodes share the same normalized name "${normalizedName}". ` +
        `This may cause incorrect balance aggregation.`,
        ids,
        "Check if these are duplicate ledgers or if the same ledger appears under two different groups.",
      ));
    }
  }
  return issues;
}

/** SIGN_001 — Dr-normal leaf with credit balance */
function checkCreditBalances(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue[] {
  const issues: TbValidationIssue[] = [];
  const drLeaves = nodes.filter(n => n.isLeaf && n.normalBal === "Dr");

  for (const leaf of drLeaves) {
    if ((leaf.closing ?? 0) < 0) {
      issues.push(makeIssue(
        ctx.engagementId, ctx.importId,
        "SIGN_001", "info",
        `"${leaf.name}" (section: ${leaf.section}) has a credit balance of ₹${Math.abs(leaf.closing).toLocaleString("en-IN", { maximumFractionDigits: 0 })}. ` +
        `This is shown as a negative value on the ${leaf.section === "bs_asset" ? "asset" : "expense"} side.`,
        [leaf.nodeId],
        "This is normal for Sundry Debtors with advance receipts, bank overdrafts shown in Current Assets, etc. Verify with the client.",
      ));
    }
  }
  return issues;
}

/** CLAS_001 — Leaf with unknown section */
function checkUnknownLeafSection(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue[] {
  const unknowns = nodes.filter(n => n.isLeaf && n.section === "unknown");
  if (unknowns.length === 0) return [];

  return [makeIssue(
    ctx.engagementId, ctx.importId,
    "CLAS_001", "warning",
    `${unknowns.length} leaf ledger(s) could not be classified into BS or P&L sections: ` +
    unknowns.slice(0, 5).map(n => `"${n.name}"`).join(", ") +
    (unknowns.length > 5 ? ` and ${unknowns.length - 5} more.` : "."),
    unknowns.map(n => n.nodeId),
    "Use the Override panel to assign these ledgers to the correct section, or accept the AI suggestions if shown.",
  )];
}

/** CLAS_002 — Group with unknown section */
function checkUnknownGroupSection(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue[] {
  const unknowns = nodes.filter(n => !n.isLeaf && n.section === "unknown");
  if (unknowns.length === 0) return [];

  return [makeIssue(
    ctx.engagementId, ctx.importId,
    "CLAS_002", "info",
    `${unknowns.length} group node(s) have unknown section (section is inherited from parent). ` +
    unknowns.slice(0, 3).map(n => `"${n.name}"`).join(", ") +
    (unknowns.length > 3 ? ` and ${unknowns.length - 3} more.` : "."),
    unknowns.map(n => n.nodeId),
  )];
}

/** CONF_001 — Expected primary groups for constitution type */
const CONSTITUTION_EXPECTED_GROUPS: Record<TbConstitutionType, string[]> = {
  proprietorship: ["capital account"],
  partnership: ["partners capital", "partners current account", "partner capital"],
  llp: ["designated partners capital", "designated partner capital"],
  private_limited: ["share capital", "reserves and surplus", "reserves & surplus"],
  public_limited: ["share capital", "reserves and surplus"],
  huf: ["capital account"],
  trust: ["corpus fund", "income and expenditure", "income & expenditure"],
  jv: ["joint venture capital", "partner capital"],
  unknown: [],
};

function checkConstitutionGroups(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationIssue[] {
  if (!ctx.constitutionType || ctx.constitutionType === "unknown") return [];

  const expected = CONSTITUTION_EXPECTED_GROUPS[ctx.constitutionType];
  if (!expected || expected.length === 0) return [];

  const presentNames = new Set(nodes.map(n =>
    n.normalizedName.toLowerCase()
  ));

  const normalizeKw = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const missing = expected.filter(kw =>
    !Array.from(presentNames).some(name => name.includes(normalizeKw(kw)))
  );

  if (missing.length > 0) {
    return [makeIssue(
      ctx.engagementId, ctx.importId,
      "CONF_001", "warning",
      `For constitution type "${ctx.constitutionType}", expected primary groups were not found: ` +
      missing.map(m => `"${m}"`).join(", ") + `. ` +
      `This may indicate the constitution type is incorrect or Tally group names differ from standard.`,
      [],
      `Verify the constitution type in the client record. If the entity uses non-standard group names, ` +
      `use the Override panel to correct section assignments.`,
    )];
  }
  return [];
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Run all validation rules on a resolved TB hierarchy.
 * Returns issues, summary, and canPublish flag.
 */
export function runValidation(
  nodes: TbResolvedRow[],
  ctx: TbValidationContext,
): TbValidationResult {
  const issues: TbValidationIssue[] = [];

  // Collect issues from all rules
  const bsIssue = checkBsBalance(nodes, ctx);
  if (bsIssue) issues.push(bsIssue);

  const plIssue = checkPlBalance(nodes, ctx);
  if (plIssue) issues.push(plIssue);

  issues.push(...checkOrphanedNodes(nodes, ctx));
  issues.push(...checkGroupSums(nodes, ctx));
  issues.push(...checkCircularRefs(nodes, ctx));
  issues.push(...checkDuplicateNames(nodes, ctx));
  issues.push(...checkCreditBalances(nodes, ctx));
  issues.push(...checkUnknownLeafSection(nodes, ctx));
  issues.push(...checkUnknownGroupSection(nodes, ctx));
  issues.push(...checkConstitutionGroups(nodes, ctx));

  // Build summary
  const errorCount   = issues.filter(i => i.severity === "error").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;
  const infoCount    = issues.filter(i => i.severity === "info").length;

  const bsAssets      = sumSection(nodes, "bs_asset");
  const bsLiabilities = sumSection(nodes, "bs_liability");
  const plIncome      = sumSection(nodes, "pl_income");
  const plExpense     = sumSection(nodes, "pl_expense");
  const tol           = ctx.balanceTolerance ?? 1;

  return {
    issues,
    summary: {
      errorCount,
      warningCount,
      infoCount,
      isBalanced: Math.abs(bsAssets - bsLiabilities) <= tol,
      bsAssets,
      bsLiabilities,
      bsDifference: bsAssets - bsLiabilities,
      plIncome,
      plExpense,
      plSurplus: plIncome - plExpense,
      totalLeaves: nodes.filter(n => n.isLeaf).length,
      unknownSectionLeaves: nodes.filter(n => n.isLeaf && n.section === "unknown").length,
    },
    canPublish: errorCount === 0,
  };
}
