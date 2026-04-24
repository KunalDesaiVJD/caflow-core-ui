import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, CheckCircle2, Shield, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import * as XLSX from "xlsx";

export interface ImportDataResult {
  filename: string;
  rows: any[];
  headers: string[];
}

interface Props {
  data: ImportDataResult | null;
  onChange: (d: ImportDataResult | null) => void;
  onSkip: () => void;
  clientId?: string | null;
  firmId?: string | null;
  onScrutinyComplete?: (summary: { total: number; high: number }) => void;
}

/** Clean a cell value to a number, stripping commas, Cr/Dr suffixes */
function parseNumeric(val: any): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).trim();
  if (!s) return 0;
  const cleaned = s.replace(/,/g, "").replace(/\s*(Cr|Dr|cr|dr|CR|DR)\s*$/i, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

const METADATA_PATTERN = /[@]|www\.|CIN:|GSTIN|^\d{6,}$|L\d{5}/;
const SECTION_HEADER_PATTERNS = /^(trial balance|share\s*holder\s*funds?|loans?\s*\(liability\)|capital account|current liabilities|current assets|fixed assets|investments|direct\s*(income|expense)|indirect\s*(income|expense)|purchase\s*accounts?|sales\s*accounts?|branch\s*\/\s*divisions?|closing stock|opening stock|suspense\s*a\/c|profit\s*&\s*loss\s*a\/c|difference in opening|income|expenditure)$/i;

function detectAndParse(ws: XLSX.WorkSheet): { headers: string[]; rows: any[] } {
  const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  let headerIdx = -1;
  let colMap: Record<string, number> = {};

  for (let i = 0; i < allRows.length; i++) {
    const cells = allRows[i].map((c: any) => String(c).trim().toLowerCase());
    const partIdx = cells.findIndex(c => c.includes("particulars") || c === "account name" || c === "ledger name");
    const debitIdx = cells.findIndex(c => c === "debit" || c.includes("debit"));
    const creditIdx = cells.findIndex(c => c === "credit" || c.includes("credit"));
    const closingBalIdx = cells.findIndex(c => c.includes("closing") && c.includes("balance"));
    const balIdx = closingBalIdx >= 0 ? closingBalIdx : cells.findIndex(c => c === "balance");

    if (partIdx >= 0 && (debitIdx >= 0 || creditIdx >= 0 || balIdx >= 0)) {
      headerIdx = i;
      colMap.account = partIdx;
      colMap.debit = debitIdx >= 0 ? debitIdx : -1;
      colMap.credit = creditIdx >= 0 ? creditIdx : -1;
      colMap.balance = balIdx >= 0 ? balIdx : -1;
      break;
    }
  }

  if (headerIdx === -1) {
    headerIdx = 0;
    colMap = { account: 0, debit: -1, credit: -1, balance: -1 };
    const first = allRows[0]?.map((c: any) => String(c).trim().toLowerCase()) || [];
    first.forEach((c, idx) => {
      if (c.includes("debit")) colMap.debit = idx;
      if (c.includes("credit")) colMap.credit = idx;
      if (c.includes("balance") || c.includes("closing")) colMap.balance = idx;
      if (c.includes("particular") || c.includes("account") || c.includes("ledger")) colMap.account = idx;
    });
  }

  const dataRows = allRows.slice(headerIdx + 1);
  const parsed: any[] = [];
  let consecutiveEmpty = 0;

  for (const row of dataRows) {
    const accountName = String(row[colMap.account] ?? "").trim();
    const debit = colMap.debit >= 0 ? parseNumeric(row[colMap.debit]) : 0;
    const credit = colMap.credit >= 0 ? parseNumeric(row[colMap.credit]) : 0;
    const balance = colMap.balance >= 0 ? parseNumeric(row[colMap.balance]) : 0;

    if (!accountName && debit === 0 && credit === 0 && balance === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) break;
      continue;
    }
    consecutiveEmpty = 0;
    if (!accountName) continue;
    if (METADATA_PATTERN.test(accountName)) continue;
    if (debit === 0 && credit === 0 && balance === 0 && SECTION_HEADER_PATTERNS.test(accountName)) continue;
    if (debit === 0 && credit === 0 && balance === 0) continue;

    parsed.push({ account_name: accountName, debit, credit, balance });
  }

  return { headers: ["account_name", "debit", "credit", "balance"], rows: parsed };
}

export const StepImportData = ({ data, onChange, onSkip, clientId, firmId, onScrutinyComplete }: Props) => {
  const [error, setError] = useState<string | null>(null);
  const [scrutinyRunning, setScrutinyRunning] = useState(false);
  const [scrutinySummary, setScrutinySummary] = useState<{ total: number; high: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setScrutinySummary(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const { headers, rows } = detectAndParse(ws);

        if (rows.length === 0) {
          setError("No ledger entries detected in uploaded file. Please check the file format.");
          return;
        }
        onChange({ filename: file.name, rows, headers });
      } catch {
        setError("Unable to read file. Please upload a valid trial balance export.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleRunScrutiny = async () => {
    if (!clientId || !data) return;
    setScrutinyRunning(true);
    try {
      // Import supabase here to avoid circular deps
      const { supabase } = await import("@/integrations/supabase/client");

      // trial_balance_snapshots removed — Tally Sync is the only TB source.
      // This wizard step no longer saves TB data; scrutiny runs via Tally TB.
      // Keeping the scrutiny trigger below so the wizard flow still works.

      // Then run scrutiny
      const { data: result, error } = await supabase.functions.invoke("run-scrutiny", {
        body: { client_id: clientId, financial_year: new Date().getFullYear().toString(), firm_id: firmId },
      });
      if (error) throw error;

      const total = result?.total || 0;
      const high = result?.findings_created?.HIGH || 0;
      setScrutinySummary({ total, high });
      onScrutinyComplete?.({ total, high });
    } catch (e: any) {
      setError("Scrutiny failed: " + (e.message || "Unknown error"));
    } finally {
      setScrutinyRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-foreground">Step 6 — Import Data</h2>
      <p className="text-sm text-muted-foreground">Upload a Trial Balance or ledger export (.xlsx, .xls, .csv) to pre-populate data.</p>

      {!data ? (
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 transition-colors"
        >
          <Upload className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Click to upload file</p>
          <p className="text-xs text-muted-foreground">.xlsx, .xls, .csv supported</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
        </div>
      ) : (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <FileSpreadsheet className="h-4 w-4" />
            <span className="font-medium">{data.filename}</span>
            <span className="text-muted-foreground">— {data.rows.length} ledger entries found</span>
          </div>
          {/* Preview first 10 rows */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border">
              <thead>
                <tr className="bg-muted">
                  <th className="px-2 py-1 text-left font-medium border-b">Account Name</th>
                  <th className="px-2 py-1 text-right font-medium border-b">Debit</th>
                  <th className="px-2 py-1 text-right font-medium border-b">Credit</th>
                  <th className="px-2 py-1 text-right font-medium border-b">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1">{row.account_name}</td>
                    <td className="px-2 py-1 text-right font-mono">{row.debit ? row.debit.toLocaleString("en-IN") : "—"}</td>
                    <td className="px-2 py-1 text-right font-mono">{row.credit ? row.credit.toLocaleString("en-IN") : "—"}</td>
                    <td className="px-2 py-1 text-right font-mono">{row.balance ? row.balance.toLocaleString("en-IN") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length > 10 && (
              <p className="text-xs text-muted-foreground mt-1">Showing 10 of {data.rows.length} entries</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { onChange(null); setScrutinySummary(null); if (fileRef.current) fileRef.current.value = ""; }}>
              Remove & Re-upload
            </Button>

            {/* Run Initial Scrutiny Button */}
            {clientId && (
              <Button
                size="sm"
                variant="default"
                className="gap-1"
                onClick={handleRunScrutiny}
                disabled={scrutinyRunning}
              >
                {scrutinyRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
                {scrutinyRunning ? "Running Scrutiny…" : "Run Initial Scrutiny"}
              </Button>
            )}
          </div>

          {/* Scrutiny Summary */}
          {scrutinySummary && (
            <div className="border border-primary/20 bg-primary/5 rounded-lg p-3 space-y-1">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Initial Scrutiny Complete
              </p>
              <p className="text-xs text-muted-foreground">
                Found <span className="font-semibold text-foreground">{scrutinySummary.total}</span> findings
                {scrutinySummary.high > 0 && (
                  <> (<Badge variant="destructive" className="text-[10px] px-1 py-0 ml-1">{scrutinySummary.high} HIGH</Badge>)</>
                )}. You can review them after setup is complete.
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <button onClick={onSkip} className="text-sm text-muted-foreground underline hover:text-foreground transition-colors">
        Skip for now — I'll import later
      </button>
    </div>
  );
};
