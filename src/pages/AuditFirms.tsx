import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Building2, Loader2, AlertTriangle } from "lucide-react";

interface AuditFirm {
  id: string;
  firm_id: string;
  name: string;
  icai_reg_no: string | null;
  partner_name: string | null;
  partner_icai_no: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  active: boolean | null;
  created_at: string | null;
}

const emptyForm = {
  name: "",
  icai_reg_no: "",
  partner_name: "",
  partner_icai_no: "",
  address: "",
  city: "",
  email: "",
  phone: "",
  active: true,
};

export default function AuditFirms() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [firms, setFirms] = useState<AuditFirm[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deactivateWarning, setDeactivateWarning] = useState<string | null>(null);

  const canEdit = ["partner_ca", "firm_admin", "superadmin"].includes(user?.role || "");

  useEffect(() => { loadFirms(); }, []);

  async function loadFirms() {
    setLoading(true);
    const { data, error } = await supabase
      .from("audit_firms")
      .select("*")
      .order("name");
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    setFirms((data as AuditFirm[]) || []);
    setLoading(false);
  }

  function openAdd() {
    setEditId(null);
    setForm(emptyForm);
    setDeactivateWarning(null);
    setModalOpen(true);
  }

  function openEdit(f: AuditFirm) {
    setEditId(f.id);
    setForm({
      name: f.name || "",
      icai_reg_no: f.icai_reg_no || "",
      partner_name: f.partner_name || "",
      partner_icai_no: f.partner_icai_no || "",
      address: f.address || "",
      city: f.city || "",
      email: f.email || "",
      phone: f.phone || "",
      active: f.active !== false,
    });
    setDeactivateWarning(null);
    setModalOpen(true);
  }

  async function checkAssignments(firmId: string) {
    const { count } = await supabase
      .from("client_auditor_assignments")
      .select("*", { count: "exact", head: true })
      .eq("audit_firm_id", firmId);
    return (count || 0) > 0;
  }

  async function handleActiveToggle(active: boolean) {
    if (!active && editId) {
      const hasAssignments = await checkAssignments(editId);
      if (hasAssignments) {
        setDeactivateWarning("This firm is assigned to one or more client engagements. Deactivating will not remove existing assignments.");
      } else {
        setDeactivateWarning(null);
      }
    } else {
      setDeactivateWarning(null);
    }
    setForm(f => ({ ...f, active }));
  }

  async function handleSave() {
    if (!form.name || !user?.firm_id) return;
    setSaving(true);
    const payload = {
      firm_id: user.firm_id,
      name: form.name,
      icai_reg_no: form.icai_reg_no || null,
      partner_name: form.partner_name || null,
      partner_icai_no: form.partner_icai_no || null,
      address: form.address || null,
      city: form.city || null,
      email: form.email || null,
      phone: form.phone || null,
      active: form.active,
      ...(editId ? {} : { created_by: user.id }),
    };

    const { error } = editId
      ? await supabase.from("audit_firms").update(payload).eq("id", editId)
      : await supabase.from("audit_firms").insert(payload);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editId ? "Audit firm updated" : "Audit firm added" });
      setModalOpen(false);
      loadFirms();
    }
    setSaving(false);
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-foreground">Audit Firms</h1>
        {canEdit && (
          <Button size="sm" className="gap-1" onClick={openAdd}>
            <Plus className="h-3 w-3" /> Add Audit Firm
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Firm Name</TableHead>
                  <TableHead>ICAI Reg No</TableHead>
                  <TableHead>Partner Name</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Active</TableHead>
                  {canEdit && <TableHead className="w-16">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {firms.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 6 : 5} className="text-center text-muted-foreground py-8">
                      No audit firms added yet
                    </TableCell>
                  </TableRow>
                ) : (
                  firms.map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.name}</TableCell>
                      <TableCell className="font-mono text-sm">{f.icai_reg_no || "—"}</TableCell>
                      <TableCell>{f.partner_name || "—"}</TableCell>
                      <TableCell>{f.city || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={f.active !== false ? "default" : "secondary"} className="text-[10px]">
                          {f.active !== false ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(f)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {editId ? "Edit Audit Firm" : "Add Audit Firm"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Firm Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>ICAI Registration No *</Label>
              <Input value={form.icai_reg_no} onChange={e => setForm(f => ({ ...f, icai_reg_no: e.target.value }))} />
            </div>
            <div>
              <Label>Partner Name *</Label>
              <Input value={form.partner_name} onChange={e => setForm(f => ({ ...f, partner_name: e.target.value }))} />
            </div>
            <div>
              <Label>Partner ICAI Membership No</Label>
              <Input value={form.partner_icai_no} onChange={e => setForm(f => ({ ...f, partner_icai_no: e.target.value }))} />
            </div>
            <div>
              <Label>City</Label>
              <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Label>Address</Label>
              <Textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} rows={2} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={handleActiveToggle} />
              <Label>Active</Label>
            </div>
            {deactivateWarning && (
              <div className="sm:col-span-2 flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {deactivateWarning}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name}>
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              {editId ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
