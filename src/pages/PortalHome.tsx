import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  FileText, Download, Upload, AlertTriangle, Receipt, CreditCard,
  Bell, Loader2, FolderOpen, ClipboardList, ArrowRight,
} from "lucide-react";

// ─── Audit Progress Card ──────────────────────────────────────────────────────

const STAGE_LABELS: Record<number, string> = {
  1: "Engagement Setup", 2: "Workpapers", 3: "Scrutiny",
  4: "Tax Audit", 5: "Financial Stmts", 6: "Notes",
  7: "Reports", 8: "Sign-off", 9: "Filing", 10: "Closure",
};
const TOTAL_STAGES = 10;

function AuditProgressCard({ clientId }: { clientId: string }) {
  const [engagements, setEngagements] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    async function load() {
      const [{ data: engs }, { count }] = await Promise.all([
        supabase
          .from("audit_engagements")
          .select("id, financial_year, audit_type, pipeline_stage, stage_statuses")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(3),
        supabase
          .from("audit_client_queries")
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId)
          .in("status", ["Open", "Client Acknowledged"]),
      ]);
      setEngagements(engs || []);
      setPendingCount(count || 0);
    }
    load();
  }, [clientId]);

  if (engagements.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList size={16} className="text-primary" /> Audit Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingCount > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                {pendingCount} {pendingCount === 1 ? "query" : "queries"} pending your response
              </span>
            </div>
            <Link to="/portal/queries">
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-amber-700 hover:bg-amber-100">
                View <ArrowRight size={12} />
              </Button>
            </Link>
          </div>
        )}

        {engagements.map(eng => {
          const stage   = eng.pipeline_stage || 1;
          const pct     = Math.round((stage / TOTAL_STAGES) * 100);
          const label   = (eng.audit_type || "Audit").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          const fy      = eng.financial_year || "";
          const stageLabel = STAGE_LABELS[stage] || `Stage ${stage}`;
          return (
            <div key={eng.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{label}</span>
                  {fy && <span className="text-xs text-muted-foreground ml-2">FY {fy}</span>}
                </div>
                <span className="text-xs text-muted-foreground">
                  Stage {stage}/{TOTAL_STAGES} · {stageLabel}
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

const DOC_CATEGORIES = ["Bank Statement", "Investment Proof", "Insurance Document", "Vendor Invoice", "Other"];
const DOC_GROUP_ORDER = ["ITR Documents", "TDS Certificates", "Audit Reports", "Invoices", "Other"];

export default function PortalHome() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [clientData, setClientData] = useState<any>(null);
  const [partnerName, setPartnerName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [itrProfile, setItrProfile] = useState<any>(null);
  const [tdsSummary, setTdsSummary] = useState<any[]>([]);
  const [tdsTotal, setTdsTotal] = useState(0);
  const [demands, setDemands] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("Other");

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Get client record for this user
    const { data: client } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!client) {
      setLoading(false);
      return;
    }
    setClientData(client);

    // Parallel fetches
    const [
      { data: firm },
      { data: itr },
      { data: tds },
      { data: dem },
      { data: docs },
      { data: invs },
      { data: notifs },
    ] = await Promise.all([
      client.firm_id
        ? supabase.from("firms").select("name").eq("id", client.firm_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("itr_profiles").select("*").eq("client_id", client.id)
        .order("financial_year", { ascending: false }).limit(2),
      supabase.from("tds_entries").select("section, tds_amount").eq("client_id", client.id),
      supabase.from("itr_demands").select("*").eq("client_id", client.id).eq("status", "open"),
      supabase.from("documents").select("*").eq("client_id", client.id).order("filename"),
      supabase.from("invoices").select("*").eq("client_id", client.id).order("due_date", { ascending: false }),
      supabase.from("notification_log").select("*").eq("recipient_id", user.id)
        .order("sent_at", { ascending: false }).limit(10),
    ]);

    setFirmName(firm?.name || "");
    setItrProfile(itr?.[0] || null);

    // TDS summary by section
    const sectionMap: Record<string, number> = {};
    let total = 0;
    (tds || []).forEach((t: any) => {
      const amt = t.tds_amount || 0;
      sectionMap[t.section || "Other"] = (sectionMap[t.section || "Other"] || 0) + amt;
      total += amt;
    });
    setTdsSummary(Object.entries(sectionMap).map(([s, a]) => ({ section: s, amount: a })));
    setTdsTotal(total);

    setDemands(dem || []);
    setDocuments(docs || []);
    setInvoices(invs || []);
    setNotifications(notifs || []);

    // Get partner name from an engagement
    const { data: eng } = await supabase
      .from("audit_engagements")
      .select("partner_id")
      .eq("client_id", client.id)
      .limit(1)
      .maybeSingle();
    if (eng?.partner_id) {
      const { data: p } = await supabase.from("users").select("name").eq("id", eng.partner_id).maybeSingle();
      setPartnerName(p?.name || "");
    }

    setLoading(false);
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleDownload(doc: any) {
    try {
      const { data, error } = await supabase.functions.invoke("get-document-url", {
        body: { document_id: doc.id },
      });
      if (error) throw error;
      if (data?.signed_url) window.open(data.signed_url, "_blank");
    } catch (e: any) {
      toast.error(e.message || "Download failed");
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !clientData) return;
    setUploading(true);
    try {
      const path = `clients/${clientData.id}/client_uploads/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      await supabase.from("documents").insert({
        firm_id: clientData.firm_id,
        client_id: clientData.id,
        filename: file.name,
        category: "client_upload",
        sub_category: uploadCategory,
        r2_key: path,
      });

      try {
        await supabase.functions.invoke("send-notification", {
          body: {
            type: "client_document_uploaded",
            firm_id: clientData.firm_id,
            content: { client_name: clientData.name, filename: file.name, category: uploadCategory },
          },
        });
      } catch { /* non-blocking */ }

      toast.success("Document uploaded successfully!");
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  // Group documents
  function groupDocs(docs: any[]) {
    const groups: Record<string, any[]> = {};
    DOC_GROUP_ORDER.forEach((g) => (groups[g] = []));
    docs.forEach((d) => {
      const cat = d.category || "";
      if (cat.includes("itr") || cat.includes("ITR")) groups["ITR Documents"].push(d);
      else if (cat.includes("tds") || cat.includes("TDS")) groups["TDS Certificates"].push(d);
      else if (cat.includes("audit")) groups["Audit Reports"].push(d);
      else if (cat.includes("invoice") || cat.includes("billing")) groups["Invoices"].push(d);
      else groups["Other"].push(d);
    });
    return groups;
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      </div>
    );
  }

  if (!clientData) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>No client profile found for your account.</p>
        <p className="text-sm mt-2">Please contact your CA firm for assistance.</p>
      </div>
    );
  }

  const docGroups = groupDocs(documents);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Welcome back, {clientData.name}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {firmName && <>Managed by <strong>{firmName}</strong></>}
          {partnerName && <> · Partner: <strong>{partnerName}</strong></>}
        </p>
      </div>

      {/* Audit Progress */}
      <AuditProgressCard clientId={clientData.id} />

      {/* Demand Alert */}
      {demands.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <div>
              <p className="font-semibold text-destructive">Outstanding Demand Notice</p>
              <p className="text-sm text-muted-foreground">
                {demands.length} demand(s) totalling {formatINR(demands.reduce((s: number, d: any) => s + (d.demand_amount || 0), 0))}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section 1: Filing Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ITR Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText size={16} className="text-primary" /> ITR Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {itrProfile ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{itrProfile.financial_year}</span>
                  <Badge variant={itrProfile.filing_status === "filed" ? "default" : "secondary"} className="capitalize">
                    {itrProfile.filing_status || "Pending"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Form: {itrProfile.itr_form || "—"}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No ITR data available</p>
            )}
          </CardContent>
        </Card>

        {/* TDS Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Receipt size={16} className="text-primary" /> TDS Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold text-foreground mb-2">{formatINR(tdsTotal)}</p>
            {tdsSummary.length > 0 ? (
              <div className="space-y-1">
                {tdsSummary.slice(0, 5).map((s) => (
                  <div key={s.section} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{s.section}</span>
                    <span className="font-medium">{formatINR(s.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No TDS entries</p>
            )}
          </CardContent>
        </Card>

        {/* GST Status */}
        {clientData.gstin && clientData.gstin.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">GST Status</CardTitle>
            </CardHeader>
            <CardContent>
              {clientData.gstin.map((g: string) => (
                <div key={g} className="flex items-center gap-2 text-sm mb-1">
                  <span className="font-mono text-xs">{g}</span>
                  <Badge variant="outline" className="text-[10px]">Active</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Section 2: Documents */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen size={18} className="text-primary" /> My Documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No documents available yet.</p>
          ) : (
            <div className="space-y-6">
              {DOC_GROUP_ORDER.filter((g) => docGroups[g].length > 0).map((group) => (
                <div key={group}>
                  <h4 className="text-sm font-semibold text-foreground mb-2">{group}</h4>
                  <div className="space-y-1">
                    {docGroups[group].map((doc: any) => (
                      <div key={doc.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={14} className="text-muted-foreground shrink-0" />
                          <span className="text-sm truncate">{doc.filename}</span>
                          {doc.sub_category && (
                            <Badge variant="outline" className="text-[10px] shrink-0">{doc.sub_category}</Badge>
                          )}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => handleDownload(doc)}>
                          <Download size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Invoices */}
      {invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard size={18} className="text-primary" /> Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice No</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv: any) => {
                    const total = (inv.amount || 0) + (inv.gst_amount || 0);
                    const isOverdue = inv.status !== "paid" && inv.due_date && new Date(inv.due_date) < new Date();
                    return (
                      <TableRow key={inv.id} className={isOverdue ? "bg-destructive/5" : ""}>
                        <TableCell className="font-mono text-sm">{inv.invoice_no || "—"}</TableCell>
                        <TableCell className="text-right">{formatINR(inv.amount || 0)}</TableCell>
                        <TableCell className="text-right">{formatINR(inv.gst_amount || 0)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatINR(total)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={inv.status === "paid" ? "default" : isOverdue ? "destructive" : "secondary"}
                            className="capitalize"
                          >
                            {isOverdue ? "Overdue" : inv.status || "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{inv.due_date || "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section 4: Notifications */}
      {notifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell size={18} className="text-primary" /> Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {notifications.map((n: any) => (
              <div key={n.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground capitalize">{(n.type || "").replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {typeof n.content === "object" ? n.content?.message || JSON.stringify(n.content) : String(n.content || "")}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant="outline" className="text-[10px]">{n.channel || "—"}</Badge>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {n.sent_at ? new Date(n.sent_at).toLocaleDateString("en-IN") : ""}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Section 5: Secure Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload size={18} className="text-primary" /> Upload a Document to Your CA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={uploadCategory} onValueChange={setUploadCategory}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" asChild disabled={uploading} className="flex-1">
              <label className="cursor-pointer flex items-center justify-center gap-2">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload size={16} />}
                {uploading ? "Uploading..." : "Choose File"}
                <Input type="file" className="hidden" onChange={handleUpload} />
              </label>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
