import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PageSubNav, { ACCOUNT_NAV } from "@/components/PageSubNav";
import FooterSection from "@/components/sections/FooterSection";
import { DEFAULT_CONTENT } from "@/lib/defaults";

const AccountPage = () => {
  const { user, loading: authLoading, updateProfile, openAuthModal } = useAuth();
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name ?? "");
  }, [user?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await updateProfile({ full_name: fullName });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[var(--nav-h,112px)]">
        <div className="max-w-3xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>Your Account</h1>
          <div className="mt-3 mb-5" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-3xl mx-auto px-3 sm:px-8 py-4 sm:py-6">
          {user && <PageSubNav items={ACCOUNT_NAV} />}

          {!authLoading && !user && (
            <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Sign in to manage your account</h2>
              <button onClick={openAuthModal}
                className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                Sign in
              </button>
            </div>
          )}

          {user && (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <h2 className="font-serif text-lg font-bold mb-4" style={{ color: "#0F1111" }}>Profile</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Full name</label>
                    <input value={fullName} onChange={e => setFullName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none"
                      style={{ border: "1px solid #ccc", background: "#fff", color: "#111" }} />
                  </div>
                  <div>
                    <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Email</label>
                    <input value={user.email ?? ""} disabled
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none opacity-60"
                      style={{ border: "1px solid #ccc", background: "#f3f3f3", color: "#111" }} />
                  </div>
                </div>
              </div>

              {error && <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{error}</p>}

              <div className="flex items-center gap-4">
                <button type="submit" disabled={saving}
                  className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                  style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
                {saved && <span className="font-sans text-sm font-semibold" style={{ color: "#007600" }}>Saved ✓</span>}
              </div>
            </form>
          )}
        </div>
      </div>
      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default AccountPage;
