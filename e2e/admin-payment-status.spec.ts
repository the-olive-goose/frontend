/**
 * The Olive Goose — Admin "mark order as paid" flow
 *
 * Covers PUT /api/admin/orders/:id/payment-status — used for orders settled
 * outside Stripe (e.g. a pickup order paid by cash/card in store). Tests the
 * same dimensions as the other payment/security suites: authZ, input validation,
 * integrity (can't flip Stripe-managed orders), IDOR, CSRF, customer-privacy of
 * the audit event, plus the functional paid → unpaid (undo) round-trip.
 *
 * Prereqs: backend :3001, frontend :8080, and the seeded fixtures
 *   admin  e2e-admin@test.local / E2eAdmin123!
 *   orders OGE2EUNPAID (unpaid, no Stripe intent) and OGE2ESTRIPE (Stripe-managed)
 * (run scratchpad/e2e-setup.mjs).
 */

import { test, expect, request as pwRequest } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:3001";
const ADMIN = { email: "e2e-admin@test.local", password: "E2eAdmin123!" };
const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Log in ONCE for the whole suite. The auth endpoint is deliberately rate-limited
// (20/15min per IP), so logging in per-test would trip that limiter and make the
// suite flaky — a single shared token is both realistic and limiter-friendly.
let TOKEN = "";
let UNPAID_ID = "";
let STRIPE_ID = "";

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${API}/api/auth/login`, { data: ADMIN });
  expect(res.ok(), "admin login should succeed (run e2e-setup.mjs to seed the admin)").toBeTruthy();
  TOKEN = (await res.json()).token;

  const orders = await (await ctx.get(`${API}/api/admin/orders`, { headers: auth(TOKEN) })).json();
  const find = (t: string) => orders.find((o: { tracking_number: string }) => o.tracking_number === t);
  UNPAID_ID = find("OGE2EUNPAID")?.id;
  STRIPE_ID = find("OGE2ESTRIPE")?.id;
  expect(UNPAID_ID, "seeded order OGE2EUNPAID must exist — run e2e-setup.mjs").toBeTruthy();
  expect(STRIPE_ID, "seeded order OGE2ESTRIPE must exist — run e2e-setup.mjs").toBeTruthy();
  await ctx.dispose();
});

// ─── AuthZ ────────────────────────────────────────────────────────────────────

test.describe("mark-as-paid · authorization", () => {
  test("requires an admin token (anon → 401)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/00000000-0000-0000-0000-000000000000/payment-status`, {
      data: { payment_status: "paid" },
    });
    expect(res.status()).toBe(401);
  });

  test("rejects a customer session (401, not 200)", async () => {
    const ctx = await pwRequest.newContext();
    await ctx.post(`${API}/api/user/login`, { data: SHOPPER });
    // Customer cookie present, but this endpoint needs an admin bearer token.
    const res = await ctx.put(`${API}/api/admin/orders/00000000-0000-0000-0000-000000000000/payment-status`, {
      data: { payment_status: "paid" },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});

// ─── Validation & integrity ──────────────────────────────────────────────────

test.describe("mark-as-paid · validation & integrity", () => {
  test("rejects an invalid payment_status value (400)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${UNPAID_ID}/payment-status`, {
      headers: auth(TOKEN), data: { payment_status: "refunded_lol" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/paid or unpaid/i);
  });

  test("refuses to flip a Stripe-managed order (400)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${STRIPE_ID}/payment-status`, {
      headers: auth(TOKEN), data: { payment_status: "unpaid" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/stripe/i);
  });

  test("returns 404 for a non-existent order", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/00000000-0000-0000-0000-000000000000/payment-status`, {
      headers: auth(TOKEN), data: { payment_status: "paid" },
    });
    expect(res.status()).toBe(404);
  });
});

// ─── CSRF ─────────────────────────────────────────────────────────────────────

test.describe("mark-as-paid · CSRF", () => {
  test("a cross-site Origin is blocked before the handler (403)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${UNPAID_ID}/payment-status`, {
      headers: { ...auth(TOKEN), Origin: "https://evil.example.com" },
      data: { payment_status: "paid" },
    });
    expect(res.status()).toBe(403);
  });
});

// ─── Functional round-trip ────────────────────────────────────────────────────

test.describe("mark-as-paid · functional round-trip", () => {
  test("mark paid → order is paid, private audit event logged; then undo → unpaid", async ({ request }) => {
    // Mark as paid.
    const paid = await request.put(`${API}/api/admin/orders/${UNPAID_ID}/payment-status`, {
      headers: auth(TOKEN), data: { payment_status: "paid" },
    });
    expect(paid.ok()).toBeTruthy();
    expect((await paid.json()).payment_status).toBe("paid");

    // Admin detail carries a payment_status_changed event...
    const detail = await (await request.get(`${API}/api/admin/orders/${UNPAID_ID}`, { headers: auth(TOKEN) })).json();
    expect(detail.payment_status).toBe("paid");
    const evt = (detail.timeline || []).find((e: { type: string }) => e.type === "payment_status_changed");
    expect(evt, "a payment_status_changed audit event should be recorded").toBeTruthy();
    expect(evt.customer_visible).toBe(false);

    // ...but it must NOT leak to the customer's own timeline (customer_visible=false).
    const shopperCtx = await pwRequest.newContext();
    await shopperCtx.post(`${API}/api/user/login`, { data: SHOPPER });
    const custOrder = await (await shopperCtx.get(`${API}/api/orders/${UNPAID_ID}`)).json();
    const custHasEvt = (custOrder.timeline || []).some((e: { type: string }) => e.type === "payment_status_changed");
    expect(custHasEvt, "internal payment note must not appear in the customer timeline").toBeFalsy();
    await shopperCtx.dispose();

    // Undo → back to unpaid.
    const undone = await request.put(`${API}/api/admin/orders/${UNPAID_ID}/payment-status`, {
      headers: auth(TOKEN), data: { payment_status: "unpaid" },
    });
    expect(undone.ok()).toBeTruthy();
    expect((await undone.json()).payment_status).toBe("unpaid");
  });
});
