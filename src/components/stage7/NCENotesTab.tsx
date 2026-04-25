/**
 * NCENotesTab — "Notes to Financial Statements" for non-corporate entities.
 *
 * Rendered inside Stage 7 Financial Statements when the engagement entity
 * type is non-corporate (Partnership, LLP, Proprietorship, HUF, Trust, …).
 *
 * Three sub-tabs reuse the Stage 8 components verbatim — same data source,
 * same Supabase tables, no duplication. Edits made here are reflected in
 * Stage 8 and vice versa.
 *
 * Styling matches UI-6 corporate sub-tabs (gap-1.5, size-14 icons) so the
 * NCE and corporate Notes panels feel like the same surface.
 *
 * Props
 *   engagementId — passed straight through to each sub-component.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, FileText, Building2 } from "lucide-react";
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
    <div className="space-y-3">

      {/* Header — typography aligned with Stage 7's other section labels */}
      <h2 className="text-base font-semibold tracking-tight text-foreground">
        Notes to Financial Statements
      </h2>

      {/* Sub-tabs */}
      <Tabs defaultValue="capital_account">
        <TabsList>
          <TabsTrigger value="capital_account" className="gap-1.5">
            <Wallet size={14} /> Capital Account
          </TabsTrigger>
          <TabsTrigger value="notes_to_accounts" className="gap-1.5">
            <FileText size={14} /> Notes to Accounts
          </TabsTrigger>
          <TabsTrigger value="ppe_schedule" className="gap-1.5">
            <Building2 size={14} /> PPE Schedule
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
