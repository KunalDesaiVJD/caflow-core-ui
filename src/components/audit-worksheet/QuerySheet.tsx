/**
 * QuerySheet — Sheet 5
 * Live query list from audit_client_queries + correction gate.
 * Partners can mark all queries as verified before sign-off.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, ShieldAlert, Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WsMaster } from "./hooks/useWorksheetStorage";

interface Props {
  engagementId: string;
  master: WsMaster;
  setMaster: (field: keyof WsMaster, value: any) => void;
  saveMaster: (silent?: boolean) => Promise<boolean>;
  masterSaving: boolean;
}

interface AuditQuery {
  id: string;
  query_text: string;
  status: string;
  priority: string | null;
  raised_by_name: string | null;
  assigned_to_name: string | null;
  reply_text: string | null;
  replied_at: string | null;
  created_at: string;
}

const STATUS_CLASS: Record<string, string> = {
  open:     "bg-amber-100 text-amber-700",
  replied:  "bg-blue-100 text-blue-700",
  resolved: "bg-green-100 text-green-700",
  closed:   "bg-muted text-muted-foreground",
};

export default function QuerySheet({
  engagementId, master, setMaster, saveMaster, masterSaving,
}: Props) {
  const { user } = useAuth();
  const isPartner = user?.role === "partner" || user?.role === "firm_admin";

  const { data: queries = [], isLoading } = useQuery<AuditQuery[]>({
    queryKey: ["aws-queries", engagementId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("audit_client_queries")
        .select(
          "id, query_text, status, priority, reply_text, replied_at, created_at, " +
          "raised_by_name, assigned_to_name"
        )
        .eq("engagement_id", engagementId)
        .order("created_at");
      return data || [];
    },
    enabled: !!engagementId,
  });

  const openCount     = queries.filter(q => q.status === "open").length;
  const repliedCount  = queries.filter(q => q.status === "replied").length;
  const resolvedCount = queries.filter(q => q.status === "resolved" || q.status === "closed").length;
  const allResolved   = queries.length > 0 && openCount === 0 && repliedCount === 0;

  const handleToggleGate = async () => {
    const newVerified = !master.queries_verified;
    const now = new Date().toISOString();
    setMaster("queries_verified",    newVerified);
    setMaster("queries_verified_by", newVerified ? (user?.name || user?.email || null) : null);
    setMaster("queries_verified_at", newVerified ? now : null);
    await saveMaster(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Query Sheet</h3>
          <p className="text-xs text-muted-foreground">
            Live audit queries — all queries must be resolved before sign-off
          </p>
        </div>
        {/* Summary badges */}
        <div className="flex gap-2 flex-wrap">
          {openCount > 0 && (
            <Badge className="bg-amber-100 text-amber-700">{openCount} Open</Badge>
          )}
          {repliedCount > 0 && (
            <Badge className="bg-blue-100 text-blue-700">{repliedCount} Replied</Badge>
          )}
          <Badge className="bg-green-100 text-green-700">{resolvedCount} Resolved</Badge>
        </div>
      </div>

      {/* ── Correction Gate ── */}
      <Alert className={cn(
        "border",
        master.queries_verified
          ? "border-green-300 bg-green-50"
          : allResolved
          ? "border-blue-300 bg-blue-50"
          : "border-amber-300 bg-amber-50"
      )}>
        <div className="flex items-start gap-3">
          {master.queries_verified
            ? <ShieldCheck className="mt-0.5 text-green-600" size={20} />
            : <ShieldAlert className="mt-0.5 text-amber-600" size={20} />
          }
          <div className="flex-1">
            <AlertTitle className="text-sm font-semibold">
              {master.queries_verified ? "Queries Verified — Gate Closed" : "Queries Verification Required"}
            </AlertTitle>
            <AlertDescription className="text-xs mt-0.5 space-y-2">
              {master.queries_verified ? (
                <>
                  <p>
                    All queries verified by <strong>{master.queries_verified_by || "—"}</strong>
                    {master.queries_verified_at
                      ? ` on ${new Date(master.queries_verified_at).toLocaleString("en-IN")}`
                      : ""}
                  </p>
                  {master.queries_notes && (
                    <p className="italic">{master.queries_notes}</p>
                  )}
                  {isPartner && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 h-7 text-xs mt-1"
                      onClick={handleToggleGate}
                      disabled={masterSaving}
                    >
                      <Unlock size={12} /> Re-open Gate
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {!allResolved && openCount > 0 && (
                    <p className="text-amber-700">
                      There {openCount === 1 ? "is" : "are"} still{" "}
                      <strong>{openCount} open {openCount === 1 ? "query" : "queries"}</strong> that must be resolved.
                    </p>
                  )}
                  {allResolved && (
                    <p className="text-blue-700">All queries are resolved. Partner can now close the gate.</p>
                  )}
                  {isPartner && (
                    <div className="space-y-1 mt-1">
                      <Textarea
                        placeholder="Verification notes (optional)…"
                        rows={2}
                        className="text-xs"
                        value={master.queries_notes}
                        onChange={e => setMaster("queries_notes", e.target.value)}
                      />
                      <Button
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={handleToggleGate}
                        disabled={masterSaving || (!allResolved && openCount > 0)}
                      >
                        <Lock size={12} /> Close Gate — Mark Queries Verified
                      </Button>
                    </div>
                  )}
                  {!isPartner && (
                    <p className="text-muted-foreground">Only a Partner can close the verification gate.</p>
                  )}
                </>
              )}
            </AlertDescription>
          </div>
        </div>
      </Alert>

      {/* ── Query Table ── */}
      <div className="border rounded-lg overflow-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-8">#</TableHead>
              <TableHead className="min-w-[260px]">Query</TableHead>
              <TableHead className="min-w-[200px]">Client Reply</TableHead>
              <TableHead className="w-[90px]">Status</TableHead>
              <TableHead className="w-[100px]">Raised By</TableHead>
              <TableHead className="w-[100px]">Assigned To</TableHead>
              <TableHead className="w-[110px]">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8 text-sm">
                  Loading queries…
                </TableCell>
              </TableRow>
            ) : queries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8 text-sm">
                  No queries raised for this engagement yet.
                </TableCell>
              </TableRow>
            ) : queries.map((q, i) => (
              <TableRow key={q.id}>
                <TableCell className="text-xs font-mono">{i + 1}</TableCell>
                <TableCell>
                  <p className="text-sm">{q.query_text}</p>
                  {q.priority && (
                    <Badge className={cn("text-[10px] px-1 py-0 mt-1",
                      q.priority === "high" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
                    )}>
                      {q.priority}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <p className="text-xs text-muted-foreground">{q.reply_text || "—"}</p>
                  {q.replied_at && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(q.replied_at).toLocaleDateString("en-IN")}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_CLASS[q.status] || "")}>
                    {q.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{q.raised_by_name || "—"}</TableCell>
                <TableCell className="text-xs">{q.assigned_to_name || "—"}</TableCell>
                <TableCell className="text-xs">
                  {new Date(q.created_at).toLocaleDateString("en-IN")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
