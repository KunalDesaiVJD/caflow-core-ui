const FONT_ASSET_PATHS = {
  normal: "/fonts/NotoSans-Regular.ttf",
  bold: "/fonts/NotoSans-Bold.ttf",
} as const;

const FONT_VFS_NAMES = {
  normal: "NotoSans-Regular.ttf",
  bold: "NotoSans-Bold.ttf",
} as const;

const fontBinaryCache: Partial<Record<keyof typeof FONT_ASSET_PATHS, string>> = {};

async function fetchFontBinary(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load PDF font asset: ${path}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return binary;
}

async function getFontBinary(variant: keyof typeof FONT_ASSET_PATHS): Promise<string> {
  if (!fontBinaryCache[variant]) {
    fontBinaryCache[variant] = await fetchFontBinary(FONT_ASSET_PATHS[variant]);
  }

  return fontBinaryCache[variant]!;
}

export async function ensurePdfUnicodeFont(doc: any) {
  if (!doc.__notoSansRegistered) {
    const [normal, bold] = await Promise.all([
      getFontBinary("normal"),
      getFontBinary("bold"),
    ]);

    doc.addFileToVFS(FONT_VFS_NAMES.normal, normal);
    doc.addFont(FONT_VFS_NAMES.normal, "NotoSans", "normal");
    doc.addFileToVFS(FONT_VFS_NAMES.bold, bold);
    doc.addFont(FONT_VFS_NAMES.bold, "NotoSans", "bold");
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