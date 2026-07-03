import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { confirmAdminPasswordReset } from "@/lib/api";
import logo from "@/assets/logo.jpg";

const AdminResetPassword = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    try {
      await confirmAdminPasswordReset(token, password);
      setDone(true);
      setTimeout(() => navigate("/admin"), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={logo} alt="The Olive Goose" className="w-20 h-20 mx-auto mb-4" width={512} height={512} />
          <h1 className="font-serif text-2xl text-foreground">Reset admin password</h1>
        </div>

        {!token ? (
          <p className="text-sm text-center text-destructive font-sans">
            This link is missing its reset token. Please use the link from your email.
          </p>
        ) : done ? (
          <p className="text-sm text-center text-foreground font-sans">
            Password reset. Redirecting you to sign in…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="text-sm text-destructive font-sans">{error}</p>
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              required
              autoFocus
              className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-sans text-sm"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              required
              className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-sans text-sm"
            />
            <p className="text-xs text-muted-foreground font-sans">
              At least 8 characters, with a letter and a number.
            </p>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium tracking-wider uppercase hover:bg-olive-light transition-all disabled:opacity-50"
            >
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default AdminResetPassword;
