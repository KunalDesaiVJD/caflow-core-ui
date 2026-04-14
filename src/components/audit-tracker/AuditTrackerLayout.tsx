/**
 * AuditTrackerLayout
 * Two-tab layout:
 *  Tab 1 "Planning & Communication" — Google Calendar grid + comm table
 *  Tab 2 "Audit Status"             — AY-filtered editable grid
 *                                     (auto-populates from audit_engagements)
 */
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, TableProperties } from "lucide-react";

import { useAuditPlanning }   from "./hooks/useAuditPlanning";
import { useClients }          from "./hooks/useClients";
import { useUsers }            from "./hooks/useUsers";
import { useFirms }            from "./hooks/useFirms";
import { usePlanningStaff }    from "./hooks/usePlanningStaff";

import PlanningCalendar        from "./planning/PlanningCalendar";
import CommunicationTable      from "./planning/CommunicationTable";
import AuditStatusGrid         from "./audit-status/AuditStatusGrid";
import type { PlanEntry }      from "./hooks/useAuditPlanning";
import type { PlanSaveData }   from "./planning/PlanningEntryDialog";

// Assessment Year → Financial Year
function ayToFy(ay: string): string {
  const [start] = ay.split("-");
  return `${Number(start) - 1}-${String(Number(start)).slice(-2)}`;
}

const ASSESSMENT_YEARS = ["2026-27", "2025-26", "2024-25", "2023-24", "2022-23"];
const DEFAULT_AY = "2025-26";

interface Props {
  firmId:       string;
  userId:       string;
  isSuperadmin?: boolean;
}

export default function AuditTrackerLayout({ firmId, userId, isSuperadmin }: Props) {
  const { clients }    = useClients(firmId, isSuperadmin);
  const { users }      = useUsers(firmId, isSuperadmin);
  const { auditFirms } = useFirms(firmId);

  // ── Planning staff (only these employees show as calendar columns) ─────────
  const { staff: planningStaff, addStaff, removeStaff } = usePlanningStaff(firmId, isSuperadmin);

  const {
    entries, comms, loading,
    addEntry, updateEntry, removeEntry,
    addComm, updateComm, removeComm,
  } = useAuditPlanning(firmId, userId, isSuperadmin);

  // ── Audit Status: AY selector ──────────────────────────────────────────────
  const [selectedAY, setSelectedAY] = useState(DEFAULT_AY);
  const selectedFY = ayToFy(selectedAY);

  // ── Audit Status client filter ─────────────────────────────────────────────
  const [selectedClientId,   setSelectedClientId]   = useState<string | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);

  function handleClientDropdown(value: string) {
    if (value === "__all__") {
      setSelectedClientId(null);
      setSelectedClientName(null);
    } else {
      const found = clients.find(c => c.id === value);
      setSelectedClientId(value);
      setSelectedClientName(found?.name ?? null);
    }
  }

  // ── Calendar callbacks ─────────────────────────────────────────────────────
  async function handleAdd(data: PlanSaveData) { await addEntry(data); }
  async function handleUpdate(id: string, patch: Partial<PlanEntry>) { await updateEntry(id, patch as any); }
  async function handleDelete(id: string) { await removeEntry(id); }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
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
          <CommunicationTable
            comms={comms}
            entries={entries}
            clients={clients}
            onAdd={addComm}
            onUpdate={updateComm}
            onRemove={removeComm}
          />
          <PlanningCalendar
            entries={entries}
            loading={loading}
            clients={clients}
            users={users}
            planningStaff={planningStaff}
            onAddEntry={handleAdd}
            onUpdateEntry={handleUpdate}
            onDeleteEntry={handleDelete}
            onAddStaff={addStaff}
            onRemoveStaff={removeStaff}
          />
        </TabsContent>

        {/* ── Tab 2: Audit Status ── */}
        <TabsContent value="status" className="mt-4 space-y-3">

          {/* ── Filter bar: AY selector + client filter ── */}
          <div className="flex flex-wrap items-center gap-3">

            {/* Assessment Year */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Assessment Year</span>
              <Select value={selectedAY} onValueChange={setSelectedAY}>
                <SelectTrigger className="h-8 text-xs w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSESSMENT_YEARS.map(ay => (
                    <SelectItem key={ay} value={ay} className="text-xs">AY {ay}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground">→ FY {selectedFY}</span>
            </div>

            <div className="h-5 w-px bg-border" />

            {/* Client filter */}
            <Select
              value={selectedClientId ?? "__all__"}
              onValueChange={handleClientDropdown}
            >
              <SelectTrigger className="h-8 text-xs w-[220px]">
                <SelectValue placeholder="Filter by client…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs text-muted-foreground">
                  — All clients —
                </SelectItem>
                {clients.map(c => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedClientName && (
              <span className="text-xs text-muted-foreground">
                Showing rows for{" "}
                <span className="font-semibold text-indigo-700">{selectedClientName}</span>
              </span>
            )}
          </div>

          {/* ── Audit Status grid ── */}
          <AuditStatusGrid
            firmId={firmId}
            clients={clients}
            users={users}
            auditFirms={auditFirms}
            planEntries={entries}
            isSuperadmin={isSuperadmin}
            clientIdFilter={selectedClientId}
            selectedFY={selectedFY}
          />

        </TabsContent>
      </Tabs>
    </div>
  );
}
