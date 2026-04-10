import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import EmailTemplatesTab from "./EmailTemplatesTab";
import EmailLogTab from "./EmailLogTab";
import BillingRemindersTab from "./BillingRemindersTab";
import { Mail, History, Bell } from "lucide-react";

export default function EmailSettingsTab({
  firmId,
  userId,
}: {
  firmId: string | null;
  userId: string | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Email Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage email templates, view sent history, and configure automated reminders.
        </p>
      </div>
      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates" className="gap-1.5">
            <Mail size={13} /> Templates
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-1.5">
            <History size={13} /> Email Log
          </TabsTrigger>
          <TabsTrigger value="reminders" className="gap-1.5">
            <Bell size={13} /> Reminders
          </TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="mt-4">
          <EmailTemplatesTab firmId={firmId} />
        </TabsContent>
        <TabsContent value="log" className="mt-4">
          <EmailLogTab firmId={firmId} />
        </TabsContent>
        <TabsContent value="reminders" className="mt-4">
          <BillingRemindersTab firmId={firmId} userId={userId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
