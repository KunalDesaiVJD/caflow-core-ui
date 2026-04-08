/**
 * AuditTracker — Page shell
 * Renders AuditTrackerLayout with firm/user context from auth.
 */
import { ClipboardCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import AuditTrackerLayout from "@/components/audit-tracker/AuditTrackerLayout";

export default function AuditTracker() {
  const { user } = useAuth();
  const firmId = user?.firm_id || "";
  const userId = user?.id      || "";

  if (!firmId) {
    return <div className="p-6 text-sm text-muted-foreground">Loading firm context…</div>;
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
          <ClipboardCheck size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Audit Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Plan, communicate, and track status across all audit engagements
          </p>
        </div>
      </div>

      <AuditTrackerLayout firmId={firmId} userId={userId} />
    </div>
  );
}
