import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format, differenceInDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Upload, Sparkles, Save, CheckCircle2, AlertTriangle, Plus, Trash2,
} from "lucide-react";
import Papa from "papaparse";

// ─── Types ───
interface LedgerEntry {
  id: string;
  date: string;
  narration: string;
  debit: number;
  credit: number;
  matched?: boolean;
  matchId?: string;
}

interface StatementEntry {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  matched?: boolean;
  matchId?: string;
}

interface ColumnMapping {
  date: string;
  description: string;
  debit: string;
  credit: string;
}

const BankRecon = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const firmId = user?.firm_id;

  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Book entries (left column)
  const [bookEntries, setBookEntries] = useState<LedgerEntry[]>([]);

  // Statement entries (right column)
  const [statementEntries, setStatementEntries] = useState<StatementEntry[]>([]);

  // CSV parsing
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    date: "", description: "", debit: "", credit: "",
  });
  const [showMapping, setShowMapping] = useState(false);

  // Manual entry
  const [manualDate, setManualDate] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const [manualDebit, setManualDebit] = useState("");
  const [manualCredit, setManualCredit] = useState("");

  // Match state
  const [matched, setMatched] = useState(false);

  // ─── Fetch ───
  const fetchData = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      // Client name
      const { data: client } = await supabase
        .from("clients")
        .select("name")
        .eq("id", clientId)
        .single();
      setClientName(client?.name || "Client");

      // Bank ledger balances from Tally TB (snapshot path removed)
      const { data: tbRows } = await supabase
        .from("tally_trial_balance")
        .select("ledger_name, closing_balance, balance_type, debit_amount, credit_amount")
        .eq("client_id", clientId);

      if (tbRows && tbRows.length > 0) {
        const bankEntries: LedgerEntry[] = tbRows
          .filter((row: any) => {
            const name = (row.ledger_name || "").toLowerCase();
            return name.includes("bank") || name.includes("cash at bank");
          })
          .map((row: any, i: number) => {
            const isCr = String(row.balance_type || "Dr").toUpperCase() === "CR";
            const bal = Math.abs(Number(row.closing_balance || 0));
            return {
              id: `book-${i}`,
              date: "",
              narration: row.ledger_name || "",
              debit:  isCr ? 0 : bal,
              credit: isCr ? bal : 0,
            };
          });
        setBookEntries(bankEntries);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── CSV Upload ───
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        setCsvHeaders(headers);
        setCsvData(results.data as Record<string, string>[]);

        // Auto-detect column mapping
        const mapping: ColumnMapping = { date: "", description: "", debit: "", credit: "" };
        headers.forEach((h) => {
          const lower = h.toLowerCase();
          if (lower.includes("date") || lower.includes("txn")) mapping.date = h;
          else if (lower.includes("desc") || lower.includes("narr") || lower.includes("particular")) mapping.description = h;
          else if (lower.includes("debit") || lower.includes("withdrawal")) mapping.debit = h;
          else if (lower.includes("credit") || lower.includes("deposit")) mapping.credit = h;
        });

        setColumnMapping(mapping);
        setShowMapping(true);
        toast({ title: `${results.data.length} rows parsed from CSV` });
      },
      error: (err) => {
        toast({ title: "CSV parse error", description: err.message, variant: "destructive" });
      },
    });
  };

  const applyMapping = () => {
    if (!columnMapping.date || !columnMapping.description) {
      toast({ title: "Map at least Date and Description columns", variant: "destructive" });
      return;
    }

    const mapped: StatementEntry[] = csvData.map((row, i) => ({
      id: `stmt-${i}`,
      date: row[columnMapping.date] || "",
      description: row[columnMapping.description] || "",
      debit: parseFloat(row[columnMapping.debit]) || 0,
      credit: parseFloat(row[columnMapping.credit]) || 0,
    }));

    setStatementEntries(mapped);
    setShowMapping(false);
    setMatched(false);
    toast({ title: `${mapped.length} statement entries loaded` });
  };

  // ─── Manual add ───
  const addManualEntry = () => {
    if (!manualDate || !manualDesc) return;
    const newEntry: StatementEntry = {
      id: `stmt-manual-${Date.now()}`,
      date: manualDate,
      description: manualDesc,
      debit: parseFloat(manualDebit) || 0,
      credit: parseFloat(manualCredit) || 0,
    };
    setStatementEntries((prev) => [...prev, newEntry]);
    setManualDate("");
    setManualDesc("");
    setManualDebit("");
    setManualCredit("");
    setMatched(false);
  };

  const removeStatementEntry = (id: string) => {
    setStatementEntries((prev) => prev.filter((e) => e.id !== id));
    setMatched(false);
  };

  // ─── Auto-Match ───
  const handleAutoMatch = () => {
    const bookCopy = bookEntries.map((e) => ({ ...e, matched: false, matchId: undefined as string | undefined }));
    const stmtCopy = statementEntries.map((e) => ({ ...e, matched: false, matchId: undefined as string | undefined }));

    bookCopy.forEach((book) => {
      const bookAmount = book.debit || book.credit;
      if (!bookAmount) return;

      const matchIdx = stmtCopy.findIndex((stmt) => {
        if (stmt.matched) return false;
        const stmtAmount = stmt.debit || stmt.credit;
        if (Math.abs(bookAmount - stmtAmount) > 0.01) return false;

        // Date within 3 days
        try {
          const bookDate = new Date(book.date);
          const stmtDate = new Date(stmt.date);
          return Math.abs(differenceInDays(bookDate, stmtDate)) <= 3;
        } catch {
          return false;
        }
      });

      if (matchIdx >= 0) {
        const matchId = `match-${book.id}-${stmtCopy[matchIdx].id}`;
        book.matched = true;
        book.matchId = matchId;
        stmtCopy[matchIdx].matched = true;
        stmtCopy[matchIdx].matchId = matchId;
      }
    });

    setBookEntries(bookCopy);
    setStatementEntries(stmtCopy);
    setMatched(true);

    const matchCount = bookCopy.filter((b) => b.matched).length;
    toast({ title: `${matchCount} entries matched` });
  };

  // ─── Reconciliation Summary ───
  const summary = useMemo(() => {
    const stmtBalance = statementEntries.reduce((s, e) => s + e.credit - e.debit, 0);
    const depositsInTransit = bookEntries
      .filter((e) => !e.matched && e.debit > 0)
      .reduce((s, e) => s + e.debit, 0);
    const outstandingCheques = bookEntries
      .filter((e) => !e.matched && e.credit > 0)
      .reduce((s, e) => s + e.credit, 0);
    const balancePerBooks = stmtBalance + depositsInTransit - outstandingCheques;
    const bookBalance = bookEntries.reduce((s, e) => s + e.debit - e.credit, 0);
    const difference = Math.abs(balancePerBooks - bookBalance);

    return {
      stmtBalance,
      depositsInTransit,
      outstandingCheques,
      balancePerBooks,
      bookBalance,
      difference,
      reconciled: difference < 0.01,
    };
  }, [bookEntries, statementEntries]);

  // ─── Save BRS ───
  const handleSave = async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("bank_reconciliations").insert({
        client_id: clientId,
        bank_account: "Primary Bank",
        reconciliation_date: format(new Date(), "yyyy-MM-dd"),
        statement_balance: summary.stmtBalance,
        book_balance: summary.bookBalance,
        difference: summary.difference,
      });
      if (error) throw error;
      toast({ title: "BRS saved successfully" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const fmtCurrency = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Bank Reconciliation</h1>
          <p className="text-sm text-muted-foreground">{clientName}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={handleAutoMatch} disabled={bookEntries.length === 0 && statementEntries.length === 0}>
            <Sparkles className="h-4 w-4 mr-1" /> Auto-Match
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save BRS"}
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT — Bank Ledger (Books) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Bank Ledger (Books)
              <Badge variant="outline" className="text-[10px]">{bookEntries.length} entries</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Narration</TableHead>
                    <TableHead className="text-xs text-right">Debit</TableHead>
                    <TableHead className="text-xs text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                        No bank ledger entries found. Upload trial balance data first.
                      </TableCell>
                    </TableRow>
                  ) : (
                    bookEntries.map((e) => (
                      <TableRow
                        key={e.id}
                        className={cn(
                          e.matched ? "bg-emerald-500/10" : matched ? "bg-amber-500/10" : ""
                        )}
                      >
                        <TableCell className="text-xs whitespace-nowrap">{e.date}</TableCell>
                        <TableCell className="text-xs max-w-[180px] truncate">{e.narration}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{e.debit > 0 ? fmtCurrency(e.debit) : ""}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{e.credit > 0 ? fmtCurrency(e.credit) : ""}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT — Bank Statement */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                Bank Statement
                <Badge variant="outline" className="text-[10px]">{statementEntries.length} entries</Badge>
              </CardTitle>
              <div>
                <label htmlFor="csv-upload" className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span><Upload className="h-3.5 w-3.5 mr-1" /> Upload CSV</span>
                  </Button>
                </label>
                <input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleCsvUpload}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 space-y-0">
            {/* Column Mapping UI */}
            {showMapping && (
              <div className="p-4 border-b border-border bg-muted/30 space-y-3">
                <p className="text-xs font-semibold text-foreground">Map CSV Columns</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["date", "description", "debit", "credit"] as const).map((field) => (
                    <div key={field}>
                      <label className="text-[10px] font-medium text-muted-foreground capitalize">{field}</label>
                      <Select value={columnMapping[field]} onValueChange={(v) => setColumnMapping((m) => ({ ...m, [field]: v }))}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          {csvHeaders.map((h) => (
                            <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={applyMapping}>Apply</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowMapping(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Statement table */}
            <div className="max-h-[300px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                    <TableHead className="text-xs text-right">Debit</TableHead>
                    <TableHead className="text-xs text-right">Credit</TableHead>
                    <TableHead className="text-xs w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statementEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-xs">
                        Upload a CSV or add entries manually.
                      </TableCell>
                    </TableRow>
                  ) : (
                    statementEntries.map((e) => (
                      <TableRow
                        key={e.id}
                        className={cn(
                          e.matched ? "bg-emerald-500/10" : matched ? "bg-amber-500/10" : ""
                        )}
                      >
                        <TableCell className="text-xs whitespace-nowrap">{e.date}</TableCell>
                        <TableCell className="text-xs max-w-[160px] truncate">{e.description}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{e.debit > 0 ? fmtCurrency(e.debit) : ""}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{e.credit > 0 ? fmtCurrency(e.credit) : ""}</TableCell>
                        <TableCell>
                          <button onClick={() => removeStatementEntry(e.id)} className="text-destructive/60 hover:text-destructive">
                            <Trash2 size={12} />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Manual entry row */}
            <div className="border-t border-border p-2 flex gap-1.5 items-end">
              <Input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="h-7 text-xs w-[120px]"
              />
              <Input
                placeholder="Description"
                value={manualDesc}
                onChange={(e) => setManualDesc(e.target.value)}
                className="h-7 text-xs flex-1"
              />
              <Input
                type="number"
                placeholder="Dr"
                value={manualDebit}
                onChange={(e) => setManualDebit(e.target.value)}
                className="h-7 text-xs w-[70px]"
              />
              <Input
                type="number"
                placeholder="Cr"
                value={manualCredit}
                onChange={(e) => setManualCredit(e.target.value)}
                className="h-7 text-xs w-[70px]"
              />
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={addManualEntry}>
                <Plus size={12} />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reconciliation Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Reconciliation Summary
            {matched && (
              summary.reconciled ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 text-[10px]">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Reconciled ✓
                </Badge>
              ) : (
                <Badge className="bg-amber-500/15 text-amber-600 text-[10px]">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Difference exists
                </Badge>
              )
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Bank Balance (Statement)</p>
              <p className="text-lg font-bold text-foreground tabular-nums">{fmtCurrency(summary.stmtBalance)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">(+) Deposits in Transit</p>
              <p className="text-lg font-bold text-primary tabular-nums">{fmtCurrency(summary.depositsInTransit)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">(−) Outstanding Cheques</p>
              <p className="text-lg font-bold text-destructive tabular-nums">{fmtCurrency(summary.outstandingCheques)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">(=) Balance per Books</p>
              <p className="text-lg font-bold text-foreground tabular-nums">{fmtCurrency(summary.balancePerBooks)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Difference (₹)</p>
              <p className={cn(
                "text-lg font-bold tabular-nums",
                summary.reconciled ? "text-emerald-600" : "text-destructive"
              )}>
                {fmtCurrency(summary.difference)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BankRecon;
