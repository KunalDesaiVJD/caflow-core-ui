/**
 * EditableCell + Notes primitives — shared building blocks for the Stage 5
 * Notes tab (UI-6). Re-used by NoteBSLiab, NoteBSAsset, NotePL, FAGrid.
 *
 * Although the file name says "EditableCell", it also exports the lightweight
 * layout primitives (NoteCard, SubSection, EditableRow, ListTable,
 * AgeingTable) so every note file imports from one place.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Pencil, X, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Indian numbering: 1,23,45,678.00 with parens for negatives, "-" for zero.
export function formatINR(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return "-";
  const abs = Math.abs(v).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return v < 0 ? `(${abs})` : abs;
}

// ─────────────────────────────────────────────────────────────────────────
// EditableCell — text or number input with auto/manual tinting
// ─────────────────────────────────────────────────────────────────────────

interface EditableCellProps {
  value:           number | string | null | undefined;
  autoValue?:      number | string | null;
  onCommit:        (next: number | string | null) => void;
  onResetToAuto?:  () => void;
  isOverridden?:   boolean;
  isAutoFilled?:   boolean;
  type?:           "number" | "text";
  placeholder?:    string;
  className?:      string;
  disabled?:       boolean;
}

export function EditableCell({
  value, autoValue, onCommit, onResetToAuto,
  isOverridden, isAutoFilled,
  type = "number", placeholder, className, disabled,
}: EditableCellProps) {
  const [focused, setFocused] = useState(false);
  const [draft,   setDraft]   = useState<string>("");

  const display = focused
    ? draft
    : (type === "number" ? formatINR(Number(value || 0)) : (value ?? ""));

  if (disabled) {
    return <span className={cn("tabular-nums", className)}>{String(display)}</span>;
  }

  // Tint colours: blue = auto-filled (untouched), amber = manually overridden.
  const tintCls = isOverridden
    ? "border-amber-300 bg-amber-50/40 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
    : isAutoFilled
      ? "border-blue-300/60 bg-blue-50/30 text-blue-900 dark:bg-blue-900/15 dark:text-blue-200"
      : "border-dashed border-muted-foreground/30 bg-background/40";

  const inputEl = (
    <input
      type={type === "number" ? "text" : "text"}
      inputMode={type === "number" ? "decimal" : "text"}
      value={String(display ?? "")}
      placeholder={placeholder}
      title={
        isOverridden  ? "(manual) — overridden value · click × to reset to (auto)"
        : isAutoFilled ? "(auto) — auto-filled from COA mapping"
        : ""
      }
      onFocus={(e) => {
        setFocused(true);
        const v = value;
        const raw = type === "number"
          ? (v === 0 || v === null || v === undefined ? "" : String(v))
          : String(v ?? "");
        setDraft(raw);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onBlur={() => {
        setFocused(false);
        const t = draft.trim();
        if (t === "") { onCommit(null); return; }
        if (type === "number") {
          const parsed = Number(t.replace(/,/g, ""));
          if (Number.isFinite(parsed)) onCommit(parsed);
        } else {
          onCommit(t);
        }
      }}
      className={cn(
        "w-full rounded px-1 outline-none border cursor-text",
        type === "number" ? "text-right tabular-nums" : "text-left",
        tintCls,
        "hover:bg-background hover:border-muted-foreground/60 focus:border-primary focus:bg-background focus:border-solid",
        className,
      )}
    />
  );

  if (isOverridden && onResetToAuto) {
    return (
      <div className="flex items-center gap-1">
        {inputEl}
        <button
          type="button"
          onClick={onResetToAuto}
          className="p-0.5 rounded hover:bg-amber-100 text-amber-700"
          title={`Reset to auto value: ${type === "number" ? formatINR(Number(autoValue || 0)) : (autoValue ?? "—")}`}
        >
          <X size={11} />
        </button>
      </div>
    );
  }
  return inputEl;
}

// ─────────────────────────────────────────────────────────────────────────
// Layout primitives
// ─────────────────────────────────────────────────────────────────────────

export function NoteCard({ noteNo, title, children }: { noteNo: number | string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card mb-4">
      <header className="border-b bg-muted/30 px-3 py-1.5">
        <h3 className="text-xs font-semibold">Note {noteNo} — {title}</h3>
      </header>
      <div className="px-3 py-2 text-[11px] space-y-2">{children}</div>
    </section>
  );
}

export function SubSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {title && <div className="font-semibold text-[11px] text-muted-foreground mt-1">{title}</div>}
      {children}
    </div>
  );
}

/**
 * EditableRow — a labelled row with two value cells (CY + PY). The most
 * common note-row shape. Optional `autoCY` / `autoPY` enable the auto
 * tinting + reset behaviour.
 */
export function EditableRow({
  label, indent = 0,
  cy, py, autoCY, autoPY,
  isOverriddenCy, isOverriddenPy,
  onCommitCy, onCommitPy, onResetCy, onResetPy,
  bold,
}: {
  label:           string;
  indent?:         number;
  cy:              number | null | undefined;
  py:              number | null | undefined;
  autoCY?:         number | null;
  autoPY?:         number | null;
  isOverriddenCy?: boolean;
  isOverriddenPy?: boolean;
  onCommitCy:      (v: number | null) => void;
  onCommitPy:      (v: number | null) => void;
  onResetCy?:      () => void;
  onResetPy?:      () => void;
  bold?:           boolean;
}) {
  return (
    <div className={cn("grid grid-cols-12 gap-2 items-center py-0.5", bold && "font-semibold")}>
      <div className="col-span-6" style={{ paddingLeft: indent * 12 }}>{label}</div>
      <div className="col-span-3">
        <EditableCell
          value={cy ?? 0}
          autoValue={autoCY ?? null}
          isAutoFilled={autoCY !== undefined && autoCY !== null}
          isOverridden={!!isOverriddenCy}
          onCommit={(v) => onCommitCy(v == null ? null : Number(v))}
          onResetToAuto={onResetCy}
        />
      </div>
      <div className="col-span-3">
        <EditableCell
          value={py ?? 0}
          autoValue={autoPY ?? null}
          isAutoFilled={autoPY !== undefined && autoPY !== null}
          isOverridden={!!isOverriddenPy}
          onCommit={(v) => onCommitPy(v == null ? null : Number(v))}
          onResetToAuto={onResetPy}
        />
      </div>
    </div>
  );
}

/** Header row matching EditableRow column layout. */
export function NoteHeaderRow({ cyLabel, pyLabel }: { cyLabel: string; pyLabel: string }) {
  return (
    <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-muted-foreground border-b pb-1 mb-1">
      <div className="col-span-6">Particulars</div>
      <div className="col-span-3 text-right">{cyLabel}</div>
      <div className="col-span-3 text-right">{pyLabel}</div>
    </div>
  );
}

/**
 * ListTable — managed list of {description, amount_cy, amount_py} rows.
 * Used for note line-items where the user adds rows freely (e.g. ledger
 * break-ups under a note). Persisted as an array under a single dot-path.
 */
export interface ListRow {
  description?: string;
  amount_cy?:   number;
  amount_py?:   number;
}

export function ListTable({
  rows,
  onChange,
  addLabel = "Add row",
  descPlaceholder = "Particulars",
}: {
  rows:             ListRow[];
  onChange:         (next: ListRow[]) => void;
  addLabel?:        string;
  descPlaceholder?: string;
}) {
  const update = (i: number, patch: Partial<ListRow>) => {
    const next = rows.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => {
    const next = rows.slice();
    next.splice(i, 1);
    onChange(next);
  };
  const add = () => onChange([...rows, { description: "", amount_cy: 0, amount_py: 0 }]);

  return (
    <div className="space-y-1">
      {rows.length === 0 && (
        <div className="text-[10px] italic text-muted-foreground py-1">No entries yet.</div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-6">
            <EditableCell
              type="text"
              value={r.description ?? ""}
              placeholder={descPlaceholder}
              onCommit={(v) => update(i, { description: String(v ?? "") })}
            />
          </div>
          <div className="col-span-3">
            <EditableCell
              value={r.amount_cy ?? 0}
              onCommit={(v) => update(i, { amount_cy: v == null ? 0 : Number(v) })}
            />
          </div>
          <div className="col-span-2">
            <EditableCell
              value={r.amount_py ?? 0}
              onCommit={(v) => update(i, { amount_py: v == null ? 0 : Number(v) })}
            />
          </div>
          <div className="col-span-1 flex justify-end">
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
              title="Remove row"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
      <Button
        type="button" variant="outline" size="sm"
        onClick={add}
        className="h-6 text-[10px] gap-1 mt-1"
      >
        <Plus size={11} /> {addLabel}
      </Button>
    </div>
  );
}

/**
 * AgeingTable — fixed-schema 4 rows × 5 cols schedule used for
 * Trade Payables (MSME / Others / Disputed-MSME / Disputed-Others) and
 * Trade Receivables (Undisputed-good / Undisputed-doubtful / Disputed-good /
 * Disputed-doubtful). Row labels + column headers are caller-supplied so
 * one component covers both shapes.
 */
export interface AgeingMatrix {
  [rowKey: string]: { [bucket: string]: number };
}

export function AgeingTable({
  rowDefs,
  bucketDefs,
  matrix,
  onChange,
}: {
  rowDefs:    { key: string; label: string }[];
  bucketDefs: { key: string; label: string }[];
  matrix:     AgeingMatrix | undefined;
  onChange:   (next: AgeingMatrix) => void;
}) {
  const m = matrix || {};
  const update = (rk: string, bk: string, v: number | null) => {
    const next: AgeingMatrix = JSON.parse(JSON.stringify(m));
    next[rk] = next[rk] || {};
    if (v == null) delete next[rk][bk];
    else next[rk][bk] = v;
    onChange(next);
  };
  const rowTotal = (rk: string) =>
    bucketDefs.reduce((s, b) => s + (m[rk]?.[b.key] || 0), 0);
  const colTotal = (bk: string) =>
    rowDefs.reduce((s, r) => s + (m[r.key]?.[bk] || 0), 0);
  const grand = rowDefs.reduce((s, r) => s + rowTotal(r.key), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="bg-muted/40">
            <th className="text-left p-1 border w-[28%]">Particulars</th>
            {bucketDefs.map(b => (
              <th key={b.key} className="text-right p-1 border">{b.label}</th>
            ))}
            <th className="text-right p-1 border bg-muted/60">Total</th>
          </tr>
        </thead>
        <tbody>
          {rowDefs.map(r => (
            <tr key={r.key}>
              <td className="p-1 border">{r.label}</td>
              {bucketDefs.map(b => (
                <td key={b.key} className="p-0.5 border">
                  <EditableCell
                    value={m[r.key]?.[b.key] ?? 0}
                    onCommit={(v) => update(r.key, b.key, v == null ? null : Number(v))}
                  />
                </td>
              ))}
              <td className="p-1 border text-right tabular-nums font-semibold bg-muted/30">{formatINR(rowTotal(r.key))}</td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <td className="p-1 border">Total</td>
            {bucketDefs.map(b => (
              <td key={b.key} className="p-1 border text-right tabular-nums">{formatINR(colTotal(b.key))}</td>
            ))}
            <td className="p-1 border text-right tabular-nums">{formatINR(grand)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export const PencilIcon = Pencil;
