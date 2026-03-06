import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { format } from "date-fns";

interface TdsEntry {
  id: string;
  party_name: string | null;
  pan: string | null;
  section: string | null;
  tds_amount: number | null;
  tds_rate: number | null;
  challan_no: string | null;
  date: string | null;
}

const TdsFilings = () => {
  const [entries, setEntries] = useState<TdsEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("tds_entries")
        .select("*")
        .order("date", { ascending: false })
        .limit(50);
      setEntries((data as TdsEntry[]) || []);
      setLoading(false);
    };
    fetch();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground mb-1">TDS Filings</h1>
        <p className="text-sm text-muted-foreground">Track and manage TDS filings across clients.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Party Name</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Challan No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>History</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.party_name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.pan || "—"}</TableCell>
                    <TableCell>
                      {entry.section ? (
                        <Badge variant="outline" className="text-[10px]">{entry.section}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {entry.tds_amount != null ? `₹${entry.tds_amount.toLocaleString("en-IN")}` : "—"}
                    </TableCell>
                    <TableCell>{entry.tds_rate != null ? `${entry.tds_rate}%` : "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.challan_no || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.date ? format(new Date(entry.date), "dd MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <VersionHistoryPanel table_name="tds_entries" record_id={entry.id} />
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No TDS entries found
                    </TableCell>
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

export default TdsFilings;
