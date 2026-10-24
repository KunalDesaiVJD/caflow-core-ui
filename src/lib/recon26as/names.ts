// Party-name handling for 26AS vs Books.
//
// The same customer rarely reads the same on both sides. 26AS prints the
// deductor's name as registered against its TAN; the books carry whatever the
// accountant typed. The common gaps, all handled here:
//
//   • legal-form noise      "ABC Pvt. Ltd." vs "ABC PRIVATE LIMITED"
//   • salutations / M/s     "M/s. Shree Traders" vs "SHREE TRADERS"
//   • initials              "R K Patel" vs "RAMESH KUMAR PATEL"
//   • spacing               "Sai Infra" vs "SAIINFRA"
//   • proprietor vs firm    "Shree Krishna Ent. (Prop. Ramesh Patel)" vs
//                            "RAMESH PATEL" — a proprietor's TAN is in the
//                            proprietor's own name, so 26AS shows the person
//                            while the books show the trade name.
//
// The last one cannot be solved by string similarity when the ledger name has
// no owner in it. That case is left to the totals signal and the AI pass in
// the engine; this module only extracts what the text itself says.

const LEGAL_NOISE = new Set([
  'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'CO', 'COMPANY', 'CORP', 'CORPN',
  'INC', 'THE', 'AND', 'OF', 'MS', 'MESSRS', 'SHRI', 'SHREE', 'SRI',
  'SMT', 'MR', 'MRS', 'MISS', 'KUM', 'DR', 'PROP', 'PROPRIETOR', 'PROPRIETRIX',
  'PROPRIETORSHIP', 'PROPRIETRESS', 'OWNER', 'PARTNER', 'HUF', 'OPC', 'TDS', 'RECEIVABLE', 'RECOVERABLE',
]);

// Shree / Sri carry meaning in a trade name ("Shree Krishna Traders") but are
// also a salutation. They are dropped for matching only when other tokens
// remain, so "SHREE" alone still matches "SHREE".

/** Upper-case, & → AND, punctuation to spaces, collapsed. */
export function cleanName(raw: string): string {
  return (raw || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\bM\s*\/\s*S\b\.?/g, ' MS ')
    .replace(/\bA\s*\/\s*C\b\.?/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(raw: string): string[] {
  const all = cleanName(raw).split(' ').filter(Boolean);
  const kept = all.filter((t) => !LEGAL_NOISE.has(t));
  return kept.length ? kept : all;
}

/** Grouping key for a party: tokens without legal noise, joined. */
export function partyKey(raw: string): string {
  return nameTokens(raw).join(' ');
}

/**
 * The names a ledger party may be known by: the whole name, the trade name
 * without its bracket, and any proprietor / owner the text names.
 *
 *   "Shree Krishna Ent. (Prop. Ramesh Patel)" → [full, "Shree Krishna Ent.", "Ramesh Patel"]
 *   "Ramesh Patel - Shree Krishna Ent."       → [full, "Ramesh Patel", "Shree Krishna Ent."]
 *   "Shree Krishna Ent. Prop: Ramesh Patel"   → [full, "Shree Krishna Ent.", "Ramesh Patel"]
 */
export function nameAliases(raw: string): string[] {
  const out = new Set<string>();
  const s = (raw || '').trim();
  if (!s) return [];
  out.add(s);

  // bracketed parts
  const bracket = /[([{]([^)\]}]+)[)\]}]/g;
  let m: RegExpExecArray | null;
  let outside = s;
  while ((m = bracket.exec(s))) {
    out.add(m[1].replace(/^\s*(prop(rietor|rietrix)?|owner|partner)\.?\s*[:\-.]?\s*/i, ''));
    outside = outside.replace(m[0], ' ');
  }
  if (outside.trim() && outside.trim() !== s) out.add(outside.trim());

  // "X Prop. Y" / "X Proprietor: Y" / "X prop Y"
  const prop = s.match(/^(.*?)\s*[,-]?\s*\b(?:prop(?:rietor|rietrix)?|owner)\b\.?\s*[:.-]?\s*(.+)$/i);
  if (prop) {
    if (prop[1].trim()) out.add(prop[1].trim());
    if (prop[2].trim()) out.add(prop[2].replace(/[)\]}]+$/, '').trim());
  }

  // "X - Y" / "X / Y" / "X alias Y"
  for (const sep of [/\s+-\s+/, /\s*\/\s*/, /\s+alias\s+/i, /\s+urf\s+/i]) {
    const parts = s.split(sep).map((p) => p.trim()).filter((p) => p.length >= 3);
    if (parts.length === 2) parts.forEach((p) => out.add(p));
  }

  return [...out].filter((a) => nameTokens(a).length > 0);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Token equality that tolerates initials, short forms and one typo. */
function tokenScore(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 1 || b.length === 1) {
    return a[0] === b[0] ? 0.85 : 0;
  }
  // abbreviations: ENT ↔ ENTERPRISES, INDS ↔ INDUSTRIES, CONST ↔ CONSTRUCTION
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  const long = Math.max(a.length, b.length);
  if (long >= 5 && levenshtein(a, b) <= (long >= 9 ? 2 : 1)) return 0.85;
  return 0;
}

/**
 * Similarity of two token lists, 0..1. Each token on the shorter side takes
 * its best partner on the longer; the score is weighted towards the shorter
 * side so "SHREE KRISHNA" fully inside "SHREE KRISHNA ENTERPRISES" still
 * scores high, but not as high as an exact match.
 */
function tokenSetSimilarity(ta: string[], tb: string[]): number {
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let sum = 0;
  for (const t of short) {
    let best = 0, bestJ = -1;
    long.forEach((u, j) => {
      if (used.has(j)) return;
      const s = tokenScore(t, u);
      if (s > best) { best = s; bestJ = j; }
    });
    if (bestJ >= 0) used.add(bestJ);
    sum += best;
  }
  const coverShort = sum / short.length;
  const coverLong = sum / long.length;
  return 0.75 * coverShort + 0.25 * coverLong;
}

/** Best similarity across both names' aliases, 0..1, with the alias pair that won. */
export function nameSimilarity(a: string, b: string): { score: number; via: string | null } {
  const aa = nameAliases(a), bb = nameAliases(b);
  let best = 0;
  let via: string | null = null;
  for (const x of aa) {
    const tx = nameTokens(x);
    const cx = tx.join('');
    for (const y of bb) {
      const ty = nameTokens(y);
      let s = cx === ty.join('') ? 1 : tokenSetSimilarity(tx, ty);
      // a one-token name only counts if that token is distinctive
      if (Math.min(tx.length, ty.length) === 1 && s < 1) s *= 0.8;
      if (s > best) {
        best = s;
        via = x === a && y === b ? null : `${x} ↔ ${y}`;
      }
    }
  }
  return { score: best, via };
}
