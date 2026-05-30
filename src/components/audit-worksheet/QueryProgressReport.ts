/**
 * QueryProgressReport — Phase 4E
 *
 * Generates a formatted A4 PDF "Audit Query Progress Report" using
 * jsPDF + jspdf-autotable (both already in package.json).
 *
 * Pages:
 *   1. Cover page  — firm name, client, financial year, generated date
 *   2. Summary     — pipeline funnel counts + a mini status bar chart
 *   3. Query table — Sr, Group, Ledger, Description (truncated), Status,
 *                    Priority, Due Date
 *
 * Usage:
 *   import { generateQueryProgressReport } from "./QueryProgressReport";
 *   await generateQueryProgressReport(queries, data);
 */
import type { QueryRow, QueryStatus } from "./hooks/useQuerySheetStorage";
import type { AuditWorksheetData }    from "./hooks/useAuditWorksheetData";

// ─── Colour / meta constants ───────────────────────────────────────────────────

const BRAND_ORANGE = [230, 90, 30]   as [number,number,number];  // #e65a1e ≈ orange-600
const BRAND_DARK   = [26,  39, 68]   as [number,number,number];  // #1a2744
const GREY_LIGHT   = [245, 245, 248] as [number,number,number];
const GREY_MID     = [210, 210, 218] as [number,number,number];
const TEXT_BODY    = [50,  50,  60]  as [number,number,number];

const STATUS_COLORS: Record<QueryStatus, [number,number,number]> = {
  draft:             [180, 183, 195],
  raised:            [59,  130, 246],  // blue-500
  dispatched:        [245, 158,  11],  // amber-500
  response_received: [139,  92, 246],  // violet-500
  resolved:          [34,  197,  94],  // green-500
  escalated:         [239,  68,  68],  // red-500
};

const STATUS_LABELS: Record<QueryStatus, string> = {
  draft:             "Draft",
  raised:            "Raised",
  dispatched:        "Dispatched",
  response_received: "Reply Received",
  resolved:          "Resolved",
  escalated:         "Escalated",
};

const PRIORITY_COLORS: Record<string, [number,number,number]> = {
  High:   [239, 68, 68],
  Medium: [245, 158, 11],
  Low:    [34, 197, 94],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

function truncate(str: string, len: number): string {
  if (!str) return "—";
  return str.length > len ? str.slice(0, len - 1) + "…" : str;
}

/** Convert [r,g,b] to hex string for jsPDF setFillColor etc. */
function rgb(c: [number,number,number]): string {
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateQueryProgressReport(
  queries: QueryRow[],
  data:    AuditWorksheetData,
): Promise<void> {
  // Dynamic import so it doesn't bloat initial bundle
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210; // page width mm
  const PH = 297; // page height mm
  const ML = 14;  // margin left
  const MR = 14;  // margin right
  const CW = PW - ML - MR; // content width

  // ── Status summary counts ────────────────────────────────────────────────────
  const total = queries.length;
  const counts: Record<QueryStatus, number> = {
    draft: 0, raised: 0, dispatched: 0,
    response_received: 0, resolved: 0, escalated: 0,
  };
  for (const q of queries) counts[q.query_status] = (counts[q.query_status] ?? 0) + 1;

  const responseRate = total > 0
    ? Math.round(((counts.resolved + counts.response_received) / total) * 100)
    : 0;

  const todayStr = new Date().toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });

  // ════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER
  // ════════════════════════════════════════════════════════════════

  // Header band
  doc.setFillColor(...BRAND_DARK);
  doc.rect(0, 0, PW, 42, "F");

  // Firm name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(data.firmName || "Audit Firm", ML, 16);

  // Report title
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Audit Query Progress Report", ML, 28);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Confidential — For Internal Audit Use Only", ML, 36);

  // Orange accent stripe under header
  doc.setFillColor(...BRAND_ORANGE);
  doc.rect(0, 42, PW, 3, "F");

  // Client info card
  let y = 60;
  doc.setFillColor(...GREY_LIGHT);
  doc.roundedRect(ML, y, CW, 50, 3, 3, "F");

  doc.setTextColor(...TEXT_BODY);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  const infoItems: [string, string][] = [
    ["Client",         data.clientName   || "—"],
    ["Financial Year", data.financialYear || "—"],
    ["Firm",           data.firmName      || "—"],
    ["Report Date",    todayStr],
    ["Total Queries",  String(total)],
    ["Resolution",     `${responseRate}% (${counts.resolved} resolved of ${total})`],
  ];

  infoItems.forEach(([label, value], i) => {
    const col  = i % 2;
    const row  = Math.floor(i / 2);
    const ix   = ML + 6 + col * (CW / 2);
    const iy   = y + 10 + row * 15;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BRAND_DARK);
    doc.text(label + ":", ix, iy);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_BODY);
    doc.text(value, ix + 32, iy);
  });

  // ── Status funnel summary ────────────────────────────────────────────────────
  y = 124;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_DARK);
  doc.text("Query Pipeline Summary", ML, y);

  // Divider
  doc.setDrawColor(...BRAND_ORANGE);
  doc.setLineWidth(0.6);
  doc.line(ML, y + 2, ML + 80, y + 2);

  y += 10;
  const FUNNEL: QueryStatus[] = [
    "draft", "raised", "dispatched", "response_received", "resolved", "escalated",
  ];
  const barH     = 7;
  const barGap   = 3;
  const barTotal = total || 1;

  FUNNEL.forEach(s => {
    const cnt = counts[s];
    const pct = cnt / barTotal;
    const col = STATUS_COLORS[s];

    // Label
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_BODY);
    doc.text(STATUS_LABELS[s], ML, y + barH - 1.5);

    // Background track
    doc.setFillColor(...GREY_MID);
    doc.roundedRect(ML + 38, y, CW - 50, barH, 1.5, 1.5, "F");

    // Fill bar
    if (cnt > 0) {
      doc.setFillColor(...col);
      doc.roundedRect(ML + 38, y, Math.max(4, (CW - 50) * pct), barH, 1.5, 1.5, "F");
    }

    // Count badge
    doc.setFillColor(...(cnt > 0 ? col : GREY_MID));
    doc.roundedRect(PW - MR - 12, y, 12, barH, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text(String(cnt), PW - MR - 6, y + barH - 2, { align: "center" });

    y += barH + barGap;
  });

  // ── Resolution ring (simple arc drawn via text) ──────────────────────────────
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_DARK);

  // Big percent
  doc.setFontSize(32);
  doc.setTextColor(...(
    responseRate >= 70 ? [22, 163, 74] as [number,number,number]
    : responseRate >= 40 ? [217, 119, 6] as [number,number,number]
    : [220, 38, 38] as [number,number,number]
  ));
  doc.text(`${responseRate}%`, PW / 2, y + 14, { align: "center" });
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_BODY);
  doc.text("Resolution Rate", PW / 2, y + 22, { align: "center" });

  // ── Footer ───────────────────────────────────────────────────────────────────
  doc.setFontSize(7.5);
  doc.setTextColor(160, 160, 170);
  doc.text(
    `Generated by CAFlow on ${todayStr} · Confidential`,
    PW / 2, PH - 8, { align: "center" },
  );

  // ════════════════════════════════════════════════════════════════
  // PAGE 2 — QUERY TABLE
  // ════════════════════════════════════════════════════════════════

  if (total > 0) {
    doc.addPage();

    // Page header
    doc.setFillColor(...BRAND_DARK);
    doc.rect(0, 0, PW, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Query Detail Table", ML, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`${total} queries  ·  ${data.clientName || ""}  ·  ${data.financialYear || ""}`, PW - MR, 12, { align: "right" });

    // Orange stripe
    doc.setFillColor(...BRAND_ORANGE);
    doc.rect(0, 18, PW, 2, "F");

    // Table
    // Description is intentionally NOT hard-truncated — autoTable's
    // `overflow: "linebreak"` wraps the full text into multiple lines so the
    // auditor sees the complete query instead of "Clarify why both Sales GST
    // and Sales IGST are b…". Group/Ledger still get a soft cap because their
    // columns are narrow and a wrap would push every row to 2-3 lines.
    const tableRows = queries.map((q, i) => [
      String(i + 1),
      truncate(q.head        || "—", 22),
      truncate(q.particulars || "—", 22),
      q.query_description || "—",
      STATUS_LABELS[q.query_status],
      q.priority || "Medium",
      q.due_date ? fmtDate(q.due_date) : "—",
    ]);

    autoTable(doc, {
      startY:        24,
      head: [[
        "Sr.", "Group", "Ledger", "Description",
        "Status", "Priority", "Due Date",
      ]],
      body: tableRows,
      styles: {
        fontSize:  7.5,
        cellPadding: 2.5,
        overflow: "linebreak",
        textColor: TEXT_BODY,
      },
      headStyles: {
        fillColor:  BRAND_DARK,
        textColor:  [255, 255, 255],
        fontStyle:  "bold",
        fontSize:   8,
        cellPadding: 3,
      },
      alternateRowStyles: {
        fillColor: GREY_LIGHT,
      },
      columnStyles: {
        0: { cellWidth: 8,   halign: "center" },
        1: { cellWidth: 26 },
        2: { cellWidth: 26 },
        // Description widened + uses "auto" so autoTable fills any leftover
        // content width before wrapping — full query text is preserved across
        // multiple lines instead of being cut off mid-sentence.
        3: { cellWidth: "auto", minCellWidth: 60 },
        4: { cellWidth: 22 },
        5: { cellWidth: 16, halign: "center" },
        6: { cellWidth: 20, halign: "center" },
      },
      margin: { left: ML, right: MR },
      didParseCell(hookData) {
        // Colour Status column
        if (hookData.section === "body" && hookData.column.index === 4) {
          const status = (Object.keys(STATUS_LABELS) as QueryStatus[]).find(
            s => STATUS_LABELS[s] === hookData.cell.raw,
          );
          if (status) {
            hookData.cell.styles.textColor = STATUS_COLORS[status];
            hookData.cell.styles.fontStyle  = "bold";
          }
        }
        // Colour Priority column
        if (hookData.section === "body" && hookData.column.index === 5) {
          const p = String(hookData.cell.raw);
          if (PRIORITY_COLORS[p]) {
            hookData.cell.styles.textColor = PRIORITY_COLORS[p];
            hookData.cell.styles.fontStyle  = "bold";
          }
        }
      },
      // Page footer on every page
      didDrawPage(hookData) {
        const pg = hookData.pageNumber;
        doc.setFontSize(7.5);
        doc.setTextColor(160, 160, 170);
        doc.text(
          `Page ${pg}  ·  CAFlow Audit Query Report  ·  ${todayStr}`,
          PW / 2, PH - 5, { align: "center" },
        );
      },
    });
  }

  // ── Download ─────────────────────────────────────────────────────────────────
  const safeName  = (data.clientName || "Client").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeFY    = (data.financialYear || "FY").replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`AuditQueryReport_${safeName}_${safeFY}.pdf`);
}
