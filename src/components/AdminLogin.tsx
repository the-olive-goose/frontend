import { useState } from "react";
import { login, requestAdminPasswordReset } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo.jpg";

const AdminLogin = ({ onLogin }: { onLogin: () => void }) => {
  const [view, setView] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(email, password);
      onLogin();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      // Show the full technical error so we can diagnose it
      toast({
        title: "Login failed",
        description: message,
        variant: "destructive",
        duration: 10000,
      });
      console.error("[AdminLogin] error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await requestAdminPasswordReset(email);
      setForgotSent(true);
    } catch (err: unknown) {
      toast({
        title: "Something went wrong",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={logo} alt="The Olive Goose" className="w-20 h-20 mx-auto mb-4" width={512} height={512} />
          <h1 className="font-serif text-2xl text-foreground">Admin Panel</h1>
          <p className="text-muted-foreground text-sm mt-1 font-sans">
            {view === "login" ? "Sign in to manage your site" : "Reset your admin password"}
          </p>
        </div>

        {view === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-sans text-sm"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-sans text-sm"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium tracking-wider uppercase hover:bg-olive-light transition-all disabled:opacity-50"
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </button>
            <button
              type="button"
              onClick={() => { setView("forgot"); setForgotSent(false); }}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline font-sans"
            >
              Forgot password?
            </button>
          </form>
        ) : forgotSent ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-foreground font-sans">
              If <span className="font-medium">{email}</span> is a registered admin account, a password reset
              link has been sent. It expires in 15 minutes and can only be used once.
            </p>
            <button
              type="button"
              onClick={() => setView("login")}
              className="w-full py-3 rounded-lg border border-border text-foreground font-sans text-sm font-medium tracking-wider uppercase hover:bg-card transition-all"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleForgot} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              autoFocus
              className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-sans text-sm"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium tracking-wider uppercase hover:bg-olive-light transition-all disabled:opacity-50"
            >
              {isLoading ? "Sending..." : "Send reset link"}
            </button>
            <button
              type="button"
              onClick={() => setView("login")}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline font-sans"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default AdminLogin;
