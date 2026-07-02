import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  userLogin, registerStart, registerVerify, userMe, sendOtp, verifyOtp as apiVerifyOtp,
  googleOAuthUrl, facebookOAuthUrl, updateProfile as apiUpdateProfile,
  forgotPassword as apiForgotPassword, resetPassword as apiResetPassword,
  logoutUser,
  type AppUser, type ProfileUpdate,
} from "@/lib/userApi";

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
  signOut: () => void;
  completeOAuthLogin: () => Promise<boolean>;
  updateProfile: (update: ProfileUpdate) => Promise<void>;
  showAuthModal: boolean;
  sessionExpired: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  // If signed in, runs `action` right away. Otherwise opens the sign-in modal and
  // runs `action` automatically the moment sign-in succeeds — so a user who gets
  // bounced mid-checkout (or any auth-gated action) resumes right where they left off.
  requireAuth: (action: () => void) => void;
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

  // Restore session on mount (cookie, if any, is validated server-side)
  useEffect(() => {
    userMe().then(u => { setUser(u); setLoading(false); });
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
      userMe().then(setUser);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Called after every successful sign-in path: clears the "expired" banner,
  // resumes whatever the user was trying to do, and pings other tabs.
  const onAuthenticated = (u: AppUser) => {
    setUser(u);
    setSessionExpired(false);
    broadcastAuthChange();
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) action();
  };

  const requireAuth = (action: () => void) => {
    if (user) { action(); return; }
    pendingActionRef.current = action;
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
  const signInWithGoogle   = () => { window.location.href = googleOAuthUrl(); };
  const signInWithFacebook = () => { window.location.href = facebookOAuthUrl(); };

  // Called from /auth/callback once the backend has already set the cookie.
  const completeOAuthLogin = async () => {
    const u = await userMe();
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

  const signOut = () => {
    logoutUser();
    setUser(null);
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
      closeAuthModal: () => { setShowAuthModal(false); setSessionExpired(false); pendingActionRef.current = null; },
      requireAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
