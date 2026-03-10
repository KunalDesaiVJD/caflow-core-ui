import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpCircle } from "lucide-react";

export default function AuditPreliminary() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Preliminary Questions</h1>
        <p className="text-sm text-muted-foreground">Pre-engagement questionnaire to determine audit scope and applicable modules</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><HelpCircle className="h-4 w-4" /> Questionnaire</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select a client and engagement to begin the preliminary questionnaire. This will determine which audit tabs (CARO, Notes, etc.) are enabled.</p>
        </CardContent>
      </Card>
    </div>
  );
}
