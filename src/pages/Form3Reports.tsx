/**
 * Form3Reports
 *
 * Three-tab shell for the tax audit reporting module:
 *   Tab 1 — 3CA  (Form 3CA + Annexure)
 *   Tab 2 — 3CB  (Form 3CB + Annexure)
 *   Tab 3 — 3CD  (existing Form 3CD component — untouched)
 *
 * Receives engagementId via:
 *   - prop  `engagementIdProp` (when rendered inline from AuditPipeline Stage 8)
 *   - query param `?engagementId=…` (standalone route /audit/3reports)
 *
 * The engagement's `requires_3ca` / `requires_3cb` flags are used to
 * badge the tabs as required/optional, but all three tabs are always
 * accessible so users are never blocked.
 */
import { useState, useEffect } from "react";
import { useSearchParams }     from "react-router-dom";
import { supabase }            from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge }               from "@/components/ui/badge";
import { Loader2 }             from "lucide-react";
import { ScrollArea }          from "@/components/ui/scroll-area";

import Form3CATab from "@/components/form3reports/Form3CATab";
import Form3CBTab from "@/components/form3reports/Form3CBTab";
import Form3CD    from "@/pages/Form3CD";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementIdProp?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Form3Reports({ engagementIdProp }: Props = {}) {
  const [searchParams]  = useSearchParams();
  const engagementId    = engagementIdProp || searchParams.get("engagementId") || "";

  const [requires3CA, setRequires3CA] = useState<boolean | null>(null);
  const [requires3CB, setRequires3CB] = useState<boolean | null>(null);
  const [entityType,  setEntityType]  = useState<string | null>(null);
  const [flagsLoading, setFlagsLoading] = useState(true);

  // Load requires_3ca / requires_3cb flags + entity_type from the engagement
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
          setEntityType(typeof et === "string" ? et.toLowerCase() : null);
        }
        setFlagsLoading(false);
      });
  }, [engagementId]);

  // Companies (audited under Companies Act) only use Form 3CA — never 3CB
  const isCompany = entityType === "company";

  if (!engagementId) {
    return (
      <div className="p-10 text-center text-muted-foreground text-sm">
        Please open the 3CA / 3CB / 3CD module from an engagement pipeline (Stage 8).
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <Tabs defaultValue="3ca" className="w-full">

        {/* Tab strip */}
        <TabsList className="h-auto gap-1 mb-4">

          <TabsTrigger value="3ca" className="text-xs gap-1.5">
            Form 3CA
            {!flagsLoading && requires3CA === true && (
              <Badge className="h-4 text-[9px] px-1 bg-indigo-600 text-white ml-1">Required</Badge>
            )}
            {!flagsLoading && requires3CA === false && (
              <Badge variant="outline" className="h-4 text-[9px] px-1 ml-1 text-muted-foreground">Optional</Badge>
            )}
          </TabsTrigger>

          {/* Form 3CB — hidden for Company entities (Companies Act audit uses 3CA only) */}
          {!isCompany && (
            <TabsTrigger value="3cb" className="text-xs gap-1.5">
              Form 3CB
              {!flagsLoading && requires3CB === true && (
                <Badge className="h-4 text-[9px] px-1 bg-indigo-600 text-white ml-1">Required</Badge>
              )}
              {!flagsLoading && requires3CB === false && (
                <Badge variant="outline" className="h-4 text-[9px] px-1 ml-1 text-muted-foreground">Optional</Badge>
              )}
            </TabsTrigger>
          )}

          <TabsTrigger value="3cd" className="text-xs gap-1.5">
            Form 3CD
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Form 3CA ── */}
        <TabsContent value="3ca">
          <ScrollArea className="h-[calc(100vh-220px)]">
            <div className="pr-3">
              <Form3CATab engagementId={engagementId} />
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Tab 2: Form 3CB — only for non-Company entities ── */}
        {!isCompany && (
          <TabsContent value="3cb">
            <ScrollArea className="h-[calc(100vh-220px)]">
              <div className="pr-3">
                <Form3CBTab engagementId={engagementId} />
              </div>
            </ScrollArea>
          </TabsContent>
        )}

        {/* ── Tab 3: Form 3CD (existing — untouched) ── */}
        <TabsContent value="3cd">
          {/* Form3CD manages its own scroll internally */}
          <Form3CD engagementIdProp={engagementId} />
        </TabsContent>

      </Tabs>
    </div>
  );
}
