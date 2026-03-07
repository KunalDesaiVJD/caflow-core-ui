import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format, addDays } from "date-fns";
import {
  ArrowLeft, Plus, Trash2, Sparkles, Save, FileText,
} from "lucide-react";

interface Client {
  id: string;
  name: string | null;
  entity_type: string | null;
}

interface Engagement {
  id: string;
  client_id: string | null;
  financial_year: string | null;
  status: string | null;
}

interface LineItem {
  description: string;
  hours: number;
  rate: number;
  amount: number;
}

interface TimesheetEntry {
  id: string;
  description: string | null;
  hours: number | null;
  work_date: string | null;
  billable: boolean | null;
}

const NewInvoice = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const firmId = user?.firm_id;
  const isSuperadmin = user?.role === "superadmin";

  const [clients, setClients] = useState<Client[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [clientId, setClientId] = useState("");
  const [engagementId, setEngagementId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [invoiceNo, setInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", hours: 0, rate: 0, amount: 0 },
  ]);

  // AI state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDescriptions, setAiDescriptions] = useState<string[]>([]);

  // Fetch clients and generate invoice number
  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    try {
      let cQuery = supabase.from("clients").select("id, name, entity_type").order("name");
      if (!isSuperadmin && firmId) cQuery = cQuery.eq("firm_id", firmId);
      const { data: clientData } = await cQuery;
      setClients(clientData || []);

      // Auto-generate invoice number
      let invQuery = supabase.from("invoices").select("invoice_no").order("invoice_no", { ascending: false }).limit(1);
      if (!isSuperadmin && firmId) invQuery = invQuery.eq("firm_id", firmId);
      const { data: lastInv } = await invQuery;

      let nextNum = 1;
      if (lastInv && lastInv.length > 0 && lastInv[0].invoice_no) {
        const match = lastInv[0].invoice_no.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1]) + 1;
      }
      setInvoiceNo(`INV-${String(nextNum).padStart(4, "0")}`);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [firmId, isSuperadmin]);

  useEffect(() => { fetchInitialData(); }, [fetchInitialData]);

  // Fetch engagements when client changes
  useEffect(() => {
    if (!clientId) {
      setEngagements([]);
      setEngagementId("");
      return;
    }
    const fetchEngagements = async () => {
      let query = supabase
        .from("audit_engagements")
        .select("id, client_id, financial_year, status")
        .eq("client_id", clientId);
      if (!isSuperadmin && firmId) query = query.eq("firm_id", firmId);
      const { data } = await query;
      setEngagements(data || []);
    };
    fetchEngagements();
  }, [clientId, firmId, isSuperadmin]);

  // Line item helpers
  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) => {
      const next = [...prev];
      const item = { ...next[index] };

      if (field === "description") {
        item.description = value as string;
      } else {
        item[field] = Number(value) || 0;
      }

      if (field === "hours" || field === "rate") {
        item.amount = Math.round(item.hours * item.rate * 100) / 100;
      }

      next[index] = item;
      return next;
    });
  };

  const addLineItem = () => {
    setLineItems((prev) => [...prev, { description: "", hours: 0, rate: 0, amount: 0 }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Totals
  const subtotal = useMemo(() => lineItems.reduce((s, li) => s + li.amount, 0), [lineItems]);
  const gstAmount = useMemo(() => Math.round(subtotal * 0.18 * 100) / 100, [subtotal]);
  const total = useMemo(() => subtotal + gstAmount, [subtotal, gstAmount]);

  // AI Description
  const handleAiDescriptions = async () => {
    if (!clientId) {
      toast({ title: "Select a client first", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    setAiDescriptions([]);
    try {
      // Try fetching timesheets for engagement first, fall back to client context
      let contextMessage = "";

      if (engagementId) {
        const { data: tsData } = await supabase
          .from("timesheets")
          .select("id, description, hours, work_date, billable")
          .eq("engagement_id", engagementId)
          .order("work_date");

        if (tsData && tsData.length > 0) {
          contextMessage = JSON.stringify(tsData);
        }
      }

      // If no timesheets, build context from client + line items
      if (!contextMessage) {
        const clientName = clients.find((c) => c.id === clientId)?.name || "Client";
        const engagement = engagements.find((e) => e.id === engagementId);
        contextMessage = `Generate professional invoice line items for ${clientName}. ${
          engagement ? `Engagement: ${engagement.financial_year || "current year"} ${engagement.status || "audit"}.` : "General compliance services."
        } Current line items: ${lineItems.filter((l) => l.description).map((l) => l.description).join(", ") || "none yet"}`;
      }

      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "invoice_description",
          user_message: contextMessage,
        },
      });

      if (error) throw error;

      // Parse AI response - expect array of descriptions
      let descriptions: string[] = [];
      if (Array.isArray(data)) {
        descriptions = data.map((d: any) => typeof d === "string" ? d : d.description || String(d));
      } else if (data?.descriptions && Array.isArray(data.descriptions)) {
        descriptions = data.descriptions;
      } else if (data?.raw) {
        // AI returned raw text, split into lines
        descriptions = data.raw.split("\n").filter((l: string) => l.trim());
      } else if (typeof data === "string") {
        try {
          const parsed = JSON.parse(data);
          descriptions = Array.isArray(parsed) ? parsed : [data];
        } catch {
          descriptions = data.split("\n").filter((l: string) => l.trim());
        }
      }

      if (descriptions.length === 0) {
        toast({ title: "AI returned no descriptions. Try adding more context." });
      } else {
        setAiDescriptions(descriptions);
      }
    } catch (e: any) {
      toast({ title: "AI error", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiDescriptions = () => {
    if (aiDescriptions.length === 0) return;
    setLineItems((prev) => {
      const next = [...prev];
      aiDescriptions.forEach((desc, i) => {
        if (i < next.length) {
          next[i] = { ...next[i], description: desc };
        } else {
          next.push({ description: desc, hours: 0, rate: 0, amount: 0 });
        }
      });
      return next;
    });
    setAiDescriptions([]);
    toast({ title: "AI descriptions applied" });
  };

  // Save
  const handleSave = async () => {
    if (!clientId) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    if (lineItems.every((li) => !li.description.trim())) {
      toast({ title: "Add at least one line item", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        invoice_no: invoiceNo,
        client_id: clientId,
        firm_id: firmId || null,
        amount: subtotal,
        gst_amount: gstAmount,
        line_items: lineItems.filter((li) => li.description.trim()) as any,
        status: "draft",
        due_date: dueDate || null,
      };

      const { error } = await supabase.from("invoices").insert([payload]);
      if (error) throw error;
      toast({ title: "Invoice created" });
      navigate("/billing");
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // View PDF preview
  const handlePreviewPdf = () => {
    const clientName = clients.find((c) => c.id === clientId)?.name || "Client";
    const rows = lineItems
      .filter((li) => li.description.trim())
      .map((item, i) =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${i + 1}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${item.description}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${item.hours}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${item.rate.toLocaleString("en-IN")}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${item.amount.toLocaleString("en-IN")}</td>
        </tr>`
      ).join("");

    const html = `<!DOCTYPE html><html><head><title>Invoice ${invoiceNo}</title>
      <style>body{font-family:system-ui,sans-serif;margin:40px;color:#1a1a1a}
      table{width:100%;border-collapse:collapse}
      .header{display:flex;justify-content:space-between;margin-bottom:32px}
      .total-row{font-weight:700}
      @media print{body{margin:20px}}</style></head><body>
      <div class="header">
        <div><h1 style="margin:0;font-size:28px">INVOICE</h1>
        <p style="color:#666;margin:4px 0">${invoiceNo}</p></div>
        <div style="text-align:right">
          <p style="margin:4px 0"><strong>Client:</strong> ${clientName}</p>
          <p style="margin:4px 0"><strong>Date:</strong> ${invoiceDate ? format(new Date(invoiceDate), "dd MMM yyyy") : "—"}</p>
          <p style="margin:4px 0"><strong>Due:</strong> ${dueDate ? format(new Date(dueDate), "dd MMM yyyy") : "—"}</p>
        </div>
      </div>
      <table>
        <thead><tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left">#</th>
          <th style="padding:8px;text-align:left">Description</th>
          <th style="padding:8px;text-align:right">Hours</th>
          <th style="padding:8px;text-align:right">Rate</th>
          <th style="padding:8px;text-align:right">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td colspan="4" style="padding:8px;text-align:right">Subtotal</td>
          <td style="padding:8px;text-align:right">₹${subtotal.toLocaleString("en-IN")}</td></tr>
          <tr><td colspan="4" style="padding:8px;text-align:right">GST @ 18%</td>
          <td style="padding:8px;text-align:right">₹${gstAmount.toLocaleString("en-IN")}</td></tr>
          <tr class="total-row"><td colspan="4" style="padding:8px;text-align:right;font-size:18px">Total</td>
          <td style="padding:8px;text-align:right;font-size:18px">₹${total.toLocaleString("en-IN")}</td></tr>
        </tfoot>
      </table>
      ${notes ? `<div style="margin-top:32px;padding:16px;background:#f9f9f9;border-radius:8px"><p style="margin:0;font-size:14px;color:#666"><strong>Notes:</strong> ${notes}</p></div>` : ""}
      <div style="margin-top:40px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:14px">
        <p>Thank you for your business.</p>
      </div>
      <script>window.print()</script></body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/billing")}>
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">New Invoice</h1>
          <p className="text-muted-foreground text-sm">Create and generate a professional invoice</p>
        </div>
      </div>

      {/* SECTION 1 — Header Info */}
      <Card>
        <CardHeader><CardTitle className="text-base">Invoice Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Client *</label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v); setEngagementId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} ({c.entity_type || "—"})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Engagement</label>
              <Select value={engagementId} onValueChange={setEngagementId} disabled={!clientId}>
                <SelectTrigger><SelectValue placeholder={clientId ? "Select engagement" : "Select client first"} /></SelectTrigger>
                <SelectContent>
                  {engagements.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.financial_year || "N/A"} — {e.status || "Active"}</SelectItem>
                  ))}
                  {engagements.length === 0 && clientId && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No engagements found</div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Invoice Date</label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Due Date</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Invoice Number</label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2 — Line Items */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Line Items</CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={handleAiDescriptions}
              disabled={aiLoading || !clientId}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {aiLoading ? "Generating..." : "AI Descriptions"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* AI Suggestions Panel */}
          {aiDescriptions.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2">
              <p className="text-sm font-medium text-amber-800">AI-Generated Descriptions:</p>
              <ul className="text-sm text-amber-700 list-disc pl-4 space-y-1">
                {aiDescriptions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={applyAiDescriptions}>Apply All</Button>
                <Button size="sm" variant="ghost" onClick={() => setAiDescriptions([])}>Dismiss</Button>
              </div>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Description</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Rate (₹/hr)</TableHead>
                <TableHead className="text-right">Amount (₹)</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input
                      value={item.description}
                      onChange={(e) => updateLineItem(i, "description", e.target.value)}
                      placeholder="Description of services"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      value={item.hours || ""}
                      onChange={(e) => updateLineItem(i, "hours", e.target.value)}
                      className="text-right w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      value={item.rate || ""}
                      onChange={(e) => updateLineItem(i, "rate", e.target.value)}
                      className="text-right w-24"
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    ₹{item.amount.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => removeLineItem(i)}
                      disabled={lineItems.length <= 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={addLineItem}>
            <Plus className="h-3.5 w-3.5" /> Add Row
          </Button>

          {/* Totals */}
          <div className="mt-4 border-t pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">₹{subtotal.toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">GST @ 18%</span>
              <span className="tabular-nums">₹{gstAmount.toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-foreground">
              <span>Total</span>
              <span className="tabular-nums">₹{total.toLocaleString("en-IN")}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 3 — Notes */}
      <Card>
        <CardHeader><CardTitle className="text-base">Notes / Terms</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Payment terms, bank details, or any additional notes..."
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3 pb-8">
        <Button onClick={handleSave} disabled={saving} className="gap-1">
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Invoice"}
        </Button>
        <Button variant="outline" onClick={handlePreviewPdf} className="gap-1">
          <FileText className="h-4 w-4" /> Preview PDF
        </Button>
        <Button variant="ghost" onClick={() => navigate("/billing")}>Cancel</Button>
      </div>
    </div>
  );
};

export default NewInvoice;
