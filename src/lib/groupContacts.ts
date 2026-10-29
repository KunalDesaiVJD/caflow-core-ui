/**
 * Contact details saved on a client group: one master email / phone used for the
 * group's communication, plus any additional emails / phones. Send dialogs pre-fill
 * from these and offer them as suggestions; the user can still edit before sending.
 */

export interface GroupContacts {
  contact_email: string | null;
  contact_phone: string | null;
  extra_emails: string[];
  extra_phones: string[];
}

export const EMPTY_GROUP_CONTACTS: GroupContacts = { contact_email: null, contact_phone: null, extra_emails: [], extra_phones: [] };

/** "a@x.com, b@y.com\nc@z.com" → ["a@x.com", "b@y.com", "c@z.com"] (also splits on ;). */
export const splitList = (s: string | null | undefined) =>
  (s || "").split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/**
 * Phone as WhatsApp wants it: digits only with country code. A 10-digit Indian
 * mobile (optionally with a leading 0) gets 91 in front. Null when not a phone.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  const digits = (raw || "").replace(/\D/g, "").replace(/^0+(?=\d{10}$)/, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** "919727172515" → "+91 97271 72515"; other countries as "+<digits>". */
export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}

const dedupe = (list: string[], key: (s: string) => string = s => s.toLowerCase()) => {
  const seen = new Set<string>();
  return list.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
};

/** Validates the form input; returns what to save and the problems found. */
export function parseGroupContacts(input: { email: string; phone: string; extraEmails: string; extraPhones: string }): { value: GroupContacts; errors: string[] } {
  const errors: string[] = [];
  const email = input.email.trim();
  if (email && !isEmail(email)) errors.push(`Master email "${email}" is not a valid email address`);
  const phone = input.phone.trim() ? normalisePhone(input.phone) : null;
  if (input.phone.trim() && !phone) errors.push(`Master phone "${input.phone.trim()}" is not a valid number`);
  const extraEmails = splitList(input.extraEmails);
  extraEmails.filter(e => !isEmail(e)).forEach(e => errors.push(`"${e}" is not a valid email address`));
  const extraPhonesRaw = splitList(input.extraPhones);
  const extraPhones: string[] = [];
  for (const p of extraPhonesRaw) {
    const n = normalisePhone(p);
    if (n) extraPhones.push(n); else errors.push(`"${p}" is not a valid phone number`);
  }
  return {
    errors,
    value: {
      contact_email: email || null,
      contact_phone: phone,
      extra_emails: dedupe(extraEmails.filter(isEmail).filter(e => e.toLowerCase() !== email.toLowerCase())),
      extra_phones: dedupe(extraPhones.filter(p => p !== phone), s => s),
    },
  };
}

/** Saved emails, master first. */
export const savedEmails = (g: Partial<GroupContacts> | null | undefined) =>
  dedupe([g?.contact_email || "", ...(g?.extra_emails || [])].filter(Boolean));

/** Saved phones (WhatsApp digits), master first. */
export const savedPhones = (g: Partial<GroupContacts> | null | undefined) =>
  dedupe([g?.contact_phone || "", ...(g?.extra_phones || [])].filter(Boolean), s => s);

export const hasSavedContacts = (g: Partial<GroupContacts> | null | undefined) =>
  savedEmails(g).length > 0 || savedPhones(g).length > 0;
