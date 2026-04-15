import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface AuditContextType {
  selectedClientId: string;
  selectedEngagementId: string;
  setSelectedClientId: (id: string) => void;
  setSelectedEngagementId: (id: string) => void;
  clients: { id: string; name: string | null; entity_type: string | null; statutory_audit_applicable?: boolean | null; tax_audit_applicable?: boolean | null; internal_audit_applicable?: boolean | null; stock_audit_applicable?: boolean | null; has_statutory_service?: boolean; has_tax_audit_service?: boolean; has_internal_audit_service?: boolean }[];
  engagements: any[];
  selectedEngagement: any | null;
  loading: boolean;
  refreshEngagements: () => void;
}

const AuditContext = createContext<AuditContextType | null>(null);

export function AuditContextProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selectedClientId, setSelectedClientId] = useState<string>("all");
  const [selectedEngagementId, setSelectedEngagementId] = useState<string>("");
  const [clients, setClients] = useState<{ id: string; name: string | null; entity_type: string | null; statutory_audit_applicable?: boolean | null; tax_audit_applicable?: boolean | null; internal_audit_applicable?: boolean | null; stock_audit_applicable?: boolean | null; has_statutory_service?: boolean; has_tax_audit_service?: boolean; has_internal_audit_service?: boolean }[]>([]);
  const [engagements, setEngagements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!user?.firm_id && user?.role !== "superadmin") return;
    setLoading(true);

    let engQuery: any = supabase.from("audit_engagements").select("*, clients(name, entity_type)");
    let clientQuery: any = supabase
      .from("clients")
      .select("id, name, entity_type")
      .eq("is_draft", false)
      .is("deleted_at", null);

    if (user?.firm_id) {
      engQuery = engQuery.eq("firm_id", user.firm_id);
      clientQuery = clientQuery.eq("firm_id", user.firm_id);
    }

    // Fetch client IDs that have classification = 'Audit' in client_fy_classifications
    let classQuery: any = supabase
      .from("client_fy_classifications")
      .select("client_id")
      .ilike("classification", "audit");

    // Fetch audit setup flags from client_fy_audit_setup
    let auditSetupQuery: any = supabase
      .from("client_fy_audit_setup")
      .select("client_id, statutory_audit_applicable, tax_audit_applicable, internal_audit_applicable, stock_audit_applicable");

    // Fetch active audit services (linked_module = "audit") from client_services
    let auditSvcQuery: any = supabase
      .from("client_services")
      .select("client_id, service_categories!inner(name, linked_module)")
      .eq("is_active", true);

    const [engRes, clientRes, classRes, auditSetupRes, auditSvcRes] = await Promise.all([
      engQuery, clientQuery, classQuery, auditSetupQuery, auditSvcQuery
    ]);

    // Build set of client IDs with Audit classification
    const auditClientIdSet = new Set(
      (classRes.data || []).map((r: any) => r.client_id)
    );

    // Build per-client audit setup flags
    const setupMap: Record<string, any> = {};
    for (const row of (auditSetupRes.data || []) as any[]) {
      setupMap[row.client_id] = row;
    }

    // Build per-client flags from active services
    const svcMap: Record<string, { hasStat: boolean; hasTax: boolean; hasInternal: boolean }> = {};
    for (const row of (auditSvcRes.data || []) as any[]) {
      const cat = row.service_categories;
      if (!cat || cat.linked_module !== "audit") continue;
      if (!svcMap[row.client_id]) svcMap[row.client_id] = { hasStat: false, hasTax: false, hasInternal: false };
      const nameLower = (cat.name as string).toLowerCase();
      if (nameLower.includes("statutory"))      svcMap[row.client_id].hasStat = true;
      else if (nameLower.includes("tax"))       svcMap[row.client_id].hasTax = true;
      else if (nameLower.includes("internal"))  svcMap[row.client_id].hasInternal = true;
      else                                      svcMap[row.client_id].hasTax = true;
    }

    // Show clients with Audit classification OR audit setup flags OR active audit services
    const allClients = (clientRes.data || []) as any[];
    const auditClients = allClients
      .filter(c => {
        const setup = setupMap[c.id] ?? {};
        const svc   = svcMap[c.id]   ?? {};
        return (
          auditClientIdSet.has(c.id) ||
          setup.statutory_audit_applicable || setup.tax_audit_applicable ||
          setup.internal_audit_applicable  || setup.stock_audit_applicable ||
          svc.hasStat || svc.hasTax        || svc.hasInternal
        );
      })
      .map(c => {
        const setup = setupMap[c.id] ?? {};
        const svc   = svcMap[c.id]   ?? {};
        return {
          ...c,
          statutory_audit_applicable:  !!(setup.statutory_audit_applicable || svc.hasStat),
          tax_audit_applicable:        !!(setup.tax_audit_applicable        || svc.hasTax),
          internal_audit_applicable:   !!(setup.internal_audit_applicable   || svc.hasInternal),
          stock_audit_applicable:      !!setup.stock_audit_applicable,
          has_statutory_service:       !!svc.hasStat,
          has_tax_audit_service:       !!svc.hasTax,
          has_internal_audit_service:  !!svc.hasInternal,
        };
      });

    const clientMap = new Map(allClients.map((c: any) => [c.id, c]));
    setClients(auditClients);

    const mapped = (engRes.data || []).map((e: any) => {
      const joined = e.clients as Record<string, any> | null;
      const fallback = clientMap.get(e.client_id) as Record<string, any> | undefined;
      return {
        ...e,
        stage_statuses: (e.stage_statuses || {}) as Record<string, string>,
        client_name: joined?.name || fallback?.name || "Unknown",
        client_entity_type: joined?.entity_type || fallback?.entity_type || "",
      };
    });
    setEngagements(mapped);

    if (mapped.length > 0 && !selectedEngagementId) {
      setSelectedEngagementId(mapped[0].id);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user?.firm_id, user?.role]);

  const selectedEngagement = engagements.find(e => e.id === selectedEngagementId) || null;

  return (
    <AuditContext.Provider value={{
      selectedClientId,
      selectedEngagementId,
      setSelectedClientId: (id: string) => { setSelectedClientId(id); setSelectedEngagementId(""); },
      setSelectedEngagementId,
      clients,
      engagements,
      selectedEngagement,
      loading,
      refreshEngagements: fetchData,
    }}>
      {children}
    </AuditContext.Provider>
  );
}

export function useAuditContext() {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error("useAuditContext must be used within AuditContextProvider");
  return ctx;
}
