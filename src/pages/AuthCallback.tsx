import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const AuthCallback = () => {
  const [params]        = useSearchParams();
  const { loginWithToken } = useAuth();
  const navigate        = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = params.get("token");
    const err   = params.get("error");

    if (err) {
      setError(decodeURIComponent(err));
      setTimeout(() => navigate("/"), 3000);
      return;
    }

    if (token) {
      loginWithToken(token).then(() => navigate("/")).catch(() => {
        setError("Failed to complete sign-in. Please try again.");
        setTimeout(() => navigate("/"), 3000);
      });
    } else {
      navigate("/");
    }
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-page)" }}>
        <div className="text-center px-6">
          <p className="font-display text-lg mb-2" style={{ color: "var(--color-forest-dark)" }}>Sign-in failed</p>
          <p className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.6)" }}>{error}</p>
          <p className="font-sans text-xs mt-3" style={{ color: "rgba(30,41,24,0.4)" }}>Redirecting you home…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <div className="flex flex-col items-center gap-4">
        <svg className="animate-spin w-8 h-8" fill="none" viewBox="0 0 24 24" style={{ color: "var(--color-forest-dark)" }}>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        <p className="font-display text-base" style={{ color: "var(--color-forest-dark)" }}>Signing you in…</p>
      </div>
    </div>
  );
};

export default AuthCallback;
