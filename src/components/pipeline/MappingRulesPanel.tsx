/**
 * MappingRulesPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Slide-in sheet for managing manual COA mapping instructions.
 * Rules are stored in `coa_mapping_rules` and applied before any AI/heuristic
 * logic during auto-mapping — they represent the firm's institutional knowledge.
 *
 * Each rule:
 *   match_type  : contains | exact | starts_with | ends_with | tally_group
 *   match_value : the pattern (case-insensitive)
 *   fs_code     : the FS line-item code to map to
 *   priority    : higher = applied first (default 10)
 *   note        : optional explanation
 *   client_id   : NULL = applies to ALL clients in the firm
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, BookOpen, Loader2, ArrowUpDown } from "lucide-react";
import type { FSLineItem } from "@/config/nceLineItems";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MappingRule {
  id: string;
  firm_id: string;
  client_id: string | null;
  entity_type: string | null;
  match_type: "contains" | "exact" | "starts_with" | "ends_with" | "tally_group";
  match_value: string;
  fs_code: string;
  fs_name: string | null;
  note: string | null;
  priority: number;
  active: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  firmId: string;
  clientId: string;
  entityType: "corporate" | "nce";
  leafItems: FSLineItem[];
  onRulesChange: (rules: MappingRule[]) => void;
}

const MATCH_LABELS: Record<MappingRule["match_type"], string> = {
  contains:    "Contains",
  exact:       "Exact match",
  starts_with: "Starts with",
  ends_with:   "Ends with",
  tally_group: "Tally group =",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function MappingRulesPanel({
  open, onClose, firmId, clientId, entityType, leafItems, onRulesChange,
}: Props) {
  const [rules, setRules]     = useState<MappingRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [editId, setEditId]   = useState<string | null>(null);

  // New-rule form state
  const [matchType,  setMatchType]  = useState<MappingRule["match_type"]>("contains");
  const [matchValue, setMatchValue] = useState("");
  const [fsCode,     setFsCode]     = useState("");
  const [note,       setNote]       = useState("");
  const [priority,   setPriority]   = useState(10);
  const [allClients, setAllClients] = useState(true);

  // ── Load rules ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !firmId) return;
    setLoading(true);
    (supabase as any)
      .from("coa_mapping_rules")
      .select("*")
      .eq("firm_id", firmId)
      .eq("active", true)
      .or(`client_id.is.null,client_id.eq.${clientId}`)
      .order("priority", { ascending: false })
      .then(({ data, error }: any) => {
        setLoading(false);
        if (!error && data) {
          setRules(data as MappingRule[]);
          onRulesChange(data as MappingRule[]);
        }
      });
  }, [open, firmId, clientId]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetForm = () => {
    setMatchType("contains"); setMatchValue(""); setFsCode("");
    setNote(""); setPriority(10); setAllClients(true); setEditId(null);
  };

  const fsName = (code: string) =>
    leafItems.find(i => i.code === code)?.name || code;

  // ── Add / Update rule ─────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!matchValue.trim()) { toast.error("Pattern is required"); return; }
    if (!fsCode)            { toast.error("Select a target account"); return; }
    setSaving(true);

    const payload = {
      firm_id:     firmId,
      client_id:   allClients ? null : clientId,
      entity_type: entityType,
      match_type:  matchType,
      match_value: matchValue.trim().toLowerCase(),
      fs_code:     fsCode,
      fs_name:     fsName(fsCode),
      note:        note.trim() || null,
      priority,
      active:      true,
    };

    let error: any;
    let updated: MappingRule[] = [...rules];

    if (editId) {
      const { error: e } = await (supabase as any)
        .from("coa_mapping_rules")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", editId);
      error = e;
      if (!e) {
        updated = updated.map(r => r.id === editId ? { ...r, ...payload } as MappingRule : r);
      }
    } else {
      const { data: row, error: e } = await (supabase as any)
        .from("coa_mapping_rules")
        .insert(payload)
        .select()
        .single();
      error = e;
      if (!e && row) updated = [row as MappingRule, ...updated];
    }

    setSaving(false);
    if (error) { toast.error("Save failed: " + error.message); return; }
    setRules(updated);
    onRulesChange(updated);
    resetForm();
    toast.success(editId ? "Rule updated" : "Rule added — re-run auto-mapping to apply");
  };

  // ── Delete rule ───────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    const { error } = await (supabase as any)
      .from("coa_mapping_rules").delete().eq("id", id);
    if (error) { toast.error("Delete failed"); return; }
    const updated = rules.filter(r => r.id !== id);
    setRules(updated);
    onRulesChange(updated);
    toast.success("Rule deleted");
  };

  // ── Toggle active ──────────────────────────────────────────────────────────
  const handleToggle = async (id: string, active: boolean) => {
    await (supabase as any)
      .from("coa_mapping_rules").update({ active }).eq("id", id);
    const updated = rules.map(r => r.id === id ? { ...r, active } : r);
    setRules(updated);
    onRulesChange(updated.filter(r => r.active));
  };

  // ── Load rule into form for editing ───────────────────────────────────────
  const startEdit = (r: MappingRule) => {
    setEditId(r.id);
    setMatchType(r.match_type);
    setMatchValue(r.match_value);
    setFsCode(r.fs_code);
    setNote(r.note || "");
    setPriority(r.priority);
    setAllClients(r.client_id === null);
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { onClose(); resetForm(); } }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Mapping Instructions
          </SheetTitle>
          <SheetDescription>
            Rules defined here are applied <strong>first</strong>, before AI or heuristics.
            They represent your firm's permanent institutional mapping knowledge.
          </SheetDescription>
        </SheetHeader>

        <Separator className="my-4" />

        {/* ── Add / Edit form ── */}
        <div className="space-y-3 bg-muted/40 rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-foreground">
            {editId ? "Edit Rule" : "Add New Rule"}
          </p>

          {/* Row 1: match type + pattern */}
          <div className="flex gap-2">
            <div className="w-44 shrink-0">
              <Label className="text-xs mb-1 block">Match type</Label>
              <Select value={matchType} onValueChange={v => setMatchType(v as any)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MATCH_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label className="text-xs mb-1 block">
                {matchType === "tally_group" ? "Tally group name" : "Ledger name pattern"}
              </Label>
              <Input
                className="h-8 text-xs"
                placeholder={matchType === "tally_group" ? "e.g. Sundry Debtors" : "e.g. commission"}
                value={matchValue}
                onChange={e => setMatchValue(e.target.value)}
              />
            </div>
          </div>

          {/* Row 2: target FS code + priority */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs mb-1 block">Map to account</Label>
              <Select value={fsCode} onValueChange={setFsCode}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select FS line item…" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {leafItems.map(i => (
                    <SelectItem key={i.code} value={i.code} className="text-xs">
                      <span className="font-mono text-muted-foreground mr-2">{i.code}</span>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-20 shrink-0">
              <Label className="text-xs mb-1 block">Priority</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                min={1} max={100}
                value={priority}
                onChange={e => setPriority(parseInt(e.target.value) || 10)}
              />
            </div>
          </div>

          {/* Row 3: note + scope */}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs mb-1 block">Note / reason (optional)</Label>
              <Input
                className="h-8 text-xs"
                placeholder="e.g. Commission income is always Other Income for this firm"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5 pb-0.5 shrink-0">
              <Switch checked={allClients} onCheckedChange={setAllClients} className="scale-75" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                All clients
              </span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {editId ? "Update Rule" : "Add Rule"}
            </Button>
            {editId && (
              <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
            )}
          </div>
        </div>

        {/* ── Rules list ── */}
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            No rules yet. Add your first mapping instruction above.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {rules.length} rule{rules.length !== 1 ? "s" : ""}
              </p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowUpDown className="w-3 h-3" /> sorted by priority
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="py-2">Pattern</TableHead>
                  <TableHead className="py-2">Maps to</TableHead>
                  <TableHead className="py-2 w-16 text-center">Prio</TableHead>
                  <TableHead className="py-2 w-16 text-center">Active</TableHead>
                  <TableHead className="py-2 w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rules].sort((a, b) => b.priority - a.priority).map(r => (
                  <TableRow key={r.id} className={!r.active ? "opacity-40" : ""}>
                    <TableCell className="py-2 text-xs">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                            {MATCH_LABELS[r.match_type]}
                          </Badge>
                          <span className="font-medium">"{r.match_value}"</span>
                        </div>
                        {r.note && (
                          <span className="text-muted-foreground text-[10px]">{r.note}</span>
                        )}
                        {!r.client_id ? (
                          <span className="text-[10px] text-blue-500">All clients</span>
                        ) : (
                          <span className="text-[10px] text-amber-600">This client only</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-primary">{r.fs_name || r.fs_code}</span>
                        <span className="text-muted-foreground font-mono text-[10px]">{r.fs_code}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-center text-xs font-mono">
                      {r.priority}
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      <Switch
                        checked={r.active}
                        onCheckedChange={v => handleToggle(r.id, v)}
                        className="scale-75"
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEdit(r)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="mt-6 pt-4 border-t">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong>How rules work:</strong> Applied in priority order (highest first) before any AI or
            heuristic mapping. Use <em>Contains</em> for partial name matches, <em>Tally group</em> to map
            entire Tally parent groups. Changes take effect the next time you run auto-mapping or reset & remap.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
