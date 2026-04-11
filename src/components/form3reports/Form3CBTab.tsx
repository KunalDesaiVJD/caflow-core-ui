/**
 * Form3CBTab
 *
 * Renders the complete Form 3CB (audit report under section 44AB, clause (b) —
 * for persons whose accounts are NOT required to be audited under any other law)
 * PLUS the Annexure to Form 3CB immediately below.
 *
 * Auto-filled: client name/address/PAN, firm name/reg no/city,
 *              partner name/membership no, financial year.
 *
 * Editable fields stored in form_3ca_3cb (tab='3cb', data jsonb):
 *   observation_text, qualification_text, signature_date, udin
 */
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth }  from "@/hooks/useAuth";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Printer, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CBFormData {
  observation_text:    string;
  qualification_text:  string;
  signature_date:      string;
  udin:                string;
}

const TODAY = new Date().toISOString().split("T")[0];

const DEFAULT_DATA: CBFormData = {
  observation_text:   "- Please see Notes on Accounts",
  qualification_text: "- As per Annexure attached",
  signature_date:     TODAY,
  udin:               "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fyStartYear(fy: string): string {
  const m = fy.match(/^(\d{4})/);
  return m ? m[1] : fy;
}
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
    <p className="font-bold text-sm mt-4 mb-1 underline underline-offset-2">{children}</p>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
}

export default function Form3CBTab({ engagementId }: Props) {
  const { user } = useAuth();

  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [engagement, setEngagement] = useState<any>(null);
  const [client,     setClient]     = useState<any>(null);
  const [auditFirm,  setAuditFirm]  = useState<any>(null);
  const [formRow,    setFormRow]    = useState<any>(null);
  const [formData,   setFormData]   = useState<CBFormData>(DEFAULT_DATA);

  const autoSaveRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Load ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!engagementId) { setLoading(false); return; }
    load();
  }, [engagementId]);

  async function load() {
    setLoading(true);

    const { data: eng } = await supabase
      .from("audit_engagements")
      .select("*, clients(*)")
      .eq("id", engagementId)
      .single();

    if (!eng) { setLoading(false); toast.error("Engagement not found"); return; }
    setEngagement(eng);
    setClient((eng as any).clients || null);

    if ((eng as any).audit_firm_id) {
      const { data: af } = await supabase
        .from("audit_firms")
        .select("*")
        .eq("id", (eng as any).audit_firm_id)
        .single();
      setAuditFirm(af || null);
    }

    const { data: existing } = await supabase
      .from("form_3ca_3cb" as any)
      .select("*")
      .eq("engagement_id", engagementId)
      .eq("tab", "3cb")
      .maybeSingle();

    if (existing) {
      setFormRow(existing);
      setFormData({ ...DEFAULT_DATA, ...(existing as any).data });
    } else {
      const { data: created } = await supabase
        .from("form_3ca_3cb" as any)
        .insert({
          engagement_id: engagementId,
          firm_id:       (eng as any).firm_id,
          client_id:     (eng as any).client_id,
          tab:           "3cb",
          data:          DEFAULT_DATA,
          status:        "draft",
        } as any)
        .select()
        .single();
      if (created) setFormRow(created as any);
    }

    setLoading(false);
  }

  // ── Patch ─────────────────────────────────────────────────────────────────

  const patch = useCallback(<K extends keyof CBFormData>(key: K, value: CBFormData[K]) => {
    setFormData(prev => {
      const next = { ...prev, [key]: value };
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => doSave(next, true), 3000);
      return next;
    });
    setSaved(false);
  }, [formRow]);

  // ── Save ─────────────────────────────────────────────────────────────────

  async function doSave(data: CBFormData, silent = false) {
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
    else { setSaved(true); if (!silent) toast.success("Form 3CB saved"); }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const fy          = engagement?.financial_year || "";
  const startYear   = fyStartYear(fy);
  const endYear     = fyEndYear(fy);
  const clientName    = client?.name    || "";
  const clientAddress = client?.address || "";
  const clientPAN     = client?.pan     || "";
  const firmName      = auditFirm?.name            || "";
  const firmReg       = auditFirm?.icai_reg_no     || "";
  const firmCity      = auditFirm?.city            || "";
  const partnerName   = auditFirm?.partner_name    || "";
  const membershipNo  = auditFirm?.partner_icai_no || "";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!engagementId) {
    return <p className="p-8 text-center text-muted-foreground">Open Form 3CB from an engagement (Stage 8).</p>;
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
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs print:hidden" onClick={() => window.print()}>
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

        {/* Header */}
        <div className="text-center mb-6 space-y-1">
          <p className="text-base font-bold uppercase tracking-wide">FORM NO. 3CB</p>
          <p className="text-xs text-gray-600">[See rule 6G(1)(b)]</p>
          <p className="text-sm font-medium mt-2">
            Audit Report under section 44AB of the Income-tax Act, 1961, in the case of a
            person referred to in clause (b) of sub-rule (1) of rule 6G
          </p>
        </div>

        <hr className="border-gray-300 mb-5" />

        {/* Para 1 */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
          <span className="font-semibold">1.</span>{" "}
          We have examined the Balance Sheet as on{" "}
          <span className="font-semibold">31st March, {endYear}</span>
          {" "}and the Profit and Loss Account for the period from{" "}
          <span className="font-semibold">1st April, {startYear}</span>
          {" "}to{" "}
          <span className="font-semibold">31st March, {endYear}</span>
          {" "}attached herewith, of —
        </div>

        {/* Client details block */}
        <div className="ml-6 mb-4 text-sm leading-7 text-gray-800 space-y-1">
          <p>
            <span className="font-medium w-28 inline-block">Name:</span>
            <AutoVal v={clientName} placeholder="[Client Name]" />
          </p>
          <p>
            <span className="font-medium w-28 inline-block">Address:</span>
            <AutoVal v={clientAddress} placeholder="[Client Address]" />
          </p>
          <p>
            <span className="font-medium w-28 inline-block">P.A. Number:</span>
            <AutoVal v={clientPAN} placeholder="[PAN]" />
          </p>
        </div>

        {/* Para 2 */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
          <span className="font-semibold">2.</span>{" "}
          In our opinion, the Balance Sheet and the Profit and Loss Account have been
          drawn up so as to give a true and fair view of the state of affairs of the
          above entity as on{" "}
          <span className="font-semibold">31st March, {endYear}</span>
          {" "}and of the profit/loss of the entity for the year ended on that date, and
          these are in agreement with the books of account maintained at the principal
          place of business.
        </div>

        {/* Para 3a */}
        <div className="text-sm leading-7 text-gray-800 mb-2">
          <span className="font-semibold">3.</span>{" "}
          <span className="font-semibold">(a)</span>{" "}
          The following observations/comments/discrepancies/inconsistencies are noted:
        </div>
        <div className="ml-6 mb-4">
          <Textarea
            value={formData.observation_text}
            onChange={e => patch("observation_text", e.target.value)}
            placeholder="Enter observations…"
            className="text-sm min-h-[80px] print:hidden resize-none"
          />
          <p className="hidden print:block text-sm whitespace-pre-wrap border-b border-gray-300 pb-2 min-h-[40px]">
            {formData.observation_text}
          </p>
        </div>

        {/* Para 3b */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
          <span className="font-semibold ml-6">(b)</span>{" "}
          Subject to the above and subject to the observations/qualifications mentioned
          in the audit report, the statement of particulars required to be furnished
          under section 44AB of the Income-tax Act, 1961, is annexed herewith in
          Form No. 3CD.
        </div>

        {/* Para 3A */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
          <span className="font-semibold">(A)</span>{" "}
          In our opinion and to the best of our information and according to the
          explanations given to us, the said accounts give the information required
          by the applicable Acts in the manner so required and give a true and fair
          view in conformity with the accounting principles generally accepted in India:
        </div>

        {/* Para 3B */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-4 ml-6">
          <span className="font-semibold">(B)</span>{" "}
          In the case of the Balance Sheet, of the state of affairs of the entity as at
          <span className="font-semibold"> 31st March, {endYear}</span>; and
        </div>

        {/* Para 3C */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-4 ml-6">
          <span className="font-semibold">(C)</span>{" "}
          In the case of the Profit and Loss Account, of the profit or loss for the year
          ended on that date.
        </div>

        {/* Para 4 */}
        <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
          <span className="font-semibold">4.</span>{" "}
          The statement of particulars required to be furnished under section 44AB is
          annexed herewith in Form No. 3CD.
        </div>

        {/* Para 5 */}
        <div className="text-sm leading-7 text-gray-800 mb-2">
          <span className="font-semibold">5.</span>{" "}
          In our opinion and to the best of our information and according to the
          explanations given to us, the particulars given in Form No. 3CD are
          true and correct, subject to the following observations/qualifications,
          if any:
        </div>
        <div className="ml-6 mb-6">
          <Textarea
            value={formData.qualification_text}
            onChange={e => patch("qualification_text", e.target.value)}
            placeholder="Enter qualifications or 'Nil'…"
            className="text-sm min-h-[80px] print:hidden resize-none"
          />
          <p className="hidden print:block text-sm whitespace-pre-wrap border-b border-gray-300 pb-2 min-h-[40px]">
            {formData.qualification_text}
          </p>
        </div>

        {/* Signature Block */}
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
            <p>Place: <AutoVal v={firmCity} placeholder="[City]" /></p>
            <p className="flex items-center justify-end gap-2">
              Date:{" "}
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
              UDIN:{" "}
              <span className="print:hidden">
                <Input
                  value={formData.udin}
                  onChange={e => patch("udin", e.target.value)}
                  placeholder="Enter UDIN"
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-48"
                />
              </span>
              <span className="hidden print:inline font-mono">{formData.udin || "___________________"}</span>
            </p>
          </div>
        </div>

        {/* ─────────────────────────────────────────── */}
        {/* ANNEXURE TO FORM 3CB                        */}
        {/* ─────────────────────────────────────────── */}

        <div className="mt-12 pt-8 border-t-2 border-gray-400">
          <div className="text-center mb-6 space-y-1">
            <p className="text-base font-bold uppercase tracking-wide">ANNEXURE TO FORM NO. 3CB</p>
            <p className="text-xs text-gray-600">[See rule 6G(1)(b)]</p>
            <p className="text-sm font-medium">
              OF <AutoVal v={clientName} placeholder="[CLIENT NAME]" />
            </p>
          </div>

          <hr className="border-gray-300 mb-5" />

          <SectionHeader>Section A — Responsibilities of the Assessee</SectionHeader>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
            The management of the assessee,{" "}
            <span className="font-semibold">M/s. <AutoVal v={clientName} placeholder="[Client Name]" /></span>
            {", "}is responsible for the preparation of the statements of accounts and other
            related documents in accordance with the applicable provisions of the Income-tax
            Act, 1961 and any other applicable law. In carrying out this responsibility,
            estimates and judgements are made to assess the expected effects of uncertain
            future events on the enterprise, and are required to produce financial statements
            that give a true and fair view of the financial position and financial performance
            of the entity.
          </div>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
            The management is also responsible for designing, implementing and maintaining
            adequate internal controls relevant to the preparation and presentation of the
            financial statements, and for selecting and applying appropriate accounting
            policies and making accounting estimates that are reasonable in the circumstances.
          </div>

          <SectionHeader>Section B — Responsibilities of the Auditors</SectionHeader>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
            Our responsibility is to express an opinion on the financial statements and
            other financial information based on our audit, as required under clause (b)
            of sub-section (1) of section 44AB of the Income-tax Act, 1961. We conducted
            our audit in accordance with the Standards on Auditing issued by the Institute
            of Chartered Accountants of India. Those Standards require that we comply with
            ethical requirements and plan and perform the audit to obtain reasonable
            assurance about whether the financial statements are free from material
            misstatement.
          </div>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-4">
            An audit involves performing procedures to obtain audit evidence about the amounts
            and disclosures in the financial statements. The procedures selected depend on
            the auditor's judgement, including the assessment of the risks of material
            misstatement of the financial statements, whether due to fraud or error.
          </div>

          <div className="text-sm leading-7 text-gray-800 text-justify mb-6">
            An audit also includes evaluating the appropriateness of accounting policies
            used and the reasonableness of accounting estimates made by management, as
            well as evaluating the overall presentation of the financial statements and
            related disclosures. We believe that the audit evidence we have obtained is
            sufficient and appropriate to provide a basis for our audit opinion on these
            financial statements.
          </div>

          {/* Annexure signature */}
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
