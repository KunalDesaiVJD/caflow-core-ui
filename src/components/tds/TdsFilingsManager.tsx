import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getDefaultTdsQuarter } from "@/lib/tdsQuarter";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Download, ArrowRight, RefreshCw, Copy, Clock, AlertTriangle, ExternalLink, Info, Settings, Trash2, X,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ClientOption { id: string; name: string | null; pan: string | null; tan_number?: string | null; deleted_at?: string | null; }
interface UserOption { id: string; name: string | null; }

interface TdsFiling {
  id: string; client_id: string; firm_id: string; financial_year: string;
  quarter: string; tds_forms: string[] | null; work_status: string;
  date_of_filing: string | null; acknowledgment_number: string | null;
  prn_no: string | null; tan: string | null; assigned_staff: string | null;
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
// not yet terminal", "Overdue" adds a due-date check), so they're applied as
// an extra filter dimension alongside the exact-match statusFilter dropdown.
export type KpiStatusGroup = "all" | "returns-due" | "overdue" | "filed" | "processed" | "not-applicable" | "nil";

const KPI_STATUS_GROUP_LABELS: Record<Exclude<KpiStatusGroup, "all">, string> = {
  "returns-due": "Returns Due",
  overdue: "Overdue",
  filed: "Filed / Submitted",
  processed: "Processed / Accepted",
  "not-applicable": "Not Applicable",
  nil: "NIL Returns",
};

export interface FilingsPreset {
  fy: string;
  quarter: string;
  client: string;
  form: string;
  statusGroup: KpiStatusGroup;
  // Bumped on every click so re-selecting the same card re-applies the
  // preset even if the user changed filters manually in between.
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
  // External filter preset (e.g. from a Dashboard KPI card click) that
  // overrides the current FY/Quarter/Client/Form/Status selection.
  preset?: FilingsPreset | null;
}

const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

const FILING_STATUSES = [
  "Not Started",
  "Not Applicable",
  "NIL",
  "Data Received",
  "Under Process",
  "Queries Sent to Client",
  "Filed",
  "Processed",
] as const;

const FILING_STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "Not Applicable": "bg-muted/60 text-muted-foreground line-through",
  "NIL": "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  "Data Received": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Under Process": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  "Queries Sent to Client": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Filed": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Processed": "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
};

const getDueDate = (fy: string, quarter: string): Date => {
  const fyStart = parseInt(fy.split("-")[0]);
  const dates: Record<string, Date> = {
    Q1: new Date(fyStart, 6, 31), Q2: new Date(fyStart, 9, 31),
    Q3: new Date(fyStart + 1, 0, 31), Q4: new Date(fyStart + 1, 4, 31),
  };
  return dates[quarter] || new Date();
};

const getDueDateColor = (fy: string, quarter: string, status: string) => {
  if (["Filed", "Processed", "Not Applicable", "NIL"].includes(status)) return "text-emerald-600";
  const due = getDueDate(fy, quarter);
  const days = differenceInDays(due, new Date());
  if (days < 0) return "text-destructive font-bold";
  if (days < 7) return "text-amber-600 font-semibold";
  return "text-emerald-600";
};

export function TdsFilingsManager({ clients, users, isSuperadmin, resolveFirmId, onNavigateDataEntry, hideHeader, preset }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [deletedClients, setDeletedClients] = useState<Map<string, { name: string | null; deleted_at: string }>>(new Map()); // client_id -> { name, deleted_at }
  const [ackUploading, setAckUploading] = useState<string | null>(null);
  // Map of filing_id → TdsAckFile (populated after each fetch)
  const [ackFiles, setAckFiles] = useState<Map<string, TdsAckFile>>(new Map());
  const [loading, setLoading] = useState(true);
  const defaultTdsQuarter = useMemo(() => getDefaultTdsQuarter(), []);
  const [fyFilter, setFyFilter] = useState(defaultTdsQuarter.fy);
  const [quarterFilter, setQuarterFilter] = useState(defaultTdsQuarter.quarter);
  const [clientFilter, setClientFilter] = useState("all");
  const [formFilter, setFormFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [statusGroup, setStatusGroup] = useState<KpiStatusGroup>("all");

  // Apply an external preset (Dashboard KPI card click) — keyed on `nonce` so
  // re-clicking the same card re-applies it even with no value change.
  useEffect(() => {
    if (!preset) return;
    setFyFilter(preset.fy);
    setQuarterFilter(preset.quarter);
    setClientFilter(preset.client);
    setFormFilter(preset.form);
    setStatusFilter("all");
    setStatusGroup(preset.statusGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce]);

  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");

  // Copy filing dialog
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySource, setCopySource] = useState<TdsFiling | null>(null);
  const [copyQuarter, setCopyQuarter] = useState("Q1");
  const [copyFy, setCopyFy] = useState(DEFAULT_FY);
  const [copying, setCopying] = useState(false);

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

  /**
   * syncMissingFilings — backfill tds_filings rows for clients that have
   * TDS service active but never got rows created (e.g. activated before
   * auto-create logic existed).
   *
   * For the selected FY:
   *  - If effective_from_fy < selectedFY  → all 4 quarters
   *  - If effective_from_fy === selectedFY → quarters from effective_from_q
   *  - If effective_from_fy > selectedFY  → skip
   * For each (client, form, quarter) combo missing in tds_filings → INSERT.
   */
  const syncMissingFilings = useCallback(async (selectedFY: string) => {
    const firmId = await resolveFirmId();

    // 1. Get TDS service category IDs
    const { data: cats } = await supabase
      .from("service_categories")
      .select("id")
      .eq("linked_module", "tds");
    if (!cats?.length) return;
    const catIds = cats.map((c: any) => c.id);

    // 2. Get active TDS client-services for this firm
    let csQ = (supabase as any)
      .from("client_services")
      .select("client_id, tds_forms_applicable, tds_effective_from_fy, tds_effective_from_q")
      .in("service_category_id", catIds)
      .eq("is_active", true);
    if (!isSuperadmin && firmId) csQ = csQ.eq("firm_id", firmId);
    const { data: csData } = await csQ;
    if (!csData?.length) return;

    // 3. Determine which (client, form, quarter) rows SHOULD exist for selectedFY
    const fyStart = parseInt(selectedFY.split("-")[0]);
    const allQuarters = ["Q1", "Q2", "Q3", "Q4"];

    const required: Array<{ client_id: string; form: string; quarter: string; tan: string | null; firm_id: string | null }> = [];

    // Fetch TAN for each client (needed for the filing row)
    const clientIds = [...new Set((csData as any[]).map((cs: any) => cs.client_id).filter(Boolean))];
    const { data: clientsData } = await supabase
      .from("clients")
      .select("id, tan_number, deleted_at")
      .in("id", clientIds)
      .is("deleted_at", null);
    const tanMap = new Map<string, string | null>((clientsData || []).map((c: any) => [c.id, c.tan_number || null]));
    const activeClientSet = new Set((clientsData || []).map((c: any) => c.id));

    for (const cs of (csData as any[])) {
      if (!cs.client_id || !activeClientSet.has(cs.client_id)) continue;
      const forms: string[] = cs.tds_forms_applicable || [];
      if (forms.length === 0) continue;

      const effectiveFY = cs.tds_effective_from_fy || "";
      const effectiveQ = cs.tds_effective_from_q || "Q1";

      let quarters: string[];
      if (!effectiveFY || effectiveFY < selectedFY) {
        // Service started before this FY → all quarters apply
        quarters = allQuarters;
      } else if (effectiveFY === selectedFY) {
        // Service started mid-FY → only from the effective quarter onwards
        const idx = allQuarters.indexOf(effectiveQ);
        quarters = idx >= 0 ? allQuarters.slice(idx) : allQuarters;
      } else {
        // Service starts after this FY → nothing to create
        continue;
      }

      for (const form of forms) {
        for (const quarter of quarters) {
          required.push({
            client_id: cs.client_id,
            form,
            quarter,
            tan: tanMap.get(cs.client_id) ?? null,
            firm_id: firmId,
          });
        }
      }
    }

    if (required.length === 0) return;

    // 4. Find which combinations already exist in tds_filings
    const { data: existing } = await supabase
      .from("tds_filings")
      .select("client_id, tds_forms, quarter")
      .eq("financial_year", selectedFY)
      .in("client_id", clientIds);

    const existingSet = new Set<string>();
    for (const row of (existing || [])) {
      for (const form of (row.tds_forms || [])) {
        existingSet.add(`${row.client_id}|${form}|${row.quarter}`);
      }
    }

    // 5. Insert only missing rows
    const toInsert = required.filter(
      r => !existingSet.has(`${r.client_id}|${r.form}|${r.quarter}`)
    );
    if (toInsert.length === 0) return;

    const insertPayload = toInsert.map(r => ({
      client_id:       r.client_id,
      firm_id:         r.firm_id,
      financial_year:  selectedFY,
      quarter:         r.quarter,
      tds_forms:       [r.form],
      work_status:     "Not Started",
      tan:             r.tan,
    }));

    await supabase.from("tds_filings").insert(insertPayload as any);
  }, [isSuperadmin, resolveFirmId]);

  const fetchFilings = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();

    // Auto-backfill missing filing rows before fetching
    if (fyFilter !== "all") {
      await syncMissingFilings(fyFilter);
    }

    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(500);
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
  }, [isSuperadmin, resolveFirmId, fyFilter, quarterFilter, clientFilter, syncMissingFilings]);

  useEffect(() => { fetchFilings(); }, [fetchFilings]);

  const filtered = useMemo(() => {
    const today = new Date();
    return filings.filter(f => {
      if (formFilter !== "all" && !(f.tds_forms || []).includes(formFilter)) return false;
      if (statusFilter !== "all" && f.work_status !== statusFilter) return false;

      // KPI-card-driven aggregate status group — these don't map to a single
      // FILING_STATUSES value, so they're checked independently of statusFilter.
      const isTerminal = ["Filed", "Submitted", "Processed", "Accepted", "Not Applicable", "NIL"].includes(f.work_status);
      if (statusGroup === "returns-due" && isTerminal) return false;
      if (statusGroup === "overdue") {
        if (isTerminal) return false;
        if (!(getDueDate(f.financial_year, f.quarter) < today)) return false;
      }
      if (statusGroup === "filed" && !["Filed", "Submitted"].includes(f.work_status)) return false;
      if (statusGroup === "processed" && !["Processed", "Accepted"].includes(f.work_status)) return false;
      if (statusGroup === "not-applicable" && f.work_status !== "Not Applicable") return false;
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
  }, [filings, formFilter, statusFilter, statusGroup, deletedClients]);

  // Excel-style AutoFit for the TAN and Status columns — width follows the
  // widest value actually on screen (TAN) or the widest possible option
  // (Status, a fixed enum) rather than a fixed guess. Font is copied live from
  // a real rendered [data-autofit] element rather than assumed via Tailwind
  // classes, since a shared component's base classes can silently outrank a
  // plain "text-xs" in the CSS cascade (see TdsDataEntry's Name/PAN autofit).
  const tanMeasureRef = useRef<HTMLSpanElement>(null);
  const statusMeasureRef = useRef<HTMLSpanElement>(null);
  const [tanColWidth, setTanColWidth] = useState(110);
  const [statusColWidth, setStatusColWidth] = useState(180);

  useLayoutEffect(() => {
    const tanEl = tanMeasureRef.current;
    const statusEl = statusMeasureRef.current;
    if (!tanEl || !statusEl) return;

    const sampleTan = document.querySelector('[data-autofit="tan"]');
    const sampleStatus = document.querySelector('[data-autofit="status"]');
    if (sampleTan) tanEl.style.font = getComputedStyle(sampleTan).font;
    if (sampleStatus) statusEl.style.font = getComputedStyle(sampleStatus).font;

    const TAN_PADDING = 34; // cell padding + a little breathing room (plain span, no input chrome)
    let maxTan = 0;
    for (const text of ["TAN", ...filtered.map(f => clients.find(c => c.id === f.client_id)?.tan_number || f.tan || "")]) {
      tanEl.textContent = text;
      maxTan = Math.max(maxTan, tanEl.getBoundingClientRect().width);
    }
    setTanColWidth(Math.max(90, Math.min(220, Math.ceil(maxTan) + TAN_PADDING)));

    // SelectTrigger padding (12px × 2) + border (1px × 2) + chevron icon (16px)
    // + gap before the chevron + a little breathing room
    const STATUS_PADDING = 34 + 16 + 8;
    let maxStatus = 0;
    for (const text of FILING_STATUSES) {
      statusEl.textContent = text;
      maxStatus = Math.max(maxStatus, statusEl.getBoundingClientRect().width);
    }
    setStatusColWidth(Math.ceil(maxStatus) + STATUS_PADDING);
  }, [filtered, clients]);

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
      fetchFilings();
    }
  };

  const handleInlineUpdate = async (filing: TdsFiling, field: string, value: any) => {
    const { error } = await supabase.from("tds_filings").update({
      [field]: value,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else fetchFilings();
  };

  const openCopyDialog = (f: TdsFiling) => {
    setCopySource(f);
    const nextQ = f.quarter === "Q1" ? "Q2" : f.quarter === "Q2" ? "Q3" : f.quarter === "Q3" ? "Q4" : "Q1";
    const nextFy = f.quarter === "Q4" ? (() => { const s = parseInt(f.financial_year.split("-")[0]) + 1; return `${s}-${String(s + 1).slice(2)}`; })() : f.financial_year;
    setCopyQuarter(nextQ);
    setCopyFy(nextFy);
    setCopyDialogOpen(true);
  };

  const confirmCopyFiling = async () => {
    if (!copySource) return;
    setCopying(true);
    const { error } = await supabase.from("tds_filings").insert({
      client_id: copySource.client_id,
      firm_id: copySource.firm_id,
      financial_year: copyFy,
      quarter: copyQuarter,
      tds_forms: copySource.tds_forms,
      work_status: "Not Started",
      tan: copySource.tan,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    } as any);
    setCopying(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `Filing copied to ${copyQuarter} ${copyFy}` }); setCopyDialogOpen(false); fetchFilings(); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(f => f.id)));
  };

  const handleBulkAction = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (bulkAction.startsWith("status:")) {
      const newStatus = bulkAction.replace("status:", "");
      for (const id of ids) {
        const filing = filings.find(f => f.id === id);
        if (filing) {
          await supabase.from("tds_filings").update({
            work_status: newStatus,
            last_updated_by: user?.id,
            last_updated_at: new Date().toISOString(),
          }).eq("id", id);
          await logAuditEntry(id, "STATUS_CHANGE", filing.work_status, newStatus);
        }
      }
      toast({ title: `${ids.length} filings updated to ${newStatus}` });
    }
    setSelectedIds(new Set());
    setBulkAction("");
    fetchFilings();
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
      {!hideHeader && (
        <div>
          <h2 className="text-xl font-bold text-foreground">Filings Management</h2>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Info size={14} />
            Filings are created automatically when TDS service is activated in Client Module.
          </p>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">FY</Label>
          <Select value={fyFilter} onValueChange={setFyFilter}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All FY</SelectItem>
              {FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Quarter</Label>
          <Select value={quarterFilter} onValueChange={setQuarterFilter}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Form</Label>
          <Select value={formFilter} onValueChange={setFormFilter}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {TDS_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {FILING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
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

      {/* KPI-card-driven filter indicator — the Status dropdown above stays on
          "All Status" for these, since they're aggregate groups it can't express */}
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

      {/* Hidden measuring spans for Excel-style column AutoFit (TAN/Status) —
          same font as the real rendered elements, positioned off-screen */}
      <span ref={tanMeasureRef} className="text-xs font-mono fixed -left-[9999px] top-0 whitespace-pre" aria-hidden="true" />
      <span ref={statusMeasureRef} className="text-xs fixed -left-[9999px] top-0 whitespace-pre" aria-hidden="true" />

      {/* Main Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="min-w-[150px] sticky left-0 bg-background z-10">Client</TableHead>
                  <TableHead style={{ width: tanColWidth, minWidth: tanColWidth }}>TAN</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Quarter</TableHead>
                  <TableHead>FY</TableHead>
                  <TableHead style={{ width: statusColWidth, minWidth: statusColWidth }}>Status</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Filing Date</TableHead>
                  <TableHead>Ack No</TableHead>
                  <TableHead>PRN No</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 13 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                )) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                      No filings found. Filings are created when TDS service is activated for a client.
                    </TableCell>
                  </TableRow>
                ) : filtered.map(f => {
                  const client = clients.find(c => c.id === f.client_id);
                  const clientTan = client?.tan_number || f.tan;
                  const isNA = f.work_status === "Not Applicable";
                  const archived = isArchivedFiling(f);
                  return (
                    <TableRow key={f.id} className={cn(isNA && "bg-muted/30", archived && "bg-muted/40 opacity-70")}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(f.id)}
                          onCheckedChange={() => toggleSelect(f.id)}
                          disabled={archived}
                        />
                      </TableCell>
                      <TableCell className="font-medium sticky left-0 bg-background">
                        <span className={cn(archived && "line-through text-muted-foreground")}>{client?.name || deletedClients.get(f.client_id)?.name || "—"}</span>
                        {archived && <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0">Archived</Badge>}
                      </TableCell>
                      <TableCell>
                        {clientTan ? (
                          <span className="font-mono text-xs" data-autofit="tan">{clientTan}</span>
                        ) : (
                          <Badge variant="destructive" className="text-xs gap-1 cursor-pointer">
                            <AlertTriangle size={10} /> TAN Missing
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{f.tds_forms?.join(", ")}</Badge></TableCell>
                      <TableCell>{f.quarter}</TableCell>
                      <TableCell>{f.financial_year}</TableCell>
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
                                  <span className={cn(s === "Not Applicable" && "line-through")}>{s}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className={getDueDateColor(f.financial_year, f.quarter, f.work_status)}>
                        {format(getDueDate(f.financial_year, f.quarter), "dd/MM/yyyy")}
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
                                className={cn("h-7 w-28 text-xs", isFiledLocked && "bg-muted cursor-not-allowed opacity-70")}
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
                        <Input className="h-7 w-24 text-xs" defaultValue={f.prn_no || ""}
                          onBlur={e => { if (e.target.value !== (f.prn_no || "")) handleInlineUpdate(f, "prn_no", e.target.value || null); }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 w-28 text-xs" defaultValue={f.remarks || ""}
                          onBlur={e => { if (e.target.value !== (f.remarks || "")) handleInlineUpdate(f, "remarks", e.target.value || null); }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="History" onClick={() => openHistory(f)}>
                            <Clock size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy Filing" onClick={() => openCopyDialog(f)}>
                            <Copy size={14} />
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
          </div>
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

      {/* Copy Filing Dialog */}
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Copy Filing</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Copy <strong>{clients.find(c => c.id === copySource?.client_id)?.name}</strong> — {copySource?.tds_forms?.join(", ")} to a new quarter. Only deductor details are copied; no challan/deductee data.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quarter</Label>
                <Select value={copyQuarter} onValueChange={setCopyQuarter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">FY</Label>
                <Select value={copyFy} onValueChange={setCopyFy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>Cancel</Button>
            <Button onClick={confirmCopyFiling} disabled={copying}>{copying ? "Copying..." : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
