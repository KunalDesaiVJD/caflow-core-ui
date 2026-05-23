/**
 * Form3CATab  — fully editable
 *
 * Renders FORM NO. 3CA exactly as per the statutory Excel template:
 *   Header → 3 numbered points → Signature block
 *
 * Paragraph overrides are saved in the form_3ca_paragraphs JSONB column
 * on audit_engagements.  Dedicated sign-off fields (applicable_act,
 * audit_report_date, signature_date, udin) are saved to their own columns.
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
  // Sign-off / metadata (dedicated columns)
  applicable_act:    string;
  act_other_text:    string;
  audit_report_date: string;
  signature_date:    string;
  udin:              string;
  // Numbered points (stored in form_3ca_paragraphs JSONB)
  p1: string;
  p2: string;
  p3: string;
  // Annexure paragraphs
  anx_assessee_1: string;
  anx_assessee_2: string;
  anx_assessee_3: string;
  anx_auditor_1:  string;
  anx_auditor_2:  string;
  anx_auditor_3:  string;
}

const TODAY = new Date().toISOString().split("T")[0];

const APPLICABLE_ACTS = [
  "Companies Act, 2013",
  "Banking Regulation Act, 1949",
  "Insurance Act, 1938",
  "Electricity Act, 2003",
  "Other (specify)",
];

/** Build default paragraph text interpolated with engagement data. */
function buildDefaults(
  clientName:    string,
  clientAddr:    string,
  clientPAN:     string,
  firmName:      string,
  applicableAct: string,
  reportDate:    string,
  endYear:       string,
): Omit<CAFormData, "applicable_act" | "act_other_text" | "audit_report_date" | "signature_date" | "udin"> {
  const panPart = clientPAN ? ` (PAN: ${clientPAN})` : "";
  const nm      = clientName || "[Client Name]";
  const addr    = clientAddr ? `, ${clientAddr}` : "";
  const firm    = firmName || "[Audit Firm Name]";
  const act     = applicableAct || "Companies Act, 2013";
  const rDate   = reportDate
    ? new Date(reportDate).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "___________";

  return {
    p1: `We report that the statutory audit of M/s. ${nm}${addr}${panPart} was conducted by ${firm} in pursuance of the provisions of the ${act}, and We annex hereto a copy of the audit report dated ${rDate} along with a copy of each of the audited Statement of Profit and Loss Account, the audited Balance Sheet and documents declared by the said Act to be part of, or annexed to, such accounts.`,
    p2: `The statement of particulars required to be furnished under section 44AB is annexed herewith in Form No. 3CD.`,
    p3: `In our opinion and to the best of our information and according to examination of books of account including other relevant documents and explanations given to us, the particulars given in the said Form No. 3CD are true and correct as per Annexure attached.`,
    anx_assessee_1:
      `The assessee is responsible for the preparation of the aforesaid financial statements that give a true and fair view of the financial position and financial performance in accordance with the applicable Accounting Standards issued by the Institute of Chartered Accountants of India. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the financial statements that give a true and fair view and are free from material misstatement, whether due to fraud or error.`,
    anx_assessee_2:
      `The assessee is also responsible for the preparation of the statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961 annexed herewith in Form No. 3CD read with Rule 6G(1)(b) of Income-tax Rules, 1962 that give true and correct particulars as per the provisions of the Income-tax Act, 1961 read with Rules, Notifications, circulars, etc that are to be included in the Statement.`,
    anx_assessee_3:
      `Assessee are also responsible for overseeing the entity's financial reporting process.`,
    anx_auditor_1:
      `Our objectives are to obtain reasonable assurance about whether the financial statements as a whole are free from material misstatement, whether due to fraud or error, and to issue an auditor's report that includes our opinion. Reasonable assurance is a high level of assurance, but is not a guarantee that an audit conducted in accordance with SAs will always detect a material misstatement when it exists. Misstatements can arise from fraud or error and are considered material if, individually or in the aggregate, they could reasonably be expected to influence the economic decisions of users taken on the basis of these financial statements.`,
    anx_auditor_2:
      `We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our audit opinion.`,
    anx_auditor_3:
      `We are also responsible for verifying the statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961 annexed herewith in Form No. 3CD read with Rule 6G(1)(b) of Income-tax Rules, 1962. We have conducted our verification of the statement in accordance with Guidance Note on Tax Audit under section 44AB of the Income-tax Act, 1961, issued by the Institute of Chartered Accountants of India.`,
  };
}

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

// ─── Auto-resizing editable paragraph ─────────────────────────────────────────

function EditablePara({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [value]);

  return (
    <>
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`print:hidden w-full resize-none bg-transparent border-0 border-b border-transparent hover:border-amber-300 focus:border-amber-400 focus:outline-none focus:ring-0 leading-7 text-sm text-justify px-0 py-0.5 transition-colors ${className}`}
        rows={1}
      />
      <span className="hidden print:inline whitespace-pre-wrap">{value}</span>
    </>
  );
}

/** Highlighted auto-filled value */
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

interface Props { engagementId: string; }

export default function Form3CATab({ engagementId }: Props) {
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [engagement,  setEngagement]  = useState<any>(null);
  const [client,      setClient]      = useState<any>(null);
  const [auditFirm,        setAuditFirm]        = useState<any>(null);
  const [caFirm,           setCaFirm]           = useState<any>(null);
  const [firmMemberships,  setFirmMemberships]  = useState<Array<{ partner_name: string; membership_no: string }>>([]);
  const [partner,          setPartner]          = useState<any>(null);
  const [formData,    setFormData]    = useState<CAFormData>({
    applicable_act: "Companies Act, 2013", act_other_text: "",
    audit_report_date: TODAY, signature_date: TODAY, udin: "",
    ...buildDefaults("", "", "", "", "Companies Act, 2013", TODAY, ""),
    anx_assessee_1: "", anx_assessee_2: "", anx_assessee_3: "",
    anx_auditor_1:  "", anx_auditor_2:  "", anx_auditor_3:  "",
  });

  const autoSaveRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!engagementId) { setLoading(false); return; }
    load();
  }, [engagementId]);

  async function load() {
    setLoading(true);

    // Engagement + client + CA firm
    const { data: eng, error: engErr } = await supabase
      .from("audit_engagements")
      .select("*, clients(*), firms(*)")
      .eq("id", engagementId)
      .single();

    if (engErr || !eng) {
      setLoading(false);
      toast.error("Engagement not found" + (engErr ? `: ${engErr.message}` : ""));
      return;
    }
    setEngagement(eng);
    const cl = (eng as any).clients || null;
    setClient(cl);
    setCaFirm((eng as any).firms || null);

    // audit_firms — engagement-specific scalar columns (city, partner, FRN)
    let af: any = null;
    if ((eng as any).audit_firm_id) {
      const { data } = await supabase
        .from("audit_firms").select("*").eq("id", (eng as any).audit_firm_id).single();
      af = data || null;
      setAuditFirm(af);
    }

    // Fetch membership_numbers explicitly from firms table using firm_id.
    // The firms(*) join does not reliably return JSONB columns in all cases.
    if ((eng as any).firm_id) {
      const { data: firmRow } = await supabase
        .from("firms").select("membership_numbers").eq("id", (eng as any).firm_id).maybeSingle();
      const roster = Array.isArray(firmRow?.membership_numbers) ? (firmRow!.membership_numbers as any[]) : [];
      setFirmMemberships(
        roster.filter((m: any) => m?.partner_name).map((m: any) => ({
          partner_name: m.partner_name as string,
          membership_no: (m.membership_no as string) || "",
        }))
      );
    }

    // Partner — separate fetch (multiple FKs from audit_engagements→users
    // make PostgREST embed disambiguation unreliable)
    if ((eng as any).partner_id) {
      const { data: pu } = await supabase
        .from("users").select("name, membership_number").eq("id", (eng as any).partner_id).single();
      setPartner(pu || null);
    }

    const cf    = (eng as any).firms || {};
    const fName = af?.name || cf?.name || "";
    const act   = (eng as any).form_3ca_applicable_act || "Companies Act, 2013";
    const rDate = (eng as any).form_3ca_report_date    || TODAY;
    const fy    = (eng as any).financial_year || "";
    const endYr = fyEndYear(fy);
    const cName = cl?.name || "";
    const cAddr = cl?.address || cl?.registered_office || "";
    const cPAN  = cl?.pan   || "";

    const defaults = buildDefaults(cName, cAddr, cPAN, fName, act, rDate, endYr);

    // Saved paragraph overrides win over defaults
    const savedParas = ((eng as any).form_3ca_paragraphs as Record<string, string>) || {};
    setFormData({
      applicable_act:    act,
      act_other_text:    (eng as any).form_3ca_act_other_text  || "",
      audit_report_date: rDate,
      signature_date:    (eng as any).form_3ca_signature_date  || TODAY,
      udin:              (eng as any).form_3ca_udin || (eng as any).udin || "",
      ...defaults,
      ...savedParas,
    });

    setLoading(false);
  }

  const patch = useCallback(<K extends keyof CAFormData>(key: K, value: CAFormData[K]) => {
    setFormData(prev => {
      const next = { ...prev, [key]: value };
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => doSave(next, true), 3000);
      return next;
    });
    setSaved(false);
  }, [engagementId]);

  async function doSave(data: CAFormData, silent = false) {
    if (!engagementId) return;
    setSaving(true);
    const { applicable_act, act_other_text, audit_report_date, signature_date, udin, ...paragraphs } = data;
    const { error } = await supabase
      .from("audit_engagements")
      .update({
        form_3ca_applicable_act: applicable_act,
        form_3ca_act_other_text: act_other_text,
        form_3ca_report_date:    audit_report_date,
        form_3ca_signature_date: signature_date,
        form_3ca_udin:           udin,
        form_3ca_paragraphs:     paragraphs,
      } as any)
      .eq("id", engagementId);
    setSaving(false);
    if (error) { if (!silent) toast.error("Save failed: " + error.message); }
    else       { setSaved(true); if (!silent) toast.success("Form 3CA saved"); }
  }

  function handleDownloadPDF() {
    const safeClient = (clientName || "Client").replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
    const safeFY     = (fy || "").replace(/[^a-zA-Z0-9-]/g, "_");
    const prevTitle  = document.title;
    document.title   = `Form_3CA_${safeClient}_FY${safeFY}`;
    window.print();
    setTimeout(() => { document.title = prevTitle; }, 1000);
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const fy           = engagement?.financial_year || "";
  const clientName   = client?.name || "";
  const firmName     = auditFirm?.name         || caFirm?.name             || "";
  const firmFRN      = auditFirm?.icai_reg_no  || caFirm?.icai_firm_reg_no || caFirm?.icai_reg_no || "";
  const firmCity     = auditFirm?.city         || (caFirm?.address as any)?.city || "";
  const partnerName  = auditFirm?.partner_name || partner?.name || engagement?.partner_name || "";
  const norm = (s: string) => (s || "").trim().toLowerCase();
  const firmMnoMatch = partnerName ? firmMemberships.find(m => norm(m.partner_name) === norm(partnerName)) : undefined;
  const membershipNo = auditFirm?.partner_icai_no || partner?.membership_number || firmMnoMatch?.membership_no || "";

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

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
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs print:hidden" onClick={handleDownloadPDF}>
            <FileDown size={13} /> Download PDF
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700" onClick={() => doSave(formData)} disabled={saving}>
            <Save size={13} /> Save Form
          </Button>
        </div>
      </div>

      {/* ── Metadata fields (used by export) ── */}
      <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-muted-foreground print:hidden bg-muted/30 rounded-md p-3 border">
        <span className="font-medium text-foreground">Form fields:</span>

        <label className="flex items-center gap-1.5">
          Applicable Act:
          <Select value={formData.applicable_act} onValueChange={v => patch("applicable_act", v)}>
            <SelectTrigger className="h-6 text-xs border-gray-300 rounded px-2 min-w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPLICABLE_ACTS.map(a => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}
            </SelectContent>
          </Select>
          {formData.applicable_act === "Other (specify)" && (
            <Input value={formData.act_other_text} onChange={e => patch("act_other_text", e.target.value)}
              placeholder="Specify act…" className="h-6 text-xs w-44 border-gray-300" />
          )}
        </label>

        <label className="flex items-center gap-1.5">
          Audit Report Date:
          <Input type="date" value={formData.audit_report_date}
            onChange={e => patch("audit_report_date", e.target.value)}
            className="h-6 text-xs border-gray-300 rounded px-2 w-36" />
        </label>
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

        {/* ─── POINTS 1–3 ─── */}
        {([
          { num: "1.", key: "p1" as keyof CAFormData },
          { num: "2.", key: "p2" as keyof CAFormData },
          { num: "3.", key: "p3" as keyof CAFormData },
        ]).map(({ num, key }) => (
          <div key={key} className="mb-4 flex gap-2 items-start">
            <span className="font-semibold text-sm flex-shrink-0 mt-1">{num}</span>
            <EditablePara value={formData[key] as string} onChange={v => patch(key, v)} className="flex-1" />
          </div>
        ))}

        {/* ─── SIGNATURE BLOCK ─── */}
        <div className="flex justify-end mt-8">
          <div className="text-sm space-y-1 text-right min-w-[280px]">
            <p>For, <AutoVal v={firmName} placeholder="[Audit Firm Name]" /></p>
            <p>Chartered Accountants</p>
            <p>Firm Regi. No.: <AutoVal v={firmFRN} placeholder="[Firm Reg No]" /></p>

            <p className="mt-3">Place : <AutoVal v={firmCity} placeholder="[City]" /></p>

            <p className="flex items-center justify-end gap-2">
              <span>Date  :</span>
              <span className="print:hidden">
                <Input type="date" value={formData.signature_date}
                  onChange={e => patch("signature_date", e.target.value)}
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-36" />
              </span>
              <span className="hidden print:inline">{fmtDate(formData.signature_date)}</span>
            </p>

            <p className="flex items-center justify-end gap-2">
              <span>UDIN  :</span>
              <span className="print:hidden">
                <Input value={formData.udin} onChange={e => patch("udin", e.target.value)}
                  placeholder="Enter UDIN"
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-48" />
              </span>
              <span className="hidden print:inline font-mono">{formData.udin || "___________________"}</span>
            </p>

            <p className="mt-4 font-semibold"><AutoVal v={partnerName} placeholder="[Partner Name]" /></p>
            <p>Partner</p>
            <p>Membership No.: <AutoVal v={membershipNo} placeholder="[Membership No]" /></p>
          </div>
        </div>

        {/* ═══════════════════════ ANNEXURE ═══════════════════════ */}
        <hr className="border-gray-400 border-t-2 my-10" />

        {/* ─── Annexure Header ─── */}
        <div className="text-center mb-6 space-y-1">
          <p className="text-lg font-bold uppercase tracking-widest">
            ANNEXURE TO FORM NO. 3CA [See rule 6G (1) (a)] OF
          </p>
          <p className="text-sm font-bold uppercase">
            <AutoVal v={clientName} placeholder="[CLIENT NAME]" />
          </p>
        </div>

        <hr className="border-gray-300 mb-6" />

        {/* ─── Section 1: Assessee Responsibilities ─── */}
        <p className="text-sm font-bold mb-3">
          Responsibilities of Assessee (include Assessee's Management) and those charged with Governance for the Financial Statements
        </p>

        {(["anx_assessee_1", "anx_assessee_2", "anx_assessee_3"] as const).map(key => (
          <div key={key} className="mb-4">
            <EditablePara value={formData[key]} onChange={v => patch(key, v)} />
          </div>
        ))}

        {/* ─── Section 2: Auditor's Responsibilities ─── */}
        <p className="text-sm font-bold mb-3 mt-6">
          Auditor's Responsibility for the Audit of the Financial Statements
        </p>

        {(["anx_auditor_1", "anx_auditor_2", "anx_auditor_3"] as const).map(key => (
          <div key={key} className="mb-4">
            <EditablePara value={formData[key]} onChange={v => patch(key, v)} />
          </div>
        ))}

        {/* ─── Annexure Signature Block ─── */}
        <div className="flex justify-end mt-8">
          <div className="text-sm space-y-1 text-right min-w-[280px]">
            <p>For, <AutoVal v={firmName} placeholder="[Audit Firm Name]" /></p>
            <p>Chartered Accountants</p>
            <p>Firm Regi. No.: <AutoVal v={firmFRN} placeholder="[Firm Reg No]" /></p>

            <p className="mt-3">Place : <AutoVal v={firmCity} placeholder="[City]" /></p>

            <p className="flex items-center justify-end gap-2">
              <span>Date  :</span>
              <span className="print:hidden">
                <Input type="date" value={formData.signature_date}
                  onChange={e => patch("signature_date", e.target.value)}
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-36" />
              </span>
              <span className="hidden print:inline">{fmtDate(formData.signature_date)}</span>
            </p>

            <p className="flex items-center justify-end gap-2">
              <span>UDIN  :</span>
              <span className="print:hidden">
                <Input value={formData.udin} onChange={e => patch("udin", e.target.value)}
                  placeholder="Enter UDIN"
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-48" />
              </span>
              <span className="hidden print:inline font-mono">{formData.udin || "___________________"}</span>
            </p>

            <p className="mt-4 font-semibold"><AutoVal v={partnerName} placeholder="[Partner Name]" /></p>
            <p>Partner</p>
            <p>Membership No.: <AutoVal v={membershipNo} placeholder="[Membership No]" /></p>
          </div>
        </div>

      </div>
    </div>
  );
}
