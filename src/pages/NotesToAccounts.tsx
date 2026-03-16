import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Save, Printer, FileText, CheckCircle2, Circle } from "lucide-react";

/* ───────────── constants ───────────── */
const NOTE_LIST: { key: string; num: number | string; title: string }[] = [
  { key: "note_1", num: 1, title: "Background" },
  { key: "note_2", num: 2, title: "Significant Accounting Policies" },
  { key: "note_29", num: 29, title: "Construction Contracts" },
  { key: "note_30", num: 30, title: "Revenue Recognition" },
  { key: "note_31", num: 31, title: "Foreign Currency" },
  { key: "note_32", num: 32, title: "Government Grants" },
  { key: "note_33", num: 33, title: "Accounting for Investments" },
  { key: "note_34", num: 34, title: "Employee Benefits" },
  { key: "note_35", num: 35, title: "Borrowing Costs" },
];

/* ───────── Policy texts for Note 2 ───────── */
const POLICY_TEXTS: Record<string, { title: string; text: string }> = {
  a: {
    title: "a. Property Plant and Equipment",
    text: "The fixed Assets are recorded at the cost of acquisition or construction less accumulated depreciation which includes interest on borrowings and other incidental expenses incurred up to the date of its put to use. Property, plant and equipment which are completed and put to use was transferred to appropriate category of assets from WIP during the year.",
  },
  b: {
    title: "b. Depreciation",
    text: "In respect of depreciation/amortization on fixed assets, the rate of depreciation adopted on a straight line basis as prescribed in Schedule-II of Companies Act, 2013 so as to write off the cost of the assets over the remaining useful life of the respective asset.",
  },
  c: {
    title: "c. Capital Work in Progress",
    text: "Properties under construction are stated at cost less accumulated impairment losses if any, until construction or development is completed, at which time they are reclassified to be accounted for as an item of Property Plant and Equipment. Cost capitalised include cost of land and other directly related development expenditure, including borrowing costs incurred in developing the asset. Cost of assets under development and not ready for intended use, as on the reporting date, is shown as capital work in progress.",
  },
  d: {
    title: "d. Research and Development Cost",
    text: "Research costs incurred in developing Intangible Assets such as computer software are recognised as expense when incurred. The development costs are capitalised as development work in progress only when (a) the technical feasibility is established, (b) the entity intends to complete and use or sell it, and (c) the entity's ability to use or sell is established.",
  },
  e: {
    title: "e. Intangible Assets",
    text: "Intangible assets purchased by the entity, and that have finite useful lives, are measured at cost, less accumulated amortization and accumulated impairment losses. Cost includes expenditure that is directly attributable to the acquisition of the intangible asset. Subsequent expenditure on intangible assets is capitalised only when it increases the future economic benefits.",
  },
  f: {
    title: "f. Leases",
    text: "At the inception of a lease, the lease arrangement is classified as either a finance or operating lease, based on the substance of the lease arrangement. Whenever the terms of the lease transfer substantially all the risks and rewards of ownership to the lessee, the contract is classified as a finance lease. All other leases are classified as operating leases.",
  },
  g: {
    title: "g. Investments",
    text: "Investments, if any are classified into current and long-term investment. Current investments are stated at lower of cost and fair value. There are no long term investments and hence no further disclosure of accounting policies for valuation of investments is required.",
  },
  h: {
    title: "h. Inventories",
    text: "Stock of inventories, if any are valued at the cost or net realizable value whichever is lower after providing for obsolescence and other losses, wherever considered necessary. Cost includes conversion cost and other overheads incurred in proportion to bringing the goods to its present condition and location.",
  },
  i: {
    title: "i. Trade and Other Receivables",
    text: "Trade and other receivables are generally measured at invoice value. An allowance for any shortfall in recovery is established if the collection of a receivable becomes doubtful. Bad debts are written off when identified. Aggregate amount of Trade Receivables aging analysis report as required by the Revised Schedule III are separately disclosed.",
  },
  j: {
    title: "j. Cash and Cash Equivalents",
    text: "Cash and cash equivalents include all cash balances and short-term highly liquid investments that are readily convertible into known amounts of cash and which are subject to an insignificant risk of changes in value.",
  },
  k: {
    title: "k. Cash Flow Statements",
    text: "The entity prepares and presents Cash Flow from Operating Activities by adopting indirect method.",
  },
  l: {
    title: "l. Revenues and Other Income",
    text: "Revenue is recognized to the extent that is probable that the economic benefits will flow to the company and the revenue can be reliably measured. Sales or services excluding tax are recognized (net off returns, rate difference, trade discount etc.) on transfer of significant risk and rewards of ownership to the buyer.",
  },
  m: {
    title: "m. Borrowing Costs",
    text: "Borrowing costs are interest and other costs incurred by an enterprise in connection with the borrowing of funds. A qualifying asset is an asset that necessarily takes a substantial period of time to get ready for its intended use or sale. Borrowing costs are capitalised as part of the cost of a qualifying asset when it is probable that they will result in future economic benefits.",
  },
  n: {
    title: "n. Impairment of Assets",
    text: "At the end of each reporting period, the carrying amounts of Property, Plant & Equipment, and other intangible assets are tested for impairment. The recoverable amount is the higher of an asset's fair value less costs of disposal and value in use. An impairment loss is recognized for the amount by which the asset's carrying amount exceeds its recoverable amount.",
  },
  o: {
    title: "o. Foreign Currency Transactions",
    text: "Foreign currency transactions, if any, are recorded at the rates of exchange prevailing on the date of transaction. Exchange difference arising on the settlement of monetary items at rates different from those at which they were initially recorded are recognised as income or expense in the year in which they arise.",
  },
  p: {
    title: "p. Employee Benefits",
    text: "Employee benefits as wages, salaries, paid leave and bonus are accrued in the year in which the services are rendered by the employees considering twelve months of rendering services classified as short-term employee benefits and is recognized in the year in which the employee rendered the related services.",
  },
  q: {
    title: "q. Provisions and Contingencies",
    text: "Provisions involving substantial degree of estimate in measurement are recognized when there is present obligation as a result of past events, and it is probable that there will be an outflow of resources. Contingent liabilities are not recognized by the management and accordingly not provided by the company.",
  },
  r: {
    title: "r. Taxes on Income",
    text: "Tax expense comprises current and deferred tax, and this is recognized in profit and loss. Current tax is the estimated amount of tax payable on the taxable income for the year. Deferred tax is recognized by providing for differences between the carrying amount of assets liabilities for financial reporting purposes and the amounts used for taxation purposes.",
  },
  s: {
    title: "s. Government Grants",
    text: "Grants from the government are recognised when there is reasonable assurance that the Company will comply with the conditions attached to them; and the grant will be received. Government grants related to revenue are recognised on a systematic basis in the statement of profit and loss.",
  },
  t: {
    title: "t. Earnings per Share",
    text: "Basic earnings per equity share is computed by dividing the net profit attributable to the equity holders of the company by weighted average number of equity shares outstanding during the period.",
  },
  u: {
    title: "u. Segment Reporting",
    text: "By applying the definitions of business segment and geographical segment in the relevant Accounting Standard, the management has concluded that there is neither more than one business segment nor more than one geographical segment. Accordingly, no separate disclosure is made as to segment information.",
  },
};

const STANDARD_TEXTS = {
  basis_of_preparation:
    "The financial statements of the Company have been prepared in accordance with the Generally Accepted Accounting Principles in India (Indian GAAP) to comply with the Accounting Standards notified under the relevant provisions of the Companies Act, 2013. The financial statements have been prepared on accrual basis under the historical cost convention. The accounting policies adopted in the preparation of the financial statements are consistent with those followed in the previous year.",
  basis_of_measurement:
    "The Financial Statements have been prepared on historical cost convention, on accrual basis of accounting, except for Cash Flow Statement and certain Assets or Liabilities that have been measured either on fair value, or on net realisable value or on recoverable amount basis.",
  use_of_estimates:
    "The preparation of financial statements in accordance with the generally accepted accounting principles requires the management to make estimates and assumptions that affect the reported amounts of assets and liabilities as at the Balance sheet date and the results of operations during the reporting period. The actual results could differ from these estimates. Any revision to such accounting estimates is recognized in the accounting period in which such revision takes place.",
};

/* ───────── Helpers ───────── */
const n = (v: any) => parseFloat(v) || 0;
const fmt = (v: number) => (v === 0 ? "" : v.toFixed(2));

function NoteInput({ value, onChange, placeholder = "—", className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`h-8 text-right text-sm ${className}`} />;
}

function TwoColRow({ label, prefix, cy, py, onChange }: { label: string; prefix: string; cy: string; py: string; onChange: (key: string, val: string) => void }) {
  return (
    <tr className="border-b border-border">
      <td className="py-2 px-3 text-sm">{label}</td>
      <td className="py-1 px-2"><NoteInput value={cy} onChange={(v) => onChange(`${prefix}_cy`, v)} /></td>
      <td className="py-1 px-2"><NoteInput value={py} onChange={(v) => onChange(`${prefix}_py`, v)} /></td>
    </tr>
  );
}

function NoteTableHeader() {
  return (
    <thead>
      <tr className="bg-muted/50">
        <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Particulars</th>
        <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">Current Year (₹)</th>
        <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">Previous Year (₹)</th>
      </tr>
    </thead>
  );
}

function SNoTableHeader({ col1 = "S No." }: { col1?: string }) {
  return (
    <thead>
      <tr className="bg-muted/50">
        <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground w-16">{col1}</th>
        <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Particulars</th>
        <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">Current Year (₹)</th>
        <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">Previous Year (₹)</th>
      </tr>
    </thead>
  );
}

function SNoRow({ sno, label, prefix, data, onChange, indent = false }: { sno: string; label: string; prefix: string; data: any; onChange: (key: string, val: string) => void; indent?: boolean }) {
  return (
    <tr className="border-b border-border">
      <td className="py-2 px-3 text-sm text-muted-foreground">{sno}</td>
      <td className={`py-2 px-3 text-sm ${indent ? "pl-8" : ""}`}>{label}</td>
      <td className="py-1 px-2"><NoteInput value={data[`${prefix}_cy`] || ""} onChange={(v) => onChange(`${prefix}_cy`, v)} /></td>
      <td className="py-1 px-2"><NoteInput value={data[`${prefix}_py`] || ""} onChange={(v) => onChange(`${prefix}_py`, v)} /></td>
    </tr>
  );
}

function AutoSumRow({ label, fields, data }: { label: string; fields: string[]; data: any }) {
  const sumCy = fields.reduce((a, f) => a + n(data[`${f}_cy`]), 0);
  const sumPy = fields.reduce((a, f) => a + n(data[`${f}_py`]), 0);
  return (
    <tr className="border-b border-border bg-muted/30 font-semibold">
      <td className="py-2 px-3 text-sm" colSpan={2}>{label}</td>
      <td className="py-2 px-2 text-right text-sm">{fmt(sumCy) || "—"}</td>
      <td className="py-2 px-2 text-right text-sm">{fmt(sumPy) || "—"}</td>
    </tr>
  );
}

/* ───────── MAIN COMPONENT ───────── */
export default function NotesToAccounts() {
  const [sp] = useSearchParams();
  const engagementId = sp.get("engagementId") || "";
  const { user } = useAuth();
  const [recordId, setRecordId] = useState("");
  const [activeNote, setActiveNote] = useState("note_1");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Data state per note
  const [note1, setNote1] = useState<any>({});
  const [note2, setNote2] = useState<any>({});
  const [note29, setNote29] = useState<any>({});
  const [note30, setNote30] = useState<any>({});
  const [note31, setNote31] = useState<any>({});
  const [note32, setNote32] = useState<any>({});
  const [note33, setNote33] = useState<any>({});
  const [note34, setNote34] = useState<any>({});
  const [note35, setNote35] = useState<any>({});

  const stateMap: Record<string, [any, (v: any) => void]> = {
    note_1: [note1, setNote1],
    note_2: [note2, setNote2],
    note_29: [note29, setNote29],
    note_30: [note30, setNote30],
    note_31: [note31, setNote31],
    note_32: [note32, setNote32],
    note_33: [note33, setNote33],
    note_34: [note34, setNote34],
    note_35: [note35, setNote35],
  };

  /* ── Load ── */
  useEffect(() => {
    if (!engagementId) return;
    (async () => {
      const { data } = await supabase.from("notes_to_accounts" as any).select("*").eq("engagement_id", engagementId).maybeSingle();
      if (data) {
        setRecordId((data as any).id);
        NOTE_LIST.forEach((nl) => {
          const val = (data as any)[nl.key];
          if (val && typeof val === "object") stateMap[nl.key][1](val);
        });
      } else {
        // Create blank record
        const { data: eng } = await supabase.from("audit_engagements").select("firm_id, client_id, financial_year").eq("id", engagementId).single();
        const { data: newRec } = await supabase.from("notes_to_accounts" as any).insert({
          engagement_id: engagementId,
          firm_id: eng?.firm_id || user?.firm_id,
          client_id: eng?.client_id,
          financial_year: eng?.financial_year,
        } as any).select().single();
        if (newRec) setRecordId((newRec as any).id);
      }
    })();
  }, [engagementId]);

  /* ── Save ── */
  const saveAll = useCallback(async () => {
    if (!recordId) return;
    setSaving(true);
    const payload: any = { last_saved_at: new Date().toISOString() };
    NOTE_LIST.forEach((nl) => {
      payload[nl.key] = stateMap[nl.key][0];
    });
    const { error } = await supabase.from("notes_to_accounts" as any).update(payload).eq("id", recordId);
    setSaving(false);
    if (error) toast.error("Save failed: " + error.message);
    else toast.success("Saved");
  }, [recordId, note1, note2, note29, note30, note31, note32, note33, note34, note35]);

  /* ── Auto-save debounce ── */
  const triggerAutoSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveAll(), 3000);
  }, [saveAll]);

  const updateField = (noteKey: string, field: string, value: string) => {
    const [state, setState] = stateMap[noteKey];
    setState({ ...state, [field]: value });
    triggerAutoSave();
  };

  const isFilled = (noteKey: string) => {
    const d = stateMap[noteKey]?.[0] || {};
    return Object.values(d).some((v) => v !== "" && v !== undefined && v !== null);
  };

  if (!engagementId) {
    return <div className="p-8 text-center text-muted-foreground">No engagement selected. Open from Audit Pipeline → Stage 7.</div>;
  }

  /* ───────── Render each note ───────── */
  const renderNote = () => {
    switch (activeNote) {
      case "note_1": return <Note1 data={note1} onChange={(f: string, v: string) => updateField("note_1", f, v)} />;
      case "note_2": return <Note2 data={note2} onChange={(f: string, v: string) => updateField("note_2", f, v)} />;
      case "note_29": return <Note29 data={note29} onChange={(f: string, v: string) => updateField("note_29", f, v)} />;
      case "note_30": return <Note30 data={note30} onChange={(f: string, v: string) => updateField("note_30", f, v)} />;
      case "note_31": return <Note31 data={note31} onChange={(f: string, v: string) => updateField("note_31", f, v)} />;
      case "note_32": return <Note32 data={note32} onChange={(f: string, v: string) => updateField("note_32", f, v)} />;
      case "note_33": return <Note33 data={note33} onChange={(f: string, v: string) => updateField("note_33", f, v)} />;
      case "note_34": return <Note34 data={note34} onChange={(f: string, v: string) => updateField("note_34", f, v)} />;
      case "note_35": return <Note35 data={note35} onChange={(f: string, v: string) => updateField("note_35", f, v)} />;
      default: return null;
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* ── Sidebar ── */}
      <div className="w-64 border-r border-border bg-card flex-shrink-0">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Notes to Accounts</h2>
        </div>
        <ScrollArea className="h-[calc(100%-3.5rem)]">
          <div className="p-2 space-y-0.5">
            {NOTE_LIST.map((nl) => (
              <button
                key={nl.key}
                onClick={() => setActiveNote(nl.key)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                  activeNote === nl.key ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50 text-foreground"
                }`}
              >
                {isFilled(nl.key) ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                <span className="truncate">Note {nl.num} — {nl.title}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
          <h1 className="text-lg font-semibold">
            Note {NOTE_LIST.find((n) => n.key === activeNote)?.num} — {NOTE_LIST.find((n) => n.key === activeNote)?.title}
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={saveAll} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save All"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 p-6">
          {renderNote()}
        </ScrollArea>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE 1 — BACKGROUND
   ══════════════════════════════════════════════ */
function Note1({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader><CardTitle className="text-base">a. Overview of the Reporting Entity</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground">Company Name</label>
            <Input value={data.company_name || ""} onChange={(e) => onChange("company_name", e.target.value)} placeholder="Enter company name" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Registered Office Address</label>
            <Textarea value={data.address || ""} onChange={(e) => onChange("address", e.target.value)} placeholder="Enter registered office address" className="mt-1" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">Registration Number</label>
              <Input value={data.reg_number || ""} onChange={(e) => onChange("reg_number", e.target.value)} placeholder="CIN / Registration No." className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Date of Incorporation</label>
              <Input type="date" value={data.incorporation_date || ""} onChange={(e) => onChange("incorporation_date", e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Principal Activity</label>
            <Textarea value={data.principal_activity || ""} onChange={(e) => onChange("principal_activity", e.target.value)} placeholder="Describe principal activities" className="mt-1" rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">b. Basis of Preparation</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">{STANDARD_TEXTS.basis_of_preparation}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">c. Basis of Measurement</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">{STANDARD_TEXTS.basis_of_measurement}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">d. Use of Estimates</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">{STANDARD_TEXTS.use_of_estimates}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE 2 — SIGNIFICANT ACCOUNTING POLICIES
   ══════════════════════════════════════════════ */
function Note2({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (
    <div className="space-y-4 max-w-3xl">
      {Object.entries(POLICY_TEXTS).map(([key, pol]) => (
        <Card key={key}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{pol.title}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">{pol.text}</p>
            <div>
              <label className="text-xs font-medium text-foreground">Additional Notes (optional)</label>
              <Textarea
                value={data[`${key}_additional`] || ""}
                onChange={(e) => onChange(`${key}_additional`, e.target.value)}
                placeholder="Add firm-specific customisation..."
                className="mt-1"
                rows={2}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE 29 — CONSTRUCTION CONTRACTS
   ══════════════════════════════════════════════ */
function Note29({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader><CardTitle className="text-base">a) Disclosures pursuant to Para 39(a) — Rs/rounded off</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <SNoTableHeader />
            <tbody>
              <SNoRow sno="(i)" label="Contract Revenue recognised during the period" prefix="a_revenue" data={data} onChange={onChange} />
              <SNoRow sno="(ii)" label="Contract expenses recognised during the period" prefix="a_expenses" data={data} onChange={onChange} />
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">b) Disclosures pursuant to Para 40 and 42 of AS, and Guidance Note — Rs/rounded off</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <SNoTableHeader col1="S No." />
            <tbody>
              <SNoRow sno="(i)" label="Total costs incurred" prefix="b_costs" data={data} onChange={onChange} />
              <SNoRow sno="(ii)" label="Total profits recognised (progressive to date)" prefix="b_profits" data={data} onChange={onChange} />
              <SNoRow sno="(iii)" label="Advances received" prefix="b_advances" data={data} onChange={onChange} />
              <SNoRow sno="(iv)" label="Amount of retentions (held back by contractees)" prefix="b_retentions" data={data} onChange={onChange} />
              <SNoRow sno="(v)" label="Gross amount due from customers (asset), or" prefix="b_due_from" data={data} onChange={onChange} />
              <SNoRow sno="(vi)" label="Gross amount due to customers (liability)" prefix="b_due_to" data={data} onChange={onChange} />
              <SNoRow sno="(vi)" label="Amount of Contracts progress" prefix="b_progress" data={data} onChange={onChange} />
              <SNoRow sno="(vii)" label="Unbilled revenue in respect of Contracts in progress" prefix="b_unbilled" data={data} onChange={onChange} />
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground mt-3 italic">Note: The above disclosure is applicable only for Contracts in Progress at the closing dates and does not include completed contracts and hence the figure will not match with the amounts in the financial statements.</p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE 30 — REVENUE RECOGNITION
   ══════════════════════════════════════════════ */
function Note30({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader><CardTitle className="text-base">Disclosure Pursuant to Para 14 of AS 9</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <table className="w-full border border-border rounded-md overflow-hidden">
            <SNoTableHeader />
            <tbody>
              <SNoRow sno="1" label="Revenue recognition postponed due to uncertainties" prefix="rev_postponed" data={data} onChange={onChange} />
            </tbody>
          </table>
          <div>
            <label className="text-sm font-medium text-foreground">Uncertainty Details</label>
            <Textarea
              value={data.uncertainty_text || ""}
              onChange={(e) => onChange("uncertainty_text", e.target.value)}
              placeholder="Revenue to the extent of amounts mentioned above is postponed due to the fact that significant uncertainty exist on account of..."
              className="mt-1"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE 31 — FOREIGN CURRENCY
   ══════════════════════════════════════════════ */
function Note31({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader><CardTitle className="text-base">a) Disclosures pursuant to Paragraph 42</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">The entity does not carry any long-term monetary items, exchange fluctuations in which are to be held in a separate account. The entity does not have any foreign operation or foreign branches, and the question of classification or change in the classification does not arise. The entity reports its transactions in Indian Rupees, which is also the currency of the country in which the entity is domiciled.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">b) Disclosures pursuant to Paragraph 40(a)</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <SNoTableHeader />
            <tbody>
              <SNoRow sno="(i)" label="Net profit (or loss) for the period" prefix="net_profit" data={data} onChange={onChange} />
              <SNoRow sno="(ii)" label="Exchange differences included therein — gain" prefix="exch_gain" data={data} onChange={onChange} />
              <SNoRow sno="" label="Exchange differences included therein — loss" prefix="exch_loss" data={data} onChange={onChange} indent />
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE 32 — GOVERNMENT GRANTS
   ══════════════════════════════════════════════ */
function Note32({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (
    <div className="max-w-4xl">
      <Card>
        <CardHeader><CardTitle className="text-base">Extent and Nature of Government Grants — Rs/rounded off</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <SNoTableHeader />
            <tbody>
              <SNoRow sno="(i)" label="Total grants received (Capital/Revenue)" prefix="total_grants" data={data} onChange={onChange} />
              <SNoRow sno="(ii)" label="Of which amount recognised in P&L" prefix="recognised_pl" data={data} onChange={onChange} />
              <SNoRow sno="(iii)" label="Out of (i) above, amount received as compensation or for immediate financial assistance, recognised as exceptional items in P&L" prefix="exceptional" data={data} onChange={onChange} />
              <SNoRow sno="(iv)" label="Amount of grants for specific assets" prefix="specific_assets" data={data} onChange={onChange} />
              <SNoRow sno="(v)" label="Grant for Specific assets adjusted against Assets" prefix="adjusted_assets" data={data} onChange={onChange} />
              <SNoRow sno="(vi)" label="Amount if any held in Deferred Income" prefix="deferred_income" data={data} onChange={onChange} />
              <SNoRow sno="(vii)" label="Deferred income includes amount of grant for non-depreciable asset, subject to conditions" prefix="non_depreciable" data={data} onChange={onChange} />
              <SNoRow sno="(viii)" label="Non-monetary grants received indicate free or concessional rates" prefix="non_monetary" data={data} onChange={onChange} />
              <SNoRow sno="(ix)" label="Fair value of non-monetary grant" prefix="fair_value" data={data} onChange={onChange} />
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE 33 — ACCOUNTING FOR INVESTMENTS
   ══════════════════════════════════════════════ */
function Note33({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (
    <div className="space-y-6 max-w-5xl">
      <Card>
        <CardHeader><CardTitle className="text-base">a. Disclosures pursuant to Para 35(b) of AS 13 — Amounts included in P&L</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <SNoTableHeader />
            <tbody>
              <tr className="border-b border-border bg-muted/20"><td className="py-2 px-3 text-sm text-muted-foreground">(i)</td><td className="py-2 px-3 text-sm font-medium" colSpan={3}>Gross Income from Current investments</td></tr>
              <SNoRow sno="" label="Interest" prefix="ci_interest" data={data} onChange={onChange} indent />
              <SNoRow sno="" label="Dividend" prefix="ci_dividend" data={data} onChange={onChange} indent />
              <SNoRow sno="" label="Royalties" prefix="ci_royalties" data={data} onChange={onChange} indent />
              <tr className="border-b border-border bg-muted/20"><td className="py-2 px-3 text-sm text-muted-foreground">(ii)</td><td className="py-2 px-3 text-sm font-medium" colSpan={3}>Gross Income from Long Term investments</td></tr>
              <SNoRow sno="" label="Interest" prefix="lt_interest" data={data} onChange={onChange} indent />
              <SNoRow sno="" label="Dividend" prefix="lt_dividend" data={data} onChange={onChange} indent />
              <SNoRow sno="" label="Royalties" prefix="lt_royalties" data={data} onChange={onChange} indent />
              <SNoRow sno="(iii)" label="Profit or loss on sale of current investments" prefix="pl_current" data={data} onChange={onChange} />
              <SNoRow sno="(iv)" label="Profit or loss on sale of long-term investments" prefix="pl_longterm" data={data} onChange={onChange} />
              <SNoRow sno="(v)" label="Investment Properties" prefix="inv_properties" data={data} onChange={onChange} />
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">b. Disclosures pursuant to Paragraphs 26 and 27 of AS 13 — Rs./rounded off</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground w-12"></th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Particulars</th>
                <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-28">Current Inv. CY</th>
                <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-28">Current Inv. PY</th>
                <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-28">Long-term CY</th>
                <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-28">Long-term PY</th>
              </tr>
            </thead>
            <tbody>
              {[
                { sno: "(i)", label: "Government or Trust Securities", p: "govt" },
                { sno: "(ii)", label: "Shares, Debentures and Bonds", p: "shares" },
                { sno: "(iii)", label: "Others", p: "others" },
                { sno: "(iv)", label: "Investment Properties", p: "b_inv_prop" },
                { sno: "(v)", label: "Quoted investments — Market value", p: "quoted_mv" },
                { sno: "", label: "Quoted investments — Book value", p: "quoted_bv" },
                { sno: "(vi)", label: "Unquoted Investments", p: "unquoted" },
                { sno: "(vii)", label: "Opening carrying amount", p: "opening" },
                { sno: "", label: "Additions", p: "additions" },
                { sno: "", label: "Disposals, deletions", p: "disposals" },
                { sno: "", label: "Decline in value", p: "decline" },
                { sno: "", label: "Closing carrying amount", p: "closing" },
              ].map((r) => (
                <tr key={r.p} className="border-b border-border">
                  <td className="py-2 px-3 text-muted-foreground">{r.sno}</td>
                  <td className={`py-2 px-3 ${!r.sno ? "pl-8" : ""}`}>{r.label}</td>
                  <td className="py-1 px-1"><NoteInput value={data[`${r.p}_ci_cy`] || ""} onChange={(v) => onChange(`${r.p}_ci_cy`, v)} /></td>
                  <td className="py-1 px-1"><NoteInput value={data[`${r.p}_ci_py`] || ""} onChange={(v) => onChange(`${r.p}_ci_py`, v)} /></td>
                  <td className="py-1 px-1"><NoteInput value={data[`${r.p}_lt_cy`] || ""} onChange={(v) => onChange(`${r.p}_lt_cy`, v)} /></td>
                  <td className="py-1 px-1"><NoteInput value={data[`${r.p}_lt_py`] || ""} onChange={(v) => onChange(`${r.p}_lt_py`, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE 34 — EMPLOYEE BENEFITS
   ══════════════════════════════════════════════ */
function Note34({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  // Auto-calculations
  const stbFields = ["wages", "leave", "bonus", "perquisites", "contrib"];
  const stbSumCy = stbFields.reduce((a, f) => a + n(data[`stb_${f}_cy`]), 0);
  const stbSumPy = stbFields.reduce((a, f) => a + n(data[`stb_${f}_py`]), 0);

  const expFields = ["exp_current_svc", "exp_interest", "exp_return", "exp_actuarial", "exp_past_svc", "exp_curtail"];
  const expSubCy = expFields.reduce((a, f) => a + n(data[`${f}_cy`]), 0);
  const expSubPy = expFields.reduce((a, f) => a + n(data[`${f}_py`]), 0);
  const expNetCy = expSubCy - n(data.exp_capitalised_cy);
  const expNetPy = expSubPy - n(data.exp_capitalised_py);

  // Movement in Plan Assets: f = a+b+c-d+e
  const fvEndCy = n(data.pa_begin_cy) + n(data.pa_return_cy) + n(data.pa_contrib_cy) - n(data.pa_benefits_cy) + n(data.pa_other_cy);
  const fvEndPy = n(data.pa_begin_py) + n(data.pa_return_py) + n(data.pa_contrib_py) - n(data.pa_benefits_py) + n(data.pa_other_py);

  // Movement in Obligations
  const oblFields = ["ob_current_svc", "ob_interest", "ob_actuarial", "ob_past_svc", "ob_curtail"];
  const oblSubCy = oblFields.reduce((a, f) => a + n(data[`${f}_cy`]), 0);
  const oblSubPy = oblFields.reduce((a, f) => a + n(data[`${f}_py`]), 0);
  const oblNetCy = n(data.ob_begin_cy) + oblSubCy - n(data.ob_capitalised_cy);
  const oblNetPy = n(data.ob_begin_py) + oblSubPy - n(data.ob_capitalised_py);
  const liabCy = oblNetCy > fvEndCy ? oblNetCy - fvEndCy : 0;
  const liabPy = oblNetPy > fvEndPy ? oblNetPy - fvEndPy : 0;
  const assetCy = fvEndCy > oblNetCy ? fvEndCy - oblNetCy : 0;
  const assetPy = fvEndPy > oblNetPy ? fvEndPy - oblNetPy : 0;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Table 1: Short-term */}
      <Card>
        <CardHeader><CardTitle className="text-base">Disclosure Pursuant to Para 47 of AS 15 — Short Term Employee Benefits</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <NoteTableHeader />
            <tbody>
              <TwoColRow label="(i) Wages and Salaries" prefix="stb_wages" cy={data.stb_wages_cy || ""} py={data.stb_wages_py || ""} onChange={onChange} />
              <TwoColRow label="(ii) Paid Annual Leave" prefix="stb_leave" cy={data.stb_leave_cy || ""} py={data.stb_leave_py || ""} onChange={onChange} />
              <TwoColRow label="(iii) Profit Sharing and Bonus payments" prefix="stb_bonus" cy={data.stb_bonus_cy || ""} py={data.stb_bonus_py || ""} onChange={onChange} />
              <TwoColRow label="(iv) Perquisites — Medical Care, Housing, Cars" prefix="stb_perquisites" cy={data.stb_perquisites_cy || ""} py={data.stb_perquisites_py || ""} onChange={onChange} />
              <TwoColRow label="(v) Defined Contribution Plans" prefix="stb_contrib" cy={data.stb_contrib_cy || ""} py={data.stb_contrib_py || ""} onChange={onChange} />
              <tr className="border-b border-border bg-muted/30 font-semibold">
                <td className="py-2 px-3 text-sm">Total</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(stbSumCy) || "—"}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(stbSumPy) || "—"}</td>
              </tr>
              <TwoColRow label="Of this, Payments to KMP (see note on AS 18 Related Party Disclosures)" prefix="stb_kmp" cy={data.stb_kmp_cy || ""} py={data.stb_kmp_py || ""} onChange={onChange} />
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Table 2: Defined Benefit Plan Liability */}
      <Card>
        <CardHeader><CardTitle className="text-base">Disclosure Pursuant to Para 55 of AS 15 — Defined Benefit Plan Liability</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <NoteTableHeader />
            <tbody>
              <TwoColRow label="(i) PV of Defined Benefit Obligation on reporting date" prefix="dbp_pv" cy={data.dbp_pv_cy || ""} py={data.dbp_pv_py || ""} onChange={onChange} />
              <TwoColRow label="(ii) Less unvested Past service cost not recognised" prefix="dbp_unvested" cy={data.dbp_unvested_cy || ""} py={data.dbp_unvested_py || ""} onChange={onChange} />
              <TwoColRow label="(iii) Less Fair Value of Plan Assets on reporting date" prefix="dbp_fv" cy={data.dbp_fv_cy || ""} py={data.dbp_fv_py || ""} onChange={onChange} />
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground mt-2 italic">(Note: Where Fair Value of assets exceeds item (i) minus (ii), the negative figure will emerge as asset in BS)</p>
        </CardContent>
      </Card>

      {/* Table 3: Defined Benefit Plan Expense */}
      <Card>
        <CardHeader><CardTitle className="text-base">Disclosure pursuant to Para 61 and para 92 of AS 15 — Defined Benefit Plan Expense</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <SNoTableHeader />
            <tbody>
              <SNoRow sno="(i)" label="Defined Benefit Plan Expenses" prefix="exp_total" data={data} onChange={onChange} />
              <tr className="border-b border-border bg-muted/20"><td colSpan={4} className="py-2 px-3 text-sm font-medium">Breakdown:</td></tr>
              <SNoRow sno="(i)" label="Current Service Cost" prefix="exp_current_svc" data={data} onChange={onChange} />
              <SNoRow sno="(ii)" label="Interest Cost" prefix="exp_interest" data={data} onChange={onChange} />
              <SNoRow sno="(iii)" label="Expected return on Plan Asset" prefix="exp_return" data={data} onChange={onChange} />
              <SNoRow sno="(iv)" label="Actuarial Gains or Losses" prefix="exp_actuarial" data={data} onChange={onChange} />
              <SNoRow sno="(v)" label="Past Service Cost (if any)" prefix="exp_past_svc" data={data} onChange={onChange} />
              <SNoRow sno="(vi)" label="Curtailments or settlements (if any)" prefix="exp_curtail" data={data} onChange={onChange} />
              <tr className="border-b border-border bg-muted/30 font-semibold">
                <td colSpan={2} className="py-2 px-3 text-sm">Sub-total</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(expSubCy)}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(expSubPy)}</td>
              </tr>
              <SNoRow sno="" label="Less: Amount capitalised in PPE or Inventory" prefix="exp_capitalised" data={data} onChange={onChange} />
              <tr className="border-b border-border bg-muted/30 font-semibold">
                <td colSpan={2} className="py-2 px-3 text-sm">Net expense recognised in P&L</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(expNetCy)}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(expNetPy)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Table 4: Reconciliation */}
      <Card>
        <CardHeader><CardTitle className="text-base">Disclosure pursuant to Para 119 to 123 (Reconciliation) — Defined Benefit Plan Actuarial Assumptions</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {/* Movement in Plan Assets */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Movement in Plan Assets</h4>
            <table className="w-full border border-border rounded-md overflow-hidden">
              <NoteTableHeader />
              <tbody>
                <TwoColRow label="(a) FV of Plan assets at the beginning of period" prefix="pa_begin" cy={data.pa_begin_cy || ""} py={data.pa_begin_py || ""} onChange={onChange} />
                <TwoColRow label="(b) Actual Return on Plan assets" prefix="pa_return" cy={data.pa_return_cy || ""} py={data.pa_return_py || ""} onChange={onChange} />
                <TwoColRow label="(c) Contributions into Plan Assets current period" prefix="pa_contrib" cy={data.pa_contrib_cy || ""} py={data.pa_contrib_py || ""} onChange={onChange} />
                <TwoColRow label="(d) Benefits paid or settlements (deduct)" prefix="pa_benefits" cy={data.pa_benefits_cy || ""} py={data.pa_benefits_py || ""} onChange={onChange} />
                <TwoColRow label="(e) Any other change" prefix="pa_other" cy={data.pa_other_cy || ""} py={data.pa_other_py || ""} onChange={onChange} />
                <tr className="border-b border-border bg-muted/30 font-semibold">
                  <td className="py-2 px-3 text-sm">(f) FV of Plan assets at the end of period</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(fvEndCy)}</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(fvEndPy)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Movement in Obligations */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Movement in Obligations</h4>
            <table className="w-full border border-border rounded-md overflow-hidden">
              <NoteTableHeader />
              <tbody>
                <TwoColRow label="(g) Obligations at the beginning of period" prefix="ob_begin" cy={data.ob_begin_cy || ""} py={data.ob_begin_py || ""} onChange={onChange} />
                <TwoColRow label="(h) Current Service Cost" prefix="ob_current_svc" cy={data.ob_current_svc_cy || ""} py={data.ob_current_svc_py || ""} onChange={onChange} />
                <TwoColRow label="(i) Interest Cost" prefix="ob_interest" cy={data.ob_interest_cy || ""} py={data.ob_interest_py || ""} onChange={onChange} />
                <TwoColRow label="(j) Actuarial gains or losses" prefix="ob_actuarial" cy={data.ob_actuarial_cy || ""} py={data.ob_actuarial_py || ""} onChange={onChange} />
                <TwoColRow label="(k) Past Service Costs now added (if any)" prefix="ob_past_svc" cy={data.ob_past_svc_cy || ""} py={data.ob_past_svc_py || ""} onChange={onChange} />
                <TwoColRow label="(l) Curtailments" prefix="ob_curtail" cy={data.ob_curtail_cy || ""} py={data.ob_curtail_py || ""} onChange={onChange} />
                <tr className="border-b border-border bg-muted/30 font-semibold">
                  <td className="py-2 px-3 text-sm">Sub-total of (h) to (l)</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(oblSubCy)}</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(oblSubPy)}</td>
                </tr>
                <TwoColRow label="Less amount capitalised in PPE or inventory" prefix="ob_capitalised" cy={data.ob_capitalised_cy || ""} py={data.ob_capitalised_py || ""} onChange={onChange} />
                <tr className="border-b border-border bg-muted/30 font-semibold">
                  <td className="py-2 px-3 text-sm">(m) Net obligation at the end of the period</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(oblNetCy)}</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(oblNetPy)}</td>
                </tr>
                <tr className="border-b border-border bg-muted/30 font-semibold">
                  <td className="py-2 px-3 text-sm">(n) Obligation {">"} FV of assets (liability)</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(liabCy)}</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(liabPy)}</td>
                </tr>
                <tr className="border-b border-border bg-muted/30 font-semibold">
                  <td className="py-2 px-3 text-sm">(o) FV of Assets {">"} Obligation (asset)</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(assetCy)}</td>
                  <td className="py-2 px-2 text-right text-sm">{fmt(assetPy)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE 35 — BORROWING COSTS
   ══════════════════════════════════════════════ */
function Note35({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const balCy = n(data.total_cy) - n(data.capitalised_cy);
  const balPy = n(data.total_py) - n(data.capitalised_py);

  return (
    <div className="max-w-4xl">
      <Card>
        <CardHeader><CardTitle className="text-base">Borrowing costs included in P&L — Rs/rounded off</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <SNoTableHeader />
            <tbody>
              <SNoRow sno="(i)" label="Total borrowing costs incurred" prefix="total" data={data} onChange={onChange} />
              <SNoRow sno="(ii)" label="Of which costs capitalised" prefix="capitalised" data={data} onChange={onChange} />
              <tr className="border-b border-border bg-muted/30 font-semibold">
                <td className="py-2 px-3 text-sm text-muted-foreground">(iii)</td>
                <td className="py-2 px-3 text-sm">Balance charged to P&L</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(balCy)}</td>
                <td className="py-2 px-2 text-right text-sm">{fmt(balPy)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
