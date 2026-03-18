import html2pdf from "html2pdf.js";
import * as XLSX from "xlsx";

/**
 * Export a DOM element as PDF using html2pdf.js
 */
export async function exportToPdf(element: HTMLElement, filename: string) {
  const opt = {
    margin: [15, 15, 15, 15],
    filename,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" as const },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] },
  };
  await html2pdf().set(opt).from(element).save();
}

/**
 * Export data as Excel (.xlsx)
 */
export function exportToExcel(data: { sheetName: string; rows: Record<string, any>[] }[], filename: string) {
  const wb = XLSX.utils.book_new();
  data.forEach(({ sheetName, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

/**
 * Export HTML content as a Word (.doc) file
 * Uses HTML-in-doc approach which Word opens natively
 */
export function exportToWord(htmlContent: string, filename: string) {
  const fullHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 11pt; line-height: 1.5; margin: 2cm; }
        h1 { font-size: 16pt; font-weight: bold; text-align: center; margin-bottom: 12pt; }
        h2 { font-size: 13pt; font-weight: bold; margin-top: 16pt; margin-bottom: 6pt; }
        h3 { font-size: 11pt; font-weight: bold; margin-top: 12pt; margin-bottom: 4pt; }
        table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; }
        th, td { border: 1px solid #999; padding: 4pt 6pt; text-align: left; }
        th { background-color: #f0f0f0; font-weight: bold; }
        .nil { color: #888; font-style: italic; }
        p { margin: 4pt 0; }
        .declaration { margin-top: 30pt; padding-top: 12pt; border-top: 2px solid #333; }
        @page { size: A4; margin: 2cm; }
      </style>
    </head>
    <body>${htmlContent}</body>
    </html>
  `;
  const blob = new Blob([fullHtml], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
