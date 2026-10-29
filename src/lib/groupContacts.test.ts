import { describe, it, expect } from "vitest";
import { formatPhone, normalisePhone, parseGroupContacts, savedEmails, savedPhones, splitList } from "./groupContacts";

describe("group contacts", () => {
  it("normalises Indian mobiles for WhatsApp", () => {
    expect(normalisePhone("97271 72515")).toBe("919727172515");
    expect(normalisePhone("09727172515")).toBe("919727172515");
    expect(normalisePhone("+91 97271-72515")).toBe("919727172515");
    expect(normalisePhone("+1 415 555 0100")).toBe("14155550100");
    expect(normalisePhone("12345")).toBeNull();
    expect(formatPhone("919727172515")).toBe("+91 97271 72515");
  });

  it("splits lists on commas, semicolons and new lines", () => {
    expect(splitList("a@x.com, b@y.com;\nc@z.com ")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("validates the form and de-duplicates, keeping the master out of the extras", () => {
    const { value, errors } = parseGroupContacts({
      email: "accounts@client.com", phone: "9727172515",
      extraEmails: "ACCOUNTS@client.com, md@client.com, md@client.com", extraPhones: "+91 9727172515, 98250 11111",
    });
    expect(errors).toEqual([]);
    expect(value).toEqual({
      contact_email: "accounts@client.com", contact_phone: "919727172515",
      extra_emails: ["md@client.com"], extra_phones: ["919825011111"],
    });
  });

  it("reports invalid entries instead of saving them", () => {
    const { value, errors } = parseGroupContacts({ email: "not-an-email", phone: "123", extraEmails: "x@", extraPhones: "abc" });
    expect(errors).toHaveLength(4);
    expect(value.extra_emails).toEqual([]);
    expect(value.extra_phones).toEqual([]);
  });

  it("lists saved contacts master first", () => {
    const g = { contact_email: "a@x.com", contact_phone: "919727172515", extra_emails: ["b@x.com"], extra_phones: ["919825011111"] };
    expect(savedEmails(g)).toEqual(["a@x.com", "b@x.com"]);
    expect(savedPhones(g)).toEqual(["919727172515", "919825011111"]);
    expect(savedEmails(null)).toEqual([]);
  });
});
