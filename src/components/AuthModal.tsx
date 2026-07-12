import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { getAuthProviders } from "@/lib/userApi";
import { track } from "@/lib/analytics";

type View = "signin" | "signup" | "verify" | "forgot" | "reset";


// ── Shared input ───────────────────────────────────────────────────────────────

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label className="block font-sans text-sm font-medium" style={{ color: "#0F1111" }}>{label}</label>
    {children}
  </div>
);

const TextInput = (props: React.InputHTMLAttributes<HTMLInputElement> & { showToggle?: boolean; show?: boolean; onToggle?: () => void }) => {
  const { showToggle, show, onToggle, ...rest } = props;
  return (
    <div className="relative">
      <input
        {...rest}
        className="w-full px-3.5 py-2.5 font-sans text-sm outline-none transition-all"
        style={{ background: "#fff", border: "1px solid #888", borderRadius: 6, color: "#0F1111", boxShadow: "none", ...props.style }}
        onFocus={e => { e.currentTarget.style.borderColor = "#e77600"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(231,118,0,0.25)"; }}
        onBlur={e => { e.currentTarget.style.borderColor = "#888"; e.currentTarget.style.boxShadow = "none"; }}
      />
      {showToggle && (
        <button type="button" onClick={onToggle} tabIndex={-1}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700">
          {show ? (
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" viewBox="0 0 24 24">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" viewBox="0 0 24 24">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      )}
    </div>
  );
};

const PrimaryBtn = ({ children, loading, disabled, type = "button", onClick }: {
  children: React.ReactNode; loading?: boolean; disabled?: boolean;
  type?: "button" | "submit"; onClick?: () => void;
}) => (
  <button type={type} onClick={onClick} disabled={disabled || loading}
    className="w-full py-2.5 font-sans text-sm font-bold rounded-full transition-all disabled:opacity-50 hover:brightness-95 active:scale-[0.98]"
    style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111", borderRadius: 8 }}>
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

const Divider = ({ label = "or" }: { label?: string }) => (
  <div className="flex items-center gap-3 my-4">
    <div className="flex-1 h-px bg-gray-300" />
    <span className="font-sans text-xs text-gray-500">{label}</span>
    <div className="flex-1 h-px bg-gray-300" />
  </div>
);

const SocialBtn = ({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) => (
  <button onClick={onClick}
    className="flex items-center justify-center gap-2.5 w-full py-2.5 rounded font-sans text-sm font-medium transition-all hover:bg-gray-50 active:scale-[0.98]"
    style={{ border: "1px solid #888", background: "#fff", color: "#0F1111", borderRadius: 6 }}>
    {icon}{label}
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


// ── Main Modal ─────────────────────────────────────────────────────────────────

const AuthModal = () => {
  const {
    showAuthModal, closeAuthModal, sessionExpired,
    signInWithGoogle, signInWithEmail, startSignup, verifySignup,
    requestPasswordReset, confirmPasswordReset,
  } = useAuth();

  const [view,     setView]     = useState<View>("signin");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [fullName, setFullName] = useState("");
  const [otp,      setOtp]      = useState("");
  const [devOtp,   setDevOtp]   = useState("");   // shown only in dev mode (no email provider)
  const [resendIn, setResendIn] = useState(0);    // seconds left on the resend cooldown
  const [newPassword,   setNewPassword]   = useState("");
  const [showNewPass,   setShowNewPass]   = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Hide the Google button rather than let it hard-navigate to a raw error
  // page when GOOGLE_CLIENT_ID isn't configured on the backend.
  useEffect(() => {
    getAuthProviders().then(p => setGoogleEnabled(p.google));
  }, []);

  useEffect(() => {
    if (!showAuthModal) {
      setTimeout(() => {
        setView("signin"); setError("");
        setEmail(""); setPassword(""); setFullName(""); setShowPass(false);
        setOtp(""); setDevOtp(""); setResendIn(0); setRemember(true);
        setNewPassword(""); setShowNewPass(false);
      }, 300);
    }
  }, [showAuthModal]);

  // If the session expired while the modal was closed, jump straight to sign-in
  // with the "expired" banner visible — the user is never left staring at signup.
  useEffect(() => {
    if (showAuthModal && sessionExpired) setView("signin");
  }, [showAuthModal, sessionExpired]);

  // Resend cooldown ticker
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const clear = () => setError("");

  // Send (or resend) the signup verification code, then move to the verify view.
  const sendSignupCode = async () => {
    const { dev_otp } = await startSignup(email, password, fullName);
    setDevOtp(dev_otp ?? "");
    setResendIn(60);
    setView("verify");
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); clear();
    if (!email || !password) { setError("Please fill in all fields."); return; }
    setLoading(true);
    try {
      if (view === "signin") {
        await signInWithEmail(email, password, remember);
        track("login", { method: "email" });
        closeAuthModal();
      } else {
        if (!fullName.trim()) { setError("Please enter your name."); setLoading(false); return; }
        await sendSignupCode();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setLoading(false); }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault(); clear();
    if (otp.trim().length !== 6) { setError("Enter the 6-digit code from your email."); return; }
    setLoading(true);
    try {
      await verifySignup(email, otp.trim());
      track("signup", { method: "email" });
      closeAuthModal();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    clear(); setLoading(true);
    try {
      await sendSignupCode();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not resend the code.");
    } finally { setLoading(false); }
  };

  // Send (or resend) the password-reset code, then move to the reset view.
  const sendResetCode = async () => {
    const { dev_otp } = await requestPasswordReset(email);
    setDevOtp(dev_otp ?? "");
    setResendIn(60);
    setView("reset");
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); clear();
    if (!email.trim()) { setError("Please enter your email address."); return; }
    setLoading(true);
    try {
      await sendResetCode();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send reset code.");
    } finally { setLoading(false); }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); clear();
    if (otp.trim().length !== 6) { setError("Enter the 6-digit code from your email."); return; }
    if (!newPassword) { setError("Please enter a new password."); return; }
    setLoading(true);
    try {
      await confirmPasswordReset(email, otp.trim(), newPassword);
      closeAuthModal(); // confirmPasswordReset already signs the user in
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally { setLoading(false); }
  };

  const handleResendReset = async () => {
    if (resendIn > 0) return;
    clear(); setLoading(true);
    try {
      await sendResetCode();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not resend the code.");
    } finally { setLoading(false); }
  };

  return (
    <AnimatePresence>
      {showAuthModal && (
        <motion.div ref={overlayRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[150] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={e => { if (e.target === overlayRef.current) closeAuthModal(); }}>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative w-full max-w-sm rounded-lg overflow-hidden"
            style={{ background: "#fff", border: "1px solid #ddd", boxShadow: "0 4px 32px rgba(0,0,0,0.24)" }}>

            {/* Close */}
            <button onClick={closeAuthModal}
              className="absolute top-4 right-5 font-sans text-xl font-light text-gray-400 hover:text-gray-700 transition-colors z-10"
              aria-label="Close">×</button>

            <div className="px-8 pt-7 pb-8">

              {/* ── Sign In view ── */}
              {view === "signin" && (
                <>
                  <h1 className="font-sans text-2xl font-bold mb-0.5" style={{ color: "#0F1111" }}>Sign in</h1>
                  <p className="font-sans text-xs font-semibold tracking-widest uppercase mb-5" style={{ color: "#C7511F" }}>
                    The Olive Goose
                  </p>

                  {sessionExpired && (
                    <div className="mb-4 px-3 py-2.5 rounded font-sans text-sm" style={{ background: "#fdf0e6", border: "1px solid #e77600", color: "#111" }}>
                      Your session has expired — please sign in again to continue.
                    </div>
                  )}
                  {error && <div className="mb-4 px-3 py-2.5 rounded font-sans text-sm" style={{ background: "#fff3cd", border: "1px solid #e77600", color: "#111" }}>{error}</div>}

                  <form onSubmit={handleEmailSubmit} className="space-y-4">
                    <Field label="Email address">
                      <TextInput type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
                    </Field>
                    <Field label="Password">
                      <TextInput type={showPass ? "text" : "password"} placeholder="Your password" value={password}
                        onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                        showToggle show={showPass} onToggle={() => setShowPass(s => !s)} />
                    </Field>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 font-sans text-sm select-none cursor-pointer" style={{ color: "#0F1111" }}>
                        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
                          className="accent-current" style={{ accentColor: "#e77600" }} />
                        Keep me signed in
                      </label>
                      <button type="button" onClick={() => { clear(); setEmail(email); setView("forgot"); }}
                        className="font-sans text-sm hover:underline" style={{ color: "#007185" }}>
                        Forgot password?
                      </button>
                    </div>
                    <PrimaryBtn type="submit" loading={loading}>Sign In</PrimaryBtn>
                  </form>

                  {googleEnabled && (
                    <>
                      <Divider />
                      <div className="space-y-2.5">
                        <SocialBtn icon={<GoogleIcon />} label="Continue with Google" onClick={() => { clear(); signInWithGoogle(); }} />
                      </div>
                    </>
                  )}

                  <Divider label="New to The Olive Goose?" />

                  <button onClick={() => { clear(); setView("signup"); }}
                    className="w-full py-2.5 font-sans text-sm font-semibold rounded transition-all hover:bg-gray-50"
                    style={{ border: "1px solid #888", background: "#fff", color: "#0F1111", borderRadius: 6 }}>
                    Create account
                  </button>

                  <p className="font-sans text-xs text-center mt-4" style={{ color: "#888" }}>
                    By continuing you agree to our{" "}
                    <a href="/terms-of-service" className="underline text-blue-600">Terms</a> &amp;{" "}
                    <a href="/privacy-policy" className="underline text-blue-600">Privacy Policy</a>
                  </p>
                </>
              )}

              {/* ── Sign Up view ── */}
              {view === "signup" && (
                <>
                  <h1 className="font-sans text-2xl font-bold mb-0.5" style={{ color: "#0F1111" }}>Create account</h1>
                  <p className="font-sans text-xs font-semibold tracking-widest uppercase mb-5" style={{ color: "#C7511F" }}>
                    The Olive Goose
                  </p>

                  {error && <div className="mb-4 px-3 py-2.5 rounded font-sans text-sm" style={{ background: "#fff3cd", border: "1px solid #e77600", color: "#111" }}>{error}</div>}

                  <form onSubmit={handleEmailSubmit} className="space-y-4">
                    <Field label="Your name">
                      <TextInput placeholder="First and last name" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" />
                    </Field>
                    <Field label="Email address">
                      <TextInput type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
                    </Field>
                    <Field label="Password">
                      <TextInput type={showPass ? "text" : "password"} placeholder="At least 8 characters" value={password}
                        onChange={e => setPassword(e.target.value)} autoComplete="new-password"
                        showToggle show={showPass} onToggle={() => setShowPass(s => !s)} />
                      <p className="font-sans text-xs mt-1" style={{ color: "#888" }}>
                        At least 8 characters, with a letter and a number.
                      </p>
                    </Field>
                    <PrimaryBtn type="submit" loading={loading}>Create your account</PrimaryBtn>
                  </form>

                  {googleEnabled && (
                    <>
                      <Divider />
                      <div className="space-y-2.5">
                        <SocialBtn icon={<GoogleIcon />} label="Continue with Google" onClick={() => { clear(); signInWithGoogle(); }} />
                      </div>
                    </>
                  )}

                  <p className="font-sans text-sm text-center mt-4" style={{ color: "#0F1111" }}>
                    Already have an account?{" "}
                    <button onClick={() => { clear(); setView("signin"); }} className="font-semibold hover:underline" style={{ color: "#C7511F" }}>
                      Sign in
                    </button>
                  </p>
                </>
              )}

              {/* ── Verify email view ── */}
              {view === "verify" && (
                <>
                  <h1 className="font-sans text-2xl font-bold mb-0.5" style={{ color: "#0F1111" }}>Verify your email</h1>
                  <p className="font-sans text-sm mb-5" style={{ color: "#555" }}>
                    We sent a 6-digit code to <span className="font-semibold" style={{ color: "#0F1111" }}>{email}</span>.
                  </p>

                  {error && <div className="mb-4 px-3 py-2.5 rounded font-sans text-sm" style={{ background: "#fff3cd", border: "1px solid #e77600", color: "#111" }}>{error}</div>}

                  {devOtp && (
                    <div className="mb-4 px-3 py-2.5 rounded font-sans text-sm" style={{ background: "#eef6ee", border: "1px solid #8bbf8b", color: "#1e2918" }}>
                      Dev mode (no email provider configured): your code is <span className="font-bold tracking-widest">{devOtp}</span>
                    </div>
                  )}

                  <form onSubmit={handleVerifySubmit} className="space-y-4">
                    <Field label="Verification code">
                      <TextInput
                        type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                        placeholder="123456" value={otp}
                        onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        style={{ letterSpacing: "0.4em", textAlign: "center", fontSize: 18 }}
                      />
                    </Field>
                    <PrimaryBtn type="submit" loading={loading}>Verify &amp; create account</PrimaryBtn>
                  </form>

                  <div className="flex items-center justify-between mt-4">
                    <button onClick={() => { clear(); setOtp(""); setView("signup"); }}
                      className="font-sans text-sm hover:underline" style={{ color: "#C7511F" }}>
                      ← Change email
                    </button>
                    <button onClick={handleResend} disabled={resendIn > 0 || loading}
                      className="font-sans text-sm hover:underline disabled:opacity-50 disabled:no-underline"
                      style={{ color: resendIn > 0 ? "#888" : "#C7511F" }}>
                      {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                    </button>
                  </div>
                </>
              )}

              {/* ── Forgot password view ── */}
              {view === "forgot" && (
                <>
                  <h1 className="font-sans text-2xl font-bold mb-0.5" style={{ color: "#0F1111" }}>Reset your password</h1>
                  <p className="font-sans text-sm mb-5" style={{ color: "#555" }}>
                    Enter your account email and we'll send you a code to reset your password.
                  </p>

                  {error && <div className="mb-4 px-3 py-2.5 rounded font-sans text-sm" style={{ background: "#fff3cd", border: "1px solid #e77600", color: "#111" }}>{error}</div>}

                  <form onSubmit={handleForgotSubmit} className="space-y-4">
                    <Field label="Email address">
                      <TextInput type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus />
                    </Field>
                    <PrimaryBtn type="submit" loading={loading}>Send reset code</PrimaryBtn>
                  </form>

                  <button onClick={() => { clear(); setView("signin"); }}
                    className="w-full text-center mt-4 font-sans text-sm hover:underline" style={{ color: "#C7511F" }}>
                    ← Back to sign in
                  </button>
                </>
              )}

              {/* ── Reset password (enter code) view ── */}
              {view === "reset" && (
                <>
                  <h1 className="font-sans text-2xl font-bold mb-0.5" style={{ color: "#0F1111" }}>Enter your reset code</h1>
                  <p className="font-sans text-sm mb-5" style={{ color: "#555" }}>
                    We sent a 6-digit code to <span className="font-semibold" style={{ color: "#0F1111" }}>{email}</span>.
                  </p>

                  {error && <div className="mb-4 px-3 py-2.5 rounded font-sans text-sm" style={{ background: "#fff3cd", border: "1px solid #e77600", color: "#111" }}>{error}</div>}

                  {devOtp && (
                    <div className="mb-4 px-3 py-2.5 rounded font-sans text-sm" style={{ background: "#eef6ee", border: "1px solid #8bbf8b", color: "#1e2918" }}>
                      Dev mode (no email provider configured): your code is <span className="font-bold tracking-widest">{devOtp}</span>
                    </div>
                  )}

                  <form onSubmit={handleResetSubmit} className="space-y-4">
                    <Field label="Reset code">
                      <TextInput
                        type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                        placeholder="123456" value={otp}
                        onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        style={{ letterSpacing: "0.4em", textAlign: "center", fontSize: 18 }}
                      />
                    </Field>
                    <Field label="New password">
                      <TextInput type={showNewPass ? "text" : "password"} placeholder="At least 8 characters" value={newPassword}
                        onChange={e => setNewPassword(e.target.value)} autoComplete="new-password"
                        showToggle show={showNewPass} onToggle={() => setShowNewPass(s => !s)} />
                      <p className="font-sans text-xs mt-1" style={{ color: "#888" }}>
                        At least 8 characters, with a letter and a number.
                      </p>
                    </Field>
                    <PrimaryBtn type="submit" loading={loading}>Reset password &amp; sign in</PrimaryBtn>
                  </form>

                  <div className="flex items-center justify-between mt-4">
                    <button onClick={() => { clear(); setOtp(""); setView("forgot"); }}
                      className="font-sans text-sm hover:underline" style={{ color: "#C7511F" }}>
                      ← Use a different email
                    </button>
                    <button onClick={handleResendReset} disabled={resendIn > 0 || loading}
                      className="font-sans text-sm hover:underline disabled:opacity-50 disabled:no-underline"
                      style={{ color: resendIn > 0 ? "#888" : "#C7511F" }}>
                      {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                    </button>
                  </div>
                </>
              )}

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AuthModal;
