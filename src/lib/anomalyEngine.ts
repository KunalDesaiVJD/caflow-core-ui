/**
 * anomalyEngine — Phase 2B
 *
 * 8 anomaly-detection rules applied to Tally voucher data.
 * All rules run purely in-memory after a single DB fetch.
 *
 * Rules:
 *  1. round_number        — Amount is an exact multiple of ₹1,00,000
 *  2. late_entry          — Voucher in the last 7 days of the financial year
 *  3. credit_in_dr_ledger — Cr entry posted to a normally-Dr ledger (asset/expense)
 *  4. duplicate_amount    — Same ledger + same amount within 7 days, different vouchers
 *  5. no_narration        — No narration on entries ≥ ₹10,000
 *  6. party_not_in_tb     — party_ledger is not found in the trial balance
 *  7. high_value          — Entry is in the top 5 % by amount for that ledger (≥ 10 entries)
 *  8. inter_group_transfer — Same parent-group appears on both Dr and Cr sides of one voucher
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type AnomalyType =
  | "round_number"
  | "late_entry"
  | "credit_in_dr_ledger"
  | "duplicate_amount"
  | "no_narration"
  | "party_not_in_tb"
  | "high_value"
  | "inter_group_transfer";

export type AnomalySeverity = "high" | "medium" | "low";

export interface AnomalyFlag {
  id:             string;    // voucher_id + "_" + rule + optional index
  voucher_id:     string;
  voucher_date:   string;
  voucher_number: string;
  voucher_type:   string;
  ledger_name:    string;    // which ledger triggered this flag
  parent_group:   string;
  amount:         number;
  dr_cr:          string;
  narration:      string;
  flag_type:      AnomalyType;
  flag_detail:    string;    // human-readable explanation for auditor
  severity:       AnomalySeverity;
}

// ─── Internal input types ─────────────────────────────────────────────────────

interface LineItem {
  ledger_name: string;
  amount:      number;
  dr_cr:       string;
}

export interface VoucherRow {
  id:             string;
  voucher_date:   string | null;
  voucher_type:   string | null;
  voucher_number: string | null;
  party_ledger:   string | null;
  amount:         number | null;
  dr_cr:          string | null;
  narration:      string | null;
  line_items:     LineItem[] | null;
}

export interface TBRow {
  ledger_name:     string;
  parent_group:    string;
  closing_balance: number;
  balance_type:    string;   // "Dr" | "Cr"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmt(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });
}

/** Parse "2025-26" → March 31, 2026 */
export function fyEndDate(financialYear: string): Date {
  const m = financialYear.match(/^(\d{4})-(\d{2})$/);
  if (!m) return new Date("2026-03-31");
  const endYear = parseInt(m[1]) + 1;
  return new Date(`${endYear}-03-31`);
}

function safeDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function lineItems(v: VoucherRow): LineItem[] {
  if (!v.line_items) return [];
  if (!Array.isArray(v.line_items)) {
    try { return JSON.parse(v.line_items as unknown as string) as LineItem[]; }
    catch { return []; }
  }
  return v.line_items;
}

function makeBase(
  v: VoucherRow,
  rule:    AnomalyType,
  ledger:  string,
  group:   string,
  amount:  number,
  drCr:    string,
  detail:  string,
  sev:     AnomalySeverity,
  suffix = "",
): AnomalyFlag {
  return {
    id:             `${v.id}_${rule}${suffix}`,
    voucher_id:     v.id,
    voucher_date:   v.voucher_date ?? "",
    voucher_number: v.voucher_number ?? "",
    voucher_type:   v.voucher_type  ?? "",
    ledger_name:    ledger,
    parent_group:   group,
    amount,
    dr_cr:          drCr,
    narration:      v.narration ?? "",
    flag_type:      rule,
    flag_detail:    detail,
    severity:       sev,
  };
}

// ─── Rule implementations ─────────────────────────────────────────────────────

/** Rule 1 — Round-number entries (multiples of ₹1,00,000) */
function detectRoundNumbers(vouchers: VoucherRow[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  for (const v of vouchers) {
    const amt = Math.abs(v.amount ?? 0);
    if (amt === 0 || amt % 100_000 !== 0) continue;
    const sev: AnomalySeverity = amt >= 1_000_000 ? "high" : "medium";
    flags.push(makeBase(v, "round_number",
      v.party_ledger ?? v.voucher_type ?? "", "",
      amt, v.dr_cr ?? "",
      `Round-figure amount ₹${fmtAmt(amt)} — exact multiple of ₹1 lakh`,
      sev,
    ));
  }
  return flags;
}

/** Rule 2 — Late-in-year entries (last 7 days of FY) */
function detectLateEntries(vouchers: VoucherRow[], fyEnd: Date): AnomalyFlag[] {
  const cutoff = new Date(fyEnd);
  cutoff.setDate(cutoff.getDate() - 6); // Mar 25 when FY ends Mar 31
  const flags: AnomalyFlag[] = [];
  for (const v of vouchers) {
    const d = safeDate(v.voucher_date);
    if (!d || d < cutoff || d > fyEnd) continue;
    const amt = Math.abs(v.amount ?? 0);
    const sev: AnomalySeverity = amt >= 100_000 ? "high" : "medium";
    flags.push(makeBase(v, "late_entry",
      v.party_ledger ?? v.voucher_type ?? "", "",
      amt, v.dr_cr ?? "",
      `Year-end entry on ${v.voucher_date} — last 7 days of FY; needs justification`,
      sev,
    ));
  }
  return flags;
}

/** Rule 3 — Credit entry in a Dr-nature (asset/expense) ledger */
function detectCreditInDrLedger(
  vouchers: VoucherRow[],
  tbBalType: Map<string, string>,   // ledger_name → "Dr" | "Cr"
  tbGroup:   Map<string, string>,   // ledger_name → parent_group
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  for (const v of vouchers) {
    for (const item of lineItems(v)) {
      if (item.dr_cr !== "Cr") continue;
      if ((tbBalType.get(item.ledger_name) ?? "") !== "Dr") continue;
      if (Math.abs(item.amount) < 10_000) continue; // ignore tiny noise
      const grp = tbGroup.get(item.ledger_name) ?? "";
      flags.push(makeBase(v, "credit_in_dr_ledger",
        item.ledger_name, grp,
        Math.abs(item.amount), "Cr",
        `${item.ledger_name} is a Dr-nature ledger — Cr entry of ₹${fmtAmt(item.amount)} is unusual`,
        "high",
        `_${item.ledger_name.slice(0, 8)}`,
      ));
    }
  }
  return flags;
}

/** Rule 4 — Duplicate amounts (same ledger + amount + side within 7 days) */
function detectDuplicateAmounts(vouchers: VoucherRow[], tbGroup: Map<string, string>): AnomalyFlag[] {
  // Collect per (ledger, amount, dr_cr): list of (date, voucher)
  const buckets = new Map<string, { date: Date; voucher: VoucherRow; amount: number }[]>();
  for (const v of vouchers) {
    const d = safeDate(v.voucher_date);
    if (!d) continue;
    for (const item of lineItems(v)) {
      if (Math.abs(item.amount) < 5_000) continue;
      const key = `${item.ledger_name}|${Math.abs(item.amount)}|${item.dr_cr}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push({ date: d, voucher: v, amount: Math.abs(item.amount) });
    }
  }

  const flags: AnomalyFlag[] = [];
  const seen = new Set<string>(); // avoid double-flagging both sides of a pair

  for (const [key, entries] of buckets) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i];
      const b = entries[i + 1];
      if (a.voucher.id === b.voucher.id) continue;
      const diffDays = (b.date.getTime() - a.date.getTime()) / 86_400_000;
      if (diffDays > 7) continue;
      const pairKey = [a.voucher.id, b.voucher.id].sort().join("|");
      if (seen.has(pairKey + key)) continue;
      seen.add(pairKey + key);
      const parts = key.split("|");
      const ledger = parts[0];
      const grp = tbGroup.get(ledger) ?? "";
      flags.push(makeBase(a.voucher, "duplicate_amount",
        ledger, grp, a.amount, parts[2],
        `Duplicate ₹${fmtAmt(a.amount)} on ${a.voucher.voucher_date} and ${b.voucher.voucher_date} (${Math.round(diffDays)}d apart) — ${b.voucher.voucher_number || "another voucher"}`,
        "medium",
        `_dup_${i}`,
      ));
    }
  }
  return flags;
}

/** Rule 5 — No narration on significant entries */
function detectNoNarration(vouchers: VoucherRow[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  for (const v of vouchers) {
    if (v.narration?.trim()) continue;
    const amt = Math.abs(v.amount ?? 0);
    if (amt < 10_000) continue;
    const sev: AnomalySeverity = amt >= 500_000 ? "high" : amt >= 50_000 ? "medium" : "low";
    flags.push(makeBase(v, "no_narration",
      v.party_ledger ?? v.voucher_type ?? "", "",
      amt, v.dr_cr ?? "",
      `No narration on ₹${fmtAmt(amt)} ${v.voucher_type ?? "entry"} — purpose cannot be verified`,
      sev,
    ));
  }
  return flags;
}

/** Rule 6 — Party ledger not found in trial balance */
function detectPartyNotInTB(
  vouchers: VoucherRow[],
  tbNames:  Set<string>,
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  for (const v of vouchers) {
    if (!v.party_ledger?.trim()) continue;
    if (tbNames.has(v.party_ledger)) continue;
    const amt = Math.abs(v.amount ?? 0);
    if (amt < 1_000) continue;
    flags.push(makeBase(v, "party_not_in_tb",
      v.party_ledger, "",
      amt, v.dr_cr ?? "",
      `Party "${v.party_ledger}" not found in trial balance — possible ghost or unmapped ledger`,
      "medium",
    ));
  }
  return flags;
}

/** Rule 7 — High-value entries (top 5 % per ledger, min 10 entries) */
function detectHighValue(vouchers: VoucherRow[], tbGroup: Map<string, string>): AnomalyFlag[] {
  // Gather all absolute amounts per ledger (from line_items)
  const ledgerAmts = new Map<string, number[]>();
  for (const v of vouchers) {
    for (const item of lineItems(v)) {
      const a = Math.abs(item.amount);
      if (a < 1_000) continue;
      if (!ledgerAmts.has(item.ledger_name)) ledgerAmts.set(item.ledger_name, []);
      ledgerAmts.get(item.ledger_name)!.push(a);
    }
  }

  // p95 threshold per ledger (only if ≥ 10 entries)
  const thresholds = new Map<string, number>();
  for (const [ldr, amts] of ledgerAmts) {
    if (amts.length < 10) continue;
    const sorted = [...amts].sort((a, b) => a - b);
    thresholds.set(ldr, sorted[Math.floor(sorted.length * 0.95)]);
  }

  const flags: AnomalyFlag[] = [];
  for (const v of vouchers) {
    for (const item of lineItems(v)) {
      const thr = thresholds.get(item.ledger_name);
      if (!thr) continue;
      const a = Math.abs(item.amount);
      if (a <= thr) continue;
      const grp = tbGroup.get(item.ledger_name) ?? "";
      const pct = Math.round((a / thr) * 100);
      flags.push(makeBase(v, "high_value",
        item.ledger_name, grp,
        a, item.dr_cr,
        `₹${fmtAmt(a)} is ~${pct}% of the p95 threshold (₹${fmtAmt(thr)}) for ${item.ledger_name}`,
        a >= thr * 3 ? "high" : "low",
        `_hv_${item.ledger_name.slice(0, 8)}`,
      ));
    }
  }
  return flags;
}

/** Rule 8 — Inter-group transfers (Dr and Cr in same parent group in one voucher) */
function detectInterGroupTransfers(
  vouchers: VoucherRow[],
  tbGroup:  Map<string, string>,
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  for (const v of vouchers) {
    const items = lineItems(v);
    if (items.length < 2) continue;

    const drGroups = new Set<string>();
    const crGroups = new Set<string>();
    for (const item of items) {
      const g = tbGroup.get(item.ledger_name);
      if (!g) continue;
      if (item.dr_cr === "Dr") drGroups.add(g);
      else crGroups.add(g);
    }

    const common: string[] = [];
    for (const g of drGroups) if (crGroups.has(g)) common.push(g);
    if (common.length === 0) continue;

    // Only flag if the shared group looks like same-group shuffling
    // (skip obvious cases like Cash/Bank which routinely appear on both sides)
    const skip = new Set(["Cash-in-Hand", "Bank Accounts", "Bank OD A/c"]);
    const meaningful = common.filter(g => !skip.has(g));
    if (meaningful.length === 0) continue;

    const amt = Math.abs(v.amount ?? 0);
    flags.push(makeBase(v, "inter_group_transfer",
      v.party_ledger ?? "", meaningful[0],
      amt, v.dr_cr ?? "",
      `Dr and Cr entries both in "${meaningful[0]}" — within-group transfer; verify legitimacy`,
      "medium",
    ));
  }
  return flags;
}

// ─── Public orchestrator ──────────────────────────────────────────────────────

export interface AnomalyReport {
  flags:         AnomalyFlag[];
  totalVouchers: number;
  scannedAt:     string;
}

export function runAnomalyDetection(
  vouchers:       VoucherRow[],
  tb:             TBRow[],
  financialYear:  string,
): AnomalyReport {
  // Build lookup maps from TB
  const tbBalType = new Map<string, string>(tb.map(r => [r.ledger_name, r.balance_type]));
  const tbGroup   = new Map<string, string>(tb.map(r => [r.ledger_name, r.parent_group]));
  const tbNames   = new Set<string>(tb.map(r => r.ledger_name));
  const fyEnd     = fyEndDate(financialYear);

  const all: AnomalyFlag[] = [
    ...detectRoundNumbers(vouchers),
    ...detectLateEntries(vouchers, fyEnd),
    ...detectCreditInDrLedger(vouchers, tbBalType, tbGroup),
    ...detectDuplicateAmounts(vouchers, tbGroup),
    ...detectNoNarration(vouchers),
    ...detectPartyNotInTB(vouchers, tbNames),
    ...detectHighValue(vouchers, tbGroup),
    ...detectInterGroupTransfers(vouchers, tbGroup),
  ];

  // Deduplicate by id (each flag has a unique id based on voucher + rule)
  const seen = new Set<string>();
  const deduped = all.filter(f => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  // Sort: high severity first, then by date desc
  deduped.sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 };
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    return b.voucher_date.localeCompare(a.voucher_date);
  });

  return {
    flags:         deduped,
    totalVouchers: vouchers.length,
    scannedAt:     new Date().toISOString(),
  };
}

// ─── Rule metadata (for UI labels / colours) ──────────────────────────────────

export const ANOMALY_META: Record<AnomalyType, {
  label:       string;
  description: string;
  color:       string;  // tailwind bg class
  textColor:   string;  // tailwind text class
}> = {
  round_number:         { label: "Round Number",        description: "Exact ₹1L multiples",         color: "bg-violet-100", textColor: "text-violet-700" },
  late_entry:           { label: "Late Entry",          description: "Last 7 days of FY",            color: "bg-red-100",    textColor: "text-red-700"    },
  credit_in_dr_ledger:  { label: "Unusual Dr/Cr",       description: "Cr posted to Dr-nature ledger",color: "bg-orange-100", textColor: "text-orange-700" },
  duplicate_amount:     { label: "Duplicate Amount",    description: "Same ledger+amount in 7 days", color: "bg-yellow-100", textColor: "text-yellow-700" },
  no_narration:         { label: "No Narration",        description: "Blank narration ≥ ₹10K",       color: "bg-slate-100",  textColor: "text-slate-600"  },
  party_not_in_tb:      { label: "Unknown Party",       description: "Party not in trial balance",   color: "bg-pink-100",   textColor: "text-pink-700"   },
  high_value:           { label: "High-Value Entry",    description: "Top 5% by amount for ledger",  color: "bg-blue-100",   textColor: "text-blue-700"   },
  inter_group_transfer: { label: "Inter-Group Transfer",description: "Dr & Cr in same group",        color: "bg-teal-100",   textColor: "text-teal-700"   },
};

export const SEV_META: Record<AnomalySeverity, { dot: string; label: string }> = {
  high:   { dot: "bg-red-500",    label: "High"   },
  medium: { dot: "bg-amber-400",  label: "Medium" },
  low:    { dot: "bg-blue-400",   label: "Low"    },
};
