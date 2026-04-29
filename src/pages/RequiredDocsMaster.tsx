/**
 * RequiredDocsMaster — firm-scoped CRUD for the Required Documents dropdown
 * used in the audit Query Sheet.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRequiredDocsMaster, RequiredDocMaster } from "@/hooks/useRequiredDocsMaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Sparkles, Loader2 } from "lucide-react";

const CATEGORIES = ["Bank", "Tax", "GST", "TDS", "Audit", "Statutory", "Other"];

interface DraftRow {
  id?:          string;
  doc_name:     string;
  description:  string;
  category:     string;
  is_active:    boolean;
  sort_order:   number;
}

const blank: DraftRow = {
  doc_name: "", description: "", category: "Other", is_active: true, sort_order: 0,
};

interface RDMProps { embedded?: boolean }
export default function RequiredDocsMaster({ embedded = false }: RDMProps) {
  const { firmId, rows, loading, refresh, seedDefaults } = useRequiredDocsMaster();
  const { toast } = useToast();
  const [busy, setBusy]     = useState(false);
  const [open, setOpen]     = useState(false);
  const [draft, setDraft]   = useState<DraftRow>(blank);
  const [search, setSearch] = useState("");

  const filtered = rows.filter(r =>
    !search.trim() || r.doc_name.toLowerCase().includes(search.toLowerCase()),
  );

  const startNew = () => {
    setDraft({ ...blank, sort_order: rows.length });
    setOpen(true);
  };

  const startEdit = (r: RequiredDocMaster) => {
    setDraft({
      id: r.id, doc_name: r.doc_name, description: r.description ?? "",
      category: r.category ?? "Other", is_active: r.is_active, sort_order: r.sort_order,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!firmId)              { toast({ title: "No firm context", variant: "destructive" }); return; }
    if (!draft.doc_name.trim()) { toast({ title: "Document name is required", variant: "destructive" }); return; }
    setBusy(true);
    const payload = {
      firm_id:     firmId,
      doc_name:    draft.doc_name.trim(),
      description: draft.description.trim() || null,
      category:    draft.category || null,
      is_active:   draft.is_active,
      sort_order:  draft.sort_order,
    };
    const op = draft.id
      ? (supabase as any).from("required_documents_master").update(payload).eq("id", draft.id)
      : (supabase as any).from("required_documents_master").insert(payload);
    const { error } = await op;
    setBusy(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: draft.id ? "Updated" : "Added" });
    setOpen(false);
    await refresh();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const { error } = await (supabase as any)
      .from("required_documents_master").delete().eq("id", id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Deleted" });
    await refresh();
  };

  const toggleActive = async (r: RequiredDocMaster) => {
    const { error } = await (supabase as any)
      .from("required_documents_master")
      .update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    await refresh();
  };

  return (
    <div className={embedded ? "space-y-4" : "p-6 space-y-4 max-w-5xl mx-auto"}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold">Required Documents Master</h1>
            <p className="text-sm text-muted-foreground">
              Curate the document list shown in the Query Sheet "Required Documents" dropdown.
            </p>
          </div>
        )}
        {embedded && (
          <div>
            <p className="text-sm text-muted-foreground">
              Curate the document list shown in the Query Sheet "Required Documents" dropdown.
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          {rows.length === 0 && !loading && (
            <Button variant="outline" onClick={async () => { setBusy(true); await seedDefaults(); setBusy(false); }} disabled={busy}>
              <Sparkles className="mr-2 h-4 w-4" /> Seed default list
            </Button>
          )}
          <Button onClick={startNew}>
            <Plus className="mr-2 h-4 w-4" /> Add Document
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">
              {loading ? "Loading…" : `${rows.length} document${rows.length === 1 ? "" : "s"}`}
            </CardTitle>
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search documents…" className="max-w-xs" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {rows.length === 0
                ? "No documents yet. Click \"Seed default list\" to start with the standard 20 templates, or add your own."
                : "No documents match your search."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24 text-center">Active</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, i) => (
                  <TableRow key={r.id} className={!r.is_active ? "opacity-60" : ""}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{r.doc_name}</TableCell>
                    <TableCell>
                      {r.category ? <Badge variant="outline">{r.category}</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-md truncate">
                      {r.description || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(r.id, r.doc_name)}
                        className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[480px] sm:w-[520px]">
          <SheetHeader>
            <SheetTitle>{draft.id ? "Edit Document" : "Add Document"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Document name *</Label>
              <Input value={draft.doc_name}
                onChange={e => setDraft(d => ({ ...d, doc_name: e.target.value }))}
                placeholder="e.g. Bank Statement" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <select value={draft.category}
                onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Input value={draft.description}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                placeholder="Short hint shown to staff" />
            </div>
            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input type="number" value={draft.sort_order}
                onChange={e => setDraft(d => ({ ...d, sort_order: Number(e.target.value) || 0 }))} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">Inactive items are hidden from the dropdown.</p>
              </div>
              <Switch checked={draft.is_active}
                onCheckedChange={v => setDraft(d => ({ ...d, is_active: v }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={save} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {draft.id ? "Save changes" : "Add document"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
