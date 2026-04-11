import { useState, useEffect } from "react";
import { format } from "date-fns";
import { CalendarIcon, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* ───── Interface ───── */
export interface AdvancedInfoData {
  financial_year: string;
  classification: string;
  audit_firm_id: string;
  responsible_person_id: string;
  date_of_incorporation: Date | undefined;
  registered_state: string;
  business_nature: string;
  cin: string;
  dsc_number: string;
  dsc_expiry_date: Date | undefined;
  work_group_type: string;
}

/* ───── Helpers ───── */
function getCurrentFY(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-indexed
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

function generateFYOptions(): string[] {
  const today = new Date();
  const currentStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const endYear = currentStartYear + 2;
  const options: string[] = [];
  for (let y = 2020; y <= endYear; y++) {
    options.push(`${y}-${String(y + 1).slice(2)}`);
  }
  return options;
}

export const defaultAdvancedInfo: AdvancedInfoData = {
  financial_year: getCurrentFY(),
  classification: "",
  audit_firm_id: "",
  responsible_person_id: "",
  date_of_incorporation: undefined,
  registered_state: "",
  business_nature: "",
  cin: "",
  dsc_number: "",
  dsc_expiry_date: undefined,
  work_group_type: "",
};

const CLASSIFICATIONS = [
  "Audit",
  "Non-Audit",
  "Partner in Audited Firm",
  "Not Applicable",
];

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
  "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry",
];

const FY_OPTIONS = generateFYOptions();

/* ───── Props ───── */
interface Props {
  data: AdvancedInfoData;
  onChange: (d: AdvancedInfoData) => void;
  entityType: string; // from Step 1
  itrServiceActive: boolean;
  errors: Record<string, string>;
  /** The classification value that was already saved to DB (edit mode only).
   *  When provided and the user picks a different value, a warning modal fires
   *  before the change is applied. */
  savedClassification?: string;
}

export const StepAdvancedInfo = ({
  data, onChange, entityType, itrServiceActive, errors, savedClassification,
}: Props) => {
  const { user } = useAuth();

  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  /** Classification value waiting for user confirmation before being applied */
  const [pendingClassification, setPendingClassification] = useState<string | null>(null);

  const set = <K extends keyof AdvancedInfoData>(key: K, val: AdvancedInfoData[K]) =>
    onChange({ ...data, [key]: val });

  /** Apply a classification change, resetting dependent fields */
  const applyClassificationChange = (v: string) => {
    const updates: Partial<AdvancedInfoData> = { classification: v };
    if (v !== "Audit")                                          updates.audit_firm_id = "";
    if (v !== "Non-Audit" && v !== "Partner in Audited Firm")  updates.responsible_person_id = "";
    onChange({ ...data, ...updates });
  };

  /** Handle classification dropdown change — show warning in edit mode when value differs from saved */
  const handleClassificationChange = (v: string) => {
    const isDifferentFromSaved =
      savedClassification &&
      savedClassification !== "" &&
      v !== savedClassification;

    if (isDifferentFromSaved) {
      // Intercept: ask user to confirm before applying
      setPendingClassification(v);
    } else {
      applyClassificationChange(v);
    }
  };

  /* Load users for responsible person */
  useEffect(() => {
    if (data.classification !== "Non-Audit" && data.classification !== "Partner in Audited Firm") return;
    const load = async () => {
      let query = supabase.from("users").select("id, name").eq("is_active", true).order("name");
      if (user?.firm_id) query = query.eq("firm_id", user.firm_id);
      const { data: usrs } = await query;
      if (usrs) setUsers(usrs);
    };
    load();
  }, [data.classification, user?.firm_id]);

  /* Derived state for work group sub-option */
  const isItrWithAccounts = data.work_group_type === "itr_with_accounts_inside" || data.work_group_type === "itr_with_accounts_outside";
  const topLevelWorkGroup = data.work_group_type === "only_itr" ? "only_itr" : isItrWithAccounts ? "itr_with_accounts" : "";

  const handleTopLevelWorkGroup = (val: string) => {
    if (val === "only_itr") set("work_group_type", "only_itr");
    else if (val === "itr_with_accounts") set("work_group_type", "itr_with_accounts_inside"); // default sub
    else set("work_group_type", "");
  };

  const needsCIN = entityType === "Private Ltd" || entityType === "Public Ltd";

  return (
    <div className="space-y-8">
      {/* ── SECTION A: Classification ── */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Classification</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Financial Year */}
          <div className="space-y-1.5">
            <Label>Classification Financial Year <span className="text-destructive">*</span></Label>
            <Select value={data.financial_year} onValueChange={(v) => set("financial_year", v)}>
              <SelectTrigger><SelectValue placeholder="Select FY" /></SelectTrigger>
              <SelectContent>
                {FY_OPTIONS.map((fy) => (
                  <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.financial_year && <p className="text-xs text-destructive">{errors.financial_year}</p>}
          </div>

          {/* Classification */}
          <div className="space-y-1.5">
            <Label>Client Classification <span className="text-destructive">*</span></Label>
            <Select value={data.classification} onValueChange={handleClassificationChange}>
              <SelectTrigger><SelectValue placeholder="Select classification" /></SelectTrigger>
              <SelectContent>
                {CLASSIFICATIONS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.classification && <p className="text-xs text-destructive">{errors.classification}</p>}
          </div>
        </div>

        {/* Audit Firm removed — managed in Audit Engagement */}

        {/* Responsible Person — "Non-Audit" or "Partner in Audited Firm" */}
        {(data.classification === "Non-Audit" || data.classification === "Partner in Audited Firm") && (
          <div className="space-y-1.5">
            <Label>Responsible Person</Label>
            <Select value={data.responsible_person_id} onValueChange={(v) => set("responsible_person_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">This person will be the default assignee in ITR Management</p>
          </div>
        )}
      </div>

      {/* ── SECTION B: Legal Registration ── */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Legal Registration</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  {data.date_of_incorporation ? format(data.date_of_incorporation, "dd/MM/yyyy") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={data.date_of_incorporation}
                  onSelect={(d) => set("date_of_incorporation", d)}
                  disabled={(d) => d > new Date()}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Registered State */}
          <div className="space-y-1.5">
            <Label>Registered State</Label>
            <Select value={data.registered_state} onValueChange={(v) => set("registered_state", v)}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Business Nature */}
          <div className="space-y-1.5">
            <Label>Business Nature / NIC Code</Label>
            <Input value={data.business_nature} onChange={(e) => set("business_nature", e.target.value)} placeholder="e.g. Manufacturing of textiles" />
          </div>

          {/* CIN — only for Private Ltd / Public Ltd */}
          {needsCIN && (
            <div className="space-y-1.5">
              <Label>CIN</Label>
              <Input
                value={data.cin}
                onChange={(e) => set("cin", e.target.value.toUpperCase())}
                placeholder="21-character Company Identification Number"
                maxLength={21}
              />
              {errors.cin && <p className="text-xs text-destructive">{errors.cin}</p>}
              {!errors.cin && (
                <p className="text-xs text-muted-foreground">CIN is expected for {entityType} entities</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION C: Digital Signature ── */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Digital Signature</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>DSC Number</Label>
            <Input value={data.dsc_number} onChange={(e) => set("dsc_number", e.target.value)} placeholder="Digital Signature Certificate number" />
          </div>

          <div className="space-y-1.5">
            <Label>
              DSC Expiry Date
              {data.dsc_number && <span className="text-destructive"> *</span>}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !data.dsc_expiry_date && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {data.dsc_expiry_date ? format(data.dsc_expiry_date, "dd/MM/yyyy") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={data.dsc_expiry_date}
                  onSelect={(d) => set("dsc_expiry_date", d)}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            {errors.dsc_expiry_date && <p className="text-xs text-destructive">{errors.dsc_expiry_date}</p>}
          </div>
        </div>
      </div>

      {/* ── Classification Change Warning Modal ── */}
      <Dialog
        open={!!pendingClassification}
        onOpenChange={(open) => { if (!open) setPendingClassification(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Change Classification?
            </DialogTitle>
            <DialogDescription className="pt-2 space-y-2 text-sm">
              <p>
                You are changing the classification for FY{" "}
                <strong>{data.financial_year}</strong> from{" "}
                <strong className="text-indigo-600">{savedClassification}</strong> to{" "}
                <strong className="text-indigo-600">{pendingClassification}</strong>.
              </p>
              <p className="text-muted-foreground">
                The previous <strong>{savedClassification}</strong> record for FY{" "}
                <strong>{data.financial_year}</strong> will be preserved in history and
                can be viewed at any time. This action only affects future operations.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setPendingClassification(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={() => {
                if (pendingClassification) applyClassificationChange(pendingClassification);
                setPendingClassification(null);
              }}
            >
              Confirm Change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── SECTION D: Work Group ── */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Work Group</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Work Group</Label>
            {itrServiceActive ? (
              <Select value={topLevelWorkGroup} onValueChange={handleTopLevelWorkGroup}>
                <SelectTrigger><SelectValue placeholder="Select work group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="only_itr">Only ITR</SelectItem>
                  <SelectItem value="itr_with_accounts">ITR with Accounts</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Select disabled>
                        <SelectTrigger className="opacity-50 cursor-not-allowed">
                          <SelectValue placeholder="Select work group" />
                        </SelectTrigger>
                      </Select>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Activate ITR service in Step 3 to enable Work Group</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Sub-option for ITR with Accounts */}
          {itrServiceActive && topLevelWorkGroup === "itr_with_accounts" && (
            <div className="space-y-1.5">
              <Label>Accounts Location</Label>
              <Select value={data.work_group_type} onValueChange={(v) => set("work_group_type", v)}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="itr_with_accounts_inside">Accounts inside office</SelectItem>
                  <SelectItem value="itr_with_accounts_outside">Accounts outside office</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
