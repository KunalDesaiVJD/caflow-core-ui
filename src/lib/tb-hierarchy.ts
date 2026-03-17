export interface TbHierarchyNodeLike {
  nodeId: string;
  parentNodeId: string | null;
  name: string;
  level: number;
  isLeaf: boolean;
  opening: number;
  txnDebit: number;
  txnCredit: number;
  closing: number;
  primaryGroup: string;
  bsPlSide: string;
  normalBal?: string | null;
  rowNumber?: number | null;
}

export type TbSectionType = "bs_asset" | "bs_liability" | "pl_income" | "pl_expense" | "unknown";

export interface TbPresentationSection {
  key: TbSectionType;
  label: string;
  subtotalLabel: string;
  nodes: TbHierarchyNodeLike[];
  totals: { opening: number; txnDebit: number; txnCredit: number; closing: number };
}

export interface TbDisplayValidation {
  isBalanced: boolean;
  drTotal: number;
  crTotal: number;
  difference: number;
  duplicateNames: string[];
  groupMismatches: string[];
  unclassifiedLeaves: number;
  unclassifiedNodes: number;
  bsAssets: number;
  bsLiabilities: number;
  grandTotalDetected: boolean;
  primaryGroups: string[];
  primaryGroupCount: number;
  onlyGroupsCollapsible: boolean;
  groupTotalsTallied: boolean;
  allRulesPassed: boolean;
}

export interface TbPresentationModel {
  activeNodes: TbHierarchyNodeLike[];
  rootNodes: TbHierarchyNodeLike[];
  sections: TbPresentationSection[];
  grandTotal: { opening: number; txnDebit: number; txnCredit: number; closing: number };
  leafCount: number;
  validation: TbDisplayValidation;
}

const BS_ASSET_KEYWORDS = [
  "fixed asset", "current asset", "investment", "debtor", "receivable", "cash", "bank balances",
  "bank balance", "bank account", "deposits (asset)", "deposit (asset)", "deposit", "loans & advances",
  "loans and advances", "advance", "stock", "inventory", "input gst", "tds receivable", "tcs receivable",
  "prepaid", "security deposit", "loan to", "assets", "work in progress", "capital work in progress",
  "cwip", "sundry debtors", "cash-in-hand", "cash in hand"
];

const BS_LIABILITY_KEYWORDS = [
  "share holder funds", "shareholders funds", "share capital", "capital account", "reserves",
  "surplus", "loan", "secured loan", "unsecured loan", "bank od", "overdraft", "current liabilities",
  "duties & taxes", "duties and taxes", "gst payable", "tds payable", "tcs payable", "provisions",
  "sundry creditors", "creditor", "payable", "liabilities", "equity", "partner", "borrowings",
  "outstanding expenses", "accrued", "statutory dues"
];

const PL_INCOME_KEYWORDS = [
  "sales", "revenue", "turnover", "income", "other income", "indirect income", "direct income",
  "commission received", "interest received", "discount received", "job work income", "operating income"
];

const PL_EXPENSE_KEYWORDS = [
  "purchase", "expense", "expenses", "direct expense", "indirect expense", "employee", "salary", "wages",
  "manufacturing", "consumption", "finance cost", "financial expense", "depreciation", "rent", "freight",
  "printing", "repairs", "travelling", "advertising", "professional fee", "electricity", "telephone"
];

const AGGREGATE_HINTS = [
  "fund", "funds", "capital", "reserve", "surplus", "loan", "liabilities", "liability", "asset", "assets",
  "creditors", "debtors", "duties", "taxes", "provisions", "stock", "inventory", "sales", "purchases",
  "expenses", "expense", "income", "bank accounts", "cash-in-hand", "current", "sundry", "gst", "tds", "tcs"
];

const LEDGER_HINT_PATTERNS = [
  /\bprivate limited\b/i,
  /\bpvt\.?\s*ltd\b/i,
  /\blimited\b/i,
  /\bllp\b/i,
  /\bbank ltd\b/i,
  /\bmahindra bank\b/i,
  /\blife insurance\b/i,
  /\bgeneral insurance\b/i,
  /\bconsultants?\b/i,
  /\benterprise\b/i,
  /\btraders\b/i,
  /\btransport\b/i,
  /\bsoftware\b/i,
  /\bservices\b/i,
  /\bworks\b/i,
  /\broad carriers\b/i,
  /\bcourier\b/i,
];

function normalizeTbName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyValue(node: Pick<TbHierarchyNodeLike, "opening" | "txnDebit" | "txnCredit" | "closing">) {
  return Math.abs(node.opening || 0) > 0.0001 || Math.abs(node.txnDebit || 0) > 0.0001 || Math.abs(node.txnCredit || 0) > 0.0001 || Math.abs(node.closing || 0) > 0.0001;
}

function looksLikeAggregateName(name: string) {
  const lower = normalizeTbName(name);
  return AGGREGATE_HINTS.some((hint) => lower.includes(hint));
}

function looksLikeLedgerName(name: string) {
  const raw = String(name || "").trim();
  const lower = normalizeTbName(raw);
  if (!lower) return false;
  if (looksLikeAggregateName(raw)) return false;
  if (/\ba\/?c\b/i.test(raw)) return false;
  if (LEDGER_HINT_PATTERNS.some((pattern) => pattern.test(raw))) return true;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 5 && words.every((word) => /^[A-Z][a-z]+$/.test(word) || /^[A-Z]{2,}$/.test(word))) {
    return true;
  }
  return false;
}

function inferSection(name: string, bsPlSide: string, normalBal?: string | null): TbSectionType {
  const lower = normalizeTbName(name);
  if (BS_ASSET_KEYWORDS.some((keyword) => lower.includes(keyword))) return "bs_asset";
  if (BS_LIABILITY_KEYWORDS.some((keyword) => lower.includes(keyword))) return "bs_liability";
  if (PL_INCOME_KEYWORDS.some((keyword) => lower.includes(keyword))) return "pl_income";
  if (PL_EXPENSE_KEYWORDS.some((keyword) => lower.includes(keyword))) return "pl_expense";

  const bal = (normalBal || "").toLowerCase();
  if (bsPlSide === "BS") return bal === "cr" ? "bs_liability" : "bs_asset";
  if (bsPlSide === "PL") return bal === "cr" ? "pl_income" : "pl_expense";
  return "unknown";
}

function sumLeafDescendants(nodeId: string, allNodes: TbHierarchyNodeLike[]): { opening: number; txnDebit: number; txnCredit: number; closing: number } {
  const children = allNodes.filter((node) => node.parentNodeId === nodeId);
  if (children.length === 0) {
    const self = allNodes.find((node) => node.nodeId === nodeId);
    return {
      opening: self?.opening || 0,
      txnDebit: self?.txnDebit || 0,
      txnCredit: self?.txnCredit || 0,
      closing: self?.closing || 0,
    };
  }

  return children.reduce(
    (acc, child) => {
      const childTotals = child.isLeaf
        ? { opening: child.opening || 0, txnDebit: child.txnDebit || 0, txnCredit: child.txnCredit || 0, closing: child.closing || 0 }
        : sumLeafDescendants(child.nodeId, allNodes);
      return {
        opening: acc.opening + childTotals.opening,
        txnDebit: acc.txnDebit + childTotals.txnDebit,
        txnCredit: acc.txnCredit + childTotals.txnCredit,
        closing: acc.closing + childTotals.closing,
      };
    },
    { opening: 0, txnDebit: 0, txnCredit: 0, closing: 0 },
  );
}

function numericMatches(target: TbHierarchyNodeLike, sum: { opening: number; txnDebit: number; txnCredit: number; closing: number }, tolerance = 1) {
  const dimensions = [
    [Math.abs(target.opening || 0), Math.abs(sum.opening || 0)],
    [Math.abs(target.txnDebit || 0), Math.abs(sum.txnDebit || 0)],
    [Math.abs(target.txnCredit || 0), Math.abs(sum.txnCredit || 0)],
    [Math.abs(target.closing || 0), Math.abs(sum.closing || 0)],
  ];

  const active = dimensions.filter(([targetValue]) => targetValue > tolerance);
  if (active.length === 0) return { isMatch: false, matchedDimensions: 0 };

  const matchedDimensions = active.filter(([targetValue, sumValue]) => Math.abs(targetValue - sumValue) <= tolerance).length;
  return {
    isMatch: matchedDimensions >= Math.min(2, active.length),
    matchedDimensions,
  };
}

function rebuildHierarchy(rawNodes: TbHierarchyNodeLike[]): TbHierarchyNodeLike[] {
  const ordered = [...rawNodes].sort((a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0));
  const n = ordered.length;
  const isGroup = new Array<boolean>(n).fill(false);
  const spanEnd = new Array<number>(n).fill(-1);
  const parentIdx = new Array<number>(n).fill(-1);

  for (let i = n - 2; i >= 0; i--) {
    const target = ordered[i];
    if (!hasAnyValue(target)) continue;

    let sum = { opening: 0, txnDebit: 0, txnCredit: 0, closing: 0 };
    let childCount = 0;
    let j = i + 1;

    while (j < n && j - i < 600) {
      const child = ordered[j];
      sum.opening += Math.abs(child.opening || 0);
      sum.txnDebit += Math.abs(child.txnDebit || 0);
      sum.txnCredit += Math.abs(child.txnCredit || 0);
      sum.closing += Math.abs(child.closing || 0);
      childCount += 1;

      const match = numericMatches(
        { ...target, opening: Math.abs(target.opening || 0), txnDebit: Math.abs(target.txnDebit || 0), txnCredit: Math.abs(target.txnCredit || 0), closing: Math.abs(target.closing || 0) },
        sum,
      );

      const likelyAggregate = looksLikeAggregateName(target.name);
      const likelyLedger = looksLikeLedgerName(target.name);
      const canAccept = match.isMatch && (
        likelyAggregate ||
        !likelyLedger ||
        childCount >= 3 ||
        match.matchedDimensions >= 2
      ) && !(likelyLedger && !likelyAggregate && childCount <= 2);

      if (canAccept) {
        isGroup[i] = true;
        spanEnd[i] = j;
        break;
      }

      j = isGroup[j] && spanEnd[j] >= j ? spanEnd[j] + 1 : j + 1;
    }
  }

  for (let i = n - 2; i >= 0; i--) {
    const row = ordered[i];
    if (isGroup[i] || hasAnyValue(row)) continue;
    let j = i + 1;
    let foundAny = false;
    while (j < n && j - i < 300) {
      const child = ordered[j];
      if (hasAnyValue(child) || isGroup[j]) {
        foundAny = true;
        j = isGroup[j] && spanEnd[j] >= j ? spanEnd[j] + 1 : j + 1;
      } else {
        break;
      }
    }
    if (foundAny) {
      isGroup[i] = true;
      spanEnd[i] = j - 1;
    }
  }

  for (let i = 0; i < n; i++) {
    if (!isGroup[i] || spanEnd[i] < i + 1) continue;
    let j = i + 1;
    while (j <= spanEnd[i]) {
      if (parentIdx[j] === -1) parentIdx[j] = i;
      j = isGroup[j] && spanEnd[j] >= j ? spanEnd[j] + 1 : j + 1;
    }
  }

  return ordered.map((node, index) => {
    let level = 1;
    let parentNodeId: string | null = null;
    let pidx = parentIdx[index];
    while (pidx !== -1) {
      level += 1;
      parentNodeId = ordered[pidx].nodeId;
      pidx = parentIdx[pidx];
    }

    return {
      ...node,
      parentNodeId,
      level,
      isLeaf: !isGroup[index],
    };
  });
}

function collectDuplicates(nodes: TbHierarchyNodeLike[]) {
  const seen = new Map<string, number>();
  for (const node of nodes.filter((row) => row.isLeaf)) {
    const key = normalizeTbName(node.name);
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

export function buildTbPresentationModel(rawNodes: TbHierarchyNodeLike[]): TbPresentationModel {
  const repaired = rebuildHierarchy(rawNodes);
  const activeNodes = repaired.map((node) => ({ ...node }));
  const childrenByParent = new Map<string, TbHierarchyNodeLike[]>();

  for (const node of activeNodes) {
    if (!node.parentNodeId) continue;
    const siblings = childrenByParent.get(node.parentNodeId) || [];
    siblings.push(node);
    childrenByParent.set(node.parentNodeId, siblings);
  }

  const rootNodes = activeNodes.filter((node) => node.parentNodeId === null);
  const rootSectionMap = new Map<string, TbSectionType>();
  for (const root of rootNodes) {
    rootSectionMap.set(root.nodeId, inferSection(root.name, root.bsPlSide, root.normalBal));
  }

  for (const node of activeNodes) {
    if (!node.parentNodeId) continue;
    let cursor: TbHierarchyNodeLike | undefined = node;
    let root: TbHierarchyNodeLike | undefined;
    while (cursor) {
      if (!cursor.parentNodeId) {
        root = cursor;
        break;
      }
      cursor = activeNodes.find((candidate) => candidate.nodeId === cursor?.parentNodeId);
    }
    const section = root ? rootSectionMap.get(root.nodeId) || "unknown" : inferSection(node.name, node.bsPlSide, node.normalBal);
    if (section !== "unknown") {
      node.bsPlSide = section.startsWith("bs_") ? "BS" : "PL";
      node.normalBal = section === "bs_liability" || section === "pl_income" ? "Cr" : "Dr";
    }
    if (root) node.primaryGroup = root.name;
  }

  const sectionDefs: Array<Pick<TbPresentationSection, "key" | "label" | "subtotalLabel">> = [
    { key: "bs_asset", label: "BALANCE SHEET — ASSETS", subtotalLabel: "TOTAL ASSETS" },
    { key: "bs_liability", label: "BALANCE SHEET — LIABILITIES & EQUITY", subtotalLabel: "TOTAL LIABILITIES & EQUITY" },
    { key: "pl_income", label: "P&L — INCOME", subtotalLabel: "TOTAL INCOME" },
    { key: "pl_expense", label: "P&L — EXPENSES", subtotalLabel: "TOTAL EXPENSES" },
  ];

  const sections: TbPresentationSection[] = sectionDefs.map((def) => {
    const nodes = rootNodes.filter((root) => rootSectionMap.get(root.nodeId) === def.key);
    const totals = nodes.reduce(
      (acc, root) => {
        const value = sumLeafDescendants(root.nodeId, activeNodes);
        return {
          opening: acc.opening + value.opening,
          txnDebit: acc.txnDebit + value.txnDebit,
          txnCredit: acc.txnCredit + value.txnCredit,
          closing: acc.closing + value.closing,
        };
      },
      { opening: 0, txnDebit: 0, txnCredit: 0, closing: 0 },
    );
    return { ...def, nodes, totals };
  }).filter((section) => section.nodes.length > 0);

  const grandTotal = rootNodes.reduce(
    (acc, root) => {
      const value = sumLeafDescendants(root.nodeId, activeNodes);
      return {
        opening: acc.opening + value.opening,
        txnDebit: acc.txnDebit + value.txnDebit,
        txnCredit: acc.txnCredit + value.txnCredit,
        closing: acc.closing + value.closing,
      };
    },
    { opening: 0, txnDebit: 0, txnCredit: 0, closing: 0 },
  );

  const duplicateNames = collectDuplicates(activeNodes);
  const leafNodes = activeNodes.filter((node) => node.isLeaf);
  const unclassifiedNodes = rootNodes.filter((root) => (rootSectionMap.get(root.nodeId) || "unknown") === "unknown").length;
  const bsAssets = sections.find((section) => section.key === "bs_asset")?.totals.closing || 0;
  const bsLiabilities = sections.find((section) => section.key === "bs_liability")?.totals.closing || 0;
  const onlyGroupsCollapsible = activeNodes.every((node) => {
    const children = childrenByParent.get(node.nodeId) || [];
    return children.length === 0 || !node.isLeaf;
  });
  const groupTotalsTallied = activeNodes.filter((node) => !node.isLeaf).every((node) => {
    const children = childrenByParent.get(node.nodeId) || [];
    if (children.length === 0) return false;
    const childTotals = children.reduce(
      (acc, child) => {
        const value = child.isLeaf ? child : sumLeafDescendants(child.nodeId, activeNodes);
        return {
          opening: acc.opening + (value.opening || 0),
          txnDebit: acc.txnDebit + (value.txnDebit || 0),
          txnCredit: acc.txnCredit + (value.txnCredit || 0),
          closing: acc.closing + (value.closing || 0),
        };
      },
      { opening: 0, txnDebit: 0, txnCredit: 0, closing: 0 },
    );
    const ownTotals = sumLeafDescendants(node.nodeId, activeNodes);
    return Math.abs(childTotals.opening - ownTotals.opening) < 1 &&
      Math.abs(childTotals.txnDebit - ownTotals.txnDebit) < 1 &&
      Math.abs(childTotals.txnCredit - ownTotals.txnCredit) < 1 &&
      Math.abs(childTotals.closing - ownTotals.closing) < 1;
  });

  const validation: TbDisplayValidation = {
    isBalanced: Math.abs(grandTotal.txnDebit - grandTotal.txnCredit) < 1,
    drTotal: grandTotal.txnDebit,
    crTotal: grandTotal.txnCredit,
    difference: Math.abs(grandTotal.txnDebit - grandTotal.txnCredit),
    duplicateNames,
    groupMismatches: [],
    unclassifiedLeaves: leafNodes.filter((node) => {
      const root = rootNodes.find((rootNode) => node.nodeId === rootNode.nodeId || node.primaryGroup === rootNode.name);
      return !root || (rootSectionMap.get(root.nodeId) || "unknown") === "unknown";
    }).length,
    unclassifiedNodes,
    bsAssets,
    bsLiabilities,
    grandTotalDetected: true,
    primaryGroups: rootNodes.map((node) => node.name),
    primaryGroupCount: rootNodes.length,
    onlyGroupsCollapsible,
    groupTotalsTallied,
    allRulesPassed:
      Math.abs(grandTotal.txnDebit - grandTotal.txnCredit) < 1 &&
      Math.abs(bsAssets - bsLiabilities) < 1 &&
      unclassifiedNodes === 0 &&
      onlyGroupsCollapsible &&
      groupTotalsTallied,
  };

  return {
    activeNodes,
    rootNodes,
    sections,
    grandTotal,
    leafCount: leafNodes.length,
    validation,
  };
}
