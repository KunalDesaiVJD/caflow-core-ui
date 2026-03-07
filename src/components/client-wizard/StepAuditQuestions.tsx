import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export interface AuditQuestionsData {
  previous_auditor: string;
  first_year_audit: boolean;
  pending_litigation: boolean;
  litigation_amount: string;
  litigation_description: string;
  related_party_transactions: boolean;
  related_party_details: string;
  fraud_suspected: boolean;
  going_concern_issues: boolean;
  going_concern_description: string;
  internal_audit_conducted: boolean;
  internal_auditor_name: string;
  internal_audit_scope: string;
}

export const emptyAuditQuestions: AuditQuestionsData = {
  previous_auditor: "",
  first_year_audit: false,
  pending_litigation: false,
  litigation_amount: "",
  litigation_description: "",
  related_party_transactions: false,
  related_party_details: "",
  fraud_suspected: false,
  going_concern_issues: false,
  going_concern_description: "",
  internal_audit_conducted: false,
  internal_auditor_name: "",
  internal_audit_scope: "",
};

interface Props {
  data: AuditQuestionsData;
  onChange: (d: AuditQuestionsData) => void;
}

export const StepAuditQuestions = ({ data, onChange }: Props) => {
  const update = (field: keyof AuditQuestionsData, value: any) =>
    onChange({ ...data, [field]: value });

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-foreground">Step 5 — Audit Questions</h2>

      <div className="space-y-1.5">
        <Label>Previous Auditor Firm Name</Label>
        <Input value={data.previous_auditor} onChange={(e) => update("previous_auditor", e.target.value)} placeholder="e.g. Deloitte Haskins & Sells" />
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={data.first_year_audit} onCheckedChange={(v) => update("first_year_audit", v)} />
        <Label>Is this the first year of audit with your firm?</Label>
      </div>

      {/* Pending Litigation */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch checked={data.pending_litigation} onCheckedChange={(v) => update("pending_litigation", v)} />
          <Label>Any pending litigation / tax demands?</Label>
        </div>
        {data.pending_litigation && (
          <div className="pl-6 space-y-2">
            <Input placeholder="Amount (₹)" type="number" value={data.litigation_amount} onChange={(e) => update("litigation_amount", e.target.value)} />
            <Input placeholder="Brief description" value={data.litigation_description} onChange={(e) => update("litigation_description", e.target.value)} />
          </div>
        )}
      </div>

      {/* Related Party Transactions */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch checked={data.related_party_transactions} onCheckedChange={(v) => update("related_party_transactions", v)} />
          <Label>Related party transactions during the year?</Label>
        </div>
        {data.related_party_transactions && (
          <div className="pl-6">
            <Textarea placeholder="Describe parties and nature of transactions" value={data.related_party_details} onChange={(e) => update("related_party_details", e.target.value)} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={data.fraud_suspected} onCheckedChange={(v) => update("fraud_suspected", v)} />
        <Label>Any fraud or suspected fraud?</Label>
      </div>

      {/* Going Concern */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch checked={data.going_concern_issues} onCheckedChange={(v) => update("going_concern_issues", v)} />
          <Label>Going concern issues (losses, debt breach)?</Label>
        </div>
        {data.going_concern_issues && (
          <div className="pl-6">
            <Textarea placeholder="Describe the going concern issues" value={data.going_concern_description} onChange={(e) => update("going_concern_description", e.target.value)} />
          </div>
        )}
      </div>

      {/* Internal Audit */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch checked={data.internal_audit_conducted} onCheckedChange={(v) => update("internal_audit_conducted", v)} />
          <Label>Internal audit conducted?</Label>
        </div>
        {data.internal_audit_conducted && (
          <div className="pl-6 space-y-2">
            <Input placeholder="Auditor name" value={data.internal_auditor_name} onChange={(e) => update("internal_auditor_name", e.target.value)} />
            <Input placeholder="Scope covered" value={data.internal_audit_scope} onChange={(e) => update("internal_audit_scope", e.target.value)} />
          </div>
        )}
      </div>
    </div>
  );
};
