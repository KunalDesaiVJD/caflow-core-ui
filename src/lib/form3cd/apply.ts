/**
 * apply — merges engine suggestions into a clause's data object, and manages
 * the per-clause automation metadata.
 *
 * All automation metadata lives under a single namespaced key, `_3cd`, so it
 * never collides with the renderer's own keys (`_value`, `_rows`,
 * `_asPerAnnexure`, …) and is easy to strip out of "is this clause filled?"
 * checks (see META_KEY usage in Form3CD.tsx).
 */

export const META_KEY = "_3cd";

export type Confidence = "high" | "medium" | "low";

export interface LedgerLink {
  /** dot-path inside the clause data this link feeds, e.g. "_rows" or "_value" */
  field: string;
  ledgers: string[];
  sum: number;
  side: "credit" | "debit";
  linkedAt: string;
}

export interface ClauseMeta {
  /** manual override — when true, "Auto-fill all" skips this clause */
  locked?: boolean;
  autofill?: {
    appliedAt: string;
    source: string;
    confidence: Confidence;
  };
  /** manual ledger mappings the user attached (fallback when auto misses) */
  links?: LedgerLink[];
}

export interface SuggestionField {
  label: string;
  value: number | string;
  provenance: string;
}

export interface ClauseSuggestion {
  clauseNo: string;
  confidence: Confidence;
  summary: string;
  fields: SuggestionField[];
  /** deep-merged into the clause data when Applied */
  patch: Record<string, any>;
  /** flip `_asPerAnnexure` true on apply (table-style clauses) */
  setAnnexure?: boolean;
  /** caveat shown to the user before they apply */
  notes?: string;
}

const isPlainObject = (v: any): v is Record<string, any> =>
  v != null && typeof v === "object" && !Array.isArray(v);

/** Deep merge: objects merge recursively, arrays + scalars overwrite. */
export function deepMerge<T extends Record<string, any>>(base: T, patch: Record<string, any>): T {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function getMeta(value: any): ClauseMeta {
  if (!isPlainObject(value)) return {};
  const m = value[META_KEY];
  return isPlainObject(m) ? (m as ClauseMeta) : {};
}

function withMeta(value: any, meta: ClauseMeta): Record<string, any> {
  const base = isPlainObject(value) ? value : {};
  return { ...base, [META_KEY]: meta };
}

export function isLocked(value: any): boolean {
  return getMeta(value).locked === true;
}

export function setLocked(value: any, locked: boolean): Record<string, any> {
  return withMeta(value, { ...getMeta(value), locked });
}

/** Apply a suggestion: deep-merge its patch and stamp the autofill marker. */
export function applySuggestion(value: any, sugg: ClauseSuggestion): Record<string, any> {
  const base = isPlainObject(value) ? value : {};
  let next = deepMerge(base, sugg.patch);
  if (sugg.setAnnexure) {
    next._asPerAnnexure = true;
    next._notApplicable = false;
  }
  const meta = getMeta(base);
  next[META_KEY] = {
    ...meta,
    autofill: {
      appliedAt: new Date().toISOString(),
      source: sugg.summary,
      confidence: sugg.confidence,
    },
  } as ClauseMeta;
  return next;
}

export function getLinks(value: any): LedgerLink[] {
  const links = getMeta(value).links;
  return Array.isArray(links) ? links : [];
}

/** Record a manual ledger link (does not itself write the figure — caller
 *  applies the figure into the clause data and stores the link as provenance). */
export function setLink(value: any, link: LedgerLink): Record<string, any> {
  const meta = getMeta(value);
  const links = (Array.isArray(meta.links) ? meta.links : []).filter((l) => l.field !== link.field);
  links.push(link);
  return withMeta(value, { ...meta, links });
}

export function removeLink(value: any, field: string): Record<string, any> {
  const meta = getMeta(value);
  const links = (Array.isArray(meta.links) ? meta.links : []).filter((l) => l.field !== field);
  return withMeta(value, { ...meta, links });
}

/** Strip the `_3cd` meta so "is filled?" checks ignore automation bookkeeping. */
export function stripMeta(value: any): any {
  if (!isPlainObject(value)) return value;
  const { [META_KEY]: _omit, ...rest } = value;
  return rest;
}
