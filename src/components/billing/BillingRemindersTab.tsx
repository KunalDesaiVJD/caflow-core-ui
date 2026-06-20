import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format, formatDistanceToNow } from "date-fns";
import { Bell, Plus, Play, Edit2, Trash2, CheckCircle2, AlertCircle, Clock, RefreshCw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReminderRule {
  id: string;
  firm_id: string;
  name: string;
  rule_type: "invoice" | "ledger";
  trigger_days: number | null;
  trigger_direction: "before" | "after" | null;
  frequency: string | null;
  send_to_client: boolean;
  send_to_responsible: boolean;
  template_type: string | null;
  filter_status: string | null;
  filter_groups: string[] | null;
  is_active: boolean;
  auto_send: boolean;
  last_run_at: string | null;
  created_at: string;
}

interface EmailTemplate { id: string; type: string; name: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "Never run";
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return iso; }
}

// ─── Empty Form State ─────────────────────────────────────────────────────────

const emptyInvoiceRule = (): Partial<ReminderRule> => ({
  name: "",
  rule_type: "invoice",
  trigger_days: 3,
  trigger_direction: "before",
  send_to_client: true,
  send_to_responsible: false,
  template_type: "payment_reminder",
  filter_status: "finalized",
  filter_groups: [],
  is_active: true,
  auto_send: false,
});

const emptyLedgerRule = (): Partial<ReminderRule> => ({
  name: "",
  rule_type: "ledger",
  frequency: "monthly",
  trigger_days: 1,
  trigger_direction: null,
  send_to_client: true,
  send_to_responsible: false,
  template_type: "ledger_statement",
  filter_status: null,
  filter_groups: [],
  is_active: true,
});

// ─── Run Progress Bar ─────────────────────────────────────────────────────────

function RunProgress({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Sending reminders...</span>
        <span>{current} / {total}</span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

// ─── Rule Card ────────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  onToggle,
  onEdit,
  onDelete,
  onRunNow,
  running,
  runProgress,
}: {
  rule: ReminderRule;
  onToggle: (id: string, val: boolean) => void;
  onEdit: (rule: ReminderRule) => void;
  onDelete: (id: string) => void;
  onRunNow: (rule: ReminderRule) => void;
  running: boolean;
  runProgress: { current: number; total: number } | null;
}) {
  const triggerDesc = rule.rule_type === "invoice"
    ? `${rule.trigger_days} day${(rule.trigger_days ?? 0) !== 1 ? "s" : ""} ${rule.trigger_direction ?? "before"} due date`
    : `${rule.frequency ?? "monthly"}, day ${rule.trigger_days ?? 1} of each month`;

  return (
    <Card className="relative">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-sm font-semibold">{rule.name}</CardTitle>
            {rule.is_active
              ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs gap-0.5"><CheckCircle2 size={10} />Active</Badge>
              : <Badge variant="outline" className="text-xs text-muted-foreground gap-0.5"><AlertCircle size={10} />Inactive</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{triggerDesc}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Switch
            checked={rule.is_active}
            onCheckedChange={v => onToggle(rule.id, v)}
            className="scale-75"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={12} />
          <span>Last run: {timeAgo(rule.last_run_at)}</span>
        </div>

        {running && runProgress && <RunProgress current={runProgress.current} total={runProgress.total} />}

        <div className="flex gap-2 flex-wrap">
          <Button
            variant="default"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => onRunNow(rule)}
            disabled={running}
          >
            {running ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} />}
            Run Now
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => onEdit(rule)}
            disabled={running}
          >
            <Edit2 size={11} /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => onDelete(rule.id)}
            disabled={running}
          >
            <Trash2 size={11} /> Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Invoice Rule Form ────────────────────────────────────────────────────────

function InvoiceRuleForm({
  state,
  onChange,
  templates,
}: {
  state: Partial<ReminderRule>;
  onChange: (patch: Partial<ReminderRule>) => void;
  templates: EmailTemplate[];
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Rule Name</Label>
        <Input
          value={state.name ?? ""}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="e.g. 3-day pre-due reminder"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Trigger</Label>
        <div className="flex gap-2 items-center">
          <Input
            type="number"
            min={0}
            max={365}
            className="w-20"
            value={state.trigger_days ?? 3}
            onChange={e => onChange({ trigger_days: Number(e.target.value) })}
          />
          <span className="text-sm text-muted-foreground">days</span>
          <Select
            value={state.trigger_direction ?? "before"}
            onValueChange={v => onChange({ trigger_direction: v as "before" | "after" })}
          >
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="before">before due date</SelectItem>
              <SelectItem value="after">after due date</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Filter by Invoice Status</Label>
        <Select
          value={state.filter_status ?? "finalized"}
          onValueChange={v => onChange({ filter_status: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="finalized">Finalized</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="finalized_overdue">Finalized + Overdue</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Email Template</Label>
        <Select
          value={state.template_type ?? "payment_reminder"}
          onValueChange={v => onChange({ template_type: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="payment_reminder">Default — Payment Reminder</SelectItem>
            {templates.map(t => (
              <SelectItem key={t.id} value={t.type}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Send To</Label>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={state.send_to_client ?? true}
              onCheckedChange={v => onChange({ send_to_client: v })}
            />
            <span className="text-sm">Client email</span>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={state.send_to_responsible ?? false}
              onCheckedChange={v => onChange({ send_to_responsible: v })}
            />
            <span className="text-sm">Responsible person</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={state.is_active ?? true}
          onCheckedChange={v => onChange({ is_active: v })}
        />
        <Label>{state.is_active ? "Active" : "Inactive"}</Label>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1">
        <div className="flex items-center gap-2">
          <Switch
            checked={state.auto_send ?? false}
            onCheckedChange={v => onChange({ auto_send: v })}
          />
          <Label>Send automatically (daily)</Label>
        </div>
        <p className="text-[11px] text-amber-700">
          When on, this rule emails matching clients automatically each day — no "Run Now" needed.
          Paid invoices are always skipped, and no client is reminded twice within 2 days.
        </p>
      </div>
    </div>
  );
}

// ─── Ledger Rule Form ─────────────────────────────────────────────────────────

function LedgerRuleForm({
  state,
  onChange,
  templates,
}: {
  state: Partial<ReminderRule>;
  onChange: (patch: Partial<ReminderRule>) => void;
  templates: EmailTemplate[];
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Rule Name</Label>
        <Input
          value={state.name ?? ""}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="e.g. Monthly ledger statement"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Frequency</Label>
        <Select
          value={state.frequency ?? "monthly"}
          onValueChange={v => onChange({ frequency: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Send on day of month</Label>
        <Input
          type="number"
          min={1}
          max={28}
          className="w-24"
          value={state.trigger_days ?? 1}
          onChange={e => onChange({ trigger_days: Number(e.target.value) })}
        />
        <p className="text-xs text-muted-foreground">Day 1–28 to avoid month-end edge cases</p>
      </div>

      <div className="space-y-1.5">
        <Label>Email Template</Label>
        <Select
          value={state.template_type ?? "ledger_statement"}
          onValueChange={v => onChange({ template_type: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ledger_statement">Default — Ledger Statement</SelectItem>
            {templates.map(t => (
              <SelectItem key={t.id} value={t.type}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={state.send_to_client ?? true}
          onCheckedChange={v => onChange({ send_to_client: v })}
        />
        <Label>Send to client email</Label>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={state.is_active ?? true}
          onCheckedChange={v => onChange({ is_active: v })}
        />
        <Label>{state.is_active ? "Active" : "Inactive"}</Label>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BillingRemindersTab({
  firmId,
  userId,
}: {
  firmId: string | null;
  userId: string | null;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const resolvedFirmId = firmId ?? user?.firm_id ?? null;
  const resolvedUserId = userId ?? user?.id ?? null;

  const [innerTab, setInnerTab] = useState("invoice");
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<ReminderRule> & { id?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Run Now state per rule
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState<{ current: number; total: number } | null>(null);

  const fetchAll = useCallback(async () => {
    if (!resolvedFirmId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: rData }, { data: tData }] = await Promise.all([
      (supabase.from("billing_reminder_rules") as any)
        .select("*")
        .eq("firm_id", resolvedFirmId)
        .order("created_at", { ascending: false }),
      (supabase.from("email_templates") as any)
        .select("id, type, name")
        .eq("firm_id", resolvedFirmId)
        .eq("is_active", true),
    ]);
    setRules((rData as ReminderRule[]) || []);
    setTemplates((tData as EmailTemplate[]) || []);
    setLoading(false);
  }, [resolvedFirmId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openCreate = (type: "invoice" | "ledger") => {
    setEditingRule(type === "invoice" ? { ...emptyInvoiceRule() } : { ...emptyLedgerRule() });
    setDialogOpen(true);
  };

  const openEdit = (rule: ReminderRule) => {
    setEditingRule({ ...rule });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingRule || !resolvedFirmId) return;
    if (!editingRule.name?.trim()) {
      toast({ title: "Rule name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        firm_id: resolvedFirmId,
        name: editingRule.name.trim(),
        rule_type: editingRule.rule_type,
        trigger_days: editingRule.trigger_days ?? null,
        trigger_direction: editingRule.trigger_direction ?? null,
        frequency: editingRule.frequency ?? null,
        send_to_client: editingRule.send_to_client ?? true,
        send_to_responsible: editingRule.send_to_responsible ?? false,
        template_type: editingRule.template_type ?? null,
        filter_status: editingRule.filter_status ?? null,
        filter_groups: editingRule.filter_groups ?? [],
        is_active: editingRule.is_active ?? true,
        auto_send: editingRule.auto_send ?? false,
      };
      let error: any;
      if (editingRule.id) {
        ({ error } = await (supabase.from("billing_reminder_rules") as any)
          .update(payload)
          .eq("id", editingRule.id));
      } else {
        ({ error } = await (supabase.from("billing_reminder_rules") as any)
          .insert({ ...payload, created_at: new Date().toISOString() }));
      }
      if (error) throw error;
      toast({ title: "Reminder rule saved" });
      setDialogOpen(false);
      fetchAll();
    } catch (err: any) {
      toast({ title: "Error saving rule", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, val: boolean) => {
    await (supabase.from("billing_reminder_rules") as any).update({ is_active: val }).eq("id", id);
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: val } : r));
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await (supabase.from("billing_reminder_rules") as any).delete().eq("id", deleteId);
    if (error) {
      toast({ title: "Error deleting rule", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Rule deleted" });
      fetchAll();
    }
    setDeleteId(null);
  };

  const handleRunNow = async (rule: ReminderRule) => {
    if (!resolvedFirmId) return;
    setRunningRuleId(rule.id);
    setRunProgress({ current: 0, total: 0 });

    try {
      if (rule.rule_type === "invoice") {
        // Build status filter
        const statuses = rule.filter_status === "finalized_overdue"
          ? ["finalized", "overdue"]
          : rule.filter_status
            ? [rule.filter_status]
            : ["finalized", "overdue"];

        const { data: invoices, error: invErr } = await (supabase as any)
          .from("invoices")
          .select("id, invoice_no, client_id, firm_id, total_amount, amount_due, payment_status, due_date, status, last_reminded_at")
          .eq("firm_id", resolvedFirmId)
          .eq("document_type", "invoice")
          .in("status", statuses)
          .neq("payment_status", "paid")
          .not("client_id", "is", null);

        if (invErr) throw invErr;
        // Phase 5 (H2): never dun a client who has already paid. Only remind on
        // invoices with a real outstanding balance, net of receipts + TDS + GST-TDS.
        // C4: also skip invoices reminded within the last 2 days, so repeated
        // "Run Now" clicks don't spam the same clients.
        const DEDUPE_MS = 2 * 24 * 60 * 60 * 1000;
        const list = (invoices || []).filter((i: any) =>
          Number(i.amount_due ?? i.total_amount ?? 0) > 0 &&
          (!i.last_reminded_at || (Date.now() - new Date(i.last_reminded_at).getTime()) > DEDUPE_MS)
        );
        setRunProgress({ current: 0, total: list.length });

        if (list.length === 0) {
          toast({ title: "No matching invoices found" });
          setRunningRuleId(null);
          setRunProgress(null);
          return;
        }

        let sent = 0;
        let failed = 0;
        for (let i = 0; i < list.length; i++) {
          const inv = list[i];
          try {
            await supabase.functions.invoke("send-notification", {
              body: {
                type: rule.template_type ?? "payment_reminder",
                firm_id: resolvedFirmId,
                client_id: inv.client_id,
                send_to_client: rule.send_to_client,
                payload: {
                  invoice_no: inv.invoice_no,
                  amount: inv.amount_due ?? inv.total_amount,
                  due_date: inv.due_date,
                },
              },
            });
            sent++;
            // C4: stamp so this invoice isn't reminded again within the window.
            await (supabase as any).from("invoices").update({ last_reminded_at: new Date().toISOString() }).eq("id", inv.id);
          } catch {
            failed++;
          }
          setRunProgress({ current: i + 1, total: list.length });
        }

        // Update last_run_at
        await (supabase.from("billing_reminder_rules") as any)
          .update({ last_run_at: new Date().toISOString() })
          .eq("id", rule.id);

        toast({
          title: `Reminders sent: ${sent} succeeded${failed > 0 ? `, ${failed} failed` : ""}`,
        });
        fetchAll();

      } else {
        // Ledger reminders — send to all active clients
        const { data: clients, error: cErr } = await supabase
          .from("clients")
          .select("id, name")
          .eq("firm_id", resolvedFirmId)
          .eq("is_draft", false)
          .is("deleted_at", null)
          .neq("is_active", false);

        if (cErr) throw cErr;
        const list = clients || [];
        setRunProgress({ current: 0, total: list.length });

        if (list.length === 0) {
          toast({ title: "No active clients found" });
          setRunningRuleId(null);
          setRunProgress(null);
          return;
        }

        let sent = 0;
        let failed = 0;
        for (let i = 0; i < list.length; i++) {
          const client = list[i];
          try {
            await supabase.functions.invoke("send-notification", {
              body: {
                type: rule.template_type ?? "ledger_statement",
                firm_id: resolvedFirmId,
                client_id: client.id,
                send_to_client: rule.send_to_client,
                payload: {},
              },
            });
            sent++;
          } catch {
            failed++;
          }
          setRunProgress({ current: i + 1, total: list.length });
        }

        await (supabase.from("billing_reminder_rules") as any)
          .update({ last_run_at: new Date().toISOString() })
          .eq("id", rule.id);

        toast({
          title: `Ledger statements sent: ${sent} succeeded${failed > 0 ? `, ${failed} failed` : ""}`,
        });
        fetchAll();
      }
    } catch (err: any) {
      toast({ title: "Error running reminders", description: err.message, variant: "destructive" });
    } finally {
      setRunningRuleId(null);
      setRunProgress(null);
    }
  };

  const invoiceRules = rules.filter(r => r.rule_type === "invoice");
  const ledgerRules = rules.filter(r => r.rule_type === "ledger");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Billing Reminders</h2>
          <p className="text-sm text-muted-foreground">Automate invoice reminders and ledger statement dispatches.</p>
        </div>
      </div>

      <Tabs value={innerTab} onValueChange={setInnerTab}>
        <TabsList>
          <TabsTrigger value="invoice" className="gap-1.5">
            <Bell size={13} /> Invoice Reminders
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5">
            <Bell size={13} /> Ledger Reminders
          </TabsTrigger>
        </TabsList>

        {/* Invoice Reminders Tab */}
        <TabsContent value="invoice" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5" onClick={() => openCreate("invoice")}>
              <Plus size={14} /> New Invoice Reminder Rule
            </Button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map(i => <Skeleton key={i} className="h-48 w-full rounded-lg" />)}
            </div>
          ) : invoiceRules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3 border rounded-lg bg-muted/20">
              <Bell size={40} strokeWidth={1.2} />
              <p className="text-sm">No invoice reminder rules yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {invoiceRules.map(rule => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={handleToggle}
                  onEdit={openEdit}
                  onDelete={id => setDeleteId(id)}
                  onRunNow={handleRunNow}
                  running={runningRuleId === rule.id}
                  runProgress={runningRuleId === rule.id ? runProgress : null}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Ledger Reminders Tab */}
        <TabsContent value="ledger" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5" onClick={() => openCreate("ledger")}>
              <Plus size={14} /> New Ledger Reminder Rule
            </Button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map(i => <Skeleton key={i} className="h-48 w-full rounded-lg" />)}
            </div>
          ) : ledgerRules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3 border rounded-lg bg-muted/20">
              <Bell size={40} strokeWidth={1.2} />
              <p className="text-sm">No ledger reminder rules yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {ledgerRules.map(rule => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={handleToggle}
                  onEdit={openEdit}
                  onDelete={id => setDeleteId(id)}
                  onRunNow={handleRunNow}
                  running={runningRuleId === rule.id}
                  runProgress={runningRuleId === rule.id ? runProgress : null}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!saving) setDialogOpen(open); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell size={17} />
              {editingRule?.id ? "Edit Reminder Rule" : "Create Reminder Rule"}
            </DialogTitle>
          </DialogHeader>

          {editingRule && editingRule.rule_type === "invoice" && (
            <InvoiceRuleForm
              state={editingRule}
              onChange={patch => setEditingRule(prev => prev ? { ...prev, ...patch } : prev)}
              templates={templates}
            />
          )}
          {editingRule && editingRule.rule_type === "ledger" && (
            <LedgerRuleForm
              state={editingRule}
              onChange={patch => setEditingRule(prev => prev ? { ...prev, ...patch } : prev)}
              templates={templates}
            />
          )}

          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Rule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Reminder Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The rule and its schedule will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
