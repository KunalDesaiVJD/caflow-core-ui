/**
 * Statement of account PDF for the app. The layout itself is shared with the Telegram bot
 * (supabase/functions/_shared/statement/pdf.ts), so every channel sends the same document.
 */
import { loadPdfFontFiles } from "@/lib/jspdfUnicodeFont";
import { renderStatementPdf, type StatementPdfInput } from "../../supabase/functions/_shared/statement/pdf";

export { summariseEntries, type GroupStatementClient, type StatementPdfInput } from "../../supabase/functions/_shared/statement/pdf";

export async function buildGroupStatementPdf(o: StatementPdfInput): Promise<{ base64: string; blob: Blob }> {
  const [jsPDF, autoTable, fonts] = await Promise.all([
    import("jspdf").then(m => m.default),
    import("jspdf-autotable").then(m => m.default),
    loadPdfFontFiles(),
  ]);
  const doc = renderStatementPdf({ jsPDF, autoTable, fonts }, o);
  const blob = doc.output("blob");
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, blob };
}
