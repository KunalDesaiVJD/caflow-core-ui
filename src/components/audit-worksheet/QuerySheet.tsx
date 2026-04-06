/**
 * QuerySheet — Sheet 5 "QUERY SHEET"
 *
 * Query tracking with Correction Status gate (Req #6).
 *
 * Columns: SR NO | HEAD | Particulars | Query Description |
 *          Required Documents | Remark | Correction Status
 *
 * Gate rule: ALL queries must have Correction Status = "Yes" before
 * the engagement can progress to the next pipeline stage.
 * Zero queries = gate is open (no pending corrections).
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge }    from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Save, Loader2, MessageSquareWarning,
  Plus, Trash2, CheckCircle2, AlertCircle, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

import { useQuerySheetStorage } from "./hooks/useQuerySheetStorage";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
  /** Optional: called when user clicks "Proceed to Next Stage" and gate is open */
  onProceed?:   () => void;
}

// ─── Correction Status Select ─────────────────────────────────────────────────

function CorrectionSelect({
  value,
  onChange,
}: {
  value:    string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          "h-7 text-xs w-full min-w-[90px]",
          value === "Yes" && "border-green-400 text-green-700 bg-green-50",
          value === "No"  && "border-red-400   text-red-700   bg-red-50",
          value === ""    && "border-orange-300"
        )}
      >
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">— Pending —</SelectItem>
        <SelectItem value="Yes">✓ Yes</SelectItem>
        <SelectItem value="No">✗ No</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QuerySheet({ data, engagementId, onProceed }: Props) {
  const {
    queries, addQuery, updateQuery, deleteQuery,
    manualSave, saving, allCorrected, pendingCount,
  } = useQuerySheetStorage(engagementId, data.engagement?.firm_id);

  // Delete confirmation state: tracks which row is awaiting confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleProceed = () => {
    if (!allCorrected) return;
    if (onProceed) {
      onProceed();
    } else {
      toast.success("All queries resolved — ready to proceed to next stage");
    }
  };

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* ══════════ PAGE HEADER ══════════ */}
      <div className="bg-orange-600 text-white px-6 py-4 space-y-0.5">
        <div className="flex items-center gap-2">
          <MessageSquareWarning size={18} />
          <span className="text-base font-semibold tracking-wide">
            {data.firmName || "CA Firm"}
          </span>
        </div>
        <p className="text-[13px] font-bold opacity-95 tracking-widest uppercase">
          Query of Client
          {data.clientName ? ` — ${data.clientName}` : ""}
        </p>
      </div>

      {/* ══════════ CORRECTION STATUS GATE BANNER ══════════ */}
      <div
        className={cn(
          "px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b",
          allCorrected
            ? "bg-green-50 border-green-200"
            : "bg-red-50   border-red-200"
        )}
      >
        <div className="flex items-center gap-2.5">
          {allCorrected ? (
            <CheckCircle2 size={20} className="text-green-600 flex-shrink-0" />
          ) : (
            <AlertCircle  size={20} className="text-red-600   flex-shrink-0" />
          )}
          <div>
            {allCorrected ? (
              <p className="text-sm font-semibold text-green-800">
                All queries resolved — ready to proceed
              </p>
            ) : (
              <p className="text-sm font-semibold text-red-800">
                {pendingCount} of {queries.length}{" "}
                {queries.length === 1 ? "query" : "queries"} pending correction
                {" "}— resolve before proceeding
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {allCorrected
                ? queries.length === 0
                  ? "No queries raised — pipeline is unblocked."
                  : "Every query has Correction Status = Yes."
                : "Set Correction Status to Yes on every row to unblock the pipeline."
              }
            </p>
          </div>
        </div>

        {/* Proceed button — gated */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={-1}>
                <Button
                  size="sm"
                  className={cn(
                    "gap-1.5 h-8 text-xs",
                    allCorrected
                      ? "bg-green-600 hover:bg-green-700 text-white"
                      : "opacity-50 cursor-not-allowed"
                  )}
                  disabled={!allCorrected}
                  onClick={handleProceed}
                >
                  Proceed to Next Stage
                  <ArrowRight size={13} />
                </Button>
              </span>
            </TooltipTrigger>
            {!allCorrected && (
              <TooltipContent side="left" className="max-w-[240px] text-xs">
                All queries must have Correction Status = Yes before proceeding
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* ══════════ SUB-HEADER (Add + counts + Save) ══════════ */}
      <div className="border-b bg-muted/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
            onClick={() => { addQuery(); setConfirmDeleteId(null); }}
          >
            <Plus size={12} />
            Add New Query
          </Button>
          <span className="text-xs text-muted-foreground">
            {queries.length === 0
              ? "No queries yet"
              : `${queries.length} ${queries.length === 1 ? "query" : "queries"}`}
          </span>
          {queries.length > 0 && (
            <>
              <Badge className="bg-green-100 text-green-700 text-[10px]">
                {queries.filter(q => q.correction_status === "Yes").length} corrected
              </Badge>
              {pendingCount > 0 && (
                <Badge className="bg-red-100 text-red-700 text-[10px]">
                  {pendingCount} pending
                </Badge>
              )}
            </>
          )}
        </div>
        <Button
          size="sm"
          className="gap-1 h-7 text-xs bg-orange-600 hover:bg-orange-700"
          onClick={manualSave}
          disabled={saving}
        >
          {saving
            ? <Loader2 size={12} className="animate-spin" />
            : <Save    size={12} />
          }
          Save
        </Button>
      </div>

      {/* ══════════ TABLE ══════════ */}
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[920px]">
          <thead>
            <tr className="bg-orange-600 text-white text-[11px] uppercase tracking-wide">
              <th className="border border-orange-500 px-2 py-2.5 text-center w-12">Sr.</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[110px]">Head</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[140px]">Particulars</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[190px]">Query Description</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[150px]">Required Documents</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[130px]">Remark</th>
              <th className="border border-orange-500 px-2 py-2.5 text-center min-w-[120px]">Correction Status</th>
              <th className="border border-orange-500 px-2 py-2.5 text-center w-16">Del</th>
            </tr>
          </thead>
          <tbody>
            {queries.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="border border-border py-12 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <MessageSquareWarning size={28} className="text-muted-foreground/40" />
                    <span className="text-sm">No queries yet.</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 h-7 text-xs"
                      onClick={addQuery}
                    >
                      <Plus size={12} /> Add First Query
                    </Button>
                  </div>
                </td>
              </tr>
            ) : (
              queries.map((row, idx) => {
                const isDone = row.correction_status === "Yes";

                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "align-top transition-colors",
                      isDone
                        ? "bg-green-50/70 hover:bg-green-50"
                        : "bg-red-50/60   hover:bg-red-50"
                    )}
                  >
                    {/* Sr No */}
                    <td className="border border-border px-2 py-2 text-center align-middle">
                      <span className="text-xs font-mono text-muted-foreground">
                        {idx + 1}
                      </span>
                    </td>

                    {/* Head */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input
                        className="h-7 text-xs w-full"
                        placeholder="Head…"
                        value={row.head}
                        onChange={e => updateQuery(row.id, "head", e.target.value)}
                      />
                    </td>

                    {/* Particulars */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input
                        className="h-7 text-xs w-full"
                        placeholder="Particulars…"
                        value={row.particulars}
                        onChange={e => updateQuery(row.id, "particulars", e.target.value)}
                      />
                    </td>

                    {/* Query Description — textarea for longer text */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Textarea
                        rows={2}
                        className="text-xs resize-none w-full min-h-[52px]"
                        placeholder="Describe the query…"
                        value={row.query_description}
                        onChange={e => updateQuery(row.id, "query_description", e.target.value)}
                      />
                    </td>

                    {/* Required Documents */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input
                        className="h-7 text-xs w-full"
                        placeholder="Documents needed…"
                        value={row.required_documents}
                        onChange={e => updateQuery(row.id, "required_documents", e.target.value)}
                      />
                    </td>

                    {/* Remark */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input
                        className="h-7 text-xs w-full"
                        placeholder="Remark…"
                        value={row.remark}
                        onChange={e => updateQuery(row.id, "remark", e.target.value)}
                      />
                    </td>

                    {/* Correction Status */}
                    <td className="border border-border px-2 py-2 align-middle">
                      <CorrectionSelect
                        value={row.correction_status}
                        onChange={v => updateQuery(row.id, "correction_status", v)}
                      />
                      <p className={cn(
                        "text-[10px] mt-0.5 font-medium text-center",
                        isDone                           && "text-green-700",
                        row.correction_status === "No"  && "text-red-700",
                        row.correction_status === ""    && "text-orange-600"
                      )}>
                        {isDone                           ? "✓ Corrected"
                          : row.correction_status === "No"  ? "✗ Not corrected"
                          : "⏳ Pending"}
                      </p>
                    </td>

                    {/* Delete */}
                    <td className="border border-border px-2 py-2 align-middle text-center">
                      {confirmDeleteId === row.id ? (
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 text-[10px] px-1 w-full"
                            onClick={() => {
                              deleteQuery(row.id);
                              setConfirmDeleteId(null);
                            }}
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] px-1 w-full"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                          onClick={() => setConfirmDeleteId(row.id)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ══════════ FOOTER ══════════ */}
      <div className="border-t bg-muted/20 px-4 py-2 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {allCorrected
            ? queries.length === 0
              ? "No queries — pipeline unblocked"
              : `✓ All ${queries.length} ${queries.length === 1 ? "query" : "queries"} corrected`
            : `${pendingCount} of ${queries.length} pending correction`
          }
        </p>
        {saving && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> Auto-saving…
          </p>
        )}
      </div>
    </div>
  );
}
