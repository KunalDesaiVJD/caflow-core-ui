/**
 * NCEManagementLetter — Management Representation Letter for Non-Corporate Entities
 * Stage 8 | Tab 6 | NCE only
 *
 * Renders as a formal printed letter. Body is fully auto-derived.
 * Only editable field: letter_date (defaults to today).
 * Address fallback: shows editable textarea when clients.address or
 *   firms.address is absent (not persisted — update records in settings).
 * Saves to nce_letters (letter_type = 'management_letter').
 *
 * FRN column: firms.icai_firm_reg_no (fallback: firms.icai_reg_no).
 * FY end date: "2025-26" → "31st March, 2026".
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

// ─── Helper: firms.address is Json — may be object or plain string ────────────

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

// ─── Helper: "2025-26" → "31st March, 2026" ──────────────────────────────────

function fyEndDate(fy: string): string {
  if (!fy) return "[Date]";
  const part = fy.split("-")[1];
  if (!part) return "[Date]";
  const yr = parseInt(part) + 2000;
  return `31st March, ${yr}`;
}

// ─── today helper ─────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

// ─── Fallback address textarea (shown when address is not in DB) ──────────────

interface AddrFallbackProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function AddrFallback({ label, value, onChange }: AddrFallbackProps) {
  return (
    <div className="my-1">
      <p className="text-xs text-orange-500 mb-0.5">{label} not on file — enter below:</p>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter address..."
        className={[
          "w-full border-0 border-b border-gray-400 bg-transparent resize-none",
          "text-sm font-serif text-gray-700",
          "focus:outline-none focus:border-primary",
          "placeholder:text-gray-300",
        ].join(" ")}
      />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NCEManagementLetter({ engagementId }: Props) {
  const letterRef = useRef<HTMLDivElement>(null);

  // ── Engagement data (auto-linked) ─────────────────────────────────────────
  const [eng, setEng] = useState<any>(null);

  // ── Only persisted editable field ────────────────────────────────────────
  const [letterDate, setLetterDate] = useState(today);

  // ── Address overrides (local only — fill when DB address is absent) ────────
  const [clientAddrInput, setClientAddrInput] = useState("");
  const [firmAddrInput,   setFirmAddrInput]   = useState("");

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  // ── Derived auto-linked values ────────────────────────────────────────────
  const financialYear = (eng?.financial_year as string) || "";
  const clientName    = (eng?.clients?.name  as string) || "";
  const clientAddrDb  = (eng?.clients?.address as string) || "";
  const firmName      = ((eng?.firms?.display_name || eng?.firms?.name) as string) || "";
  const firmAddrDb    = formatFirmAddress(eng?.firms?.address);
  // FRN: confirmed column names are icai_firm_reg_no / icai_reg_no
  const firmFRN       = ((eng?.firms?.icai_firm_reg_no || eng?.firms?.icai_reg_no) as string) || "";
  const fyEnd         = fyEndDate(financialYear);

  // Resolved display addresses (DB value preferred; fallback to local input)
  const clientAddress = clientAddrDb || clientAddrInput;
  const firmAddress   = firmAddrDb   || firmAddrInput;

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      // Wildcard fetch — engagement + full clients and firms objects
      const { data: engRow } = await supabase
        .from("audit_engagements")
        .select("*, clients(*), firms(*)")
        .eq("id", engagementId)
        .single();

      if (cancelled) return;
      if (engRow) setEng(engRow);

      const fy = (engRow?.financial_year as string) || "";
      if (!fy) { setLoading(false); return; }

      // Load previously saved letter data
      const { data: saved } = await (supabase as any)
        .from("nce_letters")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("financial_year", fy)
        .eq("letter_type", "management_letter")
        .maybeSingle();

      if (!cancelled && saved?.letter_date) {
        // Use saved date; keep today() default if never saved before
        setLetterDate(saved.letter_date);
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
          engagement_id:  engagementId,
          financial_year: financialYear,
          letter_type:    "management_letter",
          letter_date:    letterDate || null,
          updated_at:     new Date().toISOString(),
        },
        { onConflict: "engagement_id,financial_year,letter_type" }
      );
    setSaving(false);
    if (error) toast.error("Save failed: " + error.message);
    else       toast.success("Management letter saved");
  };

  // ── Print ─────────────────────────────────────────────────────────────────
  const handlePrint = () => window.print();

  // ── Export PDF ────────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (!letterRef.current) return;
    const slug = clientName.replace(/\s+/g, "_").slice(0, 30);
    const fy   = financialYear.replace("/", "-");
    await exportToPdf(letterRef.current, `ManagementLetter_${slug}_${fy}.pdf`);
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

      {/* Print isolation — same pattern as NCEClientCertificate */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .nce-mgmt-letter-print,
          .nce-mgmt-letter-print * { visibility: visible !important; }
          .nce-mgmt-letter-print {
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
            "nce-mgmt-letter-print",
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

            {/* Client address — DB value or editable fallback */}
            {clientAddrDb
              ? <p className="text-gray-700 whitespace-pre-line">{clientAddrDb}</p>
              : <AddrFallback
                  label="Client address"
                  value={clientAddrInput}
                  onChange={setClientAddrInput}
                />
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

            {/* Firm address — DB value or editable fallback */}
            {firmAddrDb
              ? <p className="text-gray-700 whitespace-pre-line">{firmAddrDb}</p>
              : <AddrFallback
                  label="Firm address"
                  value={firmAddrInput}
                  onChange={setFirmAddrInput}
                />
            }

            {firmFRN && <p>FRN: {firmFRN}</p>}
          </div>

          {/* ── Subject ── */}
          <p>
            <strong>Subject :</strong>{" "}
            Appointment as Tax Auditors for Financial year{" "}
            <strong>{financialYear || "[FY]"}</strong>
          </p>

          {/* ── Salutation ── */}
          <p>Dear Sir,</p>

          {/* ── Body ── */}
          <p>
            We are pleased to informed you that our firm has appointed you to
            carried out Tax Audit u/s. 44AB books of accounts of my/our business
            for the financial year ending on{" "}
            <strong>{fyEnd}</strong>.
          </p>

          <p>You are requested to confirm the same.</p>

          {/* ── Closing ── */}
          <div className="pt-8 space-y-1">
            <p>Thank You.</p>
            <p>Yours faithfully,</p>
            <p className="pt-10 font-mono tracking-widest">x_____________</p>
            <p>(Signature &amp; stamp)</p>
          </div>

        </div>
      </div>

    </div>
  );
}
