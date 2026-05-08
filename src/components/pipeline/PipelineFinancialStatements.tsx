import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FsUnitsProvider, FsUnitsToggle, formatScaledINRWhole } from "@/lib/fsUnits";
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
import NotesTab from "@/components/stage5/NotesTab";
import NCENotesTab from "@/components/stage7/NCENotesTab";
import { RatiosTab } from "@/components/stage7/RatiosTab";
import { NotesMismatchPanel } from "@/components/stage7/NotesMismatchPanel";
import {
  ArrowRight, AlertTriangle, Download, FileSpreadsheet,
  Pencil, Loader2, BarChart3, Droplets, Lock, Database, CheckCircle2,
  BookOpen, TrendingUp, RefreshCw,
} from "lucide-react";
import { NCE_FS_ITEMS } from "@/config/nceLineItems";
import type { FSLineItem } from "@/config/nceLineItems";
import { getNoteNo, buildDynamicRegistry } from "@/lib/noteNumberRegistry";
import {
  NOTES_CONFIG,
  NOTE_META,
  computeDisplayData,
  type NoteConfig,
} from "@/config/nceNotesConfig";
import { computeNceDynamicNoteMap } from "@/lib/nceDynamicNoteNumbers";
import { sumNotesSubRowsCY, sumNotesSubRowsPY, getSharesOutstanding, getFAGridNetBlockTotal } from "@/lib/notesAutoPopulate";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";
import { isTallyPLAccount } from "@/lib/tallyDetection";

// ═══════════════════════════════════════
// Schedule III Line Item Definitions
// ═══════════════════════════════════════

const SCHEDULE_III_DIV_I: FSLineItem[] = [
  // ── BALANCE SHEET — EQUITY & LIABILITIES ──
  { code: "BS_EQ", name: "EQUITY AND LIABILITIES", noteRef: null, section: "BS_liabilities", children: [
    { code: "BS_EQ_SC", name: "Share Capital", noteRef: getNoteNo("share_capital") ?? null, section: "BS_liabilities", scheduleRef: "Sch III" },
    { code: "BS_EQ_RS", name: "Reserves and Surplus", noteRef: getNoteNo("reserves_surplus") ?? null, section: "BS_liabilities", scheduleRef: "Sch III" },
    { code: "BS_EQ_MS", name: "Money Received Against Share Warrants", noteRef: null, section: "BS_liabilities" },
  ]},
  { code: "BS_NCL", name: "NON-CURRENT LIABILITIES", noteRef: null, section: "BS_liabilities", children: [
    { code: "BS_NCL_LTB", name: "Long-term Borrowings", noteRef: getNoteNo("lt_borrowings") ?? null, section: "BS_liabilities", scheduleRef: "Sch III" },
    { code: "BS_NCL_DTL", name: "Deferred Tax Liabilities (Net)", noteRef: getNoteNo("deferred_tax_liab") ?? null, section: "BS_liabilities" },
    { code: "BS_NCL_OLT", name: "Other Long-term Liabilities", noteRef: getNoteNo("other_lt_liab") ?? null, section: "BS_liabilities" },
    { code: "BS_NCL_LTP", name: "Long-term Provisions", noteRef: getNoteNo("lt_provisions") ?? null, section: "BS_liabilities" },
  ]},
  { code: "BS_CL", name: "CURRENT LIABILITIES", noteRef: null, section: "BS_liabilities", children: [
    { code: "BS_CL_STB", name: "Short-term Borrowings", noteRef: getNoteNo("st_borrowings") ?? null, section: "BS_liabilities" },
    { code: "BS_CL_TP", name: "Trade Payables", noteRef: getNoteNo("trade_payables") ?? null, section: "BS_liabilities" },
    { code: "BS_CL_OCL", name: "Other Current Liabilities", noteRef: getNoteNo("other_current_liab") ?? null, section: "BS_liabilities" },
    { code: "BS_CL_STP", name: "Short-term Provisions", noteRef: getNoteNo("st_provisions") ?? null, section: "BS_liabilities" },
  ]},
  // ── BALANCE SHEET — ASSETS ──
  { code: "BS_NCA", name: "NON-CURRENT ASSETS", noteRef: null, section: "BS_assets", children: [
    { code: "BS_NCA_FA", name: "Fixed Assets", noteRef: getNoteNo("ppe") ?? null, section: "BS_assets", scheduleRef: "Sch II", children: [
      { code: "BS_NCA_FA_TAN", name: "Tangible Assets", noteRef: getNoteNo("ppe") ?? null, section: "BS_assets" },
      { code: "BS_NCA_FA_INT", name: "Intangible Assets", noteRef: getNoteNo("ppe") ?? null, section: "BS_assets" },
      { code: "BS_NCA_FA_WIP", name: "Capital Work-in-Progress", noteRef: null, section: "BS_assets" },
    ]},
    { code: "BS_NCA_INV", name: "Non-current Investments", noteRef: getNoteNo("nc_investments") ?? null, section: "BS_assets" },
    { code: "BS_NCA_DTA", name: "Deferred Tax Assets (Net)", noteRef: getNoteNo("deferred_tax_assets") ?? null, section: "BS_assets" },
    { code: "BS_NCA_LLA", name: "Long-term Loans and Advances", noteRef: getNoteNo("lt_loans_advances") ?? null, section: "BS_assets" },
    { code: "BS_NCA_ONA", name: "Other Non-current Assets", noteRef: getNoteNo("other_nc_assets") ?? null, section: "BS_assets" },
  ]},
  { code: "BS_CA", name: "CURRENT ASSETS", noteRef: null, section: "BS_assets", children: [
    { code: "BS_CA_CI", name: "Current Investments", noteRef: getNoteNo("current_investments") ?? null, section: "BS_assets" },
    { code: "BS_CA_INV", name: "Inventories", noteRef: getNoteNo("inventories") ?? null, section: "BS_assets", children: [
      { code: "INV_RM",    name: "Raw Materials",             noteRef: getNoteNo("inventories") ?? null, section: "BS_assets" },
      { code: "INV_WIP",   name: "Work-in-Progress",          noteRef: getNoteNo("inventories") ?? null, section: "BS_assets" },
      { code: "INV_FG",    name: "Finished Goods",            noteRef: getNoteNo("inventories") ?? null, section: "BS_assets" },
      { code: "INV_STT",   name: "Stock-in-Trade",            noteRef: getNoteNo("inventories") ?? null, section: "BS_assets" },
      { code: "INV_STOCK", name: "Stock / Other Inventories", noteRef: getNoteNo("inventories") ?? null, section: "BS_assets" },
    ]},
    { code: "BS_CA_TR", name: "Trade Receivables", noteRef: getNoteNo("trade_receivables") ?? null, section: "BS_assets" },
    { code: "BS_CA_CCE", name: "Cash and Cash Equivalents", noteRef: getNoteNo("cash_bank") ?? null, section: "BS_assets" },
    { code: "BS_CA_SLA", name: "Short-term Loans and Advances", noteRef: getNoteNo("st_loans_advances") ?? null, section: "BS_assets" },
    { code: "BS_CA_OCA", name: "Other Current Assets", noteRef: getNoteNo("other_current_assets") ?? null, section: "BS_assets" },
  ]},
  // ── PROFIT & LOSS ──
  { code: "PL_REV", name: "REVENUE", noteRef: null, section: "PL_revenue", children: [
    { code: "PL_REV_OPS", name: "Revenue from Operations", noteRef: getNoteNo("revenue_from_ops") ?? null, section: "PL_revenue" },
    { code: "PL_REV_OI", name: "Other Income", noteRef: getNoteNo("other_income") ?? null, section: "PL_revenue" },
  ]},
  { code: "PL_EXP", name: "EXPENSES", noteRef: null, section: "PL_expenses", children: [
    { code: "PL_EXP_MAT", name: "Cost of Materials Consumed", noteRef: getNoteNo("cost_materials") ?? null, section: "PL_expenses" },
    { code: "PL_EXP_SIT", name: "Purchases of Stock-in-Trade", noteRef: getNoteNo("purchases_stock") ?? null, section: "PL_expenses" },
    { code: "PL_EXP_CII", name: "Changes in Inventories of FG/WIP/SIT", noteRef: getNoteNo("changes_inventories") ?? null, section: "PL_expenses" },
    { code: "PL_EXP_EMP", name: "Employee Benefits Expense", noteRef: getNoteNo("employee_benefits") ?? null, section: "PL_expenses" },
    { code: "PL_EXP_FIN", name: "Finance Costs", noteRef: getNoteNo("finance_costs") ?? null, section: "PL_expenses" },
    { code: "PL_EXP_DEP", name: "Depreciation and Amortisation Expense", noteRef: null, section: "PL_expenses" },
    { code: "PL_EXP_OTH", name: "Other Expenses", noteRef: getNoteNo("other_expenses") ?? null, section: "PL_expenses" },
  ]},
  { code: "PL_EI",    name: "Exceptional Items",          noteRef: null, section: "PL_expenses" },
  { code: "PL_TAX",   name: "Tax Expense",                noteRef: null, section: "PL_expenses", children: [
    { code: "PL_TAX_CUR", name: "Current Tax",   noteRef: null, section: "PL_expenses" },
    { code: "PL_TAX_DEF", name: "Deferred Tax",  noteRef: null, section: "PL_expenses" },
  ]},
  { code: "PL_PAT",   name: "Profit/(Loss) After Tax",    noteRef: null, section: "PL_expenses" },
  { code: "PL_EPS_B", name: "EPS — Basic (₹)",            noteRef: getNoteNo("eps") ?? null, section: "PL_expenses" },
  { code: "PL_EPS_D", name: "EPS — Diluted (₹)",          noteRef: getNoteNo("eps") ?? null, section: "PL_expenses" },
];

// ═══════════════════════════════════════
// Flatten FS tree for lookups
// ═══════════════════════════════════════
function flattenTree(items: FSLineItem[], depth = 0): (FSLineItem & { depth: number })[] {
  const result: (FSLineItem & { depth: number })[] = [];
  for (const item of items) {
    if (item.showTotalLast && item.children?.length) {
      // Children first, then the parent total row (e.g. "III. Total Income")
      result.push(...flattenTree(item.children, depth + 1));
      result.push({ ...item, depth });
    } else {
      result.push({ ...item, depth });
      if (item.children) {
        result.push(...flattenTree(item.children, depth + 1));
      }
    }
  }
  return result;
}

const FLAT_ITEMS = flattenTree(SCHEDULE_III_DIV_I);

// ── Inventory dual-posting map ────────────────────────────────────────────────
// Maps BS inventory code → P&L "Changes in Inventories" code (corporate + NCE).
// Ledgers mapped to any key are dual-posted:
//   BS: accumulate closing balance under the BS code
//   P&L: accumulate (opening − closing) under the PL code
const INV_DUAL_MAP: Record<string, string> = {
  "INV_STOCK": "PL_EXP_CII",  // Corporate — generic stock
  "INV_RM":    "PL_EXP_CII",  // Corporate — raw materials
  "INV_WIP":   "PL_EXP_CII",  // Corporate — work-in-progress
  "INV_FG":    "PL_EXP_CII",  // Corporate — finished goods
  "INV_STT":   "PL_EXP_CII",  // Corporate — stock-in-trade
  "NCE_STCK":  "NCE_CII",     // NCE / Partnership — inventories
};
const INV_CODES    = new Set(Object.keys(INV_DUAL_MAP));
const INV_PL_CODES = new Set(Object.values(INV_DUAL_MAP));

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

// Corporate BS liability-side codes — stored as NEGATIVE (Tally credit convention)
// but displayed as POSITIVE. When a user edits inline, the committed value is
// positive (as shown), so we must negate before storing back as a manual override.
const BS_LIABILITY_CODES = new Set([
  "BS_EQ_SC", "BS_EQ_RS",
  "BS_NCL_LTB", "BS_NCL_DTL", "BS_NCL_OLT", "BS_NCL_LTP",
  "BS_CL_STB", "BS_CL_TP", "BS_CL_OCL", "BS_CL_STP",
]);
// Corporate P&L revenue-side codes — same sign convention.
const PL_REVENUE_CODES = new Set(["PL_REV_OPS", "PL_REV_OI"]);

// ── Tally's accumulated P&L account (retained-earnings carrier) ──────────────
// Tally's "Profit & Loss A/c" ledger carries closing balance =
//   prior retained earnings + current-year net profit.
// When mapped to BS_EQ_RS, the closing balance double-counts current-year profit
// because revenue/expense ledgers already capture it via PL_REV / PL_EXP codes.
// Solution: use opening_balance (prior retained earnings only) for BS mapping.
// Current-year net profit is then auto-credited to BS_EQ_RS after P&L totals are known.
//
// Bug 4 / Bug 8 — Detection moved to a shared helper for robustness.
// The previous inline regex used a buggy character class [&and]+ that
// matched any of the literal characters & a n d (not the strings "&" or "and"),
// missing names like "Profit and Loss A/c" → closing balance flowed to
// BS_EQ_RS, double-counting current-year profit and inverting the BS sign.

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

// Indian numbering, whole rupees (no paise — auditor-friendly per user
// instruction), parens for negatives, "-" for zero. Reads the active
// FsUnits scale so a "Rs. in '000" / Lakhs / Crores toggle in the toolbar
// applies to every figure in BS/PL/Notes without touching call sites.
function formatINR(n: number | null | undefined): string {
  return formatScaledINRWhole(n);
}

// Smart note: only show a note number when at least one year has non-zero data.
// Pass the RAW (pre-negation) cy/py values — the zero-check is sign-agnostic.
// Module-level so both buildBSRows and buildPLRows can reference it.
function sn(
  noteNo: number | null | undefined,
  rawCy:  number | null | undefined,
  rawPy:  number | null | undefined,
): number | null {
  return (rawCy || 0) !== 0 || (rawPy || 0) !== 0 ? (noteNo ?? null) : null;
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
  // Sign convention: Tally exports credit balances (liabilities, equity) as NEGATIVE.
  // For display, negate all liability-side values so they appear as positive figures
  // on the Balance Sheet face (Assets and E&L both show positive amounts).
  const negL = (v: number | null | undefined) => -(v || 0);

  // Section subtotals — match Excel SUM(E10:E30) and SUM(E35:E52) ranges.
  // Negate because raw values are negative (Tally credit convention).
  const totalEL =
    negL(bs.shareCap.cy) + negL(bs.reserves.cy) +
    negL(bs.ltBorrowings.cy) + negL(bs.dtLiab.cy) + negL(bs.otherLtLiab.cy) + negL(bs.ltProvisions.cy) +
    negL(bs.stBorrowings.cy) +
    negL(bs.tradePayMSME.cy) + negL(bs.tradePayOthers.cy) +
    negL(bs.otherCurrLiab.cy) + negL(bs.stProvisions.cy);
  const totalELpy =
    negL(bs.shareCap.py) + negL(bs.reserves.py) +
    negL(bs.ltBorrowings.py) + negL(bs.dtLiab.py) + negL(bs.otherLtLiab.py) + negL(bs.ltProvisions.py) +
    negL(bs.stBorrowings.py) +
    negL(bs.tradePayMSME.py) + negL(bs.tradePayOthers.py) +
    negL(bs.otherCurrLiab.py) + negL(bs.stProvisions.py);
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
    { kind: "item", label: "(a) Share capital",         noteNo: sn(bs.shareCap.noteNo, bs.shareCap.cy, bs.shareCap.py),   cy: negL(bs.shareCap.cy),    py: negL(bs.shareCap.py),    indent: 1, code: "BS_EQ_SC" },
    { kind: "item", label: "(b) Reserves and surplus",  noteNo: sn(bs.reserves.noteNo, bs.reserves.cy, bs.reserves.py),   cy: negL(bs.reserves.cy),    py: negL(bs.reserves.py),    indent: 1, code: "BS_EQ_RS" },
    { kind: "spacer" },
    { kind: "item", label: "(2) Share application money pending allotment", cy: 0, py: 0, size: 9 },
    { kind: "spacer" },
    { kind: "subhead", label: "(3) Non-Current liabilities" },
    { kind: "item", label: "(a) Long-term borrowings",           noteNo: sn(bs.ltBorrowings.noteNo, bs.ltBorrowings.cy, bs.ltBorrowings.py), cy: negL(bs.ltBorrowings.cy), py: negL(bs.ltBorrowings.py), indent: 1, code: "BS_NCL_LTB" },
    { kind: "item", label: "(b) Deferred tax liabilities (Net)", noteNo: sn(bs.dtLiab.noteNo, bs.dtLiab.cy, bs.dtLiab.py),                    cy: negL(bs.dtLiab.cy),       py: negL(bs.dtLiab.py),       indent: 1, code: "BS_NCL_DTL" },
    { kind: "item", label: "(c) Other Long term liabilities",    noteNo: sn(bs.otherLtLiab.noteNo, bs.otherLtLiab.cy, bs.otherLtLiab.py),     cy: negL(bs.otherLtLiab.cy),  py: negL(bs.otherLtLiab.py),  indent: 1, code: "BS_NCL_OLT" },
    { kind: "item", label: "(d) Long-term provisions",           noteNo: sn(bs.ltProvisions.noteNo, bs.ltProvisions.cy, bs.ltProvisions.py),   cy: negL(bs.ltProvisions.cy), py: negL(bs.ltProvisions.py), indent: 1, code: "BS_NCL_LTP" },
    { kind: "spacer" },
    { kind: "subhead", label: "(4) Current liabilities" },
    { kind: "item", label: "(a) Short-term borrowings",  noteNo: sn(bs.stBorrowings.noteNo, bs.stBorrowings.cy, bs.stBorrowings.py), cy: negL(bs.stBorrowings.cy), py: negL(bs.stBorrowings.py), indent: 1, code: "BS_CL_STB" },
    { kind: "subhead", label: "(b) Trade payables", noteNo: sn(bs.tradePayables.noteNo, (bs.tradePayMSME.cy ?? 0) + (bs.tradePayOthers.cy ?? 0), (bs.tradePayMSME.py ?? 0) + (bs.tradePayOthers.py ?? 0)), indent: 1, code: "BS_CL_TP" },
    { kind: "item", label: "(i) Micro and Small Enterprises", cy: negL(bs.tradePayMSME.cy),   py: negL(bs.tradePayMSME.py),   indent: 2 },
    { kind: "item", label: "(ii) Others",                     cy: negL(bs.tradePayOthers.cy), py: negL(bs.tradePayOthers.py), indent: 2, code: "BS_CL_TP" },
    { kind: "item", label: "(c) Other current liabilities", noteNo: sn(bs.otherCurrLiab.noteNo, bs.otherCurrLiab.cy, bs.otherCurrLiab.py), cy: negL(bs.otherCurrLiab.cy), py: negL(bs.otherCurrLiab.py), indent: 1, size: 10, code: "BS_CL_OCL" },
    { kind: "item", label: "(d) Short-term provisions",     noteNo: sn(bs.stProvisions.noteNo, bs.stProvisions.cy, bs.stProvisions.py),     cy: negL(bs.stProvisions.cy),  py: negL(bs.stProvisions.py),  indent: 1, code: "BS_CL_STP" },
    { kind: "spacer" },
    { kind: "total", label: "TOTAL EQUITY AND LIABILITIES", cy: totalEL, py: totalELpy },
    { kind: "spacer" },
    // ── ASSETS ───────────────────────────────────────────────────────────
    { kind: "section", label: "II  ASSETS", size: 10 },
    { kind: "subhead", label: "(1) Non-Current Assets" },
    { kind: "subhead", label: "(a) Property, Plant & Equipment and Intangible Assets", indent: 1 },
    { kind: "item", label: "(i) Property, plant and equipment and Intangible Assets", noteNo: bs.ppe.noteNo ?? null, cy: bs.ppe.cy || 0, py: bs.ppe.py || 0, indent: 2, code: "BS_NCA_FA" },
    { kind: "item", label: "(ii) Intangible assets",          cy: 0, py: 0, indent: 2 },
    { kind: "item", label: "(iii) Capital work-in-Progress",  cy: 0, py: 0, indent: 2 },
    { kind: "item", label: "(b) Non-current investments",        noteNo: sn(bs.ncInvestments.noteNo, bs.ncInvestments.cy, bs.ncInvestments.py), cy: bs.ncInvestments.cy || 0, py: bs.ncInvestments.py || 0, indent: 1, size: 10, code: "BS_NCA_INV" },
    { kind: "item", label: "(c) Deferred tax assets (Net)",      noteNo: sn(bs.dtAssets.noteNo, bs.dtAssets.cy, bs.dtAssets.py),               cy: bs.dtAssets.cy || 0,      py: bs.dtAssets.py || 0,      indent: 1, size: 10, code: "BS_NCA_DTA" },
    { kind: "item", label: "(d) Long-term loans and advances",   noteNo: sn(bs.ltLoans.noteNo, bs.ltLoans.cy, bs.ltLoans.py),                   cy: bs.ltLoans.cy || 0,       py: bs.ltLoans.py || 0,       indent: 1, code: "BS_NCA_LLA" },
    { kind: "item", label: "(e) Other non-current Assets",       noteNo: sn(bs.otherNcAssets.noteNo, bs.otherNcAssets.cy, bs.otherNcAssets.py), cy: bs.otherNcAssets.cy || 0, py: bs.otherNcAssets.py || 0, indent: 1, size: 10, code: "BS_NCA_ONA" },
    { kind: "spacer" },
    { kind: "subhead", label: "(2) Current assets" },
    { kind: "item", label: "(a) Current investments",          noteNo: sn(bs.currInvestments.noteNo, bs.currInvestments.cy, bs.currInvestments.py), cy: bs.currInvestments.cy || 0, py: bs.currInvestments.py || 0, indent: 1, code: "BS_CA_CI" },
    { kind: "item", label: "(b) Inventories",                  noteNo: sn(bs.inventories.noteNo, bs.inventories.cy, bs.inventories.py),             cy: bs.inventories.cy || 0,     py: bs.inventories.py || 0,     indent: 1, code: "BS_CA_INV" },
    { kind: "item", label: "(c) Trade receivables",            noteNo: sn(bs.tradeRec.noteNo, bs.tradeRec.cy, bs.tradeRec.py),                     cy: bs.tradeRec.cy || 0,        py: bs.tradeRec.py || 0,        indent: 1, code: "BS_CA_TR" },
    { kind: "item", label: "(d) Cash and bank equivalents",    noteNo: sn(bs.cashBank.noteNo, bs.cashBank.cy, bs.cashBank.py),                     cy: bs.cashBank.cy || 0,        py: bs.cashBank.py || 0,        indent: 1, code: "BS_CA_CCE" },
    { kind: "item", label: "(e) Short-term loans and advances",noteNo: sn(bs.stLoans.noteNo, bs.stLoans.cy, bs.stLoans.py),                       cy: bs.stLoans.cy || 0,         py: bs.stLoans.py || 0,         indent: 1, code: "BS_CA_SLA" },
    { kind: "item", label: "(f) Other current assets",         noteNo: sn(bs.otherCurrAssets.noteNo, bs.otherCurrAssets.cy, bs.otherCurrAssets.py), cy: bs.otherCurrAssets.cy || 0, py: bs.otherCurrAssets.py || 0, indent: 1, code: "BS_CA_OCA" },
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

// ── BS FS code → registry note key ──────────────────────────────────────────
// Reverse of CORP_KEY_TO_FS_CODES in noteNumberRegistry.
// Used by CorporateBalanceSheetView's NoteCell.
const FS_CODE_TO_NOTE_KEY: Readonly<Record<string, string>> = {
  BS_EQ_SC:   "share_capital",
  BS_EQ_RS:   "reserves_surplus",
  BS_NCL_LTB: "lt_borrowings",
  BS_NCL_DTL: "deferred_tax_liab",
  BS_NCL_OLT: "other_lt_liab",
  BS_NCL_LTP: "lt_provisions",
  BS_CL_STB:  "st_borrowings",
  BS_CL_TP:   "trade_payables",
  BS_CL_OCL:  "other_current_liab",
  BS_CL_STP:  "st_provisions",
  BS_NCA_FA:  "ppe",
  BS_NCA_INV: "nc_investments",
  BS_NCA_DTA: "deferred_tax_assets",
  BS_NCA_LLA: "lt_loans_advances",
  BS_NCA_ONA: "other_nc_assets",
  BS_CA_CI:   "current_investments",
  BS_CA_INV:  "inventories",
  BS_CA_TR:   "trade_receivables",
  BS_CA_CCE:  "cash_bank",
  BS_CA_SLA:  "st_loans_advances",
  BS_CA_OCA:  "other_current_assets",
};

// Bug 5 — NCE FS code → notes section (bs_liab / bs_asset / pl).
// Used to substitute notes-aware sums into the amounts map for NCE
// (Phase E parity with corporate entities).
const NCE_CODE_TO_SECTION: Readonly<Record<string, "bs_liab" | "bs_asset" | "pl">> = {
  NCE_CAP: "bs_liab", NCE_LTB: "bs_liab", NCE_OLTL: "bs_liab", NCE_LTP: "bs_liab",
  NCE_STB: "bs_liab", NCE_TP: "bs_liab", NCE_OCL: "bs_liab", NCE_STP: "bs_liab",
  NCE_PPE: "bs_asset", NCE_CWIP: "bs_asset", NCE_INTG: "bs_asset",
  NCE_NCINV: "bs_asset", NCE_LTLA: "bs_asset", NCE_ONCA: "bs_asset",
  NCE_CINV: "bs_asset", NCE_STCK: "bs_asset", NCE_TR: "bs_asset",
  NCE_CASH: "bs_asset", NCE_STLA: "bs_asset", NCE_OCA: "bs_asset",
  NCE_REV_OPS: "pl", NCE_REV_OTH: "pl",
  NCE_COGS: "pl", NCE_EMP_EXP: "pl", NCE_FIN_COST: "pl",
  NCE_DEPR: "pl", NCE_OTH_EXP: "pl",
};

// ── NCE FS code → registry note key (BS + P&L) ───────────────────────────────
// Shared by NCEBalanceSheetView and NCEPLView.
// CWIP and Intangibles share the "ppe" note (shown in NCEPPESchedule).
// Short-term loans (NCE_STLA) have their own registry key per NCE_NOTE_ORDER.
// NCE_PART_REM (partners' remuneration) has no note → renders "—".
const NCE_CODE_TO_NOTE_KEY: Readonly<Record<string, string>> = {
  // BS — Equity & Liabilities
  NCE_CAP:      "owners_capital",
  NCE_LTB:      "lt_borrowings",
  NCE_OLTL:     "other_lt_liab",
  NCE_LTP:      "lt_provisions",
  NCE_STB:      "st_borrowings",
  NCE_TP:       "trade_payables",
  NCE_OCL:      "other_current_liab",
  NCE_STP:      "st_provisions",
  // BS — Assets
  NCE_PPE:      "ppe",
  NCE_CWIP:     "ppe",              // Capital WIP presented under PPE note
  NCE_INTG:     "ppe",              // Intangibles presented under PPE note
  NCE_NCINV:    "nc_investments",
  NCE_LTLA:     "lt_loans_advances",
  NCE_ONCA:     "other_nc_assets",
  NCE_CINV:     "current_investments",
  NCE_STCK:     "inventories",
  NCE_TR:       "trade_receivables",
  NCE_CASH:     "cash_bank",
  NCE_STLA:     "st_loans_advances",
  NCE_OCA:      "other_current_assets",
  // P&L — Income
  NCE_REV_OPS:  "nce_revenue_from_ops",
  NCE_REV_OTH:  "nce_other_income",
  // P&L — Expenses
  NCE_COGS:     "nce_cost_goods",
  NCE_EMP_EXP:  "nce_employee_benefits",
  NCE_FIN_COST: "nce_finance_costs",
  NCE_DEPR:     "nce_depreciation",
  NCE_OTH_EXP:  "nce_other_expenses",
  // NCE_PART_REM intentionally absent — no note defined in NCE_NOTE_ORDER
};

/**
 * Maps NCE FS item codes to their STATIC noteRef (from nceLineItems.ts).
 * Used by NoteCell to look up sequential dynamic note numbers from nceDynamicNoteMap
 * (which is keyed by static noteRef).  Keeping both BS and Notes tab using the
 * same nceDynamicNoteMap ensures note numbers are always in sync.
 */
const NCE_CODE_TO_STATIC_REF: Readonly<Record<string, number>> = {
  NCE_CAP: 2,
  NCE_LTB: 3, NCE_OLTL: 4, NCE_LTP: 5,
  NCE_STB: 6, NCE_TP: 7, NCE_OCL: 8, NCE_STP: 9,
  NCE_PPE: 10, NCE_CWIP: 11, NCE_INTG: 12,
  NCE_NCINV: 13, NCE_LTLA: 14, NCE_ONCA: 15,
  NCE_CINV: 16, NCE_STCK: 17, NCE_TR: 18, NCE_CASH: 19, NCE_STLA: 20, NCE_OCA: 21,
  NCE_REV_OPS: 22, NCE_REV_OTH: 23,
  // Issue 1 — NCE Depreciation row shares the PPE note number (10) so the
  // FA Schedule serves both BS PPE and P&L Depreciation.  Clicks navigate
  // to the same Note 10 (FA grid) in the NCE Notes tab.
  NCE_COGS: 24, NCE_EMP_EXP: 25, NCE_FIN_COST: 26, NCE_DEPR: 10, NCE_OTH_EXP: 28,
};

// ── P&L FS code → registry note key ─────────────────────────────────────────
// Used by CorporatePLView's NoteCell.
const PL_CODE_TO_NOTE_KEY: Readonly<Record<string, string>> = {
  PL_REV_OPS: "revenue_from_ops",
  PL_REV_OI:  "other_income",
  PL_EXP_MAT: "cost_materials",
  PL_EXP_SIT: "purchases_stock",
  PL_EXP_CII: "changes_inventories",
  PL_EXP_EMP: "employee_benefits",
  PL_EXP_FIN: "finance_costs",
  PL_EXP_DEP: "depreciation",
  PL_EXP_OTH: "other_expenses",
  PL_EPS_B:   "eps",   // EPS header row (Basic used as the key carrier)
};

/** Maps every corporate FS code to the Notes sub-tab that owns its NoteCard. */
const FS_CODE_TO_NOTES_SUBTAB: Readonly<Record<string, "bs_liab" | "bs_asset" | "pl" | "fa">> = {
  BS_EQ_SC: "bs_liab", BS_EQ_RS: "bs_liab",
  BS_NCL_LTB: "bs_liab", BS_NCL_DTL: "bs_liab", BS_NCL_OLT: "bs_liab", BS_NCL_LTP: "bs_liab",
  BS_CL_STB: "bs_liab", BS_CL_TP: "bs_liab", BS_CL_OCL: "bs_liab", BS_CL_STP: "bs_liab",
  BS_NCA_FA: "fa",      BS_NCA_INV: "bs_asset", BS_NCA_DTA: "bs_asset",
  BS_NCA_LLA: "bs_asset", BS_NCA_ONA: "bs_asset",
  BS_CA_CI: "bs_asset", BS_CA_INV: "bs_asset", BS_CA_TR: "bs_asset",
  BS_CA_CCE: "bs_asset", BS_CA_SLA: "bs_asset", BS_CA_OCA: "bs_asset",
  PL_REV_OPS: "pl", PL_REV_OI: "pl", PL_EXP_MAT: "pl", PL_EXP_SIT: "pl",
  PL_EXP_CII: "pl", PL_EXP_EMP: "pl", PL_EXP_FIN: "pl",
  // Issue 1 — Depreciation routes to the FA Schedule sub-tab, not P&L.
  // The FA grid is the underlying source for both BS PPE and P&L Depreciation.
  PL_EXP_DEP: "fa",
  PL_EXP_OTH: "pl", PL_EPS_B: "pl",
};

interface CorporateBalanceSheetViewProps {
  engagementId:      string;
  bs:                BSRowData;
  cyYear:            number;
  pyYear:            number;
  companyName:       string;
  pyLocked?:         boolean;
  onCommitCY?:       (code: string, value: number | null) => void;
  onCommitPY?:       (code: string, value: number | null) => void;
  onEditNote?:       (code: string, value: number | null) => void;
  /** Click a note number → jump to that note in the Notes tab. */
  onNavigateToNote?: (noteNo: number, subTab: "bs_liab" | "bs_asset" | "pl" | "fa") => void;
}

function CorporateBalanceSheetView({
  engagementId: _engagementId, bs, cyYear, pyYear, companyName, pyLocked,
  onCommitCY, onCommitPY, onEditNote, onNavigateToNote,
}: CorporateBalanceSheetViewProps) {
  // NOTE: Do NOT call useDynamicNoteRegistry here — that hook (without amounts)
  // uses COA signal and produces different sequential numbers than the outer
  // buildDynamicRegistry call.  The note number to display is already embedded
  // in each BSRow.noteNo by the outer component; derive the label from it directly.

  /**
   * Renders the Note No. cell for a corporate BS row.
   * noteNo from sn() is null when CY=PY=0 (zero-suppression gate).
   * When onNavigateToNote is wired, the cell becomes a clickable button
   * that switches to the Notes tab and scrolls to the NoteCard.
   */
  const NoteCell = ({ code, noteNo }: { code?: string | null; noteNo?: number | null }) => {
    // noteNo is the authoritative number from the outer buildDynamicRegistry.
    // Use it directly as the label so display always matches the outer registry.
    if (noteNo == null) return <td className="text-center py-1 px-2 text-muted-foreground/40 text-[11px]">—</td>;
    const label = String(noteNo);
    const subTab = code ? FS_CODE_TO_NOTES_SUBTAB[code] : undefined;
    return (
      <td className="text-center py-1 px-2">
        {onNavigateToNote && subTab ? (
          <button
            type="button"
            onClick={() => onNavigateToNote(noteNo, subTab)}
            className="inline-flex items-center gap-0.5 text-primary hover:underline font-medium text-[11px]"
            title={`Go to Note ${label}`}
          >
            {label}
            <ArrowRight className="h-2.5 w-2.5" />
          </button>
        ) : (
          <span className="text-primary font-medium text-[11px] cursor-default">{label}</span>
        )}
      </td>
    );
  };

  const rows = buildBSRows(bs);
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Title block — mirrors rows 2–7 of the exported sheet */}
      <div className="text-center border-b bg-muted/30 py-2 px-3">
        <div className="font-bold text-sm">{companyName}</div>
        <div className="text-xs mt-0.5">Balance Sheet as at 31st March, {cyYear}</div>
        <div className="text-[10px] text-muted-foreground italic mt-0.5">(Amount in ₹)</div>
        {(onCommitCY || onCommitPY) && (
          <div className="text-[10px] text-primary mt-1">
            <Pencil className="inline w-2.5 h-2.5 mr-0.5" />
            Click any dashed cell (CY / PY) to edit · Enter / Tab to save · clear to revert
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
                  <NoteCell code={row.code} noteNo={row.noteNo} />
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
                  {row.noteNo != null
                    ? <td className="text-center py-1 px-2 text-primary font-medium text-[11px] italic">{row.noteNo}</td>
                    : <td />}
                </tr>
              );
            }
            // item
            const indentPx = (row.indent || 0) * 16;
            const fontSize = row.size === 10 ? "text-[12px]" : "text-[11px]";
            const editableCY   = !!row.code && !!onCommitCY;
            const editablePY   = !!row.code && !!onCommitPY && !pyLocked;
            return (
              <tr key={idx} className="hover:bg-muted/10">
                <td className={`py-0.5 px-3 ${fontSize}`} style={{ paddingLeft: 12 + indentPx }}>{row.label}</td>
                <NoteCell code={row.code} noteNo={row.noteNo} />
                <td className={`text-right tabular-nums py-0.5 px-3 ${fontSize}`}>
                  {editableCY
                    ? <EditableMoneyCell value={row.cy} onCommit={(v) => onCommitCY!(row.code!, v)} />
                    : formatINR(row.cy)}
                </td>
                <td className={`text-right tabular-nums py-0.5 px-3 ${fontSize}`}>
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
  | { kind: "item";     roman?: string; label: string; noteNo?: number | null; cy?: number | null; py?: number | null; bold?: boolean; indent?: number; code?: string }
  | { kind: "total";    roman?: string; label: string; cy: number; py: number }
  | { kind: "subnote";  label: string; bold?: boolean }              // helper line e.g. "(III-IV)"
  | { kind: "footer";   label: string };

function buildPLRows(pl: PLRowData, notesData?: Stage5Notes | null): PLDisplayRow[] {
  // Sign convention: Tally exports revenue/income as NEGATIVE (credit balances).
  // Negate for display so income shows as positive on the P&L face.
  const negI = (v: number | null | undefined) => -(v || 0);

  // Total Income: negate raw values (which are stored as negative credits)
  const totalIncomeCy = negI(pl.revFromOps.cy) + negI(pl.otherIncome.cy);
  const totalIncomePy = negI(pl.revFromOps.py) + negI(pl.otherIncome.py);
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

  // Profit = Income (positive after negation) − Expenses (positive) → correct
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
  // XV = IX − currentTax + deferredTax  (same formula for both CY and PY)
  // deferredTax is the signed TB value: negative for DTL (reduces profit),
  // positive for DTA (adds to profit). + preserves the sign naturally.
  const profitCy = pbtCy - currentTaxCy + deferredTaxCy;           // XV
  const profitPy = pbtPy - currentTaxPy + deferredTaxPy;           // XV (Phase G fix: was -deferredTaxPy)

  // Bug 1 — EPS divisor uses paid-up share count from the Share Capital note
  // breakup (share_count_cy / share_count_py), NOT the note number.  Falls
  // back to "—" display when the share count is 0/missing.
  const sharesCy = getSharesOutstanding(notesData ?? null, "cy");
  const sharesPy = getSharesOutstanding(notesData ?? null, "py");
  const epsBasicCy: number | null = sharesCy > 0 ? profitCy / sharesCy : null;
  const epsBasicPy: number | null = sharesPy > 0 ? profitPy / sharesPy : null;
  // Default Diluted = Basic when no dilution adjustment is captured.
  const epsDilCy = epsBasicCy;
  const epsDilPy = epsBasicPy;

  return [
    { kind: "item",   roman: "I.",   label: "Revenue from operations", noteNo: sn(pl.revFromOps.noteNo, pl.revFromOps.cy, pl.revFromOps.py),     cy: negI(pl.revFromOps.cy), py: negI(pl.revFromOps.py), code: "PL_REV_OPS" },
    { kind: "item",   roman: "II.",  label: "Other income",            noteNo: sn(pl.otherIncome.noteNo, pl.otherIncome.cy, pl.otherIncome.py),   cy: negI(pl.otherIncome.cy), py: negI(pl.otherIncome.py), code: "PL_REV_OI" },
    { kind: "total",  roman: "III.", label: "Total Income (I+II)",     cy: totalIncomeCy, py: totalIncomePy },
    { kind: "spacer" },
    { kind: "header", roman: "IV.",  label: "Expenses" },
    { kind: "item",   label: "Cost of materials consumed",            noteNo: sn(pl.costMaterials.noteNo, pl.costMaterials.cy, pl.costMaterials.py), cy: pl.costMaterials.cy, py: pl.costMaterials.py, indent: 1, code: "PL_EXP_MAT" },
    { kind: "item",   label: "Purchases of Stock-in-Trade",           noteNo: sn(pl.purchasesStock.noteNo, pl.purchasesStock.cy, pl.purchasesStock.py),             cy: pl.purchasesStock.cy, py: pl.purchasesStock.py, indent: 1, code: "PL_EXP_SIT" },
    { kind: "item",   label: "Changes in inventories of finished goods, Work-in-progress and Stock-in-Trade", noteNo: sn(pl.changesInventories.noteNo, pl.changesInventories.cy, pl.changesInventories.py), cy: pl.changesInventories.cy, py: pl.changesInventories.py, indent: 1, code: "PL_EXP_CII" },
    { kind: "item",   label: "Employee benefits expense",             noteNo: sn(pl.employeeBenefits.noteNo, pl.employeeBenefits.cy, pl.employeeBenefits.py),         cy: pl.employeeBenefits.cy, py: pl.employeeBenefits.py, indent: 1, code: "PL_EXP_EMP" },
    { kind: "item",   label: "Finance Costs",                         noteNo: sn(pl.financeCosts.noteNo, pl.financeCosts.cy, pl.financeCosts.py),                     cy: pl.financeCosts.cy, py: pl.financeCosts.py, indent: 1, code: "PL_EXP_FIN" },
    { kind: "item",   label: "Depreciation & Amortisation Expenses",  noteNo: sn(pl.depreciation.noteNo, pl.depreciation.cy, pl.depreciation.py),                   cy: pl.depreciation.cy, py: pl.depreciation.py, indent: 1, code: "PL_EXP_DEP" },
    { kind: "item",   label: "Other expenses",                        noteNo: sn(pl.otherExpenses.noteNo, pl.otherExpenses.cy, pl.otherExpenses.py),                 cy: pl.otherExpenses.cy, py: pl.otherExpenses.py, indent: 1, code: "PL_EXP_OTH" },
    { kind: "total",  label: "Total Expenses",                        cy: totalExpensesCy, py: totalExpensesPy },
    { kind: "spacer" },
    { kind: "item",   roman: "V.",   label: "Profit before exceptional and extraordinary items and tax", cy: pbExceptionalCy, py: pbExceptionalPy, bold: true },
    { kind: "subnote", label: "(III-IV)", bold: true },
    { kind: "item",   roman: "VI.",  label: "Exceptional items",      cy: exceptionalCy, py: exceptionalPy },
    { kind: "item",   roman: "VII.", label: "Profit before extraordinary items and tax (V-VI)", cy: pbExtraordinaryCy, py: pbExtraordinaryPy, bold: true },
    { kind: "item",   roman: "VIII.",label: "Extraordinary items",    cy: extraordinaryCy, py: extraordinaryPy },
    { kind: "item",   roman: "IX.",  label: "Profit before tax (VII-VIII)", cy: pbtCy, py: pbtPy, bold: true },
    { kind: "header", roman: "X.",   label: "Tax expense:" },
    { kind: "item",   label: "(1) Current tax",  cy: currentTaxCy, py: currentTaxPy, indent: 2, code: "PL_TAX_CUR" },
    { kind: "item",   label: "(2) Deferred tax", cy: deferredTaxCy, py: deferredTaxPy, indent: 2, code: "PL_TAX_DEF" },
    { kind: "item",   roman: "XI.",  label: "Profit (loss) for period from continuing operations", bold: true },
    { kind: "subnote", label: "(VII-VIII)", bold: true },
    { kind: "item",   roman: "XII.", label: "Profit (loss) for period from discontinuing operations" },
    { kind: "item",   roman: "XIII.",label: "Tax expense of discontinuing operations" },
    { kind: "item",   roman: "XIV.", label: "Profit (loss) from discontinuing operations (after tax)", bold: true },
    { kind: "subnote", label: "(XII-XIII)", bold: true },
    { kind: "total",  roman: "XV.",  label: "Profit / (Loss) for the period (XI+XIV)", cy: profitCy, py: profitPy },
    { kind: "spacer" },
    { kind: "item",   label: "Earnings per equity share ;", noteNo: pl.eps.noteNo, bold: true, code: "PL_EPS_B" },
    { kind: "item",   label: "(1) Basic",   cy: epsBasicCy, py: epsBasicPy, indent: 2 },
    { kind: "item",   label: "(2) Diluted", cy: epsDilCy,   py: epsDilPy,   indent: 2 },
    { kind: "footer", label: "The accompanying notes form an integral part of the financial statements." },
  ];
}

interface CorporatePLViewProps {
  engagementId:      string;
  pl:                PLRowData;
  cyYear:            number;
  pyYear:            number;
  companyName:       string;
  pyLocked?:         boolean;
  lockedCodes?:      Set<string>;
  onCommitCY?:       (code: string, value: number | null) => void;
  onCommitPY?:       (code: string, value: number | null) => void;
  /** Click a note number → jump to that note in the Notes tab. */
  onNavigateToNote?: (noteNo: number, subTab: "bs_liab" | "bs_asset" | "pl" | "fa") => void;
  /** Bug 1: Stage-5 notes data so EPS divisor can read paid-up share count. */
  notesData?:        Stage5Notes | null;
}

function CorporatePLView({
  engagementId: _engagementId, pl, cyYear, pyYear, companyName, pyLocked, lockedCodes,
  onCommitCY, onCommitPY, onNavigateToNote, notesData,
}: CorporatePLViewProps) {
  // NOTE: Do NOT call useDynamicNoteRegistry here — same reason as CorporateBalanceSheetView.
  // The noteNo embedded in each PLRow is already from the outer buildDynamicRegistry;
  // use it directly as the display label to avoid mismatched sequential numbers.

  /**
   * Renders the Note No. cell for a corporate P&L row.
   * noteNo from sn() is null when CY=PY=0 (zero-suppression gate).
   * Becomes a clickable button when onNavigateToNote is wired.
   */
  const NoteCell = ({ code, noteNo }: { code?: string | null; noteNo?: number | null }) => {
    if (noteNo == null) return <td className="text-center py-0.5 px-2 text-muted-foreground/40 text-[11px]">—</td>;
    const label = String(noteNo);
    const subTab = code ? FS_CODE_TO_NOTES_SUBTAB[code] : undefined;
    return (
      <td className="text-center py-0.5 px-2">
        {onNavigateToNote && subTab ? (
          <button
            type="button"
            onClick={() => onNavigateToNote(noteNo, subTab)}
            className="inline-flex items-center gap-0.5 text-primary hover:underline font-medium text-[11px]"
            title={`Go to Note ${label}`}
          >
            {label}
            <ArrowRight className="h-2.5 w-2.5" />
          </button>
        ) : (
          <span className="text-primary font-medium text-[11px] cursor-default">{label}</span>
        )}
      </td>
    );
  };

  const rows = buildPLRows(pl, notesData);
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
            const isLockedCY = !!row.code && lockedCodes?.has(row.code);
            const editableCY = !!row.code && !!onCommitCY && !isLockedCY;
            const editablePY = !!row.code && !!onCommitPY && !pyLocked && !isLockedCY;
            return (
              <tr key={idx} className="hover:bg-muted/10">
                <td className={`text-center py-0.5 px-1 ${boldCls} text-[11px]`}>{row.roman || ""}</td>
                <td className={`py-0.5 px-3 ${boldCls} text-[11px]`} style={{ paddingLeft: 12 + indentPx }}>{row.label}</td>
                <NoteCell code={row.code} noteNo={row.noteNo} />
                <td className={`text-right tabular-nums py-0.5 px-3 ${boldCls} text-[11px]`}>
                  {editableCY
                    ? <EditableMoneyCell value={row.cy ?? 0} onCommit={(v) => onCommitCY!(row.code!, v)} />
                    : (row.cy === undefined ? "" : <span className="inline-flex items-center gap-1">{formatINR(row.cy)}{isLockedCY && <span title="Auto-computed from INV_* ledgers — locked" className="text-blue-400">🔒</span>}</span>)}
                </td>
                <td className={`text-right tabular-nums py-0.5 px-3 ${boldCls} text-[11px]`}>
                  {editablePY
                    ? <EditableMoneyCell value={row.py ?? 0} onCommit={(v) => onCommitPY!(row.code!, v)} />
                    : (row.py === undefined ? "" : formatINR(row.py))}
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
// Phase UI-5 — NCE Balance Sheet + P&L (pixel-perfect, matches corporate quality)
// ─────────────────────────────────────────────────────────────────────────

// NCE liability-side codes (stored as Tally credit = NEGATIVE; displayed positive)
const NCE_LIABILITY_CODES = new Set([
  "NCE_CAP", "NCE_LTB", "NCE_OLTL", "NCE_LTP",
  "NCE_STB", "NCE_TP",  "NCE_OCL",  "NCE_STP",
]);
const NCE_INCOME_CODES = new Set(["NCE_REV_OPS", "NCE_REV_OTH"]);

function buildNCEBSRows(
  cy: Record<string, number>,
  py: Record<string, number>,
): BSDisplayRow[] {
  const negL  = (c: string) => -(cy[c] || 0);
  const negLpy= (c: string) => -(py[c] || 0);
  const pos   = (c: string) =>   cy[c] || 0;
  const pospy = (c: string) =>   py[c] || 0;

  const totalEL  = -(cy["NCE_EL"]  || 0);
  const totalELpy= -(py["NCE_EL"]  || 0);
  const totalAst =   cy["NCE_AST"] || 0;
  const totalAstPy=  py["NCE_AST"] || 0;

  return [
    { kind: "section", label: "EQUITY AND LIABILITIES", size: 10 },
    { kind: "subhead", label: "(1) Owners' Funds" },
    { kind: "item", label: "(a) Owners' Capital Account",      noteNo: sn(2,  cy["NCE_CAP"],  py["NCE_CAP"]),  cy: negL("NCE_CAP"),  py: negLpy("NCE_CAP"),  indent: 1, code: "NCE_CAP" },
    { kind: "spacer" },
    { kind: "subhead", label: "(2) Non-Current Liabilities" },
    { kind: "item", label: "(a) Long-term borrowings",         noteNo: sn(3,  cy["NCE_LTB"],  py["NCE_LTB"]),  cy: negL("NCE_LTB"),  py: negLpy("NCE_LTB"),  indent: 1, code: "NCE_LTB" },
    { kind: "item", label: "(b) Other long-term liabilities",  noteNo: sn(4,  cy["NCE_OLTL"], py["NCE_OLTL"]), cy: negL("NCE_OLTL"), py: negLpy("NCE_OLTL"), indent: 1, code: "NCE_OLTL" },
    { kind: "item", label: "(c) Long-term provisions",         noteNo: sn(5,  cy["NCE_LTP"],  py["NCE_LTP"]),  cy: negL("NCE_LTP"),  py: negLpy("NCE_LTP"),  indent: 1, code: "NCE_LTP" },
    { kind: "spacer" },
    { kind: "subhead", label: "(3) Current Liabilities" },
    { kind: "item", label: "(a) Short-term borrowings",        noteNo: sn(6,  cy["NCE_STB"],  py["NCE_STB"]),  cy: negL("NCE_STB"),  py: negLpy("NCE_STB"),  indent: 1, code: "NCE_STB" },
    { kind: "item", label: "(b) Trade payables",               noteNo: sn(7,  cy["NCE_TP"],   py["NCE_TP"]),   cy: negL("NCE_TP"),   py: negLpy("NCE_TP"),   indent: 1, code: "NCE_TP" },
    { kind: "item", label: "(c) Other current liabilities",    noteNo: sn(8,  cy["NCE_OCL"],  py["NCE_OCL"]),  cy: negL("NCE_OCL"),  py: negLpy("NCE_OCL"),  indent: 1, code: "NCE_OCL" },
    { kind: "item", label: "(d) Short-term provisions",        noteNo: sn(9,  cy["NCE_STP"],  py["NCE_STP"]),  cy: negL("NCE_STP"),  py: negLpy("NCE_STP"),  indent: 1, code: "NCE_STP" },
    { kind: "spacer" },
    { kind: "total", label: "TOTAL EQUITY AND LIABILITIES", cy: totalEL, py: totalELpy },
    { kind: "spacer" },
    { kind: "section", label: "ASSETS", size: 10 },
    { kind: "subhead", label: "(1) Non-Current Assets" },
    { kind: "item", label: "(a)(i)   Property, plant and equipment",   noteNo: sn(10, cy["NCE_PPE"],   py["NCE_PPE"]),   cy: pos("NCE_PPE"),   py: pospy("NCE_PPE"),   indent: 1, code: "NCE_PPE" },
    { kind: "item", label: "(a)(ii)  Capital work-in-progress",        noteNo: sn(11, cy["NCE_CWIP"],  py["NCE_CWIP"]),  cy: pos("NCE_CWIP"),  py: pospy("NCE_CWIP"),  indent: 1, code: "NCE_CWIP" },
    { kind: "item", label: "(a)(iii) Intangible assets",               noteNo: sn(12, cy["NCE_INTG"],  py["NCE_INTG"]),  cy: pos("NCE_INTG"),  py: pospy("NCE_INTG"),  indent: 1, code: "NCE_INTG" },
    { kind: "item", label: "(b) Non-current investments",              noteNo: sn(13, cy["NCE_NCINV"], py["NCE_NCINV"]), cy: pos("NCE_NCINV"), py: pospy("NCE_NCINV"), indent: 1, code: "NCE_NCINV" },
    { kind: "item", label: "(c) Long-term loans and advances",         noteNo: sn(14, cy["NCE_LTLA"],  py["NCE_LTLA"]),  cy: pos("NCE_LTLA"),  py: pospy("NCE_LTLA"),  indent: 1, code: "NCE_LTLA" },
    { kind: "item", label: "(d) Other non-current assets",             noteNo: sn(15, cy["NCE_ONCA"],  py["NCE_ONCA"]),  cy: pos("NCE_ONCA"),  py: pospy("NCE_ONCA"),  indent: 1, code: "NCE_ONCA" },
    { kind: "spacer" },
    { kind: "subhead", label: "(2) Current Assets" },
    { kind: "item", label: "(a) Current investments",                  noteNo: sn(16, cy["NCE_CINV"],  py["NCE_CINV"]),  cy: pos("NCE_CINV"),  py: pospy("NCE_CINV"),  indent: 1, code: "NCE_CINV" },
    { kind: "item", label: "(b) Inventories",                          noteNo: sn(17, cy["NCE_STCK"],  py["NCE_STCK"]),  cy: pos("NCE_STCK"),  py: pospy("NCE_STCK"),  indent: 1, code: "NCE_STCK" },
    { kind: "item", label: "(c) Trade receivables",                    noteNo: sn(18, cy["NCE_TR"],    py["NCE_TR"]),    cy: pos("NCE_TR"),    py: pospy("NCE_TR"),    indent: 1, code: "NCE_TR" },
    { kind: "item", label: "(d) Cash and bank balances",               noteNo: sn(19, cy["NCE_CASH"],  py["NCE_CASH"]),  cy: pos("NCE_CASH"),  py: pospy("NCE_CASH"),  indent: 1, code: "NCE_CASH" },
    // NCE: short-term loans share Note 14 with long-term loans (combined LT/ST in NCENotesConfig)
    { kind: "item", label: "(e) Short-term loans and advances",        noteNo: sn(14, cy["NCE_STLA"],  py["NCE_STLA"]),  cy: pos("NCE_STLA"),  py: pospy("NCE_STLA"),  indent: 1, code: "NCE_STLA" },
    { kind: "item", label: "(f) Other current assets",                 noteNo: sn(21, cy["NCE_OCA"],   py["NCE_OCA"]),   cy: pos("NCE_OCA"),   py: pospy("NCE_OCA"),   indent: 1, code: "NCE_OCA" },
    { kind: "spacer" },
    { kind: "total", label: "TOTAL ASSETS", cy: totalAst, py: totalAstPy },
    { kind: "spacer" },
    { kind: "footer", label: "Summary of Significant Accounting Policies", noteNo: 1 },
  ];
}

function buildNCEPLRows(
  cy:  Record<string, number>,
  py:  Record<string, number>,
): PLDisplayRow[] {
  const negI  = (c: string) => -(cy[c] || 0);  // income stored as credit (negative)
  const negIpy= (c: string) => -(py[c] || 0);
  const pos   = (c: string) =>   cy[c] || 0;
  const pospy = (c: string) =>   py[c] || 0;

  // NCE_PL_INC is sum of income codes (negative), NCE_PL_EXP is sum of expense codes (positive)
  const totalIncomeCy = negI("NCE_PL_INC");
  const totalIncomePy = negIpy("NCE_PL_INC");
  // COGS + CII combined (match Excel "(a) Cost of goods sold" single row)
  const cogsCy = pos("NCE_COGS") + pos("NCE_CII");
  const cogsPy = pospy("NCE_COGS") + pospy("NCE_CII");

  return [
    { kind: "header", label: "INCOME" },
    { kind: "item", roman: "I.",   label: "Revenue from operations", noteNo: sn(22, cy["NCE_REV_OPS"], py["NCE_REV_OPS"]), cy: negI("NCE_REV_OPS"),  py: negIpy("NCE_REV_OPS"),  code: "NCE_REV_OPS" },
    { kind: "item", roman: "II.",  label: "Other income",            noteNo: sn(23, cy["NCE_REV_OTH"], py["NCE_REV_OTH"]), cy: negI("NCE_REV_OTH"),  py: negIpy("NCE_REV_OTH"),  code: "NCE_REV_OTH" },
    { kind: "total", roman: "III.", label: "Total Income (I + II)", cy: totalIncomeCy, py: totalIncomePy },
    { kind: "spacer" },
    { kind: "header", roman: "IV.", label: "Expenses" },
    { kind: "item", label: "(a) Cost of goods sold",           noteNo: sn(24, cogsCy, cogsPy),                              cy: cogsCy,               py: cogsPy,                 indent: 1, code: "NCE_COGS" },
    { kind: "item", label: "(b) Employee benefits expense",    noteNo: sn(25, cy["NCE_EMP_EXP"],  py["NCE_EMP_EXP"]),  cy: pos("NCE_EMP_EXP"),  py: pospy("NCE_EMP_EXP"),  indent: 1, code: "NCE_EMP_EXP" },
    { kind: "item", label: "(c) Finance costs",                noteNo: sn(26, cy["NCE_FIN_COST"], py["NCE_FIN_COST"]), cy: pos("NCE_FIN_COST"), py: pospy("NCE_FIN_COST"), indent: 1, code: "NCE_FIN_COST" },
    // Issue 1 — Depreciation note number aligned with PPE (10) — same FA Schedule.
    { kind: "item", label: "(d) Depreciation and amortisation",noteNo: sn(10, cy["NCE_DEPR"],     py["NCE_DEPR"]),     cy: pos("NCE_DEPR"),     py: pospy("NCE_DEPR"),     indent: 1, code: "NCE_DEPR" },
    { kind: "item", label: "(e) Other expenses",               noteNo: sn(28, cy["NCE_OTH_EXP"],  py["NCE_OTH_EXP"]), cy: pos("NCE_OTH_EXP"),  py: pospy("NCE_OTH_EXP"),  indent: 1, code: "NCE_OTH_EXP" },
    { kind: "total", label: "Total Expenses (IV)", cy: pos("NCE_PL_EXP"), py: pospy("NCE_PL_EXP") },
    { kind: "spacer" },
    { kind: "item", roman: "V.",    label: "Profit/(loss) before exceptional items, partners' remuneration and tax", cy: pos("NCE_PROF_V"),   py: pospy("NCE_PROF_V"),   bold: true },
    { kind: "item", roman: "VI.",   label: "Exceptional items",                                                       cy: pos("NCE_EXCEP"),    py: pospy("NCE_EXCEP") },
    { kind: "item", roman: "VII.",  label: "Profit before extraordinary items and tax",                               cy: pos("NCE_PROF_VII"), py: pospy("NCE_PROF_VII"), bold: true },
    { kind: "item", roman: "VIII.", label: "Extraordinary items",                                                     cy: pos("NCE_EXTORD"),   py: pospy("NCE_EXTORD") },
    { kind: "item", roman: "IX.",   label: "Profit before partners' remuneration and tax",                           cy: pos("NCE_PROF_IX"),  py: pospy("NCE_PROF_IX"),  bold: true },
    { kind: "item", roman: "X.",    label: "Partners' remuneration",  noteNo: sn(29, cy["NCE_PART_REM"], py["NCE_PART_REM"]), cy: pos("NCE_PART_REM"), py: pospy("NCE_PART_REM"), code: "NCE_PART_REM" },
    { kind: "item", roman: "XI.",   label: "Profit before tax (IX − X)",                                             cy: pos("NCE_PROF_XI"),  py: pospy("NCE_PROF_XI"),  bold: true },
    { kind: "header", roman: "XII.", label: "Tax expense:" },
    { kind: "item", label: "(1) Current tax",                            cy: pos("NCE_CUR_TAX"),   py: pospy("NCE_CUR_TAX"),   indent: 2, code: "NCE_CUR_TAX" },
    { kind: "item", label: "(2) Short/excess provision for earlier years",cy: pos("NCE_PRIOR_TAX"),py: pospy("NCE_PRIOR_TAX"), indent: 2, code: "NCE_PRIOR_TAX" },
    { kind: "spacer" },
    { kind: "total", roman: "XIII.", label: "Profit / (Loss) for the year (XI − XII)", cy: pos("NCE_NET_PROF"), py: pospy("NCE_NET_PROF") },
  ];
}

interface NCEBalanceSheetViewProps {
  engagementId: string;
  cyAmounts:  Record<string, number>;
  pyAmounts:  Record<string, number>;
  cyYear:     number;
  pyYear:     number;
  entityName: string;
  pyLocked?:  boolean;
  onCommitCY?: (code: string, value: number | null) => void;
  onCommitPY?: (code: string, value: number | null) => void;
  /** Navigate to NCE Notes tab scrolled to a specific note number */
  onNavigateToNote?: (noteNo: number) => void;
  /** Same map passed to NCEDetailedNotes — keeps BS and Notes tab in sync */
  nceDynamicNoteMap?: Map<number, number>;
}

function NCEBalanceSheetView({
  engagementId, cyAmounts, pyAmounts, cyYear, pyYear, entityName,
  pyLocked, onCommitCY, onCommitPY, onNavigateToNote, nceDynamicNoteMap,
}: NCEBalanceSheetViewProps) {

  /**
   * Renders the Note No. cell for an NCE BS row.
   *
   * Display  — sequential note number from nceDynamicNoteMap (same source as
   *             NCEDetailedNotes) so BS column numbers match Notes tab headings.
   * Navigate — passes the original static noteNo to onNavigateToNote so
   *             NCENotesTab can resolve via dynamicNoteMap.
   *
   * Zero-suppression gate: noteNo is null when CY=PY=0 (from sn()), so we
   * show "—" even if the note map has an entry for this row.
   */
  const NoteCell = ({ code, noteNo }: { code?: string | null; noteNo?: number | null }) => {
    const staticRef = code ? NCE_CODE_TO_STATIC_REF[code] : undefined;
    const dynamicNum = (staticRef != null) ? nceDynamicNoteMap?.get(staticRef) : undefined;
    const label = dynamicNum != null ? String(dynamicNum) : undefined;
    if (!label || noteNo == null) {
      return <td className="text-center py-0.5 px-2 text-muted-foreground/40 text-[11px]">—</td>;
    }
    return (
      <td className="text-center py-0.5 px-2">
        {noteNo != null && onNavigateToNote ? (
          <button
            type="button"
            onClick={() => onNavigateToNote(noteNo)}
            className="inline-flex items-center gap-0.5 text-primary hover:underline font-medium text-[11px]"
            title={`Go to Note ${label}`}
          >
            {label}
            <ArrowRight className="h-2.5 w-2.5" />
          </button>
        ) : (
          <span className="text-primary font-medium text-[11px]">{label}</span>
        )}
      </td>
    );
  };

  const rows = buildNCEBSRows(cyAmounts, pyAmounts);
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="text-center border-b bg-muted/30 py-2 px-3">
        <div className="font-bold text-sm">{entityName}</div>
        <div className="text-xs mt-0.5">Balance Sheet as at 31st March, {cyYear}</div>
        <div className="text-[10px] text-muted-foreground italic mt-0.5">(Amount in ₹)</div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-left font-semibold py-2 px-3 w-[55%]">Particulars</th>
            <th className="text-center font-semibold py-2 px-2 w-[8%]">Note No.</th>
            <th className="text-right font-semibold py-2 px-3 w-[18%]">As at<br />31st March, {cyYear}</th>
            <th className="text-right font-semibold py-2 px-3 w-[19%]">
              <span className="inline-flex flex-col items-end gap-0.5">
                <span>As at<br />31st March, {pyYear}</span>
                {pyLocked && <Badge className="text-[8px] px-1 bg-amber-100 text-amber-700 border-amber-300 gap-0.5"><Lock size={7} /> Finalized</Badge>}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.kind === "spacer")  return <tr key={idx}><td colSpan={4} className="h-2" /></tr>;
            if (row.kind === "section") return (
              <tr key={idx} className="bg-muted/20">
                <td colSpan={4} className="font-bold py-1.5 px-3 text-[13px]">{row.label}</td>
              </tr>
            );
            if (row.kind === "subhead") return (
              <tr key={idx}>
                <td className="font-semibold py-1 px-3" style={{ paddingLeft: 12 + (row.indent || 0) * 16 }}>{row.label}</td>
                <td colSpan={3} />
              </tr>
            );
            if (row.kind === "total")   return (
              <tr key={idx} className="border-t-2 border-foreground/40 bg-muted/30">
                <td className="font-bold py-1.5 px-3 uppercase text-[12px]" colSpan={2}>{row.label}</td>
                <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.cy)}</td>
                <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.py)}</td>
              </tr>
            );
            if (row.kind === "footer")  return (
              <tr key={idx}>
                <td className="font-semibold py-1 px-3 text-[11px] italic text-muted-foreground" colSpan={3}>{row.label}</td>
                {row.noteNo != null
                  ? <td className="text-center py-1 px-2 text-primary font-medium text-[11px] italic">{row.noteNo}</td>
                  : <td />}
              </tr>
            );
            // item row
            const indentPx = (row.indent || 0) * 16;
            const editableCY = !!row.code && !!onCommitCY;
            const editablePY = !!row.code && !!onCommitPY && !pyLocked;
            // NCE liabilities stored negative → user enters positive → store negated
            const isLiab = NCE_LIABILITY_CODES.has(row.code ?? "");
            return (
              <tr key={idx} className="hover:bg-muted/10">
                <td className="py-0.5 px-3 text-[11px]" style={{ paddingLeft: 12 + indentPx }}>{row.label}</td>
                <NoteCell code={row.code} noteNo={row.noteNo} />
                <td className="text-right tabular-nums py-0.5 px-1 text-[11px]">
                  {editableCY
                    ? <EditableMoneyCell value={row.cy} onCommit={(v) => onCommitCY!(row.code!, v === null ? null : isLiab ? -v : v)} />
                    : formatINR(row.cy)}
                </td>
                <td className="text-right tabular-nums py-0.5 px-1 text-[11px]">
                  {editablePY
                    ? <EditableMoneyCell value={row.py} onCommit={(v) => onCommitPY!(row.code!, v === null ? null : isLiab ? -v : v)} />
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

interface NCEPLViewProps {
  engagementId: string;
  cyAmounts:  Record<string, number>;
  pyAmounts:  Record<string, number>;
  cyYear:     number;
  pyYear:     number;
  entityName: string;
  pyLocked?:  boolean;
  onCommitCY?: (code: string, value: number | null) => void;
  onCommitPY?: (code: string, value: number | null) => void;
  /** Navigate to NCE Notes tab scrolled to a specific note number */
  onNavigateToNote?: (noteNo: number) => void;
  /** Same map passed to NCEDetailedNotes — keeps P&L and Notes tab in sync */
  nceDynamicNoteMap?: Map<number, number>;
}

function NCEPLView({
  engagementId, cyAmounts, pyAmounts, cyYear, pyYear, entityName,
  pyLocked, onCommitCY, onCommitPY, onNavigateToNote, nceDynamicNoteMap,
}: NCEPLViewProps) {

  /**
   * Renders the Note No. cell for an NCE P&L row.
   * Uses nceDynamicNoteMap (same source as NCEDetailedNotes) so P&L column
   * numbers match the Notes tab headings.
   */
  const NoteCell = ({ code, noteNo }: { code?: string | null; noteNo?: number | null }) => {
    const staticRef  = code ? NCE_CODE_TO_STATIC_REF[code] : undefined;
    const dynamicNum = (staticRef != null) ? nceDynamicNoteMap?.get(staticRef) : undefined;
    const label      = dynamicNum != null ? String(dynamicNum) : undefined;
    if (!label || noteNo == null) {
      return <td className="text-center py-0.5 px-2 text-muted-foreground/40 text-[11px]">—</td>;
    }
    return (
      <td className="text-center py-0.5 px-2">
        {noteNo != null && onNavigateToNote ? (
          <button
            type="button"
            onClick={() => onNavigateToNote(noteNo)}
            className="inline-flex items-center gap-0.5 text-primary hover:underline font-medium text-[11px]"
            title={`Go to Note ${label}`}
          >
            {label}
            <ArrowRight className="h-2.5 w-2.5" />
          </button>
        ) : (
          <span className="text-primary font-medium text-[11px]">{label}</span>
        )}
      </td>
    );
  };

  const rows = buildNCEPLRows(cyAmounts, pyAmounts);
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="text-center border-b bg-muted/30 py-2 px-3">
        <div className="font-bold text-sm">{entityName}</div>
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
                {pyLocked && <Badge className="text-[8px] px-1 bg-amber-100 text-amber-700 border-amber-300 gap-0.5"><Lock size={7} /> Finalized</Badge>}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.kind === "spacer") return <tr key={idx}><td colSpan={5} className="h-2" /></tr>;
            if (row.kind === "header") return (
              <tr key={idx} className="bg-muted/20">
                <td className="text-center font-bold py-1 px-1 text-[12px]">{row.roman || ""}</td>
                <td colSpan={4} className="font-bold py-1 px-3 text-[12px]">{row.label}</td>
              </tr>
            );
            if (row.kind === "total")  return (
              <tr key={idx} className="border-t-2 border-foreground/40 bg-muted/30">
                <td className="text-center font-bold py-1.5 px-1 text-[12px]">{row.roman || ""}</td>
                <td className="font-bold py-1.5 px-3 text-[12px]">{row.label}</td>
                <td />
                <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.cy)}</td>
                <td className="text-right font-bold tabular-nums py-1.5 px-3">{formatINR(row.py)}</td>
              </tr>
            );
            // item row
            const indentPx = (row.indent || 0) * 16;
            const boldCls = row.bold ? "font-bold" : "";
            const editableCY = !!row.code && !!onCommitCY;
            const editablePY = !!row.code && !!onCommitPY && !pyLocked;
            const isInc = NCE_INCOME_CODES.has(row.code ?? "");
            return (
              <tr key={idx} className="hover:bg-muted/10">
                <td className={`text-center py-0.5 px-1 ${boldCls} text-[11px]`}>{row.roman || ""}</td>
                <td className={`py-0.5 px-3 ${boldCls} text-[11px]`} style={{ paddingLeft: 12 + indentPx }}>{row.label}</td>
                <NoteCell code={row.code} noteNo={row.noteNo} />
                <td className={`text-right tabular-nums py-0.5 px-1 ${boldCls} text-[11px]`}>
                  {editableCY
                    ? <EditableMoneyCell value={row.cy ?? 0} onCommit={(v) => onCommitCY!(row.code!, v === null ? null : isInc ? -v : v)} />
                    : (row.cy === undefined ? "" : formatINR(row.cy))}
                </td>
                <td className={`text-right tabular-nums py-0.5 px-1 ${boldCls} text-[11px]`}>
                  {editablePY
                    ? <EditableMoneyCell value={row.py ?? 0} onCommit={(v) => onCommitPY!(row.code!, v === null ? null : isInc ? -v : v)} />
                    : (row.py === undefined ? "" : formatINR(row.py))}
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
                  <td className={`text-right tabular-nums py-0.5 px-3 ${boldCls} ${fontSize}`}>
                    {editable
                      ? <EditableMoneyCell value={row.cy ?? 0} onCommit={(v) => onCommit!(row.rowKey!, "cy", v)} />
                      : (row.cy === undefined ? "" : formatINR(row.cy))}
                  </td>
                  <td className={`text-right tabular-nums py-0.5 px-3 ${boldCls} ${fontSize}`}>
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
  // Cash-Flow Statement applicability — driven by Stage 1 questionnaire answer
  // ("Does the company prepare Cash Flow Statement?"). When set to "no", the
  // Cash Flow tab is hidden in the Financial Statements view. Default = true.
  const cfApplicable: boolean =
    (engagement?.questionnaire_answers as any)?.cash_flow_applicable !== "no";

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

  // ─── Active tab (controlled so navigator buttons can switch programmatically) ─
  const [activeTab, setActiveTab] = useState("bs");

  // ─── Notes mismatch count (driven by NotesMismatchPanel callback) ─────────
  const [mismatchCount, setMismatchCount] = useState(0);

  // ─── NCE note navigation state ────────────────────────────────────────────
  const [nceNavNote, setNceNavNote] = useState<number | null>(null);

  // ─── Corporate note navigation state ─────────────────────────────────────
  const [corpNavNote, setCorpNavNote] = useState<{
    noteNo: number;
    subTab: "bs_liab" | "bs_asset" | "pl" | "fa";
  } | null>(null);

  // ─── NCE Signature block editable state ──────────────────────────────────
  const [sigSignatoryName, setSigSignatoryName] = useState("");
  const [sigPlace,         setSigPlace]         = useState("");
  const [sigDate,          setSigDate]           = useState(() => new Date().toISOString().split("T")[0]);

  // Phase 8 / UI-6 — Stage 5 Notes implementation now lives in
  // src/components/stage5/NotesTab.tsx + the notesAutoPopulate service.
  // The TabsContent for "notes" below renders <NotesTab /> which owns its
  // own state, fetch, save, auto-populate, and 4 sub-tab structure.

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
      // Exclude PY shells — they have no fa_financial_statements rows.
      // Also use .limit(1) to prevent maybeSingle() error when both a regular
      // engagement and a PY shell exist for the same client + FY.
      const { data: prevEng } = await (supabase.from as any)("audit_engagements")
        .select("id")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .or("is_py_shell.is.null,is_py_shell.eq.false")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!prevEng) return null;
      const { data: prevFs } = await supabase
        .from("fa_financial_statements")
        .select("line_item_code, amount_cy")
        .eq("engagement_id", (prevEng as any).id);
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
      const { data } = await (supabase.from as any)("audit_engagements")
        .select("is_finalized")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .or("is_py_shell.is.null,is_py_shell.eq.false")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return !!(data as any)?.is_finalized;
    },
    enabled: !!engagement?.client_id && !!engagement?.financial_year,
  });

  // ─── PY Shell engagement ID (for navigation back to it) ─────────────────
  // Runs only when py_source === "py_shell" so the user can always navigate
  // back to the shell's Tally Sync even after leaving the shell page.
  // When multiple PY shells exist for the same FY (e.g. one auto-created by
  // sync-py.js and one by "Setup PY Data"), prefer the one that has actual
  // tally_trial_balance rows — it is the authoritative PY shell.
  const { data: pyShellInfo } = useQuery({
    queryKey: ["py-shell-id", engagement?.client_id, engagement?.financial_year],
    queryFn: async (): Promise<{ id: string | null; isShell: boolean }> => {
      const fyParts = (engagement.financial_year as string).split("-");
      if (fyParts.length !== 2) return { id: null, isShell: false };
      const prevFy = `${parseInt(fyParts[0]) - 1}-${String(parseInt(fyParts[0])).slice(-2)}`;

      // Step 1: fetch all is_py_shell=true engagements for FY-1
      const { data: shells } = await (supabase.from as any)("audit_engagements")
        .select("id")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .eq("is_py_shell", true);

      if (shells && shells.length > 0) {
        // Prefer the PY shell that has tally_trial_balance rows (TB synced).
        for (const shell of shells as any[]) {
          const { data: probe } = await supabase
            .from("tally_trial_balance")
            .select("ledger_name")
            .eq("engagement_id", shell.id)
            .limit(1);
          if (probe && probe.length > 0) return { id: shell.id, isShell: true };
        }
        // No shell has TB data yet — return first shell so navigation works
        return { id: (shells[0] as any).id, isShell: true };
      }

      // Step 2: Fallback — any FY-1 engagement (no PY shell exists)
      const { data: anyEngs } = await (supabase.from as any)("audit_engagements")
        .select("id")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .limit(1);
      return { id: (anyEngs as any)?.[0]?.id ?? null, isShell: false };
    },
    // Enabled whenever we have a client + FY. We previously gated this on
    // py_source === "py_shell", which meant clients whose PY shell was created
    // by sync-py.js (without ever running "Setup PY Data" on the CY engagement)
    // never got the navigation banner. The query itself only returns an id when
    // an is_py_shell=true (or any FY-1) engagement exists, so it's safe to run.
    enabled: !!engagement?.client_id && !!engagement?.financial_year && !(engagement as any)?.is_py_shell,
  });

  // ─── PY Shell Trial Balance (for PY Changes in Inventories) ─────────────
  // When INV_* ledgers are mapped we need the PY shell's TB to compute the
  // prior-year P&L line "Changes in Inventories" as:
  //   Σ (PY Shell opening_balance − PY Shell closing_balance) for each
  //   ledger name that maps to an INV_* code in the current year.
  // Also used for the mismatch warning: CY opening ≠ PY Shell closing.
  const pyShellId = pyShellInfo?.isShell ? pyShellInfo.id : null;
  const { data: pyShellTb } = useQuery({
    queryKey: ["py-shell-tb", pyShellId],
    queryFn: async () => {
      if (!pyShellId) return [] as any[];
      const PAGE = 500;
      const rows: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("tally_trial_balance")
          .select("ledger_name, opening_balance, opening_type, closing_balance, balance_type")
          .eq("engagement_id", pyShellId)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      return rows;
    },
    enabled: !!pyShellId,
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

  // ── Phase E — Stage 5 notes as source of truth for BS/PL amounts ──────────────
  // Loaded once at render time so fsDisplayData can substitute notes breakup sums
  // for raw TB sums. Refreshes whenever stage5_notes is written (auto-populate
  // or user edit), keeping the BS/PL face in sync with the Notes section.
  // Bug 5 — Phase E now applies to NCE entities too.  Removing the
  // !isNonCorporate guard lets NCE Capital Account / Owners' notes drive
  // the BS the same way Reserves drives BS for corporates.  ncyOf/npyOf
  // already work for any section/key combination — they just look up
  // sumNotesSubRowsCY/PY, which is entity-agnostic.
  const { data: stage5NotesData } = useQuery<Stage5Notes | null>({
    queryKey: ["stage5-notes-fsdata", engagementId],
    queryFn: async () => {
      const { data } = await (supabase.from as any)("audit_engagements")
        .select("stage5_notes")
        .eq("id", engagementId)
        .maybeSingle();
      return (data as any)?.stage5_notes as Stage5Notes ?? null;
    },
    staleTime: 30_000,
    enabled: !!engagementId,
  });

  // ─── Bug 11 — BS override → optionally sync note breakup ──────────────────────
  // After a BS cell is manually overridden, if the corresponding note already
  // has a populated breakup, ask the auditor whether to add an "Adjustment per
  // BS override" row so the Notes reconcile.  Otherwise the mismatch panel
  // would warn and the auditor would have to fix it manually.
  //
  // Section/key resolution uses FS_CODE_TO_NOTE_KEY (corporate) or
  // NCE_CODE_TO_NOTE_KEY + NCE_CODE_TO_SECTION (NCE).  The diff is computed
  // against the existing breakup sum and stored as a positive amount on a new
  // manual row tagged with a system reason.
  async function maybePromptSyncNote(code: string, newDisplayValue: number) {
    // Resolve section + key
    let section: "bs_liab" | "bs_asset" | "pl" | undefined;
    let key: string | undefined;
    if (FS_CODE_TO_NOTE_KEY[code]) {
      key = FS_CODE_TO_NOTE_KEY[code];
      section = (FS_CODE_TO_NOTES_SUBTAB[code] as any) === "bs_liab" ? "bs_liab"
              : (FS_CODE_TO_NOTES_SUBTAB[code] as any) === "bs_asset" ? "bs_asset"
              : (FS_CODE_TO_NOTES_SUBTAB[code] as any) === "pl" ? "pl" : undefined;
    } else if (NCE_CODE_TO_NOTE_KEY[code]) {
      key = NCE_CODE_TO_NOTE_KEY[code];
      section = NCE_CODE_TO_SECTION[code];
    }
    if (!key || !section) return;

    // Fetch the latest stage5_notes (cached query may be stale)
    const { data: row } = await (supabase.from as any)("audit_engagements")
      .select("stage5_notes")
      .eq("id", engagementId)
      .maybeSingle();
    const notes = (row?.stage5_notes ?? null) as Stage5Notes | null;
    if (!notes) return;

    const noteRow = (notes[section] as Record<string, any> | undefined)?.[key];
    if (!noteRow) return;
    const breakup: any[] = Array.isArray(noteRow.breakup) ? noteRow.breakup : [];
    const populated = breakup.filter(r => r != null && r.amount_cy != null && r.amount_cy !== "");
    if (populated.length === 0) return;
    const currentSum = populated.reduce((s: number, r: any) => {
      const n = Number(r.amount_cy);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    const target = Math.abs(newDisplayValue);
    const diff = target - currentSum;
    if (Math.abs(diff) < 1) return;

    const proceed = window.confirm(
      `You changed this BS line to ₹${target.toLocaleString("en-IN")}.\n` +
      `The Note breakup currently sums to ₹${currentSum.toLocaleString("en-IN")}.\n\n` +
      `OK   = Sync note (add an "Adjustment per BS override" row of ₹${diff.toLocaleString("en-IN")})\n` +
      `Cancel = Keep notes unchanged (mismatch panel will flag the difference)`,
    );
    if (!proceed) return;

    // Append adjustment row
    const dateStr = new Date().toISOString().slice(0, 10);
    const newBreakup = [
      ...breakup,
      {
        id: `bs_override_${Date.now()}`,
        description:    "Adjustment per BS override",
        amount_cy:      diff,
        amount_py:      0,
        source:         "manual",
        override_reason: `Auto-added to reconcile BS override on ${dateStr}`,
      },
    ];
    const next = {
      ...notes,
      [section]: {
        ...(notes[section] as any),
        [key]: { ...noteRow, breakup: newBreakup },
      },
    };
    const { error } = await (supabase.from as any)("audit_engagements")
      .update({ stage5_notes: next })
      .eq("id", engagementId);
    if (error) {
      toast.error("Failed to sync note: " + error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["stage5-notes-fsdata", engagementId] });
    toast.success("Note breakup synced — adjustment row added");
  }

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
  // Applies backward-compat migration: pre-Phase-9 entries that mapped directly
  // to BS_CA_INV (now a parent node) are rewritten to INV_STOCK so that
  // computeTotal does not overwrite the accumulated inventory balance with 0.
  const coaMapping: Record<string, { code: string }> = useMemo(() => {
    if (engagement?.coa_mapping && typeof engagement.coa_mapping === "object") {
      const raw = engagement.coa_mapping as Record<string, any>;
      let needsMigration = false;
      for (const v of Object.values(raw)) {
        if ((v as any)?.code === "BS_CA_INV") { needsMigration = true; break; }
      }
      if (!needsMigration) return raw as any;
      const patched: Record<string, any> = {};
      for (const [k, v] of Object.entries(raw)) {
        patched[k] = (v as any)?.code === "BS_CA_INV"
          ? { ...(v as any), code: "INV_STOCK", scheduleRef: "BS+P&L" }
          : v;
      }
      return patched;
    }
    return {};
  }, [engagement?.coa_mapping]);

  // ─── PY Shell TB helpers for inventory dual-posting ───────────────────────

  // Build a fast lookup map from the PY Shell TB: ledger_name → { opening, closing }
  const pyShellTbMap = useMemo((): Map<string, { opening: number; closing: number }> => {
    const m = new Map<string, { opening: number; closing: number }>();
    if (!pyShellTb?.length) return m;
    for (const row of pyShellTb) {
      const name = String(row.ledger_name || "").trim();
      if (!name) continue;
      const cb   = Math.abs(Number(row.closing_balance ?? 0));
      const isDr = String(row.balance_type ?? "").toUpperCase() === "DR";
      const ob   = Math.abs(Number(row.opening_balance ?? 0)) *
                   (String(row.opening_type ?? "").toUpperCase() === "CR" ? -1 : 1);
      m.set(name, { opening: ob, closing: isDr ? cb : -cb });
    }
    return m;
  }, [pyShellTb]);

  // PY Changes in Inventories: computed from PY Shell TB for INV_* mapped ledgers.
  // Returns null when no PY Shell TB is available (fall back to prior engagement).
  const pyInvCII = useMemo((): number | null => {
    if (!pyShellTbMap.size) return null;
    let hasInv = false;
    let total = 0;
    for (const acct of tbAccounts) {
      const mapping = coaMapping[acct.account_name];
      if (!mapping || !INV_CODES.has(mapping.code)) continue;
      hasInv = true;
      const pyRow = pyShellTbMap.get(acct.account_name);
      if (!pyRow) continue;
      total += pyRow.opening - pyRow.closing;
    }
    return hasInv ? total : null;
  }, [pyShellTbMap, tbAccounts, coaMapping]);

  // Inventory mismatch: CY opening_balance ≠ PY Shell closing_balance per ledger.
  // Surfaced as a warning banner when any discrepancy > ₹1 exists.
  const invMismatchLedgers = useMemo((): { ledger: string; cyOpening: number; pyClosing: number }[] => {
    if (!pyShellTbMap.size) return [];
    const result: { ledger: string; cyOpening: number; pyClosing: number }[] = [];
    for (const acct of tbAccounts) {
      const mapping = coaMapping[acct.account_name];
      if (!mapping || !INV_CODES.has(mapping.code)) continue;
      const pyRow = pyShellTbMap.get(acct.account_name);
      if (!pyRow) continue;
      if (Math.abs(acct.opening_balance - pyRow.closing) > 1) {
        result.push({ ledger: acct.account_name, cyOpening: acct.opening_balance, pyClosing: pyRow.closing });
      }
    }
    return result;
  }, [pyShellTbMap, tbAccounts, coaMapping]);

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

  // ─── PY sync-done flag: correct data source per py_source mode ───────────
  // When py_source === "py_shell", PY data comes from tally_trial_balance
  // (pyShellTb) — NOT from fa_financial_statements (priorEngagement).
  // Using noPriorEngagement here was wrong: it always showed "sync pending"
  // even after a successful PY shell sync, because fa_financial_statements
  // has no rows until the user explicitly saves the FS.
  // For all other py_source modes ("manual", "none", or prior-year FS), keep
  // using priorEngagement (fa_financial_statements) as the source of truth.
  const pyShellSyncDone: boolean =
    (engagement as any)?.py_source === "py_shell"
      ? (pyShellTb?.length ?? 0) > 0
      : !noPriorEngagement;

  // ─── COA Mapping gate for "Fetch PY from FY-1 Tally" ────────────────────
  // PY comparative figures depend on COA mapping being complete. If unmapped
  // ledgers exist the fetch silently skips them and produces incomplete PY
  // P&L figures. Require stage_statuses["3"] === "complete" (or pipeline
  // already past stage 3) before enabling the Fetch button.
  const coaMappingComplete: boolean =
    (engagement?.stage_statuses as any)?.["3"] === "complete" ||
    (engagement?.pipeline_stage ?? 0) > 3;

  // The Fetch button requires BOTH: PY data synced AND COA mapping done.
  const fetchPyEnabled: boolean = pyShellSyncDone && coaMappingComplete;

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
    let hasInvMapping = false;

    // Aggregate TB accounts → FS line items via COA mapping
    for (const acct of tbAccounts) {
      const mapping = coaMapping[acct.account_name];
      if (!mapping) continue;
      const plCode = INV_DUAL_MAP[mapping.code];
      if (plCode) {
        // ── Dual-post: BS closing balance + P&L Changes in Inventories ──
        amounts[mapping.code] = (amounts[mapping.code] || 0) + acct.balance;
        amounts[plCode] = (amounts[plCode] || 0) + ((acct.opening_balance ?? 0) - acct.balance);
        hasInvMapping = true;
      } else if (isTallyPLAccount(acct.account_name) && mapping.code.startsWith("BS_")) {
        // ── P&L A/c on Balance Sheet: use OPENING balance (prior retained earnings) ──
        // Current-year profit is auto-credited to BS_EQ_RS after computeTotal (below).
        amounts[mapping.code] = (amounts[mapping.code] || 0) + (acct.opening_balance ?? 0);
      } else {
        amounts[mapping.code] = (amounts[mapping.code] || 0) + acct.balance;
      }
    }

    // Apply manual overrides — CII codes are auto-computed but CAN be overridden
    // when the TB opening_balance differs from Tally's P&L opening stock valuation
    for (const [code, override] of Object.entries(manualOverrides)) {
      amounts[code] = override.amount; // manual override always wins
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
      // Income is stored as NEGATIVE (credit balance from Tally), so negate it:
      // Profit = Revenue − Expenses  →  -nceInc (positive) − nceExp (positive)
      amounts["NCE_PROF_V"]   = Math.round((-nceInc - nceExp) * 100) / 100;
      amounts["NCE_PROF_VII"] = Math.round((amounts["NCE_PROF_V"]   - (amounts["NCE_EXCEP"]    || 0)) * 100) / 100;
      amounts["NCE_PROF_IX"]  = Math.round((amounts["NCE_PROF_VII"] - (amounts["NCE_EXTORD"]   || 0)) * 100) / 100;
      amounts["NCE_PROF_XI"]  = Math.round((amounts["NCE_PROF_IX"]  - (amounts["NCE_PART_REM"] || 0)) * 100) / 100;
      // NCE_TAX was already summed by computeTotal (NCE_CUR_TAX + NCE_PRIOR_TAX)
      amounts["NCE_NET_PROF"] = Math.round((amounts["NCE_PROF_XI"]  - (amounts["NCE_TAX"]      || 0)) * 100) / 100;
    }

    // ── Auto-flow net P&L to BS_EQ_RS for corporate entities ─────────────────
    // Revenue (PL_REV, credit = negative) and Expenses (PL_EXP, debit = positive)
    // are in P&L codes, not in the BS.  The current-year net profit must be
    // credited to Reserves & Surplus so the Balance Sheet balances.
    // This mirrors the standard closing entry: Dr P&L A/c → Cr Reserves & Surplus.
    // Note: if the user has set a manual override on BS_EQ_RS, this still applies
    // on top — net profit is a required accounting transfer, not an optional entry.
    if (!isNonCorporate) {
      const rev   = amounts["PL_REV"] || 0; // negative (credit)
      const exp   = amounts["PL_EXP"] || 0; // positive (debit)
      const netPL = Math.round((-rev - exp) * 100) / 100;
      if (Math.abs(netPL) > 0.005) {
        // Credit net profit to Reserves (negative = credit in Tally sign convention)
        amounts["BS_EQ_RS"] = (amounts["BS_EQ_RS"] || 0) - netPL;
        // Re-run the full tree so every parent (BS_EQ → BS root) picks up the change.
        // Calling only computeTotal(bsEqNode) leaves the BS root total stale.
        for (const item of (activeTree as FSLineItem[])) {
          computeTotal(item);
        }
      }
    }

    return amounts;
  }, [tbAccounts, coaMapping, manualOverrides, isNonCorporate]);

  // True when at least one TB ledger is mapped to any dual-posting inventory code.
  // Used to lock the corresponding P&L code from manual overrides.
  const hasInvMapping = useMemo(
    () => tbAccounts.some(a => INV_CODES.has(coaMapping[a.account_name]?.code)),
    [tbAccounts, coaMapping],
  );

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
  // PL_EXP_CII: when INV_* are mapped, injected from PY Shell TB (pyInvCII). This takes
  // priority over both pyAmounts and pyManualAmounts since it is the authoritative source.
  const mergedPY: Record<string, number> = useMemo(() => {
    const merged: Record<string, number> = { ...pyAmounts };

    // ── Fold in pyManualAmounts (from "Fetch PY from FY-1 Tally" button) ───
    // ALWAYS apply for P&L items, regardless of noPriorEngagement.
    //
    // Root cause fix: previously pyManualAmounts was gated on noPriorEngagement.
    // When the PY shell has ANY rows in fa_financial_statements (even if partial),
    // noPriorEngagement = false and the Fetch button's data was completely ignored —
    // causing PY = "—" for expenses even after clicking Fetch.
    //
    // The Fetch button is an explicit user action that sources data directly from
    // Tally via the PY shell's coa_mapping. It should always win for P&L codes.
    // BS codes continue to come from computedAmountsPY (opening balances) below.
    for (const [code, val] of Object.entries(pyManualAmounts)) {
      if (!Number.isFinite(val)) continue;
      const item = activeFlatItems.find(i => i.code === code);
      const sec  = String(item?.section || "").toLowerCase();
      const isPL = sec.includes("pl") || sec.includes("revenue") || sec.includes("expense");
      if (isPL) {
        // Tally-fetched P&L amounts always take precedence
        merged[code] = val;
      } else if (noPriorEngagement && (merged[code] === undefined || merged[code] === null)) {
        // Non-P&L (edge case): only fill if no prior engagement and code not set
        merged[code] = val;
      }
    }
    for (const [code, val] of Object.entries(computedAmountsPY)) {
      // Section lookup via flat items
      const item = activeFlatItems.find(i => i.code === code);
      const sec  = String(item?.section || "").toLowerCase();
      const isBS = sec.includes("bs") || sec.includes("asset") || sec.includes("liab") || sec.includes("equity");
      if (isBS && Math.abs(val) > 0.005) merged[code] = val;
    }
    // ── PY Changes in Inventories: inject from PY Shell TB when available ──
    // pyInvCII !== null means inventory codes are mapped AND PY Shell TB was loaded.
    if (pyInvCII !== null) {
      // Corporate: PL_EXP_CII | NCE: NCE_CII — write to whichever is applicable
      const hasCorporateInv = tbAccounts.some(a => {
        const code = coaMapping[a.account_name]?.code;
        return code && INV_DUAL_MAP[code] === "PL_EXP_CII";
      });
      merged[hasCorporateInv ? "PL_EXP_CII" : "NCE_CII"] = pyInvCII;
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
  }, [computedAmountsPY, pyAmounts, pyManualAmounts, noPriorEngagement, activeFlatItems, activeTree, pyInvCII]);

  // ─── NCE Dynamic Note Number Map ────────────────────────────────────────────
  // Maps originalNoteRef → dynamicSequentialNoteNo for NCE entities.
  // Only notes with non-zero CY or PY FS amounts (plus always-active notes 1,2,10)
  // get a dynamic number. Inactive notes return undefined → suppressed in display.
  const nceDynamicNoteMap = useMemo(
    () => computeNceDynamicNoteMap(computedAmounts, mergedPY),
    [computedAmounts, mergedPY],
  );

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
    let hasInvMappingLocal = false;
    for (const acct of tbAccounts) {
      const mapping = coaMapping[acct.account_name];
      if (!mapping) continue;
      const opening = acct.opening_balance ?? 0;
      const plCode = INV_DUAL_MAP[mapping.code];
      if (plCode) {
        // Dual-post CY: BS closing balance + P&L Changes in Inventories
        exportCy[mapping.code] = (exportCy[mapping.code] || 0) + (acct.balance || 0);
        exportCy[plCode] = (exportCy[plCode] || 0) + (opening - (acct.balance || 0));
        // PY BS: opening balance (prior year closing)
        if (opening) exportPy[mapping.code] = (exportPy[mapping.code] || 0) + opening;
        hasInvMappingLocal = true;
      } else {
        exportCy[mapping.code] = (exportCy[mapping.code] || 0) + (acct.balance || 0);
        if (opening) exportPy[mapping.code] = (exportPy[mapping.code] || 0) + opening;
      }
    }
    for (const [code, override] of Object.entries(manualOverrides)) {
      // Manual override always wins — including CII codes (user may correct opening stock)
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
    // Always apply pyManualAmounts for P&L codes (same fix as mergedPY above).
    for (const [code, val] of Object.entries(pyManualAmounts || {})) {
      if (!Number.isFinite(val)) continue;
      const item = activeFlatItems.find(i => i.code === code);
      const sec  = String(item?.section || "").toLowerCase();
      const isPL = sec.includes("pl") || sec.includes("revenue") || sec.includes("expense");
      if (isPL) {
        exportPy[code] = val;
      } else if (noPriorEngagement && (exportPy[code] === undefined || exportPy[code] === 0)) {
        exportPy[code] = val;
      }
    }
    // PY Changes in Inventories: override with PY Shell TB when INV_* are mapped
    if (pyInvCII !== null) {
      exportPy["PL_EXP_CII"] = pyInvCII;
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
        // Income stored as negative (Tally credit) — negate to get the real revenue
        table["NCE_PROF_V"]   = Math.round((-inc - exp) * 100) / 100;
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

    // ── Phase E: Notes-aware amount helpers ────────────────────────────────────
    // When the auditor has populated note sub-rows (via auto-populate or manual
    // edit), we use the SUM of those sub-rows as the BS/PL face amount instead of
    // the raw TB sum.  Falls back to cyOf/pyOf (raw TB) when the note is empty.
    //
    // Bug 4 — Sign-convention bridge:
    //   cyOf/pyOf return values in TALLY SIGN CONVENTION:
    //     • DR ledgers (assets, expenses)  → POSITIVE
    //     • CR ledgers (liabilities, equity, revenue) → NEGATIVE
    //   Downstream code (negL, negI, totalELDisplay, computeTotal sums) expects
    //   that convention.  But notes breakups are user-entered POSITIVE figures.
    //   Without a sign bridge, ncyOf("bs_liab", ...) returns POSITIVE while the
    //   downstream consumers double-flip and the BS total goes negative.
    //   Solution: when the FS code belongs to a credit-side group (liability /
    //   equity / revenue), negate the notes sum so the value matches Tally
    //   convention before reaching consumers.
    const isCreditSideCode = (code: string): boolean =>
      BS_LIABILITY_CODES.has(code) || PL_REVENUE_CODES.has(code);

    const ncyOf = (
      section: "bs_liab" | "bs_asset" | "pl",
      key:     string,
      fsCode:  string,
    ): number => {
      const notesSum = sumNotesSubRowsCY(stage5NotesData ?? null, section, key);
      if (notesSum == null) return cyOf(fsCode);
      return isCreditSideCode(fsCode) ? -notesSum : notesSum;
    };

    const npyOf = (
      section: "bs_liab" | "bs_asset" | "pl",
      key:     string,
      fsCode:  string,
    ): number => {
      const notesSum = sumNotesSubRowsPY(stage5NotesData ?? null, section, key);
      if (notesSum == null) return pyOf(fsCode);
      return isCreditSideCode(fsCode) ? -notesSum : notesSum;
    };

    // Typed BS/PL/CFS tables — corporate only. Non-corporate returns null
    // for all three; NCE tabs continue to render via their own legacy path.
    let bs: BSRowData | null = null;
    let pl: PLRowData | null = null;
    let cfs: CFSRowData | null = null;
    if (!isNonCorporate) {
      // Dynamic note registry — same logic as the in-UI NoteCell display so
      // that Excel export note numbers always match what the user sees on screen.
      const dynReg = buildDynamicRegistry(
        computedAmounts,
        mergedPY,
        coaMapping as Record<string, { code: string }>,
        false,
        false, // skip COA signal — use real amounts only (prevents gap from zero-balance mapped ledgers)
      );
      const dn = (key: string): number | null => dynReg.get(key) ?? null;

      bs = {
        // Phase E: use notes breakup sub-row sums where populated; TB sum otherwise.
        // PPE (ppe) uses the FA grid (not a standard breakup array) — keep raw TB.
        shareCap:        { noteNo: dn("share_capital"),        cy: ncyOf("bs_liab","share_capital","BS_EQ_SC"),              py: npyOf("bs_liab","share_capital","BS_EQ_SC")              },
        reserves:        { noteNo: dn("reserves_surplus"),     cy: ncyOf("bs_liab","reserves_surplus","BS_EQ_RS"),            py: npyOf("bs_liab","reserves_surplus","BS_EQ_RS")            },
        ltBorrowings:    { noteNo: dn("lt_borrowings"),        cy: ncyOf("bs_liab","lt_borrowings","BS_NCL_LTB"),             py: npyOf("bs_liab","lt_borrowings","BS_NCL_LTB")             },
        dtLiab:          { noteNo: dn("deferred_tax_liab"),    cy: ncyOf("bs_liab","deferred_tax_liab","BS_NCL_DTL"),         py: npyOf("bs_liab","deferred_tax_liab","BS_NCL_DTL")         },
        otherLtLiab:     { noteNo: dn("other_lt_liab"),        cy: ncyOf("bs_liab","other_lt_liab","BS_NCL_OLT"),             py: npyOf("bs_liab","other_lt_liab","BS_NCL_OLT")             },
        ltProvisions:    { noteNo: dn("lt_provisions"),        cy: ncyOf("bs_liab","lt_provisions","BS_NCL_LTP"),             py: npyOf("bs_liab","lt_provisions","BS_NCL_LTP")             },
        stBorrowings:    { noteNo: dn("st_borrowings"),        cy: ncyOf("bs_liab","st_borrowings","BS_CL_STB"),              py: npyOf("bs_liab","st_borrowings","BS_CL_STB")              },
        tradePayables:   { noteNo: dn("trade_payables") },
        tradePayMSME:    { cy: 0, py: 0 },  // ageing MSME split kept at 0; full TP total below
        tradePayOthers:  { cy: ncyOf("bs_liab","trade_payables","BS_CL_TP"),       py: npyOf("bs_liab","trade_payables","BS_CL_TP")       },
        otherCurrLiab:   { noteNo: dn("other_current_liab"),   cy: ncyOf("bs_liab","other_current_liab","BS_CL_OCL"),         py: npyOf("bs_liab","other_current_liab","BS_CL_OCL")         },
        stProvisions:    { noteNo: dn("st_provisions"),        cy: ncyOf("bs_liab","st_provisions","BS_CL_STP"),              py: npyOf("bs_liab","st_provisions","BS_CL_STP")              },
        // Bug 6 — PPE prefers FA grid Net Block total over raw TB.
        // Falls back to cyOf/pyOf("BS_NCA_FA") when the FA grid has no rows.
        ppe:             { noteNo: dn("ppe"),                  cy: getFAGridNetBlockTotal(stage5NotesData ?? null, "cy") ?? cyOf("BS_NCA_FA"),  py: getFAGridNetBlockTotal(stage5NotesData ?? null, "py") ?? pyOf("BS_NCA_FA") },
        ncInvestments:   { noteNo: dn("nc_investments"),       cy: ncyOf("bs_asset","nc_investments","BS_NCA_INV"),           py: npyOf("bs_asset","nc_investments","BS_NCA_INV")           },
        dtAssets:        { noteNo: dn("deferred_tax_assets"),  cy: ncyOf("bs_asset","deferred_tax_assets","BS_NCA_DTA"),      py: npyOf("bs_asset","deferred_tax_assets","BS_NCA_DTA")      },
        ltLoans:         { noteNo: dn("lt_loans_advances"),    cy: ncyOf("bs_asset","lt_loans_advances","BS_NCA_LLA"),        py: npyOf("bs_asset","lt_loans_advances","BS_NCA_LLA")        },
        otherNcAssets:   { noteNo: dn("other_nc_assets"),      cy: ncyOf("bs_asset","other_nc_assets","BS_NCA_ONA"),          py: npyOf("bs_asset","other_nc_assets","BS_NCA_ONA")          },
        currInvestments: { noteNo: dn("current_investments"),  cy: ncyOf("bs_asset","current_investments","BS_CA_CI"),        py: npyOf("bs_asset","current_investments","BS_CA_CI")        },
        inventories:     { noteNo: dn("inventories"),          cy: ncyOf("bs_asset","inventories","BS_CA_INV"),               py: npyOf("bs_asset","inventories","BS_CA_INV")               },
        tradeRec:        { noteNo: dn("trade_receivables"),    cy: ncyOf("bs_asset","trade_receivables","BS_CA_TR"),          py: npyOf("bs_asset","trade_receivables","BS_CA_TR")          },
        cashBank:        { noteNo: dn("cash_bank"),            cy: ncyOf("bs_asset","cash_bank","BS_CA_CCE"),                 py: npyOf("bs_asset","cash_bank","BS_CA_CCE")                 },
        stLoans:         { noteNo: dn("st_loans_advances"),    cy: ncyOf("bs_asset","st_loans_advances","BS_CA_SLA"),         py: npyOf("bs_asset","st_loans_advances","BS_CA_SLA")         },
        otherCurrAssets: { noteNo: dn("other_current_assets"), cy: ncyOf("bs_asset","other_current_assets","BS_CA_OCA"),      py: npyOf("bs_asset","other_current_assets","BS_CA_OCA")      },
        sigPolicies:     { noteNo: 1 }, // Accounting Policies — always Note 1
      };
      // P&L — also notes-aware; pbt recomputed from notes-adjusted rev/exp totals
      const expCy = ncyOf("pl","cost_materials","PL_EXP_MAT")      + ncyOf("pl","purchases_stock","PL_EXP_SIT")
                  + ncyOf("pl","changes_inventories","PL_EXP_CII")  + ncyOf("pl","employee_benefits","PL_EXP_EMP")
                  + ncyOf("pl","finance_costs","PL_EXP_FIN")        + ncyOf("pl","depreciation","PL_EXP_DEP")
                  + ncyOf("pl","other_expenses","PL_EXP_OTH");
      const expPy = npyOf("pl","cost_materials","PL_EXP_MAT")      + npyOf("pl","purchases_stock","PL_EXP_SIT")
                  + npyOf("pl","changes_inventories","PL_EXP_CII")  + npyOf("pl","employee_benefits","PL_EXP_EMP")
                  + npyOf("pl","finance_costs","PL_EXP_FIN")        + npyOf("pl","depreciation","PL_EXP_DEP")
                  + npyOf("pl","other_expenses","PL_EXP_OTH");
      const revCy = ncyOf("pl","revenue_from_ops","PL_REV_OPS") + ncyOf("pl","other_income","PL_REV_OI");
      const revPy = npyOf("pl","revenue_from_ops","PL_REV_OPS") + npyOf("pl","other_income","PL_REV_OI");
      const excCy = cyOf("PL_EI");
      const excPy = pyOf("PL_EI");
      pl = {
        revFromOps:         { noteNo: dn("revenue_from_ops"),   cy: ncyOf("pl","revenue_from_ops","PL_REV_OPS"),   py: npyOf("pl","revenue_from_ops","PL_REV_OPS")   },
        otherIncome:        { noteNo: dn("other_income"),        cy: ncyOf("pl","other_income","PL_REV_OI"),        py: npyOf("pl","other_income","PL_REV_OI")        },
        costMaterials:      { noteNo: dn("cost_materials"),      cy: ncyOf("pl","cost_materials","PL_EXP_MAT"),     py: npyOf("pl","cost_materials","PL_EXP_MAT")     },
        purchasesStock:     { noteNo: dn("purchases_stock"),     cy: ncyOf("pl","purchases_stock","PL_EXP_SIT"),    py: npyOf("pl","purchases_stock","PL_EXP_SIT")    },
        // Bug 7 — When the Inventories note breakup is populated, P&L Changes
        // in Inventories CY is computed as (opening − closing) where:
        //   opening = PY inventory  (notes breakup PY sum, or raw TB pyOf)
        //   closing = CY inventory  (notes breakup CY sum, or raw TB cyOf)
        // Lets edits to the Inventories note flow into both the BS Inventories
        // line AND the P&L CII line automatically.  PY column continues to
        // come from pyInvCII (PY Shell TB) when available, else falls back
        // to the breakup sum / raw TB.
        changesInventories: (() => {
          const invCy = sumNotesSubRowsCY(stage5NotesData ?? null, "bs_asset", "inventories");
          const invPy = sumNotesSubRowsPY(stage5NotesData ?? null, "bs_asset", "inventories");
          if (invCy != null || invPy != null) {
            const closingCy = invCy ?? cyOf("BS_CA_INV");
            const openingCy = invPy ?? pyOf("BS_CA_INV");
            return {
              noteNo: dn("changes_inventories"),
              cy: openingCy - closingCy,
              py: pyInvCII ?? npyOf("pl","changes_inventories","PL_EXP_CII"),
            };
          }
          return {
            noteNo: dn("changes_inventories"),
            cy: ncyOf("pl","changes_inventories","PL_EXP_CII"),
            py: npyOf("pl","changes_inventories","PL_EXP_CII"),
          };
        })(),
        employeeBenefits:   { noteNo: dn("employee_benefits"),   cy: ncyOf("pl","employee_benefits","PL_EXP_EMP"),  py: npyOf("pl","employee_benefits","PL_EXP_EMP")  },
        financeCosts:       { noteNo: dn("finance_costs"),       cy: ncyOf("pl","finance_costs","PL_EXP_FIN"),      py: npyOf("pl","finance_costs","PL_EXP_FIN")      },
        // Issue 1 — Depreciation row points at the PPE / FA Schedule note
        // (same number as Property, Plant & Equipment).  A single FA grid
        // serves both the BS PPE line and the P&L Depreciation line.
        depreciation:       { noteNo: dn("ppe"),                  cy: ncyOf("pl","depreciation","PL_EXP_DEP"),       py: npyOf("pl","depreciation","PL_EXP_DEP")       },
        otherExpenses:      { noteNo: dn("other_expenses"),      cy: ncyOf("pl","other_expenses","PL_EXP_OTH"),     py: npyOf("pl","other_expenses","PL_EXP_OTH")     },
        taxExpense:         { noteNo: null },
        currentTax:         { cy: cyOf("PL_TAX_CUR"), py: pyOf("PL_TAX_CUR") },
        deferredTax:        { cy: cyOf("PL_TAX_DEF"), py: pyOf("PL_TAX_DEF") },
        eps:                { noteNo: dn("eps")                 },
        // Bug 1 — Excel EPS divisor must be the paid-up share count, not the
        // note number.  Sourced from Share Capital breakup share_count_cy fields.
        shareCap:           { noteNo: getSharesOutstanding(stage5NotesData ?? null, "cy") || (getNoteNo("share_capital") ?? null) },
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
      bs.dtLiab.noteNo          = ov("BS_NCL_DTL", bs.dtLiab.noteNo);
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
    computedAmounts, mergedPY, noteOverrides, pyInvCII,
    stage5NotesData,
  ]);

  // ─── Corporate BS check + P&L summary ───
  // IMPORTANT: Use fsDisplayData.bs (cyOf-resolved, includes saved overrides)
  // for the balance check so it agrees with the numbers shown on the face of the BS.
  // Raw computedAmounts miss saves such as the current-year P&L added to reserves
  // via the Notes, which causes a spurious mismatch equal to the net profit.
  const corpBsData = fsDisplayData?.bs;
  const totalAssets: number = corpBsData
    ? (corpBsData.ppe.cy || 0) + (corpBsData.ncInvestments.cy || 0) + (corpBsData.dtAssets.cy || 0)
      + (corpBsData.ltLoans.cy || 0) + (corpBsData.otherNcAssets.cy || 0)
      + (corpBsData.currInvestments.cy || 0) + (corpBsData.inventories.cy || 0) + (corpBsData.tradeRec.cy || 0)
      + (corpBsData.cashBank.cy || 0) + (corpBsData.stLoans.cy || 0) + (corpBsData.otherCurrAssets.cy || 0)
    : (computedAmounts["BS_NCA"] || 0) + (computedAmounts["BS_CA"] || 0);
  // Liabilities are stored negative (Tally CR); negate each to get positive total
  const totalELDisplay: number = corpBsData
    ? -(corpBsData.shareCap.cy || 0) - (corpBsData.reserves.cy || 0)
      - (corpBsData.ltBorrowings.cy || 0) - (corpBsData.dtLiab.cy || 0)
      - (corpBsData.otherLtLiab.cy || 0) - (corpBsData.ltProvisions.cy || 0)
      - (corpBsData.stBorrowings.cy || 0)
      - (corpBsData.tradePayMSME.cy || 0) - (corpBsData.tradePayOthers.cy || 0)
      - (corpBsData.otherCurrLiab.cy || 0) - (corpBsData.stProvisions.cy || 0)
    : -((computedAmounts["BS_EQ"] || 0) + (computedAmounts["BS_NCL"] || 0) + (computedAmounts["BS_CL"] || 0));
  // bsDiff = 0 when both sides balance
  const bsDiff = Math.round((totalAssets - totalELDisplay) * 100) / 100;
  const totalRevenue = (computedAmounts["PL_REV"] || 0);   // negative (credit)
  const totalExpenses = (computedAmounts["PL_EXP"] || 0);  // positive (debit)
  // netProfit = PBT (pre-tax); PL_EXP excludes PL_TAX_CUR / PL_TAX_DEF
  const netProfit = Math.round((-totalRevenue - totalExpenses) * 100) / 100;
  // corpNetPAT: deduct taxes using same sign logic as buildPLRows (line ~760):
  //   profitCy = pbtCy - currentTax + deferredTax
  // currentTax is stored DR (positive); deferredTax is stored CR (negative) in Tally.
  const corpPlData = fsDisplayData?.pl;
  const corpNetPAT = corpPlData
    ? Math.round((netProfit - (corpPlData.currentTax.cy || 0) + (corpPlData.deferredTax.cy || 0)) * 100) / 100
    : netProfit;

  // ─── Bug 5 — Phase E for NCE: notes-aware substitution into NCE amounts ─────
  // For each NCE FS code that has a note key + section mapping, substitute
  // the breakup sum (when populated) for the raw TB value.  Liability codes
  // are stored negative in Tally (CR convention) and the NCE BS view applies
  // negL() at display, so we re-apply the negative sign before storing in
  // the augmented map — keeps display sign convention identical to before.
  const nceCyAmounts: Record<string, number> = isNonCorporate
    ? (() => {
        const out = { ...computedAmounts };
        for (const [code, key] of Object.entries(NCE_CODE_TO_NOTE_KEY)) {
          const section = NCE_CODE_TO_SECTION[code];
          if (!section) continue;
          const sum = sumNotesSubRowsCY(stage5NotesData ?? null, section, key);
          if (sum == null) continue;
          out[code] = section === "bs_liab" ? -sum : sum;
        }
        // Bug 6 — NCE PPE / CWIP / Intangibles use the FA grid total when
        // populated.  CWIP and Intangibles share the PPE note number per
        // NCE_CODE_TO_NOTE_KEY, but they're not separated in the FA grid;
        // we apply the total only to NCE_PPE so the remaining two columns
        // continue to read from raw TB (their own ledgers).
        const faCy = getFAGridNetBlockTotal(stage5NotesData ?? null, "cy");
        if (faCy != null) out["NCE_PPE"] = faCy;
        return out;
      })()
    : computedAmounts;
  const ncePyAmounts: Record<string, number> = isNonCorporate
    ? (() => {
        const out = { ...mergedPY };
        for (const [code, key] of Object.entries(NCE_CODE_TO_NOTE_KEY)) {
          const section = NCE_CODE_TO_SECTION[code];
          if (!section) continue;
          const sum = sumNotesSubRowsPY(stage5NotesData ?? null, section, key);
          if (sum == null) continue;
          out[code] = section === "bs_liab" ? -sum : sum;
        }
        const faPy = getFAGridNetBlockTotal(stage5NotesData ?? null, "py");
        if (faPy != null) out["NCE_PPE"] = faPy;
        return out;
      })()
    : mergedPY;

  // ─── NCE stats bar ───────────────────────────────────────────────────────────
  // Sum individual leaf codes so the stats bar is independent of computeTotal
  // parent nodes. NCE_NET_PROF (row XIII) comes from the profit-chain block.
  const nceTotalAssets      = NCE_ASSET_IDS.reduce((s, id) => s + (nceCyAmounts[id] || 0), 0);
  // NCE liabilities are stored negative (Tally credit) → use + to get true diff
  const nceTotalLiabilities = NCE_LIAB_IDS.reduce((s, id) => s + (nceCyAmounts[id] || 0), 0);
  const nceBsDiff           = Math.round((nceTotalAssets + nceTotalLiabilities) * 100) / 100;
  const nceBsBalanced       = Math.abs(nceTotalAssets + nceTotalLiabilities) < 1;
  const nceNetProfit        = computedAmounts["NCE_NET_PROF"] || 0;

  // ─── Active summary values (swap between NCE and corporate in JSX) ───────
  const corpBsBalanced    = Math.abs(bsDiff) < 1;
  const activeBsDiff      = isNonCorporate ? nceBsDiff      : bsDiff;
  const activeBsBalanced  = isNonCorporate ? nceBsBalanced  : corpBsBalanced;
  const activeTotalAssets      = isNonCorporate ? nceTotalAssets      : totalAssets;
  // Use fsDisplayData-resolved totalELDisplay (same as bsDiff) so stat card
  // matches the "TOTAL EQUITY AND LIABILITIES" row shown on the BS face.
  const activeTotalLiabilities = isNonCorporate ? nceTotalLiabilities : totalELDisplay;
  // Use after-tax PAT so stat card matches "Profit/(Loss) for the period" on P&L.
  const activeNetProfit        = isNonCorporate ? nceNetProfit        : corpNetPAT;

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
  // Auto-load directors: Block C (questionnaire_answers.directors) takes priority;
  // falls back to mrl_data.header_data only when Block C is empty.
  // Always re-runs on mount so stale localStorage is replaced by the canonical source.
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      try {
        const [engResult, mrlResult] = await Promise.all([
          supabase
            .from("audit_engagements")
            .select("questionnaire_answers")
            .eq("id", engagementId)
            .maybeSingle(),
          supabase
            .from("mrl_data")
            .select("header_data")
            .eq("engagement_id", engagementId)
            .maybeSingle(),
        ]);
        if (cancelled) return;

        // Block C directors (always canonical)
        const blockCDirs: { name: string; din: string }[] =
          ((engResult.data?.questionnaire_answers as any)?.directors ?? [])
            .filter((d: any) => d?.name?.trim() || d?.din?.trim());

        if (blockCDirs.length > 0) {
          const next: DirState = {
            dir1Name: blockCDirs[0]?.name || "",
            dir1Din:  blockCDirs[0]?.din  || "",
            dir2Name: blockCDirs[1]?.name || "",
            dir2Din:  blockCDirs[1]?.din  || "",
          };
          setCorpSigDirs(next);
          try { window.localStorage.setItem(SIG_DIR_KEY, JSON.stringify(next)); } catch {}
          return;
        }

        // Fallback: mrl_data.header_data (only when Block C has no directors)
        const h = (mrlResult.data as any)?.header_data || {};
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
      // Prefer is_py_shell=true (PY shell from sync-py.js), fall back to any
      // FY-1 engagement. Use order(created_at desc) so a PY shell (created
      // more recently) wins over an older regular engagement when both exist.
      // Also fetch coa_mapping so we can map PY shell ledger names correctly —
      // the PY shell may have ledger names that differ from CY and aren't in the
      // CY's coaMapping at all (renamed ledgers, GST-rate suffixes, etc.).
      let pyEngId: string | null = null;
      let pyEngCoaMapping: Record<string, any> = {};

      // Prefer PY shell with actual TB rows; fall back to any FY-1 engagement.
      // Multiple PY shells can exist for the same FY (one from sync-py.bat,
      // one from "Setup PY Data") — we need the one that was actually synced.
      const { data: allFY1 } = await (supabase.from as any)("audit_engagements")
        .select("id, coa_mapping, is_py_shell")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy);
      const fy1List = (allFY1 || []) as any[];
      // Sort: PY shells first
      fy1List.sort((a: any, b: any) => (b.is_py_shell ? 1 : 0) - (a.is_py_shell ? 1 : 0));
      for (const row of fy1List) {
        const { count } = await supabase
          .from("tally_trial_balance")
          .select("ledger_name", { count: "exact", head: true })
          .eq("engagement_id", row.id);
        if ((count ?? 0) > 0) {
          pyEngId = row.id;
          pyEngCoaMapping = row.coa_mapping ?? {};
          break;
        }
      }
      // If no TB data found in any, use first available engagement
      if (!pyEngId && fy1List.length > 0) {
        pyEngId = fy1List[0].id;
        pyEngCoaMapping = fy1List[0].coa_mapping ?? {};
      }

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
      //
      // Lookup priority:
      //   1. PY shell's own coa_mapping  — most accurate; ledger names in the
      //      PY shell TB match names in the PY shell's Stage 3 mapping exactly.
      //   2. CY engagement's coaMapping  — fallback when the PY shell hasn't
      //      been mapped yet or the ledger name is identical across years.
      const preview: Record<string, number> = {};
      for (const row of pyTbRows) {
        const name = String(row.ledger_name || "").trim();
        const mapping =
          (pyEngCoaMapping[name]) ||       // 1. PY shell's own mapping
          (coaMapping as any)[name];        // 2. CY fallback
        if (!mapping || !plLeafCodes.has(mapping.code)) continue;
        const cb    = Math.abs(Number(row.closing_balance ?? 0));
        const isDr  = String(row.balance_type ?? "").toUpperCase() === "DR";
        const signed = isDr ? cb : -cb;
        preview[mapping.code] = (preview[mapping.code] || 0) + signed;
      }

      if (!Object.keys(preview).length) {
        toast("No P&L ledgers matched. Ensure Stage 6 (COA Mapping) is complete for the PY Shell engagement first.");
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

        // UI-6 Phase 5 — Load stage5_notes for the 4 extra worksheets
        // (Note BS-Liab / Note BS-Asset / Note PL / FA). If the column is
        // null or the row is missing the export still works; the writer
        // emits 0/blank cells with formulas intact.
        let notesData: any = null;
        try {
          const { data: notesRow } = await supabase
            .from("audit_engagements")
            .select("stage5_notes")
            .eq("id", engagement.id)
            .maybeSingle();
          notesData = (notesRow as any)?.stage5_notes ?? null;
        } catch (e) {
          console.warn("[FS Export] Could not load stage5_notes:", e);
        }

        // UI-8 Phase 7 — Load stage7_ratios for the 3 extra ratio worksheets.
        // Corporate entities only (NCE/non-corporate engagements pass null).
        let ratiosData: any = null;
        if (!isNonCorporate) {
          try {
            const { data: ratiosRow } = await supabase
              .from("audit_engagements")
              .select("stage7_ratios")
              .eq("id", engagement.id)
              .maybeSingle();
            ratiosData = (ratiosRow as any)?.stage7_ratios ?? null;
          } catch (e) {
            console.warn("[FS Export] Could not load stage7_ratios:", e);
          }
        }

        const blob = await generateFinancialStatementsXLSX(
          fsEng, fsFirm, memoBs, memoPl, memoCfs, notesData, ratiosData,
        );
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

    // ───────────────────────────────────────────────────────────────────────
    //  NCE template-driven export — uses public/templates/nce-financials.xlsx
    //  as a starting workbook so headings, fonts, borders and column widths
    //  match the firm's hand-crafted master format.  Only data cells +
    //  scalar placeholders are replaced.  See src/lib/fsExcelTemplateNCE.ts.
    //  Falls through to the legacy inline writer if anything goes wrong so
    //  the auditor always gets a file.
    // ───────────────────────────────────────────────────────────────────────
    if (isNonCorporate) {
      try {
        // Convert "2025-26" → numeric end year
        const fyParts = String(engagement?.financial_year || "").split("-");
        const cyEndYear = fyParts.length === 2
          ? parseInt(fyParts[0], 10) + 1
          : cyYear;
        const pyEndYear = cyEndYear - 1;
        const ay = fyParts.length === 2
          ? `${cyEndYear}-${(cyEndYear + 1).toString().slice(-2)}`
          : "";
        // Format report date as DD/MM/YYYY for the template
        const reportDateFmt = (() => {
          const raw = (engagement as any)?.sign_off_date;
          if (!raw) return "";
          try {
            const d = new Date(raw);
            const dd = String(d.getDate()).padStart(2, "0");
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            return `${dd}/${mm}/${d.getFullYear()}`;
          } catch { return ""; }
        })();

        // Build NCE FS code → CY/PY amount map.  Liabilities are stored
        // negative in TB so we negate them to get positive face values.
        // exportCy / exportPy include manual overrides + Phase E notes-aware
        // substitutions for NCE.
        const NCE_LIAB = new Set([
          "NCE_CAP","NCE_LTB","NCE_OLTL","NCE_LTP",
          "NCE_STB","NCE_TP","NCE_OCL","NCE_STP",
        ]);
        const NCE_INCOME = new Set([
          "NCE_REV_OPS","NCE_REV_OTH",
        ]);
        const NCE_CODES = [
          "NCE_CAP","NCE_LTB","NCE_OLTL","NCE_LTP",
          "NCE_STB","NCE_TP","NCE_OCL","NCE_STP",
          "NCE_PPE","NCE_CWIP","NCE_INTG",
          "NCE_NCINV","NCE_LTLA","NCE_ONCA",
          "NCE_CINV","NCE_STCK","NCE_TR","NCE_CASH","NCE_STLA","NCE_OCA",
          "NCE_REV_OPS","NCE_REV_OTH",
          "NCE_COGS","NCE_EMP_EXP","NCE_FIN_COST","NCE_DEPR","NCE_OTH_EXP",
        ];
        const amounts: Record<string, { cy: number; py: number }> = {};
        for (const code of NCE_CODES) {
          let cyVal = (exportCy as any)[code] || (cyOf as any)(code) || 0;
          let pyVal = (exportPy as any)[code] || (pyOf as any)(code) || 0;
          // Liabilities + Income come from TB negative — flip to positive
          if (NCE_LIAB.has(code) || NCE_INCOME.has(code)) {
            cyVal = -cyVal;
            pyVal = -pyVal;
          }
          amounts[code] = { cy: cyVal, py: pyVal };
        }

        const client    = (engagement?.clients ?? {}) as any;
        const { buildNCEFinancialsXLSX } =
          await import("@/lib/fsExcelTemplateNCE");
        const blob = await buildNCEFinancialsXLSX({
          entityName:    clientName,
          entityType:    client.entity_type ?? "Non-Corporate Entity",
          address:       client.registered_office ?? client.address ?? "",
          pan:           client.pan ?? "",
          gstin:         Array.isArray(client.gstin) ? (client.gstin[0] ?? "") : (client.gstin ?? ""),
          tan:           client.tan_number ?? "",
          business:      client.business_activity ?? "",
          financialYear: fy,
          assessmentYear: ay,
          cyYear:        cyEndYear,
          pyYear:        pyEndYear,
          firmName:      sigFirmName || "",
          firmFRN:       sigFirmFRN  || "",
          partnerName:   sigPartnerName || "",
          membershipNo:  sigMembershipNo || "",
          place:         sigPlace || sigFirmCity || "",
          reportDate:    reportDateFmt,
          udin:          (engagement as any)?.udin ?? "",
          amounts,
        });
        const safeNm = (clientName || "Client").replace(/[^A-Za-z0-9]/g, "_");
        const url    = URL.createObjectURL(blob);
        const a      = document.createElement("a");
        a.href     = url;
        a.download = `FS_${safeNm}_${fy || "FY"}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Financial Statements exported (NCE template format)");
        return;
      } catch (err: any) {
        console.error("[FS Export] NCE template export failed, falling back to legacy:", err);
        toast.warning(`Using legacy NCE format: ${err?.message || "template export failed"}`);
        // Fall through to legacy writer below
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
    const topLiab    = bsItems.find(i => i.code === "NCE_EL" || i.code === "BS_EL");
    const topAst     = bsItems.find(i => i.code === "NCE_AST" || i.code === "BS_AST");
    // For NCE entities the section-divider item carries the plain label;
    // for corporate entities fall back to the node name (unchanged).
    const liabHdrName = bsItems.find(i => i.code === "NCE_EL_HDR")?.name || topLiab?.name || "";
    const astHdrName  = bsItems.find(i => i.code === "NCE_AST_HDR")?.name  || topAst?.name  || "";
    if (topLiab) {
      writeSectionHeader(liabHdrName);
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
      writeSectionHeader(astHdrName);
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
      // Layout matches the supplied template at C:\Users\Admin\Downloads\NOTW 1_NCE.xlsx
      //   • Cols A(margin) B(note#) C(small) D-J body H is widest (29.14)
      //   • R2 = entity name centered (bold, big)
      //   • R3 = "Notes forming part of the Financial Statements..." centered
      //   • R5 = "Note : 1   Summary of Significant accounting policies"
      //   • Each saved note: B${row}=N, D${row}:J${row}=body (wrapped, justify top)
      //     with a h=4.5 spacer row between every two notes
      //   • Signature block: 2-column layout — left = assessee/place/date,
      //     right = firm/partner/membership
      const n1 = wb.addWorksheet("Note 1", { views: [{ showGridLines: false }] });
      n1.columns = [
        { width: 2.29 },   // A — left margin
        { width: 5.57 },   // B — note number
        { width: 2.14 },   // C — small gap
        { width: 11.57 }, // D
        { width: 10.71 }, // E
        { width: 6.57 },  // F
        { width: 12.29 }, // G
        { width: 29.14 }, // H — widest body column
        { width: 7.86 },  // I
        { width: 3.71 },  // J — right edge of body
        { width: 3.29 },  // K — right margin
      ];
      // Page setup to match template
      n1.pageSetup.paperSize     = 9;
      n1.pageSetup.orientation   = "portrait";
      n1.pageSetup.fitToPage     = true;
      n1.pageSetup.fitToWidth    = 1;
      n1.pageSetup.fitToHeight   = 0;
      n1.pageSetup.showGridLines = false;
      n1.pageSetup.margins = { left: 0.35, right: 0.35, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 };

      let n1r = 2;
      const n1EntityName = notesToAccountsData?.header_overrides?.entityNameOverride
        || clientName;
      // ── Row 2 — Entity name (B2:J2 merged, h=27.75) ──
      n1.mergeCells(`B${n1r}:J${n1r}`);
      n1.getCell(`B${n1r}`).value = n1EntityName;
      n1.getCell(`B${n1r}`).font = { name: "Calibri", bold: true, size: 14 };
      n1.getCell(`B${n1r}`).alignment = { horizontal: "center", vertical: "middle" };
      n1.getRow(n1r).height = 27.75;
      n1r++;
      // ── Row 3 — "Notes forming part..." (B3:J3 merged, h=22.5) ──
      n1.mergeCells(`B${n1r}:J${n1r}`);
      n1.getCell(`B${n1r}`).value =
        `Notes forming part of the Financial Statements  for the year ended, 31st March, ${cyYear}`;
      n1.getCell(`B${n1r}`).font = { name: "Calibri", bold: true, size: 11 };
      n1.getCell(`B${n1r}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      n1.getRow(n1r).height = 22.5;
      n1r++;
      // ── Row 4 — small spacer (h=5.25) ──
      n1.mergeCells(`B${n1r}:J${n1r}`);
      n1.getRow(n1r).height = 5.25;
      n1r++;
      // ── Row 5 — "Note :  1  Summary of Significant accounting policies" ──
      n1.getCell(`B${n1r}`).value = "Note :";
      n1.getCell(`B${n1r}`).font = { name: "Calibri", bold: true, size: 11 };
      n1.getCell(`B${n1r}`).alignment = { horizontal: "left", vertical: "middle" };
      n1.getCell(`C${n1r}`).value = 1;
      n1.getCell(`C${n1r}`).font = { name: "Calibri", bold: true, size: 11 };
      n1.getCell(`C${n1r}`).alignment = { horizontal: "left", vertical: "middle" };
      n1.mergeCells(`D${n1r}:J${n1r}`);
      n1.getCell(`D${n1r}`).value = "Summary of Significant accounting policies";
      n1.getCell(`D${n1r}`).font = { name: "Calibri", bold: true, size: 11 };
      n1.getCell(`D${n1r}`).alignment = { horizontal: "left", vertical: "middle" };
      n1r++;
      // ── Row 6 — small spacer (h=6.75) ──
      n1.getRow(n1r).height = 6.75;
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

      // Helper: emit one note row (B = number, D:J merged = body) plus a 4.5pt spacer below.
      // D:J merged width ≈ 11.57 + 10.71 + 6.57 + 12.29 + 29.14 + 7.86 + 3.71 = 81.85 char-units
      const CHARS_PER_LINE = 80;
      const writeNoteRow = (num: number | "", body: string) => {
        if (num !== "") {
          n1.getCell(`B${n1r}`).value = num;
          n1.getCell(`B${n1r}`).font = { name: "Calibri", bold: true, size: 11 };
          n1.getCell(`B${n1r}`).alignment = { horizontal: "center", vertical: "top" };
        }
        n1.mergeCells(`D${n1r}:J${n1r}`);
        n1.getCell(`D${n1r}`).value = body;
        n1.getCell(`D${n1r}`).font = { name: "Calibri", size: 11 };
        n1.getCell(`D${n1r}`).alignment = { horizontal: "left", vertical: "top", wrapText: true };
        const segments = body.split('\n');
        const wrappedLines = segments.reduce(
          (s, seg) => s + Math.max(1, Math.ceil(seg.length / CHARS_PER_LINE)),
          0,
        );
        n1.getRow(n1r).height = Math.max(18, wrappedLines * 15);
        n1r++;
        // 4.5pt spacer between notes (matches template's even-row pattern)
        n1.getRow(n1r).height = 4.5;
        n1r++;
      };

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
          // Prepend the note title to the body if title exists (templates in
          // the saved data may not embed the title in the text itself)
          if (note.title) body = `${note.title}\n${body}`;
          writeNoteRow(num, body);
        });

        // ── Signature block — 2-column layout matching template ──
        // Add some breathing room (one extra spacer row)
        n1.getRow(n1r).height = 9; n1r++;
        // Left column starts at B, right column starts at G
        const sigStart = n1r;
        const setLeft  = (row: number, text: string, opts: { bold?: boolean } = {}) => {
          n1.getCell(`B${row}`).value = text;
          n1.getCell(`B${row}`).font = { name: "Calibri", size: 11, bold: !!opts.bold };
          n1.getCell(`B${row}`).alignment = { horizontal: "left", vertical: "top" };
        };
        const setRight = (row: number, text: string, opts: { bold?: boolean } = {}) => {
          n1.getCell(`G${row}`).value = text;
          n1.getCell(`G${row}`).font = { name: "Calibri", size: 11, bold: !!opts.bold };
          n1.getCell(`G${row}`).alignment = { horizontal: "left", vertical: "top" };
        };
        // Row 1: For, [Entity Name]   |   For [CA Firm Name]
        setLeft (sigStart,     `For, ${n1EntityName}`,                  { bold: true });
        setRight(sigStart,     `For, ${sigFirmName || "[CA Firm Name]"}`, { bold: true });
        n1.getRow(sigStart).height = 15;
        // Row 2: (blank)            |   Chartered Accountants
        setRight(sigStart + 1, "Chartered Accountants");
        n1.getRow(sigStart + 1).height = 15;
        // Row 3: (blank)            |   FRN: <num>
        setRight(sigStart + 2, `FRN: ${sigFirmFRN || "_______"}`);
        n1.getRow(sigStart + 2).height = 15;
        // Rows 4-6: gap for physical signatures
        n1.getRow(sigStart + 3).height = 15;
        n1.getRow(sigStart + 4).height = 15;
        // Row 6: x_______          |   [Partner Name]
        setLeft (sigStart + 5, "x_____________________");
        setRight(sigStart + 5, sigPartnerName || "[Partner Name]", { bold: true });
        n1.getRow(sigStart + 5).height = 15;
        // Row 7: Signature of assessee | Partner
        setLeft (sigStart + 6, "Signature of assessee");
        setRight(sigStart + 6, "Partner");
        n1.getRow(sigStart + 6).height = 15;
        // Row 8: Place: ____         | Membership No.: ____
        setLeft (sigStart + 7, `Place : ${sigPlace || "______"}`);
        setRight(sigStart + 7, `Membership No.: ${sigMembershipNo || "_______"}`);
        n1.getRow(sigStart + 7).height = 15;
        // Row 9: Date : DD/MM/YYYY  | (blank)
        const today = new Date();
        const todayStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
        setLeft (sigStart + 8, `Date  : ${todayStr}`);
        n1.getRow(sigStart + 8).height = 15;
        n1r = sigStart + 9;
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
          // Use the same template-matched layout as the saved-notes branch
          // so both code paths render identically.
          const numAsInt = parseInt(p.num) || "";
          writeNoteRow(numAsInt as number, `${p.title}\n${p.text}`);
        }

        // ── Signature block — 2-column layout matching template ──
        n1.getRow(n1r).height = 9; n1r++;
        const sigStart = n1r;
        const setLeft  = (row: number, text: string, opts: { bold?: boolean } = {}) => {
          n1.getCell(`B${row}`).value = text;
          n1.getCell(`B${row}`).font = { name: "Calibri", size: 11, bold: !!opts.bold };
          n1.getCell(`B${row}`).alignment = { horizontal: "left", vertical: "top" };
        };
        const setRight = (row: number, text: string, opts: { bold?: boolean } = {}) => {
          n1.getCell(`G${row}`).value = text;
          n1.getCell(`G${row}`).font = { name: "Calibri", size: 11, bold: !!opts.bold };
          n1.getCell(`G${row}`).alignment = { horizontal: "left", vertical: "top" };
        };
        setLeft (sigStart,     `For, ${n1EntityName}`,                  { bold: true });
        setRight(sigStart,     `For, ${sigFirmName || "[CA Firm Name]"}`, { bold: true });
        setRight(sigStart + 1, "Chartered Accountants");
        setRight(sigStart + 2, `FRN: ${sigFirmFRN || "_______"}`);
        for (let r = 0; r < 5; r++) n1.getRow(sigStart + r).height = 15;
        n1.getRow(sigStart + 3).height = 15;
        n1.getRow(sigStart + 4).height = 15;
        setLeft (sigStart + 5, "x_____________________");
        setRight(sigStart + 5, sigPartnerName || "[Partner Name]", { bold: true });
        setLeft (sigStart + 6, "Signature of assessee");
        setRight(sigStart + 6, "Partner");
        setLeft (sigStart + 7, `Place : ${sigPlace || "______"}`);
        setRight(sigStart + 7, `Membership No.: ${sigMembershipNo || "_______"}`);
        const today2 = new Date();
        const todayStr2 = `${String(today2.getDate()).padStart(2,'0')}/${String(today2.getMonth()+1).padStart(2,'0')}/${today2.getFullYear()}`;
        setLeft (sigStart + 8, `Date  : ${todayStr2}`);
        for (let r = 5; r < 9; r++) n1.getRow(sigStart + r).height = 15;
        n1r = sigStart + 9;
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
    items
      .filter(item => !item.hideFromDisplay)   // skip computation-only rows
      .map(item => {
      // ── Section-divider row (e.g. "EQUITY AND LIABILITIES", "INCOME") ─────
      if (item.isDivider) {
        return (
          <TableRow key={item.code} className="bg-muted/60">
            <TableCell colSpan={5} className="text-xs font-bold uppercase tracking-wide py-1.5 px-2">
              {item.name}
            </TableCell>
          </TableRow>
        );
      }

      const isHeader = !!(item.children && item.children.length > 0);
      // showTotalLast items appear at the END of their group — render as a total row
      const isTotalRow = !!item.showTotalLast;
      const rawAmount = computedAmounts[item.code] || 0;
      const rawPy     = mergedPY[item.code] || 0;
      // ── Sign convention: Tally stores credit balances as NEGATIVE ──────────
      // For display, negate credit-side sections so they appear as positive
      // numbers on the Balance Sheet (liabilities) and P&L (revenue/income).
      // Asset, expense, and profit-chain sections are left as-is.
      const needsSignFlip =
        item.section?.includes("BS_liabilities") ||    // corporate + NCE liabilities/equity
        item.section === "PL_revenue"              ||  // corporate revenue items
        item.section === "NCE_PL_income";              // NCE income items
      const amount = needsSignFlip ? -rawAmount : rawAmount;
      const py     = needsSignFlip ? -rawPy     : rawPy;
      const hasOverride    = !!manualOverrides[item.code];
      const hasPyOverride  = pyManualAmounts[item.code] !== undefined;
      const pyMeta         = pyManualMeta[item.code];

      return (
        <TableRow
          key={item.code}
          className={cn(
            isTotalRow && "border-t-2 border-foreground/30 bg-muted/50 font-bold",
            !isTotalRow && isHeader && "bg-muted/40 font-semibold",
            !isTotalRow && !isHeader && "hover:bg-muted/20",
          )}
        >
          {/* Particulars */}
          <TableCell
            className="text-xs"
            style={{ paddingLeft: `${isTotalRow ? 8 : item.depth * 20 + 8}px` }}
          >
            <span className={cn(
              isTotalRow  && "uppercase text-[11px] tracking-wide",
              !isTotalRow && isHeader && "uppercase text-[11px] tracking-wide",
            )}>{item.name}</span>
            {hasOverride && (
              <Badge className="ml-1.5 text-[8px] px-1 bg-amber-100 text-amber-700 border-amber-200">M</Badge>
            )}
          </TableCell>

          {/* Note No. — dynamic for NCE (zero-suppressed + sequential) */}
          <TableCell className="text-xs text-center text-muted-foreground tabular-nums">
            {item.noteRef && !isHeader && !isTotalRow
              ? (nceDynamicNoteMap.get(item.noteRef) ?? "")
              : ""}
          </TableCell>

          {/* CY amount + pencil
               Intermediate section headers (has children, NOT a total row) never
               show amounts — they are pure structural labels (per Excel template). */}
          <TableCell className="text-right text-xs font-mono tabular-nums">
            <div className="flex items-center justify-end gap-1">
              {(isHeader && !isTotalRow) ? null : amount !== 0 ? (
                <span className={amount < 0 ? "text-destructive" : ""}>
                  {amount < 0 ? "(" : ""}₹{Math.round(Math.abs(amount)).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}{amount < 0 ? ")" : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              {!isHeader && !isTotalRow && (
                <button
                  className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-0.5 rounded hover:bg-muted ml-1"
                  title={item.code && INV_PL_CODES.has(item.code) && hasInvMapping
                    ? "Auto-computed from inventory TB. Override if Tally P&L opening stock differs from ledger opening balance."
                    : "Override CY amount"}
                  onClick={() => openOverride(item.code, item.name)}
                >
                  <Pencil size={9} className={item.code && INV_PL_CODES.has(item.code) && hasInvMapping ? "text-blue-400" : "text-muted-foreground"} />
                </button>
              )}
            </div>
          </TableCell>

          {/* PY amount — hidden for intermediate section headers, same as CY */}
          <TableCell className="text-right text-xs font-mono tabular-nums text-muted-foreground">
            <div className="flex items-center justify-end gap-1">
              {!(isHeader && !isTotalRow) && hasPyOverride && (
                <span
                  title={pyMeta ? `Manually overridden by ${pyMeta.by} on ${new Date(pyMeta.at).toLocaleDateString("en-IN")}` : "Manually overridden"}
                  className="text-amber-600 cursor-help"
                >⚠</span>
              )}
              {(isHeader && !isTotalRow) ? null : py !== 0 ? (
                <span className={hasPyOverride ? "text-amber-700 dark:text-amber-400" : ""}>
                  {py < 0 ? "(" : ""}₹{Math.round(Math.abs(py)).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}{py < 0 ? ")" : ""}
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
    <FsUnitsProvider engagementId={engagementId}>
    <div className="max-w-6xl space-y-4">
      <EngagementHeader engagement={engagement} stageNumber={7} stageLabel="Financial Statements" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Stage 7 — Financial Statements</h1>
          <p className="text-xs text-muted-foreground">Generated from mapped trial balance</p>
        </div>
        <div className="flex items-center gap-2">
          <FsUnitsToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Bug 12 — confirm before re-syncing.  Auto-linked rows will
              // refresh from latest TB; manual entries (manual_edits[]) are
              // preserved.  Cancel exits without action.
              const ok = window.confirm(
                "This will re-fetch notes data from your Trial Balance.\n" +
                "Auto-linked rows will refresh.\n" +
                "Your manual entries will be preserved.\n\n" +
                "Continue?",
              );
              if (ok) window.location.reload();
            }}
            className="gap-1"
            title={
              "Re-syncs notes from Trial Balance + COA mapping.\n" +
              "Manually edited rows (in manual_edits[]) are preserved."
            }
          >
            <RefreshCw size={14} /> Refresh
          </Button>
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
      {/* ── Inventory Mismatch Warning ────────────────────────────────────────
           Shown when CY opening balance for INV_* ledgers doesn't match
           the PY Shell closing balance for the same ledger names. This
           typically means the PY Shell TB hasn't been synced yet, or that
           there is a genuine discrepancy. */}
      {invMismatchLedgers.length > 0 && (
        <Alert className="border-amber-400 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-xs text-amber-800 dark:text-amber-400">
            Inventory Opening Balance Mismatch
          </AlertTitle>
          <AlertDescription className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            <p className="mb-1">
              CY opening balance ≠ PY Shell closing balance for {invMismatchLedgers.length} inventory ledger{invMismatchLedgers.length > 1 ? "s" : ""}.
              The PY Changes in Inventories figure may not tally with the prior year. Sync the PY Shell Tally data to resolve.
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              {invMismatchLedgers.map(m => (
                <li key={m.ledger}>
                  <span className="font-medium">{m.ledger}</span>
                  {" — "}CY Opening: ₹{Math.abs(m.cyOpening).toLocaleString("en-IN")}
                  {" vs "}PY Shell Closing: ₹{Math.abs(m.pyClosing).toLocaleString("en-IN")}
                  {Math.abs(m.cyOpening - m.pyClosing) > 0 && (
                    <span className="text-amber-600 ml-1">
                      (diff ₹{Math.abs(m.cyOpening - m.pyClosing).toLocaleString("en-IN")})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* PY Data Source card — only shown when PY setup has NOT been configured yet.
          Once py_setup_completed is true (user picked py_shell/manual/none), this card
          is hidden so it doesn't duplicate the PY Shell navigation banner below. */}
      {noPriorEngagement && !(engagement as any)?.is_py_shell && !(engagement as any)?.py_setup_completed && (
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
      {((engagement as any)?.py_source === "py_shell" || pyShellInfo?.isShell) && !(engagement as any)?.is_py_shell && (
        <Alert className="border-blue-300/50 bg-blue-50/40 dark:bg-blue-950/20">
          <Database className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-xs flex items-center justify-between">
            <span className="text-blue-800 dark:text-blue-300 font-semibold">
              PY Shell — FY {pyYear - 1}-{String(pyYear).slice(-2)}
            </span>
            <div className="flex items-center gap-2">
              {!pyShellSyncDone
                ? <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-400">⚠ Tally sync pending</Badge>
                : !coaMappingComplete
                ? <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-400">⚠ COA mapping pending</Badge>
                : <Badge variant="outline" className="text-[10px] border-green-500 text-green-700 dark:text-green-400">✓ Ready to fetch</Badge>
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
            {!pyShellSyncDone
              ? "PY Shell created but Tally not yet synced. Click \"Open PY Shell Tally Sync\", run the sync for FY 2024-25, then return here."
              : !coaMappingComplete
              ? "Tally sync done ✓ — Now go to Stage 6 (COA Mapping) and map all prior-year ledgers. Once COA Mapping is marked complete, return here and click \"Fetch from FY-1 Tally\" in the P&L tab."
              : "PY Shell Tally sync is complete and COA mapping is done. Use \"Fetch from FY-1 Tally\" in the P&L tab to pull PY P&L figures into this engagement."}
          </AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-6 gap-3">
        <Card className={cn(activeBsBalanced ? "border-primary/30" : "border-destructive/30")}>
          <CardContent className="p-3 text-center">
            <p className={cn("text-2xl font-bold", activeBsBalanced ? "text-primary" : "text-destructive")}>
              {activeBsBalanced ? "✓" : `₹${formatINR(Math.abs(activeBsDiff))}`}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">BS Check</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-foreground">₹{formatINR(Math.abs(activeTotalAssets))}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Total Assets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-foreground">₹{formatINR(Math.abs(activeTotalLiabilities))}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Total Equity + Liabilities</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className={cn("text-2xl font-bold", activeNetProfit >= 0 ? "text-primary" : "text-destructive")}>
              {activeNetProfit >= 0 ? "+" : ""}₹{formatINR(Math.abs(activeNetProfit))}
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
        {/* Phase B — Notes mismatch counter */}
        <Card
          className={cn(
            "cursor-pointer transition-colors",
            mismatchCount > 0 ? "border-amber-400/60 bg-amber-50/30 hover:bg-amber-50/60" : "border-primary/20"
          )}
          onClick={() => {
            if (mismatchCount > 0) {
              setActiveTab("notes");
              const el = document.getElementById("notes-mismatch-panel");
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }}
        >
          <CardContent className="p-3 text-center">
            <p className={cn("text-2xl font-bold", mismatchCount > 0 ? "text-amber-600" : "text-primary")}>
              {mismatchCount}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">Notes Mismatches</p>
          </CardContent>
        </Card>
      </div>

      {/* Phase B — Notes mismatch panel: visible on all tabs when notes reconciliation fails */}
      <div id="notes-mismatch-panel">
        <NotesMismatchPanel
          engagementId={engagementId}
          entityType={engagement?.entity_type || engagement?.clients?.entity_type}
          onCountChange={setMismatchCount}
          onNavigate={(noteNo, subTab) => {
            setActiveTab("notes");
            if (isNonCorporate) {
              setNceNavNote(noteNo);
            } else {
              setCorpNavNote({ noteNo, subTab });
            }
            // Scroll to the notes tab content after a short delay
            setTimeout(() => {
              document.getElementById(`note-${noteNo}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 300);
          }}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="bs" className="gap-1.5">
              <BarChart3 size={14} /> Balance Sheet
            </TabsTrigger>
            <TabsTrigger value="pl" className="gap-1.5">
              <FileSpreadsheet size={14} /> P&L Statement
            </TabsTrigger>
            {!isNonCorporate && cfApplicable && (
              <TabsTrigger value="cf" className="gap-1.5">
                <Droplets size={14} /> Cash Flow
              </TabsTrigger>
            )}
            {/* Phase 4.2 — Notes tab AFTER Cash Flow, corporate only */}
            {!isNonCorporate && (
              <TabsTrigger value="notes" className="gap-1.5">
                <BookOpen size={14} /> Notes
              </TabsTrigger>
            )}
            {/* UI-8 — Ratios tab AFTER Notes, corporate only */}
            {!isNonCorporate && (
              <TabsTrigger value="ratios" className="gap-1.5">
                <TrendingUp size={14} /> Ratios
              </TabsTrigger>
            )}
            {/* UI-7 — NCE Notes tab (Capital Account / Notes to Accounts / PPE).
                Guard is REVERSED vs corporate UI-6 above; the two never co-exist
                so re-using value="notes" is safe and gives both branches the same
                tab key. */}
            {isNonCorporate && (
              <TabsTrigger value="notes" className="gap-1.5">
                <BookOpen size={14} /> Notes
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
                  engagementId={engagementId}
                  bs={fsDisplayData.bs}
                  cyYear={cyYear}
                  pyYear={pyYear}
                  companyName={engagement?.clients?.name || "[Company Name]"}
                  pyLocked={pyLocked}
                  onCommitCY={(code, value) => {
                    setManualOverrides(prev => {
                      const next = { ...prev };
                      if (value === null) delete next[code];
                      else {
                        // Liability/equity side: user types positive, store as negative (Tally credit convention)
                        const storeValue = BS_LIABILITY_CODES.has(code) ? -Math.abs(value) : value;
                        next[code] = { amount: storeValue, reason: prev[code]?.reason || "(inline edit)" };
                      }
                      return next;
                    });
                    // Bug 11 — prompt to sync the note breakup if it's populated.
                    if (value !== null) maybePromptSyncNote(code, value);
                  }}
                  onCommitPY={(code, value) => {
                    setPyManualAmounts(prev => {
                      const next = { ...prev };
                      if (value === null) delete next[code];
                      else {
                        // Same sign convention for PY liability overrides
                        const storeValue = BS_LIABILITY_CODES.has(code) ? -Math.abs(value) : value;
                        next[code] = storeValue;
                      }
                      return next;
                    });
                    setPyManualDirty(true);
                  }}
                  onEditNote={updateNoteOverride}
                  onNavigateToNote={(noteNo, subTab) => {
                    setActiveTab("notes");
                    setCorpNavNote({ noteNo, subTab });
                    setTimeout(() => setCorpNavNote(null), 1000);
                  }}
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
            ) : isNonCorporate ? (
              <>
                <NCEBalanceSheetView
                  engagementId={engagementId}
                  cyAmounts={nceCyAmounts}
                  pyAmounts={ncePyAmounts}
                  cyYear={cyYear}
                  pyYear={pyYear}
                  entityName={engagement?.clients?.name || ""}
                  pyLocked={pyLocked}
                  nceDynamicNoteMap={nceDynamicNoteMap}
                  onCommitCY={(code, value) => {
                    setManualOverrides(prev => {
                      const next = { ...prev };
                      if (value === null) delete next[code];
                      else next[code] = { amount: value, reason: prev[code]?.reason || "(inline edit)" };
                      return next;
                    });
                    // Bug 11 — also prompt to sync NCE note breakup
                    if (value !== null) maybePromptSyncNote(code, value);
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
                  onNavigateToNote={(noteNo) => {
                    setActiveTab("notes");
                    setNceNavNote(noteNo);
                    // Reset after a delay so re-clicking the same note works
                    setTimeout(() => setNceNavNote(null), 1000);
                  }}
                />
                {nceSignatureBlock}
              </>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 group">
                      <TableHead className="text-xs">Particulars</TableHead>
                      <TableHead className="text-xs text-center w-[8%]">Note No.</TableHead>
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
                      activeFlatItems.filter(i => i.section.startsWith("BS_"))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
            {!isNonCorporate && !activeBsBalanced && (
              <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle size={13} />
                Balance Sheet is out of balance by ₹{Math.abs(activeBsDiff).toLocaleString("en-IN")}. Check COA mapping or apply manual overrides.
              </div>
            )}
            {!isNonCorporate && nceSignatureBlock}
          </TabsContent>

          {/* ── P&L Statement ── */}
          <TabsContent value="pl" className="mt-3">
            {/*
                "Enter PY P&L Amounts" and "PY Annexures — Ledger Detail" panels
                removed for non-corporate entities — PY figures flow automatically
                from the prior-year Tally sync via the COA mapping.
            */}

            {/* ── Fetch PY from FY-1 Tally button ─────────────────────────── */}
            {!pyLocked && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/20 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-blue-800 dark:text-blue-300">
                  <Database className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {!pyShellSyncDone
                      ? <><strong>PY not yet synced.</strong> Run sync-py.bat for FY {pyYear - 1}-{String(pyYear).slice(-2)}, then click Fetch.</>
                      : !coaMappingComplete
                      ? <><strong>Complete COA Mapping first.</strong> Go to <strong>Stage 6 — COA Mapping</strong>, map all prior-year ledgers, then return here to fetch PY figures.</>
                      : <>Prior year Tally data available. Click <strong>Fetch PY from FY-1 Tally</strong> to auto-populate PY comparative figures.</>
                    }
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 border-blue-400 text-blue-700 hover:bg-blue-100 dark:border-blue-600 dark:text-blue-300 shrink-0 ml-3"
                  onClick={fetchPyPLFromTally}
                  disabled={fetchingPyTally || !fetchPyEnabled}
                  title={!pyShellSyncDone ? "Run PY sync first" : !coaMappingComplete ? "Complete COA Mapping (Stage 6) first" : undefined}
                >
                  {fetchingPyTally
                    ? <><span className="animate-spin inline-block">↻</span> Fetching…</>
                    : <><Database className="h-3 w-3" /> Fetch PY from FY-1 Tally</>
                  }
                </Button>
              </div>
            )}

            {/* Phase UI-3: Pixel-perfect on-screen P&L for corporate entities.
                Mirrors writeProfitAndLoss() in src/lib/fsExcelExport.ts row-by-row
                using fsDisplayData.pl from UI-1. NCE entities continue to render
                via the legacy renderFSRows() table — untouched. */}
            {!isNonCorporate && fsDisplayData.pl ? (
              <>
                <CorporatePLView
                  engagementId={engagementId}
                  pl={fsDisplayData.pl}
                  cyYear={cyYear}
                  pyYear={pyYear}
                  companyName={engagement?.clients?.name || "[Company Name]"}
                  pyLocked={pyLocked}
                  lockedCodes={undefined}
                  notesData={stage5NotesData ?? null}
                  onCommitCY={(code, value) => {
                    setManualOverrides(prev => {
                      const next = { ...prev };
                      if (value === null) delete next[code];
                      else {
                        // Revenue side: user types positive, store as negative (Tally credit convention)
                        const storeValue = PL_REVENUE_CODES.has(code) ? -Math.abs(value) : value;
                        next[code] = { amount: storeValue, reason: prev[code]?.reason || "(inline edit)" };
                      }
                      return next;
                    });
                  }}
                  onCommitPY={(code, value) => {
                    setPyManualAmounts(prev => {
                      const next = { ...prev };
                      if (value === null) delete next[code];
                      else {
                        // Same sign convention for PY revenue overrides
                        const storeValue = PL_REVENUE_CODES.has(code) ? -Math.abs(value) : value;
                        next[code] = storeValue;
                      }
                      return next;
                    });
                    setPyManualDirty(true);
                  }}
                  onNavigateToNote={(noteNo, subTab) => {
                    setActiveTab("notes");
                    setCorpNavNote({ noteNo, subTab });
                    setTimeout(() => setCorpNavNote(null), 1000);
                  }}
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
            ) : isNonCorporate ? (
              <>
                <NCEPLView
                  engagementId={engagementId}
                  cyAmounts={computedAmounts}
                  pyAmounts={mergedPY}
                  cyYear={cyYear}
                  pyYear={pyYear}
                  entityName={engagement?.clients?.name || ""}
                  pyLocked={pyLocked}
                  nceDynamicNoteMap={nceDynamicNoteMap}
                  onCommitCY={(code, value) => {
                    setManualOverrides(prev => {
                      const next = { ...prev };
                      if (value === null) delete next[code];
                      else next[code] = { amount: value, reason: prev[code]?.reason || "(inline edit)" };
                      return next;
                    });
                    // Bug 11 — also prompt to sync NCE note breakup
                    if (value !== null) maybePromptSyncNote(code, value);
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
                  onNavigateToNote={(noteNo) => {
                    setActiveTab("notes");
                    setNceNavNote(noteNo);
                    // Reset after a delay so re-clicking the same note works
                    setTimeout(() => setNceNavNote(null), 1000);
                  }}
                />
                {nceSignatureBlock}
              </>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 group">
                      <TableHead className="text-xs">Particulars</TableHead>
                      <TableHead className="text-xs text-center w-[8%]">Note No.</TableHead>
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
                      activeFlatItems.filter(i => i.section.startsWith("PL_"))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
            {!isNonCorporate && nceSignatureBlock}
          </TabsContent>

          {/* ── Cash Flow (corporate only) ── */}
          {/* Phase UI-4: Pixel-perfect on-screen Cash Flow Statement using
              fsDisplayData.bs / .pl / .cfs from UI-1. Mirrors writeCashFlow()
              in src/lib/fsExcelExport.ts (AS-3 Indirect Method). */}
          {!isNonCorporate && cfApplicable && (
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
            <TabsContent value="notes" className="mt-3">
              {/* UI-6 Phase 3 — full Notes UI lives in src/components/stage5/NotesTab.tsx
                  Renders 4 sub-tabs (Note BS-Liab → Note BS-Asset → FA → Note PL),
                  uses notesAutoPopulate service for auto-fill, persists on every edit. */}
              <NotesTab
                engagementId={engagementId}
                cyYear={cyYear}
                pyYear={pyYear}
                navigateToNote={corpNavNote}
              />
            </TabsContent>
          )}

          {/* ── Ratios (UI-8) — Note 22 — corporate only, after Notes ── */}
          {!isNonCorporate && (
            <TabsContent value="ratios" className="mt-3">
              <RatiosTab engagementId={engagementId} engagement={engagement} />
            </TabsContent>
          )}

          {/* ── NCE Notes (UI-7) — Capital Account / Notes to Accounts / PPE ── */}
          {isNonCorporate && (
            <TabsContent value="notes" className="mt-3">
              <NCENotesTab
                engagementId={engagementId}
                navigateToNote={nceNavNote}
                dynamicNoteMap={nceDynamicNoteMap}
              />
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
                const enteredAmount = parseFloat(overrideAmount) || 0;
                setManualOverrides(prev => ({
                  ...prev,
                  [code]: { amount: enteredAmount, reason: overrideReason },
                }));
                setOverrideDialog(null);
                toast.success("Manual override applied");
                // Bug 11 — also prompt to sync the note breakup so the
                // "Apply Override" path matches the inline-edit path.
                if (Number.isFinite(enteredAmount)) {
                  maybePromptSyncNote(code, enteredAmount);
                }
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
    </FsUnitsProvider>
  );
}
