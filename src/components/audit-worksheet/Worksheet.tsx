/**
 * Worksheet — Sheet 4
 * Audit work tracking sheet with employee assignment (Req #4).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WsItem } from "./hooks/useWorksheetStorage";
import type { Employee } from "./hooks/useEmployeeDropdown";

interface Props {
  items: WsItem[];
  employees: Employee[];
  updateItem: (id: string, updates: Partial<WsItem>) => Promise<void>;
  addItem: (sheetType: WsItem["sheet_type"], overrides?: Partial<WsItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}

const STATUS_OPTS  = ["pending", "in_progress", "done", "na"];
const PRIORITY_OPTS = ["high", "normal", "low"];

const STATUS_CLASS: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-600",
  in_progress: "bg-amber-100 text-amber-700",
  done:        "bg-green-100 text-green-700",
  na:          "bg-muted text-muted-foreground",
};

const AREAS = [
  "Revenue & Sales", "Purchases & Expenses", "Fixed Assets & Depreciation",
  "Debtors & Receivables", "Creditors & Payables", "Loans & Borrowings",
  "Inventory / Stock", "Cash & Bank", "Investments", "Capital & Reserves",
  "Payroll & PF/ESI", "TDS Compliance", "GST Compliance",
  "Related Party Transactions", "Contingent Liabilities", "Other",
];

export default function Worksheet({ items, employees, updateItem, addItem, deleteItem }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft]         = useState<Partial<WsItem>>({});

  const startEdit = (item: WsItem) => {
    setEditingId(item.id);
    setDraft({
      particulars:   item.particulars,
      work_done:     item.work_done,
      remarks:       item.remarks,
      assigned_to:   item.assigned_to,
      assigned_name: item.assigned_name,
      status:        item.status,
      priority:      item.priority,
      due_date:      item.due_date,
    });
  };

  const saveEdit = async (id: string) => {
    await updateItem(id, draft);
    setEditingId(null);
    setDraft({});
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Audit Work Sheet</h3>
          <p className="text-xs text-muted-foreground">
            Track audit tasks, assign team members, and monitor progress
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1 h-8"
          onClick={() => addItem("worksheet")}
        >
          <Plus size={13} /> Add Row
        </Button>
      </div>

      <div className="border rounded-lg overflow-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead className="min-w-[200px]">Area / Particulars</TableHead>
              <TableHead className="min-w-[160px]">Work Done</TableHead>
              <TableHead className="min-w-[130px]">Remarks</TableHead>
              <TableHead className="min-w-[140px]">Assigned To</TableHead>
              <TableHead className="w-[105px]">Status</TableHead>
              <TableHead className="w-[110px]">Due Date</TableHead>
              <TableHead className="w-12 text-center">Done</TableHead>
              <TableHead className="w-20 text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8 text-sm">
                  No worksheet rows yet. Click "Add Row" to start.
                </TableCell>
              </TableRow>
            )}
            {items.map(item => {
              const isEditing = editingId === item.id;
              return (
                <TableRow key={item.id} className={cn(item.is_done && "opacity-55")}>
                  <TableCell className="text-center text-xs font-mono">{item.sr_no}</TableCell>

                  {/* Particulars */}
                  <TableCell>
                    {isEditing ? (
                      <Select
                        value={draft.particulars ?? ""}
                        onValueChange={v => setDraft(p => ({ ...p, particulars: v }))}
                      >
                        <SelectTrigger className="h-7 text-xs min-w-[180px]">
                          <SelectValue placeholder="Select area..." />
                        </SelectTrigger>
                        <SelectContent>
                          {AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                          <SelectItem value="__custom__">Custom…</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm">{item.particulars || "—"}</span>
                    )}
                    {isEditing && (draft.particulars === "__custom__" || (!AREAS.includes(draft.particulars || "") && draft.particulars)) && (
                      <Input
                        className="mt-1 h-7 text-xs"
                        placeholder="Enter custom area…"
                        value={draft.particulars === "__custom__" ? "" : draft.particulars ?? ""}
                        onChange={e => setDraft(p => ({ ...p, particulars: e.target.value }))}
                      />
                    )}
                  </TableCell>

                  {/* Work Done */}
                  <TableCell>
                    {isEditing ? (
                      <Textarea
                        rows={2}
                        className="text-xs"
                        value={draft.work_done ?? ""}
                        onChange={e => setDraft(p => ({ ...p, work_done: e.target.value }))}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{item.work_done || "—"}</span>
                    )}
                  </TableCell>

                  {/* Remarks */}
                  <TableCell>
                    {isEditing ? (
                      <Textarea
                        rows={2}
                        className="text-xs"
                        value={draft.remarks ?? ""}
                        onChange={e => setDraft(p => ({ ...p, remarks: e.target.value }))}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{item.remarks || "—"}</span>
                    )}
                  </TableCell>

                  {/* Assigned To */}
                  <TableCell>
                    {isEditing ? (
                      <Select
                        value={draft.assigned_to ?? ""}
                        onValueChange={v => {
                          const emp = employees.find(e => e.id === v);
                          setDraft(p => ({
                            ...p,
                            assigned_to:   v || null,
                            assigned_name: emp?.name || "",
                          }));
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs min-w-[120px]">
                          <SelectValue placeholder="Assign…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">— Unassigned —</SelectItem>
                          {employees.map(e => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.name}{e.role ? ` (${e.role})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : item.assigned_name ? (
                      <div className="flex items-center gap-1 text-xs">
                        <User size={11} className="text-muted-foreground" />
                        {item.assigned_name}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    {isEditing ? (
                      <Select
                        value={draft.status ?? item.status}
                        onValueChange={v => setDraft(p => ({ ...p, status: v }))}
                      >
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_CLASS[item.status] || "")}>
                        {item.status}
                      </Badge>
                    )}
                  </TableCell>

                  {/* Due Date */}
                  <TableCell>
                    {isEditing ? (
                      <Input
                        type="date"
                        className="h-7 text-xs"
                        value={draft.due_date ?? ""}
                        onChange={e => setDraft(p => ({ ...p, due_date: e.target.value }))}
                      />
                    ) : (
                      <span className="text-xs">{item.due_date || "—"}</span>
                    )}
                  </TableCell>

                  {/* Done toggle */}
                  <TableCell className="text-center">
                    <Checkbox
                      checked={item.is_done}
                      onCheckedChange={v => updateItem(item.id, { is_done: !!v })}
                    />
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-center">
                    {isEditing ? (
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" className="h-6 px-2 text-xs" onClick={() => saveEdit(item.id)}>
                          Save
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-6 px-2 text-xs"
                          onClick={() => { setEditingId(null); setDraft({}); }}
                        >
                          ✕
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-center">
                        <Button
                          size="sm" variant="ghost" className="h-6 px-2 text-xs"
                          onClick={() => startEdit(item)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 px-2 text-red-500 hover:text-red-700"
                          onClick={() => deleteItem(item.id)}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
