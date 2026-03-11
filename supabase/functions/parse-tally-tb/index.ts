import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── BS/PL Classification ───
const BS_GROUPS_CR = [
  "share holder funds","shareholders funds","share capital","reserves & surplus","reserves and surplus",
  "loans (liability)","loan (liability)","secured loans","unsecured loans",
  "bank od","current liabilities","sundry creditors","duties & taxes","duties and taxes",
  "provisions","other liabilities","capital account","partners capital",
];
const BS_GROUPS_DR = [
  "fixed assets","investments","current assets","sundry debtors",
  "cash-in-hand","cash in hand","bank accounts","deposits (asset)","deposits asset",
  "loans & advances","loans and advances","stock in hand","stock-in-hand",
  "opening stock","tax receivable","suspense",
];
const PL_INCOME = [
  "sales accounts","indirect incomes","direct incomes","other income","income",
];
const PL_EXPENSE = [
  "purchase accounts","direct expenses","indirect expenses",
  "employee benefit","financial expense","manufacturing expenses",
];

function detectBsPlSide(primaryGroup: string): string {
  const pg = primaryGroup.toLowerCase().trim();
  if (BS_GROUPS_CR.some(g => pg.includes(g))) return "BS";
  if (BS_GROUPS_DR.some(g => pg.includes(g))) return "BS";
  if (PL_INCOME.some(g => pg.includes(g))) return "PL";
  if (PL_EXPENSE.some(g => pg.includes(g))) return "PL";
  return "Unknown";
}

function detectNormalBalance(primaryGroup: string): string {
  const pg = primaryGroup.toLowerCase().trim();
  if (BS_GROUPS_DR.some(g => pg.includes(g))) return "Dr";
  if (BS_GROUPS_CR.some(g => pg.includes(g))) return "Cr";
  if (PL_EXPENSE.some(g => pg.includes(g))) return "Dr";
  if (PL_INCOME.some(g => pg.includes(g))) return "Cr";
  return "Unknown";
}

function parseNum(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return val;
  const s = String(val).replace(/[,\s]/g, "").replace(/\((.+)\)/, "-$1").replace(/Cr|Dr/gi, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

interface TBRow {
  rowNum: number;
  name: string;
  indent: number;
  bold: boolean;
  opening: number;
  txnDebit: number;
  txnCredit: number;
  closing: number;
}

interface HierarchyNode {
  nodeId: string;
  parentNodeId: string | null;
  level: number;
  name: string;
  indent: number;
  bold: boolean;
  isLeaf: boolean;
  primaryGroup: string;
  bsPlSide: string;
  normalBal: string;
  opening: number;
  txnDebit: number;
  txnCredit: number;
  closing: number;
  rowNumber: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { engagementId, firmId, fileBase64, fileName, financialYear } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Decode file
    const binaryStr = atob(fileBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const isCSV = fileName?.toLowerCase().endsWith(".csv");
    const wb = XLSX.read(bytes, { type: "array", cellStyles: true });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Get raw data with headers
    const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

    // ─── Detect header row and column positions ───
    let dataStartRow = -1;
    const colMap = { opening: -1, txnDebit: -1, txnCredit: -1, closing: -1 };
    let detectedFormat = "unknown";

    for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
      const row = rawRows[r];
      if (!row) continue;
      const firstCell = String(row[0] || "").trim().toLowerCase();
      
      if (firstCell === "particulars" || firstCell === "account name" || firstCell === "ledger name") {
        // Scan this row for column headers
        for (let c = 1; c < row.length; c++) {
          const h = String(row[c] || "").toLowerCase().trim();
          if (h.includes("opening")) colMap.opening = c;
          else if (h.includes("debit") && !h.includes("credit")) colMap.txnDebit = c;
          else if (h.includes("credit")) colMap.txnCredit = c;
          else if (h.includes("closing")) colMap.closing = c;
        }
        
        // Skip sub-header rows (e.g. currency row)
        dataStartRow = r + 1;
        // Check if next row is also a header (e.g. "₹" row)
        if (dataStartRow < rawRows.length) {
          const nextFirst = String(rawRows[dataStartRow]?.[0] || "").trim();
          if (!nextFirst || nextFirst === "₹" || nextFirst.toLowerCase().includes("amount")) {
            dataStartRow++;
          }
        }
        break;
      }
    }

    // Determine format based on detected columns
    const numCols = [colMap.opening, colMap.txnDebit, colMap.txnCredit, colMap.closing].filter(c => c >= 0).length;
    if (numCols >= 4) detectedFormat = "5-column";
    else if (numCols === 3) detectedFormat = "4-column";
    else if (numCols === 2) detectedFormat = "3-column";
    
    // Fallback column detection for common Tally layouts
    if (dataStartRow < 0) {
      dataStartRow = 13; // Tally default: skip first 13 rows
    }
    
    // If columns not detected, use positional defaults
    if (colMap.txnDebit < 0 && colMap.txnCredit < 0) {
      // Try to count non-empty columns in data rows
      const sampleRow = rawRows[dataStartRow];
      if (sampleRow) {
        const nonEmpty = sampleRow.filter((v: any) => v !== null && v !== undefined && String(v).trim() !== "").length;
        if (nonEmpty >= 5) {
          colMap.opening = 1; colMap.txnDebit = 2; colMap.txnCredit = 3; colMap.closing = 4;
          detectedFormat = "5-column";
        } else if (nonEmpty >= 4) {
          colMap.txnDebit = 1; colMap.txnCredit = 2; colMap.closing = 3;
          detectedFormat = "4-column";
        } else {
          colMap.txnDebit = 1; colMap.txnCredit = 2;
          detectedFormat = "3-column";
        }
      }
    }

    // ─── Read cell indents from XLSX cell properties ───
    const indentMap: Record<number, number> = {};
    const boldMap: Record<number, boolean> = {};
    
    if (!isCSV) {
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      for (let r = dataStartRow; r <= range.e.r; r++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: 0 });
        const cell = ws[cellRef];
        if (cell?.s) {
          const style = cell.s as any;
          indentMap[r] = style?.alignment?.indent || 0;
          boldMap[r] = style?.font?.bold || false;
        }
      }
    }

    // ─── Parse data rows ───
    const dataRows: TBRow[] = [];
    for (let r = dataStartRow; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row) continue;
      const name = String(row[0] || "").trim();
      if (!name) continue;
      const nameLower = name.toLowerCase();
      if (nameLower.includes("grand total") || nameLower === "total" || nameLower.includes("closing balance")) continue;

      const indent = isCSV ? 0 : (indentMap[r] || 0);
      const bold = isCSV ? false : (boldMap[r] || false);

      // If indent not available from styles, try to detect from leading spaces
      let effectiveIndent = indent;
      if (effectiveIndent === 0 && !isCSV) {
        const rawName = String(row[0] || "");
        const leadingSpaces = rawName.length - rawName.trimStart().length;
        effectiveIndent = Math.floor(leadingSpaces / 3); // 3 spaces per indent level
      }

      const opening = colMap.opening >= 0 ? parseNum(row[colMap.opening]) : 0;
      const txnDebit = colMap.txnDebit >= 0 ? parseNum(row[colMap.txnDebit]) : 0;
      const txnCredit = colMap.txnCredit >= 0 ? parseNum(row[colMap.txnCredit]) : 0;
      const closing = colMap.closing >= 0 ? parseNum(row[colMap.closing]) : 0;

      dataRows.push({ rowNum: r, name, indent: effectiveIndent, bold, opening, txnDebit, txnCredit, closing });
    }

    // ─── Build hierarchy tree ───
    const nodes: HierarchyNode[] = [];
    const indentStack: { indent: number; nodeId: string; name: string }[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const nextIndent = i < dataRows.length - 1 ? dataRows[i + 1].indent : -1;
      const isLeaf = isCSV ? true : (nextIndent <= row.indent);

      // Pop stack to find parent
      while (indentStack.length > 0 && indentStack[indentStack.length - 1].indent >= row.indent) {
        indentStack.pop();
      }

      const parentNode = indentStack.length > 0 ? indentStack[indentStack.length - 1] : null;
      const level = indentStack.length + 1;
      const nodeId = parentNode
        ? `${parentNode.nodeId}.${nodes.filter(n => n.parentNodeId === parentNode.nodeId).length + 1}`
        : String(nodes.filter(n => !n.parentNodeId).length + 1);

      const primaryGroup = indentStack.length > 0 ? indentStack[0].name : row.name;
      const bsPlSide = detectBsPlSide(primaryGroup);
      const normalBal = detectNormalBalance(primaryGroup);

      nodes.push({
        nodeId,
        parentNodeId: parentNode?.nodeId || null,
        level,
        name: row.name,
        indent: row.indent,
        bold: row.bold,
        isLeaf,
        primaryGroup,
        bsPlSide,
        normalBal,
        opening: row.opening,
        txnDebit: row.txnDebit,
        txnCredit: row.txnCredit,
        closing: row.closing,
        rowNumber: row.rowNum,
      });

      if (!isLeaf) {
        indentStack.push({ indent: row.indent, nodeId, name: row.name });
      }
    }

    // ─── Save to database ───
    const batchId = crypto.randomUUID();
    await supabase.from("ledger_import_batches").insert({
      id: batchId,
      engagement_id: engagementId,
      firm_id: firmId || null,
      import_type: "trial_balance",
      status: "processing",
      total_rows: nodes.length,
      leaf_rows: nodes.filter(n => n.isLeaf).length,
      original_filename: fileName,
    });

    // Delete old hierarchy nodes for this engagement
    await supabase.from("tb_hierarchy_nodes").delete().eq("engagement_id", engagementId);

    // Insert hierarchy nodes in batches of 100
    for (let i = 0; i < nodes.length; i += 100) {
      const batch = nodes.slice(i, i + 100).map(n => ({
        engagement_id: engagementId,
        import_batch_id: batchId,
        node_id: n.nodeId,
        parent_node_id: n.parentNodeId,
        level: n.level,
        tally_group_name: n.name,
        indent_value: n.indent,
        is_leaf: n.isLeaf,
        is_bold: n.bold,
        opening_balance: n.opening,
        txn_debit: n.txnDebit,
        txn_credit: n.txnCredit,
        closing_balance: n.closing,
        normal_balance: n.normalBal,
        bs_pl_side: n.bsPlSide,
        primary_group: n.primaryGroup,
        row_number: n.rowNumber,
      }));
      await supabase.from("tb_hierarchy_nodes").insert(batch);
    }

    // Save leaf ledgers to trial_balance_snapshots
    const leafNodes = nodes.filter(n => n.isLeaf);
    
    // Delete old leaf snapshots for this engagement
    await supabase.from("trial_balance_snapshots").delete().eq("engagement_id", engagementId);

    for (let i = 0; i < leafNodes.length; i += 100) {
      const batch = leafNodes.slice(i, i + 100).map(n => ({
        engagement_id: engagementId,
        import_batch_id: batchId,
        ledger_name: n.name,
        node_id: n.nodeId,
        parent_node_id: n.parentNodeId,
        hierarchy_level: n.level,
        primary_group: n.primaryGroup,
        tally_indent: n.indent,
        normal_balance: n.normalBal,
        bs_pl_side: n.bsPlSide,
        opening_balance: n.opening,
        txn_debit: n.txnDebit,
        txn_credit: n.txnCredit,
        closing_balance: n.closing,
        financial_year: financialYear || null,
      }));
      await supabase.from("trial_balance_snapshots").insert(batch);
    }

    await supabase.from("ledger_import_batches").update({
      status: "complete",
      processed_rows: leafNodes.length,
    }).eq("id", batchId);

    // Compute stats
    const primaryGroups = [...new Set(nodes.map(n => n.primaryGroup))];
    const bsCount = leafNodes.filter(n => n.bsPlSide === "BS").length;
    const plCount = leafNodes.filter(n => n.bsPlSide === "PL").length;
    const totalDr = leafNodes.reduce((s, n) => s + n.txnDebit, 0);
    const totalCr = leafNodes.reduce((s, n) => s + n.txnCredit, 0);
    const isBalanced = Math.abs(totalDr - totalCr) < 1;

    // ─── Chain: Tag ledgers with scrutiny categories ───
    let taggingResult: any = null;
    try {
      const tagUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/tag-tb-ledgers`;
      const tagRes = await fetch(tagUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ engagementId, firmId }),
      });
      if (tagRes.ok) {
        taggingResult = await tagRes.json();
      } else {
        console.error("tag-tb-ledgers failed:", await tagRes.text());
      }
    } catch (tagErr) {
      console.error("tag-tb-ledgers chain error:", tagErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalNodes: nodes.length,
        leafLedgers: leafNodes.length,
        primaryGroups: primaryGroups.length,
        primaryGroupNames: primaryGroups,
        bsAccounts: bsCount,
        plAccounts: plCount,
        totalDr,
        totalCr,
        isBalanced,
        detectedFormat,
        batchId,
        tagging: taggingResult,
        hierarchy: nodes.map(n => ({
          nodeId: n.nodeId,
          parentNodeId: n.parentNodeId,
          name: n.name,
          level: n.level,
          isLeaf: n.isLeaf,
          bold: n.bold,
          indent: n.indent,
          opening: n.opening,
          txnDebit: n.txnDebit,
          txnCredit: n.txnCredit,
          closing: n.closing,
          primaryGroup: n.primaryGroup,
          bsPlSide: n.bsPlSide,
          normalBal: n.normalBal,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("parse-tally-tb error:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
