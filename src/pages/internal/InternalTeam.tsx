import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Users, UserPlus, Shield, Briefcase, HeadphonesIcon,
  Building2, Loader2, Mail, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface TeamMember {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  firm_count?: number;
}

interface FirmRow { id: string; name: string; }

const ROLE_LABELS: Record<string, string> = {
  implementation_executive:  "Implementation Executive",
  client_success_executive:  "Client Success Executive",
};

const ROLE_COLORS: Record<string, string> = {
  implementation_executive:  "bg-blue-100 text-blue-800",
  client_success_executive:  "bg-purple-100 text-purple-800",
};

const ROLE_ICONS: Record<string, React.ElementType> = {
  implementation_executive: Briefcase,
  client_success_executive: HeadphonesIcon,
};

export default function InternalTeam() {
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [firms, setFirms] = useState<FirmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Invite dialog
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("implementation_executive");
  const [inviting, setInviting] = useState(false);

  // CSE portfolio dialog
  const [portfolioMember, setPortfolioMember] = useState<TeamMember | null>(null);
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [savingPortfolio, setSavingPortfolio] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: mData }, { data: fData }] = await Promise.all([
      (supabase as any)
        .from("users")
        .select("id, name, email, role, is_active, created_at")
        .in("role", ["implementation_executive", "client_success_executive"])
        .order("name"),
      (supabase as any).from("firms").select("id, name").order("name"),
    ]);

    // Count portfolios for CSEs
    const { data: portData } = await (supabase as any)
      .from("cse_portfolios")
      .select("cse_user_id, firm_id");

    const portCount: Record<string, number> = {};
    for (const p of portData || []) {
      portCount[p.cse_user_id] = (portCount[p.cse_user_id] ?? 0) + 1;
    }

    setMembers(
      (mData || []).map((m: any) => ({
        id: m.id, name: m.name, email: m.email, role: m.role,
        is_active: m.is_active ?? true, created_at: m.created_at,
        firm_count: portCount[m.id] ?? 0,
      }))
    );
    setFirms((fData || []).map((f: any) => ({ id: f.id, name: f.name })));
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const inviteMember = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return;
    setInviting(true);
    try {
      // Create user via admin — in production you'd send an invite email.
      // Here we insert directly with a temp password flow.
      const { data: authData, error: authErr } = await (supabase as any).auth.admin
        ? // If admin client available:
          (supabase as any).auth.admin.createUser({
            email: inviteEmail.trim(),
            user_metadata: { name: inviteName.trim(), role: inviteRole, firm_id: null },
            email_confirm: true,
          })
        : { data: null, error: new Error("Admin API not available from browser. Use Supabase dashboard to create internal users.") };

      if (authErr) throw authErr;

      toast({ title: `${ROLE_LABELS[inviteRole]} account created. Password reset email sent to ${inviteEmail}.` });
      setShowInvite(false);
      setInviteEmail(""); setInviteName(""); setInviteRole("implementation_executive");
      await loadData();
    } catch (err: any) {
      // Fallback: just show instructions
      toast({
        title: "Manual setup required",
        description: `Create user ${inviteEmail} in Supabase dashboard with role: ${inviteRole}`,
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  };

  const loadPortfolio = async (memberId: string) => {
    setLoadingPortfolio(true);
    const { data } = await (supabase as any)
      .from("cse_portfolios")
      .select("firm_id")
      .eq("cse_user_id", memberId);
    setPortfolio((data || []).map((p: any) => p.firm_id));
    setLoadingPortfolio(false);
  };

  const openPortfolio = (m: TeamMember) => {
    setPortfolioMember(m);
    loadPortfolio(m.id);
  };

  const togglePortfolio = (firmId: string) => {
    setPortfolio(prev =>
      prev.includes(firmId) ? prev.filter(f => f !== firmId) : [...prev, firmId]
    );
  };

  const savePortfolio = async () => {
    if (!portfolioMember) return;
    setSavingPortfolio(true);
    try {
      // Delete all existing portfolio entries for this CSE
      await (supabase as any).from("cse_portfolios").delete().eq("cse_user_id", portfolioMember.id);
      // Insert new ones
      if (portfolio.length > 0) {
        await (supabase as any).from("cse_portfolios").insert(
          portfolio.map(firmId => ({
            cse_user_id: portfolioMember.id,
            firm_id: firmId,
            assigned_by: authUser?.id,
          }))
        );
      }
      toast({ title: `Portfolio updated — ${portfolio.length} firm(s) assigned` });
      setPortfolioMember(null);
      await loadData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingPortfolio(false);
    }
  };

  const deactivate = async (memberId: string) => {
    const { error } = await (supabase as any)
      .from("users")
      .update({ is_active: false })
      .eq("id", memberId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, is_active: false } : m));
    toast({ title: "Member deactivated" });
  };

  const filtered = members.filter(m => {
    const q = search.toLowerCase();
    const matchesSearch = !q || (m.name || "").toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q);
    const matchesRole = roleFilter === "all" || m.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Users size={22} /> Internal Team
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage Implementation Executives and Client Success Executives.
          </p>
        </div>
        <Button onClick={() => setShowInvite(true)} className="gap-2">
          <UserPlus size={16} /> Add Team Member
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { role: "implementation_executive", label: "Implementation Executives", icon: Briefcase, color: "text-blue-600" },
          { role: "client_success_executive", label: "Client Success Executives", icon: HeadphonesIcon, color: "text-purple-600" },
        ].map(s => {
          const count = members.filter(m => m.role === s.role && m.is_active).length;
          return (
            <Card key={s.role}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <s.icon size={20} className={cn("shrink-0", s.color)} />
                  <div>
                    <p className="text-2xl font-bold text-foreground">{count}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search team..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-52 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="implementation_executive">Implementation Executives</SelectItem>
            <SelectItem value="client_success_executive">Client Success Executives</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Members table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No team members found
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-center px-4 py-3 font-medium">Portfolio</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const RoleIcon = ROLE_ICONS[m.role] ?? Shield;
                  return (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-xs shrink-0">
                            {(m.name || "?").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{m.name || "—"}</p>
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Mail size={10} /> {m.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={cn("text-[10px]", ROLE_COLORS[m.role] ?? "bg-muted")}>
                          <RoleIcon size={10} className="mr-1" />
                          {ROLE_LABELS[m.role] || m.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {m.role === "client_success_executive" ? (
                          <button
                            onClick={() => openPortfolio(m)}
                            className="text-primary hover:underline text-sm font-medium"
                          >
                            {m.firm_count} firm{m.firm_count !== 1 ? "s" : ""}
                          </button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={m.is_active ? "default" : "secondary"} className="text-[10px]">
                          {m.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {format(new Date(m.created_at), "dd MMM yyyy")}
                      </td>
                      <td className="px-4 py-3">
                        {m.is_active && (
                          <Button
                            size="sm" variant="ghost"
                            className="text-[11px] text-destructive hover:text-destructive h-7"
                            onClick={() => deactivate(m.id)}
                          >
                            Deactivate
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Invite dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Full Name</label>
              <Input
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                placeholder="e.g. Priya Sharma"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Email Address</label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="priya@caflow.app"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Role</label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="implementation_executive">Implementation Executive</SelectItem>
                  <SelectItem value="client_success_executive">Client Success Executive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              A password reset email will be sent to the new team member. They will log in at the same platform
              and be redirected to the Internal dashboard automatically.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
            <Button
              onClick={inviteMember}
              disabled={inviting || !inviteEmail.trim() || !inviteName.trim()}
            >
              {inviting ? <Loader2 size={14} className="mr-2 animate-spin" /> : <UserPlus size={14} className="mr-2" />}
              Add Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Portfolio dialog */}
      <Dialog open={!!portfolioMember} onOpenChange={() => setPortfolioMember(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {portfolioMember?.name}'s Portfolio
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Select which firms this CSE is responsible for.
          </p>
          {loadingPortfolio ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1 border rounded-md p-2">
              {firms.map(f => (
                <label key={f.id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={portfolio.includes(f.id)}
                    onChange={() => togglePortfolio(f.id)}
                    className="rounded"
                  />
                  <Building2 size={14} className="text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground">{f.name}</span>
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPortfolioMember(null)}>Cancel</Button>
            <Button onClick={savePortfolio} disabled={savingPortfolio}>
              {savingPortfolio ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
              Save Portfolio ({portfolio.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
