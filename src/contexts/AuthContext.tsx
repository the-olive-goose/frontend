import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  userLogin, registerStart, registerVerify, userMe, sendOtp, verifyOtp as apiVerifyOtp,
  googleOAuthUrl, facebookOAuthUrl, updateProfile as apiUpdateProfile,
  forgotPassword as apiForgotPassword, resetPassword as apiResetPassword,
  logoutUser,
  type AppUser, type ProfileUpdate,
} from "@/lib/userApi";
import { rememberAuthReturn, clearAuthReturn } from "@/lib/authReturn";

// Bumped in localStorage on every sign-in/out so OTHER tabs notice and re-sync —
// carries no secret (the real session lives in an httpOnly cookie), it's just a signal.
const AUTH_PULSE_KEY = "og_auth_pulse";
const broadcastAuthChange = () => localStorage.setItem(AUTH_PULSE_KEY, Date.now().toString());

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string, remember?: boolean) => Promise<void>;
  startSignup: (email: string, password: string, fullName: string) => Promise<{ dev_otp?: string }>;
  verifySignup: (email: string, otp: string) => Promise<void>;
  signInWithGoogle: () => void;
  signInWithFacebook: () => void;
  signInWithPhone: (phone: string) => Promise<{ dev_otp?: string }>;
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ dev_otp?: string }>;
  confirmPasswordReset: (email: string, otp: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  completeOAuthLogin: () => Promise<boolean>;
  updateProfile: (update: ProfileUpdate) => Promise<void>;
  showAuthModal: boolean;
  sessionExpired: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  // If signed in, runs `action` right away. Otherwise opens the sign-in modal and
  // runs `action` automatically the moment sign-in succeeds — so a user who gets
  // bounced mid-checkout (or any auth-gated action) resumes right where they left off.
  // `resumePath` covers the one case the callback can't: signing in with Google is
  // a full-page round trip that destroys `action`, so a gate that was sending the
  // shopper somewhere else (basket → /checkout) names that destination here and
  // /auth/callback lands them on it. Omit it when the action stays on this page.
  requireAuth: (action: () => void, resumePath?: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser]                   = useState<AppUser | null>(null);
  const [loading, setLoading]             = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  // The destination behind the pending action, kept separately because it has to
  // survive what the action can't: the full-page hop to an OAuth provider.
  const pendingPathRef   = useRef<string | null>(null);
  // Guards the revalidation below: a shopper flicking between tabs shouldn't
  // fire a /me per switch.
  const lastCheckRef = useRef(0);
  // Read by the revalidation listeners, which are registered once and would
  // otherwise close over the user as it was on mount.
  const userRef = useRef<AppUser | null>(null);
  useEffect(() => { userRef.current = user; }, [user]);

  // Restore session on mount (cookie, if any, is validated server-side).
  // A network failure is NOT a verdict on the session (see userMe), so it retries
  // once before settling on "signed out" — and never flags the session as expired,
  // which would wrongly push the sign-in modal at someone who never lost it.
  useEffect(() => {
    let alive = true;
    const settle = (u: AppUser | null) => { if (alive) { setUser(u); setLoading(false); } };
    userMe()
      .then(settle)
      .catch(() => new Promise(r => setTimeout(r, 1500)).then(() => userMe().then(settle).catch(() => settle(null))));
    return () => { alive = false; };
  }, []);

  // Revalidate when the customer comes back to the tab. Sessions end for reasons
  // this tab can't see — signed out on another device, password changed, idle
  // window lapsed — and without this the stale header would keep saying "signed
  // in" until some action failed, typically at the worst moment (checkout).
  // Throttled, and skipped entirely while signed out so it can't become a poller.
  useEffect(() => {
    const REVALIDATE_AFTER_MS = 60_000;
    const revalidate = () => {
      if (!userRef.current || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheckRef.current < REVALIDATE_AFTER_MS) return;
      lastCheckRef.current = now;
      userMe()
        .then(u => {
          if (u) { setUser(u); return; }
          // Server says the session is gone: same treatment as any other 401.
          setUser(null);
          setSessionExpired(true);
        })
        // Offline/flaky — keep the user as they are and try again next time.
        .catch(() => { lastCheckRef.current = 0; });
    };
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    // Back/forward restores a fully rendered page from the bfcache without ever
    // running the mount effect — the one case where the UI can be arbitrarily old.
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) { lastCheckRef.current = 0; revalidate(); } };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // A 401 anywhere in the app → drop the local user, surface the sign-in modal
  // with a clear "expired" message. Whoever triggered it can also call
  // requireAuth() in their catch block to auto-resume once the user re-signs in.
  useEffect(() => {
    const handler = () => {
      setUser(null);
      setSessionExpired(true);
      setShowAuthModal(true);
    };
    window.addEventListener("og:session-expired", handler);
    return () => window.removeEventListener("og:session-expired", handler);
  }, []);

  // Cross-tab sync: another tab signing in/out re-checks our session too.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== AUTH_PULSE_KEY) return;
      lastCheckRef.current = Date.now();
      // Ignore a failed check here rather than signing the tab out on a blip —
      // the other tab's pulse is a hint to re-read, not evidence of anything.
      userMe().then(setUser).catch(() => {});
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Called after every successful sign-in path: clears the "expired" banner,
  // resumes whatever the user was trying to do, and pings other tabs.
  const onAuthenticated = (u: AppUser) => {
    setUser(u);
    setSessionExpired(false);
    lastCheckRef.current = Date.now();
    broadcastAuthChange();
    // Signed in without leaving the page, so the stored OAuth destination (if a
    // provider button was tapped and abandoned earlier) is stale — drop it before
    // it can hijack some later callback.
    pendingPathRef.current = null;
    clearAuthReturn();
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) action();
  };

  const requireAuth = (action: () => void, resumePath?: string) => {
    if (user) { action(); return; }
    pendingActionRef.current = action;
    pendingPathRef.current   = resumePath ?? null;
    setShowAuthModal(true);
  };

  const signInWithEmail = async (email: string, password: string, remember = true) => {
    const { user } = await userLogin(email, password, remember);
    onAuthenticated(user);
  };

  // Two-step signup: request a code, then verify it to create the account.
  const startSignup = async (email: string, password: string, fullName: string) => {
    return registerStart(email, password, fullName);
  };

  const verifySignup = async (email: string, otp: string) => {
    const { user } = await registerVerify(email, otp);
    onAuthenticated(user);
  };

  // OAuth — full-page redirect to backend, which sets the session cookie itself
  // and redirects back to /auth/callback (no token ever touches the URL/frontend).
  // Nothing in React survives that round trip, so where the shopper was headed is
  // written to sessionStorage first and read back by the callback screen.
  const startOAuth = (url: string) => {
    rememberAuthReturn(pendingPathRef.current);
    window.location.href = url;
  };
  const signInWithGoogle   = () => { startOAuth(googleOAuthUrl()); };
  const signInWithFacebook = () => { startOAuth(facebookOAuthUrl()); };

  // Called from /auth/callback once the backend has already set the cookie.
  const completeOAuthLogin = async () => {
    const u = await userMe().catch(() => null);
    if (u) onAuthenticated(u);
    return !!u;
  };

  const signInWithPhone = async (phone: string) => {
    return sendOtp(phone);
  };

  const verifyOtp = async (phone: string, otp: string) => {
    const { user } = await apiVerifyOtp(phone, otp);
    onAuthenticated(user);
  };

  const requestPasswordReset = async (email: string) => apiForgotPassword(email);

  const confirmPasswordReset = async (email: string, otp: string, newPassword: string) => {
    const { user } = await apiResetPassword(email, otp, newPassword);
    onAuthenticated(user);
  };

  // Local state clears immediately (signing out should feel instant), but the
  // other tabs are only pulsed once the server has actually revoked the session —
  // pulse first and they'd re-read /me mid-revoke and stay "signed in".
  const signOut = async () => {
    setUser(null);
    setSessionExpired(false);
    lastCheckRef.current = Date.now();
    await logoutUser();
    broadcastAuthChange();
  };

  const updateProfile = async (update: ProfileUpdate) => {
    const updated = await apiUpdateProfile(update);
    setUser(updated);
  };

  return (
    <AuthContext.Provider value={{
      user, loading,
      signInWithEmail, startSignup, verifySignup,
      signInWithGoogle, signInWithFacebook,
      signInWithPhone, verifyOtp,
      requestPasswordReset, confirmPasswordReset,
      signOut, completeOAuthLogin, updateProfile,
      showAuthModal, sessionExpired,
      openAuthModal:  () => setShowAuthModal(true),
      closeAuthModal: () => {
        setShowAuthModal(false);
        setSessionExpired(false);
        pendingActionRef.current = null;
        pendingPathRef.current   = null;
        clearAuthReturn();
      },
      requireAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
