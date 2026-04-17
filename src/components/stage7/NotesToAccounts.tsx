/**
 * NCENotesToAccounts — Notes to Accounts for Non-Corporate Entities (NCE)
 * Stage 7 | Non-corporate only | 8 notes with sub-variants
 * Persists to `notes_to_accounts_data` table (separate from corporate `notes_to_accounts`).
 */
import { useState, useEffect, useCallback, Fragment, useRef } from "react";
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
import { Save, Loader2, CheckSquare, Square, Pencil, Printer, FileText, FileDown } from "lucide-react";
import { getBSDate, getAuditYear } from "@/utils/entityUtils";
import { exportToPdf } from "@/lib/exportUtils";

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

interface NCENote {
  id: string;
  label: string;
  title: string;
  selected: boolean;
  text: string;
}

function buildNotesTemplate(auditYear: string): NCENote[] {
  return [
    {
      id: "note-1",
      label: "Note 1",
      title: "Balance Confirmation",
      selected: true,
      text: "All debit and credit balances and accounts squared up during the year are subject to confirmation from respective parties.",
    },
    {
      id: "note-2",
      label: "Note 2",
      title: "Rearrangement of Figures",
      selected: true,
      text: "The figures are rearranged/regrouped wherever considered necessary and rounded off to the nearest rupee.",
    },
    {
      id: "note-3",
      label: "Note 3",
      title: "Cash Balance & Closing Stock",
      selected: true,
      text: `Cash balance on hand was Rs. [CASH_AMOUNT]/- and value of Closing Stock Rs. [CLOSING_STOCK]/- as at 31st March, ${auditYear} are taken as certified by proprietor.`,
    },
    {
      id: "note-4",
      label: "Note 4",
      title: "Current Assets Valuation",
      selected: true,
      text: "In opinion of assessee, current assets, loans & advances are approximately of the value at which these are stated in the balance sheet.",
    },
    {
      id: "note-5",
      label: "Note 5",
      title: "Fixed Assets",
      selected: true,
      text: "Fixed Assets are stated at Cost less depreciation as shown in Note- [FA_NOTE]. Details of rate and amount of Depreciation claimed has been stated in Note-[DEP_NOTE].",
    },
    {
      id: "note-6",
      label: "Note 6",
      title: "Reliance on Vouchers",
      selected: true,
      text: "Whenever the supporting proof for the entries made in the books of accounts are not available for the purpose of audit, we are relied on the vouchers prepared and authenticated by the partner.",
    },
    {
      id: "note-7",
      label: "Note 7",
      title: "Loans via Cheque/DD/ECS",
      selected: true,
      text: "As informed by the partner, the amount of loan or deposits or specified sums taken or accepted or repaid by the assessee through a/c. payee cheque/demand draft or ECS only. However, it is not possible for us to verify the same as necessary evidence are not in possession of the assessee.",
    },
    {
      id: "note-8",
      label: "Note 8",
      title: "Notes form Part of Accounts",
      selected: true,
      text: `Notes No. 1 to [LAST_NOTE] forms part of accounts for the year ended on 31st March, ${auditYear}.`,
    },
  ];
}

// ─── Inline token renderer ────────────────────────────────────────────────────

/** Renders a note text with special inline tokens replaced by inputs/spans. */
function InlineNoteText({
  text,
  tokenMap,
  disabled,
}: {
  text: string;
  tokenMap: Record<string, React.ReactNode>;
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

/** Renders arbitrary text and highlights any [PLACEHOLDER] tokens in orange. */
function OrangePlaceholderPreview({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <div className="text-sm leading-relaxed rounded bg-muted/40 px-3 py-2 whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.startsWith("[") && p.endsWith("]") ? (
          <span key={i} className="text-orange-500 bg-orange-50 px-1 rounded font-medium">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        )
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
    entityNameOverride: "",
    cashAmount: "",
    closingStock: "",
    faNoteNum: "",
    depNoteNum: "",
    lastNoteOverride: "",
    note3VariantText: "",
  };
}

function emptySig(): SigData {
  const today = new Date().toISOString().slice(0, 10);
  return {
    assesseeNameOverride: "",
    assesseePlace: "",
    assesseeDate: today,
    partnerNameOverride: "",
    sigDate: today,
  };
}

interface Props {
  engagementId: string;
  engagement: any;
}

export function NCENotesToAccounts({ engagementId, engagement }: Props) {
  const { user } = useAuth();
  const contentRef = useRef<HTMLDivElement>(null);

  const fy: string = engagement?.financial_year ?? "";
  const auditYear = getAuditYear(fy);

  // ── Note state ──
  const [notes, setNotes] = useState<NCENote[]>(() => buildNotesTemplate(auditYear));
  const [header, setHeader] = useState<HeaderOverrides>(emptyHeader);
  const [sig, setSig] = useState<SigData>(emptySig);

  // ── Note 1 new entity toggle ──
  const [note1NewEntity, setNote1NewEntity] = useState(false);
  const [note1NewEntityText, setNote1NewEntityText] = useState("");

  // ── Note 3 variant ──
  const [note3Variant, setNote3Variant] = useState("none");

  // ── Remote data: client + firm + partner ──
  const [clientDetails, setClientDetails] = useState<any>(null);
  const [firmDetails, setFirmDetails] = useState<any>(null);
  const [partnerDetails, setPartnerDetails] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Reactive last-note count (CONFLICT-3: useEffect on [notes], not inline) ──
  const [lastNote, setLastNote] = useState(8);
  useEffect(() => {
    const count = notes.filter((n) => n.selected).length;
    setLastNote(count);
  }, [notes]);
  const displayLastNote = header.lastNoteOverride || String(lastNote);

  // ── Fetch client/firm/partner ──
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
      .select("name, display_name, icai_firm_reg_no, icai_reg_no, address, state")
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
        const savedMap = new Map<string, { selected: boolean; text: string }>(
          (data.notes_json as any[]).map((r: any) => [r.id, r])
        );
        setNotes(
          buildNotesTemplate(auditYear).map((n) => {
            const saved = savedMap.get(n.id);
            return saved ? { ...n, selected: saved.selected, text: saved.text } : n;
          })
        );
      }
      if (data.note3_variant) setNote3Variant(data.note3_variant);
      setNote1NewEntity(data.note1_new_entity_enabled ?? false);
      setNote1NewEntityText(data.note1_new_entity_text ?? "");
      if (data.header_overrides) setHeader((prev) => ({ ...prev, ...data.header_overrides }));
      if (data.signature_data) setSig((prev) => ({ ...prev, ...data.signature_data }));
    }
    setLoading(false);
  }, [engagementId, auditYear]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Note 1 new entity — build initial text when toggled ON ──
  useEffect(() => {
    if (!note1NewEntity || note1NewEntityText) return;
    const et = clientDetails?.entity_type || null;
    const doi = clientDetails?.date_of_incorporation
      ? new Date(clientDetails.date_of_incorporation).toLocaleDateString("en-IN", {
          day: "2-digit", month: "2-digit", year: "numeric",
        })
      : null;
    let text = NEW_ENTITY_TEMPLATE;
    if (et) text = text.replace("[ENTITY_TYPE]", et);
    if (doi) text = text.replace("[DATE_OF_INCORPORATION]", doi);
    setNote1NewEntityText(text);
  }, [note1NewEntity, note1NewEntityText, clientDetails]);

  // ── Note manipulators ──
  const toggleNote = (id: string) => setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, selected: !n.selected } : n)));
  const updateNoteText = (id: string, text: string) => setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, text } : n)));
  const selectAll = () => setNotes((prev) => prev.map((n) => ({ ...n, selected: true })));
  const deselectAll = () => setNotes((prev) => prev.map((n) => ({ ...n, selected: false })));

  const setH = <K extends keyof HeaderOverrides>(k: K, v: HeaderOverrides[K]) =>
    setHeader((prev) => ({ ...prev, [k]: v }));
  const setS = <K extends keyof SigData>(k: K, v: SigData[K]) =>
    setSig((prev) => ({ ...prev, [k]: v }));

  // ── Note 3 variant change ──
  const handleVariantChange = (variant: string) => {
    setNote3Variant(variant);
    const tpl = NOTE3_VARIANTS[variant] ?? "";
    setH("note3VariantText", tpl.replace(/\[YEAR\]/g, auditYear));
  };

  // ── Save ──
  const saveAll = async () => {
    setSaving(true);
    const notesJson = notes.map((n) => ({ id: n.id, selected: n.selected, text: n.text }));
    const { error } = await (supabase as any)
      .from("notes_to_accounts_data")
      .upsert(
        {
          engagement_id: engagementId,
          notes_json: notesJson,
          note3_variant: note3Variant,
          note1_new_entity_enabled: note1NewEntity,
          note1_new_entity_text: note1NewEntityText || null,
          header_overrides: header,
          signature_data: sig,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        },
        { onConflict: "engagement_id" }
      );
    setSaving(false);
    if (error) toast.error("Failed to save: " + error.message);
    else toast.success("Notes to Accounts saved");
  };

  // ── Display helpers ──
  const displayEntityName =
    header.entityNameOverride ||
    clientDetails?.name ||
    engagement?.clients?.name ||
    "[ENTITY NAME]";

  const firmName = firmDetails?.display_name || firmDetails?.name || "[Firm Name]";
  const firmFRN = firmDetails?.icai_firm_reg_no || firmDetails?.icai_reg_no || "[FRN]";
  const firmAddr = firmDetails?.address as any;
  const firmCity = firmAddr?.city || firmAddr?.district || firmDetails?.state || "[City]";
  const partnerName = sig.partnerNameOverride || partnerDetails?.name || "[Partner Name]";
  const partnerMembership = partnerDetails?.icai_reg_no || "[Membership No.]";
  const assesseePlace = sig.assesseePlace || clientDetails?.registered_state || "[Place]";

  const selectedCount = notes.filter((n) => n.selected).length;

  const handleExportPdf = async () => {
    if (!contentRef.current) return;
    const fySlug = (engagement?.financial_year ?? "FY").replace("/", "-");
    const nameSlug = displayEntityName.replace(/\s+/g, "_").slice(0, 30);
    await exportToPdf(contentRef.current, `Notes_${nameSlug}_${fySlug}.pdf`);
  };

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
          <Separator orientation="vertical" className="h-8" />
          <Button variant="outline" size="sm" onClick={handleExportPdf} className="gap-1">
            <FileDown className="w-4 h-4" /> Export PDF
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

      {/* ── Header ── */}
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

      {/* ── Notes ── */}
      <div className="space-y-4">

        {/* ── Note 1 ── */}
        {renderNoteCard({
          note: notes[0],
          onToggle: () => toggleNote("note-1"),
          mainContent: (
            <div className="space-y-3">
              <p className="text-sm">{notes[0].text}</p>

              {/* New entity sub-toggle */}
              <div className="flex items-center gap-3 pt-1">
                <Switch
                  id="note1-new-entity"
                  checked={note1NewEntity}
                  onCheckedChange={(v) => {
                    setNote1NewEntity(v);
                    if (!v) setNote1NewEntityText("");
                  }}
                  disabled={!notes[0].selected}
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

              {/* Edit main text */}
              <EditTextExpander
                text={notes[0].text}
                onChange={(t) => updateNoteText("note-1", t)}
                disabled={!notes[0].selected}
              />
            </div>
          ),
        })}

        {/* ── Note 2 ── */}
        {renderNoteCard({
          note: notes[1],
          onToggle: () => toggleNote("note-2"),
          mainContent: (
            <div className="space-y-2">
              <p className="text-sm">{notes[1].text}</p>
              <EditTextExpander text={notes[1].text} onChange={(t) => updateNoteText("note-2", t)} disabled={!notes[1].selected} />
            </div>
          ),
        })}

        {/* ── Note 3 ── */}
        {renderNoteCard({
          note: notes[2],
          onToggle: () => toggleNote("note-3"),
          mainContent: (
            <div className="space-y-3">
              {/* Main text with inline inputs */}
              <div className="rounded bg-muted/40 px-3 py-2">
                <InlineNoteText
                  text={notes[2].text}
                  disabled={!notes[2].selected}
                  tokenMap={{
                    CASH_AMOUNT: (
                      <span onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={header.cashAmount}
                          onChange={(e) => setH("cashAmount", e.target.value)}
                          disabled={!notes[2].selected}
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
                          disabled={!notes[2].selected}
                          placeholder="Amount"
                          className="text-orange-600 bg-orange-50 border-b-2 border-orange-400 w-24 text-center px-1 mx-0.5 focus:outline-none focus:border-orange-600 text-sm font-medium disabled:opacity-40"
                        />
                      </span>
                    ),
                  }}
                />
              </div>

              {/* Business type dropdown */}
              <div className="flex items-center gap-3">
                <Label className="text-xs shrink-0 w-52">Business Type — additional paragraph:</Label>
                <Select value={note3Variant} onValueChange={handleVariantChange} disabled={!notes[2].selected}>
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
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

              {/* Variant text editable */}
              {note3Variant !== "none" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Additional paragraph (editable):</Label>
                  <Textarea
                    value={header.note3VariantText}
                    onChange={(e) => setH("note3VariantText", e.target.value)}
                    rows={4}
                    className="text-sm resize-y"
                    disabled={!notes[2].selected}
                  />
                </div>
              )}

              <EditTextExpander text={notes[2].text} onChange={(t) => updateNoteText("note-3", t)} disabled={!notes[2].selected} />
            </div>
          ),
        })}

        {/* ── Note 4 ── */}
        {renderNoteCard({
          note: notes[3],
          onToggle: () => toggleNote("note-4"),
          mainContent: (
            <div className="space-y-2">
              <p className="text-sm">{notes[3].text}</p>
              <EditTextExpander text={notes[3].text} onChange={(t) => updateNoteText("note-4", t)} disabled={!notes[3].selected} />
            </div>
          ),
        })}

        {/* ── Note 5 ── */}
        {renderNoteCard({
          note: notes[4],
          onToggle: () => toggleNote("note-5"),
          mainContent: (
            <div className="space-y-2">
              <div className="rounded bg-muted/40 px-3 py-2">
                <InlineNoteText
                  text={notes[4].text}
                  disabled={!notes[4].selected}
                  tokenMap={{
                    FA_NOTE: (
                      <span onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={header.faNoteNum}
                          onChange={(e) => setH("faNoteNum", e.target.value)}
                          disabled={!notes[4].selected}
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
                          disabled={!notes[4].selected}
                          placeholder="#"
                          className="text-orange-600 bg-orange-50 border-2 border-orange-400 rounded w-10 text-center px-1 mx-0.5 focus:outline-none focus:border-orange-600 text-sm font-medium disabled:opacity-40"
                          maxLength={3}
                        />
                      </span>
                    ),
                  }}
                />
              </div>
              <EditTextExpander text={notes[4].text} onChange={(t) => updateNoteText("note-5", t)} disabled={!notes[4].selected} />
            </div>
          ),
        })}

        {/* ── Note 6 ── */}
        {renderNoteCard({
          note: notes[5],
          onToggle: () => toggleNote("note-6"),
          mainContent: (
            <div className="space-y-2">
              <p className="text-sm">{notes[5].text}</p>
              <EditTextExpander text={notes[5].text} onChange={(t) => updateNoteText("note-6", t)} disabled={!notes[5].selected} />
            </div>
          ),
        })}

        {/* ── Note 7 ── */}
        {renderNoteCard({
          note: notes[6],
          onToggle: () => toggleNote("note-7"),
          mainContent: (
            <div className="space-y-2">
              <p className="text-sm">{notes[6].text}</p>
              <EditTextExpander text={notes[6].text} onChange={(t) => updateNoteText("note-7", t)} disabled={!notes[6].selected} />
            </div>
          ),
        })}

        {/* ── Note 8 ── */}
        {renderNoteCard({
          note: notes[7],
          onToggle: () => toggleNote("note-8"),
          badge: (
            <span className="text-xs text-muted-foreground ml-2">
              (auto-count: {lastNote})
            </span>
          ),
          mainContent: (
            <div className="space-y-2">
              <div className="rounded bg-muted/40 px-3 py-2">
                <InlineNoteText
                  text={notes[7].text}
                  disabled={!notes[7].selected}
                  tokenMap={{
                    LAST_NOTE: (
                      <span onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={header.lastNoteOverride || String(lastNote)}
                          onChange={(e) => setH("lastNoteOverride", e.target.value)}
                          disabled={!notes[7].selected}
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
              <EditTextExpander text={notes[7].text} onChange={(t) => updateNoteText("note-8", t)} disabled={!notes[7].selected} />
            </div>
          ),
        })}
      </div>

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
                value={sig.partnerNameOverride || partnerDetails?.name || ""}
                onChange={(e) => setS("partnerNameOverride", e.target.value)}
                placeholder={partnerDetails?.name || "Partner name"}
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

// ─── Helpers (defined outside component for readability) ─────────────────────

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

function renderNoteCard({
  note,
  onToggle,
  mainContent,
  badge,
}: {
  note: NCENote;
  onToggle: () => void;
  mainContent: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div key={note.id} className="border rounded-lg overflow-hidden">
      {/* Checkbox row — always fully interactive (never dimmed) */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-card cursor-pointer select-none"
        onClick={onToggle}
      >
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={note.selected} onCheckedChange={onToggle} id={`nce-${note.id}`} />
        </span>
        <Label htmlFor={`nce-${note.id}`} className="cursor-pointer font-medium text-sm">
          {note.label}
        </Label>
        <span className="text-xs text-muted-foreground">{note.title}</span>
        {badge}
        {!note.selected && (
          <Badge variant="outline" className="ml-auto text-xs text-muted-foreground">
            Excluded
          </Badge>
        )}
      </div>

      {/* Content — dims when excluded */}
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
