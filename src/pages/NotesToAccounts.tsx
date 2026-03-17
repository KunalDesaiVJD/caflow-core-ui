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
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Save, Printer, FileText, CheckCircle2, Circle, Plus, Lock, Sparkles } from "lucide-react";

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
  { key: "note_36", num: 36, title: "Segment Reporting" },
  { key: "note_37", num: 37, title: "Related Parties" },
  { key: "note_38", num: 38, title: "Leases" },
  { key: "note_39", num: 39, title: "Earnings per Share" },
  { key: "note_40", num: 40, title: "Accounting for Taxes on Income" },
  { key: "note_41", num: 41, title: "Discontinuing Operations" },
  { key: "note_42", num: 42, title: "Intangible Assets" },
  { key: "note_43", num: 43, title: "Impairment of Assets" },
  { key: "note_44", num: 44, title: "Events after the Reporting Period" },
  { key: "note_45", num: 45, title: "Previous Year Figures" },
];

/* ───────── Policy texts for Note 2 ───────── */
const POLICY_TEXTS: Record<string, { title: string; text: string }> = {
  a: { title: "a. Property Plant and Equipment", text: "The fixed Assets are recorded at the cost of acquisition or construction less accumulated depreciation which includes interest on borrowings and other incidental expenses incurred up to the date of its put to use. Property, plant and equipment which are completed and put to use was transferred to appropriate category of assets from WIP during the year." },
  b: { title: "b. Depreciation", text: "In respect of depreciation/amortization on fixed assets, the rate of depreciation adopted on a straight line basis as prescribed in Schedule-II of Companies Act, 2013 so as to write off the cost of the assets over the remaining useful life of the respective asset." },
  c: { title: "c. Capital Work in Progress", text: "Properties under construction are stated at cost less accumulated impairment losses if any, until construction or development is completed, at which time they are reclassified to be accounted for as an item of Property Plant and Equipment." },
  d: { title: "d. Research and Development Cost", text: "Research costs incurred in developing Intangible Assets such as computer software are recognised as expense when incurred. The development costs are capitalised as development work in progress only when the technical feasibility is established." },
  e: { title: "e. Intangible Assets", text: "Intangible assets purchased by the entity, and that have finite useful lives, are measured at cost, less accumulated amortization and accumulated impairment losses." },
  f: { title: "f. Leases", text: "At the inception of a lease, the lease arrangement is classified as either a finance or operating lease, based on the substance of the lease arrangement." },
  g: { title: "g. Investments", text: "Investments, if any are classified into current and long-term investment. Current investments are stated at lower of cost and fair value." },
  h: { title: "h. Inventories", text: "Stock of inventories, if any are valued at the cost or net realizable value whichever is lower after providing for obsolescence and other losses." },
  i: { title: "i. Trade and Other Receivables", text: "Trade and other receivables are generally measured at invoice value. An allowance for any shortfall in recovery is established if the collection becomes doubtful." },
  j: { title: "j. Cash and Cash Equivalents", text: "Cash and cash equivalents include all cash balances and short-term highly liquid investments that are readily convertible into known amounts of cash." },
  k: { title: "k. Cash Flow Statements", text: "The entity prepares and presents Cash Flow from Operating Activities by adopting indirect method." },
  l: { title: "l. Revenues and Other Income", text: "Revenue is recognized to the extent that is probable that the economic benefits will flow to the company and the revenue can be reliably measured." },
  m: { title: "m. Borrowing Costs", text: "Borrowing costs are interest and other costs incurred by an enterprise in connection with the borrowing of funds. Borrowing costs are capitalised as part of the cost of a qualifying asset." },
  n: { title: "n. Impairment of Assets", text: "At the end of each reporting period, the carrying amounts of Property, Plant & Equipment, and other intangible assets are tested for impairment." },
  o: { title: "o. Foreign Currency Transactions", text: "Foreign currency transactions, if any, are recorded at the rates of exchange prevailing on the date of transaction." },
  p: { title: "p. Employee Benefits", text: "Employee benefits as wages, salaries, paid leave and bonus are accrued in the year in which the services are rendered by the employees." },
  q: { title: "q. Provisions and Contingencies", text: "Provisions involving substantial degree of estimate in measurement are recognized when there is present obligation as a result of past events." },
  r: { title: "r. Taxes on Income", text: "Tax expense comprises current and deferred tax, and this is recognized in profit and loss." },
  s: { title: "s. Government Grants", text: "Grants from the government are recognised when there is reasonable assurance that the Company will comply with the conditions attached to them." },
  t: { title: "t. Earnings per Share", text: "Basic earnings per equity share is computed by dividing the net profit attributable to the equity holders by weighted average number of equity shares outstanding." },
  u: { title: "u. Segment Reporting", text: "By applying the definitions of business segment and geographical segment, the management has concluded that there is neither more than one business segment nor more than one geographical segment." },
};

const STANDARD_TEXTS = {
  basis_of_preparation: "The financial statements of the Company have been prepared in accordance with the Generally Accepted Accounting Principles in India (Indian GAAP) to comply with the Accounting Standards notified under the relevant provisions of the Companies Act, 2013. The financial statements have been prepared on accrual basis under the historical cost convention.",
  basis_of_measurement: "The Financial Statements have been prepared on historical cost convention, on accrual basis of accounting, except for Cash Flow Statement and certain Assets or Liabilities that have been measured either on fair value, or on net realisable value or on recoverable amount basis.",
  use_of_estimates: "The preparation of financial statements in accordance with the generally accepted accounting principles requires the management to make estimates and assumptions that affect the reported amounts of assets and liabilities as at the Balance sheet date. The actual results could differ from these estimates.",
};

/* ───────── Helpers ───────── */
const p = (v: any) => parseFloat(v) || 0;
const fmt = (v: number) => (v === 0 ? "" : v.toFixed(2));
const fmtIndian = (v: number) => {
  if (!v) return "—";
  const s = Math.abs(v).toFixed(2);
  const [intPart, dec] = s.split(".");
  const lastThree = intPart.slice(-3);
  const otherNums = intPart.slice(0, -3);
  const formatted = otherNums.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + (otherNums ? "," : "") + lastThree;
  return (v < 0 ? "-" : "") + "₹ " + formatted + "." + dec;
};

function NoteInput({ value, onChange, placeholder = "—", className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`h-8 text-right text-sm ${className}`} />;
}

function TextInput({ value, onChange, placeholder = "", className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`h-8 text-sm ${className}`} />;
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

function NoteTableHeader({ rolloverFy }: { rolloverFy?: string }) {
  return (
    <thead>
      <tr className="bg-muted/50">
        <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Particulars</th>
        <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">Current Year (₹)</th>
        <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">
          Previous Year (₹)
          {rolloverFy && <Badge variant="outline" className="ml-1 text-[9px] bg-amber-50 text-amber-700 border-amber-200">Rolled from {rolloverFy}</Badge>}
        </th>
      </tr>
    </thead>
  );
}

function SNoTableHeader({ col1 = "S No.", rolloverFy }: { col1?: string; rolloverFy?: string }) {
  return (
    <thead>
      <tr className="bg-muted/50">
        <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground w-16">{col1}</th>
        <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Particulars</th>
        <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">Current Year (₹)</th>
        <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">
          Previous Year (₹)
          {rolloverFy && <Badge variant="outline" className="ml-1 text-[9px] bg-amber-50 text-amber-700 border-amber-200">Rolled from {rolloverFy}</Badge>}
        </th>
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

/* ───────── MAIN COMPONENT ───────── */
export default function NotesToAccounts({ engagementIdProp, onFinalise }: { engagementIdProp?: string; onFinalise?: () => void } = {}) {
  const [sp] = useSearchParams();
  const engagementId = engagementIdProp || sp.get("engagementId") || "";
  const { user } = useAuth();
  const [recordId, setRecordId] = useState("");
  const [activeNote, setActiveNote] = useState("note_1");
  const [saving, setSaving] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [rolledFromFy, setRolledFromFy] = useState("");
  const [showPrint, setShowPrint] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clientData, setClientData] = useState<{ name?: string; cin?: string; registered_office?: string; business_activity?: string } | null>(null);
  const [noteSelection, setNoteSelection] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NOTE_LIST.map(nl => [nl.key, true]))
  );

  // All note states
  const [note1, setNote1] = useState<any>({});
  const [note2, setNote2] = useState<any>({});
  const [note29, setNote29] = useState<any>({});
  const [note30, setNote30] = useState<any>({});
  const [note31, setNote31] = useState<any>({});
  const [note32, setNote32] = useState<any>({});
  const [note33, setNote33] = useState<any>({});
  const [note34, setNote34] = useState<any>({});
  const [note35, setNote35] = useState<any>({});
  const [note36, setNote36] = useState<any>({});
  const [note37, setNote37] = useState<any>({});
  const [note38, setNote38] = useState<any>({});
  const [note39, setNote39] = useState<any>({});
  const [note40, setNote40] = useState<any>({});
  const [note41, setNote41] = useState<any>({});
  const [note42, setNote42] = useState<any>({});
  const [note43, setNote43] = useState<any>({});
  const [note44, setNote44] = useState<any>({ text: "There are no significant events after the reporting period except as disclosed in note 20(f), that require adjustments or disclosures in the standalone Ind AS financial statements as on the balance sheet date." });
  const [note45, setNote45] = useState<any>({ text: "The figures for the corresponding previous year have been regrouped/ reclassified, wherever considered necessary, to make them comparable with current years classification." });

  const stateMap: Record<string, [any, (v: any) => void]> = {
    note_1: [note1, setNote1], note_2: [note2, setNote2],
    note_29: [note29, setNote29], note_30: [note30, setNote30], note_31: [note31, setNote31],
    note_32: [note32, setNote32], note_33: [note33, setNote33], note_34: [note34, setNote34],
    note_35: [note35, setNote35], note_36: [note36, setNote36], note_37: [note37, setNote37],
    note_38: [note38, setNote38], note_39: [note39, setNote39], note_40: [note40, setNote40],
    note_41: [note41, setNote41], note_42: [note42, setNote42], note_43: [note43, setNote43],
    note_44: [note44, setNote44], note_45: [note45, setNote45],
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
          if (val && typeof val === "object") {
            stateMap[nl.key][1](val);
            if (val.rolled_from_fy && !rolledFromFy) setRolledFromFy(val.rolled_from_fy);
          }
        });
      } else {
        const { data: eng } = await supabase.from("audit_engagements").select("firm_id, client_id, financial_year").eq("id", engagementId).single();
        // Check rollover buffer
        const { data: buffer } = await supabase.from("notes_rollover_buffer" as any).select("*").eq("client_id", eng?.client_id).eq("to_financial_year", eng?.financial_year).eq("applied", false).maybeSingle();
        const insertPayload: any = {
          engagement_id: engagementId,
          firm_id: eng?.firm_id || user?.firm_id,
          client_id: eng?.client_id,
          financial_year: eng?.financial_year,
        };
        if (buffer && (buffer as any).rolled_notes) {
          const rolled = (buffer as any).rolled_notes;
          Object.assign(insertPayload, rolled);
          setRolledFromFy((buffer as any).from_financial_year);
          // Apply buffer data to state
          NOTE_LIST.forEach((nl) => {
            if (rolled[nl.key]) stateMap[nl.key][1](rolled[nl.key]);
          });
          // Mark buffer as applied
          await supabase.from("notes_rollover_buffer" as any).update({ applied: true }).eq("id", (buffer as any).id);
        }
        const { data: newRec } = await supabase.from("notes_to_accounts" as any).insert(insertPayload as any).select().single();
        if (newRec) setRecordId((newRec as any).id);
      }
    })();
  }, [engagementId]);

  /* ── Save ── */
  const saveAll = useCallback(async () => {
    if (!recordId) return;
    setSaving(true);
    const payload: any = { last_saved_at: new Date().toISOString() };
    NOTE_LIST.forEach((nl) => { payload[nl.key] = stateMap[nl.key][0]; });
    const { error } = await supabase.from("notes_to_accounts" as any).update(payload).eq("id", recordId);
    setSaving(false);
    if (error) toast.error("Save failed: " + error.message);
    else toast.success("Saved");
  }, [recordId, ...NOTE_LIST.map(nl => stateMap[nl.key][0])]);

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

  /* ── Finalise ── */
  const handleFinalise = async () => {
    setFinalising(true);
    await saveAll();
    try {
      const { data, error } = await supabase.functions.invoke("rollover-notes-previous-year", {
        body: { engagement_id: engagementId },
      });
      if (error) throw error;
      toast.success(`Notes finalised. Previous year data rolled over to FY ${data?.rolled_to || "next year"}.`);
      onFinalise?.();
    } catch (e: any) {
      toast.error("Finalise failed: " + (e.message || "Unknown error"));
    }
    setFinalising(false);
  };

  if (!engagementId) {
    return <div className="p-8 text-center text-muted-foreground">No engagement selected. Open from Audit Pipeline → Stage 7.</div>;
  }

  const renderNote = () => {
    const noteKey = activeNote;
    const data = stateMap[noteKey]?.[0] || {};
    const onChange = (f: string, v: string) => updateField(noteKey, f, v);
    switch (noteKey) {
      case "note_1": return <Note1 data={data} onChange={onChange} />;
      case "note_2": return <Note2 data={data} onChange={onChange} />;
      case "note_29": return <Note29 data={data} onChange={onChange} rolloverFy={rolledFromFy} />;
      case "note_30": return <Note30 data={data} onChange={onChange} />;
      case "note_31": return <Note31 data={data} onChange={onChange} />;
      case "note_32": return <Note32 data={data} onChange={onChange} />;
      case "note_33": return <Note33 data={data} onChange={onChange} />;
      case "note_34": return <Note34 data={data} onChange={onChange} />;
      case "note_35": return <Note35 data={data} onChange={onChange} />;
      case "note_36": return <Note36 data={data} onChange={onChange} />;
      case "note_37": return <Note37 data={data} onChange={onChange} />;
      case "note_38": return <Note38 data={data} onChange={onChange} />;
      case "note_39": return <Note39 data={data} onChange={onChange} engagementId={engagementId} />;
      case "note_40": return <Note40 data={data} onChange={onChange} />;
      case "note_41": return <Note41 data={data} onChange={onChange} />;
      case "note_42": return <Note42 data={data} onChange={onChange} />;
      case "note_43": return <Note43 data={data} onChange={onChange} />;
      case "note_44": return <Note44 data={data} onChange={onChange} />;
      case "note_45": return <Note45 data={data} onChange={onChange} />;
      default: return null;
    }
  };

  if (showPrint) return <PrintView notes={stateMap} onClose={() => setShowPrint(false)} />;

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <div className="w-64 border-r border-border bg-card flex-shrink-0">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Notes to Accounts</h2>
        </div>
        <ScrollArea className="h-[calc(100%-3.5rem)]">
          <div className="p-2 space-y-0.5">
            {NOTE_LIST.map((nl) => (
              <button key={nl.key} onClick={() => setActiveNote(nl.key)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${activeNote === nl.key ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50 text-foreground"}`}>
                {isFilled(nl.key) ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                <span className="truncate">Note {nl.num} — {nl.title}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
          <h1 className="text-lg font-semibold">Note {NOTE_LIST.find((n) => n.key === activeNote)?.num} — {NOTE_LIST.find((n) => n.key === activeNote)?.title}</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={saveAll} disabled={saving}><Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save All"}</Button>
            <Button variant="outline" size="sm" onClick={() => setShowPrint(true)}><Printer className="h-4 w-4 mr-1" /> Print</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="default" size="sm" disabled={finalising}><Lock className="h-4 w-4 mr-1" /> Finalise Notes</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Finalise Notes to Accounts?</AlertDialogTitle>
                  <AlertDialogDescription>This will lock the notes, roll over current year figures as previous year data to the next FY engagement, and mark the notes as finalised. This action cannot be easily undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleFinalise}>Confirm & Finalise</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <ScrollArea className="flex-1 p-6">{renderNote()}</ScrollArea>
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
          <div><label className="text-sm font-medium text-foreground">Company Name</label><Input value={data.company_name || ""} onChange={(e) => onChange("company_name", e.target.value)} placeholder="Enter company name" className="mt-1" /></div>
          <div><label className="text-sm font-medium text-foreground">Registered Office Address</label><Textarea value={data.address || ""} onChange={(e) => onChange("address", e.target.value)} placeholder="Enter registered office address" className="mt-1" rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-foreground">Registration Number</label><Input value={data.reg_number || ""} onChange={(e) => onChange("reg_number", e.target.value)} placeholder="CIN / Registration No." className="mt-1" /></div>
            <div><label className="text-sm font-medium text-foreground">Date of Incorporation</label><Input type="date" value={data.incorporation_date || ""} onChange={(e) => onChange("incorporation_date", e.target.value)} className="mt-1" /></div>
          </div>
          <div><label className="text-sm font-medium text-foreground">Principal Activity</label><Textarea value={data.principal_activity || ""} onChange={(e) => onChange("principal_activity", e.target.value)} placeholder="Describe principal activities" className="mt-1" rows={2} /></div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="text-base">b. Basis of Preparation</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground leading-relaxed">{STANDARD_TEXTS.basis_of_preparation}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">c. Basis of Measurement</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground leading-relaxed">{STANDARD_TEXTS.basis_of_measurement}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">d. Use of Estimates</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground leading-relaxed">{STANDARD_TEXTS.use_of_estimates}</p></CardContent></Card>
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
            <div><label className="text-xs font-medium text-foreground">Additional Notes (optional)</label>
              <Textarea value={data[`${key}_additional`] || ""} onChange={(e) => onChange(`${key}_additional`, e.target.value)} placeholder="Add firm-specific customisation..." className="mt-1" rows={2} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTES 29–35 (unchanged from previous implementation)
   ══════════════════════════════════════════════ */
function Note29({ data, onChange, rolloverFy }: { data: any; onChange: (f: string, v: string) => void; rolloverFy?: string }) {
  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader><CardTitle className="text-base">a) Disclosures pursuant to Para 39(a) — Rs/rounded off</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full border border-border rounded-md overflow-hidden">
            <SNoTableHeader rolloverFy={rolloverFy} />
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
            <SNoTableHeader />
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

function Note30({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (<div className="max-w-4xl"><Card><CardHeader><CardTitle className="text-base">Disclosure Pursuant to Para 14 of AS 9</CardTitle></CardHeader><CardContent className="space-y-4">
    <table className="w-full border border-border rounded-md overflow-hidden"><SNoTableHeader /><tbody><SNoRow sno="1" label="Revenue recognition postponed due to uncertainties" prefix="rev_postponed" data={data} onChange={onChange} /></tbody></table>
    <div><label className="text-sm font-medium text-foreground">Uncertainty Details</label><Textarea value={data.uncertainty_text || ""} onChange={(e) => onChange("uncertainty_text", e.target.value)} placeholder="Revenue postponed due to..." className="mt-1" rows={3} /></div>
  </CardContent></Card></div>);
}

function Note31({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (<div className="space-y-6 max-w-4xl">
    <Card><CardHeader><CardTitle className="text-base">a) Disclosures pursuant to Paragraph 42</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground leading-relaxed">The entity does not carry any long-term monetary items, exchange fluctuations in which are to be held in a separate account. The entity reports its transactions in Indian Rupees.</p></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">b) Disclosures pursuant to Paragraph 40(a)</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><SNoTableHeader /><tbody>
        <SNoRow sno="(i)" label="Net profit (or loss) for the period" prefix="net_profit" data={data} onChange={onChange} />
        <SNoRow sno="(ii)" label="Exchange differences included therein — gain" prefix="exch_gain" data={data} onChange={onChange} />
        <SNoRow sno="" label="Exchange differences included therein — loss" prefix="exch_loss" data={data} onChange={onChange} indent />
      </tbody></table>
    </CardContent></Card>
  </div>);
}

function Note32({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (<div className="max-w-4xl"><Card><CardHeader><CardTitle className="text-base">Extent and Nature of Government Grants — Rs/rounded off</CardTitle></CardHeader><CardContent>
    <table className="w-full border border-border rounded-md overflow-hidden"><SNoTableHeader /><tbody>
      {[{s:"(i)",l:"Total grants received (Capital/Revenue)",p:"total_grants"},{s:"(ii)",l:"Of which amount recognised in P&L",p:"recognised_pl"},{s:"(iii)",l:"Out of (i) above, amount received as compensation or for immediate financial assistance, recognised as exceptional items in P&L",p:"exceptional"},{s:"(iv)",l:"Amount of grants for specific assets",p:"specific_assets"},{s:"(v)",l:"Grant for Specific assets adjusted against Assets",p:"adjusted_assets"},{s:"(vi)",l:"Amount if any held in Deferred Income",p:"deferred_income"},{s:"(vii)",l:"Deferred income includes amount of grant for non-depreciable asset, subject to conditions",p:"non_depreciable"},{s:"(viii)",l:"Non-monetary grants received indicate free or concessional rates",p:"non_monetary"},{s:"(ix)",l:"Fair value of non-monetary grant",p:"fair_value"}].map(r => <SNoRow key={r.p} sno={r.s} label={r.l} prefix={r.p} data={data} onChange={onChange} />)}
    </tbody></table>
  </CardContent></Card></div>);
}

function Note33({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (<div className="space-y-6 max-w-5xl">
    <Card><CardHeader><CardTitle className="text-base">a. Disclosures pursuant to Para 35(b) of AS 13 — Amounts included in P&L</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><SNoTableHeader /><tbody>
        <tr className="border-b border-border bg-muted/20"><td className="py-2 px-3 text-sm text-muted-foreground">(i)</td><td className="py-2 px-3 text-sm font-medium" colSpan={3}>Gross Income from Current investments</td></tr>
        <SNoRow sno="" label="Interest" prefix="ci_interest" data={data} onChange={onChange} indent /><SNoRow sno="" label="Dividend" prefix="ci_dividend" data={data} onChange={onChange} indent /><SNoRow sno="" label="Royalties" prefix="ci_royalties" data={data} onChange={onChange} indent />
        <tr className="border-b border-border bg-muted/20"><td className="py-2 px-3 text-sm text-muted-foreground">(ii)</td><td className="py-2 px-3 text-sm font-medium" colSpan={3}>Gross Income from Long Term investments</td></tr>
        <SNoRow sno="" label="Interest" prefix="lt_interest" data={data} onChange={onChange} indent /><SNoRow sno="" label="Dividend" prefix="lt_dividend" data={data} onChange={onChange} indent /><SNoRow sno="" label="Royalties" prefix="lt_royalties" data={data} onChange={onChange} indent />
        <SNoRow sno="(iii)" label="Profit or loss on sale of current investments" prefix="pl_current" data={data} onChange={onChange} />
        <SNoRow sno="(iv)" label="Profit or loss on sale of long-term investments" prefix="pl_longterm" data={data} onChange={onChange} />
        <SNoRow sno="(v)" label="Investment Properties" prefix="inv_properties" data={data} onChange={onChange} />
      </tbody></table>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">b. Disclosures pursuant to Paragraphs 26 and 27 of AS 13 — Rs./rounded off</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden text-sm"><thead><tr className="bg-muted/50"><th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground w-12"></th><th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Particulars</th><th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-28">Curr Inv CY</th><th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-28">Curr Inv PY</th><th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-28">LT CY</th><th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-28">LT PY</th></tr></thead><tbody>
        {[{s:"(i)",l:"Government or Trust Securities",k:"govt"},{s:"(ii)",l:"Shares, Debentures and Bonds",k:"shares"},{s:"(iii)",l:"Others",k:"others"},{s:"(iv)",l:"Investment Properties",k:"b_inv_prop"},{s:"(v)",l:"Quoted investments — Market value",k:"quoted_mv"},{s:"",l:"Quoted investments — Book value",k:"quoted_bv"},{s:"(vi)",l:"Unquoted Investments",k:"unquoted"},{s:"(vii)",l:"Opening carrying amount",k:"opening"},{s:"",l:"Additions",k:"additions"},{s:"",l:"Disposals, deletions",k:"disposals"},{s:"",l:"Decline in value",k:"decline"},{s:"",l:"Closing carrying amount",k:"closing"}].map(r => (
          <tr key={r.k} className="border-b border-border"><td className="py-2 px-3 text-muted-foreground">{r.s}</td><td className={`py-2 px-3 ${!r.s?"pl-8":""}`}>{r.l}</td>
            <td className="py-1 px-1"><NoteInput value={data[`${r.k}_ci_cy`]||""} onChange={v=>onChange(`${r.k}_ci_cy`,v)} /></td><td className="py-1 px-1"><NoteInput value={data[`${r.k}_ci_py`]||""} onChange={v=>onChange(`${r.k}_ci_py`,v)} /></td>
            <td className="py-1 px-1"><NoteInput value={data[`${r.k}_lt_cy`]||""} onChange={v=>onChange(`${r.k}_lt_cy`,v)} /></td><td className="py-1 px-1"><NoteInput value={data[`${r.k}_lt_py`]||""} onChange={v=>onChange(`${r.k}_lt_py`,v)} /></td></tr>))}
      </tbody></table>
    </CardContent></Card>
  </div>);
}

function Note34({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const stbFields = ["wages","leave","bonus","perquisites","contrib"];
  const stbSumCy = stbFields.reduce((a,f) => a+p(data[`stb_${f}_cy`]),0); const stbSumPy = stbFields.reduce((a,f) => a+p(data[`stb_${f}_py`]),0);
  const expFields = ["exp_current_svc","exp_interest","exp_return","exp_actuarial","exp_past_svc","exp_curtail"];
  const expSubCy = expFields.reduce((a,f)=>a+p(data[`${f}_cy`]),0); const expSubPy = expFields.reduce((a,f)=>a+p(data[`${f}_py`]),0);
  const expNetCy = expSubCy - p(data.exp_capitalised_cy); const expNetPy = expSubPy - p(data.exp_capitalised_py);
  const fvEndCy = p(data.pa_begin_cy)+p(data.pa_return_cy)+p(data.pa_contrib_cy)-p(data.pa_benefits_cy)+p(data.pa_other_cy);
  const fvEndPy = p(data.pa_begin_py)+p(data.pa_return_py)+p(data.pa_contrib_py)-p(data.pa_benefits_py)+p(data.pa_other_py);
  const oblFields = ["ob_current_svc","ob_interest","ob_actuarial","ob_past_svc","ob_curtail"];
  const oblSubCy = oblFields.reduce((a,f)=>a+p(data[`${f}_cy`]),0); const oblSubPy = oblFields.reduce((a,f)=>a+p(data[`${f}_py`]),0);
  const oblNetCy = p(data.ob_begin_cy)+oblSubCy-p(data.ob_capitalised_cy); const oblNetPy = p(data.ob_begin_py)+oblSubPy-p(data.ob_capitalised_py);
  return (<div className="space-y-6 max-w-4xl">
    <Card><CardHeader><CardTitle className="text-base">Disclosure Pursuant to Para 47 of AS 15 — Short Term Employee Benefits</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><NoteTableHeader /><tbody>
        <TwoColRow label="(i) Wages and Salaries" prefix="stb_wages" cy={data.stb_wages_cy||""} py={data.stb_wages_py||""} onChange={onChange} />
        <TwoColRow label="(ii) Paid Annual Leave" prefix="stb_leave" cy={data.stb_leave_cy||""} py={data.stb_leave_py||""} onChange={onChange} />
        <TwoColRow label="(iii) Profit Sharing and Bonus payments" prefix="stb_bonus" cy={data.stb_bonus_cy||""} py={data.stb_bonus_py||""} onChange={onChange} />
        <TwoColRow label="(iv) Perquisites — Medical Care, Housing, Cars" prefix="stb_perquisites" cy={data.stb_perquisites_cy||""} py={data.stb_perquisites_py||""} onChange={onChange} />
        <TwoColRow label="(v) Defined Contribution Plans" prefix="stb_contrib" cy={data.stb_contrib_cy||""} py={data.stb_contrib_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">Total</td><td className="py-2 px-2 text-right text-sm">{fmt(stbSumCy)||"—"}</td><td className="py-2 px-2 text-right text-sm">{fmt(stbSumPy)||"—"}</td></tr>
        <TwoColRow label="Of this, Payments to KMP" prefix="stb_kmp" cy={data.stb_kmp_cy||""} py={data.stb_kmp_py||""} onChange={onChange} />
      </tbody></table>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Disclosure Pursuant to Para 55 of AS 15 — Defined Benefit Plan Liability</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><NoteTableHeader /><tbody>
        <TwoColRow label="(i) PV of Defined Benefit Obligation" prefix="dbp_pv" cy={data.dbp_pv_cy||""} py={data.dbp_pv_py||""} onChange={onChange} />
        <TwoColRow label="(ii) Less unvested Past service cost" prefix="dbp_unvested" cy={data.dbp_unvested_cy||""} py={data.dbp_unvested_py||""} onChange={onChange} />
        <TwoColRow label="(iii) Less Fair Value of Plan Assets" prefix="dbp_fv" cy={data.dbp_fv_cy||""} py={data.dbp_fv_py||""} onChange={onChange} />
      </tbody></table>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Defined Benefit Plan Expense (Para 61 & 92 of AS 15)</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><SNoTableHeader /><tbody>
        <SNoRow sno="(i)" label="Current Service Cost" prefix="exp_current_svc" data={data} onChange={onChange} />
        <SNoRow sno="(ii)" label="Interest Cost" prefix="exp_interest" data={data} onChange={onChange} />
        <SNoRow sno="(iii)" label="Expected return on Plan Asset" prefix="exp_return" data={data} onChange={onChange} />
        <SNoRow sno="(iv)" label="Actuarial Gains or Losses" prefix="exp_actuarial" data={data} onChange={onChange} />
        <SNoRow sno="(v)" label="Past Service Cost (if any)" prefix="exp_past_svc" data={data} onChange={onChange} />
        <SNoRow sno="(vi)" label="Curtailments or settlements" prefix="exp_curtail" data={data} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td colSpan={2} className="py-2 px-3 text-sm">Sub-total</td><td className="py-2 px-2 text-right text-sm">{fmt(expSubCy)}</td><td className="py-2 px-2 text-right text-sm">{fmt(expSubPy)}</td></tr>
        <SNoRow sno="" label="Less: Amount capitalised in PPE or Inventory" prefix="exp_capitalised" data={data} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td colSpan={2} className="py-2 px-3 text-sm">Net expense recognised in P&L</td><td className="py-2 px-2 text-right text-sm">{fmt(expNetCy)}</td><td className="py-2 px-2 text-right text-sm">{fmt(expNetPy)}</td></tr>
      </tbody></table>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Reconciliation (Para 119–123) — Plan Assets & Obligations</CardTitle></CardHeader><CardContent className="space-y-4">
      <h4 className="text-sm font-semibold">Movement in Plan Assets</h4>
      <table className="w-full border border-border rounded-md overflow-hidden"><NoteTableHeader /><tbody>
        {[{l:"(a) FV at beginning",k:"pa_begin"},{l:"(b) Actual Return",k:"pa_return"},{l:"(c) Contributions",k:"pa_contrib"},{l:"(d) Benefits paid (deduct)",k:"pa_benefits"},{l:"(e) Any other change",k:"pa_other"}].map(r=><TwoColRow key={r.k} label={r.l} prefix={r.k} cy={data[`${r.k}_cy`]||""} py={data[`${r.k}_py`]||""} onChange={onChange} />)}
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">(f) FV at end of period</td><td className="py-2 px-2 text-right text-sm">{fmt(fvEndCy)}</td><td className="py-2 px-2 text-right text-sm">{fmt(fvEndPy)}</td></tr>
      </tbody></table>
      <h4 className="text-sm font-semibold">Movement in Obligations</h4>
      <table className="w-full border border-border rounded-md overflow-hidden"><NoteTableHeader /><tbody>
        <TwoColRow label="(g) Obligations at beginning" prefix="ob_begin" cy={data.ob_begin_cy||""} py={data.ob_begin_py||""} onChange={onChange} />
        {oblFields.map(f=><TwoColRow key={f} label={f.replace("ob_","").replace(/_/g," ")} prefix={f} cy={data[`${f}_cy`]||""} py={data[`${f}_py`]||""} onChange={onChange} />)}
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">Sub-total (h)–(l)</td><td className="py-2 px-2 text-right text-sm">{fmt(oblSubCy)}</td><td className="py-2 px-2 text-right text-sm">{fmt(oblSubPy)}</td></tr>
        <TwoColRow label="Less: capitalised in PPE" prefix="ob_capitalised" cy={data.ob_capitalised_cy||""} py={data.ob_capitalised_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">(m) Net obligation at end</td><td className="py-2 px-2 text-right text-sm">{fmt(oblNetCy)}</td><td className="py-2 px-2 text-right text-sm">{fmt(oblNetPy)}</td></tr>
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">(n) Liability (obligation {">"} FV)</td><td className="py-2 px-2 text-right text-sm">{fmt(oblNetCy>fvEndCy?oblNetCy-fvEndCy:0)}</td><td className="py-2 px-2 text-right text-sm">{fmt(oblNetPy>fvEndPy?oblNetPy-fvEndPy:0)}</td></tr>
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">(o) Asset (FV {">"} obligation)</td><td className="py-2 px-2 text-right text-sm">{fmt(fvEndCy>oblNetCy?fvEndCy-oblNetCy:0)}</td><td className="py-2 px-2 text-right text-sm">{fmt(fvEndPy>oblNetPy?fvEndPy-oblNetPy:0)}</td></tr>
      </tbody></table>
    </CardContent></Card>
  </div>);
}

function Note35({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const balCy = p(data.total_cy)-p(data.capitalised_cy); const balPy = p(data.total_py)-p(data.capitalised_py);
  return (<div className="max-w-4xl"><Card><CardHeader><CardTitle className="text-base">Borrowing costs included in P&L — Rs/rounded off</CardTitle></CardHeader><CardContent>
    <table className="w-full border border-border rounded-md overflow-hidden"><SNoTableHeader /><tbody>
      <SNoRow sno="(i)" label="Total borrowing costs incurred" prefix="total" data={data} onChange={onChange} />
      <SNoRow sno="(ii)" label="Of which costs capitalised" prefix="capitalised" data={data} onChange={onChange} />
      <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm text-muted-foreground">(iii)</td><td className="py-2 px-3 text-sm">Balance charged to P&L</td><td className="py-2 px-2 text-right text-sm">{fmt(balCy)}</td><td className="py-2 px-2 text-right text-sm">{fmt(balPy)}</td></tr>
    </tbody></table>
  </CardContent></Card></div>);
}

/* ══════════════════════════════════════════════
   NOTE 36 — SEGMENT REPORTING
   ══════════════════════════════════════════════ */
function Note36({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const segRevFields = ["seg_rev_a","seg_rev_b","seg_rev_unalloc"];
  const segResFields = ["seg_res_a","seg_res_b","seg_res_unalloc"];
  const assetFields = ["seg_assets","seg_assets_unalloc"];
  const liabFields = ["seg_liab","seg_liab_unalloc"];
  const geoRevFields = ["geo_rev_a","geo_rev_b","geo_rev_unalloc"];
  const geoAssetFields = ["geo_assets","geo_assets_unalloc"];
  const geoLiabFields = ["geo_liab","geo_liab_unalloc"];
  const autoSum = (fields: string[], suffix: string) => fields.reduce((a,f) => a+p(data[`${f}_${suffix}`]),0);

  return (<div className="space-y-6 max-w-4xl">
    <Card><CardHeader><CardTitle className="text-base">Part I: Business Segment — Rs/Rounded off</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><NoteTableHeader /><tbody>
        <tr className="bg-muted/20 border-b border-border"><td className="py-2 px-3 text-sm font-semibold" colSpan={3}>Segment Revenue</td></tr>
        <TwoColRow label="a) Segment A" prefix="seg_rev_a" cy={data.seg_rev_a_cy||""} py={data.seg_rev_a_py||""} onChange={onChange} />
        <TwoColRow label="b) Segment B" prefix="seg_rev_b" cy={data.seg_rev_b_cy||""} py={data.seg_rev_b_py||""} onChange={onChange} />
        <TwoColRow label="c) Intra-segment (Other unallocated)" prefix="seg_rev_unalloc" cy={data.seg_rev_unalloc_cy||""} py={data.seg_rev_unalloc_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">d) Total</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(segRevFields,"cy"))}</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(segRevFields,"py"))}</td></tr>
        <tr className="bg-muted/20 border-b border-border"><td className="py-2 px-3 text-sm font-semibold" colSpan={3}>Segment Result</td></tr>
        <TwoColRow label="a) Segment A" prefix="seg_res_a" cy={data.seg_res_a_cy||""} py={data.seg_res_a_py||""} onChange={onChange} />
        <TwoColRow label="b) Segment B" prefix="seg_res_b" cy={data.seg_res_b_cy||""} py={data.seg_res_b_py||""} onChange={onChange} />
        <TwoColRow label="c) Intra-segment (Other unallocated)" prefix="seg_res_unalloc" cy={data.seg_res_unalloc_cy||""} py={data.seg_res_unalloc_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">d) Total</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(segResFields,"cy"))}</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(segResFields,"py"))}</td></tr>
        <TwoColRow label="Impairment losses recognised in P&L : A" prefix="imp_a" cy={data.imp_a_cy||""} py={data.imp_a_py||""} onChange={onChange} />
        <TwoColRow label="Impairment losses recognised in P&L : B" prefix="imp_b" cy={data.imp_b_cy||""} py={data.imp_b_py||""} onChange={onChange} />
        <TwoColRow label="Impairment losses reversed in RR - A" prefix="imp_rev_a" cy={data.imp_rev_a_cy||""} py={data.imp_rev_a_py||""} onChange={onChange} />
        <TwoColRow label="Impairment losses reversed in RR - B" prefix="imp_rev_b" cy={data.imp_rev_b_cy||""} py={data.imp_rev_b_py||""} onChange={onChange} />
        <TwoColRow label="Segment Assets (total)" prefix="seg_assets" cy={data.seg_assets_cy||""} py={data.seg_assets_py||""} onChange={onChange} />
        <TwoColRow label="Other unallocated assets" prefix="seg_assets_unalloc" cy={data.seg_assets_unalloc_cy||""} py={data.seg_assets_unalloc_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">Total assets as per BS</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(assetFields,"cy"))}</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(assetFields,"py"))}</td></tr>
        <TwoColRow label="Segment Liabilities (total)" prefix="seg_liab" cy={data.seg_liab_cy||""} py={data.seg_liab_py||""} onChange={onChange} />
        <TwoColRow label="Other unallocated liabilities" prefix="seg_liab_unalloc" cy={data.seg_liab_unalloc_cy||""} py={data.seg_liab_unalloc_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">Total liabilities as per BS</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(liabFields,"cy"))}</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(liabFields,"py"))}</td></tr>
        <TwoColRow label="Cost of assets acquired (PPE)" prefix="acq_ppe" cy={data.acq_ppe_cy||""} py={data.acq_ppe_py||""} onChange={onChange} />
        <TwoColRow label="Cost of assets acquired (Intangible assets)" prefix="acq_intangible" cy={data.acq_intangible_cy||""} py={data.acq_intangible_py||""} onChange={onChange} />
        <TwoColRow label="Depreciation on all depreciable segment assets" prefix="seg_dep" cy={data.seg_dep_cy||""} py={data.seg_dep_py||""} onChange={onChange} />
        <TwoColRow label="Non-cash expenses (other than depreciation)" prefix="non_cash" cy={data.non_cash_cy||""} py={data.non_cash_py||""} onChange={onChange} />
      </tbody></table>
      <p className="text-xs text-muted-foreground mt-2 italic">(RR means Revaluation Reserve)</p>
      <div className="mt-4 space-y-2">
        {["(i) Primary format is Business Segment","(ii) There are no PPE or Intangible Assets allocable to geographical segment specifically","(v) There are no separate products for Geographical Segment","(vi) Borrowing Costs are not included in Inventory"].map(t => <p key={t} className="text-xs text-muted-foreground">{t}</p>)}
        <div><label className="text-xs font-medium">(iii) Products in Business Segment A are:</label><Input value={data.seg_a_products||""} onChange={e=>onChange("seg_a_products",e.target.value)} className="h-8 mt-1" /></div>
        <div><label className="text-xs font-medium">(iv) Products in Business Segment B are:</label><Input value={data.seg_b_products||""} onChange={e=>onChange("seg_b_products",e.target.value)} className="h-8 mt-1" /></div>
      </div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Part II: Geographical Segment — Rs/Rounded off</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><NoteTableHeader /><tbody>
        <tr className="bg-muted/20 border-b border-border"><td className="py-2 px-3 text-sm font-semibold" colSpan={3}>Segment Revenue</td></tr>
        <TwoColRow label="a) Segment A" prefix="geo_rev_a" cy={data.geo_rev_a_cy||""} py={data.geo_rev_a_py||""} onChange={onChange} />
        <TwoColRow label="b) Segment B (if any)" prefix="geo_rev_b" cy={data.geo_rev_b_cy||""} py={data.geo_rev_b_py||""} onChange={onChange} />
        <TwoColRow label="c) Intra-segment (Other unallocated)" prefix="geo_rev_unalloc" cy={data.geo_rev_unalloc_cy||""} py={data.geo_rev_unalloc_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">d) Total</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(geoRevFields,"cy"))}</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(geoRevFields,"py"))}</td></tr>
        <TwoColRow label="Segment Assets (total)" prefix="geo_assets" cy={data.geo_assets_cy||""} py={data.geo_assets_py||""} onChange={onChange} />
        <TwoColRow label="Other unallocated assets" prefix="geo_assets_unalloc" cy={data.geo_assets_unalloc_cy||""} py={data.geo_assets_unalloc_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">Total assets as per BS</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(geoAssetFields,"cy"))}</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(geoAssetFields,"py"))}</td></tr>
        <TwoColRow label="Segment Liabilities (total)" prefix="geo_liab" cy={data.geo_liab_cy||""} py={data.geo_liab_py||""} onChange={onChange} />
        <TwoColRow label="Other unallocated liabilities" prefix="geo_liab_unalloc" cy={data.geo_liab_unalloc_cy||""} py={data.geo_liab_unalloc_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">Total liabilities as per BS</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(geoLiabFields,"cy"))}</td><td className="py-2 px-2 text-right text-sm">{fmt(autoSum(geoLiabFields,"py"))}</td></tr>
      </tbody></table>
    </CardContent></Card>
  </div>);
}

/* ══════════════════════════════════════════════
   NOTE 37 — RELATED PARTIES
   ══════════════════════════════════════════════ */
function Note37({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const rpRows = ["Purchases","Sales","Acquisition of PPE","Acquisition of Intangibles","Advances to Directors","Loans and advances to associates","Loans and advances to JV","Any other item","Total amount recoverable from related parties","Of which amount due if any on reporting date from KMP","Total amount payable to related parties","Provisions if any made","Amount if any written off during the year"];
  const kmpFields = ["kmp_remuneration","kmp_sitting","kmp_contrib"];
  const kmpSumCy = kmpFields.reduce((a,f)=>a+p(data[`${f}_cy`]),0); const kmpSumPy = kmpFields.reduce((a,f)=>a+p(data[`${f}_py`]),0);
  return (<div className="space-y-6 max-w-5xl">
    <Card><CardHeader><CardTitle className="text-base">Subsidiaries (where control exists)</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden text-sm"><thead><tr className="bg-muted/50"><th className="py-2 px-2 w-10"></th><th className="py-2 px-2">CY Name</th><th className="py-2 px-2">CY Fully/Partly owned</th><th className="py-2 px-2">PY Name</th><th className="py-2 px-2">PY Fully/Partly owned</th></tr></thead><tbody>
        {["a","b","c","d","e"].map(r => (
          <tr key={r} className="border-b border-border"><td className="py-1 px-2 text-muted-foreground">({r})</td>
            <td className="py-1 px-1"><TextInput value={data[`sub_${r}_cy_name`]||""} onChange={v=>onChange(`sub_${r}_cy_name`,v)} /></td>
            <td className="py-1 px-1"><TextInput value={data[`sub_${r}_cy_owned`]||""} onChange={v=>onChange(`sub_${r}_cy_owned`,v)} /></td>
            <td className="py-1 px-1"><TextInput value={data[`sub_${r}_py_name`]||""} onChange={v=>onChange(`sub_${r}_py_name`,v)} /></td>
            <td className="py-1 px-1"><TextInput value={data[`sub_${r}_py_owned`]||""} onChange={v=>onChange(`sub_${r}_py_owned`,v)} /></td>
          </tr>))}
      </tbody></table>
    </CardContent></Card>
    {["cy","py"].map(year => (
      <Card key={year}><CardHeader><CardTitle className="text-base">Transactions ({year==="cy"?"Current Year":"Previous Year"}) — Pursuant to Paragraph 23 of AS 18</CardTitle></CardHeader><CardContent>
        <table className="w-full border border-border rounded-md overflow-hidden text-sm"><thead><tr className="bg-muted/50"><th className="py-2 px-2 w-8">#</th><th className="py-2 px-2">Nature of transaction</th><th className="py-2 px-2">Name of Party</th><th className="py-2 px-2">Relationship</th><th className="py-2 px-2 w-32">Amount (₹)</th></tr></thead><tbody>
          {rpRows.map((label,i) => (
            <tr key={i} className="border-b border-border"><td className="py-1 px-2 text-muted-foreground">{i+1}</td><td className="py-1 px-2 text-sm">{label}</td>
              <td className="py-1 px-1"><TextInput value={data[`rp_${year}_${i}_party`]||""} onChange={v=>onChange(`rp_${year}_${i}_party`,v)} /></td>
              <td className="py-1 px-1"><TextInput value={data[`rp_${year}_${i}_rel`]||""} onChange={v=>onChange(`rp_${year}_${i}_rel`,v)} /></td>
              <td className="py-1 px-1"><NoteInput value={data[`rp_${year}_${i}_amt`]||""} onChange={v=>onChange(`rp_${year}_${i}_amt`,v)} /></td>
            </tr>))}
        </tbody></table>
        <p className="text-xs text-muted-foreground mt-2 italic">Notes: (i) Items of similar nature have been aggregated where appropriate, taking the threshold of 10%</p>
      </CardContent></Card>
    ))}
    <Card><CardHeader><CardTitle className="text-base">Payments to KMP</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><NoteTableHeader /><tbody>
        <TwoColRow label="(a) Remuneration as per Companies Act" prefix="kmp_remuneration" cy={data.kmp_remuneration_cy||""} py={data.kmp_remuneration_py||""} onChange={onChange} />
        <TwoColRow label="(b) Sitting Fees" prefix="kmp_sitting" cy={data.kmp_sitting_cy||""} py={data.kmp_sitting_py||""} onChange={onChange} />
        <TwoColRow label="(c) Defined Contribution Plans" prefix="kmp_contrib" cy={data.kmp_contrib_cy||""} py={data.kmp_contrib_py||""} onChange={onChange} />
        <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">Total</td><td className="py-2 px-2 text-right text-sm">{fmt(kmpSumCy)}</td><td className="py-2 px-2 text-right text-sm">{fmt(kmpSumPy)}</td></tr>
      </tbody></table>
    </CardContent></Card>
  </div>);
}

/* ═══ NOTE 38 — LEASES ═══ */
function Note38({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const assets = ["Land","Buildings","P & M","Others 1","Others 2"];
  const periods = ["< one year","1 year < 5 years","> Five years"];
  return (<div className="space-y-6 max-w-5xl">
    <Card><CardHeader><CardTitle className="text-base">Disclosures pursuant to Paragraph 22(a) to (f) (Lessee - Finance Lease)</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden text-sm"><thead><tr className="bg-muted/50"><th className="py-2 px-2">Asset</th><th className="py-2 px-2">CY Net carrying</th><th className="py-2 px-2">CY Contingent rent</th><th className="py-2 px-2">PY Net carrying</th><th className="py-2 px-2">PY Contingent rent</th></tr></thead><tbody>
        {assets.map((a,i) => (<tr key={i} className="border-b border-border"><td className="py-1 px-2">{a}</td>
          <td className="py-1 px-1"><NoteInput value={data[`fl_${i}_cy_net`]||""} onChange={v=>onChange(`fl_${i}_cy_net`,v)} /></td>
          <td className="py-1 px-1"><NoteInput value={data[`fl_${i}_cy_cont`]||""} onChange={v=>onChange(`fl_${i}_cy_cont`,v)} /></td>
          <td className="py-1 px-1"><NoteInput value={data[`fl_${i}_py_net`]||""} onChange={v=>onChange(`fl_${i}_py_net`,v)} /></td>
          <td className="py-1 px-1"><NoteInput value={data[`fl_${i}_py_cont`]||""} onChange={v=>onChange(`fl_${i}_py_cont`,v)} /></td>
        </tr>))}
      </tbody></table>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Break-up of Minimum lease-payments (Lessee Finance lease)</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden text-sm"><thead><tr className="bg-muted/50"><th className="py-2 px-2">Period</th><th className="py-2 px-2">CY Min Lease</th><th className="py-2 px-2">CY Present Value</th><th className="py-2 px-2">CY Future finance</th><th className="py-2 px-2">PY Min Lease</th><th className="py-2 px-2">PY Present Value</th><th className="py-2 px-2">PY Future finance</th></tr></thead><tbody>
        {periods.map((pr,i) => (<tr key={i} className="border-b border-border"><td className="py-1 px-2">{pr}</td>
          {["cy_min","cy_pv","cy_ff","py_min","py_pv","py_ff"].map(k => <td key={k} className="py-1 px-1"><NoteInput value={data[`ml_${i}_${k}`]||""} onChange={v=>onChange(`ml_${i}_${k}`,v)} /></td>)}
        </tr>))}
      </tbody></table>
    </CardContent></Card>
  </div>);
}

/* ═══ NOTE 39 — EARNINGS PER SHARE ═══ */
function Note39({ data, onChange, engagementId }: { data: any; onChange: (f: string, v: string) => void; engagementId: string }) {
  const aCy = p(data.eps_pat_cy)-p(data.eps_pref_nc_cy)-p(data.eps_pref_cum_cy);
  const aPy = p(data.eps_pat_py)-p(data.eps_pref_nc_py)-p(data.eps_pref_cum_py);
  const epsCy = p(data.eps_shares_cy)?aCy/p(data.eps_shares_cy):0;
  const epsPy = p(data.eps_shares_py)?aPy/p(data.eps_shares_py):0;
  return (<div className="max-w-4xl"><Card><CardHeader><CardTitle className="text-base">Disclosure pursuant to Paragraph 9</CardTitle></CardHeader><CardContent>
    <table className="w-full border border-border rounded-md overflow-hidden"><SNoTableHeader /><tbody>
      <SNoRow sno="(i)" label="Net Profit After Tax (as per P&L)" prefix="eps_pat" data={data} onChange={onChange} />
      <SNoRow sno="(ii)" label="Less Preference Dividend (non-cumulative)" prefix="eps_pref_nc" data={data} onChange={onChange} />
      <SNoRow sno="(iii)" label="Less Preference Dividend (cumulative)" prefix="eps_pref_cum" data={data} onChange={onChange} />
      <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3"></td><td className="py-2 px-3 text-sm">Amount attributable to shareholders (A)</td><td className="py-2 px-2 text-right text-sm">{fmt(aCy)}</td><td className="py-2 px-2 text-right text-sm">{fmt(aPy)}</td></tr>
      <SNoRow sno="" label="Weighted Average Number of equity shares (B)" prefix="eps_shares" data={data} onChange={onChange} />
      <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3"></td><td className="py-2 px-3 text-sm">A ÷ B = Basic EPS</td><td className="py-2 px-2 text-right text-sm">{epsCy?epsCy.toFixed(2):"—"}</td><td className="py-2 px-2 text-right text-sm">{epsPy?epsPy.toFixed(2):"—"}</td></tr>
      <SNoRow sno="" label="Diluted EPS" prefix="eps_diluted" data={data} onChange={onChange} />
      <SNoRow sno="" label="Nominal value per share" prefix="eps_nominal" data={data} onChange={onChange} />
    </tbody></table>
  </CardContent></Card></div>);
}

/* ═══ NOTE 40 — DEFERRED TAX ═══ */
function Note40({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const defaultRows = ["PPE","MAT credit entitlement","Bonus Disallowances","TDS Disallowances"];
  const customRows: string[] = data.custom_rows || [];
  const allRows = [...defaultRows, ...customRows];
  const totalCy = allRows.reduce((a,_,i)=>a+p(data[`dt_${i}_cy`]),0); const totalPy = allRows.reduce((a,_,i)=>a+p(data[`dt_${i}_py`]),0);
  return (<div className="max-w-4xl"><Card><CardHeader><CardTitle className="text-base">Disclosures Pursuant to Paragraphs 31 and 32 of AS 22</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">The tax effects of significant timing differences that resulted in deferred tax liabilities (or deferred tax assets) and a description of the items that created these differences is given below:</p>
    <table className="w-full border border-border rounded-md overflow-hidden"><thead><tr className="bg-muted/50"><th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Timing difference item</th><th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">Current Year</th><th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-40">Prev. Year</th></tr></thead><tbody>
      <tr className="bg-muted/20 border-b border-border"><td className="py-2 px-3 text-sm font-medium" colSpan={3}>Timing differences (leading to asset)</td></tr>
      {allRows.map((label,i) => (<tr key={i} className="border-b border-border"><td className="py-2 px-3 text-sm">{label}</td>
        <td className="py-1 px-2"><NoteInput value={data[`dt_${i}_cy`]||""} onChange={v=>onChange(`dt_${i}_cy`,v)} /></td>
        <td className="py-1 px-2"><NoteInput value={data[`dt_${i}_py`]||""} onChange={v=>onChange(`dt_${i}_py`,v)} /></td>
      </tr>))}
      <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-3 text-sm">Net DTA or Net DTL</td><td className="py-2 px-2 text-right text-sm">{fmt(totalCy)}</td><td className="py-2 px-2 text-right text-sm">{fmt(totalPy)}</td></tr>
    </tbody></table>
    <Button variant="outline" size="sm" onClick={() => onChange("custom_rows", JSON.stringify([...customRows, `Item ${customRows.length+5}`]))}><Plus className="h-3 w-3 mr-1" /> Add item</Button>
  </CardContent></Card></div>);
}

/* ═══ NOTE 41 — DISCONTINUING OPERATIONS ═══ */
function Note41({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const partARows = [{l:"(a) Nature of operations discontinued",k:"do_nature"},{l:"(b) Segment to which that activity belongs",k:"do_segment"},{l:"(c) Disclosure Event date and nature",k:"do_event"},{l:"(d) Carrying amount of assets of DO",k:"do_assets"},{l:"(e) Carrying amount of liabilities of DO",k:"do_liab"},{l:"(f) Revenue earned from DO",k:"do_revenue"},{l:"(g) Expenses attributable to DO",k:"do_expenses"},{l:"(h) Extraordinary items if any",k:"do_extraordinary"},{l:"(i) Pre-tax profit",k:"do_pretax"},{l:"(j) Tax Expenses (DTA or DTL) total",k:"do_tax"},{l:"(k) Net cash flows pertaining to DO",k:"do_cashflows"}];
  const partBRows = [{l:"Sale or disposal proceeds",k:"do_sale_proceeds"},{l:"Carrying amount of DO",k:"do_sale_carrying"},{l:"Gain or Loss",k:"do_sale_gl"},{l:"Tax Expense",k:"do_sale_tax"},{l:"Post tax gain or loss",k:"do_sale_posttax"},{l:"Carrying amount of DO for agreement",k:"do_agr_carrying"},{l:"Expected Estimated price",k:"do_agr_price"},{l:"Expected timing of cash receipt",k:"do_agr_timing"}];
  const partCRows = [{l:"Timing when abandonment decision was taken",k:"do_ab_timing"},{l:"Reason for the decision to abandon",k:"do_ab_reason"},{l:"Effect of this decision",k:"do_ab_effect"}];
  return (<div className="space-y-6 max-w-4xl">
    <Card><CardHeader><CardTitle className="text-base">Part A: Initial Disclosure — Pursuant to Paragraph 20 of AS 24</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><thead><tr className="bg-muted/50"><th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Narrative</th><th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-36">Current Year</th><th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-36">Previous Year</th></tr></thead><tbody>
        {partARows.map(r => <TwoColRow key={r.k} label={r.l} prefix={r.k} cy={data[`${r.k}_cy`]||""} py={data[`${r.k}_py`]||""} onChange={onChange} />)}
      </tbody></table>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Part B: Second stage Disclosure — Pursuant to Paragraph 23 of AS 24</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><NoteTableHeader /><tbody>
        {partBRows.map(r => <TwoColRow key={r.k} label={r.l} prefix={r.k} cy={data[`${r.k}_cy`]||""} py={data[`${r.k}_py`]||""} onChange={onChange} />)}
      </tbody></table>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Part C: Third stage — Abandonment (Pursuant to Paragraph 29 of AS 24)</CardTitle></CardHeader><CardContent>
      <table className="w-full border border-border rounded-md overflow-hidden"><NoteTableHeader /><tbody>
        {partCRows.map(r => <TwoColRow key={r.k} label={r.l} prefix={r.k} cy={data[`${r.k}_cy`]||""} py={data[`${r.k}_py`]||""} onChange={onChange} />)}
      </tbody></table>
    </CardContent></Card>
  </div>);
}

/* ═══ NOTE 42 — INTANGIBLE ASSETS ═══ */
function Note42({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const cols = [data.ia_col1||"Acquired Item 1",data.ia_col2||"Acquired Item 2",data.ia_col3||"Self Generated Item A",data.ia_col4||"Self Generated Item B"];
  const rows = ["Gross carrying amount Opening","Additions","Retired from use","Other deletions","Amortisation amount for the year","Impairment losses","Impairment reversals","Other changes"];
  return (<div className="max-w-5xl"><Card><CardHeader><CardTitle className="text-base">Gross Carrying Amount reconciliation</CardTitle></CardHeader><CardContent>
    <div className="flex gap-2 mb-3">{cols.map((c,i) => <div key={i} className="flex-1"><label className="text-xs text-muted-foreground">Column {i+1}</label><Input value={c} onChange={e=>onChange(`ia_col${i+1}`,e.target.value)} className="h-7 text-xs" /></div>)}</div>
    <table className="w-full border border-border rounded-md overflow-hidden text-sm"><thead><tr className="bg-muted/50"><th className="py-2 px-2 text-left text-xs font-semibold text-muted-foreground">Row</th>{cols.map((c,i) => <th key={i} className="py-2 px-2 text-right text-xs font-semibold text-muted-foreground">{c}</th>)}</tr></thead><tbody>
      {rows.map((r,ri) => (<tr key={ri} className="border-b border-border"><td className="py-1 px-2">{r}</td>{cols.map((_,ci)=><td key={ci} className="py-1 px-1"><NoteInput value={data[`ia_${ri}_${ci}`]||""} onChange={v=>onChange(`ia_${ri}_${ci}`,v)} /></td>)}</tr>))}
      <tr className="border-b border-border bg-muted/30 font-semibold"><td className="py-2 px-2">Closing balance</td>
        {cols.map((_,ci)=>{const val=p(data[`ia_0_${ci}`])+p(data[`ia_1_${ci}`])-p(data[`ia_2_${ci}`])-p(data[`ia_3_${ci}`])-p(data[`ia_4_${ci}`])-p(data[`ia_5_${ci}`])+p(data[`ia_6_${ci}`])+p(data[`ia_7_${ci}`]);return <td key={ci} className="py-2 px-2 text-right">{fmt(val)}</td>})}
      </tr>
    </tbody></table>
    <p className="text-xs text-muted-foreground mt-2 italic">Note: There are no Intangible Assets that have been fully and totally amortised</p>
    <p className="text-xs text-muted-foreground italic">Note 2: Disclosures relating to impairment losses, or reversals not applicable to Level IV</p>
  </CardContent></Card></div>);
}

/* ═══ NOTE 43 — IMPAIRMENT OF ASSETS ═══ */
function Note43({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  const rowCount = Math.max(3, p(data.imp_row_count)||3);
  return (<div className="max-w-5xl"><Card><CardHeader><CardTitle className="text-base">a. Disclosures pursuant to Para 117 of AS 28 — Impairment provisions</CardTitle></CardHeader><CardContent className="space-y-4">
    <table className="w-full border border-border rounded-md overflow-hidden text-sm"><thead><tr className="bg-muted/50"><th className="py-2 px-2">Opening</th><th className="py-2 px-2">Losses in P&L</th><th className="py-2 px-2">Reversals in P&L</th><th className="py-2 px-2">Losses in RR</th><th className="py-2 px-2">Reversals in RR</th><th className="py-2 px-2">Closing</th></tr></thead><tbody>
      {Array.from({length:rowCount}).map((_,i) => {
        const closing = p(data[`imp_${i}_opening`])+p(data[`imp_${i}_loss_pl`])-p(data[`imp_${i}_rev_pl`])+p(data[`imp_${i}_loss_rr`])-p(data[`imp_${i}_rev_rr`]);
        return (<tr key={i} className="border-b border-border">
          {["opening","loss_pl","rev_pl","loss_rr","rev_rr"].map(k=><td key={k} className="py-1 px-1"><NoteInput value={data[`imp_${i}_${k}`]||""} onChange={v=>onChange(`imp_${i}_${k}`,v)} /></td>)}
          <td className="py-1 px-2 text-right font-medium">{fmt(closing)}</td>
        </tr>)})}
    </tbody></table>
    <Button variant="outline" size="sm" onClick={() => onChange("imp_row_count", String(rowCount+1))}><Plus className="h-3 w-3 mr-1" /> Add row</Button>
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>b) Disclosure pursuant to Paragraph 121 — For estimating impairment loss, it is assumed that the entity as a whole is a Cash Generating Unit (CGU).</p>
      <p>c) Disclosure pursuant to Paragraph 121(v) — Recoverable amount of the Asset where applicable has been taken at net selling price.</p>
      <p>d) Disclosure pursuant to Paragraph 122 — Impairment losses recognised or reversed during the current reporting period is not material for the financial statement as a whole.</p>
    </div>
  </CardContent></Card></div>);
}

/* ═══ NOTE 44 — EVENTS AFTER REPORTING PERIOD ═══ */
function Note44({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (<div className="max-w-3xl"><Card><CardHeader><CardTitle className="text-base">Note No : 44 Events after the Reporting Period</CardTitle></CardHeader><CardContent>
    <Textarea value={data.text || "There are no significant events after the reporting period except as disclosed in note 20(f), that require adjustments or disclosures in the standalone Ind AS financial statements as on the balance sheet date."} onChange={e=>onChange("text",e.target.value)} rows={4} />
  </CardContent></Card></div>);
}

/* ═══ NOTE 45 — PREVIOUS YEAR FIGURES ═══ */
function Note45({ data, onChange }: { data: any; onChange: (f: string, v: string) => void }) {
  return (<div className="max-w-3xl"><Card><CardHeader><CardTitle className="text-base">Note No : 45 Previous Year Figures</CardTitle></CardHeader><CardContent>
    <Textarea value={data.text || "The figures for the corresponding previous year have been regrouped/ reclassified, wherever considered necessary, to make them comparable with current years classification."} onChange={e=>onChange("text",e.target.value)} rows={3} />
  </CardContent></Card></div>);
}

/* ══════════════════════════════════════════════
   PRINT VIEW
   ══════════════════════════════════════════════ */
function PrintView({ notes, onClose }: { notes: Record<string, [any, any]>; onClose: () => void }) {
  useEffect(() => { setTimeout(() => window.print(), 500); }, []);
  const printRow = (label: string, cy: any, py: any) => (
    <tr className="border-b border-border"><td className="py-1 px-2 text-[9pt]">{label}</td><td className="py-1 px-2 text-right text-[9pt]">{cy||"—"}</td><td className="py-1 px-2 text-right text-[9pt]">{py||"—"}</td></tr>
  );
  return (
    <div className="print-view bg-background">
      <style>{`
        @media print { @page { size: A4 portrait; margin: 2cm; } .no-print { display: none !important; } .page-break { page-break-before: always; } }
        .print-view table { border-collapse: collapse; width: 100%; font-size: 9pt; } .print-view th, .print-view td { border: 1px solid #ccc; padding: 4px 8px; }
        .print-view th { background: #f5f5f5; font-weight: 600; } @media print { footer { position: fixed; bottom: 0; width: 100%; font-size: 8pt; text-align: center; } }
      `}</style>
      <div className="no-print p-4 flex gap-2 border-b border-border">
        <Button variant="outline" size="sm" onClick={onClose}>← Back to Editor</Button>
        <Button size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print / Save as PDF</Button>
      </div>
      <div className="p-8 max-w-[210mm] mx-auto">
        <h1 className="text-center font-bold text-lg mb-1">Notes to Financial Statements</h1>
        <p className="text-center text-sm text-muted-foreground mb-6">Generated by CAFlow</p>

        {/* Note 1 */}
        <h2 className="font-bold text-sm mb-2">Note No : 1 Background</h2>
        <div className="text-[9pt] mb-4 space-y-1">
          <p><strong>Company:</strong> {notes.note_1[0].company_name || "—"}</p>
          <p><strong>Address:</strong> {notes.note_1[0].address || "—"}</p>
          <p><strong>Registration No:</strong> {notes.note_1[0].reg_number || "—"} | <strong>Incorporated:</strong> {notes.note_1[0].incorporation_date || "—"}</p>
          <p><strong>Principal Activity:</strong> {notes.note_1[0].principal_activity || "—"}</p>
        </div>

        {/* Note 2 */}
        <h2 className="font-bold text-sm mb-2">Note No : 2 Significant Accounting Policies</h2>
        <div className="text-[9pt] mb-4 space-y-2">
          {Object.entries(POLICY_TEXTS).map(([k,v]) => (
            <div key={k}><p className="font-semibold">{v.title}</p><p className="text-muted-foreground">{v.text}</p>
              {notes.note_2[0][`${k}_additional`] && <p className="italic mt-1">Additional: {notes.note_2[0][`${k}_additional`]}</p>}
            </div>
          ))}
        </div>

        {/* Notes 29-45 */}
        {NOTE_LIST.filter(n => parseInt(String(n.num)) >= 29).map(nl => {
          const d = notes[nl.key]?.[0] || {};
          const hasData = Object.values(d).some(v => v !== "" && v !== undefined && v !== null);
          return (
            <div key={nl.key} className={`mb-4 ${nl.num === 34 || nl.num === 37 ? "page-break" : ""}`}>
              <h2 className="font-bold text-sm mb-1">Note No : {nl.num} {nl.title}</h2>
              {!hasData ? <p className="text-[9pt] text-muted-foreground italic">NIL</p> : <p className="text-[9pt] text-muted-foreground">[Data filled — see detailed view]</p>}
            </div>
          );
        })}

        <footer className="mt-8 pt-4 border-t border-border text-center text-[8pt] text-muted-foreground">
          Generated by CAFlow | {new Date().toLocaleDateString("en-IN")}
        </footer>
      </div>
    </div>
  );
}
