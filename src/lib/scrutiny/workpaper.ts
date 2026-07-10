/**
 * Per-ledger workpaper grouping (Ticket 1.4).
 *
 * Re-organises scrutiny findings by the LEDGER/account they were raised against
 * (`finding.narration`, which the engine populates with `ledger_name` / `party_ledger`),
 * so the auditor can review exceptions account-by-account — the classic working-paper axis,
 * complementing the rule-first templates view.
 *
 * Pure + dependency-free → unit-testable without a DB.
 */

import type { Finding } from "./scrutinyUi";

/** Bucket for findings with no resolvable account. */
export const UNATTRIBUTED_LEDGER = "Unattributed";

export interface LedgerGroup {
  ledger: string;
  findings: Finding[];
  high: number;
  medium: number;
  low: number;
  total: number;
}

const sevU = (f: Finding): string => (f.severity ?? "").toUpperCase();

/**
 * Group findings by ledger (`narration`), highest-risk ledger first
 * (by HIGH, then MEDIUM, then count); the Unattributed bucket sorts last.
 */
export function groupByLedger(findings: Finding[]): LedgerGroup[] {
  const byLedger = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = (f.narration ?? "").trim() || UNATTRIBUTED_LEDGER;
    const arr = byLedger.get(key);
    if (arr) arr.push(f);
    else byLedger.set(key, [f]);
  }

  const groups: LedgerGroup[] = [];
  for (const [ledger, fs] of byLedger) {
    groups.push({
      ledger,
      findings: fs,
      high: fs.filter((f) => sevU(f) === "HIGH").length,
      medium: fs.filter((f) => sevU(f) === "MEDIUM").length,
      low: fs.filter((f) => sevU(f) === "LOW").length,
      total: fs.length,
    });
  }

  return groups.sort((a, b) => {
    if (a.ledger === UNATTRIBUTED_LEDGER) return 1;
    if (b.ledger === UNATTRIBUTED_LEDGER) return -1;
    return b.high - a.high || b.medium - a.medium || b.total - a.total || a.ledger.localeCompare(b.ledger);
  });
}

/** Auto-generated working-paper conclusion line for a ledger (read-only, advisory). */
export function ledgerConclusion(g: LedgerGroup): string {
  const parts: string[] = [];
  if (g.high) parts.push(`${g.high} high`);
  if (g.medium) parts.push(`${g.medium} medium`);
  if (g.low) parts.push(`${g.low} low`);
  const sev = parts.length ? ` (${parts.join(", ")})` : "";
  return `${g.total} exception${g.total !== 1 ? "s" : ""} noted${sev} — review and raise queries as needed.`;
}
