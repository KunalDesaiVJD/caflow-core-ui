import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EngagementRiskAssessment } from "@/components/engagement/EngagementRiskAssessment";
import { EngagementAuditProgramme } from "@/components/engagement/EngagementAuditProgramme";
import { EngagementFieldwork } from "@/components/engagement/EngagementFieldwork";
import { EngagementCARO } from "@/components/engagement/EngagementCARO";
import { EngagementNotesToAccounts } from "@/components/engagement/EngagementNotesToAccounts";
import { EngagementReviewSignoff } from "@/components/engagement/EngagementReviewSignoff";
import IARTab from "@/components/stage8/IARTab";
import IFCReportTab from "@/components/stage7/IFCReportTab";
import CashFlowNotesTab from "@/components/stage7/CashFlowNotesTab";
import { CheckCircle, Circle, AlertTriangle, Pencil, ClipboardList } from "lucide-react";

const STEPS = ["Planning", "Risk Assessment", "Audit Programme", "Fieldwork", "CARO", "Notes", "Review", "Sign-off"];
const TAB_MAP: Record<string, string> = {
  "Risk Assessment": "risk",
  "Audit Programme": "programme",
  "Fieldwork": "fieldwork",
  "CARO": "caro",
  "Notes": "notes",
  "Review": "review",
  "Sign-off": "review",
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [engagement, setEngagement] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [partner, setPartner] = useState<any>(null);
  const [manager, setManager] = useState<any>(null);
  const [teamUsers, setTeamUsers] = useState<any[]>([]);
  const [auditorAssignment, setAuditorAssignment] = useState<any>(null);
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

      // Fetch auditor assignment for this FY
      if (eng.financial_year) {
        const { data: assignment } = await supabase
          .from("client_auditor_assignments")
          .select("*, audit_firms(name, partner_name, icai_reg_no)")
          .eq("client_id", eng.client_id)
          .eq("financial_year", eng.financial_year)
          .maybeSingle();
        setAuditorAssignment(assignment);
      }
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
      const { data } = await supabase.from("users").select("id, name, role").neq("role", "client").eq("firm_id", user.firm_id);
      setTeamUsers(data || []);
    }
    setLoading(false);
  }

  function currentStepIndex() {
    const s = engagement?.status?.toLowerCase() || "planning";
    const map: Record<string, number> = { planning: 0, risk_assessment: 1, audit_programme: 2, fieldwork: 3, review: 4, "sign-off": 5, signed: 5, complete: 5 };
    return map[s] ?? 0;
  }

  // Fix (Issue 4): isCorporate computed from BOTH engagement.entity_type and client.entity_type.
  // engagement.clients is NOT available here (fetched with select("*"), no join), so use
  // the separate `client` state variable that IS populated.
  const isCorporate = (() => {
    const engEt = (engagement?.entity_type || "").toLowerCase();
    const clientEt = (client?.entity_type || "");
    const CORPORATE_CLIENT_TYPES = ["Private Ltd", "Public Ltd", "Private Limited", "Public Limited"];
    return engEt === "company" || CORPORATE_CLIENT_TYPES.includes(clientEt);
  })();

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
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-7 ml-auto"
            onClick={() => navigate(`/audit/${engagementId}/worksheet`)}
          >
            <ClipboardList size={13} /> Audit Worksheet
          </Button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {(engagement.partner_name || partner) && (
            <span>
              Engagement Partner:{" "}
              <strong className="text-foreground">
                {engagement.partner_name || partner?.name}
              </strong>
            </span>
          )}
          {manager && <span>Manager: <strong className="text-foreground">{manager.name}</strong></span>}
          {auditorAssignment ? (
            <span className="flex items-center gap-1">
              Assigned Auditor: <strong className="text-foreground">{auditorAssignment.audit_firms?.name}</strong> — {auditorAssignment.audit_firms?.partner_name}
              <Button variant="ghost" size="icon" className="h-5 w-5 ml-1" onClick={() => navigate(`/clients/${engagement.client_id}?tab=auditors`)}>
                <Pencil size={12} />
              </Button>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              No audit firm assigned for FY {engagement.financial_year}. Assign one from Client &gt; Auditors tab.
            </span>
          )}
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
          {/* Tab order for Stage 8 reporting:
                Notes to Accounts → IAR → CARO 2020 → IFC Report → Cash Flow Notes
              Notes always visible; the remaining four are corporate-only. */}
          <TabsTrigger value="notes">Notes to Accounts</TabsTrigger>
          {isCorporate && <TabsTrigger value="iar">IAR</TabsTrigger>}
          {isCorporate && <TabsTrigger value="caro">CARO 2020</TabsTrigger>}
          {isCorporate && <TabsTrigger value="ifc">IFC Report</TabsTrigger>}
          {isCorporate && <TabsTrigger value="cashflow">Cash Flow Notes</TabsTrigger>}
          <TabsTrigger value="review">Review & Sign-off</TabsTrigger>
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

        {/* ── Stage 8 reporting tabs — rendered in spec order ──────────────
              1. Notes to Accounts  (all entity types)
              2. IAR                (corporate only)
              3. CARO 2020          (corporate only)
              4. IFC Report         (corporate only — component gates further on ifc_applicable)
              5. Cash Flow Notes    (corporate only — component gates further on cash_flow_applicable)
            Each corporate-only tab uses the same isCorporate guard as CARO.
        */}
        <TabsContent value="notes">
          <EngagementNotesToAccounts
            engagement={engagement}
            client={client}
            isCorporate={isCorporate}
            onUpdate={fetchData}
          />
        </TabsContent>

        {isCorporate && (
          <TabsContent value="iar">
            <IARTab
              engagement={engagement}
              client={client}
              onUpdate={fetchData}
            />
          </TabsContent>
        )}

        {isCorporate && (
          <TabsContent value="caro">
            <EngagementCARO
              engagement={engagement}
              client={client}
              onUpdate={fetchData}
            />
          </TabsContent>
        )}

        {isCorporate && (
          <TabsContent value="ifc">
            <IFCReportTab
              engagementId={engagement?.id}
              engagement={engagement}
            />
          </TabsContent>
        )}

        {isCorporate && (
          <TabsContent value="cashflow">
            <CashFlowNotesTab
              engagementId={engagement?.id}
              engagement={engagement}
            />
          </TabsContent>
        )}

        <TabsContent value="review">
          <EngagementReviewSignoff
            engagement={engagement}
            client={client}
            partner={partner}
            onUpdate={fetchData}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
