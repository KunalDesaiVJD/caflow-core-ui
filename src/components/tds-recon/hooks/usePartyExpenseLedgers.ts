/**
 * usePartyExpenseLedgers
 *
 * Issue 3 (root-cause fix): the TB Ledger column should show only PARTY
 * ledgers (Sundry Creditors, etc.) — NOT income/expense ledgers. The user
 * also wants to see *which* expense ledgers were booked against each party,
 * shown as sub-lines underneath the party name.
 *
 * This hook walks `tally_vouchers` for the given client + FY, parses each
 * voucher's `line_items` JSON, and aggregates the expense (or income)
 * ledgers used against each `party_ledger`. Returns:
 *   Map<partyName_lowercased, [{ ledger, amount }, ...]>
 *
 * Used by TdsPartyMappingPanel to render expense breakdowns under each
 * mapped party row.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PartyExpenseLine {
  /** Expense / nominal ledger booked against this party */
  ledger: string;
  /** Total amount booked across all vouchers (debit total — gross before GST split) */
  amount: number;
  /** Number of voucher line entries contributing to the total */
  count: number;
}

interface VoucherRow {
  party_ledger: string | null;
  line_items: any;          // JSON
  amount: number | null;
  voucher_type: string | null;
}

/**
 * Heuristic: a "nominal" line item is anything whose ledger does NOT look
 * like a party (i.e. excludes the same party_ledger, banks, cash, GST taxes,
 * TDS payable). We only surface DEBIT side lines (expenses being booked).
 */
function isLikelyExpenseLedger(name: string, partyLedger: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  if (n === partyLedger.toLowerCase()) return false;
  // Exclude tax/balance-sheet ledgers
  if (/\bgst\b|\bcgst\b|\bsgst\b|\bigst\b|\btds\b|\btcs\b/.test(n)) return false;
  if (/\bbank\b|\bcash\b|\bcredit card\b|\boverdraft\b/.test(n)) return false;
  if (/\bduties? (?:&|and) taxes?\b/.test(n)) return false;
  if (/\bcapital( account)?\b|\breserves?\b|\bsuspense\b/.test(n)) return false;
  return true;
}

export function usePartyExpenseLedgers(
  clientId: string | null | undefined,
  financialYear: string | null | undefined,
): {
  /** Lower-cased party name → list of expense ledgers */
  byParty: Map<string, PartyExpenseLine[]>;
  loading: boolean;
} {
  const [byParty, setByParty] = useState<Map<string, PartyExpenseLine[]>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientId || !financialYear) { setByParty(new Map()); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Pull only what we need; vouchers can be large so paginate at 1000.
        const all: VoucherRow[] = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await (supabase as any)
            .from("tally_vouchers")
            .select("party_ledger, line_items, amount, voucher_type")
            .eq("client_id", clientId)
            .eq("financial_year", financialYear)
            .not("party_ledger", "is", null)
            .range(from, from + PAGE - 1);
          if (error || !data || data.length === 0) break;
          all.push(...(data as VoucherRow[]));
          if (data.length < PAGE) break;
        }

        // Aggregate: party (lc) → ledger → { amount, count }
        const agg = new Map<string, Map<string, PartyExpenseLine>>();
        for (const v of all) {
          if (!v.party_ledger) continue;
          const partyKey = v.party_ledger.toLowerCase().trim();
          if (!partyKey) continue;
          const items = Array.isArray(v.line_items) ? v.line_items : [];

          // Determine total debit value of this voucher's nominal lines so we
          // can split per-ledger amounts proportionally if needed. Most Tally
          // exports already give us per-line ledger + amount.
          for (const li of items) {
            const ledgerName = String(li?.ledger ?? li?.ledger_name ?? "").trim();
            if (!ledgerName) continue;
            if (!isLikelyExpenseLedger(ledgerName, v.party_ledger)) continue;

            const amt = Math.abs(Number(li?.amount ?? li?.debit ?? 0));
            if (!Number.isFinite(amt) || amt <= 0) continue;

            if (!agg.has(partyKey)) agg.set(partyKey, new Map());
            const inner = agg.get(partyKey)!;
            const cur = inner.get(ledgerName) ?? { ledger: ledgerName, amount: 0, count: 0 };
            cur.amount += amt;
            cur.count  += 1;
            inner.set(ledgerName, cur);
          }
        }

        // Flatten + sort per party (largest amount first)
        const out = new Map<string, PartyExpenseLine[]>();
        for (const [party, inner] of agg.entries()) {
          const list = [...inner.values()].sort((a, b) => b.amount - a.amount);
          out.set(party, list);
        }
        if (!cancelled) setByParty(out);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  return { byParty, loading };
}
