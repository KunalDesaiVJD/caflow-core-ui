import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BookOpen, ArrowRight, FileSpreadsheet, AlertCircle } from "lucide-react";

interface TBSnapshot {
  id: string;
  client_id: string;
  financial_year: string | null;
  source_format: string | null;
  normalised_data: any[] | null;
  client_name?: string;
}

const ErpLedger = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<TBSnapshot[]>([]);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [clientsRes, tbRes] = await Promise.all([
        supabase.from("clients").select("id, name").order("name"),
        supabase.from("trial_balance_snapshots").select("id, client_id, financial_year, source_format, normalised_data"),
      ]);
      setClients(clientsRes.data || []);
      setSnapshots(tbRes.data || []);
      setLoading(false);
    };
    load();
  }, []);

  const clientsWithTB = clients.map((c) => {
    const tb = snapshots.filter((s) => s.client_id === c.id);
    return { ...c, snapshots: tb };
  });

  const selectedTB = selectedClient
    ? snapshots.filter((s) => s.client_id === selectedClient)
    : [];

  const selectedEntries = selectedTB.length > 0 && Array.isArray(selectedTB[0].normalised_data)
    ? selectedTB[0].normalised_data
    : [];

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">ERP Ledger</h1>
          <p className="text-muted-foreground text-sm">View imported trial balances and navigate to Bank Reconciliation.</p>
        </div>
      </div>

      {/* Client list with TB status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Clients & Trial Balances
          </CardTitle>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No clients found. Add clients first.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Trial Balance</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientsWithTB.map((c) => (
                  <TableRow
                    key={c.id}
                    className={selectedClient === c.id ? "bg-muted/50" : "cursor-pointer hover:bg-muted/30"}
                    onClick={() => setSelectedClient(c.id)}
                  >
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      {c.snapshots.length > 0 ? (
                        <Badge variant="secondary" className="gap-1">
                          <FileSpreadsheet className="h-3 w-3" />
                          {c.snapshots.length} snapshot{c.snapshots.length > 1 ? "s" : ""}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not imported</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.snapshots.length > 0 && Array.isArray(c.snapshots[0].normalised_data)
                        ? c.snapshots[0].normalised_data.length
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/erp/${c.id}/bank-recon`);
                        }}
                      >
                        Bank Recon <ArrowRight className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Selected client TB preview */}
      {selectedClient && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Trial Balance — {clients.find((c) => c.id === selectedClient)?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedEntries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm">No trial balance imported for this client.</p>
                <Button size="sm" variant="outline" onClick={() => navigate(`/clients/edit/${selectedClient}`)}>
                  Import via Client Wizard
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedEntries.map((entry: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>{entry.account_name || "—"}</TableCell>
                        <TableCell className="text-right font-mono">{Number(entry.debit || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right font-mono">{Number(entry.credit || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right font-mono">{Number(entry.balance || 0).toLocaleString("en-IN")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ErpLedger;
