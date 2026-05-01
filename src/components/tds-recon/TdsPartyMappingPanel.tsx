/**
 * TdsPartyMappingPanel  (Phase TDS-2)
 *
 * Review UI for AI-generated TB ledger ↔ TDS deductee matches.
 * Features:
 *   • "Run AI Mapper" button — invokes tds-ai-mapper edge function
 *   • Summary KPI chips (Confirmed / Pending / Needs Review / Rejected)
 *   • Filterable table with confidence bar, match method badge, status badge
 *   • Per-row actions: Confirm ✓ / Reject ✗ / Edit (inline override)
 *   • Inline edit: change deductee name, section, add note → saved to DB
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import { Input }  from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bot, RefreshCw, CheckCircle2, XCircle, Pencil, Save, X,
  ChevronDown, ChevronRight, Info, Loader2, Search, ExternalLink,
  AlertTriangle, BadgeCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useTdsPartyMappings, MappingStatus, TbPartyMapping,
} from "./hooks/useTdsPartyMappings";
import { runAiMapper } from "./tdsEngine";

// ─── Common TDS sections for the edit dropdown ────────────────────────────────
const TDS_SECTIONS = [
  "192", "192A", "193", "194", "194A", "194B", "194BB",
  "194C", "194D", "194DA", "194E", "194EE", "194F", "194G",
  "194H", "194I", "194IB", "194IC", "194J", "194K", "194LA",
  "194LB", "194LC", "194LD", "194M", "194N", "194O", "194P",
  "194Q", "194R", "194S", "195", "196A", "196B", "196C",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiChip({
  label, count, color, active, onClick,
}: {
  label: string; count: number;
  color: "green" | "amber" | "orange" | "red" | "slate";
  active: boolean; onClick: () => void;
}) {
  const colorMap = {
    green: "bg-green-50 border-green-200 text-green-700 hover:bg-green-100",
    amber: "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100",
    orange:"bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100",
    red:   "bg-red-50   border-red-200   text-red-700   hover:bg-red-100",
    slate: "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all",
        colorMap[color],
        active && "ring-2 ring-offset-1",
        active && color === "green"  && "ring-green-400",
        active && color === "amber"  && "ring-amber-400",
        active && color === "orange" && "ring-orange-400",
        active && color === "red"    && "ring-red-400",
        active && color === "slate"  && "ring-slate-400",
      )}
    >
      <span className="font-bold text-sm">{count}</span>
      <span>{label}</span>
    </button>
  );
}

function ConfidenceBar({ value }: { value: number | null }) {
  const v = value ?? 0;
  const color =
    v >= 80 ? "bg-green-500" :
    v >= 60 ? "bg-amber-500" :
    v >= 40 ? "bg-orange-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5 w-24">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-6 text-right">{v}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: MappingStatus }) {
  const meta: Record<MappingStatus, { label: string; className: string }> = {
    confirmed:    { label: "Confirmed",    className: "bg-green-100 text-green-700 border-green-200" },
    pending:      { label: "Pending",      className: "bg-amber-100 text-amber-700 border-amber-200" },
    needs_review: { label: "Needs Review", className: "bg-orange-100 text-orange-700 border-orange-200" },
    rejected:     { label: "Rejected",     className: "bg-red-100 text-red-700 border-red-200" },
  };
  const m = meta[status] ?? meta["pending"];
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border font-medium", m.className)}>
      {m.label}
    </span>
  );
}

function MethodBadge({ method }: { method: string | null }) {
  if (!method) return null;
  const parts = (method || "").split("+");
  return (
    <div className="flex flex-wrap gap-0.5">
      {parts.map(p => (
        <span key={p} className="inline-flex items-center px-1 py-0.5 rounded bg-blue-50 border border-blue-100 text-[9px] text-blue-600 font-mono">
          {p}
        </span>
      ))}
    </div>
  );
}

// ─── Inline edit form ─────────────────────────────────────────────────────────
function EditForm({
  mapping, onSave, onCancel, saving,
}: {
  mapping: TbPartyMapping;
  onSave: (patch: { tds_deductee_name: string; tds_section_code: string | null; notes: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name,    setName]    = useState(mapping.tds_deductee_name);
  const [section, setSection] = useState(mapping.tds_section_code ?? "");
  const [note,    setNote]    = useState(mapping.notes ?? "");

  return (
    <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-lg space-y-2">
      <p className="text-[11px] font-semibold text-blue-700">Override Mapping</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">TDS Deductee Name</label>
          <Input
            value={name} onChange={e => setName(e.target.value)}
            className="h-7 text-xs"
            placeholder="Exact name from TDS filing"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">TDS Section</label>
          <Select value={section} onValueChange={setSection}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Select section" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— None —</SelectItem>
              {TDS_SECTIONS.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">Note (optional)</label>
        <Textarea
          value={note} onChange={e => setNote(e.target.value)}
          className="min-h-[48px] text-xs"
          placeholder="Reason for override…"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onCancel} disabled={saving}>
          <X size={11} className="mr-1" /> Cancel
        </Button>
        <Button
          size="sm" variant="default" className="h-6 text-xs bg-blue-600 hover:bg-blue-700"
          onClick={() => onSave({ tds_deductee_name: name.trim(), tds_section_code: section || null, notes: note })}
          disabled={!name.trim() || saving}
        >
          {saving ? <Loader2 size={11} className="animate-spin mr-1" /> : <Save size={11} className="mr-1" />}
          Save &amp; Confirm
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
}

type FilterStatus = MappingStatus | "all";

export function TdsPartyMappingPanel({ clientId, financialYear }: Props) {
  const {
    mappings, loading, error, counts, firmId,
    refresh, updateStatus, updateMapping,
  } = useTdsPartyMappings(clientId, financialYear);

  const [running,     setRunning]     = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [search,      setSearch]      = useState("");
  const [editId,      setEditId]      = useState<string | null>(null);
  const [savingId,    setSavingId]    = useState<string | null>(null);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  // ── Run AI Mapper ────────────────────────────────────────────────────────────
  const runMapper = useCallback(async (force = false) => {
    if (!clientId || !financialYear || !firmId) {
      toast.error("Cannot run mapper — missing client, FY, or firm context");
      return;
    }
    setRunning(true);
    try {
      const r = await runAiMapper({ client_id: clientId, financial_year: financialYear, firm_id: firmId, force_rematch: force });
      if (r.message && r.mapped === 0) {
        toast.info(r.message);
      } else {
        toast.success(
          `Mapper complete: ${r.mapped} matched ` +
          `(${r.confirmed} auto-confirmed, ${r.pending} pending, ${r.needs_review} needs review)` +
          (r.skipped ? ` · ${r.skipped} ledgers skipped (already mapped)` : ""),
        );
      }
      refresh();
    } catch (err: unknown) {
      toast.error(`Mapper failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }, [clientId, financialYear, firmId, refresh]);

  // ── Filter mappings ──────────────────────────────────────────────────────────
  const visible = mappings.filter(m => {
    if (filterStatus !== "all" && m.mapping_status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        m.tb_ledger_name.toLowerCase().includes(q) ||
        m.tds_deductee_name.toLowerCase().includes(q) ||
        (m.tds_section_code || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ── Row actions ──────────────────────────────────────────────────────────────
  const handleConfirm = async (id: string) => {
    setSavingId(id);
    try { await updateStatus(id, "confirmed"); toast.success("Mapping confirmed"); }
    catch (e: unknown) { toast.error(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSavingId(null); }
  };
  const handleReject = async (id: string) => {
    setSavingId(id);
    try { await updateStatus(id, "rejected"); toast.success("Mapping rejected"); }
    catch (e: unknown) { toast.error(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSavingId(null); }
  };
  const handleSaveEdit = async (id: string, patch: {
    tds_deductee_name: string; tds_section_code: string | null; notes: string;
  }) => {
    setSavingId(id);
    try {
      await updateMapping(id, patch);
      setEditId(null);
      toast.success("Mapping updated and confirmed");
    } catch (e: unknown) {
      toast.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSavingId(null); }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <KpiChip label="All"           count={counts.total}        color="slate"  active={filterStatus === "all"}          onClick={() => setFilterStatus("all")} />
          <KpiChip label="Confirmed"     count={counts.confirmed}    color="green"  active={filterStatus === "confirmed"}    onClick={() => setFilterStatus("confirmed")} />
          <KpiChip label="Pending"       count={counts.pending}      color="amber"  active={filterStatus === "pending"}      onClick={() => setFilterStatus("pending")} />
          <KpiChip label="Needs Review"  count={counts.needs_review} color="orange" active={filterStatus === "needs_review"} onClick={() => setFilterStatus("needs_review")} />
          <KpiChip label="Rejected"      count={counts.rejected}     color="red"    active={filterStatus === "rejected"}     onClick={() => setFilterStatus("rejected")} />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search ledger or deductee…"
              className="h-7 pl-8 pr-2 text-xs rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-44"
            />
          </div>
          <Button
            size="sm" variant="ghost" className="h-7 text-xs gap-1"
            onClick={() => refresh()} disabled={loading}
          >
            <RefreshCw size={11} className={cn(loading && "animate-spin")} />
          </Button>
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs gap-1.5 border-purple-200 text-purple-700 hover:bg-purple-50"
            onClick={() => runMapper(false)} disabled={running || !firmId}
          >
            {running
              ? <Loader2 size={11} className="animate-spin" />
              : <Bot size={11} />}
            {running ? "Running…" : "Run AI Mapper"}
          </Button>
          {counts.total > 0 && (
            <Button
              size="sm" variant="ghost"
              className="h-7 text-[10px] text-muted-foreground"
              onClick={() => runMapper(true)} disabled={running}
            >
              Re-run All
            </Button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* ── Empty / Loading ── */}
      {loading && (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading mappings…
        </div>
      )}

      {!loading && mappings.length === 0 && (
        <div className="flex flex-col items-center justify-center h-44 gap-3 text-center text-muted-foreground border rounded-lg border-dashed">
          <Bot size={32} className="text-muted-foreground/25" />
          <div>
            <p className="text-sm font-medium text-foreground">No mappings yet</p>
            <p className="text-xs mt-1">
              Click <strong>Run AI Mapper</strong> to match Trial Balance ledgers to TDS deductees.
            </p>
          </div>
        </div>
      )}

      {/* ── Mappings table ── */}
      {!loading && mappings.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_80px_100px_110px_130px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30 border-b">
            <span>TB Ledger (Tally)</span>
            <span>TDS Deductee (Gross / TDS Deducted)</span>
            <span>Section</span>
            <span>Confidence</span>
            <span>Method</span>
            <span>Status / Actions</span>
          </div>

          <div className="divide-y">
            {visible.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No mappings match the current filter.
              </div>
            )}

            {visible.map(m => {
              const isExpanded = expandedId === m.id;
              const isEditing  = editId === m.id;
              const isSaving   = savingId === m.id;

              return (
                <div key={m.id} className="hover:bg-muted/10 transition-colors">

                  {/* Main row */}
                  <div className="grid grid-cols-[1fr_1fr_80px_100px_110px_130px] gap-2 items-center px-4 py-2.5">

                    {/* TB Ledger */}
                    <div>
                      <p className="text-xs font-medium truncate" title={m.tb_ledger_name}>
                        {m.tb_ledger_name}
                      </p>
                      {m.tb_parent_group && (
                        <p className="text-[10px] text-muted-foreground truncate">{m.tb_parent_group}</p>
                      )}
                      {m.tb_total_debit != null && (
                        <p className="text-[10px] text-muted-foreground">
                          ₹{m.tb_total_debit.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          <span className="text-[9px] italic ml-1">(incl. GST)</span>
                        </p>
                      )}
                      {/* Issue 5: ledger access link */}
                      <Link
                        to={`/audit/stage/5?ledger=${encodeURIComponent(m.tb_ledger_name)}`}
                        className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline mt-0.5"
                      >
                        <ExternalLink size={9} /> View ledger
                      </Link>
                    </div>

                    {/* TDS Deductee — shows gross amount + TDS deducted + match indicators */}
                    <div className="space-y-0.5">
                      <p className="text-xs truncate" title={m.tds_deductee_name}>
                        {m.tds_deductee_name}
                      </p>

                      {/* Gross amount row with match indicator */}
                      {m.tds_total_amount != null && (() => {
                        const tbGross = m.tb_total_debit ?? 0;
                        const tdsGross = m.tds_total_amount;
                        const ratio = tbGross > 0 ? tdsGross / tbGross : 0;
                        const ratioNet = tbGross > 0 ? tdsGross / (tbGross / 1.18) : 0;
                        const grossMatch = (ratio >= 0.75 && ratio <= 1.35) || (Math.abs(ratioNet - 1) < 0.10);
                        const gstCause  = !grossMatch && ratio < 0.75 && Math.abs(ratioNet - 1) < 0.15;
                        return (
                          <div className="flex items-center gap-1">
                            {grossMatch
                              ? <BadgeCheck size={9} className="text-green-500 shrink-0" />
                              : <AlertTriangle size={9} className={cn("shrink-0", gstCause ? "text-amber-500" : "text-red-400")} />}
                            <span className="text-[10px] text-muted-foreground">
                              Gross: ₹{tdsGross.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                            </span>
                            {!grossMatch && gstCause && (
                              <span className="text-[9px] text-amber-600 italic">+GST?</span>
                            )}
                          </div>
                        );
                      })()}

                      {/* TDS deducted row */}
                      {m.tds_tds_amount != null ? (
                        <div className="flex items-center gap-1">
                          {m.tds_tds_amount > 0
                            ? <BadgeCheck size={9} className="text-green-500 shrink-0" />
                            : <AlertTriangle size={9} className="text-red-400 shrink-0" />}
                          <span className="text-[10px] text-muted-foreground">
                            TDS: ₹{m.tds_tds_amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                            {m.tds_tds_amount <= 0 && (
                              <span className="text-red-400 ml-1 italic">no TDS filed</span>
                            )}
                          </span>
                        </div>
                      ) : (
                        /* Older row without tds_tds_amount — show neutral placeholder */
                        <span className="text-[10px] text-muted-foreground/50 italic">TDS: —</span>
                      )}
                    </div>

                    {/* Section */}
                    <div>
                      {m.tds_section_code
                        ? <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{m.tds_section_code}</Badge>
                        : <span className="text-[10px] text-muted-foreground">—</span>}
                    </div>

                    {/* Confidence */}
                    <ConfidenceBar value={m.match_confidence} />

                    {/* Method */}
                    <MethodBadge method={m.match_method} />

                    {/* Status + Actions */}
                    <div className="flex flex-col gap-1 items-start">
                      <StatusBadge status={m.mapping_status} />
                      <div className="flex items-center gap-1">
                        {m.mapping_status !== "confirmed" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="p-0.5 rounded text-green-600 hover:bg-green-50 disabled:opacity-40"
                                onClick={() => handleConfirm(m.id)}
                                disabled={isSaving}
                              >
                                {isSaving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Confirm this mapping</TooltipContent>
                          </Tooltip>
                        )}
                        {m.mapping_status !== "rejected" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="p-0.5 rounded text-red-500 hover:bg-red-50 disabled:opacity-40"
                                onClick={() => handleReject(m.id)}
                                disabled={isSaving}
                              >
                                <XCircle size={13} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Reject mapping</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="p-0.5 rounded text-blue-500 hover:bg-blue-50"
                              onClick={() => { setEditId(isEditing ? null : m.id); setExpandedId(null); }}
                            >
                              <Pencil size={12} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Edit / override mapping</TooltipContent>
                        </Tooltip>
                        {m.ai_reasoning && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="p-0.5 rounded text-muted-foreground hover:bg-muted/50"
                                onClick={() => setExpandedId(isExpanded ? null : m.id)}
                              >
                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">AI reasoning</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {m.mapped_by === "auditor" && (
                        <span className="text-[9px] text-blue-600">Manually confirmed</span>
                      )}
                    </div>
                  </div>

                  {/* Expanded reasoning */}
                  {isExpanded && m.ai_reasoning && (
                    <div className="px-4 pb-3">
                      <div className="flex gap-2 items-start p-2.5 bg-blue-50/50 rounded border border-blue-100 text-xs text-blue-800">
                        <Info size={12} className="flex-shrink-0 mt-0.5" />
                        <p>{m.ai_reasoning}</p>
                      </div>
                      {m.notes && (
                        <p className="text-[11px] text-muted-foreground mt-1.5 italic">Note: {m.notes}</p>
                      )}
                    </div>
                  )}

                  {/* Inline edit form */}
                  {isEditing && (
                    <div className="px-4 pb-3">
                      <EditForm
                        mapping={m}
                        onSave={patch => handleSaveEdit(m.id, patch)}
                        onCancel={() => setEditId(null)}
                        saving={isSaving}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Footer count ── */}
      {!loading && mappings.length > 0 && (
        <p className="text-[10px] text-muted-foreground text-right">
          Showing {visible.length} of {mappings.length} mappings
        </p>
      )}
    </div>
    </TooltipProvider>
  );
}
