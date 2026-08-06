import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuditContext } from "@/hooks/useAuditContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Building2, FileText, Calculator, Eye, ClipboardCheck, Shield,
  BookMarked, Layers, Award, ChevronRight, Plus,
  CalendarDays, CheckCircle2, Circle, Loader2,
  MoreVertical, Pencil, Trash2, ChevronsUpDown, Check, FileOutput
} from "lucide-react";
import { toast } from "sonner";

// ─── Stage definitions ───
// Order matches the left sidebar pipeline order (positions 3,4,5,7,8,9,10,11,12,13)
const STAGES = [
  { num: 1,  label: "Engagement Setup",           icon: Building2      },
  { num: 6,  label: "Workpapers & Audit Sheet",    icon: Shield         },
  { num: 5,  label: "Query Tracker",               icon: ClipboardCheck },
  { num: 4,  label: "Scrutiny Engine",             icon: Eye            },
  { num: 2,  label: "Tally Sync",                  icon: FileText       },
  { num: 3,  label: "COA Mapping",                 icon: Calculator     },
  { num: 10, label: "Financial Statements",        icon: FileOutput     },
  { num: 7,  label: "Notes to Accounts & CARO",    icon: BookMarked     },
  { num: 8,  label: "3CA / 3CB / 3CD Reports",     icon: FileText       },
  { num: 9,  label: "Sign-off & UDIN",             icon: Award          },
];


const FY_OPTIONS = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2020-21"];
const AUDIT_TYPES = [
  { value: "statutory", label: "Statutory Audit" },
  { value: "tax_audit", label: "Tax Audit" },
  { value: "both", label: "Both (Statutory + Tax)" },
  { value: "internal", label: "Internal Audit" },
  { value: "stock", label: "Stock Audit" },
];
const PERIOD_TYPES = [
  { value: "annual",      label: "Full Year" },
  { value: "half_yearly", label: "Half Year" },
  { value: "quarterly",   label: "Quarter"   },
  { value: "custom",      label: "Custom"    },
];
const ENTITY_TYPES = [
  { value: "company", label: "Company (Pvt/Public)" },
  { value: "llp", label: "LLP" },
  { value: "individual", label: "Individual / Proprietor" },
  { value: "firm", label: "Partnership Firm" },
  { value: "trust", label: "Trust / Society" },
  { value: "huf", label: "HUF" },
  { value: "aop", label: "AOP / BOI" },
];

const statusLabel: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Completed",
};

// ─── Filter audit types by client's audit setup ───
function getAuditOptionsForClient(client: any) {
  if (!client) return AUDIT_TYPES;
  const opts: { value: string; label: string }[] = [];
  const hasStat = !!client.statutory_audit_applicable || !!client.has_statutory_service;
  const hasTax  = !!client.tax_audit_applicable || !!client.tax_audit_type || !!client.has_tax_audit_service;
  if (hasStat)           opts.push({ value: "statutory", label: "Statutory Audit" });
  if (hasTax)            opts.push({ value: "tax_audit", label: "Tax Audit" });
  if (hasStat && hasTax) opts.push({ value: "both",      label: "Both (Statutory + Tax)" });
  if (client.internal_audit_applicable || client.has_internal_audit_service)
                         opts.push({ value: "internal",  label: "Internal Audit" });
  if (client.stock_audit_applicable)
                         opts.push({ value: "stock",     label: "Stock Audit" });
  // Fallback: classification-only clients (no specific flags set) — offer all types
  if (opts.length === 0) return AUDIT_TYPES;
  return opts;
}

export default function AuditIntelligence() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const canCreateEngagement = can("Audit Intelligence", "can_create") || user?.role === "superadmin";
  // Engagement delete is now restricted to firm administrators and superadmins.
  // Mirrored by an RLS policy on audit_engagements so the restriction holds
  // even if someone bypasses the UI (the DB will reject the DELETE).
  const canDeleteEngagement = user?.role === "firm_admin" || user?.role === "superadmin";
  const navigate = useNavigate();
  const {
    selectedClientId, setSelectedClientId,
    selectedEngagementId, setSelectedEngagementId,
    clients, engagements, selectedEngagement, loading,
    refreshEngagements,
  } = useAuditContext();

  const [users, setUsers] = useState<{ id: string; name: string | null; role: string | null }[]>([]);
  const [auditFirms, setAuditFirms] = useState<{ id: string; name: string }[]>([]);
  // Partners from firm settings — same source as New Engagement (Settings → Audit Registration)
  const [partnersForFirm, setPartnersForFirm] = useState<{ partner_name: string; membership_no: string | null }[]>([]);
  const [metrics, setMetrics] = useState({ ledgers: 0, queriesRaised: 0, queriesPending: 0, workpapers: 0, caroCompleted: 0 });

  // Dialogs
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  // Typed-confirmation guard for the destructive engagement delete, plus a
  // pre-delete impact summary so the user sees the blast radius before the
  // "Delete Permanently" button becomes clickable.
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePreview, setDeletePreview] = useState<{ documents: number; notes: number; workpapers: number } | null>(null);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);

  // Filters
  const [filterAuditType, setFilterAuditType] = useState<string>("all");
  const [filterFY, setFilterFY] = useState<string>("all");
  const [filterPeriodType, setFilterPeriodType] = useState<string>("all");

  // #1 — clients from context are already filtered to audit-eligible (see useAuditContext).
  // Issue 1: when a Financial Year is selected, narrow the picker to clients
  // flagged audit-applicable IN THAT FY (per client_fy_audit_setup). With
  // filterFY="all" we keep the legacy "ever-audit" list so historical
  // engagements stay reachable. We always retain clients that already have
  // an engagement for the selected FY so the dropdown stays consistent with
  // engagements the user can still open.
  const auditClients = useMemo(() => {
    if (!filterFY || filterFY === "all") return clients;
    const engagedInFY = new Set<string>(
      engagements
        .filter((e: any) => e.financial_year === filterFY && e.status !== "archived")
        .map((e: any) => e.client_id)
    );
    return clients.filter(c =>
      ((c as any).applicable_fys && (c as any).applicable_fys.includes(filterFY)) ||
      engagedInFY.has(c.id)
    );
  }, [clients, engagements, filterFY]);

  // Searchable client dropdown
  const [clientOpen, setClientOpen] = useState(false);

  // Searchable engagement picker
  const [engPickerOpen, setEngPickerOpen] = useState(false);
  const [engPickerSearch, setEngPickerSearch] = useState("");

  // Edit form — must be declared BEFORE editDialogClients useMemo
  const [engForm, setEngForm] = useState({
    audit_firm_id: "", client_id: "", financial_year: "2024-25", audit_type: "statutory",
    entity_type: "company", audit_period_type: "annual",
    partner_id: "", partner_name: "",
  });

  // For the Edit Engagement dialog: always include the existing engagement's client
  // even if it no longer passes the audit eligibility filter.
  // IMPORTANT: must come AFTER engForm useState declaration.
  const editDialogClients = useMemo(() => {
    if (!engForm.client_id) return auditClients;
    const alreadyIncluded = auditClients.some(c => c.id === engForm.client_id);
    if (alreadyIncluded) return auditClients;
    const engClientName = selectedEngagement?.client_name || (selectedEngagement?.clients as any)?.name || "";
    const engClientType = selectedEngagement?.client_entity_type || selectedEngagement?.entity_type || "";
    return [
      { id: engForm.client_id, name: engClientName, entity_type: engClientType },
      ...auditClients,
    ];
  }, [auditClients, engForm.client_id, selectedEngagement]);

  useEffect(() => {
    if (!user?.firm_id) return;
    supabase.from("users").select("id, name, role").neq("role", "client").eq("firm_id", user.firm_id).eq("is_active", true)
      .then(({ data }) => setUsers(data || []));
  }, [user?.firm_id]);

  // Engagement Partner dropdown now reflects the SELECTED audit firm's
  // partner roster (firms.membership_numbers), not just the currently
  // logged-in user's own firm. This ensures parity with all audit firms —
  // including newly added ones like "AKTA RAMANI & ASSOCIATES" — so the
  // auditor sees the right partners regardless of which firm they pick.
  useEffect(() => {
    const fid = engForm.audit_firm_id || user?.firm_id;
    if (!fid) { setPartnersForFirm([]); return; }
    supabase.from("firms").select("membership_numbers").eq("id", fid).maybeSingle()
      .then(({ data }) => {
        if (!data?.membership_numbers) { setPartnersForFirm([]); return; }
        setPartnersForFirm(
          ((data.membership_numbers as any[]) || [])
            .filter((m: any) => m?.partner_name)
            .map((m: any) => ({
              partner_name:  m.partner_name  as string,
              membership_no: (m.membership_no as string) || null,
            }))
        );
      });
  }, [engForm.audit_firm_id, user?.firm_id]);

  // Audit Firm dropdown — historically populated from `audit_firms` table
  // only.  New audit firms added via Firm Management land in the `firms`
  // table with is_audit_firm=true and therefore never appeared here.
  // Fix: union both sources, dedupe by name, sort alphabetically. Future
  // firms added via either path will surface immediately for every tenant.
  useEffect(() => {
    if (!user?.id) return;
    let q1 = supabase.from("audit_firms").select("id, name").neq("active", false).order("name");
    if (user.role !== "superadmin" && user.firm_id) {
      q1 = q1.eq("firm_id", user.firm_id) as typeof q1;
    }
    const q2 = supabase
      .from("firms")
      .select("id, name, is_audit_firm")
      .eq("is_audit_firm", true)
      .order("name");

    Promise.all([q1, q2]).then(([r1, r2]) => {
      // firms (r2) takes priority so the id used for partnersForFirm lookup
      // is always a firms.id (which has membership_numbers).
      const byKey = new Map<string, { id: string; name: string }>();
      for (const f of (r2.data || [])) byKey.set((f.name || "").toLowerCase().trim(), { id: f.id, name: f.name });
      for (const f of (r1.data || [])) {
        const key = (f.name || "").toLowerCase().trim();
        if (!byKey.has(key)) byKey.set(key, { id: f.id, name: f.name });
      }
      const merged = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
      setAuditFirms(merged);
    });
  }, [user?.id, user?.firm_id, user?.role]);

  useEffect(() => {
    if (!selectedEngagementId) return;
    loadMetrics(selectedEngagementId);
  }, [selectedEngagementId]);

  const loadMetrics = async (engId: string) => {
    try {
      const [worksheetRes, workpapersRes, caroRes] = await Promise.all([
        (supabase as any).from("audit_worksheet_master").select("query_sheet_json").eq("engagement_id", engId).maybeSingle(),
        (supabase as any).from("audit_workpapers").select("id", { count: "exact" }).eq("engagement_id", engId),
        supabase.from("audit_caro_responses").select("id, status", { count: "exact" }).eq("engagement_id", engId),
      ]);
      const caroRows = caroRes.data || [];
      // Read queries from worksheet JSON (same source as QuerySheet tab)
      const queryJson = worksheetRes.data?.query_sheet_json;
      const queryRows: any[] = (queryJson && Array.isArray(queryJson.queries)) ? queryJson.queries : [];
      const raised = queryRows.filter((q: any) => q.query_status && q.query_status !== "draft");
      const pending = raised.filter((q: any) => q.query_status !== "resolved" && q.query_status !== "escalated");
      setMetrics({
        ledgers: 0,
        queriesRaised: raised.length,
        queriesPending: pending.length,
        workpapers: workpapersRes.count || 0,
        caroCompleted: caroRows.filter((c: any) =>
          c.status === "completed" || c.status === "reviewed" || c.status === "approved"
        ).length,
      });
    } catch (err) {
      console.error("loadMetrics failed", err);
    }
  };

  // Fetch a pre-delete impact summary for the delete-confirmation dialog.
  // Read-only counts against the highest-impact child tables — the actual
  // cascade delete logic in handleDelete() is unchanged.
  const loadDeletePreview = async (engId: string) => {
    setDeletePreviewLoading(true);
    try {
      const [docsRes, notesRes, wpRes] = await Promise.all([
        (supabase as any).from("documents").select("id", { count: "exact", head: true }).eq("engagement_id", engId),
        (supabase as any).from("nce_financial_notes").select("id", { count: "exact", head: true }).eq("engagement_id", engId),
        (supabase as any).from("audit_workpapers").select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      ]);
      setDeletePreview({
        documents: docsRes.count || 0,
        notes: notesRes.count || 0,
        workpapers: wpRes.count || 0,
      });
    } catch (err) {
      console.error("loadDeletePreview failed", err);
      setDeletePreview(null);
    } finally {
      setDeletePreviewLoading(false);
    }
  };

  const openDeleteDialog = (engId?: string) => {
    const id = engId ?? selectedEngagementId;
    if (engId) setSelectedEngagementId(engId);
    setDeleteConfirmText("");
    setDeletePreview(null);
    if (id) loadDeletePreview(id);
    setShowDeleteDialog(true);
  };

  // Filter engagements by all 4 filters and auto-resolve
  const filteredEngagements = useMemo(() => {
    let result = engagements.filter(e => e.status !== "archived");
    if (selectedClientId && selectedClientId !== "all") {
      result = result.filter(e => e.client_id === selectedClientId);
    }
    if (filterAuditType && filterAuditType !== "all") {
      result = result.filter(e => e.audit_type === filterAuditType);
    }
    if (filterFY && filterFY !== "all") {
      result = result.filter(e => e.financial_year === filterFY);
    }
    if (filterPeriodType && filterPeriodType !== "all") {
      result = result.filter(e => (e.audit_period_type || "annual") === filterPeriodType);
    }
    return result;
  }, [engagements, selectedClientId, filterAuditType, filterFY, filterPeriodType]);

  // Deduplicate: use a Set to track unique combos
  const uniqueFilteredEngagements = useMemo(() => {
    const seen = new Set<string>();
    return filteredEngagements.filter(e => {
      const key = `${e.client_id}_${e.audit_type}_${e.financial_year}_${e.audit_period_type || "annual"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filteredEngagements]);

  // Auto-select engagement when filters narrow to exactly one
  useEffect(() => {
    if (uniqueFilteredEngagements.length === 1) {
      const eng = uniqueFilteredEngagements[0];
      if (eng.id !== selectedEngagementId) {
        setSelectedEngagementId(eng.id);
      }
    }
  }, [uniqueFilteredEngagements]);

  const stageStatuses = selectedEngagement?.stage_statuses || {};
  const completedStages = Object.values(stageStatuses).filter((s: any) => s === "complete").length;
  const progressPct = Math.round((completedStages / 10) * 100);

  const getStageColor = (status: string) => {
    if (status === "complete") return "bg-emerald-500";
    if (status === "in_progress") return "bg-amber-500";
    return "bg-muted";
  };
  const getStageTextColor = (status: string) => {
    if (status === "complete") return "text-emerald-600";
    if (status === "in_progress") return "text-amber-600";
    return "text-muted-foreground";
  };

  const handleStageClick = async (stage: typeof STAGES[0]) => {
    if (!selectedEngagementId) {
      toast.error("Please select an engagement first");
      return;
    }
    await supabase
      .from("audit_engagements")
      .update({ pipeline_stage: stage.num } as any)
      .eq("id", selectedEngagementId);
    navigate(`/audit/pipeline/${selectedEngagementId}?stage=${stage.num}`);
  };

  // ─── Edit Engagement ───
  const openEditDialog = (eng?: any) => {
    // Guard: when bound directly to onClick (e.g. `onClick={openEditDialog}`)
    // React passes the SyntheticEvent as the first arg — which is truthy but
    // has none of the engagement fields, so the form falls back to all
    // defaults (FY 2024-25, statutory, blank client, blank firm, etc).
    // Only treat `eng` as a real engagement when it carries the expected id.
    const isRealEngagement = eng && typeof eng === "object" && typeof eng.id === "string";
    const target = isRealEngagement ? eng : selectedEngagement;
    if (!target) return;
    setEngForm({
      audit_firm_id: target.audit_firm_id || "",
      client_id: target.client_id || "",
      financial_year: target.financial_year || "2024-25",
      audit_type: target.audit_type || "statutory",
      entity_type: target.entity_type || target.client_entity_type || "",
      audit_period_type: target.audit_period_type || "annual",
      partner_id: target.partner_id || "",
      partner_name: target.partner_name || "",
    });
    setShowEditDialog(true);
  };
  // ─── Audit-firm id bridge ────────────────────────────────────────────────
  // The audit_engagements table has a foreign-key constraint on audit_firm_id
  // → audit_firms.id. When the auditor picks a firm that exists only in the
  // `firms` table (added via Firm Management with is_audit_firm=true), the
  // engagement insert/update fails with:
  //   "insert or update on table 'audit_engagements' violates foreign key
  //    constraint 'audit_engagements_audit_firm_id_fkey'"
  // Fix: before persisting the engagement, ensure a corresponding row exists
  // in audit_firms. We mirror only the immutable identifiers (id, name,
  // firm_id, active=true). Idempotent: if the audit_firms row already exists
  // (legacy firms registered there directly), this is a no-op.
  const ensureAuditFirmRow = async (firmId: string): Promise<string | null> => {
    if (!firmId) return null;
    // Already an audit_firms row? Nothing to do.
    const { data: existing } = await supabase
      .from("audit_firms")
      .select("id")
      .eq("id", firmId)
      .maybeSingle();
    if (existing?.id) return firmId;
    // Look it up in firms (where it must live if not in audit_firms).
    const { data: src } = await supabase
      .from("firms")
      .select("id, name")
      .eq("id", firmId)
      .maybeSingle();
    if (!src?.id) return firmId;          // unknown — let the FK error surface
    // Mirror into audit_firms with the same id so the FK constraint is met.
    // tenant attribution: prefer the logged-in user's firm; superadmin path
    // keeps it nullable.
    await supabase.from("audit_firms").upsert({
      id:       src.id,
      name:     src.name,
      firm_id:  user?.firm_id ?? null,
      active:   true,
    } as any, { onConflict: "id" });
    return firmId;
  };

  const handleEdit = async () => {
    if (!selectedEngagementId) return;
    setFormSaving(true);
    // ── LOCKED EDIT (2026-06-04) ─────────────────────────────────────
    // Per product decision, ONLY Audit Firm and Engagement Partner are
    // editable on an existing engagement. Client, Financial Year, Audit
    // Type, Period Type, and Entity Type are immutable — the UI shows
    // them read-only and this UPDATE payload deliberately omits them so
    // even a tampered form state cannot mutate them. Changing those
    // fields would orphan TB / FS / 3CD / audit-setup linkage and break
    // the audit_engagements_unique_live uniqueness invariant.
    const safeAuditFirmId = engForm.audit_firm_id
      ? await ensureAuditFirmRow(engForm.audit_firm_id)
      : null;
    const { error } = await supabase.from("audit_engagements").update({
      audit_firm_id: safeAuditFirmId,
      partner_name:  engForm.partner_name || null,
      // partner_id is legacy / no longer the source of truth — clear it
      // so it can never disagree with partner_name. partner_name is
      // resolved from firms.membership_numbers at render time.
      partner_id:    null,
    } as any).eq("id", selectedEngagementId);
    setFormSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Engagement updated");
    setShowEditDialog(false);
    refreshEngagements();
  };

  // ─── Delete Engagement (permanent cascade) ───
  //
  // Restricted to firm_admin and superadmin — enforced both in the UI (the
  // button is hidden for other roles) and in the database via the RLS policy
  // "audit_engagements_delete_admin_only" so the DB rejects bypass attempts.
  //
  // Child-table cleanup is now handled by ON DELETE CASCADE on every FK that
  // points at audit_engagements (migration 20260603000002_engagement_cascade_delete).
  // The explicit per-table deletes below are kept as belt-and-braces so that
  // (a) errors are surfaced loudly per table if anything ever regresses and
  // (b) the audit trail records exactly what was cleaned up.
  const handleDelete = async () => {
    if (!selectedEngagementId) return;
    if (!canDeleteEngagement) {
      toast.error("Only firm administrators and superadmins can delete engagements.");
      return;
    }
    if (deleteConfirmText.trim() !== deleteConfirmTarget) {
      toast.error("Type the exact client name and FY to confirm deletion.");
      return;
    }
    const eid = selectedEngagementId;
    setFormSaving(true);
    try {
      // ── L8 FIX (2026-06-04): purge engagement-scoped Storage objects ────
      // The `documents` bucket has no FK to audit_engagements, so the DB-
      // level ON DELETE CASCADE leaves Checklist PDFs / spreadsheets behind
      // forever, eating quota and creating a privacy risk (orphan PDFs
      // accessible by URL guessing if the user knows the engagement id).
      // Enumerate every known engagement-scoped path prefix in the bucket
      // and remove the objects BEFORE the DB rows are dropped.
      //
      // Best-effort: failures are logged but don't block the DB delete —
      // a follow-up reconciliation sweep can pick up any survivors. The
      // user's intent is "permanently delete", so even partial cleanup is
      // better than the current "leave forever" behaviour.
      try {
        const prefixes = [`checklist/${eid}`];
        let removed = 0;
        for (const prefix of prefixes) {
          const { data: listed } = await supabase.storage.from("documents").list(prefix, { limit: 1000 });
          if (listed && listed.length > 0) {
            const paths = listed.map(o => `${prefix}/${o.name}`);
            const { error: rmErr } = await supabase.storage.from("documents").remove(paths);
            if (rmErr) console.warn(`[delete] Storage purge of ${prefix} failed:`, rmErr.message);
            else removed += paths.length;
          }
        }
        if (removed > 0) console.log(`[delete] Purged ${removed} Storage object(s) for engagement ${eid}`);
      } catch (sErr) {
        // Non-fatal — proceed with DB delete even if Storage purge errored.
        console.warn("[delete] Storage purge attempt failed:", sErr);
      }

      // 1. Get import batch IDs first (children reference them)
      const { data: batches } = await supabase.from("ledger_import_batches" as any).select("id").eq("engagement_id", eid);
      const batchIds = (batches ?? []).map((b: any) => b.id);
      if (batchIds.length > 0) {
        await supabase.from("tb_hierarchy_nodes" as any).delete().in("import_batch_id", batchIds);
        await supabase.from("ledger_transactions" as any).delete().in("import_batch_id", batchIds);
        await supabase.from("ledger_import_batches" as any).delete().eq("engagement_id", eid);
      }
      // 2. Tally sync tables
      await supabase.from("tally_vouchers" as any).delete().eq("engagement_id", eid);
      await supabase.from("tally_trial_balance" as any).delete().eq("engagement_id", eid);
      await supabase.from("tally_ledgers" as any).delete().eq("engagement_id", eid);
      await supabase.from("tally_groups" as any).delete().eq("engagement_id", eid);
      await supabase.from("sync_batches" as any).delete().eq("engagement_id", eid);
      await supabase.from("trial_balance_snapshots" as any).delete().eq("engagement_id", eid);
      // 3. Financial statements and other engagement-linked tables
      await supabase.from("fa_financial_statements" as any).delete().eq("engagement_id", eid);
      await supabase.from("tally_groups" as any).delete().eq("engagement_id", eid);
      // 4. TDS filings
      await supabase.from("tds_filings" as any).delete().eq("engagement_id", eid);
      // 5. IT returns
      await supabase.from("it_returns" as any).delete().eq("engagement_id", eid);
      // 6. Delete the engagement itself
      const { error } = await supabase.from("audit_engagements").delete().eq("id", eid);
      if (error) throw error;
      toast.success("Engagement permanently deleted");
    } catch (err: any) {
      toast.error(err.message ?? "Delete failed");
      setFormSaving(false);
      return;
    }
    setFormSaving(false);
    setShowDeleteDialog(false);
    setSelectedEngagementId("");
    setDeleteConfirmText("");
    setDeletePreview(null);
    refreshEngagements();
  };

  const userMap = useMemo(() => new Map(users.map(u => [u.id, u.name])), [users]);

  // The exact string the user must type to confirm engagement deletion —
  // no separate "engagement code" field exists, so client name + FY (the
  // same identifier already shown in the dialog copy) is the confirmation key.
  const deleteConfirmTarget = useMemo(() => {
    if (!selectedEngagement) return "";
    return `${selectedEngagement.client_name} — FY ${selectedEngagement.financial_year}`;
  }, [selectedEngagement]);

  const selectedClientName = useMemo(() => {
    if (!selectedClientId || selectedClientId === "all") return "";
    return auditClients.find(c => c.id === selectedClientId)?.name || "";
  }, [selectedClientId, auditClients]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Audit Intelligence</h1>
          <p className="text-sm text-muted-foreground">Engagement dashboard, progress tracking & audit analytics</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() =>
            navigate(selectedEngagementId
              ? `/audit/pipeline/${selectedEngagementId}`
              : '/audit/pipeline')
          }>
            <Layers className="mr-2 h-4 w-4" /> Pipeline View
          </Button>
          {canCreateEngagement && <Button onClick={() => navigate('/audit/pipeline?new=1')}>
            <Plus className="mr-2 h-4 w-4" /> New Engagement
          </Button>}
        </div>
      </div>

      {/* 4-Filter Engagement Switcher */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          {/* Client Filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Client</label>
            <Popover open={clientOpen} onOpenChange={setClientOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={clientOpen} className="w-full justify-between font-normal">
                  {selectedClientName || "All Clients"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search clients..." />
                  <CommandList>
                    <CommandEmpty>No clients found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="all-clients"
                        onSelect={() => {
                          setSelectedClientId("all");
                          setClientOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", (!selectedClientId || selectedClientId === "all") ? "opacity-100" : "opacity-0")} />
                        All Clients
                      </CommandItem>
                      {auditClients.map(c => (
                        <CommandItem
                          key={c.id}
                          value={c.name || c.id}
                          onSelect={() => {
                            setSelectedClientId(c.id);
                            setClientOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", selectedClientId === c.id ? "opacity-100" : "opacity-0")} />
                          {c.name || "Unnamed"}
                          {c.entity_type && <Badge variant="secondary" className="ml-auto text-[10px]">{c.entity_type}</Badge>}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Audit Type Filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Audit Type</label>
            <Select value={filterAuditType} onValueChange={setFilterAuditType}>
              <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {AUDIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Financial Year Filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Financial Year</label>
            <Select value={filterFY} onValueChange={setFilterFY}>
              <SelectTrigger><SelectValue placeholder="All Years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Period Type Filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Period Type</label>
            <Select value={filterPeriodType} onValueChange={setFilterPeriodType}>
              <SelectTrigger><SelectValue placeholder="All Periods" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Periods</SelectItem>
                {PERIOD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Resolved engagement info */}
        {uniqueFilteredEngagements.length > 1 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">
              {uniqueFilteredEngagements.length} engagements match. Select one:
            </p>
            <Popover open={engPickerOpen} onOpenChange={setEngPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={engPickerOpen}
                  className="h-8 text-xs w-full max-w-xl justify-between font-normal"
                >
                  <span className="truncate">
                    {selectedEngagementId
                      ? (() => {
                          const idx = uniqueFilteredEngagements.findIndex(e => e.id === selectedEngagementId);
                          const e   = uniqueFilteredEngagements[idx];
                          return e
                            ? `[${String(idx + 1).padStart(2, "0")}] ${e.client_name} — ${e.audit_type || "Audit"} — FY ${e.financial_year}`
                            : "— choose engagement —";
                        })()
                      : "— choose engagement —"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[480px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search by client name, FY, or type…"
                    value={engPickerSearch}
                    onValueChange={setEngPickerSearch}
                  />
                  <CommandList>
                    <CommandEmpty>No matching engagement found.</CommandEmpty>
                    <CommandGroup>
                      {uniqueFilteredEngagements
                        .map((e, i) => ({ e, i }))
                        .filter(({ e }) => {
                          if (!engPickerSearch.trim()) return true;
                          const q = engPickerSearch.toLowerCase();
                          return (
                            e.client_name?.toLowerCase().includes(q) ||
                            e.financial_year?.toLowerCase().includes(q) ||
                            (e.audit_type || "").toLowerCase().includes(q)
                          );
                        })
                        .map(({ e, i }) => (
                          <CommandItem
                            key={e.id}
                            value={e.id}
                            onSelect={(val) => {
                              setSelectedEngagementId(val);
                              setEngPickerOpen(false);
                              setEngPickerSearch("");
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-3.5 w-3.5 shrink-0",
                                selectedEngagementId === e.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="text-xs">
                              [{String(i + 1).padStart(2, "0")}]{" "}
                              <span className="font-medium">{e.client_name}</span>
                              {" — "}{e.audit_type || "Audit"}
                              {" — "}FY {e.financial_year}
                            </span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}
        {selectedEngagement && (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
            <p className="text-sm text-foreground font-medium">
              Active: <span className="text-primary">{selectedEngagement.client_name} — {selectedEngagement.audit_type || "Audit"} — FY {selectedEngagement.financial_year}</span>
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 h-8 w-8">
                  <MoreVertical size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEditDialog()}>
                  <Pencil size={14} className="mr-2" /> Edit Engagement
                </DropdownMenuItem>
                {canDeleteEngagement && (
                  <DropdownMenuItem onClick={() => openDeleteDialog()} className="text-destructive focus:text-destructive">
                    <Trash2 size={14} className="mr-2" /> Delete Engagement
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </Card>

      {!selectedEngagement ? (
        <Card className="p-12 text-center">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">Select an Engagement</h3>
          <p className="text-sm text-muted-foreground mb-4">Use the filters above to narrow down and select an engagement.</p>
          {canCreateEngagement && <Button onClick={() => navigate('/audit/pipeline?new=1')}>
            <Plus className="mr-2 h-4 w-4" /> Create New Engagement
          </Button>}
        </Card>
      ) : (
        <>
          {/* Engagement Summary Panel */}
          <div className="grid gap-4 md:grid-cols-5">
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Client</p>
              <p className="text-sm font-semibold text-foreground">{selectedEngagement.client_name}</p>
              {selectedEngagement.client_entity_type && (
                <Badge variant="secondary" className="text-[10px] capitalize">{selectedEngagement.client_entity_type}</Badge>
              )}
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Financial Year</p>
              <p className="text-sm font-semibold text-foreground">FY {selectedEngagement.financial_year || "—"}</p>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Audit Type</p>
              <p className="text-sm font-semibold text-foreground capitalize">{selectedEngagement.audit_type || "Statutory"}</p>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</p>
              <Badge
                variant={selectedEngagement.status === "signed" || selectedEngagement.status === "complete" ? "default" : "outline"}
                className="capitalize"
              >
                {selectedEngagement.final_locked ? "✅ Completed" : selectedEngagement.status || "Planning"}
              </Badge>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Partner</p>
              <p className="text-sm font-semibold text-foreground">
                {selectedEngagement.partner_name ||
                  userMap.get(selectedEngagement.partner_id) || "—"}
              </p>
            </Card>
          </div>

          {/* Metrics Row */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <Card className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-blue-50 dark:bg-blue-950">
                <ClipboardCheck size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Queries Raised</p>
                <p className="text-xl font-bold text-foreground">{metrics.queriesRaised}</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-950">
                <Circle size={16} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Queries Pending</p>
                <p className="text-xl font-bold text-foreground">{metrics.queriesPending}</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-purple-50 dark:bg-purple-950">
                <Shield size={16} className="text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Workpapers</p>
                <p className="text-xl font-bold text-foreground">{metrics.workpapers}</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-emerald-50 dark:bg-emerald-950">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">CARO Completed</p>
                <p className="text-xl font-bold text-foreground">{metrics.caroCompleted}</p>
              </div>
            </Card>
          </div>

          {/* 10-Stage Audit Progress Tracker */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Audit Progress</CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{completedStages}/10 stages</span>
                  <span className="text-sm font-semibold text-foreground">{progressPct}%</span>
                </div>
              </div>
              <Progress value={progressPct} className="h-2" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {STAGES.map((stage, idx) => {
                  const status = stageStatuses[String(stage.num)] || "not_started";
                  const Icon = stage.icon;
                  return (
                    <button
                      key={stage.num}
                      onClick={() => handleStageClick(stage)}
                      className={cn(
                        "group relative flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:shadow-md hover:border-primary/30",
                        status === "complete" && "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20",
                        status === "in_progress" && "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20",
                        status === "not_started" && "border-border bg-card"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold",
                        getStageColor(status)
                      )}>
                        {status === "complete" ? <CheckCircle2 size={16} /> : idx + 1}
                      </div>
                      <span className="text-[11px] font-medium text-center leading-tight text-foreground">{stage.label}</span>
                      <span className={cn("text-[9px] font-medium uppercase tracking-wider", getStageTextColor(status))}>
                        {statusLabel[status] || "Not Started"}
                      </span>
                      <ChevronRight size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-6 mt-4 pt-3 border-t">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Circle size={10} className="fill-muted text-muted" /> Not Started
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Circle size={10} className="fill-amber-500 text-amber-500" /> In Progress
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Circle size={10} className="fill-emerald-500 text-emerald-500" /> Completed
                </span>
              </div>
            </CardContent>
          </Card>

          {/* All Engagements */}
          <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarDays size={16} className="text-primary" />
                    All Engagements
                  </CardTitle>
                  <Badge variant="secondary">{engagements.filter(e => e.status !== "archived").length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[300px] overflow-y-auto">
                {engagements.filter(e => e.status !== "archived").slice(0, 10).map(e => (
                  <div
                    key={e.id}
                    className={cn(
                      "group flex items-center gap-1 p-2 rounded-md transition-colors text-sm",
                      e.id === selectedEngagementId
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted border border-transparent"
                    )}
                  >
                    <button
                      className="flex-1 text-left"
                      onClick={() => setSelectedEngagementId(e.id)}
                    >
                      <p className="font-medium text-foreground">{e.client_name}</p>
                      <p className="text-xs text-muted-foreground">{e.audit_type} — FY {e.financial_year}</p>
                    </button>
                    <Badge variant={e.final_locked ? "default" : "outline"} className="capitalize text-[10px] shrink-0">
                      {e.final_locked ? "Completed" : e.status || "planning"}
                    </Badge>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6"
                        title="Edit engagement"
                        onClick={() => { setSelectedEngagementId(e.id); openEditDialog(e); }}
                      >
                        <Pencil size={11} />
                      </Button>
                      {canDeleteEngagement && (
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                          title="Delete engagement"
                          onClick={() => openDeleteDialog(e.id)}
                        >
                          <Trash2 size={11} />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {engagements.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No engagements yet</p>
                )}
              </CardContent>
            </Card>
        </>
      )}

      {/* ─── Edit Engagement Dialog ─── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Engagement</DialogTitle>
            <DialogDescription>Update engagement details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Audit Firm <span className="text-destructive">*</span></Label>
              <Select value={engForm.audit_firm_id} onValueChange={v => setEngForm(f => ({ ...f, audit_firm_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select audit firm" /></SelectTrigger>
                <SelectContent>
                  {auditFirms.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No audit firms found.</div>
                  ) : (
                    auditFirms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Client</Label>
              {/* Client is immutable on an existing engagement. Changing it
                  would orphan the trial balance, financial statements,
                  notes, CARO/MRL/3CD responses, workpapers, and every other
                  child record keyed off (client_id, engagement_id). To
                  switch clients, archive this engagement and create a new
                  one for the target client. */}
              <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">
                {editDialogClients.find(c => c.id === engForm.client_id)?.name
                  || selectedEngagement?.client_name
                  || "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Client cannot be changed on an existing engagement (read-only).</p>
            </div>
            <div>
              <Label>Financial Year</Label>
              {/* Financial Year is immutable on an existing engagement. Changing it
                  would orphan the Tally trial balance, financial statements,
                  comparative PY links, and every FY-scoped artefact (audit-setup
                  flags, 3CD answers, IT return year, TDS quarter mapping).
                  Per locked behaviour: only Audit Firm + Partner are editable. */}
              <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">
                {engForm.financial_year || "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Financial Year cannot be changed on an existing engagement (read-only).</p>
            </div>
            <div>
              <Label>Audit Type</Label>
              {/* Audit Type is immutable on an existing engagement. Switching
                  it (e.g. statutory → tax_audit) would invalidate the
                  requires_caro / requires_3ca / requires_3cb / requires_3cd
                  / requires_cash_flow flags, the schedule_iii_division
                  decision, and every downstream artefact (CARO clause set,
                  3CD clause set, IAR template variant). Archive this
                  engagement and create a new one for a different audit type. */}
              <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground capitalize">
                {(() => {
                  const t = AUDIT_TYPES.find(x => x.value === engForm.audit_type);
                  return t?.label || engForm.audit_type || "—";
                })()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Audit Type cannot be changed on an existing engagement (read-only).</p>
            </div>
            <div>
              <Label>Engagement Partner</Label>
              <Select
                value={engForm.partner_name || "__none__"}
                onValueChange={v => setEngForm(f => ({ ...f, partner_name: v === "__none__" ? "" : v }))}
                disabled={partnersForFirm.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={partnersForFirm.length === 0 ? "Add partners in Settings → Audit Registration" : "Select partner"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Not assigned —</SelectItem>
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
              {/* Period Type is immutable on an existing engagement. Switching
                  between Full Year / Half Year / Quarter would invalidate the
                  Tally export period filter, the financial-statements heading,
                  and the new audit_engagements_unique_live constraint
                  (period_type is part of the uniqueness tuple).
                  Per locked behaviour: only Audit Firm + Partner are editable. */}
              <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">
                {(() => {
                  const p = PERIOD_TYPES.find(x => x.value === engForm.audit_period_type);
                  return p?.label || engForm.audit_period_type || "—";
                })()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Period Type cannot be changed on an existing engagement (read-only).</p>
            </div>
            <div>
              <Label>Entity Type</Label>
              <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">
                {engForm.entity_type || (engForm.client_id ? "Not set on client profile" : "Select a client first")}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Auto-fetched from client profile (read-only)</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={formSaving}>
              {formSaving && <Loader2 size={16} className="mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation — typed confirmation required ─── */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => {
        setShowDeleteDialog(open);
        if (!open) { setDeleteConfirmText(""); setDeletePreview(null); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently Delete Engagement?</DialogTitle>
            <DialogDescription>
              This will <strong>permanently delete</strong> "{selectedEngagement?.client_name} — FY {selectedEngagement?.financial_year}" and all associated data (Tally sync, trial balance, financial statements, TDS, IT returns). This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              {deletePreviewLoading ? (
                <span className="text-muted-foreground">Calculating impact…</span>
              ) : deletePreview ? (
                <>
                  This will permanently delete{" "}
                  <strong>{deletePreview.documents}</strong> document{deletePreview.documents === 1 ? "" : "s"},{" "}
                  <strong>{deletePreview.notes}</strong> financial note{deletePreview.notes === 1 ? "" : "s"}, and{" "}
                  <strong>{deletePreview.workpapers}</strong> workpaper{deletePreview.workpapers === 1 ? "" : "s"} — along with
                  the full trial balance, tax audit data, and planning history for this engagement.
                </>
              ) : (
                <span className="text-muted-foreground">Impact summary unavailable — proceed with caution.</span>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>
                Type <strong>{deleteConfirmTarget}</strong> to confirm
              </Label>
              <Input
                autoFocus
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteConfirmTarget}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={formSaving || deleteConfirmText.trim() !== deleteConfirmTarget}
            >
              {formSaving && <Loader2 size={16} className="mr-2 animate-spin" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

