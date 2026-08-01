import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { getContent } from "@/lib/api";
import { useContent } from "@/hooks/useContent";
import {
  createCheckoutSession, validateDiscountCode, SessionExpiredError,
  fetchAddresses, createAddress, updateAddress,
  type DeliveryAddress, type FulfillmentType, type SavedAddress,
} from "@/lib/userApi";
import { DEFAULT_CONTENT, DEFAULT_DEALS, type PickupSettingsContent, type Bundle, type DealsContent, type Product } from "@/lib/defaults";
import { cartSubtotal, formatPrice, MIN_CHARGE_EUR } from "@/lib/cart";
import { computeBundleSavings } from "@/lib/bundleSavings";
import { track, getAnalyticsIds } from "@/lib/analytics";
import { getBundleNudges } from "@/lib/bundleNudges";
import {
  validateDeliveryAddress, normalizeAddress, phoneError, formatAddressBlock, formatAddressOneLine,
  formatPhoneDisplay, splitPhone, composePhone, ADDRESS_FIELDS,
  type AddressErrors, type AddressField,
} from "@/lib/addressValidation";
import AddressFields from "@/components/AddressFields";
import PhoneInput from "@/components/PhoneInput";
import FreeShippingBar from "@/components/FreeShippingBar";
import TrustBadges from "@/components/TrustBadges";
import FooterSection from "@/components/sections/FooterSection";
import RichText from "@/lib/richtext";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];
const inputStyle = { border: "1px solid #ccc", background: "#fff", color: "#111" } as const;

// Sentinel for the picker's "+ Use a new address" option (vs. a saved address id).
const NEW_ADDRESS = "__new__";

// The delivery fields on a saved address, as the checkout address form wants them.
// Normalized on the way in so a legacy row (bare phone digits, lowercase Eircode)
// compares equal to the same address once the form has tidied it.
const toDeliveryAddress = (a: SavedAddress): DeliveryAddress => normalizeAddress({
  full_name: a.full_name, phone: a.phone,
  address_line1: a.address_line1, address_line2: a.address_line2,
  city: a.city, state: a.state, postal_code: a.postal_code, country: a.country,
});

// Two addresses are "the same" for save-offer purposes when every delivery field
// matches (trimmed). Lets us skip offering to save an address already on file.
const sameAddress = (a: DeliveryAddress, b: DeliveryAddress): boolean =>
  (["full_name", "phone", "address_line1", "address_line2", "city", "state", "postal_code", "country"] as const)
    .every(k => (a[k] ?? "").trim() === (b[k] ?? "").trim());

const CheckoutPage = () => {
  const { user, loading: authLoading, openAuthModal, requireAuth } = useAuth();
  const { items, count, addToCart } = useCart();
  const [searchParams] = useSearchParams();

  const { data: pickup, ready: pickupReady } = useContent("pickupSettings", DEFAULT_CONTENT.pickupSettings);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [addingNudge, setAddingNudge] = useState(false);
  const [fulfillment, setFulfillment] = useState<FulfillmentType>("delivery");
  const [address, setAddress] = useState<DeliveryAddress>({});
  const [touched, setTouched] = useState<Partial<Record<AddressField, boolean>>>({});
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>(NEW_ADDRESS);
  const [saveToAccount, setSaveToAccount] = useState(false);
  const [saveChoice, setSaveChoice] = useState<"default" | "another">("another");
  // A saved address is shown read-only until the shopper asks to edit it. That's
  // what keeps the highlighted card and the form from ever disagreeing: if the
  // fields are editable, the card above them says "editing".
  const [editingSaved, setEditingSaved] = useState(false);
  const [saveEdits, setSaveEdits] = useState(true);
  const [contactPhone, setContactPhone] = useState("");
  const [contactPhoneTouched, setContactPhoneTouched] = useState(false);

  // Publish the mobile sticky bar's height as --bottom-bar-h (mirrors the
  // navbar's --nav-h) so bottom-anchored overlays can clear it. Without this the
  // cookie consent banner sat directly on top of the pay button and swallowed
  // every tap — mobile checkout was unreachable for anyone who hadn't already
  // dismissed the notice.
  const bottomBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bottomBarRef.current;
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty("--bottom-bar-h", "0px");
      return;
    }
    // Only write when the value actually changes: a ResizeObserver callback that
    // touches layout on every fire can feed itself and thrash.
    let last = "";
    const setVar = () => {
      const next = `${el.offsetHeight}px`;
      if (next === last) return;
      last = next;
      root.style.setProperty("--bottom-bar-h", next);
    };
    setVar();
    const observer = new ResizeObserver(setVar);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--bottom-bar-h", "0px");
    };
  }, [user, items.length]);
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<{ code: string; type: "percentage" | "fixed"; value: number } | null>(null);
  const [codeError, setCodeError] = useState("");
  const [validatingCode, setValidatingCode] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(
    searchParams.get("canceled") ? "Payment was canceled — your basket is still here whenever you're ready." : ""
  );

  useEffect(() => {
    getContent<DealsContent>("deals", DEFAULT_DEALS).then(d => setBundles(d?.bundles ?? []));
    getContent("products", DEFAULT_CONTENT.products).then(d => setAllProducts(d?.items ?? []));
  }, []);

  useEffect(() => {
    if (!user) return;
    // Numbers stored before phones became E.164 arrive as bare digits; read them
    // against the account's country so the field starts valid instead of scolding
    // the shopper about a code they never got to choose.
    const accountPhone = splitPhone(user.phone, user.country);
    setContactPhone(composePhone(accountPhone.dialCode, accountPhone.national));
    // A prefilled baseline from the account's default (mirrored on the user row),
    // used until the address book loads and/or if the shopper picks "new address".
    setAddress(normalizeAddress({
      full_name: user.full_name ?? "",
      phone: user.phone ?? "",
      address_line1: user.address_line1 ?? "",
      address_line2: user.address_line2 ?? "",
      city: user.city ?? "",
      state: user.state ?? "",
      postal_code: user.postal_code ?? "",
      country: user.country ?? "",
    }));
    // Load the address book; select the default (or first) so it's pre-picked.
    fetchAddresses().then(list => {
      setSavedAddresses(list);
      const preferred = list.find(a => a.is_default) ?? list[0];
      if (preferred) {
        setSelectedAddressId(preferred.id);
        setAddress(toDeliveryAddress(preferred));
      } else {
        setSelectedAddressId(NEW_ADDRESS);
      }
    }).catch(() => { /* fall back to the prefilled baseline above */ });
  }, [user?.id]);

  // Pick a saved address: it becomes the read-only "delivering to" card, and the
  // editable form disappears so there's nothing to silently diverge from it.
  const selectSavedAddress = (a: SavedAddress) => {
    setSelectedAddressId(a.id);
    setAddress(toDeliveryAddress(a));
    setSaveToAccount(false);
    setEditingSaved(false);
    setSaveEdits(true);
    setTouched({});
  };

  // Switch to a blank new address, keeping the account's name/phone as a convenience.
  const selectNewAddress = () => {
    setSelectedAddressId(NEW_ADDRESS);
    setAddress({ full_name: user?.full_name ?? "", phone: user?.phone ?? "" });
    setTouched({});
    setEditingSaved(false);
  };

  const subtotalNum = cartSubtotal(items);
  const isPickup = fulfillment === "pickup";
  const discountPercent = isPickup ? pickup.discount_percent : 0;
  const pickupDiscountAmount = subtotalNum * (discountPercent / 100);

  // Today's Deals bundles the basket satisfies — same per-unit, non-overlapping
  // algorithm Stripe applies server-side, so the total shown here matches what's
  // actually charged. Catalogue passed so orphaned bundle product_ids are ignored.
  const { applied: appliedBundles, totalSavings: bundleSavings } =
    computeBundleSavings(bundles, items, allProducts.map(p => p.id));

  const codeDiscountAmount = !appliedCode
    ? 0
    : appliedCode.type === "fixed"
      ? Math.min(appliedCode.value, subtotalNum)
      : subtotalNum * (appliedCode.value / 100);
  const codeOffLabel = !appliedCode
    ? ""
    : appliedCode.type === "fixed"
      ? `€${appliedCode.value.toFixed(2)} off`
      : `${appliedCode.value}% off`;
  // Clamp the combined discount to the subtotal, exactly as the backend does before
  // it builds the Stripe coupon. A generous stack (pickup % + bundle + code) can
  // exceed the basket value; without the same clamp here the page would subtract the
  // whole saving, show €0.00, and then Stripe would still bill the shipping — the
  // shopper agreeing to one number and being charged another.
  const discountAmount = Math.min(pickupDiscountAmount + bundleSavings + codeDiscountAmount, subtotalNum);
  const flatShipping = pickup.flat_shipping_rate ?? 4.99;
  const shipping = isPickup ? 0 : (subtotalNum >= pickup.free_shipping_threshold ? 0 : flatShipping);
  const grandTotal = Math.max(0, subtotalNum - discountAmount + shipping);
  // Stripe can't take a payment under €0.50, and pickup is how a basket gets there:
  // no shipping line to lift a cheap or deeply discounted basket over the floor.
  // Say so on the button rather than failing after the shopper commits.
  const belowMinCharge = grandTotal < MIN_CHARGE_EUR;
  const minChargeNotice = `Card payments need a total of at least €${MIN_CHARGE_EUR.toFixed(2)}. Please add another item to your basket${isPickup ? ", or choose delivery" : ""}.`;

  const addressErrors: AddressErrors = fulfillment === "delivery" ? validateDeliveryAddress(address) : {};
  const addressComplete = Object.keys(addressErrors).length === 0;
  const selectedSaved = savedAddresses.find(a => a.id === selectedAddressId);

  // An address saved before these rules existed can be junk ("4444", no county, an
  // undialable phone). It must not sail through just because it's on file — so a
  // failing saved address opens for editing on its own, with its errors showing,
  // rather than sitting behind a read-only card the shopper can't fix.
  const savedAddressBroken = fulfillment === "delivery" && !!selectedSaved && !addressComplete;
  useEffect(() => {
    if (!savedAddressBroken) return;
    setEditingSaved(true);
    setTouched(Object.fromEntries(ADDRESS_FIELDS.map(f => [f, true])));
  }, [savedAddressBroken, selectedAddressId]);

  // The fields are editable for a new address, or for a saved one being edited.
  const showAddressForm = !selectedSaved || editingSaved;

  // Pickup still needs a number the shop can ring when the order is ready.
  const contactPhoneError = isPickup ? phoneError(contactPhone) : undefined;

  // Offer to save only a complete, brand-new address that isn't already on file.
  const isNewUnsavedAddress =
    fulfillment === "delivery" && addressComplete &&
    selectedAddressId === NEW_ADDRESS &&
    !savedAddresses.some(a => sameAddress(toDeliveryAddress(a), address));

  // Edits made to a saved address at checkout, which can be written back.
  const savedAddressEdited =
    !!selectedSaved && editingSaved && !sameAddress(toDeliveryAddress(selectedSaved), address);

  const markTouched = (f: AddressField) => setTouched(t => ({ ...t, [f]: true }));

  // Single best "almost complete" deal — checkout is high-intent, low-real-estate,
  // so only the top-ranked bundle nudge is surfaced here (see getBundleNudges).
  const [bestNudge] = getBundleNudges(bundles, items, allProducts, 1);

  const applyCode = async () => {
    const code = codeInput.trim();
    if (!code) return;
    setValidatingCode(true);
    setCodeError("");
    try {
      const result = await validateDiscountCode(code);
      // Prefer the general type/value; fall back to legacy discount_percent.
      const type = result.discount_type ?? "percentage";
      const value = result.discount_value ?? result.discount_percent;
      if (result.valid && value != null) {
        setAppliedCode({ code: result.code ?? code.toUpperCase(), type, value });
        setCodeInput("");
      } else {
        setAppliedCode(null);
        setCodeError(result.message ?? "That code isn't valid.");
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        requireAuth(() => applyCode());
      } else {
        setCodeError(err instanceof Error ? err.message : "Could not validate code");
      }
    } finally {
      setValidatingCode(false);
    }
  };

  const removeCode = () => {
    setAppliedCode(null);
    setCodeError("");
    setCodeInput("");
  };

  const handleAddNudge = async () => {
    if (!bestNudge) return;
    setAddingNudge(true);
    for (const p of bestNudge.missing) await addToCart(p);
    setAddingNudge(false);
    toast.success(`${bestNudge.bundle.name} unlocked!`, { description: `You save €${bestNudge.savings.toFixed(2)}`, duration: 3000 });
  };

  // Redirects to Stripe's hosted checkout page. The basket isn't cleared and no
  // order exists yet — that only happens once Stripe confirms the payment (see
  // CheckoutSuccessPage), so there's no way to end up with an unpaid order.
  const handlePlaceOrder = async () => {
    setError("");
    if (belowMinCharge) {
      setError(minChargeNotice);
      return;
    }
    if (isPickup && contactPhoneError) {
      setContactPhoneTouched(true);
      setError(contactPhoneError);
      return;
    }
    if (!isPickup && !addressComplete) {
      // Reveal every field's error at once, then point at the first problem. The
      // form has to be open for that to be actionable when a saved address failed.
      setEditingSaved(true);
      setTouched(Object.fromEntries(ADDRESS_FIELDS.map(f => [f, true])));
      const firstError = Object.values(addressErrors)[0];
      setError(firstError ?? "Please complete your delivery address.");
      return;
    }
    setPlacing(true);
    track("begin_checkout", { total: +grandTotal.toFixed(2), items: count, fulfillment_type: fulfillment });
    try {
      // Persist the address-book side first, if the shopper opted in. Best-effort:
      // a save failure shouldn't block paying for the order.
      const normalized = normalizeAddress(address);
      if (isNewUnsavedAddress && saveToAccount) {
        try {
          await createAddress({ ...normalized, make_default: saveChoice === "default" });
        } catch { /* don't block checkout on an address-book write */ }
      } else if (selectedSaved && savedAddressEdited && saveEdits) {
        // Write corrections back so the same bad address doesn't come round again
        // on the next order — the whole point of catching it here.
        try {
          await updateAddress(selectedSaved.id, normalized);
        } catch { /* don't block checkout on an address-book write */ }
      }
      const { url } = await createCheckoutSession({
        fulfillment_type: fulfillment,
        shipping_address: isPickup ? undefined : normalized,
        contact_phone: isPickup ? contactPhone : undefined,
        discount_code: appliedCode?.code,
        analytics: getAnalyticsIds(),
      });
      window.location.href = url;
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        requireAuth(() => handlePlaceOrder());
      } else {
        const msg = err instanceof Error ? err.message : "Could not start checkout";
        setError(msg);
        // A code that passed the pre-check but was consumed/blocked by the time
        // checkout started — drop it so the shopper can retry at the real price.
        if (appliedCode && /code|discount|welcome/i.test(msg)) {
          setAppliedCode(null);
          setCodeError(msg);
        }
      }
      setPlacing(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[var(--nav-h,112px)]">
        <div className="max-w-6xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>Checkout</h1>
          <div className="mt-3 mb-0" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className={`max-w-6xl mx-auto px-3 sm:px-8 py-4 sm:py-6 ${user && items.length > 0 ? "pb-28 lg:pb-6" : ""}`}>

          {!authLoading && !user && (
            <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Sign in to check out</h2>
              <button onClick={openAuthModal}
                className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                Sign in
              </button>
            </div>
          )}

          {user && items.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Your basket is empty.</h2>
              <a href="/shop" className="font-sans text-sm hover:underline" style={{ color: "#C7511F" }}>Start shopping →</a>
            </div>
          )}

          {user && items.length > 0 && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">

              {/* ── Left: checkout steps ── */}
              <div className="flex-1 min-w-0 w-full space-y-4">

                {/* Delivery method */}
                <div className="bg-white rounded-xl p-5 space-y-3" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>1. Delivery Method</h2>

                  {!isPickup && (
                    <div className="p-3 rounded-lg" style={{ background: "#f8f8f8" }}>
                      <FreeShippingBar subtotal={subtotalNum} threshold={pickup.free_shipping_threshold} ready={pickupReady} compact />
                    </div>
                  )}

                  <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                    style={{ border: `2px solid ${fulfillment === "delivery" ? "#e77600" : "#DDD"}`, background: fulfillment === "delivery" ? "#fff8f0" : "#fff" }}>
                    <input type="radio" name="fulfillment" checked={fulfillment === "delivery"} onChange={() => setFulfillment("delivery")} className="mt-1" />
                    <div>
                      <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>Ship to my address</p>
                      <p className="font-sans text-xs" style={{ color: "#555" }}>
                        {subtotalNum >= pickup.free_shipping_threshold ? "Free shipping" : `€${flatShipping.toFixed(2)} shipping — free over €${pickup.free_shipping_threshold.toFixed(2)}`}
                      </p>
                    </div>
                  </label>

                  {pickup.enabled && (
                    <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                      style={{ border: `2px solid ${fulfillment === "pickup" ? "#e77600" : "#DDD"}`, background: fulfillment === "pickup" ? "#fff8f0" : "#fff" }}>
                      <input type="radio" name="fulfillment" checked={fulfillment === "pickup"} onChange={() => setFulfillment("pickup")} className="mt-1" />
                      <div>
                        <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>
                          Pick up from {pickup.location_name} — {pickup.city}
                          {pickup.discount_percent > 0 && (
                            <span className="ml-2 font-sans text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#eef6ee", color: "#007600" }}>
                              Save {pickup.discount_percent}%
                            </span>
                          )}
                        </p>
                        <p className="font-sans text-xs" style={{ color: "#555" }}>{pickup.address_line1} · {pickup.hours}</p>
                      </div>
                    </label>
                  )}
                </div>

                {/* Delivery address / pickup details */}
                {fulfillment === "delivery" ? (
                  <div className="bg-white rounded-xl p-5 space-y-4" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                    <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>2. Delivery Address</h2>

                    {/* Saved-address picker — only when the shopper has an address book. */}
                    {savedAddresses.length > 0 && (
                      <div className="space-y-2">
                        {savedAddresses.map(a => {
                          const tidied = toDeliveryAddress(a);
                          const broken = Object.keys(validateDeliveryAddress(tidied)).length > 0;
                          return (
                            <label key={a.id} className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                              style={{ border: `2px solid ${selectedAddressId === a.id ? "#e77600" : "#DDD"}`, background: selectedAddressId === a.id ? "#fff8f0" : "#fff" }}>
                              <input type="radio" name="saved-address" checked={selectedAddressId === a.id} onChange={() => selectSavedAddress(a)} className="mt-1" />
                              <div className="min-w-0">
                                <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>
                                  {a.full_name}
                                  {a.is_default && <span className="ml-2 font-sans text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#eef6ee", color: "#007600" }}>Default</span>}
                                  {broken && <span className="ml-2 font-sans text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#fdeeea", color: "#C7511F" }}>Needs details</span>}
                                </p>
                                <p className="font-sans text-xs" style={{ color: "#555" }}>{formatAddressOneLine(tidied)}</p>
                                {tidied.phone && <p className="font-sans text-xs" style={{ color: "#888" }}>{formatPhoneDisplay(tidied.phone)}</p>}
                              </div>
                            </label>
                          );
                        })}
                        <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                          style={{ border: `2px solid ${selectedAddressId === NEW_ADDRESS ? "#e77600" : "#DDD"}`, background: selectedAddressId === NEW_ADDRESS ? "#fff8f0" : "#fff" }}>
                          <input type="radio" name="saved-address" checked={selectedAddressId === NEW_ADDRESS} onChange={selectNewAddress} />
                          <span className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>+ Use a new address</span>
                        </label>
                      </div>
                    )}

                    {/* A chosen saved address is read-only until "Edit" is pressed, so
                        the highlighted card above and the parcel label can't diverge. */}
                    {selectedSaved && !editingSaved && (
                      <div className="p-4 rounded-lg" style={{ background: "#f8f8f8", border: "1px solid #eee" }}>
                        <p className="font-sans text-xs font-semibold mb-2" style={{ color: "#555" }}>Delivering to</p>
                        {formatAddressBlock(address).map(line => (
                          <p key={line} className="font-sans text-sm" style={{ color: "#0F1111" }}>{line}</p>
                        ))}
                        <p className="font-sans text-sm mt-1" style={{ color: "#0F1111" }}>{formatPhoneDisplay(address.phone)}</p>
                        <button type="button" onClick={() => { setEditingSaved(true); setTouched({}); }}
                          className="mt-3 font-sans text-xs font-semibold underline" style={{ color: "#007185" }}>
                          Edit these details
                        </button>
                      </div>
                    )}

                    {showAddressForm && (
                      <>
                        {selectedSaved && (
                          <p className="font-sans text-xs" style={{ color: savedAddressBroken ? "#C7511F" : "#555" }}>
                            {savedAddressBroken
                              ? "This saved address is missing something a courier needs. Please complete it before paying."
                              : `Editing “${selectedSaved.full_name}”.`}
                          </p>
                        )}
                        <AddressFields value={address} errors={addressErrors} touched={touched} onChange={setAddress} onTouch={markTouched} />
                      </>
                    )}

                    {/* Corrections to a saved address are written back by default, so the
                        same undeliverable details don't reappear on the next order. */}
                    {savedAddressEdited && (
                      <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg" style={{ background: "#f8f8f8", border: "1px solid #eee" }}>
                        <input type="checkbox" checked={saveEdits} onChange={e => setSaveEdits(e.target.checked)} />
                        <span className="font-sans text-sm" style={{ color: "#0F1111" }}>Update this address in my address book too</span>
                      </label>
                    )}

                    {/* Offer to save a newly entered address to the account. Shown only
                        when the entered address is complete and isn't already saved. */}
                    {isNewUnsavedAddress && (
                      <div className="p-3 rounded-lg space-y-2" style={{ background: "#f8f8f8", border: "1px solid #eee" }}>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={saveToAccount} onChange={e => setSaveToAccount(e.target.checked)} />
                          <span className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>Save this address to my account</span>
                        </label>
                        {saveToAccount && (
                          <div className="pl-6 space-y-1.5">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="radio" name="save-choice" checked={saveChoice === "another"} onChange={() => setSaveChoice("another")} />
                              <span className="font-sans text-sm" style={{ color: "#333" }}>Save as another address</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="radio" name="save-choice" checked={saveChoice === "default"} onChange={() => setSaveChoice("default")} />
                              <span className="font-sans text-sm" style={{ color: "#333" }}>Save and set as my default</span>
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl p-5 space-y-3" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                    <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>2. Pickup Details</h2>
                    <div className="p-3 rounded-lg" style={{ background: "#f8f8f8" }}>
                      <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>{pickup.location_name}</p>
                      <p className="font-sans text-sm" style={{ color: "#555" }}>{pickup.address_line1}, {pickup.city} {pickup.eircode}</p>
                      <p className="font-sans text-sm" style={{ color: "#555" }}>{pickup.country}</p>
                      <p className="font-sans text-xs mt-1" style={{ color: "#007185" }}>{pickup.hours}</p>
                    </div>
                    {pickup.notes && <p className="font-sans text-xs" style={{ color: "#555" }}><RichText text={pickup.notes} /></p>}
                    <div>
                      <label htmlFor="pickup-phone" className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>
                        Contact phone (we ring you when the order is ready)
                      </label>
                      <PhoneInput id="pickup-phone" value={contactPhone} country={pickup.country}
                        error={contactPhoneTouched ? contactPhoneError : undefined}
                        onChange={setContactPhone} onBlur={() => setContactPhoneTouched(true)} />
                      {contactPhoneTouched && contactPhoneError && (
                        <p className="font-sans text-xs mt-1" style={{ color: "#C7511F" }}>{contactPhoneError}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Payment */}
                <div className="bg-white rounded-xl p-5 space-y-2" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>3. Payment</h2>
                  <p className="font-sans text-sm" style={{ color: "#555" }}>
                    You'll pay securely by card on the next screen, hosted by Stripe. We never see or store your card details.
                  </p>
                </div>

                {/* Review items */}
                <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <p className="font-sans text-sm font-semibold px-5 py-3" style={{ color: "#0F1111", borderBottom: "1px solid #EEE" }}>
                    4. Review Order ({count} item{count !== 1 ? "s" : ""})
                  </p>
                  {items.map((item, i) => {
                    const img = item.product.image_url || FALLBACK_IMGS[i % 2];
                    const unitPrice = parseFloat(item.product.price.replace(/[^0-9.]/g, ""));
                    const lineTotal = isNaN(unitPrice) ? formatPrice(item.product.price) : `€${(unitPrice * item.quantity).toFixed(2)}`;
                    return (
                      <div key={item.product.id} className="flex items-center gap-4 px-5 py-3" style={{ borderBottom: i < items.length - 1 ? "1px solid #EEE" : "none" }}>
                        <img src={img} alt={item.product.name} className="rounded-lg object-cover shrink-0" style={{ width: 52, height: 52, mixBlendMode: "multiply" }} />
                        <div className="flex-1 min-w-0">
                          <p className="font-sans text-sm font-semibold truncate" style={{ color: "#0F1111" }}>{item.product.name}</p>
                          <p className="font-sans text-xs" style={{ color: "#555" }}>Qty: {item.quantity}</p>
                        </div>
                        <p className="font-sans text-sm font-semibold shrink-0" style={{ color: "#0F1111" }}>{lineTotal}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Best "almost complete" deal — one ranked pick, not a wall of offers */}
                {bestNudge && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl flex-wrap"
                    style={{ background: "#fff8f0", border: "1px solid #f0dfc0" }}>
                    <span className="text-lg shrink-0">🏷️</span>
                    <p className="font-sans text-sm flex-1 min-w-[200px]" style={{ color: "#0F1111" }}>
                      Add <strong>{bestNudge.missing.map(p => p.name).join(" & ")}</strong> to unlock{" "}
                      <strong style={{ color: "#007600" }}>
                        {bestNudge.bundle.discount_type === "percentage" ? `${bestNudge.bundle.discount_value}% off` : `€${bestNudge.bundle.discount_value.toFixed(2)} off`}
                      </strong>{" "}
                      with the {bestNudge.bundle.name} bundle — save €{bestNudge.savings.toFixed(2)}.
                    </p>
                    <button onClick={handleAddNudge} disabled={addingNudge}
                      className="og-tap justify-center shrink-0 font-sans text-xs font-bold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-60"
                      style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                      {addingNudge ? "Adding…" : "Add & Save"}
                    </button>
                  </div>
                )}
              </div>

              {/* ── Right: order summary ── */}
              <div className="w-full lg:w-80 shrink-0">
                <div className="bg-white rounded-xl p-5 space-y-3 lg:sticky lg:top-28" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <h2 className="font-serif text-lg font-bold mb-1" style={{ color: "#0F1111" }}>Order Summary</h2>
                  <div className="flex justify-between font-sans text-sm" style={{ color: "#0F1111" }}>
                    <span>Subtotal ({count} item{count !== 1 ? "s" : ""})</span>
                    <span className="font-semibold">€{subtotalNum.toFixed(2)}</span>
                  </div>
                  {pickupDiscountAmount > 0 && (
                    <div className="flex justify-between font-sans text-sm font-semibold" style={{ color: "#007600" }}>
                      <span>Pickup discount ({discountPercent}%)</span>
                      <span>−€{pickupDiscountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {appliedBundles.map(ab => (
                    <div key={ab.bundle.id} className="flex justify-between font-sans text-sm font-semibold" style={{ color: "#007600" }}>
                      <span>🏷️ {ab.bundle.name} deal{ab.instances > 1 ? ` ×${ab.instances}` : ""}</span>
                      <span>−€{ab.savings.toFixed(2)}</span>
                    </div>
                  ))}
                  {appliedCode && (
                    <div className="flex justify-between font-sans text-sm font-semibold" style={{ color: "#007600" }}>
                      <span>🎉 Code {appliedCode.code} ({codeOffLabel})</span>
                      <span>−€{codeDiscountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-sans text-sm" style={{ color: "#0F1111" }}>
                    <span>Shipping</span>
                    <span className="font-semibold" style={{ color: shipping === 0 ? "#007600" : undefined }}>
                      {shipping === 0 ? "FREE" : `€${shipping.toFixed(2)}`}
                    </span>
                  </div>
                  {/* Discount code */}
                  <div className="pt-2" style={{ borderTop: "1px solid #EEE" }}>
                    {appliedCode ? (
                      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: "#eef6ee", border: "1px solid #cfe6cf" }}>
                        <span className="font-sans text-xs font-semibold" style={{ color: "#007600" }}>
                          Code applied · {codeOffLabel}
                        </span>
                        <button onClick={removeCode} className="font-sans text-xs underline shrink-0" style={{ color: "#555" }}>
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div>
                        <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Discount code</label>
                        <div className="flex gap-2">
                          <input
                            value={codeInput}
                            onChange={e => { setCodeInput(e.target.value); setCodeError(""); }}
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyCode(); } }}
                            placeholder="e.g. OG-ABCD2345"
                            className="flex-1 min-w-0 px-3 py-2 rounded-lg font-sans text-sm outline-none uppercase"
                            style={inputStyle}
                          />
                          <button onClick={applyCode} disabled={validatingCode || !codeInput.trim()}
                            className="og-tap justify-center shrink-0 font-sans text-xs font-bold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                            style={{ background: "#e7e7e7", border: "1px solid #ccc", color: "#111" }}>
                            {validatingCode ? "…" : "Apply"}
                          </button>
                        </div>
                        {codeError && <p className="font-sans text-xs mt-1" style={{ color: "#C7511F" }}>{codeError}</p>}
                      </div>
                    )}
                  </div>

                  <div className="pt-2" style={{ borderTop: "1px solid #EEE" }}>
                    <div className="flex justify-between font-sans font-bold text-base" style={{ color: "#0F1111" }}>
                      <span>Order total</span>
                      <span>€{grandTotal.toFixed(2)}</span>
                    </div>
                    {belowMinCharge && (
                      <p className="font-sans text-xs mt-1" style={{ color: "#C7511F" }}>{minChargeNotice}</p>
                    )}
                  </div>

                  {error && <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{error}</p>}

                  <button onClick={handlePlaceOrder} disabled={placing || belowMinCharge}
                    className="hidden lg:block w-full font-sans text-sm font-bold py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-60"
                    style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                    {placing ? "Redirecting to payment…" : `Continue to secure payment · €${grandTotal.toFixed(2)}`}
                  </button>
                  <div className="pt-1">
                    <TrustBadges compact />
                  </div>
                  <p className="font-sans text-xs text-center" style={{ color: "#888" }}>
                    By placing your order, you agree to our Terms &amp; Privacy Policy.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile sticky checkout bar — keeps the CTA reachable without scrolling back up.
          Its height is published as --bottom-bar-h (same pattern as the navbar's
          --nav-h) so anything else anchored to the bottom of the viewport — the
          cookie consent banner above all — can sit clear of it instead of covering
          the one button that takes the money. */}
      {user && items.length > 0 && (
        <div ref={bottomBarRef} className="lg:hidden fixed bottom-0 left-0 right-0 z-40 px-3 py-3"
          style={{ background: "#fff", borderTop: "1px solid #DDD", boxShadow: "0 -2px 12px rgba(0,0,0,0.08)" }}>
          {(error || belowMinCharge) && (
            <p className="font-sans text-xs mb-2 text-center" style={{ color: "#C7511F" }}>{error || minChargeNotice}</p>
          )}
          <button onClick={handlePlaceOrder} disabled={placing || belowMinCharge}
            className="w-full font-sans text-sm font-bold py-3 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-60"
            style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
            {placing ? "Redirecting to payment…" : `Continue to secure payment · €${grandTotal.toFixed(2)}`}
          </button>
        </div>
      )}

      <FooterSection />
    </div>
  );
};

export default CheckoutPage;
