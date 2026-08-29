/**
 * The Olive Goose — Admin API E2E Suite (orders · payments · cancellations ·
 * refunds · returns · decisions · ops · analytics · content · uploads)
 *
 * Exercises every admin route end-to-end at the HTTP layer, including the
 * customer side of each lifecycle (a cancellation/return is requested by a
 * real customer session, then decided by a real admin token) and adversarial
 * cases: authZ, IDOR, CSRF, malformed ids, invalid state transitions.
 *
 * Runs against the ISOLATED test stack (fresh Postgres, backend :3002,
 * frontend :8081) — see scratchpad/seed-fixtures.mjs for the fixture orders:
 *   OGE2EUNPAID  pickup, unpaid, no Stripe intent
 *   OGE2ESTRIPE  delivery, paid via Stripe, status Processing
 *   OGE2ECANA    delivery, paid, Order Placed  (cancellation → approve → refund)
 *   OGE2ECANB    delivery, paid, Order Placed  (cancellation → reject)
 *   OGE2ERETURN  delivery, paid, Delivered, 2 items (returns flows)
 *   OGE2ESTUCK   delivery, paid, Processing, 10 days old (ops stuck order)
 *   OGE2EIDOR    second shopper's order (IDOR probes)
 *
 * Suite is serial (workers=1): later tests build on earlier lifecycle steps.
 */

import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:3001";
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@test.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin123!",
};
const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };
const SHOPPER2 = { email: "e2e-shopper2@test.local", password: "E2eShopper123" };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Shared state — one admin token + one session context per shopper for the whole
// suite (the auth endpoints are rate-limited to 20/15min per IP).
let TOKEN = "";
let shopper: APIRequestContext;   // carries e2e-shopper's session cookie
let shopper2: APIRequestContext;  // carries e2e-shopper2's session cookie
let admin: APIRequestContext;     // plain context; pass auth(TOKEN) per call

/** id of a fixture order by tracking number (admin view). */
const orderIds: Record<string, string> = {};

test.beforeAll(async () => {
  admin = await pwRequest.newContext({ baseURL: API });
  const login = await admin.post(`/api/auth/login`, { data: ADMIN });
  expect(login.ok(), "admin login must succeed (seed the isolated stack first)").toBeTruthy();
  TOKEN = (await login.json()).token;

  shopper = await pwRequest.newContext({ baseURL: API });
  expect((await shopper.post(`/api/user/login`, { data: SHOPPER })).ok()).toBeTruthy();
  shopper2 = await pwRequest.newContext({ baseURL: API });
  expect((await shopper2.post(`/api/user/login`, { data: SHOPPER2 })).ok()).toBeTruthy();

  const orders = await (await admin.get(`/api/admin/orders`, { headers: auth(TOKEN) })).json();
  for (const o of orders) orderIds[o.tracking_number] = o.id;
  for (const t of ["OGE2EUNPAID", "OGE2ESTRIPE", "OGE2ECANA", "OGE2ECANB", "OGE2ERETURN", "OGE2ESTUCK", "OGE2EIDOR"]) {
    expect(orderIds[t], `fixture ${t} must exist — run seed-fixtures.mjs`).toBeTruthy();
  }
});

test.afterAll(async () => {
  await shopper?.dispose();
  await shopper2?.dispose();
  await admin?.dispose();
});

// ─── 1. Admin auth hardening ──────────────────────────────────────────────────

test.describe("admin auth", () => {
  test("garbage / forged bearer tokens are rejected", async ({ request }) => {
    for (const bad of [
      "not-a-jwt",
      // signed with a different secret
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImUyZS1hZG1pbkB0ZXN0LmxvY2FsIiwidG9rZW5WZXJzaW9uIjowfQ.invalid-signature",
    ]) {
      const res = await request.get(`${API}/api/admin/orders`, { headers: auth(bad) });
      expect(res.status(), `token "${bad.slice(0, 20)}…" must be rejected`).toBe(401);
    }
  });

  test("missing credentials → 401, never a hint which field failed", async ({ request }) => {
    for (const body of [{}, { email: ADMIN.email }, { password: "x" }]) {
      const res = await request.post(`${API}/api/auth/login`, { data: body });
      expect(res.status()).toBe(401);
    }
  });

  test("customer session cookie cannot reach any admin GET route", async () => {
    for (const path of [
      "/api/admin/orders", "/api/admin/returns", "/api/admin/decisions",
      "/api/admin/decisions/resolved", "/api/admin/ops-overview",
      "/api/admin/users", "/api/admin/feedback", "/api/admin/analytics",
      "/api/admin/analytics/live", "/api/subscribers",
    ]) {
      const res = await shopper.get(path);
      expect(res.status(), `${path} must reject a customer session`).toBe(401);
    }
  });
});

// ─── 2. Orders: listing, detail, malformed ids ────────────────────────────────

test.describe("admin orders · read paths", () => {
  test("listing includes fixtures with customer identity attached", async () => {
    const orders = await (await admin.get(`/api/admin/orders`, { headers: auth(TOKEN) })).json();
    const unpaid = orders.find((o: any) => o.tracking_number === "OGE2EUNPAID");
    expect(unpaid.user_email).toBe(SHOPPER.email);
    expect(unpaid.fulfillment_type).toBe("pickup");
    expect(unpaid.payment_status).toBe("unpaid");
    const stripe = orders.find((o: any) => o.tracking_number === "OGE2ESTRIPE");
    expect(stripe.payment_status).toBe("paid");
  });

  test("detail returns the timeline and refund reminders arrays", async () => {
    const res = await admin.get(`/api/admin/orders/${orderIds.OGE2ESTRIPE}`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();
    const detail = await res.json();
    expect(Array.isArray(detail.timeline)).toBeTruthy();
    expect(Array.isArray(detail.refund_reminders)).toBeTruthy();
  });

  test("a malformed (non-UUID) order id is a clean 4xx, not a 500", async () => {
    for (const path of [
      `/api/admin/orders/not-a-uuid`,
      `/api/admin/orders/1'; DROP TABLE orders;--`,
    ]) {
      const res = await admin.get(path, { headers: auth(TOKEN) });
      expect([400, 404], `${path} must be a client error, got ${res.status()}`).toContain(res.status());
    }
  });

  test("customer order detail with a malformed id is also a clean 4xx", async () => {
    const res = await shopper.get(`/api/orders/not-a-uuid`);
    expect([400, 404]).toContain(res.status());
  });
});

// ─── 3. Orders: status transitions ────────────────────────────────────────────

test.describe("admin orders · status transitions", () => {
  test("delivery order advances through its stages and logs an event", async () => {
    const id = orderIds.OGE2ESTRIPE; // currently Processing
    const res = await admin.put(`/api/admin/orders/${id}`, {
      headers: auth(TOKEN), data: { status: "Shipped" },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).status).toBe("Shipped");

    const detail = await (await admin.get(`/api/admin/orders/${id}`, { headers: auth(TOKEN) })).json();
    const evt = detail.timeline.filter((e: any) => e.type === "status_changed").pop();
    expect(evt?.meta?.status).toBe("Shipped");

    // roll back to Processing so later suites see the fixture as seeded
    await admin.put(`/api/admin/orders/${id}`, { headers: auth(TOKEN), data: { status: "Processing" } });
  });

  test("a pickup order rejects delivery-only stages (and vice versa)", async () => {
    const bad1 = await admin.put(`/api/admin/orders/${orderIds.OGE2EUNPAID}`, {
      headers: auth(TOKEN), data: { status: "Shipped" }, // delivery stage on a pickup order
    });
    expect(bad1.status()).toBe(400);
    const bad2 = await admin.put(`/api/admin/orders/${orderIds.OGE2ESTRIPE}`, {
      headers: auth(TOKEN), data: { status: "Ready for Pickup" }, // pickup stage on a delivery order
    });
    expect(bad2.status()).toBe(400);
  });

  test("unknown / missing / non-string statuses are rejected", async () => {
    for (const status of ["Teleported", "", null, 42, ["Shipped"]]) {
      const res = await admin.put(`/api/admin/orders/${orderIds.OGE2ESTRIPE}`, {
        headers: auth(TOKEN), data: { status },
      });
      expect(res.status(), `status ${JSON.stringify(status)} must be rejected`).toBe(400);
    }
  });

  test("'Cancelled' cannot be set via the status route (only via cancellation flow)", async () => {
    const res = await admin.put(`/api/admin/orders/${orderIds.OGE2ESTRIPE}`, {
      headers: auth(TOKEN), data: { status: "Cancelled" },
    });
    expect(res.status()).toBe(400);
  });

  test("status update on a non-existent order → 404", async () => {
    const res = await admin.put(`/api/admin/orders/00000000-0000-0000-0000-000000000000`, {
      headers: auth(TOKEN), data: { status: "Shipped" },
    });
    expect(res.status()).toBe(404);
  });
});

// ─── 4. Cancellation lifecycle A: request → approve → refund ─────────────────

test.describe("cancellation · approve path (paid order)", () => {
  test("customer requests cancellation on a paid, early-stage order", async () => {
    const id = orderIds.OGE2ECANA;
    const res = await shopper.post(`/api/orders/${id}/cancel`, { data: { reason: "Ordered by mistake" } });
    expect(res.ok()).toBeTruthy();
    const order = await res.json();
    expect(order.cancellation_status).toBe("requested");

    // a second request while one is pending is refused
    const again = await shopper.post(`/api/orders/${id}/cancel`, { data: { reason: "double-tap" } });
    expect(again.status()).toBe(400);
  });

  test("customer cannot request cancellation on someone else's order", async () => {
    const res = await shopper.post(`/api/orders/${orderIds.OGE2EIDOR}/cancel`, { data: { reason: "not mine" } });
    expect(res.status()).toBe(404);
  });

  test("delivered orders can no longer be cancelled online", async () => {
    const res = await shopper.post(`/api/orders/${orderIds.OGE2ERETURN}/cancel`, { data: { reason: "too late" } });
    expect(res.status()).toBe(400);
  });

  test("the pending request surfaces in ops-overview", async () => {
    const ops = await (await admin.get(`/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    const pending = ops.pending_cancellations.map((c: any) => c.tracking_number);
    expect(pending).toContain("OGE2ECANA");
  });

  test("invalid decision values are rejected", async () => {
    for (const decision of ["maybe", "", null, "APPROVED"]) {
      const res = await admin.put(`/api/admin/orders/${orderIds.OGE2ECANA}/cancellation`, {
        headers: auth(TOKEN), data: { decision },
      });
      expect(res.status(), `decision ${JSON.stringify(decision)} must be 400`).toBe(400);
    }
  });

  test("approve → order Cancelled, refund clock starts, customer sees the outcome", async () => {
    const id = orderIds.OGE2ECANA;
    const res = await admin.put(`/api/admin/orders/${id}/cancellation`, {
      headers: auth(TOKEN), data: { decision: "approved", note: "Approved by e2e" },
    });
    expect(res.ok()).toBeTruthy();
    const order = await res.json();
    expect(order.status).toBe("Cancelled");
    expect(order.cancellation_status).toBe("approved");
    expect(order.refund_status).toBe("pending"); // paid → refund owed

    // refund reminder now due in ops
    const ops = await (await admin.get(`/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    expect(ops.refunds_due.some((r: any) => r.tracking_number === "OGE2ECANA")).toBeTruthy();

    // customer's own timeline shows the approval (customer-visible event)
    const cust = await (await shopper.get(`/api/orders/${id}`)).json();
    expect(cust.timeline.some((e: any) => e.type === "cancellation_approved")).toBeTruthy();

    // deciding again on the same order is refused
    const again = await admin.put(`/api/admin/orders/${id}/cancellation`, {
      headers: auth(TOKEN), data: { decision: "approved" },
    });
    expect(again.status()).toBe(400);
  });

  test("refund marked done → refund_status refunded, reminder resolved", async () => {
    const id = orderIds.OGE2ECANA;
    const res = await admin.put(`/api/admin/orders/${id}/refund-status`, { headers: auth(TOKEN), data: {} });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).via_stripe).toBe(false); // refund automation off by default

    const detail = await (await admin.get(`/api/admin/orders/${id}`, { headers: auth(TOKEN) })).json();
    expect(detail.refund_status).toBe("refunded");
    expect(detail.timeline.some((e: any) => e.type === "refund_completed")).toBeTruthy();
    expect(detail.refund_reminders.every((r: any) => r.resolved_at)).toBeTruthy();

    // ops no longer lists it as due
    const ops = await (await admin.get(`/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    expect(ops.refunds_due.some((r: any) => r.tracking_number === "OGE2ECANA")).toBeFalsy();

    // resolving twice is refused
    const again = await admin.put(`/api/admin/orders/${id}/refund-status`, { headers: auth(TOKEN), data: {} });
    expect(again.status()).toBe(400);
  });

  test("refund-status on an order with no pending refund → 400", async () => {
    const res = await admin.put(`/api/admin/orders/${orderIds.OGE2ESTRIPE}/refund-status`, {
      headers: auth(TOKEN), data: {},
    });
    expect(res.status()).toBe(400);
  });
});

// ─── 5. Cancellation lifecycle B: request → reject ────────────────────────────

test.describe("cancellation · reject path", () => {
  test("reject keeps the order alive and records the decision", async () => {
    const id = orderIds.OGE2ECANB;
    expect((await shopper.post(`/api/orders/${id}/cancel`, { data: { reason: "changed my mind" } })).ok()).toBeTruthy();

    const res = await admin.put(`/api/admin/orders/${id}/cancellation`, {
      headers: auth(TOKEN), data: { decision: "rejected", note: "Already being prepared" },
    });
    expect(res.ok()).toBeTruthy();
    const order = await res.json();
    expect(order.cancellation_status).toBe("rejected");
    expect(order.status).not.toBe("Cancelled");
    expect(order.refund_status).toBe("not_applicable");

    // once rejected, the customer can't immediately re-request
    const again = await shopper.post(`/api/orders/${id}/cancel`, { data: { reason: "retry" } });
    expect(again.status()).toBe(400);
  });

  test("cancellation decision on an order with no request → 400", async () => {
    const res = await admin.put(`/api/admin/orders/${orderIds.OGE2ESTUCK}/cancellation`, {
      headers: auth(TOKEN), data: { decision: "approved" },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── 6. Admin → customer messaging ────────────────────────────────────────────

test.describe("admin messaging", () => {
  test("message lands on the customer-visible timeline", async () => {
    const id = orderIds.OGE2ESTRIPE;
    const res = await admin.post(`/api/admin/orders/${id}/message`, {
      headers: auth(TOKEN),
      data: { subject: "About your order", body: "Your candles ship tomorrow." },
    });
    expect(res.status()).toBe(201);

    const cust = await (await shopper.get(`/api/orders/${id}`)).json();
    const msg = cust.timeline.find((e: any) => e.type === "message");
    expect(msg?.title).toBe("About your order");
  });

  test("empty subject or body is rejected", async () => {
    for (const data of [{ subject: "", body: "x" }, { subject: "x", body: "" }, {}]) {
      const res = await admin.post(`/api/admin/orders/${orderIds.OGE2ESTRIPE}/message`, {
        headers: auth(TOKEN), data,
      });
      expect(res.status()).toBe(400);
    }
  });

  test("HTML in a message is stored inert (no script execution vector)", async () => {
    const id = orderIds.OGE2ESTRIPE;
    const payload = `<script>alert(1)</script><img src=x onerror=alert(2)>`;
    const res = await admin.post(`/api/admin/orders/${id}/message`, {
      headers: auth(TOKEN), data: { subject: "xss probe", body: payload },
    });
    expect(res.status()).toBe(201);
    const detail = await (await admin.get(`/api/admin/orders/${id}`, { headers: auth(TOKEN) })).json();
    const msg = detail.timeline.filter((e: any) => e.type === "message").pop();
    // stored as data; the SPA renders timeline details as text nodes (never innerHTML)
    expect(msg.detail).toContain("<script>");
  });
});

// ─── 7. Returns lifecycle ─────────────────────────────────────────────────────

let returnManualId = "";   // "changed my mind" → manual admin approval
let returnAutoId = "";     // "damaged" → decision engine suggests approval

test.describe("returns · request & validation", () => {
  test("customer files a return for an item they actually bought", async () => {
    const order = await (await shopper.get(`/api/orders/${orderIds.OGE2ERETURN}`)).json();
    const pid = order.items[0].product_id;
    const res = await shopper.post(`/api/returns`, {
      data: { order_id: order.id, product_id: pid, reason: "changed my mind" },
    });
    expect(res.status()).toBe(201);
    returnManualId = (await res.json()).id;

    // it shows up for the customer and for the admin
    const mine = await (await shopper.get(`/api/returns`)).json();
    expect(mine.some((r: any) => r.id === returnManualId)).toBeTruthy();
    const adminList = await (await admin.get(`/api/admin/returns`, { headers: auth(TOKEN) })).json();
    const row = adminList.find((r: any) => r.id === returnManualId);
    expect(row?.user_email).toBe(SHOPPER.email);
    expect(row?.status).toBe("requested");
  });

  test("return for a product not on the order → 400", async () => {
    const res = await shopper.post(`/api/returns`, {
      data: { order_id: orderIds.OGE2ERETURN, product_id: "no-such-product", reason: "nope" },
    });
    expect(res.status()).toBe(400);
  });

  test("return against another shopper's order → 404", async () => {
    const other = await (await shopper2.get(`/api/orders/${orderIds.OGE2EIDOR}`)).json();
    const res = await shopper.post(`/api/returns`, {
      data: { order_id: orderIds.OGE2EIDOR, product_id: other.items[0].product_id, reason: "IDOR probe" },
    });
    expect(res.status()).toBe(404);
  });

  test("missing fields → 400", async () => {
    for (const data of [{}, { order_id: orderIds.OGE2ERETURN }, { order_id: orderIds.OGE2ERETURN, product_id: "x" }]) {
      const res = await shopper.post(`/api/returns`, { data });
      expect(res.status()).toBe(400);
    }
  });
});

test.describe("returns · admin decision & refund", () => {
  test("approve starts the refund clock; refunded is terminal", async () => {
    const approve = await admin.put(`/api/admin/returns/${returnManualId}`, {
      headers: auth(TOKEN), data: { status: "approved" },
    });
    expect(approve.ok()).toBeTruthy();

    const ops1 = await (await admin.get(`/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    expect(ops1.refunds_due.some((r: any) => r.source === "return" && r.source_id === returnManualId)).toBeTruthy();

    const refund = await admin.put(`/api/admin/returns/${returnManualId}`, {
      headers: auth(TOKEN), data: { status: "refunded" },
    });
    expect(refund.ok()).toBeTruthy();

    const ops2 = await (await admin.get(`/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    expect(ops2.refunds_due.some((r: any) => r.source_id === returnManualId)).toBeFalsy();

    // terminal: no further flips once the customer has been told
    for (const status of ["requested", "approved", "rejected"]) {
      const res = await admin.put(`/api/admin/returns/${returnManualId}`, {
        headers: auth(TOKEN), data: { status },
      });
      expect(res.status(), `refunded → ${status} must be refused`).toBe(400);
    }
  });

  test("invalid status values and unknown ids are rejected", async () => {
    const bad = await admin.put(`/api/admin/returns/${returnManualId}`, {
      headers: auth(TOKEN), data: { status: "maybe" },
    });
    expect(bad.status()).toBe(400);
    const missing = await admin.put(`/api/admin/returns/00000000-0000-0000-0000-000000000000`, {
      headers: auth(TOKEN), data: { status: "approved" },
    });
    expect(missing.status()).toBe(404);
  });

  test("customer timeline received the return status updates", async () => {
    const cust = await (await shopper.get(`/api/orders/${orderIds.OGE2ERETURN}`)).json();
    const types = cust.timeline.map((e: any) => e.type);
    expect(types).toContain("return_requested");
    expect(types).toContain("return_status_changed");
  });
});

// ─── 8. Decision engine (suggestions queue) ───────────────────────────────────

test.describe("decisions queue", () => {
  test("an auto-approvable return reason produces a pending suggestion", async () => {
    const order = await (await shopper.get(`/api/orders/${orderIds.OGE2ERETURN}`)).json();
    const pid = order.items[1].product_id; // second line item
    const res = await shopper.post(`/api/returns`, {
      data: { order_id: order.id, product_id: pid, reason: "damaged" },
    });
    expect(res.status()).toBe(201);
    returnAutoId = (await res.json()).id;

    // evaluateReturnDecision runs async after the response — poll the queue
    await expect(async () => {
      const decisions = await (await admin.get(`/api/admin/decisions`, { headers: auth(TOKEN) })).json();
      const d = decisions.find((x: any) => x.return_id === returnAutoId);
      expect(d, "decision engine should suggest a decision for 'damaged'").toBeTruthy();
      expect(d.status).toBe("pending");
    }).toPass({ timeout: 10_000 });
  });

  test("approving the suggestion executes the underlying return approval", async () => {
    const decisions = await (await admin.get(`/api/admin/decisions`, { headers: auth(TOKEN) })).json();
    const d = decisions.find((x: any) => x.return_id === returnAutoId);
    expect(d).toBeTruthy();

    const res = await admin.post(`/api/admin/decisions/${d.id}/approve`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();

    // the return actually moved to the suggested status
    const returns = await (await admin.get(`/api/admin/returns`, { headers: auth(TOKEN) })).json();
    const ret = returns.find((r: any) => r.id === returnAutoId);
    expect(["approved", "rejected"]).toContain(ret.status);

    // resolved: gone from pending, present in history, not re-approvable
    const pending = await (await admin.get(`/api/admin/decisions`, { headers: auth(TOKEN) })).json();
    expect(pending.some((x: any) => x.id === d.id)).toBeFalsy();
    const resolved = await (await admin.get(`/api/admin/decisions/resolved`, { headers: auth(TOKEN) })).json();
    expect(resolved.some((x: any) => x.id === d.id)).toBeTruthy();
    const again = await admin.post(`/api/admin/decisions/${d.id}/approve`, { headers: auth(TOKEN) });
    expect(again.status()).toBe(400);
  });

  test("dismissing a non-existent or resolved decision → 404", async () => {
    const res = await admin.post(`/api/admin/decisions/00000000-0000-0000-0000-000000000000/dismiss`, {
      headers: auth(TOKEN),
    });
    expect(res.status()).toBe(404);
  });
});

// ─── 9. Ops overview ──────────────────────────────────────────────────────────

test.describe("ops overview", () => {
  test("stuck orders include the 10-day-old in-flight fixture", async () => {
    const ops = await (await admin.get(`/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    expect(ops.stuck_orders.some((o: any) => o.tracking_number === "OGE2ESTUCK")).toBeTruthy();
    // delivered/cancelled orders never count as stuck
    expect(ops.stuck_orders.some((o: any) => o.tracking_number === "OGE2ERETURN")).toBeFalsy();
    expect(ops.stuck_orders.some((o: any) => o.tracking_number === "OGE2ECANA")).toBeFalsy();
  });

  test("subscriber stats and pending counts are coherent", async () => {
    const ops = await (await admin.get(`/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
    expect(ops.subscriber_stats.total).toBeGreaterThanOrEqual(0);
    expect(ops.pending_returns_count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(ops.low_stock_products)).toBeTruthy();
    expect(Array.isArray(ops.underperforming_bundles)).toBeTruthy();
  });

  test("low-stock products reflect the catalog's stock levels", async () => {
    const catalog = await (await admin.get(`/api/content/products`)).json();
    const original = JSON.parse(JSON.stringify(catalog));
    try {
      catalog.items[0].stock = 1; // at/below the default threshold of 5
      const save = await admin.put(`/api/content/products`, { headers: auth(TOKEN), data: catalog });
      expect(save.ok()).toBeTruthy();

      const ops = await (await admin.get(`/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
      expect(ops.low_stock_products.some((p: any) => p.id === catalog.items[0].id)).toBeTruthy();
    } finally {
      await admin.put(`/api/content/products`, { headers: auth(TOKEN), data: original });
    }
  });

  test("automation settings round-trip and drive the stuck-order window", async () => {
    const settings = await (await admin.get(`/api/content/automationSettings`)).json();
    const original = JSON.parse(JSON.stringify(settings));
    try {
      settings.stuck_order_days = 30; // OGE2ESTUCK is 10 days old → no longer stuck
      expect((await admin.put(`/api/content/automationSettings`, { headers: auth(TOKEN), data: settings })).ok()).toBeTruthy();
      const ops = await (await admin.get(`/api/admin/ops-overview`, { headers: auth(TOKEN) })).json();
      expect(Number(ops.settings.stuck_order_days)).toBe(30);
      expect(ops.stuck_orders.some((o: any) => o.tracking_number === "OGE2ESTUCK")).toBeFalsy();
    } finally {
      await admin.put(`/api/content/automationSettings`, { headers: auth(TOKEN), data: original });
    }
  });
});

// ─── 10. Users / subscribers / feedback panels ────────────────────────────────

test.describe("customers & feedback panels", () => {
  test("admin users list contains the shoppers, without password hashes", async () => {
    const users = await (await admin.get(`/api/admin/users`, { headers: auth(TOKEN) })).json();
    const me = users.find((u: any) => u.email === SHOPPER.email);
    expect(me).toBeTruthy();
    expect(me.password_hash).toBeUndefined();
  });

  test("newsletter subscribe → admin list → delete round-trip", async ({ request }) => {
    const email = `e2e-sub-${Date.now()}@test.local`;
    const sub = await request.post(`${API}/api/subscribers`, { data: { email } });
    expect(sub.status()).toBe(201);
    // The welcome code goes to the mailbox and nowhere else — never in the reply.
    expect((await sub.json()).discount?.code, "the code must not reach the client").toBeUndefined();
    const codesFor = async () => {
      const { codes } = await (await admin.get(`/api/admin/discount-codes`, { headers: auth(TOKEN) })).json();
      return codes.filter((c: { email: string | null; code: string }) => (c.email ?? "").toLowerCase() === email);
    };
    const [firstRow] = await codesFor();
    expect(firstRow?.code).toBeTruthy();

    /*
     * Subscribing again is not an error while the welcome code is still unused:
     * someone who lost the email must be able to ask for it back (see the route —
     * it also backfills anyone who subscribed before the discount existed). So the
     * answer is 200 and the SAME code is re-sent, never a second one. That last
     * part is the whole anti-abuse property: re-subscribing must not mint discounts.
     */
    const again = await request.post(`${API}/api/subscribers`, { data: { email } });
    expect(again.status()).toBe(200);
    const body = await again.json();
    expect(body.already_subscribed).toBe(true);
    expect(body.discount?.code).toBeUndefined();
    const rows = await codesFor();
    expect(rows, "re-subscribing must re-send, never mint").toHaveLength(1);
    expect(rows[0].code).toBe(firstRow.code);

    const list = await (await admin.get(`/api/subscribers`, { headers: auth(TOKEN) })).json();
    const row = list.find((s: any) => s.email === email);
    expect(row).toBeTruthy();

    expect((await admin.delete(`/api/subscribers/${row.id}`, { headers: auth(TOKEN) })).ok()).toBeTruthy();
    const after = await (await admin.get(`/api/subscribers`, { headers: auth(TOKEN) })).json();
    expect(after.some((s: any) => s.id === row.id)).toBeFalsy();
  });

  test("feedback: valid post → admin list → delete round-trip", async ({ request }) => {
    const res = await request.post(`${API}/api/feedback`, {
      data: { name: "E2E", message: "[E2E] admin suite feedback", rating: 4 },
    });
    expect(res.status()).toBe(201);
    const created = await res.json();

    const list = await (await admin.get(`/api/admin/feedback`, { headers: auth(TOKEN) })).json();
    expect(list.some((f: any) => f.id === created.id)).toBeTruthy();

    expect((await admin.delete(`/api/admin/feedback/${created.id}`, { headers: auth(TOKEN) })).ok()).toBeTruthy();
    const after = await (await admin.get(`/api/admin/feedback`, { headers: auth(TOKEN) })).json();
    expect(after.some((f: any) => f.id === created.id)).toBeFalsy();
  });
});

// ─── 11. Analytics ────────────────────────────────────────────────────────────

test.describe("analytics", () => {
  const VISITOR = `e2evisitor${Date.now()}`;
  const SESSION = `e2esession${Date.now()}`;

  // Ingestion only records what a browser could plausibly have sent, and the
  // dashboard reports the storefront unless asked for another hostname. So a
  // fixture posting straight at the route has to look like the thing it is
  // standing in for: a real user-agent, and the storefront's own Origin.
  //
  // "e2e-suite" with no Origin used to be accepted, which is exactly how the
  // front-end test suite came to be recorded as 6,950 shopper events in the live
  // database. It is refused now, and this fixture should be refused too if it
  // ever drifts back to pretending.
  //
  // The Origin is the frontend under test, which this stack configures as the
  // counted storefront (ANALYTICS_ORIGINS in e2e/run-e2e.mjs). It has to be an
  // origin the CORS layer serves as well, or the request is refused a step
  // earlier and never reaches the question being asked here.
  const AS_A_SHOPPER = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    Origin: process.env.E2E_BASE ?? "http://localhost:8081",
  };

  test("ingestion accepts allowed client events and drops forged ones", async ({ request }) => {
    const ok = await request.post(`${API}/api/analytics/events`, {
      headers: AS_A_SHOPPER,
      data: {
        visitor_id: VISITOR, session_id: SESSION,
        events: [
          { type: "page_view", path: "/", device: "desktop" },
          { type: "add_to_cart", path: "/shop", device: "desktop", props: { product: "x" } },
          // forged events that must be silently dropped, never inflate revenue:
          { type: "purchase", path: "/checkout/success", props: { total: 99999 } },
          { type: "evil_event", path: "/" },
        ],
      },
    });
    expect([200, 204]).toContain(ok.status());

    // missing/invalid ids are rejected
    const bad = await request.post(`${API}/api/analytics/events`, {
      headers: AS_A_SHOPPER,
      data: { visitor_id: "x", session_id: SESSION, events: [{ type: "page_view" }] },
    });
    expect(bad.status()).toBe(400);
  });

  test("dashboard aggregates the ingested events; forged purchase is absent", async () => {
    await expect(async () => {
      const a = await (await admin.get(`/api/admin/analytics?days=1`, { headers: auth(TOKEN) })).json();
      expect(a.traffic.visitors).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 10_000 });

    const a = await (await admin.get(`/api/admin/analytics?days=1`, { headers: auth(TOKEN) })).json();
    // sales come from the orders table (fixtures), never from client-sent totals —
    // the forged 99 999 purchase above must not appear anywhere.
    expect(Number(a.sales.revenue ?? 0)).toBeLessThan(99999);
  });

  test("calendar-period filters: explicit start/end window works (Q2 2026)", async () => {
    const res = await admin.get(`/api/admin/analytics?start=2026-04-01&end=2026-06-30`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();
    const a = await res.json();
    // The window it actually rendered comes back at the top level, alongside the
    // timezone the day boundaries were drawn in — a quarter is 91 days, and the
    // panel needs to be able to say so rather than implying the range it asked
    // for is necessarily the range it got (see the clamping cases below).
    expect(a.start).toBe("2026-04-01");
    expect(a.end).toBe("2026-06-30");
    expect(a.days).toBe(91);
    expect(a.timezone).toBeTruthy();
  });

  // An *explicitly asked for* range that cannot be honoured is refused, not
  // quietly substituted: the panel would otherwise print the dates the admin
  // typed above numbers measured over some other window, and nothing on screen
  // would say so. A bare `days` carries no such promise, so it still clamps.
  test("an impossible explicit range is refused, not silently substituted", async () => {
    for (const q of ["start=2026-99-99&end=2026-01-01", "start=2026-06-30&end=2026-04-01"]) {
      const res = await admin.get(`/api/admin/analytics?${q}`, { headers: auth(TOKEN) });
      expect(res.status(), `?${q} must be refused rather than answered`).toBe(400);
      expect((await res.json()).error, `?${q} must say why`).toBeTruthy();
    }
  });

  test("a nonsense days window clamps and reports the window it used", async () => {
    for (const q of ["days=99999", "days=-5"]) {
      const res = await admin.get(`/api/admin/analytics?${q}`, { headers: auth(TOKEN) });
      expect(res.ok(), `?${q} should degrade gracefully`).toBeTruthy();
      // Degrading is only safe if the answer says which window it fell back to;
      // otherwise a mistyped quarter reads as a real collapse in the numbers.
      const a = await res.json();
      expect(a.start, `?${q} must report the window it used`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.days, `?${q} must stay inside the 2-year cap`).toBeLessThanOrEqual(731);
      expect(a.days).toBeGreaterThan(0);
    }
  });

  test("device filter switches to attributed sales and flags it", async () => {
    const a = await (await admin.get(`/api/admin/analytics?days=1&device=desktop`, { headers: auth(TOKEN) })).json();
    expect(a.attributed).toBe(true);
  });

  test("live endpoint responds with current activity shape", async () => {
    const res = await admin.get(`/api/admin/analytics/live`, { headers: auth(TOKEN) });
    expect(res.ok()).toBeTruthy();
  });
});

// ─── 12. Content & uploads ────────────────────────────────────────────────────

test.describe("content & uploads", () => {
  test("content PUT requires admin auth; GET is public", async ({ request }) => {
    const get = await request.get(`${API}/api/content/hero`);
    expect(get.ok()).toBeTruthy();
    const put = await request.put(`${API}/api/content/hero`, { data: { headline: "hacked" } });
    expect(put.status()).toBe(401);
  });

  test("content round-trip preserves the payload", async () => {
    const original = await (await admin.get(`/api/content/hero`)).json();
    try {
      const probe = { ...original, headline: `E2E ${Date.now()}` };
      expect((await admin.put(`/api/content/hero`, { headers: auth(TOKEN), data: probe })).ok()).toBeTruthy();
      const readBack = await (await admin.get(`/api/content/hero`)).json();
      expect(readBack.headline).toBe(probe.headline);
    } finally {
      await admin.put(`/api/content/hero`, { headers: auth(TOKEN), data: original });
    }
  });

  test("image upload: auth required; svg and mismatched types rejected; png accepted", async ({ request }) => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    // no token → 401
    const anon = await request.post(`${API}/api/upload/image`, {
      multipart: { image: { name: "a.png", mimeType: "image/png", buffer: png } },
    });
    expect(anon.status()).toBe(401);

    // svg is an XSS vector when served same-origin — must be refused
    const svg = await admin.post(`/api/upload/image`, {
      headers: auth(TOKEN),
      multipart: {
        image: {
          name: "x.svg",
          mimeType: "image/svg+xml",
          buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
        },
      },
    });
    expect(svg.status(), "an .svg must not be stored under /uploads").toBe(400);
    expect(await svg.text()).not.toContain("/uploads/");

    // The extension allowlist and the declared mime type must BOTH hold: either
    // one alone is trivially forged by whatever is posting the file.
    const lyingMime = await admin.post(`/api/upload/image`, {
      headers: auth(TOKEN),
      multipart: { image: { name: "shell.php", mimeType: "image/png", buffer: png } },
    });
    expect(lyingMime.status(), "an allowed mime cannot rescue a disallowed extension").toBe(400);

    const lyingExt = await admin.post(`/api/upload/image`, {
      headers: auth(TOKEN),
      multipart: { image: { name: "a.png", mimeType: "text/html", buffer: png } },
    });
    expect(lyingExt.status(), "an allowed extension cannot rescue a disallowed mime").toBe(400);

    // …and a real png still goes through, served with the headers that keep
    // anything that ever does land in uploads/ from executing.
    const ok = await admin.post(`/api/upload/image`, {
      headers: auth(TOKEN),
      multipart: { image: { name: "a.png", mimeType: "image/png", buffer: png } },
    });
    expect(ok.ok(), await ok.text()).toBeTruthy();
    const { path: uploadedPath } = await ok.json();
    expect(uploadedPath).toMatch(/^\/uploads\/image-[0-9]+-[0-9a-f]+\.png$/);

    const served = await request.get(`${API}${uploadedPath}`);
    expect(served.ok()).toBeTruthy();
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");
    expect(served.headers()["content-security-policy"]).toContain("default-src 'none'");
  });
});