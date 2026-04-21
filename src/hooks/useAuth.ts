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

      // ── Step 1: Unblock UI immediately using JWT claims ──────────────────────
      // The JWT payload already contains user_metadata written at sign-up/update.
      // We use it to show the app instantly while the DB profile loads in the
      // background — eliminating the "Signing in…" stall on every page load.
      const meta = session.user.user_metadata ?? {};
      const optimisticUser: AuthUser = {
        id: session.user.id,
        email: session.user.email || null,
        name: meta.name || session.user.email || null,
        role: meta.role || null,
        firm_id: meta.firm_id || null,
        must_change_password: meta.must_change_password ?? false,
        avatar_url: meta.avatar_url || null,
      };
      setUser(optimisticUser);
      setLoading(false);   // ← UI can render immediately

      // ── Step 2: Fetch DB profile in background to get authoritative data ─────
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
        }
      } catch {
        // Profile fetch failed — optimistic user from JWT is still set, app keeps working
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
          }).catch(() => { /* ignore lock/abort errors from background refresh */ });
        }
        // If no session at all, auth state change will handle setting user to null
      }).catch(() => { /* ignore lock/abort errors from background getSession */ });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Ignore spurious SIGNED_OUT events that fire during background token refresh
      // attempts — only act on them when the tab is visible (user is actually there).
      if (event === "SIGNED_OUT" && document.hidden) return;
      void applySession(session);
    });

    // CRITICAL: Do NOT call supabase.auth.getSession() here.
    //
    // Reason: gotrue-js serialises auth ops through a lock. If getSession()
    // is slow (e.g. background token refresh hits a slow network), it holds
    // the lock. Then when the user clicks "Sign In", signInWithPassword
    // queues behind it and never fires a network request — the login
    // button just hangs in the "clicked" state. That was the exact symptom
    // after the Web-Locks replacement: app renders, login button wedges.
    //
    // Instead: read the session synchronously from localStorage so the UI
    // can render from JWT claims immediately, and let onAuthStateChange
    // (registered above) deliver authoritative state in the background.
    // signInWithPassword will then be the FIRST thing to acquire the lock
    // after the user clicks, and it won't be blocked.
    const readLocalSession = () => {
      try {
        const projectRef = (supabase as any).supabaseUrl?.match(/https:\/\/([a-z0-9]+)\./)?.[1];
        const storageKey = `sb-${projectRef}-auth-token`;
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.access_token || !parsed?.user) return null;
        // Check expiry
        if (parsed.expires_at && parsed.expires_at * 1000 < Date.now()) return null;
        return parsed;
      } catch {
        return null;
      }
    };

    const local = readLocalSession();
    if (local) {
      void applySession(local as any);
    } else {
      // No local session — render signed-out immediately (will show login)
      setUser(null);
      setLoading(false);
    }

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
