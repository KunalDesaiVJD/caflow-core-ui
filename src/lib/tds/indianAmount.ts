/**
 * Reading a rupee amount as an Indian document writes it.
 *
 * ONE copy, deliberately. Two places now need this — the sale-agreement
 * extractor (src/components/tds/property/agreementExtraction.ts) and the
 * challan/statement parser (form141Challan.ts) — and a second,
 * independently-written version is precisely how ₹2,56,00,000 ends up read as
 * ₹256,00,000 in one half of the module and correctly in the other, with
 * nothing to compare them against. Same reasoning as tdsRateSeed.ts's single
 * rate table and fsSignConvention.ts's single sign rule.
 *
 * The shapes it has to survive are specific to the domain:
 *
 *   "₹2,56,00,000/-"  → 25600000   (2,2,3 grouping, not 3,3,3)
 *   "₹ 1,28,000"      →   128000   (the space the challan receipt prints)
 *   "Rs. 1.28 Cr"     → 12800000
 *   "50 lacs"         →  5000000
 */

const CRORE = 10_000_000;
const LAKH = 100_000;

/**
 * Returns null — never 0 — for anything unreadable.
 *
 * Zero is a legitimate amount (a challan's interest line is normally ₹0), so
 * substituting it for "I could not read this" would turn a failed read into a
 * confident wrong answer: on a consideration it takes a deal under the
 * ₹50,00,000 threshold and produces no filing at all.
 */
export function parseIndianAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const cleaned = s
    .replace(/(?:₹|rs\.?|inr|rupees)/g, " ")
    .replace(/\/-/g, " ")
    .replace(/,/g, "")
    .trim();

  const multiplier = cleaned.match(/^([\d.]+)\s*(crore?s?|cr|lakhs?|lacs?|lac|lakh)\b/);
  if (multiplier) {
    const n = Number(multiplier[1]);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * (/^(crore?s?|cr)$/.test(multiplier[2]) ? CRORE : LAKH));
  }

  const plain = cleaned.match(/^-?[\d.]+/);
  if (!plain) return null;
  const n = Number(plain[0]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Normalise the date formats these documents actually print, to "YYYY-MM-DD".
 *
 *   "02-Sep-2026"  — the challan receipt's Date of Deposit
 *   "02/09/2026"   — the same receipt's Tender Date, in the SAME document
 *   "2026-09-02"   — ISO, where anything already normalised passes through
 *
 * A numeric day/month pair is read DD/MM, the Indian convention. Reading
 * "05/09/2026" the American way would move a filing four months and invent a
 * late-filing fee that is not owed.
 */
export function parseIndianDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 02-Sep-2026 / 2 September 2026
  const named = s.match(/^(\d{1,2})[\s\-/]*([A-Za-z]{3,})[\s\-/]*(\d{4})$/);
  if (named) {
    const m = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
    if (m < 0) return null;
    return `${named[3]}-${String(m + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  }

  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${dmy[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}
