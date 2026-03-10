import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Users, Eye, Pencil, ShieldCheck, Plus, Search, Trash2, FolderOpen, MoreVertical, Download, X, Tags } from "lucide-react";
import * as XLSX from "xlsx";

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
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Groups data
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [clientGroupMap, setClientGroupMap] = useState<Record<string, GroupInfo[]>>({});

  // Manage groups dialog
  const [manageGroupsClient, setManageGroupsClient] = useState<Client | null>(null);
  const [manageGroupsSaving, setManageGroupsSaving] = useState(false);

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

  const toggleGroupForClient = async (clientId: string, groupId: string, isMember: boolean) => {
    setManageGroupsSaving(true);
    try {
      if (isMember) {
        const { error } = await supabase
          .from("client_group_memberships")
          .delete()
          .eq("client_id", clientId)
          .eq("group_id", groupId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("client_group_memberships")
          .insert({ client_id: clientId, group_id: groupId, added_by: user?.id || null });
        if (error) throw error;
      }
      await fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setManageGroupsSaving(false);
    }
  };

  const handleExportExcel = () => {
    const rows = filtered.map((c) => {
      const clientGroups = clientGroupMap[c.id] || [];
      return {
        Name: c.name || "",
        PAN: c.pan || "",
        "Entity Type": c.entity_type || "",
        CIN: c.cin || "",
        GSTIN: (c.gstin || []).join(", "),
        Groups: clientGroups.map((g) => g.name).join(", ") || "Ungrouped",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clients");
    XLSX.writeFile(wb, "clients-export.xlsx");
    toast({ title: "Exported to Excel" });
  };

  const filtered = clients.filter((c) => {
    const matchesSearch =
      !search ||
      (c.name || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.pan || "").toLowerCase().includes(search.toLowerCase());
    const matchesEntity =
      entityFilter === "all" || c.entity_type === entityFilter;
    let matchesGroup = true;
    if (groupFilter.includes("ungrouped")) {
      matchesGroup = !clientGroupMap[c.id] || clientGroupMap[c.id].length === 0;
    } else if (groupFilter.length > 0) {
      const cGroups = (clientGroupMap[c.id] || []).map((g) => g.id);
      matchesGroup = groupFilter.every((gId) => cGroups.includes(gId));
    }
    return matchesSearch && matchesEntity && matchesGroup;
  });

  const toggleGroupFilter = (id: string) => {
    setGroupFilter((prev) => {
      if (id === "ungrouped") {
        return prev.includes("ungrouped") ? prev.filter((x) => x !== "ungrouped") : ["ungrouped"];
      }
      const without = prev.filter((x) => x !== "ungrouped");
      return without.includes(id) ? without.filter((x) => x !== id) : [...without, id];
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Clients</h1>
          <p className="text-sm text-muted-foreground">Manage your client directory.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </Button>
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

        {/* Multi-select group filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full sm:w-[200px] justify-between">
              <span className="truncate">
                {groupFilter.length === 0 ? "All Groups" : `${groupFilter.length} group${groupFilter.length > 1 ? "s" : ""}`}
              </span>
              {groupFilter.length > 0 && (
                <X className="h-3 w-3 ml-1 shrink-0" onClick={(e) => { e.stopPropagation(); setGroupFilter([]); }} />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="end">
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent text-left"
              onClick={() => toggleGroupFilter("ungrouped")}
            >
              <Checkbox checked={groupFilter.includes("ungrouped")} />
              <span>Ungrouped</span>
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent text-left"
                onClick={() => toggleGroupFilter(g.id)}
              >
                <Checkbox checked={groupFilter.includes(g.id)} />
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color || "#6B7280" }} />
                {g.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
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
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {client.entity_type && (
                        <Badge variant="outline" className="text-[10px]">
                          {client.entity_type}
                        </Badge>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => navigate(`/clients/${client.id}`)}>
                            <Eye className="h-4 w-4 mr-2" /> View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/clients/edit/${client.id}`)}>
                            <Pencil className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setManageGroupsClient(client)}>
                            <Tags className="h-4 w-4 mr-2" /> Manage Groups
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/clients/${client.id}/audit/scrutiny`)}>
                            <ShieldCheck className="h-4 w-4 mr-2" /> Audit Scrutiny
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteClient(client)}>
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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

      {/* Manage Groups Dialog */}
      <Dialog open={!!manageGroupsClient} onOpenChange={(open) => { if (!open) setManageGroupsClient(null); }}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Manage Groups — {manageGroupsClient?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No groups created yet.</p>
            ) : (
              groups.map((g) => {
                const isMember = (clientGroupMap[manageGroupsClient?.id || ""] || []).some((cg) => cg.id === g.id);
                return (
                  <button
                    key={g.id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-md hover:bg-accent text-left"
                    disabled={manageGroupsSaving}
                    onClick={() => manageGroupsClient && toggleGroupForClient(manageGroupsClient.id, g.id, isMember)}
                  >
                    <Checkbox checked={isMember} />
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color || "#6B7280" }} />
                    <span>{g.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Clients;
