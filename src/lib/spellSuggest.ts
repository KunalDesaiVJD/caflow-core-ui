// ─────────────────────────────────────────────────────────────────────────────
// spellSuggest.ts — lightweight, offline spelling SUGGESTIONS for note labels.
//
// Why a curated misspelling map (not a full English dictionary / nspell)?
// The editable fields here are Tally LEDGER NAMES — full of proper nouns,
// person/brand names and abbreviations (e.g. "Mandanka", "DBS", "ITC", "HUF").
// A generic dictionary would underline almost every legitimate ledger name as a
// "misspelling" → false positives an auditor would learn to ignore, defeating
// the feature. Instead we flag ONLY words that are KNOWN to be wrong. That gives
// zero false positives by construction, ships as a few KB (no new dependency,
// no bundle/CJS-ESM risk), and is trivially extensible. Indian/British spellings
// are treated as canonical (aluminium, colour, organisation, labour).
//
// Suggest-only: nothing is ever auto-corrected. The UI shows a "Fix" affordance
// the auditor must click. Swap-in path: replace the LOOKUP lookup in
// findSpellIssues() with an nspell call later if broad coverage is ever wanted —
// the UI contract (SpellIssue[]) stays the same.
// ─────────────────────────────────────────────────────────────────────────────

export interface SpellIssue {
  /** The misspelled token exactly as it appears in the text. */
  word: string;
  /** The suggested correction, case-matched to `word`. */
  suggestion: string;
}

/**
 * Common misspellings → correct spelling. Keys MUST be unique and lowercase.
 * Values use the canonical (Indian/British) spelling. Never add a correctly
 * spelled word as a key, and avoid words whose "misspelling" is itself a valid
 * word in another sense (false-positive risk).
 */
const LOOKUP: Record<string, string> = {
  // ── Materials / assets frequently typed in COGS & FA notes ──
  alluminum: "aluminium",
  aluminum: "aluminium",
  alluminium: "aluminium",
  furnitur: "furniture",
  furneture: "furniture",
  machinary: "machinery",
  machenery: "machinery",
  equipement: "equipment",
  equipmnet: "equipment",
  vehical: "vehicle",
  vehicel: "vehicle",
  matrial: "material",
  matireal: "material",
  materal: "material",
  comodity: "commodity",
  // ── Accounting / financial terms ──
  recievable: "receivable",
  receviable: "receivable",
  recievables: "receivables",
  payble: "payable",
  payabel: "payable",
  paybles: "payables",
  expence: "expense",
  expences: "expenses",
  expanses: "expenses",
  expediture: "expenditure",
  expenditature: "expenditure",
  depriciation: "depreciation",
  depreceation: "depreciation",
  amortisaton: "amortisation",
  provison: "provision",
  privision: "provision",
  liabilty: "liability",
  liabilites: "liabilities",
  libility: "liability",
  libilities: "liabilities",
  assesment: "assessment",
  asessment: "assessment",
  balence: "balance",
  ballance: "balance",
  acount: "account",
  accont: "account",
  acounts: "accounts",
  reciept: "receipt",
  reciepts: "receipts",
  recipt: "receipt",
  invoce: "invoice",
  invioce: "invoice",
  crediters: "creditors",
  creditiors: "creditors",
  debitors: "debtors",
  debters: "debtors",
  intrest: "interest",
  interst: "interest",
  divident: "dividend",
  divdend: "dividend",
  capatial: "capital",
  capitial: "capital",
  reserrve: "reserve",
  goodwil: "goodwill",
  inventery: "inventory",
  inventary: "inventory",
  purchage: "purchase",
  purchse: "purchase",
  comission: "commission",
  comision: "commission",
  commision: "commission",
  proffesional: "professional",
  profesional: "professional",
  consultancey: "consultancy",
  installion: "installation",
  instalation: "installation",
  maintainance: "maintenance",
  maintenence: "maintenance",
  maintainence: "maintenance",
  insurence: "insurance",
  insureance: "insurance",
  freigt: "freight",
  frieght: "freight",
  transpotation: "transportation",
  transportaion: "transportation",
  remuniration: "remuneration",
  remunration: "remuneration",
  bonous: "bonus",
  gratuty: "gratuity",
  gratutiy: "gratuity",
  // ── Generic English commonly seen in row names / narrations ──
  recieve: "receive",
  recieved: "received",
  payed: "paid",
  refered: "referred",
  occured: "occurred",
  seperate: "separate",
  seperated: "separated",
  goverment: "government",
  govenment: "government",
  developement: "development",
  enviroment: "environment",
  miscelaneous: "miscellaneous",
  miscelleneous: "miscellaneous",
  miscellanous: "miscellaneous",
  sundary: "sundry",
  sundery: "sundry",
  outstaning: "outstanding",
  outstading: "outstanding",
  adjustement: "adjustment",
  contigency: "contingency",
  contigent: "contingent",
  statment: "statement",
  staement: "statement",
  ammount: "amount",
  amout: "amount",
  reoccurring: "recurring",
  color: "colour",
  organization: "organisation",
  labor: "labour",
  stationary: "stationery",
};

/** Re-apply the capitalization pattern of `src` onto `dst`. */
function matchCase(src: string, dst: string): string {
  if (src === src.toUpperCase() && src !== src.toLowerCase()) return dst.toUpperCase();
  if (src[0] === src[0]?.toUpperCase()) return dst.charAt(0).toUpperCase() + dst.slice(1);
  return dst;
}

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

/** Return one entry per DISTINCT misspelled word found in `text`. */
export function findSpellIssues(text: string | undefined | null): SpellIssue[] {
  if (!text) return [];
  const issues: SpellIssue[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(WORD_RE)) {
    const raw = m[0];
    const key = raw.toLowerCase();
    const fix = LOOKUP[key];
    if (fix && !seen.has(key)) {
      seen.add(key);
      issues.push({ word: raw, suggestion: matchCase(raw, fix) });
    }
  }
  return issues;
}

/** Apply every known correction to `text`, preserving each word's case. */
export function applyAllSuggestions(text: string): string {
  return text.replace(WORD_RE, (w) => {
    const fix = LOOKUP[w.toLowerCase()];
    return fix ? matchCase(w, fix) : w;
  });
}
