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
  extra_emails: string[];
  mobile: string;
  address: string;
  gstins: string[];
  gstin_states: Record<string, string>;    // key = GSTIN, value = state name
  gstin_addresses: Record<string, string>; // key = GSTIN, value = registered address
  tan_number: string;
}

// ─── GSTIN State Code Map ─────────────────────────────────────────────────────
const GSTIN_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman & Diu", "26": "Dadra & Nagar Haveli",
  "27": "Maharashtra", "28": "Andhra Pradesh (Old)", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

function detectStateFromGstin(gstin: string): string {
  if (!gstin || gstin.length < 2) return "";
  return GSTIN_STATE_CODES[gstin.substring(0, 2)] ?? "";
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
    const upper = value.toUpperCase();
    const gstins = [...data.gstins];
    const old = gstins[index];
    gstins[index] = upper;
    // Auto-detect state from new GSTIN prefix; preserve manual overrides for existing GSTINs
    const states = { ...data.gstin_states };
    const addresses = { ...data.gstin_addresses };
    if (old && old !== upper) { delete states[old]; delete addresses[old]; }
    if (upper.length >= 2) {
      const detected = detectStateFromGstin(upper);
      if (detected && !states[upper]) states[upper] = detected;
    }
    // Auto-fill registered address from client's main address when not already set
    if (upper.length > 0 && data.address && !addresses[upper]) {
      addresses[upper] = data.address;
    }
    onChange({ ...data, gstins, gstin_states: states, gstin_addresses: addresses });
  };

  const updateGstinState = (gstin: string, stateName: string) => {
    onChange({ ...data, gstin_states: { ...data.gstin_states, [gstin]: stateName } });
  };

  const updateGstinAddress = (gstin: string, address: string) => {
    onChange({ ...data, gstin_addresses: { ...data.gstin_addresses, [gstin]: address } });
  };

  const addGstin = () => onChange({ ...data, gstins: [...data.gstins, ""] });
  const removeGstin = (i: number) => {
    const removed = data.gstins[i];
    const gstins = data.gstins.filter((_, idx) => idx !== i);
    const states = { ...data.gstin_states };
    const addresses = { ...data.gstin_addresses };
    if (removed) { delete states[removed]; delete addresses[removed]; }
    onChange({ ...data, gstins: gstins.length ? gstins : [""], gstin_states: states, gstin_addresses: addresses });
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

      {/* 6. Email ID(s) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Email ID</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => update("extra_emails", [...(data.extra_emails || []), ""])}
          >
            <Plus size={12} /> Add another email
          </Button>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              type="email"
              value={data.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="client@example.com"
              className="flex-1"
            />
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium shrink-0">Primary</span>
          </div>
          {(data.extra_emails || []).map((em, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                type="email"
                value={em}
                onChange={e => {
                  const arr = [...(data.extra_emails || [])];
                  arr[idx] = e.target.value;
                  update("extra_emails", arr);
                }}
                placeholder={`Additional email ${idx + 1}`}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => {
                  const arr = (data.extra_emails || []).filter((_, i) => i !== idx);
                  update("extra_emails", arr);
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
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

      {/* 9. Address */}
      <div className="space-y-1.5">
        <Label>Address</Label>
        <Textarea
          value={data.address}
          onChange={(e) => update("address", e.target.value)}
          placeholder="Full address"
          rows={3}
        />
      </div>

      {/* 10. GSTIN (dynamic rows) */}
      <div className="space-y-2">
        <Label>GSTIN</Label>
        {data.gstins.map((g, i) => {
          const detectedState = g.length >= 2 ? (detectStateFromGstin(g) || "") : "";
          const savedState = g ? (data.gstin_states[g] ?? detectedState) : "";
          return (
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
              {/* Per-GSTIN Registered State */}
              {g.length >= 2 && (
                <div className="flex items-center gap-2 pl-1">
                  <span className="text-xs text-muted-foreground w-28 shrink-0">Registered State:</span>
                  <Select
                    value={savedState}
                    onValueChange={(v) => g && updateGstinState(g, v)}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Auto-detected / Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(GSTIN_STATE_CODES).map(([code, name]) => (
                        <SelectItem key={code} value={name} className="text-xs">
                          {code} — {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {detectedState && savedState === detectedState && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">auto</span>
                  )}
                </div>
              )}
              {/* Per-GSTIN Registered Address */}
              {g.length >= 2 && (
                <div className="flex items-start gap-2 pl-1">
                  <span className="text-xs text-muted-foreground w-28 shrink-0 pt-1.5">Registered Address:</span>
                  <Textarea
                    value={data.gstin_addresses[g] ?? ""}
                    onChange={(e) => g && updateGstinAddress(g, e.target.value)}
                    placeholder={`Address for ${g}`}
                    rows={2}
                    className="text-xs flex-1 min-h-[3rem]"
                  />
                </div>
              )}
              {errors[`gstin_${i}`] && (
                <p className="text-xs text-destructive">{errors[`gstin_${i}`]}</p>
              )}
            </div>
          );
        })}
        <Button variant="outline" size="sm" className="gap-1" onClick={addGstin}>
          <Plus className="h-3 w-3" /> Add Another GSTIN
        </Button>
      </div>

      {/* 11. TAN Number */}
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
