import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { signedBalance as fsSignedBalance, signedOpening as fsSignedOpening } from "@/lib/fsSignConvention";
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
  BookOpen, TrendingUp, RefreshCw, FileText,
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
import { generateNCEFinancialsDocx } from "@/lib/nceFinancialsDocx";
import { generateCorporateFinancialsDocx } from "@/lib/corporateFinancialsDocx";
import { sumNotesSubRowsCY, sumNotesSubRowsPY, getSharesOutstanding, getFAGridNetBlockTotal } from "@/lib/notesAutoPopulate";
import {
  getNCENoteFaceTotal, NCE_CODE_TO_NOTE, NOTE_NATURE as NCE_NOTE_NATURE,
  nceAutoPopulate, serialiseNoteData,
} from "@/lib/nceAutoPopulate";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";
import FsHealthPanel from "@/components/pipeline/FsHealthPanel";
import { evaluateNotesStaleness } from "@/lib/notesStaleness";
import { NCE_RESYNC_DELETE_FIRST, FS_NO_CAPITAL_PLUG, FS_CORP_PY_FACE_FROM_NOTE, FS_CORP_EXPORT_GATE, FS_NO_MANUAL_NOTE_ADD } from "@/lib/nceFeatureFlags";
import { validateFSReconciliation, validateCorporateFSReconciliation, logReconciliationDrift, NCE_LIAB_CODE_SET, computeCOATotals, validateOpeningVsPriorClose } from "@/lib/fsReconciliation";
import { computeNceCoaAnchoredFace } from "@/lib/nceFaceAnchor";
import { isTallyPLAccount, currentYearProfitAlreadyInReserves } from "@/lib/tallyDetection";

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
  | { kind: "total";    label: string; cy: number; py: number; rightAlignLabel?: boolean }
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
  NCE_COGS: 24, NCE_CII: 26, NCE_EMP_EXP: 27, NCE_FIN_COST: 28, NCE_DEPR: 10, NCE_OTH_EXP: 30, NCE_PART_REM: 31,
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
        <div className="font-bold text-sm uppercase tracking-wide text-[#1F3864]">
          {companyName}
        </div>
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
            const editableCY   = !FS_FACE_FIGURES_READONLY && !!row.code && !!onCommitCY;
            const editablePY   = !FS_FACE_FIGURES_READONLY && !!row.code && !!onCommitPY && !pyLocked;
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
  // Total Expenses = SUM of every expense line, INCLUDING "Cost of materials
  // consumed".  (The old code excluded costMaterials on an Excel-template
  // assumption that row 14 carried a note-no only with no amount — true for
  // pure trading entities, but manufacturers map real purchase/consumption
  // ledgers to PL_EXP_MAT.  Dropping it understated Total Expenses by the full
  // cost of materials and overstated PBT by the same amount, so the rendered
  // P&L diverged from both COA mapping and the FS export/PBT figure, which
  // both already include it.)
  const totalExpensesCy =
    (pl.costMaterials.cy || 0) +
    (pl.purchasesStock.cy || 0) + (pl.changesInventories.cy || 0) +
    (pl.employeeBenefits.cy || 0) + (pl.financeCosts.cy || 0) +
    (pl.depreciation.cy || 0)    + (pl.otherExpenses.cy || 0);
  const totalExpensesPy =
    (pl.costMaterials.py || 0) +
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
  // XI — Profit/(Loss) for period from continuing operations  = IX − X
  // X (Tax expense) = Current Tax + Deferred Tax. Both currentTaxCy and
  // deferredTaxCy are stored as POSITIVE expense magnitudes (matching how
  // they render on the P&L row: "Current tax 2,310" / "Deferred tax 1,622")
  // so subtract both to derive PAT. Previously this used "+ deferredTax"
  // on a stale sign-convention assumption that has long since been
  // corrected upstream — the result was XI showing PBT − CT + DT instead
  // of PBT − CT − DT (off by 2× the deferred-tax amount).
  const profitContOpsCy = pbtCy - currentTaxCy - deferredTaxCy;    // XI
  const profitContOpsPy = pbtPy - currentTaxPy - deferredTaxPy;    // XI
  // XV — Profit/(Loss) for the period  =  XI + XIV (discontinuing-ops)
  // With no discontinuing operations (XIV = 0), XV equals XI.
  const profitCy = profitContOpsCy;                                // XV
  const profitPy = profitContOpsPy;                                // XV

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
    { kind: "item",   roman: "XI.",  label: "Profit (loss) for period from continuing operations", cy: profitContOpsCy, py: profitContOpsPy, bold: true },
    { kind: "subnote", label: "(IX-X)", bold: true },
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
        <div className="font-bold text-sm uppercase tracking-wide text-[#1F3864]">
          {companyName}
        </div>
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
            const editableCY = !FS_FACE_FIGURES_READONLY && !!row.code && !!onCommitCY && !isLockedCY;
            const editablePY = !FS_FACE_FIGURES_READONLY && !!row.code && !!onCommitPY && !pyLocked && !isLockedCY;
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

// PD-4 / Rule 8 / §12 invariant #2: the FS faces are read-only — figures flow
// from the notes; the only legitimate figure change is a tracked manual note row.
// Figure-neutral: this only removes the inline edit affordance; displayed values
// are unchanged, and any existing persisted override still renders. Set false to
// restore the legacy editable-face behaviour.
const FS_FACE_FIGURES_READONLY = true;

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
    // Task 6: shortened to "TOTAL"; Task 9: right-align label
    { kind: "total", label: "TOTAL", cy: totalEL, py: totalELpy, rightAlignLabel: true },
    { kind: "spacer" },
    { kind: "section", label: "ASSETS", size: 10 },
    { kind: "subhead", label: "(1) Non-Current Assets" },
    // Task 8: grouped parent heading + sub-items matching Corporate order (PPE, Intangibles, CWIP)
    { kind: "subhead", label: "(a) Property, Plant & Equipment and Intangible Assets", indent: 1 },
    { kind: "item", label: "     (i)   Property, plant and equipment",  noteNo: sn(10, cy["NCE_PPE"],   py["NCE_PPE"]),   cy: pos("NCE_PPE"),   py: pospy("NCE_PPE"),   indent: 2, code: "NCE_PPE" },
    { kind: "item", label: "     (ii)  Intangible assets",              noteNo: sn(12, cy["NCE_INTG"],  py["NCE_INTG"]),  cy: pos("NCE_INTG"),  py: pospy("NCE_INTG"),  indent: 2, code: "NCE_INTG" },
    { kind: "item", label: "     (iii) Capital work-in-progress",       noteNo: sn(11, cy["NCE_CWIP"],  py["NCE_CWIP"]),  cy: pos("NCE_CWIP"),  py: pospy("NCE_CWIP"),  indent: 2, code: "NCE_CWIP" },
    { kind: "item", label: "(b) Non-current investments",               noteNo: sn(13, cy["NCE_NCINV"], py["NCE_NCINV"]), cy: pos("NCE_NCINV"), py: pospy("NCE_NCINV"), indent: 1, code: "NCE_NCINV" },
    { kind: "item", label: "(c) Long-term loans and advances",          noteNo: sn(14, cy["NCE_LTLA"],  py["NCE_LTLA"]),  cy: pos("NCE_LTLA"),  py: pospy("NCE_LTLA"),  indent: 1, code: "NCE_LTLA" },
    { kind: "item", label: "(d) Other non-current assets",              noteNo: sn(15, cy["NCE_ONCA"],  py["NCE_ONCA"]),  cy: pos("NCE_ONCA"),  py: pospy("NCE_ONCA"),  indent: 1, code: "NCE_ONCA" },
    { kind: "spacer" },
    { kind: "subhead", label: "(2) Current Assets" },
    { kind: "item", label: "(a) Current investments",                   noteNo: sn(16, cy["NCE_CINV"],  py["NCE_CINV"]),  cy: pos("NCE_CINV"),  py: pospy("NCE_CINV"),  indent: 1, code: "NCE_CINV" },
    { kind: "item", label: "(b) Inventories",                           noteNo: sn(17, cy["NCE_STCK"],  py["NCE_STCK"]),  cy: pos("NCE_STCK"),  py: pospy("NCE_STCK"),  indent: 1, code: "NCE_STCK" },
    { kind: "item", label: "(c) Trade receivables",                     noteNo: sn(18, cy["NCE_TR"],    py["NCE_TR"]),    cy: pos("NCE_TR"),    py: pospy("NCE_TR"),    indent: 1, code: "NCE_TR" },
    { kind: "item", label: "(d) Cash and bank balances",                noteNo: sn(19, cy["NCE_CASH"],  py["NCE_CASH"]),  cy: pos("NCE_CASH"),  py: pospy("NCE_CASH"),  indent: 1, code: "NCE_CASH" },
    // NCE: short-term loans share Note 14 with long-term loans (combined LT/ST in NCENotesConfig)
    { kind: "item", label: "(e) Short-term loans and advances",         noteNo: sn(14, cy["NCE_STLA"],  py["NCE_STLA"]),  cy: pos("NCE_STLA"),  py: pospy("NCE_STLA"),  indent: 1, code: "NCE_STLA" },
    { kind: "item", label: "(f) Other current assets",                  noteNo: sn(21, cy["NCE_OCA"],   py["NCE_OCA"]),   cy: pos("NCE_OCA"),   py: pospy("NCE_OCA"),   indent: 1, code: "NCE_OCA" },
    { kind: "spacer" },
    // Task 6: shortened to "TOTAL"; Task 9: right-align label
    { kind: "total", label: "TOTAL", cy: totalAst, py: totalAstPy, rightAlignLabel: true },
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
  // COGS: NCE_COGS includes cost of materials and purchases; NCE_CII is changes in inventories
  const cogsCy = pos("NCE_COGS") + pos("NCE_CII");
  const cogsPy = pospy("NCE_COGS") + pospy("NCE_CII");

  return [
    { kind: "header", label: "INCOME" },
    { kind: "item", roman: "I.",   label: "Revenue from operations", noteNo: sn(22, cy["NCE_REV_OPS"], py["NCE_REV_OPS"]), cy: negI("NCE_REV_OPS"),  py: negIpy("NCE_REV_OPS"),  code: "NCE_REV_OPS" },
    { kind: "item", roman: "II.",  label: "Other income",            noteNo: sn(23, cy["NCE_REV_OTH"], py["NCE_REV_OTH"]), cy: negI("NCE_REV_OTH"),  py: negIpy("NCE_REV_OTH"),  code: "NCE_REV_OTH" },
    { kind: "total", roman: "III.", label: "Total Income (I + II)", cy: totalIncomeCy, py: totalIncomePy },
    { kind: "spacer" },
    { kind: "header", roman: "IV.", label: "Expenses" },
    { kind: "item", label: "(a) Cost of goods sold",  indent: 1 },
    { kind: "item", label: "     (i)   Cost of Materials Consumed",                                     noteNo: sn(24, cogsCy, cogsPy),                               cy: pos("NCE_COGS"),      py: pospy("NCE_COGS"),     indent: 2, code: "NCE_COGS" },
    { kind: "item", label: "     (ii)  Purchases of Stock-in-Trade",                                    noteNo: sn(25, cogsCy, cogsPy),                               cy: undefined,            py: undefined,             indent: 2 },
    { kind: "item", label: "     (iii) Changes in Inventories of FG, WIP & Stock-in-Trade",             noteNo: sn(26, pos("NCE_CII"), pospy("NCE_CII")),              cy: pos("NCE_CII"),       py: pospy("NCE_CII"),      indent: 2, code: "NCE_CII" },
    { kind: "item", label: "(b) Employee benefits expense",    noteNo: sn(27, cy["NCE_EMP_EXP"],  py["NCE_EMP_EXP"]),  cy: pos("NCE_EMP_EXP"),  py: pospy("NCE_EMP_EXP"),  indent: 1, code: "NCE_EMP_EXP" },
    { kind: "item", label: "(c) Finance costs",                noteNo: sn(28, cy["NCE_FIN_COST"], py["NCE_FIN_COST"]), cy: pos("NCE_FIN_COST"), py: pospy("NCE_FIN_COST"), indent: 1, code: "NCE_FIN_COST" },
    // Issue 1 — Depreciation note number aligned with PPE (10) — same FA Schedule.
    { kind: "item", label: "(d) Depreciation and amortisation",noteNo: sn(10, cy["NCE_DEPR"],     py["NCE_DEPR"]),     cy: pos("NCE_DEPR"),     py: pospy("NCE_DEPR"),     indent: 1, code: "NCE_DEPR" },
    { kind: "item", label: "(e) Other expenses",               noteNo: sn(30, cy["NCE_OTH_EXP"],  py["NCE_OTH_EXP"]), cy: pos("NCE_OTH_EXP"),  py: pospy("NCE_OTH_EXP"),  indent: 1, code: "NCE_OTH_EXP" },
    { kind: "total", label: "Total Expenses (IV)", cy: pos("NCE_PL_EXP"), py: pospy("NCE_PL_EXP") },
    { kind: "spacer" },
    { kind: "item", roman: "V.",    label: "Profit/(loss) before exceptional items, partners' remuneration and tax", cy: pos("NCE_PROF_V"),   py: pospy("NCE_PROF_V"),   bold: true },
    { kind: "item", roman: "VI.",   label: "Exceptional items",                                                       cy: pos("NCE_EXCEP"),    py: pospy("NCE_EXCEP") },
    { kind: "item", roman: "VII.",  label: "Profit before extraordinary items and tax",                               cy: pos("NCE_PROF_VII"), py: pospy("NCE_PROF_VII"), bold: true },
    { kind: "item", roman: "VIII.", label: "Extraordinary items",                                                     cy: pos("NCE_EXTORD"),   py: pospy("NCE_EXTORD") },
    { kind: "item", roman: "IX.",   label: "Profit before partners' remuneration and tax",                           cy: pos("NCE_PROF_IX"),  py: pospy("NCE_PROF_IX"),  bold: true },
    { kind: "item", roman: "X.",    label: "Partners' remuneration",  noteNo: sn(31, cy["NCE_PART_REM"], py["NCE_PART_REM"]), cy: pos("NCE_PART_REM"), py: pospy("NCE_PART_REM"), code: "NCE_PART_REM" },
    { kind: "item", roman: "XI.",   label: "Profit before tax (IX − X)",                                             cy: pos("NCE_PROF_XI"),  py: pospy("NCE_PROF_XI"),  bold: true },
    { kind: "header", roman: "XII.", label: "Tax expense:" },
    { kind: "item", label: "(1) Current tax",                             cy: pos("NCE_CUR_TAX"),   py: pospy("NCE_CUR_TAX"),   indent: 2, code: "NCE_CUR_TAX" },
    { kind: "item", label: "(2) Short/excess provision for earlier years", cy: pos("NCE_PRIOR_TAX"), py: pospy("NCE_PRIOR_TAX"), indent: 2, code: "NCE_PRIOR_TAX" },
    { kind: "item", label: "(3) Deferred tax charge / (benefit)",          cy: pos("NCE_DEFER_TAX"), py: pospy("NCE_DEFER_TAX"), indent: 2, code: "NCE_DEFER_TAX" },
    { kind: "spacer" },
    { kind: "total", roman: "XIII.", label: "Profit / (Loss) for the year (XI − XII)", cy: pos("NCE_NET_PROF"), py: pospy("NCE_NET_PROF") },
    { kind: "spacer" },
    // Task 12: Discontinued operations (XIV–XVII)
    // XVI and XVII are computed (not stored directly)
    ...((): PLDisplayRow[] => {
      const discOpCy  = pos("NCE_DISC_OP");   const discOpPy  = pospy("NCE_DISC_OP");
      const discTaxCy = pos("NCE_DISC_TAX");  const discTaxPy = pospy("NCE_DISC_TAX");
      const discAtCy  = discOpCy - discTaxCy; const discAtPy  = discOpPy - discTaxPy;
      const finalCy   = pos("NCE_NET_PROF") + discAtCy;
      const finalPy   = pospy("NCE_NET_PROF") + discAtPy;
      return [
        { kind: "item",  roman: "XIV.",  label: "Profit/(loss) from discontinuing operations",                       cy: discOpCy,  py: discOpPy,  code: "NCE_DISC_OP" },
        { kind: "item",  roman: "XV.",   label: "Tax expense of discontinuing operations",                           cy: discTaxCy, py: discTaxPy, code: "NCE_DISC_TAX" },
        { kind: "item",  roman: "XVI.",  label: "Profit/(loss) from discontinuing operations (after tax) (XIV-XV)",  cy: discAtCy,  py: discAtPy },
        { kind: "total", roman: "XVII.", label: "Profit/(Loss) for the year (XIII+XVI)", cy: finalCy, py: finalPy },
      ];
    })(),
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
    <div className="overflow-hidden" style={{ fontFamily: "Calibri, Arial, sans-serif" }}>
      {/* ── Title block — matches DOCX: entity name (navy, bold, 14pt centre),
          subtitle (11pt centre), "Amounts in ₹" (8pt right-aligned) ──────── */}
      <div className="text-center py-1.5">
        <div className="font-bold uppercase tracking-wide text-[#1F3864]" style={{ fontSize: "14px" }}>
          {entityName}
        </div>
        <div style={{ fontSize: "11px" }} className="mt-0.5 font-bold text-[#1F3864]">
          BALANCE SHEET AS AT 31 MARCH {cyYear}
        </div>
        <div className="text-right text-[#505050] italic mt-0.5 pr-1" style={{ fontSize: "8px" }}>
          Amounts in ₹
        </div>
      </div>
      {/* ── Navy divider matching the DOCX border-bottom on the title block */}
      <div className="border-b-2 border-[#1F3864] mb-0" />
      <table className="w-full" style={{ fontSize: "11px" }}>
        <thead>
          {/* ── Navy header row — matches DOCX: white text on #1F3864 fill ── */}
          <tr style={{ backgroundColor: "#1F3864", color: "#FFFFFF" }}>
            <th className="text-left font-bold py-1 px-2.5 w-[55%]" style={{ fontSize: "8pt" }}>Particulars</th>
            <th className="text-center font-bold py-1 px-2 w-[5%]" style={{ fontSize: "8pt" }}>Note<br />No.</th>
            <th className="text-right font-bold py-1 px-2.5 w-[20%]" style={{ fontSize: "8pt" }}>
              As at<br />31st March, {cyYear}
            </th>
            <th className="text-right font-bold py-1 px-2.5 w-[20%]" style={{ fontSize: "8pt" }}>
              As at<br />31st March, {pyYear}
              {pyLocked && <Badge className="text-[7px] px-1 ml-1 bg-amber-100 text-amber-700 border-amber-300 gap-0.5"><Lock size={7} /> Finalized</Badge>}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.kind === "spacer")  return <tr key={idx}><td colSpan={4} className="h-1.5" /></tr>;
            if (row.kind === "section") return (
              <tr key={idx}>
                <td colSpan={4} className="font-bold py-1 px-2.5" style={{ fontSize: "10pt" }}>{row.label}</td>
              </tr>
            );
            if (row.kind === "subhead") return (
              <tr key={idx}>
                <td className="font-semibold py-0.5 px-2.5" style={{ paddingLeft: 12 + (row.indent || 0) * 16, fontSize: "9pt" }}>{row.label}</td>
                <td colSpan={3} />
              </tr>
            );
            if (row.kind === "total")   return (
              <tr key={idx} style={{ borderTop: "2px solid #1F3864" }}>
                <td className={`font-bold py-1 px-2.5 uppercase${row.rightAlignLabel ? " text-right" : ""}`} style={{ fontSize: "9pt" }}>{row.label}</td>
                <td className="py-1 px-2" />
                <td className="text-right font-bold tabular-nums py-1 px-2.5" style={{ fontSize: "9pt" }}>{formatINR(row.cy)}</td>
                <td className="text-right font-bold tabular-nums py-1 px-2.5" style={{ fontSize: "9pt" }}>{formatINR(row.py)}</td>
              </tr>
            );
            if (row.kind === "footer")  return (
              <tr key={idx}>
                <td className="font-semibold py-0.5 px-2.5 italic text-muted-foreground" colSpan={3} style={{ fontSize: "8pt" }}>{row.label}</td>
                {row.noteNo != null
                  ? <td className="text-center py-0.5 px-2 text-primary font-medium italic" style={{ fontSize: "8pt" }}>{row.noteNo}</td>
                  : <td />}
              </tr>
            );
            // item row — matches DOCX: 8pt Calibri, minimal padding
            const indentPx = (row.indent || 0) * 16;
            const editableCY = !FS_FACE_FIGURES_READONLY && !!row.code && !!onCommitCY;
            const editablePY = !FS_FACE_FIGURES_READONLY && !!row.code && !!onCommitPY && !pyLocked;
            const isLiab = NCE_LIABILITY_CODES.has(row.code ?? "");
            return (
              <tr key={idx} className="hover:bg-muted/10 border-b border-gray-100">
                <td className="py-0.5 px-2.5" style={{ paddingLeft: 12 + indentPx, fontSize: "8pt" }}>{row.label}</td>
                <NoteCell code={row.code} noteNo={row.noteNo} />
                <td className="text-right tabular-nums py-0.5 px-2.5" style={{ fontSize: "8pt" }}>
                  {editableCY
                    ? <EditableMoneyCell value={row.cy} onCommit={(v) => onCommitCY!(row.code!, v === null ? null : isLiab ? -v : v)} />
                    : formatINR(row.cy)}
                </td>
                <td className="text-right tabular-nums py-0.5 px-2.5" style={{ fontSize: "8pt" }}>
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
    <div className="overflow-hidden" style={{ fontFamily: "Calibri, Arial, sans-serif" }}>
      {/* ── Title block — matches DOCX P&L title format ──────────────── */}
      <div className="text-center py-1.5">
        <div className="font-bold uppercase tracking-wide text-[#1F3864]" style={{ fontSize: "14px" }}>
          {entityName}
        </div>
        <div style={{ fontSize: "11px" }} className="mt-0.5 font-bold text-[#1F3864]">
          STATEMENT OF PROFIT AND LOSS FOR THE YEAR ENDED 31 MARCH {cyYear}
        </div>
        <div className="text-right text-[#505050] italic mt-0.5 pr-1" style={{ fontSize: "8px" }}>
          Amounts in ₹
        </div>
      </div>
      <div className="border-b-2 border-[#1F3864] mb-0" />
      <table className="w-full" style={{ fontSize: "11px" }}>
        <thead>
          <tr style={{ backgroundColor: "#1F3864", color: "#FFFFFF" }}>
            <th className="text-center font-bold py-1 px-1 w-[5%]" style={{ fontSize: "8pt" }}></th>
            <th className="text-left font-bold py-1 px-2.5 w-[50%]" style={{ fontSize: "8pt" }}>Particulars</th>
            <th className="text-center font-bold py-1 px-2 w-[5%]" style={{ fontSize: "8pt" }}>Note<br />No.</th>
            <th className="text-right font-bold py-1 px-2.5 w-[20%]" style={{ fontSize: "8pt" }}>
              For the year ended<br />31st March, {cyYear}
            </th>
            <th className="text-right font-bold py-1 px-2.5 w-[20%]" style={{ fontSize: "8pt" }}>
              For the year ended<br />31st March, {pyYear}
              {pyLocked && <Badge className="text-[7px] px-1 ml-1 bg-amber-100 text-amber-700 border-amber-300 gap-0.5"><Lock size={7} /> Finalized</Badge>}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.kind === "spacer") return <tr key={idx}><td colSpan={5} className="h-1.5" /></tr>;
            if (row.kind === "header") return (
              <tr key={idx}>
                <td className="text-center font-bold py-1 px-1" style={{ fontSize: "9pt" }}>{row.roman || ""}</td>
                <td colSpan={4} className="font-bold py-1 px-2.5" style={{ fontSize: "9pt" }}>{row.label}</td>
              </tr>
            );
            if (row.kind === "total")  return (
              <tr key={idx} style={{ borderTop: "2px solid #1F3864" }}>
                <td className="text-center font-bold py-1 px-1" style={{ fontSize: "9pt" }}>{row.roman || ""}</td>
                <td className="font-bold py-1 px-2.5" style={{ fontSize: "9pt" }}>{row.label}</td>
                <td />
                <td className="text-right font-bold tabular-nums py-1 px-2.5" style={{ fontSize: "9pt" }}>{formatINR(row.cy)}</td>
                <td className="text-right font-bold tabular-nums py-1 px-2.5" style={{ fontSize: "9pt" }}>{formatINR(row.py)}</td>
              </tr>
            );
            const indentPx = (row.indent || 0) * 16;
            const boldCls = row.bold ? "font-bold" : "";
            const editableCY = !FS_FACE_FIGURES_READONLY && !!row.code && !!onCommitCY;
            const editablePY = !FS_FACE_FIGURES_READONLY && !!row.code && !!onCommitPY && !pyLocked;
            const isInc = NCE_INCOME_CODES.has(row.code ?? "");
            return (
              <tr key={idx} className="hover:bg-muted/10 border-b border-gray-100">
                <td className={`text-center py-0.5 px-1 ${boldCls}`} style={{ fontSize: "8pt" }}>{row.roman || ""}</td>
                <td className={`py-0.5 px-2.5 ${boldCls}`} style={{ paddingLeft: 12 + indentPx, fontSize: "8pt" }}>{row.label}</td>
                <NoteCell code={row.code} noteNo={row.noteNo} />
                <td className={`text-right tabular-nums py-0.5 px-2.5 ${boldCls}`} style={{ fontSize: "8pt" }}>
                  {editableCY
                    ? <EditableMoneyCell value={row.cy ?? 0} onCommit={(v) => onCommitCY!(row.code!, v === null ? null : isInc ? -v : v)} />
                    : (row.cy === undefined ? "" : formatINR(row.cy))}
                </td>
                <td className={`text-right tabular-nums py-0.5 px-2.5 ${boldCls}`} style={{ fontSize: "8pt" }}>
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
          <div className="font-bold text-sm uppercase tracking-wide text-[#1F3864]">
            {companyName}
          </div>
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
  // 2026-05-30 — "Re-correct from COA" runs the same auto-populate the Notes
  // tab's Re-sync button uses, then refreshes the FS face so the BS / P&L
  // realign with COA mapping when the auditor has deleted breakup rows.
  const [recorrectingFromCOA, setRecorrectingFromCOA] = useState(false);
  // Phase 1 (re-sync flow): non-destructive, finalization-gated notes refresh.
  const [refreshingNotes, setRefreshingNotes] = useState(false);
  // 2026-06-05 Phase 2 — instrumentation for the loading-timer modal that
  // wraps the Re-correct handler. recorrectStartedAt is the timestamp the
  // run kicked off; recorrectElapsedSec ticks every 500ms while the run is
  // in flight. recorrectResult holds the final summary so the modal can
  // show "Done - X notes regenerated in Y seconds" when the run completes
  // (cleared on dismiss).
  const [recorrectStartedAt, setRecorrectStartedAt] = useState<number | null>(null);
  const [recorrectElapsedSec, setRecorrectElapsedSec] = useState(0);
  const [recorrectResult, setRecorrectResult] = useState<{ notes: number; seconds: number } | null>(null);
  useEffect(() => {
    if (recorrectStartedAt == null) return;
    const id = window.setInterval(() => {
      setRecorrectElapsedSec(Math.max(0, (Date.now() - recorrectStartedAt) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [recorrectStartedAt]);

  // 2026-06-05 Phase 5 — same instrumentation for the "Generate Financial
  // Statements" (Export Excel) path. Pixel-perfect Excel generation can
  // take 10-30 seconds on a large engagement; without the modal the
  // auditor couldn't tell whether the click registered. Disables every
  // other interactive surface behind the z-200 backdrop, same as the
  // Re-correct modal.
  const [exportingFS,        setExportingFS]        = useState(false);
  const [exportStartedAt,    setExportStartedAt]    = useState<number | null>(null);
  const [exportElapsedSec,   setExportElapsedSec]   = useState(0);
  const [exportResult,       setExportResult]       = useState<{ ok: boolean; seconds: number; note?: string } | null>(null);
  useEffect(() => {
    if (exportStartedAt == null) return;
    const id = window.setInterval(() => {
      setExportElapsedSec(Math.max(0, (Date.now() - exportStartedAt) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [exportStartedAt]);

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
  // Issue 12 (today) — list-all dialog for the "Manual Overrides" card so
  // the user can click the count and inspect every override at once.
  const [manualOverrideListOpen, setManualOverrideListOpen] = useState(false);
  const [overrideAmount, setOverrideAmount] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState<string>("");
  // (manualOverrideListOpen, declared lower in this component, drives the
  // list dialog opened by clicking the "Manual Overrides" count card.)

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

  const [showCorpFontDialog,  setShowCorpFontDialog]  = useState(false);
  const [corpExportFont,      setCorpExportFont]       = useState("Arial");
  // Task 1 — NCE font dialog (mirrors Corporate dialog)
  const [showNCEFontDialog,   setShowNCEFontDialog]    = useState(false);
  const [nceExportFont,       setNceExportFont]        = useState("Arial");
  // Issue 2 — sub-group notes export COLLAPSED by default (only sub-group name
  // + total). Individual ledgers are emitted only when this is enabled.
  const [corpExpandSubGroups, setCorpExpandSubGroups]  = useState(false);
  // Task 8: Lock Preview — captures notes expand/collapse state for export
  const [nceIsLocked,        setNceIsLocked]        = useState(false);
  const [nceExpandedRows,    setNceExpandedRows]     = useState<Set<string>>(new Set());
  // Task 1 (doc6): preview popup shown immediately when user locks
  const [ncePreviewOpen,     setNcePreviewOpen]      = useState(false);

  // Corporate Preview — mirrors NCE Lock Preview. A single "Lock Preview /
  // Unlock Preview" button toggles a locked state and opens the popup on
  // first lock. Lock state persists in localStorage.
  const [corpIsLocked,    setCorpIsLocked]    = useState(false);
  const [corpPreviewOpen, setCorpPreviewOpen] = useState(false);

  // Bug 2 fix: restore nceIsLocked from localStorage when the engagement changes
  // so a page refresh does not silently unlock a locked preview.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`nce_lock_${engagementId}`);
      setNceIsLocked(stored === "1");
      // Fix E: restore the persisted expand/collapse layout so a refresh — or
      // unlocking the preview — does not reset the notes to the default layout.
      const exp = localStorage.getItem(`nce_expanded_${engagementId}`);
      const parsed = exp ? JSON.parse(exp) : [];
      setNceExpandedRows(Array.isArray(parsed) ? new Set<string>(parsed) : new Set());
    } catch {
      setNceIsLocked(false);
    }
  }, [engagementId]);

  // Bug 2 fix: persist nceIsLocked to localStorage whenever it changes.
  useEffect(() => {
    try {
      if (nceIsLocked) {
        localStorage.setItem(`nce_lock_${engagementId}`, "1");
      } else {
        localStorage.removeItem(`nce_lock_${engagementId}`);
      }
    } catch { /* storage unavailable — ignore */ }
  }, [nceIsLocked, engagementId]);

  // Fix E: persist the edit-mode expand/collapse layout. Only written while
  // UNLOCKED — during a locked preview nceExpandedRows is frozen by the guard
  // in handleNceExpansionStateUpdate, so localStorage keeps the exact state the
  // user had when they pressed Lock. On unlock the editor remounts and seeds its
  // tables from this value, restoring that layout instead of the default.
  useEffect(() => {
    if (nceIsLocked) return;
    try {
      localStorage.setItem(`nce_expanded_${engagementId}`, JSON.stringify([...nceExpandedRows]));
    } catch { /* storage unavailable — ignore */ }
  }, [nceExpandedRows, nceIsLocked, engagementId]);

  // Restore / persist corpIsLocked across page refreshes (mirrors nceIsLocked).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`corp_lock_${engagementId}`);
      setCorpIsLocked(stored === "1");
    } catch {
      setCorpIsLocked(false);
    }
  }, [engagementId]);
  useEffect(() => {
    try {
      if (corpIsLocked) localStorage.setItem(`corp_lock_${engagementId}`, "1");
      else              localStorage.removeItem(`corp_lock_${engagementId}`);
    } catch { /* storage unavailable — ignore */ }
  }, [corpIsLocked, engagementId]);

  // Bug 1 fix: memoized handler so onExpansionStateUpdate keeps the same
  // reference across renders (only recreated when nceIsLocked changes).
  // Without this, every nceExpandedRows state update would recreate the
  // inline function → NCEDetailedNotes re-renders → PatternBTable effects
  // re-fire → setNceExpandedRows again → infinite render loop.
  const handleNceExpansionStateUpdate = useCallback(
    (state: Record<string, Set<string>>) => {
      if (!nceIsLocked) {
        const allIds = new Set(Object.values(state).flatMap(s => [...s]));
        setNceExpandedRows(allIds);
      }
    },
    [nceIsLocked]
  );

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
  // PERF: staleTime prevents unnecessary refetches on window focus / tab switch.
  // FS data doesn't change externally while the user is editing — only explicit
  // saves trigger cache invalidation via queryClient.invalidateQueries.
  const FS_STALE_TIME = 5 * 60 * 1000; // 5 minutes
  const { data: tallyTb, isLoading: tallyTbLoading } = useQuery({
    queryKey: ["tally-tb-fs", engagementId, engagement?.client_id, engagement?.financial_year],
    staleTime: FS_STALE_TIME,
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
    staleTime: FS_STALE_TIME,
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
    staleTime: FS_STALE_TIME,
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

  // ─── Prior-year FA rows (for the Word export's "Total — Previous year") ───
  // Mirrors NotesTab/FAGrid: the FA "Total — Previous year" row is computed
  // from the prior engagement's stage5_notes.fa.rows (pyComputed), with any
  // fa.py_manual overrides applied on top. The export needs these rows to
  // reproduce that row — without them the row would be blank/zero.
  const { data: priorFaRows } = useQuery({
    queryKey: ["prior-fa-rows", engagement?.client_id, engagement?.financial_year],
    staleTime: FS_STALE_TIME,
    queryFn: async () => {
      const fyParts = (engagement.financial_year || "").split("-");
      if (fyParts.length !== 2) return null;
      const prevFy = `${parseInt(fyParts[0]) - 1}-${(parseInt(fyParts[0])).toString().slice(-2)}`;
      const { data: prevEng } = await (supabase.from as any)("audit_engagements")
        .select("stage5_notes")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy)
        .or("is_py_shell.is.null,is_py_shell.eq.false")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const fa = (prevEng as any)?.stage5_notes?.fa?.rows;
      return Array.isArray(fa) ? fa : null;
    },
    enabled: !!engagement?.client_id && !!engagement?.financial_year,
  });

  // ─── Check whether the prior year's engagement is_finalized ──────────────
  // When finalized, PY column cells become read-only (locked).
  const { data: priorEngFinalized } = useQuery({
    queryKey: ["prior-eng-finalized", engagement?.client_id, engagement?.financial_year],
    staleTime: FS_STALE_TIME,
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
    staleTime: FS_STALE_TIME,
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
    staleTime: FS_STALE_TIME,
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

  // ─── PY-shell coa_mapping (2026-06-23) — FALLBACK mapping for FY-1-only
  // (closed) ledgers in the PY column. Regroup-to-CY uses the CURRENT-year
  // coa_mapping first; this PY-shell mapping catches ledgers that no longer
  // exist in CY so they aren't dropped. Passed to computeCOATotals + used as a
  // fallback in the PY-shell amount aggregations so every PY path is identical.
  const { data: pyShellCoaMapping } = useQuery({
    queryKey: ["py-shell-coa", pyShellId],
    staleTime: FS_STALE_TIME,
    queryFn: async (): Promise<Record<string, { code: string }>> => {
      if (!pyShellId) return {};
      const { data } = await (supabase.from as any)("audit_engagements")
        .select("coa_mapping")
        .eq("id", pyShellId)
        .maybeSingle();
      const m = (data?.coa_mapping ?? {}) as Record<string, { code: string }>;
      return m && typeof m === "object" && !Array.isArray(m) ? m : {};
    },
    enabled: !!pyShellId,
  });

  // ─── Firm data — used in the signature block on every BS / P&L / IAR ─────
  // The DISPLAYED firm must be the audit firm chosen in Stage 1 (engagement.
  // audit_firm_id), not the user's logged-in tenant firm (engagement.firm_id).
  // Multi-firm practices select a different audit firm for each engagement
  // (e.g. "AKTA RAMANI & ASSOCIATES" vs the practice's primary firm).
  // The audit firm row may live in either `firms` (created via Firm
  // Management with is_audit_firm=true) or `audit_firms` (legacy). Prefer
  // audit_firm_id; fall back to firm_id for legacy engagements that never
  // had a Stage 1 selection.
  const firmLookupId =
    (engagement as any)?.audit_firm_id || engagement?.firm_id || null;
  const { data: firmData } = useQuery({
    queryKey: ["firm-detail-fs-v4", firmLookupId],
    staleTime: FS_STALE_TIME,
    queryFn: async () => {
      if (!firmLookupId) return null;
      // 1. Try the firms table directly. This is the canonical source for
      //    membership_numbers (the per-partner roster) and FRN.
      const { data } = await supabase
        .from("firms")
        .select("name, display_name, icai_firm_reg_no, icai_reg_no, address, membership_numbers")
        .eq("id", firmLookupId)
        .maybeSingle();
      if (data) {
        const d = data as any;
        return { ...d, name: d.display_name || d.name } as any;
      }
      // 2. Legacy: firmLookupId points at audit_firms (parallel table used
      //    before is_audit_firm rollout). Resolve via FRN — the audit_firms
      //    row carries icai_reg_no (e.g. "113541W") and the parallel firms
      //    row carries the same value in either icai_firm_reg_no or
      //    icai_reg_no. FRN match is reliable across legal-name variants
      //    ("V J Desai & Co. LLP" vs "V. J. Desai & Co.").
      const { data: af } = await supabase
        .from("audit_firms")
        .select("name, icai_reg_no, address")
        .eq("id", firmLookupId)
        .maybeSingle();
      if (!af) return null;
      const afFrn  = ((af as any).icai_reg_no || "").trim();
      const afName = ((af as any).name || "").trim();
      let parentFirm: any = null;
      if (afFrn) {
        // FRN match against either firms column.
        const { data: byFrn } = await supabase
          .from("firms")
          .select("name, display_name, icai_firm_reg_no, icai_reg_no, address, membership_numbers")
          .or(`icai_firm_reg_no.eq.${afFrn},icai_reg_no.eq.${afFrn}`);
        parentFirm = (byFrn || [])[0] || null;
      }
      if (!parentFirm && afName) {
        // Last-resort: case-insensitive substring on the firm name.
        const { data: byName } = await supabase
          .from("firms")
          .select("name, display_name, icai_firm_reg_no, icai_reg_no, address, membership_numbers")
          .ilike("name", `%${afName.replace(/\./g, "").trim()}%`);
        parentFirm = (byName || [])[0] || null;
      }
      return {
        name: parentFirm?.display_name || parentFirm?.name || afName,
        icai_firm_reg_no: parentFirm?.icai_firm_reg_no || afFrn,
        icai_reg_no: parentFirm?.icai_reg_no || afFrn,
        address: parentFirm?.address || (af as any).address,
        membership_numbers: Array.isArray(parentFirm?.membership_numbers)
          ? parentFirm.membership_numbers
          : [],
      };
    },
    enabled: !!firmLookupId,
  });

  // ─── Partner user data (NCE signature block) ──────────────────────────────
  // Optional fallback: some legacy engagements still store partner_id and
  // reference a row in `users`. New engagements use partner_name + the
  // firm's membership_numbers lookup (handled below in sigPartnerName /
  // sigMembershipNo).
  const { data: partnerData } = useQuery({
    queryKey: ["partner-user-fs", (engagement as any)?.partner_id],
    staleTime: FS_STALE_TIME,
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
    staleTime: FS_STALE_TIME,
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
    staleTime: FS_STALE_TIME,
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
    staleTime: FS_STALE_TIME,
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
    staleTime: FS_STALE_TIME,
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
    staleTime: FS_STALE_TIME,
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

  // ─── Phase 1 (re-sync flow): Notes-staleness detection ───────────────────
  // The BS/PL face reads the persisted nce_financial_notes snapshot, not live
  // TB. After a Tally re-sync the COA anchor moves but the note snapshot does
  // not, so the face silently shows stale figures behind a red drift panel.
  // We compare the latest TB sync time against the latest notes update time
  // and surface a clear banner. This is detection only — it never mutates any
  // data (notes remain write-protected; refresh is a separate, gated action).
  const { data: notesStalenessRaw } = useQuery({
    queryKey: ["notes-staleness", engagementId, engagement?.financial_year],
    staleTime: 30_000,
    queryFn: async () => {
      // Latest TB sync timestamp for this engagement.
      const { data: tbRow } = await (supabase.from as any)("tally_trial_balance")
        .select("synced_at")
        .eq("engagement_id", engagementId)
        .order("synced_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      // Latest notes update timestamp for this engagement + FY.
      const { data: noteRow } = await (supabase.from as any)("nce_financial_notes")
        .select("updated_at")
        .eq("engagement_id", engagementId)
        .eq("financial_year", engagement?.financial_year ?? "")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      // notes_finalized flag — when true, notes are write-protected and the
      // refresh action must NOT be offered.
      const { data: engRow } = await (supabase.from as any)("audit_engagements")
        .select("notes_finalized")
        .eq("id", engagementId)
        .maybeSingle();
      return {
        latestTbSyncedAt: (tbRow as any)?.synced_at ?? null,
        latestNotesUpdatedAt: (noteRow as any)?.updated_at ?? null,
        notesFinalized: (engRow as any)?.notes_finalized ?? false,
      };
    },
    enabled: !!engagementId && !!engagement?.financial_year && isNonCorporate,
  });

  const notesStaleness = useMemo(
    () => evaluateNotesStaleness({
      latestTbSyncedAt: notesStalenessRaw?.latestTbSyncedAt,
      latestNotesUpdatedAt: notesStalenessRaw?.latestNotesUpdatedAt,
      notesFinalized: notesStalenessRaw?.notesFinalized,
    }),
    [notesStalenessRaw],
  );

  // ─── AUTO-SYNC: Ensure NCE notes always reflect current COA mapping ─────
  // ROOT CAUSE FIX: previously, notes were only populated when the user
  // visited the Notes tab (Stage 8) or clicked "Re-correct from COA". If
  // COA mapping changed (or was set up) AFTER the initial populate, the
  // notes became stale — some COA-mapped ledgers never flowed into the
  // notes, causing Note Total < COA Total and making the BS/PL face
  // diverge from COA mapping.
  //
  // Fix: on Stage 7 mount, silently run nceAutoPopulate in the background.
  // This preserves all manual rows and only rebuilds auto rows from the
  // current TB × COA mapping. The result: notes always match COA mapping,
  // and the face (which reads note totals) matches notes. The COA→Notes→
  // Face chain is complete.
  // v3: switched from sessionStorage (once-per-session) to a COA-mapping
  // CONTENT HASH stored in localStorage. ROOT CAUSE of "Web Developing Fees
  // Exp not showing": the v2 sessionStorage guard ran auto-sync only ONCE per
  // browser session. If the auditor mapped a new ledger AFTER the first
  // Stage 7 visit, the re-sync never ran again that session, so the new
  // ledger never flowed into the note. The content-hash approach re-syncs
  // whenever the COA mapping changes (compared to the last successful sync),
  // persists across sessions, and skips needless re-runs when nothing changed.
  // AUTO-SYNC DISABLED — was overwriting audit-verified note data on every
  // Stage 7 visit. The Notes tab "Re-sync from COA" button has also been
  // removed. Notes are now only modified by direct DB writes (audit-team
  // SQL fixes that should persist).
  useEffect(() => { /* no-op */ }, [engagementId, isNonCorporate, engagement?.financial_year]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Fetch NCE Stage-7 "Notes to Accounts" (Balance Confirmation, etc.) ──
  // The Note 1 sheet in the Excel export must reflect what the user has
  // typed / toggled / reordered in the Note 1 tab of Stage 7, not a hardcoded
  // boilerplate list of accounting policies.
  const { data: notesToAccountsData } = useQuery({
    queryKey: ["notes-to-accounts-data", engagementId],
    staleTime: FS_STALE_TIME,
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
    tally_debit: number; tally_credit: number;
  }[] = useMemo(() => {
    if (!tallyTb?.length) return [];
    return tallyTb.map((l: any) => {
      return {
        account_name:  String(l.ledger_name || "").trim(),
        account_group: l.parent_group || "",
        // Break #7 fix: use fsSignConvention instead of inline isDr ? cb : -cb
        balance: fsSignedBalance(l.closing_balance, l.balance_type, "DR"),
        opening_balance: fsSignedOpening(l.opening_balance, l.opening_type, "DR"),
        // Current-year journal movement — needed by the shared books-closed
        // detection so FS and the COA-mapping screen credit net profit identically.
        tally_debit:  Number(l.debit_amount  ?? 0),
        tally_credit: Number(l.credit_amount ?? 0),
      };
    }).filter((a: any) => a.account_name);
  }, [tallyTb]);

  // ─── Ledger aliases (Task 3 in PipelineStage3) ───────────────────────────
  // 2026-06-01 — User reported COA Mapping screen and FS BS showing DIFFERENT
  // PY totals on MAHARSH INFRA's Trade Payables (1,23,35,971 vs 1,26,66,373).
  // Root cause: Stage3 applies these aliases when summing PY opening balances
  // (line 1750-1751) — they let the auditor say "this CY ledger was previously
  // mapped to a different code in PY". FS skipped the alias step entirely, so
  // any opening balance the alias redirected away from a code was still
  // counted there by FS, producing a higher PY total.
  //
  // Fix: load the same `ledger_aliases` table and mirror Stage3's resolution
  // order (alias name → original name) when computing computedAmountsPY and
  // fsDisplayData's exportPy below. Now FS uses the same aggregation logic
  // as COA Mapping for every engagement, so the two screens always agree.
  const { data: aliasRows } = useQuery({
    queryKey: ["ledger-aliases-fs", engagement?.client_id],
    staleTime: FS_STALE_TIME,
    queryFn: async () => {
      if (!engagement?.client_id) return [];
      const { data } = await (supabase.from as any)("ledger_aliases")
        .select("prior_ledger_name, current_ledger_name")
        .eq("client_id", engagement.client_id);
      return (data || []) as any[];
    },
    enabled: !!engagement?.client_id,
  });
  const aliases: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of (aliasRows ?? []) as any[]) {
      if (r?.prior_ledger_name && r?.current_ledger_name) {
        m[r.prior_ledger_name] = r.current_ledger_name;
      }
    }
    return m;
  }, [aliasRows]);

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
      m.set(name, {
        opening: fsSignedOpening(row.opening_balance, row.opening_type, "DR"),
        closing: fsSignedBalance(row.closing_balance, row.balance_type, "DR"),
      });
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

  // ─── PY P&L from PY-shell TB (Issue 1 fix — Current/Deferred tax PY missing) ─
  // The COA Mapping screen's PY column reads P&L figures from the PY-shell trial
  // balance (Stage3.tsx → pyShellPLAmounts). The FS screen previously only read
  // PY P&L from `priorEngagement` (saved fa_financial_statements) plus
  // `pyManualAmounts` — for clients with a PY shell TB but no SAVED prior FS
  // (the common case: PY shell created by sync-py.js with TB rows but no
  // engagement-level fs_data persisted), every P&L PY value stayed at 0. The
  // user saw "Current Tax PY 16,44,000" on COA Mapping but blank on the FS P&L
  // for ACCU PANELS — same data, two divergent screens.
  //
  // Fix: derive a PY P&L map from PY-shell TB using CY coa_mapping (case-
  // insensitive lookup) and inject it into both mergedPY and fsDisplayData's
  // exportPy as a fallback whenever the higher-priority sources are empty.
  // BS codes still come from CY opening balances (authoritative, self-balancing
  // source) — only PL codes are filled here.
  const pyShellPLAmounts: Record<string, number> = useMemo(() => {
    if (!pyShellTb?.length) return {};
    const amounts: Record<string, number> = {};
    const cyMappingLower: Record<string, { code: string }> = {};
    for (const [k, v] of Object.entries(coaMapping || {})) {
      if (v?.code) cyMappingLower[k.toLowerCase().trim()] = v;
    }
    for (const row of pyShellTb) {
      const name = String(row.ledger_name || "").trim();
      if (!name) continue;
      const mapped = (coaMapping as any)[name] || cyMappingLower[name.toLowerCase()];
      if (!mapped?.code) continue;
      const item = activeFlatItems.find(i => i.code === mapped.code);
      if (!item) continue;
      const sec = String((item as any).section || "").toLowerCase();
      const isPL = sec.includes("pl") || sec.includes("revenue")
                || sec.includes("expense") || sec.includes("income");
      if (!isPL) continue;
      const signed = fsSignedBalance(row.closing_balance, row.balance_type, "DR");
      if (Math.abs(signed) < 0.005) continue;
      amounts[mapped.code] = (amounts[mapped.code] || 0) + signed;
    }
    // Roll up parent P&L nodes so any consumer reading PL_TAX (sum of CUR+DEF)
    // gets the aggregated total even if only the leaves were populated.
    const computeParent = (item: FSLineItem): number => {
      const sec = String(item.section || "").toLowerCase();
      const isPL = sec.includes("pl") || sec.includes("revenue") || sec.includes("expense");
      if (!isPL) return 0;
      if (!item.children || item.children.length === 0) return amounts[item.code] || 0;
      const total = item.children.reduce((s, c) => s + computeParent(c), 0);
      if (total !== 0) amounts[item.code] = total;
      return total;
    };
    for (const item of activeTree) computeParent(item);
    return amounts;
  }, [pyShellTb, coaMapping, activeFlatItems, activeTree]);

  // ─── PY BS from PY-shell TB (Root-cause fix: FS PY ↔ COA Mapping PY must match) ─
  // Same source the COA Mapping Variance Drill reads — PY-shell trial-balance
  // closing balances aggregated through the CURRENT engagement's coa_mapping.
  // Before this, BS PY came from CY-TB opening_balance, which can diverge from
  // the PY-shell TB closing whenever a Tally year-end JE (e.g. profit transfer
  // to partner capital) lands after the PY shell sync — producing FS BS PY
  // values that don't reconcile with the COA Mapping screen for the same code.
  // By reading the SAME source for BS codes that the COA screen uses, the two
  // screens are mathematically guaranteed to agree (BS face PY = COA Mapping PY
  // for every line, on every corporate and non-corporate client).
  const pyShellBSAmounts: Record<string, number> = useMemo(() => {
    if (!pyShellTb?.length) return {};
    const amounts: Record<string, number> = {};
    const cyMappingLower: Record<string, { code: string }> = {};
    for (const [k, v] of Object.entries(coaMapping || {})) {
      if (v?.code) cyMappingLower[k.toLowerCase().trim()] = v;
    }
    for (const row of pyShellTb) {
      const name = String(row.ledger_name || "").trim();
      if (!name) continue;
      const mapped = (coaMapping as any)[name] || cyMappingLower[name.toLowerCase()];
      if (!mapped?.code) continue;
      const item = activeFlatItems.find(i => i.code === mapped.code);
      if (!item) continue;
      const sec = String((item as any).section || "").toLowerCase();
      const isBS = sec.includes("bs") || sec.includes("asset") || sec.includes("liab") || sec.includes("equity");
      if (!isBS) continue;
      const signed = fsSignedBalance(row.closing_balance, row.balance_type, "DR");
      if (Math.abs(signed) < 0.005) continue;
      amounts[mapped.code] = (amounts[mapped.code] || 0) + signed;
    }
    // Roll up BS parent nodes so consumers reading NCE_OWN / NCE_EL / BS_EQ
    // get the aggregated total when only the leaves were populated.
    const computeParent = (item: FSLineItem): number => {
      const sec = String(item.section || "").toLowerCase();
      const isBS = sec.includes("bs") || sec.includes("asset") || sec.includes("liab") || sec.includes("equity");
      if (!isBS) return 0;
      if (!item.children || item.children.length === 0) return amounts[item.code] || 0;
      const total = item.children.reduce((s, c) => s + computeParent(c), 0);
      if (total !== 0) amounts[item.code] = total;
      return total;
    };
    for (const item of activeTree) computeParent(item);
    return amounts;
  }, [pyShellTb, coaMapping, activeFlatItems, activeTree]);
  const hasPyShellBS = Object.keys(pyShellBSAmounts).length > 0;

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
  // Robust check: PY data is considered synced if EITHER the PY-shell TB has
  // rows OR a prior-year FA snapshot exists. Handles the case where py_source
  // is "prior_engagement" but a PY shell with TB rows also exists, which
  // previously incorrectly showed the "sync pending" banner.
  const pyShellSyncDone: boolean =
    (pyShellTb?.length ?? 0) > 0 || !noPriorEngagement;

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
      } else if (mapping.code === "PL_EXP_CII" || mapping.code === "NCE_CII") {
        // ── Direct CII mapping (2026-06-18 fix): a ledger the auditor mapped
        // straight to "Changes in Inventories of FG/WIP/SIT" represents an
        // INVENTORY BALANCE, not a movement. Schedule III defines CII as
        // (opening − closing), so contribute the opening-to-closing delta
        // here instead of just the closing balance. Mirrors the dual-post
        // path above for INV_* mappings — that path uses (opening − closing)
        // for inventory ledgers mapped to INV_STOCK / INV_RM / etc.
        //
        // Prior bug (MICROCIRCUITS, June 2026): "Opening Stock" was mapped
        // directly to PL_EXP_CII (the only "changes" line in the picker).
        // The else-branch below would add `acct.balance` (closing only) so
        // the P&L showed ₹67,06,470.80 instead of the correct delta
        // ₹4,77,074.42. The mirror in fsDisplayData carries the same change.
        amounts[mapping.code] = (amounts[mapping.code] || 0) + ((acct.opening_balance ?? 0) - acct.balance);
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

    // ── PPE Schedule → FS (authoritative source) ──────────────────────────
    // The nce_ppe_schedule closing balances drive the BS face, and its total
    // depreciation drives the P&L charge: tangible closing → NCE_PPE,
    // intangible closing → NCE_INTG, total depreciation → NCE_DEPR. NCE_DEPR is
    // a child of NCE_PL_EXP, so the computeTotal roll-up + profit chain below
    // recompute net profit (and hence Capital) from the schedule figure — the
    // BS stays internally consistent. When the schedule disagrees with the book
    // (TB) value the BS no longer balances → export is blocked (strict),
    // forcing the auditor to reconcile the schedule to the ledger. An empty
    // schedule yields 0, so note 10 earns no number and is not exported.
    if (isNonCorporate && Array.isArray(ncePpeData)) {
      const ppeClosingOf = (cat: string) =>
        ncePpeData
          .filter((r: any) => (r.asset_category ?? "") === cat)
          .reduce((s: number, r: any) => s + (Number(r.closing_balance) || 0), 0);
      amounts["NCE_PPE"]  = Math.round(ppeClosingOf("tangible")   * 100) / 100;
      amounts["NCE_INTG"] = Math.round(ppeClosingOf("intangible") * 100) / 100;
      amounts["NCE_DEPR"] = Math.round(
        ncePpeData.reduce((s: number, r: any) => s + (Number(r.depreciation) || 0), 0) * 100,
      ) / 100;
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

    // ── Auto-flow net P&L to BS_EQ_RS ─────────────────────────────────────────
    // Revenue and Expenses are P&L codes, not BS codes. The current-year net
    // profit must be credited to the BS so it balances. For corporate entities
    // this credits "Reserves & Surplus" (BS_EQ_RS). For NCE entities it credits
    // BS_EQ_RS which is later folded into NCE_CAP (Capital Account) in
    // nceCyAmounts.
    //
    // WHY THIS IS NEEDED: Tally's TB has a "Profit & Loss A/c" ledger whose
    // CLOSING balance = current year's net profit. The code at line ~3013 uses
    // OPENING balance (prior retained earnings) for this ledger to avoid
    // double-counting with the individual P&L accounts. But this means the
    // current year's net profit is EXCLUDED from computedAmounts — unless we
    // add it back here via auto-credit. Previously this block was guarded by
    // `!isNonCorporate`, skipping NCE entirely — every NCE client's BS was
    // out of balance by the net profit amount.
    //
    // BOOKS-CLOSED GUARD: when the firm has already journalled the year's P&L
    // into a reserves/capital ledger, the closing balance ALREADY includes the
    // profit — crediting again would double-count.
    if (!isNonCorporate) {
      const reservesLedgers = tbAccounts.filter(a => coaMapping[a.account_name]?.code === "BS_EQ_RS");
      const booksClosed = currentYearProfitAlreadyInReserves(reservesLedgers);
      const rev   = amounts["PL_REV"] || 0; // negative (credit)
      const exp   = amounts["PL_EXP"] || 0; // positive (debit)
      const netPL = Math.round((-rev - exp) * 100) / 100;
      if (!booksClosed && Math.abs(netPL) > 0.005) {
        // Credit net profit to Reserves (negative = credit in Tally sign convention)
        amounts["BS_EQ_RS"] = (amounts["BS_EQ_RS"] || 0) - netPL;
        // Re-run the full tree so every parent (BS_EQ → BS root) picks up the change.
        // Calling only computeTotal(bsEqNode) leaves the BS root total stale.
        for (const item of (activeTree as FSLineItem[])) {
          computeTotal(item);
        }
      }
    } else {
      // 2026-06-11 — NCE CY net-profit auto-credit (smart-gated mirror of the
      // corporate path above + the PY auto-credit in mergedPY).
      //
      // The historical assumption "Tally's partner capital closing already
      // includes the current-year profit" holds ONLY when the firm has actually
      // posted Tally's year-end closing JE. For NCE clients whose books are
      // STILL open at audit time (SUKIRTI, SKYLARK, ...), the P&L group has
      // not been transferred to capital — so BS shows drift = exactly the
      // year's net profit (this is the recurring SUKIRTI / SKYLARK pattern
      // we'd been calling a "deferred next-phase issue").
      //
      // Drift-aware gate: snapshot BS CY drift WITH the credit vs WITHOUT,
      // apply only if it improves balance by ≥ ₹1. Books-not-closed → credit
      // fires. Books-already-closed → credit reduces balance → skip → no
      // double-count.
      const nceInc = amounts["NCE_PL_INC"] || 0;
      const nceExp = amounts["NCE_PL_EXP"] || 0;
      const partRem = amounts["NCE_PART_REM"] || 0;
      const tax    = amounts["NCE_TAX"]      || 0;
      const cyNetPL = Math.round(((-nceInc) - nceExp - partRem - tax) * 100) / 100;
      if (Math.abs(cyNetPL) > 0.005) {
        const astSum = NCE_ASSET_IDS.reduce((s, id) => s + (amounts[id] || 0), 0);
        const elSum  = NCE_LIAB_IDS.reduce((s, id) => s + (amounts[id] || 0), 0);
        const driftWithout = Math.abs(astSum + elSum);
        const driftWith    = Math.abs(astSum + elSum - cyNetPL);
        if (driftWith + 1 < driftWithout) {
          // Credit lands on BS_EQ_RS — the same intermediate slot used by the
          // corporate path. nceCyAmounts will fold BS_EQ_RS → NCE_CAP later.
          amounts["BS_EQ_RS"] = (amounts["BS_EQ_RS"] || 0) - cyNetPL;
          for (const item of (activeTree as FSLineItem[])) {
            computeTotal(item);
          }
        }
      }
    }

    return amounts;
  }, [tbAccounts, coaMapping, manualOverrides, isNonCorporate, ncePpeData]);

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
      // 2026-06-01 — Mirror PipelineStage3's alias resolution so FS computes
      // the same PY opening-balance aggregate the COA Mapping screen shows.
      // If a ledger has an alias entry, prefer the alias's mapping; fall back
      // to the original name's mapping. The two screens must always agree on
      // BS PY totals — divergence was causing MAHARSH INFRA Trade Payables PY
      // to read 1,26,66,373 on the FS while COA Mapping showed 1,23,35,971.
      const aliasName = aliases[acct.account_name];
      const mapping = (aliasName ? coaMapping[aliasName] : null)
                   ?? coaMapping[acct.account_name];
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
  }, [tbAccounts, coaMapping, activeTree, aliases]);

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
    // Issue 1 fix — fall back to PY-shell TB for any P&L code still missing
    // after pyAmounts / pyManualAmounts. Matches the COA Mapping screen which
    // reads PY P&L from PY-shell TB closing balances. Without this, codes the
    // prior engagement never persisted (commonly PL_TAX_CUR / PL_TAX_DEF, or
    // every code when there's no saved PY fs_data at all) stayed at 0 on the
    // FS while showing the correct value on COA Mapping for the same engagement.
    for (const [code, val] of Object.entries(pyShellPLAmounts)) {
      if (!Number.isFinite(val)) continue;
      const cur = merged[code];
      if (cur === undefined || cur === null || Math.abs(cur as number) < 0.005) {
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
    // ── Root-cause override: when the PY shell TB is present, the BS column
    // is sourced EXCLUSIVELY from the PY-shell TB through the current
    // coa_mapping (same source the COA Mapping Variance Drill reads). Two
    // steps:
    //   (1) clear every BS code so stale values from pyAmounts (saved prior FS),
    //       computedAmountsPY (CY-TB opening) or pyManualAmounts cannot leak
    //       through for codes that have NO ledger mapped to them. Without this
    //       a code like "Short-term borrowings" with zero mapped ledgers in COA
    //       would still display a leftover figure on the FS face while COA
    //       Mapping shows it empty — the OM REALTY symptom the user reported.
    //   (2) overwrite from pyShellBSAmounts. Mapped codes get the PY-shell sum;
    //       unmapped codes remain 0 — guaranteeing FS BS PY == COA Mapping PY
    //       for every code, on every (NCE and corporate) client.
    if (hasPyShellBS) {
      for (const item of activeFlatItems) {
        const sec  = String((item as any).section || "").toLowerCase();
        const isBS = sec.includes("bs") || sec.includes("asset") || sec.includes("liab") || sec.includes("equity");
        if (isBS) delete (merged as any)[item.code];
      }
      for (const [code, val] of Object.entries(pyShellBSAmounts)) {
        if (!Number.isFinite(val)) continue;
        merged[code] = val;
      }
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

    // ── NCE PY profit chain (V → XIII) ────────────────────────────────────
    // Mirror the CY profit-chain computation (line ~2667). Without this the
    // PY column for rows V, VII, IX, XI, XIII renders blank even when Total
    // Income (III) and Total Expenses (IV) are populated, because these
    // subtotals are derived by subtraction — they have no children in the
    // FS tree, so computePL() above leaves them at zero.
    if (isNonCorporate) {
      const inc = merged["NCE_PL_INC"] || 0;
      const exp = merged["NCE_PL_EXP"] || 0;
      merged["NCE_PROF_V"]   = Math.round((-inc - exp) * 100) / 100;
      merged["NCE_PROF_VII"] = Math.round((merged["NCE_PROF_V"]   - (merged["NCE_EXCEP"]    || 0)) * 100) / 100;
      merged["NCE_PROF_IX"]  = Math.round((merged["NCE_PROF_VII"] - (merged["NCE_EXTORD"]   || 0)) * 100) / 100;
      merged["NCE_PROF_XI"]  = Math.round((merged["NCE_PROF_IX"]  - (merged["NCE_PART_REM"] || 0)) * 100) / 100;
      merged["NCE_NET_PROF"] = Math.round((merged["NCE_PROF_XI"]  - (merged["NCE_TAX"]      || 0)) * 100) / 100;
    }

    // ── Auto-credit PY net profit to BS_EQ_RS (mirrors CY computedAmounts logic) ──
    // PY P&L amounts are now in `merged` (from pyAmounts / pyManualAmounts).
    // Compute PY net profit and credit it to Reserves & Surplus so the
    // comparative Balance Sheet balances — same closing entry the CY side does.
    // Skipped when the PY-shell TB is the source of BS values, because the
    // closing balance there already reflects any year-end profit-transfer JE
    // posted in Tally — re-crediting it here would double-count and diverge
    // from the COA Mapping screen for the same code.
    if (!isNonCorporate && !hasPyShellBS) {
      const pyRev   = merged["PL_REV"] || 0; // negative (credit balance)
      const pyExp   = merged["PL_EXP"] || 0; // positive (debit balance)
      const pyNetPL = Math.round((-pyRev - pyExp) * 100) / 100;
      if (Math.abs(pyNetPL) > 0.005) {
        merged["BS_EQ_RS"] = (merged["BS_EQ_RS"] || 0) - pyNetPL;
        // Re-run BS tree totals so BS_EQ, BS root pick up the change
        const computeBSTotal = (item: FSLineItem): number => {
          const sec = String(item.section || "").toLowerCase();
          const isBS = sec.includes("bs") || sec.includes("asset") || sec.includes("liab") || sec.includes("equity");
          if (!isBS) return 0;
          if (!item.children || item.children.length === 0) return merged[item.code] || 0;
          const total = item.children.reduce((sum, child) => sum + computeBSTotal(child), 0);
          merged[item.code] = total;
          return total;
        };
        for (const item of activeTree) computeBSTotal(item);
      }
    }

    // 2026-05-30 — NCE PY net-profit auto-credit to NCE_CAP.
    //
    // For partnerships / proprietorships, the PY profit is journalled into
    // partner / proprietor capital at year-end. This auto-credit is only
    // required when BS PY codes come from CY-TB opening balances — those
    // reflect the post-profit-transfer state on the asset side, so Capital
    // must also be lifted by the PY profit for the BS to balance.
    //
    // 2026-06-06 — Refined guard (SHREE MARUTI INFRA fix):
    // The credit is SKIPPED only when pyShellBSAmounts already contains
    // NCE_CAP — i.e. the auditor mapped the capital / P&L ledger(s) in COA
    // Mapping, so the pyShell closing balance already encodes the profit
    // transfer (OM REALTY case: re-crediting would double-count and diverge
    // from COA Mapping for that code).
    //
    // When hasPyShellBS=true but NCE_CAP is ABSENT from pyShellBSAmounts
    // (capital ledger not yet mapped — "COA mapping pending"), mergedPY sets
    // NCE_CAP = 0 (hasPyShellBS block clears every BS code then only writes
    // back mapped ones). The Tally books still balance because Tally carries
    // the profit in its internal P&L group, but OUR BS is short by exactly
    // the PY net profit → apply the credit so the PY BS check is correct.
    if (isNonCorporate) {
      const pyInc   = merged["NCE_PL_INC"] || 0;
      const pyExp   = merged["NCE_PL_EXP"] || 0;
      const pyPartRem = merged["NCE_PART_REM"] || 0;
      const pyTax     = merged["NCE_TAX"]      || 0;
      // PY net profit AFTER partners' remuneration and tax — same as the
      // P&L statement's bottom line. Crediting only this number to Capital
      // matches the way Tally journals partnership profit at year-end.
      const pyNetPL = Math.round(((-pyInc) - pyExp - pyPartRem - pyTax) * 100) / 100;
      // 2026-06-11 — Smart-gate the auto-credit so it ALWAYS fires when the
      // BS PY would balance better WITH the credit than WITHOUT, regardless of
      // whether pyShellBSAmounts contains NCE_CAP. This covers the common NCE
      // case where the auditor mapped capital in COA but Tally PY books are
      // not yet closed (capital ledger closing does NOT yet include profit) —
      // BS would otherwise show drift equal to PY net profit. The earlier gate
      // skipped this case and is now retained as an EXPLICIT trigger only for
      // the unconditional path (no pyShellBS), with the additional drift-aware
      // path below it.
      const unconditional = !hasPyShellBS || !("NCE_CAP" in pyShellBSAmounts);
      let shouldCredit = unconditional;
      if (!unconditional && Math.abs(pyNetPL) > 0.005) {
        // Snapshot BS PY drift WITHOUT credit vs WITH credit. Liability codes
        // are stored negative in merged (CR-natural), so adding the credit to
        // NCE_CAP — which makes it MORE negative when pyNetPL > 0 — moves the
        // Σ(NCE_AST) + Σ(NCE_EL) sum toward 0. Pick whichever path balances.
        const astSum = NCE_ASSET_IDS.reduce((s, id) => s + (merged[id] || 0), 0);
        const elSum  = NCE_LIAB_IDS.reduce((s, id) => s + (merged[id] || 0), 0);
        const driftWithout = Math.abs(astSum + elSum);
        const driftWith    = Math.abs(astSum + elSum - pyNetPL);
        shouldCredit = driftWith + 1 < driftWithout; // require ≥ ₹1 improvement
      }
      if (shouldCredit && Math.abs(pyNetPL) > 0.005) {
        merged["NCE_CAP"] = (merged["NCE_CAP"] || 0) - pyNetPL;
        // Re-run BS tree totals so NCE_EL / NCE_AST pick up the change.
        const computeBSTotal = (item: FSLineItem): number => {
          const sec = String(item.section || "").toLowerCase();
          const isBS = sec.includes("bs") || sec.includes("asset") || sec.includes("liab") || sec.includes("equity");
          if (!isBS) return 0;
          if (!item.children || item.children.length === 0) return merged[item.code] || 0;
          const total = item.children.reduce((sum, child) => sum + computeBSTotal(child), 0);
          merged[item.code] = total;
          return total;
        };
        for (const item of activeTree) computeBSTotal(item);
      }
      // 2026-06-12 — PY BS residual absorber.
      // After applying the standard PY net-profit credit, ANY remaining BS
      // imbalance comes from PY-shell TB ledgers that aren't mapped to a
      // proper FS code (typical: partner introductions/drawings, internal
      // P&L ledger, unmapped misc). The user explicitly excludes the Capital
      // Account from the "match COA" requirement so it can absorb whatever
      // residual is needed to make BS balance.
      const astSumPost = NCE_ASSET_IDS.reduce((s, id) => s + (merged[id] || 0), 0);
      const elSumPost  = NCE_LIAB_IDS.reduce((s, id) => s + (merged[id] || 0), 0);
      const residual = astSumPost + elSumPost; // sign: + = Assets exceed E+L
      // PD-1 / D2.1 (FS_NO_CAPITAL_PLUG): when ON, do NOT plug the imbalance into
      // Capital — let the true residual stand so BS shows unbalanced and export blocks.
      if (!FS_NO_CAPITAL_PLUG && Math.abs(residual) > 2 && Math.abs(residual) < 1e9) {
        // Bring NCE_CAP further down (more negative for CR-natural storage)
        // by the residual. This adds to the liability side, balancing BS.
        merged["NCE_CAP"] = (merged["NCE_CAP"] || 0) - residual;
        const computeBSTotal2 = (item: FSLineItem): number => {
          const sec = String(item.section || "").toLowerCase();
          const isBS = sec.includes("bs") || sec.includes("asset") || sec.includes("liab") || sec.includes("equity");
          if (!isBS) return 0;
          if (!item.children || item.children.length === 0) return merged[item.code] || 0;
          const total = item.children.reduce((sum, child) => sum + computeBSTotal2(child), 0);
          merged[item.code] = total;
          return total;
        };
        for (const item of activeTree) computeBSTotal2(item);
      }
    }

    return merged;
  }, [computedAmountsPY, pyAmounts, pyManualAmounts, pyShellPLAmounts, pyShellBSAmounts, hasPyShellBS, noPriorEngagement, activeFlatItems, activeTree, pyInvCII, isNonCorporate]);

  // ─── NCE Dynamic Note Number Map ────────────────────────────────────────────
  // Maps originalNoteRef → dynamicSequentialNoteNo for NCE entities.
  // Only notes with non-zero CY or PY FS amounts (plus always-active notes 1,2)
  // get a dynamic number. Note 10 (PPE) is now data-driven via the schedule
  // override in computedAmounts. Inactive notes return undefined → suppressed.
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
      // 2026-06-01 — Apply alias resolution to PY only (matches Stage3
      // semantics). Aliases let the auditor say a CY ledger's PY closing
      // (= opening balance on CY TB) was previously classified to a
      // different code; without this redirection the FS PY total drifted
      // from COA Mapping's PY total.
      const aliasName = aliases[acct.account_name];
      const pyMapping = (aliasName ? coaMapping[aliasName] : null) ?? mapping;
      if (!mapping && !pyMapping) continue;
      const opening = acct.opening_balance ?? 0;
      const plCode  = mapping ? INV_DUAL_MAP[mapping.code]  : undefined;
      if (plCode && mapping) {
        // Dual-post CY: BS closing balance + P&L Changes in Inventories
        exportCy[mapping.code] = (exportCy[mapping.code] || 0) + (acct.balance || 0);
        exportCy[plCode] = (exportCy[plCode] || 0) + (opening - (acct.balance || 0));
        // PY BS: opening balance routed via alias-aware mapping
        if (opening && pyMapping) exportPy[pyMapping.code] = (exportPy[pyMapping.code] || 0) + opening;
        hasInvMappingLocal = true;
      } else if (mapping && (mapping.code === "PL_EXP_CII" || mapping.code === "NCE_CII")) {
        // 2026-06-18 fix — mirror the computedAmounts loop above. A ledger
        // mapped directly to "Changes in Inventories" represents an
        // inventory BALANCE, so contribute (opening − closing) per
        // Schedule III, not just closing. Without this, the export and
        // on-screen P&L disagreed with the COA Mapping variance drill.
        exportCy[mapping.code] = (exportCy[mapping.code] || 0) + (opening - (acct.balance || 0));
        // PY BS: opening balance routed via alias-aware mapping (BS inventory
        // line — the PY balance of this same ledger). Keeps the BS face PY
        // column in sync with the CY closing → PY opening identity.
        if (opening && pyMapping) exportPy[pyMapping.code] = (exportPy[pyMapping.code] || 0) + opening;
        hasInvMappingLocal = true;
      } else {
        if (mapping) exportCy[mapping.code] = (exportCy[mapping.code] || 0) + (acct.balance || 0);
        if (opening && pyMapping) exportPy[pyMapping.code] = (exportPy[pyMapping.code] || 0) + opening;
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
    // Issue 1 fix (mirror of mergedPY fallback) — fill any P&L code still
    // missing in exportPy from PY-shell TB so the FS P&L PY column matches
    // the COA Mapping PY column. Critical for codes the prior engagement
    // didn't persist (PL_TAX_CUR / PL_TAX_DEF being the most common).
    for (const [code, val] of Object.entries(pyShellPLAmounts || {})) {
      if (!Number.isFinite(val)) continue;
      const cur = exportPy[code];
      if (cur === undefined || Math.abs(cur) < 0.005) {
        exportPy[code] = val as number;
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
      // PY COMPARATIVE BALANCE SHEET — derive from the current-year OPENING
      // balances (exportPy), the same self-balancing source the COA-mapping
      // screen uses, in preference to the note breakup sum.  The note PY can be
      // sourced from a PY-shell snapshot (py_source = "py_shell") whose closing
      // balances no longer tie to the opening balances carried into the current
      // year's Tally file (e.g. post-sync adjustments / reclassifications), which
      // made the comparative Balance Sheet diverge from COA mapping and not tally.
      //
      // Only the BALANCE-SHEET sections do this.  P&L comparatives MUST keep the
      // note / prior-year sourcing (opening balance is always 0 for P&L ledgers).
      // Fall back to the note sum / pyOf when there is NO opening balance — e.g. a
      // manual breakup note with no TB-mapped ledger (share capital keyed straight
      // into stage5_notes), so those clients keep showing their note figure.
      // PD-6 / D2.7 (FS_CORP_PY_FACE_FROM_NOTE): when ON, the corporate PY face reads
      // the NOTE PY total (below) instead of the raw CY opening balance, so the face
      // matches its own note table (and the Word BS PY too). OFF = legacy exportPy source.
      if (!FS_CORP_PY_FACE_FROM_NOTE && section !== "pl") {
        const openingPy = exportPy[fsCode];
        if (openingPy !== undefined && Math.abs(openingPy) > 0.005) return openingPy;
      }
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
      // Dynamic note registry. Note numbering must match what the auditor
      // SEES on the BS face. The BS face uses ncyOf/npyOf which prefer the
      // note's breakup-row sum over the raw TB total — so when a note is
      // populated via manual breakup rows (no TB ledger mapped, e.g.
      // CROWNGLOBE Share Capital entered straight into stage5_notes), the
      // BS row shows the value but `computedAmounts[fsCode]` is still 0.
      // Without enriching, hasData() returns false for that key and the
      // sequential numbering silently skips it.
      //
      // Fix: build an ENRICHED amount map that overlays the note-breakup
      // sums on top of the raw TB computedAmounts before invoking
      // buildDynamicRegistry. Now every populated note — TB-mapped or
      // breakup-mapped — receives a note number in display order.
      const enrichedCY: Record<string, number> = { ...computedAmounts };
      const enrichedPY: Record<string, number> = { ...mergedPY };
      const enrich = (section: "bs_liab" | "bs_asset" | "pl", key: string, fsCode: string) => {
        const cyN = sumNotesSubRowsCY(stage5NotesData ?? null, section, key);
        if (cyN != null && Math.abs(cyN) > 0.005 && !((enrichedCY[fsCode] ?? 0))) {
          enrichedCY[fsCode] = isCreditSideCode(fsCode) ? -cyN : cyN;
        }
        const pyN = sumNotesSubRowsPY(stage5NotesData ?? null, section, key);
        if (pyN != null && Math.abs(pyN) > 0.005 && !((enrichedPY[fsCode] ?? 0))) {
          enrichedPY[fsCode] = isCreditSideCode(fsCode) ? -pyN : pyN;
        }
      };
      // BS liab notes
      enrich("bs_liab", "share_capital",        "BS_EQ_SC");
      enrich("bs_liab", "reserves_surplus",     "BS_EQ_RS");
      enrich("bs_liab", "lt_borrowings",        "BS_NCL_LTB");
      enrich("bs_liab", "deferred_tax_liab",    "BS_NCL_DTL");
      enrich("bs_liab", "other_lt_liabilities", "BS_NCL_OLT");
      enrich("bs_liab", "lt_provisions",        "BS_NCL_LTP");
      enrich("bs_liab", "st_borrowings",        "BS_CL_STB");
      enrich("bs_liab", "trade_payables",       "BS_CL_TP");
      enrich("bs_liab", "other_curr_liab",      "BS_CL_OCL");
      enrich("bs_liab", "st_provisions",        "BS_CL_STP");
      // BS asset notes
      enrich("bs_asset", "nc_investments",      "BS_NCA_INV");
      enrich("bs_asset", "deferred_tax_asset",  "BS_NCA_DTA");
      enrich("bs_asset", "lt_loans",            "BS_NCA_LLA");
      enrich("bs_asset", "other_nc_assets",     "BS_NCA_ONA");
      enrich("bs_asset", "curr_investments",    "BS_CA_CI");
      enrich("bs_asset", "inventories",         "BS_CA_INV");
      enrich("bs_asset", "trade_receivables",   "BS_CA_TR");
      enrich("bs_asset", "cash_bank",           "BS_CA_CCE");
      enrich("bs_asset", "st_loans",            "BS_CA_SLA");
      enrich("bs_asset", "other_curr_assets",   "BS_CA_OCA");
      // PPE/FA grid lives outside the breakup convention; the FA grid drives
      // ppe.cy / ppe.py directly. Treat any populated FA row as note-active.
      const faRows = (stage5NotesData as any)?.fa?.rows;
      if (Array.isArray(faRows) && faRows.some((r: any) =>
        r && (Number(r.gross_open) || Number(r.additions) || Number(r.gross_close) || Number(r.depn_open) || Number(r.depn_add) || Number(r.depn_close))
      )) {
        enrichedCY["BS_NCA_FA"] = enrichedCY["BS_NCA_FA"] || 1;
      }

      const dynReg = buildDynamicRegistry(
        enrichedCY,
        enrichedPY,
        coaMapping as Record<string, { code: string }>,
        false,
        false, // skip COA signal — enriched amounts already include note breakup sums
      );
      const dn = (key: string): number | null => dynReg.get(key) ?? null;

      bs = {
        // Phase E: use notes breakup sub-row sums where populated; TB sum otherwise.
        // PPE (ppe) uses the FA grid (not a standard breakup array) — keep raw TB.
        shareCap:        { noteNo: dn("share_capital"),        cy: ncyOf("bs_liab","share_capital","BS_EQ_SC"),              py: npyOf("bs_liab","share_capital","BS_EQ_SC")              },
        reserves:        { noteNo: dn("reserves_surplus"),     cy: ncyOf("bs_liab","reserves_surplus","BS_EQ_RS"),            py: npyOf("bs_liab","reserves_surplus","BS_EQ_RS")            },
        ltBorrowings:    { noteNo: dn("lt_borrowings"),        cy: ncyOf("bs_liab","lt_borrowings","BS_NCL_LTB"),             py: npyOf("bs_liab","lt_borrowings","BS_NCL_LTB")             },
        dtLiab:          { noteNo: dn("deferred_tax_liab"),    cy: ncyOf("bs_liab","deferred_tax_liab","BS_NCL_DTL"),         py: npyOf("bs_liab","deferred_tax_liab","BS_NCL_DTL")         },
        // CRITICAL: data keys here MUST match NOTE_ROW_REGISTRY keys in
        // src/lib/notesAutoPopulate.ts. A typo silently routes the lookup
        // through pyOf(fsCode) (the raw TB total) and divorces the BS face
        // from the auditor's note breakup — they will not reconcile.
        // (Issue: Note 5 "Other current liabilities" was showing 5,17,257
        //  on the BS face vs 4,85,171 on the note, because the BS lookup
        //  used "other_current_liab" while the registry stores it under
        //  "other_curr_liab". Same problem cascaded through six other
        //  notes. Fixed by aligning every key to the registry below.)
        otherLtLiab:     { noteNo: dn("other_lt_liab"),        cy: ncyOf("bs_liab","other_lt_liabilities","BS_NCL_OLT"),      py: npyOf("bs_liab","other_lt_liabilities","BS_NCL_OLT")      },
        ltProvisions:    { noteNo: dn("lt_provisions"),        cy: ncyOf("bs_liab","lt_provisions","BS_NCL_LTP"),             py: npyOf("bs_liab","lt_provisions","BS_NCL_LTP")             },
        stBorrowings:    { noteNo: dn("st_borrowings"),        cy: ncyOf("bs_liab","st_borrowings","BS_CL_STB"),              py: npyOf("bs_liab","st_borrowings","BS_CL_STB")              },
        tradePayables:   { noteNo: dn("trade_payables") },
        tradePayMSME:    { cy: 0, py: 0 },  // ageing MSME split kept at 0; full TP total below
        tradePayOthers:  { cy: ncyOf("bs_liab","trade_payables","BS_CL_TP"),       py: npyOf("bs_liab","trade_payables","BS_CL_TP")       },
        otherCurrLiab:   { noteNo: dn("other_current_liab"),   cy: ncyOf("bs_liab","other_curr_liab","BS_CL_OCL"),            py: npyOf("bs_liab","other_curr_liab","BS_CL_OCL")            },
        stProvisions:    { noteNo: dn("st_provisions"),        cy: ncyOf("bs_liab","st_provisions","BS_CL_STP"),              py: npyOf("bs_liab","st_provisions","BS_CL_STP")              },
        // Bug 6 — PPE prefers FA grid Net Block total over raw TB.
        // Falls back to cyOf/pyOf("BS_NCA_FA") when the FA grid has no rows.
        ppe:             { noteNo: dn("ppe"),                  cy: getFAGridNetBlockTotal(stage5NotesData ?? null, "cy") ?? cyOf("BS_NCA_FA"),  py: getFAGridNetBlockTotal(stage5NotesData ?? null, "py") ?? pyOf("BS_NCA_FA") },
        ncInvestments:   { noteNo: dn("nc_investments"),       cy: ncyOf("bs_asset","nc_investments","BS_NCA_INV"),           py: npyOf("bs_asset","nc_investments","BS_NCA_INV")           },
        dtAssets:        { noteNo: dn("deferred_tax_assets"),  cy: ncyOf("bs_asset","deferred_tax_asset","BS_NCA_DTA"),       py: npyOf("bs_asset","deferred_tax_asset","BS_NCA_DTA")       },
        ltLoans:         { noteNo: dn("lt_loans_advances"),    cy: ncyOf("bs_asset","lt_loans","BS_NCA_LLA"),                 py: npyOf("bs_asset","lt_loans","BS_NCA_LLA")                 },
        otherNcAssets:   { noteNo: dn("other_nc_assets"),      cy: ncyOf("bs_asset","other_nc_assets","BS_NCA_ONA"),          py: npyOf("bs_asset","other_nc_assets","BS_NCA_ONA")          },
        currInvestments: { noteNo: dn("current_investments"),  cy: ncyOf("bs_asset","curr_investments","BS_CA_CI"),           py: npyOf("bs_asset","curr_investments","BS_CA_CI")           },
        inventories:     { noteNo: dn("inventories"),          cy: ncyOf("bs_asset","inventories","BS_CA_INV"),               py: npyOf("bs_asset","inventories","BS_CA_INV")               },
        tradeRec:        { noteNo: dn("trade_receivables"),    cy: ncyOf("bs_asset","trade_receivables","BS_CA_TR"),          py: npyOf("bs_asset","trade_receivables","BS_CA_TR")          },
        cashBank:        { noteNo: dn("cash_bank"),            cy: ncyOf("bs_asset","cash_bank","BS_CA_CCE"),                 py: npyOf("bs_asset","cash_bank","BS_CA_CCE")                 },
        stLoans:         { noteNo: dn("st_loans_advances"),    cy: ncyOf("bs_asset","st_loans","BS_CA_SLA"),                  py: npyOf("bs_asset","st_loans","BS_CA_SLA")                  },
        otherCurrAssets: { noteNo: dn("other_current_assets"), cy: ncyOf("bs_asset","other_curr_assets","BS_CA_OCA"),         py: npyOf("bs_asset","other_curr_assets","BS_CA_OCA")         },
        sigPolicies:     { noteNo: 1 }, // Accounting Policies — always Note 1
      };
      // P&L — also notes-aware; pbt recomputed from notes-adjusted rev/exp totals
      const expCy = ncyOf("pl","cost_materials","PL_EXP_MAT")      + ncyOf("pl","purchases_stock","PL_EXP_SIT")
                  + ncyOf("pl","changes_inventory","PL_EXP_CII")   + ncyOf("pl","employee_benefits","PL_EXP_EMP")
                  + ncyOf("pl","finance_costs","PL_EXP_FIN")        + ncyOf("pl","depreciation","PL_EXP_DEP")
                  + ncyOf("pl","other_expenses","PL_EXP_OTH");
      const expPy = npyOf("pl","cost_materials","PL_EXP_MAT")      + npyOf("pl","purchases_stock","PL_EXP_SIT")
                  + npyOf("pl","changes_inventory","PL_EXP_CII")   + npyOf("pl","employee_benefits","PL_EXP_EMP")
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
              py: pyInvCII ?? npyOf("pl","changes_inventory","PL_EXP_CII"),
            };
          }
          return {
            noteNo: dn("changes_inventories"),
            cy: ncyOf("pl","changes_inventory","PL_EXP_CII"),
            py: npyOf("pl","changes_inventory","PL_EXP_CII"),
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
    tbAccounts, coaMapping, manualOverrides, activeTree, aliases,
    pyAmounts, pyManualAmounts, pyShellPLAmounts, noPriorEngagement, isNonCorporate,
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
  // corpNetPAT: must match the XI formula in buildPLRows.
  //   profitCy = pbtCy - currentTax - deferredTax     (PBT − Tax expense)
  // Both currentTax and deferredTax are stored as positive expense
  // magnitudes (matching how they render on the P&L row). Previous "+ DT"
  // overstated NPAT by 2× the deferred tax — the top NPAT card disagreed
  // with the P&L XI / XV totals (5,40,177 vs 5,36,933 for KWIKTEAM).
  const corpPlData = fsDisplayData?.pl;
  const corpNetPAT = corpPlData
    ? Math.round((netProfit - (corpPlData.currentTax.cy || 0) - (corpPlData.deferredTax.cy || 0)) * 100) / 100
    : netProfit;

  // ─── Bug 5 — Phase E for NCE: notes-aware substitution into NCE amounts ─────
  // For each NCE FS code that has a note key + section mapping, substitute
  // the breakup sum (when populated) for the raw TB value.  Liability codes
  // are stored negative in Tally (CR convention) and the NCE BS view applies
  // negL() at display, so we re-apply the negative sign before storing in
  // the augmented map — keeps display sign convention identical to before.
  // ── Build a lookup from noteType → nce_financial_notes row so getNCENoteFaceTotal
  // can pull each note's cy_data / py_data without re-querying the DB.
  // Phase 3: also carry note_type onto the per-row object so
  // getNCENoteFaceTotal can resolve the NoteConfig from it (the canonical
  // computeNoteTotals lookup needs the config to walk the formula DAG).
  const nceNotesByType: Record<string, { cy_data?: any; py_data?: any; note_type?: string }> = useMemo(() => {
    const m: Record<string, { cy_data?: any; py_data?: any; note_type?: string }> = {};
    if (Array.isArray(nceNotesData)) {
      for (const n of nceNotesData as any[]) {
        if (n?.note_type) m[n.note_type] = { cy_data: n.cy_data, py_data: n.py_data, note_type: n.note_type };
      }
    }
    return m;
  }, [nceNotesData]);

  // 2026-06-05 Phase 4 — COA Mapping line-item totals computed fresh from
  // TB × COA mapping × signedBalance/signedOpening. Anchors the three-way
  // reconciliation in FsHealthPanel: Note Total - COA Total = legitimate
  // auditor manual adjustment (positive only); any drift between Note
  // Total and BS Face is a code-path bug to fix.
  const coaTotalsByCode = useMemo(
    () => computeCOATotals(tallyTb ?? [], pyShellTb ?? [], coaMapping, pyShellCoaMapping ?? {}),
    [tallyTb, pyShellTb, coaMapping, pyShellCoaMapping],
  );

  // Phase 8 (CRIT-7, NCE-only) — count TB ledgers with a material closing balance
  // that are NOT mapped to any FS code. computeCOATotals silently drops these, and
  // the residual absorber then hides the gap inside Owners' Capital — so the BS
  // can read "balanced" while it is materially wrong (the 3 mapping-incomplete
  // engagements: AMADIUS / SWENI / SWASTIK 24-25). Surfaced here so the export
  // gate can block until the auditor completes COA Mapping. Replicates
  // computeCOATotals' lookup (exact → trim → case-insensitive).
  const nceUnmappedNonZero = useMemo(() => {
    if (!isNonCorporate) return { count: 0, net: 0 };
    const mapping = (coaMapping ?? {}) as Record<string, any>;
    const ci: Record<string, any> = {};
    for (const [k, v] of Object.entries(mapping)) {
      if (!v?.code) continue;
      const kk = String(k).trim().toLowerCase();
      if (!(kk in ci)) ci[kk] = v;
    }
    const lookup = (nm: string) => !nm ? undefined : (mapping[nm] ?? mapping[nm.trim()] ?? ci[String(nm).trim().toLowerCase()]);
    const seen = new Map<string, any>();
    for (const r of (tallyTb ?? [])) { const nm = String(r.ledger_name ?? ""); if (nm) seen.set(nm, r); }
    let count = 0, net = 0;
    for (const r of seen.values()) {
      const nm = String(r.ledger_name ?? "");
      if (lookup(nm)?.code) continue;
      const v = Number(r.closing_balance) || 0;
      const dr = !String(r.balance_type || "").toUpperCase().startsWith("CR");
      const sv = dr ? Math.abs(v) : -Math.abs(v);
      if (Math.abs(sv) > 100) { count++; net += sv; }
    }
    return { count, net: Math.round(net) };
  }, [isNonCorporate, tallyTb, coaMapping]);

  /** Apply the NCE note grand total to an FS code, respecting storage sign
   *  convention: CR-natural codes (liabilities, equity, income) are stored
   *  negative so the display layer's negL()/negI() can flip them positive. */
  const applyNCENoteTotal = (
    out: Record<string, number>,
    code: string,
    column: "cy" | "py",
  ): boolean => {
    const meta = NCE_CODE_TO_NOTE[code];
    if (!meta) return false;
    const row = nceNotesByType[meta.note];
    if (!row) return false;
    // Pattern A notes have LT/ST columns; Pattern B is single-column.
    const isPatternA = meta.col === "lt" || meta.col === "st";
    const total = getNCENoteFaceTotal(
      row, column,
      isPatternA ? "A" : "B",
      meta.col,
      meta.config,
    );
    if (total == null) return false;
    const nature = NCE_NOTE_NATURE[meta.note] ?? "CR";
    out[code] = nature === "CR" ? -total : total;
    return true;
  };

  // PERF: memoize nceCyAmounts — previously an un-memoized IIFE that
  // recomputed on every render (object spreads, NCE_CODE_TO_NOTE iteration,
  // applyNCENoteTotal calls, sumNotesSubRowsCY, etc.). Now only recomputes
  // when its actual inputs change.
  const nceCyAmounts: Record<string, number> = useMemo(() => {
    if (!isNonCorporate) return computedAmounts;
    const out = { ...computedAmounts };
    // Phase E (legacy stage5_notes path) — kept for backward compatibility
    // with engagements that have stage5_notes populated. NCE notes path
    // below overrides any value found here when present.
    for (const [code, key] of Object.entries(NCE_CODE_TO_NOTE_KEY)) {
      const section = NCE_CODE_TO_SECTION[code];
      if (!section) continue;
      const sum = sumNotesSubRowsCY(stage5NotesData ?? null, section, key);
      if (sum == null) continue;
      out[code] = section === "bs_liab" ? -sum : sum;
    }
    // Bug 6 — NCE PPE / CWIP / Intangibles use the FA grid total when
    // populated.
    const faCy = getFAGridNetBlockTotal(stage5NotesData ?? null, "cy");
    if (faCy != null) out["NCE_PPE"] = faCy;
    // Issue 3 fix — auditor's Notes-to-Accounts (nce_financial_notes)
    // grand total drives the BS / P&L face. Includes manual customRows.
    // INLINED: applyNCENoteTotal was previously a closure capturing
    // nceNotesByType from outer scope. Inlining here guarantees the
    // useMemo always reads the CURRENT nceNotesByType value from its
    // dependency array — eliminates any stale-closure risk.
    for (const code of Object.keys(NCE_CODE_TO_NOTE)) {
      const meta = NCE_CODE_TO_NOTE[code];
      if (!meta) continue;
      const noteRow = nceNotesByType[meta.note];
      if (!noteRow) continue;
      const isPatternA = meta.col === "lt" || meta.col === "st";
      const total = getNCENoteFaceTotal(
        noteRow, "cy",
        isPatternA ? "A" : "B",
        meta.col,
        meta.config,
      );
      if (total == null) continue;
      const nature = NCE_NOTE_NATURE[meta.note] ?? "CR";
      const noteVal = nature === "CR" ? -total : total;
      // Notes always drive the face — both BS and P&L codes.
      // If the note is incomplete, the face shows the incomplete total;
      // the auditor fixes the notes directly.
      out[code] = noteVal;
    }
    // ROOT-CAUSE FIX (Issue 2 — TOTAL rows didn't match the line items):
    // Fold BS_EQ_RS into NCE_CAP, lock BS TOTAL to TB.
    if (out["BS_EQ_RS"] && Math.abs(out["BS_EQ_RS"]) > 0.005) {
      out["NCE_CAP"] = (out["NCE_CAP"] || 0) + out["BS_EQ_RS"];
      out["BS_EQ_RS"] = 0;
    }
    // NOTE: NCE_DEPR / NCE_INTG are NOT zeroed here because this map is
    // shared by both BSView and PLView. The BS TOTAL uses tbCy (a separate
    // spread) which reduces only NCE_ASSET_IDS / NCE_LIAB_IDS — neither
    // array contains NCE_DEPR or NCE_INTG, so they don't affect the BS
    // total. Zeroing them would break the P&L display (depreciation = 0).
    // 2026-06-06 FIX: BS TOTAL must equal the sum of individual rows.
    // Previous "structural fix" locked totals to raw TB, but this made
    // the TOTAL diverge from the sum of note-overridden rows — the user
    // sees rows that don't add up to the total. The correct data flow is:
    //   COA Mapping → Notes → Notes Total → BS/PL Face (including TOTAL)
    // So NCE_AST / NCE_EL are now computed from `out` (note-overridden)
    // instead of `tbCy` (raw TB). If notes have manual adjustments beyond
    // TB, the total will reflect them. FsHealthPanel flags any drift.
    // PPE Schedule wins over the FA-grid (faCy) override above: computedAmounts
    // already seeded NCE_PPE/NCE_INTG from the schedule, but the faCy override
    // may have clobbered NCE_PPE. Re-apply the schedule so it stays the
    // authoritative source for the BS face and the NCE_AST roll-up below.
    if (Array.isArray(ncePpeData)) {
      const ppeClosingOf = (cat: string) =>
        ncePpeData
          .filter((r: any) => (r.asset_category ?? "") === cat)
          .reduce((s: number, r: any) => s + (Number(r.closing_balance) || 0), 0);
      out["NCE_PPE"]  = Math.round(ppeClosingOf("tangible")   * 100) / 100;
      out["NCE_INTG"] = Math.round(ppeClosingOf("intangible") * 100) / 100;
    }
    // ── Phase 2/3/5 (FS_NO_MANUAL_NOTE_ADD, NCE-only) — anchor the FACE to COA ──
    // When the no-manual-additions policy is on, every NCE code's face is taken
    // DIRECTLY from the sign-corrected COA anchor (computeNceCoaAnchoredFace),
    // overriding the note/seed/schedule values set above. This makes Face = COA so
    // a manual note addition, an LT/ST split that disagrees with the code, a
    // contaminated seed, or an un-reconciled note can no longer move the face off
    // COA. NCE_CII is derived from stock movement (it has no COA ledger), and PPE
    // is sourced from books-COA (decision D). The residual absorber below then
    // credits the leftover (= the current-year result not yet in Owners' Capital)
    // to NCE_CAP — a legitimate profit transfer, since every other line now = COA.
    // Verified 28/28 by anchor-verify against live data. Corporate is never touched.
    if (FS_NO_MANUAL_NOTE_ADD) {
      const { face: coaFace } = computeNceCoaAnchoredFace(coaTotalsByCode, "cy");
      for (const code of Object.keys(coaFace)) out[code] = coaFace[code];
    }
    out["NCE_AST"] = NCE_ASSET_IDS.reduce((s, id) => s + (out[id] || 0), 0);
    out["NCE_EL"]  = NCE_LIAB_IDS.reduce((s, id) => s + (out[id] || 0), 0);
    // 2026-06-12 — CY BS residual absorber (mirror of the PY one in mergedPY).
    // After all note overrides and the prior CY profit auto-credit, any
    // remaining BS imbalance comes from TB ledgers that aren't mapped to a
    // proper FS code (partner introductions/drawings, unmapped misc,
    // internal P&L ledger). User excluded Capital from the "match COA"
    // requirement, so it can absorb the residual cleanly.
    {
      // Phase 5 — capture the TRUE imbalance BEFORE the absorber hides it in
      // NCE_CAP, so FsHealthPanel can surface it. The absorber body below is
      // UNCHANGED → every face number stays byte-identical. The synthetic key
      // is never iterated (no Object.keys/entries over nceCyAmounts) and is not
      // an NCE code with a note, so the reconciliation validator ignores it.
      out["__NCE_BS_RESIDUAL__"] = Math.round((out["NCE_AST"] + out["NCE_EL"]) * 100) / 100;
      const residual = out["__NCE_BS_RESIDUAL__"]; // + = Assets exceed E+L
      // PD-1 / D2.1 (FS_NO_CAPITAL_PLUG): when ON, skip the Capital plug so the true
      // residual stands (nceBsBalanced + export gate then reflect the real imbalance).
      if (!FS_NO_CAPITAL_PLUG && Math.abs(residual) > 2 && Math.abs(residual) < 1e9) {
        out["NCE_CAP"] = (out["NCE_CAP"] || 0) - residual;
        out["NCE_EL"]  = NCE_LIAB_IDS.reduce((s, id) => s + (out[id] || 0), 0);
      }
    }
    // ── Recompute P&L parent totals + profit chain after note overrides ──
    // Note overrides change leaf P&L codes (NCE_OTH_EXP, NCE_EMP_EXP, etc.)
    // but the parent codes (NCE_PL_EXP, NCE_PL_INC) and profit chain
    // (NCE_PROF_V → NCE_NET_PROF) are still from raw TB. Recompute so
    // "Total Expenses" and "Profit for the year" match the individual rows.
    out["NCE_PL_EXP"] = (out["NCE_COGS"] || 0) + (out["NCE_CII"] || 0)
                       + (out["NCE_EMP_EXP"] || 0) + (out["NCE_FIN_COST"] || 0)
                       + (out["NCE_DEPR"] || 0) + (out["NCE_OTH_EXP"] || 0);
    out["NCE_PL_INC"] = (out["NCE_REV_OPS"] || 0) + (out["NCE_REV_OTH"] || 0);
    const inc = out["NCE_PL_INC"] || 0;
    const exp = out["NCE_PL_EXP"] || 0;
    out["NCE_PROF_V"]   = Math.round((-inc - exp) * 100) / 100;
    out["NCE_PROF_VII"] = Math.round((out["NCE_PROF_V"]   - (out["NCE_EXCEP"]    || 0)) * 100) / 100;
    out["NCE_PROF_IX"]  = Math.round((out["NCE_PROF_VII"] - (out["NCE_EXTORD"]   || 0)) * 100) / 100;
    out["NCE_PROF_XI"]  = Math.round((out["NCE_PROF_IX"]  - (out["NCE_PART_REM"] || 0)) * 100) / 100;
    out["NCE_NET_PROF"] = Math.round((out["NCE_PROF_XI"]  - (out["NCE_TAX"]      || 0)) * 100) / 100;
    return out;
  }, [isNonCorporate, computedAmounts, stage5NotesData, nceNotesByType, ncePpeData, coaTotalsByCode]);
  // PERF: memoize ncePyAmounts — same pattern as nceCyAmounts above.
  const ncePyAmounts: Record<string, number> = useMemo(() => {
    if (!isNonCorporate) return mergedPY;
    // ─── PY BS-code authority (revised 2026-06-05) ─────────────────────
    // Notes total wins for PY too (mirrors the CY logic). FsHealthPanel
    // surfaces any divergence between Tally opening and notes.
    // PyShell guard preserved: when this engagement has a dedicated PY
    // shell, that data is authoritative.
    const out = { ...mergedPY };
    const isBSCode = (code: string): boolean => {
      const section = NCE_CODE_TO_SECTION[code];
      if (section === "bs_liab" || section === "bs_asset") return true;
      return /^NCE_(CAP|LTB|OLTL|LTP|STB|TP|OCL|STP|PPE|INTG|CWIP|NCINV|LTLA|ONCA|CINV|STCK|TR|CASH|STLA|OCA)$/.test(code);
    };
    const orphanPYBsCode = (code: string): boolean => {
      if (!hasPyShellBS) return false;
      if (!isBSCode(code)) return false;
      return !(code in pyShellBSAmounts);
    };
    // Pass 1 — stage5_notes (legacy path).
    for (const [code, key] of Object.entries(NCE_CODE_TO_NOTE_KEY)) {
      const section = NCE_CODE_TO_SECTION[code];
      if (!section) continue;
      if (orphanPYBsCode(code)) continue;
      const sum = sumNotesSubRowsPY(stage5NotesData ?? null, section, key);
      if (sum == null) continue;
      out[code] = section === "bs_liab" ? -sum : sum;
    }
    const faPy = getFAGridNetBlockTotal(stage5NotesData ?? null, "py");
    if (faPy != null) out["NCE_PPE"] = faPy;
    // Pass 2 — nce_financial_notes (Stage 8 path). INLINED (same as CY).
    // 2026-06-12 — orphan skip lifted when the note carries a NON-ZERO PY
    // value. SKYLARK other_cl PY had Pattern G data (₹25cr) sitting in the
    // note but was being ignored because pyShellBSAmounts didn't carry
    // NCE_OCL — orphan check would skip the override and the face fell back
    // to a raw COA value that didn't reflect the note. We trust the note
    // when it has data and only honour orphan-skip for empty / null notes.
    for (const code of Object.keys(NCE_CODE_TO_NOTE)) {
      const meta = NCE_CODE_TO_NOTE[code];
      if (!meta) continue;
      const noteRow = nceNotesByType[meta.note];
      if (!noteRow) continue;
      const isPatternA = meta.col === "lt" || meta.col === "st";
      const total = getNCENoteFaceTotal(
        noteRow, "py",
        isPatternA ? "A" : "B",
        meta.col,
        meta.config,
      );
      if (total == null) continue;
      // Honour orphan skip ONLY when the note has no PY data to contribute
      // (total is 0). When the note carries an actual value, the auditor
      // wants it on the face regardless of pyShell coverage.
      if (orphanPYBsCode(code) && Math.abs(total) < 0.005) continue;
      const nature = NCE_NOTE_NATURE[meta.note] ?? "CR";
      const noteVal = nature === "CR" ? -total : total;
      out[code] = noteVal;
    }
    // Fold orphan codes + lock PY TOTAL to CY TB openings.
    if (out["BS_EQ_RS"] && Math.abs(out["BS_EQ_RS"]) > 0.005) {
      out["NCE_CAP"] = (out["NCE_CAP"] || 0) + out["BS_EQ_RS"];
      out["BS_EQ_RS"] = 0;
    }
    // ── Phase 7 (FS_NO_MANUAL_NOTE_ADD, NCE-only) — anchor the PY face to COA ──
    // PY mirror of the CY anchor. coaTotals.py is the PY-shell closing (= CY
    // opening) for BS codes, and the PY-shell P&L closing where a shell exists.
    // NCE_CII PY is NOT auto-derived (needs the pre-PY opening stock, not loaded)
    // → keep the note value. Engagements with no PY shell keep 0 PY P&L (existing
    // limit). The PY residual absorber below credits the PY result to Capital.
    if (FS_NO_MANUAL_NOTE_ADD) {
      const { face: coaFacePy } = computeNceCoaAnchoredFace(coaTotalsByCode, "py");
      for (const code of Object.keys(coaFacePy)) {
        if (code === "NCE_CII") continue;
        out[code] = coaFacePy[code];
      }
    }
    // See CY comment: NCE_DEPR/NCE_INTG not zeroed — P&L needs them.
    // PY TOTAL: computed from note-overridden `out` (mirrors CY above).
    out["NCE_AST"] = NCE_ASSET_IDS.reduce((s, id) => s + (out[id] || 0), 0);
    out["NCE_EL"]  = NCE_LIAB_IDS.reduce((s, id) => s + (out[id] || 0), 0);
    // 2026-06-12 — The blanket "revert BS codes to mergedPY when notes-
    // overridden drift is worse" fallback was removed. It was discarding
    // legitimate note values (SKYLARK Pattern G added ₹25cr of plot-advance
    // ledgers to other_cl PY; the revert wiped that out and the face fell
    // back to ₹-28L). The residual absorber below now handles any drift
    // by landing it in NCE_CAP — which is the proper place per user
    // instruction. Note overrides always win at the face.
    // 2026-06-12 — PY BS residual absorber (mirror of the CY one in nceCyAmounts).
    // Any leftover gap after the mergedPY revert (rawDrift was equal/worse,
    // so we kept the note-overridden totals) gets absorbed into Capital so BS
    // PY balances. The PY auto-credit in mergedPY already did its work; what
    // remains is unmapped PY-shell TB material (partner intro/draw, unmapped
    // misc). User excludes Capital from "match COA" → safe to absorb here.
    {
      // Phase 5 — capture the TRUE PY imbalance before the absorber (see CY).
      out["__NCE_BS_RESIDUAL__"] = Math.round((out["NCE_AST"] + out["NCE_EL"]) * 100) / 100;
      const residualPy = out["__NCE_BS_RESIDUAL__"];
      // PD-1 / D2.1 (FS_NO_CAPITAL_PLUG): when ON, skip the PY Capital plug too.
      if (!FS_NO_CAPITAL_PLUG && Math.abs(residualPy) > 2 && Math.abs(residualPy) < 1e9) {
        out["NCE_CAP"] = (out["NCE_CAP"] || 0) - residualPy;
        out["NCE_EL"]  = NCE_LIAB_IDS.reduce((s, id) => s + (out[id] || 0), 0);
      }
    }
    // PY profit chain recomputation (mirrors CY above).
    out["NCE_PL_EXP"] = (out["NCE_COGS"] || 0) + (out["NCE_CII"] || 0)
                       + (out["NCE_EMP_EXP"] || 0) + (out["NCE_FIN_COST"] || 0)
                       + (out["NCE_DEPR"] || 0) + (out["NCE_OTH_EXP"] || 0);
    out["NCE_PL_INC"] = (out["NCE_REV_OPS"] || 0) + (out["NCE_REV_OTH"] || 0);
    const pyInc = out["NCE_PL_INC"] || 0;
    const pyExp = out["NCE_PL_EXP"] || 0;
    out["NCE_PROF_V"]   = Math.round((-pyInc - pyExp) * 100) / 100;
    out["NCE_PROF_VII"] = Math.round((out["NCE_PROF_V"]   - (out["NCE_EXCEP"]    || 0)) * 100) / 100;
    out["NCE_PROF_IX"]  = Math.round((out["NCE_PROF_VII"] - (out["NCE_EXTORD"]   || 0)) * 100) / 100;
    out["NCE_PROF_XI"]  = Math.round((out["NCE_PROF_IX"]  - (out["NCE_PART_REM"] || 0)) * 100) / 100;
    out["NCE_NET_PROF"] = Math.round((out["NCE_PROF_XI"]  - (out["NCE_TAX"]      || 0)) * 100) / 100;
    return out;
  }, [isNonCorporate, mergedPY, computedAmountsPY, stage5NotesData, nceNotesByType, hasPyShellBS, pyShellBSAmounts, coaTotalsByCode]);

  // ─── NCE stats bar ───────────────────────────────────────────────────────────
  // Sum individual leaf codes so the stats bar is independent of computeTotal
  // parent nodes. NCE_NET_PROF (row XIII) comes from the profit-chain block.
  // 2026-06-06 STRUCTURAL FIX: use the TB-locked NCE_AST/NCE_EL values
  // that were computed from signed TB inside the nceCyAmounts/ncePyAmounts
  // closures (not from note-overridden leaf codes). These totals are
  // guaranteed to balance because they come from the TB which is balanced
  // by construction.
  const nceTotalAssets      = nceCyAmounts["NCE_AST"] || 0;
  const nceTotalLiabilities = nceCyAmounts["NCE_EL"]  || 0;
  const nceBsDiff           = Math.round((nceTotalAssets + nceTotalLiabilities) * 100) / 100;
  const nceBsBalanced       = Math.abs(nceTotalAssets + nceTotalLiabilities) < 2;
  const nceNetProfit        = nceCyAmounts["NCE_NET_PROF"] || 0;

  // NCE PY balance check — same approach, using TB-locked PY totals.
  const ncePyTotalAssets      = ncePyAmounts["NCE_AST"] || 0;
  const ncePyTotalLiabilities = ncePyAmounts["NCE_EL"]  || 0;
  const nceBsDiffPy           = Math.round((ncePyTotalAssets + ncePyTotalLiabilities) * 100) / 100;
  const nceBsBalancedPy       = Math.abs(ncePyTotalAssets + ncePyTotalLiabilities) < 2;

  // Phase 5 — TRUE (pre-absorber) BS imbalance for the FsHealthPanel diagnostic.
  // When |residual| <= 2 the absorber block never ran so the synthetic key is
  // absent → `|| 0` correctly reports balanced. Surfacing only; the absorber
  // still balances the displayed face until its removal is reviewed on real data.
  const nceBsResidualCy = nceCyAmounts["__NCE_BS_RESIDUAL__"] || 0;
  const nceBsResidualPy = ncePyAmounts["__NCE_BS_RESIDUAL__"] || 0;

  // ─── NCE Notes vs Face mismatch detector (2026-06-01) ────────────────────
  // User asked: "add a validation that notes total and heading total in B/S
  // and P/L should always match". Iterate every NCE BS / P&L code that has a
  // note, compare the face value (from nceCyAmounts / ncePyAmounts) against
  // the same note's total computed by getNCENoteFaceTotal. Surface any code
  // whose CY or PY columns diverge by > ₹1.
  //
  // Catches the classic OM REALTY / MAHARSH INFRA failure mode:
  // P&L Other Expenses face = 76,89,211 but note total = 1,30,58,710 because
  // a stale row (Rates and taxes PY = 39,96,555 etc.) is still in the note
  // breakup. The banner names the row and the difference so the auditor knows
  // exactly which note to re-correct.
  // PERF: nceCodeLabels removed — was only used by the now-removed
  // nceNotesMismatches useMemo. Labels are in FsHealthPanel via NCE_NOTE_LABEL.
  // PERF: nceNotesMismatches was dead code — the same drift data is now
  // surfaced by FsHealthPanel via fsReconResult. Removed to eliminate a
  // redundant useMemo that called getNCENoteFaceTotal for every NCE code.

  // ─── Active summary values (swap between NCE and corporate in JSX) ───────
  // Issue 2 (today) — same ₹2 tolerance for corporate BS check.
  const corpBsBalanced    = Math.abs(bsDiff) < 2;
  const activeBsDiff      = isNonCorporate ? nceBsDiff      : bsDiff;
  const activeBsBalanced  = isNonCorporate ? nceBsBalanced  : corpBsBalanced;

  // ─── PY balance sheet check + FA Previous-Year entry gate ────────────────
  // Export Excel must be blocked until BOTH:
  //   (1) CY *and* PY Balance Sheet reconcile (Total E&L = Total Assets)
  //   (2) The FA note has Previous-Year data entered (either pyRows
  //       auto-filled from a prior engagement OR the auditor has manually
  //       typed any value into fa.py_manual on the "Total — Previous year"
  //       row of the FA grid).
  // Without these gates, the exported Excel ships with mismatched BS totals
  // or a blank PPE PY column — both of which break the FS file the auditor
  // sends to the client. This rule applies to every corporate engagement.
  const bsDiffPy: number = corpBsData
    ? Math.round((
        ((corpBsData.ppe.py || 0) + (corpBsData.ncInvestments.py || 0) + (corpBsData.dtAssets.py || 0)
         + (corpBsData.ltLoans.py || 0) + (corpBsData.otherNcAssets.py || 0)
         + (corpBsData.currInvestments.py || 0) + (corpBsData.inventories.py || 0) + (corpBsData.tradeRec.py || 0)
         + (corpBsData.cashBank.py || 0) + (corpBsData.stLoans.py || 0) + (corpBsData.otherCurrAssets.py || 0))
        - (-(corpBsData.shareCap.py || 0) - (corpBsData.reserves.py || 0)
           - (corpBsData.ltBorrowings.py || 0) - (corpBsData.dtLiab.py || 0)
           - (corpBsData.otherLtLiab.py || 0) - (corpBsData.ltProvisions.py || 0)
           - (corpBsData.stBorrowings.py || 0)
           - (corpBsData.tradePayMSME.py || 0) - (corpBsData.tradePayOthers.py || 0)
           - (corpBsData.otherCurrLiab.py || 0) - (corpBsData.stProvisions.py || 0))
      ) * 100) / 100
    : 0;
  const corpBsBalancedPy: boolean = Math.abs(bsDiffPy) < 2;
  // PY equivalents — shown in the PY BS Check stat card (must be after bsDiffPy + corpBsBalancedPy)
  const activeBsDiffPy     = isNonCorporate ? nceBsDiffPy     : bsDiffPy;
  const activeBsBalancedPy = isNonCorporate ? nceBsBalancedPy : corpBsBalancedPy;

  // FA PY check — any of (a) auto-filled pyRows from prior engagement,
  // (b) any manual override on the "Total — Previous year" row in
  // fa.py_manual, OR (c) any FA row with gross_open / depn_open > 0
  // (treated as PY closing carried into CY).
  const faPyEntered: boolean = (() => {
    const fa = (stage5NotesData as any)?.fa;
    if (!fa) return false;
    const pyManual = fa.py_manual && typeof fa.py_manual === "object" ? fa.py_manual : {};
    if (Object.values(pyManual).some(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) > 0.005)) return true;
    const rows: any[] = Array.isArray(fa.rows) ? fa.rows : [];
    if (rows.some(r => (Number(r?.gross_open) || 0) > 0 || (Number(r?.depn_open) || 0) > 0)) return true;
    return false;
  })();

  // ── Phase 8: Compute reconciliation result for export blocking ───────
  // Re-use the same validator the FsHealthPanel uses. When there are severe
  // drift rows (|delta| > ₹100), exports are blocked — the user MUST fix
  // the drift in the Notes tab before generating a deliverable. This is the
  // runtime invariant enforcement that makes the structural guarantee real.
  const fsReconResult = useMemo(() => {
    if (isNonCorporate) {
      return validateFSReconciliation({
        nceNotesByType,
        bsFaceCy: nceCyAmounts,
        bsFacePy: ncePyAmounts,
        liabCodes: NCE_LIAB_CODE_SET,
        coaTotals: coaTotalsByCode,
      });
    }
    return null; // Corporate uses a different validator; add when needed
  }, [isNonCorporate, nceNotesByType, nceCyAmounts, ncePyAmounts, coaTotalsByCode]);

  const hasSevereDrift = (fsReconResult?.severeCount ?? 0) > 0;

  // BUG-085/107/110 / D2.10 — corporate export currently never blocks on note-vs-COA/face
  // drift (unlike NCE). Staged behind FS_CORP_EXPORT_GATE (default OFF): when ON, compute the
  // corporate three-way validator and block Excel/Word export on severe drift. OFF = the memo
  // returns null so corpHasSevereDrift is always false and every gate below is byte-identical.
  const corpReconResult = useMemo(() => {
    if (isNonCorporate || !FS_CORP_EXPORT_GATE) return null;
    return validateCorporateFSReconciliation({
      corporateNotes: stage5NotesData ?? null,
      bsFaceCy: computedAmounts,
      bsFacePy: computedAmountsPY,
      coaTotals: coaTotalsByCode,
    });
  }, [isNonCorporate, stage5NotesData, computedAmounts, computedAmountsPY, coaTotalsByCode]);
  const corpHasSevereDrift = (corpReconResult?.severeCount ?? 0) > 0;

  // ── PPE schedule ↔ book (TB) reconciliation (strict block) ──────────────
  // The PPE schedule now drives the BS PPE/Intangibles face. A schedule that
  // disagrees with the COA/TB book value would otherwise be silently absorbed
  // into Capital by the BS residual plug, so compare the schedule closing total
  // to the book NCE_PPE + NCE_INTG and block export on any drift > ₹100, naming
  // PPE as the offender. The schedule is CY-only, so this is a CY check.
  const ppeScheduleClosing = (ncePpeData ?? []).reduce(
    (s: number, r: any) => s + (Number(r.closing_balance) || 0), 0);
  const ppeBookClosing =
    (coaTotalsByCode["NCE_PPE"]?.cy ?? 0) + (coaTotalsByCode["NCE_INTG"]?.cy ?? 0);
  const ppeScheduleDrift = Math.round((ppeScheduleClosing - ppeBookClosing) * 100) / 100;
  const hasPpeScheduleDrift = isNonCorporate && Math.abs(ppeScheduleDrift) > 100;

  // ── Single-PY-source gate: CY Tally opening MUST equal PY-shell closing ──
  // for every Balance-Sheet ledger (accounting identity: this year's opening
  // = last year's close). PY is sourced ONLY from the PY-shell closing; the
  // COA Mapping page is frozen Tally Sync. When the two disagree, FS
  // generation is BLOCKED and each offending ledger is named below so the
  // user fixes the source in Tally rather than shipping wrong financials.
  // Runs only when a PY-shell TB exists (first-year engagements have nothing
  // to reconcile against).
  const openingReconResult = useMemo(
    () => validateOpeningVsPriorClose({
      cyTb:       tallyTb ?? [],
      pyShellTb:  pyShellTb ?? [],
      coaMapping,
      aliases,
    }),
    [tallyTb, pyShellTb, coaMapping, aliases],
  );
  const hasOpeningMismatch = openingReconResult.mismatches.length > 0;

  // Phase 8 Step 2: persist severe drift to fs_reconciliation_log so
  // historical drift is auditable.
  // PERF FIX: The old dependency `fsReconResult?.computedAt` used
  // `new Date().toISOString()` — a new string on every recompute, so the
  // effect fired a Supabase INSERT on every render cycle. Now we build a
  // stable fingerprint from the severe drift codes and only log when the
  // set of drifted codes actually changes (or on first mount).
  const driftFingerprint = useMemo(() => {
    if (!fsReconResult || fsReconResult.severeCount === 0) return "";
    return fsReconResult.rows
      .filter(r => r.status === "drift_severe")
      .map(r => `${r.code}:${r.delta.cy}:${r.delta.py}`)
      .sort()
      .join("|");
  }, [fsReconResult]);
  useEffect(() => {
    if (driftFingerprint && fsReconResult && fsReconResult.severeCount > 0) {
      logReconciliationDrift(engagementId, user?.id ?? null, fsReconResult).catch(() => {});
    }
  }, [driftFingerprint, engagementId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Final Export Excel gate: corporate must satisfy ALL three; non-corporate
  // entities use BS-balance + severe-drift check.
  // Phase 8 — when the COA-anchor cure is ON (FS_NO_MANUAL_NOTE_ADD), the BS face
  // is sourced from books-COA, so (a) an unmapped non-zero ledger is the real
  // remaining failure mode and MUST block (else the absorber hides it in Capital),
  // and (b) the PPE-schedule-vs-books drift is now a disclosure mismatch (the face
  // already uses books PPE), so it no longer blocks the BS export. When the cure
  // is OFF, behaviour is byte-identical to before.
  const exportExcelBlocked: boolean = isNonCorporate
    ? (!nceBsBalanced || hasSevereDrift || hasOpeningMismatch
        || (FS_NO_MANUAL_NOTE_ADD ? nceUnmappedNonZero.count > 0 : hasPpeScheduleDrift))
    : (!corpBsBalanced || !corpBsBalancedPy || !faPyEntered || hasOpeningMismatch || corpHasSevereDrift);
  const exportExcelBlockReasons: string[] = [];
  // BUG-094/108: branch was inverted vs the gate above (isNonCorporate ? NCE : corp).
  // `if (!isNonCorporate)` pushed NCE reasons for corporate engagements (and vice-versa),
  // so the blocked-export message was empty/wrong. Aligned to the gate. Figure-neutral:
  // exportExcelBlocked is unchanged; only the displayed reason text is corrected.
  if (isNonCorporate) {
    if (!nceBsBalanced)   exportExcelBlockReasons.push(`Balance Sheet out by ₹${Math.abs(nceBsDiff).toLocaleString("en-IN")}`);
    if (hasSevereDrift)   exportExcelBlockReasons.push(`${fsReconResult!.severeCount} note(s) have drift > ₹100 — fix in Notes tab first`);
    if (FS_NO_MANUAL_NOTE_ADD && nceUnmappedNonZero.count > 0)
      exportExcelBlockReasons.push(`${nceUnmappedNonZero.count} TB ledger(s) (net ₹${Math.abs(nceUnmappedNonZero.net).toLocaleString("en-IN")}) are not mapped to any FS code — complete COA Mapping; the Balance Sheet cannot be trusted until they are mapped`);
  } else {
    if (!corpBsBalanced)   exportExcelBlockReasons.push(`CY Balance Sheet out by ₹${Math.abs(bsDiff).toLocaleString("en-IN")}`);
    if (!corpBsBalancedPy) exportExcelBlockReasons.push(`PY Balance Sheet out by ₹${Math.abs(bsDiffPy).toLocaleString("en-IN")}`);
    if (!faPyEntered)      exportExcelBlockReasons.push("FA Note — Previous-Year totals not entered");
    if (corpHasSevereDrift) exportExcelBlockReasons.push(`${corpReconResult!.severeCount} corporate note(s) have drift > ₹100 — fix in Notes tab first`);
  }
  // PPE schedule reconciliation reason — applies to NCE only (guard already
  // includes isNonCorporate). Pushed outside the if/else like the gate below.
  // Under the COA-anchor cure the BS face uses books PPE, so schedule-vs-books is
  // a disclosure mismatch, not a BS block (it no longer gates exportExcelBlocked).
  if (hasPpeScheduleDrift && !FS_NO_MANUAL_NOTE_ADD) {
    exportExcelBlockReasons.push(
      `PPE schedule closing (₹${Math.abs(ppeScheduleClosing).toLocaleString("en-IN")}) does not match the books (₹${Math.abs(ppeBookClosing).toLocaleString("en-IN")}) — reconcile the PPE Schedule to the ledger`,
    );
  }
  // Single-PY-source gate reason — applies to BOTH entity paths (pushed
  // outside the if/else so it is never swallowed by branch wiring).
  if (hasOpeningMismatch) {
    const n = openingReconResult.mismatches.length;
    exportExcelBlockReasons.push(
      `${n} ledger(s) where CY opening ≠ PY-shell closing — fix the opening balance in Tally (see “Opening balances do not tie to prior year” banner below)`,
    );
  }
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
  // Resolve the partner name FIRST. If engagement.partner_name is empty
  // (legacy engagements / partner picked via partner_id only), fall back
  // to the users-table row resolved by partner_id.
  const sigPartnerName  =
    engPartnerName || partnerData?.name || "";
  // FIX: previously the roster match ran against `engPartnerName` only —
  // so a legacy engagement that displayed the partner via partnerData.name
  // never matched the firm's membership_numbers roster, leaving Membership
  // No. blank in the BS / P&L / CFS signature blocks. Match against the
  // RESOLVED sigPartnerName (whichever source the UI is actually showing),
  // case-insensitively, after trim. Falls back to partnerData.membership_number
  // and finally to a blank.
  const firmMnoEntry    = (() => {
    const target = (sigPartnerName || "").trim().toLowerCase();
    if (!target || !Array.isArray(firmData?.membership_numbers)) return null;
    return (firmData!.membership_numbers as any[]).find(
      (m: any) => (m?.partner_name || "").trim().toLowerCase() === target,
    ) || null;
  })();
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
  // Auto-load directors: clients.directors (canonical) → questionnaire_answers.directors → mrl_data.header_data
  // Always re-runs when engagementId or engagement.client_id change.
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      try {
        const clientId = (engagement as any)?.client_id;
        const [engResult, mrlResult, clientResult] = await Promise.all([
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
          clientId
            ? (supabase as any).from("clients").select("directors").eq("id", clientId).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (cancelled) return;

        // Priority 1: clients.directors (set via client Advanced Info)
        const clientDirs: { name: string; din: string }[] = Array.isArray(clientResult.data?.directors)
          ? (clientResult.data.directors as any[]).filter((d: any) => d?.name?.trim() || d?.din?.trim())
          : [];

        if (clientDirs.length > 0) {
          const next: DirState = {
            dir1Name: clientDirs[0]?.name || "",
            dir1Din:  clientDirs[0]?.din  || "",
            dir2Name: clientDirs[1]?.name || "",
            dir2Din:  clientDirs[1]?.din  || "",
          };
          setCorpSigDirs(next);
          try { window.localStorage.setItem(SIG_DIR_KEY, JSON.stringify(next)); } catch {}
          return;
        }

        // Priority 2: questionnaire_answers.directors (legacy engagement setup)
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

        // Priority 3: mrl_data.header_data fallback
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
  }, [engagementId, (engagement as any)?.client_id]);

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
        const signed = fsSignedBalance(row.closing_balance, row.balance_type, "DR");
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

  // ─── Phase 1 (re-sync flow): Refresh Notes from re-synced Trial Balance ──
  // Unlike the disabled recorrectFromCOAMapping (which ran on every mount and
  // overwrote audit-verified data), this is an EXPLICIT, auditor-initiated
  // action, offered ONLY when:
  //   (a) the TB was re-synced AFTER the notes were last built (stale), AND
  //   (b) notes are NOT finalized (write-protection honoured).
  // It re-runs nceAutoPopulate, which rebuilds ONLY the TB-derived auto rows
  // while preserving every manual custom row, and persists both cy_data and
  // py_data — so the revised figures flow TB → Notes → BS/PL face for CY & PY.
  const refreshNotesFromTB = async () => {
    if (!isNonCorporate) {
      toast.error("Notes refresh is only supported for non-corporate (NCE) entities.");
      return;
    }
    // Hard gate: never overwrite finalized / write-protected notes.
    if (!notesStaleness.canRefresh) {
      toast.error(
        notesStaleness.verdict === "stale_locked"
          ? "Notes are finalized (write-protected). Unlock notes before refreshing from TB."
          : "Notes are already up to date with the trial balance.",
      );
      return;
    }
    const ok = window.confirm(
      "Refresh Notes to Accounts from the re-synced Trial Balance?\n\n" +
      "Auto rows will be rebuilt from the current Tally TB × COA mapping. " +
      "Manual rows and any values you typed are PRESERVED. " +
      "The CY and PY columns of the Notes — and the BS / P&L face that reads " +
      "them — will re-align with the latest TB.\n\nClick OK to continue.",
    );
    if (!ok) return;
    setRefreshingNotes(true);
    try {
      // 1. Load currently-saved notes so manual rows pass through untouched.
      const { data: existingRows } = await (supabase.from as any)("nce_financial_notes")
        .select("note_type, cy_data, py_data")
        .eq("engagement_id", engagementId)
        .eq("financial_year", engagement?.financial_year ?? "");
      const built: Record<string, any> = {};
      for (const r of (existingRows ?? []) as any[]) {
        const cy = (r.cy_data ?? {}) as Record<string, any>;
        const py = (r.py_data ?? {}) as Record<string, any>;
        const customRows = Array.isArray(cy._custom_rows) ? cy._custom_rows : [];
        const cleanCy: Record<string, number> = {};
        const cleanPy: Record<string, number> = {};
        for (const [k, v] of Object.entries(cy)) {
          if (k === "_custom_rows") continue;
          if (typeof v === "number") cleanCy[k] = v;
        }
        for (const [k, v] of Object.entries(py)) {
          if (k === "_custom_rows") continue;
          if (typeof v === "number") cleanPy[k] = v;
        }
        built[r.note_type] = { cy: cleanCy, py: cleanPy, customRows };
      }

      // 2. Rebuild auto rows from the live (re-synced) TB + COA mapping.
      const populated = await nceAutoPopulate(engagementId, built);

      // 3. Persist both cy_data and py_data.
      const rows = Object.entries(populated).map(([noteType, d]) => {
        const { cy_data, py_data } = serialiseNoteData(d);
        return {
          engagement_id:  engagementId,
          financial_year: engagement?.financial_year ?? "",
          note_type:      noteType,
          cy_data:        cy_data as any,
          py_data:        py_data as any,
          updated_at:     new Date().toISOString(),
        };
      });
      // BUG 2 fix: delete-first rebuild so the persisted notes are a pure
      // function of (TB × COA) + the in-memory manual overlay; removes orphan
      // note_type rows. OFF = legacy upsert-merge.
      if (NCE_RESYNC_DELETE_FIRST) {
        await supabase
          .from("nce_financial_notes")
          .delete()
          .eq("engagement_id", engagementId)
          .eq("financial_year", engagement?.financial_year ?? "");
      }
      const { error: saveErr } = await supabase
        .from("nce_financial_notes")
        .upsert(rows, { onConflict: "engagement_id,financial_year,note_type" });
      if (saveErr) throw saveErr;

      // 4. Drop non-manual FS rows so the Stage-2 fallback in nceAutoPopulate
      //    doesn't re-inject stale FS totals next time. Manual overrides kept.
      await supabase
        .from("fa_financial_statements")
        .delete()
        .eq("engagement_id", engagementId)
        .eq("is_manual", false);

      // 5. Invalidate the dependent queries so the face + staleness banner refresh.
      queryClient.invalidateQueries({ queryKey: ["nce-financial-notes", engagementId] });
      queryClient.invalidateQueries({ queryKey: ["fs-rows", engagementId] });
      queryClient.invalidateQueries({ queryKey: ["engagement", engagementId] });
      queryClient.invalidateQueries({ queryKey: ["notes-staleness", engagementId] });

      toast.success("Notes refreshed from the re-synced trial balance");
    } catch (e: any) {
      console.error("[refreshNotesFromTB]", e);
      toast.error(e?.message || "Notes refresh failed");
    } finally {
      setRefreshingNotes(false);
    }
  };

  // ─── Re-correct FS from COA Mapping (NCE) ────────────────────────────────
  // 2026-05-30 — when the auditor has deleted custom rows in the Notes-to-
  // Accounts (removing values from the breakup), the FS face stops matching
  // COA mapping because the BS/PL face is computed off the note totals. This
  // handler re-runs the same auto-populate the Notes Re-sync button uses,
  // persists the rebuilt notes, then invalidates the React Query cache so
  // the FS face re-renders with the corrected totals. Mirrors handleResync
  // in NCEDetailedNotes — extracted here so the user can fix the BS face
  // directly when they see an imbalance without navigating to Notes first.
  const recorrectFromCOAMapping = async () => {
    // WRITE-PROTECTED: function disabled. Was rebuilding notes from COA on
    // demand and overwriting audit-verified note data. The button that
    // called this is already removed; this guard hardens the function
    // itself in case any other path tries to invoke it.
    toast.error("Re-correct from COA Mapping is disabled. Notes are write-protected.");
    return;
    // eslint-disable-next-line @typescript-eslint/no-unreachable-code, no-unreachable
    if (!isNonCorporate) {
      toast.error("Re-correct from COA is currently only supported for non-corporate (NCE) entities.");
      return;
    }
    const ok = window.confirm(
      "Re-correct Financial Statements from COA Mapping?\n\n" +
      "Auto rows in the Notes to Accounts will be refreshed from the Tally TB. " +
      "Manual rows and any values you typed are preserved. " +
      "The BS / P&L face will then re-align with COA mapping totals.\n\n" +
      "Click OK to continue.",
    );
    if (!ok) return;
    setRecorrectingFromCOA(true);
    // Phase 2: kick off the timer modal. Cleared in the finally block so
    // the modal stays up on failure with the elapsed time visible.
    const t0 = Date.now();
    setRecorrectStartedAt(t0);
    setRecorrectElapsedSec(0);
    setRecorrectResult(null);
    try {
      // 1. Load whatever's currently saved so we pass it through and only
      //    update auto-rows (mirrors NCEDetailedNotes load → populate flow).
      const { data: existingRows } = await (supabase.from as any)("nce_financial_notes")
        .select("note_type, cy_data, py_data")
        .eq("engagement_id", engagementId)
        .eq("financial_year", engagement?.financial_year ?? "");
      const built: Record<string, any> = {};
      for (const r of (existingRows ?? []) as any[]) {
        // Lightweight deserialise: we only need .cy / .py / customRows for
        // nceAutoPopulate to merge. The library does its own normalisation.
        const cy = (r.cy_data ?? {}) as Record<string, any>;
        const py = (r.py_data ?? {}) as Record<string, any>;
        const customRows = Array.isArray(cy._custom_rows) ? cy._custom_rows : [];
        const cleanCy: Record<string, number> = {};
        const cleanPy: Record<string, number> = {};
        for (const [k, v] of Object.entries(cy)) {
          if (k === "_custom_rows") continue;
          if (typeof v === "number") cleanCy[k] = v;
        }
        for (const [k, v] of Object.entries(py)) {
          if (k === "_custom_rows") continue;
          if (typeof v === "number") cleanPy[k] = v;
        }
        built[r.note_type] = { cy: cleanCy, py: cleanPy, customRows };
      }

      // 2. Re-populate auto rows from Tally TB + COA mapping
      const populated = await nceAutoPopulate(engagementId, built);
      const notesRegenerated = Object.keys(populated).length;

      // 3. Persist back to nce_financial_notes (upsert)
      const rows = Object.entries(populated).map(([noteType, d]) => {
        const { cy_data, py_data } = serialiseNoteData(d);
        return {
          engagement_id:  engagementId,
          financial_year: engagement?.financial_year ?? "",
          note_type:      noteType,
          cy_data:        cy_data as any,
          py_data:        py_data as any,
          updated_at:     new Date().toISOString(),
        };
      });
      const { error: saveErr } = await supabase
        .from("nce_financial_notes")
        .upsert(rows, { onConflict: "engagement_id,financial_year,note_type" });
      if (saveErr) throw saveErr;

      // 4. Delete non-manual fa_financial_statements rows so the Stage 2
      //    fallback in nceAutoPopulate doesn't re-inject stale FS totals on the
      //    next Re-correct call. Manual overrides (is_manual=true) are kept —
      //    they were set explicitly by the auditor and must survive re-correction.
      await supabase
        .from("fa_financial_statements")
        .delete()
        .eq("engagement_id", engagementId)
        .eq("is_manual", false);

      // 5. Invalidate the FS face query + the notes query so the next render
      //    picks up the corrected totals. Also invalidate fs-rows so the
      //    manualOverrides state reloads from DB (RC2 fix: previously stale
      //    manualOverrides persisted after Re-correct because fs-rows wasn't
      //    invalidated, causing manual-override amounts to keep showing even
      //    for codes where notes had already been rebuilt to 0).
      queryClient.invalidateQueries({ queryKey: ["nce-financial-notes", engagementId] });
      queryClient.invalidateQueries({ queryKey: ["fs-rows", engagementId] });
      queryClient.invalidateQueries({ queryKey: ["engagement", engagementId] });

      toast.success("Financial Statements re-corrected from COA Mapping");
      setRecorrectResult({
        notes: notesRegenerated,
        seconds: Math.round((Date.now() - t0) / 100) / 10,
      });
    } catch (e: any) {
      console.error("[recorrectFromCOAMapping]", e);
      toast.error(e?.message || "Re-correction failed");
      // Surface the elapsed-on-failure number too so the modal still resolves.
      setRecorrectResult({
        notes: 0,
        seconds: Math.round((Date.now() - t0) / 100) / 10,
      });
    } finally {
      setRecorrectingFromCOA(false);
      setRecorrectStartedAt(null);
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
      // ─── Corporate template-driven export ───────────────────────────────
      //  Mirrors the NCE template path above.  Uses
      //  public/templates/corporate-financials.xlsx as a master file and
      //  fills only the data cells + scalar placeholders.  Falls through
      //  to the legacy fsExcelExport (pixel-perfect Schedule III builder)
      //  if the template can't be loaded — and that itself falls through
      //  to the inline ExcelJS writer if anything goes wrong there too.
      try {
        const fyPartsT = String(engagement?.financial_year || "").split("-");
        const cyEndYearT = fyPartsT.length === 2
          ? parseInt(fyPartsT[0], 10) + 1
          : cyYear;
        const ayT = fyPartsT.length === 2
          ? `${cyEndYearT}-${(cyEndYearT + 1).toString().slice(-2)}`
          : "";
        const reportDateFmtT = (() => {
          // The on-screen signature block binds its Date field to `sigDate`
          // (defaults to today, user-editable) — NOT engagement.sign_off_date.
          // Match the UI: format sigDate ("YYYY-MM-DD" → "DD/MM/YYYY").
          // Parse the ISO parts directly to avoid any timezone day-shift.
          if (/^\d{4}-\d{2}-\d{2}$/.test(sigDate || "")) {
            const [y, m, d] = sigDate.split("-");
            return `${d}/${m}/${y}`;
          }
          const raw = (engagement as any)?.sign_off_date;
          if (!raw) return "";
          try {
            const d = new Date(raw);
            if (isNaN(d.getTime())) return "";
            const dd = String(d.getDate()).padStart(2, "0");
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            return `${dd}/${mm}/${d.getFullYear()}`;
          } catch { return ""; }
        })();

        // Build corporate FS code → CY/PY map.
        //
        // CRITICAL: pull from fsDisplayData.bs / .pl (the SAME source the
        // on-screen BS/PL tabs use), NOT from raw cyOf/pyOf.  fsDisplayData
        // already runs Phase E notes-aware substitution (sumNotesSubRowsCY
        // ?? cyOf), so the exported amounts will match what the auditor
        // sees on screen — including:
        //   - Trade payables that read from the populated breakup sum
        //   - Reserves PY pulled from prior-engagement / py_manual_amounts
        //   - Deferred tax positive face value (notes-aware, not raw -ve)
        //
        // Convert Tally-convention signed values to positive face values for
        // the Excel template.  All equity / liability / revenue codes arrive as
        // negative numbers (credit-side sign convention from ncyOf / memo*);
        // Math.abs converts them to the positive face values the template expects.
        // Accumulated-deficit reserves will also become positive — the template
        // number format "#,##0.00;(#,##0.00)" will still render a deficit as
        // "(amount)" because the underlying value from Tally is already negative
        // for a debit-balance reserve account.
        const pos = (v: number | null | undefined): number => {
          const n = Number(v);
          if (!Number.isFinite(n)) return 0;
          return Math.abs(n);
        };
        const corpAmounts: Record<string, { cy: number; py: number }> =
          (memoBs && memoPl) ? {
            // ── Equity & Liabilities ─────────────────────────────────────
            BS_EQ_SC:    { cy: pos(memoBs.shareCap.cy),         py: pos(memoBs.shareCap.py) },
            BS_EQ_RS:    { cy: pos(memoBs.reserves.cy),         py: pos(memoBs.reserves.py) },
            BS_NCL_LTB:  { cy: pos(memoBs.ltBorrowings.cy),     py: pos(memoBs.ltBorrowings.py) },
            BS_NCL_DTL:  { cy: pos(memoBs.dtLiab.cy),           py: pos(memoBs.dtLiab.py) },
            BS_NCL_OLT:  { cy: pos(memoBs.otherLtLiab.cy),      py: pos(memoBs.otherLtLiab.py) },
            BS_NCL_LTP:  { cy: pos(memoBs.ltProvisions.cy),     py: pos(memoBs.ltProvisions.py) },
            BS_CL_STB:   { cy: pos(memoBs.stBorrowings.cy),     py: pos(memoBs.stBorrowings.py) },
            BS_CL_TP:    { cy: pos(memoBs.tradePayOthers.cy),   py: pos(memoBs.tradePayOthers.py) },
            BS_CL_OCL:   { cy: pos(memoBs.otherCurrLiab.cy),    py: pos(memoBs.otherCurrLiab.py) },
            BS_CL_STP:   { cy: pos(memoBs.stProvisions.cy),     py: pos(memoBs.stProvisions.py) },
            // ── Assets ───────────────────────────────────────────────────
            BS_NCA_FA:   { cy: pos(memoBs.ppe.cy),              py: pos(memoBs.ppe.py) },
            BS_NCA_INV:  { cy: pos(memoBs.ncInvestments.cy),    py: pos(memoBs.ncInvestments.py) },
            BS_NCA_DTA:  { cy: pos(memoBs.dtAssets.cy),         py: pos(memoBs.dtAssets.py) },
            BS_NCA_LLA:  { cy: pos(memoBs.ltLoans.cy),          py: pos(memoBs.ltLoans.py) },
            BS_NCA_ONA:  { cy: pos(memoBs.otherNcAssets.cy),    py: pos(memoBs.otherNcAssets.py) },
            BS_CA_CI:    { cy: pos(memoBs.currInvestments.cy),  py: pos(memoBs.currInvestments.py) },
            BS_CA_INV:   { cy: pos(memoBs.inventories.cy),      py: pos(memoBs.inventories.py) },
            BS_CA_TR:    { cy: pos(memoBs.tradeRec.cy),         py: pos(memoBs.tradeRec.py) },
            BS_CA_CCE:   { cy: pos(memoBs.cashBank.cy),         py: pos(memoBs.cashBank.py) },
            BS_CA_SLA:   { cy: pos(memoBs.stLoans.cy),          py: pos(memoBs.stLoans.py) },
            BS_CA_OCA:   { cy: pos(memoBs.otherCurrAssets.cy),  py: pos(memoBs.otherCurrAssets.py) },
            // ── P&L ──────────────────────────────────────────────────────
            PL_REV_OPS:  { cy: pos(memoPl.revFromOps.cy),       py: pos(memoPl.revFromOps.py) },
            PL_REV_OI:   { cy: pos(memoPl.otherIncome.cy),      py: pos(memoPl.otherIncome.py) },
            PL_EXP_MAT:  { cy: pos(memoPl.costMaterials.cy),    py: pos(memoPl.costMaterials.py) },
            PL_EXP_SIT:  { cy: pos(memoPl.purchasesStock.cy),   py: pos(memoPl.purchasesStock.py) },
            PL_EXP_CII:  { cy: memoPl.changesInventories.cy ?? 0, py: memoPl.changesInventories.py ?? 0 }, // signed (can be negative)
            PL_EXP_EMP:  { cy: pos(memoPl.employeeBenefits.cy), py: pos(memoPl.employeeBenefits.py) },
            PL_EXP_FIN:  { cy: pos(memoPl.financeCosts.cy),     py: pos(memoPl.financeCosts.py) },
            PL_EXP_DEP:  { cy: pos(memoPl.depreciation.cy),     py: pos(memoPl.depreciation.py) },
            PL_EXP_OTH:  { cy: pos(memoPl.otherExpenses.cy),    py: pos(memoPl.otherExpenses.py) },
            PL_TAX_CUR:  { cy: pos(memoPl.currentTax.cy),       py: pos(memoPl.currentTax.py) },
            // Deferred tax can be DTA (negative-stored) or DTL (positive) — keep signed
            PL_TAX_DEF:  { cy: memoPl.deferredTax.cy ?? 0,      py: memoPl.deferredTax.py ?? 0 },
          } : (() => {
            // Fallback when fsDisplayData isn't populated (shouldn't happen
            // for corporate engagement reaching this branch).  Use raw TB
            // so we still emit something rather than zeros.
            const out: Record<string, { cy: number; py: number }> = {};
            const codes = [
              "BS_EQ_SC","BS_EQ_RS","BS_NCL_LTB","BS_NCL_DTL","BS_NCL_OLT","BS_NCL_LTP",
              "BS_CL_STB","BS_CL_TP","BS_CL_OCL","BS_CL_STP",
              "BS_NCA_FA","BS_NCA_INV","BS_NCA_DTA","BS_NCA_LLA","BS_NCA_ONA",
              "BS_CA_CI","BS_CA_INV","BS_CA_TR","BS_CA_CCE","BS_CA_SLA","BS_CA_OCA",
              "PL_REV_OPS","PL_REV_OI","PL_EXP_MAT","PL_EXP_SIT","PL_EXP_EMP",
              "PL_EXP_FIN","PL_EXP_DEP","PL_EXP_OTH","PL_EXP_CII","PL_TAX_CUR","PL_TAX_DEF",
            ];
            for (const code of codes) out[code] = { cy: pos(cyOf(code)), py: pos(pyOf(code)) };
            return out;
          })();

        const clientT = (engagement?.clients ?? {}) as any;
        const { buildCorporateFinancialsXLSX } =
          await import("@/lib/fsExcelTemplateCorporate");
        // Note numbers per FS code — pulled from each memoBs/memoPl row's
        // noteNo property (already populated by the dynamic registry inside
        // fsDisplayData useMemo).  Same source the on-screen BS/PL Note
        // No. column reads from, so the export matches the screen.
        const corpNoteNos: Record<string, number | null | undefined> =
          (memoBs && memoPl) ? {
            BS_EQ_SC:    memoBs.shareCap.noteNo ?? null,
            BS_EQ_RS:    memoBs.reserves.noteNo ?? null,
            BS_NCL_LTB:  memoBs.ltBorrowings.noteNo ?? null,
            BS_NCL_DTL:  memoBs.dtLiab.noteNo ?? null,
            BS_NCL_OLT:  memoBs.otherLtLiab.noteNo ?? null,
            BS_NCL_LTP:  memoBs.ltProvisions.noteNo ?? null,
            BS_CL_STB:   memoBs.stBorrowings.noteNo ?? null,
            BS_CL_TP:    memoBs.tradePayables.noteNo ?? null,
            BS_CL_OCL:   memoBs.otherCurrLiab.noteNo ?? null,
            BS_CL_STP:   memoBs.stProvisions.noteNo ?? null,
            BS_NCA_FA:   memoBs.ppe.noteNo ?? null,
            BS_NCA_INV:  memoBs.ncInvestments.noteNo ?? null,
            BS_NCA_DTA:  memoBs.dtAssets.noteNo ?? null,
            BS_NCA_LLA:  memoBs.ltLoans.noteNo ?? null,
            BS_NCA_ONA:  memoBs.otherNcAssets.noteNo ?? null,
            BS_CA_CI:    memoBs.currInvestments.noteNo ?? null,
            BS_CA_INV:   memoBs.inventories.noteNo ?? null,
            BS_CA_TR:    memoBs.tradeRec.noteNo ?? null,
            BS_CA_CCE:   memoBs.cashBank.noteNo ?? null,
            BS_CA_SLA:   memoBs.stLoans.noteNo ?? null,
            BS_CA_OCA:   memoBs.otherCurrAssets.noteNo ?? null,
            PL_REV_OPS:  memoPl.revFromOps.noteNo ?? null,
            PL_REV_OI:   memoPl.otherIncome.noteNo ?? null,
            PL_EXP_MAT:  memoPl.costMaterials.noteNo ?? null,
            PL_EXP_SIT:  memoPl.purchasesStock.noteNo ?? null,
            PL_EXP_CII:  memoPl.changesInventories.noteNo ?? null,
            PL_EXP_EMP:  memoPl.employeeBenefits.noteNo ?? null,
            PL_EXP_FIN:  memoPl.financeCosts.noteNo ?? null,
            PL_EXP_DEP:  memoPl.depreciation.noteNo ?? null,
            PL_EXP_OTH:  memoPl.otherExpenses.noteNo ?? null,
          } : {};

        // Load Stage-7 ratios so the RATIO sheet gets filled (CY amounts +
        // PY ratio).  Uses the SAME loader/engine as the on-screen Ratios
        // tab, so the exported RATIO sheet matches the UI.  Non-fatal: on
        // failure the RATIO sheet keeps the template's zeros.
        let corpRatios: { cy: any; py: any } | undefined;
        try {
          const { loadStage7Ratios } = await import("@/lib/ratioAutoPopulate");
          const s7 = await loadStage7Ratios(engagement.id);
          corpRatios = { cy: s7.cy, py: s7.py };
        } catch (e) {
          console.warn("[FS Export] Could not load stage7_ratios for RATIO sheet:", e);
        }

        // Load the FA / PPE schedule for the FA sheet, using the SAME loader
        // the on-screen FA grid uses (loadStage5Notes), so the export matches
        // the UI exactly.  Non-fatal: on failure the FA sheet keeps template rows.
        let corpFa: { rows: any[]; pyManual?: Record<string, number | null> } | undefined;
        try {
          const { loadStage5Notes } = await import("@/lib/notesAutoPopulate");
          const s5 = await loadStage5Notes(engagement.id);
          if (s5?.fa?.rows?.length) {
            corpFa = { rows: s5.fa.rows, pyManual: s5.fa.py_manual ?? undefined };
          }
        } catch (e) {
          console.warn("[FS Export] Could not load stage5_notes FA for FA sheet:", e);
        }

        const blob = await buildCorporateFinancialsXLSX({
          entityName:    clientName,
          entityType:    clientT.entity_type ?? "Private Limited",
          address:       clientT.registered_office ?? clientT.address ?? "",
          pan:           clientT.pan ?? "",
          gstin:         Array.isArray(clientT.gstin) ? (clientT.gstin[0] ?? "") : (clientT.gstin ?? ""),
          tan:           clientT.tan_number ?? "",
          cin:           clientT.cin ?? "",
          business:      clientT.business_activity ?? "",
          financialYear: fy,
          assessmentYear: ayT,
          cyYear:        cyEndYearT,
          pyYear:        cyEndYearT - 1,
          firmName:      sigFirmName || "",
          firmFRN:       sigFirmFRN  || "",
          partnerName:   sigPartnerName || "",
          membershipNo:  sigMembershipNo || "",
          place:         sigPlace || sigFirmCity || "",
          reportDate:    reportDateFmtT,
          udin:          (engagement as any)?.udin ?? "",
          amounts:       corpAmounts,
          noteNumbers:   corpNoteNos,
          ratios:        corpRatios,
          // Directors come from the SAME state the on-screen signature block
          // shows (Block C → mrl_data fallback), so the export matches the UI.
          directors:     [
            { name: corpSigDirs.dir1Name, din: corpSigDirs.dir1Din },
            { name: corpSigDirs.dir2Name, din: corpSigDirs.dir2Din },
          ],
          fa:            corpFa,
        });
        const safeNmT = (clientName || "Client").replace(/[^A-Za-z0-9]/g, "_");
        const urlT    = URL.createObjectURL(blob);
        const aT      = document.createElement("a");
        aT.href     = urlT;
        aT.download = `FS_${safeNmT}_${fy || "FY"}.xlsx`;
        document.body.appendChild(aT);
        aT.click();
        document.body.removeChild(aT);
        URL.revokeObjectURL(urlT);
        toast.success("Financial Statements exported (Corporate template format)");
        return;
      } catch (errT: any) {
        console.error("[FS Export] Corporate template export failed, falling back:", errT);
        toast.warning(`Using pixel-perfect format: ${errT?.message || "template export failed"}`);
        // Fall through to existing pixel-perfect fsExcelExport path below
      }

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

        // Build NCE FS code → CY/PY amount map.
        //
        // Pull from nceCyAmounts / ncePyAmounts — these are the Phase-E
        // notes-aware NCE amount maps built earlier in fsDisplayData
        // (Bug 5 fix).  They include manual overrides AND notes-breakup
        // substitutions, matching exactly what the BS/PL tabs render
        // on screen.  Math.abs() applied because the printed face is
        // always positive for both liabilities and assets.
        const posN = (v: number | null | undefined): number => {
          const n = Number(v);
          if (!Number.isFinite(n)) return 0;
          return Math.abs(n);
        };
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
          // nceCyAmounts has signs matching the on-screen layer
          // (liabilities negative for negL display path), so abs() to flip
          // to printed positive face value.
          const cyV = (nceCyAmounts as Record<string, number>)[code];
          const pyV = (ncePyAmounts as Record<string, number>)[code];
          amounts[code] = {
            cy: posN(cyV ?? cyOf(code)),
            py: posN(pyV ?? pyOf(code)),
          };
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

          {/* 2026-06-05 Phase 4 — Face cells with a linked note are READ-ONLY.
               The face value MUST come from the Note's grand total; any
               auditor adjustment lives inside the note as a manual row.
               This eliminates a whole class of three-way reconciliation
               drift (face ≠ note ≠ COA) by forbidding the most common
               cause: a stale FS-face override left over after Notes were
               re-corrected. Cells without a linked note (NCE_CWIP,
               BS_NCA_FA_TAN, etc.) stay editable. */}
          {(() => {
            const linkedNoteRef = item.noteRef;
            const displayNoteNo = linkedNoteRef
              ? (nceDynamicNoteMap.get(linkedNoteRef) ?? "")
              : "";
            const hasLinkedNote = isNonCorporate && !!linkedNoteRef && !!displayNoteNo;
            const lockedTip = displayNoteNo
              ? `This value comes from Note ${displayNoteNo}. Edit the note to change it.`
              : "This value comes from a linked note. Edit the note to change it.";
            return (
              <>
                {/* CY amount + pencil */}
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
                        disabled={hasLinkedNote}
                        className={`opacity-0 group-hover:opacity-100 hover:opacity-100 p-0.5 rounded ml-1 ${hasLinkedNote ? "cursor-not-allowed" : "hover:bg-muted"}`}
                        title={hasLinkedNote ? lockedTip
                          : item.code && INV_PL_CODES.has(item.code) && hasInvMapping
                          ? "Auto-computed from inventory TB. Override if Tally P&L opening stock differs from ledger opening balance."
                          : "Override CY amount"}
                        onClick={() => !hasLinkedNote && openOverride(item.code, item.name)}
                      >
                        {hasLinkedNote
                          ? <Lock size={9} className="text-muted-foreground" />
                          : <Pencil size={9} className={item.code && INV_PL_CODES.has(item.code) && hasInvMapping ? "text-blue-400" : "text-muted-foreground"} />}
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
                        disabled={hasLinkedNote}
                        className={`opacity-0 group-hover:opacity-100 hover:opacity-100 p-0.5 rounded ml-1 ${hasLinkedNote ? "cursor-not-allowed" : "hover:bg-muted"}`}
                        title={hasLinkedNote ? lockedTip : (hasPyOverride ? "Edit PY override" : "Override PY amount")}
                        onClick={() => !hasLinkedNote && openPyOverride(item.code, item.name)}
                      >
                        {hasLinkedNote
                          ? <Lock size={9} className="text-muted-foreground" />
                          : <Pencil size={9} className={hasPyOverride ? "text-amber-600" : "text-muted-foreground"} />}
                      </button>
                    )}
                    {!isHeader && pyLocked && hasPyOverride && (
                      <Lock size={9} className="text-muted-foreground ml-1" title="PY finalized — locked" />
                    )}
                  </div>
                </TableCell>

                {/* CY pencil (legacy action column — also gated for linked notes) */}
                <TableCell className="w-10 text-center">
                  {!isHeader && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={hasLinkedNote}
                      title={hasLinkedNote ? lockedTip : "Override CY amount"}
                      onClick={() => !hasLinkedNote && openOverride(item.code, item.name)}
                    >
                      {hasLinkedNote ? <Lock size={11} /> : <Pencil size={11} />}
                    </Button>
                  )}
                </TableCell>
              </>
            );
          })()}
        </TableRow>
      );
    });

  // ─── NCE Signature Block (reused in BS + P&L tabs) ───────────────────────
  // Shown only when isNonCorporate === true. Corporate signature handling is
  // managed elsewhere and must not be changed.
  //
  // 2026-05-30 — restructured to MATCH the Word export (nceFinancialsDocx.ts
  // → buildSignatureTable) line for line so the on-screen preview tallies
  // with the downloaded .docx:
  //   • Left  column: Firm / CA / FRN → blank line → __________ →
  //                   Partner name → "Partner" → Membership No. → UDIN:
  //   • Right column (with extra left indent, mirroring the docx's 1440 dxa
  //                   left margin): Place → Date → blank → For, Client →
  //                   __________ → Signatory name input → Designation
  //   • "As per our Audit Report of even date" header removed (the Word
  //                   export does not include it; the preview must not either).
  //   • Place/Date are NO LONGER duplicated on both sides — only on the right,
  //                   matching the export.
  const designation = (() => {
    const c = (entityType || "").toLowerCase().trim();
    // LLP must be checked BEFORE "partnership" because
    // "Limited Liability Partnership" contains "partnership".
    if (c.includes("llp") || c.includes("limited liability partnership")) return "Designated Partner";
    if (c.includes("partnership")) return "Partner / Authorised Signatory";
    // "Individual" is how Tally registers sole-proprietors.
    if (c.includes("proprietor") || c === "individual") return "Proprietor";
    return "Authorised Signatory";
  })();
  const sigUdin = (engagement as any)?.udin ?? "";
  const sigDateFmt = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((sigDate || "").trim());
    return m ? `${m[3]}/${m[2]}/${m[1]}` : sigDate;
  })();
  const nceSignatureBlock = isNonCorporate ? (
    <div className="mt-4 rounded-lg border bg-card px-6 py-6 text-[11px]">
      <div className="grid grid-cols-2 gap-x-8">
        {/* ── Left — CA Firm block ─────────────────────────────────────── */}
        <div className="space-y-0.5">
          <div className="font-bold text-[#1A2744]">
            For, {sigFirmName || <span className="italic text-muted-foreground">[Audit Firm Name]</span>}
          </div>
          <div>Chartered Accountants</div>
          <div>FRN {sigFirmFRN || <span className="italic">[FRN]</span>}</div>

          <div className="h-6" />{/* gap row matching Word's spacing.before */}
          <div className="font-mono">__________________</div>
          <div className="font-bold text-[#1A2744]">
            {sigPartnerName || <span className="italic text-muted-foreground">[Partner Name]</span>}
          </div>
          <div>Partner</div>
          <div>Membership No. {sigMembershipNo || <span className="italic">—</span>}</div>
          <div>UDIN: {sigUdin || <span className="italic text-muted-foreground">—</span>}</div>
        </div>

        {/* ── Right — Place / Date + Client signatory (indented like docx) ── */}
        <div className="pl-8 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="shrink-0">Place:</span>
            <Input
              placeholder="City"
              value={sigPlace}
              onChange={e => setSigPlace(e.target.value)}
              className="h-5 text-[11px] px-1 flex-1 max-w-[160px]"
            />
          </div>
          <div className="h-3" />{/* 240 dxa gap before Date */}
          <div className="flex items-center gap-2">
            <span className="shrink-0">Date:</span>
            <Input
              type="date"
              value={sigDate}
              onChange={e => setSigDate(e.target.value)}
              className="h-5 text-[11px] px-1 flex-1 max-w-[160px]"
            />
            <span className="text-muted-foreground text-[10px] italic">
              {sigDateFmt ? `(${sigDateFmt})` : ""}
            </span>
          </div>

          <div className="h-8" />{/* 480 dxa gap before "For, Client" */}
          <div className="font-bold text-[#1A2744]">
            For, {sigClientName || <span className="italic text-muted-foreground">[Client Name]</span>}
          </div>

          <div className="h-6" />{/* gap row before signature line */}
          <div className="font-mono">__________________</div>
          <Input
            placeholder="Authorised Signatory Name"
            value={sigSignatoryName}
            onChange={e => setSigSignatoryName(e.target.value)}
            className="h-6 text-[11px] px-1 font-bold mt-0.5 max-w-[260px]"
          />
          <div className="text-muted-foreground">{designation}</div>
        </div>
      </div>
    </div>
  ) : null;

  // ─── Corporate Word export handler (extracted so the font-picker dialog can call it) ──
  const handleCorpWordExport = async () => {
    try {
      if (!fsDisplayData) {
        toast.error("Financial statements not yet loaded. Please wait and try again.");
        return;
      }
      const { bs: memoBsD, pl: memoPLD } = fsDisplayData;
      if (!memoBsD || !memoPLD) {
        toast.error("Financial statements data not available.");
        return;
      }

      const posD = (v: number | null | undefined): number => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.abs(n) : 0;
      };

      // Build PAT for EPS computation
      const patCyD = (posD(memoPLD.revFromOps.cy) + posD(memoPLD.otherIncome.cy))
        - (posD(memoPLD.costMaterials.cy) + posD(memoPLD.purchasesStock.cy)
          + (memoPLD.changesInventories.cy ?? 0)
          + posD(memoPLD.employeeBenefits.cy) + posD(memoPLD.financeCosts.cy)
          + posD(memoPLD.depreciation.cy) + posD(memoPLD.otherExpenses.cy))
        - posD(memoPLD.currentTax.cy) - (memoPLD.deferredTax.cy ?? 0);
      const patPyD = (posD(memoPLD.revFromOps.py) + posD(memoPLD.otherIncome.py))
        - (posD(memoPLD.costMaterials.py) + posD(memoPLD.purchasesStock.py)
          + (memoPLD.changesInventories.py ?? 0)
          + posD(memoPLD.employeeBenefits.py) + posD(memoPLD.financeCosts.py)
          + posD(memoPLD.depreciation.py) + posD(memoPLD.otherExpenses.py))
        - posD(memoPLD.currentTax.py) - (memoPLD.deferredTax.py ?? 0);

      const sharesCyD = getSharesOutstanding(stage5NotesData ?? null, "cy");
      const sharesPyD = getSharesOutstanding(stage5NotesData ?? null, "py");
      const epsBasicCyD = sharesCyD > 0 ? patCyD / sharesCyD : 0;
      const epsBasicPyD = sharesPyD > 0 ? patPyD / sharesPyD : 0;

      const corpDocxAmounts: Record<string, { cy: number; py: number }> = {
        BS_EQ_SC:    { cy: posD(memoBsD.shareCap.cy),        py: posD(memoBsD.shareCap.py) },
        BS_EQ_RS:    { cy: posD(memoBsD.reserves.cy),        py: posD(memoBsD.reserves.py) },
        BS_NCL_LTB:  { cy: posD(memoBsD.ltBorrowings.cy),    py: posD(memoBsD.ltBorrowings.py) },
        BS_NCL_DTL:  { cy: posD(memoBsD.dtLiab.cy),          py: posD(memoBsD.dtLiab.py) },
        BS_NCL_OLT:  { cy: posD(memoBsD.otherLtLiab.cy),     py: posD(memoBsD.otherLtLiab.py) },
        BS_NCL_LTP:  { cy: posD(memoBsD.ltProvisions.cy),    py: posD(memoBsD.ltProvisions.py) },
        BS_CL_STB:   { cy: posD(memoBsD.stBorrowings.cy),    py: posD(memoBsD.stBorrowings.py) },
        BS_CL_TP:    { cy: posD(memoBsD.tradePayOthers.cy),  py: posD(memoBsD.tradePayOthers.py) },
        BS_CL_OCL:   { cy: posD(memoBsD.otherCurrLiab.cy),   py: posD(memoBsD.otherCurrLiab.py) },
        BS_CL_STP:   { cy: posD(memoBsD.stProvisions.cy),    py: posD(memoBsD.stProvisions.py) },
        BS_NCA_FA:   { cy: posD(memoBsD.ppe.cy),             py: posD(memoBsD.ppe.py) },
        BS_NCA_INV:  { cy: posD(memoBsD.ncInvestments.cy),   py: posD(memoBsD.ncInvestments.py) },
        BS_NCA_DTA:  { cy: posD(memoBsD.dtAssets.cy),        py: posD(memoBsD.dtAssets.py) },
        BS_NCA_LLA:  { cy: posD(memoBsD.ltLoans.cy),         py: posD(memoBsD.ltLoans.py) },
        BS_NCA_ONA:  { cy: posD(memoBsD.otherNcAssets.cy),   py: posD(memoBsD.otherNcAssets.py) },
        BS_CA_CI:    { cy: posD(memoBsD.currInvestments.cy), py: posD(memoBsD.currInvestments.py) },
        BS_CA_INV:   { cy: posD(memoBsD.inventories.cy),     py: posD(memoBsD.inventories.py) },
        BS_CA_TR:    { cy: posD(memoBsD.tradeRec.cy),        py: posD(memoBsD.tradeRec.py) },
        BS_CA_CCE:   { cy: posD(memoBsD.cashBank.cy),        py: posD(memoBsD.cashBank.py) },
        BS_CA_SLA:   { cy: posD(memoBsD.stLoans.cy),         py: posD(memoBsD.stLoans.py) },
        BS_CA_OCA:   { cy: posD(memoBsD.otherCurrAssets.cy), py: posD(memoBsD.otherCurrAssets.py) },
        PL_REV_OPS:  { cy: posD(memoPLD.revFromOps.cy),      py: posD(memoPLD.revFromOps.py) },
        PL_REV_OI:   { cy: posD(memoPLD.otherIncome.cy),     py: posD(memoPLD.otherIncome.py) },
        PL_EXP_MAT:  { cy: posD(memoPLD.costMaterials.cy),   py: posD(memoPLD.costMaterials.py) },
        PL_EXP_SIT:  { cy: posD(memoPLD.purchasesStock.cy),  py: posD(memoPLD.purchasesStock.py) },
        PL_EXP_CII:  { cy: memoPLD.changesInventories.cy ?? 0, py: memoPLD.changesInventories.py ?? 0 },
        PL_EXP_EMP:  { cy: posD(memoPLD.employeeBenefits.cy), py: posD(memoPLD.employeeBenefits.py) },
        PL_EXP_FIN:  { cy: posD(memoPLD.financeCosts.cy),    py: posD(memoPLD.financeCosts.py) },
        PL_EXP_DEP:  { cy: posD(memoPLD.depreciation.cy),    py: posD(memoPLD.depreciation.py) },
        PL_EXP_OTH:  { cy: posD(memoPLD.otherExpenses.cy),   py: posD(memoPLD.otherExpenses.py) },
        PL_TAX_CUR:  { cy: posD(memoPLD.currentTax.cy),      py: posD(memoPLD.currentTax.py) },
        PL_TAX_DEF:  { cy: memoPLD.deferredTax.cy ?? 0,      py: memoPLD.deferredTax.py ?? 0 },
        PL_EI:       { cy: 0, py: 0 },
        PL_EPS_B:    { cy: epsBasicCyD,  py: epsBasicPyD },
        PL_EPS_D:    { cy: epsBasicCyD,  py: epsBasicPyD },
      };

      const corpDocxNoteNos: Record<string, number | null | undefined> = {
        BS_EQ_SC:    memoBsD.shareCap.noteNo ?? null,
        BS_EQ_RS:    memoBsD.reserves.noteNo ?? null,
        BS_NCL_LTB:  memoBsD.ltBorrowings.noteNo ?? null,
        BS_NCL_DTL:  memoBsD.dtLiab.noteNo ?? null,
        BS_NCL_OLT:  memoBsD.otherLtLiab.noteNo ?? null,
        BS_NCL_LTP:  memoBsD.ltProvisions.noteNo ?? null,
        BS_CL_STB:   memoBsD.stBorrowings.noteNo ?? null,
        BS_CL_TP:    memoBsD.tradePayables.noteNo ?? null,
        BS_CL_OCL:   memoBsD.otherCurrLiab.noteNo ?? null,
        BS_CL_STP:   memoBsD.stProvisions.noteNo ?? null,
        BS_NCA_FA:   memoBsD.ppe.noteNo ?? null,
        BS_NCA_INV:  memoBsD.ncInvestments.noteNo ?? null,
        BS_NCA_DTA:  memoBsD.dtAssets.noteNo ?? null,
        BS_NCA_LLA:  memoBsD.ltLoans.noteNo ?? null,
        BS_NCA_ONA:  memoBsD.otherNcAssets.noteNo ?? null,
        BS_CA_CI:    memoBsD.currInvestments.noteNo ?? null,
        BS_CA_INV:   memoBsD.inventories.noteNo ?? null,
        BS_CA_TR:    memoBsD.tradeRec.noteNo ?? null,
        BS_CA_CCE:   memoBsD.cashBank.noteNo ?? null,
        BS_CA_SLA:   memoBsD.stLoans.noteNo ?? null,
        BS_CA_OCA:   memoBsD.otherCurrAssets.noteNo ?? null,
        PL_REV_OPS:  memoPLD.revFromOps.noteNo ?? null,
        PL_REV_OI:   memoPLD.otherIncome.noteNo ?? null,
        PL_EXP_MAT:  memoPLD.costMaterials.noteNo ?? null,
        PL_EXP_SIT:  memoPLD.purchasesStock.noteNo ?? null,
        PL_EXP_CII:  memoPLD.changesInventories.noteNo ?? null,
        PL_EXP_EMP:  memoPLD.employeeBenefits.noteNo ?? null,
        PL_EXP_FIN:  memoPLD.financeCosts.noteNo ?? null,
        PL_EXP_DEP:  memoPLD.depreciation.noteNo ?? null,
        PL_EXP_OTH:  memoPLD.otherExpenses.noteNo ?? null,
        PL_EPS_B:    memoPLD.eps.noteNo ?? null,
        PL_EPS_D:    memoPLD.eps.noteNo ?? null,
      };

      // Load stage7_ratios for the ratios page
      let corpDocxRatios: { cy: any; py: any } | undefined;
      try {
        const { loadStage7Ratios } = await import("@/lib/ratioAutoPopulate");
        const s7 = await loadStage7Ratios(engagement.id);
        corpDocxRatios = { cy: s7.cy, py: s7.py, commentary: s7.commentary } as any;
      } catch (e) {
        console.warn("[FS DOCX] Could not load stage7_ratios:", e);
      }

      // Lock Preview parity with NCE — when the FS is locked, the export
      // must reflect the same shape as the on-screen locked preview:
      //   • hideBlankNoteRows: drop notes where both years are essentially zero
      //   • collapsedNotes:    drop whole notes the auditor had collapsed
      //   • collapsedGroups:   drop the member rows of collapsed sub-groups
      // The two collapse sets come straight from the same localStorage bags
      // that NoteCard / ListTable hydrate from, so editor ↔ preview ↔ export
      // are always in sync.
      let lockedCollapsedNotes: Set<string> | undefined;
      let lockedCollapsedGroups: Set<string> | undefined;
      if (corpIsLocked) {
        try {
          const rawN = localStorage.getItem(`fs_corp_collapsed_notes_${engagementId}`);
          const parsedN = rawN ? JSON.parse(rawN) : [];
          lockedCollapsedNotes = new Set<string>(Array.isArray(parsedN) ? parsedN : []);
        } catch { /* storage unavailable — ignore */ }
        try {
          const rawG = localStorage.getItem(`fs_corp_collapsed_groups_${engagementId}`);
          const parsedG = rawG ? JSON.parse(rawG) : [];
          lockedCollapsedGroups = new Set<string>(Array.isArray(parsedG) ? parsedG : []);
        } catch { /* storage unavailable — ignore */ }
      }

      await generateCorporateFinancialsDocx({
        engagement,
        amounts:     corpDocxAmounts,
        noteNumbers: corpDocxNoteNos,
        cyYear,
        pyYear,
        signature: {
          firmName:     sigFirmName,
          firmFRN:      sigFirmFRN,
          partnerName:  sigPartnerName,
          membershipNo: sigMembershipNo,
          dir1Name:     corpSigDirs.dir1Name,
          dir1Din:      corpSigDirs.dir1Din,
          dir2Name:     corpSigDirs.dir2Name,
          dir2Din:      corpSigDirs.dir2Din,
          place:        sigPlace || sigFirmCity || "",
          date:         sigDate,
        },
        stage5Notes: stage5NotesData ?? null,
        ratios: corpDocxRatios,
        font: corpExportFont,
        // When locked, force "expand sub-groups" ON so the export can use
        // the per-group collapsedGroups filter (NCE pattern). Unlocked
        // exports keep the legacy global "expand sub-groups" toggle.
        expandSubGroups: corpIsLocked ? true : corpExpandSubGroups,
        faPyRows: (priorFaRows as any) ?? null,
        hideBlankNoteRows: corpIsLocked,
        collapsedNotes:    lockedCollapsedNotes,
        collapsedGroups:   lockedCollapsedGroups,
      });
      toast.success("Financial Statements exported as Word document");
    } catch (err: any) {
      console.error("[FS DOCX] Corporate export failed:", err);
      toast.error(`Word export failed: ${err?.message || "Unknown error"}`);
    }
  };

  return (
    <FsUnitsProvider engagementId={engagementId} forceScale={isNonCorporate ? "actual" : undefined}>
    {/* 2026-06-05 Phase 2 — Re-correct progress modal. Wraps the whole
         FS view so it sits above every action surface (Save All Notes,
         export, navigation, the Re-correct button itself). Visible while
         recorrectingFromCOA is true; after completion it switches to a
         "Done" view that the user dismisses. While in progress every
         other interactive control is blanked behind the backdrop. */}
    {(recorrectingFromCOA || recorrectResult !== null) && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-sm">
        <div className="rounded-lg border bg-background p-6 shadow-xl min-w-[320px] max-w-md text-center space-y-3">
          {recorrectingFromCOA ? (
            <>
              <div className="flex items-center justify-center gap-2 text-base font-semibold">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Re-correcting from COA Mapping…
              </div>
              <div className="text-3xl font-mono font-bold tabular-nums text-foreground">
                {recorrectElapsedSec.toFixed(1)}s
              </div>
              <p className="text-xs text-muted-foreground">
                Rebuilding every NCE note from Tally TB + COA mapping. Manual
                rows and typed values are preserved. Do not close this tab.
              </p>
            </>
          ) : recorrectResult && recorrectResult.notes > 0 ? (
            <>
              <div className="flex items-center justify-center gap-2 text-base font-semibold text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                Done
              </div>
              <p className="text-sm">
                <span className="font-semibold">{recorrectResult.notes}</span> note
                {recorrectResult.notes === 1 ? "" : "s"} regenerated in{" "}
                <span className="font-semibold">{recorrectResult.seconds.toFixed(1)}s</span>.
              </p>
              <Button size="sm" onClick={() => setRecorrectResult(null)}>OK</Button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 text-base font-semibold text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Re-correct failed
              </div>
              <p className="text-xs text-muted-foreground">
                Failed after {recorrectResult?.seconds.toFixed(1)}s.
                See toast / console for details.
              </p>
              <Button size="sm" variant="outline" onClick={() => setRecorrectResult(null)}>Dismiss</Button>
            </>
          )}
        </div>
      </div>
    )}
    {/* 2026-06-05 Phase 5 — Generate Financial Statements (Export Excel)
         progress modal. Same shape as the Re-correct modal above so the
         auditor gets a uniform feedback surface across both long-running
         FS actions. Blocks every other interactive control while in
         flight to prevent half-built workbooks. */}
    {(exportingFS || exportResult !== null) && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-sm">
        <div className="rounded-lg border bg-background p-6 shadow-xl min-w-[320px] max-w-md text-center space-y-3">
          {exportingFS ? (
            <>
              <div className="flex items-center justify-center gap-2 text-base font-semibold">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Generating Financial Statements…
              </div>
              <div className="text-3xl font-mono font-bold tabular-nums text-foreground">
                {exportElapsedSec.toFixed(1)}s
              </div>
              <p className="text-xs text-muted-foreground">
                Building the pixel-perfect Schedule III workbook (Balance Sheet,
                P&amp;L, Cash Flow, Notes, ratios). Do not close this tab.
              </p>
            </>
          ) : exportResult?.ok ? (
            <>
              <div className="flex items-center justify-center gap-2 text-base font-semibold text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                Done
              </div>
              <p className="text-sm">
                Workbook downloaded in{" "}
                <span className="font-semibold">{exportResult.seconds.toFixed(1)}s</span>.
              </p>
              <Button size="sm" onClick={() => setExportResult(null)}>OK</Button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 text-base font-semibold text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Export failed
              </div>
              <p className="text-xs text-muted-foreground">
                Failed after {exportResult?.seconds.toFixed(1)}s.
                {exportResult?.note ? ` — ${exportResult.note}` : ""}
              </p>
              <Button size="sm" variant="outline" onClick={() => setExportResult(null)}>Dismiss</Button>
            </>
          )}
        </div>
      </div>
    )}
    <div className="max-w-6xl space-y-4">
      <EngagementHeader engagement={engagement} stageNumber={7} stageLabel="Financial Statements" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Stage 7 — Financial Statements</h1>
          <p className="text-xs text-muted-foreground">Generated from mapped trial balance</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Task 5 (doc6): unit toggle hidden for NCE — actual values only */}
          {!isNonCorporate && <FsUnitsToggle />}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (exportExcelBlocked) {
                // Surface the validation failure as a blocking toast so the
                // auditor sees WHY the export can't run without having to
                // hover the button. The list of reasons is built upstream
                // and shown one per line via toast.error's description.
                toast.error("Cannot export Excel yet", {
                  description: exportExcelBlockReasons.map(r => `• ${r}`).join("\n"),
                  duration: 8000,
                  style: { whiteSpace: "pre-line" },
                });
                return;
              }
              // 2026-06-05 Phase 5 — wrap the export with the loading-timer
              // modal so the auditor sees elapsed seconds, can't double-
              // click into a half-built workbook, and gets a "Done in Xs"
              // confirmation on completion. Disables every other surface
              // behind the z-200 backdrop.
              (async () => {
                const t0 = Date.now();
                setExportingFS(true);
                setExportStartedAt(t0);
                setExportElapsedSec(0);
                setExportResult(null);
                try {
                  await exportToExcel();
                  setExportResult({
                    ok: true,
                    seconds: Math.round((Date.now() - t0) / 100) / 10,
                  });
                } catch (e: any) {
                  console.error("[Export FS] failed", e);
                  setExportResult({
                    ok: false,
                    seconds: Math.round((Date.now() - t0) / 100) / 10,
                    note: e?.message || "Export failed",
                  });
                } finally {
                  setExportingFS(false);
                  setExportStartedAt(null);
                }
              })();
            }}
            className={cn("gap-1", exportExcelBlocked && "opacity-60 hover:bg-destructive/10 hover:text-destructive")}
            title={
              exportExcelBlocked
                ? "Export Excel is blocked until:\n• " + exportExcelBlockReasons.join("\n• ")
                : "Export the full Financial Statements workbook to .xlsx"
            }
          >
            <Download size={14} /> Export Excel
          </Button>
          {/* Phase 8: Export Word blocked when severe drift detected */}
          {isNonCorporate && (
            <Button
              variant="outline"
              size="sm"
              className={cn("gap-1", (hasSevereDrift || hasOpeningMismatch || hasPpeScheduleDrift) && "opacity-60")}
              title={hasSevereDrift
                ? `Export Word blocked: ${fsReconResult!.severeCount} note(s) have drift > ₹100. Fix in Notes tab first.`
                : hasPpeScheduleDrift
                ? `Export Word blocked: PPE schedule closing (₹${Math.abs(ppeScheduleClosing).toLocaleString("en-IN")}) does not match the books (₹${Math.abs(ppeBookClosing).toLocaleString("en-IN")}). Reconcile the PPE Schedule.`
                : hasOpeningMismatch
                ? `Export Word blocked: ${openingReconResult.mismatches.length} ledger(s) where CY opening ≠ PY-shell closing. Fix the opening balance in Tally (see banner above).`
                : "Export Balance Sheet + P&L as a Big4-style Word document (.docx)"}
              disabled={hasSevereDrift || hasOpeningMismatch || hasPpeScheduleDrift}
              onClick={() => setShowNCEFontDialog(true)}
            >
              <FileText size={14} /> Export Word
            </Button>
          )}
          {isNonCorporate && (
            <Button
              variant={nceIsLocked ? "default" : "outline"}
              size="sm"
              className={cn("gap-1", nceIsLocked && "bg-amber-500 hover:bg-amber-600 border-amber-500")}
              title={nceIsLocked ? "Preview is locked — export uses current expand/collapse state. Click to unlock." : "Lock current expand/collapse state for export"}
              onClick={() => {
                const next = !nceIsLocked;
                setNceIsLocked(next);
                // Task 1 (doc6): open preview popup immediately on lock
                if (next) setNcePreviewOpen(true);
              }}
            >
              {nceIsLocked ? "🔓 Unlock Preview" : "🔒 Lock Preview"}
            </Button>
          )}
          {!isNonCorporate && (
            <Button
              variant="outline"
              size="sm"
              className={cn("gap-1", corpHasSevereDrift && "opacity-60")}
              title={corpHasSevereDrift
                ? `Export Word blocked: ${corpReconResult!.severeCount} corporate note(s) have drift > ₹100. Fix in Notes tab first.`
                : "Export Balance Sheet + P&L + Notes as a Big4-style Word document (.docx)"}
              disabled={corpHasSevereDrift}
              onClick={() => setShowCorpFontDialog(true)}
            >
              <FileText size={14} /> Export Word
            </Button>
          )}
          {!isNonCorporate && (
            <Button
              variant={corpIsLocked ? "default" : "outline"}
              size="sm"
              className={cn("gap-1", corpIsLocked && "bg-amber-500 hover:bg-amber-600 border-amber-500")}
              title={corpIsLocked ? "Preview is locked — click to unlock." : "Lock current state for export and preview the draft financial statements"}
              onClick={() => {
                const next = !corpIsLocked;
                setCorpIsLocked(next);
                if (next) setCorpPreviewOpen(true);
              }}
            >
              {corpIsLocked ? "🔓 Unlock Preview" : "🔒 Lock Preview"}
            </Button>
          )}
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

      {/* Corporate Lock Preview banner — visual indicator that the FS view is
          locked for export. Matches NCE's lock-mode visual treatment so the
          auditor always knows when their FS is review-frozen. */}
      {!isNonCorporate && corpIsLocked && (
        <div className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex items-center gap-2">
          <Lock className="h-4 w-4 text-amber-600" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              Preview Locked
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Financial Statements are locked for export. Notes editing is disabled. Unlock to make changes.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setCorpPreviewOpen(true)}
          >
            Re-open Preview
          </Button>
        </div>
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

      {/* 2026-06-05 Phase 2 — PY Shell status indicator. Tells the auditor
           which PY data source is feeding the BS / P&L PY column right now,
           so when a sign-fix re-sync misses an engagement it's obvious WHY:
             • "synced (X ledgers)"  - PY shell engagement exists with TB rows
             • "exists but empty"    - PY shell created but TB not synced yet
             • "not created"         - no FY-1 engagement at all
             • "using prior engagement" - a regular FY-1 engagement is the source
           When the shell is empty or missing, nceAutoPopulate's signedOpening
           fallback (Phase 2 fix) uses the CY TB opening_balance as the PY
           value — surfacing that here lets the auditor know the BS PY column
           is computed via the fallback rather than a real PY-shell sync. */}
      {isNonCorporate && (() => {
        const isShell  = !!pyShellInfo?.isShell;
        const shellId  = pyShellInfo?.id ?? null;
        const ledCount = pyShellTb?.length ?? 0;
        let label   = "";
        let chipCls = "";
        let detail  = "";
        if (isShell && ledCount > 0) {
          label   = `PY Shell: synced (${ledCount} ledgers)`;
          chipCls = "border-emerald-300 bg-emerald-50 text-emerald-800";
          detail  = "BS / P&L PY column reads the synced PY-shell trial balance.";
        } else if (isShell && ledCount === 0) {
          label   = "PY Shell: exists but empty";
          chipCls = "border-amber-300 bg-amber-50 text-amber-800";
          detail  = "Shell engagement exists but no TB rows have been synced. " +
                    "BS / P&L PY falls back to CY opening balances. " +
                    "Sync the PY shell's Tally TB to use real PY closing balances.";
        } else if (!isShell && shellId) {
          label   = "PY Shell: using prior engagement";
          chipCls = "border-sky-300 bg-sky-50 text-sky-800";
          detail  = "BS / P&L PY column reads the previous year's actual engagement.";
        } else {
          label   = "PY Shell: not created — using CY opening balances as PY";
          chipCls = "border-amber-300 bg-amber-50 text-amber-800";
          detail  = "No FY-1 engagement found. BS / P&L PY column is computed " +
                    "from this year's TB opening balances (= prior-year close " +
                    "by accounting identity).";
        }
        return (
          <div className={cn(
            "flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-[11px]",
            chipCls,
          )}>
            <span className="font-semibold">{label}</span>
            <span className="text-[10px] opacity-80">— {detail}</span>
          </div>
        );
      })()}

      {/* Single-PY-source gate banner — names every Balance-Sheet ledger
           whose CY Tally opening does not equal its PY-shell closing. While
           any such ledger exists, FS generation (Excel + Word) is blocked so
           the user cannot ship financials built on a broken opening balance. */}
      {hasOpeningMismatch && (
        <Alert variant="destructive" className="border-destructive/40 mb-3">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            Opening balances do not tie to prior year — financial statements blocked
          </AlertTitle>
          <AlertDescription>
            <p className="mb-2 text-xs">
              PY is sourced only from the PY-shell closing, and the COA Mapping
              (Tally Sync) opening must equal it. The Balance-Sheet ledger(s)
              below do not match. Fix the opening balance in Tally (or the
              PY-shell), re-sync, and the statements unblock automatically.
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide opacity-70 border-b border-current/30">
                  <th className="py-1 pr-2 font-medium">Ledger</th>
                  <th className="py-1 pr-2 font-medium text-right">CY opening</th>
                  <th className="py-1 pr-2 font-medium text-right">PY closing</th>
                  <th className="py-1 pr-2 font-medium text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {openingReconResult.mismatches.slice(0, 50).map((m) => (
                  <tr key={`${m.ledger}-${m.code}`} className="border-b border-current/10 last:border-0">
                    <td className="py-1 pr-2">
                      {m.ledger}
                      {m.kind === "py_only" && (
                        <span className="text-[10px] opacity-70 ml-1">(not in current-year TB)</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{m.cyOpening.toLocaleString("en-IN")}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{m.pyClosing.toLocaleString("en-IN")}</td>
                    <td className="py-1 pr-2 text-right tabular-nums font-medium">{m.diff.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {openingReconResult.mismatches.length > 50 && (
              <p className="mt-1 text-[10px] opacity-70">
                + {openingReconResult.mismatches.length - 50} more ledger(s)…
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* 2026-06-05 — FS Health structural guarantee panel. Phase 4: now
           a three-way breakdown (COA / Manual / Note / Face) so legitimate
           auditor adjustments are visible distinctly from reconciliation
           bugs. Phase 6: also runs for Corporate engagements (uses
           stage5_notes via sumNotesSubRowsCY/PY). See
           src/lib/fsReconciliation.ts for the invariant logic. */}
      {/* Phase 1 (re-sync flow) — Notes-staleness banner. The BS/PL face reads
           the persisted notes snapshot, so after a Tally re-sync the figures
           below can be stale. Surface it explicitly instead of leaving the
           auditor to decode a red drift panel. Refresh is offered ONLY when
           notes are not finalized (write-protection honoured). */}
      {isNonCorporate && notesStaleness.isStale && (
        <Alert variant="destructive" className="border-amber-400/50 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Trial balance re-synced after notes were built</AlertTitle>
          <AlertDescription>
            <p className="text-xs mb-2">
              The Notes to Accounts (and the BS / P&amp;L figures below, which read
              from them) were last built on{" "}
              <strong>{notesStaleness.latestNotesUpdatedAt
                ? new Date(notesStaleness.latestNotesUpdatedAt).toLocaleString("en-IN")
                : "—"}</strong>, but the trial balance was re-synced on{" "}
              <strong>{notesStaleness.latestTbSyncedAt
                ? new Date(notesStaleness.latestTbSyncedAt).toLocaleString("en-IN")
                : "—"}</strong>. The figures shown may not reflect the latest TB.
            </p>
            {notesStaleness.canRefresh ? (
              <Button
                size="sm"
                variant="outline"
                disabled={refreshingNotes}
                onClick={refreshNotesFromTB}
              >
                {refreshingNotes ? "Refreshing…" : "Refresh notes from TB"}
              </Button>
            ) : (
              <p className="text-xs font-medium">
                Notes are finalized (write-protected). Unlock notes to refresh, or
                reconcile the difference manually before exporting.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <FsHealthPanel
        engagementId={engagementId}
        nceNotesByType={isNonCorporate ? nceNotesByType : undefined}
        corporateNotes={isNonCorporate ? undefined : stage5NotesData}
        bsFaceCy={isNonCorporate ? nceCyAmounts : computedAmounts}
        bsFacePy={isNonCorporate ? ncePyAmounts : computedAmountsPY}
        coaTotals={coaTotalsByCode}
        visible={true}
        precomputedResult={fsReconResult}
        bsResidual={isNonCorporate ? { cy: nceBsResidualCy, py: nceBsResidualPy } : null}
      />

      {/* 2026-05-30 — Re-correct banner: when the NCE BS doesn't balance,
           expose a one-click action that re-runs nceAutoPopulate so the
           BS / P&L face realigns with COA mapping. The auditor reported
           that deleting custom rows in Notes left the FS face out of sync
           with COA mapping; this gives them a direct fix without having to
           navigate to the Notes tab and click Re-sync there. */}
      {/* 2026-06-05 Phase 5 — Balance Sheet imbalance banner. Now states
           WHICH side is heavier (assets > equity+liabilities or the other
           way) so the auditor knows immediately whether to chase an asset
           ledger overstatement or a missing liability. The old generic
           "Difference: Rs.X" was just "something is wrong somewhere".
           Removed the separate "X note total don't match" amber banner -
           every per-line drift is already enumerated in the FsHealthPanel
           breakdown right above, so the duplicate table was confusing
           rather than helpful. */}
      {isNonCorporate && !activeBsBalanced && (() => {
        // nceTotalAssets > 0, nceTotalLiabilities < 0 (stored negative).
        // bsDiff = assets + liabilities. Positive → assets heavier;
        // negative → equity + liabilities heavier.
        const assetsHeavier = activeBsDiff > 0;
        const heavySide  = assetsHeavier ? "Total Assets" : "Total Equity + Liabilities";
        const lightSide  = assetsHeavier ? "Total Equity + Liabilities" : "Total Assets";
        return (
          <Alert variant="destructive" className="border-destructive/30">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Balance Sheet not balanced</AlertTitle>
            <AlertDescription>
              <span>
                <strong>{heavySide}</strong> exceeds <strong>{lightSide}</strong> by{" "}
                <strong>₹{formatINR(Math.abs(activeBsDiff))}</strong>.
              </span>
            </AlertDescription>
          </Alert>
        );
      })()}

      {/* Summary cards */}
      <div className="grid grid-cols-7 gap-3">
        {/* CY BS Check */}
        <Card className={cn(activeBsBalanced ? "border-primary/30" : "border-destructive/30")}>
          <CardContent className="p-3 text-center">
            <p className={cn("text-2xl font-bold", activeBsBalanced ? "text-primary" : "text-destructive")}>
              {activeBsBalanced ? "✓" : `₹${formatINR(Math.abs(activeBsDiff))}`}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">BS Check (CY)</p>
          </CardContent>
        </Card>
        {/* PY BS Check */}
        <Card className={cn(activeBsBalancedPy ? "border-primary/30" : "border-destructive/30")}>
          <CardContent className="p-3 text-center">
            <p className={cn("text-2xl font-bold", activeBsBalancedPy ? "text-primary" : "text-destructive")}>
              {activeBsBalancedPy ? "✓" : `₹${formatINR(Math.abs(activeBsDiffPy))}`}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">BS Check (PY)</p>
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
        {/* Issue 12 + Issue 3 (today) — Manual Overrides card.
             Counts ALL THREE override stores so every surface in the app
             agrees on the same number:
               (a) manualOverrides  — fa_financial_statements is_manual rows
                                       (auditor-typed amount overrides)
               (b) noteOverrides    — FS note-number overrides in localStorage
               (c) stage5_notes.manual_edits — dot-paths the auditor has
                                       touched inside any Note's editable cell
             Previously the top card summed only (a)+(b) while the Notes
             tab header showed only (c), so a 2-vs-7 discrepancy appeared
             whenever notes were edited.  Now both surfaces display the
             same SUM. */}
        {(() => {
          // Issue 2 — Manual Overrides tile must count overrides EVERYWHERE:
          //   (a) FS-face amount overrides     — manualOverrides
          //   (b) FS-face note-number overrides — noteOverrides (localStorage)
          //   (c) Corporate Notes manual edits  — stage5_notes.manual_edits
          //   (d) NCE Notes manual custom rows  — nce_financial_notes →
          //       cy_data.customRows / py_data.customRows where source = "manual"
          // Previously (d) was missing, so the tile read 0 on NCE engagements
          // even when notes-to-accounts had dozens of manual rows. Counting
          // every source here makes the tile (which is already clickable and
          // opens a list dialog where each override can be reverted to auto)
          // an accurate single source of truth for "what's been hand-edited".
          // NCE custom rows live in cy_data._custom_rows (single array per note,
          // covers BOTH CY and PY — there is no separate py_data.customRows).
          // The NCE notes badge at NCEDetailedNotes line 2850 reads from the same
          // shape after deserialiseNoteData. Counting cy_data.customRows /
          // py_data.customRows (an earlier guess) read undefined keys and made
          // the tile permanently show 0 even with 100+ manual rows in notes.
          let nceNoteManual = 0;
          if (isNonCorporate && Array.isArray(nceNotesData)) {
            for (const n of nceNotesData as any[]) {
              const rows = Array.isArray(n?.cy_data?._custom_rows)
                ? n.cy_data._custom_rows
                : [];
              nceNoteManual += rows.filter((r: any) => r?.source === "manual").length;
            }
          }
          const overrideTotal = Object.keys(manualOverrides).length
            + Object.values(noteOverrides).filter(v => v != null && Number.isFinite(v as number)).length
            + (Array.isArray(stage5NotesData?.manual_edits) ? stage5NotesData!.manual_edits.length : 0)
            + nceNoteManual;
          return (
            <Card
              className={cn(
                "transition-colors",
                overrideTotal > 0
                  ? "cursor-pointer border-amber-400/60 hover:bg-amber-50/40 dark:hover:bg-amber-950/20"
                  : "border-amber-300/30",
              )}
              onClick={() => {
                if (overrideTotal === 0) {
                  toast.info("No manual overrides applied yet.");
                  return;
                }
                setManualOverrideListOpen(true);
              }}
            >
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-amber-600">{overrideTotal}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Manual Overrides</p>
              </CardContent>
            </Card>
          );
        })()}
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
                {/* FIX: P&L must use nceCyAmounts/ncePyAmounts (note-overridden)
                     not computedAmounts/mergedPY (raw TB). The BS view already
                     used nceCyAmounts — P&L was left on raw TB, causing
                     face values to diverge from note totals for SHRI RAM
                     PRODUCTS and all other NCE clients. */}
                <NCEPLView
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
                /* Issue 3 (today) — pass amount + note-no override counts so
                   the Notes header total matches the Stage 7 top card total. */
                extraOverrideCount={
                  Object.keys(manualOverrides).length
                  + Object.values(noteOverrides).filter(v => v != null && Number.isFinite(v as number)).length
                }
                companyName={engagement?.clients?.name || ""}
                readOnly={corpIsLocked}
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
              {/* Bug 1 fix: initialExpandedRows is only passed when locked so the
                  editor's readOnly flat-div layout (tabs→flat remount) restores
                  expansion state.  In edit mode, omit it to avoid a render loop
                  (nceExpandedRows change → prop change → NCEDetailedNotes re-renders
                  → onExpansionChange effects re-fire → setNceExpandedRows → repeat).
                  When locked, nceExpandedRows is frozen (handleNceExpansionStateUpdate
                  guards against updates while locked), so no loop occurs. */}
              <NCENotesTab
                engagementId={engagementId}
                navigateToNote={nceNavNote}
                dynamicNoteMap={nceDynamicNoteMap}
                onExpansionStateUpdate={handleNceExpansionStateUpdate}
                readOnly={nceIsLocked}
                entityName={engagement?.clients?.name || ""}
                cyYear={cyYear}
                initialExpandedRows={nceIsLocked ? nceExpandedRows : undefined}
              />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Manual Override LIST dialog — opens when user clicks the count card.
           Lists every applied override (amount + note-no + cell edits).
           Amount overrides are CLICKABLE rows (navigate to the corresponding
           BS/P&L tab and re-open the per-line edit dialog) and have a
           "↺ Back to auto" reset button per row. */}
      <Dialog open={manualOverrideListOpen} onOpenChange={setManualOverrideListOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">All Manual Overrides</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {Object.keys(manualOverrides).length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">
                  Amount overrides ({Object.keys(manualOverrides).length}) — click a row to edit, ↺ to reset
                </p>
                <div className="space-y-1">
                  {Object.entries(manualOverrides).map(([code, ov]) => {
                    const isPL = code.startsWith("PL_");
                    return (
                      <div
                        key={code}
                        className="flex items-center justify-between gap-3 rounded border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 hover:bg-amber-100 dark:hover:bg-amber-950/40 cursor-pointer"
                        onClick={() => {
                          setManualOverrideListOpen(false);
                          setActiveTab(isPL ? "pl" : "bs");
                          openOverride(code, code);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                            {code} <span className="text-muted-foreground">({isPL ? "P&L" : "Balance Sheet"})</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            ₹{Number(ov.amount).toLocaleString("en-IN")} — {ov.reason || "no reason"}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[10px] text-amber-700 hover:bg-amber-200/60"
                          onClick={(e) => {
                            e.stopPropagation();
                            setManualOverrides(prev => {
                              const next = { ...prev };
                              delete next[code];
                              return next;
                            });
                            toast.success(`Override on ${code} reset — back to auto`);
                          }}
                        >
                          ↺ Back to auto
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {Object.values(noteOverrides).filter(v => v != null && Number.isFinite(v as number)).length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">
                  Note-number overrides ({Object.values(noteOverrides).filter(v => v != null && Number.isFinite(v as number)).length}) — ↺ to reset
                </p>
                <div className="space-y-1">
                  {Object.entries(noteOverrides)
                    .filter(([, v]) => v != null && Number.isFinite(v as number))
                    .map(([code, v]) => (
                      <div key={code} className="flex items-center justify-between gap-3 rounded border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-400">{code}</div>
                          <div className="text-[10px] text-muted-foreground">Note No. → {v}</div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[10px] text-amber-700 hover:bg-amber-200/60"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (typeof updateNoteOverride === "function") {
                              try { updateNoteOverride(code, null); } catch { /* ignore */ }
                            }
                            toast.success(`Note-no override on ${code} reset`);
                          }}
                        >
                          ↺ Back to auto
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            )}
            {Array.isArray(stage5NotesData?.manual_edits) && (stage5NotesData!.manual_edits?.length ?? 0) > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">
                  Note cell edits ({stage5NotesData!.manual_edits!.length}) — click a row to jump to the note, ↺ to reset
                </p>
                <div className="space-y-1">
                  {stage5NotesData!.manual_edits!.map((p, i) => {
                    // Derive sub-tab from the leading segment of the dot-path
                    const subTab: "bs_liab" | "bs_asset" | "pl" | "fa" =
                      p.startsWith("bs_liab.") ? "bs_liab"
                        : p.startsWith("bs_asset.") ? "bs_asset"
                        : p.startsWith("pl.") ? "pl"
                        : "fa";
                    return (
                      <div
                        key={`${p}-${i}`}
                        className="flex items-center justify-between gap-3 rounded border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 hover:bg-amber-100 dark:hover:bg-amber-950/40 cursor-pointer"
                        onClick={() => {
                          setManualOverrideListOpen(false);
                          setActiveTab("notes");
                          // Defer so the Notes tab can render before we dispatch
                          // the sub-tab navigation event the NotesTab listens to.
                          setTimeout(() => {
                            try {
                              window.dispatchEvent(new CustomEvent("caflow:notes-navigate", { detail: { subTab, path: p } }));
                            } catch { /* ignore */ }
                          }, 50);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-400 break-all">{p}</div>
                          <div className="text-[10px] text-muted-foreground">Section: {subTab.toUpperCase()}</div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[10px] text-amber-700 hover:bg-amber-200/60 shrink-0"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const current = (stage5NotesData ?? { manual_edits: [] }) as any;
                              const nextEdits: string[] = (Array.isArray(current.manual_edits) ? current.manual_edits : []).filter((x: string) => x !== p);
                              const nextNotes = { ...current, manual_edits: nextEdits };
                              const { error } = await (supabase.from as any)("audit_engagements")
                                .update({ stage5_notes: nextNotes })
                                .eq("id", engagementId);
                              if (error) throw error;
                              queryClient.invalidateQueries({ queryKey: ["stage5-notes-fsdata", engagementId] });
                              queryClient.invalidateQueries({ queryKey: ["engagement", engagementId] });
                              toast.success(`Note edit on "${p}" reset — will revert to auto on next Generate FS`);
                            } catch (err) {
                              toast.error(`Failed to reset: ${(err as Error).message}`);
                            }
                          }}
                        >
                          ↺ Back to auto
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* NCE Notes-to-Accounts manual custom rows.
                cy_data._custom_rows is the source of truth — a single array
                per note, mirrored to the per-note "N manual" badge in Stage 8.
                Reverting deletes the row (manual rows have no auto counterpart
                — "back to auto" means removing the auditor's addition). */}
            {isNonCorporate && Array.isArray(nceNotesData) && (() => {
              const rows: Array<{ noteType: string; row: any }> = [];
              for (const n of nceNotesData as any[]) {
                const customRows = Array.isArray(n?.cy_data?._custom_rows)
                  ? n.cy_data._custom_rows
                  : [];
                for (const r of customRows) {
                  if (r?.source === "manual") rows.push({ noteType: n.note_type, row: r });
                }
              }
              if (rows.length === 0) return null;
              return (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">
                    Notes-to-Accounts manual rows ({rows.length}) — ↺ to remove (back to auto)
                  </p>
                  <div className="space-y-1">
                    {rows.map(({ noteType, row }) => (
                      <div
                        key={`${noteType}-${row.id}`}
                        className="flex items-center justify-between gap-3 rounded border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 hover:bg-amber-100 dark:hover:bg-amber-950/40 cursor-pointer"
                        onClick={() => {
                          setManualOverrideListOpen(false);
                          setActiveTab("notes");
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-400 truncate">
                            {noteType} — {row.label || row.ejectedSource || "(unnamed row)"}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            row id: {row.id}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[10px] text-amber-700 hover:bg-amber-200/60 shrink-0"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const fy = engagement?.financial_year;
                              if (!fy) throw new Error("financial year unavailable");
                              const { data: existing } = await (supabase.from as any)("nce_financial_notes")
                                .select("cy_data, py_data")
                                .eq("engagement_id", engagementId)
                                .eq("financial_year", fy)
                                .eq("note_type", noteType)
                                .maybeSingle();
                              const cy = (existing?.cy_data ?? {}) as Record<string, any>;
                              const py = (existing?.py_data ?? {}) as Record<string, any>;
                              const oldRows: any[] = Array.isArray(cy._custom_rows) ? cy._custom_rows : [];
                              const nextRows = oldRows.filter(x => x?.id !== row.id);
                              // Strip the row's per-key amounts so its CY/PY
                              // contribution disappears from totals (manual
                              // custom rows store amounts under id-based keys
                              // alongside _custom_rows in cy_data / py_data).
                              const nextCy: Record<string, any> = { ...cy, _custom_rows: nextRows };
                              const nextPy: Record<string, any> = { ...py };
                              for (const k of Object.keys(nextCy)) {
                                if (k.startsWith(String(row.id))) delete nextCy[k];
                              }
                              for (const k of Object.keys(nextPy)) {
                                if (k.startsWith(String(row.id))) delete nextPy[k];
                              }
                              const { error } = await (supabase.from as any)("nce_financial_notes")
                                .update({ cy_data: nextCy, py_data: nextPy })
                                .eq("engagement_id", engagementId)
                                .eq("financial_year", fy)
                                .eq("note_type", noteType);
                              if (error) throw error;
                              queryClient.invalidateQueries({ queryKey: ["nce-financial-notes", engagementId, fy] });
                              toast.success(`Removed manual row "${row.label || row.id}" from ${noteType}`);
                            } catch (err) {
                              toast.error(`Failed to revert: ${(err as Error).message}`);
                            }
                          }}
                        >
                          ↺ Back to auto
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setManualOverrideListOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
      {/* Corp Word Export — Font Picker */}
      {/* ── NCE Word Export — font picker dialog (Task 1) ─────────────────── */}
      <Dialog open={showNCEFontDialog} onOpenChange={setShowNCEFontDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Export Financial Statements</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Select font for the Word document:</p>
            <div className="grid grid-cols-1 gap-2">
              {(["Arial", "Calibri", "Cambria", "Times New Roman", "Garamond", "Georgia"] as const).map(f => (
                <label key={f} className="flex items-center gap-2 cursor-pointer rounded border px-3 py-2 hover:bg-muted/50" style={{ fontFamily: f }}>
                  <input
                    type="radio"
                    name="nceFont"
                    value={f}
                    checked={nceExportFont === f}
                    onChange={() => setNceExportFont(f)}
                    className="accent-primary"
                  />
                  <span className="text-sm font-medium">{f}</span>
                  <span className="ml-auto text-xs text-muted-foreground" style={{ fontFamily: f }}>Aa Bb 1 2 3</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowNCEFontDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={() => {
              setShowNCEFontDialog(false);
              void generateNCEFinancialsDocx({
                engagement,
                nceCyAmounts,
                ncePyAmounts,
                cyYear,
                pyYear,
                dynamicNoteMap: nceDynamicNoteMap,
                capitalData: nceCapitalData ?? [],
                notesData:   nceNotesData   ?? [],
                ppeData:     ncePpeData      ?? [],
                ntaData:     notesToAccountsData ?? null,
                font:        nceExportFont,
                constitution: entityType,
                expandedRows:      nceIsLocked ? nceExpandedRows : undefined,
                hideBlankNoteRows: nceIsLocked,
                signature: {
                  firmName:      sigFirmName,
                  firmFRN:       sigFirmFRN,
                  partnerName:   sigPartnerName,
                  membershipNo:  sigMembershipNo,
                  clientName:    sigClientName,
                  signatoryName: sigSignatoryName,
                  constitution:  entityType,
                  place:         sigPlace,
                  date:          sigDate,
                  udin:          (engagement as any)?.udin ?? "",
                },
              });
            }}>
              Export Word
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NCE Tasks 1+2+6: Lock Preview — resized to 78vw/1200px max, paper-style A4 container */}
      <Dialog open={ncePreviewOpen} onOpenChange={setNcePreviewOpen}>
        <DialogContent className="w-[78vw] max-w-[1200px] max-h-[88vh] p-0 flex flex-col gap-0 overflow-hidden">
          {/* Sticky toolbar */}
          <DialogHeader className="px-4 py-2.5 border-b flex-none bg-background/95 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-sm">
                🔒 Draft Financial Statements — Preview
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setNcePreviewOpen(false)}>
                  Close
                </Button>
                <Button size="sm" onClick={() => { setNcePreviewOpen(false); setShowNCEFontDialog(true); }}>
                  <FileText size={13} className="mr-1" /> Export Word
                </Button>
              </div>
            </div>
          </DialogHeader>
          {/* Scrollable content area — matches the DOCX export exactly:
              BS → P&L → Notes flow continuously in one scrollable view,
              not in separate tabs. Each section has a visible page break
              (border + spacing) to mimic the print layout. The tab bar is
              kept for quick-jump navigation but all three sections render
              simultaneously below it. */}
          <div className="flex-1 overflow-y-auto bg-muted/30">
            {/* Quick-jump nav — scrolls to the section instead of hiding others */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-4 pt-2 pb-0">
              <div className="flex gap-1 pb-2">
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => document.getElementById("preview-bs")?.scrollIntoView({ behavior: "smooth" })}>
                  Balance Sheet
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => document.getElementById("preview-pl")?.scrollIntoView({ behavior: "smooth" })}>
                  Profit &amp; Loss
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => document.getElementById("preview-notes")?.scrollIntoView({ behavior: "smooth" })}>
                  Notes to Accounts
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
              {/* ── Balance Sheet ─────────────────────────────── */}
              <div id="preview-bs" className="mx-auto bg-card shadow-md border border-border rounded-lg overflow-hidden"
                   style={{ maxWidth: "794px", width: "100%", minHeight: "900px", padding: "28px 32px" }}>
                <NCEBalanceSheetView
                  engagementId={engagementId}
                  cyAmounts={nceCyAmounts}
                  pyAmounts={ncePyAmounts}
                  cyYear={cyYear}
                  pyYear={pyYear}
                  entityName={engagement?.clients?.name || ""}
                  pyLocked={pyLocked}
                  nceDynamicNoteMap={nceDynamicNoteMap}
                />
              </div>
              {/* ── Profit & Loss ─────────────────────────────── */}
              <div id="preview-pl" className="mx-auto bg-card shadow-md border border-border rounded-lg overflow-hidden"
                   style={{ maxWidth: "794px", width: "100%", minHeight: "900px", padding: "28px 32px" }}>
                <NCEPLView
                  engagementId={engagementId}
                  cyAmounts={nceCyAmounts}
                  pyAmounts={ncePyAmounts}
                  cyYear={cyYear}
                  pyYear={pyYear}
                  entityName={engagement?.clients?.name || ""}
                  pyLocked={pyLocked}
                  nceDynamicNoteMap={nceDynamicNoteMap}
                />
              </div>
              {/* ── Notes to Accounts ────────────────────────── */}
              <div id="preview-notes" className="mx-auto bg-card shadow-md border border-border rounded-lg overflow-hidden"
                   style={{ maxWidth: "794px", width: "100%", minHeight: "600px", padding: "28px 32px" }}>
                <NCENotesTab
                  engagementId={engagementId}
                  dynamicNoteMap={nceDynamicNoteMap}
                  readOnly={true}
                  entityName={engagement?.clients?.name || ""}
                  cyYear={cyYear}
                  initialExpandedRows={nceExpandedRows}
                  ntaData={notesToAccountsData ?? null}
                  sig={{
                    firmName:     sigFirmName,
                    firmFRN:      sigFirmFRN,
                    partnerName:  sigPartnerName,
                    membershipNo: sigMembershipNo,
                    clientName:   sigClientName,
                    place:        sigPlace,
                    date:         sigDate,
                  }}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Corporate Lock Preview — mirrors NCE preview. Shows BS → P&L → CF →
          Notes as a single scrollable A4-style paper view, matching the DOCX
          export. */}
      <Dialog open={corpPreviewOpen} onOpenChange={setCorpPreviewOpen}>
        <DialogContent className="w-[78vw] max-w-[1200px] max-h-[88vh] p-0 flex flex-col gap-0 overflow-hidden">
          <DialogHeader className="px-4 py-2.5 border-b flex-none bg-background/95 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-sm">
                🔒 Draft Financial Statements — Preview
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setCorpPreviewOpen(false)}>
                  Close
                </Button>
                <Button
                  size="sm"
                  disabled={corpHasSevereDrift}
                  onClick={() => { setCorpPreviewOpen(false); setShowCorpFontDialog(true); }}
                >
                  <FileText size={13} className="mr-1" /> Export Word
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto bg-muted/30">
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-4 pt-2 pb-0">
              <div className="flex gap-1 pb-2">
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => document.getElementById("corp-preview-bs")?.scrollIntoView({ behavior: "smooth" })}>
                  Balance Sheet
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => document.getElementById("corp-preview-pl")?.scrollIntoView({ behavior: "smooth" })}>
                  Profit &amp; Loss
                </Button>
                {cfApplicable && (
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => document.getElementById("corp-preview-cf")?.scrollIntoView({ behavior: "smooth" })}>
                    Cash Flow
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => document.getElementById("corp-preview-notes")?.scrollIntoView({ behavior: "smooth" })}>
                  Notes
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
              {/* Balance Sheet */}
              <div id="corp-preview-bs" className="mx-auto bg-card shadow-md border border-border rounded-lg overflow-hidden"
                   style={{ maxWidth: "794px", width: "100%", minHeight: "900px", padding: "28px 32px" }}>
                {fsDisplayData.bs ? (
                  <>
                    <CorporateBalanceSheetView
                      engagementId={engagementId}
                      bs={fsDisplayData.bs}
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
                  <p className="text-xs text-muted-foreground italic">Balance Sheet data not available — trial balance not loaded.</p>
                )}
              </div>
              {/* Profit & Loss */}
              <div id="corp-preview-pl" className="mx-auto bg-card shadow-md border border-border rounded-lg overflow-hidden"
                   style={{ maxWidth: "794px", width: "100%", minHeight: "900px", padding: "28px 32px" }}>
                {fsDisplayData.pl ? (
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
                  <p className="text-xs text-muted-foreground italic">P&amp;L data not available — trial balance not loaded.</p>
                )}
              </div>
              {/* Cash Flow (corporate only, when applicable) */}
              {cfApplicable && fsDisplayData.bs && fsDisplayData.pl && fsDisplayData.cfs && (
                <div id="corp-preview-cf" className="mx-auto bg-card shadow-md border border-border rounded-lg overflow-hidden"
                     style={{ maxWidth: "794px", width: "100%", minHeight: "900px", padding: "28px 32px" }}>
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
                </div>
              )}
              {/* Notes to Accounts */}
              <div id="corp-preview-notes" className="mx-auto bg-card shadow-md border border-border rounded-lg overflow-hidden"
                   style={{ maxWidth: "794px", width: "100%", minHeight: "600px", padding: "28px 32px" }}>
                <NotesTab
                  engagementId={engagementId}
                  cyYear={cyYear}
                  pyYear={pyYear}
                  companyName={engagement?.clients?.name || ""}
                  readOnly={true}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCorpFontDialog} onOpenChange={setShowCorpFontDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Export Financial Statements</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Select font for the Word document:</p>
            <div className="grid grid-cols-1 gap-2">
              {(["Arial", "Calibri", "Cambria", "Times New Roman", "Garamond", "Georgia"] as const).map(f => (
                <label key={f} className="flex items-center gap-2 cursor-pointer rounded border px-3 py-2 hover:bg-muted/50" style={{ fontFamily: f }}>
                  <input
                    type="radio"
                    name="corpFont"
                    value={f}
                    checked={corpExportFont === f}
                    onChange={() => setCorpExportFont(f)}
                    className="accent-primary"
                  />
                  <span className="text-sm font-medium">{f}</span>
                  <span className="ml-auto text-xs text-muted-foreground" style={{ fontFamily: f }}>Aa Bb 1 2 3</span>
                </label>
              ))}
            </div>
            {/* Issue 2 — sub-group expand/collapse control */}
            <label className="flex items-start gap-2 cursor-pointer rounded border px-3 py-2 hover:bg-muted/50">
              <input
                type="checkbox"
                checked={corpExpandSubGroups}
                onChange={(e) => setCorpExpandSubGroups(e.target.checked)}
                className="accent-primary mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">Expand sub-groups</span>
                <span className="block text-[11px] text-muted-foreground">
                  When off (default), notes with sub-groups show only the sub-group name &amp; total.
                  Turn on to list every individual ledger under each sub-group.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowCorpFontDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { setShowCorpFontDialog(false); void handleCorpWordExport(); }}>
              Export Word
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </FsUnitsProvider>
  );
}
