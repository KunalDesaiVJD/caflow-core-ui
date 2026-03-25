import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  firm_id: string | null;
  must_change_password: boolean;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setUser(null);
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("users")
        .select("id, email, name, role, firm_id, must_change_password")
        .eq("id", session.user.id)
        .single();

      if (profile) {
        setUser({
          ...profile,
          must_change_password: (profile as any).must_change_password ?? false,
        });
        await supabase.rpc("set_user_context", {
          p_user_id: profile.id,
          p_user_name: profile.name || session.user.email || "Unknown",
          p_user_role: profile.role || "staff_article",
        });
      } else {
        setUser({
          id: session.user.id,
          email: session.user.email || null,
          name: session.user.user_metadata?.name || session.user.email || null,
          role: session.user.user_metadata?.role || null,
          firm_id: null,
          must_change_password: false,
        });
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return { user, loading, signOut };
}
