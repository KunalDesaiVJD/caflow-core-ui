import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import * as XLSX from "xlsx";
import {
  ArrowRight, AlertTriangle, Download, FileSpreadsheet,
  Pencil, Loader2, BarChart3, Droplets,
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

// ═══════════════════════════════════════
// NCE Balance Sheet + P&L row definitions
// (used only when isNonCorporate === true; SCHEDULE_III_DIV_I is never touched)
// Sections are prefixed "NCE_BS_" / "NCE_PL_" — no collision with "BS_" / "PL_"
// ═══════════════════════════════════════
const NCE_FS_ITEMS: FSLineItem[] = [
  // ── NCE BALANCE SHEET — EQUITY AND LIABILITIES ──
  { code: "NCE_EL", name: "EQUITY AND LIABILITIES", noteRef: null, section: "NCE_BS_liabilities", children: [
    { code: "NCE_OWN", name: "(1) Owners Funds", noteRef: null, section: "NCE_BS_liabilities", children: [
      { code: "NCE_CAP", name: "(a) Owners' Capital Account", noteRef: 2, section: "NCE_BS_liabilities" },
    ]},
    { code: "NCE_NCL", name: "(2) Non-Current Liabilities", noteRef: null, section: "NCE_BS_liabilities", children: [
      { code: "NCE_LTB",  name: "(a) Long-term borrowings",       noteRef: 3, section: "NCE_BS_liabilities" },
      { code: "NCE_OLTL", name: "(b) Other long-term liabilities", noteRef: 4, section: "NCE_BS_liabilities" },
      { code: "NCE_LTP",  name: "(c) Long-term provisions",        noteRef: 5, section: "NCE_BS_liabilities" },
    ]},
    { code: "NCE_CL", name: "(3) Current Liabilities", noteRef: null, section: "NCE_BS_liabilities", children: [
      { code: "NCE_STB", name: "(a) Short-term borrowings",      noteRef: 6, section: "NCE_BS_liabilities" },
      { code: "NCE_TP",  name: "(b) Trade payables",             noteRef: 7, section: "NCE_BS_liabilities" },
      { code: "NCE_OCL", name: "(c) Other current liabilities",  noteRef: 8, section: "NCE_BS_liabilities" },
      { code: "NCE_STP", name: "(d) Short-term provisions",      noteRef: 9, section: "NCE_BS_liabilities" },
    ]},
  ]},
  // ── NCE BALANCE SHEET — ASSETS ──
  { code: "NCE_AST", name: "ASSETS", noteRef: null, section: "NCE_BS_assets", children: [
    { code: "NCE_NCA", name: "(1) Non-Current Assets", noteRef: null, section: "NCE_BS_assets", children: [
      { code: "NCE_PPE",   name: "(a)(i) Property, plant and equipment", noteRef: 10, section: "NCE_BS_assets" },
      { code: "NCE_CWIP",  name: "(a)(ii) Capital work-in-progress",     noteRef: 11, section: "NCE_BS_assets" },
      { code: "NCE_INTG",  name: "(a)(iii) Intangible assets",           noteRef: 12, section: "NCE_BS_assets" },
      { code: "NCE_NCINV", name: "(b) Non-current investments",          noteRef: 13, section: "NCE_BS_assets" },
      { code: "NCE_LTLA",  name: "(c) Long-term loans and advances",     noteRef: 14, section: "NCE_BS_assets" },
      { code: "NCE_ONCA",  name: "(d) Other non-current assets",         noteRef: 15, section: "NCE_BS_assets" },
    ]},
    { code: "NCE_CA", name: "(2) Current Assets", noteRef: null, section: "NCE_BS_assets", children: [
      { code: "NCE_CINV", name: "(a) Current investments",          noteRef: 16, section: "NCE_BS_assets" },
      { code: "NCE_STCK", name: "(b) Inventories",                  noteRef: 17, section: "NCE_BS_assets" },
      { code: "NCE_TR",   name: "(c) Trade receivables",            noteRef: 18, section: "NCE_BS_assets" },
      { code: "NCE_CASH", name: "(d) Cash and bank balances",       noteRef: 19, section: "NCE_BS_assets" },
      { code: "NCE_STLA", name: "(e) Short-term loans and advances",noteRef: 20, section: "NCE_BS_assets" },
      { code: "NCE_OCA",  name: "(f) Other current assets",         noteRef: 21, section: "NCE_BS_assets" },
    ]},
  ]},
  // ── NCE BS FOOTNOTE ──
  { code: "NCE_ACCTPOL", name: "Summary of Significant Accounting Policies", noteRef: 1, section: "NCE_BS_footnote" },
  // ── NCE PROFIT & LOSS — INCOME (I + II → NCE_PL_INC auto-summed by computeTotal) ──
  { code: "NCE_PL_INC", name: "III. Total Income (I + II)", noteRef: null, section: "NCE_PL_income", children: [
    { code: "NCE_REV_OPS", name: "I.   Revenue from operations", noteRef: 22, section: "NCE_PL_income" },
    { code: "NCE_REV_OTH", name: "II.  Other income",            noteRef: 23, section: "NCE_PL_income" },
  ]},
  // ── NCE PROFIT & LOSS — EXPENSES (a–e → NCE_PL_EXP auto-summed by computeTotal) ──
  { code: "NCE_PL_EXP", name: "IV. Total Expenses", noteRef: null, section: "NCE_PL_expenses", children: [
    { code: "NCE_COGS",     name: "(a) Cost of goods sold",            noteRef: 24, section: "NCE_PL_expenses" },
    { code: "NCE_EMP_EXP",  name: "(b) Employee benefits expense",     noteRef: 25, section: "NCE_PL_expenses" },
    { code: "NCE_FIN_COST", name: "(c) Finance costs",                 noteRef: 26, section: "NCE_PL_expenses" },
    { code: "NCE_DEPR",     name: "(d) Depreciation and amortisation", noteRef: 27, section: "NCE_PL_expenses" },
    { code: "NCE_OTH_EXP",  name: "(e) Other expenses",               noteRef: 28, section: "NCE_PL_expenses" },
  ]},
  // ── NCE PROFIT CHAIN (V → XIII; computed in useMemo after computeTotal) ──
  // "NCE_PL_profit" section prefix keeps these in the NCE_PL_ filter
  { code: "NCE_PROF_V",   name: "V.    Profit/(Loss) before exceptional items, partners' remuneration and tax", noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_EXCEP",    name: "VI.   Exceptional items",                                                      noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_PROF_VII", name: "VII.  Profit before extraordinary items and tax",                              noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_EXTORD",   name: "VIII. Extraordinary items",                                                    noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_PROF_IX",  name: "IX.   Profit before partners' remuneration and tax",                          noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_PART_REM", name: "X.    Partners' remuneration",                                                noteRef: 29,   section: "NCE_PL_profit" },
  { code: "NCE_PROF_XI",  name: "XI.   Profit before tax (IX − X)",                                           noteRef: null, section: "NCE_PL_profit" },
  // Tax group — children auto-summed into NCE_TAX by computeTotal
  { code: "NCE_TAX", name: "XII.  Tax expense", noteRef: null, section: "NCE_PL_profit", children: [
    { code: "NCE_CUR_TAX",   name: "(1) Current tax",                                   noteRef: null, section: "NCE_PL_profit" },
    { code: "NCE_PRIOR_TAX", name: "(2) Short/excess provision for earlier years",       noteRef: null, section: "NCE_PL_profit" },
  ]},
  { code: "NCE_NET_PROF", name: "XIII. Profit / (Loss) for the year (XI − XII)", noteRef: null, section: "NCE_PL_profit" },
];

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
// MAIN COMPONENT
// ═══════════════════════════════════════
export default function PipelineFinancialStatements({
  engagementId,
  engagement,
  onStageComplete,
  onSaveDraft,
}: PipelineFinancialStatementsProps) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  // ─── Entity-type gate ─────────────────────────────────────────────────────
  // Single source of truth: checks engagement.entity_type (set on the engagement)
  // then falls back to clients.entity_type (set on the client record).
  const entityType: string =
    (engagement?.entity_type || engagement?.clients?.entity_type || "").trim();
  const isNonCorporate: boolean = NON_CORPORATE_TYPES.includes(entityType);

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

  // ─── NCE Signature block editable state ──────────────────────────────────
  const [sigSignatoryName, setSigSignatoryName] = useState("");
  const [sigPlace,         setSigPlace]         = useState("");
  const [sigDate,          setSigDate]           = useState(() => new Date().toISOString().split("T")[0]);

  // ─── Fetch TB data (legacy snapshot path) ───
  const { data: tbSnapshot, isLoading: tbSnapshotLoading } = useQuery({
    queryKey: ["tb-snapshot-fs", engagementId],
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
  const { data: tbLeafNodes, isLoading: tbLeafLoading } = useQuery({
    queryKey: ["tb-leaf-nodes-fs", engagementId],
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

  // ─── Firm data (NCE signature block) ─────────────────────────────────────
  const { data: firmData } = useQuery({
    queryKey: ["firm-detail-fs", engagement?.firm_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("firms")
        .select("name, icai_firm_reg_no, address")
        .eq("id", engagement.firm_id)
        .maybeSingle();
      return data as any;
    },
    enabled: !!engagement?.firm_id && isNonCorporate,
  });

  // ─── Partner user data (NCE signature block) ──────────────────────────────
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
    enabled: !!(engagement as any)?.partner_id && isNonCorporate,
  });

  // ─── TB accounts ───
  const tbAccounts: { account_name: string; balance: number }[] = useMemo(() => {
    if (tbSnapshot?.normalised_data) {
      return ((tbSnapshot.normalised_data as any[]) || []).map((r: any) => ({
        account_name: r.account_name || r.ledger_name || "",
        balance: (r.debit || r.closing_dr || 0) - (r.credit || r.closing_cr || 0),
      })).filter(a => a.account_name);
    }
    if (tbLeafNodes?.length) {
      return tbLeafNodes.map((n: any) => ({
        account_name: n.name || "",
        balance: (n.txn_debit || 0) - (n.txn_credit || 0),
      })).filter(a => a.account_name);
    }
    return [];
  }, [tbSnapshot, tbLeafNodes]);

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
  const sigFirmName     = firmData?.name             || "";
  const sigFirmFRN      = firmData?.icai_firm_reg_no || "";
  const sigFirmCity     = (firmData?.address as any)?.city || "";
  const sigPartnerName  = partnerData?.name              || "";
  const sigMembershipNo = partnerData?.membership_number || "";
  const sigClientName   = engagement?.clients?.name      || "";

  // Pre-fill Place once firm data loads (only if user hasn't typed)
  useEffect(() => {
    if (sigFirmCity && !sigPlace) setSigPlace(sigFirmCity);
  }, [sigFirmCity]);

  // ─── Open override dialog ───
  const openOverride = (code: string, name: string) => {
    setOverrideDialog({ code, name });
    const existing = manualOverrides[code];
    setOverrideAmount(existing ? String(existing.amount) : "");
    setOverrideReason(existing?.reason || "");
  };

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
          amount_py: pyAmounts[item.code] || null,
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

  // ─── Export to Excel ───
  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();

    // Use activeFlatItems + appropriate section prefix for NCE vs corporate
    const bsPrefix = isNonCorporate ? "NCE_BS_" : "BS_";
    const plPrefix = isNonCorporate ? "NCE_PL_" : "PL_";
    const bsItems = activeFlatItems.filter(i => i.section.startsWith(bsPrefix));
    const plItems = activeFlatItems.filter(i => i.section.startsWith(plPrefix));

    const toRows = (items: typeof bsItems) =>
      items.map(i => ({
        "Code": i.code,
        "Line Item": "  ".repeat(i.depth) + i.name,
        "Note Ref": i.noteRef ? `N${i.noteRef}` : "",
        "CY Amount (₹)": computedAmounts[i.code] || 0,
        "PY Amount (₹)": pyAmounts[i.code] || 0,
        "Override": manualOverrides[i.code] ? "Yes" : "",
        "Override Reason": manualOverrides[i.code]?.reason || "",
      }));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(bsItems)), "Balance Sheet");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(plItems)), "P&L Statement");
    XLSX.writeFile(wb, `FinancialStatements_${engagement?.financial_year || "FY"}.xlsx`);
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

  const hasTbData = !!tbSnapshot || (tbLeafNodes?.length ?? 0) > 0;
  const stage3Complete =
    (engagement?.stage_statuses as any)?.["3"] === "complete" ||
    (engagement?.pipeline_stage ?? 0) >= 4;

  if (!tbSnapshotLoading && !tbLeafLoading && !hasTbData && !stage3Complete) {
    return (
      <div className="max-w-4xl">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>COA Mapping Required</AlertTitle>
          <AlertDescription>
            Please complete Stage 3 (COA Mapping) before viewing Financial Statements.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isLoading = tbSnapshotLoading || tbLeafLoading || fsLoading;

  // ─── FS row renderer ───
  const renderFSRows = (items: (FSLineItem & { depth: number })[]) =>
    items.map(item => {
      const isHeader = !!(item.children && item.children.length > 0);
      const amount = computedAmounts[item.code] || 0;
      const py = pyAmounts[item.code] || 0;
      const hasOverride = !!manualOverrides[item.code];

      return (
        <TableRow
          key={item.code}
          className={cn(
            isHeader && "bg-muted/40 font-semibold",
            !isHeader && "hover:bg-muted/20",
          )}
        >
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
          <TableCell className="text-right text-xs font-mono tabular-nums">
            {amount !== 0 ? (
              <span className={amount < 0 ? "text-destructive" : ""}>
                {amount < 0 ? "(" : ""}₹{Math.abs(amount).toLocaleString("en-IN")}{amount < 0 ? ")" : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
          <TableCell className="text-right text-xs font-mono tabular-nums text-muted-foreground">
            {py !== 0 ? (
              <span>
                {py < 0 ? "(" : ""}₹{Math.abs(py).toLocaleString("en-IN")}{py < 0 ? ")" : ""}
              </span>
            ) : (
              <span>—</span>
            )}
          </TableCell>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stage 7 — Financial Statements</h1>
          <p className="text-sm text-muted-foreground">
            {engagement.clients?.name} — FY {engagement.financial_year} •{" "}
            {isNonCorporate
              ? entityType                                                             // e.g. "Partnership"
              : engagement.schedule_iii_division === "div_ii"
                ? "Ind AS (Div II)"
                : "Schedule III (Div I)"}
          </p>
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
            <TabsTrigger value="cf" className="gap-1.5">
              <Droplets size={14} /> Cash Flow
            </TabsTrigger>
          </TabsList>

          {/* ── Balance Sheet ── */}
          <TabsContent value="bs" className="mt-3">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Particulars</TableHead>
                    <TableHead className="text-xs text-right">CY {cyYear} (₹)</TableHead>
                    <TableHead className="text-xs text-right">PY {pyYear} (₹)</TableHead>
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
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Particulars</TableHead>
                    <TableHead className="text-xs text-right">CY {cyYear} (₹)</TableHead>
                    <TableHead className="text-xs text-right">PY {pyYear} (₹)</TableHead>
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
                  {/* Net Profit / Loss summary row — corporate only.
                      NCE: row XIII (NCE_NET_PROF) is already rendered inline above. */}
                  {!isNonCorporate && (
                    <TableRow className="bg-muted/60 font-bold border-t-2">
                      <TableCell className="text-xs pl-2">NET PROFIT / (LOSS) FOR THE YEAR</TableCell>
                      <TableCell className={cn("text-right text-xs font-mono tabular-nums", activeNetProfit >= 0 ? "text-primary" : "text-destructive")}>
                        {activeNetProfit >= 0 ? "" : "("}₹{Math.abs(activeNetProfit).toLocaleString("en-IN")}{activeNetProfit < 0 ? ")" : ""}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono tabular-nums text-muted-foreground">—</TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {nceSignatureBlock}
          </TabsContent>

          {/* ── Cash Flow / Receipts & Payments ── */}
          <TabsContent value="cf" className="mt-3">
            <div className="flex flex-col items-center justify-center py-16 gap-3 border rounded-lg bg-muted/20">
              <Droplets size={32} className="text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">
                {isNonCorporate ? "Receipts & Payments Account" : "Cash Flow Statement"}
              </p>
              <p className="text-xs text-muted-foreground">Coming soon — will auto-derive from Balance Sheet movements</p>
            </div>
          </TabsContent>
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
    </div>
  );
}
