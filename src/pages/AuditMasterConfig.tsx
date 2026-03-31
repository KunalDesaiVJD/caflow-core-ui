import { MasterConfigPanel } from "@/components/pipeline/MasterConfigPanel";

export default function AuditMasterConfig() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Master Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Global templates — changes here apply as defaults for all firms and all future engagements.
        </p>
      </div>
      <MasterConfigPanel />
    </div>
  );
}
