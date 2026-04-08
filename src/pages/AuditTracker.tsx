/**
 * AuditTracker — Page shell
 * Renders AuditTrackerLayout with firm/user context from auth.
 */
import { ClipboardCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import AuditTrackerLayout from "@/components/audit-tracker/AuditTrackerLayout";

export default function AuditTracker() {
  const { user, loading } = useAuth();
  const firmId = user?.firm_id || "";
  const userId = user?.id      || "";

  // Still resolving session / profile — show spinner
  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading firm context…
      </div>
    );
  }

  // Session resolved but this account has no firm_id assigned
  if (!firmId) {
    return (
      <div className="p-6 space-y-1">
        <p className="text-sm font-medium text-destructive">No firm assigned to this account.</p>
        <p className="text-xs text-muted-foreground">
          Your user profile does not have a firm linked. Please ask a Superadmin to assign a firm via{" "}
          <span className="font-medium">Firm Management → User Management</span>, then log out and back in.
        </p>
      </div>
    );
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
