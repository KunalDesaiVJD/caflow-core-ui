/**
 * parseCsiHeader — pinned against the REAL CSI file format.
 *
 * Verified directly (2026-08-05) against 45+ real sample files spanning
 * 2015-2027, one per quarter — every one is a header line
 *   <challan_count>^<TAN>^<Deductor Name>^<RPU ver>^<FVU ver>[^extra ver]^<total amount, paise>
 * followed by exactly <challan_count> 32-char hash lines. Fixtures below are
 * copied verbatim from real files (2026Q1.csi, 2027Q1.csi — the latter has
 * an extra version field between FVU version and the amount, which is why
 * the amount is read from the LAST field, not a fixed position).
 */
import { describe, it, expect } from "vitest";
import { parseCsiHeader } from "./TdsChallanCsiValidation";

const REAL_2026Q1 =
  "6^AHMS10934A^SARJIT CONSTRUCTION^9.2^2.188^00000000000001052379\n" +
  "a1b0fcb6c124a517f75bc15f8d308bc2\n" +
  "266f1a7c254836102b40ff346714f8a1\n" +
  "d078ce7fec3a98167a787fcd8f67b838\n" +
  "ab9e3341569624a27e35fa7cc1dd2daf\n" +
  "0f7bcbba148266a167127a0f35520921\n" +
  "c7b4d5aa66483a8bc1cdd5bcb35c6793\n";

// Has an EXTRA version field ("1.1") between FVU version and the trailing
// amount — the exact case that breaks a fixed-position amount read.
const REAL_2027Q1_EXTRA_FIELD =
  "5^AHMS10934A^SARJIT CONSTRUCTION^9.5^2.191^1.1^00000000000000781275\n" +
  "0a44a9d56fc822ddb71cce3f86103322\n" +
  "1883442e2c669a68cf0df3d37652ec2d\n" +
  "90b0af5346007520b6552edc16aa3441\n" +
  "b2b637c0b6340085373b339e0359a16f\n" +
  "dc7d4e788f8b602092d27dbc98b0829e\n";

describe("parseCsiHeader", () => {
  it("parses a standard real CSI file correctly", () => {
    const parsed = parseCsiHeader(REAL_2026Q1);
    expect(parsed).toMatchObject({
      challanCount: 6, tan: "AHMS10934A", deductorName: "SARJIT CONSTRUCTION",
      rpuVersion: "9.2", fvuVersion: "2.188", totalAmount: 10523.79, hashLineCount: 6,
    });
  });

  it("reads the amount from the LAST field even with an extra version field", () => {
    const parsed = parseCsiHeader(REAL_2027Q1_EXTRA_FIELD);
    expect(parsed).toMatchObject({ challanCount: 5, tan: "AHMS10934A", totalAmount: 7812.75, hashLineCount: 5 });
  });

  it("flags a truncated file via hashLineCount mismatch", () => {
    const truncated = REAL_2026Q1.split("\n").slice(0, 4).join("\n"); // header + 3 of 6 hashes
    const parsed = parseCsiHeader(truncated);
    expect(parsed!.challanCount).toBe(6);
    expect(parsed!.hashLineCount).toBe(3);
  });

  it("returns null for a file that isn't CSI-shaped", () => {
    expect(parseCsiHeader("not a csi file\nrandom text")).toBeNull();
    expect(parseCsiHeader("")).toBeNull();
  });
});
