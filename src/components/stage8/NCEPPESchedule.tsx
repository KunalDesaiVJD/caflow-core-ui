import { useState, useEffect, useMemo } from "react";
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
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Sub-ledger sort_order encoding ──────────────────────────────────────────
// Parent rows use sort_order 1–11 (see ASSET_ROW_DEFS). User-added sub-ledgers
// under parent N are stored with sort_order = N * 100 + slot, where slot ∈ [1..99].
// This keeps every row in the same flat nce_ppe_schedule table without a
// schema migration: a row is a sub-ledger iff sort_order >= 100.
const SUB_BASE = 100;
const isSubLedger = (so: number) => so >= SUB_BASE;
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
 *  Previously this column was a manual input — auditors had to compute and
 *  type the figure by hand, prone to error. Now the input is read-only and
 *  the value is derived from rate %, opening balance, and the two
 *  date-bucketed addition columns. */
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
  return Math.round(depn * 100) / 100;
}

function calcClosing(r: AssetRow): number {
  const depn = calcDepreciation(r);
  return Math.round((calcRowTotal(r) - depn) * 100) / 100;
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

export function NCEPPESchedule({ engagementId, readOnly = false }: Props) {
  const [rows,    setRows]    = useState<AssetRow[]>(initRows);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [eng,     setEng]     = useState<any>(null);

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
          setRows([...built, ...subRows].sort((a, b) => a.sort_order - b.sort_order));
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Update ──────────────────────────────────────────────────────────────
  const updateRow = (sort_order: number, field: keyof AssetRow, value: number | string) => {
    setRows(prev =>
      prev.map(r => (r.sort_order === sort_order ? { ...r, [field]: value } : r))
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
    const totalDepn    = rows.reduce((s, r) => s + calcDepreciation(r), 0);
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
    try {
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
        depreciation:    calcDepreciation(r),
        closing_balance: calcClosing(r),
        sort_order:      r.sort_order,
      }));
      const { error: insErr } = await supabase.from("nce_ppe_schedule").insert(payload);
      if (insErr) throw insErr;
      toast.success("PPE Schedule saved");
    } catch (err: any) {
      toast.error(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
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
    <Button size="sm" onClick={handleSave} disabled={saving}>
      {saving
        ? <Loader2 className="animate-spin h-4 w-4 mr-1.5" />
        : <Save className="h-4 w-4 mr-1.5" />}
      Save PPE Schedule
    </Button>
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
          <NumInput value={calcDepreciation(row)} readOnly />
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
          <NumInput value={calcDepreciation(row)} readOnly />
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
