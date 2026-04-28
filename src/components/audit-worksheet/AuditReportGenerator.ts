/**
 * AuditReportGenerator — Phase 5B
 *
 * Generates a formal Draft Audit Report PDF using jsPDF + jspdf-autotable.
 * Structure:
 *   Page 1  — Cover page (firm, client, FY, engagement details)
 *   Page 2  — Executive Summary (risk-level summary, resolution progress)
 *   Page 3+ — Detailed Findings (one section per finding, grouped by risk)
 *   Final   — Query Resolution Summary (from QuerySheet)
 *
 * Usage:
 *   import { generateAuditReport } from "./AuditReportGenerator";
 *   await generateAuditReport(findings, queries, data);
 */
import type { AuditFinding, FindingRisk, FindingStatus } from "./hooks/useFindingsStorage";
import { RISK_META, STATUS_META }                        from "./hooks/useFindingsStorage";
import type { QueryRow }                                 from "./hooks/useQuerySheetStorage";
import { STATUS_META as Q_STATUS_META }                  from "./hooks/useQuerySheetStorage";
import type { AuditWorksheetData }                       from "./hooks/useAuditWorksheetData";

// ─── Palette ──────────────────────────────────────────────────────────────────

type RGB = [number, number, number];

const C_DARK:   RGB = [26,  39, 68];   // #1a2744
const C_ORANGE: RGB = [220, 90, 20];   // brand orange
const C_WHITE:  RGB = [255, 255, 255];
const C_BODY:   RGB = [50,  50, 60];
const C_MUTED:  RGB = [150, 150, 165];
const C_LIGHT:  RGB = [245, 245, 248];
const C_MID:    RGB = [218, 218, 228];

const RISK_PDF_COLOR: Record<FindingRisk, RGB> = {
  critical:      [200, 30,  30],
  high:          [220, 90,  20],
  medium:        [200, 140,  0],
  low:           [37, 100, 200],
  informational: [120, 120, 130],
};

const STATUS_PDF_COLOR: Record<FindingStatus, RGB> = {
  open:                 [220, 90,  20],
  management_responded: [37, 100, 200],
  reviewed:             [120, 40, 200],
  closed:               [30, 160,  60],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "long", year: "numeric",
    });
  } catch { return iso; }
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

function trunc(s: string, n: number): string {
  return s && s.length > n ? s.slice(0, n - 1) + "…" : (s || "—");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function generateAuditReport(
  findings: AuditFinding[],
  queries:  QueryRow[],
  data:     AuditWorksheetData,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc  = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW   = 210;
  const PH   = 297;
  const ML   = 14;
  const MR   = 14;
  const CW   = PW - ML - MR;

  const todayStr   = fmtDate(new Date().toISOString());
  const fyLabel    = data.financialYear  || "FY —";
  const clientName = data.clientName     || "Client";
  const firmName   = data.firmName       || "Audit Firm";

  const RISK_ORDER: FindingRisk[] = ["critical", "high", "medium", "low", "informational"];
  const groupedByRisk = RISK_ORDER.reduce<Record<FindingRisk, AuditFinding[]>>(
    (acc, r) => ({ ...acc, [r]: findings.filter(f => f.risk_rating === r) }),
    {} as any,
  );

  const openFindings   = findings.filter(f => f.status !== "closed").length;
  const closedFindings = findings.filter(f => f.status === "closed").length;

  // ──────────────────────────────────────────────────────────────────────────
  // PAGE 1 — COVER
  // ──────────────────────────────────────────────────────────────────────────

  // Full-height dark sidebar
  doc.setFillColor(...C_DARK);
  doc.rect(0, 0, 58, PH, "F");

  // Orange accent bar on sidebar
  doc.setFillColor(...C_ORANGE);
  doc.rect(0, 0, 6, PH, "F");

  // Sidebar text (rotated)
  doc.setTextColor(...C_WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("CONFIDENTIAL — DRAFT", 29, PH - 12, { angle: 90, align: "center" });

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(firmName, 29, 30, { angle: 90, align: "center" });

  // Main area
  doc.setFillColor(...C_WHITE);
  doc.rect(58, 0, PW - 58, PH, "F");

  // Report label
  const rx = 68;
  doc.setTextColor(...C_ORANGE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setCharSpace(2);
  doc.text("AUDIT REPORT", rx, 48);
  doc.setCharSpace(0);

  // Title
  doc.setTextColor(...C_DARK);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize("Draft Audit Report", PW - rx - MR);
  doc.text(titleLines, rx, 60);

  // FY subtitle
  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C_MUTED);
  doc.text(`Financial Year ${fyLabel}`, rx, 80);

  // Divider
  doc.setDrawColor(...C_ORANGE);
  doc.setLineWidth(0.7);
  doc.line(rx, 88, PW - MR, 88);

  // Client section
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C_MUTED);
  doc.text("PREPARED FOR", rx, 100);

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C_DARK);
  doc.text(clientName, rx, 110);

  if (data.client?.pan) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text(`PAN: ${data.client.pan}`, rx, 118);
  }

  if (data.entityType) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text(data.entityType, rx, data.client?.pan ? 125 : 118);
  }

  // Audit firm box
  doc.setFillColor(...C_LIGHT);
  doc.roundedRect(rx, 140, CW - (rx - ML), 40, 3, 3, "F");

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C_MUTED);
  doc.text("PREPARED BY", rx + 6, 151);

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C_DARK);
  doc.text(firmName, rx + 6, 160);

  if (data.auditFirm?.partner_name) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_BODY);
    doc.text(`Partner: ${data.auditFirm.partner_name}`, rx + 6, 167);
  }
  if (data.auditFirm?.icai_reg_no) {
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text(`ICAI Reg. No.: ${data.auditFirm.icai_reg_no}`, rx + 6, 173);
  }

  // Report date
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C_MUTED);
  doc.text("REPORT DATE", rx, 200);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C_DARK);
  doc.text(todayStr, rx, 208);

  // Findings summary chips at bottom of cover
  const chipY  = PH - 50;
  const chipW  = (CW - (rx - ML) - 12) / 5;
  const chipX0 = rx;
  RISK_ORDER.forEach((r, i) => {
    const cnt = groupedByRisk[r].length;
    const col = RISK_PDF_COLOR[r];
    doc.setFillColor(...col);
    doc.roundedRect(chipX0 + i * (chipW + 3), chipY, chipW, 18, 2, 2, "F");
    doc.setTextColor(...C_WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(String(cnt), chipX0 + i * (chipW + 3) + chipW / 2, chipY + 11, { align: "center" });
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.text(RISK_META[r].label.toUpperCase(), chipX0 + i * (chipW + 3) + chipW / 2, chipY + 16, { align: "center" });
  });

  doc.setFontSize(7.5);
  doc.setTextColor(...C_MUTED);
  doc.text("This report is confidential and intended solely for the use of the management of the above entity.",
    rx, PH - 8);

  // ──────────────────────────────────────────────────────────────────────────
  // PAGE 2 — EXECUTIVE SUMMARY
  // ──────────────────────────────────────────────────────────────────────────

  doc.addPage();
  _pageHeader(doc, "Executive Summary", firmName, clientName, fyLabel, PW, ML, MR);

  let y = 30;

  // Section title
  y = _sectionTitle(doc, "Audit Scope & Overview", ML, y, CW);

  // Scope paragraph
  const scopeText =
    `This report presents the findings arising from the ${data.auditTypeLabel || "audit"} of ${clientName} ` +
    `for the financial year ${fyLabel}. The audit was conducted in accordance with applicable auditing standards ` +
    `and was designed to obtain reasonable assurance on the accuracy and completeness of the financial statements.`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C_BODY);
  const scopeLines = doc.splitTextToSize(scopeText, CW);
  doc.text(scopeLines, ML, y);
  y += scopeLines.length * 4.5 + 8;

  // Summary stats row
  y = _sectionTitle(doc, "Summary of Findings", ML, y, CW);

  const stats: [string, string | number, RGB][] = [
    ["Total Findings",   findings.length,  C_DARK],
    ["Open",             openFindings,     [220, 90, 20]],
    ["Closed",           closedFindings,   [30, 160, 60]],
    ["Critical / High",  (groupedByRisk.critical.length + groupedByRisk.high.length), [200, 30, 30]],
  ];
  const sw = CW / stats.length - 3;
  stats.forEach(([label, val, col], i) => {
    const bx = ML + i * (sw + 4);
    doc.setFillColor(...C_LIGHT);
    doc.roundedRect(bx, y, sw, 22, 2, 2, "F");
    doc.setFillColor(...col);
    doc.roundedRect(bx, y, 4, 22, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...col);
    doc.text(String(val), bx + sw / 2 + 2, y + 13, { align: "center" });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text(label, bx + sw / 2 + 2, y + 20, { align: "center" });
  });
  y += 30;

  // Risk distribution table
  y = _sectionTitle(doc, "Risk Distribution", ML, y, CW);

  autoTable(doc, {
    startY: y,
    head:   [["Risk Level", "Count", "Open", "Closed", "% of Total"]],
    body: RISK_ORDER.map(r => {
      const fs  = groupedByRisk[r];
      const tot = findings.length || 1;
      return [
        RISK_META[r].label,
        fs.length,
        fs.filter(f => f.status !== "closed").length,
        fs.filter(f => f.status === "closed").length,
        `${Math.round((fs.length / tot) * 100)}%`,
      ];
    }),
    styles:     { fontSize: 9, cellPadding: 3, textColor: C_BODY },
    headStyles: { fillColor: C_DARK, textColor: C_WHITE, fontStyle: "bold" },
    alternateRowStyles: { fillColor: C_LIGHT },
    columnStyles: {
      0: { cellWidth: 36 },
      1: { cellWidth: 22, halign: "center" },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 22, halign: "center" },
      4: { cellWidth: 26, halign: "center" },
    },
    margin: { left: ML, right: MR },
    didParseCell(h) {
      if (h.section === "body" && h.column.index === 0) {
        const r = RISK_ORDER[h.row.index];
        if (r) h.cell.styles.textColor = RISK_PDF_COLOR[r];
        h.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: (h) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
  });

  y = (doc as any).lastAutoTable.finalY + 14;

  // Status distribution
  if (y > PH - 80) { doc.addPage(); _pageHeader(doc, "Executive Summary (cont.)", firmName, clientName, fyLabel, PW, ML, MR); y = 30; }

  y = _sectionTitle(doc, "Status Overview", ML, y, CW);

  autoTable(doc, {
    startY: y,
    head:   [["Status", "Count"]],
    body:   (Object.keys(STATUS_META) as FindingStatus[]).map(s => [
      STATUS_META[s].label,
      findings.filter(f => f.status === s).length,
    ]),
    styles:     { fontSize: 9, cellPadding: 3, textColor: C_BODY },
    headStyles: { fillColor: C_DARK, textColor: C_WHITE, fontStyle: "bold" },
    alternateRowStyles: { fillColor: C_LIGHT },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 25, halign: "center" },
    },
    margin: { left: ML, right: MR },
    didParseCell(h) {
      if (h.section === "body" && h.column.index === 1) {
        const s = (Object.keys(STATUS_META) as FindingStatus[])[h.row.index];
        if (s) h.cell.styles.textColor = STATUS_PDF_COLOR[s];
        h.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: (h) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PAGES 3+ — DETAILED FINDINGS (grouped by risk)
  // ──────────────────────────────────────────────────────────────────────────

  const risksToPrint = RISK_ORDER.filter(r => groupedByRisk[r].length > 0);

  for (const risk of risksToPrint) {
    const group = groupedByRisk[risk];
    doc.addPage();
    _pageHeader(doc, `${RISK_META[risk].label} Risk Findings`, firmName, clientName, fyLabel, PW, ML, MR);
    let fy = 30;

    // Risk section banner
    doc.setFillColor(...RISK_PDF_COLOR[risk]);
    doc.roundedRect(ML, fy, CW, 10, 2, 2, "F");
    doc.setTextColor(...C_WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(
      `${RISK_META[risk].label.toUpperCase()} RISK — ${group.length} Finding${group.length > 1 ? "s" : ""}`,
      ML + 4, fy + 7,
    );
    fy += 16;

    for (const finding of group) {
      // Check page space
      if (fy > PH - 80) {
        doc.addPage();
        _pageHeader(doc, `${RISK_META[risk].label} Risk Findings (cont.)`, firmName, clientName, fyLabel, PW, ML, MR);
        fy = 30;
      }

      // Finding card header
      doc.setFillColor(...C_LIGHT);
      doc.roundedRect(ML, fy, CW, 12, 2, 2, "F");
      doc.setFillColor(...RISK_PDF_COLOR[risk]);
      doc.roundedRect(ML, fy, 5, 12, 2, 2, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...C_DARK);
      doc.text(`${finding.finding_no}  ${trunc(finding.title, 70)}`, ML + 9, fy + 8);

      // Status badge (top right)
      const stMeta = STATUS_META[finding.status];
      doc.setFontSize(7);
      doc.setTextColor(...STATUS_PDF_COLOR[finding.status]);
      doc.text(stMeta.label.toUpperCase(), PW - MR - 2, fy + 8, { align: "right" });

      fy += 16;

      // Category + raised date
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(...C_MUTED);
      doc.text(
        `Category: ${finding.category || "—"}   ·   Raised: ${fmtShortDate(finding.raised_at)}${
          finding.target_date ? `   ·   Target: ${fmtShortDate(finding.target_date)}` : ""
        }`,
        ML, fy,
      );
      fy += 7;

      // Fields to print
      const fields: [string, string][] = [];
      if (finding.observation)         fields.push(["Observation",     finding.observation]);
      if (finding.criteria)            fields.push(["Criteria",        finding.criteria]);
      if (finding.impact)              fields.push(["Impact / Effect",  finding.impact]);
      if (finding.root_cause)          fields.push(["Root Cause",      finding.root_cause]);
      if (finding.recommendation)      fields.push(["Recommendation",  finding.recommendation]);
      if (finding.management_response) fields.push(["Mgmt. Response",  finding.management_response]);
      if (finding.action_plan)         fields.push(["Action Plan",     finding.action_plan]);

      for (const [label, text] of fields) {
        if (fy > PH - 40) {
          doc.addPage();
          _pageHeader(doc, `${RISK_META[risk].label} Risk Findings (cont.)`, firmName, clientName, fyLabel, PW, ML, MR);
          fy = 30;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...C_DARK);
        doc.text(label + ":", ML, fy);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...C_BODY);
        const lines = doc.splitTextToSize(text, CW - 5);
        doc.text(lines, ML + 5, fy + 5);
        fy += lines.length * 4.2 + 8;
      }

      // Divider
      doc.setDrawColor(...C_MID);
      doc.setLineWidth(0.3);
      doc.line(ML, fy, ML + CW, fy);
      fy += 8;
    }

    _pageFooter(doc, doc.getNumberOfPages(), PW, PH, todayStr);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FINAL PAGE — Query Resolution Summary
  // ──────────────────────────────────────────────────────────────────────────

  if (queries.length > 0) {
    doc.addPage();
    _pageHeader(doc, "Query Resolution Summary", firmName, clientName, fyLabel, PW, ML, MR);

    const resolved  = queries.filter(q => q.query_status === "resolved").length;
    const total     = queries.length;
    const rate      = total > 0 ? Math.round((resolved / total) * 100) : 0;

    let qy = 30;
    qy = _sectionTitle(doc, `Query Sheet — ${total} Queries (${rate}% resolved)`, ML, qy, CW);

    autoTable(doc, {
      startY: qy,
      head:   [["Sr.", "Group", "Ledger / Particulars", "Status", "Priority", "Due Date"]],
      body: queries.map((q, i) => [
        i + 1,
        trunc(q.head        || "—", 20),
        trunc(q.particulars || "—", 24),
        Q_STATUS_META[q.query_status]?.label || q.query_status,
        q.priority || "—",
        q.due_date ? fmtShortDate(q.due_date) : "—",
      ]),
      styles:     { fontSize: 8, cellPadding: 2.5, textColor: C_BODY },
      headStyles: { fillColor: C_DARK, textColor: C_WHITE, fontStyle: "bold" },
      alternateRowStyles: { fillColor: C_LIGHT },
      columnStyles: {
        0: { cellWidth: 8,  halign: "center" },
        1: { cellWidth: 30 },
        2: { cellWidth: 40 },
        3: { cellWidth: 30 },
        4: { cellWidth: 18, halign: "center" },
        5: { cellWidth: 22, halign: "center" },
      },
      margin: { left: ML, right: MR },
      didParseCell(h) {
        if (h.section === "body" && h.column.index === 3) {
          const status = Object.keys(Q_STATUS_META).find(
            s => Q_STATUS_META[s as keyof typeof Q_STATUS_META]?.label === h.cell.raw,
          );
          if (status === "resolved") h.cell.styles.textColor = [30, 160, 60];
          else if (status === "escalated") h.cell.styles.textColor = [200, 30, 30];
          h.cell.styles.fontStyle = "bold";
        }
      },
      didDrawPage: (h) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
    });
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`DraftAuditReport_${safe(clientName)}_${safe(fyLabel)}.pdf`);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function _pageHeader(
  doc: InstanceType<typeof import("jspdf").jsPDF>,
  title: string,
  firm: string,
  client: string,
  fy: string,
  PW: number,
  ML: number,
  MR: number,
): void {
  doc.setFillColor(...C_DARK);
  doc.rect(0, 0, PW, 16, "F");
  doc.setFillColor(...C_ORANGE);
  doc.rect(0, 0, 5, 16, "F");
  doc.setTextColor(...C_WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(title, ML, 10.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`${client}  ·  ${firm}  ·  ${fy}`, PW - MR, 10.5, { align: "right" });
}

function _pageFooter(
  doc: InstanceType<typeof import("jspdf").jsPDF>,
  page: number,
  PW: number,
  PH: number,
  date: string,
): void {
  doc.setFontSize(7);
  doc.setTextColor(...C_MUTED);
  doc.text(
    `Draft Audit Report  ·  Page ${page}  ·  Generated ${date}  ·  Confidential`,
    PW / 2, PH - 5, { align: "center" },
  );
}

function _sectionTitle(
  doc: InstanceType<typeof import("jspdf").jsPDF>,
  title: string,
  x: number,
  y: number,
  _cw: number,
): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C_DARK);
  doc.text(title, x, y);
  doc.setDrawColor(...C_ORANGE);
  doc.setLineWidth(0.6);
  doc.line(x, y + 1.5, x + 60, y + 1.5);
  doc.setDrawColor(...C_MID);
  doc.setLineWidth(0.2);
  doc.line(x + 60, y + 1.5, x + _cw, y + 1.5);
  return y + 9;
}
