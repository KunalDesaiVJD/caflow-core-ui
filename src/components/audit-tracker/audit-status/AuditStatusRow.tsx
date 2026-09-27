/**
 * AuditStatusRow
 *
 * Full inline-edit row for the Audit Status grid.
 * Features:
 *  - Party Name → searchable combobox; auto-detects entity_type for UDIN Statutory
 *  - Audit Employees → auto-fetched from audit_planning when party selected
 *  - Audit Status → 9 fixed + OTHERS (shows "Specify Please:" text input)
 *  - Firm → dropdown from auditFirms; Partner → dynamic per firm (clears on firm change)
 *  - UDIN Statutory → only visible / editable for private_limited / public_limited
 *  - UDIN Date → auto-fills today when either UDIN field is first entered
 *  - 3CA Prepared/Checked/Uploaded By → searchable user comboboxes
 *  - Two-step delete confirmation
 *  - isNew mode: row starts in edit mode, Save calls onAdd
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge }    from "@/components/ui/badge";
import { Check, X, Trash2, Loader2, Clock, Users, Building2, User, CalendarDays, BadgeCheck, AlertCircle, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useAuth } from "@/hooks/useAuth";
import { UserCombobox } from "@/components/shared/UserCombobox";
import type { StatusEntry, StatusPatch } from "../hooks/useAuditStatus";
import type { ClientOption }             from "../hooks/useClients";
import type { UserOption }               from "../hooks/useUsers";
import type { AuditFirmOption }          from "../hooks/useFirms";
import type { PlanEntry }                from "../hooks/useAuditPlanning";
import { AUDIT_STATUS_OPTIONS, REMARKS_OPTIONS } from "./AuditStatusFilters";
import UploadConfirmDialog               from "./UploadConfirmDialog";

// ─── Constants ────────────────────────────────────────────────────────────────

const YES_NO = ["Yes", "No"];

const STATUS_COLORS: Record<string, string> = {
  "DATA PENDING":            "bg-gray-100 text-gray-600",
  "QUERIES GIVEN TO CLIENT": "bg-yellow-100 text-yellow-700",
  "PREPARE PENDING":         "bg-orange-100 text-orange-700",
  "VERIFICATION PENDING":    "bg-blue-100 text-blue-700",
  "REPORT SENT TO CLIENT FOR VERIFICATION": "bg-cyan-100 text-cyan-700",
  "REPORT WITH VJD":         "bg-violet-100 text-violet-700",
  "REPORT WITH KVD":         "bg-purple-100 text-purple-700",
  "REPORT SENT TO CLIENT":   "bg-teal-100 text-teal-700",
  "REPORT SIGNED":           "bg-green-100 text-green-700",
  "REPORT PRINTED":          "bg-emerald-200 text-emerald-800",
  "OTHERS (SPECIFY)":        "bg-pink-100 text-pink-700",
};

/** CP-07 BUG D: statutory / both engagement type → always show UDIN Statutory */
function isStatutoryOrBoth(engType: string | null | undefined) {
  if (!engType) return false;
  const t = engType.toLowerCase().trim();
  return t === "statutory" || t === "both";
}

/** Fallback: corporate entity type also shows UDIN Statutory */
function isCorporate(entityType: string | null | undefined) {
  if (!entityType) return false;
  const et = entityType.toLowerCase().replace(/_/g, " ").trim();
  return (
    et === "private ltd" || et === "public ltd" ||
    et === "private limited" || et === "public limited" ||
    et === "company" || et === "llp"
  );
}

/**
 * Tax audit applicability for the 3CA/3CB+3CD columns.
 * Applicable only when the engagement covers a tax audit ("tax_audit" or
 * "both"). For statutory-only engagements (e.g. a company where tax audit is
 * not applicable) the 3CA/3CB+3CD Prepared/Checked/Uploaded-By columns are
 * locked to "NA". Unknown/empty engagement_type defaults to applicable so we
 * never wrongly lock a row.
 */
function isTaxAuditApplicable(engType: string | null | undefined) {
  if (!engType) return true;
  const t = engType.toLowerCase().trim();
  return t === "tax_audit" || t === "both";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Draft state shape ───────────────────────────────────────────────────────

interface RowDraft {
  clientId:                     string;
  entityType:                   string | null;
  party_name:                   string;
  physical_audit_conducted:     string;
  accounting_data:              string;
  audit_employees:              string;
  audit_report_prepared_by:     string;
  audit_report_checked_by:      string;
  audit_status:                 string;
  audit_status_other:           string;
  report_print_date:            string;
  firm:                         string;
  partner:                      string;
  udin_tax_audit:               string;
  udin_statutory_audit:         string;
  udin_date:                    string;
  physical_report_received_date:string;
  scanned:                      string;
  prepared_by:                  string;
  checked_by:                   string;
  uploaded_by:                  string;
  upload_date:                  string;
  remarks:                      string;
  remarks_other:                string;
}

// ─── Mini shared cell wrapper ─────────────────────────────────────────────────

function TCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn("border border-border px-1.5 py-1 align-middle text-xs", className)}>
      {children}
    </td>
  );
}

// ─── Inline text input ────────────────────────────────────────────────────────

function EInput({ value, onChange, placeholder, type = "text", className, readOnly }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; className?: string; readOnly?: boolean;
}) {
  return (
    <Input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className={cn("h-6 text-[11px] w-full px-1.5", className)}
    />
  );
}

// ─── UDIN input with quick "NA" toggle ─────────────────────────────────────────
//
// UDIN numbers are entered manually, but some engagements simply have no
// UDIN to report (e.g. the report isn't applicable). Auditors asked for a
// one-click "NA" instead of typing it every time. The pill toggles the
// value to/from the literal string "NA"; while NA is set the text field is
// disabled (NA and a real UDIN are mutually exclusive). Manual typing is
// otherwise unchanged.
function UdinInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const isNA = value.trim().toUpperCase() === "NA";
  return (
    <div className="flex items-center gap-1">
      {/* When NA is selected the dropdown already shows "NA" — so the text
          box must NOT also display "NA" (that produced a redundant double
          "NA"). It instead shows a muted "Not applicable" placeholder while
          disabled. Manual UDIN typing is unchanged. */}
      <Input
        type="text"
        value={isNA ? "" : value}
        onChange={e => onChange(e.target.value)}
        placeholder={isNA ? "Not applicable" : placeholder}
        disabled={isNA}
        className={cn(
          "h-6 text-[11px] w-full px-1.5 font-mono",
          isNA && "disabled:opacity-100 italic placeholder:text-muted-foreground",
        )}
      />
      {/* "NA" is a dropdown option. Selecting "NA" flags the cell Not
          Applicable; "—" clears it back to a typeable UDIN field. */}
      <select
        value={isNA ? "NA" : ""}
        onChange={e => onChange(e.target.value === "NA" ? "NA" : "")}
        title="Set Not Applicable"
        className="h-6 w-[42px] shrink-0 text-[10px] rounded border border-input bg-background px-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">—</option>
        <option value="NA">NA</option>
      </select>
    </div>
  );
}

// ─── Select helper ────────────────────────────────────────────────────────────

function ESelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: string[]; placeholder?: string;
}) {
  return (
    <Select value={value || "__none__"} onValueChange={v => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger className="h-6 text-[11px] px-1.5"><SelectValue placeholder={placeholder || "—"} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__" className="text-[11px]">—</SelectItem>
        {options.map(o => <SelectItem key={o} value={o} className="text-[11px]">{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ─── Searchable combobox for clients ─────────────────────────────────────────

function ClientCombobox({ value, onChange, clients, placeholder }: {
  value: string;
  onChange: (text: string, client: ClientOption | null) => void;
  clients: ClientOption[];
  placeholder?: string;
}) {
  const [open, setOpen]       = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 180 });
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef  = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() =>
    (value
      ? clients.filter(c => c.name.toLowerCase().includes(value.toLowerCase()))
      : clients
    ).slice(0, 20),
    [value, clients]
  );

  useEffect(() => { setHighlight(0); }, [value, clients]);
  useEffect(() => {
    if (!open || !dropRef.current) return;
    const el = dropRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function handleFocus() {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom, left: r.left, width: Math.max(r.width, 180) });
    }
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, Math.max(filtered.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      const pick = filtered[Math.min(highlight, filtered.length - 1)];
      if (pick) { onChange(pick.name, pick); setOpen(false); }
    } else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="min-w-[130px]">
      <Input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value, null)}
        onFocus={handleFocus}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Search party…"}
        className="h-6 text-[11px] px-1.5 w-full"
      />
      {open && filtered.length > 0 && (
        <div
          ref={dropRef}
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-popover border rounded-md shadow-lg max-h-48 overflow-auto"
        >
          {filtered.map((c, i) => (
            <div
              key={c.id}
              data-idx={i}
              onMouseDown={e => { e.preventDefault(); onChange(c.name, c); setOpen(false); }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "px-2 py-1.5 text-[11px] cursor-pointer",
                i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

// 2026-06-25 (V J Desai) — autosave save state, reported to Grid so the
// filter bar can show a global "Saving 3 changes…" or "All changes saved"
// pill. Idle = nothing in flight / never touched.
export type SaveState = "idle" | "saving" | "saved" | "error";

interface Props {
  row:                StatusEntry;
  srNo:               number;
  clients:            ClientOption[];
  users:              UserOption[];
  auditFirms:         AuditFirmOption[];
  planEntries:        PlanEntry[];
  onSave:             (id: string, patch: StatusPatch) => Promise<void>;
  onDelete:           (id: string) => Promise<void>;
  onHistory?:         (id: string) => void;
  /** isNew: row was just created in the grid and starts in edit mode.
   *  New rows use explicit Add (commitSave) — autosave is disabled until
   *  the row exists in the DB. */
  isNew?:             boolean;
  onAdd?:             (patch: StatusPatch) => Promise<void>;
  onCancelNew?:       () => void;
  /** Autosave state reporter — Grid aggregates across all rows so the
   *  filter bar can show one global pill. */
  onSaveStateChange?: (id: string, state: SaveState) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditStatusRow({
  row, srNo, clients, users, auditFirms, planEntries,
  onSave, onDelete, onHistory,
  isNew, onAdd, onCancelNew,
  onSaveStateChange,
}: Props) {

  // ── Edit state — rows are always editable (no pencil-click required) ─────────
  const [editing, setEditing] = useState(true);
  const [draft,   setDraft]   = useState<RowDraft>(buildDraft(row, clients));
  const [saving,  setSaving]  = useState(false);
  // 2026-06-25 (V J Desai — autosave): per-cell save lifecycle.
  //   idle    → no unsaved changes / never touched
  //   saving  → PATCH in flight (dropdown blur-fire or text debounce elapsed)
  //   saved   → PATCH landed <1500 ms ago; ticks back to idle after that
  //   error   → PATCH failed; auto-retried once, still failed. Cell keeps
  //             the auditor's typed value visible + red icon in Actions gutter
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // 3CA/3CB+3CD Uploaded By — gated confirmation dialog (files + AI-read
  // date + name, all-or-nothing before anything is saved to the row).
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const { user: authUser } = useAuth();

  // Auto-reset draft when a new row is first mounted
  useEffect(() => {
    if (isNew) { setDraft(buildDraft(row, clients)); }
  }, [isNew]); // eslint-disable-line

  // 2026-06-25 — Autosave plumbing.
  // pendingPatch accumulates dirty fields between debounce ticks so a run
  // of quick edits collapses into one PATCH (server-friendly + atomic).
  // debounceTimer is the delay before the flush fires (500 ms for text /
  // 0 ms for dropdowns/dates via a distinct call). savedIndicatorTimer
  // fades the green tick back to idle so old rows don't stay green forever.
  const pendingPatch        = useRef<Partial<StatusPatch>>({});
  const debounceTimer       = useRef<ReturnType<typeof setTimeout>>();
  const savedIndicatorTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => onSaveStateChange?.(row.id, saveState), [saveState, row.id, onSaveStateChange]);

  // Clean up timers when the row unmounts (row deleted / grid re-rendered).
  useEffect(() => () => {
    if (debounceTimer.current)       clearTimeout(debounceTimer.current);
    if (savedIndicatorTimer.current) clearTimeout(savedIndicatorTimer.current);
    onSaveStateChange?.(row.id, "idle");
  }, []); // eslint-disable-line

  // ── Firm options ─────────────────────────────────────────────────────────────
  const firmNames = useMemo(
    () => [...new Set(auditFirms.map(f => f.name))].sort(),
    [auditFirms]
  );
  const partnerOptions = useMemo(() => {
    if (!draft.firm) return [];
    return auditFirms
      .filter(f => f.name === draft.firm)
      .map(f => f.partner_name)
      .filter(Boolean) as string[];
  }, [draft.firm, auditFirms]);

  // ── View-mode entity type (from persisted client_id) ─────────────────────────
  const viewEntityType = clients.find(c => c.id === row.client_id)?.entity_type ?? null;
  // CP-07 BUG D: show for statutory/both engagement_type OR corporate entity
  const showUdinStatutoryView = isStatutoryOrBoth(row.engagement_type) || isCorporate(viewEntityType);

  // ── Autosave core ────────────────────────────────────────────────────────────
  // 2026-06-25 (V J Desai): replaced batch "Save All Changes" with autosave.
  // Rules:
  //   • Dropdowns / dates commit immediately (0 ms debounce) — auditors expect
  //     a picked value to be sticky the instant they close the popover.
  //   • Text inputs debounce 500 ms after the last keystroke so a typed UDIN
  //     doesn't fire 20 PATCHes.
  //   • Multiple field edits inside one debounce window collapse into a single
  //     PATCH via pendingPatch — server-friendly and atomic.
  //   • On failure the code auto-retries once. If that also fails, the row's
  //     save-state stays "error" and the auditor's typed value is preserved;
  //     the red icon on the Actions column exposes the failure. Retry survives
  //     via re-queueing the failed fields into pendingPatch.

  // "uploaded_by" deliberately excluded — that cell is now a button that
  // opens UploadConfirmDialog (see cell 17 below); it never calls set()
  // directly, so listing it here would be dead/misleading.
  const TEXT_FIELDS: Set<keyof RowDraft> = new Set([
    "party_name", "audit_employees",
    "audit_report_prepared_by", "audit_report_checked_by",
    "audit_status_other",
    "firm", "partner",
    "udin_tax_audit", "udin_statutory_audit",
    "prepared_by", "checked_by",
    "remarks", "remarks_other",
  ]);
  // Draft-side field name → DB column name. Only fields that differ are
  // listed; everything else is 1:1.
  const FIELD_ALIAS: Partial<Record<keyof RowDraft, keyof StatusPatch>> = {
    clientId: "client_id",
    // entityType is derived from the client_id — never persisted directly.
  };
  const dbField = (f: keyof RowDraft): keyof StatusPatch =>
    (FIELD_ALIAS[f] ?? (f as any)) as keyof StatusPatch;

  // Normalise the draft value the way draftToPatch would — empty string → null,
  // yes/no defaults, OTHER-scoped text. Keeps the autosave format identical to
  // what the previous batch save wrote so downstream consumers don't drift.
  function normalizeForDb(field: keyof RowDraft, val: string, currentDraft: RowDraft): any {
    if (field === "physical_audit_conducted" || field === "accounting_data" || field === "scanned") {
      return val || "No";
    }
    if (field === "audit_status_other") {
      return currentDraft.audit_status === "OTHERS" ? (val || null) : null;
    }
    if (field === "remarks_other") {
      return currentDraft.remarks === "Others" ? (val || null) : null;
    }
    return val || null;
  }

  async function flushPending(retriesLeft = 1) {
    if (Object.keys(pendingPatch.current).length === 0) return;
    // Snapshot the patch and clear the pending buffer so subsequent keystrokes
    // start a fresh accumulation while this PATCH is in flight.
    const patch = { ...pendingPatch.current };
    pendingPatch.current = {};
    setSaveState("saving");
    try {
      await onSave(row.id, patch);
      setSaveState("saved");
      if (savedIndicatorTimer.current) clearTimeout(savedIndicatorTimer.current);
      savedIndicatorTimer.current = setTimeout(() => setSaveState("idle"), 1500);
    } catch (err) {
      console.error("[Autosave] PATCH failed:", err);
      // Re-queue the failed fields so a subsequent flush or manual retry
      // includes them (never silently drop what the auditor typed).
      pendingPatch.current = { ...patch, ...pendingPatch.current };
      if (retriesLeft > 0) {
        // Single transient retry after 800 ms — covers Supabase 429s and
        // brief RLS cache warm-ups without spamming.
        setTimeout(() => flushPending(retriesLeft - 1), 800);
      } else {
        setSaveState("error");
      }
    }
  }

  function scheduleFlush(delay: number) {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => flushPending(1), delay);
  }

  /** Queue an autosave for one or more fields on an existing row.
   *  For new rows (`isNew`) this is a no-op — the auditor must click Add. */
  function queueSave(patch: Partial<StatusPatch>, delay: number) {
    if (isNew) return;
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    scheduleFlush(delay);
  }

  // ── Edit handlers ─────────────────────────────────────────────────────────────

  /** set — update draft locally AND queue an autosave. Single entry point for
   *  every cell so we never accidentally bypass the autosave.
   *  Text fields: 500 ms debounce (accumulate keystrokes into one PATCH).
   *  Dropdowns / dates: 0 ms debounce (fire on selection). */
  function set(field: keyof RowDraft, val: string) {
    setDraft(p => ({ ...p, [field]: val }));
    if (field === "entityType") return;  // derived only, never persisted
    const isText = TEXT_FIELDS.has(field);
    queueSave({ [dbField(field)]: normalizeForDb(field, val, draft) } as any, isText ? 500 : 0);
  }

  function handleClientSelect(text: string, client: ClientOption | null) {
    // Multi-field write — draft first, then a single combined autosave so the
    // party_name / client_id / audit_employees fields all land in one PATCH.
    if (client) {
      const planEntry = planEntries.find(e => e.client_id === client.id);
      const empNames = planEntry?.employee_names?.join(", ") || "";
      setDraft(p => ({
        ...p,
        party_name: client.name,
        clientId:   client.id,
        entityType: client.entity_type,
        audit_employees: empNames || p.audit_employees,
      }));
      queueSave({
        party_name:      client.name,
        client_id:       client.id,
        audit_employees: empNames || draft.audit_employees || null,
      } as any, 0);
    } else {
      setDraft(p => ({ ...p, party_name: text, clientId: "", entityType: null }));
      queueSave({ party_name: text || null, client_id: null } as any, 500);
    }
  }

  function handleFirmChange(firmName: string) {
    setDraft(p => ({ ...p, firm: firmName, partner: "" }));
    queueSave({ firm: firmName || null, partner: null } as any, 0);
  }

  function handleUdinField(field: "udin_tax_audit" | "udin_statutory_audit", val: string) {
    const isRealUdin = !!val && val.trim().toUpperCase() !== "NA";
    setDraft(p => {
      const updates: Partial<RowDraft> = { [field]: val };
      if (isRealUdin && !p.udin_date) updates.udin_date = todayISO();
      return { ...p, ...updates };
    });
    const patch: Partial<StatusPatch> = { [field]: val || null } as any;
    if (isRealUdin && !draft.udin_date) patch.udin_date = todayISO();
    queueSave(patch, 500);
  }

  /** commitSave — used ONLY by the "Add new row" flow now. Existing rows
   *  autosave per field, so this path never runs for them. */
  async function commitSave() {
    setSaving(true);
    const patch = draftToPatch(draft);
    if (!taxAuditApplicable) {
      patch.prepared_by = "NA";
      patch.checked_by  = "NA";
      patch.uploaded_by = "NA";
      patch.upload_date = null;
    }
    if (isNew && onAdd) {
      await onAdd(patch);
    } else {
      await onSave(row.id, patch);
    }
    setSaving(false);
  }

  function cancelEdit() {
    if (isNew && onCancelNew) { onCancelNew(); return; }
    // For non-new rows: reset draft back to last saved values
    setDraft(buildDraft(row, clients));
  }

  // ── Convenience aliases ───────────────────────────────────────────────────────
  // CP-07 BUG D: show for statutory/both engagement_type OR corporate entity
  const showUdinStatutoryEdit = isStatutoryOrBoth(row.engagement_type) || isCorporate(draft.entityType);
  // 3CA/3CB+3CD columns are locked to "NA" when tax audit is not applicable.
  // Authoritative source: the client's tax_audit_applicable flag for this FY
  // (from client_fy_audit_setup). When that flag isn't available (null), fall
  // back to engagement_type. engagement_type alone is unreliable — some
  // statutory-only clients have it blank — which is why the flag wins.
  const clientTaxFlag = clients.find(c => c.id === row.client_id)?.tax_audit_applicable;
  const taxAuditApplicable = typeof clientTaxFlag === "boolean"
    ? clientTaxFlag
    : isTaxAuditApplicable(row.engagement_type);
  const showOther = draft.audit_status === "OTHERS (SPECIFY)";

  const statusColor = STATUS_COLORS[row.audit_status || ""] || "bg-gray-100 text-gray-600";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <tr className={cn(
      "hover:bg-muted/10 transition-colors",
      isNew && "bg-amber-50 ring-1 ring-amber-200 ring-inset",
      row.isPlanning && "bg-slate-50/70",
      // 2026-06-25 (V J Desai request v2): scanned=Yes marks the final
      // stage — highlight the whole row in a saturated Excel-style green.
      // The earlier bg-emerald-50 was too subtle to scan across 100+ rows.
      // Using bg-green-200 (~ the "Good" cell style from Excel) plus a
      // 4-px emerald left border for extra "these are done" punch.
      // Cells override sticky bg (party name / Sr No) so the highlight
      // covers the whole row edge to edge.
      row.scanned === "Yes" && "bg-green-200 hover:bg-green-200 [&>td]:!bg-green-200 border-l-4 border-emerald-600",
    )}>

      {/* 1 · Sr No */}
      <TCell className="text-center text-muted-foreground font-mono w-10 sticky left-0 z-10 bg-card">
        {srNo || <span className="text-indigo-400 text-[10px]">new</span>}
      </TCell>

      {/* 2 · Party Name (hover card shows audit employees / firm / partner) */}
      <TCell className="min-w-[140px] sticky left-10 z-10 bg-card">
        {isNew ? (
          <ClientCombobox
            value={draft.party_name}
            onChange={handleClientSelect}
            clients={clients}
            placeholder="Search party…"
          />
        ) : (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <span className="font-medium text-foreground cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 truncate block max-w-[200px]">
                {row.party_name || "—"}
              </span>
            </HoverCardTrigger>
            <HoverCardContent
              side="right"
              align="start"
              sideOffset={8}
              className="w-72 p-0 overflow-hidden"
            >
              {/* Header */}
              <div className="bg-indigo-600 px-3 py-2">
                <p className="text-[11px] font-semibold text-white truncate">
                  {row.party_name || "—"}
                </p>
                <p className="text-[10px] text-indigo-200 mt-0.5">
                  {row.financial_year ? `FY ${row.financial_year}` : ""}
                  {row.financial_year && row.engagement_type ? " · " : ""}
                  {row.engagement_type
                    ? row.engagement_type === "tax_audit" ? "Tax Audit"
                      : row.engagement_type === "statutory" ? "Statutory Audit"
                      : row.engagement_type === "both" ? "Statutory + Tax"
                      : row.engagement_type
                    : ""}
                </p>
              </div>

              {/* Body */}
              <div className="px-3 py-2.5 space-y-2.5">

                {/* Audit Employees */}
                <div className="flex items-start gap-2">
                  <Users size={13} className="text-indigo-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                      Audit Team
                    </p>
                    <p className="text-xs text-foreground leading-relaxed">
                      {row.audit_employees
                        ? row.audit_employees.split(", ").map((emp, i) => (
                            <span key={i} className="inline-flex items-center gap-0.5 mr-1 mb-0.5 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-medium">
                              {emp}
                            </span>
                          ))
                        : <span className="italic text-muted-foreground text-[11px]">Not yet assigned in Planning Calendar</span>
                      }
                    </p>
                  </div>
                </div>

                <div className="border-t border-border/60" />

                {/* Audit Firm */}
                <div className="flex items-start gap-2">
                  <Building2 size={13} className="text-slate-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                      Audit Firm
                    </p>
                    <p className="text-xs text-foreground">
                      {row.firm || <span className="italic text-muted-foreground text-[11px]">Not assigned</span>}
                    </p>
                  </div>
                </div>

                {/* Partner */}
                <div className="flex items-start gap-2">
                  <User size={13} className="text-slate-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                      Engagement Partner
                    </p>
                    <p className="text-xs text-foreground font-medium">
                      {row.partner || <span className="italic text-muted-foreground font-normal text-[11px]">Not assigned</span>}
                    </p>
                  </div>
                </div>

                {/* Planned Dates — only when available */}
                {(row.planned_from || row.planned_to) && (
                  <>
                    <div className="border-t border-border/60" />
                    <div className="flex items-start gap-2">
                      <CalendarDays size={13} className="text-emerald-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                          Planned Period
                        </p>
                        <p className="text-xs text-foreground">
                          {row.planned_from || "?"} → {row.planned_to || "?"}
                        </p>
                      </div>
                    </div>
                  </>
                )}

                {/* Audit Status — only when set */}
                {row.audit_status && (
                  <>
                    <div className="border-t border-border/60" />
                    <div className="flex items-start gap-2">
                      <BadgeCheck size={13} className="text-amber-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                          Current Status
                        </p>
                        <p className="text-xs text-foreground">
                          {row.audit_status}
                          {row.audit_status === "OTHERS (SPECIFY)" && row.audit_status_other
                            ? `: ${row.audit_status_other}`
                            : ""}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
      </TCell>

      {/* 3 · Physical Audit Conducted */}
      <TCell className="w-20 text-center">
        {editing
          ? <ESelect value={draft.physical_audit_conducted} onChange={v => set("physical_audit_conducted", v)} options={YES_NO} />
          : <Badge className={cn("text-[10px]", row.physical_audit_conducted === "Yes" ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600")}>
              {row.physical_audit_conducted || "No"}
            </Badge>}
      </TCell>

      {/* 4 · Accounting Data */}
      <TCell className="w-20 text-center">
        {editing
          ? <ESelect value={draft.accounting_data} onChange={v => set("accounting_data", v)} options={YES_NO} />
          : <Badge className={cn("text-[10px]", row.accounting_data === "Yes" ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600")}>
              {row.accounting_data || "No"}
            </Badge>}
      </TCell>

      {/* 6 · Audit Report Prepared By */}
      <TCell className="min-w-[120px]">
        {editing
          ? <UserCombobox value={draft.audit_report_prepared_by} onChange={v => set("audit_report_prepared_by", v)} users={users} placeholder="Name…" />
          : <span>{row.audit_report_prepared_by || "—"}</span>}
      </TCell>

      {/* 6b · Audit Report Checked By */}
      <TCell className="min-w-[120px]">
        {editing
          ? <UserCombobox value={draft.audit_report_checked_by} onChange={v => set("audit_report_checked_by", v)} users={users} placeholder="Name…" />
          : <span>{row.audit_report_checked_by || "—"}</span>}
      </TCell>

      {/* 7 · Audit Status — widened per V J Desai request so full labels
          like "QUERIES GIVEN TO CLIENT" and "VERIFICATION PENDING" fit
          without ellipsis. whitespace-nowrap on the badge keeps it on
          a single line so the auditor can read the status at a glance. */}
      <TCell className="min-w-[210px]">
        {editing ? (
          <div className="space-y-1">
            <ESelect value={draft.audit_status} onChange={v => set("audit_status", v)} options={AUDIT_STATUS_OPTIONS} />
            {showOther && (
              <EInput
                value={draft.audit_status_other}
                onChange={v => set("audit_status_other", v)}
                placeholder="Specify please…"
              />
            )}
          </div>
        ) : row.audit_status ? (
          <div className="space-y-0.5">
            <Badge className={cn("text-[10px] whitespace-nowrap", statusColor)}>{row.audit_status}</Badge>
            {row.audit_status === "OTHERS (SPECIFY)" && row.audit_status_other && (
              <p className="text-[10px] text-muted-foreground truncate">{row.audit_status_other}</p>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </TCell>

      {/* 7 · Report Print Date */}
      <TCell className="w-28">
        {editing
          ? <EInput type="date" value={draft.report_print_date} onChange={v => set("report_print_date", v)} />
          : <span className="text-[11px]">{row.report_print_date || "—"}</span>}
      </TCell>

      {/* 8 · Physical Report Received Date */}
      <TCell className="w-28">
        {editing
          ? <EInput type="date" value={draft.physical_report_received_date} onChange={v => set("physical_report_received_date", v)} />
          : <span className="text-[11px]">{row.physical_report_received_date || "—"}</span>}
      </TCell>

      {/* 11 · UDIN Tax Audit (manual entry + one-click NA) */}
      <TCell className="min-w-[150px]">
        {editing
          ? <UdinInput value={draft.udin_tax_audit} onChange={v => handleUdinField("udin_tax_audit", v)} placeholder="UDIN…" />
          : <span className="font-mono text-[11px] truncate block" title={row.udin_tax_audit || ""}>{row.udin_tax_audit || "—"}</span>}
      </TCell>

      {/* 12 · UDIN Statutory Audit (conditional, manual entry + one-click NA) */}
      <TCell className="min-w-[150px]">
        {editing && showUdinStatutoryEdit
          ? <UdinInput value={draft.udin_statutory_audit} onChange={v => handleUdinField("udin_statutory_audit", v)} placeholder="UDIN…" />
          : !editing && showUdinStatutoryView
            ? <span className="font-mono text-[11px] truncate block" title={row.udin_statutory_audit || ""}>{row.udin_statutory_audit || "—"}</span>
            : <span className="text-muted-foreground/40 text-[11px]">—</span>}
      </TCell>

      {/* 13 · UDIN Date */}
      <TCell className="w-28">
        {editing
          ? <EInput type="date" value={draft.udin_date} onChange={v => set("udin_date", v)} />
          : <span className="text-[11px]">{row.udin_date || "—"}</span>}
      </TCell>

      {/* 14 · Scanned */}
      <TCell className="w-20 text-center">
        {editing
          ? <ESelect value={draft.scanned} onChange={v => set("scanned", v)} options={YES_NO} />
          : <Badge className={cn("text-[10px]", row.scanned === "Yes" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
              {row.scanned || "No"}
            </Badge>}
      </TCell>

      {/* 15 · Prepared By — locked to "NA" when tax audit not applicable */}
      <TCell className="min-w-[110px]">
        {!taxAuditApplicable
          ? <span className="text-[11px] text-muted-foreground" title="Tax audit not applicable">NA</span>
          : editing
            ? <UserCombobox value={draft.prepared_by} onChange={v => set("prepared_by", v)} users={users} placeholder="Prepared…" />
            : <span className="text-[11px] truncate block" title={row.prepared_by || ""}>{row.prepared_by || "—"}</span>}
      </TCell>

      {/* 16 · Checked By — locked to "NA" when tax audit not applicable */}
      <TCell className="min-w-[110px]">
        {!taxAuditApplicable
          ? <span className="text-[11px] text-muted-foreground" title="Tax audit not applicable">NA</span>
          : editing
            ? <UserCombobox value={draft.checked_by} onChange={v => set("checked_by", v)} users={users} placeholder="Checked…" />
            : <span className="text-[11px] truncate block" title={row.checked_by || ""}>{row.checked_by || "—"}</span>}
      </TCell>

      {/* 17 · Uploaded By — gated: scanned report + filed form + AI-read date +
          name, confirmed via UploadConfirmDialog. Locked to "NA" when tax
          audit not applicable. */}
      <TCell className="min-w-[130px]">
        {!taxAuditApplicable ? (
          <span className="text-[11px] text-muted-foreground" title="Tax audit not applicable">NA</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (isNew || row.isVirtual) {
                  toast.info("Save this row first (fill in any field), then upload the files.");
                  return;
                }
                setUploadDialogOpen(true);
              }}
              className={cn(
                "inline-flex items-center gap-1 h-6 px-1.5 rounded text-[11px] w-full truncate",
                row.uploaded_by
                  ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                  : "text-muted-foreground border border-dashed border-input hover:bg-muted",
              )}
              title={row.uploaded_by
                ? `Uploaded by ${row.uploaded_by}${row.upload_date ? " on " + row.upload_date : ""} — click to view/replace files`
                : "Upload scanned report + filed form"}
            >
              {row.uploaded_by ? <Paperclip size={11} className="shrink-0" /> : <Upload size={11} className="shrink-0" />}
              <span className="truncate">{row.uploaded_by || "Upload…"}</span>
            </button>
            {uploadDialogOpen && (
              <UploadConfirmDialog
                open={uploadDialogOpen}
                onClose={() => setUploadDialogOpen(false)}
                row={row}
                users={users}
                currentUserId={authUser?.id ?? null}
                currentUserName={authUser?.name ?? authUser?.email ?? null}
                onConfirm={async patch => { await onSave(row.id, patch); }}
                onClear={row.uploaded_by ? async () => { await onSave(row.id, { uploaded_by: null, upload_date: null }); } : undefined}
              />
            )}
          </>
        )}
      </TCell>

      {/* 18 · Remarks — fixed vocabulary + "Others" free text, mirroring the
          Audit Status / audit_status_other pattern above. */}
      <TCell className="min-w-[150px]">
        {editing ? (
          <div className="space-y-1">
            <ESelect value={draft.remarks} onChange={v => set("remarks", v)} options={REMARKS_OPTIONS} placeholder="Remarks…" />
            {draft.remarks === "Others" && (
              <EInput
                value={draft.remarks_other}
                onChange={v => set("remarks_other", v)}
                placeholder="Specify please…"
              />
            )}
          </div>
        ) : (
          <span className="text-muted-foreground line-clamp-2 text-[11px]">
            {row.remarks === "Others" ? (row.remarks_other || "Others") : (row.remarks || "—")}
          </span>
        )}
      </TCell>

      {/* 20 · Actions */}
      <TCell className="w-16 text-center">
        {isNew ? (
          /* New row: explicit Save + Cancel */
          <div className="flex items-center justify-center gap-1">
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
              onClick={commitSave}
              disabled={saving}
              title="Save new row"
            >
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={11} />}
            </Button>
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-50"
              onClick={cancelEdit}
              title="Discard new row"
            >
              <X size={11} />
            </Button>
          </div>
        ) : (
          // Existing rows: autosave indicator + History + Delete (2026-06-25 —
          // autosave). Indicator shows a spinner while a PATCH is in flight, a
          // green tick for ~1.5 s after success, and a red alert icon
          // (click-to-retry) if the retry-once path also failed. Idle rows
          // show nothing so the gutter stays clean.
          <div className="flex items-center justify-center gap-0.5">
            {saveState === "saving" && (
              <span title="Saving…" className="inline-flex items-center justify-center h-6 w-6 text-blue-500">
                <Loader2 size={12} className="animate-spin" />
              </span>
            )}
            {saveState === "saved" && (
              <span title="Saved" className="inline-flex items-center justify-center h-6 w-6 text-emerald-600">
                <Check size={12} />
              </span>
            )}
            {saveState === "error" && (
              <button
                type="button"
                title="Save failed — click to retry"
                onClick={() => flushPending(1)}
                className="inline-flex items-center justify-center h-6 w-6 rounded text-red-600 hover:bg-red-50"
              >
                <AlertCircle size={12} />
              </button>
            )}
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50"
              onClick={() => onHistory?.(row.id)}
              title="View change history"
            >
              <Clock size={12} />
            </Button>
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
              onClick={() => onDelete(row.id)}
              title="Delete row"
            >
              <Trash2 size={12} />
            </Button>
          </div>
        )}
      </TCell>
    </tr>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildDraft(row: StatusEntry, clients: ClientOption[]): RowDraft {
  const entityType = clients.find(c => c.id === row.client_id)?.entity_type ?? null;
  return {
    clientId:                     row.client_id                    || "",
    entityType,
    party_name:                   row.party_name                   || "",
    physical_audit_conducted:     row.physical_audit_conducted     || "No",
    accounting_data:              row.accounting_data              || "No",
    audit_employees:              row.audit_employees              || "",
    audit_report_prepared_by:     row.audit_report_prepared_by     || "",
    audit_report_checked_by:      row.audit_report_checked_by      || "",
    audit_status:                 row.audit_status                 || "",
    audit_status_other:           row.audit_status_other           || "",
    report_print_date:            row.report_print_date            || "",
    firm:                         row.firm                         || "",
    partner:                      row.partner                      || "",
    udin_tax_audit:               row.udin_tax_audit               || "",
    udin_statutory_audit:         row.udin_statutory_audit         || "",
    udin_date:                    row.udin_date                    || "",
    physical_report_received_date:row.physical_report_received_date|| "",
    scanned:                      row.scanned                      || "No",
    prepared_by:                  row.prepared_by                  || "",
    checked_by:                   row.checked_by                   || "",
    uploaded_by:                  row.uploaded_by                  || "",
    upload_date:                  row.upload_date                  || "",
    remarks:                      row.remarks                      || "",
    remarks_other:                row.remarks_other                || "",
  };
}

function draftToPatch(d: RowDraft): StatusPatch {
  return {
    client_id:                    d.clientId || null,
    party_name:                   d.party_name || null,
    physical_audit_conducted:     d.physical_audit_conducted || "No",
    accounting_data:              d.accounting_data || "No",
    audit_employees:              d.audit_employees || null,
    audit_report_prepared_by:     d.audit_report_prepared_by || null,
    audit_report_checked_by:      d.audit_report_checked_by || null,
    audit_status:                 d.audit_status || null,
    audit_status_other:           d.audit_status === "OTHERS" ? (d.audit_status_other || null) : null,
    report_print_date:            d.report_print_date || null,
    firm:                         d.firm || null,
    partner:                      d.partner || null,
    udin_tax_audit:               d.udin_tax_audit || null,
    udin_statutory_audit:         d.udin_statutory_audit || null,
    udin_date:                    d.udin_date || null,
    physical_report_received_date:d.physical_report_received_date || null,
    scanned:                      d.scanned || "No",
    prepared_by:                  d.prepared_by || null,
    checked_by:                   d.checked_by || null,
    uploaded_by:                  d.uploaded_by || null,
    upload_date:                  d.upload_date || null,
    remarks:                      d.remarks || null,
    remarks_other:                d.remarks === "Others" ? (d.remarks_other || null) : null,
  };
}
