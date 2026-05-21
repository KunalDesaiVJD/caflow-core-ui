/**
 * MergedAuditMaster — Sheet 1 (Both: Tax + Statutory)
 *
 * Shown when audit_type = "both". Merges all fields from Tax and Statutory
 * Audit Masters into a single form with no duplicates.
 *
 * Storage:
 *  - Common + Tax-unique fields  → tax_master_json
 *  - Statutory-unique fields     → statutory_master_json
 *  - audit_carried_by            → both (for cross-compatibility with Special Attention)
 *
 * Unique to Statutory: CARO 2020 Applicable, Previous Statutory Audit Report
 * Unique to Tax:       Stock Qty Records, GST Details
 * Common: all other fields
 */
import { useEffect, useState } from "react";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, Wand2, Eye, EyeOff, Building2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { useTaxMasterStorage,       type AuditorEntry } from "./hooks/useTaxMasterStorage";
import { useStatutoryMasterStorage }                     from "./hooks/useStatutoryMasterStorage";
import { useEmployeeDropdown }                           from "./hooks/useEmployeeDropdown";
import type { AuditWorksheetData }                       from "./hooks/useAuditWorksheetData";

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
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center">
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

export default function MergedAuditMaster({ data, engagementId, onSaved }: Props) {
  // Tax storage = primary (common + tax-unique fields)
  const tax = useTaxMasterStorage(engagementId, data.engagement?.firm_id);
  // Statutory storage = secondary (statutory-unique fields only)
  const stat = useStatutoryMasterStorage(engagementId, data.engagement?.firm_id);

  const { employees } = useEmployeeDropdown();
  const [showGstPwd, setShowGstPwd] = useState(false);
  const [showItPwd,  setShowItPwd]  = useState(false);

  const t = tax.data;
  const s = stat.data;

  // Auto-fill dates on first load. Uses programmaticPatch so the async
  // DB load that resolves shortly after mount is NOT blocked by the
  // userTypedRef sentinel — otherwise a returning user who navigates
  // back to this page would see auto-fill dates but their previously
  // saved Tally path / sign-off fields would disappear.
  useEffect(() => {
    if (!tax.loaded || !data.clientName) return;
    if (t.audit_date_from) return;
    tax.programmaticPatch({ audit_date_from: data.fyStartDate, audit_date_to: data.fyEndDate });
    stat.programmaticPatch({ audit_date_from: data.fyStartDate, audit_date_to: data.fyEndDate });
  }, [tax.loaded, data.clientName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default "GST Registered?" to "yes" when the client master already
  // has a GSTIN on file. Uses programmaticPatch (NOT setField) for the
  // same reason as above — auto-fill must never block the DB load that
  // restores the auditor's saved Tally path / report path / sign-off.
  useEffect(() => {
    if (!tax.loaded) return;
    if (t.gst_details) return;
    if (!data.gstin) return;
    tax.programmaticPatch({ gst_details: "yes" });
  }, [tax.loaded, data.gstin, t.gst_details]); // eslint-disable-line react-hooks/exhaustive-deps

  const fyExpanded = expandFY(data.financialYear);

  // ── Checkbox helper (from tax storage) ──────────────────────────────────
  function chk<K extends keyof typeof t>(field: K) {
    return (
      <Checkbox
        id={`merged_${field as string}`}
        checked={!!(t[field])}
        onCheckedChange={v => tax.setField(field, !!v as any)}
      />
    );
  }

  // ── Change audit_carried_by → write to BOTH storages ────────────────────
  function setCarriedBy(updated: AuditorEntry[]) {
    tax.setField("audit_carried_by", updated);
    stat.setField("audit_carried_by", updated);
  }

  // ── Save both storages ───────────────────────────────────────────────────
  const saving = tax.saving || stat.saving;
  const manualSaveAll = () => {
    tax.manualSave();
    stat.manualSave();
  };

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">
      {/* ══════════ HEADER ══════════ */}
      <div className="bg-indigo-700 text-white px-6 py-4 space-y-1">
        <div className="flex items-center gap-2">
          <Building2 size={18} />
          <h2 className="text-lg font-bold tracking-wide">{data.firmName || "CA Firm"}</h2>
        </div>
        <p className="text-sm font-semibold opacity-90 tracking-widest uppercase">
          Tax &amp; Statutory Audit — Year {fyExpanded || data.financialYear}
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
            className="gap-1 text-indigo-700 hover:bg-indigo-50 text-xs h-7"
            onClick={() => {
              tax.patchFields({ audit_date_from: data.fyStartDate, audit_date_to: data.fyEndDate });
              stat.patchFields({ audit_date_from: data.fyStartDate, audit_date_to: data.fyEndDate });
            }}
          >
            <Wand2 size={13} /> Auto-fill dates
          </Button>
          <Button
            size="sm"
            className="gap-1 h-7 text-xs bg-indigo-700 hover:bg-indigo-800"
            onClick={async () => { await manualSaveAll(); onSaved?.(); }}
            disabled={saving}
          >
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

        {/* ── 4. Birth / Registration Date ── */}
        <SectionHeader no={4} label="Birth Date / Registration Date" />
        <ReadOnlyField label="Date of Birth / Incorporation" value={fmtDate(data.client?.date_of_incorporation)} />

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
            <Label htmlFor="mg_acc_name" className="text-xs">Accountant Name</Label>
            <Input
              id="mg_acc_name"
              className="h-8 text-sm"
              value={t.accountant_name}
              onChange={e => tax.setField("accountant_name", e.target.value)}
              placeholder="Name…"
            />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="mg_mobile" className="text-xs">Mobile No. (10 digits)</Label>
            <Input
              id="mg_mobile"
              className="h-8 text-sm font-mono"
              maxLength={10}
              value={t.mobile_no}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 10);
                tax.setField("mobile_no", v);
              }}
              placeholder="9876543210"
            />
            {t.mobile_no && t.mobile_no.length !== 10 && (
              <p className="text-[10px] text-red-500">Must be exactly 10 digits</p>
            )}
          </div>
        </div>

        {/* ── 7. Previous Years Details ── */}
        <SectionHeader no={7} label="Previous Years Details (Documents Obtained, if first year or any change)" />
        <div className="flex flex-col gap-2 pl-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            {chk("prev_moa_aoa_deed")}
            <span>MOA / AOA / Partnership Deed</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            {chk("prev_it_return")}
            <span>Previous Year IT Return &amp; Balance Sheet</span>
          </label>
          {/* Tax-unique */}
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            {chk("prev_tax_audit_report")}
            <span>Previous Year Tax Audit Report (File)</span>
          </label>
          {/* Statutory-unique */}
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <Checkbox
              id="merged_prev_audit_report"
              checked={!!s.prev_audit_report}
              onCheckedChange={v => stat.setField("prev_audit_report", !!v as any)}
            />
            <span>Previous Year Statutory Audit Report (File)</span>
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
          {t.books_others && (
            <div className="col-span-2 mt-1">
              <Input
                className="h-8 text-sm"
                placeholder="Specify other books…"
                value={t.books_others_text}
                onChange={e => tax.setField("books_others_text", e.target.value)}
              />
            </div>
          )}
        </div>

        {/* ── 9. Stock Quantity Records (Tax-unique) ── */}
        <SectionHeader no={9} label="Stock Quantity Records Maintained" />
        <div className="flex flex-wrap items-start gap-4">
          <YesNo
            value={t.stock_qty_records}
            onChange={v => tax.setField("stock_qty_records", v)}
          />
          {t.stock_qty_records === "yes" && (
            <div className="flex-1 min-w-[200px] space-y-0.5">
              <Label className="text-xs">Details of stock records</Label>
              <Textarea
                rows={2}
                className="text-sm"
                placeholder="Describe stock records maintained…"
                value={t.stock_qty_details}
                onChange={e => tax.setField("stock_qty_details", e.target.value)}
              />
            </div>
          )}
        </div>

        {/* ── 10. Dates Audit Conducted ── */}
        <SectionHeader no={10} label="Dates Audit Conducted" />
        <div className="flex flex-wrap gap-6">
          <div className="space-y-0.5">
            <Label htmlFor="mg_audit_from" className="text-xs">From</Label>
            <Input
              id="mg_audit_from"
              type="date"
              className="h-8 text-sm w-40"
              value={t.audit_date_from}
              onChange={e => {
                tax.setField("audit_date_from", e.target.value);
                stat.setField("audit_date_from", e.target.value);
              }}
            />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="mg_audit_to" className="text-xs">To</Label>
            <Input
              id="mg_audit_to"
              type="date"
              className="h-8 text-sm w-40"
              value={t.audit_date_to}
              onChange={e => {
                tax.setField("audit_date_to", e.target.value);
                stat.setField("audit_date_to", e.target.value);
              }}
            />
          </div>
        </div>

        {/* ── 11. GST Details (Tax-unique) ── */}
        <SectionHeader no={11} label="GST Registered?" />
        <div className="flex flex-wrap items-start gap-4">
          <YesNo
            value={t.gst_details}
            onChange={v => tax.setField("gst_details", v)}
          />
          {t.gst_details === "yes" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-w-[300px]">
              <div className="space-y-0.5">
                <Label className="text-xs">GST ID / Username</Label>
                <Input
                  className="h-8 text-sm font-mono"
                  value={t.gst_id}
                  onChange={e => tax.setField("gst_id", e.target.value)}
                  placeholder="GST username / ID…"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs">GST Password</Label>
                <div className="flex gap-1">
                  <Input
                    className="h-8 text-sm font-mono flex-1"
                    type={showGstPwd ? "text" : "password"}
                    value={t.gst_password}
                    onChange={e => tax.setField("gst_password", e.target.value)}
                    placeholder="Password…"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setShowGstPwd(v => !v)}
                  >
                    {showGstPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {data.gstin && (
            <div className="w-full">
              <p className="text-[11px] text-muted-foreground">
                Registered GSTINs on file: <span className="font-mono font-medium">{data.gstin}</span>
              </p>
            </div>
          )}
        </div>

        {/* ── 11b. Income Tax Login Details ── */}
        <SectionHeader no={11} label="Income Tax Login Details" />
        <div className="flex flex-wrap items-start gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-w-[300px]">
            <div className="space-y-0.5">
              <Label className="text-xs">Income Tax ID / Username</Label>
              <Input
                className="h-8 text-sm font-mono"
                value={t.it_id}
                onChange={e => tax.setField("it_id", e.target.value)}
                placeholder="PAN / Income-tax e-filing user ID…"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-xs">Income Tax Password</Label>
              <div className="flex gap-1">
                <Input
                  className="h-8 text-sm font-mono flex-1"
                  type={showItPwd ? "text" : "password"}
                  value={t.it_password}
                  onChange={e => tax.setField("it_password", e.target.value)}
                  placeholder="Password…"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setShowItPwd(v => !v)}
                >
                  {showItPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
              </div>
            </div>
          </div>
          {data.pan && (
            <div className="w-full">
              <p className="text-[11px] text-muted-foreground">
                PAN on file: <span className="font-mono font-medium">{data.pan}</span>
              </p>
            </div>
          )}
        </div>

        {/* ── 12. CARO 2020 Applicable (Statutory-unique) ── */}
        <SectionHeader no={12} label="CARO 2020 Applicable?" />
        <YesNo value={s.caro_applicable} onChange={v => stat.setField("caro_applicable", v)} />

        {/* ── 13. Audit Carried Out By ── */}
        <SectionHeader no={13} label="Audit Carried Out By" />
        <div className="space-y-2">
          {(t.audit_carried_by || []).map((entry: AuditorEntry, idx: number) => (
            <div key={idx} className="flex items-center gap-2">
              <Select
                value={entry.id || "__none__"}
                onValueChange={empId => {
                  const realId = empId === "__none__" ? "" : empId;
                  const emp = employees.find(e => e.id === realId);
                  const updated = [...(t.audit_carried_by || [])];
                  updated[idx] = { id: realId, name: emp?.name || "" };
                  setCarriedBy(updated);
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
                <span className="text-xs text-indigo-700 font-medium">✓ {entry.name}</span>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                onClick={() => {
                  const updated = (t.audit_carried_by || []).filter((_: AuditorEntry, i: number) => i !== idx);
                  setCarriedBy(updated);
                }}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs border-indigo-600/30 text-indigo-700"
            onClick={() => {
              const updated = [...(t.audit_carried_by || []), { id: "", name: "" }];
              setCarriedBy(updated);
            }}
          >
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
            <Input
              className="h-8 text-sm font-mono"
              placeholder="e.g. D:\Tally\2024-25\ClientName.xml"
              value={t.ac_path}
              onChange={e => tax.setField("ac_path", e.target.value)}
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-xs">Report / Working File Path</Label>
            <Input
              className="h-8 text-sm font-mono"
              placeholder="e.g. D:\Reports\2024-25\Audit.xlsx"
              value={t.report_path}
              onChange={e => tax.setField("report_path", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <EmpSelect
            label="Prepared By"
            value={t.footer_prepared_by_id}
            onChange={(id, name) => tax.patchFields({ footer_prepared_by_id: id, footer_prepared_by_name: name })}
            employees={employees}
          />
          <EmpSelect
            label="Verified By"
            value={t.footer_verified_by_id}
            onChange={(id, name) => tax.patchFields({ footer_verified_by_id: id, footer_verified_by_name: name })}
            employees={employees}
          />
          <EmpSelect
            label="Reviewed By (Partner)"
            value={t.footer_reviewed_by_id}
            onChange={(id, name) => tax.patchFields({ footer_reviewed_by_id: id, footer_reviewed_by_name: name })}
            employees={employees}
          />
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
