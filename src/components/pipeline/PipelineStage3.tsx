import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import EngagementHeader from "@/components/pipeline/EngagementHeader";
import {
  ArrowRight, CheckCircle2, AlertTriangle, Search, Download, FileSpreadsheet,
  Link2, RefreshCw, Eye, Pencil, ChevronRight, ChevronDown, Loader2, Trash2,
  BookOpen, Brain, Check, ChevronsUpDown, Maximize2, Minimize2,
} from "lucide-react";
import { NCE_FS_ITEMS, NCE_AUTO_MAP_RULES } from "@/config/nceLineItems";
import type { FSLineItem } from "@/config/nceLineItems";
import { MappingRulesPanel, type MappingRule } from "@/components/pipeline/MappingRulesPanel";
import { currentYearProfitAlreadyInReserves } from "@/lib/tallyDetection";
import { useAiSkills } from "@/hooks/useAiSkills";
// 2026-06-05 Phase 1 (FS Re-Architecture): every TB sign-derivation goes
// through the shared module so the BS / P&L / Notes triangle stays
// reconciled. Stage 3's debit-positive normalisation is the same rule
// applied with nature = "DR" — see fsSignConvention.signedBalance.
import { signedBalance, signedOpening } from "@/lib/fsSignConvention";
import { cleanTallyName } from "@/lib/tallyText";

// ═══════════════════════════════════════
// Non-Corporate entity detection
// ═══════════════════════════════════════
const NON_CORPORATE = [
  "Partnership", "LLP", "Limited Liability Partnership",
  "Firm",                                     // ← added: entity_type exactly "Firm"
  "Proprietorship", "Sole Proprietorship",
  "HUF", "Hindu Undivided Family",
  "Trust",
  "AOP", "Association of Persons",
  "BOI", "Body of Individuals",
  "Individual",
];

// ── Inventory dual-posting map ────────────────────────────────────────────────
// Maps each BS inventory code → its P&L "Changes in Inventories" code.
// Ledgers mapped to any key are dual-posted:
//   BS: accumulate closing balance under the BS code
//   P&L: accumulate (opening − closing) under the mapped PL code
// Both corporate (Schedule III) and NCE (Partnership/LLP) are covered.
const INV_DUAL_MAP: Record<string, string> = {
  "INV_STOCK": "PL_EXP_CII",  // Corporate — generic stock
  "INV_RM":    "PL_EXP_CII",  // Corporate — raw materials
  "INV_WIP":   "PL_EXP_CII",  // Corporate — work-in-progress
  "INV_FG":    "PL_EXP_CII",  // Corporate — finished goods
  "INV_STT":   "PL_EXP_CII",  // Corporate — stock-in-trade
  "NCE_STCK":  "NCE_CII",     // NCE / Partnership — inventories
};
const INV_CODES_SET = new Set(Object.keys(INV_DUAL_MAP));
// P&L codes that are auto-computed from inventory dual-posting — locked from manual override
const INV_PL_CODES  = new Set(Object.values(INV_DUAL_MAP));

// Detects Tally's special "Profit & Loss A/c" ledger by any of its common names.
// In Tally, this ledger carries the CLOSING retained-earnings balance (opening +
// current-year profit).  When mapped to a BS code it must use opening_balance only;
// the current-year net profit is auto-credited to BS_EQ_RS separately.
const isTallyPLAccount = (name: string): boolean => {
  const n = name.toLowerCase().trim();
  if (n === "profit & loss a/c" || n === "profit and loss a/c" ||
      n === "p & l a/c"         || n === "p&l a/c"             ||
      n === "profit & loss account" || n === "profit and loss account" ||
      n === "p & l account") return true;
  return /^profit\s*[&and]+\s*loss(\s*(a\/c|account))?$/i.test(name.trim());
};

// ═══════════════════════════════════════
// Schedule III Line Item Definitions  (corporate)
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
    { code: "BS_CA_INV", name: "Inventories", noteRef: 20, section: "BS_assets", children: [
      { code: "INV_RM",    name: "Raw Materials",             noteRef: 20, section: "BS_assets", scheduleRef: "BS+P&L" },
      { code: "INV_WIP",   name: "Work-in-Progress",          noteRef: 20, section: "BS_assets", scheduleRef: "BS+P&L" },
      { code: "INV_FG",    name: "Finished Goods",            noteRef: 20, section: "BS_assets", scheduleRef: "BS+P&L" },
      { code: "INV_STT",   name: "Stock-in-Trade",            noteRef: 20, section: "BS_assets", scheduleRef: "BS+P&L" },
      { code: "INV_STOCK", name: "Stock / Other Inventories", noteRef: 20, section: "BS_assets", scheduleRef: "BS+P&L" },
    ]},
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
  { code: "PL_EI", name: "Exceptional Items", noteRef: null, section: "PL_expenses" },
  { code: "PL_TAX", name: "Tax Expense", noteRef: null, section: "PL_expenses", children: [
    { code: "PL_TAX_CUR", name: "Current Tax", noteRef: null, section: "PL_expenses" },
    { code: "PL_TAX_DEF", name: "Deferred Tax", noteRef: null, section: "PL_expenses" },
  ]},
  { code: "PL_PAT", name: "Profit/(Loss) After Tax", noteRef: null, section: "PL_expenses" },
  { code: "PL_EPS_B", name: "EPS — Basic (₹)", noteRef: null, section: "PL_expenses" },
  { code: "PL_EPS_D", name: "EPS — Diluted (₹)", noteRef: null, section: "PL_expenses" },
];

// ── Auto-mapping keywords ──
const AUTO_MAP_RULES: { keywords: string[]; code: string; confidence: "high" | "medium" | "low" }[] = [
  { keywords: ["cash", "bank", "cash in hand", "cash at bank", "cash and bank"], code: "BS_CA_CCE", confidence: "high" },
  { keywords: ["sundry debtor", "trade receivable", "accounts receivable", "debtors"], code: "BS_CA_TR", confidence: "high" },
  { keywords: ["sundry creditor", "trade payable", "accounts payable", "creditors"], code: "BS_CL_TP", confidence: "high" },
  { keywords: ["raw material", "raw materials consumed"], code: "INV_RM",    confidence: "high" },
  { keywords: ["work in progress", "work-in-progress", "wip"], code: "INV_WIP",  confidence: "high" },
  { keywords: ["finished goods", "finished stock"],             code: "INV_FG",   confidence: "high" },
  { keywords: ["stock in trade", "stock-in-trade", "trading stock"], code: "INV_STT", confidence: "high" },
  { keywords: ["inventory", "stock", "closing stock", "opening stock"], code: "INV_STOCK", confidence: "high" },
  { keywords: ["share capital", "equity capital", "authorised capital", "paid up capital"], code: "BS_EQ_SC", confidence: "high" },
  { keywords: ["reserve", "surplus", "retained earning", "general reserve", "profit and loss", "profit & loss", "p&l", "p & l"], code: "BS_EQ_RS", confidence: "high" },
  { keywords: ["secured loan", "term loan", "long term borrowing", "long-term loan"], code: "BS_NCL_LTB", confidence: "high" },
  { keywords: ["unsecured loan", "short term borrowing", "cash credit", "overdraft", "od", "cc limit"], code: "BS_CL_STB", confidence: "high" },
  { keywords: ["fixed asset", "plant", "machinery", "furniture", "vehicle", "computer", "building", "land"], code: "BS_NCA_FA_TAN", confidence: "medium" },
  { keywords: ["goodwill", "software", "patent", "trademark", "intangible"], code: "BS_NCA_FA_INT", confidence: "medium" },
  { keywords: ["capital work in progress", "cwip"], code: "BS_NCA_FA_WIP", confidence: "high" },
  { keywords: ["investment", "mutual fund", "shares", "debenture"], code: "BS_NCA_INV", confidence: "medium" },
  { keywords: ["deferred tax asset", "dta", "mat credit"], code: "BS_NCA_DTA", confidence: "medium" },
  { keywords: ["deferred tax liability", "dtl"], code: "BS_NCL_DTL", confidence: "medium" },
  { keywords: ["advance", "prepaid", "deposit", "tds receivable", "advance tax"], code: "BS_CA_SLA", confidence: "medium" },
  { keywords: ["provision for tax", "provision for gratuity", "provision"], code: "BS_CL_STP", confidence: "low" },
  { keywords: ["statutory dues", "gst payable", "tds payable", "pf payable", "esi payable"], code: "BS_CL_OCL", confidence: "medium" },
  // P&L
  { keywords: ["sale", "revenue", "income from operation", "turnover"], code: "PL_REV_OPS", confidence: "high" },
  { keywords: ["other income", "interest received", "dividend received", "miscellaneous income", "rent received"], code: "PL_REV_OI", confidence: "medium" },
  { keywords: ["purchase", "cost of material", "raw material consumed"], code: "PL_EXP_MAT", confidence: "high" },
  { keywords: ["salary", "wage", "staff", "employee", "bonus", "gratuity", "pf contribution", "esi contribution"], code: "PL_EXP_EMP", confidence: "high" },
  { keywords: ["interest paid", "bank charge", "finance cost", "bank interest", "interest on loan"], code: "PL_EXP_FIN", confidence: "high" },
  { keywords: ["depreciation", "amortisation", "amortization"], code: "PL_EXP_DEP", confidence: "high" },
  { keywords: ["rent", "repair", "maintenance", "electricity", "telephone", "travelling", "conveyance", "printing", "stationery", "advertisement", "legal", "professional", "audit fee", "insurance", "misc expense", "office expense", "other expense"], code: "PL_EXP_OTH", confidence: "low" },
  { keywords: ["income tax", "current tax"], code: "PL_TAX_CUR", confidence: "high" },
];

// ═══════════════════════════════════════
// Flatten FS tree for lookups
// ═══════════════════════════════════════
function flattenTree(items: FSLineItem[], depth = 0): (FSLineItem & { depth: number })[] {
  const result: (FSLineItem & { depth: number })[] = [];
  for (const item of items) {
    if (item.showTotalLast && item.children?.length) {
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
const LEAF_ITEMS = FLAT_ITEMS.filter(i => !i.children || i.children.length === 0);

// ═══════════════════════════════════════
// Parent-group → FS code map
// Tally's native group taxonomy carries almost all the classification signal
// we need. A ledger inside "Sundry Debtors" is a trade receivable 99% of the
// time — regardless of what the ledger itself is called. This mapping runs
// BEFORE keyword rules and is given a higher confidence weight.
// Normalised to lower-case; match by full-string OR contains.
// ═══════════════════════════════════════
const PARENT_GROUP_MAP_CORP: { match: string[]; code: string; confidence: "high" | "medium" | "low" }[] = [
  { match: ["sundry debtors", "trade receivable", "debtors", "accounts receivable"], code: "BS_CA_TR",       confidence: "high" },
  { match: ["sundry creditors", "trade payable", "creditors for goods", "creditors for expenses", "accounts payable"], code: "BS_CL_TP", confidence: "high" },
  { match: ["bank accounts", "bank od", "cash-in-hand", "cash in hand"], code: "BS_CA_CCE",                  confidence: "high" },
  { match: ["stock-in-hand", "stock in hand", "stock in trade", "inventory"], code: "INV_STOCK",            confidence: "high" },
  { match: ["fixed assets"],                                                  code: "BS_NCA_FA_TAN",        confidence: "medium" },
  { match: ["investments"],                                                   code: "BS_NCA_INV",           confidence: "medium" },
  { match: ["loans & advances (asset)", "loans and advances (asset)", "loans (asset)"], code: "BS_CA_SLA",  confidence: "medium" },
  { match: ["deposits (asset)"],                                              code: "BS_NCA_LLA",           confidence: "medium" },
  { match: ["misc. expenses (asset)", "miscellaneous expenses (asset)"],     code: "BS_NCA_ONA",           confidence: "low" },
  { match: ["current assets"],                                                code: "BS_CA_OCA",            confidence: "low" },
  { match: ["current liabilities"],                                           code: "BS_CL_OCL",            confidence: "low" },
  { match: ["duties & taxes", "duties and taxes"],                            code: "BS_CL_OCL",            confidence: "high" },
  { match: ["provisions"],                                                    code: "BS_CL_STP",            confidence: "medium" },
  { match: ["secured loans"],                                                 code: "BS_NCL_LTB",           confidence: "high" },
  { match: ["unsecured loans"],                                               code: "BS_CL_STB",            confidence: "high" },
  { match: ["bank od a/c", "bank occ a/c"],                                   code: "BS_CL_STB",            confidence: "high" },
  { match: ["loans (liability)"],                                             code: "BS_NCL_LTB",           confidence: "medium" },
  { match: ["capital account"],                                               code: "BS_EQ_RS",             confidence: "medium" },
  { match: ["reserves & surplus", "reserves and surplus"],                   code: "BS_EQ_RS",             confidence: "high" },
  { match: ["share capital", "capital"],                                      code: "BS_EQ_SC",             confidence: "high" },
  { match: ["branch / divisions"],                                            code: "BS_CA_OCA",            confidence: "low" },
  { match: ["suspense a/c"],                                                  code: "BS_CA_OCA",            confidence: "low" },
  // P&L
  { match: ["sales accounts", "direct incomes"],                              code: "PL_REV_OPS",           confidence: "high" },
  { match: ["indirect incomes"],                                              code: "PL_REV_OI",            confidence: "high" },
  { match: ["purchase accounts"],                                             code: "PL_EXP_MAT",           confidence: "high" },
  { match: ["direct expenses"],                                               code: "PL_EXP_MAT",           confidence: "medium" },
  { match: ["indirect expenses"],                                             code: "PL_EXP_OTH",           confidence: "medium" },
];

const PARENT_GROUP_MAP_NCE: { match: string[]; code: string; confidence: "high" | "medium" | "low" }[] = [
  { match: ["sundry debtors", "trade receivable", "debtors", "accounts receivable"], code: "NCE_TR",         confidence: "high" },
  { match: ["sundry creditors", "trade payable", "creditors for goods", "creditors for expenses", "accounts payable"], code: "NCE_TP", confidence: "high" },
  { match: ["bank accounts", "cash-in-hand", "cash in hand"],                 code: "NCE_CASH",             confidence: "high" },
  { match: ["stock-in-hand", "stock in hand", "stock in trade", "inventory"], code: "NCE_STCK",             confidence: "high" },
  { match: ["fixed assets"],                                                  code: "NCE_PPE",              confidence: "medium" },
  { match: ["investments"],                                                   code: "NCE_NCINV",            confidence: "medium" },
  { match: ["loans & advances (asset)", "loans and advances (asset)", "loans (asset)"], code: "NCE_STLA",   confidence: "medium" },
  { match: ["deposits (asset)"],                                              code: "NCE_LTLA",             confidence: "medium" },
  { match: ["misc. expenses (asset)", "miscellaneous expenses (asset)"],      code: "NCE_ONCA",             confidence: "low" },
  { match: ["current assets"],                                                code: "NCE_OCA",              confidence: "low" },
  { match: ["current liabilities"],                                           code: "NCE_OCL",              confidence: "low" },
  { match: ["duties & taxes", "duties and taxes"],                            code: "NCE_OCL",              confidence: "high" },
  { match: ["provisions"],                                                    code: "NCE_STP",              confidence: "medium" },
  { match: ["secured loans"],                                                 code: "NCE_LTB",              confidence: "high" },
  { match: ["unsecured loans"],                                               code: "NCE_STB",              confidence: "high" },
  { match: ["bank od a/c", "bank occ a/c"],                                   code: "NCE_STB",              confidence: "high" },
  { match: ["loans (liability)"],                                             code: "NCE_LTB",              confidence: "medium" },
  { match: ["capital account"],                                               code: "NCE_CAP",              confidence: "high" },
  { match: ["reserves & surplus", "reserves and surplus"],                    code: "NCE_CAP",              confidence: "high" },
  { match: ["branch / divisions"],                                            code: "NCE_OCA",              confidence: "low" },
  { match: ["suspense a/c"],                                                  code: "NCE_OCA",              confidence: "low" },
  // P&L
  { match: ["sales accounts", "direct incomes"],                              code: "NCE_REV_OPS",          confidence: "high" },
  { match: ["indirect incomes"],                                              code: "NCE_REV_OTH",          confidence: "high" },
  { match: ["purchase accounts"],                                             code: "NCE_COGS",             confidence: "high" },
  { match: ["direct expenses"],                                               code: "NCE_COGS",             confidence: "medium" },
  { match: ["indirect expenses"],                                             code: "NCE_OTH_EXP",          confidence: "medium" },
];

function matchParentGroup(
  parentGroup: string,
  table: { match: string[]; code: string; confidence: "high" | "medium" | "low" }[],
) {
  const g = cleanTallyName(parentGroup).toLowerCase();
  if (!g) return null;
  for (const row of table) {
    for (const token of row.match) {
      if (g === token || g.includes(token)) return { code: row.code, confidence: row.confidence };
    }
  }
  return null;
}

// NCE variants — computed once at module level from the shared config
const NCE_FLAT_ITEMS = flattenTree(NCE_FS_ITEMS);
// Exclude isDivider items (pure section labels with no mappable amounts)
const NCE_LEAF_ITEMS = NCE_FLAT_ITEMS.filter(i => !i.isDivider && (!i.children || i.children.length === 0));

// ═══════════════════════════════════════
// Props
// ═══════════════════════════════════════
interface PipelineStage3Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
export default function PipelineStage3({ engagementId, engagement, onStageComplete, onSaveDraft }: PipelineStage3Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { examplesFor, recordUsed } = useAiSkills();
  const [search, setSearch] = useState("");
  const [fsSearch, setFsSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // ─── Entity type detection ───
  // Check both engagement-level and client-level entity_type for safety.
  const entityType: string = (engagement?.entity_type || engagement?.clients?.entity_type || "").trim();
  const isNonCorporate: boolean = NON_CORPORATE.includes(entityType);

  // Active line-item set — swap for NCE entities; corporate path is 100% untouched.
  const activeTree      = isNonCorporate ? NCE_FS_ITEMS   : SCHEDULE_III_DIV_I;
  const activeFlatItems = isNonCorporate ? NCE_FLAT_ITEMS  : FLAT_ITEMS;
  const activeLeafItems = isNonCorporate ? NCE_LEAF_ITEMS  : LEAF_ITEMS;
  // NCE rules first (higher specificity for capital/remuneration keywords),
  // then fall back to the general keyword list which covers all common items.
  const activeAutoRules = isNonCorporate
    ? [...NCE_AUTO_MAP_RULES, ...AUTO_MAP_RULES]
    : AUTO_MAP_RULES;

  // ─── Ledger Reclassify / Move state ───
  const [reclassifyDialog, setReclassifyDialog] = useState<{ accountName: string } | null>(null);
  const [reclassifyCode,   setReclassifyCode]   = useState<string>("");
  const [reclassifyPopoverOpen, setReclassifyPopoverOpen] = useState(false);
  const [reclassifyReason, setReclassifyReason] = useState<string>("");

  // ─── Variance drill-down state (Task 4) ───
  const [varianceDrill, setVarianceDrill] = useState<{ code: string; name: string } | null>(null);

  // ─── Ledger alias state (Task 3) ───
  // Maps PRIOR-year ledger name → CURRENT-year ledger name for this client.
  // Surfaced in Stage 6 so renamed/reorganised ledgers correctly combine PY opening
  // with CY closing under the same FS line item.
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [aliasDialog, setAliasDialog] = useState<{ priorName: string } | null>(null);

  // ─── COA Mapping state ───
  // mapping: { [accountName]: { code, noteRef, scheduleRef, confidence } }
  const [coaMapping, setCoaMapping] = useState<Record<string, {
    code: string; noteRef: number | null; scheduleRef: string; confidence: string;
  }>>({});
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  // Issue 1 (today) — Multi-select bulk-assign.  Holds ledger names the user
  // has ticked via the row checkbox.  When non-empty, clicking an FS line
  // item maps EVERY ticked ledger to that code in a single transaction
  // instead of forcing the user to map each one individually.
  const [multiSelect, setMultiSelect] = useState<Set<string>>(() => new Set());
  // ─── Right panel tab (Balance Sheet vs P&L) ───
  const [fsPanelTab, setFsPanelTab] = useState<"bs" | "pl">("bs");
  // Filtered items for the right-panel tree — only BS or P&L items depending on active tab.
  // Declared AFTER fsPanelTab so its deps array doesn't hit the TDZ.
  const filteredFsItems = useMemo(
    () => activeFlatItems.filter(i =>
      fsPanelTab === "bs" ? i.section.includes("BS_") : i.section.includes("PL_")
    ),
    [activeFlatItems, fsPanelTab]
  );

  // ─── COA Intelligence & Manual Rules ───
  // Intelligence: cross-client learned patterns from coa_mapping_intelligence
  // Rules: firm/client-level manual instructions from coa_mapping_rules
  const [intelligence, setIntelligence] = useState<{
    normalized_name: string; account_head: string;
    confidence_score: number; times_confirmed: number; times_overridden: number;
    scope: string; is_party_name: boolean;
    aliases: string[] | null; override_reason: string | null;
  }[]>([]);
  const [mappingRules, setMappingRules] = useState<MappingRule[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);

  // ─── FS state (manual overrides) ───
  const [manualOverrides, setManualOverrides] = useState<Record<string, { amount: number; reason: string }>>({});
  const [pyAmounts, setPyAmounts] = useState<Record<string, number>>({});

  // ─── View/UI state ───
  const [hideZero, setHideZero]               = useState(true);   // hide opening=0 AND closing=0 ledgers
  const [groupView, setGroupView]             = useState(true);   // group left panel by Tally parent_group
  const [expandedGroups, setExpandedGroups]   = useState<Record<string, boolean>>({});
  const [maximizedPanel, setMaximizedPanel]   = useState<"left" | "right" | null>(null);
  const [fullScreen, setFullScreen]           = useState(false);
  const [aiRunning, setAiRunning]             = useState(false);
  const [resetting, setResetting]             = useState(false);
  // PY-first workflow mode for the left panel.
  //   "all"    — all unmapped ledgers
  //   "py"     — ledgers with opening_balance ≠ 0 (map these first; propagates to CY)
  //   "cy"     — new ledgers this year: opening = 0, closing ≠ 0
  //   "closed" — closed accounts: opening ≠ 0, closing = 0 (PY-only impact)
  const [workMode, setWorkMode] = useState<"all" | "closed">("all");
  const [groupPickerOpen, setGroupPickerOpen] = useState<string | null>(null);

  // ─── Fetch Tally Trial Balance (sole authoritative TB source) ───
  // `tally_trial_balance` holds the real closing balances (with balance_type
  // Dr/Cr) and is keyed to the separate `engagements` table (Tally sync), not
  // `audit_engagements`. Resolve the tally engagement id via client_id +
  // financial_year, with tally_groups as a fallback.
  //
  // NOTE: `tally_ledgers` has all zero closing_balance values — do not use it
  // as a balance source. It is only a ledger name / group registry.
  const { data: tallyTb, isLoading: tallyTbLoading } = useQuery({
    queryKey: ["tally-tb-stage3", engagementId, engagement?.client_id, engagement?.financial_year],
    queryFn: async () => {
      const TB_COLS = "ledger_name, parent_group, opening_balance, opening_type, closing_balance, balance_type, debit_amount, credit_amount";

      // PostgREST caps a single response at 1000 rows — must paginate.
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

      // Step 0: direct lookup with audit_engagements.id
      if (engagementId) {
        const rows = await fetchAllTB(engagementId);
        if (rows.length) return rows;
      }

      if (!engagement?.client_id) return [];
      const clientId = engagement.client_id;

      // Step 1: find the engagement_id actually written by the sync agent via
      // sync_batches (which stores client_id). Most reliable — works regardless
      // of which engagements table the sync used.
      const { data: batchRow } = await supabase
        .from("sync_batches" as any)
        .select("engagement_id")
        .eq("client_id", clientId)
        .in("status", ["complete", "success", "complete_with_warnings"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const batchEngId: string | null = (batchRow as any)?.engagement_id ?? null;
      if (batchEngId && batchEngId !== engagementId) {
        const rows = await fetchAllTB(batchEngId);
        if (rows.length) return rows;
      }

      // Step 2: legacy engagements table lookup by client_id + FY
      let tallyEngId: string | null = null;
      if (engagement.financial_year) {
        const { data } = await supabase
          .from("engagements" as any)
          .select("id")
          .eq("client_id", clientId)
          .eq("financial_year", engagement.financial_year)
          .maybeSingle();
        tallyEngId = (data as any)?.id ?? null;
      }
      // Step 3: any engagement for this client (most recent FY)
      if (!tallyEngId) {
        const { data } = await supabase
          .from("engagements" as any)
          .select("id")
          .eq("client_id", clientId)
          .order("financial_year", { ascending: false })
          .limit(1)
          .maybeSingle();
        tallyEngId = (data as any)?.id ?? null;
      }
      if (!tallyEngId) return [];
      return fetchAllTB(tallyEngId);
    },
    enabled: !!engagementId,
  });

  // ─── Fetch ledger aliases for this client (Task 3) ───
  const { data: aliasRows, refetch: refetchAliases } = useQuery({
    queryKey: ["ledger-aliases", engagement?.client_id],
    queryFn: async () => {
      if (!engagement?.client_id) return [];
      const { data } = await (supabase.from as any)("ledger_aliases")
        .select("prior_ledger_name, current_ledger_name")
        .eq("client_id", engagement.client_id);
      return (data || []) as any[];
    },
    enabled: !!engagement?.client_id,
  });

  useEffect(() => {
    if (!fullScreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setFullScreen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullScreen]);

  useEffect(() => {
    if (!aliasRows) return;
    const map: Record<string, string> = {};
    for (const r of aliasRows as any[]) map[r.prior_ledger_name] = r.current_ledger_name;
    setAliases(map);
  }, [aliasRows]);

  // ─── Fetch existing FS rows ───
  const { data: existingFs } = useQuery({
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
      // Find previous FY engagement (exclude PY shells — they have no FS rows).
      // Use .limit(1) to prevent maybeSingle() error when both a regular
      // engagement and a PY shell exist for the same client + FY.
      const fyParts = (engagement.financial_year || "").split("-");
      if (fyParts.length !== 2) return null;
      const prevFy = `${parseInt(fyParts[0]) - 1}-${(parseInt(fyParts[0])).toString().slice(-2)}`;
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

  // ─── Fetch PY shell TB + coa_mapping for P&L comparative amounts ───
  // The CY trial balance's opening_balance is always ₹0 for P&L accounts
  // (Tally resets P&L each year). To show PY P&L figures in the Variance Drill
  // we must load the PY shell engagement's own closing balances.
  const { data: pyShellTbData } = useQuery({
    queryKey: ["py-shell-tb", engagement?.client_id, engagement?.financial_year],
    queryFn: async () => {
      if (!engagement?.client_id || !engagement?.financial_year) return null;
      const fyParts = (engagement.financial_year || "").split("-");
      if (fyParts.length !== 2) return null;
      const prevFy = `${parseInt(fyParts[0]) - 1}-${(parseInt(fyParts[0])).toString().slice(-2)}`;

      // Find the PY shell with actual TB data — iterate all FY-1 engagements
      // (PY shells first) and pick the one that has tally_trial_balance rows.
      // NOTE: audit_engagements has no created_at column — do NOT order by it.
      const { data: allFY1 } = await (supabase.from as any)("audit_engagements")
        .select("id, coa_mapping, is_py_shell")
        .eq("client_id", engagement.client_id)
        .eq("financial_year", prevFy);

      const fy1List = ((allFY1 || []) as any[]);
      // Sort: PY shells first (they have the synced TB data)
      fy1List.sort((a: any, b: any) => (b.is_py_shell ? 1 : 0) - (a.is_py_shell ? 1 : 0));

      let pyEng: any = null;
      for (const row of fy1List) {
        // Check if this engagement has actual TB rows.
        // Use a regular select(limit:1) probe — head:true counts return 0
        // under some RLS configurations even when rows are readable.
        const { data: probe } = await supabase
          .from("tally_trial_balance")
          .select("ledger_name")
          .eq("engagement_id", row.id)
          .limit(1);
        if (probe && probe.length > 0) { pyEng = row; break; }
      }
      // If no TB data in any, use first available (UI still needs coa_mapping)
      if (!pyEng && fy1List.length > 0) pyEng = fy1List[0];
      if (!pyEng) return null;

      // Paginated fetch of PY shell TB (closing_balance needed for PY amounts).
      // parent_group is REQUIRED for the group-inheritance fallback that maps
      // PY-shell ledgers with no direct coa entry to a CY FS code via their
      // shared Tally parent_group ("Sales Accounts" → NCE_REV_OPS).
      // opening_balance + opening_type are needed for the PY Changes-in-Inv
      // dual-post: PY changes = (PY-1 closing) − (PY closing) where PY-1
      // closing is encoded in the PY shell's opening_balance column.
      const TB_COLS = "ledger_name, closing_balance, balance_type, opening_balance, opening_type, parent_group";
      const PAGE = 1000;
      const all: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("tally_trial_balance")
          .select(TB_COLS)
          .eq("engagement_id", (pyEng as any).id)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      return { coaMapping: ((pyEng as any).coa_mapping as Record<string, any>) || {}, tbRows: all };
    },
    enabled: !!engagement?.client_id && !!engagement?.financial_year && !(engagement as any)?.is_py_shell,
  });

  // TB accounts — Tally Sync is the sole authoritative source.
  // closing_balance is unsigned; balance_type (Dr/Cr) gives the sign.
  //
  // PY-ONLY MERGE: Ledgers present in the PY trial balance but not in CY TB
  // (closed accounts, renamed ledgers) must still surface in Stage 6 COA
  // Mapping so the user can map them — otherwise their PY balance never
  // reaches Financial Statements (PY column stays blank) and they're invisible
  // in Notes to Accounts. We append a synthetic CY row (debit/credit/balance
  // = 0) for every PY-only ledger so the mapping panel shows it under its
  // parent_group, with the PY closing carried as opening_balance.
  const tbAccounts: {
    account_name: string; account_group: string;
    debit: number; credit: number; balance: number;
    opening_balance?: number; tally_debit?: number; tally_credit?: number;
    py_only?: boolean;
  }[] = useMemo(() => {
    const out: any[] = [];
    const seen = new Set<string>();
    // COA Mapping is FROZEN = Tally Sync only. The opening column shows the
    // current-year Tally OPENING balance, never a PY-shell-derived figure.
    // (Reverted the 2026-06-13 injection that pushed PY-shell closing into
    // opening_balance — COA Mapping must carry no derived/edited number. The
    // CY-opening vs PY-shell-closing identity is now enforced by the FS gate
    // [validateOpeningVsPriorClose], which BLOCKS generation and names every
    // ledger where the two disagree, instead of silently overwriting here.)
    if (tallyTb?.length) {
      for (const l of tallyTb as any[]) {
        const name = cleanTallyName(l.ledger_name);
        if (!name) continue;
        const cb   = Math.abs(Number(l.closing_balance ?? 0));
        const isDr = String(l.balance_type ?? "").toUpperCase() === "DR";
        seen.add(name.toLowerCase());
        const cyOpen  = signedOpening(l.opening_balance, l.opening_type, "DR");
        out.push({
          account_name:  name,
          account_group: cleanTallyName(l.parent_group),
          debit:  isDr ? cb : 0,
          credit: isDr ? 0  : cb,
          // Sign via shared module; "DR" nature => debit-positive (Dr → +cb, Cr → -cb).
          balance: signedBalance(cb, l.balance_type, "DR"),
          // Frozen Tally Sync — pure current-year opening, no PY-shell override.
          opening_balance: cyOpen,
          tally_debit:  Number(l.debit_amount  ?? 0),
          tally_credit: Number(l.credit_amount ?? 0),
        });
      }
    }
    const pyRows = pyShellTbData?.tbRows as any[] | undefined;
    if (pyRows && pyRows.length) {
      for (const l of pyRows) {
        const name = cleanTallyName(l.ledger_name);
        if (!name) continue;
        if (seen.has(name.toLowerCase())) continue;
        const cb   = Math.abs(Number(l.closing_balance ?? 0));
        const isDr = String(l.balance_type ?? "").toUpperCase() === "DR";
        out.push({
          account_name:  name,
          account_group: cleanTallyName(l.parent_group),
          debit: 0, credit: 0, balance: 0,
          // PY shell row's CLOSING = current engagement's OPENING. Debit-positive
          // via shared module — see fsSignConvention.signedBalance.
          opening_balance: signedBalance(cb, l.balance_type, "DR"),
          tally_debit: 0, tally_credit: 0,
          py_only: true,
        });
      }
    }
    return out;
  }, [tallyTb, pyShellTbData?.tbRows]);

  // Load existing mapping from engagement
  useEffect(() => {
    // Issue 5 (re-fix) — wait for engagement to actually load before deciding
    // whether to auto-map.  Previously the condition `engagement?.coa_mapping
    // == null` evaluated to TRUE during the loading window (because
    // `undefined == null` is `true`), so runAutoMapping fired on every page
    // load before the real coa_mapping arrived from the server — re-mapping
    // ledgers the user had just cleared.
    if (!engagement) return;

    const raw = (engagement as any).coa_mapping as Record<string, any> | null | undefined;

    // "User explicitly cleared" signal — written by clearAllMappings into
    // stage_statuses["3"].coa_cleared_at.  We use this in addition to the
    // value of coa_mapping itself because `null`/`{}` cannot reliably
    // distinguish "brand-new engagement, never mapped" from "user just
    // wiped the mapping" (both round-trip through Postgres the same way).
    const stageStatuses = (engagement as any)?.stage_statuses as Record<string, any> | null;
    const userCleared   = !!stageStatuses?.["3"]?.coa_cleared_at;

    const realKeys = raw && typeof raw === "object" ? Object.keys(raw) : [];

    if (raw && typeof raw === "object" && realKeys.length > 0) {
      // ── Backward-compat migration: BS_CA_INV direct → INV_STOCK ──────────
      // Pre-Phase-9 coa_mapping entries reference BS_CA_INV directly. After
      // Phase 9, BS_CA_INV is a parent node (with INV_* children), so
      // computeTotal overwrites any direct accumulation to 0. Auto-migrate
      // such entries to INV_STOCK (generic inventory dual-post code).
      let migrated = false;
      const patched: Record<string, any> = {};
      for (const k of realKeys) {
        const entry = (raw as any)[k];
        if (entry?.code === "BS_CA_INV") {
          patched[k] = { ...entry, code: "INV_STOCK", scheduleRef: "BS+P&L" };
          migrated = true;
        } else {
          patched[k] = entry;
        }
      }
      setCoaMapping(patched);
      if (migrated) {
        // Persist migration silently; show a one-time info toast
        supabase
          .from("audit_engagements")
          .update({ coa_mapping: patched } as any)
          .eq("id", engagementId)
          .then(() =>
            toast.info("Inventory ledgers upgraded to dual-posting (BS+P&L)", {
              description: "Old BS_CA_INV mappings auto-migrated to INV_STOCK.",
              duration: 5000,
            })
          );
      }
    } else if (userCleared) {
      // User explicitly cleared — keep mappings empty, do NOT auto-map.
      setCoaMapping({});
    } else if ((raw == null) && tbAccounts.length > 0) {
      // Brand-new engagement, no mapping ever stored — auto-map once.
      runAutoMapping();
    }
  }, [engagement, tbAccounts.length]);

  // ── Auto-patch: silently map "Profit & Loss A/c" type ledgers ─────────────
  // In Tally, when the firm transfers net profit to Capital / Reserves, a
  // "Profit & Loss A/c" ledger appears under the Primary group with the
  // transferred amount as a Cr balance. It belongs to Reserves and Surplus
  // (BS_EQ_RS) on Schedule III — not unmapped. This effect detects such
  // ledgers in the current mapping and patches them automatically.
  useEffect(() => {
    if (!tbAccounts.length || !activeLeafItems.length) return;
    // Only patch when we already have a mapping loaded (not the first-load auto-map case)
    if (!Object.keys(coaMapping).length) return;

    const PNL_PATTERNS = ["profit & loss a/c", "profit & loss", "p & l", "profit and loss a/c"];
    const pnlLedgers = tbAccounts.filter(a => {
      const lower = a.account_name.toLowerCase();
      return PNL_PATTERNS.some(p => lower === p || lower.startsWith(p)) && !coaMapping[a.account_name];
    });

    if (pnlLedgers.length === 0) return;

    const lineItem = activeLeafItems.find(i => i.code === "BS_EQ_RS");
    const patch: typeof coaMapping = { ...coaMapping };
    for (const acct of pnlLedgers) {
      patch[acct.account_name] = {
        code: "BS_EQ_RS",
        noteRef: lineItem?.noteRef ?? null,
        scheduleRef: lineItem?.scheduleRef ?? "",
        confidence: "high",
      };
    }

    setCoaMapping(patch);
    // Persist silently — no toast (it's automatic)
    supabase.from("audit_engagements").update({ coa_mapping: patch } as any).eq("id", engagementId);
  }, [tbAccounts, coaMapping, activeLeafItems, engagementId]);

  // Load PY amounts
  useEffect(() => {
    if (priorEngagement && Array.isArray(priorEngagement)) {
      const py: Record<string, number> = {};
      for (const row of priorEngagement) {
        if (row.line_item_code) py[row.line_item_code] = row.amount_cy || 0;
      }
      setPyAmounts(py);
    }
  }, [priorEngagement]);

  // ─── Load cross-client intelligence + firm mapping rules ───────────────────
  // Intelligence is loaded once per entity type and used in auto-mapping tier.
  // Rules are firm/client scoped and take highest priority.
  useEffect(() => {
    if (!engagementId) return;
    const entityTypeKey = isNonCorporate ? "nce" : "corporate";

    // Fetch intelligence (confidence >= 60, ordered by confidence desc)
    // Load GLOBAL patterns for all clients + ENGAGEMENT-SCOPED patterns for THIS client only.
    // Party names (scope=engagement) are only applied to same-client future years,
    // never sent to Claude as global training data.
    const clientId = engagement?.client_id;
    let intelQuery = (supabase as any)
      .from("coa_mapping_intelligence")
      .select("id, normalized_name, account_head, confidence_score, times_confirmed, times_overridden, scope, is_party_name, aliases, override_reason")
      .eq("entity_type", entityTypeKey)
      .gte("confidence_score", 60);
    if (clientId) {
      intelQuery = intelQuery.or(`scope.eq.global,and(scope.eq.engagement,client_id.eq.${clientId})`);
    } else {
      intelQuery = intelQuery.eq("scope", "global");
    }
    intelQuery
      .order("confidence_score", { ascending: false })
      .limit(500)
      .then(({ data }: any) => {
        if (data) setIntelligence(data);
      });

    // Fetch manual rules for this firm/client
    if (engagement?.firm_id) {
      (supabase as any)
        .from("coa_mapping_rules")
        .select("*")
        .eq("firm_id", engagement.firm_id)
        .eq("active", true)
        .order("priority", { ascending: false })
        .then(({ data }: any) => {
          if (data) {
            // Filter: null client_id = all clients; else must match this client
            const filtered = data.filter((r: MappingRule) =>
              r.client_id === null || r.client_id === engagement.client_id
            );
            setMappingRules(filtered);
          }
        });
    }
  }, [engagementId, isNonCorporate, engagement?.firm_id, engagement?.client_id]);

  // Load manual overrides from existing FS
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

  // ─── Normalise ledger name (matches DB function) ─────────────────────────
  const normalizeName = (name: string) =>
    name.toLowerCase().replace(/\s+/g, " ").trim();

  // ─── Apply a user rule against a ledger + group ───────────────────────────
  const applyRules = (
    ledgerName: string,
    tallyGroup: string,
    rules: MappingRule[],
  ): string | null => {
    const norm  = normalizeName(ledgerName);
    const group = normalizeName(tallyGroup);
    for (const r of rules) { // already sorted by priority desc
      const pattern = normalizeName(r.match_value);
      let matched = false;
      switch (r.match_type) {
        case "exact":       matched = norm === pattern; break;
        case "contains":    matched = norm.includes(pattern); break;
        case "starts_with": matched = norm.startsWith(pattern); break;
        case "ends_with":   matched = norm.endsWith(pattern); break;
        case "tally_group": matched = group === pattern; break;
      }
      if (matched) return r.fs_code;
    }
    return null;
  };

  // ─── Look up intelligence for a ledger ────────────────────────────────────
  // Priority: 1) exact normalized_name match  2) alias match (slightly lower confidence)
  const applyIntelligence = (
    ledgerName: string,
    intel: typeof intelligence,
  ): { code: string; confidence_score: number } | null => {
    const norm = normalizeName(ledgerName);
    // Exact match
    const exactHit = intel.find(i => i.normalized_name === norm);
    if (exactHit) return { code: exactHit.account_head, confidence_score: exactHit.confidence_score };
    // Alias match — cap at 85 so exact matches always win
    for (const i of intel) {
      if (!i.aliases?.length) continue;
      if (i.aliases.some(a => normalizeName(a) === norm)) {
        return { code: i.account_head, confidence_score: Math.min(i.confidence_score, 85) };
      }
    }
    return null;
  };

  // ═══════ AUTO-MAPPING ═══════
  //   Layered pipeline, per ledger (highest → lowest priority):
  //     0. Manual rules    (firm/client instructions — always wins)
  //     1. parent_group    (Tally's native taxonomy)
  //     1.5 Intelligence   (cross-client learned patterns, conf ≥ 75)
  //     2. keyword rules   (ledger name substring match)
  //     3. unmatched       (stays in "Unmapped" bucket)
  //
  //   Existing manual / carried-forward mappings are always preserved.
  const runAutoMapping = useCallback(() => {
    const groupTable = isNonCorporate ? PARENT_GROUP_MAP_NCE : PARENT_GROUP_MAP_CORP;
    const newMapping: typeof coaMapping = {};
    let viaRule = 0, viaIntel = 0, viaGroup = 0, viaKeyword = 0;

    for (const acct of tbAccounts) {
      // Preserve manual overrides and carried-forward (PY-validated) mappings
      const existing = coaMapping[acct.account_name];
      if (existing?.confidence === "manual" || existing?.confidence === "carried_forward") {
        newMapping[acct.account_name] = existing;
        continue;
      }

      let best: { code: string; confidence: string; source: string } | null = null;

      // 0. Manual rules (highest priority)
      const ruleCode = applyRules(acct.account_name, acct.account_group, mappingRules);
      if (ruleCode) {
        best = { code: ruleCode, confidence: "manual", source: "rule" };
        viaRule++;
      }

      // 1. parent_group
      if (!best) {
        const g = matchParentGroup(acct.account_group, groupTable);
        if (g) { best = { code: g.code, confidence: g.confidence, source: "group" }; viaGroup++; }
      }

      // 1.5. Intelligence (confidence ≥ 75 overrides lower-ranked, not higher)
      if (!best || best.source === "keyword") {
        const hit = applyIntelligence(acct.account_name, intelligence);
        if (hit && hit.confidence_score >= 75) {
          const intelConf = hit.confidence_score >= 90 ? "high" : "medium";
          if (!best || confidenceRank(intelConf) > confidenceRank(best.confidence)) {
            best = { code: hit.code, confidence: intelConf, source: "intelligence" };
            viaIntel++;
          }
        }
      }

      // 2. keyword rules
      if (!best || best.source !== "rule") {
        const name = acct.account_name.toLowerCase();
        for (const rule of activeAutoRules) {
          if (rule.keywords.some(kw => name.includes(kw))) {
            if (!best || confidenceRank(rule.confidence) > confidenceRank(best.confidence)) {
              best = { code: rule.code, confidence: rule.confidence, source: "keyword" };
            }
          }
        }
        if (best?.source === "keyword") viaKeyword++;
      }

      if (best) {
        const lineItem = activeLeafItems.find(i => i.code === best!.code);
        newMapping[acct.account_name] = {
          code: best.code,
          noteRef: lineItem?.noteRef || null,
          scheduleRef: lineItem?.scheduleRef || "",
          confidence: best.confidence,
        };
      }
    }

    setCoaMapping(newMapping);
    const total = Object.keys(newMapping).length;
    const parts = [
      viaRule    > 0 ? `${viaRule} via rules`        : "",
      viaGroup   > 0 ? `${viaGroup} via Tally group` : "",
      viaIntel   > 0 ? `${viaIntel} via AI memory`   : "",
      viaKeyword > 0 ? `${viaKeyword} via keywords`   : "",
    ].filter(Boolean).join(" · ");
    toast.success(
      `Auto-mapped ${total} of ${tbAccounts.length} accounts`,
      { description: parts || "All via heuristics" },
    );
  }, [tbAccounts, activeAutoRules, activeLeafItems, isNonCorporate, coaMapping, intelligence, mappingRules]);

  // ═══════ UNMAP ACTIONS ═══════
  const unmapAccount = useCallback(async (accountName: string) => {
    const updated = { ...coaMapping };
    delete updated[accountName];
    setCoaMapping(updated);
    try {
      await supabase.from("audit_engagements").update({ coa_mapping: updated } as any).eq("id", engagementId);
      toast.success(`Unmapped "${accountName}"`);
    } catch (e: any) {
      toast.error("Unmap saved locally, failed to persist: " + e.message);
    }
  }, [coaMapping, engagementId]);

  const clearAllMappings = useCallback(async () => {
    // Issue 5/6 (re-fix) — "Clear All" must reset every downstream surface so
    // the auditor can truly start from zero AND survive a page refresh
    // without ledgers re-mapping themselves.  Three things must happen:
    //   1. coa_mapping → sentinel `{ __cleared: true }` (NOT a bare `{}`,
    //      which Supabase can round-trip as null and re-trigger auto-map).
    //   2. Wipe every JSONB blob the FS face/notes/ratios reads from.
    //   3. Delete the persisted snapshot in fa_financial_statements so
    //      Stage 7 doesn't keep showing the previous Save's BS/P&L numbers.
    //   4. Invalidate React-Query caches so any open Stage 6/7 view rebuilds.
    if (Object.keys(coaMapping).length === 0) { toast.info("Nothing to clear"); return; }
    setCoaMapping({});
    try {
      // Schema notes (verified against integrations/supabase/types.ts):
      //  - coa_mapping            JSONB nullable
      //  - stage5_notes           JSONB nullable
      //  - stage7_ratios          JSONB nullable
      //  - py_manual_amounts      JSONB NOT NULL  ← must use {} not null
      //  - py_manual_annexures    JSONB NOT NULL  ← must use {} not null
      // Earlier code referenced `fs_overrides` and `py_annexures` which DO
      // NOT EXIST on this table; that made the whole UPDATE fail with an
      // \"unknown column\" error.  Supabase's update() does NOT throw on
      // failure — it returns { error } — so the previous version silently
      // showed a success toast while the row was untouched, and the next
      // page refresh re-loaded the same full mapping.
      const { error: updateErr } = await supabase
        .from("audit_engagements")
        .update({
          coa_mapping:           null as any,        // NULLABLE — fully wiped
          stage5_notes:          null as any,
          stage7_ratios:         null as any,
          py_manual_amounts:     {} as any,          // NOT NULL — empty JSONB
          py_manual_annexures:   {} as any,          // NOT NULL — empty JSONB
          // Mark stage 3 (COA) as in-progress so a refresh re-renders fresh.
          stage_statuses: {
            ...(((engagement as any)?.stage_statuses) || {}),
            "3": { status: "in_progress", coa_cleared_at: new Date().toISOString() },
          } as any,
        } as any)
        .eq("id", engagementId);

      if (updateErr) {
        toast.error("Clear failed: " + updateErr.message);
        return;
      }

      // Delete the saved FS snapshot so Stage 7 reflects the cleared state.
      const { error: delErr } = await supabase
        .from("fa_financial_statements")
        .delete()
        .eq("engagement_id", engagementId);
      if (delErr) {
        toast.error("FS snapshot delete failed: " + delErr.message);
        // Continue — the mapping is already cleared, FS rows will be
        // recomputed on next save.
      }

      // Invalidate caches so anything looking at the old snapshot refreshes.
      queryClient.invalidateQueries({ queryKey: ["fs-rows", engagementId] });
      queryClient.invalidateQueries({ queryKey: ["audit-engagement-detail", engagementId] });
      queryClient.invalidateQueries({ queryKey: ["stage5-notes-fsdata", engagementId] });

      toast.success("All mappings cleared and financials reset to zero");
    } catch (e: any) {
      toast.error("Clear failed: " + e.message);
    }
  }, [coaMapping, engagementId, queryClient, engagement]);

  // ═══════ RESET & RE-MAP (clear all + auto + AI) ═══════
  const resetAndRemap = useCallback(async () => {
    setResetting(true);
    try {
      // Step 1: Clear DB mapping
      await supabase.from("audit_engagements").update({ coa_mapping: {} } as any).eq("id", engagementId);

      // Step 1b: Clear ALL FS-derived data so Stage 7 shows a clean slate.
      // When the auditor resets COA mapping they expect the Financial Statements
      // to be blank — not carry stale auto or manual note rows / saved FS totals.
      // We delete BOTH fa_financial_statements (all rows, manual + non-manual)
      // AND nce_financial_notes (auto + manual custom rows) for this engagement.
      // This is intentional: "Reset & Re-map" is a hard reset, not a soft re-sync.
      await Promise.all([
        supabase.from("fa_financial_statements").delete().eq("engagement_id", engagementId),
        supabase.from("nce_financial_notes").delete().eq("engagement_id", engagementId),
      ]);
      // Invalidate FS caches so Stage 7 reflects the cleared state immediately.
      queryClient.invalidateQueries({ queryKey: ["fs-rows", engagementId] });
      // Use prefix match (no financial_year) so any variant of this key clears.
      queryClient.invalidateQueries({ queryKey: ["nce-financial-notes", engagementId] });
      // Signal to NCEDetailedNotes: skip auto-populate on next visit.
      // Without this, visiting the Notes tab immediately after Reset & Re-map
      // triggers "First visit" auto-populate from the freshly rebuilt COA mapping,
      // making Notes show amounts again. The flag is consumed (removed) on the
      // first Notes tab visit so subsequent visits auto-populate normally.
      try { localStorage.setItem(`nce_notes_reset_${engagementId}`, "1"); } catch { /* private mode */ }

      // Step 2: Build fresh auto-mapping — carry-forward mappings are always preserved
      const groupTable = isNonCorporate ? PARENT_GROUP_MAP_NCE : PARENT_GROUP_MAP_CORP;
      // Seed fresh map with carried-forward entries (PY-validated, never reset)
      const freshMapping: typeof coaMapping = Object.fromEntries(
        Object.entries(coaMapping).filter(([, v]) => v.confidence === "carried_forward")
      );
      for (const acct of tbAccounts) {
        if (freshMapping[acct.account_name]) continue; // already preserved (CF)
        let best: { code: string; confidence: string } | null = null;

        // 0. Manual rules
        const ruleCode = applyRules(acct.account_name, acct.account_group, mappingRules);
        if (ruleCode) best = { code: ruleCode, confidence: "manual" };

        // 1. parent_group
        if (!best) {
          const g = matchParentGroup(acct.account_group, groupTable);
          if (g) best = { code: g.code, confidence: g.confidence };
        }

        // 1.5. Intelligence
        if (!best) {
          const hit = applyIntelligence(acct.account_name, intelligence);
          if (hit && hit.confidence_score >= 75) {
            best = { code: hit.code, confidence: hit.confidence_score >= 90 ? "high" : "medium" };
          }
        }

        // 2. keyword rules
        const name = acct.account_name.toLowerCase();
        for (const rule of activeAutoRules) {
          if (rule.keywords.some(kw => name.includes(kw))) {
            if (!best || confidenceRank(rule.confidence) > confidenceRank(best.confidence)) {
              best = { code: rule.code, confidence: rule.confidence };
            }
          }
        }

        if (best) {
          const lineItem = activeLeafItems.find(i => i.code === best!.code);
          freshMapping[acct.account_name] = {
            code: best.code,
            noteRef: lineItem?.noteRef || null,
            scheduleRef: lineItem?.scheduleRef || "",
            confidence: best.confidence,
          };
        }
      }

      // Step 3: Persist fresh mapping + update React state
      await supabase.from("audit_engagements").update({ coa_mapping: freshMapping } as any).eq("id", engagementId);
      setCoaMapping(freshMapping);

      const autoCount = Object.keys(freshMapping).length;
      const remaining = tbAccounts.length - autoCount;
      toast.success(`Reset done — auto-mapped ${autoCount}/${tbAccounts.length} accounts`, {
        description: remaining > 0 ? `${remaining} ledgers still unmapped — click "AI Map Remaining" to run AI.` : "All ledgers auto-mapped.",
      });
    } catch (e: any) {
      toast.error("Reset failed: " + e.message);
    } finally {
      setResetting(false);
    }
  }, [engagementId, tbAccounts, isNonCorporate, activeAutoRules, activeLeafItems, queryClient]);
  // ═══════ SMART MAP (with group propagation) ═══════
  // Whenever a user manually maps a ledger, Stage 6 learns that the Tally
  // parent_group it belongs to likely maps to the same FS code. We immediately
  // propagate the same code to any UNMAPPED ledger in that group (confidence
  // "medium", so it can be re-AI'd or manually overridden). Existing manual
  // mappings are never touched — this only fills empty slots.
  const mapLedgerWithPropagation = useCallback(async (
    ledgerName: string,
    code: string,
    confidence: "high" | "medium" | "low" | "manual" = "manual",
    opts: { propagate?: boolean; persist?: boolean } = {},
  ) => {
    const { propagate = true, persist = true } = opts;
    const lineItem = activeLeafItems.find(i => i.code === code);
    if (!lineItem) return;

    const acct = tbAccounts.find(a => a.account_name === ledgerName);
    const group = acct?.account_group || "";
    const updated: typeof coaMapping = { ...coaMapping };

    updated[ledgerName] = {
      code,
      noteRef: lineItem.noteRef ?? null,
      scheduleRef: lineItem.scheduleRef || "",
      confidence,
    };

    let propagated = 0;
    if (propagate && group) {
      for (const a of tbAccounts) {
        if (a.account_name === ledgerName) continue;
        if ((a.account_group || "") !== group) continue;
        if (updated[a.account_name]) continue; // don't overwrite existing (incl. manual)
        updated[a.account_name] = {
          code,
          noteRef: lineItem.noteRef ?? null,
          scheduleRef: lineItem.scheduleRef || "",
          confidence: "medium",
        };
        propagated++;
      }
    }

    setCoaMapping(updated);
    if (persist) {
      try { await supabase.from("audit_engagements").update({ coa_mapping: updated } as any).eq("id", engagementId); } catch { /* ignore */ }
    }

    // ── Feed user correction into cross-client intelligence table ──
    // Fire-and-forget: never block the UI.
    if (confidence === "manual") {
      const norm = normalizeName(ledgerName);
      const entityTypeKey = isNonCorporate ? "nce" : "corporate";
      const bsPl = lineItem.section?.startsWith("PL") ? "PL" : "BS";

      // Detect if this is an AI override (previous entry was AI-mapped to a DIFFERENT code)
      const prevEntry = coaMapping[ledgerName];
      const wasAiMapped = prevEntry && (prevEntry.confidence === "ai" || prevEntry.confidence === "low" || prevEntry.confidence === "medium");
      const aiSuggestedCode = wasAiMapped && prevEntry.code !== code ? prevEntry.code : null;

      // Fire alias-analysis async — this is what makes the AI learn WHY
      supabase.functions.invoke("analyze-coa-override", {
        body: {
          ledger_name:       ledgerName,
          normalized_name:   norm,
          entity_type:       entityTypeKey,
          ai_mapping_code:   aiSuggestedCode,   // null if no prior AI suggestion
          human_mapping_code: code,
          firm_id:           engagement?.firm_id ?? null,
          engagement_id:     engagementId,
        },
      }).catch(() => {}); // never block the UI on this

      supabase.rpc("upsert_coa_intelligence" as any, {
        p_normalized_name: norm,
        p_entity_type:     entityTypeKey,
        p_account_head:    code,
        p_bs_pl:           bsPl,
        p_account_group:   acct?.account_group || null,
        p_firm_id:         engagement?.firm_id || null,
        p_engagement_id:   engagementId,
        p_accepted:        true,
        p_client_id:       engagement?.client_id || null,  // scopes party names to this client
      }).then(() => {
        // Optimistically update local intelligence so next auto-map uses it
        // is_party_name will be computed server-side; optimistic value defaults to false
        setIntelligence(prev => {
          const idx = prev.findIndex(i => i.normalized_name === norm);
          if (idx >= 0) {
            return prev.map((i, n) => n !== idx ? i : {
              ...i,
              account_head:    code,
              times_confirmed: i.times_confirmed + 1,
              confidence_score: Math.min(99, i.confidence_score + 3),
            });
          }
          return [
            ...prev,
            { normalized_name: norm, account_head: code, confidence_score: 70, times_confirmed: 1, times_overridden: 0, scope: 'global', is_party_name: false, aliases: null, override_reason: null },
          ];
        });
      });
    }

    toast.success(
      `Mapped "${ledgerName}" → ${lineItem.name}`,
      propagated > 0 ? { description: `Auto-applied to ${propagated} other unmapped ledgers in "${group}"` } : undefined,
    );
  }, [activeLeafItems, coaMapping, engagementId, tbAccounts, isNonCorporate, engagement?.firm_id]);

  // Issue 1 (today) — Bulk-assign every ticked ledger to a single FS code in
  // ONE state update + ONE DB write.  Manual-confidence so the same correction
  // counts for cross-client AI memory just like a single map would.
  const bulkMapLedgers = useCallback(async (ledgerNames: string[], code: string) => {
    if (ledgerNames.length === 0) return;
    const lineItem = activeLeafItems.find(i => i.code === code);
    if (!lineItem) return;

    const updated: typeof coaMapping = { ...coaMapping };
    let mapped = 0;
    for (const name of ledgerNames) {
      updated[name] = {
        code,
        noteRef:     lineItem.noteRef ?? null,
        scheduleRef: lineItem.scheduleRef || "",
        confidence:  "manual",
      };
      mapped++;
    }
    setCoaMapping(updated);
    try {
      await supabase.from("audit_engagements").update({ coa_mapping: updated } as any).eq("id", engagementId);
    } catch { /* surfaced to user via the toast below if needed */ }

    // Feed each ledger into cross-client AI memory — same path the single-map
    // flow uses, so bulk-mapping doesn't bypass the learning loop.
    const entityTypeKey = isNonCorporate ? "nce" : "corporate";
    const bsPl = lineItem.section?.startsWith("PL") ? "PL" : "BS";
    for (const name of ledgerNames) {
      const acct = tbAccounts.find(a => a.account_name === name);
      const norm = normalizeName(name);
      supabase.rpc("upsert_coa_intelligence" as any, {
        p_normalized_name: norm,
        p_entity_type:     entityTypeKey,
        p_account_head:    code,
        p_bs_pl:           bsPl,
        p_account_group:   acct?.account_group || null,
        p_firm_id:         engagement?.firm_id || null,
        p_engagement_id:   engagementId,
        p_accepted:        true,
        p_client_id:       engagement?.client_id || null,
      });
    }

    toast.success(`Mapped ${mapped} ledger${mapped === 1 ? "" : "s"} → ${lineItem.name}`);
  }, [activeLeafItems, coaMapping, engagementId, tbAccounts, isNonCorporate, engagement?.firm_id, engagement?.client_id]);

  // ═══════ AI MAPPING (Claude via claude-gateway) ═══════
  // Sends unmapped + low-confidence ledgers in batches to fs_line_mapper.
  // Returns {ledger, fs_code, confidence, reason}; we merge back into coaMapping.
  const runAiMapping = useCallback(async () => {
    if (aiRunning) return;
    const targets = tbAccounts.filter((a) => {
      if (hideZero && Math.abs(a.balance) < 0.005 && Math.abs(a.opening_balance ?? 0) < 0.005) return false;
      const m = coaMapping[a.account_name];
      if (!m) return true;
      // Never re-map confirmed or prior-year-validated ledgers via AI
      if (m.confidence === "manual" || m.confidence === "carried_forward") return false;
      return m.confidence === "low";
    });
    if (targets.length === 0) { toast.info("Nothing left for AI to map"); return; }

    setAiRunning(true);
    const fsItems = activeLeafItems.map((i) => ({ code: i.code, name: i.name, section: i.section }));

    // Build prior-year anchor list so Claude uses proven mappings as training signal
    const cfAnchors = Object.entries(coaMapping)
      .filter(([, m]) => m.confidence === "carried_forward")
      .slice(0, 60) // cap at 60 to avoid oversized payloads
      .map(([ledger, m]) => {
        const li = activeLeafItems.find((i) => i.code === m.code);
        return { ledger, fs_code: m.code, fs_name: li?.name || m.code };
      });

    const batchSize = 40;
    const merged = { ...coaMapping };
    let mappedCount = 0, failedBatches = 0;

    try {
      for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize).map((a) => ({
          ledger:          a.account_name,
          tally_group:     a.account_group,
          closing_balance: Math.round(a.balance),
          side:            a.balance >= 0 ? "Dr" : "Cr",
        }));
        // Include high-confidence GLOBAL intelligence patterns so Claude uses proven mappings.
        // IMPORTANT: party names (is_party_name=true / scope=engagement) are intentionally
        // excluded here — they must never be sent as global learned_patterns to Claude,
        // since they are vendor/customer business names specific to one client and would
        // confuse the AI when mapping other clients' ledgers.
        // Build learned_patterns: canonical names + all their AI-derived aliases.
        // Party names and engagement-scoped entries are intentionally excluded.
        const intelAnchors: { ledger_pattern: string; fs_code: string; confidence: number }[] = [];
        for (const i of intelligence) {
          if (i.confidence_score < 80 || i.is_party_name || i.scope === 'engagement') continue;
          intelAnchors.push({ ledger_pattern: i.normalized_name, fs_code: i.account_head, confidence: Math.round(i.confidence_score) });
          // Include aliases so Claude maps spelling variants / abbreviations correctly
          if (i.aliases?.length) {
            for (const alias of i.aliases.slice(0, 4)) { // max 4 aliases per entry to keep payload lean
              intelAnchors.push({ ledger_pattern: alias, fs_code: i.account_head, confidence: 80 });
            }
          }
          if (intelAnchors.length >= 120) break; // hard cap to avoid oversized payload
        }

        // Pull approved skill examples for COA remapping — these teach Claude
        // the firm's specific correction patterns (e.g. "AI kept mapping X to Y but we want Z")
        const coaSkillExamples = examplesFor("coa_remap");

        const payload = {
          entity_type:        isNonCorporate ? "nce" : "corporate",
          fs_items:           fsItems,
          ledgers:            batch,
          ...(cfAnchors.length      > 0 ? { prior_year_anchors: cfAnchors      } : {}),
          ...(intelAnchors.length   > 0 ? { learned_patterns:   intelAnchors   } : {}),
        };
        const { data, error } = await supabase.functions.invoke("claude-gateway", {
          body: {
            request_type:    "fs_line_mapper",
            user_message:    JSON.stringify(payload),
            ...(coaSkillExamples.length > 0 ? { skill_examples: coaSkillExamples } : {}),
          },
        });
        // Record that these skills were used (updates applied_count + last_used_at)
        if (!error && coaSkillExamples.length > 0) {
          recordUsed(coaSkillExamples.map(s => s.id));
        }
        if (error) { failedBatches++; continue; }
        // claude-gateway returns the parsed JSON directly at the top level.
        // Fall back to .parsed / .content shapes for resilience.
        const raw = Array.isArray(data) ? data
                   : (data as any)?.parsed ?? (data as any)?.content ?? [];
        const arr = Array.isArray(raw) ? raw : [];
        for (const r of arr) {
          const ledgerName = r?.ledger ?? r?.ledger_name;
          const code       = r?.fs_code ?? r?.code;
          if (!ledgerName || !code) continue;
          const lineItem = activeLeafItems.find((li) => li.code === code);
          if (!lineItem) continue;
          // do not override manual or carried-forward mappings
          const existing = merged[ledgerName];
          if (existing?.confidence === "manual" || existing?.confidence === "carried_forward") continue;
          merged[ledgerName] = {
            code,
            noteRef:     lineItem.noteRef ?? null,
            scheduleRef: lineItem.scheduleRef || "",
            confidence:  "ai", // always stamp "ai" so bucket counts are precise
          };
          mappedCount++;
        }
      }

      setCoaMapping(merged);
      try {
        await supabase.from("audit_engagements").update({ coa_mapping: merged } as any).eq("id", engagementId);
      } catch { /* persist errors surfaced to user below */ }

      toast.success(
        `AI mapped ${mappedCount} ledgers`,
        { description: failedBatches > 0 ? `${failedBatches} batch(es) failed — re-run to retry` : "Saved to engagement" },
      );
    } catch (e: any) {
      toast.error("AI mapping failed: " + e.message);
    } finally {
      setAiRunning(false);
    }
  }, [aiRunning, tbAccounts, hideZero, coaMapping, activeLeafItems, isNonCorporate, engagementId]);


  // ═══════ GROUP ACTIONS ═══════
  const assignGroup = useCallback(async (groupName: string, fsCode: string) => {
    const lineItem = activeLeafItems.find((i) => i.code === fsCode);
    if (!lineItem) return;
    const updated = { ...coaMapping };
    let n = 0;
    for (const a of tbAccounts) {
      if ((a.account_group || "— (no group) —") !== groupName) continue;
      if (updated[a.account_name]?.confidence === "manual") continue;
      updated[a.account_name] = {
        code: fsCode,
        noteRef: lineItem.noteRef ?? null,
        scheduleRef: lineItem.scheduleRef || "",
        confidence: "manual",
      };
      n++;
    }
    setCoaMapping(updated);
    try { await supabase.from("audit_engagements").update({ coa_mapping: updated } as any).eq("id", engagementId); } catch { /* ignore */ }
    toast.success(`Mapped ${n} ledgers in "${groupName}" → ${lineItem.name}`);
  }, [tbAccounts, activeLeafItems, coaMapping, engagementId]);

  const unmapGroup = useCallback(async (groupName: string) => {
    const updated = { ...coaMapping };
    let n = 0;
    for (const a of tbAccounts) {
      if ((a.account_group || "— (no group) —") !== groupName) continue;
      if (updated[a.account_name]) { delete updated[a.account_name]; n++; }
    }
    if (n === 0) { toast.info("No mappings in that group"); return; }
    setCoaMapping(updated);
    try { await supabase.from("audit_engagements").update({ coa_mapping: updated } as any).eq("id", engagementId); } catch { /* ignore */ }
    toast.success(`Unmapped ${n} ledgers from "${groupName}"`);
  }, [tbAccounts, coaMapping, engagementId]);

  const unmapByConfidence = useCallback(async (level: "low" | "medium") => {
    const updated = { ...coaMapping };
    let n = 0;
    for (const [k, v] of Object.entries(coaMapping)) {
      if (v.confidence === level) { delete updated[k]; n++; }
    }
    if (n === 0) { toast.info(`No ${level}-confidence mappings to clear`); return; }
    setCoaMapping(updated);
    try {
      await supabase.from("audit_engagements").update({ coa_mapping: updated } as any).eq("id", engagementId);
      toast.success(`Unmapped ${n} ${level}-confidence accounts`);
    } catch (e: any) {
      toast.error("Unmap saved locally, failed to persist: " + e.message);
    }
  }, [coaMapping, engagementId]);

  // ═══════ IMPORT PRIOR YEAR MAPPING ═══════
  const importPriorMapping = async () => {
    const fyParts = (engagement.financial_year || "").split("-");
    if (fyParts.length !== 2) return;
    const prevFy = `${parseInt(fyParts[0]) - 1}-${(parseInt(fyParts[0])).toString().slice(-2)}`;
    
    const { data: prevEng } = await supabase
      .from("audit_engagements")
      .select("coa_mapping")
      .eq("client_id", engagement.client_id)
      .eq("financial_year", prevFy)
      .maybeSingle();
    
    if (!prevEng?.coa_mapping || Object.keys(prevEng.coa_mapping as any).length === 0) {
      toast.error("No prior year mapping found");
      return;
    }

    const priorMap = prevEng.coa_mapping as Record<string, any>;
    const merged = { ...coaMapping };
    let imported = 0;
    for (const acct of tbAccounts) {
      if (priorMap[acct.account_name] && !merged[acct.account_name]) {
        merged[acct.account_name] = priorMap[acct.account_name];
        imported++;
      }
    }
    setCoaMapping(merged);
    // Persist imported mapping to DB so it survives a page refresh
    try {
      await supabase.from("audit_engagements").update({ coa_mapping: merged } as any).eq("id", engagementId);
      toast.success(`Imported ${imported} mappings from prior year`, {
        description: "Saved to engagement — refreshing will retain these mappings.",
      });
    } catch (e: any) {
      toast.error("Mappings imported locally but failed to save: " + e.message);
    }
  };

  // ═══════ MAP SIMILAR ═══════
  const mapSimilar = (accountName: string) => {
    const mapping = coaMapping[accountName];
    if (!mapping) return;
    
    const target = accountName.toLowerCase();
    const words = target.split(/\s+/).filter(w => w.length > 3);
    const newMapping = { ...coaMapping };
    let count = 0;

    for (const acct of tbAccounts) {
      if (newMapping[acct.account_name]) continue;
      const acctLower = acct.account_name.toLowerCase();
      const matchScore = words.filter(w => acctLower.includes(w)).length / Math.max(words.length, 1);
      if (matchScore >= 0.5) {
        newMapping[acct.account_name] = { ...mapping, confidence: "medium" };
        count++;
      }
    }
    setCoaMapping(newMapping);
    if (count > 0) toast.success(`Mapped ${count} similar accounts`);
    else toast.info("No similar unmapped accounts found");
  };

  // ═══════ RECLASSIFY / MOVE LEDGER ═══════
  // Issue 1 (today, take 2) — when the auditor has ticked multiple ledgers
  // via the bulk-select checkboxes AND opens the ⇄ Reclassify dialog from
  // any one of those ticked rows, the user expects the chosen destination
  // to apply to EVERY ticked ledger, not just the row whose ⇄ button was
  // clicked.  Treat the dialog as a bulk-move whenever the ticked-row that
  // triggered it is itself ticked: all ticked ledgers move together.  When
  // the dialog is invoked on a non-ticked row, behave exactly as before
  // (single-ledger move) so existing muscle memory is unchanged.
  const reclassifyAccount = async () => {
    if (!reclassifyDialog || !reclassifyCode) return;
    const { accountName } = reclassifyDialog;
    const lineItem = activeLeafItems.find(i => i.code === reclassifyCode);
    if (!lineItem) return;

    // Decide bulk vs single.  If the ⇄ was opened from a ticked row and the
    // tick-bucket has >1 entries, treat the dialog as a bulk operation.
    const bulkMode = multiSelect.has(accountName) && multiSelect.size > 1;
    const targets  = bulkMode ? Array.from(multiSelect) : [accountName];

    const newEntry = (name: string): Record<string, any> => {
      const entry: Record<string, any> = {
        code:        reclassifyCode,
        noteRef:     lineItem.noteRef,
        scheduleRef: lineItem.scheduleRef || "",
        confidence:  "manual",
      };
      if (reclassifyReason.trim()) entry.move_reason = reclassifyReason.trim();
      return entry;
    };

    const newMapping: typeof coaMapping = { ...coaMapping };
    for (const name of targets) newMapping[name] = newEntry(name) as any;
    setCoaMapping(newMapping);
    if (bulkMode) setMultiSelect(new Set());

    // Auto-save to DB so the override survives page refresh
    try {
      await supabase.from("audit_engagements").update({ coa_mapping: newMapping } as any).eq("id", engagementId);
      if (bulkMode) {
        toast.success(`Moved ${targets.length} ledgers → ${lineItem.name}`);
      } else {
        const oldLineItem = coaMapping[accountName]
          ? activeLeafItems.find(i => i.code === coaMapping[accountName].code)
          : null;
        const fromLabel = oldLineItem?.name || coaMapping[accountName]?.code || "unmapped";
        toast.success(`Moved "${accountName}" from ${fromLabel} → ${lineItem.name}`);
      }
    } catch (e: any) {
      toast.error("Saved locally, failed to persist: " + e.message);
    }
    setReclassifyDialog(null);
    setReclassifyCode("");
    setReclassifyReason("");
  };

  const resetToAuto = async (accountName: string) => {
    const acct = tbAccounts.find(a => a.account_name === accountName);
    if (!acct) return;
    const name = acct.account_name.toLowerCase();
    let bestMatch: { code: string; confidence: string } | null = null;
    for (const rule of activeAutoRules) {
      if (rule.keywords.some(kw => name.includes(kw))) {
        if (!bestMatch || confidenceRank(rule.confidence) > confidenceRank(bestMatch.confidence)) {
          bestMatch = { code: rule.code, confidence: rule.confidence };
        }
      }
    }

    let newMapping: typeof coaMapping;
    if (bestMatch) {
      const lineItem = activeLeafItems.find(i => i.code === bestMatch!.code);
      newMapping = {
        ...coaMapping,
        [accountName]: {
          code: bestMatch.code,
          noteRef: lineItem?.noteRef || null,
          scheduleRef: lineItem?.scheduleRef || "",
          confidence: bestMatch.confidence,
        },
      };
      toast.success(`Reset "${accountName}" → auto: ${lineItem?.name || bestMatch.code}`);
    } else {
      const updated = { ...coaMapping };
      delete updated[accountName];
      newMapping = updated;
      toast.info(`Cleared "${accountName}" — no auto-mapping found`);
    }
    setCoaMapping(newMapping);
    try {
      await supabase.from("audit_engagements").update({ coa_mapping: newMapping } as any).eq("id", engagementId);
    } catch (e: any) {
      toast.error("Failed to persist reset: " + e.message);
    }
    setReclassifyDialog(null);
    setReclassifyCode("");
    setReclassifyReason("");
  };

  // 2026-06-13 — RC-16: case-insensitive COA-mapping index. The COA Mapping
  // page resolved ledgers by EXACT name (coaMapping[ledger]); a ledger named
  // "Gst Payable" in the TB but mapped under key "GST PAYABLE" was silently
  // dropped from BOTH the CY and PY columns — undercounting the note vs the
  // Notes/Face (which match case-insensitively via nceAutoPopulate). Final
  // fallback resolves the same way the note auto-populate does.
  const coaMapCI = useMemo(() => {
    const m: Record<string, { code: string }> = {};
    for (const [k, v] of Object.entries(coaMapping || {})) {
      if (!(v as any)?.code) continue;
      const kk = String(k).trim().toLowerCase();
      if (!(kk in m)) m[kk] = v as any;
    }
    return m;
  }, [coaMapping]);
  const resolveMapping = (name: string): { code: string } | undefined =>
    coaMapping[name] ?? coaMapping[String(name).trim()] ?? coaMapCI[String(name).trim().toLowerCase()];

  // ═══════ COMPUTED FS AMOUNTS ═══════
  const computedAmounts: Record<string, number> = useMemo(() => {
    const amounts: Record<string, number> = {};
    let hasInvMapping = false;

    // Aggregate TB accounts into FS line items
    for (const acct of tbAccounts) {
      const mapping = resolveMapping(acct.account_name);
      if (!mapping) continue;
      const plCode = INV_DUAL_MAP[mapping.code];
      if (plCode) {
        // ── Dual-post: BS closing balance + P&L Changes in Inventories ──
        amounts[mapping.code] = (amounts[mapping.code] || 0) + acct.balance;
        amounts[plCode] = (amounts[plCode] || 0) + ((acct.opening_balance ?? 0) - acct.balance);
        hasInvMapping = true;
      } else if (isTallyPLAccount(acct.account_name) && mapping.code.startsWith("BS_")) {
        // ── P&L A/c on Balance Sheet: use OPENING balance (prior retained earnings) ──
        // Tally's "Profit & Loss A/c" closing balance = opening + current-year profit.
        // Using closing here double-counts net profit that is already in PL_REV/PL_EXP.
        // Net profit is auto-credited to BS_EQ_RS after computeTotal (below).
        amounts[mapping.code] = (amounts[mapping.code] || 0) + (acct.opening_balance ?? 0);
      } else {
        amounts[mapping.code] = (amounts[mapping.code] || 0) + acct.balance;
      }
    }

    // Apply manual overrides — inventory P&L codes are locked when any inv ledger is mapped
    for (const [code, override] of Object.entries(manualOverrides)) {
      if (hasInvMapping && INV_PL_CODES.has(code)) continue; // auto-computed, locked
      amounts[code] = override.amount;
    }

    // Compute parent totals using the active tree (corporate or NCE)
    const computeTotal = (item: FSLineItem): number => {
      if (!item.children || item.children.length === 0) {
        return amounts[item.code] || 0;
      }
      const total = item.children.reduce((sum, child) => sum + computeTotal(child), 0);
      amounts[item.code] = total;
      return total;
    };

    for (const item of activeTree) {
      computeTotal(item);
    }

    // ── NCE P&L profit chain (V → XIII) ─────────────────────────────────────
    // computeTotal only sums additive parents (NCE_PL_INC, NCE_PL_EXP, NCE_TAX).
    // The subtraction-based subtotals V/VII/IX/XI/XIII are leaf codes with no
    // children, so without this block they stay 0 on the COA Mapping screen —
    // the auditor saw blanks from "V. Profit/(Loss) before exceptional items…"
    // downward. Mirror the Stage 7 chain (PipelineFinancialStatements.tsx) so
    // the same figures appear here. Mapped values (VI exceptional, VIII
    // extraordinary, X partners' remuneration, XII tax) flow in via `amounts`.
    if (isNonCorporate) {
      const nceInc = amounts["NCE_PL_INC"] || 0; // negative (credit)
      const nceExp = amounts["NCE_PL_EXP"] || 0; // positive (debit)
      amounts["NCE_PROF_V"]   = Math.round((-nceInc - nceExp) * 100) / 100;
      amounts["NCE_PROF_VII"] = Math.round((amounts["NCE_PROF_V"]   - (amounts["NCE_EXCEP"]    || 0)) * 100) / 100;
      amounts["NCE_PROF_IX"]  = Math.round((amounts["NCE_PROF_VII"] - (amounts["NCE_EXTORD"]   || 0)) * 100) / 100;
      amounts["NCE_PROF_XI"]  = Math.round((amounts["NCE_PROF_IX"]  - (amounts["NCE_PART_REM"] || 0)) * 100) / 100;
      amounts["NCE_NET_PROF"] = Math.round((amounts["NCE_PROF_XI"]  - (amounts["NCE_TAX"]      || 0)) * 100) / 100;
    }

    // ── Auto-flow net P&L to BS_EQ_RS for corporate entities ─────────────────
    // Revenue (PL_REV, credit = negative) and Expenses (PL_EXP, debit = positive)
    // live in P&L codes.  The current-year net profit must be credited to Reserves &
    // Surplus so the Balance Sheet balances — mirrors the closing journal entry.
    //
    // BOOKS-CLOSED DETECTION (client-agnostic):
    //   In some Tally configurations the firm closes books mid-year and posts the
    //   current-year P&L directly into the retained-earnings ledger (e.g. into
    //   "Profit & Loss A/c (BxS)" or "Reserves & Surplus" itself).  In that case
    //   the closing balance of that ledger ALREADY includes the current-year
    //   profit/loss — adding netPL again would double-count.
    //
    //   We detect this by looking for any ledger mapped to BS_EQ_RS that has
    //   current-year journal activity (tally_debit + tally_credit > 0), EXCLUDING
    //   the "auto-flow" current-year accumulator ledger (Tally's "Profit & Loss
    //   A/c" with opening=0, whose movement IS the current-year P&L still pending
    //   transfer).  If such a non-accumulator ledger has movement → books are
    //   closed → skip the netPL auto-flow.
    // Auto-credit runs for BOTH corporate AND NCE entities.
    // Previously guarded by `!isNonCorporate` which skipped NCE — causing the
    // BS total at the bottom of the COA mapping screen to show an imbalance
    // equal to the net profit for every NCE client.
    // ── Auto-flow net P&L to BS_EQ_RS for CORPORATE entities ONLY ──────────
    // NCE entities do NOT get auto-credit because Tally's partner capital
    // account closing balances ALREADY include the current-year profit
    // (transferred by Tally's year-end closing). Adding it again would
    // DOUBLE-COUNT and create a visible BS imbalance.
    // The isTallyPLAccount guard at line ~1677 uses OPENING (=0) for the
    // P&L A/c — this is correct for NCE because the P&L A/c's closing
    // value is already reflected in the partner capital accounts.
    if (!isNonCorporate) {
      const reservesLedgers = tbAccounts.filter(a => coaMapping[a.account_name]?.code === "BS_EQ_RS");
      const booksClosed = currentYearProfitAlreadyInReserves(reservesLedgers);
      if (!booksClosed) {
        const rev = amounts["PL_REV"] || 0;
        const exp = amounts["PL_EXP"] || 0;
        const netPL = Math.round((-rev - exp) * 100) / 100;
        if (Math.abs(netPL) > 0.005) {
          amounts["BS_EQ_RS"] = (amounts["BS_EQ_RS"] || 0) - netPL;
          for (const item of activeTree) computeTotal(item);
        }
      }
    }

    return amounts;
  }, [tbAccounts, coaMapping, manualOverrides, isNonCorporate]);

  // ═══════ COMPARATIVE (PY) AMOUNTS ═══════
  // Prior-year amounts derived from opening_balance on the CY trial balance.
  // Valid for Balance Sheet items (asset/equity/liability). For P&L items,
  // opening is always 0 — so PY P&L must come from prior engagement's
  // fa_financial_statements (handled in Stage 7). The same coa_mapping
  // serves both CY and PY — re-mapping a ledger re-groups both periods.
  const computedAmountsPY: Record<string, number> = useMemo(() => {
    const amounts: Record<string, number> = {};
    for (const acct of tbAccounts) {
      // Alias redirect: if this is a CLOSED prior-year ledger aliased to a
      // current-year ledger, aggregate under the current ledger's mapping.
      let mappingSource = acct.account_name;
      if (aliases[acct.account_name]) mappingSource = aliases[acct.account_name];
      const mapping = resolveMapping(mappingSource) || resolveMapping(acct.account_name);
      if (!mapping) continue;
      const opening = acct.opening_balance ?? 0;
      if (!opening) continue;
      amounts[mapping.code] = (amounts[mapping.code] || 0) + opening;
    }

    // ─── PY CHANGES IN INVENTORIES (dual-post for PY) ─────────────────────
    // CY computedAmounts dual-posts each inventory ledger into:
    //   - BS_CA_INV (closing balance)
    //   - PL_EXP_CII / NCE_CII (opening − closing)
    // PY needs the same dual-post but shifted one year back:
    //   - PY BS = CY opening_balance (already aggregated above)
    //   - PY P&L Changes = PY-1 closing − PY closing
    //                    = (PY shell's opening_balance) − (CY's opening_balance)
    // The PY shell's opening_balance column encodes PY-1 closing balance.
    // Without this dual-post the PY column for "Changes in Inventories"
    // stayed blank even when both CY TB opening and PY shell TB opening were
    // available. Universal across every NCE/corporate client.
    const pyShellRows = pyShellTbData?.tbRows as any[] | undefined;
    if (pyShellRows && pyShellRows.length) {
      // Build a PY-shell lookup keyed by lowercase ledger name → signed opening
      // balance (PY-1 closing). Sign: Dr → +, Cr → −, matching how the BS
      // sign convention is encoded on CY TB (closing balance for inventory
      // ledgers is normally Dr = +).
      const pyShellPrevClose: Record<string, number> = {};
      for (const row of pyShellRows) {
        const name = String(row.ledger_name || "").trim().toLowerCase();
        if (!name) continue;
        const ob = Math.abs(Number(row.opening_balance ?? 0));
        if (ob < 0.005) continue;
        // Debit-positive opening via shared module.
        pyShellPrevClose[name] = signedOpening(ob, row.opening_type, "DR");
      }
      // For every CY tbAccount mapped to an inventory code, dual-post the
      // PY Changes-in-Inv contribution.
      for (const acct of tbAccounts) {
        const mapping = resolveMapping(acct.account_name);
        if (!mapping) continue;
        const plCode = INV_DUAL_MAP[mapping.code];
        if (!plCode) continue;
        const pyClose = acct.opening_balance ?? 0;             // PY closing = CY opening
        const prev    = pyShellPrevClose[acct.account_name.toLowerCase()] ?? 0; // PY-1 closing
        if (Math.abs(prev) < 0.005 && Math.abs(pyClose) < 0.005) continue;
        // Changes = opening − closing (matches CY convention at line 1633)
        amounts[plCode] = (amounts[plCode] || 0) + (prev - pyClose);
      }
    }
    const computeTotal = (item: FSLineItem): number => {
      if (!item.children || item.children.length === 0) return amounts[item.code] || 0;
      const total = item.children.reduce((sum, child) => sum + computeTotal(child), 0);
      amounts[item.code] = total;
      return total;
    };
    for (const item of activeTree) computeTotal(item);

    // ── NCE P&L profit chain (V → XIII) for the PY column ───────────────────
    // Same subtraction chain as CY so the COA Mapping PY column shows the
    // derived NCE profit subtotals instead of blanks.
    if (isNonCorporate) {
      const nceInc = amounts["NCE_PL_INC"] || 0;
      const nceExp = amounts["NCE_PL_EXP"] || 0;
      amounts["NCE_PROF_V"]   = Math.round((-nceInc - nceExp) * 100) / 100;
      amounts["NCE_PROF_VII"] = Math.round((amounts["NCE_PROF_V"]   - (amounts["NCE_EXCEP"]    || 0)) * 100) / 100;
      amounts["NCE_PROF_IX"]  = Math.round((amounts["NCE_PROF_VII"] - (amounts["NCE_EXTORD"]   || 0)) * 100) / 100;
      amounts["NCE_PROF_XI"]  = Math.round((amounts["NCE_PROF_IX"]  - (amounts["NCE_PART_REM"] || 0)) * 100) / 100;
      amounts["NCE_NET_PROF"] = Math.round((amounts["NCE_PROF_XI"]  - (amounts["NCE_TAX"]      || 0)) * 100) / 100;
    }

    // ── Auto-credit PY net profit — CORPORATE ONLY ──────────────────────────
    // Same as CY: NCE entities do NOT get PY auto-credit.
    if (!isNonCorporate) {
      const pyRev   = pyAmounts["PL_REV"] || 0;
      const pyExp   = pyAmounts["PL_EXP"] || 0;
      const pyNetPL = Math.round((-pyRev - pyExp) * 100) / 100;
      if (Math.abs(pyNetPL) > 0.005) {
        amounts["BS_EQ_RS"] = (amounts["BS_EQ_RS"] || 0) - pyNetPL;
        for (const item of activeTree) computeTotal(item);
      }
    }

    return amounts;
  }, [tbAccounts, coaMapping, isNonCorporate, pyAmounts, activeTree, pyShellTbData?.tbRows]);

  // ═══════ PY SHELL P&L AMOUNTS ═══════
  // When a PY shell engagement exists, compute P&L closing amounts from its TB.
  // Opening_balance on CY TB is always ₹0 for P&L accounts (Tally yearly reset),
  // so this is the only way to show PY P&L figures in the Variance Drill.
  const pyShellPLAmounts: Record<string, number> = useMemo(() => {
    if (!pyShellTbData?.tbRows?.length) return {};
    const amounts: Record<string, number> = {};
    // Build a case-insensitive CY mapping index so PY shell ledgers that
    // differ in case ("SALES" vs "Sales") still resolve to a CY FS code.
    const cyMappingLowerIndex: Record<string, { code: string }> = {};
    for (const [k, v] of Object.entries(coaMapping || {})) {
      if (v?.code) cyMappingLowerIndex[k.toLowerCase().trim()] = v;
    }
    const pyShellMapping = (pyShellTbData?.coaMapping as Record<string, any>) || {};
    const pyShellMappingLowerIndex: Record<string, { code: string }> = {};
    for (const [k, v] of Object.entries(pyShellMapping)) {
      if (v?.code) pyShellMappingLowerIndex[k.toLowerCase().trim()] = v;
    }

    // ROOT-CAUSE FIX (Issue 1 — round 3): build a parent_group → FS code map
    // from the CY engagement. When a PY-shell ledger is NOT directly mapped
    // (different ledger name from CY — e.g. PY had "Land Sale", CY has "Sales"),
    // inherit the FS code from any CY ledger that shares the same Tally
    // parent_group ("Sales Accounts" → NCE_REV_OPS). This is exactly how a
    // human auditor would map renamed/replaced revenue & expense ledgers:
    // they go under the same Schedule III head as their accounting group.
    const groupToCode: Record<string, string> = {};
    const groupCodeCount: Record<string, Record<string, number>> = {};
    for (const acct of tbAccounts) {
      const code = (coaMapping as Record<string, any>)[acct.account_name]?.code;
      const grp  = (acct.account_group || "").toLowerCase().trim();
      if (!code || !grp) continue;
      if (!groupCodeCount[grp]) groupCodeCount[grp] = {};
      groupCodeCount[grp][code] = (groupCodeCount[grp][code] || 0) + 1;
    }
    // For each group pick the most-frequent code (only when unambiguous, i.e.
    // no tie with another code that has the same count).
    for (const [grp, codeCounts] of Object.entries(groupCodeCount)) {
      let bestCode = "";
      let bestN = 0;
      let tie = false;
      for (const [code, n] of Object.entries(codeCounts)) {
        if (n > bestN) { bestCode = code; bestN = n; tie = false; }
        else if (n === bestN && code !== bestCode) { tie = true; }
      }
      if (bestCode && !tie) groupToCode[grp] = bestCode;
    }

    for (const row of pyShellTbData.tbRows) {
      const name = String(row.ledger_name || "").trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      const grp   = String((row as any).parent_group || "").toLowerCase().trim();
      // Resolution order:
      //   1. PY-shell exact
      //   2. PY-shell lowercase
      //   3. CY exact
      //   4. CY lowercase
      //   5. Group-level inheritance (PY-shell ledger's parent_group → CY group code)
      let mapping: any =
        pyShellMapping[name] ||
        pyShellMappingLowerIndex[lower] ||
        (coaMapping as Record<string, any>)[name] ||
        cyMappingLowerIndex[lower];
      if (!mapping?.code && grp && groupToCode[grp]) {
        mapping = { code: groupToCode[grp] };
      }
      if (!mapping?.code) continue;
      const item = activeFlatItems.find(i => i.code === mapping.code);
      if (!item) continue;
      const sec = String((item as any).section || "").toLowerCase();
      const isPL =
        sec.includes("pl") || sec.includes("p_l") ||
        sec.includes("revenue") || sec.includes("expense") || sec.includes("income");
      if (!isPL) continue; // BS items handled via opening_balance in computedAmountsPY
      const cb = Math.abs(Number(row.closing_balance ?? 0));
      if (cb < 0.005) continue;
      // Debit-positive contribution to PL face amount via shared module.
      amounts[mapping.code] = (amounts[mapping.code] || 0) + signedBalance(cb, row.balance_type, "DR");
    }
    // ROOT-CAUSE FIX (Stage 6 — PY parent total bug): also inject the
    // PY Changes-in-Inventories dual-post here. Without this, the CII PL
    // leaf in pyShellPLAmounts stays at 0 (no PY-shell ledger maps to
    // PL_EXP_CII directly — inventory ledgers map to BS_CA_INV). Then the
    // render at line ~3421 short-circuits on computedAmountsPY (which only
    // contains the CII contribution at PL parent codes) and ignores
    // pyShellPLAmounts entirely. Mirroring the same dual-post into
    // pyShellPLAmounts gives the FULL P&L PY total: regular P&L sums +
    // CII dual-post, identical to what computedAmountsPY produces for the
    // CII child alone, but with ALL the other P&L children also populated.
    const pyShellPrevClose: Record<string, number> = {};
    for (const row of pyShellTbData?.tbRows || []) {
      const name = String((row as any).ledger_name || "").trim().toLowerCase();
      if (!name) continue;
      const ob = Math.abs(Number((row as any).opening_balance ?? 0));
      if (ob < 0.005) continue;
      // Debit-positive opening via shared module.
      pyShellPrevClose[name] = signedOpening(ob, (row as any).opening_type, "DR");
    }
    for (const acct of tbAccounts) {
      const mapping = coaMapping[acct.account_name];
      if (!mapping) continue;
      const plCode = INV_DUAL_MAP[mapping.code];
      if (!plCode) continue;
      const pyClose = acct.opening_balance ?? 0;
      const prev    = pyShellPrevClose[acct.account_name.toLowerCase()] ?? 0;
      if (Math.abs(prev) < 0.005 && Math.abs(pyClose) < 0.005) continue;
      amounts[plCode] = (amounts[plCode] || 0) + (prev - pyClose);
    }

    // Roll up parent P&L nodes
    const computeParent = (item: FSLineItem): number => {
      if (!item.children || item.children.length === 0) return amounts[item.code] || 0;
      const total = item.children.reduce((sum, child) => sum + computeParent(child), 0);
      if (total !== 0) amounts[item.code] = total;
      return total;
    };
    for (const item of activeTree) computeParent(item);

    // ── NCE P&L profit chain (V → XIII) for the PRIOR-YEAR column ───────────
    // The COA Mapping PY column reads P&L figures from pyShellPLAmounts (P&L
    // opening balances are always 0, so PY P&L can only come from the PY-shell
    // TB). computeParent only sums additive parents (NCE_PL_INC/EXP/TAX); the
    // subtraction subtotals V/VII/IX/XI/XIII are leaf codes and stayed blank in
    // the PY column even though CY computed fine. Compute them here from the
    // PY-shell income/expense so the prior-year profit chain auto-populates.
    if (isNonCorporate) {
      const inc = amounts["NCE_PL_INC"] || 0; // negative (credit)
      const exp = amounts["NCE_PL_EXP"] || 0; // positive (debit)
      amounts["NCE_PROF_V"]   = Math.round((-inc - exp) * 100) / 100;
      amounts["NCE_PROF_VII"] = Math.round((amounts["NCE_PROF_V"]   - (amounts["NCE_EXCEP"]    || 0)) * 100) / 100;
      amounts["NCE_PROF_IX"]  = Math.round((amounts["NCE_PROF_VII"] - (amounts["NCE_EXTORD"]   || 0)) * 100) / 100;
      amounts["NCE_PROF_XI"]  = Math.round((amounts["NCE_PROF_IX"]  - (amounts["NCE_PART_REM"] || 0)) * 100) / 100;
      amounts["NCE_NET_PROF"] = Math.round((amounts["NCE_PROF_XI"]  - (amounts["NCE_TAX"]      || 0)) * 100) / 100;
    }
    return amounts;
  }, [pyShellTbData, coaMapping, tbAccounts, activeFlatItems, activeTree, isNonCorporate]);

  // ═══════ CORPORATE P&L CALCULATED TOTALS (PBT / PAT) ═══════
  // Derives Profit Before Tax and Profit After Tax directly from the current
  // COA mapping so the P&L tab of the right panel can show these calculated
  // rows even when no ledger is explicitly mapped to PL_PAT.
  // Only relevant for corporate entities — NCE has its own profit chain.
  const coaPLCalc = useMemo(() => {
    if (isNonCorporate) return null;
    const cy = (code: string) => computedAmounts[code] || 0;
    const py = (code: string) => pyShellPLAmounts[code] || pyAmounts[code] || 0;

    // Revenue is stored as Cr-negative in Tally; negate to get positive income
    const revCY = -(cy("PL_REV_OPS") + cy("PL_REV_OI"));
    const revPY = -(py("PL_REV_OPS") + py("PL_REV_OI"));
    // Expenses stored as Dr-positive
    const expCY = cy("PL_EXP_MAT") + cy("PL_EXP_SIT") + cy("PL_EXP_CII")
                + cy("PL_EXP_EMP") + cy("PL_EXP_FIN") + cy("PL_EXP_DEP") + cy("PL_EXP_OTH");
    const expPY = py("PL_EXP_MAT") + py("PL_EXP_SIT") + py("PL_EXP_CII")
                + py("PL_EXP_EMP") + py("PL_EXP_FIN") + py("PL_EXP_DEP") + py("PL_EXP_OTH");
    // Exceptional items (Dr-positive)
    const eiCY = cy("PL_EI");
    const eiPY = py("PL_EI");
    // Profit Before Tax = Income − Expenses − Exceptional Items
    const pbtCY = Math.round((revCY - expCY - eiCY) * 100) / 100;
    const pbtPY = Math.round((revPY - expPY - eiPY) * 100) / 100;
    // Tax expense (Dr-positive)
    const taxCY = cy("PL_TAX_CUR") + cy("PL_TAX_DEF");
    const taxPY = py("PL_TAX_CUR") + py("PL_TAX_DEF");
    // Profit After Tax = PBT − Tax
    const patCY = Math.round((pbtCY - taxCY) * 100) / 100;
    const patPY = Math.round((pbtPY - taxPY) * 100) / 100;

    return { pbtCY, pbtPY, patCY, patPY };
  }, [isNonCorporate, computedAmounts, pyShellPLAmounts, pyAmounts]);

  // ═══════ PY SHELL LEDGER AMOUNTS (per-ledger) ═══════
  // Maps ledger_name → signed closing_balance from PY shell TB.
  // Used by the Variance Drill modal to show PY amounts per ledger
  // (the FS-level pyShellPLAmounts aggregates to code level, not ledger level).
  // For BS ledgers, CY opening_balance already gives the PY figure — this only
  // provides data for P&L ledgers where opening = 0.
  //
  // ROOT-CAUSE FIX (Issue 1): exact-name lookup fails whenever the PY shell
  // ledger differs from the CY ledger by case, whitespace, punctuation, or
  // common suffixes ("Sales" vs "Sales A/c" vs "SALES "). When that happens
  // the PY column displays "—" even though the same balance is sitting in
  // tally_trial_balance. We now build BOTH an exact-name map AND a
  // normalised-name map, and the lookup helper tries: exact → trimmed-lower
  // → fully-normalised (alphanumerics only, strip "ac/account" noise words).
  // This makes the PY lookup resilient across every client that has
  // sync-py.bat data without requiring manual aliases.
  const pyShellLedgerAmounts: Record<string, number> = useMemo(() => {
    if (!pyShellTbData?.tbRows?.length) return {};
    const map: Record<string, number> = {};
    for (const row of pyShellTbData.tbRows) {
      const name = String(row.ledger_name || "").trim();
      if (!name) continue;
      const cb = Math.abs(Number(row.closing_balance ?? 0));
      if (cb < 0.005) continue;
      // Debit-positive PY closing via shared module.
      map[name] = signedBalance(cb, row.balance_type, "DR");
    }
    return map;
  }, [pyShellTbData]);

  // Normalised-name index → signed PY closing balance. Built alongside
  // pyShellLedgerAmounts so the lookup helper can fall back when the exact
  // CY ledger name doesn't appear in PY shell TB.
  const pyShellLedgerNormalized: Record<string, number> = useMemo(() => {
    if (!pyShellTbData?.tbRows?.length) return {};
    const map: Record<string, number> = {};
    for (const row of pyShellTbData.tbRows) {
      const name = String(row.ledger_name || "").trim();
      if (!name) continue;
      const cb = Math.abs(Number(row.closing_balance ?? 0));
      if (cb < 0.005) continue;
      // Debit-positive PY closing via shared module.
      const signed = signedBalance(cb, row.balance_type, "DR");
      // (a) lowercase + trim   (b) fully normalised (alnum-only)
      const lower = name.toLowerCase();
      if (!(lower in map)) map[lower] = signed;
      const norm = lower
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(a c|ac|account|accounts|a\/c)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (norm && !(norm in map)) map[norm] = signed;
    }
    return map;
  }, [pyShellTbData]);

  /** Robust PY-shell amount lookup for a CY ledger name. Tries exact match,
   *  then lowercase-trim, then fully normalised name. Returns 0 when none of
   *  the variants exist in the PY shell TB. */
  const lookupPyShellAmount = useCallback((cyName: string): number => {
    if (!cyName) return 0;
    const exact = pyShellLedgerAmounts[cyName];
    if (exact !== undefined) return exact;
    const lower = cyName.toLowerCase().trim();
    const byLower = pyShellLedgerNormalized[lower];
    if (byLower !== undefined) return byLower;
    const norm = lower
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(a c|ac|account|accounts|a\/c)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return pyShellLedgerNormalized[norm] ?? 0;
  }, [pyShellLedgerAmounts, pyShellLedgerNormalized]);

  // ═══════ FS LEDGER SEARCH ═══════
  // When the user types in the right-panel search box, build a flat result list:
  // each entry = { ledger name, FS item code, FS item name, depth breadcrumb, confidence }
  const fsSearchResults = useMemo(() => {
    const q = fsSearch.trim().toLowerCase();
    if (!q) return null;

    // Build code → full breadcrumb path  e.g. "NCE_CASH" → "Current Assets → Cash and bank"
    const breadcrumb: Record<string, string> = {};
    const buildCrumb = (items: FSLineItem[], ancestors: string[]) => {
      for (const item of items) {
        const path = [...ancestors, item.name];
        breadcrumb[item.code] = path.join(" › ");
        if (item.children?.length) buildCrumb(item.children, path);
      }
    };
    buildCrumb(activeTree, []);

    const results: {
      ledger: string;
      fsCode: string;
      fsName: string;
      breadcrumb: string;
      confidence: string;
      balance: number;
    }[] = [];

    for (const acc of tbAccounts) {
      const mapping = coaMapping[acc.account_name];
      if (!mapping?.code) continue; // unmapped — skip
      const fsItem = activeFlatItems.find(i => i.code === mapping.code);
      if (!fsItem) continue;

      // Match against ledger name OR fs head name
      const matchesLedger = acc.account_name.toLowerCase().includes(q);
      const matchesHead   = fsItem.name.toLowerCase().includes(q) || breadcrumb[mapping.code]?.toLowerCase().includes(q);
      if (!matchesLedger && !matchesHead) continue;

      results.push({
        ledger:     acc.account_name,
        fsCode:     mapping.code,
        fsName:     fsItem.name,
        breadcrumb: breadcrumb[mapping.code] || fsItem.name,
        confidence: mapping.confidence || "low",
        balance:    acc.balance ?? 0,
      });
    }

    // Sort: ledger matches first, then head matches
    results.sort((a, b) => {
      const aLed = a.ledger.toLowerCase().includes(q) ? 0 : 1;
      const bLed = b.ledger.toLowerCase().includes(q) ? 0 : 1;
      return aLed - bLed || a.ledger.localeCompare(b.ledger);
    });

    return results;
  }, [fsSearch, tbAccounts, coaMapping, activeFlatItems, activeTree]);

  // ═══════ OPENING-TB BALANCE CHECK (Task 2) ═══════
  // Sum opening Dr vs Cr directly from tallyTb (authoritative source).
  // Only shown when using Tally Sync data; if tbSnapshot/tbLeafNodes path is active,
  // tallyTb is empty and we skip the banner entirely.
  const openingTbDiff = useMemo(() => {
    if (!tallyTb?.length) return 0;
    const dr = (tallyTb as any[]).reduce((s, l) =>
      String(l.opening_type ?? "").toUpperCase() === "DR" ? s + Math.abs(Number(l.opening_balance ?? 0)) : s, 0);
    const cr = (tallyTb as any[]).reduce((s, l) =>
      String(l.opening_type ?? "").toUpperCase() === "CR" ? s + Math.abs(Number(l.opening_balance ?? 0)) : s, 0);
    return Math.round((dr - cr) * 100) / 100;
  }, [tallyTb]);
  const openingTbImbalanced = Math.abs(openingTbDiff) >= 1;

  // ═══════ VARIANCE DRILL-DOWN (Task 4) ═══════
  // For a given FS code, list the mapped ledgers with CY/PY/Δ so the auditor
  // can see exactly which ledgers drove the variance. Used by the drill modal.
  const varianceDrillRows = useMemo(() => {
    if (!varianceDrill) return [];
    const rows = tbAccounts
      .filter(a => {
        const src = aliases[a.account_name] ? aliases[a.account_name] : a.account_name;
        const mapping = coaMapping[src] || coaMapping[a.account_name];
        return mapping?.code === varianceDrill.code;
      })
      .map(a => {
        const cy = a.balance;
        // PY: prefer PY shell closing_balance (for P&L accounts where opening=0);
        // fall back to opening_balance on CY TB (correct for BS accounts).
        // Use the fuzzy helper so case/whitespace/A-c differences don't blank PY.
        const pyFromShell = lookupPyShellAmount(a.account_name);
        const py = Math.abs(pyFromShell) > 0.005
          ? pyFromShell
          : (a.opening_balance ?? 0);
        return {
          ledger: a.account_name,
          group: a.account_group || "",
          cy, py,
          delta: cy - py,
          pct: Math.abs(py) > 0.005 ? Math.round(((cy - py) / Math.abs(py)) * 100) : (Math.abs(cy) > 0.005 ? 100 : 0),
          isNew:    Math.abs(py) < 0.005 && Math.abs(cy) >= 0.005,
          isClosed: Math.abs(py) >= 0.005 && Math.abs(cy) < 0.005,
          isAlias:  !!aliases[a.account_name],
          isPyOnly: false as boolean,
        };
      });

    // ROOT-CAUSE FIX (Issue 1 — round 3): also include PY-shell ledgers that
    // are mapped (in PY shell's own coa_mapping, or via group inheritance)
    // to the same FS code but DO NOT exist in CY by any name. Without this,
    // a renamed/replaced revenue ledger (PY: "Land Sale" → NCE_REV_OPS;
    // CY: "Sales" → NCE_REV_OPS) would never surface its PY ₹4.90 cr in
    // the Variance Drill, even though pyShellPLAmounts correctly aggregates
    // it at the FS-code level.
    const cySeenLower = new Set(tbAccounts.map(a => a.account_name.toLowerCase().trim()));
    const pyShellMapping = (pyShellTbData?.coaMapping as Record<string, any>) || {};
    const pyShellMappingLowerIndex: Record<string, { code: string }> = {};
    for (const [k, v] of Object.entries(pyShellMapping)) {
      if (v?.code) pyShellMappingLowerIndex[k.toLowerCase().trim()] = v;
    }
    // Reuse the same group → code inheritance used by pyShellPLAmounts.
    const groupToCode: Record<string, string> = {};
    const groupCodeCount: Record<string, Record<string, number>> = {};
    for (const acct of tbAccounts) {
      const code = coaMapping[acct.account_name]?.code;
      const grp  = (acct.account_group || "").toLowerCase().trim();
      if (!code || !grp) continue;
      if (!groupCodeCount[grp]) groupCodeCount[grp] = {};
      groupCodeCount[grp][code] = (groupCodeCount[grp][code] || 0) + 1;
    }
    for (const [grp, codeCounts] of Object.entries(groupCodeCount)) {
      let bestCode = ""; let bestN = 0; let tie = false;
      for (const [code, n] of Object.entries(codeCounts)) {
        if (n > bestN) { bestCode = code; bestN = n; tie = false; }
        else if (n === bestN && code !== bestCode) { tie = true; }
      }
      if (bestCode && !tie) groupToCode[grp] = bestCode;
    }
    for (const row of (pyShellTbData?.tbRows ?? []) as any[]) {
      const name = String(row.ledger_name || "").trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      if (cySeenLower.has(lower)) continue; // already covered by CY iteration
      const grp = String((row.parent_group || "")).toLowerCase().trim();
      const m =
        pyShellMapping[name] ||
        pyShellMappingLowerIndex[lower] ||
        coaMapping[name] ||
        (grp && groupToCode[grp] ? { code: groupToCode[grp] } : null);
      if (m?.code !== varianceDrill.code) continue;
      const cb = Math.abs(Number(row.closing_balance ?? 0));
      if (cb < 0.005) continue;
      // Debit-positive PY-only ledger amount via shared module.
      const py = signedBalance(cb, row.balance_type, "DR");
      rows.push({
        ledger: name,
        group: row.parent_group || "",
        cy: 0,
        py,
        delta: -py,
        pct: -100,
        isNew: false,
        isClosed: true,
        isAlias: false,
        isPyOnly: true,
      });
    }
    rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return rows;
  }, [varianceDrill, tbAccounts, coaMapping, aliases, pyShellLedgerAmounts, lookupPyShellAmount, pyShellTbData]);

  // ═══════ ALIAS HANDLERS (Task 3) ═══════
  const saveAlias = async (priorName: string, currentName: string) => {
    if (!engagement?.client_id) return;
    const { error } = await (supabase.from as any)("ledger_aliases")
      .upsert({
        client_id:           engagement.client_id,
        firm_id:             engagement.firm_id || null,
        engagement_id:       engagementId,
        prior_ledger_name:   priorName,
        current_ledger_name: currentName,
      }, { onConflict: "client_id,prior_ledger_name" });
    if (error) { toast.error(error.message); return; }
    toast.success(`Linked "${priorName}" → "${currentName}"`);
    setAliasDialog(null);
    refetchAliases();
  };
  const removeAlias = async (priorName: string) => {
    if (!engagement?.client_id) return;
    const { error } = await (supabase.from as any)("ledger_aliases")
      .delete()
      .eq("client_id", engagement.client_id)
      .eq("prior_ledger_name", priorName);
    if (error) { toast.error(error.message); return; }
    toast.success("Alias removed");
    refetchAliases();
  };

  // ═══════ STATS ═══════
  const mappedCount = tbAccounts.filter(a => coaMapping[a.account_name]).length;
  const unmappedCount = tbAccounts.length - mappedCount;
  const allMapped = unmappedCount === 0 && tbAccounts.length > 0;

  // ─── Confidence bucket breakdown ───
  const bucketCounts = useMemo(() => {
    let carriedForward = 0, confirmed = 0, aiMapped = 0, autoMapped = 0, needsReview = 0, unmapped = 0;
    for (const acct of tbAccounts) {
      const m = coaMapping[acct.account_name];
      if (!m)                                                  { unmapped++;       continue; }
      if (m.confidence === "carried_forward")                  { carriedForward++; continue; }
      if (m.confidence === "manual")                           { confirmed++;      continue; }
      if (m.confidence === "ai")                               { aiMapped++;       continue; }
      if (m.confidence === "high" || m.confidence === "medium"){ autoMapped++;     continue; }
      needsReview++; // low
    }
    const total = tbAccounts.length || 1;
    const pct = (n: number) => Math.round((n / total) * 100);
    return { carriedForward, confirmed, aiMapped, autoMapped, needsReview, unmapped, total, pct };
  }, [tbAccounts, coaMapping]);

  // Filtered accounts — respect hideZero + search + workMode (PY/CY/Closed)
  const filteredAccounts = useMemo(() => {
    const s = search.toLowerCase();
    return tbAccounts.filter(a => {
      const opening  = a.opening_balance ?? 0;
      const closing  = a.balance;
      const hasOpen  = Math.abs(opening) >= 0.005;
      const hasClose = Math.abs(closing) >= 0.005;
      const hasTurnover = Math.abs(a.tally_debit ?? 0) >= 0.005 || Math.abs(a.tally_credit ?? 0) >= 0.005;
      // hideZero: hide only accounts with no balance AND no turnover.
      // Exceptions:
      //   • "All Unmapped" mode — always show unmapped ledgers even with ₹0
      //     so the auditor can find and map them.
      //   • "Closed Accounts" mode — dormant ledgers are EXACTLY what this tab
      //     is meant to surface, so never hide them.
      const isUnmapped = !coaMapping[a.account_name];
      if (
        hideZero && !hasOpen && !hasClose && !hasTurnover &&
        !(workMode === "all" && isUnmapped) &&
        workMode !== "closed"
      ) return false;

      // Workflow-mode narrowing
      // "closed" now means truly dormant: opening = 0 AND closing = 0 AND no
      // turnover. This covers both BS ledgers brought forward at ₹0 still at
      // ₹0 and P&L ledgers with no debit / credit transactions during the
      // year — the auditor's standard "ledgers I can safely ignore" bucket.
      if (workMode === "closed" && (hasOpen || hasClose || hasTurnover)) return false;
      // "all" mode: include everything not excluded above (incl. turnover-only and ₹0 unmapped)

      if (!s) return true;
      return (
        a.account_name.toLowerCase().includes(s) ||
        a.account_group.toLowerCase().includes(s)
      );
    });
  }, [tbAccounts, search, hideZero, workMode, coaMapping]);

  // Left panel = exclusively UNMAPPED ledgers. Mapped ledgers live in the right
  // panel (grouped under their FS code) with ✕ unmap affordances.
  // "Closed" mode is an exception — it shows all matching ledgers (mapped + unmapped)
  // so the auditor can review PY-only impact. Other modes hide already-mapped.
  const unmappedAccounts = useMemo(
    () => workMode === "closed"
      ? filteredAccounts
      : filteredAccounts.filter(a => !coaMapping[a.account_name]),
    [filteredAccounts, coaMapping, workMode],
  );

  // Counts per mode (shown on the segmented control). "closed" is now
  // truly-dormant: no opening, no closing, no debit/credit turnover — covers
  // both BS ledgers brought forward at ₹0 and P&L ledgers with no activity.
  const modeCounts = useMemo(() => {
    let closed = 0, all = 0;
    for (const a of tbAccounts) {
      const hasOpen     = Math.abs(a.opening_balance ?? 0) >= 0.005;
      const hasClose    = Math.abs(a.balance) >= 0.005;
      const hasTurnover = Math.abs(a.tally_debit ?? 0) >= 0.005 || Math.abs(a.tally_credit ?? 0) >= 0.005;
      if (!coaMapping[a.account_name]) all++;
      if (!hasOpen && !hasClose && !hasTurnover) closed++;
    }
    return { closed, all };
  }, [tbAccounts, coaMapping]);

  // Grouped view — keyed by parent_group, aggregated subtotal + mapped/total counts.
  // Computed against UNMAPPED accounts so empty groups (fully mapped) drop out of
  // the left panel automatically.
  const grouped = useMemo(() => {
    const map = new Map<string, {
      group: string;
      items: typeof tbAccounts;
      mapped: number;
      total: number;
      subtotal: number;
      dominantCode: string | null;  // single FS code if all mapped rows agree
    }>();
    for (const a of unmappedAccounts) {
      const key = a.account_group || "— (no group) —";
      if (!map.has(key)) map.set(key, { group: key, items: [], mapped: 0, total: 0, subtotal: 0, dominantCode: null });
      const g = map.get(key)!;
      g.items.push(a);
      g.total++;
      g.subtotal += a.balance;
    }
    // Attach "suggested code" from any already-mapped sibling (learning-by-group)
    for (const [key, g] of map.entries()) {
      const sibling = tbAccounts.find(
        (a) => (a.account_group || "— (no group) —") === key && coaMapping[a.account_name]
      );
      if (sibling) g.dominantCode = coaMapping[sibling.account_name].code;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total || a.group.localeCompare(b.group));
  }, [unmappedAccounts, tbAccounts, coaMapping]);

  // ═══════ SAVE ═══════
  // On save, batch-sync all manual mappings to coa_mapping_intelligence so
  // every confirmed mapping contributes to the cross-client learning pool.
  const saveMapping = async () => {
    setSaving(true);
    try {
      await supabase.from("audit_engagements").update({
        coa_mapping: coaMapping,
      } as any).eq("id", engagementId);

      // Background: sync manual mappings → intelligence table (per-period learning)
      const entityTypeKey = isNonCorporate ? "nce" : "corporate";
      supabase.rpc("sync_engagement_intelligence" as any, {
        p_engagement_id: engagementId,
        p_entity_type:   entityTypeKey,
        p_firm_id:       engagement?.firm_id || null,
        p_client_id:     engagement?.client_id || null,  // scopes party-name patterns to this client
      }).then(({ data: synced }: any) => {
        if (synced > 0) {
          toast.success("Mapping saved", {
            description: `${synced} manual mapping${synced !== 1 ? "s" : ""} added to AI memory`,
          });
        } else {
          toast.success("Mapping saved");
        }
      });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const generateFS = async () => {
    setSaving(true);
    if (unmappedCount > 0) {
      toast.warning(`${unmappedCount} unmapped ledger(s) will be excluded from the Financial Statements.`);
    }
    try {
      // Delete existing FS rows
      await supabase.from("fa_financial_statements").delete().eq("engagement_id", engagementId);

      // Generate new rows
      const rows: any[] = [];
      let sortOrder = 0;

      const addItem = (item: FSLineItem & { depth: number }) => {
        const isManual = !!manualOverrides[item.code];
        // PY source-of-truth:
        //   BS items → sum of opening_balance on CY's own TB (computedAmountsPY)
        //   P&L items → fall back to prior engagement's fa_financial_statements (pyAmounts)
        const isBS = String(item.section || "").toLowerCase().includes("bs") ||
                     String(item.section || "").toLowerCase().includes("asset") ||
                     String(item.section || "").toLowerCase().includes("liab") ||
                     String(item.section || "").toLowerCase().includes("equity");
        const pyFromOpening = computedAmountsPY[item.code] || 0;
        const pyFromPrior   = pyAmounts[item.code]         || 0;
        const pyFromShell   = pyShellPLAmounts[item.code]  || 0;
        const amount_py     = isBS
          ? (Math.abs(pyFromOpening) > 0.005 ? pyFromOpening : (pyFromPrior || pyFromShell || null))
          : (pyFromPrior || pyFromShell || null);

        rows.push({
          engagement_id: engagementId,
          section: item.section,
          line_item_code: item.code,
          line_item_name: item.name,
          note_ref: item.noteRef,
          schedule_ref: item.scheduleRef || null,
          amount_cy: Math.round((computedAmounts[item.code] || 0) * 100) / 100,
          amount_py: amount_py !== null ? Math.round((amount_py as number) * 100) / 100 : null,
          is_manual: isManual,
          override_reason: isManual ? manualOverrides[item.code].reason : null,
          source: isManual ? "manual" : "tb_mapped",
          sort_order: sortOrder++,
        });
      };

      for (const item of activeFlatItems) {
        addItem(item);
      }

      // Insert in batches
      const BATCH = 50;
      for (let i = 0; i < rows.length; i += BATCH) {
        await supabase.from("fa_financial_statements").insert(rows.slice(i, i + BATCH) as any);
      }

      // Save mapping too
      await supabase.from("audit_engagements").update({
        coa_mapping: coaMapping,
      } as any).eq("id", engagementId);

      toast.success("Financial Statements generated — view in Stage 5 Financial Statements");
      queryClient.invalidateQueries({ queryKey: ["fs-rows"] });

      // ── Auto-populate Notes so notes are ready when the user opens Stage 7 ──
      // For NCE: runs nceAutoPopulate which creates all note rows from TB × COA
      // mapping with properly SIGNED amounts (Dr netted against Cr for contra
      // balances). This ensures Note Total = COA Total for every note.
      // For Corporate: runs the existing stage5_notes auto-populate.
      // Runs silently in the background; a failure does not block the user.
      if (isNonCorporate) {
        // WRITE-PROTECTED: NCE notes auto-population from generateFS is
        // disabled to prevent overwriting audit-verified note data. The
        // audit team applies note data via direct DB writes; the UI must
        // never repopulate or upsert nce_financial_notes.
        console.log("[generateFS] NCE notes auto-population SKIPPED (write-protected)");
      } else {
        (async () => {
          try {
            const { loadStage5Notes, saveStage5Notes, autoPopulateNotes } =
              await import("@/lib/notesAutoPopulate");
            const existing = await loadStage5Notes(engagementId);
            const fresh    = await autoPopulateNotes(engagementId, { existing });
            await saveStage5Notes(engagementId, fresh);
          } catch (notesErr: any) {
            console.warn("Notes auto-population failed (non-critical):", notesErr?.message);
          }
        })();
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteStage3 = async () => {
    if (!allMapped) {
      toast.error("All accounts must be mapped before proceeding");
      return;
    }
    await generateFS();
    const newStatuses = { ...(engagement.stage_statuses || {}), "3": "complete" };
    await supabase.from("audit_engagements").update({
      stage_statuses: newStatuses,
      pipeline_stage: Math.max(engagement.pipeline_stage || 3, 4),
    } as any).eq("id", engagementId);
    toast.success("Stage 6 completed");
    onStageComplete();
  };

  // ═══════ RENDER ═══════
  // Guard: engagement prop may be undefined while parent is loading a new engagement
  if (!engagement) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Stage gate: TB data available via any path (snapshot / tb_hierarchy / tally_trial_balance) OR Stage 2 explicitly completed
  const tbDataAvailable = (tallyTb?.length ?? 0) > 0;
  const stage2Complete = (engagement?.pipeline_stage ?? 0) >= 3 ||
    (engagement?.stage_statuses as any)?.["2"] === "complete";

  if (!tallyTbLoading && !tbDataAvailable && !stage2Complete) {
    return (
      <div className="max-w-4xl">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Tally Sync Required</AlertTitle>
          <AlertDescription>Please complete Stage 2 (Tally Sync) before proceeding to COA Mapping.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <EngagementHeader engagement={engagement} stageNumber={6} stageLabel="COA Mapping" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Stage 6 — COA Mapping</h1>
          <p className="text-xs text-muted-foreground">Map every ledger to its financial-statement line item</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button
            variant="outline" size="sm"
            onClick={() => setRulesOpen(true)}
            className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <BookOpen size={13} /> Mapping Instructions
            {mappingRules.length > 0 && (
              <span className="ml-0.5 bg-amber-100 text-amber-800 rounded-full px-1.5 py-0 text-[10px] font-bold">
                {mappingRules.length}
              </span>
            )}
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => {}}
            className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
            title={`AI Memory: ${intelligence.length} patterns loaded`}
          >
            <Brain size={13} /> AI Memory
            <span className="ml-0.5 bg-violet-100 text-violet-800 rounded-full px-1.5 py-0 text-[10px] font-bold">
              {intelligence.length}
            </span>
          </Button>
          <Button variant="outline" size="sm" onClick={saveMapping} disabled={saving}>Save Mapping</Button>
          <Button size="sm" onClick={handleCompleteStage3} disabled={!allMapped || saving} className="gap-1">
            Complete Stage 6 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* Mapping Rules Panel */}
      {engagement?.firm_id && (
        <MappingRulesPanel
          open={rulesOpen}
          onClose={() => setRulesOpen(false)}
          firmId={engagement.firm_id}
          clientId={engagement.client_id || ""}
          entityType={isNonCorporate ? "nce" : "corporate"}
          leafItems={activeLeafItems}
          onRulesChange={(rules) => setMappingRules(rules)}
        />
      )}

      {/* PY Shell info banner — P&L opening balances are always ₹0 by design */}
      {(engagement as any)?.is_py_shell && (
        <Alert className="bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900">
          <AlertDescription className="text-[11px] text-blue-800 dark:text-blue-300">
            <span className="font-semibold">PY Shell — {engagement?.financial_year}:</span>{" "}
            Map all ledgers to their Schedule III line items. The{" "}
            <span className="font-semibold">FY {engagement?.financial_year} (Closing)</span> column shows the actual amounts from Tally —
            these will become the PY comparative figures in the current-year financial statements.
            The prior-year column (one year older) will show ₹0 for P&L accounts — this is normal
            since Tally resets income/expense each year.
          </AlertDescription>
        </Alert>
      )}

      {/* Opening-TB balance banner (Task 2) */}
      {openingTbImbalanced && (
        <Alert className="bg-destructive/5 border-destructive/30">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertTitle className="text-xs">Opening Trial Balance is out of balance</AlertTitle>
          <AlertDescription className="text-[11px]">
            Sum of opening Dr vs Cr differs by{" "}
            <span className="font-mono font-semibold">₹{Math.abs(openingTbDiff).toLocaleString("en-IN")}</span>
            {" "}({openingTbDiff > 0 ? "excess Dr" : "excess Cr"}). PY comparative figures will not tally until this is fixed in Tally.
          </AlertDescription>
        </Alert>
      )}

      {/* Progress Breakdown Bar */}
      <Card>
        <CardContent className="p-3 space-y-2">
          {/* Top row: total counts */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span><span className="font-semibold text-foreground">{tbAccounts.length}</span> ledgers</span>
              <span><span className={cn("font-semibold", allMapped ? "text-primary" : "text-foreground")}>{mappedCount}</span> mapped</span>
              {unmappedCount > 0 && (
                <span><span className="font-semibold text-destructive">{unmappedCount}</span> unmapped</span>
              )}
              {allMapped && <Badge className="text-[9px] px-1.5 bg-primary/10 text-primary border-primary/30">✓ All mapped</Badge>}
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {tbAccounts.length > 0 ? Math.round((mappedCount / tbAccounts.length) * 100) : 0}% complete
            </span>
          </div>

          {/* Segmented progress bar */}
          {tbAccounts.length > 0 && (
            <div className="flex h-2.5 rounded-full overflow-hidden bg-muted/40 gap-px">
              {bucketCounts.carriedForward > 0 && (
                <div title={`Carried Forward: ${bucketCounts.carriedForward}`}
                  style={{ width: `${bucketCounts.pct(bucketCounts.carriedForward)}%` }}
                  className="bg-amber-400 dark:bg-amber-500 transition-all" />
              )}
              {bucketCounts.confirmed > 0 && (
                <div title={`Confirmed (manual): ${bucketCounts.confirmed}`}
                  style={{ width: `${bucketCounts.pct(bucketCounts.confirmed)}%` }}
                  className="bg-violet-400 dark:bg-violet-500 transition-all" />
              )}
              {bucketCounts.aiMapped > 0 && (
                <div title={`AI Mapped: ${bucketCounts.aiMapped}`}
                  style={{ width: `${bucketCounts.pct(bucketCounts.aiMapped)}%` }}
                  className="bg-purple-400 dark:bg-purple-500 transition-all" />
              )}
              {bucketCounts.autoMapped > 0 && (
                <div title={`Auto Mapped: ${bucketCounts.autoMapped}`}
                  style={{ width: `${bucketCounts.pct(bucketCounts.autoMapped)}%` }}
                  className="bg-primary/70 transition-all" />
              )}
              {bucketCounts.needsReview > 0 && (
                <div title={`Needs Review (low confidence): ${bucketCounts.needsReview}`}
                  style={{ width: `${bucketCounts.pct(bucketCounts.needsReview)}%` }}
                  className="bg-amber-200 dark:bg-amber-800 transition-all" />
              )}
              {bucketCounts.unmapped > 0 && (
                <div title={`Unmapped: ${bucketCounts.unmapped}`}
                  style={{ width: `${bucketCounts.pct(bucketCounts.unmapped)}%` }}
                  className="bg-destructive/40 transition-all" />
              )}
            </div>
          )}

          {/* Legend chips */}
          <div className="flex flex-wrap gap-2 text-[10px]">
            {bucketCounts.carriedForward > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-amber-700 dark:text-amber-400">🔁 Carried Forward ({bucketCounts.carriedForward})</span>
              </span>
            )}
            {bucketCounts.confirmed > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-violet-400" />
                <span className="text-violet-700 dark:text-violet-400">✎ Confirmed ({bucketCounts.confirmed})</span>
              </span>
            )}
            {bucketCounts.aiMapped > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-purple-400" />
                <span className="text-purple-700 dark:text-purple-400">🤖 AI ({bucketCounts.aiMapped})</span>
              </span>
            )}
            {bucketCounts.autoMapped > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-primary/70" />
                <span className="text-primary">⚡ Auto ({bucketCounts.autoMapped})</span>
              </span>
            )}
            {bucketCounts.needsReview > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-200 dark:bg-amber-700" />
                <span className="text-amber-600">⚠ Needs Review ({bucketCounts.needsReview})</span>
              </span>
            )}
            {bucketCounts.unmapped > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-destructive/50" />
                <span className="text-destructive">✗ Unmapped ({bucketCounts.unmapped})</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* COA Mapping (Financial Statements moved to Stage 5) */}
      <Tabs defaultValue="mapping">
        <TabsList>
          <TabsTrigger value="mapping" className="gap-1.5"><Link2 size={14} /> COA Mapping</TabsTrigger>
        </TabsList>

        {/* ═══════ COA MAPPING TAB ═══════ */}
        <TabsContent value="mapping" className="mt-4">
          {/* Empty PY-shell warning — when py_source='py_shell' is set on the
              CY engagement but the PY shell has no synced TB rows, every
              P&L PY value will render blank. Tell the user exactly why and
              what to do, instead of letting them debug it ledger-by-ledger. */}
          {(engagement as any)?.py_source === "py_shell" && !pyShellTbData?.tbRows?.length && (
            <Alert className="mb-3 border-red-300 bg-red-50/60 dark:bg-red-950/20">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertTitle className="text-xs text-red-800 dark:text-red-300">
                PY shell is empty — no PY P&L values available
              </AlertTitle>
              <AlertDescription className="text-[11px] text-red-700 dark:text-red-400 space-y-1">
                <div>
                  This engagement is configured to source PY figures from a PY shell
                  (FY {(() => { const p = (engagement?.financial_year || "").split("-"); return p.length === 2 ? `${parseInt(p[0])-1}-${String(parseInt(p[0])).slice(-2)}` : "FY-1"; })()}),
                  but that PY shell has zero <code>tally_trial_balance</code> / <code>tally_ledgers</code> / <code>tally_vouchers</code> rows.
                  Balance Sheet PY values you may see come from the previously-saved <code>fa_financial_statements</code>; P&L PY values cannot be reconstructed without synced movements.
                </div>
                <div>
                  <b>To populate PY P&L:</b> open Tally on your PC, press <code className="bg-red-100 dark:bg-red-900/30 px-1 rounded">F2</code>,
                  set period to <b>01-Apr to 31-Mar of FY-1</b>, press <kbd>Esc</kbd> back to Gateway,
                  then run <code className="bg-red-100 dark:bg-red-900/30 px-1 rounded">sync-py.bat</code> from
                  <code className="bg-red-100 dark:bg-red-900/30 px-1 rounded"> C:\team-package</code>. After it completes,
                  refresh this page — the PY columns will populate automatically.
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Workflow segmented control — only Closed + All Unmapped.
              The earlier "Prior Year" / "Current Year (new)" tabs were
              redundant once the Mapping Instructions / hideZero filters were
              available; auditors only need a way to (a) review dormant
              ledgers in bulk (Closed) and (b) see everything still pending
              (All Unmapped). */}
          <div className="flex items-stretch gap-0 mb-3 border rounded-md overflow-hidden">
            {([
              { key: "closed", label: "Closed Accounts",    hint: "opening = 0, closing = 0 (P&L: no debit/credit)", count: modeCounts.closed, color: "bg-slate-100 text-slate-700 dark:bg-slate-900/60 dark:text-slate-300" },
              { key: "all",    label: "All Unmapped",       hint: "every unmapped ledger", count: modeCounts.all,   color: "bg-violet-100 text-violet-800 dark:bg-violet-950/30 dark:text-violet-200" },
            ] as const).map((m, i) => (
              <button
                key={m.key}
                onClick={() => setWorkMode(m.key)}
                className={cn(
                  "flex-1 px-3 py-2 text-xs text-left transition-colors",
                  i > 0 && "border-l",
                  workMode === m.key ? m.color + " font-semibold" : "hover:bg-muted/50 text-muted-foreground"
                )}
              >
                <div className="flex items-center justify-between">
                  <span>{m.label}</span>
                  <Badge variant="outline" className={cn("text-[9px] px-1 ml-2", workMode === m.key && "border-current")}>{m.count}</Badge>
                </div>
                <p className={cn("text-[10px] mt-0.5", workMode === m.key ? "opacity-80" : "opacity-60")}>{m.hint}</p>
              </button>
            ))}
          </div>

          {/* ── Full-screen mapping workspace ── */}
          <div className={cn(fullScreen && "fixed inset-0 z-50 bg-background flex flex-col p-3 overflow-hidden")}>

          {/* Workflow-mode guidance banner */}
          {workMode === "closed" && (
            <Alert className="mb-3 bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700">
              <AlertTriangle className="h-4 w-4 text-slate-600" />
              <AlertTitle className="text-xs">Closed Accounts Review</AlertTitle>
              <AlertDescription className="text-[11px]">
                These ledgers are fully dormant — opening = 0, closing = 0, and no debit/credit transactions during the year. They include BS ledgers brought forward at ₹0 and P&L ledgers with no activity. Safe to leave unmapped if confirmed.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2 mb-3 flex-wrap items-center">
            {/* Auto-Map All removed per user request — AI Map Remaining is
                the canonical mapping action. Naïve keyword auto-map was
                producing too many false matches that auditors had to undo. */}
            <Button size="sm" onClick={runAiMapping} disabled={aiRunning} className="gap-1 bg-violet-600 hover:bg-violet-700 text-white">
              {aiRunning ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              {aiRunning ? "AI Mapping…" : "AI Map Remaining"}
            </Button>
            <Button variant="outline" size="sm" onClick={importPriorMapping} className="gap-1">
              <Download size={12} /> Import Prior Year
            </Button>
            {selectedAccount && coaMapping[selectedAccount] && (
              <Button variant="outline" size="sm" onClick={() => mapSimilar(selectedAccount)} className="gap-1">
                <Link2 size={12} /> Map Similar
              </Button>
            )}
            {selectedAccount && coaMapping[selectedAccount] && (
              <Button variant="outline" size="sm" onClick={() => unmapAccount(selectedAccount)} className="gap-1 text-destructive border-destructive/40 hover:bg-destructive/10">
                Unmap Selected
              </Button>
            )}

            <div className="flex items-center gap-2 ml-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Switch checked={hideZero}  onCheckedChange={setHideZero}  />
                <span>Hide ₹0</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Switch checked={groupView} onCheckedChange={setGroupView} />
                <span>Group by Tally group</span>
              </label>
            </div>

            <div className="ml-auto flex gap-1 items-center">
              <Button
                variant="outline" size="sm"
                onClick={() => setFullScreen(f => !f)}
                className="gap-1 border-primary/40 text-primary hover:bg-primary/10"
                title={fullScreen ? "Exit full screen (Esc)" : "Full screen — maximize mapping workspace"}
              >
                {fullScreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                {fullScreen ? "Exit Full Screen" : "Full Screen"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => unmapByConfidence("low")}    className="text-amber-700 gap-1">Unmap Low</Button>
              <Button variant="ghost" size="sm" onClick={() => unmapByConfidence("medium")} className="text-amber-700 gap-1">Unmap Medium</Button>
              {/* Issue 5 (Aesha) — Clear All needs a proper confirm dialog
                  so it can't be triggered accidentally. The action zeros
                  out coa_mapping AND stage5_notes / stage7_ratios so the
                  Financial Statements truly start from scratch. */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-destructive gap-1">Clear All</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear all mappings AND reset financials?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will <strong>delete every COA mapping</strong> for this engagement
                      AND <strong>reset all Financial Statements to zero</strong> — Stage 5 Notes,
                      Stage 7 Ratios, every BS/PL override, and every PY manual amount.
                      <br /><br />
                      Use this when you want a complete clean slate (mapping → notes → financials).
                      You will need to re-map and re-populate the notes from scratch.
                      This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={clearAllMappings}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Yes, clear everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resetting || aiRunning || !tbAccounts.length}
                    className="gap-1 text-destructive border-destructive/40 hover:bg-destructive/10"
                  >
                    {resetting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Reset & Re-map
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset all COA mappings?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will <strong>delete every mapping</strong> for this engagement (including manually confirmed ones) and immediately re-run auto-mapping + AI from scratch using the latest Tally data.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={resetAndRemap}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Yes, reset & re-map
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <div className="flex gap-4" style={{ height: fullScreen ? "calc(100vh - 9rem)" : "calc(100vh - 22rem)" }}>
            {/* Left: UNMAPPED TB Accounts — mapping workspace */}
            <div className={cn("flex flex-col border rounded-lg overflow-hidden transition-all", maximizedPanel === "right" ? "hidden" : maximizedPanel === "left" ? "w-full" : "w-1/2")}>
              <div className="p-2 border-b bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {/* Global Select-All checkbox */}
                    {unmappedAccounts.length > 0 && (() => {
                      const allSel  = unmappedAccounts.every(a => multiSelect.has(a.account_name));
                      const someSel = unmappedAccounts.some(a => multiSelect.has(a.account_name));
                      return (
                        <input
                          type="checkbox"
                          className="cursor-pointer h-3.5 w-3.5 accent-blue-600 shrink-0"
                          checked={allSel}
                          ref={el => { if (el) el.indeterminate = someSel && !allSel; }}
                          onChange={() => {
                            setMultiSelect(prev => {
                              if (allSel) return new Set();
                              return new Set(unmappedAccounts.map(a => a.account_name));
                            });
                          }}
                          title={allSel ? "Deselect all" : "Select all unmapped"}
                        />
                      );
                    })()}
                    <p className="text-xs font-semibold text-muted-foreground">
                      Unmapped Ledgers <Badge variant="outline" className="text-[9px] ml-1">{unmappedAccounts.length}</Badge>
                      {multiSelect.size > 0 && (
                        <Badge className="text-[9px] ml-1 bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300">
                          {multiSelect.size} ticked
                        </Badge>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {groupView && (
                      <>
                        <button
                          type="button"
                          onClick={() => setExpandedGroups(prev => { const next = { ...prev }; grouped.forEach(g => { next[g.group] = false; }); return next; })}
                          className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap"
                          title="Collapse all groups"
                        >⊖ Collapse All</button>
                        <button
                          type="button"
                          onClick={() => setExpandedGroups(prev => { const next = { ...prev }; grouped.forEach(g => { next[g.group] = true; }); return next; })}
                          className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap"
                          title="Expand all groups"
                        >⊕ Expand All</button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setMaximizedPanel(p => p === "left" ? null : "left")}
                      className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap"
                      title={maximizedPanel === "left" ? "Restore split view" : "Expand left panel"}
                    >{maximizedPanel === "left" ? "⊠ Restore Split" : "⊡ Expand"}</button>
                  </div>
                  {multiSelect.size > 0 && (
                    <div className="flex items-center gap-2 ml-1">
                      <p className="text-[10px] text-blue-700 dark:text-blue-300 font-medium">
                        Click an FS line item to assign all {multiSelect.size}
                      </p>
                      <button
                        className="text-[10px] text-muted-foreground hover:text-destructive underline"
                        onClick={() => setMultiSelect(new Set())}
                      >
                        clear
                      </button>
                    </div>
                  )}
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-2 top-2.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search unmapped ledgers..."
                    className="pl-7 h-8 text-xs"
                  />
                </div>
              </div>
              <ScrollArea className="flex-1">
                {groupView ? (
                  <div>
                    {grouped.map((g) => {
                      const isOpen = expandedGroups[g.group] ?? false;
                      const suggestedItem = g.dominantCode
                        ? activeLeafItems.find((i) => i.code === g.dominantCode) : null;
                      // Unmapped items in this group available for bulk select
                      const unmappedInGroup = g.items.filter(a => !coaMapping[a.account_name]);
                      const allGroupSelected = unmappedInGroup.length > 0 && unmappedInGroup.every(a => multiSelect.has(a.account_name));
                      const someGroupSelected = unmappedInGroup.some(a => multiSelect.has(a.account_name));
                      return (
                        <div key={g.group} className="border-b">
                          <div
                            onClick={() => setExpandedGroups((p) => ({ ...p, [g.group]: !isOpen }))}
                            className="px-3 py-2 bg-muted/40 hover:bg-muted/60 cursor-pointer flex items-center justify-between sticky top-0 z-10"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {/* Select-all checkbox for unmapped ledgers in this group */}
                              {unmappedInGroup.length > 0 && (
                                <input
                                  type="checkbox"
                                  className="cursor-pointer h-3.5 w-3.5 accent-blue-600 shrink-0"
                                  checked={allGroupSelected}
                                  ref={el => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                                  onClick={e => e.stopPropagation()}
                                  onChange={() => {
                                    setMultiSelect(prev => {
                                      const next = new Set(prev);
                                      if (allGroupSelected) {
                                        unmappedInGroup.forEach(a => next.delete(a.account_name));
                                      } else {
                                        unmappedInGroup.forEach(a => next.add(a.account_name));
                                      }
                                      return next;
                                    });
                                  }}
                                  title={allGroupSelected ? "Deselect all in group" : "Select all unmapped in group"}
                                />
                              )}
                              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              <span className="text-xs font-semibold truncate">{g.group}</span>
                              <Badge variant="outline" className="text-[9px] px-1">{g.total} unmapped</Badge>
                              {suggestedItem && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); assignGroup(g.group, suggestedItem.code); }}
                                  className="text-[10px] shrink-0 bg-primary text-primary-foreground rounded px-2 py-0.5 hover:bg-primary/90 font-medium"
                                  title={`Apply "${suggestedItem.name}" to all ${g.total} unmapped ledgers in this group`}
                                >→ {suggestedItem.name.length > 22 ? suggestedItem.name.slice(0, 22) + "…" : suggestedItem.name}</button>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={cn("font-mono text-[10px]", g.subtotal >= 0 ? "text-foreground" : "text-destructive")}>
                                ₹{Math.abs(g.subtotal).toLocaleString("en-IN")} {g.subtotal >= 0 ? "Dr" : "Cr"}
                              </span>
                              {selectedAccount && coaMapping[selectedAccount] && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); assignGroup(g.group, coaMapping[selectedAccount].code); }}
                                  className="text-[10px] text-primary hover:underline"
                                  title="Map entire group to the currently selected ledger's FS code"
                                >Map group</button>
                              )}
                              {/* Fallback picker for groups with no sibling suggestion */}
                              {!suggestedItem && unmappedInGroup.length > 0 && !(selectedAccount && coaMapping[selectedAccount]) && (
                                <Popover open={groupPickerOpen === g.group} onOpenChange={open => setGroupPickerOpen(open ? g.group : null)}>
                                  <PopoverTrigger asChild>
                                    <button
                                      onClick={e => e.stopPropagation()}
                                      className="text-[10px] text-muted-foreground hover:text-primary border border-dashed border-muted-foreground/30 hover:border-primary/50 rounded px-1.5 py-0.5 transition-colors"
                                      title="Pick a financial statement line item to map all ledgers in this group"
                                    >Map all as…</button>
                                  </PopoverTrigger>
                                  <PopoverContent className="p-0 w-64" align="end" onClick={e => e.stopPropagation()}>
                                    <Command>
                                      <CommandInput placeholder="Search FS item…" className="h-7 text-xs" />
                                      <CommandList className="max-h-52">
                                        <CommandEmpty className="text-xs py-2 text-center">No results</CommandEmpty>
                                        {activeLeafItems.map(item => (
                                          <CommandItem
                                            key={item.code}
                                            value={item.name}
                                            onSelect={() => { assignGroup(g.group, item.code); setGroupPickerOpen(null); }}
                                            className="text-xs py-1.5 cursor-pointer"
                                          >
                                            {item.name}
                                          </CommandItem>
                                        ))}
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              )}
                            </div>
                          </div>
                          {isOpen && g.items.map((acct) => {
                            const mapping = coaMapping[acct.account_name];
                            const isSelected = selectedAccount === acct.account_name;
                            const isMultiG  = multiSelect.has(acct.account_name);
                            const isCF = mapping?.confidence === "carried_forward";
                            const lineItem = mapping ? activeLeafItems.find((i) => i.code === mapping.code) : null;
                            return (
                              <div
                                key={acct.account_name}
                                onClick={() => setSelectedAccount(acct.account_name)}
                                className={cn(
                                  "pl-6 pr-3 py-2 cursor-pointer text-xs hover:bg-muted/50 transition-colors border-t",
                                  isSelected && "bg-primary/10 border-l-2 border-l-primary",
                                  !isSelected && isMultiG && "bg-blue-50 dark:bg-blue-950/20 border-l-2 border-l-blue-500",
                                  !isSelected && !isMultiG && isCF && "bg-amber-50 dark:bg-amber-950/10 border-l-2 border-l-amber-400",
                                  !isSelected && !isMultiG && !isCF && mapping?.confidence === "manual" && "bg-violet-50 dark:bg-violet-950/20 border-l-2 border-l-violet-400",
                                  !mapping && !isMultiG && "bg-destructive/5",
                                )}
                              >
                                <div className="flex items-center justify-between">
                                  {/* ISSUE 3 FIX (group view): show bulk-select
                                      checkbox for mapped rows too — Closed
                                      Accounts and All Unmapped tabs need this
                                      so the auditor can bulk-RE-MAP existing
                                      ledgers in one click. */}
                                  <input
                                    type="checkbox"
                                    className="mr-2 cursor-pointer h-3.5 w-3.5 accent-blue-600 shrink-0"
                                    checked={isMultiG}
                                    onClick={e => e.stopPropagation()}
                                    onChange={() => {
                                      setMultiSelect(prev => {
                                        const next = new Set(prev);
                                        if (next.has(acct.account_name)) next.delete(acct.account_name);
                                        else next.add(acct.account_name);
                                        return next;
                                      });
                                    }}
                                    title={mapping ? "Tick to bulk-RE-MAP this mapped ledger" : "Tick to bulk-assign this ledger"}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{acct.account_name}</p>
                                    {typeof acct.opening_balance === "number" && acct.opening_balance !== 0 && (
                                      <p className="text-[10px] text-muted-foreground">
                                        Opening ₹{Math.abs(acct.opening_balance).toLocaleString("en-IN")}
                                        <span className="ml-0.5 text-[9px]">{acct.opening_balance >= 0 ? "Dr" : "Cr"}</span>
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0 ml-2">
                                    <div className="text-right">
                                      <p className={cn("font-mono text-[11px]", acct.balance >= 0 ? "text-foreground" : "text-destructive")}>
                                        ₹{Math.abs(acct.balance).toLocaleString("en-IN")}
                                        <span className="ml-0.5 text-[9px]">{acct.balance >= 0 ? "Dr" : "Cr"}</span>
                                      </p>
                                      {(acct.tally_debit || acct.tally_credit) ? (
                                        <p className="text-[9px] text-muted-foreground font-mono">
                                          Dr ₹{Math.round(acct.tally_debit || 0).toLocaleString("en-IN")} · Cr ₹{Math.round(acct.tally_credit || 0).toLocaleString("en-IN")}
                                        </p>
                                      ) : null}
                                    </div>
                                    {mapping && (
                                      <button
                                        title="Unmap this ledger"
                                        onClick={(e) => { e.stopPropagation(); unmapAccount(acct.account_name); }}
                                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-1"
                                      >✕</button>
                                    )}
                                    <button
                                      title="Move / Reclassify ledger"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setReclassifyDialog({ accountName: acct.account_name });
                                        setReclassifyCode(mapping?.code || "");
                                        setReclassifyReason("");
                                      }}
                                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground ml-1"
                                    >⇄</button>
                                  </div>
                                </div>
                                {mapping ? (
                                  <div className="flex items-center gap-1 mt-1">
                                    <Badge variant="outline" className={cn("text-[8px] px-1", confBadgeClass(mapping.confidence))}>
                                      {confBadgeLabel(mapping.confidence)}
                                    </Badge>
                                    {isCF && (
                                      <span className="text-[9px] text-amber-600 dark:text-amber-400" title="Validated last year — highest confidence">⭐</span>
                                    )}
                                    <span className="text-[10px] text-primary truncate">→ {lineItem?.name || mapping.code}</span>
                                    {mapping.noteRef && <Badge className="text-[8px] px-1 bg-muted text-muted-foreground">N{mapping.noteRef}</Badge>}
                                    {INV_CODES_SET.has(mapping.code) && (
                                      <Badge className="text-[8px] px-1 bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300">📦 BS+P&L</Badge>
                                    )}
                                  </div>
                                ) : (
                                  <Badge variant="destructive" className="text-[8px] mt-1">Unmapped</Badge>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                <div className="divide-y">
                  {unmappedAccounts.map(acct => {
                    const mapping = coaMapping[acct.account_name];
                    const isSelected = selectedAccount === acct.account_name;
                    const isMulti = multiSelect.has(acct.account_name);
                    const isCFFlat = mapping?.confidence === "carried_forward";
                    const lineItem = mapping ? activeLeafItems.find(i => i.code === mapping.code) : null;
                    return (
                      <div
                        key={acct.account_name}
                        onClick={() => setSelectedAccount(acct.account_name)}
                        className={cn(
                          "px-3 py-2 cursor-pointer text-xs hover:bg-muted/50 transition-colors",
                          isSelected && "bg-primary/10 border-l-2 border-l-primary",
                          !isSelected && isMulti && "bg-blue-50 dark:bg-blue-950/20 border-l-2 border-l-blue-500",
                          !isSelected && !isMulti && isCFFlat && "bg-amber-50 dark:bg-amber-950/10 border-l-2 border-l-amber-400",
                          !isSelected && !isMulti && !isCFFlat && mapping?.confidence === "manual" && "bg-violet-50 dark:bg-violet-950/20 border-l-2 border-l-violet-400",
                          !mapping && !isMulti && "bg-destructive/5"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          {/* Issue 1 (today) — checkbox to add this ledger to the
                              multi-select bucket.  Click stops propagation so
                              ticking does not also flip the row's selectedAccount. */}
                          {/* ISSUE 3 FIX: show the bulk-select checkbox on
                              EVERY row (mapped + unmapped). Previously the
                              checkbox was gated `{!mapping &&` so already-mapped
                              ledgers in the Closed Accounts and All Unmapped
                              tabs couldn't be bulk-acted on. Clicking a target
                              FS line item now overwrites the mapping for every
                              ticked ledger — which is what the auditor expects
                              when reviewing closed/renamed accounts. */}
                          <input
                            type="checkbox"
                            className="mr-2 cursor-pointer h-3.5 w-3.5 accent-blue-600 shrink-0"
                            checked={isMulti}
                            onClick={e => e.stopPropagation()}
                            onChange={() => {
                              setMultiSelect(prev => {
                                const next = new Set(prev);
                                if (next.has(acct.account_name)) next.delete(acct.account_name);
                                else next.add(acct.account_name);
                                return next;
                              });
                            }}
                            title={mapping ? "Tick to bulk-RE-MAP this mapped ledger" : "Tick to bulk-assign this ledger"}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{acct.account_name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {acct.account_group || "— no group —"}
                              {typeof acct.opening_balance === "number" && acct.opening_balance !== 0 && (
                                <span className="ml-2">
                                  · Opening: ₹{Math.abs(acct.opening_balance).toLocaleString("en-IN")}
                                  <span className="ml-0.5 text-[9px]">{acct.opening_balance >= 0 ? "Dr" : "Cr"}</span>
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <div className="text-right">
                              <p className={cn("font-mono text-[11px]", acct.balance >= 0 ? "text-foreground" : "text-destructive")}>
                                ₹{Math.abs(acct.balance).toLocaleString("en-IN")}
                                <span className={cn("ml-0.5 text-[9px]", acct.balance >= 0 ? "text-muted-foreground" : "text-destructive")}>
                                  {acct.balance >= 0 ? "Dr" : "Cr"}
                                </span>
                              </p>
                              {(acct.tally_debit || acct.tally_credit) ? (
                                <p className="text-[9px] text-muted-foreground font-mono">
                                  Dr ₹{Math.round(acct.tally_debit || 0).toLocaleString("en-IN")} · Cr ₹{Math.round(acct.tally_credit || 0).toLocaleString("en-IN")}
                                </p>
                              ) : null}
                            </div>
                            {mapping && (
                              <button
                                title="Unmap this ledger"
                                onClick={e => { e.stopPropagation(); unmapAccount(acct.account_name); }}
                                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-1"
                              >
                                ✕
                              </button>
                            )}
                            <button
                              title="Move / Reclassify ledger"
                              onClick={e => {
                                e.stopPropagation();
                                setReclassifyDialog({ accountName: acct.account_name });
                                setReclassifyCode(mapping?.code || "");
                                setReclassifyReason("");
                              }}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground ml-1"
                            >
                              ⇄
                            </button>
                          </div>
                        </div>
                        {mapping ? (
                          <div className="flex items-center gap-1 mt-1">
                            <Badge variant="outline" className={cn("text-[8px] px-1", confBadgeClass(mapping.confidence))}>
                              {confBadgeLabel(mapping.confidence)}
                            </Badge>
                            {isCFFlat && (
                              <span className="text-[9px] text-amber-600 dark:text-amber-400" title="Validated last year — highest confidence">⭐</span>
                            )}
                            <span className="text-[10px] text-primary truncate">→ {lineItem?.name || mapping.code}</span>
                            {mapping.noteRef && <Badge className="text-[8px] px-1 bg-muted text-muted-foreground">N{mapping.noteRef}</Badge>}
                            {INV_CODES_SET.has(mapping.code) && (
                              <Badge className="text-[8px] px-1 bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300">📦 BS+P&L</Badge>
                            )}
                          </div>
                        ) : (
                          <Badge variant="destructive" className="text-[8px] mt-1">Unmapped</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
              </ScrollArea>
            </div>

            {/* Right: FS Line Items Tree — mapping destination + unmap workspace */}
            <div className={cn("flex flex-col border rounded-lg overflow-hidden transition-all", maximizedPanel === "left" ? "hidden" : maximizedPanel === "right" ? "w-full" : "w-1/2")}>
              <div className="p-2 border-b bg-muted/30 space-y-1.5">
                {/* Title row */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {isNonCorporate ? `NCE Line Items (${entityType})` : "Schedule III Line Items"}
                    </p>
                    {/* ── Expand / Collapse All toggle ── */}
                    {!fsSearch && (() => {
                      const anyExpanded = filteredFsItems.some(item => expandedGroups[`fs:${item.code}`] === true);
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            const next: Record<string, boolean> = { ...expandedGroups };
                            for (const item of filteredFsItems) {
                              if (!item.children || item.children.length === 0) {
                                const mapped = tbAccounts.filter(a => coaMapping[a.account_name]?.code === item.code);
                                next[`fs:${item.code}`] = anyExpanded ? false : mapped.length > 0;
                              }
                            }
                            setExpandedGroups(next);
                          }}
                          className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap"
                        >
                          {anyExpanded ? "⊖ Collapse All" : "⊕ Expand All"}
                        </button>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-muted-foreground text-right">
                      {selectedAccount
                        ? <>Click a line item to map <span className="font-semibold text-primary">"{selectedAccount}"</span></>
                        : <>Click a mapped ledger's <span className="text-destructive font-semibold">✕</span> to unmap</>}
                    </p>
                    <button
                      type="button"
                      onClick={() => setMaximizedPanel(p => p === "right" ? null : "right")}
                      className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap shrink-0"
                      title={maximizedPanel === "right" ? "Restore split view" : "Expand right panel"}
                    >{maximizedPanel === "right" ? "⊠ Restore Split" : "⊡ Expand"}</button>
                  </div>
                </div>
                {/* BS / P&L tab switcher */}
                <div className="flex gap-1">
                  <button
                    onClick={() => setFsPanelTab("bs")}
                    className={cn(
                      "flex-1 text-[10px] font-semibold py-1 rounded border transition-colors",
                      fsPanelTab === "bs"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                    )}
                  >
                    Balance Sheet
                  </button>
                  <button
                    onClick={() => setFsPanelTab("pl")}
                    className={cn(
                      "flex-1 text-[10px] font-semibold py-1 rounded border transition-colors",
                      fsPanelTab === "pl"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                    )}
                  >
                    P&amp;L
                  </button>
                </div>
                {/* Search box */}
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                  <Input
                    value={fsSearch}
                    onChange={e => setFsSearch(e.target.value)}
                    placeholder="Search ledger or head… (e.g. Commission, Cash, PPE)"
                    className="h-7 pl-6 pr-6 text-xs"
                  />
                  {fsSearch && (
                    <button
                      onClick={() => setFsSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <span className="text-xs">✕</span>
                    </button>
                  )}
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-1">

                  {/* ── SEARCH RESULTS MODE ── */}
                  {fsSearchResults !== null ? (
                    <div>
                      <div className="sticky top-0 z-10 bg-muted/60 border-b px-2 py-1 flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                        <span>
                          {fsSearchResults.length === 0
                            ? "No results"
                            : `${fsSearchResults.length} ledger${fsSearchResults.length !== 1 ? "s" : ""} found`}
                        </span>
                        <span className="text-right normal-case font-normal">
                          {fsSearchResults.length > 0 && "Ledger → FS Head"}
                        </span>
                      </div>

                      {fsSearchResults.length === 0 ? (
                        <div className="py-10 text-center text-xs text-muted-foreground">
                          <Search className="w-5 h-5 mx-auto mb-2 opacity-30" />
                          No mapped ledger or FS head matches <strong>"{fsSearch}"</strong>
                        </div>
                      ) : (
                        <div className="divide-y divide-border/50">
                          {fsSearchResults.map((r, idx) => {
                            const confClass = confChipClass(r.confidence);
                            return (
                              <div
                                key={idx}
                                className="group px-2 py-2 hover:bg-muted/40 transition-colors"
                              >
                                {/* Ledger name + per-row actions */}
                                <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
                                  <span className="text-xs font-medium truncate">{r.ledger}</span>
                                  <Badge variant="outline" className={cn("text-[8px] px-1 shrink-0", confClass)}>
                                    {confBadgeLabel(r.confidence)}
                                  </Badge>
                                  {Math.abs(r.balance) > 0.005 && (
                                    <span className="ml-auto text-[10px] font-mono text-muted-foreground shrink-0">
                                      ₹{Math.abs(r.balance).toLocaleString("en-IN")}
                                      <span className="ml-0.5 text-[9px]">{r.balance >= 0 ? "Dr" : "Cr"}</span>
                                    </span>
                                  )}
                                </div>
                                {/* Breadcrumb path */}
                                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <ArrowRight className="w-2.5 h-2.5 shrink-0 text-primary/60" />
                                  <span className="truncate">{r.breadcrumb}</span>
                                </div>
                                {/* Action buttons — let the auditor remap or
                                    unmap the ledger directly from the search
                                    results without having to unselect search
                                    first. Previously the only affordance was
                                    "click the FS row's ✕" — but that row is
                                    hidden while search is active. */}
                                <div className="flex items-center gap-1 mt-1">
                                  <button
                                    type="button"
                                    onClick={() => setReclassifyDialog({ accountName: r.ledger })}
                                    className="text-[10px] px-2 py-0.5 rounded border border-primary/40 text-primary hover:bg-primary/10 transition"
                                    title="Move this ledger to a different FS head"
                                  >
                                    ⇄ Move to…
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = { ...coaMapping };
                                      delete next[r.ledger];
                                      setCoaMapping(next);
                                      toast.success(`Unmapped "${r.ledger}"`);
                                    }}
                                    className="text-[10px] px-2 py-0.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10 transition"
                                    title="Unmap this ledger (move back to Unmapped Ledgers)"
                                  >
                                    ✕ Unmap
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                  <>
                  {/* ── NORMAL TREE MODE ── */}
                  {/* Column header: CY | PY | Δ — show actual FY so PY-shell users
                      know which year's data they are looking at */}
                  {(() => {
                    const fy = (engagement?.financial_year || "") as string;
                    const parts = fy.split("-");
                    const cyLabel = fy ? `FY ${fy}` : "Current Yr";
                    const pyLabel = (() => {
                      if (parts.length === 2) {
                        const prevStart = parseInt(parts[0]) - 1;
                        const prevEnd   = (parseInt(parts[0])).toString().slice(-2);
                        return `FY ${prevStart}-${prevEnd}`;
                      }
                      return "Prior Yr";
                    })();
                    return (
                      <div className="sticky top-0 z-10 bg-muted/60 border-b pr-2 py-1 grid grid-cols-[1fr_90px_90px_60px] gap-0 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                        <span className="border-r-2 border-slate-300 dark:border-slate-700 pl-2 pr-2">FS Line Item</span>
                        <span className="text-right border-r-2 border-slate-300 dark:border-slate-700 px-2" title="Closing balance for current engagement period">{cyLabel}</span>
                        <span className="text-right border-r-2 border-slate-300 dark:border-slate-700 px-2" title="Opening balance (prior year closing)">{pyLabel}</span>
                        <span className="text-right pl-2">Δ %</span>
                      </div>
                    );
                  })()}
                  {filteredFsItems.flatMap(item => {
                    const isHeader = item.children && item.children.length > 0;
                    const mappedAccounts = tbAccounts.filter(a => coaMapping[a.account_name]?.code === item.code);
                    // PL_PAT: override with calculated PAT (PBT − Tax) —
                    // no TB ledger ever maps to PL_PAT directly; the value is always
                    // a computed result, not a raw Tally balance.
                    const amountCY = (item.code === "PL_PAT" && coaPLCalc != null)
                      ? coaPLCalc.patCY
                      : (computedAmounts[item.code] || 0);
                    // PY: BS items → opening_balance from CY TB; P&L items → PY shell TB.
                    // ROOT-CAUSE FIX (Stage 6 — PY parent total bug):
                    // For P&L items we MUST consult pyShellPLAmounts first.
                    // computedAmountsPY for any P&L parent only ever contains the
                    // CII dual-post amount (since every other P&L leaf has
                    // opening_balance = 0), so a naïve `||` chain short-circuits
                    // on that partial total and ignores the real PY values.
                    // Classify by section so corporate (PL_*) and NCE (NCE_*)
                    // codes both flow through the correct branch.
                    const itemSecLower = String((item as any).section || "").toLowerCase();
                    const isItemPL =
                      itemSecLower.includes("pl") || itemSecLower.includes("p_l") ||
                      itemSecLower.includes("revenue") || itemSecLower.includes("expense") ||
                      itemSecLower.includes("income");
                    const amountPY = (item.code === "PL_PAT" && coaPLCalc != null)
                      ? coaPLCalc.patPY
                      : isItemPL
                        ? (pyShellPLAmounts[item.code] || pyAmounts[item.code] || 0)
                        : (computedAmountsPY[item.code] || 0);
                    const delta    = amountCY - amountPY;
                    const pct      = Math.abs(amountPY) > 0.005
                      ? Math.round((delta / Math.abs(amountPY)) * 100)
                      : (Math.abs(amountCY) > 0.005 ? 100 : 0);
                    const hasAny   = Math.abs(amountCY) > 0.005 || Math.abs(amountPY) > 0.005;
                    const isExpanded = expandedGroups[`fs:${item.code}`] ?? (mappedAccounts.length > 0 && mappedAccounts.length <= 5);

                    const node = (
                      <div key={item.code}>
                        <div
                          onClick={() => {
                            // Issue 1 (today) — bulk-assign every ticked ledger
                            // when multi-select is active.  Falls back to the
                            // single-selection flow when nothing is ticked.
                            if (multiSelect.size > 0 && !isHeader) {
                              const ledgers = Array.from(multiSelect);
                              bulkMapLedgers(ledgers, item.code);
                              setMultiSelect(new Set());
                              setSelectedAccount(null);
                            } else if (selectedAccount && !isHeader) {
                              mapLedgerWithPropagation(selectedAccount, item.code, "manual");
                              setSelectedAccount(null);
                            } else if (!isHeader && mappedAccounts.length > 0) {
                              setExpandedGroups(p => ({ ...p, [`fs:${item.code}`]: !isExpanded }));
                            }
                          }}
                          className={cn(
                            "py-1.5 text-xs rounded-sm transition-colors grid grid-cols-[1fr_90px_90px_60px] gap-0 items-stretch pr-2",
                            isHeader ? "font-bold text-foreground mt-2 bg-muted/30" : "hover:bg-primary/10 cursor-pointer",
                            !isHeader && selectedAccount && "ring-1 ring-transparent hover:ring-primary/40",
                          )}
                        >
                          <div
                            className="flex items-center gap-1.5 min-w-0 border-r-2 border-slate-300 dark:border-slate-700 pr-2"
                            style={{ paddingLeft: `${item.depth * 16 + 8}px` }}
                          >
                            {isHeader && <ChevronDown size={12} />}
                            {!isHeader && mappedAccounts.length > 0 && (
                              isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
                            )}
                            <span className={cn("truncate", isHeader && "uppercase text-[11px]")}>{item.name}</span>
                            {item.noteRef && <Badge variant="outline" className="text-[8px] px-1 shrink-0">N{item.noteRef}</Badge>}
                            {mappedAccounts.length > 0 && !isHeader && (
                              <Badge className="text-[8px] px-1 bg-primary/10 text-primary">{mappedAccounts.length}</Badge>
                            )}
                          </div>
                          <span className={cn("font-mono text-[10px] text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 flex items-center justify-end", amountCY >= 0 ? "text-foreground" : "text-destructive")}>
                            {Math.abs(amountCY) > 0.005 ? (
                              <>₹{Math.abs(amountCY).toLocaleString("en-IN")}<span className="ml-0.5 text-[9px] opacity-70">{amountCY >= 0 ? "Dr" : "Cr"}</span></>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </span>
                          <span className={cn("font-mono text-[10px] text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 flex items-center justify-end", amountPY >= 0 ? "text-foreground" : "text-destructive", "opacity-80")}>
                            {Math.abs(amountPY) > 0.005 ? (
                              <>₹{Math.abs(amountPY).toLocaleString("en-IN")}<span className="ml-0.5 text-[9px] opacity-70">{amountPY >= 0 ? "Dr" : "Cr"}</span></>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </span>
                          <span
                            className={cn("text-[10px] text-right font-mono pl-2 flex items-center justify-end",
                              !hasAny ? "text-muted-foreground/40" :
                              Math.abs(pct) < 5  ? "text-muted-foreground" :
                              Math.abs(pct) < 50 ? "text-amber-600" :
                                                   "text-destructive",
                              hasAny && !isHeader && "hover:underline cursor-pointer"
                            )}
                            title={hasAny && !isHeader ? "Drill into ledger-level variance" : undefined}
                            onClick={(e) => {
                              if (hasAny && !isHeader) {
                                e.stopPropagation();
                                setVarianceDrill({ code: item.code, name: item.name });
                              }
                            }}
                          >
                            {hasAny ? `${pct > 0 ? "+" : ""}${pct}%` : "—"}
                          </span>
                        </div>
                        {!isHeader && isExpanded && mappedAccounts.length > 0 && (
                          <div className="bg-muted/20 border-l-2 border-primary/30">
                            {mappedAccounts.map(a => {
                              const m = coaMapping[a.account_name];
                              const confClass = confChipClass(m?.confidence || "low");
                              const opening = a.opening_balance ?? 0;
                              // PY value to display in the right-hand column.
                              // BS ledgers: opening_balance on CY TB = PY closing.
                              // P&L ledgers: opening is always 0 (Tally yearly reset),
                              //             so fall back to the PY-shell closing balance
                              //             keyed by ledger name. Without this fallback,
                              //             every P&L sub-row showed "—" even though the
                              //             group total (computed from pyShellPLAmounts)
                              //             was populated.
                              const pyAmt = Math.abs(opening) >= 0.005
                                ? opening
                                : lookupPyShellAmount(a.account_name);
                              const isNew    = Math.abs(opening) < 0.005 && Math.abs(a.balance) >= 0.005;
                              const isClosed = Math.abs(opening) >= 0.005 && Math.abs(a.balance) < 0.005;
                              // P&L A/c (non-BxS) mapped to a BS code: closing balance is NOT added
                              // to the FS — its current-year movement auto-flows via netPL from
                              // PL_REV+PL_EXP into BS_EQ_RS.  Show an "AUTO-FLOW" badge to make
                              // this explicit so users don't see it as double-counting next to a
                              // sibling "Profit & Loss A/c (BxS)" carry-forward ledger.
                              const isPLAutoFlow =
                                isTallyPLAccount(a.account_name) &&
                                (m?.code || "").startsWith("BS_") &&
                                Math.abs(opening) < 0.005;
                              return (
                                <div
                                  key={a.account_name}
                                  className="grid grid-cols-[1fr_90px_90px_60px] gap-0 items-stretch py-1 pr-2 text-[11px] hover:bg-background"
                                >
                                  <div
                                    className="flex items-center gap-1.5 min-w-0 border-r-2 border-slate-300 dark:border-slate-700 pr-2"
                                    style={{ paddingLeft: `${item.depth * 16 + 28}px` }}
                                  >
                                    <span className="truncate">{a.account_name}</span>
                                    <Badge variant="outline" className={cn("text-[8px] px-1 shrink-0", confClass)}>
                                      {confBadgeLabel(m?.confidence || "low")}
                                    </Badge>
                                    {isNew && <Badge className="text-[8px] px-1 bg-primary/10 text-primary border-primary/30 shrink-0">NEW</Badge>}
                                    {isClosed && <Badge className="text-[8px] px-1 bg-slate-200 text-slate-700 border-slate-400 shrink-0">CLOSED</Badge>}
                                    {isPLAutoFlow && (
                                      <Badge
                                        className="text-[8px] px-1 bg-amber-100 text-amber-800 border-amber-300 shrink-0"
                                        title="This ledger's closing is NOT added — current-year P&L auto-flows via Net Profit (PL_REV + PL_EXP) into Reserves & Surplus.  The retained-earnings carry-forward is captured by the sibling 'Profit & Loss A/c (BxS)' ledger."
                                      >AUTO-FLOW</Badge>
                                    )}
                                    {aliases[a.account_name] && (
                                      <Badge
                                        className="text-[8px] px-1 bg-violet-100 text-violet-700 border-violet-300 shrink-0 cursor-pointer"
                                        title={`Aliased to "${aliases[a.account_name]}" — click to remove`}
                                        onClick={(e) => { e.stopPropagation(); removeAlias(a.account_name); }}
                                      >🔗 {aliases[a.account_name]}</Badge>
                                    )}
                                    {isClosed && !aliases[a.account_name] && (
                                      <button
                                        title="Link this closed ledger to its current-year renamed counterpart"
                                        onClick={(e) => { e.stopPropagation(); setAliasDialog({ priorName: a.account_name }); }}
                                        className="text-[8px] px-1 py-0.5 rounded border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 shrink-0"
                                      >🔗 Link</button>
                                    )}
                                  </div>
                                  <span className={cn("font-mono text-[10px] text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 flex items-center justify-end", a.balance >= 0 ? "text-foreground" : "text-destructive")}>
                                    {Math.abs(a.balance) > 0.005 ? (
                                      <>₹{Math.abs(a.balance).toLocaleString("en-IN")}<span className="ml-0.5 text-[9px]">{a.balance >= 0 ? "Dr" : "Cr"}</span></>
                                    ) : <span className="text-muted-foreground/40">—</span>}
                                  </span>
                                  <span className={cn("font-mono text-[10px] text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 flex items-center justify-end opacity-80", pyAmt >= 0 ? "text-foreground" : "text-destructive")}>
                                    {Math.abs(pyAmt) > 0.005 ? (
                                      <>₹{Math.abs(pyAmt).toLocaleString("en-IN")}<span className="ml-0.5 text-[9px]">{pyAmt >= 0 ? "Dr" : "Cr"}</span></>
                                    ) : <span className="text-muted-foreground/40">—</span>}
                                  </span>
                                  <div className="flex items-center gap-0.5 justify-end pl-2">
                                    <button
                                      title={`Unmap "${a.account_name}"`}
                                      onClick={(e) => { e.stopPropagation(); unmapAccount(a.account_name); }}
                                      className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                    >✕</button>
                                    <button
                                      title="Move / Reclassify"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setReclassifyDialog({ accountName: a.account_name });
                                        setReclassifyCode(m?.code || "");
                                        setReclassifyReason("");
                                      }}
                                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                    >⇄</button>
                                  </div>
                                </div>
                              );
                            })}
                            {mappedAccounts.length > 1 && (
                              <div
                                className="flex items-center justify-end pr-3 py-1 text-[10px] text-destructive hover:underline cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!window.confirm(`Unmap all ${mappedAccounts.length} ledgers from "${item.name}"?`)) return;
                                  const updated = { ...coaMapping };
                                  for (const a of mappedAccounts) delete updated[a.account_name];
                                  setCoaMapping(updated);
                                  supabase.from("audit_engagements")
                                    .update({ coa_mapping: updated } as any)
                                    .eq("id", engagementId)
                                    .then(() => toast.success(`Unmapped ${mappedAccounts.length} ledgers from ${item.name}`));
                                }}
                              >Unmap all {mappedAccounts.length}</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                    // ── Inject "Profit Before Tax" calculated row after PL_EI ────
                    // For corporate P&L only. PBT = Income − Expenses − Exceptional
                    // items. Appears between Exceptional Items (VI) and Tax (X),
                    // matching the Schedule III Statement of P&L layout exactly.
                    if (!isNonCorporate && item.code === "PL_EI" && coaPLCalc != null) {
                      const { pbtCY, pbtPY } = coaPLCalc;
                      const pbtNode = (
                        <div
                          key="__pbt_calc__"
                          className="py-1.5 text-[11px] rounded-sm bg-primary/5 border-t-2 border-primary/20 grid grid-cols-[1fr_90px_90px_60px] gap-0 items-stretch pr-2"
                        >
                          <div
                            className="flex items-center gap-1 min-w-0 border-r-2 border-slate-300 dark:border-slate-700 pr-2 font-bold"
                            style={{ paddingLeft: "8px" }}
                          >
                            <span className="truncate text-primary">Profit Before Tax</span>
                            <Badge className="text-[8px] px-1 bg-primary/10 text-primary shrink-0 border-0">IX</Badge>
                          </div>
                          <span className={cn(
                            "font-mono text-[10px] text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 flex items-center justify-end font-bold",
                            pbtCY >= 0 ? "text-foreground" : "text-destructive"
                          )}>
                            {Math.abs(pbtCY) > 0.005
                              ? <>{`₹${Math.abs(pbtCY).toLocaleString("en-IN")}`}<span className="ml-0.5 text-[9px] opacity-70">{pbtCY >= 0 ? "Dr" : "Cr"}</span></>
                              : <span className="text-muted-foreground/40">—</span>}
                          </span>
                          <span className={cn(
                            "font-mono text-[10px] text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 flex items-center justify-end font-bold opacity-80",
                            pbtPY >= 0 ? "text-foreground" : "text-destructive"
                          )}>
                            {Math.abs(pbtPY) > 0.005
                              ? <>{`₹${Math.abs(pbtPY).toLocaleString("en-IN")}`}<span className="ml-0.5 text-[9px] opacity-70">{pbtPY >= 0 ? "Dr" : "Cr"}</span></>
                              : <span className="text-muted-foreground/40">—</span>}
                          </span>
                          <span className="text-[10px] text-right pl-2 flex items-center justify-end text-muted-foreground/40">—</span>
                        </div>
                      );
                      return [node, pbtNode];
                    }
                    return node;
                  })}
                  </>
                  )} {/* end search ternary */}
                </div>
              </ScrollArea>

              {/* ── BS Balance Check Totals ──────────────────────────────────────
                  Visible only on BS tab, not during search.
                  Shows Total E&L vs Total Assets + balanced/unbalanced indicator.
              ─────────────────────────────────────────────────────────────────── */}
              {fsPanelTab === "bs" && !fsSearch && (() => {
                // Issue 2 (today) — sign-fix the BS difference calculation.
                //
                // computedAmounts stores liabilities + equity SIGNED CR-negative
                // (Tally convention) and assets SIGNED DR-positive.  The old
                // `diff = totalEL - totalAss` therefore doubled the magnitude
                // when the two sides actually balanced: a perfectly balanced
                // BS with ₹82,20,083.99 on each side produced
                //   totalEL  = -82,20,083.99
                //   totalAss = +82,20,083.99
                //   diff     = |totalEL - totalAss| = ₹1,64,40,167.98
                // The user saw "BS not balanced yet — Difference: ₹1.6Cr"
                // for an engagement whose BS actually balanced to the rupee.
                //
                // The correct identity is:  Σ Dr  +  Σ Cr  =  0  (Tally)
                //                       =>  totalAss + totalEL = 0 when balanced.
                // So diff = | totalAss + totalEL | .
                // Entity-aware totals. Corporate sums BS_EQ/BS_NCL/BS_CL and
                // BS_NCA/BS_CA. NCE has no such codes — its grand totals are the
                // pre-computed parents NCE_EL (equity+liabilities, Cr-negative)
                // and NCE_AST (assets, Dr-positive). Without this branch the NCE
                // COA Mapping screen showed NO balance-check panel at all (both
                // corporate totals were 0 → the guard below returned null).
                const totalEL = isNonCorporate
                  ? (computedAmounts["NCE_EL"] || 0)
                  : (computedAmounts["BS_EQ"]  || 0)
                  + (computedAmounts["BS_NCL"] || 0)
                  + (computedAmounts["BS_CL"]  || 0);
                const totalAss = isNonCorporate
                  ? (computedAmounts["NCE_AST"] || 0)
                  : (computedAmounts["BS_NCA"] || 0)
                  + (computedAmounts["BS_CA"]  || 0);
                const totalELpy = isNonCorporate
                  ? (computedAmountsPY["NCE_EL"] || 0)
                  : (computedAmountsPY["BS_EQ"]  || 0)
                  + (computedAmountsPY["BS_NCL"] || 0)
                  + (computedAmountsPY["BS_CL"]  || 0);
                const totalASSpy = isNonCorporate
                  ? (computedAmountsPY["NCE_AST"] || 0)
                  : (computedAmountsPY["BS_NCA"] || 0)
                  + (computedAmountsPY["BS_CA"]  || 0);
                // Sign-corrected difference + ₹2 tolerance (Issue 2 today)
                // to absorb 2-decimal rounding accumulating over many ledgers.
                const diff     = Math.abs(totalAss + totalEL);
                const balanced = diff < 2;
                if (Math.abs(totalEL) < 0.005 && Math.abs(totalAss) < 0.005) return null;
                const fmtAmt = (n: number) =>
                  n === 0 ? "—"
                  : `₹${Math.abs(n).toLocaleString("en-IN")}${n >= 0 ? " Dr" : " Cr"}`;
                return (
                  <div className="border-t bg-muted/20 px-2 pt-2 pb-2 space-y-1">
                    {/* Header row */}
                    <div className="grid grid-cols-[1fr_90px_90px_60px] gap-0 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold border-b pb-1 mb-1">
                      <span className="pl-2 border-r-2 border-slate-300 dark:border-slate-700 pr-2">BS Total</span>
                      <span className="text-right border-r-2 border-slate-300 dark:border-slate-700 px-2">Current</span>
                      <span className="text-right border-r-2 border-slate-300 dark:border-slate-700 px-2">Prior</span>
                      <span className="text-right pl-2">Match</span>
                    </div>

                    {/* Total Equity & Liabilities row */}
                    <div className="grid grid-cols-[1fr_90px_90px_60px] gap-0 items-center text-[10px]">
                      <span className="font-bold text-foreground pl-2 border-r-2 border-slate-300 dark:border-slate-700 pr-2 py-0.5 truncate">
                        Total E &amp; L
                      </span>
                      <span className={cn(
                        "font-mono text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 font-semibold",
                        totalEL >= 0 ? "text-foreground" : "text-destructive",
                      )}>
                        {fmtAmt(totalEL)}
                      </span>
                      <span className={cn(
                        "font-mono text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 opacity-70",
                        totalELpy >= 0 ? "text-foreground" : "text-destructive",
                      )}>
                        {fmtAmt(totalELpy)}
                      </span>
                      <span className="text-right pl-2" />
                    </div>

                    {/* Total Assets row */}
                    <div className="grid grid-cols-[1fr_90px_90px_60px] gap-0 items-center text-[10px]">
                      <span className="font-bold text-foreground pl-2 border-r-2 border-slate-300 dark:border-slate-700 pr-2 py-0.5 truncate">
                        Total Assets
                      </span>
                      <span className={cn(
                        "font-mono text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 font-semibold",
                        totalAss >= 0 ? "text-foreground" : "text-destructive",
                      )}>
                        {fmtAmt(totalAss)}
                      </span>
                      <span className={cn(
                        "font-mono text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 opacity-70",
                        totalASSpy >= 0 ? "text-foreground" : "text-destructive",
                      )}>
                        {fmtAmt(totalASSpy)}
                      </span>
                      <span className="text-right pl-2" />
                    </div>

                    {/* Balance indicator */}
                    <div className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold mt-1",
                      balanced
                        ? "bg-green-50 border border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400"
                        : "bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400",
                    )}>
                      {balanced
                        ? <><span>✓</span> Balance Sheet is <strong>BALANCED</strong></>
                        : <><span>✗</span> Difference: <strong>₹{diff.toLocaleString("en-IN")}</strong> — BS not balanced yet</>
                      }
                    </div>
                  </div>
                );
              })()}

              {/* ── P&L Summary: PBT / PAT ──────────────────────────────────────
                  Visible only on P&L tab (corporate) when at least one P&L item
                  is mapped. Mirrors the BS balance check panel layout.
              ─────────────────────────────────────────────────────────────────── */}
              {fsPanelTab === "pl" && !isNonCorporate && !fsSearch && coaPLCalc != null && (() => {
                const { pbtCY, pbtPY, patCY, patPY } = coaPLCalc;
                if (Math.abs(pbtCY) < 0.005 && Math.abs(pbtPY) < 0.005 &&
                    Math.abs(patCY) < 0.005 && Math.abs(patPY) < 0.005) return null;
                const fmtPL = (n: number) =>
                  Math.abs(n) < 0.005 ? "—"
                  : `₹${Math.abs(n).toLocaleString("en-IN")} ${n >= 0 ? "Dr" : "Cr"}`;
                const profitLabel = (n: number) =>
                  Math.abs(n) < 0.005 ? "—" : n > 0 ? "Profit" : "Loss";
                return (
                  <div className="border-t bg-muted/20 px-2 pt-2 pb-2 space-y-1">
                    <div className="grid grid-cols-[1fr_90px_90px_60px] gap-0 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold border-b pb-1 mb-1">
                      <span className="pl-2 border-r-2 border-slate-300 dark:border-slate-700 pr-2">P&amp;L Summary</span>
                      <span className="text-right border-r-2 border-slate-300 dark:border-slate-700 px-2">Current</span>
                      <span className="text-right border-r-2 border-slate-300 dark:border-slate-700 px-2">Prior</span>
                      <span className="text-right pl-2"></span>
                    </div>
                    {/* PBT row */}
                    <div className="grid grid-cols-[1fr_90px_90px_60px] gap-0 items-center text-[10px]">
                      <span className="font-bold text-primary pl-2 border-r-2 border-slate-300 dark:border-slate-700 pr-2 py-0.5 truncate">
                        Profit Before Tax
                      </span>
                      <span className={cn("font-mono text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 font-semibold", pbtCY >= 0 ? "text-foreground" : "text-destructive")}>
                        {fmtPL(pbtCY)}
                      </span>
                      <span className={cn("font-mono text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 opacity-70", pbtPY >= 0 ? "text-foreground" : "text-destructive")}>
                        {fmtPL(pbtPY)}
                      </span>
                      <span className="text-right pl-2" />
                    </div>
                    {/* PAT row */}
                    <div className="grid grid-cols-[1fr_90px_90px_60px] gap-0 items-center text-[10px]">
                      <span className="font-bold text-primary pl-2 border-r-2 border-slate-300 dark:border-slate-700 pr-2 py-0.5 truncate">
                        Profit After Tax
                      </span>
                      <span className={cn("font-mono text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 font-semibold", patCY >= 0 ? "text-foreground" : "text-destructive")}>
                        {fmtPL(patCY)}
                      </span>
                      <span className={cn("font-mono text-right border-r-2 border-slate-300 dark:border-slate-700 px-2 opacity-70", patPY >= 0 ? "text-foreground" : "text-destructive")}>
                        {fmtPL(patPY)}
                      </span>
                      <span className="text-right pl-2" />
                    </div>
                    {/* Status chip */}
                    <div className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold mt-1",
                      Math.abs(patCY) > 0.005
                        ? patCY > 0
                          ? "bg-green-50 border border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400"
                          : "bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400"
                        : "bg-muted border border-border text-muted-foreground"
                    )}>
                      {Math.abs(patCY) > 0.005
                        ? <><span>{patCY > 0 ? "▲" : "▼"}</span> Net {profitLabel(patCY)}: <strong>₹{Math.abs(patCY).toLocaleString("en-IN")}</strong></>
                        : <>Map Revenue &amp; Expense ledgers to see P&amp;L totals</>
                      }
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Generate FS Button */}
          <div className="flex justify-end pt-2">
            <Button onClick={generateFS} disabled={saving} className="gap-1">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
              Generate Financial Statements
            </Button>
          </div>

          </div> {/* end full-screen wrapper */}
        </TabsContent>
      </Tabs>

      {/* Reclassify Ledger Dialog */}
      <Dialog
        open={!!reclassifyDialog}
        onOpenChange={() => { setReclassifyDialog(null); setReclassifyCode(""); setReclassifyReason(""); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {/* Issue 1 (today, take 2) — surface bulk-mode in the title so
                  the auditor sees AT A GLANCE that confirming the dialog will
                  move every ticked ledger, not just the one whose ⇄ they hit. */}
              {reclassifyDialog && multiSelect.has(reclassifyDialog.accountName) && multiSelect.size > 1
                ? `⇄ Move ${multiSelect.size} Ticked Ledgers`
                : "⇄ Move / Reclassify Ledger"}
            </DialogTitle>
          </DialogHeader>
          {reclassifyDialog && (() => {
            const currentMapping = coaMapping[reclassifyDialog.accountName];
            const currentLineItem = currentMapping ? activeLeafItems.find(i => i.code === currentMapping.code) : null;
            const newLineItem = reclassifyCode ? activeLeafItems.find(i => i.code === reclassifyCode) : null;
            const isCFReclassify = currentMapping?.confidence === "carried_forward";
            const isBulkMode = multiSelect.has(reclassifyDialog.accountName) && multiSelect.size > 1;
            return (
              <div className="space-y-4 py-1">
                {isCFReclassify && (
                  <Alert className="bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-xs text-amber-800 dark:text-amber-300">Prior-Year Validated Mapping</AlertTitle>
                    <AlertDescription className="text-[11px] text-amber-700 dark:text-amber-400">
                      This ledger was mapped and validated during last year's audit. Changing it will downgrade its confidence to <strong>manual</strong> and remove the carry-forward status.
                    </AlertDescription>
                  </Alert>
                )}
                {isBulkMode && (
                  <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-300 dark:border-blue-700">
                    <AlertTitle className="text-xs text-blue-800 dark:text-blue-300">Bulk move</AlertTitle>
                    <AlertDescription className="text-[11px] text-blue-700 dark:text-blue-400">
                      Confirming will move all <strong>{multiSelect.size}</strong> ticked ledgers to the destination chosen below.
                    </AlertDescription>
                  </Alert>
                )}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                    {isBulkMode ? "Tick-selected ledgers" : "Account"}
                  </p>
                  {isBulkMode ? (
                    <p className="text-xs text-foreground space-y-0.5 max-h-24 overflow-y-auto">
                      {Array.from(multiSelect).map(n => (
                        <span key={n} className="block truncate">• {n}</span>
                      ))}
                    </p>
                  ) : (
                    <p className="text-sm font-semibold">{reclassifyDialog.accountName}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Current FS Line Item</p>
                    <p className="text-xs bg-muted rounded px-2 py-1.5 text-muted-foreground">
                      {currentLineItem?.name || "— Unmapped —"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Current Note No.</p>
                    <p className="text-xs bg-muted rounded px-2 py-1.5 text-muted-foreground">
                      {currentMapping?.noteRef ? `Note ${currentMapping.noteRef}` : "—"}
                    </p>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">New FS Line Item <span className="text-destructive">*</span></Label>
                  <Popover open={reclassifyPopoverOpen} onOpenChange={setReclassifyPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={reclassifyPopoverOpen}
                        className="w-full h-8 text-xs mt-1 justify-between font-normal"
                      >
                        <span className="truncate">
                          {(() => {
                            const sel = activeLeafItems.find(i => i.code === reclassifyCode);
                            if (!sel) return <span className="text-muted-foreground">Select FS Line Item…</span>;
                            return `${sel.noteRef ? `[N${sel.noteRef}] ` : ""}${sel.name}${sel.scheduleRef === "BS+P&L" ? " 📦" : ""}`;
                          })()}
                        </span>
                        <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command
                        filter={(value, search) => {
                          // value is the code; match against the displayed label
                          const item = activeLeafItems.find(i => i.code === value);
                          if (!item) return 0;
                          const label = `${item.noteRef ? `N${item.noteRef} ` : ""}${item.name}`.toLowerCase();
                          return label.includes(search.toLowerCase()) ? 1 : 0;
                        }}
                      >
                        <CommandInput placeholder="Search FS line item…" className="h-8 text-xs" />
                        <CommandList className="max-h-60">
                          <CommandEmpty>No matching line item.</CommandEmpty>
                          <CommandGroup>
                            {activeLeafItems.map(item => (
                              <CommandItem
                                key={item.code}
                                value={item.code}
                                onSelect={(v) => {
                                  setReclassifyCode(v);
                                  setReclassifyPopoverOpen(false);
                                }}
                                className="text-xs"
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-3 w-3",
                                    reclassifyCode === item.code ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {item.noteRef ? `[N${item.noteRef}] ` : ""}
                                {item.name}
                                {item.scheduleRef === "BS+P&L" ? " 📦" : ""}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {newLineItem && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">New FS Line Item</p>
                      <p className="text-xs bg-primary/5 rounded px-2 py-1.5 font-medium text-primary">{newLineItem.name}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">New Note No.</p>
                      <p className="text-xs bg-primary/5 rounded px-2 py-1.5 font-medium text-primary">
                        {newLineItem.noteRef ? `Note ${newLineItem.noteRef}` : "—"}
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-xs text-muted-foreground">Reason <span className="font-normal">(optional)</span></Label>
                  <Input
                    className="h-8 text-xs mt-1"
                    placeholder="e.g. Reclassified per ICAI guidance…"
                    value={reclassifyReason}
                    onChange={(e) => setReclassifyReason(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && reclassifyCode) reclassifyAccount(); }}
                  />
                </div>
              </div>
            );
          })()}
          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            {coaMapping[reclassifyDialog?.accountName || ""]?.confidence === "manual" && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => resetToAuto(reclassifyDialog!.accountName)}
              >
                <RefreshCw size={12} /> Reset to Auto
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setReclassifyDialog(null); setReclassifyCode(""); setReclassifyReason(""); }}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={!reclassifyCode} onClick={reclassifyAccount} className="gap-1">
              ⇄ Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Variance Drill-down Dialog (Task 4) ═══ */}
      <Dialog
        open={!!varianceDrill}
        onOpenChange={() => setVarianceDrill(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              Variance Drill — {varianceDrill?.name}
            </DialogTitle>
          </DialogHeader>
          {varianceDrill && (() => {
            const totals = varianceDrillRows.reduce(
              (acc, r) => ({ cy: acc.cy + r.cy, py: acc.py + r.py }),
              { cy: 0, py: 0 }
            );
            const totalDelta = totals.cy - totals.py;
            return (
              <div className="space-y-3">
                {/* Summary strip */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="p-2 rounded bg-muted/40">
                    <p className="text-[10px] text-muted-foreground uppercase">Current Yr</p>
                    <p className="font-mono font-semibold">₹{Math.abs(totals.cy).toLocaleString("en-IN")} {totals.cy >= 0 ? "Dr" : "Cr"}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/40">
                    <p className="text-[10px] text-muted-foreground uppercase">Prior Yr</p>
                    <p className="font-mono font-semibold">₹{Math.abs(totals.py).toLocaleString("en-IN")} {totals.py >= 0 ? "Dr" : "Cr"}</p>
                  </div>
                  <div className={cn(
                    "p-2 rounded",
                    Math.abs(totalDelta) < 1 ? "bg-muted/40" : "bg-amber-100 dark:bg-amber-950/30"
                  )}>
                    <p className="text-[10px] text-muted-foreground uppercase">Δ</p>
                    <p className="font-mono font-semibold">{totalDelta >= 0 ? "+" : ""}₹{Math.abs(totalDelta).toLocaleString("en-IN")}</p>
                  </div>
                </div>

                {/* PY data missing banner — shown when P&L PY amounts are all zero */}
                {(() => {
                  // Look up this drill item in the active FS tree to get its section.
                  // Individual P&L items have codes like NCE_COGS, NCE_EMP_EXP — their
                  // section field is "NCE_PL_expenses" / "NCE_PL_income" / "NCE_PL_profit".
                  const drillItem = activeFlatItems.find(i => i.code === varianceDrill?.code);
                  const isPlDrill = drillItem?.section?.toLowerCase().includes("pl")
                    || varianceDrill?.code?.toLowerCase().includes("pl");
                  const allPyZero = varianceDrillRows.length > 0 && totals.py === 0;
                  if (!isPlDrill || !allPyZero) return null;
                  const fyParts = (engagement?.financial_year || "").split("-");
                  const prevFy = fyParts.length === 2
                    ? `${parseInt(fyParts[0]) - 1}-${parseInt(fyParts[0]).toString().slice(-2)}`
                    : "prior year";
                  // ROOT-CAUSE FIX (Issue 1): when PY shell TB HAS rows but the
                  // ledger lookup still came up empty (post-fuzzy-fallback), the
                  // generic "not yet synced" message is misleading. Surface a
                  // more accurate diagnosis instead.
                  const pyShellLoaded = !!pyShellTbData?.tbRows?.length;
                  if (pyShellLoaded) {
                    // PY shell data IS synced — the drill ledger just doesn't
                    // appear in PY shell TB by any name variant. Likely a
                    // renamed ledger; suggest the alias UX rather than
                    // re-running sync-py.bat.
                    return (
                      <div className="flex items-start gap-2 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-[11px] text-blue-800 dark:text-blue-300">
                        <span className="text-base leading-tight shrink-0">ℹ</span>
                        <div>
                          <p className="font-semibold">PY shell data is loaded, but no matching prior-year ledger was found for this line item.</p>
                          <p className="mt-0.5 text-blue-700 dark:text-blue-400">
                            The ledger may have been renamed between FY {prevFy} and the current year.
                            Use the <strong>Closed Accounts</strong> tab on the left to map renamed ledgers
                            (an "ALIAS" link will be created so the PY amount flows through automatically).
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                      <span className="text-base leading-tight shrink-0">⚠</span>
                      <div>
                        <p className="font-semibold">Prior-year P&L amounts not yet synced.</p>
                        <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                          To populate PY amounts: in Tally press <strong>F2</strong>, set period to{" "}
                          <strong>FY {prevFy}</strong> (01-Apr-{prevFy.split("-")[0]} to 31-Mar-20{prevFy.split("-")[1]}),
                          press Escape to return to Gateway, then re-run <strong>sync-py.bat</strong>.
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* Ledger-level rows */}
                <div className="border rounded-md overflow-hidden">
                  <div className="grid grid-cols-[1fr_110px_110px_110px_50px] gap-1 bg-muted/60 px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                    <span>Ledger</span>
                    <span className="text-right">CY</span>
                    <span className="text-right">PY</span>
                    <span className="text-right">Δ</span>
                    <span className="text-right">Δ%</span>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {varianceDrillRows.length === 0 ? (
                      <div className="p-4 text-xs text-muted-foreground text-center">No mapped ledgers.</div>
                    ) : varianceDrillRows.map(r => (
                      <div
                        key={r.ledger}
                        className="grid grid-cols-[1fr_110px_110px_110px_50px] gap-1 px-3 py-1 text-[11px] border-t hover:bg-muted/30"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate" title={r.group}>{r.ledger}</span>
                          {r.isNew    && <Badge className="text-[8px] px-1 bg-primary/10 text-primary border-primary/30 shrink-0">NEW</Badge>}
                          {r.isClosed && <Badge className="text-[8px] px-1 bg-slate-200 text-slate-700 border-slate-400 shrink-0">CLOSED</Badge>}
                          {r.isAlias  && <Badge className="text-[8px] px-1 bg-violet-100 text-violet-700 border-violet-300 shrink-0">ALIAS</Badge>}
                        </div>
                        <span className="font-mono text-right">
                          {Math.abs(r.cy) > 0.005 ? `₹${Math.abs(r.cy).toLocaleString("en-IN")}` : "—"}
                        </span>
                        <span className="font-mono text-right opacity-80">
                          {Math.abs(r.py) > 0.005 ? `₹${Math.abs(r.py).toLocaleString("en-IN")}` : "—"}
                        </span>
                        <span className={cn(
                          "font-mono text-right",
                          Math.abs(r.delta) < 1      ? "text-muted-foreground" :
                          Math.abs(r.pct)   < 50     ? "text-amber-600" :
                                                       "text-destructive font-semibold"
                        )}>
                          {Math.abs(r.delta) < 0.005 ? "—" : `${r.delta >= 0 ? "+" : "−"}₹${Math.abs(r.delta).toLocaleString("en-IN")}`}
                        </span>
                        <span className={cn(
                          "text-right font-mono text-[10px]",
                          Math.abs(r.pct) < 5  ? "text-muted-foreground" :
                          Math.abs(r.pct) < 50 ? "text-amber-600" :
                                                 "text-destructive"
                        )}>
                          {r.pct >= 0 ? "+" : ""}{r.pct}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground">
                  Sorted by |Δ| descending. NEW = opening 0 &amp; closing ≠ 0.
                  CLOSED = opening ≠ 0 &amp; closing 0. ALIAS = linked to a renamed prior-year ledger.
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVarianceDrill(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Ledger Alias Picker (Task 3) ═══ */}
      <Dialog
        open={!!aliasDialog}
        onOpenChange={() => setAliasDialog(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Link Renamed Ledger</DialogTitle>
          </DialogHeader>
          {aliasDialog && (() => {
            const priorName = aliasDialog.priorName;
            // Candidate NEW ledgers in CY = opening 0, closing ≠ 0, not already an alias target.
            const existingTargets = new Set(Object.values(aliases));
            const candidates = tbAccounts
              .filter(a => {
                const op = Math.abs(a.opening_balance ?? 0) < 0.005;
                const cl = Math.abs(a.balance) >= 0.005;
                return op && cl && !existingTargets.has(a.account_name);
              })
              .sort((x, y) => x.account_name.localeCompare(y.account_name));
            return (
              <div className="space-y-3">
                <div className="p-3 rounded bg-muted/40 border">
                  <p className="text-[10px] uppercase text-muted-foreground">Prior-year ledger (CLOSED)</p>
                  <p className="text-sm font-semibold">{priorName}</p>
                </div>
                <div>
                  <Label className="text-xs">Link to current-year ledger (NEW) *</Label>
                  <Select
                    onValueChange={v => saveAlias(priorName, v)}
                  >
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue placeholder={candidates.length === 0 ? "No NEW ledgers found" : "Select current-year ledger…"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {candidates.map(c => (
                        <SelectItem key={c.account_name} value={c.account_name} className="text-xs">
                          {c.account_name}
                          {c.account_group && <span className="ml-1.5 text-muted-foreground">· {c.account_group}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    The prior ledger's opening balance will roll up under the current ledger's FS line item for PY comparatives.
                  </p>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAliasDialog(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

// ─── Helpers ───
function confidenceRank(c: string): number {
  if (c === "carried_forward") return 6;
  if (c === "manual")          return 5;
  if (c === "ai")              return 4;
  if (c === "high")            return 3;
  if (c === "medium")          return 2;
  return 1; // low
}

// Confidence badge styling helpers (used in left panel, right panel, reclassify dialog)
function confBadgeClass(confidence: string): string {
  if (confidence === "carried_forward")
    return "border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400";
  if (confidence === "manual")
    return "border-violet-400 text-violet-600 dark:text-violet-400";
  if (confidence === "ai")
    return "border-purple-400 text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400";
  if (confidence === "high")
    return "border-primary/40 text-primary";
  if (confidence === "medium")
    return "border-muted-foreground/40 text-muted-foreground";
  return "border-destructive/40 text-destructive"; // low
}

function confBadgeLabel(confidence: string): string {
  if (confidence === "carried_forward") return "🔁 carried";
  if (confidence === "manual")          return "✎ manual";
  if (confidence === "ai")              return "🤖 ai";
  return confidence;
}

// Right-panel inline badge class (filled variant, same tiers)
function confChipClass(confidence: string): string {
  if (confidence === "carried_forward")
    return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300";
  if (confidence === "manual")
    return "bg-violet-100 text-violet-700 border-violet-300";
  if (confidence === "ai")
    return "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300";
  if (confidence === "high")
    return "bg-primary/10 text-primary border-primary/30";
  if (confidence === "medium")
    return "bg-muted text-muted-foreground border-muted-foreground/30";
  return "bg-destructive/10 text-destructive border-destructive/30"; // low
}
// trigger rebuild 1780927188
