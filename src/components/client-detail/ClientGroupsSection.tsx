import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, X } from "lucide-react";

interface Group {
  id: string;
  name: string;
  color: string | null;
}

interface Props {
  clientId: string;
}

export function ClientGroupsSection({ clientId }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<{ id: string; group: Group }[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const fetchData = async () => {
    const [memRes, grpRes] = await Promise.all([
      supabase
        .from("client_group_memberships")
        .select("id, group_id, client_groups(id, name, color)")
        .eq("client_id", clientId),
      supabase.from("client_groups").select("id, name, color").order("name"),
    ]);

    const mems = (memRes.data || []).map((m: any) => ({
      id: m.id,
      group: m.client_groups as Group,
    }));
    setMemberships(mems);
    setAllGroups((grpRes.data as Group[]) || []);
  };

  useEffect(() => { fetchData(); }, [clientId]);

  const memberGroupIds = new Set(memberships.map((m) => m.group.id));
  const availableGroups = allGroups.filter((g) => !memberGroupIds.has(g.id));

  const addToGroup = async (groupId: string) => {
    try {
      const { error } = await supabase.from("client_group_memberships").insert({
        group_id: groupId,
        client_id: clientId,
        added_by: user?.id || null,
      });
      if (error) throw error;
      toast({ title: "Added to group" });
      setPopoverOpen(false);
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const removeFromGroup = async (membershipId: string) => {
    try {
      const { error } = await supabase.from("client_group_memberships").delete().eq("id", membershipId);
      if (error) throw error;
      toast({ title: "Removed from group" });
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">Groups</h4>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={availableGroups.length === 0}>
              <Plus className="h-3 w-3" /> Add to Group
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="end">
            {availableGroups.map((g) => (
              <button
                key={g.id}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent text-left"
                onClick={() => addToGroup(g.id)}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color || "#6B7280" }} />
                {g.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {memberships.length === 0 ? (
          <span className="text-xs text-muted-foreground">Ungrouped</span>
        ) : (
          memberships.map((m) => (
            <Badge
              key={m.id}
              variant="outline"
              className="text-xs gap-1 pr-1"
              style={{ borderColor: m.group.color || "#6B7280", color: m.group.color || "#6B7280" }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.group.color || "#6B7280" }} />
              {m.group.name}
              <button
                className="ml-0.5 rounded-full hover:bg-muted p-0.5"
                onClick={() => removeFromGroup(m.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
