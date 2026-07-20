/**
 * NotePL — Notes 25–29 (Statement of P&L break-ups) + EPS (no note number).
 * Matches SCHEDULE_III_DIV_I:
 *   25 = Revenue from Operations, 26 = Other Income,
 *   27 = Cost of Materials + Purchases + Changes in Inventories,
 *   28 = Employee Benefits, 29 = Other Expenses.
 * Finance Costs and Depreciation have noteRef: null per Schedule III.
 */

import { useState } from "react";
import {
  EditableRow, NoteCard, NoteHeaderRow, ListTable,
  type ListRow,
} from "./EditableCell";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";
import { useDynamicNoteRegistry } from "@/lib/noteNumberRegistry";
import { MoreVertical, Check as CheckIcon, ChevronDown, ChevronRight } from "lucide-react";
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

  // 2026-07-20 (V J Desai — Issue 2 for corporate FS): the six sub-cells
  // in "Changes in inventories of FG/WIP/SIT" are now MANUALLY EDITABLE.
  // Each cell renders `override ?? disp(...)`, where `override` is a
  // per-cell auditor entry persisted at
  //     pl.changes_inventory.override.{fg|wip|sit}_{close|open}_{cy|py}
  // Clearing the cell (blank commit → null) removes the override and the
  // cell reverts to the COA-derived value. The note total and the P&L
  // face both recompute from the SAME six display values, so edits flow
  // through automatically — root-cause fix, valid for every corporate
  // client.
  const ciOverride = (bucket: Bucket, kind: "close" | "open", col: "cy" | "py"): number | null => {
    const raw = get(`pl.changes_inventory.override.${bucket}_${kind}_${col}`);
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const ciDisplay = (bucket: Bucket, kind: "close" | "open", col: "cy" | "py"): number => {
    const ov = ciOverride(bucket, kind, col);
    if (ov != null) return ov;
    return disp(`${bucket}_${kind}_${col}` as keyof typeof src, bucket);
  };
  const ciCommit = (bucket: Bucket, kind: "close" | "open", col: "cy" | "py") =>
    (v: number | null) => {
      const path = `pl.changes_inventory.override.${bucket}_${kind}_${col}`;
      updatePath(path, v == null ? null : Number(v));
    };
  // Six display cells now go through ciDisplay so manual overrides win.
  const cellFgCloseCy  = ciDisplay("fg",  "close", "cy");
  const cellWipCloseCy = ciDisplay("wip", "close", "cy");
  const cellSitCloseCy = ciDisplay("sit", "close", "cy");
  const cellFgClosePy  = ciDisplay("fg",  "close", "py");
  const cellWipClosePy = ciDisplay("wip", "close", "py");
  const cellSitClosePy = ciDisplay("sit", "close", "py");
  const cellFgOpenCy   = ciDisplay("fg",  "open",  "cy");
  const cellWipOpenCy  = ciDisplay("wip", "open",  "cy");
  const cellSitOpenCy  = ciDisplay("sit", "open",  "cy");
  const cellFgOpenPy   = ciDisplay("fg",  "open",  "py");
  const cellWipOpenPy  = ciDisplay("wip", "open",  "py");
  const cellSitOpenPy  = ciDisplay("sit", "open",  "py");

  // "Changes in inventories (per P&L)" total = (Opening) − (Closing).
  // Positive = inventory decreased = expense.
  const ciTotalCy = (cellFgOpenCy + cellWipOpenCy + cellSitOpenCy)
                  - (cellFgCloseCy + cellWipCloseCy + cellSitCloseCy);
  const ciTotalPy = (cellFgOpenPy + cellWipOpenPy + cellSitOpenPy)
                  - (cellFgClosePy + cellWipClosePy + cellSitClosePy);

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

  // 2026-07-20 (V J Desai — Issue 1, EPS on P&L face): the note now computes
  // EPS using the correct AS-20 formula (NPAT / Weighted Avg Shares) — the
  // legacy "× 100" was a stale template holdover that inflated the ratio
  // by 100× and left every corporate P&L face displaying "—" (because the
  // face-side path also treated the shares divisor as zero when unset).
  //
  // Weighted-average shares now auto-populate from the Share Capital
  // paid-up breakup (share_count_cy / share_count_py) when the auditor
  // has not overridden them on this note. This makes EPS render on every
  // corporate client the moment Share Capital is filled — no separate
  // data entry required — while manual overrides on this note still win.
  const npat    = Number(get("pl.eps.npat") ?? 0);
  const npatPy  = Number(get("pl.eps.npat_py") ?? 0);
  const nominal = Number(get("pl.eps.nominal_value") ?? 10);
  const shareCapBreakup: any[] = Array.isArray((notes.bs_liab as any)?.share_capital?.breakup)
    ? (notes.bs_liab as any).share_capital.breakup
    : [];
  const shareCapCount = (col: "cy" | "py"): number =>
    shareCapBreakup
      .filter(r => r != null && (r.is_paid_up === true || r.subType === "issued_paid_up"))
      .reduce((s: number, r: any) => {
        const n = Number(col === "cy" ? r.share_count_cy : r.share_count_py);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0);
  const wavgStored   = Number(get("pl.eps.weighted_avg_shares") ?? 0);
  const wavgStoredPy = Number(get("pl.eps.weighted_avg_shares_py") ?? 0);
  const wavg   = wavgStored   > 0 ? wavgStored   : shareCapCount("cy");
  const wavgPy = wavgStoredPy > 0 ? wavgStoredPy : shareCapCount("py");
  const basicEps   = wavg   > 0 ? Math.round((npat   / wavg)   * 10000) / 10000 : 0;
  const basicEpsPy = wavgPy > 0 ? Math.round((npatPy / wavgPy) * 10000) / 10000 : 0;

  return (
    <div className="space-y-4">
      {renderListNote(sn("revenue_from_ops"), "Revenue from operations", "revenue_from_ops",
        "(a) Sale of products (net of returns) / (b) Sale of services / (c) Commission")}
      {renderListNote(sn("other_income"), "Other Income", "other_income",
        "Interest / Forex gain / Misc income")}

      {(() => {
        // 2026-07-20 (V J Desai — Issues 1 & 3 for corporate FS):
        //   Issue 1 — the note's total row (and the P&L face) must reflect
        //             live changes to Opening / Purchases / Closing:
        //                total = opening + purchases − closing.
        //   Issue 3 — "Add: Purchases" now exposes an expandable per-ledger
        //             breakup (COA-mapped PL_EXP_MAT ledgers) so auditors can
        //             see the make-up of the figure without leaving the note.
        //             Purchases amount auto-defaults to the breakup sum;
        //             manual override still wins.
        // Face-side mirror lives in PipelineFinancialStatements.tsx →
        // pl.costMaterials. Both sides share the same formula so BS ↔ face
        // ↔ note stay in lock-step for every corporate client.
        const cmBreakupRows = (get("pl.cost_materials.breakup") ?? []) as ListRow[];
        const cmBreakupSumCy = cmBreakupRows.reduce((s, r) => {
          const n = Number(r?.amount_cy);
          return s + (Number.isFinite(n) ? n : 0);
        }, 0);
        const cmBreakupSumPy = cmBreakupRows.reduce((s, r) => {
          const n = Number(r?.amount_py);
          return s + (Number.isFinite(n) ? n : 0);
        }, 0);
        const purchasesStoredCy = get("pl.cost_materials.purchases_cy");
        const purchasesStoredPy = get("pl.cost_materials.purchases_py");
        const purchasesCy = (purchasesStoredCy != null && purchasesStoredCy !== "")
          ? Number(purchasesStoredCy) : cmBreakupSumCy;
        const purchasesPy = (purchasesStoredPy != null && purchasesStoredPy !== "")
          ? Number(purchasesStoredPy) : cmBreakupSumPy;
        const openingCy = Number(get("pl.cost_materials.opening_cy") ?? 0);
        const openingPy = Number(get("pl.cost_materials.opening_py") ?? 0);
        const closingCy = Number(get("pl.cost_materials.closing_cy") ?? 0);
        const closingPy = Number(get("pl.cost_materials.closing_py") ?? 0);
        // Any manual entry present anywhere → compute from formula.
        // Nothing entered yet → keep the note total tied to the COA-derived
        // headline so a fresh engagement doesn't show 0.
        const anyEditsCy = get("pl.cost_materials.opening_cy") != null
                        || get("pl.cost_materials.closing_cy") != null
                        || purchasesStoredCy != null;
        const anyEditsPy = get("pl.cost_materials.opening_py") != null
                        || get("pl.cost_materials.closing_py") != null
                        || purchasesStoredPy != null;
        const cmTotalCy = anyEditsCy ? (openingCy + purchasesCy - closingCy) : cy("cost_materials");
        const cmTotalPy = anyEditsPy ? (openingPy + purchasesPy - closingPy) : effectivePY("cost_materials");
        return (
          <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("cost_materials")} title="Cost of materials consumed" readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={cmTotalCy} pyTotal={cmTotalPy}>
            <NoteHeaderRow cyLabel={`FY ${cyYear - 1}-${String(cyYear).slice(-2)}`} pyLabel={`FY ${pyYear - 1}-${String(pyYear).slice(-2)}`} />
            <EditableRow
              label="Opening Stock"
              cy={openingCy}
              py={openingPy}
              isOverriddenCy={isOverridden("pl.cost_materials.opening_cy")}
              isOverriddenPy={isOverridden("pl.cost_materials.opening_py")}
              onCommitCy={(v) => updatePath("pl.cost_materials.opening_cy", v)}
              onCommitPy={(v) => updatePath("pl.cost_materials.opening_py", v)}
            />
            <CoMPurchasesRow
              cy={purchasesCy}
              py={purchasesPy}
              autoCy={cmBreakupSumCy}
              autoPy={cmBreakupSumPy}
              rows={cmBreakupRows}
              onRowsChange={(next) => updatePath("pl.cost_materials.breakup", next)}
              onCommitCy={(v) => updatePath("pl.cost_materials.purchases_cy", v)}
              onCommitPy={(v) => updatePath("pl.cost_materials.purchases_py", v)}
              onResetCy={() => resetPath("pl.cost_materials.purchases_cy")}
              onResetPy={() => resetPath("pl.cost_materials.purchases_py")}
              isOverriddenCy={purchasesStoredCy != null && purchasesStoredCy !== ""}
              isOverriddenPy={purchasesStoredPy != null && purchasesStoredPy !== ""}
              engagementId={engagementId}
              onRemapLedger={onRemapLedger}
              onUnmapLedger={onUnmapLedger}
            />
            <EditableRow
              label="Less: Closing Stock"
              cy={closingCy}
              py={closingPy}
              isOverriddenCy={isOverridden("pl.cost_materials.closing_cy")}
              isOverriddenPy={isOverridden("pl.cost_materials.closing_py")}
              onCommitCy={(v) => updatePath("pl.cost_materials.closing_cy", v)}
              onCommitPy={(v) => updatePath("pl.cost_materials.closing_py", v)}
            />
            <EditableRow
              label="Cost of materials consumed (per P&L)"
              cy={cmTotalCy} py={cmTotalPy}
              autoCY={cmTotalCy} autoPY={cmTotalPy}
              onCommitCy={() => {}} onCommitPy={() => {}}
              isLocked
              bold
            />
          </NoteCard>
        );
      })()}

      {renderListNote(sn("purchases_stock"), "Purchase of stock-in-trade", "purchases_stock",
        "Purchase break-up")}

      <NoteCard engagementId={engagementId} collapseControl={collapseControl} noteNo={sn("changes_inventory", "changes_inventories")} title="Changes in inventories of FG / WIP / SIT" readOnly={hideEmpty} hideWhenEmpty={hideEmpty} cyTotal={ciTotalCy} pyTotal={ciTotalPy}>
        <NoteHeaderRow cyLabel={`FY ${cyYear - 1}-${String(cyYear).slice(-2)}`} pyLabel={`FY ${pyYear - 1}-${String(pyYear).slice(-2)}`} />
        <div className="text-[10px] italic text-muted-foreground mt-1 flex items-center gap-1">
          <span>Closing Stock</span>
          <span className="text-muted-foreground/70">— defaults flow from COA mapping; type any cell to override, blank to revert.</span>
        </div>
        {/* 2026-07-20 (V J Desai — Issue 2): each of the six sub-cells now
            takes a manual override. `autoCY` / `autoPY` still passes the
            COA-derived value so the ↺ reset control appears when an
            override is present, and the amber-tint override highlight fires
            automatically via EditableRow's isOverridden props. */}
        <div className="relative">
          <EditableRow
            label="Finished Goods" indent={1}
            cy={cellFgCloseCy} py={cellFgClosePy}
            autoCY={dispFgCloseCy} autoPY={dispFgClosePy}
            isOverriddenCy={ciOverride("fg", "close", "cy") != null}
            isOverriddenPy={ciOverride("fg", "close", "py") != null}
            onCommitCy={ciCommit("fg", "close", "cy")}
            onCommitPy={ciCommit("fg", "close", "py")}
            onResetCy={() => resetPath("pl.changes_inventory.override.fg_close_cy")}
            onResetPy={() => resetPath("pl.changes_inventory.override.fg_close_py")}
          />
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            {renderMoveDropdown("fg")}
          </div>
        </div>
        <div className="relative">
          <EditableRow
            label="Work-in-progress" indent={1}
            cy={cellWipCloseCy} py={cellWipClosePy}
            autoCY={dispWipCloseCy} autoPY={dispWipClosePy}
            isOverriddenCy={ciOverride("wip", "close", "cy") != null}
            isOverriddenPy={ciOverride("wip", "close", "py") != null}
            onCommitCy={ciCommit("wip", "close", "cy")}
            onCommitPy={ciCommit("wip", "close", "py")}
            onResetCy={() => resetPath("pl.changes_inventory.override.wip_close_cy")}
            onResetPy={() => resetPath("pl.changes_inventory.override.wip_close_py")}
          />
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            {renderMoveDropdown("wip")}
          </div>
        </div>
        <div className="relative">
          <EditableRow
            label="Stock-in-trade" indent={1}
            cy={cellSitCloseCy} py={cellSitClosePy}
            autoCY={dispSitCloseCy} autoPY={dispSitClosePy}
            isOverriddenCy={ciOverride("sit", "close", "cy") != null}
            isOverriddenPy={ciOverride("sit", "close", "py") != null}
            onCommitCy={ciCommit("sit", "close", "cy")}
            onCommitPy={ciCommit("sit", "close", "py")}
            onResetCy={() => resetPath("pl.changes_inventory.override.sit_close_cy")}
            onResetPy={() => resetPath("pl.changes_inventory.override.sit_close_py")}
          />
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            {renderMoveDropdown("sit")}
          </div>
        </div>
        <div className="text-[10px] italic text-muted-foreground mt-2">Less: Opening Stock</div>
        <EditableRow
          label="Finished Goods" indent={1}
          cy={cellFgOpenCy} py={cellFgOpenPy}
          autoCY={dispFgOpenCy} autoPY={dispFgOpenPy}
          isOverriddenCy={ciOverride("fg", "open", "cy") != null}
          isOverriddenPy={ciOverride("fg", "open", "py") != null}
          onCommitCy={ciCommit("fg", "open", "cy")}
          onCommitPy={ciCommit("fg", "open", "py")}
          onResetCy={() => resetPath("pl.changes_inventory.override.fg_open_cy")}
          onResetPy={() => resetPath("pl.changes_inventory.override.fg_open_py")}
        />
        <EditableRow
          label="Work-in-progress" indent={1}
          cy={cellWipOpenCy} py={cellWipOpenPy}
          autoCY={dispWipOpenCy} autoPY={dispWipOpenPy}
          isOverriddenCy={ciOverride("wip", "open", "cy") != null}
          isOverriddenPy={ciOverride("wip", "open", "py") != null}
          onCommitCy={ciCommit("wip", "open", "cy")}
          onCommitPy={ciCommit("wip", "open", "py")}
          onResetCy={() => resetPath("pl.changes_inventory.override.wip_open_cy")}
          onResetPy={() => resetPath("pl.changes_inventory.override.wip_open_py")}
        />
        <EditableRow
          label="Stock-in-trade" indent={1}
          cy={cellSitOpenCy} py={cellSitOpenPy}
          autoCY={dispSitOpenCy} autoPY={dispSitOpenPy}
          isOverriddenCy={ciOverride("sit", "open", "cy") != null}
          isOverriddenPy={ciOverride("sit", "open", "py") != null}
          onCommitCy={ciCommit("sit", "open", "cy")}
          onCommitPy={ciCommit("sit", "open", "py")}
          onResetCy={() => resetPath("pl.changes_inventory.override.sit_open_cy")}
          onResetPy={() => resetPath("pl.changes_inventory.override.sit_open_py")}
        />
        {/* Total row is auto-computed from the six display sub-cells (each
            of which respects manual overrides). Read-only. */}
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
          py={wavgPy}
          isOverriddenCy={isOverridden("pl.eps.weighted_avg_shares")}
          isOverriddenPy={isOverridden("pl.eps.weighted_avg_shares_py")}
          onCommitCy={(v) => updatePath("pl.eps.weighted_avg_shares", v)}
          onCommitPy={(v) => updatePath("pl.eps.weighted_avg_shares_py", v)}
        />
        <EditableRow
          label="Basic EPS (₹)"
          cy={Number(get("pl.eps.basic") ?? basicEps)}
          py={Number(get("pl.eps.basic_py") ?? basicEpsPy)}
          isOverriddenCy={isOverridden("pl.eps.basic")}
          isOverriddenPy={isOverridden("pl.eps.basic_py")}
          onCommitCy={(v) => updatePath("pl.eps.basic", v)}
          onCommitPy={(v) => updatePath("pl.eps.basic_py", v)}
          bold
        />
        <EditableRow
          label="Diluted EPS (₹)"
          cy={Number(get("pl.eps.diluted") ?? basicEps)}
          py={Number(get("pl.eps.diluted_py") ?? basicEpsPy)}
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

/**
 * 2026-07-20 (V J Desai — Issue 3): "Add: Purchases" row inside the Cost of
 * Materials Consumed note. Renders like a normal EditableRow but with a
 * disclosure chevron that expands into the underlying COA-mapped ledger
 * breakup (bs / p&l note style ListTable). Amount auto-defaults to the
 * breakup sum, so editing / adding rows updates the row's headline figure
 * — which in turn feeds the note total (opening + purchases − closing) and
 * the P&L face. Manual amount override still wins over the auto-sum.
 */
function CoMPurchasesRow({
  cy, py, autoCy, autoPy, rows, onRowsChange,
  onCommitCy, onCommitPy, onResetCy, onResetPy,
  isOverriddenCy, isOverriddenPy,
  engagementId, onRemapLedger, onUnmapLedger,
}: {
  cy: number; py: number;
  autoCy: number; autoPy: number;
  rows: ListRow[];
  onRowsChange: (rows: ListRow[]) => void;
  onCommitCy:   (v: number | null) => void;
  onCommitPy:   (v: number | null) => void;
  onResetCy:    () => void;
  onResetPy:    () => void;
  isOverriddenCy: boolean;
  isOverriddenPy: boolean;
  engagementId: string;
  onRemapLedger?: (ledger: string, code: string) => void;
  onUnmapLedger?: (ledger: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasBreakup = Array.isArray(rows) && rows.length > 0;
  return (
    <div>
      <div className="relative">
        <EditableRow
          label={hasBreakup
            ? (open ? "Add: Purchases (hide ledger breakup)" : "Add: Purchases (show ledger breakup)")
            : "Add: Purchases"}
          cy={cy} py={py}
          autoCY={autoCy} autoPY={autoPy}
          isOverriddenCy={isOverriddenCy}
          isOverriddenPy={isOverriddenPy}
          onCommitCy={onCommitCy}
          onCommitPy={onCommitPy}
          onResetCy={onResetCy}
          onResetPy={onResetPy}
        />
        {hasBreakup && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            title={open ? "Hide ledger breakup" : "Show ledger breakup"}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {open && hasBreakup && (
        <div className="ml-4 mt-1 mb-2 pl-3 border-l-2 border-muted">
          <div className="text-[10px] italic text-muted-foreground pb-1">Ledger-wise breakup (COA-mapped). Sum feeds the "Add: Purchases" amount above.</div>
          <ListTable
            rows={rows}
            onChange={onRowsChange}
            descPlaceholder="Purchase ledger"
            addLabel="Add row"
            showSubtotal
            onRemapLedger={onRemapLedger}
            onUnmapLedger={onUnmapLedger}
            engagementId={engagementId}
          />
        </div>
      )}
    </div>
  );
}
