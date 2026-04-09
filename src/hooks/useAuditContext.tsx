import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface AuditContextType {
  selectedClientId: string;
  selectedEngagementId: string;
  setSelectedClientId: (id: string) => void;
  setSelectedEngagementId: (id: string) => void;
  clients: { id: string; name: string | null; entity_type: string | null; statutory_audit_applicable?: boolean | null; tax_audit_type?: string | null; internal_audit_applicable?: boolean | null; stock_audit_applicable?: boolean | null }[];
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
  const [clients, setClients] = useState<{ id: string; name: string | null; entity_type: string | null; statutory_audit_applicable?: boolean | null; tax_audit_type?: string | null; internal_audit_applicable?: boolean | null; stock_audit_applicable?: boolean | null }[]>([]);
  const [engagements, setEngagements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!user?.firm_id && user?.role !== "superadmin") return;
    setLoading(true);

    let engQuery: any = supabase.from("audit_engagements").select("*, clients(name, entity_type)");
    let clientQuery: any = supabase
      .from("clients")
      .select("id, name, entity_type, statutory_audit_applicable, tax_audit_type, internal_audit_applicable, stock_audit_applicable")
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
      .eq("classification", "Audit");

    const [engRes, clientRes, classRes] = await Promise.all([engQuery, clientQuery, classQuery]);
    // Only show clients whose classification is 'Audit'
    const auditClientIdSet = new Set(
      (classRes.data || []).map((r: any) => r.client_id)
    );
    const auditClients = (clientRes.data || []).filter(
      (c: any) => auditClientIdSet.has(c.id)
    );

    const clientMap = new Map((clientRes.data || []).map((c: any) => [c.id, c]));
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
