import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import { AlertTriangle, Info, Eye, EyeOff, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_TDS_START_FY, DEFAULT_TDS_START_QUARTER, getQuarterPeriodNumber } from "@/lib/tdsQuarter";

/* ───── Types ───── */

export interface ServiceConfig {
  frequency: string;
  reminder_date: number;
  billing_amount: number;
  invoice_gen_type: "auto" | "reminder";
  /** The underlying client_services row's own id — only set once the row
   *  actually exists (edit mode, after the first save). ITD/TRACES
   *  credentials are stored against THIS id via the tds-portal-credentials
   *  edge function (see StepServiceBilling's own credentials block), not in
   *  this form's own upsert payload — a new client has no row yet, so
   *  credentials can only be entered after the wizard's first save. */
  id?: string;
  /** TDS Compliance only — mandatory start of the compliance period. */
  tds_start_fy?: string;
  tds_start_quarter?: string;
  /** TDS Compliance only — optional inclusive end; blank = active indefinitely. */
  tds_end_fy?: string;
  tds_end_quarter?: string;
  /** TDS Compliance only — one or more forms the client is required to file. */
  tds_forms?: string[];
  /** TDS Compliance only — ITD/TRACES login credentials. Login IDs load
   *  from the server as plain text (see the "status" edge-function call);
   *  passwords are NEVER loaded in plaintext — a password field here means
   *  "the user just typed a NEW one to save", left undefined otherwise so
   *  saving never overwrites an existing stored password with blank. See
   *  tds_password_set/traces_password_set for whether one is already saved. */
  itd_login_id?: string;
  itd_password?: string;
  traces_login_id?: string;
  traces_password?: string;
  itd_password_set?: boolean;
  traces_password_set?: boolean;
  credentials_updated_at?: string | null;
}

export interface PackageConfig {
  package_name: string;
  service_ids: string[];
  frequency: string;
  reminder_date: number;
  billing_amount: number;
  invoice_gen_type: "auto" | "reminder";
}

export type BillingMode = "service_specific" | "package_wise";

export interface ServiceBillingData {
  billingMode: BillingMode;
  activeServices: Record<string, ServiceConfig>;
  packageConfig: PackageConfig;
}

export const emptyPackageConfig: PackageConfig = {
  package_name: "",
  service_ids: [],
  frequency: "",
  reminder_date: 1,
  billing_amount: 0,
  invoice_gen_type: "reminder",
};

export const defaultServiceBilling: ServiceBillingData = {
  billingMode: "service_specific",
  activeServices: {},
  packageConfig: { ...emptyPackageConfig },
};

interface ServiceCategory {
  id: string;
  name: string;
  frequency: string;
  linked_module: string | null;
}

/* ───── Cross-step warning types ───── */
export interface CrossStepWarning {
  type: "gst" | "tds" | "itr";
  message: string;
}

/* ───── TDS Start/End Quarter helpers ───── */
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["26Q", "24Q", "27Q", "27EQ"];

function getTdsFyOptions(): string[] {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 8 }, (_, i) => {
    const y = fyStart - 2 + i;
    return `${y}-${String(y + 1).slice(-2)}`;
  });
}

// True when an End Quarter is invalid: partially filled, or earlier than Start.
function tdsRangeError(cfg: ServiceConfig): string | null {
  const hasEndFy = !!cfg.tds_end_fy;
  const hasEndQ = !!cfg.tds_end_quarter;
  if (hasEndFy !== hasEndQ) return "Select both Financial Year and Quarter for End Quarter, or leave both blank.";
  if (hasEndFy && hasEndQ && cfg.tds_start_fy && cfg.tds_start_quarter) {
    const startPeriod = getQuarterPeriodNumber(cfg.tds_start_fy, cfg.tds_start_quarter);
    const endPeriod = getQuarterPeriodNumber(cfg.tds_end_fy!, cfg.tds_end_quarter!);
    if (endPeriod < startPeriod) return "End Quarter cannot be earlier than Start Quarter.";
  }
  return null;
}

/* ───── Props ───── */
interface Props {
  data: ServiceBillingData;
  onChange: (d: ServiceBillingData) => void;
  errors: Record<string, string>;
  // Cross-step data from other steps
  gstins: string[];
  tanNumber: string;
  workGroupType: string;
  warnings: CrossStepWarning[];
  /** Navigate to a wizard step by index (0 = Basic Info, 1 = Advanced Info, …) */
  onGoToStep?: (stepIndex: number) => void;
  /** Override firm_id for loading service categories (used when superadmin edits a client) */
  firmId?: string;
}

export const StepServiceBilling = ({
  data, onChange, errors, gstins, tanNumber, workGroupType, warnings, onGoToStep, firmId: propFirmId,
}: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModeDialog, setShowModeDialog] = useState(false);
  const [pendingMode, setPendingMode] = useState<BillingMode | null>(null);
  // ITD/TRACES password reveal — fetched on demand only (never on load), see
  // ServiceConfig's own doc on why. Keyed by `${catId}-itd`/`${catId}-traces`.
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [revealingKey, setRevealingKey] = useState<string | null>(null);

  const set = <K extends keyof ServiceBillingData>(key: K, val: ServiceBillingData[K]) =>
    onChange({ ...data, [key]: val });

  const revealCredential = async (catId: string, cfg: ServiceConfig, which: "itd" | "traces") => {
    if (!cfg.id) return;
    const key = `${catId}-${which}`;
    if (revealedPasswords[key] !== undefined) { setRevealedPasswords(prev => { const n = { ...prev }; delete n[key]; return n; }); return; }
    setRevealingKey(key);
    const { data: res, error } = await supabase.functions.invoke("tds-portal-credentials", {
      body: { action: "read", client_service_id: cfg.id },
    });
    setRevealingKey(null);
    if (error) { toast({ title: "Could not retrieve the password", description: error.message, variant: "destructive" }); return; }
    const pw = which === "itd" ? res?.itd_password : res?.traces_password;
    setRevealedPasswords(prev => ({ ...prev, [key]: pw || "" }));
  };

  // Use the explicit firmId prop (for superadmin editing a client) or fall back to user's firm
  const effectiveFirmId = propFirmId || user?.firm_id;

  /* Load service categories */
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      let query = supabase
        .from("service_categories")
        .select("id, name, frequency, linked_module")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (effectiveFirmId) query = query.eq("firm_id", effectiveFirmId);
      const { data: cats } = await query;
      if (cats) setCategories(cats);
      setLoading(false);
    };
    load();
  }, [effectiveFirmId]);

  /* ── Mode switch ── */
  const handleModeSwitch = (newMode: BillingMode) => {
    if (newMode === data.billingMode) return;
    const hasData =
      Object.keys(data.activeServices).length > 0 ||
      data.packageConfig.service_ids.length > 0;
    if (hasData) {
      setPendingMode(newMode);
      setShowModeDialog(true);
    } else {
      set("billingMode", newMode);
    }
  };

  const confirmModeSwitch = () => {
    if (pendingMode) {
      onChange({
        billingMode: pendingMode,
        activeServices: {},
        packageConfig: { ...emptyPackageConfig },
      });
    }
    setShowModeDialog(false);
    setPendingMode(null);
  };

  /* ── Service Specific helpers ── */
  const toggleService = (id: string, cat: ServiceCategory) => {
    const next = { ...data.activeServices };
    if (next[id]) {
      delete next[id];
    } else {
      next[id] = {
        frequency: cat.frequency,
        reminder_date: 1,
        billing_amount: 0,
        invoice_gen_type: "reminder",
        ...(cat.linked_module === "tds"
          ? { tds_start_fy: DEFAULT_TDS_START_FY, tds_start_quarter: DEFAULT_TDS_START_QUARTER, tds_forms: ["26Q"] }
          : {}),
      };
    }
    set("activeServices", next);
  };

  const updateServiceConfig = (id: string, patch: Partial<ServiceConfig>) => {
    const curr = data.activeServices[id];
    if (!curr) return;
    set("activeServices", { ...data.activeServices, [id]: { ...curr, ...patch } });
  };

  const toggleTdsForm = (catId: string, cfg: ServiceConfig, form: string) => {
    const current = cfg.tds_forms || [];
    const next = current.includes(form) ? current.filter(f => f !== form) : [...current, form];
    updateServiceConfig(catId, { tds_forms: next });
  };

  const fyOptions = getTdsFyOptions();

  /* TDS Forms Applicable (mandatory, multi-select) + Start/End Quarter — TDS Compliance only */
  const renderTdsRangeFields = (catId: string, cfg: ServiceConfig) => {
    const rangeError = tdsRangeError(cfg);
    const selectedForms = cfg.tds_forms || [];
    return (
      <div className="pt-3 border-t border-border space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">TDS Forms Applicable <span className="text-destructive">*</span></Label>
          <div className="flex flex-wrap gap-3">
            {TDS_FORMS.map((form) => (
              <label key={form} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <Checkbox
                  checked={selectedForms.includes(form)}
                  onCheckedChange={() => toggleTdsForm(catId, cfg, form)}
                />
                {form}
              </label>
            ))}
          </div>
          {selectedForms.length === 0 && (
            <p className="text-xs text-destructive">Select at least one TDS form.</p>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Start Quarter — FY <span className="text-destructive">*</span></Label>
            <Select
              value={cfg.tds_start_fy || ""}
              onValueChange={(v) => updateServiceConfig(catId, { tds_start_fy: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select FY" /></SelectTrigger>
              <SelectContent>
                {fyOptions.map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Start Quarter <span className="text-destructive">*</span></Label>
            <Select
              value={cfg.tds_start_quarter || ""}
              onValueChange={(v) => updateServiceConfig(catId, { tds_start_quarter: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Quarter" /></SelectTrigger>
              <SelectContent>
                {QUARTERS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">End Quarter — FY</Label>
            <Select
              value={cfg.tds_end_fy || ""}
              onValueChange={(v) => updateServiceConfig(catId, { tds_end_fy: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Indefinite" /></SelectTrigger>
              <SelectContent>
                {fyOptions.map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">End Quarter</Label>
            <div className="flex gap-1">
              <Select
                value={cfg.tds_end_quarter || ""}
                onValueChange={(v) => updateServiceConfig(catId, { tds_end_quarter: v })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Indefinite" /></SelectTrigger>
                <SelectContent>
                  {QUARTERS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                </SelectContent>
              </Select>
              {(cfg.tds_end_fy || cfg.tds_end_quarter) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs shrink-0"
                  onClick={() => updateServiceConfig(catId, { tds_end_fy: undefined, tds_end_quarter: undefined })}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          End Quarter is optional — leave blank to keep TDS compliance active indefinitely.
        </p>
        {rangeError && <p className="text-xs text-destructive">{rangeError}</p>}

        {/* ITD / TRACES portal credentials — encrypted at rest, see
            ServiceConfig's own doc. A brand-new client has no client_services
            row yet, so credentials can only be entered once the wizard has
            been saved at least once. */}
        <div className="pt-3 border-t border-border space-y-3">
          <Label className="text-xs font-medium">Portal Login Credentials</Label>
          {!cfg.id ? (
            <p className="text-[11px] text-muted-foreground">Save this client first to add ITD/TRACES login credentials.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">ITD (e-Filing) Login ID</Label>
                  <Input
                    className="h-8 text-xs"
                    // This is the CLIENT's portal login, entered by staff — not
                    // the staff member's own credentials. Without these,
                    // browsers treat this text+password pair as a login form
                    // and silently overwrite the correctly-loaded client value
                    // with the staff member's own saved autofill entry.
                    name="itd-login-id-no-autofill"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore=""
                    value={cfg.itd_login_id ?? ""}
                    onChange={(e) => updateServiceConfig(catId, { itd_login_id: e.target.value })}
                    placeholder="e.g. the TAN"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">ITD (e-Filing) Password</Label>
                  <div className="flex gap-1">
                    <Input
                      className="h-8 text-xs font-mono"
                      type={revealedPasswords[`${catId}-itd`] !== undefined ? "text" : "password"}
                      // "new-password" (not "off") is the one value Chrome/Firefox
                      // reliably honour to mean "do not offer or inject a saved
                      // credential here" — this field holds the CLIENT's stored
                      // portal password, never the signed-in staff member's own.
                      name="itd-password-no-autofill"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-1p-ignore=""
                      value={
                        revealedPasswords[`${catId}-itd`] !== undefined
                          ? revealedPasswords[`${catId}-itd`]
                          : cfg.itd_password ?? (cfg.itd_password_set ? "········" : "")
                      }
                      onChange={(e) => updateServiceConfig(catId, { itd_password: e.target.value })}
                      onFocus={(e) => { if (cfg.itd_password === undefined && cfg.itd_password_set) e.currentTarget.select(); }}
                      placeholder={cfg.itd_password_set ? "" : "Enter password"}
                    />
                    {cfg.itd_password_set && cfg.itd_password === undefined && (
                      <Button type="button" variant="outline" size="sm" className="h-8 px-2 shrink-0"
                        onClick={() => revealCredential(catId, cfg, "itd")} disabled={revealingKey === `${catId}-itd`}>
                        {revealingKey === `${catId}-itd` ? <Loader2 size={12} className="animate-spin" /> : revealedPasswords[`${catId}-itd`] !== undefined ? <EyeOff size={12} /> : <Eye size={12} />}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">TRACES Login ID</Label>
                  <Input
                    className="h-8 text-xs"
                    name="traces-login-id-no-autofill"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore=""
                    value={cfg.traces_login_id ?? ""}
                    onChange={(e) => updateServiceConfig(catId, { traces_login_id: e.target.value })}
                    placeholder="e.g. the TAN"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">TRACES Password</Label>
                  <div className="flex gap-1">
                    <Input
                      className="h-8 text-xs font-mono"
                      type={revealedPasswords[`${catId}-traces`] !== undefined ? "text" : "password"}
                      name="traces-password-no-autofill"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-1p-ignore=""
                      value={
                        revealedPasswords[`${catId}-traces`] !== undefined
                          ? revealedPasswords[`${catId}-traces`]
                          : cfg.traces_password ?? (cfg.traces_password_set ? "········" : "")
                      }
                      onChange={(e) => updateServiceConfig(catId, { traces_password: e.target.value })}
                      onFocus={(e) => { if (cfg.traces_password === undefined && cfg.traces_password_set) e.currentTarget.select(); }}
                      placeholder={cfg.traces_password_set ? "" : "Enter password"}
                    />
                    {cfg.traces_password_set && cfg.traces_password === undefined && (
                      <Button type="button" variant="outline" size="sm" className="h-8 px-2 shrink-0"
                        onClick={() => revealCredential(catId, cfg, "traces")} disabled={revealingKey === `${catId}-traces`}>
                        {revealingKey === `${catId}-traces` ? <Loader2 size={12} className="animate-spin" /> : revealedPasswords[`${catId}-traces`] !== undefined ? <EyeOff size={12} /> : <Eye size={12} />}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Passwords are encrypted at rest and never shown automatically — click <Eye size={10} className="inline" /> to reveal a saved one, or just start typing to replace it.
                {cfg.credentials_updated_at && ` Last updated ${new Date(cfg.credentials_updated_at).toLocaleDateString("en-IN")}.`}
              </p>
            </>
          )}
        </div>
      </div>
    );
  };

  /* ── Package helpers ── */
  const togglePackageService = (id: string) => {
    const pkg = { ...data.packageConfig };
    const idx = pkg.service_ids.indexOf(id);
    if (idx >= 0) pkg.service_ids = pkg.service_ids.filter((s) => s !== id);
    else pkg.service_ids = [...pkg.service_ids, id];
    set("packageConfig", pkg);
  };

  const updatePackage = (patch: Partial<PackageConfig>) => {
    set("packageConfig", { ...data.packageConfig, ...patch });
  };

  // Services NOT in the package (for individual activation in package mode)
  const nonPackageServices = categories.filter((c) => !data.packageConfig.service_ids.includes(c.id));

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading services…</div>;
  }

  return (
    <div className="space-y-6">
      {/* ── Cross-step blocking errors (red — prevents saving until resolved) ── */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w) => (
            <Alert key={w.type} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{w.message}</span>
                {onGoToStep && (w.type === "gst" || w.type === "tds") && (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:no-underline"
                    onClick={() => onGoToStep(0)}
                  >
                    ← Go to Step 1 — Basic Info
                  </button>
                )}
                {onGoToStep && w.type === "itr" && (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:no-underline"
                    onClick={() => onGoToStep(1)}
                  >
                    ← Go to Step 2 — Advanced Info
                  </button>
                )}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* ── Mode toggle ── */}
      <div className="flex items-center gap-2">
        <Button
          variant={data.billingMode === "service_specific" ? "default" : "outline"}
          size="sm"
          onClick={() => handleModeSwitch("service_specific")}
        >
          Service Specific
        </Button>
        <Button
          variant={data.billingMode === "package_wise" ? "default" : "outline"}
          size="sm"
          onClick={() => handleModeSwitch("package_wise")}
        >
          Package Wise
        </Button>
      </div>

      {errors.services && (
        <p className="text-xs text-destructive">{errors.services}</p>
      )}

      {/* ── MODE A: Service Specific ── */}
      {data.billingMode === "service_specific" && (
        <div className="space-y-3">
          {categories.map((cat) => {
            const isActive = Boolean(data.activeServices[cat.id]);
            const cfg = data.activeServices[cat.id];
            return (
              <div key={cat.id} className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{cat.name}</span>
                  <Switch
                    checked={isActive}
                    onCheckedChange={() => toggleService(cat.id, cat)}
                  />
                </div>

                {isActive && cfg && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* Frequency */}
                    <div className="space-y-1">
                      <Label className="text-xs">Frequency</Label>
                      <Select
                        value={cfg.frequency}
                        onValueChange={(v) => updateServiceConfig(cat.id, { frequency: v })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["monthly", "quarterly", "half_yearly", "annual", "event_based", "package"].map((f) => (
                            <SelectItem key={f} value={f}>
                              {f === "half_yearly" ? "Half Yearly" : f === "event_based" ? "Event Based" : f.charAt(0).toUpperCase() + f.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Reminder Date */}
                    <div className="space-y-1">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Label className="text-xs flex items-center gap-1">
                              Reminder Date <Info className="h-3 w-3 text-muted-foreground" />
                            </Label>
                          </TooltipTrigger>
                          <TooltipContent>Day of month when invoice or reminder is triggered</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        className="h-8 text-xs"
                        value={cfg.reminder_date}
                        onChange={(e) =>
                          updateServiceConfig(cat.id, {
                            reminder_date: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                          })
                        }
                      />
                    </div>

                    {/* Billing Amount */}
                    <div className="space-y-1">
                      <Label className="text-xs">Billing Amount (₹)</Label>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 text-xs"
                        value={cfg.billing_amount || ""}
                        onChange={(e) =>
                          updateServiceConfig(cat.id, { billing_amount: Number(e.target.value) || 0 })
                        }
                      />
                    </div>

                    {/* Invoice Gen Type */}
                    <div className="space-y-1">
                      <Label className="text-xs">Invoice Generation</Label>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={cfg.invoice_gen_type === "auto" ? "default" : "outline"}
                          className="h-8 text-xs flex-1"
                          onClick={() => updateServiceConfig(cat.id, { invoice_gen_type: "auto" })}
                        >
                          Auto
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={cfg.invoice_gen_type === "reminder" ? "default" : "outline"}
                          className="h-8 text-xs flex-1"
                          onClick={() => updateServiceConfig(cat.id, { invoice_gen_type: "reminder" })}
                        >
                          Reminder
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {isActive && cfg && cat.linked_module === "tds" && renderTdsRangeFields(cat.id, cfg)}
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODE B: Package Wise ── */}
      {data.billingMode === "package_wise" && (
        <div className="space-y-6">
          {/* Service selection */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Select services for package</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {categories.map((cat) => (
                <label
                  key={cat.id}
                  className="flex items-center gap-2 rounded-md border border-border p-3 cursor-pointer hover:bg-accent/30 transition-colors"
                >
                  <Checkbox
                    checked={data.packageConfig.service_ids.includes(cat.id)}
                    onCheckedChange={() => togglePackageService(cat.id)}
                  />
                  <span className="text-sm">{cat.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Package config */}
          {data.packageConfig.service_ids.length > 0 && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
              <h4 className="text-sm font-semibold text-foreground">Package Configuration</h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Package Name */}
                <div className="space-y-1.5">
                  <Label>Package Name <span className="text-destructive">*</span></Label>
                  <Input
                    value={data.packageConfig.package_name}
                    onChange={(e) => updatePackage({ package_name: e.target.value })}
                    placeholder="e.g. Annual Compliance Package"
                  />
                  {errors.package_name && <p className="text-xs text-destructive">{errors.package_name}</p>}
                </div>

                {/* Frequency */}
                <div className="space-y-1.5">
                  <Label>Frequency</Label>
                  <Select
                    value={data.packageConfig.frequency}
                    onValueChange={(v) => updatePackage({ frequency: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select frequency" /></SelectTrigger>
                    <SelectContent>
                      {/* Show unique frequencies from selected services */}
                      {[...new Set(
                        categories
                          .filter((c) => data.packageConfig.service_ids.includes(c.id))
                          .map((c) => c.frequency)
                      )].map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Reminder Date */}
                <div className="space-y-1.5">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label className="flex items-center gap-1">
                          Reminder Date <Info className="h-3 w-3 text-muted-foreground" />
                        </Label>
                      </TooltipTrigger>
                      <TooltipContent>Day of month when invoice or reminder is triggered</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={data.packageConfig.reminder_date}
                    onChange={(e) =>
                      updatePackage({ reminder_date: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
                    }
                  />
                </div>

                {/* Billing Amount */}
                <div className="space-y-1.5">
                  <Label>Billing Amount (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={data.packageConfig.billing_amount || ""}
                    onChange={(e) => updatePackage({ billing_amount: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>

              {/* Invoice Gen Type */}
              <div className="space-y-1.5">
                <Label>Invoice Generation</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={data.packageConfig.invoice_gen_type === "auto" ? "default" : "outline"}
                    onClick={() => updatePackage({ invoice_gen_type: "auto" })}
                  >
                    Auto
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={data.packageConfig.invoice_gen_type === "reminder" ? "default" : "outline"}
                    onClick={() => updatePackage({ invoice_gen_type: "reminder" })}
                  >
                    Reminder
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Non-package individual services */}
          {nonPackageServices.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground">
                Individual Services (not in package)
              </h4>
              {nonPackageServices.map((cat) => {
                const isActive = Boolean(data.activeServices[cat.id]);
                const cfg = data.activeServices[cat.id];
                return (
                  <div key={cat.id} className="rounded-lg border border-border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{cat.name}</span>
                      <Switch
                        checked={isActive}
                        onCheckedChange={() => toggleService(cat.id, cat)}
                      />
                    </div>
                    {isActive && cfg && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Frequency</Label>
                          <Select value={cfg.frequency} onValueChange={(v) => updateServiceConfig(cat.id, { frequency: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={cat.frequency}>{cat.frequency}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Reminder Date</Label>
                          <Input type="number" min={1} max={31} className="h-8 text-xs" value={cfg.reminder_date}
                            onChange={(e) => updateServiceConfig(cat.id, { reminder_date: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Billing Amount (₹)</Label>
                          <Input type="number" min={0} className="h-8 text-xs" value={cfg.billing_amount || ""}
                            onChange={(e) => updateServiceConfig(cat.id, { billing_amount: Number(e.target.value) || 0 })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Invoice Generation</Label>
                          <div className="flex gap-1">
                            <Button type="button" size="sm" variant={cfg.invoice_gen_type === "auto" ? "default" : "outline"}
                              className="h-8 text-xs flex-1" onClick={() => updateServiceConfig(cat.id, { invoice_gen_type: "auto" })}>Auto</Button>
                            <Button type="button" size="sm" variant={cfg.invoice_gen_type === "reminder" ? "default" : "outline"}
                              className="h-8 text-xs flex-1" onClick={() => updateServiceConfig(cat.id, { invoice_gen_type: "reminder" })}>Reminder</Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {isActive && cfg && cat.linked_module === "tds" && renderTdsRangeFields(cat.id, cfg)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Mode switch confirmation dialog ── */}
      <Dialog open={showModeDialog} onOpenChange={setShowModeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch Billing Mode?</DialogTitle>
            <DialogDescription>
              Switching mode will clear all billing data entered so far. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowModeDialog(false); setPendingMode(null); }}>
              No
            </Button>
            <Button onClick={confirmModeSwitch}>Yes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
