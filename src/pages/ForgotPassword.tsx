import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle2, Mail, ShieldAlert } from "lucide-react";

const ForgotPassword = () => {
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${import.meta.env.VITE_SITE_URL ?? "https://caflow-core-ui.vercel.app"}/reset-password`,
    });

    setLoading(false);

    if (resetErr) {
      const msg = resetErr.message || "";
      if (msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("too many")) {
        setError("__rate_limit__");
      } else {
        setError(msg || "Failed to send reset email. Please contact your administrator.");
      }
    } else {
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">

        {/* Logo */}
        <div className="text-center">
          <h1 className="text-3xl font-display font-bold">
            <span className="text-primary">CA</span>
            <span className="text-foreground">Flow</span>
          </h1>
        </div>

        {sent ? (
          /* ── Success state ── */
          <div className="space-y-5">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-green-600" />
              </div>
              <h2 className="text-xl font-display font-bold text-foreground">Check your inbox</h2>
              <p className="text-sm text-muted-foreground">
                A password reset link has been sent to{" "}
                <span className="font-semibold text-foreground">{email}</span>.
                <br />Click the link in the email to set a new password.
              </p>
            </div>

            {/* Troubleshooting tips */}
            <div className="rounded-lg border bg-amber-50 border-amber-200 px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                <Mail size={13} /> Didn't receive it?
              </p>
              <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                <li>Check your <strong>Spam / Junk</strong> folder</li>
                <li>Allow up to 5 minutes for delivery</li>
                <li>Make sure <strong>{email}</strong> is the address registered with your firm</li>
                <li>The link expires in <strong>1 hour</strong> — request a new one if needed</li>
              </ul>
            </div>

            {/* Admin escalation note */}
            <div className="rounded-lg border bg-muted/40 px-4 py-3">
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <ShieldAlert size={13} className="shrink-0 mt-0.5 text-primary" />
                Still stuck? Contact your CA firm administrator — they can reset your password
                directly from the User Management panel without needing email delivery.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setSent(false); setEmail(""); }}
              >
                Send another link
              </Button>
              <Link to="/login">
                <Button variant="ghost" className="w-full text-sm">Back to sign in</Button>
              </Link>
            </div>
          </div>
        ) : (
          /* ── Request form ── */
          <>
            <div>
              <h2 className="text-xl font-display font-bold text-foreground">Forgot password?</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Enter the email address registered with your firm and we'll send a reset link.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Email</label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  required
                  autoFocus
                />
              </div>

              {error === "__rate_limit__" ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 space-y-1.5">
                  <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                    <ShieldAlert size={15} className="shrink-0" />
                    Too many reset attempts — email delivery paused
                  </p>
                  <p className="text-xs text-amber-700">
                    Supabase has temporarily blocked further emails to this address. Please wait
                    10–15 minutes before trying again, <strong>or contact your CA firm
                    administrator</strong> — they can reset your password directly from the
                    User Management panel without needing email delivery.
                  </p>
                </div>
              ) : error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start gap-2">
                  <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full bg-primary text-primary-foreground"
                disabled={loading}
              >
                {loading ? "Sending…" : "Send Reset Link"}
              </Button>

              <div className="text-center">
                <Link to="/login" className="text-sm text-primary hover:underline">
                  Back to sign in
                </Link>
              </div>
            </form>

            {/* Admin note */}
            <div className="rounded-lg border bg-muted/40 px-4 py-3">
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <ShieldAlert size={13} className="shrink-0 mt-0.5 text-primary" />
                New employee or email not working? Ask your CA firm administrator — they can set
                a new password directly from User Management.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
