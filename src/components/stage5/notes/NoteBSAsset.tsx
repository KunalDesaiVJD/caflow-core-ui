/**
 * NoteBSAsset — Notes 15–24 (BS Assets side).
 * Notes 13 (PP&E) and 14 (CWIP) are rendered by FAGrid in the FA sub-tab —
 * here we start at Note 15 (Non-current Investments), matching SCHEDULE_III_DIV_I.
 */

import {
  EditableRow, NoteCard, NoteHeaderRow, ListTable, AgeingTable,
  type ListRow, type AgeingMatrix,
} from "./EditableCell";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";
import { useDynamicNoteRegistry } from "@/lib/noteNumberRegistry";
import { CORP_SIGNED_NOTE_TOTALS } from "@/lib/nceFeatureFlags";

interface Props {
  notes:           Stage5Notes;
  cyYear:          number;
  pyYear:          number;
  updatePath:      (path: string, value: any) => void;
  resetPath:       (path: string) => void;
  isOverridden:    (path: string) => boolean;
  engagementId:    string;
  collapseControl?: boolean;
  onRemapLedger?:  (ledgerName: string, newCode: string) => void;
  /** Issue 4 (Aesha) — clears this ledger from coa_mapping (DB) and re-syncs. */
  onUnmapLedger?:  (ledgerName: string) => void;
}

export default function NoteBSAsset({
  engagementId, notes, cyYear, pyYear, updatePath, resetPath, isOverridden, collapseControl, onRemapLedger, onUnmapLedger,
}: Props) {
  const get = (path: string) => path.split(".").reduce<any>((c, k) => c?.[k], notes);

  // Prefer breakup sum over stored headline so the Note "Total per BS"
  // always matches the BS face (which uses ncyOf → breakup sum).
  const sumBreakup = (key: string, col: "amount_cy"|"amount_py", breakupPath?: string): { sum: number; hasAny: boolean } => {
    const arr = (breakupPath ? get(breakupPath) : (notes.bs_asset[key] as any)?.breakup);
    if (!Array.isArray(arr)) return { sum: 0, hasAny: false };
    const populated = arr.filter((r: any) => r != null && r[col] != null && r[col] !== "");
    if (populated.length === 0) return { sum: 0, hasAny: false };
    const sum = populated.reduce((s: number, r: any) => {
      const n = Number(r[col]);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    return { sum, hasAny: true };
  };

  /** Sign convention for bs_asset notes — assets are stored without the
   *  sectionSign flip, so a normal DR-balance asset lands as POSITIVE in
   *  storage and an abnormal CR-balance asset (e.g. bank overdraft)
   *  lands as NEGATIVE.  Display rule (matches BS face):
   *    • Stored ≥ 0   →  DR balance (normal asset)   →  POSITIVE
   *    • Stored < 0   →  CR balance (abnormal)       →  NEGATIVE
   *  When the breakup is populated, magnitude is its always-positive sum
   *  and the sign is taken from the stored value. */
  const signedTotal = (storedRaw: number, magnitude: number): number =>
    storedRaw < 0 ? -magnitude : magnitude;

  const cy = (key: string) => {
    const stored = Number(notes.bs_asset[key]?.cy ?? 0);
    const { sum, hasAny } = sumBreakup(key, "amount_cy");
    const magnitude = hasAny ? sum : Math.abs(stored);
    // BUG 1 (sign): when ON, a populated breakup already nets contras (sum is
    // signed) — return it directly so a net-abnormal balance keeps its sign.
    return CORP_SIGNED_NOTE_TOTALS && hasAny ? sum : signedTotal(stored, magnitude);
  };
  const py = (key: string) => {
    const stored = Number(notes.bs_asset[key]?.py ?? 0);
    const { sum, hasAny } = sumBreakup(key, "amount_py");
    const magnitude = hasAny ? sum : Math.abs(stored);
    // BUG 1 (sign): when ON, a populated breakup already nets contras (sum is
    // signed) — return it directly so a net-abnormal balance keeps its sign.
    return CORP_SIGNED_NOTE_TOTALS && hasAny ? sum : signedTotal(stored, magnitude);
  };

  const effectivePY = (key: string, breakupPath?: string): number => {
    const stored = Number(notes.bs_asset[key]?.py ?? 0);
    const { sum, hasAny } = sumBreakup(key, "amount_py", breakupPath);
    const magnitude = hasAny ? sum : Math.abs(stored);
    // BUG 1 (sign): when ON, a populated breakup already nets contras (sum is
    // signed) — return it directly so a net-abnormal balance keeps its sign.
    return CORP_SIGNED_NOTE_TOTALS && hasAny ? sum : signedTotal(stored, magnitude);
  };

  // Smart note: only show a note number when at least one year has data.
  const { getNoteNo: dn } = useDynamicNoteRegistry(engagementId);
  const sn = (_dataKey: string, regKey: string = _dataKey): number | null =>
    dn(regKey) ?? null;

  // Trade Receivables ageing schemas
  const TR_ROWS = [
    { key: "undisp_good",     label: "(i) Undisputed — considered good" },
    { key: "undisp_doubtful", label: "(ii) Undisputed — considered doubtful" },
    { key: "disp_good",       label: "(iii) Disputed — considered good" },
    { key: "disp_doubtful",   label: "(iv) Disputed — considered doubtful" },
  ];
  const TR_BUCKETS = [
    { key: "lt6m", label: "< 6 m" },
    { key: "6m_1y", label: "6 m - 1 yr" },
    { key: "1_2",  label: "1-2 yrs" },
    { key: "2_3",  label: "2-3 yrs" },
    { key: "gt3",  label: "> 3 yrs" },
  ];

  const renderSingleNote = (
    noteNo: number | null,
    title: string,
    key: string,
    breakupPath: string,
    breakupHint: string,
  ) => {
    const effPY = effectivePY(key, breakupPath);
    return (
      <NoteCard collapseControl={collapseControl} noteNo={noteNo} title={title}>
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <ListTable
          rows={(get(breakupPath) ?? []) as ListRow[]}
          onChange={(next) => updatePath(breakupPath, next)}
          descPlaceholder={breakupHint}
          addLabel="Add row"
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
        />
        <EditableRow
          label={`Total — ${title} (per BS)`}
          cy={cy(key)} py={effPY}
          autoCY={cy(key)} autoPY={effPY}
          isOverriddenCy={isOverridden(`bs_asset.${key}.cy`)}
          isOverriddenPy={isOverridden(`bs_asset.${key}.py`)}
          onCommitCy={(v) => updatePath(`bs_asset.${key}.cy`, v)}
          onCommitPy={(v) => updatePath(`bs_asset.${key}.py`, v)}
          onResetCy={() => resetPath(`bs_asset.${key}.cy`)}
          onResetPy={() => resetPath(`bs_asset.${key}.py`)}
          bold
        />
      </NoteCard>
    );
  };

  return (
    <div className="space-y-4">
      <NoteCard collapseControl={collapseControl} noteNo={sn("nc_investments")} title="Non-current investments">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <div className="text-[10px] italic text-muted-foreground">(a) Investment property / (b) Equity Instruments / (c) Other investments</div>
        <ListTable
          rows={(get("bs_asset.nc_investments.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_asset.nc_investments.breakup", next)}
          descPlaceholder="Investment particulars"
          addLabel="Add investment"
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
        />
        <EditableRow
          label="Total — Non-current investments (per BS)"
          cy={cy("nc_investments")} py={effectivePY("nc_investments")}
          autoCY={cy("nc_investments")} autoPY={effectivePY("nc_investments")}
          isOverriddenCy={isOverridden("bs_asset.nc_investments.cy")}
          isOverriddenPy={isOverridden("bs_asset.nc_investments.py")}
          onCommitCy={(v) => updatePath("bs_asset.nc_investments.cy", v)}
          onCommitPy={(v) => updatePath("bs_asset.nc_investments.py", v)}
          onResetCy={() => resetPath("bs_asset.nc_investments.cy")}
          onResetPy={() => resetPath("bs_asset.nc_investments.py")}
          bold
        />
      </NoteCard>

      <NoteCard collapseControl={collapseControl} noteNo={sn("deferred_tax_asset", "deferred_tax_assets")} title="Deferred tax assets (Net)">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <EditableRow
          label="Excess of depreciation in books over IT Act"
          cy={Number(get("bs_asset.deferred_tax_asset.depr_excess_cy") ?? 0)}
          py={Number(get("bs_asset.deferred_tax_asset.depr_excess_py") ?? 0)}
          isOverriddenCy={isOverridden("bs_asset.deferred_tax_asset.depr_excess_cy")}
          isOverriddenPy={isOverridden("bs_asset.deferred_tax_asset.depr_excess_py")}
          onCommitCy={(v) => updatePath("bs_asset.deferred_tax_asset.depr_excess_cy", v)}
          onCommitPy={(v) => updatePath("bs_asset.deferred_tax_asset.depr_excess_py", v)}
        />
        <EditableRow
          label="Total — Deferred tax assets (per BS)"
          cy={cy("deferred_tax_asset")} py={py("deferred_tax_asset")}
          autoCY={cy("deferred_tax_asset")} autoPY={py("deferred_tax_asset")}
          isOverriddenCy={isOverridden("bs_asset.deferred_tax_asset.cy")}
          isOverriddenPy={isOverridden("bs_asset.deferred_tax_asset.py")}
          onCommitCy={(v) => updatePath("bs_asset.deferred_tax_asset.cy", v)}
          onCommitPy={(v) => updatePath("bs_asset.deferred_tax_asset.py", v)}
          onResetCy={() => resetPath("bs_asset.deferred_tax_asset.cy")}
          onResetPy={() => resetPath("bs_asset.deferred_tax_asset.py")}
          bold
        />
      </NoteCard>

      {renderSingleNote(sn("lt_loans", "lt_loans_advances"), "Long-term loans and advances", "lt_loans",
        "bs_asset.lt_loans.breakup", "Loan particulars")}
      {renderSingleNote(sn("other_nc_assets"), "Other non-current assets", "other_nc_assets",
        "bs_asset.other_nc_assets.breakup", "Particulars")}
      {renderSingleNote(sn("curr_investments", "current_investments"), "Current investments", "curr_investments",
        "bs_asset.curr_investments.breakup", "Investment particulars")}
      {renderSingleNote(sn("inventories"), "Inventories", "inventories",
        "bs_asset.inventories.breakup", "Raw materials / WIP / Finished goods / Stores & spares")}

      <NoteCard collapseControl={collapseControl} noteNo={sn("trade_receivables")} title="Trade Receivables">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <EditableRow
          label="Outstanding for a period exceeding 6 months"
          cy={Number(get("bs_asset.trade_receivables.gt6m_cy") ?? 0)}
          py={Number(get("bs_asset.trade_receivables.gt6m_py") ?? 0)}
          isOverriddenCy={isOverridden("bs_asset.trade_receivables.gt6m_cy")}
          isOverriddenPy={isOverridden("bs_asset.trade_receivables.gt6m_py")}
          onCommitCy={(v) => updatePath("bs_asset.trade_receivables.gt6m_cy", v)}
          onCommitPy={(v) => updatePath("bs_asset.trade_receivables.gt6m_py", v)}
        />
        <EditableRow
          label="Other receivables"
          cy={Number(get("bs_asset.trade_receivables.other_cy") ?? cy("trade_receivables"))}
          py={Number(get("bs_asset.trade_receivables.other_py") ?? py("trade_receivables"))}
          autoCY={cy("trade_receivables")} autoPY={py("trade_receivables")}
          isOverriddenCy={isOverridden("bs_asset.trade_receivables.other_cy")}
          isOverriddenPy={isOverridden("bs_asset.trade_receivables.other_py")}
          onCommitCy={(v) => updatePath("bs_asset.trade_receivables.other_cy", v)}
          onCommitPy={(v) => updatePath("bs_asset.trade_receivables.other_py", v)}
          onResetCy={() => resetPath("bs_asset.trade_receivables.other_cy")}
          onResetPy={() => resetPath("bs_asset.trade_receivables.other_py")}
        />
        <EditableRow
          label="Total — Trade Receivables (per BS)"
          cy={cy("trade_receivables")} py={py("trade_receivables")}
          autoCY={cy("trade_receivables")} autoPY={py("trade_receivables")}
          isOverriddenCy={isOverridden("bs_asset.trade_receivables.cy")}
          isOverriddenPy={isOverridden("bs_asset.trade_receivables.py")}
          onCommitCy={(v) => updatePath("bs_asset.trade_receivables.cy", v)}
          onCommitPy={(v) => updatePath("bs_asset.trade_receivables.py", v)}
          onResetCy={() => resetPath("bs_asset.trade_receivables.cy")}
          onResetPy={() => resetPath("bs_asset.trade_receivables.py")}
          bold
        />

        {/* Issue 11 (today) — the Trade Receivables ageing schedule was
            displayed below the note by default.  The user has asked for
            this to be removed; the standard note now ends with the
            "Total — Trade Receivables (per BS)" row, matching the firm's
            Schedule III layout.  The ageing matrix is still persisted on
            the engagement if it has been entered previously, so no data
            is lost — only the UI rendering is suppressed.  If a firm
            later needs the ageing breakup back, re-enable the AgeingTable
            blocks below (using TR_ROWS / TR_BUCKETS already imported). */}
      </NoteCard>

      {renderSingleNote(sn("cash_bank"), "Cash and bank equivalents", "cash_bank",
        "bs_asset.cash_bank.breakup", "(a) Cash on hand / (b) Balances with banks (Current / Deposit)")}
      {renderSingleNote(sn("st_loans", "st_loans_advances"), "Short-term loans and advances", "st_loans",
        "bs_asset.st_loans.breakup", "Loan particulars")}
      {renderSingleNote(sn("other_curr_assets", "other_current_assets"), "Other current assets", "other_curr_assets",
        "bs_asset.other_curr_assets.breakup", "Particulars")}
    </div>
  );
}
