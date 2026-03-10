import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ArrowLeft, Pencil, Shield, FileText, Upload, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { ClientAuditorsTab } from "@/components/client-detail/ClientAuditorsTab";
import { ClientGroupsSection } from "@/components/client-detail/ClientGroupsSection";

interface Client {
  id: string;
  name: string | null;
  pan: string | null;
  entity_type: string | null;
  cin: string | null;
  gstin: string[] | null;
  created_at: string | null;
  compliance_flags: any;
  firm_id: string | null;
}

const SEVERITY_COLORS: Record<string, string> = { HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#9ca3af" };
const FLAG_LABELS: Record<string, string> = {
  gst_registered: "GST", tds_deductor: "TDS", fixed_assets: "Fixed Assets",
  govt_grants: "Govt Grants", multiple_banks: "Multiple Banks", caro_applicable: "CARO",
  transfer_pricing: "Transfer Pricing", mat_applicable: "MAT", special_deductions: "Special Deductions",
  msme_suppliers: "MSME",
};

const ClientDetail = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  // Scrutiny data
  const [findings, setFindings] = useState<any[]>([]);
  const [scrutinyRunning, setScrutinyRunning] = useState(false);

  // Filings
  const [tdsEntries, setTdsEntries] = useState<any[]>([]);
  const [itrProfiles, setItrProfiles] = useState<any[]>([]);

  // Audit
  const [engagements, setEngagements] = useState<any[]>([]);

  // Documents
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});

  // Activity
  const [activity, setActivity] = useState<any[]>([]);

  // Banking
  const [bankingData, setBankingData] = useState<any>(null);

  useEffect(() => {
    if (!clientId) return;
    loadAllData();
  }, [clientId]);

  async function loadAllData() {
    setLoading(true);
    const [clientRes, findingsRes, tdsRes, itrRes, engRes, docsRes, activityRes, profileRes] = await Promise.all([
      supabase.from("clients").select("*").eq("id", clientId!).single(),
      supabase.from("scrutiny_findings").select("*").eq("client_id", clientId!),
      supabase.from("tds_entries").select("*").eq("client_id", clientId!).order("date", { ascending: false }).limit(10),
      supabase.from("itr_profiles").select("*").eq("client_id", clientId!),
      supabase.from("audit_engagements").select("*").eq("client_id", clientId!),
      supabase.from("documents").select("category").eq("client_id", clientId!),
      supabase.from("version_history").select("*").eq("record_id", clientId!).order("created_at", { ascending: false }).limit(20),
      supabase.from("client_profiles").select("banking_data, loan_data").eq("client_id", clientId!).limit(1),
    ]);

    setClient(clientRes.data as Client | null);
    setFindings(findingsRes.data || []);
    setTdsEntries(tdsRes.data || []);
    setItrProfiles(itrRes.data || []);
    setEngagements(engRes.data || []);
    setActivity(activityRes.data || []);
    if (profileRes.data?.[0]) setBankingData(profileRes.data[0]);

    // Doc counts by category
    const counts: Record<string, number> = {};
    for (const d of docsRes.data || []) {
      const cat = (d as any).category || "Other";
      counts[cat] = (counts[cat] || 0) + 1;
    }
    setDocCounts(counts);
    setLoading(false);
  }

  async function runScrutiny() {
    if (!clientId || !client) return;
    setScrutinyRunning(true);
    try {
      const { error } = await supabase.functions.invoke("run-scrutiny", {
        body: { client_id: clientId, financial_year: new Date().getFullYear().toString(), firm_id: client.firm_id },
      });
      if (error) throw error;
      toast({ title: "Scrutiny complete" });
      // Refresh findings
      const { data } = await supabase.from("scrutiny_findings").select("*").eq("client_id", clientId);
      setFindings(data || []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setScrutinyRunning(false);
    }
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  if (!client) return <div className="text-center py-16 text-muted-foreground">Client not found.</div>;

  const compliance = client.compliance_flags || {};
  const activeFlags = Object.entries(FLAG_LABELS).filter(([key]) => compliance[key]);
  const unresolvedFindings = findings.filter(f => f.status !== "resolved" && f.status !== "waived");
  const highCount = unresolvedFindings.filter(f => f.severity === "HIGH").length;
  const medCount = unresolvedFindings.filter(f => f.severity === "MEDIUM").length;
  const lowCount = unresolvedFindings.filter(f => f.severity === "LOW").length;
  const donutData = [
    { name: "HIGH", value: highCount, color: SEVERITY_COLORS.HIGH },
    { name: "MEDIUM", value: medCount, color: SEVERITY_COLORS.MEDIUM },
    { name: "LOW", value: lowCount, color: SEVERITY_COLORS.LOW },
  ].filter(d => d.value > 0);

  const banking = bankingData?.banking_data as any;
  const loans = bankingData?.loan_data as any;
  const bankAccounts = Array.isArray(banking?.bank_accounts) ? banking.bank_accounts : [];
  const securedTotal = Array.isArray(loans?.secured_loans) ? loans.secured_loans.reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0) : 0;
  const unsecuredTotal = Array.isArray(loans?.unsecured_loans) ? loans.unsecured_loans.reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-xs gap-1" onClick={() => navigate("/clients")}>
            <ArrowLeft className="h-3 w-3" /> Back to Clients
          </Button>
          <h1 className="text-2xl font-display font-bold text-foreground">{client.name || "Unnamed Client"}</h1>
          <div className="flex items-center gap-2 mt-1">
            {client.entity_type && <Badge variant="outline">{client.entity_type}</Badge>}
            {client.pan && <span className="text-sm font-mono text-muted-foreground">{client.pan}</span>}
            <Badge variant="secondary" className="text-[10px]">Active</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate(`/clients/edit/${client.id}`)}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          <VersionHistoryPanel table_name="clients" record_id={client.id} />
        </div>
      </div>

      {/* Groups Section */}
      <Card>
        <CardContent className="p-4">
          <ClientGroupsSection clientId={client.id} />
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="filings">Filings</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="auditors">Auditors</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 space-y-4">
              {/* Compliance Flags */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Compliance Flags</CardTitle></CardHeader>
                <CardContent>
                  {activeFlags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {activeFlags.map(([key, label]) => (
                        <Badge key={key} className="text-xs bg-primary/10 text-primary border-primary/20">{label}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No compliance flags set</p>
                  )}
                </CardContent>
              </Card>

              {/* Banking Summary */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Banking Summary</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {bankAccounts.length > 0 ? (
                    <div className="space-y-1">
                      {bankAccounts.map((b: any, i: number) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span>{b.bank_name} — {b.branch}</span>
                          <span className="font-mono text-muted-foreground">{b.account_type}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No bank accounts recorded</p>
                  )}
                  <div className="flex gap-6 pt-2 border-t border-border text-sm">
                    <div><span className="text-muted-foreground">Secured Loans:</span> <span className="font-mono">₹{securedTotal.toLocaleString("en-IN")}</span></div>
                    <div><span className="text-muted-foreground">Unsecured Loans:</span> <span className="font-mono">₹{unsecuredTotal.toLocaleString("en-IN")}</span></div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Scrutiny Health Widget */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Scrutiny Health</CardTitle></CardHeader>
                <CardContent className="flex flex-col items-center space-y-3">
                  {donutData.length > 0 ? (
                    <div className="relative w-32 h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutData} dataKey="value" innerRadius={35} outerRadius={55} paddingAngle={2}>
                            {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xl font-bold text-foreground">{unresolvedFindings.length}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4">No unresolved findings</p>
                  )}
                  <div className="flex gap-3 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" />{highCount} HIGH</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />{medCount} MED</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground" />{lowCount} LOW</span>
                  </div>
                  <Button size="sm" className="gap-1" onClick={runScrutiny} disabled={scrutinyRunning}>
                    {scrutinyRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
                    Run Scrutiny
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Filings */}
        <TabsContent value="filings">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">TDS Entries (Recent 10)</CardTitle>
                <Button variant="link" size="sm" className="text-xs" onClick={() => navigate("/tds-filings")}>View All</Button>
              </CardHeader>
              <CardContent>
                {tdsEntries.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Party</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tdsEntries.map(e => (
                        <TableRow key={e.id}>
                          <TableCell className="text-xs">{e.date ? format(new Date(e.date), "dd MMM yy") : "—"}</TableCell>
                          <TableCell className="text-xs">{e.party_name || "—"}</TableCell>
                          <TableCell className="text-xs text-right font-mono">₹{(e.amount || 0).toLocaleString("en-IN")}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{e.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">No TDS entries</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">ITR Profiles</CardTitle></CardHeader>
              <CardContent>
                {itrProfiles.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>FY</TableHead>
                        <TableHead>Form</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itrProfiles.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs">{p.financial_year}</TableCell>
                          <TableCell className="text-xs">{p.itr_form || "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{p.filing_status || "Pending"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">No ITR profiles</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Audit */}
        <TabsContent value="audit">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Audit Engagements</CardTitle>
              <Button size="sm" className="gap-1"><FileText className="h-3 w-3" /> New Engagement</Button>
            </CardHeader>
            <CardContent>
              {engagements.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>FY</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>CARO</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {engagements.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">{e.financial_year}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{e.status || "Draft"}</Badge></TableCell>
                        <TableCell className="text-xs">{e.caro_applicable ? "Yes" : "No"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">No audit engagements</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Auditors */}
        <TabsContent value="auditors">
          <ClientAuditorsTab clientId={clientId!} />
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Documents</CardTitle>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate("/documents")}>
                <Upload className="h-3 w-3" /> Upload
              </Button>
            </CardHeader>
            <CardContent>
              {Object.keys(docCounts).length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {Object.entries(docCounts).map(([cat, count]) => (
                    <div key={cat} className="border border-border rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-foreground">{count}</p>
                      <p className="text-xs text-muted-foreground">{cat}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">No documents uploaded</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity">
          <Card>
            <CardHeader><CardTitle className="text-sm">Recent Activity</CardTitle></CardHeader>
            <CardContent>
              {activity.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Table</TableHead>
                      <TableHead>Operation</TableHead>
                      <TableHead>Changed Fields</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activity.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs font-mono">{a.table_name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{a.operation}</Badge></TableCell>
                        <TableCell className="text-xs">{(a.changed_fields || []).join(", ")}</TableCell>
                        <TableCell className="text-xs">{a.user_name || "System"}</TableCell>
                        <TableCell className="text-xs">{a.created_at ? format(new Date(a.created_at), "dd MMM yy HH:mm") : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">No activity recorded</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ClientDetail;
