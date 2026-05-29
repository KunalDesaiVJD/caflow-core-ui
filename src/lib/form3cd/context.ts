/**
 * Form3cdContext — the financial data the auto-fill engine reads.
 *
 * It is built entirely from data that already exists for the engagement:
 *   - tally_trial_balance        (via getTrialBalance — handles sync vintages)
 *   - audit_engagements.coa_mapping (ledger → FS code)
 *   - prior-year TB (for PY ratios in clause 40)
 *
 * NO new tables are read or written. The engine never mutates anything here;
 * it only reads. Applying a suggestion writes into the form_3cd JSON columns
 * through the normal clause onChange/saveAll path.
 */

import {
  getTrialBalance,
  getCOAMapping,
  getEngagementIsNonCorporate,
  getPreviousYearFsAmountsFromTB,
  type COAMapping,
} from "@/lib/notesAutoPopulate";
import { classifyCode, classifySide, type FsSection } from "./fsCatalog";

/** A trial-balance ledger as the engine sees it (signed: DR +, CR −). */
export interface Form3cdLedger {
  name: string;
  group: string;
  /** mapped FS code, or null when the ledger is unmapped in COA mapping */
  code: string | null;
  /** signed closing balance — DR +, CR − */
  balance: number;
  /** signed opening balance (≈ PY closing for BS ledgers) */
  opening: number;
  section: FsSection;
}

export interface Form3cdContext {
  engagementId: string;
  isNCE: boolean;
  ledgers: Form3cdLedger[];
  mappedCount: number;
  unmappedCount: number;
  /** signed sum of CY closing balances by FS code (DR +, CR −) */
  cyByCode: Record<string, number>;
  /** signed sum of PY closing balances by FS code, from the PY-shell TB */
  pyByCode: Record<string, number>;
  loadedAt: string;
  /** true when there was no trial balance to read */
  empty: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Load the full data context for an engagement. Returns an `empty` context
 * (rather than throwing) when no trial balance exists, so the UI can show a
 * helpful "sync Tally first / map COA first" message instead of crashing.
 */
export async function loadForm3cdContext(engagementId: string): Promise<Form3cdContext> {
  const [tb, mapping, isNCE, pyByCode] = await Promise.all([
    getTrialBalance(engagementId),
    getCOAMapping(engagementId),
    getEngagementIsNonCorporate(engagementId),
    getPreviousYearFsAmountsFromTB(engagementId).catch(() => ({} as Record<string, number>)),
  ]);

  const ledgers: Form3cdLedger[] = [];
  const cyByCode: Record<string, number> = {};
  let mappedCount = 0;
  let unmappedCount = 0;

  for (const acct of tb) {
    const code: string | null = (mapping as COAMapping)[acct.account_name]?.code ?? null;
    if (code) {
      mappedCount++;
      cyByCode[code] = round2((cyByCode[code] || 0) + acct.balance);
    } else {
      unmappedCount++;
    }
    ledgers.push({
      name: acct.account_name,
      group: acct.account_group,
      code,
      balance: round2(acct.balance),
      opening: round2(acct.opening_balance ?? 0),
      section: classifyCode(code),
    });
  }

  // Stable, human-friendly ordering: mapped first (grouped by section), then
  // unmapped, alphabetical within each bucket.
  const sectionRank: Record<FsSection, number> = { PL: 0, BS: 1, OTHER: 2 };
  ledgers.sort((a, b) => {
    const am = a.code ? 0 : 1;
    const bm = b.code ? 0 : 1;
    if (am !== bm) return am - bm;
    const sr = sectionRank[a.section] - sectionRank[b.section];
    if (sr !== 0) return sr;
    return a.name.localeCompare(b.name);
  });

  return {
    engagementId,
    isNCE,
    ledgers,
    mappedCount,
    unmappedCount,
    cyByCode,
    pyByCode: pyByCode || {},
    loadedAt: new Date().toISOString(),
    empty: tb.length === 0,
  };
}

/** Sum the signed CY balance for a set of FS codes. */
export function sumCodesCY(ctx: Form3cdContext, codes: string[]): number {
  return round2(codes.reduce((s, c) => s + (ctx.cyByCode[c] || 0), 0));
}

/** Sum the signed PY balance for a set of FS codes. */
export function sumCodesPY(ctx: Form3cdContext, codes: string[]): number {
  return round2(codes.reduce((s, c) => s + (ctx.pyByCode[c] || 0), 0));
}

/**
 * Present a signed sum as a positive figure for the given side.
 * credit-side codes (revenue/liability) are stored negative, so flip them.
 */
export function presentBySide(signedSum: number, side: "credit" | "debit"): number {
  return round2(side === "credit" ? -signedSum : signedSum);
}

/** Ledgers mapped to a given set of FS codes (signed balances preserved). */
export function ledgersForCodes(ctx: Form3cdContext, codes: string[]): Form3cdLedger[] {
  const set = new Set(codes);
  return ctx.ledgers.filter((l) => l.code && set.has(l.code));
}

/** Ledgers whose name matches any of the given (lower-cased) keyword fragments. */
export function ledgersByKeyword(ctx: Form3cdContext, keywords: string[]): Form3cdLedger[] {
  const kws = keywords.map((k) => k.toLowerCase());
  return ctx.ledgers.filter((l) => {
    const n = l.name.toLowerCase();
    const g = (l.group || "").toLowerCase();
    return kws.some((k) => n.includes(k) || g.includes(k));
  });
}

export { classifyCode, classifySide };
