/**
 * NCEClientCertificate — Client Certificate for Non-Corporate Entities
 * Stage 8 | Tab 5 | NCE only
 *
 * Renders as a formal printed letter with inline editable fields.
 * Auto-linked values: entity name, address, firm name/address/FRN, financial year.
 * Editable fields: letter_date, cash_on_hand, closing_stock, closing_stock_date.
 * Saves to nce_letters (letter_type = 'client_certificate').
 */

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, Loader2, Printer, FileDown } from "lucide-react";
import { exportToPdf } from "@/lib/exportUtils";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
}

// ─── Helper: firms.address is Json (may be object or plain string) ────────────

function formatFirmAddress(addr: unknown): string {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  const a = addr as Record<string, unknown>;
  return [
    a.line1, a.line2, a.street,
    a.city || a.district,
    a.state, a.pincode,
  ]
    .filter(Boolean)
    .join(", ");
}

// ─── Inline underlined numeric input (sits inside letter paragraph text) ──────

interface InlineNumProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function InlineNum({ value, onChange, placeholder = "0.00" }: InlineNumProps) {
  return (
    <input
      type="number"
      min="0"
      step="0.01"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={[
        "w-32 border-0 border-b border-gray-700 bg-transparent",
        "text-sm text-center font-serif",
        "focus:outline-none focus:border-primary",
        "placeholder:text-gray-400",
      ].join(" ")}
    />
  );
}

// ─── Inline underlined date input (sits inside letter paragraph text) ─────────

interface InlineDateProps {
  value: string;
  onChange: (v: string) => void;
}

function InlineDate({ value, onChange }: InlineDateProps) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={[
        "border-0 border-b border-gray-700 bg-transparent",
        "text-sm font-serif",
        "focus:outline-none focus:border-primary",
      ].join(" ")}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NCEClientCertificate({ engagementId }: Props) {
  const letterRef = useRef<HTMLDivElement>(null);

  // ── Auto-linked data ──────────────────────────────────────────────────────
  const [eng, setEng] = useState<any>(null);

  // ── Editable fields ───────────────────────────────────────────────────────
  const [letterDate,       setLetterDate]       = useState("");
  const [cashOnHand,       setCashOnHand]       = useState("");
  const [closingStock,     setClosingStock]     = useState("");
  const [closingStockDate, setClosingStockDate] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  // ── Derived auto-linked values ────────────────────────────────────────────
  const financialYear = (eng?.financial_year  as string) || "";
  const clientName    = (eng?.clients?.name   as string) || "";
  const clientAddress = (eng?.clients?.address as string) || "";
  const firmName      = (eng?.firms?.display_name || eng?.firms?.name || "") as string;
  const firmAddress   = formatFirmAddress(eng?.firms?.address);
  const firmFRN       = (eng?.firms?.icai_firm_reg_no || eng?.firms?.icai_reg_no || "") as string;

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      // Fetch engagement + all needed joins in one query
      const { data: engRow } = await supabase
        .from("audit_engagements")
        .select(
          "financial_year, " +
          "clients(name, address), " +
          "firms(name, display_name, icai_firm_reg_no, icai_reg_no, address)"
        )
        .eq("id", engagementId)
        .single();

      if (cancelled) return;
      if (engRow) setEng(engRow);

      const fy = (engRow?.financial_year as string) || "";
      if (!fy) {
        setLoading(false);
        return;
      }

      // Load previously saved letter data
      const { data: saved } = await (supabase as any)
        .from("nce_letters")
        .select("letter_date, cash_on_hand, closing_stock, closing_stock_date")
        .eq("engagement_id", engagementId)
        .eq("financial_year", fy)
        .eq("letter_type", "client_certificate")
        .maybeSingle();

      if (!cancelled && saved) {
        if (saved.letter_date)         setLetterDate(saved.letter_date);
        if (saved.cash_on_hand != null) setCashOnHand(String(saved.cash_on_hand));
        if (saved.closing_stock != null) setClosingStock(String(saved.closing_stock));
        if (saved.closing_stock_date)  setClosingStockDate(saved.closing_stock_date);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!financialYear) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("nce_letters")
      .upsert(
        {
          engagement_id:      engagementId,
          financial_year:     financialYear,
          letter_type:        "client_certificate",
          letter_date:        letterDate        || null,
          cash_on_hand:       cashOnHand        ? parseFloat(cashOnHand)    : null,
          closing_stock:      closingStock      ? parseFloat(closingStock)  : null,
          closing_stock_date: closingStockDate  || null,
          updated_at:         new Date().toISOString(),
        },
        { onConflict: "engagement_id,financial_year,letter_type" }
      );
    setSaving(false);
    if (error) toast.error("Save failed: " + error.message);
    else       toast.success("Certificate saved");
  };

  // ── Print ─────────────────────────────────────────────────────────────────
  const handlePrint = () => window.print();

  // ── Export PDF ────────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (!letterRef.current) return;
    const slug = clientName.replace(/\s+/g, "_").slice(0, 30);
    const fy   = financialYear.replace("/", "-");
    await exportToPdf(letterRef.current, `ClientCertificate_${slug}_${fy}.pdf`);
  };

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

      {/*
       * Print isolation: hide everything except the letter area.
       * The "nce-cert-letter-print" class is applied only to the letter div.
       */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .nce-cert-letter-print,
          .nce-cert-letter-print * { visibility: visible !important; }
          .nce-cert-letter-print {
            position: absolute !important;
            left: 0 !important; top: 0 !important;
            width: 100% !important;
            box-shadow: none !important;
            border: none !important;
          }
        }
      `}</style>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap print:hidden">
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Save className="w-4 h-4" />}
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1.5">
          <Printer className="w-4 h-4" /> Print
        </Button>
        <Button size="sm" variant="outline" onClick={handleExportPdf} className="gap-1.5">
          <FileDown className="w-4 h-4" /> Export PDF
        </Button>
      </div>

      {/* ── Letter paper ── */}
      <div className="flex justify-center">
        <div
          ref={letterRef}
          className={[
            "nce-cert-letter-print",
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
            {clientAddress && (
              <p className="text-gray-700 whitespace-pre-line">{clientAddress}</p>
            )}
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
            {firmAddress && (
              <p className="text-gray-700 whitespace-pre-line">{firmAddress}</p>
            )}
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

            {/* 1 — Cash on hand */}
            <li>
              Cash on hand Rs.{" "}
              <InlineNum
                value={cashOnHand}
                onChange={setCashOnHand}
              />{" "}
              was with the firm and same was tallied with the cash book.
            </li>

            {/* 2 — Closing stock */}
            <li>
              Approxi. Value of the Closing stock is Rs.{" "}
              <InlineNum
                value={closingStock}
                onChange={setClosingStock}
              />{" "}
              as on{" "}
              <InlineDate
                value={closingStockDate}
                onChange={setClosingStockDate}
              />{" "}
              and same was physically verified.
            </li>

            {/* 3 — Valuation method */}
            <li>
              Method of valuation is cost or market whichever is less.
              Quantitive detailes are maintained.
            </li>

            {/* 4 — Accounting method */}
            <li>
              Method accounting is mercantile, which is same method which was
              employed in immediately preceding year.
            </li>

            {/* 5 — 40A(2)(b) */}
            <li>
              We certify that there is no person/s to whom payments made to
              persons specified in section 40A(2)(b) except as shown in Form-3CD.
            </li>

            {/* 6 — Fixed assets */}
            <li>
              We certify that Fixed Assets are stated at cost as stated in
              books of accounts.
            </li>

            {/* 7 — 40A(3) */}
            <li>
              I have made every payments exceeding Rs.10000 relating to any
              expenditure covered under section 40A(3) by an a/c. payee cheque
              drawn on a bank or an a/c. payee bank draft only.
            </li>

            {/* 8 — Loans / deposits */}
            <li>
              We here with inform and certify that the loan or deposit or
              specified advance taken or accepted or repaid for an amount of
              Rs.10000/- or more, during the year or earlier year/s was taken
              or accepted or repaid through account payee cheque or bank draft
              or ECS only.
            </li>

            {/* 9 — Vouchers */}
            <li>
              We have accounted the entries in the books of accounts whenever
              the supporting proof are not available, we have prepared vouchers
              and we authenticate the same that all are for the business of the
              firm
            </li>

          </ol>

          <p>You are requested to note the same.</p>

          {/* ── Closing ── */}
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
