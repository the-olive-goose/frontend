import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { consumeAuthReturn } from "@/lib/authReturn";
import { track } from "@/lib/analytics";

// How the account was originally created, phrased for a shopper who has no idea
// what a "provider" is.
const PROVIDER_LABEL: Record<string, string> = {
  email:    "an email address and password",
  facebook: "Facebook",
  phone:    "a phone number",
};

// The backend can only signal failures through a redirect query param, so it sends
// short codes. Turn them into something a customer can actually act on — an
// undecoded code like "account_exists" on a dead-end screen is not an error
// message, it's a shrug.
const errorMessage = (code: string, provider: string | null): string => {
  switch (code) {
    case "account_exists":
      return `You already have an account with this email — it was set up with ${
        PROVIDER_LABEL[provider ?? ""] ?? "a different sign-in method"
      }. Please sign in that way instead.`;
    case "email_not_verified":
      return "Google hasn't verified the email address on that account, so we can't use it to sign you in.";
    case "state_mismatch":
      return "That sign-in attempt expired or didn't start from this site. Please try again.";
    case "no_code":
      return "Google didn't finish the sign-in. Please try again.";
    case "oauth_failed":
      return "Something went wrong signing in with Google. Please try again.";
    default:
      return "We couldn't complete your sign-in. Please try again.";
  }
};

const AuthCallback = () => {
  const [params]        = useSearchParams();
  const { completeOAuthLogin, openAuthModal } = useAuth();
  const navigate        = useNavigate();
  const [error, setError] = useState("");
  // account_exists is the one failure the shopper can fix on the spot, so it gets
  // a button to the sign-in form rather than a silent bounce to the homepage.
  const [showSignIn, setShowSignIn] = useState(false);
  // Where the sign-in started. Read once per mount and cleared from storage in the
  // same breath, so a later visit to this screen can't reuse it. Falls back to the
  // homepage when nothing was recorded (storage blocked, or someone opening
  // /auth/callback directly). Success or failure, the shopper goes back where they
  // were — dumping a checkout sign-in on the homepage is how a paid-for basket
  // gets abandoned.
  const [returnTo] = useState(() => consumeAuthReturn() ?? "/");

  useEffect(() => {
    const err = params.get("error");

    if (err) {
      const code = decodeURIComponent(err);
      setError(errorMessage(code, params.get("provider")));
      if (code === "account_exists") { setShowSignIn(true); return; }
      setTimeout(() => navigate(returnTo, { replace: true }), 3000);
      return;
    }

    // The backend already set the session cookie during the OAuth redirect —
    // just confirm it took and load the user.
    completeOAuthLogin().then(ok => {
      if (ok) {
        // The only place a Google sign-in can be reported. Signing in with
        // Google is a full-page round trip through the backend, so it never
        // passes through the sign-in form that fires these events — every
        // account opened this way was invisible to analytics, to GA4 and to the
        // Pixel, and the panel read "sign-ups: 0" on a day one had happened.
        //
        // `new=1` is set by the backend, which is the only side that knows
        // whether the account already existed. Tracked BEFORE navigating: the
        // redirect replaces this page, and an event queued after it is a race.
        track(params.get("new") === "1" ? "signup" : "login", { method: "google" });
        navigate(returnTo, { replace: true });
        return;
      }
      setError("Failed to complete sign-in. Please try again.");
      setTimeout(() => navigate(returnTo, { replace: true }), 3000);
    });
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-page)" }}>
        <div className="text-center px-6">
          <p className="font-display text-lg mb-2" style={{ color: "var(--color-forest-dark)" }}>Sign-in failed</p>
          <p className="font-sans text-sm max-w-sm mx-auto" style={{ color: "rgba(30,41,24,0.6)" }}>{error}</p>
          {showSignIn ? (
            <button
              onClick={() => { navigate(returnTo, { replace: true }); openAuthModal(); }}
              className="mt-5 px-6 py-2.5 min-h-[44px] font-sans text-sm font-bold rounded-full transition-all hover:brightness-95 active:scale-[0.98]"
              style={{ background: "var(--color-gold)", color: "var(--color-forest-dark)" }}
            >
              Sign in instead
            </button>
          ) : (
            <p className="font-sans text-xs mt-3" style={{ color: "rgba(30,41,24,0.4)" }}>
              {returnTo === "/" ? "Redirecting you home…" : "Taking you back…"}
            </p>
          )}
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
