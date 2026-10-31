import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserFirmAccess } from "@/hooks/useUserFirmAccess";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import {
  Bell, Building2, Users, User, Layers, Plus, Play, Eye, RefreshCw, Trash2, Save, Mail, Search, Clock, AlertTriangle,
  ChevronDown, ChevronRight, Download, PauseCircle, IndianRupee, Settings2, FileText, Send,
} from "lucide-react";
import EmailTemplatesTab, { type TemplateType } from "./EmailTemplatesTab";
import { describeInvoice, describeLedger, WEEKDAYS } from "@/lib/billingReminderRules";
import { checkRuleConflicts, type ConflictReport } from "./reminderRuleConflicts";

// ─── Types ────────────────────────────────────────────────────────────────────
// Tables from 20261021120000_billing_reminder_policies.sql. The engine that
// reads them is the billing-reminders edge function.

type ScopeType = "firm_group" | "firm" | "client_group" | "client";

interface Scope {
  type: ScopeType;
  id: string;
  name: string;
  firmId: string | null; // owning firm (null for firm groups)
}

interface Policy {
  id?: string;
  scope_type: ScopeType;
  firm_group_id?: string | null;
  firm_id?: string | null;
  client_group_id?: string | null;
  client_id?: string | null;
  invoice_enabled: boolean | null;
  invoice_start_days: number | null;
  invoice_repeat_days: number | null;
  invoice_max_count: number | null;
  invoice_min_amount: number | null;
  invoice_timing: "interval" | "schedule" | null;
  invoice_schedule_days: number[] | null;
  escalate_after: number | null;
  escalate_cc: string[] | null;
  send_weekdays: number[] | null;
  paused_until: string | null;
  ledger_enabled: boolean | null;
  ledger_frequency: "monthly" | "quarterly" | null;
  ledger_day: number | null;
  ledger_min_balance: number | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  send_to_responsible: boolean | null;
  notes: string | null;
}

interface FirmGroup { id: string; name: string; firm_ids: string[] }
interface ClientGroup { id: string; name: string; firm_id: string | null }
interface ClientRow { id: string; name: string; email: string | null; firm_id: string }

interface EffectiveRow {
  client_id: string;
  client_name: string;
  firm_name: string;
  groups: string[];
  settings: Record<string, any>;
  source: Record<string, string>;
  to: string[];
  cc: string[];
  outstanding: number;
  open_invoices: number;
  has_client_policy: boolean;
  issues?: { kind: string; message: string }[];
}

interface PreviewResult {
  today: string;
  per_run_cap: number;
  planned: {
    kind: "invoice" | "ledger"; client_name: string; to: string[]; cc: string[]; amount: number;
    period_key: string | null;
    invoices: { invoice_no: string; due_date: string | null; outstanding: number; days_overdue: number; reminder_no: number }[];
  }[];
  skipped: { client_name: string; kind: string; reason: string }[];
}

const emptyPolicy = (scope: Scope): Policy => ({
  scope_type: scope.type,
  firm_group_id: scope.type === "firm_group" ? scope.id : null,
  firm_id: scope.type === "firm" ? scope.id : scope.firmId,
  client_group_id: scope.type === "client_group" ? scope.id : null,
  client_id: scope.type === "client" ? scope.id : null,
  invoice_enabled: null, invoice_start_days: null, invoice_repeat_days: null,
  invoice_max_count: null, invoice_min_amount: null,
  invoice_timing: null, invoice_schedule_days: null, escalate_after: null, escalate_cc: null,
  send_weekdays: null, paused_until: null,
  ledger_enabled: null, ledger_frequency: null, ledger_day: null, ledger_min_balance: null,
  to_emails: null, cc_emails: null, send_to_responsible: null, notes: null,
});

const SCOPE_META: Record<ScopeType, { label: string; icon: typeof Bell }> = {
  firm_group:   { label: "Firm group",   icon: Layers },
  firm:         { label: "Firm",         icon: Building2 },
  client_group: { label: "Client group", icon: Users },
  client:       { label: "Client",       icon: User },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// The two templates the reminder engine sends (billing-reminders edge function).
const REMINDER_TEMPLATE_TYPES: readonly TemplateType[] = ["payment_reminder", "ledger_statement"];
const NO_GROUP = "__none__";

type SortKey = "high" | "low" | "name" | "invoices";
const sortRows = <T extends { outstanding: number; name: string; invoices: number }>(rows: T[], key: SortKey) =>
  [...rows].sort((a, b) =>
    key === "high" ? b.outstanding - a.outstanding
    : key === "low" ? a.outstanding - b.outstanding
    : key === "invoices" ? b.invoices - a.invoices || b.outstanding - a.outstanding
    : a.name.localeCompare(b.name));

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const parseEmails = (s: string): string[] | null => {
  const list = s.split(/[,;\s]+/).map(e => e.trim()).filter(e => e.includes("@"));
  return list.length ? list : null;
};
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const triValue = (v: boolean | null) => (v === null ? "inherit" : v ? "on" : "off");
const fromTri = (v: string): boolean | null => (v === "inherit" ? null : v === "on");

const parseDays = (s: string): number[] | null => {
  const list = s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean).map(Number);
  return list.length ? list : null;
};

// ─── Tri-state select (Inherit / On / Off) ────────────────────────────────────

function TriSelect({ value, onChange, onLabel = "On", offLabel = "Off" }: {
  value: boolean | null; onChange: (v: boolean | null) => void; onLabel?: string; offLabel?: string;
}) {
  return (
    <Select value={triValue(value)} onValueChange={v => onChange(fromTri(v))}>
      <SelectTrigger className="w-[160px] h-8"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">Inherit</SelectItem>
        <SelectItem value="on">{onLabel}</SelectItem>
        <SelectItem value="off">{offLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function EmailListField({ label, value, onChange, placeholder, hint }: {
  label: string; value: string[] | null; onChange: (v: string[] | null) => void; placeholder: string; hint: string;
}) {
  const [text, setText] = useState((value || []).join(", "));
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input className="h-8" placeholder={placeholder} value={text}
        onChange={e => { setText(e.target.value); onChange(parseEmails(e.target.value)); }} />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function DaysListField({ value, onChange }: { value: number[] | null; onChange: (v: number[] | null) => void }) {
  const [text, setText] = useState((value || []).join(", "));
  return (
    <div className="space-y-1">
      <Label className="text-xs">Send on these days (relative to due date)</Label>
      <Input className="h-8 w-72" placeholder="e.g. -3, 0, 7, 15, 30" value={text}
        onChange={e => { setText(e.target.value); onChange(parseDays(e.target.value)); }} />
      <p className="text-[11px] text-muted-foreground">Negative = before the due date. One reminder on each day, in order.</p>
    </div>
  );
}

function NumField({ label, value, onChange, hint, min, max, width = "w-24" }: {
  label: string; value: number | null; onChange: (v: number | null) => void;
  hint?: string; min?: number; max?: number; width?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number" min={min} max={max} className={`${width} h-8`} placeholder="Inherit"
        value={value ?? ""} onChange={e => onChange(numOrNull(e.target.value))}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Policy editor ────────────────────────────────────────────────────────────

function PolicyEditor({
  scope, policy, onChange, effective,
}: {
  scope: Scope;
  policy: Policy;
  onChange: (patch: Partial<Policy>) => void;
  effective: EffectiveRow | null;
}) {
  const startDays = policy.invoice_start_days;
  // Direction is held separately so "before" can be picked before a number is typed.
  const [startDir, setStartDir] = useState(
    startDays === null ? "after" : startDays < 0 ? "before" : startDays === 0 ? "on" : "after");
  const setStart = (n: number | null, dir: string) => {
    setStartDir(dir);
    onChange({ invoice_start_days: dir === "on" ? 0 : n === null ? null : dir === "before" ? -Math.abs(n) : Math.abs(n) });
  };

  return (
    <div className="space-y-5">
      {effective && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
          <p className="font-medium text-sm">Currently in effect for this client</p>
          <p>Invoice reminders: <strong>{describeInvoice(effective.settings)}</strong> <span className="text-muted-foreground">({effective.source.invoice_enabled})</span></p>
          <p>Statement of Account: <strong>{describeLedger(effective.settings)}</strong> <span className="text-muted-foreground">({effective.source.ledger_enabled})</span></p>
          <p>To: <strong>{effective.to.join(", ") || "— no email —"}</strong>{effective.cc.length > 0 && <> · CC: {effective.cc.join(", ")}</>}</p>
        </div>
      )}

      {/* Invoice reminders */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">Invoice payment reminders</h4>
            <p className="text-xs text-muted-foreground">All of a client's due invoices go in one email.</p>
          </div>
          <TriSelect value={policy.invoice_enabled} onChange={v => onChange({ invoice_enabled: v })} onLabel="Send" offLabel="Don't send" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Timing</Label>
          <Select value={policy.invoice_timing ?? "inherit"}
            onValueChange={v => onChange({ invoice_timing: v === "inherit" ? null : v as "interval" | "schedule" })}>
            <SelectTrigger className="w-[260px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit</SelectItem>
              <SelectItem value="interval">Repeat interval (first + every N days)</SelectItem>
              <SelectItem value="schedule">Fixed schedule (exact days)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {policy.invoice_timing === "schedule" ? (
          <div className="flex flex-wrap gap-4">
            <DaysListField key={`sched-${scope.type}-${scope.id}-${policy.id ?? "new"}`}
              value={policy.invoice_schedule_days} onChange={v => onChange({ invoice_schedule_days: v })} />
            <NumField label="Skip if outstanding below ₹" value={policy.invoice_min_amount} min={0} width="w-28" onChange={v => onChange({ invoice_min_amount: v })} />
          </div>
        ) : (
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label className="text-xs">First reminder</Label>
            <div className="flex gap-2">
              {startDir !== "on" && (
                <Input
                  type="number" min={0} max={365} className="w-20 h-8" placeholder="Inherit"
                  value={startDays === null ? "" : Math.abs(startDays)}
                  onChange={e => setStart(numOrNull(e.target.value), startDir)}
                />
              )}
              <Select value={startDir} onValueChange={dir => setStart(startDays === null ? null : Math.abs(startDays), dir)}>
                <SelectTrigger className="w-[150px] h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="before">days before due</SelectItem>
                  <SelectItem value="on">on the due date</SelectItem>
                  <SelectItem value="after">days after due</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <NumField label="Then repeat every (days)" value={policy.invoice_repeat_days} min={1} onChange={v => onChange({ invoice_repeat_days: v })} />
          <NumField label="Max reminders per invoice" value={policy.invoice_max_count} min={1} onChange={v => onChange({ invoice_max_count: v })} />
          <NumField label="Skip if outstanding below ₹" value={policy.invoice_min_amount} min={0} width="w-28" onChange={v => onChange({ invoice_min_amount: v })} />
        </div>
        )}
        <div className="flex flex-wrap gap-4 items-start">
          <NumField label="Escalate from reminder no." value={policy.escalate_after} min={1} hint="e.g. 3 = the 3rd reminder onwards" onChange={v => onChange({ escalate_after: v })} />
          <div className="flex-1 min-w-[240px]">
            <EmailListField
              key={`esc-${scope.type}-${scope.id}-${policy.id ?? "new"}`}
              label="…and then also CC"
              placeholder="e.g. partner@yourfirm.com"
              hint="Added to CC on escalated reminders only."
              value={policy.escalate_cc} onChange={v => onChange({ escalate_cc: v })}
            />
          </div>
        </div>
      </section>

      {/* Statement of Account (outstanding invoices) */}
      <section className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">Statement of Account (outstanding invoices)</h4>
            <p className="text-xs text-muted-foreground">A table of every unpaid invoice with the total, once per period.</p>
          </div>
          <TriSelect value={policy.ledger_enabled} onChange={v => onChange({ ledger_enabled: v })} onLabel="Send" offLabel="Don't send" />
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Frequency</Label>
            <Select value={policy.ledger_frequency ?? "inherit"} onValueChange={v => onChange({ ledger_frequency: v === "inherit" ? null : v as "monthly" | "quarterly" })}>
              <SelectTrigger className="w-[190px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly (Jan/Apr/Jul/Oct)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <NumField label="On day of month" value={policy.ledger_day} min={1} max={28} hint="1–28" onChange={v => onChange({ ledger_day: v })} />
          <NumField label="Skip if total below ₹" value={policy.ledger_min_balance} min={0} width="w-28" onChange={v => onChange({ ledger_min_balance: v })} />
        </div>
      </section>

      {/* When to send (both kinds) */}
      <section className="space-y-3 border-t pt-4">
        <h4 className="text-sm font-semibold">When to send</h4>
        <div className="flex flex-wrap gap-6 items-start">
          <div className="space-y-1">
            <Label className="text-xs">Sending days</Label>
            <Select value={policy.send_weekdays == null ? "inherit" : "custom"}
              onValueChange={v => onChange({ send_weekdays: v === "inherit" ? null : [1, 2, 3, 4, 5, 6] })}>
              <SelectTrigger className="w-[190px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit (default: every day)</SelectItem>
                <SelectItem value="custom">Only on chosen days</SelectItem>
              </SelectContent>
            </Select>
            {policy.send_weekdays != null && (
              <div className="flex gap-2 pt-1">
                {WEEKDAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1 text-xs cursor-pointer">
                    <Checkbox checked={policy.send_weekdays!.includes(i)}
                      onCheckedChange={v => onChange({
                        send_weekdays: v ? [...policy.send_weekdays!, i].sort() : policy.send_weekdays!.filter(x => x !== i),
                      })} />
                    {d}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pause everything until</Label>
            <div className="flex gap-1">
              <Input type="date" className="h-8 w-40" value={policy.paused_until ?? ""}
                onChange={e => onChange({ paused_until: e.target.value || null })} />
              {policy.paused_until && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onChange({ paused_until: null })}>Clear</Button>}
            </div>
            <p className="text-[11px] text-muted-foreground">E.g. payment promised or invoice disputed. Blank = inherit.</p>
          </div>
        </div>
      </section>

      {/* Recipients */}
      <section className="space-y-3 border-t pt-4">
        <h4 className="text-sm font-semibold">Recipients</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <EmailListField
            key={`to-${scope.type}-${scope.id}-${policy.id ?? "new"}`}
            label="Send to (instead of the client's email)"
            placeholder={scope.type === "client" ? "Blank = client's own email" : "Inherit"}
            hint="Comma-separated. Usually set only for a client or client group."
            value={policy.to_emails} onChange={v => onChange({ to_emails: v })}
          />
          <EmailListField
            key={`cc-${scope.type}-${scope.id}-${policy.id ?? "new"}`}
            label="Also CC"
            placeholder="e.g. accounts@yourfirm.com"
            hint="CC adds up across levels (firm group + firm + group + client)."
            value={policy.cc_emails} onChange={v => onChange({ cc_emails: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">CC the client's responsible person</Label>
          <TriSelect value={policy.send_to_responsible} onChange={v => onChange({ send_to_responsible: v })} onLabel="Yes" offLabel="No" />
        </div>
      </section>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BillingRemindersTab({
  firmId,
  userId,
}: {
  firmId: string | null;
  userId: string | null;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { allAccessibleFirms } = useUserFirmAccess();
  const isSuperadmin = user?.role === "superadmin";
  const resolvedFirmId = firmId ?? user?.firm_id ?? null;
  const resolvedUserId = userId ?? user?.id ?? null;

  const [firmRows, setFirmRows] = useState<{ id: string; name: string }[]>([]);
  const [firmGroups, setFirmGroups] = useState<FirmGroup[]>([]);
  const [clientGroups, setClientGroups] = useState<ClientGroup[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [lastRun, setLastRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [effective, setEffective] = useState<EffectiveRow[] | null>(null);
  const [effectiveError, setEffectiveError] = useState<string | null>(null);
  const [effectiveLoading, setEffectiveLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState<"all" | "send" | "nosend" | "custom" | "conflict">("all");
  const [tableSearch, setTableSearch] = useState("");
  const [viewMode, setViewMode] = useState<"client" | "group">("client");
  const [groupFilter, setGroupFilter] = useState<string>("all"); // group name, NO_GROUP or "all"
  const [sortBy, setSortBy] = useState<SortKey>("high");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pauseDate, setPauseDate] = useState<string | null>(null);
  const [section, setSection] = useState("outstanding");
  const [sidebarOutstandingOnly, setSidebarOutstandingOnly] = useState(true);
  const [sendTarget, setSendTarget] = useState<{ row: EffectiveRow; kind: "invoice" | "ledger" } | null>(null);
  const [sendingClient, setSendingClient] = useState(false);

  const [selected, setSelected] = useState<Scope | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [clientSearch, setClientSearch] = useState("");

  const [senderEmail, setSenderEmail] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");

  const [fgDialog, setFgDialog] = useState<{ id?: string; name: string; firm_ids: string[] } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);

  // ── Loading ──
  const fetchAll = useCallback(async () => {
    if (!resolvedFirmId) { setLoading(false); return; }
    setLoading(true);
    const sb = supabase as any;
    const [fgRes, fgmRes, cgRes, cRes, pRes, runRes, firmsRes] = await Promise.all([
      sb.from("firm_groups").select("id, name").order("name"),
      sb.from("firm_group_members").select("firm_group_id, firm_id"),
      // Client groups are usually global (firm_id NULL — wizard and customer sync create them that way).
      sb.from("client_groups").select("id, name, firm_id").or(`firm_id.eq.${resolvedFirmId},firm_id.is.null`).order("name"),
      sb.from("clients").select("id, name, email, firm_id").eq("firm_id", resolvedFirmId)
        .eq("is_draft", false).is("deleted_at", null).order("name"),
      sb.from("billing_reminder_policies").select("*")
        .or(`firm_id.eq.${resolvedFirmId},scope_type.eq.firm_group,scope_type.eq.client_group`),
      sb.from("billing_reminder_runs").select("*")
        .or(`firm_id.eq.${resolvedFirmId},firm_id.is.null`)
        .order("started_at", { ascending: false }).limit(1),
      isSuperadmin ? sb.from("firms").select("id, name, settings").order("name")
                   : sb.from("firms").select("id, name, settings").eq("id", resolvedFirmId),
    ]);
    const members = (fgmRes.data || []) as { firm_group_id: string; firm_id: string }[];
    setFirmGroups(((fgRes.data || []) as any[]).map(g => ({
      ...g, firm_ids: members.filter(m => m.firm_group_id === g.id).map(m => m.firm_id),
    })));
    setClientGroups(cgRes.data || []);
    setClients(cRes.data || []);
    setPolicies(pRes.data || []);
    setLastRun(runRes.data?.[0] ?? null);
    const firmRows = (firmsRes.data || []) as any[];
    const current = firmRows.find(f => f.id === resolvedFirmId);
    setSenderEmail(current?.settings?.sender_email ?? "");
    setReplyToEmail(current?.settings?.reply_to_email ?? "");
    setFirmRows(firmRows.map(f => ({ id: f.id, name: f.name })));
    setLoading(false);
  }, [resolvedFirmId, isSuperadmin]);

  // useUserFirmAccess returns a fresh array every render — key the memo on ids.
  const accessibleKey = allAccessibleFirms.map(f => f.id).join(",");
  const firms = useMemo(
    () => (isSuperadmin || allAccessibleFirms.length === 0 ? firmRows : allAccessibleFirms),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSuperadmin, firmRows, accessibleKey],
  );

  const fetchEffective = useCallback(async () => {
    if (!resolvedFirmId) return;
    setEffectiveLoading(true);
    setEffectiveError(null);
    const { data, error } = await supabase.functions.invoke("billing-reminders", {
      body: { action: "effective", firm_ids: [resolvedFirmId] },
    });
    if (error || !(data as any)?.success) {
      setEffectiveError((data as any)?.error || error?.message || "Could not load");
      setEffective(null);
    } else {
      setEffective((data as any).clients as EffectiveRow[]);
    }
    setEffectiveLoading(false);
  }, [resolvedFirmId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { fetchEffective(); }, [fetchEffective]);

  // Default selection: the current firm — also after the parent switches firm.
  // (A separate reset effect used to run after this one and leave the editor empty.)
  const [selectedForFirm, setSelectedForFirm] = useState<string | null>(null);
  useEffect(() => {
    if (!resolvedFirmId || !firms.length) return;
    if (selected && selectedForFirm === resolvedFirmId) return;
    const f = firms.find(x => x.id === resolvedFirmId);
    if (f) { selectScope({ type: "firm", id: f.id, name: f.name, firmId: f.id }); setSelectedForFirm(resolvedFirmId); }
    else { setSelected(null); setDraft(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firms, resolvedFirmId]);

  const policyFor = useCallback((scope: Scope) => policies.find(p =>
    p.scope_type === scope.type && (
      (scope.type === "firm_group" && p.firm_group_id === scope.id) ||
      (scope.type === "firm" && p.firm_id === scope.id) ||
      (scope.type === "client_group" && p.client_group_id === scope.id) ||
      (scope.type === "client" && p.client_id === scope.id))), [policies]);

  // Re-sync the editor after any save, so a newly inserted row carries its id.
  useEffect(() => {
    if (selected) { const p = policyFor(selected); setDraft({ ...emptyPolicy(selected), ...(p || {}) }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies]);

  function selectScope(scope: Scope) {
    setConflicts(null);
    setSelected(scope);
    setDraft({ ...emptyPolicy(scope), ...(policyFor(scope) || {}) });
  }

  // ── Conflict check (re-run 600 ms after the last edit, and again on save) ──
  const runConflictCheck = useCallback(async (p: Policy, scope: Scope) => {
    setChecking(true);
    try {
      const report = await checkRuleConflicts(p, { type: scope.type, id: scope.id });
      setConflicts(report);
      return report;
    } catch (err: any) {
      const report = { own: [`Could not check for conflicts: ${err.message}`], cross: [], checked: 0 };
      setConflicts(report);
      return report;
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (!draft || !selected) return;
    const t = setTimeout(() => runConflictCheck(draft, selected), 600);
    return () => clearTimeout(t);
  }, [draft, selected, runConflictCheck]);
  const blocked = !!conflicts && (conflicts.own.length > 0 || conflicts.cross.length > 0);

  // ── Save / clear policy ──
  const savePolicy = async () => {
    if (!draft || !selected) return;
    setSaving(true);
    try {
      // Never save a rule that conflicts — check again against the latest data.
      const report = await runConflictCheck(draft, selected);
      if (report.own.length || report.cross.length) {
        toast({
          title: "Not saved — this rule conflicts",
          description: "Fix the conflicts listed above the Save button, then save again.",
          variant: "destructive",
        });
        return;
      }
      const { id, ...rest } = draft as any;
      const row = { ...rest, updated_by: resolvedUserId, updated_at: new Date().toISOString() };
      const sb = supabase as any;
      const { error } = id
        ? await sb.from("billing_reminder_policies").update(row).eq("id", id)
        : await sb.from("billing_reminder_policies").insert(row);
      if (error) throw error;

      if (selected.type === "firm") {
        const { data: f } = await sb.from("firms").select("settings").eq("id", selected.id).maybeSingle();
        const settings = { ...(f?.settings || {}) };
        const s = senderEmail.trim(), r = replyToEmail.trim();
        if (s) settings.sender_email = s; else delete settings.sender_email;
        if (r) settings.reply_to_email = r; else delete settings.reply_to_email;
        const { error: fErr } = await sb.from("firms").update({ settings }).eq("id", selected.id);
        if (fErr) throw fErr;
      }
      toast({ title: `Saved — ${SCOPE_META[selected.type].label}: ${selected.name}` });
      await fetchAll();
      fetchEffective();
    } catch (err: any) {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const clearPolicy = async () => {
    if (!draft?.id || !selected) return;
    const report = await checkRuleConflicts(emptyPolicy(selected), { type: selected.type, id: selected.id });
    if (report.cross.length) {
      setConflicts(report);
      toast({
        title: "Not reset — the rules above would then conflict",
        description: report.cross[0].message,
        variant: "destructive",
      });
      return;
    }
    const { error } = await (supabase as any).from("billing_reminder_policies").delete().eq("id", draft.id);
    if (error) { toast({ title: "Could not clear", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${selected.name} now inherits every setting` });
    setDraft(emptyPolicy(selected));
    await fetchAll();
    fetchEffective();
  };

  // Write the same client-level change to one or many clients (table quick-select and bulk actions).
  // Each client is conflict-checked on its own; a conflicting one is skipped, the rest still go through.
  const patchClients = async (rows: EffectiveRow[], change: Partial<Policy>, label: string) => {
    if (!rows.length) return;
    setBulkBusy(true);
    const sb = supabase as any;
    const failed: string[] = [];
    let done = 0;
    for (const row of rows) {
      const scope: Scope = { type: "client", id: row.client_id, name: row.client_name, firmId: resolvedFirmId };
      const existing = policyFor(scope);
      const patch = { ...change, updated_by: resolvedUserId, updated_at: new Date().toISOString() };
      const report = await checkRuleConflicts({ ...emptyPolicy(scope), ...(existing || {}), ...patch }, { type: "client", id: scope.id });
      if (report.own.length || report.cross.length) {
        failed.push(`${row.client_name}: ${[...report.own, ...report.cross.map(c => c.message)][0]}`);
        continue;
      }
      const { error } = existing?.id
        ? await sb.from("billing_reminder_policies").update(patch).eq("id", existing.id)
        : await sb.from("billing_reminder_policies").insert({ ...emptyPolicy(scope), ...patch });
      if (error) failed.push(`${row.client_name}: ${error.message}`); else done++;
    }
    setBulkBusy(false);
    if (failed.length) {
      toast({
        title: `${label}: ${done} updated, ${failed.length} not changed`,
        description: failed.slice(0, 3).join(" · ") + (failed.length > 3 ? ` and ${failed.length - 3} more` : ""),
        variant: "destructive",
      });
    } else if (rows.length > 1) {
      toast({ title: `${label}: ${done} client${done !== 1 ? "s" : ""} updated` });
    }
    setChecked(new Set());
    await fetchAll();
    fetchEffective();
  };

  const sendFlag = (value: "inherit" | "send" | "nosend"): Partial<Policy> => {
    const flag = value === "inherit" ? null : value === "send";
    return { invoice_enabled: flag, ledger_enabled: flag };
  };
  const setClientSend = (row: EffectiveRow, value: "inherit" | "send" | "nosend") =>
    patchClients([row], sendFlag(value), "Reminders");

  // ── Firm groups ──
  const saveFirmGroup = async () => {
    if (!fgDialog?.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    const sb = supabase as any;
    let groupId = fgDialog.id;
    if (groupId) {
      await sb.from("firm_groups").update({ name: fgDialog.name.trim() }).eq("id", groupId);
      await sb.from("firm_group_members").delete().eq("firm_group_id", groupId);
    } else {
      const { data, error } = await sb.from("firm_groups")
        .insert({ name: fgDialog.name.trim(), created_by: resolvedUserId }).select("id").single();
      if (error) { toast({ title: "Could not create group", description: error.message, variant: "destructive" }); return; }
      groupId = data.id;
    }
    if (fgDialog.firm_ids.length) {
      await sb.from("firm_group_members").insert(fgDialog.firm_ids.map(f => ({ firm_group_id: groupId, firm_id: f })));
    }
    setFgDialog(null);
    await fetchAll();
    fetchEffective();
  };

  const deleteFirmGroup = async (id: string) => {
    await (supabase as any).from("firm_groups").delete().eq("id", id);
    if (selected?.type === "firm_group" && selected.id === id) { setSelected(null); setDraft(null); }
    await fetchAll();
    fetchEffective();
  };

  // ── Preview / run ──
  const runAction = async (action: "preview" | "run") => {
    if (!resolvedFirmId) return;
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("billing-reminders", {
        body: { action, firm_ids: [resolvedFirmId] },
      });
      const d = data as any;
      if (error || !d?.success) throw new Error(d?.error || error?.message || "Request failed");
      if (action === "preview") setPreview(d as PreviewResult);
      else if (d.busy) toast({ title: "A reminder run is already in progress — try again in a few minutes" });
      else {
        toast({
          title: `Reminders sent: ${d.sent}${d.failed ? `, ${d.failed} failed` : ""}`,
          description: d.pending ? `${d.pending} more will go in the next hourly run.` : d.error || undefined,
          variant: d.failed || d.error ? "destructive" : undefined,
        });
        fetchAll();
      }
    } catch (err: any) {
      toast({ title: action === "preview" ? "Preview failed" : "Run failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(null);
      setConfirmRun(false);
    }
  };

  // ── Send one client a reminder / statement right now ──
  const sendClientNow = async () => {
    if (!sendTarget || !resolvedFirmId) return;
    const { row, kind } = sendTarget;
    setSendingClient(true);
    try {
      const { data, error } = await supabase.functions.invoke("billing-reminders", {
        body: { action: "send_client", firm_ids: [resolvedFirmId], client_id: row.client_id, kind },
      });
      const d = data as any;
      if (error || !d?.success) throw new Error(d?.error || error?.message || "Request failed");
      toast({
        title: `${kind === "invoice" ? "Payment reminder" : "Statement of Account"} sent to ${row.client_name}`,
        description: `${d.invoices} invoice${d.invoices !== 1 ? "s" : ""} · ${inr(d.amount)} · to ${d.to.join(", ")}`,
      });
      setSendTarget(null);
      fetchAll();
    } catch (err: any) {
      toast({ title: `Could not send to ${row.client_name}`, description: err.message, variant: "destructive" });
    } finally {
      setSendingClient(false);
    }
  };

  // ── Derived ──
  // Only clients with something outstanding are listed; the rest have nothing to remind about.
  const outstandingRows = useMemo(() => (effective || []).filter(r => r.outstanding > 0), [effective]);
  const outstandingIds = useMemo(() => new Set(outstandingRows.map(r => r.client_id)), [outstandingRows]);
  const outstandingGroups = useMemo(() => new Set(outstandingRows.flatMap(r => r.groups)), [outstandingRows]);
  const groupOptions = useMemo(() => [...outstandingGroups].sort((a, b) => a.localeCompare(b)), [outstandingGroups]);
  const filterSidebar = sidebarOutstandingOnly && !!effective;

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const pool = filterSidebar ? clients.filter(c => outstandingIds.has(c.id)) : clients;
    return (q ? pool.filter(c => c.name.toLowerCase().includes(q)) : pool).slice(0, 60);
  }, [clients, clientSearch, filterSidebar, outstandingIds]);
  const sidebarClientTotal = filterSidebar ? clients.filter(c => outstandingIds.has(c.id)).length : clients.length;
  const sidebarGroups = filterSidebar ? clientGroups.filter(g => outstandingGroups.has(g.name)) : clientGroups;

  const tableRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const rows = outstandingRows.filter(r => {
      if (q && !r.client_name.toLowerCase().includes(q) && !r.groups.some(g => g.toLowerCase().includes(q))) return false;
      if (groupFilter === NO_GROUP && r.groups.length) return false;
      if (groupFilter !== "all" && groupFilter !== NO_GROUP && !r.groups.includes(groupFilter)) return false;
      const sends = r.settings.invoice_enabled || r.settings.ledger_enabled;
      if (tableFilter === "send") return sends;
      if (tableFilter === "nosend") return !sends;
      if (tableFilter === "custom") return r.has_client_policy;
      if (tableFilter === "conflict") return (r.issues || []).length > 0;
      return true;
    });
    return sortRows(rows.map(r => ({ ...r, name: r.client_name, invoices: r.open_invoices })), sortBy);
  }, [outstandingRows, tableFilter, tableSearch, groupFilter, sortBy]);

  // Group-wise view: a client in two groups is listed under both; one with none goes under "No group".
  const groupRows = useMemo(() => {
    const map = new Map<string, EffectiveRow[]>();
    for (const r of tableRows) {
      const names = r.groups.length ? r.groups : [NO_GROUP];
      for (const g of names) {
        if (groupFilter !== "all" && g !== groupFilter) continue;
        map.set(g, [...(map.get(g) || []), r]);
      }
    }
    return sortRows([...map.entries()].map(([key, rows]) => ({
      key, name: key === NO_GROUP ? "No group" : key, rows,
      outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      invoices: rows.reduce((s, r) => s + r.open_invoices, 0),
    })), sortBy);
  }, [tableRows, groupFilter, sortBy]);

  const counts = useMemo(() => {
    const rows = outstandingRows;
    const send = rows.filter(r => r.settings.invoice_enabled || r.settings.ledger_enabled).length;
    return {
      total: rows.length, send, nosend: rows.length - send,
      noEmail: rows.filter(r => r.to.length === 0).length,
      conflict: rows.filter(r => (r.issues || []).length > 0).length,
      amount: rows.reduce((s, r) => s + r.outstanding, 0),
      invoices: rows.reduce((s, r) => s + r.open_invoices, 0),
      groups: outstandingGroups.size,
      shownAmount: tableRows.reduce((s, r) => s + r.outstanding, 0),
    };
  }, [outstandingRows, outstandingGroups, tableRows]);

  const checkedRows = useMemo(() => outstandingRows.filter(r => checked.has(r.client_id)), [outstandingRows, checked]);
  const toggleChecked = (ids: string[], on: boolean) => setChecked(prev => {
    const next = new Set(prev);
    ids.forEach(id => (on ? next.add(id) : next.delete(id)));
    return next;
  });

  const exportCsv = () => {
    const header = ["Client", "Groups", "Open invoices", "Outstanding", "Invoice reminders", "Statement of Account", "To", "CC"];
    const lines = tableRows.map(r => [
      r.client_name, r.groups.join("; "), r.open_invoices, r.outstanding.toFixed(2),
      describeInvoice(r.settings), describeLedger(r.settings), r.to.join("; "), r.cc.join("; "),
    ].map(csvCell).join(","));
    const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outstanding-reminders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openClient = (r: EffectiveRow) => {
    selectScope({ type: "client", id: r.client_id, name: r.client_name, firmId: resolvedFirmId });
    setSection("rules");
  };
  const openGroup = (name: string) => {
    const g = clientGroups.find(x => x.name === name);
    if (!g) return;
    selectScope({ type: "client_group", id: g.id, name: g.name, firmId: g.firm_id });
    setSection("rules");
  };

  const selectedEffective = selected?.type === "client"
    ? (effective || []).find(r => r.client_id === selected.id) ?? null : null;

  const hasPolicy = (scope: Scope) => !!policyFor(scope);

  const ScopeButton = ({ scope, extra }: { scope: Scope; extra?: ReactNode }) => {
    const Icon = SCOPE_META[scope.type].icon;
    const active = selected?.type === scope.type && selected.id === scope.id;
    return (
      <div className={`flex items-center gap-1 rounded px-2 py-1 text-sm cursor-pointer ${active ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}
        onClick={() => selectScope(scope)}>
        <Icon size={13} className="shrink-0" />
        <span className="truncate flex-1">{scope.name}</span>
        {hasPolicy(scope) && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" title="Has its own settings" />}
        {extra}
      </div>
    );
  };

  const renderClientRow = (r: EffectiveRow, groupKey?: string) => {
    const cp = policies.find(p => p.scope_type === "client" && p.client_id === r.client_id);
    const quick = !cp || (cp.invoice_enabled === null && cp.ledger_enabled === null) ? "inherit"
      : cp.invoice_enabled === true && cp.ledger_enabled === true ? "send"
      : cp.invoice_enabled === false && cp.ledger_enabled === false ? "nosend" : "custom";
    const paused = r.settings.paused_until && r.settings.paused_until >= new Date().toISOString().slice(0, 10);
    return (
      <TableRow key={groupKey ? `${groupKey}-${r.client_id}` : r.client_id}>
        <TableCell>
          <Checkbox checked={checked.has(r.client_id)} onCheckedChange={v => toggleChecked([r.client_id], !!v)} aria-label={`Select ${r.client_name}`} />
        </TableCell>
        <TableCell className={`text-sm ${groupKey ? "pl-8" : ""}`}>
          <button className="text-left hover:underline font-medium" onClick={() => openClient(r)}>
            {r.client_name}
          </button>
          {!groupKey && r.groups.length > 0 && <div className="text-[11px] text-muted-foreground">{r.groups.join(", ")}</div>}
          {paused && <div className="text-[11px] text-amber-600">Paused until {r.settings.paused_until}</div>}
          {(r.issues || []).map((i, k) => (
            <div key={k} className="text-[11px] text-destructive flex gap-1 items-start mt-0.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {i.message}
            </div>
          ))}
        </TableCell>
        <TableCell>
          <Select value={quick} onValueChange={v => v !== "custom" && setClientSend(r, v as "inherit" | "send" | "nosend")}>
            <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit</SelectItem>
              <SelectItem value="send">Send</SelectItem>
              <SelectItem value="nosend">Don't send</SelectItem>
              {quick === "custom" && <SelectItem value="custom">Custom</SelectItem>}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="text-xs">
          <div className={r.settings.invoice_enabled ? "" : "text-muted-foreground"}>{describeInvoice(r.settings)}</div>
          <div className="text-[10px] text-muted-foreground">{r.source.invoice_enabled}</div>
        </TableCell>
        <TableCell className="text-xs">
          <div className={r.settings.ledger_enabled ? "" : "text-muted-foreground"}>{describeLedger(r.settings)}</div>
          <div className="text-[10px] text-muted-foreground">{r.source.ledger_enabled}</div>
        </TableCell>
        <TableCell className="text-xs max-w-[240px]">
          <div className="truncate" title={r.to.join(", ")}>{r.to.join(", ") || <span className="text-amber-600">No email</span>}</div>
          {r.cc.length > 0 && <div className="truncate text-[10px] text-muted-foreground" title={r.cc.join(", ")}>CC: {r.cc.join(", ")}</div>}
        </TableCell>
        <TableCell className="text-right text-xs">
          {inr(r.outstanding)}
          {r.open_invoices > 0 && <div className="text-[10px] text-muted-foreground">{r.open_invoices} invoice{r.open_invoices !== 1 ? "s" : ""}</div>}
        </TableCell>
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={r.to.length === 0}
                title={r.to.length === 0 ? "No email address for this client" : "Send a reminder to this client now"}>
                <Send size={12} /> Send now <ChevronDown size={11} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSendTarget({ row: r, kind: "invoice" })}>
                <Bell size={13} className="mr-2" /> Payment reminder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSendTarget({ row: r, kind: "ledger" })}>
                <FileText size={13} className="mr-2" /> Statement of Account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  };

  if (loading && !firms.length) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header + engine status */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Bell size={18} /> Billing Reminders</h2>
          <p className="text-sm text-muted-foreground">
            Settings for each firm group, firm, client group and client, all in one place. The most specific level wins:
            client → client group → firm → firm group. A rule that conflicts with another (for example two groups of
            the same client asking for different things) can't be saved.
          </p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Clock size={12} /> Runs automatically every day at 10:00 IST.
            {lastRun
              ? <> Last run {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })} ({lastRun.trigger}): {lastRun.sent} sent{lastRun.failed ? `, ${lastRun.failed} failed` : ""}{lastRun.error ? ` — ${lastRun.error}` : ""}.</>
              : <> No runs yet.</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => runAction("preview")} disabled={!!busy}>
            {busy === "preview" ? <RefreshCw size={13} className="animate-spin" /> : <Eye size={13} />} Preview today
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setConfirmRun(true)} disabled={!!busy}>
            {busy === "run" ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />} Send now
          </Button>
        </div>
      </div>

      <Tabs value={section} onValueChange={setSection}>
        <TabsList>
          <TabsTrigger value="outstanding" className="gap-1.5"><IndianRupee size={13} /> Outstanding clients</TabsTrigger>
          <TabsTrigger value="rules" className="gap-1.5"><Settings2 size={13} /> Reminder rules</TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5"><FileText size={13} /> Reminder templates</TabsTrigger>
        </TabsList>

      <TabsContent value="rules" className="mt-4">
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Scope list */}
        <Card>
          <CardContent className="p-3 space-y-4 max-h-[640px] overflow-y-auto">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Firm groups</p>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs gap-1"
                  onClick={() => setFgDialog({ name: "", firm_ids: resolvedFirmId ? [resolvedFirmId] : [] })}>
                  <Plus size={12} /> New
                </Button>
              </div>
              {firmGroups.length === 0 && <p className="text-xs text-muted-foreground px-2">None yet</p>}
              {firmGroups.map(g => (
                <ScopeButton key={g.id} scope={{ type: "firm_group", id: g.id, name: g.name, firmId: null }}
                  extra={<span className="text-[10px] text-muted-foreground">{g.firm_ids.length} firms</span>} />
              ))}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Firm</p>
              {firms.filter(f => f.id === resolvedFirmId).map(f => (
                <ScopeButton key={f.id} scope={{ type: "firm", id: f.id, name: f.name, firmId: f.id }} />
              ))}
              <p className="text-[11px] text-muted-foreground px-2">Use the firm selector at the top of Billing to set up another firm.</p>
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer px-1">
              <Checkbox checked={sidebarOutstandingOnly} onCheckedChange={v => setSidebarOutstandingOnly(!!v)} />
              Only clients / groups with outstanding
            </label>

            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Client groups</p>
              {sidebarGroups.length === 0 && <p className="text-xs text-muted-foreground px-2">{filterSidebar ? "No group has anything outstanding" : "No client groups yet"}</p>}
              {sidebarGroups.map(g => (
                <ScopeButton key={g.id} scope={{ type: "client_group", id: g.id, name: g.name, firmId: g.firm_id }}
                  extra={!g.firm_id ? <span className="text-[10px] text-muted-foreground" title="Shared by all firms">all firms</span> : undefined} />
              ))}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Clients</p>
              <div className="relative">
                <Search size={12} className="absolute left-2 top-2.5 text-muted-foreground" />
                <Input className="h-8 pl-7 text-xs" placeholder="Search clients" value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
              </div>
              {filteredClients.map(c => (
                <ScopeButton key={c.id} scope={{ type: "client", id: c.id, name: c.name, firmId: c.firm_id }} />
              ))}
              {sidebarClientTotal > filteredClients.length && !clientSearch && (
                <p className="text-[11px] text-muted-foreground px-2">Showing 60 of {sidebarClientTotal}. Search to find others, or pick one from the Outstanding clients tab.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Editor */}
        <Card>
          {selected && draft ? (
            <>
              <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {(() => { const Icon = SCOPE_META[selected.type].icon; return <Icon size={16} />; })()}
                    {selected.name}
                    <Badge variant="outline" className="text-[10px]">{SCOPE_META[selected.type].label}</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Fields left on "Inherit" or blank take the value from the level above.</p>
                </div>
                {selected.type === "firm_group" && (
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => { const g = firmGroups.find(x => x.id === selected.id); if (g) setFgDialog({ id: g.id, name: g.name, firm_ids: g.firm_ids }); }}>
                      Edit firms
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => deleteFirmGroup(selected.id)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-5">
                <PolicyEditor
                  key={`${selected.type}-${selected.id}-${draft.id ?? "new"}`}
                  scope={selected}
                  policy={draft}
                  effective={selectedEffective}
                  onChange={patch => setDraft(prev => prev ? { ...prev, ...patch } : prev)}
                />

                {selected.type === "firm" && (
                  <section className="space-y-3 border-t pt-4">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5"><Mail size={14} /> Sending mailbox for this firm</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Send from</Label>
                        <Input className="h-8" placeholder="accounts@vjdesai.com (default)" value={senderEmail} onChange={e => setSenderEmail(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Replies go to</Label>
                        <Input className="h-8" placeholder="Same as sender" value={replyToEmail} onChange={e => setReplyToEmail(e.target.value)} />
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Applies to every email this firm sends: invoices, ledgers and reminders. The sender must be a mailbox in your
                      Microsoft 365 account. If Microsoft rejects it, the email goes from accounts@vjdesai.com instead.
                    </p>
                  </section>
                )}

                {blocked && conflicts && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2 text-xs">
                    <p className="font-medium text-sm text-destructive flex items-center gap-1.5">
                      <AlertTriangle size={14} /> This rule conflicts — it can't be saved until this is fixed
                    </p>
                    <ul className="space-y-1.5 list-disc pl-4">
                      {conflicts.own.map((m, i) => <li key={`o${i}`}>{m}</li>)}
                      {conflicts.cross.map((c, i) => (
                        <li key={`c${i}`}>
                          {c.message}
                          <div className="text-muted-foreground">
                            Affects {c.clients.length} client{c.clients.length !== 1 ? "s" : ""}: {c.clients.slice(0, 8).join(", ")}
                            {c.clients.length > 8 && ` and ${c.clients.length - 8} more`}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-between items-center gap-2 border-t pt-4">
                  <Button variant="ghost" size="sm" className="text-xs" onClick={clearPolicy} disabled={!draft.id || saving}>
                    Reset to inherit everything
                  </Button>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-muted-foreground">
                      {checking ? "Checking for conflicts…"
                        : conflicts && !blocked ? `No conflicts (${conflicts.checked} client${conflicts.checked !== 1 ? "s" : ""} checked)` : ""}
                    </span>
                    <Button size="sm" className="gap-1.5" onClick={savePolicy} disabled={saving || checking || blocked}>
                      <Save size={13} /> {saving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </>
          ) : (
            <CardContent className="py-16 text-center text-sm text-muted-foreground">Select a firm group, firm, client group or client.</CardContent>
          )}
        </Card>
      </div>

      </TabsContent>

      {/* Outstanding clients — who gets what */}
      <TabsContent value="outstanding" className="mt-4 space-y-4">
        {effective && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Total outstanding", value: inr(counts.amount), sub: `${counts.invoices} open invoice${counts.invoices !== 1 ? "s" : ""}` },
              { label: "Clients with outstanding", value: counts.total, sub: `${counts.groups} client group${counts.groups !== 1 ? "s" : ""}` },
              { label: "Will receive reminders", value: counts.send, sub: `${counts.nosend} won't` },
              { label: "Need attention", value: counts.noEmail + counts.conflict, sub: `${counts.noEmail} no email · ${counts.conflict} conflicting` },
            ].map(c => (
              <Card key={c.label}><CardContent className="p-3">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-lg font-bold">{c.value}</p>
                <p className="text-[11px] text-muted-foreground">{c.sub}</p>
              </CardContent></Card>
            ))}
          </div>
        )}

      <Card>
        <CardHeader className="pb-2 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Outstanding clients — who gets what</CardTitle>
              <p className="text-xs text-muted-foreground">
                Only clients and groups with an unpaid balance are listed.
                {effective && <> Showing {tableRows.length} of {counts.total} · {inr(counts.shownAmount)}</>}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportCsv} disabled={!tableRows.length}>
                <Download size={13} /> Export CSV
              </Button>
              <Button variant="ghost" size="sm" className="h-8" onClick={fetchEffective} disabled={effectiveLoading}>
                <RefreshCw size={13} className={effectiveLoading ? "animate-spin" : ""} />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={viewMode} onValueChange={v => setViewMode(v as typeof viewMode)}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Client-wise</SelectItem>
                <SelectItem value="group">Group-wise</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="h-8 w-52 pl-7 text-xs" placeholder="Search client or group" value={tableSearch} onChange={e => setTableSearch(e.target.value)} />
            </div>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All client groups</SelectItem>
                {groupOptions.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                <SelectItem value={NO_GROUP}>No group</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={v => setSortBy(v as SortKey)}>
              <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">Outstanding: highest first</SelectItem>
                <SelectItem value="low">Outstanding: lowest first</SelectItem>
                <SelectItem value="invoices">Most open invoices</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tableFilter} onValueChange={v => setTableFilter(v as typeof tableFilter)}>
              <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reminder statuses</SelectItem>
                <SelectItem value="send">Will receive</SelectItem>
                <SelectItem value="nosend">Won't receive</SelectItem>
                <SelectItem value="custom">Client-level settings</SelectItem>
                <SelectItem value="conflict">Conflicting rules</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {checkedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/50 p-2 text-xs">
              <span className="font-medium">{checkedRows.length} selected · {inr(checkedRows.reduce((t, r) => t + r.outstanding, 0))}</span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulkBusy}
                onClick={() => patchClients(checkedRows, sendFlag("send"), "Send reminders")}>Send reminders</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulkBusy}
                onClick={() => patchClients(checkedRows, sendFlag("nosend"), "Don't send")}>Don't send</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulkBusy}
                onClick={() => patchClients(checkedRows, sendFlag("inherit"), "Inherit")}>Inherit</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={bulkBusy}
                onClick={() => setPauseDate("")}><PauseCircle size={12} /> Pause until…</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulkBusy}
                onClick={() => patchClients(checkedRows, { paused_until: null }, "Resume")}>Resume</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setChecked(new Set())}>Clear</Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {effectiveError ? (
            <p className="text-sm text-destructive">Could not load the reminder engine: {effectiveError}. It may not be deployed yet.</p>
          ) : !effective ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="max-h-[620px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={tableRows.length > 0 && tableRows.every(r => checked.has(r.client_id))}
                        onCheckedChange={v => toggleChecked(tableRows.map(r => r.client_id), !!v)}
                        aria-label="Select all shown"
                      />
                    </TableHead>
                    <TableHead>{viewMode === "group" ? "Group / client" : "Client"}</TableHead>
                    <TableHead>Reminders</TableHead>
                    <TableHead>Invoice reminders</TableHead>
                    <TableHead>Statement of Account</TableHead>
                    <TableHead>To / CC</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Remind</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewMode === "client"
                    ? tableRows.map(r => renderClientRow(r))
                    : groupRows.map(g => {
                        const open = expanded.has(g.key);
                        const ids = g.rows.map(r => r.client_id);
                        const sends = g.rows.filter(r => r.settings.invoice_enabled || r.settings.ledger_enabled).length;
                        return [
                          <TableRow key={`g-${g.key}`} className="bg-muted/40 hover:bg-muted/60">
                            <TableCell>
                              <Checkbox checked={ids.every(id => checked.has(id))} onCheckedChange={v => toggleChecked(ids, !!v)} aria-label={`Select ${g.name}`} />
                            </TableCell>
                            <TableCell className="text-sm" colSpan={5}>
                              <div className="flex items-center gap-2">
                                <button className="flex items-center gap-1 font-semibold"
                                  onClick={() => setExpanded(prev => { const n = new Set(prev); open ? n.delete(g.key) : n.add(g.key); return n; })}>
                                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  <Users size={13} /> {g.name}
                                </button>
                                <span className="text-xs text-muted-foreground">
                                  {g.rows.length} client{g.rows.length !== 1 ? "s" : ""} · {g.invoices} invoice{g.invoices !== 1 ? "s" : ""} · {sends} will receive
                                </span>
                                {g.key !== NO_GROUP && (
                                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => openGroup(g.name)}>Group rule</Button>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-sm font-semibold">{inr(g.outstanding)}</TableCell>
                            <TableCell />
                          </TableRow>,
                          ...(open ? g.rows.map(r => renderClientRow(r, g.key)) : []),
                        ];
                      })}
                  {tableRows.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No outstanding clients match.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      {/* Reminder email templates — the two the engine sends */}
      <TabsContent value="templates" className="mt-4">
        <EmailTemplatesTab
          firmId={resolvedFirmId}
          types={REMINDER_TEMPLATE_TYPES}
          title="Reminder templates"
          description="These are the emails the reminder engine sends: Payment Reminder for overdue invoices and Statement of Account for the periodic outstanding statement. The preview uses sample values; edit a template to change its wording or design."
        />
      </TabsContent>
      </Tabs>

      {/* Send one client now */}
      <Dialog open={!!sendTarget} onOpenChange={open => { if (!open && !sendingClient) setSendTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Send {sendTarget?.kind === "invoice" ? "payment reminder" : "Statement of Account"} to {sendTarget?.row.client_name}?
            </DialogTitle>
          </DialogHeader>
          {sendTarget && (
            <div className="space-y-2 text-sm">
              <p>
                {sendTarget.row.open_invoices} open invoice{sendTarget.row.open_invoices !== 1 ? "s" : ""} ·{" "}
                <strong>{inr(sendTarget.row.outstanding)}</strong> outstanding
              </p>
              <p className="text-xs">To: {sendTarget.row.to.join(", ")}</p>
              {sendTarget.row.cc.length > 0 && <p className="text-xs text-muted-foreground">CC: {sendTarget.row.cc.join(", ")}</p>}
              <p className="text-xs text-muted-foreground">
                Goes now, whatever this client's reminder rules say (including paused or "Don't send"), using the
                {sendTarget.kind === "invoice" ? " Payment Reminder" : " Statement of Account"} template.
                {sendTarget.kind === "invoice" && " It counts as a reminder, so the next automatic one waits for the repeat interval."}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendTarget(null)} disabled={sendingClient}>Cancel</Button>
            <Button className="gap-1.5" onClick={sendClientNow} disabled={sendingClient}>
              {sendingClient ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />} {sendingClient ? "Sending..." : "Send now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk pause */}
      <Dialog open={pauseDate !== null} onOpenChange={open => { if (!open) setPauseDate(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Pause reminders for {checkedRows.length} client{checkedRows.length !== 1 ? "s" : ""}</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">Pause until</Label>
            <Input type="date" className="h-8" value={pauseDate ?? ""} onChange={e => setPauseDate(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">E.g. payment promised or invoice disputed. Nothing is sent to these clients until this date.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPauseDate(null)}>Cancel</Button>
            <Button disabled={!pauseDate || bulkBusy}
              onClick={async () => { const d = pauseDate; setPauseDate(null); await patchClients(checkedRows, { paused_until: d }, "Pause"); }}>
              Pause
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Firm group dialog */}
      <Dialog open={!!fgDialog} onOpenChange={open => { if (!open) setFgDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{fgDialog?.id ? "Edit firm group" : "New firm group"}</DialogTitle></DialogHeader>
          {fgDialog && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={fgDialog.name} onChange={e => setFgDialog({ ...fgDialog, name: e.target.value })} placeholder="e.g. Desai group firms" />
              </div>
              <div className="space-y-1">
                <Label>Firms</Label>
                <div className="max-h-60 overflow-y-auto space-y-1 border rounded p-2">
                  {firms.map(f => (
                    <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={fgDialog.firm_ids.includes(f.id)}
                        onCheckedChange={v => setFgDialog({
                          ...fgDialog,
                          firm_ids: v ? [...fgDialog.firm_ids, f.id] : fgDialog.firm_ids.filter(x => x !== f.id),
                        })}
                      />
                      {f.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFgDialog(null)}>Cancel</Button>
            <Button onClick={saveFirmGroup}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send-now confirmation */}
      <Dialog open={confirmRun} onOpenChange={setConfirmRun}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send today's reminders now?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This sends everything that is due today for this firm, exactly as the daily run would. Anything sent now is
            not sent again by today's automatic run. Use "Preview today" first to see the list.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRun(false)}>Cancel</Button>
            <Button onClick={() => runAction("run")} disabled={busy === "run"}>{busy === "run" ? "Sending..." : "Send now"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview */}
      <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Preview: what would be sent today</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-4">
              <p className="text-sm">
                <strong>{preview.planned.length}</strong> email{preview.planned.length !== 1 ? "s" : ""} would be sent
                ({preview.planned.filter(p => p.kind === "invoice").length} payment reminders,{" "}
                {preview.planned.filter(p => p.kind === "ledger").length} statements of account).
                {preview.planned.length > preview.per_run_cap && ` Up to ${preview.per_run_cap} go per run; the rest go in the next hourly run.`}
              </p>
              {preview.planned.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead><TableHead>Type</TableHead><TableHead>To / CC</TableHead>
                      <TableHead>Invoices</TableHead><TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.planned.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{p.client_name}</TableCell>
                        <TableCell className="text-xs">{p.kind === "invoice" ? "Payment reminder" : `Statement of Account (${p.period_key})`}</TableCell>
                        <TableCell className="text-xs">{p.to.join(", ")}{p.cc.length > 0 && <div className="text-muted-foreground">CC: {p.cc.join(", ")}</div>}</TableCell>
                        <TableCell className="text-xs">
                          {p.invoices.slice(0, 4).map(inv => (
                            <div key={inv.invoice_no}>
                              {inv.invoice_no}
                              {p.kind === "invoice" && <span className="text-muted-foreground"> · {inv.days_overdue >= 0 ? `${inv.days_overdue}d overdue` : `due in ${-inv.days_overdue}d`} · #{inv.reminder_no}</span>}
                            </div>
                          ))}
                          {p.invoices.length > 4 && <div className="text-muted-foreground">+{p.invoices.length - 4} more</div>}
                        </TableCell>
                        <TableCell className="text-right text-xs">{inr(p.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {preview.skipped.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">Not sent today ({preview.skipped.length})</p>
                  <div className="max-h-56 overflow-y-auto text-xs border rounded">
                    {preview.skipped.map((s, i) => (
                      <div key={i} className="flex justify-between gap-3 px-2 py-1 border-b last:border-0">
                        <span>{s.client_name} <span className="text-muted-foreground">({s.kind === "invoice" ? "reminder" : "statement of account"})</span></span>
                        <span className="text-muted-foreground text-right">{s.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
