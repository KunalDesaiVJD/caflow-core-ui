import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface UserOption {
  id:   string;
  name: string;
}

export function useUsers(firmId: string, isSuperadmin?: boolean) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firmId && !isSuperadmin) return;
    setLoading(true);
    let q = supabase
      .from("users")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    if (!isSuperadmin) q = q.eq("firm_id", firmId);
    q.then(({ data }) => {
      setUsers(data || []);
      setLoading(false);
    });
  }, [firmId, isSuperadmin]);

  return { users, loading };
}
