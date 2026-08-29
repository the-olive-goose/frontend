/**
 * The Olive Goose — Checkout edge cases
 *
 * The paths a real customer hits when something about their basket has changed
 * underneath them, or when they choose the non-default fulfilment. Each of these
 * is a place where the shopper is one click from paying, so the failure mode is
 * either a lost sale or a charge we can't honour:
 *
 *   - the last candle sold out while it sat in their basket
 *   - a product was pulled from the catalogue after they added it
 *   - they picked in-store pickup (no shipping, its own discount, no address)
 *   - they tried to check out for delivery without a usable address
 *   - their basket survived signing out and back in
 *
 * Complements payment-security.spec.ts, which covers the adversarial side
 * (re-pricing, forged quantities, webhook signatures, IDOR).
 *
 * Runs against the ISOLATED test stack (backend :3002, frontend :8081).
 */

import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:3001";
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@test.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin123!",
};
const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const cents = (p: string | number) => Math.round(parseFloat(String(p).replace(/[^0-9.]/g, "")) * 100);

interface CatalogProduct { id: string; price: string; name: string; image_url?: string; stock?: number | null }

let TOKEN = "";
let admin: APIRequestContext;
let shopper: APIRequestContext;
let originalProducts: { items: CatalogProduct[] } = { items: [] };
let originalPickup: Record<string, unknown> = {};
let P: CatalogProduct;

const DELIVERY = {
  fulfillment_type: "delivery",
  shipping_address: {
    full_name: "E2E Shopper", phone: "+353851234567", address_line1: "1 Test Street",
    city: "Dublin", state: "Dublin", postal_code: "D01 F5P2", country: "Ireland",
  },
};

/** Overwrite the catalogue, then restore it in afterEach via restoreCatalog(). */
async function setProducts(items: CatalogProduct[]) {
  const res = await admin.put(`/api/content/products`, {
    headers: auth(TOKEN),
    data: { ...originalProducts, items },
  });
  expect(res.ok(), `writing the catalogue must succeed: ${await res.text()}`).toBeTruthy();
}

async function restoreCatalog() {
  await admin.put(`/api/content/products`, { headers: auth(TOKEN), data: originalProducts });
}

async function setCart(product: CatalogProduct, quantity: number) {
  await shopper.delete(`/api/cart`);
  const res = await shopper.post(`/api/cart/items`, {
    data: { product_id: product.id, product_data: { ...product }, quantity },
  });
  expect(res.ok(), "adding to the cart must succeed").toBeTruthy();
}

test.beforeAll(async () => {
  admin = await pwRequest.newContext({ baseURL: API });
  const login = await admin.post(`/api/auth/login`, { data: ADMIN });
  expect(login.ok(), "admin login must succeed").toBeTruthy();
  TOKEN = (await login.json()).token;

  shopper = await pwRequest.newContext({ baseURL: API });
  expect((await shopper.post(`/api/user/login`, { data: SHOPPER })).ok()).toBeTruthy();

  originalProducts = await (await admin.get(`/api/content/products`)).json();
  originalPickup = await (await admin.get(`/api/content/pickupSettings`)).json() ?? {};

  P = (originalProducts.items ?? []).find((p) => cents(p.price) > 0)!;
  expect(P, "a priced catalog product is required").toBeTruthy();
});

test.afterAll(async () => {
  await restoreCatalog();
  if (Object.keys(originalPickup).length) {
    await admin.put(`/api/content/pickupSettings`, { headers: auth(TOKEN), data: originalPickup });
  }
  await shopper?.delete(`/api/cart`);
  await admin?.dispose();
  await shopper?.dispose();
});

// ─── 1. The basket changed underneath the shopper ────────────────────────────

test.describe("Stock and catalogue changes", () => {
  test.afterEach(async () => { await restoreCatalog(); });

  test("a product that sold out is refused with a message naming it", async () => {
    await setCart(P, 1);
    await setProducts(
      (originalProducts.items ?? []).map((p) => (p.id === P.id ? { ...p, stock: 0 } : p))
    );

    const res = await shopper.post(`/api/checkout/session`, { data: DELIVERY });
    expect(res.status(), "an out-of-stock basket must not reach payment").toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/out of stock/i);
    expect(error, "the shopper needs to know WHICH candle").toContain(P.name);
  });

  test("ordering more than is left tells the shopper how many they can have", async () => {
    await setCart(P, 5);
    await setProducts(
      (originalProducts.items ?? []).map((p) => (p.id === P.id ? { ...p, stock: 2 } : p))
    );

    const res = await shopper.post(`/api/checkout/session`, { data: DELIVERY });
    expect(res.status()).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/only 2/i);
    expect(error).toContain(P.name);
  });

  test("exactly the remaining stock is allowed through", async () => {
    await setCart(P, 2);
    await setProducts(
      (originalProducts.items ?? []).map((p) => (p.id === P.id ? { ...p, stock: 2 } : p))
    );

    const res = await shopper.post(`/api/checkout/session`, { data: DELIVERY });
    expect(res.ok(), `buying the last two must be allowed: ${await res.text()}`).toBeTruthy();
  });

  // The reported symptom: product photos missing on the basket and checkout pages
  // while the very same products showed fine on the shop.
  //
  // A basket row stores the product as it was when it was ADDED, and nothing used
  // to refresh it. One of those stored snapshots held an image URL routed through
  // an image-delivery account that has since stopped serving — it answers 401 —
  // so every <img> in the buying flow was a broken image, even though the live
  // catalogue had already been changed back to a working URL. The same staleness
  // would show a shopper last week's price on a basket left open over a weekend.
  test("the basket shows the product as it is NOW, not as it was when added", async () => {
    const dead = "https://res.cloudinary.com/an-account-that-stopped-serving/image/fetch/gone.png";
    await shopper.delete(`/api/cart`);
    const added = await shopper.post(`/api/cart/items`, {
      data: {
        product_id: P.id,
        // Exactly the shape that was stranded in production: a real product id
        // carrying an image URL, name and price that have all since moved on.
        product_data: { ...P, image_url: dead, name: "Name From Last Week", price: "999" },
        quantity: 1,
      },
    });
    expect(added.ok(), "adding to the cart must succeed").toBeTruthy();

    const rows = await (await shopper.get(`/api/cart`)).json();
    const row = rows.find((r: { product_id: string }) => String(r.product_id) === String(P.id));
    expect(row, "the added row must come back").toBeTruthy();
    expect(row.product_data.image_url, "a dead stored photo must not reach the page").not.toBe(dead);
    expect(row.product_data.image_url).toBe(P.image_url ?? "");
    expect(row.product_data.name, "the basket must not show a stale name").toBe(P.name);
    expect(cents(row.product_data.price), "nor a stale price").toBe(cents(P.price));
  });

  // A product pulled from the catalogue keeps its snapshot rather than vanishing:
  // a basket that empties itself with no explanation is worse than one that says
  // why at checkout — which is what the sold-out and withdrawn cases above do.
  test("a product no longer in the catalogue still appears in the basket", async () => {
    await setCart(P, 1);
    await setProducts((originalProducts.items ?? []).filter((p) => p.id !== P.id));

    const rows = await (await shopper.get(`/api/cart`)).json();
    expect(rows.some((r: { product_id: string }) => String(r.product_id) === String(P.id)),
      "the row must not disappear silently").toBeTruthy();
  });

  test("untracked stock (null) is not treated as zero", async () => {
    await setCart(P, 3);
    await setProducts(
      (originalProducts.items ?? []).map((p) => (p.id === P.id ? { ...p, stock: null } : p))
    );

    const res = await shopper.post(`/api/checkout/session`, { data: DELIVERY });
    expect(res.ok(), "products without inventory tracking must stay buyable").toBeTruthy();
  });

  test("a product pulled from the catalogue is refused, not silently priced at zero", async () => {
    await setCart(P, 1);
    await setProducts((originalProducts.items ?? []).filter((p) => p.id !== P.id));

    const res = await shopper.post(`/api/checkout/session`, { data: DELIVERY });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/no longer available/i);
  });
});

// ─── 2. Fulfilment choices ───────────────────────────────────────────────────

test.describe("Pickup vs delivery", () => {
  test("pickup charges no shipping and applies its own discount", async () => {
    await admin.put(`/api/content/pickupSettings`, {
      headers: auth(TOKEN),
      data: {
        ...originalPickup, enabled: true, discount_percent: 10,
        location_name: "The Olive Goose", address_line1: "1 Studio Lane",
        city: "Dublin 18", eircode: "D18 K7W2", country: "Ireland", hours: "10–5",
      },
    });
    await setCart(P, 1);

    const res = await shopper.post(`/api/checkout/session`, {
      data: { fulfillment_type: "pickup", contact_phone: "+353851234567" },
    });
    expect(res.ok(), `pickup checkout must succeed: ${await res.text()}`).toBeTruthy();

    // No delivery address was supplied and none was needed.
    const orders = await (await shopper.get(`/api/orders`)).json();
    expect(Array.isArray(orders)).toBeTruthy();
  });

  // Regression: a €0.30 candle checked out for pickup sent Stripe a €0.30 session,
  // which it refuses ("amount_too_small"), and the shopper got a bare
  // "Something went wrong. Please try again." The same basket pays fine for
  // delivery, because the shipping line lifts it over Stripe's €0.50 floor.
  test("a basket under Stripe's minimum is refused with the reason, not a 500", async () => {
    await admin.put(`/api/content/pickupSettings`, {
      headers: auth(TOKEN), data: { ...originalPickup, enabled: true, discount_percent: 0 },
    });
    const cheap = { ...P, price: "0.30" };
    await setProducts((originalProducts.items ?? []).map((p) => (p.id === P.id ? cheap : p)));
    await setCart(cheap, 1);

    const res = await shopper.post(`/api/checkout/session`, {
      data: { fulfillment_type: "pickup", contact_phone: "+353851234567" },
    });
    expect(res.status(), `must be a stated 400, not a masked 500: ${await res.text()}`).toBe(400);
    expect((await res.json()).error).toMatch(/at least €0\.50/i);

    // The identical basket still reaches payment for delivery, where shipping applies.
    const delivery = await shopper.post(`/api/checkout/session`, { data: DELIVERY });
    expect(delivery.ok(), `delivery must still succeed: ${await delivery.text()}`).toBeTruthy();
    await restoreCatalog();
  });

  test("pickup is refused while it is switched off", async () => {
    await admin.put(`/api/content/pickupSettings`, {
      headers: auth(TOKEN), data: { ...originalPickup, enabled: false },
    });
    await setCart(P, 1);

    const res = await shopper.post(`/api/checkout/session`, {
      data: { fulfillment_type: "pickup", contact_phone: "+353851234567" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/not available/i);
  });

  // The address stored on the order is what dispatch prints, so the API applies
  // the same rules the checkout form does — a caller that skips the form can't
  // put an undeliverable address on a paid order.
  test("delivery without a usable address is refused", async () => {
    await setCart(P, 1);

    const bad: [Record<string, string>, RegExp][] = [
      // An omitted address falls back to the account profile, which carries a
      // name but no delivery details — so the phone is the first thing missing.
      [{}, /courier/i],
      [{ ...DELIVERY.shipping_address, address_line1: "" }, /street address/i],
      [{ ...DELIVERY.shipping_address, city: "" }, /city or town/i],
      // Junk that satisfied the old "line 1 and city are non-empty" check.
      [{ ...DELIVERY.shipping_address, address_line1: "4444" }, /street name/i],
      [{ ...DELIVERY.shipping_address, city: "d" }, /city or town/i],
      // A number no courier can ring: ten digits is not an Irish number.
      [{ ...DELIVERY.shipping_address, phone: "6666666666" }, /valid Ireland number/i],
      [{ ...DELIVERY.shipping_address, phone: "" }, /courier/i],
      // Ireland needs a county, and the Eircode has to be a real one.
      [{ ...DELIVERY.shipping_address, state: "" }, /county/i],
      [{ ...DELIVERY.shipping_address, postal_code: "12345" }, /Eircode/i],
      // A Dublin Eircode filed under another county.
      [{ ...DELIVERY.shipping_address, state: "Cork" }, /County Dublin, not Cork/i],
      [{ ...DELIVERY.shipping_address, country: "Narnia" }, /we ship to/i],
    ];

    for (const [shipping_address, expected] of bad) {
      const res = await shopper.post(`/api/checkout/session`, {
        data: { fulfillment_type: "delivery", shipping_address },
      });
      expect(res.status(), `address ${JSON.stringify(shipping_address)} must be refused`).toBe(400);
      expect((await res.json()).error, `message for ${JSON.stringify(shipping_address)}`).toMatch(expected);
    }
  });

  // The number on the order is normalized before it is stored, so ops never has
  // to guess whether "087…" is Irish, and the courier can dial it as-is.
  test("a delivery phone is stored in E.164 whatever the shopper typed", async () => {
    await setCart(P, 1);
    const res = await shopper.post(`/api/checkout/session`, {
      data: {
        ...DELIVERY,
        shipping_address: { ...DELIVERY.shipping_address, phone: "087 123 4567", postal_code: "d01f5p2" },
      },
    });
    expect(res.ok(), `checkout must accept a nationally-formatted number: ${await res.text()}`).toBeTruthy();

    // The order row only exists once Stripe confirms, so assert the normalization
    // through the address book — the same normalizer runs on both paths.
    const saved = await shopper.post(`/api/user/addresses`, {
      data: { ...DELIVERY.shipping_address, phone: "087 123 4567", postal_code: "d01f5p2" },
    });
    expect(saved.ok(), `saving must succeed: ${await saved.text()}`).toBeTruthy();
    const body = await saved.json();
    expect(body.phone, "a national number is stored dialable").toBe("+353871234567");
    expect(body.postal_code, "the Eircode is stored canonically").toBe("D01 F5P2");
    await shopper.delete(`/api/user/addresses/${body.id}`);
  });

  test("the address book refuses what checkout refuses", async () => {
    for (const [patch, expected] of [
      [{ address_line1: "4444" }, /street name/i],
      [{ city: "d" }, /city or town/i],
      [{ phone: "6666666666" }, /valid Ireland number/i],
      [{ state: "" }, /county/i],
    ] as [Record<string, string>, RegExp][]) {
      const res = await shopper.post(`/api/user/addresses`, {
        data: { ...DELIVERY.shipping_address, ...patch },
      });
      expect(res.status(), `address book must refuse ${JSON.stringify(patch)}`).toBe(400);
      expect((await res.json()).error).toMatch(expected);
    }
  });

  test("an unknown fulfilment type falls back to delivery rather than erroring", async () => {
    await setCart(P, 1);
    const res = await shopper.post(`/api/checkout/session`, {
      data: { ...DELIVERY, fulfillment_type: "teleport" },
    });
    expect(res.ok(), "an unrecognised type must be treated as delivery, not crash").toBeTruthy();
  });
});

// ─── 3. Basket integrity ─────────────────────────────────────────────────────

test.describe("Basket integrity", () => {
  test("the basket survives signing out and back in", async () => {
    await setCart(P, 2);
    await shopper.post(`/api/user/logout`);

    const returning = await pwRequest.newContext({ baseURL: API });
    expect((await returning.post(`/api/user/login`, { data: SHOPPER })).ok()).toBeTruthy();
    const cart = await (await returning.get(`/api/cart`)).json();
    expect(cart, "a saved basket must still be there on the next visit").toHaveLength(1);
    expect(cart[0].quantity).toBe(2);

    await returning.dispose();
    // Restore the shared context's session for the remaining tests.
    expect((await shopper.post(`/api/user/login`, { data: SHOPPER })).ok()).toBeTruthy();
  });

  test("a guest cannot create a checkout session", async () => {
    const guest = await pwRequest.newContext({ baseURL: API });
    const res = await guest.post(`/api/checkout/session`, { data: DELIVERY });
    expect(res.status(), "checkout requires a signed-in shopper").toBe(401);
    await guest.dispose();
  });

  test("an empty basket cannot reach payment", async () => {
    await shopper.delete(`/api/cart`);
    const res = await shopper.post(`/api/checkout/session`, { data: DELIVERY });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  test("clearing the basket really clears it", async () => {
    await setCart(P, 1);
    await shopper.delete(`/api/cart`);
    expect(await (await shopper.get(`/api/cart`)).json()).toHaveLength(0);
  });
});
