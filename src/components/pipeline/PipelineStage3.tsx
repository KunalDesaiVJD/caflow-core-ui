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
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowRight, CheckCircle2, AlertTriangle, Search, Download, FileSpreadsheet,
  Link2, RefreshCw, Eye, Pencil, ChevronRight, ChevronDown, Loader2
} from "lucide-react";
import { NCE_FS_ITEMS, NCE_AUTO_MAP_RULES } from "@/config/nceLineItems";
import type { FSLineItem } from "@/config/nceLineItems";

// ═══════════════════════════════════════
// Non-Corporate entity detection
// ═══════════════════════════════════════
const NON_CORPORATE = [
  "Partnership", "LLP", "Limited Liability Partnership",
  "Proprietorship", "Sole Proprietorship",
  "HUF", "Hindu Undivided Family",
  "Trust",
  "AOP", "Association of Persons",
  "BOI", "Body of Individuals",
  "Individual",
];

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
  { keywords: ["inventory", "stock", "stock in trade", "raw material", "finished goods"], code: "BS_CA_INV", confidence: "high" },
  { keywords: ["share capital", "equity capital", "authorised capital", "paid up capital"], code: "BS_EQ_SC", confidence: "high" },
  { keywords: ["reserve", "surplus", "retained earning", "general reserve", "profit and loss", "p&l"], code: "BS_EQ_RS", confidence: "high" },
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
    result.push({ ...item, depth });
    if (item.children) {
      result.push(...flattenTree(item.children, depth + 1));
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
  { match: ["stock-in-hand", "stock in hand", "stock in trade", "inventory"], code: "BS_CA_INV",             confidence: "high" },
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
  const g = (parentGroup || "").toLowerCase().trim();
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
const NCE_LEAF_ITEMS = NCE_FLAT_ITEMS.filter(i => !i.children || i.children.length === 0);

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
  const [search, setSearch] = useState("");
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

  // ─── Ledger Reclassify state ───
  const [reclassifyDialog, setReclassifyDialog] = useState<{ accountName: string } | null>(null);
  const [reclassifyCode, setReclassifyCode] = useState<string>("");

  // ─── COA Mapping state ───
  // mapping: { [accountName]: { code, noteRef, scheduleRef, confidence } }
  const [coaMapping, setCoaMapping] = useState<Record<string, {
    code: string; noteRef: number | null; scheduleRef: string; confidence: string;
  }>>({});
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  // ─── FS state (manual overrides) ───
  const [manualOverrides, setManualOverrides] = useState<Record<string, { amount: number; reason: string }>>({});
  const [pyAmounts, setPyAmounts] = useState<Record<string, number>>({});

  // ─── View/UI state ───
  const [hideZero, setHideZero]               = useState(true);   // hide closing_balance = 0 ledgers
  const [groupView, setGroupView]             = useState(true);   // group left panel by Tally parent_group
  const [expandedGroups, setExpandedGroups]   = useState<Record<string, boolean>>({});
  const [aiRunning, setAiRunning]             = useState(false);

  // ─── Fetch TB data (legacy snapshot path) ───
  const { data: tbSnapshot, isLoading: tbSnapshotLoading } = useQuery({
    queryKey: ["tb-snapshot-stage3", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("trial_balance_snapshots")
        .select("*")
        .eq("engagement_id", engagementId)
        .maybeSingle();
      return data as any;
    },
    enabled: !!engagementId,
  });

  // ─── Fetch TB leaf nodes (modern hierarchy path) ───
  // Modern TB upload stores data in tb_hierarchy_nodes, not trial_balance_snapshots.
  // We read leaf nodes here to (a) unlock the stage gate and (b) populate tbAccounts.
  const { data: tbLeafNodes, isLoading: tbLeafLoading } = useQuery({
    queryKey: ["tb-leaf-nodes-stage3", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tb_hierarchy_nodes")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("is_leaf", true);
      return (data || []) as any[];
    },
    enabled: !!engagementId,
  });

  // ─── Fallback: fetch Tally Trial Balance directly if TB import hasn't populated ───
  // `tally_trial_balance` holds the real closing balances (with balance_type
  // Dr/Cr) and is keyed to the separate `engagements` table (Tally sync), not
  // `audit_engagements`. Resolve the tally engagement id via client_id +
  // financial_year, with tally_groups as a fallback.
  //
  // NOTE: `tally_ledgers` has all zero closing_balance values — do not use it
  // as a balance source. It is only a ledger name / group registry.
  const { data: tallyTb, isLoading: tallyTbLoading } = useQuery({
    queryKey: ["tally-tb-stage3", engagement?.client_id, engagement?.financial_year],
    queryFn: async () => {
      if (!engagement?.client_id) return [];
      let tallyEngId: string | null = null;
      if (engagement.financial_year) {
        const { data: tEng } = await supabase
          .from("engagements")
          .select("id")
          .eq("client_id", engagement.client_id)
          .eq("financial_year", engagement.financial_year)
          .maybeSingle();
        tallyEngId = (tEng as any)?.id ?? null;
      }
      if (!tallyEngId) {
        const { data: tg } = await supabase
          .from("tally_groups")
          .select("engagement_id")
          .eq("client_id", engagement.client_id)
          .limit(1)
          .maybeSingle();
        tallyEngId = (tg as any)?.engagement_id ?? null;
      }
      if (!tallyEngId) return [];
      const { data } = await supabase
        .from("tally_trial_balance")
        .select("ledger_name, parent_group, opening_balance, opening_type, closing_balance, balance_type, debit_amount, credit_amount")
        .eq("engagement_id", tallyEngId);
      return (data || []) as any[];
    },
    enabled: !!engagement?.client_id,
  });

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
      // Find previous FY engagement
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

  // TB accounts — primary: tbSnapshot normalised_data; fallback: tb_hierarchy_nodes leaf nodes
  const tbAccounts: {
    account_name: string; account_group: string;
    debit: number; credit: number; balance: number;
    opening_balance?: number; tally_debit?: number; tally_credit?: number;
  }[] = useMemo(() => {
    // Primary path: legacy snapshot with normalised_data
    if (tbSnapshot?.normalised_data) {
      return ((tbSnapshot.normalised_data as any[]) || []).map((r: any) => ({
        account_name: r.account_name || r.ledger_name || "",
        account_group: r.account_group || "",
        debit: r.debit || r.closing_dr || 0,
        credit: r.credit || r.closing_cr || 0,
        balance: (r.debit || r.closing_dr || 0) - (r.credit || r.closing_cr || 0),
      })).filter(a => a.account_name);
    }
    // Fallback path: tb_hierarchy_nodes leaf nodes (modern upload path)
    if (tbLeafNodes?.length) {
      return tbLeafNodes.map((n: any) => ({
        account_name: n.name || "",
        account_group: n.primary_group || n.group_name || "",
        debit: n.txn_debit || 0,
        credit: n.txn_credit || 0,
        balance: (n.txn_debit || 0) - (n.txn_credit || 0),
      })).filter(a => a.account_name);
    }
    // Last-resort fallback: Tally Trial Balance (live sync, no TB import required).
    // closing_balance is unsigned; balance_type tells us Dr or Cr.
    if (tallyTb?.length) {
      return tallyTb.map((l: any) => {
        const cb   = Math.abs(Number(l.closing_balance ?? 0));
        const isDr = String(l.balance_type ?? "").toUpperCase() === "DR";
        return {
          account_name:  String(l.ledger_name || "").trim(),
          account_group: l.parent_group || "",
          debit:  isDr ? cb : 0,
          credit: isDr ? 0  : cb,
          balance: isDr ? cb : -cb,
          opening_balance: Math.abs(Number(l.opening_balance ?? 0)) *
                           (String(l.opening_type ?? "").toUpperCase() === "CR" ? -1 : 1),
          tally_debit:  Number(l.debit_amount  ?? 0),
          tally_credit: Number(l.credit_amount ?? 0),
        };
      }).filter((a: any) => a.account_name);
    }
    return [];
  }, [tbSnapshot, tbLeafNodes, tallyTb]);

  // Load existing mapping from engagement
  useEffect(() => {
    if (engagement?.coa_mapping && typeof engagement.coa_mapping === "object" && Object.keys(engagement.coa_mapping).length > 0) {
      setCoaMapping(engagement.coa_mapping as any);
    } else if (tbAccounts.length > 0 && Object.keys(coaMapping).length === 0) {
      // Auto-map on first load
      runAutoMapping();
    }
  }, [engagement?.coa_mapping, tbAccounts.length]);

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

  // ═══════ AUTO-MAPPING ═══════
  //   Layered pipeline, per ledger:
  //     1. parent_group match  (Tally's native taxonomy — strongest signal)
  //     2. keyword rules       (ledger name substring match)
  //     3. unmatched           (stays in "Unmapped" bucket)
  //
  //   Whichever stage fires first wins. The winner's confidence is kept; if a
  //   later stage would promote confidence (rare), we take the higher rank.
  //   Existing manual overrides ("manual" confidence) are preserved.
  const runAutoMapping = useCallback(() => {
    const groupTable = isNonCorporate ? PARENT_GROUP_MAP_NCE : PARENT_GROUP_MAP_CORP;
    const newMapping: typeof coaMapping = {};
    let viaGroup = 0, viaKeyword = 0;

    for (const acct of tbAccounts) {
      // Preserve manual overrides
      const existing = coaMapping[acct.account_name];
      if (existing?.confidence === "manual") {
        newMapping[acct.account_name] = existing;
        continue;
      }

      let best: { code: string; confidence: string; source: "group" | "keyword" } | null = null;

      // 1. parent_group
      const g = matchParentGroup(acct.account_group, groupTable);
      if (g) best = { code: g.code, confidence: g.confidence, source: "group" };

      // 2. keyword rules
      const name = acct.account_name.toLowerCase();
      for (const rule of activeAutoRules) {
        if (rule.keywords.some(kw => name.includes(kw))) {
          if (!best || confidenceRank(rule.confidence) > confidenceRank(best.confidence)) {
            best = { code: rule.code, confidence: rule.confidence, source: "keyword" };
          }
        }
      }

      if (best) {
        if (best.source === "group") viaGroup++; else viaKeyword++;
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
    toast.success(
      `Auto-mapped ${total} of ${tbAccounts.length} accounts`,
      { description: `${viaGroup} via Tally group · ${viaKeyword} via name keywords` },
    );
  }, [tbAccounts, activeAutoRules, activeLeafItems, isNonCorporate, coaMapping]);

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
    if (Object.keys(coaMapping).length === 0) { toast.info("Nothing to clear"); return; }
    if (!window.confirm(`Clear all ${Object.keys(coaMapping).length} mappings? This cannot be undone.`)) return;
    setCoaMapping({});
    try {
      await supabase.from("audit_engagements").update({ coa_mapping: {} } as any).eq("id", engagementId);
      toast.success("All mappings cleared");
    } catch (e: any) {
      toast.error("Clear saved locally, failed to persist: " + e.message);
    }
  }, [coaMapping, engagementId]);

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
    toast.success(
      `Mapped "${ledgerName}" → ${lineItem.name}`,
      propagated > 0 ? { description: `Auto-applied to ${propagated} other unmapped ledgers in "${group}"` } : undefined,
    );
  }, [activeLeafItems, coaMapping, engagementId, tbAccounts]);

  // ═══════ AI MAPPING (Claude via claude-gateway) ═══════
  // Sends unmapped + low-confidence ledgers in batches to fs_line_mapper.
  // Returns {ledger, fs_code, confidence, reason}; we merge back into coaMapping.
  const runAiMapping = useCallback(async () => {
    if (aiRunning) return;
    const targets = tbAccounts.filter((a) => {
      if (hideZero && Math.abs(a.balance) < 0.005 && Math.abs(a.opening_balance ?? 0) < 0.005) return false;
      const m = coaMapping[a.account_name];
      if (!m) return true;
      if (m.confidence === "manual") return false;
      return m.confidence === "low";
    });
    if (targets.length === 0) { toast.info("Nothing left for AI to map"); return; }

    setAiRunning(true);
    const fsItems = activeLeafItems.map((i) => ({ code: i.code, name: i.name, section: i.section }));
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
        const payload = {
          entity_type: isNonCorporate ? "nce" : "corporate",
          fs_items:    fsItems,
          ledgers:     batch,
        };
        const { data, error } = await supabase.functions.invoke("claude-gateway", {
          body: { request_type: "fs_line_mapper", user_message: JSON.stringify(payload) },
        });
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
          // do not override manual mappings
          if (merged[ledgerName]?.confidence === "manual") continue;
          merged[ledgerName] = {
            code,
            noteRef:    lineItem.noteRef ?? null,
            scheduleRef: lineItem.scheduleRef || "",
            confidence: (r?.confidence as string) || "medium",
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
    toast.success(`Imported ${imported} mappings from prior year`);
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

  // ═══════ RECLASSIFY LEDGER ═══════
  const reclassifyAccount = async () => {
    if (!reclassifyDialog || !reclassifyCode) return;
    const { accountName } = reclassifyDialog;
    const lineItem = activeLeafItems.find(i => i.code === reclassifyCode);
    if (!lineItem) return;

    const newEntry = {
      code: reclassifyCode,
      noteRef: lineItem.noteRef,
      scheduleRef: lineItem.scheduleRef || "",
      confidence: "manual",
    };
    const newMapping = { ...coaMapping, [accountName]: newEntry };
    setCoaMapping(newMapping);
    // Auto-save to DB so the override survives page refresh
    try {
      await supabase.from("audit_engagements").update({ coa_mapping: newMapping } as any).eq("id", engagementId);
      toast.success(`Reclassified "${accountName}" → ${lineItem.name}`);
    } catch (e: any) {
      toast.error("Saved locally, failed to persist: " + e.message);
    }
    setReclassifyDialog(null);
    setReclassifyCode("");
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
  };

  // ═══════ COMPUTED FS AMOUNTS ═══════
  const computedAmounts: Record<string, number> = useMemo(() => {
    const amounts: Record<string, number> = {};
    
    // Aggregate TB accounts into FS line items
    for (const acct of tbAccounts) {
      const mapping = coaMapping[acct.account_name];
      if (!mapping) continue;
      amounts[mapping.code] = (amounts[mapping.code] || 0) + acct.balance;
    }

    // Apply manual overrides
    for (const [code, override] of Object.entries(manualOverrides)) {
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

    return amounts;
  }, [tbAccounts, coaMapping, manualOverrides, isNonCorporate]);

  // ═══════ STATS ═══════
  const mappedCount = tbAccounts.filter(a => coaMapping[a.account_name]).length;
  const unmappedCount = tbAccounts.length - mappedCount;
  const allMapped = unmappedCount === 0 && tbAccounts.length > 0;

  // Filtered accounts — respect hideZero + search
  const filteredAccounts = useMemo(() => {
    const s = search.toLowerCase();
    return tbAccounts.filter(a => {
      if (hideZero && Math.abs(a.balance) < 0.005 && Math.abs(a.opening_balance ?? 0) < 0.005) return false;
      if (!s) return true;
      return (
        a.account_name.toLowerCase().includes(s) ||
        a.account_group.toLowerCase().includes(s)
      );
    });
  }, [tbAccounts, search, hideZero]);

  // Left panel = exclusively UNMAPPED ledgers. Mapped ledgers live in the right
  // panel (grouped under their FS code) with ✕ unmap affordances.
  const unmappedAccounts = useMemo(
    () => filteredAccounts.filter(a => !coaMapping[a.account_name]),
    [filteredAccounts, coaMapping],
  );

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
  const saveMapping = async () => {
    setSaving(true);
    try {
      await supabase.from("audit_engagements").update({
        coa_mapping: coaMapping,
      } as any).eq("id", engagementId);
      toast.success("Mapping saved");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const generateFS = async () => {
    setSaving(true);
    try {
      // Delete existing FS rows
      await supabase.from("fa_financial_statements").delete().eq("engagement_id", engagementId);

      // Generate new rows
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
          amount_py: pyAmounts[item.code] || null,
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
  const tbDataAvailable = !!tbSnapshot || (tbLeafNodes?.length ?? 0) > 0 || (tallyTb?.length ?? 0) > 0;
  const stage2Complete = (engagement?.pipeline_stage ?? 0) >= 3 ||
    (engagement?.stage_statuses as any)?.["2"] === "complete";

  if (!tbSnapshotLoading && !tbLeafLoading && !tallyTbLoading && !tbDataAvailable && !stage2Complete) {
    return (
      <div className="max-w-4xl">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Trial Balance Required</AlertTitle>
          <AlertDescription>Please complete Stage 2 (Data Import) before proceeding to COA Mapping.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stage 6 — COA Mapping</h1>
          <p className="text-sm text-muted-foreground">
            {engagement.clients?.name} — FY {engagement.financial_year} •{" "}
            {isNonCorporate
              ? entityType                                                          // e.g. "Partnership"
              : engagement.schedule_iii_division === "div_ii"
                ? "Ind AS (Div II)"
                : "Schedule III (Div I)"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={saveMapping} disabled={saving}>Save Mapping</Button>
          <Button size="sm" onClick={handleCompleteStage3} disabled={!allMapped || saving} className="gap-1">
            Complete Stage 6 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{tbAccounts.length}</p>
          <p className="text-[10px] text-muted-foreground uppercase">TB Accounts</p>
        </CardContent></Card>
        <Card className={allMapped ? "border-primary/30" : ""}><CardContent className="p-3 text-center">
          <p className={cn("text-2xl font-bold", allMapped ? "text-primary" : "text-foreground")}>{mappedCount}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Mapped</p>
        </CardContent></Card>
        <Card className={unmappedCount > 0 ? "border-destructive/30" : ""}><CardContent className="p-3 text-center">
          <p className={cn("text-2xl font-bold", unmappedCount > 0 ? "text-destructive" : "text-foreground")}>{unmappedCount}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Unmapped</p>
        </CardContent></Card>
      </div>

      {/* COA Mapping (Financial Statements moved to Stage 5) */}
      <Tabs defaultValue="mapping">
        <TabsList>
          <TabsTrigger value="mapping" className="gap-1.5"><Link2 size={14} /> COA Mapping</TabsTrigger>
        </TabsList>

        {/* ═══════ COA MAPPING TAB ═══════ */}
        <TabsContent value="mapping" className="mt-4">
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <Button variant="outline" size="sm" onClick={runAutoMapping} className="gap-1">
              <RefreshCw size={12} /> Auto-Map All
            </Button>
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

            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => unmapByConfidence("low")}    className="text-amber-700 gap-1">Unmap Low</Button>
              <Button variant="ghost" size="sm" onClick={() => unmapByConfidence("medium")} className="text-amber-700 gap-1">Unmap Medium</Button>
              <Button variant="ghost" size="sm" onClick={clearAllMappings}                  className="text-destructive gap-1">Clear All</Button>
            </div>
          </div>

          <div className="flex gap-4" style={{ height: "calc(100vh - 22rem)" }}>
            {/* Left: UNMAPPED TB Accounts — mapping workspace */}
            <div className="w-1/2 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Unmapped Ledgers <Badge variant="outline" className="text-[9px] ml-1">{unmappedAccounts.length}</Badge>
                  </p>
                  <p className="text-[10px] text-muted-foreground">Select → click FS line item on right</p>
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
                      const isOpen = expandedGroups[g.group] ?? true;
                      const suggestedItem = g.dominantCode
                        ? activeLeafItems.find((i) => i.code === g.dominantCode) : null;
                      return (
                        <div key={g.group} className="border-b">
                          <div
                            onClick={() => setExpandedGroups((p) => ({ ...p, [g.group]: !isOpen }))}
                            className="px-3 py-2 bg-muted/40 hover:bg-muted/60 cursor-pointer flex items-center justify-between sticky top-0 z-10"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              <span className="text-xs font-semibold truncate">{g.group}</span>
                              <Badge variant="outline" className="text-[9px] px-1">{g.total} unmapped</Badge>
                              {suggestedItem && (
                                <span className="text-[10px] text-primary truncate">
                                  siblings → {suggestedItem.name}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={cn("font-mono text-[10px]", g.subtotal >= 0 ? "text-foreground" : "text-destructive")}>
                                ₹{Math.abs(g.subtotal).toLocaleString("en-IN")} {g.subtotal >= 0 ? "Dr" : "Cr"}
                              </span>
                              {suggestedItem && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); assignGroup(g.group, suggestedItem.code); }}
                                  className="text-[10px] text-primary hover:underline"
                                  title={`Apply "${suggestedItem.name}" to all ${g.total} unmapped ledgers in this group`}
                                >Apply to all</button>
                              )}
                              {selectedAccount && coaMapping[selectedAccount] && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); assignGroup(g.group, coaMapping[selectedAccount].code); }}
                                  className="text-[10px] text-primary hover:underline"
                                  title="Map entire group to the currently selected ledger's FS code"
                                >Map group</button>
                              )}
                            </div>
                          </div>
                          {isOpen && g.items.map((acct) => {
                            const mapping = coaMapping[acct.account_name];
                            const isSelected = selectedAccount === acct.account_name;
                            const isManualOverride = mapping?.confidence === "manual";
                            const lineItem = mapping ? activeLeafItems.find((i) => i.code === mapping.code) : null;
                            return (
                              <div
                                key={acct.account_name}
                                onClick={() => setSelectedAccount(acct.account_name)}
                                className={cn(
                                  "pl-6 pr-3 py-2 cursor-pointer text-xs hover:bg-muted/50 transition-colors border-t",
                                  isSelected && "bg-primary/10 border-l-2 border-l-primary",
                                  !isSelected && isManualOverride && "bg-violet-50 dark:bg-violet-950/20 border-l-2 border-l-violet-400",
                                  !mapping && "bg-destructive/5",
                                )}
                              >
                                <div className="flex items-center justify-between">
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
                                      title="Reclassify ledger"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setReclassifyDialog({ accountName: acct.account_name });
                                        setReclassifyCode(mapping?.code || "");
                                      }}
                                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground ml-1"
                                    ><Pencil size={10} /></button>
                                  </div>
                                </div>
                                {mapping ? (
                                  <div className="flex items-center gap-1 mt-1">
                                    <Badge variant="outline" className={cn("text-[8px] px-1",
                                      isManualOverride
                                        ? "border-violet-400 text-violet-600 dark:text-violet-400"
                                        : mapping.confidence === "high" ? "border-primary/40 text-primary"
                                        : mapping.confidence === "medium" ? "border-muted-foreground/40"
                                        : "border-destructive/40 text-destructive"
                                    )}>
                                      {isManualOverride ? "✎ manual" : mapping.confidence}
                                    </Badge>
                                    <span className="text-[10px] text-primary truncate">→ {lineItem?.name || mapping.code}</span>
                                    {mapping.noteRef && <Badge className="text-[8px] px-1 bg-muted text-muted-foreground">N{mapping.noteRef}</Badge>}
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
                    const isManualOverride = mapping?.confidence === "manual";
                    const lineItem = mapping ? activeLeafItems.find(i => i.code === mapping.code) : null;
                    return (
                      <div
                        key={acct.account_name}
                        onClick={() => setSelectedAccount(acct.account_name)}
                        className={cn(
                          "px-3 py-2 cursor-pointer text-xs hover:bg-muted/50 transition-colors",
                          isSelected && "bg-primary/10 border-l-2 border-l-primary",
                          !isSelected && isManualOverride && "bg-violet-50 dark:bg-violet-950/20 border-l-2 border-l-violet-400",
                          !mapping && "bg-destructive/5"
                        )}
                      >
                        <div className="flex items-center justify-between">
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
                              title="Reclassify ledger"
                              onClick={e => {
                                e.stopPropagation();
                                setReclassifyDialog({ accountName: acct.account_name });
                                setReclassifyCode(mapping?.code || "");
                              }}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground ml-1"
                            >
                              <Pencil size={10} />
                            </button>
                          </div>
                        </div>
                        {mapping ? (
                          <div className="flex items-center gap-1 mt-1">
                            <Badge variant="outline" className={cn("text-[8px] px-1",
                              isManualOverride
                                ? "border-violet-400 text-violet-600 dark:text-violet-400"
                                : mapping.confidence === "high" ? "border-primary/40 text-primary"
                                : mapping.confidence === "medium" ? "border-muted-foreground/40"
                                : "border-destructive/40 text-destructive"
                            )}>
                              {isManualOverride ? "✎ manual" : mapping.confidence}
                            </Badge>
                            <span className="text-[10px] text-primary truncate">→ {lineItem?.name || mapping.code}</span>
                            {mapping.noteRef && <Badge className="text-[8px] px-1 bg-muted text-muted-foreground">N{mapping.noteRef}</Badge>}
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
            <div className="w-1/2 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/30 flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  {isNonCorporate ? `NCE Line Items (${entityType})` : "Schedule III Line Items"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {selectedAccount
                    ? <>Click a line item to map <span className="font-semibold text-primary">"{selectedAccount}"</span></>
                    : <>Click a mapped ledger's <span className="text-destructive font-semibold">✕</span> to unmap</>}
                </p>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-1">
                  {activeFlatItems.map(item => {
                    const isHeader = item.children && item.children.length > 0;
                    const mappedAccounts = tbAccounts.filter(a => coaMapping[a.account_name]?.code === item.code);
                    const amount = computedAmounts[item.code] || 0;
                    const isExpanded = expandedGroups[`fs:${item.code}`] ?? (mappedAccounts.length > 0 && mappedAccounts.length <= 5);

                    return (
                      <div key={item.code}>
                        <div
                          onClick={() => {
                            if (selectedAccount && !isHeader) {
                              mapLedgerWithPropagation(selectedAccount, item.code, "manual");
                              setSelectedAccount(null);
                            } else if (!isHeader && mappedAccounts.length > 0) {
                              setExpandedGroups(p => ({ ...p, [`fs:${item.code}`]: !isExpanded }));
                            }
                          }}
                          className={cn(
                            "px-2 py-1.5 text-xs rounded-sm transition-colors",
                            isHeader ? "font-bold text-foreground mt-2" : "hover:bg-primary/10 cursor-pointer",
                            !isHeader && selectedAccount && "ring-1 ring-transparent hover:ring-primary/40",
                          )}
                          style={{ paddingLeft: `${item.depth * 16 + 8}px` }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isHeader && <ChevronDown size={12} />}
                              {!isHeader && mappedAccounts.length > 0 && (
                                isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
                              )}
                              <span className={cn("truncate", isHeader && "uppercase text-[11px]")}>{item.name}</span>
                              {item.noteRef && <Badge variant="outline" className="text-[8px] px-1 shrink-0">N{item.noteRef}</Badge>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {mappedAccounts.length > 0 && !isHeader && (
                                <Badge className="text-[8px] px-1 bg-primary/10 text-primary">{mappedAccounts.length} acct</Badge>
                              )}
                              {amount !== 0 && (
                                <span className={cn("font-mono text-[10px]", amount >= 0 ? "text-foreground" : "text-destructive")}>
                                  ₹{Math.abs(amount).toLocaleString("en-IN")}
                                  <span className="ml-0.5 text-[9px] opacity-70">{amount >= 0 ? "Dr" : "Cr"}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {!isHeader && isExpanded && mappedAccounts.length > 0 && (
                          <div className="bg-muted/20 border-l-2 border-primary/30 ml-2">
                            {mappedAccounts.map(a => {
                              const m = coaMapping[a.account_name];
                              const confClass =
                                m?.confidence === "manual" ? "bg-violet-100 text-violet-700 border-violet-300" :
                                m?.confidence === "high" ? "bg-primary/10 text-primary border-primary/30" :
                                m?.confidence === "medium" ? "bg-muted text-muted-foreground border-muted-foreground/30" :
                                "bg-destructive/10 text-destructive border-destructive/30";
                              return (
                                <div
                                  key={a.account_name}
                                  className="flex items-center justify-between px-3 py-1 text-[11px] hover:bg-background"
                                  style={{ paddingLeft: `${item.depth * 16 + 28}px` }}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="truncate">{a.account_name}</span>
                                    {a.account_group && (
                                      <span className="text-[9px] text-muted-foreground truncate">({a.account_group})</span>
                                    )}
                                    <Badge variant="outline" className={cn("text-[8px] px-1 shrink-0", confClass)}>
                                      {m?.confidence === "manual" ? "✎" : m?.confidence}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0 ml-2">
                                    <span className={cn("font-mono text-[10px]", a.balance >= 0 ? "text-foreground" : "text-destructive")}>
                                      ₹{Math.abs(a.balance).toLocaleString("en-IN")}
                                      <span className="ml-0.5 text-[9px]">{a.balance >= 0 ? "Dr" : "Cr"}</span>
                                    </span>
                                    <button
                                      title={`Unmap "${a.account_name}"`}
                                      onClick={(e) => { e.stopPropagation(); unmapAccount(a.account_name); }}
                                      className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                    >✕</button>
                                    <button
                                      title="Reclassify"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setReclassifyDialog({ accountName: a.account_name });
                                        setReclassifyCode(m?.code || "");
                                      }}
                                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                    ><Pencil size={9} /></button>
                                  </div>
                                </div>
                              );
                            })}
                            {mappedAccounts.length > 1 && (
                              <div
                                className="flex items-center justify-end px-3 py-1 text-[10px] text-destructive hover:underline cursor-pointer"
                                style={{ paddingLeft: `${item.depth * 16 + 28}px` }}
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
                  })}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Generate FS Button */}
          <div className="flex justify-end pt-3">
            <Button onClick={generateFS} disabled={!allMapped || saving} className="gap-1">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
              Generate Financial Statements
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Reclassify Ledger Dialog */}
      <Dialog
        open={!!reclassifyDialog}
        onOpenChange={() => { setReclassifyDialog(null); setReclassifyCode(""); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Reclassify Ledger Head</DialogTitle>
          </DialogHeader>
          {reclassifyDialog && (() => {
            const currentMapping = coaMapping[reclassifyDialog.accountName];
            const currentLineItem = currentMapping ? activeLeafItems.find(i => i.code === currentMapping.code) : null;
            const newLineItem = reclassifyCode ? activeLeafItems.find(i => i.code === reclassifyCode) : null;
            return (
              <div className="space-y-4 py-1">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Account</p>
                  <p className="text-sm font-semibold">{reclassifyDialog.accountName}</p>
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
                  <Select value={reclassifyCode} onValueChange={setReclassifyCode}>
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue placeholder="Select FS Line Item…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {activeLeafItems.map(item => (
                        <SelectItem key={item.code} value={item.code} className="text-xs">
                          {item.noteRef ? `[N${item.noteRef}] ` : ""}{item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              onClick={() => { setReclassifyDialog(null); setReclassifyCode(""); }}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={!reclassifyCode} onClick={reclassifyAccount} className="gap-1">
              <Pencil size={12} /> Save Reclassification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

// ─── Helpers ───
function confidenceRank(c: string): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}
