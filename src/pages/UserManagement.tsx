import { useState, useEffect, useRef } from "react";
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
import { UserPlus, Pencil, KeyRound, Activity, Trash2, Upload, Camera, Mail, ShieldCheck, Eye, EyeOff, Search, X as XIcon } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/ui/UserAvatar";
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
  avatar_url: string | null;
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
  superadmin:    "bg-purple-100 text-purple-800 border-purple-300",
  firm_admin:    "bg-destructive/15 text-destructive border-destructive/30",
  partner_ca:    "bg-red-100 text-red-800 border-red-300",
  manager:       "bg-amber-100 text-amber-800 border-amber-300",
  staff_article: "bg-green-100 text-green-800 border-green-300",
  client:        "bg-muted text-muted-foreground border-border",
};

const ROLE_LABELS: Record<string, string> = {
  superadmin:    "Superadmin",
  firm_admin:    "Firm Admin",
  partner_ca:    "Partner CA",
  manager:       "Manager",
  staff_article: "Staff / Article",
  client:        "Client",
};

const ROLE_HIERARCHY: Record<string, number> = {
  superadmin: 5, firm_admin: 4, partner_ca: 3, manager: 2, staff_article: 1, client: 0,
};

// Client role is intentionally excluded — client logins are managed through the Clients section
const ALL_ROLES = ["superadmin", "firm_admin", "partner_ca", "manager", "staff_article"];

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID || "hubyywmodekfdzhwiumb";
const ANON_KEY   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc";

function getAllowedRoles(currentRole: string): string[] {
  const level = ROLE_HIERARCHY[currentRole] ?? 0;
  return Object.entries(ROLE_HIERARCHY)
    .filter(([k, v]) => v < level && k !== "client") // client logins managed via Clients section
    .map(([k]) => k)
    .sort((a, b) => (ROLE_HIERARCHY[b] ?? 0) - (ROLE_HIERARCHY[a] ?? 0));
}

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

async function invokeUserMgmt(action: string, method: string, body?: unknown, params?: Record<string, string>) {
  const token = await getToken();
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`https://${PROJECT_ID}.supabase.co/functions/v1/user-management?${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", apikey: ANON_KEY },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

async function invokeOtpAuth(action: string, body: unknown) {
  const res = await fetch(`https://${PROJECT_ID}.supabase.co/functions/v1/otp-auth?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "OTP request failed");
  return data;
}

export default function UserManagement() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [users, setUsers]         = useState<UserRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [firmsList, setFirmsList] = useState<{ id: string; name: string }[]>([]);
  // Search query — matches case-insensitively against name, email, phone, firm
  // name, and role label, so the auditor can find a teammate by whichever
  // attribute they remember.
  const [searchQuery, setSearchQuery] = useState("");

  /* ── Add user ── */
  const [showAdd, setShowAdd]   = useState(false);
  const [addForm, setAddForm]   = useState({ name: "", email: "", phone: "", role: "", firm_id: "" });
  const [addLoading, setAddLoading] = useState(false);

  /* ── Edit slide-over ── */
  const [editUser, setEditUser]   = useState<UserRow | null>(null);
  const [editForm, setEditForm]   = useState({ name: "", phone: "", role: "", firm_id: "" });
  const [editLoading, setEditLoading] = useState(false);
  // Email change
  const [showEmailChange, setShowEmailChange] = useState(false);
  const [newEmail, setNewEmail]               = useState("");
  const [emailLoading, setEmailLoading]       = useState(false);
  // Avatar upload
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  /* ── Admin password reset (set temp password) ── */
  const [resetUser, setResetUser]   = useState<UserRow | null>(null);
  const [tempPassword, setTempPassword] = useState("");
  const [showTempPw, setShowTempPw]     = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  /* ── OTP-based self-service password reset ── */
  const [otpResetUser, setOtpResetUser]   = useState<UserRow | null>(null);
  const [otpStep, setOtpStep]             = useState<"send" | "verify">("send");
  const [otpCode, setOtpCode]             = useState("");
  const [otpNewPw, setOtpNewPw]           = useState("");
  const [showOtpPw, setShowOtpPw]         = useState(false);
  const [otpLoading, setOtpLoading]       = useState(false);

  /* ── Delete ── */
  const [deleteUser, setDeleteUser]     = useState<UserRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  /* ── Activity ── */
  const [activityUser, setActivityUser]     = useState<UserRow | null>(null);
  const [activityEntries, setActivityEntries] = useState<VersionEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  /* ── Access guard ── */
  useEffect(() => {
    // Wait until role is resolved (null = optimistic JWT phase, role not yet loaded from DB)
    if (!authLoading && user?.role && !["superadmin", "firm_admin"].includes(user.role)) {
      toast({ title: "Access Denied", variant: "destructive" });
      navigate("/", { replace: true });
    }
  }, [user, authLoading, navigate, toast]);

  useEffect(() => {
    if (!user || !["superadmin", "firm_admin"].includes(user.role || "")) return;
    loadUsers();
    // FIX 6 (CAFlow_FirmFix_Report): load every firm so the Firm column in
    // the user table resolves user.firm_id → name for users belonging to
    // any firm, not only the current admin's own firm.
    supabase.from("firms").select("id, name, display_name").order("name").then(({ data }) => {
      setFirmsList((data || []).map((f: any) => ({ id: f.id, name: f.display_name || f.name })));
    });
  }, [user]);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await invokeUserMgmt("list", "GET");
      // Exclude clients — they are managed through the Clients section, not here
      setUsers((data as UserRow[]).filter(u => u.role !== "client"));
    } catch (e: any) {
      toast({ title: "Error loading users", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
    const r = u.role || "staff_article";
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});

  /* ── Avatar upload ── */
  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!editUser || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Avatar must be under 2 MB", variant: "destructive" });
      return;
    }
    setAvatarUploading(true);
    try {
      const ext  = file.name.split(".").pop() || "jpg";
      const path = `avatars/${editUser.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from("user-avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from("user-avatars").getPublicUrl(path);
      const avatarUrl = `${publicUrl}?t=${Date.now()}`; // cache-bust

      await invokeUserMgmt("update-avatar", "POST", { user_id: editUser.id, avatar_url: avatarUrl });
      setUsers(prev => prev.map(u => u.id === editUser.id ? { ...u, avatar_url: avatarUrl } : u));
      setEditUser(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev);
      toast({ title: "Profile picture updated ✓" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setAvatarUploading(false);
    }
  }

  /* ── Edit save ── */
  function openEdit(u: UserRow) {
    setEditUser(u);
    setEditForm({ name: u.name || "", phone: u.phone || "", role: u.role || "", firm_id: u.firm_id || "" });
    setShowEmailChange(false);
    setNewEmail("");
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
        firm_id: editForm.firm_id || undefined,
      });
      toast({ title: "User updated ✓" });
      setEditUser(null);
      loadUsers();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setEditLoading(false);
    }
  }

  /* ── Email change ── */
  async function handleEmailChange() {
    if (!editUser || !newEmail) return;
    setEmailLoading(true);
    try {
      await invokeUserMgmt("change-email", "POST", {
        user_id: editUser.id,
        new_email: newEmail,
        old_email: editUser.email,
      });
      toast({ title: "Email updated ✓", description: `Email changed to ${newEmail}` });
      setUsers(prev => prev.map(u => u.id === editUser.id ? { ...u, email: newEmail } : u));
      setEditUser(prev => prev ? { ...prev, email: newEmail } : prev);
      setShowEmailChange(false);
      setNewEmail("");
    } catch (e: any) {
      toast({ title: "Email change failed", description: e.message, variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  }

  /* ── Admin set temp password ── */
  async function handleResetPassword() {
    if (!resetUser || !tempPassword) return;
    setResetLoading(true);
    try {
      await invokeUserMgmt("reset-password", "POST", {
        user_id: resetUser.id,
        temporary_password: tempPassword,
      });
      toast({ title: "Password reset ✓", description: "Temporary password set. User must change it on next login." });
      setResetUser(null);
      setTempPassword("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  }

  /* ── OTP reset flow ── */
  async function handleSendOtp() {
    if (!otpResetUser?.email) return;
    setOtpLoading(true);
    try {
      await invokeOtpAuth("send-otp", { email: otpResetUser.email, purpose: "password_reset" });
      toast({ title: "OTP sent ✓", description: `6-digit OTP sent to ${otpResetUser.email}` });
      setOtpStep("verify");
    } catch (e: any) {
      toast({ title: "Failed to send OTP", description: e.message, variant: "destructive" });
    } finally {
      setOtpLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otpResetUser?.email || !otpCode || !otpNewPw) return;
    if (otpNewPw.length < 8) {
      toast({ title: "Password too short", description: "Minimum 8 characters required", variant: "destructive" });
      return;
    }
    setOtpLoading(true);
    try {
      await invokeOtpAuth("verify-otp", {
        email: otpResetUser.email,
        otp_code: otpCode,
        new_password: otpNewPw,
        purpose: "password_reset",
      });
      toast({ title: "Password reset ✓", description: "Password has been reset via OTP successfully." });
      setOtpResetUser(null);
      setOtpStep("send");
      setOtpCode("");
      setOtpNewPw("");
    } catch (e: any) {
      toast({ title: "OTP verification failed", description: e.message, variant: "destructive" });
    } finally {
      setOtpLoading(false);
    }
  }

  /* ── Activity ── */
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

  /* ── Delete ── */
  async function handleDeleteUser() {
    if (!deleteUser) return;
    setDeleteLoading(true);
    try {
      await Promise.all([
        supabase.from("demand_notices").update({ assigned_to: null } as any).eq("assigned_to", deleteUser.id),
        supabase.from("demand_notices").update({ created_by: null } as any).eq("created_by", deleteUser.id),
        supabase.from("itr_profiles").update({ assigned_to: null } as any).eq("assigned_to", deleteUser.id),
        supabase.from("itr_profiles").update({ prepared_by: null } as any).eq("prepared_by", deleteUser.id),
        supabase.from("timesheets").update({ user_id: null } as any).eq("user_id", deleteUser.id),
        supabase.from("chat_participants").delete().eq("user_id", deleteUser.id),
      ]);
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

  /* ── Toggle active ── */
  async function handleToggleActive(u: UserRow) {
    try {
      await invokeUserMgmt("toggle-active", "POST", { user_id: u.id, is_active: !u.is_active });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  const allowedRoles = getAllowedRoles(user?.role || "");

  if (authLoading || !user) return null;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Team Members</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Firm employees only. Client portal logins are managed from the{" "}
            <a href="/clients" className="text-primary underline underline-offset-2">Clients</a> section.
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            {ALL_ROLES.map(r => (
              <Badge key={r} variant="outline" className={ROLE_COLORS[r]}>
                {roleCounts[r] || 0} {ROLE_LABELS[r] || r}
              </Badge>
            ))}
          </div>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gap-2">
          <UserPlus size={16} /> Add Team Member
        </Button>
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by name, email, phone, firm, or role…"
          className="pl-9 pr-9"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <XIcon size={14} />
          </button>
        )}
      </div>

      {/* ── Users Table ── */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Firm</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(() => {
              // Filter once per render so the no-results and rows branches
              // share the same source of truth. Lowercase + .includes() across
              // every column the user might type — name, email, phone, firm
              // name, role display label, raw role key.
              const q = searchQuery.trim().toLowerCase();
              const visibleUsers = !q ? users : users.filter(u => {
                const firmName = firmsList.find(f => f.id === u.firm_id)?.name || "";
                const roleLabel = ROLE_LABELS[u.role || "staff_article"] || u.role || "";
                return (
                  (u.name  || "").toLowerCase().includes(q) ||
                  (u.email || "").toLowerCase().includes(q) ||
                  (u.phone || "").toLowerCase().includes(q) ||
                  firmName.toLowerCase().includes(q) ||
                  roleLabel.toLowerCase().includes(q) ||
                  (u.role || "").toLowerCase().includes(q)
                );
              });
              if (loading) {
                return <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">Loading…</TableCell></TableRow>;
              }
              if (users.length === 0) {
                return <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">No team members found. Client logins are in the Clients section.</TableCell></TableRow>;
              }
              if (visibleUsers.length === 0) {
                return <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">No team members match "{searchQuery}".</TableCell></TableRow>;
              }
              return visibleUsers.map(u => (
              <TableRow key={u.id} className="group">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <UserAvatar name={u.name} avatarUrl={u.avatar_url} size="sm" ring />
                    <div>
                      <p className="font-medium text-foreground leading-tight">{u.name || "—"}</p>
                      {u.must_change_password && (
                        <span className="text-[10px] text-amber-600 font-medium">Must change password</span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{u.email || "—"}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{u.phone || "—"}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {/* FIX 6: resolve each user's firm via user.firm_id → firms.
                      Never filtered to only the current admin's firm. */}
                  {firmsList.find(f => f.id === u.firm_id)?.name || "—"}
                </TableCell>
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
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Edit Profile">
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setResetUser(u); setTempPassword(""); }} title="Admin Reset Password">
                      <KeyRound size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setOtpResetUser(u); setOtpStep("send"); setOtpCode(""); setOtpNewPw(""); }} title="OTP Password Reset">
                      <ShieldCheck size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openActivity(u)} title="Activity Log">
                      <Activity size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteUser(u)} title="Delete" className="text-destructive hover:text-destructive">
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              ));
            })()}
          </TableBody>
        </Table>
      </div>

      {/* ── Add User Modal ── */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Rahul Sharma" />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))} placeholder="rahul@firm.com" />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={addForm.phone} onChange={e => setAddForm(p => ({ ...p, phone: e.target.value }))} placeholder="+91 98765 43210" />
            </div>
            <div className="space-y-2">
              <Label>Role *</Label>
              <Select value={addForm.role} onValueChange={v => setAddForm(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {allowedRoles.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {user?.role === "superadmin" && (
              <div className="space-y-2">
                <Label>Firm</Label>
                <Select value={addForm.firm_id} onValueChange={v => setAddForm(p => ({ ...p, firm_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select firm" /></SelectTrigger>
                  <SelectContent>{firmsList.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <p className="text-xs text-muted-foreground bg-muted rounded p-2">
              A role-based default password will be assigned. The user must change it on first login.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={async () => {
              setAddLoading(true);
              try {
                const result = await invokeUserMgmt("create", "POST", addForm);
                toast({ title: "User created ✓", description: `Default password: ${result.default_password}` });
                setShowAdd(false);
                setAddForm({ name: "", email: "", phone: "", role: "", firm_id: "" });
                loadUsers();
              } catch (e: any) {
                toast({ title: "Error", description: e.message, variant: "destructive" });
              } finally {
                setAddLoading(false);
              }
            }} disabled={addLoading || !addForm.name || !addForm.email || !addForm.role}>
              {addLoading ? "Creating…" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Slide-over ── */}
      <Sheet open={!!editUser} onOpenChange={open => !open && setEditUser(null)}>
        <SheetContent className="w-[420px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Profile</SheetTitle>
          </SheetHeader>

          {/* Avatar section */}
          <div className="flex flex-col items-center gap-3 mt-6 mb-6">
            <div className="relative group cursor-pointer" onClick={() => avatarInputRef.current?.click()}>
              <UserAvatar name={editUser?.name} avatarUrl={editUser?.avatar_url} size="xl" ring />
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={20} className="text-white" />
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
              <Upload size={14} />
              {avatarUploading ? "Uploading…" : "Change Photo"}
            </Button>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
            <p className="text-xs text-muted-foreground">JPG, PNG or WebP — max 2 MB</p>
          </div>

          <Separator className="mb-5" />

          <div className="space-y-4">
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
                  {allowedRoles.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {user?.role === "superadmin" && (
              <div className="space-y-2">
                <Label>Firm</Label>
                <Select value={editForm.firm_id} onValueChange={v => setEditForm(p => ({ ...p, firm_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select firm" /></SelectTrigger>
                  <SelectContent>{firmsList.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={handleEditSave} disabled={editLoading} className="w-full">
              {editLoading ? "Saving…" : "Save Changes"}
            </Button>

            <Separator />

            {/* Email Change Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold flex items-center gap-2"><Mail size={14}/> Email Address</Label>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowEmailChange(v => !v)}>
                  {showEmailChange ? "Cancel" : "Change Email"}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground bg-muted rounded px-3 py-2 mb-2">{editUser?.email || "—"}</p>
              {showEmailChange && (
                <div className="space-y-2">
                  <Input
                    type="email"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="Enter new email address"
                  />
                  <Button onClick={handleEmailChange} disabled={emailLoading || !newEmail} className="w-full" size="sm">
                    {emailLoading ? "Updating…" : "Update Email"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Admin Set Temp Password Dialog ── */}
      <Dialog open={!!resetUser} onOpenChange={open => { if (!open) { setResetUser(null); setTempPassword(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound size={18}/> Reset Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <UserAvatar name={resetUser?.name} avatarUrl={resetUser?.avatar_url} size="sm" />
              <div>
                <p className="font-medium text-sm">{resetUser?.name}</p>
                <p className="text-xs text-muted-foreground">{resetUser?.email}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Set a temporary password. The user will be required to change it on next login.
            </p>
            <div className="space-y-2">
              <Label>Temporary Password</Label>
              <div className="relative">
                <Input
                  type={showTempPw ? "text" : "password"}
                  value={tempPassword}
                  onChange={e => setTempPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="pr-10"
                />
                <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-7 w-7" onClick={() => setShowTempPw(v => !v)}>
                  {showTempPw ? <EyeOff size={14}/> : <Eye size={14}/>}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetUser(null); setTempPassword(""); }}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetLoading || !tempPassword || tempPassword.length < 8}>
              {resetLoading ? "Resetting…" : "Set Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── OTP Password Reset Dialog ── */}
      <Dialog open={!!otpResetUser} onOpenChange={open => { if (!open) { setOtpResetUser(null); setOtpStep("send"); setOtpCode(""); setOtpNewPw(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck size={18}/> OTP Password Reset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <UserAvatar name={otpResetUser?.name} avatarUrl={otpResetUser?.avatar_url} size="sm" />
              <div>
                <p className="font-medium text-sm">{otpResetUser?.name}</p>
                <p className="text-xs text-muted-foreground">{otpResetUser?.email}</p>
              </div>
            </div>

            {otpStep === "send" ? (
              <>
                <p className="text-sm text-muted-foreground">
                  A 6-digit OTP will be sent to <strong>{otpResetUser?.email}</strong> from <strong>accounts@vjdesai.com</strong>.
                  The user can then set a new password.
                </p>
                <Button onClick={handleSendOtp} disabled={otpLoading} className="w-full">
                  {otpLoading ? "Sending OTP…" : "Send OTP to Email"}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">OTP sent to {otpResetUser?.email}</Label>
                  <Input
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Enter 6-digit OTP"
                    className="tracking-[0.5em] text-center font-mono text-lg"
                    maxLength={6}
                  />
                </div>
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <div className="relative">
                    <Input
                      type={showOtpPw ? "text" : "password"}
                      value={otpNewPw}
                      onChange={e => setOtpNewPw(e.target.value)}
                      placeholder="Min 8 characters"
                      className="pr-10"
                    />
                    <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-7 w-7" onClick={() => setShowOtpPw(v => !v)}>
                      {showOtpPw ? <EyeOff size={14}/> : <Eye size={14}/>}
                    </Button>
                  </div>
                </div>
                <Button onClick={handleVerifyOtp} disabled={otpLoading || otpCode.length !== 6 || otpNewPw.length < 8} className="w-full">
                  {otpLoading ? "Verifying…" : "Verify OTP & Reset Password"}
                </Button>
                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setOtpStep("send")}>
                  ← Resend OTP
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Activity Log Slide-over ── */}
      <Sheet open={!!activityUser} onOpenChange={open => !open && setActivityUser(null)}>
        <SheetContent>
          <SheetHeader>
            <div className="flex items-center gap-3">
              <UserAvatar name={activityUser?.name} avatarUrl={activityUser?.avatar_url} size="sm" />
              <SheetTitle>Activity — {activityUser?.name}</SheetTitle>
            </div>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            {activityLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : activityEntries.length === 0 ? (
              <p className="text-muted-foreground text-sm">No activity found</p>
            ) : activityEntries.map(e => (
              <div key={e.id} className="border border-border rounded-md p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">{e.operation}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {e.created_at ? format(new Date(e.created_at), "dd MMM yyyy HH:mm") : "—"}
                  </span>
                </div>
                <p className="text-sm text-foreground"><span className="text-muted-foreground">Table: </span>{e.table_name}</p>
                {e.changed_fields && e.changed_fields.length > 0 && (
                  <p className="text-xs text-muted-foreground">Changed: {e.changed_fields.join(", ")}</p>
                )}
                {e.user_name && <p className="text-xs text-muted-foreground">By: {e.user_name}</p>}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Delete Confirmation ── */}
      <AlertDialog open={!!deleteUser} onOpenChange={open => { if (!open) setDeleteUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{deleteUser?.name}</strong> ({deleteUser?.email})?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteLoading ? "Deleting…" : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
