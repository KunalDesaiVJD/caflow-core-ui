import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X, Link2, Users, Landmark, Scale } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(n) || 0);

/**
 * TallyMappingPanel — review/approve the auto-matcher's output.
 *
 *   tally_party_map    (CAFlow client  -> Tally party ledger)
 *   tally_element_map  (income / GST / round-off / bank -> Tally ledger)
 *
 * Exact matches arrive already 'approved'; fuzzy ones are 'proposed' and need a
 * human OK (or a pick from the candidates the matcher found). Approved rows are
 * what the forward/reverse sync uses to resolve names.
 */

const sb = supabase as any;
interface Props { firmId: string | null; }

interface PartyRow {
  id: string; client_id: string; client_name: string; tally_ledger_name: string | null;
  match_method: string; match_confidence: number; status: string; candidates: any;
}
interface ElemRow {
  id: string; element_type: string; element_key: string; element_label: string | null;
  tally_ledger_name: string | null; status: string;
}

export default function TallyMappingPanel({ firmId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [party, setParty] = useState<PartyRow[]>([]);
  const [elems, setElems] = useState<ElemRow[]>([]);
  const [recon, setRecon] = useState<any[]>([]);
  const [showApproved, setShowApproved] = useState(false);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!firmId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [pRes, eRes, cRes, rRes] = await Promise.all([
        sb.from("tally_party_map").select("*").eq("firm_id", firmId).order("status").order("match_confidence", { ascending: false }),
        sb.from("tally_element_map").select("*").eq("firm_id", firmId).order("element_type"),
        sb.from("clients").select("id,name").eq("firm_id", firmId),
        sb.from("tally_recon").select("*").eq("firm_id", firmId).order("status").order("diff"),
      ]);
      const cliMap = new Map<string, string>((cRes.data || []).map((c: any) => [c.id, c.name]));
      setParty((pRes.data || []).map((r: any) => ({ ...r, client_name: cliMap.get(r.client_id) || "—" })));
      setElems((eRes.data || []) as ElemRow[]);
      setRecon((rRes.data || []).map((r: any) => ({ ...r, client_name: cliMap.get(r.client_id) || "—" })));
    } catch (e: any) { toast({ title: "Failed to load mappings", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  }, [firmId, toast]);
  useEffect(() => { fetchData(); }, [fetchData]);

  async function setPartyStatus(row: PartyRow, status: string, ledger?: string) {
    setBusy(row.id);
    try {
      const patch: any = { status, approved_by: user?.id, approved_at: new Date().toISOString() };
      if (ledger !== undefined) { patch.tally_ledger_name = ledger; patch.match_method = "manual"; patch.match_confidence = 100; }
      await sb.from("tally_party_map").update(patch).eq("id", row.id);
      fetchData();
    } catch (e: any) { toast({ title: "Update failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  }
  async function setElemStatus(row: ElemRow, status: string, ledger?: string) {
    setBusy(row.id);
    try {
      const patch: any = { status, approved_by: user?.id, approved_at: new Date().toISOString() };
      if (ledger !== undefined) { patch.tally_ledger_name = ledger; patch.match_method = "manual"; }
      await sb.from("tally_element_map").update(patch).eq("id", row.id);
      fetchData();
    } catch (e: any) { toast({ title: "Update failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  }
  async function approveAllExact() {
    const ids = party.filter((r) => r.status === "proposed" && r.match_method === "name_exact").map((r) => r.id);
    if (!ids.length) { toast({ title: "No exact proposals to approve." }); return; }
    setBusy("bulk");
    try { await sb.from("tally_party_map").update({ status: "approved", approved_by: user?.id, approved_at: new Date().toISOString() }).in("id", ids); toast({ title: `Approved ${ids.length} exact matches.` }); fetchData(); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="space-y-3 mt-2">{[0, 1].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;

  const partyView = party.filter((r) => showApproved || r.status !== "approved");
  const proposedCount = party.filter((r) => r.status === "proposed").length;
  const approvedCount = party.filter((r) => r.status === "approved").length;

  const statusBadge = (s: string, m: string, c: number) =>
    s === "approved" ? <Badge className="bg-emerald-600 gap-1"><Check size={11} /> Approved</Badge>
      : s === "rejected" ? <Badge variant="destructive">Rejected</Badge>
        : <Badge variant="secondary">{m === "name_exact" ? "Exact" : m === "name_fuzzy" ? `Fuzzy ${c}%` : "Review"}</Badge>;

  return (
    <div className="space-y-4">
      {/* PARTY MAP */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm flex items-center gap-2"><Users size={15} /> Client &rarr; Tally party ledger
            <span className="text-muted-foreground font-normal">({approvedCount} approved · {proposedCount} to review)</span></CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowApproved((v) => !v)}>{showApproved ? "Hide approved" : "Show approved"}</Button>
            <Button size="sm" onClick={approveAllExact} disabled={busy === "bulk"}>Approve all exact</Button>
          </div>
        </CardHeader>
        <CardContent className="max-h-[360px] overflow-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Tally ledger</TableHead><TableHead>Match</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {partyView.map((r) => {
                const cands: any[] = Array.isArray(r.candidates) ? r.candidates : [];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.client_name}</TableCell>
                    <TableCell className="text-xs">
                      {r.status === "approved" ? (r.tally_ledger_name || "—")
                        : <Input value={edit[r.id] ?? r.tally_ledger_name ?? ""} onChange={(e) => setEdit((s) => ({ ...s, [r.id]: e.target.value }))} className="h-7 text-xs" />}
                      {r.status !== "approved" && cands.length > 1 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {cands.slice(0, 3).map((c: any, i: number) => (
                            <button key={i} className="text-[10px] rounded bg-muted px-1 py-0.5 hover:bg-accent" onClick={() => setEdit((s) => ({ ...s, [r.id]: c.name }))}>{c.name} ({Math.round((c.score || 0) * 100)}%)</button>
                          ))}
                        </div>)}
                    </TableCell>
                    <TableCell>{statusBadge(r.status, r.match_method, r.match_confidence)}</TableCell>
                    <TableCell className="text-right space-x-1 whitespace-nowrap">
                      {r.status !== "approved" && <Button size="sm" disabled={busy === r.id} onClick={() => setPartyStatus(r, "approved", edit[r.id] ?? r.tally_ledger_name ?? undefined)}><Check size={13} /></Button>}
                      {r.status !== "rejected" && <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => setPartyStatus(r, "rejected")}><X size={13} /></Button>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {partyView.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No mappings to review. Run <code>tally-sync match</code> on the Tally PC to generate them.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ELEMENT MAP */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Landmark size={15} /> Income / GST / bank ledgers</CardTitle></CardHeader>
        <CardContent className="max-h-[260px] overflow-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Element</TableHead><TableHead>Tally ledger</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {elems.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium capitalize">{r.element_type.replace(/_/g, " ")}<span className="text-xs text-muted-foreground"> · {r.element_label || r.element_key}</span></TableCell>
                  <TableCell className="text-xs">
                    {r.status === "approved" ? (r.tally_ledger_name || "—")
                      : <Input value={edit[r.id] ?? r.tally_ledger_name ?? ""} onChange={(e) => setEdit((s) => ({ ...s, [r.id]: e.target.value }))} className="h-7 text-xs" />}
                  </TableCell>
                  <TableCell><Link2 size={12} className="inline" /> {r.status}</TableCell>
                  <TableCell className="text-right">
                    {r.status !== "approved" && <Button size="sm" disabled={busy === r.id} onClick={() => setElemStatus(r, "approved", edit[r.id] ?? r.tally_ledger_name ?? undefined)}><Check size={13} /></Button>}
                  </TableCell>
                </TableRow>
              ))}
              {elems.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No element mappings yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* RECONCILIATION */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Scale size={15} /> Reconciliation — Tally closing vs CAFlow outstanding
          <span className="text-muted-foreground font-normal">({recon.filter((r) => r.status === "mismatch").length} mismatch · {recon.length} checked)</span></CardTitle></CardHeader>
        <CardContent className="max-h-[300px] overflow-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead className="text-right">Tally closing</TableHead><TableHead className="text-right">CAFlow due</TableHead><TableHead className="text-right">Difference</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {recon.filter((r) => r.status === "mismatch").map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.client_name}<div className="text-xs text-muted-foreground">{r.tally_ledger_name}</div></TableCell>
                  <TableCell className="text-right">₹{fmt(r.tally_closing)}</TableCell>
                  <TableCell className="text-right">₹{fmt(r.caflow_outstanding)}</TableCell>
                  <TableCell className="text-right"><Badge variant="destructive">₹{fmt(r.diff)}</Badge></TableCell>
                </TableRow>
              ))}
              {recon.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No reconciliation yet. Run <code>tally-sync recon</code> on the Tally PC.</TableCell></TableRow>}
              {recon.length > 0 && recon.filter((r) => r.status === "mismatch").length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-emerald-600 py-6">✓ All {recon.length} mapped clients reconcile (within ₹100).</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
