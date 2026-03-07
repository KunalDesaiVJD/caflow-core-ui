import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { callAdmin, LogEntry, OP_COLORS } from "./adminShared";

const AdminLogs = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logFilters, setLogFilters] = useState({
    user_name: "",
    table_name: "",
    operation: "",
    date_from: "",
    date_to: "",
  });

  useEffect(() => {
    if (!authLoading && (!user || user.role !== "superadmin")) {
      toast({ title: "Access Denied", variant: "destructive" });
      navigate("/", { replace: true });
    }
  }, [authLoading, user, navigate, toast]);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const params: Record<string, string> = { page: logsPage.toString() };
      if (logFilters.user_name) params.user_name = logFilters.user_name;
      if (logFilters.table_name) params.table_name = logFilters.table_name;
      if (logFilters.operation) params.operation = logFilters.operation;
      if (logFilters.date_from) params.date_from = logFilters.date_from;
      if (logFilters.date_to) params.date_to = logFilters.date_to;
      const res = await callAdmin("logs", "GET", undefined, params);
      setLogs(res.data || []);
      setLogsTotal(res.total || 0);
    } catch { /* handled */ } finally {
      setLoadingLogs(false);
    }
  }, [logsPage, logFilters]);

  useEffect(() => {
    if (user?.role === "superadmin") fetchLogs();
  }, [user, fetchLogs]);

  if (authLoading) {
    return <div className="p-6 space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  }
  if (!user || user.role !== "superadmin") return null;

  const totalPages = Math.ceil(logsTotal / 25);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">System Logs</h1>
        <p className="text-sm text-muted-foreground">Audit trail and version history</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
            <Input placeholder="User name..." value={logFilters.user_name} onChange={(e) => setLogFilters((f) => ({ ...f, user_name: e.target.value }))} />
            <Input placeholder="Table name..." value={logFilters.table_name} onChange={(e) => setLogFilters((f) => ({ ...f, table_name: e.target.value }))} />
            <Select value={logFilters.operation} onValueChange={(v) => setLogFilters((f) => ({ ...f, operation: v === "all" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder="Operation" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="INSERT">INSERT</SelectItem>
                <SelectItem value="UPDATE">UPDATE</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
                <SelectItem value="IMPERSONATE">IMPERSONATE</SelectItem>
                <SelectItem value="RESTORE">RESTORE</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={logFilters.date_from} onChange={(e) => setLogFilters((f) => ({ ...f, date_from: e.target.value }))} />
            <Input type="date" value={logFilters.date_to} onChange={(e) => setLogFilters((f) => ({ ...f, date_to: e.target.value }))} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingLogs ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead>Changed Fields</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">{log.user_name || "—"}</TableCell>
                      <TableCell>
                        {log.user_role ? <Badge variant="outline" className="text-[10px]">{log.user_role}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{log.table_name || "—"}</TableCell>
                      <TableCell>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${OP_COLORS[log.operation || ""] || "bg-muted text-muted-foreground"}`}>
                          {log.operation}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {log.changed_fields?.join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {log.created_at ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true }) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {logs.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No logs found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-4 border-t">
                  <p className="text-sm text-muted-foreground">Page {logsPage} of {totalPages} ({logsTotal} total)</p>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={logsPage <= 1} onClick={() => setLogsPage((p) => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" disabled={logsPage >= totalPages} onClick={() => setLogsPage((p) => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminLogs;
