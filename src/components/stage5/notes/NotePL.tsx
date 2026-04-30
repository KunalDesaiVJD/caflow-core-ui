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

interface Props {
  notes:           Stage5Notes;
  cyYear:          number;
  pyYear:          number;
  updatePath:      (path: string, value: any) => void;
  resetPath:       (path: string) => void;
  isOverridden:    (path: string) => boolean;
  engagementId:    string;
  collapseControl?: boolean;
}

export default function NotePL({
  engagementId, notes, cyYear, pyYear, updatePath, resetPath, isOverridden, collapseControl,
}: Props) {
  const cy = (key: string) => Number(notes.pl[key]?.cy ?? 0);
  const py = (key: string) => Number(notes.pl[key]?.py ?? 0);
  const get = (path: string) => path.split(".").reduce<any>((c, k) => c?.[k], notes);

  // effectivePY: returns auto-populated PY if non-zero, otherwise falls back
  // to the sum of breakup rows' amount_py so "Total per P&L" never shows "—".
  const effectivePY = (key: string): number => {
    const autoPy = py(key);
    if (autoPy !== 0) return autoPy;
    const breakup = (get(`pl.${key}.breakup`) ?? []) as ListRow[];
    return breakup.reduce((s, r) => s + (r.amount_py ?? 0), 0);
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
    const effPY = effectivePY(key);
    return (
      <NoteCard collapseControl={collapseControl} noteNo={noteNo} title={title}>
        <NoteHeaderRow cyLabel={`FY ${cyYear - 1}-${String(cyYear).slice(-2)}`} pyLabel={`FY ${pyYear - 1}-${String(pyYear).slice(-2)}`} />
        <ListTable
          rows={rows}
          onChange={(next) => updatePath(path, next)}
          descPlaceholder={breakupHint}
          addLabel="Add row"
          showSubtotal
        />
        <EditableRow
          label={`Total — ${title} (per P&L)`}
          cy={cy(key)} py={effPY}
          autoCY={cy(key)} autoPY={effPY}
          isOverriddenCy={isOverridden(`pl.${key}.cy`)}
          isOverriddenPy={isOverridden(`pl.${key}.py`)}
          onCommitCy={(v) => updatePath(`pl.${key}.cy`, v)}
          onCommitPy={(v) => updatePath(`pl.${key}.py`, v)}
          onResetCy={() => resetPath(`pl.${key}.cy`)}
          onResetPy={() => resetPath(`pl.${key}.py`)}
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

      <NoteCard collapseControl={collapseControl} noteNo={sn("cost_materials")} title="Cost of materials consumed">
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

      <NoteCard collapseControl={collapseControl} noteNo={sn("changes_inventory", "changes_inventories")} title="Changes in inventories of FG / WIP / SIT">
        <NoteHeaderRow cyLabel={`FY ${cyYear - 1}-${String(cyYear).slice(-2)}`} pyLabel={`FY ${pyYear - 1}-${String(pyYear).slice(-2)}`} />
        <div className="text-[10px] italic text-muted-foreground mt-1">Closing Stock</div>
        <EditableRow
          label="Finished Goods" indent={1}
          cy={Number(get("pl.changes_inventory.fg_close_cy") ?? 0)}
          py={Number(get("pl.changes_inventory.fg_close_py") ?? 0)}
          onCommitCy={(v) => updatePath("pl.changes_inventory.fg_close_cy", v)}
          onCommitPy={(v) => updatePath("pl.changes_inventory.fg_close_py", v)}
          isOverriddenCy={isOverridden("pl.changes_inventory.fg_close_cy")}
          isOverriddenPy={isOverridden("pl.changes_inventory.fg_close_py")}
        />
        <EditableRow
          label="Work-in-progress" indent={1}
          cy={Number(get("pl.changes_inventory.wip_close_cy") ?? 0)}
          py={Number(get("pl.changes_inventory.wip_close_py") ?? 0)}
          onCommitCy={(v) => updatePath("pl.changes_inventory.wip_close_cy", v)}
          onCommitPy={(v) => updatePath("pl.changes_inventory.wip_close_py", v)}
          isOverriddenCy={isOverridden("pl.changes_inventory.wip_close_cy")}
          isOverriddenPy={isOverridden("pl.changes_inventory.wip_close_py")}
        />
        <EditableRow
          label="Stock-in-trade" indent={1}
          cy={Number(get("pl.changes_inventory.sit_close_cy") ?? 0)}
          py={Number(get("pl.changes_inventory.sit_close_py") ?? 0)}
          onCommitCy={(v) => updatePath("pl.changes_inventory.sit_close_cy", v)}
          onCommitPy={(v) => updatePath("pl.changes_inventory.sit_close_py", v)}
          isOverriddenCy={isOverridden("pl.changes_inventory.sit_close_cy")}
          isOverriddenPy={isOverridden("pl.changes_inventory.sit_close_py")}
        />
        <div className="text-[10px] italic text-muted-foreground mt-2">Less: Opening Stock</div>
        <EditableRow
          label="Finished Goods" indent={1}
          cy={Number(get("pl.changes_inventory.fg_open_cy") ?? 0)}
          py={Number(get("pl.changes_inventory.fg_open_py") ?? 0)}
          onCommitCy={(v) => updatePath("pl.changes_inventory.fg_open_cy", v)}
          onCommitPy={(v) => updatePath("pl.changes_inventory.fg_open_py", v)}
          isOverriddenCy={isOverridden("pl.changes_inventory.fg_open_cy")}
          isOverriddenPy={isOverridden("pl.changes_inventory.fg_open_py")}
        />
        <EditableRow
          label="Work-in-progress" indent={1}
          cy={Number(get("pl.changes_inventory.wip_open_cy") ?? 0)}
          py={Number(get("pl.changes_inventory.wip_open_py") ?? 0)}
          onCommitCy={(v) => updatePath("pl.changes_inventory.wip_open_cy", v)}
          onCommitPy={(v) => updatePath("pl.changes_inventory.wip_open_py", v)}
          isOverriddenCy={isOverridden("pl.changes_inventory.wip_open_cy")}
          isOverriddenPy={isOverridden("pl.changes_inventory.wip_open_py")}
        />
        <EditableRow
          label="Stock-in-trade" indent={1}
          cy={Number(get("pl.changes_inventory.sit_open_cy") ?? 0)}
          py={Number(get("pl.changes_inventory.sit_open_py") ?? 0)}
          onCommitCy={(v) => updatePath("pl.changes_inventory.sit_open_cy", v)}
          onCommitPy={(v) => updatePath("pl.changes_inventory.sit_open_py", v)}
          isOverriddenCy={isOverridden("pl.changes_inventory.sit_open_cy")}
          isOverriddenPy={isOverridden("pl.changes_inventory.sit_open_py")}
        />
        <EditableRow
          label="Changes in inventories (per P&L)"
          cy={cy("changes_inventory")} py={py("changes_inventory")}
          autoCY={cy("changes_inventory")} autoPY={py("changes_inventory")}
          isOverriddenCy={isOverridden("pl.changes_inventory.cy")}
          isOverriddenPy={isOverridden("pl.changes_inventory.py")}
          onCommitCy={(v) => updatePath("pl.changes_inventory.cy", v)}
          onCommitPy={(v) => updatePath("pl.changes_inventory.py", v)}
          onResetCy={() => resetPath("pl.changes_inventory.cy")}
          onResetPy={() => resetPath("pl.changes_inventory.py")}
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
      <NoteCard collapseControl={collapseControl} noteNo={sn("eps")} title="Earnings per share (EPS)">
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
