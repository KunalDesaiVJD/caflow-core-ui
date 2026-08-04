/**
 * CENTRALISED normalisation + record-matching primitives — shared by every TDS
 * stage so name/amount/date/section comparison behaves IDENTICALLY everywhere.
 * Fix a matching bug here (e.g. "Jayant Kantilal Jagani" == "Jayant Jagani
 * Kantilal") and Stage-1, Stage-2 and Stage-3 all get it.
 *
 * Name logic is the version proven in Stage-2 (order-independent token sets,
 * initials, compound Indian suffixes, distinctive-token weighting). Amount/date/
 * section logic mirrors the Stage-1 compare engine (rate-aware, dd/mm-vs-mm/dd
 * auto-detection, section-code canonicalisation).
 */

// ── PAN ──────────────────────────────────────────────────────────────────────
export const normalizePan = (pan: string | null | undefined): string => (pan ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** PAN shape: 5 letters, 4 digits, 1 letter. INLINED from columnEngine.looksLikePan
 *  (a one-liner) so this module has ZERO imports and can be copied byte-identically
 *  into supabase/functions/_shared/match.ts for the Deno edge functions — the same
 *  proven pattern as tdsColumnEngine.ts. columnEngine.ts deliberately keeps its OWN
 *  copy: it uses looksLikePan internally and is itself a byte-identity-guarded,
 *  dependency-free leaf module. Duplicating this single line across two independent
 *  dependency-free leaf modules is the correct trade — neither may import the other. */
const PAN_VALUE_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const looksLikePan = (v: unknown): boolean => PAN_VALUE_RE.test(String(v ?? "").trim().toUpperCase().replace(/\s+/g, ""));

// ── Entity-name normalisation + intelligent comparison ───────────────────────
export const normalizeName = (v: string | null | undefined): string => {
  let s = (v ?? "").toUpperCase();
  s = s.replace(/&/g, " AND ");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  s = ` ${s.replace(/\s+/g, " ").trim()} `;
  s = s.replace(/ CO OPERATIVE /g, " COOPERATIVE ").replace(/ CO OP /g, " COOPERATIVE ");
  s = s.replace(/ PVT /g, " PRIVATE ").replace(/ LTD /g, " LIMITED ");
  s = s.replace(/ P LIMITED /g, " PRIVATE LIMITED ").replace(/ CORPN /g, " CORPORATION ").replace(/ CO /g, " COMPANY ");
  s = s.replace(/^ (M S|MESSRS|MESSER?S|THE) /, " ");
  return s.replace(/\s+/g, " ").trim();
};

const NAME_COMPOUND_SUFFIXES = new Set(["KUMAR", "BHAI", "BHAII", "BEN", "BHEN", "KUMARI", "LAL", "DAS", "CHANDRA", "PRASAD", "DEVI", "RAJ", "NATH", "SINH", "BABU", "RAO"]);
const NAME_STOPWORDS = new Set(["PRIVATE", "LIMITED", "COMPANY", "CORPORATION", "LLP", "LLC", "INC", "AND", "THE", "MESSRS", "SHREE", "SHRI", "SRI", "SHREEJI", "ENTERPRISE", "ENTERPRISES", "TRADERS", "INDUSTRIES"]);

/** A Tally ledger head that names the NATURE of a payment, not a party. Firms
 *  commonly book TDS-bearing interest to several unsecured-loan lenders under
 *  ONE shared account rather than a per-lender sub-ledger, so the "party" text
 *  Tally exports for every such credit is literally this head's title — sharing
 *  no token with any real deductee name. Matched WHOLE-STRING (not "contains"),
 *  so a lender who happens to be named e.g. "Interest Loans Pvt Ltd" is unaffected. */
const GENERIC_LEDGER_HEAD_RE = /^INTEREST( PAID)?( ON)?( UNSECURED)? LOANS?$/;

/** First letter + the consonants after it, repeats collapsed. Folds the VOWEL noise
 *  that dominates Indian transliteration variants — "KATHARANI"/"KATHRANI" and
 *  "KRISHNA"/"KRISHAN" both reduce to the same skeleton — while keeping genuinely
 *  different names apart: "RAMESH"→RMSH vs "RAJESH"→RJSH.
 *
 *  Exported for the assignment engine's distinctness witness, which buckets names
 *  by skeleton. It is a CLASSIFIER, never a matcher: skeleton equality alone is the
 *  loosest signal in this file and is what makes PATEL/PATIL look alike, so nothing
 *  may ever commit a pairing on it without the guards in tokenRule(). */
export function skeleton(w: string): string {
  return (w[0] + w.slice(1).replace(/[AEIOU]/g, "")).replace(/(.)\1+/g, "$1");
}

/** The word's vowels, in order — the signal skeleton() throws away. */
const vowelsOf = (w: string) => w.replace(/[^AEIOU]/g, "");

/** A trailing "(...)" or " - ..." clause on a RAW name, captured before normalisation
 *  erases the boundary that marks it as a TAIL rather than a token. Tally writes a
 *  nature- or location-of-transaction note this way — "Dushyant Prajapati - Exp.",
 *  "Ketan Parmar (BH Parmar Electrician)", "Technosol Corporation-Pur" — a convention
 *  of WHERE the note sits, not WHAT it says, so this is detected POSITIONALLY rather
 *  than by any word list (a list is exactly the party-specific patching this file
 *  exists to avoid — "Exp"/"Pur"/"Pune"/"Tata"/a proprietor's own name all sit in the
 *  same tail position and must all be caught the same way).
 *
 *  Two guards bound the risk of misreading a genuine compound name as noise:
 *    clause <= 3 tokens   — short enough for a tag, too short to be a second full
 *                           name accidentally trailing a stray hyphen.
 *    core >= 2 real tokens — never collapses an identity down to one fragile token
 *                           ("R-Tech Solutions" must NOT become the single letter "R";
 *                           a lone surviving token risks a spurious initial-match
 *                           against unrelated names elsewhere in tokenRule()). */
const NAME_TRAILING_CLAUSE_MAX_TOKENS = 3;

/** A small, CLOSED set of legal-status qualifiers, not a vocabulary of business jargon:
 *  an HUF, a firm, an AOP/BOI or a trust is a DIFFERENT ASSESSEE from the individual
 *  named beside it under the Income Tax Act — its own PAN, its own return. A location
 *  or nature-of-transaction tag ("Pune", "Exp.", a proprietor's own name) can be
 *  dropped without changing who was paid; one of these changes WHO THE DEDUCTEE IS, so
 *  it is carved out of both the trailing-clause strip and the plain-extra-token
 *  acceptance clause below rather than folded in as decoration. */
const NAME_LEGAL_STATUS_TOKENS = new Set(["HUF", "FIRM", "AOP", "BOI", "TRUST"]);

function splitTrailingClause(raw: string | null | undefined): { core: string } | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = /^(.+\S)\s*(?:\(([^()]+)\)|[-–—]\s*([A-Za-z][A-Za-z0-9. ]*))\s*$/.exec(s);
  if (!m) return null;
  const clause = m[2] ?? m[3] ?? "";
  const clauseTokens = clause.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!clauseTokens.length || clauseTokens.length > NAME_TRAILING_CLAUSE_MAX_TOKENS) return null;
  if (clauseTokens.some((w) => NAME_LEGAL_STATUS_TOKENS.has(w))) return null;
  const coreTokens = m[1].toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
  if (coreTokens.length < 2) return null;
  return { core: m[1] };
}

/** Is every character of `s` present in `l`, in order? */
function isSubsequence(s: string, l: string): boolean {
  let i = 0;
  for (const c of l) if (i < s.length && s[i] === c) i++;
  return i === s.length;
}

/** Levenshtein distance, abandoned once it provably exceeds `max`. Exported for the
 *  assignment engine's witness — same classifier-not-matcher caveat as skeleton(). */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Which RULE made two tokens compatible, or null. The number IS the name tier that
 *  rule justifies, so the alignment can report the WEAKEST rule it had to lean on:
 *    0 the tokens are identical
 *    2 an initial ("S" ↔ "SURESHBHAI") or a compound Indian suffix ("RAMESH" ↔
 *      "RAMESHBHAI") — an abbreviation of the same name
 *    3 vowel ELISION in a long word ("KATHARANI" ↔ "KATHRANI")
 *
 *  This is a refactor of the previous boolean tokensCompatible(): the checks, their
 *  order and every guard are UNCHANGED. Only the return type carries more
 *  information, so nothing about which pairs match can have moved. */
type TokenRule = 0 | 2 | 3 | null;
function tokenRule(x: string, y: string): TokenRule {
  if (x === y) return 0;
  if (x.length === 1 && y.length >= 2 && y[0] === x) return 2;
  if (y.length === 1 && x.length >= 2 && x[0] === y) return 2;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 3 && l.startsWith(s) && NAME_COMPOUND_SUFFIXES.has(l.slice(s.length))) return 2;
  // Spelling variants of the SAME word — deliberately NARROW: vowel ELISION only,
  // in a LONG word. Accepts KATHARANI/KATHRANI, KRISHNA/KRISHAN, MOHAMMED/MOHAMED.
  //
  // It must NEVER accept a vowel SUBSTITUTION. Indian vowels are phonemic and often
  // mark gender or community, so a single substituted vowel routinely separates two
  // real, different deductees who share a surname, a family and an address:
  // PATEL/PATIL, KAMAL/KAMLA, VIMAL/VIMLA, DIPAK/DIPIKA, KIRAN/KARAN, HIRALAL/
  // HARILAL. A false match files the return against the WRONG PAN and says nothing;
  // a miss merely asks the user to map the party once. The 35 adversarial pairs that
  // forced this shape are pinned as negatives in match.test.ts.
  //
  // Hence all three guards, none of which is redundant:
  //   length >= 7   — below this an edit is too large a share of the word, and every
  //                   short pair above collides.
  //   skeleton      — rejects CONSONANT differences (RAMESH/RAJESH → RMSH vs RJSH).
  //   vowel subsequence — rejects vowel SUBSTITUTION and REORDERING, which the
  //                   skeleton cannot see at all (it deletes the vowels). This is
  //                   what separates KATHRANI ⊂ KATHARANI from HIRALAL vs HARILAL.
  if (s.length >= 7 && skeleton(x) === skeleton(y) && editDistance(x, y, 2) <= 2) {
    const [vx, vy] = [vowelsOf(x), vowelsOf(y)];
    const [vShort, vLong] = vx.length <= vy.length ? [vx, vy] : [vy, vx];
    if (isSubsequence(vShort, vLong)) return 3;
  }
  return null;
}

/** tokenRule() plus the RISKY rung: the elision branch with its `length >= 7` and
 *  vowel-subsequence guards DROPPED, so it accepts vowel SUBSTITUTION — PATEL/PATIL,
 *  HIRALAL/HARILAL, KAMAL/KAMLA.
 *
 *  This is a NON-COMMITTING PROBE. It exists to CLASSIFY a pair as "phonetically
 *  related but not established" (tier 4) so the engine can pair it, explain it and
 *  offer it as a suggestion. tokenRule() itself is NOT loosened and no code path
 *  turns a tier-4 pair into a Match — see nameCompare's contract note below. */
function riskyTokenRule(x: string, y: string): TokenRule | 4 {
  const r = tokenRule(x, y);
  if (r !== null) return r;
  if (skeleton(x) === skeleton(y) && editDistance(x, y, 2) <= 2) return 4;
  return null;
}

/** The greedy token alignment, factored out of the old nameCompare BYTE-FOR-BYTE:
 *  same short/long choice, same first-compatible-wins `findIndex`, same hits /
 *  fullHits / union arithmetic, same two acceptance clauses. Parameterised only by
 *  the token comparator, so the risky probe can re-run the identical alignment. */
function alignTokens(ta: string[], tb: string[], compat: (x: string, y: string) => number | null) {
  const aIsShort = ta.length <= tb.length;
  const [short, long] = aIsShort ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  const pairs: { s: string; l: string; rule: number }[] = [];
  let hits = 0, fullHits = 0, weakestRule = 0;
  for (const s of short) {
    let idx = -1, rule: number | null = null;
    for (let i = 0; i < long.length; i++) {
      if (used.has(i)) continue;
      const r = compat(s, long[i]);
      if (r !== null) { idx = i; rule = r; break; }
    }
    if (idx >= 0) {
      hits++; used.add(idx);
      if (s.length >= 2 && long[idx].length >= 2) fullHits++;
      if (rule! > weakestRule) weakestRule = rule!;
      pairs.push({ s, l: long[idx], rule: rule! });
    }
  }
  const union = short.length + long.length - hits;
  const accepted = (short.length >= 2 && hits === short.length && fullHits >= 1)
    || (fullHits >= 1 && hits / union >= 0.6);
  // Unmatched tokens on EITHER side — an extra token on the longer side never blocks
  // `accepted` above (that is what lets "KULBIR SINGH" absorb a trailing "- LABOUR"),
  // so callers that need to know whether a LEGAL-STATUS qualifier rode along unmatched
  // (see NAME_LEGAL_STATUS_TOKENS) must inspect these explicitly.
  const matchedShort = new Set(pairs.map((p) => p.s));
  const unmatchedShort = short.filter((s) => !matchedShort.has(s));
  const unmatchedLong = long.filter((_, i) => !used.has(i));
  return { hits, fullHits, union, accepted, weakestRule, pairs, aIsShort, unmatchedShort, unmatchedLong };
}

const hasLegalStatusLeftover = (r: { unmatchedShort: string[]; unmatchedLong: string[] }): boolean =>
  r.unmatchedShort.some((w) => NAME_LEGAL_STATUS_TOKENS.has(w)) || r.unmatchedLong.some((w) => NAME_LEGAL_STATUS_TOKENS.has(w));

/**
 * A BARE INITIAL BELONGS TO WHOEVER'S NAME IT'S STANDING NEXT TO, NOT TO
 * WHOEVER ELSE HAPPENS TO SHARE ITS FIRST LETTER.
 *
 * tokenRule()'s initial rule ("S" ↔ "SURESHBHAI") exists for the SAME person's
 * own name written two ways. It has no way to see WHOSE initial "S" actually
 * is — it just checks the first letter — so nothing stops it aligning "J"
 * from "Hiral J Patel" against an entirely unrelated "Jatin Patel": PATEL
 * matches PATEL, J "matches" JATIN by first letter, and the alignment
 * accepts on two hits — while HIRAL, this ledger row's own real, distinctive
 * first name, sits unmatched and unconsidered. Two people who share a
 * surname (PATEL, SHAH, MEHTA... ) and where one happens to have a middle
 * initial starting with the other's first letter is not a coincidence this
 * engine may treat as identity — a real 24Q filing paired Jatin Patel's
 * office record to Hiral J Patel's Tally voucher this exact way, reporting
 * a fabricated ₹62,230 "Taxable Income Amount Mismatch" against a total
 * stranger's salary.
 *
 * Scoped narrowly: only fires when an initial rule pairing (one token of the
 * pair is a single letter) was load-bearing for acceptance AND a REAL name
 * token (not a suffix/stopword/legal-status word this file already treats as
 * decoration) is left stranded on that SAME side. A harmless unconsumed
 * initial sitting beside an otherwise-complete match (e.g. "Hiral Patel" vs
 * "Hiral J Patel", where HIRAL and PATEL already align exactly) never
 * triggers this — the initial there did no work, so nothing here objects to it.
 */
const isRealNameToken = (w: string) => w.length >= 3 && !NAME_COMPOUND_SUFFIXES.has(w) && !NAME_STOPWORDS.has(w) && !NAME_LEGAL_STATUS_TOKENS.has(w);
const hasStrayInitialLeftover = (r: { pairs: { s: string; l: string; rule: number }[]; unmatchedShort: string[]; unmatchedLong: string[] }): boolean =>
  r.pairs.some((p) => (p.s.length === 1 && r.unmatchedShort.some(isRealNameToken))
    || (p.l.length === 1 && r.unmatchedLong.some(isRealNameToken)));

/**
 * How strongly two names are related, as a TIER of decreasing evidence.
 *
 *   0 EXACT      normalised strings equal          KONE ... PRIVATE LIMITED / Pvt Ltd
 *   1 TOKEN_SET  same token multiset, any order    Jayant Kantilal Jagani
 *   2 ABBREV     initial / compound / dropped tok  Taruben S ...
 *   3 ELISION    vowel elision in a long word      KATHARANI/KATHRANI, KRISHNA/KRISHAN
 *   ─────────── THE LINE. <=3 may auto-match. >=4 never does. ───────────
 *   4 RISKY      skeleton-equal + edit<=2, guards dropped   PATEL/PATIL, KAMAL/KAMLA
 *   5 PARTIAL    some tokens aligned, remainder unrescuable RAMESH PATEL/RAJESH PATEL
 *   6 UNRELATED  zero tokens aligned                        .../Krishna Construction
 *
 * The two populations the pinned corpus encodes are cleanly separated by this line:
 * every required positive lands at <=3 and every one of the 35 adversarial negatives
 * lands at >=4. That is WHY the engine can be safe without any similarity threshold
 * — it never has to ask "how close is close enough?", only "which tier is this?".
 */
export type NameTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | "unknown";

/** Tier as a number, so it can be compared and ordered. "unknown" sits at 3.5 —
 *  BELOW the risky tier (a name we cannot read is not evidence AGAINST identity, and
 *  the facts may still carry the record at A3) but ABOVE every tier allowed to
 *  auto-match on the name alone (an absent name can never itself establish one). */
export const rank = (t: NameTier): number => (t === "unknown" ? 3.5 : t);

export interface NameEvidence {
  tier: NameTier;
  /** The token pairs that only the RISKY rung could align — the actual spelling
   *  disagreement, for the reason line. Populated at tier 4/5 only. */
  divergences: { office: string; ledger: string }[];
}

/** The tiered derivation. `a` is the OFFICE name, `b` the LEDGER name (this only
 *  orients `divergences`; the tier itself is symmetric). */
export function nameEvidence(a: string | null | undefined, b: string | null | undefined): NameEvidence {
  // Tally-style trailing note on exactly ONE side: compare that side's CORE (pre-
  // clause) text below instead. Both sides or neither carrying a clause is left
  // untouched — see splitTrailingClause. If BOTH sides trail one, stripping loses
  // nothing (a shared decorative tail cancels out anyway) but keeping the guard
  // symmetric to isAnnotation() below means a genuinely CONTRASTIVE pair of tails
  // ("- Pune" vs "- Mumbai" on two different branch ledgers) is never silently erased.
  const clauseA = splitTrailingClause(a);
  const clauseB = splitTrailingClause(b);
  const useA = clauseA && !clauseB ? clauseA.core : a;
  const useB = clauseB && !clauseA ? clauseB.core : b;

  const na = normalizeName(useA), nb = normalizeName(useB);
  if (!na || !nb) return { tier: "unknown", divergences: [] };
  if (na === nb) return { tier: 0, divergences: [] };
  // A generic ledger head carries no party identity — treat it exactly like a
  // blank name (tier "unknown", rank 3.5): not evidence AGAINST any office
  // record, so an otherwise-exact date+amount pairing can still be found at A3
  // instead of the transaction being reported missing from the ledger entirely.
  if (GENERIC_LEDGER_HEAD_RE.test(na) || GENERIC_LEDGER_HEAD_RE.test(nb)) return { tier: "unknown", divergences: [] };
  const allA = na.split(" ").filter(Boolean);
  const allB = nb.split(" ").filter(Boolean);
  const hasReal = (ws: string[]) => ws.some((w) => w.length >= 2);
  if (!hasReal(allA) || !hasReal(allB)) return { tier: "unknown", divergences: [] };
  let ta = allA.filter((w) => !NAME_STOPWORDS.has(w));
  let tb = allB.filter((w) => !NAME_STOPWORDS.has(w));
  if (!hasReal(ta) || !hasReal(tb)) { ta = allA; tb = allB; }

  // Tally appends bookkeeping annotations to a ledger name — a rate ("(2%)"), the
  // section ("194C"), a year. These are not the party. Dropping them rescues names the
  // 0.6 hits/union ratio cannot reach: "ABC ENTERPRISE" vs "ABC ENTERPRISE (2%)" is one
  // token against two once ENTERPRISE is a stopword, i.e. ratio 0.5, so an obviously
  // identical party escalated as a Party Name Mismatch.
  //
  // Only when the annotation is ASYMMETRIC. If BOTH sides carry a number it is
  // CONTRASTIVE, not decorative — "UNIT 1 TRADERS" and "UNIT 2 TRADERS" are different
  // parties, and stripping the digit would silently merge them.
  const isAnnotation = (w: string) => /^\d+$/.test(w) || /^(?:19[2-9]|20[0-9])[A-Z]{0,2}$/.test(w);
  if (ta.some(isAnnotation) !== tb.some(isAnnotation)) {
    const sa = ta.filter((w) => !isAnnotation(w));
    const sb = tb.filter((w) => !isAnnotation(w));
    if (hasReal(sa) && hasReal(sb)) { ta = sa; tb = sb; }
  }

  const base = alignTokens(ta, tb, tokenRule);
  const orient = (p: { s: string; l: string }, aIsShort: boolean) =>
    aIsShort ? { office: p.s, ledger: p.l } : { office: p.l, ledger: p.s };

  // A LEGAL-STATUS qualifier riding along unmatched (HUF/Firm/AOP/BOI/Trust — see
  // NAME_LEGAL_STATUS_TOKENS) is never waved through as "just an extra token": an
  // office record for the individual and a ledger head for their own HUF can otherwise
  // clear this exact acceptance clause ("KULBIR SINGH" absorbing "- LABOUR" is fine;
  // "RAMESH PATEL" absorbing "HUF" is a DIFFERENT ASSESSEE). Demoted below instead of
  // accepted here — same treatment as any other unrescuable remainder.
  if (base.accepted && !hasLegalStatusLeftover(base) && !hasStrayInitialLeftover(base)) {
    // Same tokens in a different order is a PERMUTATION, not a weakening — it is
    // tier 1 however the greedy pass happened to align them. Anything else leaned on
    // an abbreviation or dropped a token, which is tier 2 at best.
    const sameMultiset = ta.length === tb.length
      && [...ta].sort().join(" ") === [...tb].sort().join(" ");
    return { tier: (sameMultiset ? 1 : Math.max(base.weakestRule, 2)) as NameTier, divergences: [] };
  }

  // ZERO tokens aligned under the REAL comparator ⇒ nothing relates these names.
  //
  // Deliberately tested BEFORE the risky probe. The merged spec ordered the probe
  // first, which is a silent CONTRACT CHANGE: a single-token pair like "PATEL" vs
  // "PATIL" has hits === 0 and returns "different" today, but the probe accepts it
  // (fullHits 1, ratio 1.0) and would reclassify it tier 4 → "mismatch". Executed
  // and confirmed. "different" vs "mismatch" is a distinction production code reads,
  // and this ordering is what lets nameCompare below be a pure projection of the
  // tier while still returning exactly what it returns today, for every input.
  // Safety is unaffected: 4, 5 and 6 are all >= 4, so none of them can auto-match.
  if (base.hits === 0) return { tier: 6, divergences: [] };

  const risky = alignTokens(ta, tb, riskyTokenRule);
  const divergences = risky.pairs.filter((p) => p.rule === 4).map((p) => orient(p, risky.aIsShort));
  return { tier: risky.accepted && !hasLegalStatusLeftover(risky) ? 4 : 5, divergences };
}

/**
 * Order-independent, initial/compound-tolerant name comparison.
 *
 * CONTRACT UNCHANGED — this is now a pure projection of nameEvidence(), and every
 * one of the 37 pinned tests passes byte-unmodified against it.
 *
 * tier >= 4 is NEVER "match": PATEL/PATIL stays a non-match at the PAIRWISE level,
 * because a pairwise function cannot possibly know whether a competitor exists.
 * Whether a tier-4 pair may be PAIRED or SUGGESTED is a decision the ENGINE makes
 * from the whole CANDIDATE SET (see assignment.ts) — nameCompare has no standing to
 * express it. That separation is the entire design: exclusivity is a property of the
 * candidate set, not of the name pair.
 */
export function nameCompare(a: string | null | undefined, b: string | null | undefined): "match" | "different" | "mismatch" | "unknown" {
  const { tier } = nameEvidence(a, b);
  if (tier === "unknown") return "unknown";
  if (tier <= 3) return "match";
  return tier === 6 ? "different" : "mismatch";
}

// ── Amount ───────────────────────────────────────────────────────────────────
/** The largest absolute gap that can still be ROUNDING rather than a real difference.
 *
 *  This exists because the old 0.5% was RELATIVE and UNBOUNDED, so the rupee gap it
 *  forgave grew without limit: a ₹5 crore credit absorbed ₹2.5 lakh, and a genuine
 *  short deduction — interest under 201(1A) and a 40(a)(ia) disallowance — was reported
 *  as fully reconciled. That is a silent FALSE MATCH, the expensive direction.
 *
 *  ₹10 is not a similarity threshold tuned to anyone's data: TDS is computed as a rate
 *  on a gross and rounded to the rupee, so a legitimate gap is ₹1, or a few rupees where
 *  a firm rounds to the nearest ten. Anything larger is a finding the CA must see. */
const AMOUNT_ROUNDING_MAX = 10;

/** Two amounts match within rounding: ₹1, or 0.5% capped at ₹10 (nulls treated as 0). */
export function amountsMatch(a: number | null | undefined, b: number | null | undefined): boolean {
  const x = Number(a) || 0, y = Number(b) || 0;
  const tolerance = Math.min(Math.max(1, Math.max(Math.abs(x), Math.abs(y)) * 0.005), AMOUNT_ROUNDING_MAX);
  return Math.abs(x - y) <= tolerance;
}

// ── Date ─────────────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Parse a date cell (dd-Mon-yy, dd/mm/yyyy, dd.mm.yy, ISO, Date, Excel serial-ish)
 * to {d,m,y} parts, or null. `order` disambiguates numeric d/m ('dmy'|'mdy'). */
function dateParts(v: unknown): { d: number; m: number; y: number } | null {
  if (v instanceof Date) return { d: v.getDate(), m: v.getMonth() + 1, y: v.getFullYear() };
  const s = String(v ?? "").trim().replace(/\s+00:00:00.*$/, "");
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\s\-.]+([A-Za-z]{3,9})[\s\-.,]+(\d{2,4})$/); // 1-Apr-24
  if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return { d: +m[1], m: mo, y: normYear(+m[3]) }; }
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/); // ISO
  if (m) return { d: +m[3], m: +m[2], y: +m[1] };
  return null; // numeric d/m/y handled by toIso with an order
}
const normYear = (y: number) => (y < 100 ? 2000 + y : y);
/** Whole-column numeric-date convention: a part >12 must be the DAY. */
function detectOrder(values: unknown[]): "dmy" | "mdy" {
  let d1 = false, d2 = false;
  for (const v of values) {
    const s = String(v ?? "").trim();
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) d1 = true; if (+m[2] > 12) d2 = true;
  }
  if (d2 && !d1) return "mdy";
  return "dmy"; // Indian default
}
/** Normalise a date to ISO yyyy-mm-dd using the column's inferred order. */
export function toIso(v: unknown, order: "dmy" | "mdy"): string | null {
  const p = dateParts(v);
  if (p) return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  const s = String(v ?? "").trim().replace(/\s+00:00:00.*$/, "");
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) return null;
  const a = +m[1], b = +m[2], y = normYear(+m[3]);
  const [d, mo] = order === "mdy" ? [b, a] : [a, b];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Build a date→ISO normaliser for a whole column of values (auto-detects order). */
export function makeDateNormaliser(values: unknown[]): (v: unknown) => string | null {
  const order = detectOrder(values);
  return (v: unknown) => toIso(v, order);
}
export const datesMatch = (isoA: string | null, isoB: string | null): boolean => !!isoA && !!isoB && isoA === isoB;

// ── Section ──────────────────────────────────────────────────────────────────
const SECTION_KEYWORD_CODES: Array<[RegExp, string]> = [
  [/contract|transport|freight|labour|job\s*work/i, "194C"], [/professional|technical|consult/i, "194J"],
  [/rent/i, "194I"], [/commission|brokerage/i, "194H"], [/interest/i, "194A"], [/salary/i, "192"],
  [/purchase|goods/i, "194Q"], [/dividend/i, "194"], [/commission.*lottery/i, "194G"],
];
/** The sub-section letters that actually exist in the Act. Deliberately a CLOSED list
 *  rather than [A-Z]{1,2}: the letter may be separated from the number by a space or a
 *  hyphen, so an open pattern would read "Sec 194 to 195" as "194TO" — inventing a
 *  section code that matches nothing and failing the whole file. */
const SECTION_SUB = "AA|AB|BB|DA|EE|IA|IB|IC|LA|LB|LC|LD|[A-T]";
const SECTION_RE = new RegExp(`\\b(19[2-9]|20[0-9])\\s*-?\\s*(${SECTION_SUB})?\\b`);

/**
 * THE SALARY SECTIONS HAVE TWO SPELLINGS, AND THEY ARE THE SAME SECTION.
 *
 * The FVU file format — and therefore every Genius/RPU export and the challan
 * itself — writes the salary sections WITHOUT their leading 1: "92A", "92B",
 * "92C" (seen in the wild as the code "1002-92B"). The Act, every client's own
 * working file, and the rest of this codebase call those 192A / 192B / 192C.
 *
 * Left unhandled, "92B" matched neither SECTION_RE (which starts at 192) nor
 * any keyword, so canonicalSection returned null and the comparison fell back
 * to raw strings: Office Data "92B" vs the client file's "192B" reported a
 * Section mismatch on EVERY employee of a 24Q return — a difference of one
 * character that means nothing.
 *
 * The leading guard is what keeps "192B" itself out: there the "92B" is
 * preceded by a digit, so this can only ever fire on a genuinely bare FVU
 * code, never on a section that already carries its full number.
 */
const FVU_SALARY_SECTION = /(?:^|[^0-9A-Z])92\s*-?\s*([ABC])?(?![0-9A-Z])/;

/** Canonical section code from a raw section/nature string, or null.
 *
 *  The separator tolerance is load-bearing, not cosmetic. Stage 3 derives a ledger's
 *  section from the free-text Tally ledger-name line, and Tally titles are written by
 *  hand: "TDS Payable-194C 25-26", "TDS Payable - 194 C 25-26" and "TDS on Contractors
 *  194 C" are the same account. A pattern requiring the letter to be glued to the digits
 *  read the middle two as bare "194" (the dividend section), so every office record in
 *  that file came back "No Ledger for Section" — a whole-client false mismatch telling
 *  the CA to import a ledger they had already imported.
 *
 *  The keyword table also has to be able to REFINE a bare number, not just substitute
 *  for a missing one: "TDS on Contractors 194" yields base 194, and /contract/ knows
 *  that is really 194C. Running the digits first and returning early denied it that. */
export function canonicalSection(v: string | null | undefined): string | null {
  const s = (v ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  const byKeyword = (): string | null => {
    for (const [re, c] of SECTION_KEYWORD_CODES) if (re.test(s)) return c;
    return null;
  };
  const m = SECTION_RE.exec(s);
  if (!m) {
    const fvu = FVU_SALARY_SECTION.exec(s);
    return fvu ? `192${fvu[1] ?? ""}` : byKeyword();
  }
  const [, base, sub] = m;
  if (sub) {
    // "194IA" (no space/hyphen before the letters) is genuinely ambiguous:
    // it is both the real, distinct statutory section 194-IA (TDS on
    // transfer of certain immovable property) AND how some clients' own
    // Tally books informally spell "194-I(a)" (rent of plant & machinery,
    // 2%) — dropping the parenthesis around the "(a)" sub-clause collapses
    // it onto the exact same digits as the unrelated section. Confirmed
    // real: a genuine client ledger literally titled "TDS on Machinery Rent
    // 2% (194IA) - 1008" parsed as 194-IA, so Office Data's own "194I(a)"
    // (which canonicalises to bare "194I", same as below) could never match
    // it — reported "No Ledger for Section 194I" for a ledger the CA had
    // already imported, just informally labelled. "RENT" is a safe, narrow
    // signal here: 194-IA's own definition (a property TRANSFER) never
    // describes itself as rent, so this can't misfire on a genuine
    // immovable-property ledger. 194-IB is deliberately NOT given the same
    // treatment: unlike 194-IA, real statutory 194-IB (rent paid by an
    // individual/HUF not liable to tax audit) IS ITSELF a rent section, so
    // a "rent" keyword cannot tell it apart from an informal "194-I(b)"
    // reading the way it safely can for "IA".
    //
    // This file has a byte-identical Deno-runtime copy for edge functions
    // (see sharedSync.test.ts) — a change here must land in both.
    if (base === "194" && sub === "IA" && /RENT/.test(s)) return "194I";
    return base + sub;
  }
  // Bare base: accept a keyword's refinement only when it agrees on the base, so a
  // keyword can add the letter the title omitted but can never override the digits.
  const kw = byKeyword();
  return kw && kw.length > base.length && kw.startsWith(base) ? kw : base;
}
export function sectionsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalSection(a), cb = canonicalSection(b);
  if (ca && cb) return ca === cb;
  return true; // if either is unrecognisable, don't manufacture a mismatch
}

/**
 * A BARE "192" NEVER CLAIMED A SUB-CODE, SO IT CANNOT CONTRADICT ONE.
 *
 * "still reports a genuinely different section as a mismatch" (sectionsMatch's
 * own pinned test) is correct and must stay true for 192A vs 192B — the Act
 * treats them as different sections, and if a ledger's title genuinely says
 * "192A" that is real evidence pointing away from a 192B office record.
 *
 * A hand-typed Tally salary-ledger title almost never carries the sub-letter
 * at all ("TDS On Salary - 192", "Salary Expense") — it isn't a claim of
 * "192, definitely not 192B", it is simply silent on the sub-code. Treating
 * that silence as a mismatch against Office Data's own (structured, and so
 * far more often correct) 192B/192A/192C sent a real 24Q client's "No Ledger
 * for Section 192B" for every director, although the correct ledger — the
 * only salary-TDS ledger the client has — was already imported.
 *
 * Deliberately narrow: only fires when one side is the bare, LETTER-LESS base
 * "192" (never for two different lettered codes, which stays a hard
 * mismatch — see the "genuinely different" test above).
 */
export function salaryBareCompatible(a: string | null, b: string | null): boolean {
  return (a === "192" && !!b && /^192[ABC]$/.test(b)) || (b === "192" && !!a && /^192[ABC]$/.test(a));
}

// looksLikePan is exported at its definition above (previously re-exported here from
// columnEngine). Existing importers of it from "./match" are unaffected.
