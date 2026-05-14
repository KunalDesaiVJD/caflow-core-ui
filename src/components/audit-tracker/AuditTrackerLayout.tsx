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

  // ── PDF export with full-width capture ─────────────────────────────────
  // Wide tables (Planning Calendar, Audit Status) overflow A4 portrait and
  // get truncated by html2canvas. Capture in A3 landscape and walk the
  // ancestor chain temporarily widening any overflow:auto/scroll containers
  // so the entire grid is in view during capture.
  const captureWide = async (el: HTMLElement, filename: string) => {
    const restored: Array<{ el: HTMLElement; ov: string; w: string }> = [];
    let n: HTMLElement | null = el;
    while (n) {
      const cs = getComputedStyle(n);
      if (/auto|scroll|hidden/.test(cs.overflowX) || /auto|scroll|hidden/.test(cs.overflow)) {
        restored.push({ el: n, ov: n.style.overflow, w: n.style.width });
        n.style.overflow = "visible";
        n.style.width    = `${n.scrollWidth}px`;
      }
      n = n.parentElement;
    }
    try {
      await exportToPdf(el, filename, { orientation: "landscape", format: "a3" });
    } finally {
      restored.forEach(({ el, ov, w }) => { el.style.overflow = ov; el.style.width = w; });
    }
  };

  const exportCalendarPdf = async () => {
    if (!calRef.current) return;
    try { await captureWide(calRef.current, `Planning_Calendar_${stamp()}.pdf`); toast.success("Calendar exported as PDF"); }
    catch (e) { toast.error(`PDF export failed: ${(e as Error).message}`); }
  };
  const exportCalendarXlsx = () => {
    try {
      // Sheet 1 — flat list of assignments (one row per planning entry)
      const flat = (entries || []).map((e: any) => ({
        "Date From":  e.planned_from ?? "",
        "Date To":    e.planned_to   ?? "",
        Employees:    Array.isArray(e.employee_names) ? e.employee_names.join(", ") : "",
        Client:       e.is_leave ? "LEAVE" : (e.client_name ?? "—"),
        Days:         e.planned_from && e.planned_to
          ? Math.max(1, Math.round((new Date(e.planned_to).getTime() - new Date(e.planned_from).getTime()) / 86400000) + 1)
          : 1,
      }));

      // Sheet 2 — calendar grid view (one row per date, one column per employee)
      // Mirrors what the auditor sees on screen so the export is meaningful.
      const grid: Record<string, any>[] = [];
      const empCols = planningStaff.map(s => s.name || s.user_id);
      if (entries && entries.length > 0) {
        // Build the date range (earliest planned_from to latest planned_to)
        const fromMs = Math.min(...entries.map((e: any) => new Date(e.planned_from).getTime()).filter(Number.isFinite));
        const toMs   = Math.max(...entries.map((e: any) => new Date(e.planned_to).getTime()).filter(Number.isFinite));
        if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
          for (let t = fromMs; t <= toMs; t += 86400000) {
            const d = new Date(t);
            const iso = d.toISOString().slice(0, 10);
            const row: Record<string, string> = { Date: iso };
            for (const empName of empCols) {
              const hit = (entries as any[]).find(e =>
                e.planned_from <= iso && e.planned_to >= iso &&
                Array.isArray(e.employee_names) && e.employee_names.includes(empName)
              );
              row[empName] = hit ? (hit.is_leave ? "Leave" : (hit.client_name ?? "—")) : "";
            }
            grid.push(row);
          }
        }
      }

      exportToExcel(
        [
          { sheetName: "Assignments", rows: flat },
          ...(grid.length > 0 ? [{ sheetName: "Calendar Grid", rows: grid }] : []),
        ],
        `Planning_Calendar_${stamp()}.xlsx`,
      );
      toast.success("Calendar exported as Excel");
    } catch (e) { toast.error(`Excel export failed: ${(e as Error).message}`); }
  };

  const exportCommPdf = async () => {
    if (!commRef.current) return;
    try { await captureWide(commRef.current, `Communication_Log_${stamp()}.pdf`); toast.success("Communication Log exported as PDF"); }
    catch (e) { toast.error(`PDF export failed: ${(e as Error).message}`); }
  };
  const exportCommXlsx = () => {
    try {
      const rows = (comms || []).map((c: any) => ({
        Client:          c.client_name        ?? "—",
        "Audit From":    c.audit_planned_from ?? "",
        "Audit To":      c.audit_planned_to   ?? "",
        "Contact Person": c.contact_person     ?? "",
        "Contact No":    c.contact_no         ?? "",
        Remarks:         c.remarks            ?? "",
        "Logged At":     c.created_at         ?? "",
      }));
      exportToExcel([{ sheetName: "Communication Log", rows }], `Communication_Log_${stamp()}.xlsx`);
      toast.success("Communication Log exported as Excel");
    } catch (e) { toast.error(`Excel export failed: ${(e as Error).message}`); }
  };

  const exportStatusPdf = async () => {
    if (!statusRef.current) return;
    try { await captureWide(statusRef.current, `Audit_Status_${selectedFY}_${stamp()}.pdf`); toast.success("Audit Status exported as PDF"); }
    catch (e) { toast.error(`PDF export failed: ${(e as Error).message}`); }
  };
  const exportStatusXlsx = () => {
    if (!statusRef.current) return;
    try {
      const tbl = statusRef.current.querySelector("table");
      if (!tbl) { toast.error("Audit Status grid not yet rendered"); return; }
      const headers = [...tbl.querySelectorAll("thead th")]
        .map(th => (th.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const rows = [...tbl.querySelectorAll("tbody tr")].map(tr => {
        const cells = [...tr.querySelectorAll("td")].map(td => {
          // Prefer the editable control's value (input/textarea/select);
          // fall back to the cell's text content. This makes the export
          // reflect what the auditor sees on screen.
          const ctrl = td.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
            "input, textarea, select",
          );
          let v = "";
          if (ctrl) {
            v = ctrl.value || "";
            // For native <select>, get the visible label of the chosen option
            if (ctrl.tagName === "SELECT") {
              const sel = ctrl as HTMLSelectElement;
              const opt = sel.options[sel.selectedIndex];
              if (opt) v = opt.text;
            }
          } else {
            v = (td.textContent || "").replace(/\s+/g, " ").trim();
          }
          return v;
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
