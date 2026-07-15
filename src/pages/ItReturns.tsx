import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HoverCard, HoverCardContent, HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  FileText, Plus, Download, Search, Filter, X, Eye, Info,
  AlertTriangle, Clock, CheckCircle2, Scale, ChevronRight, ChevronLeft,
  ChevronsLeft, ChevronsRight,
  CalendarDays, Sparkles, Copy, Send, Mail, History, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getClassificationsForFY } from "@/utils/classificationUtils";
import { format, differenceInDays, isBefore, addDays, parse } from "date-fns";

// ─── Constants ───
const ITR_FORMS = ["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6", "ITR-7"];
const FILING_STATUSES = ["Data Pending", "Data Received", "In Progress", "Ready for Review", "Pending Approval from Client", "Filed", "Verified", "Sent to CPC"];
const ASSESSMENT_YEARS = ["2026-27", "2025-26", "2024-25", "2023-24", "2022-23"];

// 2026-06-25 — Switched the UI selector from AY to FY (V J Desai request).
// The DB still keys itr_profiles by assessment_year, so we derive AY from
// the selected FY at query/insert time. Classification lookups now use the
// FY directly instead of accidentally passing the AY into a FY column —
// that was the root cause of "Audited 128" showing for AY 2026-27 (which
// matched FY 2026-27 classifications instead of FY 2025-26).
const FINANCIAL_YEARS = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22"];
const DEFAULT_FY = "2025-26";

const STATUS_COLORS: Record<string, string> = {
  "Data Pending": "bg-blue-500/15 text-blue-600",
  "Data Received": "bg-cyan-500/15 text-cyan-600",
  "In Progress": "bg-amber-500/15 text-amber-600",
  "Ready for Review": "bg-purple-500/15 text-purple-600",
  "Pending Approval from Client": "bg-orange-500/15 text-orange-600",
  "Filed": "bg-teal-500/15 text-teal-600",
  "Verified": "bg-emerald-500/15 text-emerald-600",
  "Sent to CPC": "bg-green-500/15 text-green-700",
};

// ─── Notice Tracker Constants ───
const NOTICE_TYPES = [
  { value: "143_1", label: "143(1)" },
  { value: "148", label: "148" },
  { value: "139_9", label: "139(9)" },
  { value: "245", label: "245" },
  { value: "156", label: "156" },
  { value: "36B", label: "36B" },
  { value: "scrutiny", label: "Scrutiny Assessment" },
];

const NOTICE_STATUSES = [
  "Notice Received", "Under Review", "Reply Drafted", "Reply Filed",
  "Hearing Scheduled", "Order Received", "Closed/Appeal Filed",
] as const;

// ─── Types ───
interface ItrProfile {
  id: string;
  client_id: string | null;
  firm_id: string | null;
  financial_year: string | null;
  itr_form: string | null;
  filing_status: string | null;
  itr_work_group_id: string | null;
  assigned_to: string | null;
  date_data_received: string | null;
  date_filed: string | null;
  acknowledgment_no: string | null;
  assessment_year: string | null;
  client_name?: string;
  client_pan?: string;
  entity_type?: string;
  group_name?: string;
  assigned_name?: string;
  remarks?: string;
  client_classification?: string;
  upload_by?: string | null;
  prepared_by?: string | null;
  checked_by?: string | null;
  work_group_name?: string;
  client_email?: string;
  client_mobile?: string;
  client_responsible_name?: string;
  client_responsible_person_id?: string | null;
  client_group_id?: string | null;
  client_group_name?: string;
}

interface StaffUser { id: string; name: string | null; role: string | null; }

function formatDateDDMMYYYY(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    return format(new Date(dateStr), "dd/MM/yyyy");
  } catch { return dateStr; }
}

// Classification to tab mapping
type FilingSubTab = "audited" | "non_audited" | "partner_in_audited_firm" | "non_itr";

// 2026-06-25 (V J Desai request) — sentinel value used on virtual rows for
// clients whose Income Tax Returns service toggle is OFF. Lets the sub-tab
// router pull them into the "Non-ITR" bucket without conflicting with any
// real Audit / Non-Audit / Partner-in-Audited-Firm classification.
const NON_ITR_SENTINEL = "__non_itr__";

function getClientSubTab(classification: string | undefined): FilingSubTab {
  const cls = (classification || "").toLowerCase();
  if (cls === NON_ITR_SENTINEL) return "non_itr";
  if (cls === "audit") return "audited";
  if (cls === "partner in audited firm" || cls === "partner_in_audited_firm") return "partner_in_audited_firm";
  return "non_audited";
}

/** Convert Assessment Year (e.g. "2025-26") → Financial Year (e.g. "2024-25") */
function ayToFy(ay: string): string {
  const [start] = ay.split("-");
  const fyStart = String(Number(start) - 1);
  const fyEnd = String(Number(start)).slice(-2);
  return `${fyStart}-${fyEnd}`;
}

/** Convert Financial Year (e.g. "2025-26") → Assessment Year (e.g. "2026-27") */
function fyToAy(fy: string): string {
  const [start] = fy.split("-");
  const ayStart = String(Number(start) + 1);
  const ayEnd = String(Number(start) + 2).slice(-2);
  return `${ayStart}-${ayEnd}`;
}

/** Returns the current financial year in "YYYY-YY" format (e.g. "2026-27" in April 2026) */
function getCurrentFY(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-indexed; April = 3
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function staffName(users: { id: string; name?: string | null }[], id: string | null | undefined): string {
  if (!id) return "—";
  const u = users.find(x => x.id === id);
  return (u?.name && u.name.trim()) || "—";
}

function formatFiledDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd MMM yyyy");
  } catch {
    return iso;
  }
}

function isUnsavedItrProfile(profile: Pick<ItrProfile, "id">): boolean {
  return profile.id.startsWith("virtual_") || profile.id.startsWith("new_");
}

function scoreItrProfile(profile: Partial<ItrProfile>): number {
  let score = 0;
  if (profile.filing_status && profile.filing_status !== "Data Pending") score += 8;
  if (profile.itr_form) score += 4;
  if (profile.date_filed) score += 4;
  if (profile.acknowledgment_no) score += 3;
  if (profile.upload_by) score += 2;
  if (profile.prepared_by) score += 2;
  if (profile.checked_by) score += 2;
  if (profile.remarks) score += 1;
  return score;
}

// ─── Main Component ───
const ItReturns = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperadmin = user?.role === "superadmin";
  const firmId = user?.firm_id;

  const [activeTab, setActiveTab] = useState("filing");
  // 2026-06-25 — Selector state is now keyed on the FY the auditor is
  // filing for, not the AY. Derived AY (via fyToAy) is used ONLY when
  // reading/writing the DB's assessment_year column so historic data
  // stays intact.
  const [selectedFY, setSelectedFY] = useState(DEFAULT_FY);
  const selectedAY = fyToAy(selectedFY);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterForm, setFilterForm] = useState("");
  const [filterStaff, setFilterStaff] = useState("");
  const [filterConstitution, setFilterConstitution] = useState("");
  const [filterWorkGroup, setFilterWorkGroup] = useState("");
  const [filterStatus2, setFilterStatus2] = useState("");
  const [filterUploadBy, setFilterUploadBy] = useState("");
  const [filterPreparedBy, setFilterPreparedBy] = useState("");
  const [filterCheckedBy, setFilterCheckedBy] = useState("");
  const [filterResponsiblePerson, setFilterResponsiblePerson] = useState("");
  const [filterFiled, setFilterFiled] = useState<"" | "filed" | "not_filed">("");
  const [filterClientGroup, setFilterClientGroup] = useState("");

  // ─── Responsible Persons (distinct across clients in firm) ───
  const { data: responsiblePersons = [] } = useQuery({
    queryKey: ["itr_responsible_persons", firmId, isSuperadmin],
    queryFn: async () => {
      let cQ = supabase
        .from("clients")
        .select("responsible_person_id")
        .eq("is_draft", false)
        .is("deleted_at", null)
        .not("responsible_person_id", "is", null);
      if (!isSuperadmin && firmId) cQ = cQ.eq("firm_id", firmId);
      const { data: cRows } = await cQ;
      const ids = [...new Set((cRows || []).map((r: any) => r.responsible_person_id).filter(Boolean))] as string[];
      if (ids.length === 0) return [] as { id: string; name: string }[];
      const { data: uRows } = await supabase.from("users").select("id, name").in("id", ids);
      return ((uRows || []) as any[])
        .map(u => ({ id: u.id as string, name: (u.name as string) || "" }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!user?.id,
  });

  // ─── Fetch ITR-activated clients (service-specific AND package billing) ───
  const { data: itrClientIds = [] } = useQuery({
    queryKey: ["itr_client_ids", firmId],
    queryFn: async () => {
      // Step 1: Get all ITR service category IDs.
      // Primary match: linked_module = 'itr'.
      // Fallback: category name contains "itr" or "income tax" (catches categories
      // where the admin forgot to set linked_module).
      const { data: cats } = await supabase
        .from("service_categories")
        .select("id")
        .or("linked_module.eq.itr,name.ilike.%itr%,name.ilike.%income tax%,name.ilike.%it return%");
      if (!cats?.length) return [];
      const catIdSet = new Set(cats.map(c => c.id));
      const catIds = [...catIdSet];

      // Step 2: Service-specific — client_services rows with an ITR category
      const { data: cs } = await supabase
        .from("client_services")
        .select("client_id")
        .in("service_category_id", catIds)
        .eq("is_active", true);
      const specificIds = (cs || []).map(c => c.client_id).filter(Boolean) as string[];

      // Step 3: Package billing — client_service_packages whose service_category_ids
      // JSON array contains at least one ITR category ID.
      // service_category_ids is stored as Json (JSONB array of UUID strings).
      // Fetch all active packages and filter client-side — volume is low (1 per client).
      const { data: pkgs } = await supabase
        .from("client_service_packages")
        .select("client_id, service_category_ids")
        .eq("is_active", true);
      const packageIds = (pkgs || [])
        .filter(p => {
          const ids: string[] = Array.isArray(p.service_category_ids)
            ? (p.service_category_ids as string[])
            : [];
          return ids.some(id => catIdSet.has(id));
        })
        .map(p => p.client_id)
        .filter(Boolean) as string[];

      // Step 4: Merge and deduplicate
      return [...new Set([...specificIds, ...packageIds])];
    },
  });

  // ─── Fetch clients with an audit engagement for the selected AY ───
  const { data: auditClientIds = [] } = useQuery({
    queryKey: ["audit_engaged_client_ids", firmId, selectedAY],
    queryFn: async () => {
      const fy = ayToFy(selectedAY);
      let q = supabase
        .from("audit_engagements")
        .select("client_id")
        .eq("financial_year", fy);
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      return [...new Set((data || []).map((e: any) => e.client_id).filter(Boolean))] as string[];
    },
    enabled: !!user?.id,
  });

  // ─── Fetch staff ───
  const { data: staffUsers = [] } = useQuery({
    queryKey: ["staff_users", firmId],
    queryFn: async () => {
      let q = supabase.from("users").select("id, name, role").neq("role", "client");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      return (data || []) as StaffUser[];
    },
  });

  // ─── Fetch work groups ───
  const { data: workGroups = [] } = useQuery({
    queryKey: ["itr_work_groups", firmId],
    queryFn: async () => {
      let q = supabase.from("itr_work_groups").select("*");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      return (data || []) as any[];
    },
  });

  // ─── Fetch client groups + memberships ───
  const { data: clientGroups = [] } = useQuery({
    queryKey: ["client_groups", firmId],
    queryFn: async () => {
      let q = supabase.from("client_groups").select("id, name").order("name");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      return (data || []) as { id: string; name: string }[];
    },
    enabled: !!user?.id,
  });

  // client_id → { group_id, group_name } (one client can be in at most one group in practice)
  const { data: clientGroupMap = new Map<string, { id: string; name: string }>() } = useQuery({
    queryKey: ["client_group_memberships", firmId],
    queryFn: async () => {
      const { data: memberships } = await supabase
        .from("client_group_memberships")
        .select("client_id, group_id");
      const { data: groups } = await supabase
        .from("client_groups")
        .select("id, name")
        .order("name");
      const groupNameMap = new Map<string, string>((groups || []).map(g => [g.id, g.name]));
      const map = new Map<string, { id: string; name: string }>();
      for (const m of (memberships || [])) {
        if (m.client_id && m.group_id && groupNameMap.has(m.group_id)) {
          map.set(m.client_id, { id: m.group_id, name: groupNameMap.get(m.group_id)! });
        }
      }
      return map;
    },
    enabled: !!user?.id,
  });

  // ─── Fetch profiles with enrichment ───
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["itr_profiles", firmId, selectedFY, itrClientIds, auditClientIds],
    queryFn: async () => {
      const auditSet = new Set(auditClientIds);

      // ── Step 1: Fetch audit-classified clients from client_fy_classifications ──
      // 2026-06-25 (V J Desai bug — "Audited 129" vs Clients "Audit 87"):
      // Previous code included getCurrentFY() as a fallback FY, intended to
      // rescue clients whose wizard-stored classification.financial_year was
      // the ongoing FY (e.g. 2026-27) rather than the year being filed. In
      // practice this over-counted by 42 — clients who had a 2026-27 row but
      // no 2025-26 row silently inherited their 2026-27 classification into
      // the FY 2025-26 tab. Now that the auditor manages classifications
      // per-FY explicitly (Clients → Classification by FY), the fallback
      // is wrong more often than right. Query strictly on selectedFY.
      let clsQ = (supabase as any)
        .from("client_fy_classifications")
        .select("client_id, classification, financial_year")
        .eq("financial_year", selectedFY);
      if (!isSuperadmin && firmId) clsQ = clsQ.eq("firm_id", firmId);
      const { data: fyClassData } = await clsQ;

      // Build classMap: one entry per client, straight from the selectedFY row.
      const classMapRaw = new Map<string, { cls: string; fy: string }>();
      for (const row of (fyClassData || [])) {
        if (!row.client_id) continue;
        const existing = classMapRaw.get(row.client_id);
        if (!existing) {
          classMapRaw.set(row.client_id, { cls: row.classification, fy: row.financial_year });
        }
      }
      const classMap = new Map<string, string>(
        Array.from(classMapRaw.entries()).map(([id, v]) => [id, v.cls])
      );

      // All clients that have ANY classification in client_fy_classifications
      // (Audit, Non-Audited, Partner in Audited Firm — all appear in IT Returns)
      const auditClassifiedClientIds = Array.from(classMapRaw.keys());

      // ── Step 2: Build combined pool ──────────────────────────────────────────
      // 2026-06-25 (V J Desai — ACS ENGITECH bug): previous behaviour
      // fetched every active client and ignored the auditor's service
      // selection ("show every client by default"). That overrode the
      // Service & Billing → Income Tax Returns toggle: clients with ITR
      // OFF still appeared in the tracker. Now the visible pool is the
      // union of:
      //   (a) clients with ITR service turned on (client_services with
      //       ITR category, OR a package containing an ITR category), and
      //   (b) clients who already have an itr_profile row (never drop
      //       historical work if the toggle was later disabled).
      // Any client outside both sets — like ACS ENGITECH with the ITR
      // toggle off — is now hidden as the auditor expects.
      // 2026-06-25 (V J Desai — 712 vs Clients Final 720 reconciliation):
      //   parent's "Final 720" chip lives inside the "Clients via API"
      //   tab and counts every api_import client with is_draft=false and
      //   deleted_at IS NULL — INCLUDING is_active=false ones. It does NOT
      //   include manual clients. To make IT Returns' Total match 720:
      //     (a) restrict base pool to source='api_import' (drops 5 manual)
      //     (b) drop the .neq(is_active,false) filter (recovers 13 inactive)
      //   Result: 725 − 5 = 720, matching the Clients page chip exactly.
      let cQ = supabase
        .from("clients")
        .select("id, name, pan, entity_type, email, mobile, responsible_person_id, work_group_type, responsible_person:users!clients_responsible_person_id_fkey(id, name)")
        .eq("is_draft", false)
        .is("deleted_at", null)
        .eq("source", "api_import")
        .order("name");
      if (!isSuperadmin && firmId) cQ = cQ.eq("firm_id", firmId);
      const { data: cData } = await cQ;
      const itrEnabledIdSet = new Set(itrClientIds);
      const cDataFiltered = (cData || []).filter(c => itrEnabledIdSet.has(c.id));
      // 2026-06-25 (V J Desai — Non-ITR sub-tab): keep the complement so we
      // can surface clients whose ITR service is OFF in a dedicated tab.
      // The auditor uses it to audit their own service configuration —
      // "which clients still need ITR turned on?".
      const cDataNonItr = (cData || []).filter(c => !itrEnabledIdSet.has(c.id));
      const clientMap = new Map(cDataFiltered.map(c => [c.id, c]));
      const allClientIds = cDataFiltered.map(c => c.id);
      if (allClientIds.length === 0 && cDataNonItr.length === 0) return [];

      // ROOT-CAUSE FIX (V J Desai 703 clients showing every status as
       // "Data Pending" even after save): the previous .in("client_id",
       // allClientIds) sent every active client id as a URL-based IN
       // clause. 703 × 36-char UUIDs + commas = ~26 KB of URL — well past
       // PostgREST / Supabase's URL length ceiling, so the request was
       // silently dropping rows (or returning none). The saved profiles
       // in the DB never reached the front-end, the page only showed the
       // virtual-row fallback, and every dropdown change appeared to
       // "revert" on refetch.
       //
       // Drop the .in() entirely: filtering by firm_id (RLS-enforced) and
       // assessment_year is already constraining enough — itr_profiles
       // for other firms can't leak in. Rows for clients that aren't in
       // the active cData list (deleted / draft / inactive) still get
       // filtered out downstream at line 430 (clientMap.has(clientId)
       // check). Net result: no data lost, no URL-length cliff.
       const fetchSize = 5000;
       let pData: any[] = [];
       let from = 0;
       while (true) {
         let q = supabase
           .from("itr_profiles")
           .select("*")
           .eq("assessment_year", selectedAY)
           .range(from, from + fetchSize - 1);
         if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
         const { data: batch, error } = await q;
         if (error) {
           console.error("[ItReturns] itr_profiles fetch failed", error);
           break;
         }
         if (!batch || batch.length === 0) break;
         pData = pData.concat(batch);
         if (batch.length < fetchSize) break;
         from += fetchSize;
       }

      // ── FY-aware classification resolution ────────────────────────────────
      // Use the shared util which consults client_classification_history first
      // (so past FYs aren't retroactively reclassified), then falls back to
      // client_fy_classifications, then to the live client.classification.
      // Now that the selector is FY-native we can pass it in directly.
      const targetFY = selectedFY;
      const fyAwareClsMap = await getClassificationsForFY(allClientIds, targetFY);

      // Classification logic (in priority order):
      // 1. Client has an audit engagement for this FY              → "Audit"
      // 2. FY-aware util resolves to "Audit"                       → "Audit"
      // 3. FY-aware util resolves to "Partner in Audited Firm"     → that
      // 4. Legacy classMap fallback (handles wizard-stored currentFY rows)
      // 5. Everything else (ITR-service clients)                   → Non-Audited
      const resolveClassification = (clientId: string): string => {
        if (auditSet.has(clientId)) return "Audit";
        const fyAware = (fyAwareClsMap.get(clientId) || "").toLowerCase();
        if (fyAware === "audit") return "Audit";
        if (fyAware.includes("partner")) return fyAwareClsMap.get(clientId)!;
        const cls = classMap.get(clientId) || "";
        if (cls.toLowerCase() === "audit") return "Audit";
        if (cls.toLowerCase().includes("partner")) return cls;
        return "";
      };

      // Fetch users
      const { data: uData } = await supabase.from("users").select("id, name");
      const userMap = new Map((uData || []).map(u => [u.id, u.name]));

      // itr_work_groups map (for the ITR-specific work group assigned on a profile)
      const wgMap = new Map(workGroups.map((g: any) => [g.id, g]));
      const canonicalProfilesByClient = new Map<string, any>();
      for (const profile of (pData || [])) {
        const clientId = profile.client_id;
        if (!clientId || !clientMap.has(clientId)) continue;
        const existing = canonicalProfilesByClient.get(clientId);
        if (!existing || scoreItrProfile(profile) > scoreItrProfile(existing)) {
          canonicalProfilesByClient.set(clientId, profile);
        }
      }

      const canonicalProfiles = Array.from(canonicalProfilesByClient.values());
      const existingClientIds = new Set(canonicalProfiles.map(p => p.client_id));
      const enriched: ItrProfile[] = [];

      for (const p of canonicalProfiles) {
        const cl = clientMap.get(p.client_id || "");
        const wg = wgMap.get(p.itr_work_group_id || "");
        // work_group_type is set in the client wizard's Advanced Info step and stored on clients table.
        // Fall back to itr_work_groups name if available.
        const workGroupDisplay = (cl as any)?.work_group_type || (wg as any)?.name || "";
        enriched.push({
          ...p,
          client_name: cl?.name || "Unknown",
          client_pan: cl?.pan || "",
          entity_type: cl?.entity_type || "",
          group_name: workGroupDisplay,
          assigned_name: userMap.get(p.assigned_to || "") || "",
          client_classification: resolveClassification(p.client_id || ""),
          work_group_name: workGroupDisplay,
          client_email: (cl as any)?.email || "",
          client_mobile: (cl as any)?.mobile || "",
          client_responsible_name: (cl as any)?.responsible_person?.name || "",
          client_responsible_person_id: (cl as any)?.responsible_person_id || null,
        });
      }

      for (const client of cDataFiltered) {
        if (existingClientIds.has(client.id)) continue;
        const workGroupDisplay = (client as any).work_group_type || "";
        enriched.push({
          id: `virtual_${client.id}_${selectedFY}`,
          client_id: client.id,
          firm_id: firmId,
          financial_year: selectedFY,
          itr_form: null,
          filing_status: "Data Pending",
          itr_work_group_id: null,
          assigned_to: client.responsible_person_id || null,
          date_data_received: null,
          date_filed: null,
          acknowledgment_no: null,
          assessment_year: selectedAY,
          checked_by: null,
          prepared_by: null,
          remarks: null,
          upload_by: null,
          client_name: client.name || "Unknown",
          client_pan: client.pan || "",
          entity_type: client.entity_type || "",
          client_classification: resolveClassification(client.id),
          work_group_name: workGroupDisplay,
          group_name: workGroupDisplay,
          client_email: (client as any).email || "",
          client_mobile: (client as any).mobile || "",
          client_responsible_name: (client as any).responsible_person?.name || "",
          client_responsible_person_id: (client as any).responsible_person_id || null,
        });
      }

      // 2026-06-25 (V J Desai) — append virtual rows for the Non-ITR bucket.
      // No itr_profile join, no filing status: the tab exists purely so the
      // auditor can see which clients still need the ITR service turned on.
      for (const client of cDataNonItr) {
        const workGroupDisplay = (client as any).work_group_type || "";
        enriched.push({
          id: `non_itr_${client.id}_${selectedFY}`,
          client_id: client.id,
          firm_id: firmId,
          financial_year: selectedFY,
          itr_form: null,
          filing_status: null,
          itr_work_group_id: null,
          assigned_to: null,
          date_data_received: null,
          date_filed: null,
          acknowledgment_no: null,
          assessment_year: selectedAY,
          checked_by: null,
          prepared_by: null,
          remarks: null,
          upload_by: null,
          client_name: client.name || "Unknown",
          client_pan: client.pan || "",
          entity_type: client.entity_type || "",
          client_classification: NON_ITR_SENTINEL,
          work_group_name: workGroupDisplay,
          group_name: workGroupDisplay,
          client_email: (client as any).email || "",
          client_mobile: (client as any).mobile || "",
          client_responsible_name: (client as any).responsible_person?.name || "",
          client_responsible_person_id: (client as any).responsible_person_id || null,
        });
      }

      return enriched.sort((a, b) => (a.client_name || "").localeCompare(b.client_name || ""));
    },
    // Run as soon as user is available. The queryKey includes itrClientIds and
    // auditClientIds so React Query re-runs automatically when those pools load.
    // Removed the itrClientIds.length > 0 guard — it was preventing the query
    // from running in cases where itrClientIds hadn't resolved yet, causing
    // clients to only appear after manual "Add Row" instead of auto-populating.
    enabled: !!user?.id,
    // The global QueryClient sets staleTime to 5 min — too long for this
    // grid where the auditor immediately wants their own status / prep /
    // check / ack edits reflected. Force an always-fresh fetch on every
    // mount and window-focus so stale cached rows never linger.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // ─── Filtered profiles ───
  const filtered = useMemo(() => {
    return profiles.filter(p => {
      if (search && !(p.client_name || "").toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus && (p.filing_status || "Data Pending") !== filterStatus) return false;
      if (filterForm && p.itr_form !== filterForm) return false;
      if (filterStaff && p.assigned_to !== filterStaff) return false;
      if (filterConstitution && (p.entity_type || "") !== filterConstitution) return false;
      if (filterWorkGroup && (p.group_name || p.work_group_name || "") !== filterWorkGroup) return false;
      if (filterClientGroup && clientGroupMap.get(p.client_id || "")?.id !== filterClientGroup) return false;
      if (filterUploadBy && (p as any).upload_by !== filterUploadBy) return false;
      if (filterPreparedBy && (p as any).prepared_by !== filterPreparedBy) return false;
      if (filterCheckedBy && (p as any).checked_by !== filterCheckedBy) return false;
      if (filterResponsiblePerson && p.client_responsible_person_id !== filterResponsiblePerson) return false;
      if (filterFiled === "filed" && (p.filing_status || "") !== "Filed") return false;
      if (filterFiled === "not_filed" && (p.filing_status || "") === "Filed") return false;
      return true;
    });
  }, [profiles, clientGroupMap, search, filterStatus, filterForm, filterStaff, filterConstitution, filterWorkGroup, filterClientGroup, filterUploadBy, filterPreparedBy, filterCheckedBy, filterResponsiblePerson, filterFiled]);

  // ─── Status counts ───
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    FILING_STATUSES.forEach(s => { counts[s] = 0; });
    profiles.forEach(p => { const s = p.filing_status || "Data Pending"; counts[s] = (counts[s] || 0) + 1; });
    return counts;
  }, [profiles]);

  // ─── Filed / Not Filed counts ───
  const filedCounts = useMemo(() => {
    let filed = 0, notFiled = 0;
    profiles.forEach(p => {
      if ((p.filing_status || "") === "Filed") filed++;
      else notFiled++;
    });
    return { filed, notFiled };
  }, [profiles]);

  // ─── Client-group-wise counts ───
  const groupCounts = useMemo(() => {
    const counts: Record<string, { id: string; total: number; filed: number }> = {};
    profiles.forEach(p => {
      const grp = clientGroupMap.get(p.client_id || "");
      const gName = grp?.name || "Ungrouped";
      const gId   = grp?.id   || "";
      if (!counts[gName]) counts[gName] = { id: gId, total: 0, filed: 0 };
      counts[gName].total++;
      if ((p.filing_status || "") === "Filed") counts[gName].filed++;
    });
    return counts;
  }, [profiles, clientGroupMap]);

  // ─── Inline update handler ───
  const handleInlineUpdate = async (
    profile: ItrProfile,
    field: string,
    value: any,
    extraPatch?: Record<string, any>,
  ) => {
    const isNew = isUnsavedItrProfile(profile);
    // Auto-fill / auto-clear policy tied to filing_status transitions:
    //
    //  • Ready for Review  → fills Prepared By with the signed-in user
    //                        (only if currently empty — manual overrides win).
    //                        Also clears Checked By if the row was previously
    //                        Verified — the new reviewer hasn't checked yet,
    //                        so the prior "Checked By" claim is stale.
    //  • Verified          → fills Checked By with the signed-in user
    //                        (only if currently empty).
    //  • Filed             → stamps date_filed with today (YYYY-MM-DD) if
    //                        the auditor hasn't already entered one, and
    //                        fills Upload By with the signed-in user when
    //                        empty (the auditor who marks the return as
    //                        Filed is the one who uploaded it). Requires
    //                        a non-blank Ack No — without it, the status
    //                        change is rejected with a toast so the auditor
    //                        types the ARN before the row can be marked Filed.
    //  • Data Pending      → resets the whole "filed" footprint (prepared_by,
    //                        checked_by, date_filed, acknowledgment_no,
    //                        upload_by) back to NULL. Without this clear,
    //                        a row that briefly hit "Filed" and then got
    //                        reverted left stale Prepared-By / Filed-Date
    //                        values that contradicted the new Data Pending
    //                        state.
    const autoPatch: Record<string, any> = {};
    if (field === "filing_status" && user?.id) {
      // Ack No gate: refuse to move into "Filed" without an acknowledgement
      // number. Surface a destructive toast so the auditor sees exactly why
      // the dropdown reverted, and stop here — no DB write, no optimistic
      // patch, no history-log entry.
      if (value === "Filed" && !((profile as any).acknowledgment_no || "").trim()) {
        toast({
          title: "Ack No is required",
          description: "Enter the ARN (Ack No) on this row's Info panel before marking it as Filed.",
          variant: "destructive",
        });
        return;
      }
      if (value === "Ready for Review") {
        if (!(profile as any).prepared_by) autoPatch.prepared_by = user.id;
        // Demoting from Verified → Ready for Review means the prior
        // Checked-By no longer holds — the new review hasn't been done.
        if ((profile as any).checked_by) autoPatch.checked_by = null;
      }
      if (value === "Verified" && !(profile as any).checked_by) {
        autoPatch.checked_by = user.id;
      }
      if (value === "Filed") {
        if (!(profile as any).date_filed) {
          autoPatch.date_filed = new Date().toISOString().slice(0, 10);
        }
        if (!(profile as any).upload_by) {
          autoPatch.upload_by = user.id;
        }
        // 2026-06-25 (V J Desai — 33 Filed rows had blank Prepared By /
        // Checked By): the auto-patch previously only stamped date_filed
        // + upload_by on the Filed transition. Straight Data Pending →
        // Filed skipped the intermediate Ready-for-Review / Verified
        // steps, so prepared_by and checked_by never got populated.
        //
        // 2026-06-25 (V J Desai follow-up — segregation of duties):
        // Filling checked_by = current user when prepared_by is ALREADY
        // the current user made Prepared By and Checked By render the
        // same person (e.g. auditor moved Ready-for-Review → Filed),
        // defeating the four-eyes review the audit trail is meant to
        // enforce. Rule: only auto-fill checked_by when the signed-in
        // user is DIFFERENT from prepared_by. If the same auditor is
        // closing out their own preparation, checked_by stays blank
        // and the reviewer must set it explicitly.
        const existingPreparedBy = (profile as any).prepared_by as string | null | undefined;
        if (!existingPreparedBy) {
          autoPatch.prepared_by = user.id;
        }
        if (!(profile as any).checked_by) {
          const effectivePreparedBy = autoPatch.prepared_by ?? existingPreparedBy;
          if (effectivePreparedBy && effectivePreparedBy !== user.id) {
            autoPatch.checked_by = user.id;
          }
          // Same-person case: leave checked_by blank on purpose — the
          // reviewer needs to set it.
        }
      }
      if (value === "Data Pending") {
        autoPatch.prepared_by       = null;
        autoPatch.checked_by        = null;
        autoPatch.date_filed        = null;
        autoPatch.acknowledgment_no = null;
        autoPatch.upload_by         = null;
      }
    }
    const patch = { [field]: value ?? null, ...autoPatch, ...(extraPatch || {}) };
    // ── Optimistic cache update ──────────────────────────────────────────
    // The IT Returns query (`["itr_profiles", firmId, selectedAY, ...]`)
    // returns an array of enriched profiles. We patch the matching row
    // immediately so the dropdown reflects the new value the moment the
    // user clicks, without waiting for the round-trip + refetch. On
    // error we roll back; on success we await refetch to get any
    // server-side denormalisations.
    const previousCaches: Array<[readonly unknown[], unknown]> =
      queryClient.getQueriesData({ queryKey: ["itr_profiles"] }) as any;
    queryClient.setQueriesData(
      { queryKey: ["itr_profiles"] },
      (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((row: any) =>
          row.client_id === profile.client_id ? { ...row, ...patch } : row,
        );
      },
    );

    try {
      if (isNew) {
        const payload: any = {
          client_id: profile.client_id,
          firm_id: firmId,
          assessment_year: selectedAY,
          financial_year: profile.financial_year,
          filing_status: profile.filing_status || "Data Pending",
          assigned_to: profile.assigned_to || null,
          itr_form: profile.itr_form || null,
          itr_work_group_id: profile.itr_work_group_id || null,
          date_data_received: profile.date_data_received || null,
          date_filed: profile.date_filed || null,
          acknowledgment_no: profile.acknowledgment_no || null,
          upload_by: profile.upload_by || null,
          prepared_by: profile.prepared_by || null,
          checked_by: profile.checked_by || null,
          remarks: profile.remarks || null,
          ...patch,
        };
        // Upsert on the (client_id, assessment_year, firm_id) unique
        // constraint so rapid double-clicks during the brief window
        // between INSERT and refetch don't pile up duplicate rows.
        // Returns the canonical row regardless of insert-vs-update.
        const { data, error } = await supabase
          .from("itr_profiles")
          .upsert(payload, { onConflict: "client_id,assessment_year,firm_id" })
          .select();
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error("Row was not created (possible RLS policy block). Check Supabase logs.");
        }
        // Swap the virtual id for the real DB id in the cache so the
        // NEXT edit on this row hits the UPDATE branch instead of
        // creating yet another duplicate.
        const realId = (data[0] as any).id as string;
        queryClient.setQueriesData(
          { queryKey: ["itr_profiles"] },
          (old: any) => {
            if (!Array.isArray(old)) return old;
            return old.map((row: any) =>
              row.id === profile.id ? { ...row, id: realId } : row,
            );
          },
        );
      } else {
        const { data, error } = await supabase.from("itr_profiles").update(patch as any).eq("id", profile.id).select();
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error("Row was not updated (possible RLS policy block). Check Supabase logs.");
        }
      }
      // Write the change(s) to the per-row edit log. One row per field changed
      // (including auto-filled fields from autoPatch above) so the auditor can
      // see who flipped status to "Filed" and when, who cleared the Prepared
      // By, etc. Best-effort — log failure must not roll back the user's save.
      try {
        const formatVal = (v: any): string | null => {
          if (v == null) return null;
          if (typeof v === "string") return v;
          return String(v);
        };
        const histRows = Object.entries(patch).map(([f, newV]) => ({
          client_id:       profile.client_id,
          firm_id:         firmId ?? (profile as any).firm_id ?? null,
          assessment_year: selectedAY,
          field_name:      f,
          old_value:       formatVal((profile as any)[f]),
          new_value:       formatVal(newV),
          changed_by:      user?.id ?? null,
          changed_by_name: user?.name ?? null,
        }));
        if (histRows.length > 0) {
          await (supabase as any).from("itr_profile_history").insert(histRows);
        }
      } catch (logErr) {
        console.warn("[ItReturns] edit-log write failed", logErr);
      }
      // Await refetch so the next render uses authoritative server data,
      // not just our optimistic patch.
      await queryClient.invalidateQueries({ queryKey: ["itr_profiles"] });
    } catch (e: any) {
      // Roll back the optimistic patch
      previousCaches.forEach(([key, data]) => queryClient.setQueryData(key, data));
      console.error("ITR inline update failed", { field, value, profileId: profile.id, error: e });
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };

  // ─── Export ───
  const handleExport = () => {
    import("xlsx").then(XLSX => {
      const rows = filtered.map(p => ({
        "Client Name": p.client_name,
        "PAN": p.client_pan,
        "Constitution": p.entity_type,
        "Work Group": p.work_group_name || p.group_name,
        "ITR Form": p.itr_form || "",
        "Status": p.filing_status || "Data Pending",
        "Due Date": "",
        "Filed Date": formatDateDDMMYYYY(p.date_filed),
        "Ack No": p.acknowledgment_no || "",
        "Assigned To": p.assigned_name || "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ITR Filings");
      XLSX.writeFile(wb, `ITR_Filings_${selectedAY}_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">IT Returns</h1>
          <p className="text-muted-foreground text-sm">Income tax return filing, tracking & compliance</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Badge
              className={cn(
                "cursor-pointer text-xs px-3 py-1 bg-teal-500/15 text-teal-700 hover:bg-teal-500/25",
                filterFiled === "filed" && "ring-2 ring-primary"
              )}
              onClick={() => setFilterFiled(filterFiled === "filed" ? "" : "filed")}
              title="Click to filter by Filed"
            >
              Filed: {filedCounts.filed}
            </Badge>
            <Badge
              className={cn(
                "cursor-pointer text-xs px-3 py-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/25",
                filterFiled === "not_filed" && "ring-2 ring-primary"
              )}
              onClick={() => setFilterFiled(filterFiled === "not_filed" ? "" : "not_filed")}
              title="Click to filter by Not Filed"
            >
              Not Filed: {filedCounts.notFiled}
            </Badge>
          </div>
          <Select value={selectedFY} onValueChange={setSelectedFY}>
            <SelectTrigger className="w-[160px]" title="Financial Year whose ITRs are being filed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FINANCIAL_YEARS.map(fy => (
                <SelectItem key={fy} value={fy}>
                  FY {fy} (AY {fyToAy(fy)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs: Filing | Compliance */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="filing" className="gap-1.5">
            <FileText size={14} /> Filing
          </TabsTrigger>
          <TabsTrigger value="compliance" className="gap-1.5">
            <AlertTriangle size={14} /> Compliance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="filing">
          <FilingTab
            profiles={filtered}
            allProfiles={profiles}
            statusCounts={statusCounts}
            staffUsers={staffUsers}
            workGroups={workGroups}
            search={search}
            setSearch={setSearch}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterForm={filterForm}
            setFilterForm={setFilterForm}
            filterStaff={filterStaff}
            setFilterStaff={setFilterStaff}
            filterConstitution={filterConstitution}
            setFilterConstitution={setFilterConstitution}
            filterWorkGroup={filterWorkGroup}
            setFilterWorkGroup={setFilterWorkGroup}
            filterUploadBy={filterUploadBy}
            setFilterUploadBy={setFilterUploadBy}
            filterPreparedBy={filterPreparedBy}
            setFilterPreparedBy={setFilterPreparedBy}
            filterCheckedBy={filterCheckedBy}
            setFilterCheckedBy={setFilterCheckedBy}
            filterResponsiblePerson={filterResponsiblePerson}
            setFilterResponsiblePerson={setFilterResponsiblePerson}
            filterFiled={filterFiled}
            setFilterFiled={setFilterFiled}
            filterClientGroup={filterClientGroup}
            setFilterClientGroup={setFilterClientGroup}
            clientGroups={clientGroups}
            groupCounts={groupCounts}
            responsiblePersons={responsiblePersons}
            isLoading={isLoading}
            onInlineUpdate={handleInlineUpdate}
            onExport={handleExport}
            navigate={navigate}
            selectedAY={selectedAY}
            firmId={firmId}
            user={user}
          />
        </TabsContent>

        <TabsContent value="compliance">
          <ComplianceTab navigate={navigate} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ItReturns;

// ─── Filing Tab with sub-tabs ───
function FilingTab({
  profiles, allProfiles, statusCounts, staffUsers, workGroups,
  search, setSearch, filterStatus, setFilterStatus,
  filterForm, setFilterForm, filterStaff, setFilterStaff,
  filterConstitution, setFilterConstitution,
  filterWorkGroup, setFilterWorkGroup,
  filterUploadBy, setFilterUploadBy,
  filterPreparedBy, setFilterPreparedBy,
  filterCheckedBy, setFilterCheckedBy,
  filterResponsiblePerson, setFilterResponsiblePerson,
  filterFiled, setFilterFiled,
  filterClientGroup, setFilterClientGroup,
  clientGroups,
  groupCounts,
  responsiblePersons,
  isLoading, onInlineUpdate, onExport, navigate, selectedAY,
  firmId, user,
}: any) {
  const [filingSubTab, setFilingSubTab] = useState<FilingSubTab>("audited");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Sub-tab filtered profiles
  const subTabProfiles = useMemo(() => {
    return profiles.filter((p: ItrProfile) => getClientSubTab(p.client_classification) === filingSubTab);
  }, [profiles, filingSubTab]);

  // ─── Pagination (50 rows per page) ─────────────────────────────────────────
  // Single page-state shared across subtabs — resets to 1 when the active
  // subtab changes or when the underlying filtered list shrinks below the
  // current page's start row (e.g. user applies a stricter filter).
  const PAGE_SIZE = 50;
  const [currentPage, setCurrentPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(subTabProfiles.length / PAGE_SIZE));

  // Reset to page 1 when the user switches subtab.
  useEffect(() => { setCurrentPage(1); }, [filingSubTab]);

  // If filters shrink the list below the current page, snap back into range.
  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(1);
  }, [pageCount, currentPage]);

  const pagedProfiles = useMemo(
    () => subTabProfiles.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [subTabProfiles, currentPage],
  );

  const pageStart = subTabProfiles.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd   = Math.min(currentPage * PAGE_SIZE, subTabProfiles.length);

  // Sub-tab counts
  const subTabCounts = useMemo(() => {
    const counts = { audited: 0, non_audited: 0, partner_in_audited_firm: 0, non_itr: 0 };
    for (const p of allProfiles) {
      const tab = getClientSubTab((p as ItrProfile).client_classification);
      counts[tab]++;
    }
    return counts;
  }, [allProfiles]);

  // Add Row handler — pick a client first
  const [addingRow, setAddingRow] = useState(false);
  const [showAddRowDialog, setShowAddRowDialog] = useState(false);
  const [addRowClientId, setAddRowClientId] = useState("");
  const [addRowClients, setAddRowClients] = useState<{id:string;name:string;pan:string|null;entity_type?:string|null}[]>([]);
  const [addRowSearch, setAddRowSearch] = useState("");
  const representedClientIds = useMemo(
    () => new Set((allProfiles as ItrProfile[]).map((profile) => profile.client_id).filter(Boolean)),
    [allProfiles]
  );

  const openAddRowDialog = async () => {
    // Fetch all clients with ITR service active (match by linked_module OR name)
    const { data: cats } = await supabase.from("service_categories").select("id")
      .or("linked_module.eq.itr,name.ilike.%itr%,name.ilike.%income tax%,name.ilike.%it return%");
    if (!cats?.length) { toast({ title: "No ITR service category found", variant: "destructive" }); return; }
    const catIds = cats.map(c => c.id);
    const { data: cs } = await supabase.from("client_services").select("client_id").in("service_category_id", catIds).eq("is_active", true);
    const clientIds = [...new Set((cs || []).map(c => c.client_id))];
    if (!clientIds.length) { toast({ title: "No clients with ITR service enabled", variant: "destructive" }); return; }
    const { data: clients } = await supabase.from("clients").select("id, name, pan, entity_type").eq("is_draft", false).is("deleted_at", null).neq("is_active", false).in("id", clientIds).order("name");
    const availableClients = (clients || []).filter((client: any) => !representedClientIds.has(client.id));
    if (availableClients.length === 0) {
      toast({ title: "All ITR service clients already appear automatically" });
      return;
    }
    setAddRowClients(availableClients as any);
    setAddRowClientId("");
    setAddRowSearch("");
    setShowAddRowDialog(true);
  };

  const handleAddRow = async () => {
    if (!addRowClientId) { toast({ title: "Please select a client", variant: "destructive" }); return; }
    if (representedClientIds.has(addRowClientId)) {
      toast({ title: "This client already exists in the ITR table", variant: "destructive" });
      return;
    }
    setAddingRow(true);
    try {
      const selectedClient = addRowClients.find(c => c.id === addRowClientId);

      // Pre-fill assigned_to from client's responsible_person_id
      const { data: clientData } = await supabase.from("clients").select("responsible_person_id").eq("id", addRowClientId).single();
      const assignedTo = clientData?.responsible_person_id || null;

      const { error } = await supabase.from("itr_profiles").insert({
        client_id: addRowClientId,
        firm_id: firmId,
        assessment_year: selectedAY,
        financial_year: ayToFy(selectedAY),
        filing_status: "Data Pending",
        assigned_to: assignedTo,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["itr_profiles"] });
      toast({ title: "New row added", description: `${selectedClient?.name || "Client"} added to the table.` });
      setShowAddRowDialog(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAddingRow(false);
    }
  };

  const filteredAddRowClients = addRowClients.filter(c =>
    !addRowSearch || (c.name || "").toLowerCase().includes(addRowSearch.toLowerCase())
  );

  const handleDeleteRow = async (profile: ItrProfile) => {
    if (!profile.id || isUnsavedItrProfile(profile) || !window.confirm(`Delete ITR row for ${profile.client_name}?`)) return;
    const { error } = await supabase.from("itr_profiles").delete().eq("id", profile.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["itr_profiles"] });
    toast({ title: "Row deleted" });
  };

  return (
    <div className="space-y-4">
      {/* Status count strip */}
      <div className="flex flex-wrap gap-2">
        {FILING_STATUSES.map(s => (
          <Badge
            key={s}
            className={cn("cursor-pointer text-xs px-3 py-1", STATUS_COLORS[s], filterStatus === s && "ring-2 ring-primary")}
            onClick={() => setFilterStatus(filterStatus === s ? "" : s)}
          >
            {s}: {statusCounts[s] || 0}
          </Badge>
        ))}
        <Badge variant="outline" className="text-xs px-3 py-1">
          Total: {allProfiles.length}
        </Badge>
      </div>

      {/* Toolbar — search + actions only; column filters are in the table header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search client..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select
          value={filterResponsiblePerson || "__all__"}
          onValueChange={v => setFilterResponsiblePerson(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="w-[160px] h-9">
            <SelectValue placeholder="Responsible Person" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Responsible</SelectItem>
            {(responsiblePersons as { id: string; name: string }[]).map(u => (
              <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filterClientGroup || "__all__"}
          onValueChange={v => setFilterClientGroup(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="w-[200px] h-9">
            <SelectValue placeholder="Client Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Client Groups</SelectItem>
            {Object.entries(groupCounts || {})
              .filter(([g]) => g !== "Ungrouped")
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([g, c]: any) => (
                <SelectItem key={c.id} value={c.id}>
                  {g} — Filed {c.filed}/{c.total}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select
          value={filterFiled || "__all__"}
          onValueChange={v => setFilterFiled(v === "__all__" ? "" : v as any)}
        >
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Filing" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Filings</SelectItem>
            <SelectItem value="filed">Filed</SelectItem>
            <SelectItem value="not_filed">Not Filed</SelectItem>
          </SelectContent>
        </Select>
        {(search || filterStatus || filterForm || filterConstitution || filterWorkGroup || filterClientGroup || filterUploadBy || filterPreparedBy || filterCheckedBy || filterResponsiblePerson || filterFiled) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterStatus(""); setFilterForm(""); setFilterConstitution(""); setFilterWorkGroup(""); setFilterClientGroup(""); setFilterUploadBy(""); setFilterPreparedBy(""); setFilterCheckedBy(""); setFilterResponsiblePerson(""); setFilterFiled(""); }}>
            <X size={14} className="mr-1" /> Clear Filters
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={openAddRowDialog} className="gap-1">
          <Plus size={14} /> Add Row
        </Button>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download size={14} className="mr-1.5" /> Export
        </Button>
      </div>

      {/* Add Row Dialog */}
      <Dialog open={showAddRowDialog} onOpenChange={setShowAddRowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add ITR Row — Select Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Search client name..."
              value={addRowSearch}
              onChange={e => setAddRowSearch(e.target.value)}
              className="h-9"
            />
            <div className="max-h-60 overflow-auto border rounded-lg">
              {filteredAddRowClients.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No matching clients</p>
              ) : filteredAddRowClients.map(c => (
                <button
                  key={c.id}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 text-left border-b last:border-0",
                    addRowClientId === c.id && "bg-primary/10"
                  )}
                  onClick={() => setAddRowClientId(c.id)}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.entity_type || "—"}</span>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRowDialog(false)}>Cancel</Button>
            <Button onClick={handleAddRow} disabled={addingRow || !addRowClientId}>
              {addingRow ? "Adding..." : "Add Row"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filing sub-tabs */}
      <Tabs value={filingSubTab} onValueChange={v => setFilingSubTab(v as FilingSubTab)}>
        <TabsList>
          <TabsTrigger value="audited">Audited ({subTabCounts.audited})</TabsTrigger>
          <TabsTrigger value="non_audited">Non-Audited ({subTabCounts.non_audited})</TabsTrigger>
          <TabsTrigger value="partner_in_audited_firm">Partner in Audited Firm ({subTabCounts.partner_in_audited_firm})</TabsTrigger>
          <TabsTrigger value="non_itr" title="Clients whose Income Tax Returns service is turned OFF">
            Non-ITR ({subTabCounts.non_itr})
          </TabsTrigger>
        </TabsList>

        {(["audited", "non_audited", "partner_in_audited_firm", "non_itr"] as FilingSubTab[]).map(tab => (
          <TabsContent key={tab} value={tab}>
            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : tab === "non_itr" ? (
              // 2026-06-25 — Non-ITR sub-tab: no filing workflow, just a
              // list of clients whose ITR service is OFF so the auditor
              // can spot who still needs the toggle flipped on. Only Name /
              // PAN / Constitution — Work Group and Responsible removed per
              // V J Desai request (not needed for this triage view).
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="min-w-[240px]">Client Name</TableHead>
                      <TableHead className="min-w-[100px]">PAN</TableHead>
                      <TableHead className="min-w-[120px]">Constitution</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subTabProfiles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">
                          Every client has the ITR service enabled — nothing to show here.
                        </TableCell>
                      </TableRow>
                    ) : pagedProfiles.map((p: ItrProfile) => (
                      <TableRow
                        key={p.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/clients/edit/${p.client_id}?tab=service-billing`)}
                        title="Open Service & Billing to enable ITR for this client"
                      >
                        <TableCell className="font-medium text-primary" title={p.client_name || undefined}>
                          {p.client_name || "Unnamed"}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{p.client_pan || "—"}</TableCell>
                        <TableCell>{p.entity_type || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    {/* ── Column labels ── */}
                    <TableRow>
                      <TableHead className="sticky left-0 z-20 bg-background min-w-[240px]">Client Name</TableHead>
                      <TableHead className="min-w-[100px]">Constitution</TableHead>
                      <TableHead className="min-w-[120px]">Work Group</TableHead>
                      <TableHead className="min-w-[160px]">Status</TableHead>
                      <TableHead className="min-w-[130px]">Prepared By</TableHead>
                      <TableHead className="min-w-[130px]">Checked By</TableHead>
                      <TableHead className="min-w-[130px]">Filed Date</TableHead>
                      <TableHead className="min-w-[130px]">Upload By</TableHead>
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                    {/* ── Column filters ── */}
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="sticky left-0 z-20 bg-muted/40 py-1 px-2">
                        <span className="text-[10px] text-muted-foreground italic">search ↑</span>
                      </TableHead>
                      <TableHead className="py-1 px-2">
                        <select
                          value={filterConstitution}
                          onChange={e => setFilterConstitution(e.target.value)}
                          className="h-6 text-[11px] w-full rounded border border-border bg-background px-1 cursor-pointer"
                        >
                          <option value="">All</option>
                          {[...new Set((allProfiles as ItrProfile[]).map(p => p.entity_type).filter(Boolean))].map((et: any) => (
                            <option key={et} value={et}>{et}</option>
                          ))}
                        </select>
                      </TableHead>
                      <TableHead className="py-1 px-2">
                        <select
                          value={filterWorkGroup}
                          onChange={e => setFilterWorkGroup(e.target.value)}
                          className="h-6 text-[11px] w-full rounded border border-border bg-background px-1 cursor-pointer"
                        >
                          <option value="">All</option>
                          {[...new Set((allProfiles as ItrProfile[]).map(p => p.group_name || p.work_group_name).filter(Boolean))].map((wg: any) => (
                            <option key={wg} value={wg}>{wg}</option>
                          ))}
                        </select>
                      </TableHead>
                      <TableHead className="py-1 px-2">
                        <select
                          value={filterStatus}
                          onChange={e => setFilterStatus(e.target.value)}
                          className="h-6 text-[11px] w-full rounded border border-border bg-background px-1 cursor-pointer"
                        >
                          <option value="">All</option>
                          {FILING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </TableHead>
                      <TableHead className="py-1 px-2">
                        <select
                          value={filterPreparedBy}
                          onChange={e => setFilterPreparedBy(e.target.value)}
                          className="h-6 text-[11px] w-full rounded border border-border bg-background px-1 cursor-pointer"
                        >
                          <option value="">All</option>
                          {(staffUsers as StaffUser[]).map(u => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                        </select>
                      </TableHead>
                      <TableHead className="py-1 px-2">
                        <select
                          value={filterCheckedBy}
                          onChange={e => setFilterCheckedBy(e.target.value)}
                          className="h-6 text-[11px] w-full rounded border border-border bg-background px-1 cursor-pointer"
                        >
                          <option value="">All</option>
                          {(staffUsers as StaffUser[]).map(u => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                        </select>
                      </TableHead>
                      <TableHead className="py-1 px-2" />
                      <TableHead className="py-1 px-2">
                        <select
                          value={filterUploadBy}
                          onChange={e => setFilterUploadBy(e.target.value)}
                          className="h-6 text-[11px] w-full rounded border border-border bg-background px-1 cursor-pointer"
                        >
                          <option value="">All</option>
                          {(staffUsers as StaffUser[]).map(u => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                        </select>
                      </TableHead>
                      <TableHead className="py-1 px-2" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subTabProfiles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                          No clients in this category.{filterConstitution || filterWorkGroup || filterStatus || filterPreparedBy || filterCheckedBy || filterUploadBy ? " (filters active)" : ""}
                        </TableCell>
                      </TableRow>
                    ) : pagedProfiles.map((p: ItrProfile) => (
                      <InlineEditableRow
                        key={p.id}
                        profile={p}
                        staffUsers={staffUsers}
                        workGroups={workGroups}
                        onUpdate={onInlineUpdate}
                        onDelete={handleDeleteRow}
                        navigate={navigate}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* ── Pagination controls (50 rows/page) ── */}
            {subTabProfiles.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-xs text-muted-foreground">
                <div>
                  Showing <span className="font-medium text-foreground">{pageStart}</span>
                  &ndash;<span className="font-medium text-foreground">{pageEnd}</span>
                  {" "}of <span className="font-medium text-foreground">{subTabProfiles.length}</span> clients
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    aria-label="First page"
                  >
                    <ChevronsLeft size={14} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} />
                  </Button>
                  <span className="px-2 text-xs">
                    Page <span className="font-medium text-foreground">{currentPage}</span> of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}
                    disabled={currentPage >= pageCount}
                    aria-label="Next page"
                  >
                    <ChevronRight size={14} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setCurrentPage(pageCount)}
                    disabled={currentPage >= pageCount}
                    aria-label="Last page"
                  >
                    <ChevronsRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ─── Per-row edit log (mirrors the Stage-2 Query Sheet "Log" pattern) ────────
//
// Reads itr_profile_history rows keyed by client_id + assessment_year (firm
// scoping happens via RLS). The journal is field-by-field — every status /
// prepared-by / filed-date change yields one row — so the auditor can see
// who flipped Status to "Filed" and when, and who cleared a Prepared-By, etc.
// Same UX as the Query Sheet edit log: button → dialog → table.
const FIELD_LABELS: Record<string, string> = {
  filing_status:        "Status",
  prepared_by:          "Prepared By",
  checked_by:           "Checked By",
  date_filed:           "Filed Date",
  upload_by:            "Upload By",
  acknowledgment_no:    "Ack No",
  remarks:              "Remarks",
  itr_form:             "ITR Form",
  itr_work_group_id:    "Work Group",
  assigned_to:          "Assigned To",
  date_data_received:   "Data Received",
};

function fmtHistDateShort(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    let hh = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, "0");
    const ampm = hh >= 12 ? "PM" : "AM";
    hh = hh % 12 || 12;
    return `${dd}/${mm}/${yyyy} ${String(hh).padStart(2, "0")}:${mins} ${ampm}`;
  } catch { return iso; }
}

function describeItrChange(oldV: string | null, newV: string | null): React.ReactNode {
  const o = (oldV ?? "").trim();
  const n = (newV ?? "").trim();
  if (!o && n)  return <>set to <span className="font-medium text-foreground">{n}</span></>;
  if (o && !n)  return <>cleared (was <span className="font-medium text-foreground">{o}</span>)</>;
  if (!o && !n) return <span className="text-muted-foreground italic">no value change</span>;
  return (
    <>
      from <span className="font-medium text-foreground">{o}</span>
      {" "}to <span className="font-medium text-foreground">{n}</span>
    </>
  );
}

function ItrRowHistoryButton({ clientId, assessmentYear, rowLabel }: {
  clientId: string; assessmentYear: string; rowLabel: string;
}) {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [staffMap, setStaffMap] = useState<Map<string, string>>(new Map());
  const [rows,    setRows]    = useState<Array<{
    id: string; field_name: string;
    old_value: string | null; new_value: string | null;
    changed_by: string | null; changed_by_name: string | null;
    changed_at: string;
  }>>([]);

  // Build a uuid → staff-name map once (lets us pretty-print prepared_by /
  // checked_by / upload_by values that are stored as user ids).
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from("users").select("id, name");
      const m = new Map<string, string>();
      for (const u of (data || [])) {
        if ((u as any).id) m.set((u as any).id, (u as any).name || (u as any).id);
      }
      setStaffMap(m);
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !clientId || !assessmentYear) return;
    setLoading(true);
    (async () => {
      try {
        const { data: hist } = await (supabase as any)
          .from("itr_profile_history")
          .select("id, field_name, old_value, new_value, changed_by, changed_by_name, changed_at")
          .eq("client_id", clientId)
          .eq("assessment_year", assessmentYear)
          .order("changed_at", { ascending: false })
          .limit(200);
        setRows(hist || []);
      } finally { setLoading(false); }
    })();
  }, [open, clientId, assessmentYear]);

  const prettyValue = (field: string, raw: string | null): string | null => {
    if (!raw) return raw;
    if (field === "prepared_by" || field === "checked_by" || field === "upload_by" || field === "assigned_to") {
      return staffMap.get(raw) || raw;
    }
    return raw;
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"
        title="View edit log for this client"
        onClick={() => setOpen(true)}
      >
        <History size={14} />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 py-3 border-b bg-muted/40 space-y-0.5">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <History size={15} className="text-indigo-600" />
              Edit Log
              {!loading && rows.length > 0 && (
                <span className="text-[10px] font-normal text-muted-foreground ml-1">
                  · {rows.length} {rows.length === 1 ? "change" : "changes"}
                </span>
              )}
            </DialogTitle>
            <p className="text-[11px] text-muted-foreground truncate" title={rowLabel}>
              {rowLabel}
            </p>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-12">
                <Loader2 size={13} className="animate-spin" /> Loading edit log…
              </div>
            ) : rows.length === 0 ? (
              <div className="text-xs text-muted-foreground py-12 text-center">
                No edits recorded yet for this client.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                  <tr>
                    <th className="text-left  px-3 py-2 w-12">#</th>
                    <th className="text-left  px-3 py-2 w-32">User</th>
                    <th className="text-left  px-3 py-2 w-28">Field</th>
                    <th className="text-left  px-3 py-2">Change</th>
                    <th className="text-right px-3 py-2 w-40">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((h, i) => (
                    <tr key={h.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground font-mono text-[10px]">
                        {rows.length - i}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        {h.changed_by_name || (h.changed_by && staffMap.get(h.changed_by)) || "Unknown"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {FIELD_LABELS[h.field_name] || h.field_name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-foreground/90">
                        {describeItrChange(prettyValue(h.field_name, h.old_value), prettyValue(h.field_name, h.new_value))}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap tabular-nums">
                        {fmtHistDateShort(h.changed_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2 border-t bg-muted/30 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Most recent change shown first.</span>
            <DialogFooter className="m-0">
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Inline Editable Row ───
function InlineEditableRow({ profile, staffUsers, workGroups, onUpdate, onDelete, navigate }: {
  profile: ItrProfile; staffUsers: StaffUser[]; workGroups: any[];
  onUpdate: (p: ItrProfile, field: string, value: any) => void;
  onDelete: (p: ItrProfile) => void;
  navigate: (path: string) => void;
}) {
  const p = profile;
  const [infoOpen, setInfoOpen] = useState(false);
  const { toast } = useToast();

  return (
    <>
      <TableRow className="hover:bg-muted/30">
        {/* Client Name with hover card (PAN, Email, Mobile, Responsible Person) */}
        <TableCell className="sticky left-0 z-10 bg-background font-medium">
          {/* 2026-06-25 (V J Desai request) — bumped max-w from 170 to 230
              so most client names fit in full; added a native title attr
              so any names that still exceed the width surface the full
              string on hover. */}
          <HoverCard openDelay={300}>
            <HoverCardTrigger asChild>
              <button
                className="text-left text-primary hover:underline truncate max-w-[230px] block"
                onClick={() => navigate(`/clients/${p.client_id}`)}
                title={p.client_name || undefined}
              >
                {p.client_name}
              </button>
            </HoverCardTrigger>
            {/* 2026-06-25 (V J Desai) — side="right" overlapped Constitution /
                Work Group / Status columns on the same row. Moved to bottom
                so the card drops below the client-name cell and leaves the
                row fully visible. */}
            <HoverCardContent side="bottom" align="start" sideOffset={4} className="w-80 p-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 shrink-0">PAN</span>
                  <span className="font-mono">{p.client_pan || "—"}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 shrink-0">Email</span>
                  <span className="truncate">{p.client_email || "—"}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 shrink-0">Mobile</span>
                  <span>{p.client_mobile || "—"}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 shrink-0">Responsible</span>
                  <span>{p.client_responsible_name || "—"}</span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        </TableCell>

        {/* Constitution */}
        <TableCell className="text-xs">{p.entity_type || "—"}</TableCell>

        {/* Work Group - show itr_work_group (group_name) first, fall back to client work group */}
        <TableCell className="text-xs text-muted-foreground">{p.group_name || p.work_group_name || "—"}</TableCell>

        {/* Status */}
        <TableCell>
          <Select
            value={p.filing_status || "Data Pending"}
            onValueChange={v => onUpdate(p, "filing_status", v)}
          >
            <SelectTrigger className={cn("h-7 text-xs border-none shadow-none px-1 rounded-full", STATUS_COLORS[p.filing_status || "Data Pending"] || "")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILING_STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  <span className={cn("inline-block w-2 h-2 rounded-full mr-1.5", (STATUS_COLORS[s] || "").split(" ")[0])} />
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>

        {/* Prepared By — auto-stamped when Status moves to "Ready for Review" */}
        <TableCell className="text-xs text-muted-foreground px-2">
          {staffName(staffUsers, (p as any).prepared_by)}
        </TableCell>

        {/* Checked By — auto-stamped when Status moves to "Verified" */}
        <TableCell className="text-xs text-muted-foreground px-2">
          {staffName(staffUsers, (p as any).checked_by)}
        </TableCell>

        {/* Filed Date — auto-stamped (today) when Status moves to "Filed" */}
        <TableCell className="text-xs text-muted-foreground px-2">
          {formatFiledDate(p.date_filed)}
        </TableCell>

        {/* Upload By — auto-stamped when Status moves to "Sent to CPC" */}
        <TableCell className="text-xs text-muted-foreground px-2">
          {staffName(staffUsers, (p as any).upload_by)}
        </TableCell>

        <TableCell>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setInfoOpen(true)}>
              <Info size={14} />
            </Button>
            <ItrRowHistoryButton
              clientId={p.client_id || ""}
              assessmentYear={p.assessment_year || ""}
              rowLabel={p.client_name || ""}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(p)}>
              <X size={14} />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {/* Info Side Panel */}
      <InfoPanel
        open={infoOpen}
        onOpenChange={setInfoOpen}
        profile={p}
        onUpdate={onUpdate}
        staffUsers={staffUsers}
      />
    </>
  );
}

// ─── Info Side Panel ───
function InfoPanel({ open, onOpenChange, profile, onUpdate, staffUsers }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profile: ItrProfile;
  onUpdate: (p: ItrProfile, field: string, value: any) => void;
  staffUsers: StaffUser[];
}) {
  const p = profile;
  const [ackNo, setAckNo] = useState(p.acknowledgment_no || "");
  const [remarks, setRemarks] = useState((p as any).remarks || "");
  const { toast } = useToast();

  useEffect(() => {
    setAckNo(p.acknowledgment_no || "");
    setRemarks((p as any).remarks || "");
  }, [p.id]);

  const ackRequired =
    p.filing_status === "Filed" ||
    p.filing_status === "Verified" ||
    p.filing_status === "Sent to CPC";

  // 2026-06-25 (V J Desai request): once the return is Filed, the Ack No is
  // the immutable ITD acknowledgement — allowing edits after that would
  // desync CAFlow from the ITD portal. Lock the field. To correct a
  // wrongly-typed ARN the auditor must first revert status to Data Pending
  // (which auto-clears acknowledgment_no anyway), then re-file.
  const ackLocked = p.filing_status === "Filed";

  // Auto-save on blur — no Save button. Validation still runs on Ack No so the
  // auditor can't silently leave it blank when the status requires it.
  const commitAck = () => {
    if (ackLocked) return;
    if (ackNo === (p.acknowledgment_no || "")) return;
    if (ackRequired && !ackNo.trim()) {
      toast({ title: "Ack No is mandatory when status is Filed/Verified/Sent to CPC", variant: "destructive" });
      return;
    }
    onUpdate(p, "acknowledgment_no", ackNo || null);
  };
  const commitRemarks = () => {
    if (remarks === ((p as any).remarks || "")) return;
    onUpdate(p, "remarks", remarks || null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{p.client_name} — Info</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div className="space-y-1.5">
            <Label>
              Ack No {ackRequired && <span className="text-destructive">*</span>}
              {ackLocked && (
                <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                  (locked — status is Filed)
                </span>
              )}
            </Label>
            <Input
              value={ackNo}
              onChange={e => setAckNo(e.target.value)}
              onBlur={commitAck}
              placeholder="Enter acknowledgement number"
              readOnly={ackLocked}
              className={ackLocked ? "bg-muted/60 cursor-not-allowed" : undefined}
              title={ackLocked
                ? "Ack No is locked once the return is Filed. Revert status to Data Pending to change it."
                : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              onBlur={commitRemarks}
              rows={3}
              placeholder="Any notes..."
            />
          </div>
          <p className="text-[11px] text-muted-foreground">Changes save automatically.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Inline Text Input ───
function InlineTextInput({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setVal(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  if (!editing) {
    return (
      <button
        className="text-xs text-left w-full truncate text-muted-foreground hover:text-foreground"
        onClick={() => setEditing(true)}
      >
        {value || placeholder}
      </button>
    );
  }

  return (
    <Input
      ref={ref}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => { setEditing(false); if (val !== value) onSave(val); }}
      onKeyDown={e => { if (e.key === "Enter") { setEditing(false); if (val !== value) onSave(val); } if (e.key === "Escape") { setEditing(false); setVal(value); } }}
      className="h-7 text-xs border-none shadow-none bg-transparent px-1"
    />
  );
}

// ─── Inline Date Picker ───
function InlineDatePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="text-xs text-left w-full truncate text-muted-foreground hover:text-foreground flex items-center gap-1">
          <CalendarDays size={12} />
          {value ? formatDateDDMMYYYY(value) : "—"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={d => {
            onChange(d ? format(d, "yyyy-MM-dd") : null);
            setOpen(false);
          }}
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

// ═══════════════════════════════════════════
// COMPLIANCE TAB (merged Notice Tracker)
// ═══════════════════════════════════════════
function ComplianceTab({ navigate }: { navigate: (path: string) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [filters, setFilters] = useState({ type: "all", status: "all", client: "all", search: "" });
  const [statusDialogNotice, setStatusDialogNotice] = useState<any>(null);
  const [changeNote, setChangeNote] = useState("");

  const [form, setForm] = useState({
    client_id: "", notice_type: "143_1",
    notice_ref_no: "", assessment_year: "", section: "", department: "",
    notice_date: "", date_received: "", amount_demanded: "", amount_disputed: "",
    reply_due_date: "", assigned_to: "", priority: "Medium", remarks: "",
  });

  const { data: notices = [], isLoading } = useQuery({
    queryKey: ["compliance_notices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demand_notices")
        .select("*, clients(name, pan), users!demand_notices_assigned_to_fkey(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["compliance_clients"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, name").eq("is_draft", false).is("deleted_at", null).order("name");
      return data || [];
    },
  });

  const { data: staff = [] } = useQuery({
    queryKey: ["compliance_staff"],
    queryFn: async () => {
      const { data } = await supabase.from("users").select("id, name").neq("role", "client").order("name");
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const { error } = await supabase.from("demand_notices").insert({
        client_id: values.client_id,
        firm_id: user?.firm_id,
        notice_type: values.notice_type,
        notice_ref_no: values.notice_ref_no || null,
        assessment_year: values.assessment_year || null,
        section: values.section || null,
        department: values.department || null,
        notice_date: values.notice_date || null,
        date_received: values.date_received || null,
        amount_demanded: values.amount_demanded ? parseFloat(values.amount_demanded) : null,
        amount_disputed: values.amount_disputed ? parseFloat(values.amount_disputed) : null,
        reply_due_date: values.reply_due_date || null,
        assigned_to: values.assigned_to || null,
        priority: values.priority,
        remarks: values.remarks || null,
        created_by: user?.id,
        status: "Received",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance_notices"] });
      setAddOpen(false);
      setForm({ client_id: "", notice_type: "143_1", notice_ref_no: "", assessment_year: "", section: "", department: "", notice_date: "", date_received: "", amount_demanded: "", amount_disputed: "", reply_due_date: "", assigned_to: "", priority: "Medium", remarks: "" });
      toast({ title: "Notice added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ noticeId, currentStatus, nextStatus }: { noticeId: string; currentStatus: string; nextStatus: string }) => {
      const { error } = await supabase.from("demand_notices").update({ status: nextStatus }).eq("id", noticeId);
      if (error) throw error;
      if (changeNote.trim()) {
        await supabase.from("demand_notice_status_history").insert({
          notice_id: noticeId, from_status: currentStatus, to_status: nextStatus,
          changed_by: user?.id, change_note: changeNote.trim(),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance_notices"] });
      setStatusDialogNotice(null);
      setChangeNote("");
      toast({ title: "Status updated" });
    },
  });

  const filtered = useMemo(() => {
    return notices.filter((n: any) => {
      if (filters.type !== "all" && n.notice_type !== filters.type) return false;
      if (filters.status !== "all" && n.status !== filters.status) return false;
      if (filters.client !== "all" && n.client_id !== filters.client) return false;
      if (filters.search && !(n.clients?.name || "").toLowerCase().includes(filters.search.toLowerCase())) return false;
      return true;
    });
  }, [notices, filters]);

  const demandStats = useMemo(() => {
    const total = notices.reduce((s: number, n: any) => s + (Number(n.amount_demanded) || 0), 0);
    const disputed = notices.reduce((s: number, n: any) => s + (Number(n.amount_disputed) || 0), 0);
    const outstanding = total - disputed;
    return { total, disputed, outstanding };
  }, [notices]);

  const openCount = notices.filter((n: any) => n.status !== "Closed/Appeal Filed" && n.status !== "Closed/Dropped").length;
  const overdueCount = notices.filter((n: any) => {
    const d = n.extended_due_date || n.reply_due_date;
    return d && isBefore(new Date(d), new Date()) && n.status !== "Closed/Appeal Filed" && n.status !== "Closed/Dropped";
  }).length;

  const handleExport = () => {
    import("xlsx").then(XLSX => {
      const rows = filtered.map((n: any) => ({
        "Client": n.clients?.name || "-",
        "PAN": n.clients?.pan || "-",
        "Notice Type": n.notice_type,
        "Notice Date": n.notice_date || "",
        "Reply Deadline": n.reply_due_date || "",
        "Status": n.status,
        "Demand Amount": n.amount_demanded ?? "",
        "Disputed": n.amount_disputed ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Compliance");
      XLSX.writeFile(wb, `Compliance_Notices_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    });
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Open Notices</p><p className="text-2xl font-bold text-foreground">{openCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Overdue</p><p className="text-2xl font-bold text-destructive">{overdueCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Demand</p><p className="text-2xl font-bold text-foreground">₹{demandStats.total.toLocaleString("en-IN")}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Outstanding</p><p className="text-2xl font-bold text-amber-600">₹{demandStats.outstanding.toLocaleString("en-IN")}</p></CardContent></Card>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <Input placeholder="Search client..." value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} className="h-9" />
        </div>
        <Select value={filters.type} onValueChange={v => setFilters(p => ({ ...p, type: v }))}>
          <SelectTrigger className="w-[140px] h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {NOTICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={v => setFilters(p => ({ ...p, status: v }))}>
          <SelectTrigger className="w-[160px] h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {NOTICE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download size={14} className="mr-1.5" /> Export
        </Button>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} className="mr-1.5" /> Add Notice
          </Button>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader><SheetTitle>Add New Notice</SheetTitle></SheetHeader>
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Client *</Label>
                  <Select value={form.client_id} onValueChange={v => setForm(p => ({ ...p, client_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Notice Type</Label>
                  <Select value={form.notice_type} onValueChange={v => setForm(p => ({ ...p, notice_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {NOTICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Notice Ref No</Label><Input value={form.notice_ref_no} onChange={e => setForm(p => ({ ...p, notice_ref_no: e.target.value }))} /></div>
                <div><Label>Assessment Year</Label><Input placeholder="2024-25" value={form.assessment_year} onChange={e => setForm(p => ({ ...p, assessment_year: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Section</Label><Input value={form.section} onChange={e => setForm(p => ({ ...p, section: e.target.value }))} /></div>
                <div><Label>Department</Label><Input value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Notice Date</Label><Input type="date" value={form.notice_date} onChange={e => setForm(p => ({ ...p, notice_date: e.target.value }))} /></div>
                <div><Label>Date Received</Label><Input type="date" value={form.date_received} onChange={e => setForm(p => ({ ...p, date_received: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Demand Amount</Label><Input type="number" value={form.amount_demanded} onChange={e => setForm(p => ({ ...p, amount_demanded: e.target.value }))} /></div>
                <div><Label>Disputed Amount</Label><Input type="number" value={form.amount_disputed} onChange={e => setForm(p => ({ ...p, amount_disputed: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Reply Due Date</Label><Input type="date" value={form.reply_due_date} onChange={e => setForm(p => ({ ...p, reply_due_date: e.target.value }))} /></div>
                <div>
                  <Label>Assigned To</Label>
                  <Select value={form.assigned_to} onValueChange={v => setForm(p => ({ ...p, assigned_to: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{staff.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Remarks</Label><Textarea value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} rows={3} /></div>
              <Button className="w-full" disabled={!form.client_id || createMutation.isPending} onClick={() => createMutation.mutate(form)}>
                {createMutation.isPending ? "Saving..." : "Save Notice"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>PAN</TableHead>
              <TableHead>Notice Type</TableHead>
              <TableHead>Notice Date</TableHead>
              <TableHead>Reply Deadline</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Days Remaining</TableHead>
              <TableHead className="text-right">Demand</TableHead>
              <TableHead className="text-right">Disputed</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No notices found</TableCell></TableRow>
            ) : filtered.map((n: any) => {
              const dueDate = n.extended_due_date || n.reply_due_date;
              const daysRemaining = dueDate ? differenceInDays(new Date(dueDate), new Date()) : null;
              const daysColor = daysRemaining === null ? "" : daysRemaining < 0 ? "text-destructive font-bold" : daysRemaining <= 3 ? "text-destructive" : daysRemaining <= 7 ? "text-amber-600" : "text-emerald-600";

              const mappedIdx = NOTICE_STATUSES.indexOf(n.status as any);
              const nextStatus = mappedIdx >= 0 && mappedIdx < NOTICE_STATUSES.length - 1 ? NOTICE_STATUSES[mappedIdx + 1] : null;

              return (
                <TableRow key={n.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{n.clients?.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{n.clients?.pan || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {NOTICE_TYPES.find(t => t.value === n.notice_type)?.label || n.notice_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{n.notice_date ? formatDateDDMMYYYY(n.notice_date) : "—"}</TableCell>
                  <TableCell className="text-xs">{dueDate ? formatDateDDMMYYYY(dueDate) : "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{n.status}</Badge></TableCell>
                  <TableCell className={cn("text-xs font-medium", daysColor)}>
                    {daysRemaining !== null ? (daysRemaining < 0 ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d`) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {n.amount_demanded != null ? `₹${Number(n.amount_demanded).toLocaleString("en-IN")}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {n.amount_disputed != null ? `₹${Number(n.amount_disputed).toLocaleString("en-IN")}` : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/notices/${n.id}`)}>
                        <Eye size={14} />
                      </Button>
                      {nextStatus && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={`Move to: ${nextStatus}`}
                          onClick={() => setStatusDialogNotice(n)}
                        >
                          <ChevronRight size={14} />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Demand Reconciliation Panel */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Demand Reconciliation</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Total Demand</p>
              <p className="text-lg font-bold font-mono">₹{demandStats.total.toLocaleString("en-IN")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Disputed Amount</p>
              <p className="text-lg font-bold font-mono text-amber-600">₹{demandStats.disputed.toLocaleString("en-IN")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outstanding Balance</p>
              <p className="text-lg font-bold font-mono text-destructive">₹{demandStats.outstanding.toLocaleString("en-IN")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Change Dialog */}
      {statusDialogNotice && (() => {
        const mappedIdx = NOTICE_STATUSES.indexOf(statusDialogNotice.status as any);
        const nextStatus = mappedIdx >= 0 && mappedIdx < NOTICE_STATUSES.length - 1 ? NOTICE_STATUSES[mappedIdx + 1] : null;
        if (!nextStatus) return null;
        return (
          <Dialog open={!!statusDialogNotice} onOpenChange={open => { if (!open) setStatusDialogNotice(null); }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Move to "{nextStatus}"</DialogTitle></DialogHeader>
              <div>
                <Label>Note (optional)</Label>
                <Textarea value={changeNote} onChange={e => setChangeNote(e.target.value)} rows={3} placeholder="Reason..." />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStatusDialogNotice(null)}>Cancel</Button>
                <Button
                  onClick={() => statusMutation.mutate({ noticeId: statusDialogNotice.id, currentStatus: statusDialogNotice.status, nextStatus })}
                  disabled={statusMutation.isPending}
                >
                  {statusMutation.isPending ? "Updating..." : "Confirm"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}
