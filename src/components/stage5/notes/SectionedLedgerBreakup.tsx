/**
 * SectionedLedgerBreakup
 * ─────────────────────────────────────────────────────────────────────
 * V J Desai — Trade Payables (MSME / Others) and Trade Receivables
 * (>6 months / Other) both need the same UI shape: show every mapped
 * ledger with its CY/PY amount, let the auditor reclassify individual
 * ledgers between two sections via a three-dots menu, and compute the
 * two sub-totals + grand total live.
 *
 * All amounts are LOCKED from manual entry — the only way to change
 * them is to fix the COA mapping (same rule the Changes-in-Inventory
 * note now enforces). Reclassification is stored per-ledger under
 * <basePath>.ledger_section[<ledger_name>] = <section_key>.
 *
 * Non-zero filter: ledgers with |cy|+|py| ≈ 0 are hidden by default so
 * the auditor isn't buried in dormant Tally names; a small "Show N zero
 * rows" toggle exposes them when they need to reclassify a dormant one
 * that just became active.
 */

import { useMemo, useState } from "react";
import { MoreVertical, Check as CheckIcon, ChevronDown, ChevronRight } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ListRow } from "./EditableCell";
import { cn } from "@/lib/utils";

export interface SectionOption {
  /** Persisted key stored under ledger_section[<ledger>]. */
  key:   string;
  /** Displayed label in the sub-total row + menu. */
  label: string;
}

interface Props {
  /** Path to the note in the JSONB tree, e.g. "bs_liab.trade_payables". */
  basePath:   string;
  /** Per-ledger breakup rows (already auto-populated by notesAutoPopulate). */
  rows:       ListRow[];
  /** Two-way toggle (MSME vs Others, >6m vs Other). Order = display order. */
  sections:   [SectionOption, SectionOption];
  /** Ledger section lookup / mutation — read/write bs_*.<note>.ledger_section.<name>. */
  getSection: (ledgerName: string) => string | undefined;
  setSection: (ledgerName: string, section: string) => void;
  /** Read the per-note ledger_section map (used to render current pick in the menu). */
  cyLabel:    string;
  pyLabel:    string;
  /** Number formatter shared with EditableRow so display matches the aggregates below. */
  formatNumber?: (v: number) => string;
}

const defaultFormatter = (v: number): string =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .format(Math.round((v + Number.EPSILON) * 100) / 100);

export function SectionedLedgerBreakup({
  basePath, rows, sections, getSection, setSection, cyLabel, pyLabel,
  formatNumber = defaultFormatter,
}: Props) {
  const [showZero, setShowZero] = useState(false);

  const [primary, secondary] = sections;

  // Materialise rows with their resolved section + amount fields.
  const enriched = useMemo(() => rows.map(r => {
    const name = (r.linked_ledger || r.description || "").trim();
    const cy   = Number(r.amount_cy ?? 0) || 0;
    const py   = Number(r.amount_py ?? 0) || 0;
    const sec  = getSection(name) ?? secondary.key; // default = second section
    return { name, cy, py, section: sec };
  }), [rows, getSection, secondary.key]);

  const nonZero = useMemo(
    () => enriched.filter(r => Math.abs(r.cy) > 0.005 || Math.abs(r.py) > 0.005),
    [enriched],
  );
  const zeroCount = enriched.length - nonZero.length;

  const visible = showZero ? enriched : nonZero;
  const inSection = (secKey: string) => visible.filter(r => r.section === secKey);

  const totalOf = (secKey: string, field: "cy" | "py"): number =>
    enriched
      .filter(r => r.section === secKey)
      .reduce((s, r) => s + r[field], 0);

  const grandTotal = (field: "cy" | "py"): number =>
    enriched.reduce((s, r) => s + r[field], 0);

  return (
    <div className="rounded border border-border/60 bg-muted/20 px-2 py-2 space-y-1 mt-1">
      <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-muted-foreground border-b pb-1">
        <div className="col-span-6">Ledger</div>
        <div className="col-span-3 text-right">{cyLabel}</div>
        <div className="col-span-2 text-right">{pyLabel}</div>
        <div className="col-span-1" />
      </div>

      {sections.map((sec) => {
        const rowsInSec = inSection(sec.key);
        const secCy = totalOf(sec.key, "cy");
        const secPy = totalOf(sec.key, "py");
        return (
          <SectionBlock
            key={sec.key}
            sec={sec}
            rows={rowsInSec}
            secCy={secCy}
            secPy={secPy}
            sections={sections}
            setSection={setSection}
            formatNumber={formatNumber}
          />
        );
      })}

      {zeroCount > 0 && (
        <div className="flex items-center justify-between pt-1 mt-1 border-t border-border/40">
          <button
            type="button"
            onClick={() => setShowZero(v => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground underline decoration-dotted"
          >
            {showZero ? "Hide" : "Show"} {zeroCount} zero-balance ledger{zeroCount === 1 ? "" : "s"}
          </button>
          <div className="text-[10px] text-muted-foreground">
            <span className="font-semibold">Grand total:</span>{" "}
            <span className="tabular-nums">{formatNumber(grandTotal("cy"))}</span>
            {" · "}
            <span className="tabular-nums">{formatNumber(grandTotal("py"))}</span>
          </div>
        </div>
      )}

      {/* No-data hint */}
      {enriched.length === 0 && (
        <div className="py-3 text-center text-[11px] text-muted-foreground italic">
          No ledgers mapped to this note in COA yet. Map ledgers to the parent code in Stage 3 → COA Mapping.
        </div>
      )}
    </div>
  );
}

function SectionBlock({
  sec, rows, secCy, secPy, sections, setSection, formatNumber,
}: {
  sec: SectionOption;
  rows: { name: string; cy: number; py: number; section: string }[];
  secCy: number;
  secPy: number;
  sections: [SectionOption, SectionOption];
  setSection: (ledgerName: string, section: string) => void;
  formatNumber: (v: number) => string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full grid grid-cols-12 gap-2 items-center text-left px-1 py-0.5 rounded hover:bg-muted/50"
      >
        <div className="col-span-6 text-[11px] font-semibold text-foreground flex items-center gap-1">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {sec.label}
          <span className="text-[10px] text-muted-foreground font-normal">
            ({rows.length} ledger{rows.length === 1 ? "" : "s"})
          </span>
        </div>
        <div className="col-span-3 text-right text-[11px] font-semibold tabular-nums">
          {formatNumber(secCy)}
        </div>
        <div className="col-span-2 text-right text-[11px] font-semibold tabular-nums">
          {formatNumber(secPy)}
        </div>
        <div className="col-span-1" />
      </button>

      {open && rows.length > 0 && (
        <div className="pl-4 space-y-0">
          {rows.map((r) => (
            <div key={r.name} className="grid grid-cols-12 gap-2 items-center py-0.5 hover:bg-muted/30 rounded">
              <div className="col-span-6 text-[11px] truncate" title={r.name}>{r.name}</div>
              <div className="col-span-3 text-right text-[11px] tabular-nums">{formatNumber(r.cy)}</div>
              <div className="col-span-2 text-right text-[11px] tabular-nums">{formatNumber(r.py)}</div>
              <div className="col-span-1 flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      title="Reassign this ledger to a different section"
                      className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      <MoreVertical className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                      Move &ldquo;{r.name}&rdquo; to
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {sections.map((opt) => (
                      <DropdownMenuItem
                        key={opt.key}
                        onSelect={() => setSection(r.name, opt.key)}
                        className="text-xs gap-2"
                      >
                        <CheckIcon className={cn("h-3.5 w-3.5", r.section === opt.key ? "opacity-100" : "opacity-0")} />
                        {opt.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}
      {open && rows.length === 0 && (
        <div className="pl-4 py-1 text-[10px] italic text-muted-foreground">
          No ledgers currently classified under {sec.label}.
        </div>
      )}
    </div>
  );
}

export default SectionedLedgerBreakup;
// basePath is documented for callers so they know which JSONB slot to
// mutate via setSection; the component itself doesn't need to touch it
// because getSection / setSection encapsulate the read/write.
export const __basePathIsPropDocOnly = (b: string): string => b;
