import { test, expect, type Page, type Request } from "@playwright/test";
import pg from "pg";
import { existsSync, readFileSync } from "fs";
import { payStripeTestCard } from "./stripe-checkout";
import { acceptCheckoutTerms, fillDeliveryAddress } from "./address-form";

// The money end of the Meta Pixel, watched rather than reasoned about.
//
// Two halves, and they fail in different ways:
//   - the BROWSER half is intercepted here, so nothing reaches Meta while the
//     shape of each hit is asserted on the wire;
//   - the SERVER half — the Purchase, written by the backend when Stripe
//     confirms payment — is intercepted inside the backend, so it never leaves
//     the machine either. That is the interesting one: it is the only event
//     nobody can produce by browsing, and the only one that carries money.
//
// Opt-in (the `__` prefix keeps it out of the standard run): it drives Stripe's
// own hosted page with a test card, which is inherently brittle and slow.

const BASE = process.env.E2E_BASE ?? "http://localhost:8081";

// THE PIXEL ID DOES NOT HAVE TO BE REAL for any of this to work, which is worth
// knowing before someone tries to make it real. fbevents.js sends to
// www.facebook.com/tr for any WELL-FORMED id, so the seeded placeholder
// (e2e/setup/seed.mjs) produces a complete funnel on the wire — asserted below —
// and this file aborts every one of those requests so nothing leaves the machine.
//
// A MALFORMED id is a different story: given one with a leading zero fbevents.js
// logs `Invalid PixelID: null`, never fetches the pixel's config and discards
// every queued call. Observed against the live library, and the reason
// PIXEL_ID_RE in src/lib/meta.ts refuses a leading zero.
//
// E2E_META_PIXEL_ID overrides the placeholder if you would rather watch these
// events arrive in a scratch pixel's Events Manager.

type Hit = { url: string; method: string; body: string | null };
const capture = async (page: Page) => {
  const hits: Hit[] = [];
  // ONLY the collection host. connect.facebook.net has to be left alone —
  // fbevents.js is what turns the queued calls into requests, so blocking the
  // script means blocking every hit and watching an empty list forever.
  //
  // THE BODY IS CAPTURED, NOT JUST THE URL, and that is not thoroughness — it is
  // the difference between this suite seeing the sale and not. See decode().
  await page.route("**://*.facebook.com/**", async (route, req: Request) => {
    hits.push({ url: req.url(), method: req.method(), body: req.postData() });
    await route.abort();
  });
  return hits;
};

/**
 * One hit, whichever way fbevents.js chose to send it.
 *
 * IT DOES NOT ALWAYS USE A GET, and this cost a full misdiagnosis. Small events
 * go out as a query string on an image beacon; a Purchase carrying a basket,
 * an order id and eleven matching fields is too long for a URL, so fbevents
 * switches to a POST and the parameters move into the body. A decoder that reads
 * only `new URL(...).searchParams` therefore sees the whole browsing funnel and
 * is BLIND TO THE SALE — which reads exactly like the sale not being sent, and
 * sent me looking for a race in the success page that does not exist.
 *
 * So both are read, and the shape of the event decides nothing about whether the
 * test can see it.
 */
const decode = (hits: Hit[]) =>
  hits
    .filter((h) => h.url.includes("/tr"))
    .map((h) => {
      const p: Record<string, string> = {};
      new URL(h.url).searchParams.forEach((v, k) => { p[k] = v; });
      if (h.body) new URLSearchParams(h.body).forEach((v, k) => { p[k] = v; });
      return { name: p.ev ?? "?", p };
    });

test("a real purchase: the browser's funnel, then the server's sale", async ({ page }) => {
  test.setTimeout(180_000);
  const hits = await capture(page);
  await page.addInitScript(() => {
    localStorage.setItem("og_cookie_consent", "accepted");
    localStorage.setItem("og_cookie_consent_at", String(Date.now()));
    localStorage.setItem("og_subscribe_popup_dismissed", "1");
  });

  await page.goto(BASE);
  await page.getByRole("button", { name: /account|sign in/i }).first().click();
  const signInBtn = page.getByRole("button", { name: /^sign in$/i }).first();
  if (await signInBtn.isVisible().catch(() => false)) await signInBtn.click();
  await page.getByPlaceholder("you@example.com").fill("e2e-shopper@test.local");
  await page.getByPlaceholder("Your password").fill("E2eShopper123");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByPlaceholder("Your password")).toBeHidden({ timeout: 15_000 });

  await page.goto(`${BASE}/shop`);
  await page.waitForTimeout(2000);
  await page.locator('a[href^="/products/"]').first().click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /add to (basket|cart)/i }).first().click();
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/basket`);
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /proceed to checkout/i }).first().click();
  await page.waitForURL(/\/checkout/, { timeout: 20_000 });
  await page.waitForTimeout(2500);

  await fillDeliveryAddress(page, "Meta Pixel Tester");
  await page.waitForTimeout(2500);

  await acceptCheckoutTerms(page);

  const placeOrder = page.getByRole("button", { name: /continue to secure payment/i }).first();
  await expect(placeOrder).toBeVisible({ timeout: 15_000 });
  await placeOrder.click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });

  const browserEvents = decode(hits);
  console.log("BROWSER EVENTS:", JSON.stringify(
    browserEvents.map((e) => ({
      ev: e.name,
      value: e.p["cd[value]"], currency: e.p["cd[currency]"],
      ids: e.p["cd[content_ids]"], num: e.p["cd[num_items]"],
      eid: e.p.eid ? "yes" : "MISSING",
      ext: e.p["ud[external_id]"] ? "hashed" : "MISSING",
      em: e.p["ud[em]"] ? "hashed" : "-",
    })), null, 2));

  const names = browserEvents.map((e) => e.name);
  for (const stage of ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo"]) {
    expect(names, `${stage} must reach Meta`).toContain(stage);
  }
  // Every event this file sends is identified and deduplicable.
  //
  // PageView is excluded from the event-id check, and that is a finding rather
  // than an exemption: fbevents.js sends its own PageView on every
  // history.pushState and suppresses ours for the same URL, so on in-app
  // navigations the hit that reaches Meta is theirs and carries no id. Nothing
  // depends on it — the server never sends a PageView, so there is no second
  // copy to deduplicate against — and the COUNT is still exactly one per page,
  // which is asserted below.
  for (const e of browserEvents) {
    if (e.name !== "PageView") {
      expect(e.p.eid, `${e.name} has no event id`).toBeTruthy();
    }
    expect(e.p["ud[external_id]"], `${e.name} has no external_id`).toMatch(/^[0-9a-f]{64}$/);
  }

  // One PageView per page, no more: a double-counted page view is the easiest
  // thing in the world to ship in a single-page app and the hardest to notice.
  const pageViewPaths = browserEvents
    .filter((e) => e.name === "PageView")
    .map((e) => new URL(e.p.dl).pathname);
  expect(new Set(pageViewPaths).size).toBe(pageViewPaths.length);

  // The signed-in shopper's identity reaches Meta hashed, never in clear.
  const identified = browserEvents.filter((e) => e.p["ud[em]"]);
  expect(identified.length, "advanced matching sent nothing for a signed-in shopper").toBeGreaterThan(0);
  for (const e of identified) {
    expect(e.p["ud[em]"]).toMatch(/^[0-9a-f]{64}$/);
    expect(new URL(e.p.dl).href).not.toContain("@");
  }
  // Nothing has been bought yet, so there is nothing to report. The Purchase is
  // asserted after the card is paid, where it belongs — and it is asserted twice
  // over, because the shop deliberately sends it from both ends.
  expect(names).not.toContain("Purchase");

  const paid = await payStripeTestCard(page).catch(() => false);
  console.log("STRIPE PAID:", paid);
  test.skip(!paid, "Stripe's hosted page could not be driven — the browser half is still asserted above");
  await page.waitForURL(/checkout\/success/, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(12_000); // let the poll/webhook finalize

  // ── The number that has to be right ─────────────────────────────────────────
  //
  // Everything above is a funnel. This is revenue, and it is the one figure that
  // gets read out loud. So it is not compared against our own database — which
  // is where a wrong number would have come from in the first place — but
  // against STRIPE, the only system that knows what was actually taken off the
  // card, in the integer cents Stripe settles in.
  //
  // It catches the whole class of quiet money bugs at once: a float-noise total
  // (25 + 4.99 is stored as 29.990000000000002), a currency mismatch, revenue
  // reported for a payment that never settled, and a value that silently drops
  // shipping or a discount.
  const order = await lastOrder();

  // ── Both halves of the sale, and the id that makes them one ─────────────────
  //
  // The purchase is reported twice on purpose: by the server the moment Stripe
  // confirms payment (which survives a shopper who closes the tab, and an ad
  // blocker), and by this browser when it lands back on the success page (which
  // survives an access token that has expired or been revoked — the failure with
  // nothing to announce it, because Meta is never asked and so never complains).
  //
  // What makes that two reports of one sale rather than double revenue is a
  // shared `event_id`. Meta deduplicates on event name + event id, and there is
  // no error for getting it wrong: Events Manager simply shows twice the money.
  // So the two strings are compared here, on the wire, against each other.
  const browserPurchases = decode(hits).filter((e) => e.name === "Purchase");
  console.log("BROWSER PURCHASE:", JSON.stringify(
    browserPurchases.map((e) => ({
      eid: e.p.eid, value: e.p["cd[value]"], currency: e.p["cd[currency]"],
      order: e.p["cd[order_id]"], num: e.p["cd[num_items]"],
    })), null, 2));

  expect(browserPurchases, "the browser sent no Purchase from the success page").toHaveLength(1);
  expect(browserPurchases[0].p.eid).toBe(`order-${order.id}`);
  expect(browserPurchases[0].p["cd[currency]"]).toBe("EUR");

  const captured = readSinkPurchases();
  test.skip(captured === null, "no Conversions API sink attached — run this through the sink to reconcile revenue");
  const event = captured!.find((e) => e.custom_data?.order_id === order.id);
  expect(event, `no Purchase was reported to Meta for order ${order.id}`).toBeTruthy();

  const session = await stripeSession(order.stripe_session_id);
  test.skip(!session, "no Stripe key available to reconcile against");

  const metaCents = Math.round(event!.custom_data.value * 100);
  console.log(`REVENUE: Meta ${event!.custom_data.value} (${metaCents}c) vs Stripe ${session!.amount_total}c ${session!.currency}`);
  expect(session!.payment_status, "reported a purchase for a payment Stripe had not settled").toBe("paid");
  expect(metaCents, "the revenue reported to Meta is not the money Stripe took").toBe(session!.amount_total);
  expect(String(event!.custom_data.currency).toLowerCase()).toBe(session!.currency);
  // And the value carries no float noise, so it reads as money in Meta's reports.
  expect(String(event!.custom_data.value)).toMatch(/^\d+(\.\d{1,2})?$/);

  // Exactly one Purchase per order. The Stripe webhook and the success-page poll
  // both finalize; two reports would double this shop's revenue in Events
  // Manager, and Meta would optimise towards a number that never existed.
  const forThisOrder = captured!.filter(
    (e) => e.event_name === "Purchase" && e.custom_data?.order_id === order.id
  );
  expect(forThisOrder).toHaveLength(1);
  expect(event!.event_id).toBe(`order-${order.id}`);
  // THE ONE COMPARISON THIS FILE EXISTS FOR: the two copies of the sale carry the
  // same id, so Meta counts them once. Different ids here means this shop's
  // reported revenue is exactly double what it took.
  expect(browserPurchases[0].p.eid).toBe(event!.event_id);
  // …and the same money, so whichever copy Meta keeps reports the same figure.
  expect(Math.round(Number(browserPurchases[0].p["cd[value]"]) * 100)).toBe(session!.amount_total);
});

// ── Reconciliation helpers ────────────────────────────────────────────────────

type SinkEvent = { event_name: string; event_id: string; custom_data: Record<string, never> & { order_id?: string; value: number; currency: string } };

/** Every Conversions API call the backend made, if it was started behind the sink. */
function readSinkPurchases(): SinkEvent[] | null {
  const file = process.env.META_SINK_FILE;
  if (!file || !existsSync(file)) return null;
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => JSON.parse(line).body?.data ?? []);
}

async function lastOrder(): Promise<{ id: string; total: string; stripe_session_id: string }> {
  const pool = new pg.Pool({
    connectionString: process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/olive_test",
  });
  try {
    const { rows } = await pool.query(
      "SELECT id, total, stripe_session_id FROM orders WHERE stripe_session_id IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    );
    return rows[0];
  } finally {
    await pool.end();
  }
}

async function stripeSession(id: string) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !id) return null;
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as { amount_total: number; currency: string; payment_status: string };
}

/**
 * The gate, from the other side.
 *
 * A shopper who declines cookies must reach Meta in no form at all — not from
 * the browser (no pixel loads) and, the part that is easy to get wrong, not from
 * the SERVER either. The Conversions API doesn't need a browser to be there, so
 * nothing about a server-written purchase stops on its own; the only thing that
 * stops it is the permission the browser recorded at checkout.
 *
 * Asserted at the pending checkout rather than by paying: the flag is what
 * reportPurchaseToMeta reads, and it is written the moment the Stripe session is
 * created — so this proves the gate without spending a second trip through
 * Stripe's hosted page.
 */
test("a shopper who declines cookies is not forwarded to Meta at all", async ({ page }) => {
  test.setTimeout(120_000);
  const hits = await capture(page);
  await page.addInitScript(() => {
    localStorage.setItem("og_cookie_consent", "declined");
    localStorage.setItem("og_cookie_consent_at", String(Date.now()));
    localStorage.setItem("og_subscribe_popup_dismissed", "1");
  });

  await page.goto(BASE);
  await page.getByRole("button", { name: /account|sign in/i }).first().click();
  const signInBtn = page.getByRole("button", { name: /^sign in$/i }).first();
  if (await signInBtn.isVisible().catch(() => false)) await signInBtn.click();
  await page.getByPlaceholder("you@example.com").fill("e2e-shopper@test.local");
  await page.getByPlaceholder("Your password").fill("E2eShopper123");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByPlaceholder("Your password")).toBeHidden({ timeout: 15_000 });

  await page.goto(`${BASE}/shop`);
  await page.waitForTimeout(2000);
  await page.locator('a[href^="/products/"]').first().click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /add to (basket|cart)/i }).first().click();
  await page.waitForTimeout(1500);

  // Not one byte, and not even the script: fbevents.js is never fetched.
  expect(hits, "something reached Meta for a visitor who declined").toEqual([]);
  expect(await page.evaluate(() => typeof (window as unknown as { fbq?: unknown }).fbq)).toBe("undefined");
  expect(await page.evaluate(() => !!document.getElementById("meta-pixel"))).toBe(false);

  await page.goto(`${BASE}/basket`);
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /proceed to checkout/i }).first().click();
  await page.waitForURL(/\/checkout/, { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await fillDeliveryAddress(page, "No Consent Tester");
  await page.waitForTimeout(2500);
  await acceptCheckoutTerms(page);

  const placeOrder = page.getByRole("button", { name: /continue to secure payment/i }).first();
  await expect(placeOrder).toBeVisible({ timeout: 15_000 });
  await placeOrder.click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });

  // The permission the server reads before it reports anything, read out of the
  // checkout it was actually stored on. Absent — so had this order been paid
  // for, the sale would have reached our own tables and Meta would have heard
  // nothing about it, which is the correct outcome and the one that is
  // impossible to verify from the browser, because the browser is not there.
  const pool = new pg.Pool({
    connectionString: process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/olive_test",
  });
  try {
    const { rows } = await pool.query(
      "SELECT payload->'analytics' AS analytics FROM pending_checkouts ORDER BY created_at DESC LIMIT 1"
    );
    expect(rows[0]?.analytics?.visitor_id, "no checkout was stored to inspect").toBeTruthy();
    expect(rows[0].analytics.meta_consent).toBeUndefined();
    expect(rows[0].analytics.fbp ?? null).toBeNull();
    expect(rows[0].analytics.fbc ?? null).toBeNull();
  } finally {
    await pool.end();
  }
});
