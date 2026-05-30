/**
 * NCENotesTab — "Notes to Financial Statements" for non-corporate entities.
 *
 * Rendered inside Stage 7 Financial Statements when the engagement entity
 * type is non-corporate (Partnership, LLP, Proprietorship, HUF, Trust, …).
 *
 * Three sub-tabs reuse the Stage 8 components verbatim — same data source,
 * same Supabase tables, no duplication. Edits made here are reflected in
 * Stage 8 and vice versa.
 *
 * Styling matches UI-6 corporate sub-tabs (gap-1.5, size-14 icons) so the
 * NCE and corporate Notes panels feel like the same surface.
 *
 * Props
 *   engagementId — passed straight through to each sub-component.
 */

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, FileText, Building2 } from "lucide-react";
import { NCECapitalAccount } from "@/components/stage8/NCECapitalAccount";
import { NCEDetailedNotes }  from "@/components/stage8/NCEDetailedNotes";
import { NCEPPESchedule }    from "@/components/stage8/NCEPPESchedule";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId:   string;
  navigateToNote?: number | null;
  /** Dynamic note number map from PipelineFinancialStatements.
   *  Maps originalNoteRef → dynamicSequentialNoteNo so the Notes tab headings
   *  stay in sync with the note numbers shown in the BS/PL columns. */
  dynamicNoteMap?: Map<number, number>;
  /** Task 8: Lock Preview — pass-through to NCEDetailedNotes */
  onExpansionStateUpdate?: (state: Record<string, Set<string>>) => void;
  /** Task 1 (doc6): when true, the entire notes panel is read-only (locked preview mode) */
  readOnly?: boolean;
  /** 2026-05-30 — Entity / client name shown as a header banner at the top of
   *  the Notes page, matching the bold navy uppercase format used on the
   *  Balance Sheet and Profit & Loss pages. Optional — when absent, the
   *  banner is suppressed (preserves existing behaviour in Stage 8 where
   *  the Notes tab is embedded in a different surface). */
  entityName?: string;
  cyYear?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NCENotesTab({ engagementId, navigateToNote, dynamicNoteMap, onExpansionStateUpdate, readOnly = false, entityName, cyYear }: Props) {
  const [activeSubTab, setActiveSubTab] = useState("capital_account");

  useEffect(() => {
    if (navigateToNote != null) {
      // Static ref 2 = Owners' Capital Account → Capital Account tab
      if (navigateToNote === 2) {
        setActiveSubTab("capital_account");
        return;
      }
      // Static ref 10 = PPE / Property, Plant & Equipment → PPE Schedule tab
      if (navigateToNote === 10) {
        setActiveSubTab("ppe_schedule");
        return;
      }
      // All other notes → Notes to Accounts tab + scroll to note
      setActiveSubTab("notes_to_accounts");
      // IDs use the dynamic number (from dynamicNoteMap); fall back to static ref.
      const timer = setTimeout(() => {
        const dynamicNo = dynamicNoteMap?.get(navigateToNote);
        const el =
          (dynamicNo != null
            ? document.getElementById(`nce-note-${dynamicNo}`)
            : null) ??
          document.getElementById(`nce-note-${navigateToNote}`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [navigateToNote, dynamicNoteMap]);

  return (
    <div className="space-y-3">

      {/* Entity-name banner (2026-05-30) — matches BS / P&L title block format
          so the client name is presented identically on every preview page. */}
      {entityName && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="text-center border-b bg-muted/30 py-2 px-3">
            <div className="font-bold text-sm uppercase tracking-wide text-[#1F3864]">
              {entityName}
            </div>
            <div className="text-xs mt-0.5">
              Notes to Financial Statements{cyYear ? ` for the year ended 31st March, ${cyYear}` : ""}
            </div>
            <div className="text-[10px] text-muted-foreground italic mt-0.5">
              (Amount in ₹)
            </div>
          </div>
        </div>
      )}

      {/* Header — typography aligned with Stage 7's other section labels.
          Suppressed when the banner above is rendering, so we don't show two
          competing titles on the same page. */}
      {!entityName && (
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Notes to Financial Statements
        </h2>
      )}

      {/* Sub-tabs */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="capital_account" className="gap-1.5">
            <Wallet size={14} /> Capital Account
          </TabsTrigger>
          <TabsTrigger value="notes_to_accounts" className="gap-1.5">
            <FileText size={14} /> Notes to Accounts
          </TabsTrigger>
          <TabsTrigger value="ppe_schedule" className="gap-1.5">
            <Building2 size={14} /> PPE Schedule
          </TabsTrigger>
        </TabsList>

        <TabsContent value="capital_account" className="mt-3">
          <NCECapitalAccount engagementId={engagementId} readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="notes_to_accounts" className="mt-3">
          <NCEDetailedNotes engagementId={engagementId} dynamicNoteMap={dynamicNoteMap} onExpansionStateUpdate={onExpansionStateUpdate} readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="ppe_schedule" className="mt-3">
          <NCEPPESchedule engagementId={engagementId} readOnly={readOnly} />
        </TabsContent>
      </Tabs>

    </div>
  );
}
