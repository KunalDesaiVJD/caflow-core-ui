/**
 * QueryCombobox — Phase 3A
 *
 * Lightweight type-ahead combobox used in the Query Sheet for:
 *   • Group/Subgroup field  (options = TB parent groups)
 *   • Ledger field          (options = TB ledgers filtered by selected group)
 *   • Required Documents    (options = COMMON_REQUIRED_DOCS templates)
 *
 * Controlled: value + onChange.  Free text is also accepted (user can type
 * anything not in the list).  Shows up to 40 suggestions max.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

// ─── Common document templates (Phase 3A) ────────────────────────────────────

export const COMMON_REQUIRED_DOCS: string[] = [
  "Bank Statement",
  "Invoice copy",
  "TDS Certificate (Form 16A)",
  "Sale deed / Agreement",
  "Stock statement",
  "Loan agreement",
  "Board resolution",
  "Salary slips",
  "GST Returns (GSTR-1 / 3B)",
  "Form 26AS",
  "Form AIS / TIS",
  "Depreciation schedule",
  "Fixed Asset Register",
  "Debtors ageing list",
  "Creditors ageing list",
  "Bank reconciliation statement",
  "Cash book / Day book",
  "Journal vouchers with narration",
  "Party confirmation letter",
  "Purchase order",
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  value:        string;
  onChange:     (v: string) => void;
  options:      string[];
  placeholder?: string;
  className?:   string;
  /** When true, shows a small "Tally" badge next to the input to indicate live data */
  isTallyLinked?: boolean;
  disabled?:    boolean;
}

export function QueryCombobox({
  value, onChange, options, placeholder, className, isTallyLinked, disabled,
}: Props) {
  const [open,  setOpen]  = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef      = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const [activeIdx, setActiveIdx] = useState(-1);

  // Sync when external value changes (e.g. from prefill)
  useEffect(() => { setQuery(value); }, [value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options.slice(0, 40);
    const q = query.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(q)).slice(0, 40);
  }, [options, query]);

  // Close when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const select = (opt: string) => {
    onChange(opt);
    setQuery(opt);
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === "Escape") { setOpen(false); setActiveIdx(-1); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < filtered.length) {
        select(filtered[activeIdx]);
      } else {
        // Accept typed free text
        onChange(query);
        setOpen(false);
      }
    }
  };

  // Scroll active option into view
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIdx] as HTMLElement;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onChange={e => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => { setOpen(true); setActiveIdx(-1); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "h-7 px-2 text-xs w-full rounded-md border border-input bg-background",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            isTallyLinked && "pr-12",
            disabled && "opacity-50 cursor-not-allowed",
          )}
          autoComplete="off"
          spellCheck={false}
        />
        {isTallyLinked && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] font-bold
                           text-blue-600 bg-blue-50 border border-blue-200 rounded px-0.5 py-px leading-none
                           pointer-events-none select-none">
            TB
          </span>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-[999] top-full left-0 mt-0.5 w-full min-w-[180px] max-h-48
                     overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
        >
          {filtered.map((opt, idx) => (
            <button
              key={opt}
              type="button"
              onMouseDown={e => { e.preventDefault(); select(opt); }}
              onMouseEnter={() => setActiveIdx(idx)}
              className={cn(
                "w-full text-left px-2.5 py-1.5 text-xs transition-colors",
                idx === activeIdx
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50",
                opt === value && "font-medium",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
