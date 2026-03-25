import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export interface AuditSetupData {
  financial_year: string;
  statutory_audit_applicable: boolean;
  tax_audit_applicable: boolean;
  caro_applicable: boolean;
  internal_audit_applicable: boolean;
  stock_audit_applicable: boolean;
  audit_billing_amount: string;
}

export const defaultAuditSetup: AuditSetupData = {
  financial_year: "",
  statutory_audit_applicable: false,
  tax_audit_applicable: false,
  caro_applicable: false,
  internal_audit_applicable: false,
  stock_audit_applicable: false,
  audit_billing_amount: "",
};

interface Props {
  data: AuditSetupData;
  onChange: (d: AuditSetupData) => void;
}

const TOGGLES: { key: keyof AuditSetupData; label: string }[] = [
  { key: "statutory_audit_applicable", label: "Statutory Audit Applicable" },
  { key: "tax_audit_applicable", label: "Tax Audit Applicable" },
  { key: "caro_applicable", label: "CARO Applicable" },
  { key: "internal_audit_applicable", label: "Internal Audit Applicable" },
  { key: "stock_audit_applicable", label: "Stock Audit Applicable" },
];

export const StepAuditSetup = ({ data, onChange }: Props) => {
  const set = <K extends keyof AuditSetupData>(key: K, val: AuditSetupData[K]) =>
    onChange({ ...data, [key]: val });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Audit Setup for FY {data.financial_year || "—"}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Configure audit applicability flags for this financial year.
        </p>
      </div>

      <div className="space-y-4">
        {TOGGLES.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between rounded-lg border border-border p-4">
            <Label className="text-sm font-medium">{label}</Label>
            <Switch
              checked={data[key] as boolean}
              onCheckedChange={(v) => set(key, v as any)}
            />
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label>Audit Billing Amount (₹)</Label>
        <Input
          type="number"
          min={0}
          value={data.audit_billing_amount}
          onChange={(e) => set("audit_billing_amount", e.target.value)}
          placeholder="0"
        />
        <p className="text-xs text-muted-foreground">
          The audit fee for this financial year. Can differ from previous year.
        </p>
      </div>
    </div>
  );
};
