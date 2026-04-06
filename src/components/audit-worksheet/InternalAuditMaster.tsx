/**
 * InternalAuditMaster — Sheet 2
 * Shown when audit_type = "internal"
 */
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Save, Loader2, Wand2 } from "lucide-react";
import type { WsMaster } from "./hooks/useWorksheetStorage";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

interface Props {
  data: AuditWorksheetData;
  master: WsMaster;
  setMaster: (field: keyof WsMaster, value: any) => void;
  patchMaster: (patch: Partial<WsMaster>) => void;
  saveMaster: (silent?: boolean) => Promise<boolean>;
  masterSaving: boolean;
  masterLoaded: boolean;
}

const ENTITY_TYPES = ["Individual", "HUF", "Firm", "LLP", "Private Ltd", "Public Ltd", "Trust", "AOP/BOI", "Other"];
const PERIOD_LABELS = [
  "Annual (April–March)", "Half-Yearly (Apr–Sep)", "Half-Yearly (Oct–Mar)",
  "Q1 (Apr–Jun)", "Q2 (Jul–Sep)", "Q3 (Oct–Dec)", "Q4 (Jan–Mar)", "Special",
];

export default function InternalAuditMaster({
  data, master, setMaster, patchMaster, saveMaster, masterSaving, masterLoaded,
}: Props) {

  // Auto-populate on first load
  useEffect(() => {
    if (!masterLoaded) return;
    if (master.int_client_name) return;
    if (!data.clientName) return;

    patchMaster({
      int_client_name:    data.clientName,
      int_address:        data.clientAddress,
      int_pan:            data.pan,
      int_entity_type:    data.entityType,
      int_financial_year: data.financialYear,
      int_period_from:    data.fyStartDate,
      int_period_to:      data.fyEndDate,
      int_audit_firm:     data.auditFirm?.name || data.firmName,
      int_partner_name:   data.auditFirm?.partner_name || "",
    });
  }, [masterLoaded, data.clientName]);

  const f = (id: keyof WsMaster, label: string, type: "text" | "date" = "text") => (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type={type}
        value={(master[id] as string) || ""}
        onChange={e => setMaster(id, e.target.value)}
        className="h-8 text-sm"
      />
    </div>
  );

  const ta = (id: keyof WsMaster, label: string, rows = 3) => (
    <div className="col-span-2">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Textarea
        id={id}
        rows={rows}
        value={(master[id] as string) || ""}
        onChange={e => setMaster(id, e.target.value)}
        className="text-sm"
      />
    </div>
  );

  const sel = (id: keyof WsMaster, label: string, options: string[]) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={(master[id] as string) || ""} onValueChange={v => setMaster(id, v)}>
        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">Internal Audit Master Sheet</h3>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-blue-600 hover:bg-blue-50 text-xs"
            onClick={() => patchMaster({
              int_client_name:    data.clientName,
              int_address:        data.clientAddress,
              int_pan:            data.pan,
              int_entity_type:    data.entityType,
              int_financial_year: data.financialYear,
              int_period_from:    data.fyStartDate,
              int_period_to:      data.fyEndDate,
              int_audit_firm:     data.auditFirm?.name || data.firmName,
              int_partner_name:   data.auditFirm?.partner_name || "",
            })}
          >
            <Wand2 size={13} /> Auto-fill from engagement
          </Button>
          <Button size="sm" className="gap-1 h-8" onClick={() => saveMaster()} disabled={masterSaving}>
            {masterSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </Button>
        </div>
      </div>

      {/* ── Client Details ── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Client Details</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {f("int_client_name",    "Name of Organisation")}
            {sel("int_entity_type",  "Entity Type", ENTITY_TYPES)}
            {f("int_pan",            "PAN")}
            {f("int_financial_year", "Financial Year (e.g. 2024-25)")}
            {sel("int_period_label", "Audit Period", PERIOD_LABELS)}
            {f("int_period_from",    "Period From", "date")}
            {f("int_period_to",      "Period To",   "date")}
            {ta("int_address",       "Registered / Corporate Office Address")}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* ── Audit Scope & Objectives ── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Scope, Objectives & Methodology</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            {ta("int_scope",       "Scope of Internal Audit", 4)}
            {ta("int_objectives",  "Objectives", 4)}
            {ta("int_methodology", "Audit Methodology", 3)}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* ── Auditor Details ── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Internal Auditor Details</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {f("int_audit_firm",    "Audit Firm Name")}
            {f("int_partner_name",  "Partner / Lead Auditor")}
            {ta("int_team_members", "Team Members (comma-separated)", 2)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
