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
import EngagementHeader from "@/components/pipeline/EngagementHeader";
import * as XLSX from "xlsx";
import {
  ArrowRight, AlertTriangle, Download, FileSpreadsheet,
  Pencil, Loader2, BarChart3, Droplets,
} from "lucide-react";
import { NCE_FS_ITEMS } from "@/config/nceLineItems";
import type { FSLineItem } from "@/config/nceLineItems";

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

  // ─── Fetch Tally Trial Balance (for opening_balance = PY closing) ───
  // Same pattern as Stage 6 (PipelineStage3.tsx) — single source for CY close + PY open
  const { data: tallyTb, isLoading: tallyTbLoading } = useQuery({
    queryKey: ["tally-tb-fs", engagement?.client_id, engagement?.financial_year],
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
  // Includes opening_balance (signed; Cr → negative) so Stage 7 can derive PY
  // from the same coa_mapping as Stage 6. Opening = PY closing for BS items.
  const tbAccounts: {
    account_name: string; account_group: string;
    balance: number; opening_balance: number;
  }[] = useMemo(() => {
    if (tbSnapshot?.normalised_data) {
      return ((tbSnapshot.normalised_data as any[]) || []).map((r: any) => ({
        account_name: r.account_name || r.ledger_name || "",
        account_group: r.account_group || r.parent_group || "",
        balance: (r.debit || r.closing_dr || 0) - (r.credit || r.closing_cr || 0),
        opening_balance: Number(r.opening_balance ?? 0) *
                         (String(r.opening_type ?? "").toUpperCase() === "CR" ? -1 : 1),
      })).filter(a => a.account_name);
    }
    if (tbLeafNodes?.length) {
      return tbLeafNodes.map((n: any) => ({
        account_name: n.name || "",
        account_group: n.primary_group || n.group_name || "",
        balance: (n.txn_debit || 0) - (n.txn_credit || 0),
        opening_balance: Number(n.opening_balance ?? 0),
      })).filter(a => a.account_name);
    }
    if (tallyTb?.length) {
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
    }
    return [];
  }, [tbSnapshot, tbLeafNodes, tallyTb]);

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
  useEffect(() => {
    const raw = (engagement as any)?.py_manual_amounts;
    if (raw && typeof raw === "object") {
      const parsed: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n)) parsed[k] = n;
      }
      setPyManualAmounts(parsed);
      setPyManualDirty(false);
    }
  }, [(engagement as any)?.py_manual_amounts]);

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

  // ─── Save manual PY P&L amounts to audit_engagements.py_manual_amounts ──
  const savePyManual = async () => {
    setPyManualSaving(true);
    try {
      // Strip zero/empty so JSONB stays tidy
      const payload: Record<string, number> = {};
      for (const [k, v] of Object.entries(pyManualAmounts)) {
        const n = Number(v);
        if (Number.isFinite(n) && Math.abs(n) > 0.005) payload[k] = Math.round(n * 100) / 100;
      }
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

  // ─── Export to Excel (full annexures) ───
  // Emits: Cover · Balance Sheet · P&L · Notes Index · Note-wise ledger annexures
  //        · PY Reconciliation · Signature block. One self-contained workbook.
  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    const bsPrefix = isNonCorporate ? "NCE_BS_" : "BS_";
    const plPrefix = isNonCorporate ? "NCE_PL_" : "PL_";
    const bsItems = activeFlatItems.filter(i => i.section.startsWith(bsPrefix));
    const plItems = activeFlatItems.filter(i => i.section.startsWith(plPrefix));

    const fmt = (n: number) => Math.round((n || 0) * 100) / 100;

    // ── Cover sheet ──
    const clientName = engagement?.clients?.name || "—";
    const pan = engagement?.clients?.pan || engagement?.pan || "—";
    const fy  = engagement?.financial_year || "—";
    const ay  = (() => {
      const parts = fy.split("-");
      if (parts.length !== 2) return "—";
      const s = parseInt(parts[0]) + 1;
      const e = parseInt(parts[0]) + 2;
      return `${s}-${String(e).slice(-2)}`;
    })();
    const coverRows = [
      ["FINANCIAL STATEMENTS"],
      [],
      ["Client",           clientName],
      ["Entity Type",      entityType || "—"],
      ["PAN",              pan],
      ["Financial Year",   fy],
      ["Assessment Year",  ay],
      ["Framework",        isNonCorporate ? "Non-Corporate Entity (NCE)" : "Schedule III Div I"],
      ["CY",               `As at 31 March ${cyYear}`],
      ["PY",               `As at 31 March ${pyYear}`],
      ["Generated on",     new Date().toISOString().split("T")[0]],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(coverRows), "Cover");

    // ── BS / P&L primary statements ──
    const toRows = (items: typeof bsItems) =>
      items.map(i => ({
        "Code": i.code,
        "Line Item": "  ".repeat(i.depth) + i.name,
        "Note Ref": i.noteRef ? `N${i.noteRef}` : "",
        [`CY ${cyYear} (₹)`]: fmt(computedAmounts[i.code] || 0),
        [`PY ${pyYear} (₹)`]: fmt(mergedPY[i.code] || 0),
        "Variance (₹)": fmt((computedAmounts[i.code] || 0) - (mergedPY[i.code] || 0)),
        "Override": manualOverrides[i.code] ? "Yes" : "",
        "Override Reason": manualOverrides[i.code]?.reason || "",
      }));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(bsItems)), "Balance Sheet");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(plItems)), "P&L Statement");

    // ── Notes Index ──
    const notedItems = activeFlatItems.filter(i => i.noteRef);
    const noteIndex = notedItems.map(i => ({
      "Note": `N${i.noteRef}`,
      "Line Item": i.name,
      "Code": i.code,
      [`CY ${cyYear} (₹)`]: fmt(computedAmounts[i.code] || 0),
      [`PY ${pyYear} (₹)`]: fmt(mergedPY[i.code] || 0),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noteIndex), "Notes Index");

    // ── Note-wise ledger annexures ──
    // For each note, list the mapped ledgers with CY (closing) + PY (opening).
    // Ledgers come from tbAccounts; mapping from coaMapping.
    for (const item of notedItems) {
      const ledgers = tbAccounts
        .filter(a => coaMapping[a.account_name]?.code === item.code)
        .map(a => ({
          "Ledger": a.account_name,
          "Group":  a.account_group || "",
          [`CY ${cyYear} (₹)`]: fmt(a.balance),
          [`PY ${pyYear} (₹)`]: fmt(a.opening_balance || 0),
          "Variance (₹)": fmt(a.balance - (a.opening_balance || 0)),
          "Status": (Math.abs(a.opening_balance || 0) < 0.005 && Math.abs(a.balance) >= 0.005)
            ? "NEW"
            : (Math.abs(a.opening_balance || 0) >= 0.005 && Math.abs(a.balance) < 0.005)
              ? "CLOSED" : "",
        }));
      if (ledgers.length === 0) continue;
      // Append total row
      const totalCY = ledgers.reduce((s, l) => s + (l[`CY ${cyYear} (₹)`] as number), 0);
      const totalPY = ledgers.reduce((s, l) => s + (l[`PY ${pyYear} (₹)`] as number), 0);
      ledgers.push({
        "Ledger": "TOTAL",
        "Group":  "",
        [`CY ${cyYear} (₹)`]: fmt(totalCY),
        [`PY ${pyYear} (₹)`]: fmt(totalPY),
        "Variance (₹)": fmt(totalCY - totalPY),
        "Status": "",
      } as any);
      const sheetName = `N${item.noteRef} ${item.name}`.replace(/[\\/?*[\]:]/g, "").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ledgers), sheetName);
    }

    // ── PY Reconciliation (computed-from-opening vs prior-engagement audited) ──
    const reconRows = bsItems
      .filter(i => !i.children || i.children.length === 0)
      .map(i => {
        const fromOpening = computedAmountsPY[i.code] || 0;
        const fromAudited = pyAmounts[i.code]         || 0;
        return {
          "Code": i.code,
          "Line Item": i.name,
          "PY (from CY Opening Balance) (₹)": fmt(fromOpening),
          "PY (from Prior Audited FS) (₹)": fmt(fromAudited),
          "Difference (₹)": fmt(fromOpening - fromAudited),
          "Tallied": Math.abs(fromOpening - fromAudited) < 1 ? "✓" : "✗",
        };
      });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reconRows), "PY Reconciliation");

    // ── Signature block (NCE only) ──
    if (isNonCorporate) {
      const sigRows = [
        ["SIGNATURE BLOCK"], [],
        ["For,",             sigFirmName || ""],
        ["",                 "Chartered Accountants"],
        ["FRN",              sigFirmFRN  || ""],
        [],
        ["Partner",          sigPartnerName  || ""],
        ["Membership No.",   sigMembershipNo || ""],
        [],
        ["For Client,",      sigClientName || ""],
        ["Auth. Signatory",  sigSignatoryName || ""],
        ["Place",            sigPlace || ""],
        ["Date",             sigDate  || ""],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sigRows), "Signature");
    }

    const safeClient = String(clientName).replace(/[^a-z0-9]+/gi, "_").slice(0, 30);
    XLSX.writeFile(wb, `FS_${safeClient}_${fy || "FY"}.xlsx`);
    toast.success("Financial Statements exported with all annexures");
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

  const hasTbData = !!tbSnapshot || (tbLeafNodes?.length ?? 0) > 0 || (tallyTb?.length ?? 0) > 0;
  const stage3Complete =
    (engagement?.stage_statuses as any)?.["3"] === "complete" ||
    (engagement?.pipeline_stage ?? 0) >= 4;

  if (!tbSnapshotLoading && !tbLeafLoading && !tallyTbLoading && !hasTbData && !stage3Complete) {
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

  const isLoading = tbSnapshotLoading || tbLeafLoading || tallyTbLoading || fsLoading;

  // ─── FS row renderer ───
  const renderFSRows = (items: (FSLineItem & { depth: number })[]) =>
    items.map(item => {
      const isHeader = !!(item.children && item.children.length > 0);
      const amount = computedAmounts[item.code] || 0;
      const py = mergedPY[item.code] || 0;
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
            {/* ── Manual PY P&L entry (only when no prior engagement exists) ── */}
            {noPriorEngagement && (
              <Alert className="mb-3">
                <Pencil className="h-4 w-4" />
                <AlertTitle className="text-xs flex items-center justify-between">
                  <span>Enter PY P&L Amounts ({pyYear})</span>
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
          {!isNonCorporate && (
            <TabsContent value="cf" className="mt-3">
              <div className="flex flex-col items-center justify-center py-16 gap-3 border rounded-lg bg-muted/20">
                <Droplets size={32} className="text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">Cash Flow Statement</p>
                <p className="text-xs text-muted-foreground">Coming soon — will auto-derive from Balance Sheet movements</p>
              </div>
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
    </div>
  );
}
