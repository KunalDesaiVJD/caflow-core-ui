// ─────────────────────────────────────────────────────────────────────────────
// CAFlow — TB Hierarchy Resolver
// N.6/N.7 — Pure function that builds a resolved hierarchy from raw rows.
//
// Two paths:
//   XML path  → uses xmlLevel + xmlIsLeaf (deterministic, no guessing)
//   Excel path → uses bold + indent hints, falls back to sum-match
//
// This module has NO side effects (no DB calls, no UI logic).
// It is used by:
//   - supabase/functions/parse-tally-tb (Deno) — called after storing raw rows
//   - src/components/pipeline/PipelineStage2.tsx (React) — for fresh-import preview
// ─────────────────────────────────────────────────────────────────────────────

import type {
  TbRawRow,
  TbResolvedRow,
  TbHierarchyResolutionResult,
  TbSectionType,
  TbImportSource,
} from "./tb-types";

// ── Normalisation helpers ─────────────────────────────────────────────────────
export function normalizeName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Section inference keywords ────────────────────────────────────────────────
// These are the same keyword lists as the edge function — duplicated here so
// the resolver can run in the browser without calling Supabase.
const BS_GROUPS_CR = [
  "capital account","partners capital","partner capital","proprietor capital",
  "share holder funds","shareholders funds","shareholder funds",
  "equity share capital","share capital",
  "reserves & surplus","reserve & surplus","reserves and surplus",
  "reserve and surplus","capital reserve","general reserve",
  "quasi equity","share application money","directors loan","director loan",
  "designated partners capital","designated partner capital",
  "corpus fund","endowment fund","co-parcener",
  "loans (liability)","loan (liability)","secured loans","unsecured loans",
  "term loan","bank od","overdraft","cash credit","cc account","cc limit",
  "working capital loan","dealer finance",
  "current liabilities","current liability","other current liabilities",
  "sundry creditors","trade payables","trade creditors","creditors",
  "duties & taxes","duties and taxes","gst payable",
  "tds payable","tcs payable","provisions","provision",
  "outstanding expenses","accrued liabilities",
  "deferred tax liability","advance from customers","advance received",
  "statutory dues",
];

const BS_GROUPS_DR = [
  "fixed assets","fixed asset","tangible assets","intangible assets",
  "capital work in progress","cwip",
  "investments","investment","non-current investments",
  "current assets","current asset",
  "sundry debtors","trade debtors","trade receivables","debtors",
  "receivables","cash-in-hand","cash in hand","cash",
  "bank accounts","bank account","bank balances","bank balance",
  "deposits (asset)","deposits asset","security deposit",
  "loans & advances","loans and advances","advance","prepaid",
  "stock in hand","stock-in-hand","inventory",
  "opening stock","closing stock",
  "tds receivable","tcs receivable","gst receivable",
  "input gst","input cgst","input sgst","input igst",
  "miscellaneous expenses","preliminary expenses","deferred tax asset","suspense",
];

const PL_INCOME = [
  "sales accounts","sales account","sales","revenue","turnover",
  "direct incomes","indirect incomes","other income","other incomes",
  "interest received","commission received","discount received",
  "job work income","miscellaneous income","operating income",
  "income and expenditure","income & expenditure",
];

const PL_EXPENSE = [
  "purchase accounts","purchase account","purchases",
  "direct expenses","direct expense",
  "indirect expenses","indirect expense",
  "manufacturing expenses","manufacturing expense",
  "employee benefit expenses","employee benefits","payroll expenses",
  "financial expenses","financial charges","finance costs","finance cost",
  "selling expenses","administrative expenses","general expenses",
  "depreciation","depreciation & amortisation",
  "partner payout","partner remuneration",
  "interest on capital","remuneration to partner","remuneration to partners",
];

export function inferSection(
  name: string,
  primaryGroup: string,
): { section: TbSectionType; normalBal: "Dr" | "Cr" | "Unknown"; bsPlSide: "BS" | "PL" | "Unknown" } {
  const pg = normalizeName(primaryGroup || name);

  if (BS_GROUPS_CR.some(g => pg.includes(normalizeName(g))))
    return { section: "bs_liability", normalBal: "Cr", bsPlSide: "BS" };
  if (BS_GROUPS_DR.some(g => pg.includes(normalizeName(g))))
    return { section: "bs_asset", normalBal: "Dr", bsPlSide: "BS" };
  if (PL_INCOME.some(g => pg.includes(normalizeName(g))))
    return { section: "pl_income", normalBal: "Cr", bsPlSide: "PL" };
  if (PL_EXPENSE.some(g => pg.includes(normalizeName(g))))
    return { section: "pl_expense", normalBal: "Dr", bsPlSide: "PL" };

  // Fall back to name if primaryGroup didn't match
  if (primaryGroup && primaryGroup !== name) {
    const nm = normalizeName(name);
    if (BS_GROUPS_CR.some(g => nm.includes(normalizeName(g))))
      return { section: "bs_liability", normalBal: "Cr", bsPlSide: "BS" };
    if (BS_GROUPS_DR.some(g => nm.includes(normalizeName(g))))
      return { section: "bs_asset", normalBal: "Dr", bsPlSide: "BS" };
    if (PL_INCOME.some(g => nm.includes(normalizeName(g))))
      return { section: "pl_income", normalBal: "Cr", bsPlSide: "PL" };
    if (PL_EXPENSE.some(g => nm.includes(normalizeName(g))))
      return { section: "pl_expense", normalBal: "Dr", bsPlSide: "PL" };
  }

  return { section: "unknown", normalBal: "Unknown", bsPlSide: "Unknown" };
}

// ── Sign correction ───────────────────────────────────────────────────────────
/**
 * Tally XML sign convention for Dr-normal accounts:
 *   Debit balance  → stored NEGATIVE  (e.g. bank with ₹50,000 Dr = -50000)
 *   Credit balance → stored POSITIVE  (e.g. debtor with credit balance = +5000)
 *
 * After correction:
 *   Positive = normal balance (Debit for Dr-normal, Credit for Cr-normal)
 *   Negative = contra balance (credit balance on a Dr-normal account)
 *
 * Detection: if ANY Dr-normal leaf has a negative closing or opening value,
 * the entire import is assumed to use XML sign convention and ALL Dr-normal
 * leaves are fully inverted (not just the negatives).
 */
export function applyXmlSignConvention(
  nodes: Array<{ normalBal: "Dr" | "Cr" | "Unknown"; isLeaf: boolean; opening: number; closing: number; txnDebit: number; txnCredit: number }>,
  source: TbImportSource,
): typeof nodes {
  if (source !== "xml") {
    // Excel path: defensive flip only (strip stray negatives)
    return nodes.map(n => {
      if (n.normalBal !== "Dr") return n;
      return {
        ...n,
        opening: n.opening < 0 ? -n.opening : n.opening,
        closing: n.closing < 0 ? -n.closing : n.closing,
      };
    });
  }

  // XML path: detect convention then apply
  const drLeaves = nodes.filter(n => n.isLeaf && n.normalBal === "Dr");
  const isXmlConvention = drLeaves.some(n => n.closing < 0 || n.opening < 0);

  return nodes.map(n => {
    if (n.normalBal !== "Dr") return n;
    if (isXmlConvention) {
      // Full inversion: negative Dr balance becomes positive, positive Cr balance stays positive (but now negative on display)
      return { ...n, opening: -(n.opening), closing: -(n.closing) };
    }
    // No XML convention detected (rare — e.g. already-corrected data): defensive flip
    return {
      ...n,
      opening: n.opening < 0 ? -n.opening : n.opening,
      closing: n.closing < 0 ? -n.closing : n.closing,
    };
  });
}

// ── Unique ID generator ───────────────────────────────────────────────────────
function makeNodeId(normalizedName: string, rowNumber: number): string {
  return `node_${rowNumber}_${normalizedName.replace(/\s+/g, "_").slice(0, 40)}`;
}

// ── XML path: build tree from explicit level numbers ─────────────────────────
/**
 * Uses DSPACCNAMELEVEL to assign parent–child relationships.
 *
 * Algorithm:
 *   - Maintain a stack of open groups.
 *   - For each row, pop the stack until the top has a level < current level.
 *   - The top of the stack is the parent.
 *   - Push the current row onto the stack if it is a group (not a leaf).
 */
function resolveFromXmlLevels(
  rawRows: TbRawRow[],
): Pick<TbResolvedRow,
  "rowId" | "rowNumber" | "normalizedName" | "name" | "nodeId" | "parentNodeId"
  | "level" | "isLeaf" | "hierarchyPath" | "hierarchyConfidence" | "resolutionStrategy"
  | "opening" | "txnDebit" | "txnCredit" | "closing"
>[] {
  const result: ReturnType<typeof resolveFromXmlLevels> = [];
  // stack holds [nodeId, level, path]
  const stack: Array<{ nodeId: string; level: number; path: string }> = [];

  for (const row of rawRows) {
    const normalizedName = normalizeName(row.rawName);
    const nodeId = makeNodeId(normalizedName, row.rowNumber);
    const level = row.xmlLevel ?? 1;
    const isLeaf = row.xmlIsLeaf ?? false;

    // Pop stack until we find a row with a strictly smaller level
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const hierarchyPath = parent
      ? `${parent.path} > ${row.rawName}`
      : row.rawName;

    result.push({
      rowId: row.rowId,
      rowNumber: row.rowNumber,
      normalizedName,
      name: row.rawName,
      nodeId,
      parentNodeId: parent?.nodeId ?? null,
      level,
      isLeaf,
      hierarchyPath,
      hierarchyConfidence: 1.0, // explicit from XML
      resolutionStrategy: "xml_explicit",
      opening: row.opening,
      txnDebit: row.txnDebit,
      txnCredit: row.txnCredit,
      closing: row.closing,
    });

    // Push onto stack if it is a group (non-leaf)
    if (!isLeaf) {
      stack.push({ nodeId, level, path: hierarchyPath });
    }
  }

  return result;
}

// ── Excel path: sum-match + bold hint heuristic ───────────────────────────────
/**
 * Fallback for Excel imports where no level/leaf hints exist.
 * Uses the existing sum-match algorithm (ported from buildHierarchy in the
 * edge function), augmented with bold-formatting hints.
 */
function resolveFromExcelHints(
  rawRows: TbRawRow[],
): Pick<TbResolvedRow,
  "rowId" | "rowNumber" | "normalizedName" | "name" | "nodeId" | "parentNodeId"
  | "level" | "isLeaf" | "hierarchyPath" | "hierarchyConfidence" | "resolutionStrategy"
  | "opening" | "txnDebit" | "txnCredit" | "closing"
>[] {
  const n = rawRows.length;
  const isGrp = new Array<boolean>(n).fill(false);
  const parentIdx = new Array<number>(n).fill(-1);
  const spanEnd = new Array<number>(n).fill(-1);

  function adaptiveTol(v: number): number {
    const a = Math.abs(v);
    if (a > 100_000_000) return 500;
    if (a > 10_000_000) return 100;
    if (a > 1_000_000) return 50;
    return 2;
  }

  // Step 1: Bold hint — rows marked bold are groups
  for (let i = 0; i < n; i++) {
    if (rawRows[i].excelIsBold === true) {
      isGrp[i] = true;
    }
  }

  // Step 2: Sum-match to determine spans and parentage
  for (let i = n - 2; i >= 0; i--) {
    const t = rawRows[i];
    const tol = adaptiveTol(t.closing || t.opening || t.txnDebit || t.txnCredit);
    const hasVal = Math.abs(t.closing) > tol || t.txnDebit > tol ||
      t.txnCredit > tol || Math.abs(t.opening) > tol;
    if (!hasVal) continue;

    let sCl = 0, sOp = 0, sDr = 0, sCr = 0, cnt = 0;
    let j = i + 1;
    while (j < n && j - i < 600) {
      sCl += rawRows[j].closing; sOp += rawRows[j].opening;
      sDr += rawRows[j].txnDebit; sCr += rawRows[j].txnCredit;
      cnt++;
      const clSignificant = Math.abs(t.closing) > tol;
      const ok = clSignificant
        ? Math.abs(sCl - t.closing) <= tol
        : (
          (t.txnDebit !== 0 && Math.abs(sDr - t.txnDebit) <= tol &&
            t.txnCredit !== 0 && Math.abs(sCr - t.txnCredit) <= tol) ||
          (t.txnDebit !== 0 && Math.abs(sDr - t.txnDebit) <= tol &&
            t.opening !== 0 && Math.abs(sOp - t.opening) <= tol)
        );
      if (ok && cnt >= 1) {
        isGrp[i] = true;
        spanEnd[i] = j;
        let k = i + 1;
        while (k <= j) {
          if (parentIdx[k] === -1) parentIdx[k] = i;
          k = (isGrp[k] && spanEnd[k] >= k) ? spanEnd[k] + 1 : k + 1;
        }
        break;
      }
      j = (isGrp[j] && spanEnd[j] >= j) ? spanEnd[j] + 1 : j + 1;
    }
  }

  // Step 3: Build results with paths and confidence scores
  const nodeIds: string[] = rawRows.map((r, i) =>
    makeNodeId(normalizeName(r.rawName), r.rowNumber)
  );
  const result: ReturnType<typeof resolveFromExcelHints> = [];

  function buildPath(idx: number): string {
    const ancestors: string[] = [];
    let cur = parentIdx[idx];
    while (cur !== -1) {
      ancestors.unshift(rawRows[cur].rawName);
      cur = parentIdx[cur];
    }
    return [...ancestors, rawRows[idx].rawName].join(" > ");
  }

  function computeLevel(idx: number): number {
    let level = 1;
    let cur = parentIdx[idx];
    while (cur !== -1) { level++; cur = parentIdx[cur]; }
    return level;
  }

  for (let i = 0; i < n; i++) {
    const row = rawRows[i];
    const boldHint = row.excelIsBold === true;
    const sumMatched = isGrp[i] && spanEnd[i] >= i;

    // Confidence: bold + sum-match = high; only one = medium; orphan = low
    let confidence = 0.5;
    let strategy: TbResolvedRow["resolutionStrategy"] = "sum_match";

    if (boldHint && sumMatched) { confidence = 0.9; strategy = "excel_bold"; }
    else if (boldHint) { confidence = 0.7; strategy = "excel_bold"; }
    else if (sumMatched) { confidence = 0.7; strategy = "sum_match"; }
    else if (parentIdx[i] !== -1) { confidence = 0.5; strategy = "sum_match"; }
    else { confidence = 0.3; strategy = "orphan_repair"; }

    result.push({
      rowId: row.rowId,
      rowNumber: row.rowNumber,
      normalizedName: normalizeName(row.rawName),
      name: row.rawName,
      nodeId: nodeIds[i],
      parentNodeId: parentIdx[i] !== -1 ? nodeIds[parentIdx[i]] : null,
      level: computeLevel(i),
      isLeaf: !isGrp[i],
      hierarchyPath: buildPath(i),
      hierarchyConfidence: confidence,
      resolutionStrategy: strategy,
      opening: row.opening,
      txnDebit: row.txnDebit,
      txnCredit: row.txnCredit,
      closing: row.closing,
    });
  }

  return result;
}

// ── Primary export ────────────────────────────────────────────────────────────
/**
 * Resolves a flat list of TbRawRow into a hierarchy of TbResolvedRow.
 *
 * Steps:
 *   1. Choose resolution strategy based on importSource
 *   2. Infer section and normalBal for each node
 *   3. Apply sign correction
 *   4. Build confidence summary
 */
export function resolveHierarchy(
  rawRows: TbRawRow[],
  source: TbImportSource,
  overrides: Map<string, { section?: TbSectionType; normalBal?: "Dr" | "Cr"; parentNormalizedName?: string | null; isLeaf?: boolean }> = new Map(),
): TbHierarchyResolutionResult {
  if (rawRows.length === 0) {
    return {
      nodes: [],
      overallConfidence: 0,
      strategyBreakdown: {},
      uncertainNodes: [],
      orphanedNodes: [],
    };
  }

  // Step 1: resolve hierarchy
  const hasXmlHints = rawRows.some(r => r.xmlLevel !== null);
  const partial = hasXmlHints
    ? resolveFromXmlLevels(rawRows)
    : resolveFromExcelHints(rawRows);

  // Step 2: Build a nodeId → primaryGroup map by walking root groups
  // (root groups are nodes with no parent — their name IS the primary group)
  const nodeIdToRoot = new Map<string, string>();
  function findRoot(nodeId: string, nodeMap: Map<string, typeof partial[0]>): string {
    const node = nodeMap.get(nodeId);
    if (!node || node.parentNodeId === null) return node?.name ?? "";
    return findRoot(node.parentNodeId, nodeMap);
  }
  const nodeMap = new Map(partial.map(n => [n.nodeId, n]));
  for (const n of partial) {
    nodeIdToRoot.set(n.nodeId, findRoot(n.nodeId, nodeMap));
  }

  // Step 3: Infer section + normalBal for each node
  const partialWithClass = partial.map(n => {
    const primaryGroup = nodeIdToRoot.get(n.nodeId) ?? n.name;
    const cls = inferSection(n.name, primaryGroup);
    return {
      ...n,
      primaryGroup,
      section: cls.section,
      normalBal: cls.normalBal as "Dr" | "Cr" | "Unknown",
      bsPlSide: cls.bsPlSide as "BS" | "PL" | "Unknown",
    };
  });

  // Step 4: Apply sign correction
  const signCorrected = applyXmlSignConvention(partialWithClass, source);

  // Step 5: Apply manual overrides
  const withOverrides = signCorrected.map(n => {
    const ov = overrides.get(n.normalizedName);
    if (!ov) return n;
    return {
      ...n,
      ...(ov.section !== undefined && { section: ov.section }),
      ...(ov.normalBal !== undefined && { normalBal: ov.normalBal }),
      ...(ov.isLeaf !== undefined && { isLeaf: ov.isLeaf }),
    };
  });

  // Step 6: Build final TbResolvedRow objects
  const now = new Date().toISOString();
  const nodes: TbResolvedRow[] = withOverrides.map(n => ({
    rowId: n.rowId,
    importId: rawRows[0]?.importId ?? "",
    engagementId: rawRows[0]?.engagementId ?? "",
    rowNumber: n.rowNumber,
    normalizedName: n.normalizedName,
    name: n.name,
    nodeId: n.nodeId,
    parentNodeId: n.parentNodeId,
    level: n.level,
    isLeaf: n.isLeaf,
    hierarchyPath: n.hierarchyPath,
    hierarchyConfidence: n.hierarchyConfidence,
    resolutionStrategy: n.resolutionStrategy,
    primaryGroup: n.primaryGroup,
    section: n.section,
    normalBal: n.normalBal,
    bsPlSide: n.bsPlSide,
    opening: n.opening,
    txnDebit: n.txnDebit,
    txnCredit: n.txnCredit,
    closing: n.closing,
    hasOverride: overrides.has(n.normalizedName),
    hasPendingAiSuggestion: false, // set by caller after AI review
    createdAt: now,
  }));

  // Step 7: Build summary
  const strategyBreakdown: Record<string, number> = {};
  const uncertainNodes: string[] = [];
  const orphanedNodes: string[] = [];

  for (const node of nodes) {
    strategyBreakdown[node.resolutionStrategy] =
      (strategyBreakdown[node.resolutionStrategy] ?? 0) + 1;
    if (node.hierarchyConfidence < 0.6) uncertainNodes.push(node.normalizedName);
    if (node.resolutionStrategy === "orphan_repair" && node.parentNodeId === null)
      orphanedNodes.push(node.normalizedName);
  }

  const overallConfidence =
    nodes.length > 0
      ? nodes.reduce((sum, n) => sum + n.hierarchyConfidence, 0) / nodes.length
      : 0;

  return { nodes, overallConfidence, strategyBreakdown, uncertainNodes, orphanedNodes };
}
