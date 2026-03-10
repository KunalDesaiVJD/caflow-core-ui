import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Loader2, Play, CheckCircle } from "lucide-react";
import { Json } from "@/integrations/supabase/types";

interface Procedure {
  id: string;
  description: string;
  sa_reference: string;
  risk_area: string;
  assigned_to: string;
  status: string;
  wp_reference: string;
  selected?: boolean;
}

const DEFAULT_PROCEDURES: Omit<Procedure, "id" | "assigned_to" | "status" | "wp_reference" | "selected">[] = [
  { description: "Verify opening balances with prior year audited financials", sa_reference: "SA 510", risk_area: "General" },
  { description: "Evaluate management's assessment of going concern", sa_reference: "SA 570", risk_area: "Going Concern" },
  { description: "Test revenue recognition policies and cut-off", sa_reference: "SA 500", risk_area: "Revenue Recognition" },
  { description: "Perform analytical review of revenue trends", sa_reference: "SA 520", risk_area: "Revenue Recognition" },
  { description: "Vouch significant sales transactions to supporting documents", sa_reference: "SA 500", risk_area: "Revenue Recognition" },
  { description: "Test physical inventory count and valuation method", sa_reference: "SA 501", risk_area: "Inventory Valuation" },
  { description: "Verify inventory obsolescence provisions", sa_reference: "SA 540", risk_area: "Inventory Valuation" },
  { description: "Verify fixed asset additions, disposals, and depreciation", sa_reference: "SA 500", risk_area: "Fixed Assets" },
  { description: "Inspect title deeds and ownership documentation", sa_reference: "SA 500", risk_area: "Fixed Assets" },
  { description: "Identify and verify related party transactions and disclosures", sa_reference: "SA 550", risk_area: "Related Party Transactions" },
  { description: "Obtain management representations letter", sa_reference: "SA 580", risk_area: "General" },
  { description: "Evaluate subsequent events up to audit report date", sa_reference: "SA 560", risk_area: "General" },
  { description: "Review bank confirmations and reconciliations", sa_reference: "SA 505", risk_area: "Internal Controls" },
  { description: "Test internal control effectiveness over financial reporting", sa_reference: "SA 315", risk_area: "Internal Controls" },
  { description: "Assess fraud risk factors and design responsive procedures", sa_reference: "SA 240", risk_area: "Fraud Risk" },
  { description: "Evaluate IT general controls and application controls", sa_reference: "SA 315", risk_area: "IT Systems and Accounting Software" },
  { description: "Review TDS compliance and reconcile with 26AS/AIS", sa_reference: "SA 500", risk_area: "Internal Controls" },
  { description: "Verify loan covenants and borrowing terms", sa_reference: "SA 500", risk_area: "General" },
  { description: "Test employee benefit obligations and provisions", sa_reference: "SA 540", risk_area: "General" },
  { description: "Review contingent liabilities and commitments disclosures", sa_reference: "SA 501", risk_area: "Going Concern" },
];

function genId() { return crypto.randomUUID(); }

interface Props {
  engagement: any;
  teamUsers: any[];
  onUpdate: () => void;
}

export function EngagementAuditProgramme({ engagement, teamUsers, onUpdate }: Props) {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [saving, setSaving] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newSA, setNewSA] = useState("");
  const [newRisk, setNewRisk] = useState("General");

  useEffect(() => {
    const saved = engagement.audit_programme as any;
    if (saved && Array.isArray(saved) && saved.length > 0) {
      setProcedures(saved as Procedure[]);
    } else {
      setProcedures(DEFAULT_PROCEDURES.map(p => ({
        ...p, id: genId(), assigned_to: "", status: "Not Started", wp_reference: "", selected: false,
      })));
    }
  }, [engagement.id]);

  function updateProc(id: string, field: keyof Procedure, value: any) {
    setProcedures(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }

  function toggleSelect(id: string) {
    setProcedures(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));
  }

  function markAllInProgress() {
    setProcedures(prev => prev.map(p => ({ ...p, status: "In Progress" })));
  }

  function markSelectedDone() {
    setProcedures(prev => prev.map(p => p.selected ? { ...p, status: "Done", selected: false } : p));
  }

  function addCustom() {
    if (!newDesc.trim()) return;
    setProcedures(prev => [...prev, {
      id: genId(), description: newDesc, sa_reference: newSA, risk_area: newRisk,
      assigned_to: "", status: "Not Started", wp_reference: "",
    }]);
    setNewDesc(""); setNewSA(""); setNewRisk("General"); setAddingNew(false);
  }

  async function save() {
    setSaving(true);
    const clean = procedures.map(({ selected, ...rest }) => rest);
    const { error } = await supabase
      .from("audit_engagements")
      .update({ audit_programme: clean as unknown as Json })
      .eq("id", engagement.id);
    setSaving(false);
    if (error) toast.error("Failed to save");
    else { toast.success("Audit programme saved"); onUpdate(); }
  }

  const statusColor = (s: string) => {
    if (s === "Done") return "bg-green-500/15 text-green-700 border-green-300";
    if (s === "In Progress") return "bg-amber-500/15 text-amber-700 border-amber-300";
    return "bg-muted text-muted-foreground";
  };

  const hasSelected = procedures.some(p => p.selected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">Audit Programme</h2>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={markAllInProgress}>
            <Play className="w-3.5 h-3.5 mr-1" /> Mark All In Progress
          </Button>
          <Button variant="outline" size="sm" disabled={!hasSelected} onClick={markSelectedDone}>
            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Mark Selected Done
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAddingNew(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Procedure
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Save Programme
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead className="min-w-[280px]">Procedure</TableHead>
              <TableHead className="w-[90px]">SA Ref</TableHead>
              <TableHead className="w-[160px]">Risk Area</TableHead>
              <TableHead className="w-[150px]">Assigned To</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[100px]">WP Ref</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {procedures.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Checkbox checked={!!p.selected} onCheckedChange={() => toggleSelect(p.id)} />
                </TableCell>
                <TableCell className="text-sm">{p.description}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{p.sa_reference}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.risk_area}</TableCell>
                <TableCell>
                  <Select value={p.assigned_to || ""} onValueChange={v => updateProc(p.id, "assigned_to", v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {teamUsers.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name || u.id.slice(0,8)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select value={p.status} onValueChange={v => updateProc(p.id, "status", v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Not Started">Not Started</SelectItem>
                      <SelectItem value="In Progress">In Progress</SelectItem>
                      <SelectItem value="Done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input className="h-7 text-xs" value={p.wp_reference} onChange={e => updateProc(p.id, "wp_reference", e.target.value)} placeholder="e.g. B-2" />
                </TableCell>
              </TableRow>
            ))}
            {addingNew && (
              <TableRow>
                <TableCell></TableCell>
                <TableCell>
                  <Input className="h-7 text-xs" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Procedure description" autoFocus />
                </TableCell>
                <TableCell>
                  <Input className="h-7 text-xs" value={newSA} onChange={e => setNewSA(e.target.value)} placeholder="SA XXX" />
                </TableCell>
                <TableCell>
                  <Input className="h-7 text-xs" value={newRisk} onChange={e => setNewRisk(e.target.value)} placeholder="Risk area" />
                </TableCell>
                <TableCell colSpan={3}>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addCustom}>Add</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingNew(false)}>Cancel</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
