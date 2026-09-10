/**
 * Merging one document's worth of facts out of many page-range readings.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * A registered Gujarati દસ્તાવેજ is a scanned image PDF of 68-202 pages with
 * no text layer, so every page costs the vision model 1,500-2,500 tokens. A
 * whole deed is 120,000-350,000 tokens of images, which cannot be read inside
 * the 110-second budget an edge function has before Supabase cuts the request
 * off. The document therefore has to be read in page-range chunks, and the
 * chunk readings have to become one answer.
 *
 * ── The merge rule ────────────────────────────────────────────────────────
 *
 * The facts are NOT spread evenly across the deed. Almost every chunk returns
 * nulls; one chunk carries the parties, one carries the consideration, and the
 * Index-II page — often the last page, often a separate upload entirely —
 * carries the stamp duty value. So the merge is a per-field pick of the best
 * reading, never an average and never a concatenation:
 *
 *   • scalars   — highest confidence wins; ties go to the earlier page, since
 *                 the operative recital precedes the annexures that repeat it.
 *   • lists     — ONE chunk's list wins outright. Unioning buyers across
 *                 chunks would duplicate every party named on both the recital
 *                 page and the signature page, and a duplicated seller halves
 *                 that seller's share of the consideration. Best confidence,
 *                 then longest list, then earliest page.
 *   • queries   — unioned and de-duplicated, because a question raised about
 *                 page 12 is still open even if page 90 read cleanly.
 *
 * Nothing here talks to a model or a database: chunk readings in, one reading
 * out, so the rule above is testable without either.
 */

import type {
  AgreementExtraction,
  ExtractedField,
  ExtractionQuery,
  Confidence,
} from "@/components/tds/property/agreementExtraction";

/** One chunk's reading, with the pages it covered. */
export interface ChunkReading {
  /** 1-based, inclusive. */
  fromPage: number;
  toPage: number;
  extraction: AgreementExtraction;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/** Fields whose value is an array of records — merged by picking one chunk's
 *  list whole, never by unioning. See the note at the top of this file. */
export const LIST_FIELDS = ["buyers", "sellers", "instalments"] as const;

const isListField = (key: string): boolean =>
  (LIST_FIELDS as readonly string[]).includes(key);

/** A field is worth considering only if it actually carries something. An
 *  explicit null at "low" confidence is the model saying "not on these pages",
 *  which must never displace a real reading from another chunk. */
function hasContent(f: ExtractedField | undefined): f is ExtractedField {
  if (!f) return false;
  const v = f.value;
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Which of two readings of the same field to keep.
 *
 * `page` is the model's own citation, which can be null; a reading that cites
 * no page loses a tie to one that does, because a citation is what makes the
 * figure checkable against the deed.
 */
function better(
  a: { field: ExtractedField; fromPage: number },
  b: { field: ExtractedField; fromPage: number },
  listField: boolean,
): boolean {
  const ra = CONFIDENCE_RANK[a.field.confidence] ?? 0;
  const rb = CONFIDENCE_RANK[b.field.confidence] ?? 0;
  if (ra !== rb) return ra > rb;

  // A longer list means the chunk saw more of the parties — on a deed whose
  // recital page lists two buyers and whose signature page shows one, the
  // fuller reading is the right one.
  if (listField) {
    const la = Array.isArray(a.field.value) ? a.field.value.length : 0;
    const lb = Array.isArray(b.field.value) ? b.field.value.length : 0;
    if (la !== lb) return la > lb;
  }

  const pa = a.field.page ?? Number.MAX_SAFE_INTEGER;
  const pb = b.field.page ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa < pb;

  return a.fromPage < b.fromPage;
}

/** Queries are identified by what they ask about, not by their wording — two
 *  chunks asking for the stamp duty value are one question. */
const queryKey = (q: ExtractionQuery): string =>
  `${q.field}::${(q.question || "").trim().toLowerCase()}`;

/**
 * Fold chunk readings into a single extraction.
 *
 * Order-independent by construction: the result of merging the same chunks in
 * any order is identical, because every choice is made by comparison rather
 * than by overwrite. That matters because chunks are processed concurrently
 * and finish out of order.
 */
export function mergeChunkReadings(chunks: ChunkReading[]): AgreementExtraction {
  const usable = chunks.filter((c) => c.extraction?.extraction_status === "extracted");

  // Nothing readable anywhere. Report the first real failure if there was one,
  // rather than an empty success that looks like a below-threshold deal.
  if (!usable.length) {
    const failure = chunks.find((c) => c.extraction?.extraction_status === "failed");
    return {
      document_kind: "unreadable",
      document_kind_confidence: "low",
      fields: {},
      queries: dedupeQueries(chunks.flatMap((c) => c.extraction?.queries ?? [])),
      extraction_status: failure ? "failed" : "not_a_property_document",
      ...(failure?.extraction.error ? { error: failure.extraction.error } : {}),
    };
  }

  // ── Fields ───────────────────────────────────────────────────────────────
  const best = new Map<string, { field: ExtractedField; fromPage: number }>();
  for (const chunk of usable) {
    for (const [key, field] of Object.entries(chunk.extraction.fields ?? {})) {
      if (!hasContent(field)) continue;
      const candidate = { field, fromPage: chunk.fromPage };
      const held = best.get(key);
      if (!held || better(candidate, held, isListField(key))) best.set(key, candidate);
    }
  }

  const fields: Record<string, ExtractedField> = {};
  for (const [key, { field }] of best) fields[key] = field;

  // ── Document kind ────────────────────────────────────────────────────────
  // A deed whose recital pages read as a sale agreement IS a sale agreement,
  // even though its annexure and map pages read as "other" on their own. The
  // most specific kind any chunk found wins; "other"/"unreadable" only survive
  // when no chunk found anything better.
  const kindRank: Record<AgreementExtraction["document_kind"], number> = {
    sale_agreement: 3,
    index_ii: 2,
    other: 1,
    unreadable: 0,
  };
  let kind: AgreementExtraction["document_kind"] = "unreadable";
  let kindConfidence: Confidence = "low";
  for (const c of usable) {
    const k = c.extraction.document_kind;
    if ((kindRank[k] ?? 0) > (kindRank[kind] ?? 0)) {
      kind = k;
      kindConfidence = c.extraction.document_kind_confidence;
    }
  }

  return {
    document_kind: kind,
    document_kind_confidence: kindConfidence,
    fields,
    queries: dedupeQueries(usable.flatMap((c) => c.extraction.queries ?? [])),
    extraction_status: "extracted",
  };
}

/** Union of every chunk's questions, first wording kept, blocking sticky —
 *  if any chunk considered the question blocking, it blocks. */
export function dedupeQueries(queries: ExtractionQuery[]): ExtractionQuery[] {
  const out = new Map<string, ExtractionQuery>();
  for (const q of queries) {
    if (!q?.field) continue;
    const key = queryKey(q);
    const held = out.get(key);
    if (!held) out.set(key, q);
    else if (q.blocking && !held.blocking) out.set(key, { ...held, blocking: true });
  }
  return [...out.values()];
}

/**
 * Page ranges to read, given a page count.
 *
 * Even chunks rather than a clever guess at which pages matter: the facts sit
 * wherever the sub-registrar's office put them, and a heuristic that skipped
 * the wrong pages would silently produce a deal with no sellers. Reading
 * everything costs more calls but cannot miss.
 */
export function planChunks(pageCount: number, chunkSize: number): Array<{ fromPage: number; toPage: number }> {
  if (pageCount <= 0 || chunkSize <= 0) return [];
  const out: Array<{ fromPage: number; toPage: number }> = [];
  for (let from = 1; from <= pageCount; from += chunkSize) {
    out.push({ fromPage: from, toPage: Math.min(from + chunkSize - 1, pageCount) });
  }
  return out;
}
