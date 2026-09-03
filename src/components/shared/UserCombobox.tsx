/**
 * UserCombobox — strict-selection searchable user picker.
 *
 * Originally lived in the Audit Tracker module (AuditStatusRow.tsx) and was
 * promoted here once the ITR module needed the exact same "pick a real
 * user, never free text" combobox for its own upload-confirmation dialog.
 *
 * STRICT selection-only: the committed value can ONLY ever be a real user's
 * name from the list, or empty. The text box is a search filter, not a
 * free-text field — typing narrows the list but does not by itself become
 * the value. A name is committed only when picked (mouse / Enter). On blur,
 * if the typed text doesn't exactly match a user, the box reverts to the
 * last committed value, so stray typing can never be saved.
 *
 * Keyboard nav: ArrowDown/ArrowUp move the highlight, Enter selects, Escape
 * closes; highlight auto-scrolls into view.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboUser {
  id: string;
  name: string;
}

export function UserCombobox({ value, onChange, users, placeholder }: {
  value: string; onChange: (v: string) => void;
  users: ComboUser[]; placeholder?: string;
}) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState(value);   // local search text
  const [highlight, setHighlight] = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 120 });
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef  = useRef<HTMLDivElement>(null);

  // Keep the local query in sync when the committed value changes externally
  // (e.g. row reset / load). Only sync when the box isn't being edited.
  useEffect(() => { if (!open) setQuery(value); }, [value, open]);

  const filtered = useMemo(() =>
    (query
      ? users.filter(u => u.name.toLowerCase().includes(query.toLowerCase()))
      : users
    ).slice(0, 15),
    [query, users]
  );

  useEffect(() => { setHighlight(0); }, [query, users]);

  useEffect(() => {
    if (!open || !dropRef.current) return;
    const el = dropRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function handleFocus() {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom, left: r.left, width: Math.max(r.width, 120) });
    }
    setOpen(true);
  }

  // Commit a valid pick; otherwise revert the box to the committed value.
  function selectUser(name: string) {
    onChange(name);
    setQuery(name);
    setOpen(false);
  }
  function handleBlur() {
    setTimeout(() => {
      setOpen(false);
      // STRICT: only an exact (case-insensitive) match may persist.
      const exact = users.find(u => u.name.toLowerCase() === query.trim().toLowerCase());
      if (exact) { if (exact.name !== value) onChange(exact.name); setQuery(exact.name); }
      else if (query.trim() === "") { if (value !== "") onChange(""); setQuery(""); }
      else { setQuery(value); } // typed something not in the list → discard
    }, 160);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      const pick = filtered[Math.min(highlight, filtered.length - 1)];
      if (pick) selectUser(pick.name);
    } else if (e.key === "Escape") {
      setQuery(value); // discard in-progress typing
      setOpen(false);
    }
  }

  return (
    <div className="min-w-[100px]">
      <Input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Select…"}
        className="h-6 text-[11px] px-1.5 w-full"
      />
      {open && filtered.length > 0 && (
        <div
          ref={dropRef}
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-popover border rounded-md shadow-lg max-h-40 overflow-auto"
        >
          {filtered.map((u, i) => (
            <div
              key={u.id}
              data-idx={i}
              onMouseDown={e => { e.preventDefault(); selectUser(u.name); }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "px-2 py-1.5 text-[11px] cursor-pointer",
                i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              {u.name}
            </div>
          ))}
        </div>
      )}
      {/* When the user has typed something that matches nothing, show a hint */}
      {open && query.trim() !== "" && filtered.length === 0 && (
        <div
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-popover border rounded-md shadow-lg px-2 py-1.5 text-[10px] text-muted-foreground italic"
        >
          No match — pick a name from the list
        </div>
      )}
    </div>
  );
}
