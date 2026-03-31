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
function buildHierarchy(rows: TBRow[]): {
  isGrp: boolean[]; parentIdx: number[];
} {
  const n = rows.length;
  const isGrp    = new Array<boolean>(n).fill(false);
  const parentIdx = new Array<number>(n).fill(-1);

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
    for (let j = i+1; j < n && j-i < 600; j++) {
      sCl += rows[j].closing;  sOp += rows[j].opening;
      sDr += rows[j].txnDebit; sCr += rows[j].txnCredit;
      cnt++;
      const ok =
        (t.closing   !== 0 && Math.abs(sCl - t.closing)   <= tol) ||
        (t.txnDebit  !== 0 && Math.abs(sDr - t.txnDebit)  <= tol) ||
        (t.txnCredit !== 0 && Math.abs(sCr - t.txnCredit) <= tol) ||
        (t.opening   !== 0 && Math.abs(sOp - t.opening)   <= tol);
      if (ok && cnt >= 1) {
        isGrp[i] = true;
        for (let k = i+1; k <= j; k++)
          if (parentIdx[k] === -1) parentIdx[k] = i;
        break;
      }
    }
  }
  return { isGrp, parentIdx };
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
    const { isGrp, parentIdx } = buildHierarchy(rawRows);

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
