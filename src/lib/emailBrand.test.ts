import { describe, it, expect } from "vitest";
import {
  BRAND_LOGO_URL, HEAD_FIRM_NAME, brandedShell, ensureLogoHeader, isBillingEmailType,
} from "../../supabase/functions/_shared/emailBrand";

describe("billing email branding", () => {
  it("treats exactly the six billing types as billing", () => {
    for (const t of ["invoice_generated", "quotation_sent", "proforma_sent", "credit_note_issued", "payment_reminder", "ledger_statement"]) {
      expect(isBillingEmailType(t)).toBe(true);
    }
    for (const t of ["audit_query_dispatch", "tds_due_7_days", "new_user_welcome", "internal_filing_reminder"]) {
      expect(isBillingEmailType(t)).toBe(false);
    }
  });

  it("wraps a body with the logo, head-firm footer and contact", () => {
    const html = brandedShell("<p>Hello</p>");
    expect(html).toContain(BRAND_LOGO_URL);
    expect(html).toContain(HEAD_FIRM_NAME);
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain("mailto:accounts@vjdesai.com");
  });

  it("adds the logo to a saved full-document template right after <body>, once", () => {
    const saved = `<!DOCTYPE html><html><body style="margin:0"><p>Hi</p></body></html>`;
    const out = ensureLogoHeader(saved);
    expect(out.indexOf(BRAND_LOGO_URL)).toBeGreaterThan(out.indexOf("<body"));
    expect(out.indexOf(BRAND_LOGO_URL)).toBeLessThan(out.indexOf("<p>Hi</p>"));
    expect(ensureLogoHeader(out)).toBe(out);
  });

  it("prefixes the logo to a fragment template", () => {
    const out = ensureLogoHeader("<p>Hi</p>");
    expect(out.startsWith("<table")).toBe(true);
    expect(out.endsWith("<p>Hi</p>")).toBe(true);
  });
});

import { ledgerStatementBody } from "../../supabase/functions/_shared/emailBrand";
describe("ledgerStatementBody", () => {
  it("escapes values and keeps the message's line breaks", () => {
    const html = ledgerStatementBody({ clientName: "A & B <Ltd>", customMessage: "Line1\n\nLine2 <b>" });
    expect(html).toContain("Dear A &amp; B &lt;Ltd&gt;,");
    expect(html).toContain("Line1<br><br>Line2 &lt;b&gt;");
    expect(html).toContain("V J Desai &amp; Co. LLP");
  });
  it("omits the message paragraph when there is none", () => {
    expect(ledgerStatementBody({ clientName: "X" })).not.toContain("<br><br>");
  });
});
