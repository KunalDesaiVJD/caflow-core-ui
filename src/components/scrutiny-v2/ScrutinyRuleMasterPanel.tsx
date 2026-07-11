/**
 * Rule Master (Super Admin only) — full CRUD over the scrutiny_rules catalogue.
 *
 * View / add / modify / enable-disable / delete rules, with multi-select bulk actions, search +
 * filter + sort, and per-rule audit history. Writes go straight to scrutiny_rules; RLS enforces
 * superadmin-only INSERT/UPDATE/DELETE and the DB trigger (migration 20260711120000) records every
 * change in scrutiny_rule_audit. The engine reads is_active rules live on each Run Scrutiny, so any
 * change here is picked up automatically on the next run — no cache, no manual step.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, History, Search, ArrowUpDown, Power, Loader2, ShieldAlert } from "lucide-react";
import { TIER_A_CHECK_KINDS, TIER_B_CHECK_KINDS } from "@/lib/scrutiny/detectionEngine";

interface RuleRow {
  id: string;
  rule_id: string;
  rule_name: string;
  category: string;
  detection_level: string;
  detection_logic: Record<string, unknown> | null;
  threshold_type: string | null;
  threshold_value: number | null;
  audit_query_template: string | null;
  severity: string;
  legal_reference: string | null;
  prior_year_needed: boolean | null;
  is_active: boolean;
  root_cause: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  changed_at: string;
  changed_by_name: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const SUPPORTED_CHECKS = [...TIER_A_CHECK_KINDS, ...TIER_B_CHECK_KINDS];
const SEVERITIES = ["high", "medium", "low"];
const LEVELS = ["account", "voucher"];

type SortKey = "rule_id" | "rule_name" | "category" | "severity" | "detection_level" | "is_active";

const sevBadge = (s: string) =>
  s === "high" ? "bg-destructive/15 text-destructive border-destructive/40"
  : s === "medium" ? "bg-amber-500/15 text-amber-700 border-amber-300"
  : "bg-muted text-muted-foreground border-muted-foreground/30";

const checkOf = (r: RuleRow): string => String(r.detection_logic?.["check"] ?? "—");

const emptyForm = () => ({
  id: "",
  rule_id: "",
  rule_name: "",
  category: "",
  detection_level: "account",
  logicText: '{\n  "check": "keyword_balance"\n}',
  threshold_type: "absolute",
  threshold_value: "0",
  severity: "medium",
  legal_reference: "",
  audit_query_template: "",
  prior_year_needed: false,
  is_active: true,
});

export default function ScrutinyRuleMasterPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("all");
  const [fSev, setFSev] = useState("all");
  const [fLevel, setFLevel] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("rule_id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [isNew, setIsNew] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRule, setHistoryRule] = useState<RuleRow | null>(null);
  const [historyRows, setHistoryRows] = useState<AuditRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchRules = async () => {
    setLoading(true);
    const { data, error } = await (supabase.from as any)("scrutiny_rules").select("*").order("rule_id");
    if (error) toast({ title: "Could not load rules", description: error.message, variant: "destructive" });
    setRows(Array.isArray(data) ? (data as RuleRow[]) : []);
    setLoading(false);
  };

  useEffect(() => { fetchRules(); }, []);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);

  const view = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (ql && !(`${r.rule_id} ${r.rule_name} ${r.category} ${checkOf(r)}`.toLowerCase().includes(ql))) return false;
      if (fCat !== "all" && r.category !== fCat) return false;
      if (fSev !== "all" && r.severity !== fSev) return false;
      if (fLevel !== "all" && r.detection_level !== fLevel) return false;
      if (fStatus === "active" && !r.is_active) return false;
      if (fStatus === "inactive" && r.is_active) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av = sortKey === "is_active" ? (a.is_active ? 1 : 0) : String(a[sortKey] ?? "");
      const bv = sortKey === "is_active" ? (b.is_active ? 1 : 0) : String(b[sortKey] ?? "");
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return out;
  }, [rows, q, fCat, fSev, fLevel, fStatus, sortKey, sortDir]);

  const allVisibleSelected = view.length > 0 && view.every((r) => selected.has(r.id));
  const toggleSelectAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(view.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const sortBy = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const openNew = () => { setForm(emptyForm()); setIsNew(true); setEditOpen(true); };
  const openEdit = (r: RuleRow) => {
    setForm({
      id: r.id,
      rule_id: r.rule_id,
      rule_name: r.rule_name,
      category: r.category,
      detection_level: r.detection_level || "account",
      logicText: JSON.stringify(r.detection_logic ?? {}, null, 2),
      threshold_type: r.threshold_type || "absolute",
      threshold_value: String(r.threshold_value ?? 0),
      severity: r.severity || "medium",
      legal_reference: r.legal_reference ?? "",
      audit_query_template: r.audit_query_template ?? "",
      prior_year_needed: !!r.prior_year_needed,
      is_active: r.is_active,
    });
    setIsNew(false);
    setEditOpen(true);
  };

  const setCheckKind = (kind: string) => {
    let obj: Record<string, unknown> = {};
    try { obj = JSON.parse(form.logicText || "{}"); } catch { obj = {}; }
    obj.check = kind;
    setForm((f) => ({ ...f, logicText: JSON.stringify(obj, null, 2) }));
  };

  const saveRule = async () => {
    if (!form.rule_id.trim() || !form.rule_name.trim() || !form.category.trim()) {
      toast({ title: "Missing fields", description: "Rule ID, Name and Category are required.", variant: "destructive" });
      return;
    }
    let logic: Record<string, unknown>;
    try {
      logic = JSON.parse(form.logicText || "{}");
    } catch {
      toast({ title: "Invalid detection logic", description: "Detection logic must be valid JSON.", variant: "destructive" });
      return;
    }
    if (!logic.check || typeof logic.check !== "string") {
      toast({ title: "Detection logic needs a check", description: 'Add a "check" field naming the check kind.', variant: "destructive" });
      return;
    }
    if (!SUPPORTED_CHECKS.includes(logic.check as string)) {
      toast({
        title: "Unsupported check kind",
        description: `"${logic.check}" has no engine handler — the rule will be saved but only surface as advisory (manual review), not auto-detected.`,
      });
    }
    setSaving(true);
    const payload = {
      rule_id: form.rule_id.trim(),
      rule_name: form.rule_name.trim(),
      category: form.category.trim().toUpperCase(),
      detection_level: form.detection_level,
      detection_logic: logic,
      threshold_type: form.threshold_type || "absolute",
      threshold_value: Number(form.threshold_value) || 0,
      severity: form.severity,
      legal_reference: form.legal_reference.trim() || null,
      audit_query_template: form.audit_query_template.trim() || null,
      prior_year_needed: form.prior_year_needed,
      is_active: form.is_active,
    };
    const res = isNew
      ? await (supabase.from as any)("scrutiny_rules").insert(payload)
      : await (supabase.from as any)("scrutiny_rules").update(payload).eq("id", form.id);
    setSaving(false);
    if (res.error) {
      toast({ title: isNew ? "Add failed" : "Update failed", description: res.error.message, variant: "destructive" });
      return;
    }
    toast({ title: isNew ? "Rule added" : "Rule updated", description: `${payload.rule_id} — ${payload.rule_name}` });
    setEditOpen(false);
    await fetchRules();
  };

  const doSetActive = async (ids: string[], active: boolean) => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    const { error } = await (supabase.from as any)("scrutiny_rules").update({ is_active: active }).in("id", ids);
    setBulkBusy(false);
    if (error) { toast({ title: "Action failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: active ? "Rules enabled" : "Rules disabled", description: `${ids.length} rule(s) updated.` });
    setSelected(new Set());
    await fetchRules();
  };

  const confirmDelete = (ids: string[]) => { setDeleteIds(ids); setDeleteOpen(true); };
  const doDelete = async () => {
    setBulkBusy(true);
    const { error } = await (supabase.from as any)("scrutiny_rules").delete().in("id", deleteIds);
    setBulkBusy(false);
    setDeleteOpen(false);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Rules deleted", description: `${deleteIds.length} rule(s) removed.` });
    setSelected(new Set());
    setDeleteIds([]);
    await fetchRules();
  };

  const openHistory = async (r: RuleRow) => {
    setHistoryRule(r); setHistoryOpen(true); setHistoryLoading(true); setHistoryRows([]);
    const { data } = await (supabase.from as any)("scrutiny_rule_audit")
      .select("id, action, changed_at, changed_by_name, before, after")
      .eq("rule_id", r.rule_id).order("changed_at", { ascending: false }).limit(100);
    setHistoryRows(Array.isArray(data) ? (data as AuditRow[]) : []);
    setHistoryLoading(false);
  };

  const diffFields = (a: AuditRow): string => {
    if (a.action === "insert") return "created";
    if (a.action === "delete") return "deleted";
    if (!a.before || !a.after) return a.action;
    const changed = Object.keys(a.after).filter((k) => JSON.stringify(a.after?.[k]) !== JSON.stringify(a.before?.[k]) && k !== "updated_at" && k !== "rules_version");
    return changed.length ? changed.join(", ") : "—";
  };

  const selectedIds = [...selected];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rule id / name / check…" className="h-9 w-64 pl-7" />
        </div>
        <Select value={fCat} onValueChange={setFCat}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fSev} onValueChange={setFSev}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All severity</SelectItem>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fLevel} onValueChange={setFLevel}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Level" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All levels</SelectItem>{LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All status</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{view.length} of {rows.length}</span>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add rule</Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => doSetActive(selectedIds, true)}><Power className="h-3.5 w-3.5 mr-1" />Enable</Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => doSetActive(selectedIds, false)}><Power className="h-3.5 w-3.5 mr-1" />Disable</Button>
          <Button size="sm" variant="outline" className="text-destructive" disabled={bulkBusy} onClick={() => confirmDelete(selectedIds)}><Trash2 className="h-3.5 w-3.5 mr-1" />Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"><Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" /></TableHead>
              {([["rule_id", "Rule ID"], ["rule_name", "Name"], ["category", "Category"], ["severity", "Severity"], ["detection_level", "Level"]] as [SortKey, string][]).map(([k, label]) => (
                <TableHead key={k}><button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => sortBy(k)}>{label}<ArrowUpDown className="h-3 w-3 opacity-50" /></button></TableHead>
              ))}
              <TableHead>Check</TableHead>
              <TableHead className="text-right">Threshold</TableHead>
              <TableHead><button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => sortBy("is_active")}>Status<ArrowUpDown className="h-3 w-3 opacity-50" /></button></TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
            ) : view.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No rules match the filters.</TableCell></TableRow>
            ) : view.map((r) => (
              <TableRow key={r.id} className={selected.has(r.id) ? "bg-muted/40" : undefined}>
                <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} aria-label={`Select ${r.rule_id}`} /></TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap">{r.rule_id}</TableCell>
                <TableCell className="text-sm max-w-[280px] truncate" title={r.rule_name}>{r.rule_name}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{r.category}</Badge></TableCell>
                <TableCell><Badge variant="outline" className={`text-xs ${sevBadge(r.severity)}`}>{r.severity}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.detection_level}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{checkOf(r)}</TableCell>
                <TableCell className="text-right text-xs">{r.threshold_value ?? "—"}</TableCell>
                <TableCell>
                  {r.is_active
                    ? <Badge variant="outline" className="text-xs bg-green-500/15 text-green-700 border-green-300">Active</Badge>
                    : <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">Disabled</Badge>}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title={r.is_active ? "Disable" : "Enable"} onClick={() => doSetActive([r.id], !r.is_active)}><Power className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="History" onClick={() => openHistory(r)}><History className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete" onClick={() => confirmDelete([r.id])}><Trash2 className="h-3.5 w-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "Add rule" : `Edit ${form.rule_id}`}</DialogTitle>
            <DialogDescription>Changes apply on the next Run Scrutiny. Every change is recorded in the rule's history.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Rule ID</Label>
              <Input value={form.rule_id} disabled={!isNew} onChange={(e) => setForm((f) => ({ ...f, rule_id: e.target.value }))} placeholder="e.g. CASH-008" />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. CASH" list="rm-cats" />
              <datalist id="rm-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Rule name</Label>
              <Input value={form.rule_name} onChange={(e) => setForm((f) => ({ ...f, rule_name: e.target.value }))} placeholder="Short human title" />
            </div>
            <div className="space-y-1">
              <Label>Severity</Label>
              <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Detection level</Label>
              <Select value={form.detection_level} onValueChange={(v) => setForm((f) => ({ ...f, detection_level: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Check kind</Label>
              <Select value={String((() => { try { return JSON.parse(form.logicText).check ?? ""; } catch { return ""; } })())} onValueChange={setCheckKind}>
                <SelectTrigger><SelectValue placeholder="Pick a supported check" /></SelectTrigger>
                <SelectContent className="max-h-64">{SUPPORTED_CHECKS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Threshold value</Label>
              <Input type="number" value={form.threshold_value} onChange={(e) => setForm((f) => ({ ...f, threshold_value: e.target.value }))} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Detection logic (JSON)</Label>
              <Textarea value={form.logicText} onChange={(e) => setForm((f) => ({ ...f, logicText: e.target.value }))} className="font-mono text-xs h-28" />
              <p className="text-[11px] text-muted-foreground">Supported checks: {SUPPORTED_CHECKS.join(", ")}</p>
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Audit query template</Label>
              <Textarea value={form.audit_query_template} onChange={(e) => setForm((f) => ({ ...f, audit_query_template: e.target.value }))} className="text-xs h-16" placeholder="Client query drafted when this rule fires. You can use {amount}, {date}." />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Legal reference</Label>
              <Input value={form.legal_reference} onChange={(e) => setForm((f) => ({ ...f, legal_reference: e.target.value }))} placeholder="e.g. s.40A(3)" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.prior_year_needed} onCheckedChange={(v) => setForm((f) => ({ ...f, prior_year_needed: v }))} />
              <Label className="cursor-pointer">Needs prior year</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
              <Label className="cursor-pointer">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveRule} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}{isNew ? "Add rule" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" />Delete {deleteIds.length} rule(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the rule definition(s). Existing findings already raised by these rules are kept.
              Prefer <strong>Disable</strong> if you may want them back — disabling is reversible and keeps the rule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* History */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>History — {historyRule?.rule_id}</DialogTitle>
            <DialogDescription>{historyRule?.rule_name}</DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" /></div>
          ) : historyRows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground text-center">No changes recorded yet.</p>
          ) : (
            <ol className="space-y-2">
              {historyRows.map((a) => (
                <li key={a.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">{a.action}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(a.changed_at).toLocaleString("en-IN")}</span>
                    {a.changed_by_name && <span className="text-xs text-muted-foreground ml-auto">by {a.changed_by_name}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Changed: {diffFields(a)}</p>
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
