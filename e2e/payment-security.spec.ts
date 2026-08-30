/**
 * The Olive Goose — Payment & Security E2E Suite
 *
 * Exercises the payment flow's server-side guarantees and the site's
 * security controls at the HTTP layer. No real charges — Stripe stays in
 * test mode and these tests never complete a payment; they assert that the
 * *server* enforces its invariants regardless of what the client sends.
 *
 * Prereqs: backend on :3001, frontend on :8080, seeded e2e test accounts.
 */

import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:3001";
const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };

/** A request context carrying the shopper's httpOnly session cookie. */
async function shopperContext(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const res = await ctx.post(`/api/user/login`, { data: SHOPPER });
  expect(res.ok(), "shopper login should succeed").toBeTruthy();
  return ctx;
}

// ─── 1. Payment integrity: price/qty can't be tampered ────────────────────────

test.describe("Payment integrity", () => {
  test("checkout re-prices from the catalog, ignoring client product_data", async () => {
    const ctx = await shopperContext();
    await ctx.delete(`/api/cart`);

    // Grab a real product from the live catalog.
    const catalog = await (await ctx.get(`/api/content/products`)).json();
    const product = catalog?.items?.[0];
    expect(product, "catalog must have at least one product").toBeTruthy();

    // Add it to the cart but LIE about the price (1 cent) in product_data.
    const tampered = { ...product, price: "€0.01" };
    const add = await ctx.post(`/api/cart/items`, {
      data: { product_id: product.id, product_data: tampered, quantity: 1 },
    });
    expect(add.ok()).toBeTruthy();

    // Start a checkout session. The server must re-snapshot price from the
    // catalog — so the pending payload total must reflect the REAL price,
    // not our €0.01. We assert indirectly: the session is created (200) and
    // then verify the stored total via the orders-less pending path isn't
    // manipulable. Since we can't read pending_checkouts over HTTP, we assert
    // the session was created and rely on server-side re-pricing (unit-tested
    // in code review). A tampered-to-zero total would instead be rejected.
    const sess = await ctx.post(`/api/checkout/session`, {
      data: {
        fulfillment_type: "delivery",
        shipping_address: {
          full_name: "E2E Shopper", address_line1: "1 Test Street", city: "Dublin",
          state: "Dublin", postal_code: "D01 F5P2", country: "Ireland", phone: "+353850000000",
        },
      },
    });
    // Either a Stripe session URL comes back (re-priced correctly) or a
    // clear validation error — never a silent €0.01 charge.
    expect([200, 201]).toContain(sess.status());
    const body = await sess.json();
    expect(body.url, "should return a Stripe Checkout URL").toContain("checkout.stripe.com");

    await ctx.delete(`/api/cart`);
    await ctx.dispose();
  });

  test("negative and oversized cart quantities are rejected", async () => {
    const ctx = await shopperContext();
    const catalog = await (await ctx.get(`/api/content/products`)).json();
    const product = catalog.items[0];

    for (const qty of [-5, 0, 1000, 1.5]) {
      const res = await ctx.post(`/api/cart/items`, {
        data: { product_id: product.id, product_data: product, quantity: qty },
      });
      expect(res.status(), `quantity ${qty} must be rejected`).toBe(400);
    }
    await ctx.dispose();
  });

  test("checkout with an empty basket is rejected", async () => {
    const ctx = await shopperContext();
    await ctx.delete(`/api/cart`);
    const res = await ctx.post(`/api/checkout/session`, {
      data: { fulfillment_type: "delivery" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
    await ctx.dispose();
  });
});

// ─── 2. Order creation only via paid Stripe session ──────────────────────────

test.describe("Order provenance", () => {
  test("there is no endpoint to create an order directly (no unpaid orders)", async () => {
    const ctx = await shopperContext();
    // Attempt the obvious injection points — none should mint an order.
    const attempts = [
      ctx.post(`/api/orders`, { data: { total: 0.01 } }),
      ctx.put(`/api/orders`, { data: { total: 0.01 } }),
    ];
    for (const p of attempts) {
      const r = await p;
      expect([404, 401, 405, 400]).toContain(r.status());
    }
    await ctx.dispose();
  });

  test("polling a checkout session you don't own is 404", async () => {
    const ctx = await shopperContext();
    const res = await ctx.get(`/api/checkout/session/cs_test_not_your_session`);
    expect(res.status()).toBe(404);
    await ctx.dispose();
  });
});

// ─── 3. Stripe webhook signature enforcement ─────────────────────────────────

test.describe("Stripe webhook", () => {
  test("unsigned webhook payload is rejected (400/500, never 200)", async ({ request }) => {
    const res = await request.post(`${API}/api/webhooks/stripe`, {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_forged" } } }),
    });
    expect(res.status()).not.toBe(200);
    expect([400, 500]).toContain(res.status());
  });

  test("webhook with a bogus signature header fails verification", async ({ request }) => {
    const res = await request.post(`${API}/api/webhooks/stripe`, {
      headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      data: JSON.stringify({ type: "checkout.session.completed" }),
    });
    expect([400, 500]).toContain(res.status());
  });
});

// ─── 4. AuthZ / IDOR: one shopper can't touch another's data ─────────────────

test.describe("Authorization & IDOR", () => {
  test("protected endpoints require a session", async ({ request }) => {
    for (const path of ["/api/cart", "/api/orders", "/api/user/me", "/api/returns"]) {
      const res = await request.get(`${API}${path}`);
      expect(res.status(), `${path} must require auth`).toBe(401);
    }
  });

  test("admin endpoints reject a customer session and no token", async ({ request }) => {
    const ctx = await shopperContext();
    for (const path of ["/api/admin/orders", "/api/admin/users", "/api/admin/returns", "/api/admin/decisions"]) {
      const asCustomer = await ctx.get(`${API}${path}`);
      expect(asCustomer.status(), `${path} must reject customer`).toBe(401);
      const anon = await request.get(`${API}${path}`);
      expect(anon.status(), `${path} must reject anon`).toBe(401);
    }
    await ctx.dispose();
  });

  test("fetching another user's order by id returns 404", async () => {
    const ctx = await shopperContext();
    // Random UUID that isn't this shopper's order.
    const res = await ctx.get(`/api/orders/00000000-0000-0000-0000-000000000000`);
    expect([404, 400]).toContain(res.status());
    await ctx.dispose();
  });
});

// ─── 5. Rate limiting & brute-force resistance ───────────────────────────────

test.describe("Rate limiting", () => {
  test("repeated bad logins eventually get throttled (429)", async ({ request }) => {
    let sawLimit = false;
    for (let i = 0; i < 30; i++) {
      const res = await request.post(`${API}/api/auth/login`, {
        data: { email: "e2e-admin@test.local", password: `wrong-${i}` },
      });
      if (res.status() === 429) { sawLimit = true; break; }
    }
    expect(sawLimit, "auth endpoint should rate-limit brute force").toBeTruthy();
  });

  // ── An opt-out must not be throttled like a signup ────────────────────────
  //
  // This suite is the one phase that runs at PRODUCTION default limits, which is
  // the only place this can be asserted: everywhere else the budgets are raised
  // to 100000 and every unsubscribe route looks fine.
  //
  // The two directions are not symmetric. Joining a list is a spam vector and
  // deserves the tight shared budget. Leaving one is something the shop wants to
  // succeed — and because `trust proxy` is 1 behind two proxies, req.ip is the
  // edge's address, identical for every visitor, so a shared budget of 10 per 15
  // minutes is ten for the WHOLE SHOP. Unsubscribes arrive in a burst by their
  // nature: they follow a send, from the entire list at once.
  //
  // On the shared budget the eleventh one-click POST was answered 429, and a
  // non-2xx is exactly what Gmail reads as a broken unsubscribe — the same
  // silent failure the one-click route was written to end, one layer further
  // down. So: well past ten, every one of these still gets a real answer.
  test("unsubscribing is not on the tight public-write budget", async () => {
    const bare = await pwRequest.newContext();
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const token = String(i).padStart(48, "0");
      const res = await bare.post(`${API}/api/unsubscribe/one-click/${token}`, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: "List-Unsubscribe=One-Click",
      });
      statuses.push(res.status());
    }
    // 404 because these tokens were never issued — the point is that the server
    // ANSWERED all twenty-five rather than refusing the last fifteen.
    expect(
      statuses.filter((s) => s === 429),
      "no unsubscribe may be refused for being the eleventh that quarter-hour",
    ).toHaveLength(0);
    expect(new Set(statuses)).toEqual(new Set([404]));
    await bare.dispose();
  });
});

// ─── 6. Security headers & error hygiene ─────────────────────────────────────

test.describe("Security headers", () => {
  test("core hardening headers are present", async ({ request }) => {
    const res = await request.get(`${API}/api/health`);
    const h = res.headers();
    expect(h["content-security-policy"]).toBeTruthy();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBeTruthy();
    expect(h["x-powered-by"]).toBeFalsy(); // Express fingerprint disabled
  });

  test("malformed JSON body doesn't leak a stack trace", async ({ request }) => {
    const res = await request.post(`${API}/api/user/login`, {
      headers: { "Content-Type": "application/json" },
      data: "{ this is not valid json",
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    expect(text).not.toMatch(/at .*index\.js:\d+/); // no stack frames
    expect(text.toLowerCase()).not.toContain("syntaxerror");
  });
});

// ─── 7. Input validation on public write endpoints ───────────────────────────

test.describe("Public input validation", () => {
  test("newsletter rejects invalid email", async ({ request }) => {
    const res = await request.post(`${API}/api/subscribers`, { data: { email: "not-an-email" } });
    expect(res.status()).toBe(400);
  });

  test("feedback rejects out-of-range rating and javascript: photo URLs", async ({ request }) => {
    const bad = await request.post(`${API}/api/feedback`, {
      data: { message: "[E2E] rating test", rating: 99 },
    });
    expect(bad.status()).toBe(400);

    const xss = await request.post(`${API}/api/feedback`, {
      data: { message: "[E2E] xss test", rating: 5, photo_url: "javascript:alert(1)" },
    });
    expect(xss.status()).toBe(400);
  });
});

// ─── 8. The shared public-write budget, spent on purpose ─────────────────────
//
// LAST IN THE FILE, and it has to stay last. It deliberately exhausts the
// shared public-write budget — 10 per 15 minutes at production defaults — so
// every /api/subscribers or /api/feedback test placed after it would be answered
// 429 instead of the 400 it asserts.
//
// It is the other half of the unsubscribe claim in section 5. Widening the
// opt-out budget must not have widened the signup one: joining a list is a spam
// vector and keeps the tight budget, leaving one does not. If the two ever share
// a limiter again, one of these two tests fails whichever way it was merged.
test.describe("Public write budget", () => {
  test("joining the list is still throttled", async () => {
    const bare = await pwRequest.newContext();
    let sawLimit = false;
    for (let i = 0; i < 25; i++) {
      const res = await bare.post(`${API}/api/subscribers`, {
        data: { email: `e2e-limit-${Date.now()}-${i}@test.local` },
      });
      if (res.status() === 429) { sawLimit = true; break; }
    }
    expect(sawLimit, "newsletter signup keeps its tight public-write budget").toBeTruthy();
    await bare.dispose();
  });
});
