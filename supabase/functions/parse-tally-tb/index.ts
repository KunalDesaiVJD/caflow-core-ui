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
  const isNegByParens = s.startsWith("(") && s.endsWith(")");
  if (isNegByParens) s = s.slice(1, -1);

  s = s.replace(/[\s,\u00A0]/g, "").replace(/Cr|Dr|Credit|Debit/gi, "").trim();
  const n = parseFloat(s);
  if (isNaN(n)) return 0;

  const signed = isNegByParens ? -n : n;
  return Object.is(signed, -0) ? 0 : signed;
}

/** Parse balance cell where Dr/Cr marker may be embedded in same cell text */
function parseSignedBalance(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return Object.is(val, -0) ? 0 : val;

  const raw = String(val).trim();
  if (!raw) return 0;

  const hasCrMarker = /(^|\b)cr(\b|$)|credit/i.test(raw);
  const hasDrMarker = /(^|\b)dr(\b|$)|debit/i.test(raw);
  const parsed = parseNum(raw);

  if (parsed === 0) return 0;
  if (hasCrMarker && !hasDrMarker) return -Math.abs(parsed);
  if (hasDrMarker && !hasCrMarker) return Math.abs(parsed);
  return parsed;
}

function normalizeGroupName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── CHANGE 2: Multi-strategy indent detection ───
function getEffectiveIndent(
  indentFromStyle: number,
  outlineLevel: number,
  cellValue: string,
  isCSV: boolean
): number {
  // Strategy 1: trust cell style if > 0
  if (!isCSV && indentFromStyle > 0) return indentFromStyle;
  // Strategy 2: trust outline level if > 0
  if (!isCSV && outlineLevel > 0) return outlineLevel;
  // Strategy 3: count leading spaces in cell text
  const raw = String(cellValue || "");
  const leadingSpaces = raw.length - raw.trimStart().length;
  if (leadingSpaces >= 2) return Math.floor(leadingSpaces / 2);
  // Strategy 4: return 0 (formatting fallback will handle)
  return 0;
}

// ─── CHANGE 4: Validation helpers ───
function findDuplicateNames(leaves: HierarchyNode[]): string[] {
  const seen = new Map<string, number>();
  for (const n of leaves) {
    const key = n.name.toLowerCase().trim();
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()].filter(([_, count]) => count > 1).map(([name]) => name);
}

function checkGroupAggregation(
  _nodes: HierarchyNode[],
  _childrenByParent: Map<string, HierarchyNode[]>
): { group: string; fileValue: number; computedValue: number }[] {
  // Placeholder — detailed implementation in future
  return [];
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

// ─── Value-matching hierarchy detection (for files without indent metadata) ───
// Detects groups by checking if consecutive following rows' closing balances
// sum to the current row's value — exploiting Tally's DFS output property.
function detectHierarchyByValueMatching(dataRows: TBRow[]): {
  isGroup: boolean[]; groupSpanEnd: number[]; parentIdx: number[];
} {
  const n = dataRows.length;
  const isGroup = new Array(n).fill(false);
  const groupSpanEnd = new Array(n).fill(-1);
  const parentIdx = new Array(n).fill(-1);
  const TOLERANCE = 2.0;

  // Bottom-up pass: inner groups are detected before outer ones
  for (let i = n - 2; i >= 0; i--) {
    const target = dataRows[i];
    const hasClosing = Math.abs(target.closing) > TOLERANCE;
    const hasTxn = target.txnDebit > TOLERANCE || target.txnCredit > TOLERANCE;
    const hasOpening = Math.abs(target.opening) > TOLERANCE;
    const hasAnyValue = hasClosing || hasTxn || hasOpening;

    if (!hasAnyValue) {
      // Zero-value row: could be a group header. Check if next rows form a block.
      // We'll handle these after the main value-matching pass.
      continue;
    }

    let sumClosing = 0, sumOpening = 0, sumTxnDr = 0, sumTxnCr = 0;
    let directChildCount = 0;
    let j = i + 1;

    while (j < n && j - i < 600) {
      sumClosing += dataRows[j].closing;
      sumOpening += dataRows[j].opening;
      sumTxnDr += dataRows[j].txnDebit;
      sumTxnCr += dataRows[j].txnCredit;
      directChildCount++;

      // Skip identified sub-group's descendants
      const nextJ = (isGroup[j] && groupSpanEnd[j] >= 0) ? groupSpanEnd[j] + 1 : j + 1;
      j = nextJ;

      // Check closing match
      const closingMatch = Math.abs(sumClosing - target.closing) < TOLERANCE;
      // For zero-closing targets, try txnDebit match instead
      const txnDrMatch = !hasClosing && hasTxn && target.txnDebit > TOLERANCE &&
        Math.abs(sumTxnDr - target.txnDebit) < TOLERANCE;

      if (directChildCount >= 1 && (closingMatch || txnDrMatch)) {
        // Single-child: require secondary confirmation to avoid false positives
        if (directChildCount === 1) {
          const openOk = Math.abs(sumOpening - target.opening) < TOLERANCE;
          const txnOk = Math.abs(sumTxnDr - target.txnDebit) < TOLERANCE &&
                        Math.abs(sumTxnCr - target.txnCredit) < TOLERANCE;
          if (!openOk && !txnOk) continue; // keep scanning
        }

        // Extend span to include trailing zero-closing rows (e.g. TDS with Dr=Cr)
        while (j < n && Math.abs(dataRows[j].closing) < TOLERANCE && !isGroup[j]) {
          // Only include if it doesn't overshoot txn totals
          const newTxnDr = sumTxnDr + dataRows[j].txnDebit;
          if (hasTxn && newTxnDr > target.txnDebit + TOLERANCE + 1) break;
          sumTxnDr = newTxnDr;
          sumTxnCr += dataRows[j].txnCredit;
          j++;
        }

        isGroup[i] = true;
        groupSpanEnd[i] = j - 1;
        break;
      }

      // Safety: stop if sum overshoots target significantly
      if (hasClosing && directChildCount > 2 &&
          Math.abs(sumClosing) > Math.abs(target.closing) * 2.5 + 100000) break;
    }
  }

  // Second pass: handle zero-value group headers
  // These rows have no values but are followed by children that do
  for (let i = n - 2; i >= 0; i--) {
    if (isGroup[i]) continue;
    const target = dataRows[i];
    const hasAnyValue = Math.abs(target.closing) > TOLERANCE ||
      Math.abs(target.opening) > TOLERANCE ||
      target.txnDebit > TOLERANCE || target.txnCredit > TOLERANCE;
    if (hasAnyValue) continue;

    // Check if next rows are children (have values or are identified groups)
    let spanEnd = -1;
    for (let k = i + 1; k < n && k - i < 300; k++) {
      const kVal = Math.abs(dataRows[k].closing) > TOLERANCE ||
        Math.abs(dataRows[k].opening) > TOLERANCE ||
        dataRows[k].txnDebit > TOLERANCE || dataRows[k].txnCredit > TOLERANCE;
      if (kVal || isGroup[k]) {
        spanEnd = isGroup[k] && groupSpanEnd[k] >= 0 ? groupSpanEnd[k] : k;
        if (isGroup[k] && groupSpanEnd[k] >= 0) k = groupSpanEnd[k];
      } else {
        break;
      }
    }
    if (spanEnd > i) {
      isGroup[i] = true;
      groupSpanEnd[i] = spanEnd;
    }
  }

  // Assign parent indices: each group's direct children
  for (let i = 0; i < n; i++) {
    if (!isGroup[i] || groupSpanEnd[i] < 0) continue;
    let j = i + 1;
    while (j <= groupSpanEnd[i]) {
      if (parentIdx[j] === -1) {
        parentIdx[j] = i;
      }
      // Skip sub-group spans to only assign DIRECT children
      if (isGroup[j] && groupSpanEnd[j] >= 0) {
        j = groupSpanEnd[j] + 1;
      } else {
        j++;
      }
    }
  }

  return { isGroup, groupSpanEnd, parentIdx };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ─── CHANGE 1: Accept chunked uploads + PDF text mode ───
    const {
      engagementId, firmId, financialYear,
      // Full file mode (small files <2MB)
      fileBase64, fileName,
      // Chunked mode (large files)
      chunkBase64, chunkIndex, totalChunks, uploadSessionId, isLastChunk,
      // PDF text mode
      pdfTextRows,
    } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ─── Handle chunk buffering ───
    if (chunkBase64 !== undefined && !isLastChunk) {
      await supabase.from("tb_upload_sessions").upsert({
        id: `${uploadSessionId}_${chunkIndex}`,
        engagement_id: engagementId,
        chunk_index: chunkIndex,
        chunk_data: chunkBase64,
        total_chunks: totalChunks,
        created_at: new Date().toISOString(),
      });
      return new Response(
        JSON.stringify({ success: true, received: chunkIndex + 1, total: totalChunks }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If this is the last chunk, reassemble all chunks
    let fullBase64 = fileBase64;
    if (isLastChunk && uploadSessionId) {
      const { data: chunks } = await supabase
        .from("tb_upload_sessions")
        .select("chunk_index, chunk_data")
        .like("id", `${uploadSessionId}_%`)
        .order("chunk_index");
      const allChunks = [
        ...(chunks || []).map((c: any) => ({ chunk_index: c.chunk_index, chunk_data: c.chunk_data })),
        { chunk_index: chunkIndex, chunk_data: chunkBase64 },
      ];
      allChunks.sort((a: any, b: any) => a.chunk_index - b.chunk_index);
      fullBase64 = allChunks.map((c: any) => c.chunk_data).join("");
      // Clean up session chunks
      await supabase.from("tb_upload_sessions").delete().like("id", `${uploadSessionId}_%`);
    }

    // ─── CHANGE 6: PDF text parse path ───
    let rawRows: any[][] = [];
    let isCSV = false;
    let ws: any = null;
    let skippedGrandTotal = false;

    if (pdfTextRows && Array.isArray(pdfTextRows)) {
      // PDF lines have been pre-extracted by the client
      isCSV = true; // No indent data from PDF
      for (const line of pdfTextRows) {
        if (!String(line).trim()) continue;
        const parts = String(line).trim().split(/\s{3,}/);
        if (parts.length >= 2) {
          rawRows.push(parts);
        } else {
          rawRows.push([String(line).trim()]);
        }
      }
      console.log(`[parse-tally-tb] PDF text mode: ${rawRows.length} rows from ${pdfTextRows.length} lines`);
    } else {
      // Excel/CSV mode
      if (!fullBase64) {
        return new Response(
          JSON.stringify({ success: false, error: "No file data provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const binaryStr = atob(fullBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      isCSV = fileName?.toLowerCase().endsWith(".csv") || false;
      const wb = XLSX.read(bytes, { type: "array", cellStyles: true });
      ws = wb.Sheets[wb.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    }

    console.log(`[parse-tally-tb] Total raw rows: ${rawRows.length}`);

    // ─── Detect header row and column positions (multi-row header support) ───
    let dataStartRow = -1;
    const colMap = {
      opening: -1,
      openingDebit: -1,
      openingCredit: -1,
      txnDebit: -1,
      txnCredit: -1,
      closing: -1,
      closingDebit: -1,
      closingCredit: -1,
    };
    let detectedFormat = "unknown";
    let particularsRow = -1;

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
        const lower = firstCell.toLowerCase();
        if (lower.includes("company") || lower.includes("trial balance") || lower.includes("period") ||
            lower.includes("date") || lower.includes("from") || lower.includes("to") || lower === "") continue;
        let looksLikeData = false;
        for (let checkR = r; checkR < Math.min(r + 5, rawRows.length); checkR++) {
          const checkRow = rawRows[checkR];
          if (!checkRow || !checkRow[0]) continue;
          const hasText = typeof checkRow[0] === "string" && checkRow[0].trim().length > 0;
          const hasNum = checkRow.slice(1).some((v: any) => typeof v === "number" || (typeof v === "string" && /[\d]/.test(v)));
          if (hasText && hasNum) { looksLikeData = true; break; }
        }
        if (looksLikeData) {
          const allText = row.every((c: any) => c === null || typeof c === "string");
          if (allText) {
            particularsRow = r;
          } else {
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
      const headerRowCount = 3;
      const maxCol = Math.max(...rawRows.slice(particularsRow, particularsRow + headerRowCount)
        .filter(Boolean).map((r: any) => r.length));

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

      for (let c = 1; c < combinedHeaders.length; c++) {
        const h = combinedHeaders[c];
        if ((h.includes("amount") || h.includes("balance")) && amountCol < 0) amountCol = c;
        if ((h.includes("dr/cr") || h.includes("dr cr") || h === "dr" || h === "cr" || h.includes("type")) && drCrCol < 0) drCrCol = c;
      }

      for (let c = 1; c < combinedHeaders.length; c++) {
        const h = combinedHeaders[c];
        const hasOpening = h.includes("opening");
        const hasClosing = h.includes("closing");
        const debitHeader = isDebitHeader(h);
        const creditHeader = isCreditHeader(h);

        if (hasOpening && debitHeader && colMap.openingDebit < 0) {
          colMap.openingDebit = c;
        } else if (hasOpening && creditHeader && colMap.openingCredit < 0) {
          colMap.openingCredit = c;
        } else if (hasClosing && debitHeader && colMap.closingDebit < 0) {
          colMap.closingDebit = c;
        } else if (hasClosing && creditHeader && colMap.closingCredit < 0) {
          colMap.closingCredit = c;
        } else if (hasOpening && colMap.opening < 0) {
          colMap.opening = c;
        } else if (hasClosing && colMap.closing < 0) {
          colMap.closing = c;
        } else if (!hasOpening && !hasClosing && debitHeader && colMap.txnDebit < 0) {
          colMap.txnDebit = c;
        } else if (!hasOpening && !hasClosing && creditHeader && colMap.txnCredit < 0) {
          colMap.txnCredit = c;
        }
      }

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

    // Auto-detect Amount+Dr/Cr from data
    if (amountCol < 0 && colMap.txnDebit < 0 && colMap.txnCredit < 0 && dataStartRow >= 0) {
      let drCrHits = 0;
      const scanStart = dataStartRow >= 0 ? dataStartRow : 0;
      for (let r = scanStart; r < Math.min(scanStart + 20, rawRows.length); r++) {
        const row = rawRows[r];
        if (!row || !row[0]) continue;
        const colC = String(row[2] || "").trim().toLowerCase().replace(".", "");
        if (colC === "dr" || colC === "cr") drCrHits++;
      }
      if (drCrHits >= 3) {
        isAmountDrCrFormat = true;
        amountCol = 1;
        drCrCol = 2;
        console.log("[parse-tally-tb] Detected Amount + Dr/Cr format from data scan");
      }
    }

    if (amountCol >= 0 && drCrCol >= 0 && colMap.txnDebit < 0 && colMap.txnCredit < 0) {
      isAmountDrCrFormat = true;
      console.log("[parse-tally-tb] Using Amount+Dr/Cr format: amountCol=", amountCol, "drCrCol=", drCrCol);
    }

    // Determine format
    const detectedNumericColumns = [
      colMap.opening, colMap.openingDebit, colMap.openingCredit,
      colMap.txnDebit, colMap.txnCredit, colMap.closing,
      colMap.closingDebit, colMap.closingCredit,
    ].filter((c) => c >= 0);
    const numCols = detectedNumericColumns.length;
    if (isAmountDrCrFormat) {
      detectedFormat = "amount-drcr";
    } else if (colMap.openingDebit >= 0 || colMap.openingCredit >= 0 || colMap.closingDebit >= 0 || colMap.closingCredit >= 0) {
      detectedFormat = "dr-cr-split";
    } else if (numCols >= 4) {
      detectedFormat = "5-column";
    } else if (numCols === 3) {
      detectedFormat = "4-column";
    } else if (numCols === 2) {
      detectedFormat = "3-column";
    }

    // Fallback column detection
    if (dataStartRow < 0) {
      dataStartRow = 0;
      for (let r = 0; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (row && row[0] && String(row[0]).trim().length > 2) {
          dataStartRow = r;
          break;
        }
      }
    }

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

    if (ws) {
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

      if (!name) { skippedRows++; continue; }

      const nameLower = name.toLowerCase();
      if (/\bgrand\s*total\b/i.test(nameLower) || /^total\b/i.test(nameLower) ||
          nameLower === "closing balance" || nameLower.includes("opening balance") || nameLower === "difference in opening") {
        skippedRows++;
        skippedGrandTotal = true;
        continue;
      }

      // ─── CHANGE 2: Use multi-strategy indent detection ───
      const indentFromStyle = isCSV ? 0 : (indentMap[r] || 0);
      const indentFromOutline = isCSV ? 0 : (rowOutlineMap[r] || 0);
      const bold = isCSV ? false : (boldMap[r] || false);
      const italic = isCSV ? false : (italicMap[r] || false);

      const effectiveIndent = getEffectiveIndent(indentFromStyle, indentFromOutline, rawName, isCSV);

      let txnDebit = 0;
      let txnCredit = 0;
      let opening = 0;
      let closing = 0;
      let isLedger = false;

      if (isAmountDrCrFormat) {
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
          txnDebit = 0;
          txnCredit = 0;
          isLedger = true;
        } else {
          txnDebit = 0;
          txnCredit = 0;
          isLedger = false;
        }

        opening = txnDebit - txnCredit;
        closing = opening + txnDebit - txnCredit;

        if (colMap.opening >= 0) opening = parseSignedBalance(row[colMap.opening]);
        if (colMap.closing >= 0) closing = parseSignedBalance(row[colMap.closing]);

        if (!hasDrCrMarker && amount !== 0) {
          opening = 0;
          closing = 0;
        }
      } else {
        const openingDebitCol = colMap.openingDebit >= 0 ? Math.abs(parseNum(row[colMap.openingDebit])) : 0;
        const openingCreditCol = colMap.openingCredit >= 0 ? Math.abs(parseNum(row[colMap.openingCredit])) : 0;
        const closingDebitCol = colMap.closingDebit >= 0 ? Math.abs(parseNum(row[colMap.closingDebit])) : 0;
        const closingCreditCol = colMap.closingCredit >= 0 ? Math.abs(parseNum(row[colMap.closingCredit])) : 0;

        txnDebit = colMap.txnDebit >= 0 ? Math.abs(parseNum(row[colMap.txnDebit])) : 0;
        txnCredit = colMap.txnCredit >= 0 ? Math.abs(parseNum(row[colMap.txnCredit])) : 0;

        const hasSplitOpening = colMap.openingDebit >= 0 || colMap.openingCredit >= 0;
        const hasSplitClosing = colMap.closingDebit >= 0 || colMap.closingCredit >= 0;

        const hasNumericCells = [
          colMap.opening, colMap.openingDebit, colMap.openingCredit,
          colMap.txnDebit, colMap.txnCredit, colMap.closing,
          colMap.closingDebit, colMap.closingCredit,
        ]
          .filter((c) => c >= 0)
          .some((c) => row[c] !== null && row[c] !== undefined && String(row[c]).trim() !== "");

        opening = hasSplitOpening
          ? openingDebitCol - openingCreditCol
          : (colMap.opening >= 0 ? parseSignedBalance(row[colMap.opening]) : (txnDebit - txnCredit));

        closing = hasSplitClosing
          ? closingDebitCol - closingCreditCol
          : (colMap.closing >= 0 ? parseSignedBalance(row[colMap.closing]) : (opening + txnDebit - txnCredit));

        isLedger = hasNumericCells || txnDebit !== 0 || txnCredit !== 0 || opening !== 0 || closing !== 0;
      }

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

    // ─── Build hierarchy tree (indentation-first, formatting-secondary) ───
    const nodes: HierarchyNode[] = [];
    const childCounterByParent = new Map<string, number>();
    const groupRegistry = new Map<string, HierarchyNode>();
    const hasIndentSignals = dataRows.some((r) => r.indent > 0);

    const EPSILON = 0.000001;
    const hasNonZeroValue = (v: number) => Math.abs(v) > EPSILON;

    type StructuredRow = TBRow & {
      level: number;
      isGroupHint: boolean;
      normalizedName: string;
      hasValues: boolean;
    };

    const indentValues = [...new Set(dataRows.map((r) => r.indent).filter((indent) => indent > 0))].sort((a, b) => a - b);
    const indentLevelMap = new Map<number, number>();
    indentValues.forEach((indent, idx) => {
      indentLevelMap.set(indent, idx + 2);
    });

    const structuredRows: StructuredRow[] = [];

    // Pre-compute value-matching hierarchy when no indent signals exist
    const vmResult = hasIndentSignals ? null : detectHierarchyByValueMatching(dataRows);
    if (vmResult) {
      const groupCount = vmResult.isGroup.filter(Boolean).length;
      console.log(`[parse-tally-tb] Value-matching detected ${groupCount} groups out of ${dataRows.length} rows`);
    }

    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index];
      const normalizedName = normalizeGroupName(row.name);
      const knownGroupByName = KNOWN_GROUP_NAMES.has(normalizedName);
      const hasValues =
        hasNonZeroValue(row.opening) ||
        hasNonZeroValue(row.txnDebit) ||
        hasNonZeroValue(row.txnCredit) ||
        hasNonZeroValue(row.closing);

      const nextRow = dataRows.slice(index + 1).find((r) => !!r.name?.trim());
      const hasChildrenByIndent = !!nextRow && nextRow.indent > row.indent;

      let level = 1;
      let isGroupHint = false;

      if (hasIndentSignals) {
        level = row.indent > 0 ? (indentLevelMap.get(row.indent) || row.indent + 1) : 1;
        isGroupHint = hasChildrenByIndent || (!hasValues && !!nextRow) || (knownGroupByName && !hasValues);

        const prev = structuredRows[structuredRows.length - 1];
        if (prev && row.indent === prev.indent && prev.isGroupHint && isGroupHint) {
          const formattingSuggestsChild = (prev.bold && !row.bold) || (!prev.italic && row.italic);
          const primaryParentHint = KNOWN_GROUP_NAMES.has(prev.normalizedName) && !knownGroupByName;
          if (formattingSuggestsChild || primaryParentHint) {
            level = prev.level + 1;
          }
        }
      } else {
        // Formatting fallback when indentation metadata is missing.
        // Key insight: in a Tally TB export without indent signals, we must detect
        // group subtotal rows by checking if the NEXT rows have smaller values.
        const isKnownGroup = KNOWN_GROUP_NAMES.has(normalizedName);

        if (row.bold || isKnownGroup) {
          // Bold rows or known group names are always groups
          level = row.bold ? 1 : 2;
          isGroupHint = true;
        } else if (!hasValues) {
          // Zero-value rows with a next row = group header
          level = 2;
          isGroupHint = true;
        } else {
          // Has values: check if it looks like a subtotal row
          const absClosing = Math.abs(row.closing);
          let looksLikeSubtotal = false;

          // Check next rows: if the FIRST next row with values has closing < this row's closing,
          // this is probably a group subtotal.
          for (let j = index + 1; j < Math.min(index + 8, dataRows.length); j++) {
            const nr = dataRows[j];
            if (!nr.name?.trim()) continue;
            const nrClosing = Math.abs(nr.closing);
            if (nrClosing > 0 && nrClosing < absClosing * 0.98) {
              looksLikeSubtotal = true;
            }
            break; // only check the first non-empty next row
          }

          if (looksLikeSubtotal) {
            level = 2;
            isGroupHint = true;
          } else {
            level = 4;
            isGroupHint = false;
          }
        }

        if (hasChildrenByIndent) {
          isGroupHint = true;
        }
      }

      if (!isGroupHint && !hasValues && !!nextRow) {
        isGroupHint = true;
      }

      structuredRows.push({
        ...row,
        level: Math.max(1, level),
        isGroupHint,
        normalizedName,
        hasValues,
      });
    }

    // ─── CHANGE 3: Anti-duplication filter — strip group subtotal rows ───
    for (let i = 0; i < structuredRows.length; i++) {
      const row = structuredRows[i];
      if (!row.isGroupHint || !row.hasValues) continue;
      // Sum of child rows (next rows at level > current row's level)
      let childSum = 0;
      let childCount = 0;
      for (let j = i + 1; j < structuredRows.length; j++) {
        const child = structuredRows[j];
        if (child.level <= row.level) break;
        if (child.level === row.level + 1) {
          childSum += Math.abs(child.closing);
          childCount++;
        }
      }
      if (childCount > 0 && Math.abs(Math.abs(row.closing) - childSum) < 1) {
        // This row's value matches its children's sum — it's a subtotal, zero it out
        row.opening = 0;
        row.txnDebit = 0;
        row.txnCredit = 0;
        row.closing = 0;
        row.hasValues = false;
      }
    }

    // ─── Anti-duplication pass 2: zero ALL group nodes with values ───
    // When a Tally TB includes group subtotal rows with aggregated values,
    // and we also aggregate from children, we get double-counted totals.
    // Solution: if a row is isGroupHint=true AND still has values, zero them.
    for (const row of structuredRows) {
      if (row.isGroupHint && row.hasValues) {
        row.opening = 0;
        row.txnDebit = 0;
        row.txnCredit = 0;
        row.closing = 0;
        row.hasValues = false;
      }
    }

    // Parent stack using computed levels
    const levelStack: HierarchyNode[] = [];

    for (const row of structuredRows) {
      while (levelStack.length >= row.level) {
        levelStack.pop();
      }

      const parentNode = row.level > 1 ? (levelStack[row.level - 2] || null) : null;

      if (row.isGroupHint) {
        const groupKey = `${parentNode?.nodeId || "root"}::${row.normalizedName}`;
        let groupNode = groupRegistry.get(groupKey) || null;

        if (!groupNode) {
          const parentKey = parentNode?.nodeId || "root";
          const nextIndex = (childCounterByParent.get(parentKey) || 0) + 1;
          childCounterByParent.set(parentKey, nextIndex);

          const nodeId = parentNode ? `${parentNode.nodeId}.${nextIndex}` : String(nextIndex);
          const primaryGroup = parentNode ? parentNode.primaryGroup : row.name;
          const bsPlSide = detectBsPlSide(primaryGroup);
          const normalBal = detectNormalBalance(primaryGroup);

          groupNode = {
            nodeId,
            parentNodeId: parentNode?.nodeId || null,
            level: row.level,
            name: row.name,
            indent: row.indent,
            bold: row.bold,
            italic: row.italic,
            isLeaf: false,
            primaryGroup,
            bsPlSide,
            normalBal,
            opening: 0,
            txnDebit: 0,
            txnCredit: 0,
            closing: 0,
            rowNumber: row.rowNum,
          };

          nodes.push(groupNode);
          groupRegistry.set(groupKey, groupNode);
        } else {
          groupNode.level = Math.min(groupNode.level, row.level);
          groupNode.rowNumber = Math.min(groupNode.rowNumber, row.rowNum);
        }

        levelStack[row.level - 1] = groupNode;
        continue;
      }

      const parentKey = parentNode?.nodeId || "root";
      const nextIndex = (childCounterByParent.get(parentKey) || 0) + 1;
      childCounterByParent.set(parentKey, nextIndex);

      const nodeId = parentNode ? `${parentNode.nodeId}.${nextIndex}` : String(nextIndex);
      const primaryGroup = parentNode ? parentNode.primaryGroup : row.name;
      const bsPlSide = detectBsPlSide(primaryGroup);
      const normalBal = detectNormalBalance(primaryGroup);

      const leafNode: HierarchyNode = {
        nodeId,
        parentNodeId: parentNode?.nodeId || null,
        level: row.level,
        name: row.name,
        indent: row.indent,
        bold: row.bold,
        italic: row.italic,
        isLeaf: true,
        primaryGroup,
        bsPlSide,
        normalBal,
        opening: row.opening,
        txnDebit: row.txnDebit,
        txnCredit: row.txnCredit,
        closing: row.closing,
        rowNumber: row.rowNum,
      };

      nodes.push(leafNode);
      levelStack[row.level - 1] = leafNode;
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

    // ─── CHANGE 4: Post-import validation — 7 integrity checks ───
    const totalDr = leafNodes.reduce((s, n) => s + n.txnDebit, 0);
    const totalCr = leafNodes.reduce((s, n) => s + n.txnCredit, 0);

    const validation = {
      isBalanced: Math.abs(totalDr - totalCr) < 1,
      drTotal: totalDr,
      crTotal: totalCr,
      difference: Math.abs(totalDr - totalCr),
      duplicateNames: findDuplicateNames(leafNodes),
      groupMismatches: checkGroupAggregation(nodes, childrenByParent),
      unclassifiedLeaves: leafNodes.filter(n => n.primaryGroup === n.name && n.bsPlSide === "Unknown").length,
      bsAssets: leafNodes.filter(n => BS_GROUPS_DR.some(g => n.primaryGroup.toLowerCase().includes(g))).reduce((s, n) => s + n.closing, 0),
      bsLiabilities: leafNodes.filter(n => BS_GROUPS_CR.some(g => n.primaryGroup.toLowerCase().includes(g))).reduce((s, n) => s + Math.abs(n.closing), 0),
      grandTotalDetected: skippedGrandTotal,
      primaryGroups: [...new Set(leafNodes.map(n => n.primaryGroup))],
      primaryGroupCount: [...new Set(leafNodes.map(n => n.primaryGroup))].length,
    };

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
        validation,
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
