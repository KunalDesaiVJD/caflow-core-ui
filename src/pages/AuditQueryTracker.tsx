import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";

export default function AuditQueryTracker() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Query Tracker</h1>
        <p className="text-sm text-muted-foreground">Track and manage audit queries across engagements</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Queries</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Persistent query tracker for managing information requests during audit fieldwork. Queries can be linked to scrutiny findings.</p>
        </CardContent>
      </Card>
    </div>
  );
}
