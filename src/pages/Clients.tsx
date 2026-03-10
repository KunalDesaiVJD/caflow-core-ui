import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Eye, Pencil, ShieldCheck, Plus, Search, Trash2, FolderOpen } from "lucide-react";

interface Client {
  id: string;
  name: string | null;
  pan: string | null;
  entity_type: string | null;
  cin: string | null;
  gstin: string[] | null;
  created_at: string | null;
  firm_id: string | null;
}

interface GroupInfo {
  id: string;
  name: string;
  color: string | null;
}

const ENTITY_TYPES = [
  "Proprietorship", "Partnership", "LLP", "Private Ltd", "Public Ltd",
  "HUF", "Trust", "AOP", "BOI",
];

const Clients = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Groups data
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [clientGroupMap, setClientGroupMap] = useState<Record<string, GroupInfo[]>>({});

  const fetchData = async () => {
    const [clientsRes, groupsRes, membershipsRes] = await Promise.all([
      supabase.from("clients").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("client_groups").select("id, name, color").order("name"),
      supabase.from("client_group_memberships").select("client_id, group_id, client_groups(id, name, color)"),
    ]);

    setClients((clientsRes.data as Client[]) || []);
    setGroups((groupsRes.data as GroupInfo[]) || []);

    const map: Record<string, GroupInfo[]> = {};
    for (const m of (membershipsRes.data || []) as any[]) {
      if (!map[m.client_id]) map[m.client_id] = [];
      if (m.client_groups) map[m.client_id].push(m.client_groups as GroupInfo);
    }
    setClientGroupMap(map);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleDeleteClient = async () => {
    if (!deleteClient) return;
    setDeleteLoading(true);
    try {
      const { error, count } = await supabase.from("clients").delete({ count: "exact" }).eq("id", deleteClient.id);
      if (error) throw error;
      if (count === 0) {
        toast({ title: "Delete failed", description: "You may not have permission to delete this client.", variant: "destructive" });
      } else {
        toast({ title: "Client deleted" });
      }
      setDeleteClient(null);
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  };

  const filtered = clients.filter((c) => {
    const matchesSearch =
      !search ||
      (c.name || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.pan || "").toLowerCase().includes(search.toLowerCase());
    const matchesEntity =
      entityFilter === "all" || c.entity_type === entityFilter;
    let matchesGroup = true;
    if (groupFilter === "ungrouped") {
      matchesGroup = !clientGroupMap[c.id] || clientGroupMap[c.id].length === 0;
    } else if (groupFilter !== "all") {
      matchesGroup = (clientGroupMap[c.id] || []).some((g) => g.id === groupFilter);
    }
    return matchesSearch && matchesEntity && matchesGroup;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Clients</h1>
          <p className="text-sm text-muted-foreground">Manage your client directory.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/clients/groups")} className="gap-2">
            <FolderOpen className="h-4 w-4" /> Manage Groups
          </Button>
          <Button onClick={() => navigate("/clients/new")} className="gap-2">
            <Plus className="h-4 w-4" /> Add Client
          </Button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or PAN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Entity Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entity Types</SelectItem>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            <SelectItem value="ungrouped">Ungrouped</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Card Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users className="h-10 w-10 mb-3 opacity-40" />
            <p>No clients found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((client) => {
            const clientGroups = clientGroupMap[client.id] || [];
            return (
              <Card
                key={client.id}
                className="group cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => navigate(`/clients/${client.id}`)}
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <h3 className="text-lg font-semibold text-foreground leading-tight line-clamp-2">
                      {client.name || "Unnamed Client"}
                    </h3>
                    {client.entity_type && (
                      <Badge variant="outline" className="text-[10px] shrink-0 ml-2">
                        {client.entity_type}
                      </Badge>
                    )}
                  </div>
                  {client.pan && (
                    <p className="text-xs font-mono text-muted-foreground">PAN: {client.pan}</p>
                  )}
                  {/* Group badges */}
                  <div className="flex flex-wrap gap-1">
                    {clientGroups.length > 0 ? (
                      clientGroups.map((g) => (
                        <Badge
                          key={g.id}
                          variant="outline"
                          className="text-[10px] gap-1"
                          style={{ borderColor: g.color || "#6B7280", color: g.color || "#6B7280" }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.color || "#6B7280" }} />
                          {g.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Ungrouped</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); navigate(`/clients/${client.id}`); }} title="View">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); navigate(`/clients/edit/${client.id}`); }} title="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); navigate(`/clients/${client.id}/audit/scrutiny`); }} title="Audit">
                      <ShieldCheck className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteClient(client); }} title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Client Confirmation */}
      <AlertDialog open={!!deleteClient} onOpenChange={open => { if (!open) setDeleteClient(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteClient?.name}</strong>? This action cannot be undone. All related data (trial balances, profiles, etc.) may also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteClient} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteLoading ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Clients;
