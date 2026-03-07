import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  CalendarIcon, Plus, Pencil, Trash2, Sparkles,
  FileText, IndianRupee, AlertTriangle, Clock,
} from "lucide-react";

// ─── Constants ───
const SECTIONS = [
  { value: "194C", label: "194C — Contractor", rate: 2 },
  { value: "194J(a)", label: "194J(a) — Technical 2%", rate: 2 },
  { value: "194J(b)", label: "194J(b) — Professional 10%", rate: 10 },
  { value: "194I(a)", label: "194I(a) — Rent Machinery 2%", rate: 2 },
  { value: "194I(b)", label: "194I(b) — Rent Building 10%", rate: 10 },
  { value: "194H", label: "194H — Commission 2%", rate: 2 },
  { value: "194Q", label: "194Q — Purchase Goods 0.1%", rate: 0.1 },
  { value: "194T", label: "194T — Partner Salary 10%", rate: 10 },
  { value: "194A", label: "194A — Interest 10%", rate: 10 },
  { value: "194IB", label: "194IB — Rent Individual 5%", rate: 5 },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  paid: "bg-amber-100 text-amber-700",
  filed: "bg-emerald-100 text-emerald-700",
};

const FY_OPTIONS = ["2025-26", "2024-25", "2023-24", "2022-23"];

interface TdsEntry {
  id: string;
  party_name: string | null;
  pan: string | null;
  section: string | null;
  tds_amount: number | null;
  tds_rate: number | null;
  challan_no: string | null;
  date: string | null;
  due_date: string | null;
  filed_at: string | null;
  payment_nature: string | null;
  amount: number | null;
  status: string | null;
  firm_id: string | null;
  client_id: string | null;
  deductee_id: string | null;
}

interface Deductee {
  id: string;
  party_name: string;
  pan: string | null;
  pan_valid: boolean | null;
}

const emptyForm = {
  date: "",
  party_name: "",
  pan: "",
  payment_nature: "",
  amount: "",
  section: "",
  tds_rate: "",
  tds_amount: "",
  due_date: "",
  challan_no: "",
  deductee_id: "",
};

const TdsFilings = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  // Data
  const [entries, setEntries] = useState<TdsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deductees, setDeductees] = useState<Deductee[]>([]);

  // Filters
  const [fyFilter, setFyFilter] = useState("2024-25");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // AI suggest
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ section: string; rate: number; description: string } | null>(null);

  // Delete
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Deductee search
  const [deducteeSearch, setDeducteeSearch] = useState("");
  const [showDeducteeList, setShowDeducteeList] = useState(false);

  // Date picker
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dueDatePickerOpen, setDueDatePickerOpen] = useState(false);

  // ─── Fetch ───
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tds_entries")
      .select("*")
      .order("date", { ascending: false })
      .limit(500);
    if (!error) setEntries((data as TdsEntry[]) || []);
    setLoading(false);
  }, []);

  const fetchDeductees = useCallback(async () => {
    if (!user?.firm_id) return;
    const { data } = await supabase
      .from("deductees")
      .select("id, party_name, pan, pan_valid")
      .eq("firm_id", user.firm_id)
      .order("party_name");
    if (data) setDeductees(data as Deductee[]);
  }, [user?.firm_id]);

  useEffect(() => {
    fetchEntries();
    fetchDeductees();
  }, [fetchEntries, fetchDeductees]);

  // ─── Filtered entries ───
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      // FY filter based on date
      if (e.date) {
        const d = new Date(e.date);
        const month = d.getMonth(); // 0-indexed
        const year = d.getFullYear();
        const fyStart = month >= 3 ? year : year - 1;
        const fy = `${fyStart}-${String(fyStart + 1).slice(2)}`;
        if (fy !== fyFilter) return false;
      }
      if (sectionFilter !== "all" && e.section !== sectionFilter) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (searchQuery && !(e.party_name || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [entries, fyFilter, sectionFilter, statusFilter, searchQuery]);

  // ─── Stats ───
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      totalEntries: filtered.length,
      totalDeducted: filtered.reduce((s, e) => s + (e.tds_amount || 0), 0),
      pendingChallans: filtered.filter((e) => !e.challan_no).length,
      overdue: filtered.filter((e) => e.due_date && new Date(e.due_date) < today && !e.filed_at).length,
    };
  }, [filtered]);

  // ─── Form helpers ───
  const updateForm = (key: string, value: string) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Auto-compute TDS amount
      if (key === "amount" || key === "tds_rate") {
        const amt = parseFloat(key === "amount" ? value : next.amount) || 0;
        const rate = parseFloat(key === "tds_rate" ? value : next.tds_rate) || 0;
        next.tds_amount = String(Math.round(amt * rate / 100 * 100) / 100);
      }
      // Auto-fill rate when section changes
      if (key === "section") {
        const sec = SECTIONS.find((s) => s.value === value);
        if (sec) {
          next.tds_rate = String(sec.rate);
          const amt = parseFloat(next.amount) || 0;
          next.tds_amount = String(Math.round(amt * sec.rate / 100 * 100) / 100);
        }
      }
      return next;
    });
  };

  const selectDeductee = (d: Deductee) => {
    setForm((f) => ({
      ...f,
      party_name: d.party_name,
      pan: d.pan || "",
      deductee_id: d.id,
    }));
    setDeducteeSearch(d.party_name);
    setShowDeducteeList(false);
  };

  const filteredDeductees = deductees.filter((d) =>
    d.party_name.toLowerCase().includes(deducteeSearch.toLowerCase())
  );

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDeducteeSearch("");
    setAiSuggestion(null);
    setFormOpen(true);
  };

  const openEdit = (entry: TdsEntry) => {
    setEditingId(entry.id);
    setForm({
      date: entry.date || "",
      party_name: entry.party_name || "",
      pan: entry.pan || "",
      payment_nature: entry.payment_nature || "",
      amount: entry.amount != null ? String(entry.amount) : "",
      section: entry.section || "",
      tds_rate: entry.tds_rate != null ? String(entry.tds_rate) : "",
      tds_amount: entry.tds_amount != null ? String(entry.tds_amount) : "",
      due_date: entry.due_date || "",
      challan_no: entry.challan_no || "",
      deductee_id: entry.deductee_id || "",
    });
    setDeducteeSearch(entry.party_name || "");
    setAiSuggestion(null);
    setFormOpen(true);
  };

  // ─── AI Suggest ───
  const handleAiSuggest = async () => {
    if (!form.payment_nature.trim()) {
      toast({ title: "Enter payment nature first", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: { request_type: "tds_section_identifier", user_message: form.payment_nature },
      });
      if (error) throw error;
      if (data?.section) {
        setAiSuggestion({ section: data.section, rate: data.rate, description: data.description });
      } else {
        toast({ title: "AI couldn't determine section", description: data?.description || "Try being more specific." });
      }
    } catch (e: any) {
      toast({ title: "AI suggestion failed", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const acceptAiSuggestion = () => {
    if (!aiSuggestion) return;
    updateForm("section", aiSuggestion.section);
    // Rate is set by updateForm's section handler, but override with AI rate
    setForm((f) => {
      const amt = parseFloat(f.amount) || 0;
      return {
        ...f,
        section: aiSuggestion.section,
        tds_rate: String(aiSuggestion.rate),
        tds_amount: String(Math.round(amt * aiSuggestion.rate / 100 * 100) / 100),
      };
    });
    setAiSuggestion(null);
  };

  // ─── Save ───
  const handleSave = async () => {
    if (!form.party_name.trim()) {
      toast({ title: "Party name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // If new deductee, create it
      let deducteeId = form.deductee_id || null;
      if (!deducteeId && form.party_name.trim() && user?.firm_id) {
        const { data: newDed } = await supabase
          .from("deductees")
          .insert({ firm_id: user.firm_id, party_name: form.party_name.trim(), pan: form.pan || null })
          .select("id")
          .single();
        if (newDed) deducteeId = newDed.id;
      }

      const payload: any = {
        date: form.date || null,
        party_name: form.party_name.trim(),
        pan: form.pan || null,
        payment_nature: form.payment_nature || null,
        amount: form.amount ? parseFloat(form.amount) : null,
        section: form.section || null,
        tds_rate: form.tds_rate ? parseFloat(form.tds_rate) : null,
        tds_amount: form.tds_amount ? parseFloat(form.tds_amount) : null,
        due_date: form.due_date || null,
        challan_no: form.challan_no || null,
        deductee_id: deducteeId,
        status: form.challan_no ? "paid" : "pending",
      };

      if (!editingId) {
        payload.firm_id = user?.firm_id || null;
      }

      if (editingId) {
        const { error } = await supabase.from("tds_entries").update(payload).eq("id", editingId);
        if (error) throw error;
        toast({ title: "TDS entry updated" });
      } else {
        const { error } = await supabase.from("tds_entries").insert(payload);
        if (error) throw error;
        toast({ title: "TDS entry added" });
      }
      setFormOpen(false);
      fetchEntries();
      fetchDeductees();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete ───
  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("tds_entries").delete().eq("id", deleteId);
      if (error) throw error;
      toast({ title: "Entry deleted" });
      setDeleteId(null);
      fetchEntries();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  // ─── Render ───
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">TDS Filings</h1>
          <p className="text-sm text-muted-foreground">Track deductions, challans, and filing status.</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" /> Add Entry
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Entries", value: stats.totalEntries, icon: FileText, color: "" },
          { label: "Total TDS Deducted", value: `₹${stats.totalDeducted.toLocaleString("en-IN")}`, icon: IndianRupee, color: "" },
          { label: "Pending Challans", value: stats.pendingChallans, icon: Clock, color: "" },
          { label: "Overdue Filings", value: stats.overdue, icon: AlertTriangle, color: stats.overdue > 0 ? "text-destructive" : "" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground font-medium">{s.label}</p>
                <s.icon className={cn("h-4 w-4 text-muted-foreground", s.color)} />
              </div>
              <p className={cn("text-2xl font-display font-bold text-foreground", s.color)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3">
        <Select value={fyFilter} onValueChange={setFyFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="FY" /></SelectTrigger>
          <SelectContent>
            {FY_OPTIONS.map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={sectionFilter} onValueChange={setSectionFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Section" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sections</SelectItem>
            {SECTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.value}</SelectItem>)}
            <SelectItem value="Other">Other</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="filed">Filed</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Search party name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-[220px]"
        />
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Party Name</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>Payment Nature</TableHead>
                  <TableHead className="text-right">Amount (₹)</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead className="text-right">Rate %</TableHead>
                  <TableHead className="text-right">TDS (₹)</TableHead>
                  <TableHead>Challan No</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {entry.date ? format(new Date(entry.date), "dd MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell className="font-medium max-w-[160px] truncate">{entry.party_name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.pan || "—"}</TableCell>
                    <TableCell className="text-sm max-w-[140px] truncate">{entry.payment_nature || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.amount != null ? entry.amount.toLocaleString("en-IN") : "—"}
                    </TableCell>
                    <TableCell>
                      {entry.section ? <Badge variant="outline" className="text-[10px]">{entry.section}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{entry.tds_rate != null ? `${entry.tds_rate}%` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {entry.tds_amount != null ? `₹${entry.tds_amount.toLocaleString("en-IN")}` : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.challan_no || "—"}</TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px] capitalize", STATUS_COLORS[entry.status || "pending"])}>
                        {entry.status || "pending"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(entry)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <VersionHistoryPanel table_name="tds_entries" record_id={entry.id} />
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(entry.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      No TDS entries found for the selected filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Add/Edit Slide-over ─── */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display">{editingId ? "Edit TDS Entry" : "Add TDS Entry"}</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {/* Date */}
            <div>
              <label className="text-sm font-medium">Date</label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !form.date && "text-muted-foreground")}>
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {form.date ? format(new Date(form.date), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={form.date ? new Date(form.date) : undefined}
                    onSelect={(d) => { if (d) { updateForm("date", format(d, "yyyy-MM-dd")); setDatePickerOpen(false); } }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Party Name with autocomplete */}
            <div className="relative">
              <label className="text-sm font-medium">Party Name</label>
              <Input
                value={deducteeSearch}
                onChange={(e) => {
                  setDeducteeSearch(e.target.value);
                  updateForm("party_name", e.target.value);
                  updateForm("deductee_id", "");
                  setShowDeducteeList(true);
                }}
                onFocus={() => setShowDeducteeList(true)}
                placeholder="Type to search deductees..."
              />
              {showDeducteeList && deducteeSearch && filteredDeductees.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {filteredDeductees.slice(0, 8).map((d) => (
                    <button
                      key={d.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex justify-between"
                      onClick={() => selectDeductee(d)}
                    >
                      <span>{d.party_name}</span>
                      {d.pan && <span className="font-mono text-xs text-muted-foreground">{d.pan}</span>}
                    </button>
                  ))}
                  {filteredDeductees.length === 0 && deducteeSearch && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No match — will add as new deductee
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* PAN */}
            <div>
              <label className="text-sm font-medium">PAN</label>
              <div className="relative">
                <Input value={form.pan} onChange={(e) => updateForm("pan", e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
                {form.pan && form.pan.length === 10 && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan) && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs font-medium">✓ Valid</span>
                )}
                {form.pan && form.pan.length === 10 && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan) && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-destructive text-xs font-medium">✗ Invalid</span>
                )}
              </div>
            </div>

            {/* Payment Nature + AI Suggest */}
            <div>
              <label className="text-sm font-medium">Payment Nature</label>
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  value={form.payment_nature}
                  onChange={(e) => updateForm("payment_nature", e.target.value)}
                  placeholder="e.g. Professional consulting fees"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1"
                  onClick={handleAiSuggest}
                  disabled={aiLoading}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {aiLoading ? "..." : "AI Suggest"}
                </Button>
              </div>
            </div>

            {/* AI Suggestion callout */}
            {aiSuggestion && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                <p className="text-sm font-medium text-amber-800">
                  AI suggests: Section {aiSuggestion.section} at {aiSuggestion.rate}%
                </p>
                <p className="text-xs text-amber-700">{aiSuggestion.description}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="default" onClick={acceptAiSuggestion}>Accept</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAiSuggestion(null)}>Ignore</Button>
                </div>
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="text-sm font-medium">Amount (₹)</label>
              <Input type="number" value={form.amount} onChange={(e) => updateForm("amount", e.target.value)} placeholder="0" />
            </div>

            {/* Section */}
            <div>
              <label className="text-sm font-medium">Section</label>
              <Select value={form.section} onValueChange={(v) => updateForm("section", v)}>
                <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                <SelectContent>
                  {SECTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* TDS Rate */}
            <div>
              <label className="text-sm font-medium">TDS Rate (%)</label>
              <Input type="number" step="0.1" value={form.tds_rate} onChange={(e) => updateForm("tds_rate", e.target.value)} />
            </div>

            {/* TDS Amount */}
            <div>
              <label className="text-sm font-medium">TDS Amount (₹)</label>
              <Input type="number" value={form.tds_amount} onChange={(e) => updateForm("tds_amount", e.target.value)} />
            </div>

            {/* Due Date */}
            <div>
              <label className="text-sm font-medium">Due Date</label>
              <Popover open={dueDatePickerOpen} onOpenChange={setDueDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !form.due_date && "text-muted-foreground")}>
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {form.due_date ? format(new Date(form.due_date), "PPP") : "Pick due date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={form.due_date ? new Date(form.due_date) : undefined}
                    onSelect={(d) => { if (d) { updateForm("due_date", format(d, "yyyy-MM-dd")); setDueDatePickerOpen(false); } }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Challan No */}
            <div>
              <label className="text-sm font-medium">Challan No (optional)</label>
              <Input value={form.challan_no} onChange={(e) => updateForm("challan_no", e.target.value)} placeholder="e.g. 12345678" />
            </div>
          </div>

          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Update Entry" : "Save Entry"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete TDS Entry?</AlertDialogTitle>
            <AlertDialogDescription>This action will be logged in version history but the entry will be removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TdsFilings;
