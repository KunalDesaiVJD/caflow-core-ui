import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PanelLeft, Monitor, Columns3, Check, ChevronDown,
  Palette, LayoutDashboard, Users, FileText, Receipt, BarChart3,
  Shield, Bell, Settings, AlertTriangle, CheckCircle2, XCircle,
  Save, Loader2, UserCog,
} from "lucide-react";

type LayoutType = "sidebar_classic" | "topnav_compact" | "split_panel_pro";
type ColorScheme = "midnight_professional" | "clean_white" | "sage_green";

const LAYOUT_OPTIONS: { value: LayoutType; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: "sidebar_classic", label: "Sidebar-Left Classic", desc: "Narrow left panel + wide content area", icon: <PanelLeft size={32} /> },
  { value: "topnav_compact", label: "Top-Nav Compact", desc: "Horizontal top bar + full width content", icon: <Monitor size={32} /> },
  { value: "split_panel_pro", label: "Split-Panel Pro", desc: "Left sidebar + main + right detail panel", icon: <Columns3 size={32} /> },
];

const COLOR_OPTIONS: { value: ColorScheme; label: string; desc: string; bg: string; accent: string; text: string }[] = [
  { value: "midnight_professional", label: "Midnight Professional", desc: "Navy bg, gold accent", bg: "#0D1117", accent: "#C9A84C", text: "#F9FAFB" },
  { value: "clean_white", label: "Clean White", desc: "White bg, teal accent", bg: "#FFFFFF", accent: "#0D9488", text: "#111827" },
  { value: "sage_green", label: "Sage Green", desc: "Cream bg, warm gold accent", bg: "#F9FAF7", accent: "#7C6D3F", text: "#1C1917" },
];

const CSS_VARS_MAP: Record<ColorScheme, Record<string, string>> = {
  midnight_professional: {
    "--bg-primary": "220 14% 7%", "--bg-secondary": "215 19% 13%",
    "--text-primary": "210 40% 98%", "--text-secondary": "215 20% 65%",
    "--accent": "42 52% 54%", "--sidebar-bg": "215 19% 13%",
  },
  clean_white: {
    "--bg-primary": "0 0% 100%", "--bg-secondary": "210 40% 98%",
    "--text-primary": "222 47% 11%", "--text-secondary": "215 16% 47%",
    "--accent": "174 68% 32%", "--sidebar-bg": "210 40% 98%",
  },
  sage_green: {
    "--bg-primary": "80 20% 97%", "--bg-secondary": "100 18% 92%",
    "--text-primary": "24 10% 10%", "--text-secondary": "25 7% 32%",
    "--accent": "40 35% 37%", "--sidebar-bg": "100 18% 92%",
  },
};

const TABS_MODULES = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "clients", label: "Clients", icon: Users },
  { key: "tds_filings", label: "TDS Filings", icon: FileText },
  { key: "itr", label: "IT Returns", icon: Receipt },
  { key: "billing", label: "Billing", icon: Receipt },
  { key: "audit", label: "Audit Intelligence", icon: BarChart3 },
  { key: "notices", label: "Notice Tracker", icon: AlertTriangle },
  { key: "settings", label: "Settings", icon: Settings },
];

const ALL_ROLES = [
  { value: "superadmin", label: "Superadmin" },
  { value: "firm_admin", label: "Firm Admin" },
  { value: "partner_ca", label: "Partner / CA" },
  { value: "manager", label: "Manager" },
  { value: "staff_article", label: "Staff / Article" },
  { value: "client", label: "Client" },
];

interface RoleOverride {
  role: string;
  layout_type: string;
  color_scheme: string;
  allow_user_override: boolean;
}

export default function AdminThemeStudio() {
  const { user } = useAuth();
  const [selectedLayout, setSelectedLayout] = useState<LayoutType>("sidebar_classic");
  const [selectedColor, setSelectedColor] = useState<ColorScheme>("midnight_professional");
  const [firms, setFirms] = useState<{ id: string; name: string; settings: any }[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string>("");
  const [tabOverrides, setTabOverrides] = useState<Record<string, string>>({});
  const [allowFirmTheme, setAllowFirmTheme] = useState(false);
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("themes");

  // Role defaults state
  const [roleOverrides, setRoleOverrides] = useState<RoleOverride[]>(
    ALL_ROLES.map(r => ({ role: r.value, layout_type: "sidebar_classic", color_scheme: "midnight_professional", allow_user_override: true }))
  );
  const [savingRoles, setSavingRoles] = useState(false);

  useEffect(() => {
    supabase.from("firms").select("id, name, settings").then(({ data }) => {
      if (data) setFirms(data);
    });
  }, []);

  // Load existing role overrides when firm changes
  useEffect(() => {
    if (!selectedFirmId) return;
    (async () => {
      const { data } = await supabase
        .from("role_theme_overrides")
        .select("*")
        .eq("firm_id", selectedFirmId);
      if (data && data.length > 0) {
        setRoleOverrides(
          ALL_ROLES.map(r => {
            const existing = data.find((d: any) => d.role === r.value);
            return existing
              ? { role: r.value, layout_type: existing.layout_type || "sidebar_classic", color_scheme: existing.color_scheme || "midnight_professional", allow_user_override: existing.allow_user_override ?? true }
              : { role: r.value, layout_type: "sidebar_classic", color_scheme: "midnight_professional", allow_user_override: true };
          })
        );
      } else {
        setRoleOverrides(ALL_ROLES.map(r => ({ role: r.value, layout_type: "sidebar_classic", color_scheme: "midnight_professional", allow_user_override: true })));
      }
    })();
  }, [selectedFirmId]);

  const cssVars = useMemo(() => CSS_VARS_MAP[selectedColor], [selectedColor]);
  const previewStyle = useMemo(() => {
    const vars: Record<string, string> = {};
    Object.entries(cssVars).forEach(([k, v]) => { vars[k] = v; });
    return vars;
  }, [cssVars]);

  const handleApplyToFirm = async () => {
    if (!selectedFirmId) { toast.error("Select a firm first"); return; }
    setSaving(true);
    const firm = firms.find(f => f.id === selectedFirmId);
    const themeName = `${COLOR_OPTIONS.find(c => c.value === selectedColor)?.label} - ${LAYOUT_OPTIONS.find(l => l.value === selectedLayout)?.label}`;
    const { data: themeRow, error: themeErr } = await supabase.from("app_themes").upsert({
      name: themeName, layout_type: selectedLayout, color_scheme: selectedColor, css_vars: cssVars, active: true,
    }, { onConflict: "id" }).select("id").single();

    let themeId: string | undefined;
    if (themeErr || !themeRow) {
      const { data: inserted } = await supabase.from("app_themes").insert({
        name: themeName, layout_type: selectedLayout, color_scheme: selectedColor, css_vars: cssVars, active: true,
      }).select("id").single();
      themeId = inserted?.id;
    } else {
      themeId = themeRow.id;
    }

    const settings = {
      ...(firm?.settings || {}),
      theme_id: themeId, theme_layout: selectedLayout, theme_color: selectedColor,
      tab_layout_overrides: tabOverrides, allow_firm_admin_theme: allowFirmTheme,
    };
    const { error } = await supabase.from("firms").update({ settings }).eq("id", selectedFirmId);
    setSaving(false);
    if (error) toast.error("Failed to apply theme");
    else {
      toast.success(`Theme applied to ${firm?.name}`);
      try { localStorage.setItem("firmTheme", JSON.stringify({ cssVars, firmId: selectedFirmId, themeId, ts: Date.now() })); } catch {}
    }
  };

  const handleSetDefault = async () => {
    setSaving(true);
    await supabase.from("app_themes").update({ is_default: false }).eq("is_default", true);
    const { error } = await supabase.from("app_themes").upsert({
      name: `${COLOR_OPTIONS.find(c => c.value === selectedColor)?.label} - ${LAYOUT_OPTIONS.find(l => l.value === selectedLayout)?.label}`,
      layout_type: selectedLayout, color_scheme: selectedColor, css_vars: cssVars, is_default: true, active: true,
    });
    setSaving(false);
    if (error) toast.error("Failed to set default");
    else toast.success("System default updated");
  };

  const handleSaveRoleDefaults = async () => {
    if (!selectedFirmId) { toast.error("Select a firm first"); return; }
    setSavingRoles(true);
    try {
      for (const ro of roleOverrides) {
        await supabase.from("role_theme_overrides").upsert({
          firm_id: selectedFirmId,
          role: ro.role,
          layout_type: ro.layout_type,
          color_scheme: ro.color_scheme,
          allow_user_override: ro.allow_user_override,
          created_by: user?.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "firm_id,role" });
      }
      toast.success("Role theme defaults saved");
    } catch (e: any) {
      toast.error(e.message || "Failed to save role defaults");
    } finally {
      setSavingRoles(false);
    }
  };

  const updateRoleOverride = (role: string, field: string, value: any) => {
    setRoleOverrides(prev => prev.map(r => r.role === role ? { ...r, [field]: value } : r));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Palette className="h-6 w-6 text-primary" />
          Layout & Theme Studio
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Configure the visual experience for each firm</p>
      </div>

      {/* Firm selector (shared across tabs) */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">Active Firm:</span>
            <Select value={selectedFirmId} onValueChange={setSelectedFirmId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select a firm…" />
              </SelectTrigger>
              <SelectContent>
                {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="themes" className="flex items-center gap-1.5">
            <Palette className="w-4 h-4" /> Themes & Layouts
          </TabsTrigger>
          <TabsTrigger value="roles" className="flex items-center gap-1.5">
            <UserCog className="w-4 h-4" /> Role Defaults
          </TabsTrigger>
        </TabsList>

        {/* ─── Themes & Layouts Tab ─── */}
        <TabsContent value="themes">
          <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">
            {/* LEFT: Configuration Panel */}
            <div className="space-y-5">
              {/* Layout */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Layout</CardTitle>
                  <CardDescription>Choose navigation arrangement</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {LAYOUT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setSelectedLayout(opt.value)}
                      className={cn(
                        "w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-all text-left",
                        selectedLayout === opt.value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                      )}
                    >
                      <div className={cn("p-2 rounded-md", selectedLayout === opt.value ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                        {opt.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </div>
                      {selectedLayout === opt.value && <Check className="h-5 w-5 text-primary shrink-0" />}
                    </button>
                  ))}
                </CardContent>
              </Card>

              {/* Colour */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Colour Theme</CardTitle>
                  <CardDescription>Set the visual palette</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {COLOR_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setSelectedColor(opt.value)}
                      className={cn(
                        "w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-all text-left",
                        selectedColor === opt.value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                      )}
                    >
                      <div className="flex gap-1.5 shrink-0">
                        <div className="w-8 h-8 rounded-md border" style={{ backgroundColor: opt.bg }} />
                        <div className="w-8 h-8 rounded-md" style={{ backgroundColor: opt.accent }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </div>
                      {selectedColor === opt.value && <Check className="h-5 w-5 text-primary shrink-0" />}
                    </button>
                  ))}
                </CardContent>
              </Card>

              {/* Per-Tab Overrides */}
              <Card>
                <Collapsible open={overridesOpen} onOpenChange={setOverridesOpen}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">Per-Tab Overrides</CardTitle>
                          <CardDescription>Override layout per module</CardDescription>
                        </div>
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", overridesOpen && "rotate-180")} />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-2 pt-0">
                      {TABS_MODULES.map(tab => (
                        <div key={tab.key} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div className="flex items-center gap-2 text-sm text-foreground">
                            <tab.icon size={14} className="text-muted-foreground" />
                            {tab.label}
                          </div>
                          <Select
                            value={tabOverrides[tab.key] || "default"}
                            onValueChange={v => setTabOverrides(prev => ({ ...prev, [tab.key]: v === "default" ? "" : v }))}
                          >
                            <SelectTrigger className="w-44 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Use Firm Default</SelectItem>
                              {LAYOUT_OPTIONS.map(l => (
                                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>

              {/* Apply */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Apply</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button onClick={handleApplyToFirm} disabled={saving || !selectedFirmId} className="w-full">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Apply to Selected Firm
                  </Button>
                  <Button variant="secondary" className="w-full" onClick={handleSetDefault} disabled={saving}>
                    Set as System Default
                  </Button>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground">Allow Firms to Choose</span>
                    <Switch checked={allowFirmTheme} onCheckedChange={setAllowFirmTheme} />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* RIGHT: Live Preview Panel */}
            <Card className="overflow-hidden">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  Preview: {COLOR_OPTIONS.find(c => c.value === selectedColor)?.label} — {LAYOUT_OPTIONS.find(l => l.value === selectedLayout)?.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div
                  className="min-h-[600px] p-6 space-y-6"
                  style={{
                    backgroundColor: `hsl(${previewStyle["--bg-primary"]})`,
                    color: `hsl(${previewStyle["--text-primary"]})`,
                  }}
                >
                  {/* Nav Sample */}
                  <div className="rounded-lg overflow-hidden border" style={{ borderColor: `hsl(${previewStyle["--text-secondary"]} / 0.2)` }}>
                    {selectedLayout === "topnav_compact" ? (
                      <div className="h-12 flex items-center px-4 gap-6" style={{ backgroundColor: `hsl(${previewStyle["--sidebar-bg"]})` }}>
                        <span className="font-bold text-sm" style={{ color: `hsl(${previewStyle["--accent"]})` }}>CAFlow</span>
                        {["Dashboard", "Clients", "Audit", "Settings"].map(n => (
                          <span key={n} className="text-xs" style={{ color: `hsl(${previewStyle["--text-secondary"]})` }}>{n}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="flex">
                        <div className={cn("py-4 px-3 space-y-3", selectedLayout === "split_panel_pro" ? "w-14" : "w-48")} style={{ backgroundColor: `hsl(${previewStyle["--sidebar-bg"]})` }}>
                          <div className="font-bold text-xs truncate" style={{ color: `hsl(${previewStyle["--accent"]})` }}>CAFlow</div>
                          {["Dashboard", "Clients", "Audit"].map(n => (
                            <div key={n} className="text-xs truncate" style={{ color: `hsl(${previewStyle["--text-secondary"]})` }}>
                              {selectedLayout === "split_panel_pro" ? n[0] : n}
                            </div>
                          ))}
                        </div>
                        <div className="flex-1 p-3" style={{ backgroundColor: `hsl(${previewStyle["--bg-primary"]})` }}>
                          <div className="text-xs font-medium" style={{ color: `hsl(${previewStyle["--text-primary"]})` }}>Main Content Area</div>
                        </div>
                        {selectedLayout === "split_panel_pro" && (
                          <div className="w-48 p-3 border-l" style={{ backgroundColor: `hsl(${previewStyle["--bg-secondary"]})`, borderColor: `hsl(${previewStyle["--text-secondary"]} / 0.15)` }}>
                            <div className="text-xs font-medium" style={{ color: `hsl(${previewStyle["--text-secondary"]})` }}>Detail Panel</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stat Cards */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Active Clients", value: "142" },
                      { label: "Open Queries", value: "38" },
                      { label: "Engagements", value: "27" },
                    ].map(s => (
                      <div key={s.label} className="rounded-lg p-4" style={{ backgroundColor: `hsl(${previewStyle["--bg-secondary"]})` }}>
                        <p className="text-xs" style={{ color: `hsl(${previewStyle["--text-secondary"]})` }}>{s.label}</p>
                        <p className="text-2xl font-bold mt-1" style={{ color: `hsl(${previewStyle["--text-primary"]})` }}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Data Table */}
                  <div className="rounded-lg overflow-hidden border" style={{ borderColor: `hsl(${previewStyle["--text-secondary"]} / 0.2)` }}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ backgroundColor: `hsl(${previewStyle["--bg-secondary"]})` }}>
                          {["Client", "Status", "Risk", "Last Activity"].map(h => (
                            <th key={h} className="text-left px-3 py-2 font-medium" style={{ color: `hsl(${previewStyle["--text-secondary"]})` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { client: "Reliance Pvt Ltd", status: "Pass", risk: "Low", date: "2 days ago" },
                          { client: "Tata Industries", status: "Fail", risk: "High", date: "5 hours ago" },
                          { client: "Infosys Ltd", status: "Partial", risk: "Medium", date: "1 day ago" },
                        ].map(row => (
                          <tr key={row.client} className="border-t" style={{ borderColor: `hsl(${previewStyle["--text-secondary"]} / 0.1)` }}>
                            <td className="px-3 py-2" style={{ color: `hsl(${previewStyle["--text-primary"]})` }}>{row.client}</td>
                            <td className="px-3 py-2">
                              <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold",
                                row.status === "Pass" ? "bg-emerald-500/20 text-emerald-400" :
                                row.status === "Fail" ? "bg-red-500/20 text-red-400" :
                                "bg-amber-500/20 text-amber-400"
                              )}>{row.status}</span>
                            </td>
                            <td className="px-3 py-2" style={{ color: `hsl(${previewStyle["--text-secondary"]})` }}>{row.risk}</td>
                            <td className="px-3 py-2" style={{ color: `hsl(${previewStyle["--text-secondary"]})` }}>{row.date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Buttons & Badges */}
                  <div className="flex flex-wrap gap-3">
                    <button className="px-4 py-2 rounded-md text-xs font-medium text-white" style={{ backgroundColor: `hsl(${previewStyle["--accent"]})` }}>Primary</button>
                    <button className="px-4 py-2 rounded-md text-xs font-medium border" style={{ color: `hsl(${previewStyle["--text-primary"]})`, backgroundColor: `hsl(${previewStyle["--bg-secondary"]})`, borderColor: `hsl(${previewStyle["--text-secondary"]} / 0.3)` }}>Secondary</button>
                    <button className="px-4 py-2 rounded-md text-xs font-medium bg-destructive text-white">Danger</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Open", cls: "bg-red-500/20 text-red-400" },
                      { label: "In Progress", cls: "bg-blue-500/20 text-blue-400" },
                      { label: "Resolved", cls: "bg-emerald-500/20 text-emerald-400" },
                      { label: "Carried Forward", cls: "bg-amber-500/20 text-amber-400" },
                      { label: "Closed", cls: "bg-gray-500/20 text-gray-400" },
                    ].map(b => (
                      <span key={b.label} className={cn("px-2.5 py-1 rounded-full text-[10px] font-semibold", b.cls)}>{b.label}</span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Role Defaults Tab ─── */}
        <TabsContent value="roles">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCog className="w-5 h-5 text-primary" />
                Role Default Themes
              </CardTitle>
              <CardDescription>
                Set the default layout and color scheme each role sees on login. If "Allow User Override" is enabled, users can change their own theme.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedFirmId ? (
                <div className="py-8 text-center text-muted-foreground">
                  <p>Select a firm above to configure role theme defaults.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-40">Role</TableHead>
                        <TableHead>Layout</TableHead>
                        <TableHead>Colour Scheme</TableHead>
                        <TableHead className="text-center">Allow User Override</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roleOverrides.map(ro => {
                        const roleLabel = ALL_ROLES.find(r => r.value === ro.role)?.label || ro.role;
                        return (
                          <TableRow key={ro.role}>
                            <TableCell className="font-medium text-foreground">{roleLabel}</TableCell>
                            <TableCell>
                              <Select
                                value={ro.layout_type}
                                onValueChange={v => updateRoleOverride(ro.role, "layout_type", v)}
                              >
                                <SelectTrigger className="w-48 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {LAYOUT_OPTIONS.map(l => (
                                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={ro.color_scheme}
                                onValueChange={v => updateRoleOverride(ro.role, "color_scheme", v)}
                              >
                                <SelectTrigger className="w-48 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {COLOR_OPTIONS.map(c => (
                                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-center">
                              <Checkbox
                                checked={ro.allow_user_override}
                                onCheckedChange={(v) => updateRoleOverride(ro.role, "allow_user_override", v === true)}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  <Button onClick={handleSaveRoleDefaults} disabled={savingRoles} className="w-full md:w-auto">
                    {savingRoles ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    Save Role Defaults
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
