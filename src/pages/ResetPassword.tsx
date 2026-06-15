import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Establish a recovery session before enabling the form. Supabase's
    // recovery emails can deliver the token in three different shapes,
    // each requiring its own verification call. The form does NOT enable
    // until one of them produces a live session — otherwise updateUser
    // later fails with "Auth session missing!".
    //
    //   (a) /reset-password#access_token=...&type=recovery   — legacy hash
    //       Supabase's detectSessionInUrl=true auto-consumes the hash
    //       and emits SIGNED_IN / PASSWORD_RECOVERY. We just listen.
    //   (b) /reset-password?token_hash=...&type=recovery     — PKCE token_hash
    //       Must call verifyOtp({ type: "recovery", token_hash }) ourselves.
    //   (c) /reset-password?code=<pkce-code>                 — PKCE code exchange
    //       Must call exchangeCodeForSession(code) ourselves.
    let cancelled = false;

    const fail = (msg: string) => {
      if (cancelled) return;
      toast({ title: "Recovery link failed", description: msg, variant: "destructive" });
    };

    const hash     = window.location.hash || "";
    const search   = window.location.search || "";
    const qsParams = new URLSearchParams(search);

    // (b) token_hash flow — the one used by the customised email template
    const tokenHash = qsParams.get("token_hash");
    const qsType    = qsParams.get("type");
    if (tokenHash && (qsType === "recovery" || !qsType)) {
      supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash })
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data.session) {
            fail(error?.message || "Link is invalid or expired.");
            return;
          }
          setReady(true);
        });
    }

    // (c) PKCE code-exchange
    const code = qsParams.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data.session) {
          fail(error?.message || "Link is invalid or expired.");
          return;
        }
        setReady(true);
      });
    }

    // (a) Legacy hash flow — listen for the auth state change Supabase
    // emits after auto-consuming the URL hash.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        setReady(true);
      }
    });

    // Common case: Supabase already restored a session before this
    // component mounted (legacy hash flow lands here on first paint).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) setReady(true);
    });

    // Final safety net: if nothing established a session within 4s AND
    // there were no URL params at all, surface a clear message instead
    // of letting the user stare at a spinner forever.
    const noUrlHint = !tokenHash && !code && !hash.includes("access_token=");
    if (noUrlHint) {
      const t = setTimeout(() => {
        if (!cancelled) fail("No recovery token found in the URL. Request a new link.");
      }, 200);
      return () => {
        cancelled = true;
        clearTimeout(t);
        subscription.unsubscribe();
      };
    }

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }

    setLoading(true);
    // Double-check we actually hold a live session before calling
    // updateUser. If we don't, the call fails with the generic
    // "Auth session missing!" — surface a useful message instead.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({
        title: "Session expired",
        description: "The recovery link is no longer valid. Request a new one.",
        variant: "destructive",
      });
      setLoading(false);
      navigate("/forgot-password", { replace: true });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      toast({ title: "Could not update password", description: error.message, variant: "destructive" });
    } else {
      // Sign the recovery session out so the user lands on a clean login
      // page with their new password — otherwise they'd be silently
      // signed in via the recovery session, which is confusing.
      await supabase.auth.signOut();
      toast({ title: "Password updated successfully — sign in with the new password" });
      navigate("/login", { replace: true });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-display font-bold">
            <span className="text-primary">CA</span>
            <span className="text-foreground">Flow</span>
          </h1>
        </div>

        {!ready ? (
          <div className="text-center space-y-4">
            <h2 className="text-xl font-display font-bold text-foreground">Invalid or expired link</h2>
            <p className="text-sm text-muted-foreground">Please request a new password reset.</p>
            <Button variant="outline" onClick={() => navigate("/forgot-password")}>
              Request new link
            </Button>
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-xl font-display font-bold text-foreground">Set new password</h2>
              <p className="text-sm text-muted-foreground mt-1">Enter your new password below</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">New Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Confirm Password</label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={loading}>
                {loading ? "Updating…" : "Update Password"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
