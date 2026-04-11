/**
 * AuditTrackerLayout
 * Two-tab layout:
 *  Tab 1 "Planning & Communication" — Google Calendar grid + comm table
 *  Tab 2 "Audit Status"             — Summary overview OR per-client detail grid
 *
 * Audit Status tab has two view modes:
 *  • All Clients  — compact colour-coded summary table for every client
 *  • Select Client — client picker + full editable detail grid for that client
 */
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, TableProperties, LayoutList, User } from "lucide-react";
import { cn } from "@/lib/utils";

import { useAuditPlanning }   from "./hooks/useAuditPlanning";
import { useClients }          from "./hooks/useClients";
import { useUsers }            from "./hooks/useUsers";
import { useFirms }            from "./hooks/useFirms";

import PlanningCalendar        from "./planning/PlanningCalendar";
import CommunicationTable      from "./planning/CommunicationTable";
import AuditStatusGrid         from "./audit-status/AuditStatusGrid";
import AuditStatusSummaryView  from "./audit-status/AuditStatusSummaryView";
import type { PlanEntry }      from "./hooks/useAuditPlanning";
import type { PlanSaveData }   from "./planning/PlanningEntryDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditViewMode = "all" | "client";

interface Props {
  firmId:       string;
  userId:       string;
  isSuperadmin?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditTrackerLayout({ firmId, userId, isSuperadmin }: Props) {
  const { clients }    = useClients(firmId, isSuperadmin);
  const { users }      = useUsers(firmId, isSuperadmin);
  const { auditFirms } = useFirms(firmId);

  const {
    entries, comms, loading,
    addEntry, updateEntry, removeEntry,
    addComm, updateComm, removeComm,
  } = useAuditPlanning(firmId, userId, isSuperadmin);

  // ── Audit Status view-mode state ───────────────────────────────────────────
  const [auditViewMode,      setAuditViewMode]      = useState<AuditViewMode>("all");
  const [selectedClientId,   setSelectedClientId]   = useState<string | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);

  function switchToClient(clientId: string | null, clientName: string | null) {
    setSelectedClientId(clientId);
    setSelectedClientName(clientName);
    setAuditViewMode("client");
  }

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

  async function handleAdd(data: PlanSaveData) {
    await addEntry(data);
  }

  async function handleUpdate(id: string, patch: Partial<PlanEntry>) {
    await updateEntry(id, patch as any);
  }

  async function handleDelete(id: string) {
    await removeEntry(id);
  }

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
            onAddEntry={handleAdd}
            onUpdateEntry={handleUpdate}
            onDeleteEntry={handleDelete}
          />
        </TabsContent>

        {/* ── Tab 2: Audit Status ── */}
        <TabsContent value="status" className="mt-4 space-y-3">

          {/* ── View-mode toggle bar ── */}
          <div className="flex flex-wrap items-center gap-3">

            {/* Segmented toggle */}
            <div className="inline-flex items-center rounded-lg border border-border bg-muted/50 p-0.5 gap-0.5">
              <button
                onClick={() => setAuditViewMode("all")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-all",
                  auditViewMode === "all"
                    ? "bg-white shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutList size={12} />
                All Clients
              </button>

              <button
                onClick={() => setAuditViewMode("client")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-all",
                  auditViewMode === "client"
                    ? "bg-white shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <User size={12} />
                Select Client
              </button>
            </div>

            {/* Client dropdown — only visible in "client" mode */}
            {auditViewMode === "client" && (
              <Select
                value={selectedClientId ?? "__all__"}
                onValueChange={handleClientDropdown}
              >
                <SelectTrigger className="h-8 text-xs w-[220px]">
                  <SelectValue placeholder="Choose a client…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs text-muted-foreground">
                    — Show all rows —
                  </SelectItem>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Hint label when a client is selected */}
            {auditViewMode === "client" && selectedClientName && (
              <span className="text-xs text-muted-foreground">
                Showing rows for{" "}
                <span className="font-semibold text-indigo-700">{selectedClientName}</span>
              </span>
            )}
          </div>

          {/* ── Conditional view ── */}
          {auditViewMode === "all" ? (
            <AuditStatusSummaryView
              firmId={firmId}
              isSuperadmin={isSuperadmin}
              onSelectClient={switchToClient}
            />
          ) : (
            <AuditStatusGrid
              firmId={firmId}
              clients={clients}
              users={users}
              auditFirms={auditFirms}
              planEntries={entries}
              isSuperadmin={isSuperadmin}
              clientIdFilter={selectedClientId}
            />
          )}

        </TabsContent>
      </Tabs>
    </div>
  );
}
