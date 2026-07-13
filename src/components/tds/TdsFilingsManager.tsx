import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isFilingTdsCompliant } from "@/lib/tdsQuarter";
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
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Download, ArrowRight, RefreshCw, Clock, AlertTriangle, ExternalLink, Info, Settings, Trash2, X,
  Maximize2, Minimize2,
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
  reviewed: "Reviewed",
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

export function TdsFilingsManager({ clients, users, isSuperadmin, resolveFirmId, onNavigateDataEntry, hideHeader, fyFilter, quarterFilter, clientFilter, formFilter, preset, onFilingsChanged, isMaximized, onToggleMaximize, refreshKey }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [deletedClients, setDeletedClients] = useState<Map<string, { name: string | null; deleted_at: string }>>(new Map()); // client_id -> { name, deleted_at }
  const [ackUploading, setAckUploading] = useState<string | null>(null);
  // Map of filing_id → TdsAckFile (populated after each fetch)
  const [ackFiles, setAckFiles] = useState<Map<string, TdsAckFile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusGroup, setStatusGroup] = useState<KpiStatusGroup>("all");
  // Excel/Tally-style type-to-search — no visible input box. A window-level
  // keydown listener (below) appends to this buffer whenever no other
  // interactive element has keyboard focus; the floating "Searching: …"
  // indicator renders whenever it's non-empty.
  const [searchBuffer, setSearchBuffer] = useState("");

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
    setLoading(true);
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
    setLoading(false);
    // Fetch ACK files for all loaded filings
    await fetchAckFiles(allFilings.map(f => f.id));
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
    if (!q) return filtered;
    return filtered.filter(f => {
      const client = clients.find(c => c.id === f.client_id);
      const name = client?.name || deletedClients.get(f.client_id)?.name || "";
      const pan = client?.pan || "";
      const ackNo = f.acknowledgment_number || "";
      const preparedBy = users.find(u => u.id === f.preparer_id)?.name || "";
      const filedBy = users.find(u => u.id === f.checker_id)?.name || "";
      return [name, pan, ackNo, preparedBy, filedBy].some(v => v.toLowerCase().includes(q));
    });
  }, [filtered, searchBuffer, clients, deletedClients, users]);

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

  // Sum of every column's explicit width (checkbox 40 + Client 260 + Status
  // (dynamic) + Filing Date 160 + Ack No 160 + Prepared By 112 + Filed By 112
  // + Actions 100) — pins the <Table>'s own width so table-layout:fixed has
  // an authoritative total to divide exactly among columns instead of an
  // "auto" width that Chrome will silently shrink/stretch at some viewports.
  const TABLE_FIXED_WIDTH = 40 + 260 + statusColWidth + 160 + 160 + 112 + 112 + 100;

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
      statusEl.textContent = text;
      maxStatus = Math.max(maxStatus, statusEl.getBoundingClientRect().width);
    }
    setStatusColWidth(Math.ceil(maxStatus) + STATUS_PADDING);
  }, [filtered]);

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

  // Upload PDF → documents bucket → insert tds_ack_files record
  const handleAttachAck = async (filing: TdsFiling, file: File) => {
    // a. Auth check
    const { data: { user: authUser } } = await supabase.auth.getUser();
    console.log('Auth user:', authUser?.id);
    if (!authUser) {
      toast({ title: 'Login required', description: 'You must be logged in to attach files.', variant: 'destructive' });
      return;
    }
    // b. PDF-only validation
    if (file.type !== 'application/pdf') {
      toast({ title: 'Only PDF files are allowed', variant: 'destructive' });
      return;
    }
    setAckUploading(filing.id);
    // c. Upload to 'documents' bucket (public — no RLS on read)
    const filePath = `ack/${filing.client_id}_${Date.now()}_${file.name}`;
    const uploadResult = await supabase.storage.from('documents').upload(filePath, file);
    console.log('Upload result:', uploadResult);
    if (uploadResult.error) {
      const msg = uploadResult.error.message || '';
      console.log('Error details:', uploadResult.error);
      const desc = msg.includes('Bucket not found') || msg.includes('does not exist')
        ? 'Storage bucket not configured — ask admin to create "documents" bucket in Supabase'
        : msg.includes('row-level security') || msg.toLowerCase().includes('rls')
        ? 'Permission denied — contact admin to check storage RLS policies'
        : msg;
      toast({ title: 'Upload failed', description: desc, variant: 'destructive' });
      setAckUploading(null);
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
      user_id: authUser.id,
    };
    const insertResult = await (supabase.from('tds_ack_files' as any).insert(insertPayload).select('*').single());
    console.log('Insert result:', insertResult);
    if (insertResult.error) {
      console.log('Error details:', insertResult.error);
      toast({ title: 'Failed to save record', description: insertResult.error.message, variant: 'destructive' });
      setAckUploading(null);
      return;
    }
    // f. Update local map instantly (no full re-fetch needed)
    setAckFiles(prev => {
      const next = new Map(prev);
      next.set(filing.id, insertResult.data as TdsAckFile);
      return next;
    });
    toast({ title: '✅ ACK file uploaded' });
    setAckUploading(null);
  };

  // View: open public URL in new tab
  const viewAckFile = (ackFile: TdsAckFile) => {
    window.open(ackFile.file_url, '_blank');
  };

  // Download: programmatic <a> click
  const downloadAckFile = (ackFile: TdsAckFile) => {
    const a = document.createElement('a');
    a.href = ackFile.file_url;
    a.download = ackFile.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

  const handleStatusChange = async (filing: TdsFiling, newStatus: string) => {
    const oldStatus = filing.work_status;
    if (oldStatus === newStatus) return;

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
      for (const id of ids) {
        const filing = filings.find(f => f.id === id);
        if (filing) {
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
      toast({ title: `${ids.length} filings updated to ${newStatus}` });
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
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.work_status}</td>
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
          there is a single source of truth and no duplicate filter UI here. */}
      <div className="flex flex-wrap gap-3 items-end">
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

      {/* Main Table */}
      <Card>
        <CardContent className="p-0">
          {/* table-layout:fixed + an explicit column-count-matched width on every
              column below — a plain browser auto table-layout gives any column
              without a width an unpredictable, oversized share of the row (this
              was the root cause of the dead gaps after Client/Ack No/Status were
              fixed-width but Filing Date/Prepared By/Filed By were not). The
              table's own width is pinned (not stretched to 100%) so the sum of
              column widths is authoritative at every viewport — Client can
              never re-balloon on wide screens or get squeezed on narrow ones;
              the shadcn Table primitive's own internal overflow-auto wrapper
              (src/components/ui/table.tsx) takes over below this width — no
              extra wrapper div is needed here. */}
          <Table style={{ tableLayout: "fixed", width: TABLE_FIXED_WIDTH, minWidth: TABLE_FIXED_WIDTH }}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={searchFiltered.length > 0 && selectedIds.size === searchFiltered.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-[260px] sticky left-0 bg-background z-10">Client</TableHead>
                <TableHead style={{ width: statusColWidth, minWidth: statusColWidth }}>Status</TableHead>
                <TableHead className="w-40">Filing Date</TableHead>
                <TableHead className="w-40">Ack No</TableHead>
                <TableHead className="w-28">Prepared By</TableHead>
                <TableHead className="w-28">Filed By</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              )) : searchFiltered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
                          <span className={cn("inline-block max-w-[260px] cursor-default hover:underline decoration-dotted underline-offset-4", archived && "line-through text-muted-foreground")}>
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
                        <Badge className={cn("text-xs", FILING_STATUS_COLORS[f.work_status] || "bg-muted")}>{f.work_status}</Badge>
                      ) : (
                        <Select value={f.work_status} onValueChange={v => handleStatusChange(f, v)}>
                          <SelectTrigger className="h-7 text-xs" style={{ width: statusColWidth }}>
                            <Badge data-autofit="status" className={cn("text-xs", FILING_STATUS_COLORS[f.work_status] || "bg-muted")}>{f.work_status}</Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {FILING_STATUSES.map(s => (
                              <SelectItem key={s} value={s}>
                                <span>{s}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
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
                            {/* Ack No — editable unless Filed */}
                            <Input
                              className={cn("h-7 w-32 text-xs", isFiledLocked && "bg-muted cursor-not-allowed opacity-70")}
                              defaultValue={f.acknowledgment_number || ""}
                              disabled={isFiledLocked}
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
                                <label className={cn(
                                  "text-[9px] text-muted-foreground hover:text-primary cursor-pointer",
                                  ackUploading === f.id && "opacity-50 pointer-events-none"
                                )}>
                                  {ackUploading === f.id ? "Uploading…" : "📎 Attach ACK"}
                                  <input
                                    type="file"
                                    accept="application/pdf"
                                    className="hidden"
                                    onChange={e => {
                                      const fl = e.target.files?.[0];
                                      if (fl) handleAttachAck(f, fl);
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>
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
