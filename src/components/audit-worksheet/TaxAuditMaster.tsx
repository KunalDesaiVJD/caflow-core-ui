/**
 * TaxAuditMaster — Sheet 1
 * Shown when audit_type = "tax_audit" | "both" | "statutory"
 * Auto-populates from engagement data on first load.
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
const ACCOUNTING_METHODS = ["Mercantile", "Cash", "Hybrid"];
const SECTIONS = ["44AB(a)", "44AB(b)", "44AB(c)", "44AB(d)", "44AB(e)", "44AD", "44ADA", "44AE"];
const FORM_TYPES = ["3CB", "3CA", "3CD"];

export default function TaxAuditMaster({
  data, master, setMaster, patchMaster, saveMaster, masterSaving, masterLoaded,
}: Props) {

  // Auto-populate on first load when master fields are blank
  useEffect(() => {
    if (!masterLoaded) return;
    if (master.tax_client_name) return; // already populated
    if (!data.clientName) return;

    patchMaster({
      tax_client_name:       data.clientName,
      tax_address:           data.clientAddress,
      tax_pan:               data.pan,
      tax_cin:               data.cin,
      tax_gstin:             data.gstin,
      tax_entity_type:       data.entityType,
      tax_financial_year:    data.financialYear,
      tax_period_from:       data.fyStartDate,
      tax_period_to:         data.fyEndDate,
      tax_prev_year_from:    data.prevFyStart,
      tax_prev_year_to:      data.prevFyEnd,
      tax_auditor_firm:      data.auditFirm?.name     || data.firmName,
      tax_auditor_address:   data.auditFirm?.address
                               ? `${data.auditFirm.address}${data.auditFirm.city ? ", " + data.auditFirm.city : ""}`
                               : "",
      tax_icai_reg:          data.firm?.icai_firm_reg_no || data.auditFirm?.icai_reg_no || "",
      tax_partner_name:      data.auditFirm?.partner_name || "",
    });
  }, [masterLoaded, data.clientName]);

  const f = (
    id: keyof WsMaster,
    label: string,
    type: "text" | "date" | "number" = "text",
    half = false
  ) => (
    <div className={half ? "" : "col-span-2 md:col-span-1"}>
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

  const ta = (id: keyof WsMaster, label: string, rows = 2) => (
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
        <h3 className="font-semibold text-sm text-foreground">Tax Audit Master Sheet</h3>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-blue-600 hover:bg-blue-50 text-xs"
            onClick={() => {
              // Re-trigger auto-populate
              patchMaster({
                tax_client_name:    data.clientName,
                tax_address:        data.clientAddress,
                tax_pan:            data.pan,
                tax_cin:            data.cin,
                tax_gstin:          data.gstin,
                tax_entity_type:    data.entityType,
                tax_financial_year: data.financialYear,
                tax_period_from:    data.fyStartDate,
                tax_period_to:      data.fyEndDate,
                tax_prev_year_from: data.prevFyStart,
                tax_prev_year_to:   data.prevFyEnd,
                tax_auditor_firm:   data.auditFirm?.name || data.firmName,
                tax_icai_reg:       data.firm?.icai_firm_reg_no || data.auditFirm?.icai_reg_no || "",
                tax_partner_name:   data.auditFirm?.partner_name || "",
              });
            }}
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
            {f("tax_client_name",  "Name of Assessee")}
            {sel("tax_entity_type", "Entity Type", ENTITY_TYPES)}
            {f("tax_pan",          "PAN")}
            {f("tax_cin",          "CIN (if applicable)")}
            {f("tax_gstin",        "GSTIN")}
            {f("tax_financial_year","Financial Year (e.g. 2024-25)")}
            {f("tax_period_from",  "Previous Year From", "date")}
            {f("tax_period_to",    "Previous Year To",   "date")}
            {f("tax_prev_year_from","Prev-Prev Year From","date")}
            {f("tax_prev_year_to",  "Prev-Prev Year To",  "date")}
            {f("tax_turnover",     "Turnover / Gross Receipts (₹)", "number")}
            {sel("tax_accounting_method","Accounting Method", ACCOUNTING_METHODS)}
            {ta("tax_address",     "Registered Address")}
            {ta("tax_remarks",     "Remarks / Notes")}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* ── Audit Details ── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Audit Details</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {sel("tax_section",    "Section Under Which Audit Required", SECTIONS)}
            {sel("tax_form_type",  "Form Type", FORM_TYPES)}
            {f("tax_auditor_firm", "Name of Auditor / Firm")}
            {f("tax_icai_reg",     "ICAI Registration No.")}
            {f("tax_partner_name", "Partner / Proprietor Name")}
            {f("tax_partner_icai", "Partner Membership No.")}
            {f("tax_udin",         "UDIN")}
            {ta("tax_auditor_address","Auditor Address")}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
