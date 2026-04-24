/**
 * IARTab — Stage 8 Independent Auditor's Report tab (corporate engagements only).
 *
 * RESPONSIBILITY
 * Renders the full IAR body for a corporate engagement with:
 *   • Auto-linked (read-only) metadata — company name, FY, firm, partner,
 *     UDIN, sign-off date. All pulled from audit_engagements / firms / users.
 *   • Auto-generated conditional paragraphs (Opinion text, Point (d) / (g)
 *     of Other Legal & Regulatory, CARO Annexure reference) — computed
 *     on-the-fly by src/lib/auditReportGenerator.ts from the Block C
 *     applicability flags (caro/ifc/cash-flow).
 *   • Editable sections stored in the `iar_data` table:
 *     opinion_type, qualification_para, emphasis toggle+text, KAM toggle+text,
 *     branch text, going-concern toggle+text, audit-trail text, litigation rows.
 *
 * PROPS
 * Matches the EngagementCARO / EngagementNotesToAccounts / EngagementReviewSignoff
 * convention: `{ engagement, client, onUpdate }`.
 *
 * PERSISTENCE
 * One `iar_data` row per engagement (unique on engagement_id). Upsert on first
 * save; reloaded on mount. Manual "Save IAR" button is the primary commit path,
 * but individual text areas also autosave on blur when their value changed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Save, Plus, Trash2, Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  generateAuditReport,
  flagsFromEngagement,
  fyEndDate as fmtFyEnd,
} from "@/lib/auditReportGenerator";

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  engagement: any;
  client:     any;
  onUpdate:   () => void;
}

type OpinionType = "unmodified" | "qualified" | "adverse" | "disclaimer";

interface LitigationRow {
  sr:      number;
  statute: string;
  amount:  string;
  fy:      string;
  forum:   string;
}

interface IarState {
  id?:                 string;
  opinion_type:        OpinionType;
  qualification_para:  string;
  emphasis_toggle:     boolean;
  emphasis_text:       string;
  kam_toggle:          boolean;
  kam_text:            string;
  branch_text:         string;
  going_concern_std:   boolean;
  going_concern_text:  string;
  audit_trail_text:    string;
  litigation_rows:     LitigationRow[];
}

const DEFAULT_STATE: IarState = {
  opinion_type:        "unmodified",
  qualification_para:  "",
  emphasis_toggle:     false,
  emphasis_text:       "",
  kam_toggle:          false,
  kam_text:            "",
  branch_text:         "The company does not have any branch, this para is not applicable.",
  going_concern_std:   true,
  going_concern_text:  "",
  audit_trail_text:    "the Company has used accounting software for maintaining its books of account, which has a feature of recording audit trail (edit log) facility and as informed by the management the same has operated throughout the year for all relevant transactions recorded in the software.",
  litigation_rows: [
    { sr: 1, statute: "", amount: "", fy: "", forum: "" },
    { sr: 2, statute: "", amount: "", fy: "", forum: "" },
    { sr: 3, statute: "", amount: "", fy: "", forum: "" },
  ],
};

// ── Opinion badge colours ────────────────────────────────────────────────────

const OPINION_LABEL: Record<OpinionType, string> = {
  unmodified: "Unmodified Opinion",
  qualified:  "Qualified Opinion",
  adverse:    "Adverse Opinion",
  disclaimer: "Disclaimer of Opinion",
};

const OPINION_STYLE: Record<OpinionType, string> = {
  unmodified: "bg-emerald-100 text-emerald-700 border-emerald-300",
  qualified:  "bg-amber-100 text-amber-700 border-amber-300",
  adverse:    "bg-red-100 text-red-700 border-red-300",
  disclaimer: "bg-slate-200 text-slate-700 border-slate-400",
};

// ── Date formatters — no date-fns dep; match the fy_end / sign_off_date helpers ──

const DASH = "____________";

/** engagement.financial_year "2025-26" → "31st March, 2026" */
function fyEndLongSuffix(fy?: string | null): string {
  if (!fy) return "31st March, 20XX";
  const m = String(fy).match(/^(\d{4})-(\d{2})$/);
  if (!m) return "31st March, 20XX";
  return `31st March, ${parseInt(m[1]) + 1}`;
}

/** "YYYY-MM-DD" → "DD.MM.YYYY" */
function formatDateDotDmy(iso?: string | null): string {
  if (!iso) return "XX.XX.20XX";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "XX.XX.20XX";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function IARTab({ engagement, client, onUpdate }: Props) {
  const { toast } = useToast();
  const [state, setState] = useState<IarState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firm, setFirm] = useState<any>(null);
  const [partner, setPartner] = useState<any>(null);

  // ── Auto-linked metadata (read-only) ────────────────────────────────────
  const companyName = client?.name || "[Company Name]";
  const companyPan  = client?.pan || "";
  const companyCin  = client?.cin || "";
  const fyEndDate   = fmtFyEnd(engagement?.financial_year); // "March 31, 2026"
  const fyEndShort  = fyEndLongSuffix(engagement?.financial_year); // "31st March, 2026"
  const fyEndYear   = engagement?.financial_year
    ? String(parseInt(String(engagement.financial_year).split("-")[0], 10) + 1)
    : "20XX";
  const reportDate  = formatDateDotDmy(
    engagement?.sign_off_date || engagement?.signed_at,
  );
  const udinValue   = engagement?.udin && String(engagement.udin).trim()
    ? String(engagement.udin).trim()
    : DASH;

  const firmName      = firm?.display_name || firm?.name || "[Firm Name]";
  const firmRegNo     = firm?.icai_firm_reg_no || "[Reg No]";
  const firmCity      = (() => {
    const addr = firm?.address;
    if (addr && typeof addr === "object" && typeof addr.city === "string" && addr.city.trim()) return addr.city;
    if (firm?.state) return firm.state;
    return "[City]";
  })();
  const partnerName   = partner?.name || "[Partner Name]";
  const partnerMemNo  = partner?.icai_reg_no || "[Mem No]";

  // ── Auto-generated conditional fragments from Block C flags ─────────────
  const fragments = useMemo(() => {
    const flags = flagsFromEngagement(engagement);
    return generateAuditReport({
      ...flags,
      clientName:    client?.name,
      pan:           client?.pan,
      firmName:      firm?.display_name || firm?.name,
      frn:           firm?.icai_firm_reg_no,
      partnerName:   partner?.name,
      membershipNo:  partner?.icai_reg_no,
      udin:          engagement?.udin,
      place:         firmCity,
      financialYear: engagement?.financial_year,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement, client, firm, partner, firmCity]);

  // ── Load firm ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagement?.firm_id) return;
    supabase
      .from("firms")
      .select("name, display_name, icai_firm_reg_no, icai_reg_no, address, state")
      .eq("id", engagement.firm_id)
      .maybeSingle()
      .then(({ data }) => { if (data) setFirm(data); });
  }, [engagement?.firm_id]);

  // ── Load partner ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagement?.partner_id) return;
    supabase
      .from("users")
      .select("name, icai_reg_no")
      .eq("id", engagement.partner_id)
      .maybeSingle()
      .then(({ data }) => { if (data) setPartner(data); });
  }, [engagement?.partner_id]);

  // ── Load iar_data row ────────────────────────────────────────────────────
  const loadIar = useCallback(async () => {
    if (!engagement?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("iar_data" as any)
      .select("*")
      .eq("engagement_id", engagement.id)
      .maybeSingle();
    if (error && (error as any).code !== "PGRST116") {
      toast({ title: "Failed to load IAR data", description: error.message, variant: "destructive" });
    }
    if (data) {
      const row = data as any;
      setState({
        id:                 row.id,
        opinion_type:       (row.opinion_type || "unmodified") as OpinionType,
        qualification_para: row.qualification_para || "",
        emphasis_toggle:    !!row.emphasis_toggle,
        emphasis_text:      row.emphasis_text || "",
        kam_toggle:         !!row.kam_toggle,
        kam_text:           row.kam_text || "",
        branch_text:        row.branch_text || DEFAULT_STATE.branch_text,
        going_concern_std:  row.going_concern_std !== false,
        going_concern_text: row.going_concern_text || "",
        audit_trail_text:   row.audit_trail_text || DEFAULT_STATE.audit_trail_text,
        litigation_rows:    Array.isArray(row.litigation_rows) && row.litigation_rows.length > 0
          ? row.litigation_rows
          : DEFAULT_STATE.litigation_rows,
      });
    } else {
      setState(DEFAULT_STATE);
    }
    setLoading(false);
  }, [engagement?.id, toast]);

  useEffect(() => { loadIar(); }, [loadIar]);

  // ── Save (upsert on engagement_id) ───────────────────────────────────────
  const save = useCallback(async (override?: Partial<IarState>) => {
    if (!engagement?.id) return;
    setSaving(true);
    const payload = { ...state, ...(override || {}) };
    const { error } = await supabase
      .from("iar_data" as any)
      .upsert(
        {
          engagement_id:       engagement.id,
          opinion_type:        payload.opinion_type,
          qualification_para:  payload.qualification_para || null,
          emphasis_toggle:     payload.emphasis_toggle,
          emphasis_text:       payload.emphasis_text || null,
          kam_toggle:          payload.kam_toggle,
          kam_text:            payload.kam_text || null,
          branch_text:         payload.branch_text,
          going_concern_std:   payload.going_concern_std,
          going_concern_text:  payload.going_concern_text || null,
          audit_trail_text:    payload.audit_trail_text,
          litigation_rows:     payload.litigation_rows,
        },
        { onConflict: "engagement_id" },
      );
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return false;
    }
    onUpdate?.();
    return true;
  }, [engagement?.id, state, toast, onUpdate]);

  const saveWithToast = async () => {
    const ok = await save();
    if (ok) toast({ title: "IAR saved" });
  };

  // Autosave-on-blur helper for text fields. Keeps the state updated first,
  // then commits the new value to the DB without re-rendering extra times.
  const autosave = useCallback(
    (patch: Partial<IarState>) => { void save(patch); },
    [save],
  );

  // ── Litigation rows ──────────────────────────────────────────────────────
  const updateRow = (idx: number, key: keyof LitigationRow, value: string | number) => {
    setState(s => ({
      ...s,
      litigation_rows: s.litigation_rows.map((r, i) => i === idx ? { ...r, [key]: value } : r),
    }));
  };
  const addRow = () => {
    setState(s => ({
      ...s,
      litigation_rows: [
        ...s.litigation_rows,
        { sr: s.litigation_rows.length + 1, statute: "", amount: "", fy: "", forum: "" },
      ],
    }));
  };
  const deleteRow = (idx: number) => {
    setState(s => ({
      ...s,
      litigation_rows: s.litigation_rows
        .filter((_, i) => i !== idx)
        .map((r, i) => ({ ...r, sr: i + 1 })),
    }));
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading IAR…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header with Opinion badge + Save ───────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Independent Auditor's Report
            </CardTitle>
            {engagement?.financial_year && (
              <Badge variant="outline" className="text-[10px]">
                FY {engagement.financial_year}
              </Badge>
            )}
            <Badge className={cn("text-[10px] border", OPINION_STYLE[state.opinion_type])}>
              {OPINION_LABEL[state.opinion_type]}
            </Badge>
          </div>
          <Button onClick={saveWithToast} disabled={saving} size="sm" className="gap-1">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save IAR
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* ── Auto-linked info strip (read-only) ───────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs p-3 bg-muted/30 rounded-md">
            <div><div className="text-muted-foreground">Company</div><div className="font-semibold">{companyName}</div></div>
            <div><div className="text-muted-foreground">CIN</div><div className="font-mono">{companyCin || DASH}</div></div>
            <div><div className="text-muted-foreground">PAN</div><div className="font-mono">{companyPan || DASH}</div></div>
            <div><div className="text-muted-foreground">FY End</div><div className="font-semibold">{fyEndDate}</div></div>
            <div><div className="text-muted-foreground">Audit Firm</div><div className="font-semibold">{firmName}</div></div>
            <div><div className="text-muted-foreground">Firm FRN</div><div className="font-mono">{firmRegNo}</div></div>
            <div><div className="text-muted-foreground">Partner</div><div className="font-semibold">{partnerName}</div></div>
            <div><div className="text-muted-foreground">Membership No.</div><div className="font-mono">{partnerMemNo}</div></div>
          </div>

          {/* ── Opinion type selector ────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Opinion Type</Label>
              <Select
                value={state.opinion_type}
                onValueChange={(v: OpinionType) => {
                  setState(s => ({ ...s, opinion_type: v }));
                  autosave({ opinion_type: v });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unmodified">Unmodified</SelectItem>
                  <SelectItem value="qualified">Qualified</SelectItem>
                  <SelectItem value="adverse">Adverse</SelectItem>
                  <SelectItem value="disclaimer">Disclaimer of Opinion</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col justify-end text-[11px] text-muted-foreground pb-1">
              Changing opinion type auto-shows the qualification paragraph below.
              Use "Unmodified" when financial statements give a true & fair view.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 1: Report on Financial Statements — OPINION ─────────── */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">1. Report on the Audit of the Financial Statements — Opinion</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="leading-relaxed">{fragments.opinionPara}</p>
          <p className="leading-relaxed">{fragments.opinionConclusion}</p>
        </CardContent>
      </Card>

      {/* ── Section 2: Basis for Opinion (qualification) ───────────────── */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">2. Basis for Opinion</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="leading-relaxed">
            We conducted our audit in accordance with the Standards on Auditing (SAs)
            specified under section 143(10) of the Companies Act, 2013. Our responsibilities
            under those Standards are further described in the Auditor's Responsibilities
            for the Audit of the Financial Statements section of our report. We are
            independent of the Company in accordance with the Code of Ethics issued by the
            Institute of Chartered Accountants of India together with the ethical
            requirements that are relevant to our audit of the financial statements under
            the provisions of the Companies Act, 2013 and the Rules thereunder, and we have
            fulfilled our other ethical responsibilities in accordance with these
            requirements and the Code of Ethics. We believe that the audit evidence we have
            obtained is sufficient and appropriate to provide a basis for our opinion.
          </p>

          {state.opinion_type !== "unmodified" && (
            <div className="space-y-1 pt-2 border-t">
              <Label className="text-xs">
                {state.opinion_type === "qualified" ? "Basis for Qualified Opinion"
                  : state.opinion_type === "adverse" ? "Basis for Adverse Opinion"
                  : "Basis for Disclaimer of Opinion"}
              </Label>
              <Textarea
                value={state.qualification_para}
                onChange={e => setState(s => ({ ...s, qualification_para: e.target.value }))}
                onBlur={() => autosave({ qualification_para: state.qualification_para })}
                className="min-h-[100px] text-sm"
                placeholder="Describe the basis / matter giving rise to the modified opinion…"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 3: Emphasis of Matter (optional) ──────────────────── */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">3. Emphasis of Matter</CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              id="emph-toggle"
              checked={state.emphasis_toggle}
              onCheckedChange={v => {
                setState(s => ({ ...s, emphasis_toggle: v }));
                autosave({ emphasis_toggle: v });
              }}
            />
            <Label htmlFor="emph-toggle" className="text-xs">Include this section</Label>
          </div>
        </CardHeader>
        {state.emphasis_toggle && (
          <CardContent>
            <Textarea
              value={state.emphasis_text}
              onChange={e => setState(s => ({ ...s, emphasis_text: e.target.value }))}
              onBlur={() => autosave({ emphasis_text: state.emphasis_text })}
              className="min-h-[100px] text-sm"
              placeholder="We draw attention to Note X to the financial statements which describes…"
            />
          </CardContent>
        )}
      </Card>

      {/* ── Section 4: Material Uncertainty related to Going Concern ──── */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">4. Material Uncertainty Related to Going Concern</CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              id="gc-std"
              checked={state.going_concern_std}
              onCheckedChange={v => {
                setState(s => ({ ...s, going_concern_std: v }));
                autosave({ going_concern_std: v });
              }}
            />
            <Label htmlFor="gc-std" className="text-xs">
              {state.going_concern_std ? "Standard (no material uncertainty)" : "Custom"}
            </Label>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {state.going_concern_std ? (
            <p className="leading-relaxed text-muted-foreground italic">
              Not applicable — management has prepared the financial statements on a going-concern basis
              and no material uncertainty has been identified. (Section will be omitted from the final report.)
            </p>
          ) : (
            <Textarea
              value={state.going_concern_text}
              onChange={e => setState(s => ({ ...s, going_concern_text: e.target.value }))}
              onBlur={() => autosave({ going_concern_text: state.going_concern_text })}
              className="min-h-[100px] text-sm"
              placeholder={
                `We draw attention to Note X to the financial statements which indicates that the Company ` +
                `incurred a net loss of ₹… during the year ended ${fyEndShort}, and as of that date, the Company's ` +
                `current liabilities exceeded its current assets by ₹…. These events or conditions, along with other ` +
                `matters as set forth in Note X, indicate that a material uncertainty exists that may cast significant ` +
                `doubt on the Company's ability to continue as a going concern. Our opinion is not modified in respect of this matter.`
              }
            />
          )}
        </CardContent>
      </Card>

      {/* ── Section 5: Key Audit Matters (listed companies only) ──────── */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">5. Key Audit Matters</CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              id="kam-toggle"
              checked={state.kam_toggle}
              onCheckedChange={v => {
                setState(s => ({ ...s, kam_toggle: v }));
                autosave({ kam_toggle: v });
              }}
            />
            <Label htmlFor="kam-toggle" className="text-xs">Include (listed companies only)</Label>
          </div>
        </CardHeader>
        {state.kam_toggle && (
          <CardContent>
            <Textarea
              value={state.kam_text}
              onChange={e => setState(s => ({ ...s, kam_text: e.target.value }))}
              onBlur={() => autosave({ kam_text: state.kam_text })}
              className="min-h-[120px] text-sm"
              placeholder="Describe each Key Audit Matter — why it was a matter of significance and how the audit addressed it…"
            />
          </CardContent>
        )}
      </Card>

      {/* ── Section 6: Responsibilities (standard SA 700 text) ────────── */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">6. Responsibilities — Management, Board &amp; Auditor</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-semibold mb-1">Responsibilities of Management and Those Charged with Governance for the Financial Statements</p>
            <p className="leading-relaxed">
              The Company's Board of Directors is responsible for the matters stated in section 134(5)
              of the Companies Act, 2013 with respect to the preparation of these financial statements
              that give a true and fair view of the financial position, financial performance
              {flagsFromEngagement(engagement).cashFlowApplicable ? ", and cash flows" : ""} of the
              Company in accordance with the accounting principles generally accepted in India,
              including the Accounting Standards specified under section 133 of the Act. This
              responsibility also includes maintenance of adequate accounting records in accordance
              with the provisions of the Act for safeguarding of the assets of the Company and for
              preventing and detecting frauds and other irregularities; selection and application of
              appropriate accounting policies; making judgments and estimates that are reasonable
              and prudent; and design, implementation and maintenance of adequate internal financial
              controls, that were operating effectively for ensuring the accuracy and completeness
              of the accounting records, relevant to the preparation and presentation of the financial
              statements that give a true and fair view and are free from material misstatement,
              whether due to fraud or error.
            </p>
          </div>
          <div>
            <p className="font-semibold mb-1">Auditor's Responsibilities for the Audit of the Financial Statements</p>
            <p className="leading-relaxed">
              Our objectives are to obtain reasonable assurance about whether the financial statements
              as a whole are free from material misstatement, whether due to fraud or error, and to
              issue an auditor's report that includes our opinion. Reasonable assurance is a high
              level of assurance, but is not a guarantee that an audit conducted in accordance with
              SAs will always detect a material misstatement when it exists. Misstatements can arise
              from fraud or error and are considered material if, individually or in the aggregate,
              they could reasonably be expected to influence the economic decisions of users taken
              on the basis of these financial statements.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 7: Other Matters + Other Legal & Regulatory ──────── */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">7. Other Matters &amp; Report on Other Legal and Regulatory Requirements</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {/* Branch */}
          <div>
            <Label className="text-xs">Other Matter — Branch Audit</Label>
            <Textarea
              value={state.branch_text}
              onChange={e => setState(s => ({ ...s, branch_text: e.target.value }))}
              onBlur={() => autosave({ branch_text: state.branch_text })}
              className="min-h-[60px] text-sm"
            />
          </div>

          {/* CARO Annexure reference — from generator */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">CARO 2020 Reference (auto)</p>
            <p className="leading-relaxed">{fragments.caroAnnexure}</p>
          </div>

          {/* Standard Section 143(3) points (a)(b)(c) */}
          <div>
            <p className="font-semibold mb-1">Report on Other Legal and Regulatory Requirements (Sec. 143(3))</p>
            <p className="leading-relaxed">
              (a) We have sought and obtained all the information and explanations which to the best
              of our knowledge and belief were necessary for the purposes of our audit;
            </p>
            <p className="leading-relaxed">
              (b) In our opinion, proper books of account as required by law have been kept by the
              Company so far as it appears from our examination of those books;
            </p>
            <p className="leading-relaxed">
              (c) The reports on the accounts of the branch offices of the Company audited under
              section 143(8) by branch auditors have been sent to us and have been properly dealt with
              by us in preparing this report (where applicable).
            </p>
            {/* Point (d) — auto */}
            <p className="leading-relaxed">{fragments.pointD}</p>
            <p className="leading-relaxed">
              (e) In our opinion, the aforesaid financial statements comply with the Accounting
              Standards specified under Section 133 of the Act;
            </p>
            <p className="leading-relaxed">
              (f) On the basis of the written representations received from the directors as on
              {" "}{fyEndShort} taken on record by the Board of Directors, none of the directors is
              disqualified as on {fyEndShort} from being appointed as a director in terms of Section
              164(2) of the Act;
            </p>
            {/* Point (g) — auto */}
            <p className="leading-relaxed">{fragments.pointG}</p>
            <p className="leading-relaxed">
              (h) With respect to the other matters to be included in the Auditor's Report in
              accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014:
            </p>
          </div>

          {/* Audit trail — Section 143(3)(g) — Rule 11(g) */}
          <div>
            <Label className="text-xs">Audit Trail Disclosure — Section 143(3)(g) / Rule 11(g)</Label>
            <Textarea
              value={state.audit_trail_text}
              onChange={e => setState(s => ({ ...s, audit_trail_text: e.target.value }))}
              onBlur={() => autosave({ audit_trail_text: state.audit_trail_text })}
              className="min-h-[80px] text-sm"
            />
          </div>

          {/* Litigation matters */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold">Rule 11(a) — Pending Litigation Matters</Label>
              <Button size="sm" variant="outline" onClick={addRow} className="gap-1 h-7 text-xs">
                <Plus className="w-3 h-3" /> Add Row
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-xs">#</TableHead>
                  <TableHead className="text-xs">Statute / Nature of Dues</TableHead>
                  <TableHead className="text-xs text-right">Amount (₹)</TableHead>
                  <TableHead className="text-xs">FY to which it relates</TableHead>
                  <TableHead className="text-xs">Forum where pending</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.litigation_rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{r.sr}</TableCell>
                    <TableCell>
                      <Input className="h-7 text-xs" value={r.statute}
                        onChange={e => updateRow(i, "statute", e.target.value)}
                        onBlur={() => autosave({ litigation_rows: state.litigation_rows })} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-7 text-xs text-right" value={r.amount}
                        onChange={e => updateRow(i, "amount", e.target.value)}
                        onBlur={() => autosave({ litigation_rows: state.litigation_rows })} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-7 text-xs" value={r.fy}
                        onChange={e => updateRow(i, "fy", e.target.value)}
                        onBlur={() => autosave({ litigation_rows: state.litigation_rows })} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-7 text-xs" value={r.forum}
                        onChange={e => updateRow(i, "forum", e.target.value)}
                        onBlur={() => autosave({ litigation_rows: state.litigation_rows })} />
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => { deleteRow(i); autosave({}); }}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {state.litigation_rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-3">
                      No pending litigation matters — click "Add Row" to record one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Signature Block (read-only) ───────────────────────────────── */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Signature Block</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6 text-sm">
            {/* Left column */}
            <div className="space-y-2">
              <p>For, <span className="font-semibold">{firmName}</span></p>
              <p className="italic">Chartered Accountants</p>
              <p>Firm Regi.No.<span className="font-mono">{firmRegNo}</span></p>
              <div className="h-8" />
              <p className="font-semibold">{partnerName}</p>
              <p>Partner</p>
              <p>Membership No.<span className="font-mono">{partnerMemNo}</span></p>
            </div>
            {/* Right column */}
            <div className="space-y-2 text-right">
              <p>Place: <span className="font-semibold">{firmCity}</span></p>
              <p>Date: <span className="font-mono">{reportDate}</span></p>
              <div className="h-24" />
              <p>UDIN: <span className="font-mono">{udinValue}</span></p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-4 pt-3 border-t">
            Signature fields are auto-linked from Firm Settings, Engagement Setup and
            Review &amp; Sign-off. To change: UDIN &amp; Sign-off Date are set in the
            Review &amp; Sign-off tab; Firm / Partner / Place come from Firm Settings
            &amp; Engagement Setup.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default IARTab;
