/**
 * SpecialAttention — Sheet 3
 * Shown only for corporate entities (isCorporate = true).
 * Tracks items needing special audit attention.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WsItem } from "./hooks/useWorksheetStorage";

interface Props {
  items: WsItem[];
  updateItem: (id: string, updates: Partial<WsItem>) => Promise<void>;
  addItem: (sheetType: WsItem["sheet_type"], overrides?: Partial<WsItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}

const STATUS_OPTS = ["pending", "in_progress", "done", "na"];
const PRIORITY_OPTS = ["high", "normal", "low"];

const STATUS_CLASS: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-600",
  in_progress: "bg-amber-100 text-amber-700",
  done:        "bg-green-100 text-green-700",
  na:          "bg-muted text-muted-foreground",
};
const PRIORITY_CLASS: Record<string, string> = {
  high:   "bg-red-100 text-red-700",
  normal: "bg-blue-100 text-blue-700",
  low:    "bg-slate-100 text-slate-600",
};

export default function SpecialAttention({ items, updateItem, addItem, deleteItem }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<WsItem>>({});

  const startEdit = (item: WsItem) => {
    setEditingId(item.id);
    setDraft({
      particulars: item.particulars,
      work_done:   item.work_done,
      remarks:     item.remarks,
      status:      item.status,
      priority:    item.priority,
      due_date:    item.due_date,
    });
  };

  const saveEdit = async (id: string) => {
    await updateItem(id, draft);
    setEditingId(null);
    setDraft({});
  };

  const cancelEdit = () => { setEditingId(null); setDraft({}); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Special Attention Items</h3>
          <p className="text-xs text-muted-foreground">
            High-risk areas / corporate-specific audit focus points
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1 h-8"
          onClick={() => addItem("special_attention")}
        >
          <Plus size={13} /> Add Row
        </Button>
      </div>

      <div className="border rounded-lg overflow-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead className="min-w-[220px]">Particulars / Area</TableHead>
              <TableHead className="min-w-[180px]">Work Done</TableHead>
              <TableHead className="min-w-[150px]">Remarks</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="w-[90px]">Priority</TableHead>
              <TableHead className="w-[110px]">Due Date</TableHead>
              <TableHead className="w-12 text-center">Done</TableHead>
              <TableHead className="w-20 text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8 text-sm">
                  No special attention items. Click "Add Row" to add one.
                </TableCell>
              </TableRow>
            )}
            {items.map(item => {
              const isEditing = editingId === item.id;
              return (
                <TableRow key={item.id} className={cn(item.is_done && "opacity-60")}>
                  <TableCell className="text-center text-xs font-mono">{item.sr_no}</TableCell>

                  {/* Particulars */}
                  <TableCell>
                    {isEditing ? (
                      <Textarea
                        rows={2}
                        className="text-xs min-w-[180px]"
                        value={draft.particulars ?? ""}
                        onChange={e => setDraft(p => ({ ...p, particulars: e.target.value }))}
                      />
                    ) : (
                      <span className="text-sm">{item.particulars || "—"}</span>
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

                  {/* Priority */}
                  <TableCell>
                    {isEditing ? (
                      <Select
                        value={draft.priority ?? item.priority}
                        onValueChange={v => setDraft(p => ({ ...p, priority: v }))}
                      >
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PRIORITY_OPTS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge className={cn("text-[10px] px-1.5 py-0", PRIORITY_CLASS[item.priority] || "")}>
                        {item.priority}
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
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={cancelEdit}>
                          ✕
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => startEdit(item)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
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
