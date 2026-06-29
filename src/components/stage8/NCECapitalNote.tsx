// NCECapitalNote — constrained-edit Owners'/Partners' Capital note
// (FS_NCE_CONSTRAINED_NOTES). The employee types the MOVEMENT breakup; the
// CLOSING total is locked to COA mapping (NCE_CAP), CY + PY. A live
// "difference to explain" line must reach ₹0 before the note can be saved, and
// the save itself is re-validated server-side by the save-nce-constrained-note
// edge function (which re-derives COA and rejects any non-tying write).
// NCE-only; renders nothing when the flag is OFF.
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeCOATotals } from "@/lib/fsReconciliation";
import { FS_NCE_CONSTRAINED_NOTES } from "@/lib/nceFeatureFlags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Lock, AlertTriangle, CheckCircle2, Save, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Col = "cy" | "py";
interface Mov { opening: number; introduced: number; profit_share: number; interest_on_cap: number; remuneration: number; drawings: number; }
interface PartnerRow { partner_name: string; cy: Mov; py: Mov; }

const ZERO: Mov = { opening: 0, introduced: 0, profit_share: 0, interest_on_cap: 0, remuneration: 0, drawings: 0 };
const closingOf = (m: Mov) => m.opening + m.introduced + m.profit_share + m.interest_on_cap + m.remuneration - m.drawings;
const r2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => Math.abs(Math.round(n)).toLocaleString("en-IN");
const TB_PAGE = 1000;

const FIELDS: { key: keyof Mov; label: string; sub?: boolean }[] = [
  { key: "opening", label: "Opening" },
  { key: "introduced", label: "Add: Introduced" },
  { key: "interest_on_cap", label: "Add: Interest" },
  { key: "remuneration", label: "Add: Remuneration" },
  { key: "profit_share", label: "Add: Share of profit" },
  { key: "drawings", label: "Less: Drawings", sub: true },
];

async function loadTB(engagementId: string) {
  const rows: any[] = [];
  for (let f = 0; ; f += TB_PAGE) {
    const { data } = await supabase
      .from("tally_trial_balance")
      .select("ledger_name,closing_balance,balance_type,opening_balance,opening_type")
      .eq("engagement_id", engagementId).order("ledger_name").range(f, f + TB_PAGE - 1);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < TB_PAGE) break;
  }
  return rows;
}

interface Props { engagementId: string; readOnly?: boolean; }

export default function NCECapitalNote({ engagementId, readOnly }: Props) {
  const [loading, setLoading] = useState(true);
  const [financialYear, setFinancialYear] = useState("");
  const [saving, setSaving] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [hasPyShell, setHasPyShell] = useState(false);
  const [coaCap, setCoaCap] = useState<{ cy: number; py: number }>({ cy: 0, py: 0 });
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [col, setCol] = useState<Col>("cy");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data: eng } = await supabase.from("audit_engagements")
        .select("client_id, coa_mapping, notes_finalized, financial_year").eq("id", engagementId).maybeSingle();
      setFinalized(!!(eng as any)?.notes_finalized);
      const fy = String((eng as any)?.financial_year ?? "");
      setFinancialYear(fy);
      const cyMap = ((eng as any)?.coa_mapping ?? {}) as Record<string, { code: string }>;
      const cyTb = await loadTB(engagementId);
      const p = String(fy).split("-");
      const prevFy = p.length === 2 ? `${parseInt(p[0]) - 1}-${String(parseInt(p[0])).slice(-2)}` : "";
      let pyTb: any[] = []; let pyMap: Record<string, { code: string }> = {};
      if (prevFy && (eng as any)?.client_id) {
        const { data: shells } = await supabase.from("audit_engagements")
          .select("id, coa_mapping").eq("client_id", (eng as any).client_id)
          .eq("financial_year", prevFy).eq("is_py_shell", true);
        for (const s of (shells ?? []) as any[]) {
          const tb = await loadTB(s.id);
          if (tb.length) { pyTb = tb; pyMap = (s.coa_mapping ?? {}) as any; break; }
        }
      }
      setHasPyShell(pyTb.length > 0);
      const coa = computeCOATotals(cyTb as any, pyTb as any, cyMap, pyMap)["NCE_CAP"] ?? { cy: 0, py: 0 };
      setCoaCap({ cy: r2(coa.cy), py: r2(coa.py) });

      const { data: existing } = await supabase.from("nce_capital_note")
        .select("*").eq("engagement_id", engagementId).eq("financial_year", fy).order("sort_order");
      const byPartner = new Map<string, PartnerRow>();
      for (const row of (existing ?? []) as any[]) {
        const pr = byPartner.get(row.partner_name) ?? { partner_name: row.partner_name, cy: { ...ZERO }, py: { ...ZERO } };
        const m: Mov = { opening: +row.opening, introduced: +row.introduced, profit_share: +row.profit_share, interest_on_cap: +row.interest_on_cap, remuneration: +row.remuneration, drawings: +row.drawings };
        if (row.col === "py") pr.py = m; else pr.cy = m;
        byPartner.set(row.partner_name, pr);
      }
      const list = [...byPartner.values()];
      setRows(list.length ? list : [{ partner_name: "Partner / Proprietor", cy: { ...ZERO }, py: { ...ZERO } }]);
    } catch (e: any) {
      toast.error(`Failed to load capital note: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { if (FS_NCE_CONSTRAINED_NOTES) reload(); }, [reload]);

  const sumClose = useMemo(() => ({
    cy: r2(rows.reduce((s, r) => s + closingOf(r.cy), 0)),
    py: r2(rows.reduce((s, r) => s + closingOf(r.py), 0)),
  }), [rows]);
  const diff = useMemo(() => ({ cy: r2(coaCap.cy - sumClose.cy), py: r2(coaCap.py - sumClose.py) }), [coaCap, sumClose]);
  const cyTied = Math.abs(diff.cy) <= 1;
  const pyTied = !hasPyShell || Math.abs(diff.py) <= 1;
  const editable = !readOnly && !finalized;
  const canSave = editable && cyTied && pyTied && !saving;

  const setCell = (i: number, key: keyof Mov, val: string) => {
    const v = val === "" || val === "-" ? 0 : Number(val);
    if (Number.isNaN(v)) return;
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [col]: { ...r[col], [key]: v } } : r));
  };
  const addPartner = () => setRows(prev => [...prev, { partner_name: `Partner ${prev.length + 1}`, cy: { ...ZERO }, py: { ...ZERO } }]);
  const removePartner = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const autoBalance = () => {
    // absorb the active column's difference into the last row's share of profit
    if (!rows.length) return;
    setRows(prev => prev.map((r, idx) => idx === prev.length - 1
      ? { ...r, [col]: { ...r[col], profit_share: r2(r[col].profit_share + diff[col]) } } : r));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: any[] = [];
      rows.forEach((r, i) => {
        const base = { partner_name: r.partner_name, sort_order: i, is_balancing_row: i === rows.length - 1 };
        payload.push({ ...base, col: "cy", ...r.cy });
        if (hasPyShell) payload.push({ ...base, col: "py", ...r.py });
      });
      const { data, error } = await supabase.functions.invoke("save-nce-constrained-note", {
        body: { type: "capital", engagement_id: engagementId, financial_year: financialYear, rows: payload },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) {
        const ms = (data as any)?.mismatches as string[] | undefined;
        toast.error(ms?.length ? ms.join("  ·  ") : (data as any).error);
        return;
      }
      toast.success("Capital note saved — ties to COA mapping.");
      reload();
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  if (!FS_NCE_CONSTRAINED_NOTES) return null;
  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground p-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading capital note…</div>;

  const activeDiff = diff[col];
  const activeTied = Math.abs(activeDiff) <= 1;

  return (
    <div className="space-y-3">
      {/* Locked COA anchor */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Lock className="h-3.5 w-3.5" /> Closing per COA mapping (locked):
        </span>
        <span>CY <span className="font-medium tabular-nums">₹{inr(coaCap.cy)}</span></span>
        {hasPyShell && <span>PY <span className="font-medium tabular-nums">₹{inr(coaCap.py)}</span></span>}
        <span className="ml-auto inline-flex items-center gap-3 text-xs">
          <span className={cn("inline-flex items-center gap-1", cyTied ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
            {cyTied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} CY {cyTied ? "ties" : `off ₹${inr(diff.cy)}`}
          </span>
          {hasPyShell && (
            <span className={cn("inline-flex items-center gap-1", pyTied ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
              {pyTied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} PY {pyTied ? "ties" : `off ₹${inr(diff.py)}`}
            </span>
          )}
        </span>
      </div>

      {/* CY / PY toggle */}
      {hasPyShell && (
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
          {(["cy", "py"] as Col[]).map(c => (
            <button key={c} onClick={() => setCol(c)}
              className={cn("px-3 py-1 rounded", col === c ? "bg-muted font-medium" : "text-muted-foreground")}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[140px]">Partner / Proprietor</TableHead>
            {FIELDS.map(f => <TableHead key={f.key} className="text-right">{f.label}</TableHead>)}
            <TableHead className="text-right">Closing</TableHead>
            {editable && <TableHead className="w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell>
                <Input value={r.partner_name} disabled={!editable}
                  onChange={e => setRows(prev => prev.map((x, idx) => idx === i ? { ...x, partner_name: e.target.value } : x))}
                  className="h-8" />
              </TableCell>
              {FIELDS.map(f => (
                <TableCell key={f.key} className="text-right">
                  <Input type="number" value={r[col][f.key] || ""} disabled={!editable}
                    onChange={e => setCell(i, f.key, e.target.value)}
                    className="h-8 text-right tabular-nums w-28 ml-auto" />
                </TableCell>
              ))}
              <TableCell className="text-right font-medium tabular-nums">{inr(closingOf(r[col]))}</TableCell>
              {editable && (
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removePartner(i)} aria-label="Remove partner">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Breakup total + difference-to-explain */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm border-t border-border pt-3">
        <span className="text-muted-foreground">Your breakup total ({col.toUpperCase()}): <span className="font-medium tabular-nums text-foreground">₹{inr(sumClose[col])}</span></span>
        <span className={cn("inline-flex items-center gap-1.5 font-medium", activeTied ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
          {activeTied ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          Difference to explain: ₹{inr(activeDiff)}
        </span>
        {editable && !activeTied && (
          <Button variant="outline" size="sm" onClick={autoBalance} className="gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Fill ₹{inr(activeDiff)} to balance (share of profit)
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {editable && <Button variant="outline" size="sm" onClick={addPartner} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add partner</Button>}
        <Button size="sm" onClick={save} disabled={!canSave} className="gap-1.5 ml-auto">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {finalized ? "Notes finalized (locked)" : !cyTied || !pyTied ? "Fix the difference to save" : "Save capital note"}
        </Button>
      </div>
    </div>
  );
}
