/**
 * FAGrid — Property, Plant & Equipment movement schedule (AS-10).
 * 10-column grid with sticky header + totals row + PY total row.
 *
 * Rows live in stage5_notes.fa.rows (see notesAutoPopulate.ts). Default
 * rows: Land / Factory Building / Plant & Machinery / Computers (per
 * Phase 1 migration). User can add / remove rows.
 *
 * Computed columns are derived in the renderer (NOT stored), so any
 * change to gross_open / additions / disposals / depn_* updates them
 * live without write-amplification.
 */

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditableCell, formatINR } from "./EditableCell";
import type { FARow, Stage5Notes } from "@/lib/notesAutoPopulate";
import { useDynamicNoteRegistry } from "@/lib/noteNumberRegistry";

interface Props {
  engagementId: string;
  rows:         FARow[];
  pyRows?:      FARow[] | null;       // for the "Total — Previous year" row
  onChange:     (rows: FARow[]) => void;
}

const blankRow = (): FARow => ({
  id:           `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  particulars:  "",
  useful_life:  0,
  gross_open:   0,
  additions:    0,
  disposals:    0,
  depn_open:    0,
  depn_add:     0,
  depn_disp:    0,
});

const grossClose = (r: FARow) => (r.gross_open || 0) + (r.additions || 0) - (r.disposals || 0);
const depnClose  = (r: FARow) => (r.depn_open  || 0) + (r.depn_add   || 0) - (r.depn_disp  || 0);
const netCY      = (r: FARow) => grossClose(r) - depnClose(r);
const netPY      = (r: FARow) => (r.gross_open || 0) - (r.depn_open || 0);

export default function FAGrid({ engagementId, rows, pyRows, onChange }: Props) {
  const update = (i: number, patch: Partial<FARow>) => {
    const next = rows.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => {
    const next = rows.slice();
    next.splice(i, 1);
    onChange(next);
  };
  const add = () => onChange([...rows, blankRow()]);

  const { getNoteNo: dn } = useDynamicNoteRegistry(engagementId);

  // Totals
  const sumOf = (rs: FARow[], k: keyof FARow): number =>
    rs.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const sumDerived = (rs: FARow[], fn: (r: FARow) => number): number =>
    rs.reduce((s, r) => s + fn(r), 0);

  const totalsCY = {
    gross_open: sumOf(rows, "gross_open"),
    additions:  sumOf(rows, "additions"),
    disposals:  sumOf(rows, "disposals"),
    grossClose: sumDerived(rows, grossClose),
    depn_open:  sumOf(rows, "depn_open"),
    depn_add:   sumOf(rows, "depn_add"),
    depn_disp:  sumOf(rows, "depn_disp"),
    depnClose:  sumDerived(rows, depnClose),
    netCY:      sumDerived(rows, netCY),
    netPY:      sumDerived(rows, netPY),
  };

  return (
    <div className="rounded-lg border bg-card mb-4">
      <header className="border-b bg-muted/30 px-3 py-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold">Note {dn("ppe") ?? "—"} — Property, Plant &amp; Equipment and Intangible Assets (AS-10)</h3>
        <Button type="button" variant="outline" size="sm" onClick={add} className="h-6 text-[10px] gap-1">
          <Plus size={11} /> Add Asset
        </Button>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead className="sticky top-0 bg-muted/40 z-10">
            <tr>
              <th rowSpan={2} className="p-1 border text-left min-w-[140px]">Particulars</th>
              <th rowSpan={2} className="p-1 border text-center w-[60px]">Useful<br />Life</th>
              <th colSpan={4} className="p-1 border text-center bg-blue-50/50">Gross Block</th>
              <th colSpan={4} className="p-1 border text-center bg-amber-50/50">Depreciation</th>
              <th colSpan={2} className="p-1 border text-center bg-green-50/50">Net Block</th>
              <th rowSpan={2} className="p-1 border w-[24px]"></th>
            </tr>
            <tr>
              <th className="p-1 border text-right">Open</th>
              <th className="p-1 border text-right">Additions</th>
              <th className="p-1 border text-right">Disposals</th>
              <th className="p-1 border text-right bg-blue-50/30">Closing</th>
              <th className="p-1 border text-right">Open</th>
              <th className="p-1 border text-right">For year</th>
              <th className="p-1 border text-right">Disposals</th>
              <th className="p-1 border text-right bg-amber-50/30">Closing</th>
              <th className="p-1 border text-right bg-green-50/30">CY</th>
              <th className="p-1 border text-right bg-green-50/30">PY</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={13} className="p-2 italic text-muted-foreground text-center">
                  No assets yet — click "Add Asset" to start.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id || i}>
                <td className="p-0.5 border">
                  <EditableCell
                    type="text"
                    value={r.particulars}
                    placeholder="Asset name"
                    onCommit={(v) => update(i, { particulars: String(v ?? "") })}
                    className="text-left"
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    type="text"
                    value={String(r.useful_life ?? "")}
                    placeholder="—"
                    onCommit={(v) => {
                      const s = String(v ?? "").trim();
                      const n = Number(s);
                      update(i, { useful_life: Number.isFinite(n) && s !== "" ? n : (s || 0) });
                    }}
                    className="text-center"
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell value={r.gross_open} onCommit={(v) => update(i, { gross_open: v == null ? 0 : Number(v) })} />
                </td>
                <td className="p-0.5 border">
                  <EditableCell value={r.additions}  onCommit={(v) => update(i, { additions:  v == null ? 0 : Number(v) })} />
                </td>
                <td className="p-0.5 border">
                  <EditableCell value={r.disposals}  onCommit={(v) => update(i, { disposals:  v == null ? 0 : Number(v) })} />
                </td>
                <td className="p-1 border text-right tabular-nums bg-blue-50/30 font-semibold">{formatINR(grossClose(r))}</td>
                <td className="p-0.5 border">
                  <EditableCell value={r.depn_open} onCommit={(v) => update(i, { depn_open: v == null ? 0 : Number(v) })} />
                </td>
                <td className="p-0.5 border">
                  <EditableCell value={r.depn_add}  onCommit={(v) => update(i, { depn_add:  v == null ? 0 : Number(v) })} />
                </td>
                <td className="p-0.5 border">
                  <EditableCell value={r.depn_disp} onCommit={(v) => update(i, { depn_disp: v == null ? 0 : Number(v) })} />
                </td>
                <td className="p-1 border text-right tabular-nums bg-amber-50/30 font-semibold">{formatINR(depnClose(r))}</td>
                <td className="p-1 border text-right tabular-nums bg-green-50/30 font-semibold">{formatINR(netCY(r))}</td>
                <td className="p-1 border text-right tabular-nums bg-green-50/30">{formatINR(netPY(r))}</td>
                <td className="p-0.5 border text-center">
                  <button
                    type="button" onClick={() => remove(i)}
                    className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
                    title="Remove asset"
                  >
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}

            {/* Totals — current year */}
            <tr className="bg-muted/40 font-semibold">
              <td className="p-1 border" colSpan={2}>Total — Current year</td>
              <td className="p-1 border text-right tabular-nums">{formatINR(totalsCY.gross_open)}</td>
              <td className="p-1 border text-right tabular-nums">{formatINR(totalsCY.additions)}</td>
              <td className="p-1 border text-right tabular-nums">{formatINR(totalsCY.disposals)}</td>
              <td className="p-1 border text-right tabular-nums bg-blue-100/40">{formatINR(totalsCY.grossClose)}</td>
              <td className="p-1 border text-right tabular-nums">{formatINR(totalsCY.depn_open)}</td>
              <td className="p-1 border text-right tabular-nums">{formatINR(totalsCY.depn_add)}</td>
              <td className="p-1 border text-right tabular-nums">{formatINR(totalsCY.depn_disp)}</td>
              <td className="p-1 border text-right tabular-nums bg-amber-100/40">{formatINR(totalsCY.depnClose)}</td>
              <td className="p-1 border text-right tabular-nums bg-green-100/40">{formatINR(totalsCY.netCY)}</td>
              <td className="p-1 border text-right tabular-nums bg-green-100/40">{formatINR(totalsCY.netPY)}</td>
              <td className="p-1 border"></td>
            </tr>

            {/* Totals — previous year (from PY engagement, if available) */}
            {pyRows && pyRows.length > 0 && (
              <tr className="bg-muted/20 italic text-muted-foreground">
                <td className="p-1 border" colSpan={2}>Total — Previous year</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumOf(pyRows, "gross_open"))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumOf(pyRows, "additions"))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumOf(pyRows, "disposals"))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumDerived(pyRows, grossClose))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumOf(pyRows, "depn_open"))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumOf(pyRows, "depn_add"))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumOf(pyRows, "depn_disp"))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumDerived(pyRows, depnClose))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumDerived(pyRows, netCY))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(sumDerived(pyRows, netPY))}</td>
                <td className="p-1 border"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Small helper exported for NotesTab parent
export type { Stage5Notes };
