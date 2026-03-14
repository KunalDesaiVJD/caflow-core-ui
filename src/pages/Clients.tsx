import { useState, useEffect, useMemo, useRef } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Eye, Pencil, ShieldCheck, Plus, Search, Trash2, FolderOpen, MoreVertical, Download, Upload, X, Tags, LayoutGrid, List, FileText, ChevronLeft, ChevronRight } from "lucide-react";
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

const ENTITY_TYPES = ["Proprietorship", "Partnership", "LLP", "Private Ltd", "Public Ltd", "HUF", "Trust", "AOP", "BOI"];
const PAGE_SIZE = 20;

type ViewMode = "it" | "table" | "card";

const VIEW_KEY = "caflow_client_view";

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
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || "it");
  const [currentPage, setCurrentPage] = useState(1);

  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [clientGroupMap, setClientGroupMap] = useState<Record<string, GroupInfo[]>>({});

  // Service count data
  const [serviceCountMap, setServiceCountMap] = useState<Record<string, number>>({});

  const [manageGroupsClient, setManageGroupsClient] = useState<Client | null>(null);
  const [manageGroupsSaving, setManageGroupsSaving] = useState(false);

  // Import state
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const fetchData = async () => {
    const [clientsRes, groupsRes, membershipsRes, servicesRes] = await Promise.all([
      supabase.from("clients").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("client_groups").select("id, name, color").order("name"),
      supabase.from("client_group_memberships").select("client_id, group_id, client_groups(id, name, color)"),
      supabase.from("client_services").select("client_id, is_active"),
    ]);

    setClients((clientsRes.data as Client[]) || []);
    setGroups((groupsRes.data as GroupInfo[]) || []);

    const map: Record<string, GroupInfo[]> = {};
    for (const m of (membershipsRes.data || []) as any[]) {
      if (!map[m.client_id]) map[m.client_id] = [];
      if (m.client_groups) map[m.client_id].push(m.client_groups as GroupInfo);
    }
    setClientGroupMap(map);

    // Build service count map
    const svcMap: Record<string, number> = {};
    for (const s of (servicesRes.data || []) as any[]) {
      if (s.is_active) svcMap[s.client_id] = (svcMap[s.client_id] || 0) + 1;
    }
    setServiceCountMap(svcMap);

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => { localStorage.setItem(VIEW_KEY, viewMode); }, [viewMode]);

  const handleDeleteClient = async () => {
    if (!deleteClient) return;
    setDeleteLoading(true);
    try {
      const { error, count } = await supabase.from("clients").delete({ count: "exact" }).eq("id", deleteClient.id);
      if (error) throw error;
      if (count === 0) {
        toast({ title: "Delete failed", description: "You may not have permission.", variant: "destructive" });
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
        await supabase.from("client_group_memberships").delete().eq("client_id", clientId).eq("group_id", groupId);
      } else {
        await supabase.from("client_group_memberships").insert({ client_id: clientId, group_id: groupId, added_by: user?.id || null });
      }
      await fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setManageGroupsSaving(false);
    }
  };

  const handleExportExcel = () => {
    const rows = filtered.map((c) => ({
      Name: c.name || "",
      PAN: c.pan || "",
      "Entity Type": c.entity_type || "",
      CIN: c.cin || "",
      GSTIN: (c.gstin || []).join(", "),
      Groups: (clientGroupMap[c.id] || []).map(g => g.name).join(", ") || "Ungrouped",
      "Active Services": serviceCountMap[c.id] || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clients");
    XLSX.writeFile(wb, "clients-export.xlsx");
    toast({ title: "Exported to Excel" });
  };

  // ── Bulk Import ──
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (rows.length === 0) { toast({ title: "No data found", variant: "destructive" }); return; }

      // Get existing PANs for duplicate check
      const { data: existingClients } = await supabase.from("clients").select("pan").not("pan", "is", null);
      const existingPans = new Set((existingClients || []).map((c: any) => (c.pan || "").toUpperCase()).filter(Boolean));

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const row of rows) {
        const name = (row["Client Name"] || row["Name"] || row["name"] || "").trim();
        if (!name) { failed++; errors.push("Empty name"); continue; }

        const pan = (row["PAN"] || row["pan"] || "").toUpperCase().trim();
        if (pan && existingPans.has(pan)) {
          failed++;
          errors.push(`Duplicate PAN: ${pan}`);
          continue;
        }

        const gstinRaw = (row["GSTIN"] || row["gstin"] || "").trim();
        const gstin = gstinRaw ? [gstinRaw] : null;

        const { error } = await supabase.from("clients").insert({
          name,
          pan: pan || null,
          entity_type: (row["Entity Type"] || row["entity_type"] || "").trim() || null,
          gstin,
          firm_id: user?.firm_id || null,
          user_id: user?.id || null,
        } as any);

        if (error) {
          failed++;
          errors.push(`${name}: ${error.message}`);
        } else {
          success++;
          if (pan) existingPans.add(pan);
        }
      }

      toast({
        title: "Import Complete",
        description: `Total: ${rows.length} | Success: ${success} | Failed: ${failed}`,
      });
      fetchData();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const filtered = clients.filter((c) => {
    const matchesSearch = !search || (c.name || "").toLowerCase().includes(search.toLowerCase()) || (c.pan || "").toLowerCase().includes(search.toLowerCase());
    const matchesEntity = entityFilter === "all" || c.entity_type === entityFilter;
    let matchesGroup = true;
    if (groupFilter.includes("ungrouped")) {
      matchesGroup = !clientGroupMap[c.id] || clientGroupMap[c.id].length === 0;
    } else if (groupFilter.length > 0) {
      const cGroups = (clientGroupMap[c.id] || []).map(g => g.id);
      matchesGroup = groupFilter.every(gId => cGroups.includes(gId));
    }
    return matchesSearch && matchesEntity && matchesGroup;
  });

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [search, entityFilter, groupFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginatedItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const toggleGroupFilter = (id: string) => {
    setGroupFilter(prev => {
      if (id === "ungrouped") return prev.includes("ungrouped") ? prev.filter(x => x !== "ungrouped") : ["ungrouped"];
      const without = prev.filter(x => x !== "ungrouped");
      return without.includes(id) ? without.filter(x => x !== id) : [...without, id];
    });
  };

  const PaginationControls = () => {
    if (filtered.length <= PAGE_SIZE) return null;
    return (
      <div className="flex items-center justify-between pt-4">
        <p className="text-xs text-muted-foreground">
          Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            let page: number;
            if (totalPages <= 5) page = i + 1;
            else if (currentPage <= 3) page = i + 1;
            else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
            else page = currentPage - 2 + i;
            return (
              <Button key={page} variant={page === currentPage ? "default" : "outline"} size="icon" className="h-8 w-8 text-xs" onClick={() => setCurrentPage(page)}>
                {page}
              </Button>
            );
          })}
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
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
          {/* View toggle */}
          <div className="flex items-center border border-border rounded-md">
            <button onClick={() => setViewMode("it")} className={`px-2.5 py-1.5 text-xs font-medium rounded-l-md transition-colors ${viewMode === "it" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              <FileText className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setViewMode("table")} className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              <List className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setViewMode("card")} className={`px-2.5 py-1.5 text-xs font-medium rounded-r-md transition-colors ${viewMode === "card" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => importRef.current?.click()} disabled={importing} className="gap-1.5"><Upload className="h-4 w-4" /> Import</Button>
          <input ref={importRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImport} />
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-1.5"><Download className="h-4 w-4" /> Export</Button>
          <Button variant="outline" onClick={() => navigate("/clients/groups")} className="gap-2"><FolderOpen className="h-4 w-4" /> Groups</Button>
          <Button onClick={() => navigate("/clients/new")} className="gap-2"><Plus className="h-4 w-4" /> Add Client</Button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name or PAN..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Entity Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entity Types</SelectItem>
            {ENTITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full sm:w-[200px] justify-between">
              <span className="truncate">{groupFilter.length === 0 ? "All Groups" : `${groupFilter.length} group${groupFilter.length > 1 ? "s" : ""}`}</span>
              {groupFilter.length > 0 && <X className="h-3 w-3 ml-1 shrink-0" onClick={e => { e.stopPropagation(); setGroupFilter([]); }} />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="end">
            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent text-left" onClick={() => toggleGroupFilter("ungrouped")}>
              <Checkbox checked={groupFilter.includes("ungrouped")} /> <span>Ungrouped</span>
            </button>
            {groups.map(g => (
              <button key={g.id} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent text-left" onClick={() => toggleGroupFilter(g.id)}>
                <Checkbox checked={groupFilter.includes(g.id)} />
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color || "#6B7280" }} />
                {g.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground"><Users className="h-10 w-10 mb-3 opacity-40" /><p>No clients found</p></CardContent></Card>
      ) : viewMode === "it" ? (
        /* IT VIEW */
        <>
          <div className="rounded-md border border-border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Client Name</TableHead>
                  <TableHead className="text-xs">PAN</TableHead>
                  <TableHead className="text-xs">Constitution</TableHead>
                  <TableHead className="text-xs">Active Services</TableHead>
                  <TableHead className="text-xs w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map(client => {
                  const svcCount = serviceCountMap[client.id] || 0;
                  return (
                    <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/clients/${client.id}`)}>
                      <TableCell className="font-medium text-sm">{client.name || "Unnamed"}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{client.pan || "—"}</TableCell>
                      <TableCell>{client.entity_type && <Badge variant="outline" className="text-[10px]">{client.entity_type}</Badge>}</TableCell>
                      <TableCell>{svcCount > 0 ? <Badge variant="secondary" className="text-[10px]">{svcCount} active</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => navigate(`/clients/${client.id}`)}><Eye className="h-4 w-4 mr-2" /> View</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/clients/edit/${client.id}`)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setManageGroupsClient(client)}><Tags className="h-4 w-4 mr-2" /> Groups</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteClient(client)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationControls />
        </>
      ) : viewMode === "table" ? (
        /* TABLE VIEW */
        <>
          <div className="rounded-md border border-border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">PAN</TableHead>
                  <TableHead className="text-xs">Entity Type</TableHead>
                  <TableHead className="text-xs">CIN</TableHead>
                  <TableHead className="text-xs">GSTIN</TableHead>
                  <TableHead className="text-xs">Groups</TableHead>
                  <TableHead className="text-xs w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map(client => {
                  const clientGroups = clientGroupMap[client.id] || [];
                  return (
                    <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/clients/${client.id}`)}>
                      <TableCell className="font-medium text-sm">{client.name || "Unnamed"}</TableCell>
                      <TableCell className="text-xs font-mono">{client.pan || "—"}</TableCell>
                      <TableCell className="text-xs">{client.entity_type || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{client.cin || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{(client.gstin || []).join(", ") || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {clientGroups.length > 0 ? clientGroups.map(g => (
                            <Badge key={g.id} variant="outline" className="text-[10px]" style={{ borderColor: g.color || "#6B7280", color: g.color || "#6B7280" }}>{g.name}</Badge>
                          )) : <span className="text-[10px] text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => navigate(`/clients/${client.id}`)}><Eye className="h-4 w-4 mr-2" /> View</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/clients/edit/${client.id}`)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteClient(client)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationControls />
        </>
      ) : (
        /* CARD VIEW */
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedItems.map(client => {
              const clientGroups = clientGroupMap[client.id] || [];
              const svcCount = serviceCountMap[client.id] || 0;
              const initial = (client.name || "?")[0].toUpperCase();
              return (
                <Card key={client.id} className="group cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate(`/clients/${client.id}`)}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">{initial}</div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground truncate">{client.name || "Unnamed"}</h3>
                        {client.pan && <p className="text-[11px] font-mono text-muted-foreground">{client.pan}</p>}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => navigate(`/clients/${client.id}`)}><Eye className="h-4 w-4 mr-2" /> View</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/clients/edit/${client.id}`)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteClient(client)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {client.entity_type && <Badge variant="outline" className="text-[10px]">{client.entity_type}</Badge>}
                      {svcCount > 0 && <Badge variant="secondary" className="text-[10px]">{svcCount} services</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {clientGroups.length > 0 ? clientGroups.map(g => (
                        <Badge key={g.id} variant="outline" className="text-[10px]" style={{ borderColor: g.color || "#6B7280", color: g.color || "#6B7280" }}>
                          <span className="w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: g.color || "#6B7280" }} />{g.name}
                        </Badge>
                      )) : <span className="text-[10px] text-muted-foreground">Ungrouped</span>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <PaginationControls />
        </>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteClient} onOpenChange={open => { if (!open) setDeleteClient(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete <strong>{deleteClient?.name}</strong>? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteClient} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleteLoading ? "Deleting…" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manage Groups Dialog */}
      <Dialog open={!!manageGroupsClient} onOpenChange={open => { if (!open) setManageGroupsClient(null); }}>
        <DialogContent onClick={e => e.stopPropagation()}>
          <DialogHeader><DialogTitle>Manage Groups — {manageGroupsClient?.name}</DialogTitle></DialogHeader>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No groups created yet.</p>
            ) : groups.map(g => {
              const isMember = (clientGroupMap[manageGroupsClient?.id || ""] || []).some(cg => cg.id === g.id);
              return (
                <button key={g.id} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-md hover:bg-accent text-left" disabled={manageGroupsSaving} onClick={() => manageGroupsClient && toggleGroupForClient(manageGroupsClient.id, g.id, isMember)}>
                  <Checkbox checked={isMember} />
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color || "#6B7280" }} />
                  <span>{g.name}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Clients;