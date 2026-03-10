import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuditMovedBannerProps {
  redirectTo?: string;
}

export function AuditMovedBanner({ redirectTo = "/audit" }: AuditMovedBannerProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <div className="flex items-center gap-3 px-6 py-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
        <AlertTriangle size={20} />
        <span className="text-sm font-medium">This section has moved to Audit Intelligence →</span>
      </div>
      <Button onClick={() => navigate(redirectTo)} className="gap-2">
        Go to Audit Intelligence <ArrowRight size={16} />
      </Button>
    </div>
  );
}
