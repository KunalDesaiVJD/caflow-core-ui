import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { resolve } from "path";
import { isEncryptedOfficeFile, decryptOfficeFile, WrongPasswordError, sha512 } from "@/lib/officeDecrypt";
import { parseWorkbookRows } from "@/lib/tdsWorkbook";

// Synthetic copy of the firm's quarterly 24Q/26Q workbook (Challan Master,
// "24Q Q1", "24Q Q2", "26Q Q2", "Salary Working"), saved with Excel's Agile
// encryption under the password "test@123". Dummy names/PANs only.
const fixture = (): ArrayBuffer => new Uint8Array(readFileSync(resolve(__dirname, "__fixtures__/tds_quarterly_workbook_encrypted.xlsx"))).buffer;

describe("sha512", () => {
  it("matches node's SHA-512 across block boundaries", () => {
    for (const n of [0, 1, 68, 111, 112, 127, 128, 129, 300]) {
      const d = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
      expect(Buffer.from(sha512(d)).toString("hex")).toBe(createHash("sha512").update(d).digest("hex"));
    }
  });
});

describe("password-protected workbook", () => {
  it("is detected, rejects a wrong password and decrypts with the right one", async () => {
    const buf = fixture();
    expect(isEncryptedOfficeFile(buf)).toBe(true);
    await expect(decryptOfficeFile(buf, "nope")).rejects.toBeInstanceOf(WrongPasswordError);
    const plain = new Uint8Array(await decryptOfficeFile(buf, "test@123"));
    expect(isEncryptedOfficeFile(plain.buffer)).toBe(false);
    expect(String.fromCharCode(plain[0], plain[1])).toBe("PK"); // a real .xlsx zip
  }, 30_000);
});

describe("quarterly 24Q/26Q workbook import", () => {
  let plain: ArrayBuffer;
  const rows = async (scope?: { form?: string; quarter?: string }) => {
    plain ??= await decryptOfficeFile(fixture(), "test@123");
    return parseWorkbookRows(plain, undefined, scope);
  };

  it("reads only the filing's form + quarter sheet, skipping deleted rows", async () => {
    const r = await rows({ form: "24Q", quarter: "Q1" });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      "Deductee Name": "Test Employee", PAN: "ABCPE1234F", Section: "192B",
      "Date of Payment": "30-Apr-2026", "Date of Deduction": "02-May-2026",
      "Amount Paid": 105000, "TDS Deducted": 2000, Interest: 15,
      "BSR Code": "0510002", "Challan No": "14904", __sheet: "24Q Q1",
    });
  }, 30_000);

  it("keeps the 26Q section text and fills a blank deduction date from payment", async () => {
    const r = await rows({ form: "26Q", quarter: "Q2" });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      "Deductee Name": "Test Firm LLP", PAN: "AAKFT1234J", Section: "1027 – 194J(b) – Professional services",
      "Date of Payment": "11-Sep-2026", "Date of Deduction": "11-Sep-2026",
      "Amount Paid": 9000, "TDS Deducted": 900, "BSR Code": "6390009", "Challan No": "04429",
    });
  }, 30_000);

  it("never imports the Salary Working summary, even unscoped", async () => {
    const r = await rows();
    expect(r.map((x) => x.__sheet)).toEqual(["24Q Q1", "24Q Q2", "26Q Q2"]);
  }, 30_000);
});
