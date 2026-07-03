/**
 * Shared findings table for the v2 scrutiny views.
 *
 * Renders a list of findings with the maker-checker query cell (Ticket 1.3) + the standard
 * detail/resolve/waive/link actions. Used by BOTH the templates-first view (drill-down under a
 * rule) and the per-ledger workpaper view (Ticket 1.4) — one implementation, no duplication.
 */

import { type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Send, Clock, CheckCircle2 } from "lucide-react";
import { type Finding } from "@/lib/scrutiny/scrutinyUi";
import { findingQueryState, canReviewQuery } from "@/lib/scrutiny/makerChecker";

export interface ScrutinyFindingsTableProps {
  findings: Finding[];
  queryByFinding: Record<string, { id: string; status: string }>;
  currentUserId: string | null;
  onDetails: (f: Finding) => void;
  onResolve: (id: string) => void;
  onWaive: (id: string) => void;
  onLink: (id: string) => void;
  onRaiseQuery: (f: Finding) => void;
  onApproveQuery: (f: Finding, queryId: string) => void;
  onRejectQuery: (f: Finding, queryId: string) => void;
  severityBadge: (s: string | null) => ReactNode;
  statusBadge: (s: string | null) => ReactNode;
}

export default function ScrutinyFindingsTable({
  findings, queryByFinding, currentUserId,
  onDetails, onResolve, onWaive, onLink, onRaiseQuery, onApproveQuery, onRejectQuery,
  severityBadge, statusBadge,
}: ScrutinyFindingsTableProps) {
  // Maker-checker cell: raise (maker) → draft → approve/reject (checker, must differ from maker)
  const renderQueryCell = (f: Finding) => {
    const st = findingQueryState(queryByFinding[f.id]?.status);
    const q = queryByFinding[f.id];
    if (st === "none") {
      return <Button size="sm" variant="outline" onClick={() => onRaiseQuery(f)}><Send size={12} className="mr-1" />Raise query</Button>;
    }
    if (st === "draft") {
      const canReview = canReviewQuery(f.actioned_by, currentUserId);
      return (
        <div className="flex items-center gap-1 justify-end flex-wrap">
          <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300 bg-amber-500/10"><Clock size={11} />Draft</Badge>
          {canReview && q ? (
            <>
              <Button size="sm" variant="ghost" className="text-green-600" onClick={() => onApproveQuery(f, q.id)}>Approve</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onRejectQuery(f, q.id)}>Reject</Button>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">needs another reviewer</span>
          )}
        </div>
      );
    }
    if (st === "approved") {
      return <Badge className="gap-1 bg-green-500/15 text-green-700 border-green-300"><CheckCircle2 size={11} />Query raised</Badge>;
    }
    return <Badge variant="outline" className="text-muted-foreground">Rejected</Badge>;
  };

  return (
    <div className="rounded-md border bg-muted/20">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Flag Message</TableHead>
            <TableHead className="w-20">Severity</TableHead>
            <TableHead className="w-20">Status</TableHead>
            <TableHead className="w-16">3CD</TableHead>
            <TableHead className="w-56 text-right">Query (maker-checker)</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {findings.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="max-w-[320px] truncate text-sm">{f.flag_message || "—"}</TableCell>
              <TableCell>{severityBadge(f.severity)}</TableCell>
              <TableCell>{statusBadge(f.status)}</TableCell>
              <TableCell className="text-xs">{f.clause_3cd || "—"}</TableCell>
              <TableCell className="text-right">{renderQueryCell(f)}</TableCell>
              <TableCell className="text-right">
                <div className="flex gap-1 justify-end flex-wrap">
                  <Button size="sm" variant="ghost" onClick={() => onDetails(f)}>Details</Button>
                  {f.status?.toLowerCase() !== "resolved" && (
                    <Button size="sm" variant="ghost" className="text-green-600" onClick={() => onResolve(f.id)}>Resolve</Button>
                  )}
                  {f.status?.toLowerCase() !== "waived" && (
                    <Button size="sm" variant="ghost" className="text-amber-600" onClick={() => onWaive(f.id)}>Waive</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => onLink(f.id)}>Link 3CD</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
