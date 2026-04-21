import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
import ExcelJS from "exceljs";
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

  // ─── Manual PY note-wise annexures (ledger-level breakdown per FS code) ──
  // Shape: { "<fs_code>": [{ ledger_name, amount, group? }] }
  type PyAnnexRow = { ledger_name: string; amount: number; group?: string };
  const [pyAnnexures,        setPyAnnexures]        = useState<Record<string, PyAnnexRow[]>>({});
  const [pyAnnexuresDirty,   setPyAnnexuresDirty]   = useState(false);
  const [pyAnnexuresSaving,  setPyAnnexuresSaving]  = useState(false);

  // ─── PY Data Source setup dialog ────────────────────────────────────────
  const [pySourceDialog,  setPySourceDialog]  = useState(false);
  const [creatingPyShell, setCreatingPyShell] = useState(false);

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

    const clientName = engagement?.clients?.name || "—";
    const fy = engagement?.financial_year || "—";
    const cyLabel = `As at 31 March, ${cyYear}`;
    const pyLabel = `As at 31 March, ${pyYear}`;

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

    // Emit a leaf line: "  name" at B, note at F, CY at G, PY at H.
    const writeLeaf = (it: FSLineItem & { depth: number }) => {
      const cy = fmt(computedAmounts[it.code] || 0);
      const py = fmt(mergedPY[it.code] || 0);
      bs.getCell(`B${row}`).value = "  ".repeat(Math.max(0, it.depth - 1)) + it.name;
      bs.mergeCells(`B${row}:E${row}`);
      bs.getCell(`F${row}`).value = it.noteRef ? it.noteRef : "";
      bs.getCell(`F${row}`).alignment = { horizontal: "center" };
      bs.getCell(`G${row}`).value = cy;
      bs.getCell(`H${row}`).value = py;
      bs.getCell(`G${row}`).numFmt = MONEY_FMT;
      bs.getCell(`H${row}`).numFmt = MONEY_FMT;
      row++;
    };
    const writeBlank = () => { row++; };
    const writeSectionHeader = (text: string) => {
      bs.getCell(`B${row}`).value = text;
      bs.getCell(`B${row}`).font = { bold: true };
      bs.mergeCells(`B${row}:H${row}`);
      row++;
    };
    const writeGroupHeader = (text: string) => {
      bs.getCell(`B${row}`).value = text;
      bs.getCell(`B${row}`).font = { bold: true, italic: true };
      bs.mergeCells(`B${row}:E${row}`);
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
        bs.getCell(`${a}${row}`).border = { top: thin, bottom: thin };
      }
      row++;
    };

    // Walk the NCE tree: top-level sections (EL / AST), sub-groups, leaves.
    const ownSum = (code: string): { cy: number; py: number } => {
      const item = activeFlatItems.find(i => i.code === code);
      if (!item) return { cy: 0, py: 0 };
      return {
        cy: fmt(computedAmounts[code] || 0),
        py: fmt(mergedPY[code] || 0),
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
    const plLeaf = (it: FSLineItem & { depth: number }, noteVisible = true) => {
      const [roman, rest] = splitRoman(it.name);
      pl.getCell(`B${pr}`).value = roman;
      pl.getCell(`B${pr}`).alignment = { horizontal: "center" };
      pl.getCell(`C${pr}`).value = rest;
      pl.mergeCells(`C${pr}:D${pr}`);
      pl.getCell(`E${pr}`).value = noteVisible && it.noteRef ? it.noteRef : "";
      pl.getCell(`E${pr}`).alignment = { horizontal: "center" };
      pl.getCell(`F${pr}`).value = fmt(computedAmounts[it.code] || 0);
      pl.getCell(`G${pr}`).value = fmt(mergedPY[it.code] || 0);
      pl.getCell(`F${pr}`).numFmt = MONEY_FMT;
      pl.getCell(`G${pr}`).numFmt = MONEY_FMT;
      pr++;
    };
    const plComputed = (it: FSLineItem & { depth: number }) => {
      const [roman, rest] = splitRoman(it.name);
      pl.getCell(`B${pr}`).value = roman;
      pl.getCell(`C${pr}`).value = rest;
      pl.mergeCells(`C${pr}:D${pr}`);
      pl.getCell(`F${pr}`).value = fmt(computedAmounts[it.code] || 0);
      pl.getCell(`G${pr}`).value = fmt(mergedPY[it.code] || 0);
      pl.getCell(`F${pr}`).numFmt = MONEY_FMT;
      pl.getCell(`G${pr}`).numFmt = MONEY_FMT;
      for (const a of ["B","C","D","E","F","G"]) {
        pl.getCell(`${a}${pr}`).font = { bold: true };
        pl.getCell(`${a}${pr}`).border = { top: thin };
      }
      pl.getCell(`B${pr}`).alignment = { horizontal: "center" };
      pr++;
    };
    const plSection = (text: string) => {
      pl.getCell(`B${pr}`).value = text;
      pl.getCell(`B${pr}`).font = { bold: true };
      pl.mergeCells(`B${pr}:G${pr}`);
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
      pr++;
      for (const c of ["NCE_CUR_TAX","NCE_PRIOR_TAX"]) {
        const it = find(c);
        if (!it) continue;
        pl.getCell(`C${pr}`).value = "       " + it.name;
        pl.mergeCells(`C${pr}:D${pr}`);
        pl.getCell(`F${pr}`).value = fmt(computedAmounts[it.code] || 0);
        pl.getCell(`G${pr}`).value = fmt(mergedPY[it.code] || 0);
        pl.getCell(`F${pr}`).numFmt = MONEY_FMT;
        pl.getCell(`G${pr}`).numFmt = MONEY_FMT;
        pr++;
      }
      pl.getCell(`C${pr}`).value = "       Total tax expense";
      pl.mergeCells(`C${pr}:D${pr}`);
      const taxCy = fmt(computedAmounts["NCE_TAX"] || 0);
      const taxPy = fmt(mergedPY["NCE_TAX"] || 0);
      pl.getCell(`F${pr}`).value = taxCy;
      pl.getCell(`G${pr}`).value = taxPy;
      pl.getCell(`F${pr}`).numFmt = MONEY_FMT;
      pl.getCell(`G${pr}`).numFmt = MONEY_FMT;
      for (const a of ["C","D","F","G"]) pl.getCell(`${a}${pr}`).font = { bold: true };
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
      // ─────────────────────── NOTE 1: Accounting Policies ───────────────────
      const n1 = wb.addWorksheet("Note 1", { views: [{ showGridLines: false }] });
      n1.columns = [
        { width: 2 },   // A spacer
        { width: 6 },   // B point number
        { width: 86 },  // C content (wide for wrapped text)
      ];
      let n1r = 2;
      n1.getCell(`B${n1r}`).value = clientName;
      n1.getCell(`B${n1r}`).font = { bold: true, size: 13 };
      n1.mergeCells(`B${n1r}:C${n1r}`);
      n1.getCell(`B${n1r}`).alignment = { horizontal: "center" };
      n1r++;
      n1.getCell(`B${n1r}`).value = "Note 1 — Summary of Significant Accounting Policies";
      n1.getCell(`B${n1r}`).font = { bold: true, size: 11 };
      n1.mergeCells(`B${n1r}:C${n1r}`);
      n1.getCell(`B${n1r}`).alignment = { horizontal: "center" };
      n1r++;
      n1.getCell(`B${n1r}`).value = `For the year ended 31 March, ${cyYear}`;
      n1.getCell(`B${n1r}`).font = { italic: true, size: 9 };
      n1.mergeCells(`B${n1r}:C${n1r}`);
      n1.getCell(`B${n1r}`).alignment = { horizontal: "right" };
      n1r += 2;

      const policies: { num: string; text: string }[] = [
        { num: "1.", text: "Basis of Preparation\nThe financial statements have been prepared under the historical cost convention on an accrual basis in accordance with generally accepted accounting principles applicable to Non-Corporate Entities in India." },
        { num: "2.", text: "Revenue Recognition\nRevenue from operations is recognised when it is earned and no significant uncertainty exists as to its ultimate realisation or collection. Interest income is recognised on a time proportionate basis taking into account the principal outstanding and the applicable rate." },
        { num: "3.", text: "Property, Plant & Equipment\nFixed assets are stated at cost less accumulated depreciation. Cost comprises the purchase price and any attributable costs of bringing the asset to its working condition for its intended use. Subsequent costs are included in the asset's carrying amount only when it is probable that future economic benefits associated with the item will flow to the entity." },
        { num: "4.", text: "Depreciation\nDepreciation on fixed assets is provided on the Written Down Value (WDV) method at rates prescribed under the Income Tax Act, 1961 / as estimated by management to reflect the useful economic lives of the assets. Depreciation on assets acquired / disposed of during the year is charged on a pro-rata basis." },
        { num: "5.", text: "Inventories\nInventories are valued at the lower of cost (computed on FIFO / weighted average basis) and net realisable value. Cost includes all costs of purchase and other costs incurred in bringing the inventories to their present location and condition." },
        { num: "6.", text: "Employee Benefits\nShort-term employee benefit obligations such as salaries, wages and bonus are recognised as an expense in the period in which the related services are rendered. Gratuity and other long-term benefit liabilities are recognised on an accrual basis or as per actuarial valuation, as applicable." },
        { num: "7.", text: "Borrowing Costs\nBorrowing costs directly attributable to acquisition or construction of qualifying assets are capitalised as part of the cost of such assets. Other borrowing costs are charged to the Statement of Profit and Loss in the period in which they are incurred." },
        { num: "8.", text: "Provisions and Contingent Liabilities\nProvisions are recognised when the entity has a present obligation as a result of a past event, it is probable that an outflow of resources will be required to settle the obligation and a reliable estimate can be made. Contingent liabilities are disclosed unless the possibility of an outflow of resources embodying economic benefits is remote." },
        { num: "9.", text: "Taxes on Income\nCurrent tax is determined on the basis of the taxable income computed in accordance with the Income Tax Act, 1961 using applicable tax rates and tax laws. Advance tax and tax deducted at source are shown as assets after adjustment against current tax provisions." },
        { num: "10.", text: "Foreign Currency Transactions\nTransactions denominated in foreign currencies are recorded at the exchange rate prevailing at the date of the transaction. Monetary assets and liabilities denominated in foreign currencies are restated at the exchange rate prevailing at the balance sheet date. Any income or expense on account of exchange difference is recognised in the Statement of Profit and Loss." },
        { num: "11.", text: "Cash and Cash Equivalents\nCash and cash equivalents for the purposes of cash flow statement comprise cash at bank, cash in hand and fixed deposits with an original maturity of three months or less that are readily convertible to known amounts of cash." },
        { num: "12.", text: "Use of Estimates\nThe preparation of financial statements requires the management to make estimates and assumptions that affect the reported balances of assets and liabilities, disclosures relating to contingent liabilities as at the date of the financial statements and the reported amounts of income and expenses during the year. Management believes that the estimates used in the preparation of financial statements are prudent and reasonable." },
      ];

      for (const p of policies) {
        n1.getCell(`B${n1r}`).value = p.num;
        n1.getCell(`B${n1r}`).font = { bold: true };
        n1.getCell(`B${n1r}`).alignment = { vertical: "top" };
        n1.getCell(`C${n1r}`).value = p.text;
        n1.getCell(`C${n1r}`).alignment = { wrapText: true, vertical: "top" };
        n1r += 2;
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
        nc.getCell(`${col}${ncr}`).border = { top: thin, bottom: thin };
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

      // ──────────────── NOTES TO ACCOUNTS (consolidated) ─────────────────────
      const na = wb.addWorksheet("Notes to Accounts", { views: [{ showGridLines: false }] });
      na.columns = [
        { width: 2 },   // A spacer
        { width: 46 },  // B Particulars (wide)
        { width: 2 },   // C continuation
        { width: 18 },  // D CY (Rs.)
        { width: 18 },  // E PY (Rs.)
      ];
      let nar = 2;
      na.getCell(`B${nar}`).value = clientName;
      na.getCell(`B${nar}`).font = { bold: true, size: 13 };
      na.mergeCells(`B${nar}:E${nar}`);
      na.getCell(`B${nar}`).alignment = { horizontal: "center" };
      nar++;
      na.getCell(`B${nar}`).value = "Notes to Accounts";
      na.getCell(`B${nar}`).font = { bold: true, size: 11 };
      na.mergeCells(`B${nar}:E${nar}`);
      na.getCell(`B${nar}`).alignment = { horizontal: "center" };
      nar++;
      na.getCell(`B${nar}`).value = `For the year ended 31 March, ${cyYear}`;
      na.getCell(`B${nar}`).font = { italic: true, size: 9 };
      na.mergeCells(`B${nar}:E${nar}`);
      na.getCell(`B${nar}`).alignment = { horizontal: "right" };
      nar += 2;

      // Notes 1 (policies), 2 (capital), and 10/11/12 (PPE/CWIP/Intangible)
      // have their own dedicated sheets — skip them in the consolidated sheet.
      const skipNotes = new Set([1, 2, 10, 11, 12]);
      const notedItemsNCE = activeFlatItems.filter(i => i.noteRef && !skipNotes.has(i.noteRef));

      for (const item of notedItemsNCE) {
        // Collect ledger rows mapped to this FS code
        const tbLedgerNames = new Set<string>();
        const noteRows: Array<{ ledger: string; cy: number; py: number }> = tbAccounts
          .filter(a => coaMapping[a.account_name]?.code === item.code)
          .map(a => {
            tbLedgerNames.add(String(a.account_name).toLowerCase().trim());
            return {
              ledger: a.account_name,
              cy: fmt(a.balance),
              py: fmt(a.opening_balance || 0),
            };
          });
        // Fold in PY-only manual annexures
        for (const r of pyAnnexures[item.code] || []) {
          const name = String(r.ledger_name || "").trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (tbLedgerNames.has(key)) {
            const ex = noteRows.find(l => l.ledger.toLowerCase().trim() === key);
            if (ex) ex.py = fmt(r.amount);
          } else {
            noteRows.push({ ledger: name, cy: 0, py: fmt(r.amount) });
          }
        }

        const totalCy = noteRows.length > 0
          ? noteRows.reduce((s, l) => s + l.cy, 0)
          : fmt(computedAmounts[item.code] || 0);
        const totalPy = noteRows.length > 0
          ? noteRows.reduce((s, l) => s + l.py, 0)
          : fmt(mergedPY[item.code] || 0);

        if (Math.abs(totalCy) < 0.005 && Math.abs(totalPy) < 0.005 && noteRows.length === 0) continue;

        // Note section heading (shaded row)
        na.getCell(`B${nar}`).value = `Note ${item.noteRef} — ${item.name}`;
        na.getCell(`B${nar}`).font = { bold: true };
        na.mergeCells(`B${nar}:E${nar}`);
        na.getCell(`B${nar}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
        nar++;

        // Sub-header row
        na.getCell(`B${nar}`).value = "Particulars";
        na.getCell(`D${nar}`).value = `31 March, ${cyYear} (Rs.)`;
        na.getCell(`E${nar}`).value = `31 March, ${pyYear} (Rs.)`;
        na.mergeCells(`B${nar}:C${nar}`);
        for (const col of ["B","C","D","E"]) {
          na.getCell(`${col}${nar}`).font = { bold: true };
          na.getCell(`${col}${nar}`).border = fullBorder;
          na.getCell(`${col}${nar}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        }
        nar++;

        // Data rows
        if (noteRows.length > 0) {
          for (const l of noteRows) {
            na.getCell(`B${nar}`).value = l.ledger;
            na.mergeCells(`B${nar}:C${nar}`);
            na.getCell(`D${nar}`).value = l.cy;
            na.getCell(`E${nar}`).value = l.py;
            na.getCell(`D${nar}`).numFmt = MONEY_FMT;
            na.getCell(`E${nar}`).numFmt = MONEY_FMT;
            nar++;
          }
        } else {
          na.getCell(`B${nar}`).value = item.name;
          na.mergeCells(`B${nar}:C${nar}`);
          na.getCell(`D${nar}`).value = totalCy;
          na.getCell(`E${nar}`).value = totalPy;
          na.getCell(`D${nar}`).numFmt = MONEY_FMT;
          na.getCell(`E${nar}`).numFmt = MONEY_FMT;
          nar++;
        }

        // Total row
        na.getCell(`B${nar}`).value = "Total";
        na.mergeCells(`B${nar}:C${nar}`);
        na.getCell(`D${nar}`).value = fmt(totalCy);
        na.getCell(`E${nar}`).value = fmt(totalPy);
        na.getCell(`D${nar}`).numFmt = MONEY_FMT;
        na.getCell(`E${nar}`).numFmt = MONEY_FMT;
        for (const col of ["B","C","D","E"]) {
          na.getCell(`${col}${nar}`).font = { bold: true };
          na.getCell(`${col}${nar}`).border = { top: thin, bottom: thin };
        }
        nar += 2; // blank spacer between notes
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
            {/* ── Manual PY P&L entry ──
                Shows when no prior engagement FS rows exist AND the user has
                not opted into py_shell or explicitly skipped (none). */}
            {noPriorEngagement &&
             (engagement as any)?.py_source !== "py_shell" &&
             (engagement as any)?.py_source !== "none" && (
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

            {/* ── Manual PY Annexures (ledger-level breakdown per FS code) ──
                Shown alongside manual P&L entry. Allows PY line items that
                don't exist in CY — each FS code can carry its own ledger list. */}
            {noPriorEngagement &&
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
