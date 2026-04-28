/**
 * TdsReconModule  (Phase TDS-2 shell)
 *
 * Three-tab container for the TDS Analytics & Reconciliation sub-module
 * inside the Scrutiny Engine.
 *
 *   Tab 1 — Party Mappings   (Phase TDS-2, active)
 *   Tab 2 — Reconciliation   (Phase TDS-3/4, placeholder)
 *   Tab 3 — Missing TDS      (Phase TDS-5, placeholder)
 */
import { useState } from "react";
import { Link2, GitCompareArrows, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TdsPartyMappingPanel }  from "./TdsPartyMappingPanel";
import { TdsReconFlagsPanel }   from "./TdsReconFlagsPanel";

type TdsTab = "mappings" | "recon" | "missing";

interface Props {
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
}

const TABS: Array<{ id: TdsTab; label: string; icon: React.ReactNode; phase: string }> = [
  {
    id:    "mappings",
    label: "Party Mappings",
    icon:  <Link2 size={13} />,
    phase: "TDS-2",
  },
  {
    id:    "recon",
    label: "Reconciliation",
    icon:  <GitCompareArrows size={13} />,
    phase: "TDS-3",
  },
  {
    id:    "missing",
    label: "Missing TDS",
    icon:  <AlertOctagon size={13} />,
    phase: "TDS-5",
  },
];

export function TdsReconModule({ clientId, financialYear }: Props) {
  const [activeTab, setActiveTab] = useState<TdsTab>("mappings");

  return (
    <div className="space-y-4">

      {/* ── Module header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold">TDS Analytics &amp; Reconciliation</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            AI-powered reconciliation of Trial Balance ledgers against TDS Management records.
          </p>
        </div>
        {financialYear && (
          <span className="text-[10px] bg-muted border rounded px-2 py-0.5 text-muted-foreground">
            FY {financialYear}
          </span>
        )}
      </div>

      {/* ── Tab strip ── */}
      <div className="flex gap-0 border-b">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30",
            )}
          >
            {tab.icon}
            {tab.label}
            <span className={cn(
              "text-[9px] px-1 py-0.5 rounded font-mono",
              activeTab === tab.id
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}>
              {tab.phase}
            </span>
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}

      {activeTab === "mappings" && (
        <TdsPartyMappingPanel clientId={clientId} financialYear={financialYear} />
      )}

      {activeTab === "recon" && (
        <TdsReconFlagsPanel clientId={clientId} financialYear={financialYear} />
      )}

      {activeTab === "missing" && (
        <PlaceholderPanel
          icon={<AlertOctagon size={32} className="text-muted-foreground/25" />}
          title="Missing TDS Obligations"
          description="Phase TDS-5 will scan all unmapped Trial Balance ledgers for potential TDS obligations that have not been reported, using section heuristics and AI pattern recognition."
          phase="TDS-5"
        />
      )}
    </div>
  );
}

// ─── Placeholder for upcoming phases ─────────────────────────────────────────

function PlaceholderPanel({
  icon, title, description, phase,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-52 gap-3 text-center border rounded-lg border-dashed">
      {icon}
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{description}</p>
        <span className="inline-block mt-2 text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded font-mono">
          Coming in Phase {phase}
        </span>
      </div>
    </div>
  );
}
