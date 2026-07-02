import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PageSubNav, { ACCOUNT_NAV } from "@/components/PageSubNav";
import FooterSection from "@/components/sections/FooterSection";
import { DEFAULT_CONTENT } from "@/lib/defaults";

const inputStyle = { border: "1px solid #ccc", background: "#fff", color: "#111" } as const;

const AddressesPage = () => {
  const { user, loading: authLoading, updateProfile, openAuthModal } = useAuth();
  const [form, setForm] = useState({
    address_line1: "", address_line2: "", city: "", state: "", postal_code: "", country: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    setForm({
      address_line1: user.address_line1 ?? "",
      address_line2: user.address_line2 ?? "",
      city: user.city ?? "",
      state: user.state ?? "",
      postal_code: user.postal_code ?? "",
      country: user.country ?? "",
    });
  }, [user?.id]);

  const handleChange = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await updateProfile(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save address");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[112px]">
        <div className="max-w-3xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>Your Addresses</h1>
          <div className="mt-3 mb-5" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-3xl mx-auto px-3 sm:px-8 py-4 sm:py-6">
          {user && <PageSubNav items={ACCOUNT_NAV} />}

          {!authLoading && !user && (
            <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Sign in to manage your addresses</h2>
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
                <h2 className="font-serif text-lg font-bold mb-4" style={{ color: "#0F1111" }}>Default Shipping Address</h2>
                <div className="grid gap-4">
                  <input placeholder="Address line 1" value={form.address_line1} onChange={handleChange("address_line1")}
                    className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                  <input placeholder="Address line 2 (optional)" value={form.address_line2} onChange={handleChange("address_line2")}
                    className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                  <div className="grid sm:grid-cols-3 gap-4">
                    <input placeholder="City" value={form.city} onChange={handleChange("city")}
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                    <input placeholder="State / Region" value={form.state} onChange={handleChange("state")}
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                    <input placeholder="Postal code" value={form.postal_code} onChange={handleChange("postal_code")}
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                  </div>
                  <input placeholder="Country" value={form.country} onChange={handleChange("country")}
                    className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                </div>
              </div>

              {error && <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{error}</p>}

              <div className="flex items-center gap-4">
                <button type="submit" disabled={saving}
                  className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                  style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                  {saving ? "Saving…" : "Save address"}
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

export default AddressesPage;
