import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  MessageSquare, Plus, Filter, Check, ArrowRight,
  ExternalLink, ChevronRight,
} from "lucide-react";

const STATUSES = ["Open", "Client Acknowledged", "Reply Received", "Clarified", "Carried Forward", "Closed"] as const;
const SOURCES = ["Scrutiny Finding", "Comparative AI", "CARO", "3CD", "Manual", "AI Generated"] as const;
const PRIORITIES = ["High", "Medium", "Low"] as const;

const STATUS_COLORS: Record<string, string> = {
  Open: "bg-destructive text-destructive-foreground",
  "Client Acknowledged": "bg-blue-500 text-white",
  "Reply Received": "bg-purple-500 text-white",
  Clarified: "bg-green-600 text-white",
  "Carried Forward": "bg-amber-500 text-white",
  Closed: "bg-muted text-muted-foreground",
};

const SOURCE_COLORS: Record<string, string> = {
  "Scrutiny Finding": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "Comparative AI": "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  CARO: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  "3CD": "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  Manual: "bg-secondary text-secondary-foreground",
  "AI Generated": "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
};

type Query = {
  id: string;
  ref_number: string | null;
  query_text: string;
  source: string;
  source_ref_id: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  client_reply: string | null;
  reply_method: string | null;
  internal_notes: string | null;
  carry_forward_from_year: string | null;
  carry_forward_to_year: string | null;
  financial_year: string | null;
  engagement_id: string | null;
  client_id: string | null;
  firm_id: string | null;
  created_at: string | null;
};

export default function AuditQueryTracker() {
  const { clientId } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [queries, setQueries] = useState<Query[]>([]);
  const [clientName, setClientName] = useState("");
  const [financialYear, setFinancialYear] = useState("2024-25");
  const [engagementId, setEngagementId] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");

  // Sheet
  const [selectedQuery, setSelectedQuery] = useState<Query | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editFields, setEditFields] = useState<Partial<Query>>({});

  // Add query dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newQuery, setNewQuery] = useState({ query_text: "", priority: "Medium", due_date: "" });

  // Carry forward dialog
  const [cfOpen, setCfOpen] = useState(false);
  const [cfQuery, setCfQuery] = useState<Query | null>(null);
  const [cfYear, setCfYear] = useState("2025-26");

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    if (clientId) {
      const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
      setClientName(client?.name || "");

      const { data: eng } = await supabase
        .from("audit_engagements")
        .select("id, financial_year")
        .eq("client_id", clientId)
        .order("financial_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (eng) {
        setEngagementId(eng.id);
        setFinancialYear(eng.financial_year || "2024-25");
      }
    }

    let q = supabase.from("audit_client_queries").select("*").order("created_at", { ascending: false });
    if (clientId) q = q.eq("client_id", clientId);

    const { data } = await q;
    setQueries((data as Query[]) || []);
    setLoading(false);
  }, [user, clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("query-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_client_queries" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const filtered = queries.filter((q) => {
    if (filterStatus !== "all" && q.status !== filterStatus) return false;
    if (filterSource !== "all" && q.source !== filterSource) return false;
    if (filterPriority !== "all" && q.priority !== filterPriority) return false;
    return true;
  });

  const openDetail = (q: Query) => {
    setSelectedQuery(q);
    setEditFields({ query_text: q.query_text, client_reply: q.client_reply || "", reply_method: q.reply_method || "", status: q.status, internal_notes: q.internal_notes || "" });
    setSheetOpen(true);
  };

  const saveDetail = async () => {
    if (!selectedQuery) return;
    const { error } = await supabase
      .from("audit_client_queries")
      .update({ ...editFields, updated_at: new Date().toISOString() } as any)
      .eq("id", selectedQuery.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Query updated");
    setSheetOpen(false);
    fetchData();
  };

  const markResolved = async (q: Query) => {
    if (!q.client_reply) {
      toast.error("Client reply must be entered before resolving");
      openDetail(q);
      return;
    }
    await supabase.from("audit_client_queries").update({ status: "Clarified", updated_at: new Date().toISOString() } as any).eq("id", q.id);
    toast.success("Query marked as Clarified");
    fetchData();
  };

  const carryForward = async () => {
    if (!cfQuery) return;
    await supabase.from("audit_client_queries").update({
      status: "Carried Forward",
      carry_forward_to_year: cfYear,
      updated_at: new Date().toISOString(),
    } as any).eq("id", cfQuery.id);
    toast.success(`Query carried forward to ${cfYear}`);
    setCfOpen(false);
    fetchData();
  };

  const addManualQuery = async () => {
    if (!newQuery.query_text.trim()) { toast.error("Query text is required"); return; }
    const refNum = `Q-${Date.now().toString(36).toUpperCase()}`;
    const { error } = await supabase.from("audit_client_queries").insert({
      ref_number: refNum,
      query_text: newQuery.query_text,
      source: "Manual",
      priority: newQuery.priority,
      due_date: newQuery.due_date || null,
      status: "Open",
      client_id: clientId || null,
      firm_id: user?.firm_id || null,
      engagement_id: engagementId,
      financial_year: financialYear,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Query added");
    setAddOpen(false);
    setNewQuery({ query_text: "", priority: "Medium", due_date: "" });
    fetchData();
  };

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-64" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            Audit Queries
            {clientName && <span className="text-muted-foreground font-normal text-lg">— {clientName}</span>}
            {financialYear && <span className="text-muted-foreground font-normal text-lg">— FY {financialYear}</span>}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge className="bg-primary text-primary-foreground">{filtered.length} queries</Badge>
            <Badge variant="destructive">{queries.filter(q => q.status === "Open").length} open</Badge>
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2">
          <Plus size={16} /> Add Query
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Filter size={16} className="text-muted-foreground" />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Ref #</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                  <TableHead>Query</TableHead>
                  <TableHead className="w-36">Status</TableHead>
                  <TableHead className="w-24">Priority</TableHead>
                  <TableHead className="w-28">Due Date</TableHead>
                  <TableHead className="w-28">Carried From</TableHead>
                  <TableHead className="w-44">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      <MessageSquare className="mx-auto h-8 w-8 mb-2 opacity-40" />
                      No queries found. Add a manual query or run scrutiny to generate queries.
                    </TableCell>
                  </TableRow>
                ) : filtered.map((q) => (
                  <TableRow key={q.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(q)}>
                    <TableCell className="font-mono text-xs">{q.ref_number || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SOURCE_COLORS[q.source] || ""}>{q.source}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">{q.query_text}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[q.status] || "bg-muted text-muted-foreground"}>{q.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-semibold ${q.priority === "High" ? "text-destructive" : q.priority === "Low" ? "text-muted-foreground" : "text-foreground"}`}>
                        {q.priority}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{q.due_date || "—"}</TableCell>
                    <TableCell>
                      {q.carry_forward_from_year ? (
                        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          From {q.carry_forward_from_year}
                        </Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openDetail(q)} title="View/Edit">
                          <ExternalLink size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => markResolved(q)} title="Mark Resolved" disabled={q.status === "Closed" || q.status === "Clarified"}>
                          <Check size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setCfQuery(q); setCfOpen(true); }} title="Carry Forward" disabled={q.status === "Closed"}>
                          <ArrowRight size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              Query Detail
              {selectedQuery?.ref_number && <Badge variant="outline" className="font-mono">{selectedQuery.ref_number}</Badge>}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Query Text</Label>
              <Textarea
                value={editFields.query_text || ""}
                onChange={(e) => setEditFields(f => ({ ...f, query_text: e.target.value }))}
                disabled={selectedQuery?.status !== "Open"}
                rows={4}
              />
            </div>
            {selectedQuery?.source_ref_id && (
              <div>
                <Label>Source Reference</Label>
                <Button variant="link" size="sm" className="p-0 h-auto gap-1">
                  View {selectedQuery.source} <ChevronRight size={14} />
                </Button>
              </div>
            )}
            <div>
              <Label>Client Reply</Label>
              <Textarea
                value={editFields.client_reply || ""}
                onChange={(e) => setEditFields(f => ({ ...f, client_reply: e.target.value }))}
                rows={3}
                placeholder="Enter client's reply..."
              />
            </div>
            <div>
              <Label>Reply Method</Label>
              <Select value={editFields.reply_method || ""} onValueChange={(v) => setEditFields(f => ({ ...f, reply_method: v }))}>
                <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                <SelectContent>
                  {["Email", "Portal", "WhatsApp", "Verbal", "Manual"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={editFields.status || ""} onValueChange={(v) => setEditFields(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Internal Notes</Label>
              <Textarea
                value={editFields.internal_notes || ""}
                onChange={(e) => setEditFields(f => ({ ...f, internal_notes: e.target.value }))}
                rows={2}
                placeholder="Notes (not sent to client)..."
              />
            </div>
            <Button onClick={saveDetail} className="w-full">Save Changes</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Add Query Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Manual Query</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Query Text</Label>
              <Textarea value={newQuery.query_text} onChange={(e) => setNewQuery(n => ({ ...n, query_text: e.target.value }))} rows={4} placeholder="Enter query for the client..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Priority</Label>
                <Select value={newQuery.priority} onValueChange={(v) => setNewQuery(n => ({ ...n, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={newQuery.due_date} onChange={(e) => setNewQuery(n => ({ ...n, due_date: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addManualQuery}>Add Query</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Carry Forward Dialog */}
      <Dialog open={cfOpen} onOpenChange={setCfOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Carry Forward Query</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This query will be marked as "Carried Forward" and will appear in the next year's query tracker.</p>
          <div>
            <Label>Target Financial Year</Label>
            <Select value={cfYear} onValueChange={setCfYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["2025-26", "2026-27", "2027-28"].map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCfOpen(false)}>Cancel</Button>
            <Button onClick={carryForward}>Carry Forward</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
