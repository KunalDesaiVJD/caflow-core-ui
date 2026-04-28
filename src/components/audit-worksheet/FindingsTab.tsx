/**
 * FindingsTab — Phase 5A
 *
 * Audit Findings Register — the formal output layer of the audit workflow.
 * Each finding captures: criteria, observation, impact, root cause,
 * recommendation, and management response (Big-4 style).
 *
 * Features:
 *   • Add / edit / delete findings inline
 *   • Risk rating (Critical / High / Medium / Low / Informational)
 *   • Status state machine: Open → Mgmt. Responded → Reviewed → Closed
 *   • Filter by risk or status; full-text search
 *   • KPI summary row at the top
 *   • "Generate Draft Report" → calls AuditReportGenerator to produce PDF
 *   • Expands each finding card in place for editing
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge }    from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ShieldAlert, Plus, Trash2, ChevronDown, ChevronUp,
  Loader2, FileText, ArrowRight, Search, X, CheckCircle2,
  AlertTriangle, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFindingsStorage }    from "./hooks/useFindingsStorage";
import {
  RISK_META, STATUS_META, AUDIT_CATEGORIES,
} from "./hooks/useFindingsStorage";
import type { AuditFinding, FindingRisk, FindingStatus } from "./hooks/useFindingsStorage";
import { generateAuditReport } from "./AuditReportGenerator";
import { useQuerySheetStorage } from "./hooks/useQuerySheetStorage";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data:              AuditWorksheetData;
  engagementId:      string;
  /** Phase 5: pre-fill a new finding from the Anomaly Feed */
  externalPrefill?:  { category: string; ledger: string; observation: string } | null;
  onPrefillConsumed?: () => void;
}

// ─── Risk badge ───────────────────────────────────────────────────────────────

function RiskBadge({ risk }: { risk: FindingRisk }) {
  const m = RISK_META[risk];
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border",
      m.bg, m.color, m.border,
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", m.dot)} />
      {m.label}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: FindingStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium border",
      m.bg, m.color, m.border,
    )}>
      {m.label}
    </span>
  );
}

// ─── Editable field pair ──────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, rows = 3, required,
}: {
  label:       string;
  value:       string;
  onChange:    (v: string) => void;
  placeholder?: string;
  rows?:       number;
  required?:   boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <Textarea
        rows={rows}
        className="text-xs resize-none"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

// ─── Single finding card ──────────────────────────────────────────────────────

function FindingCard({
  finding, index,
  onUpdate, onDelete, onAdvance,
}: {
  finding:   AuditFinding;
  index:     number;
  onUpdate:  <K extends keyof AuditFinding>(field: K, value: AuditFinding[K]) => void;
  onDelete:  () => void;
  onAdvance: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const riskMeta   = RISK_META[finding.risk_rating];
  const statusMeta = STATUS_META[finding.status];
  const isClosed   = finding.status === "closed";

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden transition-shadow",
      finding.risk_rating === "critical" && "border-red-200",
      finding.risk_rating === "high"     && "border-orange-200",
      finding.risk_rating === "medium"   && "border-amber-200",
      finding.risk_rating === "low"      && "border-blue-200",
      finding.risk_rating === "informational" && "border-gray-200",
      isClosed && "opacity-70",
    )}>

      {/* ── Card header (always visible) ── */}
      <button
        type="button"
        className={cn(
          "w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors",
          expanded && "bg-muted/10",
        )}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Colour stripe */}
        <div className={cn("w-1 self-stretch rounded-full flex-shrink-0 mt-0.5", riskMeta.dot)} />

        {/* Number */}
        <span className="text-[10px] font-mono text-muted-foreground mt-0.5 flex-shrink-0 w-8">
          {finding.finding_no}
        </span>

        {/* Title & meta */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <RiskBadge  risk={finding.risk_rating} />
            <StatusBadge status={finding.status} />
            {finding.category && (
              <span className="text-[10px] text-muted-foreground">{finding.category}</span>
            )}
          </div>
          <p className={cn(
            "text-sm font-medium truncate",
            finding.title ? "text-foreground" : "text-muted-foreground italic",
          )}>
            {finding.title || "Untitled finding — click to edit"}
          </p>
          {finding.observation && !expanded && (
            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
              {finding.observation}
            </p>
          )}
        </div>

        {/* Right: serial + toggle */}
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          <span className="text-[10px] text-muted-foreground">#{index + 1}</span>
          {expanded ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
        </div>
      </button>

      {/* ── Expanded edit body ── */}
      {expanded && (
        <div className="border-t bg-background/70 px-4 py-4 space-y-4">

          {/* Row 1: title, risk, status, category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Finding Title <span className="text-red-500">*</span>
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="Brief description of the finding"
                value={finding.title}
                onChange={e => onUpdate("title", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Risk */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Risk Rating</label>
                <Select value={finding.risk_rating} onValueChange={v => onUpdate("risk_rating", v as FindingRisk)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RISK_META) as FindingRisk[]).map(r => (
                      <SelectItem key={r} value={r} className="text-xs">
                        <span className={cn("font-medium", RISK_META[r].color)}>{RISK_META[r].label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Category</label>
                <Select value={finding.category} onValueChange={v => onUpdate("category", v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIT_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Observation + Criteria */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Observation / Condition" required
              placeholder="What was found during audit…"
              value={finding.observation} onChange={v => onUpdate("observation", v)} />
            <Field label="Criteria / Standard"
              placeholder="Applicable standard, policy, or regulation…"
              value={finding.criteria} onChange={v => onUpdate("criteria", v)} />
          </div>

          {/* Impact + Root Cause */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Impact / Effect"
              placeholder="What is the financial or operational risk…"
              value={finding.impact} onChange={v => onUpdate("impact", v)} />
            <Field label="Root Cause"
              placeholder="Why did this issue occur…"
              value={finding.root_cause} onChange={v => onUpdate("root_cause", v)} />
          </div>

          {/* Recommendation */}
          <Field label="Auditor's Recommendation" required
            placeholder="Recommended corrective action or control improvement…"
            value={finding.recommendation} onChange={v => onUpdate("recommendation", v)} />

          {/* Management response section */}
          <div className={cn(
            "rounded-lg border p-3 space-y-3",
            finding.management_response ? "bg-blue-50/40 border-blue-200" : "bg-muted/20",
          )}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Management Response
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Response / Comments" rows={2}
                placeholder="Management's response to this finding…"
                value={finding.management_response} onChange={v => onUpdate("management_response", v)} />
              <Field label="Action Plan" rows={2}
                placeholder="Steps management will take to remediate…"
                value={finding.action_plan} onChange={v => onUpdate("action_plan", v)} />
            </div>
            <div className="flex items-center gap-3">
              <div className="space-y-1 flex-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Target Date</label>
                <Input type="date" className="h-7 text-xs w-44"
                  value={finding.target_date || ""}
                  onChange={e => onUpdate("target_date", e.target.value)} />
              </div>
              <div className="space-y-1 flex-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Raised By</label>
                <Input className="h-7 text-xs" placeholder="Auditor name…"
                  value={finding.raised_by || ""}
                  onChange={e => onUpdate("raised_by", e.target.value)} />
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-1 border-t">
            <div className="flex items-center gap-2">
              {/* Status selector */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                    <StatusBadge status={finding.status} />
                    <ChevronDown size={10} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="text-xs">
                  {(Object.keys(STATUS_META) as FindingStatus[]).map(s => (
                    <DropdownMenuItem key={s} onClick={() => onUpdate("status", s)}
                      className={cn("gap-2", s === finding.status && "font-semibold")}>
                      <span className={cn(
                        "inline-block w-2 h-2 rounded-full border",
                        STATUS_META[s].bg, STATUS_META[s].border,
                      )} />
                      {STATUS_META[s].label}
                      {s === finding.status && " ✓"}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Advance status */}
              {finding.status !== "closed" && (
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-muted-foreground"
                  onClick={onAdvance}>
                  <ArrowRight size={10} />
                  {finding.status === "open"                 ? "→ Mgmt. Responded"
                   : finding.status === "management_responded" ? "→ Mark Reviewed"
                   : "→ Close"}
                </Button>
              )}
            </div>

            {/* Delete */}
            <div className="flex items-center gap-1">
              {confirmDel ? (
                <>
                  <Button size="sm" variant="destructive" className="h-6 text-[10px]"
                    onClick={onDelete}>Confirm Delete</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                    onClick={() => setConfirmDel(false)}>Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                  onClick={() => setConfirmDel(true)}>
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiChip({
  label, value, color, bg, border, active, onClick,
}: {
  label: string; value: number;
  color: string; bg: string; border: string;
  active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-2 text-left transition-all",
        active ? cn(bg, border) : "bg-background border-muted hover:bg-muted/30",
      )}
    >
      <p className={cn("text-xl font-bold leading-none", active ? color : "text-foreground")}>{value}</p>
      <p className={cn("text-[10px] mt-0.5", active ? color : "text-muted-foreground")}>{label}</p>
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FindingsTab({ data, engagementId, externalPrefill, onPrefillConsumed }: Props) {
  const {
    findings, addFinding, updateFinding, deleteFinding, advanceStatus,
    riskCounts, statusCounts, openCount, closedCount,
  } = useFindingsStorage(engagementId);

  // Consume externalPrefill from Anomaly Feed
  useEffect(() => {
    if (!externalPrefill) return;
    addFinding({
      category:    externalPrefill.category || "Other",
      title:       externalPrefill.ledger
        ? `Issue in ${externalPrefill.ledger}`
        : externalPrefill.category || "New Finding",
      observation: externalPrefill.observation || "",
    });
    onPrefillConsumed?.();
  }, [externalPrefill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull queries for the PDF report
  const { queries } = useQuerySheetStorage(engagementId, data.engagement?.firm_id);

  const [searchText,   setSearchText]   = useState("");
  const [riskFilter,   setRiskFilter]   = useState<FindingRisk | "all">("all");
  const [statusFilter, setStatusFilter] = useState<FindingStatus | "all">("all");
  const [exporting,    setExporting]    = useState(false);

  const displayed = useMemo(() => {
    let list = findings;
    if (riskFilter   !== "all") list = list.filter(f => f.risk_rating === riskFilter);
    if (statusFilter !== "all") list = list.filter(f => f.status      === statusFilter);
    if (searchText) {
      const s = searchText.toLowerCase();
      list = list.filter(f =>
        f.title?.toLowerCase().includes(s)       ||
        f.observation?.toLowerCase().includes(s) ||
        f.recommendation?.toLowerCase().includes(s) ||
        f.category?.toLowerCase().includes(s)    ||
        f.finding_no?.toLowerCase().includes(s),
      );
    }
    // Sort: critical first, then open before closed, then by finding_no
    return [...list].sort((a, b) => {
      const rA = (Object.keys(RISK_META) as FindingRisk[]).indexOf(a.risk_rating);
      const rB = (Object.keys(RISK_META) as FindingRisk[]).indexOf(b.risk_rating);
      if (rA !== rB) return rA - rB;
      const sA = a.status === "closed" ? 1 : 0;
      const sB = b.status === "closed" ? 1 : 0;
      if (sA !== sB) return sA - sB;
      return a.finding_no.localeCompare(b.finding_no);
    });
  }, [findings, riskFilter, statusFilter, searchText]);

  const handleExport = useCallback(async () => {
    if (findings.length === 0) { toast.info("No findings to include in the report."); return; }
    setExporting(true);
    try {
      await generateAuditReport(findings, queries, data);
      toast.success("Draft Audit Report generated.");
    } catch (err: any) {
      toast.error(err?.message || "PDF generation failed");
    } finally {
      setExporting(false);
    }
  }, [findings, queries, data]);

  const activeFilters = riskFilter !== "all" || statusFilter !== "all" || !!searchText;

  return (
    <div className="space-y-4">

      {/* ══════════ HEADER ══════════ */}
      <div className="bg-[#1a2744] text-white px-6 py-4 rounded-lg">
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldAlert size={17} />
          <span className="text-base font-semibold tracking-wide">{data.firmName || "Audit Firm"}</span>
        </div>
        <p className="text-[13px] font-bold opacity-95 tracking-widest uppercase mt-0.5">
          Audit Findings Register{data.clientName ? ` — ${data.clientName}` : ""}
        </p>
        <p className="text-[11px] opacity-70 mt-0.5">
          Formal observations, risks, recommendations, and management responses
        </p>
      </div>

      {/* ══════════ KPI SUMMARY ROW ══════════ */}
      <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
        <KpiChip label="Total"    value={findings.length} color="text-foreground"
          bg="bg-muted/20" border="border-muted-foreground/30"
          active={riskFilter === "all" && statusFilter === "all"}
          onClick={() => { setRiskFilter("all"); setStatusFilter("all"); }} />

        {(Object.keys(RISK_META) as FindingRisk[]).map(r => (
          <KpiChip key={r}
            label={RISK_META[r].label} value={riskCounts[r]}
            color={RISK_META[r].color} bg={RISK_META[r].bg} border={RISK_META[r].border}
            active={riskFilter === r}
            onClick={() => setRiskFilter(riskFilter === r ? "all" : r)} />
        ))}

        <KpiChip label="Open"   value={openCount}   color="text-orange-700" bg="bg-orange-50" border="border-orange-200"
          active={statusFilter === "open"}
          onClick={() => setStatusFilter(statusFilter === "open" ? "all" : "open")} />
        <KpiChip label="Closed" value={closedCount} color="text-green-700"  bg="bg-green-50"  border="border-green-200"
          active={statusFilter === "closed"}
          onClick={() => setStatusFilter(statusFilter === "closed" ? "all" : "closed")} />
      </div>

      {/* ══════════ TOOLBAR ══════════ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline"
            className="gap-1.5 h-8 text-xs border-[#1a2744] text-[#1a2744] hover:bg-[#1a2744]/5"
            onClick={() => { addFinding(); toast.success("New finding added."); }}>
            <Plus size={13} /> Add Finding
          </Button>

          {/* Status filter chips */}
          <div className="flex items-center gap-1">
            <Filter size={11} className="text-muted-foreground" />
            {(Object.keys(STATUS_META) as FindingStatus[]).map(s => (
              <button key={s} type="button"
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium border transition-colors",
                  statusFilter === s
                    ? cn(STATUS_META[s].bg, STATUS_META[s].color, STATUS_META[s].border)
                    : "text-muted-foreground border-transparent hover:bg-muted/40",
                )}>
                {STATUS_META[s].label}
              </button>
            ))}
          </div>

          {activeFilters && (
            <button type="button"
              onClick={() => { setRiskFilter("all"); setStatusFilter("all"); setSearchText(""); }}
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
              <X size={10} /> clear
            </button>
          )}

          {/* Search */}
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Search findings…"
              className="h-7 pl-6 pr-6 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-44" />
            {searchText && (
              <button type="button" onClick={() => setSearchText("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        <Button size="sm" variant="outline"
          className="gap-1.5 h-8 text-xs border-purple-600 text-purple-700 hover:bg-purple-50"
          onClick={handleExport} disabled={exporting || findings.length === 0}>
          {exporting
            ? <Loader2 size={12} className="animate-spin" />
            : <FileText size={12} />}
          Generate Draft Report
        </Button>
      </div>

      {/* ══════════ FINDINGS LIST ══════════ */}
      {findings.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-56 gap-3 text-muted-foreground border rounded-lg bg-muted/10">
          <ShieldAlert size={36} className="opacity-25" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">No findings recorded yet</p>
            <p className="text-xs mt-1 max-w-sm">
              Add formal audit observations here. Each finding captures observation, criteria, impact,
              root cause, recommendation, and management response.
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs mt-1"
            onClick={() => addFinding()}>
            <Plus size={12} /> Add First Finding
          </Button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground border rounded-lg bg-muted/10">
          No findings match the current filters.{" "}
          <button type="button" onClick={() => { setRiskFilter("all"); setStatusFilter("all"); setSearchText(""); }}
            className="text-primary underline text-xs">Clear filters</button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* All-resolved banner */}
          {closedCount === findings.length && findings.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700">
              <CheckCircle2 size={14} />
              <span className="text-sm font-medium">All {findings.length} findings are closed.</span>
            </div>
          )}
          {/* Critical banner */}
          {riskCounts.critical > 0 && statusCounts.open > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700">
              <AlertTriangle size={14} />
              <span className="text-sm font-medium">
                {riskCounts.critical} critical finding{riskCounts.critical > 1 ? "s" : ""} require{riskCounts.critical === 1 ? "s" : ""} immediate attention.
              </span>
            </div>
          )}
          {displayed.map((f, i) => (
            <FindingCard
              key={f.id}
              finding={f}
              index={findings.indexOf(f)}
              onUpdate={(field, value) => updateFinding(f.id, field, value)}
              onDelete={() => { deleteFinding(f.id); toast.success("Finding deleted."); }}
              onAdvance={() => { advanceStatus(f.id); }}
            />
          ))}
          {activeFilters && (
            <p className="text-[11px] text-muted-foreground text-center pt-1">
              Showing {displayed.length} of {findings.length} findings
            </p>
          )}
        </div>
      )}

      {/* ══════════ FOOTER SUMMARY ══════════ */}
      {findings.length > 0 && (
        <div className="border-t pt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            {openCount > 0
              ? `${openCount} open · ${closedCount} closed`
              : `All ${findings.length} findings closed`}
          </span>
          <span>
            {findings.filter(f => f.recommendation?.trim()).length} of {findings.length} with recommendation
          </span>
          <span>
            {findings.filter(f => f.management_response?.trim()).length} of {findings.length} with management response
          </span>
        </div>
      )}
    </div>
  );
}
