import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ProductCard from "./ProductCard";
import type { Product } from "@/lib/defaults";

/**
 * How a product photo is fetched.
 *
 * `loading="lazy"` reads to the browser as "this can wait": the preload scanner
 * skips it, it cannot start until layout has run, and it is queued at Low
 * priority behind every script on the page. That is the right trade for a card
 * further down a rail and the wrong one for a card the shopper is already
 * looking at — which is what made the top of the shop grid fill in a beat after
 * the rest of the page. These tests hold both halves of that.
 */

vi.mock("@/contexts/CartContext", () => ({ useCart: () => ({ addToCart: vi.fn() }) }));

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Iced Vanilla Latte",
  description: "A candle",
  price: 24,
  image_url: "https://example.com/candle.jpg",
  ...over,
} as Product);

const renderCard = (props: Partial<React.ComponentProps<typeof ProductCard>> = {}) => {
  const { container } = render(
    <MemoryRouter>
      <ProductCard product={product()} idx={0} accent="#1d2b1b" {...props} />
    </MemoryRouter>,
  );
  const img = container.querySelector('a[aria-label^="View "] img');
  if (!img) throw new Error("product card rendered no photo");
  return img;
};

describe("ProductCard photo loading", () => {
  it("defers a photo that has not been scrolled to", () => {
    const img = renderCard();
    expect(img.getAttribute("loading")).toBe("lazy");
    // No hint at all, rather than an explicit low one: an un-prioritised lazy
    // image is exactly what we want the browser's own heuristics to handle.
    expect(img.getAttribute("fetchpriority")).toBeNull();
  });

  it("fetches a photo that is already on screen straight away", () => {
    const img = renderCard({ priority: true });
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
  });

  it("keeps deferring by default, so a rail below the fold costs nothing", () => {
    // The guard that matters: priority is opt-in. If this ever defaults to true,
    // every card on every rail loads at page open and the homepage pays for all
    // of them — see VideosSection.test.tsx for the same rule about reels.
    for (const idx of [0, 1, 5, 30]) {
      expect(renderCard({ idx }).getAttribute("loading"), `card ${idx}`).toBe("lazy");
    }
  });

  it("still shows a photo for a product that has none of its own", () => {
    const img = renderCard({ product: product({ image_url: "" }) });
    expect(img.getAttribute("src")).toBeTruthy();
  });
});
