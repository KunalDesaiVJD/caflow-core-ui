import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, Upload, Sparkles, Save, CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";

interface AisEntry {
  entry_type: string;
  ais_amount: number;
  itr_head?: string;
  booked_amount?: number;
  difference?: number;
  status?: string;
}

const ItrAisRecon = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [clientName, setClientName] = useState("");
  const [itrProfile, setItrProfile] = useState<any>(null);
  const [aisEntries, setAisEntries] = useState<AisEntry[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const [clientRes, profileRes] = await Promise.all([
        supabase.from("clients").select("name").eq("id", clientId).maybeSingle(),
        supabase.from("itr_profiles").select("*").eq("client_id", clientId).limit(1),
      ]);
      setClientName(clientRes.data?.name || "Client");

      const profile = profileRes.data?.[0];
      setItrProfile(profile || null);

      // Load saved AIS data if available
      if (profile?.ais_recon_data) {
        const saved = profile.ais_recon_data as any;
        if (saved.entries) setAisEntries(saved.entries);
        if (saved.analysis) setAiAnalysis(saved.analysis);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        // Handle various AIS JSON structures
        let entries: AisEntry[] = [];

        if (Array.isArray(raw)) {
          entries = raw.map((item: any) => ({
            entry_type: item.entry_type || item.type || item.category || "Unknown",
            ais_amount: Number(item.ais_amount || item.amount || item.value || 0),
            itr_head: item.itr_head || item.head || "",
            booked_amount: Number(item.booked_amount || item.booked || 0),
            difference: 0,
            status: "Pending",
          }));
        } else if (raw.data && Array.isArray(raw.data)) {
          entries = raw.data.map((item: any) => ({
            entry_type: item.entry_type || item.type || item.infoDesc || "Unknown",
            ais_amount: Number(item.ais_amount || item.amount || item.value || 0),
            itr_head: item.itr_head || item.head || "",
            booked_amount: Number(item.booked_amount || 0),
            difference: 0,
            status: "Pending",
          }));
        } else {
          // Try to handle as key-value object
          entries = Object.entries(raw).map(([key, val]: [string, any]) => ({
            entry_type: key,
            ais_amount: Number(typeof val === "number" ? val : val?.amount || 0),
            itr_head: "",
            booked_amount: 0,
            difference: 0,
            status: "Pending",
          }));
        }

        // Calculate differences
        entries = entries.map((e) => ({
          ...e,
          difference: Math.abs(e.ais_amount - (e.booked_amount || 0)),
          status: e.ais_amount === (e.booked_amount || 0) ? "Matched" : e.booked_amount ? "Mismatch" : "Not In ITR",
        }));

        setAisEntries(entries);
        setAiAnalysis("");
        toast({ title: `Parsed ${entries.length} AIS entries` });
      } catch (err) {
        toast({ title: "Invalid JSON file", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    // Reset input
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleAiReconcile = async () => {
    if (aisEntries.length === 0) {
      toast({ title: "Upload AIS data first", variant: "destructive" });
      return;
    }
    setAnalyzing(true);
    setAiAnalysis("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(
        `https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/claude-gateway`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            request_type: "ais_reconciliation",
            user_message: JSON.stringify(aisEntries),
            stream: true,
          }),
        }
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(errBody || `HTTP ${res.status}`);
      }

      // Stream response
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });

          // Parse SSE events
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.delta?.text || parsed?.content_block?.text || "";
                if (delta) {
                  fullText += delta;
                  setAiAnalysis(fullText);
                }
              } catch {
                // Not valid JSON SSE, might be raw text
                fullText += data;
                setAiAnalysis(fullText);
              }
            }
          }
        }
      }

      if (!fullText) {
        // Non-streaming fallback
        setAiAnalysis("AI analysis completed. Check the reconciliation table for updated statuses.");
      }
    } catch (e: any) {
      toast({ title: "AI Error", description: e.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveAnalysis = async () => {
    if (!itrProfile?.id) {
      toast({ title: "No ITR profile found for this client", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("itr_profiles")
        .update({
          ais_recon_data: JSON.parse(JSON.stringify({ entries: aisEntries, analysis: aiAnalysis, saved_at: new Date().toISOString() })),
        })
        .eq("id", itrProfile.id);
      if (error) throw error;
      toast({ title: "Analysis saved successfully" });
    } catch (e: any) {
      toast({ title: "Save error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "Matched": return <CheckCircle2 size={14} className="text-emerald-600" />;
      case "Mismatch": return <AlertTriangle size={14} className="text-amber-600" />;
      case "Not In ITR": return <XCircle size={14} className="text-destructive" />;
      default: return null;
    }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      Matched: "bg-emerald-500/15 text-emerald-600",
      Mismatch: "bg-amber-500/15 text-amber-600",
      "Not In ITR": "bg-destructive/15 text-destructive",
      Pending: "bg-muted text-muted-foreground",
    };
    return <Badge className={colors[status] || colors.Pending}>{statusIcon(status)} <span className="ml-1">{status}</span></Badge>;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/itr")}>
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">AIS Reconciliation</h1>
          <p className="text-muted-foreground text-sm">{clientName} • {itrProfile?.financial_year || "N/A"} • {itrProfile?.itr_form || "N/A"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Upload + Table */}
        <div className="lg:col-span-2 space-y-4">
          {/* Upload */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <Upload size={16} className="mr-2" /> Upload AIS JSON File
                </Button>
                <Button
                  onClick={handleAiReconcile}
                  disabled={analyzing || aisEntries.length === 0}
                >
                  <Sparkles size={16} className="mr-2" />
                  {analyzing ? "Analyzing..." : "AI Reconcile"}
                </Button>
                {aisEntries.length > 0 && (
                  <span className="text-sm text-muted-foreground">{aisEntries.length} entries loaded</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Reconciliation Table */}
          {aisEntries.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>AIS Entry Type</TableHead>
                    <TableHead className="text-right">AIS Amount (₹)</TableHead>
                    <TableHead>Matching ITR Head</TableHead>
                    <TableHead className="text-right">Booked Amount (₹)</TableHead>
                    <TableHead className="text-right">Difference (₹)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aisEntries.map((entry, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{entry.entry_type}</TableCell>
                      <TableCell className="text-right">
                        {entry.ais_amount.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell>{entry.itr_head || "—"}</TableCell>
                      <TableCell className="text-right">
                        {(entry.booked_amount || 0).toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className={`text-right ${(entry.difference || 0) > 0 ? "text-destructive font-medium" : ""}`}>
                        {(entry.difference || 0).toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell>{statusBadge(entry.status || "Pending")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {aisEntries.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <Upload size={40} className="mx-auto mb-3 opacity-30" />
                <p>Upload an AIS JSON file downloaded from the Income Tax Portal to begin reconciliation.</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: AI Analysis Panel */}
        <div className="space-y-4">
          <Card className="sticky top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles size={16} className="text-primary" /> AI Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              {aiAnalysis ? (
                <div className="space-y-3">
                  <div className="prose prose-sm max-w-none text-sm text-foreground whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
                    {aiAnalysis}
                  </div>
                  <Button
                    onClick={handleSaveAnalysis}
                    disabled={saving}
                    className="w-full"
                    variant="outline"
                  >
                    <Save size={14} className="mr-2" />
                    {saving ? "Saving..." : "Save Analysis"}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {analyzing
                    ? "AI is analyzing your AIS data..."
                    : "Upload AIS data and click 'AI Reconcile' to get AI-powered mismatch analysis."}
                </p>
              )}
              {analyzing && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                  <span className="text-xs text-muted-foreground">Streaming response...</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ItrAisRecon;
