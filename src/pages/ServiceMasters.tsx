import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Loader2, Package } from "lucide-react";

interface ServiceCategory {
  id: string;
  firm_id: string;
  category_code: string;
  name: string;
  description: string | null;
  frequency: string;
  default_due_day: number | null;
  applicable_entity_types: string[];
  linked_module: string | null;
  default_fee_template: any;
  is_active: boolean;
  sort_order: number;
  created_at: string | null;
}

interface ServiceTemplate {
  id: string;
  service_category_id: string;
  template_name: string;
  default_description: string | null;
  default_rate: number | null;
  hsn_sac_code: string | null;
  tax_rate: number | null;
  is_default: boolean;
}

const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half Yearly" },
  { value: "annual", label: "Annual" },
  { value: "event_based", label: "Event Based" },
];

const MODULES = [
  { value: "itr", label: "ITR" },
  { value: "tds", label: "TDS" },
  { value: "gst", label: "GST" },
  { value: "audit", label: "Audit" },
  { value: "billing", label: "Billing" },
  { value: "depreciation", label: "Depreciation" },
  { value: "roc", label: "ROC" },
  { value: "payroll", label: "Payroll" },
  { value: "bookkeeping", label: "Bookkeeping" },
  { value: "custom", label: "Custom" },
];

const ENTITY_TYPES = ["individual", "company", "llp", "trust", "huf", "firm", "aop"];

const FREQ_COLORS: Record<string, string> = {
  monthly: "bg-blue-100 text-blue-800 border-blue-200",
  quarterly: "bg-purple-100 text-purple-800 border-purple-200",
  half_yearly: "bg-indigo-100 text-indigo-800 border-indigo-200",
  annual: "bg-green-100 text-green-800 border-green-200",
  event_based: "bg-amber-100 text-amber-800 border-amber-200",
};

const DEFAULT_CATEGORIES = [
  { name: "Income Tax Returns", code: "ITR", frequency: "annual", module: "itr", due_day: 31, entities: ["individual","company","llp","trust","huf","firm","aop"] },
  { name: "TDS Compliance", code: "TDS", frequency: "quarterly", module: "tds", due_day: 7, entities: ["company","llp","firm","trust"] },
  { name: "GST Returns", code: "GST", frequency: "monthly", module: "gst", due_day: 20, entities: ["company","llp","firm","individual"] },
  { name: "Statutory Audit", code: "STAUD", frequency: "annual", module: "audit", due_day: 30, entities: ["company","llp"] },
  { name: "Tax Audit / 3CD", code: "TXAUD", frequency: "annual", module: "audit", due_day: 30, entities: ["company","llp","firm","individual"] },
  { name: "Internal Audit", code: "INTAUD", frequency: "event_based", module: "audit", due_day: null, entities: ["company"] },
  { name: "ROC Compliance", code: "ROC", frequency: "annual", module: "roc", due_day: 30, entities: ["company","llp"] },
  { name: "Payroll", code: "PAYRL", frequency: "monthly", module: "payroll", due_day: 7, entities: ["company","llp","firm"] },
  { name: "Bookkeeping", code: "BKKP", frequency: "monthly", module: "bookkeeping", due_day: 10, entities: ["individual","company","llp","firm","trust","huf","aop"] },
  { name: "MCA Filings", code: "MCA", frequency: "event_based", module: "roc", due_day: null, entities: ["company","llp"] },
  { name: "FEMA/RBI", code: "FEMA", frequency: "event_based", module: "custom", due_day: null, entities: ["company","llp"] },
];

const ServiceMasters = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceCategory | null>(null);
  const [saving, setSaving] = useState(false);

  // Firm selector for superadmin
  const [firmsList, setFirmsList] = useState<{ id: string; name: string }[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: "", description: "", frequency: "annual", default_due_day: "",
    applicable_entity_types: [] as string[], linked_module: "custom",
    is_active: true, category_code: "", package_name: "",
  });

  // Template form
  const [tplForm, setTplForm] = useState({ template_name: "", default_description: "", default_rate: "", hsn_sac_code: "", tax_rate: "18", is_default: false });
  const [editingTpl, setEditingTpl] = useState<ServiceTemplate | null>(null);

  const isSuperadmin = user?.role === "superadmin";
  const firmId = isSuperadmin ? selectedFirmId : user?.firm_id;

  // Load firms list for superadmin
  useEffect(() => {
    if (!isSuperadmin) return;
    supabase.from("firms").select("id, name").order("name").then(({ data }) => {
      setFirmsList(data || []);
      if (data && data.length > 0 && !selectedFirmId) setSelectedFirmId(data[0].id);
    });
  }, [isSuperadmin]);

  useEffect(() => { if (firmId) loadData(); }, [firmId]);

  async function loadData() {
    setLoading(true);
    const [catRes, tplRes] = await Promise.all([
      supabase.from("service_categories").select("*").eq("firm_id", firmId!).order("sort_order"),
      supabase.from("service_templates").select("*"),
    ]);
    const cats = (catRes.data || []) as any as ServiceCategory[];
    setCategories(cats);
    setTemplates((tplRes.data || []) as any as ServiceTemplate[]);

    // Seed defaults if no categories exist for this firm
    if (cats.length === 0 && firmId) {
      await seedDefaults();
    }
    setLoading(false);
  }

  async function seedDefaults() {
    const rows = DEFAULT_CATEGORIES.map((c, i) => ({
      firm_id: firmId!,
      category_code: c.code,
      name: c.name,
      frequency: c.frequency,
      default_due_day: c.due_day,
      applicable_entity_types: c.entities,
      linked_module: c.module,
      is_active: true,
      sort_order: i,
    }));
    await supabase.from("service_categories").insert(rows as any);
    const { data } = await supabase.from("service_categories").select("*").order("sort_order");
    setCategories((data || []) as any as ServiceCategory[]);
  }

  function openNew() {
    setEditing(null);
    const nextCode = `SVC${String(categories.length + 1).padStart(3, "0")}`;
    setForm({ name: "", description: "", frequency: "annual", default_due_day: "", applicable_entity_types: [], linked_module: "custom", is_active: true, category_code: nextCode, package_name: "" });
    setDrawerOpen(true);
  }

  function openEdit(cat: ServiceCategory) {
    setEditing(cat);
    setForm({
      name: cat.name,
      description: cat.description || "",
      frequency: cat.frequency,
      default_due_day: cat.default_due_day?.toString() || "",
      applicable_entity_types: Array.isArray(cat.applicable_entity_types) ? cat.applicable_entity_types : [],
      linked_module: cat.linked_module || "custom",
      is_active: cat.is_active,
      category_code: cat.category_code,
    });
    setDrawerOpen(true);
  }

  async function saveCategory() {
    if (!form.name.trim() || !firmId) return;
    setSaving(true);
    try {
      const payload = {
        firm_id: firmId,
        category_code: form.category_code,
        name: form.name,
        description: form.description || null,
        frequency: form.frequency,
        default_due_day: form.default_due_day ? parseInt(form.default_due_day) : null,
        applicable_entity_types: form.applicable_entity_types,
        linked_module: form.linked_module,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };
      if (editing) {
        await supabase.from("service_categories").update(payload as any).eq("id", editing.id);
      } else {
        await supabase.from("service_categories").insert({ ...payload, sort_order: categories.length } as any);
      }
      toast({ title: editing ? "Category updated" : "Category created" });
      await loadData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(cat: ServiceCategory) {
    await supabase.from("service_categories").update({ is_active: !cat.is_active } as any).eq("id", cat.id);
    setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, is_active: !c.is_active } : c));
  }

  // Templates
  const catTemplates = editing ? templates.filter(t => t.service_category_id === editing.id) : [];

  function resetTplForm() {
    setTplForm({ template_name: "", default_description: "", default_rate: "", hsn_sac_code: "", tax_rate: "18", is_default: false });
    setEditingTpl(null);
  }

  async function saveTemplate() {
    if (!editing || !tplForm.template_name.trim()) return;
    const payload = {
      service_category_id: editing.id,
      template_name: tplForm.template_name,
      default_description: tplForm.default_description || null,
      default_rate: tplForm.default_rate ? parseFloat(tplForm.default_rate) : null,
      hsn_sac_code: tplForm.hsn_sac_code || null,
      tax_rate: tplForm.tax_rate ? parseFloat(tplForm.tax_rate) : 18,
      is_default: tplForm.is_default,
    };
    if (editingTpl) {
      await supabase.from("service_templates").update(payload as any).eq("id", editingTpl.id);
    } else {
      await supabase.from("service_templates").insert(payload as any);
    }
    resetTplForm();
    const { data } = await supabase.from("service_templates").select("*");
    setTemplates((data || []) as any as ServiceTemplate[]);
  }

  async function deleteTemplate(id: string) {
    await supabase.from("service_templates").delete().eq("id", id);
    setTemplates(prev => prev.filter(t => t.id !== id));
  }

  function toggleEntity(et: string) {
    setForm(prev => ({
      ...prev,
      applicable_entity_types: prev.applicable_entity_types.includes(et)
        ? prev.applicable_entity_types.filter(e => e !== et)
        : [...prev.applicable_entity_types, et],
    }));
  }

  if (loading) return <div className="space-y-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Service Masters</h1>
          <p className="text-sm text-muted-foreground">Manage service categories and fee templates for your firm.</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> New Category</Button>
      </div>

      {isSuperadmin && firmsList.length > 0 && (
        <Select value={selectedFirmId || ""} onValueChange={v => setSelectedFirmId(v)}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select firm" /></SelectTrigger>
          <SelectContent>
            {firmsList.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map(cat => {
          const tplCount = templates.filter(t => t.service_category_id === cat.id).length;
          return (
            <Card key={cat.id} className={`transition-all ${!cat.is_active ? "opacity-50" : ""}`}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h3 className="font-semibold text-foreground">{cat.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono">{cat.category_code}</p>
                  </div>
                  <Switch checked={cat.is_active} onCheckedChange={() => toggleActive(cat)} />
                </div>
                {cat.description && <p className="text-xs text-muted-foreground line-clamp-2">{cat.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className={FREQ_COLORS[cat.frequency] || ""}>{FREQUENCIES.find(f => f.value === cat.frequency)?.label}</Badge>
                  {cat.linked_module && (
                    <Badge variant="secondary" className="text-[10px]">{MODULES.find(m => m.value === cat.linked_module)?.label}</Badge>
                  )}
                  {tplCount > 0 && <Badge variant="outline" className="text-[10px]">{tplCount} template{tplCount > 1 ? "s" : ""}</Badge>}
                </div>
                <Button variant="outline" size="sm" className="w-full gap-1" onClick={() => openEdit(cat)}>
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit Category" : "New Category"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category Code</Label>
                <Input value={form.category_code} onChange={e => setForm(p => ({ ...p, category_code: e.target.value }))} disabled={!!editing} />
              </div>
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Default Due Day</Label>
                <Input type="number" min={1} max={31} value={form.default_due_day} onChange={e => setForm(p => ({ ...p, default_due_day: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Linked Module</Label>
              <Select value={form.linked_module} onValueChange={v => setForm(p => ({ ...p, linked_module: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MODULES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Applicable Entity Types</Label>
              <div className="flex flex-wrap gap-2">
                {ENTITY_TYPES.map(et => (
                  <button
                    key={et}
                    onClick={() => toggleEntity(et)}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${form.applicable_entity_types.includes(et) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border"}`}
                  >
                    {et.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} />
              <Label>Active</Label>
            </div>
            <Button onClick={saveCategory} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editing ? "Update Category" : "Create Category"}
            </Button>

            {/* Templates sub-table */}
            {editing && (
              <div className="space-y-3 pt-4 border-t border-border">
                <h4 className="font-semibold text-sm text-foreground">Fee Templates</h4>
                {catTemplates.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Name</TableHead>
                        <TableHead className="text-xs text-right">Rate</TableHead>
                        <TableHead className="text-xs">HSN/SAC</TableHead>
                        <TableHead className="text-xs w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catTemplates.map(t => (
                        <TableRow key={t.id}>
                          <TableCell className="text-xs">{t.template_name}</TableCell>
                          <TableCell className="text-xs text-right font-mono">₹{(t.default_rate || 0).toLocaleString("en-IN")}</TableCell>
                          <TableCell className="text-xs font-mono">{t.hsn_sac_code || "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                                setEditingTpl(t);
                                setTplForm({ template_name: t.template_name, default_description: t.default_description || "", default_rate: t.default_rate?.toString() || "", hsn_sac_code: t.hsn_sac_code || "", tax_rate: t.tax_rate?.toString() || "18", is_default: t.is_default });
                              }}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteTemplate(t.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {/* Add/edit template form */}
                <div className="space-y-2 p-3 rounded-md bg-muted/50">
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Template name" value={tplForm.template_name} onChange={e => setTplForm(p => ({ ...p, template_name: e.target.value }))} className="text-xs" />
                    <Input placeholder="Rate" type="number" value={tplForm.default_rate} onChange={e => setTplForm(p => ({ ...p, default_rate: e.target.value }))} className="text-xs" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="HSN/SAC Code" value={tplForm.hsn_sac_code} onChange={e => setTplForm(p => ({ ...p, hsn_sac_code: e.target.value }))} className="text-xs" />
                    <Input placeholder="Tax %" type="number" value={tplForm.tax_rate} onChange={e => setTplForm(p => ({ ...p, tax_rate: e.target.value }))} className="text-xs" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveTemplate} disabled={!tplForm.template_name.trim()}>
                      {editingTpl ? "Update" : "Add"} Template
                    </Button>
                    {editingTpl && <Button size="sm" variant="outline" onClick={resetTplForm}>Cancel</Button>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ServiceMasters;
