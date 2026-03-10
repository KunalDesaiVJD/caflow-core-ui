import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuditTracker } from "@/hooks/useAuditTracker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Sparkles, Loader2, Check } from "lucide-react";
import { Json } from "@/integrations/supabase/types";

const RISK_AREAS = [
  "Revenue Recognition",
  "Inventory Valuation",
  "Fixed Assets",
  "Related Party Transactions",
  "Going Concern",
  "Fraud Risk",
  "Internal Controls",
  "IT Systems and Accounting Software",
];

const TARGET_AUDIT_RISK = 0.05;

interface RiskRow {
  area: string;
  inherent: number;
  control: number;
  notes: string;
}

function riskLabel(val: number): string {
  if (val >= 2.5) return "High";
  if (val >= 1.5) return "Medium";
  return "Low";
}

function riskColor(label: string): string {
  if (label === "High") return "bg-destructive/15 text-destructive border-destructive/30";
  if (label === "Medium") return "bg-amber-500/15 text-amber-700 border-amber-300";
  return "bg-green-500/15 text-green-700 border-green-300";
}

function computeDetection(inherent: number, control: number): number {
  const product = inherent * control;
  if (product === 0) return 2;
  const raw = TARGET_AUDIT_RISK / product;
  if (raw <= 0.33) return 3;
  if (raw <= 0.66) return 2;
  return 1;
}

function combinedRisk(inherent: number, control: number): string {
  const avg = (inherent + control) / 2;
  return riskLabel(avg);
}

interface Props {
  engagement: any;
  client: any;
  onUpdate: () => void;
}

export function EngagementRiskAssessment({ engagement, client, onUpdate }: Props) {
  const [rows, setRows] = useState<RiskRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState<any[] | null>(null);

  useEffect(() => {
    const saved = engagement.risk_assessment as any;
    if (saved && Array.isArray(saved)) {
      setRows(saved as RiskRow[]);
    } else {
      setRows(RISK_AREAS.map(a => ({ area: a, inherent: 2, control: 2, notes: "" })));
    }
  }, [engagement.id]);

  function updateRow(idx: number, field: keyof RiskRow, value: any) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("audit_engagements")
      .update({ risk_assessment: rows as unknown as Json })
      .eq("id", engagement.id);
    setSaving(false);
    if (error) toast.error("Failed to save");
    else { toast.success("Risk assessment saved"); onUpdate(); }
  }

  async function runAI() {
    setAiOpen(true);
    setAiLoading(true);
    setAiText("");
    setAiSuggestions(null);

    // Count high findings
    const { count } = await supabase
      .from("scrutiny_findings")
      .select("*", { count: "exact", head: true })
      .eq("client_id", engagement.client_id)
      .eq("severity", "HIGH");

    const { data: topFindings } = await supabase
      .from("scrutiny_findings")
      .select("rule_id, flag_message, severity")
      .eq("client_id", engagement.client_id)
      .eq("severity", "HIGH")
      .limit(5);

    const payload = {
      client_industry: client?.business_nature || client?.entity_type || "unknown",
      turnover_range: client?.compliance_flags?.turnover_range || "unknown",
      entity_type: client?.entity_type || "unknown",
      first_year_audit: false,
      high_severity_findings_count: count || 0,
      high_severity_findings: topFindings || [],
      risk_areas: RISK_AREAS,
    };

    try {
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "risk_assessment",
          user_message: JSON.stringify(payload),
        },
      });

      if (error) throw error;
      const content = data?.content || data?.message || JSON.stringify(data);
      setAiText(content);

      // Try to parse suggestions
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          setAiSuggestions(JSON.parse(jsonMatch[0]));
        }
      } catch { /* non-JSON response is fine */ }
    } catch (err: any) {
      setAiText("Error: " + (err.message || "Failed to get AI suggestions"));
    }
    setAiLoading(false);
  }

  function applyAiSuggestions() {
    if (!aiSuggestions) return;
    setRows(prev => prev.map((row, i) => {
      const sug = aiSuggestions.find((s: any) =>
        s.area?.toLowerCase() === row.area.toLowerCase()
      );
      if (!sug) return row;
      const mapVal = (v: string) => v === "High" ? 3 : v === "Medium" ? 2 : 1;
      return {
        ...row,
        inherent: mapVal(sug.inherent_risk || "Medium"),
        control: mapVal(sug.control_risk || "Medium"),
        notes: sug.reasoning || row.notes,
      };
    }));
    toast.success("AI suggestions applied");
    setAiOpen(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Risk Assessment Matrix</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={runAI}>
            <Sparkles className="w-4 h-4 mr-1" /> AI Risk Assessment
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Save Assessment
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Financial Statement Area</TableHead>
              <TableHead className="w-[130px]">Inherent Risk</TableHead>
              <TableHead className="w-[130px]">Control Risk</TableHead>
              <TableHead className="w-[120px]">Detection Risk</TableHead>
              <TableHead className="w-[120px]">Combined</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const detection = computeDetection(row.inherent, row.control);
              const detLabel = riskLabel(detection);
              const comb = combinedRisk(row.inherent, row.control);
              return (
                <TableRow key={row.area}>
                  <TableCell className="font-medium text-sm">{row.area}</TableCell>
                  <TableCell>
                    <Select value={String(row.inherent)} onValueChange={v => updateRow(i, "inherent", Number(v))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">High (3)</SelectItem>
                        <SelectItem value="2">Medium (2)</SelectItem>
                        <SelectItem value="1">Low (1)</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={String(row.control)} onValueChange={v => updateRow(i, "control", Number(v))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">High (3)</SelectItem>
                        <SelectItem value="2">Medium (2)</SelectItem>
                        <SelectItem value="1">Low (1)</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${riskColor(detLabel)}`}>{detLabel}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${riskColor(comb)}`}>{comb}</Badge>
                  </TableCell>
                  <TableCell>
                    <Textarea
                      className="min-h-[36px] text-xs resize-none"
                      rows={1}
                      value={row.notes}
                      onChange={e => updateRow(i, "notes", e.target.value)}
                      placeholder="Optional notes..."
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* AI Side Panel */}
      <Sheet open={aiOpen} onOpenChange={setAiOpen}>
        <SheetContent className="w-[450px] sm:max-w-[450px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> AI Risk Suggestions
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {aiLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Analyzing engagement context...
              </div>
            ) : (
              <>
                <div className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">{aiText}</div>
                {aiSuggestions && (
                  <Button onClick={applyAiSuggestions} size="sm" className="w-full">
                    <Check className="w-4 h-4 mr-1" /> Apply AI Suggestions
                  </Button>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
