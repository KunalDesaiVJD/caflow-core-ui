/**
 * LedgerMapDialog — the manual ledger-mapping fallback for Form 3CD.
 *
 * When the auto-fill engine can't derive a clause (or the CA disagrees with
 * it), this dialog lets them pick any COA-mapped ledgers from the trial
 * balance and either (a) push the total into an amount field, or (b) insert
 * one row per ledger into a clause table. The selection is recorded as a
 * `LedgerLink` on the clause so the provenance survives saves.
 */

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { ClauseDefinition, AnnexureColumn } from "@/data/form3cd-master";
import type { Form3cdContext, Form3cdLedger } from "@/lib/form3cd/context";
import { fsCodeLabel } from "@/lib/form3cd/fsCatalog";
import { collectClauseTables, setTableRows, type ClauseTable } from "@/lib/form3cd/clauseTables";
import { setLink, type LedgerLink } from "@/lib/form3cd/apply";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

type Target =
  | { kind: "amount"; key: string; label: string }
  | { kind: "rows"; table: ClauseTable };

function firstCol(cols: AnnexureColumn[], types: string[]): AnnexureColumn | undefined {
  return cols.find((c) => types.includes(c.type));
}

export default function LedgerMapDialog({
  open, onClose, definition, value, onChange, context,
}: {
  open: boolean;
  onClose: () => void;
  definition: ClauseDefinition;
  value: any;
  onChange: (next: any) => void;
  context: Form3cdContext;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "PL" | "BS" | "unmapped">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState<string>("");

  const tables = useMemo(() => collectClauseTables(definition, value), [definition, value]);

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    if (definition.control === "amount_remarks" ||
        (definition.control === "single_field" && (definition as any).fieldType === "number")) {
      out.push({ kind: "amount", key: "_value", label: "Set amount field" });
    }
    for (const t of tables) out.push({ kind: "rows", table: t });
    return out;
  }, [definition, tables]);

  // default target = first available
  const activeTarget = useMemo<Target | undefined>(() => {
    if (targetId) {
      if (targetId === "_amount") return targets.find((t) => t.kind === "amount");
      return targets.find((t) => t.kind === "rows" && t.table.id === targetId);
    }
    return targets[0];
  }, [targetId, targets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return context.ledgers.filter((l) => {
      if (filter === "unmapped" && l.code) return false;
      if (filter === "PL" && l.section !== "PL") return false;
      if (filter === "BS" && l.section !== "BS") return false;
      if (!q) return true;
      return l.name.toLowerCase().includes(q) || (l.group || "").toLowerCase().includes(q) || (l.code || "").toLowerCase().includes(q);
    });
  }, [context.ledgers, query, filter]);

  const selectedLedgers = useMemo<Form3cdLedger[]>(
    () => context.ledgers.filter((l) => selected.has(l.name)),
    [context.ledgers, selected],
  );
  const signedSum = useMemo(() => selectedLedgers.reduce((s, l) => s + l.balance, 0), [selectedLedgers]);
  const absSum = Math.round(Math.abs(signedSum) * 100) / 100;

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  function selectAllFiltered() {
    setSelected(new Set(filtered.map((l) => l.name)));
  }

  function apply() {
    if (!activeTarget || selectedLedgers.length === 0) {
      toast.error("Select at least one ledger and a destination.");
      return;
    }
    const link: LedgerLink = {
      field: activeTarget.kind === "amount" ? activeTarget.key : (activeTarget.table.path || "_root"),
      ledgers: selectedLedgers.map((l) => l.name),
      sum: absSum,
      side: signedSum < 0 ? "credit" : "debit",
      linkedAt: new Date().toISOString(),
    };

    if (activeTarget.kind === "amount") {
      const next = setLink({
        ...value,
        _value: absSum,
        _remarks: `Mapped from ${selectedLedgers.length} ledger(s): ${selectedLedgers.map((l) => l.name).join(", ")}`,
      }, link);
      onChange(next);
    } else {
      const t = activeTarget.table;
      const descCol = firstCol(t.columns, ["text"]) || t.columns.find((c) => c.type !== "readonly" && c.type !== "auto_calc");
      const amtCol = firstCol(t.columns, ["numeric"]);
      const existing = t.rows || [];
      const newRows = selectedLedgers.map((l) => {
        const row: Record<string, any> = {};
        if (descCol) row[descCol.key] = l.name;
        if (amtCol) row[amtCol.key] = Math.round(Math.abs(l.balance) * 100) / 100;
        return row;
      });
      const merged = [...existing, ...newRows];
      const srCol = t.columns.find((c) => c.key === "sr_no" && c.type === "readonly");
      if (srCol) merged.forEach((r, i) => { r.sr_no = String(i + 1); });
      const withRows = setTableRows(value, t.path, merged);
      onChange(setLink(withRows, link));
    }
    toast.success(`Mapped ${selectedLedgers.length} ledger(s) — ₹${inr(absSum)}`);
    setSelected(new Set());
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Map ledgers to Clause {definition.clauseNo.replace("_", "-")}</DialogTitle>
          <DialogDescription>
            Pick COA-mapped ledgers from the trial balance. Their total is pushed into the clause —
            use this whenever automation doesn't cover a clause.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input placeholder="Search ledgers, groups or codes…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9" />
          <div className="flex gap-1">
            {(["all", "PL", "BS", "unmapped"] as const).map((f) => (
              <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" className="h-9 px-2 text-xs capitalize" onClick={() => setFilter(f)}>
                {f}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtered.length} ledgers · {context.mappedCount} mapped, {context.unmappedCount} unmapped</span>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={selectAllFiltered}>Select all shown</Button>
        </div>

        <ScrollArea className="h-72 rounded border">
          <div className="divide-y">
            {filtered.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">No ledgers match.</div>
            )}
            {filtered.map((l) => (
              <label key={l.name} className="flex items-center gap-3 px-3 py-1.5 text-sm hover:bg-accent/50 cursor-pointer">
                <Checkbox checked={selected.has(l.name)} onCheckedChange={() => toggle(l.name)} />
                <span className="flex-1 truncate">{l.name}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">{l.code ? fsCodeLabel(l.code) : "Unmapped"}</Badge>
                <span className={`font-mono text-xs w-28 text-right shrink-0 ${l.balance < 0 ? "text-emerald-600" : ""}`}>
                  ₹{inr(Math.abs(l.balance))}{l.balance < 0 ? " Cr" : " Dr"}
                </span>
              </label>
            ))}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between rounded bg-muted/50 px-3 py-2">
          <span className="text-sm">{selectedLedgers.length} selected</span>
          <span className="font-mono font-semibold">₹{inr(absSum)}</span>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Destination:</span>
            <Select
              value={activeTarget ? (activeTarget.kind === "amount" ? "_amount" : activeTarget.table.id) : ""}
              onValueChange={setTargetId}
            >
              <SelectTrigger className="h-8 w-64 text-xs"><SelectValue placeholder="Choose destination" /></SelectTrigger>
              <SelectContent>
                {targets.length === 0 && <SelectItem value="_none" disabled>No mappable destination</SelectItem>}
                {targets.map((t) =>
                  t.kind === "amount"
                    ? <SelectItem key="_amount" value="_amount" className="text-xs">Set amount field</SelectItem>
                    : <SelectItem key={t.table.id} value={t.table.id} className="text-xs">Insert rows → {t.table.label.slice(0, 60)}</SelectItem>,
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={apply} disabled={selectedLedgers.length === 0 || !activeTarget}>Apply mapping</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
