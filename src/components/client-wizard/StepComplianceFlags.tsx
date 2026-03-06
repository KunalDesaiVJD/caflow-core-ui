import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface ComplianceFlagsData {
  gst_registered: boolean;
  tds_deductor: boolean;
  fixed_assets: boolean;
  govt_grants: boolean;
  multiple_banks: boolean;
  caro_applicable: boolean;
  transfer_pricing: boolean;
  mat_applicable: boolean;
  special_deductions: boolean;
  msme_suppliers: boolean;
}

const FLAGS: { key: keyof ComplianceFlagsData; label: string; desc: string }[] = [
  { key: "gst_registered", label: "GST Registered", desc: "Activates GST ITC, RCM, and output tax scrutiny checks" },
  { key: "tds_deductor", label: "TDS Deductor", desc: "Activates 194-series TDS checks on all payments" },
  { key: "fixed_assets", label: "Fixed Assets Held", desc: "Activates depreciation and asset verification checks" },
  { key: "govt_grants", label: "Government Grants / Subsidy", desc: "Activates AS-12 subsidy accounting checks" },
  { key: "multiple_banks", label: "Multiple Bank Accounts", desc: "Activates bank reconciliation automation" },
  { key: "caro_applicable", label: "CARO Applicable", desc: "Auto-set for companies. Required for 21-clause CARO report" },
  { key: "transfer_pricing", label: "Transfer Pricing", desc: "International transactions with related parties" },
  { key: "mat_applicable", label: "MAT Applicable", desc: "Minimum Alternate Tax — activates DTA/DTL checks" },
  { key: "special_deductions", label: "80-IC / 80-IE / 10AA Deductions", desc: "Special deductions — profit-linked" },
  { key: "msme_suppliers", label: "MSME Suppliers Present", desc: "Activates 45-day payment rule tracking (Sec 43B(h))" },
];

interface Props {
  data: ComplianceFlagsData;
  onChange: (d: ComplianceFlagsData) => void;
}

export const StepComplianceFlags = ({ data, onChange }: Props) => {
  const toggle = (key: keyof ComplianceFlagsData) =>
    onChange({ ...data, [key]: !data[key] });

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-foreground">Step 3 — Compliance Flags</h2>
      <p className="text-sm text-muted-foreground">Toggle the compliance flags relevant to this client. These activate specific scrutiny check groups.</p>

      <div className="space-y-3">
        {FLAGS.map((f) => (
          <div key={f.key} className="flex items-center justify-between rounded-lg border p-4">
            <div className="pr-4">
              <Label className="text-sm">{f.label}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
            </div>
            <Switch checked={data[f.key]} onCheckedChange={() => toggle(f.key)} />
          </div>
        ))}
      </div>
    </div>
  );
};
