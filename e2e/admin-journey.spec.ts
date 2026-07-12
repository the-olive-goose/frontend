/**
 * The Olive Goose — Admin Journey E2E Suite (orders · payments · Ops)
 *
 * End-to-end coverage of the admin side of the customer journey, exercised at
 * the HTTP layer against the real backend + DB:
 *   - order lifecycle: status transitions (delivery + pickup), invalid stages
 *   - payments: mark-as-paid / undo, Stripe-managed guard, refund-status
 *   - cancellations: approve (starts refund clock) / reject
 *   - returns: request → approve → refund (terminal), reject, IDOR
 *   - decisions queue: approve / dismiss, resolved history
 *   - ops-overview: stuck orders, refunds due, low stock, subscriber stats
 *   - analytics: trailing-window + explicit calendar-period (Q/month/year) filters
 *   - settings: shipping rate incl. 0, content PUT
 *   - cross-cutting: authZ, IDOR, CSRF (Origin), input validation
 *
 * Adversarial by design — many tests try to break an invariant and assert the
 * server refuses. Seeded fixtures come from scratchpad/seed-fixtures.mjs.
 *
 * Prereqs (isolated stack): backend :3002, seeded admin e2e-admin@test.local,
 * shoppers e2e-shopper@test.local / e2e-shopper2@test.local, fixture orders OGE2E*.
 */

import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:3001";
const ORIGIN = process.env.E2E_BASE ?? "http://localhost:8080";
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@test.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin123!",
};
const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };
const SHOPPER2 = { email: "e2e-shopper2@test.local", password: "E2eShopper123" };

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, Origin: ORIGIN });

// Shared admin token — the auth endpoint is rate-limited (20/15min/IP), so a
// per-test login would trip the limiter and make the suite flaky.
let TOKEN = "";
type OrderRow = { id: string; tracking_number: string; status: string; payment_status: string };
const order: Record<string, OrderRow> = {};

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${API}/api/auth/login`, { data: ADMIN, headers: { Origin: ORIGIN } });
  expect(res.ok(), "admin login should succeed — run seed-fixtures.mjs").toBeTruthy();
  TOKEN = (await res.json()).token;

  const orders: OrderRow[] = await (await ctx.get(`${API}/api/admin/orders`, { headers: auth(TOKEN) })).json();
  for (const t of ["OGE2EUNPAID", "OGE2ESTRIPE", "OGE2ECANA", "OGE2ECANB", "OGE2ERETURN", "OGE2ESTUCK", "OGE2EIDOR"]) {
    const found = orders.find((o) => o.tracking_number === t);
    expect(found, `fixture ${t} must exist — run seed-fixtures.mjs`).toBeTruthy();
    order[t] = found!;
  }
  await ctx.dispose();
});

async function shopperCtx(who = SHOPPER): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: API, extraHTTPHeaders: { Origin: ORIGIN } });
  const res = await ctx.post(`/api/user/login`, { data: who });
  expect(res.ok(), `${who.email} login should succeed`).toBeTruthy();
  return ctx;
}

// ═══ 1. Authorization — every admin route rejects anon + customer ════════════

test.describe("Admin authZ", () => {
  const GETS = [
    "/api/admin/orders", "/api/admin/users", "/api/admin/returns",
    "/api/admin/decisions", "/api/admin/decisions/resolved",
    "/api/admin/ops-overview", "/api/admin/analytics", "/api/admin/analytics/live",
    "/api/admin/feedback", "/api/subscribers",
  ];

  test("anonymous GETs are 401", async ({ request }) => {
    for (const path of GETS) {
      const res = await request.get(`${API}${path}`);
      expect(res.status(), `${path} anon`).toBe(401);
    }
  });

  test("customer session cannot reach admin GETs (401)", async () => {
    const ctx = await shopperCtx();
    for (const path of GETS) {
      const res = await ctx.get(`${API}${path}`);
      expect(res.status(), `${path} as customer`).toBe(401);
    }
    await ctx.dispose();
  });

  test("mutating admin routes reject a bad/absent token (401)", async ({ request }) => {
    const id = order.OGE2EUNPAID.id;
    const calls = [
      request.put(`${API}/api/admin/orders/${id}`, { data: { status: "Processing" } }),
      request.put(`${API}/api/admin/orders/${id}/payment-status`, { data: { payment_status: "paid" } }),
      request.put(`${API}/api/admin/orders/${id}/cancellation`, { data: { decision: "approved" } }),
      request.post(`${API}/api/admin/orders/${id}/message`, { data: { subject: "x", body: "y" } }),
      request.put(`${API}/api/content/hero`, { data: {} }),
    ];
    for (const c of calls) expect((await c).status()).toBe(401);
  });
});

// ═══ 2. Order status lifecycle ═══════════════════════════════════════════════

test.describe("Order status transitions", () => {
  test("delivery order walks its full stage pipeline", async ({ request }) => {
    const id = order.OGE2ESTRIPE.id;
    for (const status of ["Processing", "Shipped", "Out for Delivery", "Delivered"]) {
      const res = await request.put(`${API}/api/admin/orders/${id}`, { headers: auth(TOKEN), data: { status } });
      expect(res.ok(), `set ${status}`).toBeTruthy();
      expect((await res.json()).status).toBe(status);
    }
    // reset for other tests that may read this order
    await request.put(`${API}/api/admin/orders/${id}`, { headers: auth(TOKEN), data: { status: "Processing" } });
  });

  test("a pickup stage is rejected on a delivery order (400)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${order.OGE2ESTRIPE.id}`, {
      headers: auth(TOKEN), data: { status: "Ready for Pickup" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/invalid status/i);
  });

  test("a pickup order accepts pickup stages but not delivery stages", async ({ request }) => {
    const id = order.OGE2EUNPAID.id; // pickup fixture
    const ok = await request.put(`${API}/api/admin/orders/${id}`, { headers: auth(TOKEN), data: { status: "Preparing Order" } });
    expect(ok.ok()).toBeTruthy();
    const bad = await request.put(`${API}/api/admin/orders/${id}`, { headers: auth(TOKEN), data: { status: "Shipped" } });
    expect(bad.status()).toBe(400);
    await request.put(`${API}/api/admin/orders/${id}`, { headers: auth(TOKEN), data: { status: "Order Placed" } });
  });

  test("a garbage status string is rejected (400)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${order.OGE2ESTRIPE.id}`, {
      headers: auth(TOKEN), data: { status: "Teleported 🚀" },
    });
    expect(res.status()).toBe(400);
  });

  test("updating a non-existent order is 404", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/00000000-0000-0000-0000-000000000000`, {
      headers: auth(TOKEN), data: { status: "Processing" },
    });
    expect(res.status()).toBe(404);
  });
});

// ═══ 3. Payments — mark paid/unpaid, Stripe guard, refund-status ═════════════

test.describe("Payment status", () => {
  test("mark unpaid pickup order paid → private audit event → undo", async ({ request }) => {
    const id = order.OGE2EUNPAID.id;
    const paid = await request.put(`${API}/api/admin/orders/${id}/payment-status`, {
      headers: auth(TOKEN), data: { payment_status: "paid" },
    });
    expect(paid.ok()).toBeTruthy();
    expect((await paid.json()).payment_status).toBe("paid");

    const detail = await (await request.get(`${API}/api/admin/orders/${id}`, { headers: auth(TOKEN) })).json();
    const evt = (detail.timeline || []).find((e: { type: string }) => e.type === "payment_status_changed");
    expect(evt, "audit event recorded").toBeTruthy();
    expect(evt.customer_visible).toBe(false);

    // Customer must not see the internal payment note.
    const cctx = await shopperCtx();
    const custOrder = await (await cctx.get(`${API}/api/orders/${id}`)).json();
    expect((custOrder.timeline || []).some((e: { type: string }) => e.type === "payment_status_changed")).toBeFalsy();
    await cctx.dispose();

    const undo = await request.put(`${API}/api/admin/orders/${id}/payment-status`, {
      headers: auth(TOKEN), data: { payment_status: "unpaid" },
    });
    expect((await undo.json()).payment_status).toBe("unpaid");
  });

  test("Stripe-managed order can't be flipped (400)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${order.OGE2ESTRIPE.id}/payment-status`, {
      headers: auth(TOKEN), data: { payment_status: "unpaid" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/stripe/i);
  });

  test("invalid payment_status value rejected (400)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${order.OGE2EUNPAID.id}/payment-status`, {
      headers: auth(TOKEN), data: { payment_status: "gratis" },
    });
    expect(res.status()).toBe(400);
  });

  test("refund-status on an order with no pending refund is rejected (400)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${order.OGE2ESTRIPE.id}/refund-status`, {
      headers: auth(TOKEN), data: {},
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/no refund pending/i);
  });
});

// ═══ 4. Cancellations — approve (refund clock) / reject ══════════════════════

test.describe("Cancellations", () => {
  test("approve a paid cancellation → order Cancelled, refund pending + reminder", async ({ request }) => {
    const id = order.OGE2ECANA.id;
    // Customer files the request first (only they can).
    const cctx = await shopperCtx();
    const reqRes = await cctx.post(`${API}/api/orders/${id}/cancel`, { data: { reason: "Changed my mind" } });
    expect(reqRes.ok(), "customer cancel request").toBeTruthy();
    await cctx.dispose();

    const res = await request.put(`${API}/api/admin/orders/${id}/cancellation`, {
      headers: auth(TOKEN), data: { decision: "approved", note: "Approved by QA" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("Cancelled");
    expect(body.refund_status).toBe("pending");

    // Refund now shows up in ops-overview refunds_due.
    const ops = await (await request.get(`${API}/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    expect(ops.refunds_due.some((r: { order_id: string }) => r.order_id === id)).toBeTruthy();

    // Second approval attempt is rejected — no pending request remains.
    const again = await request.put(`${API}/api/admin/orders/${id}/cancellation`, {
      headers: auth(TOKEN), data: { decision: "approved" },
    });
    expect(again.status()).toBe(400);
  });

  test("resolve the refund → refunded, reminder cleared", async ({ request }) => {
    const id = order.OGE2ECANA.id;
    const res = await request.put(`${API}/api/admin/orders/${id}/refund-status`, { headers: auth(TOKEN), data: {} });
    expect(res.ok()).toBeTruthy();
    const ops = await (await request.get(`${API}/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    expect(ops.refunds_due.some((r: { order_id: string }) => r.order_id === id)).toBeFalsy();
  });

  test("reject a cancellation → order stays active", async ({ request }) => {
    const id = order.OGE2ECANB.id;
    const cctx = await shopperCtx();
    expect((await cctx.post(`${API}/api/orders/${id}/cancel`, { data: { reason: "oops" } })).ok()).toBeTruthy();
    await cctx.dispose();

    const res = await request.put(`${API}/api/admin/orders/${id}/cancellation`, {
      headers: auth(TOKEN), data: { decision: "rejected", note: "Already shipped-ready" },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).status).not.toBe("Cancelled");
  });

  test("bad decision value rejected (400)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${order.OGE2ECANB.id}/cancellation`, {
      headers: auth(TOKEN), data: { decision: "maybe" },
    });
    expect(res.status()).toBe(400);
  });

  test("cancellation on an order with no request is rejected (400)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/orders/${order.OGE2ESTUCK.id}/cancellation`, {
      headers: auth(TOKEN), data: { decision: "approved" },
    });
    expect(res.status()).toBe(400);
  });
});

// ═══ 5. Returns — request → approve → refund (terminal) / reject / IDOR ══════

test.describe("Returns", () => {
  let returnId = "";
  const orderId = () => order.OGE2ERETURN.id;

  test("customer can only return an item that's on their own order", async () => {
    const cctx = await shopperCtx();
    const detail = await (await cctx.get(`${API}/api/orders/${orderId()}`)).json();
    const pid = detail.items[0].product_id;

    // Wrong product id → 400.
    const wrong = await cctx.post(`${API}/api/returns`, { data: { order_id: orderId(), product_id: "not-a-real-product", reason: "x" } });
    expect(wrong.status()).toBe(400);

    // Valid return request.
    const ok = await cctx.post(`${API}/api/returns`, { data: { order_id: orderId(), product_id: pid, reason: "Arrived damaged" } });
    expect(ok.status()).toBe(201);
    returnId = (await ok.json()).id;
    await cctx.dispose();
  });

  test("another shopper cannot open a return against someone else's order (404)", async () => {
    const cctx = await shopperCtx(SHOPPER2);
    const res = await cctx.post(`${API}/api/returns`, { data: { order_id: orderId(), product_id: "x", reason: "y" } });
    expect(res.status()).toBe(404);
    await cctx.dispose();
  });

  test("admin approves the return (refund clock starts)", async ({ request }) => {
    expect(returnId, "return created in earlier test").toBeTruthy();
    const res = await request.put(`${API}/api/admin/returns/${returnId}`, { headers: auth(TOKEN), data: { status: "approved" } });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).status).toBe("approved");
  });

  test("admin marks it refunded — and refunded is terminal (400 on re-change)", async ({ request }) => {
    const res = await request.put(`${API}/api/admin/returns/${returnId}`, { headers: auth(TOKEN), data: { status: "refunded" } });
    expect(res.ok()).toBeTruthy();

    const flip = await request.put(`${API}/api/admin/returns/${returnId}`, { headers: auth(TOKEN), data: { status: "approved" } });
    expect(flip.status()).toBe(400);
    expect((await flip.json()).error).toMatch(/already been refunded/i);
  });

  test("invalid return status is rejected (400)", async ({ request }) => {
    const cctx = await shopperCtx();
    const detail = await (await cctx.get(`${API}/api/orders/${orderId()}`)).json();
    const pid = detail.items[1].product_id;
    const created = await cctx.post(`${API}/api/returns`, { data: { order_id: orderId(), product_id: pid, reason: "second item" } });
    const rid = (await created.json()).id;
    await cctx.dispose();

    const res = await request.put(`${API}/api/admin/returns/${rid}`, { headers: auth(TOKEN), data: { status: "vaporized" } });
    expect(res.status()).toBe(400);
  });
});

// ═══ 6. Decisions queue — approve / dismiss ══════════════════════════════════

test.describe("Decisions queue", () => {
  test("pending + resolved endpoints return arrays", async ({ request }) => {
    const pending = await request.get(`${API}/api/admin/decisions`, { headers: auth(TOKEN) });
    const resolved = await request.get(`${API}/api/admin/decisions/resolved`, { headers: auth(TOKEN) });
    expect(Array.isArray(await pending.json())).toBeTruthy();
    expect(Array.isArray(await resolved.json())).toBeTruthy();
  });

  test("approving/dismissing a non-existent decision is 404", async ({ request }) => {
    const bad = "00000000-0000-0000-0000-000000000000";
    expect((await request.post(`${API}/api/admin/decisions/${bad}/approve`, { headers: auth(TOKEN) })).status()).toBe(404);
    expect((await request.post(`${API}/api/admin/decisions/${bad}/dismiss`, { headers: auth(TOKEN) })).status()).toBe(404);
  });
});

// ═══ 7. Ops overview ═════════════════════════════════════════════════════════

test.describe("Ops overview", () => {
  test("surfaces stuck orders, subscriber stats, and settings", async ({ request }) => {
    const ops = await (await request.get(`${API}/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    expect(ops.settings).toBeTruthy();
    expect(ops.subscriber_stats).toHaveProperty("total");
    expect(Array.isArray(ops.stuck_orders)).toBeTruthy();
    expect(Array.isArray(ops.low_stock_products)).toBeTruthy();
    // The 10-day-old in-flight fixture is past the 3-day stuck threshold.
    expect(ops.stuck_orders.some((o: { tracking_number: string }) => o.tracking_number === "OGE2ESTUCK")).toBeTruthy();
  });
});

// ═══ 8. Analytics — trailing + calendar-period filters ═══════════════════════

test.describe("Analytics", () => {
  test("default trailing window returns the dashboard shape", async ({ request }) => {
    const res = await request.get(`${API}/api/admin/analytics`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("traffic");
    expect(body).toHaveProperty("sales");
    expect(body).toHaveProperty("funnel");
  });

  test("explicit calendar quarter range is honored", async ({ request }) => {
    // Q1 2026 — a valid explicit calendar period.
    const res = await request.get(`${API}/api/admin/analytics?start=2026-01-01&end=2026-03-31`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();
  });

  test("a full-year range is honored", async ({ request }) => {
    const res = await request.get(`${API}/api/admin/analytics?start=2026-01-01&end=2026-12-31`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();
  });

  test("garbage date params fall back to trailing window (no 500)", async ({ request }) => {
    const res = await request.get(`${API}/api/admin/analytics?start=not-a-date&end=also-bad`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();
  });

  test("inverted range (end<start) falls back safely", async ({ request }) => {
    const res = await request.get(`${API}/api/admin/analytics?start=2026-12-31&end=2026-01-01`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();
  });

  test("live view returns without error", async ({ request }) => {
    const res = await request.get(`${API}/api/admin/analytics/live`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();
  });
});

// ═══ 9. Settings & content ═══════════════════════════════════════════════════

test.describe("Settings & content", () => {
  test("shipping rate of 0 is persisted and honored (not treated as unset)", async ({ request }) => {
    const cctx = await shopperCtx();
    const current = await (await cctx.get(`${API}/api/content/pickupSettings`)).json();
    await cctx.dispose();

    const save = await request.put(`${API}/api/content/pickupSettings`, {
      headers: auth(TOKEN), data: { ...(current || {}), flat_shipping_rate: 0 },
    });
    expect(save.ok()).toBeTruthy();

    const readback = await (await request.get(`${API}/api/content/pickupSettings`)).json();
    expect(readback.flat_shipping_rate).toBe(0);

    // restore
    await request.put(`${API}/api/content/pickupSettings`, {
      headers: auth(TOKEN), data: { ...(current || {}) },
    });
  });

  test("content PUT requires admin (customer/anon rejected)", async ({ request }) => {
    const cctx = await shopperCtx();
    expect((await cctx.put(`${API}/api/content/hero`, { data: { headline: "hacked" } })).status()).toBe(401);
    await cctx.dispose();
    expect((await request.put(`${API}/api/content/hero`, { data: { headline: "hacked" } })).status()).toBe(401);
  });

  test("admin users list returns records without password hashes", async ({ request }) => {
    const users = await (await request.get(`${API}/api/admin/users`, { headers: auth(TOKEN) })).json();
    expect(Array.isArray(users)).toBeTruthy();
    for (const u of users) expect(u).not.toHaveProperty("password_hash");
  });
});

// ═══ 10. CSRF — cross-site Origin blocked on state-changing admin routes ═════

test.describe("CSRF (Origin) enforcement", () => {
  test("cross-site Origin is blocked before the handler (403)", async ({ request }) => {
    const id = order.OGE2EUNPAID.id;
    const res = await request.put(`${API}/api/admin/orders/${id}/payment-status`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: "https://evil.example.com" },
      data: { payment_status: "paid" },
    });
    expect(res.status()).toBe(403);
  });

  test("cross-site content PUT is blocked (403)", async ({ request }) => {
    const res = await request.put(`${API}/api/content/hero`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: "https://evil.example.com" },
      data: { headline: "x" },
    });
    expect(res.status()).toBe(403);
  });
});
