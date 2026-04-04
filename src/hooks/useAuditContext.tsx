import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface AuditContextType {
  selectedClientId: string;
  selectedEngagementId: string;
  setSelectedClientId: (id: string) => void;
  setSelectedEngagementId: (id: string) => void;
  clients: { id: string; name: string | null; entity_type: string | null; statutory_audit_applicable?: boolean | null; tax_audit_type?: string | null }[];
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
  const [clients, setClients] = useState<{ id: string; name: string | null; entity_type: string | null; statutory_audit_applicable?: boolean | null; tax_audit_type?: string | null }[]>([]);
  const [engagements, setEngagements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!user?.firm_id && user?.role !== "superadmin") return;
    setLoading(true);

    // Issue 2 + 5: Only show clients classified as "Audit" in at least one FY.
    // client_fy_classifications has no firm_id column; firm scoping is enforced
    // downstream via clientQuery.eq("firm_id", ...) so no extra filter needed here.
    const { data: auditClassRows } = await supabase
      .from("client_fy_classifications")
      .select("client_id")
      .eq("classification", "Audit");
    const auditClientIds = [...new Set((auditClassRows || []).map((r: any) => r.client_id as string))];

    // Issue 5 fix: use `let` so we can reassign after applying firm_id filter
    // Also select clients(name,entity_type) directly so client_name is always resolved
    // even when the client is not in the audit-classification list
    let engQuery: any = supabase.from("audit_engagements").select("*, clients(name, entity_type)");
    // Build the client query — filter to Audit-classified clients only
    let clientQuery: any = supabase
      .from("clients")
      .select("id, name, entity_type, statutory_audit_applicable, tax_audit_type")
      .eq("is_draft", false)
      .is("deleted_at", null);

    if (user?.firm_id) {
      engQuery = engQuery.eq("firm_id", user.firm_id);   // Fix: reassign so filter sticks
      clientQuery = clientQuery.eq("firm_id", user.firm_id);
    }

    // Apply the Audit classification filter
    if (auditClientIds.length > 0) {
      clientQuery = clientQuery.in("id", auditClientIds);
    } else {
      // No audit-classified clients exist yet — show empty list
      clientQuery = clientQuery.in("id", ["00000000-0000-0000-0000-000000000000"]); // returns empty safely
    }

    const [engRes, clientRes] = await Promise.all([engQuery, clientQuery]);
    const clientMap = new Map((clientRes.data || []).map((c: any) => [c.id, c]));
    setClients(clientRes.data || []);

    const mapped = (engRes.data || []).map((e: any) => ({
      ...e,
      stage_statuses: (e.stage_statuses || {}) as Record<string, string>,
      // Prefer the direct join; fall back to clientMap (audit-only list); then "Unknown"
      client_name: (e.clients as any)?.name || clientMap.get(e.client_id)?.name || "Unknown",
      client_entity_type: (e.clients as any)?.entity_type || clientMap.get(e.client_id)?.entity_type || "",
    }));
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
