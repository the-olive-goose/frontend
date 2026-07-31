/**
 * The Olive Goose — Welcome Discount Code E2E Suite
 *
 * Covers the whole subscribe → email code → apply at checkout → pay flow, and
 * the "no loopholes" guarantees the feature is built around:
 *   - a new subscriber is issued exactly ONE code (unique per email)
 *   - re-subscribing never mints a second code
 *   - the code validates for a signed-in shopper and carries the right %
 *   - the discount actually reaches the Stripe payment amount (session retrieved
 *     from Stripe's API and asserted against a no-code control session)
 *   - a code held by one shopper's in-flight checkout can't be used by another
 *   - one account can't stack two welcome codes across parallel checkouts
 *   - full UI journey: apply in the checkout page, reach Stripe with the discount
 *
 * Runs against the ISOLATED test stack (fresh Postgres, backend :3002, frontend
 * :8081), Stripe in test mode. Emails run in dev-mode (RESEND_API_KEY empty), so
 * the subscribe response returns the code inline — that's how we read it here.
 *
 * Serial (workers=1): the reservation cases build on codes reserved earlier.
 * Account discipline: shopper2 is the "reserving" account for the API cases;
 * shopper only ever *reads* (validate) before the UI journey, so it stays clean
 * to reserve + redeem its own code there.
 */

import { test, expect, APIRequestContext, request as pwRequest, Page } from "@playwright/test";
import { payStripeTestCard } from "./stripe-checkout";
import { fillDeliveryAddress } from "./address-form";

const API = process.env.E2E_API ?? "http://localhost:3001";
const BASE = process.env.E2E_BASE ?? "http://localhost:8080";
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@test.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin123!",
};
const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };
const SHOPPER2 = { email: "e2e-shopper2@test.local", password: "E2eShopper123" };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DISCOUNT_PERCENT = 15;

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const stripeReady = /^sk_test_/.test(STRIPE_KEY);

let TOKEN = "";
let admin: APIRequestContext;
let shopper: APIRequestContext;
let shopper2: APIRequestContext;
let product: { id: string; price: string };
let unitCents = 0;

const freshEmail = (tag: string) => `e2e-sub-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
const priceToCents = (price: string) => Math.round(parseFloat(String(price).replace(/[^0-9.]/g, "")) * 100);

/** Subscribe an address and return the welcome code issued to it. */
const codeFor = async (email: string): Promise<string> =>
  (await (await admin.post(`/api/subscribers`, { data: { email } })).json()).discount.code;

/** Issue a welcome code to a throwaway address nobody has an account for. */
const issueCode = (tag: string) => codeFor(freshEmail(tag));

// Contexts created by newShopper(), disposed together in afterAll.
const spawned: APIRequestContext[] = [];

/**
 * A brand-new verified account, and — unless `withCode` is false — the welcome
 * code issued to its own address.
 *
 * Welcome codes are bound to the mailbox they were sent to and capped at one per
 * mailbox, so "a fresh account registered from a fresh address" is the only way to
 * get a fresh, usable welcome code. That's the customer journey the feature is for,
 * so testing through it is also the more honest test.
 */
async function newShopper(tag: string, withCode = true) {
  const email = `e2e-wc-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = "E2eShopper123";
  const ctx = await pwRequest.newContext({ baseURL: API });
  spawned.push(ctx);

  const start = await ctx.post(`/api/user/register/start`, { data: { email, password, full_name: "E2E Welcome" } });
  expect(start.ok(), `register/start must succeed: ${await start.text()}`).toBeTruthy();
  const { dev_otp } = await start.json();
  expect(dev_otp, "the isolated stack runs email in dev mode and returns the OTP inline").toBeTruthy();
  const verify = await ctx.post(`/api/user/register/verify`, { data: { email, otp: dev_otp } });
  expect(verify.ok(), `register/verify must succeed: ${await verify.text()}`).toBeTruthy();

  return { ctx, email, code: withCode ? await codeFor(email) : "" };
}

/** Retrieve a Stripe Checkout Session over the REST API (no SDK dependency). */
async function retrieveStripeSession(sessionId: string) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  expect(res.ok, "Stripe session retrieve must succeed").toBeTruthy();
  return res.json() as Promise<{
    amount_total: number;
    status?: string;
    payment_status?: string;
    total_details?: { amount_discount?: number };
  }>;
}

/** Extract the cs_test_… id from a hosted Checkout URL. */
const sessionIdFromUrl = (url: string) => (url.match(/cs_test_[A-Za-z0-9]+/) ?? [])[0];

/** Put the chosen catalog product in a shopper's cart via API. */
async function addToCart(ctx: APIRequestContext) {
  await ctx.delete(`${API}/api/cart`);
  const res = await ctx.post(`${API}/api/cart/items`, {
    data: { product_id: product.id, product_data: { id: product.id, price: product.price }, quantity: 1 },
  });
  expect(res.ok(), "add to cart must succeed").toBeTruthy();
}

const DELIVERY = {
  fulfillment_type: "delivery",
  shipping_address: {
    full_name: "E2E Shopper", phone: "+353851234567", address_line1: "1 Test Street",
    city: "Dublin", state: "Dublin", postal_code: "D01 F5P2", country: "Ireland",
  },
};

test.beforeAll(async () => {
  admin = await pwRequest.newContext({ baseURL: API });
  const login = await admin.post(`/api/auth/login`, { data: ADMIN });
  expect(login.ok(), "admin login must succeed (seed the isolated stack first)").toBeTruthy();
  TOKEN = (await login.json()).token;

  // Guarantee the signup-popup discount is on at a known percent, so every new
  // subscriber gets a code — the backend reads this to decide whether to issue.
  const put = await admin.put(`/api/content/subscribePopup`, {
    headers: auth(TOKEN),
    data: {
      enabled: true, discount_percent: DISCOUNT_PERCENT, delay_seconds: 0,
      eyebrow: "psst", headline: "wanna be an insider?",
      subtext: "drop your email & score {discount}% off your first order.",
      placeholder: "your email, bestie", cta_text: "claim my {discount}% off",
      success_text: "you're in!",
    },
  });
  expect(put.ok(), "seeding subscribePopup settings must succeed").toBeTruthy();

  shopper = await pwRequest.newContext({ baseURL: API });
  expect((await shopper.post(`/api/user/login`, { data: SHOPPER })).ok()).toBeTruthy();
  shopper2 = await pwRequest.newContext({ baseURL: API });
  expect((await shopper2.post(`/api/user/login`, { data: SHOPPER2 })).ok()).toBeTruthy();

  // Checkout re-prices from the catalog, so the cart product id must exist there.
  // Avoid any product a Today's-Deals bundle references, so a single-item cart
  // carries no bundle discount and the control (no-code) session is truly €0-off.
  const products = await (await admin.get(`/api/content/products`)).json();
  const items: Array<{ id: string; price: string }> = products?.items ?? [];
  const deals = await (await admin.get(`/api/content/deals`)).json();
  const bundledIds = new Set<string>(
    (deals?.bundles ?? []).flatMap((b: { product_ids?: string[] }) => b.product_ids ?? [])
  );
  product = items.find((p) => priceToCents(p.price) > 0 && !bundledIds.has(p.id))
    ?? items.find((p) => priceToCents(p.price) > 0)!;
  expect(product, "a priced catalog product must exist to test discounts").toBeTruthy();
  unitCents = priceToCents(product.price);
});

test.afterAll(async () => {
  await admin?.dispose();
  await shopper?.dispose();
  await shopper2?.dispose();
  for (const ctx of spawned) await ctx.dispose();
});

// ─── 1. Issuance ──────────────────────────────────────────────────────────────

test.describe("Issuance", () => {
  test("a new subscriber is emailed one code; re-subscribing returns the same code, never a second", async () => {
    const email = freshEmail("issue");

    const first = await admin.post(`/api/subscribers`, { data: { email } });
    expect(first.status()).toBe(201);
    const body = await first.json();
    expect(body.already_subscribed).toBe(false);
    expect(body.discount).toBeTruthy();
    expect(body.discount.discount_percent).toBe(DISCOUNT_PERCENT);
    // Dev mode (RESEND empty) → code returned inline; delivered=false.
    expect(body.discount.email_delivered).toBe(false);
    expect(body.discount.code).toMatch(/^OG-[A-Z2-9]{8}$/);
    const code = body.discount.code as string;

    // Re-subscribing an already-listed email hands back the SAME unused code
    // (200, already_subscribed) rather than minting a second or stonewalling —
    // this is what lets pre-existing subscribers finally get their code.
    const again = await admin.post(`/api/subscribers`, { data: { email } });
    expect(again.status()).toBe(200);
    const againBody = await again.json();
    expect(againBody.already_subscribed).toBe(true);
    expect(againBody.discount.code).toBe(code);

    // …and there is still exactly one code row for the email.
    const { codes } = await (await admin.get(`/api/admin/discount-codes`, { headers: auth(TOKEN) })).json();
    const forEmail = codes.filter((c: { email: string }) => c.email === email);
    expect(forEmail).toHaveLength(1);
    expect(forEmail[0].code).toBe(code);
  });

  test("+tag aliases of one mailbox all get the SAME code, not a discount each", async () => {
    // me+1@…, me+2@… and me@… are one inbox. Issuing a code per spelling is the
    // whole alias farm: subscribe as +1, +2, +3… and mint unlimited first-order
    // discounts, each one verifiable from the same mailbox.
    const base = freshEmail("alias");
    const [local, domain] = base.split("@");

    const first = await codeFor(base);
    expect(first).toMatch(/^OG-[A-Z2-9]{8}$/);

    for (const alias of [`${local}+deals@${domain}`, `${local}+2@${domain}`, `${local}+again@${domain}`]) {
      const res = await admin.post(`/api/subscribers`, { data: { email: alias } });
      const body = await res.json();
      expect(body.discount?.code, `${alias} must not mint a second code`).toBe(first);
    }

    // …and the table agrees: one row for the whole mailbox.
    const { codes } = await (await admin.get(`/api/admin/discount-codes`, { headers: auth(TOKEN) })).json();
    const forMailbox = codes.filter((c: { email: string | null }) => (c.email ?? "").startsWith(local));
    expect(forMailbox).toHaveLength(1);
  });

  test("Gmail dot variants are the same mailbox too", async () => {
    // Google ignores dots in the local part, so m.e@gmail.com is me@gmail.com.
    const local = `e2e.dots.${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
    const first = await codeFor(`${local}@gmail.com`);
    const dotted = await admin.post(`/api/subscribers`, { data: { email: `${local.replace(/\./g, "")}@gmail.com` } });
    expect((await dotted.json()).discount?.code).toBe(first);
    // …including the googlemail.com spelling of the same account.
    const alt = await admin.post(`/api/subscribers`, { data: { email: `${local}@googlemail.com` } });
    expect((await alt.json()).discount?.code).toBe(first);
  });
});

// ─── 2. Validation (read-only; reserves nothing) ──────────────────────────────

test.describe("Validation", () => {
  test("a real code validates with its percent; junk and anonymous probes are rejected", async () => {
    const owner = await newShopper("validate");
    const code = owner.code;

    const good = await (await owner.ctx.post(`/api/discount/validate`, { data: { code } })).json();
    expect(good.valid).toBe(true);
    expect(good.discount_percent).toBe(DISCOUNT_PERCENT);

    // Case/whitespace-insensitive.
    const messy = await (await owner.ctx.post(`/api/discount/validate`, { data: { code: `  ${code.toLowerCase()} ` } })).json();
    expect(messy.valid).toBe(true);

    const bad = await (await shopper.post(`/api/discount/validate`, { data: { code: "OG-NOTREAL9" } })).json();
    expect(bad.valid).toBe(false);
    expect(bad.message).toBeTruthy();

    const anon = await pwRequest.newContext({ baseURL: API });
    expect((await anon.post(`/api/discount/validate`, { data: { code } })).status()).toBe(401);
    await anon.dispose();
  });
});

// ─── 3. The discount reaches the real payment amount ──────────────────────────

test.describe("Payment amount", () => {
  test("a coded checkout is charged exactly the discount less than an identical uncoded one", async () => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");

    const buyer = await newShopper("amount");
    await addToCart(buyer.ctx);

    // Control: same cart, no code.
    const noCode = await buyer.ctx.post(`/api/checkout/session`, { data: { ...DELIVERY } });
    expect(noCode.ok()).toBeTruthy();
    const noCodeSession = await retrieveStripeSession(sessionIdFromUrl((await noCode.json()).url));

    // With the code applied. Starting this checkout supersedes the control session
    // above (only one live checkout per shopper) and reserves the code to `buyer`.
    const withCode = await buyer.ctx.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: buyer.code } });
    expect(withCode.ok()).toBeTruthy();
    const withCodeSession = await retrieveStripeSession(sessionIdFromUrl((await withCode.json()).url));

    const expectedDiscountCents = Math.round(Number(((unitCents / 100) * DISCOUNT_PERCENT / 100).toFixed(2)) * 100);
    expect(expectedDiscountCents).toBeGreaterThan(0);
    expect(noCodeSession.total_details?.amount_discount ?? 0).toBe(0);
    expect(withCodeSession.total_details?.amount_discount).toBe(expectedDiscountCents);
    expect(withCodeSession.amount_total).toBe(noCodeSession.amount_total - expectedDiscountCents);
  });
});

// ─── 4. No loopholes ──────────────────────────────────────────────────────────

test.describe("No loopholes", () => {
  test("a welcome code only works for the account it was issued to", async () => {
    // The code is the recipient's first-order discount, not a bearer token —
    // otherwise codes can be farmed on throwaway addresses, shared, or resold.
    const owner = await newShopper("bound");

    const mine = await (await owner.ctx.post(`/api/discount/validate`, { data: { code: owner.code } })).json();
    expect(mine.valid).toBe(true);

    const stranger = await (await shopper.post(`/api/discount/validate`, { data: { code: owner.code } })).json();
    expect(stranger.valid).toBe(false);
    expect(stranger.message).toMatch(/different email address/i);

    // …and the authoritative checkout step refuses it too, never a silent discount.
    await addToCart(shopper);
    const res = await shopper.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: owner.code } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/different email address/i);
  });

  test("a second account on an alias of the same mailbox gets no second first-order discount", async () => {
    // The full abuse path, end to end: subscribe, register, and (here) hold the
    // discount — then try to do the whole thing again from the same inbox via a
    // +tag alias. The alias account is real and verified; what it must not get is
    // a second welcome discount.
    const first = await newShopper("farm");
    const [local, domain] = first.email.split("@");
    const alias = `${local}+again@${domain}`;

    // Subscribing the alias hands back the mailbox's existing code, not a new one.
    const aliasSub = await admin.post(`/api/subscribers`, { data: { email: alias } });
    expect((await aliasSub.json()).discount?.code).toBe(first.code);

    // A second account registered on the alias is allowed — but the code belongs to
    // the mailbox, and this account can't spend a second one.
    const aliasCtx = await pwRequest.newContext({ baseURL: API });
    spawned.push(aliasCtx);
    const start = await aliasCtx.post(`/api/user/register/start`, { data: { email: alias, password: "E2eShopper123" } });
    expect(start.ok()).toBeTruthy();
    const { dev_otp } = await start.json();
    expect((await aliasCtx.post(`/api/user/register/verify`, { data: { email: alias, otp: dev_otp } })).ok()).toBeTruthy();

    // The alias account can see the mailbox's one code (same mailbox, so binding
    // passes) — but there is only ever that one, so no second discount exists.
    const { codes } = await (await admin.get(`/api/admin/discount-codes`, { headers: auth(TOKEN) })).json();
    const mailboxCodes = codes.filter((c: { email: string | null }) => (c.email ?? "").startsWith(local));
    expect(mailboxCodes, "one welcome code per mailbox, however it is spelled").toHaveLength(1);
  });

  test("one account can't stack a second welcome code from another mailbox", async () => {
    const owner = await newShopper("stack");
    const other = await newShopper("stack-other");

    // owner holds its own code via an in-flight checkout…
    await addToCart(owner.ctx);
    expect((await owner.ctx.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: owner.code } })).ok())
      .toBeTruthy();

    // …and a second welcome code — someone else's — is refused at validate…
    const validate = await (await owner.ctx.post(`/api/discount/validate`, { data: { code: other.code } })).json();
    expect(validate.valid).toBe(false);

    // …and at the authoritative checkout step (never a silent second discount).
    const res = await owner.ctx.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: other.code } });
    expect(res.status()).toBe(400);
  });

  test("starting a new checkout retires the previous one, so a code can't fund two payments", async () => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");
    // A Stripe Checkout Session stays payable for ~24h, but the code's exclusive
    // hold lapses after 30 minutes. Without retiring the old session, a shopper
    // could open a coded checkout, wait out the hold, open a second, and pay BOTH
    // at a discount — the single-use code funding two orders.
    const buyer = await newShopper("supersede");
    await addToCart(buyer.ctx);

    const firstRes = await buyer.ctx.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: buyer.code } });
    expect(firstRes.ok()).toBeTruthy();
    const firstId = sessionIdFromUrl((await firstRes.json()).url);

    // Abandon it and start again with the same code — allowed, it's the same shopper.
    await addToCart(buyer.ctx);
    const secondRes = await buyer.ctx.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: buyer.code } });
    expect(secondRes.ok(), "a shopper must be able to retry their own abandoned checkout").toBeTruthy();
    const secondId = sessionIdFromUrl((await secondRes.json()).url);
    expect(secondId).not.toBe(firstId);

    // The abandoned session is now expired at Stripe — it can never be paid.
    const first = await retrieveStripeSession(firstId);
    expect(first.status, "the superseded session must be expired at Stripe").toBe("expired");
    const second = await retrieveStripeSession(secondId);
    expect(second.status).toBe("open");
  });
});

// ─── 4b. Admin-created custom codes ───────────────────────────────────────────

test.describe("Admin custom codes", () => {
  const uniqueCode = (tag: string) => `E2E-${tag}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`.toUpperCase();

  const createCode = (data: Record<string, unknown>) =>
    admin.post(`/api/admin/discount-codes`, { headers: auth(TOKEN), data });

  test("percentage code: created, validates for a shopper, exempt from the welcome cap", async () => {
    const code = uniqueCode("pct");
    const created = await createCode({ code, discount_type: "percentage", discount_value: 25, max_redemptions: 5, label: "e2e pct" });
    expect(created.status()).toBe(201);
    const row = await created.json();
    expect(row.code).toBe(code);
    expect(row.discount_type).toBe("percentage");
    expect(Number(row.discount_value)).toBe(25);
    expect(row.max_redemptions).toBe(5);
    expect(row.is_active).toBe(true);

    // A shopper actively holding their own welcome code must still be able to use
    // an admin promo code: the welcome cap and the recipient binding are rules
    // about welcome codes only, and must never leak onto campaign codes.
    const holder = await newShopper("admin-exempt");
    await addToCart(holder.ctx);
    expect((await holder.ctx.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: holder.code } })).ok())
      .toBeTruthy();

    const v = await (await holder.ctx.post(`/api/discount/validate`, { data: { code } })).json();
    expect(v.valid).toBe(true);
    expect(v.discount_type).toBe("percentage");
    expect(Number(v.discount_value)).toBe(25);
  });

  test("auto-generates an unguessable code when none is supplied", async () => {
    const created = await createCode({ discount_type: "percentage", discount_value: 10 });
    expect(created.status()).toBe(201);
    expect((await created.json()).code).toMatch(/^OG-[A-Z2-9]{8}$/);
  });

  test("rejects bad input and duplicate codes", async () => {
    expect((await createCode({ discount_type: "percentage", discount_value: 0 })).status()).toBe(400);
    expect((await createCode({ discount_type: "percentage", discount_value: 150 })).status()).toBe(400);
    expect((await createCode({ discount_type: "fixed", discount_value: 5, max_redemptions: 0 })).status()).toBe(400);

    const code = uniqueCode("dupe");
    expect((await createCode({ code, discount_type: "fixed", discount_value: 5 })).status()).toBe(201);
    const again = await createCode({ code, discount_type: "fixed", discount_value: 5 });
    expect(again.status()).toBe(409);
  });

  test("a single-use admin code held by one checkout blocks another shopper", async () => {
    const code = uniqueCode("single");
    expect((await createCode({ code, discount_type: "percentage", discount_value: 20, max_redemptions: 1 })).status()).toBe(201);

    // shopper reserves it via an in-flight checkout session…
    await addToCart(shopper);
    const held = await shopper.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: code } });
    expect(held.ok()).toBeTruthy();

    // …so shopper2 is now blocked on the same single-use code.
    const other = await (await shopper2.post(`/api/discount/validate`, { data: { code } })).json();
    expect(other.valid).toBe(false);
    expect(other.message).toMatch(/another checkout/i);
  });

  test("a multi-use admin code can be reserved by two different shoppers", async () => {
    const code = uniqueCode("multi");
    expect((await createCode({ code, discount_type: "percentage", discount_value: 10, max_redemptions: 3 })).status()).toBe(201);

    await addToCart(shopper);
    expect((await shopper.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: code } })).ok()).toBeTruthy();
    // A second, different shopper is NOT blocked — multi-use codes take no
    // exclusive hold; capacity is enforced atomically at redeem.
    const otherShopper = await pwRequest.newContext({ baseURL: API });
    expect((await otherShopper.post(`/api/user/login`, { data: SHOPPER })).ok()).toBeTruthy();
    await otherShopper.dispose();
    const v = await (await shopper2.post(`/api/discount/validate`, { data: { code } })).json();
    expect(v.valid).toBe(true);
  });

  test("fixed-amount code reaches the payment as a flat euro discount", async () => {
    test.skip(!stripeReady, "STRIPE_SECRET_KEY (test mode) not available to the test process");
    // Fixed €3 off — smaller than the unit price so it isn't clamped to subtotal.
    const fixedEuros = 3;
    expect(unitCents).toBeGreaterThan(fixedEuros * 100);
    const code = uniqueCode("fixed");
    expect((await createCode({ code, discount_type: "fixed", discount_value: fixedEuros, max_redemptions: 10 })).status()).toBe(201);

    await addToCart(shopper);
    const withCode = await shopper.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: code } });
    expect(withCode.ok()).toBeTruthy();
    const session = await retrieveStripeSession(sessionIdFromUrl((await withCode.json()).url));
    expect(session.total_details?.amount_discount).toBe(fixedEuros * 100);
  });

  test("deactivating a code stops it validating; reactivating restores it", async () => {
    const code = uniqueCode("toggle");
    const created = await createCode({ code, discount_type: "percentage", discount_value: 15 });
    const id = (await created.json()).id;

    expect((await (await shopper.post(`/api/discount/validate`, { data: { code } })).json()).valid).toBe(true);

    const off = await admin.patch(`/api/admin/discount-codes/${id}`, { headers: auth(TOKEN), data: { is_active: false } });
    expect(off.ok()).toBeTruthy();
    const deactivated = await (await shopper.post(`/api/discount/validate`, { data: { code } })).json();
    expect(deactivated.valid).toBe(false);
    expect(deactivated.message).toMatch(/no longer active/i);

    const on = await admin.patch(`/api/admin/discount-codes/${id}`, { headers: auth(TOKEN), data: { is_active: true } });
    expect(on.ok()).toBeTruthy();
    expect((await (await shopper.post(`/api/discount/validate`, { data: { code } })).json()).valid).toBe(true);
  });
});

// ─── 5. Full UI journey (shopper — clean account, reserves + redeems its own) ──

test.describe("Checkout UI", () => {
  test("apply the emailed code on the checkout page and reach Stripe with the discount", async ({ page }) => {
    test.setTimeout(180_000);

    // Issued to the shopper's OWN address — welcome codes are bound to the mailbox
    // they were sent to, which is exactly what a real customer does: subscribe from
    // the popup, then sign in and spend it.
    const code = await codeFor(SHOPPER.email);

    await signIn(page);
    await page.request.delete(`${API}/api/cart`);

    await page.goto(`${BASE}/shop`);
    await page.getByRole("button", { name: /add to cart/i }).first().click();

    await page.goto(`${BASE}/checkout`);
    // Country first: it drives the county dropdown and the Eircode rules below it.
    await fillDeliveryAddress(page, "E2E Shopper");

    // Apply the code in the order summary.
    await page.getByPlaceholder(/OG-/i).fill(code);
    await page.getByRole("button", { name: /^apply$/i }).click();

    // The summary reflects the discount.
    await expect(page.getByText(new RegExp(`${DISCOUNT_PERCENT}% off`, "i")).first())
      .toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(new RegExp(`Code ${code}`, "i")).first()).toBeVisible();

    // Place order → reaching Stripe means the server accepted the coded session
    // (validated + reserved + priced) and handed us off to pay.
    await page.getByRole("button", { name: /continue to secure payment/i }).first().click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
    expect(page.url()).toContain("checkout.stripe.com");

    // Remember which session we're paying for: this shopper has older orders from
    // earlier cases, so "the newest order" is not a safe way to find this one.
    const paidSessionId = sessionIdFromUrl(page.url());
    expect(paidSessionId, "a Stripe session id must be readable from the URL").toBeTruthy();

    // Best-effort: drive Stripe's hosted card widget (its UI, not ours — failing
    // to drive it is a skip). If it succeeds, verify the order finalized at the
    // discounted total and the code is now spent.
    const paid = await payStripeTestCard(page).catch(() => false);
    test.skip(!paid, "Stripe hosted card widget not automatable in this run — the coded session reached Stripe, which is the part our code owns.");

    await page.waitForURL(/\/checkout\/success/, { timeout: 90_000 });

    // The success page finalizes the order by polling Stripe, so the order does
    // not exist the instant the URL changes. Wait for THIS session's order.
    const orderForSession = async () => {
      const orders = await (await page.request.get(`${API}/api/orders`)).json();
      return orders.find((o: { stripe_session_id?: string }) => o.stripe_session_id === paidSessionId);
    };
    await expect(async () => {
      expect(await orderForSession(), "the paid order must finalize").toBeTruthy();
    }).toPass({ timeout: 60_000 });

    const order = await orderForSession();
    expect(Number(order.discount_amount), "the applied code must be recorded on the order")
      .toBeGreaterThan(0);
    expect(order.payment_status).toBe("paid");

    // Spent for good: the code no longer validates.
    const after = await (await page.request.post(`${API}/api/discount/validate`, { data: { code } })).json();
    expect(after.valid).toBe(false);
    expect(after.message).toMatch(/already been used/i);

    // …and "first order" means first order. Re-subscribing — as the same address or
    // as a +tag alias of it — must not hand this shopper a second discount.
    const [local, domain] = SHOPPER.email.split("@");
    for (const email of [SHOPPER.email, `${local}+again@${domain}`]) {
      const res = await admin.post(`/api/subscribers`, { data: { email } });
      expect(res.status(), `${email} must not be issued a fresh code`).toBe(409);
      expect((await res.json()).already_used).toBe(true);
    }
  });
});

// ─── 6. Signup popup (browser) ────────────────────────────────────────────────

test.describe("Signup popup", () => {
  const POPUP = '[aria-label="Newsletter signup offer"]';

  async function openPopup(page: Page) {
    await page.goto(BASE);
    // The card waits until the cookie banner is answered — accept it first.
    const accept = page.getByRole("button", { name: /accept all/i });
    if (await accept.isVisible().catch(() => false)) await accept.click();
    await expect(page.locator(POPUP)).toBeVisible({ timeout: 15_000 });
  }

  test("subscribing shows the code with a copy button and does not auto-close", async ({ page }) => {
    await openPopup(page);

    await page.locator(`${POPUP} input[type="email"]`).fill(freshEmail("popup"));
    await page.locator(`${POPUP} button[type="submit"]`).click();

    // The success view shows the actual code and a copy affordance…
    await expect(page.locator(POPUP).getByText(/^OG-[A-Z2-9]{8}$/)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(POPUP).getByText(/tap to copy/i)).toBeVisible();

    // …and it stays put (no 3.5s auto-close eating the code).
    await page.waitForTimeout(4500);
    await expect(page.locator(POPUP)).toBeVisible();
  });

  test("an already-subscribed email with an unused code gets its code re-shown, not stonewalled", async ({ page }) => {
    const taken = freshEmail("popup-dupe");
    const firstCode = (await (await admin.post(`/api/subscribers`, { data: { email: taken } })).json()).discount.code;

    await openPopup(page);
    await page.locator(`${POPUP} input[type="email"]`).fill(taken);
    await page.locator(`${POPUP} button[type="submit"]`).click();

    // Re-subscribing hands back the SAME code with an "already on the list" note,
    // and the card stays open — the pre-existing-subscriber can finally see it.
    await expect(page.locator(POPUP).getByText(/already on the list/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(POPUP).getByText(new RegExp(firstCode))).toBeVisible();
  });
});

// ─── shared UI helpers (mirrors customer-journey.spec.ts) ────────────────────

async function signIn(page: Page) {
  await page.goto(BASE);
  await page.getByRole("button", { name: /account|sign in/i }).first().click();
  const signInBtn = page.getByRole("button", { name: /^sign in$/i }).first();
  if (await signInBtn.isVisible().catch(() => false)) await signInBtn.click();
  await page.getByPlaceholder("you@example.com").fill(SHOPPER.email);
  await page.getByPlaceholder("Your password").fill(SHOPPER.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByPlaceholder("Your password")).toBeHidden({ timeout: 10_000 });
}

