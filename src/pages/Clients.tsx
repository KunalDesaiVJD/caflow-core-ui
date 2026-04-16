import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
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
import { Users, Eye, Pencil, Plus, Search, Trash2, FolderOpen, MoreVertical, Download, X, Tags, LayoutGrid, List, FileText, ChevronLeft, ChevronRight, RefreshCw, BadgeCheck } from "lucide-react";
import * as XLSX from "xlsx";
import { CustomerSyncDialog } from "@/components/client-sync/CustomerSyncDialog";
import { ClassificationByFYView } from "@/components/clients/ClassificationByFYView";

interface Client {
  id: string;
  name: string | null;
  pan: string | null;
  entity_type: string | null;
  cin: string | null;
  gstin: string[] | null;
  created_at: string | null;
  firm_id: string | null;
  /** 'manual' | 'import' — requires DB migration: ALTER TABLE clients ADD COLUMN source text DEFAULT 'manual' */
  source?: string | null;
  /** Whether this record is a draft (incomplete wizard) */
  is_draft?: boolean | null;
  /** Populated only when All Firms selected — joined from firms table */
  firm_name?: string | null;
}

interface GroupInfo {
  id: string;
  name: string;
  color: string | null;
}

const ENTITY_TYPES = ["Proprietorship", "Partnership", "LLP", "Private Ltd", "Public Ltd", "HUF", "Trust", "AOP", "BOI"];
const PAGE_SIZE = 20;

type ViewMode = "it" | "table" | "card" | "classify";

const VIEW_KEY = "caflow_client_view";

const Clients = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canCreate = can("Client Management", "can_create");
  const canEdit = can("Client Management", "can_edit");
  const canDelete = can("Client Management", "can_delete");
  const isSuperadmin = user?.role === "superadmin";
  const [firmsList, setFirmsList] = useState<{ id: string; name: string }[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string | null>(null);
  // "__all__" sentinel = superadmin viewing all firms at once
  const showAllFirms = isSuperadmin && selectedFirmId === "__all__";
  const effectiveFirmId = showAllFirms ? null : (isSuperadmin ? selectedFirmId : (user?.firm_id || null));
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  // GAP-7: API vs Manual bifurcation
  const [sourceTab, setSourceTab] = useState<"all" | "manual" | "api">("all");
  // Sub-tab within "Clients via API": draft = is_draft true, final = is_draft false
  const [apiSubTab, setApiSubTab] = useState<"draft" | "final">("final");
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

  // GAP-6: draft management
  const [drafts, setDrafts] = useState<Client[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [deleteDraftCandidate, setDeleteDraftCandidate] = useState<Client | null>(null);
  const [deleteDraftLoading, setDeleteDraftLoading] = useState(false);

  const fetchData = async () => {
    // GAP-1: scope to firm unless superadmin selected "All Firms"
    if (!effectiveFirmId && !showAllFirms) {
      setClients([]);
      setLoading(false);
      return;
    }

    // Only fetch the columns the list view actually renders — avoids transferring
    // unused large fields (audit_questions, address blobs, etc.) for 1000+ rows.
    const clientCols = "id, name, pan, entity_type, cin, gstin, created_at, firm_id, source, is_draft";
    const clientSelect = showAllFirms ? `${clientCols}, firms(name)` : clientCols;

    let mainQuery = supabase.from("clients").select(clientSelect, { count: "exact" })
      .eq("is_draft", false).is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (!showAllFirms && effectiveFirmId) mainQuery = mainQuery.eq("firm_id", effectiveFirmId);

    let draftQuery = supabase.from("clients").select(clientSelect)
      .eq("is_draft", true).eq("source", "api_import").is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(2000);
    if (!showAllFirms && effectiveFirmId) draftQuery = draftQuery.eq("firm_id", effectiveFirmId);

    // Phase 1: clients + groups in parallel
    const [clientsRes, apiDraftRes, groupsRes] = await Promise.all([
      mainQuery,
      draftQuery,
      supabase.from("client_groups").select("id, name, color").order("name"),
    ]);

    // Normalise firms(name) join → flat firm_name field
    const normalise = (rows: any[]): Client[] =>
      (rows || []).map(r => ({ ...r, firm_name: r.firms?.name ?? null }));

    const allFetchedClients = [
      ...normalise((clientsRes.data as any[]) || []),
      ...normalise((apiDraftRes.data as any[]) || []),
    ];
    setClients(allFetchedClients);
    setGroups((groupsRes.data as GroupInfo[]) || []);

    // Phase 2: memberships + services scoped to the loaded client IDs only.
    // Without this filter both tables return rows for ALL firms which is very slow.
    const clientIds = allFetchedClients.map(c => c.id);
    if (clientIds.length > 0) {
      const [membershipsRes, servicesRes] = await Promise.all([
        supabase.from("client_group_memberships")
          .select("client_id, group_id, client_groups(id, name, color)")
          .in("client_id", clientIds),
        supabase.from("client_services")
          .select("client_id, is_active")
          .in("client_id", clientIds),
      ]);

      const map: Record<string, GroupInfo[]> = {};
      for (const m of (membershipsRes.data || []) as any[]) {
        if (!map[m.client_id]) map[m.client_id] = [];
        if (m.client_groups) map[m.client_id].push(m.client_groups as GroupInfo);
      }
      setClientGroupMap(map);

      const svcMap: Record<string, number> = {};
      for (const s of (servicesRes.data || []) as any[]) {
        if (s.is_active) svcMap[s.client_id] = (svcMap[s.client_id] || 0) + 1;
      }
      setServiceCountMap(svcMap);
    }

    setLoading(false);
  };

  // GAP-2: re-fetch whenever effectiveFirmId or showAllFirms changes (superadmin firm selector, auth load)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (effectiveFirmId || showAllFirms) { fetchData(); fetchDrafts(); } }, [effectiveFirmId, showAllFirms]);

  useEffect(() => { localStorage.setItem(VIEW_KEY, viewMode); }, [viewMode]);

  // Load firms list for superadmin
  useEffect(() => {
    if (!isSuperadmin) return;
    supabase.from("firms").select("id, name").order("name").then(({ data }) => {
      setFirmsList(data || []);
      if (data && data.length > 0 && !selectedFirmId) {
        // Default to the user's own firm_id, otherwise first in list
        const def = data.find(f => f.id === user?.firm_id) || data[0];
        setSelectedFirmId(def.id);
      }
    });
  }, [isSuperadmin]);

  // GAP-6: load draft clients (is_draft=true, source='manual') for the draft management banner
  // api_import drafts are shown in the "Clients via API" tab instead of the banner
  const fetchDrafts = async () => {
    if (!effectiveFirmId && !showAllFirms) { setDrafts([]); return; }
    setDraftLoading(true);
    try {
      let q = supabase
        .from("clients")
        .select("id, name, pan, entity_type, created_at, source, firm_id")
        .eq("is_draft", true)
        .neq("source", "api_import")   // api_import drafts go in main list, not banner
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (!showAllFirms && effectiveFirmId) q = q.eq("firm_id", effectiveFirmId);
      const { data } = await q;
      setDrafts((data as Client[]) || []);
    } catch {}
    setDraftLoading(false);
  };

  // GAP-6: hard-delete a draft client + companion records (called after confirmation)
  const handleDeleteDraft = async () => {
    if (!deleteDraftCandidate) return;
    setDeleteDraftLoading(true);
    try {
      // Cascade-delete companion records first to avoid FK constraint issues
      await Promise.all([
        supabase.from("client_group_memberships").delete().eq("client_id", deleteDraftCandidate.id),
        supabase.from("client_profiles").delete().eq("client_id", deleteDraftCandidate.id),
      ]);
      const { error } = await supabase.from("clients").delete().eq("id", deleteDraftCandidate.id);
      if (error) throw error;
      setDrafts(prev => prev.filter(d => d.id !== deleteDraftCandidate.id));
      setDeleteDraftCandidate(null);
      toast({ title: "Draft deleted", description: "The incomplete client record has been removed." });
    } catch (e: any) {
      toast({ title: "Error deleting draft", description: e.message, variant: "destructive" });
    } finally {
      setDeleteDraftLoading(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!deleteClient) return;
    setDeleteLoading(true);
    try {
      // Check for paid invoices
      const { data: paidInvoices } = await supabase
        .from("invoices")
        .select("id")
        .eq("client_id", deleteClient.id)
        .eq("status", "paid")
        .limit(1);
      if (paidInvoices && paidInvoices.length > 0) {
        toast({
          title: "Cannot archive this client",
          description: "They have paid invoices on record. Archive the client instead.",
          variant: "destructive",
        });
        setDeleteClient(null);
        setDeleteLoading(false);
        return;
      }
      // Soft delete
      const { error } = await supabase
        .from("clients")
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq("id", deleteClient.id);
      if (error) throw error;
      toast({ title: "Client archived successfully" });
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
      "Customer ID": (c as any).customer_id || "",
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
    const filename =
      sourceTab === "api" ? "clients-api.xlsx"
      : sourceTab === "manual" ? "clients-manual.xlsx"
      : "clients-export.xlsx";
    XLSX.writeFile(wb, filename);
    toast({ title: `Exported ${rows.length} client${rows.length !== 1 ? "s" : ""} to Excel` });
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
    // Source tab bifurcation — NULL/undefined source treated as 'manual' (legacy clients)
    const matchesSource =
      sourceTab === "all" ||
      (sourceTab === "manual" && (c.source === "manual" || !c.source)) ||
      (sourceTab === "api" && c.source === "api_import");
    // API sub-tab: draft vs final (only applied when sourceTab === "api")
    const matchesApiSub =
      sourceTab !== "api" ||
      (apiSubTab === "draft" && c.is_draft === true) ||
      (apiSubTab === "final" && !c.is_draft);
    return matchesSearch && matchesEntity && matchesGroup && matchesSource && matchesApiSub;
  });

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [search, entityFilter, groupFilter, sourceTab, apiSubTab]);

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
      {/* Superadmin firm selector — shown ONLY for superadmin, above everything */}
      {isSuperadmin && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5">
          <span className="text-xs font-medium text-muted-foreground shrink-0">Filter by Firm:</span>
          <Select
            value={selectedFirmId || ""}
            onValueChange={(v) => { setSelectedFirmId(v); setCurrentPage(1); }}
          >
            <SelectTrigger className="h-8 text-sm w-auto min-w-[220px]">
              <SelectValue placeholder="Select a firm…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">🌐 All Firms</SelectItem>
              {firmsList.map(f => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showAllFirms && (
            <span className="text-xs text-primary font-medium">Showing clients from all firms</span>
          )}
          {firmsList.length === 0 && !showAllFirms && (
            <span className="text-xs text-muted-foreground">Loading firms…</span>
          )}
        </div>
      )}

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
            <button onClick={() => setViewMode("card")} className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === "card" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("classify")}
              title="Classification by FY"
              className={`px-2.5 py-1.5 text-xs font-medium rounded-r-md transition-colors ${viewMode === "classify" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              <BadgeCheck className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-1.5"><Download className="h-4 w-4" /> Export</Button>
          {canCreate && (
            <Button variant="outline" size="sm" onClick={() => setShowSyncDialog(true)} className="gap-1.5">
              <RefreshCw className="h-4 w-4" /> Sync from API
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate("/clients/groups")} className="gap-2"><FolderOpen className="h-4 w-4" /> Groups</Button>
          {canCreate && <Button onClick={() => navigate("/clients/new")} className="gap-2"><Plus className="h-4 w-4" /> Add Client</Button>}
        </div>
      </div>

      {/* Draft Clients Banner — hidden when zero drafts (must stay above tabs) */}
      {drafts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4">
          {/* Banner heading */}
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-white text-[10px] font-bold shrink-0">
              {drafts.length}
            </span>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {drafts.length} Draft Client{drafts.length !== 1 ? "s" : ""} — Setup Incomplete
            </p>
          </div>

          {/* Draft rows: Name | PAN | Created date | Actions */}
          <div className="space-y-2">
            {drafts.map(d => {
              const createdLabel = d.created_at
                ? new Date(d.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                : "—";
              return (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-md bg-white dark:bg-background border border-amber-200 dark:border-amber-800/60 px-3 py-2.5"
                >
                  {/* Name */}
                  <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0">
                    {d.name || <span className="italic text-muted-foreground">Unnamed Draft</span>}
                  </span>

                  {/* PAN */}
                  <span className="hidden sm:block text-xs font-mono text-muted-foreground w-24 shrink-0 truncate">
                    {d.pan || "—"}
                  </span>

                  {/* Created date */}
                  <span className="hidden md:block text-xs text-muted-foreground w-28 shrink-0">
                    {createdLabel}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-amber-400 text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300"
                      onClick={() => navigate(`/clients/edit/${d.id}`)}
                    >
                      Continue Setup
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteDraftCandidate(d)}
                    >
                      Delete Draft
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source Tabs — ABOVE search/filter per spec */}
      {(() => {
        const allCount = clients.length;
        const apiCount = clients.filter(c => c.source === "api_import").length;
        const manualCount = clients.filter(c => c.source === "manual" || !c.source).length;
        const tabs = [
          { key: "all" as const,    label: "All Clients",             count: allCount },
          { key: "api" as const,    label: "Clients via API",         count: apiCount },
          { key: "manual" as const, label: "Clients added Manually",  count: manualCount },
        ];
        return (
          <div className="flex items-center border-b border-border overflow-x-auto">
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => {
                  setSourceTab(key);
                  // Reset search/filter state on tab switch (spec: "reset is simpler")
                  setSearch("");
                  setEntityFilter("all");
                  setGroupFilter([]);
                  setCurrentPage(1);
                }}
                className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  sourceTab === key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  sourceTab === key
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {count}
                </span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* API sub-tabs: Draft vs Final — only shown when "Clients via API" is active */}
      {sourceTab === "api" && (() => {
        const apiClients = clients.filter(c => c.source === "api_import");
        const draftCount = apiClients.filter(c => c.is_draft === true).length;
        const finalCount = apiClients.filter(c => !c.is_draft).length;
        return (
          <div className="flex items-center gap-1 px-1 pt-1">
            {([
              { key: "final" as const, label: "Final", count: finalCount },
              { key: "draft" as const, label: "Drafts", count: draftCount },
            ]).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => { setApiSubTab(key); setCurrentPage(1); }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  apiSubTab === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {label}
                <span className={`ml-1.5 ${apiSubTab === key ? "opacity-80" : "opacity-60"}`}>
                  {count}
                </span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* Search & Filter — BELOW tabs per spec */}
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
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users className="h-10 w-10 mb-3 opacity-40" />
            <p>
              {sourceTab === "api"
                ? "No clients imported via API"
                : sourceTab === "manual"
                ? "No manually added clients found"
                : "No clients found"}
            </p>
          </CardContent>
        </Card>
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
                  {showAllFirms && <TableHead className="text-xs">Firm</TableHead>}
                  <TableHead className="text-xs">Active Services</TableHead>
                  <TableHead className="text-xs w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map(client => {
                  const svcCount = serviceCountMap[client.id] || 0;
                  return (
                    <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/clients/${client.id}`)}>
                      <TableCell className="font-medium text-sm">
                        <span className="flex items-center gap-1.5">
                          {client.name || "Unnamed"}
                          {client.source === "api_import" && !client.is_draft && <Badge variant="secondary" className="text-[9px] px-1 py-0">Imported</Badge>}
                          {client.source === "api_import" && client.is_draft && <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500 text-amber-600">Draft</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{client.pan || "—"}</TableCell>
                      <TableCell>{client.entity_type && <Badge variant="outline" className="text-[10px]">{client.entity_type}</Badge>}</TableCell>
                      {showAllFirms && <TableCell className="text-xs text-muted-foreground">{client.firm_name || "—"}</TableCell>}
                      <TableCell>{svcCount > 0 ? <Badge variant="secondary" className="text-[10px]">{svcCount} active</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => navigate(`/clients/${client.id}`)}><Eye className="h-4 w-4 mr-2" /> View</DropdownMenuItem>
                            {canEdit && <DropdownMenuItem onClick={() => navigate(`/clients/edit/${client.id}`)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                            <DropdownMenuItem onClick={() => setManageGroupsClient(client)}><Tags className="h-4 w-4 mr-2" /> Groups</DropdownMenuItem>
                            {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => setDeleteClient(client)}><Trash2 className="h-4 w-4 mr-2" /> Archive Client</DropdownMenuItem>}
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
                  {showAllFirms && <TableHead className="text-xs">Firm</TableHead>}
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
                      {showAllFirms && <TableCell className="text-xs text-muted-foreground">{client.firm_name || "—"}</TableCell>}
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
                            {canEdit && <DropdownMenuItem onClick={() => navigate(`/clients/edit/${client.id}`)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                            {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => setDeleteClient(client)}><Trash2 className="h-4 w-4 mr-2" /> Archive Client</DropdownMenuItem>}
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
      ) : viewMode === "card" ? (
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
                          {/* GAP-3: respect canEdit / canDelete in card view, same as IT + table views */}
                          {canEdit && <DropdownMenuItem onClick={() => navigate(`/clients/edit/${client.id}`)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                          {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => setDeleteClient(client)}><Trash2 className="h-4 w-4 mr-2" /> Archive Client</DropdownMenuItem>}
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
      ) : viewMode === "classify" ? (
        /* CLASSIFICATION BY FY VIEW */
        <ClassificationByFYView
          firmId={effectiveFirmId}
          showAllFirms={showAllFirms}
          canEdit={canEdit}
        />
      ) : null}

      {/* Draft Delete Confirmation */}
      <AlertDialog open={!!deleteDraftCandidate} onOpenChange={open => { if (!open) setDeleteDraftCandidate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Draft Client?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the incomplete client record
              {deleteDraftCandidate?.name ? <> <strong>{deleteDraftCandidate.name}</strong></> : ""} along with
              all associated profiles and group memberships. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDraftLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDraft}
              disabled={deleteDraftLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDraftLoading ? "Deleting…" : "Delete Draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive Client Confirmation */}
      <AlertDialog open={!!deleteClient} onOpenChange={open => { if (!open) setDeleteClient(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Client</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to archive <strong>{deleteClient?.name}</strong>? The client will be hidden from all lists but data will be preserved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteClient} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleteLoading ? "Archiving…" : "Archive"}</AlertDialogAction>
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

      {/* Sync from API Dialog */}
      <CustomerSyncDialog
        open={showSyncDialog}
        onOpenChange={setShowSyncDialog}
        firmId={effectiveFirmId}
        onComplete={() => {
          setShowSyncDialog(false);
          fetchData();  // Step 5: refresh client list after sync
        }}
      />
    </div>
  );
};

export default Clients;