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

import { useState, useEffect, type CSSProperties } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, FileText, Building2 } from "lucide-react";
import { NCECapitalAccount } from "@/components/stage8/NCECapitalAccount";
import { NCEDetailedNotes }  from "@/components/stage8/NCEDetailedNotes";
import { NCEPPESchedule }    from "@/components/stage8/NCEPPESchedule";

// ─── Note 1 preview — Summary of Significant Accounting Policies ──────────────
// Mirrors the DOCX export's Note 1 page (src/lib/nceFinancialsDocx.ts →
// buildNote1Section + defaultNceNote1Template) so the on-screen Preview matches
// what the exported Word/PDF shows. Read-only; the editor surface lives in
// stage7/NotesToAccounts.tsx.

interface Nta1Sig {
  firmName?:      string;
  firmFRN?:       string;
  partnerName?:   string;
  membershipNo?:  string;
  clientName?:    string;
  place?:         string;
  date?:          string;
}

interface Note1RowData {
  id: string; label: string; title: string; selected: boolean; text: string;
}

function defaultNceNote1Template(auditYear: string): Note1RowData[] {
  return [
    { id: "note-1", label: "Note 1", title: "Balance Confirmation", selected: true,
      text: "All debit and credit balances and accounts squared up during the year are subject to confirmation from respective parties." },
    { id: "note-2", label: "Note 2", title: "Rearrangement of Figures", selected: true,
      text: "The figures are rearranged/regrouped wherever considered necessary and rounded off to the nearest rupee." },
    { id: "note-3", label: "Note 3", title: "Cash Balance & Closing Stock", selected: true,
      text: `Cash balance on hand was Rs. [CASH_AMOUNT]/- and value of Closing Stock Rs. [CLOSING_STOCK]/- as at 31st March, ${auditYear} are taken as certified by proprietor.` },
    { id: "note-4", label: "Note 4", title: "Current Assets Valuation", selected: true,
      text: "In opinion of assessee, current assets, loans & advances are approximately of the value at which these are stated in the balance sheet." },
    { id: "note-5", label: "Note 5", title: "Fixed Assets", selected: true,
      text: "Fixed Assets are stated at Cost less depreciation as shown in Note- [FA_NOTE]. Details of rate and amount of Depreciation claimed has been stated in Note-[DEP_NOTE]." },
    { id: "note-6", label: "Note 6", title: "Reliance on Vouchers", selected: true,
      text: "Whenever the supporting proof for the entries made in the books of accounts are not available for the purpose of audit, we are relied on the vouchers prepared and authenticated by the partner." },
    { id: "note-7", label: "Note 7", title: "Loans via Cheque/DD/ECS", selected: true,
      text: "As informed by the partner, the amount of loan or deposits or specified sums taken or accepted or repaid by the assessee through a/c. payee cheque/demand draft or ECS only. However, it is not possible for us to verify the same as necessary evidence are not in possession of the assessee." },
    { id: "note-8", label: "Note 8", title: "Notes form Part of Accounts", selected: true,
      text: `Notes No. 1 to [LAST_NOTE] forms part of accounts for the year ended on 31st March, ${auditYear}.` },
  ];
}

function fmtSigDate(d?: string): string {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

function Note1PreviewSection({
  entityName, cyYear, ntaData, sig,
}: {
  entityName: string;
  cyYear?: string;
  ntaData?: any | null;
  sig?: Nta1Sig | null;
}) {
  const NAVY  = "#1F3864";
  const FONT  = "Calibri, Arial, sans-serif";
  const yearStr = String(cyYear || "").slice(-4) || "20XX";

  const saved: any[] = Array.isArray(ntaData?.notes_json) ? ntaData.notes_json : [];
  const template     = defaultNceNote1Template(yearStr);
  const templateMap  = new Map(template.map(t => [t.id, t]));

  const merged: Note1RowData[] = saved.length === 0
    ? template
    : saved.map((r: any) => {
        const tmpl = templateMap.get(r.id);
        if (tmpl) {
          return {
            ...tmpl,
            selected: r.selected ?? tmpl.selected,
            text:     r.text     ?? tmpl.text,
            title:    r.title    ?? tmpl.title,
          };
        }
        return {
          id:       String(r.id ?? ""),
          label:    String(r.label ?? r.title ?? ""),
          title:    String(r.title ?? ""),
          selected: r.selected ?? true,
          text:     String(r.text  ?? ""),
        };
      });

  const header           = (ntaData?.header_overrides || {}) as Record<string, any>;
  const note1NewEntityOn = !!ntaData?.note1_new_entity_enabled
                        && String(ntaData?.note1_new_entity_text || "").trim().length > 0;
  const note1NewEntityTx = String(ntaData?.note1_new_entity_text || "").trim();
  const note3Variant     = String(ntaData?.note3_variant || "none");
  const note3VariantTxt  = String(header?.note3VariantText || ntaData?.note3_variant_text || "").trim();

  const selectedNotes = merged.filter(n => n.selected !== false);
  const lastNoteNum   = String(header.lastNoteOverride || selectedNotes.length);

  const resolveTokens = (text: string): string =>
    (text || "")
      .replace(/\[CASH_AMOUNT\]/g,   String(header.cashAmount   || ""))
      .replace(/\[CLOSING_STOCK\]/g, String(header.closingStock || ""))
      .replace(/\[FA_NOTE\]/g,       String(header.faNoteNum    || ""))
      .replace(/\[DEP_NOTE\]/g,      String(header.depNoteNum   || ""))
      .replace(/\[LAST_NOTE\]/g,     lastNoteNum);

  const displayEntity = (header.entityNameOverride || entityName || "").trim();
  const assesseeName  = (sig?.clientName || displayEntity || "").trim();
  const firmName      = sig?.firmName      || "_______________";
  const firmFRN       = sig?.firmFRN       || "_______________";
  const partnerName   = sig?.partnerName   || "_______________";
  const partnerMembNo = sig?.membershipNo  || "_______________";
  const placeText     = sig?.place         || "_______________";
  const dateText      = fmtSigDate(sig?.date);

  return (
    <div style={{ fontFamily: FONT, color: "#000" }} className="space-y-3">
      {/* Entity-name banner — 14pt bold NAVY, thick NAVY rules top + bottom */}
      <div
        style={{
          textAlign:       "center",
          fontSize:        14,
          fontWeight:      700,
          color:           NAVY,
          textTransform:   "uppercase",
          letterSpacing:   "0.04em",
          padding:         "4px 0",
          borderTop:       `2px solid ${NAVY}`,
          borderBottom:    `2px solid ${NAVY}`,
        }}
      >
        {displayEntity}
      </div>

      {/* Subtitle banner removed (2026-06-20) — matches the Word export
          which now drops "Notes forming part of the Financial Statements
          for the year ended, …" so the entity banner sits directly above
          the "Note 1 — Summary…" heading. */}

      {/* "Note 1 — …" heading — left-aligned NAVY, thin rule below */}
      <div
        style={{
          fontSize:     10,
          fontWeight:   700,
          color:        NAVY,
          paddingBottom:"3px",
          borderBottom: `1px solid ${NAVY}`,
        }}
      >
        Note 1 — NOTES FORMING PART OF ACCOUNTS FOR THE YEAR ENDED 31.03.{yearStr}
      </div>

      {/* Numbered policies — 2-col table, no borders */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <tbody>
          {selectedNotes.map((n, i) => {
            const num = i + 1;
            let body = resolveTokens(n.text || "");
            if (n.id === "note-1" && note1NewEntityOn) {
              body += "\n\n" + resolveTokens(note1NewEntityTx);
            }
            if (n.id === "note-3" && note3Variant !== "none" && note3VariantTxt) {
              body += "\n\n" + resolveTokens(note3VariantTxt);
            }
            const segments = body.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
            return (
              <tr key={n.id}>
                <td
                  style={{
                    width:        "28px",
                    verticalAlign:"top",
                    textAlign:    "center",
                    padding:      "4px 6px",
                  }}
                >
                  {num}
                </td>
                <td style={{ verticalAlign: "top", padding: "4px 6px", lineHeight: 1.35 }}>
                  {segments.length === 0
                    ? <span>&nbsp;</span>
                    : segments.map((seg, idx) => (
                        <div key={idx} style={{ marginBottom: idx === segments.length - 1 ? 0 : 4 }}>
                          {seg}
                        </div>
                      ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Signature block — assessee left / firm right */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginTop: "10px" }}>
        <tbody>
          <tr>
            {/* Layout matches the auditor's revised Note 1 page:
                firm block (left, BLACK text, colons in FRN /
                Membership No.) starts in line with Note text column;
                assessee block (right-aligned, BLACK text) ends at the
                same right edge as the policy body text. */}
            <td style={{ verticalAlign: "top", width: "50%", padding: "0 6px 0 34px" }}>
              <div style={{ fontWeight: 700 }}>For {firmName}</div>
              <div style={{ fontWeight: 700 }}>Chartered Accountants</div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>FRN: {firmFRN}</div>
              <div style={{ fontWeight: 700 }}>{partnerName}</div>
              <div style={{ fontWeight: 700 }}>Partner</div>
              <div style={{ fontWeight: 700 }}>Membership No.: {partnerMembNo}</div>
            </td>
            {/* Right cell — assessee block, LEFT-aligned (auditor's
                attached screenshot, 2026-06-20). The 50% cell already
                starts at the page midpoint; default left-alignment
                puts the content there. */}
            <td style={{ verticalAlign: "top", width: "50%", padding: "0 6px 0 6px" }}>
              <div style={{ fontWeight: 700 }}>For, {assesseeName}</div>
              <div style={{ fontWeight: 700 }}>x__________________</div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Signature of assessee</div>
              <div style={{ fontWeight: 700 }}>Place: {placeText}</div>
              <div style={{ fontWeight: 700 }}>Date : {dateText}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId:   string;
  navigateToNote?: number | null;
  /** Bumped on every "Note No." click (even re-clicks of the same note) so
   *  NCEDetailedNotes' force-open + scroll effect re-fires even though
   *  navigateToNote's value didn't change. */
  navigateToken?: number;
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
  /** Bug 1: initial expand/collapse state for the notes preview.  When present,
   *  PatternBTable rows that were expanded in the editor will also be expanded
   *  in the preview instead of defaulting to collapsed. */
  initialExpandedRows?: Set<string>;
  /** Stage 7 "Notes to Accounts" row from notes_to_accounts_data.
   *  When provided in readOnly mode, the Note 1 (Summary of Significant
   *  Accounting Policies) page is rendered at the top of the preview so the
   *  on-screen view matches the DOCX export. */
  ntaData?: any | null;
  /** Signature block fields used by the Note 1 preview footer. */
  sig?: {
    firmName?:     string;
    firmFRN?:      string;
    partnerName?:  string;
    membershipNo?: string;
    clientName?:   string;
    place?:        string;
    date?:         string;
  } | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NCENotesTab({ engagementId, navigateToNote, navigateToken, dynamicNoteMap, onExpansionStateUpdate, readOnly = false, entityName, cyYear, initialExpandedRows, ntaData, sig }: Props) {
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
      // All other notes → Notes to Accounts tab. The actual force-open +
      // scroll is handled INSIDE NCEDetailedNotes (via the scrollToNoteNo
      // prop below) — it owns the openNotes/loading state, so it can gate on
      // its own data actually being ready instead of a fixed timer racing an
      // unrelated load (2026-08-06 fix: a fixed 250ms delay here fired before
      // the note cards existed in the DOM on any engagement whose self-heal
      // rebuild took longer than that, e.g. large trial balances — the click
      // appeared to do nothing).
      setActiveSubTab("notes_to_accounts");
    }
  }, [navigateToNote, navigateToken]);

  // In readOnly mode the on-screen Preview should mimic the DOCX export's
  // per-page layout: each "page" is a NAVY-bordered A4-style frame, and the
  // legacy NCENotesTab entity banner is suppressed (Note 1 already carries
  // its own entity banner — having both would duplicate the title).
  const showLegacyBanner = !readOnly && !!entityName;
  const pageFrame: CSSProperties = {
    border:       "1px solid #1F3864",
    background:   "#fff",
    padding:      "20px 28px",
    fontFamily:   "Calibri, Arial, sans-serif",
    pageBreakAfter: "always",
  };

  return (
    <div className="space-y-3">

      {/* Entity-name banner (2026-05-30) — matches BS / P&L title block format
          so the client name is presented identically on every preview page.
          Suppressed in readOnly mode because each "page" in the preview
          carries its own banner inline (matching the DOCX export). */}
      {showLegacyBanner && (
        <div className="overflow-hidden" style={{ fontFamily: "Calibri, Arial, sans-serif" }}>
          <div className="text-center py-1.5">
            <div className="font-bold uppercase tracking-wide text-[#1F3864]" style={{ fontSize: "14px" }}>
              {entityName}
            </div>
            <div style={{ fontSize: "11px" }} className="mt-0.5 font-bold text-[#1F3864]">
              NOTES TO FINANCIAL STATEMENTS{cyYear ? ` FOR THE YEAR ENDED 31ST MARCH, ${cyYear}` : ""}
            </div>
            <div className="text-right text-[#505050] italic mt-0.5 pr-1" style={{ fontSize: "8px" }}>
              Amounts in ₹
            </div>
          </div>
          <div className="border-b-2 border-[#1F3864]" />
        </div>
      )}

      {/* Header — typography aligned with Stage 7's other section labels.
          Suppressed when the banner above is rendering, so we don't show two
          competing titles on the same page. */}
      {!readOnly && !entityName && (
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Notes to Financial Statements
        </h2>
      )}

      {/* In read-only / preview mode: render all three sections continuously
          (Capital Account → Notes → PPE Schedule) to match the DOCX export
          exactly. In edit mode: keep the sub-tabs so the user can navigate
          between the three sections without a huge scroll. */}
      {readOnly ? (
        <div className="space-y-6">
          {/* Page 1 — Note 1 (Summary of Significant Accounting Policies).
              Bordered "page frame" matches the NAVY page borders the DOCX
              draws around every page. */}
          <div style={pageFrame}>
            <Note1PreviewSection
              entityName={entityName || ""}
              cyYear={cyYear}
              ntaData={ntaData}
              sig={sig}
            />
          </div>
          {/* Page 2+ — Structured notes (BS Capital Account, detailed notes,
              PPE schedule). Wrapped in a single NAVY-bordered page frame so
              it visually separates from the Note 1 page above. */}
          <div style={pageFrame}>
            {/* 2026-06-30 — COA-lock folded INTO NCECapitalAccount; the separate
                constrained NCECapitalNote (orphaned table writing nce_capital_note,
                which the face/DOCX never read) was removed to end the duplicate. */}
            <NCECapitalAccount engagementId={engagementId} readOnly={readOnly} />
            <NCEDetailedNotes engagementId={engagementId} dynamicNoteMap={dynamicNoteMap} onExpansionStateUpdate={onExpansionStateUpdate} readOnly={readOnly} initialExpandedRows={initialExpandedRows} />
            <NCEPPESchedule engagementId={engagementId} readOnly={readOnly} />
          </div>
        </div>
      ) : (
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
            {/* Bug 1 fix: do NOT pass initialExpandedRows in edit mode — it changes
                on every expansion update and would re-render NCEDetailedNotes on
                every keystroke, causing a stale-effect loop (PatternBTable effects
                re-fire → setNceExpandedRows → re-render → repeat). */}
            <NCEDetailedNotes engagementId={engagementId} dynamicNoteMap={dynamicNoteMap} onExpansionStateUpdate={onExpansionStateUpdate} readOnly={readOnly} scrollToNoteNo={navigateToNote} scrollToken={navigateToken} />
          </TabsContent>

          <TabsContent value="ppe_schedule" className="mt-3">
            <NCEPPESchedule engagementId={engagementId} readOnly={readOnly} />
          </TabsContent>
        </Tabs>
      )}

    </div>
  );
}
