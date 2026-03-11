import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Plus, ArrowRight, MessageSquare, Send, Search, Filter,
  AlertTriangle, CheckCircle2, CornerDownRight, Loader2, X, Mail, Phone
} from "lucide-react";

interface PipelineStage5Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

const STATUSES = ["Open", "Dispatched", "Reply Received", "Satisfied", "Carry Forward"] as const;
const SOURCES = ["Scrutiny", "Manual"] as const;
const PRIORITIES = ["High", "Medium", "Low"] as const;

const STATUS_COLORS: Record<string, string> = {
  Open: "bg-destructive text-destructive-foreground",
  Dispatched: "bg-blue-500 text-white",
  "Reply Received": "bg-purple-500 text-white",
  Satisfied: "bg-primary text-primary-foreground",
  "Carry Forward": "bg-amber-500 text-white",
};

export default function PipelineStage5({ engagementId, engagement, onStageComplete, onSaveDraft }: PipelineStage5Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [filterStatus, setFilterStatus] = useState("All");
  const [filterSource, setFilterSource] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [showAddQuery, setShowAddQuery] = useState(false);
  const [showDispatch, setShowDispatch] = useState<any>(null);
  const [showReplyView, setShowReplyView] = useState<any>(null);
  const [newQuery, setNewQuery] = useState({ query_text: "", priority: "Medium" as string, account_ref: "" });
  const [dispatchMode, setDispatchMode] = useState("email");
  const [dispatchMessage, setDispatchMessage] = useState("");
  const [importing, setImporting] = useState(false);

  // ─── Fetch queries ───
  const { data: queries, refetch: refetchQueries } = useQuery({
    queryKey: ["audit-queries-stage5", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_client_queries")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!engagementId,
  });

  // ─── Fetch carry-forward info ───
  const { data: cfQueries } = useQuery({
    queryKey: ["carry-forward-queries", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("carry_forward_queries")
        .select("source_query_id")
        .eq("target_engagement_id", engagementId);
      return new Set((data || []).map((d: any) => d.source_query_id));
    },
    enabled: !!engagementId,
  });

  // ─── Import from parent engagement ───
  const importCarryForward = useCallback(async () => {
    if (!engagement?.parent_engagement_id) { toast.error("No parent engagement"); return; }
    setImporting(true);
    try {
      const { data: parentQueries } = await supabase
        .from("audit_client_queries")
        .select("*")
        .eq("engagement_id", engagement.parent_engagement_id)
        .in("status", ["Open", "Carry Forward"]);

      if (!parentQueries || parentQueries.length === 0) {
        toast.info("No open queries to carry forward");
        setImporting(false);
        return;
      }

      for (const pq of parentQueries) {
        // Create new query in this engagement
        const { data: newQ } = await supabase.from("audit_client_queries").insert({
          engagement_id: engagementId,
          client_id: engagement.client_id,
          firm_id: user?.firm_id,
          financial_year: engagement.financial_year,
          query_text: pq.query_text,
          source: pq.source,
          priority: pq.priority,
          status: "Open",
          carry_forward_from_year: pq.financial_year,
          ref_number: pq.ref_number,
        } as any).select("id").single();

        // Log carry-forward
        if (newQ) {
          await supabase.from("carry_forward_queries").insert({
            source_query_id: pq.id,
            target_engagement_id: engagementId,
            carried_by: user?.id,
          } as any);

          // Mark original as Carry Forward
          await supabase.from("audit_client_queries").update({ status: "Carry Forward", carry_forward_to_year: engagement.financial_year } as any).eq("id", pq.id);
        }
      }

      toast.success(`${parentQueries.length} queries carried forward`);
      refetchQueries();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setImporting(false);
    }
  }, [engagement, engagementId, user]);

  // ─── Add manual query ───
  const addQuery = useCallback(async () => {
    if (!newQuery.query_text.trim()) return;
    const { error } = await supabase.from("audit_client_queries").insert({
      engagement_id: engagementId,
      client_id: engagement?.client_id,
      firm_id: user?.firm_id,
      financial_year: engagement?.financial_year,
      query_text: newQuery.query_text,
      source: "Manual",
      priority: newQuery.priority,
      status: "Open",
      ref_number: newQuery.account_ref || null,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Query added");
    setShowAddQuery(false);
    setNewQuery({ query_text: "", priority: "Medium", account_ref: "" });
    refetchQueries();
  }, [newQuery, engagementId, engagement, user]);

  // ─── Dispatch query ───
  const dispatchQuery = useCallback(async (query: any) => {
    // Log dispatch
    await supabase.from("audit_query_dispatch_log").insert({
      engagement_id: engagementId,
      client_id: engagement?.client_id,
      firm_id: user?.firm_id,
      channel: dispatchMode,
      query_ids: [query.id],
      subject: `Audit Query — ${engagement?.financial_year}`,
      body: dispatchMessage || query.query_text,
      dispatched_by: user?.id,
    } as any);

    // Update status
    await supabase.from("audit_client_queries").update({
      status: "Dispatched",
      reply_method: dispatchMode,
    } as any).eq("id", query.id);

    toast.success(`Query dispatched via ${dispatchMode}`);
    setShowDispatch(null);
    setDispatchMessage("");
    refetchQueries();
  }, [engagementId, engagement, user, dispatchMode, dispatchMessage]);

  // ─── Update query status ───
  const updateQueryStatus = useCallback(async (queryId: string, status: string, notes?: string) => {
    const payload: any = { status };
    if (notes) payload.internal_notes = notes;
    await supabase.from("audit_client_queries").update(payload as any).eq("id", queryId);
    refetchQueries();
    toast.success(`Query marked as ${status}`);
  }, []);

  // ─── Filtered ───
  const filtered = useMemo(() => {
    if (!queries) return [];
    return queries.filter((q: any) => {
      if (filterStatus !== "All" && q.status !== filterStatus) return false;
      if (filterSource !== "All" && q.source !== filterSource) return false;
      if (searchText && !q.query_text?.toLowerCase().includes(searchText.toLowerCase()) && !q.ref_number?.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });
  }, [queries, filterStatus, filterSource, searchText]);

  // ─── Stats ───
  const stats = useMemo(() => {
    if (!queries) return { total: 0, open: 0, dispatched: 0, replied: 0, satisfied: 0, cf: 0 };
    return {
      total: queries.length,
      open: queries.filter((q: any) => q.status === "Open").length,
      dispatched: queries.filter((q: any) => q.status === "Dispatched").length,
      replied: queries.filter((q: any) => q.status === "Reply Received").length,
      satisfied: queries.filter((q: any) => q.status === "Satisfied").length,
      cf: queries.filter((q: any) => q.status === "Carry Forward").length,
    };
  }, [queries]);

  const hasOpenCF = stats.cf > 0 || stats.open > 0;
  const canComplete = stats.total > 0 && stats.open === 0;

  const completeStage = useCallback(async () => {
    const statuses = engagement?.stage_statuses || {};
    await supabase.from("audit_engagements").update({
      stage_statuses: { ...statuses, "5": "complete", "6": "in_progress" },
      pipeline_stage: 6,
    } as any).eq("id", engagementId);
    toast.success("Stage 5 complete — proceed to next stage");
    onStageComplete();
  }, [engagement, engagementId]);

  return (
    <div className="max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stage 5 — Audit Query Tracker</h1>
          <p className="text-sm text-muted-foreground">Manage all queries — auto-generated from scrutiny + manual entries</p>
        </div>
        <div className="flex gap-2">
          {engagement?.parent_engagement_id && (
            <Button variant="outline" size="sm" onClick={importCarryForward} disabled={importing} className="gap-1.5">
              {importing ? <Loader2 size={14} className="animate-spin" /> : <CornerDownRight size={14} />}
              Import Carry-Forward
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowAddQuery(true)} className="gap-1.5">
            <Plus size={14} /> Add Query
          </Button>
          <Button size="sm" onClick={completeStage} disabled={!canComplete} className="gap-1">
            Complete Stage 5 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <Card className="p-3"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold">{stats.total}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Open</p><p className="text-2xl font-bold text-destructive">{stats.open}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Dispatched</p><p className="text-2xl font-bold text-blue-500">{stats.dispatched}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Replied</p><p className="text-2xl font-bold text-purple-500">{stats.replied}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Satisfied</p><p className="text-2xl font-bold text-primary">{stats.satisfied}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Carry Fwd</p><p className="text-2xl font-bold text-amber-500">{stats.cf}</p></Card>
      </div>

      {hasOpenCF && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Open Queries</AlertTitle>
          <AlertDescription>There are {stats.open + stats.cf} open/carry-forward queries. All must be resolved before Stage 10 sign-off.</AlertDescription>
        </Alert>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input placeholder="Search queries..." value={searchText} onChange={e => setSearchText(e.target.value)} className="pl-8 h-9 w-48 text-xs" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-9 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All" className="text-xs">All Status</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="h-9 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All" className="text-xs">All Sources</SelectItem>
            {SOURCES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Queries table */}
      <Card>
        <ScrollArea className="max-h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-8">#</TableHead>
                <TableHead className="text-xs">Query Text</TableHead>
                <TableHead className="text-xs">Source</TableHead>
                <TableHead className="text-xs">Ref</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Priority</TableHead>
                <TableHead className="text-xs">Reply</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">
                    No queries yet. Run scrutiny and raise queries from findings, or add manually.
                  </TableCell>
                </TableRow>
              ) : filtered.map((q: any, idx: number) => (
                <TableRow key={q.id}>
                  <TableCell className="text-xs font-mono">{idx + 1}</TableCell>
                  <TableCell className="text-xs max-w-[250px]">
                    <div className="space-y-1">
                      <p className="truncate">{q.query_text}</p>
                      {q.carry_forward_from_year && (
                        <Badge variant="outline" className="text-[9px] gap-0.5">
                          <CornerDownRight size={10} /> CF from {q.carry_forward_from_year}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{q.source}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{q.ref_number || "—"}</TableCell>
                  <TableCell>
                    <Badge className={cn("text-[10px]", STATUS_COLORS[q.status] || "")}>{q.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={q.priority === "High" ? "destructive" : "outline"} className="text-[10px]">{q.priority}</Badge>
                  </TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate">
                    {q.client_reply ? (
                      <button className="text-primary hover:underline text-xs" onClick={() => setShowReplyView(q)}>
                        View Reply
                      </button>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {q.status === "Open" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => { setShowDispatch(q); setDispatchMessage(q.query_text); }}>
                          <Send size={12} /> Dispatch
                        </Button>
                      )}
                      {q.status === "Reply Received" && (
                        <>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => updateQueryStatus(q.id, "Satisfied")}>
                            <CheckCircle2 size={12} /> Satisfy
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => updateQueryStatus(q.id, "Open")}>
                            Re-open
                          </Button>
                        </>
                      )}
                      {(q.status === "Open" || q.status === "Dispatched") && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => updateQueryStatus(q.id, "Carry Forward")}>
                          CF
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </Card>

      {/* Add Query Dialog */}
      <Dialog open={showAddQuery} onOpenChange={setShowAddQuery}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Manual Query</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Query Text *</Label>
              <Textarea value={newQuery.query_text} onChange={e => setNewQuery(q => ({ ...q, query_text: e.target.value }))} rows={3} placeholder="Describe the audit query..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Priority</Label>
                <Select value={newQuery.priority} onValueChange={v => setNewQuery(q => ({ ...q, priority: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Account/Reference</Label>
                <Input value={newQuery.account_ref} onChange={e => setNewQuery(q => ({ ...q, account_ref: e.target.value }))} className="text-xs" placeholder="e.g. Cash Account" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddQuery(false)}>Cancel</Button>
            <Button onClick={addQuery} disabled={!newQuery.query_text.trim()}>Add Query</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispatch Dialog */}
      <Dialog open={!!showDispatch} onOpenChange={() => setShowDispatch(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Dispatch Query to Client</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Dispatch Mode</Label>
              <RadioGroup value={dispatchMode} onValueChange={setDispatchMode} className="flex gap-4 mt-1">
                <div className="flex items-center gap-2"><RadioGroupItem value="email" /><Label className="text-xs cursor-pointer flex items-center gap-1"><Mail size={12} /> Email</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="whatsapp" /><Label className="text-xs cursor-pointer flex items-center gap-1"><Phone size={12} /> WhatsApp</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="both" /><Label className="text-xs cursor-pointer">Both</Label></div>
              </RadioGroup>
            </div>
            <div>
              <Label className="text-xs">Message (editable)</Label>
              <Textarea value={dispatchMessage} onChange={e => setDispatchMessage(e.target.value)} rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDispatch(null)}>Cancel</Button>
            <Button onClick={() => showDispatch && dispatchQuery(showDispatch)} className="gap-1"><Send size={14} /> Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reply View Dialog */}
      <Dialog open={!!showReplyView} onOpenChange={() => setShowReplyView(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Client Reply</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Original Query</Label>
              <p className="text-sm bg-muted p-3 rounded">{showReplyView?.query_text}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Client Response</Label>
              <p className="text-sm bg-primary/5 p-3 rounded border border-primary/20">{showReplyView?.client_reply || "No reply yet"}</p>
            </div>
            {showReplyView?.internal_notes && (
              <div>
                <Label className="text-xs text-muted-foreground">CA Notes</Label>
                <p className="text-sm">{showReplyView.internal_notes}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            {showReplyView?.status === "Reply Received" && (
              <>
                <Button variant="outline" onClick={() => { updateQueryStatus(showReplyView.id, "Open"); setShowReplyView(null); }}>Re-open</Button>
                <Button onClick={() => { updateQueryStatus(showReplyView.id, "Satisfied"); setShowReplyView(null); }}>Mark Satisfied</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
