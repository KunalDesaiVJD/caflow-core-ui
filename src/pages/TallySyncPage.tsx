import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuditContext } from "@/hooks/useAuditContext";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock,
  Database, Wifi, WifiOff, Building2, FileText, Layers, Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncBatch {
  id: string;
  status: string;
  tally_company: string | null;
  financial_year: string | null;
  groups_fetched: number;
  ledgers_fetched: number;
  tb_rows_fetched: number;
  vouchers_fetched: number;
  started_at: string;
  completed_at: string | null;
  warnings: unknown[] | null;
}

interface RowCounts {
  groups: number;
  ledgers: number;
  trial_balance: number;
  vouchers: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function statusColor(status: string) {
  if (status === "complete" || status === "success") return "text-emerald-600";
  if (status === "complete_with_warnings") return "text-amber-600";
  if (status === "failed") return "text-red-600";
  if (status === "running" || status === "processing") return "text-blue-600";
  return "text-muted-foreground";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "complete" || status === "success")
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "complete_with_warnings")
    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (status === "failed")
    return <XCircle className="h-4 w-4 text-red-600" />;
  if (status === "running" || status === "processing")
    return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TallySyncPage() {
  const { selectedEngagementId, selectedEngagement } = useAuditContext();
  const { user } = useAuth();
  const { toast } = useToast();

  const [batches, setBatches] = useState<SyncBatch[]>([]);
  const [rowCounts, setRowCounts] = useState<RowCounts>({ groups: 0, ledgers: 0, trial_balance: 0, vouchers: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(false);

  // ── Load batch history + row counts ────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!selectedEngagementId) return;
    setLoading(true);

    const [batchRes, grpRes, ledRes, tbRes, vchRes] = await Promise.all([
      supabase
        .from("sync_batches")
        .select("*")
        .eq("engagement_id", selectedEngagementId)
        .order("started_at", { ascending: false })
        .limit(20),
      supabase.from("tally_groups").select("id", { count: "exact", head: true }).eq("engagement_id", selectedEngagementId),
      supabase.from("tally_ledgers").select("id", { count: "exact", head: true }).eq("engagement_id", selectedEngagementId),
      supabase.from("tally_trial_balance").select("id", { count: "exact", head: true }).eq("engagement_id", selectedEngagementId),
      supabase.from("tally_vouchers").select("id", { count: "exact", head: true }).eq("engagement_id", selectedEngagementId),
    ]);

    if (batchRes.data) setBatches(batchRes.data as SyncBatch[]);
    setRowCounts({
      groups: grpRes.count ?? 0,
      ledgers: ledRes.count ?? 0,
      trial_balance: tbRes.count ?? 0,
      vouchers: vchRes.count ?? 0,
    });

    // Check for pending sync request
    const { data: pending } = await supabase
      .from("sync_requests" as any)
      .select("id")
      .eq("engagement_id", selectedEngagementId)
      .eq("status", "pending")
      .limit(1);
    setPendingRequest((pending as any[])?.length > 0);

    setLoading(false);
  }, [selectedEngagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Sync Now ────────────────────────────────────────────────────────────────
  async function handleSyncNow() {
    if (!selectedEngagementId || !selectedEngagement) {
      toast({ title: "Select an engagement first", variant: "destructive" });
      return;
    }
    setSyncing(true);
    const { error } = await supabase
      .from("sync_requests" as any)
      .insert({
        engagement_id: selectedEngagementId,
        firm_id: (selectedEngagement as any).firm_id ?? null,
        client_id: (selectedEngagement as any).client_id ?? null,
        requested_by: user?.id ?? null,
        status: "pending",
      });

    if (error) {
      toast({ title: "Failed to queue sync request", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "Sync queued",
        description: "The local Tally sync agent will pick this up on its next run. Run node auto-setup.js to trigger immediately.",
      });
      setPendingRequest(true);
    }
    setSyncing(false);
  }

  // ── Latest batch ────────────────────────────────────────────────────────────
  const latest = batches[0];
  const hasData = rowCounts.ledgers > 0 || rowCounts.groups > 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="h-6 w-6 text-sidebar-gold" />
            Tally Sync
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sync Tally data into CAFlow for this engagement
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleSyncNow}
            disabled={syncing || !selectedEngagementId || pendingRequest}
            className="bg-sidebar-gold hover:bg-sidebar-gold/90 text-white"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} />
            {pendingRequest ? "Sync Queued…" : "Sync Now"}
          </Button>
        </div>
      </div>

      {/* Status + Row Count Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Last Sync Status */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Last Sync
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latest ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusIcon status={latest.status} />
                  <span className={cn("text-sm font-semibold capitalize", statusColor(latest.status))}>
                    {latest.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{fmtDate(latest.started_at)}</p>
                {latest.tally_company && (
                  <p className="text-xs font-medium truncate">{latest.tally_company}</p>
                )}
                {(latest.warnings as any[])?.length > 0 && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">
                    {(latest.warnings as any[]).length} warning{(latest.warnings as any[]).length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No sync yet</p>
            )}
          </CardContent>
        </Card>

        {/* Row Count Cards */}
        {[
          { label: "Groups", value: rowCounts.groups, icon: Layers },
          { label: "Ledgers", value: rowCounts.ledgers, icon: FileText },
          { label: "Trial Balance", value: rowCounts.trial_balance, icon: Database },
          { label: "Vouchers", value: rowCounts.vouchers, icon: Receipt },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={cn("text-2xl font-bold", value > 0 ? "text-foreground" : "text-muted-foreground")}>
                {value.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Diagnostic Panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Diagnostics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-4">
            <DiagItem
              label="Engagement"
              ok={!!selectedEngagementId}
              detail={selectedEngagementId ? (selectedEngagement as any)?.financial_year ?? selectedEngagementId.slice(0, 8) + "…" : "None selected"}
              icon={Building2}
            />
            <DiagItem
              label="Tally Data"
              ok={hasData}
              detail={hasData ? `${rowCounts.ledgers} ledgers in DB` : "No data synced yet"}
              icon={hasData ? Wifi : WifiOff}
            />
            <DiagItem
              label="Pending Request"
              ok={pendingRequest}
              detail={pendingRequest ? "Waiting for sync agent" : "None queued"}
              icon={Clock}
              neutral={!pendingRequest}
            />
          </div>
          {!hasData && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
              <strong>No Tally data found.</strong> Make sure:
              <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                <li>Tally is open on this machine with the correct company</li>
                <li>Tally XML server is enabled on port 9000</li>
                <li>Run <code className="bg-amber-100 px-1 rounded">node auto-setup.js</code> in <code className="bg-amber-100 px-1 rounded">C:\Users\kvdes\Desktop\CA FLOW\tally-sync\</code></li>
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Batch History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync History</CardTitle>
          <CardDescription>Last 20 sync batches for this engagement</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : batches.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No sync history yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>FY</TableHead>
                  <TableHead className="text-right">Groups</TableHead>
                  <TableHead className="text-right">Ledgers</TableHead>
                  <TableHead className="text-right">TB Rows</TableHead>
                  <TableHead className="text-right">Vouchers</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={b.status} />
                        <span className={cn("text-xs capitalize", statusColor(b.status))}>
                          {b.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs max-w-[140px] truncate">{b.tally_company ?? "—"}</TableCell>
                    <TableCell className="text-xs">{b.financial_year ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs">{b.groups_fetched ?? 0}</TableCell>
                    <TableCell className="text-right text-xs">{b.ledgers_fetched ?? 0}</TableCell>
                    <TableCell className="text-right text-xs">{b.tb_rows_fetched ?? 0}</TableCell>
                    <TableCell className="text-right text-xs">{b.vouchers_fetched ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(b.started_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(b.completed_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* How to run locally */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Run Sync Agent Locally</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            The sync agent runs on your local machine where Tally is open. Open a terminal and run:
          </p>
          <pre className="bg-muted text-xs rounded p-3 overflow-x-auto">
{`cd "C:\\Users\\kvdes\\Desktop\\CA FLOW\\tally-sync"
node auto-setup.js`}
          </pre>
          <p className="text-xs text-muted-foreground mt-2">
            Or for a quick re-sync without setup: <code className="bg-muted px-1 rounded">node sync-engine.js</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── DiagItem ─────────────────────────────────────────────────────────────────

function DiagItem({
  label, ok, detail, icon: Icon, neutral,
}: {
  label: string; ok: boolean; detail: string; icon: React.ElementType; neutral?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-start gap-3 p-3 rounded-md border",
      neutral ? "border-border bg-muted/30" :
      ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
    )}>
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0",
        neutral ? "text-muted-foreground" :
        ok ? "text-emerald-600" : "text-red-500"
      )} />
      <div>
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
