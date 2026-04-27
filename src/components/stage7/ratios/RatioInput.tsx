/**
 * RatioInput — shared editable number cell for Ratios sub-tabs.
 *
 * Behaviour:
 *   - Click to enter edit mode; blur/Enter to commit.
 *   - Displays amount in Indian locale (1,23,45,678) or "–" when null.
 *   - isAuto=true  → blue tint + "(auto)" badge while not overridden.
 *   - isOverridden → amber tint + "× Reset" button (calls onReset).
 *   - readOnly=true → display-only, no interaction.
 */

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const IND_FMT = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatIndian(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return IND_FMT.format(v);
}

interface RatioInputProps {
  value:       number | null;
  onChange?:   (v: number | null) => void;
  onReset?:    () => void;
  isAuto?:     boolean;   // field populated by auto-link (shows blue badge)
  isOverridden?: boolean; // user has manually edited this auto-linkable field
  readOnly?:   boolean;
  className?:  string;
  placeholder?: string;
}

export function RatioInput({
  value,
  onChange,
  onReset,
  isAuto       = false,
  isOverridden = false,
  readOnly     = false,
  className,
  placeholder  = "Enter amount",
}: RatioInputProps) {
  const [editing, setEditing]       = useState(false);
  const [raw, setRaw]               = useState("");
  const inputRef                     = useRef<HTMLInputElement>(null);

  // Sync raw when external value changes while not editing
  useEffect(() => {
    if (!editing) setRaw(value != null ? String(value) : "");
  }, [value, editing]);

  const startEdit = () => {
    if (readOnly || !onChange) return;
    setRaw(value != null ? String(value) : "");
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (!onChange) return;
    const trimmed = raw.trim().replace(/,/g, "");
    if (trimmed === "" || trimmed === "–") {
      onChange(null);
    } else {
      const n = parseFloat(trimmed);
      onChange(Number.isFinite(n) ? n : null);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setEditing(false); }
  };

  // Determine visual state
  const isAutoActive = isAuto && !isOverridden;

  const containerCls = cn(
    "relative flex items-center justify-end gap-1 rounded px-1.5 py-0.5 text-right text-xs font-mono tabular-nums select-none min-w-[90px]",
    isAutoActive  && "bg-blue-50  ring-1 ring-blue-200",
    isOverridden  && "bg-amber-50 ring-1 ring-amber-300",
    !isAutoActive && !isOverridden && "bg-transparent",
    readOnly && "cursor-default",
    !readOnly && onChange && "cursor-text hover:ring-1 hover:ring-primary/40",
    className,
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        placeholder={placeholder}
        className={cn(
          "w-full min-w-[90px] rounded border border-primary px-1.5 py-0.5",
          "text-right text-xs font-mono tabular-nums",
          "focus:outline-none focus:ring-2 focus:ring-primary/40",
          isAutoActive  && "bg-blue-50",
          isOverridden  && "bg-amber-50",
        )}
      />
    );
  }

  return (
    <div className={containerCls} onClick={startEdit}>
      <span>{formatIndian(value)}</span>

      {isAutoActive && (
        <span className="ml-1 rounded bg-blue-100 px-1 py-0 text-[9px] font-semibold text-blue-600 leading-tight shrink-0">
          auto
        </span>
      )}

      {isOverridden && onReset && (
        <button
          type="button"
          title="Reset to auto-populated value"
          onClick={(e) => { e.stopPropagation(); onReset(); }}
          className="ml-0.5 rounded p-0.5 text-amber-600 hover:bg-amber-100 shrink-0"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}
