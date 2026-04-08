/**
 * AuditTrackerLayout
 * Two-tab layout:
 *  Tab 1 "Planning & Communication" — Google Calendar grid + comm table
 *  Tab 2 "Audit Status"             — Full status grid
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, TableProperties } from "lucide-react";

import { useAuditPlanning } from "./hooks/useAuditPlanning";
import { useClients }       from "./hooks/useClients";
import { useUsers }         from "./hooks/useUsers";
import { useFirms }         from "./hooks/useFirms";

import PlanningCalendar   from "./planning/PlanningCalendar";
import CommunicationTable from "./planning/CommunicationTable";
import AuditStatusGrid    from "./audit-status/AuditStatusGrid";
import type { PlanEntry } from "./hooks/useAuditPlanning";
import type { PlanSaveData } from "./planning/PlanningEntryDialog";

interface Props {
  firmId: string;
  userId: string;
}

export default function AuditTrackerLayout({ firmId, userId }: Props) {
  const { clients }    = useClients(firmId);
  const { users }      = useUsers(firmId);
  const { auditFirms } = useFirms(firmId);

  const {
    entries, comms, loading, useLs,
    addEntry, updateEntry, removeEntry,
    addComm, updateComm, removeComm,
  } = useAuditPlanning(firmId, userId);

  // ── Calendar callbacks ─────────────────────────────────────────────────────

  async function handleAdd(data: PlanSaveData) {
    await addEntry(data);
  }

  async function handleUpdate(id: string, patch: Partial<PlanEntry>) {
    await updateEntry(id, patch as any);
  }

  async function handleDelete(id: string) {
    await removeEntry(id);
  }

  return (
    <div className="space-y-4">
      {useLs && (
        <Badge className="bg-amber-100 text-amber-700 text-xs">
          Offline mode — data stored locally. Apply Supabase migration to sync to cloud.
        </Badge>
      )}

      <Tabs defaultValue="planning">
        <TabsList className="h-auto gap-1">
          <TabsTrigger value="planning" className="text-xs gap-1.5">
            <CalendarDays size={13} /> Planning &amp; Communication
          </TabsTrigger>
          <TabsTrigger value="status" className="text-xs gap-1.5">
            <TableProperties size={13} /> Audit Status
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Planning & Communication ── */}
        <TabsContent value="planning" className="mt-4 space-y-4">
          {/* Calendar grid */}
          <PlanningCalendar
            entries={entries}
            loading={loading}
            clients={clients}
            users={users}
            onAddEntry={handleAdd}
            onUpdateEntry={handleUpdate}
            onDeleteEntry={handleDelete}
          />

          {/* Communication table */}
          <CommunicationTable
            comms={comms}
            entries={entries}
            clients={clients}
            onAdd={addComm}
            onUpdate={updateComm}
            onRemove={removeComm}
          />
        </TabsContent>

        {/* ── Tab 2: Audit Status ── */}
        <TabsContent value="status" className="mt-4">
          <AuditStatusGrid
            firmId={firmId}
            clients={clients}
            users={users}
            auditFirms={auditFirms}
            planEntries={entries}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
