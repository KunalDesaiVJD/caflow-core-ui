import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";

interface Client {
  id: string;
  name: string | null;
  pan: string | null;
  entity_type: string | null;
  cin: string | null;
  gstin: string[] | null;
  created_at: string | null;
}

const ClientDetail = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    const fetch = async () => {
      const { data } = await supabase.from("clients").select("*").eq("id", clientId).single();
      setClient(data as Client | null);
      setLoading(false);
    };
    fetch();
  }, [clientId]);

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  if (!client) return <div className="text-center py-16 text-muted-foreground">Client not found.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-xs gap-1" onClick={() => navigate("/clients")}>
            <ArrowLeft className="h-3 w-3" /> Back to Clients
          </Button>
          <h1 className="text-2xl font-display font-bold text-foreground">{client.name || "Unnamed Client"}</h1>
          <div className="flex items-center gap-2 mt-1">
            {client.entity_type && <Badge variant="outline">{client.entity_type}</Badge>}
            {client.pan && <span className="text-sm font-mono text-muted-foreground">{client.pan}</span>}
          </div>
        </div>
        <VersionHistoryPanel table_name="clients" record_id={client.id} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">General Information</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">CIN</span><span className="font-mono">{client.cin || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">PAN</span><span className="font-mono">{client.pan || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Entity Type</span><span>{client.entity_type || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{client.created_at ? format(new Date(client.created_at), "dd MMM yyyy") : "—"}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">GSTIN Numbers</CardTitle></CardHeader>
          <CardContent>
            {client.gstin && client.gstin.length > 0 ? (
              <div className="space-y-1">
                {client.gstin.map((g, i) => (
                  <Badge key={i} variant="outline" className="font-mono text-xs mr-1">{g}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No GSTIN recorded</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ClientDetail;
