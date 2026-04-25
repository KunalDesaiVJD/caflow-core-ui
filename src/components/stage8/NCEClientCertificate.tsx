/**
 * NCEClientCertificate — Client Certificate for Non-Corporate Entities
 * Stage 8 | Tab 5 | NCE only
 *
 * All paragraph body text is now manually editable (contentEditable textarea).
 * Editable fields persisted to nce_letters:
 *   letter_date, cash_on_hand, closing_stock, closing_stock_date
 *   + custom_content JSONB (para3..para9, closingLine overrides)
 *
 * Export: Excel only (Print / Export PDF removed).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, Loader2, FileSpreadsheet } from "lucide-react";
import { exportClientCertificate } from "@/lib/nceLetterExport";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
}

// ─── Default paragraph text (matches original hard-coded letter) ──────────────

const DEFAULTS = {
  para3: "Method of valuation is cost or market whichever is less. Quantitive detailes are maintained.",
  para4: "Method accounting is mercantile, which is same method which was employed in immediately preceding year.",
  para5: "We certify that there is no person/s to whom payments made to persons specified in section 40A(2)(b) except as shown in Form-3CD.",
  para6: "We certify that Fixed Assets are stated at cost as stated in books of accounts.",
  para7: "I have made every payments exceeding Rs.10000 relating to any expenditure covered under section 40A(3) by an a/c. payee cheque drawn on a bank or an a/c. payee bank draft only.",
  para8: "We here with inform and certify that the loan or deposit or specified advance taken or accepted or repaid for an amount of Rs.10000/- or more, during the year or earlier year/s was taken or accepted or repaid through account payee cheque or bank draft or ECS only.",
  para9: "We have accounted the entries in the books of accounts whenever the supporting proof are not available, we have prepared vouchers and we authenticate the same that all are for the business of the firm",
  closingLine: "You are requested to note the same.",
};

// ─── Helper: firms.address Json → string ─────────────────────────────────────

function formatFirmAddress(addr: unknown): string {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  const a = addr as Record<string, unknown>;
  return [a.line1, a.line2, a.street, a.city || a.district, a.state, a.pincode]
    .filter(Boolean)
    .join(", ");
}

const today = () => new Date().toISOString().slice(0, 10);

// ─── Inline number input (inside letter paragraph) ────────────────────────────

function InlineNum({
  value,
  onChange,
  placeholder = "0.00",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      min="0"
      step="0.01"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-32 border-0 border-b border-gray-700 bg-transparent text-sm text-center font-serif focus:outline-none focus:border-primary placeholder:text-gray-400"
    />
  );
}

// ─── Inline date input ────────────────────────────────────────────────────────

function InlineDate({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-0 border-b border-gray-700 bg-transparent text-sm font-serif focus:outline-none focus:border-primary"
    />
  );
}

// ─── Address fallback textarea ────────────────────────────────────────────────

function AddrFallback({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="my-1">
      <p className="text-xs text-orange-500 mb-0.5">{label} not on file — enter below:</p>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter address..."
        className="w-full border-0 border-b border-gray-400 bg-transparent resize-none text-sm font-serif text-gray-700 focus:outline-none focus:border-primary placeholder:text-gray-300"
      />
    </div>
  );
}

// ─── Editable paragraph textarea (auto-resize, letter-styled) ─────────────────

function EditablePara({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize on value change
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={[
        "w-full border-0 bg-transparent resize-none overflow-hidden",
        "font-serif text-sm text-gray-900 leading-relaxed",
        "focus:outline-none focus:bg-amber-50 rounded transition-colors",
        "px-1 -mx-1",
      ].join(" ")}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NCEClientCertificate({ engagementId }: Props) {
  // ── Engagement data ───────────────────────────────────────────────────────
  const [eng, setEng] = useState<any>(null);

  // ── Persisted structured fields ───────────────────────────────────────────
  const [letterDate,       setLetterDate]       = useState(today);
  const [cashOnHand,       setCashOnHand]       = useState("");
  const [closingStock,     setClosingStock]     = useState("");
  const [closingStockDate, setClosingStockDate] = useState("");

  // ── Editable paragraph content ────────────────────────────────────────────
  const [para3,       setPara3]       = useState(DEFAULTS.para3);
  const [para4,       setPara4]       = useState(DEFAULTS.para4);
  const [para5,       setPara5]       = useState(DEFAULTS.para5);
  const [para6,       setPara6]       = useState(DEFAULTS.para6);
  const [para7,       setPara7]       = useState(DEFAULTS.para7);
  const [para8,       setPara8]       = useState(DEFAULTS.para8);
  const [para9,       setPara9]       = useState(DEFAULTS.para9);
  const [closingLine, setClosingLine] = useState(DEFAULTS.closingLine);

  // ── Address overrides (local only) ────────────────────────────────────────
  const [clientAddrInput, setClientAddrInput] = useState("");
  const [firmAddrInput,   setFirmAddrInput]   = useState("");

  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [exporting,  setExporting]  = useState(false);

  // ── Derived auto-linked values ────────────────────────────────────────────
  const financialYear = (eng?.financial_year as string) || "";
  const clientName    = (eng?.clients?.name  as string) || "";
  const clientAddrDb  = (eng?.clients?.address as string) || "";
  const firmName      = ((eng?.firms?.display_name || eng?.firms?.name) as string) || "";
  const firmAddrDb    = formatFirmAddress(eng?.firms?.address);
  const firmFRN       = ((eng?.firms?.icai_firm_reg_no || eng?.firms?.icai_reg_no) as string) || "";

  const clientAddress = clientAddrDb || clientAddrInput;
  const firmAddress   = firmAddrDb   || firmAddrInput;

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data: engRow } = await supabase
        .from("audit_engagements")
        .select("*, clients(*), firms(*)")
        .eq("id", engagementId)
        .single();

      if (cancelled) return;
      if (engRow) setEng(engRow);

      const fy = (engRow?.financial_year as string) || "";
      if (!fy) { setLoading(false); return; }

      const { data: saved } = await (supabase as any)
        .from("nce_letters")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("financial_year", fy)
        .eq("letter_type", "client_certificate")
        .maybeSingle();

      if (!cancelled && saved) {
        if (saved.letter_date)           setLetterDate(saved.letter_date);
        if (saved.cash_on_hand != null)  setCashOnHand(String(saved.cash_on_hand));
        if (saved.closing_stock != null) setClosingStock(String(saved.closing_stock));
        if (saved.closing_stock_date)    setClosingStockDate(saved.closing_stock_date);

        // Restore any overridden paragraph text
        const cc = saved.custom_content as Record<string, string> | null;
        if (cc) {
          if (cc.para3)       setPara3(cc.para3);
          if (cc.para4)       setPara4(cc.para4);
          if (cc.para5)       setPara5(cc.para5);
          if (cc.para6)       setPara6(cc.para6);
          if (cc.para7)       setPara7(cc.para7);
          if (cc.para8)       setPara8(cc.para8);
          if (cc.para9)       setPara9(cc.para9);
          if (cc.closingLine) setClosingLine(cc.closingLine);
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!financialYear) return;
    setSaving(true);

    const customContent: Record<string, string> = {};
    if (para3       !== DEFAULTS.para3)       customContent.para3       = para3;
    if (para4       !== DEFAULTS.para4)       customContent.para4       = para4;
    if (para5       !== DEFAULTS.para5)       customContent.para5       = para5;
    if (para6       !== DEFAULTS.para6)       customContent.para6       = para6;
    if (para7       !== DEFAULTS.para7)       customContent.para7       = para7;
    if (para8       !== DEFAULTS.para8)       customContent.para8       = para8;
    if (para9       !== DEFAULTS.para9)       customContent.para9       = para9;
    if (closingLine !== DEFAULTS.closingLine) customContent.closingLine = closingLine;

    const { error } = await (supabase as any)
      .from("nce_letters")
      .upsert(
        {
          engagement_id:      engagementId,
          financial_year:     financialYear,
          letter_type:        "client_certificate",
          letter_date:        letterDate        || null,
          cash_on_hand:       cashOnHand        ? parseFloat(cashOnHand)   : null,
          closing_stock:      closingStock      ? parseFloat(closingStock) : null,
          closing_stock_date: closingStockDate  || null,
          custom_content:     Object.keys(customContent).length ? customContent : null,
          updated_at:         new Date().toISOString(),
        },
        { onConflict: "engagement_id,financial_year,letter_type" }
      );

    setSaving(false);
    if (error) toast.error("Save failed: " + error.message);
    else       toast.success("Certificate saved");
  };

  // ── Export Excel ──────────────────────────────────────────────────────────
  const handleExportExcel = useCallback(async () => {
    setExporting(true);
    try {
      const slug = `${clientName.replace(/\s+/g, "_").slice(0, 30)}_${financialYear.replace("/", "-")}`;
      await exportClientCertificate(
        {
          clientName,
          clientAddress,
          letterDate,
          firmName,
          firmAddress,
          firmFRN,
          financialYear,
          cashOnHand,
          closingStock,
          closingStockDate,
          para3,
          para4,
          para5,
          para6,
          para7,
          para8,
          para9,
          closingLine,
        },
        slug
      );
    } catch (e: any) {
      toast.error("Export failed: " + (e?.message || String(e)));
    } finally {
      setExporting(false);
    }
  }, [
    clientName, clientAddress, letterDate, firmName, firmAddress, firmFRN,
    financialYear, cashOnHand, closingStock, closingStockDate,
    para3, para4, para5, para6, para7, para8, para9, closingLine,
  ]);

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Save className="w-4 h-4" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExportExcel}
          disabled={exporting}
          className="gap-1.5"
        >
          {exporting
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <FileSpreadsheet className="w-4 h-4" />}
          Export Excel
        </Button>
        <span className="text-xs text-muted-foreground ml-1">
          Click any paragraph text to edit it directly.
        </span>
      </div>

      {/* ── Letter paper ── */}
      <div className="flex justify-center">
        <div
          className={[
            "bg-white border border-gray-200 shadow-md rounded",
            "p-10 w-full max-w-3xl",
            "font-serif text-sm text-gray-900 leading-relaxed",
            "space-y-5",
          ].join(" ")}
        >

          {/* ── Sender block ── */}
          <div className="space-y-1">
            <p className="font-semibold text-base">
              {clientName || <span className="text-gray-400">[Entity Name]</span>}
            </p>

            {clientAddrDb
              ? <p className="text-gray-700 whitespace-pre-line">{clientAddrDb}</p>
              : <AddrFallback label="Client address" value={clientAddrInput} onChange={setClientAddrInput} />
            }

            <p className="flex items-baseline gap-1">
              <span>Date :</span>
              <input
                type="date"
                value={letterDate}
                onChange={(e) => setLetterDate(e.target.value)}
                className="border-0 border-b border-gray-700 bg-transparent text-sm font-serif focus:outline-none focus:border-primary"
              />
            </p>
          </div>

          {/* ── Recipient block ── */}
          <div className="space-y-0.5">
            <p>To,</p>
            <p className="font-semibold">
              {firmName || <span className="text-gray-400">[Audit Firm Name]</span>}
            </p>

            {firmAddrDb
              ? <p className="text-gray-700 whitespace-pre-line">{firmAddrDb}</p>
              : <AddrFallback label="Firm address" value={firmAddrInput} onChange={setFirmAddrInput} />
            }

            {firmFRN && <p>FRN: {firmFRN}</p>}
          </div>

          {/* ── Salutation ── */}
          <p>Dear Sir,</p>

          {/* ── Opening line ── */}
          <p>
            In connection with the Tax Audits for the financial year{" "}
            <strong>{financialYear || "[FY]"}</strong>{" "}
            u/s. 44AB, we herewith certify as under :
          </p>

          {/* ── Numbered body paragraphs ── */}
          <ol className="list-decimal list-outside pl-6 space-y-3">

            {/* 1 — Cash on hand (structured inline fields) */}
            <li>
              Cash on hand Rs.{" "}
              <InlineNum value={cashOnHand} onChange={setCashOnHand} />{" "}
              was with the firm and same was tallied with the cash book.
            </li>

            {/* 2 — Closing stock (structured inline fields) */}
            <li>
              Approxi. Value of the Closing stock is Rs.{" "}
              <InlineNum value={closingStock} onChange={setClosingStock} />{" "}
              as on{" "}
              <InlineDate value={closingStockDate} onChange={setClosingStockDate} />{" "}
              and same was physically verified.
            </li>

            {/* 3–9 — fully editable paragraphs */}
            <li><EditablePara value={para3} onChange={setPara3} /></li>
            <li><EditablePara value={para4} onChange={setPara4} /></li>
            <li><EditablePara value={para5} onChange={setPara5} /></li>
            <li><EditablePara value={para6} onChange={setPara6} /></li>
            <li><EditablePara value={para7} onChange={setPara7} /></li>
            <li><EditablePara value={para8} onChange={setPara8} /></li>
            <li><EditablePara value={para9} onChange={setPara9} /></li>

          </ol>

          {/* ── Closing line (editable) ── */}
          <EditablePara value={closingLine} onChange={setClosingLine} />

          {/* ── Signature block ── */}
          <div className="pt-8 space-y-1">
            <p>Yours faithfully,</p>
            <p className="pt-10 font-mono tracking-widest">x_____________</p>
            <p>(Signature &amp; stamp)</p>
          </div>

        </div>
      </div>

    </div>
  );
}
