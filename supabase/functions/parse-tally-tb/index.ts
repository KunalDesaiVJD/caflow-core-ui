// ─────────────────────────────────────────────────────────────────────────
// CAFlow — parse-tally-tb Edge Function
// Master fix: handles all 12 Tally TB import failure modes
// ─────────────────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type," +
    "x-supabase-client-platform, x-supabase-client-platform-version",
};

// ── FM 9: Expanded BS/PL keyword lists ───────────────────────────────────
const BS_GROUPS_CR = [
  "capital account","partners capital","partner capital","proprietor capital",
  "share holder funds","shareholders funds","shareholder funds",
  "equity share capital","share capital",
  "reserves & surplus","reserve & surplus","reserves and surplus",
  "reserve and surplus","capital reserve","general reserve",
  "quasi equity","share application money","directors loan","director loan",
  "loans (liability)","loan (liability)","secured loans","unsecured loans",
  "term loan","bank od a/c","bank od","overdraft","cash credit",
  "cc account","cc limit","working capital loan",
  "dealer finance","dealer finance facility",
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
  "capital work in progress","capital work-in-progress","cwip",
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
  "miscellaneous expenses","preliminary expenses",
  "deferred tax asset","suspense",
];

const PL_INCOME = [
  "sales accounts","sales account","sales","revenue","turnover",
  "direct incomes","indirect incomes","other income","other incomes",
  "interest received","commission received","discount received",
  "job work income","miscellaneous income","operating income",
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
  "interest on capital","remuneration to partner",
  "remuneration to partners",
];

// FM 7: rows to skip
const SKIP_ROW_NAMES = new Set([
  "grand total","grand  total","grandtotal","total","grand totals"
]);

// ── FM 13: words that indicate a REAL Tally group/sub-group row ─────────
// Keep only terms that appear in Tally's standard group names.
// DO NOT include words that also commonly appear in ledger names
// (e.g. "bank", "cash", "charges", "salary" — these are often ledgers).
const GROUP_NAME_HINTS = [
  "accounts","assets","liabilities","capital",
  "loans","creditors","debtors","stock",
  "sales","purchases","expenses","incomes",
  "investments","provisions","reserves","equity",
  "funds","current assets","current liabilities",
  "fixed assets","indirect","direct","sundry",
  "payables","receivables","duties and taxes",
  "duties & taxes","bank accounts","bank balances","bank od",
  // Standard Tally single-child sub-group names that should never be de-grouped
  "cash-in-hand","cash in hand",
  "deposits","deposit","fixed deposit",
  "deposits (asset)","deposits (assets)",
  "opening stock","closing stock",
  "secured loans","unsecured loans",
  "advances","advance",
];

function looksLikeGroupName(name: string): boolean {
  const lower = normalizeGroup(name);
  return GROUP_NAME_HINTS.some(h => lower.includes(h));
}

// ── FM 14: Read bold style from XLSX cell ─────────────────────────────────
// Tally Excel exports: GROUP/sub-group rows are ALWAYS bold; ledger rows are NOT.
function isRowBold(ws: XLSX.WorkSheet, r: number, c: number): boolean {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || !cell.s) return false;
  const bold = cell.s?.font?.bold;
  return bold === true || bold === 1;
}

// ── Classification ────────────────────────────────────────────────────────
function normalizeGroup(name: string): string {
  return name.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectBsPlSide(primaryGroup: string): string {
  const pg = normalizeGroup(primaryGroup);
  if (BS_GROUPS_CR.some(g => pg.includes(g))) return "BS";
  if (BS_GROUPS_DR.some(g => pg.includes(g))) return "BS";
  if (PL_INCOME.some(g  => pg.includes(g))) return "PL";
  if (PL_EXPENSE.some(g => pg.includes(g))) return "PL";
  if (pg.includes("profit") && pg.includes("loss")) return "BS";
  if (pg.includes("partner") && pg.includes("payout")) return "PL";
  if (pg.includes("partner") && pg.includes("remuneration")) return "PL";
  if (pg.includes("interest") && pg.includes("capital")) return "PL";
  if (pg.includes("deferred") && pg.includes("tax")) return "BS";
  return "Unknown";
}

function detectNormalBal(primaryGroup: string): string {
  const pg = normalizeGroup(primaryGroup);
  if (BS_GROUPS_CR.some(g => pg.includes(g))) return "Cr";
  if (BS_GROUPS_DR.some(g => pg.includes(g))) return "Dr";
  if (PL_EXPENSE.some(g => pg.includes(g))) return "Dr";
  if (PL_INCOME.some(g  => pg.includes(g))) return "Cr";
  if (pg.includes("profit") && pg.includes("loss")) return "Cr";
  if (pg.includes("partner") &&
     (pg.includes("payout") || pg.includes("remuneration"))) return "Dr";
  if (pg.includes("interest") && pg.includes("capital")) return "Dr";
  if (pg.includes("deferred") && pg.includes("tax")) return "Cr";
  return "Unknown";
}

// ── FM 4+5: Number parsing ────────────────────────────────────────────────
function parseNum(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return Object.is(val, -0) ? 0 : val;
  let s = String(val).trim();
  const neg = s.startsWith("(") && s.endsWith(")");
  if (neg) s = s.slice(1, -1);
  s = s
    .replace(/\bDr\b|\bCr\b|\bDebit\b|\bCredit\b/gi, "")
    .replace(/[\u20B9$\u00A3\u20AC]/g, "")
    .replace(/[\s,\u00A0]/g, "")
    .trim();
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  const v = neg ? -Math.abs(n) : n;
  return Object.is(v, -0) ? 0 : v;
}

function parseSignedBalance(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return Object.is(val, -0) ? 0 : val;
  const raw = String(val).trim();
  if (!raw) return 0;
  const hasCr = /(^|\s)cr(\s|$)|credit/i.test(raw);
  const hasDr = /(^|\s)dr(\s|$)|debit/i.test(raw);
  const n = parseNum(raw);
  if (n === 0) return 0;
  if (hasCr && !hasDr) return -Math.abs(n);
  if (hasDr && !hasCr) return  Math.abs(n);
  return n;
}

// ── FM 8: adaptive tolerance ──────────────────────────────────────────────
function adaptiveTol(v: number): number {
  const a = Math.abs(v);
  if (a > 100_000_000) return 500;
  if (a >  10_000_000) return 100;
  if (a >   1_000_000) return  50;
  return 2;
}

// ── FM 1+2+3: Header & column detection ──────────────────────────────────
function findDataStart(ws: XLSX.WorkSheet): number {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:E2");
  for (let r = range.s.r; r <= Math.min(range.s.r + 30, range.e.r); r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell && String(cell.v||"").trim().toLowerCase() === "particulars")
      return r + 3;
  }
  for (let r = 3; r <= 20; r++) {
    const c0 = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const c1 = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    if (c0 && c1 && typeof c1.v === "number"
        && String(c0.v||"").trim().length > 2) return r;
  }
  return 12;
}

interface ColMap { p:number; o:number; d:number; c:number; cl:number; }

function detectCols(ws: XLSX.WorkSheet, dataStart: number): ColMap {
  const m: ColMap = { p:0, o:1, d:2, c:3, cl:4 };
  for (let r = Math.max(0, dataStart-3); r < dataStart; r++) {
    for (let col = 0; col <= 8; col++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
      if (!cell) continue;
      const v = String(cell.v||"").toLowerCase().trim();
      if (v === "debit")                        m.d  = col;
      if (v === "credit")                       m.c  = col;
      if (v.includes("opening")||v==="op.")      m.o  = col;
      if (v.includes("closing")||v==="cl.")      m.cl = col;
    }
  }
  return m;
}

function cellTxt(ws:XLSX.WorkSheet, r:number, c:number): string {
  const cell = ws[XLSX.utils.encode_cell({r,c})];
  return cell ? String(cell.v||"").trim() : "";
}
function cellNum(ws:XLSX.WorkSheet, r:number, c:number): number {
  const cell = ws[XLSX.utils.encode_cell({r,c})];
  return cell ? parseNum(cell.v) : 0;
}

// ── Types ─────────────────────────────────────────────────────────────────
interface TBRow {
  idx: number; rowNum: number; name: string;
  opening: number; txnDebit: number; txnCredit: number; closing: number;
}
interface HierarchyNode {
  nodeId: string; parentNodeId: string|null;
  level: number; name: string; indent: number; bold: boolean; isLeaf: boolean;
  primaryGroup: string; bsPlSide: string; normalBal: string;
  opening: number; txnDebit: number; txnCredit: number; closing: number;
  rowNumber: number;
}

// ── FM 8: Hierarchy detection by value matching ───────────────────────────
// KEY FIX: When accumulating children for a candidate parent row i, if we
// encounter a row j that is already detected as a group, we must SKIP its
// interior children and jump to spanEnd[j]+1.  Without this, a nested group
// like "Current Assets" (value=100) would falsely match at
// "Sundry Debtors(60) + Ledger A(40) = 100" instead of the correct
// "Sundry Debtors(60) + Bank Accounts(40) = 100".
function buildHierarchy(rows: TBRow[]): {
  isGrp: boolean[]; parentIdx: number[];
} {
  const n = rows.length;
  const isGrp    = new Array<boolean>(n).fill(false);
  const parentIdx = new Array<number>(n).fill(-1);
  // spanEnd[i] = last index in the span of group i (i.e., its last descendant)
  const spanEnd  = new Array<number>(n).fill(-1);

  for (let i = n - 2; i >= 0; i--) {
    const t = rows[i];
    const tol = adaptiveTol(
      t.closing || t.opening || t.txnDebit || t.txnCredit
    );
    const hasVal =
      Math.abs(t.closing)  > tol || t.txnDebit  > tol ||
      t.txnCredit > tol || Math.abs(t.opening) > tol;
    if (!hasVal) continue;

    let sCl=0, sOp=0, sDr=0, sCr=0, cnt=0;
    // Use a while loop so we can jump over sub-group interiors
    let j = i + 1;
    while (j < n && j - i < 600) {
      sCl += rows[j].closing;  sOp += rows[j].opening;
      sDr += rows[j].txnDebit; sCr += rows[j].txnCredit;
      cnt++;
      // Prioritise closing-balance match.
      // When the row has a significant closing value (> tolerance), only a
      // closing-balance match qualifies — this prevents false positives caused
      // by coincidental opening-balance equality (e.g. two sibling accounts
      // both with opening=507 would otherwise falsely trigger a group).
      // When closing ≈ 0 (contra / nil-balance accounts), fall back to a
      // two-dimension debit+credit match, which is still tight enough.
      const clSignificant = Math.abs(t.closing) > tol;
      const ok = clSignificant
        ? Math.abs(sCl - t.closing) <= tol
        : (
            (t.txnDebit  !== 0 && Math.abs(sDr - t.txnDebit)  <= tol &&
             t.txnCredit !== 0 && Math.abs(sCr - t.txnCredit) <= tol) ||
            (t.txnDebit  !== 0 && Math.abs(sDr - t.txnDebit)  <= tol &&
             t.opening   !== 0 && Math.abs(sOp - t.opening)   <= tol)
          );
      if (ok && cnt >= 1) {
        isGrp[i] = true;
        spanEnd[i] = j;
        // Assign direct parents — skip over sub-group interiors
        let k = i + 1;
        while (k <= j) {
          if (parentIdx[k] === -1) parentIdx[k] = i;
          // Jump over already-detected group's children
          k = (isGrp[k] && spanEnd[k] >= k) ? spanEnd[k] + 1 : k + 1;
        }
        break;
      }
      // Jump over the interior of an already-detected sub-group so its
      // individual leaf rows are NOT double-counted in the running sum.
      j = (isGrp[j] && spanEnd[j] >= j) ? spanEnd[j] + 1 : j + 1;
    }
  }
  // ── FM 13: Remove spurious single-child groups ──────────────────────────
  // Problem (bottom-to-top order): two sibling leaves A and B with the same
  // value cause A to be falsely detected as B's parent before their real
  // parent (which comes earlier in the file) is processed.
  // Fix: a non-root group whose ONLY direct child is a leaf AND whose value
  // equals that leaf's value AND whose name doesn't look like a real
  // accounting group → de-group it and promote the child to its grandparent.
  for (let i = 0; i < n; i++) {
    if (!isGrp[i]) continue;
    if (parentIdx[i] === -1) continue; // keep root groups intact

    const directChildren: number[] = [];
    for (let k = i + 1; k < n; k++) {
      if (parentIdx[k] === i) directChildren.push(k);
    }
    if (directChildren.length !== 1) continue;

    const k = directChildren[0];
    if (isGrp[k]) continue; // real sub-group — leave it

    const tol = adaptiveTol(rows[i].closing || rows[i].txnDebit || rows[i].txnCredit);
    const sameVal =
      (rows[i].closing   !== 0 && Math.abs(rows[i].closing   - rows[k].closing)   <= tol) ||
      (rows[i].txnDebit  !== 0 && Math.abs(rows[i].txnDebit  - rows[k].txnDebit)  <= tol) ||
      (rows[i].txnCredit !== 0 && Math.abs(rows[i].txnCredit - rows[k].txnCredit) <= tol);

    if (sameVal && !looksLikeGroupName(rows[i].name)) {
      // Promote: make i a leaf and reparent k to i's parent
      isGrp[i]      = false;
      parentIdx[k]  = parentIdx[i];
    }
  }

  return { isGrp, parentIdx };
}

// ── XML parser for Tally XML exports (UTF-16LE) ───────────────────────────
function parseTallyXmlRows(buf: Uint8Array): TBRow[] {
  // Decode: Tally XML is UTF-16LE with BOM 0xFF 0xFE
  let xmlStr: string;
  if (buf[0] === 0xFF && buf[1] === 0xFE) {
    xmlStr = new TextDecoder("utf-16le").decode(buf.slice(2));
  } else if (buf[0] === 0xFE && buf[1] === 0xFF) {
    xmlStr = new TextDecoder("utf-16be").decode(buf.slice(2));
  } else {
    xmlStr = new TextDecoder("utf-8").decode(buf);
  }

  // Unescape XML entities in account names
  const unesc = (s: string) => s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

  // Extract first inner-text of a tag within a block
  const tagVal = (s: string, t: string): string => {
    const re = new RegExp(`<${t}[^>]*>([^<]*)<\\/${t}>`, "i");
    const m  = re.exec(s);
    return m ? m[1].trim() : "";
  };

  const rows: TBRow[] = [];
  // Tally XML alternates <DSPACCNAME>…</DSPACCNAME> <DSPACCINFO>…</DSPACCINFO>
  const pairRe = /<DSPACCNAME>([\s\S]*?)<\/DSPACCNAME>[\s\S]*?<DSPACCINFO>([\s\S]*?)<\/DSPACCINFO>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;

  while ((m = pairRe.exec(xmlStr)) !== null) {
    const name = unesc(tagVal(m[1], "DSPDISPNAME"));
    if (!name) continue;

    const info      = m[2];
    const opening   = parseNum(tagVal(info, "DSPOPAMTA"));
    const debitRaw  = parseNum(tagVal(info, "DSPDRAMTA")); // stored negative in Tally
    const credit    = parseNum(tagVal(info, "DSPCRAMTA"));
    const closing   = parseNum(tagVal(info, "DSPCLAMTA"));

    rows.push({
      idx, rowNum: idx + 1, name,
      opening,
      txnDebit:  Math.abs(debitRaw), // normalise to positive
      txnCredit: credit,
      closing,
    });
    idx++;
  }

  if (rows.length === 0) throw new Error("No data entries found in Tally XML file");
  return rows;
}

// ── JSON parser (flat array or CAFlow hierarchy export) ───────────────────
function parseJsonRows(buf: Uint8Array): TBRow[] {
  const text = new TextDecoder("utf-8").decode(buf);
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("Invalid JSON file"); }

  // Format 1: Array of TB rows
  if (Array.isArray(json)) {
    const rows: TBRow[] = (json as any[])
      .map((item: any, idx: number) => ({
        idx, rowNum: idx + 1,
        name:       String(item.name ?? item.ledger_name ?? item.account ?? item.particulars ?? "").trim(),
        opening:    parseNum(item.opening    ?? item.opening_balance ?? item.op ?? 0),
        txnDebit:   parseNum(item.debit      ?? item.txn_debit       ?? item.dr ?? 0),
        txnCredit:  parseNum(item.credit     ?? item.txn_credit      ?? item.cr ?? 0),
        closing:    parseNum(item.closing    ?? item.closing_balance ?? item.cl ?? 0),
      }))
      .filter((r: TBRow) => r.name);
    if (rows.length === 0) throw new Error("No data entries found in JSON array");
    return rows;
  }

  // Format 2: CAFlow hierarchy export { hierarchy: [...] }
  const obj = json as any;
  if (obj.hierarchy && Array.isArray(obj.hierarchy)) {
    const rows: TBRow[] = (obj.hierarchy as any[])
      .map((item: any, idx: number) => ({
        idx, rowNum: idx + 1,
        name:       String(item.name ?? item.tally_group_name ?? "").trim(),
        opening:    parseNum(item.opening    ?? item.opening_balance ?? 0),
        txnDebit:   parseNum(item.txnDebit   ?? item.txn_debit       ?? 0),
        txnCredit:  parseNum(item.txnCredit  ?? item.txn_credit      ?? 0),
        closing:    parseNum(item.closing    ?? item.closing_balance  ?? 0),
      }))
      .filter((r: TBRow) => r.name);
    if (rows.length === 0) throw new Error("No data entries in JSON hierarchy array");
    return rows;
  }

  throw new Error("Unrecognised JSON format. Expected an array of TB rows or { hierarchy: [...] }.");
}

// ── Shared: build nodes from rawRows (no bold override) ───────────────────
function buildNodesFromRows(
  rawRows: TBRow[],
): { nodes: HierarchyNode[]; isBalanced: boolean; drSum: number; crSum: number } {
  if (rawRows.length === 0) throw new Error("No data rows to process");

  const { isGrp: iGR, parentIdx: pIR } = buildHierarchy(rawRows);
  const iG = [...iGR], pIdx = [...pIR];

  const getPG = (i: number): string => {
    let c = i;
    while (pIdx[c] !== -1) c = pIdx[c];
    return rawRows[c].name;
  };
  const getLvl = (i: number): number => pIdx[i] === -1 ? 1 : getLvl(pIdx[i]) + 1;

  const nodes: HierarchyNode[] = rawRows.map((row, idx) => {
    const pg = getPG(idx), lvl = getLvl(idx);
    return {
      nodeId:       `N${String(idx + 1).padStart(4, "0")}`,
      parentNodeId: pIdx[idx] !== -1 ? `N${String(pIdx[idx] + 1).padStart(4, "0")}` : null,
      level: lvl, name: row.name, indent: Math.max(0, lvl - 1),
      bold: iG[idx], isLeaf: !iG[idx],
      primaryGroup: getPG(idx), bsPlSide: detectBsPlSide(getPG(idx)),
      normalBal: detectNormalBal(getPG(idx)),
      opening: row.opening, txnDebit: row.txnDebit,
      txnCredit: row.txnCredit, closing: row.closing, rowNumber: row.rowNum,
    };
  });

  // P&L post-process
  for (const nd of nodes) {
    const lo = nd.name.toLowerCase();
    if (lo.includes("profit") && lo.includes("loss")) {
      nd.primaryGroup = "Profit & Loss"; nd.bsPlSide = "BS"; nd.normalBal = "Cr";
    }
  }

  const lfs = nodes.filter(n => n.isLeaf);
  let drSum = 0, crSum = 0;
  for (const n of lfs) {
    const s = n.closing !== 0
      ? (n.normalBal === "Cr" ? -Math.abs(n.closing) : Math.abs(n.closing))
      : (n.txnDebit - n.txnCredit);
    if (s >= 0) drSum += s; else crSum += Math.abs(s);
  }

  return { nodes, isBalanced: Math.abs(drSum - crSum) < 5.0, drSum, crSum };
}

// ── Main handler ──────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Accept JSON body with base64-encoded file (matching client-side invoke)
    const body = await req.json();
    const {
      fileBase64,
      chunkBase64,
      chunkIndex,
      totalChunks,
      uploadSessionId,
      isLastChunk,
      fileName,
      engagementId: engId,
      firmId,
      clientId,
      financialYear: financialYr,
    } = body;

    // Handle chunked uploads: store chunks in memory, process on last chunk
    // For simplicity in edge functions (stateless), we only support single-shot uploads
    // The client should reassemble chunks before sending, or send small files directly
    const base64Data = fileBase64 || chunkBase64;
    if (!base64Data) throw new Error("No file data provided (fileBase64 or chunkBase64 required)");

    // If this is a non-final chunk, acknowledge receipt (stateless — client must handle reassembly)
    if (chunkBase64 && !isLastChunk) {
      return new Response(JSON.stringify({ success: true, chunkReceived: chunkIndex }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decode base64 to Uint8Array
    const binaryString = atob(base64Data);
    const buf = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      buf[i] = binaryString.charCodeAt(i);
    }

    // ── XML / JSON early-return path ──────────────────────────────────────
    const fnLower = (fileName || "").toLowerCase();
    if (fnLower.endsWith(".xml") || fnLower.endsWith(".json")) {
      const rawRows = fnLower.endsWith(".xml")
        ? parseTallyXmlRows(buf)
        : parseJsonRows(buf);
      const detFmt = fnLower.endsWith(".xml") ? "Tally XML" : "JSON";
      const fyUsed = financialYr || "Unknown";

      const { nodes, isBalanced, drSum, crSum } = buildNodesFromRows(rawRows);
      const lfs  = nodes.filter(n => n.isLeaf);
      const pgs  = [...new Set(nodes.map(n => n.primaryGroup))];
      const bId  = crypto.randomUUID();

      const res: Record<string, unknown> = {
        success: true, companyName: "Unknown", financialYear: fyUsed,
        detectedFormat: detFmt, dataStartRow: 0,
        isBalanced, balanceDiff: Math.round(Math.abs(drSum - crSum)),
        grandTotalDr: 0, grandTotalCr: 0,
        totalNodes: nodes.length, leafCount: lfs.length, leafLedgers: lfs.length,
        primaryGroups: pgs.length, primaryGroupCount: pgs.length, primaryGroupNames: pgs,
        bsAccounts: nodes.filter(n => n.bsPlSide === "BS").length,
        plAccounts: nodes.filter(n => n.bsPlSide === "PL").length,
        unknownAccounts: nodes.filter(n => n.bsPlSide === "Unknown").length,
        totalDr: Math.round(drSum), totalCr: Math.round(crSum),
        batchId: bId, hierarchy: nodes, tagging: null,
      };

      if (engId || clientId) {
        // Delete old hierarchy nodes then re-insert for correct tree view
        if (engId) {
          // Ensure a batch record exists in ledger_import_batches before inserting
          // tb_hierarchy_nodes (FK constraint requires it)
          await supabase.from("ledger_import_batches").upsert({
            id: bId,
            engagement_id: engId,
            ...(firmId && { firm_id: firmId }),
            original_filename: fnLower,
            import_type: "trial_balance",
            processing_status: "complete",
            status: "complete",
            total_rows: nodes.length,
            leaf_rows: lfs.length,
            processed_rows: nodes.length,
            row_count: nodes.length,
            error_log: [],
            imported_at: new Date().toISOString(),
          }, { onConflict: "id" });

          await supabase.from("tb_hierarchy_nodes").delete().eq("engagement_id", engId);
          const hRows = nodes.map((nd, i) => ({
            engagement_id: engId,
            import_batch_id: bId,
            node_id: nd.nodeId, parent_node_id: nd.parentNodeId,
            tally_group_name: nd.name,
            level: nd.level, is_leaf: nd.isLeaf, is_bold: nd.bold,
            indent_value: nd.indent,
            opening_balance: nd.opening, txn_debit: nd.txnDebit,
            txn_credit: nd.txnCredit, closing_balance: nd.closing,
            primary_group: nd.primaryGroup, bs_pl_side: nd.bsPlSide,
            normal_balance: nd.normalBal, row_number: i + 1,
          }));
          // Insert in batches of 200 to avoid payload limits
          for (let s = 0; s < hRows.length; s += 200) {
            await supabase.from("tb_hierarchy_nodes").insert(hRows.slice(s, s + 200));
          }
        }
        await (supabase.from("trial_balance_snapshots") as any).upsert({
          ...(engId    && { engagement_id: engId }),
          ...(clientId && { client_id: clientId }),
          ...(firmId   && { firm_id: firmId }),
          financial_year: fyUsed, snapshot_data: nodes,
          is_balanced: isBalanced, grand_total_dr: 0, grand_total_cr: 0,
          import_format: detFmt, created_at: new Date().toISOString(),
        });
      }

      return new Response(JSON.stringify(res), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ── End XML/JSON path ─────────────────────────────────────────────────

    // FM 10: detect XLS vs XLSX from magic bytes
    const isXLS =
      buf[0]===0xD0 && buf[1]===0xCF &&
      buf[2]===0x11 && buf[3]===0xE0;

    const wb = XLSX.read(buf, {
      type: "buffer",
      cellStyles: true,
      sheetStubs: true,
    });

    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws || !ws["!ref"]) throw new Error("Empty or invalid worksheet");

    const range = XLSX.utils.decode_range(ws["!ref"]!);

    // FM 1+2+3: locate data
    const dataStart = findDataStart(ws);
    const cols      = detectCols(ws, dataStart);

    // ── Extract company name and FY from header rows ──────────────────────
    let companyName = "";
    let financialYear = financialYr || "";

    for (let r = range.s.r; r < dataStart; r++) {
      const v = cellTxt(ws, r, 0);
      if (!companyName && v.length > 3
          && !v.toLowerCase().includes("trial")
          && !v.toLowerCase().includes("balance")
          && !/^\d{4}/.test(v)) {
        companyName = v;
      }
      if (!financialYear) {
        for (let c = 0; c <= 3; c++) {
          const txt = cellTxt(ws, r, c);
          const m = txt.match(/(\d{4})[-–](\d{2,4})/);
          if (m) {
            const y2 = m[2].length === 4 ? m[2].slice(2) : m[2];
            financialYear = `${m[1]}-${y2}`;
            break;
          }
        }
      }
    }

    // ── Grab Grand Total from last rows (before filtering) ────────────────
    let gtDr = 0, gtCr = 0;
    for (let r = range.e.r; r >= Math.max(range.s.r, range.e.r - 5); r--) {
      const name = cellTxt(ws, r, cols.p).toLowerCase().trim();
      if (SKIP_ROW_NAMES.has(name)) {
        gtDr = cellNum(ws, r, cols.d);
        gtCr = cellNum(ws, r, cols.c);
        break;
      }
    }

    // ── Parse raw data rows ───────────────────────────────────────────────
    const rawRows: TBRow[] = [];
    for (let r = dataStart; r <= range.e.r; r++) {
      const name = cellTxt(ws, r, cols.p);
      if (!name) continue;

      // FM 7: skip Grand Total
      if (SKIP_ROW_NAMES.has(name.toLowerCase().trim())) continue;

      // FM 11: skip empty separator rows
      const trimmed = name.trim();
      if (!trimmed || /^[-–—]+$/.test(trimmed)) continue;

      rawRows.push({
        idx: rawRows.length,
        rowNum: r + 1,
        name,
        opening:   cellNum(ws, r, cols.o),
        txnDebit:  cellNum(ws, r, cols.d),
        txnCredit: cellNum(ws, r, cols.c),
        closing:   cellNum(ws, r, cols.cl),
      });
    }

    if (rawRows.length === 0)
      throw new Error(`No data rows found (dataStart=${dataStart})`);

    // FM 8+11: detect hierarchy
    const { isGrp: isGrpRaw, parentIdx: parentIdxRaw } = buildHierarchy(rawRows);
    const isGrp    = [...isGrpRaw];
    const parentIdx = [...parentIdxRaw];

    // FM 14: Bold-override — authoritative correction using cell styling.
    // In Tally Excel: GROUP rows are BOLD, ledger rows are NOT bold.
    // When bold info is present, any non-bold row detected as a group is a
    // false positive (e.g. "Bank Charge" falsely parenting "GST EXP").
    const boldMap = rawRows.map(row => isRowBold(ws, row.rowNum - 1, cols.p));
    const boldCount = boldMap.filter(Boolean).length;
    // Only apply when we have meaningful bold info (>1 bold, not all rows bold)
    if (boldCount >= 2 && boldCount < rawRows.length * 0.9) {
      const deGrouped = new Set<number>();
      for (let i = 0; i < rawRows.length; i++) {
        if (isGrp[i] && !boldMap[i]) {
          isGrp[i] = false;
          deGrouped.add(i);
        }
      }
      // Re-parent children of de-grouped nodes (walk up chain to nearest real group)
      if (deGrouped.size > 0) {
        for (let k = 0; k < rawRows.length; k++) {
          let p = parentIdx[k];
          while (p !== -1 && deGrouped.has(p)) p = parentIdx[p];
          parentIdx[k] = p;
        }
      }
    }

    // ── Secondary pass: link orphan non-bold leaves to nearest bold parent ──
    // When value-sum matching fails for zero-balance accounts (e.g. inactive
    // Sundry Debtors with closing=0 but non-zero opening), those accounts
    // remain unparented (parentIdx = -1). Since Tally TB exports always place
    // ledger rows immediately after their group header row (bold), we walk
    // backwards from each unparented non-bold leaf to the nearest bold group.
    if (boldCount >= 2 && boldCount < rawRows.length * 0.9) {
      for (let i = 1; i < rawRows.length; i++) {
        if (parentIdx[i] !== -1) continue; // already linked
        if (isGrp[i]) continue;            // skip detected groups
        if (boldMap[i]) continue;          // skip bold rows (group headers)

        // Walk backwards, find the nearest detected bold group
        for (let j = i - 1; j >= 0 && i - j <= 400; j--) {
          if (isGrp[j] && boldMap[j]) {
            parentIdx[i] = j;
            if (spanEnd[j] < i) spanEnd[j] = i;
            break;
          }
        }
      }
    }

    // ── Resolve primary group (topmost ancestor name) ─────────────────────
    function getPrimaryGroup(idx: number): string {
      let cur = idx;
      while (parentIdx[cur] !== -1) cur = parentIdx[cur];
      return rawRows[cur].name;
    }

    // ── Compute indent/level ──────────────────────────────────────────────
    function getLevel(idx: number): number {
      return parentIdx[idx] === -1 ? 1 : getLevel(parentIdx[idx]) + 1;
    }

    // ── Build nodes ───────────────────────────────────────────────────────
    const nodes: HierarchyNode[] = rawRows.map((row, idx) => {
      const pg  = getPrimaryGroup(idx);
      const lvl = getLevel(idx);
      return {
        nodeId:       `N${String(idx+1).padStart(4,"0")}`,
        parentNodeId: parentIdx[idx] !== -1
                        ? `N${String(parentIdx[idx]+1).padStart(4,"0")}`
                        : null,
        level:    lvl,
        name:     row.name,
        indent:   Math.max(0, lvl - 1),
        bold:     isGrp[idx],
        isLeaf:  !isGrp[idx],
        primaryGroup: pg,
        bsPlSide: detectBsPlSide(pg),
        normalBal: detectNormalBal(pg),
        opening:   row.opening,
        txnDebit:  row.txnDebit,
        txnCredit: row.txnCredit,
        closing:   row.closing,
        rowNumber: row.rowNum,
      };
    });

    // FM 12: post-process Profit & Loss A/c row
    for (const node of nodes) {
      const lower = node.name.toLowerCase();
      if (lower.includes("profit") && lower.includes("loss")) {
        node.primaryGroup = "Profit & Loss";
        node.bsPlSide     = "BS";
        node.normalBal    = "Cr";
      }
    }

    // FM 6: balance check with sign-correct values
    const leaves = nodes.filter(n => n.isLeaf);
    let drSum = 0, crSum = 0;
    for (const n of leaves) {
      const signed =
        n.closing !== 0
          ? (n.normalBal === "Cr" ? -Math.abs(n.closing) : Math.abs(n.closing))
          : (n.txnDebit - n.txnCredit);
      if (signed >= 0) drSum += signed;
      else             crSum += Math.abs(signed);
    }
    const isBalanced    = Math.abs(drSum - crSum) < 5.0;
    const balanceDiff   = Math.abs(drSum - crSum);

    // ── Build result ──────────────────────────────────────────────────────
    const primaryGroups = [...new Set(nodes.map(n => n.primaryGroup))];
    const result = {
      success:       true,
      companyName:   companyName || "Unknown",
      financialYear: financialYear || "Unknown",
      detectedFormat: isXLS ? "XLS" : "XLSX",
      dataStartRow:  dataStart,
      isBalanced,
      balanceDiff:   Math.round(balanceDiff),
      grandTotalDr:  gtDr,
      grandTotalCr:  gtCr,
      totalNodes:    nodes.length,
      leafCount:     leaves.length,
      bsAccounts:    nodes.filter(n => n.bsPlSide === "BS").length,
      plAccounts:    nodes.filter(n => n.bsPlSide === "PL").length,
      unknownAccounts: nodes.filter(n => n.bsPlSide === "Unknown").length,
      primaryGroupCount: primaryGroups.length,
      primaryGroupNames: primaryGroups,
      batchId: crypto.randomUUID(),
      hierarchy: nodes,
    };

    // ── Save to Supabase ──────────────────────────────────────────────────
    if (engId || clientId) {
      await supabase.from("trial_balance_snapshots" as any).upsert({
        ...(engId     && { engagement_id:  engId }),
        ...(clientId  && { client_id:      clientId }),
        ...(firmId    && { firm_id:        firmId }),
        financial_year:  result.financialYear,
        snapshot_data:   nodes,
        is_balanced:     isBalanced,
        grand_total_dr:  gtDr,
        grand_total_cr:  gtCr,
        import_format:   result.detectedFormat,
        created_at:      new Date().toISOString(),
      });

      // ── Also save to tb_hierarchy_nodes so data persists across page reloads ──
      if (engId) {
        const batchId = result.batchId;
        // Ensure a batch record exists (FK constraint on tb_hierarchy_nodes)
        await supabase.from("ledger_import_batches").upsert({
          id: batchId,
          engagement_id: engId,
          ...(firmId && { firm_id: firmId }),
          original_filename: fileName || "file",
          import_type: "trial_balance",
          processing_status: "complete",
          status: "complete",
          total_rows: nodes.length,
          leaf_rows: nodes.filter((n: any) => n.isLeaf).length,
          processed_rows: nodes.length,
          row_count: nodes.length,
          error_log: [],
          imported_at: new Date().toISOString(),
        }, { onConflict: "id" });

        await supabase.from("tb_hierarchy_nodes").delete().eq("engagement_id", engId);
        const hRows = nodes.map((nd: any, i: number) => ({
          engagement_id:    engId,
          import_batch_id:  batchId,
          node_id:          nd.nodeId,
          parent_node_id:   nd.parentNodeId,
          tally_group_name: nd.name,
          level:            nd.level,
          is_leaf:          nd.isLeaf,
          is_bold:          nd.bold,
          indent_value:     nd.indent,
          opening_balance:  nd.opening,
          txn_debit:        nd.txnDebit,
          txn_credit:       nd.txnCredit,
          closing_balance:  nd.closing,
          primary_group:    nd.primaryGroup,
          bs_pl_side:       nd.bsPlSide,
          normal_balance:   nd.normalBal,
          row_number:       i + 1,
        }));
        for (let s = 0; s < hRows.length; s += 200) {
          await supabase.from("tb_hierarchy_nodes").insert(hRows.slice(s, s + 200));
        }
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("parse-tally-tb error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
