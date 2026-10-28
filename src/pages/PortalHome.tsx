/**
 * PortalHome — Multi-entity client dashboard
 *
 * Uses PortalClientContext so shared-email accounts (e.g. family / group
 * companies) see data for whichever entity they have selected.
 *
 * Theme: CAFlow navy (#0A131E) + amber/gold (#C7A24D).
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { usePortalClient } from "@/contexts/PortalClientContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  FileText, Download, Upload, AlertTriangle, Receipt, CreditCard,
  Bell, Loader2, FolderOpen, ClipboardList, ArrowRight,
  Building2, MessageSquareWarning,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(n);
}

const STAGE_LABELS: Record<number, string> = {
  1: "Engagement Setup", 2: "Workpapers",       3: "Scrutiny",
  4: "Tax Audit",        5: "Financial Stmts",  6: "Notes",
  7: "Reports",          8: "Sign-off",          9: "Filing", 10: "Closure",
};
const TOTAL_STAGES = 10;

const DOC_CATEGORIES = [
  "Bank Statement", "GST Return", "TDS Certificate", "Audit Report",
  "Investment Proof", "Insurance Document", "Vendor Invoice",
  "Board Resolution", "Loan Agreement", "Other",
];

// ─── Audit Progress Card ──────────────────────────────────────────────────────

function AuditProgressCard({ clientId }: { clientId: string }) {
  const [engagements, setEngagements] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    async function load() {
      const [{ data: engs }, { count }] = await Promise.all([
        supabase
          .from("audit_engagements")
          .select("id, financial_year, audit_type, pipeline_stage")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(3),
        supabase
          .from("audit_client_queries" as any)
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId)
          .in("status", ["Open", "Client Acknowledged"]),
      ]);
      setEngagements(engs || []);
      setPendingCount(count || 0);
    }
    load();
  }, [clientId]);

  if (engagements.length === 0 && pendingCount === 0) return null;

  return (
    <Card className="border-l-4 border-l-amber-500">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList size={16} className="text-amber-600" /> Audit Status
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
          const stage      = eng.pipeline_stage || 1;
          const pct        = Math.round((stage / TOTAL_STAGES) * 100);
          const label      = (eng.audit_type || "Audit").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          const stageLabel = STAGE_LABELS[stage] || `Stage ${stage}`;
          return (
            <div key={eng.id} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{label}</span>
                  {eng.financial_year && (
                    <span className="text-xs text-muted-foreground ml-2">FY {eng.financial_year}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  Stage {stage}/{TOTAL_STAGES} · {stageLabel}
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-500"
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


// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PortalHome() {
  const { user } = useAuth();
  const { activeClient, loading: clientLoading } = usePortalClient();

  const [loading,      setLoading]      = useState(true);
  const [firmName,     setFirmName]     = useState("");
  const [partnerName,  setPartnerName]  = useState("");
  const [itrProfile,   setItrProfile]   = useState<any>(null);
  const [tdsSummary,   setTdsSummary]   = useState<any[]>([]);
  const [tdsTotal,     setTdsTotal]     = useState(0);
  const [demands,      setDemands]      = useState<any[]>([]);
  const [documents,    setDocuments]    = useState<any[]>([]);
  const [invoices,     setInvoices]     = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [uploading,    setUploading]    = useState(false);
  const [uploadCategory, setUploadCategory] = useState("Other");

  const fetchAll = useCallback(async () => {
    if (!activeClient) return;
    setLoading(true);

    const [
      { data: firm },
      { data: itr },
      { data: tds },
      { data: dem },
      { data: docs },
      { data: invs },
      { data: notifs },
    ] = await Promise.all([
      activeClient.firm_id
        ? supabase.from("firms").select("name").eq("id", activeClient.firm_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("itr_profiles").select("*").eq("client_id", activeClient.id)
        .order("financial_year", { ascending: false }).limit(2),
      supabase.from("tds_entries").select("section, tds_amount").eq("client_id", activeClient.id),
      supabase.from("itr_demands").select("*").eq("client_id", activeClient.id).eq("status", "open"),
      supabase.from("documents").select("*").eq("client_id", activeClient.id).is("deleted_at", null).order("filename"),
      supabase.from("invoices").select("*").eq("client_id", activeClient.id).neq("status", "voided")
        .order("due_date", { ascending: false }),
      user
        ? supabase.from("notification_log").select("*").eq("recipient_id", user.id)
            .order("sent_at", { ascending: false }).limit(10)
        : Promise.resolve({ data: [] }),
    ]);

    setFirmName(firm?.name || "");
    setItrProfile((itr as any[])?.[0] || null);

    const sectionMap: Record<string, number> = {};
    let total = 0;
    ((tds as any[]) || []).forEach((t: any) => {
      const amt = t.tds_amount || 0;
      sectionMap[t.section || "Other"] = (sectionMap[t.section || "Other"] || 0) + amt;
      total += amt;
    });
    setTdsSummary(Object.entries(sectionMap).map(([s, a]) => ({ section: s, amount: a })));
    setTdsTotal(total);
    setDemands((dem as any[]) || []);
    setDocuments((docs as any[]) || []);
    setInvoices((invs as any[]) || []);
    setNotifications((notifs as any[]) || []);

    // Partner name
    const { data: eng } = await supabase
      .from("audit_engagements")
      .select("partner_id")
      .eq("client_id", activeClient.id)
      .limit(1)
      .maybeSingle();
    if (eng?.partner_id) {
      const { data: p } = await supabase.from("users").select("name").eq("id", eng.partner_id).maybeSingle();
      setPartnerName(p?.name || "");
    } else {
      setPartnerName("");
    }

    setLoading(false);
  }, [activeClient, user]);

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
    if (!file || !activeClient) return;
    setUploading(true);
    try {
      const path = `clients/${activeClient.id}/client_uploads/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("firm-assets")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      await supabase.from("documents").insert({
        firm_id:      activeClient.firm_id,
        client_id:    activeClient.id,
        filename:     file.name,
        category:     "client_upload",
        sub_category: uploadCategory,
        r2_key:       path,
      });

      try {
        await supabase.functions.invoke("send-notification", {
          body: {
            type:    "client_document_uploaded",
            firm_id: activeClient.firm_id,
            content: { client_name: activeClient.name, filename: file.name, category: uploadCategory },
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

  // ── Loading states ─────────────────────────────────────────────────────────

  if (clientLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      </div>
    );
  }

  if (!activeClient) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Building2 className="mx-auto h-12 w-12 mb-4 opacity-25" />
        <p className="text-base font-medium">No client profile found.</p>
        <p className="text-sm mt-2">Please contact your CA firm for assistance.</p>
      </div>
    );
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Welcome banner */}
      <div className="rounded-xl bg-[#0A131E] text-white px-6 py-5 flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center shrink-0">
          <Building2 size={22} className="text-amber-300" />
        </div>
        <div>
          <h1 className="text-lg font-bold">{activeClient.name}</h1>
          <p className="text-sm text-white/70 mt-0.5">
            {firmName && <>Managed by <span className="font-semibold text-white">{firmName}</span></>}
            {partnerName && <> · Partner: <span className="text-white">{partnerName}</span></>}
            {activeClient.pan && <> · PAN: <span className="font-mono text-amber-300">{activeClient.pan}</span></>}
          </p>
        </div>
        <div className="ml-auto">
          <Link to="/portal/queries">
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 gap-1.5 text-xs">
              <MessageSquareWarning size={13} /> Queries
            </Button>
          </Link>
        </div>
      </div>

      {/* Audit Progress */}
      <AuditProgressCard clientId={activeClient.id} />

      {/* Outstanding Demand Alert */}
      {demands.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <div>
              <p className="font-semibold text-destructive">Outstanding Demand Notice</p>
              <p className="text-sm text-muted-foreground">
                {demands.length} demand(s) totalling{" "}
                {formatINR(demands.reduce((s: number, d: any) => s + (d.demand_amount || 0), 0))}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cards row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* ITR Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText size={16} className="text-[#0A131E]" /> ITR Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {itrProfile ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{itrProfile.financial_year}</span>
                  <Badge
                    className={cn(
                      "capitalize text-xs",
                      itrProfile.filing_status === "filed"
                        ? "bg-green-100 text-green-700 border-green-200"
                        : "bg-amber-100 text-amber-700 border-amber-200",
                    )}
                  >
                    {itrProfile.filing_status || "Pending"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Form: {itrProfile.itr_form || "—"}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No ITR data yet</p>
            )}
          </CardContent>
        </Card>

        {/* TDS Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Receipt size={16} className="text-[#0A131E]" /> TDS Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold text-foreground mb-2">{formatINR(tdsTotal)}</p>
            {tdsSummary.length > 0 ? (
              <div className="space-y-1">
                {tdsSummary.slice(0, 5).map(s => (
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

        {/* GST */}
        {activeClient.gstin && (activeClient.gstin as string[]).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">GST Numbers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {(activeClient.gstin as string[]).map((g: string) => (
                <div key={g} className="flex items-center gap-2">
                  <span className="font-mono text-xs">{g}</span>
                  <Badge variant="outline" className="text-[10px] border-green-300 text-green-700">Active</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Documents */}
      {documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FolderOpen size={16} className="text-[#0A131E]" /> My Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {documents.slice(0, 8).map(doc => (
              <div key={doc.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={14} className="text-muted-foreground shrink-0" />
                  <span className="text-sm truncate">{doc.filename}</span>
                  {doc.sub_category && (
                    <Badge variant="outline" className="text-[10px] shrink-0">{doc.sub_category}</Badge>
                  )}
                </div>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDownload(doc)}>
                  <Download size={13} />
                </Button>
              </div>
            ))}
            {documents.length > 8 && (
              <Link to="/portal/documents" className="text-xs text-amber-600 underline underline-offset-2 pt-1 block">
                View all {documents.length} documents →
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invoices */}
      {invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CreditCard size={16} className="text-[#0A131E]" /> Invoices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {invoices.slice(0, 5).map((inv: any) => {
              const total    = (inv.amount || 0) + (inv.gst_amount || 0);
              const isOverdue = inv.status !== "paid" && inv.due_date && new Date(inv.due_date) < new Date();
              return (
                <div key={inv.id} className={cn(
                  "flex items-center justify-between py-2 border-b last:border-0 border-border text-sm",
                  isOverdue && "bg-red-50/50 -mx-4 px-4",
                )}>
                  <div>
                    <span className="font-mono text-xs text-muted-foreground">{inv.invoice_no || "—"}</span>
                    <p className="font-semibold">{formatINR(total)}</p>
                  </div>
                  <div className="text-right">
                    <Badge className={cn(
                      "capitalize text-[10px]",
                      inv.status === "paid" ? "bg-green-100 text-green-700 border-green-200"
                        : isOverdue ? "bg-red-100 text-red-700 border-red-200"
                        : "bg-amber-100 text-amber-700 border-amber-200",
                    )}>
                      {isOverdue ? "Overdue" : inv.status || "Pending"}
                    </Badge>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Due: {inv.due_date || "—"}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Notifications */}
      {notifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bell size={16} className="text-[#0A131E]" /> Recent Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {notifications.map((n: any) => (
              <div key={n.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold capitalize text-foreground">
                    {(n.type || "").replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {typeof n.content === "object"
                      ? n.content?.message || JSON.stringify(n.content)
                      : String(n.content || "")}
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

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Upload size={16} className="text-[#0A131E]" /> Upload Document to Your CA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={uploadCategory} onValueChange={setUploadCategory}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_CATEGORIES.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" asChild disabled={uploading} className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50">
              <label className="cursor-pointer flex items-center justify-center gap-2">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload size={16} />}
                {uploading ? "Uploading…" : "Choose File"}
                <Input type="file" className="hidden" onChange={handleUpload} />
              </label>
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
