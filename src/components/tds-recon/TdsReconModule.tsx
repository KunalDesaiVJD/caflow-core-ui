/**
 * TdsReconModule
 *
 * Three-tab shell for the TDS Analytics & Reconciliation sub-module.
 *
 *   Tab 1 — Party Mappings   (TDS-2) AI matching TB ledgers ↔ TDS deductees
 *   Tab 2 — Reconciliation   (TDS-3) Goal 1 existence + Goal 2 rate analysis
 *   Tab 3 — Missing TDS      (TDS-4) Goal 3 unmapped-ledger obligation scanner
 */
import { useState } from "react";
import { Link2, GitCompareArrows, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TdsPartyMappingPanel } from "./TdsPartyMappingPanel";
import { TdsReconFlagsPanel }  from "./TdsReconFlagsPanel";
import { TdsMissingPanel }     from "./TdsMissingPanel";

type TdsTab = "mappings" | "recon" | "missing";

interface Props {
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
}

const TABS: Array<{ id: TdsTab; label: string; icon: React.ReactNode; phase: string }> = [
  { id: "mappings", label: "Party Mappings",  icon: <Link2 size={13} />,           phase: "TDS-2" },
  { id: "recon",    label: "Reconciliation",  icon: <GitCompareArrows size={13} />, phase: "TDS-3" },
  { id: "missing",  label: "Missing TDS",     icon: <AlertOctagon size={13} />,     phase: "TDS-4" },
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
              activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            )}>
              {tab.phase}
            </span>
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {activeTab === "mappings" && <TdsPartyMappingPanel clientId={clientId} financialYear={financialYear} />}
      {activeTab === "recon"    && <TdsReconFlagsPanel   clientId={clientId} financialYear={financialYear} />}
      {activeTab === "missing"  && <TdsMissingPanel      clientId={clientId} financialYear={financialYear} />}
    </div>
  );
}
