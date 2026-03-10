import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileOutput } from "lucide-react";

export default function AuditReportEngine() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Audit Report</h1>
        <p className="text-sm text-muted-foreground">Generate and manage audit reports with AI-assisted drafting</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><FileOutput className="h-4 w-4" /> Report Engine</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select an engagement to generate audit reports. Reports pull from scrutiny findings, CARO responses, and notes to accounts.</p>
        </CardContent>
      </Card>
    </div>
  );
}
