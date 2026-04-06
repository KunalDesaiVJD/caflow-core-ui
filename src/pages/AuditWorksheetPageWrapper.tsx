/**
 * AuditWorksheetPageWrapper
 * Route page for /audit/:engagementId/worksheet
 * Wraps AuditWorksheetPage with a full-page layout + back navigation.
 */
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import AuditWorksheetPage from "@/components/audit-worksheet/AuditWorksheetPage";

export default function AuditWorksheetPageWrapper() {
  const { engagementId } = useParams<{ engagementId: string }>();
  const navigate = useNavigate();

  if (!engagementId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No engagement ID provided.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-4 space-y-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={15} /> Back
        </Button>
        <h1 className="text-lg font-bold text-foreground">Audit Worksheet</h1>
      </div>

      <AuditWorksheetPage engagementId={engagementId} />
    </div>
  );
}
