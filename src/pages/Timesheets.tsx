import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { format, startOfWeek, addDays, isSameDay, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, Plus, Clock, Percent, Trash2,
} from "lucide-react";

// ─── Types ───
interface TimesheetEntry {
  id: string;
  user_id: string | null;
  client_id: string | null;
  engagement_id: string | null;
  work_date: string | null;
  description: string | null;
  hours: number | null;
  billable: boolean | null;
}

interface ClientOption {
  id: string;
  name: string | null;
}

interface EngagementOption {
  id: string;
  client_id: string | null;
  financial_year: string | null;
  status: string | null;
}

interface UserOption {
  id: string;
  name: string | null;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const Timesheets = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const firmId = user?.firm_id;

  // Week navigation
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

  // Data
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Add entry form
  const [addDate, setAddDate] = useState<Date | null>(null);
  const [addClient, setAddClient] = useState("");
  const [addEngagement, setAddEngagement] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addHours, setAddHours] = useState("1");
  const [addBillable, setAddBillable] = useState(true);
  const [addSaving, setAddSaving] = useState(false);

  // Report filters
  const [reportMonth, setReportMonth] = useState(format(new Date(), "yyyy-MM"));
  const [reportUser, setReportUser] = useState("all");
  const [reportClient, setReportClient] = useState("all");
  const [reportEntries, setReportEntries] = useState<TimesheetEntry[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  // ─── Week dates ───
  const weekDates = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // ─── Fetch data ───
  const fetchClients = useCallback(async () => {
    let q = supabase.from("clients").select("id, name").eq("is_draft", false).is("deleted_at", null).order("name");
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setClients(data || []);
  }, [firmId, isSuperadmin]);

  const fetchEngagements = useCallback(async () => {
    let q = supabase.from("audit_engagements").select("id, client_id, financial_year, status");
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setEngagements(data || []);
  }, [firmId, isSuperadmin]);

  const fetchUsers = useCallback(async () => {
    if (isSuperadmin || user?.role === "firm_admin") {
      let q = supabase.from("users").select("id, name");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      setUsers(data || []);
    } else {
      setUsers(user ? [{ id: user.id, name: user.name }] : []);
    }
  }, [user, firmId, isSuperadmin]);

  const fetchWeekEntries = useCallback(async () => {
    setLoading(true);
    const from = format(weekDates[0], "yyyy-MM-dd");
    const to = format(weekDates[6], "yyyy-MM-dd");
    let q = supabase
      .from("timesheets")
      .select("*")
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date");
    if (!isSuperadmin) q = q.eq("user_id", user?.id);
    const { data } = await q;
    setEntries((data as TimesheetEntry[]) || []);
    setLoading(false);
  }, [weekDates, user?.id, isSuperadmin]);

  useEffect(() => {
    fetchClients();
    fetchEngagements();
    fetchUsers();
  }, [fetchClients, fetchEngagements, fetchUsers]);

  useEffect(() => { fetchWeekEntries(); }, [fetchWeekEntries]);

  // ─── Report fetch ───
  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    const [year, month] = reportMonth.split("-").map(Number);
    const monthStart = format(new Date(year, month - 1, 1), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(new Date(year, month - 1, 1)), "yyyy-MM-dd");

    let q = supabase
      .from("timesheets")
      .select("*")
      .gte("work_date", monthStart)
      .lte("work_date", monthEnd)
      .order("work_date");

    if (!isSuperadmin && !["firm_admin", "partner"].includes(user?.role || "")) {
      q = q.eq("user_id", user?.id);
    }
    if (reportUser !== "all") q = q.eq("user_id", reportUser);
    if (reportClient !== "all") q = q.eq("client_id", reportClient);

    const { data } = await q;
    setReportEntries((data as TimesheetEntry[]) || []);
    setReportLoading(false);
  }, [reportMonth, reportUser, reportClient, user, isSuperadmin]);

  // ─── Day entries & stats ───
  const dayEntries = useCallback((date: Date) =>
    entries.filter((e) => e.work_date && isSameDay(parseISO(e.work_date), date)), [entries]);

  const dayTotals = useMemo(() =>
    weekDates.map((d) => dayEntries(d).reduce((s, e) => s + (e.hours || 0), 0)), [weekDates, dayEntries]);

  const weekTotal = useMemo(() => dayTotals.reduce((s, t) => s + t, 0), [dayTotals]);
  const weekBillable = useMemo(() =>
    entries.filter((e) => e.billable).reduce((s, e) => s + (e.hours || 0), 0), [entries]);
  const utilisation = weekTotal > 0 ? Math.round((weekBillable / weekTotal) * 100) : 0;

  // ─── Client engagements for add form ───
  const clientEngagements = useMemo(() =>
    engagements.filter((e) => e.client_id === addClient), [engagements, addClient]);

  // ─── Add entry ───
  const handleAdd = async () => {
    if (!addDate || !addClient || !addDescription.trim()) {
      toast({ title: "Fill required fields", variant: "destructive" });
      return;
    }
    const hrs = parseFloat(addHours);
    if (isNaN(hrs) || hrs < 0 || hrs > 24) {
      toast({ title: "Hours must be between 0 and 24.", variant: "destructive" });
      return;
    }
    setAddSaving(true);
    try {
      const { error } = await supabase.from("timesheets").insert({
        user_id: user?.id,
        client_id: addClient,
        engagement_id: addEngagement || null,
        work_date: format(addDate, "yyyy-MM-dd"),
        description: addDescription.trim(),
        hours: hrs,
        billable: addBillable,
      });
      if (error) throw error;
      toast({ title: "Entry added" });
      setAddDate(null);
      setAddClient("");
      setAddEngagement("");
      setAddDescription("");
      setAddHours("1");
      setAddBillable(true);
      fetchWeekEntries();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAddSaving(false);
    }
  };

  // ─── Delete entry ───
  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("timesheets").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      fetchWeekEntries();
    }
  };

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name || "—";
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name || "—";
  const engagementLabel = (id: string | null) => {
    const e = engagements.find((eng) => eng.id === id);
    return e ? `${e.financial_year || "N/A"}` : "—";
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground mb-1">Timesheets</h1>
        <p className="text-sm text-muted-foreground">Log and track billable hours.</p>
      </div>

      <Tabs defaultValue="weekly">
        <TabsList>
          <TabsTrigger value="weekly">Weekly View</TabsTrigger>
          <TabsTrigger value="report" onClick={() => fetchReport()}>Report</TabsTrigger>
        </TabsList>

        {/* ═══ WEEKLY VIEW ═══ */}
        <TabsContent value="weekly" className="space-y-4 mt-4">
          {/* Week navigation */}
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => setWeekStart((w) => addDays(w, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium text-foreground">
              {format(weekDates[0], "dd MMM")} — {format(weekDates[6], "dd MMM yyyy")}
            </span>
            <Button variant="outline" size="icon" onClick={() => setWeekStart((w) => addDays(w, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
              Today
            </Button>
          </div>

          {/* Calendar Grid */}
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
              ) : (
                <div className="grid grid-cols-7 divide-x divide-border">
                  {weekDates.map((date, dayIdx) => {
                    const de = dayEntries(date);
                    const isToday = isSameDay(date, new Date());
                    return (
                      <div key={dayIdx} className={cn("min-h-[160px] flex flex-col", isToday && "bg-accent/30")}>
                        {/* Day header */}
                        <div className="px-2 py-1.5 border-b border-border text-center">
                          <p className="text-[10px] uppercase text-muted-foreground font-semibold">{WEEKDAYS[dayIdx]}</p>
                          <p className={cn("text-sm font-medium", isToday ? "text-primary" : "text-foreground")}>
                            {format(date, "d")}
                          </p>
                        </div>

                        {/* Entries */}
                        <div className="flex-1 p-1 space-y-1 overflow-y-auto max-h-[200px]">
                          {de.map((entry) => (
                            <div
                              key={entry.id}
                              className={cn(
                                "rounded px-1.5 py-1 text-[11px] leading-tight",
                                entry.billable
                                  ? "bg-primary/10 text-primary border border-primary/20"
                                  : "bg-muted text-muted-foreground border border-border"
                              )}
                            >
                              <p className="font-medium truncate">{clientName(entry.client_id)}</p>
                              <p className="truncate opacity-80">{entry.description}</p>
                              <div className="flex items-center justify-between mt-0.5">
                                <span className="font-semibold">{entry.hours}h</span>
                                <button
                                  onClick={() => handleDelete(entry.id)}
                                  className="text-destructive/60 hover:text-destructive"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Add button */}
                        <div className="p-1 border-t border-border">
                          <Popover
                            open={addDate ? isSameDay(addDate, date) : false}
                            onOpenChange={(open) => {
                              if (open) {
                                setAddDate(date);
                                setAddClient("");
                                setAddEngagement("");
                                setAddDescription("");
                                setAddHours("1");
                                setAddBillable(true);
                              } else {
                                setAddDate(null);
                              }
                            }}
                          >
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="sm" className="w-full h-6 text-[10px]">
                                <Plus size={10} className="mr-0.5" /> Add
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 p-3 space-y-3" align="start">
                              <p className="text-sm font-semibold text-foreground">
                                {format(date, "EEE, dd MMM yyyy")}
                              </p>

                              <div>
                                <label className="text-xs font-medium text-muted-foreground">Client *</label>
                                <Select value={addClient} onValueChange={(v) => { setAddClient(v); setAddEngagement(""); }}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                                  <SelectContent>
                                    {clients.map((c) => (
                                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <label className="text-xs font-medium text-muted-foreground">Engagement</label>
                                <Select value={addEngagement} onValueChange={setAddEngagement} disabled={!addClient}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Optional" /></SelectTrigger>
                                  <SelectContent>
                                    {clientEngagements.map((e) => (
                                      <SelectItem key={e.id} value={e.id} className="text-xs">
                                        {e.financial_year || "N/A"} — {e.status || "Active"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <label className="text-xs font-medium text-muted-foreground">Description *</label>
                                <Textarea
                                  value={addDescription}
                                  onChange={(e) => setAddDescription(e.target.value)}
                                  className="text-xs h-16 resize-none"
                                  placeholder="What was done..."
                                />
                              </div>

                              <div className="flex gap-2">
                                <div className="flex-1">
                                  <label className="text-xs font-medium text-muted-foreground">Hours *</label>
                                  <Input
                                    type="number"
                                    step="0.5"
                                    min="0.5"
                                    max="16"
                                    value={addHours}
                                    onChange={(e) => setAddHours(e.target.value)}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div className="flex items-end gap-2 pb-0.5">
                                  <Switch checked={addBillable} onCheckedChange={setAddBillable} />
                                  <span className="text-xs text-muted-foreground">Billable</span>
                                </div>
                              </div>

                              <Button
                                size="sm"
                                className="w-full"
                                onClick={handleAdd}
                                disabled={addSaving}
                              >
                                {addSaving ? "Saving..." : "Add Entry"}
                              </Button>
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Day totals */}
              <div className="grid grid-cols-7 divide-x divide-border border-t border-border bg-muted/40">
                {dayTotals.map((total, i) => (
                  <div key={i} className="px-2 py-1.5 text-center">
                    <span className={cn("text-xs font-semibold", total > 0 ? "text-foreground" : "text-muted-foreground")}>
                      {total > 0 ? `${total}h` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Weekly stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Total Hours</p>
                  <p className="text-lg font-bold text-foreground">{weekTotal.toFixed(1)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Billable Hours</p>
                  <p className="text-lg font-bold text-primary">{weekBillable.toFixed(1)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <Percent className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-xs text-muted-foreground">Utilisation</p>
                  <p className={cn("text-lg font-bold", utilisation >= 70 ? "text-emerald-600" : utilisation >= 40 ? "text-amber-600" : "text-destructive")}>
                    {utilisation}%
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══ REPORT TAB ═══ */}
        <TabsContent value="report" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-3">
            <Input
              type="month"
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value)}
              className="w-[180px]"
            />
            {(isSuperadmin || user?.role === "firm_admin" || user?.role === "partner") && (
              <Select value={reportUser} onValueChange={setReportUser}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="User" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name || "Unnamed"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={reportClient} onValueChange={setReportClient}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Client" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={fetchReport}>Apply</Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {reportLoading ? (
                <div className="p-6 space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Engagement</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead>Billable</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          No entries for this period.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {reportEntries.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-sm whitespace-nowrap">
                              {e.work_date ? format(parseISO(e.work_date), "dd MMM yyyy") : "—"}
                            </TableCell>
                            <TableCell className="text-sm">{userName(e.user_id)}</TableCell>
                            <TableCell className="text-sm font-medium">{clientName(e.client_id)}</TableCell>
                            <TableCell className="text-sm">{engagementLabel(e.engagement_id)}</TableCell>
                            <TableCell className="text-sm max-w-[200px] truncate">{e.description}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{e.hours}</TableCell>
                            <TableCell>
                              <Badge className={cn("text-[10px]", e.billable ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                                {e.billable ? "Yes" : "No"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleDelete(e.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals row */}
                        <TableRow className="bg-muted/40 font-semibold">
                          <TableCell colSpan={5} className="text-right text-sm">Totals</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {reportEntries.reduce((s, e) => s + (e.hours || 0), 0).toFixed(1)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {reportEntries.filter((e) => e.billable).reduce((s, e) => s + (e.hours || 0), 0).toFixed(1)} billable
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Timesheets;
