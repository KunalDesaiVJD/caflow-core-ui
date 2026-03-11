import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, ArrowRight, Upload, CheckCircle2, AlertTriangle, FileSpreadsheet, Info, Loader2,
} from "lucide-react";
import * as XLSX from "xlsx";

// ─── Constants ───
const FY_OPTIONS = ["2024-25", "2023-24", "2022-23", "2021-22"];
const SOFTWARE_OPTIONS = ["Tally Prime", "Tally ERP9", "Busy", "SAP", "Manual Excel"];

const SOFTWARE_INSTRUCTIONS: Record<string, string> = {
  "Tally Prime": "Gateway of Tally → Display More Reports → Account Books → Group Summary → Export → Excel. For detailed: Reports → Ledger Vouchers → Export all with narrations.",
  "Tally ERP9": "Reports → Account Books → Group Summary → Export → Excel format",
  "Busy": "Reports → Financial → Trial Balance → Detailed → Export Excel",
  "SAP": "FS10N or S_ALR_87012301 → Export Spreadsheet",
  "Manual Excel": "Download our template and fill in ledger data with columns: Ledger Name, Account Group, Opening Balance Dr, Opening Balance Cr, Closing Balance Dr, Closing Balance Cr.",
};

const TARGET_FIELDS = [
  { key: "ledger_name", label: "Ledger Name", required: true },
  { key: "account_group", label: "Account Group", required: true },
  { key: "opening_dr", label: "Opening Balance Dr", required: false },
  { key: "opening_cr", label: "Opening Balance Cr", required: false },
  { key: "closing_dr", label: "Closing Balance Dr", required: true },
  { key: "closing_cr", label: "Closing Balance Cr", required: true },
  { key: "narration", label: "Narration", required: false },
];

// Fuzzy matching keywords
const FUZZY_MAP: Record<string, string[]> = {
  ledger_name: ["ledger", "ledgername", "particulars", "account", "accountname", "name", "party"],
  account_group: ["group", "accountgroup", "grp", "category", "head", "under"],
  opening_dr: ["opendr", "openingdr", "opdr", "openbaldr", "openingbalancedr", "opbaldr"],
  opening_cr: ["opencr", "openingcr", "opcr", "openbalcr", "openingbalancecr", "opbalcr"],
  closing_dr: ["closedr", "closingdr", "cldr", "clsdr", "closingbalancedr", "clbaldr", "debit", "dr", "clsbaldr"],
  closing_cr: ["closecr", "closingcr", "clcr", "clscr", "closingbalancecr", "clbalcr", "credit", "cr", "clsbalcr"],
  narration: ["narration", "remarks", "description", "notes", "memo"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function autoDetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of TARGET_FIELDS) {
    const keywords = FUZZY_MAP[field.key];
    for (const header of headers) {
      const norm = normalize(header);
      if (keywords.some(k => norm.includes(k) || k.includes(norm))) {
        if (!Object.values(mapping).includes(header)) {
          mapping[field.key] = header;
          break;
        }
      }
    }
  }
  return mapping;
}

export default function ImportTrialBalance() {
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientsList, setClientsList] = useState<{ id: string; name: string | null }[]>([]);

  const clientId = routeClientId || selectedClientId;

  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);

  // Step 1
  const [fy, setFy] = useState("2024-25");
  const [software, setSoftware] = useState("Tally Prime");
  const [uploadType, setUploadType] = useState<"summary" | "detailed">("detailed");
  const [existingSnapshot, setExistingSnapshot] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(false);

  // Step 2
  const [parsedData, setParsedData] = useState<any[][]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState("");

  // Step 3
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Step 5
  const [importing, setImporting] = useState(false);
  const [comparativeAvailable, setComparativeAvailable] = useState(false);

  const firmId = user?.firm_id;

  // Load clients for selector when no route param
  useEffect(() => {
    if (routeClientId || !firmId) return;
    supabase.from("clients").select("id, name").eq("firm_id", firmId).order("name").then(({ data }) => {
      setClientsList(data || []);
    });
  }, [firmId, routeClientId]);

  // Guard: clientId must be a valid UUID
  const isValidUuid = clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId);

  // Check existing data when FY changes
  useEffect(() => {
    if (!clientId) return;
    setCheckingExisting(true);
    supabase
      .from("trial_balance_snapshots")
      .select("id")
      .eq("client_id", clientId)
      .eq("financial_year", fy)
      .then(({ data }) => {
        setExistingSnapshot((data || []).length > 0);
        setCheckingExisting(false);
      });
  }, [clientId, fy]);

  // Parse selected sheet
  const parseSheet = useCallback((wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    const jsonData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
    setParsedData(jsonData);
    // Detect headers from first non-empty row
    if (jsonData.length > 0) {
      const headerRow = jsonData[0].map((h: any) => String(h || "").trim());
      setHeaders(headerRow.filter(Boolean));
    }
  }, []);

  const handleFileDrop = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast({ title: "Invalid file type", description: "Please upload .xlsx, .xls or .csv", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 10MB allowed", variant: "destructive" });
      return;
    }
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      const wb = XLSX.read(data, { type: "array" });
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      setSelectedSheet(wb.SheetNames[0]);
      parseSheet(wb, wb.SheetNames[0]);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSheetChange = (name: string) => {
    setSelectedSheet(name);
    if (workbook) parseSheet(workbook, name);
  };

  const handleAutoDetect = () => {
    const detected = autoDetectMapping(headers);
    setMapping(prev => ({ ...prev, ...detected }));
    const count = Object.keys(detected).length;
    toast({ title: `Auto-detected ${count} of ${TARGET_FIELDS.length} columns` });
  };

  // Step 4: Compute mapped rows
  const mappedRows = useMemo(() => {
    if (parsedData.length < 2 || !mapping.ledger_name) return [];
    const headerRow = parsedData[0].map((h: any) => String(h || "").trim());
    const colIdx = (key: string) => {
      const header = mapping[key];
      return header ? headerRow.indexOf(header) : -1;
    };
    const rows: any[] = [];
    for (let i = 1; i < parsedData.length; i++) {
      const row = parsedData[i];
      const ledger = row[colIdx("ledger_name")];
      if (!ledger || String(ledger).trim() === "") continue;
      const parseNum = (v: any) => {
        if (v == null || v === "") return 0;
        const s = String(v).replace(/,/g, "").replace(/Cr|Dr/gi, "").trim();
        return parseFloat(s) || 0;
      };
      rows.push({
        ledger_name: String(ledger).trim(),
        account_group: row[colIdx("account_group")] ? String(row[colIdx("account_group")]).trim() : "",
        opening_dr: parseNum(row[colIdx("opening_dr")]),
        opening_cr: parseNum(row[colIdx("opening_cr")]),
        closing_dr: parseNum(row[colIdx("closing_dr")]),
        closing_cr: parseNum(row[colIdx("closing_cr")]),
        narration: row[colIdx("narration")] ? String(row[colIdx("narration")]).trim() : "",
      });
    }
    return rows;
  }, [parsedData, mapping]);

  const totalDr = mappedRows.reduce((s, r) => s + r.closing_dr, 0);
  const totalCr = mappedRows.reduce((s, r) => s + r.closing_cr, 0);
  const difference = Math.abs(totalDr - totalCr);
  const isBalanced = difference <= 1;

  // Group by account_group for review
  const groupedRows = useMemo(() => {
    const groups: Record<string, any[]> = {};
    mappedRows.forEach(r => {
      const g = r.account_group || "Ungrouped";
      if (!groups[g]) groups[g] = [];
      groups[g].push(r);
    });
    return groups;
  }, [mappedRows]);

  // Import
  const handleImport = async () => {
    if (!clientId) return;
    setImporting(true);
    try {
      // Check if snapshot exists for upsert
      const { data: existing } = await supabase
        .from("trial_balance_snapshots")
        .select("id")
        .eq("client_id", clientId)
        .eq("financial_year", fy);

      const payload = {
        client_id: clientId,
        financial_year: fy,
        raw_data: parsedData as any,
        normalised_data: mappedRows as any,
        source_format: software,
      };

      if (existing && existing.length > 0) {
        const { error } = await supabase
          .from("trial_balance_snapshots")
          .update(payload as any)
          .eq("id", existing[0].id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("trial_balance_snapshots")
          .insert(payload as any);
        if (error) throw error;
      }

      // Check comparative
      const { data: allSnapshots } = await supabase
        .from("trial_balance_snapshots")
        .select("financial_year")
        .eq("client_id", clientId);
      const years = (allSnapshots || []).map(s => s.financial_year);
      setComparativeAvailable(years.length > 1);

      toast({ title: `${mappedRows.length} ledgers imported successfully` });
      setStep(6); // Success state
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1: return fy && software;
      case 2: return parsedData.length > 1;
      case 3: {
        const requiredMapped = TARGET_FIELDS.filter(f => f.required).every(f => mapping[f.key]);
        return requiredMapped;
      }
      case 4: return mappedRows.length > 0;
      default: return true;
    }
  };

  const progress = step >= 6 ? 100 : ((step - 1) / 5) * 100;

  if (!isValidUuid) {
    return (
      <div className="p-8 text-center space-y-4">
        <h2 className="text-xl font-semibold">Invalid Client</h2>
        <p className="text-muted-foreground">No valid client ID provided. Please navigate from a client page.</p>
        <Button onClick={() => navigate("/clients")}>Go to Clients</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Import Trial Balance</h1>
          <p className="text-muted-foreground text-sm">Upload and map your trial balance data</p>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          {["Select Year", "Upload File", "Map Columns", "Review", "Import"].map((label, i) => (
            <span key={label} className={step > i + 1 ? "text-primary font-medium" : step === i + 1 ? "text-foreground font-semibold" : ""}>
              {label}
            </span>
          ))}
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* ─── STEP 1 ─── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Select Year and Format</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Financial Year</Label>
                <Select value={fy} onValueChange={setFy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Accounting Software</Label>
                <Select value={software} onValueChange={setSoftware}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOFTWARE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>What are you uploading?</Label>
              <RadioGroup value={uploadType} onValueChange={(v: any) => setUploadType(v)} className="flex flex-col gap-3">
                <div className="flex items-start gap-3 p-3 border rounded-lg">
                  <RadioGroupItem value="summary" id="summary" className="mt-0.5" />
                  <label htmlFor="summary" className="cursor-pointer">
                    <span className="text-sm font-medium text-foreground">Trial Balance Summary</span>
                    <p className="text-xs text-muted-foreground">Grouped totals by account head</p>
                  </label>
                </div>
                <div className="flex items-start gap-3 p-3 border rounded-lg border-primary/30 bg-primary/5">
                  <RadioGroupItem value="detailed" id="detailed" className="mt-0.5" />
                  <label htmlFor="detailed" className="cursor-pointer">
                    <span className="text-sm font-medium text-foreground">Detailed Ledger Vouchers</span>
                    <Badge className="ml-2 bg-primary/15 text-primary text-[10px]">Recommended</Badge>
                    <p className="text-xs text-muted-foreground">Enables AI narration checks for audit scrutiny</p>
                  </label>
                </div>
              </RadioGroup>
            </div>

            {/* Dynamic instructions */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle className="text-sm">Export Instructions — {software}</AlertTitle>
              <AlertDescription className="text-xs">{SOFTWARE_INSTRUCTIONS[software]}</AlertDescription>
            </Alert>

            {/* Existing data warning */}
            {existingSnapshot && (
              <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-sm text-amber-600">Data already exists</AlertTitle>
                <AlertDescription className="text-xs text-amber-600">
                  Trial balance already imported for {fy}. Continuing will replace existing data and re-run scrutiny.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── STEP 2 ─── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upload File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file && fileRef.current) {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  fileRef.current.files = dt.files;
                  fileRef.current.dispatchEvent(new Event("change", { bubbles: true }));
                }
              }}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">
                {fileName || "Click or drag and drop your file here"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls or .csv — Max 10MB</p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileDrop}
              />
            </div>

            {sheetNames.length > 1 && (
              <div className="space-y-2">
                <Label>Select Sheet</Label>
                <Select value={selectedSheet} onValueChange={handleSheetChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sheetNames.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {parsedData.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <FileSpreadsheet size={16} />
                  <span>{parsedData.length - 1} rows • {parsedData[0]?.length || 0} columns</span>
                </div>
                <div className="border rounded-lg overflow-auto max-h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {(parsedData[0] || []).map((h: any, i: number) => (
                          <TableHead key={i} className="text-xs whitespace-nowrap">{String(h || `Col ${i + 1}`)}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedData.slice(1, 11).map((row, ri) => (
                        <TableRow key={ri}>
                          {row.map((cell: any, ci: number) => (
                            <TableCell key={ci} className="text-xs py-1.5">{cell != null ? String(cell) : ""}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── STEP 3 ─── */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Map Columns</CardTitle>
              <Button variant="outline" size="sm" onClick={handleAutoDetect}>
                Auto-detect
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Detected headers as chips */}
            <div>
              <Label className="text-xs text-muted-foreground">Detected Headers</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {headers.map(h => {
                  const used = Object.values(mapping).includes(h);
                  return (
                    <Badge key={h} variant={used ? "default" : "outline"} className="text-xs">
                      {h}
                      {used && <CheckCircle2 size={12} className="ml-1" />}
                    </Badge>
                  );
                })}
              </div>
            </div>

            {/* Mapping selectors */}
            <div className="grid gap-3">
              {TARGET_FIELDS.map(field => (
                <div key={field.key} className="flex items-center gap-4">
                  <div className="w-48 text-sm">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </div>
                  <Select value={mapping[field.key] || ""} onValueChange={v => setMapping(prev => ({ ...prev, [field.key]: v }))}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── STEP 4 ─── */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Review and Balance Check</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Balance check */}
            {isBalanced ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle className="text-sm text-emerald-600">Trial balance balances ✓</AlertTitle>
                <AlertDescription className="text-xs text-emerald-600">
                  {mappedRows.length} ledgers • Dr: ₹{totalDr.toLocaleString("en-IN")} • Cr: ₹{totalCr.toLocaleString("en-IN")}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Trial balance does not balance</AlertTitle>
                <AlertDescription className="text-xs">
                  Difference: ₹{difference.toLocaleString("en-IN")} — Dr: ₹{totalDr.toLocaleString("en-IN")} • Cr: ₹{totalCr.toLocaleString("en-IN")}. Please check your export settings.
                </AlertDescription>
              </Alert>
            )}

            {/* Grouped table */}
            <div className="border rounded-lg overflow-auto max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Ledger Name</TableHead>
                    <TableHead className="text-xs">Account Group</TableHead>
                    <TableHead className="text-xs text-right">Closing Dr</TableHead>
                    <TableHead className="text-xs text-right">Closing Cr</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(groupedRows).map(([group, rows]) => (
                    <>
                      <TableRow key={`g-${group}`} className="bg-muted/50">
                        <TableCell colSpan={4} className="text-xs font-semibold text-foreground py-1.5">{group}</TableCell>
                      </TableRow>
                      {rows.map((r, i) => (
                        <TableRow key={`${group}-${i}`}>
                          <TableCell className="text-xs py-1.5">{r.ledger_name}</TableCell>
                          <TableCell className="text-xs py-1.5 text-muted-foreground">{r.account_group}</TableCell>
                          <TableCell className="text-xs py-1.5 text-right">{r.closing_dr ? `₹${r.closing_dr.toLocaleString("en-IN")}` : "—"}</TableCell>
                          <TableCell className="text-xs py-1.5 text-right">{r.closing_cr ? `₹${r.closing_cr.toLocaleString("en-IN")}` : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── STEP 5 ─── */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Confirm and Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Financial Year:</span> <span className="font-medium">{fy}</span></div>
              <div><span className="text-muted-foreground">Source:</span> <span className="font-medium">{software}</span></div>
              <div><span className="text-muted-foreground">Ledgers:</span> <span className="font-medium">{mappedRows.length}</span></div>
              <div><span className="text-muted-foreground">Upload Type:</span> <span className="font-medium">{uploadType === "detailed" ? "Detailed" : "Summary"}</span></div>
            </div>

            {isBalanced ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertDescription className="text-xs text-emerald-600">
                  Balance verified — Dr: ₹{totalDr.toLocaleString("en-IN")} = Cr: ₹{totalCr.toLocaleString("en-IN")}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Warning: Trial balance has a difference of ₹{difference.toLocaleString("en-IN")}
                </AlertDescription>
              </Alert>
            )}

            <Button onClick={handleImport} disabled={importing} className="w-full">
              {importing ? <><Loader2 size={16} className="mr-2 animate-spin" /> Importing...</> : "Import Trial Balance"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── SUCCESS ─── */}
      {step === 6 && (
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
            <h2 className="text-xl font-bold text-foreground">{mappedRows.length} ledgers imported successfully</h2>
            <p className="text-muted-foreground text-sm">Financial Year: {fy} • Source: {software}</p>

            {comparativeAvailable && (
              <Alert className="text-left">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertDescription className="text-xs text-emerald-600">
                  Comparative analysis is now enabled — multiple years are available for this client.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-center gap-3 pt-2">
              <Button variant="outline" onClick={() => navigate(`/clients/${clientId}`)}>
                Back to Client
              </Button>
              <Button onClick={() => navigate(`/erp-ledger`)}>
                View ERP Ledger
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation buttons */}
      {step >= 1 && step <= 5 && (
        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={() => step > 1 ? setStep(step - 1) : navigate(-1)} disabled={importing}>
            <ArrowLeft size={16} className="mr-2" /> {step === 1 ? "Cancel" : "Back"}
          </Button>
          {step < 5 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canProceed()}>
              Next <ArrowRight size={16} className="ml-2" />
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
