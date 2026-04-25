/**
 * NotePL — Notes 22–30 (Statement of P&L break-ups + EPS).
 */

import {
  EditableRow, NoteCard, NoteHeaderRow, ListTable,
  type ListRow,
} from "./EditableCell";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";

interface Props {
  notes:        Stage5Notes;
  cyYear:       number;
  pyYear:       number;
  updatePath:   (path: string, value: any) => void;
  resetPath:    (path: string) => void;
  isOverridden: (path: string) => boolean;
}

// Note 29 — Other Expenses: 37 line items per Schedule III. We seed the
// list once when the array is empty so the auditor sees the full template
// to fill in (and can still + Add row / × Remove for engagement-specific
// items).
const OTHER_EXPENSES_TEMPLATE: ListRow[] = [
  "Audit fees", "Bank charges", "Books & periodicals", "Business promotion",
  "Commission", "Communication expenses", "Computer expenses", "Conveyance",
  "Donation", "Electricity", "Festival expenses", "Freight & forwarding",
  "GST expenses (non-creditable)", "Insurance", "Interest on TDS",
  "Internet & web charges", "Labour charges", "Legal & professional",
  "Loss on sale of assets", "Membership & subscription", "Office expenses",
  "Postage & courier", "Printing & stationery", "Rates & taxes",
  "Rent", "Repairs & maintenance — building",
  "Repairs & maintenance — plant & machinery",
  "Repairs & maintenance — others", "ROC fees", "Round-off",
  "Security charges", "Software expenses", "Staff welfare expenses",
  "Sundry expenses", "Travelling — domestic", "Travelling — foreign",
  "Vehicle running & maintenance",
].map(n => ({ description: n, amount_cy: 0, amount_py: 0 }));

export default function NotePL({
  notes, cyYear, pyYear, updatePath, resetPath, isOverridden,
}: Props) {
  const cy = (key: string) => Number(notes.pl[key]?.cy ?? 0);
  const py = (key: string) => Number(notes.pl[key]?.py ?? 0);
  const get = (path: string) => path.split(".").reduce<any>((c, k) => c?.[k], notes);

  const renderListNote = (
    noteNo: number,
    title: string,
    key: string,
    breakupHint: string,
    seedTemplate: ListRow[] | null = null,
  ) => {
    const path = `pl.${key}.breakup`;
    const existing: ListRow[] = (get(path) ?? []) as ListRow[];
    const rows = existing.length === 0 && seedTemplate ? seedTemplate : existing;
    return (
      <NoteCard noteNo={noteNo} title={title}>
        <NoteHeaderRow cyLabel={`FY ${cyYear - 1}-${String(cyYear).slice(-2)}`} pyLabel={`FY ${pyYear - 1}-${String(pyYear).slice(-2)}`} />
        <ListTable
          rows={rows}
          onChange={(next) => updatePath(path, next)}
          descPlaceholder={breakupHint}
          addLabel="Add row"
        />
        <EditableRow
          label={`Total — ${title} (per P&L)`}
          cy={cy(key)} py={py(key)}
          autoCY={cy(key)} autoPY={py(key)}
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

  // EPS values
  const npat = Number(get("pl.eps.npat") ?? 0);
  const nominal = Number(get("pl.eps.nominal_value") ?? 10);
  const wavg = Number(get("pl.eps.weighted_avg_shares") ?? 0);
  const basicEps = wavg > 0 ? Math.round((npat / wavg) * 10000) / 10000 : 0;

  return (
    <div className="space-y-4">
      {renderListNote(22, "Revenue from operations",     "revenue_from_ops",
        "(a) Sale of products (net of returns) / (b) Sale of services / (c) Commission")}
      {renderListNote(23, "Other Income",                "other_income",
        "Interest / Forex gain / Misc income")}

      <NoteCard noteNo={24} title="Cost of materials consumed">
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

      {renderListNote(25, "Purchase of stock-in-trade",  "purchases_stock",
        "Purchase break-up")}

      <NoteCard noteNo={26} title="Changes in inventories of FG / WIP / SIT">
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

      {renderListNote(27, "Employee benefits expense", "employee_benefits",
        "Salaries / Director remuneration / PF / Staff welfare")}
      {renderListNote(28, "Finance Cost",              "finance_costs",
        "Interest to Bank / Other / Other borrowing cost / Interest on advance income tax")}

      {/* Note 29 — Other expenses with 37-row template seed */}
      {renderListNote(29, "Other expenses", "other_expenses",
        "Other expense particulars",
        OTHER_EXPENSES_TEMPLATE)}

      <NoteCard noteNo={30} title="Earnings per share (EPS)">
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
