/**
 * NotesMismatchPanel — Phase B: Notes vs BS/PL mismatch indicator
 *
 * Renders an amber-bordered alert card listing every note whose breakup
 * sub-rows do not sum to the note's own headline total (which is what
 * appears on the face of the Balance Sheet / P&L).
 *
 * Visible only when mismatches exist.  Each row has a "→" button that
 * switches the parent to the Notes tab and scrolls to the note section.
 *
 * Data flow:
 *   1. Loads stage5_notes from audit_engagements via React Query.
 *   2. Calls useDynamicNoteRegistry(engagementId) for dynamic note numbers.
 *   3. Runs detectMismatches() and reports the count via onCountChange.
 */

import { useMemo, useEffect } from "react";
import { useQuery }           from "@tanstack/react-query";
import { supabase }           from "@/integrations/supabase/client";
import { useDynamicNoteRegistry } from "@/lib/noteNumberRegistry";
import { detectMismatches, type NoteMismatch } from "@/lib/notesMismatch";
import { isCompanyEntity } from "@/utils/entityUtils";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId:  string;
  entityType?:   string;            // from engagement.entity_type
  /** Called whenever the mismatch count changes — drives the KPI card. */
  onCountChange: (count: number) => void;
  /** Called with the full mismatch list — parent uses it to gate Save on
   *  specific note keys (R&S + Trade Receivables). Optional. */
  onMismatchList?: (list: NoteMismatch[]) => void;
  /** Called when the user clicks a note row's navigate button. */
  onNavigate:    (noteNo: number, subTab: "bs_liab" | "bs_asset" | "pl" | "fa") => void;
  /**
   * 2026-08-01 — Face-side total tax (Current + Deferred) piped from
   * PipelineFinancialStatements (same value NoteBSLiab uses). Detector
   * subtracts it from computeFaceNpat's output so Reserves & Surplus
   * sub-rows sum lands on NPAT not PBT even when the stage5_notes
   * JSONB hasn't yet been re-autoPopulated with the tax stash. Without
   * this, on any client whose notes predate commit e1b491b2 the
   * banner shows a Δ = tax component (e.g. Mill Power's ₹37,200).
   */
  faceTaxCy?:    number;
  faceTaxPy?:    number;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function NotesMismatchPanel({
  engagementId,
  entityType,
  onCountChange,
  onMismatchList,
  onNavigate,
  faceTaxCy = 0,
  faceTaxPy = 0,
}: Props) {
  // ── Determine entity type ──────────────────────────────────────────────────
  const isNce = !isCompanyEntity(entityType ?? "");

  // ── Load stage5_notes ──────────────────────────────────────────────────────
  const { data: notesData, isLoading: notesLoading } = useQuery<Stage5Notes | null>({
    queryKey: ["stage5-notes-mismatch", engagementId],
    queryFn:  async () => {
      const { data } = await (supabase.from as any)("audit_engagements")
        .select("stage5_notes")
        .eq("id", engagementId)
        .maybeSingle();
      return (data as any)?.stage5_notes as Stage5Notes ?? null;
    },
    staleTime: 30_000,
    enabled:   Boolean(engagementId),
  });

  // ── Dynamic note registry (COA-signal only — no computedAmounts needed) ───
  const { registry } = useDynamicNoteRegistry(engagementId);

  // ── Detect mismatches ──────────────────────────────────────────────────────
  const mismatches: NoteMismatch[] = useMemo(
    () => detectMismatches(null, null, notesData ?? null, registry, isNce, { cy: faceTaxCy, py: faceTaxPy }),
    [notesData, registry, isNce, faceTaxCy, faceTaxPy],
  );

  // Report count to parent (KPI card)
  useEffect(() => {
    if (!notesLoading) onCountChange(mismatches.length);
  }, [mismatches.length, notesLoading, onCountChange]);

  // Report the full list to parent (used to gate Save on R&S + Trade Receivables)
  useEffect(() => {
    if (!notesLoading) onMismatchList?.(mismatches);
  }, [mismatches, notesLoading, onMismatchList]);

  // Nothing to show while loading or when all notes are reconciled
  if (notesLoading || mismatches.length === 0) return null;

  return (
    <div
      style={{
        border:         "1px solid #AF8000",
        background:     "#FFF8E7",
        color:          "#8B6000",
        padding:        "12px 16px",
        borderRadius:   "8px",
        marginBottom:   "12px",
      }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        style={{
          fontWeight:    700,
          fontSize:      "13px",
          marginBottom:  "8px",
          display:       "flex",
          alignItems:    "center",
          gap:           "6px",
        }}
      >
        <span style={{ fontSize: "15px" }}>⚠</span>
        <span>
          {mismatches.length} note{mismatches.length > 1 ? "s" : ""} mismatch
          {mismatches.length > 1 ? "" : "es"} their BS / P&amp;L headline total
        </span>
      </div>

      {/* ── Mismatch rows ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {mismatches.map(m => (
          <div
            key={m.noteNo}
            style={{
              display:         "flex",
              alignItems:      "center",
              justifyContent:  "space-between",
              background:      "#FFFBF0",
              border:          "1px solid #D4A800",
              borderRadius:    "5px",
              padding:         "6px 10px",
              gap:             "8px",
            }}
          >
            {/* Note label */}
            <span style={{ fontWeight: 600, fontSize: "12px", minWidth: "160px" }}>
              Note {m.noteNo} — {m.label}
            </span>

            {/* Amounts */}
            <span style={{ fontSize: "11px", color: "#7A5200", flexGrow: 1 }}>
              Note total: {fmt(m.bsAmount)}&nbsp;&nbsp;|&nbsp;&nbsp;
              Sub-rows sum: {fmt(m.notesSum)}&nbsp;&nbsp;|&nbsp;&nbsp;
              Difference:&nbsp;
              <span style={{ color: "#C0392B", fontWeight: 700 }}>
                {fmt(Math.abs(m.difference))}
              </span>
            </span>

            {/* Navigate button */}
            <button
              onClick={() => onNavigate(m.noteNo, m.subTabKey)}
              style={{
                background:   "#AF8000",
                color:        "#FFFFFF",
                border:       "none",
                borderRadius: "4px",
                padding:      "3px 10px",
                fontSize:     "12px",
                cursor:       "pointer",
                fontWeight:   600,
                whiteSpace:   "nowrap",
              }}
              title={`Go to Note ${m.noteNo}`}
            >
              Fix →
            </button>
          </div>
        ))}
      </div>

      {/* ── Footer hint ───────────────────────────────────────────────────── */}
      <div style={{ fontSize: "11px", marginTop: "8px", color: "#9B6E00" }}>
        Click <strong>Fix →</strong> to jump to the note and reconcile the sub-rows.
        After editing, the panel disappears when all notes reconcile.
      </div>
    </div>
  );
}
