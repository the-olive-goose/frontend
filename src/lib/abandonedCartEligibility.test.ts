import { describe, expect, it } from "vitest";
import {
  cartFingerprint, findAbandonedCarts, normalizeAbandonedCartSettings,
} from "../../backend/abandonedCart.js";

/**
 * Who gets emailed, and — more importantly — who does not.
 *
 * findAbandonedCarts is the single decision point for both send paths (the
 * quarter-hourly sweep and the admin's Send now), so every guard the feature has
 * is in here. They are all "don't send" guards, which is exactly the kind of
 * logic that fails silently in production: a broken cooldown does not throw, it
 * emails a customer four times and costs a subscriber.
 *
 * The pool is a stub matched on SQL fragments rather than a database. That keeps
 * this a unit test — and this repo has burned a live database from a test run
 * before (see the note about vitest writing to prod analytics), so a suite that
 * cannot reach a socket is the point, not a shortcut.
 */

const HOUR = 3_600_000;
// Midday in Dublin either side of the DST boundary — comfortably outside the
// default 22:00–08:00 quiet window, so these cases test cadence, not clocks.
const NOW = new Date("2026-08-30T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const CATALOG = [
  { id: "p1", name: "Café Noir", price: "€25.00", image_url: "https://example.com/a.jpg" },
  { id: "p2", name: "Sunday Linen", price: "11.75", image_url: "/uploads/local.jpg" },
];

interface StubCart {
  user_id: string;
  email: string;
  full_name?: string;
  product_id: string;
  quantity: number;
  touched_at: Date;
  /** The browser-supplied snapshot, deliberately stale in one case below. */
  product_data?: Record<string, unknown>;
}

interface StubData {
  carts: StubCart[];
  catalog?: typeof CATALOG;
  sends?: Array<{ user_id: string; cart_fingerprint: string; reminder_number: number; sent_at: Date }>;
  optOuts?: string[];
  orders?: Array<{ user_id: string; last_order_at: Date }>;
}

/** Answers the five queries findAbandonedCarts makes, matched on SQL fragments. */
const stubPool = (data: StubData) => ({
  query: async (sql: string) => {
    if (sql.includes("FROM user_carts"))
      return {
        rows: data.carts.map(c => ({
          user_id: c.user_id,
          product_id: c.product_id,
          product_data: c.product_data ?? { id: c.product_id, name: "snapshot", price: "€999" },
          quantity: c.quantity,
          touched_at: c.touched_at,
          email: c.email,
          full_name: c.full_name ?? "Aoife Ryan",
        })),
      };
    if (sql.includes("content_products"))
      return { rows: [{ value: { items: data.catalog ?? CATALOG } }] };
    if (sql.includes("FROM abandoned_cart_sends")) return { rows: data.sends ?? [] };
    if (sql.includes("FROM cart_reminder_optouts")) return { rows: (data.optOuts ?? []).map(email => ({ email })) };
    if (sql.includes("FROM orders")) return { rows: data.orders ?? [] };
    throw new Error(`unexpected query: ${sql}`);
  },
});

const settings = (over: Record<string, unknown> = {}) => normalizeAbandonedCartSettings({
  enabled: true, delay_hours: 4, max_reminders: 1, followup_hours: 24, cooldown_days: 14, ...over,
});

const oneCart = (over: Partial<StubCart> = {}): StubCart => ({
  user_id: "11111111-1111-1111-1111-111111111111",
  email: "aoife@example.com",
  product_id: "p1",
  quantity: 2,
  touched_at: ago(9),
  ...over,
});

const find = (data: StubData, s = settings()) =>
  findAbandonedCarts(stubPool(data) as never, s, { now: NOW });

describe("what makes a basket abandoned", () => {
  it("counts a basket left alone for longer than the delay", async () => {
    const [cart] = await find({ carts: [oneCart()] });
    expect(cart.is_abandoned).toBe(true);
    expect(cart.due).toBe(true);
    expect(cart.idle_hours).toBe(9);
  });

  it("leaves a basket someone is still filling alone", async () => {
    const [cart] = await find({ carts: [oneCart({ touched_at: ago(1) })] });
    expect(cart.is_abandoned).toBe(false);
    expect(cart.due).toBe(false);
    // Listed anyway, with no complaint — the admin can see them shopping.
    expect(cart.blocked_reason).toBeNull();
  });

  it("dates the basket by its most recent touch, not its oldest row", async () => {
    const [cart] = await find({
      carts: [
        oneCart({ product_id: "p1", touched_at: ago(72) }),
        oneCart({ product_id: "p2", touched_at: ago(1) }),
      ],
    });
    expect(cart.idle_hours).toBe(1);
    expect(cart.due).toBe(false);
  });
});

describe("prices and items come from the live catalogue", () => {
  it("ignores the browser's stale snapshot", async () => {
    const [cart] = await find({
      carts: [oneCart({ product_data: { id: "p1", name: "Old Name", price: "€999" } })],
    });
    expect(cart.items[0].name).toBe("Café Noir");
    expect(cart.items[0].unit_price).toBe(25);
    expect(cart.cart_total).toBe(50);
  });

  it("drops an item the catalogue no longer has, and says how many", async () => {
    const [cart] = await find({
      carts: [oneCart(), oneCart({ product_id: "gone", quantity: 1 })],
    });
    expect(cart.items.map(i => i.product_id)).toEqual(["p1"]);
    expect(cart.missing_products).toBe(1);
  });

  it("skips a basket entirely when nothing in it still exists", async () => {
    expect(await find({ carts: [oneCart({ product_id: "gone" })] })).toEqual([]);
  });

  /** An image an email cannot load is worse than none: it renders as a broken box. */
  it("keeps only https images", async () => {
    const [cart] = await find({ carts: [oneCart(), oneCart({ product_id: "p2", quantity: 1 })] });
    expect(cart.items.find(i => i.product_id === "p1")?.image_url).toBe("https://example.com/a.jpg");
    expect(cart.items.find(i => i.product_id === "p2")?.image_url).toBe("");
  });
});

describe("the guards against emailing someone twice", () => {
  const fingerprintOf = (quantity = 2) => cartFingerprint([{ product_id: "p1", quantity }]);

  it("stops after the configured number of reminders for that basket", async () => {
    const [cart] = await find({
      carts: [oneCart()],
      sends: [{ user_id: oneCart().user_id, cart_fingerprint: fingerprintOf(), reminder_number: 1, sent_at: ago(48) }],
    });
    expect(cart.due).toBe(false);
    expect(cart.blocked_reason).toMatch(/already had 1 reminder/i);
  });

  it("holds a follow-up until the gap has passed", async () => {
    const data: StubData = {
      carts: [oneCart()],
      sends: [{ user_id: oneCart().user_id, cart_fingerprint: fingerprintOf(), reminder_number: 1, sent_at: ago(5) }],
    };
    const [tooSoon] = await find(data, settings({ max_reminders: 2, followup_hours: 24 }));
    expect(tooSoon.due).toBe(false);
    expect(tooSoon.blocked_reason).toMatch(/follow-up isn't due yet/i);

    const [ready] = await find(data, settings({ max_reminders: 2, followup_hours: 4 }));
    expect(ready.due).toBe(true);
    expect(ready.reminders_sent).toBe(1);
  });

  /**
   * The case the fingerprint exists for: a shopper who was emailed, then changed
   * their basket, is a new decision — but only after the cooldown, so "add one,
   * remove one" cannot be walked into an inbox full of reminders.
   */
  it("treats an edited basket as new, but still honours the cooldown", async () => {
    const data: StubData = {
      carts: [oneCart({ quantity: 3 })],
      sends: [{ user_id: oneCart().user_id, cart_fingerprint: fingerprintOf(2), reminder_number: 1, sent_at: ago(24) }],
    };
    const [cooling] = await find(data, settings({ cooldown_days: 14 }));
    expect(cooling.reminders_sent).toBe(0);
    expect(cooling.due).toBe(false);
    expect(cooling.blocked_reason).toMatch(/cooldown/i);

    const [past] = await find(data, settings({ cooldown_days: 0 }));
    expect(past.due).toBe(true);
  });

  it("never emails someone who opted out", async () => {
    const [cart] = await find({ carts: [oneCart()], optOuts: ["aoife@example.com"] });
    expect(cart.due).toBe(false);
    expect(cart.blocked_reason).toMatch(/opted out/i);
  });

  it("says nothing to a shopper who has ordered since", async () => {
    const [cart] = await find({
      carts: [oneCart()],
      orders: [{ user_id: oneCart().user_id, last_order_at: ago(2) }],
    });
    expect(cart.due).toBe(false);
    expect(cart.blocked_reason).toMatch(/ordered since/i);
  });

  it("ignores an order placed before the basket was last touched", async () => {
    const [cart] = await find({
      carts: [oneCart()],
      orders: [{ user_id: oneCart().user_id, last_order_at: ago(30) }],
    });
    expect(cart.due).toBe(true);
  });

  it("holds everything during quiet hours without marking it blocked", async () => {
    // 00:30 in Dublin, inside the default 22:00–08:00 window.
    const night = new Date("2026-08-30T23:30:00Z");
    const [cart] = await findAbandonedCarts(
      stubPool({ carts: [oneCart({ touched_at: new Date(night.getTime() - 9 * HOUR) })] }) as never,
      settings(),
      { now: night },
    );
    expect(cart.quiet_hours).toBe(true);
    expect(cart.is_abandoned).toBe(true);
    expect(cart.due).toBe(false);
    // Not a block — nothing is wrong, it is simply the middle of the night.
    expect(cart.blocked_reason).toBeNull();
  });
});

describe("the basket fingerprint", () => {
  it("does not depend on the order the rows came back in", () => {
    expect(cartFingerprint([{ product_id: "a", quantity: 1 }, { product_id: "b", quantity: 2 }]))
      .toBe(cartFingerprint([{ product_id: "b", quantity: 2 }, { product_id: "a", quantity: 1 }]));
  });

  it("changes when a quantity changes", () => {
    expect(cartFingerprint([{ product_id: "a", quantity: 1 }]))
      .not.toBe(cartFingerprint([{ product_id: "a", quantity: 2 }]));
  });

  it("changes when an item is removed", () => {
    expect(cartFingerprint([{ product_id: "a", quantity: 1 }, { product_id: "b", quantity: 1 }]))
      .not.toBe(cartFingerprint([{ product_id: "a", quantity: 1 }]));
  });
});

describe("who is listed at all", () => {
  it("lists each shopper once, most recently active first", async () => {
    const other = "22222222-2222-2222-2222-222222222222";
    const carts = await find({
      carts: [
        oneCart({ touched_at: ago(30) }),
        oneCart({ product_id: "p2", quantity: 1, touched_at: ago(30) }),
        oneCart({ user_id: other, email: "b@example.com", touched_at: ago(6) }),
      ],
    });
    expect(carts.map(c => c.email)).toEqual(["b@example.com", "aoife@example.com"]);
    expect(carts[1].items).toHaveLength(2);
  });

  it("returns nothing when no basket has anything in it", async () => {
    expect(await find({ carts: [] })).toEqual([]);
  });
});
