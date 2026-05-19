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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CalendarDays, TableProperties, Maximize2, Minimize2, FileText, FileSpreadsheet, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
  // ── Audit Status: maximize state (Issue 4 — fullscreen view) ───────────────
  const [statusMaximized, setStatusMaximized] = useState(false);
  // ── Audit Status: searchable client filter (Issue 1) ───────────────────────
  const [clientPickerOpen, setClientPickerOpen] = useState(false);

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

  // ── Colour helpers shared between PDF and Excel exports ──────────────────────
  // Must match CLIENT_COLORS in PlanningCalendar.tsx (same hash fn → same colour)
  const CAL_DAY_ABR  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const CAL_MONTHS   = ["January","February","March","April","May","June",
                         "July","August","September","October","November","December"];
  const CAL_CLIENT_RGB: Array<[[number,number,number],[number,number,number]]> = [
    [[219,234,254],[30,64,175]],    // blue-100 / blue-800
    [[209,250,229],[6,95,70]],      // emerald
    [[254,243,199],[146,64,14]],    // amber
    [[237,233,254],[91,33,182]],    // violet
    [[255,228,230],[159,18,57]],    // rose
    [[207,250,254],[22,78,99]],     // cyan
    [[255,237,213],[146,64,14]],    // orange
    [[204,251,241],[19,78,74]],     // teal
    [[252,231,243],[131,24,67]],    // pink
    [[236,252,203],[63,98,18]],     // lime
  ];
  const CAL_CLIENT_HEX = [
    ["DBEAFE","1E40AF"], ["D1FAE5","065F46"], ["FEF3C7","92400E"],
    ["EDE9FE","5B21B6"], ["FFE4E6","9F1239"], ["CFFAFE","164E63"],
    ["FFEDD5","92400E"], ["CCFBF1","134E4A"], ["FCE7F3","831843"],
    ["ECFCCB","3F6212"],
  ];
  function calClientIdx(name: string): number {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return Math.abs(h) % CAL_CLIENT_RGB.length;
  }
  function calToISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  // ── Planning Calendar: PDF (jsPDF + autoTable, one page per month) ───────────
  const exportCalendarPdf = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable  = (await import("jspdf-autotable")).default;

      const empCols  = planningStaff.map(s => ({ id: s.user_id, name: s.name }));
      const todayISO = calToISO(new Date());

      // Determine month range — fall back to current month if no entries
      let fromMs = entries.length > 0
        ? Math.min(...entries.map((e: any) => new Date(e.planned_from).getTime()).filter(Number.isFinite))
        : new Date().getTime();
      let toMs   = entries.length > 0
        ? Math.max(...entries.map((e: any) => new Date(e.planned_to).getTime()).filter(Number.isFinite))
        : new Date().getTime();
      if (!Number.isFinite(fromMs)) fromMs = new Date().getTime();
      if (!Number.isFinite(toMs))   toMs   = new Date().getTime();

      const doc = new jsPDF({ orientation: "landscape", format: "a3", unit: "mm" });
      let firstPage = true;

      let cur = new Date(fromMs);
      cur.setDate(1);

      while (cur.getTime() <= toMs) {
        const yr = cur.getFullYear();
        const mo = cur.getMonth();
        const daysInMonth = new Date(yr, mo + 1, 0).getDate();

        if (!firstPage) doc.addPage();
        firstPage = false;

        // Header band
        const pw = doc.internal.pageSize.getWidth();
        doc.setFillColor(67, 56, 202);
        doc.rect(0, 0, pw, 20, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(255, 255, 255);
        doc.text("Planning Calendar", 14, 10);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(`${CAL_MONTHS[mo]} ${yr}`, 14, 17);
        doc.text(`${entries.length} assignment${entries.length !== 1 ? "s" : ""} total`, pw - 14, 17, { align: "right" });

        const head = [["DATE", ...empCols.map(e => e.name.split(" ")[0].toUpperCase())]];
        const body: string[][] = [];

        for (let d = 1; d <= daysInMonth; d++) {
          const date    = new Date(yr, mo, d);
          const iso     = calToISO(date);
          const dayLabel = `${CAL_DAY_ABR[date.getDay()]} ${d}`;
          const row: string[] = [dayLabel];
          for (const emp of empCols) {
            const hit = entries.find((e: any) =>
              (e.employee_ids || []).includes(emp.id) &&
              e.planned_from <= iso && e.planned_to >= iso
            );
            row.push(hit ? (hit.is_leave ? "Leave" : (hit.client_name || "")) : "");
          }
          body.push(row);
        }

        autoTable(doc, {
          head,
          body,
          startY: 24,
          margin: { left: 10, right: 10, bottom: 10 },
          styles: {
            fontSize: 7,
            cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
            font: "helvetica",
            lineWidth: 0.2,
            lineColor: [200, 200, 210] as [number,number,number],
            overflow: "linebreak",
          },
          headStyles: {
            fillColor: [67, 56, 202] as [number,number,number],
            textColor: [255, 255, 255] as [number,number,number],
            fontStyle: "bold",
            fontSize: 8,
            halign: "center",
          },
          columnStyles: {
            0: { cellWidth: 16, fontStyle: "bold", halign: "left" },
          },
          didParseCell: (data: any) => {
            if (data.section !== "body") return;
            const d    = data.row.index + 1;
            const date = new Date(yr, mo, d);
            const iso  = calToISO(date);
            const isSunday = date.getDay() === 0;
            const isToday  = iso === todayISO;

            if (data.column.index === 0) {
              if (isSunday) {
                data.cell.styles.fillColor = [254,226,226];
                data.cell.styles.textColor = [185,28,28];
              } else if (isToday) {
                data.cell.styles.fillColor = [238,242,255];
                data.cell.styles.textColor = [67,56,202];
                data.cell.styles.fontStyle = "bold";
              } else {
                data.cell.styles.textColor = [100,100,120];
              }
            } else {
              const val = data.cell.raw as string;
              if (val === "Leave") {
                data.cell.styles.fillColor = [243,244,246];
                data.cell.styles.textColor = [107,114,128];
              } else if (val) {
                const [bg, txt] = CAL_CLIENT_RGB[calClientIdx(val)];
                data.cell.styles.fillColor = bg;
                data.cell.styles.textColor = txt;
                data.cell.styles.fontStyle = "bold";
              } else if (isSunday) {
                data.cell.styles.fillColor = [254,242,242];
              }
            }
          },
        });

        cur.setMonth(cur.getMonth() + 1);
      }

      doc.save(`Planning_Calendar_${stamp()}.pdf`);
      toast.success("Calendar exported as PDF");
    } catch (e) { toast.error(`PDF export failed: ${(e as Error).message}`); }
  };

  // ── Planning Calendar: Excel (SpreadsheetML XML → .xls, full colour support) ──
  const exportCalendarXlsx = () => {
    try {
      const empCols  = planningStaff.map(s => ({ id: s.user_id, name: s.name }));
      const todayISO = calToISO(new Date());

      let fromMs = entries.length > 0
        ? Math.min(...entries.map((e: any) => new Date(e.planned_from).getTime()).filter(Number.isFinite))
        : new Date().getTime();
      let toMs   = entries.length > 0
        ? Math.max(...entries.map((e: any) => new Date(e.planned_to).getTime()).filter(Number.isFinite))
        : new Date().getTime();
      if (!Number.isFinite(fromMs)) fromMs = new Date().getTime();
      if (!Number.isFinite(toMs))   toMs   = new Date().getTime();

      const esc = (s: string) =>
        s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

      const bdr = `<Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
        <Border ss:Position="Top"    ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
        <Border ss:Position="Left"   ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
        <Border ss:Position="Right"  ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
      </Borders>`;
      const bdrIndigo = `<Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#4338CA"/>
        <Border ss:Position="Top"    ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#4338CA"/>
        <Border ss:Position="Left"   ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#4338CA"/>
        <Border ss:Position="Right"  ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#4338CA"/>
      </Borders>`;

      const clientStyles = CAL_CLIENT_HEX.map(([bg, txt], i) =>
        `<Style ss:ID="sC${i}">
          <Font ss:Color="#${txt}" ss:Bold="1"/>
          <Interior ss:Color="#${bg}" ss:Pattern="Solid"/>
          <Alignment ss:WrapText="1"/>
          ${bdr}
        </Style>`
      ).join("\n");

      const stylesXml = `<Styles>
        <Style ss:ID="Default"><Alignment ss:Vertical="Center"/></Style>
        <Style ss:ID="sHdr">
          <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="9"/>
          <Interior ss:Color="#4338CA" ss:Pattern="Solid"/>
          <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
          ${bdrIndigo}
        </Style>
        <Style ss:ID="sDate">
          <Font ss:Bold="1" ss:Color="#6B7280" ss:Size="8"/>
          <Borders>
            <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
            <Border ss:Position="Right"  ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
          </Borders>
        </Style>
        <Style ss:ID="sSunDate">
          <Font ss:Bold="1" ss:Color="#B91C1C" ss:Size="8"/>
          <Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/>
          <Borders>
            <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FCA5A5"/>
            <Border ss:Position="Right"  ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FCA5A5"/>
          </Borders>
        </Style>
        <Style ss:ID="sTodayDate">
          <Font ss:Bold="1" ss:Color="#4338CA" ss:Size="8"/>
          <Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/>
          <Borders>
            <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#C7D2FE"/>
            <Border ss:Position="Right"  ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#C7D2FE"/>
          </Borders>
        </Style>
        <Style ss:ID="sEmpty">${bdr}</Style>
        <Style ss:ID="sSunEmpty">
          <Interior ss:Color="#FEF2F2" ss:Pattern="Solid"/>
          <Borders>
            <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
            <Border ss:Position="Right"  ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
          </Borders>
        </Style>
        <Style ss:ID="sLeave">
          <Font ss:Color="#6B7280"/>
          <Interior ss:Color="#F3F4F6" ss:Pattern="Solid"/>
          ${bdr}
        </Style>
        ${clientStyles}
      </Styles>`;

      let sheetsXml = "";
      let cur = new Date(fromMs);
      cur.setDate(1);

      while (cur.getTime() <= toMs) {
        const yr = cur.getFullYear();
        const mo = cur.getMonth();
        const daysInMonth = new Date(yr, mo + 1, 0).getDate();
        const sheetName   = `${CAL_MONTHS[mo].slice(0,3)} ${yr}`;

        let cols = `<Column ss:Width="75"/>`;
        empCols.forEach(() => { cols += `<Column ss:Width="110"/>`; });

        let hdrCells = `<Cell ss:StyleID="sHdr"><Data ss:Type="String">DATE</Data></Cell>`;
        empCols.forEach(emp => {
          hdrCells += `<Cell ss:StyleID="sHdr"><Data ss:Type="String">${esc(emp.name.split(" ")[0].toUpperCase())}</Data></Cell>`;
        });

        let dataRows = "";
        for (let d = 1; d <= daysInMonth; d++) {
          const date     = new Date(yr, mo, d);
          const iso      = calToISO(date);
          const isSun    = date.getDay() === 0;
          const isToday  = iso === todayISO;
          const dayLabel = `${CAL_DAY_ABR[date.getDay()]} ${d}`;
          const dateStyle = isSun ? "sSunDate" : isToday ? "sTodayDate" : "sDate";

          let cells = `<Cell ss:StyleID="${dateStyle}"><Data ss:Type="String">${esc(dayLabel)}</Data></Cell>`;
          for (const emp of empCols) {
            const hit = entries.find((e: any) =>
              (e.employee_ids || []).includes(emp.id) &&
              e.planned_from <= iso && e.planned_to >= iso
            );
            if (!hit) {
              cells += `<Cell ss:StyleID="${isSun ? "sSunEmpty" : "sEmpty"}"><Data ss:Type="String"></Data></Cell>`;
            } else if (hit.is_leave) {
              cells += `<Cell ss:StyleID="sLeave"><Data ss:Type="String">Leave</Data></Cell>`;
            } else {
              const cn  = hit.client_name || "";
              const idx = calClientIdx(cn);
              cells += `<Cell ss:StyleID="sC${idx}"><Data ss:Type="String">${esc(cn)}</Data></Cell>`;
            }
          }
          dataRows += `<Row ss:Height="18">${cells}</Row>\n`;
        }

        sheetsXml += `<Worksheet ss:Name="${esc(sheetName)}">
  <Table>${cols}
    <Row ss:Height="24">${hdrCells}</Row>
    ${dataRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
    <FreezePanes/>
    <FrozenNoSplit/>
    <SplitHorizontal>1</SplitHorizontal>
    <TopRowBottomPane>1</TopRowBottomPane>
    <ActivePane>2</ActivePane>
  </WorksheetOptions>
</Worksheet>\n`;

        cur.setMonth(cur.getMonth() + 1);
      }

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:o="urn:schemas-microsoft-com:office:office">
${stylesXml}
${sheetsXml}
</Workbook>`;

      const blob = new Blob(["﻿" + xml], { type: "application/vnd.ms-excel;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `Planning_Calendar_${stamp()}.xls`;
      a.click();
      URL.revokeObjectURL(url);
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

            {/* Client filter — searchable combobox (Issue 1).
                Previously a basic <Select> with one item per client; for firms
                with 40+ clients this required scrolling through a long list.
                Now a cmdk-based search input filters as the auditor types. */}
            <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={clientPickerOpen}
                  className="h-8 text-xs w-[260px] justify-between font-normal"
                >
                  <span className="truncate">
                    {selectedClientName ?? "— All clients —"}
                  </span>
                  <ChevronsUpDown size={12} className="opacity-50 shrink-0 ml-2" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[260px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search client…" className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty>No client matches.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="__all_clients__"
                        onSelect={() => { handleClientDropdown("__all__"); setClientPickerOpen(false); }}
                        className="text-xs"
                      >
                        <Check className={cn("mr-2 h-3.5 w-3.5", !selectedClientId ? "opacity-100" : "opacity-0")} />
                        — All clients —
                      </CommandItem>
                      {clients.map(c => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => { handleClientDropdown(c.id); setClientPickerOpen(false); }}
                          className="text-xs"
                        >
                          <Check className={cn("mr-2 h-3.5 w-3.5", selectedClientId === c.id ? "opacity-100" : "opacity-0")} />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {selectedClientName && (
              <span className="text-xs text-muted-foreground">
                Showing rows for{" "}
                <span className="font-semibold text-indigo-700">{selectedClientName}</span>
              </span>
            )}
          </div>

          {/* ── Audit Status card with maximize toggle (Issue 4) ──
              The Audit Status grid is wide — for firms with many columns the
              card view forces lots of horizontal scrolling. The maximize
              button promotes the grid to a fullscreen overlay using the
              entire viewport. Mirrors the Planning Calendar maximize UX. */}
          <div
            ref={statusRef}
            className={statusMaximized
              ? "fixed inset-0 z-50 bg-background flex flex-col"
              : "rounded-lg border bg-card shadow-sm overflow-hidden"
            }
          >
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
              <span className="text-xs font-semibold tracking-wide">Audit Status — FY {selectedFY}</span>
              <div className="flex items-center gap-1">
                <ExportButtons onPdf={exportStatusPdf} onXlsx={exportStatusXlsx} />
                <Button
                  variant="ghost" size="sm"
                  className="h-6 w-6 p-0"
                  title={statusMaximized ? "Restore" : "Maximize (fullscreen)"}
                  onClick={() => setStatusMaximized(v => !v)}
                >
                  {statusMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </Button>
              </div>
            </div>
            <div className={statusMaximized ? "flex-1 min-h-0 overflow-auto p-2" : ""}>
              <AuditStatusGrid
                firmId={firmId}
                clients={clients}
                users={users}
                auditFirms={auditFirms}
                planEntries={entries}
                isSuperadmin={isSuperadmin}
                clientIdFilter={selectedClientId}
                selectedFY={selectedFY}
                maximized={statusMaximized}
              />
            </div>
          </div>

        </TabsContent>
      </Tabs>
    </div>
  );
}
