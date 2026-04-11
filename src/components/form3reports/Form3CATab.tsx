/**
 * Form3CATab
 *
 * Renders the complete Form 3CA (audit report under section 44AB for entities
 * whose accounts are required to be audited under any other law) PLUS the
 * Annexure to Form 3CA immediately below.
 *
 * Auto-filled fields (client name/address/PAN, audit firm name/reg no/city,
 * partner name/membership no, financial year) are fetched from:
 *   audit_engagements → clients.*  and  audit_engagements.audit_firm_id → audit_firms.*
 *
 * Editable fields saved to form_3ca_3cb (tab='3ca', data jsonb):
 *   applicable_act, act_other_text, audit_report_date, signature_date, udin
 */
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { supabase }   from "@/integrations/supabase/client";
import { useAuth }    from "@/hooks/useAuth";
import { Button }     from "@/components/ui/button";
import { Input }      from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Printer, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CAFormData {
  applicable_act:    string;
  act_other_text:    string;
  audit_report_date: string;
  signature_date:    string;
  udin:              string;
}

const TODAY = new Date().toISOString().split("T")[0];

const DEFAULT_DATA: CAFormData = {
  applicable_act:    "Companies Act, 2013",
  act_other_text:    "",
  audit_report_date: TODAY,
  signature_date:    TODAY,
  udin:              "",
};

const APPLICABLE_ACTS = [
  "Companies Act, 2013",
  "Multi-State Co-operative Societies Act, 2002",
  "Banking Regulation Act, 1949",
  "Securities and Exchange Board of India Act, 1992",
  "Insurance Act, 1938",
  "Electricity Act, 2003",
  "Other Applicable Act (Specify below)",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fyEndYear(fy: string): string {
  const parts = fy.split("-");
  if (parts.length < 2) return fy;
  const last = parts[parts.length - 1];
  return last.length === 2 ? String(parseInt(parts[0]) + 1) : last;
}

function fmtDate(d: string): string {
  if (!d) return "___________";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AutoVal({ v, placeholder = "—" }: { v?: string | null; placeholder?: string }) {
  return v ? (
    <span className="bg-blue-50 text-blue-900 font-medium border-b border-blue-200 px-0.5 print:bg-transparent print:border-0 print:font-bold">
      {v}
    </span>
  ) : (
    <span className="text-gray-400 italic print:text-gray-800">{placeholder}</span>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <p className="font-bold text-sm mt-4 mb-1 underline underline-offset-2">
      {children}
    </p>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
}

export default function Form3CATab({ engagementId }: Props) {
  const { user } = useAuth();

  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [engagement, setEngagement] = useState<any>(null);
  const [client,     setClient]     = useState<any>(null);
  const [auditFirm,  setAuditFirm]  = useState<any>(null);
  const [formRow,    setFormRow]    = useState<any>(null);
  const [formData,   setFormData]   = useState<CAFormData>(DEFAULT_DATA);

  const autoSaveRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Load ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!engagementId) { setLoading(false); return; }
    load();
  }, [engagementId]);

  async function load() {
    setLoading(true);

    // 1. Engagement + client
    const { data: eng } = await supabase
      .from("audit_engagements")
      .select("*, clients(*)")
      .eq("id", engagementId)
      .single();

    if (!eng) { setLoading(false); toast.error("Engagement not found"); return; }
    setEngagement(eng);
    setClient((eng as any).clients || null);

    // 2. Audit firm (via audit_firm_id FK)
    if ((eng as any).audit_firm_id) {
      const { data: af } = await supabase
        .from("audit_firms")
        .select("*")
        .eq("id", (eng as any).audit_firm_id)
        .single();
      setAuditFirm(af || null);
    }

    // 3. form_3ca_3cb row (tab = '3ca')
    const { data: existing } = await supabase
      .from("form_3ca_3cb" as any)
      .select("*")
      .eq("engagement_id", engagementId)
      .eq("tab", "3ca")
      .maybeSingle();

    if (existing) {
      setFormRow(existing);
      setFormData({ ...DEFAULT_DATA, ...(existing as any).data });
    } else {
      // Create blank record
      const { data: created } = await supabase
        .from("form_3ca_3cb" as any)
        .insert({
          engagement_id: engagementId,
          firm_id:       (eng as any).firm_id,
          client_id:     (eng as any).client_id,
          tab:           "3ca",
          data:          DEFAULT_DATA,
          status:        "draft",
        } as any)
        .select()
        .single();
      if (created) setFormRow(created as any);
    }

    setLoading(false);
  }

  // ── Patch helper ─────────────────────────────────────────────────────────

  const patch = useCallback(<K extends keyof CAFormData>(key: K, value: CAFormData[K]) => {
    setFormData(prev => {
      const next = { ...prev, [key]: value };
      // Schedule auto-save
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => doSave(next, true), 3000);
      return next;
    });
    setSaved(false);
  }, [formRow]);

  // ── Save ─────────────────────────────────────────────────────────────────

  async function doSave(data: CAFormData, silent = false) {
    if (!formRow) return;
    setSaving(true);
    const { error } = await supabase
      .from("form_3ca_3cb" as any)
      .update({
        data:          data,
        status:        "draft",
        last_saved_at: new Date().toISOString(),
        last_saved_by: user?.id,
      } as any)
      .eq("id", (formRow as any).id);
    setSaving(false);
    if (error) { if (!silent) toast.error("Save failed: " + error.message); }
    else { setSaved(true); if (!silent) toast.success("Form 3CA saved"); }
  }

  // ── Print ─────────────────────────────────────────────────────────────────

  function handlePrint() {
    window.print();
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const fy      = engagement?.financial_year || "";
  const endYear = fyEndYear(fy);
  const clientName    = client?.name    || "";
  const clientAddress = client?.address || "";
  const clientPAN     = client?.pan     || "";
  const firmName      = auditFirm?.name              || "";
  const firmReg       = auditFirm?.icai_reg_no       || "";
  const firmCity      = auditFirm?.city              || "";
  const partnerName   = auditFirm?.partner_name      || "";
  const membershipNo  = auditFirm?.partner_icai_no   || "";
  const actLabel      = formData.applicable_act === "Other Applicable Act (Specify below)" && formData.act_other_text
    ? formData.act_other_text
    : formData.applicable_act;

  // ── Loading / no engagement ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!engagementId) {
    return <p className="p-8 text-center text-muted-foreground">Open Form 3CA from an engagement (Stage 8).</p>;
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Toolbar (hidden on print) ── */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 size={13} /> Saved
            </span>
          )}
          {saving && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> Saving…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handlePrint}>
            <Printer size={13} /> Print / Export PDF
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700"
            onClick={() => doSave(formData)}
            disabled={saving}
          >
            <Save size={13} /> Save Draft
          </Button>
        </div>
      </div>

      {/* ── Document ── */}
      <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-4xl mx-auto shadow-sm print:border-0 print:shadow-none print:p-0">

        {/* ─── Form Header ─── */}
        <div className="text-center mb-6 space-y-1">
          <p className="text-base font-bold uppercase tracking-wide">FORM NO. 3CA</p>
          <p className="text-xs text-gray-600">[See rule 6G(1)(b)]</p>
          <p className="text-sm font-medium mt-2">
            Audit report under section 44AB of the Income-tax Act, 1961, in a case where
            the accounts of the business or profession of a person have been audited under
            any other law
          </p>
        </div>

        <hr className="border-gray-300 mb-5" />

        {/* ─── Paragraph 1 ─── */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
          <span className="font-semibold">1.</span>{" "}
          We report that the statutory audit of{" "}
          <span className="font-semibold">M/s. <AutoVal v={clientName} placeholder="[Client Name]" /></span>
          {clientAddress && (
            <>, <AutoVal v={clientAddress} placeholder="[Client Address]" /></>
          )}
          {clientPAN && (
            <> (PAN: <AutoVal v={clientPAN} />)</>
          )}
          {" "}was conducted by{" "}
          <span className="font-semibold"><AutoVal v={firmName} placeholder="[Audit Firm Name]" /></span>
          {" "}in pursuance of the provisions of the{" "}
          {/* Inline act dropdown */}
          <span className="inline-block print:hidden">
            <Select
              value={formData.applicable_act}
              onValueChange={v => patch("applicable_act", v)}
            >
              <SelectTrigger className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 min-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPLICABLE_ACTS.map(a => (
                  <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
          <span className="hidden print:inline font-medium">{actLabel}</span>
          {", "}
          and we annex hereto a copy of our audit report dated{" "}
          {/* Inline date picker */}
          <span className="inline-block print:hidden">
            <Input
              type="date"
              value={formData.audit_report_date}
              onChange={e => patch("audit_report_date", e.target.value)}
              className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-36 inline-block"
            />
          </span>
          <span className="hidden print:inline font-medium">{fmtDate(formData.audit_report_date)}</span>
          {" "}together with a copy of the audited Profit and Loss Account{" "}
          (or Income and Expenditure Account) for the year ended{" "}
          <span className="font-semibold">31st March, {endYear}</span>
          {" "}and the Balance Sheet as at that date.
        </div>

        {/* ─── Other act specify ─── */}
        {formData.applicable_act === "Other Applicable Act (Specify below)" && (
          <div className="mb-4 print:hidden">
            <Input
              value={formData.act_other_text}
              onChange={e => patch("act_other_text", e.target.value)}
              placeholder="Specify the applicable Act…"
              className="text-sm h-8 max-w-md"
            />
          </div>
        )}

        {/* ─── Paragraph 2 ─── */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
          <span className="font-semibold">2.</span>{" "}
          The statement of particulars required to be furnished under section 44AB is annexed
          herewith in Form No. 3CD.
        </div>

        {/* ─── Paragraph 3 ─── */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-6">
          <span className="font-semibold">3.</span>{" "}
          In our opinion and to the best of our information and according to the explanations
          given to us, the particulars given in Form No. 3CD and the Annexure thereto are
          true and correct.
        </div>

        {/* ─── Signature Block ─── */}
        <div className="mt-8 flex flex-col items-end gap-1 text-sm">
          <div className="text-right space-y-0.5">
            <p>For, <AutoVal v={firmName} placeholder="[Audit Firm Name]" /></p>
            <p>Chartered Accountants</p>
            <p>Firm Regi. No.: <AutoVal v={firmReg} placeholder="[Firm Reg No]" /></p>
          </div>

          <div className="mt-6 text-right space-y-0.5">
            <p className="font-semibold"><AutoVal v={partnerName} placeholder="[Partner Name]" /></p>
            <p>Partner</p>
            <p>Membership No.: <AutoVal v={membershipNo} placeholder="[Membership No]" /></p>
          </div>

          <div className="mt-4 text-right space-y-2">
            <p>
              Place:{" "}
              <AutoVal v={firmCity} placeholder="[City]" />
            </p>
            <p className="flex items-center justify-end gap-2">
              Date:{" "}
              <span className="print:hidden">
                <Input
                  type="date"
                  value={formData.signature_date}
                  onChange={e => patch("signature_date", e.target.value)}
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-36 inline-block"
                />
              </span>
              <span className="hidden print:inline">{fmtDate(formData.signature_date)}</span>
            </p>
            <p className="flex items-center justify-end gap-2">
              UDIN:{" "}
              <span className="print:hidden">
                <Input
                  value={formData.udin}
                  onChange={e => patch("udin", e.target.value)}
                  placeholder="Enter UDIN"
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-48 inline-block"
                />
              </span>
              <span className="hidden print:inline font-mono">{formData.udin || "___________________"}</span>
            </p>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────── */}
        {/* ANNEXURE TO FORM 3CA                               */}
        {/* ─────────────────────────────────────────────────── */}

        <div className="mt-12 pt-8 border-t-2 border-gray-400">
          <div className="text-center mb-6 space-y-1">
            <p className="text-base font-bold uppercase tracking-wide">
              ANNEXURE TO FORM NO. 3CA
            </p>
            <p className="text-xs text-gray-600">[See rule 6G(1)(b)]</p>
            <p className="text-sm font-medium">
              OF <AutoVal v={clientName} placeholder="[CLIENT NAME]" />
            </p>
          </div>

          <hr className="border-gray-300 mb-5" />

          {/* Section A */}
          <SectionHeader>Section A — Responsibilities of the Assessee</SectionHeader>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
            The management of the assessee,{" "}
            <span className="font-semibold">M/s. <AutoVal v={clientName} placeholder="[Client Name]" /></span>
            {", "}is responsible for the preparation of the statements of accounts and other
            related documents in accordance with the applicable law, accounting standards,
            and guidelines issued by the Institute of Chartered Accountants of India (ICAI)
            or other regulatory bodies, as applicable to the entity. In carrying out this
            responsibility, estimates and judgements are made to assess the expected effects
            of uncertain future events on the enterprise, and are required to produce financial
            statements that give a true and fair view of the financial position.
          </div>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
            The management is also responsible for designing, implementing and maintaining
            adequate internal controls relevant to the preparation and presentation of the
            financial statements, and for maintaining adequate and proper books of account as
            required under the applicable law.
          </div>

          {/* Section B */}
          <SectionHeader>Section B — Responsibilities of the Auditors</SectionHeader>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
            Our responsibility is to conduct the statutory audit in accordance with the
            Standards on Auditing issued by the Institute of Chartered Accountants of India
            and to express our opinion on the financial statements based on our audit.
            Those Standards require that we comply with ethical requirements and plan and
            perform the audit to obtain reasonable assurance about whether the financial
            statements are free from material misstatement.
          </div>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
            An audit involves performing procedures to obtain audit evidence about the amounts
            and disclosures in the financial statements. The procedures selected depend on
            the auditor's judgement, including the assessment of the risks of material
            misstatement of the financial statements, whether due to fraud or error. In
            making those risk assessments, the auditor considers internal control relevant
            to the entity's preparation and fair presentation of the financial statements
            in order to design audit procedures that are appropriate in the circumstances,
            but not for the purpose of expressing an opinion on the effectiveness of the
            entity's internal control.
          </div>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-6">
            An audit also includes evaluating the appropriateness of accounting policies used
            and the reasonableness of accounting estimates made by management, as well as
            evaluating the overall presentation of the financial statements. We believe that
            the audit evidence we have obtained is sufficient and appropriate to provide a
            basis for our audit opinion.
          </div>

          {/* Annexure Signature Block */}
          <div className="mt-8 flex flex-col items-end gap-1 text-sm">
            <div className="text-right space-y-0.5">
              <p>For, <AutoVal v={firmName} placeholder="[Audit Firm Name]" /></p>
              <p>Chartered Accountants</p>
              <p>Firm Regi. No.: <AutoVal v={firmReg} placeholder="[Firm Reg No]" /></p>
            </div>
            <div className="mt-6 text-right space-y-0.5">
              <p className="font-semibold"><AutoVal v={partnerName} placeholder="[Partner Name]" /></p>
              <p>Partner</p>
              <p>Membership No.: <AutoVal v={membershipNo} placeholder="[Membership No]" /></p>
            </div>
            <div className="mt-4 text-right space-y-1">
              <p>Place: <AutoVal v={firmCity} placeholder="[City]" /></p>
              <p>Date: <span className="hidden print:inline">{fmtDate(formData.signature_date)}</span>
                <span className="print:hidden text-xs text-muted-foreground"> (same as above)</span>
              </p>
              <p>UDIN: <span className="font-mono">{formData.udin || "___________________"}</span></p>
            </div>
          </div>
        </div>
        {/* end annexure */}

      </div>
      {/* end document */}
    </div>
  );
}
