import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, Upload, FileText, Shield, Loader2,
  ExternalLink, Package, Download, Lock, Award, Share2, AlertTriangle,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import JSZip from "jszip";
import * as XLSX from "xlsx";

interface Props {
  engagement: any;
  client: any;
  partner: any;
  onUpdate: () => void;
}

interface CheckItem {
  label: string;
  passed: boolean;
  fixTab?: string;
  fixLabel?: string;
}

export function EngagementReviewSignoff({ engagement, client, partner, onUpdate }: Props) {
  const { user } = useAuth();
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingBundle, setGeneratingBundle] = useState(false);
  const [signing, setSigning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [udin, setUdin] = useState(engagement?.udin || "");
  const [drafts, setDrafts] = useState<any[]>([]);
  const [firm, setFirm] = useState<any>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [findingsStats, setFindingsStats] = useState({ total: 0, accepted: 0, queried: 0, overridden: 0 });
  const [notesCount, setNotesCount] = useState(0);
  const [caroCount, setCароCount] = useState(0);
  const [reportTypes, setReportTypes] = useState<string[]>([]);

  const isSigned = engagement?.final_locked === true || engagement?.status === "signed";
  const canSignOff = user?.role === "partner_ca" || user?.role === "firm_admin" || user?.role === "superadmin";

  // UDIN validation: 24-character alphanumeric
  const udinValid = /^[A-Za-z0-9]{24}$/.test(udin.trim());

  const runChecks = useCallback(async () => {
    if (!engagement?.id) return;
    setLoading(true);
    const clientId = engagement.client_id;
    const fy = engagement.financial_year;
    const engId = engagement.id;

    // Parallel data fetch
    const [tbRes, highRes, wpRes, caroRes, notesRes, draftRes, mgmtRes, findingsRes] = await Promise.all([
      supabase.from("trial_balance_snapshots").select("*", { count: "exact", head: true }).eq("client_id", clientId).eq("financial_year", fy),
      supabase.from("scrutiny_findings").select("*", { count: "exact", head: true }).eq("client_id", clientId).eq("severity", "HIGH").eq("status", "open"),
      supabase.from("audit_workpapers").select("*", { count: "exact", head: true }).eq("engagement_id", engId).is("conclusion", null),
      supabase.from("audit_caro_responses").select("*", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("audit_notes").select("*", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("engagement_id", engId).eq("sub_category", "draft"),
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("engagement_id", engId).eq("category", "mgmt_rep_letter"),
      supabase.from("scrutiny_findings").select("status").eq("client_id", clientId),
    ]);

    // Stats
    const findings = findingsRes.data || [];
    setFindingsStats({
      total: findings.length,
      accepted: findings.filter((f: any) => f.status === "accepted").length,
      queried: findings.filter((f: any) => f.status === "queried").length,
      overridden: findings.filter((f: any) => f.status === "overridden").length,
    });
    setNotesCount(notesRes.count || 0);
    setCароCount(caroRes.count || 0);

    // Report types
    const types: string[] = ["Independent Auditor's Report"];
    if (engagement.requires_caro) types.push("CARO 2020");
    if (engagement.requires_3ca) types.push("Form 3CA");
    if (engagement.requires_3cb) types.push("Form 3CB");
    if (engagement.requires_3cd) types.push("Form 3CD");
    setReportTypes(types);

    // Risk assessment check
    const ra = engagement.risk_assessment;
    const raRows = Array.isArray(ra) ? ra : [];
    const raComplete = raRows.length >= 8 && raRows.every((r: any) => r.rating && r.response);

    // CARO check
    let caroPass = true;
    if (engagement.caro_applicable || engagement.requires_caro) {
      caroPass = (caroRes.count || 0) >= 21;
    }

    // Notes check
    const notesPass = (notesRes.count || 0) >= 10;

    // Fetch drafts
    const { data: draftDocs } = await supabase.from("documents").select("*").eq("engagement_id", engId).eq("sub_category", "draft").order("filename", { ascending: false });
    setDrafts(draftDocs || []);

    // Fetch firm
    if (engagement.firm_id) {
      const { data: f } = await supabase.from("firms").select("name, icai_reg_no, icai_firm_reg_no").eq("id", engagement.firm_id).single();
      setFirm(f);
    }

    setChecks([
      { label: "Trial Balance Imported", passed: (tbRes.count || 0) > 0, fixTab: "fieldwork", fixLabel: "Import Trial Balance" },
      { label: "All HIGH Findings Resolved", passed: (highRes.count || 0) === 0, fixTab: "fieldwork", fixLabel: "Review Findings" },
      { label: "Risk Assessment Complete", passed: raComplete, fixTab: "risk", fixLabel: "Complete Risk Assessment" },
      { label: "All Workpapers Signed Off", passed: (wpRes.count || 0) === 0, fixTab: "programme", fixLabel: "Sign Workpapers" },
      { label: "CARO Report Complete", passed: caroPass, fixTab: "caro", fixLabel: "Complete CARO" },
      { label: "Notes to Accounts Drafted", passed: notesPass, fixTab: "notes", fixLabel: "Draft Notes" },
      { label: "Draft Report Generated", passed: (draftRes.count || 0) > 0, fixLabel: "Generate Report" },
      { label: "Management Rep Letter Uploaded", passed: (mgmtRes.count || 0) > 0, fixLabel: "Upload Letter" },
    ]);
    setLoading(false);
  }, [engagement]);

  useEffect(() => { runChecks(); }, [runChecks]);

  const allPassed = checks.length > 0 && checks.every((c) => c.passed);
  const passedCount = checks.filter((c) => c.passed).length;

  // ── Role gate ──
  if (!canSignOff) {
    return (
      <Card className="border-amber-300 bg-amber-500/5">
        <CardContent className="p-8 text-center space-y-3">
          <Lock className="w-10 h-10 text-amber-600 mx-auto" />
          <p className="font-semibold text-foreground text-lg">This stage requires Partner/CA access</p>
          <p className="text-sm text-muted-foreground">
            Only users with <strong>partner_ca</strong> or <strong>firm_admin</strong> role can access the Sign-Off & Bundle stage.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function handleGenerateReport() {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-audit-report", {
        body: { engagement_id: engagement.id, report_type: "companies_act", include_comparative: true },
      });
      if (error) throw error;
      toast.success(`Draft report v${data.version_number} generated`);
      await runChecks();
      onUpdate();
    } catch (e: any) {
      toast.error(e.message || "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }

  async function handleUploadMgmtLetter(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `firms/${engagement.firm_id}/clients/${engagement.client_id}/mgmt_rep_letter/${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      await supabase.from("documents").insert({
        firm_id: engagement.firm_id, client_id: engagement.client_id, engagement_id: engagement.id,
        filename: file.name, category: "mgmt_rep_letter", r2_key: path,
      });
      toast.success("Management Representation Letter uploaded");
      await runChecks();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSignAndFinalise() {
    if (!declared || !udinValid) return;
    setSigning(true);
    try {
      const signOffData = {
        status: "signed",
        final_locked: true,
        udin: udin.trim(),
        sign_off_by: user?.id,
        sign_off_date: new Date().toISOString(),
        signed_at: new Date().toISOString(),
        signed_by: user?.id,
        pipeline_stage: 10,
        stage_statuses: {
          ...(engagement.stage_statuses || {}),
          "10": "complete",
        },
      };

      // 1. Update engagement
      await supabase.from("audit_engagements").update(signOffData).eq("id", engagement.id);

      // 2. Lock all audit records
      await Promise.all([
        supabase.from("audit_notes").update({ is_locked: true }).eq("engagement_id", engagement.id),
        supabase.from("audit_caro_responses").update({ is_locked: true, status: "locked" }).eq("engagement_id", engagement.id),
        supabase.from("audit_3cd_responses").update({ is_locked: true }).eq("engagement_id", engagement.id),
        supabase.from("fa_assets").update({ is_locked: true }).eq("engagement_id", engagement.id),
      ]);

      // 3. Mark latest draft as final
      if (drafts.length > 0) {
        const latest = drafts[0];
        await supabase.from("documents").update({
          is_final: true, is_signed: true, signed_by: user?.id, signed_at: new Date().toISOString(),
        }).eq("id", latest.id);

        const finalPath = latest.r2_key?.replace("/draft/", "/final/")?.replace(/v\d+\.html$/, "SIGNED.html");
        if (finalPath && latest.r2_key) {
          try { await supabase.storage.from("firm-assets").copy(latest.r2_key, finalPath); } catch {}
        }
      }

      // 4. Notification
      try {
        await supabase.functions.invoke("send-notification", {
          body: {
            type: "audit_report", recipient_id: engagement.partner_id, firm_id: engagement.firm_id,
            content: { client_name: client?.name, financial_year: engagement.financial_year, message: "Audit report signed and finalised. UDIN: " + udin.trim() },
          },
        });
      } catch {}

      toast.success("Audit report signed and finalised!");
      setShowConfirm(false);
      onUpdate();
    } catch (err: any) {
      toast.error(err.message || "Sign-off failed");
    } finally {
      setSigning(false);
    }
  }

  async function viewDraft(doc: any) {
    if (!doc.r2_key) return;
    const { data } = await supabase.storage.from("firm-assets").createSignedUrl(doc.r2_key, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function handleGenerateBundle() {
    setGeneratingBundle(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-audit-bundle", {
        body: { engagement_id: engagement.id },
      });
      if (error) throw error;

      const wb = XLSX.utils.book_new();
      const sheetsData = data.xlsx_sheets || {};
      for (const [sheetName, rows] of Object.entries(sheetsData)) {
        const ws = XLSX.utils.json_to_sheet(rows as any[]);
        XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
      }
      const xlsxBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });

      const pdfResponse = data.pdf_url ? await fetch(data.pdf_url) : null;
      const pdfBlob = pdfResponse ? await pdfResponse.blob() : null;

      const zip = new JSZip();
      if (pdfBlob) zip.file("Audit_Report.html", pdfBlob);
      zip.file("Workpaper_Master.xlsx", xlsxBuffer);

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Audit_Bundle_${client?.name || "Client"}_${engagement.financial_year || "FY"}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Audit bundle generated and downloaded!");
      await runChecks();
      onUpdate();
    } catch (e: any) {
      toast.error(e.message || "Failed to generate bundle");
    } finally {
      setGeneratingBundle(false);
    }
  }

  async function handleShareBundle() {
    toast.info("Bundle sharing via email will be available once Resend integration is configured.");
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Engagement Review Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Engagement Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Client</span>
              <p className="font-semibold text-foreground">{client?.name || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Financial Year</span>
              <p className="font-semibold text-foreground">{engagement.financial_year || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Audit Type</span>
              <p className="font-semibold text-foreground capitalize">{engagement.audit_type || "Statutory"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Entity Type</span>
              <p className="font-semibold text-foreground capitalize">{engagement.entity_type || client?.entity_type || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Total Findings</span>
              <p className="font-semibold text-foreground">
                {findingsStats.total}
                <span className="text-xs text-muted-foreground ml-1">
                  ({findingsStats.accepted}A / {findingsStats.queried}Q / {findingsStats.overridden}O)
                </span>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Notes to Accounts</span>
              <p className="font-semibold text-foreground">{notesCount}</p>
            </div>
            <div>
              <span className="text-muted-foreground">CARO Applicable</span>
              <p className="font-semibold text-foreground">{engagement.requires_caro || engagement.caro_applicable ? "Yes" : "No"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Reports Generated</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {reportTypes.map(r => <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sign-off Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Sign-Off Checklist (Stages 1–9)
            <Badge variant={allPassed ? "default" : "secondary"} className="ml-auto">
              {passedCount}/{checks.length} Complete
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {checks.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-3">
                {item.passed ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-destructive" />
                )}
                <span className={item.passed ? "text-foreground" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </div>
              {!item.passed && !isSigned && (
                <span className="text-xs text-primary cursor-pointer hover:underline">
                  → {item.fixLabel || "Fix this"}
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions row */}
      {!isSigned && (
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleGenerateReport} disabled={generating} className="bg-amber-600 hover:bg-amber-700 text-white">
            {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
            {generating ? "Generating Draft..." : "Generate Draft Report"}
          </Button>

          <Button variant="outline" asChild disabled={uploading}>
            <label className="cursor-pointer flex items-center gap-2">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload Management Rep Letter
              <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={handleUploadMgmtLetter} />
            </label>
          </Button>

          {allPassed && (
            <Button
              onClick={handleGenerateBundle}
              disabled={generatingBundle}
              className="bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white font-semibold"
            >
              {generatingBundle ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Package className="w-4 h-4 mr-2" />}
              {generatingBundle ? "Generating Bundle..." : "Generate Complete Bundle"}
            </Button>
          )}
        </div>
      )}

      {/* Revision History */}
      {drafts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revision History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((doc, i) => (
                  <TableRow key={doc.id}>
                    <TableCell>v{drafts.length - i}</TableCell>
                    <TableCell className="font-mono text-sm">{doc.filename}</TableCell>
                    <TableCell>
                      {doc.is_final ? (
                        <Badge className="bg-green-500/15 text-green-700 border-green-300">Signed</Badge>
                      ) : i === 0 ? (
                        <Badge variant="secondary">Latest</Badge>
                      ) : (
                        <Badge variant="outline">Superseded</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => viewDraft(doc)}>
                        <ExternalLink className="w-3.5 h-3.5 mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Final Sign-Off — only when all checks pass */}
      {allPassed && !isSigned && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Shield className="w-5 h-5" />
              Stage 9 — Final Sign-Off
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Partner info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Partner</span>
                <p className="font-semibold text-foreground">{partner?.name || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">ICAI Membership</span>
                <p className="font-semibold text-foreground">{partner?.icai_reg_no || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Firm Reg No.</span>
                <p className="font-semibold text-foreground">{firm?.icai_reg_no || firm?.icai_firm_reg_no || "—"}</p>
              </div>
            </div>

            {/* UDIN Entry */}
            <div className="space-y-2">
              <Label htmlFor="udin" className="font-medium">UDIN (Unique Document Identification Number)</Label>
              <Input
                id="udin"
                value={udin}
                onChange={(e) => setUdin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24))}
                placeholder="24-character alphanumeric UDIN"
                maxLength={24}
                className="font-mono tracking-wider"
              />
              {udin.length > 0 && !udinValid && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> UDIN must be exactly 24 alphanumeric characters ({udin.length}/24)
                </p>
              )}
              {udinValid && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Valid UDIN format
                </p>
              )}
            </div>

            {/* Declaration */}
            <div className="flex items-start gap-3 p-4 rounded-lg bg-background border border-border">
              <Checkbox
                id="declaration"
                checked={declared}
                onCheckedChange={(v) => setDeclared(v === true)}
              />
              <label htmlFor="declaration" className="text-sm leading-relaxed cursor-pointer">
                I, <strong>{partner?.name || user?.name}</strong>, confirm that the audit has been conducted in
                accordance with applicable Standards on Auditing. I confirm I have reviewed all working papers
                and am satisfied with the audit evidence obtained. This report reflects my independent
                professional judgment as a Chartered Accountant.
              </label>
            </div>

            <Button
              size="lg"
              disabled={!declared || !udinValid || signing}
              onClick={() => setShowConfirm(true)}
              className="w-full"
            >
              <Shield className="w-4 h-4 mr-2" />
              SIGN OFF & FINALISE
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary" />
              Confirm Final Sign-Off
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>This action will permanently lock the following records:</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li>All Audit Notes ({notesCount} notes)</li>
                {(engagement.requires_caro || engagement.caro_applicable) && <li>All CARO Responses</li>}
                {engagement.requires_3cd && <li>All Form 3CD Responses</li>}
                <li>All Fixed Assets for this engagement</li>
                <li>Engagement status → Completed</li>
              </ul>
              <p className="font-medium text-foreground">UDIN: <span className="font-mono">{udin}</span></p>
              <p className="text-destructive font-medium">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSignAndFinalise}
              disabled={signing}
              className="bg-primary"
            >
              {signing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
              {signing ? "Signing..." : "Confirm & Lock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Signed / Completed state */}
      {isSigned && (
        <Card className="border-yellow-400 bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20">
          <CardContent className="p-8 text-center space-y-4">
            <Award className="w-14 h-14 text-yellow-600 mx-auto" />
            <div>
              <Badge className="bg-yellow-500 text-white text-sm px-4 py-1 mb-2">Completed</Badge>
              <p className="font-bold text-lg text-foreground mt-2">Engagement Signed Off</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm max-w-lg mx-auto">
              <div>
                <span className="text-muted-foreground">Client</span>
                <p className="font-semibold text-foreground">{client?.name || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">FY</span>
                <p className="font-semibold text-foreground">{engagement.financial_year || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Signed On</span>
                <p className="font-semibold text-foreground">
                  {engagement.sign_off_date || engagement.signed_at
                    ? new Date(engagement.sign_off_date || engagement.signed_at).toLocaleDateString("en-IN")
                    : "—"}
                </p>
              </div>
            </div>
            {engagement.udin && (
              <div className="text-sm">
                <span className="text-muted-foreground">UDIN: </span>
                <span className="font-mono font-semibold text-foreground">{engagement.udin}</span>
              </div>
            )}
            <div className="flex justify-center gap-3 pt-2">
              <Button onClick={handleGenerateBundle} disabled={generatingBundle} variant="outline">
                <Download className="w-4 h-4 mr-2" />
                {generatingBundle ? "Generating..." : "Download Bundle"}
              </Button>
              <Button onClick={handleShareBundle} variant="outline">
                <Share2 className="w-4 h-4 mr-2" />
                Share Bundle
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
