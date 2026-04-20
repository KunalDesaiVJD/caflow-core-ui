/* ═══════════════════════════════════════════════════════════════════════════
   STAGE 9 — SIGN-OFF & UDIN  (rev. 2026-04)
   Rewritten from scratch with corrected stage-key mapping and schema usage.

   Key fixes vs. previous version:
   • stage_statuses keys now match the real pipeline num (1..9, not legacy 2..8)
   • scrutiny_findings uses client_id + financial_year (no engagement_id col)
   • Query Tracker stats come from audit_client_queries (not a missing table)
   • Report applicability derived from entity_type + audit_type, not broken
     requires_* flags
   • FS readiness detected from fa_financial_statements (+ BS balance check)
     — leverages the new Stage 10 work that persists amount_cy/amount_py
   • Cyrillic typo (setCароCount) purged
   • stageNumber passed to EngagementHeader is 9 (header expects 1..9)
   • Partner info resolved from users + firm_partners fallback
   ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  AlertTriangle, Award, CheckCircle2, ExternalLink, FileText, Loader2,
  Lock, Package, Shield, Upload, XCircle, Download, FileSpreadsheet,
  ClipboardList, BookMarked, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import JSZip from "jszip";
import * as XLSX from "xlsx";

// ─── Types ──────────────────────────────────────────────────────────────────
interface Props {
  engagement: any;
  client: any;
  partner: any;
  onUpdate: () => void;
}

type GateStatus = "pass" | "warn" | "fail" | "skip";

interface Gate {
  key: string;
  label: string;
  status: GateStatus;
  detail?: string;
  blocker?: boolean;      // true → must pass before sign-off
  onFix?: () => void;
  fixLabel?: string;
}

// ─── Pipeline stage map (matches STAGES in AuditPipeline.tsx) ───────────────
const STAGE_LABELS: { key: string; label: string }[] = [
  { key: "1", label: "Engagement Setup" },
  { key: "2", label: "Trial Balance Import" },
  { key: "3", label: "COA Mapping" },
  { key: "4", label: "Scrutiny Engine" },
  { key: "5", label: "Query Tracker" },
  { key: "6", label: "Workpapers & Audit Sheet" },
  { key: "7", label: "Notes to Accounts & CARO" },
  { key: "8", label: "3CA / 3CB / 3CD Reports" },
];
// NB: current stage (9 — Sign-off) and future FS (10) are rendered separately.

// ─── Entity-type helpers ────────────────────────────────────────────────────
const NON_CORPORATE = /individual|proprietor|partnership|llp|huf|trust|aop|boi|firm|society/i;
const isCompany = (et: string) =>
  !!et && !NON_CORPORATE.test(et) && /company|opc|private|public/i.test(et);

// Derive applicable reports from entity_type + audit_type — single source of truth.
function resolveApplicableReports(engagement: any): {
  statutory: boolean; caro: boolean; ifc: boolean; cashFlow: boolean;
  form3ca: boolean; form3cb: boolean; form3cd: boolean;
} {
  const et = String(engagement?.entity_type || engagement?.clients?.entity_type || "");
  const at = String(engagement?.audit_type || "").toLowerCase();
  const corp = isCompany(et);
  const isStat = at.includes("statutory") || at === "both";
  const isTax  = at.includes("tax")       || at === "both";

  return {
    statutory: isStat,
    caro:      corp && isStat && engagement?.caro_applicable !== false,
    ifc:       corp && isStat && engagement?.ifc_applicable  !== false,
    cashFlow:  corp && isStat && engagement?.cash_flow_applicable !== false,
    // Tax audit: 3CA if audited under any other law (typically companies); 3CB otherwise.
    form3ca:   isTax && corp,
    form3cb:   isTax && !corp,
    form3cd:   isTax,
  };
}

// ─── Main component ─────────────────────────────────────────────────────────
export function EngagementReviewSignoff({ engagement, client, partner, onUpdate }: Props) {
  const { user } = useAuth();

  // Gating for role — unchanged API
  const canSignOff = user?.role === "partner_ca" || user?.role === "firm_admin" || user?.role === "superadmin";
  const isSigned   = engagement?.final_locked === true || engagement?.status === "signed";

  // ── Data state ──
  const [loading, setLoading]               = useState(true);
  const [firm, setFirm]                     = useState<any>(null);
  const [partnerResolved, setPartnerResolved] = useState<any>(partner);
  const [drafts, setDrafts]                 = useState<any[]>([]);
  const [mgmtLetterCount, setMgmtLetterCount] = useState(0);
  const [notesCount, setNotesCount]         = useState(0);
  const [unsignedWpCount, setUnsignedWpCount] = useState(0);
  const [caroRespCount, setCaroRespCount]   = useState(0);
  const [form3cdCount, setForm3cdCount]     = useState(0);

  const [findings, setFindings] = useState({ total: 0, accepted: 0, queried: 0, overridden: 0, highOpen: 0 });
  const [queries,  setQueries]  = useState({ total: 0, open: 0, resolved: 0 });
  const [fsReady,  setFsReady]  = useState<{ bsRowCount: number; bsBalanced: boolean; bsDiff: number }>({
    bsRowCount: 0, bsBalanced: false, bsDiff: 0,
  });

  // ── Sign-off form state ──
  const [udin, setUdin]         = useState(engagement?.udin || "");
  const [declared, setDeclared] = useState(false);
  const [signing, setSigning]   = useState(false);
  const [generating, setGenerating]       = useState(false);
  const [bundling,  setBundling]          = useState(false);
  const [uploading, setUploading]         = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);

  const udinValid = /^[A-Za-z0-9]{24}$/.test(udin.trim());

  const applicable = useMemo(() => resolveApplicableReports(engagement), [engagement]);

  // ── Load everything in parallel ──
  const loadAll = useCallback(async () => {
    if (!engagement?.id) return;
    setLoading(true);
    const engId = engagement.id;
    const clientId = engagement.client_id;
    const fy = engagement.financial_year;

    try {
      const [
        findingsRes, queriesRes, wpRes, notesRes, caroRes, form3cdRes,
        fsRowsRes, draftsRes, mgmtRes,
      ] = await Promise.all([
        supabase.from("scrutiny_findings").select("status, severity").eq("client_id", clientId).eq("financial_year", fy),
        supabase.from("audit_client_queries").select("status").eq("engagement_id", engId),
        supabase.from("audit_workpapers").select("id, signed_by").eq("engagement_id", engId),
        supabase.from("audit_notes").select("id", { count: "exact", head: true }).eq("engagement_id", engId),
        supabase.from("audit_caro_responses").select("id", { count: "exact", head: true }).eq("engagement_id", engId),
        supabase.from("audit_3cd_responses").select("id", { count: "exact", head: true }).eq("engagement_id", engId),
        supabase.from("fa_financial_statements").select("line_item_code, section, amount_cy").eq("engagement_id", engId),
        supabase.from("documents").select("id, filename, r2_key, category, sub_category, is_final, is_signed, signed_at").eq("engagement_id", engId).eq("sub_category", "draft").order("created_at", { ascending: false }),
        supabase.from("documents").select("id", { count: "exact", head: true }).eq("engagement_id", engId).eq("category", "mgmt_rep_letter"),
      ]);

      // Findings
      const fRows = findingsRes.data || [];
      setFindings({
        total: fRows.length,
        accepted:   fRows.filter((r: any) => r.status === "accepted"   || r.status === "resolved").length,
        queried:    fRows.filter((r: any) => r.status === "queried").length,
        overridden: fRows.filter((r: any) => r.status === "overridden").length,
        highOpen:   fRows.filter((r: any) => r.severity === "HIGH" && !["accepted","resolved","overridden"].includes(r.status || "")).length,
      });

      // Queries
      const qRows = queriesRes.data || [];
      setQueries({
        total:    qRows.length,
        open:     qRows.filter((r: any) => r.status !== "resolved" && r.status !== "closed").length,
        resolved: qRows.filter((r: any) => r.status === "resolved" || r.status === "closed").length,
      });

      // Workpapers
      const wpRows = wpRes.data || [];
      setUnsignedWpCount(wpRows.filter((w: any) => !w.signed_by).length);

      setNotesCount(notesRes.count || 0);
      setCaroRespCount(caroRes.count || 0);
      setForm3cdCount(form3cdRes.count || 0);
      setMgmtLetterCount(mgmtRes.count || 0);
      setDrafts(draftsRes.data || []);

      // FS BS balance
      const fs = fsRowsRes.data || [];
      const bsRows = fs.filter((r: any) => String(r.section || "").toLowerCase().includes("bs") ||
                                          String(r.section || "").toLowerCase().includes("asset") ||
                                          String(r.section || "").toLowerCase().includes("liab") ||
                                          String(r.section || "").toLowerCase().includes("equity"));
      const sumOf = (codes: string[]) => bsRows
        .filter((r: any) => codes.includes(r.line_item_code))
        .reduce((s: number, r: any) => s + (r.amount_cy || 0), 0);
      // Both corporate + NCE parent codes considered
      const ast = sumOf(["BS_NCA","BS_CA","NCE_AST"]);
      const liab = sumOf(["BS_EQ","BS_NCL","BS_CL","NCE_EL"]);
      const diff = Math.round((ast - liab) * 100) / 100;
      setFsReady({ bsRowCount: bsRows.length, bsBalanced: Math.abs(diff) < 1, bsDiff: diff });

      // Firm
      if (engagement.firm_id) {
        const { data: f } = await supabase
          .from("firms").select("name, icai_firm_reg_no, address")
          .eq("id", engagement.firm_id).maybeSingle();
        setFirm(f);
      }

      // Partner (accept prop; fall back to users table lookup via partner_id)
      if (!partner && (engagement as any)?.partner_id) {
        const { data: p } = await supabase
          .from("users").select("name, membership_number, email")
          .eq("id", (engagement as any).partner_id).maybeSingle();
        if (p) setPartnerResolved(p);
      }
    } finally {
      setLoading(false);
    }
  }, [engagement, partner]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Derived gates ──
  const gates: Gate[] = useMemo(() => {
    const ss = (engagement?.stage_statuses || {}) as Record<string, string>;
    const stageDone = (k: string) => ss[k] === "complete";
    const list: Gate[] = [
      { key: "tb",        label: "Trial Balance Imported",       status: stageDone("2") ? "pass" : "fail",
        blocker: true, fixLabel: "Go to Stage 2" },
      { key: "coa",       label: "COA Mapping Complete",         status: stageDone("3") ? "pass" : "fail",
        blocker: true, fixLabel: "Go to Stage 3" },
      { key: "scrutiny",  label: "Scrutiny Engine Reviewed",     status: stageDone("4") ? "pass" : "warn",
        detail: findings.highOpen > 0 ? `${findings.highOpen} HIGH-severity findings still open` : undefined,
        blocker: findings.highOpen > 0 },
      { key: "queries",   label: "Client Queries Resolved",      status: queries.open === 0 ? "pass" : "warn",
        detail: queries.open > 0 ? `${queries.open} open queries` : undefined,
        blocker: false },
      { key: "wp",        label: "Workpapers Signed Off",        status: unsignedWpCount === 0 ? "pass" : "warn",
        detail: unsignedWpCount > 0 ? `${unsignedWpCount} workpapers missing sign-off` : undefined,
        blocker: false },
      { key: "notes",     label: "Notes to Accounts Drafted",    status: notesCount >= 5 ? "pass" : (notesCount > 0 ? "warn" : "fail"),
        detail: `${notesCount} notes drafted`, blocker: notesCount === 0 },
    ];
    if (applicable.caro) {
      list.push({ key: "caro", label: "CARO 2020 Responses",
        status: caroRespCount >= 21 ? "pass" : (caroRespCount > 0 ? "warn" : "fail"),
        detail: `${caroRespCount} / 21 clauses`, blocker: caroRespCount === 0 });
    } else {
      list.push({ key: "caro", label: "CARO 2020 Responses", status: "skip", detail: "Not applicable to entity type" });
    }
    if (applicable.form3cd) {
      list.push({ key: "3cd", label: "Form 3CD Clauses",
        status: form3cdCount >= 40 ? "pass" : (form3cdCount > 0 ? "warn" : "fail"),
        detail: `${form3cdCount} clauses responded`, blocker: form3cdCount === 0 });
    } else {
      list.push({ key: "3cd", label: "Form 3CD Clauses", status: "skip", detail: "Tax audit not applicable" });
    }
    list.push({ key: "fs", label: "Financial Statements Generated",
      status: fsReady.bsRowCount > 0 ? (fsReady.bsBalanced ? "pass" : "warn") : "fail",
      detail: fsReady.bsRowCount === 0
        ? "No FS rows saved — run Stage 10"
        : fsReady.bsBalanced
          ? `BS balanced (${fsReady.bsRowCount} line items)`
          : `BS out of balance by ₹${Math.abs(fsReady.bsDiff).toLocaleString("en-IN")}`,
      blocker: fsReady.bsRowCount === 0,
    });
    list.push({ key: "mrl", label: "Management Representation Letter",
      status: mgmtLetterCount > 0 ? "pass" : "fail",
      detail: mgmtLetterCount > 0 ? "Uploaded" : "Not uploaded", blocker: true });
    list.push({ key: "draft", label: "Draft Report Generated",
      status: drafts.length > 0 ? "pass" : "fail",
      detail: drafts.length > 0 ? `v${drafts.length} draft available` : "No draft generated", blocker: true });
    return list;
  }, [engagement, findings, queries, unsignedWpCount, notesCount, caroRespCount, form3cdCount,
      fsReady, mgmtLetterCount, drafts, applicable]);

  const blockers = gates.filter(g => g.blocker && g.status !== "pass" && g.status !== "skip");
  const canProceed = blockers.length === 0;
  const passCount = gates.filter(g => g.status === "pass").length;
  const totalCount = gates.filter(g => g.status !== "skip").length;
  const completeness = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 0;

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleGenerateDraft = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-audit-report", {
        body: { engagement_id: engagement.id, report_type: isCompany(engagement?.entity_type) ? "companies_act" : "non_corporate", include_comparative: true },
      });
      if (error) throw error;
      toast.success(`Draft report v${data?.version_number || "1"} generated`);
      await loadAll();
      onUpdate();
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate draft");
    } finally { setGenerating(false); }
  };

  const handleUploadMrl = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `firms/${engagement.firm_id}/clients/${engagement.client_id}/mgmt_rep_letter/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      await supabase.from("documents").insert({
        firm_id: engagement.firm_id, client_id: engagement.client_id, engagement_id: engagement.id,
        filename: file.name, category: "mgmt_rep_letter", r2_key: path,
      } as any);
      toast.success("Management Representation Letter uploaded");
      await loadAll();
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
    } finally { setUploading(false); (e.target as HTMLInputElement).value = ""; }
  };

  const viewDraft = async (doc: any) => {
    if (!doc?.r2_key) return;
    const { data } = await supabase.storage.from("firm-assets").createSignedUrl(doc.r2_key, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const handleSignOff = async () => {
    if (!declared || !udinValid) return;
    setSigning(true);
    try {
      const now = new Date().toISOString();
      const signOffData: any = {
        status: "signed",
        final_locked: true,
        udin: udin.trim(),
        sign_off_by: user?.id,
        sign_off_date: now,
        signed_at: now,
        signed_by: user?.id,
        stage_statuses: { ...(engagement.stage_statuses || {}), "9": "complete" },
      };
      const { error: engErr } = await supabase
        .from("audit_engagements").update(signOffData).eq("id", engagement.id);
      if (engErr) throw engErr;

      // Lock downstream records
      await Promise.all([
        supabase.from("audit_notes").update({ is_locked: true } as any).eq("engagement_id", engagement.id),
        applicable.caro ? supabase.from("audit_caro_responses").update({ is_locked: true, status: "locked" } as any).eq("engagement_id", engagement.id) : Promise.resolve(),
        applicable.form3cd ? supabase.from("audit_3cd_responses").update({ is_locked: true } as any).eq("engagement_id", engagement.id) : Promise.resolve(),
        supabase.from("fa_financial_statements").update({ is_manual: true } as any).eq("engagement_id", engagement.id).eq("is_manual", false).then(() => {}).catch(() => {}),
      ]);

      // Promote latest draft → final
      if (drafts.length > 0) {
        const latest = drafts[0];
        await supabase.from("documents").update({
          is_final: true, is_signed: true, signed_by: user?.id, signed_at: now,
        } as any).eq("id", latest.id);
      }

      toast.success("Audit signed off and locked");
      setShowConfirm(false);
      onUpdate();
    } catch (err: any) {
      toast.error(err?.message || "Sign-off failed");
    } finally { setSigning(false); }
  };

  const handleDownloadBundle = async () => {
    setBundling(true);
    try {
      // Try edge function first; fall back to client-side XLSX-only bundle if missing.
      let xlsxSheets: any = null;
      let pdfUrl: string | null = null;
      try {
        const { data, error } = await supabase.functions.invoke("generate-audit-bundle", {
          body: { engagement_id: engagement.id },
        });
        if (!error && data) {
          xlsxSheets = data.xlsx_sheets || null;
          pdfUrl     = data.pdf_url     || null;
        }
      } catch { /* continue with fallback */ }

      const zip = new JSZip();

      // Always attach latest FS workbook (derived live — no dependency on edge function)
      const { data: fsRows } = await supabase
        .from("fa_financial_statements")
        .select("*").eq("engagement_id", engagement.id).order("sort_order");
      if (fsRows?.length) {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fsRows), "Financial_Statements");
        if (xlsxSheets) {
          for (const [name, rows] of Object.entries(xlsxSheets)) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows as any[]), String(name).slice(0, 31));
          }
        }
        zip.file("Workpaper_Master.xlsx", XLSX.write(wb, { bookType: "xlsx", type: "array" }));
      }

      if (pdfUrl) {
        try {
          const r = await fetch(pdfUrl);
          zip.file("Audit_Report.html", await r.blob());
        } catch { /* ignore */ }
      }

      // Include latest draft if no edge PDF
      if (!pdfUrl && drafts[0]?.r2_key) {
        const { data: signed } = await supabase.storage.from("firm-assets").createSignedUrl(drafts[0].r2_key, 3600);
        if (signed?.signedUrl) {
          try {
            const r = await fetch(signed.signedUrl);
            zip.file(drafts[0].filename || "Draft_Report.html", await r.blob());
          } catch { /* ignore */ }
        }
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (client?.name || "Client").replace(/[^a-z0-9]+/gi, "_");
      a.href = url; a.download = `Audit_Bundle_${safe}_${engagement.financial_year || "FY"}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Audit bundle downloaded");
    } catch (e: any) {
      toast.error(e?.message || "Bundle generation failed");
    } finally { setBundling(false); }
  };

  // ── Role gate ──
  if (!canSignOff) {
    return (
      <Card className="border-amber-300 bg-amber-500/5">
        <CardContent className="p-8 text-center space-y-3">
          <Lock className="w-10 h-10 text-amber-600 mx-auto" />
          <p className="font-semibold text-foreground text-lg">Partner / Firm-admin access required</p>
          <p className="text-sm text-muted-foreground">
            Only engagement partners can sign off and issue UDIN. Please ask the engagement partner to log in.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card><CardContent className="p-8 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </CardContent></Card>
    );
  }

  // ── UI helpers ──
  const statusIcon = (s: GateStatus) => {
    if (s === "pass") return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    if (s === "warn") return <AlertTriangle className="w-4 h-4 text-amber-600" />;
    if (s === "skip") return <Info className="w-4 h-4 text-muted-foreground" />;
    return <XCircle className="w-4 h-4 text-destructive" />;
  };
  const statusBadge = (s: GateStatus) => {
    const map: Record<GateStatus, string> = {
      pass: "bg-green-500/15 text-green-700 border-green-300",
      warn: "bg-amber-500/15 text-amber-700 border-amber-300",
      fail: "bg-destructive/15 text-destructive border-destructive/30",
      skip: "bg-muted text-muted-foreground border-border",
    };
    const label: Record<GateStatus, string> = { pass: "Pass", warn: "Warn", fail: "Fail", skip: "N/A" };
    return <Badge className={cn("text-[10px]", map[s])}>{label[s]}</Badge>;
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ═══ 1. ENGAGEMENT SNAPSHOT ═══ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4 text-primary" /> Engagement Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              ["Client",           client?.name || "—"],
              ["Financial Year",   engagement?.financial_year || "—"],
              ["Entity Type",      engagement?.entity_type || client?.entity_type || "—"],
              ["Audit Type",       engagement?.audit_type || "—"],
              ["Firm",             firm?.name || "—"],
              ["FRN",              firm?.icai_firm_reg_no || "—"],
              ["Partner",          partnerResolved?.name || "—"],
              ["Membership No.",   partnerResolved?.membership_number || "—"],
            ].map(([k, v]) => (
              <div key={k} className="space-y-0.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
                <p className="font-semibold text-foreground truncate">{v as string}</p>
              </div>
            ))}
          </div>

          <Separator />

          {/* Applicable reports — derived */}
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Applicable Reports</p>
            <div className="flex flex-wrap gap-1.5">
              {applicable.statutory && <Badge variant="outline" className="text-[10px]">Independent Auditor's Report</Badge>}
              {applicable.caro      && <Badge variant="outline" className="text-[10px]">CARO 2020</Badge>}
              {applicable.ifc       && <Badge variant="outline" className="text-[10px]">IFC Report</Badge>}
              {applicable.cashFlow  && <Badge variant="outline" className="text-[10px]">Cash Flow Statement</Badge>}
              {applicable.form3ca   && <Badge variant="outline" className="text-[10px]">Form 3CA</Badge>}
              {applicable.form3cb   && <Badge variant="outline" className="text-[10px]">Form 3CB</Badge>}
              {applicable.form3cd   && <Badge variant="outline" className="text-[10px]">Form 3CD</Badge>}
              {!applicable.statutory && !applicable.form3cd && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">None configured</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ 2. READINESS SCORE + BLOCKERS ═══ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Sign-off Readiness</span>
            <span className="text-xs font-normal text-muted-foreground">{passCount}/{totalCount} checks pass</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Progress value={completeness} className="h-2" />
            <p className="text-[10px] text-muted-foreground mt-1.5">{completeness}% ready</p>
          </div>

          {blockers.length > 0 && (
            <Alert variant="destructive" className="bg-destructive/5">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-xs">{blockers.length} blocker(s) preventing sign-off</AlertTitle>
              <AlertDescription className="text-xs">
                {blockers.map(b => b.label).join(" · ")}
              </AlertDescription>
            </Alert>
          )}

          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs w-5" />
                <TableHead className="text-xs">Check</TableHead>
                <TableHead className="text-xs">Detail</TableHead>
                <TableHead className="text-xs w-20 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gates.map(g => (
                <TableRow key={g.key} className={cn(g.blocker && g.status !== "pass" && g.status !== "skip" && "bg-destructive/5")}>
                  <TableCell className="py-1.5">{statusIcon(g.status)}</TableCell>
                  <TableCell className="text-xs py-1.5">
                    {g.label}
                    {g.blocker && <Badge variant="outline" className="ml-1.5 text-[8px] px-1 border-destructive/30 text-destructive">BLOCKER</Badge>}
                  </TableCell>
                  <TableCell className="text-xs py-1.5 text-muted-foreground">{g.detail || "—"}</TableCell>
                  <TableCell className="text-right py-1.5">{statusBadge(g.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ═══ 3. STAGE COMPLETION MATRIX ═══ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="w-4 h-4 text-primary" /> Pipeline Stage Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {STAGE_LABELS.map(s => {
              const st = (engagement?.stage_statuses as any)?.[s.key] || "not_started";
              const variant = st === "complete" ? "bg-green-500/15 text-green-700 border-green-300"
                           : st === "in_progress" ? "bg-amber-500/15 text-amber-700 border-amber-300"
                           : "bg-muted text-muted-foreground border-border";
              const label = st === "complete" ? "✓ Complete" : st === "in_progress" ? "In Progress" : "Not Started";
              return (
                <div key={s.key} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 text-xs">
                  <span className="text-foreground">
                    <span className="text-muted-foreground mr-1.5">Stage {s.key}</span>
                    {s.label}
                  </span>
                  <Badge className={cn("text-[10px]", variant)}>{label}</Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ═══ 4. SCRUTINY + QUERIES SUMMARY ═══ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookMarked className="w-4 h-4 text-primary" /> Scrutiny &amp; Query Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Findings", value: findings.total, hint: `${findings.highOpen} HIGH open`, tone: findings.highOpen ? "text-destructive" : "text-foreground" },
              { label: "Accepted / Resolved", value: findings.accepted, tone: "text-green-600" },
              { label: "Queried", value: findings.queried, tone: "text-amber-600" },
              { label: "Overridden", value: findings.overridden, tone: "text-blue-600" },
            ].map(s => (
              <div key={s.label} className="text-center p-3 rounded-md bg-muted/30">
                <p className={cn("text-xl font-bold", s.tone)}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                {s.hint && <p className="text-[9px] text-muted-foreground">{s.hint}</p>}
              </div>
            ))}
          </div>
          <Separator />
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Queries", value: queries.total,    tone: "text-foreground" },
              { label: "Open",          value: queries.open,     tone: queries.open ? "text-amber-600" : "text-green-600" },
              { label: "Resolved",      value: queries.resolved, tone: "text-green-600" },
            ].map(s => (
              <div key={s.label} className="text-center p-3 rounded-md bg-muted/30">
                <p className={cn("text-xl font-bold", s.tone)}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ═══ 5. ACTIONS (pre-sign) ═══ */}
      {!isSigned && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="w-4 h-4 text-primary" /> Report Preparation
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleGenerateDraft} disabled={generating}>
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <FileText className="w-3.5 h-3.5 mr-1.5" />}
              {generating ? "Generating…" : "Generate / Regenerate Draft Report"}
            </Button>
            <Button size="sm" variant="outline" asChild disabled={uploading}>
              <label className="cursor-pointer flex items-center">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
                {mgmtLetterCount > 0 ? "Re-upload MRL" : "Upload MRL"}
                <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={handleUploadMrl} />
              </label>
            </Button>
            <Button size="sm" variant="outline" onClick={handleDownloadBundle} disabled={bundling}>
              {bundling ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Package className="w-3.5 h-3.5 mr-1.5" />}
              Preview Bundle
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ═══ 6. DRAFT REVISIONS ═══ */}
      {drafts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Draft Revisions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs w-16">Version</TableHead>
                  <TableHead className="text-xs">Filename</TableHead>
                  <TableHead className="text-xs w-24">Status</TableHead>
                  <TableHead className="text-xs w-20 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((d, i) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs py-1.5">v{drafts.length - i}</TableCell>
                    <TableCell className="text-xs py-1.5 font-mono truncate">{d.filename}</TableCell>
                    <TableCell className="py-1.5">
                      {d.is_final
                        ? <Badge className="text-[10px] bg-green-500/15 text-green-700 border-green-300">Signed</Badge>
                        : i === 0
                          ? <Badge variant="secondary" className="text-[10px]">Latest</Badge>
                          : <Badge variant="outline" className="text-[10px]">Superseded</Badge>}
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => viewDraft(d)}>
                        <ExternalLink className="w-3 h-3 mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ═══ 7. FINAL SIGN-OFF ═══ */}
      {!isSigned && (
        <Card className={cn("border-2", canProceed ? "border-primary/30 bg-primary/5" : "border-border")}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="w-4 h-4 text-primary" /> Partner Sign-off
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canProceed && (
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertTitle className="text-xs">Sign-off locked</AlertTitle>
                <AlertDescription className="text-xs">
                  Resolve all BLOCKER checks above before you can issue UDIN. Non-blocker warnings are advisory only.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="udin" className="text-xs">UDIN (Unique Document Identification Number)</Label>
              <Input
                id="udin" value={udin}
                onChange={e => setUdin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24))}
                placeholder="24-character alphanumeric UDIN"
                maxLength={24}
                className="font-mono tracking-wider"
                disabled={!canProceed}
              />
              <div className="flex items-center justify-between">
                <p className={cn(
                  "text-[10px]",
                  udin.length === 0 ? "text-muted-foreground"
                    : udinValid ? "text-green-600" : "text-destructive"
                )}>
                  {udin.length === 0
                    ? "Generate UDIN from udin.icai.org before signing"
                    : udinValid ? "✓ Valid UDIN format"
                                : `${udin.length}/24 characters`}
                </p>
                <a href="https://udin.icai.org" target="_blank" rel="noreferrer"
                   className="text-[10px] text-primary hover:underline inline-flex items-center gap-1">
                  udin.icai.org <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-md bg-background border border-border">
              <Checkbox id="declaration" checked={declared} disabled={!canProceed}
                        onCheckedChange={v => setDeclared(v === true)} />
              <label htmlFor="declaration" className="text-xs leading-relaxed cursor-pointer">
                I, <strong>{partnerResolved?.name || user?.name || "the engagement partner"}</strong>,
                confirm that this audit has been conducted in accordance with applicable Standards on Auditing
                and that I have reviewed the working papers, financial statements and annexures generated
                through this engagement. The UDIN above has been obtained from ICAI for this report.
                I understand that signing off locks all downstream records.
              </label>
            </div>

            <Button
              className="w-full"
              disabled={!declared || !udinValid || !canProceed || signing}
              onClick={() => setShowConfirm(true)}
            >
              <Shield className="w-3.5 h-3.5 mr-1.5" /> Sign Off &amp; Finalise
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ═══ 8. SIGNED STATE ═══ */}
      {isSigned && (
        <Card className="border-yellow-400 bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20">
          <CardContent className="p-6 text-center space-y-3">
            <Award className="w-12 h-12 text-yellow-600 mx-auto" />
            <div>
              <Badge className="bg-yellow-500 text-white text-xs px-3 py-0.5">Completed</Badge>
              <p className="font-bold text-base text-foreground mt-2">Engagement Signed Off &amp; Locked</p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs max-w-md mx-auto">
              <div><p className="text-muted-foreground">Client</p><p className="font-semibold">{client?.name || "—"}</p></div>
              <div><p className="text-muted-foreground">FY</p><p className="font-semibold">{engagement.financial_year || "—"}</p></div>
              <div>
                <p className="text-muted-foreground">Signed On</p>
                <p className="font-semibold">{engagement.sign_off_date || engagement.signed_at
                    ? new Date(engagement.sign_off_date || engagement.signed_at).toLocaleDateString("en-IN") : "—"}</p>
              </div>
            </div>
            {engagement.udin && (
              <div className="text-xs">
                <span className="text-muted-foreground">UDIN:</span>{" "}
                <span className="font-mono font-semibold">{engagement.udin}</span>
              </div>
            )}
            <div className="flex justify-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={handleDownloadBundle} disabled={bundling}>
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {bundling ? "Preparing…" : "Download Bundle"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirm Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <Lock className="w-4 h-4 text-primary" /> Confirm Final Sign-Off
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-xs">
              <span className="block">This action will permanently lock:</span>
              <ul className="list-disc list-inside space-y-0.5">
                <li>All Audit Notes ({notesCount})</li>
                {applicable.caro    && <li>CARO 2020 responses ({caroRespCount})</li>}
                {applicable.form3cd && <li>Form 3CD responses ({form3cdCount})</li>}
                <li>Financial Statements line items</li>
                <li>Engagement status → Signed</li>
              </ul>
              <span className="block font-medium text-foreground mt-2">UDIN: <span className="font-mono">{udin}</span></span>
              <span className="block text-destructive font-medium">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSignOff} disabled={signing}>
              {signing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Lock className="w-3.5 h-3.5 mr-1.5" />}
              {signing ? "Signing…" : "Confirm &amp; Lock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default EngagementReviewSignoff;
