import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Plus, CalendarIcon, Loader2, Info } from "lucide-react";

const FY_OPTIONS = ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"];

interface Props {
  clientId: string;
}

export function ClientAuditorsTab({ clientId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [auditFirms, setAuditFirms] = useState<any[]>([]);
  const [engagements, setEngagements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fy, setFy] = useState("");
  const [auditFirmId, setAuditFirmId] = useState("");
  const [appointedDate, setAppointedDate] = useState<Date | undefined>();
  const [remarks, setRemarks] = useState("");

  useEffect(() => { loadData(); }, [clientId]);

  async function loadData() {
    setLoading(true);
    const [assignRes, firmsRes, engRes] = await Promise.all([
      supabase.from("client_auditor_assignments").select("*, audit_firms(name, partner_name, icai_reg_no)").eq("client_id", clientId).order("financial_year", { ascending: false }),
      supabase.from("audit_firms").select("id, name, partner_name").eq("active", true).order("name"),
      supabase.from("audit_engagements").select("financial_year, status").eq("client_id", clientId),
    ]);
    setAssignments(assignRes.data || []);
    setAuditFirms(firmsRes.data || []);
    setEngagements(engRes.data || []);
    setLoading(false);
  }

  function isEngagementComplete(fy: string) {
    return engagements.some(e => e.financial_year === fy && (e.status === "signed" || e.status === "complete"));
  }

  async function handleSave() {
    if (!fy || !auditFirmId) return;
    setSaving(true);
    const { error } = await supabase.from("client_auditor_assignments").upsert({
      client_id: clientId,
      financial_year: fy,
      audit_firm_id: auditFirmId,
      appointed_date: appointedDate ? format(appointedDate, "yyyy-MM-dd") : null,
      remarks: remarks || null,
      created_by: user?.id,
    }, { onConflict: "client_id,financial_year" });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Auditor assigned" });
      setModalOpen(false);
      loadData();
    }
    setSaving(false);
  }

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Auditor Assignments</CardTitle>
        <Button size="sm" className="gap-1" onClick={() => { setFy(""); setAuditFirmId(""); setAppointedDate(undefined); setRemarks(""); setModalOpen(true); }}>
          <Plus className="h-3 w-3" /> Assign Auditor
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Financial Year</TableHead>
                <TableHead>Audit Firm</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Appointed Date</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Audit Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No auditor assignments</TableCell>
                </TableRow>
              ) : (
                assignments.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.financial_year}</TableCell>
                    <TableCell className="font-medium">{a.audit_firms?.name || "—"}</TableCell>
                    <TableCell>{a.audit_firms?.partner_name || "—"}</TableCell>
                    <TableCell className="text-sm">{a.appointed_date ? format(new Date(a.appointed_date), "dd MMM yyyy") : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{a.remarks || "—"}</TableCell>
                    <TableCell>
                      {isEngagementComplete(a.financial_year) ? (
                        <Badge className="text-[10px] bg-green-500/15 text-green-700 border-green-300">Completed</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Pending</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-start gap-2 mt-4 p-3 rounded-md bg-muted text-sm text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          Audit firm assignment is per financial year. The same client can have different auditors for different years.
        </div>
      </CardContent>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Auditor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Financial Year *</Label>
              <Select value={fy} onValueChange={setFy}>
                <SelectTrigger><SelectValue placeholder="Select FY" /></SelectTrigger>
                <SelectContent>
                  {FY_OPTIONS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Audit Firm *</Label>
              <Select value={auditFirmId} onValueChange={setAuditFirmId}>
                <SelectTrigger><SelectValue placeholder="Select firm" /></SelectTrigger>
                <SelectContent>
                  {auditFirms.map((f: any) => (
                    <SelectItem key={f.id} value={f.id}>{f.name} — {f.partner_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Appointed Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !appointedDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {appointedDate ? format(appointedDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={appointedDate} onSelect={setAppointedDate} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !fy || !auditFirmId}>
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
