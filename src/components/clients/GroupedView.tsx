import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown, ChevronRight, Eye, FolderOpen, MoreVertical,
  Pencil, Search, Tags, Trash2, Users,
} from "lucide-react";

interface Client {
  id: string;
  name: string | null;
  pan: string | null;
  entity_type: string | null;
  cin: string | null;
  gstin: string[] | null;
  created_at: string | null;
  firm_id: string | null;
  source?: string | null;
  is_active?: boolean | null;
  is_draft?: boolean | null;
  firm_name?: string | null;
}

interface GroupInfo {
  id: string;
  name: string;
  color: string | null;
}

interface GroupedViewProps {
  filtered: Client[];
  groups: GroupInfo[];
  clientGroupMap: Record<string, GroupInfo[]>;
  serviceCountMap: Record<string, number>;
  showAllFirms: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onOpenClient: (id: string) => void;
  onEditClient: (id: string) => void;
  onManageGroups: (client: Client) => void;
  onDelete: (client: Client) => void;
  onCreateGroup: () => void;
}

/**
 * Renders the filtered client list organized by client_group.
 * Each group is a collapsible section showing name, colored swatch, member
 * count and the clients inside. Clients assigned to multiple groups appear
 * under each. Clients with no group land under "Ungrouped" at the bottom.
 */
export function GroupedView({
  filtered, groups, clientGroupMap, serviceCountMap, showAllFirms,
  canEdit, canDelete,
  onOpenClient, onEditClient, onManageGroups, onDelete, onCreateGroup,
}: GroupedViewProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sectionSearch, setSectionSearch] = useState("");

  const toggle = (id: string) =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  // Build { groupId → clients[] } plus a synthetic "__ungrouped" bucket.
  const sections = useMemo(() => {
    const byGroup = new Map<string, Client[]>();
    for (const g of groups) byGroup.set(g.id, []);
    const ungrouped: Client[] = [];

    for (const c of filtered) {
      const gs = clientGroupMap[c.id] || [];
      if (gs.length === 0) ungrouped.push(c);
      else {
        for (const g of gs) {
          if (!byGroup.has(g.id)) byGroup.set(g.id, []);
          byGroup.get(g.id)!.push(c);
        }
      }
    }

    const secs = groups
      .map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color || "#6B7280",
        isUngrouped: false,
        clients: byGroup.get(g.id) || [],
      }))
      // Keep empty groups visible so users can see what exists and click Edit
      .sort((a, b) => a.name.localeCompare(b.name));

    secs.push({
      id: "__ungrouped",
      name: "Ungrouped",
      color: "#9CA3AF",
      isUngrouped: true,
      clients: ungrouped,
    });
    return secs;
  }, [groups, clientGroupMap, filtered]);

  // Section-level search applies to client names + PANs inside each group.
  const matchText = (c: Client) => {
    if (!sectionSearch.trim()) return true;
    const q = sectionSearch.toLowerCase();
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.pan || "").toLowerCase().includes(q)
    );
  };

  const totalClients = filtered.length;
  const groupCount = groups.length;

  return (
    <div className="space-y-4">
      {/* Summary + section search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5" />
            <span><strong className="text-foreground">{groupCount}</strong> groups</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span><strong className="text-foreground">{totalClients}</strong> clients in view</span>
          </span>
        </div>
        <div className="relative flex-1 max-w-sm ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter within groups (name / PAN)…"
            value={sectionSearch}
            onChange={(e) => setSectionSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={onCreateGroup} className="gap-1.5">
          <FolderOpen className="h-3.5 w-3.5" /> Manage Groups
        </Button>
      </div>

      {sections.map((sec) => {
        const visible = sec.clients.filter(matchText);
        const isCollapsed = !!collapsed[sec.id];
        const hideEmpty = sec.isUngrouped && visible.length === 0;
        if (hideEmpty) return null;
        return (
          <Card key={sec.id} className="overflow-hidden">
            {/* Section header */}
            <button
              type="button"
              onClick={() => toggle(sec.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: sec.color }}
              />
              <span className="text-sm font-semibold truncate">{sec.name}</span>
              <Badge variant="secondary" className="text-[10px] ml-1">
                {visible.length}
                {sectionSearch && sec.clients.length !== visible.length
                  ? ` / ${sec.clients.length}`
                  : ""}
              </Badge>
              {sec.isUngrouped && visible.length > 0 && (
                <span className="text-[10px] text-muted-foreground ml-2 italic">
                  — not assigned to any group
                </span>
              )}
            </button>

            {/* Section body */}
            {!isCollapsed && (
              <CardContent className="p-0">
                {visible.length === 0 ? (
                  <div className="px-4 py-6 text-xs text-center text-muted-foreground">
                    {sectionSearch ? "No clients match the filter in this group." : "No clients in this group yet."}
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {visible.map((client) => {
                      const cGroups = clientGroupMap[client.id] || [];
                      const svcCount = serviceCountMap[client.id] || 0;
                      const initial = (client.name || "?")[0].toUpperCase();
                      return (
                        <div
                          key={`${sec.id}-${client.id}`}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 cursor-pointer"
                          onClick={() => onOpenClient(client.id)}
                        >
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                            {initial}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate">
                                {client.name || "Unnamed"}
                              </span>
                              {client.source === "api_import" && !client.is_draft && (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0">Imported</Badge>
                              )}
                              {client.source === "api_import" && client.is_draft && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500 text-amber-600">Draft</Badge>
                              )}
                              {client.entity_type && (
                                <Badge variant="outline" className="text-[10px]">
                                  {client.entity_type}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                              {client.pan && <span className="font-mono">{client.pan}</span>}
                              {showAllFirms && client.firm_name && (
                                <span className="truncate">· {client.firm_name}</span>
                              )}
                              {svcCount > 0 && <span>· {svcCount} active service{svcCount > 1 ? "s" : ""}</span>}
                              {cGroups.length > 1 && (
                                <span className="inline-flex items-center gap-1">
                                  · also in:
                                  {cGroups
                                    .filter((g) => g.id !== sec.id)
                                    .slice(0, 3)
                                    .map((g) => (
                                      <Badge
                                        key={g.id}
                                        variant="outline"
                                        className="text-[9px] px-1 py-0 ml-1"
                                        style={{
                                          borderColor: g.color || "#6B7280",
                                          color: g.color || "#6B7280",
                                        }}
                                      >
                                        {g.name}
                                      </Badge>
                                    ))}
                                </span>
                              )}
                            </div>
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onOpenClient(client.id)}>
                                  <Eye className="h-4 w-4 mr-2" /> View
                                </DropdownMenuItem>
                                {canEdit && (
                                  <DropdownMenuItem onClick={() => onEditClient(client.id)}>
                                    <Pencil className="h-4 w-4 mr-2" /> Edit
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => onManageGroups(client)}>
                                  <Tags className="h-4 w-4 mr-2" /> Groups
                                </DropdownMenuItem>
                                {canDelete && (
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => onDelete(client)}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" /> Archive
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
