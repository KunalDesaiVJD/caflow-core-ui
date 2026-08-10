import { describe, it, expect } from "vitest";
import { matchChallanDownload } from "./matchChallanDownload";

describe("matchChallanDownload", () => {
  it("matches when serial, date, and amount all agree", () => {
    const result = matchChallanDownload(
      [{ id: "c1", bsr_code: "0180002", challan_serial_no: "00347", deposit_date: "2026-07-07", total_challan_amount: 10523.79 }],
      [{ serialNo: "347", depositDate: "2026-07-07", amount: 10523.79, bsrCode: "0180002" }],
    );
    expect(result).toEqual([{ officeChallanId: "c1", officeSerialNo: "00347", officeDate: "2026-07-07", officeAmount: 10523.79, matched: true, reason: null }]);
  });

  it("flags no portal challan with that serial number", () => {
    const result = matchChallanDownload(
      [{ id: "c1", challan_serial_no: "00347", deposit_date: "2026-07-07", total_challan_amount: 10523.79 }],
      [{ serialNo: "999", depositDate: "2026-07-07", amount: 10523.79, bsrCode: null }],
    );
    expect(result[0].matched).toBe(false);
    expect(result[0].reason).toMatch(/no portal challan/i);
  });

  it("flags an amount mismatch on an otherwise-matching serial+date", () => {
    const result = matchChallanDownload(
      [{ id: "c1", challan_serial_no: "347", deposit_date: "2026-07-07", total_challan_amount: 10523.79 }],
      [{ serialNo: "347", depositDate: "2026-07-07", amount: 9000, bsrCode: null }],
    );
    expect(result[0].matched).toBe(false);
    expect(result[0].reason).toMatch(/amount differs/i);
  });

  it("flags a date mismatch on an otherwise-matching serial+amount", () => {
    const result = matchChallanDownload(
      [{ id: "c1", challan_serial_no: "347", deposit_date: "2026-07-07", total_challan_amount: 10523.79 }],
      [{ serialNo: "347", depositDate: "2026-07-08", amount: 10523.79, bsrCode: null }],
    );
    expect(result[0].matched).toBe(false);
    expect(result[0].reason).toMatch(/dated/i);
  });

  it("tolerates leading zeros when comparing serial numbers", () => {
    const result = matchChallanDownload(
      [{ id: "c1", challan_serial_no: "00099", deposit_date: "2026-07-07", total_challan_amount: 500 }],
      [{ serialNo: "99", depositDate: "2026-07-07", amount: 500, bsrCode: null }],
    );
    expect(result[0].matched).toBe(true);
  });

  it("flags an office challan with no recorded serial number", () => {
    const result = matchChallanDownload(
      [{ id: "c1", challan_serial_no: null, deposit_date: "2026-07-07", total_challan_amount: 500 }],
      [{ serialNo: "99", depositDate: "2026-07-07", amount: 500, bsrCode: null }],
    );
    expect(result[0].matched).toBe(false);
    expect(result[0].reason).toMatch(/no serial number/i);
  });

  it("flags a BSR mismatch on an otherwise-matching serial+date+amount", () => {
    const result = matchChallanDownload(
      [{ id: "c1", bsr_code: "0180002", challan_serial_no: "347", deposit_date: "2026-07-07", total_challan_amount: 500 }],
      [{ serialNo: "347", depositDate: "2026-07-07", amount: 500, bsrCode: "0510308" }],
    );
    expect(result[0].matched).toBe(false);
    expect(result[0].reason).toMatch(/bsr code/i);
  });

  it("never flags a BSR mismatch when either side has no BSR value recorded", () => {
    const noPortalBsr = matchChallanDownload(
      [{ id: "c1", bsr_code: "0180002", challan_serial_no: "347", deposit_date: "2026-07-07", total_challan_amount: 500 }],
      [{ serialNo: "347", depositDate: "2026-07-07", amount: 500, bsrCode: null }],
    );
    expect(noPortalBsr[0].matched).toBe(true);

    const noOfficeBsr = matchChallanDownload(
      [{ id: "c1", bsr_code: null, challan_serial_no: "347", deposit_date: "2026-07-07", total_challan_amount: 500 }],
      [{ serialNo: "347", depositDate: "2026-07-07", amount: 500, bsrCode: "0180002" }],
    );
    expect(noOfficeBsr[0].matched).toBe(true);
  });
});
