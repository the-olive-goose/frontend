import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { changePassword } from "@/lib/userApi";
import PhoneInput from "@/components/PhoneInput";
import { phoneError as validatePhone, splitPhone, composePhone } from "@/lib/addressValidation";
import PageSubNav, { ACCOUNT_NAV } from "@/components/PageSubNav";
import SignedInDevices from "@/components/SignedInDevices";
import FooterSection from "@/components/sections/FooterSection";

const inputStyle = { border: "1px solid #ccc", background: "#fff", color: "#111" } as const;

const SecurityPage = () => {
  const { user, loading: authLoading, updateProfile, openAuthModal, signOut } = useAuth();
  const [phone, setPhone] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState("");
  // Changing the password ends every other signed-in session. Saying so — with the
  // count — is what turns it from a silent side effect into the reassurance a
  // shopper who suspects someone else is in their account actually came for.
  const [pwSignedOut, setPwSignedOut] = useState(0);
  // Bumped after a password change so the device list re-reads and stops showing
  // sessions the change just killed.
  const [devicesKey, setDevicesKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    // Read a legacy bare number against the account's country so it lands in the
    // dial-code control already valid, instead of failing the moment it renders.
    const parts = splitPhone(user.phone, user.country);
    setPhone(composePhone(parts.dialCode, parts.national));
  }, [user?.id]);

  // This number is the fallback the courier and the pickup notice use when an
  // address carries none, so it gets the same rules as every other phone field.
  const phoneProblem = phone ? validatePhone(phone) : undefined;

  const handlePhoneSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phoneProblem) { setPhoneError(phoneProblem); return; }
    setSavingPhone(true);
    setPhoneError("");
    setPhoneSaved(false);
    try {
      await updateProfile({ phone });
      setPhoneSaved(true);
      setTimeout(() => setPhoneSaved(false), 2500);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Could not save phone number");
    } finally {
      setSavingPhone(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPw(true);
    setPwError("");
    setPwSaved(false);
    try {
      const { signed_out_sessions = 0 } = await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPwSaved(true);
      setPwSignedOut(signed_out_sessions);
      setDevicesKey(k => k + 1);
      setTimeout(() => setPwSaved(false), 2500);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setChangingPw(false);
    }
  };

  const canChangePassword = user?.provider === "email";

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[var(--nav-h,112px)]">
        <div className="max-w-3xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>Login &amp; Security</h1>
          <div className="mt-3 mb-5" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-3xl mx-auto px-3 sm:px-8 py-4 sm:py-6 space-y-4">
          {user && <PageSubNav items={ACCOUNT_NAV} />}

          {!authLoading && !user && (
            <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Sign in to manage login &amp; security</h2>
              <button onClick={openAuthModal}
                className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                Sign in
              </button>
            </div>
          )}

          {user && (
            <>
              {/* Contact info */}
              <form onSubmit={handlePhoneSave} className="bg-white rounded-xl p-6 space-y-4"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>Contact Info</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Email</label>
                    <input value={user.email ?? ""} disabled
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none opacity-60"
                      style={{ ...inputStyle, background: "#f3f3f3" }} />
                  </div>
                  <div>
                    <label htmlFor="account-phone" className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Phone</label>
                    <PhoneInput id="account-phone" value={phone} country={user.country}
                      error={phoneProblem} onChange={setPhone} />
                  </div>
                </div>
                {(phoneError || phoneProblem) && (
                  <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{phoneError || phoneProblem}</p>
                )}
                <div className="flex items-center gap-4">
                  <button type="submit" disabled={savingPhone || !!phoneProblem}
                    className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                    style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                    {savingPhone ? "Saving…" : "Save changes"}
                  </button>
                  {phoneSaved && <span className="font-sans text-sm font-semibold" style={{ color: "#007600" }}>Saved ✓</span>}
                </div>
              </form>

              {/* Password */}
              <div className="bg-white rounded-xl p-6 space-y-4"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>Password</h2>
                {!canChangePassword ? (
                  <p className="font-sans text-sm" style={{ color: "#555" }}>
                    You sign in with {user.provider === "google" ? "Google" : user.provider === "facebook" ? "Facebook" : "a phone number"}, so there's no password to change here.
                  </p>
                ) : (
                  <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Current password</label>
                        <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                      </div>
                      <div>
                        <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>New password</label>
                        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                      </div>
                    </div>
                    {pwError && <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{pwError}</p>}
                    <div className="flex items-center gap-4">
                      <button type="submit" disabled={changingPw}
                        className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                        style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                        {changingPw ? "Changing…" : "Change password"}
                      </button>
                      {pwSaved && <span className="font-sans text-sm font-semibold" style={{ color: "#007600" }}>Password changed ✓</span>}
                    </div>
                    {pwSaved && pwSignedOut > 0 && (
                      <p className="font-sans text-sm" style={{ color: "#555" }}>
                        {pwSignedOut === 1
                          ? "1 other device was signed out."
                          : `${pwSignedOut} other devices were signed out.`}
                      </p>
                    )}
                  </form>
                )}
              </div>

              {/* Signed-in devices */}
              <SignedInDevices key={devicesKey} onSelfRevoked={signOut} />
            </>
          )}
        </div>
      </div>
      <FooterSection />
    </div>
  );
};

export default SecurityPage;
