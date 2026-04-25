import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import EngagementHeader from "@/components/pipeline/EngagementHeader";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import {
  generateFinancialStatementsXLSX,
  type Engagement as FSEngagement,
  type FirmSettings as FSFirmSettings,
  type BSRowData,
  type PLRowData,
  type CFSRowData,
} from "@/lib/fsExcelExport";
import {
  ArrowRight, AlertTriangle, Download, FileSpreadsheet,
  Pencil, Loader2, BarChart3, Droplets, Lock, Database, CheckCircle2,
  BookOpen, Plus, Trash2, Save,
} from "lucide-react";
import { NCE_FS_ITEMS } from "@/config/nceLineItems";
import type { FSLineItem } from "@/config/nceLineItems";
import {
  NOTES_CONFIG,
  NOTE_META,
  computeDisplayData,
  type NoteConfig,
} from "@/config/nceNotesConfig";

// ═══════════════════════════════════════
// Schedule III Line Item Definitions
// ═══════════════════════════════════════

const SCHEDULE_III_DIV_I: FSLineItem[] = [
  // ── BALANCE SHEET — EQUITY & LIABILITIES ──
  { code: "BS_EQ", name: "EQUITY AND LIABILITIES", noteRef: null, section: "BS_liabilities", children: [
    { code: "BS_EQ_SC", name: "Share Capital", noteRef: 3, section: "BS_liabilities", scheduleRef: "Sch III" },
    { code: "BS_EQ_RS", name: "Reserves and Surplus", noteRef: 4, section: "BS_liabilities", scheduleRef: "Sch III" },
    { code: "BS_EQ_MS", name: "Money Received Against Share Warrants", noteRef: null, section: "BS_liabilities" },
  ]},
  { code: "BS_NCL", name: "NON-CURRENT LIABILITIES", noteRef: null, section: "BS_liabilities", children: [
    { code: "BS_NCL_LTB", name: "Long-term Borrowings", noteRef: 5, section: "BS_liabilities", scheduleRef: "Sch III" },
    { code: "BS_NCL_DTL", name: "Deferred Tax Liabilities (Net)", noteRef: 6, section: "BS_liabilities" },
    { code: "BS_NCL_OLT", name: "Other Long-term Liabilities", noteRef: 7, section: "BS_liabilities" },
    { code: "BS_NCL_LTP", name: "Long-term Provisions", noteRef: 8, section: "BS_liabilities" },
  ]},
  { code: "BS_CL", name: "CURRENT LIABILITIES", noteRef: null, section: "BS_liabilities", children: [
    { code: "BS_CL_STB", name: "Short-term Borrowings", noteRef: 9, section: "BS_liabilities" },
    { code: "BS_CL_TP", name: "Trade Payables", noteRef: 10, section: "BS_liabilities" },
    { code: "BS_CL_OCL", name: "Other Current Liabilities", noteRef: 11, section: "BS_liabilities" },
    { code: "BS_CL_STP", name: "Short-term Provisions", noteRef: 12, section: "BS_liabilities" },
  ]},
  // ── BALANCE SHEET — ASSETS ──
  { code: "BS_NCA", name: "NON-CURRENT ASSETS", noteRef: null, section: "BS_assets", children: [
    { code: "BS_NCA_FA", name: "Fixed Assets", noteRef: 13, section: "BS_assets", scheduleRef: "Sch II", children: [
      { code: "BS_NCA_FA_TAN", name: "Tangible Assets", noteRef: 13, section: "BS_assets" },
      { code: "BS_NCA_FA_INT", name: "Intangible Assets", noteRef: 13, section: "BS_assets" },
      { code: "BS_NCA_FA_WIP", name: "Capital Work-in-Progress", noteRef: 14, section: "BS_assets" },
    ]},
    { code: "BS_NCA_INV", name: "Non-current Investments", noteRef: 15, section: "BS_assets" },
    { code: "BS_NCA_DTA", name: "Deferred Tax Assets (Net)", noteRef: 16, section: "BS_assets" },
    { code: "BS_NCA_LLA", name: "Long-term Loans and Advances", noteRef: 17, section: "BS_assets" },
    { code: "BS_NCA_ONA", name: "Other Non-current Assets", noteRef: 18, section: "BS_assets" },
  ]},
  { code: "BS_CA", name: "CURRENT ASSETS", noteRef: null, section: "BS_assets", children: [
    { code: "BS_CA_CI", name: "Current Investments", noteRef: 19, section: "BS_assets" },
    { code: "BS_CA_INV", name: "Inventories", noteRef: 20, section: "BS_assets" },
    { code: "BS_CA_TR", name: "Trade Receivables", noteRef: 21, section: "BS_assets" },
    { code: "BS_CA_CCE", name: "Cash and Cash Equivalents", noteRef: 22, section: "BS_assets" },
    { code: "BS_CA_SLA", name: "Short-term Loans and Advances", noteRef: 23, section: "BS_assets" },
    { code: "BS_CA_OCA", name: "Other Current Assets", noteRef: 24, section: "BS_assets" },
  ]},
  // ── PROFIT & LOSS ──
  { code: "PL_REV", name: "REVENUE", noteRef: null, section: "PL_revenue", children: [
    { code: "PL_REV_OPS", name: "Revenue from Operations", noteRef: 25, section: "PL_revenue" },
    { code: "PL_REV_OI", name: "Other Income", noteRef: 26, section: "PL_revenue" },
  ]},
  { code: "PL_EXP", name: "EXPENSES", noteRef: null, section: "PL_expenses", children: [
    { code: "PL_EXP_MAT", name: "Cost of Materials Consumed", noteRef: 27, section: "PL_expenses" },
    { code: "PL_EXP_SIT", name: "Purchases of Stock-in-Trade", noteRef: 27, section: "PL_expenses" },
    { code: "PL_EXP_CII", name: "Changes in Inventories of FG/WIP/SIT", noteRef: 27, section: "PL_expenses" },
    { code: "PL_EXP_EMP", name: "Employee Benefits Expense", noteRef: 28, section: "PL_expenses" },
    { code: "PL_EXP_FIN", name: "Finance Costs", noteRef: null, section: "PL_expenses" },
    { code: "PL_EXP_DEP", name: "Depreciation and Amortisation Expense", noteRef: null, section: "PL_expenses" },
    { code: "PL_EXP_OTH", name: "Other Expenses", noteRef: 29, section: "PL_expenses" },
  ]},
  { code: "PL_EI",    name: "Exceptional Items",          noteRef: null, section: "PL_expenses" },
  { code: "PL_TAX",   name: "Tax Expense",                noteRef: null, section: "PL_expenses", children: [
    { code: "PL_TAX_CUR", name: "Current Tax",   noteRef: null, section: "PL_expenses" },
    { code: "PL_TAX_DEF", name: "Deferred Tax",  noteRef: null, section: "PL_expenses" },
  ]},
  { code: "PL_PAT",   name: "Profit/(Loss) After Tax",    noteRef: null, section: "PL_expenses" },
  { code: "PL_EPS_B", name: "EPS — Basic (₹)",            noteRef: null, section: "PL_expenses" },
  { code: "PL_EPS_D", name: "EPS — Diluted (₹)",          noteRef: null, section: "PL_expenses" },
];

// ═══════════════════════════════════════
// Flatten FS tree for lookups
// ═══════════════════════════════════════
function flattenTree(items: FSLineItem[], depth = 0): (FSLineItem & { depth: number })[] {
  const result: (FSLineItem & { depth: number })[] = [];
  for (const item of items) {
    result.push({ ...item, depth });
    if (item.children) {
      result.push(...flattenTree(item.children, depth + 1));
    }
  }
  return result;
}

const FLAT_ITEMS = flattenTree(SCHEDULE_III_DIV_I);

// ═══════════════════════════════════════
// Non-Corporate Entity detection
// Exact values stored in audit_engagements.entity_type  (see StepBasicInfo.tsx)
// ═══════════════════════════════════════
const NON_CORPORATE_TYPES: string[] = [
  "Individual",
  "Proprietorship",
  "Sole Proprietorship",
  "Partnership",
  "LLP",
  "Limited Liability Partnership",
  "HUF",
  "Hindu Undivided Family",
  "Trust",
  "AOP",
  "Association of Persons",
  "BOI",
  "Body of Individuals",
];

// ── NCE_FS_ITEMS imported from shared config (src/config/nceLineItems.ts) ──
// One source of truth — also used by Stage 6 COA Mapping (PipelineStage3.tsx).
const NCE_FLAT_ITEMS = flattenTree(NCE_FS_ITEMS);

// ─── NCE leaf-code sets for stats bar ────────────────────────────────────────
// Sum individual line items directly — independent of computeTotal parent nodes.
// 12 asset codes (ppe → other_ca), 8 liability codes (capital → short-term prov).
const NCE_ASSET_IDS: string[] = [
  // Non-Current Assets (notes 10–15)
  "NCE_PPE", "NCE_CWIP", "NCE_INTG", "NCE_NCINV", "NCE_LTLA", "NCE_ONCA",
  // Current Assets (notes 16–21)
  "NCE_CINV", "NCE_STCK", "NCE_TR", "NCE_CASH", "NCE_STLA", "NCE_OCA",
];
const NCE_LIAB_IDS: string[] = [
  // Owners Funds (note 2)
  "NCE_CAP",
  // Non-Current Liabilities (notes 3–5)
  "NCE_LTB", "NCE_OLTL", "NCE_LTP",
  // Current Liabilities (notes 6–9)
  "NCE_STB", "NCE_TP", "NCE_OCL", "NCE_STP",
];

// ═══════════════════════════════════════
// Props
// ═══════════════════════════════════════
interface PipelineFinancialStatementsProps {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

// ═══════════════════════════════════════
// Phase UI-2/3/4 — Pixel-perfect in-UI render helpers
// ═══════════════════════════════════════

// Indian numbering (1,23,45,678.00) with parens for negatives and "-" for zero.
// Mirrors the Excel money format `#,##0.00;(#,##0.00);"-"` so the on-screen
// statement reads identically to the exported workbook.
function formatINR(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return "-";
  const abs = Math.abs(v).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `(${abs})` : abs;
}

// Single BS row spec — keeps the renderer declarative and easy to compare to
// writeBalanceSheet() in src/lib/fsExcelExport.ts.
type BSDisplayRow =
  | { kind: "section";  label: string; size?: 9 | 10; indent?: number }
  | { kind: "subhead";  label: string; noteNo?: number | null; indent?: number; code?: string }
  | { kind: "item";     label: string; noteNo?: number | null; cy: number; py: number; indent?: number; size?: 9 | 10; code?: string }
  | { kind: "spacer" }
  | { kind: "total";    label: string; cy: number; py: number }
  | { kind: "footer";   label: string; noteNo?: number | null };

function buildBSRows(bs: BSRowData): BSDisplayRow[] {
  // Section subtotals — match Excel SUM(E10:E30) and SUM(E35:E52) ranges.
  // Liabilities side = all amount rows in the E&L block (incl. zero placeholders).
  const totalEL =
    (bs.shareCap.cy || 0) + (bs.reserves.cy || 0) +
    (bs.ltBorrowings.cy || 0) + (bs.otherLtLiab.cy || 0) + (bs.ltProvisions.cy || 0) +
    (bs.stBorrowings.cy || 0) +
    (bs.tradePayMSME.cy || 0) + (bs.tradePayOthers.cy || 0) +
    (bs.otherCurrLiab.cy || 0) + (bs.stProvisions.cy || 0);
  const totalELpy =
    (bs.shareCap.py || 0) + (bs.reserves.py || 0) +
    (bs.ltBorrowings.py || 0) + (bs.otherLtLiab.py || 0) + (bs.ltProvisions.py || 0) +
    (bs.stBorrowings.py || 0) +
    (bs.tradePayMSME.py || 0) + (bs.tradePayOthers.py || 0) +
    (bs.otherCurrLiab.py || 0) + (bs.stProvisions.py || 0);
  const totalAssets =
    (bs.ppe.cy || 0) + (bs.ncInvestments.cy || 0) + (bs.dtAssets.cy || 0) +
    (bs.ltLoans.cy || 0) + (bs.otherNcAssets.cy || 0) +
    (bs.currInvestments.cy || 0) + (bs.inventories.cy || 0) + (bs.tradeRec.cy || 0) +
    (bs.cashBank.cy || 0) + (bs.stLoans.cy || 0) + (bs.otherCurrAssets.cy || 0);
  const totalAssetsPy =
    (bs.ppe.py || 0) + (bs.ncInvestments.py || 0) + (bs.dtAssets.py || 0) +
    (bs.ltLoans.py || 0) + (bs.otherNcAssets.py || 0) +
    (bs.currInvestments.py || 0) + (bs.inventories.py || 0) + (bs.tradeRec.py || 0) +
    (bs.cashBank.py || 0) + (bs.stLoans.py || 0) + (bs.otherCurrAssets.py || 0);

  return [
    // ── EQUITY & LIABILITIES ─────────────────────────────────────────────
    { kind: "section", label: "I  EQUITY AND LIABILITIES", size: 10 },
    { kind: "subhead", label: "(1) Shareholders' funds" },
    { kind: "item", label: "(a) Share capital",         noteNo: bs.shareCap.noteNo,    cy: bs.shareCap.cy || 0,    py: bs.shareCap.py || 0,    indent: 1, code: "BS_EQ_SC" },
    { kind: "item", label: "(b) Reserves and surplus",  noteNo: bs.reserves.noteNo,    cy: bs.reserves.cy || 0,    py: bs.reserves.py || 0,    indent: 1, code: "BS_EQ_RS" },
    { kind: "spacer" },
    { kind: "item", label: "(2) Share application money pending allotment", cy: 0, py: 0, size: 9 },
    { kind: "spacer" },
    { kind: "subhead", label: "(3) Non-Current liabilities" },
    { kind: "item", label: "(a) Long-term borrowings",          noteNo: bs.ltBorrowings.noteNo, cy: bs.ltBorrowings.cy || 0, py: bs.ltBorrowings.py || 0, indent: 1, code: "BS_NCL_LTB" },
    { kind: "item", label: "(b) Deferred tax liabilities (Net)", cy: 0, py: 0, indent: 1 },
    { kind: "item", label: "(c) Other Long term liabilities",   noteNo: bs.otherLtLiab.noteNo,  cy: bs.otherLtLiab.cy || 0,  py: bs.otherLtLiab.py || 0,  indent: 1, code: "BS_NCL_OLT" },
    { kind: "item", label: "(d) Long-term provisions",          noteNo: bs.ltProvisions.noteNo, cy: bs.ltProvisions.cy || 0, py: bs.ltProvisions.py || 0, indent: 1, code: "BS_NCL_LTP" },
    { kind: "spacer" },
    { kind: "subhead", label: "(4) Current liabilities" },
    { kind: "item", label: "(a) Short-term borrowings",  noteNo: bs.stBorrowings.noteNo, cy: bs.stBorrowings.cy || 0, py: bs.stBorrowings.py || 0, indent: 1, code: "BS_CL_STB" },
    { kind: "subhead", label: "(b) Trade payables", noteNo: bs.tradePayables.noteNo, indent: 1, code: "BS_CL_TP" },
    { kind: "item", label: "(i) Micro and Small Enterprises", cy: bs.tradePayMSME.cy || 0,   py: bs.tradePayMSME.py || 0,   indent: 2 },
    { kind: "item", label: "(ii) Others",                     cy: bs.tradePayOthers.cy || 0, py: bs.tradePayOthers.py || 0, indent: 2, code: "BS_CL_TP" },
    { kind: "item", label: "(c) Other current liabilities", noteNo: bs.otherCurrLiab.noteNo, cy: bs.otherCurrLiab.cy || 0, py: bs.otherCurrLiab.py || 0, indent: 1, size: 10, code: "BS_CL_OCL" },
    { kind: "item", label: "(d) Short-term provisions",     noteNo: bs.stProvisions.noteNo,  cy: bs.stProvisions.cy || 0,  py: bs.stProvisions.py || 0,  indent: 1, code: "BS_CL_STP" },
    { kind: "spacer" },
    { kind: "total", label: "TOTAL EQUITY AND LIABILITIES", cy: totalEL, py: totalELpy },
    { kind: "spacer" },
    // ── ASSETS ───────────────────────────────────────────────────────────
    { kind: "section", label: "II  ASSETS", size: 10 },
    { kind: "subhead", label: "(1) Non-Current Assets" },
    { kind: "subhead", label: "(a) Property, Plant & Equipment and Intangible Assets", indent: 1 },
    { kind: "item", label: "(i) Property, plant and equipment and Intangible Assets", noteNo: bs.ppe.noteNo, cy: bs.ppe.cy || 0, py: bs.ppe.py || 0, indent: 2, code: "BS_NCA_FA" },
    { kind: "item", label: "(ii) Intangible assets",          cy: 0, py: 0, indent: 2 },
    { kind: "item", label: "(iii) Capital work-in-Progress",  cy: 0, py: 0, indent: 2 },
    { kind: "item", label: "(b) Non-current investments",        noteNo: bs.ncInvestments.noteNo, cy: bs.ncInvestments.cy || 0, py: bs.ncInvestments.py || 0, indent: 1, size: 10, code: "BS_NCA_INV" },
    { kind: "item", label: "(c) Deferred tax assets (Net)",      noteNo: bs.dtAssets.noteNo,      cy: bs.dtAssets.cy || 0,      py: bs.dtAssets.py || 0,      indent: 1, size: 10, code: "BS_NCA_DTA" },
    { kind: "item", label: "(d) Long-term loans and advances",   noteNo: bs.ltLoans.noteNo,       cy: bs.ltLoans.cy || 0,       py: bs.ltLoans.py || 0,       indent: 1, code: "BS_NCA_LLA" },
    { kind: "item", label: "(e) Other non-current Assets",       noteNo: bs.otherNcAssets.noteNo, cy: bs.otherNcAssets.cy || 0, py: bs.otherNcAssets.py || 0, indent: 1, size: 10, code: "BS_NCA_ONA" },
    { kind: "spacer" },
    { kind: "subhead", label: "(2) Current assets" },
    { kind: "item", label: "(a) Current investments",          noteNo: bs.currInvestments.noteNo, cy: bs.currInvestments.cy || 0, py: bs.currInvestments.py || 0, indent: 1, code: "BS_CA_CI" },
    { kind: "item", label: "(b) Inventories",                  noteNo: bs.inventories.noteNo,     cy: bs.inventories.cy || 0,     py: bs.inventories.py || 0,     indent: 1, code: "BS_CA_INV" },
    { kind: "item", label: "(c) Trade receivables",            noteNo: bs.tradeRec.noteNo,        cy: bs.tradeRec.cy || 0,        py: bs.tradeRec.py || 0,        indent: 1, code: "BS_CA_TR" },
    { kind: "item", label: "(d) Cash and bank equivalents",    noteNo: bs.cashBank.noteNo,        cy: bs.cashBank.cy || 0,        py: bs.cashBank.py || 0,        indent: 1, code: "BS_CA_CCE" },
    { kind: "item", label: "(e) Short-term loans and advances",noteNo: bs.stLoans.noteNo,         cy: bs.stLoans.cy || 0,         py: bs.stLoans.py || 0,         indent: 1, code: "BS_CA_SLA" },
    { kind: "item", label: "(f) Other current assets",         noteNo: bs.otherCurrAssets.noteNo, cy: bs.otherCurrAssets.cy || 0, py: bs.otherCurrAssets.py || 0, indent: 1, code: "BS_CA_OCA" },
    { kind: "spacer" },
    { kind: "total", label: "TOTAL ASSETS", cy: totalAssets, py: totalAssetsPy },
    { kind: "footer", label: "Significant accounting policies and estimates", noteNo: bs.sigPolicies.noteNo },
    { kind: "footer", label: "The accompanying notes form an integral part of the financial statements." },
  ];
}

// Inline editable money cell — shows formatted ₹ when blurred, raw number
// while focused. Commits onBlur or Enter. Empty string clears the override.
function EditableMoneyCell({
  value,
  onCommit,
  disabled,
  className,
}: {
  value: number;
  onCommit: (next: number | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft,   setDraft]   = useState<string>("");
  if (disabled) {
    return <span className={className}>{formatINR(value)}</span>;
  }
  const display = focused ? draft : formatINR(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      title="Click to edit · clear to remove override"
      onFocus={(e) => { setFocused(true); setDraft(value === 0 ? "" : String(value)); e.currentTarget.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onBlur={() => {
        setFocused(false);
        const trimmed = draft.trim();
        if (trimmed === "") { onCommit(null); return; }
        const parsed = Number(trimmed.replace(/,/g, ""));
        if (Number.isFinite(parsed)) onCommit(parsed);
      }}
      className={cn(
        // Always-visible dashed underline so users see the cell is editable.
        // Hover deepens the border; focus uses the primary color and a soft bg.
        "w-full bg-background/40 border border-dashed border-muted-foreground/30 rounded px-1 text-right tabular-nums cursor-text",
        "hover:bg-background hover:border-muted-foreground/60 focus:border-primary focus:bg-background focus:border-solid outline-none",
        className,
      )}
    />
  );
}

// Inline editable note-No. cell. Empty string clears the override (falls
// back to the SCHEDULE_III_DIV_I default).
function EditableNoteCell({
  value,
  onCommit,
}: {
  value: number | null | undefined;
  onCommit: (next: number | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft,   setDraft]   = useState<string>("");
  const display = focused ? draft : (value ?? "");
  return (
    <input
      type="text"
      inputMode="numeric"
      value={String(display)}
      title="Click to edit note number · clear to use default"
      onFocus={(e) => { setFocused(true); setDraft(value == null ? "" : String(value)); e.currentTarget.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onBlur={() => {
        setFocused(false);
        const trimmed = draft.trim();
        if (trimmed === "") { onCommit(null); return; }
        const parsed = parseInt(trimmed, 10);
        if (Number.isFinite(parsed)) onCommit(parsed);
      }}
      className={cn(
        "w-12 bg-background/40 border border-dashed border-muted-foreground/30 rounded px-1 text-center tabular-nums cursor-text",
        "hover:bg-background hover:border-muted-foreground/60 focus:border-primary focus:bg-background focus:border-solid outline-none",
      )}
    />
  );
}

interface CorporateBalanceSheetViewProps {
  bs:            BSRowData;
  cyYear:        number;
  pyYear:        number;
  companyName:   string;
  pyLocked?:     boolean;
  onCommitCY?:   (code: string, value: number | null) => void;
  onCommitPY?:   (code: string, value: number | null) => void;
  onEditNote?:   (code: string, value: number | null) => void;
}

function CorporateBalanceSheetView({
  bs, cyYear, pyYear, companyName, pyLocked,
  onCommitCY, onCommitPY, onEditNote,
}: CorporateBalanceSheetViewProps) {
  const rows = buildBSRows(bs);
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Title block — mirrors rows 2–7 of the exported sheet */}
      <div className="text-center border-b bg-muted/30 py-2 px-3">
        <div className="font-bold text-sm">{companyName}</div>
        <div className="text-xs mt-0.5">Balance Sheet as at 31st March, {cyYear}</div>
        <div className="text-[10px] text-muted-foreground italic mt-0.5">(Amount in ₹)</div>
        {(onCommitCY || onCommitPY || onEditNote) && (
          <div className="text-[10px] text-primary mt-1">
            <Pencil className="inline w-2.5 h-2.5 mr-0.5" />
            Click any dashed cell (Note No. / CY / PY) to edit · Enter / Tab to save · clear to revert
          </div>
        )}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-left font-semibold py-2 px-3 w-[55%]">Particulars</th>
            <th className="text-center font-semibold py-2 px-2 w-[8%]">Note No.</th>
            <th className="text-right font-semibold py-2 px-3 w-[18%]">
              As at<br />31st March, {cyYear}
            </th>
            <th className="text-right font-semibold py-2 px-3 w-[19%]">
              <span className="inline-flex flex-col items-end gap-0.5">
                <span>As at<br />31st March, {pyYear}</span>
                {pyLocked && (
                  <Badge className="text-[8px] px-1 bg-amber-100 text-amber-700 border-amber-300 gap-0.5">
                    <Lock size={7} /> Finalized
                  </Badge>
                )}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.kind === "spacer") {
              return <tr key={idx}><td colSpan={4} className="h-2" /></tr>;
            }
            if (row.kind === "section") {
              return (
                <tr key={idx} className="bg-muted/20">
                  <td colSpan={4} className="font-bold py-1.5 px-3 text-[13px]">{row.label}</td>
                </tr>
              );
            }
            if (row.kind === "subhead") {
              const indentPx = (row.indent || 0) * 16;
              return (
                <tr key={idx}>
                  <td className="font-semibold py-1 px-3" style={{ paddingLeft: 12 + indentPx }}>{row.label}</td>
                  <td className="text-center py-1 px-2 text-muted-foreground">
                    {row.code && onEditNote ? (
                      <EditableNoteCell value={row.noteNo ?? null} onCommit={(v) => onEditNote(row.code!, v)} />
                    ) : (row.noteNo ?? "")}
                  </td>
                  <td />
                  <td />
                </tr>
              );
            }
            if (row.kind === "total") {
              return (
                <tr key={idx} className="border-t-2 border-foreground/40 bg-muted/30">
                  <td className="font-bold py-1.5 px-3 uppercase text-[12px]" colSpan={2}>{row.label}</td>
                  <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.cy)}</td>
                  <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.py)}</td>
                </tr>
              );
            }
            if (row.kind === "footer") {
              return (
                <tr key={idx}>
                  <td className="font-semibold py-1 px-3 text-[11px] italic text-muted-foreground" colSpan={3}>{row.label}</td>
                  <td className="text-center py-1 px-2 text-muted-foreground italic">{row.noteNo ?? ""}</td>
                </tr>
              );
            }
            // item
            const indentPx = (row.indent || 0) * 16;
            const fontSize = row.size === 10 ? "text-[12px]" : "text-[11px]";
            const editableNote = !!row.code && !!onEditNote;
            const editableCY   = !!row.code && !!onCommitCY;
            const editablePY   = !!row.code && !!onCommitPY && !pyLocked;
            return (
              <tr key={idx} className="hover:bg-muted/10">
                <td className={`py-0.5 px-3 ${fontSize}`} style={{ paddingLeft: 12 + indentPx }}>{row.label}</td>
                <td className="text-center py-0.5 px-2 text-muted-foreground">
                  {editableNote
                    ? <EditableNoteCell value={row.noteNo ?? null} onCommit={(v) => onEditNote!(row.code!, v)} />
                    : (row.noteNo ?? "")}
                </td>
                <td className={`text-right tabular-nums py-0.5 px-1 ${fontSize}`}>
                  {editableCY
                    ? <EditableMoneyCell value={row.cy} onCommit={(v) => onCommitCY!(row.code!, v)} />
                    : formatINR(row.cy)}
                </td>
                <td className={`text-right tabular-nums py-0.5 px-1 ${fontSize}`}>
                  {editablePY
                    ? <EditableMoneyCell value={row.py} onCommit={(v) => onCommitPY!(row.code!, v)} />
                    : formatINR(row.py)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Phase UI-3 — Statement of Profit & Loss (in-UI render)
// ─────────────────────────────────────────────────────────────────────────
// Mirrors writeProfitAndLoss() in src/lib/fsExcelExport.ts row-by-row:
// Roman numerals I–XV in the leftmost column, particulars / note no /
// CY / PY in the remaining four. Subtotals (III, V, IX, XV, Total Expenses)
// are rendered bold with a top rule.

type PLDisplayRow =
  | { kind: "spacer" }
  | { kind: "header";   roman?: string; label: string }              // bold section header e.g. "IV. Expenses"
  | { kind: "item";     roman?: string; label: string; noteNo?: number | null; cy?: number; py?: number; bold?: boolean; indent?: number }
  | { kind: "total";    roman?: string; label: string; cy: number; py: number }
  | { kind: "subnote";  label: string; bold?: boolean }              // helper line e.g. "(III-IV)"
  | { kind: "footer";   label: string };

function buildPLRows(pl: PLRowData): PLDisplayRow[] {
  const totalIncomeCy = (pl.revFromOps.cy || 0) + (pl.otherIncome.cy || 0);
  const totalIncomePy = (pl.revFromOps.py || 0) + (pl.otherIncome.py || 0);
  // Total Expenses excludes "Cost of materials consumed" (Excel row 14 has
  // note-no only, no amounts); SUM(G15:G20) covers rows 15–20.
  const totalExpensesCy =
    (pl.purchasesStock.cy || 0) + (pl.changesInventories.cy || 0) +
    (pl.employeeBenefits.cy || 0) + (pl.financeCosts.cy || 0) +
    (pl.depreciation.cy || 0)    + (pl.otherExpenses.cy || 0);
  const totalExpensesPy =
    (pl.purchasesStock.py || 0) + (pl.changesInventories.py || 0) +
    (pl.employeeBenefits.py || 0) + (pl.financeCosts.py || 0) +
    (pl.depreciation.py || 0)    + (pl.otherExpenses.py || 0);

  const pbExceptionalCy = totalIncomeCy - totalExpensesCy;        // V
  const pbExceptionalPy = totalIncomePy - totalExpensesPy;
  const exceptionalCy = 0;
  const exceptionalPy = 0;
  const pbExtraordinaryCy = pbExceptionalCy - exceptionalCy;       // VII
  const pbExtraordinaryPy = pbExceptionalPy - exceptionalPy;
  const extraordinaryCy = 0;
  const extraordinaryPy = 0;
  const pbtCy = pbExtraordinaryCy - extraordinaryCy;               // IX
  const pbtPy = pbExtraordinaryPy - extraordinaryPy;
  const currentTaxCy = pl.currentTax.cy || 0;
  const currentTaxPy = pl.currentTax.py || 0;
  const deferredTaxCy = pl.deferredTax.cy || 0;
  const deferredTaxPy = pl.deferredTax.py || 0;
  // Match Excel: CY = IX - currentTax + deferredTax ; PY = IX - currentTax - deferredTax
  const profitCy = pbtCy - currentTaxCy + deferredTaxCy;           // XV
  const profitPy = pbtPy - currentTaxPy - deferredTaxPy;
  const epsDivisor = pl.shareCap.noteNo || 1;
  const epsBasicCy = profitCy / epsDivisor;
  const epsBasicPy = profitPy / epsDivisor;

  return [
    { kind: "item",   roman: "I.",   label: "Revenue from operations", noteNo: pl.revFromOps.noteNo, cy: pl.revFromOps.cy, py: pl.revFromOps.py },
    { kind: "item",   roman: "II.",  label: "Other income",            noteNo: pl.otherIncome.noteNo, cy: pl.otherIncome.cy, py: pl.otherIncome.py },
    { kind: "total",  roman: "III.", label: "Total Income (I+II)",     cy: totalIncomeCy, py: totalIncomePy },
    { kind: "spacer" },
    { kind: "header", roman: "IV.",  label: "Expenses" },
    { kind: "item",   label: "Cost of materials consumed",            noteNo: pl.costMaterials.noteNo, indent: 1 },
    { kind: "item",   label: "Purchases of Stock-in-Trade",           noteNo: pl.purchasesStock.noteNo, cy: pl.purchasesStock.cy, py: pl.purchasesStock.py, indent: 1 },
    { kind: "item",   label: "Changes in inventories of finished goods, Work-in-progress and Stock-in-Trade", noteNo: pl.changesInventories.noteNo, cy: pl.changesInventories.cy, py: pl.changesInventories.py, indent: 1 },
    { kind: "item",   label: "Employee benefits expense",             noteNo: pl.employeeBenefits.noteNo, cy: pl.employeeBenefits.cy, py: pl.employeeBenefits.py, indent: 1 },
    { kind: "item",   label: "Finance Costs",                         noteNo: pl.financeCosts.noteNo, cy: pl.financeCosts.cy, py: pl.financeCosts.py, indent: 1 },
    { kind: "item",   label: "Depreciation & Amortisation Expenses",  noteNo: pl.depreciation.noteNo, cy: pl.depreciation.cy, py: pl.depreciation.py, indent: 1 },
    { kind: "item",   label: "Other expenses",                        noteNo: pl.otherExpenses.noteNo, cy: pl.otherExpenses.cy, py: pl.otherExpenses.py, indent: 1 },
    { kind: "total",  label: "Total Expenses",                        cy: totalExpensesCy, py: totalExpensesPy },
    { kind: "spacer" },
    { kind: "item",   roman: "V.",   label: "Profit before exceptional and extraordinary items and tax", cy: pbExceptionalCy, py: pbExceptionalPy, bold: true },
    { kind: "subnote", label: "(III-IV)", bold: true },
    { kind: "item",   roman: "VI.",  label: "Exceptional items",      cy: exceptionalCy, py: exceptionalPy },
    { kind: "item",   roman: "VII.", label: "Profit before extraordinary items and tax (V-VI)", cy: pbExtraordinaryCy, py: pbExtraordinaryPy, bold: true },
    { kind: "item",   roman: "VIII.",label: "Extraordinary items",    cy: extraordinaryCy, py: extraordinaryPy },
    { kind: "item",   roman: "IX.",  label: "Profit before tax (VII-VIII)", cy: pbtCy, py: pbtPy, bold: true },
    { kind: "header", roman: "X.",   label: "Tax expense:" },
    { kind: "item",   label: "(1) Current tax",  cy: currentTaxCy, py: currentTaxPy, indent: 2 },
    { kind: "item",   label: "(2) Deferred tax", cy: deferredTaxCy, py: deferredTaxPy, indent: 2 },
    { kind: "item",   roman: "XI.",  label: "Profit (loss) for period from continuing operations", bold: true },
    { kind: "subnote", label: "(VII-VIII)", bold: true },
    { kind: "item",   roman: "XII.", label: "Profit (loss) for period from discontinuing operations" },
    { kind: "item",   roman: "XIII.",label: "Tax expense of discontinuing operations" },
    { kind: "item",   roman: "XIV.", label: "Profit (loss) from discontinuing operations (after tax)", bold: true },
    { kind: "subnote", label: "(XII-XIII)", bold: true },
    { kind: "total",  roman: "XV.",  label: "Profit / (Loss) for the period (XI+XIV)", cy: profitCy, py: profitPy },
    { kind: "spacer" },
    { kind: "item",   label: "Earnings per equity share ;", noteNo: pl.eps.noteNo, bold: true },
    { kind: "item",   label: "(1) Basic",   cy: epsBasicCy, py: epsBasicPy, indent: 2 },
    { kind: "item",   label: "(2) Diluted", indent: 2 },
    { kind: "footer", label: "The accompanying notes form an integral part of the financial statements." },
  ];
}

interface CorporatePLViewProps {
  pl:          PLRowData;
  cyYear:      number;
  pyYear:      number;
  companyName: string;
  pyLocked?:   boolean;
}

function CorporatePLView({ pl, cyYear, pyYear, companyName, pyLocked }: CorporatePLViewProps) {
  const rows = buildPLRows(pl);
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="text-center border-b bg-muted/30 py-2 px-3">
        <div className="font-bold text-sm">{companyName}</div>
        <div className="text-xs mt-0.5">
          Statement of Profit &amp; Loss Account for the year ended 31st March, {cyYear}
        </div>
        <div className="text-[10px] text-muted-foreground italic mt-0.5">(Amount in ₹)</div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-center font-semibold py-2 px-1 w-[5%]"></th>
            <th className="text-left font-semibold py-2 px-3 w-[50%]">Particulars</th>
            <th className="text-center font-semibold py-2 px-2 w-[8%]">Note No.</th>
            <th className="text-right font-semibold py-2 px-3 w-[18%]">
              For the year ended<br />31st March, {cyYear}
            </th>
            <th className="text-right font-semibold py-2 px-3 w-[19%]">
              <span className="inline-flex flex-col items-end gap-0.5">
                <span>For the year ended<br />31st March, {pyYear}</span>
                {pyLocked && (
                  <Badge className="text-[8px] px-1 bg-amber-100 text-amber-700 border-amber-300 gap-0.5">
                    <Lock size={7} /> Finalized
                  </Badge>
                )}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.kind === "spacer") {
              return <tr key={idx}><td colSpan={5} className="h-2" /></tr>;
            }
            if (row.kind === "subnote") {
              return (
                <tr key={idx}>
                  <td />
                  <td colSpan={4} className={`py-0.5 px-3 ${row.bold ? "font-bold" : ""} text-[11px]`}>{row.label}</td>
                </tr>
              );
            }
            if (row.kind === "footer") {
              return (
                <tr key={idx}>
                  <td />
                  <td colSpan={4} className="py-1 px-3 text-[11px] italic text-muted-foreground">{row.label}</td>
                </tr>
              );
            }
            if (row.kind === "header") {
              return (
                <tr key={idx} className="bg-muted/20">
                  <td className="text-center font-bold py-1 px-1 text-[12px]">{row.roman || ""}</td>
                  <td colSpan={4} className="font-bold py-1 px-3 text-[12px]">{row.label}</td>
                </tr>
              );
            }
            if (row.kind === "total") {
              return (
                <tr key={idx} className="border-t-2 border-foreground/40 bg-muted/30">
                  <td className="text-center font-bold py-1.5 px-1 text-[12px]">{row.roman || ""}</td>
                  <td className="font-bold py-1.5 px-3 text-[12px]">{row.label}</td>
                  <td />
                  <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.cy)}</td>
                  <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.py)}</td>
                </tr>
              );
            }
            // item
            const indentPx = (row.indent || 0) * 16;
            const boldCls = row.bold ? "font-bold" : "";
            return (
              <tr key={idx} className="hover:bg-muted/10">
                <td className={`text-center py-0.5 px-1 ${boldCls} text-[11px]`}>{row.roman || ""}</td>
                <td className={`py-0.5 px-3 ${boldCls} text-[11px]`} style={{ paddingLeft: 12 + indentPx }}>{row.label}</td>
                <td className="text-center py-0.5 px-2 text-muted-foreground">{row.noteNo ?? ""}</td>
                <td className={`text-right tabular-nums py-0.5 px-3 ${boldCls} text-[11px]`}>
                  {row.cy === undefined ? "" : formatINR(row.cy)}
                </td>
                <td className={`text-right tabular-nums py-0.5 px-3 ${boldCls} text-[11px]`}>
                  {row.py === undefined ? "" : formatINR(row.py)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Phase UI-4 — Cash Flow Statement (in-UI render, AS-3 Indirect Method)
// ─────────────────────────────────────────────────────────────────────────
// Mirrors writeCashFlow() in src/lib/fsExcelExport.ts row-by-row.
// Sections: A Operating, B Investing, C Financing, then opening + closing
// cash reconciliation. Several adjustment rows are label-only placeholders
// in the template (Interest income, Profit on sale, Interest expense,
// Short term provision, Interest Paid, Loan repayments) — caller fills
// those manually in the exported sheet. The UI mirrors that, leaving
// those rows blank.

type CFDisplayRow =
  | { kind: "spacer" }
  | { kind: "section"; letter?: string; label: string }
  | { kind: "subhead"; label: string; bold?: boolean }
  | { kind: "item";    label: string; cy?: number; py?: number; bold?: boolean; size?: 9 | 10; rowKey?: string; editable?: boolean }
  | { kind: "total";   label: string; cy: number; py: number };

function buildCFRows(
  bs: BSRowData,
  pl: PLRowData,
  cfs: CFSRowData,
  overrides: Record<string, { cy?: number; py?: number }> = {},
): CFDisplayRow[] {
  // Effective-value helper: override beats default; null/undefined ignored.
  const eff = (key: string, period: "cy" | "py", fallback: number): number => {
    const o = overrides[key];
    const v = o?.[period];
    return Number.isFinite(v as number) ? (v as number) : fallback;
  };

  // ── Operating activities (Section A) ──────────────────────────────────
  const pbtCy = eff("pbt", "cy", pl.pbt.cy || 0);
  const pbtPy = eff("pbt", "py", pl.pbt.py || 0);
  const depCy = eff("dep", "cy", pl.depreciation.cy || 0);
  const depPy = eff("dep", "py", pl.depreciation.py || 0);
  const intIncCy = eff("intInc", "cy", 0);
  const intIncPy = eff("intInc", "py", 0);
  const profSaleCy = eff("profSale", "cy", 0);
  const profSalePy = eff("profSale", "py", 0);
  const intExpCy = eff("intExp", "cy", 0);
  const intExpPy = eff("intExp", "py", 0);
  // Operating profit before WC = pbt + dep + intInc + profSale + intExp
  const opProfCy = pbtCy + depCy + intIncCy + profSaleCy + intExpCy;
  const opProfPy = pbtPy + depPy + intIncPy + profSalePy + intExpPy;

  const tradePayCy = eff("tradePay", "cy", cfs.tradePayChange.cy || 0);
  const tradePayPy = eff("tradePay", "py", 0);
  const otherClCy  = eff("otherCl", "cy", cfs.otherCurrLiabChange.cy || 0);
  const otherClPy  = eff("otherCl", "py", 0);
  const invCy      = eff("inv", "cy", (bs.inventories.py || 0) - (bs.inventories.cy || 0));
  const invPy      = eff("inv", "py", 0);
  const trCy       = eff("tradeRec", "cy", (bs.tradeRec.py || 0) - (bs.tradeRec.cy || 0));
  const trPy       = eff("tradeRec", "py", 0);
  const stProvCy   = eff("stProv", "cy", 0);
  const stProvPy   = eff("stProv", "py", 0);
  const otherCaCy  = eff("otherCa", "cy", cfs.otherCurrAssetsChange.cy || 0);
  const otherCaPy  = eff("otherCa", "py", 0);

  // Cash generated from operations = OpProf + all WC changes
  const cashFromOpsCy = opProfCy + tradePayCy + otherClCy + invCy + trCy + stProvCy + otherCaCy;
  const cashFromOpsPy = opProfPy + tradePayPy + otherClPy + invPy + trPy + stProvPy + otherCaPy;
  const taxPaidCy = eff("taxPaid", "cy", cfs.incomeTaxPaid.cy ?? 0);
  const taxPaidPy = eff("taxPaid", "py", 0);
  // Net cash from operating (A) = cashFromOps + taxPaid (matches writer formula H24+H25)
  const netOpCy = cashFromOpsCy + taxPaidCy;
  const netOpPy = cashFromOpsPy + taxPaidPy;

  // ── Investing activities (Section B) ──────────────────────────────────
  const ppeOutCy = eff("ppe", "cy", -(cfs.ppePurchases.cy || 0));
  const ppeOutPy = eff("ppe", "py", 0);
  const intIncInvCy = eff("intIncInv", "cy", 0);
  const intIncInvPy = eff("intIncInv", "py", 0);
  const netInvCy = ppeOutCy + intIncInvCy;
  const netInvPy = ppeOutPy + intIncInvPy;

  // ── Financing activities (Section C) ──────────────────────────────────
  const shareProcCy = eff("shareProc", "cy", 0);
  const shareProcPy = eff("shareProc", "py", 0);
  const ltBorrCy = eff("ltBorr", "cy", 0);
  const ltBorrPy = eff("ltBorr", "py", 0);
  const otherLoanCy = eff("otherLoan", "cy", 0);
  const otherLoanPy = eff("otherLoan", "py", 0);
  const intPaidCy = eff("intPaid", "cy", 0);
  const intPaidPy = eff("intPaid", "py", 0);
  const netFinCy = shareProcCy + ltBorrCy + otherLoanCy + intPaidCy;
  const netFinPy = shareProcPy + ltBorrPy + otherLoanPy + intPaidPy;

  // ── Reconciliation ────────────────────────────────────────────────────
  const netIncCy = netOpCy + netInvCy + netFinCy;
  const netIncPy = netOpPy + netInvPy + netFinPy;
  // Opening cash defaults to BS PY closing (more useful than the template's
  // hardcoded 0); user can still override.
  const openCy = eff("openCash", "cy", bs.cashBank.py || 0);
  const openPy = eff("openCash", "py", 0);
  const closeCy = netIncCy + openCy;
  const closePy = netIncPy + openPy;

  return [
    { kind: "section", letter: "A.", label: "Cash flows from operating activities" },
    { kind: "item",    label: "Net profit before tax", cy: pbtCy, py: pbtPy, bold: true, size: 10, rowKey: "pbt", editable: true },
    { kind: "subhead", label: "Adjustments for:" },
    { kind: "item",    label: "Depreciation expense", cy: depCy, py: depPy, rowKey: "dep", editable: true },
    { kind: "item",    label: "Interest income",       cy: intIncCy,   py: intIncPy,   rowKey: "intInc",   editable: true },
    { kind: "item",    label: "Profit on sale of assets", cy: profSaleCy, py: profSalePy, rowKey: "profSale", editable: true },
    { kind: "item",    label: "Interest expense",      cy: intExpCy,   py: intExpPy,   rowKey: "intExp",   editable: true },
    { kind: "item",    label: "Operating profit before working capital changes", cy: opProfCy, py: opProfPy, bold: true },
    { kind: "subhead", label: "Changes in working capital:", bold: true },
    { kind: "item",    label: "Trade payables",          cy: tradePayCy, py: tradePayPy, rowKey: "tradePay", editable: true },
    { kind: "item",    label: "Other current liabilities", cy: otherClCy, py: otherClPy, size: 10, rowKey: "otherCl", editable: true },
    { kind: "item",    label: "Inventories",             cy: invCy,      py: invPy,      rowKey: "inv",      editable: true },
    { kind: "item",    label: "Trade receivables",        cy: trCy,       py: trPy,       rowKey: "tradeRec", editable: true },
    { kind: "item",    label: "Short term provision",     cy: stProvCy,   py: stProvPy,   rowKey: "stProv",   editable: true },
    { kind: "item",    label: "Other current assets",     cy: otherCaCy,  py: otherCaPy,  size: 10, rowKey: "otherCa", editable: true },
    { kind: "item",    label: "Cash generated from operations", cy: cashFromOpsCy, py: cashFromOpsPy, bold: true },
    { kind: "item",    label: "Income tax paid",          cy: taxPaidCy,  py: taxPaidPy,  size: 10, rowKey: "taxPaid", editable: true },
    { kind: "total",   label: "Net cash generated from operating activities (A)", cy: netOpCy, py: netOpPy },
    { kind: "spacer" },
    { kind: "section", letter: "B.", label: "Cash flows from investing activities" },
    { kind: "item",    label: "Purchase of property, plant & equipments", cy: ppeOutCy, py: ppeOutPy, rowKey: "ppe", editable: true },
    { kind: "item",    label: "Interest Income",                          cy: intIncInvCy, py: intIncInvPy, rowKey: "intIncInv", editable: true },
    { kind: "total",   label: "Net cash used in investing activities (B)", cy: netInvCy, py: netInvPy },
    { kind: "spacer" },
    { kind: "section", letter: "C.", label: "Cash flows from financing activities" },
    { kind: "item",    label: "Proceeds from issue of share capital",         cy: shareProcCy, py: shareProcPy, rowKey: "shareProc", editable: true },
    { kind: "item",    label: "Proceeds / Repayment of long-term Borrowings", cy: ltBorrCy,    py: ltBorrPy,    rowKey: "ltBorr",    editable: true },
    { kind: "item",    label: "Payment of Other Loan term Liabilities",       cy: otherLoanCy, py: otherLoanPy, rowKey: "otherLoan", editable: true },
    { kind: "item",    label: "Interest Paid",                                cy: intPaidCy,   py: intPaidPy,   rowKey: "intPaid",   editable: true },
    { kind: "total",   label: "Net cash used in financing activities (C)", cy: netFinCy, py: netFinPy },
    { kind: "spacer" },
    { kind: "item",    label: "Net increase in cash and cash equivalents (A+B+C)", cy: netIncCy, py: netIncPy, bold: true },
    { kind: "item",    label: "Cash and cash equivalents at the beginning of period", cy: openCy, py: openPy, rowKey: "openCash", editable: true },
    { kind: "total",   label: "Cash and cash equivalents at the end of period", cy: closeCy, py: closePy },
  ];
}

interface CorporateCFViewProps {
  bs:          BSRowData;
  pl:          PLRowData;
  cfs:         CFSRowData;
  cyYear:      number;
  pyYear:      number;
  companyName: string;
  overrides?:  Record<string, { cy?: number; py?: number }>;
  onCommit?:   (rowKey: string, period: "cy" | "py", value: number | null) => void;
}

function CorporateCFView({ bs, pl, cfs, cyYear, pyYear, companyName, overrides, onCommit }: CorporateCFViewProps) {
  const rows = buildCFRows(bs, pl, cfs, overrides);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="text-center border-b bg-muted/30 py-2 px-3">
          <div className="font-bold text-sm">{companyName}</div>
          <div className="text-xs mt-0.5">Cash Flow Statement for the year ended [31 March {cyYear}]</div>
          <div className="text-[10px] text-muted-foreground italic mt-0.5">(Amount in ₹)</div>
          <div className="text-[10px] text-primary mt-1">
            <Pencil className="inline w-2.5 h-2.5 mr-0.5" />
            Click any dashed cell to edit · Enter / Tab to save · clear to revert
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-center font-semibold py-2 px-1 w-[5%]"></th>
              <th className="text-left font-semibold py-2 px-3 w-[55%]">Particulars</th>
              <th className="text-right font-semibold py-2 px-3 w-[20%]">As at<br />31st March, {cyYear}</th>
              <th className="text-right font-semibold py-2 px-3 w-[20%]">As at<br />31st March, {pyYear}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              if (row.kind === "spacer") {
                return <tr key={idx}><td colSpan={4} className="h-2" /></tr>;
              }
              if (row.kind === "section") {
                return (
                  <tr key={idx} className="bg-muted/20">
                    <td className="text-center font-bold py-1.5 px-1 text-[12px]">{row.letter || ""}</td>
                    <td colSpan={3} className="font-bold py-1.5 px-3 text-[12px]">{row.label}</td>
                  </tr>
                );
              }
              if (row.kind === "subhead") {
                return (
                  <tr key={idx}>
                    <td />
                    <td colSpan={3} className={`py-0.5 px-3 ${row.bold ? "font-bold" : "font-semibold"} text-[11px]`}>{row.label}</td>
                  </tr>
                );
              }
              if (row.kind === "total") {
                return (
                  <tr key={idx} className="border-t-2 border-foreground/40 bg-muted/30">
                    <td />
                    <td className="font-bold py-1.5 px-3 text-[12px]">{row.label}</td>
                    <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.cy)}</td>
                    <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.py)}</td>
                  </tr>
                );
              }
              // item
              const boldCls = row.bold ? "font-bold" : "";
              const fontSize = row.size === 10 ? "text-[12px]" : "text-[11px]";
              const editable = !!row.editable && !!row.rowKey && !!onCommit;
              return (
                <tr key={idx} className="hover:bg-muted/10">
                  <td />
                  <td className={`py-0.5 px-3 ${boldCls} ${fontSize}`} style={{ paddingLeft: 24 }}>{row.label}</td>
                  <td className={`text-right tabular-nums py-0.5 px-1 ${boldCls} ${fontSize}`}>
                    {editable
                      ? <EditableMoneyCell value={row.cy ?? 0} onCommit={(v) => onCommit!(row.rowKey!, "cy", v)} />
                      : (row.cy === undefined ? "" : formatINR(row.cy))}
                  </td>
                  <td className={`text-right tabular-nums py-0.5 px-1 ${boldCls} ${fontSize}`}>
                    {editable
                      ? <EditableMoneyCell value={row.py ?? 0} onCommit={(v) => onCommit!(row.rowKey!, "py", v)} />
                      : (row.py === undefined ? "" : formatINR(row.py))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border bg-muted/10 p-3 text-[11px] text-muted-foreground space-y-1">
        <p className="font-semibold">Notes to cash flow statement</p>
        <p>
          The above cash flow statement has been prepared in accordance with the
          &lsquo;Indirect method&rsquo; as set out in Accounting Standard&nbsp;-&nbsp;3
          on &lsquo;Cash Flow Statements&rsquo;.
        </p>
        <p className="italic">
          Adjustment rows shown without amounts (Interest income, Profit on sale of assets,
          Interest expense, Short term provision, Loan repayments, Interest Paid) are
          template placeholders — fill them manually in the exported workbook if applicable.
          Opening cash balance is treated as a manual fill in the template.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Corporate signature block — shown below BS / P&L / CFS statements
// ─────────────────────────────────────────────────────────────────────────
// Mirrors the template signature block: auditor side (firm + partner),
// company side (board of directors), three signatory columns + Place + Date
// repeated under each column. Audit firm details are auto-fetched and
// read-only; director details are inline-editable and persisted in
// localStorage; Place + Date are also editable.

interface CorporateSignatureBlockProps {
  firmName:        string;
  firmRegNo:       string;
  partnerName:     string;
  partnerMemNo:    string;
  companyName:     string;
  dir1Name:        string;
  dir1Din:         string;
  dir2Name:        string;
  dir2Din:         string;
  onChangeDir:     (field: "dir1Name" | "dir1Din" | "dir2Name" | "dir2Din", value: string) => void;
  place:           string;
  onChangePlace:   (value: string) => void;
  date:            string;       // ISO yyyy-mm-dd
  onChangeDate:    (value: string) => void;
}

function CorporateSignatureBlock({
  firmName, firmRegNo, partnerName, partnerMemNo, companyName,
  dir1Name, dir1Din, dir2Name, dir2Din, onChangeDir,
  place, onChangePlace, date, onChangeDate,
}: CorporateSignatureBlockProps) {
  // Inline editable plain-text input — minimal styling, dashed border on
  // hover to signal editability (matches the BS / CFS amount cells).
  const editableCls =
    "bg-background/40 border border-dashed border-muted-foreground/30 rounded px-1 cursor-text " +
    "hover:bg-background hover:border-muted-foreground/60 focus:border-primary focus:bg-background focus:border-solid outline-none";

  return (
    <div className="mt-4 rounded-lg border bg-card px-4 py-4 text-[11px] space-y-3">
      <div>As per our Audit Report of even date</div>

      {/* Firm header / Board header */}
      <div className="grid grid-cols-2 gap-x-8">
        <div>
          <div className="font-bold">For {firmName || "[Statutory Auditor Name]"}</div>
          <div>Chartered Accountants</div>
          <div>Firm's Registration No.: {firmRegNo || "[FRN]"}</div>
        </div>
        <div>
          <div>For and on behalf of the Board of Directors of</div>
          <div className="font-bold">{companyName || "[Name of the Company]"}</div>
        </div>
      </div>

      {/* Signatures — 3 columns */}
      <div className="grid grid-cols-3 gap-x-6 pt-6">
        {/* Partner */}
        <div className="space-y-0.5">
          <div className="font-bold">{partnerName || "[Signing Partner / Proprietor]"}</div>
          <div>Partner</div>
          <div>Membership No.: {partnerMemNo || "—"}</div>
        </div>
        {/* Director 1 */}
        <div className="space-y-1">
          <input
            type="text"
            placeholder="[Director Name]"
            value={dir1Name}
            onChange={(e) => onChangeDir("dir1Name", e.target.value)}
            className={cn(editableCls, "w-full font-bold")}
          />
          <div>Director</div>
          <div className="flex items-center gap-1">
            <span className="shrink-0">DIN:</span>
            <input
              type="text"
              placeholder="—"
              value={dir1Din}
              onChange={(e) => onChangeDir("dir1Din", e.target.value)}
              className={cn(editableCls, "flex-1")}
            />
          </div>
        </div>
        {/* Director 2 */}
        <div className="space-y-1">
          <input
            type="text"
            placeholder="[Director Name]"
            value={dir2Name}
            onChange={(e) => onChangeDir("dir2Name", e.target.value)}
            className={cn(editableCls, "w-full font-bold")}
          />
          <div>Director</div>
          <div className="flex items-center gap-1">
            <span className="shrink-0">DIN:</span>
            <input
              type="text"
              placeholder="—"
              value={dir2Din}
              onChange={(e) => onChangeDir("dir2Din", e.target.value)}
              className={cn(editableCls, "flex-1")}
            />
          </div>
        </div>
      </div>

      {/* Place + Date row — 3 columns matching signatures */}
      <div className="grid grid-cols-3 gap-x-6 pt-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="space-y-0.5">
            <div className="flex items-center gap-1">
              <span className="shrink-0">Place:</span>
              <input
                type="text"
                value={place}
                onChange={(e) => onChangePlace(e.target.value)}
                className={cn(editableCls, "flex-1")}
                placeholder="Ahmedabad"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="shrink-0">Date:</span>
              <input
                type="date"
                value={date}
                onChange={(e) => onChangeDate(e.target.value)}
                className={cn(editableCls, "flex-1")}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
export default function PipelineFinancialStatements({
  engagementId,
  engagement,
  onStageComplete,
  onSaveDraft,
}: PipelineFinancialStatementsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  // ─── Entity-type gate ─────────────────────────────────────────────────────
  // Single source of truth: checks engagement.entity_type (set on the engagement)
  // then falls back to clients.entity_type (set on the client record).
  const entityType: string =
    (engagement?.entity_type || engagement?.clients?.entity_type || "").trim();
  const isNonCorporate: boolean = NON_CORPORATE_TYPES.some(
    t => t.toLowerCase() === entityType.toLowerCase()
  );

  // Active row tree and flat list — swaps between NCE and corporate at runtime.
  // The corporate constants (SCHEDULE_III_DIV_I, FLAT_ITEMS) are never mutated.
  const activeTree   = isNonCorporate ? NCE_FS_ITEMS   : SCHEDULE_III_DIV_I;
  const activeFlatItems = isNonCorporate ? NCE_FLAT_ITEMS : FLAT_ITEMS;

  // ─── Comparative year ─────────────────────────────────────────────────────
  // engagement.financial_year format: "2025-26"  → CY = 2026, PY = 2025
  const fyStr  = engagement?.financial_year || "";
  const fyPart = fyStr.split("-")[1];
  const cyYear = fyPart ? parseInt(fyPart) + 2000 : new Date().getFullYear();
  const pyYear = cyYear - 1;

  // ─── Override dialog state ───
  const [overrideDialog, setOverrideDialog] = useState<{ code: string; name: string } | null>(null);
  const [overrideAmount, setOverrideAmount] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState<string>("");

  // ─── Manual overrides & PY amounts ───
  const [manualOverrides, setManualOverrides] = useState<Record<string, { amount: number; reason: string }>>({});
  const [pyAmounts, setPyAmounts] = useState<Record<string, number>>({});
  // ─── Manual PY P&L entry (used only when no prior engagement exists) ────
  const [pyManualAmounts, setPyManualAmounts] = useState<Record<string, number>>({});
  const [pyManualDirty,   setPyManualDirty]   = useState(false);
  const [pyManualSaving,  setPyManualSaving]  = useState(false);

  // ─── PY override meta — attribution per line-item code ───────────────────
  // Stored alongside py_manual_amounts in DB as { v, by, at } objects.
  const [pyManualMeta, setPyManualMeta] = useState<Record<string, { by: string; at: string }>>({});

  // ─── PY override dialog ───────────────────────────────────────────────────
  const [pyOverrideDialog, setPyOverrideDialog] = useState<{ code: string; name: string } | null>(null);
  const [pyOverrideAmount, setPyOverrideAmount] = useState<string>("");

  // ─── Note-No. overrides (Phase UI-2 fix) ─────────────────────────────────
  // Auditors sometimes renumber notes (e.g. shift Share Capital from N3 to N4
  // because of Significant Accounting Policies layout changes). The default
  // mapping comes from SCHEDULE_III_DIV_I, but a per-engagement override is
  // stored locally in localStorage (no DB column yet — keep this scoped).
  // Shape: Record<FS_CODE, number>.
  // Storage value semantics:
  //   undefined  → no override; use SCHEDULE_III_DIV_I default
  //   null       → explicit hide; render blank cell + omit from Excel export
  //   number     → user-supplied override
  // Clearing a cell stores `null` (NOT delete) so the blank persists across
  // refreshes and survives Save Draft. To restore the default, the user types
  // the desired number back in.
  const NOTE_OVR_KEY = `caflow:fs_note_overrides:${engagementId}`;
  const [noteOverrides, setNoteOverrides] = useState<Record<string, number | null>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(NOTE_OVR_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const updateNoteOverride = (code: string, value: number | null) => {
    setNoteOverrides(prev => {
      const next = { ...prev };
      // Always set the key — even null. Null = explicit hide. Only a number
      // value beats the default; non-finite numbers are also treated as hide.
      if (value === null) next[code] = null;
      else if (Number.isFinite(value)) next[code] = value;
      else next[code] = null;
      try { window.localStorage.setItem(NOTE_OVR_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // ─── CFS row overrides (Phase UI-4 fix) ──────────────────────────────────
  // The CFS template has several label-only placeholder rows (Interest income,
  // Profit on sale of assets, Interest expense, Short term provision, Loan
  // repayments, Interest Paid, opening cash) that auditors fill manually.
  // It also derives Trade payables / Inventories / Trade rec / PPE purchase
  // from BS movements — but auditors sometimes need to override those (e.g.
  // adjust for revaluation reserve impact). We surface inline edits for both,
  // persisted in localStorage per engagement.
  // Shape: Record<row_key, { cy?: number; py?: number }>.
  const CFS_OVR_KEY = `caflow:fs_cfs_overrides:${engagementId}`;
  const [cfsOverrides, setCfsOverrides] = useState<Record<string, { cy?: number; py?: number }>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(CFS_OVR_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const updateCfsOverride = (key: string, period: "cy" | "py", value: number | null) => {
    setCfsOverrides(prev => {
      const next: Record<string, { cy?: number; py?: number }> = { ...prev };
      const row = { ...(next[key] || {}) };
      if (value === null || !Number.isFinite(value)) delete row[period];
      else row[period] = value;
      if (row.cy === undefined && row.py === undefined) delete next[key];
      else next[key] = row;
      try { window.localStorage.setItem(CFS_OVR_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // ─── Manual PY note-wise annexures (ledger-level breakdown per FS code) ──
  // Shape: { "<fs_code>": [{ ledger_name, amount, group? }] }
  type PyAnnexRow = { ledger_name: string; amount: number; group?: string };
  const [pyAnnexures,        setPyAnnexures]        = useState<Record<string, PyAnnexRow[]>>({});
  const [pyAnnexuresDirty,   setPyAnnexuresDirty]   = useState(false);
  const [pyAnnexuresSaving,  setPyAnnexuresSaving]  = useState(false);

  // ─── PY Data Source setup dialog ────────────────────────────────────────
  const [pySourceDialog,  setPySourceDialog]  = useState(false);
  const [creatingPyShell, setCreatingPyShell] = useState(false);

  // ─── Fetch PY P&L from FY-1 Tally ───────────────────────────────────────
  const [fetchingPyTally,     setFetchingPyTally]     = useState(false);
  const [fetchPyTallyDialog,  setFetchPyTallyDialog]  = useState(false);
  const [fetchPyTallyPreview, setFetchPyTallyPreview] = useState<Record<string, number> | null>(null);

  // ─── NCE Signature block editable state ──────────────────────────────────
  const [sigSignatoryName, setSigSignatoryName] = useState("");
  const [sigPlace,         setSigPlace]         = useState("");
  const [sigDate,          setSigDate]           = useState(() => new Date().toISOString().split("T")[0]);

  // ─── Phase 8 / UI-6: Stage 5 Notes tab (PPE Schedule + note-wise amounts) ─
  // Persisted to audit_engagements.stage5_notes JSONB column.
  // Default FA rows match the migration default (4 asset categories).
  type FARow = {
    id: string; particulars: string; useful_life: string | number;
    gross_open: number; additions: number; disposals: number;
    depn_open: number; depn_add: number; depn_disp: number;
  };
  type Stage5Notes = {
    fa: { rows: FARow[] };
    bs_liab: Record<string, Record<string, number>>;
    bs_asset: Record<string, Record<string, number>>;
    pl: Record<string, Record<string, number>>;
    auto_synced_at: string | null;
    manual_edits: string[];
  };

  const DEFAULT_FA_ROWS: FARow[] = [
    { id: "land",             particulars: "Land",              useful_life: "indefinite", gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
    { id: "factory_building", particulars: "Factory Building",  useful_life: 30,           gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
    { id: "plant_machinery",  particulars: "Plant & Machinery", useful_life: 15,           gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
    { id: "computers",        particulars: "Computers",         useful_life: 3,            gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
  ];

  const [stage5Notes, setStage5Notes] = useState<Stage5Notes>({
    fa: { rows: DEFAULT_FA_ROWS },
    bs_liab: {}, bs_asset: {}, pl: {},
    auto_synced_at: null, manual_edits: [],
  });
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDirty,  setNotesDirty]  = useState(false);

  // Load stage5_notes from engagement on mount/change
  const { data: rawStage5Notes, refetch: refetchStage5Notes } = useQuery({
    queryKey: ["stage5-notes", engagementId],
    queryFn: async () => {
      const { data } = await (supabase.from as any)("audit_engagements")
        .select("stage5_notes")
        .eq("id", engagementId)
        .maybeSingle();
      return (data as any)?.stage5_notes ?? null;
    },
    enabled: !!engagementId,
  });

  useEffect(() => {
    if (!rawStage5Notes) return;
    setStage5Notes(prev => ({
      ...prev,
      ...rawStage5Notes,
      fa: {
        rows: rawStage5Notes.fa?.rows?.length
          ? rawStage5Notes.fa.rows
          : DEFAULT_FA_ROWS,
      },
    }));
  }, [rawStage5Notes]);

  const saveStage5Notes = useCallback(async (notes: Stage5Notes) => {
    setNotesSaving(true);
    try {
      await (supabase.from as any)("audit_engagements")
        .update({ stage5_notes: notes })
        .eq("id", engagementId);
      setNotesDirty(false);
    } catch (e: any) {
      console.error("stage5_notes save error:", e);
    } finally {
      setNotesSaving(false);
    }
  }, [engagementId]);

  const updateFARow = useCallback((rowId: string, field: keyof FARow, value: string | number) => {
    setStage5Notes(prev => {
      const rows = prev.fa.rows.map(r => r.id === rowId ? { ...r, [field]: value } : r);
      return { ...prev, fa: { rows } };
    });
    setNotesDirty(true);
  }, []);

  const addFARow = useCallback(() => {
    const newRow: FARow = {
      id: `fa_${Date.now()}`, particulars: "New Asset", useful_life: 10,
      gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0,
    };
    setStage5Notes(prev => ({ ...prev, fa: { rows: [...prev.fa.rows, newRow] } }));
    setNotesDirty(true);
  }, []);

  const removeFARow = useCallback((rowId: string) => {
    setStage5Notes(prev => ({ ...prev, fa: { rows: prev.fa.rows.filter(r => r.id !== rowId) } }));
    setNotesDirty(true);
  }, []);

  // ─── Fetch Tally Trial Balance (sole authoritative source) ───
  // Uses same 3-step lookup as PipelineStage3: direct → sync_batches → legacy engagements
  const { data: tallyTb, isLoading: tallyTbLoading } = useQuery({
    queryKey: ["tally-tb-fs", engagementId, engagement?.client_id, engagement?.financial_year],
    queryFn: async () => {
      const TB_COLS = "ledger_name, parent_group, opening_balance, opening_type, closing_balance, balance_type, debit_amount, credit_amount";

      async function fetchAllTB(engId: string): Promise<any[]> {
        const PAGE = 1000;
        const all: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("tally_trial_balance")
            .select(TB_COLS)
            .eq("engagement_id", engId)
            .range(from, from + PAGE - 1);
          if (error || !data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
        }
        return all;
      }

      // Step 0: direct lookup with audit_engagements.id (primary — works for all new syncs)
      if (engagementId) {
        const rows = await fetchAllTB(engagementId);
        if (rows.length) return rows;
      }
      if (!engagement?.client_id) return [];

      // Step 1: sync_batches.client_id — most reliable for older syncs
      const { data: batchRow } = await (supabase.from as any)("sync_batches")
        .select("engagement_id")
        .eq("client_id", engagement.client_id)
        .in("status", ["complete", "completed", "success", "complete_with_warnings"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const batchEngId: string | null = (batchRow as any)?.engagement_id ?? null;
      if (batchEngId && batchEngId !== engagementId) {
        const rows = await fetchAllTB(batchEngId);
        if (rows.length) return rows;
      }

      // Step 2: legacy engagements table
      if (engagement.financial_year) {
        const { data: tEng } = await (supabase.from as any)("engagements")
          .select("id")
          .eq("client_id", engagement.client_id)
          .eq("financial_year", engagement.financial_year)
          .maybeSingle();
        const legacyId = (tEng as any)?.id ?? null;
        if (legacyId) {
          const rows = await fetchAllTB(legacyId);
          if (rows.length) return rows;
        }
      }
      return [];
    },
    enabled: !!engagementId,
  });

  // ─── Fetch existing FS rows ───
  const { data: existingFs, isLoading: fsLoading } = useQuery({
    queryKey: ["fs-rows", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("fa_financial_statements")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("sort_order");
      return (data || []) as any[];
    },
    enabled: !!engagementId,
  });

  // ─── Fetch prior year FS for PY column ───
  const { data: priorEngagement } = useQuery({
    queryKey: ["prior-engagement-fs", engagement?.client_id, engagement?.financial_year],
    queryFn: async () => {
      const fyParts = (engagement.financial_year || "").split("-");
      if (fyParts.length !== 2) return null;
      const prevFy = `${parseInt(fyParts[0]) - 1}-${(parseInt(fyParts[0])).toString().slice(-2)}`;
      const { data: prevEng } = await supabase
        .from("audit_engagements")
        .select("id")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .maybeSingle();
      if (!prevEng) return null;
      const { data: prevFs } = await supabase
        .from("fa_financial_statements")
        .select("line_item_code, amount_cy")
        .eq("engagement_id", prevEng.id);
      return prevFs || [];
    },
    enabled: !!engagement?.client_id && !!engagement?.financial_year,
  });

  // ─── Check whether the prior year's engagement is_finalized ──────────────
  // When finalized, PY column cells become read-only (locked).
  const { data: priorEngFinalized } = useQuery({
    queryKey: ["prior-eng-finalized", engagement?.client_id, engagement?.financial_year],
    queryFn: async () => {
      if (!engagement?.client_id || !engagement?.financial_year) return false;
      const fyParts = (engagement.financial_year as string).split("-");
      if (fyParts.length !== 2) return false;
      const prevFy = `${parseInt(fyParts[0]) - 1}-${String(parseInt(fyParts[0])).slice(-2)}`;
      const { data } = await supabase
        .from("audit_engagements")
        .select("is_finalized")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .maybeSingle();
      return !!(data as any)?.is_finalized;
    },
    enabled: !!engagement?.client_id && !!engagement?.financial_year,
  });

  // ─── PY Shell engagement ID (for navigation back to it) ─────────────────
  // Runs only when py_source === "py_shell" so the user can always navigate
  // back to the shell's Tally Sync even after leaving the shell page.
  const { data: pyShellId } = useQuery({
    queryKey: ["py-shell-id", engagement?.client_id, engagement?.financial_year],
    queryFn: async () => {
      const fyParts = (engagement.financial_year as string).split("-");
      if (fyParts.length !== 2) return null;
      const prevFy = `${parseInt(fyParts[0]) - 1}-${String(parseInt(fyParts[0])).slice(-2)}`;
      const { data } = await (supabase.from as any)("audit_engagements")
        .select("id")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .maybeSingle();
      return (data as any)?.id ?? null;
    },
    enabled: (engagement as any)?.py_source === "py_shell" && !!engagement?.client_id && !!engagement?.financial_year,
  });

  // ─── Firm data (NCE signature block) ─────────────────────────────────────
  // Pulls `membership_numbers` as well so the partner's M.No. can be
  // resolved from the engagement's `partner_name` when `partner_id` is
  // absent (the Stage 1 form writes partner_name, not partner_id).
  const { data: firmData } = useQuery({
    queryKey: ["firm-detail-fs", engagement?.firm_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("firms")
        .select("name, icai_firm_reg_no, address, membership_numbers")
        .eq("id", engagement.firm_id)
        .maybeSingle();
      return data as any;
    },
    enabled: !!engagement?.firm_id,
  });

  // ─── Partner user data (NCE signature block) ──────────────────────────────
  // Optional fallback: some legacy engagements still store partner_id and
  // reference a row in `users`. New engagements use partner_name + the
  // firm's membership_numbers lookup (handled below in sigPartnerName /
  // sigMembershipNo).
  const { data: partnerData } = useQuery({
    queryKey: ["partner-user-fs", (engagement as any)?.partner_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("name, membership_number")
        .eq("id", (engagement as any).partner_id)
        .maybeSingle();
      return data as any;
    },
    enabled: !!(engagement as any)?.partner_id,
  });

  // ─── Fetch NCE Capital Account rows (for Notes to Accounts-Capital sheet) ─
  const { data: nceCapitalData } = useQuery({
    queryKey: ["nce-capital-account", engagementId],
    queryFn: async () => {
      const { data } = await (supabase.from as any)("nce_capital_account")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("partner_no");
      return (data || []) as any[];
    },
    enabled: !!engagementId && isNonCorporate,
  });

  // ─── Fetch NCE PPE Schedule rows (for Notes to Accounts-PPE sheet) ────────
  const { data: ncePpeData } = useQuery({
    queryKey: ["nce-ppe-schedule", engagementId],
    queryFn: async () => {
      const { data } = await (supabase.from as any)("nce_ppe_schedule")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("asset_category")
        .order("sort_order");
      return (data || []) as any[];
    },
    enabled: !!engagementId && isNonCorporate,
  });

  // ─── Fetch client address for NCE letter sheets ──────────────────────────
  // The engagement prop from AuditPipeline only selects a subset of
  // `clients` (name, entity_type, …) and does NOT include `address`, so the
  // letter sheets need to fetch it directly. Mirrors what Stage 8's
  // NCE*Letter components do.
  const { data: clientDetail } = useQuery({
    queryKey: ["client-detail-fs", engagement?.client_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("name, address")
        .eq("id", engagement.client_id)
        .maybeSingle();
      return data as any;
    },
    enabled: !!engagement?.client_id && isNonCorporate,
  });

  // ─── Fetch NCE letters (Client Certificate + Management Letter) ─────────
  // Stage 8 tabs 5 & 6 save to `nce_letters` (letter_type discriminator).
  // Pulled here so the Excel export can emit each letter as its own sheet.
  const { data: nceLettersData } = useQuery({
    queryKey: ["nce-letters", engagementId, engagement?.financial_year],
    queryFn: async () => {
      if (!engagement?.financial_year) return [] as any[];
      const { data } = await (supabase.from as any)("nce_letters")
        .select("letter_type, letter_date, cash_on_hand, closing_stock, closing_stock_date")
        .eq("engagement_id", engagementId)
        .eq("financial_year", engagement.financial_year);
      return (data || []) as any[];
    },
    enabled: !!engagementId && !!engagement?.financial_year && isNonCorporate,
  });

  // ─── Fetch NCE Detailed Notes data (user-entered in Stage 8) ─────────────
  // Source of truth for every "Notes to Accounts" schedule except Capital
  // and PPE. The Excel exporter MUST use this — NOT a keyword heuristic over
  // the trial balance — so what the user typed in the Stage 8 editor is
  // exactly what lands in the exported sheet.
  const { data: nceNotesData } = useQuery({
    queryKey: ["nce-financial-notes", engagementId, engagement?.financial_year],
    queryFn: async () => {
      if (!engagement?.financial_year) return [] as any[];
      const { data } = await (supabase.from as any)("nce_financial_notes")
        .select("note_type, cy_data, py_data")
        .eq("engagement_id", engagementId)
        .eq("financial_year", engagement.financial_year);
      return (data || []) as any[];
    },
    enabled: !!engagementId && !!engagement?.financial_year && isNonCorporate,
  });

  // ─── Fetch NCE Stage-7 "Notes to Accounts" (Balance Confirmation, etc.) ──
  // The Note 1 sheet in the Excel export must reflect what the user has
  // typed / toggled / reordered in the Note 1 tab of Stage 7, not a hardcoded
  // boilerplate list of accounting policies.
  const { data: notesToAccountsData } = useQuery({
    queryKey: ["notes-to-accounts-data", engagementId],
    queryFn: async () => {
      const { data } = await (supabase.from as any)("notes_to_accounts_data")
        .select("*")
        .eq("engagement_id", engagementId)
        .maybeSingle();
      return data as any;
    },
    enabled: !!engagementId && isNonCorporate,
  });

  // ─── TB accounts — Tally Sync is the sole authoritative source ───
  // opening_balance (signed; Cr → negative) = PY closing for BS items.
  const tbAccounts: {
    account_name: string; account_group: string;
    balance: number; opening_balance: number;
  }[] = useMemo(() => {
    if (!tallyTb?.length) return [];
    return tallyTb.map((l: any) => {
      const cb   = Math.abs(Number(l.closing_balance ?? 0));
      const isDr = String(l.balance_type ?? "").toUpperCase() === "DR";
      return {
        account_name:  String(l.ledger_name || "").trim(),
        account_group: l.parent_group || "",
        balance: isDr ? cb : -cb,
        opening_balance: Math.abs(Number(l.opening_balance ?? 0)) *
                         (String(l.opening_type ?? "").toUpperCase() === "CR" ? -1 : 1),
      };
    }).filter((a: any) => a.account_name);
  }, [tallyTb]);

  // ─── COA mapping from engagement prop ───
  const coaMapping: Record<string, { code: string }> = useMemo(() => {
    if (engagement?.coa_mapping && typeof engagement.coa_mapping === "object") {
      return engagement.coa_mapping as any;
    }
    return {};
  }, [engagement?.coa_mapping]);

  // ─── Load PY amounts ───
  useEffect(() => {
    if (priorEngagement && Array.isArray(priorEngagement)) {
      const py: Record<string, number> = {};
      for (const row of priorEngagement) {
        if (row.line_item_code) py[row.line_item_code] = row.amount_cy || 0;
      }
      setPyAmounts(py);
    }
  }, [priorEngagement]);

  // ─── Load manual PY P&L amounts from engagement.py_manual_amounts ──────
  // Supports both legacy plain-number shape and enriched { v, by, at } shape.
  useEffect(() => {
    const raw = (engagement as any)?.py_manual_amounts;
    if (raw && typeof raw === "object") {
      const parsed: Record<string, number> = {};
      const meta: Record<string, { by: string; at: string }> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "number") {
          // Legacy shape: plain number
          if (Number.isFinite(v)) parsed[k] = v;
        } else if (v !== null && typeof v === "object" && "v" in (v as any)) {
          // Enriched shape: { v: number, by: string, at: string }
          const n = Number((v as any).v);
          if (Number.isFinite(n)) {
            parsed[k] = n;
            meta[k] = { by: String((v as any).by || ""), at: String((v as any).at || "") };
          }
        }
      }
      setPyManualAmounts(parsed);
      setPyManualMeta(meta);
      setPyManualDirty(false);
    }
  }, [(engagement as any)?.py_manual_amounts]);

  // ─── Load manual PY annexures from engagement.py_manual_annexures ──────
  useEffect(() => {
    const raw = (engagement as any)?.py_manual_annexures;
    if (raw && typeof raw === "object") {
      const parsed: Record<string, PyAnnexRow[]> = {};
      for (const [code, rows] of Object.entries(raw)) {
        if (!Array.isArray(rows)) continue;
        parsed[code] = (rows as any[]).map(r => ({
          ledger_name: String(r?.ledger_name || ""),
          amount:      Number(r?.amount || 0),
          group:       r?.group ? String(r.group) : undefined,
        })).filter(r => r.ledger_name);
      }
      setPyAnnexures(parsed);
      setPyAnnexuresDirty(false);
    }
  }, [(engagement as any)?.py_manual_annexures]);

  // When no prior engagement returns rows, PY P&L is sourced from py_manual_amounts.
  const noPriorEngagement: boolean =
    priorEngagement === null ||
    (Array.isArray(priorEngagement) && priorEngagement.length === 0);

  // ─── Load manual overrides from existing FS ───
  useEffect(() => {
    if (existingFs && existingFs.length > 0) {
      const overrides: Record<string, { amount: number; reason: string }> = {};
      for (const row of existingFs) {
        if (row.is_manual) {
          overrides[row.line_item_code] = { amount: row.amount_cy, reason: row.override_reason || "" };
        }
      }
      setManualOverrides(overrides);
    }
  }, [existingFs]);

  // ─── Computed FS amounts ───
  const computedAmounts: Record<string, number> = useMemo(() => {
    const amounts: Record<string, number> = {};

    // Aggregate TB accounts → FS line items via COA mapping
    for (const acct of tbAccounts) {
      const mapping = coaMapping[acct.account_name];
      if (!mapping) continue;
      amounts[mapping.code] = (amounts[mapping.code] || 0) + acct.balance;
    }

    // Apply manual overrides
    for (const [code, override] of Object.entries(manualOverrides)) {
      amounts[code] = override.amount;
    }

    // Compute parent totals (recursive)
    const computeTotal = (item: FSLineItem): number => {
      if (!item.children || item.children.length === 0) {
        return amounts[item.code] || 0;
      }
      const total = item.children.reduce((sum, child) => sum + computeTotal(child), 0);
      amounts[item.code] = total;
      return total;
    };
    // Use activeTree so NCE parent totals (NCE_EL, NCE_AST, etc.) are computed
    for (const item of activeTree) {
      computeTotal(item);
    }

    // ── NCE P&L profit chain (V → XIII) ─────────────────────────────────────
    // computeTotal handles additive parents; subtraction-based subtotals are
    // computed here so they are available in the rendered table and on save.
    // Manual overrides on NCE_EXCEP / NCE_EXTORD / NCE_PART_REM are respected
    // because override.amount was already written into `amounts` above.
    if (isNonCorporate) {
      const nceInc  = amounts["NCE_PL_INC"] || 0;
      const nceExp  = amounts["NCE_PL_EXP"] || 0;
      amounts["NCE_PROF_V"]   = Math.round((nceInc - nceExp) * 100) / 100;
      amounts["NCE_PROF_VII"] = Math.round((amounts["NCE_PROF_V"]   - (amounts["NCE_EXCEP"]    || 0)) * 100) / 100;
      amounts["NCE_PROF_IX"]  = Math.round((amounts["NCE_PROF_VII"] - (amounts["NCE_EXTORD"]   || 0)) * 100) / 100;
      amounts["NCE_PROF_XI"]  = Math.round((amounts["NCE_PROF_IX"]  - (amounts["NCE_PART_REM"] || 0)) * 100) / 100;
      // NCE_TAX was already summed by computeTotal (NCE_CUR_TAX + NCE_PRIOR_TAX)
      amounts["NCE_NET_PROF"] = Math.round((amounts["NCE_PROF_XI"]  - (amounts["NCE_TAX"]      || 0)) * 100) / 100;
    }

    return amounts;
  }, [tbAccounts, coaMapping, manualOverrides, isNonCorporate]);

  // ═══════ COMPARATIVE (PY) AMOUNTS ═══════
  // Prior-year BS from opening_balance on CY trial balance. Same coa_mapping
  // → re-mapping a ledger re-groups both periods. P&L opens at 0 so PY P&L
  // always comes from prior engagement's fa_financial_statements.
  const computedAmountsPY: Record<string, number> = useMemo(() => {
    const amounts: Record<string, number> = {};
    for (const acct of tbAccounts) {
      const mapping = coaMapping[acct.account_name];
      if (!mapping) continue;
      const opening = acct.opening_balance ?? 0;
      if (!opening) continue;
      amounts[mapping.code] = (amounts[mapping.code] || 0) + opening;
    }
    const computeTotal = (item: FSLineItem): number => {
      if (!item.children || item.children.length === 0) return amounts[item.code] || 0;
      const total = item.children.reduce((sum, child) => sum + computeTotal(child), 0);
      amounts[item.code] = total;
      return total;
    };
    for (const item of activeTree) computeTotal(item);
    return amounts;
  }, [tbAccounts, coaMapping, activeTree]);

  // ─── Merged PY: BS uses computedAmountsPY (from opening); P&L uses pyAmounts (prior engagement) ───
  // When there is no prior engagement, PY P&L is sourced from engagement.py_manual_amounts.
  const mergedPY: Record<string, number> = useMemo(() => {
    const merged: Record<string, number> = { ...pyAmounts };
    // Fold in manual PY P&L for items that have no prior-engagement value.
    // Leaf-only: parents are recomputed below.
    if (noPriorEngagement) {
      for (const [code, val] of Object.entries(pyManualAmounts)) {
        if (!Number.isFinite(val)) continue;
        if (merged[code] === undefined || merged[code] === null) merged[code] = val;
      }
    }
    for (const [code, val] of Object.entries(computedAmountsPY)) {
      // Section lookup via flat items
      const item = activeFlatItems.find(i => i.code === code);
      const sec  = String(item?.section || "").toLowerCase();
      const isBS = sec.includes("bs") || sec.includes("asset") || sec.includes("liab") || sec.includes("equity");
      if (isBS && Math.abs(val) > 0.005) merged[code] = val;
    }
    // Recompute P&L parent totals from leaves so manual leaf entries flow up.
    const computePL = (item: FSLineItem): number => {
      const sec = String(item.section || "").toLowerCase();
      const isPL = sec.includes("pl") || sec.includes("revenue") || sec.includes("expense");
      if (!isPL) return 0;
      if (!item.children || item.children.length === 0) return merged[item.code] || 0;
      const total = item.children.reduce((sum, child) => sum + computePL(child), 0);
      merged[item.code] = total;
      return total;
    };
    for (const item of activeTree) computePL(item);
    return merged;
  }, [computedAmountsPY, pyAmounts, pyManualAmounts, noPriorEngagement, activeFlatItems, activeTree]);

  // ─── Phase UI-1: Shared FS display data ─────────────────────────────────
  // Hoisted out of exportToExcel() so both the Export Excel button AND the
  // in-UI BS/PL/CFS tabs (added in UI-2/3/4) consume identical computed
  // values. This mirrors the pre-export logic that rebuilds exportCy/exportPy
  // from tbAccounts + coaMapping, applies manual overrides, recurses parent
  // totals, folds in prior-engagement / manual PY figures, and runs the NCE
  // profit chain. It also emits typed BS/PL/CFS row data (null for NCE) for
  // consumption by fsExcelExport.ts and the upcoming in-UI renderers.
  const fsDisplayData = useMemo(() => {
    const exportCy: Record<string, number> = {};
    const exportPy: Record<string, number> = {};
    for (const acct of tbAccounts) {
      const mapping = coaMapping[acct.account_name];
      if (!mapping) continue;
      exportCy[mapping.code] = (exportCy[mapping.code] || 0) + (acct.balance || 0);
      const opening = acct.opening_balance ?? 0;
      if (opening) exportPy[mapping.code] = (exportPy[mapping.code] || 0) + opening;
    }
    for (const [code, override] of Object.entries(manualOverrides)) {
      exportCy[code] = override.amount;
    }
    const computeTotalLocal = (item: FSLineItem, table: Record<string, number>): number => {
      if (!item.children || item.children.length === 0) return table[item.code] || 0;
      const total = item.children.reduce((s, c) => s + computeTotalLocal(c, table), 0);
      table[item.code] = total;
      return total;
    };
    for (const item of activeTree) {
      computeTotalLocal(item, exportCy);
      computeTotalLocal(item, exportPy);
    }
    for (const [code, val] of Object.entries(pyAmounts || {})) {
      if (Number.isFinite(val as number)) exportPy[code] = val as number;
    }
    if (noPriorEngagement) {
      for (const [code, val] of Object.entries(pyManualAmounts || {})) {
        if (Number.isFinite(val)) {
          if (exportPy[code] === undefined || exportPy[code] === 0) exportPy[code] = val;
        }
      }
    }
    const computePlLocal = (item: FSLineItem): number => {
      const sec = String(item.section || "").toLowerCase();
      const isPL = sec.includes("pl") || sec.includes("revenue") || sec.includes("expense");
      if (!isPL) return 0;
      if (!item.children || item.children.length === 0) return exportPy[item.code] || 0;
      const total = item.children.reduce((s, c) => s + computePlLocal(c), 0);
      exportPy[item.code] = total;
      return total;
    };
    for (const item of activeTree) computePlLocal(item);
    if (isNonCorporate) {
      const chain = (table: Record<string, number>) => {
        const inc = table["NCE_PL_INC"] || 0;
        const exp = table["NCE_PL_EXP"] || 0;
        table["NCE_PROF_V"]   = Math.round((inc - exp) * 100) / 100;
        table["NCE_PROF_VII"] = Math.round((table["NCE_PROF_V"]   - (table["NCE_EXCEP"]    || 0)) * 100) / 100;
        table["NCE_PROF_IX"]  = Math.round((table["NCE_PROF_VII"] - (table["NCE_EXTORD"]   || 0)) * 100) / 100;
        table["NCE_PROF_XI"]  = Math.round((table["NCE_PROF_IX"]  - (table["NCE_PART_REM"] || 0)) * 100) / 100;
        table["NCE_NET_PROF"] = Math.round((table["NCE_PROF_XI"]  - (table["NCE_TAX"]      || 0)) * 100) / 100;
      };
      chain(exportCy);
      chain(exportPy);
    }

    const cyOf = (code: string): number => {
      const v = exportCy[code];
      if (v !== undefined && v !== 0) return v;
      return computedAmounts[code] || v || 0;
    };
    const pyOf = (code: string): number => {
      const v = exportPy[code];
      if (v !== undefined && v !== 0) return v;
      return mergedPY[code] || v || 0;
    };

    // Typed BS/PL/CFS tables — corporate only. Non-corporate returns null
    // for all three; NCE tabs continue to render via their own legacy path.
    let bs: BSRowData | null = null;
    let pl: PLRowData | null = null;
    let cfs: CFSRowData | null = null;
    if (!isNonCorporate) {
      bs = {
        shareCap:        { noteNo: 3,  cy: cyOf("BS_EQ_SC"),   py: pyOf("BS_EQ_SC")   },
        reserves:        { noteNo: 4,  cy: cyOf("BS_EQ_RS"),   py: pyOf("BS_EQ_RS")   },
        ltBorrowings:    { noteNo: 5,  cy: cyOf("BS_NCL_LTB"), py: pyOf("BS_NCL_LTB") },
        otherLtLiab:     { noteNo: 7,  cy: cyOf("BS_NCL_OLT"), py: pyOf("BS_NCL_OLT") },
        ltProvisions:    { noteNo: 8,  cy: cyOf("BS_NCL_LTP"), py: pyOf("BS_NCL_LTP") },
        stBorrowings:    { noteNo: 9,  cy: cyOf("BS_CL_STB"),  py: pyOf("BS_CL_STB")  },
        tradePayables:   { noteNo: 10 },
        tradePayMSME:    { cy: 0, py: 0 },
        tradePayOthers:  { cy: cyOf("BS_CL_TP"), py: pyOf("BS_CL_TP") },
        otherCurrLiab:   { noteNo: 11, cy: cyOf("BS_CL_OCL"), py: pyOf("BS_CL_OCL") },
        stProvisions:    { noteNo: 12, cy: cyOf("BS_CL_STP"), py: pyOf("BS_CL_STP") },
        ppe:             { noteNo: 13, cy: cyOf("BS_NCA_FA"),  py: pyOf("BS_NCA_FA")  },
        ncInvestments:   { noteNo: 15, cy: cyOf("BS_NCA_INV"), py: pyOf("BS_NCA_INV") },
        dtAssets:        { noteNo: 16, cy: cyOf("BS_NCA_DTA"), py: pyOf("BS_NCA_DTA") },
        ltLoans:         { noteNo: 17, cy: cyOf("BS_NCA_LLA"), py: pyOf("BS_NCA_LLA") },
        otherNcAssets:   { noteNo: 18, cy: cyOf("BS_NCA_ONA"), py: pyOf("BS_NCA_ONA") },
        currInvestments: { noteNo: 19, cy: cyOf("BS_CA_CI"),   py: pyOf("BS_CA_CI")   },
        inventories:     { noteNo: 20, cy: cyOf("BS_CA_INV"),  py: pyOf("BS_CA_INV")  },
        tradeRec:        { noteNo: 21, cy: cyOf("BS_CA_TR"),   py: pyOf("BS_CA_TR")   },
        cashBank:        { noteNo: 22, cy: cyOf("BS_CA_CCE"),  py: pyOf("BS_CA_CCE")  },
        stLoans:         { noteNo: 23, cy: cyOf("BS_CA_SLA"),  py: pyOf("BS_CA_SLA")  },
        otherCurrAssets: { noteNo: 24, cy: cyOf("BS_CA_OCA"),  py: pyOf("BS_CA_OCA")  },
        sigPolicies:     { noteNo: 2 },
      };
      const expCy = cyOf("PL_EXP_MAT") + cyOf("PL_EXP_SIT") + cyOf("PL_EXP_CII")
                  + cyOf("PL_EXP_EMP") + cyOf("PL_EXP_FIN") + cyOf("PL_EXP_DEP")
                  + cyOf("PL_EXP_OTH");
      const expPy = pyOf("PL_EXP_MAT") + pyOf("PL_EXP_SIT") + pyOf("PL_EXP_CII")
                  + pyOf("PL_EXP_EMP") + pyOf("PL_EXP_FIN") + pyOf("PL_EXP_DEP")
                  + pyOf("PL_EXP_OTH");
      const revCy = cyOf("PL_REV_OPS") + cyOf("PL_REV_OI");
      const revPy = pyOf("PL_REV_OPS") + pyOf("PL_REV_OI");
      const excCy = cyOf("PL_EI");
      const excPy = pyOf("PL_EI");
      pl = {
        revFromOps:         { noteNo: 25, cy: cyOf("PL_REV_OPS"), py: pyOf("PL_REV_OPS") },
        otherIncome:        { noteNo: 26, cy: cyOf("PL_REV_OI"),  py: pyOf("PL_REV_OI")  },
        costMaterials:      { noteNo: 27 },
        purchasesStock:     { noteNo: 27, cy: cyOf("PL_EXP_SIT"), py: pyOf("PL_EXP_SIT") },
        changesInventories: { noteNo: 27, cy: cyOf("PL_EXP_CII"), py: pyOf("PL_EXP_CII") },
        employeeBenefits:   { noteNo: 28, cy: cyOf("PL_EXP_EMP"), py: pyOf("PL_EXP_EMP") },
        financeCosts:       { noteNo: null, cy: cyOf("PL_EXP_FIN"), py: pyOf("PL_EXP_FIN") },
        depreciation:       { noteNo: null, cy: cyOf("PL_EXP_DEP"), py: pyOf("PL_EXP_DEP") },
        otherExpenses:      { noteNo: 29, cy: cyOf("PL_EXP_OTH"), py: pyOf("PL_EXP_OTH") },
        taxExpense:         { noteNo: null },
        currentTax:         { cy: cyOf("PL_TAX_CUR"), py: pyOf("PL_TAX_CUR") },
        deferredTax:        { cy: cyOf("PL_TAX_DEF"), py: pyOf("PL_TAX_DEF") },
        eps:                { noteNo: null },
        shareCap:           { noteNo: 1 },
        pbt:                { cy: revCy - expCy - excCy, py: revPy - expPy - excPy },
      };
      cfs = {
        tradePayChange:        { cy: cyOf("BS_CL_TP")  - pyOf("BS_CL_TP")  },
        otherCurrLiabChange:   { cy: cyOf("BS_CL_OCL") - pyOf("BS_CL_OCL") },
        otherCurrAssetsChange: { cy: pyOf("BS_CA_OCA") - cyOf("BS_CA_OCA") },
        incomeTaxPaid:         { cy: null },
        ppePurchases:          { cy: Math.max(0, cyOf("BS_NCA_FA") - pyOf("BS_NCA_FA")) },
      };
    }

    // ── Apply per-engagement Note-No. overrides (UI-2 fix) ────────────────
    // BS/PL note numbers default to the SCHEDULE_III_DIV_I mapping. If the
    // user edited a note number inline, surface it here so both the in-UI
    // statement and the Excel export pick it up.
    //
    // Override semantics:
    //   key absent          → use default
    //   key present, null   → explicit hide (blank in UI + Excel)
    //   key present, number → user-supplied override
    if (bs) {
      const ov = (code: string, fallback: number | null | undefined) =>
        code in noteOverrides ? noteOverrides[code] : (fallback ?? null);
      bs.shareCap.noteNo        = ov("BS_EQ_SC",   bs.shareCap.noteNo);
      bs.reserves.noteNo        = ov("BS_EQ_RS",   bs.reserves.noteNo);
      bs.ltBorrowings.noteNo    = ov("BS_NCL_LTB", bs.ltBorrowings.noteNo);
      bs.otherLtLiab.noteNo     = ov("BS_NCL_OLT", bs.otherLtLiab.noteNo);
      bs.ltProvisions.noteNo    = ov("BS_NCL_LTP", bs.ltProvisions.noteNo);
      bs.stBorrowings.noteNo    = ov("BS_CL_STB",  bs.stBorrowings.noteNo);
      bs.tradePayables.noteNo   = ov("BS_CL_TP",   bs.tradePayables.noteNo);
      bs.otherCurrLiab.noteNo   = ov("BS_CL_OCL",  bs.otherCurrLiab.noteNo);
      bs.stProvisions.noteNo    = ov("BS_CL_STP",  bs.stProvisions.noteNo);
      bs.ppe.noteNo             = ov("BS_NCA_FA",  bs.ppe.noteNo);
      bs.ncInvestments.noteNo   = ov("BS_NCA_INV", bs.ncInvestments.noteNo);
      bs.dtAssets.noteNo        = ov("BS_NCA_DTA", bs.dtAssets.noteNo);
      bs.ltLoans.noteNo         = ov("BS_NCA_LLA", bs.ltLoans.noteNo);
      bs.otherNcAssets.noteNo   = ov("BS_NCA_ONA", bs.otherNcAssets.noteNo);
      bs.currInvestments.noteNo = ov("BS_CA_CI",   bs.currInvestments.noteNo);
      bs.inventories.noteNo     = ov("BS_CA_INV",  bs.inventories.noteNo);
      bs.tradeRec.noteNo        = ov("BS_CA_TR",   bs.tradeRec.noteNo);
      bs.cashBank.noteNo        = ov("BS_CA_CCE",  bs.cashBank.noteNo);
      bs.stLoans.noteNo         = ov("BS_CA_SLA",  bs.stLoans.noteNo);
      bs.otherCurrAssets.noteNo = ov("BS_CA_OCA",  bs.otherCurrAssets.noteNo);
    }
    if (pl) {
      const ov = (code: string, fallback: number | null | undefined) =>
        code in noteOverrides ? noteOverrides[code] : (fallback ?? null);
      pl.revFromOps.noteNo         = ov("PL_REV_OPS",  pl.revFromOps.noteNo);
      pl.otherIncome.noteNo        = ov("PL_REV_OI",   pl.otherIncome.noteNo);
      pl.purchasesStock.noteNo     = ov("PL_EXP_SIT",  pl.purchasesStock.noteNo);
      pl.changesInventories.noteNo = ov("PL_EXP_CII",  pl.changesInventories.noteNo);
      pl.employeeBenefits.noteNo   = ov("PL_EXP_EMP",  pl.employeeBenefits.noteNo);
      pl.financeCosts.noteNo       = ov("PL_EXP_FIN",  pl.financeCosts.noteNo);
      pl.depreciation.noteNo       = ov("PL_EXP_DEP",  pl.depreciation.noteNo);
      pl.otherExpenses.noteNo      = ov("PL_EXP_OTH",  pl.otherExpenses.noteNo);
    }

    return { exportCy, exportPy, cyOf, pyOf, bs, pl, cfs };
  }, [
    tbAccounts, coaMapping, manualOverrides, activeTree,
    pyAmounts, pyManualAmounts, noPriorEngagement, isNonCorporate,
    computedAmounts, mergedPY, noteOverrides,
  ]);

  // ─── Corporate BS check + P&L summary (unchanged) ───
  const totalAssets = (computedAmounts["BS_NCA"] || 0) + (computedAmounts["BS_CA"] || 0);
  const totalLiabilities =
    (computedAmounts["BS_EQ"] || 0) +
    (computedAmounts["BS_NCL"] || 0) +
    (computedAmounts["BS_CL"] || 0);
  const bsDiff = Math.round((totalAssets - totalLiabilities) * 100) / 100;
  const totalRevenue = (computedAmounts["PL_REV"] || 0);
  const totalExpenses = (computedAmounts["PL_EXP"] || 0);
  const netProfit = Math.round((totalRevenue - totalExpenses) * 100) / 100;

  // ─── NCE stats bar ───────────────────────────────────────────────────────────
  // Sum individual leaf codes so the stats bar is independent of computeTotal
  // parent nodes. NCE_NET_PROF (row XIII) comes from the profit-chain block.
  const nceTotalAssets      = NCE_ASSET_IDS.reduce((s, id) => s + (computedAmounts[id] || 0), 0);
  const nceTotalLiabilities = NCE_LIAB_IDS.reduce((s, id) => s + (computedAmounts[id] || 0), 0);
  const nceBsDiff           = Math.round((nceTotalAssets - nceTotalLiabilities) * 100) / 100;
  const nceBsBalanced       = Math.abs(nceTotalAssets - nceTotalLiabilities) < 1;
  const nceNetProfit        = computedAmounts["NCE_NET_PROF"] || 0;

  // ─── Active summary values (swap between NCE and corporate in JSX) ───────
  const corpBsBalanced    = Math.abs(bsDiff) < 1;
  const activeBsDiff      = isNonCorporate ? nceBsDiff      : bsDiff;
  const activeBsBalanced  = isNonCorporate ? nceBsBalanced  : corpBsBalanced;
  const activeTotalAssets = isNonCorporate ? nceTotalAssets : totalAssets;
  const activeNetProfit   = isNonCorporate ? nceNetProfit   : netProfit;

  // ─── NCE Signature — derived values ─────────────────────────────────────
  // Partner name comes from the engagement (Stage 1 form selection). The
  // matching membership number is looked up from the firm's
  // `membership_numbers` array — this is where the firm admin registers
  // each partner with their ICAI M.No. Legacy engagements may still have a
  // users-table lookup via `partnerData`, which is used as a fallback.
  const sigFirmName     = firmData?.name             || "";
  const sigFirmFRN      = firmData?.icai_firm_reg_no || "";
  const sigFirmCity     = (firmData?.address as any)?.city || "";
  const engPartnerName  = ((engagement as any)?.partner_name || "").trim();
  const firmMnoEntry    = Array.isArray(firmData?.membership_numbers)
    ? (firmData!.membership_numbers as any[]).find(
        (m: any) => (m?.partner_name || "").trim() === engPartnerName
      )
    : null;
  const sigPartnerName  =
    engPartnerName || partnerData?.name || "";
  const sigMembershipNo =
    firmMnoEntry?.membership_no || partnerData?.membership_number || "";
  const sigClientName   = engagement?.clients?.name      || "";

  // Pre-fill Place once firm data loads (only if user hasn't typed).
  // Falls back to "Ahmedabad" if neither user input nor firm city are present.
  useEffect(() => {
    if (!sigPlace) setSigPlace(sigFirmCity || "Ahmedabad");
  }, [sigFirmCity]);

  // ─── Corporate signature block — director state (per-engagement) ─────────
  // Auto-fetched from mrl_data.header_data on mount (already populated by the
  // MRL flow). User can edit inline; edits persist to localStorage.
  // (Firm name / Reg No / Partner name / Membership No come from sigFirmName
  //  etc. above — those are already auto-fetched and read-only here.)
  const SIG_DIR_KEY = `caflow:fs_sig_directors:${engagementId}`;
  type DirState = { dir1Name: string; dir1Din: string; dir2Name: string; dir2Din: string };
  const [corpSigDirs, setCorpSigDirs] = useState<DirState>(() => {
    if (typeof window === "undefined") return { dir1Name: "", dir1Din: "", dir2Name: "", dir2Din: "" };
    try {
      const raw = window.localStorage.getItem(SIG_DIR_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { dir1Name: "", dir1Din: "", dir2Name: "", dir2Din: "" };
  });
  const updateCorpSigDir = (field: keyof DirState, value: string) => {
    setCorpSigDirs(prev => {
      const next = { ...prev, [field]: value };
      try { window.localStorage.setItem(SIG_DIR_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  // Auto-load directors from mrl_data.header_data once, only if the local
  // copy is still empty (so user edits aren't clobbered on reload).
  useEffect(() => {
    if (!engagementId) return;
    if (corpSigDirs.dir1Name || corpSigDirs.dir2Name) return; // already populated
    let cancelled = false;
    (async () => {
      try {
        const { data: mrl } = await supabase
          .from("mrl_data")
          .select("header_data")
          .eq("engagement_id", engagementId)
          .maybeSingle();
        const h = (mrl as any)?.header_data || {};
        if (cancelled) return;
        if (h.director1Name || h.director2Name) {
          const next: DirState = {
            dir1Name: h.director1Name || "",
            dir1Din:  h.director1Din  || "",
            dir2Name: h.director2Name || "",
            dir2Din:  h.director2Din  || "",
          };
          setCorpSigDirs(next);
          try { window.localStorage.setItem(SIG_DIR_KEY, JSON.stringify(next)); } catch {}
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // ─── Open override dialog ───
  const openOverride = (code: string, name: string) => {
    setOverrideDialog({ code, name });
    const existing = manualOverrides[code];
    setOverrideAmount(existing ? String(existing.amount) : "");
    setOverrideReason(existing?.reason || "");
  };

  // ─── Save manual PY annexures to audit_engagements.py_manual_annexures ──
  const savePyAnnexures = async () => {
    setPyAnnexuresSaving(true);
    try {
      const payload: Record<string, PyAnnexRow[]> = {};
      for (const [code, rows] of Object.entries(pyAnnexures)) {
        const clean = (rows || [])
          .map(r => ({
            ledger_name: String(r.ledger_name || "").trim(),
            amount: Math.round(Number(r.amount || 0) * 100) / 100,
            ...(r.group ? { group: String(r.group).trim() } : {}),
          }))
          .filter(r => r.ledger_name && (Math.abs(r.amount) > 0.005 || r.ledger_name.length > 0));
        if (clean.length) payload[code] = clean;
      }
      const { error } = await (supabase.from as any)("audit_engagements")
        .update({ py_manual_annexures: payload })
        .eq("id", engagementId);
      if (error) throw error;
      toast.success("PY annexures saved");
      setPyAnnexuresDirty(false);
      queryClient.invalidateQueries({ queryKey: ["engagement", engagementId] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save PY annexures");
    } finally {
      setPyAnnexuresSaving(false);
    }
  };

  // ─── Create a PY Shell engagement (FY-1) for split-Tally / new-Tally clients ──
  // Inserts a minimal audit_engagements row flagged is_py_shell=true. User then
  // completes Stages 2–7 on the shell to produce PY FS; Stage 10 of the CY
  // engagement auto-picks it up via the existing priorEngagement query.
  const createPyShellEngagement = async () => {
    if (!engagement?.client_id || !engagement?.financial_year) {
      toast.error("Client / financial year missing on CY engagement");
      return;
    }
    const fyParts = String(engagement.financial_year).split("-");
    if (fyParts.length !== 2) {
      toast.error("Invalid financial year on CY engagement");
      return;
    }
    const prevFy = `${parseInt(fyParts[0]) - 1}-${(parseInt(fyParts[0])).toString().slice(-2)}`;
    setCreatingPyShell(true);
    try {
      // Guard: if any engagement (shell or real) already exists for client+FY-1, reuse it.
      const { data: existing } = await (supabase.from as any)("audit_engagements")
        .select("id, is_py_shell")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .maybeSingle();
      if (existing?.id) {
        toast.info("An FY-1 engagement already exists — opening it");
        navigate(`/audit/pipeline/${existing.id}?stage=2`);
        setPySourceDialog(false);
        return;
      }
      const { data, error } = await (supabase.from as any)("audit_engagements").insert({
        client_id: engagement.client_id,
        firm_id: engagement.firm_id ?? null,
        financial_year: prevFy,
        audit_type: engagement.audit_type ?? "statutory",
        entity_type: engagement.entity_type ?? engagement?.clients?.entity_type ?? null,
        audit_period_type: engagement.audit_period_type ?? "annual",
        status: "py_shell",
        pipeline_stage: 2,
        is_py_shell: true,
        stage_statuses: { "1": "complete", "2": "in_progress", "3": "not_started", "4": "not_started", "5": "not_started", "6": "not_started", "7": "not_started" },
      }).select("id").single();
      if (error) throw error;
      // Also stamp source on CY engagement
      await (supabase.from as any)("audit_engagements")
        .update({ py_source: "py_shell", py_setup_completed: true })
        .eq("id", engagementId);
      toast.success(`PY shell engagement created for FY ${prevFy}`);
      setPySourceDialog(false);
      queryClient.invalidateQueries({ queryKey: ["prior-engagement-fs"] });
      navigate(`/audit/pipeline/${data.id}?stage=2`);
    } catch (err: any) {
      toast.error(err.message || "Failed to create PY shell engagement");
    } finally {
      setCreatingPyShell(false);
    }
  };

  // ─── Stamp py_source on CY engagement (for "manual" or "none" choices) ──
  const setPySource = async (src: "manual" | "none") => {
    try {
      const { error } = await (supabase.from as any)("audit_engagements")
        .update({ py_source: src, py_setup_completed: true })
        .eq("id", engagementId);
      if (error) throw error;
      toast.success(src === "manual"
        ? "PY data source set to manual — use the panels below"
        : "PY comparative skipped");
      setPySourceDialog(false);
      queryClient.invalidateQueries({ queryKey: ["engagement", engagementId] });
    } catch (err: any) {
      toast.error(err.message || "Failed");
    }
  };

  // ─── PY column lock — when prior year is_finalized, PY cells are read-only ─
  const pyLocked = !!priorEngFinalized;

  // ─── Fetch PY P&L from FY-1 Tally trial balance ─────────────────────────
  // Looks up the prior FY engagement, paginates tally_trial_balance, maps
  // closing_balance through the current coa_mapping → P&L leaf codes, then
  // shows a confirmation dialog before writing py_manual_amounts.
  const fetchPyPLFromTally = useCallback(async () => {
    if (!engagement?.client_id || !engagement?.financial_year) return;
    setFetchingPyTally(true);
    try {
      const fyParts = (engagement.financial_year as string).split("-");
      if (fyParts.length !== 2) throw new Error("Bad FY");
      const prevFy = `${parseInt(fyParts[0]) - 1}-${String(parseInt(fyParts[0])).slice(-2)}`;

      // ── Find FY-1 engagement ─────────────────────────────────────────────
      let pyEngId: string | null = null;
      const { data: prevEng } = await supabase
        .from("audit_engagements")
        .select("id")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .is("deleted_at" as any, null)
        .maybeSingle();
      pyEngId = (prevEng as any)?.id ?? null;

      // ── Paginated TB fetcher ─────────────────────────────────────────────
      async function fetchEngTB(engId: string): Promise<any[]> {
        const PAGE = 1000;
        const all: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("tally_trial_balance")
            .select("ledger_name, closing_balance, balance_type")
            .eq("engagement_id", engId)
            .range(from, from + PAGE - 1);
          if (error || !data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
        }
        return all;
      }

      let pyTbRows: any[] = [];
      if (pyEngId) {
        pyTbRows = await fetchEngTB(pyEngId);
      }

      // Fallback: most recent completed sync_batch for this client that is NOT the current engagement
      if (!pyTbRows.length) {
        const { data: batchRow } = await (supabase.from as any)("sync_batches")
          .select("engagement_id")
          .eq("client_id", engagement.client_id)
          .in("status", ["complete", "completed", "success", "complete_with_warnings"])
          .neq("engagement_id", engagementId)
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const batchEngId: string | null = (batchRow as any)?.engagement_id ?? null;
        if (batchEngId) pyTbRows = await fetchEngTB(batchEngId);
      }

      if (!pyTbRows.length) {
        toast("No FY-1 Tally data found. Sync the prior year first or enter PY P&L manually.");
        return;
      }

      // ── P&L leaf codes from active FS tree ───────────────────────────────
      const plLeafCodes = new Set<string>(
        activeFlatItems
          .filter(i => {
            const sec = String(i.section || "").toLowerCase();
            const isPL = sec.includes("pl") || sec.includes("revenue") || sec.includes("expense");
            const isLeaf = !i.children || i.children.length === 0;
            return isPL && isLeaf;
          })
          .map(i => i.code)
      );

      // ── Aggregate signed closing balances per FS code ────────────────────
      // closing_balance is unsigned; balance_type DR → positive, CR → negative
      const preview: Record<string, number> = {};
      for (const row of pyTbRows) {
        const mapping = (coaMapping as any)[String(row.ledger_name || "").trim()];
        if (!mapping || !plLeafCodes.has(mapping.code)) continue;
        const cb    = Math.abs(Number(row.closing_balance ?? 0));
        const isDr  = String(row.balance_type ?? "").toUpperCase() === "DR";
        const signed = isDr ? cb : -cb;
        preview[mapping.code] = (preview[mapping.code] || 0) + signed;
      }

      if (!Object.keys(preview).length) {
        toast("No P&L ledgers matched current COA mapping. Check Stage 3 mapping first.");
        return;
      }

      setFetchPyTallyPreview(preview);
      setFetchPyTallyDialog(true);
    } catch (err) {
      console.error("fetchPyPLFromTally", err);
      toast("Failed to fetch FY-1 Tally data. Check console for details.");
    } finally {
      setFetchingPyTally(false);
    }
  }, [engagement, engagementId, activeFlatItems, coaMapping]);

  // ─── Save manual PY P&L amounts to audit_engagements.py_manual_amounts ──
  // Writes enriched { v, by, at } shape; amounts without meta retain legacy shape.
  const buildPyPayload = useCallback(
    (amounts: Record<string, number>, meta: Record<string, { by: string; at: string }>) => {
      const payload: Record<string, any> = {};
      for (const [k, v] of Object.entries(amounts)) {
        const n = Number(v);
        if (!Number.isFinite(n) || Math.abs(n) <= 0.005) continue;
        const m = meta[k];
        payload[k] = m
          ? { v: Math.round(n * 100) / 100, by: m.by, at: m.at }
          : Math.round(n * 100) / 100;
      }
      return payload;
    },
    []
  );

  // Apply confirmed Tally fetch → merge into pyManualAmounts and persist
  // IMPORTANT: declared after buildPyPayload to avoid TDZ error in deps array
  const applyPyTallyFetch = useCallback(async () => {
    if (!fetchPyTallyPreview) return;
    const byName = (user as any)?.name || (user as any)?.email || "Unknown";
    const now    = new Date().toISOString();
    const newAmounts = { ...pyManualAmounts, ...fetchPyTallyPreview };
    const newMeta: Record<string, { by: string; at: string }> = { ...pyManualMeta };
    for (const code of Object.keys(fetchPyTallyPreview)) {
      newMeta[code] = { by: `${byName} (Tally fetch)`, at: now };
    }
    setPyManualAmounts(newAmounts);
    setPyManualMeta(newMeta);
    const payload = buildPyPayload(newAmounts, newMeta);
    await supabase
      .from("audit_engagements")
      .update({ py_manual_amounts: payload } as any)
      .eq("id", engagementId);
    queryClient.invalidateQueries({ queryKey: ["engagement", engagementId] });
    setFetchPyTallyDialog(false);
    setFetchPyTallyPreview(null);
    toast(`PY P&L populated — ${Object.keys(fetchPyTallyPreview).length} line items fetched from FY-1 Tally.`);
  }, [fetchPyTallyPreview, pyManualAmounts, pyManualMeta, user, buildPyPayload, engagementId, queryClient]);

  const savePyManual = async () => {
    setPyManualSaving(true);
    try {
      const payload = buildPyPayload(pyManualAmounts, pyManualMeta);
      const { error } = await (supabase.from as any)("audit_engagements")
        .update({ py_manual_amounts: payload })
        .eq("id", engagementId);
      if (error) throw error;
      toast.success("PY P&L manual amounts saved");
      setPyManualDirty(false);
      queryClient.invalidateQueries({ queryKey: ["engagement", engagementId] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save PY manual amounts");
    } finally {
      setPyManualSaving(false);
    }
  };

  // ─── Open / save PY override dialog ──────────────────────────────────────
  const openPyOverride = (code: string, name: string) => {
    setPyOverrideDialog({ code, name });
    const existing = pyManualAmounts[code];
    setPyOverrideAmount(existing !== undefined ? String(existing) : "");
  };

  const savePyOverride = useCallback(async () => {
    if (!pyOverrideDialog) return;
    const { code } = pyOverrideDialog;
    const n = parseFloat(pyOverrideAmount);
    const now = new Date().toISOString();
    const byName = user?.name || user?.email || "Unknown";

    const newAmounts = { ...pyManualAmounts, [code]: Number.isFinite(n) ? n : 0 };
    const newMeta    = { ...pyManualMeta,    [code]: { by: byName, at: now } };

    // Remove if user cleared the amount
    if (!Number.isFinite(n) || pyOverrideAmount.trim() === "") {
      delete newAmounts[code];
      delete newMeta[code];
    }

    setPyManualAmounts(newAmounts);
    setPyManualMeta(newMeta);
    setPyManualDirty(true);

    // Auto-persist immediately (single-cell save UX)
    try {
      const payload = buildPyPayload(newAmounts, newMeta);
      await (supabase.from as any)("audit_engagements")
        .update({ py_manual_amounts: payload })
        .eq("id", engagementId);
      toast.success(`PY override saved for "${pyOverrideDialog.name}"`);
      queryClient.invalidateQueries({ queryKey: ["engagement", engagementId] });
    } catch (err: any) {
      toast.error("Saved locally, failed to persist: " + err.message);
    }
    setPyOverrideDialog(null);
    setPyOverrideAmount("");
    setPyManualDirty(false);
  }, [pyOverrideDialog, pyOverrideAmount, pyManualAmounts, pyManualMeta, user, buildPyPayload, engagementId, queryClient]);

  // ─── Save FS rows to DB ───
  const saveFS = async () => {
    setSaving(true);
    try {
      await supabase.from("fa_financial_statements").delete().eq("engagement_id", engagementId);

      const rows: any[] = [];
      let sortOrder = 0;

      const addItem = (item: FSLineItem & { depth: number }) => {
        const isManual = !!manualOverrides[item.code];
        rows.push({
          engagement_id: engagementId,
          section: item.section,
          line_item_code: item.code,
          line_item_name: item.name,
          note_ref: item.noteRef,
          schedule_ref: item.scheduleRef || null,
          amount_cy: Math.round((computedAmounts[item.code] || 0) * 100) / 100,
          amount_py: mergedPY[item.code] || null,
          is_manual: isManual,
          override_reason: isManual ? manualOverrides[item.code].reason : null,
          source: isManual ? "manual" : "tb_mapped",
          sort_order: sortOrder++,
        });
      };

      for (const item of activeFlatItems) addItem(item);

      const BATCH = 50;
      for (let i = 0; i < rows.length; i += BATCH) {
        await supabase.from("fa_financial_statements").insert(rows.slice(i, i + BATCH) as any);
      }

      toast.success("Financial Statements saved");
      queryClient.invalidateQueries({ queryKey: ["fs-rows"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Export to Excel (template-shaped, data auto-filled) ───
  // Primary BS + P&L sheets mirror the standard NCE template (entity title,
  // two-line column header, section headings on merged rows, blank spacer rows,
  // bold TOTAL rows, in-sheet signature block). Supporting sheets (Notes Index,
  // note-wise ledger annexures, PY Reconciliation) follow. Built with ExcelJS
  // so merges, fonts, borders and number formats survive into the .xlsx.
  const exportToExcel = async () => {
    const bsPrefix = isNonCorporate ? "NCE_BS_" : "BS_";
    const plPrefix = isNonCorporate ? "NCE_PL_" : "PL_";
    const bsItems = activeFlatItems.filter(i => i.section.startsWith(bsPrefix));
    const plItems = activeFlatItems.filter(i => i.section.startsWith(plPrefix));
    const fmt = (n: number) => Math.round((n || 0) * 100) / 100;

    // ─── Build self-contained CY / PY lookup tables for BS + P&L ─────────────
    // Rebuild amounts inline from tbAccounts + coaMapping so BS/PL export never
    // shows "-" placeholders when the component-level memo is stale or empty
    // at the moment the user clicks Export. Mirrors the logic in
    // `computedAmounts` / `computedAmountsPY` / `mergedPY` but is recomputed
    // fresh each time exportToExcel runs.
    // Phase UI-1: Consume the shared fsDisplayData memo rather than rebuilding
    // exportCy/exportPy inline. The memo covers the same logic (TB aggregation,
    // manual overrides, parent totals, prior-engagement / manual PY merge, NCE
    // profit chain) and is invalidated by the same deps. This guarantees the
    // Export button and the in-UI tabs (UI-2/3/4) always agree on amounts.
    const { exportCy, exportPy, cyOf, pyOf, bs: memoBs, pl: memoPl, cfs: memoCfs } = fsDisplayData;

    const clientName = engagement?.clients?.name || "—";
    const fy = engagement?.financial_year || "—";
    const cyLabel = `As at 31 March, ${cyYear}`;
    const pyLabel = `As at 31 March, ${pyYear}`;

    // ───────────────────────────────────────────────────────────────────────
    //  Phase 5 — Pixel-perfect corporate export (BS / PL / CFS)
    //  Dispatches to src/lib/fsExcelExport.ts for corporate (Schedule III)
    //  engagements. If the new exporter throws for any reason, control falls
    //  through to the legacy inline ExcelJS writer below so the user always
    //  gets a file — no regression.
    // ───────────────────────────────────────────────────────────────────────
    if (!isNonCorporate) {
      try {
        // Convert "2025-26" → ISO "2026-03-31" for fsExcelExport's Engagement.fy_end.
        const fyParts = String(engagement?.financial_year || "").split("-");
        const fyEndIso = fyParts.length === 2
          ? `${parseInt(fyParts[0], 10) + 1}-03-31`
          : `${cyYear}-03-31`;

        // Load up-to-2 director rows from mrl_data.header_data for this engagement.
        // Fire-and-wait to stay in-flight with the export click; if it fails we
        // simply proceed with empty directors (DASH renders in signature block).
        let directors: Array<{ name?: string | null; din?: string | null }> = [];
        try {
          const { data: mrl } = await supabase
            .from("mrl_data")
            .select("header_data")
            .eq("engagement_id", engagement.id)
            .maybeSingle();
          const h = (mrl as any)?.header_data || {};
          if (h.director1Name) directors.push({ name: h.director1Name, din: h.director1Din });
          if (h.director2Name) directors.push({ name: h.director2Name, din: h.director2Din });
        } catch (e) {
          console.warn("[FS Export] Could not load MRL directors:", e);
        }

        const fsEng: FSEngagement = {
          client_name:   engagement?.clients?.name || "[Company Name]",
          fy_end:        fyEndIso,
          sign_off_date: (engagement as any)?.sign_off_date ?? null,
          udin:          (engagement as any)?.udin ?? null,
          partner: {
            full_name:     sigPartnerName || null,
            membership_no: sigMembershipNo || null,
          },
          directors,
        };

        const fsFirm: FSFirmSettings = {
          name:            sigFirmName || "[Firm Name]",
          registration_no: sigFirmFRN  || "[Reg No]",
          city:            sigPlace || sigFirmCity || "[City]",
        };

        // Phase UI-1: bs/pl/cfs now come from the shared fsDisplayData memo
        // above. If the memo returned null (shouldn't happen in the corporate
        // branch, but guard defensively) fall through to legacy.
        if (!memoBs || !memoPl || !memoCfs) {
          throw new Error("fsDisplayData missing BS/PL/CFS for corporate engagement");
        }
        const blob = await generateFinancialStatementsXLSX(fsEng, fsFirm, memoBs, memoPl, memoCfs);
        const safeClientPP = (engagement?.clients?.name || "Client").replace(/[^A-Za-z0-9]/g, "_");
        const urlPP = URL.createObjectURL(blob);
        const aPP = document.createElement("a");
        aPP.href = urlPP;
        aPP.download = `FS_${safeClientPP}_${fy || "FY"}.xlsx`;
        document.body.appendChild(aPP);
        aPP.click();
        document.body.removeChild(aPP);
        URL.revokeObjectURL(urlPP);
        toast.success("Financial Statements exported (pixel-perfect Schedule III format)");
        return;
      } catch (err: any) {
        console.error("[FS Export] Pixel-perfect export failed, falling back to legacy:", err);
        toast.warning(`Using legacy Excel format: ${err?.message || "pixel-perfect export failed"}`);
        // Fall through to legacy ExcelJS code below
      }
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "CAFlow";
    wb.created = new Date();

    const MONEY_FMT = '#,##0.00;(#,##0.00);"-"';
    const thin = { style: "thin" as const, color: { argb: "FF000000" } };
    const fullBorder = { top: thin, bottom: thin, left: thin, right: thin };

    // A leaf row is one whose code is never referenced as a parent; for NCE
    // we encoded that as having a noteRef OR being part of the profit chain.
    const isLeaf = (it: FSLineItem & { depth: number }) =>
      !it.children || it.children.length === 0;

    // ───────────────────────── BALANCE SHEET ─────────────────────────
    const bs = wb.addWorksheet("Balance Sheet", {
      views: [{ showGridLines: false }],
    });
    // Col A: padding · B: Particulars · C-E: continuation (merged w/ B for
    // headings) · F: Note · G: CY · H: PY (matches template column layout).
    bs.columns = [
      { width: 2 },   // A  spacer
      { width: 46 },  // B  Particulars
      { width: 2 },   // C
      { width: 2 },   // D
      { width: 2 },   // E
      { width: 8 },   // F  Note
      { width: 18 },  // G  CY
      { width: 18 },  // H  PY
    ];

    let row = 3;
    bs.getCell(`B${row}`).value = clientName;
    bs.getCell(`B${row}`).font = { bold: true, size: 13 };
    bs.mergeCells(`B${row}:H${row}`);
    bs.getCell(`B${row}`).alignment = { horizontal: "center" };
    row++;
    bs.getCell(`B${row}`).value = `Balance Sheet as at 31 March, ${cyYear}`;
    bs.getCell(`B${row}`).font = { bold: true, size: 11 };
    bs.mergeCells(`B${row}:H${row}`);
    bs.getCell(`B${row}`).alignment = { horizontal: "center" };
    row++;
    bs.getCell(`B${row}`).value = "Amount (in Rs)";
    bs.getCell(`B${row}`).font = { italic: true, size: 9 };
    bs.mergeCells(`B${row}:H${row}`);
    bs.getCell(`B${row}`).alignment = { horizontal: "right" };
    row++;

    // Header block (2 rows): Particulars | Note | As at (Rs.) | As at (Rs.)
    const hdrTop = row++, hdrBot = row++;
    bs.getCell(`B${hdrTop}`).value = "Particulars";
    bs.mergeCells(`B${hdrTop}:E${hdrBot}`);
    bs.getCell(`F${hdrTop}`).value = "Note";
    bs.mergeCells(`F${hdrTop}:F${hdrBot}`);
    bs.getCell(`G${hdrTop}`).value = "As at (Rs.)";
    bs.getCell(`G${hdrBot}`).value = `31 March, ${cyYear}`;
    bs.getCell(`H${hdrTop}`).value = "As at (Rs.)";
    bs.getCell(`H${hdrBot}`).value = `31 March, ${pyYear}`;
    for (const a of ["B","F","G","H"]) {
      bs.getCell(`${a}${hdrTop}`).font = { bold: true };
      bs.getCell(`${a}${hdrBot}`).font = { bold: true };
    }
    for (let r = hdrTop; r <= hdrBot; r++) {
      for (const a of ["B","C","D","E","F","G","H"]) {
        bs.getCell(`${a}${r}`).border = fullBorder;
        bs.getCell(`${a}${r}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      }
    }

    // Apply thin borders to every cell in the BS body row so the printed /
    // exported layout matches the reference (NCE Financials.xlsx) where every
    // data cell sits inside a gridded table.
    const borderBsRow = (r: number) => {
      for (const a of ["B","C","D","E","F","G","H"]) {
        bs.getCell(`${a}${r}`).border = fullBorder;
      }
    };

    // Emit a leaf line: "  name" at B, note at F, CY at G, PY at H.
    const writeLeaf = (it: FSLineItem & { depth: number }) => {
      const cy = fmt(cyOf(it.code));
      const py = fmt(pyOf(it.code));
      bs.getCell(`B${row}`).value = "  ".repeat(Math.max(0, it.depth - 1)) + it.name;
      bs.mergeCells(`B${row}:E${row}`);
      bs.getCell(`F${row}`).value = it.noteRef ? it.noteRef : "";
      bs.getCell(`F${row}`).alignment = { horizontal: "center" };
      bs.getCell(`G${row}`).value = cy;
      bs.getCell(`H${row}`).value = py;
      bs.getCell(`G${row}`).numFmt = MONEY_FMT;
      bs.getCell(`H${row}`).numFmt = MONEY_FMT;
      borderBsRow(row);
      row++;
    };
    const writeBlank = () => { row++; };
    const writeSectionHeader = (text: string) => {
      bs.getCell(`B${row}`).value = text;
      bs.getCell(`B${row}`).font = { bold: true };
      bs.mergeCells(`B${row}:H${row}`);
      borderBsRow(row);
      row++;
    };
    const writeGroupHeader = (text: string) => {
      bs.getCell(`B${row}`).value = text;
      bs.getCell(`B${row}`).font = { bold: true, italic: true };
      bs.mergeCells(`B${row}:E${row}`);
      borderBsRow(row);
      row++;
    };
    const writeTotal = (text: string, cy: number, py: number) => {
      bs.getCell(`B${row}`).value = text;
      bs.getCell(`B${row}`).font = { bold: true };
      bs.mergeCells(`B${row}:F${row}`);
      bs.getCell(`G${row}`).value = fmt(cy);
      bs.getCell(`H${row}`).value = fmt(py);
      bs.getCell(`G${row}`).numFmt = MONEY_FMT;
      bs.getCell(`H${row}`).numFmt = MONEY_FMT;
      for (const a of ["B","C","D","E","F","G","H"]) {
        bs.getCell(`${a}${row}`).font = { bold: true };
        bs.getCell(`${a}${row}`).border = fullBorder;
      }
      row++;
    };

    // Walk the NCE tree: top-level sections (EL / AST), sub-groups, leaves.
    const ownSum = (code: string): { cy: number; py: number } => {
      const item = activeFlatItems.find(i => i.code === code);
      if (!item) return { cy: 0, py: 0 };
      return {
        cy: fmt(cyOf(code)),
        py: fmt(pyOf(code)),
      };
    };

    // EQUITY AND LIABILITIES
    const topLiab = bsItems.find(i => i.code === "NCE_EL" || i.code === "BS_EL");
    const topAst  = bsItems.find(i => i.code === "NCE_AST" || i.code === "BS_AST");
    if (topLiab) {
      writeSectionHeader(topLiab.name);
      const groups = bsItems.filter(i => i.depth === 1 && i.section === topLiab.section && i.code !== topLiab.code);
      for (const g of groups) {
        writeGroupHeader(g.name);
        const leaves = bsItems.filter(i => i.depth === 2 && i.section === g.section
          && bsItems.indexOf(i) > bsItems.indexOf(g)
          && bsItems.indexOf(i) < bsItems.indexOf(g) + 1 + (g.children?.length || 0));
        // Fallback: if tree depth info is ambiguous, use tree descent
        const directChildren = (g.children || []).filter(c => isLeaf(c as any));
        const rowsToEmit = directChildren.length ? directChildren : leaves;
        for (const c of rowsToEmit) writeLeaf(c as any);
        writeBlank();
      }
      const { cy, py } = ownSum(topLiab.code);
      writeTotal("TOTAL EQUITY AND LIABILITIES", cy, py);
      writeBlank();
    }
    // ASSETS
    if (topAst) {
      writeSectionHeader(topAst.name);
      const groups = (topAst.children || []);
      for (const g of groups) {
        writeGroupHeader(g.name);
        for (const c of (g.children || [])) writeLeaf(c as any);
        writeBlank();
      }
      const { cy, py } = ownSum(topAst.code);
      writeTotal("TOTAL ASSETS", cy, py);
      writeBlank();
    }
    // Significant accounting policies line (NCE only)
    const acctPol = bsItems.find(i => i.code === "NCE_ACCTPOL");
    if (acctPol) {
      bs.getCell(`B${row}`).value = "Summary of Significant Accounting Policies";
      bs.mergeCells(`B${row}:E${row}`);
      bs.getCell(`F${row}`).value = acctPol.noteRef || 1;
      bs.getCell(`F${row}`).alignment = { horizontal: "center" };
      bs.getCell(`B${row}`).font = { italic: true };
      row++;
    }

    // Signature block embedded in-sheet (per template)
    row += 2;
    bs.getCell(`B${row}`).value = "For,";
    bs.getCell(`C${row}`).value = sigFirmName || "[CA FIRM NAME]";
    bs.getCell(`C${row}`).font = { bold: true };
    bs.getCell(`F${row}`).value = "For,";
    bs.getCell(`G${row}`).value = sigClientName || clientName;
    bs.getCell(`G${row}`).font = { bold: true };
    bs.mergeCells(`G${row}:H${row}`);
    row++;
    bs.getCell(`B${row}`).value = "Chartered Accountants";
    bs.getCell(`B${row}`).font = { italic: true };
    bs.mergeCells(`B${row}:E${row}`);
    row++;
    bs.getCell(`B${row}`).value = "FRN:";
    bs.getCell(`C${row}`).value = sigFirmFRN || "[FRN]";
    row += 3;
    bs.getCell(`B${row}`).value = sigPartnerName || "[Partner Name]";
    bs.getCell(`B${row}`).font = { bold: true };
    row++;
    bs.getCell(`B${row}`).value = "Partner";
    bs.getCell(`F${row}`).value = "Place:";
    bs.getCell(`G${row}`).value = sigPlace || "";
    bs.mergeCells(`G${row}:H${row}`);
    row++;
    bs.getCell(`B${row}`).value = "Membership No.";
    bs.getCell(`C${row}`).value = sigMembershipNo || "";
    bs.getCell(`F${row}`).value = "Date:";
    bs.getCell(`G${row}`).value = sigDate || "";
    bs.mergeCells(`G${row}:H${row}`);

    // ───────────────────────── PROFIT & LOSS ─────────────────────────
    const pl = wb.addWorksheet("Profit & Loss", {
      views: [{ showGridLines: false }],
    });
    pl.columns = [
      { width: 2 },   // A spacer
      { width: 8 },   // B  Roman/sub-code
      { width: 40 },  // C  Particulars
      { width: 2 },   // D  continuation
      { width: 8 },   // E  Note
      { width: 18 },  // F  CY
      { width: 18 },  // G  PY
    ];
    let pr = 3;
    pl.getCell(`B${pr}`).value = clientName;
    pl.getCell(`B${pr}`).font = { bold: true, size: 13 };
    pl.mergeCells(`B${pr}:G${pr}`);
    pl.getCell(`B${pr}`).alignment = { horizontal: "center" };
    pr++;
    pl.getCell(`B${pr}`).value = `Statement of Profit and Loss for the year ended 31 March, ${cyYear}`;
    pl.getCell(`B${pr}`).font = { bold: true, size: 11 };
    pl.mergeCells(`B${pr}:G${pr}`);
    pl.getCell(`B${pr}`).alignment = { horizontal: "center" };
    pr++;
    pl.getCell(`B${pr}`).value = "Amount (in Rs)";
    pl.getCell(`B${pr}`).font = { italic: true, size: 9 };
    pl.mergeCells(`B${pr}:G${pr}`);
    pl.getCell(`B${pr}`).alignment = { horizontal: "right" };
    pr++;
    const pHdrTop = pr++, pHdrBot = pr++;
    pl.getCell(`B${pHdrTop}`).value = "Particulars";
    pl.mergeCells(`B${pHdrTop}:D${pHdrBot}`);
    pl.getCell(`E${pHdrTop}`).value = "Note";
    pl.mergeCells(`E${pHdrTop}:E${pHdrBot}`);
    pl.getCell(`F${pHdrTop}`).value = "As at";
    pl.getCell(`F${pHdrBot}`).value = `31 March, ${cyYear}`;
    pl.getCell(`G${pHdrTop}`).value = "As at";
    pl.getCell(`G${pHdrBot}`).value = `31 March, ${pyYear}`;
    for (const a of ["B","E","F","G"]) {
      pl.getCell(`${a}${pHdrTop}`).font = { bold: true };
      pl.getCell(`${a}${pHdrBot}`).font = { bold: true };
    }
    for (let r = pHdrTop; r <= pHdrBot; r++) {
      for (const a of ["B","C","D","E","F","G"]) {
        pl.getCell(`${a}${r}`).border = fullBorder;
        pl.getCell(`${a}${r}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      }
    }

    // Roman numeral / sub-code prefixes are already baked into item.name
    // (e.g. "I.  Revenue from operations"). Split them into col B vs col C so
    // the template's two-column layout is preserved.
    const splitRoman = (full: string): [string, string] => {
      // Match leading "I." / "II." / "(a)" / "(1)" etc.
      const m = full.match(/^\s*(\([a-zA-Z0-9]+\)|[IVXLCDM]+\.?)\s*(.*)$/);
      if (m) return [m[1], m[2]];
      return ["", full];
    };
    const borderPlRow = (r: number) => {
      for (const a of ["B","C","D","E","F","G"]) {
        pl.getCell(`${a}${r}`).border = fullBorder;
      }
    };
    const plLeaf = (it: FSLineItem & { depth: number }, noteVisible = true) => {
      const [roman, rest] = splitRoman(it.name);
      pl.getCell(`B${pr}`).value = roman;
      pl.getCell(`B${pr}`).alignment = { horizontal: "center" };
      pl.getCell(`C${pr}`).value = rest;
      pl.mergeCells(`C${pr}:D${pr}`);
      pl.getCell(`E${pr}`).value = noteVisible && it.noteRef ? it.noteRef : "";
      pl.getCell(`E${pr}`).alignment = { horizontal: "center" };
      pl.getCell(`F${pr}`).value = fmt(cyOf(it.code));
      pl.getCell(`G${pr}`).value = fmt(pyOf(it.code));
      pl.getCell(`F${pr}`).numFmt = MONEY_FMT;
      pl.getCell(`G${pr}`).numFmt = MONEY_FMT;
      borderPlRow(pr);
      pr++;
    };
    const plComputed = (it: FSLineItem & { depth: number }) => {
      const [roman, rest] = splitRoman(it.name);
      pl.getCell(`B${pr}`).value = roman;
      pl.getCell(`C${pr}`).value = rest;
      pl.mergeCells(`C${pr}:D${pr}`);
      pl.getCell(`F${pr}`).value = fmt(cyOf(it.code));
      pl.getCell(`G${pr}`).value = fmt(pyOf(it.code));
      pl.getCell(`F${pr}`).numFmt = MONEY_FMT;
      pl.getCell(`G${pr}`).numFmt = MONEY_FMT;
      for (const a of ["B","C","D","E","F","G"]) {
        pl.getCell(`${a}${pr}`).font = { bold: true };
        pl.getCell(`${a}${pr}`).border = fullBorder;
      }
      pl.getCell(`B${pr}`).alignment = { horizontal: "center" };
      pr++;
    };
    const plSection = (text: string) => {
      pl.getCell(`B${pr}`).value = text;
      pl.getCell(`B${pr}`).font = { bold: true };
      pl.mergeCells(`B${pr}:G${pr}`);
      borderPlRow(pr);
      pr++;
    };
    const plBlank = () => { pr++; };

    const find = (c: string) => activeFlatItems.find(i => i.code === c) as any;

    // INCOME
    plSection("INCOME");
    const rev  = find("NCE_REV_OPS") || find("PL_REV_OPS");
    const othI = find("NCE_REV_OTH") || find("PL_REV_OTH");
    const totInc = find("NCE_PL_INC") || find("PL_TOT_INC");
    if (rev)  plLeaf(rev);
    if (othI) plLeaf(othI);
    if (totInc) plComputed(totInc);
    plBlank();

    // EXPENSES
    plSection("EXPENSES");
    const expCodes = ["NCE_COGS","NCE_EMP_EXP","NCE_FIN_COST","NCE_DEPR","NCE_OTH_EXP"];
    for (const c of expCodes) {
      const it = find(c);
      if (it) plLeaf(it);
    }
    const totExp = find("NCE_PL_EXP");
    if (totExp) plComputed(totExp);
    plBlank();

    // Profit chain
    for (const c of ["NCE_PROF_V","NCE_EXCEP","NCE_PROF_VII","NCE_EXTORD","NCE_PROF_IX"]) {
      const it = find(c);
      if (it) plComputed(it);
    }
    plBlank();
    const partRem = find("NCE_PART_REM");
    if (partRem) plLeaf(partRem);
    const profXI = find("NCE_PROF_XI");
    if (profXI) plComputed(profXI);
    plBlank();

    // Tax expense with indented children
    const tax = find("NCE_TAX");
    if (tax) {
      const [roman, rest] = splitRoman(tax.name);
      pl.getCell(`B${pr}`).value = roman;
      pl.getCell(`C${pr}`).value = rest;
      pl.mergeCells(`C${pr}:D${pr}`);
      pl.getCell(`B${pr}`).font = { bold: true };
      pl.getCell(`C${pr}`).font = { bold: true };
      borderPlRow(pr);
      pr++;
      for (const c of ["NCE_CUR_TAX","NCE_PRIOR_TAX"]) {
        const it = find(c);
        if (!it) continue;
        pl.getCell(`C${pr}`).value = "       " + it.name;
        pl.mergeCells(`C${pr}:D${pr}`);
        pl.getCell(`F${pr}`).value = fmt(cyOf(it.code));
        pl.getCell(`G${pr}`).value = fmt(pyOf(it.code));
        pl.getCell(`F${pr}`).numFmt = MONEY_FMT;
        pl.getCell(`G${pr}`).numFmt = MONEY_FMT;
        borderPlRow(pr);
        pr++;
      }
      pl.getCell(`C${pr}`).value = "       Total tax expense";
      pl.mergeCells(`C${pr}:D${pr}`);
      const taxCy = fmt(cyOf("NCE_TAX"));
      const taxPy = fmt(pyOf("NCE_TAX"));
      pl.getCell(`F${pr}`).value = taxCy;
      pl.getCell(`G${pr}`).value = taxPy;
      pl.getCell(`F${pr}`).numFmt = MONEY_FMT;
      pl.getCell(`G${pr}`).numFmt = MONEY_FMT;
      for (const a of ["C","D","F","G"]) pl.getCell(`${a}${pr}`).font = { bold: true };
      borderPlRow(pr);
      pr++;
    }
    plBlank();
    const net = find("NCE_NET_PROF");
    if (net) plComputed(net);

    // Signature in P&L (mirror template)
    pr += 2;
    pl.getCell(`B${pr}`).value = "For,";
    pl.getCell(`C${pr}`).value = sigFirmName || "[CA FIRM NAME]";
    pl.getCell(`C${pr}`).font = { bold: true };
    pl.getCell(`E${pr}`).value = "For,";
    pl.getCell(`F${pr}`).value = sigClientName || clientName;
    pl.getCell(`F${pr}`).font = { bold: true };
    pl.mergeCells(`F${pr}:G${pr}`);
    pr++;
    pl.getCell(`C${pr}`).value = "Chartered Accountants";
    pl.getCell(`C${pr}`).font = { italic: true };
    pr++;
    pl.getCell(`B${pr}`).value = "FRN:";
    pl.getCell(`C${pr}`).value = sigFirmFRN || "[FRN]";
    pr += 3;
    pl.getCell(`B${pr}`).value = sigPartnerName || "[Partner Name]";
    pl.getCell(`B${pr}`).font = { bold: true };
    pl.mergeCells(`B${pr}:C${pr}`);
    pr++;
    pl.getCell(`B${pr}`).value = "Partner";
    pl.getCell(`E${pr}`).value = "Place:";
    pl.getCell(`F${pr}`).value = sigPlace || "";
    pl.mergeCells(`F${pr}:G${pr}`);
    pr++;
    pl.getCell(`B${pr}`).value = "Membership No.";
    pl.getCell(`C${pr}`).value = sigMembershipNo || "";
    pl.getCell(`E${pr}`).value = "Date:";
    pl.getCell(`F${pr}`).value = sigDate || "";
    pl.mergeCells(`F${pr}:G${pr}`);

    // ══════════════════════════════════════════════════════════════════════
    // NCE: Revised template sheets  (Note 1 | Capital | Notes | PPE)
    // Corporate: legacy Notes Index + per-note annexures + PY Reconciliation
    // ══════════════════════════════════════════════════════════════════════

    if (isNonCorporate) {
      // ─────────────────────── NOTE 1: Notes to Accounts ─────────────────────
      // Source: user-edited rows in `notes_to_accounts_data` (Stage 7 →
      // "Note 1" tab). Each selected note becomes a numbered paragraph, with
      // inline tokens (cash amount, closing stock, FA note refs, last note)
      // substituted from the same header_overrides the user filled in on-screen.
      const n1 = wb.addWorksheet("Note 1", { views: [{ showGridLines: false }] });
      n1.columns = [
        { width: 2 },    // A spacer
        { width: 10 },   // B  "Note N"
        { width: 32 },   // C  Title
        { width: 70 },   // D  Body
      ];
      let n1r = 2;
      const n1EntityName = notesToAccountsData?.header_overrides?.entityNameOverride
        || clientName;
      n1.getCell(`B${n1r}`).value = n1EntityName;
      n1.getCell(`B${n1r}`).font = { bold: true, size: 13 };
      n1.mergeCells(`B${n1r}:D${n1r}`);
      n1.getCell(`B${n1r}`).alignment = { horizontal: "center" };
      n1r++;
      n1.getCell(`B${n1r}`).value =
        `Notes forming part of the Financial Statements for the year ended 31st March, ${cyYear}`;
      n1.getCell(`B${n1r}`).font = { bold: true, size: 11 };
      n1.mergeCells(`B${n1r}:D${n1r}`);
      n1.getCell(`B${n1r}`).alignment = { horizontal: "center" };
      n1r++;
      n1.getCell(`B${n1r}`).value = "Note: Summary of Significant Accounting Policies";
      n1.getCell(`B${n1r}`).font = { italic: true, size: 10 };
      n1.mergeCells(`B${n1r}:D${n1r}`);
      n1.getCell(`B${n1r}`).alignment = { horizontal: "center" };
      n1r += 2;

      // Table header
      n1.getCell(`B${n1r}`).value = "Note";
      n1.getCell(`C${n1r}`).value = "Title";
      n1.getCell(`D${n1r}`).value = "Particulars";
      for (const a of ["B","C","D"]) {
        n1.getCell(`${a}${n1r}`).font = { bold: true };
        n1.getCell(`${a}${n1r}`).alignment = { horizontal: "center", vertical: "middle" };
        n1.getCell(`${a}${n1r}`).border = fullBorder;
      }
      n1r++;

      // Resolve saved notes (or fall back to the built-in template so the
      // sheet is never empty on a fresh engagement where the user hasn't
      // visited Stage 7 yet).
      const stage7Notes: any[] = Array.isArray(notesToAccountsData?.notes_json)
        ? notesToAccountsData.notes_json
        : [];
      const header = (notesToAccountsData?.header_overrides || {}) as any;
      const note1NewEntityEnabled = !!notesToAccountsData?.note1_new_entity_enabled;
      const note1NewEntityText    = notesToAccountsData?.note1_new_entity_text || "";
      const note3Variant          = notesToAccountsData?.note3_variant || "none";

      const resolveTokens = (text: string, lastNote: number): string =>
        (text || "")
          .replace(/\[CASH_AMOUNT\]/g,   String(header.cashAmount   || ""))
          .replace(/\[CLOSING_STOCK\]/g, String(header.closingStock || ""))
          .replace(/\[FA_NOTE\]/g,       String(header.faNoteNum    || ""))
          .replace(/\[DEP_NOTE\]/g,      String(header.depNoteNum   || ""))
          .replace(/\[LAST_NOTE\]/g,     String(header.lastNoteOverride || lastNote));

      const selectedNotes = stage7Notes.filter((n: any) => n.selected !== false);

      if (selectedNotes.length > 0) {
        selectedNotes.forEach((note: any, idx: number) => {
          const num = idx + 1;
          let body = resolveTokens(note.text || "", selectedNotes.length);
          if (note.id === "note-1" && note1NewEntityEnabled && note1NewEntityText) {
            body += "\n\n" + resolveTokens(note1NewEntityText, selectedNotes.length);
          }
          if (note.id === "note-3" && note3Variant !== "none" && header.note3VariantText) {
            body += "\n\n" + resolveTokens(header.note3VariantText, selectedNotes.length);
          }
          n1.getCell(`B${n1r}`).value = `Note ${num}`;
          n1.getCell(`B${n1r}`).font = { bold: true };
          n1.getCell(`B${n1r}`).alignment = { vertical: "top", horizontal: "center" };
          n1.getCell(`C${n1r}`).value = note.title || "";
          n1.getCell(`C${n1r}`).font = { bold: true };
          n1.getCell(`C${n1r}`).alignment = { vertical: "top", wrapText: true };
          n1.getCell(`D${n1r}`).value = body;
          n1.getCell(`D${n1r}`).alignment = { vertical: "top", wrapText: true };
          for (const a of ["B","C","D"]) n1.getCell(`${a}${n1r}`).border = fullBorder;
          const lines = Math.max(1,
            Math.ceil((body.length || 0) / 80) + (body.match(/\n/g)?.length ?? 0),
          );
          n1.getRow(n1r).height = Math.max(18, lines * 15);
          n1r++;
        });

        // Signature block after the notes
        n1r += 2;
        n1.getCell(`B${n1r}`).value = "For,";
        n1.getCell(`C${n1r}`).value = sigFirmName || "[CA FIRM NAME]";
        n1.getCell(`C${n1r}`).font = { bold: true };
        n1r++;
        n1.getCell(`B${n1r}`).value = "Chartered Accountants";
        n1.getCell(`B${n1r}`).font = { italic: true };
        n1.mergeCells(`B${n1r}:C${n1r}`);
        n1r++;
        n1.getCell(`B${n1r}`).value = "FRN:";
        n1.getCell(`C${n1r}`).value = sigFirmFRN || "[FRN]";
        n1r += 3;
        n1.getCell(`B${n1r}`).value = sigPartnerName || "[Partner Name]";
        n1.getCell(`B${n1r}`).font = { bold: true };
        n1r++;
        n1.getCell(`B${n1r}`).value = "Partner";
        n1r++;
        n1.getCell(`B${n1r}`).value = "Membership No.";
        n1.getCell(`C${n1r}`).value = sigMembershipNo || "";
      } else {
        // Fallback: hardcoded accounting policies when no Stage-7 notes exist.
        // Emitted in the same `Note | Title | Particulars` three-column
        // layout as the saved-notes branch above, so both code paths produce
        // a bordered table that matches the reference NCE Financials format.
        const policies: { num: string; title: string; text: string }[] = [
          { num: "1.",  title: "Basis of Preparation",          text: "The financial statements have been prepared under the historical cost convention on an accrual basis in accordance with generally accepted accounting principles applicable to Non-Corporate Entities in India." },
          { num: "2.",  title: "Revenue Recognition",           text: "Revenue from operations is recognised when it is earned and no significant uncertainty exists as to its ultimate realisation or collection. Interest income is recognised on a time proportionate basis taking into account the principal outstanding and the applicable rate." },
          { num: "3.",  title: "Property, Plant & Equipment",   text: "Fixed assets are stated at cost less accumulated depreciation. Cost comprises the purchase price and any attributable costs of bringing the asset to its working condition for its intended use. Subsequent costs are included in the asset's carrying amount only when it is probable that future economic benefits associated with the item will flow to the entity." },
          { num: "4.",  title: "Depreciation",                  text: "Depreciation on fixed assets is provided on the Written Down Value (WDV) method at rates prescribed under the Income Tax Act, 1961 / as estimated by management to reflect the useful economic lives of the assets. Depreciation on assets acquired / disposed of during the year is charged on a pro-rata basis." },
          { num: "5.",  title: "Inventories",                   text: "Inventories are valued at the lower of cost (computed on FIFO / weighted average basis) and net realisable value. Cost includes all costs of purchase and other costs incurred in bringing the inventories to their present location and condition." },
          { num: "6.",  title: "Employee Benefits",             text: "Short-term employee benefit obligations such as salaries, wages and bonus are recognised as an expense in the period in which the related services are rendered. Gratuity and other long-term benefit liabilities are recognised on an accrual basis or as per actuarial valuation, as applicable." },
          { num: "7.",  title: "Borrowing Costs",               text: "Borrowing costs directly attributable to acquisition or construction of qualifying assets are capitalised as part of the cost of such assets. Other borrowing costs are charged to the Statement of Profit and Loss in the period in which they are incurred." },
          { num: "8.",  title: "Provisions and Contingent Liabilities", text: "Provisions are recognised when the entity has a present obligation as a result of a past event, it is probable that an outflow of resources will be required to settle the obligation and a reliable estimate can be made. Contingent liabilities are disclosed unless the possibility of an outflow of resources embodying economic benefits is remote." },
          { num: "9.",  title: "Taxes on Income",               text: "Current tax is determined on the basis of the taxable income computed in accordance with the Income Tax Act, 1961 using applicable tax rates and tax laws. Advance tax and tax deducted at source are shown as assets after adjustment against current tax provisions." },
          { num: "10.", title: "Foreign Currency Transactions", text: "Transactions denominated in foreign currencies are recorded at the exchange rate prevailing at the date of the transaction. Monetary assets and liabilities denominated in foreign currencies are restated at the exchange rate prevailing at the balance sheet date. Any income or expense on account of exchange difference is recognised in the Statement of Profit and Loss." },
          { num: "11.", title: "Cash and Cash Equivalents",     text: "Cash and cash equivalents for the purposes of cash flow statement comprise cash at bank, cash in hand and fixed deposits with an original maturity of three months or less that are readily convertible to known amounts of cash." },
          { num: "12.", title: "Use of Estimates",              text: "The preparation of financial statements requires the management to make estimates and assumptions that affect the reported balances of assets and liabilities, disclosures relating to contingent liabilities as at the date of the financial statements and the reported amounts of income and expenses during the year. Management believes that the estimates used in the preparation of financial statements are prudent and reasonable." },
        ];

        for (const p of policies) {
          n1.getCell(`B${n1r}`).value = p.num;
          n1.getCell(`B${n1r}`).font = { bold: true };
          n1.getCell(`B${n1r}`).alignment = { vertical: "top", horizontal: "center" };
          n1.getCell(`C${n1r}`).value = p.title;
          n1.getCell(`C${n1r}`).font = { bold: true };
          n1.getCell(`C${n1r}`).alignment = { vertical: "top", wrapText: true };
          n1.getCell(`D${n1r}`).value = p.text;
          n1.getCell(`D${n1r}`).alignment = { wrapText: true, vertical: "top" };
          for (const a of ["B","C","D"]) n1.getCell(`${a}${n1r}`).border = fullBorder;
          const lines = Math.max(1, Math.ceil((p.text.length || 0) / 80));
          n1.getRow(n1r).height = Math.max(32, lines * 15);
          n1r++;
        }

        // Signature block
        n1r += 1;
        n1.getCell(`B${n1r}`).value = "For,";
        n1.getCell(`C${n1r}`).value = sigFirmName || "[CA FIRM NAME]";
        n1.getCell(`C${n1r}`).font = { bold: true };
        n1r++;
        n1.getCell(`B${n1r}`).value = "Chartered Accountants";
        n1.getCell(`B${n1r}`).font = { italic: true };
        n1.mergeCells(`B${n1r}:C${n1r}`);
        n1r++;
        n1.getCell(`B${n1r}`).value = "FRN:";
        n1.getCell(`C${n1r}`).value = sigFirmFRN || "[FRN]";
        n1r += 3;
        n1.getCell(`B${n1r}`).value = sigPartnerName || "[Partner Name]";
        n1.getCell(`B${n1r}`).font = { bold: true };
        n1r++;
        n1.getCell(`B${n1r}`).value = "Partner";
        n1r++;
        n1.getCell(`B${n1r}`).value = "Membership No.";
        n1.getCell(`C${n1r}`).value = sigMembershipNo || "";
      }

      // ─────────────────── NOTES TO ACCOUNTS — CAPITAL ───────────────────────
      const nc = wb.addWorksheet("Notes to Accounts-Capital", { views: [{ showGridLines: false }] });
      nc.columns = [
        { width: 2 },   // A spacer
        { width: 6 },   // B Sr.No
        { width: 28 },  // C Partner Name
        { width: 10 },  // D Share%
        { width: 16 },  // E Opening
        { width: 16 },  // F Introduced
        { width: 16 },  // G Remuneration
        { width: 16 },  // H Interest
        { width: 16 },  // I Withdrawals
        { width: 18 },  // J Share of P/L
        { width: 18 },  // K Closing
      ];
      let ncr = 2;
      nc.getCell(`B${ncr}`).value = clientName;
      nc.getCell(`B${ncr}`).font = { bold: true, size: 13 };
      nc.mergeCells(`B${ncr}:K${ncr}`);
      nc.getCell(`B${ncr}`).alignment = { horizontal: "center" };
      ncr++;
      nc.getCell(`B${ncr}`).value = "Notes to Accounts — Note 2: Owners' Capital Account";
      nc.getCell(`B${ncr}`).font = { bold: true, size: 11 };
      nc.mergeCells(`B${ncr}:K${ncr}`);
      nc.getCell(`B${ncr}`).alignment = { horizontal: "center" };
      ncr++;
      nc.getCell(`B${ncr}`).value = "Amount (in Rs)";
      nc.getCell(`B${ncr}`).font = { italic: true, size: 9 };
      nc.mergeCells(`B${ncr}:K${ncr}`);
      nc.getCell(`B${ncr}`).alignment = { horizontal: "right" };
      ncr++;

      // Two-row column header
      const capHdr1 = ncr++, capHdr2 = ncr++;
      const capHdrDefs: [string, string, string][] = [
        ["B", "Sr.", "No."],
        ["C", "Name of", "Partner / Proprietor"],
        ["D", "Share", "%"],
        ["E", "Opening", "Balance (Rs.)"],
        ["F", "Capital", "Introduced (Rs.)"],
        ["G", "Remuneration", "(Rs.)"],
        ["H", "Interest on", "Capital (Rs.)"],
        ["I", "Withdrawals /", "Drawings (Rs.)"],
        ["J", "Share of", "Profit / (Loss) (Rs.)"],
        ["K", "Closing", "Balance (Rs.)"],
      ];
      for (const [col, h1, h2] of capHdrDefs) {
        nc.getCell(`${col}${capHdr1}`).value = h1;
        nc.getCell(`${col}${capHdr2}`).value = h2;
        for (const r of [capHdr1, capHdr2]) {
          nc.getCell(`${col}${r}`).font = { bold: true };
          nc.getCell(`${col}${r}`).border = fullBorder;
          nc.getCell(`${col}${r}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        }
      }

      const capRows = (nceCapitalData || []) as any[];
      let capTotO = 0, capTotI = 0, capTotR = 0, capTotInt = 0;
      let capTotW = 0, capTotPS = 0, capTotCl = 0;

      const writeCapRow = (p: any, suffix: "cy" | "py") => {
        const openBal    = Number(p[`opening_balance_${suffix}`] || 0);
        const introduced = Number(p[`introduced_${suffix}`]      || 0);
        const remun      = Number(p[`remuneration_${suffix}`]    || 0);
        const interest   = Number(p[`interest_${suffix}`]        || 0);
        const withdrawals = Number(p[`withdrawals_${suffix}`]    || 0);
        const profitShare = Number(p[`profit_share_${suffix}`]   || 0);
        const closing    = fmt(openBal + introduced + remun + interest - withdrawals + profitShare);
        if (suffix === "cy") {
          capTotO   += openBal; capTotI   += introduced; capTotR  += remun;
          capTotInt += interest; capTotW  += withdrawals; capTotPS += profitShare;
          capTotCl  += closing;
        }
        nc.getCell(`B${ncr}`).value = p.partner_no;
        nc.getCell(`C${ncr}`).value = p.partner_name || "";
        nc.getCell(`D${ncr}`).value = p.profit_share_pct != null ? `${p.profit_share_pct}%` : "";
        nc.getCell(`E${ncr}`).value = fmt(openBal);
        nc.getCell(`F${ncr}`).value = fmt(introduced);
        nc.getCell(`G${ncr}`).value = fmt(remun);
        nc.getCell(`H${ncr}`).value = fmt(interest);
        nc.getCell(`I${ncr}`).value = fmt(withdrawals);
        nc.getCell(`J${ncr}`).value = fmt(profitShare);
        nc.getCell(`K${ncr}`).value = closing;
        for (const col of ["E","F","G","H","I","J","K"]) nc.getCell(`${col}${ncr}`).numFmt = MONEY_FMT;
        nc.getCell(`B${ncr}`).alignment = { horizontal: "center" };
        nc.getCell(`D${ncr}`).alignment = { horizontal: "center" };
        // Thin borders on every data cell — matches the NCE reference.
        for (const col of ["B","C","D","E","F","G","H","I","J","K"]) {
          nc.getCell(`${col}${ncr}`).border = fullBorder;
        }
        ncr++;
      };

      // CY rows
      if (capRows.length > 0) {
        for (const p of capRows) writeCapRow(p, "cy");
      } else {
        nc.getCell(`C${ncr}`).value = "(No capital account data entered — please complete Stage 8)";
        nc.getCell(`C${ncr}`).font = { italic: true, color: { argb: "FF888888" } };
        nc.mergeCells(`C${ncr}:K${ncr}`);
        ncr++;
      }

      // CY Total row
      nc.getCell(`B${ncr}`).value = "Total";
      nc.getCell(`E${ncr}`).value = fmt(capTotO);   nc.getCell(`F${ncr}`).value = fmt(capTotI);
      nc.getCell(`G${ncr}`).value = fmt(capTotR);   nc.getCell(`H${ncr}`).value = fmt(capTotInt);
      nc.getCell(`I${ncr}`).value = fmt(capTotW);   nc.getCell(`J${ncr}`).value = fmt(capTotPS);
      nc.getCell(`K${ncr}`).value = fmt(capTotCl);
      for (const col of ["B","C","D","E","F","G","H","I","J","K"]) {
        nc.getCell(`${col}${ncr}`).font = { bold: true };
        nc.getCell(`${col}${ncr}`).border = fullBorder;
      }
      for (const col of ["E","F","G","H","I","J","K"]) nc.getCell(`${col}${ncr}`).numFmt = MONEY_FMT;
      ncr += 2;

      // PY section
      if (capRows.length > 0) {
        nc.getCell(`B${ncr}`).value = "Prior Year (PY)";
        nc.getCell(`B${ncr}`).font = { bold: true, italic: true };
        nc.mergeCells(`B${ncr}:K${ncr}`);
        ncr++;
        let pyTotO = 0, pyTotI = 0, pyTotR = 0, pyTotInt = 0;
        let pyTotW = 0, pyTotPS = 0, pyTotCl = 0;
        for (const p of capRows) {
          const openBal = Number(p.opening_balance_py || 0);
          const intro   = Number(p.introduced_py      || 0);
          const remun   = Number(p.remuneration_py    || 0);
          const interest= Number(p.interest_py        || 0);
          const withd   = Number(p.withdrawals_py     || 0);
          const ps      = Number(p.profit_share_py    || 0);
          const closing = fmt(openBal + intro + remun + interest - withd + ps);
          pyTotO += openBal; pyTotI += intro; pyTotR += remun;
          pyTotInt += interest; pyTotW += withd; pyTotPS += ps; pyTotCl += closing;
          nc.getCell(`B${ncr}`).value = p.partner_no;
          nc.getCell(`C${ncr}`).value = p.partner_name || "";
          nc.getCell(`D${ncr}`).value = p.profit_share_pct != null ? `${p.profit_share_pct}%` : "";
          nc.getCell(`E${ncr}`).value = fmt(openBal);  nc.getCell(`F${ncr}`).value = fmt(intro);
          nc.getCell(`G${ncr}`).value = fmt(remun);    nc.getCell(`H${ncr}`).value = fmt(interest);
          nc.getCell(`I${ncr}`).value = fmt(withd);    nc.getCell(`J${ncr}`).value = fmt(ps);
          nc.getCell(`K${ncr}`).value = closing;
          for (const col of ["E","F","G","H","I","J","K"]) nc.getCell(`${col}${ncr}`).numFmt = MONEY_FMT;
          nc.getCell(`B${ncr}`).alignment = { horizontal: "center" };
          nc.getCell(`D${ncr}`).alignment = { horizontal: "center" };
          for (const col of ["B","C","D","E","F","G","H","I","J","K"]) {
            nc.getCell(`${col}${ncr}`).border = fullBorder;
          }
          ncr++;
        }
        nc.getCell(`B${ncr}`).value = "Total";
        nc.getCell(`E${ncr}`).value = fmt(pyTotO);  nc.getCell(`F${ncr}`).value = fmt(pyTotI);
        nc.getCell(`G${ncr}`).value = fmt(pyTotR);  nc.getCell(`H${ncr}`).value = fmt(pyTotInt);
        nc.getCell(`I${ncr}`).value = fmt(pyTotW);  nc.getCell(`J${ncr}`).value = fmt(pyTotPS);
        nc.getCell(`K${ncr}`).value = fmt(pyTotCl);
        for (const col of ["B","C","D","E","F","G","H","I","J","K"]) {
          nc.getCell(`${col}${ncr}`).font = { bold: true };
          nc.getCell(`${col}${ncr}`).border = { top: thin, bottom: thin };
        }
        for (const col of ["E","F","G","H","I","J","K"]) nc.getCell(`${col}${ncr}`).numFmt = MONEY_FMT;
      }

      // ──────────────── NOTES TO ACCOUNTS (NCE template format) ─────────────
      // 9-column layout mirroring the "NCE Financials" reference template:
      //   A spacer · B Particulars (wide) · C/D/E continuation ·
      //   F/G = Long-Term CY/PY · H/I = Short-Term CY/PY (or single CY/PY).
      const na = wb.addWorksheet("Notes to Accounts", { views: [{ showGridLines: false }] });
      na.columns = [
        { width: 2 },   // A spacer
        { width: 52 },  // B Particulars
        { width: 2 },   // C
        { width: 2 },   // D
        { width: 2 },   // E
        { width: 18 },  // F LT CY
        { width: 18 },  // G LT PY
        { width: 18 },  // H ST/single CY
        { width: 18 },  // I ST/single PY
      ];

      // ── User-entered notes data (Stage 8 → nce_financial_notes) ─────────
      // Build a lookup of saved raw data keyed by note_type, then compute the
      // auto-rollup totals for each note exactly the way the editor does. The
      // exported sheet therefore shows exactly what the user typed — no trial
      // balance heuristics.
      const savedNotes: Record<string, { cy: Record<string, number>; py: Record<string, number> }> = {};
      for (const row of (nceNotesData || []) as any[]) {
        const key = String(row.note_type || "");
        if (!key) continue;
        savedNotes[key] = {
          cy: (row.cy_data && typeof row.cy_data === "object") ? row.cy_data as Record<string, number> : {},
          py: (row.py_data && typeof row.py_data === "object") ? row.py_data as Record<string, number> : {},
        };
      }

      // Which config rows should actually appear in the export? We keep every
      // section header, every total, and any leaf row that has a non-zero
      // figure in at least one of CY/PY (across LT + ST for Pattern A). This
      // keeps the sheet compact while preserving the NCE Financials format.
      const hasValue = (cfg: NoteConfig, rowId: string, data: { cy: Record<string, number>; py: Record<string, number> }) => {
        if (cfg.pattern === "B") {
          return (data.cy[rowId] || 0) !== 0 || (data.py[rowId] || 0) !== 0;
        }
        return (
          (data.cy[rowId + "_lt"] || 0) !== 0 ||
          (data.py[rowId + "_lt"] || 0) !== 0 ||
          (data.cy[rowId + "_st"] || 0) !== 0 ||
          (data.py[rowId + "_st"] || 0) !== 0
        );
      };

      // ── Header writers (match NCE Financials.xlsx layout) ───────────────
      let nar = 2;
      const writeHeaderBlock = (section: "BS" | "PL") => {
        na.getCell(`B${nar}`).value = clientName;
        na.getCell(`B${nar}`).font = { bold: true, size: 12 };
        na.mergeCells(`B${nar}:I${nar}`);
        na.getCell(`B${nar}`).alignment = { horizontal: "center" };
        nar++;
        na.getCell(`B${nar}`).value =
          `Notes forming part of the Financial Statements for the year ended, 31st March, ${cyYear}`;
        na.getCell(`B${nar}`).font = { italic: true, size: 10 };
        na.mergeCells(`B${nar}:I${nar}`);
        na.getCell(`B${nar}`).alignment = { horizontal: "center" };
        nar++;
        na.getCell(`B${nar}`).value = section === "BS"
          ? `Notes to Balance Sheet as at 31st March, ${cyYear}`
          : `Notes to Profit & Loss A/c. for Accounting year, ${cyYear}`;
        na.getCell(`B${nar}`).font = { bold: true, size: 10 };
        na.mergeCells(`B${nar}:I${nar}`);
        na.getCell(`B${nar}`).alignment = { horizontal: "center" };
        nar += 2;
      };

      const writeColHeader = (pattern: "A" | "B") => {
        if (pattern === "A") {
          // Row 1: Particulars | Long Term | Short Term
          na.getCell(`B${nar}`).value = "Particulars";
          na.mergeCells(`B${nar}:E${nar}`);
          na.getCell(`F${nar}`).value = "Long Term";
          na.mergeCells(`F${nar}:G${nar}`);
          na.getCell(`H${nar}`).value = "Short Term";
          na.mergeCells(`H${nar}:I${nar}`);
          for (const col of ["B","F","H"]) {
            na.getCell(`${col}${nar}`).font = { bold: true };
            na.getCell(`${col}${nar}`).alignment = { horizontal: "center" };
            na.getCell(`${col}${nar}`).border = fullBorder;
          }
          nar++;
          // Row 2: blank | CY | PY | CY | PY
          na.getCell(`B${nar}`).value = "";
          na.mergeCells(`B${nar}:E${nar}`);
          na.getCell(`F${nar}`).value = `As at 31 Mar ${cyYear} (Rs.)`;
          na.getCell(`G${nar}`).value = `As at 31 Mar ${pyYear} (Rs.)`;
          na.getCell(`H${nar}`).value = `As at 31 Mar ${cyYear} (Rs.)`;
          na.getCell(`I${nar}`).value = `As at 31 Mar ${pyYear} (Rs.)`;
        } else {
          na.getCell(`B${nar}`).value = "Particulars";
          na.mergeCells(`B${nar}:E${nar}`);
          na.getCell(`H${nar}`).value = `As at 31 Mar ${cyYear} (Rs.)`;
          na.getCell(`I${nar}`).value = `As at 31 Mar ${pyYear} (Rs.)`;
        }
        for (const col of ["B","F","G","H","I"]) {
          const c = na.getCell(`${col}${nar}`);
          c.font = { bold: true };
          c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          c.border = fullBorder;
        }
        nar++;
      };

      const disp = (n: number) => Math.round((n || 0) * 100) / 100;

      const writeNote = (cfg: NoteConfig, isFirstOfGroup: boolean) => {
        const meta = NOTE_META[cfg.noteType];
        if (!meta) return;
        if (isFirstOfGroup) writeHeaderBlock(meta.section);

        // Compute rolled-up data from whatever the user saved (empty → zeros)
        const raw = savedNotes[cfg.noteType] || { cy: {}, py: {} };
        const { cy, py } = computeDisplayData(cfg, raw.cy, raw.py);

        // Note title row: "Note :  <short name>"
        na.getCell(`B${nar}`).value = `Note ${meta.noteNumber} :  ${meta.shortName}`;
        na.getCell(`B${nar}`).font = { bold: true };
        na.mergeCells(`B${nar}:I${nar}`);
        na.getCell(`B${nar}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
        nar++;

        writeColHeader(cfg.pattern);

        // Render each config row. Keep headers + totals unconditionally, and
        // skip leaf rows whose values are all zero to avoid a wall of dashes.
        for (const row of cfg.rows) {
          if (!row.isSectionHeader && !row.isTotal && !hasValue(cfg, row.id, { cy, py })) continue;

          const indent = row.indent ?? 0;
          na.getCell(`B${nar}`).value = `${"   ".repeat(indent)}${row.label}`;
          na.mergeCells(`B${nar}:E${nar}`);
          if (row.isSectionHeader || row.isTotal) {
            na.getCell(`B${nar}`).font = { bold: true };
          }

          if (!row.isSectionHeader) {
            if (cfg.pattern === "A") {
              const ltCy = disp(cy[row.id + "_lt"] || 0);
              const ltPy = disp(py[row.id + "_lt"] || 0);
              const stCy = disp(cy[row.id + "_st"] || 0);
              const stPy = disp(py[row.id + "_st"] || 0);
              na.getCell(`F${nar}`).value = ltCy; na.getCell(`F${nar}`).numFmt = MONEY_FMT;
              na.getCell(`G${nar}`).value = ltPy; na.getCell(`G${nar}`).numFmt = MONEY_FMT;
              na.getCell(`H${nar}`).value = stCy; na.getCell(`H${nar}`).numFmt = MONEY_FMT;
              na.getCell(`I${nar}`).value = stPy; na.getCell(`I${nar}`).numFmt = MONEY_FMT;
            } else {
              const c = disp(cy[row.id] || 0);
              const pv = disp(py[row.id] || 0);
              na.getCell(`H${nar}`).value = c;  na.getCell(`H${nar}`).numFmt = MONEY_FMT;
              na.getCell(`I${nar}`).value = pv; na.getCell(`I${nar}`).numFmt = MONEY_FMT;
            }
            if (row.isTotal) {
              for (const col of ["B","F","G","H","I"]) {
                na.getCell(`${col}${nar}`).border = { top: thin, bottom: thin };
              }
            }
          }
          nar++;
        }
        nar++; // spacer between notes
      };

      // Render notes in NOTE_META order, grouped BS first then PL.
      const orderedConfigs = NOTES_CONFIG
        .filter(c => NOTE_META[c.noteType])
        .sort((a, b) => {
          const sa = NOTE_META[a.noteType].section, sb = NOTE_META[b.noteType].section;
          if (sa !== sb) return sa === "BS" ? -1 : 1;
          // Within a section, keep the declared order in NOTES_CONFIG
          return NOTES_CONFIG.indexOf(a) - NOTES_CONFIG.indexOf(b);
        });
      let lastSection: "BS" | "PL" | null = null;
      for (const cfg of orderedConfigs) {
        const section = NOTE_META[cfg.noteType].section;
        const isFirstOfGroup = section !== lastSection;
        writeNote(cfg, isFirstOfGroup);
        lastSection = section;
      }

      // ──────────────── NOTES TO ACCOUNTS — PPE ──────────────────────────────
      const np = wb.addWorksheet("Notes to Accounts-PPE", { views: [{ showGridLines: false }] });
      np.columns = [
        { width: 2 },   // A spacer
        { width: 24 },  // B Asset Name
        { width: 8 },   // C Rate%
        { width: 16 },  // D Opening Gross Block
        { width: 16 },  // E Additions (Pre-Sep)
        { width: 16 },  // F Additions (Post-Sep)
        { width: 16 },  // G Total Gross Block
        { width: 16 },  // H Depreciation for Year
        { width: 16 },  // I Net Block CY
        { width: 16 },  // J Net Block PY
      ];
      let npr = 2;
      np.getCell(`B${npr}`).value = clientName;
      np.getCell(`B${npr}`).font = { bold: true, size: 13 };
      np.mergeCells(`B${npr}:J${npr}`);
      np.getCell(`B${npr}`).alignment = { horizontal: "center" };
      npr++;
      np.getCell(`B${npr}`).value = "Notes to Accounts — Note 10: Property, Plant & Equipment";
      np.getCell(`B${npr}`).font = { bold: true, size: 11 };
      np.mergeCells(`B${npr}:J${npr}`);
      np.getCell(`B${npr}`).alignment = { horizontal: "center" };
      npr++;
      np.getCell(`B${npr}`).value = "Amount (in Rs)";
      np.getCell(`B${npr}`).font = { italic: true, size: 9 };
      np.mergeCells(`B${npr}:J${npr}`);
      np.getCell(`B${npr}`).alignment = { horizontal: "right" };
      npr++;

      // Two-row PPE column header
      const ppeHdr1 = npr++, ppeHdr2 = npr++;
      const ppeHdrDefs: [string, string, string][] = [
        ["B", "Asset Name", ""],
        ["C", "Rate", "%"],
        ["D", "Opening", "Gross Block (Rs.)"],
        ["E", "Additions", "Pre-Sep (Rs.)"],
        ["F", "Additions", "Post-Sep (Rs.)"],
        ["G", "Total", "Gross Block (Rs.)"],
        ["H", "Depreciation", "for Year (Rs.)"],
        ["I", "Net Block", `31 Mar ${cyYear} (Rs.)`],
        ["J", "Net Block", `31 Mar ${pyYear} (Rs.)`],
      ];
      for (const [col, h1, h2] of ppeHdrDefs) {
        np.getCell(`${col}${ppeHdr1}`).value = h1;
        np.getCell(`${col}${ppeHdr2}`).value = h2;
        for (const r of [ppeHdr1, ppeHdr2]) {
          np.getCell(`${col}${r}`).font = { bold: true };
          np.getCell(`${col}${r}`).border = fullBorder;
          np.getCell(`${col}${r}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        }
      }

      const ppeRows = (ncePpeData || []) as any[];
      const ppeTangible  = ppeRows.filter((r: any) => r.asset_category === "tangible");
      const ppeIntangible = ppeRows.filter((r: any) => r.asset_category === "intangible");

      const writePpeSection = (rows: any[], label: string) => {
        if (rows.length === 0) return;
        np.getCell(`B${npr}`).value = label;
        np.getCell(`B${npr}`).font = { bold: true, italic: true };
        np.mergeCells(`B${npr}:J${npr}`);
        npr++;
        let tO = 0, tPre = 0, tPost = 0, tTot = 0, tDep = 0, tNetCy = 0, tNetPy = 0;
        for (const r of rows) {
          const opening = Number(r.opening_balance || 0);
          const addPre  = Number(r.additions_pre   || 0);
          const addPost = Number(r.additions_post  || 0);
          const total   = Number(r.total || 0) || (opening + addPre + addPost);
          const dep     = Number(r.depreciation    || 0);
          const netCy   = Number(r.closing_balance || 0) || (total - dep);
          // PY net block = prior opening (= current opening before additions) - prior dep
          // Best approximation without PY PPE data: opening block net of dep already embedded.
          const netPy   = Math.max(0, opening - dep);
          tO += opening; tPre += addPre; tPost += addPost;
          tTot += total; tDep += dep; tNetCy += netCy; tNetPy += netPy;
          np.getCell(`B${npr}`).value = r.asset_name || "";
          np.getCell(`C${npr}`).value = r.rate_pct != null ? `${r.rate_pct}%` : "";
          np.getCell(`C${npr}`).alignment = { horizontal: "center" };
          np.getCell(`D${npr}`).value = fmt(opening);
          np.getCell(`E${npr}`).value = fmt(addPre);
          np.getCell(`F${npr}`).value = fmt(addPost);
          np.getCell(`G${npr}`).value = fmt(total);
          np.getCell(`H${npr}`).value = fmt(dep);
          np.getCell(`I${npr}`).value = fmt(netCy);
          np.getCell(`J${npr}`).value = fmt(netPy);
          for (const col of ["D","E","F","G","H","I","J"]) np.getCell(`${col}${npr}`).numFmt = MONEY_FMT;
          npr++;
        }
        // Sub-total
        np.getCell(`B${npr}`).value = `Total — ${label}`;
        np.getCell(`D${npr}`).value = fmt(tO);   np.getCell(`E${npr}`).value = fmt(tPre);
        np.getCell(`F${npr}`).value = fmt(tPost); np.getCell(`G${npr}`).value = fmt(tTot);
        np.getCell(`H${npr}`).value = fmt(tDep);  np.getCell(`I${npr}`).value = fmt(tNetCy);
        np.getCell(`J${npr}`).value = fmt(tNetPy);
        for (const col of ["B","C","D","E","F","G","H","I","J"]) {
          np.getCell(`${col}${npr}`).font = { bold: true };
          np.getCell(`${col}${npr}`).border = { top: thin, bottom: thin };
        }
        for (const col of ["D","E","F","G","H","I","J"]) np.getCell(`${col}${npr}`).numFmt = MONEY_FMT;
        npr += 2;
      };

      writePpeSection(ppeTangible,  "Tangible Assets");
      writePpeSection(ppeIntangible, "Intangible Assets");

      if (ppeRows.length === 0) {
        np.getCell(`B${npr}`).value = "(No PPE data entered — please complete Stage 8)";
        np.getCell(`B${npr}`).font = { italic: true, color: { argb: "FF888888" } };
        np.mergeCells(`B${npr}:J${npr}`);
      }

      // ──────────────── CLIENT CERTIFICATE & MANAGEMENT LETTER ─────────────
      // Both tabs in Stage 8 persist to `nce_letters` (letter_type column).
      // Render each as its own worksheet, laid out like printed letter paper.
      const lettersByType: Record<string, any> = {};
      for (const row of (nceLettersData || []) as any[]) {
        if (row?.letter_type) lettersByType[row.letter_type] = row;
      }

      // Client address: `clients.address` is plain text in the schema. Pulled
      // via the dedicated clientDetail query because the engagement prop from
      // AuditPipeline doesn't select address.
      const clientAddress = String(
        (clientDetail as any)?.address
          ?? (engagement as any)?.clients?.address
          ?? ""
      ).trim();
      // Firm address: `firms.address` is JSON — reuse the same flattening
      // rule as the Stage 8 components for parity with the on-screen letter.
      const flattenFirmAddr = (addr: unknown): string => {
        if (!addr) return "";
        if (typeof addr === "string") return addr;
        const a = addr as Record<string, unknown>;
        return [a.line1, a.line2, a.street, a.city || a.district, a.state, a.pincode]
          .filter(Boolean).join(", ");
      };
      const firmAddress = flattenFirmAddr((firmData as any)?.address);
      const firmFRN     = sigFirmFRN;
      const firmName    = sigFirmName;
      const letterClientName = sigClientName || clientName;

      // Format ISO date "YYYY-MM-DD" → "DD/MM/YYYY"; blank if absent
      const fmtLetterDate = (iso?: string | null): string => {
        if (!iso) return "";
        const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
      };
      // Stage 8 UI defaults letter_date to today() when the user hasn't saved;
      // mirror that here so the exported sheet isn't missing a date.
      const todayIso = new Date().toISOString().slice(0, 10);

      // "2025-26" → "31st March, 2026"  (matches NCEManagementLetter helper)
      const fyEndDate = (fy: string): string => {
        const part = (fy || "").split("-")[1];
        if (!part) return "";
        const yr = parseInt(part) + 2000;
        return `31st March, ${yr}`;
      };

      // Shared letter-sheet scaffold — writes sender / recipient / date block
      // and returns a cursor + helpers for the body paragraphs.
      //
      // Column layout: A spacer · B list-number · C body. Body cells are NOT
      // merged — Excel won't auto-fit row height on merged wrapText cells, so
      // we write paragraphs into C only (B stays empty for paragraphs) and
      // compute an explicit row height from the text length.
      const buildLetterSheet = (sheetName: string, letterType: "client_certificate" | "management_letter") => {
        const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] });
        const BODY_WIDTH = 110;
        ws.columns = [
          { width: 3           },  // A spacer
          { width: 5           },  // B list number
          { width: BODY_WIDTH  },  // C body
        ];
        // Approximate "characters per line" at our body-column width — used to
        // set row heights for wrapped paragraphs so nothing gets cut off.
        const CHARS_PER_LINE = 105;
        const LINE_H         = 16;
        const rowHeightFor = (text: string) => {
          const lines = Math.max(1, Math.ceil((text?.length || 0) / CHARS_PER_LINE));
          return lines * LINE_H;
        };

        let r = 2;

        // Sender — entity name + address
        ws.getCell(`C${r}`).value = letterClientName || "[Entity Name]";
        ws.getCell(`C${r}`).font = { bold: true, size: 12 };
        r++;
        if (clientAddress) {
          ws.getCell(`C${r}`).value = clientAddress;
          ws.getCell(`C${r}`).alignment = { wrapText: true, vertical: "top" };
          ws.getRow(r).height = rowHeightFor(clientAddress);
          r++;
        }
        // Date — default to today (matches Stage 8 UI behaviour)
        const rawDate = lettersByType[letterType]?.letter_date || todayIso;
        ws.getCell(`C${r}`).value = `Date : ${fmtLetterDate(rawDate)}`;
        r += 2;

        // Recipient — "To," + firm name + address + FRN
        ws.getCell(`C${r}`).value = "To,"; r++;
        ws.getCell(`C${r}`).value = firmName || "[Audit Firm Name]";
        ws.getCell(`C${r}`).font = { bold: true };
        r++;
        if (firmAddress) {
          ws.getCell(`C${r}`).value = firmAddress;
          ws.getCell(`C${r}`).alignment = { wrapText: true, vertical: "top" };
          ws.getRow(r).height = rowHeightFor(firmAddress);
          r++;
        }
        if (firmFRN) {
          ws.getCell(`C${r}`).value = `FRN: ${firmFRN}`;
          r++;
        }
        r++;

        return {
          ws,
          cursor: () => r,
          bump: (n = 1) => { r += n; },
          // Write a full-width paragraph in column C
          writePara: (text: string, opts: { bold?: boolean; italic?: boolean } = {}) => {
            const c = ws.getCell(`C${r}`);
            c.value = text;
            c.alignment = { wrapText: true, vertical: "top" };
            if (opts.bold)   c.font = { ...(c.font || {}), bold: true };
            if (opts.italic) c.font = { ...(c.font || {}), italic: true };
            ws.getRow(r).height = rowHeightFor(text);
            r++;
          },
          // Write a numbered list item: B=number, C=body
          writeListItem: (num: number, text: string) => {
            ws.getCell(`B${r}`).value = `${num}.`;
            ws.getCell(`B${r}`).alignment = { vertical: "top", horizontal: "right" };
            ws.getCell(`C${r}`).value = text;
            ws.getCell(`C${r}`).alignment = { wrapText: true, vertical: "top" };
            ws.getRow(r).height = rowHeightFor(text);
            r++;
          },
        };
      };

      // ── Client Certificate ──────────────────────────────────────────────
      {
        const cert = lettersByType["client_certificate"] || {};
        const L = buildLetterSheet("Client Certificate", "client_certificate");

        L.writePara("Dear Sir,");
        L.bump();
        L.writePara(
          `In connection with the Tax Audits for the financial year ${fyStr || "[FY]"} u/s. 44AB, we herewith certify as under :`,
        );
        L.bump();

        const cash = cert.cash_on_hand != null
          ? Number(cert.cash_on_hand).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "_______";
        const stock = cert.closing_stock != null
          ? Number(cert.closing_stock).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "_______";
        const stockDate = fmtLetterDate(cert.closing_stock_date) || "____________";

        L.writeListItem(1, `Cash on hand Rs. ${cash} was with the firm and same was tallied with the cash book.`);
        L.writeListItem(2, `Approxi. Value of the Closing stock is Rs. ${stock} as on ${stockDate} and same was physically verified.`);
        L.writeListItem(3, "Method of valuation is cost or market whichever is less. Quantitive detailes are maintained.");
        L.writeListItem(4, "Method accounting is mercantile, which is same method which was employed in immediately preceding year.");
        L.writeListItem(5, "We certify that there is no person/s to whom payments made to persons specified in section 40A(2)(b) except as shown in Form-3CD.");
        L.writeListItem(6, "We certify that Fixed Assets are stated at cost as stated in books of accounts.");
        L.writeListItem(7, "I have made every payments exceeding Rs.10000 relating to any expenditure covered under section 40A(3) by an a/c. payee cheque drawn on a bank or an a/c. payee bank draft only.");
        L.writeListItem(8, "We here with inform and certify that the loan or deposit or specified advance taken or accepted or repaid for an amount of Rs.10000/- or more, during the year or earlier year/s was taken or accepted or repaid through account payee cheque or bank draft or ECS only.");
        L.writeListItem(9, "We have accounted the entries in the books of accounts whenever the supporting proof are not available, we have prepared vouchers and we authenticate the same that all are for the business of the firm");
        L.bump();
        L.writePara("You are requested to note the same.");
        L.bump(2);
        L.writePara("Yours faithfully,");
        L.bump(2);
        L.writePara("x_____________");
        L.writePara("(Signature & stamp)");
      }

      // ── Management Letter ──────────────────────────────────────────────
      {
        const L = buildLetterSheet("Management Letter", "management_letter");
        L.writePara(`Subject : Appointment as Tax Auditors for Financial year ${fyStr || "[FY]"}`, { bold: true });
        L.bump();
        L.writePara("Dear Sir,");
        L.bump();
        L.writePara(
          `We are pleased to informed you that our firm has appointed you to carried out Tax Audit u/s. 44AB books of accounts of my/our business for the financial year ending on ${fyEndDate(fyStr)}.`,
        );
        L.bump();
        L.writePara("You are requested to confirm the same.");
        L.bump(2);
        L.writePara("Thank You.");
        L.writePara("Yours faithfully,");
        L.bump(2);
        L.writePara("x_____________");
        L.writePara("(Signature & stamp)");
      }

    } else {
      // ─────── Corporate: Notes Index + per-note annexures + PY Reconciliation ─
      const notedItems = activeFlatItems.filter(i => i.noteRef);
      const nx = wb.addWorksheet("Notes Index");
      nx.columns = [
        { header: "Note",     key: "n",  width: 8 },
        { header: "Line Item", key: "li", width: 42 },
        { header: "Code",     key: "c",  width: 16 },
        { header: `CY ${cyYear} (Rs.)`, key: "cy", width: 18 },
        { header: `PY ${pyYear} (Rs.)`, key: "py", width: 18 },
      ];
      nx.getRow(1).font = { bold: true };
      for (const i of notedItems) {
        const r = nx.addRow({
          n: `N${i.noteRef}`,
          li: i.name,
          c:  i.code,
          cy: fmt(computedAmounts[i.code] || 0),
          py: fmt(mergedPY[i.code] || 0),
        });
        r.getCell("cy").numFmt = MONEY_FMT;
        r.getCell("py").numFmt = MONEY_FMT;
      }

      for (const item of notedItems) {
        const tbLedgerNames = new Set<string>();
        const rows: Array<Record<string, any>> = tbAccounts
          .filter(a => coaMapping[a.account_name]?.code === item.code)
          .map(a => {
            tbLedgerNames.add(String(a.account_name).toLowerCase().trim());
            return {
              ledger: a.account_name,
              group:  a.account_group || "",
              cy: fmt(a.balance),
              py: fmt(a.opening_balance || 0),
              variance: fmt(a.balance - (a.opening_balance || 0)),
              status: (Math.abs(a.opening_balance || 0) < 0.005 && Math.abs(a.balance) >= 0.005)
                ? "NEW"
                : (Math.abs(a.opening_balance || 0) >= 0.005 && Math.abs(a.balance) < 0.005)
                  ? "CLOSED" : "",
            };
          });
        const manualRows = pyAnnexures[item.code] || [];
        for (const r of manualRows) {
          const name = String(r.ledger_name || "").trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (tbLedgerNames.has(key)) {
            const existing = rows.find(l => String(l.ledger).toLowerCase().trim() === key);
            if (existing) {
              existing.py = fmt(r.amount);
              existing.variance = fmt((existing.cy as number) - r.amount);
            }
          } else {
            rows.push({
              ledger: name, group: r.group || "",
              cy: 0, py: fmt(r.amount),
              variance: fmt(-r.amount), status: "PY-ONLY",
            });
          }
        }
        if (rows.length === 0) continue;
        const totCy = rows.reduce((s, l) => s + (l.cy as number), 0);
        const totPy = rows.reduce((s, l) => s + (l.py as number), 0);

        const sheetName = `N${item.noteRef} ${item.name}`.replace(/[\\/?*[\]:]/g, "").slice(0, 31);
        const ns = wb.addWorksheet(sheetName);
        ns.columns = [
          { width: 2 }, { width: 38 }, { width: 24 },
          { width: 18 }, { width: 18 }, { width: 16 }, { width: 10 },
        ];
        ns.getCell("B2").value = clientName; ns.getCell("B2").font = { bold: true, size: 12 };
        ns.mergeCells("B2:G2"); ns.getCell("B2").alignment = { horizontal: "center" };
        ns.getCell("B3").value = `Note ${item.noteRef} — ${item.name}`;
        ns.getCell("B3").font = { bold: true };
        ns.mergeCells("B3:G3"); ns.getCell("B3").alignment = { horizontal: "center" };
        ns.getCell("B4").value = `(Amount in Rs.)  FY ${fy}`;
        ns.getCell("B4").font = { italic: true, size: 9 };
        ns.mergeCells("B4:G4"); ns.getCell("B4").alignment = { horizontal: "right" };
        const hdr = ns.getRow(6);
        hdr.values = [null, "Ledger", "Group", `CY ${cyYear} (Rs.)`, `PY ${pyYear} (Rs.)`, "Variance (Rs.)", "Status"];
        hdr.font = { bold: true }; hdr.alignment = { horizontal: "center", vertical: "middle" };
        hdr.eachCell((c, n) => { if (n >= 2) c.border = fullBorder; });
        let nr = 7;
        for (const l of rows) {
          ns.getCell(`B${nr}`).value = l.ledger; ns.getCell(`C${nr}`).value = l.group;
          ns.getCell(`D${nr}`).value = l.cy;     ns.getCell(`E${nr}`).value = l.py;
          ns.getCell(`F${nr}`).value = l.variance; ns.getCell(`G${nr}`).value = l.status;
          ns.getCell(`D${nr}`).numFmt = MONEY_FMT;
          ns.getCell(`E${nr}`).numFmt = MONEY_FMT;
          ns.getCell(`F${nr}`).numFmt = MONEY_FMT;
          nr++;
        }
        ns.getCell(`B${nr}`).value = "TOTAL";
        ns.getCell(`D${nr}`).value = fmt(totCy); ns.getCell(`E${nr}`).value = fmt(totPy);
        ns.getCell(`F${nr}`).value = fmt(totCy - totPy);
        ns.getCell(`D${nr}`).numFmt = MONEY_FMT;
        ns.getCell(`E${nr}`).numFmt = MONEY_FMT;
        ns.getCell(`F${nr}`).numFmt = MONEY_FMT;
        for (const a of ["B","C","D","E","F","G"]) {
          ns.getCell(`${a}${nr}`).font = { bold: true };
          ns.getCell(`${a}${nr}`).border = { top: thin, bottom: thin };
        }
      }

      // PY Reconciliation
      const rec = wb.addWorksheet("PY Reconciliation");
      rec.columns = [
        { header: "Code",      key: "c",  width: 16 },
        { header: "Line Item", key: "li", width: 42 },
        { header: "PY (from CY Opening) (Rs.)", key: "o", width: 22 },
        { header: "PY (from Prior Audited) (Rs.)", key: "a", width: 22 },
        { header: "Difference (Rs.)", key: "d", width: 18 },
        { header: "Tallied",    key: "t", width: 10 },
      ];
      rec.getRow(1).font = { bold: true };
      for (const i of bsItems.filter(x => !x.children || x.children.length === 0)) {
        const fromOpening = computedAmountsPY[i.code] || 0;
        const fromAudited = pyAmounts[i.code] || 0;
        const r = rec.addRow({
          c:  i.code, li: i.name,
          o:  fmt(fromOpening), a: fmt(fromAudited),
          d:  fmt(fromOpening - fromAudited),
          t:  Math.abs(fromOpening - fromAudited) < 1 ? "✓" : "✗",
        });
        r.getCell("o").numFmt = MONEY_FMT;
        r.getCell("a").numFmt = MONEY_FMT;
        r.getCell("d").numFmt = MONEY_FMT;
      }
    } // end corporate notes

    // ───────────────────────── WRITE FILE ─────────────────────────
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const safeClient = String(clientName).replace(/[^a-z0-9]+/gi, "_").slice(0, 30);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FS_${safeClient}_${fy || "FY"}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Financial Statements exported (template-shaped)");
  };

  // ─── Complete Stage 10 ───
  const handleComplete = async () => {
    await saveFS();
    const newStatuses = { ...(engagement.stage_statuses || {}), "10": "complete" };
    await supabase.from("audit_engagements").update({
      stage_statuses: newStatuses,
    } as any).eq("id", engagementId);
    toast.success("Financial Statements stage completed");
    onStageComplete();
  };

  // ─── Guards ───
  if (!engagement) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasTbData = (tallyTb?.length ?? 0) > 0;
  const stage3Complete =
    (engagement?.stage_statuses as any)?.["3"] === "complete" ||
    (engagement?.pipeline_stage ?? 0) >= 4;

  if (!tallyTbLoading && !hasTbData && !stage3Complete) {
    return (
      <div className="max-w-4xl">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Tally Sync Required</AlertTitle>
          <AlertDescription>
            No Tally sync data found. Please complete Stage 2 (Tally Sync) and Stage 3 (COA Mapping) before viewing Financial Statements.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isLoading = tallyTbLoading || fsLoading;

  // ─── FS row renderer ───
  const renderFSRows = (items: (FSLineItem & { depth: number })[]) =>
    items.map(item => {
      const isHeader = !!(item.children && item.children.length > 0);
      const amount = computedAmounts[item.code] || 0;
      const py = mergedPY[item.code] || 0;
      const hasOverride    = !!manualOverrides[item.code];
      const hasPyOverride  = pyManualAmounts[item.code] !== undefined;
      const pyMeta         = pyManualMeta[item.code];

      return (
        <TableRow
          key={item.code}
          className={cn(
            isHeader && "bg-muted/40 font-semibold",
            !isHeader && "hover:bg-muted/20",
          )}
        >
          {/* Particulars */}
          <TableCell
            className="text-xs"
            style={{ paddingLeft: `${item.depth * 20 + 8}px` }}
          >
            <span className={cn(isHeader && "uppercase text-[11px] tracking-wide")}>{item.name}</span>
            {item.noteRef && !isHeader && (
              <Badge variant="outline" className="ml-1.5 text-[8px] px-1">N{item.noteRef}</Badge>
            )}
            {hasOverride && (
              <Badge className="ml-1.5 text-[8px] px-1 bg-amber-100 text-amber-700 border-amber-200">M</Badge>
            )}
          </TableCell>

          {/* CY amount + pencil */}
          <TableCell className="text-right text-xs font-mono tabular-nums">
            <div className="flex items-center justify-end gap-1">
              {amount !== 0 ? (
                <span className={amount < 0 ? "text-destructive" : ""}>
                  {amount < 0 ? "(" : ""}₹{Math.abs(amount).toLocaleString("en-IN")}{amount < 0 ? ")" : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              {!isHeader && (
                <button
                  className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-0.5 rounded hover:bg-muted ml-1"
                  title="Override CY amount"
                  onClick={() => openOverride(item.code, item.name)}
                >
                  <Pencil size={9} className="text-muted-foreground" />
                </button>
              )}
            </div>
          </TableCell>

          {/* PY amount + amber badge + pencil */}
          <TableCell className="text-right text-xs font-mono tabular-nums text-muted-foreground">
            <div className="flex items-center justify-end gap-1">
              {hasPyOverride && (
                <span
                  title={pyMeta ? `Manually overridden by ${pyMeta.by} on ${new Date(pyMeta.at).toLocaleDateString("en-IN")}` : "Manually overridden"}
                  className="text-amber-600 cursor-help"
                >⚠</span>
              )}
              {py !== 0 ? (
                <span className={hasPyOverride ? "text-amber-700 dark:text-amber-400" : ""}>
                  {py < 0 ? "(" : ""}₹{Math.abs(py).toLocaleString("en-IN")}{py < 0 ? ")" : ""}
                </span>
              ) : (
                <span>—</span>
              )}
              {!isHeader && !pyLocked && (
                <button
                  className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-0.5 rounded hover:bg-muted ml-1"
                  title={hasPyOverride ? "Edit PY override" : "Override PY amount"}
                  onClick={() => openPyOverride(item.code, item.name)}
                >
                  <Pencil size={9} className={hasPyOverride ? "text-amber-600" : "text-muted-foreground"} />
                </button>
              )}
              {!isHeader && pyLocked && hasPyOverride && (
                <Lock size={9} className="text-muted-foreground ml-1" title="PY finalized — locked" />
              )}
            </div>
          </TableCell>

          {/* CY pencil (legacy action column — kept for clarity) */}
          <TableCell className="w-10 text-center">
            {!isHeader && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => openOverride(item.code, item.name)}
              >
                <Pencil size={11} />
              </Button>
            )}
          </TableCell>
        </TableRow>
      );
    });

  // ─── NCE Signature Block (reused in BS + P&L tabs) ───────────────────────
  // Shown only when isNonCorporate === true. Corporate signature handling is
  // managed elsewhere and must not be changed.
  const nceSignatureBlock = isNonCorporate ? (
    <div className="mt-6 pt-5 border-t grid grid-cols-2 gap-10 text-xs">
      {/* Left — Audit Firm (auto-linked) */}
      <div className="space-y-1 text-muted-foreground">
        <p className="font-semibold text-foreground">
          For, {sigFirmName || <span className="italic text-muted-foreground">[Audit Firm Name]</span>}
        </p>
        <p>Chartered Accountants</p>
        <p>FRN: {sigFirmFRN || <span className="italic">[FRN]</span>}</p>
        <div className="mt-8 space-y-0.5">
          <p className="font-semibold text-foreground">
            {sigPartnerName || <span className="italic text-muted-foreground">[Partner Name]</span>}
          </p>
          <p>Partner</p>
          <p>Membership No. {sigMembershipNo || <span className="italic">[M.No.]</span>}</p>
        </div>
      </div>
      {/* Right — Client / Editable fields */}
      <div className="space-y-2">
        <p className="font-semibold text-foreground">
          For, {sigClientName || <span className="italic text-muted-foreground">[Client Name]</span>}
        </p>
        <Input
          placeholder="Authorised Signatory Name"
          value={sigSignatoryName}
          onChange={e => setSigSignatoryName(e.target.value)}
          className="h-7 text-xs"
        />
        <div className="flex items-center gap-2">
          <Label className="text-xs w-10 shrink-0 text-muted-foreground">Place</Label>
          <Input
            placeholder="City"
            value={sigPlace}
            onChange={e => setSigPlace(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs w-10 shrink-0 text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={sigDate}
            onChange={e => setSigDate(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="max-w-6xl space-y-4">
      <EngagementHeader engagement={engagement} stageNumber={5} stageLabel="Financial Statements" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Stage 5 — Financial Statements</h1>
          <p className="text-xs text-muted-foreground">Generated from mapped trial balance</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-1">
            <Download size={14} /> Export Excel
          </Button>
          <Button variant="outline" size="sm" onClick={saveFS} disabled={saving} className="gap-1">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Save
          </Button>
          <Button size="sm" onClick={handleComplete} disabled={saving} className="gap-1">
            Complete Stage 7 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* ── PY Data Source card ───────────────────────────────────────────
          Shows when no prior engagement FS rows are found. Lets the user pick
          one of four paths: existing engagement, PY shell import, manual
          entry, or skip. Hidden once py_setup_completed is true and a prior
          engagement / annexures / amounts have been recorded. */}
      {noPriorEngagement && !(engagement as any)?.is_py_shell && (
        <Alert className="border-primary/30">
          <FileSpreadsheet className="h-4 w-4" />
          <AlertTitle className="text-xs flex items-center justify-between">
            <span>PY Data Source — FY {pyYear - 1}-{String(pyYear).slice(-2)}</span>
            <div className="flex gap-2">
              {(engagement as any)?.py_source && (
                <Badge variant="outline" className="text-[10px]">
                  Source: {(engagement as any).py_source}
                </Badge>
              )}
              <Button size="sm" variant="default" className="h-7 text-xs"
                onClick={() => setPySourceDialog(true)}>
                Setup PY Data
              </Button>
            </div>
          </AlertTitle>
          <AlertDescription className="text-xs">
            No prior-year engagement found. Choose how PY comparative data should be sourced:
            running Tally opening balances cover the Balance Sheet, but PY P&L needs either a
            prior engagement, a PY shell import, or manual entry.
          </AlertDescription>
        </Alert>
      )}

      {/* ── PY Shell navigation banner ───────────────────────────────────────
          Always visible when py_source === "py_shell". Lets the user go back
          to the PY Shell's Tally Sync at any time — even after leaving it
          the first time — without having to re-trigger the Setup PY Data flow. */}
      {(engagement as any)?.py_source === "py_shell" && !(engagement as any)?.is_py_shell && (
        <Alert className="border-blue-300/50 bg-blue-50/40 dark:bg-blue-950/20">
          <Database className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-xs flex items-center justify-between">
            <span className="text-blue-800 dark:text-blue-300 font-semibold">
              PY Shell — FY {pyYear - 1}-{String(pyYear).slice(-2)}
            </span>
            <div className="flex items-center gap-2">
              {noPriorEngagement
                ? <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-400">⚠ Tally sync pending</Badge>
                : <Badge variant="outline" className="text-[10px] border-green-500 text-green-700 dark:text-green-400">✓ Tally synced</Badge>
              }
              {pyShellId && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs gap-1 border-blue-400 text-blue-700 hover:bg-blue-100 dark:border-blue-600 dark:text-blue-300"
                  onClick={() => navigate(`/audit/pipeline/${pyShellId}?stage=2`)}
                >
                  <ArrowRight className="h-3 w-3" /> Open PY Shell Tally Sync
                </Button>
              )}
            </div>
          </AlertTitle>
          <AlertDescription className="text-xs text-blue-700/80 dark:text-blue-400/80 mt-0.5">
            {noPriorEngagement
              ? "PY Shell created but Tally not yet synced. Click \"Open PY Shell Tally Sync\", run the sync for FY 2024-25, then return here and click \"Fetch from FY-1 Tally\" in the P&L tab."
              : "PY Shell Tally sync is complete. Use \"Fetch from FY-1 Tally\" in the P&L tab to pull PY P&L figures into this engagement."}
          </AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card className={cn(activeBsBalanced ? "border-primary/30" : "border-destructive/30")}>
          <CardContent className="p-3 text-center">
            <p className={cn("text-2xl font-bold", activeBsBalanced ? "text-primary" : "text-destructive")}>
              {activeBsBalanced ? "✓" : `₹${Math.abs(activeBsDiff).toLocaleString("en-IN")}`}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">BS Check</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-foreground">₹{Math.abs(activeTotalAssets).toLocaleString("en-IN")}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Total Assets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className={cn("text-2xl font-bold", activeNetProfit >= 0 ? "text-primary" : "text-destructive")}>
              {activeNetProfit >= 0 ? "+" : ""}₹{Math.abs(activeNetProfit).toLocaleString("en-IN")}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">Net Profit / (Loss)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-amber-600">{Object.keys(manualOverrides).length}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Manual Overrides</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="bs">
          <TabsList>
            <TabsTrigger value="bs" className="gap-1.5">
              <BarChart3 size={14} /> Balance Sheet
            </TabsTrigger>
            <TabsTrigger value="pl" className="gap-1.5">
              <FileSpreadsheet size={14} /> P&L Statement
            </TabsTrigger>
            <TabsTrigger value="recon" className="gap-1.5">
              <AlertTriangle size={14} /> PY Reconciliation
            </TabsTrigger>
            {!isNonCorporate && (
              <TabsTrigger value="cf" className="gap-1.5">
                <Droplets size={14} /> Cash Flow
              </TabsTrigger>
            )}
            {!isNonCorporate && (
              <TabsTrigger value="notes" className="gap-1.5">
                <BookOpen size={14} /> Notes to Accounts
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Balance Sheet ── */}
          <TabsContent value="bs" className="mt-3">
            {/* Phase UI-2: Pixel-perfect on-screen BS for corporate entities.
                Mirrors writeBalanceSheet() in src/lib/fsExcelExport.ts using
                the shared fsDisplayData.bs from UI-1. NCE entities continue
                to render via the legacy renderFSRows() table — untouched. */}
            {!isNonCorporate && fsDisplayData.bs ? (
              <>
                <CorporateBalanceSheetView
                  bs={fsDisplayData.bs}
                  cyYear={cyYear}
                  pyYear={pyYear}
                  companyName={engagement?.clients?.name || "[Company Name]"}
                  pyLocked={pyLocked}
                  onCommitCY={(code, value) => {
                    setManualOverrides(prev => {
                      const next = { ...prev };
                      if (value === null) delete next[code];
                      else next[code] = { amount: value, reason: prev[code]?.reason || "(inline edit)" };
                      return next;
                    });
                  }}
                  onCommitPY={(code, value) => {
                    setPyManualAmounts(prev => {
                      const next = { ...prev };
                      if (value === null) delete next[code];
                      else next[code] = value;
                      return next;
                    });
                    setPyManualDirty(true);
                  }}
                  onEditNote={updateNoteOverride}
                />
                <CorporateSignatureBlock
                  firmName={sigFirmName}
                  firmRegNo={sigFirmFRN}
                  partnerName={sigPartnerName}
                  partnerMemNo={sigMembershipNo}
                  companyName={sigClientName || engagement?.clients?.name || ""}
                  dir1Name={corpSigDirs.dir1Name}
                  dir1Din={corpSigDirs.dir1Din}
                  dir2Name={corpSigDirs.dir2Name}
                  dir2Din={corpSigDirs.dir2Din}
                  onChangeDir={updateCorpSigDir}
                  place={sigPlace}
                  onChangePlace={setSigPlace}
                  date={sigDate}
                  onChangeDate={setSigDate}
                />
              </>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 group">
                      <TableHead className="text-xs">Particulars</TableHead>
                      <TableHead className="text-xs text-right">CY {cyYear} (₹)</TableHead>
                      <TableHead className="text-xs text-right">
                        <span className="flex items-center justify-end gap-1">
                          PY {pyYear} (₹)
                          {pyLocked && (
                            <Badge className="text-[8px] px-1 bg-amber-100 text-amber-700 border-amber-300 gap-0.5 ml-1">
                              <Lock size={7} /> Finalized
                            </Badge>
                          )}
                        </span>
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderFSRows(
                      activeFlatItems.filter(i =>
                        isNonCorporate
                          ? i.section.startsWith("NCE_BS_")
                          : i.section.startsWith("BS_")
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
            {!activeBsBalanced && (
              <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle size={13} />
                Balance Sheet is out of balance by ₹{Math.abs(activeBsDiff).toLocaleString("en-IN")}. Check COA mapping or apply manual overrides.
              </div>
            )}
            {nceSignatureBlock}
          </TabsContent>

          {/* ── P&L Statement ── */}
          <TabsContent value="pl" className="mt-3">
            {/* ── Manual PY P&L entry ──
                Shows when no prior engagement FS rows exist AND the user has
                not opted into py_shell or explicitly skipped (none).
                Corporate entities use the inline-editable PY column on the
                pixel-perfect P&L view instead — hide this alert for them. */}
            {isNonCorporate &&
             noPriorEngagement &&
             (engagement as any)?.py_source !== "py_shell" &&
             (engagement as any)?.py_source !== "none" && (
              <Alert className="mb-3">
                <Pencil className="h-4 w-4" />
                <AlertTitle className="text-xs flex items-center justify-between">
                  <span>Enter PY P&L Amounts ({pyYear})</span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400"
                      disabled={fetchingPyTally || pyLocked}
                      onClick={fetchPyPLFromTally}
                      title="Auto-populate PY P&L from the FY-1 Tally sync"
                    >
                      {fetchingPyTally
                        ? <><Loader2 className="h-3 w-3 animate-spin" />Fetching…</>
                        : <><Database className="h-3 w-3" />Fetch from FY-1 Tally</>}
                    </Button>
                    <Button
                      size="sm"
                      variant={pyManualDirty ? "default" : "outline"}
                      disabled={pyManualSaving || !pyManualDirty}
                      onClick={savePyManual}
                      className="h-7 text-xs"
                    >
                      {pyManualSaving ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving…</>
                      ) : pyManualDirty ? "Save PY P&L" : "Saved"}
                    </Button>
                  </div>
                </AlertTitle>
                <AlertDescription className="text-xs">
                  No prior-year engagement found. Enter last year's P&L figures below — they feed the PY column and flow into next year automatically.
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 max-h-80 overflow-y-auto pr-2">
                    {activeFlatItems
                      .filter(i => {
                        const sec = String(i.section || "").toLowerCase();
                        const isPL = sec.includes("pl") || sec.includes("revenue") || sec.includes("expense");
                        const isLeaf = !i.children || i.children.length === 0;
                        return isPL && isLeaf;
                      })
                      .map(i => (
                        <div key={i.code} className="flex items-center gap-2 py-0.5">
                          <Label className="text-[11px] flex-1 truncate" title={i.name}>{i.name}</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            value={pyManualAmounts[i.code] ?? ""}
                            placeholder="0"
                            onChange={(e) => {
                              const v = e.target.value;
                              setPyManualAmounts(prev => {
                                const next = { ...prev };
                                if (v === "" || v === "-") {
                                  delete next[i.code];
                                } else {
                                  const n = Number(v);
                                  if (Number.isFinite(n)) next[i.code] = n;
                                }
                                return next;
                              });
                              setPyManualDirty(true);
                            }}
                            className="h-7 w-32 text-xs text-right font-mono tabular-nums"
                          />
                        </div>
                      ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* ── Manual PY Annexures (ledger-level breakdown per FS code) ──
                Shown alongside manual P&L entry. Allows PY line items that
                don't exist in CY — each FS code can carry its own ledger list.
                Corporate entities edit PY values directly on the pixel-perfect
                P&L statement — hide this alert for them. */}
            {isNonCorporate &&
             noPriorEngagement &&
             (engagement as any)?.py_source !== "py_shell" &&
             (engagement as any)?.py_source !== "none" && (
              <Alert className="mb-3">
                <BarChart3 className="h-4 w-4" />
                <AlertTitle className="text-xs flex items-center justify-between">
                  <span>PY Annexures — Ledger Detail ({pyYear})</span>
                  <Button
                    size="sm"
                    variant={pyAnnexuresDirty ? "default" : "outline"}
                    disabled={pyAnnexuresSaving || !pyAnnexuresDirty}
                    onClick={savePyAnnexures}
                    className="h-7 text-xs"
                  >
                    {pyAnnexuresSaving ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving…</>
                    ) : pyAnnexuresDirty ? "Save Annexures" : "Saved"}
                  </Button>
                </AlertTitle>
                <AlertDescription className="text-xs">
                  Enter ledger-level breakdown behind each PY P&L note. These rows appear in the
                  PY column of note-wise annexures and the Excel export. PY may contain ledgers
                  that don't exist in CY — add them freely.
                  <div className="mt-3 space-y-3 max-h-[420px] overflow-y-auto pr-2">
                    {activeFlatItems
                      .filter(i => {
                        const sec = String(i.section || "").toLowerCase();
                        const isPL = sec.includes("pl") || sec.includes("revenue") || sec.includes("expense");
                        const isLeaf = !i.children || i.children.length === 0;
                        const hasNote = !!i.noteRef;
                        return isPL && isLeaf && hasNote;
                      })
                      .map(i => {
                        const rows = pyAnnexures[i.code] || [];
                        const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
                        const booked = pyManualAmounts[i.code] ?? (pyAmounts[i.code] || 0);
                        const delta = Math.round((total - booked) * 100) / 100;
                        return (
                          <div key={i.code} className="rounded-md border p-2 bg-background/50">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold truncate" title={i.name}>
                                  {i.noteRef ? `N${i.noteRef} · ` : ""}{i.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  Booked PY: ₹{booked.toLocaleString("en-IN")}
                                  {rows.length > 0 && (
                                    <> · Annexure Total: ₹{total.toLocaleString("en-IN")}
                                       {Math.abs(delta) >= 1 && (
                                         <span className="text-destructive"> · Δ ₹{Math.abs(delta).toLocaleString("en-IN")}</span>
                                       )}
                                    </>
                                  )}
                                </p>
                              </div>
                              <Button
                                size="sm" variant="outline" className="h-6 text-[10px] shrink-0"
                                onClick={() => {
                                  setPyAnnexures(prev => ({
                                    ...prev,
                                    [i.code]: [...(prev[i.code] || []), { ledger_name: "", amount: 0 }],
                                  }));
                                  setPyAnnexuresDirty(true);
                                }}
                              >+ Add Ledger</Button>
                            </div>
                            {rows.length > 0 && (
                              <div className="space-y-1">
                                {rows.map((r, idx) => (
                                  <div key={idx} className="flex items-center gap-1">
                                    <Input
                                      placeholder="Ledger name"
                                      value={r.ledger_name}
                                      onChange={e => {
                                        const v = e.target.value;
                                        setPyAnnexures(prev => {
                                          const next = { ...prev };
                                          next[i.code] = [...(next[i.code] || [])];
                                          next[i.code][idx] = { ...next[i.code][idx], ledger_name: v };
                                          return next;
                                        });
                                        setPyAnnexuresDirty(true);
                                      }}
                                      className="h-7 text-xs flex-1"
                                    />
                                    <Input
                                      placeholder="Group (opt.)"
                                      value={r.group || ""}
                                      onChange={e => {
                                        const v = e.target.value;
                                        setPyAnnexures(prev => {
                                          const next = { ...prev };
                                          next[i.code] = [...(next[i.code] || [])];
                                          next[i.code][idx] = { ...next[i.code][idx], group: v };
                                          return next;
                                        });
                                        setPyAnnexuresDirty(true);
                                      }}
                                      className="h-7 text-xs w-28"
                                    />
                                    <Input
                                      type="number"
                                      inputMode="decimal"
                                      placeholder="Amount"
                                      value={r.amount === 0 ? "" : r.amount}
                                      onChange={e => {
                                        const v = e.target.value;
                                        const n = v === "" || v === "-" ? 0 : Number(v);
                                        setPyAnnexures(prev => {
                                          const next = { ...prev };
                                          next[i.code] = [...(next[i.code] || [])];
                                          next[i.code][idx] = { ...next[i.code][idx], amount: Number.isFinite(n) ? n : 0 };
                                          return next;
                                        });
                                        setPyAnnexuresDirty(true);
                                      }}
                                      className="h-7 text-xs w-28 text-right font-mono tabular-nums"
                                    />
                                    <Button
                                      size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                                      onClick={() => {
                                        setPyAnnexures(prev => {
                                          const next = { ...prev };
                                          next[i.code] = (next[i.code] || []).filter((_, k) => k !== idx);
                                          if (next[i.code].length === 0) delete next[i.code];
                                          return next;
                                        });
                                        setPyAnnexuresDirty(true);
                                      }}
                                    >×</Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Phase UI-3: Pixel-perfect on-screen P&L for corporate entities.
                Mirrors writeProfitAndLoss() in src/lib/fsExcelExport.ts row-by-row
                using fsDisplayData.pl from UI-1. NCE entities continue to render
                via the legacy renderFSRows() table — untouched. */}
            {!isNonCorporate && fsDisplayData.pl ? (
              <>
                <CorporatePLView
                  pl={fsDisplayData.pl}
                  cyYear={cyYear}
                  pyYear={pyYear}
                  companyName={engagement?.clients?.name || "[Company Name]"}
                  pyLocked={pyLocked}
                />
                <CorporateSignatureBlock
                  firmName={sigFirmName}
                  firmRegNo={sigFirmFRN}
                  partnerName={sigPartnerName}
                  partnerMemNo={sigMembershipNo}
                  companyName={sigClientName || engagement?.clients?.name || ""}
                  dir1Name={corpSigDirs.dir1Name}
                  dir1Din={corpSigDirs.dir1Din}
                  dir2Name={corpSigDirs.dir2Name}
                  dir2Din={corpSigDirs.dir2Din}
                  onChangeDir={updateCorpSigDir}
                  place={sigPlace}
                  onChangePlace={setSigPlace}
                  date={sigDate}
                  onChangeDate={setSigDate}
                />
              </>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 group">
                      <TableHead className="text-xs">Particulars</TableHead>
                      <TableHead className="text-xs text-right">CY {cyYear} (₹)</TableHead>
                      <TableHead className="text-xs text-right">
                        <span className="flex items-center justify-end gap-1">
                          PY {pyYear} (₹)
                          {pyLocked ? (
                            <Badge className="text-[8px] px-1 bg-amber-100 text-amber-700 border-amber-300 gap-0.5 ml-1">
                              <Lock size={7} /> Finalized
                            </Badge>
                          ) : (
                            <span className="text-[9px] text-muted-foreground font-normal ml-1 italic">editable</span>
                          )}
                        </span>
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderFSRows(
                      activeFlatItems.filter(i =>
                        isNonCorporate
                          ? i.section.startsWith("NCE_PL_")
                          : i.section.startsWith("PL_")
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
            {nceSignatureBlock}
          </TabsContent>

          {/* ── PY Reconciliation ── */}
          {/* Tally PY computed from CY opening balances against prior audited FS */}
          <TabsContent value="recon" className="mt-3">
            <Alert className="mb-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-xs">Match PY with Last Year's Audit Report</AlertTitle>
              <AlertDescription className="text-xs">
                Column A: PY derived from opening balances on CY trial balance (via COA mapping).
                Column B: PY from prior engagement's audited fa_financial_statements.
                Differences indicate either a new/changed mapping in CY or a prior-period adjustment.
              </AlertDescription>
            </Alert>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Line Item</TableHead>
                    <TableHead className="text-xs text-right">PY (from Opening) (₹)</TableHead>
                    <TableHead className="text-xs text-right">PY (from Audited FS) (₹)</TableHead>
                    <TableHead className="text-xs text-right">Δ (₹)</TableHead>
                    <TableHead className="text-xs text-center w-16">Tallied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeFlatItems
                    .filter(i => i.section.startsWith(isNonCorporate ? "NCE_BS_" : "BS_"))
                    .filter(i => !i.children || i.children.length === 0)
                    .map(i => {
                      const fromOpening = computedAmountsPY[i.code] || 0;
                      const fromAudited = pyAmounts[i.code]         || 0;
                      const diff  = fromOpening - fromAudited;
                      const match = Math.abs(diff) < 1;
                      if (Math.abs(fromOpening) < 0.005 && Math.abs(fromAudited) < 0.005) return null;
                      return (
                        <TableRow key={i.code} className={cn(!match && "bg-amber-50/60")}>
                          <TableCell className="text-xs" style={{ paddingLeft: `${i.depth * 16 + 8}px` }}>
                            {i.name}
                            {i.noteRef && <Badge variant="outline" className="ml-1.5 text-[8px] px-1">N{i.noteRef}</Badge>}
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono tabular-nums">
                            {fromOpening !== 0 ? `₹${Math.abs(fromOpening).toLocaleString("en-IN")}` : "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono tabular-nums text-muted-foreground">
                            {fromAudited !== 0 ? `₹${Math.abs(fromAudited).toLocaleString("en-IN")}` : "—"}
                          </TableCell>
                          <TableCell className={cn(
                            "text-right text-xs font-mono tabular-nums",
                            match ? "text-muted-foreground" : "text-destructive font-semibold"
                          )}>
                            {Math.abs(diff) < 0.005 ? "—" : `₹${Math.abs(diff).toLocaleString("en-IN")}`}
                          </TableCell>
                          <TableCell className="text-center">
                            {match ? (
                              <span className="text-primary text-sm">✓</span>
                            ) : (
                              <span className="text-destructive text-sm">✗</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ── Cash Flow (corporate only) ── */}
          {/* Phase UI-4: Pixel-perfect on-screen Cash Flow Statement using
              fsDisplayData.bs / .pl / .cfs from UI-1. Mirrors writeCashFlow()
              in src/lib/fsExcelExport.ts (AS-3 Indirect Method). */}
          {!isNonCorporate && (
            <TabsContent value="cf" className="mt-3">
              {fsDisplayData.bs && fsDisplayData.pl && fsDisplayData.cfs ? (
                <>
                  <CorporateCFView
                    bs={fsDisplayData.bs}
                    pl={fsDisplayData.pl}
                    cfs={fsDisplayData.cfs}
                    cyYear={cyYear}
                    pyYear={pyYear}
                    companyName={engagement?.clients?.name || "[Company Name]"}
                    overrides={cfsOverrides}
                    onCommit={updateCfsOverride}
                  />
                  <CorporateSignatureBlock
                    firmName={sigFirmName}
                    firmRegNo={sigFirmFRN}
                    partnerName={sigPartnerName}
                    partnerMemNo={sigMembershipNo}
                    companyName={sigClientName || engagement?.clients?.name || ""}
                    dir1Name={corpSigDirs.dir1Name}
                    dir1Din={corpSigDirs.dir1Din}
                    dir2Name={corpSigDirs.dir2Name}
                    dir2Din={corpSigDirs.dir2Din}
                    onChangeDir={updateCorpSigDir}
                    place={sigPlace}
                    onChangePlace={setSigPlace}
                    date={sigDate}
                    onChangeDate={setSigDate}
                  />
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3 border rounded-lg bg-muted/20">
                  <Droplets size={32} className="text-muted-foreground/40" />
                  <p className="text-sm font-medium text-muted-foreground">Cash Flow Statement</p>
                  <p className="text-xs text-muted-foreground">
                    Trial balance not loaded yet — import a TB and map the Chart of
                    Accounts to see the Cash Flow Statement here.
                  </p>
                </div>
              )}
            </TabsContent>
          )}

          {/* ── Notes to Accounts (corporate only) — Phase 8 / UI-6 ── */}
          {!isNonCorporate && (
            <TabsContent value="notes" className="mt-3 space-y-5">
              {/* ── Header strip ── */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Notes to Financial Statements</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Schedule III — Division I · AS-10 PPE movement schedule and note-wise breakdowns
                  </p>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={!notesDirty || notesSaving}
                  onClick={() => saveStage5Notes(stage5Notes)}
                >
                  {notesSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {notesSaving ? "Saving…" : notesDirty ? "Save Notes" : "Saved"}
                </Button>
              </div>

              {/* ── PPE / Fixed Assets Movement Schedule ── */}
              <div className="rounded-lg border overflow-hidden">
                <div className="bg-muted/40 px-4 py-2 flex items-center justify-between border-b">
                  <div>
                    <p className="text-xs font-semibold">Note 13: Property, Plant & Equipment (AS-10)</p>
                    <p className="text-[10px] text-muted-foreground">Gross block, depreciation, and net block for the year ended 31st March, {cyYear}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addFARow}>
                    <Plus className="h-3 w-3" /> Add Row
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/20 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold w-[18%]">Particulars</th>
                        <th className="text-center px-2 py-2 font-semibold w-[7%]">Useful Life (Yrs)</th>
                        <th className="text-right px-2 py-2 font-semibold">Gross Opening</th>
                        <th className="text-right px-2 py-2 font-semibold">Additions</th>
                        <th className="text-right px-2 py-2 font-semibold">Disposals</th>
                        <th className="text-right px-2 py-2 font-semibold bg-blue-50/50 dark:bg-blue-950/10">Gross Closing</th>
                        <th className="text-right px-2 py-2 font-semibold">Depn. Opening</th>
                        <th className="text-right px-2 py-2 font-semibold">Depn. for Year</th>
                        <th className="text-right px-2 py-2 font-semibold">Depn. on Disposal</th>
                        <th className="text-right px-2 py-2 font-semibold bg-green-50/50 dark:bg-green-950/10">Net Block CY</th>
                        <th className="text-right px-2 py-2 font-semibold bg-amber-50/50 dark:bg-amber-950/10">Net Block PY</th>
                        <th className="px-2 py-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {stage5Notes.fa.rows.map((row) => {
                        const grossClose  = row.gross_open + row.additions - row.disposals;
                        const depnClose   = row.depn_open + row.depn_add - row.depn_disp;
                        const netBlockCY  = grossClose - depnClose;
                        const netBlockPY  = row.gross_open - row.depn_open;
                        return (
                          <tr key={row.id} className="border-t hover:bg-muted/20 group">
                            {/* Particulars */}
                            <td className="px-3 py-1">
                              <input
                                className="w-full bg-transparent border-b border-dashed border-muted-foreground/30 focus:border-primary focus:outline-none text-[11px]"
                                value={row.particulars}
                                onChange={e => updateFARow(row.id, "particulars", e.target.value)}
                              />
                            </td>
                            {/* Useful Life */}
                            <td className="px-2 py-1 text-center">
                              <input
                                className="w-full bg-transparent border-b border-dashed border-muted-foreground/30 focus:border-primary focus:outline-none text-[11px] text-center"
                                value={row.useful_life}
                                onChange={e => updateFARow(row.id, "useful_life", e.target.value)}
                              />
                            </td>
                            {/* Numeric cells */}
                            {(["gross_open","additions","disposals"] as const).map(f => (
                              <td key={f} className="px-2 py-1 text-right">
                                <input
                                  type="number"
                                  className="w-20 bg-transparent border-b border-dashed border-muted-foreground/30 focus:border-primary focus:outline-none text-[11px] text-right tabular-nums"
                                  value={row[f] || ""}
                                  onChange={e => updateFARow(row.id, f, parseFloat(e.target.value) || 0)}
                                />
                              </td>
                            ))}
                            {/* Gross Closing (computed) */}
                            <td className="px-2 py-1 text-right font-mono tabular-nums bg-blue-50/50 dark:bg-blue-950/10 font-medium">
                              {grossClose.toLocaleString("en-IN")}
                            </td>
                            {/* Depn cells */}
                            {(["depn_open","depn_add","depn_disp"] as const).map(f => (
                              <td key={f} className="px-2 py-1 text-right">
                                <input
                                  type="number"
                                  className="w-20 bg-transparent border-b border-dashed border-muted-foreground/30 focus:border-primary focus:outline-none text-[11px] text-right tabular-nums"
                                  value={row[f] || ""}
                                  onChange={e => updateFARow(row.id, f, parseFloat(e.target.value) || 0)}
                                />
                              </td>
                            ))}
                            {/* Net Block CY */}
                            <td className="px-2 py-1 text-right font-mono tabular-nums bg-green-50/50 dark:bg-green-950/10 font-semibold text-green-800 dark:text-green-300">
                              {netBlockCY.toLocaleString("en-IN")}
                            </td>
                            {/* Net Block PY */}
                            <td className="px-2 py-1 text-right font-mono tabular-nums bg-amber-50/50 dark:bg-amber-950/10 font-medium text-amber-700 dark:text-amber-300">
                              {netBlockPY.toLocaleString("en-IN")}
                            </td>
                            {/* Delete */}
                            <td className="px-2 py-1">
                              <button
                                className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
                                onClick={() => removeFARow(row.id)}
                                title="Remove row"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Totals row */}
                      {stage5Notes.fa.rows.length > 0 && (() => {
                        const totGrossOpen  = stage5Notes.fa.rows.reduce((s, r) => s + r.gross_open, 0);
                        const totAdds       = stage5Notes.fa.rows.reduce((s, r) => s + r.additions, 0);
                        const totDisp       = stage5Notes.fa.rows.reduce((s, r) => s + r.disposals, 0);
                        const totGrossClose = totGrossOpen + totAdds - totDisp;
                        const totDepnOpen   = stage5Notes.fa.rows.reduce((s, r) => s + r.depn_open, 0);
                        const totDepnAdd    = stage5Notes.fa.rows.reduce((s, r) => s + r.depn_add, 0);
                        const totDepnDisp   = stage5Notes.fa.rows.reduce((s, r) => s + r.depn_disp, 0);
                        const totDepnClose  = totDepnOpen + totDepnAdd - totDepnDisp;
                        const totNetCY      = totGrossClose - totDepnClose;
                        const totNetPY      = totGrossOpen  - totDepnOpen;
                        return (
                          <tr className="border-t-2 border-foreground/30 bg-muted/30 font-semibold">
                            <td className="px-3 py-1.5 text-xs font-bold" colSpan={2}>TOTAL</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs">{totGrossOpen.toLocaleString("en-IN")}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs">{totAdds.toLocaleString("en-IN")}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs">{totDisp.toLocaleString("en-IN")}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs bg-blue-50/80 dark:bg-blue-950/20">{totGrossClose.toLocaleString("en-IN")}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs">{totDepnOpen.toLocaleString("en-IN")}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs">{totDepnAdd.toLocaleString("en-IN")}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs">{totDepnDisp.toLocaleString("en-IN")}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs bg-green-50/80 dark:bg-green-950/20 text-green-800 dark:text-green-300">{totNetCY.toLocaleString("en-IN")}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs bg-amber-50/80 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300">{totNetPY.toLocaleString("en-IN")}</td>
                            <td />
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 bg-muted/10 border-t text-[10px] text-muted-foreground">
                  Gross Closing = Opening + Additions − Disposals · Net Block = Gross Closing − Depn. Closing · Click any dashed cell to edit · Save when done.
                </div>
              </div>

              {/* ── Auto-derived Note Totals from COA Mapping ── */}
              {fsDisplayData.bs && (
                <div className="rounded-lg border overflow-hidden">
                  <div className="bg-muted/40 px-4 py-2 border-b">
                    <p className="text-xs font-semibold">Auto-Derived Note Totals (from COA Mapping)</p>
                    <p className="text-[10px] text-muted-foreground">Computed from trial balance and COA mapping. Updates automatically as you adjust mappings.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-0 divide-x">
                    {/* Balance Sheet Notes */}
                    <div>
                      <div className="px-4 py-1.5 bg-blue-50/40 dark:bg-blue-950/10 border-b">
                        <p className="text-[11px] font-semibold text-blue-800 dark:text-blue-300">Balance Sheet Notes</p>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead className="bg-muted/20 border-b">
                          <tr>
                            <th className="text-left px-3 py-1.5 font-medium">Note / Line Item</th>
                            <th className="text-right px-3 py-1.5 font-medium">CY ₹</th>
                            <th className="text-right px-3 py-1.5 font-medium">PY ₹</th>
                          </tr>
                        </thead>
                        <tbody>
                          {([
                            { note: "Note 3",  label: "Share Capital",             key: "shareCap" },
                            { note: "Note 4",  label: "Reserves & Surplus",        key: "reserves" },
                            { note: "Note 5",  label: "Long-term Borrowings",      key: "ltBorrowings" },
                            { note: "Note 7",  label: "Other Long-term Liab.",     key: "otherLtLiab" },
                            { note: "Note 8",  label: "Long-term Provisions",      key: "ltProvisions" },
                            { note: "Note 9",  label: "Short-term Borrowings",     key: "stBorrowings" },
                            { note: "Note 10", label: "Trade Payables",            key: "tradePayOthers" },
                            { note: "Note 11", label: "Other Current Liab.",       key: "otherCurrLiab" },
                            { note: "Note 12", label: "Short-term Provisions",     key: "stProvisions" },
                            { note: "Note 13", label: "Fixed Assets (Net)",        key: "ppe" },
                            { note: "Note 15", label: "Non-current Investments",   key: "ncInvestments" },
                            { note: "Note 17", label: "Long-term Loans & Adv.",    key: "ltLoans" },
                            { note: "Note 18", label: "Other Non-current Assets",  key: "otherNcAssets" },
                            { note: "Note 19", label: "Current Investments",       key: "currInvestments" },
                            { note: "Note 20", label: "Inventories",               key: "inventories" },
                            { note: "Note 21", label: "Trade Receivables",         key: "tradeRec" },
                            { note: "Note 22", label: "Cash & Bank Balances",      key: "cashBank" },
                            { note: "Note 23", label: "Short-term Loans & Adv.",   key: "stLoans" },
                            { note: "Note 24", label: "Other Current Assets",      key: "otherCurrAssets" },
                          ] as { note: string; label: string; key: keyof BSRowData }[]).map(({ note, label, key }) => {
                            const item = (fsDisplayData.bs as BSRowData)[key] as any;
                            if (!item || (!item.cy && !item.py)) return null;
                            return (
                              <tr key={key} className="border-t hover:bg-muted/20">
                                <td className="px-3 py-1">
                                  <span className="text-muted-foreground text-[10px] mr-1">{note}</span>
                                  {label}
                                </td>
                                <td className="px-3 py-1 text-right font-mono tabular-nums">{Math.abs(item.cy ?? 0).toLocaleString("en-IN")}</td>
                                <td className="px-3 py-1 text-right font-mono tabular-nums text-muted-foreground">{Math.abs(item.py ?? 0).toLocaleString("en-IN")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* P&L Notes */}
                    <div>
                      <div className="px-4 py-1.5 bg-emerald-50/40 dark:bg-emerald-950/10 border-b">
                        <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">P&L Notes</p>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead className="bg-muted/20 border-b">
                          <tr>
                            <th className="text-left px-3 py-1.5 font-medium">Note / Line Item</th>
                            <th className="text-right px-3 py-1.5 font-medium">CY ₹</th>
                            <th className="text-right px-3 py-1.5 font-medium">PY ₹</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fsDisplayData.pl && ([
                            { note: "Note 25", label: "Revenue from Operations",  key: "revFromOps" },
                            { note: "Note 26", label: "Other Income",             key: "otherIncome" },
                            { note: "Note 28", label: "Employee Benefits Exp.",   key: "employeeBenefits" },
                            { note: "Note 29", label: "Finance Costs",            key: "financeCosts" },
                            { note: "Note 30", label: "Depreciation & Amort.",    key: "depreciation" },
                            { note: "Note 31", label: "Other Expenses",           key: "otherExpenses" },
                          ] as { note: string; label: string; key: string }[]).map(({ note, label, key }) => {
                            const item = (fsDisplayData.pl as any)[key];
                            if (!item || (!item.cy && !item.py)) return null;
                            return (
                              <tr key={key} className="border-t hover:bg-muted/20">
                                <td className="px-3 py-1">
                                  <span className="text-muted-foreground text-[10px] mr-1">{note}</span>
                                  {label}
                                </td>
                                <td className="px-3 py-1 text-right font-mono tabular-nums">{Math.abs(item.cy ?? 0).toLocaleString("en-IN")}</td>
                                <td className="px-3 py-1 text-right font-mono tabular-nums text-muted-foreground">{Math.abs(item.py ?? 0).toLocaleString("en-IN")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Manual Override Dialog */}
      <Dialog open={!!overrideDialog} onOpenChange={() => setOverrideDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Manual Override — {overrideDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Amount (₹)</Label>
              <Input
                type="number"
                value={overrideAmount}
                onChange={e => setOverrideAmount(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Reason (mandatory) *</Label>
              <Textarea
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="Why is this being manually overridden?"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            {manualOverrides[overrideDialog?.code || ""] && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const code = overrideDialog!.code;
                  setManualOverrides(prev => {
                    const next = { ...prev };
                    delete next[code];
                    return next;
                  });
                  setOverrideDialog(null);
                  toast.success("Override removed — reverting to TB value");
                }}
              >
                Remove Override
              </Button>
            )}
            <Button
              size="sm"
              disabled={!overrideReason.trim()}
              onClick={() => {
                const code = overrideDialog!.code;
                setManualOverrides(prev => ({
                  ...prev,
                  [code]: { amount: parseFloat(overrideAmount) || 0, reason: overrideReason },
                }));
                setOverrideDialog(null);
                toast.success("Manual override applied");
              }}
            >
              Apply Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PY Override Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!pyOverrideDialog} onOpenChange={() => { setPyOverrideDialog(null); setPyOverrideAmount(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <span className="text-amber-600">⚠</span> PY Override — {pyOverrideDialog?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {pyOverrideDialog && pyManualMeta[pyOverrideDialog.code] && (
              <div className="rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                Last overridden by <strong>{pyManualMeta[pyOverrideDialog.code].by}</strong>{" "}
                on {new Date(pyManualMeta[pyOverrideDialog.code].at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </div>
            )}
            {pyOverrideDialog && !noPriorEngagement && (
              <div className="text-[11px] text-muted-foreground">
                Auto PY (from prior engagement): <span className="font-mono font-semibold text-foreground">
                  ₹{Math.abs(mergedPY[pyOverrideDialog.code] || 0).toLocaleString("en-IN")}
                </span>
              </div>
            )}
            <div>
              <Label className="text-xs">Override Amount (₹) — leave blank to clear</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={pyOverrideAmount}
                onChange={e => setPyOverrideAmount(e.target.value)}
                placeholder="Enter PY amount (negative = Cr)"
                className="mt-1"
                autoFocus
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Your name ({user?.name || user?.email || "current user"}) and timestamp will be recorded automatically.
            </p>
          </div>
          <DialogFooter className="gap-2">
            {pyOverrideDialog && pyManualAmounts[pyOverrideDialog.code] !== undefined && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPyOverrideAmount("");
                  savePyOverride();
                }}
              >
                Clear Override
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => { setPyOverrideDialog(null); setPyOverrideAmount(""); }}>
              Cancel
            </Button>
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" onClick={savePyOverride}>
              Save PY Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Fetch PY P&L from Tally — confirmation dialog ─────────────── */}
      <Dialog open={fetchPyTallyDialog} onOpenChange={(o) => { if (!o) { setFetchPyTallyDialog(false); setFetchPyTallyPreview(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-600" />
              Populate PY P&amp;L from FY-1 Tally
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <p className="text-muted-foreground">
              The following <strong>{Object.keys(fetchPyTallyPreview || {}).length}</strong> P&amp;L line items were matched from the FY-1 Tally trial balance using your current COA mapping. Applying will overwrite any existing manual amounts for these codes.
            </p>
            {fetchPyTallyPreview && Object.keys(fetchPyTallyPreview).length > 0 && (
              <div className="rounded-md border overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">FS Line Item</th>
                      <th className="text-right px-2 py-1.5 font-medium">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(fetchPyTallyPreview).map(([code, amt]) => {
                      const item = activeFlatItems.find(i => i.code === code);
                      return (
                        <tr key={code} className="border-t hover:bg-muted/30">
                          <td className="px-2 py-1">{item?.name || code}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {Number(amt).toLocaleString("en-IN")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-start gap-1.5 p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <p>Existing manually-entered PY amounts for these codes will be replaced. This cannot be undone automatically — note the current values first if needed.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => { setFetchPyTallyDialog(false); setFetchPyTallyPreview(null); }}>
              Cancel
            </Button>
            <Button size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={applyPyTallyFetch}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Apply {Object.keys(fetchPyTallyPreview || {}).length} Items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PY Data Source dialog ──────────────────────────────────────── */}
      <Dialog open={pySourceDialog} onOpenChange={setPySourceDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Setup PY Comparative Data</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-xs">
            <p className="text-muted-foreground">
              No prior-year engagement was found for this client. Choose how PY data should be sourced:
            </p>

            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">Option A — Create PY Shell Engagement</p>
                  <p className="text-[11px] text-muted-foreground">
                    Creates a cut-down FY {String(pyYear - 1)}-{String(pyYear).slice(-2)} engagement. Import PY trial balance, map COA, and freeze PY FS there — Stage 10 here picks it up automatically.
                  </p>
                </div>
                <Button size="sm" disabled={creatingPyShell} onClick={createPyShellEngagement} className="shrink-0">
                  {creatingPyShell ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create Shell"}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">Option B — Enter PY Data Manually</p>
                  <p className="text-[11px] text-muted-foreground">
                    Type PY P&L amounts and note-wise annexures directly. Best for small clients without Tally. Figures auto-flow as next year's PY source.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setPySource("manual")} className="shrink-0">
                  Use Manual
                </Button>
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">Option C — Skip PY Comparative</p>
                  <p className="text-[11px] text-muted-foreground">
                    First-year engagement. PY column stays blank on BS &amp; P&amp;L.
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPySource("none")} className="shrink-0">
                  Skip
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPySourceDialog(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
