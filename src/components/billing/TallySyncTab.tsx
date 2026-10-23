import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, UploadCloud, DownloadCloud, CheckCircle2, AlertTriangle, Clock, Link2 } from "lucide-react";
import TallyMappingPanel from "@/components/billing/TallyMappingPanel";

/**
 * TallySyncTab — CAFlow <-> Tally billing sync control surface.
 *
 * Forward:  queue invoices/CNs to push to Tally (the desktop agent posts them),
 *           and show each document's sync status (from tally_voucher_log / queue).
 * Reverse:  review bank/cash Receipts pulled from Tally into tally_receipt_staging;
 *           import matched ones into billing (post_receipt), map the unmatched.
 *
 * The actual Tally I/O is done by the desktop agent (only the firm's PC reaches
 * Tally). This UI only reads/writes the hand-off tables.
 */

const sb = supabase as any;
const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n) || 0);
function fyFromDate(d: string): string {
  const dt = new Date(d);
  const s = dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1;
  return `${s}-${String(s + 1).slice(2)}`;
}

interface Props { firmId: string | null; }

interface InvRow {
  id: string; invoice_no: string; document_type: string; invoice_date: string;
  total_amount: number; client_id: string; client_name: string;
  vch_id: string | null; queue_status: string | null; queue_error: string | null;
}
interface StageRow {
  id: string; voucher_number: string; voucher_date: string; party_ledger: string;
  amount: number; tds_amount: number; kasar_amount: number; bank_ledger: string | null; match_method: string;
  match_confidence: number; status: string; matched_client_id: string | null; error: string | null;
}

export default function TallySyncTab({ firmId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvRow[]>([]);
  const [staging, setStaging] = useState<StageRow[]>([]);
  const [clients, setClients] = useState<{ value: string; label: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!firmId) { setInvoices([]); setStaging([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [invRes, logRes, qRes, stgRes, cliRes] = await Promise.all([
        sb.from("invoices").select("id,invoice_no,document_type,invoice_date,total_amount,client_id")
          .eq("firm_id", firmId).in("document_type", ["invoice", "credit_note"])
          // A cancelled document is never pushed (one already in Tally is deleted there by trigger).
          .or("status.is.null,status.not.in.(voided,cancelled)")
          .order("invoice_date", { ascending: false }).limit(300),
        sb.from("tally_voucher_log").select("invoice_id,tally_vch_id").eq("firm_id", firmId).eq("direction", "forward"),
        sb.from("tally_sync_queue").select("invoice_id,status,last_error").eq("firm_id", firmId).eq("direction", "forward"),
        sb.from("tally_receipt_staging").select("*").eq("firm_id", firmId).order("voucher_date", { ascending: false }).limit(500),
        sb.from("clients").select("id,name").eq("firm_id", firmId).order("name"),
      ]);
      const logMap = new Map<string, string>((logRes.data || []).map((r: any) => [r.invoice_id, r.tally_vch_id]));
      const qMap = new Map<string, any>((qRes.data || []).map((r: any) => [r.invoice_id, r]));
      const cliMap = new Map<string, string>((cliRes.data || []).map((c: any) => [c.id, c.name]));
      setClients((cliRes.data || []).map((c: any) => ({ value: c.id, label: c.name })));
      setInvoices((invRes.data || []).map((i: any) => ({
        ...i, client_name: cliMap.get(i.client_id) || "—",
        vch_id: logMap.get(i.id) || null,
        queue_status: qMap.get(i.id)?.status || null,
        queue_error: qMap.get(i.id)?.last_error || null,
      })));
      setStaging((stgRes.data || []) as StageRow[]);
    } catch (e: any) {
      toast({ title: "Failed to load Tally sync data", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  }, [firmId, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ---- forward: queue an invoice to push ----
  async function queueInvoice(inv: InvRow) {
    setBusy(inv.id);
    try {
      const { error } = await sb.from("tally_sync_queue").upsert({
        firm_id: firmId, invoice_id: inv.id, document_no: inv.invoice_no,
        direction: "forward", status: "pending", attempts: 0, last_error: null,
        requested_by: user?.id, requested_at: new Date().toISOString(),
      }, { onConflict: "invoice_id,direction" });
      if (error) throw error;
      toast({ title: `${inv.invoice_no} queued for Tally`, description: "The Tally desktop agent will post it on its next run." });
      fetchData();
    } catch (e: any) { toast({ title: "Queue failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  }
  async function queueAllUnsynced() {
    const targets = invoices.filter((i) => !i.vch_id && i.queue_status !== "pending" && i.queue_status !== "processing");
    if (!targets.length) { toast({ title: "Nothing to queue — all documents are synced or already queued." }); return; }
    setBusy("all");
    try {
      const rows = targets.map((i) => ({
        firm_id: firmId, invoice_id: i.id, document_no: i.invoice_no, direction: "forward",
        status: "pending", attempts: 0, last_error: null, requested_by: user?.id,
      }));
      const { error } = await sb.from("tally_sync_queue").upsert(rows, { onConflict: "invoice_id,direction" });
      if (error) throw error;
      toast({ title: `Queued ${rows.length} document(s) for Tally.` });
      fetchData();
    } catch (e: any) { toast({ title: "Bulk queue failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  }

  // ---- reverse: import a matched receipt into billing (post_receipt) ----
  async function importReceipt(s: StageRow) {
    if (!s.matched_client_id) { toast({ title: "Match a client first.", variant: "destructive" }); return; }
    setBusy(s.id);
    try {
      const { data: receiptId, error } = await sb.rpc("post_receipt", {
        p_firm_id: firmId, p_client_id: s.matched_client_id, p_invoice_id: null,
        p_receipt_type: "on_account", p_receipt_date: s.voucher_date, p_amount: Number(s.amount),
        p_payment_mode: /cash/i.test(s.bank_ledger || "") ? "cash" : "bank",
        p_payment_reference: s.voucher_number || null, p_tds: Number(s.tds_amount) || 0, p_gst_tds: 0,
        p_tds_date: Number(s.tds_amount) > 0 ? s.voucher_date : null,
        p_remarks: `From Tally receipt ${s.voucher_number}`, p_gstin: null,
        p_created_by: user?.id, p_financial_year: fyFromDate(s.voucher_date),
      });
      if (error) throw error;
      // mirror a Tally kasar/write-off into CAFlow ([tally-sync] tag stops it bouncing back)
      if (Number(s.kasar_amount) > 0) {
        await sb.from("billing_kasars").insert({
          firm_id: firmId, client_id: s.matched_client_id, kasar_date: s.voucher_date,
          amount: Number(s.kasar_amount), invoice_id: null, financial_year: fyFromDate(s.voucher_date),
          narration: `Kasar from Tally receipt ${s.voucher_number || ""} [tally-sync]`,
        });
      }
      await sb.from("tally_receipt_staging").update({ status: "imported", receipt_id: receiptId, imported_at: new Date().toISOString(), reviewed_by: user?.id }).eq("id", s.id);
      toast({ title: `Imported receipt ${s.voucher_number} (₹${fmt(s.amount)}${Number(s.kasar_amount) > 0 ? ` + ₹${fmt(s.kasar_amount)} kasar` : ""}).` });
      fetchData();
    } catch (e: any) { toast({ title: "Import failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  }
  async function mapReceipt(s: StageRow, clientId: string) {
    setBusy(s.id);
    try {
      await sb.from("tally_receipt_staging").update({ matched_client_id: clientId, match_method: "manual", match_confidence: 100, status: "matched", reviewed_by: user?.id }).eq("id", s.id);
      fetchData();
    } catch (e: any) { toast({ title: "Map failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  }
  async function ignoreReceipt(s: StageRow) {
    setBusy(s.id);
    try { await sb.from("tally_receipt_staging").update({ status: "ignored", reviewed_by: user?.id }).eq("id", s.id); fetchData(); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="space-y-3 mt-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;

  const syncedCount = invoices.filter((i) => i.vch_id).length;
  // Accountant SLA: invoices/CNs not yet in Tally, older than the SLA window (3 days).
  const SLA_DAYS = 3;
  const daysSince = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  const overdue = invoices.filter((i) => !i.vch_id && i.queue_status !== "pending" && i.queue_status !== "processing" && daysSince(i.invoice_date) >= SLA_DAYS);
  const oldestOverdue = overdue.reduce((m, i) => Math.max(m, daysSince(i.invoice_date)), 0);
  const pendingReceipts = staging.filter((s) => s.status === "pending");
  const matchedReceipts = staging.filter((s) => s.status === "matched");
  const importedReceipts = staging.filter((s) => s.status === "imported");

  const fwdBadge = (i: InvRow) => {
    if (i.queue_status === "failed") return <Badge variant="destructive" className="gap-1"><AlertTriangle size={11} /> Failed</Badge>;
    if (i.queue_status === "pending" || i.queue_status === "processing") return <Badge variant="secondary" className="gap-1"><Clock size={11} /> Queued</Badge>;
    if (i.vch_id) return <Badge className="gap-1 bg-emerald-600"><CheckCircle2 size={11} /> Synced</Badge>;
    return <Badge variant="outline">Not synced</Badge>;
  };

  return (
    <div className="space-y-4 mt-2">
      <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
        Tally posting runs on the <b>desktop agent</b> on the PC where Tally is open. Queue documents here; run
        <code className="mx-1 rounded bg-amber-100 dark:bg-amber-900/40 px-1">tally-sync push</code>
        on that PC to post them (or schedule it). Receipts appear below after you run
        <code className="mx-1 rounded bg-amber-100 dark:bg-amber-900/40 px-1">tally-sync pull-receipts</code>.
      </div>

      {/* ACCOUNTANT SLA REMINDER — docs not recorded in Tally past the SLA window */}
      {overdue.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 px-3 py-2 flex items-center justify-between gap-3">
          <div className="text-sm text-red-800 dark:text-red-300 flex items-center gap-2">
            <AlertTriangle size={15} />
            <span><b>{overdue.length}</b> document{overdue.length > 1 ? "s" : ""} not yet recorded in Tally (oldest <b>{oldestOverdue} days</b>). SLA is {SLA_DAYS} days.</span>
          </div>
          <Button size="sm" variant="destructive" onClick={queueAllUnsynced} disabled={busy === "all"}>Queue all for Tally</Button>
        </div>
      )}

      {/* FORWARD */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm flex items-center gap-2"><UploadCloud size={15} /> Invoices &amp; Credit Notes &rarr; Tally
            <span className="text-muted-foreground font-normal">({syncedCount}/{invoices.length} synced)</span></CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={fetchData}><RefreshCw size={13} className="mr-1" /> Refresh</Button>
            <Button size="sm" onClick={queueAllUnsynced} disabled={busy === "all"}>Queue all unsynced</Button>
          </div>
        </CardHeader>
        <CardContent className="max-h-[340px] overflow-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Document</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead>
              <TableHead>Tally status</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.invoice_no}<div className="text-xs text-muted-foreground">{i.client_name}{i.document_type === "credit_note" ? " · CN" : ""}</div></TableCell>
                  <TableCell className="text-xs">{i.invoice_date}</TableCell>
                  <TableCell className="text-right">₹{fmt(i.total_amount)}</TableCell>
                  <TableCell>{fwdBadge(i)}{i.queue_error ? <div className="text-[10px] text-destructive max-w-[220px] truncate" title={i.queue_error}>{i.queue_error}</div> : null}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant={i.vch_id ? "outline" : "default"} disabled={busy === i.id || i.queue_status === "pending"} onClick={() => queueInvoice(i)}>
                      {i.vch_id ? "Re-sync" : "Sync"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {invoices.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No invoices/credit notes.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* REVERSE */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><DownloadCloud size={15} /> Tally Bank/Cash Receipts &rarr; CAFlow
            <span className="text-muted-foreground font-normal">({matchedReceipts.length} ready · {pendingReceipts.length} to map · {importedReceipts.length} imported)</span></CardTitle>
        </CardHeader>
        <CardContent className="max-h-[420px] overflow-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Receipt</TableHead><TableHead>Party (Tally)</TableHead><TableHead className="text-right">Amount</TableHead>
              <TableHead>Client match</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {staging.filter((s) => s.status !== "ignored").map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.voucher_number}<div className="text-xs text-muted-foreground">{s.voucher_date}</div></TableCell>
                  <TableCell className="text-xs">{s.party_ledger}{Number(s.tds_amount) > 0 ? <span className="text-muted-foreground"> · TDS ₹{fmt(s.tds_amount)}</span> : null}{Number(s.kasar_amount) > 0 ? <span className="text-amber-600"> · kasar ₹{fmt(s.kasar_amount)}</span> : null}</TableCell>
                  <TableCell className="text-right">₹{fmt(s.amount)}</TableCell>
                  <TableCell>
                    {s.status === "imported" ? <Badge className="bg-emerald-600 gap-1"><CheckCircle2 size={11} /> Imported</Badge>
                      : s.matched_client_id
                        ? <Badge variant="secondary" className="gap-1"><Link2 size={11} /> {clients.find((c) => c.value === s.matched_client_id)?.label || "matched"} {s.match_method === "name_exact" ? "(auto)" : ""}</Badge>
                        : <div className="min-w-[200px]"><SearchableSelect value="" onValueChange={(v) => mapReceipt(s, v)} options={clients} placeholder="Map to client…" /></div>}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {s.status !== "imported" && s.matched_client_id && <Button size="sm" disabled={busy === s.id} onClick={() => importReceipt(s)}>Import</Button>}
                    {s.status !== "imported" && <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => ignoreReceipt(s)}>Ignore</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {staging.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No Tally receipts staged yet. Run <code>tally-sync pull-receipts</code> on the Tally PC.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* MAPPINGS (auto-matcher review) */}
      <TallyMappingPanel firmId={firmId} />
    </div>
  );
}
