/**
 * InternalAuditMaster — Sheet 2
 *
 * Exact replica of the Excel Internal Audit Master sheet.
 * Shown when audit_type = "internal"
 *
 * Fields (in order):
 *  1.  Name of Client            — auto-fetch (read-only)
 *  2.  Address                   — auto-fetch (read-only)
 *  3.  PAN No.                   — auto-fetch (read-only)
 *  4.  Birth / Regi. Date        — auto-fetch (read-only)
 *  5.  Contact Nos.              — 2-col: Accountant+Mobile | Bank A/c+Branch
 *  6.  Previous Year Details     — 1 checkbox (IT Return / Audit Report / BS)
 *  7.  Books of Accounts         — 8 checkboxes in 2 cols + Others text
 *  8.  Utilisation Certificates  — free text
 *  9.  Dates Audit Conducted     — FROM / TO date pickers
 * 10.  Audit Carried Out By      — 4 employee dropdowns (numbered 1–4)
 * 11.  GST Details               — ID + Password (no YES/NO toggle)
 * 12.  Secured/Unsecured Loan    — free text
 * 13.  Audit Report Prepared By  — employee dropdown
 *
 * Footer: Verified By (dropdown) | A/c Path | Report Path
 *
 * Built as a SEPARATE, self-contained component — NOT a conditional
 * version of TaxAuditMaster.
 */
import { useEffect, useState } from "react";
import { Badge }     from "@/components/ui/badge";
import { Button }    from "@/components/ui/button";
import { Input }     from "@/components/ui/input";
import { Label }     from "@/components/ui/label";
import { Textarea }  from "@/components/ui/textarea";
import { Checkbox }  from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, Wand2, Building2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

import { useInternalMasterStorage } from "./hooks/useInternalMasterStorage";
import { useEmployeeDropdown }       from "./hooks/useEmployeeDropdown";
import type { AuditWorksheetData }   from "./hooks/useAuditWorksheetData";

interface Props {
  data:          AuditWorksheetData;
  engagementId:  string;
  onSaved?:      () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function expandFY(fy: string): string {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return fy;
  const y = parseInt(m[1]);
  return `${y}-${y + 1}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-sm font-medium text-foreground bg-muted/40 rounded px-2 py-1.5 min-h-[32px] border border-dashed border-border/50">
        {value || <span className="text-muted-foreground/60 italic text-xs">—</span>}
      </p>
    </div>
  );
}

function SectionHeader({ label, no }: { label: string; no: number }) {
  return (
    <div className="flex items-center gap-2 mt-1 mb-2">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center">
        {no}
      </span>
      <p className="text-[13px] font-semibold text-foreground">{label}</p>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function EmpSelect({
  label, value, onChange, employees, placeholder = "— Select team member —",
}: {
  label:      string;
  value:      string;
  onChange:   (id: string, name: string) => void;
  employees:  { id: string; name: string | null; role: string | null }[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-0.5">
      {label && <Label className="text-xs">{label}</Label>}
      <Select
        value={value || "__none__"}
        onValueChange={id => {
          const realId = id === "__none__" ? "" : id;
          const emp = employees.find(e => e.id === realId);
          onChange(realId, emp?.name || "");
        }}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Unassigned —</SelectItem>
          {employees.map(e => (
            <SelectItem key={e.id} value={e.id}>
              {e.name || "—"}{e.role ? ` · ${e.role}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function InternalAuditMaster({ data, engagementId, onSaved }: Props) {
  const { data: m, setField, patchFields, programmaticPatch, manualSave, saving, loaded } =
    useInternalMasterStorage(engagementId, data.engagement?.firm_id);

  const { employees } = useEmployeeDropdown();
  const [showGstPwd, setShowGstPwd] = useState(false);
  const [showItPwd,  setShowItPwd]  = useState(false);

  // Auto-fill audit dates from FY on first open. Uses programmaticPatch
  // so the userTypedRef gate doesn't block the async DB load from
  // restoring previously-saved fields after navigation.
  useEffect(() => {
    if (!loaded || !data.fyStartDate) return;
    if (m.audit_date_from) return;
    programmaticPatch({
      audit_date_from: data.fyStartDate,
      audit_date_to:   data.fyEndDate,
    });
  }, [loaded, data.fyStartDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const fyExpanded = expandFY(data.financialYear);

  // Checkbox helper
  function chk<K extends keyof typeof m>(field: K) {
    return (
      <Checkbox
        id={field as string}
        checked={!!(m[field])}
        onCheckedChange={v => setField(field, !!v as any)}
      />
    );
  }

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* ══════════ HEADER ══════════ */}
      <div className="bg-emerald-700 text-white px-6 py-4 space-y-1">
        <div className="flex items-center gap-2">
          <Building2 size={18} />
          <h2 className="text-lg font-bold tracking-wide">
            {data.firmName || "CA Firm"}
          </h2>
        </div>
        <p className="text-sm font-semibold opacity-90 tracking-widest uppercase">
          Internal Audit — Year {fyExpanded || data.financialYear}
        </p>
      </div>

      {/* ══════════ TOOLBAR ══════════ */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{data.auditTypeLabel}</Badge>
          {data.isCorporate && (
            <Badge className="text-xs bg-blue-100 text-blue-700">Corporate</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-emerald-700 hover:bg-emerald-50 text-xs h-7"
            onClick={() => patchFields({
              audit_date_from: data.fyStartDate,
              audit_date_to:   data.fyEndDate,
            })}
          >
            <Wand2 size={13} /> Auto-fill dates
          </Button>
          <Button
            size="sm"
            className="gap-1 h-7 text-xs bg-emerald-700 hover:bg-emerald-800"
            onClick={async () => { await manualSave(); onSaved?.(); }}
            disabled={saving}
          >
            {saving
              ? <Loader2 size={13} className="animate-spin" />
              : <Save size={13} />
            }
            Save
          </Button>
        </div>
      </div>

      {/* ══════════ FORM BODY ══════════ */}
      <div className="px-4 py-4 space-y-5">

        {/* ── 1. Name of Client ── */}
        <SectionHeader no={1} label="Name of Client" />
        <ReadOnlyField label="Client / Organisation Name" value={data.clientName} />

        {/* ── 2. Address ── */}
        <SectionHeader no={2} label="Address" />
        <ReadOnlyField
          label="Registered / Corporate Office Address"
          value={data.clientAddress}
        />

        {/* ── 3. PAN No. ── */}
        <SectionHeader no={3} label="PAN No." />
        <ReadOnlyField label="PAN" value={data.pan} />

        {/* ── 4. Birth / Regi. Date ── */}
        <SectionHeader no={4} label="Birth Date / Registration Date" />
        <ReadOnlyField
          label="Date of Birth / Incorporation"
          value={fmtDate(data.client?.date_of_incorporation)}
        />

        {/* ── 5. Contact Nos. ── */}
        <SectionHeader no={5} label="Contact Nos." />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-lg p-3 bg-muted/20">
          {/* Left — Accountant */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wide">
              Accountant / CA Contact
            </p>
            <div className="space-y-0.5">
              <Label htmlFor="int_acc_name" className="text-xs">Accountant Name</Label>
              <Input
                id="int_acc_name"
                className="h-8 text-sm"
                value={m.accountant_name}
                onChange={e => setField("accountant_name", e.target.value)}
                placeholder="Name…"
              />
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="int_mobile" className="text-xs">Mobile No. (10 digits)</Label>
              <Input
                id="int_mobile"
                className="h-8 text-sm font-mono"
                maxLength={10}
                value={m.mobile_no}
                onChange={e => setField("mobile_no", e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9876543210"
              />
              {m.mobile_no && m.mobile_no.length !== 10 && (
                <p className="text-[10px] text-red-500">Must be exactly 10 digits</p>
              )}
            </div>
          </div>

          {/* Right — Bank */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wide">
              Bank Details
            </p>
            <div className="space-y-0.5">
              <Label htmlFor="int_bank_ac" className="text-xs">Bank A/c No.</Label>
              <Input
                id="int_bank_ac"
                className="h-8 text-sm font-mono"
                value={m.bank_ac_no}
                onChange={e => setField("bank_ac_no", e.target.value)}
                placeholder="Account number…"
              />
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="int_bank_branch" className="text-xs">Bank &amp; Branch</Label>
              <Input
                id="int_bank_branch"
                className="h-8 text-sm"
                value={m.bank_branch}
                onChange={e => setField("bank_branch", e.target.value)}
                placeholder="e.g. SBI, Main Branch, Mumbai"
              />
            </div>
          </div>
        </div>

        {/* ── 6. Previous Year Details (single checkbox) ── */}
        <SectionHeader no={6} label="Previous Year Details (Document Obtained)" />
        <div className="pl-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            {chk("prev_it_return")}
            <span>Previous Year IT Return, Audit Report &amp; Balance Sheet</span>
          </label>
        </div>

        {/* ── 7. Books of Accounts ── */}
        <SectionHeader no={7} label="Books of Accounts Verified" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 pl-2 border rounded-lg p-3 bg-muted/20">
          {/* Left column */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              {chk("books_cash_book")} <span>Cash Book</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              {chk("books_bank_book")} <span>Bank Book</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              {chk("books_journal_register")} <span>Journal Register</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              {chk("books_general_ledger")} <span>General Ledger</span>
            </label>
          </div>
          {/* Right column */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              {chk("books_purchase")} <span>Purchase Book</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              {chk("books_sales_book")} <span>Sales Book</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              {chk("books_stock_register")} <span>Stock Register</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              {chk("books_others")} <span>Others</span>
            </label>
          </div>
          {m.books_others && (
            <div className="col-span-2 mt-1">
              <Input
                className="h-8 text-sm"
                placeholder="Specify other books…"
                value={m.books_others_text}
                onChange={e => setField("books_others_text", e.target.value)}
              />
            </div>
          )}
        </div>

        {/* ── 8. Utilisation Certificates ── */}
        <SectionHeader no={8} label="Utilisation Certificates" />
        <div className="space-y-0.5">
          <Label className="text-xs">Details of utilisation certificates obtained / verified</Label>
          <Textarea
            rows={3}
            className="text-sm"
            placeholder="Enter details of utilisation certificates…"
            value={m.utilisation_certificates}
            onChange={e => setField("utilisation_certificates", e.target.value)}
          />
        </div>

        {/* ── 9. Dates Audit Conducted ── */}
        <SectionHeader no={9} label="Dates Audit Conducted" />
        <div className="flex flex-wrap gap-6">
          <div className="space-y-0.5">
            <Label htmlFor="int_audit_from" className="text-xs">From</Label>
            <Input
              id="int_audit_from"
              type="date"
              className="h-8 text-sm w-40"
              value={m.audit_date_from}
              onChange={e => setField("audit_date_from", e.target.value)}
            />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="int_audit_to" className="text-xs">To</Label>
            <Input
              id="int_audit_to"
              type="date"
              className="h-8 text-sm w-40"
              value={m.audit_date_to}
              onChange={e => setField("audit_date_to", e.target.value)}
            />
          </div>
        </div>

        {/* ── 10. Audit Carried Out By (team of 4) ── */}
        <SectionHeader no={10} label="Audit Carried Out By" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {([1, 2, 3, 4] as const).map(n => (
            <div key={n} className="border rounded-lg p-2.5 bg-muted/20">
              <p className="text-[11px] font-bold text-muted-foreground uppercase mb-1.5">
                Auditor {n}
              </p>
              <EmpSelect
                label=""
                placeholder={`Select auditor ${n}…`}
                value={m[`auditor${n}_id` as keyof typeof m] as string}
                onChange={(id, name) =>
                  patchFields({
                    [`auditor${n}_id`]:   id,
                    [`auditor${n}_name`]: name,
                  } as any)
                }
                employees={employees}
              />
              {/* Show selected name as pill */}
              {(m[`auditor${n}_name` as keyof typeof m] as string) && (
                <p className="mt-1.5 text-[11px] text-emerald-700 font-medium truncate">
                  ✓ {m[`auditor${n}_name` as keyof typeof m] as string}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* ── 11. GST Details (no YES/NO toggle — direct fields) ── */}
        <SectionHeader no={11} label="GST Details" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border rounded-lg p-3 bg-muted/20 max-w-lg">
          <div className="space-y-0.5">
            <Label className="text-xs">GST ID / Username</Label>
            <Input
              className="h-8 text-sm font-mono"
              value={m.gst_id}
              onChange={e => setField("gst_id", e.target.value)}
              placeholder="GST username / ID…"
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-xs">GST Password</Label>
            <div className="flex gap-1">
              <Input
                className="h-8 text-sm font-mono flex-1"
                type={showGstPwd ? "text" : "password"}
                value={m.gst_password}
                onChange={e => setField("gst_password", e.target.value)}
                placeholder="Password…"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 flex-shrink-0"
                onClick={() => setShowGstPwd(v => !v)}
              >
                {showGstPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
          </div>
          {/* Show fetched GSTINs from client */}
          {data.gstin && (
            <div className="col-span-2">
              <p className="text-[11px] text-muted-foreground">
                Registered GSTINs on file:{" "}
                <span className="font-mono font-medium">{data.gstin}</span>
              </p>
            </div>
          )}
        </div>

        {/* ── 11b. Income Tax Login Details ── */}
        <SectionHeader no={11} label="Income Tax Login Details" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border rounded-lg p-3 bg-muted/20 max-w-lg">
          <div className="space-y-0.5">
            <Label className="text-xs">Income Tax ID / Username</Label>
            <Input
              className="h-8 text-sm font-mono"
              value={m.it_id}
              onChange={e => setField("it_id", e.target.value)}
              placeholder="PAN / Income-tax e-filing user ID…"
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-xs">Income Tax Password</Label>
            <div className="flex gap-1">
              <Input
                className="h-8 text-sm font-mono flex-1"
                type={showItPwd ? "text" : "password"}
                value={m.it_password}
                onChange={e => setField("it_password", e.target.value)}
                placeholder="Password…"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 flex-shrink-0"
                onClick={() => setShowItPwd(v => !v)}
              >
                {showItPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
          </div>
          {data.pan && (
            <div className="col-span-2">
              <p className="text-[11px] text-muted-foreground">
                PAN on file: <span className="font-mono font-medium">{data.pan}</span>
              </p>
            </div>
          )}
        </div>

        {/* ── 12. Secured / Unsecured Loan (free text) ── */}
        <SectionHeader no={12} label="Secured / Unsecured Loan Details" />
        <div className="space-y-0.5">
          <Label className="text-xs">
            Details of secured / unsecured loans (nature, amount, parties)
          </Label>
          <Textarea
            rows={3}
            className="text-sm max-w-2xl"
            placeholder="Describe loan details if applicable, or write 'NIL'…"
            value={m.secured_unsecured_loan}
            onChange={e => setField("secured_unsecured_loan", e.target.value)}
          />
        </div>

        {/* ── 13. Audit Report Prepared By ── */}
        <SectionHeader no={13} label="Audit Report Prepared By" />
        <div className="max-w-xs">
          <EmpSelect
            label=""
            value={m.audit_report_prepared_by_id}
            onChange={(id, name) =>
              patchFields({
                audit_report_prepared_by_id:   id,
                audit_report_prepared_by_name: name,
              })
            }
            employees={employees}
          />
        </div>

      </div>

      {/* ══════════ FOOTER ══════════ */}
      <div className="bg-muted/30 border-t px-4 py-4 space-y-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
          Footer — Sign-off &amp; Paths
        </p>

        {/* Verified By */}
        <div className="max-w-xs">
          <EmpSelect
            label="Verified By"
            value={m.footer_verified_by_id}
            onChange={(id, name) =>
              patchFields({
                footer_verified_by_id:   id,
                footer_verified_by_name: name,
              })
            }
            employees={employees}
          />
        </div>

        {/* Paths */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-0.5">
            <Label className="text-xs">A/c (Tally) File Path</Label>
            <Input
              className="h-8 text-sm font-mono"
              placeholder="e.g. D:\Tally\2024-25\ClientName.xml"
              value={m.ac_path}
              onChange={e => setField("ac_path", e.target.value)}
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-xs">Report / Working File Path</Label>
            <Input
              className="h-8 text-sm font-mono"
              placeholder="e.g. D:\Reports\2024-25\InternalAudit.xlsx"
              value={m.report_path}
              onChange={e => setField("report_path", e.target.value)}
            />
          </div>
        </div>

        {saving && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> Auto-saving…
          </p>
        )}
      </div>
    </div>
  );
}
