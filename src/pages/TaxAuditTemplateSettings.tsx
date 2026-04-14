/**
 * TaxAuditTemplateSettings
 * /settings/tax-audit-templates
 * Lists both master XLSX templates, shows cell-map row counts, upload dates,
 * and provides a "Test Export" button to download a populated workbook.
 */
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, FileSpreadsheet, Download, RefreshCw } from "lucide-react";

interface TemplateInfo {
  form_type: string;
  label: string;
  storagePath: string;
  rowCount: number | null;
  uploadedAt: string | null;
  sizeBytes: number | null;
}

interface Engagement {
  id: string;
  label: string;
}

const TEMPLATES: Pick<TemplateInfo, "form_type" | "label" | "storagePath">[] = [
  { form_type: "3CA-3CD", label: "Form 3CA + 3CD", storagePath: "3ca_3cd.xlsx" },
  { form_type: "3CB-3CD", label: "Form 3CB + 3CD", storagePath: "3cb_3cd.xlsx" },
];

export default function TaxAuditTemplateSettings() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [testDialog, setTestDialog] = useState(false);
  const [testFormType, setTestFormType] = useState("");
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selectedEngId, setSelectedEngId] = useState("");
  const [engLoading, setEngLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      // Cell map row counts
      const { data: cmData } = await supabase
        .from("tax_audit_cell_map")
        .select("template_name");

      const counts: Record<string, number> = {};
      for (const row of cmData ?? []) {
        counts[row.template_name] = (counts[row.template_name] ?? 0) + 1;
      }

      // Storage metadata — list v1/ prefix
      const { data: storageItems } = await supabase.storage
        .from("tax_audit_templates")
        .list("v1");

      const storageMap: Record<string, { updated_at: string; size: number }> = {};
      for (const item of storageItems ?? []) {
        storageMap[item.name] = {
          updated_at: item.updated_at ?? item.created_at ?? "",
          size: (item.metadata as any)?.size ?? 0,
        };
      }

      const infos: TemplateInfo[] = TEMPLATES.map((t) => {
        const meta = storageMap[t.storagePath];
        return {
          ...t,
          rowCount: counts[t.form_type] ?? null,
          uploadedAt: meta?.updated_at ?? null,
          sizeBytes: meta?.size ?? null,
        };
      });

      setTemplates(infos);
    } finally {
      setLoading(false);
    }
  }

  async function openTestDialog(formType: string) {
    setTestFormType(formType);
    setSelectedEngId("");
    setTestDialog(true);
    setEngLoading(true);
    try {
      const { data } = await supabase
        .from("engagements")
        .select("id, financial_year, clients!inner(name)")
        .order("created_at", { ascending: false })
        .limit(50);

      const list: Engagement[] = (data ?? []).map((e: any) => ({
        id: e.id,
        label: `${e.clients?.name ?? "Unknown"} — ${e.financial_year ?? ""}`,
      }));
      setEngagements(list);
      if (list.length > 0) setSelectedEngId(list[0].id);
    } finally {
      setEngLoading(false);
    }
  }

  async function runTestExport() {
    if (!selectedEngId) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export_tax_audit", {
        body: { engagement_id: selectedEngId, form_type: testFormType },
      });
      if (error) throw error;

      const blob = data instanceof Blob ? data : new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${testFormType}_test.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Export downloaded", description: `${testFormType} workbook saved.` });
      setTestDialog(false);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  function formatBytes(b: number | null) {
    if (!b) return "—";
    if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024).toFixed(0)} KB`;
  }

  function formatDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Tax Audit Templates</h1>
          <p className="text-muted-foreground text-sm">Master XLSX templates used for Form 3CA-3CD and 3CB-3CD exports.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {templates.map((t) => (
            <Card key={t.form_type} className="border border-border">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600">
                      <FileSpreadsheet size={20} />
                    </div>
                    <div>
                      <CardTitle className="text-base">{t.label}</CardTitle>
                      <CardDescription className="text-xs mt-0.5">{t.form_type}</CardDescription>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">v1</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Cell Map Rows</p>
                    <p className="font-semibold">{t.rowCount ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">File Size</p>
                    <p className="font-semibold">{formatBytes(t.sizeBytes)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-0.5">Last Uploaded</p>
                    <p className="font-semibold text-xs">{formatDate(t.uploadedAt)}</p>
                  </div>
                </div>
                <Button
                  className="w-full gap-2"
                  variant="outline"
                  onClick={() => openTestDialog(t.form_type)}
                >
                  <Download className="h-4 w-4" />
                  Test Export
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Test Export Dialog ── */}
      <Dialog open={testDialog} onOpenChange={setTestDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Test Export — {testFormType}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Select Engagement</Label>
              {engLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading engagements…
                </div>
              ) : engagements.length === 0 ? (
                <p className="text-sm text-muted-foreground">No engagements found.</p>
              ) : (
                <Select value={selectedEngId} onValueChange={setSelectedEngId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an engagement" />
                  </SelectTrigger>
                  <SelectContent>
                    {engagements.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The master template will be populated with data saved for the selected engagement and downloaded as an XLSX file.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialog(false)}>Cancel</Button>
            <Button
              onClick={runTestExport}
              disabled={exporting || !selectedEngId}
              className="gap-2"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? "Exporting…" : "Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
