import { useState, useEffect } from "react";
import { format } from "date-fns";
import { CalendarIcon, AlertTriangle, CalendarClock, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";

/* ───── Interface ───── */
export interface AdvancedInfoData {
  financial_year: string;
  classification: string;
  audit_firm_id: string;
  responsible_person_id: string;
  contact_person: string;
  date_of_incorporation: Date | undefined;
  registered_state: string;
  business_nature: string;
  cin: string;
  dsc_number: string;
  dsc_expiry_date: Date | undefined;
  work_group_type: string;
  /** Director details — only used for Private Ltd / Public Ltd entities */
  directors?: Array<{ name: string; din: string }>;
  /** Pending classification-change metadata, captured by the change-confirmation
   *  modal and consumed by NewClientWizard.saveFYClassification when writing the
   *  client_classification_history row. Optional — only present when the user
   *  just confirmed a classification change in this session. */
  pending_classification_change?: {
    effective_from_fy: string;
    responsible_person_id?: string;
    notes?: string;
  };
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

/** Compare two FY strings (e.g. "2024-25" vs "2025-26") by start year.
 *  Returns -1 if fy1 < fy2, 1 if fy1 > fy2, 0 if equal. */
function fyCompare(fy1: string, fy2: string): -1 | 0 | 1 {
  const y1 = parseInt(fy1.split("-")[0]);
  const y2 = parseInt(fy2.split("-")[0]);
  return y1 < y2 ? -1 : y1 > y2 ? 1 : 0;
}

/** "2025-26" → "2024-25" */
function getPreviousFY(fy: string): string {
  const [start] = fy.split("-");
  const s = parseInt(start);
  if (isNaN(s)) return "";
  return `${s - 1}-${String(s).slice(2)}`;
}

export const defaultAdvancedInfo: AdvancedInfoData = {
  financial_year: getCurrentFY(),
  classification: "",
  audit_firm_id: "",
  responsible_person_id: "",
  contact_person: "",
  date_of_incorporation: undefined,
  registered_state: "",
  business_nature: "",
  cin: "",
  dsc_number: "",
  dsc_expiry_date: undefined,
  work_group_type: "",
  directors: [],
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

/** Effective-from FY options surfaced inside the classification-change modal.
 *  Wider than the dropdown so users can backdate or future-date a change. */
const CHANGE_EFFECTIVE_FY_OPTIONS = [
  "2020-21", "2021-22", "2022-23", "2023-24", "2024-25",
  "2025-26", "2026-27", "2027-28", "2028-29", "2029-30",
];

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
  /** Existing client id (edit mode). When present, the classification-change
   *  modal commits directly to the DB. When absent (new-client wizard), the
   *  modal only stashes metadata for later persistence. */
  clientId?: string;
  /** First FY in which this client could possibly be classified — typically
   *  the FY of client creation / registration. Used to block effective-from
   *  picks before the client existed. */
  clientCreationFY?: string;
  /** Optional refetch hook called after a successful classification commit.
   *  Receives the new classification value so the parent can update its
   *  savedClassification snapshot without relying on a stale closure. */
  onClassificationSaved?: (newClassification: string, effectiveFromFY: string) => void;
}

export const StepAdvancedInfo = ({
  data, onChange, entityType, itrServiceActive, errors, savedClassification,
  clientId, clientCreationFY, onClassificationSaved,
}: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [savingClassification, setSavingClassification] = useState(false);

  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  /** Classification value waiting for user confirmation before being applied */
  const [pendingClassification, setPendingClassification] = useState<string | null>(null);
  /** Modal-local state for the classification-change confirmation dialog */
  const [effectiveFromFY, setEffectiveFromFY] = useState<string>("");
  const [pendingResponsiblePersonId, setPendingResponsiblePersonId] = useState<string>("");
  const [changeNotes, setChangeNotes] = useState<string>("");

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
      // Intercept: ask user to confirm before applying.
      // Reset the modal-local fields so each change starts clean.
      setEffectiveFromFY("");
      setPendingResponsiblePersonId(data.responsible_person_id || "");
      setChangeNotes("");
      setPendingClassification(v);
    } else {
      applyClassificationChange(v);
    }
  };

  /** Apply the new classification + change metadata to the local wizard state.
   *  Used both in new-client mode (no DB write yet — wizard persists on Save)
   *  and after a successful DB commit in edit mode. */
  const stashClassificationLocally = (newValue: string) => {
    const updates: Partial<AdvancedInfoData> = {
      classification: newValue,
      // Sync the Classification Financial Year dropdown to match the effective FY the user just set
      financial_year: effectiveFromFY || data.financial_year,
    };
    if (newValue !== "Audit") updates.audit_firm_id = "";
    if (newValue !== "Non-Audit" && newValue !== "Partner in Audited Firm") {
      updates.responsible_person_id = "";
    } else if (pendingResponsiblePersonId) {
      updates.responsible_person_id = pendingResponsiblePersonId;
    }
    updates.pending_classification_change = {
      effective_from_fy: effectiveFromFY,
      responsible_person_id: pendingResponsiblePersonId || undefined,
      notes: changeNotes.trim() || undefined,
    };
    onChange({ ...data, ...updates });
  };

  /** Confirm handler for the classification-change modal.
   *  Edit mode (clientId set): writes history + upserts FY row + (conditionally)
   *  flips clients.classification + stashes locally + closes modal.
   *  New-client mode: only stashes locally — wizard persists on final Save. */
  const handleConfirmClassificationChange = async () => {
    if (!pendingClassification) return;

    // ── Validation 1: effectiveFromFY required ───────────────────────────
    if (!effectiveFromFY) {
      toast({ title: "Effective From FY is required", variant: "destructive" });
      return;
    }

    // ── Soft notice: effective FY predates client creation FY ───────────
    // Earlier this was a hard block, but it prevented correcting a wrong
    // classification set at onboarding (e.g. a junior picking "Audit" by
    // mistake).  Allow the change and just inform the user.
    if (clientCreationFY && fyCompare(effectiveFromFY, clientCreationFY) < 0) {
      toast({
        title: "Applying correction",
        description: `Client was created in FY ${clientCreationFY}. The new classification will still be recorded from FY ${effectiveFromFY}.`,
      });
    }

    // ── New-client mode: no DB writes — stash & close ────────────────────
    if (!clientId) {
      stashClassificationLocally(pendingClassification);
      setPendingClassification(null);
      return;
    }

    setSavingClassification(true);
    try {
      // Resolve current auth user for changed_by audit field
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id ?? null;

      // ── STEP 1: Upsert history row ─────────────────────────────────────
      // Schema note: production uses new_classification + effective_from_fy
      // (both NOT NULL), plus legacy previous_classification / responsible_person
      // columns alongside the newer old_classification / responsible_person_id.
      // We populate both pairs for compatibility.
      //
      // Behaviour note: if a history row already exists for this (client,
      // effective_from_fy), we UPDATE it in place instead of failing.  This
      // makes the flow idempotent — essential for correcting a mis-picked
      // classification from onboarding without manually clearing stale rows.
      const historyPayload = {
        new_classification: pendingClassification,
        previous_classification: savedClassification || null,
        old_classification: savedClassification || null,
        responsible_person_id: pendingResponsiblePersonId || null,
        changed_by: currentUserId,
        changed_at: new Date().toISOString(),
        notes: changeNotes.trim() || null,
      };

      const { data: existingHist, error: existingHistErr } = await (supabase as any)
        .from("client_classification_history")
        .select("id")
        .eq("client_id", clientId)
        .eq("effective_from_fy", effectiveFromFY)
        .limit(1);
      if (existingHistErr) throw existingHistErr;

      if (existingHist && existingHist.length > 0) {
        const { error: updErr } = await (supabase as any)
          .from("client_classification_history")
          .update(historyPayload)
          .eq("id", existingHist[0].id);
        if (updErr) throw updErr;
      } else {
        const { error: historyError } = await (supabase as any)
          .from("client_classification_history")
          .insert({
            client_id: clientId,
            effective_from_fy: effectiveFromFY,
            ...historyPayload,
          });
        if (historyError) throw historyError;
      }

      // ── STEP 2: Sync client_fy_classifications for effective FY + all
      //           later FYs that already have a row.
      //
      // The new classification takes effect "FROM this FY onward", so every
      // existing per-FY snapshot at or after effective_from_fy must reflect
      // the new value.  Without this, an onboarding row created for the
      // current FY (e.g. 2026-27 = "Audit") would linger even after the user
      // corrects the classification from FY 2025-26, and the Edit form /
      // Audit pipeline would still treat them as Audit.
      const currentFYForSync = getCurrentFY();

      // firm_id is required by the RLS INSERT policy:
      //   WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id())
      // Without it the new row has firm_id = NULL which never satisfies the
      // policy for a regular (non-superadmin) user → "new row violates RLS".
      const userFirmId = user?.firm_id ?? null;

      // 2a) Upsert the effective_from_fy row itself
      const { error: fyError } = await (supabase as any)
        .from("client_fy_classifications")
        .upsert({
          client_id: clientId,
          financial_year: effectiveFromFY,
          classification: pendingClassification,
          responsible_person_id: pendingResponsiblePersonId || null,
          firm_id: userFirmId,
        }, { onConflict: "client_id,financial_year" });
      if (fyError) throw fyError;

      // 2b) Also upsert the current FY row if it's >= effective_from_fy
      //     (covers the common case of correcting an onboarding mis-pick
      //     where only the creation-FY row exists).
      if (fyCompare(effectiveFromFY, currentFYForSync) < 0) {
        const { error: currFyError } = await (supabase as any)
          .from("client_fy_classifications")
          .upsert({
            client_id: clientId,
            financial_year: currentFYForSync,
            classification: pendingClassification,
            responsible_person_id: pendingResponsiblePersonId || null,
            firm_id: userFirmId,
          }, { onConflict: "client_id,financial_year" });
        if (currFyError) throw currFyError;
      }

      // 2c) Overwrite any OTHER later-FY rows (beyond current FY) that
      //     already exist — so pre-set future-FY snapshots don't linger
      //     with the old classification.
      const { data: laterRows } = await (supabase as any)
        .from("client_fy_classifications")
        .select("id, financial_year")
        .eq("client_id", clientId);
      if (Array.isArray(laterRows) && laterRows.length > 0) {
        const idsToUpdate = (laterRows as any[])
          .filter(r => fyCompare(r.financial_year, effectiveFromFY) > 0)
          .map(r => r.id);
        if (idsToUpdate.length > 0) {
          const { error: bulkErr } = await (supabase as any)
            .from("client_fy_classifications")
            .update({
              classification: pendingClassification,
              responsible_person_id: pendingResponsiblePersonId || null,
              firm_id: userFirmId,
            })
            .in("id", idsToUpdate);
          if (bulkErr) throw bulkErr;
        }
      }

      // ── STEP 3: Flip clients.classification when the change is active ──
      const currentFY = getCurrentFY();
      if (fyCompare(effectiveFromFY, currentFY) <= 0) {
        const clientUpdate: Record<string, any> = { classification: pendingClassification };
        // Also sync responsible_person_id on clients row when the user picked one
        if (pendingResponsiblePersonId) {
          clientUpdate.responsible_person_id = pendingResponsiblePersonId;
        }
        const { error: clientErr } = await (supabase as any)
          .from("clients")
          .update(clientUpdate)
          .eq("id", clientId);
        if (clientErr) throw clientErr;
      }

      // ── STEP 4: Sync local wizard state, notify, refetch ───────────────
      stashClassificationLocally(pendingClassification);
      toast({
        title: "Classification updated",
        description: `Changed to ${pendingClassification} from FY ${effectiveFromFY}.`,
      });
      onClassificationSaved?.(pendingClassification, effectiveFromFY);
      setPendingClassification(null);
    } catch (err: any) {
      toast({
        title: "Failed to save classification change",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setSavingClassification(false);
    }
  };

  /* Load users for responsible person — needed for the inline field AND for
   * the classification-change modal's Responsible Person select. */
  useEffect(() => {
    const load = async () => {
      let query = supabase.from("users").select("id, name").neq("role", "client").eq("is_active", true).order("name");
      if (user?.firm_id) query = query.eq("firm_id", user.firm_id);
      const { data: usrs } = await query;
      if (usrs) setUsers(usrs);
    };
    load();
  }, [user?.firm_id]);

  /* Derived state for work group sub-option */
  const isItrWithAccounts = data.work_group_type === "itr_with_accounts_inside" || data.work_group_type === "itr_with_accounts_outside";
  const topLevelWorkGroup = data.work_group_type === "only_itr" ? "only_itr" : isItrWithAccounts ? "itr_with_accounts" : "";

  const handleTopLevelWorkGroup = (val: string) => {
    if (val === "only_itr") set("work_group_type", "only_itr");
    else if (val === "itr_with_accounts") set("work_group_type", "itr_with_accounts_inside"); // default sub
    else set("work_group_type", "");
  };

  const needsCIN = entityType === "Private Ltd" || entityType === "Public Ltd";
  const isCorporate = entityType === "Private Ltd" || entityType === "Public Ltd";

  const directors: Array<{ name: string; din: string }> = Array.isArray(data.directors) && data.directors.length > 0
    ? data.directors
    : [{ name: "", din: "" }];

  const updateDirectors = (next: Array<{ name: string; din: string }>) =>
    onChange({ ...data, directors: next });
  const addDirector = () => updateDirectors([...directors, { name: "", din: "" }]);
  const removeDirector = (idx: number) => updateDirectors(directors.filter((_, i) => i !== idx));
  const updateDirector = (idx: number, field: "name" | "din", val: string) =>
    updateDirectors(directors.map((d, i) => i === idx ? { ...d, [field]: val } : d));

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
            {/* Edit mode: allow backdating the effective FY without changing classification value */}
            {clientId && savedClassification && data.classification === savedClassification && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                onClick={() => {
                  setEffectiveFromFY("");
                  setPendingResponsiblePersonId(data.responsible_person_id || "");
                  setChangeNotes("");
                  setPendingClassification(data.classification);
                }}
              >
                <CalendarClock className="h-3 w-3" />
                Change applicable from FY
              </button>
            )}
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

        {/* Contact Person */}
        <div className="space-y-1.5">
          <Label>Contact Person</Label>
          <Input
            value={data.contact_person}
            onChange={(e) => set("contact_person", e.target.value)}
            placeholder="e.g. Ramesh Kumar (MD)"
          />
          <p className="text-xs text-muted-foreground">Name of the authorised signatory or primary contact</p>
        </div>

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

      {/* ── SECTION D: Director Details (corporate only) ── */}
      {isCorporate && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Director Details</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Auto-filled in financial statement signature blocks</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addDirector} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Add Director
            </Button>
          </div>
          <div className="space-y-2">
            {directors.map((dir, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <Input
                  placeholder="Director Full Name"
                  value={dir.name}
                  onChange={e => updateDirector(idx, "name", e.target.value)}
                  className="h-8 text-sm"
                />
                <Input
                  placeholder="DIN (e.g. 02695237)"
                  value={dir.din}
                  onChange={e => updateDirector(idx, "din", e.target.value)}
                  className="h-8 text-sm font-mono"
                />
                {directors.length > 1 && (
                  <Button
                    type="button" variant="ghost" size="sm"
                    onClick={() => removeDirector(idx)}
                    className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Classification Change Confirmation Modal ──────────────────────
       *  Captures: new classification (already selected), effective-from FY
       *  (mandatory), responsible person (optional), notes (optional).
       *  Metadata is stashed on data.pending_classification_change so the
       *  wizard can persist it to client_classification_history on save. */}
      <Dialog
        open={!!pendingClassification}
        onOpenChange={(open) => { if (!open) setPendingClassification(null); }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {pendingClassification === savedClassification
                ? "Update Classification Effective FY"
                : "Change Client Classification"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Confirm the classification change and pick the effective financial year.
            </DialogDescription>
          </DialogHeader>

          {/* Change summary */}
          {pendingClassification !== savedClassification ? (
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <p className="text-sm font-medium">You are changing:</p>
              <div className="flex items-center gap-3 mt-1 text-sm">
                <span className="font-bold text-blue-700">{savedClassification}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-bold text-orange-600">{pendingClassification}</span>
              </div>
            </div>
          ) : (
            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <p className="text-sm font-medium">
                Classification: <span className="font-bold text-blue-700">{pendingClassification}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Select the FY from which this classification should apply. All FY records from that year onward will be updated.
              </p>
            </div>
          )}

          {/* Effective From FY — mandatory */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">
              Effective From Financial Year <span className="text-destructive">*</span>
            </Label>
            <Select value={effectiveFromFY} onValueChange={setEffectiveFromFY}>
              <SelectTrigger className={!effectiveFromFY ? "border-red-400" : ""}>
                <SelectValue placeholder="Select effective FY" />
              </SelectTrigger>
              <SelectContent>
                {CHANGE_EFFECTIVE_FY_OPTIONS.map((fy) => (
                  <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Old classification applies to FYs BEFORE this year. New classification applies FROM this FY onward.
            </p>
          </div>

          {/* Responsible Person — optional */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Responsible Person</Label>
            <Select
              value={pendingResponsiblePersonId}
              onValueChange={setPendingResponsiblePersonId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select responsible person" />
              </SelectTrigger>
              <SelectContent>
                {users.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes — optional */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Notes (optional)</Label>
            <Textarea
              placeholder="Reason for classification change..."
              value={changeNotes}
              onChange={(e) => setChangeNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Impact preview */}
          {effectiveFromFY && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm space-y-0.5">
              <p className="font-semibold mb-1">Impact Summary:</p>
              {pendingClassification !== savedClassification && (
                <p>
                  • FYs up to <strong>{getPreviousFY(effectiveFromFY)}</strong>:{" "}
                  <strong>{savedClassification}</strong>
                </p>
              )}
              <p>
                • From FY <strong>{effectiveFromFY}</strong> onward:{" "}
                <strong>{pendingClassification}</strong>
              </p>
              <p className="text-muted-foreground mt-1">
                Change recorded in classification history.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setPendingClassification(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={!effectiveFromFY || savingClassification}
              onClick={handleConfirmClassificationChange}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {savingClassification ? "Saving…" : "Confirm Change"}
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
