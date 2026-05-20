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
    // Issue 7 (today) — make the recovery-link detection robust across every
    // path Supabase + email clients can produce:
    //
    //   (a) /reset-password#access_token=...&type=recovery   (legacy hash)
    //   (b) /reset-password?type=recovery&token_hash=...     (PKCE token_hash)
    //   (c) /reset-password?code=<pkce-code>                  (PKCE code-exchange)
    //   (d) No URL hint — supabase.auth has already processed the token
    //       SYNCHRONOUSLY during client init, fires PASSWORD_RECOVERY,
    //       clears the hash, and leaves us a live session.
    //
    // Run all four checks in parallel; whichever succeeds first flips
    // `ready=true`.  Without this combined strategy, email clients that
    // mangle the hash into a query (Outlook, some Apple Mail variants)
    // produced "Invalid or expired link" even with a valid token.
    let cancelled = false;

    // (a) + (b) — URL hint
    const hash       = window.location.hash || "";
    const search     = window.location.search || "";
    const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
    const qsParams   = new URLSearchParams(search);
    if (
      hash.includes("type=recovery") ||
      hash.includes("access_token=") ||
      hashParams.get("type") === "recovery" ||
      qsParams.get("type")   === "recovery"
    ) {
      setReady(true);
    }

    // (c) PKCE code-exchange
    const code = qsParams.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (cancelled) return;
        if (error) {
          toast({ title: "Recovery link failed", description: error.message, variant: "destructive" });
        } else {
          setReady(true);
        }
      });
    }

    // (d) Auth-state listener — catches PASSWORD_RECOVERY when the token
    // takes >1 frame to land OR a SIGNED_IN that came from the recovery
    // link (Supabase v2 sometimes only emits SIGNED_IN after token swap).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });

    // (d-cont.) Probe an already-restored session for the common case
    // where Supabase processed the recovery hash BEFORE React mounted.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) setReady(true);
    });

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
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password updated successfully" });
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
