/**
 * NCENotesToAccounts — Notes to Accounts for Non-Corporate Entities (NCE)
 * Stage 7 | Non-corporate only | 8 standard notes + custom notes
 * Persists to `notes_to_accounts_data` table.
 *
 * Capabilities:
 *   • Add custom notes          — "Add Note" button / dashed bottom area
 *   • Edit note title inline    — hover pencil icon on title
 *   • Delete any note           — trash icon; built-in notes ask confirmation
 *   • Reorder notes             — ▲ / ▼ arrows on every card
 */
import { useState, useEffect, useCallback, Fragment, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Save, Loader2, CheckSquare, Square, Pencil, Printer,
  FileText, FileDown, ChevronUp, ChevronDown, Trash2, Plus, Check, X,
} from "lucide-react";
import { getAuditYear } from "@/utils/entityUtils";
import ExcelJS from "exceljs";

// ─── Constants ────────────────────────────────────────────────────────────────

const NEW_ENTITY_TEMPLATE =
  `The assessee is a [ENTITY_TYPE] and commenced business in the current financial year. The firm was established on [DATE_OF_INCORPORATION] vide [REGISTERED_DOCUMENT_NAME - DOCUMENT_NUMBER], hence the previous year figures have not been shown in the report. (This para only for a New Entity)`;

const NOTE3_VARIANTS: Record<string, string> = {
  none: "",
  service:
    "The assessee is a professional firm of cost accountants, valuation of stock etc. is not applicable. (This para only for a Service Provider)",
  transporter:
    "The nature of business of the assessee is transportation and does not deal in any material, value and quantitative details of closing stock etc. are not applicable. (This para only for a Transporter)",
  share:
    "Assessee doing share and derivative business, accounts are prepared on the basis of statement issued by broker. We have verified entries of profit or loss on future option transactions, intraday profit or loss and short or long term investments in shares were accounted on the basis of summary provided by broker. (This para only for a Share Trading Entity/Individual)",
  other:
    "The value and quantity of stock are taken as certified by the partner. The method of valuation of closing stock is at cost or market value whichever is less. (This para only for Other)",
  contractor:
    "Assessee being Contractor, revenue was recognised based on RA bill issued and work completed partly which was unbilled as on 31.03.[YEAR] was accounted as Construction work in progress on the basis of percentage of work completed considering margin of estimated profit. This being the technical matter, construction work in progress credited in Construction A/c. was taken as certified by the proprietor. (This para only for a contract based Entity)",
  builder:
    "Assessee being a builder and developer, revenue was recognised on the basis of Sale deed executed plus sales under construction offered based on cost incurred and advance received from customers under percentage of completion Method on estimation basis. Construction work completed at the end of the year after revenue recognition was transferred to work in progress. This being the technical matter, construction work in progress credited in the books of A/c. was taken as certified by the partner. (This para only for a builder and developer)",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface NCENote {
  id: string;
  label: string;
  title: string;
  selected: boolean;
  text: string;
  isCustom?: boolean;
}

// ─── Template builder ─────────────────────────────────────────────────────────

function buildNotesTemplate(auditYear: string): NCENote[] {
  return [
    {
      id: "note-1", label: "Note 1", title: "Balance Confirmation", selected: true,
      text: "All debit and credit balances and accounts squared up during the year are subject to confirmation from respective parties.",
    },
    {
      id: "note-2", label: "Note 2", title: "Rearrangement of Figures", selected: true,
      text: "The figures are rearranged/regrouped wherever considered necessary and rounded off to the nearest rupee.",
    },
    {
      id: "note-3", label: "Note 3", title: "Cash Balance & Closing Stock", selected: true,
      text: `Cash balance on hand was Rs. [CASH_AMOUNT]/- and value of Closing Stock Rs. [CLOSING_STOCK]/- as at 31st March, ${auditYear} are taken as certified by proprietor.`,
    },
    {
      id: "note-4", label: "Note 4", title: "Current Assets Valuation", selected: true,
      text: "In opinion of assessee, current assets, loans & advances are approximately of the value at which these are stated in the balance sheet.",
    },
    {
      id: "note-5", label: "Note 5", title: "Fixed Assets", selected: true,
      text: "Fixed Assets are stated at Cost less depreciation as shown in Note- [FA_NOTE]. Details of rate and amount of Depreciation claimed has been stated in Note-[DEP_NOTE].",
    },
    {
      id: "note-6", label: "Note 6", title: "Reliance on Vouchers", selected: true,
      text: "Whenever the supporting proof for the entries made in the books of accounts are not available for the purpose of audit, we are relied on the vouchers prepared and authenticated by the partner.",
    },
    {
      id: "note-7", label: "Note 7", title: "Loans via Cheque/DD/ECS", selected: true,
      text: "As informed by the partner, the amount of loan or deposits or specified sums taken or accepted or repaid by the assessee through a/c. payee cheque/demand draft or ECS only. However, it is not possible for us to verify the same as necessary evidence are not in possession of the assessee.",
    },
    {
      id: "note-8", label: "Note 8", title: "Notes form Part of Accounts", selected: true,
      text: `Notes No. 1 to [LAST_NOTE] forms part of accounts for the year ended on 31st March, ${auditYear}.`,
    },
  ];
}

// ─── Inline token renderer ────────────────────────────────────────────────────

function InlineNoteText({
  text, tokenMap, disabled,
}: {
  text: string;
  tokenMap: Record<string, ReactNode>;
  disabled: boolean;
}) {
  const TOKEN_RE = /\[(CASH_AMOUNT|CLOSING_STOCK|FA_NOTE|DEP_NOTE|LAST_NOTE)\]/g;
  const parts: Array<{ kind: "text" | "token"; value: string }> = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ kind: "text", value: text.slice(lastIdx, m.index) });
    parts.push({ kind: "token", value: m[1] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push({ kind: "text", value: text.slice(lastIdx) });

  return (
    <span className={`text-sm leading-relaxed ${disabled ? "opacity-60" : ""}`}>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <Fragment key={i}>{p.value}</Fragment>
        ) : (
          <Fragment key={i}>
            {tokenMap[p.value] ?? (
              <span className="text-orange-500 bg-orange-50 px-1 rounded">[{p.value}]</span>
            )}
          </Fragment>
        )
      )}
    </span>
  );
}

function OrangePlaceholderPreview({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <div className="text-sm leading-relaxed rounded bg-muted/40 px-3 py-2 whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.startsWith("[") && p.endsWith("]") ? (
          <span key={i} className="text-orange-500 bg-orange-50 px-1 rounded font-medium">{p}</span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        )
      )}
    </div>
  );
}

// ─── EditTextExpander ─────────────────────────────────────────────────────────

function EditTextExpander({
  text, onChange, disabled,
}: { text: string; onChange: (t: string) => void; disabled: boolean }) {
  return (
    <details className="group">
      <summary className="flex items-center gap-1 cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none w-fit">
        <Pencil className="w-3 h-3" /> Edit note text
      </summary>
      <div className="mt-2">
        <Textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="text-sm resize-y font-mono"
          disabled={disabled}
        />
      </div>
    </details>
  );
}

// ─── NoteCard component ───────────────────────────────────────────────────────

interface NoteCardProps {
  note: NCENote;
  displayNumber: number;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onEditTitle: (title: string) => void;
  mainContent: ReactNode;
  badge?: ReactNode;
}

function NoteCard({
  note, displayNumber, isFirst, isLast,
  onToggle, onMoveUp, onMoveDown, onDelete, onEditTitle,
  mainContent, badge,
}: NoteCardProps) {
  const [editingTitle, setEditingTitle]   = useState(false);
  const [titleDraft, setTitleDraft]       = useState(note.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Keep draft in sync if parent updates title (e.g. on load)
  useEffect(() => { setTitleDraft(note.title); }, [note.title]);

  const commitTitle = () => {
    const v = titleDraft.trim();
    if (v) onEditTitle(v);
    else setTitleDraft(note.title);
    setEditingTitle(false);
  };

  const handleDeleteClick = () => {
    if (note.isCustom) {
      onDelete();
    } else if (confirmDelete) {
      onDelete();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      // Auto-dismiss after 3 s
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* ── Header row ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-card select-none">

        {/* Checkbox */}
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={note.selected}
            onCheckedChange={onToggle}
            id={`nce-${note.id}`}
          />
        </span>

        {/* "Note N" number — clicking toggles selection */}
        <Label
          htmlFor={`nce-${note.id}`}
          className="cursor-pointer font-semibold text-sm w-14 shrink-0"
          onClick={onToggle}
        >
          Note {displayNumber}
        </Label>

        {/* Editable title */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")  commitTitle();
                  if (e.key === "Escape") { setTitleDraft(note.title); setEditingTitle(false); }
                }}
                className="h-6 text-xs py-0 flex-1 max-w-[200px]"
                autoFocus
              />
              <button
                onClick={commitTitle}
                className="p-0.5 text-green-600 hover:text-green-700"
                title="Confirm"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setTitleDraft(note.title); setEditingTitle(false); }}
                className="p-0.5 text-muted-foreground hover:text-foreground"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 group/title min-w-0">
              <span className="text-xs text-muted-foreground truncate">{note.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTitle(true);
                  setTitleDraft(note.title);
                }}
                className="opacity-0 group-hover/title:opacity-100 p-0.5 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
                title="Edit title"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {badge}

        {!note.selected && (
          <Badge variant="outline" className="ml-1 text-xs text-muted-foreground shrink-0">
            Excluded
          </Badge>
        )}

        {/* ── Reorder + Delete controls ── */}
        <div
          className="flex items-center gap-0.5 ml-auto shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            title="Move up"
            className="p-1 rounded hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            title="Move down"
            className="p-1 rounded hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {/* Delete — built-in notes require 1-tap confirmation */}
          {confirmDelete ? (
            <div className="flex items-center gap-0.5 ml-1.5 pl-1.5 border-l border-border">
              <span className="text-xs text-red-500 font-medium">Delete?</span>
              <button
                onClick={handleDeleteClick}
                title="Confirm delete"
                className="p-1 rounded hover:bg-red-50 text-red-600 hover:text-red-700"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                title="Cancel"
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleDeleteClick}
              title={note.isCustom ? "Delete note" : "Delete (will ask confirmation)"}
              className="p-1 ml-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Body — dims when excluded ── */}
      <div
        className={`px-4 pb-4 pt-2 space-y-3 transition-opacity ${
          !note.selected ? "opacity-40 pointer-events-none" : ""
        }`}
      >
        {mainContent}
      </div>
    </div>
  );
}

// ─── Main component interfaces ────────────────────────────────────────────────

interface SigData {
  assesseeNameOverride: string;
  assesseePlace: string;
  assesseeDate: string;
  partnerNameOverride: string;
  sigDate: string;
}

interface HeaderOverrides {
  entityNameOverride: string;
  cashAmount: string;
  closingStock: string;
  faNoteNum: string;
  depNoteNum: string;
  lastNoteOverride: string;
  note3VariantText: string;
}

function emptyHeader(): HeaderOverrides {
  return {
    entityNameOverride: "", cashAmount: "", closingStock: "",
    faNoteNum: "", depNoteNum: "", lastNoteOverride: "", note3VariantText: "",
  };
}

function emptySig(): SigData {
  const today = new Date().toISOString().slice(0, 10);
  return { assesseeNameOverride: "", assesseePlace: "", assesseeDate: today, partnerNameOverride: "", sigDate: today };
}

interface Props {
  engagementId: string;
  engagement: any;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NCENotesToAccounts({ engagementId, engagement }: Props) {
  const { user } = useAuth();
  const contentRef = useRef<HTMLDivElement>(null);

  const fy: string = engagement?.financial_year ?? "";
  const auditYear = getAuditYear(fy);

  // ── State ──
  const [notes, setNotes]               = useState<NCENote[]>(() => buildNotesTemplate(auditYear));
  const [header, setHeader]             = useState<HeaderOverrides>(emptyHeader);
  const [sig, setSig]                   = useState<SigData>(emptySig);
  const [note1NewEntity, setNote1NewEntity]         = useState(false);
  const [note1NewEntityText, setNote1NewEntityText] = useState("");
  const [note3Variant, setNote3Variant] = useState("none");

  const [clientDetails, setClientDetails]   = useState<any>(null);
  const [firmDetails, setFirmDetails]       = useState<any>(null);
  const [partnerDetails, setPartnerDetails] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  // Auto-count selected notes for LAST_NOTE token
  const [lastNote, setLastNote] = useState(8);
  useEffect(() => {
    setLastNote(notes.filter((n) => n.selected).length);
  }, [notes]);
  const displayLastNote = header.lastNoteOverride || String(lastNote);

  // ── Remote data fetches ──
  useEffect(() => {
    if (!engagement?.client_id) return;
    supabase
      .from("clients")
      .select("name, entity_type, cin, date_of_incorporation, registered_office, registered_state, address")
      .eq("id", engagement.client_id)
      .single()
      .then(({ data }) => { if (data) setClientDetails(data); });
  }, [engagement?.client_id]);

  useEffect(() => {
    if (!engagement?.firm_id) return;
    supabase
      .from("firms")
      .select("name, display_name, icai_firm_reg_no, icai_reg_no, address, state, membership_numbers")
      .eq("id", engagement.firm_id)
      .single()
      .then(({ data }) => { if (data) setFirmDetails(data); });
  }, [engagement?.firm_id]);

  useEffect(() => {
    if (!engagement?.partner_id) return;
    supabase
      .from("users")
      .select("name, icai_reg_no")
      .eq("id", engagement.partner_id)
      .single()
      .then(({ data }) => { if (data) setPartnerDetails(data); });
  }, [engagement?.partner_id]);

  // ── Load saved data ──
  const loadData = useCallback(async () => {
    // Skip the query when no engagement is selected (e.g. user opened Stage 7
    // via the sidebar without picking an engagement first). Otherwise Supabase
    // throws "invalid input syntax for type uuid: \"\"".
    if (!engagementId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("notes_to_accounts_data")
      .select("*")
      .eq("engagement_id", engagementId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      toast.error("Failed to load notes: " + error.message);
    }

    if (data) {
      if (data.notes_json?.length) {
        const templateMap = new Map(buildNotesTemplate(auditYear).map((n) => [n.id, n]));
        const loaded: NCENote[] = (data.notes_json as any[]).map((r: any) => {
          const tmpl = templateMap.get(r.id);
          if (tmpl) {
            // Built-in note — merge saved overrides into template
            return {
              ...tmpl,
              selected: r.selected ?? tmpl.selected,
              text:     r.text     ?? tmpl.text,
              title:    r.title    ?? tmpl.title,
            };
          }
          // Custom note — restore from saved data
          return {
            id:       r.id,
            label:    r.label    ?? "Custom",
            title:    r.title    ?? "Custom Note",
            selected: r.selected ?? true,
            text:     r.text     ?? "",
            isCustom: true,
          };
        });
        setNotes(loaded);
      }
      if (data.note3_variant)           setNote3Variant(data.note3_variant);
      setNote1NewEntity(data.note1_new_entity_enabled ?? false);
      setNote1NewEntityText(data.note1_new_entity_text ?? "");
      if (data.header_overrides)        setHeader((prev) => ({ ...prev, ...data.header_overrides }));
      if (data.signature_data)          setSig((prev)    => ({ ...prev, ...data.signature_data }));
    }
    setLoading(false);
  }, [engagementId, auditYear]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Note 1 — build new-entity text on first toggle ──
  useEffect(() => {
    if (!note1NewEntity || note1NewEntityText) return;
    const et  = clientDetails?.entity_type || null;
    const doi = clientDetails?.date_of_incorporation
      ? new Date(clientDetails.date_of_incorporation).toLocaleDateString("en-IN", {
          day: "2-digit", month: "2-digit", year: "numeric",
        })
      : null;
    let text = NEW_ENTITY_TEMPLATE;
    if (et)  text = text.replace("[ENTITY_TYPE]", et);
    if (doi) text = text.replace("[DATE_OF_INCORPORATION]", doi);
    setNote1NewEntityText(text);
  }, [note1NewEntity, note1NewEntityText, clientDetails]);

  // ── Note manipulators ──
  const toggleNote      = (id: string) => setNotes((p) => p.map((n) => n.id === id ? { ...n, selected: !n.selected } : n));
  const updateNoteText  = (id: string, text: string) => setNotes((p) => p.map((n) => n.id === id ? { ...n, text } : n));
  const updateNoteTitle = (id: string, title: string) => setNotes((p) => p.map((n) => n.id === id ? { ...n, title } : n));
  const selectAll       = () => setNotes((p) => p.map((n) => ({ ...n, selected: true })));
  const deselectAll     = () => setNotes((p) => p.map((n) => ({ ...n, selected: false })));

  const moveNoteUp = (id: string) => setNotes((p) => {
    const idx = p.findIndex((n) => n.id === id);
    if (idx <= 0) return p;
    const next = [...p];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    return next;
  });

  const moveNoteDown = (id: string) => setNotes((p) => {
    const idx = p.findIndex((n) => n.id === id);
    if (idx >= p.length - 1) return p;
    const next = [...p];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    return next;
  });

  const deleteNote = (id: string) => setNotes((p) => p.filter((n) => n.id !== id));

  const addNote = () => {
    const newNote: NCENote = {
      id:       `custom-${Date.now()}`,
      label:    `Note ${notes.length + 1}`,
      title:    "Custom Note",
      selected: true,
      text:     "",
      isCustom: true,
    };
    setNotes((p) => [...p, newNote]);
  };

  const setH = <K extends keyof HeaderOverrides>(k: K, v: HeaderOverrides[K]) =>
    setHeader((p) => ({ ...p, [k]: v }));
  const setS = <K extends keyof SigData>(k: K, v: SigData[K]) =>
    setSig((p) => ({ ...p, [k]: v }));

  const handleVariantChange = (variant: string) => {
    setNote3Variant(variant);
    setH("note3VariantText", (NOTE3_VARIANTS[variant] ?? "").replace(/\[YEAR\]/g, auditYear));
  };

  // ── Save ──
  const saveAll = async () => {
    setSaving(true);
    const notesJson = notes.map((n) => ({
      id:       n.id,
      selected: n.selected,
      text:     n.text,
      title:    n.title,
      label:    n.label,
      isCustom: n.isCustom ?? false,
    }));
    const { error } = await (supabase as any)
      .from("notes_to_accounts_data")
      .upsert(
        {
          engagement_id:             engagementId,
          notes_json:                notesJson,
          note3_variant:             note3Variant,
          note1_new_entity_enabled:  note1NewEntity,
          note1_new_entity_text:     note1NewEntityText || null,
          header_overrides:          header,
          signature_data:            sig,
          updated_at:                new Date().toISOString(),
          updated_by:                user?.id ?? null,
        },
        { onConflict: "engagement_id" }
      );
    setSaving(false);
    if (error) toast.error("Failed to save: " + error.message);
    else       toast.success("Notes to Accounts saved");
  };

  // ── Display helpers ──
  const displayEntityName =
    header.entityNameOverride ||
    clientDetails?.name ||
    engagement?.clients?.name ||
    "[ENTITY NAME]";
  const firmName         = firmDetails?.display_name || firmDetails?.name || "[Firm Name]";
  const firmFRN          = firmDetails?.icai_firm_reg_no || firmDetails?.icai_reg_no || "[FRN]";
  const firmAddr         = firmDetails?.address as any;
  const firmCity         = firmAddr?.city || firmAddr?.district || firmDetails?.state || "[City]";
  // partnerDetails is loaded async from users table; fall back to engagement.partner_name
  // which is always stored at engagement-creation time (no async required).
  const partnerAutoName   = partnerDetails?.name || engagement?.partner_name || "";
  // Membership number: look up from firms.membership_numbers JSON (same source as
  // the partner dropdown in Engagement Setup → Settings → Audit Registration).
  const firmMembershipNos = (firmDetails?.membership_numbers as any[]) || [];
  const partnerFromFirm   = firmMembershipNos.find(
    (m: any) => m?.partner_name === (engagement?.partner_name || partnerDetails?.name)
  );
  const partnerMembership =
    partnerFromFirm?.membership_no || partnerDetails?.icai_reg_no || "[Membership No.]";
  const assesseePlace    = sig.assesseePlace || clientDetails?.registered_state || "[Place]";
  const selectedCount    = notes.filter((n) => n.selected).length;

  const handleExportExcel = async () => {
    const fySlug   = (engagement?.financial_year ?? "FY").replace("/", "-");
    const nameSlug = displayEntityName.replace(/\s+/g, "_").slice(0, 30);

    // Resolve inline tokens in each note's text with live header overrides
    const resolveTokens = (text: string): string =>
      (text || "")
        .replace(/\[CASH_AMOUNT\]/g,   header.cashAmount   || "")
        .replace(/\[CLOSING_STOCK\]/g, header.closingStock || "")
        .replace(/\[FA_NOTE\]/g,       header.faNoteNum    || "")
        .replace(/\[DEP_NOTE\]/g,      header.depNoteNum   || "")
        .replace(/\[LAST_NOTE\]/g,     header.lastNoteOverride || String(lastNote));

    const wb = new ExcelJS.Workbook();
    wb.creator = "CAFlow";
    wb.created = new Date();

    const ws = wb.addWorksheet("Notes to Accounts", {
      views: [{ showGridLines: false }],
    });

    // ── Column widths exactly matching NOTE 1.xlsx template ──────────────────
    // A=spacer | B=note-no | C=small | D-H=note content (H wide) | I=right | J-K=spacers
    ws.columns = [
      { width: 2.3  },  // A  (1)  narrow left spacer
      { width: 5.6  },  // B  (2)  note number / sig label
      { width: 2.1  },  // C  (3)  small separator / assessee sig start
      { width: 11.6 },  // D  (4)  note content
      { width: 10.7 },  // E  (5)  note content
      { width: 6.6  },  // F  (6)  note content
      { width: 12.3 },  // G  (7)  note content
      { width: 29.1 },  // H  (8)  note content / CA firm sig (wide column)
      { width: 7.9  },  // I  (9)  year / right side
      { width: 3.7  },  // J  (10) right spacer
      { width: 3.3  },  // K  (11) narrow right spacer
    ];

    // Helper: apply a thin box border on every cell from startCol to endCol in
    // the given row BEFORE calling mergeCells().
    // IMPORTANT: must use ws.getRow(r).getCell(colNumber) — NOT ws.getCell("B2")
    // — because ExcelJS stores and serialises cells from the row's internal
    // _cells map; the string-address accessor uses a separate cache that gets
    // dropped when the merge is recorded.  Column numbers: A=1, B=2, C=3, D=4.
    const preMergeBorder = (row: number, startCol: number, endCol: number) => {
      const s = "thin" as const;
      const b = { top: { style: s }, bottom: { style: s }, left: { style: s }, right: { style: s } };
      for (let c = startCol; c <= endCol; c++) {
        ws.getRow(row).getCell(c).border = b;
      }
    };

    let r = 2;

    // ── Row 2 — Entity name (B:D merged, centered, bold 13pt) ───────────────
    preMergeBorder(r, 2, 4);          // set borders BEFORE merge (B=2, C=3, D=4)
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value     = header.entityNameOverride || displayEntityName;
    ws.getCell(`B${r}`).font      = { bold: true, size: 13 };
    ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(r).height = 21;
    r++;

    // ── Row 3 — "Notes forming part of..." (B:D merged, centered, bold 11pt) ─
    preMergeBorder(r, 2, 4);
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value     = `Notes forming part of the Financial Statements for the year ended 31st March, ${auditYear}`;
    ws.getCell(`B${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(r).height = 18;
    r++;

    // ── Row 4 — "Note :" | "Summary of Significant Accounting Policies" ──────
    // Two bordered sections matching the reference: B = "Note :", C:D = title.
    // Set borders on B, C, D BEFORE merging C:D so D's right edge is preserved.
    preMergeBorder(r, 2, 4);
    // B4 — "Note :" label (no merge; borders already set)
    ws.getCell(`B${r}`).value     = "Note :";
    ws.getCell(`B${r}`).font      = { bold: false, size: 11 };
    ws.getCell(`B${r}`).alignment = { horizontal: "left", vertical: "middle" };
    // C4:D4 — title text (merge C:D; C is master and retains its borders)
    ws.mergeCells(`C${r}:D${r}`);
    ws.getCell(`C${r}`).value     = "Summary of Significant Accounting Policies";
    ws.getCell(`C${r}`).font      = { bold: false, size: 11 };
    ws.getCell(`C${r}`).alignment = { horizontal: "left", vertical: "middle" };
    ws.getRow(r).height = 18;
    r += 2;

    // ── Border helpers — matching NOTE 1.xlsx template EXACTLY ──────────────
    //
    // Each header row (2–5) gets an outer box: top + bottom across the full
    // B–J band, left edge on B, right edge on J.
    //
    // The trick: ExcelJS only allows setting border properties on the MASTER
    // cell of a merged range (setting them on slave cells silently fails or
    // throws). Each row has a different merge layout, so we handle them
    // individually:
    //
    //   Row 2:  B2:J2 fully merged → B is master.
    //           Set B { top, bottom, left, RIGHT } — right on master = right edge of J.
    //
    //   Row 3:  B3:H3 merged + I3 standalone + J3 standalone.
    //           B { top, bottom, left }, I { top, bottom }, J { top, bottom, RIGHT }.
    //
    //   Row 4:  B4:J4 fully merged → same as row 2.
    //
    //   Row 5:  B5 standalone + C5 standalone + D5:J5 merged → D is master.
    //           B { top, bottom, left }, C { top, bottom },
    //           D { top, bottom, RIGHT } — right on master D = right edge of J.
    //
    //   Row 6:  No merges. B { left }, J { right } (separator, no top/bottom).

    const hdrBorder = (rn: number) => {
      const row = ws.getRow(rn);
      if (rn === 2 || rn === 4) {
        // B:J fully merged — B is master; .right on master renders at J's right edge
        row.getCell(2).border = { top: thin, bottom: thin, left: thin, right: thin };
      } else if (rn === 3) {
        // B:H merged + I standalone + J standalone
        row.getCell(2).border  = { top: thin, bottom: thin, left: thin };   // B (master B–H)
        row.getCell(9).border  = { top: thin, bottom: thin };               // I standalone
        row.getCell(10).border = { top: thin, bottom: thin, right: thin };  // J standalone
      } else if (rn === 5) {
        // B standalone + C standalone + D:J merged — D is master
        row.getCell(2).border = { top: thin, bottom: thin, left: thin };    // B
        row.getCell(3).border = { top: thin, bottom: thin };                // C
        row.getCell(4).border = { top: thin, bottom: thin, right: thin };   // D (master D–J); .right → J's right edge
      }
    };

    // Separator row (row 6): only left (B) and right (J) side lines, no top/bottom.
    // Row 6 has no merges so getCell(10) is always a standalone cell.
    const sepBorder = (rn: number) => {
      ws.getRow(rn).getCell(2).border  = { left:  thin };  // B
      ws.getRow(rn).getCell(10).border = { right: thin };  // J
    };

    // ── Row 1: intentionally NO borders (matches template) ───────────────────
    let r = 1;
    r++;

    // ── Row 2: Entity name — B2:J2 merged, bold sz11, center, v:middle ───────
    ws.mergeCells(`B${r}:J${r}`);
    ws.getCell(`B${r}`).value     = header.entityNameOverride || displayEntityName;
    ws.getCell(`B${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
    hdrBorder(r);
    r++;

    // ── Row 3: Notes heading — B3:H3 merged; I3 = year ───────────────────────
    ws.mergeCells(`B${r}:H${r}`);
    ws.getCell(`B${r}`).value     = `Notes forming part of the Financial Statements  for the year ended, 31st March, `;
    ws.getCell(`B${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    ws.getCell(`I${r}`).value     = auditYear;
    ws.getCell(`I${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`I${r}`).alignment = { vertical: "middle" };
    hdrBorder(r);
    r++;

    // ── Row 4: blank row — B4:J4 merged ──────────────────────────────────────
    ws.mergeCells(`B${r}:J${r}`);
    ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "top" };
    hdrBorder(r);
    r++;

    // ── Row 5: "Note :" + summary title — B5 standalone, D5:J5 merged ────────
    ws.getCell(`B${r}`).value     = "Note :";
    ws.getCell(`B${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`B${r}`).alignment = { vertical: "middle" };
    ws.getCell(`C${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`C${r}`).alignment = { horizontal: "left", vertical: "middle" };
    ws.mergeCells(`D${r}:J${r}`);
    ws.getCell(`D${r}`).value     = "Summary of Significant accounting policies";
    ws.getCell(`D${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`D${r}`).alignment = { horizontal: "left", vertical: "middle" };
    hdrBorder(r);
    r++;

    // ── Row 6: blank separator — only left (B) and right (J) side lines ──────
    sepBorder(r);
    r++;

    // ── Notes rows (starting at r = 7) ────────────────────────────────────────
    // NO borders on note rows — matches template exactly
    const selectedNotes = notes.filter(n => n.selected);
    selectedNotes.forEach((note, idx) => {
      const num = idx + 1;
      let body  = resolveTokens(note.text);

      if (note.id === "note-1" && note1NewEntity && note1NewEntityText) {
        body += "\n\n" + resolveTokens(note1NewEntityText);
      }
      if (note.id === "note-3" && note3Variant !== "none" && header.note3VariantText) {
        body += "\n\n" + resolveTokens(header.note3VariantText);
      }

      // Content row: B:C merged = number, D:J merged = text — NO borders
      ws.mergeCells(`B${r}:C${r}`);
      ws.getCell(`B${r}`).value     = num;
      ws.getCell(`B${r}`).font      = { size: 11 };
      ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "top", wrapText: true };
      ws.mergeCells(`D${r}:J${r}`);
      ws.getCell(`D${r}`).value     = body;
      ws.getCell(`D${r}`).font      = { size: 11 };
      ws.getCell(`D${r}`).alignment = { horizontal: "justify", vertical: "top", wrapText: true };
      const lines = Math.max(1, Math.ceil(body.length / 90) + (body.match(/\n/g)?.length ?? 0));
      ws.getRow(r).height = Math.max(18, lines * 15);
      r++;

      // Blank continuation row — NO borders
      ws.mergeCells(`B${r}:C${r}`);
      ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "top" };
      ws.mergeCells(`D${r}:J${r}`);
      ws.getCell(`D${r}`).alignment = { horizontal: "justify", vertical: "top" };
      r++;
    });

    // ── Blank separator row before signature — NO borders (matches template) ──
    r++;

    // ── Signature block — NO borders (matches template) ──────────────────────
    // Left side : C:E merged (cols 3–5) = assessee name / sig / place / date
    // Right side: H:I merged (cols 8–9) = CA firm name / partner / membership
    const assesseeName   = sig.assesseeNameOverride || displayEntityName;
    const partnerDisplay = sig.partnerNameOverride  || partnerAutoName   || "[Partner Name]";

    // "For, [Assessee]"  |  "For [Firm]"
    ws.mergeCells(`C${r}:E${r}`);
    ws.getCell(`C${r}`).value     = `For, ${assesseeName}`;
    ws.getCell(`C${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`C${r}`).alignment = { vertical: "top", wrapText: true };
    ws.mergeCells(`H${r}:I${r}`);
    ws.getCell(`H${r}`).value     = `For ${firmName}`;
    ws.getCell(`H${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`H${r}`).alignment = { horizontal: "right", vertical: "top", wrapText: true };
    r++;

    // "Chartered Accountants"
    ws.mergeCells(`C${r}:E${r}`);
    ws.mergeCells(`H${r}:I${r}`);
    ws.getCell(`H${r}`).value     = "Chartered Accountants";
    ws.getCell(`H${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`H${r}`).alignment = { horizontal: "right", vertical: "top", wrapText: true };
    r++;

    // "FRN: ______"
    ws.mergeCells(`C${r}:E${r}`);
    ws.mergeCells(`H${r}:I${r}`);
    ws.getCell(`H${r}`).value     = `FRN: ${firmFRN}`;
    ws.getCell(`H${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`H${r}`).alignment = { horizontal: "right", vertical: "top", wrapText: true };
    r++;

    // "x__________________"
    ws.mergeCells(`C${r}:E${r}`);
    ws.getCell(`C${r}`).value     = "x__________________";
    ws.getCell(`C${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`C${r}`).alignment = { vertical: "top", wrapText: true };
    ws.mergeCells(`H${r}:I${r}`);
    r++;

    // "Signature of assessee"
    ws.mergeCells(`C${r}:E${r}`);
    ws.getCell(`C${r}`).value     = "Signature of assessee";
    ws.getCell(`C${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`C${r}`).alignment = { vertical: "top", wrapText: true };
    ws.mergeCells(`H${r}:I${r}`);
    r++;

    // "[Partner Name]"
    ws.mergeCells(`C${r}:E${r}`);
    ws.mergeCells(`H${r}:I${r}`);
    ws.getCell(`H${r}`).value     = partnerDisplay;
    ws.getCell(`H${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`H${r}`).alignment = { horizontal: "right", vertical: "top", wrapText: true };
    r++;

    // "Place:" + "Partner"
    ws.mergeCells(`C${r}:E${r}`);
    ws.getCell(`C${r}`).value     = `Place: ${assesseePlace}`;
    ws.getCell(`C${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`C${r}`).alignment = { vertical: "top", wrapText: true };
    ws.mergeCells(`H${r}:I${r}`);
    ws.getCell(`H${r}`).value     = "Partner";
    ws.getCell(`H${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`H${r}`).alignment = { horizontal: "right", vertical: "top", wrapText: true };
    r++;

    // "Date:" + "Membership No."
    ws.mergeCells(`C${r}:E${r}`);
    ws.getCell(`C${r}`).value     = `Date : ${sig.assesseeDate || ""}`;
    ws.getCell(`C${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`C${r}`).alignment = { vertical: "top", wrapText: true };
    ws.mergeCells(`H${r}:I${r}`);
    ws.getCell(`H${r}`).value     = `Membership No.: ${partnerMembership}`;
    ws.getCell(`H${r}`).font      = { bold: true, size: 11 };
    ws.getCell(`H${r}`).alignment = { horizontal: "right", vertical: "top", wrapText: true };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href    = url;
    a.download = `Notes_${nameSlug}_${fySlug}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Notes to Accounts exported to Excel");
  };

  // ── Per-note main content (special rendering by id, generic otherwise) ──
  const getMainContent = (note: NCENote): ReactNode => {
    switch (note.id) {

      case "note-1":
        return (
          <div className="space-y-3">
            <p className="text-sm">{note.text}</p>
            <div className="flex items-center gap-3 pt-1">
              <Switch
                id="note1-new-entity"
                checked={note1NewEntity}
                onCheckedChange={(v) => { setNote1NewEntity(v); if (!v) setNote1NewEntityText(""); }}
                disabled={!note.selected}
              />
              <Label htmlFor="note1-new-entity" className="text-xs cursor-pointer">
                New Entity — Add new entity paragraph
              </Label>
            </div>
            {note1NewEntity && (
              <div className="space-y-2 pl-2 border-l-2 border-orange-300">
                <OrangePlaceholderPreview text={note1NewEntityText || NEW_ENTITY_TEMPLATE} />
                <details className="group">
                  <summary className="flex items-center gap-1 cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none w-fit">
                    <Pencil className="w-3 h-3" /> Edit paragraph
                  </summary>
                  <div className="mt-2">
                    <Textarea
                      value={note1NewEntityText}
                      onChange={(e) => setNote1NewEntityText(e.target.value)}
                      rows={5}
                      className="text-sm resize-y"
                    />
                  </div>
                </details>
              </div>
            )}
            <EditTextExpander text={note.text} onChange={(t) => updateNoteText("note-1", t)} disabled={!note.selected} />
          </div>
        );

      case "note-3":
        return (
          <div className="space-y-3">
            <div className="rounded bg-muted/40 px-3 py-2">
              <InlineNoteText
                text={note.text}
                disabled={!note.selected}
                tokenMap={{
                  CASH_AMOUNT: (
                    <span onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={header.cashAmount}
                        onChange={(e) => setH("cashAmount", e.target.value)}
                        disabled={!note.selected}
                        placeholder="Amount"
                        className="text-orange-600 bg-orange-50 border-b-2 border-orange-400 w-24 text-center px-1 mx-0.5 focus:outline-none focus:border-orange-600 text-sm font-medium disabled:opacity-40"
                      />
                    </span>
                  ),
                  CLOSING_STOCK: (
                    <span onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={header.closingStock}
                        onChange={(e) => setH("closingStock", e.target.value)}
                        disabled={!note.selected}
                        placeholder="Amount"
                        className="text-orange-600 bg-orange-50 border-b-2 border-orange-400 w-24 text-center px-1 mx-0.5 focus:outline-none focus:border-orange-600 text-sm font-medium disabled:opacity-40"
                      />
                    </span>
                  ),
                }}
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs shrink-0 w-52">Business Type — additional paragraph:</Label>
              <Select value={note3Variant} onValueChange={handleVariantChange} disabled={!note.selected}>
                <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="service">Service Provider</SelectItem>
                  <SelectItem value="transporter">Transporter</SelectItem>
                  <SelectItem value="share">Share Trading</SelectItem>
                  <SelectItem value="other">Other (stock by partner)</SelectItem>
                  <SelectItem value="contractor">Contractor (RA Bill/WIP)</SelectItem>
                  <SelectItem value="builder">Builder / Developer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {note3Variant !== "none" && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Additional paragraph (editable):</Label>
                <Textarea
                  value={header.note3VariantText}
                  onChange={(e) => setH("note3VariantText", e.target.value)}
                  rows={4}
                  className="text-sm resize-y"
                  disabled={!note.selected}
                />
              </div>
            )}
            <EditTextExpander text={note.text} onChange={(t) => updateNoteText("note-3", t)} disabled={!note.selected} />
          </div>
        );

      case "note-5":
        return (
          <div className="space-y-2">
            <div className="rounded bg-muted/40 px-3 py-2">
              <InlineNoteText
                text={note.text}
                disabled={!note.selected}
                tokenMap={{
                  FA_NOTE: (
                    <span onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={header.faNoteNum}
                        onChange={(e) => setH("faNoteNum", e.target.value)}
                        disabled={!note.selected}
                        placeholder="#"
                        className="text-orange-600 bg-orange-50 border-2 border-orange-400 rounded w-10 text-center px-1 mx-0.5 focus:outline-none focus:border-orange-600 text-sm font-medium disabled:opacity-40"
                        maxLength={3}
                      />
                    </span>
                  ),
                  DEP_NOTE: (
                    <span onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={header.depNoteNum}
                        onChange={(e) => setH("depNoteNum", e.target.value)}
                        disabled={!note.selected}
                        placeholder="#"
                        className="text-orange-600 bg-orange-50 border-2 border-orange-400 rounded w-10 text-center px-1 mx-0.5 focus:outline-none focus:border-orange-600 text-sm font-medium disabled:opacity-40"
                        maxLength={3}
                      />
                    </span>
                  ),
                }}
              />
            </div>
            <EditTextExpander text={note.text} onChange={(t) => updateNoteText("note-5", t)} disabled={!note.selected} />
          </div>
        );

      case "note-8":
        return (
          <div className="space-y-2">
            <div className="rounded bg-muted/40 px-3 py-2">
              <InlineNoteText
                text={note.text}
                disabled={!note.selected}
                tokenMap={{
                  LAST_NOTE: (
                    <span onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={header.lastNoteOverride || String(lastNote)}
                        onChange={(e) => setH("lastNoteOverride", e.target.value)}
                        disabled={!note.selected}
                        className="text-orange-600 bg-orange-50 border-2 border-orange-400 rounded w-10 text-center px-1 mx-0.5 focus:outline-none focus:border-orange-600 text-sm font-medium disabled:opacity-40"
                        maxLength={2}
                      />
                    </span>
                  ),
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Count auto-updates as notes are checked/unchecked. Edit the inline input above to override.
            </p>
            <EditTextExpander text={note.text} onChange={(t) => updateNoteText("note-8", t)} disabled={!note.selected} />
          </div>
        );

      default:
        // Standard note (2, 4, 6, 7) or any custom note
        return (
          <div className="space-y-2">
            <p className="text-sm">{note.text}</p>
            <EditTextExpander
              text={note.text}
              onChange={(t) => updateNoteText(note.id, t)}
              disabled={!note.selected}
            />
          </div>
        );
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <span className="font-semibold text-base">Notes to Accounts</span>
          <Badge variant="secondary">{selectedCount} / {notes.length} notes</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={selectAll} className="gap-1">
            <CheckSquare className="w-4 h-4" /> Select All
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAll} className="gap-1">
            <Square className="w-4 h-4" /> Deselect All
          </Button>
          <Button variant="outline" size="sm" onClick={addNote} className="gap-1">
            <Plus className="w-4 h-4" /> Add Note
          </Button>
          <Separator orientation="vertical" className="h-8" />
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-1">
            <FileDown className="w-4 h-4" /> Export Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1">
            <Printer className="w-4 h-4" /> Print
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Draft
          </Button>
        </div>
      </div>

      {/* ── Exportable content ── */}
      <div ref={contentRef} className="space-y-6">

        {/* ── Header card ── */}
        <div className="border rounded-lg p-5 space-y-3 bg-card">
          <div className="flex items-center gap-3">
            <Label className="text-xs w-28 shrink-0">Entity Name</Label>
            <Input
              value={header.entityNameOverride || displayEntityName}
              onChange={(e) => setH("entityNameOverride", e.target.value)}
              placeholder={displayEntityName}
              className="max-w-sm"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              Notes forming part of the Financial Statements
            </span>{" "}
            for the year ended, 31st March, {auditYear}
          </p>
          <p className="text-sm font-semibold">Note: Summary of Significant Accounting Policies</p>
        </div>

        {/* ── Notes list (dynamic) ── */}
        <div className="space-y-4">
          {notes.map((note, idx) => (
            <NoteCard
              key={note.id}
              note={note}
              displayNumber={idx + 1}
              isFirst={idx === 0}
              isLast={idx === notes.length - 1}
              onToggle={() => toggleNote(note.id)}
              onMoveUp={() => moveNoteUp(note.id)}
              onMoveDown={() => moveNoteDown(note.id)}
              onDelete={() => deleteNote(note.id)}
              onEditTitle={(title) => updateNoteTitle(note.id, title)}
              badge={
                note.id === "note-8"
                  ? <span className="text-xs text-muted-foreground ml-1">(auto-count: {lastNote})</span>
                  : undefined
              }
              mainContent={getMainContent(note)}
            />
          ))}
        </div>

        {/* ── Add note — dashed area at bottom ── */}
        <button
          onClick={addNote}
          className="w-full py-3 border-2 border-dashed border-muted-foreground/25 rounded-lg text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add Custom Note
        </button>

        {/* ── Signature Block ── */}
        <div className="border rounded-lg p-5 space-y-4 bg-card">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Signature Block
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            {/* Left — Assessee */}
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">For,</Label>
                <Input
                  value={sig.assesseeNameOverride || displayEntityName}
                  onChange={(e) => setS("assesseeNameOverride", e.target.value)}
                  placeholder={displayEntityName}
                />
              </div>
              <div className="border-b border-border w-48 pt-6" />
              <p className="text-xs text-muted-foreground">Signature of assessee</p>
              <div className="space-y-1">
                <Label className="text-xs">Place</Label>
                <Input
                  value={sig.assesseePlace || assesseePlace}
                  onChange={(e) => setS("assesseePlace", e.target.value)}
                  placeholder={assesseePlace}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <input
                  type="date"
                  value={sig.assesseeDate}
                  onChange={(e) => setS("assesseeDate", e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            {/* Right — CA Firm */}
            <div className="space-y-2">
              <p className="text-sm font-medium">For {firmName}</p>
              <p className="text-sm text-muted-foreground">Chartered Accountants</p>
              <p className="text-xs text-muted-foreground">FRN: {firmFRN}</p>
              <div className="border-b border-border w-48 pt-6" />
              <div className="space-y-1">
                <Label className="text-xs">Partner Name</Label>
                <Input
                  value={sig.partnerNameOverride || partnerAutoName}
                  onChange={(e) => setS("partnerNameOverride", e.target.value)}
                  placeholder={partnerAutoName || "Partner name"}
                />
              </div>
              <p className="text-xs text-muted-foreground">Partner</p>
              <p className="text-xs text-muted-foreground">Membership No.: {partnerMembership}</p>
              <p className="text-xs text-muted-foreground">Place: {firmCity}</p>
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <input
                  type="date"
                  value={sig.sigDate}
                  onChange={(e) => setS("sigDate", e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

          </div>
        </div>

      </div>{/* end contentRef */}

      {/* ── Footer save ── */}
      <div className="flex justify-end pt-1">
        <Button onClick={saveAll} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Notes to Accounts
        </Button>
      </div>

    </div>
  );
}
