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
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

import AuditWorksheetHeader from "./AuditWorksheetHeader";
import ExportButtons        from "./ExportButtons";
import TaxAuditMaster       from "./TaxAuditMaster";
import InternalAuditMaster  from "./InternalAuditMaster";
import SpecialAttention     from "./SpecialAttention";
import Worksheet            from "./Worksheet";
import QuerySheet           from "./QuerySheet";
import Checklist            from "./Checklist";

import { useAuditWorksheetData } from "./hooks/useAuditWorksheetData";
import { useWorksheetStorage }   from "./hooks/useWorksheetStorage";
import { useEmployeeDropdown }   from "./hooks/useEmployeeDropdown";

interface Props {
  engagementId: string;
}

export default function AuditWorksheetPage({ engagementId }: Props) {
  const data = useAuditWorksheetData(engagementId);

  const {
    master, setMaster, patchMaster, saveMaster, masterSaving, masterLoaded,
    allItems, getItemsBySheet, updateItem, addItem, deleteItem,
  } = useWorksheetStorage(engagementId, data.engagement?.firm_id);

  const { employees } = useEmployeeDropdown();

  // Determine which tabs to show
  const auditType   = data.auditType;
  const isCorporate = data.isCorporate;

  const showTaxMaster  = auditType === "tax_audit" || auditType === "both" || auditType === "statutory";
  const showIntMaster  = auditType === "internal";
  const showSpecial    = isCorporate;

  // Default first tab
  const defaultTab = showTaxMaster ? "tax_master"
    : showIntMaster              ? "int_master"
    : "worksheet";

  const [activeTab, setActiveTab] = useState(defaultTab);

  const worksheetItems      = getItemsBySheet("worksheet");
  const specialAttentionItems = getItemsBySheet("special_attention");
  const checklistItems      = getItemsBySheet("checklist");

  if (data.loading && !masterLoaded) {
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
          master={master}
          worksheetItems={worksheetItems}
          specialAttentionItems={specialAttentionItems}
          checklistItems={checklistItems}
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
              master={master}
              setMaster={setMaster}
              patchMaster={patchMaster}
              saveMaster={saveMaster}
              masterSaving={masterSaving}
              masterLoaded={masterLoaded}
            />
          </TabsContent>
        )}

        {/* ── Sheet 2: Internal Audit Master ── */}
        {showIntMaster && (
          <TabsContent value="int_master" className="mt-3">
            <InternalAuditMaster
              data={data}
              master={master}
              setMaster={setMaster}
              patchMaster={patchMaster}
              saveMaster={saveMaster}
              masterSaving={masterSaving}
              masterLoaded={masterLoaded}
            />
          </TabsContent>
        )}

        {/* ── Sheet 3: Special Attention ── */}
        {showSpecial && (
          <TabsContent value="special" className="mt-3">
            <SpecialAttention
              items={specialAttentionItems}
              updateItem={updateItem}
              addItem={addItem}
              deleteItem={deleteItem}
            />
          </TabsContent>
        )}

        {/* ── Sheet 4: Worksheet ── */}
        <TabsContent value="worksheet" className="mt-3">
          <Worksheet
            items={worksheetItems}
            employees={employees}
            updateItem={updateItem}
            addItem={addItem}
            deleteItem={deleteItem}
          />
        </TabsContent>

        {/* ── Sheet 5: Query Sheet ── */}
        <TabsContent value="queries" className="mt-3">
          <QuerySheet
            engagementId={engagementId}
            master={master}
            setMaster={setMaster}
            saveMaster={saveMaster}
            masterSaving={masterSaving}
          />
        </TabsContent>

        {/* ── Sheet 6: Checklist ── */}
        <TabsContent value="checklist" className="mt-3">
          <Checklist
            items={checklistItems}
            updateItem={updateItem}
            addItem={addItem}
            deleteItem={deleteItem}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
