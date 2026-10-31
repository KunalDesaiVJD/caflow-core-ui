import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { downloadBlob } from "@/lib/downloadBlob";
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
import { format } from "date-fns";
import { Download, RefreshCw, Search } from "lucide-react";

// ─── Reminder log ─────────────────────────────────────────────────────────────
// Every reminder / statement the billing-reminders engine tried to send, from
// billing_reminder_log. The engine writes one row per invoice for a payment
// reminder, so rows of the same email (run + client + kind) are shown as one.

interface LogRow {
  id: string;
  run_id: string | null;
  firm_id: string;
  client_id: string | null;
  invoice_id: string | null;
  kind: "invoice" | "ledger";
  period_key: string | null;
  status: "sent" | "failed";
  to_emails: string[] | null;
  cc_emails: string[] | null;
  amount: number | null;
  error: string | null;
  trigger: string | null;
  sent_at: string;
}

interface EmailEntry {
  key: string;
  sent_at: string;
  client_id: string | null;
  client_name: string;
  firm_name: string;
  kind: "invoice" | "ledger";
  status: "sent" | "failed";
  trigger: string | null;
  to: string[];
  cc: string[];
  invoices: string[];
  amount: number;
  error: string | null;
}

const MAX_ROWS = 5000;
const PAGE_SIZE = 50;

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const TRIGGER_LABEL: Record<string, string> = {
  scheduled: "Automatic (daily)",
  manual: "Send now (all due)",
  manual_client: "Send now (client)",
};

export default function ReminderLogTab({ firmIds, firmNames }: { firmIds: string[]; firmNames: Record<string, string> }) {
  const multiFirm = firmIds.length > 1;
  const firmKey = firmIds.join(",");
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [clientNames, setClientNames] = useState<Record<string, string>>({});
  const [invoiceNos, setInvoiceNos] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "invoice" | "ledger">("all");
  const [status, setStatus] = useState<"all" | "sent" | "failed">("all");
  const [trigger, setTrigger] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    if (!firmIds.length) return;
    setLoading(true);
    setLoadError(null);
    const sb = supabase as any;
    const { data, error } = await sb.from("billing_reminder_log")
      .select("id, run_id, firm_id, client_id, invoice_id, kind, period_key, status, to_emails, cc_emails, amount, error, trigger, sent_at")
      .in("firm_id", firmIds).order("sent_at", { ascending: false }).limit(MAX_ROWS);
    if (error) { setLoadError(error.message); setRows([]); setLoading(false); return; }
    const list = (data || []) as LogRow[];

    // Names for clients and invoice numbers, in chunks (URL length).
    const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
    const clientIds = [...new Set(list.map(r => r.client_id).filter(Boolean))] as string[];
    const invoiceIds = [...new Set(list.map(r => r.invoice_id).filter(Boolean))] as string[];
    const names: Record<string, string> = {};
    const nos: Record<string, string> = {};
    await Promise.all([
      ...chunks(clientIds).map(async ids => {
        const { data: c } = await sb.from("clients").select("id, name").in("id", ids);
        (c || []).forEach((x: any) => { names[x.id] = x.name || "Unknown"; });
      }),
      ...chunks(invoiceIds).map(async ids => {
        const { data: inv } = await sb.from("invoices").select("id, invoice_no").in("id", ids);
        (inv || []).forEach((x: any) => { nos[x.id] = x.invoice_no; });
      }),
    ]);
    setClientNames(names);
    setInvoiceNos(nos);
    setRows(list);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmKey]);

  useEffect(() => { load(); }, [load]);

  // One entry per email: a payment reminder's per-invoice rows share run, client and kind.
  const entries = useMemo<EmailEntry[]>(() => {
    const map = new Map<string, EmailEntry>();
    for (const r of rows || []) {
      const key = r.kind === "invoice" && r.run_id ? `${r.run_id}:${r.client_id}:${r.firm_id}:${r.status}` : r.id;
      const e = map.get(key);
      const invNo = r.invoice_id ? invoiceNos[r.invoice_id] : null;
      if (e) {
        if (invNo) e.invoices.push(invNo);
        e.amount += Number(r.amount || 0);
        continue;
      }
      map.set(key, {
        key, sent_at: r.sent_at, client_id: r.client_id,
        client_name: (r.client_id && clientNames[r.client_id]) || "Unknown client",
        firm_name: firmNames[r.firm_id] ?? "—",
        kind: r.kind, status: r.status, trigger: r.trigger,
        to: r.to_emails || [], cc: r.cc_emails || [],
        invoices: invNo ? [invNo] : [], amount: Number(r.amount || 0), error: r.error,
      });
    }
    return [...map.values()];
  }, [rows, clientNames, invoiceNos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (q && !e.client_name.toLowerCase().includes(q)
        && !e.to.some(t => t.toLowerCase().includes(q)) && !e.invoices.some(i => i.toLowerCase().includes(q))) return false;
      if (kind !== "all" && e.kind !== kind) return false;
      if (status !== "all" && e.status !== status) return false;
      if (trigger !== "all" && (e.trigger || "") !== trigger) return false;
      const day = e.sent_at.slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });
  }, [entries, search, kind, status, trigger, fromDate, toDate]);

  useEffect(() => { setPage(0); }, [search, kind, status, trigger, fromDate, toDate]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const sentCount = filtered.filter(e => e.status === "sent").length;

  const exportCsv = () => {
    const header = ["Sent on", "Client", "Firm", "Type", "Invoices", "Amount", "To", "CC", "Sent by", "Status", "Error"];
    const lines = filtered.map(e => [
      format(new Date(e.sent_at), "dd-MM-yyyy HH:mm"), e.client_name, e.firm_name,
      e.kind === "invoice" ? "Payment reminder" : "Statement of Account",
      e.invoices.join("; "), e.amount.toFixed(2), e.to.join("; "), e.cc.join("; "),
      TRIGGER_LABEL[e.trigger || ""] || e.trigger || "", e.status, e.error || "",
    ].map(csvCell).join(","));
    downloadBlob(new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }),
      `reminder-log-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <Card>
      <CardHeader className="pb-2 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Reminder log</CardTitle>
            <p className="text-xs text-muted-foreground">
              Every payment reminder and Statement of Account sent for {multiFirm ? "the selected firms" : "this firm"} — automatic and "Send now".
              {rows && <> {filtered.length} email{filtered.length !== 1 ? "s" : ""} · {sentCount} sent · {filtered.length - sentCount} failed</>}
              {rows && rows.length >= MAX_ROWS && <> (latest {MAX_ROWS} log rows)</>}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportCsv} disabled={!filtered.length}>
              <Download size={13} /> Export CSV
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={load} disabled={loading}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="h-8 w-56 pl-7 text-xs" placeholder="Search client, email or invoice" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={kind} onValueChange={v => setKind(v as typeof kind)}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="invoice">Payment reminders</SelectItem>
              <SelectItem value="ledger">Statements of Account</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={v => setStatus(v as typeof status)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Sent & failed</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={trigger} onValueChange={setTrigger}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Sent by: any</SelectItem>
              {Object.entries(TRIGGER_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" className="h-8 w-36 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} title="From" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" className="h-8 w-36 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} title="To" />
        </div>
      </CardHeader>
      <CardContent>
        {loadError ? (
          <p className="text-sm text-destructive">Could not load the reminder log: {loadError}</p>
        ) : !rows ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="max-h-[620px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sent on</TableHead>
                    <TableHead>Client</TableHead>
                    {multiFirm && <TableHead>Firm</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Invoices</TableHead>
                    <TableHead>Email ID (To / CC)</TableHead>
                    <TableHead>Sent by</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map(e => (
                    <TableRow key={e.key}>
                      <TableCell className="text-xs whitespace-nowrap">{format(new Date(e.sent_at), "dd MMM yyyy, HH:mm")}</TableCell>
                      <TableCell className="text-sm font-medium">{e.client_name}</TableCell>
                      {multiFirm && <TableCell className="text-xs">{e.firm_name}</TableCell>}
                      <TableCell className="text-xs">{e.kind === "invoice" ? "Payment reminder" : "Statement of Account"}</TableCell>
                      <TableCell className="text-xs max-w-[200px]">
                        <div className="truncate" title={e.invoices.join(", ")}>{e.invoices.join(", ") || "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs max-w-[240px]">
                        <div className="truncate" title={e.to.join(", ")}>{e.to.join(", ") || "—"}</div>
                        {e.cc.length > 0 && <div className="truncate text-[10px] text-muted-foreground" title={e.cc.join(", ")}>CC: {e.cc.join(", ")}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{TRIGGER_LABEL[e.trigger || ""] || e.trigger || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {e.status === "sent"
                          ? <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-600">Sent</Badge>
                          : <Badge variant="destructive" className="text-[10px]">Failed</Badge>}
                        {e.error && <div className="text-[10px] text-destructive max-w-[200px] truncate" title={e.error}>{e.error}</div>}
                      </TableCell>
                      <TableCell className="text-right text-xs">{inr(e.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {shown.length === 0 && (
                    <TableRow><TableCell colSpan={multiFirm ? 9 : 8} className="text-center text-sm text-muted-foreground py-6">
                      {entries.length ? "No reminders match these filters." : "No reminders have been sent for this firm yet."}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-end gap-2 pt-3 text-xs">
                <span className="text-muted-foreground">Page {page + 1} of {pageCount}</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
