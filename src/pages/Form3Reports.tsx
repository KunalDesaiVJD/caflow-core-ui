/**
 * Form3Reports
 *
 * Shell for the tax audit reporting module (Stage 8).
 *
 * The Audit Report Form type (3CA+3CD vs 3CB+3CD) is AUTO-DETECTED from the
 * engagement's preliminary questionnaire answer (Stage 1 → Block A →
 * "Are accounts audited under any other act?") and the entity type:
 *
 *   Company entity              → always 3CA+3CD  (Companies Act audit)
 *   Non-company, answer = "yes" → 3CA+3CD          (audited under another law)
 *   Non-company, answer = "no"  → 3CB+3CD          (not audited under any other law)
 *   Preliminary question unanswered → amber warning + link to Engagement Setup
 *
 * There is NO manual radio selector — the form type is read-only.
 *
 * Two tabs are shown:
 *   [FORM 3CD]  [FORM 3CB]  or  [FORM 3CD]  [FORM 3CA]
 *
 * Receives engagementId via:
 *   - prop  `engagementIdProp` (when rendered inline from AuditPipeline Stage 8)
 *   - query param `?engagementId=…` (standalone route /audit/3reports)
 */
import { useState, useEffect }    from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase }               from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge }                  from "@/components/ui/badge";
import { Button }                 from "@/components/ui/button";
import { Loader2, AlertTriangle, Info } from "lucide-react";
import { cn }                     from "@/lib/utils";

import Form3CATab from "@/components/form3reports/Form3CATab";
import Form3CBTab from "@/components/form3reports/Form3CBTab";
import Form3CD    from "@/pages/Form3CD";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementIdProp?: string;
}

// ─── Company entity check (mirrors AuditPipeline logic) ───────────────────────

function isCompanyEntity(et: string | null | undefined): boolean {
  if (!et) return false;
  const s = et.toLowerCase().trim();
  return ["company", "private ltd", "public ltd", "opc", "pvt_ltd", "public_ltd"].includes(s);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Form3Reports({ engagementIdProp }: Props = {}) {
  const [searchParams]  = useSearchParams();
  const navigate        = useNavigate();
  const engagementId    = engagementIdProp || searchParams.get("engagementId") || "";

  // Derived from DB — never set manually
  const [formType,      setFormType]      = useState<"3ca" | "3cb" | null>(null);
  const [requires3CA,   setRequires3CA]   = useState<boolean | null>(null);
  const [requires3CB,   setRequires3CB]   = useState<boolean | null>(null);
  const [prelimMissing, setPrelimMissing] = useState(false);   // true → question not answered
  const [loading,       setLoading]       = useState(true);
  const [engagementPipelineId, setEngagementPipelineId] = useState<string>("");

  useEffect(() => {
    if (!engagementId) { setLoading(false); return; }

    supabase
      .from("audit_engagements")
      .select("id, requires_3ca, requires_3cb, entity_type, questionnaire_answers, clients(entity_type)")
      .eq("id", engagementId)
      .single()
      .then(({ data }) => {
        if (!data) { setLoading(false); return; }

        setEngagementPipelineId((data as any).id || "");

        const et =
          (data as any).entity_type ||
          ((data as any).clients as any)?.entity_type ||
          null;

        const isCompany = isCompanyEntity(et);

        const qa = (data as any).questionnaire_answers as Record<string, string> | null ?? {};
        const auditedUnderOtherAct = qa?.audited_under_other_act ?? null; // "yes" | "no" | null

        setRequires3CA(!!(data as any).requires_3ca);
        setRequires3CB(!!(data as any).requires_3cb);

        if (isCompany) {
          // Companies Act → always 3CA regardless of questionnaire answer
          setFormType("3ca");
          setPrelimMissing(false);
        } else if (auditedUnderOtherAct === "yes") {
          setFormType("3ca");
          setPrelimMissing(false);
        } else if (auditedUnderOtherAct === "no") {
          setFormType("3cb");
          setPrelimMissing(false);
        } else {
          // Preliminary question not yet answered in Stage 1
          // Fall back to requires_3ca / requires_3cb if already saved
          if ((data as any).requires_3ca) {
            setFormType("3ca");
            setPrelimMissing(false);
          } else if ((data as any).requires_3cb) {
            setFormType("3cb");
            setPrelimMissing(false);
          } else {
            setFormType(null);
            setPrelimMissing(true);
          }
        }

        setLoading(false);
      });
  }, [engagementId]);

  // ─── No engagement selected ──────────────────────────────────────────────

  if (!engagementId) {
    return (
      <div className="p-10 text-center text-muted-foreground text-sm">
        Please open the 3CA / 3CB / 3CD module from an engagement pipeline (Stage 8).
      </div>
    );
  }

  // ─── Loading ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading engagement…</span>
      </div>
    );
  }

  // ─── Preliminary answer missing → amber warning ───────────────────────────

  if (prelimMissing) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3.5">
          <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-amber-800">
              Audit Report Form type not determined
            </p>
            <p className="text-xs text-amber-700">
              The preliminary question <em>"Are the accounts audited under any other law?"</em> has not been
              answered in Engagement Setup (Stage 1 → Block A → Legal &amp; Constitution).
              Answer that question to auto-determine whether Form 3CA+3CD or 3CB+3CD applies.
            </p>
            {engagementPipelineId && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1 h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
                onClick={() => navigate(`/audit/pipeline/${engagementPipelineId}?stage=1`)}
              >
                Go to Engagement Setup
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Derived labels ───────────────────────────────────────────────────────

  const isCA         = formType === "3ca";
  const formLabel    = isCA ? "3CA+3CD" : "3CB+3CD";
  const formTabLabel = isCA ? "FORM 3CA" : "FORM 3CB";
  const formRequired = isCA ? requires3CA : requires3CB;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Read-only form type indicator ──────────────────────────────────── */}
      <div className="flex items-center gap-2 px-1 print:hidden">
        <span className="text-sm text-muted-foreground font-medium">Audit Report Form:</span>
        <span className={cn(
          "text-sm font-semibold",
          isCA ? "text-indigo-700" : "text-emerald-700",
        )}>
          {formLabel}
        </span>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Info size={11} className="inline" />
          auto-detected from Engagement Setup
        </span>
      </div>

      {/* ── Two-tab shell ──────────────────────────────────────────────────── */}
      {/* Tab order: [FORM 3CB / FORM 3CA]  [FORM 3CD]                        */}
      <Tabs defaultValue="form" className="w-full">

        <TabsList className="h-auto gap-1 mb-4">

          {/* Tab 1 — Form 3CB or 3CA (determined by engagement setup) */}
          <TabsTrigger value="form" className="text-xs gap-1.5">
            {formTabLabel}
            {!loading && formRequired === true && (
              <Badge className="h-4 text-[9px] px-1 bg-indigo-600 text-white ml-1">
                Required
              </Badge>
            )}
            {!loading && formRequired === false && (
              <Badge variant="outline" className="h-4 text-[9px] px-1 ml-1 text-muted-foreground">
                Optional
              </Badge>
            )}
          </TabsTrigger>

          {/* Tab 2 — Form 3CD */}
          <TabsTrigger value="3cd" className="text-xs">
            FORM 3CD
          </TabsTrigger>

        </TabsList>

        {/* ── Tab 1: Form 3CD (existing — untouched) ── */}
        <TabsContent value="3cd">
          <Form3CD engagementIdProp={engagementId} />
        </TabsContent>

        {/* ── Tab 2: Form 3CB or 3CA — auto-selected, no manual override ── */}
        <TabsContent value="form">
          {isCA
            ? <Form3CATab engagementId={engagementId} />
            : <Form3CBTab engagementId={engagementId} />
          }
        </TabsContent>

      </Tabs>
    </div>
  );
}
