import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export interface FinancialProfileData {
  accounting_software: string;
  accounting_method: string;
  turnover_range: string;
  financial_standards: string;
  has_subsidiaries: boolean;
}

const SOFTWARE_OPTIONS = [
  "Tally Prime", "Tally ERP9", "Busy", "SAP", "Zoho Books", "Manual Excel", "Other",
];

const TURNOVER_OPTIONS = [
  { value: "under_20l", label: "Under ₹20L" },
  { value: "20l_1cr", label: "₹20L – ₹1Cr" },
  { value: "1cr_10cr", label: "₹1Cr – ₹10Cr" },
  { value: "10cr_50cr", label: "₹10Cr – ₹50Cr" },
  { value: "over_50cr", label: "Over ₹50Cr" },
];

interface Props {
  data: FinancialProfileData;
  onChange: (d: FinancialProfileData) => void;
}

export const StepFinancialProfile = ({ data, onChange }: Props) => {
  const update = (field: keyof FinancialProfileData, value: any) =>
    onChange({ ...data, [field]: value });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Step 2 — Financial Profile</h2>

      <div className="space-y-1.5">
        <Label>Accounting Software</Label>
        <Select value={data.accounting_software} onValueChange={(v) => update("accounting_software", v)}>
          <SelectTrigger><SelectValue placeholder="Select software" /></SelectTrigger>
          <SelectContent>
            {SOFTWARE_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Accounting Method</Label>
        <RadioGroup value={data.accounting_method} onValueChange={(v) => update("accounting_method", v)} className="flex gap-6">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="mercantile" id="mercantile" />
            <Label htmlFor="mercantile" className="font-normal cursor-pointer">Mercantile (Accrual)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="cash" id="cash" />
            <Label htmlFor="cash" className="font-normal cursor-pointer">Cash</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-1.5">
        <Label>Turnover Range</Label>
        <Select value={data.turnover_range} onValueChange={(v) => update("turnover_range", v)}>
          <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
          <SelectContent>
            {TURNOVER_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Financial Standards</Label>
        <RadioGroup value={data.financial_standards} onValueChange={(v) => update("financial_standards", v)} className="flex gap-6">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="indian_gaap" id="indian_gaap" />
            <Label htmlFor="indian_gaap" className="font-normal cursor-pointer">Indian GAAP (AS)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="ind_as" id="ind_as" />
            <Label htmlFor="ind_as" className="font-normal cursor-pointer">Ind AS</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <Label>Has Subsidiaries / Associates</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Enable if this entity has group companies</p>
        </div>
        <Switch checked={data.has_subsidiaries} onCheckedChange={(v) => update("has_subsidiaries", v)} />
      </div>
    </div>
  );
};
