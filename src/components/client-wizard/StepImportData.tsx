import { useState, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, CheckCircle2 } from "lucide-react";
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
}

export const StepImportData = ({ data, onChange, onSkip }: Props) => {
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<any>(ws);
        if (jsonData.length === 0) {
          setError("The file appears to be empty.");
          return;
        }
        const headers = Object.keys(jsonData[0]);
        onChange({ filename: file.name, rows: jsonData, headers });
      } catch {
        setError("Failed to parse the file. Ensure it's a valid Excel or CSV file.");
      }
    };
    reader.readAsArrayBuffer(file);
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
            <span className="text-muted-foreground">— {data.rows.length} rows found</span>
          </div>
          {/* Preview first 5 rows */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border">
              <thead>
                <tr className="bg-muted">
                  {data.headers.slice(0, 6).map((h) => (
                    <th key={h} className="px-2 py-1 text-left font-medium border-b">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-b">
                    {data.headers.slice(0, 6).map((h) => (
                      <td key={h} className="px-2 py-1">{String(row[h] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" onClick={() => { onChange(null); if (fileRef.current) fileRef.current.value = ""; }}>
            Remove & Re-upload
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <button onClick={onSkip} className="text-sm text-muted-foreground underline hover:text-foreground transition-colors">
        Skip for now — I'll import later
      </button>
    </div>
  );
};
