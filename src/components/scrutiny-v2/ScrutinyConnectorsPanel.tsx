/**
 * Manual-upload connectors panel (v2 behind the flag).
 *
 * Upload a GST-2B / 26AS / bank export (CSV, Excel, PDF or Word); we parse it and reconcile it
 * against the client's books. ROOT-CAUSE FIX: the book side now comes from the LIVE Tally Sync
 * tables (tally_vouchers + tally_trial_balance, keyed by client_id + financial_year — the same data
 * the scrutiny engine uses), falling back to a trial_balance_snapshots import. Previously it read
 * ONLY the snapshot, so Tally-synced clients had an empty book side and everything showed as
 * unmatched. The last reconciliation is persisted per client/FY/connector in localStorage, so it
 * survives tab switches and page refreshes instead of disappearing.
 */

import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Info, Loader2, Database } from "lucide-react";
import { tbFromTallyTB, tbFromSnapshot, vouchersFromSnapshot } from "@/lib/scrutiny/adapters";
import { reconcile, entriesFromVouchers, entriesFromTB, entriesFromRows, entriesFromText, type ReconResult, type ReconEntry } from "@/lib/scrutiny/reconcile";

interface Props {
  clientId: string;
  financialYear: string;
  engagementId?: string | null;
}

interface BookData {
  entries: ReconEntry[];
  source: "tally_sync" | "snapshot" | "none";
  vouchers: number;
  ledgers: number;
}

const CONNECTORS = [
  { id: "gst2b", label: "GST-2B" },
  { id: "26as", label: "Form 26AS" },
  { id: "bank", label: "Bank statement" },
];

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

async function parseFile(file: File): Promise<Record<string, unknown>[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv" || ext === "txt") {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data as Record<string, unknown>[]),
        error: reject,
      });
    });
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];
}

// PDF text extraction (pdfjs). Reconstructs lines from text-item Y positions so amounts keep their
// row context. pdfjs (heavy) is dynamically imported so it only loads when a PDF is actually opened.
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist") as unknown as {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string; transform?: number[] }[] }> }> }> };
  };
  try {
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch { /* worker url resolution is best-effort */ }
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    for (const it of content.items) {
      const y = it.transform?.[5];
      if (lastY !== null && typeof y === "number" && Math.abs(y - lastY) > 2) text += "\n";
      text += (it.str ?? "") + " ";
      if (typeof y === "number") lastY = y;
    }
    text += "\n";
  }
  return text;
}

// Word (.docx) text extraction (mammoth, dynamically imported).
async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth") as unknown as { extractRawText: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
  const buf = await file.arrayBuffer();
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  return res.value ?? "";
}

export default function ScrutinyConnectorsPanel({ clientId, financialYear, engagementId }: Props) {
  const [connector, setConnector] = useState("bank");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ReconResult | null>(null);
  const [savedSource, setSavedSource] = useState<BookData["source"] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<BookData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const storageKey = (c: string) => `caflow_scrutiny_conn_${clientId}_${financialYear}_${c}`;

  // Restore the last reconciliation for this client/FY/connector (survives tab switch + refresh).
  useEffect(() => {
    setError(null);
    try {
      const raw = localStorage.getItem(storageKey(connector));
      if (raw) {
        const saved = JSON.parse(raw) as { fileName?: string; result?: ReconResult; source?: BookData["source"] };
        setResult(saved.result ?? null);
        setFileName(saved.fileName ?? "");
        setSavedSource(saved.source ?? null);
        return;
      }
    } catch { /* ignore corrupt storage */ }
    setResult(null);
    setFileName("");
    setSavedSource(null);
  }, [connector, clientId, financialYear]);

  const persist = (c: string, payload: { fileName: string; result: ReconResult; source: BookData["source"] }) => {
    try {
      localStorage.setItem(storageKey(c), JSON.stringify(payload));
    } catch {
      /* quota exceeded — result still shows in-session, just not persisted */
    }
  };

  // Page through a firm-scoped tally_* table with a given filter (RLS-scoped to the caller).
  const pageFetch = async (table: string, filter: (q: any) => any): Promise<Record<string, unknown>[]> => {
    const PAGE = 1000;
    const out: Record<string, unknown>[] = [];
    for (let from = 0; from < 30000; from += PAGE) {
      const { data, error: err } = await filter((supabase.from as any)(table).select("*")).range(from, from + PAGE - 1);
      if (err || !data || data.length === 0) break;
      out.push(...(data as Record<string, unknown>[]));
      if (data.length < PAGE) break;
    }
    return out;
  };

  // Load a tally_* table robustly: try client_id + engagement_id (the key Tally Sync writes under),
  // and if the selected engagement is stale / missing / mismatched, fall back to client_id +
  // financial_year. Always scoped to client_id (and firm-scoped by RLS).
  const fetchAllByClientYear = async (table: string): Promise<Record<string, unknown>[]> => {
    if (engagementId) {
      const byEng = await pageFetch(table, (q) => q.eq("client_id", clientId).eq("engagement_id", engagementId));
      if (byEng.length > 0) return byEng;
    }
    return await pageFetch(table, (q) => q.eq("client_id", clientId).eq("financial_year", financialYear));
  };

  // Lazily load the book side once (on first upload). Tally Sync first, snapshot fallback.
  const loadBook = async (): Promise<BookData> => {
    if (book) return book;
    let loaded: BookData = { entries: [], source: "none", vouchers: 0, ledgers: 0 };
    try {
      const ttb = await fetchAllByClientYear("tally_trial_balance");
      if (ttb.length > 0) {
        const tv = await fetchAllByClientYear("tally_vouchers");
        const vEntries = entriesFromVouchers(vouchersFromSnapshot(tv as never[]));
        const tbEntries = entriesFromTB(tbFromTallyTB(ttb as never[]));
        loaded = { entries: [...vEntries, ...tbEntries], source: "tally_sync", vouchers: tv.length, ledgers: ttb.length };
      } else {
        const { data } = await (supabase.from as any)("trial_balance_snapshots")
          .select("raw_data, normalised_data")
          .eq("client_id", clientId).eq("financial_year", financialYear).maybeSingle();
        if (data) {
          const vEntries = Array.isArray(data.raw_data) ? entriesFromVouchers(vouchersFromSnapshot(data.raw_data as never[])) : [];
          const tbEntries = Array.isArray(data.normalised_data) ? entriesFromTB(tbFromSnapshot(data.normalised_data as never[])) : [];
          loaded = { entries: [...vEntries, ...tbEntries], source: "snapshot", vouchers: vEntries.length, ledgers: tbEntries.length };
        }
      }
    } catch { /* leave as none */ }
    setBook(loaded);
    return loaded;
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setParsing(true); setError(null); setResult(null); setFileName(file.name);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let external: ReconEntry[];
      if (ext === "pdf") {
        external = entriesFromText(await extractPdfText(file), "amount");
      } else if (ext === "docx" || ext === "doc") {
        external = entriesFromText(await extractDocxText(file), "amount");
      } else {
        external = entriesFromRows(await parseFile(file), "amount");
      }
      if (external.length === 0) {
        setError(
          ext === "pdf" || ext === "docx" || ext === "doc"
            ? "No amounts could be read from this document. If it is a scanned/image PDF, export a text, CSV or Excel version instead."
            : "Could not find an amount column. Expected a header like Amount / Invoice Value / Taxable Value / Amount Credited."
        );
      } else {
        const b = await loadBook();
        const res = reconcile(external, b.entries);
        setResult(res);
        setSavedSource(b.source);
        persist(connector, { fileName: file.name, result: res, source: b.source });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse the file.");
    }
    setParsing(false);
  };

  const renderList = (title: string, entries: { amount: number; label: string }[], tone: "amber" | "muted") => (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <Badge variant={tone === "amber" ? "destructive" : "secondary"} className="text-xs">{entries.length}</Badge>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Detail</TableHead><TableHead className="w-32 text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {entries.slice(0, 50).map((x, i) => (
                <TableRow key={i}><TableCell className="text-sm truncate max-w-[360px]">{x.label || "—"}</TableCell><TableCell className="text-right text-sm">{inr(x.amount)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
          {entries.length > 50 && <div className="px-3 py-2 text-xs text-muted-foreground">Showing top 50 of {entries.length}.</div>}
        </div>
      )}
    </div>
  );

  const effectiveSource = book?.source ?? savedSource;

  return (
    <div className="space-y-5">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info size={12} /> Upload a GST-2B, 26AS or bank export (CSV, Excel, PDF or Word) to reconcile against the books. The book side is read from live <strong>Tally Sync</strong> (vouchers + ledger balances), falling back to an imported trial balance. Processed in your browser only — nothing is stored server-side; the last result is remembered on this device. PDF/Word are read as text; v1 matches by amount (a first-pass check).
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border overflow-hidden">
          {CONNECTORS.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setConnector(c.id)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${i < CONNECTORS.length - 1 ? "border-r" : ""} ${connector === c.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.txt,.pdf,.docx,.doc" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={parsing}>
          {parsing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          {parsing ? "Reconciling…" : "Choose file"}
        </Button>
        {fileName && <span className="text-xs text-muted-foreground truncate max-w-[240px]">{fileName}</span>}
      </div>

      {effectiveSource && effectiveSource !== "none" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Database size={12} /> Book side: <strong className="text-foreground">{effectiveSource === "tally_sync" ? "Tally Sync" : "Trial-balance snapshot"}</strong>
          {book && effectiveSource === "tally_sync" && <span>· {book.vouchers.toLocaleString("en-IN")} vouchers · {book.ledgers.toLocaleString("en-IN")} ledgers</span>}
        </p>
      )}

      {effectiveSource === "none" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2">
          <Info size={14} className="mt-0.5 shrink-0" /><span>No book data found for this client/year — neither Tally Sync nor a trial-balance snapshot. Run Tally Sync first; until then the uploaded file will show as entirely unmatched.</span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">{error}</div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="border-green-400/30"><CardContent className="p-4 text-center"><p className="text-xs text-green-600">Matched</p><p className="text-2xl font-bold text-green-600">{result.matched.length}</p><p className="text-[11px] text-muted-foreground">{inr(result.matchedTotal)}</p></CardContent></Card>
            <Card className="border-amber-400/30"><CardContent className="p-4 text-center"><p className="text-xs text-amber-600">In file, not booked</p><p className="text-2xl font-bold text-amber-600">{result.onlyExternal.length}</p><p className="text-[11px] text-muted-foreground">of {inr(result.externalTotal)}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">In books, not in file</p><p className="text-2xl font-bold text-foreground">{result.onlyBook.length}</p><p className="text-[11px] text-muted-foreground">of {inr(result.bookTotal)}</p></CardContent></Card>
          </div>
          {renderList("In the file but not booked", result.onlyExternal, "amber")}
          {renderList("In the books but not in the file", result.onlyBook, "muted")}
        </>
      )}
    </div>
  );
}
