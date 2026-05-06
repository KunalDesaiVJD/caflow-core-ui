/**
 * CorporateNTA.tsx
 *
 * Stage 8 → Notes to Accounts — Corporate entity single-page editor.
 *
 * Layout
 * ──────
 *  Toolbar  : Save All | Reset to Defaults (w/ confirm) | Print
 *  Title    : "Note No: 1 — DISCLOSURE OF ACCOUNTING POLICIES &
 *              NOTES FORMING PART OF THE ANNUAL ACCOUNTS"
 *  Section (a) : Overview of the Reporting Entity
 *                – company name (from client master, read-only)
 *                – incorporation date  → DateField (overrideable)
 *                – CIN                → from client master
 *                – registered address → EditableInline
 *                – business activity  → EditableInline
 *  Section (b) : Significant Accounting Policies
 *                – 2.1 … 2.18 (editable AutoGrowTextarea, × delete w/ confirm)
 *                – 2.19 General Notes (9 rows, × delete w/ confirm)
 *                – + Add Policy / + Add General Note
 *
 * Persistence  : audit_engagements.stage8_nta_data (JSONB)
 *                Empty body "" → falls back to NTA_POLICY_DEFAULTS / NTA_GENERAL_NOTES_DEFAULTS
 */

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, RotateCcw, FileDown, Plus, Loader2 } from "lucide-react";
import { exportNtaToDocx } from "@/lib/ntaDocx";
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

/** Format ISO date as "dd Month yyyy" in Indian locale. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

const DEFAULT_DATA: Stage8NtaData = {
  overview: {
    registered_address_override:  null,
    business_activity_override:   null,
    incorporation_date_override:  null,
  },
  policies: NTA_POLICY_META.map(m => ({ id: m.id, title: m.title, body: "" })),
  general_notes: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, body: "" })),
};

function initData(raw: any): Stage8NtaData {
  if (!raw) return structuredClone(DEFAULT_DATA);
  return {
    overview: {
      registered_address_override: raw.overview?.registered_address_override ?? null,
      business_activity_override:  raw.overview?.business_activity_override  ?? null,
      incorporation_date_override: raw.overview?.incorporation_date_override ?? null,
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
 * Inline-editable text: plain span → <input> on click.
 * Commits on blur / Enter; reverts on Escape.
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
  const [draft,   setDraft]   = useState(value);

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

/**
 * Inline date picker: displays as formatted text; clicking activates
 * a native <input type="date"> for override selection.
 */
function DateField({
  value,
  onChange,
  placeholder = "click to set date",
  className = "",
}: {
  value: string;           // ISO YYYY-MM-DD
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = (v: string) => { onChange(v); setEditing(false); };

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={e => {
          if (e.key === "Enter")  { e.preventDefault(); commit(draft); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className={`border-b border-primary outline-none bg-transparent px-0.5 ${className}`}
      />
    );
  }

  const display = fmtDate(value);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={e => e.key === "Enter" && setEditing(true)}
      title="Click to change date"
      className={`cursor-pointer rounded hover:bg-amber-50 underline decoration-dotted underline-offset-2 ${
        display ? "" : "text-muted-foreground italic"
      } ${className}`}
    >
      {display || placeholder}
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

/** Small × delete button (Unicode multiplication sign). */
function DeleteBtn({ onClick, title = "Delete" }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="print:hidden shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors text-base leading-none select-none"
    >
      ×
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CorporateNTA({ engagement, client, onUpdate }: Props) {
  const [data,   setData]   = useState<Stage8NtaData>(() => initData(engagement?.stage8_nta_data));
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-initialise when the user switches engagement
  useEffect(() => {
    setData(initData(engagement?.stage8_nta_data));
  }, [engagement?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const companyName = (client?.name ?? client?.client_name ?? "") as string;
  const cin         = (client?.cin ?? "") as string;

  // Incorporation date: use override if set, else fall back to client master
  const incDateIso  = (data.overview.incorporation_date_override
    ?? client?.date_of_incorporation ?? "") as string;
  const actYear     = getActYear(incDateIso);

  // registered_office is the dedicated column; fall back to general address
  // if it is not set (client wizard saves address into the `address` column,
  // while registered_office may be populated separately or via migration).
  const regAddress  = (data.overview.registered_address_override
    ?? client?.registered_office
    ?? client?.address
    ?? "") as string;
  // business_activity maps to the "Business Nature" field in advanced info of
  // the client management wizard (saved as clients.business_activity).
  const bizActivity = (data.overview.business_activity_override   ?? client?.business_activity  ?? "") as string;

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
    if (!window.confirm(`Delete policy "${data.policies[idx]?.title}"? This cannot be undone.`)) return;
    setData(prev => {
      const policies = prev.policies.filter((_, i) => i !== idx);
      const next = { ...prev, policies };
      scheduleSave(next);
      return next;
    });
  }

  function addPolicy(title: string) {
    setData(prev => {
      const nextNum  = prev.policies.length + 1;
      const newId    = `2.${nextNum}`;
      const policies = [...prev.policies, { id: newId, title: title.trim(), body: "" }];
      const next     = { ...prev, policies };
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
    if (!window.confirm(`Delete general note ${idx + 1}? This cannot be undone.`)) return;
    setData(prev => {
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
      const general_notes = [
        ...prev.general_notes,
        { id: prev.general_notes.length + 1, body: "" },
      ];
      const next = { ...prev, general_notes };
      scheduleSave(next);
      return next;
    });
  }

  function resetToDefaults() {
    if (!window.confirm(
      "Reset ALL policies and general notes to factory defaults?\n\n" +
      "Any custom text you have entered will be replaced. This cannot be undone.",
    )) return;
    const fresh = structuredClone(DEFAULT_DATA);
    setData(fresh);
    scheduleSave(fresh);
    toast.info("Reset to defaults — auto-saving…");
  }

  // ── Export Word ───────────────────────────────────────────────────────────
  function handleExportWord() {
    const fyLabel = (engagement?.financial_year ?? "").replace("/", "-");
    const safeName = (companyName || "Company").replace(/[^a-zA-Z0-9_\- ]/g, "_");
    exportNtaToDocx(
      {
        companyName,
        cin,
        incDateIso,
        regAddress,
        bizActivity,
        financialYear: fyLabel,
        data,
      },
      `Notes_to_Accounts_${safeName}_FY${fyLabel}.docx`,
    );
  }

  // ── Add-policy inline form ─────────────────────────────────────────────────
  const [showAddPolicy,  setShowAddPolicy]  = useState(false);
  const [newPolicyTitle, setNewPolicyTitle] = useState("");

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-16 print:pb-0">

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetToDefaults} disabled={saving}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset to Defaults
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportWord}>
            <FileDown className="w-3.5 h-3.5 mr-1" /> Export Word
          </Button>
          <Button size="sm" onClick={saveNow} disabled={saving}>
            {saving
              ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              : <Save className="w-3.5 h-3.5 mr-1" />}
            Save All
          </Button>
        </div>
      </div>

      {/* ── Note title ──────────────────────────────────────────────────── */}
      <div className="border-b pb-3">
        <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">
          Note No: 1
        </p>
        <h2 className="text-sm font-bold uppercase tracking-wide text-foreground leading-snug">
          DISCLOSURE OF ACCOUNTING POLICIES &amp; NOTES FORMING PART OF THE ANNUAL ACCOUNTS
        </h2>
      </div>

      {/* ── Section (a) — Overview ───────────────────────────────────────── */}
      <section className="border rounded-lg p-5 space-y-3 bg-card">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Section (a) — Overview of the Reporting Entity
        </h3>

        <div className="text-sm leading-relaxed text-foreground space-y-2">
          <p>
            <span className="font-semibold">{companyName || "[Company Name]"}</span>
            {" "}(hereinafter referred to as "the Company") is a company incorporated
            under the Companies Act,{" "}
            <span className="font-semibold">{actYear}</span> on{" "}
            <DateField
              value={incDateIso}
              onChange={v => updateOverview("incorporation_date_override", v)}
              placeholder="click to set incorporation date"
              className="font-semibold"
            />
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

      {/* ── Section (b) — Significant Accounting Policies + 2.19 ─────────── */}
      <section className="border rounded-lg p-5 space-y-5 bg-card">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Section (b) — Significant Accounting Policies
        </h3>

        {/* Policies 2.1 – 2.18 (+ any user-added) */}
        {data.policies.map((policy, idx) => (
          <div
            key={`${policy.id}-${idx}`}
            className="border-b last:border-b-0 pb-4 last:pb-0 space-y-1.5"
          >
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
              <DeleteBtn
                onClick={() => deletePolicy(idx)}
                title={`Delete policy ${policy.id}`}
              />
            </div>

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

        {/* ── 2.19 General Notes ────────────────────────────────────────── */}
        <div className="border rounded-md p-4 space-y-3 bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            2.19 — General Notes
          </p>

          {data.general_notes.map((note, idx) => (
            <div
              key={note.id}
              className="flex gap-3 items-start border-b last:border-b-0 pb-2.5 last:pb-0"
            >
              <span className="text-sm font-semibold text-muted-foreground w-5 pt-2 shrink-0 select-none">
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
              <DeleteBtn
                onClick={() => deleteGeneralNote(idx)}
                title={`Delete general note ${note.id}`}
              />
            </div>
          ))}

          <div className="print:hidden pt-1">
            <Button variant="outline" size="sm" onClick={addGeneralNote}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add General Note
            </Button>
          </div>
        </div>

        {/* ── Add-policy form / button ───────────────────────────────────── */}
        <div className="print:hidden">
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

    </div>
  );
}
