import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "@/test/memoryStorage";
import { MAX_CART_QTY } from "./cart";
import type { Product } from "./defaults";
import {
  GUEST_CART_KEY, addGuestItem, clampQty, clearGuestCart, readGuestCart, writeGuestCart,
} from "./guestCart";

/**
 * The basket a shopper fills before they have an account. What these pin down:
 *
 *  • it survives a round trip through localStorage;
 *  • junk in storage (an old shape, a truncated write, a hand-edited value)
 *    yields an empty basket, never a row that crashes the basket page;
 *  • quantities obey the same ceiling the backend enforces;
 *  • storage that throws — Safari private mode, blocked cookies — degrades to an
 *    empty basket rather than taking the storefront down.
 */

installMemoryStorage(); // this jsdom build ships without Web Storage

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  name: `Candle ${id}`,
  description: "",
  price: "24.00",
  image_url: "",
  tag: "",
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("round trip", () => {
  it("reads back what was written", () => {
    writeGuestCart([{ product: product("a"), quantity: 2 }]);
    const items = readGuestCart();
    expect(items).toHaveLength(1);
    expect(items[0].product.id).toBe("a");
    expect(items[0].quantity).toBe(2);
  });

  it("treats an empty basket as no stored key at all", () => {
    writeGuestCart([{ product: product("a"), quantity: 1 }]);
    clearGuestCart();
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
    expect(readGuestCart()).toEqual([]);
  });

  it("has nothing to read before the shopper adds anything", () => {
    expect(readGuestCart()).toEqual([]);
  });
});

describe("hostile / stale stored values", () => {
  it.each([
    ["not JSON", "{oops"],
    ["a JSON object rather than a list", '{"a":1}'],
    ["a bare string", '"nope"'],
    ["null", "null"],
  ])("%s reads as an empty basket", (_label, raw) => {
    localStorage.setItem(GUEST_CART_KEY, raw);
    expect(readGuestCart()).toEqual([]);
  });

  it("drops rows missing the fields the basket renders, keeping the good ones", () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([
      { product: { id: "ok", name: "Fine", price: "10.00" }, quantity: 1 },
      { product: { id: "no-price", name: "Broken" }, quantity: 1 },  // price drives the maths
      { product: { name: "No id", price: "10.00" }, quantity: 1 },   // id is the row key
      { product: { id: "zero", name: "Zero", price: "10.00" }, quantity: 0 },
      { quantity: 3 },
      null,
    ]));
    expect(readGuestCart().map(i => i.product.id)).toEqual(["ok"]);
  });

  it("clamps a quantity someone edited past the server's ceiling", () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([
      { product: { id: "a", name: "A", price: "10.00" }, quantity: 5000 },
    ]));
    expect(readGuestCart()[0].quantity).toBe(MAX_CART_QTY);
  });
});

describe("storage that throws", () => {
  it("reads as empty instead of crashing the page", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readGuestCart()).toEqual([]);
  });

  it("swallows a failed write — the basket still works for this page load", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeGuestCart([{ product: product("a"), quantity: 1 }])).not.toThrow();
  });
});

describe("addGuestItem", () => {
  it("appends a product that isn't in the basket", () => {
    const next = addGuestItem([], product("a"), 2);
    expect(next).toEqual([{ product: product("a"), quantity: 2 }]);
  });

  it("tops up a product already in the basket rather than duplicating the row", () => {
    const next = addGuestItem([{ product: product("a"), quantity: 2 }], product("a"), 3);
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(5);
  });

  it("refreshes the stored snapshot so a re-priced candle doesn't linger", () => {
    const next = addGuestItem(
      [{ product: product("a", { price: "24.00" }), quantity: 1 }],
      product("a", { price: "19.00" }),
      1,
    );
    expect(next[0].product.price).toBe("19.00");
  });

  it("never lets a top-up exceed the ceiling the server enforces", () => {
    const next = addGuestItem([{ product: product("a"), quantity: MAX_CART_QTY }], product("a"), 5);
    expect(next[0].quantity).toBe(MAX_CART_QTY);
  });

  it("leaves other rows untouched", () => {
    const next = addGuestItem(
      [{ product: product("a"), quantity: 1 }, { product: product("b"), quantity: 4 }],
      product("a"),
      1,
    );
    expect(next.find(i => i.product.id === "b")!.quantity).toBe(4);
  });
});

describe("clampQty", () => {
  it.each([
    [0, 1],
    [-3, 1],
    [1.7, 1],
    [NaN, 1],
    [MAX_CART_QTY + 1, MAX_CART_QTY],
    [3, 3],
  ])("clamps %s to %s", (input, expected) => {
    expect(clampQty(input)).toBe(expected);
  });
});
