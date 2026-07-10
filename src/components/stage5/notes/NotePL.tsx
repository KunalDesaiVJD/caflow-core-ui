/**
 * NotePL — Notes 25–29 (Statement of P&L break-ups) + EPS (no note number).
 * Matches SCHEDULE_III_DIV_I:
 *   25 = Revenue from Operations, 26 = Other Income,
 *   27 = Cost of Materials + Purchases + Changes in Inventories,
 *   28 = Employee Benefits, 29 = Other Expenses.
 * Finance Costs and Depreciation have noteRef: null per Schedule III.
 */

import {
  EditableRow, NoteCard, NoteHeaderRow, ListTable,
  type ListRow,
} from "./EditableCell";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";
import { useDynamicNoteRegistry } from "@/lib/noteNumberRegistry";
import { MoreVertical, Check as CheckIcon } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

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

export default function NotePL({
  engagementId, notes, cyYear, pyYear, updatePath, resetPath, isOverridden, collapseControl, onRemapLedger, onUnmapLedger, hideEmpty = false,
}: Props) {
  // Bug 4 — Sign-convention bridge for P&L Notes display
  // ─────────────────────────────────────────────────────────────────────────
  // P&L note headline totals (.cy / .py) may be stored in either sign:
  //   • Revenue notes (revenue_from_ops, other_income) — stored NEGATIVE in
  //     Tally CR convention by older auto-populates; stored POSITIVE after
  //     the sectionSign fix.
  //   • Expense notes — stored POSITIVE (Tally DR convention). Refunds /
  //     credit notes that flip a single ledger negative are an edge case.
  //
  // Every "Total per P&L" row should display a POSITIVE figure that matches
  // the face of the P&L Statement (where negI(...) flips revenue to positive
  // and expenses pass through). Normalize at read time so all values display
  // as positive — same convention as the breakup sub-rows (which use
  // Math.abs in buildBreakup).
  const normalizeSign = (raw: number): number => raw < 0 ? -raw : raw;
  const cy = (key: string) => normalizeSign(Number(notes.pl[key]?.cy ?? 0));
  const py = (key: string) => normalizeSign(Number(notes.pl[key]?.py ?? 0));
  const get = (path: string) => path.split(".").reduce<any>((c, k) => c?.[k], notes);

  // effectivePY: returns auto-populated PY if non-zero, otherwise falls back
  // to the sum of breakup rows' amount_py so "Total per P&L" never shows "—".
  const effectivePY = (key: string): number => {
    const autoPy = py(key);
    if (autoPy !== 0) return autoPy;
    const breakup = (get(`pl.${key}.breakup`) ?? []) as ListRow[];
    return breakup.reduce((s, r) => s + Math.abs(Number(r?.amount_py ?? 0)), 0);
  };

  // 2026-06-25 (V J Desai — MILL POWER Changes-in-Inventory):
  // Sub-cells now come from autoPopulateNotes' dedicated writer, which
  // reads INV_FG / INV_WIP / INV_STT / INV_STOCK / NCE_STCK / BS_CA_INV
  // codes off the COA mapping and stamps 12 sub-cells + preserves any
  // stored bucket_map override. NotePL's job here is:
  //   1. Read those raw sub-cells straight from JSONB.
  //   2. Apply an optional bucket_map so the auditor can move (say) the
  //      WIP amount into the Finished Goods display row without editing
  //      the COA mapping. `bucket_map: { wip: "fg" }` means "everything
  //      auto-populated under WIP should show under FG instead".
  //   3. Auto-compute the "Changes in inventories (per P&L)" total from
  //      the resulting display buckets. Amount cells are LOCKED (read-only)
  //      — the only way to change values is to fix the COA mapping.
  const num = (path: string): number => {
    const v = get(path);
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Source buckets straight from JSONB (populated by notesAutoPopulate).
  const src = {
    fg_close_cy:  num("pl.changes_inventory.fg_close_cy"),
    wip_close_cy: num("pl.changes_inventory.wip_close_cy"),
    sit_close_cy: num("pl.changes_inventory.sit_close_cy"),
    fg_close_py:  num("pl.changes_inventory.fg_close_py"),
    wip_close_py: num("pl.changes_inventory.wip_close_py"),
    sit_close_py: num("pl.changes_inventory.sit_close_py"),
    fg_open_cy:   num("pl.changes_inventory.fg_open_cy"),
    wip_open_cy:  num("pl.changes_inventory.wip_open_cy"),
    sit_open_cy:  num("pl.changes_inventory.sit_open_cy"),
    fg_open_py:   num("pl.changes_inventory.fg_open_py"),
    wip_open_py:  num("pl.changes_inventory.wip_open_py"),
    sit_open_py:  num("pl.changes_inventory.sit_open_py"),
  };

  // bucket_map: which display bucket does each source bucket land in?
  // Default is identity. Example {"wip":"fg"} → WIP totals show under FG.
  type Bucket = "fg" | "wip" | "sit";
  const bucketMap: Record<Bucket, Bucket> = {
    fg:  (get("pl.changes_inventory.bucket_map.fg")  as Bucket) ?? "fg",
    wip: (get("pl.changes_inventory.bucket_map.wip") as Bucket) ?? "wip",
    sit: (get("pl.changes_inventory.bucket_map.sit") as Bucket) ?? "sit",
  };
  // Reverse: display bucket → set of source buckets feeding it.
  const feedersOf = (display: Bucket): Bucket[] =>
    (["fg", "wip", "sit"] as Bucket[]).filter(s => bucketMap[s] === display);

  const disp = (field: keyof typeof src, display: Bucket): number => {
    const kind = field.replace(/^[a-z]+_/, ""); // "close_cy" | "open_cy" | ...
    return feedersOf(display).reduce((sum, s) => sum + (src[`${s}_${kind}` as keyof typeof src] as number), 0);
  };

  // Six display values that get shown in the sub-rows.
  const dispFgCloseCy  = disp("fg_close_cy",  "fg");
  const dispWipCloseCy = disp("wip_close_cy", "wip");
  const dispSitCloseCy = disp("sit_close_cy", "sit");
  const dispFgClosePy  = disp("fg_close_py",  "fg");
  const dispWipClosePy = disp("wip_close_py", "wip");
  const dispSitClosePy = disp("sit_close_py", "sit");
  const dispFgOpenCy   = disp("fg_open_cy",   "fg");
  const dispWipOpenCy  = disp("wip_open_cy",  "wip");
  const dispSitOpenCy  = disp("sit_open_cy",  "sit");
  const dispFgOpenPy   = disp("fg_open_py",   "fg");
  const dispWipOpenPy  = disp("wip_open_py",  "wip");
  const dispSitOpenPy  = disp("sit_open_py",  "sit");

  // "Changes in inventories (per P&L)" total = (Opening) − (Closing).
  // Positive = inventory decreased = expense.
  const ciTotalCy = (dispFgOpenCy + dispWipOpenCy + dispSitOpenCy)
                  - (dispFgCloseCy + dispWipCloseCy + dispSitCloseCy);
  const ciTotalPy = (dispFgOpenPy + dispWipOpenPy + dispSitOpenPy)
                  - (dispFgClosePy + dispWipClosePy + dispSitClosePy);

  // Bucket-reassignment handler used by the "Move to..." dropdown next to
  // each sub-row. Writes to `pl.changes_inventory.bucket_map.<source>` so
  // Re-sync doesn't wipe the choice (it survives via priorCI spread merge
  // in autoPopulateNotes).
  const setBucketMap = (source: Bucket, dest: Bucket): void => {
    updatePath(`pl.changes_inventory.bucket_map.${source}`, dest);
  };

  // 2026-06-25 (V J Desai request v2): three-dots (⋮) menu instead of a
  // <select>. Only shown when the source bucket actually has non-zero data —
  // avoids clutter on empty rows. Uses the same shadcn DropdownMenu pattern
  // as ListRowActionsMenu, so the look is consistent with the rest of the
  // Notes editor.
  const bucketLabel = { fg: "Finished Goods", wip: "Work-in-progress", sit: "Stock-in-trade" } as const;
  const renderMoveDropdown = (source: Bucket) => {
    const hasData =
      Math.abs(src[`${source}_close_cy` as keyof typeof src] as number) > 0.005 ||
      Math.abs(src[`${source}_close_py` as keyof typeof src] as number) > 0.005;
    if (!hasData) return null;
    const current = bucketMap[source];
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="Reassign amount to a different sub-row"
            className="ml-1 h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-[10px] text-muted-foreground">
            Show amount under
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(["fg", "wip", "sit"] as Bucket[]).map(b => (
            <DropdownMenuItem
              key={b}
              onSelect={() => setBucketMap(source, b)}
              className="text-xs gap-2"
            >
              <CheckIcon className={`h-3.5 w-3.5 ${current === b ? "opacity-100" : "opacity-0"}`} />
              {bucketLabel[b]}
              {b === source && (
                <span className="ml-auto text-[10px] text-muted-foreground">(default)</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Smart note: only show a note number when at least one year has data.
  const { getNoteNo: dn } = useDynamicNoteRegistry(engagementId);
  const sn = (_dataKey: string, regKey: string = _dataKey): number | null =>
    dn(regKey) ?? null;

  // Breakup rows now come from autoPopulateNotes (notesAutoPopulate.ts):
  // each note's `.breakup` array is built from COA-mapped TB ledgers, with
  // optional Schedule-III suggestion templates merged in (e.g. Note 29's 37
  // expense heads). Fuzzy-matched ledgers fill matching heads; un-matched
  // ledgers append at the bottom as new linked rows. User-typed rows are
  // preserved across re-syncs (per-row `source: "manual"`).
  const renderListNote = (
    noteNo: number | null,
    title: string,
    key: string,
    breakupHint: string,
  ) => {
    const path = `pl.${key}.breakup`;
    const rows: ListRow[] = (get(path) ?? []) as ListRow[];

    // Bug 2 — "Total per P&L" row is now READ-ONLY and computed.
    // It is the strict mathematical sum of breakup rows (numeric coercion;
    // null / undefined / empty-string treated as 0).  Falls back to the
    // stored cy/py only when no breakup row is populated.
    const sumCy = rows.reduce((s, r) => {
      const v = r?.amount_cy;
      const n = Number(v);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    const sumPy = rows.reduce((s, r) => {
      const v = r?.amount_py;
      const n = Number(v);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    const hasAnyBreakupCy = rows.some(r => r != null && r.amount_cy != null && r.amount_cy !== "");
    const hasAnyBreakupPy = rows.some(r => r != null && r.amount_py != null && r.amount_py !== "");
    const totalCy = hasAnyBreakupCy ? sumCy : cy(key);
    const totalPy = hasAnyBreakupPy ? sumPy : effectivePY(key);

    return (
      <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={noteNo} title={title} readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={totalCy} pyTotal={totalPy}>
        <NoteHeaderRow cyLabel={`FY ${cyYear - 1}-${String(cyYear).slice(-2)}`} pyLabel={`FY ${pyYear - 1}-${String(pyYear).slice(-2)}`} />
        <ListTable
          rows={rows}
          onChange={(next) => updatePath(path, next)}
          descPlaceholder={breakupHint}
          addLabel="Add row"
          showSubtotal
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
          engagementId={engagementId}
        />
        <EditableRow
          label={`Total — ${title} (per P&L)`}
          cy={totalCy} py={totalPy}
          /* No commit/reset handlers → row is read-only.  To change the total,
             edit the underlying breakup rows. */
          bold
        />
      </NoteCard>
    );
  };

  // EPS values — formula per FS NOTES.xlsx template: NPAT × 100 / Weighted Avg Shares
  // (the ×100 reflects the template convention of values in `'000s).
  const npat    = Number(get("pl.eps.npat") ?? 0);
  const nominal = Number(get("pl.eps.nominal_value") ?? 10);
  const wavg    = Number(get("pl.eps.weighted_avg_shares") ?? 0);
  const basicEps = wavg > 0 ? Math.round(((npat * 100) / wavg) * 10000) / 10000 : 0;

  return (
    <div className="space-y-4">
      {renderListNote(sn("revenue_from_ops"), "Revenue from operations", "revenue_from_ops",
        "(a) Sale of products (net of returns) / (b) Sale of services / (c) Commission")}
      {renderListNote(sn("other_income"), "Other Income", "other_income",
        "Interest / Forex gain / Misc income")}

      <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("cost_materials")} title="Cost of materials consumed" readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={cy("cost_materials")} pyTotal={py("cost_materials")}>
        <NoteHeaderRow cyLabel={`FY ${cyYear - 1}-${String(cyYear).slice(-2)}`} pyLabel={`FY ${pyYear - 1}-${String(pyYear).slice(-2)}`} />
        <EditableRow
          label="Opening Stock"
          cy={Number(get("pl.cost_materials.opening_cy") ?? 0)}
          py={Number(get("pl.cost_materials.opening_py") ?? 0)}
          isOverriddenCy={isOverridden("pl.cost_materials.opening_cy")}
          isOverriddenPy={isOverridden("pl.cost_materials.opening_py")}
          onCommitCy={(v) => updatePath("pl.cost_materials.opening_cy", v)}
          onCommitPy={(v) => updatePath("pl.cost_materials.opening_py", v)}
        />
        <EditableRow
          label="Add: Purchases"
          cy={Number(get("pl.cost_materials.purchases_cy") ?? 0)}
          py={Number(get("pl.cost_materials.purchases_py") ?? 0)}
          isOverriddenCy={isOverridden("pl.cost_materials.purchases_cy")}
          isOverriddenPy={isOverridden("pl.cost_materials.purchases_py")}
          onCommitCy={(v) => updatePath("pl.cost_materials.purchases_cy", v)}
          onCommitPy={(v) => updatePath("pl.cost_materials.purchases_py", v)}
        />
        <EditableRow
          label="Less: Closing Stock"
          cy={Number(get("pl.cost_materials.closing_cy") ?? 0)}
          py={Number(get("pl.cost_materials.closing_py") ?? 0)}
          isOverriddenCy={isOverridden("pl.cost_materials.closing_cy")}
          isOverriddenPy={isOverridden("pl.cost_materials.closing_py")}
          onCommitCy={(v) => updatePath("pl.cost_materials.closing_cy", v)}
          onCommitPy={(v) => updatePath("pl.cost_materials.closing_py", v)}
        />
        <EditableRow
          label="Cost of materials consumed (per P&L)"
          cy={cy("cost_materials")} py={py("cost_materials")}
          autoCY={cy("cost_materials")} autoPY={py("cost_materials")}
          isOverriddenCy={isOverridden("pl.cost_materials.cy")}
          isOverriddenPy={isOverridden("pl.cost_materials.py")}
          onCommitCy={(v) => updatePath("pl.cost_materials.cy", v)}
          onCommitPy={(v) => updatePath("pl.cost_materials.py", v)}
          onResetCy={() => resetPath("pl.cost_materials.cy")}
          onResetPy={() => resetPath("pl.cost_materials.py")}
          bold
        />
      </NoteCard>

      {renderListNote(sn("purchases_stock"), "Purchase of stock-in-trade", "purchases_stock",
        "Purchase break-up")}

      <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("changes_inventory", "changes_inventories")} title="Changes in inventories of FG / WIP / SIT" readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={ciTotalCy} pyTotal={ciTotalPy}>
        <NoteHeaderRow cyLabel={`FY ${cyYear - 1}-${String(cyYear).slice(-2)}`} pyLabel={`FY ${pyYear - 1}-${String(pyYear).slice(-2)}`} />
        <div className="text-[10px] italic text-muted-foreground mt-1 flex items-center gap-1">
          <span>Closing Stock</span>
          <span className="text-muted-foreground/70">— amounts flow from COA mapping; use “Move to…” to reassign</span>
        </div>
        {/* Closing Stock rows — locked, auto-populated from INV_FG / INV_WIP /
            INV_STT / INV_STOCK / NCE_STCK / BS_CA_INV codes via notesAutoPopulate.
            The Move-to dropdown lets the auditor redirect an entire source
            bucket to a different display sub-row when the underlying ledger
            doesn't have the right sub-code in COA. */}
        <div className="flex items-center">
          <div className="flex-1">
            <EditableRow
              label="Finished Goods" indent={1}
              cy={dispFgCloseCy} py={dispFgClosePy}
              autoCY={dispFgCloseCy} autoPY={dispFgClosePy}
              onCommitCy={() => {}} onCommitPy={() => {}}
              isLocked
            />
          </div>
          {renderMoveDropdown("fg")}
        </div>
        <div className="flex items-center">
          <div className="flex-1">
            <EditableRow
              label="Work-in-progress" indent={1}
              cy={dispWipCloseCy} py={dispWipClosePy}
              autoCY={dispWipCloseCy} autoPY={dispWipClosePy}
              onCommitCy={() => {}} onCommitPy={() => {}}
              isLocked
            />
          </div>
          {renderMoveDropdown("wip")}
        </div>
        <div className="flex items-center">
          <div className="flex-1">
            <EditableRow
              label="Stock-in-trade" indent={1}
              cy={dispSitCloseCy} py={dispSitClosePy}
              autoCY={dispSitCloseCy} autoPY={dispSitClosePy}
              onCommitCy={() => {}} onCommitPy={() => {}}
              isLocked
            />
          </div>
          {renderMoveDropdown("sit")}
        </div>
        <div className="text-[10px] italic text-muted-foreground mt-2">Less: Opening Stock</div>
        {/* Opening = closing of prior period, honouring the same bucket_map. */}
        <EditableRow
          label="Finished Goods" indent={1}
          cy={dispFgOpenCy} py={dispFgOpenPy}
          autoCY={dispFgOpenCy} autoPY={dispFgOpenPy}
          onCommitCy={() => {}} onCommitPy={() => {}}
          isLocked
        />
        <EditableRow
          label="Work-in-progress" indent={1}
          cy={dispWipOpenCy} py={dispWipOpenPy}
          autoCY={dispWipOpenCy} autoPY={dispWipOpenPy}
          onCommitCy={() => {}} onCommitPy={() => {}}
          isLocked
        />
        <EditableRow
          label="Stock-in-trade" indent={1}
          cy={dispSitOpenCy} py={dispSitOpenPy}
          autoCY={dispSitOpenCy} autoPY={dispSitOpenPy}
          onCommitCy={() => {}} onCommitPy={() => {}}
          isLocked
        />
        {/* Total row is auto-computed from the six display sub-cells — never
            editable. Consistent with the "amounts flow from COA" rule the
            user asked for; auditor changes the COA mapping to change values. */}
        <EditableRow
          label="Changes in inventories (per P&L)"
          cy={ciTotalCy} py={ciTotalPy}
          autoCY={ciTotalCy} autoPY={ciTotalPy}
          onCommitCy={() => {}} onCommitPy={() => {}}
          isLocked
          bold
        />
      </NoteCard>

      {renderListNote(sn("employee_benefits"), "Employee benefits expense", "employee_benefits",
        "Salaries / Director remuneration / PF / Staff welfare")}
      {/* Finance Costs — Note 28 per NOTE_REGISTRY */}
      {renderListNote(sn("finance_costs"), "Finance Cost", "finance_costs",
        "Interest to Bank / Other / Other borrowing cost / Interest on advance income tax")}

      {/* Note 29 — Other expenses; 37-head template lives in NOTE_ROW_REGISTRY */}
      {renderListNote(sn("other_expenses"), "Other expenses", "other_expenses",
        "Other expense particulars")}

      {/* EPS — Note 30 per NOTE_REGISTRY; always visible for corporate entities */}
      <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("eps")} title="Earnings per share (EPS)" readOnly={hideEmpty}>
        <NoteHeaderRow cyLabel={`FY ${cyYear - 1}-${String(cyYear).slice(-2)}`} pyLabel={`FY ${pyYear - 1}-${String(pyYear).slice(-2)}`} />
        <EditableRow
          label="Net Profit After Tax (NPAT)"
          cy={npat}
          py={Number(get("pl.eps.npat_py") ?? 0)}
          isOverriddenCy={isOverridden("pl.eps.npat")}
          isOverriddenPy={isOverridden("pl.eps.npat_py")}
          onCommitCy={(v) => updatePath("pl.eps.npat", v)}
          onCommitPy={(v) => updatePath("pl.eps.npat_py", v)}
          bold
        />
        <EditableRow
          label="Nominal value of equity share (₹)"
          cy={nominal}
          py={Number(get("pl.eps.nominal_value_py") ?? nominal)}
          isOverriddenCy={isOverridden("pl.eps.nominal_value")}
          isOverriddenPy={isOverridden("pl.eps.nominal_value_py")}
          onCommitCy={(v) => updatePath("pl.eps.nominal_value", v)}
          onCommitPy={(v) => updatePath("pl.eps.nominal_value_py", v)}
        />
        <EditableRow
          label="Weighted avg. number of equity shares"
          cy={wavg}
          py={Number(get("pl.eps.weighted_avg_shares_py") ?? 0)}
          isOverriddenCy={isOverridden("pl.eps.weighted_avg_shares")}
          isOverriddenPy={isOverridden("pl.eps.weighted_avg_shares_py")}
          onCommitCy={(v) => updatePath("pl.eps.weighted_avg_shares", v)}
          onCommitPy={(v) => updatePath("pl.eps.weighted_avg_shares_py", v)}
        />
        <EditableRow
          label="Basic EPS (₹)"
          cy={basicEps}
          py={Number(get("pl.eps.basic_py") ?? 0)}
          isOverriddenCy={isOverridden("pl.eps.basic")}
          isOverriddenPy={isOverridden("pl.eps.basic_py")}
          onCommitCy={(v) => updatePath("pl.eps.basic", v)}
          onCommitPy={(v) => updatePath("pl.eps.basic_py", v)}
          bold
        />
        <EditableRow
          label="Diluted EPS (₹)"
          cy={Number(get("pl.eps.diluted") ?? basicEps)}
          py={Number(get("pl.eps.diluted_py") ?? 0)}
          isOverriddenCy={isOverridden("pl.eps.diluted")}
          isOverriddenPy={isOverridden("pl.eps.diluted_py")}
          onCommitCy={(v) => updatePath("pl.eps.diluted", v)}
          onCommitPy={(v) => updatePath("pl.eps.diluted_py", v)}
          bold
        />
      </NoteCard>
    </div>
  );
}
