import { RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { SyncProgress } from "./useCustomerSync";

interface Props {
  progress: SyncProgress;
}

export function CustomerSyncProgress({ progress }: Props) {
  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="py-8 space-y-5">
      <div className="flex items-center gap-3">
        <RefreshCw className="h-5 w-5 text-primary animate-spin shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold">
            Importing… {progress.current} / {progress.total}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Do not close this window.
          </p>
        </div>
      </div>
      <Progress value={pct} className="h-2.5" />
      <p className="text-xs text-right text-muted-foreground tabular-nums">{pct}%</p>
    </div>
  );
}
