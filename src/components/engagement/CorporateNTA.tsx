/**
 * CorporateNTA.tsx
 *
 * Stage 8 → Notes to Accounts — Corporate entity single-page editor.
 *
 * Layout:
 *   • Note 1  — Corporate Information (overview paragraph, inline editable fields)
 *   • Note 2  — Significant Accounting Policies (18 default + add/delete)
 *   • General Notes (9 default + add/delete)
 *   • Toolbar: Save All | Reset to Defaults | Print
 *
 * Data is persisted to audit_engagements.stage8_nta_data (JSONB).
 * Empty body strings fall back to NTA_POLICY_DEFAULTS / NTA_GENERAL_NOTES_DEFAULTS
 * at render time; the DB is never bloated with default text.
 */

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, RotateCcw, Printer, Plus, Trash2, Loader2 } from "lucide-react";
import {
  NTA_POLICY_META,
  NTA_POLICY_DEFAULTS,
  NTA_GENERAL_NOTES_DEFAULTS,
  resolvePolicy,
  resolveGeneralNote,
  Stage8NtaData,
} from "@/lib/notesToAccountsDefaults";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagement: any;
  client: any;
  onUpdate: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns "2013" if incorporated ≥ 2014, else "1956". */
function getActYear(dateStr: string | null | undefined): string {
  if (!dateStr) return "____";
  const yr = new Date(dateStr).getFullYear();
  return yr >= 2014 ? "2013" : "1956";
}

const DEFAULT_DATA: Stage8NtaData = {
  overview: { registered_address_override: null, business_activity_override: null },
  policies: NTA_POLICY_META.map(m => ({ id: m.id, title: m.title, body: "" })),
  general_notes: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, body: "" })),
};

function initData(raw: any): Stage8NtaData {
  if (!raw) return structuredClone(DEFAULT_DATA);
  return {
    overview: {
      registered_address_override: raw.overview?.registered_address_override ?? null,
      business_activity_override:  raw.overview?.business_activity_override  ?? null,
    },
    policies: Array.isArray(raw.policies) && raw.policies.length
      ? raw.policies
      : structuredClone(DEFAULT_DATA.policies),
    general_notes: Array.isArray(raw.general_notes) && raw.general_notes.length
      ? raw.general_notes
      : structuredClone(DEFAULT_DATA.general_notes),
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Renders as plain text; clicking activates an <input> for inline editing.
 * Commits on blur or Enter; reverts on Escape.
 */
function EditableInline({
  value,
  onChange,
  placeholder = "click to edit",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = (v: string) => { onChange(v); setEditing(false); };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={e => {
          if (e.key === "Enter")  { e.preventDefault(); commit(draft); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className={`border-b border-primary outline-none bg-transparent px-0.5 min-w-[12rem] ${className}`}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={e => e.key === "Enter" && setEditing(true)}
      title="Click to edit"
      className={`cursor-pointer rounded hover:bg-amber-50 underline decoration-dotted underline-offset-2 ${
        value ? "" : "text-muted-foreground italic"
      } ${className}`}
    >
      {value || placeholder}
    </span>
  );
}

/** Textarea that grows vertically to fit its content. */
function AutoGrowTextarea({
  value,
  onChange,
  placeholder = "",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className={`w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CorporateNTA({ engagement, client, onUpdate }: Props) {
  const [data,   setData]   = useState<Stage8NtaData>(() => initData(engagement?.stage8_nta_data));
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-initialise when the user switches to a different engagement
  useEffect(() => {
    setData(initData(engagement?.stage8_nta_data));
  }, [engagement?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup timer on unmount
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  // ── Derived client / overview values ──────────────────────────────────────
  const companyName    = (client?.name ?? client?.client_name ?? "") as string;
  const cin            = (client?.cin ?? "") as string;
  const incDateRaw     = (client?.date_of_incorporation ?? "") as string;
  const actYear        = getActYear(incDateRaw);
  const regAddress     = (data.overview.registered_address_override ?? client?.registered_office  ?? "") as string;
  const bizActivity    = (data.overview.business_activity_override  ?? client?.business_activity  ?? "") as string;
  const incDateDisplay = incDateRaw
    ? new Date(incDateRaw).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
    : "____";

  // ── Persistence ────────────────────────────────────────────────────────────

  async function doSave(payload: Stage8NtaData) {
    setSaving(true);
    const { error } = await (supabase.from as any)("audit_engagements")
      .update({ stage8_nta_data: payload })
      .eq("id", engagement.id);
    if (error) toast.error("Save failed: " + error.message);
    else onUpdate();
    setSaving(false);
  }

  function scheduleSave(payload: Stage8NtaData) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave(payload), 1500);
  }

  async function saveNow() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await doSave(data);
    toast.success("Saved");
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  function updateOverview(key: keyof Stage8NtaData["overview"], val: string) {
    setData(prev => {
      const next = { ...prev, overview: { ...prev.overview, [key]: val.trim() || null } };
      scheduleSave(next);
      return next;
    });
  }

  function updatePolicyBody(idx: number, body: string) {
    setData(prev => {
      const policies = prev.policies.map((p, i) => i === idx ? { ...p, body } : p);
      const next = { ...prev, policies };
      scheduleSave(next);
      return next;
    });
  }

  function updatePolicyTitle(idx: number, title: string) {
    setData(prev => {
      const policies = prev.policies.map((p, i) => i === idx ? { ...p, title } : p);
      const next = { ...prev, policies };
      scheduleSave(next);
      return next;
    });
  }

  function deletePolicy(idx: number) {
    setData(prev => {
      const policies = prev.policies.filter((_, i) => i !== idx);
      const next = { ...prev, policies };
      scheduleSave(next);
      return next;
    });
  }

  function addPolicy(title: string) {
    setData(prev => {
      // Generate an ID like "2.19", "2.20", …
      const nextNum = prev.policies.length + 1;
      const newId   = `2.${nextNum}`;
      const policies = [...prev.policies, { id: newId, title: title.trim(), body: "" }];
      const next = { ...prev, policies };
      scheduleSave(next);
      return next;
    });
  }

  function updateGeneralNote(idx: number, body: string) {
    setData(prev => {
      const general_notes = prev.general_notes.map((n, i) => i === idx ? { ...n, body } : n);
      const next = { ...prev, general_notes };
      scheduleSave(next);
      return next;
    });
  }

  function deleteGeneralNote(idx: number) {
    setData(prev => {
      // Re-number after deletion
      const general_notes = prev.general_notes
        .filter((_, i) => i !== idx)
        .map((n, i) => ({ ...n, id: i + 1 }));
      const next = { ...prev, general_notes };
      scheduleSave(next);
      return next;
    });
  }

  function addGeneralNote() {
    setData(prev => {
      const general_notes = [...prev.general_notes, { id: prev.general_notes.length + 1, body: "" }];
      const next = { ...prev, general_notes };
      scheduleSave(next);
      return next;
    });
  }

  function resetToDefaults() {
    const fresh = structuredClone(DEFAULT_DATA);
    setData(fresh);
    scheduleSave(fresh);
    toast.info("Reset to defaults — auto-saving…");
  }

  // ── Add-policy inline form state ───────────────────────────────────────────
  const [showAddPolicy,   setShowAddPolicy]   = useState(false);
  const [newPolicyTitle,  setNewPolicyTitle]  = useState("");

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-16 print:pb-0">

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between print:hidden">
        <h2 className="text-lg font-semibold text-foreground">Notes to Accounts — Note 1</h2>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={resetToDefaults} disabled={saving}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset to Defaults
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5 mr-1" /> Print
          </Button>
          <Button size="sm" onClick={saveNow} disabled={saving}>
            {saving
              ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              : <Save className="w-3.5 h-3.5 mr-1" />}
            Save All
          </Button>
        </div>
      </div>

      {/* ── Note 1 — Corporate Information ──────────────────────────────── */}
      <section className="border rounded-lg p-5 space-y-3 bg-card">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Note 1 — Corporate Information
        </h3>
        <div className="text-sm leading-relaxed text-foreground space-y-2">
          <p>
            <span className="font-semibold">{companyName || "[Company Name]"}</span>
            {" "}(hereinafter referred to as "the Company") is a company incorporated under the
            Companies Act,{" "}
            <span className="font-semibold">{actYear}</span> on{" "}
            <span className="font-semibold">{incDateDisplay}</span>
            {cin && (
              <>
                {" "}with CIN{" "}
                <span className="font-semibold">{cin}</span>
              </>
            )}.
          </p>
          <p>
            The Registered Office of the Company is situated at{" "}
            <EditableInline
              value={regAddress}
              onChange={v => updateOverview("registered_address_override", v)}
              placeholder="click to set registered address"
              className="font-medium"
            />.
          </p>
          <p>
            The principal business activity of the Company is{" "}
            <EditableInline
              value={bizActivity}
              onChange={v => updateOverview("business_activity_override", v)}
              placeholder="click to set business activity"
              className="font-medium"
            />.
          </p>
        </div>
      </section>

      {/* ── Note 2 — Significant Accounting Policies ────────────────────── */}
      <section className="border rounded-lg p-5 space-y-5 bg-card">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Note 2 — Significant Accounting Policies
        </h3>

        {data.policies.map((policy, idx) => (
          <div
            key={`${policy.id}-${idx}`}
            className="border-b last:border-b-0 pb-4 last:pb-0 space-y-1.5"
          >
            {/* Policy header row */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-xs font-semibold text-muted-foreground w-8 shrink-0 pt-0.5">
                  {policy.id}
                </span>
                <EditableInline
                  value={policy.title}
                  onChange={v => updatePolicyTitle(idx, v)}
                  className="text-sm font-medium text-foreground"
                />
              </div>
              <button
                onClick={() => deletePolicy(idx)}
                title="Remove this policy"
                className="print:hidden mt-0.5 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Policy body */}
            <div className="pl-10">
              <AutoGrowTextarea
                value={resolvePolicy(policy.id, policy.body)}
                onChange={v => updatePolicyBody(idx, v)}
                placeholder={NTA_POLICY_DEFAULTS[policy.id] ?? "Enter policy text…"}
                className="text-sm"
              />
            </div>
          </div>
        ))}

        {/* Add-policy form / button */}
        <div className="print:hidden pl-0">
          {showAddPolicy ? (
            <div className="flex gap-2 items-center">
              <input
                autoFocus
                value={newPolicyTitle}
                onChange={e => setNewPolicyTitle(e.target.value)}
                placeholder="Policy title (e.g. Impairment of Assets)"
                className="flex-1 rounded-md border border-input px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onKeyDown={e => {
                  if (e.key === "Enter" && newPolicyTitle.trim()) {
                    addPolicy(newPolicyTitle);
                    setNewPolicyTitle("");
                    setShowAddPolicy(false);
                  }
                  if (e.key === "Escape") {
                    setNewPolicyTitle("");
                    setShowAddPolicy(false);
                  }
                }}
              />
              <Button
                size="sm"
                onClick={() => {
                  if (newPolicyTitle.trim()) {
                    addPolicy(newPolicyTitle);
                    setNewPolicyTitle("");
                    setShowAddPolicy(false);
                  }
                }}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setNewPolicyTitle(""); setShowAddPolicy(false); }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAddPolicy(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Policy
            </Button>
          )}
        </div>
      </section>

      {/* ── General Notes ───────────────────────────────────────────────── */}
      <section className="border rounded-lg p-5 space-y-4 bg-card">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          General Notes
        </h3>

        {data.general_notes.map((note, idx) => (
          <div
            key={note.id}
            className="flex gap-3 items-start border-b last:border-b-0 pb-3 last:pb-0"
          >
            <span className="text-sm font-semibold text-muted-foreground w-6 pt-2 shrink-0 select-none">
              {note.id}.
            </span>
            <div className="flex-1 min-w-0">
              <AutoGrowTextarea
                value={resolveGeneralNote(idx, note.body)}
                onChange={v => updateGeneralNote(idx, v)}
                placeholder={NTA_GENERAL_NOTES_DEFAULTS[idx] ?? "Enter note text…"}
                className="text-sm"
              />
            </div>
            <button
              onClick={() => deleteGeneralNote(idx)}
              title="Remove this note"
              className="print:hidden mt-2 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        <div className="print:hidden">
          <Button variant="outline" size="sm" onClick={addGeneralNote}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Note
          </Button>
        </div>
      </section>

    </div>
  );
}
