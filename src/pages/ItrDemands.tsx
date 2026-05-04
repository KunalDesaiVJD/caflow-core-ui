import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Plus, AlertTriangle, FileText, Upload, Sparkles, Loader2,
  Trash2, Download,
} from "lucide-react";
import { format, isPast } from "date-fns";

interface Demand {
  id: string;
  client_id: string | null;
  demand_amount: number | null;
  financial_year: string | null;
  notice_type: string | null;
  section: string | null;
  status: string | null;
  response_due_date: string | null;
  client_name?: string;
  entity_type?: string;
}

interface Client {
  id: string;
  name: string | null;
  entity_type: string | null;
}

const NOTICE_TYPES = [
  "143(1) Intimation",
  "148 Scrutiny",
  "TDS Default",
  "GST Demand",
  "FEMA",
];

const STATUS_COLORS: Record<string, string> = {
  Open: "bg-destructive/15 text-destructive",
  Responded: "bg-amber-500/15 text-amber-600",
  Closed: "bg-emerald-500/15 text-emerald-600",
};

const NOTICE_TYPE_COLORS: Record<string, string> = {
  "143(1) Intimation": "bg-blue-500/15 text-blue-600",
  "148 Scrutiny": "bg-destructive/15 text-destructive",
  "TDS Default": "bg-amber-500/15 text-amber-600",
  "GST Demand": "bg-purple-500/15 text-purple-600",
  "FEMA": "bg-orange-500/15 text-orange-600",
};

const AY_OPTIONS = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2020-21"];

export default function ItrDemands() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [demands, setDemands] = useState<Demand[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteDemand, setDeleteDemand] = useState<Demand | null>(null);

  // Form
  const [formClientId, setFormClientId] = useState("");
  const [formAY, setFormAY] = useState("2024-25");
  const [formSection, setFormSection] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formNoticeType, setFormNoticeType] = useState("");
  const [formDateReceived, setFormDateReceived] = useState("");
  const [formDueDate, setFormDueDate] = useState("");

  // File upload
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [uploadedDocId, setUploadedDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // AI Draft
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const firmId = user?.firm_id;
  const isSuperadmin = user?.role === "superadmin";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [demandRes, clientRes] = await Promise.all([
        supabase.from("itr_demands").select("*"),
        supabase.from("clients").select("id, name, entity_type").eq("is_draft", false).is("deleted_at", null).neq("is_active", false),
      ]);

      const clientMap = new Map<string, Client>();
      (clientRes.data || []).forEach(c => clientMap.set(c.id, c));

      const enriched = (demandRes.data || []).map(d => ({
        ...d,
        client_name: clientMap.get(d.client_id || "")?.name || "Unknown",
        entity_type: clientMap.get(d.client_id || "")?.entity_type || "",
      }));

      setDemands(enriched);
      setClients(clientRes.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  function resetForm() {
    setFormClientId("");
    setFormAY("2024-25");
    setFormSection("");
    setFormAmount("");
    setFormNoticeType("");
    setFormDateReceived("");
    setFormDueDate("");
    setUploadedFile(null);
    setUploadedDocId(null);
    setAiDraft("");
    setAiDraftOpen(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !formClientId) {
      toast({ title: "Select a client first", variant: "destructive" });
      return;
    }
    if (file.type !== "application/pdf") {
      toast({ title: "Only PDF files are allowed", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large (max 20MB)", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const path = `clients/${formClientId}/itr/demands/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("firm-assets").upload(path, file);
      if (uploadError) throw uploadError;

      // Save to documents table
      const { data: doc, error: docError } = await supabase.from("documents").insert({
        client_id: formClientId,
        firm_id: firmId,
        filename: file.name,
        r2_key: path,
        category: "notice",
        tags: ["demand_notice"],
      } as any).select("id").single();
      if (docError) throw docError;

      setUploadedFile(file.name);
      setUploadedDocId(doc.id);
      toast({ title: "Notice file uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleAiDraft() {
    if (!uploadedDocId) return;
    setAiDraftOpen(true);
    setAiLoading(true);
    setAiDraft("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(
        `https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/claude-gateway`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc",
          },
          body: JSON.stringify({
            request_type: "notice_response_drafter",
            user_message: `Draft a professional response to the following income tax notice:\n\nNotice Type: ${formNoticeType}\nSection: ${formSection}\nAssessment Year: ${formAY}\nDemand Amount: ₹${formAmount}\n\nPlease draft a formal response letter addressing this demand/notice with appropriate legal references.`,
            stream: true,
          }),
        }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.delta?.text || parsed?.content_block?.text || "";
                if (delta) {
                  fullText += delta;
                  setAiDraft(fullText);
                }
              } catch {
                fullText += data;
                setAiDraft(fullText);
              }
            }
          }
        }
      }
    } catch (err: any) {
      toast({ title: "AI Error", description: err.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSave() {
    if (!formClientId || !formNoticeType) {
      toast({ title: "Client and Notice Type are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("itr_demands").insert({
        client_id: formClientId,
        financial_year: formAY,
        section: formSection || null,
        demand_amount: formAmount ? Number(formAmount) : null,
        notice_type: formNoticeType,
        response_due_date: formDueDate || null,
        status: "Open",
      } as any);
      if (error) throw error;
      toast({ title: "Notice added successfully" });
      setSheetOpen(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteDemand) return;
    try {
      const { error } = await supabase.from("itr_demands").delete().eq("id", deleteDemand.id);
      if (error) throw error;
      toast({ title: "Notice deleted" });
      setDeleteDemand(null);
      fetchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase.from("itr_demands").update({ status } as any).eq("id", id);
    if (!error) fetchData();
  }

  // Stats
  const totalDemand = demands.reduce((s, d) => s + (d.demand_amount || 0), 0);
  const openCount = demands.filter(d => d.status === "Open").length;
  const respondedCount = demands.filter(d => d.status === "Responded").length;
  const closedCount = demands.filter(d => d.status === "Closed").length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/itr")}>
            <ArrowLeft size={20} />
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Demand & Notice Tracker</h1>
            <p className="text-muted-foreground text-sm">Track income tax demands, notices, and responses</p>
          </div>
        </div>
        <Button onClick={() => { resetForm(); setSheetOpen(true); }}>
          <Plus size={16} className="mr-2" /> Add Notice
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText size={16} className="text-foreground" />
              <span className="text-xs text-muted-foreground">Total Notices</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{demands.length}</p>
          </CardContent>
        </Card>
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} className="text-destructive" />
              <span className="text-xs text-muted-foreground">Open</span>
            </div>
            <p className="text-2xl font-bold text-destructive">{openCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">Total Demand</span>
            </div>
            <p className="text-2xl font-bold text-destructive">₹{totalDemand.toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">Responded / Closed</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{respondedCount} / {closedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>AY</TableHead>
                <TableHead>Section</TableHead>
                <TableHead className="text-right">Demand Amount</TableHead>
                <TableHead>Notice Type</TableHead>
                <TableHead>Response Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {demands.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No demands or notices found. Click "Add Notice" to get started.
                  </TableCell>
                </TableRow>
              ) : (
                demands.map(d => {
                  const duePast = d.response_due_date && isPast(new Date(d.response_due_date)) && d.status === "Open";
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{d.client_name}</span>
                          {d.entity_type && (
                            <Badge variant="outline" className="ml-2 text-[10px]">{d.entity_type}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{d.financial_year || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{d.section || "—"}</TableCell>
                      <TableCell className="text-right font-medium text-destructive">
                        {d.demand_amount ? `₹${d.demand_amount.toLocaleString("en-IN")}` : "—"}
                      </TableCell>
                      <TableCell>
                        {d.notice_type ? (
                          <Badge className={NOTICE_TYPE_COLORS[d.notice_type] || "bg-muted text-muted-foreground"}>
                            {d.notice_type}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className={duePast ? "text-destructive font-medium" : "text-muted-foreground"}>
                        {d.response_due_date ? format(new Date(d.response_due_date), "dd MMM yyyy") : "—"}
                        {duePast && <span className="text-xs ml-1">(Overdue)</span>}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={d.status || "Open"}
                          onValueChange={v => updateStatus(d.id, v)}
                        >
                          <SelectTrigger className="h-7 w-[120px]">
                            <Badge className={STATUS_COLORS[d.status || "Open"]}>{d.status || "Open"}</Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {["Open", "Responded", "Closed"].map(s => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteDemand(d)}>
                          <Trash2 size={14} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Notice Sheet */}
      <Sheet open={sheetOpen} onOpenChange={open => { if (!open) { setSheetOpen(false); resetForm(); } }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Add Notice</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select value={formClientId} onValueChange={setFormClientId}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name} ({c.entity_type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Assessment Year</Label>
              <Select value={formAY} onValueChange={setFormAY}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AY_OPTIONS.map(ay => <SelectItem key={ay} value={ay}>{ay}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Section</Label>
              <Input value={formSection} onChange={e => setFormSection(e.target.value)} placeholder="e.g. 143(1)" />
            </div>
            <div className="space-y-2">
              <Label>Demand Amount (₹)</Label>
              <Input type="number" value={formAmount} onChange={e => setFormAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-2">
              <Label>Notice Type</Label>
              <Select value={formNoticeType} onValueChange={setFormNoticeType}>
                <SelectTrigger><SelectValue placeholder="Select notice type" /></SelectTrigger>
                <SelectContent>
                  {NOTICE_TYPES.map(nt => <SelectItem key={nt} value={nt}>{nt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date Received</Label>
              <Input type="date" value={formDateReceived} onChange={e => setFormDateReceived(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Response Due Date</Label>
              <Input type="date" value={formDueDate} onChange={e => setFormDueDate(e.target.value)} />
            </div>

            {/* File Upload */}
            <div className="space-y-2">
              <Label>Upload Notice File (PDF)</Label>
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || !formClientId}
                className="gap-2 w-full"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploadedFile ? uploadedFile : "Upload Notice PDF"}
              </Button>
              {!formClientId && <p className="text-xs text-muted-foreground">Select a client first to upload</p>}
            </div>

            {/* AI Draft Response Button */}
            {uploadedDocId && (
              <Button variant="outline" onClick={handleAiDraft} disabled={aiLoading} className="w-full gap-2">
                <Sparkles size={16} />
                {aiLoading ? "Drafting..." : "AI Draft Response"}
              </Button>
            )}

            {/* AI Draft Panel */}
            {aiDraftOpen && (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Sparkles size={14} className="text-primary" /> AI Draft Response
                  </h4>
                </div>
                {aiLoading && (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                    <span className="text-xs text-muted-foreground">Streaming...</span>
                  </div>
                )}
                <Textarea
                  value={aiDraft}
                  onChange={e => setAiDraft(e.target.value)}
                  rows={10}
                  placeholder="AI response will appear here..."
                  className="text-sm"
                />
              </div>
            )}
          </div>
          <SheetFooter className="mt-4">
            <Button onClick={handleSave} disabled={saving || !formClientId || !formNoticeType} className="w-full">
              {saving ? "Saving..." : "Add Notice"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDemand} onOpenChange={open => { if (!open) setDeleteDemand(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Notice</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this demand notice for <strong>{deleteDemand?.client_name}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
