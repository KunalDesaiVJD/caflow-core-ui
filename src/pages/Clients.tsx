import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import { Users, Eye } from "lucide-react";
import { format } from "date-fns";

interface Client {
  id: string;
  name: string | null;
  pan: string | null;
  entity_type: string | null;
  cin: string | null;
  gstin: string[] | null;
  created_at: string | null;
}

const Clients = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setClients((data as Client[]) || []);
      setLoading(false);
    };
    fetch();
  }, []);

  if (selectedClient) {
    return (
      <div className="space-y-4">
        {/* Client Detail Header */}
        <div className="flex items-start justify-between">
          <div>
            <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-xs" onClick={() => setSelectedClient(null)}>
              ← Back to Clients
            </Button>
            <h1 className="text-2xl font-display font-bold text-foreground">{selectedClient.name || "Unnamed Client"}</h1>
            <div className="flex items-center gap-2 mt-1">
              {selectedClient.entity_type && <Badge variant="outline">{selectedClient.entity_type}</Badge>}
              {selectedClient.pan && <span className="text-sm font-mono text-muted-foreground">{selectedClient.pan}</span>}
            </div>
          </div>
          <VersionHistoryPanel table_name="clients" record_id={selectedClient.id} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">General Information</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">CIN</span><span className="font-mono">{selectedClient.cin || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">PAN</span><span className="font-mono">{selectedClient.pan || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Entity Type</span><span>{selectedClient.entity_type || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{selectedClient.created_at ? format(new Date(selectedClient.created_at), "dd MMM yyyy") : "—"}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">GSTIN Numbers</CardTitle></CardHeader>
            <CardContent>
              {selectedClient.gstin && selectedClient.gstin.length > 0 ? (
                <div className="space-y-1">
                  {selectedClient.gstin.map((g, i) => (
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
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Clients</h1>
          <p className="text-sm text-muted-foreground">Manage your client directory.</p>
        </div>
        <Users className="h-5 w-5 text-muted-foreground" />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{client.pan || "—"}</TableCell>
                    <TableCell>
                      {client.entity_type ? <Badge variant="outline" className="text-[10px]">{client.entity_type}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.created_at ? format(new Date(client.created_at), "dd MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedClient(client)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {clients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No clients found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Clients;
