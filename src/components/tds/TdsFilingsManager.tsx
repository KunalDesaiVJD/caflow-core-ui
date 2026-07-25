import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isFilingTdsCompliant } from "@/lib/tdsQuarter";
import { isPanException } from "@/lib/tdsPanVerification";
import { extractAckNumberFromFile } from "@/lib/tds/ackPdf";
import { sanitizeStorageName } from "@/lib/storagePath";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  HoverCard, HoverCardContent, HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Download, ArrowRight, RefreshCw, Clock, AlertTriangle, ExternalLink, Info, Settings, Trash2, X,
  Maximize2, Minimize2, Search, ChevronDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ClientOption {
  id: string; name: string | null; pan: string | null; tan_number?: string | null; deleted_at?: string | null;
  tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string;
  tds_forms_applicable?: string[];
  // Identity fields shown in the Client Name hover card (TAN/PAN/Contact/Mobile) —
  // sourced from the same `clients` prop already loaded by the host, no extra fetch.
  contact_person?: string | null; mobile?: string | null; email?: string | null;
}
interface UserOption { id: string; name: string | null; }

interface TdsFiling {
  id: string; client_id: string; firm_id: string; financial_year: string;
  quarter: string; tds_forms: string[] | null; work_status: string;
  date_of_filing: string | null; acknowledgment_number: string | null;
  prn_no: string | null; tan: string | null; assigned_staff: string | null;
  // Prepared By / Filed By — existing tds_filings columns (FK → users.id,
  // ON DELETE SET NULL). Read-only audit trail, auto-set by handleStatusChange
  // (preparer_id when status moves Under Process -> Reviewed, checker_id —
  // displayed as "Filed By" — when status moves to Filed); never manually
  // selected. checker_id keeps its original DB column name for continuity
  // (no schema change) even though its UI meaning is now "who filed", not
  // "who checked".
  preparer_id: string | null; checker_id: string | null;
  last_updated_by: string | null; last_updated_at: string | null;
  remarks: string | null; created_at: string | null;
  ack_file_url?: string | null;
}

interface AuditLogEntry {
  id: string; filing_id: string | null; action_type: string;
  old_value: string | null; new_value: string | null;
  changed_by_name: string | null; changed_at: string | null;
  remark: string | null;
}

// ACK file record stored in tds_ack_files table
interface TdsAckFile {
  id: string;
  filing_id: string;
  client_id: string;
  firm_id: string | null;
  file_name: string;
  file_url: string;
  created_at: string | null;
}

/** Per-stage state for the "Validate & Finalise" summary column — mirrors the
 *  same three-way split each stage's own tab already uses (done/warn/none),
 *  computed here in BULK across every loaded filing rather than by embedding
 *  each Stage 1-3 component, so this column costs a handful of grouped queries
 *  instead of N component mounts. */
type VfState = "done" | "warn" | "none";
interface VfStatus {
  s1: VfState; s1Detail: string;
  s2: VfState; s2Detail: string;
  s3: VfState; s3Detail: string;
  s4: VfState; s4Detail: string;
  signed: boolean; signedDetail: string;
  ready: boolean;
}

// Aggregate status groups driven by Dashboard KPI card clicks — these don't
// map to a single FILING_STATUSES value (e.g. "Returns Due" means "anything
// not yet terminal"), so they're applied as a dismissible filter layered on
// top of the row's exact work_status. "reviewed" is the one exception that
// DOES map 1:1 to a single FILING_STATUSES value ("Reviewed"), kept as its
// own group (rather than just relying on the exact-status Select) so a
// Dashboard KPI card can drive it the same way as the other aggregate cards.
export type KpiStatusGroup = "all" | "returns-due" | "reviewed" | "filed" | "processed" | "nil";

const KPI_STATUS_GROUP_LABELS: Record<Exclude<KpiStatusGroup, "all">, string> = {
  "returns-due": "Returns Due",
  reviewed: "Under Review",
  filed: "Filed / Submitted",
  processed: "Processed / Accepted",
  nil: "NIL Returns",
};

export interface FilingsPreset {
  statusGroup: KpiStatusGroup;
  // Bumped on every click so re-selecting the same card re-applies the
  // preset even if the user cleared the status-group filter manually in
  // between.
  nonce: number;
}

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
  onNavigateDataEntry?: (filingId?: string) => void;
  // Navigate to a SPECIFIC filing's Stage 1 (Validate & Finalise) in the TDS
  // Workspace — fired by the "Validate & Finalise" summary column's Ready
  // link. Unlike onNavigateDataEntry (which only switches tabs, relying on
  // whatever client/FY/quarter was already selected), this carries the full
  // selection so the correct filing is pre-selected on arrival.
  onNavigateStage1?: (sel: { clientId: string; financialYear: string; quarter: string; formType: string }) => void;
  // When embedded elsewhere (e.g. the Dashboard's Client Filing Summary card),
  // the host already provides its own title — suppress this component's own.
  hideHeader?: boolean;
  // FY/Quarter/Client/Form filters — owned entirely by the host (the
  // Dashboard's top-level filter bar is the single source of truth) and
  // passed down here as plain reactive props. This component no longer
  // renders its own copies of these controls, so there is exactly one place
  // to change a filter and the summary table re-renders automatically.
  fyFilter: string;
  quarterFilter: string;
  clientFilter: string;
  formFilter: string;
  // External status-group preset (e.g. from a Dashboard KPI card click) that
  // overrides the current aggregate status-group selection.
  preset?: FilingsPreset | null;
  // Fired after any write that changes work_status (status change, inline
  // edit, bulk action, copy) — lets a host embedding this component (e.g.
  // the Dashboard's KPI cards) refetch its own separately-fetched data
  // instead of going stale until a full page reload.
  onFilingsChanged?: () => void;
  // Maximize/minimize toggle — the host (e.g. Dashboard) owns the expanded
  // state and the CSS that actually grows the wrapping container; this
  // component only renders the toggle button and reflects the icon/label.
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  // Bumped by the host on any external TDS change (e.g. Realtime event when a
  // client's TDS Compliance is edited) to force a live re-fetch of filings.
  refreshKey?: number;
}

const FILING_STATUSES = [
  "Not Started",
  "NIL",
  "Data Received",
  "Under Process",
  "Queries Sent to Client",
  "Reviewed",
  "Filed",
  "Processed",
] as const;

const FILING_STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "NIL": "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  "Data Received": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Under Process": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  "Queries Sent to Client": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Reviewed": "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "Filed": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Processed": "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
};

// Display-only rename: the STORED/compared work_status value stays "Reviewed"
// (zero DB migration, zero risk to the many === "Reviewed" comparisons in
// handleStatusChange/handleBulkAction/filtering below) — only what the user
// SEES changes, to "Under Review".
const FILING_STATUS_LABELS: Record<string, string> = { "Reviewed": "Under Review" };
const statusLabel = (s: string): string => FILING_STATUS_LABELS[s] ?? s;

export const getDueDate = (fy: string, quarter: string): Date => {
  const fyStart = parseInt(fy.split("-")[0]);
  const dates: Record<string, Date> = {
    Q1: new Date(fyStart, 6, 31), Q2: new Date(fyStart, 9, 31),
    Q3: new Date(fyStart + 1, 0, 31), Q4: new Date(fyStart + 1, 4, 31),
  };
  return dates[quarter] || new Date();
};

export const getDueDateColor = (fy: string, quarter: string, status: string) => {
  if (["Filed", "Processed", "NIL"].includes(status)) return "text-emerald-600";
  const due = getDueDate(fy, quarter);
  const days = differenceInDays(due, new Date());
  if (days < 0) return "text-destructive font-bold";
  if (days < 7) return "text-amber-600 font-semibold";
  return "text-emerald-600";
};

// Client names in this CA/tax domain commonly carry a trailing
// "(PROP:Trade Name)"-style parenthetical after an individual's name.
// Splitting at the first top-level "(" — rather than leaving it to the
// browser's own reflow — guarantees the parenthetical always starts on its
// own line instead of breaking wherever the text happens to wrap.
const splitClientName = (name: string): { main: string; parenthetical: string | null } => {
  const match = name.match(/^(.+?)\s*(\(.+)$/);
  if (!match) return { main: name, parenthetical: null };
  return { main: match[1], parenthetical: match[2] };
};

// Sentinel for the Prepared By filter's "Unassigned" bucket — preparer_id is
// a real column that can be null, and "" can never collide with a uuid.
const UNASSIGNED_PREPARER = "";

/** Toolbar multi-select filter — search box, Select All, checkbox list,
 *  Clear (N) footer. Same UX as AuditStatusFilters.tsx's StatusMultiSelectFilter,
 *  generalised over {value,label} options so it works for both Status and
 *  Prepared By here without duplicating the popover/list chrome twice. */
function MultiSelectFilter({ label, options, selection, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  selection: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  const set = new Set(selection);
  const allVisibleChecked = visible.length > 0 && visible.every(o => set.has(o.value));

  const toggle = (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  };
  const toggleAll = () => {
    const next = new Set(set);
    if (allVisibleChecked) visible.forEach(o => next.delete(o.value));
    else visible.forEach(o => next.add(o.value));
    onChange([...next]);
  };

  const triggerLabel =
    selection.length === 0 ? label
    : selection.length === 1 ? (options.find(o => o.value === selection[0])?.label ?? label)
    : `${label} (${selection.length})`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs w-44 justify-between font-normal gap-1">
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown size={13} className="ml-1 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="relative">
          <Input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="h-7 text-xs pr-6"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={11} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="mt-2 flex items-center gap-2 px-1.5 py-1 rounded text-[11px] font-medium hover:bg-muted w-full text-left"
        >
          <span className={cn(
            "inline-flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0",
            allVisibleChecked ? "bg-indigo-600 border-indigo-600 text-white" : "border-input",
          )}>
            {allVisibleChecked && <span className="text-[9px] leading-none">✓</span>}
          </span>
          Select All {q && `(${visible.length})`}
        </button>
        <div className="max-h-56 overflow-y-auto pr-0.5 mt-1">
          {visible.map(o => {
            const checked = set.has(o.value);
            return (
              <button
                key={o.value || "__unassigned"}
                type="button"
                onClick={() => toggle(o.value)}
                className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-[11px] hover:bg-muted text-left"
              >
                <span className={cn(
                  "inline-flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0",
                  checked ? "bg-indigo-600 border-indigo-600 text-white" : "border-input",
                )}>
                  {checked && <span className="text-[9px] leading-none">✓</span>}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
          {visible.length === 0 && (
            <div className="px-1.5 py-2 text-[11px] text-muted-foreground italic">No match for "{query}".</div>
          )}
        </div>
        {selection.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1.5 pt-1.5 flex items-center justify-center gap-1 w-full px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted border-t border-border"
          >
            <X size={11} /> Clear ({selection.length})
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TdsFilingsManager({ clients, users, isSuperadmin, resolveFirmId, onNavigateDataEntry, onNavigateStage1, hideHeader, fyFilter, quarterFilter, clientFilter, formFilter, preset, onFilingsChanged, isMaximized, onToggleMaximize, refreshKey }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [deletedClients, setDeletedClients] = useState<Map<string, { name: string | null; deleted_at: string }>>(new Map()); // client_id -> { name, deleted_at }
  const [ackUploading, setAckUploading] = useState<string | null>(null);
  // filing_id -> its ACK file <input>. Triggered via ref.click() from a plain
  // clickable element (matching TdsDataEntry.tsx's confirmed-working Genius
  // Excel import pattern) rather than a <label> wrapping the input directly —
  // labels associated with a file input have been unreliable in the field
  // for this specific upload (native file-picker selections never reached
  // the input's change event), while the ref+click() trigger is proven
  // working elsewhere in this exact module.
  const ackFileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // Guards the loading skeleton to first-load-only — see fetchFilings below.
  const hasLoadedFilingsRef = useRef(false);
  // Map of filing_id → TdsAckFile (populated after each fetch)
  const [ackFiles, setAckFiles] = useState<Map<string, TdsAckFile>>(new Map());
  // Map of filing_id → VfStatus, for the "Validate & Finalise" summary column
  // (populated after each fetch, same lifecycle as ackFiles).
  const [vfStatuses, setVfStatuses] = useState<Map<string, VfStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusGroup, setStatusGroup] = useState<KpiStatusGroup>("all");
  // Excel/Tally-style type-to-search — no visible input box. A window-level
  // keydown listener (below) appends to this buffer whenever no other
  // interactive element has keyboard focus; the floating "Searching: …"
  // indicator renders whenever it's non-empty.
  const [searchBuffer, setSearchBuffer] = useState("");
  // Grid filter toolbar — Client name search, Status multi-select, Prepared
  // By multi-select. Independent of (and composes with) the KPI-driven
  // statusGroup above and the type-to-search buffer: all three narrow the
  // SAME searchFiltered list further, they don't replace each other.
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [statusMultiFilter, setStatusMultiFilter] = useState<string[]>([]);
  const [preparedByMultiFilter, setPreparedByMultiFilter] = useState<string[]>([]);

  // Apply an external status-group preset (Dashboard KPI card click) — keyed
  // on `nonce` so re-clicking the same card re-applies it even with no value
  // change. FY/Quarter/Client/Form come from props now, so there's nothing
  // else for a preset to override.
  useEffect(() => {
    if (!preset) return;
    setStatusGroup(preset.statusGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce]);

  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");

  // History drawer
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFiling, setHistoryFiling] = useState<TdsFiling | null>(null);
  const [historyLogs, setHistoryLogs] = useState<AuditLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Helper: get quarter period end date
  const getQuarterEndDate = (fy: string, quarter: string): Date => {
    const fyStart = parseInt(fy.split("-")[0]);
    const ends: Record<string, Date> = {
      Q1: new Date(fyStart, 5, 30),   // Jun 30
      Q2: new Date(fyStart, 8, 30),   // Sep 30
      Q3: new Date(fyStart, 11, 31),  // Dec 31
      Q4: new Date(fyStart + 1, 2, 31), // Mar 31
    };
    return ends[quarter] || new Date();
  };

  // NOTE: filing-row generation is now fully server-side. A trigger on
  // client_services (migration 20260710180000) regenerates tds_filings from
  // the client's TDS Compliance (tds_forms_applicable + Start/End Quarter)
  // on every config change, from any code path. The old client-side
  // syncMissingFilings was removed: it was lazy (only the on-screen FY),
  // raced the trigger (duplicate rows), and silently threw after a partial
  // unique index broke its ON CONFLICT upsert (Postgres 42P10). Screens now
  // simply READ the always-synced tds_filings table.

  const fetchFilings = useCallback(async () => {
    // Only show the skeleton on the very first load. Realtime (tds_filings/
    // client_services changes from ANY user), window focus, and a 45s poll
    // all re-run this same fetch to keep the table live — but the loading
    // skeleton row uses key={i} while real rows use key={f.id}, so flipping
    // `loading` back to true on every one of those background refreshes
    // unmounts and recreates EVERY row, including whatever <input type=file>
    // a user is mid-native-dialog with at that exact moment (opening a file
    // picker blurs the window; closing it refocuses it, which is one of the
    // three refresh triggers) — this silently destroyed the ACK PDF upload's
    // file input between the OS dialog closing and its change event firing.
    // Data still refreshes live on every trigger as before; only the
    // skeleton-driven remount is now first-load-only.
    const isBackgroundRefresh = hasLoadedFilingsRef.current;
    if (!isBackgroundRefresh) setLoading(true);
    const firmId = await resolveFirmId();

    // High limit so the filing list is never silently truncated (default cap 1000).
    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(20000);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (fyFilter !== "all") q = q.eq("financial_year", fyFilter);
    if (quarterFilter !== "all") q = q.eq("quarter", quarterFilter);
    if (clientFilter !== "all") q = q.eq("client_id", clientFilter);
    const { data } = await q;
    const allFilings = (data || []) as TdsFiling[];

    // Fetch deleted clients info (including name) for filings' client IDs
    const clientIds = [...new Set(allFilings.map(f => f.client_id))];
    const delMap = new Map<string, { name: string | null; deleted_at: string }>();
    if (clientIds.length > 0) {
      const { data: delClients } = await supabase.from("clients")
        .select("id, name, deleted_at")
        .in("id", clientIds)
        .not("deleted_at", "is", null);
      for (const dc of (delClients || [])) {
        if (dc.deleted_at) delMap.set(dc.id, { name: dc.name || null, deleted_at: dc.deleted_at });
      }
    }
    setDeletedClients(delMap);
    setFilings(allFilings);
    hasLoadedFilingsRef.current = true;
    if (!isBackgroundRefresh) setLoading(false);
    // Fetch ACK files + the Validate & Finalise status summary for all loaded filings
    const filingIds = allFilings.map(f => f.id);
    await Promise.all([fetchAckFiles(filingIds), fetchVfStatuses(filingIds)]);
  }, [isSuperadmin, resolveFirmId, fyFilter, quarterFilter, clientFilter]);

  // Re-fetch on mount, on filter change, and whenever the host bumps
  // refreshKey (e.g. a Realtime TDS-config change) so the summary stays live.
  useEffect(() => { fetchFilings(); }, [fetchFilings, refreshKey]);

  const filtered = useMemo(() => {
    return filings.filter(f => {
      const client = clients.find(c => c.id === f.client_id);

      // TDS Compliance is the single source of truth — applied
      // UNCONDITIONALLY, not only when a specific form filter is picked. A
      // stale row for a form the client is no longer configured for (or
      // outside their Start/End Quarter range) must never surface, including
      // under "All" form / "All" FY / "All" quarter.
      if (!isFilingTdsCompliant(f, client)) return false;

      if (formFilter !== "all" && !(f.tds_forms || []).includes(formFilter)) return false;

      // KPI-card-driven aggregate status group — these don't map to a single
      // FILING_STATUSES value, so they're checked independently of the exact
      // work_status.
      const isTerminal = ["Filed", "Submitted", "Processed", "Accepted", "NIL"].includes(f.work_status);
      if (statusGroup === "returns-due" && isTerminal) return false;
      if (statusGroup === "reviewed" && f.work_status !== "Reviewed") return false;
      if (statusGroup === "filed" && !["Filed", "Submitted"].includes(f.work_status)) return false;
      if (statusGroup === "processed" && !["Processed", "Accepted"].includes(f.work_status)) return false;
      if (statusGroup === "nil" && f.work_status !== "NIL") return false;

      // Deleted client filtering
      const deletedInfo = deletedClients.get(f.client_id);
      if (deletedInfo) {
        const periodEnd = getQuarterEndDate(f.financial_year, f.quarter);
        const deletionDate = new Date(deletedInfo.deleted_at);
        // If period is after deletion and filing wasn't already filed/processed → hide
        if (periodEnd >= deletionDate && !["Filed", "Processed"].includes(f.work_status)) {
          return false;
        }
      }

      return true;
    });
  }, [filings, formFilter, statusGroup, deletedClients, clients]);

  // Live type-to-search — layered on top of the filters above. Matches if
  // the buffer is a case-insensitive substring of ANY of: Client Name, PAN,
  // Ack No, Prepared By, Filed By. Empty buffer = no-op.
  const searchFiltered = useMemo(() => {
    const q = searchBuffer.trim().toLowerCase();
    const clientQ = clientSearchQuery.trim().toLowerCase();
    const statusSet = statusMultiFilter.length ? new Set(statusMultiFilter) : null;
    const preparedBySet = preparedByMultiFilter.length ? new Set(preparedByMultiFilter) : null;
    if (!q && !clientQ && !statusSet && !preparedBySet) return filtered;
    return filtered.filter(f => {
      const client = clients.find(c => c.id === f.client_id);
      const name = client?.name || deletedClients.get(f.client_id)?.name || "";
      if (clientQ && !name.toLowerCase().includes(clientQ)) return false;
      if (statusSet && !statusSet.has(f.work_status)) return false;
      if (preparedBySet && !preparedBySet.has(f.preparer_id || UNASSIGNED_PREPARER)) return false;
      if (!q) return true;
      const pan = client?.pan || "";
      const ackNo = f.acknowledgment_number || "";
      const preparedBy = users.find(u => u.id === f.preparer_id)?.name || "";
      const filedBy = users.find(u => u.id === f.checker_id)?.name || "";
      return [name, pan, ackNo, preparedBy, filedBy].some(v => v.toLowerCase().includes(q));
    });
  }, [filtered, searchBuffer, clientSearchQuery, statusMultiFilter, preparedByMultiFilter, clients, deletedClients, users]);

  // Prepared By options — only users who actually appear as a preparer among
  // the currently-loaded filings (per FY/Quarter/Client/Form), not the whole
  // firm's user list; "Unassigned" only shows up if some filing really has
  // no preparer yet.
  const preparedByOptions = useMemo(() => {
    const presentIds = new Set(filtered.map(f => f.preparer_id).filter((id): id is string => !!id));
    const hasUnassigned = filtered.some(f => !f.preparer_id);
    const opts = users
      .filter(u => presentIds.has(u.id))
      .map(u => ({ value: u.id, label: u.name || "Unnamed" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return hasUnassigned ? [{ value: UNASSIGNED_PREPARER, label: "Unassigned" }, ...opts] : opts;
  }, [filtered, users]);

  // Status options — same idea as Prepared By: only statuses actually held by
  // some currently-loaded filing, kept in the canonical FILING_STATUSES
  // workflow order rather than alphabetical.
  const statusOptions = useMemo(() => {
    const present = new Set(filtered.map(f => f.work_status));
    return FILING_STATUSES.filter(s => present.has(s)).map(s => ({ value: s, label: statusLabel(s) }));
  }, [filtered]);

  // Global type-to-search capture — Excel/Tally style. Fires only when
  // keyboard focus isn't on a real interactive control (native inputs,
  // textareas, contentEditable, or any Radix-based control surfaced as a
  // combobox/listbox/option/checkbox/menuitem/button, which covers the
  // FY/Quarter/Form/Client Selects, the per-row Status Select, and any
  // button) and no Radix Dialog/AlertDialog (e.g. the History Sheet, or a
  // Confirm Finalisation-style dialog elsewhere on the page) is open.
  useEffect(() => {
    const INTERACTIVE_SELECTOR = [
      "input", "textarea", "select", '[contenteditable="true"]',
      '[role="combobox"]', '[role="listbox"]', '[role="option"]',
      '[role="checkbox"]', '[role="menuitem"]', "button",
    ].join(", ");
    const isInteractiveElementFocused = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && el !== document.body && !!el.closest(INTERACTIVE_SELECTOR);
    };
    const isDialogOpen = () =>
      !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDialogOpen() || isInteractiveElementFocused()) return;

      if (e.key === "Escape") {
        if (searchBuffer) { e.preventDefault(); setSearchBuffer(""); }
        return;
      }
      if (e.key === "Backspace") {
        if (searchBuffer) { e.preventDefault(); setSearchBuffer(prev => prev.slice(0, -1)); }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setSearchBuffer(prev => prev + e.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchBuffer]);

  // Excel-style AutoFit for the Status column — width follows the widest
  // possible option (a fixed enum) rather than a fixed guess. Font is copied
  // live from a real rendered [data-autofit] element rather than assumed via
  // Tailwind classes, since a shared component's base classes can silently
  // outrank a plain "text-xs" in the CSS cascade (see TdsDataEntry's Name/PAN
  // autofit).
  const statusMeasureRef = useRef<HTMLSpanElement>(null);
  const [statusColWidth, setStatusColWidth] = useState(180);

  // Excel-style AutoFit for the Ack No column, same idea as Status but keyed
  // off the actual acknowledgment_number VALUES currently on screen (there's
  // no fixed enum here) — grows to fit the longest one, in full, with no
  // truncation, and never shrinks below today's 160px so short/blank values
  // don't collapse the column.
  const ackMeasureRef = useRef<HTMLSpanElement>(null);
  const [ackColWidth, setAckColWidth] = useState(160);

  // Sum of every OTHER column's explicit width (checkbox 40 + Status
  // (dynamic) + Filing Date 184 [160 + extra pl-6 gap after Status] + Ack No
  // (dynamic) + Validate & Finalise 224 + Prepared By 112 + Filed By 112 +
  // Actions 100) plus Client's own min-w-[220px] floor. This is now a
  // MINIMUM width, not a pinned total: the <Table> itself stretches to 100%
  // of its container, and Client — the only column left without an explicit
  // width — deterministically absorbs all width beyond this sum per the
  // table-layout:fixed algorithm, so any growth/shrinkage of Status or Ack No
  // is offset by Client shrinking/growing the other way, keeping the overall
  // layout balanced. Below this minimum the shadcn Table's own overflow-auto
  // wrapper kicks in with horizontal scroll instead of squeezing columns
  // below what they need.
  const TABLE_MIN_WIDTH = 40 + 220 + statusColWidth + 184 + ackColWidth + 224 + 112 + 112 + 100;

  useLayoutEffect(() => {
    const statusEl = statusMeasureRef.current;
    if (!statusEl) return;

    const sampleStatus = document.querySelector('[data-autofit="status"]');
    if (sampleStatus) statusEl.style.font = getComputedStyle(sampleStatus).font;

    // SelectTrigger padding (12px × 2) + border (1px × 2) + chevron icon (16px)
    // + gap before the chevron + a little breathing room
    const STATUS_PADDING = 34 + 16 + 8;
    let maxStatus = 0;
    for (const text of FILING_STATUSES) {
      statusEl.textContent = statusLabel(text);
      maxStatus = Math.max(maxStatus, statusEl.getBoundingClientRect().width);
    }
    setStatusColWidth(Math.ceil(maxStatus) + STATUS_PADDING);
  }, [filtered]);

  useLayoutEffect(() => {
    const ackEl = ackMeasureRef.current;
    if (!ackEl) return;

    // The Input is now w-full, so it inherits whatever width the TableCell
    // gives it — unlike Status's SelectTrigger (given an explicit width of
    // its own), the budget here has to cover the surrounding TableCell's OWN
    // padding too, not just the Input's chrome, since that padding is what's
    // eating into the column width before the Input ever sees it.
    const sampleAck = document.querySelector('[data-autofit="ackno"]');
    if (sampleAck) ackEl.style.font = getComputedStyle(sampleAck).font;

    // TableCell padding (16px × 2, default shadcn p-4) + Input padding
    // (12px × 2) + border (1px × 2) + a little breathing room
    const ACK_PADDING = 32 + 24 + 2 + 8;
    const ACK_MIN_WIDTH = 160;   // today's width — never shrink below it
    let maxAck = 0;
    for (const f of searchFiltered) {
      if (!f.acknowledgment_number) continue;
      ackEl.textContent = f.acknowledgment_number;
      maxAck = Math.max(maxAck, ackEl.getBoundingClientRect().width);
    }
    setAckColWidth(Math.max(ACK_MIN_WIDTH, Math.ceil(maxAck) + ACK_PADDING));
  }, [searchFiltered]);

  // Check if a filing belongs to a deleted client (for archived styling)
  const isArchivedFiling = (f: TdsFiling): boolean => {
    return deletedClients.has(f.client_id);
  };

  // ─── ACK File System (documents bucket + tds_ack_files table) ───────────────
  // Fetch all ACK file records for a list of filing IDs and populate the map
  const fetchAckFiles = async (filingIds: string[]) => {
    if (filingIds.length === 0) { setAckFiles(new Map()); return; }
    const { data, error } = await (supabase.from('tds_ack_files' as any).select('*').in('filing_id', filingIds));
    if (error) { console.log('fetchAckFiles error:', error); return; }
    const map = new Map<string, TdsAckFile>();
    (data || []).forEach((f: any) => map.set(f.filing_id, f as TdsAckFile));
    setAckFiles(map);
  };

  /** Bulk-computes the "Validate & Finalise" column for every loaded filing —
   *  6 grouped queries total (never one per row), mirroring exactly what each
   *  stage's own tab already treats as "applicable"/"an issue":
   *  Stage 1 = tds_recon_results (match_status !== "matched" = issue, same as
   *  TdsValidateFinalise's own `summary.mismatched`); Stage 2 = a
   *  tds_pan_verification_batches row makes it applicable, isPanException(...)
   *  on tds_pan_verification_results marks an issue (TdsPanVerification.tsx);
   *  Stage 3 = a tds_tally_batches row makes it applicable, result !== "Matched"
   *  on tds_tally_results marks an issue (TdsTallyRecon.tsx). A stage that
   *  isn't applicable counts as satisfied (matches each stage's own
   *  `!applicable || issues === 0` gate), not as an open issue. */
  const fetchVfStatuses = async (filingIds: string[]) => {
    if (filingIds.length === 0) { setVfStatuses(new Map()); return; }
    const [s1Res, panBatchRes, panResRes, tallyBatchRes, tallyResRes, sigRes] = await Promise.all([
      supabase.from("tds_recon_results").select("filing_id, match_status, overridden").in("filing_id", filingIds),
      supabase.from("tds_pan_verification_batches").select("filing_id").in("filing_id", filingIds),
      supabase.from("tds_pan_verification_results").select("filing_id, validation_result, overridden").in("filing_id", filingIds),
      supabase.from("tds_tally_batches").select("filing_id").in("filing_id", filingIds),
      supabase.from("tds_tally_results").select("filing_id, result, overridden").in("filing_id", filingIds),
      supabase.from("tds_filing_audit_log").select("filing_id, action_type, new_value, changed_at")
        .in("filing_id", filingIds).in("action_type", ["CHECKER_SIGNATURE", "CHECKER_SIGNATURE_REVOKED"])
        .order("changed_at", { ascending: true }),
    ]);

    // filing_id -> { total, issues } — issues excludes any row already overridden.
    const groupByFiling = (rows: any[] | null | undefined, isIssue: (r: any) => boolean) => {
      const m = new Map<string, { total: number; issues: number }>();
      for (const r of rows || []) {
        const cur = m.get(r.filing_id) || { total: 0, issues: 0 };
        cur.total += 1;
        if (isIssue(r) && !r.overridden) cur.issues += 1;
        m.set(r.filing_id, cur);
      }
      return m;
    };
    const s1ByFiling = groupByFiling(s1Res.data, (r) => r.match_status !== "matched");
    const s2ByFiling = groupByFiling(panResRes.data, (r) => isPanException(r.validation_result));
    const s3ByFiling = groupByFiling(tallyResRes.data, (r) => r.result !== "Matched");
    const s2Applicable = new Set((panBatchRes.data || []).map((b: any) => b.filing_id));
    const s3Applicable = new Set((tallyBatchRes.data || []).map((b: any) => b.filing_id));

    // Latest signature action per filing wins — a later revoke undoes an
    // earlier sign (same rule TdsValidateFinalise's own loadAll uses).
    const sigByFiling = new Map<string, { signed: boolean; name: string | null }>();
    for (const row of sigRes.data || []) {
      sigByFiling.set(row.filing_id, {
        signed: row.action_type === "CHECKER_SIGNATURE",
        name: row.action_type === "CHECKER_SIGNATURE" ? row.new_value : null,
      });
    }

    const map = new Map<string, VfStatus>();
    for (const id of filingIds) {
      const s1c = s1ByFiling.get(id);
      const s1: VfState = !s1c ? "none" : s1c.issues > 0 ? "warn" : "done";
      const s1Detail = !s1c ? "Not run" : s1c.issues > 0 ? `${s1c.issues} unresolved mismatch${s1c.issues === 1 ? "" : "es"}` : "Completed";

      const s2app = s2Applicable.has(id);
      const s2c = s2ByFiling.get(id);
      const s2: VfState = !s2app ? "done" : !s2c ? "none" : s2c.issues > 0 ? "warn" : "done";
      const s2Detail = !s2app ? "Not applicable (no TRACES file imported)" : !s2c ? "Not run" : s2c.issues > 0 ? `${s2c.issues} unresolved PAN issue${s2c.issues === 1 ? "" : "s"}` : "Completed";

      const s3app = s3Applicable.has(id);
      const s3c = s3ByFiling.get(id);
      const s3: VfState = !s3app ? "done" : !s3c ? "none" : s3c.issues > 0 ? "warn" : "done";
      const s3Detail = !s3app ? "Not applicable (no Tally ledger imported)" : !s3c ? "Not run" : s3c.issues > 0 ? `${s3c.issues} unresolved mismatch${s3c.issues === 1 ? "" : "es"}` : "Completed";

      // Stage 4 (Checker Review) has no data of its own — it's a consolidated
      // review of Stage 1-3, so it's "done" exactly when they all are, same
      // as TdsValidateFinalise's own `canFile`.
      const s4: VfState = s1 === "done" && s2 === "done" && s3 === "done" ? "done" : "none";
      const s4Detail = s4 === "done" ? "Completed" : "Pending";

      const sig = sigByFiling.get(id);
      const signed = !!sig?.signed;
      const signedDetail = signed ? `Signed by ${sig?.name || "—"}` : "Not signed";

      const ready = s1 === "done" && s2 === "done" && s3 === "done" && s4 === "done" && signed;

      map.set(id, { s1, s1Detail, s2, s2Detail, s3, s3Detail, s4, s4Detail, signed, signedDetail, ready });
    }
    setVfStatuses(map);
  };

  // Upload PDF → documents bucket → insert tds_ack_files record
  const handleAttachAck = async (filing: TdsFiling, file: File) => {
    // a. Auth check — read the already-in-scope `user` from useAuth() rather
    // than calling supabase.auth.getUser() here. gotrue-js serialises all
    // auth calls through one lock, and useAuth's own visibilitychange
    // handler grabs that lock to refresh the session every time the tab
    // regains visibility — which is exactly what happens the instant a
    // native file-picker dialog closes. A getUser() call here would queue
    // behind that refresh and could hang indefinitely, before setAckUploading
    // ever ran, making the whole upload look like a dead click with zero
    // feedback. `user` is the same lock-free value this file already trusts
    // everywhere else (last_updated_by, preparer_id, etc.).
    if (!user) {
      toast({ title: 'Login required', description: 'You must be logged in to attach files.', variant: 'destructive' });
      return;
    }
    // b. PDF-only validation — the browser-reported MIME type isn't always
    // literally "application/pdf" (files from a network drive, some
    // antivirus/download-manager intercepts, or certain PDF generators
    // commonly report "application/octet-stream" or an empty string for a
    // genuine PDF — the OTHER ack-files storage bucket's own allowed_mime_types
    // config already anticipates this exact quirk), so fall back to the file
    // extension rather than rejecting a real PDF outright.
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast({ title: 'Only PDF files are allowed', description: `"${file.name}" was not recognized as a PDF.`, variant: 'destructive' });
      return;
    }
    setAckUploading(filing.id);
    try {
      // c. Upload to 'documents' bucket (public — no RLS on read). Sanitize
      // via the shared helper so non-ASCII characters (en-dashes, curly
      // quotes, etc.) don't trigger Supabase's opaque "Invalid key" error.
      const safeName = sanitizeStorageName(file.name);
      const filePath = `ack/${filing.client_id}_${Date.now()}_${safeName}`;
      const uploadResult = await supabase.storage.from('documents').upload(filePath, file);
      if (uploadResult.error) {
        const msg = uploadResult.error.message || '';
        const desc = msg.includes('Bucket not found') || msg.includes('does not exist')
          ? 'Storage bucket not configured — ask admin to create "documents" bucket in Supabase'
          : msg.includes('row-level security') || msg.toLowerCase().includes('rls')
          ? 'Permission denied — contact admin to check storage RLS policies'
          : msg;
        toast({ title: 'Upload failed', description: desc, variant: 'destructive' });
        return;
      }
      // d. Get public URL (works because bucket is public)
      const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(filePath);
      // e. Insert into tds_ack_files
      const insertPayload = {
        filing_id: filing.id,
        client_id: filing.client_id,
        firm_id: filing.firm_id || null,
        file_name: file.name,
        file_url: publicUrl,
        user_id: user.id,
      };
      const insertResult = await (supabase.from('tds_ack_files' as any).insert(insertPayload).select('*').single());
      if (insertResult.error) {
        // The file already landed in storage — remove it so a failed DB
        // write doesn't leave an orphaned object with nothing pointing to it.
        await supabase.storage.from('documents').remove([filePath]).catch(() => {});
        toast({ title: 'Failed to save record', description: insertResult.error.message, variant: 'destructive' });
        return;
      }
      // f. Update local map instantly (no full re-fetch needed)
      setAckFiles(prev => {
        const next = new Map(prev);
        next.set(filing.id, insertResult.data as TdsAckFile);
        return next;
      });
      // g. Auto-fill Ack No. from the receipt's own printed "e-Filing
      // Acknowledgement Number". The write uses a DB-level compare-and-swap
      // (.is("acknowledgment_number", null)) rather than trusting this stale
      // `filing` snapshot — the Ack No. input stays enabled during upload, so
      // the user could be typing a value by hand in this exact window; the
      // CAS guarantees the auto-fill silently no-ops if the column is no
      // longer null by the time it runs, instead of racing a manual entry.
      let ackNo: string | null = null;
      try {
        ackNo = await extractAckNumberFromFile(file);
      } catch (e) {
        console.error('Ack number extraction failed:', e);
      }
      if (ackNo && !filing.acknowledgment_number) {
        const { data: casRows, error: casError } = await supabase.from("tds_filings").update({
          acknowledgment_number: ackNo,
          last_updated_by: user.id,
          last_updated_at: new Date().toISOString(),
        }).eq("id", filing.id).is("acknowledgment_number", null).select("id");
        if (casError) {
          toast({ title: '✅ ACK file uploaded', description: `Uploaded, but couldn't save the Ack No. automatically (${casError.message}) — please enter it manually.` });
          return;
        }
        if (casRows && casRows.length > 0) {
          fetchFilings();
          onFilingsChanged?.();
          toast({ title: '✅ ACK file uploaded', description: `Ack No. auto-filled: ${ackNo}` });
          return;
        }
      }
      toast(
        !filing.acknowledgment_number
          ? { title: '✅ ACK file uploaded', description: "Couldn't auto-read the acknowledgement number from this PDF — please enter it manually." }
          : { title: '✅ ACK file uploaded' },
      );
    } catch (e: any) {
      // Any thrown (not resolved-with-error) failure from an auth/storage/DB
      // call above previously left this row stuck on "Uploading…" forever
      // with no toast at all — this finally/catch guarantees the user always
      // gets feedback and the row is never permanently unrecoverable.
      toast({ title: 'Upload failed', description: e?.message || 'An unexpected error occurred — please try again.', variant: 'destructive' });
    } finally {
      setAckUploading(null);
    }
  };

  // View: open the public URL in a new tab via a synthesized <a target="_blank">
  // click, NOT window.open(). window.open("_blank") is silently blocked by
  // ad-blocker extensions and strict browser popup settings on some machines
  // (the blocked call just returns null — no error, nothing opens); a real
  // anchor click is a direct user-gesture navigation that popup blockers let
  // through. Same fix already applied to the sibling Checklist "Preview"
  // button in commit 5bb10afc — mirrored here rather than reinvented.
  const viewAckFile = (ackFile: TdsAckFile) => {
    const a = document.createElement('a');
    a.href = ackFile.file_url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Download: force a real Save-As via Supabase Storage's `?download=` query
  // param, not the <a download> attribute alone. `a.download` is only honored
  // by browsers for same-origin (or blob:/data:) URLs — this app's origin
  // (Vercel) differs from the Supabase Storage origin, so the attribute was
  // silently ignored. Worse, the public URL has no
  // `Content-Disposition: attachment` by default, so the click just navigated
  // the CURRENT tab to the PDF, which the browser then rendered inline in
  // place of this page. Appending `download=<filename>` — the same query
  // param @supabase/storage-js's own `getPublicUrl(path, { download })`
  // option produces (see StorageFileApi.ts) — makes Storage return a real
  // `Content-Disposition: attachment` header, so the browser saves the file
  // instead of navigating. target="_blank" + the anchor-click pattern are
  // kept as a safety net (same shape as viewAckFile / 5bb10afc) in case that
  // header is ever missing for some reason.
  const downloadAckFile = (ackFile: TdsAckFile) => {
    let href = ackFile.file_url;
    try {
      const url = new URL(ackFile.file_url);
      url.searchParams.set('download', ackFile.file_name);
      href = url.toString();
    } catch {
      toast({ title: 'Download link looks invalid', description: 'Could not build a download link for this file — try View PDF instead.', variant: 'destructive' });
      return;
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = ackFile.file_name;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // CP-01: Delete PDF — confirmation → remove from Supabase Storage → delete
  // tds_ack_files record → update UI. Does NOT touch any other filing data.
  const deleteAckFile = async (filingId: string, ackFile: TdsAckFile) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this PDF? This cannot be undone."
    );
    if (!confirmed) return;

    try {
      // 1. Extract storage path from the public URL and remove from bucket
      const marker = '/storage/v1/object/public/documents/';
      const idx = ackFile.file_url.indexOf(marker);
      if (idx !== -1) {
        const storagePath = ackFile.file_url.slice(idx + marker.length);
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove([storagePath]);
        if (storageError) {
          console.warn('[deleteAckFile] storage remove:', storageError.message);
          // Non-fatal — proceed to unlink even if storage delete fails
        }
      }

      // 2. Delete the tds_ack_files record (unlinks PDF from the filing)
      const { error: dbError } = await (supabase.from('tds_ack_files' as any)
        .delete()
        .eq('id', ackFile.id));
      if (dbError) throw dbError;

      // 3. Update local map so the row re-renders with [Attach ACK]
      setAckFiles(prev => {
        const next = new Map(prev);
        next.delete(filingId);
        return next;
      });
      toast({ title: 'PDF deleted successfully' });
    } catch (err: any) {
      console.error('[deleteAckFile]', err);
      toast({ title: 'Failed to delete PDF', description: err.message, variant: 'destructive' });
    }
  };

  const logAuditEntry = async (filingId: string, actionType: string, oldVal: string | null, newVal: string | null, remark?: string) => {
    const firmId = await resolveFirmId();
    await supabase.from("tds_filing_audit_log").insert({
      filing_id: filingId,
      firm_id: firmId,
      action_type: actionType,
      old_value: oldVal,
      new_value: newVal,
      changed_by: user?.id,
      changed_by_name: user?.name || user?.email || "Unknown",
      remark: remark || null,
    } as any);
  };

  // "Filed"/"Processed" declare the return actually went out — that must mean
  // the SAME thing here as it does inside Validate & Finalise's own gate
  // (Stage 1-3 clean AND the checker's Digital Signature), not just "someone
  // picked it from a dropdown". NIL and every other status are never gated —
  // a NIL return has no deductee records to run Stage 1-4 against at all.
  const isFiledLikeStatus = (s: string) => s === "Filed" || s === "Processed";
  const isReadyToFile = (filingId: string) => vfStatuses.get(filingId)?.ready ?? false;

  const handleStatusChange = async (filing: TdsFiling, newStatus: string) => {
    const oldStatus = filing.work_status;
    if (oldStatus === newStatus) return;

    if (isFiledLikeStatus(newStatus) && !isReadyToFile(filing.id)) {
      toast({
        title: "Not ready to file",
        description: "Complete Stage 1-3 and the checker's Digital Signature in Validate & Finalise before marking this return Filed/Processed.",
        variant: "destructive",
      });
      return;
    }

    // Issue 5 (CRITICAL OVERRIDE): ACK is COMPLETELY OPTIONAL — never block filing.
    // Show a non-blocking yellow hint only if BOTH ack number AND ack file are absent.
    if (newStatus === "Filed" && !filing.acknowledgment_number && !filing.ack_file_url) {
      toast({ title: "Tip", description: "ACK number / file not uploaded yet — you can add them later.", variant: "default" });
    }

    const updatePayload: Record<string, any> = {
      work_status: newStatus,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    };

    // Auto-set filing date when status changes to 'Filed' and date is blank
    if (newStatus === "Filed" && !filing.date_of_filing) {
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD for date input
      updatePayload.date_of_filing = today;
    }

    // Auto-clear filing date when reverting out of the Filed/Processed workflow,
    // so the next time it re-enters Filed, the auto-set above gives a fresh date
    // instead of leaving a stale one from a prior filing attempt.
    const wasFiledGroup = oldStatus === "Filed" || oldStatus === "Processed";
    const isFiledGroup = newStatus === "Filed" || newStatus === "Processed";
    if (wasFiledGroup && !isFiledGroup && filing.date_of_filing) {
      updatePayload.date_of_filing = null;
    }

    // Prepared By / Filed By are a read-only audit trail that reflects ONLY the
    // CURRENT status: Prepared By = who set the current "Reviewed" status; Filed
    // By = who set the current "Filed" status. Set to the acting user on entering
    // that status, and cleared to NULL on leaving it — so a name never lingers
    // under an unrelated status. No manual picker.
    const actingUserName = user?.name || user?.email || "Unknown";
    if (newStatus === "Reviewed") {
      updatePayload.preparer_id = user?.id ?? null;
    } else if (oldStatus === "Reviewed") {
      updatePayload.preparer_id = null;
    }
    if (newStatus === "Filed") {
      updatePayload.checker_id = user?.id ?? null;
    } else if (oldStatus === "Filed") {
      updatePayload.checker_id = null;
    }

    const { error } = await supabase.from("tds_filings").update(updatePayload).eq("id", filing.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      await logAuditEntry(filing.id, "STATUS_CHANGE", oldStatus, newStatus);
      if (updatePayload.date_of_filing) {
        await logAuditEntry(filing.id, "FILING_DATE_SET", null, updatePayload.date_of_filing, "Auto-set on filing");
      } else if (updatePayload.date_of_filing === null) {
        await logAuditEntry(filing.id, "FILING_DATE_CLEARED", filing.date_of_filing, null, "Status reverted from Filed");
      }
      if ("preparer_id" in updatePayload) {
        if (updatePayload.preparer_id) await logAuditEntry(filing.id, "PREPARED_BY_SET", null, actingUserName, "Auto-set: status moved to Reviewed");
        else await logAuditEntry(filing.id, "PREPARED_BY_CLEARED", null, null, "Status moved out of Reviewed");
      }
      if ("checker_id" in updatePayload) {
        if (updatePayload.checker_id) await logAuditEntry(filing.id, "FILED_BY_SET", null, actingUserName, "Auto-set: status moved to Filed");
        else await logAuditEntry(filing.id, "FILED_BY_CLEARED", null, null, "Status moved out of Filed");
      }
      fetchFilings();
      onFilingsChanged?.();
    }
  };

  const handleInlineUpdate = async (filing: TdsFiling, field: string, value: any) => {
    const { error } = await supabase.from("tds_filings").update({
      [field]: value,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { fetchFilings(); onFilingsChanged?.(); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === searchFiltered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(searchFiltered.map(f => f.id)));
  };

  const handleBulkAction = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (bulkAction.startsWith("status:")) {
      const newStatus = bulkAction.replace("status:", "");
      const actingUserName = user?.name || user?.email || "Unknown";
      // Same gate as the per-row Status dropdown — a bulk action must never be
      // able to mark a return Filed/Processed that individually couldn't be.
      let skippedNotReady = 0;
      for (const id of ids) {
        const filing = filings.find(f => f.id === id);
        if (filing) {
          if (isFiledLikeStatus(newStatus) && !isReadyToFile(id)) { skippedNotReady++; continue; }
          const payload: any = {
            work_status: newStatus,
            last_updated_by: user?.id,
            last_updated_at: new Date().toISOString(),
          };
          // Prepared By / Filed By reflect the CURRENT status here too (same
          // rule as the per-row status change): set on entering Reviewed/Filed,
          // clear on leaving.
          if (newStatus === "Reviewed") payload.preparer_id = user?.id ?? null;
          else if (filing.work_status === "Reviewed") payload.preparer_id = null;
          if (newStatus === "Filed") payload.checker_id = user?.id ?? null;
          else if (filing.work_status === "Filed") payload.checker_id = null;

          await supabase.from("tds_filings").update(payload).eq("id", id);
          await logAuditEntry(id, "STATUS_CHANGE", filing.work_status, newStatus);
          if ("preparer_id" in payload) {
            if (payload.preparer_id) await logAuditEntry(id, "PREPARED_BY_SET", null, actingUserName, "Auto-set: status moved to Reviewed");
            else await logAuditEntry(id, "PREPARED_BY_CLEARED", null, null, "Status moved out of Reviewed");
          }
          if ("checker_id" in payload) {
            if (payload.checker_id) await logAuditEntry(id, "FILED_BY_SET", null, actingUserName, "Auto-set: status moved to Filed");
            else await logAuditEntry(id, "FILED_BY_CLEARED", null, null, "Status moved out of Filed");
          }
        }
      }
      const updated = ids.length - skippedNotReady;
      toast({
        title: `${updated} filing${updated === 1 ? "" : "s"} updated to ${newStatus}`,
        description: skippedNotReady
          ? `${skippedNotReady} skipped — not ready to file (complete Validate & Finalise first).`
          : undefined,
        ...(skippedNotReady ? { variant: "default" as const } : {}),
      });
    }
    setSelectedIds(new Set());
    setBulkAction("");
    fetchFilings();
    onFilingsChanged?.();
  };

  // History drawer
  const openHistory = async (filing: TdsFiling) => {
    setHistoryFiling(filing);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setNewNote("");
    const { data } = await supabase.from("tds_filing_audit_log")
      .select("*")
      .eq("filing_id", filing.id)
      .order("changed_at", { ascending: false })
      .limit(100);
    setHistoryLogs((data || []) as AuditLogEntry[]);
    setHistoryLoading(false);
  };

  const addNote = async () => {
    if (!historyFiling || !newNote.trim()) return;
    setAddingNote(true);
    await logAuditEntry(historyFiling.id, "NOTE_ADDED", null, null, newNote.trim());
    setNewNote("");
    // Refresh
    const { data } = await supabase.from("tds_filing_audit_log")
      .select("*")
      .eq("filing_id", historyFiling.id)
      .order("changed_at", { ascending: false })
      .limit(100);
    setHistoryLogs((data || []) as AuditLogEntry[]);
    setAddingNote(false);
    toast({ title: "Note added" });
  };

  const exportFilings = () => {
    const rows = filtered.map(f => {
      const c = clients.find(c => c.id === f.client_id);
      return `<tr>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${c?.name || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${c?.tan_number || f.tan || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.tds_forms?.join(", ") || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.quarter}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.financial_year}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${statusLabel(f.work_status)}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${format(getDueDate(f.financial_year, f.quarter), "dd/MM/yyyy")}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.date_of_filing ? format(new Date(f.date_of_filing), "dd/MM/yyyy") : "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.acknowledgment_number || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.prn_no || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.remarks || "—"}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>TDS Filing Sheet</title><style>body{font-family:system-ui;margin:20px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;font-size:11px;border:1px solid #ccc;padding:6px}@media print{@page{size:landscape}}</style></head><body>
      <h2>TDS Filing Sheet — FY: ${fyFilter} | Qtr: ${quarterFilter}</h2>
      <table><thead><tr><th>Client</th><th>TAN</th><th>Form</th><th>Qtr</th><th>FY</th><th>Status</th><th>Due Date</th><th>Filing Date</th><th>Ack No</th><th>PRN</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const w = window.open(URL.createObjectURL(blob), "_blank");
    if (w) setTimeout(() => w.print(), 500);
  };

  return (
    <div className="space-y-4">
      {/* Excel/Tally-style type-to-search overlay — floating, non-intrusive,
          shown only while the search buffer is non-empty. */}
      {searchBuffer && (
        <div className="fixed bottom-4 right-4 z-[60] bg-foreground text-background text-xs font-medium px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
          Searching: {searchBuffer}
        </div>
      )}
      {!hideHeader && (
        <div>
          <h2 className="text-xl font-bold text-foreground">Filings Management</h2>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Info size={14} />
            Filings are created automatically when TDS service is activated in Client Module.
          </p>
        </div>
      )}

      {/* View controls — FY/Quarter/Client/Form filters now live exclusively
          in the Dashboard's top-level header and flow down as props, so
          there is a single source of truth and no duplicate filter UI here.
          The three below are a second, independent layer: they narrow the
          grid FURTHER (composing with FY/Quarter/Client/Form/statusGroup via
          searchFiltered), not replace them. */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="relative w-52">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-7 h-8 text-xs pr-6"
            placeholder="Search client…"
            value={clientSearchQuery}
            onChange={e => setClientSearchQuery(e.target.value)}
          />
          {clientSearchQuery && (
            <button
              type="button"
              onClick={() => setClientSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear client search"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <MultiSelectFilter
          label="Status"
          options={statusOptions}
          selection={statusMultiFilter}
          onChange={setStatusMultiFilter}
        />
        <MultiSelectFilter
          label="Prepared By"
          options={preparedByOptions}
          selection={preparedByMultiFilter}
          onChange={setPreparedByMultiFilter}
        />
        {(clientSearchQuery || statusMultiFilter.length > 0 || preparedByMultiFilter.length > 0) && (
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
            onClick={() => { setClientSearchQuery(""); setStatusMultiFilter([]); setPreparedByMultiFilter([]); }}
          >
            <X size={12} /> Clear Filters
          </Button>
        )}
        <div className="flex-1" />
        {onToggleMaximize && (
          <Button
            variant="outline" size="sm" className="gap-1"
            onClick={onToggleMaximize}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isMaximized ? "Minimize" : "Maximize"}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1">
              <Settings size={14} /> Options
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportFilings} className="gap-2">
              <Download size={14} /> Export Filings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* KPI-card-driven filter indicator — an aggregate status group applied
          on top of the per-row work_status shown in the Status column. */}
      {statusGroup !== "all" && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
            Filtered: {KPI_STATUS_GROUP_LABELS[statusGroup]}
            <button onClick={() => setStatusGroup("all")} className="ml-0.5 hover:text-foreground" aria-label="Clear filter">
              <X size={12} />
            </button>
          </Badge>
        </div>
      )}

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Select value={bulkAction} onValueChange={setBulkAction}>
            <SelectTrigger className="w-[220px] h-8">
              <SelectValue placeholder="Bulk Action..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__header_status" disabled>── Update Status ──</SelectItem>
              {FILING_STATUSES.map(s => (
                <SelectItem key={`status:${s}`} value={`status:${s}`}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="secondary" onClick={handleBulkAction} disabled={!bulkAction}>
            <RefreshCw size={14} className="mr-1" /> Apply
          </Button>
        </div>
      )}

      {/* Hidden measuring span for Excel-style column AutoFit (Status) — same
          font as the real rendered element, positioned off-screen */}
      <span ref={statusMeasureRef} className="text-xs fixed -left-[9999px] top-0 whitespace-pre" aria-hidden="true" />
      {/* Same idea for Ack No — see the ackColWidth effect above */}
      <span ref={ackMeasureRef} className="text-xs fixed -left-[9999px] top-0 whitespace-pre" aria-hidden="true" />

      {/* Main Table */}
      <Card>
        <CardContent className="p-0">
          {/* table-layout:fixed + an explicit width on every OTHER column below —
              a plain browser auto table-layout gives any column without a width
              an unpredictable, oversized share of the row (this was the root
              cause of the dead gaps after Client/Ack No/Status were fixed-width
              but Filing Date/Prepared By/Filed By were not). The <Table> itself
              stretches to 100% of its container (not a pinned px sum) so it
              always fills the available width, leaving no dead zone on wide
              screens; per the table-layout:fixed algorithm, Client — the ONE
              column left without an explicit width (only a min-w-[260px] floor)
              — deterministically absorbs all remaining space, growing on wide
              screens and shrinking to its floor on narrow ones, while every
              other column stays at its explicit width. Below TABLE_MIN_WIDTH the
              shadcn Table primitive's own internal overflow-auto wrapper
              (src/components/ui/table.tsx) takes over — no extra wrapper div is
              needed here. */}
          <Table style={{ tableLayout: "fixed", width: "100%", minWidth: TABLE_MIN_WIDTH }}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={searchFiltered.length > 0 && selectedIds.size === searchFiltered.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="min-w-[220px] sticky left-0 bg-background z-10">Client</TableHead>
                <TableHead style={{ width: statusColWidth, minWidth: statusColWidth }}>Status</TableHead>
                <TableHead className="w-[184px] pl-6">Filing Date</TableHead>
                <TableHead style={{ width: ackColWidth, minWidth: ackColWidth }}>Ack No</TableHead>
                <TableHead className="w-56">Validate &amp; Finalise</TableHead>
                <TableHead className="w-28">Prepared By</TableHead>
                <TableHead className="w-28">Filed By</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 9 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              )) : searchFiltered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    {searchBuffer.trim()
                      ? `No matches for "${searchBuffer.trim()}".`
                      : "No filings found. Filings are created when TDS service is activated for a client."}
                  </TableCell>
                </TableRow>
              ) : searchFiltered.map(f => {
                const client = clients.find(c => c.id === f.client_id);
                const clientTan = client?.tan_number || f.tan;
                const archived = isArchivedFiling(f);
                return (
                  <TableRow key={f.id} className={cn(archived && "bg-muted/40 opacity-70")}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(f.id)}
                        onCheckedChange={() => toggleSelect(f.id)}
                        disabled={archived}
                      />
                    </TableCell>
                    <TableCell className="font-medium sticky left-0 bg-background">
                      <HoverCard openDelay={200} closeDelay={100}>
                        <HoverCardTrigger asChild>
                          {/* HoverCardTrigger asChild (Radix Slot) requires EXACTLY ONE child
                              element — this outer span is that one child, wrapping both the
                              name and the quarter/form badge below. */}
                          <span className="inline-block max-w-full">
                            <span className={cn("block cursor-default hover:underline decoration-dotted underline-offset-4", archived && "line-through text-muted-foreground")}>
                              {(() => {
                                const displayName = client?.name || deletedClients.get(f.client_id)?.name || "—";
                                const { main, parenthetical } = splitClientName(displayName);
                                return parenthetical ? (
                                  <>
                                    <span className="block">{main}</span>
                                    <span className="block">{parenthetical}</span>
                                  </>
                                ) : displayName;
                              })()}
                            </span>
                            {/* A client can have MULTIPLE filings side by side for the same
                                quarter (e.g. both 26Q and 24Q) — each is its own independent
                                row/status, so without this badge two rows for the same client
                                are visually indistinguishable and easy to mix up (e.g. reading
                                a brand-new, untouched 24Q row's "Not Started" as if it were the
                                26Q return that already has real work done on it). */}
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              {f.quarter} · {(f.tds_forms && f.tds_forms.length ? f.tds_forms.join(", ") : "—")}
                            </span>
                          </span>
                        </HoverCardTrigger>
                        <HoverCardContent side="right" className="w-80 p-3">
                          <div className="space-y-1.5 text-sm">
                            <div className="flex gap-2">
                              <span className="text-muted-foreground w-28 shrink-0">TAN</span>
                              <span className="font-mono">{clientTan || "—"}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="text-muted-foreground w-28 shrink-0">PAN</span>
                              <span className="font-mono">{client?.pan || "—"}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="text-muted-foreground w-28 shrink-0">Contact Person</span>
                              <span>{client?.contact_person || "—"}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="text-muted-foreground w-28 shrink-0">Mobile</span>
                              <span>{client?.mobile || "—"}</span>
                            </div>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                      {!clientTan && !archived && (
                        <Badge variant="destructive" className="ml-1.5 text-[10px] gap-1 px-1 py-0 align-middle">
                          <AlertTriangle size={9} /> TAN Missing
                        </Badge>
                      )}
                      {archived && <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0">Archived</Badge>}
                    </TableCell>
                    <TableCell>
                      {archived ? (
                        <Badge className={cn("text-xs", FILING_STATUS_COLORS[f.work_status] || "bg-muted")}>{statusLabel(f.work_status)}</Badge>
                      ) : (
                        <Select value={f.work_status} onValueChange={v => handleStatusChange(f, v)}>
                          {/* Colour the TRIGGER itself (not a smaller badge floating
                              inside it) — FILING_STATUS_COLORS already pairs a bg-* with
                              its own text-*, so the whole dropdown reads as one uniform
                              coloured pill instead of a colour patch sitting inside a
                              separately-shaded box. */}
                          <SelectTrigger
                            data-autofit="status"
                            className={cn("h-7 text-xs font-medium border-0", FILING_STATUS_COLORS[f.work_status] || "bg-muted")}
                            style={{ width: statusColWidth }}
                          >
                            <span className="truncate">{statusLabel(f.work_status)}</span>
                          </SelectTrigger>
                          <SelectContent>
                            {FILING_STATUSES.map(s => {
                              const blocked = isFiledLikeStatus(s) && !isReadyToFile(f.id);
                              return (
                                <SelectItem key={s} value={s} disabled={blocked}>
                                  <span className={cn(blocked && "text-muted-foreground")}>
                                    {statusLabel(s)}{blocked && " (complete Validate & Finalise first)"}
                                  </span>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell className="pl-6">
                      {/* Filing Date is fully system-managed — auto-set to today when
                          status becomes Filed, auto-cleared on reverting away from it.
                          Never manually editable, so no onBlur/save handler here. */}
                      <div className="relative group">
                        <Input
                          type="date"
                          className="h-7 w-32 text-xs bg-muted cursor-not-allowed opacity-70"
                          value={f.date_of_filing || ""}
                          disabled
                        />
                        {f.date_of_filing && (
                          <span className="absolute -top-5 left-0 hidden group-hover:block text-[10px] bg-foreground text-background px-1.5 py-0.5 rounded whitespace-nowrap z-20">
                            🔒 Auto-set when status is Filed
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const isFiledLocked = f.work_status === "Filed" || f.work_status === "Processed";
                        const ackFile = ackFiles.get(f.id);
                        return (
                          <div className="space-y-1">
                            {/* Ack No — editable unless Filed. Keyed on the value itself so
                                an auto-fill from the uploaded ACK PDF (which updates
                                f.acknowledgment_number from outside this input) forces a
                                remount and actually shows up — defaultValue alone only
                                applies on first mount and won't reflect later prop changes.
                                Also disabled while its own ACK PDF is uploading/parsing, so
                                there's no window where the user can be mid-typing here at the
                                exact moment an auto-fill could land (the DB write itself is
                                additionally guarded by a compare-and-swap in handleAttachAck). */}
                            <Input
                              key={f.acknowledgment_number || "empty"}
                              data-autofit="ackno"
                              className={cn("h-7 w-full text-xs", (isFiledLocked || ackUploading === f.id) && "bg-muted cursor-not-allowed opacity-70")}
                              defaultValue={f.acknowledgment_number || ""}
                              disabled={isFiledLocked || ackUploading === f.id}
                              onBlur={e => { if (!isFiledLocked && e.target.value !== (f.acknowledgment_number || "")) handleInlineUpdate(f, "acknowledgment_number", e.target.value || null); }}
                            />
                            {/* ACK PDF attachment — documents bucket + tds_ack_files table */}
                            <div className="flex items-center gap-1 flex-wrap">
                              {ackFile ? (
                                <>
                                  <button
                                    className="flex items-center gap-0.5 text-[9px] text-primary hover:underline"
                                    onClick={() => viewAckFile(ackFile)}
                                    title={`View: ${ackFile.file_name}`}
                                  >
                                    <ExternalLink size={9} /> View PDF
                                  </button>
                                  <button
                                    className="flex items-center gap-0.5 text-[9px] text-primary hover:underline"
                                    onClick={() => downloadAckFile(ackFile)}
                                    title={`Download: ${ackFile.file_name}`}
                                  >
                                    <Download size={9} /> Download
                                  </button>
                                  <button
                                    className="flex items-center gap-0.5 text-[9px] text-red-600 border border-red-600 rounded px-1 hover:bg-red-50"
                                    onClick={() => deleteAckFile(f.id, ackFile)}
                                    title="Delete PDF"
                                  >
                                    <Trash2 size={9} /> Delete PDF
                                  </button>
                                </>
                              ) : (
                                <div
                                  className={cn(
                                    "text-[9px] text-muted-foreground hover:text-primary cursor-pointer rounded border border-dashed border-transparent px-1 -mx-1 transition-colors",
                                    ackUploading === f.id && "opacity-50 pointer-events-none"
                                  )}
                                  title="Click to browse, or drag a PDF here"
                                  // Click triggers the input via an explicit ref.click() call from
                                  // this PLAIN element, matching TdsDataEntry.tsx's Genius Excel
                                  // import (confirmed working elsewhere in this exact module) —
                                  // NOT a <label> wrapping the input. A <label>-associated file
                                  // input was unreliable for this specific upload in the field:
                                  // the native file-picker dialog completed normally but the
                                  // selection never reached the input's change event, across
                                  // multiple machines/browsers/networks/local files/Incognito.
                                  onClick={() => { if (ackUploading !== f.id) ackFileInputRefs.current.get(f.id)?.click(); }}
                                  // Drag-and-drop as a second, independent path to the same
                                  // handleAttachAck — it reads the file from the drop event's own
                                  // dataTransfer, never touching the <input> at all.
                                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("border-primary", "bg-primary/10"); }}
                                  onDragLeave={e => { e.currentTarget.classList.remove("border-primary", "bg-primary/10"); }}
                                  onDrop={e => {
                                    e.preventDefault();
                                    e.currentTarget.classList.remove("border-primary", "bg-primary/10");
                                    if (ackUploading === f.id) return;
                                    const fl = e.dataTransfer.files?.[0];
                                    if (fl) handleAttachAck(f, fl);
                                  }}
                                >
                                  {ackUploading === f.id ? "Uploading…" : "📎 Attach ACK (or drag PDF here)"}
                                  <input
                                    ref={el => { if (el) ackFileInputRefs.current.set(f.id, el); else ackFileInputRefs.current.delete(f.id); }}
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    className="hidden"
                                    onChange={e => {
                                      const fl = e.target.files?.[0];
                                      if (fl) handleAttachAck(f, fl);
                                      e.target.value = "";
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const vf = vfStatuses.get(f.id);
                        if (!vf) return <span className="text-xs text-muted-foreground">—</span>;
                        // Deliberately just ONE word — the per-stage (S1/S2/S3/S4/Sign)
                        // breakdown lives in Stage 4 · Checker Review inside the
                        // Workspace, not here. Clicking straight through to Stage 1 is
                        // the actionable next step regardless of which stage is
                        // actually blocking readiness.
                        return (
                          <button
                            type="button"
                            className={cn("text-xs font-semibold hover:underline underline-offset-2", vf.ready ? "text-emerald-600" : "text-destructive")}
                            title={vf.ready ? "Ready to file — click to open Stage 1" : "Not ready — click to open Stage 1"}
                            onClick={() => onNavigateStage1?.({
                              clientId: f.client_id, financialYear: f.financial_year, quarter: f.quarter,
                              formType: (f.tds_forms && f.tds_forms[0]) || "26Q",
                            })}
                          >
                            {vf.ready ? "✓" : "✗"} Ready
                          </button>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {/* Read-only — auto-set by handleStatusChange when status moves
                          Under Process -> Reviewed. No manual picker. */}
                      <span className={cn("text-xs", !f.preparer_id && "text-muted-foreground")} title="Auto-set when status moves to Reviewed">
                        {users.find(u => u.id === f.preparer_id)?.name || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {/* Read-only — auto-set by handleStatusChange when status moves
                          to Filed. No manual picker. */}
                      <span className={cn("text-xs", !f.checker_id && "text-muted-foreground")} title="Auto-set when status moves to Filed">
                        {users.find(u => u.id === f.checker_id)?.name || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="History" onClick={() => openHistory(f)}>
                          <Clock size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Go to Data Entry" onClick={() => onNavigateDataEntry?.(f.id)}>
                          <ArrowRight size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* History Drawer */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">
              History — {clients.find(c => c.id === historyFiling?.client_id)?.name} | {historyFiling?.tds_forms?.join(", ")} | {historyFiling?.quarter} | {historyFiling?.financial_year}
            </SheetTitle>
          </SheetHeader>

          <div className="py-4 space-y-4">
            {historyLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : historyLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No history entries yet.</p>
            ) : (
              <div className="space-y-2">
                {historyLogs.map(log => (
                  <div key={log.id} className="p-3 border rounded-lg space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">{log.changed_by_name || "System"}</span>
                      <span className="text-xs text-muted-foreground">
                        {log.changed_at ? format(new Date(log.changed_at), "dd/MM/yyyy HH:mm") : "—"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] mr-1">{log.action_type}</Badge>
                      {log.old_value && log.new_value && (
                        <span>{log.old_value} → {log.new_value}</span>
                      )}
                    </div>
                    {log.remark && <p className="text-xs text-foreground bg-muted/50 rounded p-1.5">{log.remark}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* Add note */}
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">Add note</Label>
              <div className="flex gap-2">
                <Input
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Type a note..."
                  className="flex-1 h-8 text-sm"
                  onKeyDown={e => { if (e.key === "Enter" && newNote.trim()) addNote(); }}
                />
                <Button size="sm" onClick={addNote} disabled={addingNote || !newNote.trim()}>
                  {addingNote ? "..." : "Add"}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

    </div>
  );
}
