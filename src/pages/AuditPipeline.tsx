// NOTE: Run this Supabase SQL before deploying:
// UPDATE audit_engagements SET
//   pipeline_stage = LEAST(pipeline_stage, 9),
//   stage_statuses = stage_statuses - '10'
// WHERE pipeline_stage IS NOT NULL;

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ensureAuditSetupForEngagement } from "@/lib/auditEngagementSync";
import { useAuth } from "@/hooks/useAuth";
import { useAuditContext } from "@/hooks/useAuditContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getClassificationForFY } from "@/utils/classificationUtils";
import { isCompanyEntity } from "@/utils/entityUtils";
import {
  CheckCircle2, Circle, Lock, ChevronRight, Plus, ArrowRight,
  Building2, FileText, Calculator, ClipboardCheck,
  Eye, BookMarked, Shield, Award, RefreshCw,
  Info, XCircle, Zap, ArrowUpRight,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EngagementReviewSignoff } from "@/components/engagement/EngagementReviewSignoff";
import EngagementHeader from "@/components/pipeline/EngagementHeader";
import PipelineStage2 from "@/components/pipeline/PipelineStage2";
import PipelineStage3 from "@/components/pipeline/PipelineStage3";
import PipelineFinancialStatements from "@/components/pipeline/PipelineFinancialStatements";
import PipelineStage4 from "@/components/pipeline/PipelineStage4";
import PipelineStage5 from "@/components/pipeline/PipelineStage5";
import PipelineStage6 from "@/components/pipeline/PipelineStage6";
import PipelineStage7Combined from "@/components/pipeline/PipelineStage7Combined";
import Form3Reports from "@/pages/Form3Reports";
import Form3CD from "@/pages/Form3CD";

// ─── Constants ───
const STAGES = [
  { num: 1,  label: 'Engagement Setup',           icon: Building2   },
  { num: 2,  label: 'Tally Sync',                  icon: RefreshCw   },
  { num: 3,  label: 'COA Mapping',                 icon: Calculator  },
  { num: 4,  label: 'Scrutiny Engine',             icon: Eye         },
  { num: 5,  label: 'Query Tracker',               icon: ClipboardCheck },
  { num: 6,  label: 'Workpapers & Audit Sheet',    icon: Shield      },
  { num: 7,  label: 'Notes to Accounts & CARO',   icon: BookMarked  },
  { num: 8,  label: '3CA / 3CB / 3CD Reports',    icon: FileText    },
  { num: 9,  label: 'Sign-off & UDIN',             icon: Award       },
  { num: 10, label: 'Financial Statements',        icon: Calculator  },
];

const FY_OPTIONS = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2020-21"];

const ENTITY_TYPES = [
  { value: "company", label: "Company (Pvt/Public)" },
  { value: "llp", label: "LLP" },
  { value: "individual", label: "Individual / Proprietor" },
  { value: "firm", label: "Partnership Firm" },
  { value: "trust", label: "Trust / Society" },
  { value: "huf", label: "HUF" },
  { value: "aop", label: "AOP / BOI" },
];

const AUDIT_TYPES = [
  { value: "statutory", label: "Statutory Audit" },
  { value: "tax_audit", label: "Tax Audit" },
  { value: "both", label: "Both (Statutory + Tax)" },
  { value: "internal", label: "Internal Audit" },
  { value: "stock", label: "Stock Audit" },
];

const PERIOD_TYPES = [
  { value: "annual",     label: "Full Year"  },
  { value: "half_yearly", label: "Half Year" },
  { value: "quarterly",  label: "Quarter"    },
  { value: "custom",     label: "Custom"     },
];

// ─── Filter audit types by client's audit setup ───
function getAuditOptionsForClient(client: any) {
  if (!client) return AUDIT_TYPES;
  const opts: { value: string; label: string }[] = [];
  // hasStat: client_fy_audit_setup flag OR direct clients.statutory_audit_applicable
  //          OR active statutory service
  const hasStat = !!client.statutory_audit_applicable || !!client.has_statutory_service;
  // hasTax:  client_fy_audit_setup flag OR clients.tax_audit_type being set
  //          OR active tax audit service
  const hasTax  = !!client.tax_audit_applicable || !!client.tax_audit_type || !!client.has_tax_audit_service;
  if (hasStat)           opts.push({ value: "statutory", label: "Statutory Audit" });
  if (hasTax)            opts.push({ value: "tax_audit", label: "Tax Audit" });
  if (hasStat && hasTax) opts.push({ value: "both",      label: "Both (Statutory + Tax)" });
  if (client.internal_audit_applicable || client.has_internal_audit_service)
                         opts.push({ value: "internal",  label: "Internal Audit" });
  if (client.stock_audit_applicable)
                         opts.push({ value: "stock",     label: "Stock Audit" });
  // Fallback: if none of the flags are set but client appears in eligible list
  // (e.g. via Audit classification only), offer all types
  if (opts.length === 0) return AUDIT_TYPES;
  return opts;
}

type StageStatus = "not_started" | "in_progress" | "complete" | "locked";

// ─── Helper ───
function YesNo({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <RadioGroup value={value} onValueChange={onChange} className="flex gap-6">
        <div className="flex items-center gap-2"><RadioGroupItem value="yes" /><Label className="cursor-pointer text-sm">Yes</Label></div>
        <div className="flex items-center gap-2"><RadioGroupItem value="no" /><Label className="cursor-pointer text-sm">No</Label></div>
      </RadioGroup>
    </div>
  );
}

// ─── Main ───
export default function AuditPipeline() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { engagementId: routeEngId } = useParams<{ engagementId?: string }>();
  const [searchParams] = useSearchParams();
  const isNewEngagementFlow = searchParams.get("new") === "1";
  const auditCtx = useAuditContext();
  const contextEngId = auditCtx?.selectedEngagementId || "";

  const [selectedEngId, setSelectedEngId] = useState<string>(routeEngId || (isNewEngagementFlow ? "" : contextEngId) || "");
  const [showNewEng, setShowNewEng] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeStage, setActiveStage] = useState<number>(() => {
    const sp = searchParams.get("stage");
    return sp ? parseInt(sp, 10) : 1;
  });

  // Sync from audit context when it changes
  useEffect(() => {
    if (isNewEngagementFlow || !contextEngId || routeEngId || selectedEngId) {
      return;
    }

    setSelectedEngId(contextEngId);
    navigate(`/audit/pipeline/${contextEngId}`, { replace: true });
  }, [contextEngId, isNewEngagementFlow, routeEngId, selectedEngId, navigate]);

  useEffect(() => {
    if (!isNewEngagementFlow || routeEngId) {
      return;
    }

    setSelectedEngId("");
    setActiveStage(1);
    setShowNewEng(true);
    if (auditCtx?.setSelectedEngagementId) {
      auditCtx.setSelectedEngagementId("");
    }
  }, [auditCtx, isNewEngagementFlow, routeEngId]);

  useEffect(() => {
    if (contextEngId && !routeEngId && !selectedEngId) {
      setSelectedEngId(contextEngId);
      navigate(`/audit/pipeline/${contextEngId}`, { replace: true });
    }
  }, [contextEngId, routeEngId, selectedEngId, navigate]);

  // ─── Engagement list ───
  const { data: engagements } = useQuery({
    queryKey: ["audit-engagements-list", user?.firm_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_engagements")
        .select("id, client_id, financial_year, audit_type, pipeline_stage, stage_statuses, final_locked, status, entity_type, clients(name)")
        // TODO: Supabase RLS policy needs superadmin bypass; guarded by enabled: !!user?.firm_id
        .eq("firm_id", user?.firm_id ?? "")
        // Hide PY shell engagements from the main audit list — they're managed
        // from the parent engagement's Stage 10 and don't have their own sign-off.
        .or("is_py_shell.is.null,is_py_shell.eq.false")
        .order("financial_year", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!user?.firm_id,
  });

  // ─── Stage 1 form state — must be declared before any useQuery that references form1A ───
  const [form1A, setForm1A] = useState({
    client_id: "", financial_year: "2024-25", audit_period_type: "annual", period_label: "",
    audit_type: "statutory", entity_type: "company", audit_firm_id: "", partner_id: "", partner_name: "", partner_membership_no: "",
  });
  const [questionnaire, setQuestionnaire] = useState<Record<string, any>>({});
  const [planning, setPlanning] = useState({
    materiality: "", perf_materiality_pct: "75", team_members: [] as string[],
    key_areas: "", risk_profile: "medium", risk_justification: "",
    expected_completion: "", review_dates: "",
  });
  // Stage 8: non-company clients can choose 3CA+3CD (audited under another law) or 3CB+3CD
  const [nonCorpFormChoice, setNonCorpFormChoice] = useState<"3ca" | "3cb">("3cb");

  // Client combobox (searchable dropdown in Create Engagement dialog)
  const [clientComboOpen, setClientComboOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");

  // ─── Clients with audit services enabled (for new engagement dropdown) ───
  // Mirrors the same four-source logic as useAuditContext so the dialog list
  // always matches the Audit Dashboard:
  //   1. clients.statutory_audit_applicable / clients.tax_audit_type  (ClientDetail direct saves)
  //   2. client_fy_audit_setup boolean flags  (wizard-based setup)
  // Show clients where at least one audit type is enabled on their profile,
  // OR where any client_fy_audit_setup row exists (catches clients whose
  // setup was saved but whose individual flags may still be pending).
  const { data: eligibleClients } = useQuery({
    queryKey: ["audit-eligible-clients", user?.firm_id, user?.id],
    queryFn: async () => {
      const firmId = user?.firm_id ?? "";

      // ── Step 1: Fetch ALL firm clients (no is_draft filter) ──────────────────
      // Previously we excluded `is_draft = true` clients (API-imported from
      // GSTN/TDS portals) and patched in those with engagements. This left
      // gaps: e.g. clients freshly imported via the GST/TDS sync who hadn't
      // had an engagement created yet (SHREEYAM INFRA, etc.) silently
      // disappeared from the dropdown despite having Tax/Statutory Audit
      // applicable flags set.
      //
      // The dropdown's job is "show every client this firm could create an
      // audit engagement for" — draft status is unrelated to that decision.
      // The eligibility filter below already restricts to clients with audit
      // applicability or active engagements, which is the correct gate.
      // ROOT-CAUSE FIX: PostgREST caps every SELECT at 1000 rows by default.
      // A single `.from("clients").select(...)` therefore silently dropped any
      // client beyond the 1000th row (ordered by name) — so firms with 1000+
      // clients lost everyone alphabetically late (e.g. "Vardan Developers")
      // from the Create-Engagement dropdown, even with Audit Setup completed.
      // Page through ALL rows so no client is ever missed.
      const PAGE = 1000;
      const fetchAllPaged = async (build: (from: number, to: number) => any): Promise<any[]> => {
        const all: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await build(from, from + PAGE - 1);
          if (error || !data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
        }
        return all;
      };

      const [allClients, engIdRows] = await Promise.all([
        fetchAllPaged((from, to) => {
          let q = supabase
            .from("clients")
            .select("id, name, entity_type, statutory_audit_applicable, tax_audit_applicable, internal_audit_applicable, tax_audit_type, is_draft")
            .is("deleted_at", null)
            .order("name", { ascending: true })
            .range(from, to);
          if (firmId) q = q.eq("firm_id", firmId);
          return q;
        }),
        fetchAllPaged((from, to) => {
          let q = supabase
            .from("audit_engagements")
            .select("client_id")
            .or("is_py_shell.is.null,is_py_shell.eq.false")
            .range(from, to);
          if (firmId) q = q.eq("firm_id", firmId);
          return q;
        }),
      ]);

      const allFirmClients = allClients ?? [];
      if (!allFirmClients.length) return [];

      const clientIds = allFirmClients.map((c: any) => c.id as string);
      // Set of all engagement client IDs for use in the eligibility filter
      const hasEngagementIds = new Set<string>(
        ((engIdRows ?? []) as any[]).map(r => r.client_id).filter(Boolean),
      );

      // ── Step 2: Parallel eligibility sources ───────────────────────────────
      // The `.in("client_id", clientIds)` filters are chunked: a clientIds array
      // of 1000+ UUIDs would blow past the request URL length limit (causing the
      // whole sub-query to fail) AND each sub-query is itself 1000-row capped.
      // Chunking keeps every firm's audit-setup / service / classification flags
      // intact no matter how many clients there are.
      const ID_CHUNK = 300;
      const idChunks: string[][] = [];
      for (let i = 0; i < clientIds.length; i += ID_CHUNK) idChunks.push(clientIds.slice(i, i + ID_CHUNK));
      const gatherIn = async (build: (ids: string[]) => any): Promise<{ data: any[] }> => {
        const rows: any[] = [];
        for (const ids of idChunks) {
          if (!ids.length) continue;
          const collected = await fetchAllPaged((from, to) => build(ids).range(from, to));
          rows.push(...collected);
        }
        return { data: rows };
      };

      const [classRes, classHistRes, auditSetupRes, auditSvcRes] = await Promise.all([
        // Source 3: FY classification snapshot — exact "Audit" only.
        // Wildcards like %audit% wrongly match "Non-Audit" and "Partner in
        // Audited Firm", so a client reclassified to Non-Audit would still
        // appear in the Audit pipeline.
        gatherIn((ids) => supabase
          .from("client_fy_classifications")
          .select("client_id")
          .ilike("classification", "Audit")
          .in("client_id", ids)),
        // Source 4: classification history (exact match — same reason as above)
        gatherIn((ids) => (supabase as any)
          .from("client_classification_history")
          .select("client_id")
          .ilike("new_classification", "Audit")
          .in("client_id", ids)),
        // Source 2: audit setup flags — IN clause scopes to firm clients (safer than RLS-only).
        gatherIn((ids) => supabase
          .from("client_fy_audit_setup")
          .select("client_id, statutory_audit_applicable, tax_audit_applicable, internal_audit_applicable, stock_audit_applicable")
          .in("client_id", ids)),
        // Source 5: active audit services — LEFT join so services with no category still appear.
        gatherIn((ids) => supabase
          .from("client_services")
          .select("client_id, is_active, service_categories(name, linked_module)")
          .in("client_id", ids)
          .eq("is_active", true)),
      ]);

      // Build per-client flags from setup table (source 2).
      // OR-aggregate across all FY rows — if ANY financial year has a flag set,
      // treat the client as eligible.  A plain overwrite would lose flags when
      // an older FY row (all-false) happens to appear last in the result set.
      const setupMap: Record<string, { statutory_audit_applicable: boolean; tax_audit_applicable: boolean; internal_audit_applicable: boolean; stock_audit_applicable: boolean }> = {};
      for (const row of (auditSetupRes.data ?? []) as any[]) {
        if (!row.client_id) continue;
        const ex = setupMap[row.client_id];
        setupMap[row.client_id] = {
          statutory_audit_applicable: !!(ex?.statutory_audit_applicable) || !!row.statutory_audit_applicable,
          tax_audit_applicable:       !!(ex?.tax_audit_applicable)       || !!row.tax_audit_applicable,
          internal_audit_applicable:  !!(ex?.internal_audit_applicable)  || !!row.internal_audit_applicable,
          stock_audit_applicable:     !!(ex?.stock_audit_applicable)     || !!row.stock_audit_applicable,
        };
      }

      // Build per-client flags from active services (source 5).
      //
      // 2026-06-04 — STRICT audit detection: only services explicitly tagged
      // as audit categories count. User reported DIXITA KUNAL DESAI (whose
      // only services are Bookkeeping + Income Tax Returns) appearing in the
      // Create Engagement dropdown. The previous rule fell through every
      // unknown service to hasStat=true, AND matched the loose "tax" keyword
      // which let "Income Tax Returns" pose as a tax-audit signal. Both are
      // wrong — audit eligibility must come from an EXPLICIT audit service /
      // setup flag, never bookkeeping or IT return filing.
      //
      // Match rules (case-insensitive):
      //   • Statutory audit  — linked_module === "statutory_audit"  OR
      //                         category name contains "statutory audit" (or = "statutory")
      //   • Tax audit        — linked_module === "tax_audit"        OR
      //                         category name contains "tax audit"   (NOT just "tax")
      //   • Internal audit   — linked_module === "internal_audit"   OR
      //                         category name contains "internal audit"
      //   • Stock audit      — linked_module === "stock_audit"      OR
      //                         category name contains "stock audit"
      //   • Everything else (Bookkeeping, IT Returns, GST, Payroll,
      //     Advisory, etc.) → NOT an audit signal, no flag flipped.
      const serviceMap: Record<string, { hasStat: boolean; hasTax: boolean; hasInternal: boolean; hasStock: boolean }> = {};
      for (const row of (auditSvcRes.data ?? []) as any[]) {
        if (!row.client_id) continue;
        const cat = row.service_categories;
        const n   = String((cat?.name as string) ?? "").toLowerCase().trim();
        const lm  = String((cat?.linked_module as string) ?? "").toLowerCase().trim();
        const isStatutory = lm === "statutory_audit" || n.includes("statutory audit") || n === "statutory";
        const isTaxAudit  = lm === "tax_audit"       || n.includes("tax audit");
        const isInternal  = lm === "internal_audit"  || n.includes("internal audit");
        const isStock     = lm === "stock_audit"     || n.includes("stock audit");
        if (!isStatutory && !isTaxAudit && !isInternal && !isStock) continue;
        if (!serviceMap[row.client_id]) {
          serviceMap[row.client_id] = { hasStat: false, hasTax: false, hasInternal: false, hasStock: false };
        }
        if (isStatutory) serviceMap[row.client_id].hasStat     = true;
        if (isTaxAudit)  serviceMap[row.client_id].hasTax      = true;
        if (isInternal)  serviceMap[row.client_id].hasInternal = true;
        if (isStock)     serviceMap[row.client_id].hasStock    = true;
      }

      return (allFirmClients as any[])
        .map(c => {
          const setup = setupMap[c.id] ?? {};
          const svc   = serviceMap[c.id] ?? {};
          // Source 1: direct columns on clients table
          // Columns confirmed to exist on the clients table:
          //   statutory_audit_applicable, internal_audit_applicable, tax_audit_type
          // Columns that do NOT exist on clients (only on client_fy_audit_setup):
          //   tax_audit_applicable, stock_audit_applicable
          const hasStatDirect     = !!c.statutory_audit_applicable;
          // tax_audit_applicable is now a real boolean column on clients
          // (migration 20260430130000) — backfilled from BOTH legacy sources
          // so it's the single source of truth.  The legacy tax_audit_type
          // (sub-type "3CA"/"3CB") is kept as a fallback for any pre-migration
          // row whose backfill might have missed.
          const hasTaxDirect      = !!(c as any).tax_audit_applicable || !!c.tax_audit_type;
          const hasInternalDirect = !!c.internal_audit_applicable;
          return {
            id:          c.id as string,
            name:        (c.name as string) ?? "",
            entity_type: (c.entity_type as string) ?? "",
            is_draft:    !!c.is_draft,
            tax_audit_type:              (c.tax_audit_type as string) ?? null,
            // merge all sources
            statutory_audit_applicable:  hasStatDirect     || !!setup.statutory_audit_applicable || !!svc.hasStat,
            tax_audit_applicable:        hasTaxDirect      || !!setup.tax_audit_applicable        || !!svc.hasTax,
            internal_audit_applicable:   hasInternalDirect || !!setup.internal_audit_applicable   || !!svc.hasInternal,
            stock_audit_applicable:                           !!setup.stock_audit_applicable || !!(svc as any).hasStock,
            has_statutory_service:       !!svc.hasStat,
            has_tax_audit_service:       !!svc.hasTax,
            has_internal_audit_service:  !!svc.hasInternal,
            has_any_service:             !!serviceMap[c.id],
            // true if ANY client_fy_audit_setup row exists for this client
            has_any_audit_setup:         !!setupMap[c.id],
            // true if client already has at least one audit engagement for this firm
            has_existing_engagement:     hasEngagementIds.has(c.id as string),
          };
        })
        .filter(c => {
          if (!Boolean((c.name as string)?.trim())) return false;
          // 2026-06-04 — Exclude Trust entity type from the Create Engagement
          // dropdown per user request. Trusts are tracked under a different
          // workflow and shouldn't surface here even if an audit flag is set
          // (e.g. from a legacy import).  Case-insensitive match so "Trust" /
          // "trust" / "Public Trust" all filter out.
          const et = String((c.entity_type as string) ?? "").toLowerCase().trim();
          if (et === "trust" || et.includes("trust")) return false;
          // Show only clients where Audit Setup is activated for at least
          // one audit type. The merged flags above pull from THREE sources
          // so this is robust against the older data inconsistencies:
          //   1. clients.* direct columns (now canonical, including the new
          //      tax_audit_applicable boolean — migration 20260430130000)
          //   2. client_fy_audit_setup (FY-keyed booleans)
          //   3. active client_services
          // Clients with an existing engagement also stay visible so users
          // can navigate to in-flight work even if the setup flags later
          // change.
          return (
            c.statutory_audit_applicable    ||
            c.tax_audit_applicable          ||
            c.internal_audit_applicable     ||
            c.stock_audit_applicable        ||
            (c as any).has_existing_engagement
          );
        });
    },
    enabled: !!user?.id,
  });

  // ─── Staff ───
  const { data: firmUsers } = useQuery({
    queryKey: ["firm-users", user?.firm_id],
    queryFn: async () => {
      // TODO: Supabase RLS policy needs superadmin bypass; guarded by enabled: !!user?.firm_id
      const { data } = await supabase.from("users").select("id, name, role").neq("role", "client").eq("firm_id", user?.firm_id ?? "").eq("is_active", true);
      return data || [];
    },
    enabled: !!user?.firm_id,
  });

  // ─── Audit firms (for engagement creation) ───
  // Union of (legacy) audit_firms table + firms table where is_audit_firm=true.
  // The Firm Management screen writes new audit firms into `firms` with
  // is_audit_firm=true, so without this union those firms (e.g. "AKTA RAMANI
  // & ASSOCIATES") would never appear in the engagement creation dropdown.
  const { data: auditFirmsForEng } = useQuery({
    queryKey: ["audit-firms-eng-all-v2"],
    queryFn: async () => {
      const [r1, r2] = await Promise.all([
        supabase.from("audit_firms").select("id, name").neq("active", false).order("name"),
        supabase.from("firms").select("id, name, is_audit_firm").eq("is_audit_firm", true).order("name"),
      ]);
      // firms (r2) takes priority over audit_firms (r1) because membership_numbers
      // lives in the firms table — using a firms.id ensures partnersForFirm can
      // resolve the partner roster. audit_firms rows only fill gaps.
      const byKey = new Map<string, { id: string; name: string }>();
      for (const f of (r2.data || [])) byKey.set((f.name || "").toLowerCase().trim(), { id: f.id, name: f.name });
      for (const f of (r1.data || [])) {
        const key = (f.name || "").toLowerCase().trim();
        if (!byKey.has(key)) byKey.set(key, { id: f.id, name: f.name });
      }
      return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!user?.id,
  });

  // ─── Partners from FIRM SETTINGS (firms.membership_numbers) ────────────────
  // Resolves to the SELECTED audit firm's partner roster (so picking AKTA
  // RAMANI shows its partners, not the user's own firm's partners). Falls
  // back to the user's logged-in firm when no audit firm is chosen yet.
  const selectedAuditFirmId = form1A.audit_firm_id || user?.firm_id || null;
  const { data: partnersForFirm = [] } = useQuery({
    queryKey: ["practice-firm-partners-v2", selectedAuditFirmId],
    queryFn: async () => {
      if (!selectedAuditFirmId) return [];
      const { data } = await supabase
        .from("firms")
        .select("membership_numbers")
        .eq("id", selectedAuditFirmId)
        .maybeSingle();
      if (!data?.membership_numbers) return [];
      return ((data.membership_numbers as any[]) || [])
        .filter((m: any) => m?.partner_name)
        .map((m: any) => ({
          partner_name:  m.partner_name  as string,
          membership_no: (m.membership_no as string) || null,
        }));
    },
    enabled: !!selectedAuditFirmId,
  });

  // ─── Selected engagement detail ───
  const { data: engagement, refetch: refetchEng } = useQuery({
    queryKey: ["audit-engagement-detail", selectedEngId],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_engagements")
        .select("*, clients(name, entity_type, caro_applicable, tax_audit_type, pan, gstin, cin, registered_state, date_of_incorporation, tan_number, address, registered_office, business_activity)")
        .eq("id", selectedEngId)
        .single();
      return data as any;
    },
    enabled: !!selectedEngId,
  });

  // ─── Prior-year engagement existence check (Block PY guidance) ─────────
  // Runs whenever the selected client + FY changes so the guidance card
  // can show a live "✓ Found / ✗ Not found" status without user action.
  const { data: priorEngCheck } = useQuery({
    queryKey: ["prior-eng-check-stage1", form1A.client_id, form1A.financial_year],
    queryFn: async () => {
      if (!form1A.client_id || !form1A.financial_year) return null;
      const fyParts = (form1A.financial_year as string).split("-");
      if (fyParts.length !== 2) return null;
      const prevFy = `${parseInt(fyParts[0]) - 1}-${String(parseInt(fyParts[0])).slice(-2)}`;
      const { data } = await supabase
        .from("audit_engagements")
        .select("id, financial_year, status, is_finalized, stage_statuses")
        .eq("client_id", form1A.client_id)
        .eq("financial_year", prevFy)
        .neq("status", "archived")
        .is("deleted_at" as any, null)
        .maybeSingle();
      return data as any;
    },
    enabled: !!form1A.client_id && !!form1A.financial_year,
  });

  useEffect(() => {
    if (routeEngId) {
      setSelectedEngId(routeEngId);
      // Global context update is deferred to after engagement data loads (see
      // the engagement-loaded effect below) so we can check is_py_shell first.
      // Writing a PY shell ID to localStorage caused the wrong client to appear
      // on Chrome refresh because PY shells are filtered out of the engagement
      // list and the fallback picked the first available engagement.
    }
  }, [routeEngId]);

  // After the engagement loads, update the global context — but ONLY for
  // regular engagements. PY shells must never overwrite the active client
  // selection because they are hidden from all audit lists and dashboards.
  useEffect(() => {
    if (!engagement) return;
    if ((engagement as any)?.is_py_shell) return; // skip PY shells
    if (!auditCtx?.setSelectedEngagementId) return;
    auditCtx.setSelectedEngagementId(engagement.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement?.id, (engagement as any)?.is_py_shell]);

  const stageStatuses: Record<string, StageStatus> = useMemo(() => {
    if (!engagement?.stage_statuses) {
      return Object.fromEntries(STAGES.map(s => [String(s.num), "not_started"]));
    }
    return engagement.stage_statuses as Record<string, StageStatus>;
  }, [engagement]);

  const currentStage = engagement?.pipeline_stage || 1;

  // Sync active view stage from URL search param or engagement data
  useEffect(() => {
    const sp = searchParams.get("stage");
    if (sp) {
      const stageNum = parseInt(sp, 10);
      if (stageNum >= 1 && stageNum <= 10) {
        setActiveStage(stageNum);
        return;
      }
    }
    setActiveStage(currentStage);
  }, [currentStage, searchParams]);

  // Load form from engagement
  // Issue 2 (CAFlow_FirmFix_Report): also gate on the options lists. When
  // editing, the engagement row resolves before the clients / audit-firms
  // queries; setting form1A.client_id to a uuid that isn't yet in the
  // <Select>'s option set leaves the field blank until the user touches it.
  // Gating the hydration on both lists ensures the Select value resolves
  // to a matching SelectItem on first render.
  useEffect(() => {
    if (!engagement) return;
    if ((eligibleClients?.length ?? 0) === 0) return;
    if ((auditFirmsForEng?.length ?? 0) === 0) return;
    setForm1A({
      client_id: engagement.client_id || "",
      financial_year: engagement.financial_year || "2024-25",
      audit_period_type: engagement.audit_period_type || "annual",
      period_label: engagement.period_label || "",
      audit_type: engagement.audit_type || "statutory",
      entity_type: engagement.entity_type || "company",
      audit_firm_id: engagement.audit_firm_id || "",
      partner_id:            engagement.partner_id            || "",
      partner_name:          engagement.partner_name          || "",
      partner_membership_no: engagement.partner_membership_no || "",
    });
    if (engagement.questionnaire_answers && typeof engagement.questionnaire_answers === "object") {
      setQuestionnaire(engagement.questionnaire_answers as Record<string, any>);
    }
    if (engagement.materiality) {
      const m = engagement.materiality as any;
      setPlanning(p => ({
        ...p,
        materiality: m.threshold || "",
        perf_materiality_pct: m.perf_pct || "75",
        key_areas: m.key_areas || "",
        risk_profile: engagement.risk_rating || "medium",
        risk_justification: m.risk_justification || "",
        expected_completion: engagement.planned_end || "",
      }));
    }
    if (engagement.team_members) {
      setPlanning(p => ({ ...p, team_members: engagement.team_members || [] }));
    }
  }, [engagement, eligibleClients, auditFirmsForEng]);

  // Auto-set entity_type when client is selected in creation dialog
  useEffect(() => {
    if (!form1A.client_id || !eligibleClients) return;
    const client = eligibleClients.find(c => c.id === form1A.client_id);
    if (client?.entity_type) {
      setForm1A(f => ({ ...f, entity_type: client.entity_type! }));
    }
  }, [form1A.client_id, eligibleClients]);

  // ── Block C (corporate-only) pre-fill ──────────────────────────────────────
  // Defaults per spec:
  //   • caro_applicable   → Yes for Public Ltd, No for Private Ltd (auto-prefill
  //                         from client_fy_audit_setup / clients.caro_applicable
  //                         when present; user can override).
  //   • ifc_applicable    → Yes
  //   • cash_flow_applicable → Yes
  // Only fires when the entity is corporate AND the answer hasn't been set yet,
  // so existing engagements (loaded via questionnaire_answers) aren't clobbered.
  useEffect(() => {
    if (!isCompanyEntity(form1A.entity_type)) return;
    const client = (eligibleClients || []).find((c: any) => c.id === form1A.client_id) as any;
    setQuestionnaire((q) => {
      const next = { ...q };
      if (!next.caro_applicable) {
        const clientCaro: boolean | null | undefined = client?.caro_applicable;
        if (typeof clientCaro === "boolean") {
          next.caro_applicable = clientCaro ? "yes" : "no";
        } else {
          // Spec default: Public Ltd → Yes, Private Ltd → No
          const et = (form1A.entity_type || "").toLowerCase().trim();
          next.caro_applicable = (et === "public ltd" || et === "public limited" || et === "public_ltd") ? "yes" : "no";
        }
      }
      if (!next.ifc_applicable) next.ifc_applicable = "yes";
      if (!next.cash_flow_applicable) next.cash_flow_applicable = "yes";
      return next;
    });
  }, [form1A.entity_type, form1A.client_id, eligibleClients]);

  // Auto-sync nonCorpFormChoice from preliminary questionnaire answer
  // When the user answers "Are you audited under any other act?" → auto-select 3CA or 3CB
  useEffect(() => {
    const et = (form1A.entity_type || "").toLowerCase().trim();
    const isCompany = ["company", "private ltd", "public ltd", "opc", "pvt_ltd", "public_ltd"].includes(et);
    if (!isCompany) {
      setNonCorpFormChoice(questionnaire.audited_under_other_act === "yes" ? "3ca" : "3cb");
    }
  }, [questionnaire.audited_under_other_act, form1A.entity_type]);

  // Auto-determine flags — handle both legacy values ("company","llp") and raw client values ("Private Ltd","LLP",etc.)
  const autoFlags = useMemo(() => {
    const et = (form1A.entity_type || "").toLowerCase().trim();
    const at = form1A.audit_type;
    // Companies (Pvt Ltd, Public Ltd, OPC) always use Form 3CA — mandatory under Companies Act
    const isCompany = ["company", "private ltd", "public ltd", "opc", "pvt_ltd", "public_ltd"].includes(et);
    const isLLP = ["llp"].includes(et);
    const isStatutory = at === "statutory" || at === "both";
    const isTaxAudit = at === "tax_audit" || at === "both";
    const turnover = parseFloat(questionnaire.turnover_cy || "0");

    return {
      requires_caro: isCompany && isStatutory,
      // Companies: 3CA always mandatory. Non-companies: only if radio = "yes" (audited under other act)
      requires_3ca: isCompany ? isTaxAudit : (isTaxAudit && questionnaire.audited_under_other_act === "yes"),
      // 3CB only for non-companies who are NOT audited under any other law
      requires_3cb: !isCompany && isTaxAudit && questionnaire.audited_under_other_act !== "yes",
      requires_3cd: isTaxAudit,
      requires_cash_flow: isCompany || (isLLP && turnover > 4000000),
      schedule_iii_division: questionnaire.ind_as_applicable === "yes" ? "div_ii" : "div_i",
    };
  }, [form1A.entity_type, form1A.audit_type, questionnaire]);

  const setQ = (key: string, val: string) => setQuestionnaire(q => ({ ...q, [key]: val }));

  // ─── Validation ───
  const block1AValid = form1A.client_id && form1A.financial_year && form1A.entity_type && form1A.audit_type && form1A.audit_firm_id;

  const blockAFields = ["board_changes"];
  const blockBFields = ["turnover_cy", "turnover_py", "total_assets", "has_inventory", "long_term_borrowings", "director_loans"];
  const blockAValid = blockAFields.every(f => questionnaire[f]);
  const blockBValid = blockBFields.every(f => questionnaire[f]);

  const isTaxAuditReq = form1A.audit_type === "tax_audit" || form1A.audit_type === "both";
  const blockDFields = ["turnover_exceeds_limit", "accounting_method"];
  const blockDValid = !isTaxAuditReq || blockDFields.every(f => questionnaire[f]);

  // Block C — Audit Applicability (corporate-only). Pre-filled by the effect
  // above, so the user only needs to confirm or override. When entity isn't
  // corporate the block is hidden entirely and validation auto-passes.
  const isCorporateForBlockC = isCompanyEntity(form1A.entity_type);
  const blockCFields = ["caro_applicable", "ifc_applicable", "cash_flow_applicable"];
  const blockCValid = !isCorporateForBlockC || blockCFields.every(f => questionnaire[f]);

  const questValid = blockAValid && blockBValid && blockCValid && blockDValid;
  const canCompleteStage1 = block1AValid && questValid;

  // ── Audit-firm id bridge ─────────────────────────────────────────────────
  // audit_engagements.audit_firm_id has a FK on audit_firms.id. When the
  // auditor picks a firm that lives only in the `firms` table (added via
  // Firm Management with is_audit_firm=true), the insert fails with
  //   "violates foreign key constraint audit_engagements_audit_firm_id_fkey".
  // Mirror it into audit_firms with the same id before save — idempotent.
  const ensureAuditFirmRow = async (firmId: string | null | undefined): Promise<string | null> => {
    if (!firmId) return null;
    const { data: existing } = await supabase.from("audit_firms").select("id").eq("id", firmId).maybeSingle();
    if (existing?.id) return firmId;
    const { data: src } = await supabase.from("firms").select("id, name").eq("id", firmId).maybeSingle();
    if (!src?.id) return firmId;
    await supabase.from("audit_firms").upsert({
      id:      src.id,
      name:    src.name,
      firm_id: user?.firm_id ?? null,
      active:  true,
    } as any, { onConflict: "id" });
    return firmId;
  };

  // ─── Create new engagement ───
  const createEngagement = useMutation({
    mutationFn: async () => {
      // Issue 1 (CAFlow_FirmFix_Report): no hardcoded firm fallback. If the
      // signed-in user has no firm_id we refuse to create the engagement —
      // silently parenting it to a hardcoded firm caused the "V.J. Desai
      // ghost" appearing across every export.
      const effectiveFirmId = user?.firm_id;
      if (!effectiveFirmId) {
        throw new Error("Your account has no firm assigned. Ask a Firm Admin to set your firm before creating engagements.");
      }

      // ── Required-field guard ────────────────────────────────────────────
      if (!form1A.audit_type) throw new Error("Please select an Audit Type.");
      if (!form1A.financial_year) throw new Error("Please select a Financial Year.");

      // ── FY-aware classification gate ────────────────────────────────────
      // The client's classification IN THE ENGAGEMENT'S FY must be "Audit".
      // Past engagements remain valid because history is consulted by FY —
      // a client switched to Non-Audit from FY 2026-27 can still have an
      // Audit engagement created for FY 2024-25 if they were Audit then.
      const clsForFY = await getClassificationForFY(form1A.client_id, form1A.financial_year);
      if (clsForFY !== "Audit") {
        throw new Error(
          `Cannot create audit engagement: client was classified as "${clsForFY}" in FY ${form1A.financial_year}, not "Audit".`,
        );
      }

      // ── DUPLICATE ENGAGEMENT GUARD (June 2026, hardened) ─────────────
      //
      // The previous check filtered on firm_id, audit_period_type AND
      // `status != "archived"`. Any of those three differences let a
      // duplicate row slip through:
      //   - firm_id mismatch when legacy rows had firm_id=NULL but the
      //     current user belongs to a firm (SWADESHI had this — three
      //     "duplicate" statutory engagements survived the check this way)
      //   - audit_period_type defaulted to "annual" on new rows but legacy
      //     rows had NULL → mismatch, insert allowed
      //   - status="archived" excluded any pre-fix archived sibling from
      //     view, letting the user create a NEW row in front of it
      //
      // New rule: a duplicate is anything sharing (client_id, FY,
      // audit_type, period_type) that is NOT a PY-shell, regardless of
      // firm or status. Archived siblings are surfaced with a clear
      // message so the user un-archives instead of creating a parallel.
      // A partial UNIQUE index in migration 20260604000001 enforces the
      // same rule at the DB layer as belt-and-braces.
      const checkPeriodType = form1A.audit_period_type || "annual";
      const { data: existing } = await supabase
        .from("audit_engagements")
        .select("id, status")
        .eq("client_id", form1A.client_id)
        .eq("financial_year", form1A.financial_year)
        .eq("audit_type", form1A.audit_type)
        .eq("audit_period_type", checkPeriodType)
        .or("is_py_shell.is.null,is_py_shell.eq.false")
        .limit(1);
      if (existing && existing.length > 0) {
        const sib = existing[0] as any;
        if (sib.status === "archived") {
          throw new Error(
            "An ARCHIVED engagement already exists for this client + FY + audit type. " +
            "Open Audit Intelligence, filter by archived, and restore it instead of creating a new one."
          );
        }
        throw new Error(
          "An engagement already exists for this client + FY + audit type + period. " +
          "Open it from Audit Intelligence instead of creating a duplicate."
        );
      }

      const safeAuditFirmId = await ensureAuditFirmRow(form1A.audit_firm_id);
      // UPSERT (not INSERT) so the partial unique index
      // `audit_engagements_unique_live` (migration 20260604000001, applied
      // to production 2026-06-04) acts as a race-condition backstop. If two
      // tabs / two users hit Create at the same moment for the same
      // (client, FY, audit_type, period_type), the second call no longer
      // raises a UNIQUE-violation error — it returns the existing row's id
      // and the UI navigates straight to that engagement. ignoreDuplicates:
      // false makes upsert RETURN the existing row (not silently skip) so
      // .select("id").single() still receives an id either way.
      const { data, error } = await (supabase as any).from("audit_engagements").upsert({
        client_id: form1A.client_id,
        firm_id: effectiveFirmId,
        financial_year: form1A.financial_year,
        audit_type: form1A.audit_type,
        entity_type: form1A.entity_type,
        audit_period_type: checkPeriodType,
        period_label: form1A.period_label || null,
        audit_firm_id: safeAuditFirmId,
        // partner_id kept for backward compat; partner_name is the primary display field
        partner_id:            form1A.partner_id            || null,
        partner_name:          form1A.partner_name          || null,
        partner_membership_no: form1A.partner_membership_no || null,
        status: "planning",
        pipeline_stage: 1,
        stage_statuses: { "1": "in_progress", "2": "not_started", "3": "not_started", "4": "not_started", "5": "not_started", "6": "not_started", "7": "not_started", "8": "not_started", "9": "not_started" },
      }, { onConflict: "client_id,financial_year,audit_type,audit_period_type", ignoreDuplicates: false }).select("id").single();
      if (error) throw error;

      // Ensure this client+FY has an audit-setup row so FY-scoped consumers
      // (e.g. the Audit Status 3CA/3CB+3CD lock) never fall back to a stale
      // engagement_type. Fills only if missing — never overwrites.
      await ensureAuditSetupForEngagement(form1A.client_id, form1A.financial_year, form1A.audit_type);

      // ── Carry-forward prior year COA mapping ─────────────────────────────
      // After the new engagement is inserted, find the immediately preceding FY
      // engagement for the same client and stamp every mapped ledger with
      // confidence: "carried_forward". This lets Stage 3 surface already-proven
      // mappings at the top with the highest confidence tier.
      let carriedForwardCount = 0;
      let prevFy: string | null = null;
      try {
        const fyParts = (form1A.financial_year || "").split("-");
        if (fyParts.length === 2) {
          const prevFyStart = parseInt(fyParts[0], 10) - 1;
          const prevFyEnd   = parseInt(fyParts[0], 10);
          prevFy = `${prevFyStart}-${String(prevFyEnd).slice(-2)}`;

          const { data: priorEng } = await supabase
            .from("audit_engagements")
            .select("coa_mapping")
            .eq("client_id", form1A.client_id)
            .eq("financial_year", prevFy)
            .eq("is_py_shell", false)
            .maybeSingle();

          if (priorEng?.coa_mapping && Object.keys(priorEng.coa_mapping as any).length > 0) {
            const priorMap = priorEng.coa_mapping as Record<string, any>;
            const carriedForward: Record<string, any> = {};
            for (const [ledger, mapping] of Object.entries(priorMap)) {
              carriedForward[ledger] = { ...mapping, confidence: "carried_forward" };
            }
            await supabase
              .from("audit_engagements")
              .update({ coa_mapping: carriedForward } as any)
              .eq("id", data.id);
            carriedForwardCount = Object.keys(carriedForward).length;
          }
        }
      } catch (_cfErr) {
        // Carry-forward is best-effort — never block engagement creation
      }

      return { ...data, carriedForwardCount, prevFy };
    },
    onSuccess: (data: any) => {
      if (data.carriedForwardCount > 0) {
        toast.success(
          `Engagement created — ${data.carriedForwardCount} COA mapping${data.carriedForwardCount > 1 ? "s" : ""} carried forward from FY ${data.prevFy}`,
        );
      } else {
        toast.success("Engagement created");
      }
      setSelectedEngId(data.id);
      if (auditCtx?.setSelectedEngagementId) {
        auditCtx.setSelectedEngagementId(data.id);
      }
      setActiveStage(1);
      setShowNewEng(false);
      queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] });
      navigate(`/audit/pipeline/${data.id}?stage=1`, { replace: true });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Save Stage 1 ───
  const saveStage1 = useCallback(async (complete: boolean) => {
    if (!selectedEngId) return;
    setSaving(true);
    const newStatuses = { ...stageStatuses, "1": complete ? "complete" : "in_progress" };
    const safeAuditFirmId = await ensureAuditFirmRow(form1A.audit_firm_id);

    const payload: Record<string, any> = {
      client_id: form1A.client_id,
      financial_year: form1A.financial_year,
      audit_type: form1A.audit_type,
      entity_type: form1A.entity_type,
      audit_period_type: form1A.audit_period_type,
      period_label: form1A.period_label || null,
      audit_firm_id: safeAuditFirmId,
      partner_name:          form1A.partner_name          || null,
      partner_membership_no: form1A.partner_membership_no || null,
      questionnaire_answers: questionnaire,
      // Sync PY data-source choice to the dedicated column so Stage 10 can
      // query it without parsing questionnaire JSON. Map questionnaire values
      // to canonical py_source strings (prior_engagement | py_shell | manual | none).
      py_source: (() => {
        const v = questionnaire.py_data_availability;
        if (v === "py_shell_import") return "py_shell";
        if (v === "py_tally_running") return "prior_engagement";
        if (v === "prior_engagement" || v === "manual" || v === "none") return v;
        return null;
      })(),
      stage_statuses: newStatuses,
      pipeline_stage: complete ? 2 : 1,
      requires_caro: autoFlags.requires_caro,
      requires_3ca: autoFlags.requires_3ca,
      requires_3cb: autoFlags.requires_3cb,
      requires_3cd: autoFlags.requires_3cd,
      requires_cash_flow: autoFlags.requires_cash_flow,
      schedule_iii_division: autoFlags.schedule_iii_division,
      // Block C — user-confirmed Audit Applicability flags (corporate only).
      // For non-corporate engagements we fall back to the auto-derived flag so
      // existing logic (Stage 7 CARO tab visibility, etc.) keeps working.
      // TODO migration: ALTER TABLE audit_engagements
      //   ADD COLUMN IF NOT EXISTS caro_applicable      BOOLEAN DEFAULT true;
      //   ADD COLUMN IF NOT EXISTS ifc_applicable       BOOLEAN DEFAULT true;
      //   ADD COLUMN IF NOT EXISTS cash_flow_applicable BOOLEAN DEFAULT true;
      // (caro_applicable already exists per types.ts; ifc_applicable and
      //  cash_flow_applicable need to be added before this column write
      //  succeeds. Until then PostgREST will return PGRST204 for the new keys.)
      caro_applicable: isCorporateForBlockC
        ? questionnaire.caro_applicable === "yes"
        : autoFlags.requires_caro,
      ifc_applicable: isCorporateForBlockC
        ? questionnaire.ifc_applicable === "yes"
        : null,
      cash_flow_applicable: isCorporateForBlockC
        ? questionnaire.cash_flow_applicable === "yes"
        : null,
      risk_rating: planning.risk_profile,
      team_members: planning.team_members,
      planned_end: planning.expected_completion || null,
      materiality: {
        threshold: planning.materiality,
        perf_pct: planning.perf_materiality_pct,
        key_areas: planning.key_areas,
        risk_justification: planning.risk_justification,
        review_dates: planning.review_dates,
      },
    };

    const { error } = await supabase.from("audit_engagements").update(payload as any).eq("id", selectedEngId);
    if (error) { toast.error(error.message); setSaving(false); return; }

    toast.success(complete ? "Stage 1 completed — proceed to TB Import" : "Progress saved");
    refetchEng();
    queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] });
    setSaving(false);
  }, [selectedEngId, form1A, questionnaire, planning, autoFlags, stageStatuses, isCorporateForBlockC]);

  const partners = (firmUsers || []).filter(u => ["partner_ca", "firm_admin"].includes(u.role));
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    (engagements || []).forEach(e => {
      const cname = e.clients?.name || "Unknown";
      const arr = map.get(cname) || [];
      arr.push(e);
      map.set(cname, arr);
    });
    return map;
  }, [engagements]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* MAIN — Stage Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedEngId ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-4">
            <div className="self-start mb-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/audit')} className="gap-1 text-xs">
                <ChevronRight size={14} className="rotate-180" /> Back to Audit Dashboard
              </Button>
            </div>
            <Building2 size={48} className="opacity-30" />
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Audit Intelligence Pipeline</h2>
              <p className="text-sm">Select an existing engagement or create a new one to begin.</p>
            </div>
            <Button onClick={() => setShowNewEng(true)} className="gap-2"><Plus size={16} /> New Engagement</Button>
          </div>
        ) : activeStage === 1 ? (
          /* STAGE 1 */
          <div className="max-w-4xl space-y-4">
            {engagement && <EngagementHeader engagement={engagement} stageNumber={1} stageLabel="Engagement Setup & Planning" />}
            <Button variant="ghost" size="sm" onClick={() => navigate('/audit')} className="gap-1 text-xs">
              <ChevronRight size={14} className="rotate-180" /> Audit Dashboard
            </Button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-foreground">Engagement Setup & Audit Planning</h1>
                <p className="text-xs text-muted-foreground">Complete the preliminary questionnaire and review the planning calendar.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => saveStage1(false)} disabled={saving}>Save Draft</Button>
                <Button size="sm" onClick={() => saveStage1(true)} disabled={saving || !canCompleteStage1} className="gap-1">
                  Complete & Proceed <ArrowRight size={14} />
                </Button>
              </div>
            </div>

            {/* 1A — Engagement Card (read-only when engagement exists) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">A</span>
                  Engagement Card
                  {engagement && <Badge variant="secondary" className="ml-auto text-[10px]"><Lock size={10} className="mr-1 inline" />Locked</Badge>}
                  {!engagement && (block1AValid ? <CheckCircle2 size={16} className="text-primary ml-auto" /> : <span className="text-xs text-destructive ml-auto">Required</span>)}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Client *</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">
                      {(eligibleClients || []).find(c => c.id === form1A.client_id)?.name || engagement?.clients?.name || form1A.client_id}
                    </div>
                  ) : (
                    <Popover open={clientComboOpen} onOpenChange={setClientComboOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={clientComboOpen}
                          className="w-full justify-between font-normal"
                        >
                          <span className="truncate">
                            {form1A.client_id
                              ? ((eligibleClients || []).find(c => c.id === form1A.client_id)?.name ?? "Select client")
                              : "Select client"}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[340px] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Search client..."
                            value={clientSearch}
                            onValueChange={setClientSearch}
                          />
                          <CommandList>
                            <CommandEmpty>No client found.</CommandEmpty>
                            <CommandGroup>
                              {(eligibleClients || [])
                                .filter(c =>
                                  !clientSearch.trim() ||
                                  c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
                                  (c.entity_type || "").toLowerCase().includes(clientSearch.toLowerCase())
                                )
                                .map(c => (
                                  <CommandItem
                                    key={c.id}
                                    value={c.id}
                                    onSelect={(v) => {
                                      setForm1A(f => ({ ...f, client_id: v }));
                                      setClientComboOpen(false);
                                      setClientSearch("");
                                    }}
                                  >
                                    <Check className={cn("mr-2 h-4 w-4", form1A.client_id === c.id ? "opacity-100" : "opacity-0")} />
                                    <span className="truncate">
                                      {c.name}{c.entity_type ? ` (${c.entity_type})` : ""}
                                    </span>
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
                <div>
                  <Label>Financial Year *</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">{form1A.financial_year}</div>
                  ) : (
                    <Select value={form1A.financial_year} onValueChange={v => setForm1A(f => ({ ...f, financial_year: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Entity Type *</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground capitalize">{ENTITY_TYPES.find(t => t.value === form1A.entity_type)?.label || form1A.entity_type}</div>
                  ) : (
                    <Select value={form1A.entity_type} onValueChange={v => setForm1A(f => ({ ...f, entity_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ENTITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Audit Type *</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground capitalize">{AUDIT_TYPES.find(t => t.value === form1A.audit_type)?.label || form1A.audit_type}</div>
                  ) : (
                    <Select value={form1A.audit_type} onValueChange={v => setForm1A(f => ({ ...f, audit_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{AUDIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Audit Firm *</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">
                      {(auditFirmsForEng || []).find(f => f.id === form1A.audit_firm_id)?.name || form1A.audit_firm_id || "—"}
                    </div>
                  ) : (
                    <Select value={form1A.audit_firm_id} onValueChange={v => setForm1A(f => ({ ...f, audit_firm_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select audit firm" /></SelectTrigger>
                      <SelectContent>
                        {(auditFirmsForEng || []).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {/* Engagement Partner — always editable (can be changed after creation) */}
                <div>
                  <Label>Engagement Partner</Label>
                  <Select
                    value={form1A.partner_name}
                    onValueChange={v => {
                      const mno = partnersForFirm.find(p => p.partner_name === v)?.membership_no || "";
                      setForm1A(f => ({ ...f, partner_name: v, partner_membership_no: mno }));
                    }}
                    disabled={partnersForFirm.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={partnersForFirm.length === 0 ? "Add partners in Settings → Audit Registration" : "Select partner"} />
                    </SelectTrigger>
                    <SelectContent>
                      {partnersForFirm.map(p => (
                        <SelectItem key={p.partner_name} value={p.partner_name}>
                          {p.partner_name}
                          {p.membership_no && (
                            <span className="ml-2 text-xs text-muted-foreground">({p.membership_no})</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {partnersForFirm.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Add partner membership numbers in Settings → Audit Registration.
                    </p>
                  )}
                </div>
                <div>
                  <Label>Period Type</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground capitalize">{PERIOD_TYPES.find(t => t.value === form1A.audit_period_type)?.label || form1A.audit_period_type}</div>
                  ) : (
                    <Select value={form1A.audit_period_type} onValueChange={v => setForm1A(f => ({ ...f, audit_period_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PERIOD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                {form1A.audit_period_type !== "annual" && (
                  <div>
                    <Label>Period Label</Label>
                    {engagement ? (
                      <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">{form1A.period_label || "—"}</div>
                    ) : (
                      <Select value={form1A.period_label} onValueChange={v => setForm1A(f => ({ ...f, period_label: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select period" /></SelectTrigger>
                        <SelectContent>
                          {form1A.audit_period_type === "half_yearly"
                            ? [<SelectItem key="H1" value="H1">H1</SelectItem>, <SelectItem key="H2" value="H2">H2</SelectItem>]
                            : [<SelectItem key="Q1" value="Q1">Q1</SelectItem>, <SelectItem key="Q2" value="Q2">Q2</SelectItem>, <SelectItem key="Q3" value="Q3">Q3</SelectItem>, <SelectItem key="Q4" value="Q4">Q4</SelectItem>]
                          }
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 1B — Questionnaire */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">B</span>
                  Preliminary Questions
                  {questValid ? <CheckCircle2 size={16} className="text-primary ml-auto" /> : <span className="text-xs text-destructive ml-auto">Required</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" defaultValue={["block-a"]} className="space-y-2">
                  {/* Block A — Legal */}
                  <AccordionItem value="block-a" className="border rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-semibold">
                      Block A — Legal & Constitution
                      {blockAValid && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                      <YesNo label="Any board composition changes during the year?" value={questionnaire.board_changes || ""} onChange={v => setQ("board_changes", v)} />
                      {/* Non-corporate only: determines 3CA vs 3CB selection in Stage 8 */}
                      {!["company", "private ltd", "public ltd", "opc", "pvt_ltd", "public_ltd"].includes((form1A.entity_type || "").toLowerCase().trim()) && (
                        <div className="space-y-3 border-t pt-3 mt-2">
                          <YesNo
                            label="Are accounts audited under any other act? (e.g. Companies Act, Societies Act, Co-op Societies Act)"
                            value={questionnaire.audited_under_other_act || ""}
                            onChange={v => setQ("audited_under_other_act", v)}
                          />
                          {questionnaire.audited_under_other_act === "yes" && (
                            <div className="space-y-1.5 pl-4">
                              <Label className="text-xs">Mention the Act under which accounts are audited</Label>
                              <Input
                                placeholder="e.g. Societies Registration Act, Co-op Societies Act..."
                                value={questionnaire.other_act_name || ""}
                                onChange={e => setQ("other_act_name", e.target.value)}
                                className="max-w-sm text-sm"
                              />
                              <p className="text-[11px] text-primary">
                                ✓ Stage 8 will auto-select <strong>Form 3CA + 3CD</strong> (audited under another law)
                              </p>
                            </div>
                          )}
                          {questionnaire.audited_under_other_act === "no" && (
                            <p className="text-[11px] text-muted-foreground pl-4">
                              Stage 8 will use <strong>Form 3CB + 3CD</strong> (not audited under any other law)
                            </p>
                          )}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  {/* Block B — Financial */}
                  <AccordionItem value="block-b" className="border rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-semibold">
                      Block B — Financial Overview
                      {blockBValid && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Turnover (CY) ₹</Label><Input type="number" value={questionnaire.turnover_cy || ""} onChange={e => setQ("turnover_cy", e.target.value)} placeholder="Current year" /></div>
                        <div><Label>Turnover (PY) ₹</Label><Input type="number" value={questionnaire.turnover_py || ""} onChange={e => setQ("turnover_py", e.target.value)} placeholder="Previous year" /></div>
                      </div>
                      <div><Label>Total Assets ₹</Label><Input type="number" value={questionnaire.total_assets || ""} onChange={e => setQ("total_assets", e.target.value)} /></div>
                      <YesNo label="Inventory held at year end?" value={questionnaire.has_inventory || ""} onChange={v => setQ("has_inventory", v)} />
                      <YesNo label="Long-term borrowings outstanding?" value={questionnaire.long_term_borrowings || ""} onChange={v => setQ("long_term_borrowings", v)} />
                      <YesNo label="Loans to/from directors or related parties?" value={questionnaire.director_loans || ""} onChange={v => setQ("director_loans", v)} />
                    </AccordionContent>
                  </AccordionItem>

                  {/* Block PY — Prior-Year Data Source ────────────────────
                   *  Determines how Stage 10 builds the PY comparative. Five paths:
                   *   • prior_engagement  — FY-1 engagement already in CAFlow
                   *   • py_tally_running  — running Tally; BS opens from Tally, P&L manual
                   *   • py_shell_import   — split/new Tally; create cut-down FY-1 shell
                   *   • manual            — no Tally; user types P&L + annexures
                   *   • none              — first-year / skip comparative
                   * Stage 10 reads questionnaire.py_data_availability for guidance. */}
                  <AccordionItem value="block-py" className="border rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-semibold">
                      Block PY — Prior-Year Data Source
                      {questionnaire.py_data_availability && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">

                      {/* ── Dropdown ── */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">How is prior-year (comparative) data available?</Label>
                        <Select
                          value={questionnaire.py_data_availability || ""}
                          onValueChange={v => setQ("py_data_availability", v)}
                        >
                          <SelectTrigger><SelectValue placeholder="Select PY data source…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="prior_engagement">Prior audit engagement exists in CAFlow (FY-1)</SelectItem>
                            <SelectItem value="py_tally_running">Running Tally — opening balances carry PY BS; P&L still needed</SelectItem>
                            <SelectItem value="py_shell_import">Split / new Tally — import full PY as a PY shell engagement</SelectItem>
                            <SelectItem value="manual">No Tally / no prior engagement — enter PY amounts manually</SelectItem>
                            <SelectItem value="none">First-year engagement — no PY comparative</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* ── Option 1: prior_engagement ── */}
                      {questionnaire.py_data_availability === "prior_engagement" && (() => {
                        const fyParts = (form1A.financial_year || "").split("-");
                        const prevFy = fyParts.length === 2
                          ? `${parseInt(fyParts[0]) - 1}-${String(parseInt(fyParts[0])).slice(-2)}`
                          : "prior FY";
                        const found = !!priorEngCheck;
                        const isFinalized = !!(priorEngCheck as any)?.is_finalized;
                        return (
                          <div className="rounded-lg border p-3 space-y-3 text-xs bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-900">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                              <p className="font-semibold text-sm">Fully Automatic — Prior Engagement</p>
                              {found ? (
                                <Badge className="ml-auto text-[9px] bg-green-100 text-green-700 border-green-300 dark:bg-green-950/40 dark:text-green-400">
                                  ✓ FY {prevFy} found
                                </Badge>
                              ) : (
                                <Badge className="ml-auto text-[9px] bg-destructive/10 text-destructive border-destructive/30">
                                  ✗ FY {prevFy} not found
                                </Badge>
                              )}
                              {isFinalized && (
                                <Badge className="text-[9px] bg-amber-100 text-amber-700 border-amber-300">
                                  🔒 Finalized
                                </Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                              <div>
                                <p className="text-muted-foreground font-medium uppercase tracking-wide text-[9px] mb-1">CAFlow handles automatically</p>
                                <ul className="space-y-0.5 text-foreground">
                                  <li className="flex items-start gap-1"><CheckCircle2 size={10} className="text-green-500 mt-0.5 shrink-0" /> PY FS sourced from FY-1 Financial Statements</li>
                                  <li className="flex items-start gap-1"><CheckCircle2 size={10} className="text-green-500 mt-0.5 shrink-0" /> COA mapping carried forward (🔁 confidence tier)</li>
                                  <li className="flex items-start gap-1"><CheckCircle2 size={10} className="text-green-500 mt-0.5 shrink-0" /> BS &amp; P&amp;L comparative columns fully populated</li>
                                  {isFinalized && <li className="flex items-start gap-1"><Lock size={10} className="text-amber-500 mt-0.5 shrink-0" /> PY column locked (prior year finalized)</li>}
                                </ul>
                              </div>
                              <div>
                                <p className="text-muted-foreground font-medium uppercase tracking-wide text-[9px] mb-1">Action needed</p>
                                {found ? (
                                  <p className="text-green-700 dark:text-green-400">None — everything is fully automatic.</p>
                                ) : (
                                  <ul className="space-y-0.5 text-destructive">
                                    <li className="flex items-start gap-1"><XCircle size={10} className="mt-0.5 shrink-0" /> Create the FY {prevFy} engagement for this client</li>
                                    <li className="flex items-start gap-1"><XCircle size={10} className="mt-0.5 shrink-0" /> Complete Stages 2–10 for FY {prevFy} first</li>
                                  </ul>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── Option 2: py_tally_running ── */}
                      {questionnaire.py_data_availability === "py_tally_running" && (
                        <div className="space-y-3">
                          <div className="rounded-lg border p-3 space-y-3 text-xs bg-blue-50/40 dark:bg-blue-950/10 border-blue-200 dark:border-blue-900">
                            <div className="flex items-center gap-2">
                              <Zap size={14} className="text-blue-600 shrink-0" />
                              <p className="font-semibold text-sm">Partially Automatic — Running Tally</p>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                              <div>
                                <p className="text-muted-foreground font-medium uppercase tracking-wide text-[9px] mb-1">CAFlow handles automatically</p>
                                <ul className="space-y-0.5">
                                  <li className="flex items-start gap-1"><CheckCircle2 size={10} className="text-green-500 mt-0.5 shrink-0" /> Balance Sheet PY — from Tally opening balances</li>
                                  <li className="flex items-start gap-1"><CheckCircle2 size={10} className="text-green-500 mt-0.5 shrink-0" /> COA mapping carried forward if FY-1 exists</li>
                                </ul>
                              </div>
                              <div>
                                <p className="text-muted-foreground font-medium uppercase tracking-wide text-[9px] mb-1">Action needed</p>
                                <ul className="space-y-0.5 text-amber-700 dark:text-amber-400">
                                  <li className="flex items-start gap-1"><Info size={10} className="mt-0.5 shrink-0" /> P&L PY — must be entered manually in Stage 10</li>
                                  <li className="flex items-start gap-1"><Info size={10} className="mt-0.5 shrink-0" /> Or link a prior engagement for auto P&L</li>
                                </ul>
                              </div>
                            </div>
                          </div>
                          <YesNo
                            label="Do you have last year's audited P&L figures to enter manually in Stage 10?"
                            value={questionnaire.py_pl_available || ""}
                            onChange={v => setQ("py_pl_available", v)}
                          />
                          {questionnaire.py_pl_available === "yes" && (
                            <Alert className="border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/10">
                              <Info size={12} className="text-blue-600" />
                              <AlertDescription className="text-[11px] text-blue-800 dark:text-blue-300">
                                <strong>In Stage 10 (Financial Statements):</strong> click the <span className="font-mono bg-muted px-1 rounded">⚠ pencil</span> icon in the PY column for each P&amp;L line item to enter the audited figure. Your name and timestamp are recorded automatically.
                              </AlertDescription>
                            </Alert>
                          )}
                          {questionnaire.py_pl_available === "no" && (
                            <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/10">
                              <Info size={12} className="text-amber-600" />
                              <AlertDescription className="text-[11px] text-amber-800 dark:text-amber-300">
                                P&amp;L comparative column will be blank. Consider switching to <strong>PY Shell</strong> option if you have access to the old Tally company file.
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                      )}

                      {/* ── Option 3: py_shell_import ── */}
                      {questionnaire.py_data_availability === "py_shell_import" && (
                        <div className="rounded-lg border p-3 space-y-3 text-xs bg-violet-50/40 dark:bg-violet-950/10 border-violet-200 dark:border-violet-900">
                          <div className="flex items-center gap-2">
                            <RefreshCw size={14} className="text-violet-600 shrink-0" />
                            <p className="font-semibold text-sm">Setup Required — PY Shell Engagement</p>
                            <Badge className="ml-auto text-[9px] bg-violet-100 text-violet-700 border-violet-300">2–4 steps</Badge>
                          </div>
                          <div className="space-y-1.5 text-[11px]">
                            <p className="text-muted-foreground font-medium uppercase tracking-wide text-[9px] mb-2">How it works</p>
                            {[
                              { n: 1, text: "Complete Stage 1 (this form) and save it." },
                              { n: 2, text: "In Stage 10 → \"PY Data Source\" card → click \"Create PY Shell Engagement\"." },
                              { n: 3, text: "In the shell: sync PY Tally → COA Mapping → Generate FS (Stages 2–5)." },
                              { n: 4, text: "Return here — PY FS auto-populates the comparative column in Stage 10." },
                            ].map(s => (
                              <div key={s.n} className="flex items-start gap-2">
                                <span className="shrink-0 w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 text-[9px] flex items-center justify-center font-bold">{s.n}</span>
                                <p>{s.text}</p>
                              </div>
                            ))}
                          </div>
                          <div className="border-t pt-2 text-[11px] text-muted-foreground flex items-start gap-1">
                            <CheckCircle2 size={10} className="text-green-500 mt-0.5 shrink-0" />
                            COA mapping from the PY shell will carry forward to this engagement automatically.
                          </div>
                        </div>
                      )}

                      {/* ── Option 4: manual ── */}
                      {questionnaire.py_data_availability === "manual" && (
                        <div className="rounded-lg border p-3 space-y-3 text-xs bg-amber-50/40 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900">
                          <div className="flex items-center gap-2">
                            <FileText size={14} className="text-amber-700 shrink-0" />
                            <p className="font-semibold text-sm">Manual Entry — No Tally / No Prior Engagement</p>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                            <div>
                              <p className="text-muted-foreground font-medium uppercase tracking-wide text-[9px] mb-1">CAFlow handles automatically</p>
                              <ul className="space-y-0.5">
                                <li className="flex items-start gap-1"><CheckCircle2 size={10} className="text-green-500 mt-0.5 shrink-0" /> BS PY from Tally opening balances (if Tally synced)</li>
                                <li className="flex items-start gap-1"><CheckCircle2 size={10} className="text-green-500 mt-0.5 shrink-0" /> Saves as next year's automatic PY source</li>
                              </ul>
                            </div>
                            <div>
                              <p className="text-muted-foreground font-medium uppercase tracking-wide text-[9px] mb-1">Action needed in Stage 10</p>
                              <ul className="space-y-0.5 text-amber-700 dark:text-amber-400">
                                <li className="flex items-start gap-1"><ArrowUpRight size={10} className="mt-0.5 shrink-0" /> Click PY pencil on each P&L line → enter audited figure</li>
                                <li className="flex items-start gap-1"><ArrowUpRight size={10} className="mt-0.5 shrink-0" /> Fill PY Annexures grid for ledger-level note detail</li>
                              </ul>
                            </div>
                          </div>
                          <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 py-2">
                            <Info size={11} className="text-amber-600" />
                            <AlertDescription className="text-[11px] text-amber-800 dark:text-amber-300">
                              Attribution (your name + timestamp) is recorded for every PY cell you override in Stage 10.
                            </AlertDescription>
                          </Alert>
                        </div>
                      )}

                      {/* ── Option 5: none ── */}
                      {questionnaire.py_data_availability === "none" && (
                        <div className="rounded-lg border p-3 space-y-2 text-xs bg-muted/30 border-muted">
                          <div className="flex items-center gap-2">
                            <Circle size={14} className="text-muted-foreground shrink-0" />
                            <p className="font-semibold text-sm text-muted-foreground">Skipped — No PY Comparative</p>
                          </div>
                          <ul className="space-y-1 text-[11px] text-muted-foreground">
                            <li className="flex items-start gap-1"><Info size={10} className="mt-0.5 shrink-0" /> PY column will be blank on Balance Sheet and P&amp;L.</li>
                            <li className="flex items-start gap-1"><Info size={10} className="mt-0.5 shrink-0" /> COA carry-forward still runs — no prior FS data is expected.</li>
                            <li className="flex items-start gap-1"><Info size={10} className="mt-0.5 shrink-0" /> This choice can be changed later by returning to Stage 1.</li>
                          </ul>
                        </div>
                      )}

                      {/* ── No option selected yet ── */}
                      {!questionnaire.py_data_availability && (
                        <p className="text-[11px] text-muted-foreground">
                          Select an option above — contextual guidance and next steps will appear here.
                        </p>
                      )}

                    </AccordionContent>
                  </AccordionItem>

                  {/* Block C — Audit Applicability (corporate-only) ───────
                   *  Hidden entirely for non-corporate entities. The 3 answers
                   *  are pre-filled from the client's audit setup but stay
                   *  user-editable. They drive Stage 7 tab visibility (CARO,
                   *  IFC) and the cash-flow-statement requirement. */}
                  {isCorporateForBlockC && (
                    <AccordionItem value="block-c" className="border rounded-lg px-4">
                      <AccordionTrigger className="text-sm font-semibold">
                        Block — Audit Applicability (For Companies)
                        {blockCValid && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-2">
                        <YesNo
                          label="Is CARO 2020 (Companies Auditor's Report Order) applicable?"
                          hint="Applicable for companies not falling under CARO exemptions"
                          value={questionnaire.caro_applicable || ""}
                          onChange={v => setQ("caro_applicable", v)}
                        />
                        <YesNo
                          label="Is Internal Financial Controls (IFC) Report applicable?"
                          hint="Under Section 143(3)(i) of Companies Act 2013"
                          value={questionnaire.ifc_applicable || ""}
                          onChange={v => setQ("ifc_applicable", v)}
                        />
                        <YesNo
                          label="Does the company prepare Cash Flow Statement?"
                          hint="Mandatory for listed companies and certain others under Sch. III"
                          value={questionnaire.cash_flow_applicable || ""}
                          onChange={v => setQ("cash_flow_applicable", v)}
                        />

                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* Block D — Tax Audit (conditional) */}
                  {isTaxAuditReq && (
                    <AccordionItem value="block-d" className="border rounded-lg px-4">
                      <AccordionTrigger className="text-sm font-semibold">
                        Block D — Tax Audit Specifics
                        {blockDValid && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-2">
                        <YesNo label="Turnover exceeds ₹1Cr (Business) or ₹50L (Profession)?" value={questionnaire.turnover_exceeds_limit || ""} onChange={v => setQ("turnover_exceeds_limit", v)} />
                        <div>
                          <Label>Method of Accounting</Label>
                          <Select value={questionnaire.accounting_method || ""} onValueChange={v => setQ("accounting_method", v)}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="mercantile">Mercantile</SelectItem>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="hybrid">Hybrid</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* Block E — Period-specific */}
                  {form1A.audit_period_type !== "annual" && (
                    <AccordionItem value="block-e" className="border rounded-lg px-4">
                      <AccordionTrigger className="text-sm font-semibold">Block E — Period-specific</AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-2">
                        <YesNo label="Does a previous period engagement exist?" value={questionnaire.prev_period_exists || ""} onChange={v => setQ("prev_period_exists", v)} />
                        {questionnaire.prev_period_exists === "yes" && (
                          <YesNo label="Import queries from previous period?" value={questionnaire.import_prev_queries || ""} onChange={v => setQ("import_prev_queries", v)} />
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
              </CardContent>
            </Card>

            {/* Bottom actions */}
            <div className="flex justify-end gap-3 pb-8">
              <Button variant="outline" onClick={() => saveStage1(false)} disabled={saving}>Save Draft</Button>
              <Button onClick={() => saveStage1(true)} disabled={saving || !canCompleteStage1} className="gap-1">
                Complete Stage 1 & Proceed <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        ) : activeStage === 2 ? (
          /* STAGE 2 — Trial Balance Import (also used as Tally Sync for PY shells) */
          <>
          {(engagement as any)?.is_py_shell && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-2.5 text-sm">
              <span className="text-amber-600 dark:text-amber-400 font-semibold shrink-0">⚠ PY Shell</span>
              <span className="text-amber-800 dark:text-amber-300 text-xs">
                You are viewing a <strong>Prior Year Shell</strong> engagement ({(engagement as any)?.financial_year}) created to sync Tally TB data. This engagement is hidden from all dashboards. Sync Tally data here, then return to the current-year engagement's Financial Statements and click <strong>Fetch PY from FY-1 Tally</strong>.
              </span>
              <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300"
                onClick={() => navigate('/audit')}>
                ← Audit Dashboard
              </Button>
            </div>
          )}
          <PipelineStage2
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
          </>
        ) : activeStage === 3 ? (
          /* STAGE 3 — COA & Financial Statements */
          <PipelineStage3
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 4 ? (
          <PipelineStage4
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 5 ? (
          <PipelineStage5
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 6 ? (
          <PipelineStage6
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 7 ? (
          /* STAGE 7 — Notes to Accounts & CARO */
          <PipelineStage7Combined
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 8 ? (
          /* STAGE 8 — 3CA / 3CB / 3CD Reports */
          (() => {
            // Use engagement.entity_type first; fall back to clients.entity_type
            const engClient = engagement?.clients as any;
            const et = (engagement?.entity_type || engClient?.entity_type || "").toLowerCase().trim();
            const isCompanyEng = ["company", "private ltd", "public ltd", "opc", "pvt_ltd", "public_ltd"].includes(et);
            // Extract FY end year: "2025-26" → "2026", "2024-25" → "2025"
            const fyEndYear = (() => {
              const fy = engagement?.financial_year || "";
              const m = fy.match(/\d{4}-(\d{2})/);
              return m ? `20${m[1]}` : (fy || "—");
            })();
            const isTaxAuditEng = engagement?.requires_3ca || engagement?.requires_3cb || engagement?.requires_3cd;

            // Companies: always 3CA + 3CD. Non-companies: user chooses via radio.
            const show3ca = isCompanyEng || (!isCompanyEng && nonCorpFormChoice === "3ca");
            const show3cb = !isCompanyEng && nonCorpFormChoice === "3cb";
            // 3CD always accompanies 3CA or 3CB whenever tax audit applies
            const show3cd = isCompanyEng ? show3ca : (show3ca || show3cb);
            const defaultTab = show3ca ? "3ca" : show3cb ? "3cb" : "3cd";

            return (
              <div className="space-y-4">
                <EngagementHeader engagement={engagement} stageNumber={9} stageLabel="3CA / 3CB / 3CD Reports" />
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-lg font-bold text-foreground">Stage 9 — 3CA / 3CB / 3CD Reports</h1>
                    <p className="text-xs text-muted-foreground">Tax audit report forms and annexures</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => navigate('/audit')} className="gap-1 text-xs">
                    <ChevronRight size={14} className="rotate-180" /> Back to Audit Dashboard
                  </Button>
                </div>

                {/* Delegate entirely to Form3Reports — handles radio, tabs, full form + annexure */}
                <Form3Reports engagementIdProp={selectedEngId} />
              </div>
            );
          })()
        ) : activeStage === 9 ? (
          /* STAGE 9 — Sign-off & UDIN */
          <div className="max-w-5xl space-y-4">
            <EngagementHeader engagement={engagement} stageNumber={10} stageLabel="Sign-off & UDIN" />
            <Button variant="ghost" size="sm" onClick={() => navigate('/audit')} className="gap-1 text-xs">
              <ChevronRight size={14} className="rotate-180" /> Back to Audit Dashboard
            </Button>
            <h1 className="text-lg font-bold text-foreground">Stage 10 — Sign-off & UDIN</h1>
            <EngagementReviewSignoff engagement={engagement} client={engagement?.clients} partner={null} onUpdate={() => refetchEng()} />
          </div>
        ) : activeStage === 10 ? (
          /* STAGE 10 — Financial Statements */
          <PipelineFinancialStatements
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : null}
      </div>

      {/* New Engagement Dialog */}
      <Dialog open={showNewEng} onOpenChange={setShowNewEng}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Audit Engagement</DialogTitle>
            <DialogDescription>Select a client to create an audit engagement</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Audit Firm <span className="text-destructive">*</span></Label>
              <Select
                value={form1A.audit_firm_id}
                onValueChange={v => setForm1A(f => ({ ...f, audit_firm_id: v, partner_id: "" }))}
              >
                <SelectTrigger><SelectValue placeholder="Select audit firm" /></SelectTrigger>
                <SelectContent>
                  {(auditFirmsForEng || []).length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No audit firms found. Add one in Settings → Audit Firms.</div>
                  ) : (
                    (auditFirmsForEng || []).map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Engagement Partner — from firm settings (Settings → Audit Registration → Partner Membership Numbers) */}
            <div>
              <Label>Engagement Partner</Label>
              <Select
                value={form1A.partner_name}
                onValueChange={v => {
                  const mno = partnersForFirm.find(p => p.partner_name === v)?.membership_no || "";
                  setForm1A(f => ({ ...f, partner_name: v, partner_membership_no: mno }));
                }}
                disabled={partnersForFirm.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={partnersForFirm.length === 0 ? "Add partners in Settings → Audit Registration" : "Select partner"} />
                </SelectTrigger>
                <SelectContent>
                  {partnersForFirm.map(p => (
                    <SelectItem key={p.partner_name} value={p.partner_name}>
                      {p.partner_name}
                      {p.membership_no && (
                        <span className="ml-2 text-xs text-muted-foreground">({p.membership_no})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {partnersForFirm.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Add partner membership numbers in Settings → Audit Registration.
                </p>
              )}
            </div>

            <div>
              <Label>Client *</Label>
              <Popover open={clientComboOpen} onOpenChange={setClientComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={clientComboOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate">
                      {form1A.client_id
                        ? ((eligibleClients || []).find(c => c.id === form1A.client_id)?.name ?? "Select client")
                        : "Select client"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[340px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search client..."
                      value={clientSearch}
                      onValueChange={setClientSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No client found.</CommandEmpty>
                      <CommandGroup>
                        {(eligibleClients || [])
                          .filter(c =>
                            !clientSearch.trim() ||
                            c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
                            (c.entity_type || "").toLowerCase().includes(clientSearch.toLowerCase())
                          )
                          .map(c => (
                            <CommandItem
                              key={c.id}
                              value={c.id}
                              onSelect={(v) => {
                                const client = (eligibleClients || []).find(cl => cl.id === v);
                                setForm1A(f => ({ ...f, client_id: v, entity_type: client?.entity_type || f.entity_type }));
                                setClientComboOpen(false);
                                setClientSearch("");
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", form1A.client_id === c.id ? "opacity-100" : "opacity-0")} />
                              <span className="truncate">
                                {c.name}{c.entity_type ? ` (${c.entity_type})` : ""}
                              </span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Financial Year *</Label>
              <Select value={form1A.financial_year} onValueChange={v => setForm1A(f => ({ ...f, financial_year: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Period Type</Label>
              <Select value={form1A.audit_period_type} onValueChange={v => setForm1A(f => ({ ...f, audit_period_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PERIOD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Audit Type</Label>
              {(() => {
                const selClient = (eligibleClients || []).find(c => c.id === form1A.client_id);
                const opts = getAuditOptionsForClient(selClient);
                if (form1A.client_id && opts.length === 0) {
                  return (
                    <p className="text-xs text-amber-600 mt-1">
                      No audit services enabled for this client. Configure in Client → Audit Setup.
                    </p>
                  );
                }
                return (
                  <Select value={form1A.audit_type} onValueChange={v => setForm1A(f => ({ ...f, audit_type: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select audit type" /></SelectTrigger>
                    <SelectContent>
                      {opts.length === 0
                        ? AUDIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)
                        : opts.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)
                      }
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
            <div>
              <Label>Entity Type</Label>
              <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">
                {form1A.entity_type || (form1A.client_id ? "Not set on client profile" : "Select a client first")}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Auto-fetched from client profile (read-only)</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewEng(false)}>Cancel</Button>
            <Button onClick={() => createEngagement.mutate()} disabled={!form1A.client_id || !form1A.audit_firm_id || !form1A.audit_type || !form1A.financial_year}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
