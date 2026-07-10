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

  it("leaves 194C unmapped (its screenshot code 1023 was refuted in research)", () => {
    const i = resolveSection393("194C")!;
    expect(i.paymentCode).toBeNull();
    expect(i.tableRef).toBeNull();
    expect(i.codeStatus).toBe("unmapped");
  });

  it("leaves 194J(a)/(b) unmapped pending the (a)/(b) label-swap fix", () => {
    for (const code of ["194J(a)", "194J(b)"]) {
      const i = resolveSection393(code)!;
      expect(i.paymentCode, code).toBeNull();
      expect(i.codeStatus, code).toBe("unmapped");
    }
  });

  it("never reports a payment code while codeStatus is unmapped (internal consistency)", () => {
    const codes = [
      "192", "192A", "193", "194", "194A", "194B", "194BB", "194BA", "194C",
      "194D", "194DA", "194F", "194G", "194H", "194I(a)", "194I(b)", "194IA",
      "194IB", "194IC", "194J(a)", "194J(b)", "194K", "194LA", "194LB",
      "194LBC", "194LB-NR", "194LC", "194LD", "194M", "194N-F", "194N-NF",
      "194O", "194Q", "194R", "194S", "194T", "194E", "195", "196A", "196B",
      "196C", "196D", "206C(1)", "206C(1C)", "206C(1G)(a)", "206C(1G)(b)",
      "206C(1H)",
    ];
    for (const code of codes) {
      const i = resolveSection393(code)!;
      expect(i, code).not.toBeNull();
      if (i.codeStatus === "unmapped") {
        expect(i.paymentCode, code).toBeNull();
        expect(i.tableRef, code).toBeNull();
      } else {
        // indicative ⇒ at least one of the two is present
        expect(Boolean(i.paymentCode || i.tableRef), code).toBe(true);
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
