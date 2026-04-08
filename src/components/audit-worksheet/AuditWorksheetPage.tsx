/**
 * AuditWorksheetPage
 *
 * Main shell for the Audit Worksheet module.
 * Tabs: Tax Audit Master | Internal Audit Master | Special Attention | Worksheet | Query Sheet | Checklist
 * Tabs shown conditionally based on audit_type and isCorporate.
 *
 * Usage:
 *   <AuditWorksheetPage engagementId={id} />
 */
import { useState, useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

import AuditWorksheetHeader  from "./AuditWorksheetHeader";
import ExportButtons         from "./ExportButtons";
import TaxAuditMaster        from "./TaxAuditMaster";
import StatutoryAuditMaster  from "./StatutoryAuditMaster";
import InternalAuditMaster   from "./InternalAuditMaster";
import SpecialAttention      from "./SpecialAttention";
import Worksheet             from "./Worksheet";
import QuerySheet            from "./QuerySheet";
import Checklist             from "./Checklist";

import { useAuditWorksheetData } from "./hooks/useAuditWorksheetData";
import { BLANK_MASTER }          from "./hooks/useWorksheetStorage";

interface Props {
  engagementId: string;
}

export default function AuditWorksheetPage({ engagementId }: Props) {
  const data = useAuditWorksheetData(engagementId);

  // Determine which tabs to show
  const auditType = data.auditType;

  // Issue #9: Tax Audit Master → only for tax_audit | both (not statutory)
  const showTaxMaster        = auditType === "tax_audit" || auditType === "both";
  // Issue #9: Statutory Audit Master → only for statutory | both
  const showStatutoryMaster  = auditType === "statutory" || auditType === "both";
  const showIntMaster        = auditType === "internal";

  // Special Attention tab visibility + filter rules:
  //   statutory              → show, all 10 points  (taxAuditMode=false)
  //   tax_audit  + corporate → show, all 10 points  (taxAuditMode=false)
  //   tax_audit  + non-corp  → show, 9 points only  (taxAuditMode=true  → section 10 hidden)
  //   internal / stock       → hidden
  const showSpecial  = data.isPrivateOrPublicLtd || auditType === "tax_audit" || auditType === "both" || auditType === "statutory";
  const taxAuditMode = (auditType === "tax_audit" || auditType === "both") && !data.isPrivateOrPublicLtd;

  // Default first tab
  const defaultTab = showTaxMaster       ? "tax_master"
    : showStatutoryMaster                ? "statutory_master"
    : showIntMaster                      ? "int_master"
    : "worksheet";

  const [activeTab, setActiveTab] = useState(defaultTab);

  // Correct the active tab once engagement data finishes loading.
  // On first render data.auditType is "" (queries still in flight), so
  // defaultTab evaluates to "worksheet". This effect fires once after the
  // async queries resolve and snaps to the correct first tab.
  const tabInitialized = useRef(false);
  useEffect(() => {
    if (!data.loading && data.auditType && !tabInitialized.current) {
      tabInitialized.current = true;
      setActiveTab(defaultTab);
    }
  }, [data.loading, data.auditType]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data.loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (data.error) {
    return (
      <Alert variant="destructive" className="m-4">
        <AlertTriangle size={16} />
        <AlertDescription>{data.error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <AuditWorksheetHeader data={data} />

      {/* ── Export Buttons ── */}
      <div className="flex justify-end">
        <ExportButtons
          data={data}
          master={BLANK_MASTER}
          worksheetItems={[]}
          specialAttentionItems={[]}
          checklistItems={[]}
        />
      </div>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          {showTaxMaster && (
            <TabsTrigger value="tax_master" className="text-xs">
              Tax Audit Master
            </TabsTrigger>
          )}
          {showStatutoryMaster && (
            <TabsTrigger value="statutory_master" className="text-xs">
              Statutory Audit Master
            </TabsTrigger>
          )}
          {showIntMaster && (
            <TabsTrigger value="int_master" className="text-xs">
              Internal Audit Master
            </TabsTrigger>
          )}
          {showSpecial && (
            <TabsTrigger value="special" className="text-xs">
              Special Attention
            </TabsTrigger>
          )}
          <TabsTrigger value="worksheet" className="text-xs">
            Audit Worksheet
          </TabsTrigger>
          <TabsTrigger value="queries" className="text-xs">
            Query Sheet
          </TabsTrigger>
          <TabsTrigger value="checklist" className="text-xs">
            Checklist
          </TabsTrigger>
        </TabsList>

        {/* ── Sheet 1: Tax Audit Master ── */}
        {showTaxMaster && (
          <TabsContent value="tax_master" className="mt-3">
            <TaxAuditMaster
              data={data}
              engagementId={engagementId}
            />
          </TabsContent>
        )}

        {/* ── Sheet 1b: Statutory Audit Master ── */}
        {showStatutoryMaster && (
          <TabsContent value="statutory_master" className="mt-3">
            <StatutoryAuditMaster
              data={data}
              engagementId={engagementId}
            />
          </TabsContent>
        )}

        {/* ── Sheet 2: Internal Audit Master ── */}
        {showIntMaster && (
          <TabsContent value="int_master" className="mt-3">
            <InternalAuditMaster
              data={data}
              engagementId={engagementId}
            />
          </TabsContent>
        )}

        {/* ── Sheet 3: Special Attention ── */}
        {showSpecial && (
          <TabsContent value="special" className="mt-3">
            <SpecialAttention
              data={data}
              engagementId={engagementId}
              taxAuditMode={taxAuditMode}
            />
          </TabsContent>
        )}

        {/* ── Sheet 4: Worksheet ── */}
        <TabsContent value="worksheet" className="mt-3">
          <Worksheet
            data={data}
            engagementId={engagementId}
          />
        </TabsContent>

        {/* ── Sheet 5: Query Sheet ── */}
        <TabsContent value="queries" className="mt-3">
          <QuerySheet
            data={data}
            engagementId={engagementId}
          />
        </TabsContent>

        {/* ── Sheet 6: Checklist ── */}
        <TabsContent value="checklist" className="mt-3">
          <Checklist
            data={data}
            engagementId={engagementId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
