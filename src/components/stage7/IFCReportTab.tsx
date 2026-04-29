/**
 * IFCReportTab — Stage 7 sub-tab
 * ────────────────────────────────────────────────────────────────────────────
 * Renders the full Annexure-B (Internal Financial Controls report) under
 * Section 143(3)(i) of the Companies Act 2013.
 *
 * Visibility:
 *   The tab is shown only when `engagement.ifc_applicable === true` (governed
 *   by Stage 7 PipelineStage7Combined → CorporateStage7Tabs filter, which
 *   reads the Block C flag). When NOT applicable, the IFC tab disappears
 *   entirely; the standard Point (g) "not applicable" line is auto-emitted
 *   in the Main Auditor's Report (Stage 8 / 3CA-3CB tab) instead.
 *
 *   For safety on legacy engagements where the flag is null/undefined we
 *   still render the APPLICABLE template — auditors can edit any section
 *   freely or just toggle Block C off to hide.
 *
 * Storage:
 *   `stage7_ifc_data` (single row per engagement) with columns:
 *     - engagement_id   uuid PK
 *     - sections        jsonb  { intro, mgmt_responsibility, auditors_responsibility,
 *                                 meaning, inherent_limitations, opinion }
 *     - place           text
 *     - report_date     date
 *     - last_updated_at timestamptz
 *
 *   The component degrades gracefully if the table is missing (warn + allow
 *   read-only viewing) — see `loadData` catch block.
 *
 * Header / signature data is auto-fetched from clients / firms / users
 * (same pattern as EngagementCARO and NotesToAccounts).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  Shield, Save, Loader2, Download, FileType, RotateCcw,
} from 'lucide-react';
import { exportToPdf, exportToWord } from '@/lib/exportUtils';

interface Props {
  engagementId: string;
  engagement: any;
}

// ─── Section keys & labels (preserves canonical Annexure-B order) ──────────
const SECTIONS = [
  { key: 'intro',                    title: 'Introduction' },
  { key: 'mgmt_responsibility',      title: "Management's Responsibility for Internal Financial Controls" },
  { key: 'auditors_responsibility',  title: "Auditors' Responsibility" },
  { key: 'meaning',                  title: 'Meaning of Internal Financial Controls over Financial Reporting' },
  { key: 'inherent_limitations',     title: 'Inherent Limitations of Internal Financial Controls over Financial Reporting' },
  { key: 'opinion',                  title: 'Opinion' },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];
type SectionMap = Record<SectionKey, string>;

// ─── Default text — verbatim from the Annexure-B word file ─────────────────
// The {{COMPANY}} and {{FY_END}} tokens get replaced at render time with
// engagement.client_name and the FY-end date (31st March, YYYY).
const buildDefaults = (companyName: string, fyEnd: string): SectionMap => ({
  intro:
    `We have audited the Internal financial controls over financial reporting ` +
    `of ${companyName} ('the Company') as of ${fyEnd} in conjunction with our ` +
    `audit of the standalone financial statements of the Company for the year ` +
    `ended on that date.`,

  mgmt_responsibility:
    `The Company's management is responsible for establishing and maintaining ` +
    `internal financial controls. These responsibilities include the design, ` +
    `implementation and maintenance of adequate internal financial controls ` +
    `that were operating effectively for ensuring the orderly and efficient ` +
    `conduct of its business, including adherence to company's policies, the ` +
    `safeguarding of its assets, the prevention and detection of frauds and ` +
    `errors, the accuracy and completeness of the accounting records, and the ` +
    `timely preparation of reliable financial information, as required under ` +
    `the Companies Act, 2013.`,

  auditors_responsibility:
    `Our responsibility is to express an opinion on the Company's internal ` +
    `financial controls over financial reporting based on our audit. We ` +
    `conducted our audit in accordance with the Guidance Note on Audit of ` +
    `Internal Financial Controls Over Financial Reporting (the "Guidance Note") ` +
    `and the Standards on Auditing, issued by ICAI and deemed to be prescribed ` +
    `under section 143(10) of the Companies Act, 2013, to the extent applicable ` +
    `to an audit of internal financial controls, both applicable to an audit of ` +
    `Internal Financial Controls and, both issued by the Institute of Chartered ` +
    `Accountants of India. Those Standards and the Guidance Note require that ` +
    `we comply with ethical requirements and plan and perform the audit to obtain ` +
    `reasonable assurance about whether adequate internal financial controls over ` +
    `financial reporting was established and maintained and if such controls ` +
    `operated effectively in all material respects.\n\n` +
    `Our audit involves performing procedures to obtain audit evidence about ` +
    `the adequacy of the internal financial controls system over financial ` +
    `reporting and their operating effectiveness. Our audit of internal ` +
    `financial controls over financial reporting included obtaining an ` +
    `understanding of internal financial controls over financial reporting, ` +
    `assessing the risk that a material weakness exists, and testing and ` +
    `evaluating the design and operating effectiveness of internal control ` +
    `based on the assessed risk. The procedures selected depend on the ` +
    `auditor's judgment, including the assessment of the risks of material ` +
    `misstatement of the financial statements, whether due to fraud or error. ` +
    `We believe that the audit evidence I/we have obtained is sufficient and ` +
    `appropriate to provide a basis for our audit opinion on the Company's ` +
    `internal financial controls system over financial reporting.`,

  meaning:
    `A company's internal financial control over financial reporting is a ` +
    `process designed to provide reasonable assurance regarding the reliability ` +
    `of financial reporting and the preparation of financial statements for ` +
    `external purposes in accordance with generally accepted accounting ` +
    `principles. A company's internal financial control over financial ` +
    `reporting includes those policies and procedures that:\n\n` +
    `(1) Pertain to the maintenance of records that, in reasonable detail, ` +
    `accurately and fairly reflect the transactions and dispositions of the ` +
    `assets of the company;\n\n` +
    `(2) Provide reasonable assurance that transactions are recorded as ` +
    `necessary to permit preparation of financial statements in accordance ` +
    `with generally accepted accounting principles, and that receipts and ` +
    `expenditures of the company are being made only with authorizations of ` +
    `management and directors of the company; and\n\n` +
    `(3) Provide reasonable assurance regarding prevention or timely detection ` +
    `of unauthorized acquisition, use, or disposition of the company's assets ` +
    `that could have a material effect on the financial statements.`,

  inherent_limitations:
    `Because of the inherent limitations of internal financial controls over ` +
    `financial reporting, including the possibility of collusion or improper ` +
    `management override of controls, material misstatements due to error or ` +
    `fraud may occur and not be detected. Also, projections of any evaluation ` +
    `of the internal financial controls over financial reporting to future ` +
    `periods are subject to the risk that the internal financial control over ` +
    `financial reporting may become inadequate because of changes in conditions, ` +
    `or that the degree of compliance with the policies or procedures may ` +
    `deteriorate.`,

  opinion:
    `In our opinion, the Company has, in all material respects, an adequate ` +
    `internal financial controls system over financial reporting and such ` +
    `internal financial controls over financial reporting were operating ` +
    `effectively as at ${fyEnd}.`,
});

// FY end string → "31st March, 2026"
// Handles formats: "FY 2025-26", "2025-26", "2025-2026", "2025-26"
function fyEndDate(fy?: string | null): string {
  if (!fy) return '31st March, 20XX';
  const m = String(fy).match(/(\d{4})\s*[-–]\s*(\d{2,4})/);
  if (!m) return '31st March, 20XX';
  const end = m[2];
  const endYear = end.length === 2 ? m[1].slice(0, 2) + end : end;
  return `31st March, ${endYear}`;
}

export function IFCReportTab({ engagementId, engagement }: Props) {
  const fyEnd = fyEndDate(engagement?.financial_year);
  const companyName =
    engagement?.client_name || engagement?.clients?.name || '[Company Name]';

  const [sections, setSections] = useState<SectionMap>(() => buildDefaults(companyName, fyEnd));
  const [place, setPlace] = useState('Ahmedabad'); // firm's primary city; user-editable
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>(SECTIONS.map(s => s.key));

  // Header / signature
  const [firm, setFirm] = useState<any>(null);
  const [partner, setPartner] = useState<any>(null);

  const isApplicable = engagement?.ifc_applicable !== false; // null/undefined → render template

  // ── Load firm + partner ──
  useEffect(() => {
    if (!engagement?.firm_id) return;
    supabase
      .from('firms')
      .select('name, display_name, icai_firm_reg_no, icai_reg_no, address, state')
      .eq('id', engagement.firm_id)
      .single()
      .then(({ data }) => {
        if (data) {
          setFirm(data);
          // Default place stays as "Ahmedabad" — don't override with firm.state
        }
      });
  }, [engagement?.firm_id]);

  useEffect(() => {
    if (!engagement?.partner_id) return;
    supabase
      .from('users')
      .select('name, icai_reg_no, email')
      .eq('id', engagement.partner_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.warn('[IFCReportTab] partner fetch failed:', error.message); return; }
        if (data) setPartner(data);
      });
  }, [engagement?.partner_id]);

  // ── Load saved IFC data ──
  useEffect(() => { loadData(); }, [engagementId]);

  async function loadData() {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('stage7_ifc_data')
        .select('*')
        .eq('engagement_id', engagementId)
        .maybeSingle();
      if (error && error.code !== 'PGRST116' && error.code !== 'PGRST205') throw error;

      if (data) {
        const stored = (data.sections || {}) as Partial<SectionMap>;
        const defaults = buildDefaults(companyName, fyEnd);
        setSections({
          intro:                   stored.intro                   || defaults.intro,
          mgmt_responsibility:     stored.mgmt_responsibility     || defaults.mgmt_responsibility,
          auditors_responsibility: stored.auditors_responsibility || defaults.auditors_responsibility,
          meaning:                 stored.meaning                 || defaults.meaning,
          inherent_limitations:    stored.inherent_limitations    || defaults.inherent_limitations,
          opinion:                 stored.opinion                 || defaults.opinion,
        });
        if (data.place) setPlace(data.place);
        if (data.report_date) setReportDate(data.report_date);
      } else {
        setSections(buildDefaults(companyName, fyEnd));
      }
    } catch (err: any) {
      // Table missing or RLS — fall back to defaults so the auditor can still
      // see the template. Save will fail until the migration is run.
      console.warn('[IFCReportTab] load failed:', err?.message);
      setSections(buildDefaults(companyName, fyEnd));
    }
    setLoading(false);
  }

  async function saveAll() {
    setSaving(true);
    try {
      const payload = {
        engagement_id: engagementId,
        sections,
        place,
        report_date: reportDate,
        last_updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from('stage7_ifc_data')
        .upsert(payload, { onConflict: 'engagement_id' });
      if (error) throw error;
      toast.success('IFC report saved');
    } catch (err: any) {
      toast.error('Save failed: ' + (err?.message || 'unknown error'));
    }
    setSaving(false);
  }

  function resetSection(key: SectionKey) {
    const defaults = buildDefaults(companyName, fyEnd);
    setSections(prev => ({ ...prev, [key]: defaults[key] }));
    toast.info('Section reset to default text');
  }

  // ── Display values for header / signature ──
  const firmName = firm?.display_name || firm?.name || '[Firm Name]';
  const firmFRN = firm?.icai_firm_reg_no || firm?.icai_reg_no || '[FRN]';
  const partnerName = partner?.name || '[Partner Name]';
  const membershipNo = partner?.icai_reg_no || '[Membership No.]';
  const reportDateDisplay = reportDate
    ? new Date(reportDate).toLocaleDateString('en-IN')
    : '[Date]';

  // ── Export helpers ──
  function exportPdf() {
    const el = document.getElementById('ifc-print-area');
    if (!el) return;
    el.style.display = 'block';
    exportToPdf(el, `IFC-Report_${companyName}_${engagement?.financial_year || ''}.pdf`)
      .then(() => { el.style.display = 'none'; });
  }

  function exportWord() {
    let html =
      `<h2 style="text-align:center;">${companyName} — Annexure-B to the Auditors' Report</h2>` +
      `<p style="font-style:italic;text-align:center;margin-bottom:16px;">` +
      `Report on the Internal Financial Controls under Clause (i) of Sub-section 3 of Section 143 of the Companies Act, 2013` +
      `</p>`;
    SECTIONS.forEach((s, i) => {
      html += `<h3 style="font-size:12pt;font-weight:bold;margin-top:16px;">${i + 1}. ${s.title}</h3>`;
      html += `<p style="white-space:pre-wrap;">${(sections[s.key] || '').replace(/\n/g, '<br/>')}</p>`;
    });
    html +=
      `<br/><p>For, ${firmName}<br/>Chartered Accountants<br/>Firm Regi. No.: ${firmFRN}</p>` +
      `<p>Place: ${place || '[Place]'} &nbsp; Date: ${reportDateDisplay}</p>` +
      `<p style="margin-top:24px;">${partnerName}<br/>Partner &nbsp; Membership No.: ${membershipNo}</p>`;
    exportToWord(html, `IFC-Report_${companyName}_${engagement?.financial_year || ''}.doc`);
  }

  if (loading) {
    return <div className="py-8 text-center text-muted-foreground">Loading IFC report...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-indigo-600" />
            Internal Financial Controls — Annexure-B
          </h2>
          <p className="text-xs text-muted-foreground">
            Section 143(3)(i) of the Companies Act 2013
            {!isApplicable && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                Block C: Not Applicable (template still editable)
              </Badge>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline" size="sm" className="gap-1 text-xs"
            onClick={() => setOpenSections(SECTIONS.map(s => s.key))}
          >
            ↕ Expand All
          </Button>
          <Button
            variant="outline" size="sm" className="gap-1 text-xs"
            onClick={() => setOpenSections([])}
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
              <DropdownMenuItem onClick={exportPdf}>
                <Download className="h-4 w-4 mr-2" /> Export PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportWord}>
                <FileType className="h-4 w-4 mr-2" /> Export Word
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={saveAll} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save IFC
          </Button>
        </div>
      </div>

      {/* Header card */}
      <Card>
        <CardContent className="p-4 text-center">
          <h3 className="font-bold text-base">{companyName} — Annexure-B to the Auditors' Report</h3>
          <p className="text-xs italic text-muted-foreground mt-1">
            Report on the Internal Financial Controls under Clause (i) of
            Sub-section 3 of Section 143 of the Companies Act, 2013
          </p>
        </CardContent>
      </Card>

      {/* Six editable sections */}
      <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-2">
        {SECTIONS.map((s, idx) => (
          <AccordionItem key={s.key} value={s.key} className="border rounded-lg">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-3 w-full">
                <span className="text-sm font-mono font-bold text-primary min-w-[24px]">{idx + 1}</span>
                <span className="text-sm font-medium flex-1 text-left">{s.title}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground italic">
                  Default text loaded from Annexure-B — edit as needed.
                </p>
                <Button
                  variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                  onClick={() => resetSection(s.key)}
                >
                  <RotateCcw className="w-3 h-3" /> Reset
                </Button>
              </div>
              <Textarea
                value={sections[s.key]}
                onChange={e => setSections(prev => ({ ...prev, [s.key]: e.target.value }))}
                className="text-xs min-h-[160px] font-mono leading-relaxed"
              />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Signature block */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Signature Block</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-semibold">For, {firmName}</p>
            <p className="text-muted-foreground">Chartered Accountants</p>
            <p className="text-muted-foreground">Firm Regi. No.: {firmFRN}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Place</Label>
              <Input
                value={place} onChange={e => setPlace(e.target.value)}
                placeholder="e.g. Mumbai" className="h-8 text-xs"
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
          </div>
          <div>
            <p className="font-semibold">{partnerName}</p>
            <p className="text-muted-foreground">Partner &nbsp; Membership No.: {membershipNo}</p>
          </div>
        </CardContent>
      </Card>

      {/* Hidden print area for PDF export */}
      <div id="ifc-print-area" style={{ display: 'none', padding: '32px', fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>
        <h2 style={{ textAlign: 'center', fontSize: '14pt' }}>
          {companyName} — Annexure-B to the Auditors' Report
        </h2>
        <p style={{ fontStyle: 'italic', textAlign: 'center', marginBottom: '24px' }}>
          Report on the Internal Financial Controls under Clause (i) of
          Sub-section 3 of Section 143 of the Companies Act, 2013
        </p>
        {SECTIONS.map((s, i) => (
          <div key={s.key} style={{ marginBottom: '16px', pageBreakInside: 'avoid' }}>
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
              {i + 1}. {s.title}
            </h3>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: '10pt' }}>
              {sections[s.key]}
            </p>
          </div>
        ))}
        <div style={{ marginTop: '36px' }}>
          <p>For, {firmName}<br />Chartered Accountants<br />Firm Regi. No.: {firmFRN}</p>
          <p>Place: {place || '[Place]'} &nbsp; Date: {reportDateDisplay}</p>
          <p style={{ marginTop: '24px' }}>
            {partnerName}<br />Partner &nbsp; Membership No.: {membershipNo}
          </p>
        </div>
      </div>
    </div>
  );
}

export default IFCReportTab;
