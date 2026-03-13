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

const KNOWN_GROUP_NAMES = new Set(
  [...BS_GROUPS_CR, ...BS_GROUPS_DR, ...PL_INCOME, ...PL_EXPENSE].map((g) =>
    g.toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim()
  )
);

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

/** Parse Indian number format: 1,25,000 → 125000, (25,000) → -25000 */
function parseNum(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return val;
  let s = String(val).trim();
  // Handle parentheses for negative
  const isNeg = s.startsWith("(") && s.endsWith(")");
  if (isNeg) s = s.slice(1, -1);
  // Remove commas, spaces, Dr/Cr text
  s = s.replace(/[,\s]/g, "").replace(/Cr|Dr/gi, "").trim();
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return isNeg ? -n : n;
}

function normalizeGroupName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

interface TBRow {
  rowNum: number;
  name: string;
  indent: number;
  bold: boolean;
  italic: boolean;
  isLedger: boolean;
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
  italic: boolean;
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

    console.log(`[parse-tally-tb] Total raw rows: ${rawRows.length}`);

    // ─── Detect header row and column positions (multi-row header support) ───
    let dataStartRow = -1;
    const colMap = { opening: -1, txnDebit: -1, txnCredit: -1, closing: -1 };
    let detectedFormat = "unknown";
    let particularsRow = -1;

    // === NEW: Detect Amount + Dr/Cr format ===
    let isAmountDrCrFormat = false;
    let amountCol = -1;
    let drCrCol = -1;

    // Step 1: Find the row where col A looks like account header
    for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
      const row = rawRows[r];
      if (!row) continue;
      const firstCell = String(row[0] || "").trim().toLowerCase();
      if (
        firstCell === "particulars" ||
        firstCell === "account name" ||
        firstCell === "ledger name" ||
        firstCell === "ledger" ||
        firstCell === "name"
      ) {
        particularsRow = r;
        break;
      }
    }

    // If no header found, scan for the first row that looks like data
    if (particularsRow < 0) {
      for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
        const row = rawRows[r];
        if (!row || !row[0]) continue;
        const firstCell = String(row[0]).trim();
        // Skip common non-data rows
        const lower = firstCell.toLowerCase();
        if (lower.includes("company") || lower.includes("trial balance") || lower.includes("period") ||
            lower.includes("date") || lower.includes("from") || lower.includes("to") || lower === "") continue;
        // Check if subsequent rows have data patterns (text + number)
        let looksLikeData = false;
        for (let checkR = r; checkR < Math.min(r + 5, rawRows.length); checkR++) {
          const checkRow = rawRows[checkR];
          if (!checkRow || !checkRow[0]) continue;
          const hasText = typeof checkRow[0] === "string" && checkRow[0].trim().length > 0;
          const hasNum = checkRow.slice(1).some((v: any) => typeof v === "number" || (typeof v === "string" && /[\d]/.test(v)));
          if (hasText && hasNum) { looksLikeData = true; break; }
        }
        if (looksLikeData) {
          // This row or one before it might be the header
          // Check if current row is a header
          const allText = row.every((c: any) => c === null || typeof c === "string");
          if (allText) {
            particularsRow = r;
          } else {
            // No header row, data starts directly
            dataStartRow = r;
          }
          break;
        }
      }
    }

    const headerHasToken = (header: string, token: string) => new RegExp(`(^|\\b|\\s)${token}(\\b|\\s|$)`, "i").test(header);
    const isDebitHeader = (header: string) =>
      (header.includes("debit") || header.includes("debit amount") || headerHasToken(header, "dr")) &&
      !(header.includes("credit") || headerHasToken(header, "cr"));
    const isCreditHeader = (header: string) =>
      (header.includes("credit") || header.includes("credit amount") || headerHasToken(header, "cr"));

    if (particularsRow >= 0) {
      // Step 2: Read up to 3 rows as a header block and combine text vertically per column
      const headerRowCount = 3;
      const maxCol = Math.max(...rawRows.slice(particularsRow, particularsRow + headerRowCount)
        .filter(Boolean).map(r => r.length));

      // Build combined header text for each column
      const combinedHeaders: string[] = [];
      for (let c = 0; c < maxCol; c++) {
        const parts: string[] = [];
        for (let hr = 0; hr < headerRowCount; hr++) {
          const row = rawRows[particularsRow + hr];
          if (!row) continue;
          const cellText = String(row[c] || "").trim();
          if (cellText) parts.push(cellText);
        }
        combinedHeaders[c] = parts.join(" ").toLowerCase();
      }

      console.log("[parse-tally-tb] Combined header text per column:", JSON.stringify(combinedHeaders));

      // === Check for Amount + Dr/Cr format ===
      // Look for a column that says "amount" and another that says "dr/cr" or similar
      for (let c = 1; c < combinedHeaders.length; c++) {
        const h = combinedHeaders[c];
        if ((h.includes("amount") || h.includes("balance")) && amountCol < 0) amountCol = c;
        if ((h.includes("dr/cr") || h.includes("dr cr") || h === "dr" || h === "cr" || h.includes("type")) && drCrCol < 0) drCrCol = c;
      }

      // Step 3: Detect standard column positions from combined header text
      for (let c = 1; c < combinedHeaders.length; c++) {
        const h = combinedHeaders[c];
        if (h.includes("opening") && colMap.opening < 0) {
          colMap.opening = c;
        } else if (h.includes("closing") && colMap.closing < 0) {
          colMap.closing = c;
        } else if (isDebitHeader(h) && colMap.txnDebit < 0) {
          colMap.txnDebit = c;
        } else if (isCreditHeader(h) && colMap.txnCredit < 0) {
          colMap.txnCredit = c;
        }
      }

      // Step 4: Find first actual data row
      dataStartRow = particularsRow + 1;
      while (dataStartRow < rawRows.length && dataStartRow < particularsRow + headerRowCount + 2) {
        const row = rawRows[dataStartRow];
        if (!row) { dataStartRow++; continue; }
        const firstVal = String(row[0] || "").trim().toLowerCase();
        const isSubHeader = !firstVal || firstVal === "₹" || firstVal.includes("amount") ||
          firstVal.includes("balance") || firstVal.includes("debit") || firstVal.includes("credit");
        const hasNumericData = row.slice(1).some((v: any) => {
          if (v === null || v === undefined) return false;
          return typeof v === "number" || /^[\d,.\-()\s]+$/.test(String(v).trim());
        });
        if (isSubHeader && !hasNumericData) {
          dataStartRow++;
        } else {
          break;
        }
      }

      console.log("[parse-tally-tb] Particulars row:", particularsRow, "Data starts at row:", dataStartRow, "colMap:", JSON.stringify(colMap));
    }

    // === Auto-detect Amount+Dr/Cr from data if headers didn't reveal it ===
    if (amountCol < 0 && colMap.txnDebit < 0 && colMap.txnCredit < 0 && dataStartRow >= 0) {
      // Scan a few data rows: if col B is numeric and col C is "Dr"/"Cr", it's Amount+Dr/Cr
      let drCrHits = 0;
      const scanStart = dataStartRow >= 0 ? dataStartRow : 0;
      for (let r = scanStart; r < Math.min(scanStart + 20, rawRows.length); r++) {
        const row = rawRows[r];
        if (!row || !row[0]) continue;
        const colC = String(row[2] || "").trim().toLowerCase();
        if (colC === "dr" || colC === "cr" || colC === "dr." || colC === "cr.") drCrHits++;
        // Also check if col B is numeric-looking
      }
      if (drCrHits >= 3) {
        isAmountDrCrFormat = true;
        amountCol = 1;
        drCrCol = 2;
        console.log("[parse-tally-tb] Detected Amount + Dr/Cr format from data scan");
      }
    }

    // If explicit Dr/Cr column header found
    if (amountCol >= 0 && drCrCol >= 0 && colMap.txnDebit < 0 && colMap.txnCredit < 0) {
      isAmountDrCrFormat = true;
      console.log("[parse-tally-tb] Using Amount+Dr/Cr format: amountCol=", amountCol, "drCrCol=", drCrCol);
    }

    // Determine format
    const numCols = [colMap.opening, colMap.txnDebit, colMap.txnCredit, colMap.closing].filter(c => c >= 0).length;
    if (isAmountDrCrFormat) {
      detectedFormat = "amount-drcr";
    } else if (numCols >= 4) {
      detectedFormat = "5-column";
    } else if (numCols === 3) {
      detectedFormat = "4-column";
    } else if (numCols === 2) {
      detectedFormat = "3-column";
    }

    // Fallback column detection for common Tally layouts
    if (dataStartRow < 0) {
      dataStartRow = 0;
      // Try to find first row with text in col A
      for (let r = 0; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (row && row[0] && String(row[0]).trim().length > 2) {
          dataStartRow = r;
          break;
        }
      }
    }

    // If columns still not detected and not Amount+Dr/Cr, use positional defaults
    if (!isAmountDrCrFormat && colMap.txnDebit < 0 && colMap.txnCredit < 0) {
      const sampleRow = rawRows[dataStartRow];
      if (sampleRow) {
        const nonEmpty = sampleRow.filter((v: any) => v !== null && v !== undefined && String(v).trim() !== "").length;
        if (nonEmpty >= 5) {
          colMap.opening = 1; colMap.txnDebit = 2; colMap.txnCredit = 3; colMap.closing = 4;
          detectedFormat = "5-column";
        } else if (nonEmpty >= 4) {
          colMap.txnDebit = 1; colMap.txnCredit = 2; colMap.closing = 3;
          detectedFormat = "4-column";
        } else if (nonEmpty >= 3) {
          // Could be Amount + Dr/Cr — check col C values
          const colCVal = String(sampleRow[2] || "").trim().toLowerCase();
          if (colCVal === "dr" || colCVal === "cr" || colCVal === "dr." || colCVal === "cr.") {
            isAmountDrCrFormat = true;
            amountCol = 1;
            drCrCol = 2;
            detectedFormat = "amount-drcr";
          } else {
            colMap.txnDebit = 1; colMap.txnCredit = 2;
            detectedFormat = "3-column";
          }
        } else {
          colMap.txnDebit = 1; colMap.txnCredit = 2;
          detectedFormat = "3-column";
        }
      }
    }

    console.log(`[parse-tally-tb] Detected format: ${detectedFormat}, isAmountDrCr: ${isAmountDrCrFormat}`);

    // ─── Read cell indents/styles from XLSX cell properties ───
    const indentMap: Record<number, number> = {};
    const boldMap: Record<number, boolean> = {};
    const italicMap: Record<number, boolean> = {};
    const rowOutlineMap: Record<number, number> = {};

    const worksheetRows = (ws as any)["!rows"] || [];
    for (let r = dataStartRow; r < rawRows.length; r++) {
      const rowMeta = worksheetRows[r];
      if (rowMeta && typeof rowMeta.level === "number") {
        rowOutlineMap[r] = Math.max(0, rowMeta.level);
      }
    }

    if (!isCSV) {
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      for (let r = dataStartRow; r <= range.e.r; r++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: 0 });
        const cell = ws[cellRef];
        if (cell?.s) {
          const style = cell.s as any;
          indentMap[r] = style?.alignment?.indent || 0;
          boldMap[r] = style?.font?.bold || false;
          italicMap[r] = style?.font?.italic || false;
        }
      }
    }

    // ─── Parse data rows ───
    const dataRows: TBRow[] = [];
    let skippedRows = 0;

    for (let r = dataStartRow; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row) { skippedRows++; continue; }

      const rawNameCell = row[0];
      const rawName = String(rawNameCell || "");
      const name = rawName.trim();

      // Skip rows with no account name
      if (!name) { skippedRows++; continue; }

      const nameLower = name.toLowerCase();
      // Skip total/grand total rows
      if (nameLower === "total" || nameLower.includes("grand total") || nameLower === "closing balance" ||
          nameLower.includes("opening balance") || nameLower === "difference in opening") {
        skippedRows++;
        continue;
      }

      const indentFromStyle = isCSV ? 0 : (indentMap[r] || 0);
      const indentFromOutline = isCSV ? 0 : (rowOutlineMap[r] || 0);
      const bold = isCSV ? false : (boldMap[r] || false);
      const italic = isCSV ? false : (italicMap[r] || false);

      // If indent not available from styles, try to detect from leading spaces/tabs/non-breaking spaces
      let effectiveIndent = Math.max(indentFromStyle, indentFromOutline);
      if (effectiveIndent === 0 && !isCSV) {
        const wsMatch = rawName.match(/^[\s\u00A0]+/);
        const leading = wsMatch ? wsMatch[0].replace(/\t/g, "    ").length : 0;
        if (leading > 0) {
          effectiveIndent = Math.floor(leading / 2);
        }
      }

      let txnDebit = 0;
      let txnCredit = 0;
      let opening = 0;
      let closing = 0;
      let isLedger = false;

      if (isAmountDrCrFormat) {
        // Amount + Dr/Cr format
        const amount = parseNum(row[amountCol]);
        const drCrVal = String(row[drCrCol] || "").trim().toLowerCase().replace(".", "");
        const hasDrCrMarker = drCrVal === "dr" || drCrVal === "cr";

        if (drCrVal === "dr") {
          txnDebit = Math.abs(amount);
          txnCredit = 0;
          isLedger = true;
        } else if (drCrVal === "cr") {
          txnDebit = 0;
          txnCredit = Math.abs(amount);
          isLedger = true;
        } else if (amount === 0) {
          // Allow zero-transaction ledger rows without Dr/Cr markers
          txnDebit = 0;
          txnCredit = 0;
          isLedger = true;
        } else {
          // Non-zero amount without Dr/Cr is usually a group/subtotal row
          txnDebit = 0;
          txnCredit = 0;
          opening = amount;
          closing = amount;
          isLedger = false;
        }

        if (hasDrCrMarker || amount === 0) {
          opening = txnDebit - txnCredit;
          closing = opening + txnDebit - txnCredit;
        }
      } else {
        const openingCol = colMap.opening >= 0 ? parseNum(row[colMap.opening]) : 0;
        const closingCol = colMap.closing >= 0 ? parseNum(row[colMap.closing]) : 0;
        txnDebit = colMap.txnDebit >= 0 ? parseNum(row[colMap.txnDebit]) : 0;
        txnCredit = colMap.txnCredit >= 0 ? parseNum(row[colMap.txnCredit]) : 0;

        const hasNumericCells = [colMap.opening, colMap.txnDebit, colMap.txnCredit, colMap.closing]
          .filter((c) => c >= 0)
          .some((c) => row[c] !== null && row[c] !== undefined && String(row[c]).trim() !== "");

        isLedger = hasNumericCells || txnDebit !== 0 || txnCredit !== 0 || openingCol !== 0 || closingCol !== 0;
        opening = txnDebit - txnCredit;
        closing = opening + txnDebit - txnCredit;
      }

      // IMPORTANT: Do NOT skip rows where both debit and credit are zero if name exists
      dataRows.push({
        rowNum: r,
        name,
        indent: effectiveIndent,
        bold,
        italic,
        isLedger,
        opening,
        txnDebit,
        txnCredit,
        closing,
      });
    }

    console.log(`[parse-tally-tb] Rows read: ${rawRows.length}, Valid rows: ${dataRows.length}, Skipped: ${skippedRows}`);

    if (dataRows.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: `No valid rows found. Total rows scanned: ${rawRows.length}, all skipped. Data start row: ${dataStartRow}, format: ${detectedFormat}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Build hierarchy tree (indentation-first, formatting fallback) ───
    const nodes: HierarchyNode[] = [];
    const parentStack: { level: number; nodeId: string; name: string }[] = [];
    const childCounterByParent = new Map<string, number>();
    const nodeRegistry = new Map<string, HierarchyNode>();
    const hasIndentSignals = dataRows.some((r) => r.indent > 0);
    let prevWasGroup = false;
    let prevGroupLevel = 1;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const normalizedName = normalizeGroupName(row.name);
      const knownGroupByName = KNOWN_GROUP_NAMES.has(normalizedName);
      const rowLooksGroup = !row.isLedger || (!hasIndentSignals && knownGroupByName);

      let level = 1;
      if (hasIndentSignals) {
        level = Math.max(1, row.indent + 1);
      } else if (row.bold) {
        level = 1;
      } else if (row.italic) {
        level = prevWasGroup ? Math.min(prevGroupLevel + 1, 3) : 3;
      } else if (rowLooksGroup) {
        level = prevWasGroup ? Math.min(prevGroupLevel + 1, 3) : 1;
      } else {
        level = prevWasGroup ? Math.max(prevGroupLevel + 1, 2) : 4;
      }

      // Maintain parent stack by computed level
      while (parentStack.length >= level) {
        parentStack.pop();
      }

      const parentNode = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;

      // Skip duplicate echo rows where child group name repeats the parent name (e.g. & vs and)
      if (rowLooksGroup && parentNode && normalizeGroupName(parentNode.name) === normalizedName) {
        prevWasGroup = true;
        prevGroupLevel = level;
        continue;
      }

      const isLeaf = !rowLooksGroup;
      const dedupeKey = `${parentNode?.nodeId || "root"}::${normalizedName}::${isLeaf ? "leaf" : "group"}`;
      let node = nodeRegistry.get(dedupeKey) || null;

      if (node && isLeaf) {
        const sameBalances =
          Math.abs((node.opening || 0) - row.opening) < 0.01 &&
          Math.abs((node.txnDebit || 0) - row.txnDebit) < 0.01 &&
          Math.abs((node.txnCredit || 0) - row.txnCredit) < 0.01 &&
          Math.abs((node.closing || 0) - row.closing) < 0.01;
        if (!sameBalances) {
          node = null;
        }
      }

      if (!node) {
        const parentKey = parentNode?.nodeId || "root";
        const nextIndex = (childCounterByParent.get(parentKey) || 0) + 1;
        childCounterByParent.set(parentKey, nextIndex);

        const nodeId = parentNode ? `${parentNode.nodeId}.${nextIndex}` : String(nextIndex);
        const primaryGroup = parentStack.length > 0 ? parentStack[0].name : row.name;
        const bsPlSide = detectBsPlSide(primaryGroup);
        const normalBal = detectNormalBalance(primaryGroup);

        node = {
          nodeId,
          parentNodeId: parentNode?.nodeId || null,
          level,
          name: row.name,
          indent: row.indent,
          bold: row.bold,
          italic: row.italic,
          isLeaf,
          primaryGroup,
          bsPlSide,
          normalBal,
          opening: row.opening,
          txnDebit: row.txnDebit,
          txnCredit: row.txnCredit,
          closing: row.closing,
          rowNumber: row.rowNum,
        };

        nodes.push(node);
        nodeRegistry.set(dedupeKey, node);
      }

      if (!node.isLeaf) {
        parentStack.push({ level: node.level, nodeId: node.nodeId, name: node.name });
        prevWasGroup = true;
        prevGroupLevel = node.level;
      } else {
        prevWasGroup = false;
      }
    }

    // ─── Recursive group aggregation from child accounts ───
    const childrenByParent = new Map<string, HierarchyNode[]>();
    for (const node of nodes) {
      if (!node.parentNodeId) continue;
      const children = childrenByParent.get(node.parentNodeId) || [];
      children.push(node);
      childrenByParent.set(node.parentNodeId, children);
    }

    const nodesByDepth = [...nodes].sort((a, b) => b.level - a.level);
    for (const node of nodesByDepth) {
      if (node.isLeaf) continue;
      const children = childrenByParent.get(node.nodeId) || [];
      if (children.length === 0) continue;

      node.opening = children.reduce((sum, child) => sum + child.opening, 0);
      node.txnDebit = children.reduce((sum, child) => sum + child.txnDebit, 0);
      node.txnCredit = children.reduce((sum, child) => sum + child.txnCredit, 0);
      node.closing = children.reduce((sum, child) => sum + child.closing, 0);
    }

    const leafNodes = nodes.filter(n => n.isLeaf);
    const groupNodes = nodes.filter(n => !n.isLeaf);

    console.log(`[parse-tally-tb] Rows read: ${rawRows.length}, Valid rows detected: ${dataRows.length}, Groups: ${groupNodes.length}, Ledgers: ${leafNodes.length}, Rows skipped: ${skippedRows}`);

    // ─── Save to database ───
    const batchId = crypto.randomUUID();
    await supabase.from("ledger_import_batches").insert({
      id: batchId,
      engagement_id: engagementId,
      firm_id: firmId || null,
      import_type: "trial_balance",
      status: "processing",
      total_rows: nodes.length,
      leaf_rows: leafNodes.length,
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
      const { error: insertErr } = await supabase.from("tb_hierarchy_nodes").insert(batch);
      if (insertErr) console.error("[parse-tally-tb] Insert hierarchy error:", insertErr);
    }

    // Save leaf ledgers to trial_balance_snapshots
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
      const { error: insertErr } = await supabase.from("trial_balance_snapshots").insert(batch);
      if (insertErr) console.error("[parse-tally-tb] Insert snapshots error:", insertErr);
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
        rowsRead: rawRows.length,
        groupsDetected: groupNodes.length,
        rowsSkipped: skippedRows,
        tagging: taggingResult,
        hierarchy: nodes.map(n => ({
          nodeId: n.nodeId,
          parentNodeId: n.parentNodeId,
          name: n.name,
          level: n.level,
          isLeaf: n.isLeaf,
          bold: n.bold,
          italic: n.italic,
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
