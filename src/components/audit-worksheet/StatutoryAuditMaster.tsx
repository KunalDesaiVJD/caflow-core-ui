/**
 * StatutoryAuditMaster — Sheet 1 (Statutory Audit)
 *
 * Statutory Audit Master — shown when audit_type = "statutory" | "both"
 *
 * Fields:
 *  1.  Name of Client             — auto-fetch (read-only)
 *  2.  Address                    — auto-fetch (read-only)
 *  3.  PAN No.                    — auto-fetch (read-only)
 *  4.  Birth / Regi. Date         — auto-fetch (read-only)
 *  5.  Entity Type                — auto-fetch (read-only)
 *  6.  Contact Nos.               — Accountant + Mobile
 *  7.  Previous Year Details      — checkboxes
 *  8.  Books of Accounts          — checkboxes
 *  9.  Dates Audit Conducted      — FROM / TO date pickers
 * 10.  CARO Applicability         — YES/NO
 * 11.  Audit Report Type          — dropdown
 * 12.  Payments to Relatives      — YES/NO
 * 13.  Secured / Unsecured Loan   — YES/NO
 * 14.  Audit Carried Out By       — dynamic list
 * 15.  Audit Report Prepared By   — employee dropdown
 * 16.  Financial Statements Prepared By — employee dropdown
 * 17.  Reviewed By (Partner)      — employee dropdown
 * 18.  Signed Copy Received       — date
 * 19.  Management Repr. Letter    — date
 * 20.  Appointment Letter         — date
 */
import { useEffect, useState } from "react";
import { Badge }     from "@/components/ui/badge";
import { Button }    from "@/components/ui/button";
import { Input }     from "@/components/ui/input";
import { Label }     from "@/components/ui/label";
import { Checkbox }  from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Save, Loader2, Wand2, Building2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { useStatutoryMasterStorage } from "./hooks/useStatutoryMasterStorage";
import { useEmployeeDropdown }        from "./hooks/useEmployeeDropdown";
import type { AuditWorksheetData }    from "./hooks/useAuditWorksheetData";

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
  onSaved?:     () => void;
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

// ─── Sub-components ─────────────────────────────────────────────────────────

function ReadOnlyField({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("space-y-0.5", className)}>
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

function YesNo({ value, onChange }: { value: "yes" | "no" | ""; onChange: (v: "yes" | "no") => void }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as "yes" | "no")}>
      <SelectTrigger className="h-8 text-sm w-28">
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="yes">Yes</SelectItem>
        <SelectItem value="no">No</SelectItem>
      </SelectContent>
    </Select>
  );
}

function EmpSelect({ label, value, onChange, employees }: {
  label: string;
  value: string;
  onChange: (id: string, name: string) => void;
  employees: { id: string; name: string | null; role: string | null }[];
}) {
  return (
    <div className="space-y-0.5">
      <Label className="text-xs">{label}</Label>
      <Select
        value={value || "__none__"}
        onValueChange={id => {
          const realId = id === "__none__" ? "" : id;
          const emp = employees.find(e => e.id === realId);
          onChange(realId, emp?.name || "");
        }}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="— Select team member —" />
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

export default function StatutoryAuditMaster({ data, engagementId, onSaved }: Props) {
  const { data: m, setField, patchFields, manualSave, saving, loaded } =
    useStatutoryMasterStorage(engagementId, data.engagement?.firm_id);

  const { employees } = useEmployeeDropdown();

  // Auto-fill dates on first load
  useEffect(() => {
    if (!loaded || !data.clientName) return;
    if (m.audit_date_from) return;
    patchFields({ audit_date_from: data.fyStartDate, audit_date_to: data.fyEndDate });
  }, [loaded, data.clientName]);

  const fyExpanded = expandFY(data.financialYear);

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
          <h2 className="text-lg font-bold tracking-wide">{data.firmName || "CA Firm"}</h2>
        </div>
        <p className="text-sm font-semibold opacity-90 tracking-widest uppercase">
          Statutory Audit — Year {fyExpanded || data.financialYear}
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
            onClick={() => patchFields({ audit_date_from: data.fyStartDate, audit_date_to: data.fyEndDate })}
          >
            <Wand2 size={13} /> Auto-fill dates
          </Button>
          <Button size="sm" className="gap-1 h-7 text-xs bg-emerald-700 hover:bg-emerald-800" onClick={async () => { await manualSave(); onSaved?.(); }} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </Button>
        </div>
      </div>

      {/* ══════════ FORM BODY ══════════ */}
      <div className="px-4 py-4 space-y-5">

        {/* ── 1. Name of Client ── */}
        <SectionHeader no={1} label="Name of Client" />
        <ReadOnlyField label="Client / Assessee Name" value={data.clientName} />

        {/* ── 2. Address ── */}
        <SectionHeader no={2} label="Address" />
        <ReadOnlyField label="Registered / Correspondence Address" value={data.clientAddress} />

        {/* ── 3. PAN No. ── */}
        <SectionHeader no={3} label="PAN No." />
        <ReadOnlyField label="PAN" value={data.pan} />

        {/* ── 4. Registration Date ── */}
        <SectionHeader no={4} label="Date of Incorporation / Registration" />
        <ReadOnlyField label="Date" value={fmtDate(data.client?.date_of_incorporation)} />

        {/* ── 5. Entity Type ── */}
        <SectionHeader no={5} label="Entity Type" />
        <ReadOnlyField label="Entity Type" value={data.entityType} />

        {/* ── 6. Contact Nos. ── */}
        <SectionHeader no={6} label="Contact Nos." />
        <div className="border rounded-lg p-3 bg-muted/20 max-w-sm space-y-3">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wide">
            Accountant / CA Contact
          </p>
          <div className="space-y-0.5">
            <Label htmlFor="sa_acc_name" className="text-xs">Accountant Name</Label>
            <Input id="sa_acc_name" className="h-8 text-sm" value={m.accountant_name}
              onChange={e => setField("accountant_name", e.target.value)} placeholder="Name…" />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="sa_mobile" className="text-xs">Mobile No. (10 digits)</Label>
            <Input id="sa_mobile" className="h-8 text-sm font-mono" maxLength={10} value={m.mobile_no}
              onChange={e => { const v = e.target.value.replace(/\D/g, "").slice(0, 10); setField("mobile_no", v); }}
              placeholder="9876543210" />
            {m.mobile_no && m.mobile_no.length !== 10 && (
              <p className="text-[10px] text-red-500">Must be exactly 10 digits</p>
            )}
          </div>
        </div>

        {/* ── 7. Previous Years Details ── */}
        <SectionHeader no={7} label="Previous Years Details (Documents Obtained)" />
        <div className="flex flex-col gap-2 pl-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            {chk("prev_moa_aoa_deed")}
            <span>MOA / AOA / Partnership Deed (if first year or any change)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            {chk("prev_it_return")}
            <span>Previous Year IT Return &amp; Balance Sheet</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            {chk("prev_audit_report")}
            <span>Previous Year Statutory Audit Report</span>
          </label>
        </div>

        {/* ── 8. Books of Accounts ── */}
        <SectionHeader no={8} label="Books of Accounts Verified" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 pl-2 border rounded-lg p-3 bg-muted/20">
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm">{chk("books_cash_book")} <span>Cash Book</span></label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">{chk("books_bank_book")} <span>Bank Book</span></label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">{chk("books_journal_register")} <span>Journal Register</span></label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">{chk("books_general_ledger")} <span>General Ledger</span></label>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm">{chk("books_purchase")} <span>Purchase Book</span></label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">{chk("books_sales_book")} <span>Sales Book</span></label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">{chk("books_stock_register")} <span>Stock Register</span></label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">{chk("books_others")} <span>Others</span></label>
          </div>
          {m.books_others && (
            <div className="col-span-2 mt-1">
              <Input className="h-8 text-sm" placeholder="Specify other books…"
                value={m.books_others_text} onChange={e => setField("books_others_text", e.target.value)} />
            </div>
          )}
        </div>

        {/* ── 9. Dates Audit Conducted ── */}
        <SectionHeader no={9} label="Dates Audit Conducted" />
        <div className="flex flex-wrap gap-6">
          <div className="space-y-0.5">
            <Label htmlFor="sa_from" className="text-xs">From</Label>
            <Input id="sa_from" type="date" className="h-8 text-sm w-40" value={m.audit_date_from}
              onChange={e => setField("audit_date_from", e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="sa_to" className="text-xs">To</Label>
            <Input id="sa_to" type="date" className="h-8 text-sm w-40" value={m.audit_date_to}
              onChange={e => setField("audit_date_to", e.target.value)} />
          </div>
        </div>

        {/* ── 10. CARO Applicability ── */}
        <SectionHeader no={10} label="CARO 2020 Applicable?" />
        <YesNo value={m.caro_applicable} onChange={v => setField("caro_applicable", v)} />

        {/* ── 11. Audit Carried Out By ── */}
        <SectionHeader no={11} label="Audit Carried Out By" />
        <div className="space-y-2">
          {(m.audit_carried_by || []).map((entry, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Select
                value={entry.id || "__none__"}
                onValueChange={empId => {
                  const realId = empId === "__none__" ? "" : empId;
                  const emp = employees.find(e => e.id === realId);
                  const updated = [...(m.audit_carried_by || [])];
                  updated[idx] = { id: realId, name: emp?.name || "" };
                  setField("audit_carried_by", updated);
                }}
              >
                <SelectTrigger className="h-8 text-sm flex-1 max-w-xs">
                  <SelectValue placeholder="— Select auditor —" />
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
              {entry.name && (
                <span className="text-xs text-emerald-700 font-medium">✓ {entry.name}</span>
              )}
              <Button type="button" size="sm" variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                onClick={() => {
                  const updated = (m.audit_carried_by || []).filter((_, i) => i !== idx);
                  setField("audit_carried_by", updated);
                }}>
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline"
            className="gap-1.5 h-7 text-xs border-emerald-600/30 text-emerald-700"
            onClick={() => {
              const updated = [...(m.audit_carried_by || []), { id: "", name: "" }];
              setField("audit_carried_by", updated);
            }}>
            <Plus size={12} /> Add Auditor
          </Button>
        </div>

      </div>

      {/* ══════════ FOOTER ══════════ */}
      <div className="bg-muted/30 border-t px-4 py-4 space-y-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
          Footer — Paths &amp; Sign-off
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-0.5">
            <Label className="text-xs">A/c (Tally) File Path</Label>
            <Input className="h-8 text-sm font-mono" placeholder="e.g. D:\Tally\2024-25\ClientName.xml"
              value={m.ac_path} onChange={e => setField("ac_path", e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-xs">Report / Working File Path</Label>
            <Input className="h-8 text-sm font-mono" placeholder="e.g. D:\Reports\2024-25\StatutoryAudit.xlsx"
              value={m.report_path} onChange={e => setField("report_path", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <EmpSelect label="Prepared By" value={m.footer_prepared_by_id}
            onChange={(id, name) => patchFields({ footer_prepared_by_id: id, footer_prepared_by_name: name })}
            employees={employees} />
          <EmpSelect label="Verified By" value={m.footer_verified_by_id}
            onChange={(id, name) => patchFields({ footer_verified_by_id: id, footer_verified_by_name: name })}
            employees={employees} />
          <EmpSelect label="Reviewed By (Partner)" value={m.footer_reviewed_by_id}
            onChange={(id, name) => patchFields({ footer_reviewed_by_id: id, footer_reviewed_by_name: name })}
            employees={employees} />
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
