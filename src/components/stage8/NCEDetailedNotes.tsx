import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
//
// Types, NOTES_CONFIG, and computeDisplayData are now centralised in
// `@/config/nceNotesConfig` so the editor and the Excel exporter stay in lock-
// step on row IDs, column patterns, and total formulas.

import {
  NoteConfig,
  NoteData,
  NOTES_CONFIG,
  computeDisplayData,
} from "@/config/nceNotesConfig";

interface Props {
  engagementId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INDENT_CLS = ["pl-3", "pl-7", "pl-11", "pl-14"] as const;
function indentCls(level = 0) {
  return INDENT_CLS[Math.min(level, INDENT_CLS.length - 1)];
}

function parseFY(fy: string): { cy: number; py: number } {
  if (!fy) {
    const y = new Date().getFullYear();
    return { cy: y, py: y - 1 };
  }
  const parts = fy.split("-");
  if (parts.length === 2) {
    const end = parseInt(parts[1]);
    const fullEnd = end < 100 ? 2000 + end : end;
    return { cy: fullEnd, py: fullEnd - 1 };
  }
  const y = parseInt(fy) || new Date().getFullYear();
  return { cy: y, py: y - 1 };
}

function fmtNum(v: number): string {
  return v !== 0 ? v.toLocaleString("en-IN") : "—";
}


// ─── NumInput ─────────────────────────────────────────────────────────────────

function NumInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(value === 0 ? "" : String(value));

  useEffect(() => {
    setLocal(value === 0 ? "" : String(value));
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      className={cn(
        "h-7 text-xs text-right px-2 py-0 w-full min-w-[80px]",
        disabled && "bg-muted/60 text-muted-foreground cursor-not-allowed"
      )}
      disabled={disabled}
      value={local}
      placeholder="—"
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const parsed = parseFloat(local.replace(/,/g, "")) || 0;
        setLocal(parsed === 0 ? "" : String(parsed));
        onChange(parsed);
      }}
    />
  );
}

// ─── Pattern B Table ──────────────────────────────────────────────────────────

function PatternBTable({
  config,
  cy: rawCy,
  py: rawPy,
  cyYear,
  pyYear,
  onChangeCy,
  onChangePy,
}: {
  config: NoteConfig;
  cy: Record<string, number>;
  py: Record<string, number>;
  cyYear: number;
  pyYear: number;
  onChangeCy: (key: string, v: number) => void;
  onChangePy: (key: string, v: number) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy),
    [config, rawCy, rawPy]
  );

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40">
          <TableHead className="text-xs w-[55%]">Particulars</TableHead>
          <TableHead className="text-xs text-right w-[22.5%]">
            31 March {cyYear} (₹)
          </TableHead>
          <TableHead className="text-xs text-right w-[22.5%]">
            31 March {pyYear} (₹)
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {config.rows.map(row => {
          if (row.isSectionHeader) {
            return (
              <TableRow key={row.id} className="bg-muted/20">
                <TableCell
                  colSpan={3}
                  className={cn("text-xs font-semibold py-1.5", indentCls(row.indent))}
                >
                  {row.label}
                </TableCell>
              </TableRow>
            );
          }

          if (row.isTotal) {
            return (
              <TableRow key={row.id} className="bg-muted/10 border-t border-border/60">
                <TableCell
                  className={cn("text-xs font-semibold py-1.5", indentCls(row.indent))}
                >
                  {row.label}
                </TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">
                  {fmtNum(cy[row.id] ?? 0)}
                </TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">
                  {fmtNum(py[row.id] ?? 0)}
                </TableCell>
              </TableRow>
            );
          }

          return (
            <TableRow key={row.id} className="hover:bg-muted/10">
              <TableCell className={cn("text-xs py-1", indentCls(row.indent))}>
                {row.label}
              </TableCell>
              <TableCell className="p-1">
                <NumInput
                  value={rawCy[row.id] ?? 0}
                  onChange={v => onChangeCy(row.id, v)}
                  disabled={row.naAll}
                />
              </TableCell>
              <TableCell className="p-1">
                <NumInput
                  value={rawPy[row.id] ?? 0}
                  onChange={v => onChangePy(row.id, v)}
                  disabled={row.naAll}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ─── Pattern A Table ──────────────────────────────────────────────────────────
// Column order (per spec): Particulars | LT CY | LT PY | ST CY | ST PY

function PatternATable({
  config,
  cy: rawCy,
  py: rawPy,
  cyYear,
  pyYear,
  onChangeCy,
  onChangePy,
}: {
  config: NoteConfig;
  cy: Record<string, number>;
  py: Record<string, number>;
  cyYear: number;
  pyYear: number;
  onChangeCy: (key: string, v: number) => void;
  onChangePy: (key: string, v: number) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy),
    [config, rawCy, rawPy]
  );

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40">
          <TableHead rowSpan={2} className="text-xs w-[28%] align-bottom border-r">
            Particulars
          </TableHead>
          <TableHead colSpan={2} className="text-xs text-center border-r border-b-0">
            Long Term (₹)
          </TableHead>
          <TableHead colSpan={2} className="text-xs text-center border-b-0">
            Short Term (₹)
          </TableHead>
        </TableRow>
        <TableRow className="bg-muted/40">
          <TableHead className="text-xs text-right">31 Mar {cyYear}</TableHead>
          <TableHead className="text-xs text-right border-r">31 Mar {pyYear}</TableHead>
          <TableHead className="text-xs text-right">31 Mar {cyYear}</TableHead>
          <TableHead className="text-xs text-right">31 Mar {pyYear}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {config.rows.map(row => {
          if (row.isSectionHeader) {
            return (
              <TableRow key={row.id} className="bg-muted/20">
                <TableCell
                  colSpan={5}
                  className={cn("text-xs font-semibold py-1.5", indentCls(row.indent))}
                >
                  {row.label}
                </TableCell>
              </TableRow>
            );
          }

          if (row.isTotal) {
            const ltCv = cy[row.id + "_lt"] ?? 0;
            const ltPv = py[row.id + "_lt"] ?? 0;
            const stCv = cy[row.id + "_st"] ?? 0;
            const stPv = py[row.id + "_st"] ?? 0;
            return (
              <TableRow key={row.id} className="bg-muted/10 border-t border-border/60">
                <TableCell
                  className={cn("text-xs font-semibold py-1.5 border-r", indentCls(row.indent))}
                >
                  {row.label}
                </TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(ltCv)}</TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold border-r">{fmtNum(ltPv)}</TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(stCv)}</TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(stPv)}</TableCell>
              </TableRow>
            );
          }

          return (
            <TableRow key={row.id} className="hover:bg-muted/10">
              <TableCell className={cn("text-xs py-1 border-r", indentCls(row.indent))}>
                {row.label}
              </TableCell>
              {/* LT CY */}
              <TableCell className="p-1">
                <NumInput
                  value={rawCy[row.id + "_lt"] ?? 0}
                  onChange={v => onChangeCy(row.id + "_lt", v)}
                  disabled={row.naLT}
                />
              </TableCell>
              {/* LT PY */}
              <TableCell className="p-1 border-r">
                <NumInput
                  value={rawPy[row.id + "_lt"] ?? 0}
                  onChange={v => onChangePy(row.id + "_lt", v)}
                  disabled={row.naLT}
                />
              </TableCell>
              {/* ST CY */}
              <TableCell className="p-1">
                <NumInput
                  value={rawCy[row.id + "_st"] ?? 0}
                  onChange={v => onChangeCy(row.id + "_st", v)}
                  disabled={row.naST}
                />
              </TableCell>
              {/* ST PY */}
              <TableCell className="p-1">
                <NumInput
                  value={rawPy[row.id + "_st"] ?? 0}
                  onChange={v => onChangePy(row.id + "_st", v)}
                  disabled={row.naST}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NCEDetailedNotes({ engagementId }: Props) {
  const [noteData, setNoteData]   = useState<Record<string, NoteData>>({});
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [eng, setEng]             = useState<any>(null);

  // ── Derived year labels (from self-fetched engagement) ──────────────────
  const financialYear = (eng?.financial_year as string) || "";
  const clientName    = (eng?.clients?.name  as string) || "";
  const { cy: cyYear, py: pyYear } = useMemo(() => parseFY(financialYear), [financialYear]);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      // 1. Fetch engagement — get FY and client name
      const { data: engRow } = await supabase
        .from("audit_engagements")
        .select("financial_year, clients(name), firms(*), partner:users!partner_id(name)")
        .eq("id", engagementId)
        .single();
      if (cancelled) return;
      if (engRow) setEng(engRow);

      // 2. Fetch all saved notes for this engagement
      const { data, error } = await supabase
        .from("nce_financial_notes")
        .select("note_type, cy_data, py_data")
        .eq("engagement_id", engagementId);
      if (!cancelled) {
        if (!error && data) {
          const built: Record<string, NoteData> = {};
          for (const row of data) {
            built[row.note_type] = {
              cy: (row.cy_data as Record<string, number>) || {},
              py: (row.py_data as Record<string, number>) || {},
            };
          }
          setNoteData(built);
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Change handler ──────────────────────────────────────────────────────
  const handleChange = useCallback(
    (noteType: string, key: string, isCY: boolean, value: number) => {
      setNoteData(prev => {
        const cur = prev[noteType] ?? { cy: {}, py: {} };
        return isCY
          ? { ...prev, [noteType]: { ...cur, cy: { ...cur.cy, [key]: value } } }
          : { ...prev, [noteType]: { ...cur, py: { ...cur.py, [key]: value } } };
      });
    },
    []
  );

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const rows = NOTES_CONFIG.map(nc => {
        const d = noteData[nc.noteType] ?? { cy: {}, py: {} };
        return {
          engagement_id:  engagementId,
          financial_year: financialYear,
          note_type:      nc.noteType,
          cy_data:        d.cy as any,
          py_data:        d.py as any,
          updated_at:     new Date().toISOString(),
        };
      });
      const { error } = await supabase
        .from("nce_financial_notes")
        .upsert(rows, { onConflict: "engagement_id,financial_year,note_type" });
      if (error) throw error;
      toast.success("Notes saved successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading state ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const SaveBtn = () => (
    <Button size="sm" onClick={handleSave} disabled={saving}>
      {saving
        ? <Loader2 className="animate-spin h-4 w-4 mr-1.5" />
        : <Save className="h-4 w-4 mr-1.5" />}
      Save All Notes
    </Button>
  );

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="text-center space-y-0.5 pb-3 border-b">
        {clientName && (
          <p className="text-sm font-semibold uppercase tracking-wide">{clientName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Notes forming part of the Financial Statements for the year ended, 31st March, {cyYear}
        </p>
      </div>

      {/* Top save */}
      <div className="flex justify-end">
        <SaveBtn />
      </div>

      {/* Notes accordion — all collapsed by default */}
      <Accordion type="multiple" className="space-y-1.5">
        {NOTES_CONFIG.map(nc => {
          const d = noteData[nc.noteType] ?? { cy: {}, py: {} };
          return (
            <AccordionItem
              key={nc.noteType}
              value={nc.noteType}
              className="border rounded-lg px-4 bg-background"
            >
              <AccordionTrigger className="text-sm font-medium py-3 hover:no-underline">
                {nc.title}
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="overflow-x-auto rounded border">
                  {nc.pattern === "A" ? (
                    <PatternATable
                      config={nc}
                      cy={d.cy}
                      py={d.py}
                      cyYear={cyYear}
                      pyYear={pyYear}
                      onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                      onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                    />
                  ) : (
                    <PatternBTable
                      config={nc}
                      cy={d.cy}
                      py={d.py}
                      cyYear={cyYear}
                      pyYear={pyYear}
                      onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                      onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                    />
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Bottom save */}
      <div className="flex justify-end pt-2">
        <SaveBtn />
      </div>
    </div>
  );
}
