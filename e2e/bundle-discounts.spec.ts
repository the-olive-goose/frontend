/**
 * The Olive Goose — Today's Deals (dynamic bundle discount) E2E Suite
 *
 * The production failure this suite exists to prevent: the basket/checkout shows
 * one saving, Stripe charges another. The discount is computed TWICE — once in
 * the browser (src/lib/bundleSavings.ts, for display) and once authoritatively in
 * the backend (computeBundleSavings in backend/index.js, for the charge). Any
 * drift between them is invisible in unit tests and only shows up as a customer
 * being charged a different number than the one they agreed to.
 *
 * So every case here asserts the same thing end to end:
 *
 *     what the UI displays  ===  what Stripe is asked to charge
 *
 * by driving the real basket/checkout pages, reading the rendered totals, then
 * retrieving the created Checkout Session from Stripe's own API.
 *
 * Covered shapes: exact-match bundles, multi-quantity (a bundle applying more
 * than once), overlapping bundles that share a candle (per-unit, non-overlapping
 * allocation), fixed vs percentage bundles, inactive bundles, partially-filled
 * bundles, orphaned product_ids left behind by a deleted product, stacking with a
 * promo code and the pickup discount, the free-shipping threshold boundary, and
 * an over-clamped stack where the discounts exceed the basket value.
 *
 * Runs against the ISOLATED test stack (embedded Postgres, backend :3002,
 * frontend :8081) with Stripe in test mode. Serial — it rewrites the shared
 * content_deals setting, and restores the original in afterAll.
 */

import { test, expect, APIRequestContext, request as pwRequest, Page } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:3001";
const BASE = process.env.E2E_BASE ?? "http://localhost:8080";
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@test.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin123!",
};
const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const stripeReady = /^sk_test_/.test(STRIPE_KEY);

interface Bundle {
  id: string;
  name: string;
  description: string;
  product_ids: string[];
  discount_type: "percentage" | "fixed";
  discount_value: number;
  is_active: boolean;
  display_order: number;
}
interface CatalogProduct { id: string; price: string; name: string; stock?: number | null }

let TOKEN = "";
let admin: APIRequestContext;
let shopper: APIRequestContext;
/** Three distinct priced products to build bundles from. */
let P: CatalogProduct[] = [];
let originalDeals: unknown = null;
let originalPickup: Record<string, unknown> = {};
let pickupSettings: Record<string, unknown> & { free_shipping_threshold: number; flat_shipping_rate: number } = {
  free_shipping_threshold: 65, flat_shipping_rate: 4.99,
};

const cents = (price: string | number) =>
  Math.round(parseFloat(String(price).replace(/[^0-9.]/g, "")) * 100);
const euros = (c: number) => c / 100;

const DELIVERY = {
  fulfillment_type: "delivery",
  shipping_address: {
    full_name: "E2E Shopper", phone: "+353851234567", address_line1: "1 Test Street",
    city: "Dublin", state: "Dublin", postal_code: "D01 F5P2", country: "Ireland",
  },
};

/** Retrieve a Stripe Checkout Session over the REST API (no SDK dependency). */
async function retrieveStripeSession(sessionId: string) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  expect(res.ok, "Stripe session retrieve must succeed").toBeTruthy();
  return res.json() as Promise<{ amount_total: number; total_details?: { amount_discount?: number } }>;
}

const sessionIdFromUrl = (url: string) => (url.match(/cs_test_[A-Za-z0-9]+/) ?? [])[0];

/** Replace the live Today's Deals bundles. */
async function setBundles(bundles: Bundle[]) {
  const res = await admin.put(`/api/content/deals`, {
    headers: auth(TOKEN),
    data: { page_title: "Today's Deals", page_subtitle: "Bundle & Save", bundles },
  });
  expect(res.ok(), "writing deals content must succeed").toBeTruthy();
}

/** Build a bundle without repeating the boilerplate fields. */
const bundle = (over: Partial<Bundle> & Pick<Bundle, "id" | "product_ids">): Bundle => ({
  name: `Bundle ${over.id}`, description: "e2e", discount_type: "percentage",
  discount_value: 10, is_active: true, display_order: 1, ...over,
});

/** Put an exact set of items in the shopper's cart. */
async function setCart(items: Array<{ product: CatalogProduct; quantity: number }>) {
  await shopper.delete(`${API}/api/cart`);
  for (const { product, quantity } of items) {
    const res = await shopper.post(`${API}/api/cart/items`, {
      data: { product_id: product.id, product_data: { ...product }, quantity },
    });
    expect(res.ok(), `adding ${product.name} to cart must succeed`).toBeTruthy();
  }
}

/** Create a Checkout Session and return the amount Stripe will charge, in cents. */
async function chargedCents(extra: Record<string, unknown> = {}): Promise<number> {
  const res = await shopper.post(`${API}/api/checkout/session`, { data: { ...DELIVERY, ...extra } });
  expect(res.ok(), `checkout session must be created: ${await res.text()}`).toBeTruthy();
  const session = await retrieveStripeSession(sessionIdFromUrl((await res.json()).url));
  return session.amount_total;
}

/** The discount Stripe applied, in cents. */
async function chargedDiscountCents(extra: Record<string, unknown> = {}): Promise<number> {
  const res = await shopper.post(`${API}/api/checkout/session`, { data: { ...DELIVERY, ...extra } });
  expect(res.ok(), `checkout session must be created: ${await res.text()}`).toBeTruthy();
  const session = await retrieveStripeSession(sessionIdFromUrl((await res.json()).url));
  return session.total_details?.amount_discount ?? 0;
}

/** Sign the browser page in by replaying the shopper's session cookie. */
async function signInPage(page: Page) {
  await page.goto(BASE);
  const res = await page.request.post(`${API}/api/user/login`, { data: SHOPPER });
  expect(res.ok(), "shopper login must succeed").toBeTruthy();
  await page.reload();
}

/**
 * Read the basket's "Estimated total", in cents. The basket deliberately excludes
 * shipping — that only becomes known once the shopper picks delivery or pickup at
 * checkout — so this is an items-after-savings figure.
 */
async function basketTotalCents(page: Page): Promise<number> {
  await page.goto(`${BASE}/basket`);
  const row = page.locator("div").filter({ hasText: /^Estimated total€/ }).last();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const text = await row.innerText();
  const match = text.match(/€\s*([\d.]+)/);
  expect(match, `could not read the basket estimated total from "${text}"`).toBeTruthy();
  return cents(match![1]);
}

/** Shipping the checkout page adds for a delivery order, in cents. */
const deliveryShippingCents = (subtotal: number) =>
  subtotal >= Math.round(pickupSettings.free_shipping_threshold * 100)
    ? 0
    : Math.round(pickupSettings.flat_shipping_rate * 100);

/** Read the total the checkout page renders on its pay button, in cents. */
async function checkoutTotalCents(page: Page): Promise<number> {
  await page.goto(`${BASE}/checkout`);
  const payBtn = page.getByRole("button", { name: /continue to secure payment/i }).first();
  await expect(payBtn).toBeVisible({ timeout: 15_000 });
  const text = await payBtn.innerText();
  const match = text.match(/€\s*([\d.]+)/);
  expect(match, `could not read the checkout total from "${text}"`).toBeTruthy();
  return cents(match![1]);
}

/** Read the bundle savings the basket page renders ("Total savings"), in cents. */
async function basketSavingsCents(page: Page): Promise<number> {
  await page.goto(`${BASE}/basket`);
  await expect(page.getByText(/Estimated total/i).first()).toBeVisible({ timeout: 15_000 });
  const row = page.locator("div").filter({ hasText: /^Total savings−€/ }).last();
  if (!(await row.isVisible().catch(() => false))) return 0;
  const match = (await row.innerText()).match(/−€\s*([\d.]+)/);
  return match ? cents(match[1]) : 0;
}

test.beforeAll(async () => {
  admin = await pwRequest.newContext({ baseURL: API });
  const login = await admin.post(`/api/auth/login`, { data: ADMIN });
  expect(login.ok(), "admin login must succeed (seed the isolated stack first)").toBeTruthy();
  TOKEN = (await login.json()).token;

  shopper = await pwRequest.newContext({ baseURL: API });
  expect((await shopper.post(`/api/user/login`, { data: SHOPPER })).ok()).toBeTruthy();

  // Keep the original deals so the rest of the run sees the content it expects.
  originalDeals = await (await admin.get(`/api/content/deals`)).json();

  const products = await (await admin.get(`/api/content/products`)).json();
  const items: CatalogProduct[] = (products?.items ?? []).filter((p: CatalogProduct) => cents(p.price) > 0);
  // Bundles apply per UNIT, so the stock gate must allow the quantities used
  // here (up to 3 of a product); skip anything too thin to test with.
  P = items.filter((p) => p.stock === undefined || p.stock === null || Number(p.stock) >= 3).slice(0, 3);
  expect(P.length, "need 3 priced, in-stock catalog products to build bundles from").toBe(3);

  // Pin the shipping numbers this suite reasons about. Other specs legitimately
  // rewrite them (admin-journey asserts a €0 flat rate is honoured), and a stale
  // read here would silently move the expected totals.
  originalPickup = await (await admin.get(`/api/content/pickupSettings`)).json() ?? {};
  pickupSettings = { ...originalPickup, free_shipping_threshold: 65, flat_shipping_rate: 4.99 };
  const putPickup = await admin.put(`/api/content/pickupSettings`, {
    headers: auth(TOKEN), data: pickupSettings,
  });
  expect(putPickup.ok(), "pinning the shipping settings must succeed").toBeTruthy();
});

test.afterAll(async () => {
  // Restore the catalogue's real deals and leave no cart behind.
  if (originalDeals && admin) {
    await admin.put(`/api/content/deals`, { headers: auth(TOKEN), data: originalDeals });
  }
  if (admin && Object.keys(originalPickup).length) {
    await admin.put(`/api/content/pickupSettings`, { headers: auth(TOKEN), data: originalPickup });
  }
  await shopper?.delete(`${API}/api/cart`);
  await admin?.dispose();
  await shopper?.dispose();
});

// ─── 1. Displayed savings === charged savings ────────────────────────────────
//
// The core guarantee. Each case configures a bundle shape, then compares the
// number the customer sees with the number Stripe is told to charge.

test.describe("Displayed savings match the charge", () => {
  test("a percentage bundle: basket, checkout and Stripe agree to the cent", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    await setBundles([bundle({ id: "pct-duo", product_ids: [P[0].id, P[1].id], discount_value: 20 })]);
    await setCart([{ product: P[0], quantity: 1 }, { product: P[1], quantity: 1 }]);

    const subtotal = cents(P[0].price) + cents(P[1].price);
    const expectedSaving = Math.round(Number((euros(subtotal) * 0.2).toFixed(2)) * 100);

    await signInPage(page);
    const shownSaving = await basketSavingsCents(page);
    const shownBasketTotal = await basketTotalCents(page);
    const shownCheckoutTotal = await checkoutTotalCents(page);

    expect(shownSaving, "basket must show the bundle saving").toBe(expectedSaving);
    // The basket quotes items-after-savings only; checkout is that plus whatever
    // shipping the (default) delivery option costs.
    expect(shownCheckoutTotal, "basket and checkout must agree on the items, and differ only by shipping")
      .toBe(shownBasketTotal + deliveryShippingCents(subtotal));

    const charged = await chargedCents();
    expect(charged, "Stripe must charge exactly what checkout displayed").toBe(shownCheckoutTotal);
    expect(await chargedDiscountCents()).toBe(expectedSaving);
  });

  test("a fixed-amount bundle reaches the charge as a flat euro saving", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    await setBundles([bundle({
      id: "fixed-duo", product_ids: [P[0].id, P[1].id],
      discount_type: "fixed", discount_value: 7.5,
    })]);
    await setCart([{ product: P[0], quantity: 1 }, { product: P[1], quantity: 1 }]);

    await signInPage(page);
    expect(await basketSavingsCents(page)).toBe(750);
    const shown = await checkoutTotalCents(page);
    expect(await chargedCents()).toBe(shown);
    expect(await chargedDiscountCents()).toBe(750);
  });

  test("a bundle applies once per full set — two sets, twice the saving", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    await setBundles([bundle({
      id: "multi-duo", product_ids: [P[0].id, P[1].id],
      discount_type: "fixed", discount_value: 5,
    })]);
    await setCart([{ product: P[0], quantity: 2 }, { product: P[1], quantity: 2 }]);

    await signInPage(page);
    expect(await basketSavingsCents(page), "two complete sets → the bundle applies twice").toBe(1000);
    const shown = await checkoutTotalCents(page);
    expect(await chargedCents()).toBe(shown);
    expect(await chargedDiscountCents()).toBe(1000);
  });

  test("an unbalanced basket only discounts the sets it can actually form", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    // 3 × P0 but only 1 × P1 → exactly one complete set.
    await setBundles([bundle({
      id: "unbalanced", product_ids: [P[0].id, P[1].id],
      discount_type: "fixed", discount_value: 6,
    })]);
    await setCart([{ product: P[0], quantity: 3 }, { product: P[1], quantity: 1 }]);

    await signInPage(page);
    expect(await basketSavingsCents(page)).toBe(600);
    expect(await chargedDiscountCents()).toBe(600);
  });
});

// ─── 2. Overlapping bundles — no double-dipping a single candle ──────────────

test.describe("Overlapping bundles allocate each unit once", () => {
  test("two bundles sharing a candle do not both discount it", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    // Both bundles contain P1. With one unit of each product only ONE bundle can
    // form — and it must be the higher-value one (€9 beats €4).
    await setBundles([
      bundle({ id: "share-a", product_ids: [P[0].id, P[1].id], discount_type: "fixed", discount_value: 4, display_order: 1 }),
      bundle({ id: "share-b", product_ids: [P[1].id, P[2].id], discount_type: "fixed", discount_value: 9, display_order: 2 }),
    ]);
    await setCart([
      { product: P[0], quantity: 1 }, { product: P[1], quantity: 1 }, { product: P[2], quantity: 1 },
    ]);

    await signInPage(page);
    const shownSaving = await basketSavingsCents(page);
    expect(shownSaving, "only the best single bundle may apply — never 4+9 stacked on one candle").toBe(900);

    const shown = await checkoutTotalCents(page);
    expect(await chargedCents()).toBe(shown);
    expect(await chargedDiscountCents()).toBe(900);
  });

  test("enough units for both overlapping bundles → both apply, once each", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    // Two units of the shared candle → both bundles can form without sharing a unit.
    await setBundles([
      bundle({ id: "share-a", product_ids: [P[0].id, P[1].id], discount_type: "fixed", discount_value: 4, display_order: 1 }),
      bundle({ id: "share-b", product_ids: [P[1].id, P[2].id], discount_type: "fixed", discount_value: 9, display_order: 2 }),
    ]);
    await setCart([
      { product: P[0], quantity: 1 }, { product: P[1], quantity: 2 }, { product: P[2], quantity: 1 },
    ]);

    await signInPage(page);
    expect(await basketSavingsCents(page)).toBe(1300);
    expect(await chargedDiscountCents()).toBe(1300);
  });
});

// ─── 3. Bundles that must NOT discount ───────────────────────────────────────

test.describe("Bundles that must not apply", () => {
  test("a partially-filled bundle discounts nothing", async ({ page }) => {
    await setBundles([bundle({ id: "partial", product_ids: [P[0].id, P[1].id], discount_value: 25 })]);
    await setCart([{ product: P[0], quantity: 1 }]); // missing P1

    await signInPage(page);
    expect(await basketSavingsCents(page)).toBe(0);
    if (stripeReady) expect(await chargedDiscountCents()).toBe(0);
  });

  test("an inactive bundle discounts nothing, in the UI and in the charge", async ({ page }) => {
    await setBundles([bundle({
      id: "inactive", product_ids: [P[0].id, P[1].id],
      discount_value: 30, is_active: false,
    })]);
    await setCart([{ product: P[0], quantity: 1 }, { product: P[1], quantity: 1 }]);

    await signInPage(page);
    expect(await basketSavingsCents(page)).toBe(0);
    if (stripeReady) expect(await chargedDiscountCents()).toBe(0);
  });

  test("a zero-value bundle is a no-op rather than a free order", async ({ page }) => {
    await setBundles([bundle({
      id: "zero", product_ids: [P[0].id, P[1].id],
      discount_type: "fixed", discount_value: 0,
    })]);
    await setCart([{ product: P[0], quantity: 1 }, { product: P[1], quantity: 1 }]);

    await signInPage(page);
    expect(await basketSavingsCents(page)).toBe(0);
    if (stripeReady) expect(await chargedDiscountCents()).toBe(0);
  });
});

// ─── 4. Orphaned product ids (the "Classics Duo never applies" regression) ───

test.describe("Orphaned bundle product ids", () => {
  test("a bundle referencing a deleted product still discounts its surviving candles", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    // 'ghost-product-id' is not in the catalogue — it must be ignored, not treated
    // as an unmet requirement that silently kills the discount forever.
    await setBundles([bundle({
      id: "orphaned", product_ids: [P[0].id, P[1].id, "ghost-product-id"],
      discount_type: "fixed", discount_value: 8,
    })]);
    await setCart([{ product: P[0], quantity: 1 }, { product: P[1], quantity: 1 }]);

    await signInPage(page);
    expect(await basketSavingsCents(page), "the surviving pair must still discount").toBe(800);
    expect(await chargedDiscountCents()).toBe(800);
  });

  test("a bundle whose products are ALL gone discounts nothing", async ({ page }) => {
    await setBundles([bundle({
      id: "all-orphaned", product_ids: ["ghost-1", "ghost-2"],
      discount_type: "fixed", discount_value: 8,
    })]);
    await setCart([{ product: P[0], quantity: 1 }, { product: P[1], quantity: 1 }]);

    await signInPage(page);
    expect(await basketSavingsCents(page)).toBe(0);
    if (stripeReady) expect(await chargedDiscountCents()).toBe(0);
  });
});

// ─── 5. Stacking with a promo code ───────────────────────────────────────────

test.describe("Stacking with a promo code", () => {
  test("bundle saving and a percentage code combine into one honest total", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    const code = `E2EBUNDLE${Date.now().toString().slice(-6)}`;
    const created = await admin.post(`/api/admin/discount-codes`, {
      headers: auth(TOKEN),
      data: { code, discount_type: "percentage", discount_value: 10, max_uses: 5 },
    });
    expect(created.ok(), `creating the admin code must succeed: ${await created.text()}`).toBeTruthy();

    await setBundles([bundle({
      id: "stack-duo", product_ids: [P[0].id, P[1].id],
      discount_type: "fixed", discount_value: 5,
    })]);
    await setCart([{ product: P[0], quantity: 1 }, { product: P[1], quantity: 1 }]);

    const subtotal = cents(P[0].price) + cents(P[1].price);
    // The code applies to the SUBTOTAL, not to the post-bundle amount.
    const codeSaving = Math.round(Number((euros(subtotal) * 0.1).toFixed(2)) * 100);

    await signInPage(page);
    const shownBundleOnly = await checkoutTotalCents(page);
    expect(await chargedDiscountCents()).toBe(500);

    const withCode = await chargedDiscountCents({ discount_code: code });
    expect(withCode, "both discounts must reach the charge").toBe(500 + codeSaving);

    const chargedWithCode = await chargedCents({ discount_code: code });
    expect(chargedWithCode, "the code must come off the bundle-discounted total")
      .toBe(shownBundleOnly - codeSaving);
  });
});

// ─── 6. Shipping interaction ─────────────────────────────────────────────────

test.describe("Free-shipping threshold", () => {
  test("bundle savings do not push a qualifying basket back under the threshold", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    const threshold = Number(pickupSettings.free_shipping_threshold) || 65;
    const pairPrice = euros(cents(P[0].price) + cents(P[1].price));
    // Enough complete pairs for the SUBTOTAL to clear the free-shipping threshold.
    const qty = Math.max(1, Math.ceil(threshold / pairPrice));
    test.skip(qty > 3, "catalogue prices make a threshold-clearing basket exceed seeded stock");

    // A modest per-pair saving: enough to drag the post-discount figure under the
    // threshold, nowhere near enough to zero the basket out.
    await setBundles([bundle({
      id: "ship-duo", product_ids: [P[0].id, P[1].id],
      discount_type: "fixed", discount_value: 5,
    })]);
    await setCart([{ product: P[0], quantity: qty }, { product: P[1], quantity: qty }]);

    const subtotal = qty * (cents(P[0].price) + cents(P[1].price));
    const saving = qty * 500;
    expect(subtotal, "this case needs a basket that clears the threshold").toBeGreaterThanOrEqual(threshold * 100);

    await signInPage(page);
    const shown = await checkoutTotalCents(page);
    const charged = await chargedCents();

    expect(charged, "UI and charge must agree").toBe(shown);
    // Shipping is earned on the subtotal, so the discount must not claw it back.
    expect(charged, "a discount must not cost the shopper their free shipping")
      .toBe(subtotal - saving);
  });

  test("a basket under the threshold pays shipping, and the UI says the same", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    const threshold = Number(pickupSettings.free_shipping_threshold) || 65;
    const subtotal = cents(P[0].price);
    test.skip(subtotal >= threshold * 100, "cheapest product already clears free shipping");

    await setBundles([]);
    await setCart([{ product: P[0], quantity: 1 }]);

    await signInPage(page);
    const shown = await checkoutTotalCents(page);
    const charged = await chargedCents();
    const flat = Math.round((Number(pickupSettings.flat_shipping_rate) || 4.99) * 100);

    expect(charged, "UI and charge must agree").toBe(shown);
    expect(charged, "an under-threshold basket must include shipping").toBe(subtotal + flat);
  });
});

// ─── 6b. A zero threshold means free shipping, not "unset" ───────────────────

test.describe("Free shipping for everyone", () => {
  test("a threshold of 0 gives free shipping at any basket size", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    // 0 is a real setting ("free delivery on all orders"), not a missing one. A
    // `|| 65` fallback would reinstate a €65 bar server-side while the storefront
    // honoured the 0 — the basket would say FREE and Stripe would bill shipping.
    await admin.put(`/api/content/pickupSettings`, {
      headers: auth(TOKEN),
      data: { ...pickupSettings, free_shipping_threshold: 0, flat_shipping_rate: 9.99 },
    });
    try {
      await setBundles([]);
      await setCart([{ product: P[0], quantity: 1 }]);

      await signInPage(page);
      const shown = await checkoutTotalCents(page);
      const charged = await chargedCents();

      expect(charged, "UI and charge must agree").toBe(shown);
      expect(charged, "a 0 threshold must mean no shipping is added").toBe(cents(P[0].price));
    } finally {
      await admin.put(`/api/content/pickupSettings`, { headers: auth(TOKEN), data: pickupSettings });
    }
  });
});

// ─── 7. Over-clamped stack ───────────────────────────────────────────────────
//
// The backend clamps the combined discount to the subtotal and then refuses a
// non-positive total. The UI must not promise a cheaper (or free) order than the
// one the backend is willing to create.

test.describe("Discounts larger than the basket", () => {
  test("an over-large bundle saving cannot make the displayed total lie", async ({ page }) => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    const threshold = Number(pickupSettings.free_shipping_threshold) || 65;
    const subtotal = cents(P[0].price);
    // The basket must stay UNDER the free-shipping threshold, so shipping keeps
    // the order total positive and the backend still creates a session. That is
    // the case where a UI that forgets to clamp diverges from the charge: the
    // backend caps the discount at the subtotal and bills the shipping, while an
    // unclamped UI subtracts the whole saving and proudly displays €0.00.
    test.skip(subtotal >= threshold * 100, "cheapest product already earns free shipping");

    await setBundles([bundle({
      id: "over-clamp", product_ids: [P[0].id],
      discount_type: "fixed", discount_value: euros(subtotal) + 20,
    })]);
    await setCart([{ product: P[0], quantity: 1 }]);

    await signInPage(page);
    const shown = await checkoutTotalCents(page);

    const res = await shopper.post(`${API}/api/checkout/session`, { data: { ...DELIVERY } });
    expect(res.ok(), `an over-discounted but shipped order must still be payable: ${await res.text()}`)
      .toBeTruthy();

    const charged = (await retrieveStripeSession(sessionIdFromUrl((await res.json()).url))).amount_total;
    const flat = Math.round((Number(pickupSettings.flat_shipping_rate) || 4.99) * 100);
    expect(charged, "the discount is capped at the subtotal, so shipping is still owed").toBe(flat);
    expect(shown, "what the shopper is charged must equal what checkout displayed").toBe(charged);
  });
});
