import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

type Tab   = "signin" | "signup";
type Step  = "main" | "phone-entry" | "otp";

const COUNTRY_CODES = [
  { code: "+353", flag: "🇮🇪", label: "IE" },
  { code: "+44",  flag: "🇬🇧", label: "UK" },
  { code: "+1",   flag: "🇺🇸", label: "US" },
  { code: "+91",  flag: "🇮🇳", label: "IN" },
  { code: "+49",  flag: "🇩🇪", label: "DE" },
  { code: "+33",  flag: "🇫🇷", label: "FR" },
  { code: "+61",  flag: "🇦🇺", label: "AU" },
];

const Divider = () => (
  <div className="flex items-center gap-3 my-5">
    <div className="flex-1 h-px" style={{ background: "var(--color-border)" }} />
    <span className="font-sans text-xs" style={{ color: "rgba(30,41,24,0.45)" }}>or continue with</span>
    <div className="flex-1 h-px" style={{ background: "var(--color-border)" }} />
  </div>
);

const SocialBtn = ({
  icon, label, onClick, disabled,
}: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="flex items-center justify-center gap-2.5 w-full py-2.5 rounded-xl font-sans text-sm font-medium transition-all hover:opacity-85 active:scale-[0.98] disabled:opacity-50"
    style={{
      border: "1.5px solid var(--color-border)",
      background: "var(--color-cream-card)",
      color: "var(--color-forest-dark)",
    }}
  >
    {icon}
    {label}
  </button>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full px-4 py-3 rounded-xl font-sans text-sm outline-none transition-all ${props.className ?? ""}`}
    style={{
      background: "var(--color-sage-pale, #f3f0ea)",
      border: "1.5px solid var(--color-border)",
      color: "var(--color-forest-dark)",
      ...props.style,
    }}
  />
);

const PrimaryBtn = ({
  children, onClick, loading, disabled, type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled || loading}
    className="w-full py-3 rounded-xl font-display text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50 mt-1"
    style={{
      background: "var(--color-forest-dark)",
      color: "var(--color-cream-text)",
    }}
  >
    {loading ? (
      <span className="flex items-center justify-center gap-2">
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        Please wait…
      </span>
    ) : children}
  </button>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.6 32.9 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3L37.5 9.3C34.1 6.2 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.4 16.1 18.9 13 24 13c3.1 0 5.8 1.1 7.9 3L37.5 9.3C34.1 6.2 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.2 0-9.6-3.1-11.3-7.6l-6.6 5.1C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.9 2.4-2.5 4.5-4.6 6l6.2 5.2C36.9 36.8 44 31.2 44 24c0-1.3-.1-2.6-.4-3.9z"/>
  </svg>
);

const FacebookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2">
    <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.27h3.32l-.53 3.5h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/>
  </svg>
);

const PhoneIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M22 16.9v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13 1 .36 1.98.7 2.93a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.95.34 1.93.57 2.93.7A2 2 0 0122 16.9z"/>
  </svg>
);

// ── Main Modal ─────────────────────────────────────────────────────────────────

const AuthModal = () => {
  const {
    showAuthModal, closeAuthModal,
    signInWithGoogle, signInWithFacebook,
    signInWithPhone, verifyOtp,
    signInWithEmail, signUpWithEmail,
  } = useAuth();

  const [tab,       setTab]       = useState<Tab>("signin");
  const [step,      setStep]      = useState<Step>("main");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [success,   setSuccess]   = useState("");

  // Email/password fields
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [fullName,  setFullName]  = useState("");

  // Phone fields
  const [countryCode, setCountryCode] = useState("+353");
  const [phone,       setPhone]       = useState("");
  const [otp,         setOtp]         = useState("");
  const [fullPhone,   setFullPhone]   = useState("");

  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!showAuthModal) {
      setTimeout(() => {
        setStep("main"); setError(""); setSuccess("");
        setEmail(""); setPassword(""); setFullName("");
        setPhone(""); setOtp("");
      }, 300);
    }
  }, [showAuthModal]);

  const clear = () => { setError(""); setSuccess(""); };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    if (!email || !password) { setError("Please fill in all fields."); return; }
    setLoading(true);
    try {
      if (tab === "signin") {
        await signInWithEmail(email, password);
        closeAuthModal();
      } else {
        if (!fullName.trim()) { setError("Please enter your name."); setLoading(false); return; }
        await signUpWithEmail(email, password, fullName);
        closeAuthModal();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  // Google & Facebook are redirect-based — no async needed
  const handleGoogle   = () => { clear(); signInWithGoogle(); };
  const handleFacebook = () => { clear(); signInWithFacebook(); };

  const handleSendOtp = async () => {
    clear();
    const num = phone.replace(/\D/g, "");
    if (!num || num.length < 7) { setError("Please enter a valid phone number."); return; }
    const combined = `${countryCode}${num}`;
    setFullPhone(combined);
    setLoading(true);
    try {
      const result = await signInWithPhone(combined);
      // Dev mode: show OTP hint
      if (result?.dev_otp) setSuccess(`Dev mode — your code is: ${result.dev_otp}`);
      setStep("otp");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send OTP.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    clear();
    if (otp.length < 6) { setError("Please enter the 6-digit code."); return; }
    setLoading(true);
    try {
      await verifyOtp(fullPhone, otp);
      closeAuthModal();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {showAuthModal && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[150] flex items-center justify-center p-4"
          style={{ background: "rgba(20,28,16,0.55)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === overlayRef.current) closeAuthModal(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="relative w-full max-w-sm rounded-2xl overflow-hidden"
            style={{
              background: "var(--color-cream-card, #faf7f2)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.22)",
            }}
          >
            {/* Close button */}
            <button
              onClick={closeAuthModal}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-black/8 z-10"
              style={{ color: "rgba(30,41,24,0.5)" }}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 1l12 12M13 1L1 13"/>
              </svg>
            </button>

            <div className="px-7 pt-7 pb-8">
              {/* Brand mark */}
              <div className="mb-5 text-center">
                <div
                  className="inline-flex items-center justify-center w-10 h-10 rounded-full mb-3"
                  style={{ background: "var(--color-forest-dark)" }}
                >
                  <svg width="18" height="18" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M12 2a7 7 0 017 7c0 5-7 13-7 13S5 14 5 9a7 7 0 017-7z"/>
                    <circle cx="12" cy="9" r="2.5"/>
                  </svg>
                </div>

                {step === "main" && (
                  <>
                    <h2 className="font-display text-xl font-semibold" style={{ color: "var(--color-forest-dark)" }}>
                      {tab === "signin" ? "Welcome back" : "Create account"}
                    </h2>
                    <p className="font-sans text-sm mt-1" style={{ color: "rgba(30,41,24,0.55)" }}>
                      {tab === "signin" ? "Sign in to your account" : "Join The Olive Goose"}
                    </p>
                  </>
                )}
                {step === "phone-entry" && (
                  <>
                    <h2 className="font-display text-xl font-semibold" style={{ color: "var(--color-forest-dark)" }}>Phone sign-in</h2>
                    <p className="font-sans text-sm mt-1" style={{ color: "rgba(30,41,24,0.55)" }}>We'll send a verification code</p>
                  </>
                )}
                {step === "otp" && (
                  <>
                    <h2 className="font-display text-xl font-semibold" style={{ color: "var(--color-forest-dark)" }}>Enter code</h2>
                    <p className="font-sans text-sm mt-1" style={{ color: "rgba(30,41,24,0.55)" }}>
                      Sent to {fullPhone}
                    </p>
                  </>
                )}
              </div>

              {/* ── Tabs ── */}
              {step === "main" && (
                <div
                  className="flex rounded-xl p-1 mb-5"
                  style={{ background: "rgba(30,41,24,0.07)" }}
                >
                  {(["signin", "signup"] as Tab[]).map(t => (
                    <button
                      key={t}
                      onClick={() => { setTab(t); clear(); }}
                      className="flex-1 py-2 rounded-lg font-display text-sm font-medium transition-all"
                      style={{
                        background: tab === t ? "var(--color-forest-dark)" : "transparent",
                        color: tab === t ? "var(--color-cream-text)" : "rgba(30,41,24,0.55)",
                      }}
                    >
                      {t === "signin" ? "Sign In" : "Sign Up"}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Error / Success banners ── */}
              {error && (
                <div className="mb-4 px-4 py-2.5 rounded-xl font-sans text-sm" style={{ background: "#fee2e2", color: "#b91c1c" }}>
                  {error}
                </div>
              )}
              {success && (
                <div className="mb-4 px-4 py-2.5 rounded-xl font-sans text-sm" style={{ background: "#dcfce7", color: "#15803d" }}>
                  {success}
                </div>
              )}

              {/* ── Main step: email form + social ── */}
              {step === "main" && (
                <>
                  <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
                    {tab === "signup" && (
                      <Input
                        placeholder="Full name"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                        autoComplete="name"
                      />
                    )}
                    <Input
                      type="email"
                      placeholder="Email address"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete={tab === "signin" ? "current-password" : "new-password"}
                    />
                    <PrimaryBtn type="submit" loading={loading}>
                      {tab === "signin" ? "Sign In" : "Create Account"}
                    </PrimaryBtn>
                  </form>

                  <Divider />

                  <div className="flex flex-col gap-2.5">
                    <SocialBtn
                      icon={<GoogleIcon />}
                      label="Continue with Google"
                      onClick={handleGoogle}
                      disabled={loading}
                    />
                    <SocialBtn
                      icon={<FacebookIcon />}
                      label="Continue with Facebook"
                      onClick={handleFacebook}
                      disabled={loading}
                    />
                    <SocialBtn
                      icon={<PhoneIcon />}
                      label="Continue with Phone"
                      onClick={() => { clear(); setStep("phone-entry"); }}
                      disabled={loading}
                    />
                  </div>
                </>
              )}

              {/* ── Phone entry step ── */}
              {step === "phone-entry" && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    {/* Country code selector */}
                    <select
                      value={countryCode}
                      onChange={e => setCountryCode(e.target.value)}
                      className="px-3 py-3 rounded-xl font-sans text-sm outline-none"
                      style={{
                        background: "var(--color-sage-pale, #f3f0ea)",
                        border: "1.5px solid var(--color-border)",
                        color: "var(--color-forest-dark)",
                        minWidth: 90,
                      }}
                    >
                      {COUNTRY_CODES.map(c => (
                        <option key={c.code} value={c.code}>
                          {c.flag} {c.code}
                        </option>
                      ))}
                    </select>

                    <Input
                      type="tel"
                      placeholder="Phone number"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      autoComplete="tel"
                      className="flex-1"
                    />
                  </div>

                  <PrimaryBtn onClick={handleSendOtp} loading={loading}>
                    Send Code
                  </PrimaryBtn>

                  <button
                    onClick={() => { setStep("main"); clear(); }}
                    className="font-sans text-sm text-center transition-opacity hover:opacity-60"
                    style={{ color: "rgba(30,41,24,0.5)" }}
                  >
                    ← Back
                  </button>
                </div>
              )}

              {/* ── OTP step ── */}
              {step === "otp" && (
                <div className="flex flex-col items-center gap-5">
                  <InputOTP
                    maxLength={6}
                    value={otp}
                    onChange={setOtp}
                  >
                    <InputOTPGroup>
                      {[0,1,2,3,4,5].map(i => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>

                  <div className="w-full flex flex-col gap-2.5">
                    <PrimaryBtn onClick={handleVerifyOtp} loading={loading}>
                      Verify Code
                    </PrimaryBtn>
                    <button
                      onClick={() => { setOtp(""); handleSendOtp(); }}
                      disabled={loading}
                      className="font-sans text-sm text-center transition-opacity hover:opacity-60"
                      style={{ color: "rgba(30,41,24,0.5)" }}
                    >
                      Resend code
                    </button>
                    <button
                      onClick={() => { setStep("phone-entry"); clear(); setOtp(""); }}
                      className="font-sans text-sm text-center transition-opacity hover:opacity-60"
                      style={{ color: "rgba(30,41,24,0.5)" }}
                    >
                      ← Change number
                    </button>
                  </div>
                </div>
              )}

              {/* Footer note */}
              {step === "main" && (
                <p className="font-sans text-xs text-center mt-5" style={{ color: "rgba(30,41,24,0.38)" }}>
                  By continuing you agree to our{" "}
                  <a href="#" className="underline">Terms</a> &amp;{" "}
                  <a href="#" className="underline">Privacy Policy</a>
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AuthModal;
