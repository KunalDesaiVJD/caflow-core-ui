/**
 * ClauseExcelDialog — import an edited clause table back from Excel.
 *
 * Parses the uploaded workbook against the clause's column schema, shows a
 * validation report + add/replace preview, and only writes into the clause on
 * confirm. Export is a direct action on the panel; this dialog is import-only.
 */

import { useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { ClauseDefinition } from "@/data/form3cd-master";
import { collectClauseTables, setTableRows, type ClauseTable } from "@/lib/form3cd/clauseTables";
import { parseClauseXlsx, type ParseResult } from "@/lib/form3cd/excel";

export default function ClauseExcelDialog({
  open, onClose, definition, value, onChange,
}: {
  open: boolean;
  onClose: () => void;
  definition: ClauseDefinition;
  value: any;
  onChange: (next: any) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const tables = useMemo(() => collectClauseTables(definition, value), [definition, value]);
  const [tableId, setTableId] = useState<string>(tables[0]?.id ?? "");
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const activeTable: ClauseTable | undefined = useMemo(
    () => tables.find((t) => t.id === tableId) || tables[0],
    [tables, tableId],
  );

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeTable) return;
    setFileName(file.name);
    try {
      const res = await parseClauseXlsx(file, activeTable.columns);
      setResult(res);
    } catch (err: any) {
      toast.error("Could not read file: " + (err?.message || "unknown error"));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function commit() {
    if (!result || !activeTable) return;
    if (result.errors.length > 0) {
      toast.error("Fix the errors before importing.");
      return;
    }
    const finalRows = mode === "append" ? [...activeTable.rows, ...result.rows] : result.rows;
    const srCol = activeTable.columns.find((c) => c.key === "sr_no" && c.type === "readonly");
    if (srCol) finalRows.forEach((r, i) => { r.sr_no = String(i + 1); });
    onChange(setTableRows(value, activeTable.path, finalRows));
    toast.success(`Imported ${result.rows.length} row(s) into Clause ${definition.clauseNo.replace("_", "-")}`);
    setResult(null);
    onClose();
  }

  const currentCount = activeTable?.rows.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setResult(null); onClose(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Excel — Clause {definition.clauseNo.replace("_", "-")}</DialogTitle>
          <DialogDescription>
            Upload the workbook you exported and edited. Rows are validated against this clause before import.
          </DialogDescription>
        </DialogHeader>

        {tables.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Target table:</span>
            <Select value={activeTable?.id} onValueChange={(v) => { setTableId(v); setResult(null); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {tables.map((t) => <SelectItem key={t.id} value={t.id} className="text-xs">{t.label.slice(0, 70)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Choose file
          </Button>
          {fileName && <span className="text-xs text-muted-foreground truncate">{fileName}</span>}
        </div>

        {result && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{result.rows.length} valid row(s) parsed</Badge>
              <Badge variant="outline">Currently {currentCount} row(s)</Badge>
              {result.errors.length > 0
                ? <Badge variant="destructive">{result.errors.length} error(s)</Badge>
                : <Badge className="bg-green-100 text-green-800">No errors</Badge>}
              {result.warnings.length > 0 && <Badge className="bg-amber-100 text-amber-800">{result.warnings.length} warning(s)</Badge>}
            </div>

            <div className="flex gap-2">
              <Button variant={mode === "replace" ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setMode("replace")}>
                Replace all ({currentCount} → {result.rows.length})
              </Button>
              <Button variant={mode === "append" ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setMode("append")}>
                Append ({currentCount} + {result.rows.length})
              </Button>
            </div>

            {(result.errors.length > 0 || result.warnings.length > 0) && (
              <ScrollArea className="h-40 rounded border p-2">
                <div className="space-y-1 text-xs">
                  {result.errors.map((e, i) => (
                    <div key={`e${i}`} className="flex items-start gap-1.5 text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>{e}</span>
                    </div>
                  ))}
                  {result.warnings.map((w, i) => (
                    <div key={`w${i}`} className="flex items-start gap-1.5 text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>{w}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            {result.errors.length === 0 && result.warnings.length === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-green-700">
                <CheckCircle2 className="h-4 w-4" /> All rows valid and ready to import.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { setResult(null); onClose(); }}>Cancel</Button>
          <Button onClick={commit} disabled={!result || result.errors.length > 0}>Import rows</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
