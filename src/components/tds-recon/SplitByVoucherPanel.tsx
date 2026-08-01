/**
 * SplitByVoucherPanel
 *
 * Voucher-level drill-down inside a Party Mapping row (Scenario 1 —
 * one Tally ledger, mixed 194C + 194J transactions). Auditor can:
 *
 *   • See every voucher posted to the mapped TB ledger
 *   • Bulk-select vouchers and assign them to a specific TDS section
 *   • Override on a per-row basis via a Section dropdown
 *   • Clear an override (falls back to the mapping's default section)
 *   • See running section totals so the split is auditable at a glance
 *
 * Persisted via `tds_voucher_classification`. See
 * useTdsVoucherClassifications for the read + mutate contract.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTdsVoucherClassifications, type ClassifiedVoucher,
} from "./hooks/useTdsVoucherClassifications";

const TDS_SECTIONS = [
  "192","192A","193","194","194A","194B","194BB",
  "194C","194D","194DA","194E","194EE","194F","194G",
  "194H","194I","194IB","194IC","194J","194K","194LA",
  "194LB","194LC","194LD","194M","194N","194O","194P",
  "194Q","194R","194S","195","196A","196B","196C",
];
const NONE = "__none__";
const DEFAULT_TOKEN = "__default__";

function fmtINR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

export function SplitByVoucherPanel({
  clientId, firmId, financialYear, engagementId,
  mappingId, tbLedgerName, defaultSection,
}: {
  clientId:       string | null | undefined;
  firmId:         string | null | undefined;
  financialYear:  string | null | undefined;
  engagementId:   string | null | undefined;
  mappingId:      string;
  tbLedgerName:   string;
  defaultSection: string | null;
}) {
  const {
    rows, loading, error, updateOne, bulkAssign, clearOne, bulkClear,
  } = useTdsVoucherClassifications({
    enabled: true,
    clientId, firmId, financialYear, engagementId,
    mappingId, tbLedgerName, defaultSection,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSection, setBulkSection] = useState<string>(defaultSection ?? "194C");

  const totals = useMemo(() => {
    const bySection = new Map<string, number>();
    for (const r of rows) {
      const key = r.effectiveSection ?? "(none)";
      const val = Math.abs(Number(r.voucher.this_amount ?? r.voucher.amount ?? 0));
      bySection.set(key, (bySection.get(key) ?? 0) + val);
    }
    return Array.from(bySection.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(s => s.size === rows.length ? new Set() : new Set(rows.map(r => r.voucher.id)));

  const applyBulk = () => {
    if (selected.size === 0) return;
    const target = bulkSection === NONE ? null : bulkSection;
    void bulkAssign(Array.from(selected), target);
    setSelected(new Set());
  };
  const clearBulk = () => {
    if (selected.size === 0) return;
    void bulkClear(Array.from(selected));
    setSelected(new Set());
  };

  return (
    <div className="p-3 bg-slate-50/60 border border-slate-200 rounded-lg space-y-3">
      {/* Header + totals */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-slate-700">Split by voucher</p>
          <p className="text-[10px] text-muted-foreground">
            Per-voucher TDS-section override. Rows without an override use the mapping default
            {defaultSection && <span className="font-mono ml-1">{defaultSection}</span>}.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {totals.map(([sec, amt]) => (
            <span
              key={sec}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium",
                sec === "(none)"
                  ? "bg-muted text-muted-foreground border"
                  : "bg-blue-50 text-blue-700 border-blue-200",
              )}
            >
              <span className="font-mono">{sec}</span>
              <span>₹{fmtINR(amt)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Bulk toolbar */}
      <div className="flex items-center gap-2 flex-wrap p-2 bg-white border border-slate-200 rounded">
        <span className="text-[10px] text-muted-foreground">Bulk:</span>
        <span className="text-[10px]">{selected.size} selected</span>
        <div className="ml-2 w-28">
          <Select value={bulkSection} onValueChange={setBulkSection}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Section" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— None —</SelectItem>
              {TDS_SECTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="default"
          className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
          onClick={applyBulk} disabled={selected.size === 0}>
          Assign section
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={clearBulk} disabled={selected.size === 0}>
          Reset to default
        </Button>
      </div>

      {/* Vouchers table */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
          <Loader2 size={12} className="animate-spin" /> Loading vouchers…
        </div>
      ) : error ? (
        <div className="text-xs text-red-600 p-3 bg-red-50 border border-red-100 rounded">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground p-3">
          No vouchers found under &quot;{tbLedgerName}&quot; for FY {financialYear ?? "—"}.
        </div>
      ) : (
        <div className="overflow-auto max-h-[380px] border border-slate-200 rounded">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-slate-100 z-10">
              <tr>
                <th className="p-1.5 text-left w-8">
                  <Checkbox
                    checked={selected.size === rows.length && rows.length > 0}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="p-1.5 text-left w-20">Date</th>
                <th className="p-1.5 text-left">Particulars</th>
                <th className="p-1.5 text-left w-24">Vch Type</th>
                <th className="p-1.5 text-left w-16">No.</th>
                <th className="p-1.5 text-right w-24">Amount</th>
                <th className="p-1.5 text-center w-28">Section</th>
                <th className="p-1.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r: ClassifiedVoucher) => {
                const v = r.voucher;
                const value = r.classification?.section_code_override || DEFAULT_TOKEN;
                const amt = Math.abs(Number(v.this_amount ?? v.amount ?? 0));
                return (
                  <tr key={v.id} className={cn(
                    "border-t border-slate-100 hover:bg-slate-50/60",
                    selected.has(v.id) && "bg-blue-50/40",
                  )}>
                    <td className="p-1.5">
                      <Checkbox
                        checked={selected.has(v.id)}
                        onCheckedChange={() => toggle(v.id)}
                        aria-label={`Select voucher ${v.voucher_number ?? v.id}`}
                      />
                    </td>
                    <td className="p-1.5 whitespace-nowrap tabular-nums">{fmtDate(v.voucher_date)}</td>
                    <td className="p-1.5">
                      <div className="truncate max-w-[220px]" title={v.narration ?? ""}>
                        {v.narration || v.party_ledger || "—"}
                      </div>
                    </td>
                    <td className="p-1.5 text-muted-foreground">{v.voucher_type || "—"}</td>
                    <td className="p-1.5 font-mono text-muted-foreground">{v.voucher_number || "—"}</td>
                    <td className="p-1.5 text-right tabular-nums">₹{fmtINR(amt)}</td>
                    <td className="p-1.5">
                      <Select
                        value={value}
                        onValueChange={(v2) => {
                          if (v2 === DEFAULT_TOKEN) {
                            void clearOne(v.id);
                          } else {
                            void updateOne(v.id, {
                              section_code_override: v2 === NONE ? null : v2,
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_TOKEN}>
                            Default {defaultSection ? `(${defaultSection})` : ""}
                          </SelectItem>
                          <SelectItem value={NONE}>— None —</SelectItem>
                          {TDS_SECTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-1.5">
                      {r.classification && (
                        <button
                          type="button"
                          className="text-slate-400 hover:text-slate-600"
                          title="Clear override — revert to mapping default"
                          onClick={() => void clearOne(v.id)}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
