/**
 * AuditTrackerLayout
 * Main layout with two tabs:
 *  - Planning & Communication  (Gantt calendar + comm table)
 *  - Audit Status              (full status grid)
 */
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, TableProperties } from "lucide-react";

import { useAuditPlanning } from "./hooks/useAuditPlanning";
import { useClients }       from "./hooks/useClients";
import { useUsers }         from "./hooks/useUsers";
import { useFirms }         from "./hooks/useFirms";

import PlanningCalendar  from "./planning/PlanningCalendar";
import CommunicationTable from "./planning/CommunicationTable";
import AuditStatusGrid   from "./audit-status/AuditStatusGrid";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  firmId: string;
  userId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditTrackerLayout({ firmId, userId }: Props) {
  const { clients }    = useClients(firmId);
  const { users }      = useUsers(firmId);
  const { auditFirms } = useFirms(firmId);

  const {
    entries, comms, loading, useLs,
    addEntry, removeEntry,
    addComm, removeComm,
  } = useAuditPlanning(firmId, userId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedEntry = entries.find(e => e.id === selectedId) || null;

  return (
    <div className="space-y-4">
      {useLs && (
        <Badge className="bg-amber-100 text-amber-700 text-xs gap-1">
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
          <PlanningCalendar
            entries={entries}
            loading={loading}
            selectedId={selectedId}
            onSelectEntry={setSelectedId}
            clients={clients}
            users={users}
            onAddEntry={async data => { await addEntry(data); }}
            onDeleteEntry={async id => { await removeEntry(id); if (selectedId === id) setSelectedId(null); }}
          />
          <CommunicationTable
            comms={comms}
            selectedEntry={selectedEntry}
            onAdd={addComm}
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
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
