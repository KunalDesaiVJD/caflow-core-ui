import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Building, Bell, Shield, Users, BookOpen, CreditCard,
  Plus, X, Pencil, Trash2, Loader2, ChevronRight, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───
interface FirmSettings {
  notification_prefs?: Record<string, { whatsapp: boolean; email: boolean; wati_template_id?: string }>;
  billing?: {
    gst_rate?: number;
    payment_terms?: string;
    invoice_prefix?: string;
    bank_name?: string;
    account_number?: string;
    ifsc?: string;
    branch?: string;
  };
}

interface NarrationRule {
  id: string;
  keywords: string[] | null;
  category: string | null;
  action: string | null;
  severity: string | null;
  message: string | null;
  is_active: boolean | null;
  firm_id: string | null;
}

const NOTIFICATION_EVENTS = [
  { key: "tds_due_7", label: "TDS Due — 7 Days" },
  { key: "tds_due_1", label: "TDS Due — 1 Day" },
  { key: "itr_deadline", label: "ITR Deadline" },
  { key: "audit_report_ready", label: "Audit Report Ready" },
  { key: "invoice_generated", label: "Invoice Generated" },
  { key: "scrutiny_complete", label: "Scrutiny Complete" },
];

const RULE_CATEGORIES = ["TDS", "GST", "Cash Payment", "Loan", "Prior Period", "Depreciation", "Interest Income", "Custom"];

const SEVERITY_COLORS: Record<string, string> = {
  HIGH: "bg-destructive/15 text-destructive border-destructive/30",
  MEDIUM: "bg-amber-100 text-amber-800 border-amber-300",
  LOW: "bg-green-100 text-green-800 border-green-300",
};

const SettingsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = ["superadmin", "firm_admin", "partner_ca"].includes(user?.role || "");

  // ─── Firm State (shared — needed for notification and billing saves) ───
  const [firmLoading, setFirmLoading] = useState(true);
  const [firmId, setFirmId] = useState<string | null>(null);
  const [selectedFirmId, setSelectedFirmId] = useState<string | null>(null);

  // ─── Notification State ───
  const [notifPrefs, setNotifPrefs] = useState<Record<string, { whatsapp: boolean; email: boolean; wati_template_id?: string }>>({});
  const [notifSaving, setNotifSaving] = useState(false);

  // ─── Scrutiny Rules State ───
  const [rules, setRules] = useState<NarrationRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState<NarrationRule | null>(null);
  const [deleteRule, setDeleteRule] = useState<NarrationRule | null>(null);
  const [ruleForm, setRuleForm] = useState({ keywords: [] as string[], category: "", action: "flag", severity: "MEDIUM", message: "", firm_id: "" });
  const [keywordInput, setKeywordInput] = useState("");
  const [ruleSaving, setRuleSaving] = useState(false);
  const [firmsList, setFirmsList] = useState<{ id: string; name: string }[]>([]);

  // ─── COA State ───
  const [unmappedCount, setUnmappedCount] = useState(0);

  // ─── Billing State ───
  const [billing, setBilling] = useState({ gst_rate: 18, payment_terms: "Net 30 days", invoice_prefix: "INV/2425/", bank_name: "", account_number: "", ifsc: "", branch: "" });
  const [billingSaving, setBillingSaving] = useState(false);

  // ─── Load Firm Data ───
  useEffect(() => {
    loadFirmsList();
    loadRules();
  }, [user]);

  // When firmsList loads and user is superadmin, auto-select first firm; otherwise use user's firm
  useEffect(() => {
    if (user?.role === "superadmin" && firmsList.length > 0 && !selectedFirmId) {
      setSelectedFirmId(firmsList[0].id);
    } else if (user?.firm_id && !selectedFirmId) {
      setSelectedFirmId(user.firm_id);
    }
  }, [user, firmsList, selectedFirmId]);

  // Load firm data when selectedFirmId changes
  useEffect(() => {
    if (selectedFirmId) {
      setFirmId(selectedFirmId);
      loadFirmData(selectedFirmId);
    }
  }, [selectedFirmId]);

  async function loadFirmData(id: string) {
    setFirmLoading(true);
    const { data } = await supabase.from("firms").select("settings").eq("id", id).single();
    if (data) {
      const settings = (data.settings || {}) as FirmSettings;
      setNotifPrefs(settings.notification_prefs || {});
      if (settings.billing) {
        setBilling(prev => ({ ...prev, ...settings.billing }));
      }
    }
    setFirmLoading(false);
  }

  async function loadRules() {
    const { data } = await supabase.from("narration_rules").select("*").order("category");
    setRules((data as NarrationRule[]) || []);
    setRulesLoading(false);
  }

  async function loadFirmsList() {
    const { data } = await supabase.from("firms").select("id, name").order("name");
    setFirmsList(data || []);
  }

  async function saveNotificationPrefs() {
    if (!firmId || !isAdmin) return;
    setNotifSaving(true);
    try {
      const { data: current } = await supabase.from("firms").select("settings").eq("id", firmId).single();
      const existingSettings = (current?.settings || {}) as FirmSettings;
      const { error } = await supabase.from("firms").update({
        settings: { ...existingSettings, notification_prefs: notifPrefs },
      } as any).eq("id", firmId);
      if (error) throw error;
      toast({ title: "Notification preferences saved" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setNotifSaving(false);
    }
  }

  async function saveBillingSettings() {
    if (!firmId || !isAdmin) return;
    setBillingSaving(true);
    try {
      const { data: current } = await supabase.from("firms").select("settings").eq("id", firmId).single();
      const existingSettings = (current?.settings || {}) as FirmSettings;
      const { error } = await supabase.from("firms").update({
        settings: { ...existingSettings, billing },
      } as any).eq("id", firmId);
      if (error) throw error;
      toast({ title: "Billing settings saved" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBillingSaving(false);
    }
  }

  function toggleNotif(eventKey: string, channel: "whatsapp" | "email") {
    setNotifPrefs(prev => {
      const current = prev[eventKey] || { whatsapp: false, email: false };
      return { ...prev, [eventKey]: { ...current, [channel]: !current[channel] } };
    });
  }

  function setWatiTemplate(eventKey: string, templateId: string) {
    setNotifPrefs(prev => {
      const current = prev[eventKey] || { whatsapp: false, email: false };
      return { ...prev, [eventKey]: { ...current, wati_template_id: templateId } };
    });
  }

  async function testNotification(channel: "whatsapp" | "email") {
    try {
      const { error } = await supabase.functions.invoke("send-notification", {
        body: { type: "test", channel, recipient_id: user?.id },
      });
      if (error) throw error;
      toast({ title: `Test ${channel} sent` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  function openAddRule() {
    setRuleForm({ keywords: [], category: "", action: "flag", severity: "MEDIUM", message: "", firm_id: firmId || "" });
    setKeywordInput("");
    setEditingRule(null);
    setShowAddRule(true);
  }

  function openEditRule(rule: NarrationRule) {
    setRuleForm({
      keywords: rule.keywords || [],
      category: rule.category || "",
      action: rule.action || "flag",
      severity: rule.severity || "MEDIUM",
      message: rule.message || "",
      firm_id: rule.firm_id || firmId || "",
    });
    setKeywordInput("");
    setEditingRule(rule);
    setShowAddRule(true);
  }

  function addKeyword() {
    const word = keywordInput.trim();
    if (word && !ruleForm.keywords.includes(word)) {
      setRuleForm(p => ({ ...p, keywords: [...p.keywords, word] }));
    }
    setKeywordInput("");
  }

  function removeKeyword(kw: string) {
    setRuleForm(p => ({ ...p, keywords: p.keywords.filter(k => k !== kw) }));
  }

  async function saveRule() {
    const targetFirmId = user?.role === "superadmin" ? ruleForm.firm_id : firmId;
    if (!targetFirmId) {
      toast({ title: "Please select a firm", variant: "destructive" });
      return;
    }
    if (ruleForm.keywords.length === 0 || !ruleForm.category || !ruleForm.message.trim()) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    setRuleSaving(true);
    try {
      const payload = {
        keywords: ruleForm.keywords.map(k => k.trim().toLowerCase()),
        category: ruleForm.category,
        action: ruleForm.action,
        severity: ruleForm.severity,
        message: ruleForm.message,
        firm_id: targetFirmId,
        is_active: true,
      };
      if (editingRule) {
        const { error } = await supabase.from("narration_rules").update(payload as any).eq("id", editingRule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("narration_rules").insert(payload as any);
        if (error) throw error;
      }
      toast({ title: editingRule ? "Rule updated" : "Rule added" });
      setShowAddRule(false);
      loadRules();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setRuleSaving(false);
    }
  }

  async function handleDeleteRule() {
    if (!deleteRule) return;
    try {
      const { error } = await supabase.from("narration_rules").delete().eq("id", deleteRule.id);
      if (error) throw error;
      toast({ title: "Rule deleted" });
      setDeleteRule(null);
      loadRules();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function toggleRuleActive(rule: NarrationRule) {
    const { error } = await supabase.from("narration_rules").update({ is_active: !rule.is_active } as any).eq("id", rule.id);
    if (!error) loadRules();
  }

  if (firmLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground mb-1">Settings</h1>
        <p className="text-muted-foreground">Firm settings, team management, and preferences.</p>
      </div>

      <Tabs defaultValue="notifications" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="team" className="text-xs">Team</TabsTrigger>
          <TabsTrigger value="notifications" className="text-xs">Notifications</TabsTrigger>
          <TabsTrigger value="scrutiny-rules" className="text-xs">Scrutiny Rules</TabsTrigger>
          <TabsTrigger value="coa" className="text-xs">COA Mappings</TabsTrigger>
          <TabsTrigger value="billing" className="text-xs">Billing</TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: Team ─── */}
        <TabsContent value="team">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Team Members</CardTitle>
              <CardDescription>Manage users, roles, and permissions.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to="/settings/users"
                className="flex items-center gap-3 p-4 border border-border rounded-lg hover:border-primary/40 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Users size={20} />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">Go to User Management</p>
                  <p className="text-sm text-muted-foreground">Add, edit, and manage team members and their roles.</p>
                </div>
                <ChevronRight className="text-muted-foreground group-hover:text-primary transition-colors" size={18} />
              </Link>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 3: Notifications ─── */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Notification Preferences</CardTitle>
              <CardDescription>Configure WhatsApp and email notifications for key events.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead className="text-center">WhatsApp</TableHead>
                    <TableHead className="text-center">Email</TableHead>
                    <TableHead>WATI Template ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {NOTIFICATION_EVENTS.map(evt => {
                    const pref = notifPrefs[evt.key] || { whatsapp: false, email: false };
                    return (
                      <TableRow key={evt.key}>
                        <TableCell className="font-medium">{evt.label}</TableCell>
                        <TableCell className="text-center">
                          <Switch checked={pref.whatsapp} onCheckedChange={() => toggleNotif(evt.key, "whatsapp")} disabled={!isAdmin} />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch checked={pref.email} onCheckedChange={() => toggleNotif(evt.key, "email")} disabled={!isAdmin} />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={pref.wati_template_id || ""}
                            onChange={e => setWatiTemplate(evt.key, e.target.value)}
                            disabled={!isAdmin}
                            placeholder="template_id"
                            className="h-8 text-xs"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex gap-2">
                {isAdmin && (
                  <>
                    <Button onClick={saveNotificationPrefs} disabled={notifSaving}>
                      {notifSaving ? "Saving…" : "Save Preferences"}
                    </Button>
                    <Button variant="outline" onClick={() => testNotification("whatsapp")}>Test WhatsApp</Button>
                    <Button variant="outline" onClick={() => testNotification("email")}>Test Email</Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 4: Custom Scrutiny Rules ─── */}
        <TabsContent value="scrutiny-rules">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Custom Scrutiny Rules</CardTitle>
                <CardDescription>Manage narration-based audit scrutiny rules.</CardDescription>
              </div>
              {isAdmin && (
                <Button onClick={openAddRule} className="gap-2">
                  <Plus className="h-4 w-4" /> Add Custom Rule
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {rulesLoading ? (
                <p className="text-muted-foreground text-sm py-6 text-center">Loading…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Keywords</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map(rule => {
                      const isGlobal = !rule.firm_id;
                      return (
                        <TableRow key={rule.id} className={isGlobal ? "opacity-60" : ""}>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(rule.keywords || []).map((kw, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px]">{kw}</Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            {rule.category}
                            {isGlobal && <Badge variant="outline" className="ml-2 text-[10px]">Global</Badge>}
                          </TableCell>
                          <TableCell className="text-sm">{rule.action === "flag" ? "Flag Immediately" : "Send to AI"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[10px]", SEVERITY_COLORS[rule.severity || "MEDIUM"])}>
                              {rule.severity}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={!!rule.is_active}
                              onCheckedChange={() => !isGlobal && isAdmin && toggleRuleActive(rule)}
                              disabled={isGlobal || !isAdmin}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            {!isGlobal && isAdmin && (
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditRule(rule)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteRule(rule)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 5: COA Mappings ─── */}
        <TabsContent value="coa">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" /> Chart of Account Mappings</CardTitle>
              <CardDescription>Map raw ledger names to standardized account heads.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to="/settings/coa-mappings"
                className="flex items-center gap-3 p-4 border border-border rounded-lg hover:border-primary/40 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <BookOpen size={20} />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">Go to COA Mappings</p>
                  <p className="text-sm text-muted-foreground">View and manage ledger-to-account mappings.</p>
                </div>
                <ChevronRight className="text-muted-foreground group-hover:text-primary transition-colors" size={18} />
              </Link>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 6: Billing Settings ─── */}
        <TabsContent value="billing">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Billing Settings</CardTitle>
              <CardDescription>Configure invoice defaults and bank details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Default GST Rate (%)</Label>
                  <Input type="number" value={billing.gst_rate} onChange={e => setBilling(p => ({ ...p, gst_rate: Number(e.target.value) }))} disabled={!isAdmin} />
                </div>
                <div className="space-y-2">
                  <Label>Payment Terms</Label>
                  <Input value={billing.payment_terms} onChange={e => setBilling(p => ({ ...p, payment_terms: e.target.value }))} disabled={!isAdmin} placeholder="Net 30 days" />
                </div>
                <div className="space-y-2">
                  <Label>Invoice Number Prefix</Label>
                  <Input value={billing.invoice_prefix} onChange={e => setBilling(p => ({ ...p, invoice_prefix: e.target.value }))} disabled={!isAdmin} placeholder="INV/2425/" />
                </div>
                <div className="space-y-2">
                  <Label>Bank Name</Label>
                  <Input value={billing.bank_name} onChange={e => setBilling(p => ({ ...p, bank_name: e.target.value }))} disabled={!isAdmin} />
                </div>
                <div className="space-y-2">
                  <Label>Bank Account Number</Label>
                  <Input value={billing.account_number} onChange={e => setBilling(p => ({ ...p, account_number: e.target.value }))} disabled={!isAdmin} />
                </div>
                <div className="space-y-2">
                  <Label>IFSC Code</Label>
                  <Input value={billing.ifsc} onChange={e => setBilling(p => ({ ...p, ifsc: e.target.value }))} disabled={!isAdmin} />
                </div>
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Input value={billing.branch} onChange={e => setBilling(p => ({ ...p, branch: e.target.value }))} disabled={!isAdmin} />
                </div>
              </div>
              {isAdmin && (
                <Button onClick={saveBillingSettings} disabled={billingSaving}>
                  {billingSaving ? "Saving…" : "Save Billing Settings"}
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Add/Edit Rule Modal ─── */}
      <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit Rule" : "Add Custom Rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Firm Dropdown - visible to superadmin and firm_admin */}
            {(user?.role === "superadmin" || user?.role === "firm_admin") && (
              <div className="space-y-2">
                <Label>Firm Name</Label>
                <Select value={ruleForm.firm_id} onValueChange={v => setRuleForm(p => ({ ...p, firm_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select firm" /></SelectTrigger>
                  <SelectContent>
                    {firmsList.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Keywords</Label>
              <div className="flex gap-2">
                <Input
                  value={keywordInput}
                  onChange={e => setKeywordInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                  placeholder="Type keyword + Enter"
                />
                <Button type="button" variant="outline" onClick={addKeyword}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {ruleForm.keywords.map((kw, i) => (
                  <Badge key={i} variant="secondary" className="gap-1 pr-1">
                    {kw}
                    <button onClick={() => removeKeyword(kw)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={ruleForm.category} onValueChange={v => setRuleForm(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {RULE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Action</Label>
              <RadioGroup value={ruleForm.action} onValueChange={v => setRuleForm(p => ({ ...p, action: v }))} className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="flag" id="action-flag" />
                  <Label htmlFor="action-flag">Flag Immediately</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ai" id="action-ai" />
                  <Label htmlFor="action-ai">Send to AI for Analysis</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <RadioGroup value={ruleForm.severity} onValueChange={v => setRuleForm(p => ({ ...p, severity: v }))} className="flex gap-4">
                {["HIGH", "MEDIUM", "LOW"].map(s => (
                  <div key={s} className="flex items-center space-x-2">
                    <RadioGroupItem value={s} id={`sev-${s}`} />
                    <Label htmlFor={`sev-${s}`}>
                      <Badge variant="outline" className={cn("text-[10px]", SEVERITY_COLORS[s])}>{s}</Badge>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea value={ruleForm.message} onChange={e => setRuleForm(p => ({ ...p, message: e.target.value }))} placeholder="Description of the flagged finding..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRule(false)}>Cancel</Button>
            <Button onClick={saveRule} disabled={ruleSaving || ruleForm.keywords.length === 0 || !ruleForm.category || !ruleForm.message.trim()}>
              {ruleSaving ? "Saving…" : editingRule ? "Update Rule" : "Add Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Rule Confirmation ─── */}
      <AlertDialog open={!!deleteRule} onOpenChange={open => { if (!open) setDeleteRule(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rule</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this scrutiny rule? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRule} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SettingsPage;
