import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { Download } from "lucide-react";

interface ClientOption { id: string; name: string | null; }
interface UserOption { id: string; name: string | null; }

interface AuditEntry {
  id: string; filing_id: string | null; firm_id: string | null;
  action_type: string; old_value: string | null; new_value: string | null;
  changed_by: string | null; changed_by_name: string | null;
  changed_at: string | null; remark: string | null;
}

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
}

const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];
const ACTION_TYPES = ["STATUS_CHANGE", "NOTE_ADDED", "TAN_UPDATED", "DEACTIVATED"];

export function TdsAuditLog({ clients, users, isSuperadmin, resolveFirmId }: Props) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filingMap, setFilingMap] = useState<Record<string, any>>({});

  // Filters
  const [clientFilter, setClientFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_filing_audit_log").select("*").order("changed_at", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (actionFilter !== "all") q = q.eq("action_type", actionFilter);
    if (userFilter !== "all") q = q.eq("changed_by", userFilter);
    if (dateFrom) q = q.gte("changed_at", dateFrom);
    if (dateTo) q = q.lte("changed_at", dateTo + "T23:59:59");
    const { data } = await q;
    setEntries((data || []) as AuditEntry[]);

    // Fetch filing details for display
    const filingIds = [...new Set((data || []).map((e: any) => e.filing_id).filter(Boolean))];
    if (filingIds.length > 0) {
      const { data: filings } = await supabase.from("tds_filings")
        .select("id, client_id, tds_forms, quarter, financial_year")
        .in("id", filingIds);
      const map: Record<string, any> = {};
      (filings || []).forEach((f: any) => { map[f.id] = f; });
      setFilingMap(map);
    }
    setLoading(false);
  }, [isSuperadmin, resolveFirmId, actionFilter, userFilter, dateFrom, dateTo]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const filteredEntries = entries.filter(e => {
    if (clientFilter !== "all") {
      const filing = e.filing_id ? filingMap[e.filing_id] : null;
      if (!filing || filing.client_id !== clientFilter) return false;
    }
    return true;
  });

  const exportLog = () => {
    const rows = filteredEntries.map(e => {
      const filing = e.filing_id ? filingMap[e.filing_id] : null;
      const client = filing ? clients.find(c => c.id === filing.client_id) : null;
      return `<tr>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.changed_at ? format(new Date(e.changed_at), "dd/MM/yyyy HH:mm") : "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${client?.name || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${filing?.tds_forms?.join(", ") || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${filing?.quarter || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.changed_by_name || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.action_type}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.old_value || "—"} → ${e.new_value || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.remark || "—"}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>TDS Audit Log</title><style>body{font-family:system-ui;margin:20px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;font-size:11px;border:1px solid #ccc;padding:4px}@media print{@page{size:landscape}}</style></head><body>
      <h2>TDS Filing Audit Log</h2>
      <table><thead><tr><th>Date+Time</th><th>Client</th><th>Form</th><th>Quarter</th><th>User</th><th>Action</th><th>Old → New</th><th>Remark</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const w = window.open(URL.createObjectURL(blob), "_blank");
    if (w) setTimeout(() => w.print(), 500);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">Audit Log</h2>
        <p className="text-sm text-muted-foreground">All status changes, notes, and actions across TDS filings</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Action Type</Label>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {ACTION_TYPES.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">User</Label>
          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" className="w-[140px] h-9" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" className="w-[140px] h-9" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1" onClick={exportLog}>
          <Download size={14} /> Export
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date + Time</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Quarter</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Old → New</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                )) : filteredEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No audit log entries found.
                    </TableCell>
                  </TableRow>
                ) : filteredEntries.map(e => {
                  const filing = e.filing_id ? filingMap[e.filing_id] : null;
                  const client = filing ? clients.find(c => c.id === filing.client_id) : null;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {e.changed_at ? format(new Date(e.changed_at), "dd/MM/yyyy HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{client?.name || "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{filing?.tds_forms?.join(", ") || "—"}</Badge></TableCell>
                      <TableCell className="text-xs">{filing?.quarter || "—"}</TableCell>
                      <TableCell className="text-sm">{e.changed_by_name || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">{e.action_type}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {e.old_value || e.new_value ? (
                          <span>{e.old_value || "—"} → {e.new_value || "—"}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{e.remark || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
