import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { MessageSquare, Send, Loader2 } from "lucide-react";

type Query = {
  id: string;
  ref_number: string | null;
  query_text: string;
  status: string;
  due_date: string | null;
  client_reply: string | null;
  financial_year: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  Open: "bg-destructive text-destructive-foreground",
  "Client Acknowledged": "bg-blue-500 text-white",
  "Reply Received": "bg-purple-500 text-white",
  Clarified: "bg-green-600 text-white",
  "Carried Forward": "bg-amber-500 text-white",
};

export default function PortalQueries() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [queries, setQueries] = useState<Query[]>([]);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchQueries = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Get client record for portal user
    const { data: client } = await supabase.from("clients").select("id").eq("user_id", user.id).maybeSingle();
    if (!client) { setLoading(false); return; }

    const { data } = await supabase
      .from("audit_client_queries")
      .select("id, ref_number, query_text, status, due_date, client_reply, financial_year")
      .eq("client_id", client.id)
      .neq("status", "Closed")
      .order("created_at", { ascending: false });

    setQueries((data as Query[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchQueries(); }, [fetchQueries]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("portal-query-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_client_queries" }, () => fetchQueries())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchQueries]);

  const submitReply = async (queryId: string) => {
    if (!replyText.trim()) { toast.error("Please enter a reply"); return; }
    setSubmitting(true);
    const { error } = await supabase
      .from("audit_client_queries")
      .update({
        client_reply: replyText,
        replied_via: "portal",
        status: "Reply Received",
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", queryId);

    if (error) { toast.error(error.message); }
    else {
      toast.success("Reply submitted successfully");
      setReplyingId(null);
      setReplyText("");
      fetchQueries();
    }
    setSubmitting(false);
  };

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-60" /><Skeleton className="h-64" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <MessageSquare size={24} className="text-primary" /> Audit Queries
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and respond to queries from your auditor. {queries.length} active queries.
        </p>
      </div>

      {queries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MessageSquare className="mx-auto h-10 w-10 mb-3 opacity-30" />
            <p>No active audit queries at this time.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {queries.map(q => (
            <Card key={q.id} className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{q.ref_number || "—"}</span>
                    <Badge className={STATUS_COLORS[q.status] || "bg-muted text-muted-foreground"}>{q.status}</Badge>
                    {q.financial_year && <Badge variant="outline" className="text-[10px]">FY {q.financial_year}</Badge>}
                  </div>
                  {q.due_date && <span className="text-xs text-muted-foreground">Due: {q.due_date}</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-foreground">{q.query_text}</p>

                {q.client_reply && (
                  <div className="bg-muted/50 rounded-md p-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Your Reply:</p>
                    <p className="text-sm">{q.client_reply}</p>
                  </div>
                )}

                {q.status !== "Clarified" && q.status !== "Reply Received" && (
                  replyingId === q.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Type your reply..."
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => submitReply(q.id)} disabled={submitting} className="gap-1">
                          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit Reply
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setReplyingId(null); setReplyText(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => { setReplyingId(q.id); setReplyText(q.client_reply || ""); }} className="gap-1">
                      <MessageSquare size={14} /> Reply
                    </Button>
                  )
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
