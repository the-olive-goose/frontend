import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  getToken, setToken, clearToken,
  userLogin, registerStart, registerVerify, userMe, sendOtp, verifyOtp as apiVerifyOtp,
  googleOAuthUrl, facebookOAuthUrl,
  type AppUser,
} from "@/lib/userApi";

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  startSignup: (email: string, password: string, fullName: string) => Promise<{ dev_otp?: string }>;
  verifySignup: (email: string, otp: string) => Promise<void>;
  signInWithGoogle: () => void;
  signInWithFacebook: () => void;
  signInWithPhone: (phone: string) => Promise<{ dev_otp?: string }>;
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  signOut: () => void;
  loginWithToken: (token: string) => Promise<void>;
  showAuthModal: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
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

  // Restore session on mount
  useEffect(() => {
    userMe().then(u => { setUser(u); setLoading(false); });
  }, []);

  const loginWithToken = async (token: string) => {
    setToken(token);
    const u = await userMe();
    setUser(u);
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { token, user } = await userLogin(email, password);
    setToken(token);
    setUser(user);
  };

  // Two-step signup: request a code, then verify it to create the account.
  const startSignup = async (email: string, password: string, fullName: string) => {
    return registerStart(email, password, fullName);
  };

  const verifySignup = async (email: string, otp: string) => {
    const { token, user } = await registerVerify(email, otp);
    setToken(token);
    setUser(user);
  };

  // OAuth — full-page redirect to backend, which redirects back to /auth/callback
  const signInWithGoogle   = () => { window.location.href = googleOAuthUrl(); };
  const signInWithFacebook = () => { window.location.href = facebookOAuthUrl(); };

  const signInWithPhone = async (phone: string) => {
    return sendOtp(phone);
  };

  const verifyOtp = async (phone: string, otp: string) => {
    const { token, user } = await apiVerifyOtp(phone, otp);
    setToken(token);
    setUser(user);
  };

  const signOut = () => {
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user, loading,
      signInWithEmail, startSignup, verifySignup,
      signInWithGoogle, signInWithFacebook,
      signInWithPhone, verifyOtp,
      signOut, loginWithToken,
      showAuthModal,
      openAuthModal:  () => setShowAuthModal(true),
      closeAuthModal: () => setShowAuthModal(false),
    }}>
      {children}
    </AuthContext.Provider>
  );
};
