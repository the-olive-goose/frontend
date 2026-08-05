/**
 * The Olive Goose — Offer Copy Consistency Suite
 *
 * Marketing copy that quotes an offer must agree with the setting that offer is
 * actually charged from. Nothing used to check this, and production drifted twice:
 *
 *   - the announcement bar promised "Free shipping on orders over €50" while the
 *     configured threshold was 0 (everything shipped free), and the shipping
 *     policy page simultaneously claimed €65;
 *   - the bar promised "10% off your first order" while the signup popup was
 *     configured to issue 5% — customers were shortchanged by half.
 *
 * The storefront now renders these figures from tokens resolved against the live
 * settings (src/lib/offerTokens.ts). This suite drives the settings through the
 * admin API and asserts the rendered copy follows — including the threshold-of-0
 * case, which needs different WORDS ("on all orders"), not a different number.
 *
 * Every case writes the copy it asserts on. The isolated stack seeds content from
 * a real database, where these strings may still hold literal figures rather than
 * tokens, so a test that assumed tokenised copy was already stored would be
 * asserting against whatever the seed happened to contain.
 */
import { test, expect, APIRequestContext, request as pwRequest, Page } from "@playwright/test";

const API  = process.env.E2E_API  ?? "http://localhost:3001";
const BASE = process.env.E2E_BASE ?? "http://localhost:8080";
const ADMIN = {
  email:    process.env.E2E_ADMIN_EMAIL    ?? "e2e-admin@test.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin123!",
};
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let admin: APIRequestContext;
let TOKEN: string;
let originalPickup:   Record<string, unknown> = {};
let originalPopup:    Record<string, unknown> = {};
let originalBar:      Record<string, unknown> = {};
let originalShipping: Record<string, unknown> = {};
let originalProductPage: Record<string, unknown> = {};
let originalReturnPolicy: Record<string, unknown> = {};

async function put(section: string, data: unknown) {
  const res = await admin.put(`/api/content/${section}`, { headers: auth(TOKEN), data });
  expect(res.ok(), `saving ${section} must succeed`).toBeTruthy();
}

/** Point the two settings that own the figures quoted in copy. */
async function setOffer(threshold: number, discountPercent: number) {
  await put("pickupSettings", {
    ...originalPickup, free_shipping_threshold: threshold, flat_shipping_rate: 4.99,
  });
  await put("subscribePopup", { ...originalPopup, discount_percent: discountPercent });
}

/**
 * Put exactly ONE message in the announcement bar.
 *
 * The bar renders only the message it is currently showing — the others are not in
 * the DOM — so a suite that asserted on a multi-message bar would be racing the
 * rotation. One message removes the timing question entirely.
 */
async function setBarMessage(message: string) {
  await put("announcementBar", { ...originalBar, messages: [message], interval_ms: 100000 });
}

/** Text of the announcement bar itself, scoped so page copy can't satisfy it. */
async function barText(page: Page): Promise<string> {
  await page.goto(BASE);
  const bar = page.getByTestId("announcement-bar");
  await expect(bar).toBeVisible({ timeout: 15_000 });
  // The copy arrives with the settings fetch, a tick after first paint.
  await expect(bar).not.toBeEmpty({ timeout: 15_000 });
  return (await bar.innerText()).replace(/\s+/g, " ").trim();
}

test.beforeAll(async () => {
  admin = await pwRequest.newContext({ baseURL: API });
  const login = await admin.post(`/api/auth/login`, { data: ADMIN });
  expect(login.ok(), "admin login must succeed (seed the isolated stack first)").toBeTruthy();
  TOKEN = (await login.json()).token;

  originalPickup   = (await (await admin.get(`/api/content/pickupSettings`)).json())  ?? {};
  originalPopup    = (await (await admin.get(`/api/content/subscribePopup`)).json())  ?? {};
  originalBar      = (await (await admin.get(`/api/content/announcementBar`)).json()) ?? {};
  originalShipping = (await (await admin.get(`/api/content/shippingPolicy`)).json())  ?? {};
  originalProductPage = (await (await admin.get(`/api/content/productPage`)).json())  ?? {};
  originalReturnPolicy = (await (await admin.get(`/api/content/returnPolicy`)).json()) ?? {};
});

test.afterAll(async () => {
  if (!admin) return;
  // Restore every section this suite rewrote — later specs read this content.
  if (Object.keys(originalBar).length)      await put("announcementBar", originalBar);
  if (Object.keys(originalPickup).length)   await put("pickupSettings", originalPickup);
  if (Object.keys(originalPopup).length)    await put("subscribePopup", originalPopup);
  if (Object.keys(originalShipping).length) await put("shippingPolicy", originalShipping);
  if (Object.keys(originalProductPage).length) await put("productPage", originalProductPage);
  if (Object.keys(originalReturnPolicy).length) await put("returnPolicy", originalReturnPolicy);
  await admin.dispose();
});

test.describe("Announcement bar follows the configured offer", () => {
  test("quotes the configured free-shipping threshold, not a hardcoded figure", async ({ page }) => {
    await setOffer(50, 10);
    await setBarMessage("✨ Free shipping {free_shipping}");

    const text = await barText(page);
    expect(text).toMatch(/free shipping on orders over €50/i);
    // No stale figure survives, and no raw token leaks to the customer.
    expect(text).not.toMatch(/€65|\{free_shipping/);
  });

  test("a changed threshold changes the copy on the very next load", async ({ page }) => {
    await setOffer(75, 10);
    await setBarMessage("✨ Free shipping {free_shipping}");

    const text = await barText(page);
    expect(text).toMatch(/free shipping on orders over €75/i);
    expect(text).not.toMatch(/€50/);
  });

  test("{free_shipping_threshold} renders just the amount", async ({ page }) => {
    await setOffer(75, 10);
    await setBarMessage("Spend {free_shipping_threshold} to ship free");

    expect(await barText(page)).toMatch(/spend €75 to ship free/i);
  });

  // The regression that shortchanged customers by half.
  test("quotes the discount the signup code actually carries", async ({ page }) => {
    await setOffer(50, 5);
    await setBarMessage("💌 Sign up & {discount}% off your first order");

    const text = await barText(page);
    expect(text).toMatch(/5% off your first order/i);
    expect(text, "the bar must not promise a percent the code doesn't carry")
      .not.toMatch(/10% off/i);
  });

  // "on orders over €0" is technically true and reads as broken.
  test("a threshold of 0 says 'on all orders', not 'over €0'", async ({ page }) => {
    await setOffer(0, 5);
    await setBarMessage("✨ Free shipping {free_shipping}");

    const text = await barText(page);
    expect(text).toMatch(/free shipping on all orders/i);
    expect(text).not.toMatch(/over €0/i);
  });
});

// The lines under the buy button are the last thing read before adding to the
// basket — the most expensive place on the site for a stale shipping figure.
test.describe("Product page assurances follow the same settings", () => {
  const assurancesWith = (shipping: string) => ({
    ...originalProductPage,
    assurances: {
      enabled: true,
      shipping_text: shipping,
      shipping_detail: "no surprise fees at checkout",
      delivery_text: "Delivered in 3–7 business days",
      delivery_detail: "packed in Dublin the day it's ready",
      returns_text: "returns within {returns_window}, no drama",
      returns_detail: "",
    },
  });

  /** Open the first product in the shop and return its buy-box copy. */
  async function buyBoxText(page: Page): Promise<string> {
    await page.goto(`${BASE}/shop`);
    const card = page.locator("a[href^='/products/']").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    const line = page.getByText(/business days/i).first();
    await expect(line).toBeVisible({ timeout: 15_000 });
    return (await page.locator("body").innerText()).replace(/\s+/g, " ");
  }

  test("quotes the live flat rate and free-shipping bar", async ({ page }) => {
    await setOffer(75, 5);
    await setBarMessage("🕯️ New collection dropping soon");
    await put("productPage", assurancesWith("{shipping_cost}"));

    const body = await buyBoxText(page);
    expect(body).toMatch(/€4\.99 shipping — free on orders over €75/i);
    expect(body).toMatch(/Delivered in 3–7 business days/i);
    expect(body).not.toMatch(/\{shipping_cost/);
  });

  // The mismatch a shop owner hit: the returns window was changed on the policy
  // page and the buy button carried on promising the old one.
  test("the returns line follows the window set on the Return Policy page", async ({ page }) => {
    await setOffer(75, 5);
    await setBarMessage("🕯️ New collection dropping soon");
    await put("productPage", assurancesWith("{shipping_cost}"));
    await put("returnPolicy", { ...originalReturnPolicy, window_days: 14 });

    const body = await buyBoxText(page);
    expect(body).toMatch(/returns within 14 days/i);
    expect(body, "the old window must not survive anywhere on the page")
      .not.toMatch(/30 days|\{returns_window/);

    // …and the policy page itself quotes the same number.
    await page.goto(`${BASE}/returns`);
    const policy = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(policy).toMatch(/within 14 days of delivery/i);
  });

  test("says everything ships free when the threshold is 0", async ({ page }) => {
    await setOffer(0, 5);
    await setBarMessage("🕯️ New collection dropping soon");
    await put("productPage", assurancesWith("{shipping_cost}"));

    const body = await buyBoxText(page);
    expect(body).toMatch(/free shipping on all orders/i);
    expect(body, "a shop that charges nothing must not quote a rate")
      .not.toMatch(/€4\.99 shipping/i);
  });

  // A row with a second line opens on tap; one without stays plain text rather
  // than becoming a control that does nothing.
  test("a row's detail opens on tap, and a detail-less row is not a button", async ({ page }) => {
    await setOffer(75, 5);
    await setBarMessage("🕯️ New collection dropping soon");
    await put("productPage", assurancesWith("{shipping_cost}"));
    await buyBoxText(page);

    await expect(page.getByText(/packed in Dublin the day it's ready/i)).toBeHidden();

    const delivery = page.getByRole("button", { name: /Delivered in 3–7 business days/i });
    await delivery.click();
    await expect(page.getByText(/packed in Dublin the day it's ready/i)).toBeVisible();
    await expect(delivery).toHaveAttribute("aria-expanded", "true");

    await expect(page.getByRole("button", { name: /Easy 30-day returns/i })).toHaveCount(0);
  });
});

test.describe("Policy pages follow the same settings", () => {
  const policyWith = (body: string) => ({
    ...originalShipping,
    heading: "Shipping Policy",
    intro: "How we get your candles from our studio to your door.",
    sections: [{ title: "Delivery times & rates", body }],
    contact_email: "hello@theolivegoose.com",
  });

  /** Text of the policy card, excluding the announcement bar above it. */
  async function policyText(page: Page): Promise<string> {
    await page.goto(`${BASE}/shipping-policy`);
    const section = page.getByText(/Delivery times & rates/i).first();
    await expect(section).toBeVisible({ timeout: 15_000 });
    const body = (await page.locator("main, body").first().innerText()).replace(/\s+/g, " ");
    // Strip the bar so an assertion can't be satisfied by the banner's own copy.
    return body.replace(/✨[^\n]*?(?=Hello|Home|Shop)/g, " ");
  }

  test("the shipping policy quotes the live threshold", async ({ page }) => {
    await setOffer(75, 5);
    await setBarMessage("🕯️ New collection dropping soon");
    await put("shippingPolicy", policyWith("Shipping is free {free_shipping}."));

    const body = await policyText(page);
    expect(body).toMatch(/shipping is free on orders over €75/i);
    expect(body).not.toMatch(/\{free_shipping/);
  });

  test("and switches to the everything-ships-free wording at 0", async ({ page }) => {
    await setOffer(0, 5);
    await setBarMessage("🕯️ New collection dropping soon");
    await put("shippingPolicy", policyWith("Shipping is free {free_shipping}."));

    const body = await policyText(page);
    expect(body).toMatch(/shipping is free on all orders/i);
    expect(body).not.toMatch(/over €0/i);
  });
});
