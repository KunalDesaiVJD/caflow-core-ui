import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

interface BankAccount {
  bank_name: string;
  branch: string;
  account_number: string;
  account_type: string;
}

interface SecuredLoan {
  lender_name: string;
  sanction_amount: string;
  outstanding_balance: string;
  interest_rate: string;
  collateral: string;
}

interface UnsecuredLoan {
  lender_name: string;
  pan: string;
  relationship: string;
  amount: string;
  interest_rate: string;
}

interface RelatedPartyLoan {
  party_name: string;
  pan: string;
  amount: string;
  interest_rate: string;
}

export interface BankingLoansData {
  bank_accounts: BankAccount[];
  secured_loans: SecuredLoan[];
  unsecured_loans: UnsecuredLoan[];
  loans_to_related_parties: boolean;
  related_party_loans: RelatedPartyLoan[];
}

export const emptyBankingLoans: BankingLoansData = {
  bank_accounts: [{ bank_name: "", branch: "", account_number: "", account_type: "" }],
  secured_loans: [],
  unsecured_loans: [],
  loans_to_related_parties: false,
  related_party_loans: [],
};

interface Props {
  data: BankingLoansData;
  onChange: (d: BankingLoansData) => void;
}

const ACCOUNT_TYPES = ["Current", "CC", "OD", "FD"];

export const StepBankingLoans = ({ data, onChange }: Props) => {
  // Bank accounts
  const updateBank = (i: number, field: keyof BankAccount, value: string) => {
    const arr = [...data.bank_accounts];
    arr[i] = { ...arr[i], [field]: value };
    onChange({ ...data, bank_accounts: arr });
  };
  const addBank = () =>
    onChange({ ...data, bank_accounts: [...data.bank_accounts, { bank_name: "", branch: "", account_number: "", account_type: "" }] });
  const removeBank = (i: number) =>
    onChange({ ...data, bank_accounts: data.bank_accounts.filter((_, idx) => idx !== i) });

  // Secured loans
  const updateSecured = (i: number, field: keyof SecuredLoan, value: string) => {
    const arr = [...data.secured_loans];
    arr[i] = { ...arr[i], [field]: value };
    onChange({ ...data, secured_loans: arr });
  };
  const addSecured = () =>
    onChange({ ...data, secured_loans: [...data.secured_loans, { lender_name: "", sanction_amount: "", outstanding_balance: "", interest_rate: "", collateral: "" }] });
  const removeSecured = (i: number) =>
    onChange({ ...data, secured_loans: data.secured_loans.filter((_, idx) => idx !== i) });

  // Unsecured loans
  const updateUnsecured = (i: number, field: keyof UnsecuredLoan, value: string) => {
    const arr = [...data.unsecured_loans];
    arr[i] = { ...arr[i], [field]: value };
    onChange({ ...data, unsecured_loans: arr });
  };
  const addUnsecured = () =>
    onChange({ ...data, unsecured_loans: [...data.unsecured_loans, { lender_name: "", pan: "", relationship: "", amount: "", interest_rate: "" }] });
  const removeUnsecured = (i: number) =>
    onChange({ ...data, unsecured_loans: data.unsecured_loans.filter((_, idx) => idx !== i) });

  // Related party loans
  const updateRelated = (i: number, field: keyof RelatedPartyLoan, value: string) => {
    const arr = [...data.related_party_loans];
    arr[i] = { ...arr[i], [field]: value };
    onChange({ ...data, related_party_loans: arr });
  };
  const addRelated = () =>
    onChange({ ...data, related_party_loans: [...data.related_party_loans, { party_name: "", pan: "", amount: "", interest_rate: "" }] });
  const removeRelated = (i: number) =>
    onChange({ ...data, related_party_loans: data.related_party_loans.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Step 4 — Banking & Loans</h2>

      {/* Bank Accounts */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Bank Accounts</Label>
        {data.bank_accounts.map((b, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 p-3 border rounded-md relative">
            <Input placeholder="Bank Name" value={b.bank_name} onChange={(e) => updateBank(i, "bank_name", e.target.value)} />
            <Input placeholder="Branch" value={b.branch} onChange={(e) => updateBank(i, "branch", e.target.value)} />
            <Input placeholder="Account Number" value={b.account_number} onChange={(e) => updateBank(i, "account_number", e.target.value)} />
            <Select value={b.account_type} onValueChange={(v) => updateBank(i, "account_type", v)}>
              <SelectTrigger><SelectValue placeholder="Account Type" /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {data.bank_accounts.length > 1 && (
              <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7" onClick={() => removeBank(i)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1" onClick={addBank}>
          <Plus className="h-3 w-3" /> Add Row
        </Button>
      </div>

      {/* Secured Loans */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Secured Loans</Label>
        {data.secured_loans.length === 0 && <p className="text-sm text-muted-foreground">No secured loans added.</p>}
        {data.secured_loans.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 p-3 border rounded-md relative">
            <Input placeholder="Lender Name" value={l.lender_name} onChange={(e) => updateSecured(i, "lender_name", e.target.value)} />
            <Input placeholder="Sanction Amount" type="number" value={l.sanction_amount} onChange={(e) => updateSecured(i, "sanction_amount", e.target.value)} />
            <Input placeholder="Outstanding Balance" type="number" value={l.outstanding_balance} onChange={(e) => updateSecured(i, "outstanding_balance", e.target.value)} />
            <Input placeholder="Interest Rate %" type="number" value={l.interest_rate} onChange={(e) => updateSecured(i, "interest_rate", e.target.value)} />
            <Input placeholder="Collateral Description" value={l.collateral} onChange={(e) => updateSecured(i, "collateral", e.target.value)} className="col-span-2" />
            <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7" onClick={() => removeSecured(i)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1" onClick={addSecured}>
          <Plus className="h-3 w-3" /> Add Row
        </Button>
      </div>

      {/* Unsecured Loans */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Unsecured Loans</Label>
        {data.unsecured_loans.length === 0 && <p className="text-sm text-muted-foreground">No unsecured loans added.</p>}
        {data.unsecured_loans.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 p-3 border rounded-md relative">
            <Input placeholder="Lender Name" value={l.lender_name} onChange={(e) => updateUnsecured(i, "lender_name", e.target.value)} />
            <Input placeholder="PAN" value={l.pan} onChange={(e) => updateUnsecured(i, "pan", e.target.value.toUpperCase())} maxLength={10} />
            <Input placeholder="Relationship to Entity" value={l.relationship} onChange={(e) => updateUnsecured(i, "relationship", e.target.value)} />
            <Input placeholder="Amount" type="number" value={l.amount} onChange={(e) => updateUnsecured(i, "amount", e.target.value)} />
            <Input placeholder="Interest Rate %" type="number" value={l.interest_rate} onChange={(e) => updateUnsecured(i, "interest_rate", e.target.value)} />
            <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7" onClick={() => removeUnsecured(i)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1" onClick={addUnsecured}>
          <Plus className="h-3 w-3" /> Add Row
        </Button>
      </div>

      {/* Related Party Loans */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={data.loans_to_related_parties}
            onCheckedChange={(v) => onChange({ ...data, loans_to_related_parties: v, related_party_loans: v ? (data.related_party_loans.length ? data.related_party_loans : [{ party_name: "", pan: "", amount: "", interest_rate: "" }]) : [] })}
          />
          <Label>Any loans given to related parties?</Label>
        </div>
        {data.loans_to_related_parties && (
          <>
            {data.related_party_loans.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 p-3 border rounded-md relative">
                <Input placeholder="Party Name" value={r.party_name} onChange={(e) => updateRelated(i, "party_name", e.target.value)} />
                <Input placeholder="PAN" value={r.pan} onChange={(e) => updateRelated(i, "pan", e.target.value.toUpperCase())} maxLength={10} />
                <Input placeholder="Amount" type="number" value={r.amount} onChange={(e) => updateRelated(i, "amount", e.target.value)} />
                <Input placeholder="Interest Rate Charged %" type="number" value={r.interest_rate} onChange={(e) => updateRelated(i, "interest_rate", e.target.value)} />
                {data.related_party_loans.length > 1 && (
                  <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7" onClick={() => removeRelated(i)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1" onClick={addRelated}>
              <Plus className="h-3 w-3" /> Add Row
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
