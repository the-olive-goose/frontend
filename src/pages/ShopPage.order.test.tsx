import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/defaults";

/**
 * The Shop grid's order is an admin decision (Products → Display order), not the
 * order candles happened to be added in — and a category has to agree with the
 * full grid, or the same two candles swap places depending on which pill is on.
 */

const product = (id: string, name: string, display_order?: number | null): Product => ({
  id, name, description: "", price: "25", image_url: "", tag: "",
  ...(display_order === undefined ? {} : { display_order }),
});

// Added oldest-first, numbered in a different order on purpose.
const CATALOGUE = [
  product("p-added-first",  "Espresso",  3),
  product("p-added-second", "Hazelnut",  1),
  product("p-added-third",  "Cinnamon",  2),
  product("p-unnumbered",   "Vanilla"),
];

const CATEGORY = {
  id: "cat-1", name: "Café", slug: "cafe", mood_description: "", tags: [],
  bg_color: "#fff", page_bg_color: "#fff", accent_color: "#6b3520", text_color: "#000",
  stickers: [], is_active: true, display_order: 0,
  // Ticked into the category back-to-front — the grid must ignore this order.
  product_ids: ["p-unnumbered", "p-added-first", "p-added-second"],
};

vi.mock("@/lib/api", () => ({
  getContent: vi.fn((key: string, fallback: unknown) =>
    Promise.resolve(key === "products" ? { label: "", headline: "", subtext: "", items: CATALOGUE } : fallback)),
  getShopCategories: vi.fn(() => Promise.resolve([CATEGORY])),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({
    items: [], addToCart: vi.fn(), removeFromCart: vi.fn(), updateQuantity: vi.fn(),
    clearCart: vi.fn(), count: 0, total: "0",
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), lineItems: vi.fn(() => []) }));
vi.mock("@/hooks/useContent", () => ({
  useContent: (_k: string, fallback: unknown) => ({ data: fallback, ready: true }),
}));

import ShopPage from "./ShopPage";

beforeAll(() => {
  // jsdom has no IntersectionObserver; the grid's impression tracking needs one.
  vi.stubGlobal("IntersectionObserver", class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    root = null; rootMargin = ""; thresholds = [];
  });
  window.scrollTo = vi.fn();
});

const namesInOrder = async (): Promise<string[]> => {
  await waitFor(() => expect(screen.getByText(/candles?$/)).toBeTruthy());
  return CATALOGUE
    .map(p => ({ name: p.name, node: screen.queryByText(p.name) }))
    .filter(entry => entry.node !== null)
    .sort((a, b) =>
      a.node!.compareDocumentPosition(b.node!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
    .map(entry => entry.name);
};

const renderAt = (route: string) =>
  render(<MemoryRouter initialEntries={[route]}><ShopPage /></MemoryRouter>);

describe("shop grid order", () => {
  it("lists the whole catalogue by display order, unnumbered last", async () => {
    renderAt("/shop");
    expect(await namesInOrder()).toEqual(["Hazelnut", "Cinnamon", "Espresso", "Vanilla"]);
  });

  it("uses the same order inside a category, whatever order it was filled in", async () => {
    renderAt("/shop?category=cafe");
    expect(await namesInOrder()).toEqual(["Hazelnut", "Espresso", "Vanilla"]);
  });
});
