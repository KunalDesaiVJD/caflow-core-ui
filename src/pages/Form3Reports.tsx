/**
 * Form3Reports
 *
 * Shell for the tax audit reporting module.
 *
 * A radio selector at the top lets the user choose between:
 *   ● 3CB+3CD  — Form 3CB (persons not audited under any other law)
 *   ○ 3CA+3CD  — Form 3CA (entities audited under Companies Act / other law)
 *
 * Two tabs are shown:
 *   [FORM 3CD]  [FORM 3CB]  or  [FORM 3CD]  [FORM 3CA]
 *
 * The 3CB / 3CA tab renders the full form + annexure in one continuous scroll.
 * The 3CD tab is unchanged.
 *
 * Receives engagementId via:
 *   - prop  `engagementIdProp` (when rendered inline from AuditPipeline Stage 8)
 *   - query param `?engagementId=…` (standalone route /audit/3reports)
 */
import { useState, useEffect } from "react";
import { useSearchParams }     from "react-router-dom";
import { supabase }            from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge }               from "@/components/ui/badge";
import { Loader2 }             from "lucide-react";

import Form3CATab from "@/components/form3reports/Form3CATab";
import Form3CBTab from "@/components/form3reports/Form3CBTab";
import Form3CD    from "@/pages/Form3CD";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementIdProp?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Form3Reports({ engagementIdProp }: Props = {}) {
  const [searchParams] = useSearchParams();
  const engagementId   = engagementIdProp || searchParams.get("engagementId") || "";

  const [auditType,    setAuditType]    = useState<"3cb" | "3ca">("3cb");
  const [requires3CA,  setRequires3CA]  = useState<boolean | null>(null);
  const [requires3CB,  setRequires3CB]  = useState<boolean | null>(null);
  const [entityType,   setEntityType]   = useState<string | null>(null);
  const [flagsLoading, setFlagsLoading] = useState(true);

  // Load flags + entity type, then default auditType for Company entities
  useEffect(() => {
    if (!engagementId) { setFlagsLoading(false); return; }
    supabase
      .from("audit_engagements")
      .select("requires_3ca, requires_3cb, clients(entity_type)")
      .eq("id", engagementId)
      .single()
      .then(({ data }) => {
        if (data) {
          setRequires3CA(!!(data as any).requires_3ca);
          setRequires3CB(!!(data as any).requires_3cb);
          const et = ((data as any).clients as any)?.entity_type ?? null;
          const etLower = typeof et === "string" ? et.toLowerCase() : null;
          setEntityType(etLower);
          // Companies Act audit → always 3CA
          if (etLower === "company") setAuditType("3ca");
        }
        setFlagsLoading(false);
      });
  }, [engagementId]);

  // Company entities must use 3CA — hide the 3CB option
  const isCompany = entityType === "company";

  if (!engagementId) {
    return (
      <div className="p-10 text-center text-muted-foreground text-sm">
        Please open the 3CA / 3CB / 3CD module from an engagement pipeline (Stage 8).
      </div>
    );
  }

  const formTabLabel = auditType === "3cb" ? "FORM 3CB" : "FORM 3CA";
  const formRequired = auditType === "3cb" ? requires3CB : requires3CA;

  return (
    <div className="space-y-4">

      {/* ── Audit Report Type Selector ─────────────────────────────────────── */}
      <div className="flex items-center gap-5 px-1 print:hidden">
        <span className="text-sm text-muted-foreground font-medium">Audit Report Form:</span>

        {!isCompany && (
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <input
              type="radio"
              name="auditType"
              value="3cb"
              checked={auditType === "3cb"}
              onChange={() => setAuditType("3cb")}
              className="accent-indigo-600 h-3.5 w-3.5"
            />
            <span className={auditType === "3cb" ? "font-medium" : "text-muted-foreground"}>
              3CB+3CD
            </span>
          </label>
        )}

        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
          <input
            type="radio"
            name="auditType"
            value="3ca"
            checked={auditType === "3ca"}
            onChange={() => setAuditType("3ca")}
            className="accent-indigo-600 h-3.5 w-3.5"
          />
          <span className={auditType === "3ca" ? "font-medium" : "text-muted-foreground"}>
            3CA+3CD
          </span>
        </label>

        {isCompany && (
          <span className="text-xs text-muted-foreground italic">
            (Company entity — Form 3CA applicable)
          </span>
        )}
      </div>

      {/* ── Two-tab shell ──────────────────────────────────────────────────── */}
      {/* Tab order: [FORM 3CD]  [FORM 3CB / FORM 3CA]                        */}
      {/* Default: form tab so the audit report is front-and-centre            */}
      <Tabs defaultValue="form" className="w-full">

        <TabsList className="h-auto gap-1 mb-4">

          {/* Tab 1 — Form 3CD */}
          <TabsTrigger value="3cd" className="text-xs">
            FORM 3CD
          </TabsTrigger>

          {/* Tab 2 — Form 3CB or 3CA (switches with radio) */}
          <TabsTrigger value="form" className="text-xs gap-1.5">
            {formTabLabel}
            {!flagsLoading && formRequired === true && (
              <Badge className="h-4 text-[9px] px-1 bg-indigo-600 text-white ml-1">
                Required
              </Badge>
            )}
            {!flagsLoading && formRequired === false && (
              <Badge variant="outline" className="h-4 text-[9px] px-1 ml-1 text-muted-foreground">
                Optional
              </Badge>
            )}
          </TabsTrigger>

        </TabsList>

        {/* ── Tab 1: Form 3CD (existing — untouched) ── */}
        <TabsContent value="3cd">
          <Form3CD engagementIdProp={engagementId} />
        </TabsContent>

        {/* ── Tab 2: Form 3CB or 3CA — full form + annexure, natural page scroll ── */}
        <TabsContent value="form">
          {auditType === "3cb"
            ? <Form3CBTab engagementId={engagementId} />
            : <Form3CATab engagementId={engagementId} />
          }
        </TabsContent>

      </Tabs>
    </div>
  );
}
