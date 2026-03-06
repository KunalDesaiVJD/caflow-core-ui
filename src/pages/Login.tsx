import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Shield, FileCheck, Cpu } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Navigate } from "react-router-dom";

const FEATURES = [
  { icon: Shield, text: "TDS, ITR & GST compliance" },
  { icon: FileCheck, text: "Audit Intelligence with AI" },
  { icon: Cpu, text: "50+ automated scrutiny checks" },
];

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // MFA step
  const [mfaStep, setMfaStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [pendingSession, setPendingSession] = useState<any>(null);

  // Redirect guard — if already authenticated, go to dashboard
  if (!authLoading && user) {
    return <Navigate to={user.role === "superadmin" ? "/admin" : "/"} replace />;
  }

  const setUserContext = async (userId: string, userName: string, userRole: string) => {
    await supabase.rpc("set_user_context", {
      p_user_id: userId,
      p_user_name: userName,
      p_user_role: userRole,
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const session = data.session;
      const authUser = data.user;
      if (!session || !authUser) throw new Error("No session returned");

      // Fetch user profile from users table
      const { data: profile } = await supabase
        .from("users")
        .select("name, role, mfa_enabled, firm_id")
        .eq("id", authUser.id)
        .single();

      const role = profile?.role || authUser.user_metadata?.role || "staff";
      const name = profile?.name || authUser.email || "User";

      // Check MFA
      if (profile?.mfa_enabled) {
        setPendingSession({ user: authUser, session, role, name });
        setMfaStep(true);
        setLoading(false);
        return;
      }

      // Set context and redirect
      await setUserContext(authUser.id, name, role);

      if (role === "superadmin") {
        navigate("/admin", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err: any) {
      toast({
        title: "Sign in failed",
        description: err.message || "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async () => {
    if (otpCode.length !== 6 || !pendingSession) return;
    setLoading(true);

    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (!totp) throw new Error("No TOTP factor found");

      const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (!challenge) throw new Error("Challenge failed");

      const { error } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.id,
        code: otpCode,
      });
      if (error) throw error;

      const { role, name, user: authUser } = pendingSession;
      await setUserContext(authUser.id, name, role);

      if (role === "superadmin") {
        navigate("/admin", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err: any) {
      toast({
        title: "Verification failed",
        description: err.message || "Invalid code",
        variant: "destructive",
      });
      setOtpCode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Panel */}
      <div className="hidden lg:flex w-[40%] bg-sidebar flex-col items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-sidebar-gold/5 to-transparent" />
        <div className="relative z-10 text-center space-y-8">
          <div>
            <h1 className="text-4xl font-display font-bold">
              <span className="text-sidebar-gold">CA</span>
              <span className="text-sidebar-foreground">Flow</span>
            </h1>
            <p className="text-sidebar-foreground/70 mt-3 text-lg">
              Complete CA Practice Management
            </p>
          </div>

          <div className="space-y-4 text-left max-w-xs mx-auto">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-sidebar-gold/15 flex items-center justify-center shrink-0">
                  <f.icon className="h-4 w-4 text-sidebar-gold" />
                </div>
                <span className="text-sidebar-foreground/80 text-sm">{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-4">
            <h1 className="text-3xl font-display font-bold">
              <span className="text-primary">CA</span>
              <span className="text-foreground">Flow</span>
            </h1>
          </div>

          {!mfaStep ? (
            <>
              <div>
                <h2 className="text-2xl font-display font-bold text-foreground">
                  Sign in to CAFlow
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your credentials to access your practice
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Email</label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                  disabled={loading}
                >
                  {loading ? "Signing in…" : "Sign In"}
                </Button>

                <div className="text-center">
                  <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
              </form>
            </>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-display font-bold text-foreground">
                  Two-Factor Authentication
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter the 6-digit code from your authenticator app
                </p>
              </div>

              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                disabled={loading || otpCode.length !== 6}
                onClick={handleMfaVerify}
              >
                {loading ? "Verifying…" : "Verify"}
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => { setMfaStep(false); setOtpCode(""); setPendingSession(null); }}
              >
                Back to sign in
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
