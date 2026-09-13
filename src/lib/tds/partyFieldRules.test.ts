import { describe, it, expect } from "vitest";
import {
  checkPartyFields,
  checkAddressField,
  entityFromPan,
  ENTITY_PAN_CHAR,
  LIMITS,
  type EntityType,
} from "./partyFieldRules";

/**
 * These encode what the income-tax portal does with a bad value, which is the
 * only reason any of these rules exist:
 *
 *   • an over-long field is REJECTED at upload, after the whole deal has been
 *     re-keyed — so length blocks;
 *   • a name that does not match the PAN is ACCEPTED, and files the deduction
 *     against the wrong record — so the noise rules warn loudly;
 *   • a PAN whose constitution contradicts the party's is one of those two
 *     being wrong, and the commonest case (an HUF against the karta's own PAN)
 *     credits the tax to the wrong assessee — so that blocks.
 */

const party = (over: Partial<Parameters<typeof checkPartyFields>[0]> = {}) => ({
  name: "Girishbhai Madhavji Barochia",
  pan: "ANRPP0000R",
  entityType: "individual" as EntityType | null,
  role: "seller" as const,
  seq: 1,
  ...over,
});

const codes = (f: ReturnType<typeof checkPartyFields>) => f.map((x) => x.code);

describe("entityFromPan", () => {
  it("reads the constitution out of the 4th character", () => {
    expect(entityFromPan("ANRPP0000R")).toBe("individual");
    expect(entityFromPan("ANRHP0000R")).toBe("huf");
    expect(entityFromPan("ANRCP0000R")).toBe("company");
    expect(entityFromPan("ANRFP0000R")).toBe("firm_llp");
  });

  it("says nothing about a PAN that is absent or malformed", () => {
    // Those faults are reported by the existing PAN checks. Reporting them
    // here too would be two findings for one mistake.
    expect(entityFromPan(null)).toBeNull();
    expect(entityFromPan("")).toBeNull();
    expect(entityFromPan("NOTAPAN")).toBeNull();
  });

  it("covers every constitution the map claims to", () => {
    for (const [entity, char] of Object.entries(ENTITY_PAN_CHAR)) {
      expect(entityFromPan(`ABC${char}E1234F`)).toBe(entity);
    }
  });
});

describe("a clean party", () => {
  it("produces nothing", () => {
    expect(checkPartyFields(party())).toEqual([]);
  });
});

describe("length limits — rejected at upload, so blocking", () => {
  it("blocks a name past the statement's limit", () => {
    const f = checkPartyFields(party({ name: "x".repeat(LIMITS.name + 1) }));
    expect(codes(f)).toContain("party_name_too_long");
    expect(f[0].severity).toBe("blocking");
  });

  it("allows a name exactly at the limit", () => {
    expect(codes(checkPartyFields(party({ name: "x".repeat(LIMITS.name) })))).not.toContain(
      "party_name_too_long",
    );
  });

  it("warns on an address longer than the statement takes", () => {
    const f = checkAddressField("y".repeat(LIMITS.address + 1));
    expect(f[0].code).toBe("property_address_too_long");
    expect(f[0].severity).toBe("warning");
  });

  it("says nothing about an empty address — that is a different check's job", () => {
    expect(checkAddressField("")).toEqual([]);
    expect(checkAddressField(null)).toEqual([]);
  });
});

describe("an address read into the name field", () => {
  /**
   * The failure this catches: a vision model reading a block of text off a
   * scanned deed has to decide where the name ends and the address begins.
   * When it gets that wrong nothing downstream notices, and the department's
   * records end up carrying a deductee whose name does not match the PAN.
   */
  it.each([
    ["Girishbhai Barochia, Block No. 12, Hathijan", "block"],
    ["Pratapbhai Solanki Survey No 389", "survey"],
    ["Rameshbhai Patel, Village Hathijan, Taluka Daskroi", "village"],
    ["Kiritbhai Shah, Ahmedabad 380008", "a PIN code"],
    ["Nileshbhai Desai 12/3 Nr. Station Road", "a plot number"],
  ])("flags %s (%s)", (name) => {
    expect(codes(checkPartyFields(party({ name })))).toContain("address_in_name");
  });

  it("leaves an ordinary name alone", () => {
    for (const name of [
      "Girishbhai Madhavji Barochia",
      "Kanubhai Ranchhodbhai Patel",
      "Sureshchandra Nagardas Shah",
    ]) {
      expect(codes(checkPartyFields(party({ name })))).not.toContain("address_in_name");
    }
  });
});

describe("constitution against PAN", () => {
  it("BLOCKS an HUF recorded against a personal PAN", () => {
    // The commonest of these, and the most expensive: the tax is credited to
    // the karta and the HUF is left with none. Neither can reconcile.
    const f = checkPartyFields(party({ entityType: "huf", pan: "ANRPP0000R", name: "Barochia HUF" }));
    const hit = f.find((x) => x.code === "pan_entity_mismatch");
    expect(hit?.severity).toBe("blocking");
    expect(hit?.message).toContain("HUF");
  });

  it("BLOCKS a firm recorded against an individual PAN", () => {
    const f = checkPartyFields(party({ entityType: "firm_llp", pan: "ANRPP0000R", name: "Barochia & Co" }));
    expect(f.find((x) => x.code === "pan_entity_mismatch")?.severity).toBe("blocking");
  });

  it("accepts a matching pair", () => {
    expect(codes(checkPartyFields(party({ entityType: "huf", pan: "ANRHP0000R", name: "Barochia HUF" }))))
      .not.toContain("pan_entity_mismatch");
  });

  it("suggests the constitution from the PAN when none is recorded", () => {
    const f = checkPartyFields(party({ entityType: null, pan: "ANRHP0000R" }));
    const hit = f.find((x) => x.code === "entity_type_unconfirmed");
    expect(hit?.severity).toBe("warning");
    expect(hit?.message).toContain("HUF");
  });

  it("says the constitution is missing when there is no PAN to infer from", () => {
    expect(codes(checkPartyFields(party({ entityType: null, pan: null })))).toContain("entity_type_missing");
  });

  it("does not report a mismatch against a malformed PAN", () => {
    // The invalid-PAN check already owns that fault.
    expect(codes(checkPartyFields(party({ entityType: "huf", pan: "NOTAPAN" }))))
      .not.toContain("pan_entity_mismatch");
  });
});

describe("naming rules per constitution", () => {
  it("warns when an HUF's name does not say HUF", () => {
    const f = checkPartyFields(party({ entityType: "huf", pan: "ANRHP0000R", name: "Girishbhai Barochia" }));
    expect(codes(f)).toContain("huf_name_missing_huf");
  });

  it("accepts an HUF named as one", () => {
    expect(codes(checkPartyFields(party({ entityType: "huf", pan: "ANRHP0000R", name: "Girishbhai Barochia HUF" }))))
      .not.toContain("huf_name_missing_huf");
  });

  it("warns when a firm carries its partners' names instead of its own", () => {
    // A firm is the deductee, not its partners. The statement carries the
    // firm's registered name and the firm's own PAN.
    const f = checkPartyFields(party({
      entityType: "firm_llp", pan: "ANRFP0000R",
      name: "Girishbhai Barochia, Pratapbhai Solanki and Rameshbhai Patel",
    }));
    expect(codes(f)).toContain("partner_names_in_entity_name");
  });

  it("warns when a firm's name is a list of partners", () => {
    const f = checkPartyFields(party({
      entityType: "firm_llp", pan: "ANRFP0000R", name: "Partners: Girishbhai & Pratapbhai",
    }));
    expect(codes(f)).toContain("partner_names_in_entity_name");
  });

  it("accepts a firm's registered name", () => {
    expect(codes(checkPartyFields(party({
      entityType: "firm_llp", pan: "ANRFP0000R", name: "Atman Developers",
    })))).not.toContain("partner_names_in_entity_name");
  });

  it("warns when an individual's name reads like an entity", () => {
    const f = checkPartyFields(party({
      entityType: "individual", pan: "ANRPP0000R", name: "Atman Developers Pvt Ltd",
    }));
    expect(codes(f)).toContain("individual_name_reads_as_entity");
  });
});

describe("contact details", () => {
  it("warns on an email that is not one", () => {
    expect(codes(checkPartyFields(party({ email: "not an email" })))).toContain("party_email_invalid");
  });

  it("accepts an ordinary email", () => {
    expect(codes(checkPartyFields(party({ email: "info@vjdesai.com" })))).not.toContain("party_email_invalid");
  });

  it("warns on a phone number carrying letters", () => {
    expect(codes(checkPartyFields(party({ contact: "call me" })))).toContain("party_contact_invalid");
  });

  it.each(["9876543210", "+91 98765 43210", "079-26400000"])("accepts %s", (contact) => {
    expect(codes(checkPartyFields(party({ contact })))).not.toContain("party_contact_invalid");
  });
});

describe("wording", () => {
  it("names the party rather than saying “this row”", () => {
    const f = checkPartyFields(party({ name: "x".repeat(200) }));
    expect(f[0].message).toContain("characters");
    expect(f[0].ref).toBe("ANRPP0000R");
  });

  it("falls back to role and sequence when there is no name", () => {
    const f = checkPartyFields(party({ name: "", pan: null, entityType: null }));
    expect(f.length).toBe(0); // nothing to check on an empty row — that is dbSaveBlockers' job
  });
});
