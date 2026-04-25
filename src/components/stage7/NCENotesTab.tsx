/**
 * NCENotesTab — "Notes to Financial Statements" for non-corporate entities.
 *
 * Rendered inside Stage 7 Financial Statements when the engagement entity
 * type is non-corporate (Partnership, LLP, Proprietorship, HUF, Trust, …).
 *
 * Three sub-tabs reuse the Stage 8 components verbatim — same data source,
 * same Supabase tables, no duplication.
 *
 * Props
 *   engagementId — passed straight through to each sub-component.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NCECapitalAccount } from "@/components/stage8/NCECapitalAccount";
import { NCEDetailedNotes }  from "@/components/stage8/NCEDetailedNotes";
import { NCEPPESchedule }    from "@/components/stage8/NCEPPESchedule";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NCENotesTab({ engagementId }: Props) {
  return (
    <div className="space-y-4">

      {/* Header */}
      <h2 className="text-base font-semibold tracking-tight">
        Notes to Financial Statements
      </h2>

      {/* Sub-tabs */}
      <Tabs defaultValue="capital_account">
        <TabsList>
          <TabsTrigger value="capital_account" className="text-xs">
            Capital Account
          </TabsTrigger>
          <TabsTrigger value="notes_to_accounts" className="text-xs">
            Notes to Accounts
          </TabsTrigger>
          <TabsTrigger value="ppe_schedule" className="text-xs">
            PPE Schedule
          </TabsTrigger>
        </TabsList>

        <TabsContent value="capital_account" className="mt-3">
          <NCECapitalAccount engagementId={engagementId} />
        </TabsContent>

        <TabsContent value="notes_to_accounts" className="mt-3">
          <NCEDetailedNotes engagementId={engagementId} />
        </TabsContent>

        <TabsContent value="ppe_schedule" className="mt-3">
          <NCEPPESchedule engagementId={engagementId} />
        </TabsContent>
      </Tabs>

    </div>
  );
}
