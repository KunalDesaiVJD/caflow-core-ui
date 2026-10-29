import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface PickableClient {
  id: string;
  name: string;
  /** Net closing balance across firms (Dr positive) — shown beside the name. */
  closing?: number;
}

const fmt = (n: number) => Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Tick which clients of a group go into the statement (download, email or WhatsApp).
 * Tracks the clients left OUT, so every client — including one added later — starts ticked.
 */
export function GroupClientPicker({ clients, excluded, onChange, className }: {
  clients: PickableClient[];
  excluded: Set<string>;
  onChange: (next: Set<string>) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const picked = clients.filter(c => !excluded.has(c.id)).length;
  const allOn = picked === clients.length;
  if (clients.length === 0) return null;

  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  return (
    <div className={cn("rounded-md border", className)}>
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Checkbox id="gcp-all" checked={allOn ? true : picked === 0 ? false : "indeterminate"}
          onCheckedChange={v => onChange(v === true ? new Set() : new Set(clients.map(c => c.id)))} />
        <label htmlFor="gcp-all" className="text-xs font-medium cursor-pointer">
          Clients in statement: {picked} of {clients.length}
        </label>
        <button type="button" onClick={() => setOpen(o => !o)}
          className="ml-auto flex items-center gap-0.5 text-[11px] text-primary hover:underline">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{open ? "Hide" : "Choose clients"}
        </button>
      </div>
      {open && (
        <div className="max-h-48 overflow-y-auto border-t px-2.5 py-1.5 space-y-1">
          {clients.map(c => (
            <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={!excluded.has(c.id)} onCheckedChange={() => toggle(c.id)} />
              <span className="truncate flex-1">{c.name}</span>
              {c.closing !== undefined && (
                <span className={cn("font-mono text-[11px]", c.closing > 0.005 ? "text-red-600" : "text-muted-foreground")}>
                  {Math.abs(c.closing) < 0.005 ? "Nil" : `₹${fmt(c.closing)} ${c.closing > 0 ? "Dr" : "Cr"}`}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      {picked === 0 && <p className="px-2.5 pb-1.5 text-[11px] text-destructive">Tick at least one client.</p>}
    </div>
  );
}
