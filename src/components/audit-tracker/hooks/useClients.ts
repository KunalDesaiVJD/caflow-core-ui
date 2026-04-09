import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ClientOption {
  id:          string;
  name:        string;
  entity_type: string | null;
}

export function useClients(firmId: string) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firmId) return;
    setLoading(true);
    supabase
      .from("clients")
      .select("id, name, entity_type")
      .eq("firm_id", firmId)
      .is("deleted_at", null)
      .eq("is_draft", false)
      .order("name")
      .then(({ data, error }) => {
        if (error) console.error("[useClients] query error:", error);
        setClients((data as ClientOption[]) || []);
        setLoading(false);
      });
  }, [firmId]);

  return { clients, loading };
}
