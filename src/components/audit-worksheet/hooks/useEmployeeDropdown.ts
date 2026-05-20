/**
 * useEmployeeDropdown
 * Fetches all active users for assignment dropdowns on the Worksheet sheet.
 * Superadmin sees users from ALL firms; regular users see their own firm only.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Employee {
  id: string;
  name: string | null;
  role: string | null;
  icai_reg_no: string | null;
}

export function useEmployeeDropdown(): {
  employees: Employee[];
  loading: boolean;
} {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["aws-employees", isSuperadmin ? "__all__" : user?.firm_id],
    queryFn: async () => {
      let q = supabase
        .from("users")
        .select("id, name, role, icai_reg_no")
        .neq("role", "client")
        .order("name");
      if (!isSuperadmin) q = q.eq("firm_id", user?.firm_id ?? "");
      const { data, error } = await q;
      if (error) console.error("[useEmployeeDropdown] Supabase error:", error);
      return (data || []) as Employee[];
    },
    enabled: isSuperadmin || !!user?.firm_id,
    staleTime: 120_000,
  });

  return { employees, loading: isLoading };
}
