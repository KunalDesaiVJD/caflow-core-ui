/**
 * Form3CATab
 *
 * Renders Form 3CA (audit report under section 44AB for entities
 * whose accounts are required to be audited under any other law).
 *
 * Auto-filled: client name / address / PAN, audit firm name / FRN / city,
 *              partner name / membership no, financial year.
 *
 * Editable fields saved to audit_engagements columns:
 *   form_3ca_applicable_act, form_3ca_act_other_text, form_3ca_report_date,
 *   form_3ca_signature_date, udin
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, FileDown, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

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

// Dropdown options — spec-mandated list
const APPLICABLE_ACTS = [
  "Companies Act, 2013",
  "Banking Regulation Act, 1949",
  "Insurance Act, 1938",
  "Electricity Act, 2003",
  "Other (specify)",
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
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AutoVal({ v, placeholder = "—" }: { v?: string | null; placeholder?: string }) {
  return v ? (
    <span className="bg-amber-50 text-amber-800 font-medium border-b border-amber-300 px-0.5 print:bg-transparent print:border-0 print:font-bold">
      {v}
    </span>
  ) : (
    <span className="text-gray-400 italic print:text-gray-800">{placeholder}</span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
}

export default function Form3CATab({ engagementId }: Props) {
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [engagement,  setEngagement]  = useState<any>(null);
  const [client,      setClient]      = useState<any>(null);
  const [auditFirm,   setAuditFirm]   = useState<any>(null);  // audit_firms row (explicit override)
  const [caFirm,      setCaFirm]      = useState<any>(null);  // firms row (own CA practice)
  const [partnerUser, setPartnerUser] = useState<any>(null);  // users row (signing partner)
  const [formData,    setFormData]    = useState<CAFormData>(DEFAULT_DATA);

  const autoSaveRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Load ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!engagementId) { setLoading(false); return; }
    load();
  }, [engagementId]);

  async function load() {
    setLoading(true);

    // ── 1. Engagement + client + own CA firm in one query ──────────────────
    const { data: eng } = await supabase
      .from("audit_engagements")
      .select("*, clients(*), firms(*)")
      .eq("id", engagementId)
      .single();

    if (!eng) { setLoading(false); toast.error("Engagement not found"); return; }
    setEngagement(eng);
    setClient((eng as any).clients || null);
    setCaFirm((eng as any).firms   || null);

    // ── 2. Audit firm (explicit external auditor override, if set) ─────────
    if ((eng as any).audit_firm_id) {
      const { data: af } = await supabase
        .from("audit_firms")
        .select("*")
        .eq("id", (eng as any).audit_firm_id)
        .single();
      setAuditFirm(af || null);
    }

    // ── 3. Signing partner ─────────────────────────────────────────────────
    if ((eng as any).partner_id) {
      const { data: partner } = await supabase
        .from("users")
        .select("name, membership_number")
        .eq("id", (eng as any).partner_id)
        .single();
      setPartnerUser(partner || null);
    }

    // ── 4. Populate editable fields from engagement columns ───────────────
    setFormData({
      applicable_act:    (eng as any).form_3ca_applicable_act || DEFAULT_DATA.applicable_act,
      act_other_text:    (eng as any).form_3ca_act_other_text  || "",
      audit_report_date: (eng as any).form_3ca_report_date     || TODAY,
      signature_date:    (eng as any).form_3ca_signature_date  || TODAY,
      udin:              (eng as any).udin                     || "",
    });

    setLoading(false);
  }

  // ── Patch ─────────────────────────────────────────────────────────────────

  const patch = useCallback(<K extends keyof CAFormData>(key: K, value: CAFormData[K]) => {
    setFormData(prev => {
      const next = { ...prev, [key]: value };
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => doSave(next, true), 3000);
      return next;
    });
    setSaved(false);
  }, [engagementId]);

  // ── Save — writes editable fields directly to audit_engagements ──────────

  async function doSave(data: CAFormData, silent = false) {
    if (!engagementId) return;
    setSaving(true);
    const { error } = await supabase
      .from("audit_engagements")
      .update({
        form_3ca_applicable_act: data.applicable_act,
        form_3ca_act_other_text: data.act_other_text,
        form_3ca_report_date:    data.audit_report_date,
        form_3ca_signature_date: data.signature_date,
        udin:                    data.udin,
      } as any)
      .eq("id", engagementId);
    setSaving(false);
    if (error) { if (!silent) toast.error("Save failed: " + error.message); }
    else       { setSaved(true); if (!silent) toast.success("Form 3CA saved"); }
  }

  // ── Download PDF ─────────────────────────────────────────────────────────

  function handleDownloadPDF() {
    const safeClient = (clientName || "Client").replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
    const safeFY     = (fy || "").replace(/[^a-zA-Z0-9-]/g, "_");
    const prevTitle  = document.title;
    document.title   = `Form_3CA_${safeClient}_FY${safeFY}`;
    window.print();
    // Restore title after print dialog closes (synchronous in most browsers)
    setTimeout(() => { document.title = prevTitle; }, 1000);
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const fy          = engagement?.financial_year || "";
  const endYear     = fyEndYear(fy);                       // e.g. "2026"

  const clientName    = client?.name             || "";
  const clientAddress = client?.address          || client?.registered_office || "";
  const clientPAN     = client?.pan              || "";

  // Combined "M/s. NAME, ADDRESS" for Point 1 paragraph
  const clientNameAddr = [
    clientName    ? `M/s. ${clientName}` : "",
    clientAddress || "",
  ].filter(Boolean).join(", ");

  // Priority: auditFirm (explicit override) → caFirm (own CA firm) → partnerUser (signing partner)
  const firmName    = auditFirm?.name         || caFirm?.name            || "";
  const firmFRN     = auditFirm?.icai_reg_no  || caFirm?.icai_firm_reg_no || caFirm?.icai_reg_no || "";
  const firmCity    = auditFirm?.city         || (caFirm?.address as any)?.city || "";
  const partnerName = auditFirm?.partner_name || partnerUser?.name        || "";
  const membershipNo= auditFirm?.partner_icai_no || partnerUser?.membership_number || "";

  // Resolve display label for applicable act (handles "Other (specify)")
  const actLabel =
    formData.applicable_act === "Other (specify)" && formData.act_other_text
      ? formData.act_other_text
      : formData.applicable_act;

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!engagementId) {
    return (
      <p className="p-8 text-center text-muted-foreground">
        Open Form 3CA from an engagement (Stage 8).
      </p>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Toolbar ── */}
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
          <Button
            size="sm" variant="outline"
            className="h-8 gap-1.5 text-xs print:hidden"
            onClick={handleDownloadPDF}
          >
            <FileDown size={13} /> Download PDF
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700"
            onClick={() => doSave(formData)}
            disabled={saving}
          >
            <Save size={13} /> Save Form
          </Button>
        </div>
      </div>

      {/* ── Document ── */}
      <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-4xl mx-auto shadow-sm print:border-0 print:shadow-none print:p-0 text-gray-800">

        {/* ─── HEADER ─── */}
        <div className="text-center mb-6 space-y-1">
          <p className="text-xl font-bold uppercase tracking-widest">FORM NO. 3CA</p>
          <p className="text-xs text-gray-500 tracking-wide">[See rule 6G (1) (a)]</p>
          <p className="text-sm font-semibold italic mt-3 max-w-2xl mx-auto leading-relaxed">
            Audit report under section 44AB of the Income-tax Act, 1961, in the case where
            the accounts of the business or profession of a person have been audited under
            any other law:
          </p>
        </div>

        <hr className="border-gray-300 mb-6" />

        {/* ─── POINT 1 ─── */}
        <div className="mb-5">
          <p className="text-sm leading-8 text-justify">
            <span className="font-semibold">1.</span>{" "}
            We report that the statutory audit of{" "}
            {/* Auto-filled: M/s. CLIENT_NAME, ADDRESS */}
            <AutoVal v={clientNameAddr} placeholder="[M/s. Client Name, Address]" />{" "}
            (PAN:{" "}
            <AutoVal v={clientPAN} placeholder="[PAN]" />
            ){" "}
            was conducted by{" "}
            <AutoVal v={firmName} placeholder="[Audit Firm Name]" />{" "}
            in pursuance of the provisions of the{" "}

            {/* ── Applicable Act — editable dropdown (screen only) ── */}
            <span className="inline-block print:hidden align-middle mx-1">
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
            {/* "Other (specify)" text input */}
            {formData.applicable_act === "Other (specify)" && (
              <span className="inline-block print:hidden align-middle ml-1">
                <Input
                  value={formData.act_other_text}
                  onChange={e => patch("act_other_text", e.target.value)}
                  placeholder="Specify the applicable Act…"
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-56"
                />
              </span>
            )}
            {/* Print version */}
            <span className="hidden print:inline font-medium">{actLabel}</span>

            {", and We annex hereto a copy of the audit report dated "}

            {/* ── Audit Report Date — editable date picker (screen only) ── */}
            <span className="inline-block print:hidden align-middle mx-1">
              <Input
                type="date"
                value={formData.audit_report_date}
                onChange={e => patch("audit_report_date", e.target.value)}
                className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-36"
              />
            </span>
            {/* Print version */}
            <span className="hidden print:inline font-medium">{fmtDate(formData.audit_report_date)}</span>

            {" along with a copy of each of the audited Statement of Profit and Loss Account, the audited Balance Sheet and documents declared by the said Act to be part of, or annexed to, such accounts."}
          </p>
        </div>

        {/* ─── POINT 2 ─── */}
        <div className="mb-5">
          <p className="text-sm leading-7 text-justify">
            <span className="font-semibold">2.</span>{" "}
            The statement of particulars required to be furnished under section 44AB is annexed
            herewith in Form No. 3CD.
          </p>
        </div>

        {/* ─── POINT 3 ─── */}
        <div className="mb-8">
          <p className="text-sm leading-7 text-justify">
            <span className="font-semibold">3.</span>{" "}
            In our opinion and to the best of our information and according to examination of
            books of account including other relevant documents and explanations given to us,
            the particulars given in the said Form No. 3CD are true and correct as per Annexure
            attached.
          </p>
        </div>

        {/* ─── SIGNATURE BLOCK ─── */}
        <div className="flex justify-end">
          <div className="text-sm space-y-1 text-right min-w-[280px]">

            {/* Firm line — NOTE: 3CA uses 'Firm Regi. No.' (not 'FRN') */}
            <p>For, <AutoVal v={firmName} placeholder="[Audit Firm Name]" /></p>
            <p>Chartered Accountants</p>
            <p>Firm Regi. No.: <AutoVal v={firmFRN} placeholder="[Firm Reg No]" /></p>

            {/* Place */}
            <p className="mt-3">Place: <AutoVal v={firmCity} placeholder="[City]" /></p>

            {/* Date */}
            <p className="flex items-center justify-end gap-2">
              <span>Date:</span>
              <span className="print:hidden">
                <Input
                  type="date"
                  value={formData.signature_date}
                  onChange={e => patch("signature_date", e.target.value)}
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-36"
                />
              </span>
              <span className="hidden print:inline">{fmtDate(formData.signature_date)}</span>
            </p>

            {/* UDIN */}
            <p className="flex items-center justify-end gap-2">
              <span>UDIN:</span>
              <span className="print:hidden">
                <Input
                  value={formData.udin}
                  onChange={e => patch("udin", e.target.value)}
                  placeholder="Enter UDIN"
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-48"
                />
              </span>
              <span className="hidden print:inline font-mono">
                {formData.udin || "___________________"}
              </span>
            </p>

            {/* Partner */}
            <p className="mt-4 font-semibold">
              <AutoVal v={partnerName} placeholder="[Partner Name]" />
            </p>
            <p>Partner</p>
            <p>Membership No.: <AutoVal v={membershipNo} placeholder="[Membership No]" /></p>

          </div>
        </div>
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* ANNEXURE TO FORM NO. 3CA                                       */}
        {/* ═══════════════════════════════════════════════════════════════ */}

        <hr className="border-gray-400 border-t-2 my-10" />

        {/* ─── Annexure Header ─── */}
        <div className="text-center mb-6 space-y-1">
          <p className="text-lg font-bold uppercase tracking-widest">ANNEXURE</p>
          <p className="text-sm font-semibold uppercase tracking-wide">
            TO FORM NO. 3CA [See rule 6G (1) (a)] OF
          </p>
          <p className="text-sm font-bold uppercase">
            <AutoVal v={clientName} placeholder="[CLIENT NAME]" />
          </p>
        </div>

        <hr className="border-gray-300 mb-6" />

        {/* ─── Section 1 ─── */}
        <p className="text-sm font-bold underline underline-offset-2 mb-3">
          Responsibilities of Assessee (include Assessee's Management) and those charged
          with Governance for the Financial Statements
        </p>

        <p className="text-sm leading-7 text-justify mb-4">
          The assessee is responsible for the preparation of the aforesaid financial
          statements that give a true and fair view of the financial position and financial
          performance in accordance with the applicable Accounting Standards issued by the
          Institute of Chartered Accountants of India. This responsibility includes the design,
          implementation and maintenance of internal control relevant to the preparation and
          presentation of the financial statements that give a true and fair view and are free
          from material misstatement, whether due to fraud or error.
        </p>

        <p className="text-sm leading-7 text-justify mb-4">
          The assessee is also responsible for the preparation of the statement of particulars
          required to be furnished under section 44AB of the Income-tax Act, 1961 annexed
          herewith in Form No. 3CD read with Rule 6G(1)(a) of Income-tax Rules, 1962 that give
          true and correct particulars as per the provisions of the Income-tax Act, 1961 read
          with Rules, Notifications, circulars, etc that are to be included in the Statement.
        </p>

        <p className="text-sm leading-7 text-justify mb-6">
          Assessee are also responsible for overseeing the entity's financial reporting process.
        </p>

        {/* ─── Section 2 ─── */}
        <p className="text-sm font-bold underline underline-offset-2 mb-3">
          Auditor's Responsibility for the Audit of the Financial Statements
        </p>

        <p className="text-sm leading-7 text-justify mb-4">
          Our objectives are to obtain reasonable assurance about whether the financial
          statements as a whole are free from material misstatement, whether due to fraud or
          error, and to issue an auditor's report that includes our opinion. Reasonable assurance
          is a high level of assurance, but is not a guarantee that an audit conducted in
          accordance with SAs will always detect a material misstatement when it exists.
          Misstatements can arise from fraud or error and are considered material if,
          individually or in the aggregate, they could reasonably be expected to influence the
          economic decisions of users taken on the basis of these financial statements.
        </p>

        <p className="text-sm leading-7 text-justify mb-4">
          We believe that the audit evidence we have obtained is sufficient and appropriate to
          provide a basis for our audit opinion.
        </p>

        <p className="text-sm leading-7 text-justify mb-8">
          We are also responsible for verifying the statement of particulars required to be
          furnished under section 44AB of the Income-tax Act, 1961 annexed herewith in Form
          No. 3CD read with Rule 6G(1)(a) of Income-tax Rules, 1962. We have conducted our
          verification of the statement in accordance with Guidance Note on Tax Audit under
          section 44AB of the Income-tax Act, 1961, issued by the Institute of Chartered
          Accountants of India.
        </p>

        {/* ─── Annexure Signature Block ─── */}
        {/* NOTE: 3CA uses 'Firm Regi. No.' (not 'FRN') — matches Excel */}
        <div className="flex justify-end">
          <div className="text-sm space-y-1 text-right min-w-[280px]">

            <p>For, <AutoVal v={firmName} placeholder="[Audit Firm Name]" /></p>
            <p>Chartered Accountants</p>
            <p>Firm Regi. No.: <AutoVal v={firmFRN} placeholder="[Firm Reg No]" /></p>

            <p className="mt-3">Place: <AutoVal v={firmCity} placeholder="[City]" /></p>

            <p className="flex items-center justify-end gap-2">
              <span>Date:</span>
              <span className="print:hidden">
                <Input
                  type="date"
                  value={formData.signature_date}
                  onChange={e => patch("signature_date", e.target.value)}
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-36"
                />
              </span>
              <span className="hidden print:inline">{fmtDate(formData.signature_date)}</span>
            </p>

            <p className="flex items-center justify-end gap-2">
              <span>UDIN:</span>
              <span className="print:hidden">
                <Input
                  value={formData.udin}
                  onChange={e => patch("udin", e.target.value)}
                  placeholder="Enter UDIN"
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-48"
                />
              </span>
              <span className="hidden print:inline font-mono">
                {formData.udin || "___________________"}
              </span>
            </p>

            <p className="mt-4 font-semibold">
              <AutoVal v={partnerName} placeholder="[Partner Name]" />
            </p>
            <p>Partner</p>
            <p>Membership No.: <AutoVal v={membershipNo} placeholder="[Membership No]" /></p>

          </div>
        </div>

        {/* end document */}
      </div>
    </div>
  );
}
