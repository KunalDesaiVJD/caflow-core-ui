/**
 * AuditTrackerLayout
 * Two-tab layout:
 *  Tab 1 "Planning & Communication" — Google Calendar grid + comm table
 *  Tab 2 "Audit Status"             — AY-filtered editable grid
 *                                     (auto-populates from audit_engagements)
 */
import { useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CalendarDays, TableProperties, Maximize2, Minimize2, FileText, FileSpreadsheet } from "lucide-react";
import { exportToPdf, exportToExcel } from "@/lib/exportUtils";
import { toast } from "sonner";

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

const DEFAULT_FY = "2025-26";

const FINANCIAL_YEARS = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22"];

interface Props {
  firmId:       string;
  userId:       string;
  isSuperadmin?: boolean;
}

export default function AuditTrackerLayout({ firmId, userId, isSuperadmin }: Props) {
  const { users }      = useUsers(firmId, isSuperadmin);
  const { auditFirms } = useFirms(firmId);

  // ── Planning staff (only these employees show as calendar columns) ─────────
  const { staff: planningStaff, addStaff, removeStaff, reorderStaff } = usePlanningStaff(firmId, isSuperadmin);

  const {
    entries, comms, loading,
    addEntry, updateEntry, removeEntry,
    addComm, updateComm, removeComm,
  } = useAuditPlanning(firmId, userId, isSuperadmin);

  // ── Planning & Communication: maximize state ───────────────────────────────
  const [commMaximized, setCommMaximized] = useState(false);
  const [calMaximized,  setCalMaximized]  = useState(false);

  // ── Export refs (PDF captures DOM; Excel pulls structured data) ────────────
  const calRef    = useRef<HTMLDivElement>(null);
  const commRef   = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  // ── Helpers: export entries / comms to Excel + PDF ─────────────────────────
  const stamp = () => new Date().toISOString().split("T")[0];

  const exportCalendarPdf = async () => {
    if (!calRef.current) return;
    try { await exportToPdf(calRef.current, `Planning_Calendar_${stamp()}.pdf`); toast.success("Calendar exported as PDF"); }
    catch (e) { toast.error(`PDF export failed: ${(e as Error).message}`); }
  };
  const exportCalendarXlsx = () => {
    try {
      const userMap = new Map(users.map(u => [u.id, u.full_name || u.email || "—"] as const));
      const clientMap = new Map(clients.map(c => [c.id, c.name] as const));
      const rows = entries.map(e => ({
        Date:        e.assignment_date ?? "",
        Employee:    userMap.get(e.assignee_user_id) ?? "—",
        Client:      e.client_id ? (clientMap.get(e.client_id) ?? "—") : (e.label || "—"),
        Type:        e.type || "",
        "Financial Year": e.financial_year || "",
        Status:      (e as any).status || "",
        Notes:       (e as any).notes || "",
      }));
      exportToExcel([{ sheetName: "Planning Calendar", rows }], `Planning_Calendar_${stamp()}.xlsx`);
      toast.success("Calendar exported as Excel");
    } catch (e) { toast.error(`Excel export failed: ${(e as Error).message}`); }
  };

  const exportCommPdf = async () => {
    if (!commRef.current) return;
    try { await exportToPdf(commRef.current, `Communication_Log_${stamp()}.pdf`); toast.success("Communication Log exported as PDF"); }
    catch (e) { toast.error(`PDF export failed: ${(e as Error).message}`); }
  };
  const exportCommXlsx = () => {
    try {
      const clientMap = new Map(clients.map(c => [c.id, c.name] as const));
      const rows = (comms || []).map((c: any) => ({
        Date:    c.comm_date || c.date || "",
        Client:  c.client_id ? (clientMap.get(c.client_id) ?? "—") : "—",
        Channel: c.channel || c.type || "",
        Subject: c.subject || "",
        Summary: c.summary || c.notes || "",
        Status:  c.status || "",
      }));
      exportToExcel([{ sheetName: "Communication Log", rows }], `Communication_Log_${stamp()}.xlsx`);
      toast.success("Communication Log exported as Excel");
    } catch (e) { toast.error(`Excel export failed: ${(e as Error).message}`); }
  };

  const exportStatusPdf = async () => {
    if (!statusRef.current) return;
    try { await exportToPdf(statusRef.current, `Audit_Status_${selectedFY}_${stamp()}.pdf`); toast.success("Audit Status exported as PDF"); }
    catch (e) { toast.error(`PDF export failed: ${(e as Error).message}`); }
  };
  const exportStatusXlsx = () => {
    // Extract data from the rendered <table> inside the Audit Status grid.
    if (!statusRef.current) return;
    try {
      const tbl = statusRef.current.querySelector("table");
      if (!tbl) { toast.error("Audit Status grid not yet rendered"); return; }
      const headers = [...tbl.querySelectorAll("thead th")].map(th => (th.textContent || "").trim());
      const rows = [...tbl.querySelectorAll("tbody tr")].map(tr => {
        const cells = [...tr.querySelectorAll("td")].map(td => {
          const input = td.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea,select");
          return ((input?.value ?? td.textContent) || "").trim();
        });
        const row: Record<string, string> = {};
        cells.forEach((v, i) => { row[headers[i] || `Col${i + 1}`] = v; });
        return row;
      });
      exportToExcel([{ sheetName: `Audit Status FY${selectedFY}`, rows }], `Audit_Status_${selectedFY}_${stamp()}.xlsx`);
      toast.success("Audit Status exported as Excel");
    } catch (e) { toast.error(`Excel export failed: ${(e as Error).message}`); }
  };

  const ExportButtons = ({ onPdf, onXlsx }: { onPdf: () => void; onXlsx: () => void }) => (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" className="h-6 px-2 gap-1 text-[10px]" onClick={onXlsx} title="Export to Excel">
        <FileSpreadsheet size={11} /> Excel
      </Button>
      <Button variant="ghost" size="sm" className="h-6 px-2 gap-1 text-[10px]" onClick={onPdf} title="Export to PDF">
        <FileText size={11} /> PDF
      </Button>
    </div>
  );

  // ── Audit Status: FY selector ──────────────────────────────────────────────
  const [selectedFY, setSelectedFY] = useState(DEFAULT_FY);

  const { clients } = useClients(firmId, isSuperadmin, selectedFY);

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
  async function handleAdd(data: PlanSaveData) { await addEntry({ ...data, financial_year: selectedFY }); }
  async function handleUpdate(id: string, patch: Partial<PlanEntry>) { await updateEntry(id, patch as any); }
  async function handleDelete(id: string) { await removeEntry(id); }

  // ─── Render ───────────────────────────────────────────────────────────────

  // Planning Calendar card — rendered either inline or as a fullscreen overlay
  const planningCalendarCard = (
    <div ref={calRef} className={calMaximized
      ? "fixed inset-0 z-50 bg-background flex flex-col"
      : "rounded-lg border bg-card shadow-sm overflow-hidden"
    }>
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
        <span className="text-xs font-semibold tracking-wide">Planning Calendar</span>
        <div className="flex items-center gap-1">
          <ExportButtons onPdf={exportCalendarPdf} onXlsx={exportCalendarXlsx} />
          <Button
            variant="ghost" size="sm"
            className="h-6 w-6 p-0"
            title={calMaximized ? "Restore" : "Maximize (fit to screen)"}
            onClick={() => setCalMaximized(v => !v)}
          >
            {calMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </Button>
        </div>
      </div>
      <div className={calMaximized ? "flex-1 min-h-0 overflow-hidden p-2" : ""}>
        <PlanningCalendar
          entries={entries}
          loading={loading}
          clients={clients}
          users={users}
          planningStaff={planningStaff}
          isSuperadmin={isSuperadmin}
          onAddEntry={handleAdd}
          onUpdateEntry={handleUpdate}
          onDeleteEntry={handleDelete}
          onAddStaff={addStaff}
          onRemoveStaff={removeStaff}
          onReorderStaff={reorderStaff}
          fillParent={calMaximized}
        />
      </div>
    </div>
  );

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

          {/* Planning Calendar — FIRST as requested; fullscreen overlay when maximized */}
          {!commMaximized && planningCalendarCard}

          {/* Communication Log — AFTER Planning Calendar */}
          {!calMaximized && (
            <div ref={commRef} className="rounded-lg border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-semibold tracking-wide">Communication Log</span>
                <div className="flex items-center gap-1">
                  <ExportButtons onPdf={exportCommPdf} onXlsx={exportCommXlsx} />
                  <Button
                    variant="ghost" size="sm"
                    className="h-6 w-6 p-0"
                    title={commMaximized ? "Restore" : "Maximize"}
                    onClick={() => setCommMaximized(v => !v)}
                  >
                    {commMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  </Button>
                </div>
              </div>
              <div className={commMaximized ? "max-h-[calc(100vh-180px)] overflow-y-auto" : ""}>
                <CommunicationTable
                  comms={comms}
                  entries={entries}
                  clients={clients}
                  onAdd={addComm}
                  onUpdate={updateComm}
                  onRemove={removeComm}
                />
              </div>
            </div>
          )}

        </TabsContent>

        {/* ── Tab 2: Audit Status ── */}
        <TabsContent value="status" className="mt-4 space-y-3">

          {/* ── Filter bar: FY selector + client filter ── */}
          <div className="flex flex-wrap items-center gap-3">

            {/* Financial Year */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Financial Year</span>
              <Select value={selectedFY} onValueChange={setSelectedFY}>
                <SelectTrigger className="h-8 text-xs w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FINANCIAL_YEARS.map(fy => (
                    <SelectItem key={fy} value={fy} className="text-xs">FY {fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

          {/* ── Export bar for Audit Status ── */}
          <div className="flex items-center justify-end gap-1 px-1">
            <ExportButtons onPdf={exportStatusPdf} onXlsx={exportStatusXlsx} />
          </div>

          {/* ── Audit Status grid (wrapped for export) ── */}
          <div ref={statusRef}>
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
          </div>

        </TabsContent>
      </Tabs>
    </div>
  );
}
