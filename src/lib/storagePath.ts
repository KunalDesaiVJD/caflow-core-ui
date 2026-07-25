/**
 * storagePath.ts
 *
 * Shared helper for building Supabase Storage keys from user-uploaded file
 * names. Supabase Storage — S3-compatible under the hood — rejects any key
 * containing non-ASCII characters with a cryptic "Invalid key" error
 * (surfaced to auditors as e.g. "Upload failed: '<name>.pdf' — Invalid key:
 * checklist/…/…_<name>.pdf").
 *
 * The classes of characters commonly hit in Indian-CA workflows:
 *   • en-dash "–" (U+2013)  — from Word / macOS autocorrect on filenames
 *     e.g. "ICICI – Kashindra Project Loan.pdf"
 *   • em-dash "—" (U+2014)
 *   • curly single/double quotes  "'", "'", """, """
 *   • rupee sign "₹" (U+20B9) — from client-provided invoice titles
 *   • diacritics on transliterated names — "Krishnä", "Vasudeva"
 *
 * `sanitizeStorageName` produces a name that is safe as a Supabase Storage
 * key segment (only `[A-Za-z0-9._-]`), while preserving readability by
 * transliterating common Unicode punctuation into ASCII equivalents where
 * possible before falling back to `_` for the rest.
 *
 * The ORIGINAL file name (unmodified) should still be persisted separately
 * in the DB (`file_name` column) so the auditor sees exactly what they
 * uploaded — only the underlying storage key is normalised.
 */
export function sanitizeStorageName(name: string): string {
  const stripped = String(name ?? "")
    // Decompose combined characters so we can strip the accent marks.
    .normalize("NFKD")
    // Strip Unicode combining marks (accents, diacritics).
    .replace(/[̀-ͯ]/g, "")
    // Unicode dashes → ASCII hyphen.
    .replace(/[‐-―−]/g, "-")
    // Curly single quotes → ASCII apostrophe.
    .replace(/[‘’‚‛]/g, "'")
    // Curly double quotes → ASCII double-quote (later stripped by allow-list).
    .replace(/[“”„‟]/g, '"')
    // Non-breaking space & other Unicode whitespace → normal space.
    .replace(/[  -​  　]/g, " ")
    // Runs of whitespace → single underscore.
    .replace(/\s+/g, "_");

  // Allow-list: alphanumeric, dot, underscore, hyphen. Everything else — any
  // remaining Unicode, punctuation, control character — becomes underscore.
  // This is stricter than S3's minimum requirement, but ensures the same
  // key format on every OS and every browser without further per-character
  // exception handling.
  const safe = stripped
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "");

  // Guard against an empty result (e.g. a name that was ALL emoji / CJK).
  return safe || "file";
}
