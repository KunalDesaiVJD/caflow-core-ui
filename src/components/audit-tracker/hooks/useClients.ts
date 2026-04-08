import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ClientOption {
  id:   string;
  name: string;
}

export function useClients(firmId: string) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firmId) return;
    setLoading(true);
    supabase
      .from("clients")
      .select("id, name")
      .eq("firm_id", firmId)
      .is("deleted_at", null)
      .order("name")
      .then(({ data }) => {
        setClients(data || []);
        setLoading(false);
      });
  }, [firmId]);

  return { clients, loading };
}
