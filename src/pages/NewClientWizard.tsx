import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import confetti from "canvas-confetti";
import { StepBasicInfo, type BasicInfoData } from "@/components/client-wizard/StepBasicInfo";
import { StepFinancialProfile, type FinancialProfileData } from "@/components/client-wizard/StepFinancialProfile";
import { StepComplianceFlags, type ComplianceFlagsData } from "@/components/client-wizard/StepComplianceFlags";
import { StepBankingLoans, type BankingLoansData, emptyBankingLoans } from "@/components/client-wizard/StepBankingLoans";
import { StepAuditQuestions, type AuditQuestionsData, emptyAuditQuestions } from "@/components/client-wizard/StepAuditQuestions";
import { StepImportData, type ImportDataResult } from "@/components/client-wizard/StepImportData";
import { StepDone } from "@/components/client-wizard/StepDone";

const ALL_STEPS = [
  { id: "basic", label: "Basic Info", auditOnly: false },
  { id: "financial", label: "Financial Profile", auditOnly: true },
  { id: "compliance", label: "Compliance Flags", auditOnly: true },
  { id: "banking", label: "Banking & Loans", auditOnly: true },
  { id: "audit_q", label: "Audit Questions", auditOnly: true },
  { id: "import", label: "Import Data", auditOnly: true },
  { id: "done", label: "Done", auditOnly: false },
];

const defaultBasicInfo: BasicInfoData = {
  name: "",
  pan: "",
  entity_type: "",
  date_of_incorporation: undefined,
  registered_state: "",
  business_nature: "",
  gstins: [""],
  cin: "",
  selectedGroupIds: [],
  email: "",
  mobile: "",
  address: "",
  client_classification: [],
};

const defaultFinancialProfile: FinancialProfileData = {
  accounting_software: "",
  accounting_method: "mercantile",
  turnover_range: "",
  financial_standards: "indian_gaap",
  has_subsidiaries: false,
};

const defaultComplianceFlags: ComplianceFlagsData = {
  gst_registered: false,
  tds_deductor: false,
  fixed_assets: false,
  govt_grants: false,
  multiple_banks: false,
  caro_applicable: false,
  transfer_pricing: false,
  mat_applicable: false,
  special_deductions: false,
  msme_suppliers: false,
};

const asRecord = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asArray = <T,>(value: unknown, fallback: T[]): T[] => {
  if (!Array.isArray(value)) return fallback;
  return value as T[];
};

const NewClientWizard = () => {
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const { user } = useAuth();

  const isEditMode = Boolean(clientId);

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingClient, setLoadingClient] = useState(isEditMode);
  const [clientMissing, setClientMissing] = useState(false);

  const [basicInfo, setBasicInfo] = useState<BasicInfoData>(defaultBasicInfo);
  const [financialProfile, setFinancialProfile] = useState<FinancialProfileData>(defaultFinancialProfile);
  const [complianceFlags, setComplianceFlags] = useState<ComplianceFlagsData>(defaultComplianceFlags);
  const [bankingLoans, setBankingLoans] = useState<BankingLoansData>(emptyBankingLoans);
  const [auditQuestions, setAuditQuestions] = useState<AuditQuestionsData>(emptyAuditQuestions);
  const [importData, setImportData] = useState<ImportDataResult | null>(null);

  const [basicErrors, setBasicErrors] = useState<Record<string, string>>({});

  // Compute visible steps based on classification
  const isAuditClient = (basicInfo.client_classification || []).includes("audit");
  const visibleSteps = useMemo(() => {
    if (isAuditClient) return ALL_STEPS;
    return ALL_STEPS.filter((s) => !s.auditOnly);
  }, [isAuditClient]);

  const STEPS = visibleSteps.map((s) => s.label);
  const currentStepDef = visibleSteps[step];

  useEffect(() => {
    if (!isEditMode || !clientId) {
      setLoadingClient(false);
      return;
    }

    let mounted = true;

    const loadClient = async () => {
      setLoadingClient(true);
      setClientMissing(false);

      const [clientRes, profileRes] = await Promise.all([
        supabase
          .from("clients")
          .select("id, name, pan, entity_type, cin, gstin, compliance_flags, email, mobile, address, client_classification")
          .eq("id", clientId)
          .maybeSingle(),
        supabase
          .from("client_profiles")
          .select("id, client_id, banking_data, loan_data, audit_questions")
          .eq("client_id", clientId)
          .order("id", { ascending: false })
          .limit(1),
      ]);

      if (!mounted) return;

      if (clientRes.error) {
        toast({ title: "Failed to load client", description: clientRes.error.message, variant: "destructive" });
        setLoadingClient(false);
        return;
      }

      if (!clientRes.data) {
        setClientMissing(true);
        setLoadingClient(false);
        return;
      }

      const client = clientRes.data as any;
      const profile = (profileRes.data?.[0] as any) ?? null;

      const compliance = asRecord(client.compliance_flags);
      const financial = asRecord(compliance.financial_profile);
      const basicExtra = asRecord(compliance.basic_info_extra);
      const bankingData = asRecord(profile?.banking_data);
      const loanData = asRecord(profile?.loan_data);
      const auditData = asRecord(profile?.audit_questions);

      setBasicInfo({
        name: client.name || "",
        pan: client.pan || "",
        entity_type: client.entity_type || "",
        cin: client.cin || "",
        gstins: Array.isArray(client.gstin) && client.gstin.length > 0 ? client.gstin : [""],
        date_of_incorporation: basicExtra.date_of_incorporation ? new Date(basicExtra.date_of_incorporation) : undefined,
        registered_state: basicExtra.registered_state || "",
        business_nature: basicExtra.business_nature || "",
        email: client.email || "",
        mobile: client.mobile || "",
        address: client.address || "",
        client_classification: Array.isArray(client.client_classification) ? client.client_classification : [],
      });

      setFinancialProfile({
        accounting_software: financial.accounting_software || "",
        accounting_method: financial.accounting_method || "mercantile",
        turnover_range: financial.turnover_range || "",
        financial_standards: financial.financial_standards || "indian_gaap",
        has_subsidiaries: Boolean(financial.has_subsidiaries),
      });

      setComplianceFlags({
        gst_registered: Boolean(compliance.gst_registered),
        tds_deductor: Boolean(compliance.tds_deductor),
        fixed_assets: Boolean(compliance.fixed_assets),
        govt_grants: Boolean(compliance.govt_grants),
        multiple_banks: Boolean(compliance.multiple_banks),
        caro_applicable: Boolean(compliance.caro_applicable),
        transfer_pricing: Boolean(compliance.transfer_pricing),
        mat_applicable: Boolean(compliance.mat_applicable),
        special_deductions: Boolean(compliance.special_deductions),
        msme_suppliers: Boolean(compliance.msme_suppliers),
      });

      const securedLoans = asArray(bankingData.secured_loans, asArray(loanData.secured_loans, []));
      const unsecuredLoans = asArray(bankingData.unsecured_loans, asArray(loanData.unsecured_loans, []));

      setBankingLoans({
        bank_accounts: asArray(bankingData.bank_accounts, []).length > 0
          ? asArray(bankingData.bank_accounts, [])
          : [{ bank_name: "", branch: "", account_number: "", account_type: "" }],
        secured_loans: securedLoans,
        unsecured_loans: unsecuredLoans,
        loans_to_related_parties: Boolean(bankingData.loans_to_related_parties),
        related_party_loans: asArray(bankingData.related_party_loans, []),
      });

      setAuditQuestions({ ...emptyAuditQuestions, ...auditData });
      setImportData(null);
      setLoadingClient(false);
    };

    loadClient();

    return () => {
      mounted = false;
    };
  }, [clientId, isEditMode, toast]);

  const validateBasicInfo = async (): Promise<boolean> => {
    const errors: Record<string, string> = {};
    if (!basicInfo.name.trim()) errors.name = "Legal name is required";
    if (basicInfo.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(basicInfo.pan)) {
      errors.pan = "Invalid PAN format. Example: ABCDE1234F";
    }
    if (basicInfo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(basicInfo.email)) {
      errors.email = "Invalid email format";
    }
    if (basicInfo.mobile && basicInfo.mobile.length > 0 && basicInfo.mobile.length < 10) {
      errors.mobile = "Mobile number must be 10 digits";
    }
    // Check duplicate PAN
    if (basicInfo.pan && !errors.pan) {
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("pan", basicInfo.pan)
        .limit(1);
      if (existing && existing.length > 0 && (!isEditMode || existing[0].id !== clientId)) {
        errors.pan = "Client with this PAN already exists.";
      }
    }
    basicInfo.gstins.forEach((g, i) => {
      if (g && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g)) {
        errors[`gstin_${i}`] = "Invalid GSTIN format (15 chars)";
      }
    });
    if (
      (basicInfo.entity_type === "Private Ltd" || basicInfo.entity_type === "Public Ltd") &&
      basicInfo.cin &&
      basicInfo.cin.length !== 21
    ) {
      errors.cin = "CIN must be exactly 21 characters";
    }
    setBasicErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const buildClientPayload = () => {
    const gstins = basicInfo.gstins.filter((g) => g.trim());

    return {
      name: basicInfo.name.trim(),
      pan: basicInfo.pan || null,
      entity_type: basicInfo.entity_type || null,
      cin: basicInfo.cin || null,
      gstin: gstins.length > 0 ? gstins : null,
      email: basicInfo.email || null,
      mobile: basicInfo.mobile || null,
      address: basicInfo.address || null,
      client_classification: basicInfo.client_classification || [],
      compliance_flags: {
        ...complianceFlags,
        financial_profile: financialProfile,
        basic_info_extra: {
          date_of_incorporation: basicInfo.date_of_incorporation?.toISOString() || null,
          registered_state: basicInfo.registered_state,
          business_nature: basicInfo.business_nature,
        },
      } as any,
    };
  };

  const buildProfilePayload = (targetClientId: string) => ({
    client_id: targetClientId,
    banking_data: {
      bank_accounts: bankingLoans.bank_accounts.filter((b) => b.bank_name),
      secured_loans: bankingLoans.secured_loans,
      unsecured_loans: bankingLoans.unsecured_loans,
      loans_to_related_parties: bankingLoans.loans_to_related_parties,
      related_party_loans: bankingLoans.related_party_loans,
    } as any,
    loan_data: {
      secured_loans: bankingLoans.secured_loans,
      unsecured_loans: bankingLoans.unsecured_loans,
    } as any,
    audit_questions: auditQuestions as any,
  });

  const saveTrialBalance = async (targetClientId: string) => {
    if (!importData || importData.rows.length === 0) return;
    const { error } = await supabase.from("trial_balance_snapshots").upsert({
      client_id: targetClientId,
      financial_year: new Date().getFullYear().toString(),
      source_format: importData.filename.endsWith(".csv") ? "csv" : "excel",
      raw_data: importData.rows as any,
      normalised_data: importData.rows.map((row: any) => ({
        account_name: row.account_name || "",
        debit: typeof row.debit === "number" ? row.debit : 0,
        credit: typeof row.credit === "number" ? row.credit : 0,
        balance: typeof row.balance === "number" ? row.balance : 0,
      })) as any,
    }, { onConflict: "client_id,financial_year" });
    if (error) {
      console.error("Failed to save trial balance:", error);
      toast({ title: "Warning", description: "Client saved but trial balance import failed: " + error.message, variant: "destructive" });
    }
  };

  const handleFinalSubmit = async () => {
    setSaving(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;

      const authUserId = authData.user?.id;
      if (!authUserId) throw new Error("You must be logged in to save this client.");

      if (isEditMode && clientId) {
        const { data: updatedClient, error: clientError } = await supabase
          .from("clients")
          .update(buildClientPayload() as any)
          .eq("id", clientId)
          .select("id")
          .maybeSingle();

        if (clientError) throw clientError;
        if (!updatedClient) {
          throw new Error("Client update was not saved. Please verify you have access to edit this client and try again.");
        }

        const { data: existingProfiles, error: profileFetchError } = await supabase
          .from("client_profiles")
          .select("id")
          .eq("client_id", clientId)
          .order("id", { ascending: false })
          .limit(1);

        if (profileFetchError) throw profileFetchError;

        const profilePayload = buildProfilePayload(clientId);
        if ((existingProfiles || []).length > 0) {
          const { data: updatedProfile, error: profileUpdateError } = await supabase
            .from("client_profiles")
            .update(profilePayload)
            .eq("id", existingProfiles![0].id)
            .select("id")
            .maybeSingle();
          if (profileUpdateError) throw profileUpdateError;
          if (!updatedProfile) {
            throw new Error("Client profile update was not saved. Please verify permissions and try again.");
          }
        } else {
          const { error: profileInsertError } = await supabase
            .from("client_profiles")
            .insert(profilePayload);
          if (profileInsertError) throw profileInsertError;
        }

        toast({ title: "Client updated", description: "Full client profile saved successfully." });

        if (importData && importData.rows.length > 0) {
          await saveTrialBalance(clientId);
        }

        navigate(`/clients/${clientId}`);
      } else {
        const insertPayload = {
          ...buildClientPayload(),
          firm_id: basicInfo.firm_id || user?.firm_id || null,
          user_id: authUserId,
        };

        const { data: clientData, error: clientError } = await supabase
          .from("clients")
          .insert(insertPayload as any)
          .select("id")
          .single();

        if (clientError) throw clientError;

        const { error: profileError } = await supabase
          .from("client_profiles")
          .insert(buildProfilePayload(clientData.id));

        if (profileError) throw profileError;

        if (importData && importData.rows.length > 0) {
          await saveTrialBalance(clientData.id);
        }

        // Save group memberships
        const groupIds = basicInfo.selectedGroupIds || [];
        if (groupIds.length > 0) {
          await supabase.from("client_group_memberships").insert(
            groupIds.map((gid) => ({
              group_id: gid,
              client_id: clientData.id,
              added_by: authUserId,
            }))
          );
        }

        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        toast({ title: "Client created!", description: "All wizard data saved successfully." });
        setTimeout(() => navigate(`/clients/${clientData.id}`), 700);
      }
    } catch (err: any) {
      toast({ title: isEditMode ? "Error updating client" : "Error saving client", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (currentStepDef?.id === "basic" && !(await validateBasicInfo())) return;
    if (step === visibleSteps.length - 1) {
      await handleFinalSubmit();
      return;
    }
    setStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  };

  const progress = ((step + 1) / visibleSteps.length) * 100;
  const isDoneStep = currentStepDef?.id === "done";
  const isImportStep = currentStepDef?.id === "import";

  if (loadingClient) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (clientMissing) {
    return <div className="text-center py-16 text-muted-foreground">Client not found.</div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-xs gap-1" onClick={() => navigate("/clients")}> 
          <ArrowLeft className="h-3 w-3" /> Back to Clients
        </Button>
        <h1 className="text-2xl font-display font-bold text-foreground">{isEditMode ? "Edit Client" : "New Client"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isEditMode
            ? "Update all onboarding sections for this client."
            : "Onboarding wizard — complete all steps to set up the client."}
        </p>
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= step ? "text-primary font-medium" : ""}>
              {s}
            </span>
          ))}
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="p-6">
          {currentStepDef?.id === "basic" && <StepBasicInfo data={basicInfo} onChange={setBasicInfo} errors={basicErrors} />}
          {currentStepDef?.id === "financial" && <StepFinancialProfile data={financialProfile} onChange={setFinancialProfile} />}
          {currentStepDef?.id === "compliance" && <StepComplianceFlags data={complianceFlags} onChange={setComplianceFlags} />}
          {currentStepDef?.id === "banking" && <StepBankingLoans data={bankingLoans} onChange={setBankingLoans} />}
          {currentStepDef?.id === "audit_q" && <StepAuditQuestions data={auditQuestions} onChange={setAuditQuestions} />}
          {currentStepDef?.id === "import" && <StepImportData data={importData} onChange={setImportData} onSkip={() => setStep(s => s + 1)} clientId={isEditMode ? clientId : undefined} firmId={user?.firm_id} />}
          {currentStepDef?.id === "done" && (
            <StepDone
              mode={isEditMode ? "edit" : "create"}
              basicInfo={basicInfo}
              complianceFlags={complianceFlags}
              partnerName={user?.name || null}
              saving={saving}
              onSubmit={handleFinalSubmit}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      {!isDoneStep && (
        <div className="flex justify-between">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Previous
          </Button>
          <Button onClick={handleNext} disabled={saving}>
            {isImportStep ? "Review Summary" : "Next"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default NewClientWizard;
