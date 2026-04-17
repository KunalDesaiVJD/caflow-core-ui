/**
 * Form3CBTab
 *
 * Renders Form 3CB (audit report under section 44AB, clause (b) —
 * for persons whose accounts are NOT required to be audited under any other law).
 *
 * Auto-filled: client name / address / PAN, firm name / FRN / city,
 *              partner name / membership no, financial year.
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
  observation_text:   string;
  qualification_text: string;
  signature_date:     string;
  udin:               string;
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
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Highlighted auto-filled value */
function AutoVal({ v, placeholder = "—" }: { v?: string | null; placeholder?: string }) {
  return v ? (
    <span className="bg-blue-50 text-blue-900 font-medium border-b border-blue-200 px-0.5 print:bg-transparent print:border-0 print:font-bold">
      {v}
    </span>
  ) : (
    <span className="text-gray-400 italic print:text-gray-800">{placeholder}</span>
  );
}

/** Label + value row for client detail sub-block */
function DetailRow({ label, value, placeholder }: { label: string; value?: string | null; placeholder?: string }) {
  return (
    <div className="flex gap-2 text-sm leading-7">
      <span className="font-medium min-w-[120px]">{label}</span>
      <span>:</span>
      <AutoVal v={value} placeholder={placeholder ?? `[${label}]`} />
    </div>
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
    else       { setSaved(true); if (!silent) toast.success("Form 3CB saved"); }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const fy            = engagement?.financial_year || "";
  const startYear     = fyStartYear(fy);   // e.g. "2025"
  const endYear       = fyEndYear(fy);     // e.g. "2026"

  const clientName    = client?.name             || "";
  const clientAddress = client?.address          || client?.registered_office || "";
  const clientPAN     = client?.pan              || "";

  const firmName      = auditFirm?.name          || "";
  const firmFRN       = auditFirm?.icai_reg_no   || "";
  const firmCity      = auditFirm?.city          || "";
  const partnerName   = auditFirm?.partner_name  || "";
  const membershipNo  = auditFirm?.partner_icai_no || "";

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
        Open Form 3CB from an engagement (Stage 8).
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
            onClick={() => window.print()}
          >
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
      <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-4xl mx-auto shadow-sm print:border-0 print:shadow-none print:p-0 text-gray-800">

        {/* ─── HEADER ─── */}
        <div className="text-center mb-6 space-y-1">
          <p className="text-base font-bold uppercase tracking-wide">FORM NO. 3CB</p>
          <p className="text-xs text-gray-600">[See rule 6G (1) (b)]</p>
          <p className="text-sm font-medium mt-2 max-w-2xl mx-auto">
            Audit Report under section 44AB of the Income-tax Act, 1961 in a case of a person
            referred to in clause(b) of Sub-rule(1) of rule 6G
          </p>
        </div>

        <hr className="border-gray-300 mb-6" />

        {/* ─── POINT 1 ─── */}
        <div className="mb-5">
          <p className="text-sm leading-7 text-justify">
            <span className="font-semibold">1.</span>{" "}
            We have examined the Balance Sheet as on{" "}
            <span className="font-semibold">31st March, {endYear}</span>{" "}
            and the Profit and Loss account for the period beginning from{" "}
            <span className="font-semibold">1st April, {startYear}</span>{" "}
            to ending on{" "}
            <span className="font-semibold">31st March, {endYear}</span>,
            attached herewith, of ...
          </p>

          {/* Client detail sub-block */}
          <div className="ml-6 mt-2 space-y-0.5">
            <DetailRow label="Name"      value={clientName}    placeholder="[Client Name]" />
            <DetailRow label="Address"   value={clientAddress} placeholder="[Client Address]" />
            <DetailRow label="P.A.Number" value={clientPAN}    placeholder="[PAN]" />
          </div>
        </div>

        {/* ─── POINT 2 ─── */}
        <div className="mb-5">
          <p className="text-sm leading-7 text-justify">
            <span className="font-semibold">2.</span>{" "}
            We certify that the Balance Sheet and the Profit and Loss account are in agreement
            with the books of account maintained at the head office at above address.
          </p>
        </div>

        {/* ─── POINT 3 ─── */}
        <div className="mb-5 space-y-3">

          {/* 3(a) */}
          <div>
            <p className="text-sm leading-7">
              <span className="font-semibold">3. (a)</span>{" "}
              We report the following observation/comments/discrepancies/inconsistencies, if any:
            </p>
            <div className="ml-6 mt-1">
              {/* Editable — shown on screen */}
              <Textarea
                value={formData.observation_text}
                onChange={e => patch("observation_text", e.target.value)}
                placeholder="Enter observations…"
                className="text-sm min-h-[60px] resize-none print:hidden"
              />
              {/* Print version */}
              <p className="hidden print:block text-sm whitespace-pre-wrap border-b border-gray-300 pb-1 min-h-[32px]">
                {formData.observation_text}
              </p>
            </div>
          </div>

          {/* 3(b) */}
          <p className="text-sm leading-7 ml-4">
            <span className="font-semibold">(b)</span>{" "}
            Subject to above
          </p>

          {/* 3(A) */}
          <p className="text-sm leading-7 text-justify">
            <span className="font-semibold">(A)</span>{" "}
            We have obtained all the information and explanations which, to the best of our
            knowledge and belief, were necessary for the purpose of the audit.
          </p>

          {/* 3(B) */}
          <p className="text-sm leading-7 text-justify">
            <span className="font-semibold">(B)</span>{" "}
            In our opinion proper books of account have been kept by the head office and the
            branches, if any, of the assessee so far as appears from the examination of the books.
          </p>

          {/* 3(C) */}
          <div>
            <p className="text-sm leading-7 text-justify">
              <span className="font-semibold">(C)</span>{" "}
              In our opinion, and to the best of our information and according to explanations
              given to us, the said accounts, read with notes thereon, if any, give true and
              fair view:
            </p>
            {/* 3(C)(i) */}
            <p className="text-sm leading-7 ml-6 text-justify">
              <span className="font-semibold">(i)</span>{" "}
              in the case of the Balance Sheet, of the state of the affairs of the assessee as
              at <span className="font-semibold">31st March, {endYear}</span>; and
            </p>
            {/* 3(C)(ii) */}
            <p className="text-sm leading-7 ml-6 text-justify">
              <span className="font-semibold">(ii)</span>{" "}
              in the case of the Profit and Loss account, of the Profit of the assessee for the
              year ended on that date.
            </p>
          </div>

        </div>

        {/* ─── POINT 4 ─── */}
        <div className="mb-5">
          <p className="text-sm leading-7 text-justify">
            <span className="font-semibold">4.</span>{" "}
            The statement of particulars required to be furnished under section 44AB is annexed
            herewith in Form No.3CD and annexure thereto.
          </p>
        </div>

        {/* ─── POINT 5 ─── */}
        <div className="mb-8">
          <p className="text-sm leading-7 text-justify">
            <span className="font-semibold">5.</span>{" "}
            In our opinion, and to the best of our information and according to explanations
            given to us, the particulars given in the said Form No. 3CD and annexure thereto
            are true and correct, subject to following observations/qualifications, if any:
          </p>
          <div className="ml-6 mt-1">
            {/* Editable — shown on screen */}
            <Textarea
              value={formData.qualification_text}
              onChange={e => patch("qualification_text", e.target.value)}
              placeholder="Enter qualifications or 'Nil'…"
              className="text-sm min-h-[60px] resize-none print:hidden"
            />
            {/* Print version */}
            <p className="hidden print:block text-sm whitespace-pre-wrap border-b border-gray-300 pb-1 min-h-[32px]">
              {formData.qualification_text}
            </p>
          </div>
        </div>

        {/* ─── SIGNATURE BLOCK ─── */}
        <div className="flex justify-end">
          <div className="text-sm space-y-1 text-right min-w-[260px]">

            {/* Firm line */}
            <p>
              For, <AutoVal v={firmName} placeholder="[Audit Firm Name]" />
            </p>
            <p>Chartered Accountants</p>
            <p>
              FRN: <AutoVal v={firmFRN} placeholder="[Firm Reg No]" />
            </p>

            {/* Place */}
            <p className="mt-3">
              Place: <AutoVal v={firmCity} placeholder="[City]" />
            </p>

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
            <p>
              Membership No.: <AutoVal v={membershipNo} placeholder="[Membership No]" />
            </p>

          </div>
        </div>
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* ANNEXURE TO FORM NO. 3CB                                       */}
        {/* ═══════════════════════════════════════════════════════════════ */}

        <hr className="border-gray-400 border-t-2 my-10" />

        {/* ─── Annexure Header ─── */}
        <div className="text-center mb-6 space-y-1">
          <p className="text-sm font-bold uppercase tracking-wide">
            ANNEXURE TO FORM NO. 3CB [See rule 6G (1) (b)] OF
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
          herewith in Form No. 3CD read with Rule 6G(1)(b) of Income-tax Rules, 1962 that give
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
          No. 3CD read with Rule 6G(1)(b) of Income-tax Rules, 1962. We have conducted our
          verification of the statement in accordance with Guidance Note on Tax Audit under
          section 44AB of the Income-tax Act, 1961, issued by the Institute of Chartered
          Accountants of India.
        </p>

        {/* ─── Annexure Signature Block (same data as main form) ─── */}
        <div className="flex justify-end">
          <div className="text-sm space-y-1 text-right min-w-[260px]">

            <p>For, <AutoVal v={firmName} placeholder="[Audit Firm Name]" /></p>
            <p>Chartered Accountants</p>
            <p>FRN: <AutoVal v={firmFRN} placeholder="[Firm Reg No]" /></p>

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
