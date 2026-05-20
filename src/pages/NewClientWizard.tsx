import { useState, useEffect, useMemo } from "react";

/** Parse a DB date string (YYYY-MM-DD) as a LOCAL date to avoid UTC-offset shift. */
const parseLocalDate = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Serialise a Date back to YYYY-MM-DD using LOCAL calendar day (not UTC). */
const toLocalDateStr = (dt: Date): string => {
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save } from "lucide-react";
import confetti from "canvas-confetti";
import { StepBasicInfo, type BasicInfoData } from "@/components/client-wizard/StepBasicInfo";
import { StepAdvancedInfo, type AdvancedInfoData, defaultAdvancedInfo } from "@/components/client-wizard/StepAdvancedInfo";
import {
  StepServiceBilling,
  type ServiceBillingData,
  type CrossStepWarning,
  defaultServiceBilling,
  emptyPackageConfig,
} from "@/components/client-wizard/StepServiceBilling";
import { StepAuditSetup, type AuditSetupData, defaultAuditSetup } from "@/components/client-wizard/StepAuditSetup";

/* ───── Step definitions ───── */
const ALL_STEPS = [
  { id: "basic", label: "Basic Info", auditOnly: false },
  { id: "advanced", label: "Advanced Info", auditOnly: false },
  { id: "services", label: "Service & Billing", auditOnly: false },
  { id: "audit", label: "Audit Setup", auditOnly: true },
];

const defaultBasicInfo: BasicInfoData = {
  name: "",
  customer_id: "",
  selectedGroupIds: [],
  pan: "",
  entity_type: "",
  email: "",
  extra_emails: [],
  mobile: "",
  address: "",
  gstins: [""],
  gstin_states: {},
  gstin_addresses: {},
  tan_number: "",
};

const asRecord = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const NewClientWizard = () => {
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId: string }>();
  // FY persistence across refresh — encoded in URL (?fy=2025-26).
  // Without this, refreshing Edit Client always snaps the FY dropdown back to
  // the latest-FY row in client_fy_classifications, masking per-FY edits.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFY = searchParams.get("fy");
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  // GAP-4: use the authenticated user's own firm_id — never hardcode a UUID
  const effectiveFirmId = user?.firm_id ?? null;

  const isEditMode = Boolean(clientId);
  const [draftId, setDraftId] = useState<string | null>(clientId || null);

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingClient, setLoadingClient] = useState(isEditMode);
  const [clientMissing, setClientMissing] = useState(false);

  const [basicInfo, setBasicInfo] = useState<BasicInfoData>(defaultBasicInfo);
  const [advancedInfo, setAdvancedInfo] = useState<AdvancedInfoData>(defaultAdvancedInfo);
  const [serviceBilling, setServiceBilling] = useState<ServiceBillingData>(defaultServiceBilling);
  const [auditSetup, setAuditSetup] = useState<AuditSetupData>(defaultAuditSetup);

  const [basicErrors, setBasicErrors] = useState<Record<string, string>>({});
  const [advancedErrors, setAdvancedErrors] = useState<Record<string, string>>({});
  const [serviceErrors, setServiceErrors] = useState<Record<string, string>>({});
  // For superadmin editing an existing client: track the client's own firm_id
  const [loadedClientFirmId, setLoadedClientFirmId] = useState<string | null>(null);
  /** FY in which this client was created — derived from clients.created_at.
   *  Used by the classification-change modal to block back-dating before the
   *  client existed. */
  const [clientCreationFY, setClientCreationFY] = useState<string | undefined>(undefined);

  // Track linked modules of active services for cross-step logic
  const [activeLinkedModules, setActiveLinkedModules] = useState<string[]>([]);

  // The classification value that was last saved to DB (edit mode).
  // Used to show warning modal in StepAdvancedInfo when the user changes it.
  const [savedClassification, setSavedClassification] = useState<string>("");

  // Derive itrServiceActive from service billing state
  const itrServiceActive = activeLinkedModules.includes("itr");

  // Visible steps: show audit step only when classification === "Audit"
  const visibleSteps = useMemo(
    () => ALL_STEPS.filter((s) => !s.auditOnly || advancedInfo.classification === "Audit"),
    [advancedInfo.classification]
  );

  const STEPS = visibleSteps.map((s) => s.label);
  const currentStepDef = visibleSteps[step];

  // Keep step in bounds when steps change
  useEffect(() => {
    if (step >= visibleSteps.length) setStep(visibleSteps.length - 1);
  }, [visibleSteps.length, step]);

  // Sync audit setup FY from advanced info
  useEffect(() => {
    if (advancedInfo.financial_year && auditSetup.financial_year !== advancedInfo.financial_year) {
      setAuditSetup((prev) => ({ ...prev, financial_year: advancedInfo.financial_year }));
    }
  }, [advancedInfo.financial_year]);

  // Firm selector removed — all clients go under V J Desai & Co.

  // Create draft client on wizard open (create mode only)
  useEffect(() => {
    if (isEditMode || draftId) return;
    const createDraft = async () => {
      if (!effectiveFirmId) return; // Wait for superadmin to select a firm
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user?.id) return;
      // TODO: Supabase RLS policy needs superadmin bypass for clients insert
      const { data: draft, error } = await supabase
        .from("clients")
        .insert({
          name: null,
          firm_id: effectiveFirmId,
          user_id: authData.user.id,
          is_draft: true,
          // GAP-7: tag origin — 'manual' for wizard-created clients
          // Requires DB migration: ALTER TABLE clients ADD COLUMN source text DEFAULT 'manual';
          source: "manual",
        } as any)
        .select("id")
        .single();
      if (!error && draft) {
        setDraftId(draft.id);
        // Also create client_profiles
        await supabase.from("client_profiles").insert({ client_id: draft.id, audit_questions: {} as any });
      }
    };
    createDraft();
  }, [isEditMode, effectiveFirmId]);


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

  /* ───── EDIT MODE: Load existing client ───── */
  useEffect(() => {
    if (!isEditMode || !clientId) {
      setLoadingClient(false);
      return;
    }

    let mounted = true;

    const loadClient = async () => {
      setLoadingClient(true);
      setClientMissing(false);

      // If the URL pins a specific FY (?fy=2025-26) load that row; otherwise
      // fall back to the latest-FY row.  Pinning lets users land directly on
      // a per-FY edit screen and survives page refresh.
      const baseClassQuery = supabase
        .from("client_fy_classifications")
        .select("*")
        .eq("client_id", clientId);
      const baseAuditQuery = supabase
        .from("client_fy_audit_setup")
        .select("*")
        .eq("client_id", clientId);

      const [clientRes, profileRes, fyClassRes, fyAuditRes] = await Promise.all([
        supabase
          .from("clients")
          .select("*")
          .eq("id", clientId)
          .maybeSingle(),
        supabase
          .from("client_profiles")
          .select("id, client_id, audit_questions")
          .eq("client_id", clientId)
          .order("id", { ascending: false })
          .limit(1),
        urlFY
          ? baseClassQuery.eq("financial_year", urlFY).limit(1)
          : baseClassQuery.order("updated_at", { ascending: false }).limit(1),
        urlFY
          ? baseAuditQuery.eq("financial_year", urlFY).limit(1)
          : baseAuditQuery.order("updated_at", { ascending: false }).limit(1),
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
      const fyClass = (fyClassRes.data?.[0] as any) ?? null;
      const fyAudit = (fyAuditRes.data?.[0] as any) ?? null;

      // #13: track the client's firm_id so superadmin uses the right firm for service categories
      if (client.firm_id) setLoadedClientFirmId(client.firm_id);

      // Derive client creation FY from created_at (Indian FY: April–March).
      if (client.created_at) {
        const d = new Date(client.created_at);
        const y = d.getFullYear();
        const startYear = d.getMonth() >= 3 ? y : y - 1;
        setClientCreationFY(`${startYear}-${String(startYear + 1).slice(2)}`);
      }

      // GAP-2: load existing group memberships so edit mode doesn't wipe them on save
      const { data: existingMemberships } = await supabase
        .from("client_group_memberships")
        .select("group_id")
        .eq("client_id", clientId!);
      const existingGroupIds = (existingMemberships || []).map((m: any) => m.group_id);

      setBasicInfo({
        name: client.name || "",
        customer_id: client.customer_id || "",
        selectedGroupIds: existingGroupIds,
        pan: client.pan || "",
        entity_type: client.entity_type || "",
        gstins: Array.isArray(client.gstin) && client.gstin.length > 0 ? client.gstin : [""],
        gstin_states: (client.gstin_states && typeof client.gstin_states === "object" && !Array.isArray(client.gstin_states))
          ? (client.gstin_states as Record<string, string>)
          : {},
        gstin_addresses: (() => {
          const saved = (client.gstin_addresses && typeof client.gstin_addresses === "object" && !Array.isArray(client.gstin_addresses))
            ? { ...(client.gstin_addresses as Record<string, string>) }
            : {};
          // Auto-fill: if client has a main address and a GSTIN but no per-GSTIN address yet,
          // pre-populate it so the field shows something meaningful immediately.
          if (client.address) {
            const gstinList: string[] = Array.isArray(client.gstin) ? client.gstin : [];
            gstinList.filter((g: string) => g.trim()).forEach((g: string) => {
              if (!saved[g]) saved[g] = client.address;
            });
          }
          return saved;
        })(),
        email: client.email || "",
        extra_emails: Array.isArray(client.extra_emails)
          ? client.extra_emails
          : Array.isArray((client.compliance_flags as any)?.extra_emails)
            ? (client.compliance_flags as any).extra_emails
            : [],
        mobile: client.mobile || "",
        address: client.address || "",
        tan_number: client.tan_number || "",
      });

      // Remember the DB-saved classification for the warning modal
      setSavedClassification(fyClass?.classification || "");

      // FY priority: URL param → row's FY → app default.  When the URL pins
      // an FY that has no row yet, we still want the form to land on that FY
      // so the next Save creates the per-FY row.
      const initialFY = urlFY || fyClass?.financial_year || defaultAdvancedInfo.financial_year;

      setAdvancedInfo({
        ...defaultAdvancedInfo,
        financial_year: initialFY,
        classification: fyClass?.classification || "",
        audit_firm_id: fyClass?.audit_firm_id || "",
        responsible_person_id: client.responsible_person_id || "",
        contact_person: client.contact_person || "",
        date_of_incorporation: client.date_of_incorporation ? parseLocalDate(client.date_of_incorporation) : undefined,
        registered_state: client.registered_state || "",
        business_nature: client.business_activity || "",
        cin: client.cin || "",
        dsc_number: client.dsc_number || "",
        dsc_expiry_date: client.dsc_expiry_date ? parseLocalDate(client.dsc_expiry_date) : undefined,
        work_group_type: client.work_group_type || "",
      });

      if (fyAudit) {
        setAuditSetup({
          financial_year: fyAudit.financial_year || "",
          statutory_audit_applicable: fyAudit.statutory_audit_applicable || false,
          tax_audit_applicable: fyAudit.tax_audit_applicable || false,
          caro_applicable: fyAudit.caro_applicable || false,
          internal_audit_applicable: fyAudit.internal_audit_applicable || false,
          stock_audit_applicable: fyAudit.stock_audit_applicable || false,
          audit_billing_amount: fyAudit.audit_billing_amount?.toString() || "",
        });
      }

      // ── Load Services & Billing ──────────────────────────────────────────────
      const { data: existingServices } = await supabase
        .from("client_services")
        .select("*")
        .eq("client_id", clientId!)
        .eq("is_active", true);

      // Load the most-recent package regardless of is_active so we always find it
      const pkgRes = await (supabase
        .from("client_service_packages")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle() as any);
      const activePkgRow = pkgRes?.data ?? null;

      // Determine billing mode:
      // 1. Package row exists in client_service_packages → package_wise
      // 2. client_services row with billing_mode = "package_wise" → package_wise
      // 3. Otherwise → service_specific
      const hasPkgRow = !!activePkgRow;
      const svcBillingMode = (existingServices?.[0] as any)?.billing_mode;
      const billingMode: "service_specific" | "package_wise" =
        hasPkgRow || svcBillingMode === "package_wise" ? "package_wise" : "service_specific";

      // Build individual services map (for "not in package" rows)
      const activeServicesMap: Record<string, import("@/components/client-wizard/StepServiceBilling").ServiceConfig> = {};
      for (const svc of (existingServices || []) as any[]) {
        activeServicesMap[svc.service_category_id] = {
          frequency: svc.frequency_override || "monthly",
          reminder_date: svc.reminder_date ?? 1,
          billing_amount: svc.billing_amount ?? 0,
          invoice_gen_type: (svc.invoice_gen_type === "auto" ? "auto" : "reminder") as "auto" | "reminder",
        };
      }

      // Load package config
      let loadedPkg = { ...emptyPackageConfig };
      if (billingMode === "package_wise" && activePkgRow) {
        const rawIds = activePkgRow.service_category_ids;
        const serviceIds: string[] = Array.isArray(rawIds)
          ? rawIds
          : typeof rawIds === "string"
          ? JSON.parse(rawIds)
          : [];
        loadedPkg = {
          package_name: activePkgRow.package_name || "",
          service_ids: serviceIds,
          frequency: activePkgRow.frequency || "monthly",
          reminder_date: activePkgRow.reminder_date ?? 1,
          billing_amount: activePkgRow.billing_amount ?? 0,
          invoice_gen_type: (activePkgRow.invoice_gen_type === "auto" ? "auto" : "reminder") as "auto" | "reminder",
        };
      }

      setServiceBilling({
        billingMode,
        activeServices: activeServicesMap,
        packageConfig: loadedPkg,
      });

      setLoadingClient(false);
    };

    loadClient();

    return () => { mounted = false; };
  }, [clientId, isEditMode, toast]);

  /* ───── EDIT MODE: mirror the picked FY into the URL (?fy=...) so refresh
   *  lands the user back on the same FY they were editing rather than snapping
   *  back to the latest-FY row.  Skipped during the initial load. */
  useEffect(() => {
    if (!isEditMode || !clientId || loadingClient) return;
    const fy = advancedInfo.financial_year;
    if (!fy) return;
    if (searchParams.get("fy") === fy) return;
    const next = new URLSearchParams(searchParams);
    next.set("fy", fy);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedInfo.financial_year, isEditMode, clientId, loadingClient]);

  /* ───── EDIT MODE: re-fetch FY-specific snapshot when user picks a different FY
   *
   * Bug: previously the wizard loaded the latest FY's row of
   * client_fy_classifications + client_fy_audit_setup once on mount.  Changing
   * the "Classification Financial Year" dropdown only mutated local state — it
   * never re-queried the per-FY tables — so the form continued displaying the
   * originally-loaded FY's data, and a Save would silently duplicate that
   * data into the newly-picked FY row.  As a knock-on, Audit Intelligence /
   * Tracker dropdowns (which gate by `applicable_fys[]` derived from
   * client_fy_audit_setup) never reflected the user's intended change.
   *
   * Fix: when the FY changes after the initial load completes, re-pull the
   * snapshots for THAT FY and rehydrate `savedClassification`,
   * advancedInfo.{classification, audit_firm_id} and the entire `auditSetup`
   * block.  If no row exists for the selected FY we reset to defaults so the
   * user can configure that FY from scratch and a subsequent Save will
   * correctly write a new row at the chosen FY.
   * ───────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isEditMode || !clientId) return;
    if (loadingClient) return;                  // skip during initial load
    const fy = advancedInfo.financial_year;
    if (!fy) return;

    let cancelled = false;

    (async () => {
      const [fyClassRes, fyAuditRes] = await Promise.all([
        supabase
          .from("client_fy_classifications")
          .select("*")
          .eq("client_id", clientId)
          .eq("financial_year", fy)
          .maybeSingle(),
        supabase
          .from("client_fy_audit_setup")
          .select("*")
          .eq("client_id", clientId)
          .eq("financial_year", fy)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      const fyClass = (fyClassRes.data as any) ?? null;
      const fyAudit = (fyAuditRes.data as any) ?? null;

      // Snapshot used by the classification-change-warning modal.
      setSavedClassification(fyClass?.classification || "");

      // Patch only the FY-bound fields — leave Legal Reg / DSC / Work Group alone
      // because those live on the clients row (FY-agnostic) and the user may
      // still be editing them.
      setAdvancedInfo(prev => ({
        ...prev,
        financial_year: fy,
        classification: fyClass?.classification || "",
        audit_firm_id:  fyClass?.audit_firm_id  || "",
      }));

      setAuditSetup({
        financial_year:             fy,
        statutory_audit_applicable: !!fyAudit?.statutory_audit_applicable,
        tax_audit_applicable:       !!fyAudit?.tax_audit_applicable,
        caro_applicable:            !!fyAudit?.caro_applicable,
        internal_audit_applicable:  !!fyAudit?.internal_audit_applicable,
        stock_audit_applicable:     !!fyAudit?.stock_audit_applicable,
        audit_billing_amount:       fyAudit?.audit_billing_amount?.toString() || "",
      });
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, isEditMode, advancedInfo.financial_year, loadingClient]);

  // GAP-4: detect if this is an API-imported draft being reviewed
  const [isApiDraft, setIsApiDraft] = useState(false);
  useEffect(() => {
    if (!isEditMode || !clientId) return;
    supabase.from("clients").select("source, is_draft").eq("id", clientId).maybeSingle().then(({ data }) => {
      if (data?.source === "api_import" && data?.is_draft === true) setIsApiDraft(true);
    });
  }, [clientId, isEditMode]);

  /* ───── Validation ───── */
  const validateBasicInfo = async (): Promise<boolean> => {
    const errors: Record<string, string> = {};
    if (!basicInfo.name.trim()) errors.name = "Legal name is required";
    if (!basicInfo.selectedGroupIds || basicInfo.selectedGroupIds.length === 0) {
      errors.selectedGroupIds = "At least one Client Group is required";
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
      // GAP-5: restrict uniqueness check to the current firm — PANs are unique per firm, not globally.
      // Only check against published (non-draft) clients — drafts may have the same PAN
      // during import and the conflict is resolved at finalization time.
      let panQuery = supabase
        .from("clients")
        .select("id")
        .eq("pan", basicInfo.pan)
        .eq("is_draft", false)
        .is("deleted_at", null);
      if (effectiveFirmId) panQuery = panQuery.eq("firm_id", effectiveFirmId);
      const { data: existing } = await panQuery.limit(1);
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
    // GAP-5: cross-step dependency warnings are now HARD blocks — prevent proceeding until resolved
    for (const w of crossStepWarnings) {
      if (w.type === "gst") errors.services = w.message;
      if (w.type === "tds") errors.tds = w.message;
      if (w.type === "itr") errors.itr = w.message;
    }
    setServiceErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /* ───── Payload builders ───── */
  const buildClientPayload = () => {
    const gstins = basicInfo.gstins.filter((g) => g.trim());
    // Keep only states/addresses for GSTINs that are still in the list
    const gstin_states: Record<string, string> = {};
    const gstin_addresses: Record<string, string> = {};
    gstins.forEach((g) => {
      if (basicInfo.gstin_states[g]) gstin_states[g] = basicInfo.gstin_states[g];
      if (basicInfo.gstin_addresses[g]) gstin_addresses[g] = basicInfo.gstin_addresses[g];
    });
    return {
      name: basicInfo.name.trim(),
      customer_id: basicInfo.customer_id?.trim() || null,
      pan: basicInfo.pan || null,
      entity_type: basicInfo.entity_type || null,
      gstin: gstins.length > 0 ? gstins : null,
      gstin_states,
      gstin_addresses,
      email: basicInfo.email || null,
      // extra_emails saved separately below — kept out of main payload so saves
      // work even before the DB migration (20260504120000) has been applied.
      contact_person: advancedInfo.contact_person?.trim() || null,
      mobile: basicInfo.mobile || null,
      address: basicInfo.address || null,
      tan_number: basicInfo.tan_number || null,
      dsc_number: advancedInfo.dsc_number || null,
      dsc_expiry_date: advancedInfo.dsc_expiry_date ? toLocalDateStr(advancedInfo.dsc_expiry_date) : null,
      work_group_type: advancedInfo.work_group_type || null,
      responsible_person_id: advancedInfo.responsible_person_id || null,
      date_of_incorporation: advancedInfo.date_of_incorporation ? toLocalDateStr(advancedInfo.date_of_incorporation) : null,
      registered_state: advancedInfo.registered_state || null,
      business_activity: advancedInfo.business_nature || null,
      cin: advancedInfo.cin || null,
      is_draft: false,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
  };

  // Saves extra_emails inside compliance_flags JSONB (works without any migration).
  const saveExtraEmails = async (targetClientId: string) => {
    if (!targetClientId) return;
    const emails = (basicInfo.extra_emails || []).filter(e => e.trim());
    const { data: current } = await supabase
      .from("clients")
      .select("compliance_flags")
      .eq("id", targetClientId)
      .single();
    const existing = (current?.compliance_flags as Record<string, unknown>) || {};
    await supabase
      .from("clients")
      .update({ compliance_flags: { ...existing, extra_emails: emails } })
      .eq("id", targetClientId);
  };

  const saveServiceBillingData = async (targetClientId: string) => {
    // FIX: use loadedClientFirmId as fallback so superadmin can save services
    const firmId = effectiveFirmId ?? loadedClientFirmId;
    if (!firmId) return;

    const isPackageMode = serviceBilling.billingMode === "package_wise";

    // In package mode the active set comes from packageConfig.service_ids;
    // in service-specific mode it comes from the activeServices map.
    const newActiveIds = isPackageMode
      ? serviceBilling.packageConfig.service_ids
      : Object.keys(serviceBilling.activeServices);

    // FIX: deactivate any services removed from the wizard (previously active but no longer selected)
    if (newActiveIds.length > 0) {
      // Deactivate existing rows whose service_category_id is NOT in the new active list
      await supabase
        .from("client_services")
        .update({ is_active: false, deactivated_at: new Date().toISOString() } as any)
        .eq("client_id", targetClientId)
        .eq("is_active", true)
        .not("service_category_id", "in", `(${newActiveIds.join(",")})`);
    } else {
      // All services removed — deactivate everything for this client
      await supabase
        .from("client_services")
        .update({ is_active: false, deactivated_at: new Date().toISOString() } as any)
        .eq("client_id", targetClientId)
        .eq("is_active", true);
    }

    if (isPackageMode && newActiveIds.length > 0) {
      // Package mode: write one client_services row per service in the package
      // so Service Activation tab correctly shows all of them as Active.
      const pkg = serviceBilling.packageConfig;
      const rows = newActiveIds.map(serviceId => ({
        client_id: targetClientId,
        service_category_id: serviceId,
        is_active: true,
        frequency_override: pkg.frequency || null,
        billing_amount: null,    // billing handled at package level
        reminder_date: pkg.reminder_date || null,
        invoice_gen_type: pkg.invoice_gen_type || null,
        billing_mode: "package_wise",
      }));
      const { error: svcError } = await supabase.from("client_services").upsert(rows as any, {
        onConflict: "client_id,service_category_id",
      });
      if (svcError) {
        console.error("[Services] package upsert error:", svcError);
        throw svcError;
      }
    } else {
      // Save active individual services (service-specific mode)
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
        const { error: svcError } = await supabase.from("client_services").upsert(rows as any, {
          onConflict: "client_id,service_category_id",
        });
        if (svcError) {
          console.error("[Services] upsert error:", svcError);
          throw svcError;
        }
      }
    }

    // Save package if package mode — deactivate ALL old packages first, then insert
    if (serviceBilling.billingMode === "package_wise" && serviceBilling.packageConfig.service_ids.length > 0) {
      const pkg = serviceBilling.packageConfig;
      // Deactivate ALL existing packages for this client (no is_active filter)
      await supabase
        .from("client_service_packages")
        .update({ is_active: false } as any)
        .eq("client_id", targetClientId);
      // Insert the new/updated package
      const { error: pkgError } = await supabase.from("client_service_packages").insert({
        client_id: targetClientId,
        package_name: pkg.package_name,
        service_category_ids: pkg.service_ids as any,
        frequency: pkg.frequency,
        reminder_date: pkg.reminder_date,
        billing_amount: pkg.billing_amount,
        invoice_gen_type: pkg.invoice_gen_type,
        is_active: true,
      } as any);
      if (pkgError) {
        console.error("[Services] package insert error:", pkgError);
        throw pkgError;
      }
    } else if (serviceBilling.billingMode === "service_specific") {
      // Switching back from package mode — deactivate all packages
      await supabase
        .from("client_service_packages")
        .update({ is_active: false, updated_at: new Date().toISOString() } as any)
        .eq("client_id", targetClientId)
        .eq("is_active", true);
    }

    // Billing reminders creation paused — re-enable when REMINDERS_ENABLED is turned back on
  };

  const saveFYClassification = async (targetClientId: string, authUserId?: string) => {
    if (!advancedInfo.classification || !advancedInfo.financial_year) return;

    // ISSUE-21: Read the current DB value BEFORE the upsert so we can record old → new in history.
    const { data: existingFYRow } = await (supabase as any)
      .from("client_fy_classifications")
      .select("classification")
      .eq("client_id", targetClientId)
      .eq("financial_year", advancedInfo.financial_year)
      .maybeSingle();
    const oldClassification: string | null = existingFYRow?.classification ?? null;

    // Upsert current classification (single source of truth per client+FY).
    // firm_id is stored directly so ClassificationByFYView can query without a large IN() list.
    // onConflict targets only the exact (client_id, financial_year) row — other FY rows are untouched.
    const classFirmId = effectiveFirmId ?? loadedClientFirmId ?? null;
    const { error } = await supabase.from("client_fy_classifications").upsert({
      client_id:      targetClientId,
      financial_year: advancedInfo.financial_year,
      classification: advancedInfo.classification,
      audit_firm_id:  advancedInfo.audit_firm_id || null,
      firm_id:        classFirmId,
    } as any, { onConflict: "client_id,financial_year" });
    if (error) throw error;

    // Skip history insert when the value hasn't actually changed (e.g. save on same classification).
    if (oldClassification !== advancedInfo.classification) {
      // Compute the FY from which the new classification takes effect (= next FY).
      const fyMatch = advancedInfo.financial_year.match(/^(\d{4})-(\d{2})$/);
      const effectiveFromFY = fyMatch
        ? (() => { const y = parseInt(fyMatch[1]) + 1; return `${y}-${String(y + 1).slice(2)}`; })()
        : null;

      // Append-only history row — preserves every old→new transition with actor + timestamp.
      try {
        await (supabase as any).from("client_classification_history").insert({
          client_id:              targetClientId,
          new_classification:     advancedInfo.classification,
          previous_classification: oldClassification,
          old_classification:     oldClassification,
          effective_from_fy:      effectiveFromFY,
          changed_by:             authUserId ?? null,
        });
      } catch (histErr) {
        // History is non-fatal — log but do not abort the save.
        console.warn("[Wizard] Could not write classification history:", histErr);
      }
    }

    // Keep local savedClassification in sync so the warning modal reflects the new state.
    setSavedClassification(advancedInfo.classification);
  };

  const saveAuditSetup = async (targetClientId: string) => {
    if (advancedInfo.classification !== "Audit") return;
    // Write to client_fy_audit_setup (FY-specific flags — primary storage for wizard)
    await supabase.from("client_fy_audit_setup").upsert({
      client_id: targetClientId,
      financial_year: auditSetup.financial_year || advancedInfo.financial_year,
      statutory_audit_applicable: auditSetup.statutory_audit_applicable,
      tax_audit_applicable: auditSetup.tax_audit_applicable,
      caro_applicable: auditSetup.caro_applicable,
      internal_audit_applicable: auditSetup.internal_audit_applicable,
      stock_audit_applicable: auditSetup.stock_audit_applicable,
      audit_billing_amount: auditSetup.audit_billing_amount ? Number(auditSetup.audit_billing_amount) : null,
    } as any, { onConflict: "client_id,financial_year" });
    // Also mirror into clients.* direct columns so AuditPipeline Source 1 picks this up
    // and ClientDetail card shows the correct state without needing a merge.
    // tax_audit_applicable (canonical boolean, migration 20260430130000) MUST
    // be written here so the Create Engagement dropdown sees it without
    // having to merge across client_fy_audit_setup.
    await supabase.from("clients").update({
      statutory_audit_applicable: auditSetup.statutory_audit_applicable,
      tax_audit_applicable: auditSetup.tax_audit_applicable,
      caro_applicable: auditSetup.caro_applicable,
      internal_audit_applicable: auditSetup.internal_audit_applicable,
      stock_audit_applicable: auditSetup.stock_audit_applicable,
      // tax_audit_type: set to "3CB" if tax audit applicable, null otherwise
      // (3CB is the standard form for non-corporate; corporate gets 3CA — wizard can refine later)
      tax_audit_type: auditSetup.tax_audit_applicable
        ? ((auditSetup as any).tax_audit_type || "3CB")
        : null,
    } as any).eq("id", targetClientId);
  };

  /* ───── Draft → Final promotion helper ─────────────────────────────────────
   *
   * Called after every step save in EDIT mode.
   * Queries the DB to verify ALL required conditions are now satisfied, then
   * flips is_draft → false if they are. This covers clients created via the
   * external API that bypass handleFinalSubmit() entirely.
   *
   * Required conditions:
   *   1. clients.name, .pan, .entity_type  — all non-empty
   *   2. client_fy_classifications row      — financial_year + classification set
   *   3. client_services                    — at least one active service row
   * ─────────────────────────────────────────────────────────────────────────── */
  const tryPromoteToFinal = async (): Promise<boolean> => {
    if (!clientId) return false;

    // ── 1. Read current draft status + required scalar fields ──
    const { data: row, error: rowErr } = await supabase
      .from("clients")
      .select("is_draft, name, pan, entity_type")
      .eq("id", clientId)
      .maybeSingle();

    if (rowErr) {
      console.error("[Wizard] tryPromoteToFinal: could not read client:", rowErr.message);
      return false;
    }
    if (!row || !row.is_draft) return false; // Already final — nothing to do

    const nameOk = Boolean(row.name?.trim());
    const panOk  = Boolean(row.pan?.trim());
    const typeOk = Boolean(row.entity_type?.trim());

    // ── 2. Check FY classification ──
    const { data: fyRows } = await supabase
      .from("client_fy_classifications")
      .select("financial_year, classification")
      .eq("client_id", clientId)
      .limit(1);
    const fyOk = Boolean(fyRows?.[0]?.financial_year && fyRows?.[0]?.classification);

    // ── 3. Check at least one active service/package OR Audit classification ──
    // Audit-classified clients are served through engagements, not service rows,
    // so having classification = 'Audit' satisfies the service requirement.
    const [svcRes, pkgRes] = await Promise.all([
      supabase.from("client_services").select("id").eq("client_id", clientId).eq("is_active", true).limit(1),
      supabase.from("client_service_packages").select("id").eq("client_id", clientId).eq("is_active", true).limit(1),
    ]);
    const isAuditClassified = fyRows?.[0]?.classification?.toLowerCase().includes("audit") ?? false;
    const svcOk = (svcRes.data?.length ?? 0) > 0 || (pkgRes.data?.length ?? 0) > 0 || isAuditClassified;

    console.log("[Wizard] Promotion check for", clientId, "→", { nameOk, panOk, typeOk, fyOk, svcOk, isAuditClassified });

    if (!nameOk || !panOk || !typeOk || !fyOk || !svcOk) {
      // Not yet complete — tell the user what's still missing
      const missing: string[] = [];
      if (!nameOk) missing.push("Name");
      if (!panOk)  missing.push("PAN");
      if (!typeOk) missing.push("Entity Type");
      if (!fyOk)   missing.push("Financial Year / Classification");
      if (!svcOk)  missing.push("at least one active Service");
      toast({
        title: "Details saved — client still in draft",
        description: `Still required: ${missing.join(", ")}`,
      });
      return false;
    }

    // ── 4. All conditions met → promote ──
    const { error: promoteErr } = await supabase
      .from("clients")
      .update({ is_draft: false } as any)
      .eq("id", clientId);

    if (promoteErr) {
      // ROOT CAUSE C/D — log the exact error so RLS issues are visible
      console.error("[Wizard] Promotion FAILED for", clientId, ":", promoteErr.message, promoteErr);
      toast({
        title: "Could not activate client",
        description: `DB error: ${promoteErr.message}`,
        variant: "destructive",
      });
      return false;
    }

    toast({
      title: "✅ Client activated!",
      description: "All required details are complete. The client is now active.",
    });

    // Step 5 (spec): navigate to ClientDetail so the status badge refreshes instantly.
    // Same confetti + delayed navigate as handleFinalSubmit().
    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    setTimeout(() => navigate(`/clients/${clientId}`), 700);
    return true;
  };

  /* ───── Edit mode: save single step ───── */
  const saveCurrentStep = async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      const stepId = currentStepDef?.id;

      if (stepId === "basic") {
        if (!(await validateBasicInfo())) { setSaving(false); return; }
        const gstins = basicInfo.gstins.filter((g) => g.trim());
        const gstin_states: Record<string, string> = {};
        const gstin_addresses: Record<string, string> = {};
        gstins.forEach((g) => {
          if (basicInfo.gstin_states[g]) gstin_states[g] = basicInfo.gstin_states[g];
          if (basicInfo.gstin_addresses[g]) gstin_addresses[g] = basicInfo.gstin_addresses[g];
        });
        const { error } = await supabase
          .from("clients")
          .update({
            name: basicInfo.name.trim(),
            customer_id: basicInfo.customer_id?.trim() || null,
            pan: basicInfo.pan || null,
            entity_type: basicInfo.entity_type || null,
            gstin: gstins.length > 0 ? gstins : null,
            gstin_states,
            gstin_addresses,
            email: basicInfo.email || null,
            mobile: basicInfo.mobile || null,
            address: basicInfo.address || null,
            tan_number: basicInfo.tan_number || null,
          } as any)
          .eq("id", clientId);
        if (error) throw error;
        // extra_emails — separate update, safe-fails if column not yet migrated
        await saveExtraEmails(clientId);
        // Save group memberships
        await supabase.from("client_group_memberships").delete().eq("client_id", clientId);
        const groupIds = basicInfo.selectedGroupIds || [];
        if (groupIds.length > 0) {
          const { data: authData } = await supabase.auth.getUser();
          await supabase.from("client_group_memberships").insert(
            groupIds.map((gid) => ({
              group_id: gid,
              client_id: clientId,
              added_by: authData.user?.id || null,
            }))
          );
        }
      } else if (stepId === "advanced") {
        if (!validateAdvancedInfo()) { setSaving(false); return; }
        const { error } = await supabase
          .from("clients")
          .update({
            contact_person: advancedInfo.contact_person?.trim() || null,
            dsc_number: advancedInfo.dsc_number || null,
            dsc_expiry_date: advancedInfo.dsc_expiry_date ? toLocalDateStr(advancedInfo.dsc_expiry_date) : null,
            work_group_type: advancedInfo.work_group_type || null,
            responsible_person_id: advancedInfo.responsible_person_id || null,
            date_of_incorporation: advancedInfo.date_of_incorporation ? toLocalDateStr(advancedInfo.date_of_incorporation) : null,
            registered_state: advancedInfo.registered_state || null,
            business_activity: advancedInfo.business_nature || null,
            cin: advancedInfo.cin || null,
          } as any)
          .eq("id", clientId);
        if (error) throw error;
        const { data: authData } = await supabase.auth.getUser();
        await saveFYClassification(clientId, authData.user?.id);
      } else if (stepId === "services") {
        if (!validateServiceBilling()) { setSaving(false); return; }
        await saveServiceBillingData(clientId);
        // ROOT CAUSE A/B fix: check promotion on services save too (has early return)
        const promoted = await tryPromoteToFinal();
        if (!promoted) {
          toast({ title: "Services saved", description: "Service billing configuration saved successfully." });
        }
        setSaving(false);
        return;
      } else if (stepId === "audit") {
        await saveAuditSetup(clientId);
      }

      // ROOT CAUSE A/B fix: attempt draft→final promotion after every step save
      const promoted = await tryPromoteToFinal();
      if (!promoted) {
        toast({ title: "Saved", description: `${currentStepDef?.label} saved successfully.` });
      }
    } catch (err: any) {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /* ───── Final submit (create mode) ───── */
  const handleFinalSubmit = async () => {
    setSaving(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const authUserId = authData.user?.id;
      if (!authUserId) throw new Error("You must be logged in to save this client.");

      const payload = {
        ...buildClientPayload(),
        firm_id: effectiveFirmId,
        user_id: authUserId,
      };

      let newId: string;

      if (draftId) {
        // Update the existing draft client
        const { data: updated, error: updateError } = await supabase
          .from("clients")
          .update(payload as any)
          .eq("id", draftId)
          .select("id")
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updated) throw new Error("Failed to update draft client. Permission denied.");
        newId = updated.id;
      } else {
        // Fallback: insert new
        const { data: clientData, error: clientError } = await supabase
          .from("clients")
          .insert(payload as any)
          .select("id")
          .single();
        if (clientError) throw clientError;
        newId = clientData.id;

        // Create client_profiles only for new inserts (draft already has it)
        await supabase.from("client_profiles").insert({ client_id: newId, audit_questions: {} as any });
      }

      // 3. INSERT client_fy_classifications + history row
      await saveFYClassification(newId, authUserId);

      // 4. Audit setup if classification is Audit
      await saveAuditSetup(newId);

      // 5-7. Services, packages, billing reminders
      await saveServiceBillingData(newId);

      // extra_emails — saved after main row; safe-fails if column not yet migrated
      await saveExtraEmails(newId);

      // 8. Group memberships
      const groupIds = basicInfo.selectedGroupIds || [];
      if (groupIds.length > 0) {
        await supabase.from("client_group_memberships").insert(
          groupIds.map((gid) => ({
            group_id: gid,
            client_id: newId,
            added_by: authUserId,
          }))
        );
      }

      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      toast({ title: "Client created!", description: "All wizard data saved successfully." });
      setTimeout(() => navigate(`/clients/${newId}`), 700);
    } catch (err: any) {
      toast({ title: "Error saving client", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /* ───── Navigation ───── */
  const handleNext = async () => {
    if (currentStepDef?.id === "basic" && !(await validateBasicInfo())) return;
    if (currentStepDef?.id === "advanced" && !validateAdvancedInfo()) return;
    if (currentStepDef?.id === "services" && !validateServiceBilling()) return;

    // If last step, submit
    if (step === visibleSteps.length - 1) {
      await handleFinalSubmit();
      return;
    }
    setStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  };

  const progress = ((step + 1) / visibleSteps.length) * 100;

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
            ? "Update client sections independently using tabs."
            : "Onboarding wizard — complete all steps to set up the client."}
        </p>
      </div>

      {/* GAP-4: API Import Review banner */}
      {isApiDraft && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 p-4">
          <div className="text-blue-600 dark:text-blue-400 mt-0.5">ℹ</div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">API Import — Review Required</p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
              This client was imported via API. Step 1 is auto-filled from the import data.
              Review each step and save to activate the client.
            </p>
            {step === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-xs border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300"
                onClick={() => setStep(1)}
              >
                Skip to Step 2 — Advanced Info →
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Edit mode: Tab navigation | Create mode: Progress bar */}
      {isEditMode ? (
        <Tabs
          value={currentStepDef?.id || "basic"}
          onValueChange={(v) => {
            const idx = visibleSteps.findIndex((s) => s.id === v);
            if (idx >= 0) setStep(idx);
          }}
        >
          <TabsList className="w-full justify-start">
            {ALL_STEPS.map((s) => {
              const isAuditTab = s.id === "audit";
              const disabled = isAuditTab && advancedInfo.classification !== "Audit";
              const isVisible = visibleSteps.some((vs) => vs.id === s.id);
              return (
                <TabsTrigger
                  key={s.id}
                  value={s.id}
                  disabled={disabled}
                  className={disabled ? "opacity-40 cursor-not-allowed" : ""}
                >
                  {s.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      ) : (
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
      )}

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
              savedClassification={isEditMode ? savedClassification : undefined}
              clientId={isEditMode ? clientId : undefined}
              clientCreationFY={clientCreationFY}
              onClassificationSaved={(newClassification, newFY) => {
                // Use the value passed directly — advancedInfo.classification
                // is stale here because React hasn't re-rendered yet.
                setSavedClassification(newClassification);
                // Update URL ?fy= so a page reload loads the correct FY row
                if (newFY && newFY !== searchParams.get("fy")) {
                  const next = new URLSearchParams(searchParams);
                  next.set("fy", newFY);
                  setSearchParams(next, { replace: true });
                }
              }}
            />
          )}
          {currentStepDef?.id === "services" && (
            <StepServiceBilling
              data={serviceBilling}
              onChange={setServiceBilling}
              errors={serviceErrors}
              gstins={basicInfo.gstins}
              tanNumber={basicInfo.tan_number}
              workGroupType={advancedInfo.work_group_type}
              warnings={crossStepWarnings}
              onGoToStep={(idx) => setStep(idx)}
              firmId={loadedClientFirmId || effectiveFirmId || undefined}
            />
          )}
          {currentStepDef?.id === "audit" && (
            <StepAuditSetup data={auditSetup} onChange={setAuditSetup} />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      {/* Disable Next/Save when services step has unresolved cross-step dependency errors */}
      {(() => {
        const servicesBlocked = currentStepDef?.id === "services" && crossStepWarnings.length > 0;
        return (
          <div className="flex justify-between">
            {isEditMode ? (
              <>
                {/* ROOT CAUSE A fix: manual "Activate Client" override for API-imported drafts */}
                {isApiDraft ? (
                  <Button
                    variant="outline"
                    disabled={saving}
                    className="gap-2 border-green-400 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950/30"
                    onClick={async () => {
                      setSaving(true);
                      const promoted = await tryPromoteToFinal();
                      if (!promoted) {
                        toast({
                          title: "Client cannot be activated yet",
                          description: "Please save all required steps (Basic Info, Advanced Info, at least one Service) first.",
                          variant: "destructive",
                        });
                      }
                      setSaving(false);
                    }}
                  >
                    {saving ? "Checking…" : "✓ Activate Client"}
                  </Button>
                ) : (
                  <div />
                )}
                <Button onClick={saveCurrentStep} disabled={saving || servicesBlocked} className="gap-2">
                  <Save className="h-4 w-4" /> {saving ? "Saving…" : `Save ${currentStepDef?.label}`}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                  Previous
                </Button>
                <Button onClick={handleNext} disabled={saving || servicesBlocked}>
                  {step === visibleSteps.length - 1 ? (saving ? "Saving…" : "Create Client") : "Next"}
                </Button>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default NewClientWizard;
