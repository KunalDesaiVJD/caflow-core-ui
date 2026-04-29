/**
 * tallyText.ts — Centralised cleanup of Tally-sourced text fields.
 *
 * Tally uses ASCII control characters (notably 0x04 / EOT) as internal
 * markers on root group names, e.g. "\x04Primary" which surfaces as
 * "&#4; Primary" once HTML-encoded.  Every UI surface that renders a
 * Tally group / ledger name MUST run it through `cleanTallyName()` so
 * the user only ever sees the clean label ("Primary").
 */

export function cleanTallyName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    // Strip ALL ASCII control chars (incl. \x04 used by Tally)
    .replace(/[\x00-\x1F\x7F]/g, "")
    // Strip numeric HTML entities like &#4;
    .replace(/&#\d+;/g, "")
    // Normalise the common named entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Bulk variant — clean every value of a TB-style row whose `parent_group`
 * and `ledger_name` may contain Tally control chars.
 */
export function cleanTallyRow<T extends { parent_group?: string | null; ledger_name?: string | null }>(row: T): T {
  return {
    ...row,
    parent_group: cleanTallyName(row.parent_group as any),
    ledger_name:  cleanTallyName(row.ledger_name  as any),
  };
}
