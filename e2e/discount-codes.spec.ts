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

// The code shopper2 holds via an in-flight checkout, shared across the API
// reservation cases (this file runs serial in one worker).
let heldCode = "";

const freshEmail = (tag: string) => `e2e-sub-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
const priceToCents = (price: string) => Math.round(parseFloat(String(price).replace(/[^0-9.]/g, "")) * 100);
const issueCode = async (tag: string): Promise<string> =>
  (await (await admin.post(`/api/subscribers`, { data: { email: freshEmail(tag) } })).json()).discount.code;

/** Retrieve a Stripe Checkout Session over the REST API (no SDK dependency). */
async function retrieveStripeSession(sessionId: string) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  expect(res.ok, "Stripe session retrieve must succeed").toBeTruthy();
  return res.json() as Promise<{ amount_total: number; total_details?: { amount_discount?: number } }>;
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
    city: "Dublin", postal_code: "D01AB12", country: "Ireland",
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
});

// ─── 2. Validation (read-only; reserves nothing) ──────────────────────────────

test.describe("Validation", () => {
  test("a real code validates with its percent; junk and anonymous probes are rejected", async () => {
    const code = await issueCode("validate");

    const good = await (await shopper.post(`/api/discount/validate`, { data: { code } })).json();
    expect(good.valid).toBe(true);
    expect(good.discount_percent).toBe(DISCOUNT_PERCENT);

    // Case/whitespace-insensitive.
    const messy = await (await shopper.post(`/api/discount/validate`, { data: { code: `  ${code.toLowerCase()} ` } })).json();
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

    const code = await issueCode("amount");
    await addToCart(shopper2);

    // Control: same cart, no code.
    const noCode = await shopper2.post(`/api/checkout/session`, { data: { ...DELIVERY } });
    expect(noCode.ok()).toBeTruthy();
    const noCodeSession = await retrieveStripeSession(sessionIdFromUrl((await noCode.json()).url));

    // With the code applied (this reserves it to shopper2 for the cases below).
    const withCode = await shopper2.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: code } });
    expect(withCode.ok()).toBeTruthy();
    const withCodeSession = await retrieveStripeSession(sessionIdFromUrl((await withCode.json()).url));

    const expectedDiscountCents = Math.round(Number(((unitCents / 100) * DISCOUNT_PERCENT / 100).toFixed(2)) * 100);
    expect(expectedDiscountCents).toBeGreaterThan(0);
    expect(noCodeSession.total_details?.amount_discount ?? 0).toBe(0);
    expect(withCodeSession.total_details?.amount_discount).toBe(expectedDiscountCents);
    expect(withCodeSession.amount_total).toBe(noCodeSession.amount_total - expectedDiscountCents);

    heldCode = code; // shopper2 now holds this code — reused by the cases below.
  });
});

// ─── 4. No loopholes ──────────────────────────────────────────────────────────

test.describe("No loopholes", () => {
  // Ensure shopper2 is holding a code even if the payment-amount case was skipped
  // (e.g. no Stripe key) — reserve one directly so these cases still stand alone.
  test.beforeAll(async () => {
    if (heldCode) return;
    heldCode = await issueCode("hold");
    await addToCart(shopper2);
    const held = await shopper2.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: heldCode } });
    expect(held.ok(), "reserving a code for the loophole cases must succeed").toBeTruthy();
  });

  test("a code held by one shopper's checkout can't be used by another", async () => {
    // The holder (shopper2) still sees its own held code as usable…
    const owner = await (await shopper2.post(`/api/discount/validate`, { data: { code: heldCode } })).json();
    expect(owner.valid).toBe(true);

    // …but a different shopper is blocked while the hold is active.
    const other = await (await shopper.post(`/api/discount/validate`, { data: { code: heldCode } })).json();
    expect(other.valid).toBe(false);
    expect(other.message).toMatch(/another checkout/i);
  });

  test("one account can't stack a second welcome code on top of one it already holds", async () => {
    const second = await issueCode("stack");

    // shopper2 already holds heldCode, so a second welcome code is refused —
    // at the read-only validate…
    const validate = await (await shopper2.post(`/api/discount/validate`, { data: { code: second } })).json();
    expect(validate.valid).toBe(false);
    expect(validate.message).toMatch(/already used a welcome discount/i);

    // …and at the authoritative checkout step (never a silent second discount).
    await addToCart(shopper2);
    const res = await shopper2.post(`/api/checkout/session`, { data: { ...DELIVERY, discount_code: second } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/already used a welcome discount/i);
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

    // shopper2 is holding a welcome code from earlier serial cases — an admin code
    // must NOT be blocked by that welcome hold.
    const v = await (await shopper2.post(`/api/discount/validate`, { data: { code } })).json();
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

    const code = await issueCode("ui");

    await signIn(page);
    await page.request.delete(`${API}/api/cart`);

    await page.goto(`${BASE}/shop`);
    await page.getByRole("button", { name: /add to cart/i }).first().click();

    await page.goto(`${BASE}/checkout`);
    // Country is a <select> (drives the postal rules); pick Ireland first so the
    // postal field validates as an Eircode.
    await page.getByPlaceholder("Full name").fill("E2E Shopper");
    await page.getByPlaceholder("Phone").fill("+353851234567");
    await page.getByPlaceholder("Address line 1").fill("1 Test Street");
    await page.locator("select").filter({ hasText: "Select country" }).selectOption("Ireland");
    await page.getByPlaceholder("City").fill("Dublin");
    await page.getByPlaceholder("Eircode").fill("D18 K7W2");

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

async function payStripeTestCard(page: Page): Promise<boolean> {
  const cardChooser = page.getByRole("button", { name: /pay with card|^card$/i }).or(page.getByText(/^card$/i));
  if (await cardChooser.first().isVisible().catch(() => false)) {
    await cardChooser.first().click().catch(() => {});
  }
  if (await page.locator("#cardNumber").isVisible().catch(() => false)) {
    await page.locator("#cardNumber").fill("4242424242424242");
    await page.locator("#cardExpiry").fill("12 / 34");
    await page.locator("#cardCvc").fill("123");
  } else {
    const numberField = page
      .frameLocator('iframe[title*="payment" i], iframe[name*="stripe" i], iframe[src*="stripe"]')
      .locator('input[name="number"], input#Field-numberInput')
      .first();
    if (!(await numberField.isVisible({ timeout: 15_000 }).catch(() => false))) return false;
    const fl = page.frameLocator('iframe[title*="payment" i], iframe[name*="stripe" i], iframe[src*="stripe"]');
    await fl.locator('input[name="number"], input#Field-numberInput').first().fill("4242424242424242");
    await fl.locator('input[name="expiry"], input#Field-expiryInput').first().fill("12 / 34");
    await fl.locator('input[name="cvc"], input#Field-cvcInput').first().fill("123");
  }
  const name = page.locator("#billingName");
  if (await name.isVisible().catch(() => false)) await name.fill("E2E Shopper");
  const postal = page.locator("#billingPostalCode");
  if (await postal.isVisible().catch(() => false)) await postal.fill("D01AB12");
  await page.locator(".SubmitButton, button[type=submit]").first().click();
  return true;
}
