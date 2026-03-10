import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CheckCircle, XCircle, Upload, FileText, Shield, Loader2, ExternalLink, Package, Download } from "lucide-react";
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
  const [signing, setSigning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [firm, setFirm] = useState<any>(null);

  const isSigned = engagement?.status === "signed";

  const runChecks = useCallback(async () => {
    if (!engagement?.id) return;
    setLoading(true);
    const clientId = engagement.client_id;
    const fy = engagement.financial_year;

    // 1. Trial Balance Imported
    const { count: tbCount } = await supabase
      .from("trial_balance_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("financial_year", fy);

    // 2. All HIGH Findings Resolved
    const { count: openHighCount } = await supabase
      .from("scrutiny_findings")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("severity", "HIGH")
      .eq("status", "open");

    // 3. Risk Assessment Complete
    const ra = engagement.risk_assessment;
    const raRows = Array.isArray(ra) ? ra : [];
    const raComplete = raRows.length >= 8 && raRows.every((r: any) => r.rating && r.response);

    // 4. All Workpapers Signed Off
    const { count: unsignedWP } = await supabase
      .from("audit_workpapers")
      .select("*", { count: "exact", head: true })
      .eq("engagement_id", engagement.id)
      .is("conclusion", null);

    // 5. CARO Complete
    let caroPass = true;
    if (engagement.caro_applicable) {
      const caro = engagement.caro_responses;
      const caroKeys = caro && typeof caro === "object" ? Object.keys(caro) : [];
      caroPass = caroKeys.length >= 21;
    }

    // 6. Notes to Accounts Drafted
    const notes = engagement.notes_to_accounts;
    const notesKeys = notes && typeof notes === "object" ? Object.keys(notes) : [];
    const notesPass = notesKeys.length >= 10;

    // 7. Draft Report Generated
    const { count: draftCount } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("engagement_id", engagement.id)
      .eq("sub_category", "draft");

    // 8. Management Rep Letter Uploaded
    const { count: mgmtCount } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("engagement_id", engagement.id)
      .eq("category", "mgmt_rep_letter");

    // Fetch drafts for revision history
    const { data: draftDocs } = await supabase
      .from("documents")
      .select("*")
      .eq("engagement_id", engagement.id)
      .eq("sub_category", "draft")
      .order("filename", { ascending: false });

    setDrafts(draftDocs || []);

    // Fetch firm info
    if (engagement.firm_id) {
      const { data: f } = await supabase.from("firms").select("name, icai_reg_no").eq("id", engagement.firm_id).single();
      setFirm(f);
    }

    setChecks([
      { label: "Trial Balance Imported", passed: (tbCount || 0) > 0, fixTab: "fieldwork", fixLabel: "Import Trial Balance" },
      { label: "All HIGH Findings Resolved", passed: (openHighCount || 0) === 0, fixTab: "fieldwork", fixLabel: "Review Findings" },
      { label: "Risk Assessment Complete", passed: raComplete, fixTab: "risk", fixLabel: "Complete Risk Assessment" },
      { label: "All Workpapers Signed Off", passed: (unsignedWP || 0) === 0, fixTab: "programme", fixLabel: "Sign Workpapers" },
      { label: "CARO Report Complete", passed: caroPass, fixTab: "caro", fixLabel: "Complete CARO" },
      { label: "Notes to Accounts Drafted", passed: notesPass, fixTab: "notes", fixLabel: "Draft Notes" },
      { label: "Draft Report Generated", passed: (draftCount || 0) > 0, fixLabel: "Generate Report" },
      { label: "Management Rep Letter Uploaded", passed: (mgmtCount || 0) > 0, fixLabel: "Upload Letter" },
    ]);
    setLoading(false);
  }, [engagement]);

  useEffect(() => { runChecks(); }, [runChecks]);

  const allPassed = checks.length > 0 && checks.every((c) => c.passed);
  const passedCount = checks.filter((c) => c.passed).length;

  async function handleGenerateReport() {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-audit-report", {
        body: {
          engagement_id: engagement.id,
          report_type: "companies_act",
          include_comparative: true,
        },
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
        firm_id: engagement.firm_id,
        client_id: engagement.client_id,
        engagement_id: engagement.id,
        filename: file.name,
        category: "mgmt_rep_letter",
        r2_key: path,
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
    if (!declared) return;
    setSigning(true);
    try {
      // 1. Update engagement status
      await supabase
        .from("audit_engagements")
        .update({ status: "signed", signed_at: new Date().toISOString(), signed_by: user?.id })
        .eq("id", engagement.id);

      // 2. Mark latest draft as final
      if (drafts.length > 0) {
        const latest = drafts[0];
        await supabase
          .from("documents")
          .update({ is_final: true, is_signed: true, signed_by: user?.id, signed_at: new Date().toISOString() })
          .eq("id", latest.id);

        // Copy to final path
        const finalPath = latest.r2_key?.replace("/draft/", "/final/")?.replace(/v\d+\.html$/, "SIGNED.html");
        if (finalPath && latest.r2_key) {
          await supabase.storage.from("firm-assets").copy(latest.r2_key, finalPath);
        }
      }

      // 3. Send notifications via send-notification
      try {
        await supabase.functions.invoke("send-notification", {
          body: {
            type: "audit_report",
            recipient_id: engagement.partner_id,
            firm_id: engagement.firm_id,
            content: {
              client_name: client?.name,
              financial_year: engagement.financial_year,
              message: "Audit report has been signed and finalised.",
            },
          },
        });
      } catch { /* notification failures shouldn't block sign-off */ }

      toast.success("Audit report signed and finalised!");
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
      {/* Sign-off Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Sign-Off Checklist
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
              Final Sign-Off
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
                <p className="font-semibold text-foreground">{firm?.icai_reg_no || "—"}</p>
              </div>
            </div>

            {/* Declaration */}
            <div className="flex items-start gap-3 p-4 rounded-lg bg-background border border-border">
              <Checkbox
                id="declaration"
                checked={declared}
                onCheckedChange={(v) => setDeclared(v === true)}
              />
              <label htmlFor="declaration" className="text-sm leading-relaxed cursor-pointer">
                I, <strong>{partner?.name || user?.name}</strong>, confirm that this audit report reflects my
                independent professional judgment as a Chartered Accountant. I confirm I have reviewed all
                working papers and am satisfied with the audit evidence obtained.
              </label>
            </div>

            <Button
              size="lg"
              disabled={!declared || signing}
              onClick={handleSignAndFinalise}
              className="w-full"
            >
              {signing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
              {signing ? "Signing..." : "SIGN AND FINALISE REPORT"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Signed state */}
      {isSigned && (
        <Card className="border-green-300 bg-green-500/5">
          <CardContent className="p-6 text-center space-y-2">
            <CheckCircle className="w-10 h-10 text-green-600 mx-auto" />
            <p className="font-semibold text-foreground">This engagement has been signed off</p>
            <p className="text-sm text-muted-foreground">
              Signed on {engagement.signed_at ? new Date(engagement.signed_at).toLocaleDateString("en-IN") : "—"} by {partner?.name || "Partner"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
