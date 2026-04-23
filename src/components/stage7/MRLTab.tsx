/**
 * MRLTab — Management Representation Letter (SA 580)
 * Companies ONLY | Stage 7 | 25 clauses
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Save, Loader2, CheckSquare, Square, ClipboardList,
  FileDown, FileText,
} from "lucide-react";
import { MRL_CLAUSES_TEMPLATE, MRL_OPENING_PARA_TEMPLATE, type MRLClause } from "@/constants/mrlClauses";
import { getBSDate, getAuditYear } from "@/utils/entityUtils";
import { exportToPdf } from "@/lib/exportUtils";
import { exportMrlToDocx } from "@/lib/mrlDocx";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HeaderData {
  companyNameOverride: string;
  cinOverride: string;
  addressOverride: string;
  date: string;           // ISO date string
  openingPara: string;
  cashAmount: string;
  director1Name: string;
  director1Din: string;
  director2Name: string;
  director2Din: string;
  sigPlace: string;
  sigDate: string;
}

function emptyHeader(): HeaderData {
  const today = new Date().toISOString().slice(0, 10);
  return {
    companyNameOverride: "",
    cinOverride: "",
    addressOverride: "",
    date: today,
    openingPara: "",
    cashAmount: "",
    director1Name: "",
    director1Din: "",
    director2Name: "",
    director2Din: "",
    sigPlace: "",
    sigDate: today,
  };
}

// ─── Placeholder-aware text renderer ─────────────────────────────────────────

interface ClauseTextDisplayProps {
  text: string;
  cashAmount: string;
  onCashAmountChange: (v: string) => void;
  disabled: boolean;
}

function ClauseTextDisplay({ text, cashAmount, onCashAmountChange, disabled }: ClauseTextDisplayProps) {
  if (!text.includes("[CASH_AMOUNT]")) {
    return <p className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">{text}</p>;
  }
  const parts = text.split("[CASH_AMOUNT]");
  return (
    <p className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">
      {parts[0]}
      <span
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center"
      >
        <input
          type="text"
          value={cashAmount}
          onChange={(e) => onCashAmountChange(e.target.value)}
          disabled={disabled}
          placeholder="Enter amount"
          className="text-orange-600 bg-orange-50 border-b-2 border-orange-400 w-28 text-center px-1 mx-0.5 focus:outline-none focus:border-orange-600 disabled:opacity-40 text-sm font-medium"
        />
      </span>
      {parts[1]}
    </p>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
  engagement: any;
}

export function MRLTab({ engagementId, engagement }: Props) {
  const { user } = useAuth();
  const contentRef = useRef<HTMLDivElement>(null);

  // ── Derived constants from financial year ──
  const fy: string = engagement?.financial_year ?? "";
  const bsDate = getBSDate(fy);
  const auditYear = getAuditYear(fy);

  // ── Build initial clauses (substitute BS_DATE + YEAR) ──
  const buildDefaultClauses = useCallback((): MRLClause[] => {
    return MRL_CLAUSES_TEMPLATE.map((c) => ({
      ...c,
      text: c.text
        .replace(/\[BS_DATE\]/g, bsDate)
        .replace(/\[YEAR\]/g, auditYear),
    }));
  }, [bsDate, auditYear]);

  // ── State ──
  const [clauses, setClauses] = useState<MRLClause[]>(() => buildDefaultClauses());
  const [header, setHeader] = useState<HeaderData>(emptyHeader);
  const [firmName, setFirmName] = useState("");
  const [firmCity, setFirmCity] = useState("");
  const [clientDetails, setClientDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Fetch client details (CIN, address) ──
  useEffect(() => {
    if (!engagement?.client_id) return;
    supabase
      .from("clients")
      .select("name, cin, address, registered_office, registered_state")
      .eq("id", engagement.client_id)
      .single()
      .then(({ data }) => { if (data) setClientDetails(data); });
  }, [engagement?.client_id]);

  // ── Fetch firm details (name + city for "To:" line) ──
  useEffect(() => {
    const fid = engagement?.firm_id;
    if (!fid) return;
    supabase
      .from("firms")
      .select("name, display_name, address, state")
      .eq("id", fid)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setFirmName(data.display_name || data.name || "");
        const addr = data.address as any;
        setFirmCity(addr?.city || addr?.district || data.state || "");
      });
  }, [engagement?.firm_id]);

  // ── Load saved MRL data ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("mrl_data")
      .select("clauses_json, header_data")
      .eq("engagement_id", engagementId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      toast.error("Failed to load MRL: " + error.message);
    }

    if (data) {
      if (data.clauses_json?.length) {
        // Merge saved clause text/selected with current template order
        const savedMap = new Map<string, { selected: boolean; text: string }>(
          (data.clauses_json as any[]).map((r: any) => [r.id, r])
        );
        setClauses(
          buildDefaultClauses().map((c) => {
            const saved = savedMap.get(c.id);
            if (!saved) return c;
            return { ...c, selected: saved.selected, text: saved.text };
          })
        );
      }
      if (data.header_data) {
        setHeader((prev) => ({ ...prev, ...data.header_data }));
      }
    } else {
      // First load: pre-fill opening para with year
      setClauses(buildDefaultClauses());
      setHeader((prev) => ({
        ...prev,
        openingPara: MRL_OPENING_PARA_TEMPLATE.replace(/\[YEAR\]/g, auditYear),
      }));
    }
    setLoading(false);
  }, [engagementId, buildDefaultClauses, auditYear]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Clause manipulation ─────────────────────────────────────────────────

  const toggleClause = (id: string) => {
    setClauses((prev) =>
      prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  };

  const updateText = (id: string, text: string) => {
    setClauses((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  };

  const selectAll = () => setClauses((prev) => prev.map((c) => ({ ...c, selected: true })));
  const deselectAll = () => setClauses((prev) => prev.map((c) => ({ ...c, selected: false })));

  // ─── Header field updater ────────────────────────────────────────────────

  const setH = <K extends keyof HeaderData>(key: K, value: HeaderData[K]) => {
    setHeader((prev) => ({ ...prev, [key]: value }));
  };

  // ─── Save ────────────────────────────────────────────────────────────────

  const saveAll = async () => {
    setSaving(true);
    const clausesJson = clauses.map((c) => ({ id: c.id, selected: c.selected, text: c.text }));
    const headerData: HeaderData = { ...header };

    const { error } = await (supabase as any)
      .from("mrl_data")
      .upsert(
        {
          engagement_id: engagementId,
          clauses_json: clausesJson,
          header_data: headerData,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        },
        { onConflict: "engagement_id" }
      );

    setSaving(false);
    if (error) {
      toast.error("Failed to save MRL: " + error.message);
    } else {
      toast.success("Management Representation Letter saved");
    }
  };

  // ─── Derived display values ──────────────────────────────────────────────

  const displayCompanyName =
    header.companyNameOverride ||
    clientDetails?.name ||
    engagement?.clients?.name ||
    "[Company Name]";

  const displayCIN = header.cinOverride || clientDetails?.cin || null;

  const displayAddress =
    header.addressOverride ||
    clientDetails?.registered_office ||
    clientDetails?.address ||
    null;

  const toLine =
    firmName
      ? `${firmName}, Chartered Accountants${firmCity ? `, ${firmCity}` : ""}`
      : "Your CA Firm, Chartered Accountants";

  const reLine = `Statutory Audit for year ended 31st March ${auditYear}`;

  const selectedCount = clauses.filter((c) => c.selected).length;

  // ─── Export PDF ──────────────────────────────────────────────────────────

  const handleExportPdf = async () => {
    if (!contentRef.current) return;
    const fySlug = (engagement?.financial_year ?? "FY").replace("/", "-");
    const nameSlug = displayCompanyName.replace(/\s+/g, "_").slice(0, 30);
    await exportToPdf(contentRef.current, `MRL_${nameSlug}_${fySlug}.pdf`);
  };

  // ─── Export Word (.docx) ─────────────────────────────────────────────────

  const handleExportWord = async () => {
    const fySlug = (engagement?.financial_year ?? "FY").replace(/[^a-zA-Z0-9-]/g, "-");
    const nameSlug = displayCompanyName.replace(/\s+/g, "_").slice(0, 30);
    await exportMrlToDocx(
      {
        companyName:    displayCompanyName,
        cin:            header.cinOverride || clientDetails?.cin || "",
        address:        header.addressOverride || clientDetails?.registered_office || clientDetails?.address || "",
        date:           header.date,
        firmName,
        firmCity,
        auditYear,
        openingPara:    header.openingPara,
        clauses,
        cashAmount:     header.cashAmount,
        director1Name:  header.director1Name,
        director1Din:   header.director1Din,
        director2Name:  header.director2Name,
        director2Din:   header.director2Din,
        sigPlace:       header.sigPlace || clientDetails?.registered_state || "",
        sigDate:        header.sigDate,
      },
      `MRL_${nameSlug}_${fySlug}.docx`
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-primary" />
          <span className="font-semibold text-base">Management Representation Letter</span>
          <Badge variant="secondary">
            {selectedCount} / {clauses.length} clauses
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={selectAll} className="gap-1">
            <CheckSquare className="w-4 h-4" /> Select All
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAll} className="gap-1">
            <Square className="w-4 h-4" /> Deselect All
          </Button>
          <Separator orientation="vertical" className="h-8" />
          <Button variant="outline" size="sm" onClick={handleExportPdf} className="gap-1">
            <FileDown className="w-4 h-4" /> Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportWord} className="gap-1">
            <FileText className="w-4 h-4" /> Export Word
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Draft
          </Button>
        </div>
      </div>

      {/* ── Exportable content ── */}
      <div ref={contentRef} className="space-y-6">

      {/* ── Letter Header ── */}
      <div className="border rounded-lg p-5 space-y-4 bg-card">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Letter Header</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Company Name */}
          <div className="space-y-1">
            <Label className="text-xs">
              Company Name
              <span className="ml-1 text-muted-foreground">(auto-linked, editable)</span>
            </Label>
            <Input
              value={header.companyNameOverride || displayCompanyName}
              onChange={(e) => setH("companyNameOverride", e.target.value)}
              placeholder={displayCompanyName}
            />
          </div>

          {/* CIN */}
          <div className="space-y-1">
            <Label className="text-xs">CIN</Label>
            {displayCIN ? (
              <Input
                value={header.cinOverride || displayCIN}
                onChange={(e) => setH("cinOverride", e.target.value)}
              />
            ) : (
              <div className="flex gap-2 items-center">
                <Input
                  value={header.cinOverride}
                  onChange={(e) => setH("cinOverride", e.target.value)}
                  placeholder="Enter CIN"
                />
                {!header.cinOverride && (
                  <span className="text-orange-500 bg-orange-50 text-xs px-2 py-1 rounded font-medium whitespace-nowrap">
                    [CIN]
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Address */}
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">
              Address
              <span className="ml-1 text-muted-foreground">(auto-linked, editable if blank)</span>
            </Label>
            <Input
              value={header.addressOverride || displayAddress || ""}
              onChange={(e) => setH("addressOverride", e.target.value)}
              placeholder={displayAddress || "Enter registered office address"}
            />
          </div>

          {/* Date */}
          <div className="space-y-1">
            <Label className="text-xs">Date of Letter</Label>
            <input
              type="date"
              value={header.date}
              onChange={(e) => setH("date", e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* To */}
          <div className="space-y-1">
            <Label className="text-xs">To (CA Firm)</Label>
            <Input value={toLine} readOnly className="bg-muted text-muted-foreground" />
          </div>

          {/* Re */}
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Re (Subject)</Label>
            <Input value={reLine} readOnly className="bg-muted text-muted-foreground" />
          </div>
        </div>

        {/* Opening Paragraph */}
        <div className="space-y-1">
          <Label className="text-xs">Opening Paragraph</Label>
          <Textarea
            value={header.openingPara}
            onChange={(e) => setH("openingPara", e.target.value)}
            rows={5}
            className="text-sm resize-y"
          />
        </div>
      </div>

      {/* ── Clauses ── */}
      <Accordion type="multiple" className="space-y-2">
        {clauses.map((clause, idx) => {
          const clauseNum = idx + 1;
          const isDisabled = !clause.selected;
          return (
            <AccordionItem
              key={clause.id}
              value={clause.id}
              className={`border rounded-lg transition-opacity ${isDisabled ? "opacity-40 pointer-events-none" : ""}`}
            >
              <AccordionTrigger
                className="px-4 py-3 hover:no-underline"
                /* Re-enable pointer events for the trigger row even when disabled
                   so user can click the checkbox to re-enable */
                style={isDisabled ? { pointerEvents: "auto", opacity: 1 } : undefined}
              >
                <div className="flex items-center gap-3 w-full text-left">
                  {/* Checkbox — stopPropagation prevents accordion toggle; onCheckedChange handles toggle */}
                  <span
                    onClick={(e) => e.stopPropagation()}
                    className="flex-shrink-0"
                  >
                    <Checkbox
                      id={`mrl-${clause.id}`}
                      checked={clause.selected}
                      onCheckedChange={() => toggleClause(clause.id)}
                      aria-label={`Include ${clause.title}`}
                    />
                  </span>

                  {/* Number + title */}
                  <span className="flex-1 min-w-0">
                    <span className="text-xs text-muted-foreground mr-1.5 font-mono">
                      {String(clauseNum).padStart(2, "0")}.
                    </span>
                    <span className="text-sm font-medium">{clause.title}</span>
                  </span>

                  {!clause.selected && (
                    <Badge variant="outline" className="text-xs text-muted-foreground mr-2">
                      Excluded
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>

              <AccordionContent className="px-4 pb-4 pt-1 space-y-3">
                {/* Clause text display (with orange inline input for CASH_AMOUNT) */}
                <div className="rounded bg-muted/40 px-3 py-2">
                  <ClauseTextDisplay
                    text={clause.text}
                    cashAmount={header.cashAmount}
                    onCashAmountChange={(v) => setH("cashAmount", v)}
                    disabled={isDisabled}
                  />
                </div>

                {/* Editable clause text — always visible */}
                <div>
                  <Textarea
                    value={clause.text}
                    onChange={(e) => updateText(clause.id, e.target.value)}
                    rows={6}
                    className="text-sm resize-y font-mono"
                    disabled={isDisabled}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use <code className="text-orange-500">[CASH_AMOUNT]</code> to insert the cash inline input.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* ── Signature Block ── */}
      <div className="border rounded-lg p-5 space-y-4 bg-card">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Signature Block
        </h3>
        <p className="text-sm text-foreground font-medium">
          For{" "}
          <span className="italic">
            {header.companyNameOverride || displayCompanyName}
          </span>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Director 1 — Name</Label>
              <Input
                value={header.director1Name}
                onChange={(e) => setH("director1Name", e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Director 1 — DIN</Label>
              <Input
                value={header.director1Din}
                onChange={(e) => setH("director1Din", e.target.value)}
                placeholder="DIN number"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Director 2 — Name</Label>
              <Input
                value={header.director2Name}
                onChange={(e) => setH("director2Name", e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Director 2 — DIN</Label>
              <Input
                value={header.director2Din}
                onChange={(e) => setH("director2Din", e.target.value)}
                placeholder="DIN number"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Place</Label>
            <Input
              value={header.sigPlace || clientDetails?.registered_state || ""}
              onChange={(e) => setH("sigPlace", e.target.value)}
              placeholder="City"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <input
              type="date"
              value={header.sigDate}
              onChange={(e) => setH("sigDate", e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>

      </div>{/* end contentRef */}

      {/* ── Footer save ── */}
      <div className="flex justify-end pt-1">
        <Button onClick={saveAll} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Management Representation Letter
        </Button>
      </div>
    </div>
  );
}
