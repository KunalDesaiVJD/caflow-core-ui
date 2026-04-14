import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AuditFirmOption {
  id:           string;
  name:         string;
  partner_name: string | null;
}

export function useFirms(firmId: string) {
  const [auditFirms, setAuditFirms] = useState<AuditFirmOption[]>([]);
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    if (!firmId) return;
    setLoading(true);
    supabase
      .from("audit_firms")
      .select("id, name, partner_name")
      .eq("firm_id", firmId)
      .order("name")
      .then(({ data }) => {
        setAuditFirms(data || []);
        setLoading(false);
      });
  }, [firmId]);

  return { auditFirms, loading };
}
