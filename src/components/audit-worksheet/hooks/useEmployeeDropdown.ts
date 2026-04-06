/**
 * useEmployeeDropdown
 * Fetches all active users for the current firm, used in employee
 * assignment dropdowns on the Worksheet sheet.
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

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["aws-employees", user?.firm_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("id, name, role, icai_reg_no")
        .eq("firm_id", user!.firm_id!)
        .eq("is_active", true)
        .order("name");
      return (data || []) as Employee[];
    },
    enabled: !!user?.firm_id,
    staleTime: 120_000,
  });

  return { employees, loading: isLoading };
}
