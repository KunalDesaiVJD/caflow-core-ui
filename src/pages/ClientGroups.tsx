import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, Pencil, Trash2, Users, Briefcase } from "lucide-react";

const PRESET_COLORS = [
  "#6B7280", "#EF4444", "#F59E0B", "#10B981",
  "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6",
];

interface GroupItem {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  firm_id: string;
  created_at: string | null;
  member_count?: number;
}

// Reusable group grid + CRUD component
function GroupManager({ tableName, membershipTable, title, subtitle, icon: Icon, userId, defaultFirmId }: {
  tableName: "client_groups" | "work_groups";
  membershipTable: "client_group_memberships" | "work_group_memberships";
  title: string;
  subtitle: string;
  icon: typeof Users;
  userId: string | undefined;
  defaultFirmId: string | null;
}) {
  const { toast } = useToast();
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<GroupItem | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<GroupItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [customColor, setCustomColor] = useState("");

  const fetchGroups = async () => {
    const { data: groupsData } = await supabase
      .from(tableName)
      .select("*")
      .order("name");

    const { data: memberships } = await supabase
      .from(membershipTable)
      .select("group_id");

    const countMap: Record<string, number> = {};
    for (const m of memberships || []) {
      countMap[m.group_id] = (countMap[m.group_id] || 0) + 1;
    }

    setGroups(
      (groupsData || []).map((g: any) => ({
        ...g,
        member_count: countMap[g.id] || 0,
      }))
    );
    setLoading(false);
  };

  useEffect(() => { fetchGroups(); }, []);

  const openCreate = () => {
    setEditGroup(null);
    setName("");
    setDescription("");
    setColor(PRESET_COLORS[0]);
    setCustomColor("");
    setModalOpen(true);
  };

  const openEdit = (g: GroupItem) => {
    setEditGroup(g);
    setName(g.name);
    setDescription(g.description || "");
    const c = g.color || PRESET_COLORS[0];
    if (PRESET_COLORS.includes(c)) { setColor(c); setCustomColor(""); }
    else { setColor(""); setCustomColor(c); }
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    const finalColor = customColor || color || PRESET_COLORS[0];
    try {
      if (editGroup) {
        const { error } = await supabase
          .from(tableName)
          .update({ name: name.trim(), description: description.trim() || null, color: finalColor } as any)
          .eq("id", editGroup.id);
        if (error) throw error;
        toast({ title: "Group updated" });
      } else {
        const { error } = await supabase
          .from(tableName)
          .insert({
            name: name.trim(),
            description: description.trim() || null,
            color: finalColor,
            // Client groups are created global (NULL); work groups belong to the user's firm.
            // RLS firm_scope_insert allows both (see 20261029151000_client_groups_global).
            firm_id: defaultFirmId,
            created_by: userId || null,
          } as any);
        if (error) throw error;
        toast({ title: "Group created" });
      }
      setModalOpen(false);
      fetchGroups();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteGroup) return;
    setSaving(true);
    try {
      const { error } = await supabase.from(tableName).delete().eq("id", deleteGroup.id);
      if (error) throw error;
      toast({ title: "Group deleted" });
      setDeleteGroup(null);
      fetchGroups();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button onClick={openCreate} size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> New Group
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Icon className="h-10 w-10 mb-3 opacity-40" />
            <p>No groups yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <Card key={g.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: g.color || PRESET_COLORS[0] }} />
                    <h3 className="text-lg font-semibold text-foreground">{g.name}</h3>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{g.member_count} clients</Badge>
                </div>
                {g.description && <p className="text-sm text-muted-foreground line-clamp-2">{g.description}</p>}
                <div className="flex items-center gap-1 pt-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(g)} title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteGroup(g)} title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editGroup ? "Edit Group" : "New Group"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. High-value Clients" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" rows={2} />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex items-center gap-2 mt-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${color === c && !customColor ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    onClick={() => { setColor(c); setCustomColor(""); }}
                  />
                ))}
                <Input
                  className="w-24 h-7 text-xs"
                  placeholder="#hex"
                  value={customColor}
                  onChange={(e) => { setCustomColor(e.target.value); setColor(""); }}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteGroup} onOpenChange={(open) => { if (!open) setDeleteGroup(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteGroup?.name}</strong>?
              {(deleteGroup?.member_count || 0) > 0 && (
                <> {deleteGroup?.member_count} client(s) will be unlinked. Their data won't be deleted.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={saving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {saving ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const ClientGroups = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-xs gap-1" onClick={() => navigate("/clients")}>
          <ArrowLeft className="h-3 w-3" /> Back to Clients
        </Button>
        <h1 className="text-2xl font-display font-bold text-foreground">Groups</h1>
        <p className="text-sm text-muted-foreground">Organize clients and work into groups.</p>
      </div>

      <Tabs defaultValue="client_groups">
        <TabsList>
          <TabsTrigger value="client_groups" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Client Groups</TabsTrigger>
          <TabsTrigger value="work_groups" className="gap-1.5"><Briefcase className="h-3.5 w-3.5" /> Work Groups</TabsTrigger>
        </TabsList>
        <TabsContent value="client_groups" className="mt-4">
          <GroupManager
            tableName="client_groups"
            membershipTable="client_group_memberships"
            title="Client Groups"
            subtitle="Organize clients into groups for easy filtering. A client group applies to every firm."
            icon={Users}
            userId={user?.id}
            // Client groups are global: one group covers the client's balances with every firm.
            defaultFirmId={null}
          />
        </TabsContent>
        <TabsContent value="work_groups" className="mt-4">
          <GroupManager
            tableName="work_groups"
            membershipTable="work_group_memberships"
            title="Work Groups"
            subtitle="Reusable work groups across modules."
            icon={Briefcase}
            userId={user?.id}
            defaultFirmId={user?.firm_id || null}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ClientGroups;
