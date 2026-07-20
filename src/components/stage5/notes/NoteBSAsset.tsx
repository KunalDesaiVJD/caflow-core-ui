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
import { SectionedLedgerBreakup } from "./SectionedLedgerBreakup";

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
  /** Corporate Lock Preview parity with NCE: when true, individual NoteCards
   *  hide themselves if both CY and PY totals are zero/blank. */
  hideEmpty?:      boolean;
}

export default function NoteBSAsset({
  engagementId, notes, cyYear, pyYear, updatePath, resetPath, isOverridden, collapseControl, onRemapLedger, onUnmapLedger, hideEmpty = false,
}: Props) {
  const get = (path: string) => path.split(".").reduce<any>((c, k) => c?.[k], notes);

  // 2026-06-25 (V J Desai — LT/ST split for loans & advances): mirrors the
  // helpers in NoteBSLiab. Sum st_split_cy/py over the LT-loans breakup;
  // used by the LT and ST loans note renders below and the BS face.
  const sumStSplit = (breakupPath: string, field: "st_split_cy" | "st_split_py"): number => {
    const rows = (get(breakupPath) ?? []) as ListRow[];
    return rows.reduce((s, r) => {
      const n = Number((r as any)?.[field] ?? 0);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
  };
  const fmtSplit = (n: number): string =>
    new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      .format(Math.round((n + Number.EPSILON) * 100) / 100);

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
      <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={noteNo} title={title} readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={cy(key)} pyTotal={effPY}>
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <ListTable
          rows={(get(breakupPath) ?? []) as ListRow[]}
          onChange={(next) => updatePath(breakupPath, next)}
          descPlaceholder={breakupHint}
          addLabel="Add row"
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
          engagementId={engagementId}
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
      <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("nc_investments")} title="Non-current investments" readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={cy("nc_investments")} pyTotal={effectivePY("nc_investments")}>
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <div className="text-[10px] italic text-muted-foreground">(a) Investment property / (b) Equity Instruments / (c) Other investments</div>
        <ListTable
          rows={(get("bs_asset.nc_investments.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_asset.nc_investments.breakup", next)}
          descPlaceholder="Investment particulars"
          addLabel="Add investment"
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
          engagementId={engagementId}
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

      <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("deferred_tax_asset", "deferred_tax_assets")} title="Deferred tax assets (Net)" readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={cy("deferred_tax_asset")} pyTotal={py("deferred_tax_asset")}>
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

      {/* 2026-06-25 (V J Desai — LT/ST split, revised UX): same pattern as
          borrowings — LT row's amount cell shows the residual inline via
          splitToShortTermEnabled; no separate "Less:" footer. The ST loans
          note below injects a mirror row per split. */}
      {(() => {
        const ltEffPY = effectivePY("lt_loans", "bs_asset.lt_loans.breakup");
        const ltSplitCy = sumStSplit("bs_asset.lt_loans.breakup", "st_split_cy");
        const ltSplitPy = sumStSplit("bs_asset.lt_loans.breakup", "st_split_py");
        const ltTotalCy = cy("lt_loans") - ltSplitCy;
        const ltTotalPy = ltEffPY - ltSplitPy;
        return (
          <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("lt_loans", "lt_loans_advances")} title="Long-term loans and advances" readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={ltTotalCy} pyTotal={ltTotalPy}>
            <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
            <ListTable
              rows={(get("bs_asset.lt_loans.breakup") ?? []) as ListRow[]}
              onChange={(next) => updatePath("bs_asset.lt_loans.breakup", next)}
              descPlaceholder="Loan particulars"
              addLabel="Add row"
              onRemapLedger={onRemapLedger}
              onUnmapLedger={onUnmapLedger}
              engagementId={engagementId}
              splitToShortTermEnabled
            />
            <EditableRow
              label="Total — Long-term loans and advances (per BS)"
              cy={ltTotalCy} py={ltTotalPy}
              autoCY={ltTotalCy} autoPY={ltTotalPy}
              onCommitCy={() => {}} onCommitPy={() => {}}
              isLocked
              bold
            />
          </NoteCard>
        );
      })()}
      {renderSingleNote(sn("other_nc_assets"), "Other non-current assets", "other_nc_assets",
        "bs_asset.other_nc_assets.breakup", "Particulars")}
      {renderSingleNote(sn("curr_investments", "current_investments"), "Current investments", "curr_investments",
        "bs_asset.curr_investments.breakup", "Investment particulars")}
      {renderSingleNote(sn("inventories"), "Inventories", "inventories",
        "bs_asset.inventories.breakup", "Raw materials / WIP / Finished goods / Stores & spares")}

      {(() => {
        // 2026-07-20 (V J Desai — Issue 3, TR manual allocation):
        // Replaces the earlier per-ledger >6m / Other classification. A
        // customer can move between buckets across FY (e.g. Others in PY
        // becomes >6m in CY), and a single ledger-level flag can't
        // represent both — so we now expose CY & PY as independent
        // manual allocations. Default: everything under "Others" (residual
        // = Total − >6m), which matches Schedule III convention when the
        // auditor hasn't yet done ageing. Grand total stays anchored to
        // the COA-derived TR total so BS ↔ note invariance is preserved
        // even if the auditor never touches the note.
        //
        // Storage (independent for each FY):
        //   bs_asset.trade_receivables.gt6m_cy  / gt6m_py
        //   bs_asset.trade_receivables.other_cy / other_py  (optional; residual otherwise)
        const trTotalCy = cy("trade_receivables");
        const trTotalPy = py("trade_receivables");
        const num = (v: any): number => {
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };
        const gt6mCy = num(get("bs_asset.trade_receivables.gt6m_cy"));
        const gt6mPy = num(get("bs_asset.trade_receivables.gt6m_py"));
        const otherStoredCy = get("bs_asset.trade_receivables.other_cy");
        const otherStoredPy = get("bs_asset.trade_receivables.other_py");
        const otherCy = (otherStoredCy != null && otherStoredCy !== "")
          ? num(otherStoredCy) : (trTotalCy - gt6mCy);
        const otherPy = (otherStoredPy != null && otherStoredPy !== "")
          ? num(otherStoredPy) : (trTotalPy - gt6mPy);
        const driftCy = Math.abs((gt6mCy + otherCy) - trTotalCy);
        const driftPy = Math.abs((gt6mPy + otherPy) - trTotalPy);
        return (
          <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("trade_receivables")} title="Trade Receivables" readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={trTotalCy} pyTotal={trTotalPy}>
            <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />

            <div className="text-[10px] italic text-muted-foreground mt-1">
              Enter CY &amp; PY amounts under &quot;Outstanding for a period exceeding 6 months&quot; below. Whatever is left over (Total − &gt;6m) is automatically classified under &quot;Others&quot;. Manual amounts for the two years are independent.
            </div>

            <EditableRow
              label="(i) Outstanding for a period exceeding 6 months"
              cy={gt6mCy}
              py={gt6mPy}
              isOverriddenCy={isOverridden("bs_asset.trade_receivables.gt6m_cy")}
              isOverriddenPy={isOverridden("bs_asset.trade_receivables.gt6m_py")}
              onCommitCy={(v) => updatePath("bs_asset.trade_receivables.gt6m_cy", v == null ? null : Number(v))}
              onCommitPy={(v) => updatePath("bs_asset.trade_receivables.gt6m_py", v == null ? null : Number(v))}
            />
            <EditableRow
              label="(ii) Others"
              cy={otherCy}
              py={otherPy}
              autoCY={trTotalCy - gt6mCy}
              autoPY={trTotalPy - gt6mPy}
              isOverriddenCy={isOverridden("bs_asset.trade_receivables.other_cy")}
              isOverriddenPy={isOverridden("bs_asset.trade_receivables.other_py")}
              onCommitCy={(v) => updatePath("bs_asset.trade_receivables.other_cy", v == null ? null : Number(v))}
              onCommitPy={(v) => updatePath("bs_asset.trade_receivables.other_py", v == null ? null : Number(v))}
            />

            <EditableRow
              label="Total — Trade Receivables (per BS)"
              cy={trTotalCy} py={trTotalPy}
              autoCY={trTotalCy} autoPY={trTotalPy}
              onCommitCy={() => {}} onCommitPy={() => {}}
              isLocked
              bold
            />

            {(driftCy > 1 || driftPy > 1) && (
              <div className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">
                ⚠ Sum of (i) + (ii) differs from the COA-derived Total by
                {driftCy > 1 ? ` CY ${driftCy.toFixed(0)}` : ""}
                {driftCy > 1 && driftPy > 1 ? "," : ""}
                {driftPy > 1 ? ` PY ${driftPy.toFixed(0)}` : ""}
                {" "}— adjust the &gt;6m amount so the residual (Others) matches the ledger balance.
              </div>
            )}
          </NoteCard>
        );
      })()}

      {renderSingleNote(sn("cash_bank"), "Cash and bank equivalents", "cash_bank",
        "bs_asset.cash_bank.breakup", "(a) Cash on hand / (b) Balances with banks (Current / Deposit)")}
      {/* 2026-06-25 (V J Desai — LT/ST split, revised UX): ST loans note
          gets a MIRROR ROW per LT-loans ledger with a non-zero split. The
          mirror row carries the SAME LEDGER NAME as the LT source and its
          amount is the split. Mirror rows are derived at render time and
          stripped from onChange before persisting. */}
      {(() => {
        const stEffPY = effectivePY("st_loans", "bs_asset.st_loans.breakup");
        const ltSplitCy = sumStSplit("bs_asset.lt_loans.breakup", "st_split_cy");
        const ltSplitPy = sumStSplit("bs_asset.lt_loans.breakup", "st_split_py");
        const stTotalCy = cy("st_loans") + ltSplitCy;
        const stTotalPy = stEffPY + ltSplitPy;
        const ltBreakup = (get("bs_asset.lt_loans.breakup") ?? []) as ListRow[];
        const stStored  = (get("bs_asset.st_loans.breakup") ?? []) as ListRow[];
        const mirrorRows: ListRow[] = ltBreakup
          .filter(r => Math.abs(Number(r.st_split_cy ?? 0)) > 0.005 || Math.abs(Number(r.st_split_py ?? 0)) > 0.005)
          .map(r => ({
            id:             `mirror_${r.id ?? (r.linked_ledger || r.description || Math.random())}`,
            description:    r.description || r.linked_ledger || "(unnamed)",
            amount_cy:      Number(r.st_split_cy ?? 0),
            amount_py:      Number(r.st_split_py ?? 0),
            source:         "linked" as const,
            linked_ledger:  r.linked_ledger || undefined,
            st_mirror_of:   r.id || r.linked_ledger || r.description || "",
          }));
        const stDisplayRows = [...mirrorRows, ...stStored.filter(r => !r.st_mirror_of)];
        return (
          <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("st_loans", "st_loans_advances")} title="Short-term loans and advances" readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={stTotalCy} pyTotal={stTotalPy}>
            <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
            <ListTable
              rows={stDisplayRows}
              onChange={(next) => {
                const persisted = next.filter(r => !r.st_mirror_of);
                updatePath("bs_asset.st_loans.breakup", persisted);
              }}
              descPlaceholder="Loan particulars"
              addLabel="Add row"
              onRemapLedger={onRemapLedger}
              onUnmapLedger={onUnmapLedger}
              engagementId={engagementId}
            />
            <EditableRow
              label="Total — Short-term loans and advances (per BS)"
              cy={stTotalCy} py={stTotalPy}
              autoCY={stTotalCy} autoPY={stTotalPy}
              onCommitCy={() => {}} onCommitPy={() => {}}
              isLocked
              bold
            />
          </NoteCard>
        );
      })()}
      {renderSingleNote(sn("other_curr_assets", "other_current_assets"), "Other current assets", "other_curr_assets",
        "bs_asset.other_curr_assets.breakup", "Particulars")}
    </div>
  );
}
