/**
 * QuerySheet — Sheet 5 "QUERY SHEET"
 *
 * Query tracking with Correction Status gate (Req #6).
 *
 * Columns: SR NO | Group/Subgroup | Ledger | Query Description |
 *          Required Documents | Remark | Correction Status
 *
 * Gate rule: ALL queries must have Correction Status = "Yes" before
 * the engagement can progress to the next pipeline stage.
 * Zero queries = gate is open (no pending corrections).
 */
import { useState, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge }    from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Save, Loader2, MessageSquareWarning,
  Plus, Trash2, Download, Upload, FileSpreadsheet, Search, X,
} from "lucide-react";
import { toast } from "sonner";

import { useQuerySheetStorage } from "./hooks/useQuerySheetStorage";
import type { QueryRow } from "./hooks/useQuerySheetStorage";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

// ─── Excel helpers ────────────────────────────────────────────────────────────

// Column order is the contract for Excel import/export.
// Parser reads by index (row[1], row[2]…) so header label changes are
// safe — only the order matters.
const HEADERS = [
  "SR.", "GROUP/SUBGROUP", "LEDGER", "QUERY DESCRIPTION",
  "REQUIRED DOCUMENTS", "REMARK", "CORRECTION STATUS",
];

function exportToExcel(queries: QueryRow[], clientName: string, fy: string) {
  const rows = queries.map((q, i) => [
    i + 1,
    q.head,
    q.particulars,
    q.query_description,
    q.required_documents,
    q.remark,
    q.correction_status || "Pending",
  ]);
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  // Column widths
  ws["!cols"] = [
    { wch: 5 }, { wch: 18 }, { wch: 22 }, { wch: 35 },
    { wch: 28 }, { wch: 22 }, { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Queries");
  const safeName = (clientName || "Client").replace(/[^a-zA-Z0-9_-]/g, "_");
  XLSX.writeFile(wb, `Queries_${safeName}_${fy || "FY"}.xlsx`);
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS]);
  ws["!cols"] = [
    { wch: 5 }, { wch: 18 }, { wch: 22 }, { wch: 35 },
    { wch: 28 }, { wch: 22 }, { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Queries");
  XLSX.writeFile(wb, "QuerySheet_Template_CAFlow.xlsx");
}

function parseWorkbook(file: File): Promise<Array<Omit<QueryRow, "id">>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
        // Skip header row(s): detect by checking if first cell is "SR." or numeric
        const dataRows = raw.filter((row, i) => {
          if (i === 0) return false; // always skip first row (header)
          return row.some((c: any) => c !== undefined && c !== null && c !== "");
        });
        const parsed: Array<Omit<QueryRow, "id">> = dataRows.map((row: any[]) => ({
          head:               String(row[1] ?? ""),
          particulars:        String(row[2] ?? ""),
          query_description:  String(row[3] ?? ""),
          required_documents: String(row[4] ?? ""),
          remark:             String(row[5] ?? ""),
          correction_status:  (["Yes", "No"].includes(String(row[6] ?? ""))
            ? String(row[6]) : "") as "" | "Yes" | "No",
        }));
        resolve(parsed.filter(r => r.head || r.particulars || r.query_description));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
  onSaved?:     () => void;
}

// ─── Correction Status Select ─────────────────────────────────────────────────

function CorrectionSelect({
  value,
  onChange,
}: {
  value:    string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value || "__pending__"} onValueChange={v => onChange(v === "__pending__" ? "" : v)}>
      <SelectTrigger
        className={cn(
          "h-7 text-xs w-full min-w-[90px]",
          value === "Yes" && "border-green-400 text-green-700 bg-green-50",
          value === "No"  && "border-red-400   text-red-700   bg-red-50",
          value === ""    && "border-orange-300"
        )}
      >
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__pending__">— Pending —</SelectItem>
        <SelectItem value="Yes">✓ Yes</SelectItem>
        <SelectItem value="No">✗ No</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QuerySheet({ data, engagementId, onSaved }: Props) {
  const {
    queries, addQuery, updateQuery, deleteQuery, bulkAddQueries,
    manualSave, saving, allCorrected, pendingCount,
  } = useQuerySheetStorage(engagementId, data.engagement?.firm_id);

  // Delete confirmation state: tracks which row is awaiting confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Search + Filter state ────────────────────────────────────────────────────
  // statusFilter: null = show all; "corrected" = Yes only; "pending" = not Yes
  const [searchText,   setSearchText]   = useState("");
  const [statusFilter, setStatusFilter] = useState<null | "corrected" | "pending">(null);

  const displayedQueries = useMemo(() => {
    return queries.filter((q) => {
      // Status filter
      if (statusFilter === "corrected" && q.correction_status !== "Yes") return false;
      if (statusFilter === "pending"   && q.correction_status === "Yes") return false;
      // Search filter (across group, ledger, description, documents, remark)
      if (searchText) {
        const s = searchText.toLowerCase();
        const hit =
          q.head?.toLowerCase().includes(s) ||
          q.particulars?.toLowerCase().includes(s) ||
          q.query_description?.toLowerCase().includes(s) ||
          q.required_documents?.toLowerCase().includes(s) ||
          q.remark?.toLowerCase().includes(s);
        if (!hit) return false;
      }
      return true;
    });
  }, [queries, statusFilter, searchText]);

  // Toggle status filter chip — clicking same chip again clears the filter
  const toggleFilter = (f: "corrected" | "pending") => {
    setStatusFilter((prev) => (prev === f ? null : f));
  };

  // ── Import state ────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<Array<Omit<QueryRow, "id">> | null>(null);
  const [importing, setImporting] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseWorkbook(file);
      if (rows.length === 0) {
        toast.error("No valid data rows found in the file.");
      } else {
        setImportPreview(rows);
      }
    } catch {
      toast.error("Could not parse the file. Please use the CAFlow template.");
    }
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const confirmImport = () => {
    if (!importPreview) return;
    setImporting(true);
    bulkAddQueries(importPreview);
    toast.success(`${importPreview.length} ${importPreview.length === 1 ? "query" : "queries"} imported successfully.`);
    setImportPreview(null);
    setImporting(false);
  };

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* ══════════ PAGE HEADER ══════════ */}
      <div className="bg-orange-600 text-white px-6 py-4 space-y-0.5">
        <div className="flex items-center gap-2">
          <MessageSquareWarning size={18} />
          <span className="text-base font-semibold tracking-wide">
            {data.firmName || "CA Firm"}
          </span>
        </div>
        <p className="text-[13px] font-bold opacity-95 tracking-widest uppercase">
          Query of Client
          {data.clientName ? ` — ${data.clientName}` : ""}
        </p>
      </div>

      {/* ══════════ SUB-HEADER (Add + counts + search + Save) ══════════ */}
      <div className="border-b bg-muted/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
            onClick={() => { addQuery(); setConfirmDeleteId(null); }}
          >
            <Plus size={12} />
            Add New Query
          </Button>
          <span className="text-xs text-muted-foreground">
            {queries.length === 0
              ? "No queries yet"
              : `${queries.length} ${queries.length === 1 ? "query" : "queries"}`}
          </span>
          {queries.length > 0 && (
            <>
              {/* ── Clickable filter badges ── */}
              <button
                type="button"
                title="Click to filter corrected queries"
                onClick={() => toggleFilter("corrected")}
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer select-none",
                  statusFilter === "corrected"
                    ? "bg-green-600 text-white ring-2 ring-green-500 ring-offset-1"
                    : "bg-green-100 text-green-700 hover:bg-green-200"
                )}
              >
                {queries.filter(q => q.correction_status === "Yes").length} corrected
              </button>
              {pendingCount > 0 && (
                <button
                  type="button"
                  title="Click to filter pending queries"
                  onClick={() => toggleFilter("pending")}
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer select-none",
                    statusFilter === "pending"
                      ? "bg-red-600 text-white ring-2 ring-red-500 ring-offset-1"
                      : "bg-red-100 text-red-700 hover:bg-red-200"
                  )}
                >
                  {pendingCount} pending
                </button>
              )}
              {/* Clear filter chip */}
              {statusFilter && (
                <button
                  type="button"
                  onClick={() => setStatusFilter(null)}
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  title="Clear filter"
                >
                  <X size={10} /> clear filter
                </button>
              )}
            </>
          )}

          {/* ── Search input ── */}
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Search queries…"
              className="h-7 pl-6 pr-6 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-44"
            />
            {searchText && (
              <button
                type="button"
                onClick={() => setSearchText("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={10} />
              </button>
            )}
          </div>
          {/* Active filter indicator */}
          {(statusFilter || searchText) && (
            <span className="text-[10px] text-muted-foreground">
              {displayedQueries.length} of {queries.length} shown
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Export Excel */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-7 text-xs border-green-600 text-green-700 hover:bg-green-50"
            onClick={() => exportToExcel(queries, data.clientName, data.financialYear)}
            disabled={queries.length === 0}
            title="Export all queries to Excel"
          >
            <FileSpreadsheet size={12} />
            Export Excel
          </Button>

          {/* Import Excel */}
          <div className="flex flex-col items-center">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 h-7 text-xs border-[#1A2744] text-[#1A2744] hover:bg-[#1A2744]/5"
              onClick={() => fileInputRef.current?.click()}
              title="Import queries from Excel"
            >
              <Upload size={12} />
              Import Excel
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Save */}
          <Button
            size="sm"
            className="gap-1 h-7 text-xs bg-orange-600 hover:bg-orange-700"
            onClick={async () => { await manualSave(); onSaved?.(); }}
            disabled={saving}
          >
            {saving
              ? <Loader2 size={12} className="animate-spin" />
              : <Save    size={12} />
            }
            Save
          </Button>
        </div>
      </div>

      {/* ── Download Template link ── */}
      <div className="border-b bg-muted/10 px-4 py-1.5 flex items-center gap-1">
        <Download size={11} className="text-muted-foreground" />
        <button
          type="button"
          className="text-[11px] text-primary underline underline-offset-2 hover:text-primary/80"
          onClick={downloadTemplate}
        >
          Download blank import template (QuerySheet_Template_CAFlow.xlsx)
        </button>
      </div>

      {/* ══════════ TABLE ══════════ */}
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[920px]">
          <thead>
            <tr className="bg-orange-600 text-white text-[11px] uppercase tracking-wide">
              <th className="border border-orange-500 px-2 py-2.5 text-center w-12">Sr.</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[130px]">Group/Subgroup</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[140px]">Ledger</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[190px]">Query Description</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[150px]">Required Documents</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[130px]">Remark</th>
              <th className="border border-orange-500 px-2 py-2.5 text-center min-w-[120px]">Correction Status</th>
              <th className="border border-orange-500 px-2 py-2.5 text-center w-16">Del</th>
            </tr>
          </thead>
          <tbody>
            {queries.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="border border-border py-12 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <MessageSquareWarning size={28} className="text-muted-foreground/40" />
                    <span className="text-sm">No queries yet.</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 h-7 text-xs"
                      onClick={addQuery}
                    >
                      <Plus size={12} /> Add First Query
                    </Button>
                  </div>
                </td>
              </tr>
            ) : displayedQueries.length === 0 ? (
              <tr>
                <td colSpan={8} className="border border-border py-8 text-center text-muted-foreground text-sm">
                  No queries match the current filter
                  {(statusFilter || searchText) && (
                    <button
                      type="button"
                      onClick={() => { setStatusFilter(null); setSearchText(""); }}
                      className="ml-2 text-primary underline text-xs"
                    >
                      clear filters
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              displayedQueries.map((row, idx) => {
                const isDone = row.correction_status === "Yes";

                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "align-top transition-colors",
                      isDone
                        ? "bg-green-50/70 hover:bg-green-50"
                        : "bg-red-50/60   hover:bg-red-50"
                    )}
                  >
                    {/* Sr No */}
                    <td className="border border-border px-2 py-2 text-center align-middle">
                      <span className="text-xs font-mono text-muted-foreground">
                        {idx + 1}
                      </span>
                    </td>

                    {/* Group/Subgroup */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input
                        className="h-7 text-xs w-full"
                        placeholder="Group/Subgroup…"
                        value={row.head}
                        onChange={e => updateQuery(row.id, "head", e.target.value)}
                      />
                    </td>

                    {/* Ledger */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input
                        className="h-7 text-xs w-full"
                        placeholder="Ledger…"
                        value={row.particulars}
                        onChange={e => updateQuery(row.id, "particulars", e.target.value)}
                      />
                    </td>

                    {/* Query Description — textarea for longer text */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Textarea
                        rows={2}
                        className="text-xs resize-none w-full min-h-[52px]"
                        placeholder="Describe the query…"
                        value={row.query_description}
                        onChange={e => updateQuery(row.id, "query_description", e.target.value)}
                      />
                    </td>

                    {/* Required Documents */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input
                        className="h-7 text-xs w-full"
                        placeholder="Documents needed…"
                        value={row.required_documents}
                        onChange={e => updateQuery(row.id, "required_documents", e.target.value)}
                      />
                    </td>

                    {/* Remark */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input
                        className="h-7 text-xs w-full"
                        placeholder="Remark…"
                        value={row.remark}
                        onChange={e => updateQuery(row.id, "remark", e.target.value)}
                      />
                    </td>

                    {/* Correction Status */}
                    <td className="border border-border px-2 py-2 align-middle">
                      <CorrectionSelect
                        value={row.correction_status}
                        onChange={v => updateQuery(row.id, "correction_status", v)}
                      />
                      <p className={cn(
                        "text-[10px] mt-0.5 font-medium text-center",
                        isDone                           && "text-green-700",
                        row.correction_status === "No"  && "text-red-700",
                        row.correction_status === ""    && "text-orange-600"
                      )}>
                        {isDone                           ? "✓ Corrected"
                          : row.correction_status === "No"  ? "✗ Not corrected"
                          : "⏳ Pending"}
                      </p>
                    </td>

                    {/* Delete */}
                    <td className="border border-border px-2 py-2 align-middle text-center">
                      {confirmDeleteId === row.id ? (
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 text-[10px] px-1 w-full"
                            onClick={() => {
                              deleteQuery(row.id);
                              setConfirmDeleteId(null);
                            }}
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] px-1 w-full"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                          onClick={() => setConfirmDeleteId(row.id)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ══════════ FOOTER ══════════ */}
      <div className="border-t bg-muted/20 px-4 py-2 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {allCorrected
            ? queries.length === 0
              ? "No queries — pipeline unblocked"
              : `✓ All ${queries.length} ${queries.length === 1 ? "query" : "queries"} corrected`
            : `${pendingCount} of ${queries.length} pending correction`
          }
        </p>
        {saving && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> Auto-saving…
          </p>
        )}
      </div>

      {/* ══════════ IMPORT PREVIEW MODAL ══════════ */}
      <Dialog open={!!importPreview} onOpenChange={() => setImportPreview(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload size={16} className="text-[#1A2744]" />
              Import Queries Preview
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground px-1">
            You are about to import{" "}
            <span className="font-semibold text-foreground">{importPreview?.length}</span>{" "}
            {(importPreview?.length ?? 0) === 1 ? "query" : "queries"}.{" "}
            Existing queries will <strong>not</strong> be deleted.
          </p>

          {/* Preview table — first 5 rows */}
          <div className="overflow-auto rounded border flex-1 min-h-0">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/60">
                  {["#", "Group/Subgroup", "Ledger", "Query Description", "Correction Status"].map(h => (
                    <TableHead key={h} className="text-xs py-2">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(importPreview ?? []).slice(0, 5).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="w-8 text-center text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="max-w-[100px] truncate">{r.head || "—"}</TableCell>
                    <TableCell className="max-w-[120px] truncate">{r.particulars || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{r.query_description || "—"}</TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "text-[10px]",
                          r.correction_status === "Yes" && "bg-green-100 text-green-700",
                          r.correction_status === "No"  && "bg-red-100 text-red-700",
                          !r.correction_status          && "bg-orange-100 text-orange-700",
                        )}
                      >
                        {r.correction_status || "Pending"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(importPreview?.length ?? 0) > 5 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-2 text-xs">
                      … and {(importPreview?.length ?? 0) - 5} more rows
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setImportPreview(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-[#1A2744] hover:bg-[#1A2744]/90 text-white gap-1.5"
              onClick={confirmImport}
              disabled={importing}
            >
              {importing
                ? <Loader2 size={13} className="animate-spin" />
                : <Upload size={13} />
              }
              Import All ({importPreview?.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
