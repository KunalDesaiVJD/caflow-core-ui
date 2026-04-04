import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import * as XLSX from "xlsx";
import {
  ArrowRight, CheckCircle2, AlertTriangle, Search, Download, FileSpreadsheet,
  Link2, RefreshCw, Eye, Pencil, ChevronRight, ChevronDown, Loader2
} from "lucide-react";

// ═══════════════════════════════════════
// Schedule III Line Item Definitions
// ═══════════════════════════════════════

interface FSLineItem {
  code: string;
  name: string;
  noteRef: number | null;
  section: string;
  children?: FSLineItem[];
  scheduleRef?: string;
}

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
  const [activeView, setActiveView] = useState<"mapping" | "fs">("mapping");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [overrideDialog, setOverrideDialog] = useState<{ code: string; name: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideAmount, setOverrideAmount] = useState("");

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
  const tbAccounts: { account_name: string; account_group: string; debit: number; credit: number; balance: number }[] = useMemo(() => {
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
    return [];
  }, [tbSnapshot, tbLeafNodes]);

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
  const runAutoMapping = useCallback(() => {
    const newMapping: typeof coaMapping = {};
    for (const acct of tbAccounts) {
      const name = acct.account_name.toLowerCase();
      let bestMatch: { code: string; confidence: string } | null = null;
      
      for (const rule of AUTO_MAP_RULES) {
        if (rule.keywords.some(kw => name.includes(kw))) {
          if (!bestMatch || confidenceRank(rule.confidence) > confidenceRank(bestMatch.confidence)) {
            bestMatch = { code: rule.code, confidence: rule.confidence };
          }
        }
      }

      if (bestMatch) {
        const lineItem = LEAF_ITEMS.find(i => i.code === bestMatch!.code);
        newMapping[acct.account_name] = {
          code: bestMatch.code,
          noteRef: lineItem?.noteRef || null,
          scheduleRef: lineItem?.scheduleRef || "",
          confidence: bestMatch.confidence,
        };
      }
    }
    setCoaMapping(newMapping);
    toast.success(`Auto-mapped ${Object.keys(newMapping).length} of ${tbAccounts.length} accounts`);
  }, [tbAccounts]);

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
    const lineItem = LEAF_ITEMS.find(i => i.code === reclassifyCode);
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
    for (const rule of AUTO_MAP_RULES) {
      if (rule.keywords.some(kw => name.includes(kw))) {
        if (!bestMatch || confidenceRank(rule.confidence) > confidenceRank(bestMatch.confidence)) {
          bestMatch = { code: rule.code, confidence: rule.confidence };
        }
      }
    }

    let newMapping: typeof coaMapping;
    if (bestMatch) {
      const lineItem = LEAF_ITEMS.find(i => i.code === bestMatch!.code);
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

    // Compute parent totals
    const computeTotal = (item: FSLineItem): number => {
      if (!item.children || item.children.length === 0) {
        return amounts[item.code] || 0;
      }
      const total = item.children.reduce((sum, child) => sum + computeTotal(child), 0);
      amounts[item.code] = total;
      return total;
    };

    for (const item of SCHEDULE_III_DIV_I) {
      computeTotal(item);
    }

    return amounts;
  }, [tbAccounts, coaMapping, manualOverrides]);

  // ═══════ STATS ═══════
  const mappedCount = tbAccounts.filter(a => coaMapping[a.account_name]).length;
  const unmappedCount = tbAccounts.length - mappedCount;
  const allMapped = unmappedCount === 0 && tbAccounts.length > 0;

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    if (!search) return tbAccounts;
    const s = search.toLowerCase();
    return tbAccounts.filter(a => 
      a.account_name.toLowerCase().includes(s) || 
      a.account_group.toLowerCase().includes(s)
    );
  }, [tbAccounts, search]);

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

      for (const item of FLAT_ITEMS) {
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

      toast.success("Financial Statements generated");
      queryClient.invalidateQueries({ queryKey: ["fs-rows"] });
      setActiveView("fs");
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
    toast.success("Stage 3 completed");
    onStageComplete();
  };

  // ═══════ EXPORT ═══════
  const exportToExcel = () => {
    const wsData: any[][] = [
      ["", "Particulars", "Note No.", "Amount (CY) ₹", "Amount (PY) ₹"],
    ];

    for (const item of FLAT_ITEMS) {
      const indent = "  ".repeat(item.depth);
      const isHeader = item.children && item.children.length > 0;
      wsData.push([
        item.code,
        indent + item.name,
        item.noteRef || "",
        Math.round((computedAmounts[item.code] || 0) * 100) / 100,
        pyAmounts[item.code] || "",
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 12 }, { wch: 45 }, { wch: 10 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, "Financial Statements");
    XLSX.writeFile(wb, `FS_${engagement.clients?.name || "Client"}_${engagement.financial_year}.xlsx`);
    toast.success("Exported to Excel");
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

  // Stage gate: TB data available via either path OR Stage 2 explicitly completed
  const tbDataAvailable = !!tbSnapshot || (tbLeafNodes?.length ?? 0) > 0;
  const stage2Complete = (engagement?.pipeline_stage ?? 0) >= 3 ||
    (engagement?.stage_statuses as any)?.["2"] === "complete";

  if (!tbSnapshotLoading && !tbLeafLoading && !tbDataAvailable && !stage2Complete) {
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
          <h1 className="text-xl font-bold text-foreground">Stage 3 — COA Mapping & Financial Statements</h1>
          <p className="text-sm text-muted-foreground">
            {engagement.clients?.name} — FY {engagement.financial_year} •
            {engagement.schedule_iii_division === "div_ii" ? " Ind AS (Div II)" : " Schedule III (Div I)"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={saveMapping} disabled={saving}>Save Mapping</Button>
          <Button size="sm" onClick={handleCompleteStage3} disabled={!allMapped || saving} className="gap-1">
            Complete Stage 3 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
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
        <Card><CardContent className="p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{Object.keys(manualOverrides).length}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Manual Overrides</p>
        </CardContent></Card>
      </div>

      {/* View Tabs */}
      <Tabs value={activeView} onValueChange={(v: any) => setActiveView(v)}>
        <TabsList>
          <TabsTrigger value="mapping" className="gap-1.5"><Link2 size={14} /> COA Mapping</TabsTrigger>
          <TabsTrigger value="fs" className="gap-1.5"><Eye size={14} /> Financial Statements</TabsTrigger>
        </TabsList>

        {/* ═══════ COA MAPPING TAB ═══════ */}
        <TabsContent value="mapping" className="mt-4">
          <div className="flex gap-2 mb-3">
            <Button variant="outline" size="sm" onClick={runAutoMapping} className="gap-1">
              <RefreshCw size={12} /> Auto-Map All
            </Button>
            <Button variant="outline" size="sm" onClick={importPriorMapping} className="gap-1">
              <Download size={12} /> Import Prior Year Mapping
            </Button>
            {selectedAccount && coaMapping[selectedAccount] && (
              <Button variant="outline" size="sm" onClick={() => mapSimilar(selectedAccount)} className="gap-1">
                <Link2 size={12} /> Map Similar
              </Button>
            )}
          </div>

          <div className="flex gap-4" style={{ height: "calc(100vh - 22rem)" }}>
            {/* Left: TB Accounts */}
            <div className="w-1/2 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/30">
                <div className="relative">
                  <Search size={14} className="absolute left-2 top-2.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search accounts..."
                    className="pl-7 h-8 text-xs"
                  />
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="divide-y">
                  {filteredAccounts.map(acct => {
                    const mapping = coaMapping[acct.account_name];
                    const isSelected = selectedAccount === acct.account_name;
                    const isManualOverride = mapping?.confidence === "manual";
                    const lineItem = mapping ? LEAF_ITEMS.find(i => i.code === mapping.code) : null;
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
                            <p className="text-[10px] text-muted-foreground">{acct.account_group}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <div className="text-right">
                              <p className={cn("font-mono text-[11px]", acct.balance >= 0 ? "text-foreground" : "text-destructive")}>
                                ₹{Math.abs(acct.balance).toLocaleString("en-IN")}
                              </p>
                              {acct.balance < 0 && <span className="text-[9px] text-destructive">Cr</span>}
                            </div>
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
              </ScrollArea>
            </div>

            {/* Right: FS Line Items Tree */}
            <div className="w-1/2 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground">Schedule III Line Items — Click to assign selected account</p>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-1">
                  {FLAT_ITEMS.map(item => {
                    const isHeader = item.children && item.children.length > 0;
                    const mappedAccounts = tbAccounts.filter(a => coaMapping[a.account_name]?.code === item.code);
                    const amount = computedAmounts[item.code] || 0;

                    return (
                      <div
                        key={item.code}
                        onClick={() => {
                          if (selectedAccount && !isHeader) {
                            setCoaMapping(prev => ({
                              ...prev,
                              [selectedAccount]: {
                                code: item.code,
                                noteRef: item.noteRef,
                                scheduleRef: item.scheduleRef || "",
                                confidence: "high",
                              }
                            }));
                            toast.success(`Mapped "${selectedAccount}" → ${item.name}`);
                          }
                        }}
                        className={cn(
                          "px-2 py-1.5 text-xs rounded-sm cursor-pointer transition-colors",
                          isHeader ? "font-bold text-foreground mt-2" : "hover:bg-primary/10",
                          !isHeader && selectedAccount && "hover:ring-1 hover:ring-primary/30",
                        )}
                        style={{ paddingLeft: `${item.depth * 16 + 8}px` }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isHeader && <ChevronDown size={12} />}
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
                              </span>
                            )}
                          </div>
                        </div>
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

        {/* ═══════ FINANCIAL STATEMENTS TAB ═══════ */}
        <TabsContent value="fs" className="mt-4">
          <div className="flex justify-between mb-3">
            <div className="flex gap-2">
              <Badge variant="outline" className="text-[10px]">
                <span className="inline-block w-2 h-2 bg-primary/50 rounded mr-1" /> TB = Auto-mapped from Trial Balance
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                <span className="inline-block w-2 h-2 bg-accent rounded mr-1" /> M = Manual entry
              </Badge>
            </div>
            <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-1">
              <Download size={14} /> Export to Excel
            </Button>
          </div>

          {/* Balance Sheet */}
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wider">Balance Sheet as at 31st March {engagement.financial_year?.split("-")[0] ? parseInt(engagement.financial_year.split("-")[0]) + 1 : ""}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Note</TableHead>
                    <TableHead>Particulars</TableHead>
                    <TableHead className="text-right w-32">Amount (CY) ₹</TableHead>
                    <TableHead className="text-right w-32">Amount (PY) ₹</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FLAT_ITEMS.filter(i => i.section.startsWith("BS_")).map(item => {
                    const isHeader = item.children && item.children.length > 0;
                    const amount = computedAmounts[item.code] || 0;
                    const py = pyAmounts[item.code] || 0;
                    const isManual = !!manualOverrides[item.code];

                    return (
                      <TableRow key={item.code} className={cn(isHeader && "bg-muted/30 font-semibold")}>
                        <TableCell className="text-[10px] text-muted-foreground">{item.noteRef || ""}</TableCell>
                        <TableCell className="text-xs" style={{ paddingLeft: `${item.depth * 16 + 16}px` }}>
                          <span className={cn(isHeader && "uppercase text-[11px]")}>{item.name}</span>
                          {isManual && <Badge className="ml-1 text-[8px] px-1 bg-accent text-accent-foreground">M</Badge>}
                          {!isManual && !isHeader && amount !== 0 && <Badge variant="outline" className="ml-1 text-[8px] px-1">TB</Badge>}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {amount !== 0 ? `${amount < 0 ? "(" : ""}${Math.abs(Math.round(amount)).toLocaleString("en-IN")}${amount < 0 ? ")" : ""}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono text-muted-foreground">
                          {py !== 0 ? `${Math.abs(Math.round(py)).toLocaleString("en-IN")}` : "—"}
                        </TableCell>
                        <TableCell>
                          {!isHeader && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                setOverrideDialog({ code: item.code, name: item.name });
                                setOverrideAmount(String(manualOverrides[item.code]?.amount || computedAmounts[item.code] || 0));
                                setOverrideReason(manualOverrides[item.code]?.reason || "");
                              }}
                            >
                              <Pencil size={10} />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Profit & Loss */}
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wider">Statement of Profit and Loss for the year ended 31st March {engagement.financial_year?.split("-")[0] ? parseInt(engagement.financial_year.split("-")[0]) + 1 : ""}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Note</TableHead>
                    <TableHead>Particulars</TableHead>
                    <TableHead className="text-right w-32">Amount (CY) ₹</TableHead>
                    <TableHead className="text-right w-32">Amount (PY) ₹</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FLAT_ITEMS.filter(i => i.section.startsWith("PL_")).map(item => {
                    const isHeader = item.children && item.children.length > 0;
                    const amount = computedAmounts[item.code] || 0;
                    const py = pyAmounts[item.code] || 0;
                    const isManual = !!manualOverrides[item.code];

                    return (
                      <TableRow key={item.code} className={cn(isHeader && "bg-muted/30 font-semibold")}>
                        <TableCell className="text-[10px] text-muted-foreground">{item.noteRef || ""}</TableCell>
                        <TableCell className="text-xs" style={{ paddingLeft: `${item.depth * 16 + 16}px` }}>
                          <span className={cn(isHeader && "uppercase text-[11px]")}>{item.name}</span>
                          {isManual && <Badge className="ml-1 text-[8px] px-1 bg-accent text-accent-foreground">M</Badge>}
                          {!isManual && !isHeader && amount !== 0 && <Badge variant="outline" className="ml-1 text-[8px] px-1">TB</Badge>}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {amount !== 0 ? `${amount < 0 ? "(" : ""}${Math.abs(Math.round(amount)).toLocaleString("en-IN")}${amount < 0 ? ")" : ""}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono text-muted-foreground">
                          {py !== 0 ? `${Math.abs(Math.round(py)).toLocaleString("en-IN")}` : "—"}
                        </TableCell>
                        <TableCell>
                          {!isHeader && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                setOverrideDialog({ code: item.code, name: item.name });
                                setOverrideAmount(String(manualOverrides[item.code]?.amount || computedAmounts[item.code] || 0));
                                setOverrideReason(manualOverrides[item.code]?.reason || "");
                              }}
                            >
                              <Pencil size={10} />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Totals Summary */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-2">BALANCE SHEET CHECK</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span>Total Assets</span><span className="font-mono">₹{Math.abs(Math.round((computedAmounts["BS_NCA"] || 0) + (computedAmounts["BS_CA"] || 0))).toLocaleString("en-IN")}</span></div>
                  <div className="flex justify-between"><span>Total Equity & Liabilities</span><span className="font-mono">₹{Math.abs(Math.round((computedAmounts["BS_EQ"] || 0) + (computedAmounts["BS_NCL"] || 0) + (computedAmounts["BS_CL"] || 0))).toLocaleString("en-IN")}</span></div>
                  <Separator />
                  {(() => {
                    const assets = Math.round((computedAmounts["BS_NCA"] || 0) + (computedAmounts["BS_CA"] || 0));
                    const liab = Math.round((computedAmounts["BS_EQ"] || 0) + (computedAmounts["BS_NCL"] || 0) + (computedAmounts["BS_CL"] || 0));
                    const diff = Math.abs(assets - liab);
                    return (
                      <div className={cn("flex justify-between font-semibold", diff <= 1 ? "text-primary" : "text-destructive")}>
                        <span>Difference</span>
                        <span className="font-mono">₹{diff.toLocaleString("en-IN")} {diff <= 1 ? "✓" : "✗"}</span>
                      </div>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-2">P&L SUMMARY</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span>Total Revenue</span><span className="font-mono">₹{Math.abs(Math.round(computedAmounts["PL_REV"] || 0)).toLocaleString("en-IN")}</span></div>
                  <div className="flex justify-between"><span>Total Expenses</span><span className="font-mono">₹{Math.abs(Math.round(computedAmounts["PL_EXP"] || 0)).toLocaleString("en-IN")}</span></div>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>PAT</span>
                    <span className="font-mono">₹{Math.abs(Math.round(computedAmounts["PL_PAT"] || 0)).toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
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
            const currentLineItem = currentMapping ? LEAF_ITEMS.find(i => i.code === currentMapping.code) : null;
            const newLineItem = reclassifyCode ? LEAF_ITEMS.find(i => i.code === reclassifyCode) : null;
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
                      {LEAF_ITEMS.map(item => (
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
    </div>
  );
}

// ─── Helpers ───
function confidenceRank(c: string): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}
