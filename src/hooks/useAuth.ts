import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  firm_id: string | null;
  must_change_password: boolean;
  avatar_url: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    const applySession = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) => {
      if (!isActive) return;

      if (!session?.user) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const { data: profile } = await supabase
          .from("users")
          .select("id, email, name, role, firm_id, must_change_password, avatar_url")
          .eq("id", session.user.id)
          .maybeSingle();

        if (!isActive) return;

        if (profile) {
          setUser({
            ...profile,
            must_change_password: (profile as any).must_change_password ?? false,
            avatar_url: (profile as any).avatar_url ?? null,
          });

          void supabase.rpc("set_user_context", {
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
            avatar_url: null,
          });
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    // Supabase uses setTimeout for token refresh — browser throttles timers in
    // background tabs, so the refresh may never fire while the user is idle.
    // When the tab becomes visible again, proactively refresh the token so the
    // user never gets silently logged out after returning to the app.
    const handleVisibilityChange = () => {
      if (!isActive || document.hidden) return;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          // Session still in storage — force a token refresh in case it expired
          supabase.auth.refreshSession().then(({ data: { session: refreshed } }) => {
            if (refreshed && isActive) void applySession(refreshed);
          });
        }
        // If no session at all, auth state change will handle setting user to null
      });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Ignore spurious SIGNED_OUT events that fire during background token refresh
      // attempts — only act on them when the tab is visible (user is actually there).
      if (event === "SIGNED_OUT" && document.hidden) return;
      void applySession(session);
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void applySession(session);
    });

    return () => {
      isActive = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const value = useMemo(() => ({ user, loading, signOut }), [user, loading]);

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  return useContext(AuthContext);
}
