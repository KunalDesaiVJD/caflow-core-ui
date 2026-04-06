/**
 * Checklist — Sheet 6
 * Audit documentation checklist tracker.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WsItem } from "./hooks/useWorksheetStorage";

interface Props {
  items: WsItem[];
  updateItem: (id: string, updates: Partial<WsItem>) => Promise<void>;
  addItem: (sheetType: WsItem["sheet_type"], overrides?: Partial<WsItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}

export default function Checklist({ items, updateItem, addItem, deleteItem }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft]         = useState<{ particulars: string; remarks: string }>({
    particulars: "", remarks: "",
  });

  const doneCount  = items.filter(i => i.is_done).length;
  const totalCount = items.length;
  const pct        = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const startEdit = (item: WsItem) => {
    setEditingId(item.id);
    setDraft({ particulars: item.particulars, remarks: item.remarks });
  };

  const saveEdit = async (id: string) => {
    await updateItem(id, draft);
    setEditingId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-sm">Audit Documentation Checklist</h3>
          <p className="text-xs text-muted-foreground">
            Track all required documents and sign-off activities
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Progress badge */}
          <Badge
            className={cn(
              "text-xs",
              pct === 100
                ? "bg-green-100 text-green-700"
                : pct >= 50
                ? "bg-amber-100 text-amber-700"
                : "bg-slate-100 text-slate-600"
            )}
          >
            {doneCount}/{totalCount} done ({pct}%)
          </Badge>
          <Button
            size="sm"
            className="gap-1 h-8"
            onClick={() => addItem("checklist")}
          >
            <Plus size={13} /> Add Item
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            pct === 100 ? "bg-green-500" : "bg-blue-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="border rounded-lg overflow-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead className="w-10 text-center">Done</TableHead>
              <TableHead className="min-w-[250px]">Document / Activity</TableHead>
              <TableHead className="min-w-[200px]">Remarks / Notes</TableHead>
              <TableHead className="w-24 text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">
                  No checklist items yet.
                </TableCell>
              </TableRow>
            )}
            {items.map(item => {
              const isEditing = editingId === item.id;
              return (
                <TableRow key={item.id} className={cn(item.is_done && "bg-green-50/50")}>
                  <TableCell className="text-center text-xs font-mono">{item.sr_no}</TableCell>

                  {/* Done toggle */}
                  <TableCell className="text-center">
                    <button
                      onClick={() => updateItem(item.id, { is_done: !item.is_done })}
                      className="focus:outline-none"
                    >
                      {item.is_done
                        ? <CheckCircle2 size={18} className="text-green-600" />
                        : <Circle size={18} className="text-muted-foreground" />
                      }
                    </button>
                  </TableCell>

                  {/* Particulars */}
                  <TableCell>
                    {isEditing ? (
                      <Input
                        className="h-7 text-sm"
                        value={draft.particulars}
                        onChange={e => setDraft(p => ({ ...p, particulars: e.target.value }))}
                      />
                    ) : (
                      <span className={cn("text-sm", item.is_done && "line-through text-muted-foreground")}>
                        {item.particulars || "—"}
                      </span>
                    )}
                  </TableCell>

                  {/* Remarks */}
                  <TableCell>
                    {isEditing ? (
                      <Textarea
                        rows={2}
                        className="text-xs"
                        value={draft.remarks}
                        onChange={e => setDraft(p => ({ ...p, remarks: e.target.value }))}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{item.remarks || "—"}</span>
                    )}
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
                          onClick={() => setEditingId(null)}
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
