import { fontBinary, registerPdfFont, type PdfFontFiles } from "../../supabase/functions/_shared/statement/font";

export { formatPdfCurrency, setPdfUnicodeFont } from "../../supabase/functions/_shared/statement/font";

const FONT_ASSET_PATHS = {
  normal: "/fonts/NotoSans-Regular.ttf",
  bold: "/fonts/NotoSans-Bold.ttf",
} as const;

let fontFiles: Promise<PdfFontFiles> | null = null;

async function fetchFontBinary(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load PDF font asset: ${path}`);
  }
  return fontBinary(await response.arrayBuffer());
}

/** The NotoSans files (with the ₹ glyph), fetched once per page load. */
export function loadPdfFontFiles(): Promise<PdfFontFiles> {
  if (!fontFiles) {
    fontFiles = Promise.all([fetchFontBinary(FONT_ASSET_PATHS.normal), fetchFontBinary(FONT_ASSET_PATHS.bold)])
      .then(([normal, bold]) => ({ normal, bold }))
      .catch(e => { fontFiles = null; throw e; });
  }
  return fontFiles;
}

export async function ensurePdfUnicodeFont(doc: any) {
  registerPdfFont(doc, await loadPdfFontFiles());
}
