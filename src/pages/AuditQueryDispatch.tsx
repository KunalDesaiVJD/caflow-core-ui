import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Send, Mail, MessageSquare, CheckSquare, Loader2 } from "lucide-react";
import { buildAuditEmailHtml, buildAuditEmailSubject } from "@/components/email/EmailTemplateEngine";

type Query = {
  id: string;
  ref_number: string | null;
  query_text: string;
  source: string;
  status: string;
  priority: string;
};

const STEPS = ["Select Queries", "Choose Channel", "Review & Send"];

export default function AuditQueryDispatch() {
  const { clientId } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [step, setStep] = useState(0);
  const [queries, setQueries] = useState<Query[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [channel, setChannel] = useState<"email" | "whatsapp" | "both">("email");
  const [clientName, setClientName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [firmIcai, setFirmIcai] = useState("");
  const [financialYear, setFinancialYear] = useState("2024-25");
  const [engagementId, setEngagementId] = useState<string | null>(null);

  // Template fields
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [waBody, setWaBody] = useState("");

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    let cName = "";
    if (clientId) {
      const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
      cName = client?.name || "";
      setClientName(cName);

      const { data: eng } = await supabase
        .from("audit_engagements")
        .select("id, financial_year")
        .eq("client_id", clientId)
        .order("financial_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (eng) {
        setEngagementId(eng.id);
        setFinancialYear(eng.financial_year || "2024-25");
      }
    }

    if (user.firm_id) {
      const { data: firm } = await supabase.from("firms").select("name, icai_reg_no").eq("id", user.firm_id).maybeSingle();
      setFirmName(firm?.name || "");
      setFirmIcai(firm?.icai_reg_no || "");
    }

    let q = supabase.from("audit_client_queries").select("id, ref_number, query_text, source, status, priority").eq("status", "Open");
    if (clientId) q = q.eq("client_id", clientId);
    const { data } = await q;
    setQueries((data as Query[]) || []);
    setLoading(false);
  }, [user, clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build templates when moving to step 2
  const buildTemplates = () => {
    const selectedQueries = queries.filter(q => selected.has(q.id));
    const dispatchRef = `DIS-${Date.now().toString(36).toUpperCase()}`;
    const queryList = selectedQueries.map((q, i) => `${i + 1}. [${q.ref_number || "—"}] ${q.query_text}`).join("\n");
    const fy = financialYear;

    setEmailSubject(`Audit Queries — ${clientName} — FY ${fy} — Ref ${dispatchRef}`);
    setEmailBody(
`Dear ${clientName},

We are conducting the statutory audit of ${clientName} for FY ${fy}. As part of our audit procedures, we have prepared a list of queries / clarifications required from your end.

Please review the following queries and provide your responses at the earliest convenience.

AUDIT QUERIES:
${queryList}

We request your response at the earliest. Timely responses will help us complete the audit efficiently.

Thanking you,
${user?.name || "Auditor"}
${firmName}${firmIcai ? ` | ${firmIcai}` : ""}
${user?.email || ""}`
    );
    setWaBody(
`Dear ${clientName},
Audit Queries — ${clientName} FY ${fy}

We have ${selectedQueries.length} queries requiring your response:

${queryList}

Thank you,
${firmName}`
    );
  };

  const selectAll = () => {
    setSelected(new Set(queries.map(q => q.id)));
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const goToStep = (s: number) => {
    if (s === 2) buildTemplates();
    setStep(s);
  };

  const handleSend = async () => {
    if (selected.size === 0) { toast.error("No queries selected"); return; }
    setSending(true);
    try {
      const dispatchRef = `DIS-${Date.now().toString(36).toUpperCase()}`;
      const queryIds = Array.from(selected);

      // Log dispatch
      await supabase.from("audit_query_dispatch_log").insert({
        engagement_id: engagementId,
        client_id: clientId || null,
        firm_id: user?.firm_id || null,
        dispatch_ref: dispatchRef,
        query_ids: queryIds,
        channel,
        subject: emailSubject,
        body: channel === "whatsapp" ? waBody : emailBody,
        template_used: channel,
        dispatched_by: user?.id || null,
      } as any);

      // Send notifications. The email MUST carry the full query table — the
      // edge function relays payload.custom_html verbatim — otherwise the
      // client would only get a portal link with no query details.
      const selectedQueries = queries.filter(q => selected.has(q.id));
      const portalUrl = `${window.location.origin}/portal/queries`;
      const queryHtml = buildAuditEmailHtml("audit_query_dispatch", {
        clientName, firmName, financialYear, portalUrl,
        queries: selectedQueries.map(q => ({
          ref_number: q.ref_number,
          query_text: q.query_text,
        })),
      });
      const sharedPayload = {
        client_name:    clientName,
        firm_name:      firmName,
        custom_subject: emailSubject || buildAuditEmailSubject("audit_query_dispatch", financialYear),
        custom_html:    queryHtml,
        custom_message: `${selectedQueries.length} audit ${selectedQueries.length === 1 ? "query has" : "queries have"} been raised for your attention. Please log in to the CAFlow client portal to view and respond.`,
        portal_url:     portalUrl,
        query_count:    String(selectedQueries.length),
      };
      try {
        await supabase.functions.invoke("send-notification", {
          body: {
            type:           "audit_query_dispatch",
            firm_id:        user?.firm_id,
            client_id:      clientId,
            send_to_client: true,   // edge function dispatches per channel rules
            payload:        sharedPayload,
          },
        });
      } catch { /* non-blocking */ }

      // Update query statuses to Client Acknowledged
      for (const qid of queryIds) {
        await supabase.from("audit_client_queries").update({
          status: "Client Acknowledged",
          updated_at: new Date().toISOString(),
        } as any).eq("id", qid);
      }

      // Log to notification_log
      await supabase.from("notification_log").insert({
        type: "audit_query_dispatch",
        firm_id: user?.firm_id,
        channel: channel,
        content: { dispatch_ref: dispatchRef, query_count: queryIds.length, client_name: clientName },
        status: "sent",
        sent_at: new Date().toISOString(),
      } as any);

      toast.success(`${queryIds.length} queries dispatched via ${channel}`);
      setStep(0);
      setSelected(new Set());
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Dispatch failed");
    } finally {
      setSending(false);
    }
  };

  // Group queries by source
  const grouped = queries.reduce<Record<string, Query[]>>((acc, q) => {
    (acc[q.source] = acc[q.source] || []).push(q);
    return acc;
  }, {});

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-64" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">
          Query Dispatch
          {clientName && <span className="text-muted-foreground font-normal text-lg ml-2">— {clientName} — FY {financialYear}</span>}
        </h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => goToStep(i)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] bg-background/20">{i + 1}</span>
              {s}
            </button>
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 0: Select queries */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <CheckSquare size={18} /> Select Open Queries
                <Badge>{selected.size} selected</Badge>
              </span>
              <Button size="sm" variant="outline" onClick={selectAll}>Select All Open</Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {queries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No open queries to dispatch.</p>
            ) : (
              <div className="space-y-6">
                {Object.entries(grouped).map(([source, qs]) => (
                  <div key={source}>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{source}</h4>
                    <div className="space-y-1">
                      {qs.map(q => (
                        <div
                          key={q.id}
                          className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                            selected.has(q.id) ? "bg-primary/5 border-primary/30" : "border-border hover:bg-muted/50"
                          }`}
                          onClick={() => toggleSelect(q.id)}
                        >
                          <Checkbox checked={selected.has(q.id)} onCheckedChange={() => toggleSelect(q.id)} className="mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs text-muted-foreground">{q.ref_number || "—"}</span>
                              <Badge variant="outline" className="text-[10px]">{q.priority}</Badge>
                            </div>
                            <p className="text-sm">{q.query_text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-end">
              <Button onClick={() => goToStep(1)} disabled={selected.size === 0}>
                Next: Choose Channel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Choose channel */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Choose Dispatch Channel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(["email", "whatsapp", "both"] as const).map(ch => (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className={`p-6 rounded-lg border-2 text-center transition-all ${
                    channel === ch ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  }`}
                >
                  {ch === "email" ? <Mail className="mx-auto h-8 w-8 mb-2 text-primary" /> :
                   ch === "whatsapp" ? <MessageSquare className="mx-auto h-8 w-8 mb-2 text-green-600" /> :
                   <Send className="mx-auto h-8 w-8 mb-2 text-primary" />}
                  <p className="font-semibold capitalize">{ch === "both" ? "Email + WhatsApp" : ch}</p>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={() => goToStep(2)}>Next: Review Template</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Review & Send */}
      {step === 2 && (
        <div className="space-y-4">
          {(channel === "email" || channel === "both") && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Mail size={18} /> Email Template</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Subject</Label>
                  <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
                </div>
                <div>
                  <Label>Body</Label>
                  <Textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={16} className="font-mono text-xs" />
                </div>
              </CardContent>
            </Card>
          )}
          {(channel === "whatsapp" || channel === "both") && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare size={18} /> WhatsApp Template</CardTitle></CardHeader>
              <CardContent>
                <Textarea value={waBody} onChange={(e) => setWaBody(e.target.value)} rows={10} className="font-mono text-xs" />
              </CardContent>
            </Card>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={handleSend} disabled={sending} className="gap-2">
              {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              Send {selected.size} Queries via {channel === "both" ? "Email + WhatsApp" : channel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
