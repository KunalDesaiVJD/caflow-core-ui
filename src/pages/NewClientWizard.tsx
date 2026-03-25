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
import { StepAdvancedInfo, type AdvancedInfoData, defaultAdvancedInfo } from "@/components/client-wizard/StepAdvancedInfo";
import {
  StepServiceBilling,
  type ServiceBillingData,
  type CrossStepWarning,
  defaultServiceBilling,
} from "@/components/client-wizard/StepServiceBilling";
import { StepFinancialProfile, type FinancialProfileData } from "@/components/client-wizard/StepFinancialProfile";
import { StepComplianceFlags, type ComplianceFlagsData } from "@/components/client-wizard/StepComplianceFlags";
import { StepBankingLoans, type BankingLoansData, emptyBankingLoans } from "@/components/client-wizard/StepBankingLoans";
import { StepAuditQuestions, type AuditQuestionsData, emptyAuditQuestions } from "@/components/client-wizard/StepAuditQuestions";
import { StepImportData, type ImportDataResult } from "@/components/client-wizard/StepImportData";
import { StepDone } from "@/components/client-wizard/StepDone";

const ALL_STEPS = [
  { id: "basic", label: "Basic Info", auditOnly: false },
  { id: "advanced", label: "Advanced Info", auditOnly: false },
  { id: "service_billing", label: "Services & Billing", auditOnly: false },
  { id: "financial", label: "Financial Profile", auditOnly: true },
  { id: "compliance", label: "Compliance Flags", auditOnly: true },
  { id: "banking", label: "Banking & Loans", auditOnly: true },
  { id: "audit_q", label: "Audit Questions", auditOnly: true },
  { id: "import", label: "Import Data", auditOnly: true },
  { id: "done", label: "Done", auditOnly: false },
];

const defaultBasicInfo: BasicInfoData = {
  name: "",
  selectedGroupIds: [],
  pan: "",
  entity_type: "",
  email: "",
  mobile: "",
  address: "",
  gstins: [""],
  tan_number: "",
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
  const [advancedInfo, setAdvancedInfo] = useState<AdvancedInfoData>(defaultAdvancedInfo);
  const [serviceBilling, setServiceBilling] = useState<ServiceBillingData>(defaultServiceBilling);
  const [financialProfile, setFinancialProfile] = useState<FinancialProfileData>(defaultFinancialProfile);
  const [complianceFlags, setComplianceFlags] = useState<ComplianceFlagsData>(defaultComplianceFlags);
  const [bankingLoans, setBankingLoans] = useState<BankingLoansData>(emptyBankingLoans);
  const [auditQuestions, setAuditQuestions] = useState<AuditQuestionsData>(emptyAuditQuestions);
  const [importData, setImportData] = useState<ImportDataResult | null>(null);

  const [basicErrors, setBasicErrors] = useState<Record<string, string>>({});
  const [advancedErrors, setAdvancedErrors] = useState<Record<string, string>>({});
  const [serviceErrors, setServiceErrors] = useState<Record<string, string>>({});

  // Track linked modules of active services for cross-step logic
  const [activeLinkedModules, setActiveLinkedModules] = useState<string[]>([]);

  // Derive itrServiceActive from service billing state
  const itrServiceActive = activeLinkedModules.includes("itr");

  // For now, show all steps
  const visibleSteps = useMemo(() => ALL_STEPS, []);

  const STEPS = visibleSteps.map((s) => s.label);
  const currentStepDef = visibleSteps[step];

  // Load linked modules whenever serviceBilling changes
  useEffect(() => {
    const loadModules = async () => {
      const activeIds = Object.keys(serviceBilling.activeServices);
      const packageIds = serviceBilling.packageConfig.service_ids;
      const allIds = [...new Set([...activeIds, ...packageIds])];
      if (allIds.length === 0) {
        setActiveLinkedModules([]);
        return;
      }
      const { data: cats } = await supabase
        .from("service_categories")
        .select("linked_module")
        .in("id", allIds);
      if (cats) {
        setActiveLinkedModules(
          cats.map((c) => c.linked_module).filter(Boolean) as string[]
        );
      }
    };
    loadModules();
  }, [serviceBilling.activeServices, serviceBilling.packageConfig.service_ids]);

  // Cross-step warnings for Step 3
  const crossStepWarnings = useMemo<CrossStepWarning[]>(() => {
    const warnings: CrossStepWarning[] = [];
    const hasGstin = basicInfo.gstins.some((g) => g.trim());
    if (activeLinkedModules.includes("gst") && !hasGstin) {
      warnings.push({
        type: "gst",
        message: "GSTIN is required for GST service. Please go back to Step 1 and add GSTIN.",
      });
    }
    if (activeLinkedModules.includes("tds") && !basicInfo.tan_number?.trim()) {
      warnings.push({
        type: "tds",
        message: "TAN Number is required for TDS service. Please go back to Step 1 and add TAN Number.",
      });
    }
    if (activeLinkedModules.includes("itr") && !advancedInfo.work_group_type) {
      warnings.push({
        type: "itr",
        message: "Work Group is required for ITR service. Please complete Work Group in Step 2 before proceeding.",
      });
    }
    return warnings;
  }, [activeLinkedModules, basicInfo.gstins, basicInfo.tan_number, advancedInfo.work_group_type]);

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
          .select("id, client_id, audit_questions")
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
      const auditData = asRecord(profile?.audit_questions);

      setBasicInfo({
        name: client.name || "",
        selectedGroupIds: [],
        pan: client.pan || "",
        entity_type: client.entity_type || "",
        gstins: Array.isArray(client.gstin) && client.gstin.length > 0 ? client.gstin : [""],
        email: client.email || "",
        mobile: client.mobile || "",
        address: client.address || "",
        tan_number: (client as any).tan_number || "",
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

      setBankingLoans(emptyBankingLoans);
      setAuditQuestions({ ...emptyAuditQuestions, ...auditData });
      setImportData(null);
      setLoadingClient(false);
    };

    loadClient();

    return () => { mounted = false; };
  }, [clientId, isEditMode, toast]);

  const validateBasicInfo = async (): Promise<boolean> => {
    const errors: Record<string, string> = {};
    if (!basicInfo.name.trim()) errors.name = "Legal name is required";
    if (!basicInfo.selectedGroupIds || basicInfo.selectedGroupIds.length === 0) {
      errors.selectedGroupIds = "At least one client group is required";
    }
    if (!basicInfo.pan) {
      errors.pan = "PAN is required";
    } else if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(basicInfo.pan)) {
      errors.pan = "Invalid PAN format. Example: ABCDE1234F";
    }
    if (!basicInfo.entity_type) errors.entity_type = "Entity type is required";
    if (basicInfo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(basicInfo.email)) {
      errors.email = "Invalid email format";
    }
    if (basicInfo.mobile && basicInfo.mobile.length > 0 && basicInfo.mobile.length < 10) {
      errors.mobile = "Mobile number must be 10 digits";
    }
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
    setBasicErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateAdvancedInfo = (): boolean => {
    const errors: Record<string, string> = {};
    if (!advancedInfo.financial_year) errors.financial_year = "Financial year is required";
    if (!advancedInfo.classification) errors.classification = "Classification is required";
    if (advancedInfo.classification === "Audit" && !advancedInfo.audit_firm_id) {
      errors.audit_firm_id = "Audit firm is required when classification is Audit";
    }
    const needsCIN = basicInfo.entity_type === "Private Ltd" || basicInfo.entity_type === "Public Ltd";
    if (needsCIN && advancedInfo.cin && advancedInfo.cin.length !== 21) {
      errors.cin = "CIN must be exactly 21 characters for companies";
    }
    if (advancedInfo.dsc_number && !advancedInfo.dsc_expiry_date) {
      errors.dsc_expiry_date = "DSC Expiry Date is required when DSC Number is provided";
    }
    setAdvancedErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateServiceBilling = (): boolean => {
    const errors: Record<string, string> = {};
    const hasActiveService = Object.keys(serviceBilling.activeServices).length > 0;
    const hasPackageService = serviceBilling.packageConfig.service_ids.length > 0;

    if (serviceBilling.billingMode === "service_specific" && !hasActiveService) {
      errors.services = "Please activate at least one service before proceeding.";
    }
    if (serviceBilling.billingMode === "package_wise" && !hasPackageService && !hasActiveService) {
      errors.services = "Please activate at least one service before proceeding.";
    }
    if (serviceBilling.billingMode === "package_wise" && hasPackageService && !serviceBilling.packageConfig.package_name.trim()) {
      errors.package_name = "Package name is required when using package mode.";
    }
    setServiceErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const buildClientPayload = () => {
    const gstins = basicInfo.gstins.filter((g) => g.trim());
    return {
      name: basicInfo.name.trim(),
      pan: basicInfo.pan || null,
      entity_type: basicInfo.entity_type || null,
      gstin: gstins.length > 0 ? gstins : null,
      email: basicInfo.email || null,
      mobile: basicInfo.mobile || null,
      address: basicInfo.address || null,
      tan_number: basicInfo.tan_number || null,
      compliance_flags: {
        ...complianceFlags,
        financial_profile: financialProfile,
      } as any,
    };
  };

  const buildProfilePayload = (targetClientId: string) => ({
    client_id: targetClientId,
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

  const saveServiceBillingData = async (targetClientId: string) => {
    const firmId = user?.firm_id;
    if (!firmId) return;

    // Save active individual services
    const serviceEntries = Object.entries(serviceBilling.activeServices);
    if (serviceEntries.length > 0) {
      const rows = serviceEntries.map(([serviceId, cfg]) => ({
        client_id: targetClientId,
        service_category_id: serviceId,
        is_active: true,
        frequency_override: cfg.frequency,
        billing_amount: cfg.billing_amount,
        reminder_date: cfg.reminder_date,
        invoice_gen_type: cfg.invoice_gen_type,
        billing_mode: serviceBilling.billingMode,
      }));
      await supabase.from("client_services").upsert(rows as any, {
        onConflict: "client_id,service_category_id",
      });
    }

    // Save package if package mode
    if (serviceBilling.billingMode === "package_wise" && serviceBilling.packageConfig.service_ids.length > 0) {
      const pkg = serviceBilling.packageConfig;
      await supabase.from("client_service_packages").insert({
        client_id: targetClientId,
        package_name: pkg.package_name,
        service_category_ids: pkg.service_ids as any,
        frequency: pkg.frequency,
        reminder_date: pkg.reminder_date,
        billing_amount: pkg.billing_amount,
        invoice_gen_type: pkg.invoice_gen_type,
      } as any);
    }

    // Create billing reminders
    const allActiveServiceIds = Object.keys(serviceBilling.activeServices);
    for (const serviceId of allActiveServiceIds) {
      const cfg = serviceBilling.activeServices[serviceId];
      const nextDue = new Date();
      nextDue.setDate(cfg.reminder_date);
      if (nextDue <= new Date()) nextDue.setMonth(nextDue.getMonth() + 1);

      await supabase.from("billing_reminders").insert({
        client_id: targetClientId,
        firm_id: firmId,
        service_category_id: serviceId,
        billing_amount: cfg.billing_amount,
        frequency: cfg.frequency,
        reminder_date: cfg.reminder_date,
        next_due_date: nextDue.toISOString().split("T")[0],
        invoice_gen_type: cfg.invoice_gen_type,
      } as any);
    }
  };

  const saveFYClassification = async (targetClientId: string) => {
    if (!advancedInfo.classification || !advancedInfo.financial_year) return;
    await supabase.from("client_fy_classifications").upsert({
      client_id: targetClientId,
      financial_year: advancedInfo.financial_year,
      classification: advancedInfo.classification,
      audit_firm_id: advancedInfo.audit_firm_id || null,
    } as any, { onConflict: "client_id,financial_year" });
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

        await saveFYClassification(clientId);
        await saveServiceBillingData(clientId);

        toast({ title: "Client updated", description: "Full client profile saved successfully." });

        if (importData && importData.rows.length > 0) {
          await saveTrialBalance(clientId);
        }

        navigate(`/clients/${clientId}`);
      } else {
        const insertPayload = {
          ...buildClientPayload(),
          firm_id: user?.firm_id || null,
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

        await saveFYClassification(clientData.id);
        await saveServiceBillingData(clientData.id);

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
    if (currentStepDef?.id === "advanced" && !validateAdvancedInfo()) return;
    if (currentStepDef?.id === "service_billing" && !validateServiceBilling()) return;
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
        <div className="flex justify-between text-xs text-muted-foreground overflow-x-auto gap-1">
          {STEPS.map((s, i) => (
            <span key={s} className={`whitespace-nowrap ${i <= step ? "text-primary font-medium" : ""}`}>
              {s}
            </span>
          ))}
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="p-6">
          {currentStepDef?.id === "basic" && (
            <StepBasicInfo data={basicInfo} onChange={setBasicInfo} errors={basicErrors} />
          )}
          {currentStepDef?.id === "advanced" && (
            <StepAdvancedInfo
              data={advancedInfo}
              onChange={setAdvancedInfo}
              entityType={basicInfo.entity_type}
              itrServiceActive={itrServiceActive}
              errors={advancedErrors}
            />
          )}
          {currentStepDef?.id === "service_billing" && (
            <StepServiceBilling
              data={serviceBilling}
              onChange={setServiceBilling}
              errors={serviceErrors}
              gstins={basicInfo.gstins}
              tanNumber={basicInfo.tan_number}
              workGroupType={advancedInfo.work_group_type}
              warnings={crossStepWarnings}
            />
          )}
          {currentStepDef?.id === "financial" && (
            <StepFinancialProfile data={financialProfile} onChange={setFinancialProfile} />
          )}
          {currentStepDef?.id === "compliance" && (
            <StepComplianceFlags data={complianceFlags} onChange={setComplianceFlags} />
          )}
          {currentStepDef?.id === "banking" && (
            <StepBankingLoans data={bankingLoans} onChange={setBankingLoans} />
          )}
          {currentStepDef?.id === "audit_q" && (
            <StepAuditQuestions data={auditQuestions} onChange={setAuditQuestions} />
          )}
          {currentStepDef?.id === "import" && (
            <StepImportData data={importData} onChange={setImportData} onSkip={() => setStep((s) => s + 1)} clientId={isEditMode ? clientId : undefined} firmId={user?.firm_id} />
          )}
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
