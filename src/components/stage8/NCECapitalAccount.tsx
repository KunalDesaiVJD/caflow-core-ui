import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PartnerRow {
  partner_no: number;          // dynamic 1 … N
  partner_name: string;
  profit_share_pct: number;
  opening_balance_cy: number;
  introduced_cy: number;
  remuneration_cy: number;
  interest_cy: number;
  withdrawals_cy: number;
  profit_share_cy: number;
}

interface PyRow {
  opening: number;
  introduced: number;
  remuneration: number;
  interest: number;
  withdrawals: number;
  profit_share: number;
}

interface PyPartnerRow {
  partner_no: number;   // 100, 101, 102 … (PY_PARTNER_BASE range)
  partner_name: string;
  opening: number;
  introduced: number;
  remuneration: number;
  interest: number;
  withdrawals: number;
  profit_share: number;
}

// PY aggregate is stored as partner_no = 99 (sentinel value)
const PY_SENTINEL = 99;
// PY per-partner rows use partner_no >= 100
const PY_PARTNER_BASE = 100;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyPartner(num: number): PartnerRow {
  return {
    partner_no: num, partner_name: "",
    profit_share_pct: 0, opening_balance_cy: 0,
    introduced_cy: 0, remuneration_cy: 0,
    interest_cy: 0, withdrawals_cy: 0, profit_share_cy: 0,
  };
}

/** Convert a ledger name to Proper Case for the partner-name field, e.g.
 *  "rajesh kumar shah" → "Rajesh Kumar Shah", "ABC ENTERPRISES" → "Abc Enterprises". */
function properCase(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

const EMPTY_PY: PyRow = {
  opening: 0, introduced: 0, remuneration: 0,
  interest: 0, withdrawals: 0, profit_share: 0,
};

function calcClosing(p: PartnerRow): number {
  return p.opening_balance_cy
    + p.introduced_cy
    + p.remuneration_cy
    + p.interest_cy
    - p.withdrawals_cy
    + p.profit_share_cy;
}

function calcPyClosing(py: PyRow): number {
  return py.opening + py.introduced + py.remuneration
       + py.interest - py.withdrawals + py.profit_share;
}

// Inline numeric input — defined outside component to avoid React warning
function NumInput({
  value, onChange, className,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <Input
      type="number"
      value={value === 0 ? "" : value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={cn("h-7 text-xs text-right px-1 w-24", className)}
    />
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
  /** Task 1 (doc6): when true, entire Capital Account is read-only (locked preview mode) */
  readOnly?: boolean;
}

export function NCECapitalAccount({ engagementId, readOnly = false }: Props) {
  // Start with a single partner by default — user adds more via "Add Partner"
  const [partners,    setPartners]    = useState<PartnerRow[]>([emptyPartner(1)]);
  const [pyRow,       setPyRow]       = useState<PyRow>(EMPTY_PY);
  const [pyPartners,  setPyPartners]  = useState<PyPartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [eng,     setEng]     = useState<any>(null);
  // Track partner_no values that existed in DB but have been removed in the
  // UI so `save()` can delete the stale rows.
  const [deletedPartnerNos,   setDeletedPartnerNos]   = useState<number[]>([]);
  const [deletedPyPartnerNos, setDeletedPyPartnerNos] = useState<number[]>([]);

  // ── Derived year labels (from self-fetched engagement) ───────────────────
  const fy      = (eng?.financial_year as string) || "";
  const cyYear  = fy ? parseInt(fy.split("-")[1]) + 2000 : new Date().getFullYear();
  const pyYear  = cyYear - 1;
  const clientName: string = eng?.clients?.name || "";

  // ── Load saved rows ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      // 1. Fetch engagement — get FY, client name, firm, partner, coa_mapping
      const { data: engRow } = await supabase
        .from("audit_engagements")
        .select("financial_year, coa_mapping, clients(name), firms(*), partner:users!partner_id(name)")
        .eq("id", engagementId)
        .single();
      if (cancelled) return;
      if (engRow) setEng(engRow);

      // Partner names auto-sourced from COA Mapping: every ledger mapped to the
      // Owners' Capital Account code (NCE_CAP) becomes a partner row, Proper-
      // Cased and editable. Used to seed the table when nothing is saved yet.
      const coaMapping = (engRow?.coa_mapping ?? {}) as Record<string, { code?: string }>;
      const capitalLedgerNames = Object.entries(coaMapping)
        .filter(([, v]) => (v as any)?.code === "NCE_CAP")
        .map(([name]) => name)
        .filter(Boolean);
      const autoPartners: PartnerRow[] = capitalLedgerNames.map((name, i) => ({
        ...emptyPartner(i + 1),
        partner_name: properCase(name),
      }));

      const activeFY = (engRow?.financial_year as string) || "";
      if (!activeFY) { setLoading(false); return; }

      // 2. Fetch capital account rows
      const { data, error } = await supabase
        .from("nce_capital_account")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("financial_year", activeFY);

      if (error) {
        toast.error("Failed to load capital account data");
        // Even on error, seed names from COA mapping so the auditor isn't blank.
        if (autoPartners.length > 0) setPartners(autoPartners);
      } else if (data && data.length > 0) {
        // CY partner rows: partner_no in [1, PY_SENTINEL-1]
        const savedPartners = data
          .filter(r => r.partner_no < PY_SENTINEL)
          .sort((a, b) => a.partner_no - b.partner_no)
          .map(row => ({
            partner_no:         row.partner_no,
            partner_name:       row.partner_name        ?? "",
            profit_share_pct:   row.profit_share_pct    ?? 0,
            opening_balance_cy: row.opening_balance_cy  ?? 0,
            introduced_cy:      row.introduced_cy       ?? 0,
            remuneration_cy:    row.remuneration_cy     ?? 0,
            interest_cy:        row.interest_cy         ?? 0,
            withdrawals_cy:     row.withdrawals_cy      ?? 0,
            profit_share_cy:    row.profit_share_cy     ?? 0,
          }));
        if (savedPartners.length > 0) setPartners(savedPartners);
        else if (autoPartners.length > 0) setPartners(autoPartners);

        // PY aggregate row (sentinel = 99) — used when no per-partner PY rows
        const py = data.find(r => r.partner_no === PY_SENTINEL);
        if (py) {
          setPyRow({
            opening:      py.opening_balance_cy ?? 0,
            introduced:   py.introduced_cy      ?? 0,
            remuneration: py.remuneration_cy    ?? 0,
            interest:     py.interest_cy        ?? 0,
            withdrawals:  py.withdrawals_cy     ?? 0,
            profit_share: py.profit_share_cy    ?? 0,
          });
        }

        // PY per-partner rows: partner_no >= PY_PARTNER_BASE (100+)
        const savedPyPartners = data
          .filter(r => r.partner_no >= PY_PARTNER_BASE)
          .sort((a, b) => a.partner_no - b.partner_no)
          .map(row => ({
            partner_no:   row.partner_no,
            partner_name: row.partner_name        ?? "",
            opening:      row.opening_balance_cy  ?? 0,
            introduced:   row.introduced_cy       ?? 0,
            remuneration: row.remuneration_cy     ?? 0,
            interest:     row.interest_cy         ?? 0,
            withdrawals:  row.withdrawals_cy      ?? 0,
            profit_share: row.profit_share_cy     ?? 0,
          }));
        if (savedPyPartners.length > 0) setPyPartners(savedPyPartners);
      } else if (autoPartners.length > 0) {
        // No saved capital-account rows yet → seed partner names from the
        // ledgers mapped to "(a) Owners' Capital Account" in COA Mapping.
        setPartners(autoPartners);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Computed totals (CY) ──────────────────────────────────────────────────
  const totals = useMemo(() => ({
    opening:      partners.reduce((s, p) => s + p.opening_balance_cy, 0),
    introduced:   partners.reduce((s, p) => s + p.introduced_cy, 0),
    remuneration: partners.reduce((s, p) => s + p.remuneration_cy, 0),
    interest:     partners.reduce((s, p) => s + p.interest_cy, 0),
    withdrawals:  partners.reduce((s, p) => s + p.withdrawals_cy, 0),
    profit_share: partners.reduce((s, p) => s + p.profit_share_cy, 0),
    closing:      partners.reduce((s, p) => s + calcClosing(p), 0),
    pct:          partners.reduce((s, p) => s + p.profit_share_pct, 0),
  }), [partners]);

  const profitShareWarning =
    totals.pct > 0 && Math.abs(totals.pct - 100) > 0.01;

  // ── Mutators ─────────────────────────────────────────────────────────────
  const setPartnerField = (
    idx: number,
    field: keyof PartnerRow,
    value: string | number
  ) =>
    setPartners(prev =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );

  const setPyField = (field: keyof PyRow, value: number) =>
    setPyRow(prev => ({ ...prev, [field]: value }));

  const setPyPartnerField = (idx: number, field: keyof PyPartnerRow, value: string | number) =>
    setPyPartners(prev => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));

  const addPartner = () => {
    setPartners(prev => {
      // Allocate a new partner_no that is not the PY sentinel and not already
      // used — this keeps the unique (engagement, fy, partner_no) constraint
      // satisfied across adds.
      const used = new Set(prev.map(p => p.partner_no));
      let next = 1;
      while (used.has(next) || next === PY_SENTINEL) next++;
      return [...prev, emptyPartner(next)];
    });
  };

  const addPyPartner = () => {
    setPyPartners(prev => {
      const used = new Set(prev.map(p => p.partner_no));
      let next = PY_PARTNER_BASE;
      while (used.has(next)) next++;
      return [...prev, {
        partner_no: next, partner_name: "",
        opening: 0, introduced: 0, remuneration: 0,
        interest: 0, withdrawals: 0, profit_share: 0,
      }];
    });
  };

  const removePartner = (idx: number) => {
    setPartners(prev => {
      if (prev.length <= 1) return prev; // keep at least one row
      const removed = prev[idx];
      setDeletedPartnerNos(d => [...d, removed.partner_no]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const removePyPartner = (idx: number) => {
    setPyPartners(prev => {
      const removed = prev[idx];
      setDeletedPyPartnerNos(d => [...d, removed.partner_no]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = async () => {
    // 2026-06-01 — Guard against silent data loss reported on MAHARSH INFRA
    // (Capital Account + PPE Schedule wiped to empty cells after a Re-sync
    // from COA on the Notes tab). The Re-sync path doesn't touch
    // nce_capital_account, but if Save was clicked while the in-memory
    // partner amounts were all 0 (e.g. before the load completed, or after
    // an error swallowed the load) the upsert would persist zeros over
    // genuine non-zero saved data.
    //
    // Defence: if every current-year partner row has zero amounts AND the
    // engagement clearly has been populated before (non-zero in any field
    // would have come from a load), block the save. The auditor must make at
    // least one non-zero entry first — protects against accidentally wiping
    // real data while still allowing genuine "all-zero start" first saves
    // when they confirm via the dialog.
    const allZeroPartners = partners.every(p =>
      !p.profit_share_pct &&
      !p.opening_balance_cy && !p.introduced_cy &&
      !p.remuneration_cy && !p.interest_cy &&
      !p.withdrawals_cy   && !p.profit_share_cy,
    );
    const allZeroPy = pyPartners.length === 0
      ? !pyRow.opening && !pyRow.introduced && !pyRow.remuneration
        && !pyRow.interest && !pyRow.withdrawals && !pyRow.profit_share
      : pyPartners.every(p =>
          !p.opening && !p.introduced && !p.remuneration
          && !p.interest && !p.withdrawals && !p.profit_share);
    if (allZeroPartners && allZeroPy) {
      const ok = window.confirm(
        "Every Capital Account amount is zero.\n\n" +
        "Saving now will OVERWRITE any previously-saved capital amounts with zeros. " +
        "If the table looks empty because the page just loaded, click Cancel and wait for the data to appear first.\n\n" +
        "Click OK only if you genuinely want to clear all capital balances.",
      );
      if (!ok) { return; }
    }
    setSaving(true);
    try {
      // 1. Delete rows for CY partners removed in this session
      if (deletedPartnerNos.length > 0) {
        const { error: delErr } = await supabase
          .from("nce_capital_account")
          .delete()
          .eq("engagement_id", engagementId)
          .eq("financial_year", fy)
          .in("partner_no", deletedPartnerNos);
        if (delErr) throw delErr;
      }
      // 2. Delete rows for PY partners removed in this session
      if (deletedPyPartnerNos.length > 0) {
        const { error: delErr } = await supabase
          .from("nce_capital_account")
          .delete()
          .eq("engagement_id", engagementId)
          .eq("financial_year", fy)
          .in("partner_no", deletedPyPartnerNos);
        if (delErr) throw delErr;
      }

      // Compute PY aggregate from per-partner rows when they exist
      const pyAgg: PyRow = pyPartners.length > 0
        ? {
            opening:      pyPartners.reduce((s, p) => s + p.opening, 0),
            introduced:   pyPartners.reduce((s, p) => s + p.introduced, 0),
            remuneration: pyPartners.reduce((s, p) => s + p.remuneration, 0),
            interest:     pyPartners.reduce((s, p) => s + p.interest, 0),
            withdrawals:  pyPartners.reduce((s, p) => s + p.withdrawals, 0),
            profit_share: pyPartners.reduce((s, p) => s + p.profit_share, 0),
          }
        : pyRow;

      const rows = [
        ...partners.map(p => ({
          engagement_id:      engagementId,
          financial_year:     fy,
          partner_no:         p.partner_no,
          partner_name:       p.partner_name || null,
          profit_share_pct:   p.profit_share_pct,
          opening_balance_cy: p.opening_balance_cy,
          introduced_cy:      p.introduced_cy,
          remuneration_cy:    p.remuneration_cy,
          interest_cy:        p.interest_cy,
          withdrawals_cy:     p.withdrawals_cy,
          profit_share_cy:    p.profit_share_cy,
        })),
        // PY aggregate stored as partner_no = 99 (always saved for backward compat)
        {
          engagement_id:      engagementId,
          financial_year:     fy,
          partner_no:         PY_SENTINEL,
          partner_name:       "Previous Year",
          profit_share_pct:   null,
          opening_balance_cy: pyAgg.opening,
          introduced_cy:      pyAgg.introduced,
          remuneration_cy:    pyAgg.remuneration,
          interest_cy:        pyAgg.interest,
          withdrawals_cy:     pyAgg.withdrawals,
          profit_share_cy:    pyAgg.profit_share,
        },
        // PY per-partner rows (partner_no >= 100)
        ...pyPartners.map(p => ({
          engagement_id:      engagementId,
          financial_year:     fy,
          partner_no:         p.partner_no,
          partner_name:       p.partner_name || null,
          profit_share_pct:   null,
          opening_balance_cy: p.opening,
          introduced_cy:      p.introduced,
          remuneration_cy:    p.remuneration,
          interest_cy:        p.interest,
          withdrawals_cy:     p.withdrawals,
          profit_share_cy:    p.profit_share,
        })),
      ];

      const { error } = await supabase
        .from("nce_capital_account")
        .upsert(rows, {
          onConflict: "engagement_id,financial_year,partner_no",
        });

      if (error) throw error;
      setDeletedPartnerNos([]);
      setDeletedPyPartnerNos([]);

      // 2026-05-30 — Re-fetch from DB after a successful save so what the
      // user sees on screen is ALWAYS the persisted state, not the in-memory
      // form values. Reported issue: 'changed amount → hit Save → old amount
      // still shown'. If the upsert dropped any field (column mismatch,
      // constraint failure on one row of the batch, etc.) the re-fetch
      // surfaces the divergence immediately instead of leaving stale state.
      const { data: refreshed, error: refetchErr } = await supabase
        .from("nce_capital_account")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("financial_year", fy);
      if (!refetchErr && refreshed) {
        const reloadedPartners = refreshed
          .filter(r => r.partner_no < PY_SENTINEL)
          .sort((a, b) => a.partner_no - b.partner_no)
          .map(row => ({
            partner_no:         row.partner_no,
            partner_name:       row.partner_name        ?? "",
            profit_share_pct:   row.profit_share_pct    ?? 0,
            opening_balance_cy: row.opening_balance_cy  ?? 0,
            introduced_cy:      row.introduced_cy       ?? 0,
            remuneration_cy:    row.remuneration_cy     ?? 0,
            interest_cy:        row.interest_cy         ?? 0,
            withdrawals_cy:     row.withdrawals_cy      ?? 0,
            profit_share_cy:    row.profit_share_cy     ?? 0,
          }));
        if (reloadedPartners.length > 0) setPartners(reloadedPartners);

        const refreshedPy = refreshed.find(r => r.partner_no === PY_SENTINEL);
        if (refreshedPy) {
          setPyRow({
            opening:      refreshedPy.opening_balance_cy ?? 0,
            introduced:   refreshedPy.introduced_cy      ?? 0,
            remuneration: refreshedPy.remuneration_cy    ?? 0,
            interest:     refreshedPy.interest_cy        ?? 0,
            withdrawals:  refreshedPy.withdrawals_cy     ?? 0,
            profit_share: refreshedPy.profit_share_cy    ?? 0,
          });
        }

        const reloadedPyPartners = refreshed
          .filter(r => r.partner_no >= PY_PARTNER_BASE)
          .sort((a, b) => a.partner_no - b.partner_no)
          .map(row => ({
            partner_no:   row.partner_no,
            partner_name: row.partner_name        ?? "",
            opening:      row.opening_balance_cy  ?? 0,
            introduced:   row.introduced_cy       ?? 0,
            remuneration: row.remuneration_cy     ?? 0,
            interest:     row.interest_cy         ?? 0,
            withdrawals:  row.withdrawals_cy      ?? 0,
            profit_share: row.profit_share_cy     ?? 0,
          }));
        setPyPartners(reloadedPyPartners);
      }

      toast.success("Capital Account saved");
    } catch (e: any) {
      console.error("[NCECapitalAccount.save]", e);
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Formatting ────────────────────────────────────────────────────────────
  // Whole-rupee Indian formatting — Schedule III auditor-friendly (no paise).
  const fmt = (n: number) => {
    if (!Number.isFinite(n) || Math.abs(n) < 0.5) return "—";
    const abs = Math.round(Math.abs(n)).toLocaleString("en-IN", {
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    return n < 0 ? `(${abs})` : abs;
  };

  // ── Loading guard ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`space-y-4${readOnly ? " pointer-events-none select-none" : ""}`}>

      {/* ── Header ── */}
      <div className="text-center space-y-1 pb-3 border-b">
        {clientName && (
          <p className="font-bold text-sm text-foreground">{clientName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Notes forming part of the Financial Statements for the year ended,
          31st March, {cyYear}
        </p>
        <p className="text-xs text-muted-foreground">
          Notes to Balance Sheet as at 31st March, {cyYear}
        </p>
        <p className="text-sm font-semibold text-foreground mt-1">
          Note: Owners Capital Account
        </p>
      </div>

      {/* ── Profit-share warning ── */}
      {profitShareWarning && (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Share of profit/loss % totals{" "}
            <strong>{totals.pct.toFixed(2)}%</strong> — must equal 100%.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border">
        <Table className="text-xs min-w-[960px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-12 text-center">Sr. No.</TableHead>
              <TableHead className="min-w-[150px]">Name of Partner</TableHead>
              <TableHead className="text-right w-20">
                Share of profit/ (loss)%
              </TableHead>
              <TableHead className="text-right w-28">Opening Balance</TableHead>
              <TableHead className="text-right w-28">
                Introduced/ Contributed
              </TableHead>
              <TableHead className="text-right w-28">
                Remuneration for the year
              </TableHead>
              <TableHead className="text-right w-24">
                Interest for the year
              </TableHead>
              <TableHead className="text-right w-28">
                Withdrawals during the year
              </TableHead>
              <TableHead className="text-right w-28">
                Share of Profit/ (Loss)
              </TableHead>
              <TableHead className="text-right w-28 bg-primary/5 font-semibold">
                Closing Balance
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {/* ── Partner rows (dynamic) ── */}
            {partners.map((p, i) => {
              const closing = calcClosing(p);
              return (
                <TableRow key={p.partner_no} className="hover:bg-muted/20">
                  <TableCell className="text-center font-medium">
                    {i + 1}
                  </TableCell>

                  {/* Name */}
                  <TableCell>
                    <Input
                      value={p.partner_name}
                      onChange={e =>
                        setPartnerField(i, "partner_name", e.target.value)
                      }
                      placeholder={`Partner ${i + 1}`}
                      className="h-7 text-xs w-36"
                    />
                  </TableCell>

                  {/* Share % */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.profit_share_pct}
                      onChange={v => setPartnerField(i, "profit_share_pct", v)}
                      className="w-16"
                    />
                  </TableCell>

                  {/* Opening */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.opening_balance_cy}
                      onChange={v =>
                        setPartnerField(i, "opening_balance_cy", v)
                      }
                    />
                  </TableCell>

                  {/* Introduced */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.introduced_cy}
                      onChange={v => setPartnerField(i, "introduced_cy", v)}
                    />
                  </TableCell>

                  {/* Remuneration */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.remuneration_cy}
                      onChange={v => setPartnerField(i, "remuneration_cy", v)}
                    />
                  </TableCell>

                  {/* Interest */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.interest_cy}
                      onChange={v => setPartnerField(i, "interest_cy", v)}
                    />
                  </TableCell>

                  {/* Withdrawals */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.withdrawals_cy}
                      onChange={v => setPartnerField(i, "withdrawals_cy", v)}
                    />
                  </TableCell>

                  {/* Profit share */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.profit_share_cy}
                      onChange={v => setPartnerField(i, "profit_share_cy", v)}
                    />
                  </TableCell>

                  {/* Closing — READ-ONLY, auto-calculated */}
                  <TableCell
                    className={cn(
                      "text-right font-semibold bg-primary/5",
                      closing < 0 && "text-destructive"
                    )}
                  >
                    {fmt(closing)}
                  </TableCell>

                  {/* Delete button (disabled when only one partner remains) */}
                  <TableCell className="text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive disabled:opacity-30"
                      onClick={() => removePartner(i)}
                      disabled={partners.length <= 1}
                      title={
                        partners.length <= 1
                          ? "At least one partner required"
                          : "Remove partner"
                      }
                    >
                      <Trash2 size={12} />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}

            {/* ── Total row (CY) ── */}
            <TableRow className="bg-muted/60 border-t-2 font-semibold">
              <TableCell />
              <TableCell className="text-xs uppercase tracking-wide">
                Total
              </TableCell>
              <TableCell className="text-right text-xs">
                {totals.pct > 0 ? (
                  <span
                    className={cn(
                      profitShareWarning && "text-destructive"
                    )}
                  >
                    {totals.pct.toFixed(2)}%
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right">{fmt(totals.opening)}</TableCell>
              <TableCell className="text-right">
                {fmt(totals.introduced)}
              </TableCell>
              <TableCell className="text-right">
                {fmt(totals.remuneration)}
              </TableCell>
              <TableCell className="text-right">{fmt(totals.interest)}</TableCell>
              <TableCell className="text-right">
                {fmt(totals.withdrawals)}
              </TableCell>
              <TableCell className="text-right">
                {fmt(totals.profit_share)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right bg-primary/10 font-bold",
                  totals.closing < 0 && "text-destructive"
                )}
              >
                {fmt(totals.closing)}
              </TableCell>
              <TableCell />
            </TableRow>

            {/* ── Previous Year section ── */}
            {pyPartners.length > 0 ? (
              /* Per-partner PY rows */
              <>
                {pyPartners.map((p, i) => {
                  const pyClosing = p.opening + p.introduced + p.remuneration + p.interest - p.withdrawals + p.profit_share;
                  return (
                    <TableRow key={p.partner_no} className="bg-blue-50/40 text-muted-foreground">
                      <TableCell />
                      <TableCell>
                        <Input
                          value={p.partner_name}
                          onChange={e => setPyPartnerField(i, "partner_name", e.target.value)}
                          placeholder={`PY Partner ${i + 1}`}
                          className="h-7 text-xs px-1 w-36 italic"
                        />
                      </TableCell>
                      <TableCell />
                      <TableCell className="text-right">
                        <NumInput value={p.opening}      onChange={v => setPyPartnerField(i, "opening", v)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <NumInput value={p.introduced}   onChange={v => setPyPartnerField(i, "introduced", v)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <NumInput value={p.remuneration} onChange={v => setPyPartnerField(i, "remuneration", v)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <NumInput value={p.interest}     onChange={v => setPyPartnerField(i, "interest", v)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <NumInput value={p.withdrawals}  onChange={v => setPyPartnerField(i, "withdrawals", v)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <NumInput value={p.profit_share} onChange={v => setPyPartnerField(i, "profit_share", v)} />
                      </TableCell>
                      <TableCell className={cn("text-right bg-primary/5 font-semibold", pyClosing < 0 && "text-destructive")}>
                        {fmt(pyClosing)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          type="button" variant="ghost" size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => removePyPartner(i)}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* PY total row (auto-calculated from per-partner rows) */}
                {(() => {
                  const pyTotals = {
                    opening:      pyPartners.reduce((s, p) => s + p.opening, 0),
                    introduced:   pyPartners.reduce((s, p) => s + p.introduced, 0),
                    remuneration: pyPartners.reduce((s, p) => s + p.remuneration, 0),
                    interest:     pyPartners.reduce((s, p) => s + p.interest, 0),
                    withdrawals:  pyPartners.reduce((s, p) => s + p.withdrawals, 0),
                    profit_share: pyPartners.reduce((s, p) => s + p.profit_share, 0),
                    closing:      pyPartners.reduce((s, p) => s + p.opening + p.introduced + p.remuneration + p.interest - p.withdrawals + p.profit_share, 0),
                  };
                  return (
                    <TableRow className="bg-blue-100/40 border-t font-semibold text-muted-foreground">
                      <TableCell />
                      <TableCell className="text-xs uppercase tracking-wide italic">PY Total ({pyYear})</TableCell>
                      <TableCell />
                      <TableCell className="text-right text-xs">{fmt(pyTotals.opening)}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(pyTotals.introduced)}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(pyTotals.remuneration)}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(pyTotals.interest)}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(pyTotals.withdrawals)}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(pyTotals.profit_share)}</TableCell>
                      <TableCell className={cn("text-right bg-primary/10 font-bold text-xs", pyTotals.closing < 0 && "text-destructive")}>
                        {fmt(pyTotals.closing)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  );
                })()}
              </>
            ) : (
              /* Single aggregate PY row (legacy mode) */
              <TableRow className="bg-blue-50/40 text-muted-foreground">
                <TableCell />
                <TableCell className="text-xs font-medium text-foreground italic">
                  Previous Year ({pyYear})
                </TableCell>
                <TableCell />
                <TableCell className="text-right">
                  <NumInput value={pyRow.opening}      onChange={v => setPyField("opening", v)} />
                </TableCell>
                <TableCell className="text-right">
                  <NumInput value={pyRow.introduced}   onChange={v => setPyField("introduced", v)} />
                </TableCell>
                <TableCell className="text-right">
                  <NumInput value={pyRow.remuneration} onChange={v => setPyField("remuneration", v)} />
                </TableCell>
                <TableCell className="text-right">
                  <NumInput value={pyRow.interest}     onChange={v => setPyField("interest", v)} />
                </TableCell>
                <TableCell className="text-right">
                  <NumInput value={pyRow.withdrawals}  onChange={v => setPyField("withdrawals", v)} />
                </TableCell>
                <TableCell className="text-right">
                  <NumInput value={pyRow.profit_share} onChange={v => setPyField("profit_share", v)} />
                </TableCell>
                <TableCell className={cn("text-right bg-primary/5 font-semibold", calcPyClosing(pyRow) < 0 && "text-destructive")}>
                  {fmt(calcPyClosing(pyRow))}
                </TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={addPartner}
            size="sm"
            variant="outline"
            className="gap-1.5"
          >
            <Plus size={13} />
            Add Partner
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Closing Balance = Opening + Introduced + Remuneration + Interest − Withdrawals + Profit Share
          </p>
        </div>
        <Button onClick={save} disabled={saving} size="sm" className="gap-1.5">
          {saving
            ? <Loader2 size={13} className="animate-spin" />
            : <Save size={13} />}
          Save Capital Account
        </Button>
      </div>

    </div>
  );
}
