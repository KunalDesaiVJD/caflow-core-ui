import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { StepBasicInfo, type BasicInfoData } from "@/components/client-wizard/StepBasicInfo";
import { StepFinancialProfile, type FinancialProfileData } from "@/components/client-wizard/StepFinancialProfile";
import { StepComplianceFlags, type ComplianceFlagsData } from "@/components/client-wizard/StepComplianceFlags";

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

  const handleNext = async () => {
    if (step === 0 && !validateBasicInfo()) return;

    // Save after step 3 (compliance flags, index 2)
    if (step === 2) {
      setSaving(true);
      try {
        const gstins = basicInfo.gstins.filter((g) => g.trim());
        const insertPayload = {
          name: basicInfo.name.trim(),
          pan: basicInfo.pan || null,
          entity_type: basicInfo.entity_type || null,
          cin: basicInfo.cin || null,
          gstin: gstins.length > 0 ? gstins : null,
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
        const { data, error } = await supabase
          .from("clients")
          .insert(insertPayload)
          .select()
          .single();

        if (error) throw error;
        toast({ title: "Client created", description: "Steps 1-3 saved successfully." });
        navigate(`/clients/${data.id}`);
      } catch (err: any) {
        toast({ title: "Error saving client", description: err.message, variant: "destructive" });
      } finally {
        setSaving(false);
      }
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
          {step === 0 && (
            <StepBasicInfo data={basicInfo} onChange={setBasicInfo} errors={basicErrors} />
          )}
          {step === 1 && (
            <StepFinancialProfile data={financialProfile} onChange={setFinancialProfile} />
          )}
          {step === 2 && (
            <StepComplianceFlags data={complianceFlags} onChange={setComplianceFlags} />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Previous
        </Button>
        <Button onClick={handleNext} disabled={saving}>
          {step === 2 ? (saving ? "Saving..." : "Save & Finish") : "Next"}
        </Button>
      </div>
    </div>
  );
};

export default NewClientWizard;
