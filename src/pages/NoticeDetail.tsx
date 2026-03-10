import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { ArrowLeft, ChevronRight, Sparkles, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUSES = ["Received", "Under Review", "Reply Drafted", "Reply Filed", "Awaiting Order", "Order Received", "Closed/Dropped"] as const;

const NOTICE_TYPE_LABELS: Record<string, string> = {
  income_tax_demand_143_1: "IT Demand 143(1)",
  scrutiny_notice_143_2: "Scrutiny 143(2)",
  deficiency_memo: "Deficiency Memo",
  gstn_notice: "GST Notice",
  tds_mismatch_26as: "TDS Mismatch 26AS",
  roc_notice: "ROC Notice",
  pf_esic_notice: "PF/ESIC Notice",
  custom: "Custom",
};

export default function NoticeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const { data: notice, isLoading } = useQuery({
    queryKey: ["demand_notice", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demand_notices")
        .select("*, clients(name, entity_type, pan), users!demand_notices_assigned_to_fkey(name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["notice_history", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demand_notice_status_history")
        .select("*, users!demand_notice_status_history_changed_by_fkey(name)")
        .eq("notice_id", id!)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  const currentIdx = notice ? STATUSES.indexOf(notice.status as any) : 0;
  const nextStatus = currentIdx < STATUSES.length - 1 ? STATUSES[currentIdx + 1] : null;

  const statusMutation = useMutation({
    mutationFn: async () => {
      if (!nextStatus || !id) return;
      const { error } = await supabase
        .from("demand_notices")
        .update({ status: nextStatus })
        .eq("id", id);
      if (error) throw error;
      // Also insert history note manually if provided
      if (changeNote.trim()) {
        await supabase.from("demand_notice_status_history").insert({
          notice_id: id, from_status: notice?.status, to_status: nextStatus,
          changed_by: user?.id, change_note: changeNote.trim(),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["demand_notice", id] });
      queryClient.invalidateQueries({ queryKey: ["notice_history", id] });
      setStatusDialogOpen(false);
      setChangeNote("");
      toast({ title: `Status updated to ${nextStatus}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateField = async (field: string, value: string | null) => {
    if (!id) return;
    const { error } = await supabase.from("demand_notices").update({ [field]: value }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["demand_notice", id] });
  };

  const handleAiDraft = async () => {
    if (!notice) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: {
          task: "notice_reply_draft",
          prompt: `Draft a professional reply for the following demand notice:
Type: ${NOTICE_TYPE_LABELS[notice.notice_type] || notice.notice_type}
Section: ${notice.section || "N/A"}
Assessment Year: ${notice.assessment_year || "N/A"}
Amount Demanded: ₹${notice.amount_demanded || 0}
Amount Disputed: ₹${notice.amount_disputed || 0}
Department: ${notice.department || "N/A"}
Client: ${notice.clients?.name || "N/A"} (${notice.clients?.entity_type || ""})
PAN: ${notice.clients?.pan || "N/A"}
Remarks: ${notice.remarks || "None"}

Generate a type-specific professional reply addressing the notice. Include relevant legal references and request for disposal.`,
        },
      });
      if (error) throw error;
      const reply = data?.content || data?.response || "Could not generate draft.";
      await updateField("ai_draft_reply", reply);
      toast({ title: "AI draft generated" });
    } catch (e: any) {
      toast({ title: "AI Error", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  if (isLoading || !notice) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/notices")}><ArrowLeft size={18} /></Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {NOTICE_TYPE_LABELS[notice.notice_type] || "Notice"} — {notice.clients?.name}
          </h1>
          <p className="text-sm text-muted-foreground">Ref: {notice.notice_ref_no || "—"} | AY: {notice.assessment_year || "—"}</p>
        </div>
      </div>

      {/* Status Stepper */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {STATUSES.map((s, i) => {
              const isCompleted = i < currentIdx;
              const isCurrent = i === currentIdx;
              return (
                <div key={s} className="flex items-center shrink-0">
                  <div className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    isCompleted && "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
                    isCurrent && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                    !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
                  )}>{s}</div>
                  {i < STATUSES.length - 1 && <ChevronRight size={14} className="text-muted-foreground mx-1 shrink-0" />}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Panel */}
        <div className="lg:col-span-3 space-y-4">
          {/* Details */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Notice Details</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Department:</span> <span className="font-medium">{notice.department || "—"}</span></div>
                <div><span className="text-muted-foreground">Section:</span> <span className="font-medium">{notice.section || "—"}</span></div>
                <div><span className="text-muted-foreground">Notice Date:</span> <span className="font-medium">{notice.notice_date ? format(new Date(notice.notice_date), "dd MMM yyyy") : "—"}</span></div>
                <div><span className="text-muted-foreground">Received:</span> <span className="font-medium">{notice.date_received ? format(new Date(notice.date_received), "dd MMM yyyy") : "—"}</span></div>
                <div><span className="text-muted-foreground">Amount Demanded:</span> <span className="font-medium font-mono">₹{Number(notice.amount_demanded || 0).toLocaleString("en-IN")}</span></div>
                <div><span className="text-muted-foreground">Amount Disputed:</span> <span className="font-medium font-mono">₹{Number(notice.amount_disputed || 0).toLocaleString("en-IN")}</span></div>
                <div><span className="text-muted-foreground">Reply Due:</span> <span className="font-medium">{notice.reply_due_date ? format(new Date(notice.reply_due_date), "dd MMM yyyy") : "—"}</span></div>
                <div><span className="text-muted-foreground">Extended Due:</span> <span className="font-medium">{notice.extended_due_date ? format(new Date(notice.extended_due_date), "dd MMM yyyy") : "—"}</span></div>
                <div><span className="text-muted-foreground">Assigned To:</span> <span className="font-medium">{notice.users?.name || "Unassigned"}</span></div>
                <div><span className="text-muted-foreground">Priority:</span> <Badge variant="outline" className="text-[10px]">{notice.priority}</Badge></div>
              </div>
              {notice.remarks && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Remarks</p>
                  <p className="text-sm">{notice.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Draft Reply */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">AI Draft Reply</CardTitle>
              <Button size="sm" variant="outline" onClick={handleAiDraft} disabled={aiLoading}>
                <Sparkles size={14} className="mr-1.5" />
                {aiLoading ? "Generating..." : "Generate AI Draft"}
              </Button>
            </CardHeader>
            <CardContent>
              {notice.ai_draft_reply ? (
                <div className="space-y-3">
                  <Textarea
                    value={notice.ai_draft_reply}
                    onChange={e => updateField("ai_draft_reply", e.target.value)}
                    rows={10}
                    className="text-sm font-mono"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { updateField("final_reply", notice.ai_draft_reply); toast({ title: "Copied to final reply" }); }}
                  >
                    <Copy size={14} className="mr-1.5" /> Use as Final Reply
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Click "Generate AI Draft" to create a type-specific reply template.</p>
              )}
            </CardContent>
          </Card>

          {/* Final Reply */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Final Reply</CardTitle></CardHeader>
            <CardContent>
              <Textarea
                value={notice.final_reply || ""}
                onChange={e => updateField("final_reply", e.target.value)}
                rows={8}
                placeholder="Enter or paste the final reply..."
                className="text-sm"
              />
            </CardContent>
          </Card>
        </div>

        {/* Right Panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Status Change */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="text-sm px-3 py-1">{notice.status}</Badge>
              </div>
              {nextStatus && (
                <Button className="w-full" onClick={() => setStatusDialogOpen(true)}>
                  Move to: {nextStatus}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* History */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Status History</CardTitle></CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No status changes yet.</p>
              ) : (
                <div className="space-y-3">
                  {history.map((h: any) => (
                    <div key={h.id} className="border-l-2 border-primary/30 pl-3 py-1">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[10px]">{h.from_status || "—"}</Badge>
                        <ChevronRight size={10} />
                        <Badge variant="outline" className="text-[10px]">{h.to_status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {h.users?.name || "System"} • {h.changed_at ? format(new Date(h.changed_at), "dd MMM yyyy HH:mm") : ""}
                      </p>
                      {h.change_note && <p className="text-xs mt-1">{h.change_note}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Status Change Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Status to "{nextStatus}"</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Add a note (optional)</Label>
            <Textarea value={changeNote} onChange={e => setChangeNote(e.target.value)} rows={3} placeholder="Reason for status change..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => statusMutation.mutate()} disabled={statusMutation.isPending}>
              {statusMutation.isPending ? "Updating..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
