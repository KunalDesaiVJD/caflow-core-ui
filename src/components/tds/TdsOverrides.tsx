/**
 * Overrides — a read-only, CROSS-CLIENT view of every manual
 * override made across Stage 1 (Validate & Finalise), Stage 2 (PAN
 * Verification) and Stage 3 (Tally Reconciliation), grouped by reason so a
 * recurring issue is visible without reading every filing one at a time.
 *
 * This is deliberately NOT a matching-logic change: it changes nothing about
 * how Stage 1/2/3 validate or reconcile anything. It surfaces data those
 * stages already write (the `overridden`/`override_reason` columns, per-stage
 * already used for a single loaded filing's own Checker Review) at the
 * cross-client scope no existing TDS screen reads at.
 *
 * Grouping is PER STAGE (stage is part of the group key), because each
 * stage's override reason comes from its own vocabulary — Stage 2 and Stage 3
 * each offer their own fixed list of canned reasons (plus "Other" free text),
 * Stage 1's is pure free text — so identical wording across stages is
 * coincidence, not a shared pattern, and merging them would overstate how
 * much repetition is really there.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isFilingTdsCompliant } from "@/lib/tdsQuarter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ChevronRight, Repeat2 } from "lucide-react";

interface ClientOption {
  id: string; name: string | null;
  tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string;
  tds_forms_applicable?: string[];
}
interface UserOption { id: string; name: string | null; }

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
}

type Stage = 1 | 2 | 3;

interface OverrideRecord {
  id: string; stage: Stage;
  clientId: string; financialYear: string; quarter: string; form: string;
  recordLabel: string; verdict: string; reason: string;
  overriddenBy: string | null; overriddenAt: string | null;
}

const STAGE_LABEL: Record<Stage, string> = {
  1: "Stage 1 · Validate & Finalise",
  2: "Stage 2 · PAN Verification",
  3: "Stage 3 · Tally Reconciliation",
};
const STAGE_BADGE: Record<Stage, string> = {
  1: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  2: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  3: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
const normalizeReason = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function TdsOverrides({ clients, users, isSuperadmin, resolveFirmId }: Props) {
  const [records, setRecords] = useState<OverrideRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<"all" | "1" | "2" | "3">("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const userMap = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name || "—"])), [users]);
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();

    let q1 = supabase.from("tds_recon_results")
      .select("id, filing_id, record_label, match_status, override_note, overridden_by, overridden_at").eq("overridden", true);
    let q2 = supabase.from("tds_pan_verification_results")
      .select("id, filing_id, party_name, validation_result, override_reason, overridden_by, overridden_at").eq("overridden", true);
    let q3 = supabase.from("tds_tally_results")
      .select("id, filing_id, office_name, tally_party, result, override_reason, overridden_by, overridden_at").eq("overridden", true);
    if (!isSuperadmin && firmId) {
      q1 = q1.eq("firm_id", firmId); q2 = q2.eq("firm_id", firmId); q3 = q3.eq("firm_id", firmId);
    }

    const [{ data: d1 }, { data: d2 }, { data: d3 }] = await Promise.all([q1, q2, q3]);

    // None of the three results tables carries client_id directly — join
    // through tds_filings, same pattern TdsAuditLog already uses.
    const filingIds = [...new Set([...(d1 || []), ...(d2 || []), ...(d3 || [])].map((r: any) => r.filing_id).filter(Boolean))];
    const filingMap: Record<string, any> = {};
    if (filingIds.length) {
      const { data: filings } = await supabase.from("tds_filings")
        .select("id, client_id, financial_year, quarter, tds_forms").in("id", filingIds);
      (filings || []).forEach((f: any) => { filingMap[f.id] = f; });
    }

    const recs: OverrideRecord[] = [];
    const push = (r: any, stage: Stage, recordLabel: string | null, verdict: string | null, reason: string | null) => {
      const f = filingMap[r.filing_id];
      if (!f) return;
      const client = clientMap[f.client_id];
      // Same TDS Compliance gate every other TDS screen applies — an
      // override on a since-de-configured form/quarter must not surface here.
      if (!client || !isFilingTdsCompliant(
        { client_id: f.client_id, financial_year: f.financial_year, quarter: f.quarter, tds_forms: f.tds_forms }, client,
      )) return;
      recs.push({
        id: `s${stage}-${r.id}`, stage, clientId: f.client_id,
        financialYear: f.financial_year, quarter: f.quarter, form: (f.tds_forms || [])[0] || "—",
        recordLabel: recordLabel || "—", verdict: verdict || "—",
        reason: (reason || "").trim() || "(no reason given)",
        overriddenBy: r.overridden_by || null, overriddenAt: r.overridden_at || null,
      });
    };
    // Stage 1's own reason column is named override_note (not override_reason
    // like Stage 2/3) — a real inconsistency in the underlying schema,
    // normalised away here rather than left for every future reader to trip on.
    for (const r of d1 || []) push(r, 1, r.record_label, r.match_status, r.override_note);
    for (const r of d2 || []) push(r, 2, r.party_name, r.validation_result, r.override_reason);
    for (const r of d3 || []) push(r, 3, r.office_name || r.tally_party, r.result, r.override_reason);

    setRecords(recs);
    setLoading(false);
  }, [isSuperadmin, resolveFirmId, clientMap]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = useMemo(() => records.filter((r) => {
    if (stageFilter !== "all" && String(r.stage) !== stageFilter) return false;
    if (clientFilter !== "all" && r.clientId !== clientFilter) return false;
    if (dateFrom && (!r.overriddenAt || r.overriddenAt < dateFrom)) return false;
    if (dateTo && (!r.overriddenAt || r.overriddenAt > dateTo + "T23:59:59")) return false;
    return true;
  }), [records, stageFilter, clientFilter, dateFrom, dateTo]);

  const patterns = useMemo(() => {
    const groups = new Map<string, { stage: Stage; reason: string; items: OverrideRecord[] }>();
    for (const r of filtered) {
      const key = `${r.stage}|${normalizeReason(r.reason)}`;
      const g = groups.get(key);
      if (g) g.items.push(r); else groups.set(key, { stage: r.stage, reason: r.reason, items: [r] });
    }
    return [...groups.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [filtered]);

  const distinctClients = useMemo(() => new Set(filtered.map((r) => r.clientId)).size, [filtered]);
  const recurringPatterns = patterns.filter((p) => p.items.length > 1).length;

  // Client filter should only list clients who actually have an override
  // somewhere in this view — not the firm's entire client roster, most of
  // whom have never had one (based on all fetched records, not `filtered`,
  // so switching the Stage/date filters doesn't make the Client dropdown
  // itself keep shrinking and forget the current selection).
  const clientsWithOverrides = useMemo(() => {
    const ids = new Set(records.map((r) => r.clientId));
    return clients.filter((c) => ids.has(c.id));
  }, [records, clients]);

  return (
    <div className="space-y-4">
      {/* Title lives on the parent's "Audit & Overrides" tab header — this
          screen only describes its own sub-tab. */}
      <p className="text-sm text-muted-foreground">
        Every manual override across Stage 1/2/3, across every client — grouped by reason so a recurring issue is
        visible before it's fixed one filing at a time. Read-only: nothing here changes any verdict.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Total overrides</p>
          <p className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-12" /> : filtered.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Clients affected</p>
          <p className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-12" /> : distinctClients}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Recurring patterns (2+ instances)</p>
          <p className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-12" /> : recurringPatterns}</p>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Stage</Label>
          <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as typeof stageFilter)}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              <SelectItem value="1">{STAGE_LABEL[1]}</SelectItem>
              <SelectItem value="2">{STAGE_LABEL[2]}</SelectItem>
              <SelectItem value="3">{STAGE_LABEL[3]}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clientsWithOverrides.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" className="w-[140px] h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" className="w-[140px] h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
        ) : patterns.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
            No overrides match these filters — nothing has needed a manual override here.
          </CardContent></Card>
        ) : patterns.map((p) => (
          <Card key={p.key} className={p.items.length > 1 ? "border-amber-200 dark:border-amber-900" : undefined}>
            <CardContent className="p-3">
              {/* Expands IN PLACE rather than opening a dialog: this is a
                  read-only list a reviewer scans down, so a modal that covers
                  it and has to be dismissed before looking at the next pattern
                  fought the way the page is actually used. */}
              <button
                className="w-full flex items-center gap-3 text-left"
                aria-expanded={openKey === p.key}
                onClick={() => setOpenKey(openKey === p.key ? null : p.key)}
              >
                <Badge className={`text-[10px] shrink-0 ${STAGE_BADGE[p.stage]}`}>{STAGE_LABEL[p.stage]}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.reason}</div>
                  {/* The PARTY is what identifies an override at a glance, so it
                      belongs on the collapsed row — not one click away. */}
                  <div className="text-[11px] text-muted-foreground truncate">
                    {[...new Set(p.items.map((i) => i.recordLabel).filter(Boolean))].slice(0, 3).join(" · ")}
                    {new Set(p.items.map((i) => i.recordLabel).filter(Boolean)).size > 3 && " …"}
                    {(() => {
                      const names = [...new Set(p.items.map((i) => clientMap[i.clientId]?.name).filter(Boolean))];
                      return names.length ? ` — ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}` : "";
                    })()}
                  </div>
                </div>
                {p.items.length > 1 && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 shrink-0">
                    <Repeat2 size={12} /> {p.items.length}× across {new Set(p.items.map((i) => i.clientId)).size} client
                    {new Set(p.items.map((i) => i.clientId)).size === 1 ? "" : "s"}
                  </span>
                )}
                {p.items.length === 1 && <span className="text-xs text-muted-foreground shrink-0">1 instance</span>}
                <ChevronRight
                  size={14}
                  className={`text-muted-foreground shrink-0 transition-transform ${openKey === p.key ? "rotate-90" : ""}`}
                />
              </button>

              {openKey === p.key && (
                <div className="mt-2 pt-2 border-t space-y-2">
                  {p.items
                    .slice()
                    .sort((a, b) => (b.overriddenAt || "").localeCompare(a.overriddenAt || ""))
                    .map((i) => (
                      <div key={i.id} className="flex items-center gap-2 text-xs border rounded-md px-2 py-1.5 flex-wrap">
                        <span className="font-medium min-w-0 truncate">{clientMap[i.clientId]?.name || "—"}</span>
                        <Badge variant="outline" className="text-[9px] shrink-0">{i.form} · {i.financialYear} {i.quarter}</Badge>
                        <span className="text-muted-foreground truncate">{i.recordLabel}</span>
                        <Badge variant="secondary" className="text-[9px] shrink-0">{humanize(i.verdict)}</Badge>
                        <div className="flex-1" />
                        <span className="text-muted-foreground shrink-0">
                          {i.overriddenBy ? userMap[i.overriddenBy] || "—" : "—"}
                          {i.overriddenAt ? ` · ${format(new Date(i.overriddenAt), "dd/MM/yyyy HH:mm")}` : ""}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

    </div>
  );
}
