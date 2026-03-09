import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  FileText, Plus, Clock, CheckCircle2, AlertTriangle, XCircle, Pencil, Trash2,
} from "lucide-react";

// ─── Types ───
interface ItrProfile {
  id: string;
  client_id: string | null;
  firm_id: string | null;
  financial_year: string | null;
  itr_form: string | null;
  filing_status: string | null;
  ais_recon_data: any;
  client_name?: string;
  entity_type?: string;
}

interface Client {
  id: string;
  name: string | null;
  entity_type: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "In Progress": "bg-amber-500/15 text-amber-600",
  Filed: "bg-emerald-500/15 text-emerald-600",
  Revised: "bg-blue-500/15 text-blue-600",
  Defective: "bg-destructive/15 text-destructive",
};

const ITR_FORMS = ["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6"];
const FILING_STATUSES = ["Not Started", "In Progress", "Filed", "Revised", "Defective"];

function suggestItrForm(entityType: string | null): string {
  if (!entityType) return "ITR-3";
  const t = entityType.toLowerCase();
  // Company types → ITR-6
  if (t.includes("private") || t.includes("public") || t.includes("company") || t.includes("ltd")) return "ITR-6";
  // LLP / Partnership → ITR-5
  if (t.includes("llp") || t.includes("partnership")) return "ITR-5";
  // Firm (non-LLP) → ITR-5
  if (t === "firm" || t.includes("partner")) return "ITR-5";
  // HUF → ITR-2
  if (t.includes("huf")) return "ITR-2";
  // Trust / AOP / BOI → ITR-5
  if (t.includes("trust") || t.includes("aop") || t.includes("boi")) return "ITR-5";
  // Individual / Proprietorship → ITR-3
  if (t.includes("individual") || t.includes("proprietor")) return "ITR-3";
  return "ITR-3";
}

const ItReturns = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";

  const [profiles, setProfiles] = useState<ItrProfile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [demands, setDemands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Form state
  const [formClientId, setFormClientId] = useState("");
  const [formFY, setFormFY] = useState("2024-25");
  const [formItrForm, setFormItrForm] = useState("ITR-3");
  const [formStatus, setFormStatus] = useState("Not Started");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);

  // Delete state
  const [deleteProfile, setDeleteProfile] = useState<ItrProfile | null>(null);

  const firmId = user?.firm_id;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch ITR profiles
      let pQuery = supabase.from("itr_profiles").select("*");
      if (!isSuperadmin && firmId) pQuery = pQuery.eq("firm_id", firmId);
      const { data: itrData } = await pQuery;

      // Fetch clients
      let cQuery = supabase.from("clients").select("id, name, entity_type");
      if (!isSuperadmin && firmId) cQuery = cQuery.eq("firm_id", firmId);
      const { data: clientData } = await cQuery;

      // Fetch demands
      const { data: demandData } = await supabase.from("itr_demands").select("*");

      const clientMap = new Map<string, Client>();
      (clientData || []).forEach((c) => clientMap.set(c.id, c));

      const enriched = (itrData || []).map((p) => ({
        ...p,
        client_name: clientMap.get(p.client_id || "")?.name || "Unknown",
        entity_type: clientMap.get(p.client_id || "")?.entity_type || "",
      }));

      setProfiles(enriched);
      setClients(clientData || []);
      setDemands(demandData || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [firmId, isSuperadmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Stats
  const total = profiles.length;
  const filed = profiles.filter((p) => p.filing_status === "Filed" || p.filing_status === "Revised").length;
  const inProgress = profiles.filter((p) => p.filing_status === "In Progress").length;
  const notStarted = profiles.filter((p) => p.filing_status === "Not Started" || !p.filing_status).length;
  const demandTotal = demands.reduce((s, d) => s + (d.demand_amount || 0), 0);
  const demandPending = demands.filter((d) => d.status !== "resolved").length;

  // Filter
  const filtered = profiles.filter((p) =>
    !search || (p.client_name || "").toLowerCase().includes(search.toLowerCase())
  );

  // Auto-suggest ITR form when client changes
  const handleClientChange = (clientId: string) => {
    setFormClientId(clientId);
    const client = clients.find((c) => c.id === clientId);
    setFormItrForm(suggestItrForm(client?.entity_type || null));
  };

  const handleSave = async () => {
    if (!formClientId) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("itr_profiles").insert({
        client_id: formClientId,
        firm_id: firmId || null,
        financial_year: formFY,
        itr_form: formItrForm,
        filing_status: formStatus,
      });
      if (error) throw error;
      toast({ title: "ITR profile created" });
      setSheetOpen(false);
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const stats = [
    { label: "Total Profiles", value: total, icon: FileText, color: "text-foreground" },
    { label: "Filed", value: filed, icon: CheckCircle2, color: "text-emerald-600" },
    { label: "In Progress", value: inProgress, icon: Clock, color: "text-amber-600" },
    { label: "Not Started", value: notStarted, icon: XCircle, color: "text-muted-foreground" },
    { label: "Demand Pending", value: demandPending, icon: AlertTriangle, color: "text-destructive", sub: `₹${demandTotal.toLocaleString("en-IN")}` },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">IT Returns</h1>
          <p className="text-muted-foreground text-sm">Income tax return filing and tracking</p>
        </div>
        <Button onClick={() => setSheetOpen(true)}>
          <Plus size={16} className="mr-2" /> Add ITR Profile
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {stats.map((s) => (
          <Card key={s.label} className={s.label === "Demand Pending" ? "border-destructive/30" : ""}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <s.icon size={16} className={s.color} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              {s.sub && <p className="text-xs text-destructive mt-1">{s.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <Input
          placeholder="Search by client name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client Name</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>ITR Form</TableHead>
                <TableHead>Filing Status</TableHead>
                <TableHead>AIS Reconciled</TableHead>
                <TableHead>Demand</TableHead>
                <TableHead>FY</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No ITR profiles found. Click "Add ITR Profile" to get started.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => {
                  const clientDemands = demands.filter((d) => d.client_id === p.client_id);
                  const demandAmt = clientDemands.reduce((s, d) => s + (d.demand_amount || 0), 0);
                  const aisReconciled = p.ais_recon_data && Object.keys(p.ais_recon_data).length > 0;

                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/itr/${p.client_id}`)}
                    >
                      <TableCell className="font-medium">{p.client_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{p.entity_type || "—"}</Badge>
                      </TableCell>
                      <TableCell>{p.itr_form || "—"}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[p.filing_status || "Not Started"] || STATUS_COLORS["Not Started"]}>
                          {p.filing_status || "Not Started"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {aisReconciled ? (
                          <CheckCircle2 size={16} className="text-emerald-600" />
                        ) : (
                          <XCircle size={16} className="text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        {demandAmt > 0 ? (
                          <span className="text-destructive font-medium">₹{demandAmt.toLocaleString("en-IN")}</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.financial_year || "—"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add ITR Profile Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add ITR Profile</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Client</label>
              <Select value={formClientId} onValueChange={handleClientChange}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} ({c.entity_type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Financial Year</label>
              <Select value={formFY} onValueChange={setFormFY}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["2024-25", "2023-24", "2022-23", "2021-22"].map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">ITR Form</label>
              <Select value={formItrForm} onValueChange={setFormItrForm}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ITR_FORMS.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formClientId && (
                <p className="text-xs text-muted-foreground mt-1">
                  Auto-suggested based on entity type
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Filing Status</label>
              <Select value={formStatus} onValueChange={setFormStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FILING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <SheetFooter>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Saving..." : "Create Profile"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ItReturns;
