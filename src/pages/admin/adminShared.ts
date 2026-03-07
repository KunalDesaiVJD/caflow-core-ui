import { supabase } from "@/integrations/supabase/client";

const VITE_SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

export async function callAdmin(action: string, method: "GET" | "POST" = "GET", body?: any, params?: Record<string, string>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const url = new URL(`https://${VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/admin-platform`);
  url.searchParams.set("action", action);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 403) throw new Error("ACCESS_DENIED");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface Firm {
  id: string;
  name: string;
  plan: string | null;
  icai_reg_no: string | null;
  is_active: boolean | null;
  created_at: string | null;
  users_count: number;
  clients_count: number;
}

export interface Stats {
  activeFirms: number;
  totalUsers: number;
  totalClients: number;
  activeSubscriptions: number;
}

export interface LogEntry {
  id: string;
  operation: string | null;
  user_name: string | null;
  user_role: string | null;
  table_name: string | null;
  record_id: string | null;
  changed_fields: string[] | null;
  created_at: string | null;
}

export const PLAN_COLORS: Record<string, string> = {
  starter: "bg-muted text-muted-foreground",
  pro: "bg-primary/10 text-primary",
  enterprise: "bg-sidebar-gold/20 text-sidebar-gold",
};

export const OP_COLORS: Record<string, string> = {
  INSERT: "bg-emerald-100 text-emerald-700",
  UPDATE: "bg-sky-100 text-sky-700",
  DELETE: "bg-red-100 text-red-700",
  IMPERSONATE: "bg-amber-100 text-amber-700",
  RESTORE: "bg-purple-100 text-purple-700",
};
