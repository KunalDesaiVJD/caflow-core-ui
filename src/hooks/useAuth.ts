import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  firm_id: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up listener BEFORE getSession per Supabase best practices
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Use setTimeout to avoid potential deadlock with Supabase auth
      setTimeout(async () => {
        const { data: profile } = await supabase
          .from("users")
          .select("id, email, name, role, firm_id")
          .eq("id", session.user.id)
          .single();

        if (profile) {
          setUser(profile);
          // Set session context for version_history trigger
          await supabase.rpc("set_user_context", {
            p_user_id: profile.id,
            p_user_name: profile.name || session.user.email || "Unknown",
            p_user_role: profile.role || "staff",
          });
        } else {
          // Fallback: user exists in auth but not in users table
          setUser({
            id: session.user.id,
            email: session.user.email || null,
            name: session.user.user_metadata?.name || session.user.email || null,
            role: session.user.user_metadata?.role || null,
            firm_id: null,
          });
        }
        setLoading(false);
      }, 0);
    });

    // Then check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setLoading(false);
      }
      // onAuthStateChange will handle the rest
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return { user, loading, signOut };
}
