import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface UserOption {
  id:   string;
  name: string;
}

export function useUsers(firmId: string) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firmId) return;
    setLoading(true);
    supabase
      .from("users")
      .select("id, name")
      .eq("firm_id", firmId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        setUsers(data || []);
        setLoading(false);
      });
  }, [firmId]);

  return { users, loading };
}
