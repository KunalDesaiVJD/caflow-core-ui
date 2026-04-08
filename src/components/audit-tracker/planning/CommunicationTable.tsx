/**
 * CommunicationTable
 * Shows all communication log rows (optionally filtered by selected planning entry).
 * Includes inline "Add Communication" dialog.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Loader2, Save, Trash2 } from "lucide-react";
import type { CommEntry, PlanEntry } from "../hooks/useAuditPlanning";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  comms:         CommEntry[];
  selectedEntry: PlanEntry | null;
  onAdd:         (data: Omit<CommEntry, "id"|"firm_id"|"created_at">) => Promise<void>;
  onRemove:      (id: string) => Promise<void>;
}

const BLANK = {
  planning_id:        null as string | null,
  client_name:        "",
  audit_planned_from: "",
  audit_planned_to:   "",
  contact_person:     "",
  contact_no:         "",
  remarks:            "",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function CommunicationTable({ comms, selectedEntry, onAdd, onRemove }: Props) {
  const [open,   setOpen]   = useState(false);
  const [form,   setForm]   = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const visible = selectedEntry
    ? comms.filter(c => c.planning_id === selectedEntry.id)
    : comms;

  function openDialog() {
    setForm({
      ...BLANK,
      planning_id:        selectedEntry?.id || null,
      client_name:        selectedEntry?.client_name || "",
      audit_planned_from: selectedEntry?.planned_from || "",
      audit_planned_to:   selectedEntry?.planned_to   || "",
    });
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    await onAdd({
      planning_id:        form.planning_id,
      client_name:        form.client_name        || null,
      audit_planned_from: form.audit_planned_from || null,
      audit_planned_to:   form.audit_planned_to   || null,
      contact_person:     form.contact_person     || null,
      contact_no:         form.contact_no         || null,
      remarks:            form.remarks            || null,
    });
    setSaving(false);
    setOpen(false);
  }

  const f = (field: keyof typeof form, val: string) => setForm(p => ({ ...p, [field]: val }));

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-indigo-600 text-white px-4 py-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold">
          Communication Log
          {selectedEntry ? ` — ${selectedEntry.client_name || "selected entry"}` : ""}
        </span>
        <Button size="sm" variant="outline"
          className="h-7 text-xs border-white/40 text-white hover:bg-white/10 gap-1"
          onClick={openDialog}>
          <Plus size={11} /> Add
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-auto">
        <table className="w-full text-xs border-collapse" style={{ minWidth: 700 }}>
          <thead>
            <tr className="bg-indigo-50 text-indigo-800 text-[11px] uppercase tracking-wide">
              <th className="border border-border px-3 py-2 text-left min-w-[140px]">Client Name</th>
              <th className="border border-border px-3 py-2 text-left w-28">From</th>
              <th className="border border-border px-3 py-2 text-left w-28">To</th>
              <th className="border border-border px-3 py-2 text-left min-w-[120px]">Contact Person</th>
              <th className="border border-border px-3 py-2 text-left w-32">Contact No</th>
              <th className="border border-border px-3 py-2 text-left">Remarks</th>
              <th className="border border-border px-2 py-2 text-center w-14">Del</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  {selectedEntry
                    ? "No communications logged for this entry"
                    : "No communications yet — select a plan or add one"}
                </td>
              </tr>
            ) : (
              visible.map(c => (
                <tr key={c.id} className="hover:bg-muted/10 transition-colors">
                  <td className="border border-border px-3 py-2">{c.client_name || "—"}</td>
                  <td className="border border-border px-3 py-2 text-muted-foreground">{c.audit_planned_from || "—"}</td>
                  <td className="border border-border px-3 py-2 text-muted-foreground">{c.audit_planned_to   || "—"}</td>
                  <td className="border border-border px-3 py-2">{c.contact_person || "—"}</td>
                  <td className="border border-border px-3 py-2">{c.contact_no     || "—"}</td>
                  <td className="border border-border px-3 py-2 text-muted-foreground">{c.remarks || "—"}</td>
                  <td className="border border-border px-2 py-2 text-center">
                    {confirmId === c.id ? (
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="destructive" className="h-5 text-[10px] px-1.5"
                          onClick={() => { onRemove(c.id); setConfirmId(null); }}>
                          Yes
                        </Button>
                        <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1"
                          onClick={() => setConfirmId(null)}>
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                        onClick={() => setConfirmId(c.id)}>
                        <Trash2 size={12} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log Communication</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label className="text-xs">Client Name</Label>
              <Input className="h-8 text-xs mt-1" value={form.client_name}
                onChange={e => f("client_name", e.target.value)} placeholder="Client…" />
            </div>
            <div>
              <Label className="text-xs">Audit Planned From</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={form.audit_planned_from}
                onChange={e => f("audit_planned_from", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Audit Planned To</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={form.audit_planned_to}
                onChange={e => f("audit_planned_to", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Contact Person</Label>
              <Input className="h-8 text-xs mt-1" value={form.contact_person}
                onChange={e => f("contact_person", e.target.value)} placeholder="Name…" />
            </div>
            <div>
              <Label className="text-xs">Contact No</Label>
              <Input className="h-8 text-xs mt-1" value={form.contact_no}
                onChange={e => f("contact_no", e.target.value)} placeholder="Phone…" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Remarks</Label>
              <Textarea rows={3} className="text-xs mt-1 resize-none" value={form.remarks}
                onChange={e => f("remarks", e.target.value)} placeholder="Notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1"
              onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
