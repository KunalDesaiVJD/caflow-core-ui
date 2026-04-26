import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Award, ClipboardList } from "lucide-react";
import { NCEClientCertificate } from "@/components/stage8/NCEClientCertificate";
import { NCEManagementLetter } from "@/components/stage8/NCEManagementLetter";
import { NCENotesToAccounts } from "@/components/stage7/NotesToAccounts";
import { CorporateNTA } from "./CorporateNTA";

// Exact entity_type values stored in audit_engagements that indicate non-corporate.
// isCompanyEntity() in entityUtils.ts is the canonical test for the corporate side;
// this list covers the NCE side explicitly so the Stage 8 tab structure can be
// activated without importing a utility that doesn't cover all NCE variants.
const NON_CORPORATE_TYPES: string[] = [
  "Partnership",
  "LLP",
  "Proprietorship",
  "Sole Proprietorship",
  "HUF",
  "Trust",
  "AOP",
  "BOI",
  "Individual",
  "Hindu Undivided Family",
  "Limited Liability Partnership",
  "Association of Persons",
  "Body of Individuals",
];

interface Props {
  engagement: any;
  client: any;
  onUpdate: () => void;
  /** Fix (Issue 4): when false, corporate-only notes (Corporate Info, EPS, CSR) are hidden */
  isCorporate?: boolean;
}

export function EngagementNotesToAccounts({ engagement, client, onUpdate, isCorporate = true }: Props) {
  const engagementId: string = engagement?.id || "";

  // ── NCE detection ─────────────────────────────────────────────────────────
  // Two-source truth: trust the isCorporate prop from EngagementDetail (already
  // correctly computed there) OR fall back to the entity_type string check.
  //
  // Why both? engagement.entity_type can be NULL for older engagements that
  // were created before the field was populated — the string check alone fails
  // in that case. The isCorporate prop is always reliable because EngagementDetail
  // computes it from both engagement.entity_type AND client.entity_type.
  //
  // Rule: NCE tabs show when the caller says NOT corporate, OR the entity_type
  // string is in the NCE list. Corporate path delegates to <CorporateNTA />.
  const entityType: string = (
    engagement?.entity_type ||
    engagement?.clients?.entity_type ||
    client?.entity_type ||
    ""
  ).trim();
  const isNonCorporate: boolean =
    !isCorporate ||
    NON_CORPORATE_TYPES.some(t => t.toLowerCase() === entityType.toLowerCase());

  // ── Empty-state guard ─────────────────────────────────────────────────────
  if (!engagementId) {
    return (
      <div className="flex items-center justify-center py-20 border rounded-lg bg-muted/30">
        <p className="text-sm text-muted-foreground">
          Select an engagement from Engagement Setup to begin Notes to Accounts.
        </p>
      </div>
    );
  }

  // ── NCE: wrap in 3-tab structure ──────────────────────────────────────────
  // UI-7 cleanup — Capital Account, Notes to Accounts, and PPE Schedule have
  // been moved to Stage 7 → Notes (NCENotesTab). Stage 8 now only carries
  // Note 1 + the two engagement letters.
  if (isNonCorporate) {
    return (
      <Tabs defaultValue="notes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="notes" className="gap-1.5">
            <FileText size={13} /> Note 1
          </TabsTrigger>
          <TabsTrigger value="client-certificate" className="gap-1.5">
            <Award size={13} /> Client Certificate
          </TabsTrigger>
          <TabsTrigger value="management-letter" className="gap-1.5">
            <ClipboardList size={13} /> Management Letter
          </TabsTrigger>
        </TabsList>

        {/* Tab 1 — NCE notes (Balance Confirmation, Rearrangement of Figures, etc.) */}
        <TabsContent value="notes">
          <NCENotesToAccounts engagementId={engagementId} engagement={engagement} />
        </TabsContent>

        {/* Tab 2 — Client Certificate */}
        <TabsContent value="client-certificate">
          <NCEClientCertificate engagementId={engagementId} />
        </TabsContent>

        {/* Tab 3 — Management Letter */}
        <TabsContent value="management-letter">
          <NCEManagementLetter engagementId={engagementId} />
        </TabsContent>
      </Tabs>
    );
  }

  // ── Corporate: delegate to new single-page CorporateNTA editor ───────────
  return <CorporateNTA engagement={engagement} client={client} onUpdate={onUpdate} />;
}

// ═══════════════════════════════════════════════════════════════════════════
// NCE Tab implementations
// NCEClientCertificate  — @/components/stage8/NCEClientCertificate
// NCEManagementLetter   — @/components/stage8/NCEManagementLetter
// ═══════════════════════════════════════════════════════════════════════════
