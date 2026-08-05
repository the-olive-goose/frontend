import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "@/test/memoryStorage";
import type { Product } from "@/lib/defaults";
import { GUEST_CART_KEY } from "@/lib/guestCart";

/**
 * The basket has two backings — localStorage while signed out, the account once
 * signed in — and the whole point of the split is that a shopper never notices
 * it. What these pin down:
 *
 *  • a signed-out shopper can add, change and remove without a single API call;
 *  • that basket survives a reload;
 *  • signing in moves it onto the account instead of throwing it away — the
 *    failure this feature exists to prevent;
 *  • a merge that fails keeps the local copy rather than losing the basket;
 *  • signing out doesn't leave the previous shopper's items on screen.
 */

installMemoryStorage(); // this jsdom build ships without Web Storage

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

vi.mock("@/lib/userApi", () => ({
  fetchCart: vi.fn(async () => []),
  apiAddToCart: vi.fn(async () => {}),
  apiUpdateCartItem: vi.fn(async () => {}),
  apiRemoveCartItem: vi.fn(async () => {}),
  apiClearCart: vi.fn(async () => {}),
}));

let authState: { user: { id: string } | null; loading: boolean } = { user: null, loading: false };
vi.mock("./AuthContext", () => ({ useAuth: () => authState }));

const { fetchCart, apiAddToCart, apiUpdateCartItem, apiRemoveCartItem, apiClearCart } =
  await import("@/lib/userApi");
const { CartProvider, useCart } = await import("./CartContext");

const product = (id: string, price = "24.00"): Product => ({
  id, name: `Candle ${id}`, description: "", price, image_url: "", tag: "",
});

// A window onto the context: renders the basket and exposes the mutators the
// storefront's buttons call.
let cart: ReturnType<typeof useCart>;
const Probe = () => {
  cart = useCart();
  return (
    <ul data-testid="items">
      {cart.items.map(i => <li key={i.product.id}>{`${i.product.id}:${i.quantity}`}</li>)}
    </ul>
  );
};

const renderCart = () => render(<CartProvider><Probe /></CartProvider>);
const rows = () => Array.from(screen.getByTestId("items").children).map(li => li.textContent);
const stored = () => JSON.parse(localStorage.getItem(GUEST_CART_KEY) ?? "[]");

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(fetchCart).mockResolvedValue([]);
  vi.mocked(apiAddToCart).mockResolvedValue(undefined as never);
  authState = { user: null, loading: false };
});

describe("signed out", () => {
  it("adds to the basket without calling the server", async () => {
    renderCart();
    await act(async () => { await cart.addToCart(product("a"), 2); });

    expect(rows()).toEqual(["a:2"]);
    expect(apiAddToCart).not.toHaveBeenCalled();
    expect(stored()).toHaveLength(1);
  });

  it("keeps every item when a bundle adds several in one loop", async () => {
    renderCart();
    await act(async () => {
      for (const p of [product("a"), product("b"), product("c")]) await cart.addToCart(p);
    });

    // The bug this guards: reading React state inside the loop sees the same
    // pre-loop snapshot each pass, so only the last add survives.
    expect(rows()).toEqual(["a:1", "b:1", "c:1"]);
  });

  it("tops up rather than duplicating a product already in the basket", async () => {
    renderCart();
    await act(async () => { await cart.addToCart(product("a"), 1); });
    await act(async () => { await cart.addToCart(product("a"), 2); });

    expect(rows()).toEqual(["a:3"]);
  });

  it("changes quantity and removes without the server", async () => {
    renderCart();
    await act(async () => { await cart.addToCart(product("a"), 1); });
    await act(async () => { await cart.updateQuantity("a", 4); });
    expect(rows()).toEqual(["a:4"]);

    await act(async () => { await cart.removeFromCart("a"); });
    expect(rows()).toEqual([]);
    expect(apiUpdateCartItem).not.toHaveBeenCalled();
    expect(apiRemoveCartItem).not.toHaveBeenCalled();
  });

  it("treats a drop to zero as a removal", async () => {
    renderCart();
    await act(async () => { await cart.addToCart(product("a"), 2); });
    await act(async () => { await cart.updateQuantity("a", 0); });

    expect(rows()).toEqual([]);
  });

  it("clears locally", async () => {
    renderCart();
    await act(async () => { await cart.addToCart(product("a")); });
    await act(async () => { await cart.clearCart(); });

    expect(rows()).toEqual([]);
    expect(apiClearCart).not.toHaveBeenCalled();
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
  });

  it("still has the basket after a reload", async () => {
    const first = renderCart();
    await act(async () => { await cart.addToCart(product("a"), 3); });
    first.unmount();

    renderCart();
    expect(rows()).toEqual(["a:3"]);
  });
});

describe("signing in", () => {
  it("moves the guest basket onto the account and stops storing it locally", async () => {
    const view = renderCart();
    await act(async () => {
      await cart.addToCart(product("a"), 2);
      await cart.addToCart(product("b"), 1);
    });

    vi.mocked(fetchCart).mockResolvedValue([
      { product_id: "a", product_data: product("a"), quantity: 2 },
      { product_id: "b", product_data: product("b"), quantity: 1 },
    ] as never);

    authState = { user: { id: "u1" }, loading: false };
    await act(async () => { view.rerender(<CartProvider><Probe /></CartProvider>); });

    await waitFor(() => expect(apiAddToCart).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiAddToCart).mock.calls.map(c => [c[0], c[2]])).toEqual([["a", 2], ["b", 1]]);
    await waitFor(() => expect(rows()).toEqual(["a:2", "b:1"]));
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
  });

  it("merges once even when the effect runs twice for the same sign-in", async () => {
    const view = renderCart();
    await act(async () => { await cart.addToCart(product("a"), 1); });

    authState = { user: { id: "u1" }, loading: false };
    // Two passes for one sign-in — StrictMode in dev, an auth revalidation in
    // production. Adding the basket twice would double every quantity.
    await act(async () => { view.rerender(<CartProvider><Probe /></CartProvider>); });
    await act(async () => { view.rerender(<CartProvider><Probe /></CartProvider>); });

    await waitFor(() => expect(apiAddToCart).toHaveBeenCalledTimes(1));
  });

  it("re-arms after a sign-out, so the next guest basket merges too", async () => {
    authState = { user: { id: "u1" }, loading: false };
    const view = renderCart();
    await waitFor(() => expect(fetchCart).toHaveBeenCalled());

    authState = { user: null, loading: false };
    await act(async () => { view.rerender(<CartProvider><Probe /></CartProvider>); });
    await act(async () => { await cart.addToCart(product("z"), 1); });

    authState = { user: { id: "u1" }, loading: false };
    await act(async () => { view.rerender(<CartProvider><Probe /></CartProvider>); });

    await waitFor(() => expect(apiAddToCart).toHaveBeenCalledWith("z", expect.anything(), 1));
  });

  it("keeps the local copy when the merge fails, so the basket isn't lost", async () => {
    const view = renderCart();
    await act(async () => { await cart.addToCart(product("a"), 1); });

    vi.mocked(apiAddToCart).mockRejectedValue(new Error("offline"));
    authState = { user: { id: "u1" }, loading: false };
    await act(async () => { view.rerender(<CartProvider><Probe /></CartProvider>); });

    await waitFor(() => expect(apiAddToCart).toHaveBeenCalled());
    expect(stored()).toHaveLength(1);
  });

  it("waits for the auth check before deciding which basket is real", async () => {
    authState = { user: null, loading: true };
    renderCart();

    await waitFor(() => expect(fetchCart).not.toHaveBeenCalled());
  });
});

describe("signed in", () => {
  it("routes changes through the server", async () => {
    authState = { user: { id: "u1" }, loading: false };
    renderCart();
    await waitFor(() => expect(fetchCart).toHaveBeenCalled());

    await act(async () => { await cart.addToCart(product("a"), 2); });
    expect(apiAddToCart).toHaveBeenCalledWith("a", expect.objectContaining({ id: "a" }), 2);
    expect(stored()).toEqual([]);

    await act(async () => { await cart.updateQuantity("a", 5); });
    expect(apiUpdateCartItem).toHaveBeenCalledWith("a", 5);
  });

  it("empties the basket on sign-out instead of showing the last shopper's items", async () => {
    authState = { user: { id: "u1" }, loading: false };
    vi.mocked(fetchCart).mockResolvedValue([
      { product_id: "a", product_data: product("a"), quantity: 1 },
    ] as never);
    const view = renderCart();
    await waitFor(() => expect(rows()).toEqual(["a:1"]));

    authState = { user: null, loading: false };
    await act(async () => { view.rerender(<CartProvider><Probe /></CartProvider>); });

    await waitFor(() => expect(rows()).toEqual([]));
  });
});
