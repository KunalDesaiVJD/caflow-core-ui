/**
 * NCEClientCertificate — Client Certificate for Non-Corporate Entities
 * Stage 8 | Tab 5 | NCE only
 *
 * Points 1 & 2 are fixed (Cash on Hand, Closing Stock).
 * Points 3+ are a dynamic deletable/addable list stored in custom_content.points[].
 * Export: Excel only (Print / Export PDF removed).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, Loader2, FileSpreadsheet, FileText, Trash2, Plus, ChevronUp, ChevronDown } from "lucide-react";
import { exportClientCertificate } from "@/lib/nceLetterExport";
import { exportClientCertificateDocx } from "@/lib/nceLetterDocxExport";
import { WordFontPickerDialog, type ExportFont } from "@/components/shared/WordFontPickerDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Point {
  id:   string;
  text: string;
}

interface Props {
  engagementId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_POINTS: Point[] = [
  { id: "d0", text: "Method of valuation is cost or market whichever is less. Quantitive detailes are maintained." },
  { id: "d1", text: "Method accounting is mercantile, which is same method which was employed in immediately preceding year." },
  { id: "d2", text: "We certify that there is no person/s to whom payments made to persons specified in section 40A(2)(b) except as shown in Form-3CD." },
  { id: "d3", text: "We certify that Fixed Assets are stated at cost as stated in books of accounts." },
  { id: "d4", text: "I have made every payments exceeding Rs.10000 relating to any expenditure covered under section 40A(3) by an a/c. payee cheque drawn on a bank or an a/c. payee bank draft only." },
  { id: "d5", text: "We here with inform and certify that the loan or deposit or specified advance taken or accepted or repaid for an amount of Rs.10000/- or more, during the year or earlier year/s was taken or accepted or repaid through account payee cheque or bank draft or ECS only." },
  { id: "d6", text: "We have accounted the entries in the books of accounts whenever the supporting proof are not available, we have prepared vouchers and we authenticate the same that all are for the business of the firm" },
];

const DEFAULT_CLOSING = "You are requested to note the same.";

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

// ─── Inline number input ──────────────────────────────────────────────────────

function InlineNum({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="number"
      min="0"
      step="0.01"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0.00"
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

// ─── Address fallback ─────────────────────────────────────────────────────────

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

// ─── Editable point textarea (auto-resize) ────────────────────────────────────

function PointText({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

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
        "focus:outline-none focus:bg-amber-50 rounded transition-colors px-1 -mx-1",
      ].join(" ")}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NCEClientCertificate({ engagementId }: Props) {
  const [eng, setEng] = useState<any>(null);

  // Fixed fields
  const [letterDate,       setLetterDate]       = useState(today);
  const [cashOnHand,       setCashOnHand]       = useState("");
  const [closingStock,     setClosingStock]     = useState("");
  const [closingStockDate, setClosingStockDate] = useState("");
  const [closingLine,      setClosingLine]      = useState(DEFAULT_CLOSING);

  // Dynamic points list
  const [points, setPoints] = useState<Point[]>(DEFAULT_POINTS);

  // Address overrides (local only)
  const [clientAddrInput, setClientAddrInput] = useState("");
  const [firmAddrInput,   setFirmAddrInput]   = useState("");

  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [exporting, setExporting] = useState(false);
  // Word export font picker — Calibri matches the existing Excel template.
  const [showWordFontDialog, setShowWordFontDialog] = useState(false);
  const [wordExportFont,     setWordExportFont]     = useState<ExportFont>("Calibri");

  // Derived
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

        const cc = saved.custom_content as any;
        if (cc) {
          // New format: points array
          if (Array.isArray(cc.points)) {
            setPoints(
              (cc.points as string[]).map((text, i) => ({ id: `s${i}`, text }))
            );
          } else {
            // Migrate old format (para3..para9)
            const OLD = ["para3","para4","para5","para6","para7","para8","para9"];
            setPoints(
              DEFAULT_POINTS.map((dp, i) => ({
                id: dp.id,
                text: cc[OLD[i]] ?? dp.text,
              }))
            );
          }
          if (cc.closingLine !== undefined) setClosingLine(cc.closingLine);
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Points helpers ────────────────────────────────────────────────────────
  const addPoint = () =>
    setPoints((prev) => [
      ...prev,
      { id: `n${Date.now()}`, text: "" },
    ]);

  const deletePoint = (id: string) =>
    setPoints((prev) => prev.filter((p) => p.id !== id));

  const updatePoint = (id: string, text: string) =>
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, text } : p)));

  // Reorder helpers — same UX as Note 1 (Stage 7 → Notes to Accounts) so
  // the auditor can shuffle points without dragging or retyping.
  const movePoint = (id: string, dir: -1 | 1) =>
    setPoints((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  const movePointUp   = (id: string) => movePoint(id, -1);
  const movePointDown = (id: string) => movePoint(id, +1);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!financialYear) return;
    setSaving(true);

    const cc: Record<string, any> = {};
    cc.points = points.map((p) => p.text);
    if (closingLine !== DEFAULT_CLOSING) cc.closingLine = closingLine;

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
          custom_content:     cc,
          updated_at:         new Date().toISOString(),
        },
        { onConflict: "engagement_id,financial_year,letter_type" }
      );

    setSaving(false);
    if (error) toast.error("Save failed: " + error.message);
    else       toast.success("Certificate saved");
  };

  // ── Export Excel / Word ───────────────────────────────────────────────────
  // Excel and Word use the same payload — only the renderer differs.
  const buildExportPayload = useCallback(() => ({
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
    points: points.map((p) => p.text),
    closingLine,
  }), [
    clientName, clientAddress, letterDate, firmName, firmAddress, firmFRN,
    financialYear, cashOnHand, closingStock, closingStockDate, points, closingLine,
  ]);

  const handleExportExcel = useCallback(async () => {
    setExporting(true);
    try {
      const slug = `${clientName.replace(/\s+/g, "_").slice(0, 30)}_${financialYear.replace("/", "-")}`;
      await exportClientCertificate(buildExportPayload(), slug);
    } catch (e: any) {
      toast.error("Export failed: " + (e?.message || String(e)));
    } finally {
      setExporting(false);
    }
  }, [clientName, financialYear, buildExportPayload]);

  // "Export Word" toolbar button — opens the font picker; the picker's
  // Confirm handler (runWordExport) runs the actual export with the
  // chosen font.
  const handleExportWord = useCallback(() => {
    setShowWordFontDialog(true);
  }, []);

  const runWordExport = useCallback(async (font: ExportFont) => {
    setExporting(true);
    try {
      const slug = `${clientName.replace(/\s+/g, "_").slice(0, 30)}_${financialYear.replace("/", "-")}`;
      await exportClientCertificateDocx(buildExportPayload(), slug, font);
    } catch (e: any) {
      toast.error("Word export failed: " + (e?.message || String(e)));
    } finally {
      setExporting(false);
    }
  }, [clientName, financialYear, buildExportPayload]);

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
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExportExcel}
          disabled={exporting}
          className="gap-1.5"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          Export Excel
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExportWord}
          disabled={exporting}
          className="gap-1.5"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          Export Word
        </Button>
        <span className="text-xs text-muted-foreground ml-1">
          Click any point text to edit. Hover a point to delete it.
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

          {/* ── Point 1 — Cash on hand (fixed) ── */}
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 w-7 text-right font-serif">1.</span>
            <div className="flex-1">
              Cash on hand Rs.{" "}
              <InlineNum value={cashOnHand} onChange={setCashOnHand} />{" "}
              was with the firm and same was tallied with the cash book.
            </div>
          </div>

          {/* ── Point 2 — Closing stock (fixed) ── */}
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 w-7 text-right font-serif">2.</span>
            <div className="flex-1">
              Approxi. Value of the Closing stock is Rs.{" "}
              <InlineNum value={closingStock} onChange={setClosingStock} />{" "}
              as on{" "}
              <InlineDate value={closingStockDate} onChange={setClosingStockDate} />{" "}
              and same was physically verified.
            </div>
          </div>

          {/* ── Dynamic points (3, 4, 5, …) ── */}
          <div className="space-y-2">
            {points.map((pt, i) => {
              const isFirst = i === 0;
              const isLast  = i === points.length - 1;
              return (
                <div key={pt.id} className="flex items-start gap-2 group">
                  {/* Number */}
                  <span className="shrink-0 w-7 text-right font-serif pt-0.5">
                    {i + 3}.
                  </span>
                  {/* Editable text */}
                  <div className="flex-1 min-w-0">
                    <PointText
                      value={pt.text}
                      onChange={(text) => updatePoint(pt.id, text)}
                    />
                  </div>
                  {/* Reorder + Delete controls — appear on row hover. Same
                      UX as the Note 1 (Stage 7 → Notes to Accounts) card so
                      the auditor can shuffle points without dragging. */}
                  <div className="flex items-center gap-0.5 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => movePointUp(pt.id)}
                      disabled={isFirst}
                      title="Move up"
                      className="p-1 rounded hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => movePointDown(pt.id)}
                      disabled={isLast}
                      title="Move down"
                      className="p-1 rounded hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deletePoint(pt.id)}
                      title="Delete this point"
                      className="p-1 rounded hover:bg-red-50 text-red-300 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Add point button */}
            <div className="flex items-center pl-9 pt-1">
              <button
                onClick={addPoint}
                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Point
              </button>
            </div>
          </div>

          {/* ── Closing line (editable) ── */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <PointText value={closingLine} onChange={setClosingLine} />
            </div>
          </div>

          {/* ── Signature block ── */}
          <div className="pt-8 space-y-1">
            <p>Yours faithfully,</p>
            <p className="pt-10 font-mono tracking-widest">x_____________</p>
            <p>(Signature &amp; stamp)</p>
          </div>

        </div>
      </div>

      {/* Word-export font picker — mirrors the FS export's dialog so the
          Client Certificate Word file can use the same six fonts. */}
      <WordFontPickerDialog
        open={showWordFontDialog}
        onOpenChange={setShowWordFontDialog}
        title="Export Client Certificate"
        selected={wordExportFont}
        onSelect={setWordExportFont}
        onConfirm={(f) => { void runWordExport(f); }}
        radioName="clientCertWordFont"
      />

    </div>
  );
}
