import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ArrowLeft, Pencil, Save, X } from "lucide-react";

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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(searchParams.get("edit") === "true");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", pan: "", cin: "", entity_type: "" });

  useEffect(() => {
    if (!clientId) return;
    const fetchClient = async () => {
      const { data } = await supabase.from("clients").select("*").eq("id", clientId).single();
      const c = data as Client | null;
      setClient(c);
      if (c) setForm({ name: c.name || "", pan: c.pan || "", cin: c.cin || "", entity_type: c.entity_type || "" });
      setLoading(false);
    };
    fetchClient();
  }, [clientId]);

  const handleSave = async () => {
    if (!clientId) return;
    setSaving(true);
    const { error } = await supabase.from("clients").update({
      name: form.name || null,
      pan: form.pan || null,
      cin: form.cin || null,
      entity_type: form.entity_type || null,
    }).eq("id", clientId);
    setSaving(false);

    if (error) {
      toast({ title: "Error saving", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Client updated" });
      setClient((prev) => prev ? { ...prev, ...form } : prev);
      setEditing(false);
    }
  };

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
        <div className="flex items-center gap-2">
          {!editing && (
            <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate(`/clients/edit/${client.id}`)}>
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          )}
          <VersionHistoryPanel table_name="clients" record_id={client.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">General Information</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {editing ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">PAN</Label>
                  <Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CIN</Label>
                  <Input value={form.cin} onChange={(e) => setForm({ ...form, cin: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Entity Type</Label>
                  <Input value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })} />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="gap-1" onClick={handleSave} disabled={saving}>
                    <Save className="h-3 w-3" /> {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => { setEditing(false); setForm({ name: client.name || "", pan: client.pan || "", cin: client.cin || "", entity_type: client.entity_type || "" }); }}>
                    <X className="h-3 w-3" /> Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">CIN</span><span className="font-mono">{client.cin || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">PAN</span><span className="font-mono">{client.pan || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Entity Type</span><span>{client.entity_type || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{client.created_at ? format(new Date(client.created_at), "dd MMM yyyy") : "—"}</span></div>
              </>
            )}
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
