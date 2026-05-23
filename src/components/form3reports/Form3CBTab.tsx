/**
 * Form3CBTab  — fully editable
 *
 * Renders FORM NO. 3CB exactly as per the statutory Excel template:
 *   Header → 5 numbered points (with sub-parts) → Signature block
 *
 * Paragraph overrides are saved in the form_3cb_paragraphs JSONB column
 * on audit_engagements. Dedicated sign-off fields (signature_date, udin)
 * are saved to their own columns.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Loader2, Save, FileDown, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CBFormData {
  // Sign-off (dedicated columns)
  signature_date: string;
  udin:           string;
  // Paragraphs (stored in form_3cb_paragraphs JSONB)
  p1:      string;   // Point 1 opening sentence
  p2:      string;   // Point 2
  p3a:     string;   // Point 3(a) obs note
  p3b_A:   string;   // Point 3(b)(A)
  p3b_B:   string;   // Point 3(b)(B)
  p3b_C:   string;   // Point 3(b)(C) intro
  p3c_i:   string;   // Point 3(b)(C)(i)
  p3c_ii:  string;   // Point 3(b)(C)(ii)
  p4:      string;   // Point 4
  p5:      string;   // Point 5 main text
  p5_obs:  string;   // Point 5 observation line
  // Annexure paragraphs
  anx_assessee_1: string;
  anx_assessee_2: string;
  anx_assessee_3: string;
  anx_auditor_1:  string;
  anx_auditor_2:  string;
  anx_auditor_3:  string;
}

const TODAY = new Date().toISOString().split("T")[0];

/** Derive YEAR_START and YEAR_END from "YYYY-YY" or "YYYY-YYYY" FY string. */
function fyYears(fy: string): { start: string; end: string } {
  const parts = fy.split("-");
  if (parts.length < 2) return { start: fy || "____", end: fy || "____" };
  const startY  = parts[0];
  const endPart = parts[parts.length - 1];
  const endY    = endPart.length === 2 ? String(parseInt(startY) + 1) : endPart;
  return { start: startY || "____", end: endY || "____" };
}

/** Build default paragraph text interpolated with engagement data. */
function buildDefaults(
  yearStart: string,
  yearEnd:   string,
): Omit<CBFormData, "signature_date" | "udin"> {
  const ys = yearStart || "____";
  const ye = yearEnd   || "____";
  return {
    p1:
      `We have examined the Balance Sheet as on 31st March, ${ye} and the Profit and Loss account for the period beginning from 1st April, ${ys} to ending on 31st March, ${ye}, attached herewith, of …`,
    p2:
      `We certify that the Balance Sheet and the Profit and Loss account are in agreement with the books of account maintained at the head office at above address.`,
    p3a:
      `-Please see Notes on Accounts`,
    p3b_A:
      `(A) We have obtained all the information and explanations which, to the best of our knowledge and belief, were necessary for the purpose of the audit.`,
    p3b_B:
      `(B) In our opinion proper books of account have been keep by the head office and the branches, if any, of the assessee so far as appears from the examination of the books.`,
    p3b_C:
      `(C) In our opinion, and to the best of our information and according to explanations given to us, the said accounts, read with notes thereon, if any, give true and fair view :`,
    p3c_i:
      `(i) in the case of the Balance Sheet, of the state of the affairs of the assessee as at 31st March, ${ye} and`,
    p3c_ii:
      `(ii) in the case of the Profit and Loss accounts of the Profit of the assessee for the year ended on that date.`,
    p4:
      `The statement of particulars required to be furnished under section 44AB is annexed herewith in Form No.3CD and annexure thereto.`,
    p5:
      `In our opinion, and to the best of our information and according to explanations given to us, the particulars given in the said Form No. 3CD and annexure thereto are true and correct. subject to following observations/qualifications, if any:`,
    p5_obs:
      `- As per Annexure attached`,
    anx_assessee_1:
      `The assessee is responsible for the preparation of the aforesaid financial statements that give a true and fair view of the financial position and financial performance in accordance with the applicable Accounting Standards issued by the Institute of Chartered Accountants of India. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the financial statements that give a true and fair view and are free from material misstatement, whether due to fraud or error.`,
    anx_assessee_2:
      `The assessee is also responsible for the preparation of the statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961 annexed herewith in Form No. 3CD read with Rule 6G(1)(b) of Income-tax Rules, 1962 that give true and correct particulars as per the provisions of the Income-tax Act, 1961 read with Rules, Notifications, circulars, etc that are to be included in the Statement.`,
    anx_assessee_3:
      `Assessee are also responsible for overseeing the entity's financial reporting process.`,
    anx_auditor_1:
      `Our objectives are to obtain reasonable assurance about whether the financial statements as a whole are free from material misstatement, whether due to fraud or error, and to issue an auditor's report that includes our opinion. Reasonable assurance is a high level of assurance, but is not a guarantee that an audit conducted in accordance with SAs will always detect a material misstatement when it exists. Misstatements can arise from fraud or error and are considered material if, individually or in the aggregate, they could reasonably be expected to influence the economic decisions of users taken on the basis of these financial statements.`,
    anx_auditor_2:
      `We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our audit opinion`,
    anx_auditor_3:
      `We are also responsible for verifying the statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961 annexed herewith in Form No. 3CD read with Rule 6G(1)(b) of Income-tax Rules, 1962. We have conducted our verification of the statement in accordance with Guidance Note on Tax Audit under section 44AB of the Income-tax Act, 1961, issued by the Institute of Chartered Accountants of India.`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  if (!d) return "___________";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
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

export default function Form3CBTab({ engagementId }: Props) {
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [engagement,  setEngagement]  = useState<any>(null);
  const [client,      setClient]      = useState<any>(null);
  const [auditFirm,   setAuditFirm]   = useState<any>(null);
  const [caFirm,      setCaFirm]      = useState<any>(null);
  const [partner,     setPartner]     = useState<any>(null);

  const { start: initYS, end: initYE } = fyYears("");
  const [formData, setFormData] = useState<CBFormData>({
    signature_date: TODAY, udin: "",
    ...buildDefaults(initYS, initYE),
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
    if ((eng as any).audit_firm_id) {
      const { data: af } = await supabase
        .from("audit_firms").select("*").eq("id", (eng as any).audit_firm_id).single();
      setAuditFirm(af || null);
    }

    // Partner — separate fetch (multiple FKs from audit_engagements→users
    // make PostgREST embed disambiguation unreliable)
    if ((eng as any).partner_id) {
      const { data: pu } = await supabase
        .from("users").select("name, membership_number").eq("id", (eng as any).partner_id).single();
      setPartner(pu || null);
    }

    const fy = (eng as any).financial_year || "";
    const { start: ys, end: ye } = fyYears(fy);
    const defaults = buildDefaults(ys, ye);

    // Saved paragraph overrides win over defaults
    const savedParas = ((eng as any).form_3cb_paragraphs as Record<string, string>) || {};
    setFormData({
      signature_date: (eng as any).form_3cb_signature_date || TODAY,
      udin:           (eng as any).form_3cb_udin || (eng as any).udin || "",
      ...defaults,
      ...savedParas,
    });

    setLoading(false);
  }

  const patch = useCallback(<K extends keyof CBFormData>(key: K, value: CBFormData[K]) => {
    setFormData(prev => {
      const next = { ...prev, [key]: value };
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => doSave(next, true), 3000);
      return next;
    });
    setSaved(false);
  }, [engagementId]);

  async function doSave(data: CBFormData, silent = false) {
    if (!engagementId) return;
    setSaving(true);
    const { signature_date, udin, ...paragraphs } = data;
    const { error } = await supabase
      .from("audit_engagements")
      .update({
        form_3cb_signature_date: signature_date,
        form_3cb_udin:           udin,
        form_3cb_paragraphs:     paragraphs,
      } as any)
      .eq("id", engagementId);
    setSaving(false);
    if (error) { if (!silent) toast.error("Save failed: " + error.message); }
    else       { setSaved(true); if (!silent) toast.success("Form 3CB saved"); }
  }

  function handleDownloadPDF() {
    const safeClient = (clientName || "Client").replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
    const safeFY     = (fy || "").replace(/[^a-zA-Z0-9-]/g, "_");
    const prevTitle  = document.title;
    document.title   = `Form_3CB_${safeClient}_FY${safeFY}`;
    window.print();
    setTimeout(() => { document.title = prevTitle; }, 1000);
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const fy           = engagement?.financial_year || "";
  const clientName   = client?.name    || "";
  const clientAddr   = client?.address || client?.registered_office || "";
  const clientPAN    = client?.pan     || "";
  const firmName     = auditFirm?.name           || caFirm?.name             || "";
  const firmFRN      = auditFirm?.icai_reg_no    || caFirm?.icai_firm_reg_no || caFirm?.icai_reg_no || "";
  const firmCity     = auditFirm?.city           || (caFirm?.address as any)?.city || "";
  const partnerName  = auditFirm?.partner_name || partner?.name || engagement?.partner_name || "";
  // Look up membership number from caFirm.membership_numbers when the modern
  // partner-name flow is used (no partner_id / audit_firms.partner_icai_no set).
  const caFirmRoster: Array<{ partner_name: string; membership_no: string }> =
    Array.isArray(caFirm?.membership_numbers) ? (caFirm.membership_numbers as any) : [];
  const norm = (s: string) => (s || "").trim().toLowerCase();
  const caFirmMatch = partnerName ? caFirmRoster.find(m => norm(m.partner_name) === norm(partnerName)) : undefined;
  const membershipNo = auditFirm?.partner_icai_no || partner?.membership_number || caFirmMatch?.membership_no || "";

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

      {/* ── Document ── */}
      <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-4xl mx-auto shadow-sm print:border-0 print:shadow-none print:p-0 text-gray-800">

        {/* ─── HEADER ─── */}
        <div className="text-center mb-6 space-y-1">
          <p className="text-xl font-bold uppercase tracking-widest">FORM NO. 3CB</p>
          <p className="text-xs text-gray-500 tracking-wide">[See rule 6G (1) (b)]</p>
          <p className="text-sm font-semibold italic mt-3 max-w-2xl mx-auto leading-relaxed">
            Audit Report under section 44AB of the Income-tax Act, 1961 in a case of a person
            reffered to in clause(b) of Sub-rule(1) of rule 6G
          </p>
        </div>

        <hr className="border-gray-300 mb-6" />

        {/* ─── POINT 1 ─── */}
        <div className="mb-5 flex gap-2 items-start">
          <span className="font-semibold text-sm flex-shrink-0 mt-1">1.</span>
          <div className="flex-1">
            <EditablePara value={formData.p1} onChange={v => patch("p1", v)} />
            {/* Sub-fields: auto-filled from engagement */}
            <div className="mt-2 ml-4 space-y-1 text-sm">
              <p>
                <span className="font-medium">Name :</span>{" "}
                <AutoVal v={clientName} placeholder="[Entity Name]" />
              </p>
              <p>
                <span className="font-medium">Address :</span>{" "}
                <AutoVal v={clientAddr} placeholder="[Entity Address]" />
              </p>
              <p>
                <span className="font-medium">P.A.Number :</span>{" "}
                <AutoVal v={clientPAN} placeholder="[PAN]" />
              </p>
            </div>
          </div>
        </div>

        {/* ─── POINT 2 ─── */}
        <div className="mb-5 flex gap-2 items-start">
          <span className="font-semibold text-sm flex-shrink-0 mt-1">2.</span>
          <EditablePara value={formData.p2} onChange={v => patch("p2", v)} className="flex-1" />
        </div>

        {/* ─── POINT 3 ─── */}
        <div className="mb-5">
          <div className="flex gap-2 items-start mb-2">
            <span className="font-semibold text-sm flex-shrink-0 mt-1">3.</span>
            <div className="flex-1">
              {/* 3(a) */}
              <p className="text-sm font-medium mb-1">
                (a) We report the following observation/comments/discrepancies/inconsistencies, if any
              </p>
              <div className="ml-4">
                <EditablePara value={formData.p3a} onChange={v => patch("p3a", v)} />
              </div>

              {/* 3(b) */}
              <p className="text-sm font-medium mt-3 mb-2">(b) Subject to above</p>
              <div className="ml-4 space-y-3">
                <EditablePara value={formData.p3b_A} onChange={v => patch("p3b_A", v)} />
                <EditablePara value={formData.p3b_B} onChange={v => patch("p3b_B", v)} />
                <EditablePara value={formData.p3b_C} onChange={v => patch("p3b_C", v)} />
                {/* Sub-items (i) and (ii) */}
                <div className="ml-6 space-y-2">
                  <EditablePara value={formData.p3c_i}  onChange={v => patch("p3c_i",  v)} />
                  <EditablePara value={formData.p3c_ii} onChange={v => patch("p3c_ii", v)} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── POINT 4 ─── */}
        <div className="mb-5 flex gap-2 items-start">
          <span className="font-semibold text-sm flex-shrink-0 mt-1">4.</span>
          <EditablePara value={formData.p4} onChange={v => patch("p4", v)} className="flex-1" />
        </div>

        {/* ─── POINT 5 ─── */}
        <div className="mb-8 flex gap-2 items-start">
          <span className="font-semibold text-sm flex-shrink-0 mt-1">5.</span>
          <div className="flex-1">
            <EditablePara value={formData.p5} onChange={v => patch("p5", v)} />
            <div className="ml-4 mt-1">
              <EditablePara value={formData.p5_obs} onChange={v => patch("p5_obs", v)} />
            </div>
          </div>
        </div>

        {/* ─── SIGNATURE BLOCK ─── */}
        <div className="flex justify-end">
          <div className="text-sm space-y-1 text-right min-w-[280px]">
            <p>For, <AutoVal v={firmName} placeholder="[Audit Firm Name]" /></p>
            <p>Chartered Accountants</p>
            <p>FRN: <AutoVal v={firmFRN} placeholder="[Firm Reg No]" /></p>

            <p className="mt-3">Place: <AutoVal v={firmCity} placeholder="[City]" /></p>

            <p className="flex items-center justify-end gap-2">
              <span>Date:</span>
              <span className="print:hidden">
                <Input type="date" value={formData.signature_date}
                  onChange={e => patch("signature_date", e.target.value)}
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-36" />
              </span>
              <span className="hidden print:inline">{fmtDate(formData.signature_date)}</span>
            </p>

            <p className="flex items-center justify-end gap-2">
              <span>UDIN:</span>
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
            ANNEXURE TO FORM NO. 3CB [See rule 6G (1) (b)] OF
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
            <p>FRN: <AutoVal v={firmFRN} placeholder="[Firm Reg No]" /></p>

            <p className="mt-3">Place: <AutoVal v={firmCity} placeholder="[City]" /></p>

            <p className="flex items-center justify-end gap-2">
              <span>Date:</span>
              <span className="print:hidden">
                <Input type="date" value={formData.signature_date}
                  onChange={e => patch("signature_date", e.target.value)}
                  className="h-6 text-xs border-0 border-b border-gray-400 rounded-none bg-transparent focus:ring-0 px-1 w-36" />
              </span>
              <span className="hidden print:inline">{fmtDate(formData.signature_date)}</span>
            </p>

            <p className="flex items-center justify-end gap-2">
              <span>UDIN:</span>
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
