/**
 * matcher.js — name normalization + fuzzy matching for the auto-mapper.
 *
 * Pure functions (no I/O) so they're easy to test. Used by the `match` command
 * to propose tally_party_map (CAFlow client -> Tally party ledger) and
 * tally_element_map (income / GST / round-off / bank ledgers) rows.
 */

// Drop legal-form / honorific noise so "OM REALTY" == "Om Realty" and
// "Navratna S G Highway Properties Pvt Ltd" == "NAVRATNA S G HIGHWAY PROPERTIES PRIVATE LIMITED".
const STOP = /\b(pvt|private|ltd|limited|llp|inc|co|company|corporation|corp|enterprise|enterprises|and|the|m\/s|mr|mrs|ms|shri|smt|sri)\b/g;

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(STOP, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      cur[j + 1] = Math.min(cur[j] + 1, prev[j + 1] + 1, prev[j] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function levRatio(a, b) {
  const m = Math.max(a.length, b.length);
  return m ? 1 - levenshtein(a, b) / m : 1;
}

function tokenSet(s) {
  return new Set(normName(s).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 0..1 similarity between two names — best of edit-distance and token overlap
 *  (token overlap handles reordered / partial words; edit distance handles typos). */
function similarity(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.max(levRatio(na, nb), jaccard(a, b));
}

/** Match a name against ledgers [{name}], returning the best hit + top candidates.
 *  Exact (normalized, unique) -> name_exact/100. Strong fuzzy -> name_fuzzy. */
function matchName(name, ledgers, { exactAuto = true, fuzzyMin = 0.72 } = {}) {
  const na = normName(name);
  if (na) {
    const exact = ledgers.filter((l) => normName(l.name) === na);
    if (exact.length === 1) return { best: exact[0].name, method: 'name_exact', conf: 100, candidates: [{ name: exact[0].name, score: 1 }], auto: exactAuto };
    if (exact.length > 1) { // ambiguous exact -> propose, don't auto-approve
      return { best: exact[0].name, method: 'name_exact', conf: 70, candidates: exact.slice(0, 3).map((l) => ({ name: l.name, score: 1 })), auto: false };
    }
  }
  const scored = ledgers
    .map((l) => ({ name: l.name, score: similarity(name, l.name) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (scored.length && scored[0].score >= fuzzyMin) {
    return { best: scored[0].name, method: 'name_fuzzy', conf: Math.round(scored[0].score * 100), candidates: scored, auto: false };
  }
  return { best: null, method: 'unmatched', conf: scored.length ? Math.round(scored[0].score * 100) : 0, candidates: scored, auto: false };
}

module.exports = { normName, similarity, matchName, levRatio, jaccard };
