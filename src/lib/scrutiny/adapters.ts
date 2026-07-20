/**
 * Adapters — map real Supabase row shapes ↔ the scrutiny engine's types.
 *
 * Pure and dependency-free (no supabase client), so the full DB→engine→DB pipeline is
 * unit-testable without a database. The edge function (run-scrutiny / v2) does only the I/O:
 * fetch rows → `tbFromSnapshot` / `vouchersFromSnapshot` / `rulesFromRows` → `runDetection`
 * → `findingToRow` → insert.
 *
 * Source of truth for the scrutiny data path is `trial_balance_snapshots`
 * (`normalised_data` = account grain, `raw_data` = voucher grain) — the same source the existing
 * `run-scrutiny` function and PipelineStage4 use — NOT the `tally_*` tables.
 */

import type { ScrutinyRule, TBRow, VoucherRow, ScrutinyFinding, DetectionLogic, FaAssetRow } from "./detectionEngine.ts";

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

// ---------------------------------------------------------------------------
// detection_logic (jsonb may arrive as an object or a JSON string)
// ---------------------------------------------------------------------------

export function parseDetectionLogic(raw: unknown): DetectionLogic {
  if (raw == null) return { check: "" };
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? (o as DetectionLogic) : { check: "" };
    } catch {
      return { check: "" };
    }
  }
  if (typeof raw === "object") return raw as DetectionLogic;
  return { check: "" };
}

// ---------------------------------------------------------------------------
// scrutiny_rules row -> ScrutinyRule
// ---------------------------------------------------------------------------

export interface ScrutinyRuleRow {
  rule_id: string;
  rule_name?: string | null;
  category?: string | null;
  detection_level?: string | null;
  detection_logic?: unknown;
  threshold_value?: number | string | null;
  threshold_type?: string | null;
  audit_query_template?: string | null;
  severity?: string | null;
  legal_reference?: string | null;
  is_active?: boolean | null;
  /** entity buckets (jsonb array / csv). empty = all entities. */
  applicable_to?: unknown;
  /** comma-separated Tally ledger-name variants for this rule's family (the ledger-name connection). */
  keywords_ledger_synonyms?: string | null;
}

/** parse applicable_to (jsonb array | JSON string | csv) into a lowercased string[]. */
function parseApplicableTo(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) {
    try { const o = JSON.parse(raw); if (Array.isArray(o)) return o.map((x) => String(x).toLowerCase().trim()).filter(Boolean); } catch { /* csv */ }
    return raw.split(",").map((x) => x.toLowerCase().trim()).filter(Boolean);
  }
  return [];
}

export function ruleFromRow(row: ScrutinyRuleRow): ScrutinyRule {
  const detection_logic = parseDetectionLogic(row.detection_logic);

  // Ledger-name connection: merge the rule's Tally-name synonyms into scope.ledger_keywords so
  // generic handlers match real Tally ledger names. Only when the rule has NO parent_group/group
  // condition — kwMatch over ledger_keywords is OR, so appending synonyms only WIDENS the match and
  // never narrows a rule that already scopes by group (which would be an unwanted AND).
  const syn = (row.keywords_ledger_synonyms ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (syn.length) {
    const dl = detection_logic as unknown as Record<string, unknown>;
    const scope = (dl.scope && typeof dl.scope === "object" && !Array.isArray(dl.scope)) ? (dl.scope as Record<string, unknown>) : undefined;
    if (!scope || (!scope.parent_group_keywords && !scope.group)) {
      const sc = scope ?? {};
      const existing = Array.isArray(sc.ledger_keywords) ? (sc.ledger_keywords as unknown[]).map((s) => String(s).toLowerCase()) : [];
      sc.ledger_keywords = [...new Set([...existing, ...syn])];
      dl.scope = sc;
    }
  }

  return {
    rule_id: row.rule_id,
    rule_name: row.rule_name ?? row.rule_id,
    category: row.category ?? (row.rule_id.split("-")[0] ?? ""),
    detection_level: row.detection_level ?? "voucher",
    detection_logic,
    threshold_value: row.threshold_value == null ? null : n(row.threshold_value),
    threshold_type: row.threshold_type ?? null,
    audit_query_template: row.audit_query_template ?? null,
    severity: row.severity ?? "medium",
    legal_reference: row.legal_reference ?? null,
    applicable_to: parseApplicableTo(row.applicable_to),
  };
}

const CORP_HINTS = ["company", "private ltd", "public ltd", "pvt ltd", "pvt. ltd"];
const NONCORP_HINTS = ["llp", "partnership", "individual", "firm", "trust", "huf", "aop", "proprietor", "society"];

/**
 * true if a rule applies to a client's entity bucket ("corporate" | "non_corporate").
 * Handles the new bucket format (["corporate"]) AND the legacy entity-name format
 * (["company","llp",...]) so migrating rules to buckets is non-breaking: a rule listing both a
 * corporate and a non-corporate entity name resolves to "both" until it is explicitly bucketed.
 */
export function ruleAppliesToEntity(rule: ScrutinyRule, bucket: string): boolean {
  const at = rule.applicable_to;
  if (!at || at.length === 0) return true;
  if (at.includes(bucket) || at.includes("both") || at.includes("all")) return true;
  const hints = bucket === "corporate" ? CORP_HINTS : NONCORP_HINTS;
  return at.some((x) => hints.some((h) => x.includes(h)));
}

/** Active rules only, mapped to engine rules. */
export function rulesFromRows(rows: ScrutinyRuleRow[] | null | undefined): ScrutinyRule[] {
  return (rows ?? []).filter((r) => r.is_active !== false).map(ruleFromRow);
}

// ---------------------------------------------------------------------------
// trial_balance_snapshots.normalised_data -> TBRow[]  (account grain)
// ---------------------------------------------------------------------------

export interface SnapshotLedgerRow {
  account_name?: string | null;
  ledger_name?: string | null;
  account_group?: string | null;
  parent_group?: string | null;
  debit?: number | string | null;
  credit?: number | string | null;
  closing_dr?: number | string | null;
  closing_cr?: number | string | null;
  opening_dr?: number | string | null;
  opening_cr?: number | string | null;
}

export function tbFromSnapshot(rows: SnapshotLedgerRow[] | null | undefined): TBRow[] {
  return (rows ?? []).map((r) => {
    const dr = n(r.debit) || n(r.closing_dr);
    const cr = n(r.credit) || n(r.closing_cr);
    const net = dr - cr;
    const openNet = n(r.opening_dr) - n(r.opening_cr);
    return {
      ledger_name: String(r.account_name ?? r.ledger_name ?? "").trim(),
      parent_group: r.account_group ?? r.parent_group ?? null,
      closing_balance: Math.abs(net),
      balance_type: net >= 0 ? "Dr" : "Cr",
      debit_amount: dr,
      credit_amount: cr,
      opening_balance: Math.abs(openNet),
      opening_type: openNet >= 0 ? "Dr" : "Cr",
    };
  });
}

// ---------------------------------------------------------------------------
// tally_trial_balance (live Tally Sync output) -> TBRow[]  (account grain)
// The sync agent writes per-ledger balances directly, so scrutiny reads them without an
// intermediate trial_balance_snapshots row. Mirrors the production tally_trial_balance shape.
// ---------------------------------------------------------------------------

export interface TallyTBRow {
  ledger_name?: string | null;
  parent_group?: string | null;
  opening_balance?: number | string | null;
  opening_type?: string | null;
  closing_balance?: number | string | null;
  balance_type?: string | null;
  debit_amount?: number | string | null;
  credit_amount?: number | string | null;
}

export function tbFromTallyTB(rows: TallyTBRow[] | null | undefined): TBRow[] {
  return (rows ?? []).map((r) => ({
    ledger_name: String(r.ledger_name ?? "").trim(),
    parent_group: r.parent_group ?? null,
    closing_balance: Math.abs(n(r.closing_balance)),
    balance_type: String(r.balance_type ?? "").toLowerCase().startsWith("c") ? "Cr" : "Dr",
    debit_amount: n(r.debit_amount),
    credit_amount: n(r.credit_amount),
    opening_balance: Math.abs(n(r.opening_balance)),
    opening_type: String(r.opening_type ?? "").toLowerCase().startsWith("c") ? "Cr" : "Dr",
  }));
}

// ---------------------------------------------------------------------------
// trial_balance_snapshots.raw_data -> VoucherRow[]  (voucher grain)
// ---------------------------------------------------------------------------

export interface SnapshotVoucherRow {
  amount?: number | string | null;
  debit_credit?: string | null;
  dr_cr?: string | null;
  date?: string | null;
  voucher_date?: string | null;
  voucher_number?: string | null;
  voucher_type?: string | null;
  party_ledger?: string | null;
  party?: string | null;
  ledger_name?: string | null;
  account_name?: string | null;
  narration?: string | null;
  /** tally_vouchers.line_items — the full double entry (kept so cross-leg checks can run) */
  line_items?: unknown;
}

/** Map raw line_items ([{ledger_name,dr_cr,amount}]) into VoucherLeg[], or undefined if absent. */
function legsFrom(raw: unknown): VoucherRow["line_items"] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((li) => {
    const o = (li ?? {}) as Record<string, unknown>;
    return {
      ledger_name: (o.ledger_name ?? o.account_name ?? null) as string | null,
      dr_cr: (o.dr_cr ?? o.debit_credit ?? null) as VoucherRow["dr_cr"],
      amount: n(o.amount),
    };
  });
}

export function vouchersFromSnapshot(rows: SnapshotVoucherRow[] | null | undefined): VoucherRow[] {
  return (rows ?? []).map((r) => ({
    amount: n(r.amount),
    dr_cr: (r.dr_cr ?? r.debit_credit ?? null) as VoucherRow["dr_cr"],
    voucher_date: String(r.voucher_date ?? r.date ?? ""),
    voucher_number: r.voucher_number ?? null,
    voucher_type: r.voucher_type ?? null,
    party_ledger: r.party_ledger ?? r.party ?? null,
    ledger_name: r.ledger_name ?? r.account_name ?? null,
    narration: r.narration ?? null,
    line_items: legsFrom(r.line_items),
  }));
}

// ---------------------------------------------------------------------------
// fa_assets (fixed-asset register) -> FaAssetRow[]  (enables depreciation checks)
// ---------------------------------------------------------------------------

export interface FaAssetSourceRow {
  asset_name?: string | null;
  gross_block_closing?: number | string | null;
  wdv_closing?: number | string | null;
  accumulated_dep_closing?: number | string | null;
  depreciation_for_year?: number | string | null;
  is_fully_depreciated?: boolean | null;
  disposals_during_year?: number | string | null;
  disposal_date?: string | null;
}

export function faFromRows(rows: FaAssetSourceRow[] | null | undefined): FaAssetRow[] {
  return (rows ?? []).map((r) => ({
    asset_name: r.asset_name ?? null,
    gross_block_closing: n(r.gross_block_closing),
    wdv_closing: n(r.wdv_closing),
    accumulated_dep_closing: n(r.accumulated_dep_closing),
    depreciation_for_year: n(r.depreciation_for_year),
    is_fully_depreciated: r.is_fully_depreciated === true,
    disposals_during_year: n(r.disposals_during_year),
    disposal_date: r.disposal_date ?? null,
  }));
}

// ---------------------------------------------------------------------------
// ScrutinyFinding -> scrutiny_findings insert row (existing client_id/FY shape)
// ---------------------------------------------------------------------------

export interface FindingRow {
  client_id: string;
  financial_year: string;
  status: string;
  rule_id: string;
  severity: string;
  flag_message: string;
  clause_3cd: string | null;
  narration: string | null;
  /** "query" = client-facing shortlist, "note" = internal review list */
  tier: string;
}

export function findingToRow(
  f: ScrutinyFinding,
  ctx: { client_id: string; financial_year: string },
): FindingRow {
  return {
    client_id: ctx.client_id,
    financial_year: ctx.financial_year,
    status: "open",
    rule_id: f.rule_id,
    // legacy scrutiny_findings + AuditScrutiny use HIGH/MEDIUM/LOW
    severity: String(f.severity ?? "medium").toUpperCase(),
    flag_message: f.flag_message,
    clause_3cd: null,
    narration: f.account ?? null,
    // Untiered findings default to "query" so an older caller that never ran triage keeps its
    // current visibility rather than silently vanishing from the auditor's list.
    tier: f.tier ?? "query",
  };
}
