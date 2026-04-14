import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ArrowRight } from "lucide-react";
import type { BasicInfoData } from "./StepBasicInfo";

interface Props {
  mode?: "create" | "edit";
  basicInfo: BasicInfoData;
  partnerName: string | null;
  saving: boolean;
  onSubmit: () => void;
}

export const StepDone = ({ mode = "create", basicInfo, partnerName, saving, onSubmit }: Props) => {
  const isEdit = mode === "edit";

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center gap-2">
        <CheckCircle2 className="h-12 w-12 text-green-600" />
        <h2 className="text-xl font-semibold text-foreground">
          {isEdit ? "Ready to Save Client Updates" : "Ready to Create Client"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isEdit
            ? "Review the full profile below, then save your changes."
            : "Review the summary below, then click Finish to save."}
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Client Name</span>
            <span className="font-medium text-foreground">{basicInfo.name || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Entity Type</span>
            <Badge variant="outline">{basicInfo.entity_type || "Not set"}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">PAN</span>
            <span className="font-mono text-sm">{basicInfo.pan || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Assigned Partner</span>
            <span className="text-sm">{partnerName || "Current user"}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-center">
        <Button onClick={onSubmit} disabled={saving} className="gap-2">
          {saving ? "Saving..." : isEdit ? "Save Changes & Return to Client" : "Finish & Go to Client Dashboard"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
