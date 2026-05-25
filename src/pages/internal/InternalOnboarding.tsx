import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ClipboardList, CheckCircle2, Clock, ChevronRight,
  Loader2, UserCheck, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Instance {
  id: string;
  firm_id: string;
  firm_name: string;
  plan_tier: string;
  status: string;
  progress_pct: number;
  assigned_ie_id: string | null;
  assigned_ie_name: string | null;
  created_at: string;
}

interface Task {
  id: string;
  task_order: number;
  task_label: string;
  task_desc: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  status: string;
  done_at: string | null;
  notes: string | null;
}

interface IEUser {
  id: string;
  name: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:     "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  done:        "bg-green-100 text-green-800",
  skipped:     "bg-muted text-muted-foreground",
  completed:   "bg-green-100 text-green-800",
};

const PLAN_COLORS: Record<string, string> = {
  solo:       "bg-muted text-muted-foreground",
  studio:     "bg-blue-100 text-blue-800",
  firm:       "bg-purple-100 text-purple-800",
  enterprise: "bg-amber-100 text-amber-800",
};

export default function InternalOnboarding() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [instances, setInstances] = useState<Instance[]>([]);
  const [selected, setSelected] = useState<Instance | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ieUsers, setIeUsers] = useState<IEUser[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [updatingTask, setUpdatingTask] = useState<string | null>(null);

  const [noteDialog, setNoteDialog] = useState<{ taskId: string; current: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const loadInstances = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("onboarding_instances")
      .select(`
        id, firm_id, plan_tier, status, progress_pct, assigned_ie_id, created_at,
        firms(name),
        ie:assigned_ie_id(name)
      `)
      .order("created_at", { ascending: false });

    setInstances(
      (data || []).map((r: any) => ({
        id: r.id, firm_id: r.firm_id,
        firm_name: r.firms?.name ?? "—",
        plan_tier: r.plan_tier ?? "solo",
        status: r.status ?? "pending",
        progress_pct: r.progress_pct ?? 0,
        assigned_ie_id: r.assigned_ie_id,
        assigned_ie_name: r.ie?.name ?? null,
        created_at: r.created_at,
      }))
    );

    // Load IE users for assignment
    const { data: ies } = await (supabase as any)
      .from("users")
      .select("id, name")
      .eq("role", "implementation_executive")
      .eq("is_active", true)
      .order("name");
    setIeUsers((ies || []).map((u: any) => ({ id: u.id, name: u.name || u.email })));

    setLoading(false);
  }, []);

  useEffect(() => { loadInstances(); }, [loadInstances]);

  const loadTasks = useCallback(async (instanceId: string) => {
    setLoadingTasks(true);
    const { data } = await (supabase as any)
      .from("onboarding_tasks")
      .select(`id, task_order, task_label, task_desc, assignee_id, status, done_at, notes, assignee:assignee_id(name)`)
      .eq("instance_id", instanceId)
      .order("task_order");
    setTasks(
      (data || []).map((t: any) => ({
        ...t,
        assignee_name: t.assignee?.name ?? null,
      }))
    );
    setLoadingTasks(false);
  }, []);

  const selectInstance = (inst: Instance) => {
    setSelected(inst);
    loadTasks(inst.id);
  };

  const markTask = async (taskId: string, newStatus: "done" | "skipped" | "in_progress") => {
    setUpdatingTask(taskId);
    try {
      const { error } = await (supabase as any)
        .from("onboarding_tasks")
        .update({
          status: newStatus,
          done_at: newStatus === "done" ? new Date().toISOString() : null,
          done_by: newStatus === "done" ? user?.id : null,
        })
        .eq("id", taskId);
      if (error) throw error;

      // Refresh tasks and recalculate progress
      if (selected) {
        await loadTasks(selected.id);
        const updated = tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t);
        const done = updated.filter(t => t.status === "done" || t.status === "skipped").length;
        const pct = updated.length > 0 ? Math.round((done / updated.length) * 100) : 0;
        const instStatus = pct === 100 ? "completed" : done > 0 ? "in_progress" : "pending";

        await (supabase as any)
          .from("onboarding_instances")
          .update({ progress_pct: pct, status: instStatus,
            completed_at: pct === 100 ? new Date().toISOString() : null })
          .eq("id", selected.id);

        setInstances(prev => prev.map(i =>
          i.id === selected.id ? { ...i, progress_pct: pct, status: instStatus } : i
        ));
        setSelected(prev => prev ? { ...prev, progress_pct: pct, status: instStatus } : prev);
      }

      toast({ title: newStatus === "done" ? "Task marked complete" : `Task marked ${newStatus}` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUpdatingTask(null);
    }
  };

  const saveNote = async () => {
    if (!noteDialog) return;
    setSavingNote(true);
    try {
      const { error } = await (supabase as any)
        .from("onboarding_tasks")
        .update({ notes: noteText })
        .eq("id", noteDialog.taskId);
      if (error) throw error;
      setTasks(prev => prev.map(t => t.id === noteDialog.taskId ? { ...t, notes: noteText } : t));
      setNoteDialog(null);
      toast({ title: "Note saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingNote(false);
    }
  };

  const assignIE = async (instanceId: string, ieId: string) => {
    const { error } = await (supabase as any)
      .from("onboarding_instances")
      .update({ assigned_ie_id: ieId || null })
      .eq("id", instanceId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    const ieName = ieUsers.find(u => u.id === ieId)?.name ?? null;
    setInstances(prev => prev.map(i =>
      i.id === instanceId ? { ...i, assigned_ie_id: ieId || null, assigned_ie_name: ieName } : i
    ));
    if (selected?.id === instanceId)
      setSelected(prev => prev ? { ...prev, assigned_ie_id: ieId || null, assigned_ie_name: ieName } : prev);
    toast({ title: "IE assigned" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
          <ClipboardList size={22} /> Onboarding Board
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track setup progress for every subscribing firm.
        </p>
      </div>

      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[500px]">
        {/* Left: instance list */}
        <div className="w-72 shrink-0 flex flex-col border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Firms ({instances.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-3 space-y-2">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : instances.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No onboarding instances yet</div>
            ) : (
              instances.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => selectInstance(inst)}
                  className={cn(
                    "w-full text-left px-3 py-3 border-b last:border-0 transition-colors",
                    selected?.id === inst.id ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-sm font-medium text-foreground truncate">{inst.firm_name}</span>
                    <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                  </div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <Badge className={cn("text-[10px] px-1.5 py-0", PLAN_COLORS[inst.plan_tier] ?? "bg-muted")}>
                      {inst.plan_tier}
                    </Badge>
                    <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_COLORS[inst.status] ?? "bg-muted")}>
                      {inst.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <Progress value={inst.progress_pct} className="h-1" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: task board */}
        <div className="flex-1 border rounded-lg bg-card overflow-hidden flex flex-col">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <ClipboardList size={40} className="opacity-30" />
              <p className="text-sm">Select a firm to view their onboarding tasks</p>
            </div>
          ) : (
            <>
              {/* Panel header */}
              <div className="p-4 border-b flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-foreground text-lg">{selected.firm_name}</h2>
                    <Badge className={cn("text-[10px]", PLAN_COLORS[selected.plan_tier] ?? "bg-muted")}>
                      {selected.plan_tier}
                    </Badge>
                    <Badge className={cn("text-[10px]", STATUS_COLORS[selected.status] ?? "bg-muted")}>
                      {selected.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Progress value={selected.progress_pct} className="h-2 w-48" />
                    <span className="text-sm text-muted-foreground">{selected.progress_pct}% complete</span>
                  </div>
                </div>

                {/* IE assignment (superadmin only) */}
                {user?.role === "superadmin" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <UserCheck size={14} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">IE:</span>
                    <Select
                      value={selected.assigned_ie_id ?? "none"}
                      onValueChange={val => assignIE(selected.id, val === "none" ? "" : val)}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {ieUsers.map(ie => (
                          <SelectItem key={ie.id} value={ie.id}>{ie.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Task list */}
              <div className="flex-1 overflow-y-auto">
                {loadingTasks ? (
                  <div className="p-4 space-y-3">
                    {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">No tasks generated yet</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/50 border-b">
                      <tr className="text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2.5 font-medium">#</th>
                        <th className="text-left px-4 py-2.5 font-medium w-full">Task</th>
                        <th className="text-center px-3 py-2.5 font-medium">Status</th>
                        <th className="text-center px-3 py-2.5 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map(t => (
                        <tr
                          key={t.id}
                          className={cn(
                            "border-b last:border-0 transition-colors",
                            t.status === "done" ? "opacity-60" : "hover:bg-muted/30"
                          )}
                        >
                          <td className="px-4 py-3 text-muted-foreground text-xs">{t.task_order}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {t.status === "done"
                                ? <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                                : <Clock size={14} className="text-muted-foreground shrink-0" />
                              }
                              <div>
                                <span className={cn("font-medium text-foreground", t.status === "done" && "line-through text-muted-foreground")}>
                                  {t.task_label}
                                </span>
                                {t.task_desc && (
                                  <p className="text-[11px] text-muted-foreground">{t.task_desc}</p>
                                )}
                                {t.notes && (
                                  <p className="text-[11px] text-blue-600 italic mt-0.5">Note: {t.notes}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <Badge className={cn("text-[10px] px-1.5", STATUS_COLORS[t.status] ?? "bg-muted")}>
                              {t.status.replace("_", " ")}
                            </Badge>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1 justify-center">
                              {t.status !== "done" && (
                                <Button
                                  size="sm" variant="outline"
                                  className="h-7 text-[11px] px-2 text-green-700 border-green-300 hover:bg-green-50"
                                  disabled={updatingTask === t.id}
                                  onClick={() => markTask(t.id, "done")}
                                >
                                  {updatingTask === t.id
                                    ? <Loader2 size={12} className="animate-spin" />
                                    : "✓ Done"}
                                </Button>
                              )}
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 text-[11px] px-2 text-muted-foreground"
                                onClick={() => { setNoteDialog({ taskId: t.id, current: t.notes ?? "" }); setNoteText(t.notes ?? ""); }}
                              >
                                Note
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Note dialog */}
      <Dialog open={!!noteDialog} onOpenChange={() => setNoteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add / Edit Note</DialogTitle>
          </DialogHeader>
          <Textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="Add a note for this task..."
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialog(null)}>Cancel</Button>
            <Button onClick={saveNote} disabled={savingNote}>
              {savingNote ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
              Save Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
