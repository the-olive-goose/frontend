import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PageSubNav, { ACCOUNT_NAV } from "@/components/PageSubNav";
import FooterSection from "@/components/sections/FooterSection";
import AddressFields from "@/components/AddressFields";
import {
  fetchAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress,
  type SavedAddress, type DeliveryAddress,
} from "@/lib/userApi";
import {
  validateDeliveryAddress, normalizeAddress, formatAddressOneLine, formatPhoneDisplay,
  ADDRESS_FIELDS, type AddressField,
} from "@/lib/addressValidation";

// One-line summary of a saved address for the list rows. Normalized first so a
// row saved before the current rules still reads tidily (canonical Eircode,
// "Co. Dublin", a phone with its country code).
const formatAddressLine = (a: SavedAddress): string => formatAddressOneLine(normalizeAddress(a));

// First thing wrong with a saved address, or undefined when it's dispatchable.
const incompleteReason = (a: SavedAddress): string | undefined =>
  Object.values(validateDeliveryAddress(normalizeAddress(a)))[0];

const AddressesPage = () => {
  const { user, loading: authLoading, openAuthModal } = useAuth();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);

  // Editing state: `editingId` is null (list view), "new" (adding), or an id (editing).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DeliveryAddress>({});
  const [touched, setTouched] = useState<Partial<Record<AddressField, boolean>>>({});
  const [makeDefault, setMakeDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null); // row doing set-default/delete

  const refresh = () =>
    fetchAddresses().then(setAddresses).finally(() => setLoading(false));

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    refresh();
  }, [user?.id]);

  const errors = validateDeliveryAddress(form);

  const openAdd = () => {
    setEditingId("new");
    setForm(normalizeAddress({ full_name: user?.full_name ?? "", phone: user?.phone ?? "" }));
    setTouched({});
    setMakeDefault(addresses.length === 0); // first address is always the default
    setError("");
  };

  const openEdit = (a: SavedAddress) => {
    setEditingId(a.id);
    setForm(normalizeAddress({
      full_name: a.full_name, phone: a.phone,
      address_line1: a.address_line1, address_line2: a.address_line2,
      city: a.city, state: a.state, postal_code: a.postal_code, country: a.country,
    }));
    setTouched({});
    setMakeDefault(a.is_default);
    setError("");
  };

  const cancelEdit = () => { setEditingId(null); setError(""); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    // Block save on any validation error — reveal every field's message at once.
    if (Object.keys(errors).length > 0) {
      setTouched(Object.fromEntries(ADDRESS_FIELDS.map(f => [f, true])));
      setError(Object.values(errors)[0] ?? "Please complete the address.");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...normalizeAddress(form), make_default: makeDefault };
      if (editingId === "new") await createAddress(payload);
      else if (editingId) await updateAddress(editingId, payload);
      await refresh();
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save address");
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    setBusyId(id);
    try { await setDefaultAddress(id); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not set default"); }
    finally { setBusyId(null); }
  };

  const handleDelete = async (a: SavedAddress) => {
    if (!window.confirm(`Delete this address?\n\n${a.full_name} — ${formatAddressLine(a)}`)) return;
    setBusyId(a.id);
    try { await deleteAddress(a.id); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not delete address"); }
    finally { setBusyId(null); }
  };

  const btnPrimary = { background: "#f0c14b", border: "1px solid #a88734", color: "#111" } as const;
  const btnGhost = { background: "#fff", border: "1px solid #ccc", color: "#111" } as const;

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[var(--nav-h,112px)]">
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
                style={btnPrimary}>
                Sign in
              </button>
            </div>
          )}

          {user && (
            <div className="space-y-4">
              {loading ? (
                <p className="font-sans text-sm" style={{ color: "#555" }}>Loading your addresses…</p>
              ) : (
                <>
                  {/* Saved address cards */}
                  {addresses.length === 0 && editingId === null && (
                    <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                      <p className="font-sans text-sm mb-4" style={{ color: "#555" }}>You don't have any saved addresses yet.</p>
                      <button onClick={openAdd}
                        className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                        style={btnPrimary}>
                        Add an address
                      </button>
                    </div>
                  )}

                  {addresses.map(a => (
                    <div key={a.id} className="bg-white rounded-xl p-5" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-sans text-sm font-bold" style={{ color: "#0F1111" }}>
                            {a.full_name || "Address"}
                            {a.is_default && (
                              <span className="ml-2 font-sans text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#eef6ee", color: "#007600" }}>Default</span>
                            )}
                          </p>
                          <p className="font-sans text-sm mt-1" style={{ color: "#555" }}>{formatAddressLine(a)}</p>
                          {a.phone && <p className="font-sans text-xs mt-0.5" style={{ color: "#888" }}>{formatPhoneDisplay(normalizeAddress(a).phone)}</p>}
                          {/* Rows saved before the current rules can be missing a county
                              or carry an undialable number. Flag them here rather than
                              letting checkout be the first place the shopper finds out. */}
                          {incompleteReason(a) && (
                            <p className="font-sans text-xs mt-1" style={{ color: "#C7511F" }}>
                              Needs attention — {incompleteReason(a)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-4">
                        {!a.is_default && (
                          <button onClick={() => handleSetDefault(a.id)} disabled={busyId === a.id}
                            className="font-sans text-xs font-semibold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                            style={btnGhost}>
                            Set as default
                          </button>
                        )}
                        <button onClick={() => openEdit(a)}
                          className="font-sans text-xs font-semibold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95"
                          style={btnGhost}>
                          Edit
                        </button>
                        <button onClick={() => handleDelete(a)} disabled={busyId === a.id}
                          className="font-sans text-xs font-semibold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                          style={{ background: "#fff", border: "1px solid #e3b7ad", color: "#C7511F" }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add / edit form */}
                  {editingId !== null && (
                    <form onSubmit={handleSave} className="bg-white rounded-xl p-6 space-y-4" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                      <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>
                        {editingId === "new" ? "Add a new address" : "Edit address"}
                      </h2>

                      <AddressFields value={form} errors={errors} touched={touched}
                        onChange={setForm} onTouch={f => setTouched(t => ({ ...t, [f]: true }))} />

                      <label className="flex items-center gap-2 cursor-pointer" style={{ opacity: makeDefault && addresses.length === 0 ? 0.6 : 1 }}>
                        <input type="checkbox" checked={makeDefault}
                          disabled={addresses.length === 0}
                          onChange={e => setMakeDefault(e.target.checked)} />
                        <span className="font-sans text-sm" style={{ color: "#333" }}>
                          Set as my default shipping address{addresses.length === 0 ? " (your first address)" : ""}
                        </span>
                      </label>

                      {error && <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{error}</p>}

                      <div className="flex items-center gap-3">
                        <button type="submit" disabled={saving}
                          className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                          style={btnPrimary}>
                          {saving ? "Saving…" : "Save address"}
                        </button>
                        <button type="button" onClick={cancelEdit}
                          className="font-sans text-sm font-semibold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                          style={btnGhost}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Add-another button (hidden while the form is open or the empty-state card shows it) */}
                  {editingId === null && addresses.length > 0 && (
                    <button onClick={openAdd}
                      className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                      style={btnPrimary}>
                      + Add another address
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <FooterSection />
    </div>
  );
};

export default AddressesPage;
