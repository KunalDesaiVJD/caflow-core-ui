import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EngagementRiskAssessment } from "@/components/engagement/EngagementRiskAssessment";
import { EngagementAuditProgramme } from "@/components/engagement/EngagementAuditProgramme";
import { EngagementFieldwork } from "@/components/engagement/EngagementFieldwork";
import { EngagementCARO } from "@/components/engagement/EngagementCARO";
import { EngagementNotesToAccounts } from "@/components/engagement/EngagementNotesToAccounts";
import { CheckCircle, Circle } from "lucide-react";

const STEPS = ["Planning", "Risk Assessment", "Audit Programme", "Fieldwork", "CARO", "Notes", "Review", "Sign-off"];
const TAB_MAP: Record<string, string> = {
  "Risk Assessment": "risk",
  "Audit Programme": "programme",
  "Fieldwork": "fieldwork",
  "CARO": "caro",
  "Notes": "notes",
};

const statusColors: Record<string, string> = {
  planning: "bg-blue-500/15 text-blue-700 border-blue-300",
  fieldwork: "bg-amber-500/15 text-amber-700 border-amber-300",
  review: "bg-purple-500/15 text-purple-700 border-purple-300",
  signed: "bg-green-500/15 text-green-700 border-green-300",
  complete: "bg-green-500/15 text-green-700 border-green-300",
};

export default function EngagementDetail() {
  const { engagementId } = useParams<{ engagementId: string }>();
  const { user } = useAuth();
  const [engagement, setEngagement] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [partner, setPartner] = useState<any>(null);
  const [manager, setManager] = useState<any>(null);
  const [teamUsers, setTeamUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("risk");

  useEffect(() => {
    if (!engagementId) return;
    fetchData();
  }, [engagementId]);

  async function fetchData() {
    setLoading(true);
    const { data: eng } = await supabase
      .from("audit_engagements")
      .select("*")
      .eq("id", engagementId!)
      .single();

    if (!eng) { setLoading(false); return; }
    setEngagement(eng);

    if (eng.client_id) {
      const { data } = await supabase.from("clients").select("*").eq("id", eng.client_id).single();
      setClient(data);
    }
    if (eng.partner_id) {
      const { data } = await supabase.from("users").select("id, name, icai_reg_no").eq("id", eng.partner_id).single();
      setPartner(data);
    }
    if (eng.manager_id) {
      const { data } = await supabase.from("users").select("id, name").eq("id", eng.manager_id).single();
      setManager(data);
    }
    if (user?.firm_id) {
      const { data } = await supabase.from("users").select("id, name, role").eq("firm_id", user.firm_id);
      setTeamUsers(data || []);
    }
    setLoading(false);
  }

  function currentStepIndex() {
    const s = engagement?.status?.toLowerCase() || "planning";
    const map: Record<string, number> = { planning: 0, risk_assessment: 1, audit_programme: 2, fieldwork: 3, review: 4, "sign-off": 5, signed: 5, complete: 5 };
    return map[s] ?? 0;
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (!engagement) {
    return <div className="p-6 text-muted-foreground">Engagement not found.</div>;
  }

  const stepIdx = currentStepIndex();

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* HEADER */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{client?.name || "Client"}</h1>
          <Badge variant="outline" className="text-xs">{engagement.financial_year}</Badge>
          <Badge variant="outline" className={`text-xs capitalize ${statusColors[engagement.status?.toLowerCase()] || ""}`}>
            {engagement.status || "Planning"}
          </Badge>
          <Badge variant="secondary" className="text-xs capitalize">{engagement.audit_type || "Statutory"}</Badge>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {partner && <span>Partner: <strong className="text-foreground">{partner.name}</strong></span>}
          {manager && <span>Manager: <strong className="text-foreground">{manager.name}</strong></span>}
          {engagement.planned_start && <span>Start: {engagement.planned_start}</span>}
          {engagement.planned_end && <span>End: {engagement.planned_end}</span>}
        </div>
      </div>

      {/* PROGRESS STEPPER */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((step, i) => {
          const done = i <= stepIdx;
          const tabKey = TAB_MAP[step];
          return (
            <button
              key={step}
              onClick={() => tabKey && setActiveTab(tabKey)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                done
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground"
              } ${tabKey ? "cursor-pointer hover:bg-primary/25" : "cursor-default"}`}
            >
              {done ? <CheckCircle className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
              {step}
            </button>
          );
        })}
      </div>

      {/* TABS */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="risk">Risk Assessment</TabsTrigger>
          <TabsTrigger value="programme">Audit Programme</TabsTrigger>
          <TabsTrigger value="fieldwork">Fieldwork</TabsTrigger>
        </TabsList>

        <TabsContent value="risk">
          <EngagementRiskAssessment
            engagement={engagement}
            client={client}
            onUpdate={fetchData}
          />
        </TabsContent>

        <TabsContent value="programme">
          <EngagementAuditProgramme
            engagement={engagement}
            teamUsers={teamUsers}
            onUpdate={fetchData}
          />
        </TabsContent>

        <TabsContent value="fieldwork">
          <EngagementFieldwork
            engagement={engagement}
            client={client}
            teamUsers={teamUsers}
            currentUser={user}
            onUpdate={fetchData}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
