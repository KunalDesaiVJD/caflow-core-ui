/**
 * TdsReportGenerator — Phase TDS-5
 *
 * Generates a formal TDS Analytics & Reconciliation Report PDF
 * using jsPDF + jspdf-autotable (dynamic imports to keep bundle lean).
 *
 * Structure:
 *   Page 1  — Cover (teal sidebar, client, FY, summary chips)
 *   Page 2  — Executive Summary (goals table, mapping status, exposure)
 *   Page 3+ — Goal 1: Existence Flags (Books ↔ TDS)
 *   Page N+ — Goal 2: Rate Analysis Flags (short / over deduction)
 *   Page M+ — Goal 3: Missing TDS Obligations
 *   Final   — Action Status Summary
 */

import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportInput {
  clientId:      string;
  financialYear: string;
}

interface ClientRow {
  name:            string | null;
  entity_type:     string | null;
  business_activity: string | null;
}

type RGB = [number, number, number];

// ─── Palette ──────────────────────────────────────────────────────────────────

const C_TEAL:   RGB = [15,  118, 110];   // teal-700  #0f766e
const C_TEAL_L: RGB = [20,  184, 166];   // teal-500  #14b8a6
const C_DARK:   RGB = [15,   23,  42];   // slate-900 #0f172a
const C_WHITE:  RGB = [255, 255, 255];
const C_BODY:   RGB = [51,   65,  85];   // slate-700
const C_MUTED:  RGB = [148, 163, 184];   // slate-400
const C_LIGHT:  RGB = [241, 245, 249];   // slate-100
const C_RED:    RGB = [220,  38,  38];   // red-600
const C_AMBER:  RGB = [217, 119,   6];   // amber-600
const C_BLUE:   RGB = [37,  99,  235];   // blue-600
const C_GREEN:  RGB = [22,  163,  74];   // green-600
const C_PURPLE: RGB = [124,  58, 237];   // violet-600

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "long", year: "numeric",
    });
  } catch { return iso; }
}

function fmtINR(n?: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000)       return `₹${(n / 1_000).toFixed(1)} K`;
  return `₹${n.toFixed(0)}`;
}

function trunc(s: string | null | undefined, n: number): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function pct(n?: number | null): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Page chrome helpers ──────────────────────────────────────────────────────

function _pageHeader(
  doc: any,
  title: string,
  clientName: string,
  fyLabel: string,
  PW: number, ML: number, MR: number,
) {
  doc.setFillColor(...C_TEAL);
  doc.rect(0, 0, PW, 14, "F");
  doc.setFillColor(...C_TEAL_L);
  doc.rect(0, 0, PW, 3, "F");
  doc.setTextColor(...C_WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(title, ML, 9.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`${clientName}  ·  FY ${fyLabel}`, PW - MR, 9.5, { align: "right" });
}

function _pageFooter(doc: any, pageNum: number, PW: number, PH: number, todayStr: string) {
  doc.setFillColor(...C_LIGHT);
  doc.rect(0, PH - 10, PW, 10, "F");
  doc.setFontSize(7);
  doc.setTextColor(...C_MUTED);
  doc.setFont("helvetica", "normal");
  doc.text("TDS Analytics & Reconciliation Report  ·  Confidential", 14, PH - 3.5);
  doc.text(`Page ${pageNum}  ·  Generated ${todayStr}`, PW - 14, PH - 3.5, { align: "right" });
}

function _sectionTitle(doc: any, title: string, x: number, y: number, CW: number): number {
  doc.setFillColor(...C_TEAL);
  doc.rect(x, y, 3, 5, "F");
  doc.setTextColor(...C_TEAL);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(title, x + 6, y + 4.5);
  doc.setDrawColor(...C_MUTED);
  doc.setLineWidth(0.2);
  doc.line(x, y + 7, x + CW, y + 7);
  return y + 12;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateTdsReport(input: ReportInput): Promise<void> {
  const { clientId, financialYear } = input;

  // ── 1. Fetch all data ──
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const [clientRes, flagsRes, mappingsRes] = await Promise.all([
    (supabase as any).from("clients").select("name,entity_type,business_activity").eq("id", clientId).maybeSingle(),
    (supabase as any)
      .from("tds_recon_flags")
      .select("*")
      .eq("client_id", clientId)
      .eq("financial_year", financialYear)
      .order("goal_number")
      .order("ai_confidence", { ascending: false }),
    (supabase as any)
      .from("tds_tb_party_mappings")
      .select("*")
      .eq("client_id", clientId)
      .eq("financial_year", financialYear),
  ]);

  const client: ClientRow   = clientRes.data   ?? { name: null, entity_type: null, business_activity: null };
  const flags:  any[]       = flagsRes.data     ?? [];
  const mappings: any[]     = mappingsRes.data  ?? [];

  const clientName = client.name || "Client";
  const fyLabel    = financialYear;
  const todayStr   = fmtDate(new Date().toISOString());

  // ── 2. Derived counts ──
  const goal1Flags   = flags.filter(f => f.goal_number === 1);
  const goal2Flags   = flags.filter(f => f.goal_number === 2);
  const goal3Flags   = flags.filter(f => f.goal_number === 3 || f.flag_type === "missing_tds_obligation");

  const pendingFlags = flags.filter(f => f.flag_status === "pending").length;
  const raisedFlags  = flags.filter(f => f.flag_status === "query_raised").length;
  const acceptedFlags= flags.filter(f => f.flag_status === "accepted").length;
  const disregardedF = flags.filter(f => f.flag_status === "disregarded").length;

  const confirmedMaps = mappings.filter(m => m.mapping_status === "confirmed").length;
  const pendingMaps   = mappings.filter(m => m.mapping_status === "pending").length;
  const rejectedMaps  = mappings.filter(m => m.mapping_status === "rejected").length;

  const totalExposure = goal3Flags
    .filter(f => f.flag_status !== "disregarded")
    .reduce((s, f) => s + (f.expected_tds ?? 0), 0);

  const shortDeductionVariance = goal2Flags
    .filter(f => f.flag_type === "short_deduction" && f.flag_status !== "disregarded")
    .reduce((s, f) => s + Math.abs(f.variance_amount ?? 0), 0);

  // ── 3. Build PDF ──
  const doc  = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW   = 210;
  const PH   = 297;
  const ML   = 14;
  const MR   = 14;
  const CW   = PW - ML - MR;

  // ────────────────────────────────────────────────────────────────────────────
  // PAGE 1 — COVER
  // ────────────────────────────────────────────────────────────────────────────

  // Full-height teal sidebar
  doc.setFillColor(...C_TEAL);
  doc.rect(0, 0, 55, PH, "F");

  // Lighter teal accent strip
  doc.setFillColor(...C_TEAL_L);
  doc.rect(0, 0, 5, PH, "F");

  // Sidebar rotated text
  doc.setTextColor(...C_WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("CONFIDENTIAL  ·  FOR INTERNAL USE", 27, PH - 12, { angle: 90, align: "center" });

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text("CAFlow — TDS Analytics", 27, 28, { angle: 90, align: "center" });

  // Main area (white)
  doc.setFillColor(...C_WHITE);
  doc.rect(55, 0, PW - 55, PH, "F");

  const rx = 65;

  // Module label
  doc.setTextColor(...C_TEAL);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setCharSpace(2.5);
  doc.text("TDS ANALYTICS & RECONCILIATION", rx, 46);
  doc.setCharSpace(0);

  // Title
  doc.setTextColor(...C_DARK);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize("TDS Reconciliation Report", PW - rx - MR);
  doc.text(titleLines, rx, 57);

  // FY subtitle
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C_MUTED);
  doc.text(`Financial Year ${fyLabel}`, rx, 75);

  // Divider
  doc.setDrawColor(...C_TEAL);
  doc.setLineWidth(0.6);
  doc.line(rx, 82, PW - MR, 82);

  // Client section
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C_MUTED);
  doc.text("PREPARED FOR", rx, 94);

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C_DARK);
  doc.text(trunc(clientName, 38), rx, 104);

  if (client.entity_type) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text(client.entity_type, rx, 112);
  }
  if (client.business_activity) {
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text(trunc(client.business_activity, 50), rx, client.entity_type ? 119 : 112);
  }

  // Summary chips near bottom of cover
  const chipY = PH - 72;
  const chips: [string, string, RGB][] = [
    ["Total Flags",      String(flags.length),                  C_TEAL],
    ["Pending",          String(pendingFlags),                  C_AMBER],
    ["Exposure (Est.)",  fmtINR(totalExposure),                 C_RED],
    ["Mappings",         String(mappings.length),               C_BLUE],
    ["Actioned",         String(raisedFlags + acceptedFlags + disregardedF), C_GREEN],
  ];
  const cw5 = (PW - rx - MR - 12) / chips.length;
  chips.forEach(([label, val, col], i) => {
    const bx = rx + i * (cw5 + 3);
    doc.setFillColor(...col);
    doc.roundedRect(bx, chipY, cw5, 22, 2, 2, "F");
    doc.setTextColor(...C_WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(trunc(val, 10), bx + cw5 / 2, chipY + 12, { align: "center" });
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    doc.text(label.toUpperCase(), bx + cw5 / 2, chipY + 18.5, { align: "center" });
  });

  doc.setFontSize(7);
  doc.setTextColor(...C_MUTED);
  doc.text("This report is confidential. Generated by CAFlow automated TDS reconciliation engine.", rx, PH - 10);
  doc.text(todayStr, rx, PH - 5);

  // ────────────────────────────────────────────────────────────────────────────
  // PAGE 2 — EXECUTIVE SUMMARY
  // ────────────────────────────────────────────────────────────────────────────

  doc.addPage();
  _pageHeader(doc, "Executive Summary", clientName, fyLabel, PW, ML, MR);

  let y = 22;

  // Goals overview
  y = _sectionTitle(doc, "Reconciliation Goals Overview", ML, y, CW);

  autoTable(doc, {
    startY: y,
    head:   [["Goal", "Description", "Flags Found", "Pending", "Actioned"]],
    body: [
      [
        "Goal 1 — Existence",
        "Transactions present in books but absent in TDS records (and vice versa)",
        goal1Flags.length,
        goal1Flags.filter(f => f.flag_status === "pending").length,
        goal1Flags.filter(f => f.flag_status !== "pending").length,
      ],
      [
        "Goal 2 — Rate Analysis",
        "Short deductions or over deductions vs. applicable IT Act rates",
        goal2Flags.length,
        goal2Flags.filter(f => f.flag_status === "pending").length,
        goal2Flags.filter(f => f.flag_status !== "pending").length,
      ],
      [
        "Goal 3 — Missing TDS",
        "Unmapped TB ledgers with likely TDS obligations absent from filings",
        goal3Flags.length,
        goal3Flags.filter(f => f.flag_status === "pending").length,
        goal3Flags.filter(f => f.flag_status !== "pending").length,
      ],
    ],
    styles:     { fontSize: 8.5, cellPadding: 3, textColor: C_BODY },
    headStyles: { fillColor: C_TEAL, textColor: C_WHITE, fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: C_LIGHT },
    columnStyles: {
      0: { cellWidth: 45, fontStyle: "bold" },
      1: { cellWidth: 72 },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 20, halign: "center" },
      4: { cellWidth: 23, halign: "center" },
    },
    margin: { left: ML, right: MR },
    didDrawPage: (h: any) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Exposure summary
  if (y > PH - 90) { doc.addPage(); _pageHeader(doc, "Executive Summary (cont.)", clientName, fyLabel, PW, ML, MR); y = 22; }
  y = _sectionTitle(doc, "Financial Exposure Summary", ML, y, CW);

  const expStats: [string, string, RGB][] = [
    ["Estimated Missing TDS",  fmtINR(totalExposure),          C_RED],
    ["Short Deduction Amount", fmtINR(shortDeductionVariance), C_AMBER],
    ["Total Flags Raised",     String(flags.length),           C_TEAL],
    ["Query Raised",           String(raisedFlags),            C_BLUE],
  ];
  const esw = (CW - 9) / 4;
  expStats.forEach(([label, val, col], i) => {
    const bx = ML + i * (esw + 3);
    doc.setFillColor(...C_LIGHT);
    doc.roundedRect(bx, y, esw, 24, 2, 2, "F");
    doc.setFillColor(...col);
    doc.roundedRect(bx, y, 4, 24, 0, 0, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...col);
    doc.text(trunc(val, 12), bx + esw / 2 + 2, y + 14, { align: "center" });
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text(label, bx + esw / 2 + 2, y + 21, { align: "center" });
  });
  y += 32;

  // Party Mapping Status
  if (y > PH - 70) { doc.addPage(); _pageHeader(doc, "Executive Summary (cont.)", clientName, fyLabel, PW, ML, MR); y = 22; }
  y = _sectionTitle(doc, "Party Mapping Status", ML, y, CW);

  autoTable(doc, {
    startY: y,
    head:   [["Status", "Count", "% of Total"]],
    body: [
      ["Confirmed",    confirmedMaps, mappings.length ? `${Math.round((confirmedMaps / mappings.length) * 100)}%` : "—"],
      ["Pending",      pendingMaps,   mappings.length ? `${Math.round((pendingMaps   / mappings.length) * 100)}%` : "—"],
      ["Rejected",     rejectedMaps,  mappings.length ? `${Math.round((rejectedMaps  / mappings.length) * 100)}%` : "—"],
      ["Needs Review", mappings.filter(m => m.mapping_status === "needs_review").length,
        mappings.length ? `${Math.round((mappings.filter(m => m.mapping_status === "needs_review").length / mappings.length) * 100)}%` : "—"],
      ["Total",        mappings.length, "100%"],
    ],
    styles:     { fontSize: 8.5, cellPadding: 3, textColor: C_BODY },
    headStyles: { fillColor: C_TEAL, textColor: C_WHITE, fontStyle: "bold" },
    alternateRowStyles: { fillColor: C_LIGHT },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 30, halign: "center" },
    },
    margin: { left: ML, right: MR },
    didDrawPage: (h: any) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
  });

  // ────────────────────────────────────────────────────────────────────────────
  // PAGE 3+ — GOAL 1: EXISTENCE FLAGS
  // ────────────────────────────────────────────────────────────────────────────

  doc.addPage();
  _pageHeader(doc, "Goal 1: Existence Reconciliation Flags", clientName, fyLabel, PW, ML, MR);
  y = 22;

  y = _sectionTitle(doc, "Entries in Books NOT in TDS Records & Vice Versa", ML, y, CW);

  if (goal1Flags.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...C_MUTED);
    doc.text("No Goal 1 flags found for this client and financial year.", ML, y + 6);
    y += 20;
  } else {
    const inBooksNotTds = goal1Flags.filter(f => f.flag_type === "entry_in_books_not_in_tds");
    const inTdsNotBooks = goal1Flags.filter(f => f.flag_type === "entry_in_tds_not_in_books");

    if (inBooksNotTds.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...C_AMBER);
      doc.text(`In Books, NOT in TDS Records (${inBooksNotTds.length})`, ML, y + 2);
      y += 7;

      autoTable(doc, {
        startY: y,
        head: [["TB Ledger", "TDS Deductee", "Section", "Book Amt", "TDS Amt", "Variance", "Status"]],
        body: inBooksNotTds.map(f => [
          trunc(f.tb_ledger_name, 25),
          trunc(f.tds_deductee_name, 22),
          f.section_code || "—",
          fmtINR(f.book_amount),
          fmtINR(f.tds_amount),
          fmtINR((f.book_amount ?? 0) - (f.tds_amount ?? 0)),
          f.flag_status?.replace(/_/g, " ") || "—",
        ]),
        styles:     { fontSize: 7.5, cellPadding: 2.5, textColor: C_BODY },
        headStyles: { fillColor: [200, 100, 0] as RGB, textColor: C_WHITE, fontStyle: "bold", fontSize: 7.5 },
        alternateRowStyles: { fillColor: C_LIGHT },
        columnStyles: {
          0: { cellWidth: 38 },
          1: { cellWidth: 35 },
          2: { cellWidth: 17, halign: "center" },
          3: { cellWidth: 22, halign: "right" },
          4: { cellWidth: 22, halign: "right" },
          5: { cellWidth: 22, halign: "right" },
          6: { cellWidth: 26 },
        },
        margin: { left: ML, right: MR },
        didDrawPage: (h: any) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    if (inTdsNotBooks.length > 0) {
      if (y > PH - 60) { doc.addPage(); _pageHeader(doc, "Goal 1: Existence Flags (cont.)", clientName, fyLabel, PW, ML, MR); y = 22; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...C_PURPLE);
      doc.text(`In TDS Records, NOT in Books (${inTdsNotBooks.length})`, ML, y + 2);
      y += 7;

      autoTable(doc, {
        startY: y,
        head: [["TB Ledger", "TDS Deductee", "Section", "Book Amt", "TDS Amt", "Variance", "Status"]],
        body: inTdsNotBooks.map(f => [
          trunc(f.tb_ledger_name, 25),
          trunc(f.tds_deductee_name, 22),
          f.section_code || "—",
          fmtINR(f.book_amount),
          fmtINR(f.tds_amount),
          fmtINR((f.tds_amount ?? 0) - (f.book_amount ?? 0)),
          f.flag_status?.replace(/_/g, " ") || "—",
        ]),
        styles:     { fontSize: 7.5, cellPadding: 2.5, textColor: C_BODY },
        headStyles: { fillColor: C_PURPLE, textColor: C_WHITE, fontStyle: "bold", fontSize: 7.5 },
        alternateRowStyles: { fillColor: C_LIGHT },
        columnStyles: {
          0: { cellWidth: 38 },
          1: { cellWidth: 35 },
          2: { cellWidth: 17, halign: "center" },
          3: { cellWidth: 22, halign: "right" },
          4: { cellWidth: 22, halign: "right" },
          5: { cellWidth: 22, halign: "right" },
          6: { cellWidth: 26 },
        },
        margin: { left: ML, right: MR },
        didDrawPage: (h: any) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // GOAL 2: RATE ANALYSIS FLAGS
  // ────────────────────────────────────────────────────────────────────────────

  doc.addPage();
  _pageHeader(doc, "Goal 2: TDS Rate Analysis Flags", clientName, fyLabel, PW, ML, MR);
  y = 22;

  y = _sectionTitle(doc, "Short Deductions & Over Deductions vs. Applicable Rates", ML, y, CW);

  if (goal2Flags.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...C_MUTED);
    doc.text("No Goal 2 flags found for this client and financial year.", ML, y + 6);
  } else {
    const shortFlags = goal2Flags.filter(f => f.flag_type === "short_deduction");
    const overFlags  = goal2Flags.filter(f => f.flag_type === "over_deduction");

    if (shortFlags.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...C_RED);
      doc.text(`Short Deductions (${shortFlags.length})`, ML, y + 2);
      y += 7;

      autoTable(doc, {
        startY: y,
        head: [["TB Ledger", "Deductee", "Sec.", "Amt Paid", "Expected TDS", "Actual TDS", "Variance", "Exp. Rate", "Status"]],
        body: shortFlags.map(f => [
          trunc(f.tb_ledger_name, 20),
          trunc(f.tds_deductee_name, 18),
          f.section_code || "—",
          fmtINR(f.book_amount),
          fmtINR(f.expected_tds),
          fmtINR(f.actual_tds),
          fmtINR(f.variance_amount),
          f.expected_rate != null ? `${(f.expected_rate * 100).toFixed(1)}%` : "—",
          f.flag_status?.replace(/_/g, " ") || "—",
        ]),
        styles:     { fontSize: 7, cellPadding: 2, textColor: C_BODY },
        headStyles: { fillColor: C_RED, textColor: C_WHITE, fontStyle: "bold", fontSize: 7 },
        alternateRowStyles: { fillColor: C_LIGHT },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 26 },
          2: { cellWidth: 14, halign: "center" },
          3: { cellWidth: 20, halign: "right" },
          4: { cellWidth: 21, halign: "right" },
          5: { cellWidth: 19, halign: "right" },
          6: { cellWidth: 19, halign: "right" },
          7: { cellWidth: 16, halign: "center" },
          8: { cellWidth: 19 },
        },
        margin: { left: ML, right: MR },
        didDrawPage: (h: any) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    if (overFlags.length > 0) {
      if (y > PH - 60) { doc.addPage(); _pageHeader(doc, "Goal 2: Rate Analysis (cont.)", clientName, fyLabel, PW, ML, MR); y = 22; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...C_AMBER);
      doc.text(`Over Deductions (${overFlags.length})`, ML, y + 2);
      y += 7;

      autoTable(doc, {
        startY: y,
        head: [["TB Ledger", "Deductee", "Sec.", "Amt Paid", "Expected TDS", "Actual TDS", "Variance", "Status"]],
        body: overFlags.map(f => [
          trunc(f.tb_ledger_name, 22),
          trunc(f.tds_deductee_name, 20),
          f.section_code || "—",
          fmtINR(f.book_amount),
          fmtINR(f.expected_tds),
          fmtINR(f.actual_tds),
          fmtINR(f.variance_amount),
          f.flag_status?.replace(/_/g, " ") || "—",
        ]),
        styles:     { fontSize: 7.5, cellPadding: 2.5, textColor: C_BODY },
        headStyles: { fillColor: C_AMBER, textColor: C_WHITE, fontStyle: "bold", fontSize: 7.5 },
        alternateRowStyles: { fillColor: C_LIGHT },
        columnStyles: {
          0: { cellWidth: 33 },
          1: { cellWidth: 30 },
          2: { cellWidth: 16, halign: "center" },
          3: { cellWidth: 23, halign: "right" },
          4: { cellWidth: 23, halign: "right" },
          5: { cellWidth: 21, halign: "right" },
          6: { cellWidth: 21, halign: "right" },
          7: { cellWidth: 15 },
        },
        margin: { left: ML, right: MR },
        didDrawPage: (h: any) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // GOAL 3: MISSING TDS OBLIGATIONS
  // ────────────────────────────────────────────────────────────────────────────

  doc.addPage();
  _pageHeader(doc, "Goal 3: Missing TDS Obligations", clientName, fyLabel, PW, ML, MR);
  y = 22;

  y = _sectionTitle(doc, "Unmapped Ledgers with Probable TDS Obligations", ML, y, CW);

  if (goal3Flags.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...C_MUTED);
    doc.text("No Goal 3 / missing TDS flags found for this client and financial year.", ML, y + 6);
  } else {
    // Exposure aggregate note
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...C_BODY);
    doc.text(
      `Total estimated TDS exposure from ${goal3Flags.length} flagged ledger(s): ${fmtINR(totalExposure)}`,
      ML, y,
    );
    y += 8;

    autoTable(doc, {
      startY: y,
      head: [["Unmapped Ledger", "Nature of Payment", "Section", "Activity (Cr)", "Est. TDS", "Rate", "Confidence", "Status"]],
      body: goal3Flags.map(f => [
        trunc(f.tb_ledger_name, 24),
        trunc(f.nature_of_payment, 22),
        f.section_code || "—",
        fmtINR(f.book_amount),
        f.expected_tds != null ? fmtINR(f.expected_tds) : "Slab",
        f.expected_rate != null ? `${(f.expected_rate * 100).toFixed(1)}%` : "Slab",
        f.ai_confidence != null ? `${f.ai_confidence}%` : "—",
        f.flag_status?.replace(/_/g, " ") || "—",
      ]),
      styles:     { fontSize: 7.5, cellPadding: 2.5, textColor: C_BODY },
      headStyles: { fillColor: [13, 148, 136] as RGB, textColor: C_WHITE, fontStyle: "bold", fontSize: 7.5 },
      alternateRowStyles: { fillColor: C_LIGHT },
      columnStyles: {
        0: { cellWidth: 33 },
        1: { cellWidth: 30 },
        2: { cellWidth: 16, halign: "center" },
        3: { cellWidth: 20, halign: "right" },
        4: { cellWidth: 18, halign: "right" },
        5: { cellWidth: 13, halign: "center" },
        6: { cellWidth: 18, halign: "center" },
        7: { cellWidth: 34 },
      },
      margin: { left: ML, right: MR },
      didDrawPage: (h: any) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
      didParseCell: (h: any) => {
        if (h.section === "body" && h.column.index === 6) {
          const conf = parseInt(h.cell.raw as string);
          if (!isNaN(conf)) {
            h.cell.styles.textColor = conf >= 70 ? C_RED : conf >= 50 ? C_AMBER : C_BLUE;
            h.cell.styles.fontStyle = "bold";
          }
        }
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // FINAL PAGE — ACTION STATUS SUMMARY
  // ────────────────────────────────────────────────────────────────────────────

  doc.addPage();
  _pageHeader(doc, "Action Status Summary", clientName, fyLabel, PW, ML, MR);
  y = 22;

  y = _sectionTitle(doc, "Flags by Status", ML, y, CW);

  autoTable(doc, {
    startY: y,
    head:   [["Status", "Goal 1", "Goal 2", "Goal 3", "Total"]],
    body: (["pending", "query_raised", "accepted", "disregarded"] as const).map(status => [
      status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      goal1Flags.filter(f => f.flag_status === status).length,
      goal2Flags.filter(f => f.flag_status === status).length,
      goal3Flags.filter(f => f.flag_status === status).length,
      flags.filter(f => f.flag_status === status).length,
    ]),
    styles:     { fontSize: 9, cellPadding: 3, textColor: C_BODY },
    headStyles: { fillColor: C_TEAL, textColor: C_WHITE, fontStyle: "bold" },
    alternateRowStyles: { fillColor: C_LIGHT },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 25, halign: "center" },
      3: { cellWidth: 25, halign: "center" },
      4: { cellWidth: 30, halign: "center", fontStyle: "bold" },
    },
    foot: [[
      "TOTAL",
      goal1Flags.length,
      goal2Flags.length,
      goal3Flags.length,
      flags.length,
    ]],
    footStyles: { fillColor: C_DARK, textColor: C_WHITE, fontStyle: "bold" },
    margin: { left: ML, right: MR },
    didDrawPage: (h: any) => _pageFooter(doc, h.pageNumber, PW, PH, todayStr),
  });

  y = (doc as any).lastAutoTable.finalY + 14;

  // Disclaimer
  if (y > PH - 30) y = PH - 30;
  doc.setFillColor(...C_LIGHT);
  doc.roundedRect(ML, y, CW, 22, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...C_TEAL);
  doc.text("DISCLAIMER", ML + 5, y + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C_BODY);
  const discText =
    "This report has been generated by the CAFlow automated TDS reconciliation engine based on data " +
    "imported from Tally and TDS Management records. All findings should be reviewed and verified by " +
    "a qualified CA before any action is taken. This is a draft report for internal use only.";
  const discLines = doc.splitTextToSize(discText, CW - 10);
  doc.text(discLines, ML + 5, y + 13);

  // Add footer to last page
  _pageFooter(doc, (doc as any).internal.pages.length - 1, PW, PH, todayStr);

  // ── Save ──
  const fileName = `TDS_Recon_${clientName.replace(/\s+/g, "_")}_FY${financialYear}_${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}.pdf`;
  doc.save(fileName);
}
