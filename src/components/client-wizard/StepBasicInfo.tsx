import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, AlertCircle } from "lucide-react";

// TODO: Supabase migration needed:
// ALTER TABLE clients ADD COLUMN customer_id TEXT;
// CREATE UNIQUE INDEX idx_clients_customer_id ON clients(customer_id) WHERE customer_id IS NOT NULL;
//
// === CUSTOMER SYNC API INTEGRATION POINT ===
// The customer_id field is the unique identifier used to sync this client
// with external systems (Tally, accounting software, CRM, etc.)
//
// Usage pattern:
//   const response = await fetch(`${API_BASE}/customers/${client.customer_id}`);
//   const externalData = await response.json();
//   // Auto-fill Step 1 fields from externalData
//
// This ties into GAP-4 (API Import Draft Logic) where:
//   source = 'api_import' AND customer_id = externalSystemId
// =============================================

export interface BasicInfoData {
  name: string;
  customer_id: string;
  selectedGroupIds: string[];
  pan: string;
  entity_type: string;
  email: string;
  mobile: string;
  address: string;
  gstins: string[];
  tan_number: string;
}

const ENTITY_TYPES = [
  "Individual", "Proprietorship", "Partnership", "LLP", "Private Ltd",
  "Public Ltd", "HUF", "Trust", "AOP", "BOI",
];

interface GroupOption {
  id: string;
  name: string;
  color: string | null;
}

interface Props {
  data: BasicInfoData;
  onChange: (d: BasicInfoData) => void;
  errors: Record<string, string>;
}

export const StepBasicInfo = ({ data, onChange, errors }: Props) => {
  const [groups, setGroups] = useState<GroupOption[]>([]);

  useEffect(() => {
    // Fetch all groups globally (firm_id is nullable for global groups)
    supabase.from("client_groups").select("id, name, color").order("name").then(({ data: g }) => {
      setGroups((g as GroupOption[]) || []);
    });
  }, []);

  const update = (field: keyof BasicInfoData, value: any) =>
    onChange({ ...data, [field]: value });

  const toggleGroup = (id: string) => {
    const next = data.selectedGroupIds.includes(id)
      ? data.selectedGroupIds.filter((g) => g !== id)
      : [...data.selectedGroupIds, id];
    onChange({ ...data, selectedGroupIds: next });
  };

  const updateGstin = (index: number, value: string) => {
    const gstins = [...data.gstins];
    gstins[index] = value.toUpperCase();
    onChange({ ...data, gstins });
  };

  const addGstin = () => onChange({ ...data, gstins: [...data.gstins, ""] });
  const removeGstin = (i: number) => {
    const gstins = data.gstins.filter((_, idx) => idx !== i);
    onChange({ ...data, gstins: gstins.length ? gstins : [""] });
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-foreground">Step 1 — Basic Info</h2>

      {/* 1. Full Legal Name */}
      <div className="space-y-1.5">
        <Label>Full Legal Name <span className="text-destructive">*</span></Label>
        <Input
          value={data.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. Acme Pvt Ltd"
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>

      {/* 2. Customer ID */}
      <div className="space-y-1.5">
        <Label>Customer ID</Label>
        <Input
          value={data.customer_id}
          onChange={(e) => update("customer_id", e.target.value.slice(0, 100))}
          placeholder="e.g. CUST-00123 or Tally GUID"
          maxLength={100}
        />
        <p className="text-xs text-muted-foreground">Used for external API sync (e.g., Tally integration)</p>
        {errors.customer_id && <p className="text-xs text-destructive">{errors.customer_id}</p>}
      </div>

      {/* 3. Client Group (multi-select) — REQUIRED */}
      <div className="space-y-2">
        <Label>
          Client Group <span className="text-destructive" aria-hidden="true">*</span>
        </Label>

        {groups.length > 0 ? (
          <div
            className={`grid grid-cols-2 gap-2 rounded-md border p-2 transition-colors ${
              errors.selectedGroupIds
                ? "border-destructive ring-2 ring-destructive/40 bg-destructive/5"
                : "border-border"
            }`}
            role="group"
            aria-required="true"
            aria-invalid={!!errors.selectedGroupIds}
          >
            {groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 cursor-pointer text-sm select-none">
                <Checkbox
                  checked={data.selectedGroupIds.includes(g.id)}
                  onCheckedChange={() => toggleGroup(g.id)}
                />
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: g.color || "hsl(var(--muted-foreground))" }}
                />
                {g.name}
              </label>
            ))}
          </div>
        ) : (
          /* No groups in DB — always blocks since nothing can be selected */
          <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
            errors.selectedGroupIds
              ? "border-destructive bg-destructive/5 text-destructive"
              : "border-border text-muted-foreground"
          }`}>
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>No groups found. Go to <strong>Settings → Client Groups</strong> and create at least one group before adding clients.</span>
          </div>
        )}

        {/* Inline error — shown after failed Next / Save attempt */}
        {errors.selectedGroupIds && (
          <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {errors.selectedGroupIds}
          </p>
        )}
      </div>

      {/* 4. PAN */}
      <div className="space-y-1.5">
        <Label>PAN <span className="text-destructive">*</span></Label>
        <Input
          value={data.pan}
          onChange={(e) => update("pan", e.target.value.toUpperCase())}
          placeholder="ABCDE1234F"
          maxLength={10}
        />
        {errors.pan && <p className="text-xs text-destructive">{errors.pan}</p>}
      </div>

      {/* 5. Entity Type */}
      <div className="space-y-1.5">
        <Label>Entity Type <span className="text-destructive">*</span></Label>
        <Select value={data.entity_type} onValueChange={(v) => update("entity_type", v)}>
          <SelectTrigger><SelectValue placeholder="Select entity type" /></SelectTrigger>
          <SelectContent>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.entity_type && <p className="text-xs text-destructive">{errors.entity_type}</p>}
      </div>

      {/* 6. Email ID */}
      <div className="space-y-1.5">
        <Label>Email ID</Label>
        <Input
          type="email"
          value={data.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="client@example.com"
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
      </div>

      {/* 7. Mobile Number */}
      <div className="space-y-1.5">
        <Label>Mobile Number</Label>
        <Input
          value={data.mobile}
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, "").slice(0, 10);
            update("mobile", val);
          }}
          placeholder="9876543210"
          maxLength={10}
        />
        {errors.mobile && <p className="text-xs text-destructive">{errors.mobile}</p>}
      </div>

      {/* 8. Address */}
      <div className="space-y-1.5">
        <Label>Address</Label>
        <Textarea
          value={data.address}
          onChange={(e) => update("address", e.target.value)}
          placeholder="Full address"
          rows={3}
        />
      </div>

      {/* 9. GSTIN (dynamic rows) */}
      <div className="space-y-2">
        <Label>GSTIN</Label>
        {data.gstins.map((g, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-2">
              <Input
                value={g}
                onChange={(e) => updateGstin(i, e.target.value)}
                placeholder="22AAAAA0000A1Z5"
                maxLength={15}
                className="flex-1"
              />
              {data.gstins.length > 1 && (
                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => removeGstin(i)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
            {errors[`gstin_${i}`] && (
              <p className="text-xs text-destructive">{errors[`gstin_${i}`]}</p>
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1" onClick={addGstin}>
          <Plus className="h-3 w-3" /> Add Another GSTIN
        </Button>
      </div>

      {/* 10. TAN Number */}
      <div className="space-y-1.5">
        <Label>TAN Number</Label>
        <Input
          value={data.tan_number}
          onChange={(e) => update("tan_number", e.target.value.toUpperCase())}
          placeholder="DELA12345F"
          maxLength={10}
        />
        <p className="text-xs text-muted-foreground">Required if TDS service is activated in Step 3</p>
        {errors.tan_number && <p className="text-xs text-destructive">{errors.tan_number}</p>}
      </div>
    </div>
  );
};
