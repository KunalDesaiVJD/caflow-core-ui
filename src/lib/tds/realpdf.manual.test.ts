import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { pdfToTextPages } from "./pdfText";
import { extractAckFields, extractAckNumber } from "./ackPdf";

describe("REAL PDF manual verification (temporary, not part of suite)", () => {
  it("extracts fields from the real Form 24Q ack PDF on Desktop", async () => {
    const buf = readFileSync("C:/Users/Admin/OneDrive/Desktop/Form 24Q_ARN_770000388680821.pdf");
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const pages = await pdfToTextPages(arrayBuffer);
    console.log("PAGE COUNT:", pages.length);
    pages.forEach((items, idx) => {
      console.log(`--- PAGE ${idx} raw items (${items.length}) ---`);
      items.forEach((it) => console.log(`  x=${it.x.toFixed(1)} y=${it.y.toFixed(1)} str=${JSON.stringify(it.str)}`));
    });
    const fields = extractAckFields(pages);
    console.log("EXTRACTED FIELDS:", JSON.stringify(fields, null, 2));
    console.log("ACK NUMBER (direct fn):", extractAckNumber(pages));
  });
});
