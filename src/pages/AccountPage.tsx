import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import PageSubNav, { ACCOUNT_NAV } from "@/components/PageSubNav";
import FooterSection from "@/components/sections/FooterSection";
import { fetchAddresses, type SavedAddress } from "@/lib/userApi";
import {
  nameError, phoneError, tidy, normalizeAddress, validateDeliveryAddress,
  formatPhoneDisplay, formatAddressOneLine, ACCOUNT_NAME_COPY, MAX_LENGTHS,
} from "@/lib/addressValidation";

// This page owns exactly one editable field — the account holder's name — and it
// is not a cosmetic one: it prefills the recipient on every new address, and it's
// the contact name printed on a pickup notice. So it gets the same rules the
// address form applies to a recipient name, with copy written for your own
// account rather than a parcel.
//
// The other two contact details are shown here but edited where they belong: the
// phone on Login & Security (which already has the validated control) and the
// delivery address in the address book (which has the per-country rules). Having
// one editor per field is what keeps the rules from drifting — so this page
// reports their state honestly and links to the right place, rather than growing
// a second, weaker copy of each form.

const cardStyle = { border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" } as const;
const inputStyle = { border: "1px solid #ccc", background: "#fff", color: "#111" } as const;
const btnPrimary = { background: "#f0c14b", border: "1px solid #a88734", color: "#111" } as const;

// First thing that would stop a saved address reaching the door, or undefined
// when it's dispatchable. Same check the address book row shows, so the two
// pages can never disagree about whether an address is usable.
const incompleteReason = (a: SavedAddress): string | undefined =>
  Object.values(validateDeliveryAddress(normalizeAddress(a)))[0];

const AccountPage = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, updateProfile, openAuthModal } = useAuth();
  const [fullName, setFullName] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);

  useEffect(() => {
    if (!user) { setAddresses(null); return; }
    setFullName(user.full_name ?? "");
    setTouched(false);
    fetchAddresses().then(setAddresses).catch(() => setAddresses([]));
  }, [user?.id]);

  const nameProblem = nameError(fullName, ACCOUNT_NAME_COPY);
  // The account phone is optional — checkout only falls back to it when an
  // address carries no number — so an empty one is a prompt, not an error.
  const phoneProblem = user?.phone ? phoneError(user.phone) : undefined;
  const defaultAddress = addresses?.find(a => a.is_default) ?? addresses?.[0];
  const addressProblem = defaultAddress ? incompleteReason(defaultAddress) : undefined;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    // The message belongs under the field it's about. With a single input there's
    // nothing to summarise, so the form-level line stays reserved for errors that
    // came back from the server.
    if (nameProblem) { setError(""); return; }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      // Store what was validated: the tidied value, not the raw keystrokes.
      const name = tidy(fullName);
      await updateProfile({ full_name: name });
      setFullName(name);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  const showNameError = touched && !!nameProblem;

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
            <div className="bg-white rounded-xl p-8 text-center" style={cardStyle}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Sign in to manage your account</h2>
              <button onClick={openAuthModal}
                className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                style={btnPrimary}>
                Sign in
              </button>
            </div>
          )}

          {user && (
            <div className="space-y-4">
              <form onSubmit={handleSave} className="space-y-4">
                <div className="bg-white rounded-xl p-6" style={cardStyle}>
                  <h2 className="font-serif text-lg font-bold mb-4" style={{ color: "#0F1111" }}>Profile</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="account-name" className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Full name</label>
                      <input id="account-name" value={fullName} maxLength={MAX_LENGTHS.full_name}
                        autoComplete="name"
                        onChange={e => setFullName(e.target.value)} onBlur={() => setTouched(true)}
                        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none"
                        style={showNameError ? { ...inputStyle, border: "1px solid #C7511F" } : inputStyle} />
                      {showNameError
                        ? <p className="font-sans text-xs mt-1" style={{ color: "#C7511F" }}>{nameProblem}</p>
                        : <p className="font-sans text-xs mt-1" style={{ color: "#888" }}>Used on your orders and as the default name on new addresses.</p>}
                    </div>
                    <div>
                      <label htmlFor="account-email" className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Email</label>
                      <input id="account-email" value={user.email ?? ""} disabled
                        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none opacity-60"
                        style={{ ...inputStyle, background: "#f3f3f3" }} />
                      <p className="font-sans text-xs mt-1" style={{ color: "#888" }}>Your sign-in address — order confirmations go here.</p>
                    </div>
                  </div>
                </div>

                {error && <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{error}</p>}

                <div className="flex items-center gap-4">
                  {/* Not disabled on a bad name: an account created by phone or
                      by Google can start with no name at all, and a button that
                      is dead before you've touched anything explains nothing.
                      Submitting reveals the message instead — same as the
                      address form. */}
                  <button type="submit" disabled={saving}
                    className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                    style={btnPrimary}>
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  {saved && <span className="font-sans text-sm font-semibold" style={{ color: "#007600" }}>Saved ✓</span>}
                </div>
              </form>

              {/* Contact number — edited on Login & Security, reported here so a
                  missing or undialable number is visible before checkout asks. */}
              <div className="bg-white rounded-xl p-6" style={cardStyle}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>Contact number</h2>
                    {user.phone ? (
                      <p className="font-sans text-sm mt-1" style={{ color: "#333" }}>{formatPhoneDisplay(user.phone)}</p>
                    ) : (
                      <p className="font-sans text-sm mt-1" style={{ color: "#555" }}>No number saved yet.</p>
                    )}
                    <p className="font-sans text-xs mt-1" style={{ color: phoneProblem || !user.phone ? "#C7511F" : "#888" }}>
                      {phoneProblem
                        ? `Needs attention — ${phoneProblem}`
                        : user.phone
                          ? "The courier calls this number when an address has none of its own."
                          : "Add one so the courier can reach you if an address has no number."}
                    </p>
                  </div>
                  <button type="button" onClick={() => navigate("/account/security")}
                    className="font-sans text-xs font-semibold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95"
                    style={{ background: "#fff", border: "1px solid #ccc", color: "#111" }}>
                    {user.phone ? "Update number" : "Add a number"}
                  </button>
                </div>
              </div>

              {/* Default delivery address — same verdict the address book shows. */}
              <div className="bg-white rounded-xl p-6" style={cardStyle}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>Default delivery address</h2>
                    {addresses === null ? (
                      <p className="font-sans text-sm mt-1" style={{ color: "#555" }}>Loading your address…</p>
                    ) : !defaultAddress ? (
                      <>
                        <p className="font-sans text-sm mt-1" style={{ color: "#555" }}>No delivery address saved yet.</p>
                        <p className="font-sans text-xs mt-1" style={{ color: "#888" }}>Add one now and checkout is a two-click affair.</p>
                      </>
                    ) : (
                      <>
                        <p className="font-sans text-sm mt-1" style={{ color: "#333" }}>{defaultAddress.full_name}</p>
                        <p className="font-sans text-sm" style={{ color: "#555" }}>{formatAddressOneLine(normalizeAddress(defaultAddress))}</p>
                        {defaultAddress.phone && (
                          <p className="font-sans text-xs mt-0.5" style={{ color: "#888" }}>{formatPhoneDisplay(normalizeAddress(defaultAddress).phone)}</p>
                        )}
                        {addressProblem && (
                          <p className="font-sans text-xs mt-1" style={{ color: "#C7511F" }}>Needs attention — {addressProblem}</p>
                        )}
                      </>
                    )}
                  </div>
                  <button type="button" onClick={() => navigate("/account/addresses")}
                    className="font-sans text-xs font-semibold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95"
                    style={{ background: "#fff", border: "1px solid #ccc", color: "#111" }}>
                    {defaultAddress ? "Manage addresses" : "Add an address"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <FooterSection />
    </div>
  );
};

export default AccountPage;
