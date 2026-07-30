import { describe, it, expect } from "vitest";
import {
  resolveSection393,
  isItAct2025Regime,
  IT_ACT_2025_EFFECTIVE_FY,
} from "./section393";

describe("isItAct2025Regime", () => {
  it("is false for years before 2026-27", () => {
    expect(isItAct2025Regime("2023-24")).toBe(false);
    expect(isItAct2025Regime("2024-25")).toBe(false);
    expect(isItAct2025Regime("2025-26")).toBe(false);
  });

  it("is true from 2026-27 onward", () => {
    expect(isItAct2025Regime("2026-27")).toBe(true);
    expect(isItAct2025Regime("2027-28")).toBe(true);
    expect(isItAct2025Regime("2030-31")).toBe(true);
  });

  it("uses the documented effective year", () => {
    expect(isItAct2025Regime(IT_ACT_2025_EFFECTIVE_FY)).toBe(true);
  });

  it("is false for null/undefined/empty", () => {
    expect(isItAct2025Regime(null)).toBe(false);
    expect(isItAct2025Regime(undefined)).toBe(false);
    expect(isItAct2025Regime("")).toBe(false);
  });
});

describe("resolveSection393 — category / new-section mapping", () => {
  it("maps salary (192) to §392", () => {
    const i = resolveSection393("192")!;
    expect(i.newSection).toBe("392");
    expect(i.category).toBe("salary");
  });

  it("maps resident non-salary (194C) to §393(1)", () => {
    const i = resolveSection393("194C")!;
    expect(i.newSection).toBe("393(1)");
    expect(i.category).toBe("resident");
  });

  it("maps non-resident payments (195) to §393(2)", () => {
    const i = resolveSection393("195")!;
    expect(i.newSection).toBe("393(2)");
    expect(i.category).toBe("non-resident");
  });

  it("maps any-person/universal (194T partner payments) to §393(3)", () => {
    const i = resolveSection393("194T")!;
    expect(i.newSection).toBe("393(3)");
    expect(i.category).toBe("any-person");
  });

  it("maps TCS (206C variants) to §394", () => {
    for (const code of ["206C(1)", "206C(1C)", "206C(1G)(a)", "206C(1H)"]) {
      const i = resolveSection393(code)!;
      expect(i.newSection, code).toBe("394");
      expect(i.category, code).toBe("tcs");
    }
  });

  it("classifies cash-withdrawal variants (194N-F / 194N-NF) as any-person", () => {
    expect(resolveSection393("194N-F")!.category).toBe("any-person");
    expect(resolveSection393("194N-NF")!.category).toBe("any-person");
  });

  it("handles the migration's 194A code variants", () => {
    for (const code of ["194A", "194A-SC", "194A- Other than Bank"]) {
      const i = resolveSection393(code)!;
      expect(i.newSection, code).toBe("393(1)");
      expect(i.category, code).toBe("resident");
    }
  });
});

describe("resolveSection393 — indicative codes are flagged, not guessed", () => {
  it("attaches an indicative payment code + table ref for 194Q", () => {
    const i = resolveSection393("194Q")!;
    expect(i.paymentCode).toBe("1031");
    expect(i.tableRef).toBe("Sl. No. 8(ii)");
    expect(i.codeStatus).toBe("indicative");
  });

  it("attaches payment codes to the bifurcated 194C(a)/(b) — restored after adversarial re-verification", () => {
    // An earlier version of this file left 194C unmapped, citing a "107-
    // agent deep-research pass" that supposedly refuted 1023. A fresh
    // adversarial re-verification (3 blind researchers + prosecution +
    // defense + judge) found 1023/1024 independently corroborated by a
    // real TDS-compliance vendor's post-launch production rate chart AND
    // TaxGuru, with the rival numbers a defense pass surfaced (1006, 1017)
    // shown to already belong to different sections in those same sources
    // — a hallucination signature, not a genuine competing data point.
    const a = resolveSection393("194C(a)")!;
    expect(a.paymentCode).toBe("1023");
    expect(a.tableRef).toBe("Sl. No. 6(i).D(a)");
    expect(a.codeStatus).toBe("indicative");

    const b = resolveSection393("194C(b)")!;
    expect(b.paymentCode).toBe("1024");
    expect(b.tableRef).toBe("Sl. No. 6(i).D(b)");
    expect(b.codeStatus).toBe("indicative");
  });

  it("leaves the legacy un-split 194C unmapped (ambiguous which lettered variant, not a refuted code)", () => {
    const i = resolveSection393("194C")!;
    expect(i.paymentCode).toBeNull();
    expect(i.tableRef).toBeNull();
    expect(i.codeStatus).toBe("unmapped");
  });

  it("attaches payment codes to 194J(a)/(b) — the label-swap concern resolved by keying off actual rate/nature, not the letter", () => {
    const a = resolveSection393("194J(a)")!;
    expect(a.paymentCode).toBe("1027");
    expect(a.codeStatus).toBe("indicative");

    const b = resolveSection393("194J(b)")!;
    expect(b.paymentCode).toBe("1026");
    expect(b.codeStatus).toBe("indicative");
  });

  it("leaves 194O unmapped (a candidate code collided with 194R(b), excluded as a likely research error)", () => {
    const i = resolveSection393("194O")!;
    expect(i.paymentCode).toBeNull();
    expect(i.codeStatus).toBe("unmapped");
  });

  it("attaches the same payment code to 194LB/194LB-NR — the same provision recorded under two form types (26Q vs 27Q), confirmed identical across two independent research passes", () => {
    const lb = resolveSection393("194LB")!;
    const lbNr = resolveSection393("194LB-NR")!;
    expect(lb.paymentCode).toBe("1044");
    expect(lbNr.paymentCode).toBe("1044");
  });

  it("never assigns the same payment code to two different sections, except the documented 194LB/194LB-NR case (internal consistency)", () => {
    const codes = [
      "192", "192A", "193", "194", "194A", "194A(a)", "194A(b)", "194A(c)",
      "194B", "194BB", "194BA", "194C", "194C(a)", "194C(b)",
      "194D", "194DA", "194F", "194G", "194H", "194I(a)", "194I(b)", "194IA",
      "194IB", "194IC", "194J(a)", "194J(b)", "194K", "194LA", "194LB",
      "194LBC", "194LB-NR", "194LC", "194LD", "194M", "194N-F", "194N-NF",
      "194O", "194Q", "194R", "194R(a)", "194R(b)", "194S", "194T", "194E",
      "195", "196A", "196B", "196C", "196D", "206C(1)", "206C(1C)",
      "206C(1G)(a)", "206C(1G)(b)",
    ];
    // 194LB/194LB-NR are the ONE known, verified exception — same
    // provision, two form types. Any other pair sharing a code would be a
    // real bug.
    const ALLOWED_SHARED_CODE_GROUPS = [["194LB", "194LB-NR"]];
    const allowedPartner = new Map<string, string>();
    for (const group of ALLOWED_SHARED_CODE_GROUPS) {
      for (const code of group) {
        for (const other of group) if (other !== code) allowedPartner.set(code, other);
      }
    }
    const seen = new Map<string, string>();
    for (const code of codes) {
      const i = resolveSection393(code)!;
      expect(i, code).not.toBeNull();
      if (i.codeStatus === "unmapped") {
        expect(i.paymentCode, code).toBeNull();
        expect(i.tableRef, code).toBeNull();
        continue;
      }
      // indicative ⇒ at least one of the two is present
      expect(Boolean(i.paymentCode || i.tableRef), code).toBe(true);
      if (i.paymentCode) {
        const prior = seen.get(i.paymentCode);
        if (prior !== undefined && allowedPartner.get(code) !== prior) {
          expect.fail(`payment code ${i.paymentCode} reused: ${prior} vs ${code} (not a documented exception)`);
        }
        seen.set(i.paymentCode, code);
      }
    }
  });
});

describe("resolveSection393 — graceful fallback", () => {
  it("returns null for empty/nullish input", () => {
    expect(resolveSection393(null)).toBeNull();
    expect(resolveSection393(undefined)).toBeNull();
    expect(resolveSection393("")).toBeNull();
  });

  it("classifies an unknown 194-series code as resident 393(1) without inventing a code", () => {
    const i = resolveSection393("194ZZ")!;
    expect(i.newSection).toBe("393(1)");
    expect(i.category).toBe("resident");
    expect(i.paymentCode).toBeNull();
    expect(i.codeStatus).toBe("unmapped");
  });

  it("classifies an unknown 206C-series code as TCS", () => {
    expect(resolveSection393("206CXYZ")!.category).toBe("tcs");
  });
});
