import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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

const STEPS = [
  "Basic Info",
  "Financial Profile",
  "Compliance Flags",
  "Banking & Loans",
  "Audit Questions",
  "Import Data",
  "Done",
];

const NewClientWizard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [basicInfo, setBasicInfo] = useState<BasicInfoData>({
    name: "",
    pan: "",
    entity_type: "",
    date_of_incorporation: undefined,
    registered_state: "",
    business_nature: "",
    gstins: [""],
    cin: "",
  });

  const [financialProfile, setFinancialProfile] = useState<FinancialProfileData>({
    accounting_software: "",
    accounting_method: "mercantile",
    turnover_range: "",
    financial_standards: "indian_gaap",
    has_subsidiaries: false,
  });

  const [complianceFlags, setComplianceFlags] = useState<ComplianceFlagsData>({
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
  });

  const [bankingLoans, setBankingLoans] = useState<BankingLoansData>(emptyBankingLoans);
  const [auditQuestions, setAuditQuestions] = useState<AuditQuestionsData>(emptyAuditQuestions);
  const [importData, setImportData] = useState<ImportDataResult | null>(null);

  const [basicErrors, setBasicErrors] = useState<Record<string, string>>({});

  const validateBasicInfo = (): boolean => {
    const errors: Record<string, string> = {};
    if (!basicInfo.name.trim()) errors.name = "Legal name is required";
    if (basicInfo.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(basicInfo.pan))
      errors.pan = "Invalid PAN format";
    basicInfo.gstins.forEach((g, i) => {
      if (g && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g))
        errors[`gstin_${i}`] = "Invalid GSTIN format (15 chars)";
    });
    if (
      (basicInfo.entity_type === "Private Ltd" || basicInfo.entity_type === "Public Ltd") &&
      basicInfo.cin &&
      basicInfo.cin.length !== 21
    )
      errors.cin = "CIN must be exactly 21 characters";
    setBasicErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFinalSubmit = async () => {
    setSaving(true);
    try {
      const gstins = basicInfo.gstins.filter((g) => g.trim());
      const insertPayload = {
        name: basicInfo.name.trim(),
        pan: basicInfo.pan || null,
        entity_type: basicInfo.entity_type || null,
        cin: basicInfo.cin || null,
        gstin: gstins.length > 0 ? gstins : null,
        firm_id: user?.firm_id || null,
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

      const { data: clientData, error: clientError } = await supabase
        .from("clients")
        .insert(insertPayload)
        .select()
        .single();

      if (clientError) throw clientError;

      // Save extended profile to client_profiles
      const profilePayload = {
        client_id: clientData.id,
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
      };

      const { error: profileError } = await supabase
        .from("client_profiles")
        .insert(profilePayload);

      if (profileError) throw profileError;

      // Confetti!
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });

      toast({ title: "Client created!", description: "All wizard data saved successfully." });

      setTimeout(() => navigate(`/clients/${clientData.id}`), 1500);
    } catch (err: any) {
      toast({ title: "Error saving client", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (step === 0 && !validateBasicInfo()) return;
    if (step === STEPS.length - 1) {
      // Final step — submit
      await handleFinalSubmit();
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-xs gap-1" onClick={() => navigate("/clients")}>
          <ArrowLeft className="h-3 w-3" /> Back to Clients
        </Button>
        <h1 className="text-2xl font-display font-bold text-foreground">New Client</h1>
        <p className="text-sm text-muted-foreground mt-1">Onboarding wizard — complete all steps to set up the client.</p>
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
          {step === 0 && <StepBasicInfo data={basicInfo} onChange={setBasicInfo} errors={basicErrors} />}
          {step === 1 && <StepFinancialProfile data={financialProfile} onChange={setFinancialProfile} />}
          {step === 2 && <StepComplianceFlags data={complianceFlags} onChange={setComplianceFlags} />}
          {step === 3 && <StepBankingLoans data={bankingLoans} onChange={setBankingLoans} />}
          {step === 4 && <StepAuditQuestions data={auditQuestions} onChange={setAuditQuestions} />}
          {step === 5 && <StepImportData data={importData} onChange={setImportData} onSkip={() => setStep(6)} />}
          {step === 6 && (
            <StepDone
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
      {step < 6 && (
        <div className="flex justify-between">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Previous
          </Button>
          <Button onClick={handleNext} disabled={saving}>
            {step === 5 ? "Review Summary" : "Next"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default NewClientWizard;
