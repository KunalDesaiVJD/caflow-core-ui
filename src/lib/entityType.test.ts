import { describe, it, expect } from "vitest";
import {
  normalizeEntityType,
  isNonCorporateEntityType,
  isProprietorshipEntityType,
} from "@/lib/entityType";

describe("normalizeEntityType — full-word vocabulary (Clients.tsx / StepBasicInfo.tsx)", () => {
  it("recognises every canonical full-word entity type case-insensitively", () => {
    expect(normalizeEntityType("Proprietorship")).toBe("proprietorship");
    expect(normalizeEntityType("Sole Proprietorship")).toBe("proprietorship");
    expect(normalizeEntityType("PARTNERSHIP")).toBe("partnership");
    expect(normalizeEntityType("llp")).toBe("llp");
    expect(normalizeEntityType("Limited Liability Partnership")).toBe("llp");
    expect(normalizeEntityType("Private Ltd")).toBe("private_limited");
    expect(normalizeEntityType("Public Ltd")).toBe("public_limited");
    expect(normalizeEntityType("HUF")).toBe("huf");
    expect(normalizeEntityType("Hindu Undivided Family")).toBe("huf");
    expect(normalizeEntityType("Trust")).toBe("trust");
    expect(normalizeEntityType("AOP")).toBe("aop");
    expect(normalizeEntityType("BOI")).toBe("aop");
    expect(normalizeEntityType("Body of Individuals")).toBe("aop");
  });
});

describe("normalizeEntityType — short-code vocabulary (AuditPipeline.tsx wizard)", () => {
  // Regression coverage for the LALJIBHAI VADIWALA bug: AuditPipeline.tsx's
  // "New Engagement" wizard writes these short lowercase codes to
  // audit_engagements.entity_type — a SEPARATE vocabulary from the one
  // Clients.tsx uses. Every consumer must resolve both the same way.
  it("recognises every short code the New Engagement wizard can write", () => {
    expect(normalizeEntityType("individual")).toBe("proprietorship");
    expect(normalizeEntityType("firm")).toBe("partnership");
    expect(normalizeEntityType("llp")).toBe("llp");
    expect(normalizeEntityType("company")).toBe("private_limited");
    expect(normalizeEntityType("trust")).toBe("trust");
    expect(normalizeEntityType("huf")).toBe("huf");
    expect(normalizeEntityType("aop")).toBe("aop");
  });

  it("is case-insensitive for short codes (Stage 3's prior bug: case-sensitive .includes())", () => {
    expect(normalizeEntityType("Individual")).toBe("proprietorship");
    expect(normalizeEntityType("Firm")).toBe("partnership");
    expect(normalizeEntityType("FIRM")).toBe("partnership");
  });
});

describe("normalizeEntityType — edge cases", () => {
  it("returns unknown for empty/null/undefined", () => {
    expect(normalizeEntityType("")).toBe("unknown");
    expect(normalizeEntityType(null)).toBe("unknown");
    expect(normalizeEntityType(undefined)).toBe("unknown");
    expect(normalizeEntityType("   ")).toBe("unknown");
  });

  it("returns unknown for an unrecognised string rather than guessing", () => {
    expect(normalizeEntityType("some random text")).toBe("unknown");
  });
});

describe("isNonCorporateEntityType", () => {
  it("is true for every NCE constitution, both vocabularies", () => {
    for (const v of [
      "Proprietorship", "individual", "Partnership", "firm", "LLP", "llp",
      "HUF", "huf", "Trust", "trust", "AOP", "aop",
    ]) {
      expect(isNonCorporateEntityType(v)).toBe(true);
    }
  });

  it("is false for corporate entity types, both vocabularies", () => {
    expect(isNonCorporateEntityType("Private Ltd")).toBe(false);
    expect(isNonCorporateEntityType("Public Ltd")).toBe(false);
    expect(isNonCorporateEntityType("company")).toBe(false);
  });

  it("is false for empty/unrecognised entity_type (fails closed to corporate, matching prior behaviour)", () => {
    expect(isNonCorporateEntityType("")).toBe(false);
    expect(isNonCorporateEntityType(null)).toBe(false);
  });
});

describe("isProprietorshipEntityType — the exact LALJIBHAI VADIWALA regression", () => {
  it("is true for both the full word and the wizard's short code", () => {
    expect(isProprietorshipEntityType("Proprietorship")).toBe(true);
    expect(isProprietorshipEntityType("individual")).toBe(true);
    expect(isProprietorshipEntityType("Individual")).toBe(true);
  });

  it("is false for Partnership/LLP — the Capital Account note keeps its Share/Remuneration/Interest columns", () => {
    expect(isProprietorshipEntityType("Partnership")).toBe(false);
    expect(isProprietorshipEntityType("firm")).toBe(false);
    expect(isProprietorshipEntityType("LLP")).toBe(false);
  });
});
