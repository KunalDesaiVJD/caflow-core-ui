/**
 * fsUnits.tsx — Global presentation-units context for Financial Statements.
 *
 * Companies Act, 2013 (Sch III) requires Pvt / Public Ltd companies to
 * present figures in '000s, lakhs, crores, etc. depending on turnover.
 * This context lets the user pick a unit ONCE from the FS shell toolbar
 * and have every Note / BS / PL / Cash Flow / Notes-to-Accounts page
 * scale + round its numbers consistently.
 *
 * Rounding policy: figures are ALWAYS rendered as whole numbers (no paise)
 * regardless of unit — auditor-friendly per user instruction.
 *
 * Persistence: scale choice is stored per engagement in localStorage so it
 * survives page reloads.
 */
import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";

export type FsScale = "actual" | "thousands";

export interface FsScaleMeta {
  key:        FsScale;
  label:      string;   // toolbar button label
  suffix:     string;   // shown after column header e.g. "(₹ in '000)"
  divisor:    number;
}

// Per Sch III for Pvt / Public Ltd, only "actual" or "in '000" are mandated
// for the on-screen FS view in our current scope — user removed Lakhs/Crores.
export const FS_SCALES: FsScaleMeta[] = [
  { key: "actual",    label: "Actual",      suffix: "(₹)",         divisor: 1     },
  { key: "thousands", label: "Rs. in '000", suffix: "(₹ in '000)", divisor: 1_000 },
];

interface FsUnitsContextValue {
  scale:       FsScale;
  setScale:    (s: FsScale) => void;
  meta:        FsScaleMeta;
  /** Convert a raw INR amount to the active scale + return a rounded INTEGER. */
  scaleAmount: (n: number | null | undefined) => number;
  /** Render the scaled, rounded amount in Indian numbering (no decimals). */
  format:      (n: number | null | undefined) => string;
  /** Suffix text for column headers, e.g. "(₹ in '000)" */
  suffix:      string;
}

const FsUnitsContext = createContext<FsUnitsContextValue | undefined>(undefined);

const STORAGE_KEY = (engagementId?: string | null) =>
  `caflow:fs_scale:${engagementId ?? "global"}`;

/** Indian numbering, whole numbers only, parens for negatives, "-" for zero. */
export function formatINRWhole(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) < 0.5) return "-";
  const abs = Math.round(Math.abs(v)).toLocaleString("en-IN", {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
  return v < 0 ? `(${abs})` : abs;
}

/**
 * Module-level active divisor. The Provider keeps this in sync with the
 * selected scale so legacy formatters (which can't easily call hooks because
 * they're invoked from non-component scopes — Excel writers, deeply nested
 * helpers, etc.) can still scale by importing `formatScaledINRWhole`.
 */
let _activeDivisor = 1;
export function getActiveFsDivisor(): number { return _activeDivisor; }

/** Scale + whole-rupee Indian formatter that reads the module-level scale. */
export function formatScaledINRWhole(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return formatINRWhole(v / _activeDivisor);
}

interface ProviderProps {
  engagementId?: string | null;
  children:      ReactNode;
}

export function FsUnitsProvider({ engagementId, children }: ProviderProps) {
  const [scale, setScaleState] = useState<FsScale>(() => {
    if (typeof window === "undefined") return "actual";
    try {
      const stored = localStorage.getItem(STORAGE_KEY(engagementId));
      if (stored === "actual" || stored === "thousands") return stored;
    } catch { /* ignore */ }
    return "actual";
  });

  // Re-hydrate when engagement changes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY(engagementId));
      if (stored === "actual" || stored === "thousands") setScaleState(stored);
      else setScaleState("actual");
    } catch { /* ignore */ }
  }, [engagementId]);

  const setScale = (s: FsScale) => {
    setScaleState(s);
    try { localStorage.setItem(STORAGE_KEY(engagementId), s); } catch { /* ignore */ }
  };

  // CRITICAL: set the module-level divisor *synchronously during render* so
  // children that call formatINR / formatScaledINRWhole during this same
  // render pass see the new scale immediately. Doing this in useEffect would
  // run after children render, leaving them one click behind.
  {
    const m = FS_SCALES.find(s => s.key === scale) ?? FS_SCALES[0];
    _activeDivisor = m.divisor;
  }

  const value = useMemo<FsUnitsContextValue>(() => {
    const meta = FS_SCALES.find(s => s.key === scale)!;
    const scaleAmount = (n: number | null | undefined): number => {
      const v = Number(n);
      if (!Number.isFinite(v)) return 0;
      return Math.round(v / meta.divisor);
    };
    return {
      scale,
      setScale,
      meta,
      scaleAmount,
      format: (n) => formatINRWhole(scaleAmount(n)),
      suffix: meta.suffix,
    };
  }, [scale, engagementId]);

  return <FsUnitsContext.Provider value={value}>{children}</FsUnitsContext.Provider>;
}

export function useFsUnits(): FsUnitsContextValue {
  const ctx = useContext(FsUnitsContext);
  if (!ctx) {
    // Safe fallback when consumed outside the provider — render as whole INR.
    return {
      scale: "actual",
      setScale: () => { /* noop */ },
      meta: FS_SCALES[0],
      scaleAmount: (n) => Math.round(Number(n) || 0),
      format: (n) => formatINRWhole(n),
      suffix: FS_SCALES[0].suffix,
    };
  }
  return ctx;
}

/**
 * <FsUnitsToggle /> — a compact 4-button group for the FS toolbar.
 */
export function FsUnitsToggle({ className }: { className?: string }) {
  const { scale, setScale } = useFsUnits();
  return (
    <div className={"inline-flex rounded-md border overflow-hidden " + (className ?? "")}>
      {FS_SCALES.map(s => {
        const active = s.key === scale;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => setScale(s.key)}
            className={
              "px-2.5 py-1.5 text-[11px] font-medium transition-colors border-r last:border-r-0 " +
              (active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/60")
            }
            title={`Display all FS figures ${s.label === "Actual" ? "as actual rupees" : `in ${s.label.replace("Rs. in ","")}`}`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
