import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuditTracker } from "@/hooks/useAuditTracker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Sparkles, Loader2, Save, Eye, FileText, LayoutList, TableProperties, Award, ClipboardList } from "lucide-react";
import { Json } from "@/integrations/supabase/types";
import { NCECapitalAccount } from "@/components/stage8/NCECapitalAccount";
import { NCEDetailedNotes } from "@/components/stage8/NCEDetailedNotes";
import { NCEPPESchedule } from "@/components/stage8/NCEPPESchedule";
import { NCEClientCertificate } from "@/components/stage8/NCEClientCertificate";
import { NCEManagementLetter } from "@/components/stage8/NCEManagementLetter";
import { NCENotesToAccounts } from "@/components/stage7/NotesToAccounts";

// Fix (Issue 4): Mark notes that are exclusive to corporate entities (Private/Public Ltd).
// These are filtered out when isCorporate = false.
const STANDARD_NOTES = [
  { num: 1,  title: "Corporate Information",                autoKey: "corporate",    corporateOnly: true  },
  { num: 2,  title: "Significant Accounting Policies",      autoKey: "policies",     corporateOnly: false },
  { num: 29, title: "Finance Costs",                        autoKey: "finance_costs",corporateOnly: false },
  { num: 30, title: "Depreciation and Amortisation",        autoKey: "depreciation", corporateOnly: false },
  { num: 31, title: "Other Expenses",                       autoKey: "other_expenses",corporateOnly: false },
  { num: 32, title: "Exceptional Items",                    autoKey: "exceptional",  corporateOnly: false },
  { num: 33, title: "Tax Expense",                          autoKey: "tax_expense",  corporateOnly: false },
  { num: 34, title: "Earnings Per Share",                   autoKey: "eps",          corporateOnly: true  },
  { num: 35, title: "Contingent Liabilities and Commitments", autoKey: "contingent", corporateOnly: false },
  { num: 36, title: "Related Party Disclosures",            autoKey: "related_party",corporateOnly: false },
  { num: 37, title: "Segment Reporting",                    autoKey: "segments",     corporateOnly: false },
  { num: 38, title: "Leases",                               autoKey: "leases",       corporateOnly: false },
  { num: 39, title: "Foreign Currency Transactions",        autoKey: "forex",        corporateOnly: false },
  { num: 40, title: "Government Grants",                    autoKey: "grants",       corporateOnly: false },
  { num: 41, title: "Deferred Tax",                         autoKey: "deferred_tax", corporateOnly: false },
  { num: 42, title: "CSR Expenditure",                      autoKey: "csr",          corporateOnly: true  },
  { num: 43, title: "Details of Benami Property",           autoKey: "benami",       corporateOnly: false },
  { num: 44, title: "Events After Reporting Period",        autoKey: "subsequent",   corporateOnly: false },
  { num: 45, title: "Previous Year Figures",                autoKey: "previous_year",corporateOnly: false },
];

// Exact entity_type values stored in audit_engagements that indicate non-corporate.
// isCompanyEntity() in entityUtils.ts is the canonical test for the corporate side;
// this list covers the NCE side explicitly so the Stage 8 tab structure can be
// activated without importing a utility that doesn't cover all NCE variants.
const NON_CORPORATE_TYPES: string[] = [
  "Partnership",
  "LLP",
  "Proprietorship",
  "Sole Proprietorship",
  "HUF",
  "Trust",
  "AOP",
  "BOI",
  "Individual",
  "Hindu Undivided Family",
  "Limited Liability Partnership",
  "Association of Persons",
  "Body of Individuals",
];

interface NoteData {
  num: number;
  title: string;
  content: string;
  status: "empty" | "ai_draft" | "reviewed" | "approved";
  autoAvailable: boolean;
}

interface Props {
  engagement: any;
  client: any;
  onUpdate: () => void;
  /** Fix (Issue 4): when false, corporate-only notes (Corporate Info, EPS, CSR) are hidden */
  isCorporate?: boolean;
}

export function EngagementNotesToAccounts({ engagement, client, onUpdate, isCorporate = true }: Props) {
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [selectedNote, setSelectedNote] = useState(0);
  const [drafting, setDrafting] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [hasTB, setHasTB] = useState(false);
  const prevNotesRef = useRef<NoteData[]>([]);
  const { track } = useAuditTracker(engagement?.id);

  useEffect(() => {
    // Check if Tally sync data exists (snapshot path removed)
    if (client?.id) {
      (supabase.from as any)("sync_batches")
        .select("id")
        .eq("client_id", client.id)
        .in("status", ["completed", "complete", "success", "complete_with_warnings"])
        .limit(1)
        .then(({ data }: any) => setHasTB((data?.length || 0) > 0));
    }

    const saved = engagement?.notes_to_accounts as Record<string, any> | null;
    // Fix (Issue 4): filter out corporate-only notes for non-corporate entities
    const visibleNotes = STANDARD_NOTES.filter(n => isCorporate || !n.corporateOnly);
    const initial: NoteData[] = visibleNotes.map(n => {
      const existing = saved?.[String(n.num)];
      return {
        num: n.num,
        title: n.title,
        content: existing?.content || "",
        status: existing?.status || "empty",
        autoAvailable: false,
      };
    });
    setNotes(initial);
  }, [engagement?.notes_to_accounts, client?.id]);

  // Mark auto-available based on TB data.
  // Fix (Issue 12): notes 3-8, 11-12 are NOT in STANDARD_NOTES (they jump from 2 → 29).
  // When TB is present, ALL notes in STANDARD_NOTES benefit from AI drafting.
  useEffect(() => {
    if (hasTB) {
      setNotes(prev => prev.map(n => ({ ...n, autoAvailable: true })));
    }
  }, [hasTB]);

  const updateNoteContent = (idx: number, content: string) => {
    setNotes(prev => prev.map((n, i) => i === idx ? {
      ...n, content, status: content.trim() ? (n.status === "empty" ? "ai_draft" : n.status) : "empty"
    } : n));
  };

  const setNoteStatus = (idx: number, status: NoteData["status"]) => {
    setNotes(prev => prev.map((n, i) => i === idx ? { ...n, status } : n));
  };

  async function aiDraft(idx: number) {
    const note = notes[idx];
    setDrafting(note.num);
    try {
      // Gather relevant data per note type
      let contextData: any = { note_number: note.num, note_title: note.title, entity_type: client?.entity_type };
      const financialStandards = "indian_gaap";
      contextData.financial_standards = financialStandards;

      if (note.num === 10) {
        const { data } = await supabase.from("related_parties").select("*").eq("client_id", client?.id);
        contextData.related_parties = data || [];
      } else if (note.num === 12) {
        const { data } = await supabase.from("scrutiny_findings").select("*").eq("client_id", client?.id);
        contextData.deferred_tax_findings = (data || []).filter(f => f.rule_id?.startsWith("DT"));
      } else if ([2, 3, 4, 5, 6, 7, 8].includes(note.num) && hasTB) {
        // TB context for AI notes drafter — reads from tally_trial_balance via engagement_id
        const { data: tbRows } = await supabase
          .from("tally_trial_balance")
          .select("ledger_name, parent_group, closing_balance, balance_type, opening_balance, opening_type")
          .eq("engagement_id", engagement.id);
        if (tbRows?.length) contextData.trial_balance = tbRows;
      }

      const res = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "notes_drafter",
          user_message: JSON.stringify(contextData),
        },
      });

      if (res.data?.reply) {
        setNotes(prev => prev.map((n, i) => i === idx ? {
          ...n, content: res.data.reply, status: "ai_draft" as const
        } : n));
        toast.success(`AI draft generated for Note ${note.num}`);
      } else {
        toast.error("AI returned empty response");
      }
    } catch (e) {
      toast.error("AI draft failed");
    } finally {
      setDrafting(null);
    }
  }

  async function save() {
    setSaving(true);
    const payload: Record<string, any> = {};
    notes.forEach((n, i) => {
      // Track edits to AI drafts
      const prev = prevNotesRef.current[i];
      if (prev && prev.status === "ai_draft" && n.content !== prev.content) {
        track("notes_edit", {
          note_number: n.num,
          note_title: n.title,
          ai_text_length: prev.content.length,
          human_text_length: n.content.length,
        }, { aiSuggestion: prev.content.substring(0, 500), humanOverride: true });
      }
      payload[String(n.num)] = { content: n.content, status: n.status, title: n.title };
    });
    prevNotesRef.current = [...notes];

    const { error } = await supabase
      .from("audit_engagements")
      .update({ notes_to_accounts: payload as unknown as Json })
      .eq("id", engagement.id);

    if (error) toast.error("Save failed");
    else { toast.success("Notes saved"); onUpdate(); }
    setSaving(false);
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { className: string; label: string }> = {
      empty: { className: "bg-muted text-muted-foreground", label: "Empty" },
      ai_draft: { className: "bg-purple-500/15 text-purple-700 border-purple-300", label: "AI Draft" },
      reviewed: { className: "bg-amber-500/15 text-amber-700 border-amber-300", label: "Reviewed" },
      approved: { className: "bg-green-500/15 text-green-700 border-green-300", label: "Approved" },
    };
    const s = map[status] || map.empty;
    return <Badge variant="outline" className={`text-[10px] ${s.className}`}>{s.label}</Badge>;
  };

  const current = notes[selectedNote];
  const engagementId: string = engagement?.id || "";

  // ── NCE detection ─────────────────────────────────────────────────────────
  // Two-source truth: trust the isCorporate prop from EngagementDetail (already
  // correctly computed there) OR fall back to the entity_type string check.
  //
  // Why both? engagement.entity_type can be NULL for older engagements that
  // were created before the field was populated — the string check alone fails
  // in that case. The isCorporate prop is always reliable because EngagementDetail
  // computes it from both engagement.entity_type AND client.entity_type.
  //
  // Rule: NCE tabs show when the caller says NOT corporate, OR the entity_type
  // string is in the NCE list.  Corporate path is EXACTLY as before.
  const entityType: string = (
    engagement?.entity_type ||
    engagement?.clients?.entity_type ||
    client?.entity_type ||
    ""
  ).trim();
  const isNonCorporate: boolean =
    !isCorporate ||
    NON_CORPORATE_TYPES.some(t => t.toLowerCase() === entityType.toLowerCase());

  // ── Shared editor body ─────────────────────────────────────────────────────
  // Extracted so it can be placed inside a TabsContent (NCE) or returned
  // directly (corporate) without duplicating JSX.
  const noteEditorBody = (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Notes to Accounts</h2>
        <div className="flex gap-2">
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Eye className="w-4 h-4 mr-1" /> Preview All Notes</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh]">
              <DialogHeader><DialogTitle>Notes to Accounts — Preview</DialogTitle></DialogHeader>
              <ScrollArea className="max-h-[65vh] pr-4">
                <div className="space-y-6">
                  {notes.map(n => (
                    <div key={n.num} className="border-b pb-4 last:border-b-0">
                      <h3 className="font-semibold text-sm text-foreground mb-1">Note {n.num}: {n.title}</h3>
                      {n.content.trim() ? (
                        <p className="text-sm text-foreground whitespace-pre-wrap">{n.content}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">[Note not yet drafted]</p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            Save Notes
          </Button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-4 min-h-[500px]">
        {/* Left: Note list */}
        <div className="w-64 shrink-0 border rounded-lg overflow-auto">
          <ScrollArea className="h-[500px]">
            {notes.map((n, i) => (
              <button
                key={n.num}
                onClick={() => setSelectedNote(i)}
                className={`w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-colors text-xs ${
                  selectedNote === i ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="font-medium text-foreground">Note {n.num}</span>
                  {statusBadge(n.status)}
                </div>
                <span className="text-muted-foreground leading-tight line-clamp-2">{n.title}</span>
                {n.autoAvailable && (
                  <Badge className="mt-1 bg-sidebar-gold/20 text-sidebar-gold border-sidebar-gold/30 text-[9px]">Auto-fill Available</Badge>
                )}
              </button>
            ))}
          </ScrollArea>
        </div>

        {/* Right: Editor */}
        {current && (
          <div className="flex-1 border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Note {current.num}: {current.title}</h3>
                <div className="flex gap-2 mt-1">
                  {statusBadge(current.status)}
                  {current.autoAvailable && <Badge className="bg-sidebar-gold/20 text-sidebar-gold text-[10px]">Auto-fill Available</Badge>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => aiDraft(selectedNote)}
                  disabled={drafting !== null}
                  className="border-primary/30 text-primary"
                >
                  {drafting === current.num ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                  AI Draft
                </Button>
              </div>
            </div>

            <Textarea
              value={current.content}
              onChange={e => updateNoteContent(selectedNote, e.target.value)}
              rows={16}
              className="text-sm min-h-[300px] font-mono"
              placeholder={`Draft content for Note ${current.num}: ${current.title}...`}
            />

            <div className="flex gap-2">
              <span className="text-xs text-muted-foreground mr-auto">Status:</span>
              {(["empty", "ai_draft", "reviewed", "approved"] as const).map(s => (
                <Button
                  key={s}
                  size="sm"
                  variant={current.status === s ? "default" : "outline"}
                  className="text-xs h-7"
                  onClick={() => setNoteStatus(selectedNote, s)}
                >
                  {s.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  ); // end noteEditorBody

  // ── Empty-state guard ─────────────────────────────────────────────────────
  // If no engagement is selected (e.g. user opened Stage 7 via the sidebar
  // before picking one), every child query below would fire with
  // engagement_id="" and Postgres rejects it as an invalid UUID. Show a
  // placeholder instead of mounting the tab tree.
  if (!engagementId) {
    return (
      <div className="flex items-center justify-center py-20 border rounded-lg bg-muted/30">
        <p className="text-sm text-muted-foreground">
          Select an engagement from Engagement Setup to begin Notes to Accounts.
        </p>
      </div>
    );
  }

  // ── NCE: wrap in 6-tab structure ──────────────────────────────────────────
  if (isNonCorporate) {
    return (
      <Tabs defaultValue="notes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="notes" className="gap-1.5">
            <FileText size={13} /> Note 1
          </TabsTrigger>
          <TabsTrigger value="capital" className="gap-1.5">
            <LayoutList size={13} /> Capital Account
          </TabsTrigger>
          <TabsTrigger value="detailed-notes" className="gap-1.5">
            <Eye size={13} /> Notes to Accounts
          </TabsTrigger>
          <TabsTrigger value="ppe" className="gap-1.5">
            <TableProperties size={13} /> PPE Schedule
          </TabsTrigger>
          <TabsTrigger value="client-certificate" className="gap-1.5">
            <Award size={13} /> Client Certificate
          </TabsTrigger>
          <TabsTrigger value="management-letter" className="gap-1.5">
            <ClipboardList size={13} /> Management Letter
          </TabsTrigger>
        </TabsList>

        {/* Tab 1 — NCE notes (Balance Confirmation, Rearrangement of Figures, etc.) */}
        <TabsContent value="notes">
          <NCENotesToAccounts engagementId={engagementId} engagement={engagement} />
        </TabsContent>

        {/* Tab 2 — Capital Account */}
        <TabsContent value="capital">
          <NCECapitalAccount engagementId={engagementId} />
        </TabsContent>

        {/* Tab 3 — Detailed Notes to Accounts */}
        <TabsContent value="detailed-notes">
          <NCEDetailedNotes engagementId={engagementId} />
        </TabsContent>

        {/* Tab 4 — PPE Schedule */}
        <TabsContent value="ppe">
          <NCEPPESchedule engagementId={engagementId} />
        </TabsContent>

        {/* Tab 5 — Client Certificate */}
        <TabsContent value="client-certificate">
          <NCEClientCertificate engagementId={engagementId} />
        </TabsContent>

        {/* Tab 6 — Management Letter */}
        <TabsContent value="management-letter">
          <NCEManagementLetter engagementId={engagementId} />
        </TabsContent>
      </Tabs>
    );
  }

  // ── Corporate: return existing content directly — ZERO change ────────────
  return noteEditorBody;
}

// ═══════════════════════════════════════════════════════════════════════════
// NCE Tab implementations
// NCECapitalAccount     — @/components/stage8/NCECapitalAccount
// NCEDetailedNotes      — @/components/stage8/NCEDetailedNotes
// NCEPPESchedule        — @/components/stage8/NCEPPESchedule
// NCEClientCertificate  — @/components/stage8/NCEClientCertificate
// NCEManagementLetter   — @/components/stage8/NCEManagementLetter
// ═══════════════════════════════════════════════════════════════════════════
