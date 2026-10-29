/** NotoSans (has the ₹ glyph) for jsPDF — the caller supplies the font files as binary strings. */
export interface PdfFontFiles { normal: string; bold: string }

export function registerPdfFont(doc: any, files: PdfFontFiles) {
  if (!doc.__notoSansRegistered) {
    doc.addFileToVFS("NotoSans-Regular.ttf", files.normal);
    doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    doc.addFileToVFS("NotoSans-Bold.ttf", files.bold);
    doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
    doc.__notoSansRegistered = true;
  }
  doc.setFont("NotoSans", "normal");
}

export function setPdfUnicodeFont(doc: any, weight: "normal" | "bold" = "normal") {
  doc.setFont("NotoSans", weight);
}

export function formatPdfCurrency(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ArrayBuffer → the binary string jsPDF's virtual file system takes. */
export function fontBinary(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return binary;
}
