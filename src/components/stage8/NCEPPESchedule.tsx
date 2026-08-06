import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2, Lock, AlertTriangle, CheckCircle2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeCOATotals } from "@/lib/fsReconciliation";
import { FS_NCE_CONSTRAINED_NOTES } from "@/lib/nceFeatureFlags";

// ─── Sub-ledger sort_order encoding ──────────────────────────────────────────
// Parent rows use sort_order 1–11 (see ASSET_ROW_DEFS). User-added sub-ledgers
// under parent N are stored with sort_order = N * 100 + slot, where slot ∈ [1..99].
// This keeps every row in the same flat nce_ppe_schedule table without a
// schema migration: a row is a sub-ledger iff sort_order >= 100.
const SUB_BASE = 100;
const isSubLedger = (so: number) => so >= SUB_BASE;
const inr = (n: number) => Math.abs(Math.round(Number(n) || 0)).toLocaleString("en-IN");
const parentOfSub = (so: number) => Math.floor(so / SUB_BASE);
const nextSubSlot = (rows: { sort_order: number }[], parentSo: number): number => {
  const used = new Set(
    rows
      .filter(r => isSubLedger(r.sort_order) && parentOfSub(r.sort_order) === parentSo)
      .map(r => r.sort_order % SUB_BASE),
  );
  for (let slot = 1; slot < SUB_BASE; slot++) if (!used.has(slot)) return slot;
  return SUB_BASE - 1;
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssetRow {
  sort_order:       number;
  asset_category:   "tangible" | "intangible";
  asset_name:       string;   // editable for "Others" rows
  rate_pct:         number;
  opening_balance:  number;
  additions_pre:    number;
  additions_post:   number;
  deletions:        number;
  depreciation:     number;
  // total and closing_balance are auto-computed, not stored in state
}

interface AssetRowDef {
  sort_order:     number;
  asset_category: "tangible" | "intangible";
  defaultName:    string;   // label shown for fixed rows / initial value for editable
  rowLabel:       string;   // roman numeral prefix: "(i)", "(ii)", …
  nameEditable:   boolean;  // true for "Others (specify nature)" rows
}

interface Props {
  engagementId: string;
  /** Task 1 (doc6): when true, PPE schedule is read-only (locked preview mode) */
  readOnly?: boolean;
}

// ─── Static row config ────────────────────────────────────────────────────────

const ASSET_ROW_DEFS: AssetRowDef[] = [
  // Tangible assets
  { sort_order: 1,  asset_category: "tangible",   defaultName: "Freehold land",          rowLabel: "(i)",   nameEditable: false },
  { sort_order: 2,  asset_category: "tangible",   defaultName: "Buildings",               rowLabel: "(ii)",  nameEditable: false },
  { sort_order: 3,  asset_category: "tangible",   defaultName: "Plant and Equipment",     rowLabel: "(iii)", nameEditable: false },
  { sort_order: 4,  asset_category: "tangible",   defaultName: "Office equipment",        rowLabel: "(iv)",  nameEditable: false },
  { sort_order: 5,  asset_category: "tangible",   defaultName: "Vehicles",                rowLabel: "(v)",   nameEditable: false },
  { sort_order: 6,  asset_category: "tangible",   defaultName: "Others",                  rowLabel: "(vi)",  nameEditable: true  },
  // Intangible assets
  { sort_order: 7,  asset_category: "intangible", defaultName: "Goodwill",                rowLabel: "(i)",   nameEditable: false },
  { sort_order: 8,  asset_category: "intangible", defaultName: "Brands / Trademarks",     rowLabel: "(ii)",  nameEditable: false },
  { sort_order: 9,  asset_category: "intangible", defaultName: "Computer Software",       rowLabel: "(iii)", nameEditable: false },
  { sort_order: 10, asset_category: "intangible", defaultName: "License and Franchise",   rowLabel: "(iv)",  nameEditable: false },
  { sort_order: 11, asset_category: "intangible", defaultName: "Others",                  rowLabel: "(v)",   nameEditable: true  },
];

const TANGIBLE_COUNT   = 6;   // sort_order 1–6
const INTANGIBLE_COUNT = 5;   // sort_order 7–11

function initRows(): AssetRow[] {
  return ASSET_ROW_DEFS.map(def => ({
    sort_order:      def.sort_order,
    asset_category:  def.asset_category,
    asset_name:      def.defaultName,
    rate_pct:        0,
    opening_balance: 0,
    additions_pre:   0,
    additions_post:  0,
    deletions:       0,
    depreciation:    0,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFY(fy: string): { cy: number; py: number } {
  if (!fy) { const y = new Date().getFullYear(); return { cy: y, py: y - 1 }; }
  const parts = fy.split("-");
  if (parts.length === 2) {
    const end = parseInt(parts[1]);
    const fullEnd = end < 100 ? 2000 + end : end;
    return { cy: fullEnd, py: fullEnd - 1 };
  }
  const y = parseInt(fy) || new Date().getFullYear();
  return { cy: y, py: y - 1 };
}

function calcRowTotal(r: AssetRow): number {
  return Math.round((r.opening_balance + r.additions_pre + r.additions_post - r.deletions) * 100) / 100;
}

/** Auto-compute depreciation per Companies Act / Income Tax half-year rule:
 *  • Opening balance + additions on or before 29/09 → full-year rate
 *  • Additions after 29/09 → half-year rate (half of the rate %)
 *
 *  depn = (opening + additions_pre - deletions) * rate% + additions_post * rate%/2
 *
 *  This is the rate-based AUTO-FILL default that updateRow() seeds into
 *  r.depreciation whenever a base field (rate %, opening, additions, deletions)
 *  changes. The Depreciation column itself is EDITABLE so the auditor can override
 *  it to tie Σ depreciation to the booked NCE_DEPR (a rate formula can't hit that
 *  exact figure to the rupee — the constrained save requires it). */
function calcDepreciation(r: AssetRow): number {
  const rate = Number(r.rate_pct) || 0;
  if (rate <= 0) return 0;
  // Deletions reduce the full-year depreciable base (Income-Tax block method).
  // Clamp at 0 so a disposal larger than (opening + pre-additions) never
  // produces negative (added-back) depreciation.
  const base = Math.max(
    0,
    (Number(r.opening_balance) || 0) + (Number(r.additions_pre) || 0) - (Number(r.deletions) || 0),
  );
  const post = Number(r.additions_post) || 0;
  const depn = base * (rate / 100) + post * (rate / 200);
  // Depreciation is disclosed in WHOLE RUPEES (Schedule III) — round to the
  // nearest rupee, never paise.
  return Math.round(depn);
}

/** Effective depreciation = the stored/entered figure (the column is now editable).
 *  calcDepreciation() is only the rate-based AUTO-FILL suggestion that updateRow()
 *  re-seeds into r.depreciation when a base field changes. The SAVED + COA-tied
 *  value is r.depreciation, so the auditor can match Σ depreciation to the booked
 *  NCE_DEPR — which a pure rate formula can never hit to the rupee (the root cause
 *  of "PPE schedule won't save even though the net block ties"). */
const effDep = (r: AssetRow): number => Math.round(Number(r.depreciation) || 0);  // whole rupees (no paise)

function calcClosing(r: AssetRow): number {
  return Math.round((calcRowTotal(r) - effDep(r)) * 100) / 100;
}

/** Pure tie-check — factored out of the `cons` useMemo so handleSave can run
 *  the SAME check against a freshly re-fetched COA anchor (not the stale
 *  render-time `coa` state) immediately before attempting a save. */
function computeTie(
  rows: AssetRow[],
  coa: { ppe: { cy: number; py: number }; intg: { cy: number; py: number }; depr: { cy: number; py: number } },
  hasPyShell: boolean,
) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const sumCat = (cat: string, f: (r: AssetRow) => number) => r2(rows.filter(r => r.asset_category === cat).reduce((s, r) => s + f(r), 0));
  const tanClose = sumCat("tangible", calcClosing), intClose = sumCat("intangible", calcClosing);
  const tanOpen = sumCat("tangible", r => Number(r.opening_balance) || 0), intOpen = sumCat("intangible", r => Number(r.opening_balance) || 0);
  const depTot = r2(rows.reduce((s, r) => s + effDep(r), 0));
  const d = {
    tanCy: r2(coa.ppe.cy - tanClose), intCy: r2(coa.intg.cy - intClose), dep: r2(coa.depr.cy - depTot),
    tanPy: r2(coa.ppe.py - tanOpen), intPy: r2(coa.intg.py - intOpen),
  };
  const tied = Math.abs(d.tanCy) <= 1 && Math.abs(d.intCy) <= 1 && Math.abs(d.dep) <= 1 && (!hasPyShell || (Math.abs(d.tanPy) <= 1 && Math.abs(d.intPy) <= 1));
  return { tanClose, intClose, depTot, d, tied };
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 0.5) return "—";
  return Math.round(v).toLocaleString("en-IN", {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

// ─── NumInput ─────────────────────────────────────────────────────────────────

function NumInput({
  value,
  onChange,
  readOnly,
}: {
  value:      number;
  onChange?:  (v: number) => void;
  readOnly?:  boolean;
}) {
  const [local, setLocal] = useState(value === 0 ? "" : String(value));

  useEffect(() => {
    setLocal(value === 0 ? "" : String(value));
  }, [value]);

  if (readOnly) {
    return (
      <div className="h-7 flex items-center justify-end px-2 text-xs font-medium rounded bg-muted/40 text-foreground/70 select-none">
        {fmtNum(value)}
      </div>
    );
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      className="h-7 text-xs text-right px-2 py-0 w-full min-w-[72px]"
      value={local}
      placeholder="—"
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const parsed = parseFloat(local.replace(/,/g, "")) || 0;
        setLocal(parsed === 0 ? "" : String(parsed));
        onChange?.(parsed);
      }}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// Root cause of "edits lost after hard refresh" (VJDESAI, Aug-2026): the Save
// button is (correctly, and intentionally — see save-nce-constrained-note's
// server-side tie enforcement) disabled until the schedule ties to COA to the
// rupee, which the depreciation leg routinely can't hit via the auto rate
// formula. Edits made while untied were never persisted anywhere, so a
// refresh silently reloaded the last-tied DB state with no warning. Fix:
// mirror every dirty (unsaved) edit into localStorage so a refresh can offer
// to restore it, and warn before an actual navigate-away/close. This does
// NOT loosen the server-side tie guarantee — Save still requires cons.tied.
function ppeDraftKey(engagementId: string, financialYear: string): string | null {
  if (!engagementId || !financialYear) return null;
  return `nce_ppe_draft:${engagementId}:${financialYear}`;
}

export function NCEPPESchedule({ engagementId, readOnly = false }: Props) {
  const [rows,    setRows]    = useState<AssetRow[]>(initRows);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [eng,     setEng]     = useState<any>(null);
  const [coa, setCoa] = useState({ ppe: { cy: 0, py: 0 }, intg: { cy: 0, py: 0 }, depr: { cy: 0, py: 0 } });
  const [hasPyShell, setHasPyShell] = useState(false);
  // Snapshot of the last-persisted (loaded or saved) rows — used to detect
  // unsaved edits so they can be mirrored to a local draft and warned about.
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  // A locally-stored draft found on load that differs from the DB state —
  // offered to the user as an explicit Restore/Discard choice, never applied
  // silently (so a stale local draft can never clobber real DB data).
  const [draftCandidate, setDraftCandidate] = useState<AssetRow[] | null>(null);
  // Persistent (non-toast) record of the last save failure. A toast alone
  // vanishes in a few seconds — a rejected save with nothing left on screen
  // afterward reads as "the button doesn't work" (the exact support report
  // this guards against). Cleared on a successful save or once the user
  // edits a row in response to it.
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Derived year labels (from self-fetched engagement) ───────────────────
  const financialYear = (eng?.financial_year as string) || "";
  const clientName    = (eng?.clients?.name  as string) || "";
  const { cy: cyYear, py: pyYear } = useMemo(() => parseFY(financialYear), [financialYear]);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      // 1. Fetch engagement — get FY and client name
      const { data: engRow } = await supabase
        .from("audit_engagements")
        .select("financial_year, clients(name), firms(*), partner:users!partner_id(name)")
        .eq("id", engagementId)
        .single();
      if (cancelled) return;
      if (engRow) setEng(engRow);

      // 2. Fetch PPE rows for this engagement
      const { data, error } = await supabase
        .from("nce_ppe_schedule")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("sort_order");
      if (!cancelled) {
        let finalRows: AssetRow[] = initRows();
        if (!error && data && data.length > 0) {
          const built = initRows();
          // Preserve sub-ledger rows from DB (sort_order >= SUB_BASE) and merge
          // them after the parent rows so the table renders nested correctly.
          const subRows: AssetRow[] = [];
          for (const db of data) {
            const so = Number(db.sort_order);
            const row: AssetRow = {
              sort_order:      so,
              asset_category:  db.asset_category as "tangible" | "intangible",
              asset_name:      db.asset_name,
              rate_pct:        Number(db.rate_pct)        || 0,
              opening_balance: Number(db.opening_balance) || 0,
              additions_pre:   Number(db.additions_pre)   || 0,
              additions_post:  Number(db.additions_post)  || 0,
              deletions:       Number(db.deletions)       || 0,
              depreciation:    Number(db.depreciation)    || 0,
            };
            if (isSubLedger(so)) {
              subRows.push(row);
              continue;
            }
            const idx = built.findIndex(r => r.sort_order === so);
            if (idx >= 0) built[idx] = row;
          }
          finalRows = [...built, ...subRows].sort((a, b) => a.sort_order - b.sort_order);
        }

        // Draft recovery: if an earlier session left unsaved edits in this
        // browser (couldn't save because the schedule didn't tie yet, and the
        // tab was refreshed/closed before fixing it), offer to restore them
        // rather than silently discarding — never applied automatically.
        const dkey = ppeDraftKey(engagementId, String(engRow?.financial_year ?? ""));
        const finalSnapshot = JSON.stringify(finalRows);
        if (dkey) {
          const rawDraft = localStorage.getItem(dkey);
          if (rawDraft && rawDraft !== finalSnapshot) {
            try {
              const parsed = JSON.parse(rawDraft);
              if (Array.isArray(parsed)) setDraftCandidate(parsed as AssetRow[]);
            } catch { /* corrupted draft — ignore */ }
          } else if (rawDraft) {
            // Draft matches DB state exactly — nothing to recover, clean up.
            localStorage.removeItem(dkey);
          }
        }

        setRows(finalRows);
        setSavedSnapshot(finalSnapshot);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Dirty tracking + local draft safety net ───────────────────────────────
  const dirty = useMemo(() => !loading && JSON.stringify(rows) !== savedSnapshot, [rows, savedSnapshot, loading]);

  useEffect(() => {
    if (loading || readOnly) return;
    const dkey = ppeDraftKey(engagementId, financialYear);
    if (!dkey) return;
    if (dirty) localStorage.setItem(dkey, JSON.stringify(rows));
    else localStorage.removeItem(dkey);
  }, [rows, dirty, loading, readOnly, engagementId, financialYear]);

  // Warn on tab close / navigation away while there are unsaved edits — the
  // schedule not tying yet is no longer a silent way to lose a team's work.
  useEffect(() => {
    if (readOnly) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, readOnly]);

  const restoreDraft = () => {
    if (!draftCandidate) return;
    setRows(draftCandidate);
    setDraftCandidate(null);
    toast.success("Draft restored — review and save once it ties to COA mapping.");
  };
  const discardDraft = () => {
    const dkey = ppeDraftKey(engagementId, financialYear);
    if (dkey) localStorage.removeItem(dkey);
    setDraftCandidate(null);
  };

  // ── COA anchor load (constrained mode only) ───────────────────────────────
  // A standalone, re-callable loader (not inlined in the effect) — handleSave
  // calls this FRESH immediately before checking the tie, so a COA mapping /
  // TB re-sync made in another tab (or earlier in the same session) can never
  // leave the schedule showing a stale "ready to save" while the server's
  // independently re-derived anchor has since moved. That "client says tied,
  // server rejects" gap is exactly what made a real save read as "the button
  // doesn't work" (AMBICA PLASTIC INDUSTRIES support report).
  const loadCoaAnchor = useCallback(async (): Promise<{
    coa: { ppe: { cy: number; py: number }; intg: { cy: number; py: number }; depr: { cy: number; py: number } };
    hasPyShell: boolean;
  } | null> => {
    if (!engagementId || !FS_NCE_CONSTRAINED_NOTES) return null;
    const loadTB = async (id: string) => {
      const out: any[] = [];
      for (let f = 0; ; f += 1000) {
        const { data } = await supabase.from("tally_trial_balance")
          .select("ledger_name,closing_balance,balance_type,opening_balance,opening_type")
          .eq("engagement_id", id).order("ledger_name").range(f, f + 999);
        if (!data || !data.length) break; out.push(...data); if (data.length < 1000) break;
      }
      return out;
    };
    const { data: e } = await supabase.from("audit_engagements")
      .select("client_id, coa_mapping, financial_year").eq("id", engagementId).maybeSingle();
    if (!e) return null;
    const cyMap = ((e as any).coa_mapping ?? {}) as any;
    const cyTb = await loadTB(engagementId);
    const p = String((e as any).financial_year ?? "").split("-");
    const prevFy = p.length === 2 ? `${parseInt(p[0]) - 1}-${String(parseInt(p[0])).slice(-2)}` : "";
    let pyTb: any[] = []; let pyMap: any = {};
    if (prevFy && (e as any).client_id) {
      // Deterministic order: if a client ever ends up with more than one
      // is_py_shell row for the same year, the client (RLS-scoped) and the
      // edge function (service-role, sees everything) must pick the SAME
      // row, or their independently-recomputed COA anchors silently diverge.
      // audit_engagements has no created_at column, so order by id —
      // deterministic and stable, mirrored in the edge function.
      const { data: shells } = await supabase.from("audit_engagements")
        .select("id, coa_mapping").eq("client_id", (e as any).client_id).eq("financial_year", prevFy).eq("is_py_shell", true)
        .order("id", { ascending: true });
      for (const s of (shells ?? []) as any[]) { const tb = await loadTB(s.id); if (tb.length) { pyTb = tb; pyMap = s.coa_mapping ?? {}; break; } }
    }
    const t = computeCOATotals(cyTb as any, pyTb as any, cyMap, pyMap);
    return {
      coa: { ppe: t["NCE_PPE"] ?? { cy: 0, py: 0 }, intg: t["NCE_INTG"] ?? { cy: 0, py: 0 }, depr: t["NCE_DEPR"] ?? { cy: 0, py: 0 } },
      hasPyShell: pyTb.length > 0,
    };
  }, [engagementId]);

  useEffect(() => {
    let cancelled = false;
    loadCoaAnchor().then(result => {
      if (cancelled || !result) return;
      setCoa(result.coa);
      setHasPyShell(result.hasPyShell);
    });
    return () => { cancelled = true; };
  }, [loadCoaAnchor]);

  // ── Update ──────────────────────────────────────────────────────────────
  const updateRow = (sort_order: number, field: keyof AssetRow, value: number | string) => {
    setSaveError(null);
    setRows(prev =>
      prev.map(r => {
        if (r.sort_order !== sort_order) return r;
        const next = { ...r, [field]: value };
        // Auto-seed depreciation from the rate formula when a BASE field changes
        // (so entering a Rate % still fills depreciation). A direct edit of the
        // Depreciation column is left as a manual override so the auditor can tie
        // the total to the booked NCE_DEPR.
        if (field === "rate_pct" || field === "opening_balance" || field === "additions_pre"
          || field === "additions_post" || field === "deletions") {
          next.depreciation = calcDepreciation(next);
        }
        return next;
      })
    );
  };

  // ── Sub-ledger handlers ─────────────────────────────────────────────────
  const addSubLedger = (parentSo: number) => {
    setRows(prev => {
      const parent = prev.find(r => r.sort_order === parentSo);
      if (!parent) return prev;
      const slot = nextSubSlot(prev, parentSo);
      const newRow: AssetRow = {
        sort_order:      parentSo * SUB_BASE + slot,
        asset_category:  parent.asset_category,
        asset_name:      "",                                  // user-entered
        rate_pct:        0,
        opening_balance: 0,
        additions_pre:   0,
        additions_post:  0,
        deletions:       0,
        depreciation:    0,
      };
      return [...prev, newRow].sort((a, b) => a.sort_order - b.sort_order);
    });
  };
  const deleteSubLedger = (sort_order: number) => {
    setRows(prev => prev.filter(r => r.sort_order !== sort_order));
  };

  // ── Totals ──────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const sum = (f: keyof AssetRow) =>
      rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const totalTotal   = rows.reduce((s, r) => s + calcRowTotal(r), 0);
    const totalClosing = rows.reduce((s, r) => s + calcClosing(r),  0);
    const totalDepn    = rows.reduce((s, r) => s + effDep(r), 0);
    return {
      opening:      sum("opening_balance"),
      addPre:       sum("additions_pre"),
      addPost:      sum("additions_post"),
      deletions:    sum("deletions"),
      total:        Math.round(totalTotal   * 100) / 100,
      depreciation: Math.round(totalDepn    * 100) / 100,
      closing:      Math.round(totalClosing * 100) / 100,
    };
  }, [rows]);

  // ── Save (DELETE → INSERT) ───────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Constrained mode: route through the edge function, which re-derives COA
      // server-side and rejects the save unless net block + depreciation tie
      // (CY net = closing, PY net = opening; depreciation = NCE_DEPR).
      if (FS_NCE_CONSTRAINED_NOTES) {
        // Re-derive the COA anchor FRESH right before saving. The `coa` shown
        // on screen was loaded on mount and can go stale if the COA mapping
        // or TB was re-synced since — another tab, or an earlier stage in
        // this same session. The server always re-derives fresh on its own
        // and will reject against ITS numbers regardless of what the client
        // believed, so checking a stale anchor risks a doomed round-trip that
        // reads to the user as "the button doesn't work". Refresh first and
        // fail fast with the CURRENT figures if it's genuinely no longer tied.
        const fresh = await loadCoaAnchor();
        if (fresh) {
          setCoa(fresh.coa);
          setHasPyShell(fresh.hasPyShell);
          const freshCons = computeTie(rows, fresh.coa, fresh.hasPyShell);
          if (!freshCons.tied) {
            const parts: string[] = [];
            if (Math.abs(freshCons.d.tanCy) > 1) parts.push(`tangible closing off ₹${inr(freshCons.d.tanCy)}`);
            if (Math.abs(freshCons.d.intCy) > 1) parts.push(`intangible closing off ₹${inr(freshCons.d.intCy)}`);
            if (Math.abs(freshCons.d.dep) > 1) parts.push(`depreciation off ₹${inr(freshCons.d.dep)}`);
            if (fresh.hasPyShell && Math.abs(freshCons.d.tanPy) > 1) parts.push(`tangible opening off ₹${inr(freshCons.d.tanPy)}`);
            if (fresh.hasPyShell && Math.abs(freshCons.d.intPy) > 1) parts.push(`intangible opening off ₹${inr(freshCons.d.intPy)}`);
            const msg = `COA mapping or trial balance changed since this page loaded — the schedule no longer ties (${parts.join("; ")}). Figures above have been refreshed; use "Auto-balance to COA mapping" or adjust the rows, then save again.`;
            setSaveError(msg);
            toast.error(msg);
            return;
          }
        }

        const cPayload = rows.map(r => ({
          asset_category: r.asset_category, asset_name: r.asset_name,
          coa_code: r.asset_category === "tangible" ? "NCE_PPE" : "NCE_INTG",
          rate_pct: r.rate_pct, opening_balance: r.opening_balance,
          additions_pre: r.additions_pre, additions_post: r.additions_post,
          deletions: r.deletions, depreciation: effDep(r), sort_order: r.sort_order,
        }));
        const { data, error } = await supabase.functions.invoke("save-nce-constrained-note", {
          body: { type: "ppe", engagement_id: engagementId, financial_year: financialYear, rows: cPayload },
        });
        if (error) {
          // A non-2xx response surfaces here as the opaque "Edge Function returned
          // a non-2xx status code". The real reason (tie mismatches, forbidden,
          // finalized, …) is in the response body on error.context — read it so
          // the auditor sees WHY instead of a generic message.
          let detail = error.message;
          try {
            const body = await (error as any).context?.json?.();
            if (body?.mismatches?.length) detail = body.mismatches.join("  ·  ");
            else if (body?.error) detail = `${body.error}${body.detail ? ": " + body.detail : ""}`;
          } catch { /* keep the generic message */ }
          setSaveError(detail);
          toast.error(detail);
          return;
        }
        if ((data as any)?.error) {
          const ms = (data as any)?.mismatches as string[] | undefined;
          const msg = ms?.length ? ms.join("  ·  ") : (data as any).error;
          setSaveError(msg);
          toast.error(msg);
          return;
        }
        toast.success("PPE schedule saved — ties to COA mapping.");
        setSaveError(null);
        setSavedSnapshot(JSON.stringify(rows));
        const dkeyOk = ppeDraftKey(engagementId, financialYear);
        if (dkeyOk) localStorage.removeItem(dkeyOk);
        return;
      }

      // Delete all existing rows for this engagement + FY
      const { error: delErr } = await supabase
        .from("nce_ppe_schedule")
        .delete()
        .eq("engagement_id", engagementId)
        .eq("financial_year", financialYear);
      if (delErr) throw delErr;

      // Insert fresh
      const payload = rows.map(r => ({
        engagement_id:   engagementId,
        financial_year:  financialYear,
        asset_category:  r.asset_category,
        asset_name:      r.asset_name,
        rate_pct:        r.rate_pct,
        opening_balance: r.opening_balance,
        additions_pre:   r.additions_pre,
        additions_post:  r.additions_post,
        deletions:       r.deletions,
        total:           calcRowTotal(r),
        depreciation:    effDep(r),
        closing_balance: calcClosing(r),
        sort_order:      r.sort_order,
      }));
      const { error: insErr } = await supabase.from("nce_ppe_schedule").insert(payload);
      if (insErr) throw insErr;
      toast.success("PPE Schedule saved");
      setSaveError(null);
      setSavedSnapshot(JSON.stringify(rows));
      const dkeyOk2 = ppeDraftKey(engagementId, financialYear);
      if (dkeyOk2) localStorage.removeItem(dkeyOk2);
    } catch (err: any) {
      const msg = err.message || "Save failed";
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Constrained-mode tie status (difference to explain) ───────────────────
  const cons = useMemo(() => computeTie(rows, coa, hasPyShell), [rows, coa, hasPyShell]);

  // One-click reconcile: nudge each category's LAST row (the balancer) so every
  // COA leg ties — Σ opening = COA PY net, Σ depreciation = booked NCE_DEPR, Σ
  // closing (net block) = COA CY net. The legs are independent fields (opening /
  // depreciation / additions), so closing falls out once the other two are set.
  const autoBalanceToCoa = () => {
    setRows(prev => {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const next = prev.map(r => ({ ...r }));
      const sumOpen  = (list: AssetRow[]) => r2(list.reduce((s, r) => s + (Number(r.opening_balance) || 0), 0));
      const sumClose = (list: AssetRow[]) => r2(list.reduce((s, r) => s + calcClosing(r), 0));
      const balance = (cat: "tangible" | "intangible", net: { cy: number; py: number }, deprPlug: number | null) => {
        const list = next.filter(r => r.asset_category === cat);
        if (!list.length) return;
        // balancer = highest sort_order row in the category (the "Others" class) —
        // deterministic regardless of array order.
        const b = list.reduce((a, c) => (c.sort_order > a.sort_order ? c : a), list[0]);
        if (hasPyShell) b.opening_balance = r2((Number(b.opening_balance) || 0) + (net.py - sumOpen(list)));
        if (deprPlug != null) {                                   // absorb the GLOBAL depreciation residual here
          const allDep = r2(next.reduce((s, r) => s + effDep(r), 0));
          b.depreciation = Math.round(effDep(b) + (deprPlug - allDep));  // whole rupees
        }
        b.additions_pre = r2((Number(b.additions_pre) || 0) + (net.cy - sumClose(list)));  // ties closing last
      };
      balance("tangible", coa.ppe, coa.depr.cy);                  // tangible carries the depreciation plug
      balance("intangible", coa.intg, null);
      return next;
    });
  };

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  // Parent rows only — the renderer pulls each parent's sub-ledgers from the
  // full `rows` list and renders them inline beneath. This keeps the section
  // rowspan math (TANGIBLE_COUNT / INTANGIBLE_COUNT) stable even as sub-rows
  // are added/removed.
  const tangibleParents   = rows.filter(r => r.asset_category === "tangible"   && !isSubLedger(r.sort_order));
  const intangibleParents = rows.filter(r => r.asset_category === "intangible" && !isSubLedger(r.sort_order));
  const subRowsOf = (parentSo: number) =>
    rows.filter(r => isSubLedger(r.sort_order) && parentOfSub(r.sort_order) === parentSo);
  const sectionSpan = (cat: "tangible" | "intangible") =>
    cat === "tangible"
      ? tangibleParents.length + rows.filter(r => r.asset_category === "tangible" && isSubLedger(r.sort_order)).length
      : intangibleParents.length + rows.filter(r => r.asset_category === "intangible" && isSubLedger(r.sort_order)).length;

  const SaveBtn = () => (
    <div className="flex items-center gap-2">
      {dirty && (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
          {FS_NCE_CONSTRAINED_NOTES && !cons.tied && " — saved locally on this device until it ties"}
        </span>
      )}
      <Button size="sm" onClick={handleSave} disabled={saving || (FS_NCE_CONSTRAINED_NOTES && !cons.tied)}>
        {saving
          ? <Loader2 className="animate-spin h-4 w-4 mr-1.5" />
          : <Save className="h-4 w-4 mr-1.5" />}
        {FS_NCE_CONSTRAINED_NOTES && !cons.tied ? "Fix the difference to save" : "Save PPE Schedule"}
      </Button>
    </div>
  );

  /** Render one PARENT asset row (sort_order < SUB_BASE). isFirst drives
   *  whether the rowspan Category cell appears. */
  const renderAssetRow = (
    row:          AssetRow,
    def:          AssetRowDef,
    isFirst:      boolean,
    sectionSpan:  number,
    sectionLabel: string,
  ) => {
    const rowTotal  = calcRowTotal(row);
    const closing   = calcClosing(row);

    return (
      <TableRow key={row.sort_order} className="hover:bg-muted/10">
        {/* Col 1: Category — rowspan on first row of section */}
        {isFirst && (
          <TableCell
            rowSpan={sectionSpan}
            className="text-xs font-semibold align-middle text-center border-r bg-muted/10 py-2 px-1"
            style={{ minWidth: "52px", maxWidth: "60px" }}
          >
            <span
              className="block"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap" }}
            >
              {sectionLabel}
            </span>
          </TableCell>
        )}

        {/* Col 2: Asset Name + inline "+ Add sub-ledger" button */}
        <TableCell className="py-1 px-2 text-xs border-r" style={{ minWidth: "180px" }}>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
              {def.rowLabel}
            </span>
            {def.nameEditable ? (
              <Input
                type="text"
                className="h-7 text-xs px-2 py-0 flex-1"
                value={row.asset_name}
                placeholder="specify nature"
                onChange={e =>
                  updateRow(row.sort_order, "asset_name", e.target.value || def.defaultName)
                }
              />
            ) : (
              <span className="flex-1">{def.defaultName}</span>
            )}
            {/* + Sub button — hidden in readOnly / preview mode */}
            {!readOnly && (
              <button
                type="button"
                className="h-5 px-1.5 inline-flex items-center gap-0.5 rounded text-[10px] text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20 shrink-0"
                onClick={() => addSubLedger(row.sort_order)}
                title={`Add a sub-ledger under "${def.defaultName}"`}
              >
                <Plus className="h-3 w-3" /> Sub
              </button>
            )}
          </div>
        </TableCell>

        {/* Col 3: Rate % */}
        <TableCell className="p-1 border-r" style={{ minWidth: "64px" }}>
          <NumInput
            value={row.rate_pct}
            onChange={v => updateRow(row.sort_order, "rate_pct", v)}
          />
        </TableCell>

        {/* Col 4: Opening Balance */}
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput
            value={row.opening_balance}
            onChange={v => updateRow(row.sort_order, "opening_balance", v)}
          />
        </TableCell>

        {/* Col 5: Additions — before 29/09 */}
        <TableCell className="p-1" style={{ minWidth: "88px" }}>
          <NumInput
            value={row.additions_pre}
            onChange={v => updateRow(row.sort_order, "additions_pre", v)}
          />
        </TableCell>

        {/* Col 6: Additions — after 29/09 */}
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput
            value={row.additions_post}
            onChange={v => updateRow(row.sort_order, "additions_post", v)}
          />
        </TableCell>

        {/* Deletions (editable) */}
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput
            value={row.deletions}
            onChange={v => updateRow(row.sort_order, "deletions", v)}
          />
        </TableCell>

        {/* Col 7: Total (read-only) */}
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput value={rowTotal} readOnly />
        </TableCell>

        {/* Col 8: Depreciation (auto-calculated from rate% + opening + additions) */}
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput value={row.depreciation} onChange={v => updateRow(row.sort_order, "depreciation", v)} />
        </TableCell>

        {/* Col 9: Closing Balance (read-only) */}
        <TableCell className="p-1" style={{ minWidth: "88px" }}>
          <NumInput value={closing} readOnly />
        </TableCell>
      </TableRow>
    );
  };

  /** Render a sub-ledger row (sort_order >= SUB_BASE). The Category column is
   *  not emitted — its rowspan already covers this row. Asset name is fully
   *  editable; a trash icon allows removal. */
  const renderSubLedgerRow = (row: AssetRow) => {
    const rowTotal = calcRowTotal(row);
    const closing  = calcClosing(row);
    return (
      <TableRow key={row.sort_order} className="bg-blue-50/30 hover:bg-blue-50/50">
        <TableCell className="py-1 px-2 text-xs border-r" style={{ minWidth: "180px" }}>
          <div className="flex items-center gap-1.5 pl-5">
            <span className="text-muted-foreground/60 shrink-0 text-[11px]">└</span>
            {readOnly
              ? <span className="text-xs flex-1">{row.asset_name || "Sub-ledger"}</span>
              : <>
                  <Input
                    type="text"
                    className="h-7 text-xs px-2 py-0 flex-1 border-blue-200"
                    value={row.asset_name}
                    placeholder="Sub-ledger name…"
                    onChange={e => updateRow(row.sort_order, "asset_name", e.target.value)}
                  />
                  {/* Delete sub-ledger — hidden in readOnly */}
                  <button
                    type="button"
                    className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 shrink-0"
                    onClick={() => deleteSubLedger(row.sort_order)}
                    title="Remove this sub-ledger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
            }
          </div>
        </TableCell>
        <TableCell className="p-1 border-r" style={{ minWidth: "64px" }}>
          <NumInput value={row.rate_pct} onChange={v => updateRow(row.sort_order, "rate_pct", v)} />
        </TableCell>
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput value={row.opening_balance} onChange={v => updateRow(row.sort_order, "opening_balance", v)} />
        </TableCell>
        <TableCell className="p-1" style={{ minWidth: "88px" }}>
          <NumInput value={row.additions_pre} onChange={v => updateRow(row.sort_order, "additions_pre", v)} />
        </TableCell>
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput value={row.additions_post} onChange={v => updateRow(row.sort_order, "additions_post", v)} />
        </TableCell>
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput value={row.deletions} onChange={v => updateRow(row.sort_order, "deletions", v)} />
        </TableCell>
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput value={rowTotal} readOnly />
        </TableCell>
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput value={row.depreciation} onChange={v => updateRow(row.sort_order, "depreciation", v)} />
        </TableCell>
        <TableCell className="p-1" style={{ minWidth: "88px" }}>
          <NumInput value={closing} readOnly />
        </TableCell>
      </TableRow>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className={`space-y-4${readOnly ? " pointer-events-none select-none" : ""}`}>
      {/* Page header */}
      <div className="text-center space-y-0.5 pb-3 border-b">
        {clientName && (
          <p className="text-sm font-semibold uppercase tracking-wide">{clientName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Notes forming part of the Financial Statements for the year ended, 31st March, {cyYear}
        </p>
        <p className="text-xs text-muted-foreground">
          Notes to Balance Sheet as at 31st March, {cyYear}
        </p>
        <p className="text-xs font-medium mt-0.5">
          Note: Property, Plant and Equipment and Intangible Assets (owned assets)
        </p>
      </div>

      {/* Local-draft recovery — an earlier session's unsaved edits survived a
          refresh/close via localStorage; offer them back explicitly rather
          than silently applying or silently losing them. */}
      {!readOnly && draftCandidate && (
        <div className="rounded-md border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-sm flex flex-wrap items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="flex-1 min-w-[220px]">
            Found unsaved edits from an earlier session on this device (the schedule didn't tie to COA mapping yet when it was last open, so they weren't saved).
          </span>
          <Button size="sm" variant="outline" onClick={restoreDraft} className="gap-1.5">Restore draft</Button>
          <Button size="sm" variant="ghost" onClick={discardDraft}>Discard</Button>
        </div>
      )}

      {/* Constrained-mode COA anchor + difference to explain */}
      {FS_NCE_CONSTRAINED_NOTES && (
        <div className={cn("rounded-md border p-3 text-sm space-y-2",
          cons.tied ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20" : "border-destructive/40 bg-destructive/5")}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Closing per COA mapping (locked):</span>
            <span>Tangible net CY <span className="font-medium tabular-nums">₹{inr(coa.ppe.cy)}</span>{hasPyShell && <> · PY <span className="font-medium tabular-nums">₹{inr(coa.ppe.py)}</span></>}</span>
            <span>Intangible net CY <span className="font-medium tabular-nums">₹{inr(coa.intg.cy)}</span>{hasPyShell && <> · PY <span className="font-medium tabular-nums">₹{inr(coa.intg.py)}</span></>}</span>
            <span>Depreciation <span className="font-medium tabular-nums">₹{inr(coa.depr.cy)}</span></span>
          </div>
          {cons.tied ? (
            <div className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium"><CheckCircle2 className="h-4 w-4" /> Schedule ties to COA mapping — ready to save.</div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {[
                  { l: "Tangible closing (net block)", v: cons.d.tanCy, show: true },
                  { l: "Intangible closing (net block)", v: cons.d.intCy, show: true },
                  { l: "Depreciation total", v: cons.d.dep, show: true },
                  { l: "Tangible opening (= last-year close)", v: cons.d.tanPy, show: hasPyShell },
                  { l: "Intangible opening (= last-year close)", v: cons.d.intPy, show: hasPyShell },
                ].filter(x => x.show && Math.abs(x.v) > 1).map((x, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 text-destructive text-xs">
                    <AlertTriangle className="h-3.5 w-3.5" /> {x.l}: difference ₹{inr(x.v)}
                  </span>
                ))}
              </div>
              {!readOnly && (
                <Button variant="outline" size="sm" onClick={autoBalanceToCoa} className="gap-1.5">
                  <Wand2 className="h-3.5 w-3.5" /> Auto-balance to COA mapping
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Persistent save-failure banner — stays on screen (unlike a toast)
          until dismissed, the user edits a row, or a save succeeds, so a
          rejected save is always self-diagnosing instead of reading as a
          silently broken button. */}
      {!readOnly && saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <span className="flex-1">{saveError}</span>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setSaveError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top save — hidden in readOnly / preview mode */}
      {!readOnly && (
        <div className="flex justify-end">
          <SaveBtn />
        </div>
      )}

      {/* PPE Table */}
      <div className="overflow-x-auto rounded-lg border">
        <Table style={{ tableLayout: "fixed", minWidth: "1010px" }}>
          {/* ── 2-Row Header ── */}
          <TableHeader>
            {/* Header row 1 */}
            <TableRow className="bg-muted/40">
              {/* Col 1: Category (rowSpan=2) */}
              <TableHead
                rowSpan={2}
                className={cn(
                  "text-xs text-center align-middle border-r",
                  "w-[60px]"
                )}
              >
                Category
              </TableHead>
              {/* Col 2: Asset Name (rowSpan=2) */}
              <TableHead
                rowSpan={2}
                className="text-xs align-middle border-r w-[170px]"
              >
                Asset Name
              </TableHead>
              {/* Col 3: Rate % (rowSpan=2) */}
              <TableHead
                rowSpan={2}
                className="text-xs text-center align-middle border-r w-[64px]"
              >
                Rate %
              </TableHead>
              {/* Col 4: Opening (rowSpan=2) */}
              <TableHead
                rowSpan={2}
                className="text-xs text-center align-middle border-r w-[100px]"
              >
                Opening Balance
                <br />
                <span className="font-normal text-[10px]">as on 01/04/{pyYear}</span>
              </TableHead>
              {/* Cols 5+6: Additions (colSpan=2) */}
              <TableHead
                colSpan={2}
                className="text-xs text-center border-b border-r w-[196px]"
              >
                Additions (₹)
              </TableHead>
              {/* Deletions (rowSpan=2) — disposals during the year */}
              <TableHead
                rowSpan={2}
                className="text-xs text-center align-middle border-r w-[96px]"
              >
                Deletions
                <br />
                <span className="font-normal text-[10px]">during the year</span>
              </TableHead>
              {/* Col 7: Total (rowSpan=2) */}
              <TableHead
                rowSpan={2}
                className="text-xs text-center align-middle border-r w-[96px]"
              >
                Total
              </TableHead>
              {/* Col 8: Depreciation (rowSpan=2) */}
              <TableHead
                rowSpan={2}
                className="text-xs text-center align-middle border-r w-[96px]"
              >
                Depreciation
              </TableHead>
              {/* Col 9: Closing (rowSpan=2) */}
              <TableHead
                rowSpan={2}
                className="text-xs text-center align-middle w-[96px]"
              >
                Closing Balance
                <br />
                <span className="font-normal text-[10px]">as on 31/03/{cyYear}</span>
              </TableHead>
            </TableRow>

            {/* Header row 2 — Additions sub-headers only */}
            <TableRow className="bg-muted/40">
              <TableHead className="text-[10px] text-center border-r w-[98px]">
                Acquired on or
                <br />
                before 180 days
              </TableHead>
              <TableHead className="text-[10px] text-center border-r w-[98px]">
                Acquired
                <br />
                after 180 days
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {/* ── Tangible Assets ── */}
            {(() => {
              const span = sectionSpan("tangible");
              const out: JSX.Element[] = [];
              tangibleParents.forEach((row, idx) => {
                const def = ASSET_ROW_DEFS.find(d => d.sort_order === row.sort_order)!;
                out.push(renderAssetRow(row, def, idx === 0, span, "(a) Tangible Assets"));
                for (const sub of subRowsOf(row.sort_order)) out.push(renderSubLedgerRow(sub));
              });
              return out;
            })()}

            {/* ── Intangible Assets ── */}
            {(() => {
              const span = sectionSpan("intangible");
              const out: JSX.Element[] = [];
              intangibleParents.forEach((row, idx) => {
                const def = ASSET_ROW_DEFS.find(d => d.sort_order === row.sort_order)!;
                out.push(renderAssetRow(row, def, idx === 0, span, "(b) Intangible Assets"));
                for (const sub of subRowsOf(row.sort_order)) out.push(renderSubLedgerRow(sub));
              });
              return out;
            })()}

            {/* ── Total Row ── */}
            <TableRow className="bg-muted/20 border-t-2 font-semibold">
              <TableCell
                colSpan={2}
                className="text-xs font-bold py-2 px-3 border-r"
              >
                Total
              </TableCell>
              {/* Rate % — N/A for total */}
              <TableCell className="text-xs text-center py-2 text-muted-foreground border-r">
                —
              </TableCell>
              {/* Opening total */}
              <TableCell className="text-xs text-right py-2 px-3 border-r font-semibold">
                {fmtNum(totals.opening)}
              </TableCell>
              {/* Add Pre total */}
              <TableCell className="text-xs text-right py-2 px-3 font-semibold">
                {fmtNum(totals.addPre)}
              </TableCell>
              {/* Add Post total */}
              <TableCell className="text-xs text-right py-2 px-3 border-r font-semibold">
                {fmtNum(totals.addPost)}
              </TableCell>
              {/* Deletions total */}
              <TableCell className="text-xs text-right py-2 px-3 border-r font-semibold">
                {fmtNum(totals.deletions)}
              </TableCell>
              {/* Total total */}
              <TableCell className="text-xs text-right py-2 px-3 border-r font-semibold">
                {fmtNum(totals.total)}
              </TableCell>
              {/* Depreciation total */}
              <TableCell className="text-xs text-right py-2 px-3 border-r font-semibold">
                {fmtNum(totals.depreciation)}
              </TableCell>
              {/* Closing total */}
              <TableCell className="text-xs text-right py-2 px-3 font-semibold">
                {fmtNum(totals.closing)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Legend */}
      <p className="text-[11px] text-muted-foreground pl-1">
        * Shaded columns (Total, Closing Balance) are auto-calculated. Total = Opening + Additions − Deletions; Closing = Total − Depreciation.&ensp;
        Depreciation auto-calculates as (Opening + Additions acquired on or before 180 days − Deletions) × Rate% + (Additions acquired after 180 days) × Rate%/2.
      </p>

      {/* Bottom save — hidden in readOnly / preview mode */}
      {!readOnly && (
        <div className="flex justify-end pt-1">
          <SaveBtn />
        </div>
      )}
    </div>
  );
}
