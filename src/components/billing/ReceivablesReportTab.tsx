/**
 * ReceivablesReportTab — Sundry Debtors (Flat list, Tally-inspired) v3
 *
 * Fixed:
 *  1. Firm dropdown — superadmin sees all firms, others see only their firm
 *  2. Opening balance from client_billing_opening_balances included in totals
 *     (clients with only OB now appear in the report)
 *  3. Ledger sheet shows OB as first row, matching the Ledger tab
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useUserFirmAccess } from "@/hooks/useUserFirmAccess";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  Download, RefreshCw, Search, X, TrendingUp, Users,
  Send, FileText, Mail, MessageCircle, Loader2,
  ArrowUpDown, ChevronUp, ChevronDown, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import DocLink from "@/components/billing/DocLink";
import type { LedgerEntryKind } from "@/lib/ledgerEntryKinds";
import { composeLedgerEntries, type LedgerEntry, type RawInvoice, type RawReceipt, type RawKasar } from "@/lib/statementOfAccount";
import { buildGroupStatementPdf } from "@/lib/groupStatementPdf";
import {
  ensurePdfUnicodeFont, formatPdfCurrency, setPdfUnicodeFont,
} from "@/lib/jspdfUnicodeFont";

/** Invoice statuses that count as receivable (matches v_billing_reconciliation). */
const BILLABLE_STATUSES = ["finalized", "sent", "overdue", "paid"];

// Fetch ALL rows for a query, paging past PostgREST's 1000-row default cap.
// Used wherever a result set feeds a SUM, so totals never silently truncate.
async function fetchAllRows<T = any>(makeQuery: () => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Firm { id: string; name: string; logo_url?: string | null; }

interface Balances {
  ob: number;          // manual opening balance from client_billing_opening_balances
  openingDr: number;   // invoices before period
  openingCr: number;   // receipts before period
  debit: number;       // invoices in period
  credit: number;      // receipts in period
}

/** One client's balances in ONE firm — the atom every view aggregates. */
interface ClientRow extends Balances {
  id: string;          // client id
  firmId: string;
  name: string;
  email: string | null;
}

type ViewBy = "client" | "group" | "firm";

/** A row as displayed: a client, a client group or a firm (summed atoms). */
interface DisplayRow extends Balances {
  key: string;
  kind: ViewBy;
  id: string;          // client / group / firm id
  name: string;
  email: string | null;
  firmIds: string[];   // firms the underlying atoms belong to
  atomKeys: string[];  // `${clientId}|${firmId}` — lets totals count each atom once
  clientCount: number;
}

const ALL_FIRMS = "__all__";
const NO_GROUP = "__none__";
const emptyBalances = (): Balances => ({ ob: 0, openingDr: 0, openingCr: 0, debit: 0, credit: 0 });
function addBalances(into: Balances, b: Balances) {
  into.ob += b.ob; into.openingDr += b.openingDr; into.openingCr += b.openingCr;
  into.debit += b.debit; into.credit += b.credit;
}


type SortKey = "name" | "closing" | "debit" | "credit";
type SortDir = "asc" | "desc";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtINR = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function drCr(net: number): { abs: number; label: "Dr" | "Cr" } {
  return net >= 0 ? { abs: net, label: "Dr" } : { abs: -net, label: "Cr" };
}

function currentFYStart(): string {
  const t = new Date();
  const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
  return `${y}-04-01`;
}

function todayStr(): string { return format(new Date(), "yyyy-MM-dd"); }

async function loadLogoBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReceivablesReportTab({ defaultFirmId }: { defaultFirmId?: string } = {}) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "superadmin";
  const { allAccessibleFirms } = useUserFirmAccess();

  const [firms,       setFirms]       = useState<Firm[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string>(defaultFirmId ?? user?.firm_id ?? "");
  const [fromDate,    setFromDate]    = useState(currentFYStart());
  const [toDate,      setToDate]      = useState(todayStr());
  const [loading,     setLoading]     = useState(false);
  const [rows,        setRows]        = useState<ClientRow[]>([]);
  const [viewBy,      setViewBy]      = useState<ViewBy>("client");
  const [groupFilter, setGroupFilter] = useState<{ id: string; name: string } | null>(null);
  const [groupNames,  setGroupNames]  = useState<Record<string, string>>({});
  const [groupsOfClient, setGroupsOfClient] = useState<Record<string, string[]>>({});
  const [firmLogoUrl, setFirmLogoUrl] = useState<string | null>(null);
  const [search,      setSearch]      = useState("");
  const [hideZero,    setHideZero]    = useState(true);
  const [sortKey,     setSortKey]     = useState<SortKey>("name");
  const [sortDir,     setSortDir]     = useState<SortDir>("asc");

  // Sheet (ledger)
  const [sheetClient,  setSheetClient]  = useState<DisplayRow | null>(null);
  const [sheetEntries, setSheetEntries] = useState<LedgerEntry[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);

  // Email dialog
  const [emailClient,  setEmailClient]  = useState<DisplayRow | null>(null);
  const [emailSending, setEmailSending] = useState(false);

  // Group statement email dialog (whole group, one document)
  const [groupEmail,   setGroupEmail]   = useState<DisplayRow | null>(null);
  const [gTo,          setGTo]          = useState("");
  const [gCc,          setGCc]          = useState("");
  const [gSubject,     setGSubject]     = useState("");
  const [gMsg,         setGMsg]         = useState("");
  const [gSending,     setGSending]     = useState(false);

  // Telegram / PDF
  const [tgSending,    setTgSending]    = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // ── Load firms ────────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadFirms() {
      const { data } = await supabase
        .from("firms")
        .select("id, name, settings")
        .order("name");
      const allFirms: Firm[] = (data || []).map((f: any) => ({
        id: f.id,
        name: f.name || "—",
        logo_url: (f.settings as any)?.logo_url ?? null,
      }));

      // Restrict dropdown to accessible firms for non-superadmin
      let list: Firm[];
      if (isSuperAdmin) {
        list = allFirms;
      } else {
        const accessIds = new Set(allAccessibleFirms.map(af => af.id));
        list = allFirms.filter(f => accessIds.has(f.id));
      }
      setFirms(list);

      // Default: respect defaultFirmId prop, else user's home firm, else first in list
      if (!selectedFirmId || (selectedFirmId !== ALL_FIRMS && !list.find(f => f.id === selectedFirmId))) {
        const target = defaultFirmId ?? user?.firm_id;
        const own = list.find(f => f.id === target);
        if (own) setSelectedFirmId(own.id);
        else if (list.length > 0) setSelectedFirmId(list[0].id);
      }
    }
    loadFirms();
  }, [user?.firm_id, isSuperAdmin, allAccessibleFirms.length, defaultFirmId]);

  // A group drill-down belongs to the firm selection it was made in.
  useEffect(() => { setGroupFilter(null); }, [selectedFirmId]);

  // Keep logo URL in sync with selected firm
  useEffect(() => {
    const f = firms.find(f => f.id === selectedFirmId);
    setFirmLogoUrl(f?.logo_url ?? null);
  }, [selectedFirmId, firms]);

  // ── Fetch report data ─────────────────────────────────────────────────────

  // Firms covered by the current selection ("All firms" = every firm in the dropdown).
  const firmIds = useMemo(
    () => (selectedFirmId === ALL_FIRMS ? firms.map(f => f.id) : selectedFirmId ? [selectedFirmId] : []),
    [selectedFirmId, firms],
  );
  const firmIdsKey = firmIds.join(",");

  const fetchReport = useCallback(async () => {
    if (firmIds.length === 0) return;
    setLoading(true);
    try {
      // C9: page past PostgREST's 1000-row cap so the debtors totals are
      // complete for established firms (these feed SUMs — a truncated fetch
      // silently under-reports receivables).
      const [invoices, receipts, obRows, kasars] = await Promise.all([
        fetchAllRows<{ client_id: string; firm_id: string; invoice_date: string | null; total_amount: number | null; document_type: string | null }>(() =>
          supabase.from("invoices")
            .select("client_id, firm_id, invoice_date, total_amount, document_type")
            .in("firm_id", firmIds)
            // Q3: only confirmed invoices + credit notes belong in receivables.
            .in("document_type", ["invoice", "credit_note"])
            // Same status rule as v_billing_reconciliation / LedgerTab: drafts,
            // cancelled and voided documents are not receivable.
            .in("status", BILLABLE_STATUSES)),
        fetchAllRows<any>(() =>
          supabase.from("billing_receipts")
            .select("client_id, firm_id, receipt_date, amount_received, tds_amount, gst_tds_amount")
            .in("firm_id", firmIds)),
        fetchAllRows<any>(() =>
          (supabase as any).from("client_billing_opening_balances")
            .select("client_id, firm_id, amount")
            .in("firm_id", firmIds)),
        fetchAllRows<any>(() =>
          (supabase as any).from("billing_kasars")
            .select("client_id, firm_id, kasar_date, amount")
            .in("firm_id", firmIds)),
      ]);

      // One atom per (client, firm) with any activity.
      const atoms = new Map<string, Balances & { clientId: string; firmId: string }>();
      const atom = (clientId: string, firmId: string) => {
        const k = `${clientId}|${firmId}`;
        let a = atoms.get(k);
        if (!a) { a = { clientId, firmId, ...emptyBalances() }; atoms.set(k, a); }
        return a;
      };

      for (const ob of obRows || []) {
        if (!ob.client_id) continue;
        atom(ob.client_id, ob.firm_id).ob += Number(ob.amount || 0);
      }
      for (const inv of invoices || []) {
        if (!inv.client_id) continue;
        const a = atom(inv.client_id, inv.firm_id);
        const amt = Number(inv.total_amount || 0);
        if (!amt) continue;
        // Credit notes reduce the debtor (Cr), same as the ledger sheet below.
        const isCN = inv.document_type === "credit_note";
        // An undated document is treated as in-period (the ledger sheet does the same)
        // rather than silently dropped from both opening and period figures.
        if (inv.invoice_date && inv.invoice_date < fromDate) { if (isCN) a.openingCr += amt; else a.openingDr += amt; }
        else if (!inv.invoice_date || inv.invoice_date <= toDate) { if (isCN) a.credit += amt; else a.debit += amt; }
      }
      for (const rec of receipts || []) {
        if (!rec.client_id) continue;
        const a = atom(rec.client_id, rec.firm_id);
        // Q2: GST-TDS deducted by the client also settles the invoice.
        const amt = Number(rec.amount_received || 0) + Number(rec.tds_amount || 0) + Number(rec.gst_tds_amount || 0);
        if (!amt) continue;
        if (rec.receipt_date && rec.receipt_date < fromDate) a.openingCr += amt;
        else if (rec.receipt_date && rec.receipt_date >= fromDate && rec.receipt_date <= toDate) a.credit += amt;
      }
      // Kasar (write-off / discount) — treated as credit reducing outstanding balance
      for (const k of kasars || []) {
        if (!k.client_id) continue;
        const a = atom(k.client_id, k.firm_id);
        const amt = Number(k.amount || 0);
        if (!amt) continue;
        if (k.kasar_date && k.kasar_date < fromDate) a.openingCr += amt;
        else if (k.kasar_date && k.kasar_date >= fromDate && k.kasar_date <= toDate) a.credit += amt;
      }

      // Fetch only the clients with activity, in chunks (URL length).
      const ids = Array.from(new Set(Array.from(atoms.values()).map(a => a.clientId)));
      const clientMap = new Map<string, { name: string; email: string | null }>();
      for (let i = 0; i < ids.length; i += 150) {
        const { data: cData, error: cErr } = await supabase
          .from("clients").select("id, name, email").in("id", ids.slice(i, i + 150));
        if (cErr) throw cErr;
        for (const c of cData || []) clientMap.set(c.id, { name: c.name || "—", email: c.email ?? null });
      }

      // Client groups (for the group-wise view).
      const { data: gData } = await (supabase as any).from("client_groups")
        .select("id, name, firm_id")
        .or(`firm_id.in.(${firmIds.join(",")}),firm_id.is.null`)
        .order("name");
      const gNames: Record<string, string> = {};
      for (const g of gData || []) gNames[g.id] = g.name;
      const gIds = Object.keys(gNames);
      const members = gIds.length
        ? await fetchAllRows<any>(() => (supabase as any).from("client_group_memberships")
            .select("client_id, group_id").in("group_id", gIds))
        : [];
      const gOf: Record<string, string[]> = {};
      for (const m of members) (gOf[m.client_id] ||= []).push(m.group_id);
      setGroupNames(gNames);
      setGroupsOfClient(gOf);

      const built: ClientRow[] = Array.from(atoms.values())
        .filter(a => clientMap.has(a.clientId))
        .map(a => ({
          id: a.clientId, firmId: a.firmId,
          name: clientMap.get(a.clientId)!.name, email: clientMap.get(a.clientId)!.email,
          ob: a.ob, openingDr: a.openingDr, openingCr: a.openingCr, debit: a.debit, credit: a.credit,
        }));

      setRows(built);
    } catch (e: any) {
      toast.error(e.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmIdsKey, fromDate, toDate]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  // ── Net opening = manual OB + pre-period invoices − pre-period receipts ──

  function netOpening(r: Balances) {
    return r.ob + r.openingDr - r.openingCr;
  }
  function netClosing(r: Balances) {
    return netOpening(r) + r.debit - r.credit;
  }

  // ── Fetch ledger for sheet ────────────────────────────────────────────────

  const firmTagFor = (multiFirm: boolean) => (fid: string) =>
    multiFirm ? `[${firms.find(f => f.id === fid)?.name ?? "Firm"}] ` : "";

  async function openLedger(client: DisplayRow): Promise<LedgerEntry[]> {
    const ledgerFirms = client.firmIds;
    setSheetClient(client);
    setSheetEntries([]);
    setSheetLoading(true);
    try {
      const [
        { data: invData },
        { data: recData },
        obResult,
        { data: kasarData },
      ] = await Promise.all([
        supabase.from("invoices")
          .select("id, firm_id, invoice_no, invoice_date, total_amount, document_type")
          .eq("client_id", client.id)
          .in("firm_id", ledgerFirms)
          // Q3: exclude quotations / proformas from the ledger sheet.
          .in("document_type", ["invoice", "credit_note"])
          .in("status", BILLABLE_STATUSES)
          .or(`invoice_date.is.null,and(invoice_date.gte.${fromDate},invoice_date.lte.${toDate})`)
          .order("invoice_date"),
        supabase.from("billing_receipts")
          .select("id, firm_id, receipt_date, amount_received, tds_amount, gst_tds_amount, payment_mode, remarks")
          .eq("client_id", client.id)
          .in("firm_id", ledgerFirms)
          .gte("receipt_date", fromDate)
          .lte("receipt_date", toDate)
          .order("receipt_date"),
        (supabase as any).from("client_billing_opening_balances")
          .select("amount, balance_date, narration")
          .eq("client_id", client.id)
          .in("firm_id", ledgerFirms)
          .is("gstin", null),
        (supabase as any).from("billing_kasars")
          .select("id, firm_id, kasar_date, amount, narration")
          .eq("client_id", client.id)
          .in("firm_id", ledgerFirms)
          .gte("kasar_date", fromDate)
          .lte("kasar_date", toDate)
          .order("kasar_date"),
      ]);

      // One opening-balance row per firm; several when the view spans firms.
      const obRows: any[] = obResult?.data || [];
      const entries = composeLedgerEntries({
        // opening = manual OB + pre-period invoices − pre-period receipts
        opening: netOpening(client),
        obDate: obRows.map(r => r.balance_date).filter(Boolean).sort()[0] || fromDate,
        obNarration: obRows.length === 1 && obRows[0].narration ? obRows[0].narration : "Opening Balance",
        invoices: (invData || []) as RawInvoice[],
        receipts: (recData || []) as RawReceipt[],
        kasars: (kasarData || []) as RawKasar[],
        fromDate,
        firmTag: firmTagFor(ledgerFirms.length > 1),
      });
      setSheetEntries(entries);
      return entries;
    } catch (e: any) {
      toast.error("Could not load ledger: " + e.message);
      return [];
    } finally {
      setSheetLoading(false);
    }
  }

  // ── Group statement of account ────────────────────────────────────────────
  // One document for a whole client group: a summary by client (receipts, TDS,
  // kasar and credit notes in their own columns) followed by each client's ledger.

  /** Sum the loaded (client, firm) balances of one group into a group row. */
  function buildGroupRow(groupId: string, name: string): DisplayRow {
    const row: DisplayRow = {
      key: `group:${groupId}`, kind: "group", id: groupId, name, email: null,
      firmIds: [], atomKeys: [], clientCount: 0, ...emptyBalances(),
    };
    const clientSet = new Set<string>();
    const firmSet = new Set<string>();
    for (const a of rows) {
      if (!(groupsOfClient[a.id] ?? []).includes(groupId)) continue;
      addBalances(row, a);
      row.atomKeys.push(`${a.id}|${a.firmId}`);
      clientSet.add(a.id);
      firmSet.add(a.firmId);
    }
    row.clientCount = clientSet.size;
    row.firmIds = Array.from(firmSet);
    return row;
  }

  type GroupStatementClient = { clientId: string; name: string; entries: LedgerEntry[] };

  async function loadGroupStatement(group: DisplayRow): Promise<GroupStatementClient[]> {
    const atomKeys = new Set(group.atomKeys);
    const atoms = rows.filter(a => atomKeys.has(`${a.id}|${a.firmId}`));
    const clientIds = Array.from(new Set(atoms.map(a => a.id)));
    const groupFirms = group.firmIds;

    const invoices: (RawInvoice & { client_id: string })[] = [];
    const receipts: (RawReceipt & { client_id: string })[] = [];
    const kasars: (RawKasar & { client_id: string })[] = [];
    const obs: any[] = [];
    for (let i = 0; i < clientIds.length; i += 100) {
      const chunk = clientIds.slice(i, i + 100);
      const [inv, rec, kas, ob] = await Promise.all([
        fetchAllRows<any>(() => supabase.from("invoices")
          .select("id, client_id, firm_id, invoice_no, invoice_date, total_amount, document_type")
          .in("client_id", chunk).in("firm_id", groupFirms)
          .in("document_type", ["invoice", "credit_note"]).in("status", BILLABLE_STATUSES)
          .or(`invoice_date.is.null,and(invoice_date.gte.${fromDate},invoice_date.lte.${toDate})`)
          .order("invoice_date").order("id")),
        fetchAllRows<any>(() => supabase.from("billing_receipts")
          .select("id, client_id, firm_id, receipt_date, amount_received, tds_amount, gst_tds_amount, payment_mode, remarks")
          .in("client_id", chunk).in("firm_id", groupFirms)
          .gte("receipt_date", fromDate).lte("receipt_date", toDate)
          .order("receipt_date").order("id")),
        fetchAllRows<any>(() => (supabase as any).from("billing_kasars")
          .select("id, client_id, firm_id, kasar_date, amount, narration")
          .in("client_id", chunk).in("firm_id", groupFirms)
          .gte("kasar_date", fromDate).lte("kasar_date", toDate)
          .order("kasar_date").order("id")),
        fetchAllRows<any>(() => (supabase as any).from("client_billing_opening_balances")
          .select("id, client_id, amount, balance_date, narration")
          .in("client_id", chunk).in("firm_id", groupFirms).is("gstin", null)
          .order("id")),
      ]);
      invoices.push(...inv); receipts.push(...rec); kasars.push(...kas); obs.push(...ob);
    }

    const byClient = <T extends { client_id: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of list) { if (!m.has(r.client_id)) m.set(r.client_id, []); m.get(r.client_id)!.push(r); }
      return m;
    };
    const invBy = byClient(invoices), recBy = byClient(receipts), kasBy = byClient(kasars), obBy = byClient(obs);
    const tag = firmTagFor(groupFirms.length > 1);

    const out: GroupStatementClient[] = [];
    for (const clientId of clientIds) {
      const mine = atoms.filter(a => a.id === clientId);
      const clientObs = obBy.get(clientId) ?? [];
      const entries = composeLedgerEntries({
        opening: mine.reduce((sum, a) => sum + netOpening(a), 0),
        obDate: clientObs.map(r => r.balance_date).filter(Boolean).sort()[0] || fromDate,
        obNarration: clientObs.length === 1 && clientObs[0].narration ? clientObs[0].narration : "Opening Balance",
        invoices: invBy.get(clientId) ?? [], receipts: recBy.get(clientId) ?? [], kasars: kasBy.get(clientId) ?? [],
        fromDate, firmTag: tag,
      });
      if (entries.length > 0) out.push({ clientId, name: mine[0]?.name ?? "—", entries });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function generateGroupStatementPdf(group: DisplayRow, perClient: GroupStatementClient[]): Promise<{ base64: string; blob: Blob }> {
    const onlyFirm = group.firmIds.length === 1 ? firms.find(f => f.id === group.firmIds[0]) : null;
    return buildGroupStatementPdf({
      groupName: group.name,
      firmLabel: group.firmIds.map(id => firms.find(f => f.id === id)?.name ?? "").filter(Boolean).join(", "),
      logoDataUrl: onlyFirm?.logo_url ? await loadLogoBase64(onlyFirm.logo_url) : null,
      fromDate, toDate, perClient,
    });
  }

  const splitEmails = (v: string) => v.split(/[,;\s]+/).map(e => e.trim()).filter(Boolean);

  function openGroupEmail(group: DisplayRow) {
    const period = `${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}`;
    setGroupEmail(group);
    setGTo(""); setGCc("");
    setGSubject(`Statement of Account — ${group.name} — ${period}`);
    setGMsg(`Dear Sir/Madam,\n\nPlease find attached the statement of account for ${group.name} for the period ${period}.\n\nKindly review and revert if any discrepancies are noticed.\n\nRegards`);
  }

  /** Emails of the group's clients, offered as one-click suggestions for the To field. */
  const groupEmailSuggestions = useMemo(() => {
    if (!groupEmail) return [] as string[];
    const keys = new Set(groupEmail.atomKeys);
    const set = new Set<string>();
    for (const a of rows) if (a.email && keys.has(`${a.id}|${a.firmId}`)) set.add(a.email.trim());
    return Array.from(set).sort();
  }, [groupEmail, rows]);

  async function handleSendGroupEmail() {
    if (!groupEmail) return;
    const to = splitEmails(gTo);
    if (to.length === 0 || to.some(e => !e.includes("@"))) { toast.error("Enter at least one valid recipient email address"); return; }
    const cc = splitEmails(gCc).filter(e => !to.includes(e));
    setGSending(true);
    try {
      const perClient = await loadGroupStatement(groupEmail);
      if (perClient.length === 0) { toast.error("Nothing to send — no balances or transactions for this group in the period"); return; }
      const { base64 } = await generateGroupStatementPdf(groupEmail, perClient);
      const firmForSend = groupEmail.firmIds.length === 1 ? groupEmail.firmIds[0] : sendFirmId;
      const filename = `Statement_of_Account_${groupEmail.name.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40)}_${fromDate}_${toDate}.pdf`;

      const sent: string[] = [];
      const failed: { addr: string; reason: string }[] = [];
      for (const [idx, addr] of to.entries()) {
        const { data, error } = await supabase.functions.invoke("send-notification", {
          body: {
            type: "ledger_statement",
            firm_id: firmForSend,
            direct_email: addr,
            // CC once (with the first recipient), not once per To address.
            ...(idx === 0 && cc.length > 0 ? { custom_cc: cc } : {}),
            payload: {
              client_name: groupEmail.name,
              custom_subject: gSubject || `Statement of Account — ${groupEmail.name}`,
              custom_message: gMsg,
              pdf_base64: base64,
              pdf_filename: filename,
            },
          },
        });
        // supabase-js does not throw on a failed delivery — read the real per-recipient status.
        const delivery = (data as any)?.results?.direct?.email;
        if (error) {
          let reason = error.message || "Send failed";
          try { const ctx = await (error as any).context?.json?.(); if (ctx?.error) reason = ctx.error; } catch { /* ignore */ }
          failed.push({ addr, reason });
        } else if (delivery?.status !== "sent") {
          failed.push({ addr, reason: delivery?.error || "Delivery failed" });
        } else {
          sent.push(addr);
        }
      }
      if (failed.length === 0) {
        toast.success(`Statement of account for ${groupEmail.name} sent to ${sent.join(", ")}${cc.length ? ` + ${cc.length} CC` : ""}`);
        setGroupEmail(null);
      } else {
        toast.error("Failed to send: " + failed.map(f => `${f.addr} — ${f.reason}`).join("; "));
        if (sent.length > 0) toast.success(`Sent to ${sent.join(", ")}`);
      }
    } catch (e: any) {
      toast.error("Group email failed: " + e.message);
    } finally {
      setGSending(false);
    }
  }

  // ── Derived / sorted list ─────────────────────────────────────────────────

  // Atoms → displayed rows for the chosen view.
  const displayRows = useMemo<DisplayRow[]>(() => {
    const out = new Map<string, DisplayRow & { _clients: Set<string>; _firms: Set<string> }>();
    const add = (kind: ViewBy, id: string, name: string, email: string | null, a: ClientRow) => {
      const key = `${kind}:${id}`;
      let d = out.get(key);
      if (!d) {
        d = { key, kind, id, name, email, firmIds: [], atomKeys: [], clientCount: 0,
              ...emptyBalances(), _clients: new Set(), _firms: new Set() };
        out.set(key, d);
      }
      addBalances(d, a);
      d.atomKeys.push(`${a.id}|${a.firmId}`);
      d._clients.add(a.id);
      d._firms.add(a.firmId);
    };
    for (const a of rows) {
      const groups = groupsOfClient[a.id]?.length ? groupsOfClient[a.id] : [NO_GROUP];
      if (viewBy === "client") {
        if (groupFilter && !groups.includes(groupFilter.id)) continue;
        add("client", a.id, a.name, a.email, a);
      } else if (viewBy === "firm") {
        add("firm", a.firmId, firms.find(f => f.id === a.firmId)?.name ?? "—", null, a);
      } else {
        // A client in several groups shows under each; totals still count it once.
        for (const g of groups) add("group", g, g === NO_GROUP ? "Not in any group" : (groupNames[g] ?? "—"), null, a);
      }
    }
    return Array.from(out.values()).map(({ _clients, _firms, ...d }) =>
      ({ ...d, clientCount: _clients.size, firmIds: Array.from(_firms) }));
  }, [rows, viewBy, groupFilter, groupsOfClient, groupNames, firms]);

  const filtered = useMemo(() => {
    let r = displayRows;
    if (search) r = r.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    if (hideZero) r = r.filter(c => {
      const open  = netOpening(c);
      const close = netClosing(c);
      return Math.abs(close) > 0.005 || c.debit > 0 || c.credit > 0 || Math.abs(open) > 0.005;
    });
    return [...r].sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      if (sortKey === "name")    { va = a.name; vb = b.name; }
      else if (sortKey === "debit")  { va = a.debit; vb = b.debit; }
      else if (sortKey === "credit") { va = a.credit; vb = b.credit; }
      else { va = netClosing(a); vb = netClosing(b); }
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [displayRows, search, hideZero, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  // Sum each underlying (client, firm) atom once — in the group view a client
  // in two groups appears twice, but must not be counted twice.
  const grandTotal = useMemo(() => {
    const keys = new Set(filtered.flatMap(r => r.atomKeys));
    let openNet = 0, debit = 0, credit = 0;
    for (const a of rows) {
      if (!keys.has(`${a.id}|${a.firmId}`)) continue;
      openNet += netOpening(a); debit += a.debit; credit += a.credit;
    }
    return { openNet, debit, credit, closeNet: openNet + debit - credit, clients: new Set(Array.from(keys).map(k => k.split("|")[0])).size };
  }, [filtered, rows]);

  const isAllFirms = selectedFirmId === ALL_FIRMS;
  const selectedFirmName = isAllFirms ? "All firms (combined)" : firms.find(f => f.id === selectedFirmId)?.name ?? "";
  const viewLabel = viewBy === "firm" ? "Firm-wise" : viewBy === "group" ? "Client group-wise" : groupFilter ? `Group: ${groupFilter.name}` : "Client-wise";
  // Firm to send email/Telegram as: the selected firm, or the user's home firm for "All firms".
  const sendFirmId = isAllFirms ? (user?.firm_id ?? firms[0]?.id ?? "") : selectedFirmId;

  function handleRowClick(r: DisplayRow) {
    if (r.kind === "client") { openLedger(r); return; }
    if (r.kind === "firm") { setSelectedFirmId(r.id); setViewBy("client"); setGroupFilter(null); return; }
    setGroupFilter({ id: r.id, name: r.name }); setViewBy("client");
  }

  // ── Big4 PDF ──────────────────────────────────────────────────────────────

  async function generateReportPdf(): Promise<{ base64: string; blob: Blob }> {
    const jsPDF   = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const DARK_BLUE: [number, number, number] = [26, 58, 92];

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);
    const logo = firmLogoUrl ? await loadLogoBase64(firmLogoUrl) : null;

    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 297, 24, "F");

    let textX = 14;
    if (logo) {
      try { doc.addImage(logo, logo.includes("image/png") ? "PNG" : "JPEG", 12, 2, 32, 20); textX = 50; }
      catch { /* ignore */ }
    }

    doc.setTextColor(255, 255, 255);
    setPdfUnicodeFont(doc, "bold"); doc.setFontSize(14);
    doc.text(`SUNDRY DEBTORS — ${viewLabel.toUpperCase()}`, textX, 10);
    setPdfUnicodeFont(doc, "normal"); doc.setFontSize(8);
    doc.text(selectedFirmName, textX, 16);
    doc.text(`Period: ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}   |   Generated: ${format(new Date(), "d MMM yyyy, HH:mm")}`, textX, 21);

    const { abs: gtCA, label: gtCL } = drCr(grandTotal.closeNet);
    doc.setFontSize(7);
    doc.text(`Clients: ${grandTotal.clients}   |   Net Receivable: ₹${fmtINR(gtCA)} ${gtCL}`, 283, 21, { align: "right" });

    const tableRows: any[][] = filtered.map(r => {
      const open  = netOpening(r);
      const close = netClosing(r);
      const { abs: oa, label: ol } = drCr(open);
      const { abs: ca, label: cl } = drCr(close);
      return [
        r.kind === "client" ? r.name : `${r.name} (${r.clientCount} client${r.clientCount !== 1 ? "s" : ""})`,
        open === 0 ? "—" : `${fmtINR(oa)} ${ol}`,
        r.debit  > 0 ? fmtINR(r.debit)  : "—",
        r.credit > 0 ? fmtINR(r.credit) : "—",
        close === 0 ? "—" : `${fmtINR(ca)} ${cl}`,
      ];
    });

    const { abs: gtOA, label: gtOL } = drCr(grandTotal.openNet);
    tableRows.push([
      { content: "GRAND TOTAL", styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number] } },
      { content: `${fmtINR(gtOA)} ${gtOL}`, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
      { content: fmtINR(grandTotal.debit),  styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
      { content: fmtINR(grandTotal.credit), styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
      { content: `${fmtINR(gtCA)} ${gtCL}`, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
    ]);

    autoTable(doc, {
      startY: 28,
      head: [[viewBy === "firm" ? "Firm" : viewBy === "group" ? "Client group" : "Particulars", "Opening Balance", "Debit (₹)", "Credit (₹)", "Closing Balance"]],
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8.5, cellPadding: 3, lineColor: [200,210,225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: [40,80,130], textColor: [255,255,255], fontStyle: "bold", halign: "center" },
      alternateRowStyles: { fillColor: [248,251,255] },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 42, halign: "right" as const },
        2: { cellWidth: 42, halign: "right" as const },
        3: { cellWidth: 42, halign: "right" as const },
        4: { cellWidth: 42, halign: "right" as const },
      },
      margin: { left: 14, right: 14 },
      didDrawPage: (hookData: any) => {
        const pc = (doc as any).internal.getNumberOfPages();
        doc.setFontSize(7); setPdfUnicodeFont(doc, "normal"); doc.setTextColor(120,130,145);
        doc.text(`Page ${hookData.pageNumber} of ${pc}   |   ${selectedFirmName}   |   Confidential`, 148, 208, { align: "center" });
        doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.4); doc.line(14, 204, 283, 204);
      },
    });

    const blob = doc.output("blob");
    const base64 = doc.output("datauristring").split(",")[1];
    return { base64, blob };
  }

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const { blob } = await generateReportPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `Sundry_Debtors_${viewBy}_${fromDate}_to_${toDate}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast.error("PDF failed: " + e.message); }
    finally { setExportingPdf(false); }
  }

  // ── Client ledger PDF ─────────────────────────────────────────────────────

  async function generateClientLedgerPdf(client: DisplayRow, entries: LedgerEntry[]): Promise<{ base64: string; blob: Blob }> {
    const jsPDF   = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const DARK_BLUE: [number, number, number] = [26, 58, 92];

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);
    const logo = firmLogoUrl ? await loadLogoBase64(firmLogoUrl) : null;

    doc.setFillColor(...DARK_BLUE); doc.rect(0, 0, 210, 24, "F");
    let textX = 14;
    if (logo) { try { doc.addImage(logo, logo.includes("image/png") ? "PNG" : "JPEG", 12, 2, 30, 20); textX = 48; } catch { /**/ } }

    doc.setTextColor(255, 255, 255);
    setPdfUnicodeFont(doc, "bold"); doc.setFontSize(13);
    doc.text("STATEMENT OF ACCOUNT", textX, 10);
    setPdfUnicodeFont(doc, "normal"); doc.setFontSize(8);
    doc.text(`${selectedFirmName}   |   Client: ${client.name}`, textX, 16);
    doc.text(`Period: ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}   |   Generated: ${format(new Date(), "d MMM yyyy HH:mm")}`, textX, 21);

    // Footer totals the rows actually printed, so Dr − Cr = closing balance.
    const totDr = entries.reduce((s, e) => s + e.debit, 0);
    const totCr = entries.reduce((s, e) => s + e.credit, 0);
    const close = entries.length ? entries[entries.length - 1].balance : netClosing(client);
    const tableRows = entries.map(e => [
      e.entry_date ? format(parseISO(e.entry_date), "dd/MM/yyyy") : "",
      e.doc_no, e.narration,
      e.debit  > 0 ? formatPdfCurrency(e.debit)  : "—",
      e.credit > 0 ? formatPdfCurrency(e.credit) : "—",
      formatPdfCurrency(e.balance),
    ]);

    const { abs: ca, label: cl } = drCr(close);
    tableRows.push([
      { content: "CLOSING BALANCE", colSpan: 3, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number] } },
      { content: formatPdfCurrency(totDr),  styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
      { content: formatPdfCurrency(totCr), styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
      { content: `${formatPdfCurrency(ca)} ${cl}`, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
    ]);

    autoTable(doc, {
      startY: 28,
      head: [["Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]],
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200,210,225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: [255,255,255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248,251,255] },
      columnStyles: {
        0: { cellWidth: 22, halign: "center" as const },
        1: { cellWidth: 22, halign: "center" as const },
        2: { cellWidth: 82 },
        3: { cellWidth: 24, halign: "right" as const },
        4: { cellWidth: 24, halign: "right" as const },
        5: { cellWidth: 24, halign: "right" as const },
      },
      margin: { left: 10, right: 10 },
      didDrawPage: (hookData: any) => {
        const pc = (doc as any).internal.getNumberOfPages();
        doc.setFontSize(7); setPdfUnicodeFont(doc, "normal"); doc.setTextColor(120,130,145);
        doc.text(`Page ${hookData.pageNumber} of ${pc}   |   CAFlow — Confidential`, 105, 290, { align: "center" });
        doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.4); doc.line(10, 287, 200, 287);
      },
    });

    const blob = doc.output("blob");
    const base64 = doc.output("datauristring").split(",")[1];
    return { base64, blob };
  }

  async function handleDownloadClientPdf() {
    if (!sheetClient) return;
    try {
      const { blob } = await generateClientLedgerPdf(sheetClient, sheetEntries);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `Statement_of_Account_${sheetClient.name.replace(/\s+/g, "_")}_${toDate}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast.error("PDF failed: " + e.message); }
  }

  // ── Email ─────────────────────────────────────────────────────────────────

  async function handleSendEmail() {
    if (!emailClient) return;
    setEmailSending(true);
    try {
      // ensure ledger is loaded for the email client
      // Use the freshly loaded rows — `sheetEntries` state is stale inside this closure.
      const entries = (!sheetClient || sheetClient.id !== emailClient.id)
        ? await openLedger(emailClient)
        : sheetEntries;
      const { base64 } = await generateClientLedgerPdf(emailClient, entries);
      const { data, error } = await supabase.functions.invoke("send-notification", {
        body: {
          type:         "ledger_statement",
          // A client seen across several firms is sent as the user's home firm.
          firm_id:      emailClient.firmIds.length === 1 ? emailClient.firmIds[0] : sendFirmId,
          direct_email: emailClient.email,
          payload: {
            client_name:    emailClient.name,
            custom_subject: `Statement of Account — ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}`,
            custom_message: `Please find attached your statement of account for the period ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}. Kindly review and revert if any discrepancies are noticed.`,
            pdf_base64:     base64,
            pdf_filename:   `Statement_of_Account_${emailClient.name.replace(/\s+/g, "_")}_${toDate}.pdf`,
          },
        },
      });
      if (error) throw new Error(error.message);
      // supabase-js does not throw on a failed delivery — check the real status.
      const delivery = (data as any)?.results?.direct?.email;
      if (delivery?.status !== "sent") throw new Error(delivery?.error || "Delivery failed");
      toast.success(`Ledger sent to ${emailClient.email}`);
      setEmailClient(null);
    } catch (e: any) { toast.error("Email failed: " + e.message); }
    finally { setEmailSending(false); }
  }

  // ── Telegram ──────────────────────────────────────────────────────────────

  async function handleSendTelegram() {
    setTgSending(true);
    try {
      const { base64 } = await generateReportPdf();
      const { error } = await supabase.functions.invoke("send-telegram-report", {
        body: {
          firm_id:    sendFirmId,
          pdf_base64: base64,
          filename:   `Sundry_Debtors_${viewBy}_${fromDate}_to_${toDate}.pdf`,
          caption:    `📊 *Sundry Debtors Report — ${viewLabel}*\n_${selectedFirmName}_\nPeriod: ${format(parseISO(fromDate), "d MMM yyyy")} → ${format(parseISO(toDate), "d MMM yyyy")}\nClients: ${grandTotal.clients}`,
        },
      });
      if (error) throw new Error(error.message);
      toast.success("Report sent to all linked Telegram users");
    } catch (e: any) { toast.error("Telegram failed: " + e.message); }
    finally { setTgSending(false); }
  }

  // ── Sort icon ─────────────────────────────────────────────────────────────

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown size={11} className="ml-1 opacity-40" />;
    return sortDir === "asc" ? <ChevronUp size={11} className="ml-1 text-orange-500" /> : <ChevronDown size={11} className="ml-1 text-orange-500" />;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const { abs: gtOA, label: gtOL } = drCr(grandTotal.openNet);
  const { abs: gtCA, label: gtCL } = drCr(grandTotal.closeNet);

  return (
    <div className="space-y-4">
      {/* ── Controls row ── */}
      <div className="flex flex-wrap items-end gap-3">

        {/* Firm dropdown */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground flex items-center gap-1"><Building2 size={11}/> Firm</Label>
          <Select value={selectedFirmId} onValueChange={setSelectedFirmId}>
            <SelectTrigger className="h-8 text-xs w-56">
              <SelectValue placeholder="Select firm…" />
            </SelectTrigger>
            <SelectContent>
              {firms.length > 1 && <SelectItem value={ALL_FIRMS}>All firms (combined)</SelectItem>}
              {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">View by</Label>
          <Select value={viewBy} onValueChange={v => { setViewBy(v as ViewBy); setGroupFilter(null); }}>
            <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="client">Client</SelectItem>
              <SelectItem value="group">Client group</SelectItem>
              <SelectItem value="firm">Firm</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={fetchReport} disabled={loading}>
          <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Apply
        </Button>

        <div className="flex-1" />

        <div className="relative w-48">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={viewBy === "firm" ? "Search firm…" : viewBy === "group" ? "Search group…" : "Search client…"} className="h-8 pl-8 pr-7 text-xs" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X size={11} /></button>}
        </div>

        <div className="flex items-center gap-1.5">
          <Switch id="hz" checked={hideZero} onCheckedChange={setHideZero} className="scale-75 origin-left" />
          <Label htmlFor="hz" className="text-xs cursor-pointer text-muted-foreground">Hide nil balance</Label>
        </div>

        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleExportPdf} disabled={exportingPdf || loading}>
          {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export PDF
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50" onClick={handleSendTelegram} disabled={tgSending || loading}>
          {tgSending ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />} Telegram
        </Button>
      </div>

      {/* ── Report frame ── */}
      <div className="rounded-lg border border-[#1A2744]/20 overflow-hidden shadow-sm">
        <div className="bg-[#1A2744] text-white px-5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm">Sundry Debtors — {viewLabel}</div>
            {groupFilter && (
              <div className="flex items-center gap-2">
                <button className="text-[11px] bg-white/15 hover:bg-white/25 rounded px-2 py-0.5 flex items-center gap-1"
                  onClick={() => openGroupEmail(buildGroupRow(groupFilter.id, groupFilter.name))}>
                  <Mail size={10} /> Email group statement
                </button>
                <button className="text-[11px] bg-white/15 hover:bg-white/25 rounded px-2 py-0.5 flex items-center gap-1"
                  onClick={() => { setGroupFilter(null); setViewBy("group"); }}>
                  <X size={10} /> Back to all groups
                </button>
              </div>
            )}
          </div>
          <div className="text-xs text-white/60">{selectedFirmName} · {format(parseISO(fromDate), "d-MMM-yy")} to {format(parseISO(toDate), "d-MMM-yy")}</div>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_150px_120px_120px_150px_44px] bg-muted/60 border-b px-4 py-2 text-[11px] font-semibold text-muted-foreground select-none">
          <button className="text-left flex items-center" onClick={() => toggleSort("name")}>{viewBy === "firm" ? "Firm" : viewBy === "group" ? "Client group" : "Particulars"} <SortIcon col="name" /></button>
          <div className="text-right">Opening Balance</div>
          <button className="flex items-center justify-end w-full" onClick={() => toggleSort("debit")}>Debit <SortIcon col="debit" /></button>
          <button className="flex items-center justify-end w-full" onClick={() => toggleSort("credit")}>Credit <SortIcon col="credit" /></button>
          <button className="flex items-center justify-end w-full" onClick={() => toggleSort("closing")}>Closing Balance <SortIcon col="closing" /></button>
          <div />
        </div>

        {/* Body */}
        <div className="divide-y">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_150px_120px_120px_150px_44px] px-4 py-2.5 gap-2">
                <Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-full ml-auto" />
                <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-8 mx-auto" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <Users className="mx-auto h-10 w-10 mb-3 opacity-20" />
              No clients with balances found for this period.
            </div>
          ) : (
            filtered.map((r, idx) => {
              const open  = netOpening(r);
              const close = netClosing(r);
              const { abs: oa, label: ol } = drCr(open);
              const { abs: ca, label: cl } = drCr(close);

              return (
                <div
                  key={r.key}
                  className={cn(
                    "grid grid-cols-[1fr_150px_120px_120px_150px_44px] px-4 py-2.5 text-[12px] hover:bg-blue-50/50 cursor-pointer transition-colors",
                    idx % 2 === 0 ? "bg-white" : "bg-slate-50/50",
                  )}
                  onClick={() => handleRowClick(r)}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {r.kind === "firm" ? <Building2 size={11} className="text-muted-foreground flex-shrink-0" />
                      : r.kind === "group" ? <Users size={11} className="text-muted-foreground flex-shrink-0" />
                      : <FileText size={11} className="text-muted-foreground flex-shrink-0" />}
                    <span className="font-medium truncate text-[#1A2744] hover:underline">{r.name}</span>
                    {r.kind !== "client" && (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">{r.clientCount} client{r.clientCount !== 1 ? "s" : ""}</span>
                    )}
                    {r.kind === "client" && isAllFirms && r.firmIds.length > 1 && (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">{r.firmIds.length} firms</span>
                    )}
                  </div>
                  <div className="text-right tabular-nums">
                    {open === 0 ? <span className="text-muted-foreground">—</span> : (
                      <>{fmtINR(oa)}&nbsp;<span className={cn("text-[10px]", ol === "Cr" ? "text-green-600" : "text-orange-600")}>{ol}</span></>
                    )}
                  </div>
                  <div className="text-right tabular-nums">{r.debit > 0 ? fmtINR(r.debit) : <span className="text-muted-foreground">—</span>}</div>
                  <div className="text-right tabular-nums">{r.credit > 0 ? fmtINR(r.credit) : <span className="text-muted-foreground">—</span>}</div>
                  <div className="text-right tabular-nums font-semibold">
                    {close === 0 ? <span className="text-muted-foreground">—</span> : (
                      <>{fmtINR(ca)}&nbsp;<span className={cn("text-[10px]", cl === "Cr" ? "text-green-600" : "text-orange-600")}>{cl}</span></>
                    )}
                  </div>
                  <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
                    {r.kind === "client" && r.email && (
                      <button title={`Email statement of account to ${r.email}`} className="p-1 rounded text-muted-foreground hover:text-blue-600 hover:bg-blue-50" onClick={() => setEmailClient(r)}>
                        <Mail size={12} />
                      </button>
                    )}
                    {r.kind === "group" && r.id !== NO_GROUP && (
                      <button title={`Email the whole ${r.name} group statement of account`} className="p-1 rounded text-muted-foreground hover:text-blue-600 hover:bg-blue-50" onClick={() => openGroupEmail(r)}>
                        <Mail size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Grand Total */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-[1fr_150px_120px_120px_150px_44px] px-4 py-3 bg-[#1A2744] text-white text-[12px] font-bold">
            <div className="flex items-center gap-1.5">
              <TrendingUp size={13} className="text-orange-400" /> Grand Total
              <span className="text-[10px] font-normal text-white/60 ml-1">({grandTotal.clients} client{grandTotal.clients !== 1 ? "s" : ""})</span>
            </div>
            <div className="text-right tabular-nums">
              {fmtINR(gtOA)}&nbsp;<span className={cn("text-[10px] font-normal", gtOL === "Cr" ? "text-green-300" : "text-orange-300")}>{gtOL}</span>
            </div>
            <div className="text-right tabular-nums">{fmtINR(grandTotal.debit)}</div>
            <div className="text-right tabular-nums">{fmtINR(grandTotal.credit)}</div>
            <div className="text-right tabular-nums">
              {fmtINR(gtCA)}&nbsp;<span className={cn("text-[10px] font-normal", gtCL === "Cr" ? "text-green-300" : "text-orange-300")}>{gtCL}</span>
            </div>
            <div />
          </div>
        )}
      </div>

      <div className="flex gap-4 text-[11px] text-muted-foreground">
        <span><span className="text-orange-600 font-semibold">Dr</span> = owed to firm</span>
        <span><span className="text-green-600 font-semibold">Cr</span> = advance/overpaid</span>
        <span>{viewBy === "client" ? "Click row → ledger detail" : `Click a ${viewBy === "firm" ? "firm" : "group"} → its clients`}</span>
        {viewBy === "group" && <span>A client in several groups is listed under each; the grand total counts it once</span>}
        <span><Mail size={10} className="inline" /> = email statement of account ({viewBy === "group" ? "whole group" : "client"})</span>
      </div>

      {/* ── Client Ledger Sheet ── */}
      <Sheet open={!!sheetClient} onOpenChange={open => { if (!open) setSheetClient(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col">
          <SheetHeader className="bg-[#1A2744] text-white px-6 py-4 flex-shrink-0">
            <SheetTitle className="text-white flex items-center justify-between">
              <div>
                <div className="text-base font-bold">{sheetClient?.name}</div>
                <div className="text-xs text-white/60 font-normal mt-0.5">
                  Statement of Account · {format(parseISO(fromDate), "d MMM yyyy")} to {format(parseISO(toDate), "d MMM yyyy")}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-8 text-[#1A2744] text-xs gap-1 bg-white/90 hover:bg-white" onClick={handleDownloadClientPdf}>
                  <Download size={12} /> PDF
                </Button>
                {sheetClient?.email && (
                  <Button size="sm" variant="outline" className="h-8 text-[#1A2744] text-xs gap-1 bg-white/90 hover:bg-white" onClick={() => setEmailClient(sheetClient)}>
                    <Mail size={12} /> Email
                  </Button>
                )}
              </div>
            </SheetTitle>
          </SheetHeader>

          {sheetClient && (
            <div className="grid grid-cols-4 border-b bg-slate-50 flex-shrink-0">
              {(() => {
                const open  = netOpening(sheetClient);
                const close = netClosing(sheetClient);
                return [
                  { label: "Opening", net: open },
                  { label: "Debit",   net: sheetClient.debit },
                  { label: "Credit",  net: -sheetClient.credit },
                  { label: "Closing", net: close },
                ].map(card => {
                  const { abs, label } = drCr(card.net);
                  return (
                    <div key={card.label} className="px-4 py-3 border-r last:border-r-0 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{card.label}</div>
                      <div className={cn("font-semibold text-sm tabular-nums", label === "Cr" ? "text-green-700" : card.net === 0 ? "text-muted-foreground" : "text-orange-700")}>
                        {card.net === 0 ? "Nil" : `₹${fmtINR(abs)}`}
                      </div>
                      {card.net !== 0 && <div className={cn("text-[9px]", label === "Cr" ? "text-green-600" : "text-orange-600")}>{label}</div>}
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {sheetClient && !sheetLoading && (() => {
            // Credits split by kind, so receipts, TDS and kasar read as separate amounts.
            const sum = (...kinds: LedgerEntryKind[]) =>
              sheetEntries.filter(e => e.kind && kinds.includes(e.kind)).reduce((t, e) => t + e.credit, 0);
            const parts: { label: string; amount: number }[] = [
              { label: "Receipts", amount: sum("receipt") },
              { label: "TDS", amount: sum("tds") },
              { label: "GST TDS", amount: sum("gst_tds") },
              { label: "Kasar", amount: sum("kasar") },
              { label: "Credit notes", amount: sum("credit_note") },
            ].filter(x => x.amount > 0.005);
            if (parts.length === 0) return null;
            return (
              <div className="px-4 py-1.5 border-b bg-slate-50/60 text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 flex-shrink-0">
                <span className="font-medium">Credit made up of:</span>
                {parts.map(x => <span key={x.label}>{x.label} <span className="tabular-nums text-foreground">₹{fmtINR(x.amount)}</span></span>)}
              </div>
            );
          })()}

          <div className="flex-1 overflow-auto">
            {sheetLoading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading ledger…
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground w-24">Date</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-24">Doc No</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Narration</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground w-28">Debit (₹)</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground w-28">Credit (₹)</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground w-28">Balance (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sheetEntries.length === 0 ? (
                    <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No transactions in this period</td></tr>
                  ) : (
                    sheetEntries.map((e, i) => {
                      const { abs: ba, label: bl } = drCr(e.balance);
                      return (
                        <tr key={i} className={cn(i % 2 === 0 ? "bg-white" : "bg-slate-50/50", "hover:bg-blue-50/30")}>
                          <td className="px-4 py-2 tabular-nums text-muted-foreground">{e.entry_date ? format(parseISO(e.entry_date), "dd/MM/yy") : ""}</td>
                          <td className="px-2 py-2 font-mono text-muted-foreground"><DocLink docNo={e.doc_no} documentId={e.doc_id} entryType={e.doc_type} /></td>
                          <td className="px-2 py-2 text-foreground">{e.narration}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.debit  > 0 ? fmtINR(e.debit)  : <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.credit > 0 ? fmtINR(e.credit) : <span className="text-muted-foreground">—</span>}</td>
                          <td className={cn("px-4 py-2 text-right tabular-nums font-semibold", bl === "Cr" ? "text-green-700" : e.balance === 0 ? "text-muted-foreground" : "text-orange-700")}>
                            {e.balance === 0 ? "Nil" : `${fmtINR(ba)} ${bl}`}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Email dialog ── */}
      {/* ── Group statement email dialog ── */}
      <Dialog open={!!groupEmail} onOpenChange={open => { if (!open && !gSending) setGroupEmail(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Mail size={16} className="text-blue-600" /> Email Group Statement of Account</DialogTitle>
          </DialogHeader>
          {groupEmail && (
            <div className="space-y-3 py-1">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{groupEmail.name}</span> — {groupEmail.clientCount} client{groupEmail.clientCount !== 1 ? "s" : ""}
                {groupEmail.firmIds.length > 1 ? ` across ${groupEmail.firmIds.length} firms` : ""} · {format(parseISO(fromDate), "d MMM yyyy")} → {format(parseISO(toDate), "d MMM yyyy")}.
                One PDF goes to the addresses below: a summary by client, then each client's ledger.
              </p>
              <div className="space-y-1">
                <Label htmlFor="g-email-to" className="text-xs">To <span className="text-destructive">*</span></Label>
                <Input id="g-email-to" value={gTo} onChange={e => setGTo(e.target.value)} placeholder="email@example.com, another@example.com" className="h-8 text-xs" />
                {groupEmailSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="text-[11px] text-muted-foreground">Client emails:</span>
                    {groupEmailSuggestions.map(em => {
                      const picked = splitEmails(gTo).includes(em);
                      return (
                        <button key={em} type="button"
                          onClick={() => setGTo(picked ? splitEmails(gTo).filter(x => x !== em).join(", ") : [...splitEmails(gTo), em].join(", "))}
                          className={cn("px-2 py-0.5 rounded-full text-[11px] border", picked ? "bg-primary text-primary-foreground border-primary" : "bg-muted hover:bg-muted/70")}>
                          {em}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] text-amber-700">The statement lists every client in the group with their balances — send it only to someone entitled to see all of them.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="g-email-cc" className="text-xs">CC <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="g-email-cc" value={gCc} onChange={e => setGCc(e.target.value)} placeholder="cc@example.com" className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="g-email-subject" className="text-xs">Subject</Label>
                <Input id="g-email-subject" value={gSubject} onChange={e => setGSubject(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="g-email-msg" className="text-xs">Message</Label>
                <Textarea id="g-email-msg" rows={6} value={gMsg} onChange={e => setGMsg(e.target.value)} className="text-xs" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={gSending} onClick={() => setGroupEmail(null)}>Cancel</Button>
            <Button size="sm" disabled={gSending || !gTo.trim()} onClick={handleSendGroupEmail} className="gap-1.5">
              {gSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {gSending ? "Preparing & sending…" : "Send Group Statement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!emailClient} onOpenChange={open => { if (!open && !emailSending) setEmailClient(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Mail size={16} className="text-blue-600" /> Send Statement of Account</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-2 py-1">
            <p>Send statement of account PDF to <span className="font-semibold text-foreground">{emailClient?.name}</span>?</p>
            <p className="text-xs">Recipient: <span className="font-mono">{emailClient?.email}</span></p>
            <p className="text-xs">Period: {format(parseISO(fromDate), "d MMM yyyy")} → {format(parseISO(toDate), "d MMM yyyy")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={emailSending} onClick={() => setEmailClient(null)}>Cancel</Button>
            <Button size="sm" disabled={emailSending} onClick={handleSendEmail} className="gap-1.5">
              {emailSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {emailSending ? "Sending…" : "Send Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
