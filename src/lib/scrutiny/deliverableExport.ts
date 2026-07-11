/**
 * Deliverable exporters — turn a Markdown answer into downloadable, professionally-formatted files.
 *
 * One structured model (parseMarkdownBlocks) drives every format so tables, headings, lists and
 * pagination stay consistent across Word (.docx), PDF, Excel (.xlsx), CSV, Markdown and plain text.
 * Used by the AI Auditor answer and reusable by any structured scrutiny output.
 */

import Papa from "papaparse";
import { parseMarkdownBlocks, stripInline, blockToText, type MdBlock, type MdTable } from "./markdown";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const stamp = () => new Date().toISOString().slice(0, 10);
export const safeName = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "ai-auditor";

/** Markdown (.md) — the raw answer, unchanged. */
export function exportMarkdown(md: string, title: string) {
  downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${safeName(title)}-${stamp()}.md`);
}

/** Plain text (.txt) — markers stripped, blocks separated. */
export function exportText(md: string, title: string) {
  const text = parseMarkdownBlocks(md).map(blockToText).join("\n\n");
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${safeName(title)}-${stamp()}.txt`);
}

/** CSV — the first table if present, else one row per narrative block. */
export function exportCsv(md: string, title: string) {
  const blocks = parseMarkdownBlocks(md);
  const t = blocks.find((b) => b.type === "table") as MdTable | undefined;
  const csv = t
    ? Papa.unparse({ fields: t.headers.map(stripInline), data: t.rows.map((r) => r.map(stripInline)) })
    : Papa.unparse(blocks.filter((b) => b.type !== "table").map((b) => ({ content: blockToText(b) })));
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${safeName(title)}-${stamp()}.csv`);
}

/** Excel (.xlsx) — every table becomes a sheet; the narrative goes on a Summary sheet. */
export async function exportXlsx(md: string, title: string) {
  const ExcelJS = (await import("exceljs")).default;
  const blocks = parseMarkdownBlocks(md);
  const wb = new ExcelJS.Workbook();
  wb.creator = "CAFlow AI Auditor";

  const tables = blocks.filter((b) => b.type === "table") as MdTable[];
  tables.forEach((t, idx) => {
    const ws = wb.addWorksheet(`Table ${idx + 1}`);
    const header = ws.addRow(t.headers.map(stripInline));
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    t.rows.forEach((r) => ws.addRow(r.map(stripInline)));
    ws.columns.forEach((c) => {
      let max = 12;
      c.eachCell?.({ includeEmpty: false }, (cell) => { max = Math.max(max, String(cell.value ?? "").length + 2); });
      c.width = Math.min(60, max);
    });
  });

  const ns = wb.addWorksheet("Summary");
  ns.getColumn(1).width = 110;
  ns.addRow([title]).font = { bold: true, size: 14 };
  ns.addRow([]);
  blocks.filter((b) => b.type !== "table").forEach((b) => {
    const row = ns.addRow([blockToText(b)]);
    if (b.type === "heading") row.font = { bold: true };
    row.alignment = { wrapText: true, vertical: "top" };
  });

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safeName(title)}-${stamp()}.xlsx`);
}

/** PDF — headings, paragraphs, bullet lists and real tables (autotable), with page numbers. */
export async function exportPdf(md: string, title: string) {
  const jsPDF = (await import("jspdf")).default;
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF();
  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 20;
  const ensure = (h: number) => { if (y + h > pageH - 16) { doc.addPage(); y = 20; } };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, margin, y);
  y += 4;
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  for (const b of parseMarkdownBlocks(md)) {
    if (b.type === "heading") {
      ensure(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(b.level <= 2 ? 13 : 11);
      const lines = doc.splitTextToSize(stripInline(b.text), pageW - 2 * margin);
      doc.text(lines, margin, y);
      y += lines.length * 6 + 1;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
    } else if (b.type === "table") {
      autoTable(doc, {
        startY: y,
        head: [b.headers.map(stripInline)],
        body: b.rows.map((r) => r.map(stripInline)),
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        theme: "grid",
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
    } else if (b.type === "list") {
      for (const it of b.items) {
        const lines = doc.splitTextToSize(`•  ${stripInline(it)}`, pageW - 2 * margin - 4);
        ensure(lines.length * 5.5);
        doc.text(lines, margin + 2, y);
        y += lines.length * 5.5;
      }
      y += 2;
    } else {
      const text = stripInline(b.type === "quote" ? b.text : (b as { text: string }).text);
      const lines = doc.splitTextToSize(text, pageW - 2 * margin);
      ensure(lines.length * 5.5);
      if (b.type === "quote") doc.setFont("helvetica", "italic");
      doc.text(lines, margin, y);
      if (b.type === "quote") doc.setFont("helvetica", "normal");
      y += lines.length * 5.5 + 3;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`CAFlow AI Auditor · ${stamp()}`, margin, pageH - 8);
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 8, { align: "right" });
  }
  doc.save(`${safeName(title)}-${stamp()}.pdf`);
}

/** Word (.docx) — Title, headings, bullets, blockquotes and bordered tables. */
export async function exportDocx(md: string, title: string) {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = docx;

  const headingFor = (level: number) =>
    level <= 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;

  const children: unknown[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];

  for (const b of parseMarkdownBlocks(md) as MdBlock[]) {
    if (b.type === "heading") {
      children.push(new Paragraph({ text: stripInline(b.text), heading: headingFor(b.level) }));
    } else if (b.type === "list") {
      for (const it of b.items) children.push(new Paragraph({ text: stripInline(it), bullet: { level: 0 } }));
    } else if (b.type === "quote") {
      children.push(new Paragraph({ children: [new TextRun({ text: stripInline(b.text), italics: true })] }));
    } else if (b.type === "table") {
      const header = new TableRow({
        tableHeader: true,
        children: b.headers.map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: stripInline(h), bold: true })] })] })),
      });
      const body = b.rows.map((r) => new TableRow({
        children: r.map((c) => new TableCell({ children: [new Paragraph(stripInline(c))] })),
      }));
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] }));
      children.push(new Paragraph({ text: "" }));
    } else {
      children.push(new Paragraph(stripInline((b as { text: string }).text)));
    }
  }

  const doc = new Document({ sections: [{ children: children as InstanceType<typeof Paragraph>[] }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${safeName(title)}-${stamp()}.docx`);
}

export type ExportFormat = "docx" | "pdf" | "xlsx" | "csv" | "md" | "txt";

export async function exportDeliverable(format: ExportFormat, md: string, title: string) {
  switch (format) {
    case "docx": return exportDocx(md, title);
    case "pdf": return exportPdf(md, title);
    case "xlsx": return exportXlsx(md, title);
    case "csv": return exportCsv(md, title);
    case "md": return exportMarkdown(md, title);
    case "txt": return exportText(md, title);
  }
}
