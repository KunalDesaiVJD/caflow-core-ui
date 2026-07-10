/**
 * SectionedLedgerBreakup
 * ─────────────────────────────────────────────────────────────────────
 * V J Desai — Trade Payables (MSME / Others) and Trade Receivables
 * (>6 months / Other) both need the same UI: TWO section rows that ARE
 * the sub-totals themselves, each expandable to reveal every mapped
 * ledger with a three-dots menu to reclassify between the two sections.
 *
 * Design tenets (post-review 2026-06-25):
 *   • No duplicate "sub-total" rows below — the section header IS the
 *     sub-total row. Auditor sees ONE row per section (not two).
 *   • Amounts always LOCKED — the only way to change values is COA.
 *   • Zero-balance ledgers hidden by default; a small text button
 *     exposes them when the auditor needs to reclassify a dormant one.
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
  /** Displayed label — also serves as the sub-total row label. */
  label: string;
}

interface Props {
  rows:       ListRow[];
  sections:   [SectionOption, SectionOption];
  /** Read/write per-ledger section assignment.
   *  getSection returns undefined for unclassified ledgers (default = second key). */
  getSection: (ledgerName: string) => string | undefined;
  setSection: (ledgerName: string, section: string) => void;
  formatNumber?: (v: number) => string;
  /** Optional grand-total row footer. Set to false to hide when the note
   *  already prints its own "Total — <note> (per BS)" below. */
  showGrandTotal?: boolean;
}

const defaultFormatter = (v: number): string =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .format(Math.round((v + Number.EPSILON) * 100) / 100);

export function SectionedLedgerBreakup({
  rows, sections, getSection, setSection,
  formatNumber = defaultFormatter,
  showGrandTotal = false,
}: Props) {
  const [showZero, setShowZero] = useState(false);
  const [_, secondary] = sections;

  const enriched = useMemo(() => rows.map(r => {
    const name = (r.linked_ledger || r.description || "").trim();
    const cy   = Number(r.amount_cy ?? 0) || 0;
    const py   = Number(r.amount_py ?? 0) || 0;
    const sec  = getSection(name) ?? secondary.key;
    return { name, cy, py, section: sec };
  }), [rows, getSection, secondary.key]);

  const nonZero  = useMemo(() => enriched.filter(r => Math.abs(r.cy) > 0.005 || Math.abs(r.py) > 0.005), [enriched]);
  const zeroCount = enriched.length - nonZero.length;
  const visible  = showZero ? enriched : nonZero;

  const totalOf = (secKey: string, field: "cy" | "py"): number =>
    enriched
      .filter(r => r.section === secKey)
      .reduce((s, r) => s + r[field], 0);
  const grandTotal = (field: "cy" | "py"): number =>
    enriched.reduce((s, r) => s + r[field], 0);

  return (
    <div className="mt-1 space-y-0.5">
      {sections.map((sec) => (
        <SectionRow
          key={sec.key}
          sec={sec}
          allSections={sections}
          rows={visible.filter(r => r.section === sec.key)}
          secCy={totalOf(sec.key, "cy")}
          secPy={totalOf(sec.key, "py")}
          setSection={setSection}
          formatNumber={formatNumber}
        />
      ))}

      {zeroCount > 0 && (
        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          <button
            type="button"
            onClick={() => setShowZero(v => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground underline decoration-dotted"
          >
            {showZero ? "Hide" : "Show"} {zeroCount} zero-balance ledger{zeroCount === 1 ? "" : "s"}
          </button>
          {showGrandTotal && (
            <div className="text-[10px] text-muted-foreground">
              <span className="font-semibold">Grand total:</span>{" "}
              <span className="tabular-nums">{formatNumber(grandTotal("cy"))}</span>
              {" · "}
              <span className="tabular-nums">{formatNumber(grandTotal("py"))}</span>
            </div>
          )}
        </div>
      )}

      {enriched.length === 0 && (
        <div className="py-3 text-center text-[11px] text-muted-foreground italic">
          No ledgers mapped to this note in COA yet. Map ledgers to the parent code in Stage 3 → COA Mapping.
        </div>
      )}
    </div>
  );
}

function SectionRow({
  sec, allSections, rows, secCy, secPy, setSection, formatNumber,
}: {
  sec: SectionOption;
  allSections: [SectionOption, SectionOption];
  rows: { name: string; cy: number; py: number; section: string }[];
  secCy: number;
  secPy: number;
  setSection: (ledgerName: string, section: string) => void;
  formatNumber: (v: number) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {/* This IS the sub-total row (no duplicate below). Click to expand ledgers. */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full grid grid-cols-12 gap-2 items-center text-left py-1 rounded hover:bg-muted/40"
      >
        <div className="col-span-6 text-[12px] font-medium text-foreground flex items-center gap-1">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {sec.label}
          <span className="text-[10px] text-muted-foreground font-normal">
            ({rows.length} ledger{rows.length === 1 ? "" : "s"})
          </span>
        </div>
        <div className="col-span-3 text-right text-[12px] font-medium tabular-nums">
          {formatNumber(secCy)}
        </div>
        <div className="col-span-2 text-right text-[12px] font-medium tabular-nums">
          {formatNumber(secPy)}
        </div>
        <div className="col-span-1" />
      </button>

      {open && rows.length > 0 && (
        <div className="pl-5 border-l border-border/50 ml-1.5 mt-0.5 mb-1 space-y-0">
          {rows.map((r) => (
            <div key={r.name} className="grid grid-cols-12 gap-2 items-center py-0.5 hover:bg-muted/30 rounded">
              <div className="col-span-6 text-[11px] truncate text-muted-foreground" title={r.name}>{r.name}</div>
              <div className="col-span-3 text-right text-[11px] tabular-nums text-muted-foreground">{formatNumber(r.cy)}</div>
              <div className="col-span-2 text-right text-[11px] tabular-nums text-muted-foreground">{formatNumber(r.py)}</div>
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
                    {allSections.map((opt) => (
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
        <div className="pl-5 py-1 text-[10px] italic text-muted-foreground">
          No ledgers currently classified here.
        </div>
      )}
    </div>
  );
}

export default SectionedLedgerBreakup;
