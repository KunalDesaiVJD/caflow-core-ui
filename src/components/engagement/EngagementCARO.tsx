/**
 * EngagementCARO — Stage 7 CARO 2020 sub-tab
 * ────────────────────────────────────────────────────────────────────────────
 * TWO MODES, gated by `engagement.caro_applicable` (set in Stage 1 Block C):
 *
 *   1. NOT APPLICABLE  (caro_applicable === false)
 *      → Render only the standard "exempted" paragraph from the
 *        WITHOUT-CARO word file (page 3). No clauses, no editor.
 *
 *   2. APPLICABLE      (caro_applicable !== false)
 *      → Render header (company name + Annexure-A heading), 21 editable
 *        clauses with default text from the Annexure-A word file, and a
 *        signature block (firm name, FRN, partner name, membership no).
 *
 * Storage:
 *   - Clause answers persist to `audit_caro_responses` (existing table).
 *   - Each row: { engagement_id, clause_number, user_response, status,
 *                 is_applicable, ... }.
 *   - First load seeds all 21 rows from the master template / hardcoded
 *     defaults so the auditor sees a fully-drafted document immediately.
 *
 * Header / signature data:
 *   - Company name → clients.name
 *   - Firm name + FRN → firms.name + icai_firm_reg_no/icai_reg_no
 *   - Partner name + membership no → users (engagement.partner_id)
 *   - Place / Date → firm.state + today (auditor can edit before export)
 */
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CorporateSignatureBlock } from "@/components/shared/CorporateSignatureBlock";
import { useAuth } from "@/hooks/useAuth";
import { useAuditTracker } from "@/hooks/useAuditTracker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import {
  Loader2, Save, Lock, CheckCircle2, Download, FileType, Info,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportToPdf, exportToWord } from "@/lib/exportUtils";

// ─── Clause titles (short labels for the accordion header) ──────────────────
const CARO_CLAUSE_TITLES: Record<number, string> = {
  1:  "Property, Plant & Equipment / Intangibles / Immovable Property",
  2:  "Inventory & Working Capital Limits",
  3:  "Investments / Loans / Guarantees",
  4:  "Loans & Investments under Sec 185 / 186",
  5:  "Public Deposits (Sec 73–76)",
  6:  "Cost Records (Sec 148(1))",
  7:  "Statutory Dues",
  8:  "Unrecorded Income / Surrender",
  9:  "Default on Loans & Borrowings",
  10: "IPO / FPO / Preferential Allotment",
  11: "Fraud / ADT-4 / Whistle-blower",
  12: "Nidhi Company Compliance",
  13: "Related Party Transactions (Sec 177 & 188)",
  14: "Internal Audit System",
  15: "Non-cash Transactions with Directors (Sec 192)",
  16: "RBI / NBFC / Core Investment Company",
  17: "Cash Losses",
  18: "Resignation of Statutory Auditors",
  19: "Going Concern",
  20: "Corporate Social Responsibility (Sec 135)",
  21: "Consolidation Qualifications",
};

// ─── Default clause text — verbatim from the Annexure-A word file ───────────
// These are the standard "clean" responses. Auditor edits per-engagement
// where facts differ. Multi-paragraph clauses use \n\n separators.
const CARO_DEFAULT_CONTENT: Record<number, string> = {
  1: `(a) (A) The Company has maintained proper records showing full particular including, quantitative details and situation of the Property, Plant and Equipment.

(B) The company has maintained proper records of showing full particulars of intangible assets.

(b) As explained to us, the Property, Plant and Equipment were physically verified by the management during the year at reasonable interval. No material discrepancies were noticed on such verification.

(c) The title of the immovable properties is held in the name of the company.

(d) The company has not revalued its Property, Plant and Equipment (including Right of Use assets) or intangible assets or both during the year.

(e) No proceedings have been initiated or are pending against the company for holding any benami property under the Benami Transactions (Prohibition) Act, 1988 (45 of 1988) and rules made there under.`,
  2: `(a) The Inventory was physically verified by the management during the year at reasonable interval. No material discrepancies were noticed on such verification.

(b) The company has been sanctioned working capital limits in excess of five crore rupees, in aggregate, from banks or financial institutions on the basis of security of current assets and quarterly returns or statements filed by the company with such banks or financial institutions are not available for verification.`,
  3: `The company has not made Investments, provided any guarantee or security or granted any loans or advances in the nature of loans, secured or unsecured, to companies, firms, Limited liability Partnerships or any other parties. Hence, sub-paragraphs (a) to (f) of paragraph J(iii) of the Companies (Auditor's Report) Order, 2020 ('the order') are not applicable.`,
  4: `The company has not granted any loans or made any investments or provided any guarantees or securities to the parties covered under sections 185 and 186 Act. Accordingly, the provisions or paragraph 3(iv) of the order are not applicable to the company.`,
  5: `The company has neither accepted any deposits from the public nor accepted any amounts which are deemed to be deposits within the meaning of sections 73 to 76 of the Companies Act and the rules made thereunder, to the extent applicable. Therefore, the provisions of paragraph 3(v) of the order are not applicable to the Company.`,
  6: `As informed and explained to us, the maintenance of Cost records u/s. 148(1) of the Act is not applicable to the company.`,
  7: `(a) According to information and explanations given to us, the company is generally regular in depositing with Appropriate Authorities undisputed statutory dues including Income Tax, Provident fund, Employees State Insurance, VAT/Sales Tax, Excise-duty, Custom Duty, Service Tax, Goods and Services Tax and other material statutory dues applicable to it. According to the information and explanations given to us, there were no undisputed amounts payable in respect of such dues which were outstanding as on 31st March, 20XX for a period of more than six months from the date they became payable.

(b) According to the records of the company, there are no dues of Sales tax, Income tax, Custom duty, Goods & Service Tax which have not been deposited on account of any disputes except Excise duty demand.

[Sr No | Name of Statute | Amount | Financial Year | Forum]`,
  8: `The company has not surrendered or disclosed any transaction, previously unrecorded in the books of account, in the tax assessments under the Income Tax Act, 1961 as income during the year. Accordingly, the requirement to report on clause 3(vii) of the order is not applicable to the company.`,
  // Clauses 9, 10, 11 use "a) b) c)" sub-letters in the template
  // (no opening parenthesis), unlike clauses 1/2/7 which use "(a)".
  // "payment or interest" in 9(a) is a verbatim template typo.
  9: `a) In our opinion and according to the information and explanations given by the management, the Company has not defaulted in repayment of loans or other borrowings or in the payment or interest thereon to any lender.

b) The company has not been declared willful defaulter by any bank or financial institution or government or any government authority.

c) In our opinion, and according to the information and explanations given to us, the term loans have been applied for the purposes for which they were obtained.

d) On an overall examination of the financial Statements of the company, no funds raised on short-term basis have been used for long term purposes by the Company.

e) On an overall examination of the financial Statements of the company, the company has not taken any funds from any entity or person on account of or to meet the obligations of its subsidiaries, associates or joint ventures.

f) The company has not raised loans during the year on the pledge of securities held in its subsidiaries, joint ventures or associate companies.`,
  10: `a) The company has not raised any funds through IPO or FPO (including debt instruments) or has not made any preferential allotment or private placement of shares or convertible debentures and therefore the question for utilization thereof does not arise.

b) The company has not made any preferential allotment or private placement of shares / fully or partially or optionally convertible debentures during the year under audit and hence, the requirement to report on clause 3(x)(b) of the order is not applicable to the Company.`,
  11: `a) During the course of our examination of the books and records of the company, carried out in accordance with the generally accepted auditing practices in India and according to the information and explanations given to us, we have neither come across any instance of fraud on or by the company, noticed or reported during the year, nor we have been informed of such case by the management.

b) During the year, no report under sub-section (12) of section 143 of the Companies Act, 2013 has been filed by auditors in Form ADT-4 as prescribed under Rule 13 of Companies (Audit and Auditors) Rules, 2014 with the Central Government.

c) As represented to us by the management, there are no whistle blower complaints received by the Company during the year.`,
  12: `The company is not a Nidhi Company as per the provisions of the Companies Act, 2013. Therefore, the requirement to report on clause 3(xii)(a) (b) and (c) of the order is not applicable to the Company.`,
  // Template typo "examinations or the records" preserved verbatim ("or" should be "of")
  13: `According to the information and explanations given to us and based on our examinations or the records of the company, related parties transactions are in compliance with sections 177 and 188 of Companies Act, where ever applicable, the details of the same have been disclosed in the financial statements etc., as required by the applicable accounting standards;`,
  // Template typo "does not required" preserved verbatim
  14: `The company does not have an internal audit system and based on our examination, company does not required to have an internal audit system as per provisions of the Companies Act 2013. Accordingly, the reporting under Clause 3(xiv)(a) and (b) of the order is not applicable to the Company.`,
  15: `In our opinion and according to the information and explanations given to us, during the year the Company has not entered into any non-cash transactions with its directors or persons connected to its directors and hence reporting under clause 3(xv) of the order is not applicable to the Company.`,
  // Clause 16 uses "a)/b)/c)/d)" without opening paren; template (c) uses
  // lowercase "Core investment Company"; template (b) writes "financial /housing"
  // without a space after the slash.
  16: `a) The company is not required to be registered under section 45-IA of the Reserve Bank of India Act, 1934. Accordingly, the reporting under Clause 3(xvi)(a) of the order is not applicable to the Company.

b) The company has not conducted non-banking financial /housing finance activities during the year. Accordingly, the reporting under Clause 3(xvi)(b) of the order is not applicable to the company.

c) The company is not a Core investment Company (CIC) as defined in the regulations made by the Reserve Bank of India. Accordingly, the reporting under Clause 3(xvi)(c) of the order is not applicable to the Company.

d) There is no Core Investment Company as a part of the Group, hence, the requirement to report on clause 3(xvi)(d) of the order is not applicable to the company.`,
  17: `The company has not incurred cash losses in the financial year and in the immediately preceding financial year, this para is not applicable.`,
  18: `There has been no resignation of the statutory auditors during the year.`,
  // Template typo "labilities" (should be "liabilities") preserved verbatim
  19: `On the basis of the financial ratios disclosed in the financial Statements, ageing and expected dates of realization of financial assets and payment of financial labilities, other information accompanying the financial Statements, our knowledge of the Board of Directors and management plans and based on our examination of the evidence supporting the assumptions, nothing has come to our attention, which causes us to believe that any material uncertainty exists as on the date of the audit report that Company is not capable of meeting its liabilities existing at the date of balance sheet as and when they fall due within a period of one year from the balance sheet date. We, however, state that this is not an assurance as to the future viability of the company. We further state that our reporting is based on the facts up to the date of the audit report and we neither give any guarantee nor any assurance that all liabilities falling due within a period of one year from the balance sheet date, will get discharged by the Company as and when they fall due.`,
  20: `According to the information and explanations given to us, the company does not fulfil the criteria as specified under section 135(1) of the Act read with the Companies (Corporate Social Responsibility Policy) Rules, 2014 and accordingly reporting under clause 3(xx) of the order is not applicable to the company.`,
  21: `The reporting under Clause 3(xxi) of the order is not applicable in respect of audit of standalone financial statements. Accordingly, this clause is not applicable to the company.`,
};

// ─── Default intro text for CARO = Yes (verbatim from CARO word file) ────────
const CARO_INTRO_DEFAULT =
`Report on Other Legal and Regulatory Requirements

As required by the Companies (Auditor's Report) Order, 2020 ("the Order") issued by the Central Government in terms Section 143(11) of the Act, we give in the Annexure-A, a statement on the matters specified in paragraphs 3 and 4 of the Order, to the extent applicable.

As required by section 143(3) of the Act, we further report that:
(a) We have sought and obtained all the information and explanations which to the best of our knowledge and belief were necessary for the purpose of our audit;
(b) In our opinion proper books of account as required by law have been kept by the Company so far as it appears from our examination of those books;
(c) The company does not have any branch, this para is not applicable.
(d) The Balance Sheet and Statement of Profit and Loss and the Cash flow Statement dealt with by this Report are in agreement with the books of account;
(e) In our opinion, the aforesaid financial statements comply with the Accounting Standards specified under Section 133 of the Act, read with Rule 7 of the Companies (Accounts) Rules 2014.
(f) On the basis of written representations received from the directors as on March 31, 20XX, and taken on record by the Board of Directors, none of the directors is disqualified as on March 31, 20XX, from being appointed as a director in terms of Section 164(2) of the Act.
(g) With respect to the adequacy of the internal financial control over financial reporting of the Company and the operating effectiveness of such controls, refer to our separate report in Annexure-B.
(h) In our opinion and to the best of our information and according to the explanations given to us, we report with respect to other matters to be included in the Auditor's Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014 as under:
(i) The Company does not have any pending litigations which would impact on its financial position.
(ii) The Company did not have any long-term contracts including derivative contracts for which there were any material foreseeable losses.
(iii) There were no amounts which were required to be transferred to the Investor Education and Protection Fund by the Company.
(iv) Based on our examination, the Company has used accounting software for maintaining its books of account, which has a feature of recording audit trail (edit log) facility and as informed by the management the same has operated throughout the year for all relevant transactions recorded in the software.`;

// ─── Full NOT-APPLICABLE text (verbatim from WITHOUT-CARO word file) ─────────
const CARO_NOT_APPLICABLE_FULL =
`Report on Other Legal and Regulatory Requirements

The Company is a private limited and falls within exemptions specified under paragraph 2(iv) of the Companies (Auditors Report) Order, 2020. Hence matters specified in paragraph 3 and 4 of the said order issued by the Central Government of India in terms of sub-section (11) of section 143 of the Act, are not enclosed.

As required by section 143(3) of the Act, we further report that:
(a) We have sought and obtained all the information and explanations which to the best of our knowledge and belief were necessary for the purpose of our audit;
(b) In our opinion proper books of account as required by law have been kept by the Company so far as it appears from our examination of those books;
(c) The company does not have any branch, this para is not applicable.
(d) The Balance Sheet and Statement of Profit and Loss dealt with by this Report are in agreement with the books of account;
(e) In our opinion, the aforesaid financial statements comply with the Accounting Standards specified under Section 133 of the Act, read with Rule 7 of the Companies (Accounts) Rules 2014.
(f) On the basis of written representations received from the directors as on March 31, 20XX, and taken on record by the Board of Directors, none of the directors is disqualified as on March 31, 20XX, from being appointed as a director in terms of Section 164(2) of the Act.
(g) The report on adequacy of the internal financial control over financial reporting is not applicable as the company falls within the exemptions specified under sub-section 3(1) of section 143 of the Act.
(h) In our opinion and to the best of our information and according to the explanations given to us, we report with respect to other matters to be included in the Auditor's Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014 as under:
(i) The Company does not have any pending litigations which would impact on its financial position.
(ii) The Company did not have any long-term contracts including derivative contracts for which there were any material foreseeable losses.
(iii) There were no amounts which were required to be transferred to the Investor Education and Protection Fund by the Company.
(iv) Based on our examination, the Company has used accounting software for maintaining its books of account, which has a feature of recording audit trail (edit log) facility and as informed by the management the same has operated throughout the year for all relevant transactions recorded in the software.`;

// ─── Legacy single-paragraph NOT-APPLICABLE text (kept for backward-compat) ──
const CARO_NOT_APPLICABLE_TEXT =
  `The Company is a private limited and falls within exemptions specified ` +
  `under paragraph 2(iv) of the Companies (Auditors Report) Order, 2020. ` +
  `Hence matters specified in paragraph 3 and 4 of the said order issued ` +
  `by the Central Government of India in terms of sub-section (11) of ` +
  `section 143 of the Act, are not enclosed.`;

interface CaroRow {
  id?: string;
  clause_number: number;
  clause_title: string;
  auto_draft: string;
  user_response: string;
  status: string;
  is_applicable: boolean;
  inapplicability_reason: string;
  is_locked: boolean;
}

interface Props {
  engagement: any;
  client: any;
  onUpdate: () => void;
}

export function EngagementCARO({ engagement, client, onUpdate }: Props) {
  const { user } = useAuth();
  const { track } = useAuditTracker(engagement?.id);
  const [rows, setRows] = useState<CaroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoFilling, setAutoFilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openClauses, setOpenClauses] = useState<string[]>([]);

  // Header / signature data
  const [firm, setFirm] = useState<any>(null);
  const [partner, setPartner] = useState<any>(null);
  // Default place is Ahmedabad (firm's primary city); user-editable.
  const [place, setPlace] = useState<string>("Ahmedabad");
  const [reportDate, setReportDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [udin, setUdin] = useState<string>(() => {
    try { return localStorage.getItem(`caro_udin_${engagement?.id}`) || ""; } catch { return ""; }
  });
  const saveUdin = (v: string) => {
    setUdin(v);
    try { localStorage.setItem(`caro_udin_${engagement?.id}`, v); } catch { /**/ }
  };

  const isApplicable = engagement?.caro_applicable !== false; // null/undefined → applicable

  // ── Editable intro / 143(3) section ────────────────────────────────────────
  const introLsKey = `caro_intro_${engagement?.id}`;
  const [introText, setIntroText] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = localStorage.getItem(`caro_intro_${engagement?.id}`);
      return saved ?? "";
    } catch { return ""; }
  });
  const [editingIntro, setEditingIntro] = useState(false);

  // ── FY end year: "FY 2025-26" → "2026" ──────────────────────────────────
  const fyEndYear = (() => {
    const fy = engagement?.financial_year || '';
    const m = fy.match(/(\d{4})\s*[-–]\s*(\d{2,4})/);
    if (m) {
      const end = m[2];
      return end.length === 2 ? m[1].slice(0, 2) + end : end;
    }
    return '20XX';
  })();

  // Load correct default if nothing saved yet
  useEffect(() => {
    if (!engagement?.id) return;
    try {
      const saved = localStorage.getItem(introLsKey);
      if (!saved) {
        const raw = isApplicable ? CARO_INTRO_DEFAULT : CARO_NOT_APPLICABLE_FULL;
        // Replace placeholder year with actual FY end year
        const def = fyEndYear !== '20XX' ? raw.replace(/20XX/g, fyEndYear) : raw;
        setIntroText(def);
      } else {
        setIntroText(saved);
      }
    } catch { /**/ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement?.id, isApplicable, fyEndYear]);

  const saveIntro = (text: string) => {
    setIntroText(text);
    try { localStorage.setItem(introLsKey, text); } catch { /**/ }
  };

  // ── Load firm + partner for signature block ──
  // Pattern matches PipelineFinancialStatements.tsx (the canonical signature
  // block source): partner name comes from engagement.partner_name, and the
  // membership number is looked up from firms.membership_numbers JSON array.
  // Fallback to users-table partner_id lookup for legacy engagements.
  useEffect(() => {
    if (!engagement?.firm_id) return;
    supabase
      .from("firms")
      .select("name, display_name, icai_firm_reg_no, icai_reg_no, address, state, membership_numbers")
      .eq("id", engagement.firm_id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFirm(data);
          // Place defaults to "Ahmedabad". If firm has a city in address.json, prefer it.
          const addrCity = (data.address as any)?.city;
          if (addrCity && typeof addrCity === "string" && addrCity.trim()) {
            // Only override default if user hasn't typed yet
            setPlace(prev => prev === "Ahmedabad" ? addrCity : prev);
          }
        }
      });
  }, [engagement?.firm_id]);

  useEffect(() => {
    if (!engagement?.partner_id) return;
    supabase
      .from("users")
      .select("name, icai_reg_no, email")
      .eq("id", engagement.partner_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.warn('[EngagementCARO] partner fetch failed:', error.message); return; }
        if (data) setPartner(data);
      });
  }, [engagement?.partner_id]);

  // ── Load clause rows (only if applicable) ──
  useEffect(() => {
    if (isApplicable) loadRows();
    else setLoading(false);
  }, [engagement?.id, isApplicable]);

  async function loadRows() {
    setLoading(true);
    const { data: masterData } = await supabase
      .from("caro_master_templates")
      .select("clause_number, clause_title, default_content, is_applicable_default")
      .is("firm_id", null)
      .order("clause_number");

    const masterMap = new Map<number, { title: string; content: string; applicable: boolean }>();
    (masterData || []).forEach((m: any) => {
      masterMap.set(m.clause_number, {
        title: m.clause_title,
        content: m.default_content || "",
        applicable: m.is_applicable_default ?? true,
      });
    });

    const getTitle = (n: number) =>
      CARO_CLAUSE_TITLES[n] || masterMap.get(n)?.title || `Clause ${n}`;
    // Substitute "20XX" placeholders with the actual FY end year so
    // clause body text (e.g. clause 7(a) — "outstanding as on 31st
    // March, 20XX") auto-populates with the engagement's year. Mirrors
    // the same substitution we already do for the CARO intro text.
    const subYear = (s: string) =>
      fyEndYear !== "20XX" ? s.replace(/20XX/g, fyEndYear) : s;
    const getContent = (n: number) =>
      subYear(CARO_DEFAULT_CONTENT[n] || masterMap.get(n)?.content || "");
    const getApplicable = (n: number) => masterMap.get(n)?.applicable ?? true;

    const { data } = await supabase
      .from("audit_caro_responses")
      .select("*")
      .eq("engagement_id", engagement.id)
      .order("clause_number");

    if (data && data.length > 0) {
      setRows(data.map((d: any) => {
        const defaultContent = getContent(d.clause_number);
        const userResp = d.user_response || "";
        const autoLoaded = !userResp && defaultContent ? defaultContent : userResp;
        return {
          id: d.id,
          clause_number: d.clause_number,
          clause_title: getTitle(d.clause_number),
          auto_draft: d.auto_draft || defaultContent || "",
          user_response: autoLoaded,
          status: d.status || (autoLoaded ? "drafted" : "not_started"),
          is_applicable: d.is_applicable ?? true,
          inapplicability_reason: d.inapplicability_reason || "",
          is_locked: d.is_locked || false,
        };
      }));
    } else {
      const seeds = Array.from({ length: 21 }, (_, i) => i + 1).map(num => ({
        engagement_id: engagement.id,
        clause_number: num,
        clause_title: getTitle(num),
        auto_draft: getContent(num),
        user_response: getContent(num),
        status: getContent(num) ? "drafted" : "not_started",
        is_applicable: getApplicable(num),
        is_locked: false,
      }));
      await supabase.from("audit_caro_responses").insert(seeds as any);
      await loadRows();
      return;
    }
    setLoading(false);
  }

  // Expand all clauses by default once rows are loaded
  useEffect(() => {
    if (rows.length > 0 && openClauses.length === 0) {
      setOpenClauses(rows.map(r => `clause-${r.clause_number}`));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  function updateRow(idx: number, field: keyof CaroRow, value: any) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  const counts = {
    approved: rows.filter(r => r.status === "approved" || r.status === "locked").length,
    drafted:  rows.filter(r => r.status === "drafted"  || r.status === "reviewed").length,
    pending:  rows.filter(r => r.status === "not_started").length,
    na:       rows.filter(r => !r.is_applicable).length,
  };

  async function autoFillAll() {
    setAutoFilling(true);
    try {
      const [findingsRes, tdsRes] = await Promise.all([
        supabase.from("scrutiny_findings").select("*").eq("client_id", client?.id),
        supabase.from("tds_entries").select("*").eq("client_id", client?.id),
      ]);
      const findings = findingsRes.data || [];
      const tdsEntries = tdsRes.data || [];

      const clausesForAI = rows
        .filter(r => r.is_applicable && !r.is_locked && r.status !== "approved")
        .map(r => ({
          clause_number: r.clause_number,
          clause_title: r.clause_title,
          current_response: r.user_response || r.auto_draft,
        }));

      const res = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "caro_answers",
          user_message: JSON.stringify({
            partial_clauses: clausesForAI.map(c => ({
              para: `Clause ${c.clause_number}`,
              topic: c.clause_title,
              current_answer: c.current_response,
            })),
            entity_type: client?.entity_type,
            client_name: client?.name,
            financial_year: engagement.financial_year,
            findings_count: findings.length,
            tds_entries_count: tdsEntries.length,
          }),
        },
      });

      if (res.data?.reply) {
        try {
          const aiAnswers = JSON.parse(res.data.reply);
          if (Array.isArray(aiAnswers)) {
            setRows(prev => prev.map(r => {
              const match = aiAnswers.find((a: any) => {
                const num = parseInt(String(a.para || a.clause_number || "").replace(/\D/g, ""));
                return num === r.clause_number;
              });
              if (match && !r.is_locked && r.status !== "approved") {
                const aiText = match.answer || match.response || "";
                return {
                  ...r,
                  auto_draft: aiText || r.auto_draft,
                  user_response: aiText || r.user_response,
                  status: "drafted",
                };
              }
              return r;
            }));
          }
        } catch {
          toast.info("AI returned guidance. Review individual clauses.");
        }
      }
      toast.success("Auto-fill complete!");
    } catch {
      toast.error("Auto-fill failed. Fill clauses manually.");
    }
    setAutoFilling(false);
  }

  async function saveAll() {
    setSaving(true);
    try {
      for (const r of rows) {
        const payload: any = {
          clause_title: r.clause_title,
          auto_draft: r.auto_draft,
          user_response: r.user_response,
          status: r.status,
          is_applicable: r.is_applicable,
          inapplicability_reason: r.inapplicability_reason,
          is_locked: r.is_locked,
          last_updated_by: user?.id,
          last_updated_at: new Date().toISOString(),
        };
        if (r.id) {
          await supabase.from("audit_caro_responses").update(payload).eq("id", r.id);
        }
      }
      toast.success("CARO responses saved");
      onUpdate();
    } catch {
      toast.error("Save failed");
    }
    setSaving(false);
  }

  function approveClause(idx: number) {
    setRows(prev => prev.map((r, i) =>
      i === idx ? { ...r, status: "approved", is_locked: true } : r));
    track("caro_clause_approve", { clause_number: rows[idx].clause_number });
  }

  function approveAll() {
    setRows(prev => prev.map(r =>
      r.is_applicable && r.user_response.trim()
        ? { ...r, status: "approved", is_locked: true }
        : r));
    track("caro_approve_all", {});
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      not_started: "bg-muted text-muted-foreground",
      drafted: "bg-blue-500/15 text-blue-700",
      reviewed: "bg-amber-500/15 text-amber-700",
      approved: "bg-green-500/15 text-green-700",
      locked: "bg-green-500/15 text-green-700",
    };
    return <Badge className={`text-[10px] ${map[status] || ""}`}>{status.replace("_", " ")}</Badge>;
  };

  // Resolved display values
  // Partner data sources (in priority order):
  //   1. engagement.partner_name      (direct field, set in Stage 1 form)
  //   2. firm.membership_numbers      (JSON: [{partner_name, membership_no}, ...])
  //   3. users table (legacy partner_id lookup)
  const companyName = client?.name || engagement?.client_name || "[Company Name]";
  const firmName = firm?.display_name || firm?.name || "[Firm Name]";
  const firmFRN = firm?.icai_firm_reg_no || firm?.icai_reg_no || "[FRN]";
  const engPartnerName = ((engagement as any)?.partner_name || "").trim();
  const firmMnoEntry = Array.isArray((firm as any)?.membership_numbers)
    ? ((firm as any).membership_numbers as any[]).find(
        (m: any) => (m?.partner_name || "").trim() === engPartnerName
      )
    : null;
  const partnerName = engPartnerName || partner?.name || "[Partner Name]";
  const membershipNo = firmMnoEntry?.membership_no
    || partner?.icai_reg_no
    || "[Membership No.]";
  const reportDateDisplay = reportDate
    ? new Date(reportDate).toLocaleDateString("en-IN")
    : "[Date]";

  // Template uses DD.MM.YYYY with dots ("XX.XX.20XX"). Build a separate
  // display string for the Word export's signature block so the on-screen
  // preview can keep its locale format unchanged.
  const reportDateDocx = (() => {
    if (!reportDate) return "[Date]";
    const d = new Date(reportDate);
    if (Number.isNaN(d.getTime())) return reportDate;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear());
    return `${dd}.${mm}.${yy}`;
  })();

  // ════════════════════════════════════════════════════════════════════════
  // BRANCH 1: NOT APPLICABLE — full WITHOUT-CARO text, editable.
  // ════════════════════════════════════════════════════════════════════════
  if (!isApplicable) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">CARO 2020 — Not Applicable</h2>
            <p className="text-xs text-muted-foreground">
              Marked Not Applicable in Stage 1 Block C (paragraph 2(iv) exemption).
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditingIntro(v => !v)} className="gap-1 text-xs">
              {editingIntro ? "Done Editing" : "Edit Text"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-1">
                  <Download className="w-4 h-4" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => {
                  const el = document.getElementById('caro-na-print-area');
                  if (el) {
                    el.style.display = 'block';
                    exportToPdf(el, `CARO-NotApplicable_${companyName}_${engagement?.financial_year || ''}.pdf`)
                      .then(() => { el.style.display = 'none'; });
                  }
                }}>
                  <Download className="h-4 w-4 mr-2" /> Export PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  // Same serif typography, reduced margins and signature-block
                  // layout as the applicable-CARO export.
                  const SERIF = "'Times New Roman', Times, serif";
                  const TD = `style="vertical-align:top;"`;
                  const HEAD_CSS = `
                    @page Section1 { size: A4; margin: 1.2cm 1cm 1.5cm 1.5cm; mso-header-margin: 0; mso-footer-margin: 0; }
                    div.Section1 { page: Section1; }
                    @page { size: A4; margin: 1.2cm 1cm 1.5cm 1.5cm; }
                    html, body { margin: 0 !important; padding: 0 !important; }
                    body { font-family: ${SERIF}; font-size: 11pt; }
                    .caro-sig, .caro-sig tr, .caro-sig td {
                      border: none !important;
                      padding: 0 !important;
                      background: transparent !important;
                      font-family: ${SERIF} !important;
                      font-size: 11pt !important;
                    }
                    .caro-sig td.partner { padding-top: 24pt !important; }
                  `;
                  // Run the same 20XX → fyEndYear substitution at export time
                  // — older intros saved before the seed-time substitution
                  // still carry the literal placeholder.
                  const yearSub = (s: string) =>
                    fyEndYear !== "20XX" ? s.replace(/20XX/g, fyEndYear) : s;
                  const body = yearSub(introText || CARO_NOT_APPLICABLE_FULL)
                    .replace(/\n/g, '<br/>');
                  // Same Place / Date spacing + DD.MM.YYYY date format as
                  // the applicable-CARO export.
                  // Body uses LEFT alignment. Signature block uses the
                  // same single-row 2-cell layout as the applicable export
                  // so the firm/partner lines stack tightly (no Word
                  // per-row vertical spacing). All bold per template.
                  const SIGTD = `style="vertical-align:top;font-weight:bold;"`;
                  const leftCol =
                    `For, ${firmName}<br/>` +
                    `Chartered Accountants<br/>` +
                    `Firm Regi.No.${firmFRN}<br/>` +
                    `<br/><br/><br/>` +
                    `${partnerName}<br/>` +
                    `Partner<br/>` +
                    `Membership No.${membershipNo}`;
                  const rightCol =
                    `<br/><br/>` +
                    `Place :&nbsp;&nbsp;${place || '[Place]'}<br/>` +
                    `Date&nbsp;&nbsp;:&nbsp;&nbsp;${reportDateDocx}`;
                  const html =
                    `<div class="Section1">` +
                    `<p style="font-family:${SERIF};font-size:11pt;line-height:1.4;` +
                    `text-align:left;margin:0 0 12pt 0;">${body}</p>` +
                    `<table class="caro-sig" style="width:100%;margin-top:30pt;">` +
                      `<tr>` +
                        `<td ${SIGTD}>${leftCol}</td>` +
                        `<td ${SIGTD}>${rightCol}</td>` +
                      `</tr>` +
                    `</table>` +
                    `</div>`;
                  exportToWord(
                    html,
                    `CARO-NotApplicable_${companyName}_${engagement?.financial_year || ''}.doc`,
                    HEAD_CSS,
                  );
                }}>
                  <FileType className="h-4 w-4 mr-2" /> Export Word
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4">
            {editingIntro ? (
              <Textarea
                value={introText}
                onChange={e => saveIntro(e.target.value)}
                className="text-xs min-h-[400px] font-mono leading-relaxed"
              />
            ) : (
              <div className="rounded-md border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {introText || CARO_NOT_APPLICABLE_FULL}
              </div>
            )}
            <SignatureBlock
              firmName={firmName} firmFRN={firmFRN} partnerName={partnerName}
              membershipNo={membershipNo} place={place} setPlace={setPlace}
              reportDate={reportDate} setReportDate={setReportDate}
              udin={udin} setUdin={saveUdin}
            />
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                To enable the 21-clause editor, return to <strong>Stage 1 → Block C
                (Audit Applicability)</strong> and switch <em>"CARO 2020 reporting
                applicable?"</em> to <strong>Yes</strong>.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Hidden print area for PDF */}
        <div id="caro-na-print-area" style={{ display: 'none', padding: '32px', fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{introText || CARO_NOT_APPLICABLE_FULL}</p>
          <div style={{ marginTop: '36px' }}>
            <p>For, {firmName}<br />Chartered Accountants<br />Firm Regi. No.: {firmFRN}</p>
            <p>Place: {place || '[Place]'} &nbsp; Date: {reportDateDisplay}</p>
            <p style={{ marginTop: '24px' }}>{partnerName}<br />Partner &nbsp; Membership No.: {membershipNo}</p>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // BRANCH 2: APPLICABLE — header + 21 clauses + signature block.
  // ════════════════════════════════════════════════════════════════════════
  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading CARO clauses...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">CARO 2020 — 21 Clauses</h2>
          <div className="flex gap-2 mt-1 flex-wrap">
            <Badge className="bg-green-500/15 text-green-700 text-xs">{counts.approved} Approved</Badge>
            <Badge className="bg-blue-500/15 text-blue-700 text-xs">{counts.drafted} Drafted</Badge>
            <Badge variant="outline" className="text-xs">{counts.pending} Pending</Badge>
            {counts.na > 0 && <Badge variant="secondary" className="text-xs">{counts.na} N/A</Badge>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setEditingIntro(v => !v)} className="gap-1 text-xs">
            {editingIntro ? "Done Editing Intro" : "Edit Intro Text"}
          </Button>
          <Button
            variant="outline" size="sm" className="gap-1 text-xs"
            onClick={() => setOpenClauses(rows.map(r => `clause-${r.clause_number}`))}
          >
            ↕ Expand All
          </Button>
          <Button
            variant="outline" size="sm" className="gap-1 text-xs"
            onClick={() => setOpenClauses([])}
          >
            ↕ Collapse All
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-1">
                <Download className="w-4 h-4" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {
                const el = document.getElementById('caro-print-area');
                if (el) {
                  el.style.display = 'block';
                  exportToPdf(el, `CARO-2020_${companyName}_${engagement?.financial_year || ''}.pdf`)
                    .then(() => { el.style.display = 'none'; });
                }
              }}>
                <Download className="h-4 w-4 mr-2" /> Export PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                // ─── CARO Word export — matches the template Annexure-A format ───
                // - Times New Roman serif font throughout (forced via head CSS)
                // - Centered + UNDERLINED bold company-name title and subtitle
                //   (template renders both with text-decoration:underline).
                // - Each clause is one hanging-indent paragraph "N.  body".
                //   Body is LEFT-ALIGNED (not justified) — justified caused
                //   ugly stretched word spacing on short last lines.
                // - Page margins reduced via head CSS: the wrapper's default
                //   2cm body{margin} + 2cm @page{margin} pushed the title way
                //   down the page; template starts much higher.
                const SERIF = "'Times New Roman', Times, serif";

                // Head-level overrides — Word's HTML parser only reliably
                // applies CSS from <head>.
                //
                // Content-area sizing for clause 1's first line:
                //   Template fits "…full particular including, quantitative
                //   details" on line 1 — our previous output wrapped at
                //   "…particular includin" because the wrapper's
                //   `body { margin: 2cm }` rule was reducing the printable
                //   area below the template's line width.
                //   Two layers of override needed:
                //     1. body { margin: 0 !important; padding: 0 !important; }
                //        — wins against the wrapper's `margin: 2cm`.
                //     2. @page Section1 { margin: 1.2cm 0.8cm 1.5cm 0.8cm; }
                //        + div.Section1 { page: Section1; } — Microsoft
                //        Office's reliable page-setup directive. Word
                //        ignores plain @page rules sometimes; the named
                //        section is honoured.
                // Page margins: left = 1.5cm gives a clear whitespace band
                // before the clause-number column. The 3-column TABLE
                // layout (num | sl | body) doesn't rely on negative
                // text-indent, so we don't need extra margin to absorb it.
                // Right margin = 1cm. Total content area ~18.5cm, body
                // column ~440pt — wide enough for clause 1's first line
                // to wrap at "quantitative details" like the template.
                const HEAD_CSS = `
                  @page Section1 { size: A4; margin: 1.2cm 1cm 1.5cm 1.5cm; mso-header-margin: 0; mso-footer-margin: 0; }
                  div.Section1 { page: Section1; }
                  @page { size: A4; margin: 1.2cm 1cm 1.5cm 1.5cm; }
                  html, body { margin: 0 !important; padding: 0 !important; }
                  body { font-family: ${SERIF}; font-size: 11pt; }
                  /* Each clause is rendered as a 2-column borderless table:
                     col 1 = clause number, col 2 = body (with sub-letter
                     prefixed inline, separated by a small non-breaking
                     space — no big sub-letter-column gap). Sub-sub-letters
                     "(B)" get a row-level left-padding so they sit deeper. */
                  .caro-clause, .caro-clause tr, .caro-clause td {
                    border: none !important;
                    padding: 0 !important;
                    background: transparent !important;
                    font-family: ${SERIF} !important;
                    font-size: 11pt !important;
                    vertical-align: top !important;
                    line-height: 1.4 !important;
                  }
                  .caro-clause { width: 100% !important; border-collapse: collapse !important; margin: 0 0 8pt 0 !important; }
                  /* 3-column layout per template screenshot:
                     - num: clause number "1." / "2." / "3." — shrinks
                            to fit (~18pt).
                     - sl:  sub-letter "(a)" / "(b)" / "(c)" — fixed
                            36pt so all sub-letters across all clauses
                            align in a vertical column. "(a) (A)"
                            (multi) also fits within this width.
                     - sl.subsub: sub-sub-letters "(A)" / "(B)" get
                            +14pt left-padding so they sit deeper than
                            letter-level "(b)" / "(c)".
                     - bd:  body text — wraps INSIDE its own column,
                            so wrapped lines auto-align at the body
                            column edge (same column as the first body
                            line of that row). Hanging-indent feel
                            without text-indent gymnastics. */
                  .caro-clause td.num { width: 1% !important; padding-right: 2pt !important; white-space: nowrap !important; }
                  .caro-clause td.sl  { width: 36pt !important; padding-right: 4pt !important; white-space: nowrap !important; }
                  .caro-clause td.sl.subsub { padding-left: 14pt !important; }
                  .caro-clause td.bd  { padding-bottom: 6pt !important; }
                  .caro-sig, .caro-sig tr, .caro-sig td {
                    border: none !important;
                    padding: 0 !important;
                    background: transparent !important;
                    font-family: ${SERIF} !important;
                    font-size: 11pt !important;
                  }
                  .caro-sig td.partner { padding-top: 24pt !important; }
                `;

                let html =
                  // Wrap entire body in Section1 div so the named-section
                  // page setup in HEAD_CSS applies (Word's reliable way to
                  // control page margins via HTML).
                  `<div class="Section1">` +
                  // Title — bold + UNDERLINE per template (11pt)
                  `<p style="text-align:center;font-family:${SERIF};font-size:11pt;` +
                  `font-weight:bold;text-decoration:underline;margin:0 0 14pt 0;">` +
                  `${companyName}</p>` +
                  // Subtitle — also bold + UNDERLINE per template (11pt)
                  `<p style="text-align:center;font-family:${SERIF};font-size:11pt;` +
                  `font-weight:bold;text-decoration:underline;margin:0 0 18pt 0;` +
                  `padding:0 36pt;">Annexure - A referred to paragraph under the ` +
                  `heading &quot;Report on Other Legal and Regulatory&quot; of our ` +
                  `independent Auditor&#39;s Report of even date</p>`;

                // Substitute the "20XX" placeholder with the actual FY end
                // year at export time.
                const yearSub = (s: string) =>
                  fyEndYear !== "20XX" ? s.replace(/20XX/g, fyEndYear) : s;
                // Wording corrections — the old defaults (saved into
                // audit_caro_responses for engagements that were created
                // before the defaults were updated) carry several mismatches
                // vs the master CARO.doc template. Patch them at export time
                // so existing engagements pick up the correct wording without
                // having to lose the auditor's other edits. New engagements
                // get the corrected wording from the seeded defaults.
                const wordingFix = (s: string) =>
                  s
                    // Clause 1: "(a)(A)" → "(a) (A)" + singular "particular"
                    .replace(/\(a\)\(A\)/g, "(a) (A)")
                    .replace(
                      /full particulars including, quantitative details/g,
                      "full particular including, quantitative details",
                    )
                    // Clause 3: missing apostrophe + missing "('the order')"
                    .replace(
                      /Companies \(Auditors Report\) Order, 2020 are not applicable\./g,
                      "Companies (Auditor's Report) Order, 2020 ('the order') are not applicable.",
                    )
                    // Clause 4: template typo "provisions or paragraph" (not "of")
                    .replace(
                      /the provisions of paragraph 3\(iv\) of the order/g,
                      "the provisions or paragraph 3(iv) of the order",
                    )
                    // Clause 8: missing "to the company" tail
                    .replace(
                      /clause 3\(vii\) of the order is not applicable\.(?!\s+to)/g,
                      "clause 3(vii) of the order is not applicable to the company.",
                    )
                    // Clause 9 (a)-(f), 10 (a)-(b), 11 (a)-(c) — template
                    // uses "a)" "b)" "c)" without the leading parenthesis.
                    // Targeted to the specific clause-9/10/11 leading
                    // phrases to avoid mangling unrelated "(a)"/"(b)" usage.
                    .replace(
                      /\(a\) In our opinion and according to the information and explanations given by the management/g,
                      "a) In our opinion and according to the information and explanations given by the management",
                    )
                    .replace(/\(b\) The company has not been declared willful defaulter/g,
                             "b) The company has not been declared willful defaulter")
                    .replace(/\(c\) In our opinion, and according to the information and explanations given to us, the term loans/g,
                             "c) In our opinion, and according to the information and explanations given to us, the term loans")
                    .replace(/\(d\) On an overall examination of the financial Statements of the company, no funds/g,
                             "d) On an overall examination of the financial Statements of the company, no funds")
                    .replace(/\(e\) On an overall examination of the financial Statements of the company, the company has not taken/g,
                             "e) On an overall examination of the financial Statements of the company, the company has not taken")
                    .replace(/\(f\) The company has not raised loans during the year on the pledge/g,
                             "f) The company has not raised loans during the year on the pledge")
                    // Clause 9(a) template typo "payment or interest" (not "of")
                    .replace(
                      /in the payment of interest thereon to any lender/g,
                      "in the payment or interest thereon to any lender",
                    )
                    // Clause 10
                    .replace(/\(a\) The company has not raised any funds through IPO or FPO/g,
                             "a) The company has not raised any funds through IPO or FPO")
                    .replace(/\(b\) The company has not made any preferential allotment or private placement of shares/g,
                             "b) The company has not made any preferential allotment or private placement of shares")
                    // Clause 11
                    .replace(/\(a\) During the course of our examination of the books and records/g,
                             "a) During the course of our examination of the books and records")
                    .replace(/\(b\) During the year, no report under sub-section/g,
                             "b) During the year, no report under sub-section")
                    .replace(/\(c\) As represented to us by the management, there are no whistle blower/g,
                             "c) As represented to us by the management, there are no whistle blower")
                    // Clause 12
                    .replace(
                      /clause 3\(xii\)\(a\)\(b\) and \(c\) is not applicable\./g,
                      "clause 3(xii)(a) (b) and (c) of the order is not applicable to the Company.",
                    )
                    // Clause 13
                    .replace(
                      /based on our examinations of the records, related party transactions are in compliance with sections 177 and 188 of Companies Act, wherever applicable, the details of the same have been disclosed in the financial statements as required by applicable accounting standards\./g,
                      "based on our examinations or the records of the company, related parties transactions are in compliance with sections 177 and 188 of Companies Act, where ever applicable, the details of the same have been disclosed in the financial statements etc., as required by the applicable accounting standards;",
                    )
                    // Clause 14
                    .replace(
                      /company does not require to have an internal audit system as per provisions of the Companies Act 2013\. Accordingly, the reporting under Clause 3\(xiv\)\(a\) and \(b\) is not applicable\./g,
                      "company does not required to have an internal audit system as per provisions of the Companies Act 2013. Accordingly, the reporting under Clause 3(xiv)(a) and (b) of the order is not applicable to the Company.",
                    )
                    // Clause 15
                    .replace(
                      /In our opinion and according to the information given to us, during the year the Company has not entered into any non-cash transactions with its directors or persons connected to its directors and hence reporting under clause 3\(xv\) is not applicable\./g,
                      "In our opinion and according to the information and explanations given to us, during the year the Company has not entered into any non-cash transactions with its directors or persons connected to its directors and hence reporting under clause 3(xv) of the order is not applicable to the Company.",
                    )
                    // Clause 16: drop opening parens, fix wording, append "Accordingly..." sentences
                    .replace(
                      /\(a\) The company is not required to be registered under section 45-IA of the Reserve Bank of India Act, 1934\.(?!\s+Accordingly)/g,
                      "a) The company is not required to be registered under section 45-IA of the Reserve Bank of India Act, 1934. Accordingly, the reporting under Clause 3(xvi)(a) of the order is not applicable to the Company.",
                    )
                    .replace(
                      /\(b\) The company has not conducted non-banking financial \/ housing finance activities during the year\.(?!\s+Accordingly)/g,
                      "b) The company has not conducted non-banking financial /housing finance activities during the year. Accordingly, the reporting under Clause 3(xvi)(b) of the order is not applicable to the company.",
                    )
                    .replace(
                      /\(c\) The company is not a Core Investment Company \(CIC\) as defined in the regulations made by the Reserve Bank of India\.(?!\s+Accordingly)/g,
                      "c) The company is not a Core investment Company (CIC) as defined in the regulations made by the Reserve Bank of India. Accordingly, the reporting under Clause 3(xvi)(c) of the order is not applicable to the Company.",
                    )
                    .replace(
                      /\(d\) There is no Core Investment Company as part of the Group\.(?!\s+hence)/g,
                      "d) There is no Core Investment Company as a part of the Group, hence, the requirement to report on clause 3(xvi)(d) of the order is not applicable to the company.",
                    )
                    // Clause 19: insert template's longer wording + typo
                    .replace(
                      /payment of financial liabilities, and based on our examination/g,
                      "payment of financial labilities, other information accompanying the financial Statements, our knowledge of the Board of Directors and management plans and based on our examination",
                    )
                    .replace(
                      /not an assurance as to the future viability of the company\.$/g,
                      "not an assurance as to the future viability of the company. We further state that our reporting is based on the facts up to the date of the audit report and we neither give any guarantee nor any assurance that all liabilities falling due within a period of one year from the balance sheet date, will get discharged by the Company as and when they fall due.",
                    )
                    // Clause 20: insert "read with the Companies..." + "of the order...to the company"
                    .replace(
                      /the company does not fulfil the criteria as specified under section 135\(1\) of the Act and accordingly reporting under clause 3\(xx\) is not applicable\./g,
                      "the company does not fulfil the criteria as specified under section 135(1) of the Act read with the Companies (Corporate Social Responsibility Policy) Rules, 2014 and accordingly reporting under clause 3(xx) of the order is not applicable to the company.",
                    )
                    // Clause 21
                    .replace(
                      /The reporting under Clause 3\(xxi\) is not applicable in respect of audit of standalone financial statements\./g,
                      "The reporting under Clause 3(xxi) of the order is not applicable in respect of audit of standalone financial statements.",
                    );
                // Render each clause as a 3-column borderless table.
                // Each sub-letter (a), (B), (b), etc. is its own row:
                //   Col 1 (28pt): clause number — populated only on row 0,
                //                 empty on subsequent rows so the number
                //                 doesn't repeat.
                //   Col 2 (50pt): sub-letter prefix — "(a)", "(B)", "a)" etc.
                //                 Capital sub-sub-letters get the .subsub
                //                 class which adds 22pt left-padding so
                //                 they sit deeper than letter-level.
                //   Col 3 (rest): body text — wraps inside its own cell so
                //                 wrapped lines stay perfectly aligned
                //                 under the first body line.
                // First row of clause 1 has TWO sub-letters "(a) (A)" inline
                // before the body text — handled by capturing them all in
                // one match group.
                //
                // Sub-letter detection regex matches:
                //   "(a) (A) " → "(a) (A)" + body
                //   "(B) "      → "(B)"     + body  (treated as sub-sub)
                //   "(b) "      → "(b)"     + body
                //   "a) "       → "a)"      + body
                const SUBLETTER_RE = /^((?:\([a-zA-Z]\)\s*)+|[a-zA-Z]\)\s*)\s*([\s\S]*)$/;
                const splitChunk = (chunk: string): { sl: string; body: string; isSubSub: boolean } => {
                  const m = chunk.match(SUBLETTER_RE);
                  if (m) {
                    const sl = m[1].trim();
                    const body = m[2].trim();
                    // Sub-sub-letter = exactly "(X)" where X is a single uppercase letter
                    const isSubSub = /^\([A-Z]\)$/.test(sl);
                    return { sl, body, isSubSub };
                  }
                  // No sub-letter prefix — clause body is bare prose.
                  return { sl: "", body: chunk, isSubSub: false };
                };
                // Render each clause as a 3-column borderless table.
                // num | sl | body — see HEAD_CSS for column widths.
                // Sub-letter "(a)/(b)/(c)" sits in col 2 vertically
                // aligned across all rows of the clause; "(B)" gets
                // .subsub class for extra left-padding (deeper than
                // letter-level). Body wraps inside its own column.
                rows.forEach(r => {
                  const raw = r.is_applicable
                    ? wordingFix(yearSub(r.user_response || r.auto_draft || ""))
                    : `Not Applicable${r.inapplicability_reason ? ` — ${r.inapplicability_reason}` : ""}`;
                  const chunks = raw.split(/\n{2,}/);
                  let tableRows = "";
                  chunks.forEach((chunk, idx) => {
                    const { sl, body, isSubSub } = splitChunk(chunk);
                    // Empty num cells use &nbsp; so the column reserves
                    // the same width as the populated row 0 — keeps
                    // sub-letters aligned vertically across rows.
                    const numCell = idx === 0 ? `${r.clause_number}.` : "&nbsp;";
                    const bodyHtml = body.replace(/\n/g, "<br/>");
                    if (sl) {
                      const slClass = isSubSub ? "sl subsub" : "sl";
                      tableRows += `<tr>` +
                        `<td class="num">${numCell}</td>` +
                        `<td class="${slClass}">${sl}</td>` +
                        `<td class="bd">${bodyHtml}</td>` +
                      `</tr>`;
                    } else {
                      // No sub-letter (clauses 3, 4, 5, 6, 8, 12-15,
                      // 17-21) — body spans sl + bd columns so prose
                      // starts right after the clause number.
                      tableRows += `<tr>` +
                        `<td class="num">${numCell}</td>` +
                        `<td class="bd" colspan="2">${bodyHtml}</td>` +
                      `</tr>`;
                    }
                  });
                  html += `<table class="caro-clause">${tableRows}</table>`;
                });

                // Signature block — class on the partner-row TD so its
                // padding-top:24pt comes from head CSS (Word ignores the
                // second of two inline style attributes, so we can't put
                // it inline alongside vertical-align).
                const TD = `style="vertical-align:top;"`;
                // Template signature block — single ROW, 2 cells with
                // <br/> line breaks for tight stacking (the previous
                // multi-row version added Word's default row spacing
                // between every line, blowing up the block vertically).
                //
                // Left cell stacks 3 firm lines, then 3 blank lines for
                // vertical spacing, then the partner block.
                // Right cell stacks 2 blank lines (so Place aligns with
                // Firm Regi.No on row 3), then Place, then Date.
                //
                // All text bold per template.
                const SIGTD = `style="vertical-align:top;font-weight:bold;"`;
                const leftCol =
                  `For, ${firmName}<br/>` +
                  `Chartered Accountants<br/>` +
                  `Firm Regi.No.${firmFRN}<br/>` +
                  `<br/><br/><br/>` +
                  `${partnerName}<br/>` +
                  `Partner<br/>` +
                  `Membership No.${membershipNo}`;
                const rightCol =
                  `<br/><br/>` +
                  `Place :&nbsp;&nbsp;${place || "[Place]"}<br/>` +
                  `Date&nbsp;&nbsp;:&nbsp;&nbsp;${reportDateDocx}`;
                html +=
                  `<table class="caro-sig" style="width:100%;margin-top:30pt;">` +
                    `<tr>` +
                      `<td ${SIGTD}>${leftCol}</td>` +
                      `<td ${SIGTD}>${rightCol}</td>` +
                    `</tr>` +
                  `</table>` +
                  // Close the Section1 div opened at the top
                  `</div>`;
                exportToWord(
                  html,
                  `CARO-2020_${companyName}_${engagement?.financial_year || ''}.doc`,
                  HEAD_CSS,
                );
              }}>
                <FileType className="h-4 w-4 mr-2" /> Export Word
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={saveAll} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save CARO
          </Button>
        </div>
      </div>

      {/* Editable intro — "Report on Other Legal and Regulatory Requirements" */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Report on Other Legal and Regulatory Requirements
            </p>
          </div>
          {editingIntro ? (
            <Textarea
              value={introText}
              onChange={e => saveIntro(e.target.value)}
              className="text-xs min-h-[320px] font-mono leading-relaxed"
            />
          ) : (
            <div className="rounded-md border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
              {introText || CARO_INTRO_DEFAULT}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Signature block — appears after main report intro, before Annexure-A */}
      <Card>
        <CardContent className="p-4">
          <SignatureBlock
            firmName={firmName} firmFRN={firmFRN} partnerName={partnerName}
            membershipNo={membershipNo} place={place} setPlace={setPlace}
            reportDate={reportDate} setReportDate={setReportDate}
            udin={udin} setUdin={saveUdin}
          />
        </CardContent>
      </Card>

      {/* Annexure-A header */}
      <Card>
        <CardContent className="p-4 text-center">
          <h3 className="font-bold text-base">{companyName}</h3>
          <p className="text-xs italic text-muted-foreground mt-1">
            Annexure-A referred to paragraph under the heading "Report on Other
            Legal and Regulatory" of our independent Auditor's Report of even date
          </p>
        </CardContent>
      </Card>

      <Accordion type="multiple" value={openClauses} onValueChange={setOpenClauses} className="space-y-2">
        {rows.map((row, idx) => (
          <AccordionItem key={row.clause_number} value={`clause-${row.clause_number}`} className="border rounded-lg">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-3 w-full">
                <span className="text-sm font-mono font-bold text-primary min-w-[30px]">{row.clause_number}</span>
                <span className="text-sm font-medium flex-1 text-left">{row.clause_title}</span>
                {!row.is_applicable && <Badge variant="secondary" className="text-[10px]">N/A</Badge>}
                {statusBadge(row.status)}
                {row.is_locked && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={row.is_applicable}
                  onCheckedChange={v => updateRow(idx, "is_applicable", v)}
                  disabled={row.is_locked}
                />
                <Label className="text-xs">Applicable</Label>
              </div>

              {!row.is_applicable && (
                <Textarea
                  value={row.inapplicability_reason}
                  onChange={e => updateRow(idx, "inapplicability_reason", e.target.value)}
                  placeholder="Reason for inapplicability..."
                  className="text-xs h-16"
                  disabled={row.is_locked}
                />
              )}

              {row.is_applicable && (
                <>
                  {row.user_response && (
                    <p className="text-[10px] text-muted-foreground italic">
                      Default text loaded from Annexure-A — edit below as needed.
                    </p>
                  )}
                  <Textarea
                    value={row.user_response}
                    onChange={e => updateRow(idx, "user_response", e.target.value)}
                    placeholder="Enter your CARO response..."
                    className="text-xs min-h-[140px] font-mono leading-relaxed"
                    disabled={row.is_locked}
                  />
                  {!row.is_locked && (
                    <Button
                      variant="outline" size="sm" className="gap-1 text-xs"
                      onClick={() => approveClause(idx)}
                      disabled={!row.user_response.trim()}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve & Lock
                    </Button>
                  )}
                </>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Signature block — auditor + Board of Directors (shared component) */}
      {engagement?.id && (
        <CorporateSignatureBlock
          engagementId={engagement.id}
          companyName={companyName}
        />
      )}

      {/* Hidden print area for PDF export */}
      <div id="caro-print-area" style={{ display: 'none', padding: '32px', fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>
        <h2 style={{ textAlign: 'center', fontSize: '14pt' }}>{companyName}</h2>
        <p style={{ fontStyle: 'italic', textAlign: 'center', marginBottom: '24px' }}>
          Annexure-A referred to paragraph under the heading "Report on Other Legal and Regulatory" of our independent Auditor's Report of even date
        </p>
        {rows.map(r => (
          <div key={r.clause_number} style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #ddd', pageBreakInside: 'avoid' }}>
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
              {r.clause_number}. {r.clause_title}
            </h3>
            {!r.is_applicable ? (
              <p style={{ color: '#888', fontStyle: 'italic' }}>
                Not Applicable{r.inapplicability_reason ? ` — ${r.inapplicability_reason}` : ''}
              </p>
            ) : (
              <p style={{ whiteSpace: 'pre-wrap', fontSize: '10pt' }}>
                {r.user_response || r.auto_draft || 'No response'}
              </p>
            )}
          </div>
        ))}
        <div style={{ marginTop: '36px' }}>
          <p>For, {firmName}<br />Chartered Accountants<br />Firm Regi. No.: {firmFRN}</p>
          <p>Place: {place || '[Place]'} &nbsp; Date: {reportDateDisplay}</p>
          <p style={{ marginTop: '24px' }}>{partnerName}<br />Partner &nbsp; Membership No.: {membershipNo}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Signature block (shared between Applicable / Not-Applicable branches) ──
interface SigProps {
  firmName: string;
  firmFRN: string;
  partnerName: string;
  membershipNo: string;
  place: string;
  setPlace: (v: string) => void;
  reportDate: string;
  setReportDate: (v: string) => void;
  udin: string;
  setUdin: (v: string) => void;
}
function SignatureBlock({
  firmName, firmFRN, partnerName, membershipNo,
  place, setPlace, reportDate, setReportDate,
  udin, setUdin,
}: SigProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
      {/* Left column */}
      <div className="space-y-1">
        <p className="font-semibold">For, {firmName}</p>
        <p className="text-muted-foreground">Chartered Accountants</p>
        <p className="text-muted-foreground">Firm Regi. No.: {firmFRN}</p>
        <div className="pt-4 space-y-1">
          <p className="font-semibold">{partnerName}</p>
          <p className="text-muted-foreground">Partner</p>
          <p className="text-muted-foreground">Membership No.: {membershipNo}</p>
        </div>
      </div>
      {/* Right column */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Place</Label>
          <Input
            value={place} onChange={e => setPlace(e.target.value)}
            placeholder="e.g. Ahmedabad" className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">Date</Label>
          <Input
            type="date" value={reportDate}
            onChange={e => setReportDate(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">UDIN</Label>
          <Input
            value={udin} onChange={e => setUdin(e.target.value)}
            placeholder="e.g. 24047146AAAAAA0000" className="h-8 text-xs"
          />
        </div>
      </div>
    </div>
  );
}
