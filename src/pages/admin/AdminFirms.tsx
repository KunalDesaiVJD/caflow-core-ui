import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Plus, Pencil, UserCheck } from "lucide-react";
import { format } from "date-fns";
import { callAdmin, Firm, PLAN_COLORS } from "./adminShared";

const AdminFirms = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  const [firms, setFirms] = useState<Firm[]>([]);
  const [loadingFirms, setLoadingFirms] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [newFirm, setNewFirm] = useState({ name: "", icai_reg_no: "", plan: "starter" });
  const [adding, setAdding] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editFirm, setEditFirm] = useState<{ id: string; name: string; plan: string; icai_reg_no: string }>({ id: "", name: "", plan: "", icai_reg_no: "" });
  const [saving, setSaving] = useState(false);

  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateFirm, setImpersonateFirm] = useState<Firm | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== "superadmin")) {
      toast({ title: "Access Denied", variant: "destructive" });
      navigate("/", { replace: true });
    }
  }, [authLoading, user, navigate, toast]);

  const fetchFirms = useCallback(async () => {
    try {
      const data = await callAdmin("firms");
      setFirms(data);
    } catch { /* handled */ } finally {
      setLoadingFirms(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === "superadmin") fetchFirms();
  }, [user, fetchFirms]);

  const handleAddFirm = async () => {
    if (!newFirm.name.trim()) return;
    setAdding(true);
    try {
      await callAdmin("add-firm", "POST", newFirm);
      toast({ title: "Firm added successfully" });
      setAddOpen(false);
      setNewFirm({ name: "", icai_reg_no: "", plan: "starter" });
      fetchFirms();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleEditFirm = async () => {
    setSaving(true);
    try {
      await callAdmin("update-firm", "POST", editFirm);
      toast({ title: "Firm updated" });
      setEditOpen(false);
      fetchFirms();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (firm: Firm) => {
    try {
      await callAdmin("toggle-active", "POST", { id: firm.id, is_active: !firm.is_active });
      fetchFirms();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleImpersonate = async () => {
    if (!impersonateFirm) return;
    try {
      await callAdmin("impersonate", "POST", {
        firm_id: impersonateFirm.id,
        firm_name: impersonateFirm.name,
        superadmin_name: user?.name || "Superadmin",
      });
      sessionStorage.setItem("impersonated_firm_id", impersonateFirm.id);
      sessionStorage.setItem("impersonated_firm_name", impersonateFirm.name);
      toast({ title: `Now viewing as ${impersonateFirm.name}` });
      setImpersonateOpen(false);
      navigate("/");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  if (authLoading) {
    return <div className="p-6 space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (!user || user.role !== "superadmin") return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Firms Management</h1>
          <p className="text-sm text-muted-foreground">Manage all registered firms</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Firm
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loadingFirms ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Firm Name</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Clients</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {firms.map((firm) => (
                  <TableRow key={firm.id}>
                    <TableCell className="font-medium">{firm.name}</TableCell>
                    <TableCell>
                      <Badge className={PLAN_COLORS[firm.plan || "starter"] || PLAN_COLORS.starter}>
                        {firm.plan || "starter"}
                      </Badge>
                    </TableCell>
                    <TableCell>{firm.users_count}</TableCell>
                    <TableCell>{firm.clients_count}</TableCell>
                    <TableCell>
                      <Switch checked={!!firm.is_active} onCheckedChange={() => handleToggleActive(firm)} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {firm.created_at ? format(new Date(firm.created_at), "dd MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { setEditFirm({ id: firm.id, name: firm.name, plan: firm.plan || "starter", icai_reg_no: firm.icai_reg_no || "" }); setEditOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setImpersonateFirm(firm); setImpersonateOpen(true); }}>
                          <UserCheck className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {firms.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No firms found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Firm Modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add New Firm</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Firm Name *</label>
              <Input value={newFirm.name} onChange={(e) => setNewFirm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">ICAI Registration No</label>
              <Input value={newFirm.icai_reg_no} onChange={(e) => setNewFirm((f) => ({ ...f, icai_reg_no: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Plan</label>
              <Select value={newFirm.plan} onValueChange={(v) => setNewFirm((f) => ({ ...f, plan: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddFirm} disabled={adding || !newFirm.name.trim()}>
              {adding ? "Adding..." : "Add Firm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Firm Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>Edit Firm</SheetTitle></SheetHeader>
          <div className="space-y-4 py-6">
            <div>
              <label className="text-sm font-medium">Firm Name *</label>
              <Input value={editFirm.name} onChange={(e) => setEditFirm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">ICAI Registration No</label>
              <Input value={editFirm.icai_reg_no} onChange={(e) => setEditFirm((f) => ({ ...f, icai_reg_no: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Plan</label>
              <Select value={editFirm.plan} onValueChange={(v) => setEditFirm((f) => ({ ...f, plan: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <SheetFooter>
            <Button onClick={handleEditFirm} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Impersonate Confirmation */}
      <Dialog open={impersonateOpen} onOpenChange={setImpersonateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Impersonation</DialogTitle>
            <DialogDescription>
              You are about to impersonate <strong>{impersonateFirm?.name}</strong>. This action will be logged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImpersonateOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleImpersonate}>Confirm Impersonate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminFirms;
