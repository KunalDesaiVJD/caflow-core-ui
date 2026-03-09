import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Pencil, KeyRound, Activity, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format } from "date-fns";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  is_active: boolean | null;
  last_login: string | null;
  firm_id: string | null;
  created_at: string | null;
  must_change_password: boolean | null;
}

interface VersionEntry {
  id: string;
  operation: string | null;
  table_name: string | null;
  changed_fields: string[] | null;
  created_at: string | null;
  user_name: string | null;
}

const ROLE_COLORS: Record<string, string> = {
  superadmin: "bg-purple-100 text-purple-800 border-purple-300",
  firm_admin: "bg-destructive/15 text-destructive border-destructive/30",
  partner_ca: "bg-red-100 text-red-800 border-red-300",
  manager: "bg-amber-100 text-amber-800 border-amber-300",
  staff_article: "bg-green-100 text-green-800 border-green-300",
  client: "bg-muted text-muted-foreground border-border",
};

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  firm_admin: "Firm Admin",
  partner_ca: "Partner CA",
  manager: "Manager",
  staff_article: "Staff / Article",
  client: "Client",
};

const ROLE_HIERARCHY: Record<string, number> = {
  superadmin: 5, firm_admin: 4, partner_ca: 3, manager: 2, staff_article: 1, client: 0,
};

const ALL_ROLES = ["superadmin", "firm_admin", "partner_ca", "manager", "staff_article", "client"];

function getAllowedRoles(currentRole: string): string[] {
  const level = ROLE_HIERARCHY[currentRole] ?? 0;
  return Object.entries(ROLE_HIERARCHY)
    .filter(([, v]) => v < level)
    .map(([k]) => k)
    .sort((a, b) => (ROLE_HIERARCHY[b] ?? 0) - (ROLE_HIERARCHY[a] ?? 0));
}

async function invokeUserMgmt(action: string, method: string, body?: unknown, params?: Record<string, string>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const qs = new URLSearchParams({ action, ...params }).toString();
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "hubyywmodekfdzhwiumb";
  const url = `https://${projectId}.supabase.co/functions/v1/user-management?${qs}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc",
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export default function UserManagement() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [firmsList, setFirmsList] = useState<{ id: string; name: string }[]>([]);

  // Add user modal
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", phone: "", role: "", firm_id: "" });
  const [addLoading, setAddLoading] = useState(false);

  // Edit slide-over
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", phone: "", role: "" });
  const [editLoading, setEditLoading] = useState(false);

  // Reset password dialog
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [tempPassword, setTempPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // Delete confirmation
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Activity slide-over
  const [activityUser, setActivityUser] = useState<UserRow | null>(null);
  const [activityEntries, setActivityEntries] = useState<VersionEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // Access control
  useEffect(() => {
    if (!authLoading && user) {
      if (!["superadmin", "firm_admin"].includes(user.role || "")) {
        toast({ title: "Access Denied", description: "You don't have permission to access this page.", variant: "destructive" });
        navigate("/", { replace: true });
      }
    }
  }, [user, authLoading, navigate, toast]);

  useEffect(() => {
    if (!user || !["superadmin", "firm_admin"].includes(user.role || "")) return;
    loadUsers();
  }, [user]);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await invokeUserMgmt("list", "GET");
      setUsers(data);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
    const r = u.role || "staff_article";
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});

  async function handleAddUser() {
    setAddLoading(true);
    try {
      const result = await invokeUserMgmt("create", "POST", {
        name: addForm.name,
        email: addForm.email,
        phone: addForm.phone,
        role: addForm.role,
      });
      toast({
        title: "User created",
        description: `Default password: ${result.default_password}. User must change it on first login.`,
      });
      setShowAdd(false);
      setAddForm({ name: "", email: "", phone: "", role: "" });
      loadUsers();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAddLoading(false);
    }
  }

  async function handleToggleActive(u: UserRow) {
    try {
      await invokeUserMgmt("toggle-active", "POST", { user_id: u.id, is_active: !u.is_active });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleResetPassword() {
    if (!resetUser || !tempPassword) return;
    setResetLoading(true);
    try {
      await invokeUserMgmt("reset-password", "POST", {
        user_id: resetUser.id,
        temporary_password: tempPassword,
      });
      toast({
        title: "Password Reset",
        description: "Temporary password set. User must change password on next login.",
      });
      setResetUser(null);
      setTempPassword("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  }

  function openEdit(u: UserRow) {
    setEditUser(u);
    setEditForm({ name: u.name || "", phone: u.phone || "", role: u.role || "" });
  }

  async function handleEditSave() {
    if (!editUser) return;
    setEditLoading(true);
    try {
      await invokeUserMgmt("update", "POST", {
        user_id: editUser.id,
        name: editForm.name,
        phone: editForm.phone,
        role: editForm.role,
      });
      toast({ title: "User updated" });
      setEditUser(null);
      loadUsers();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setEditLoading(false);
    }
  }

  async function openActivity(u: UserRow) {
    setActivityUser(u);
    setActivityLoading(true);
    try {
      const data = await invokeUserMgmt("activity", "GET", undefined, { user_id: u.id });
      setActivityEntries(data);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActivityLoading(false);
    }
  }

  async function handleDeleteUser() {
    if (!deleteUser) return;
    setDeleteLoading(true);
    try {
      await invokeUserMgmt("delete", "POST", { user_id: deleteUser.id });
      toast({ title: "User deleted" });
      setDeleteUser(null);
      loadUsers();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  }

  const allowedRoles = getAllowedRoles(user?.role || "");
  const initials = (name: string | null) =>
    name ? name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "??";

  if (authLoading || !user) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Team Members</h1>
          <div className="flex gap-2 mt-2 flex-wrap">
            {ALL_ROLES.map(r => (
              <Badge key={r} variant="outline" className={ROLE_COLORS[r]}>
                {roleCounts[r] || 0} {ROLE_LABELS[r] || r}
              </Badge>
            ))}
          </div>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gap-2">
          <UserPlus size={16} /> Add User
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : users.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No team members found</TableCell></TableRow>
            ) : (
              users.map(u => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary font-semibold text-xs">
                        {initials(u.name)}
                      </div>
                      <span className="font-medium text-foreground">{u.name || "—"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.phone || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={ROLE_COLORS[u.role || "staff_article"]}>
                      {ROLE_LABELS[u.role || "staff_article"] || u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch checked={!!u.is_active} onCheckedChange={() => handleToggleActive(u)} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {u.last_login ? format(new Date(u.last_login), "dd MMM yyyy") : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Edit">
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setResetUser(u)} title="Reset Password">
                        <KeyRound size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openActivity(u)} title="View Activity">
                        <Activity size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteUser(u)} title="Delete" className="text-destructive hover:text-destructive">
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add User Modal */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))} placeholder="John Doe" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))} placeholder="john@firm.com" />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={addForm.phone} onChange={e => setAddForm(p => ({ ...p, phone: e.target.value }))} placeholder="+91 98765 43210" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={addForm.role} onValueChange={v => setAddForm(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {allowedRoles.map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              A role-based default password will be assigned. User must change it on first login.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={addLoading || !addForm.name || !addForm.email || !addForm.role}>
              {addLoading ? "Creating…" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetUser} onOpenChange={open => { if (!open) { setResetUser(null); setTempPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password — {resetUser?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Set a temporary password for <strong>{resetUser?.email}</strong>. The user will be forced to change it on next login.
            </p>
            <div className="space-y-2">
              <Label>Temporary Password</Label>
              <Input
                type="text"
                value={tempPassword}
                onChange={e => setTempPassword(e.target.value)}
                placeholder="Enter temporary password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetUser(null); setTempPassword(""); }}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetLoading || !tempPassword}>
              {resetLoading ? "Resetting…" : "Set Temporary Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Slide-over */}
      <Sheet open={!!editUser} onOpenChange={open => !open && setEditUser(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit {editUser?.name}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allowedRoles.map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleEditSave} disabled={editLoading} className="w-full mt-4">
              {editLoading ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Activity Slide-over */}
      <Sheet open={!!activityUser} onOpenChange={open => !open && setActivityUser(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Activity — {activityUser?.name}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            {activityLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : activityEntries.length === 0 ? (
              <p className="text-muted-foreground text-sm">No activity found</p>
            ) : (
              activityEntries.map(e => (
                <div key={e.id} className="border border-border rounded-md p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{e.operation}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {e.created_at ? format(new Date(e.created_at), "dd MMM yyyy HH:mm") : "—"}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">
                    <span className="text-muted-foreground">Table:</span> {e.table_name}
                  </p>
                  {e.changed_fields && e.changed_fields.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Changed: {e.changed_fields.join(", ")}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete User Confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={open => { if (!open) setDeleteUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteUser?.name}</strong> ({deleteUser?.email})? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteLoading ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
