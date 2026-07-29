/**
 * PortalTdsModule — the client portal's TDS module.
 *
 * ONE portal tab ("TDS") containing exactly two sub-tabs:
 *
 *   1. Data Entry  — read-only view of the entity's own filed return data
 *   2. Correction  — raise and track corrections to those filed returns
 *
 * Nothing else in the portal changes: Home, Queries and Documents are
 * untouched, and this module adds no third tab. Same sub-tab shell the staff
 * side uses (TDS Workspace, Audit & Overrides) so the two feel alike.
 *
 * Both children stay MOUNTED and hidden rather than unmounting on switch, so
 * the Data Entry period selection and the correction list survive a hop
 * between tabs — and the Data Entry realtime subscription is not torn down and
 * rebuilt every time.
 *
 * ISOLATION: every query in both children is scoped to the entity chosen in
 * the portal switcher, but the real boundary is RLS —
 * 20260729160000 (own-rows-only reads on tds_filings/_challans/_deductees/
 * _entries, all client writes blocked) and 20260729170000 (corrections
 * readable/writable only for the caller's own client ids, signing columns
 * blocked). Verified live: a client login sees 32 of 995 filings, 4 of 91
 * clients, and 0 rows in the recon / PAN / Tally / audit tables.
 */
import { useState } from "react";
import { usePortalClient } from "@/contexts/PortalClientContext";
import { cn } from "@/lib/utils";
import { Receipt, PenLine, FileEdit } from "lucide-react";
import PortalTds from "./PortalTds";
import PortalCorrections from "./PortalCorrections";

type TdsTab = "data-entry" | "correction";

export default function PortalTdsModule() {
  const { activeClient } = usePortalClient();
  const [tab, setTab] = useState<TdsTab>("data-entry");

  const TABS: { key: TdsTab; label: string; icon: typeof PenLine }[] = [
    { key: "data-entry", label: "Data Entry", icon: PenLine },
    { key: "correction", label: "Correction", icon: FileEdit },
  ];

  return (
    <div className="space-y-4">
      {/* Module header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt size={22} className="text-amber-600" />
          TDS
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {activeClient?.name
            ? <>Your TDS returns for <span className="font-medium">{activeClient.name}</span>.</>
            : "Your TDS returns."}
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-2">
              <Icon size={14} /> {label}
            </span>
          </button>
        ))}
      </div>

      {/* Kept mounted so tab state — and the Data Entry live subscription —
          survives switching. */}
      <div className={tab === "data-entry" ? "" : "hidden"}>
        <PortalTds />
      </div>
      <div className={tab === "correction" ? "" : "hidden"}>
        <PortalCorrections />
      </div>
    </div>
  );
}
