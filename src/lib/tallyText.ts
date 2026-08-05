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

/**
 * Build a ledger-name → COA-mapping lookup that agrees with how coa_mapping
 * keys are actually persisted (PipelineStage3.tsx / notesAutoPopulate.ts key
 * by cleanTallyName(ledger_name)). Falls back exact → trimmed → case-
 * insensitive → cleanTallyName-normalized, so a raw TB ledger_name carrying
 * Tally control chars / numeric HTML entities (e.g. "&#13;&#10;") still
 * resolves to its mapping instead of silently reading as unmapped.
 *
 * Every consumer that matches a raw TB ledger_name against coa_mapping
 * should go through this — a hand-rolled matcher that skips the
 * cleanTallyName fallback is how RC-21 (VADIWALA "The District TB Centre")
 * happened: computeCOATotals and unmappedNonZero each had their own trim/
 * case-only matcher that silently disagreed with the COA Mapping screen.
 */
export function buildLedgerMapMatcher<T extends { code: string }>(
  mapping: Record<string, T | undefined>,
): (name: string | null | undefined) => T | undefined {
  const ciIndex: Record<string, T> = {};
  const cleanIndex: Record<string, T> = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (!v?.code) continue;
    const kk = String(k).trim().toLowerCase();
    if (!(kk in ciIndex)) ciIndex[kk] = v;
    const ck = cleanTallyName(k).toLowerCase();
    if (ck && !(ck in cleanIndex)) cleanIndex[ck] = v;
  }
  return (name: string | null | undefined) => {
    if (!name) return undefined;
    return mapping[name]
        ?? mapping[name.trim()]
        ?? ciIndex[String(name).trim().toLowerCase()]
        ?? cleanIndex[cleanTallyName(name).toLowerCase()];
  };
}
