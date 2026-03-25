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
import { AlertTriangle, Info } from "lucide-react";

/* ───── Types ───── */

export interface ServiceConfig {
  frequency: string;
  reminder_date: number;
  billing_amount: number;
  invoice_gen_type: "auto" | "reminder";
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
}

export const StepServiceBilling = ({
  data, onChange, errors, gstins, tanNumber, workGroupType, warnings,
}: Props) => {
  const { user } = useAuth();
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModeDialog, setShowModeDialog] = useState(false);
  const [pendingMode, setPendingMode] = useState<BillingMode | null>(null);

  const set = <K extends keyof ServiceBillingData>(key: K, val: ServiceBillingData[K]) =>
    onChange({ ...data, [key]: val });

  /* Load service categories */
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      let query = supabase
        .from("service_categories")
        .select("id, name, frequency, linked_module")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (user?.firm_id) query = query.eq("firm_id", user.firm_id);
      const { data: cats } = await query;
      if (cats) setCategories(cats);
      setLoading(false);
    };
    load();
  }, [user?.firm_id]);

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
      };
    }
    set("activeServices", next);
  };

  const updateServiceConfig = (id: string, patch: Partial<ServiceConfig>) => {
    const curr = data.activeServices[id];
    if (!curr) return;
    set("activeServices", { ...data.activeServices, [id]: { ...curr, ...patch } });
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
      {/* ── Cross-step warnings ── */}
      {warnings.map((w) => (
        <Alert key={w.type} variant="default" className="border-accent/50 bg-accent/10">
          <AlertTriangle className="h-4 w-4 text-accent-foreground" />
          <AlertDescription className="text-sm text-foreground">
            {w.message}
          </AlertDescription>
        </Alert>
      ))}

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
                          <SelectItem value={cat.frequency}>{cat.frequency}</SelectItem>
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
