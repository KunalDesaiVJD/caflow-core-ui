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
import { Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssetRow {
  sort_order:       number;
  asset_category:   "tangible" | "intangible";
  asset_name:       string;   // editable for "Others" rows
  rate_pct:         number;
  opening_balance:  number;
  additions_pre:    number;
  additions_post:   number;
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
  return Math.round((r.opening_balance + r.additions_pre + r.additions_post) * 100) / 100;
}

function calcClosing(r: AssetRow): number {
  return Math.round((calcRowTotal(r) - r.depreciation) * 100) / 100;
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

export function NCEPPESchedule({ engagementId }: Props) {
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
          for (const db of data) {
            const idx = built.findIndex(r => r.sort_order === db.sort_order);
            if (idx >= 0) {
              built[idx] = {
                sort_order:      db.sort_order,
                asset_category:  db.asset_category as "tangible" | "intangible",
                asset_name:      db.asset_name,
                rate_pct:        Number(db.rate_pct)        || 0,
                opening_balance: Number(db.opening_balance) || 0,
                additions_pre:   Number(db.additions_pre)   || 0,
                additions_post:  Number(db.additions_post)  || 0,
                depreciation:    Number(db.depreciation)    || 0,
              };
            }
          }
          setRows(built);
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

  // ── Totals ──────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const sum = (f: keyof AssetRow) =>
      rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const totalTotal   = rows.reduce((s, r) => s + calcRowTotal(r), 0);
    const totalClosing = rows.reduce((s, r) => s + calcClosing(r),  0);
    return {
      opening:      sum("opening_balance"),
      addPre:       sum("additions_pre"),
      addPost:      sum("additions_post"),
      total:        Math.round(totalTotal   * 100) / 100,
      depreciation: sum("depreciation"),
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
        total:           calcRowTotal(r),
        depreciation:    r.depreciation,
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
  const tangibleRows   = rows.filter(r => r.asset_category === "tangible");
  const intangibleRows = rows.filter(r => r.asset_category === "intangible");

  const SaveBtn = () => (
    <Button size="sm" onClick={handleSave} disabled={saving}>
      {saving
        ? <Loader2 className="animate-spin h-4 w-4 mr-1.5" />
        : <Save className="h-4 w-4 mr-1.5" />}
      Save PPE Schedule
    </Button>
  );

  /** Render one asset row. isFirst drives whether the rowspan Category cell appears. */
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

        {/* Col 2: Asset Name */}
        <TableCell className="py-1 px-2 text-xs border-r" style={{ minWidth: "160px" }}>
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
              <span>{def.defaultName}</span>
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

        {/* Col 7: Total (read-only) */}
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput value={rowTotal} readOnly />
        </TableCell>

        {/* Col 8: Depreciation */}
        <TableCell className="p-1 border-r" style={{ minWidth: "88px" }}>
          <NumInput
            value={row.depreciation}
            onChange={v => updateRow(row.sort_order, "depreciation", v)}
          />
        </TableCell>

        {/* Col 9: Closing Balance (read-only) */}
        <TableCell className="p-1" style={{ minWidth: "88px" }}>
          <NumInput value={closing} readOnly />
        </TableCell>
      </TableRow>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
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

      {/* Top save */}
      <div className="flex justify-end">
        <SaveBtn />
      </div>

      {/* PPE Table */}
      <div className="overflow-x-auto rounded-lg border">
        <Table style={{ tableLayout: "fixed", minWidth: "920px" }}>
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
                before 29/09/{pyYear}
              </TableHead>
              <TableHead className="text-[10px] text-center border-r w-[98px]">
                Acquired
                <br />
                after 29/09/{pyYear}
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {/* ── Tangible Assets ── */}
            {tangibleRows.map((row, idx) => {
              const def = ASSET_ROW_DEFS.find(d => d.sort_order === row.sort_order)!;
              return renderAssetRow(
                row,
                def,
                idx === 0,
                TANGIBLE_COUNT,
                "(a) Tangible Assets",
              );
            })}

            {/* ── Intangible Assets ── */}
            {intangibleRows.map((row, idx) => {
              const def = ASSET_ROW_DEFS.find(d => d.sort_order === row.sort_order)!;
              return renderAssetRow(
                row,
                def,
                idx === 0,
                INTANGIBLE_COUNT,
                "(b) Intangible Assets",
              );
            })}

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
        * Shaded columns (Total, Closing Balance) are auto-calculated.&ensp;
        Rate % is for reference only and does not auto-calculate depreciation.
      </p>

      {/* Bottom save */}
      <div className="flex justify-end pt-1">
        <SaveBtn />
      </div>
    </div>
  );
}
