import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export interface BasicInfoData {
  name: string;
  pan: string;
  entity_type: string;
  date_of_incorporation: Date | undefined;
  registered_state: string;
  business_nature: string;
  gstins: string[];
  cin: string;
}

const ENTITY_TYPES = [
  "Proprietorship", "Partnership", "LLP", "Private Ltd", "Public Ltd",
  "HUF", "Trust", "AOP", "BOI",
];

const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
  "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry",
];

interface Props {
  data: BasicInfoData;
  onChange: (d: BasicInfoData) => void;
  errors: Record<string, string>;
}

export const StepBasicInfo = ({ data, onChange, errors }: Props) => {
  const update = (field: keyof BasicInfoData, value: any) =>
    onChange({ ...data, [field]: value });

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

  const showCin = data.entity_type === "Private Ltd" || data.entity_type === "Public Ltd";

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-foreground">Step 1 — Basic Info</h2>

      {/* Name */}
      <div className="space-y-1.5">
        <Label>Full Legal Name <span className="text-destructive">*</span></Label>
        <Input value={data.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Acme Pvt Ltd" />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>

      {/* PAN */}
      <div className="space-y-1.5">
        <Label>PAN</Label>
        <Input
          value={data.pan}
          onChange={(e) => update("pan", e.target.value.toUpperCase())}
          placeholder="ABCDE1234F"
          maxLength={10}
        />
        {errors.pan && <p className="text-xs text-destructive">{errors.pan}</p>}
      </div>

      {/* Entity Type */}
      <div className="space-y-1.5">
        <Label>Entity Type</Label>
        <Select value={data.entity_type} onValueChange={(v) => update("entity_type", v)}>
          <SelectTrigger><SelectValue placeholder="Select entity type" /></SelectTrigger>
          <SelectContent>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Date of Incorporation */}
      <div className="space-y-1.5">
        <Label>Date of Incorporation</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn("w-full justify-start text-left font-normal", !data.date_of_incorporation && "text-muted-foreground")}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {data.date_of_incorporation ? format(data.date_of_incorporation, "PPP") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={data.date_of_incorporation}
              onSelect={(d) => update("date_of_incorporation", d)}
              disabled={(date) => date > new Date()}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Registered State */}
      <div className="space-y-1.5">
        <Label>Registered State</Label>
        <Select value={data.registered_state} onValueChange={(v) => update("registered_state", v)}>
          <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
          <SelectContent>
            {STATES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Business Nature */}
      <div className="space-y-1.5">
        <Label>Business Nature / NIC Code</Label>
        <Input value={data.business_nature} onChange={(e) => update("business_nature", e.target.value)} placeholder="e.g. Manufacturing — NIC 2410" />
      </div>

      {/* GSTIN */}
      <div className="space-y-2">
        <Label>GSTIN</Label>
        {data.gstins.map((g, i) => (
          <div key={i} className="flex gap-2">
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
        ))}
        {data.gstins.map((_, i) =>
          errors[`gstin_${i}`] ? (
            <p key={`err_${i}`} className="text-xs text-destructive">{errors[`gstin_${i}`]}</p>
          ) : null,
        )}
        <Button variant="outline" size="sm" className="gap-1" onClick={addGstin}>
          <Plus className="h-3 w-3" /> Add Another GSTIN
        </Button>
      </div>

      {/* CIN — conditional */}
      {showCin && (
        <div className="space-y-1.5">
          <Label>CIN (Corporate Identity Number)</Label>
          <Input
            value={data.cin}
            onChange={(e) => update("cin", e.target.value.toUpperCase())}
            placeholder="U12345MH2020PTC123456"
            maxLength={21}
          />
          {errors.cin && <p className="text-xs text-destructive">{errors.cin}</p>}
        </div>
      )}
    </div>
  );
};
