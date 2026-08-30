import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ProductTestimonial } from "@/lib/defaults";
import ProductTestimonials from "./ProductTestimonials";

/**
 * The visible half of the product-page quotes. The rating maths itself is pinned
 * in lib/productTestimonials.test.ts — what matters here is that the stars a
 * visitor sees come from the same clamp the structured data uses, so the page
 * and the Google snippet can never claim different things.
 */

const quote = (over: Partial<ProductTestimonial> = {}): ProductTestimonial => ({
  id: "q1",
  product_id: "1",
  quote: "Smells exactly like my morning flat white.",
  author: "Sarah M.",
  location: "Dublin",
  rating: 5,
  ...over,
});

afterEach(cleanup);

describe("ProductTestimonials", () => {
  it("renders nothing at all when the candle has no quotes", () => {
    const { container } = render(<ProductTestimonials items={[]} headline="What people say" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the headline and each quote", () => {
    render(
      <ProductTestimonials
        headline="What people say about this one"
        items={[quote({ id: "a" }), quote({ id: "b", quote: "Bought a second one.", author: "James K." })]}
      />,
    );
    expect(screen.getByText("What people say about this one")).toBeInTheDocument();
    expect(screen.getByText(/morning flat white/)).toBeInTheDocument();
    expect(screen.getByText("Bought a second one.")).toBeInTheDocument();
    expect(screen.getByText("Sarah M.")).toBeInTheDocument();
    expect(screen.getByText("James K.")).toBeInTheDocument();
  });

  it("labels the stars for screen readers with the real rating", () => {
    render(<ProductTestimonials headline="H" items={[quote({ rating: 4 })]} />);
    expect(screen.getByLabelText("4 out of 5 stars")).toBeInTheDocument();
  });

  // The display side of the same rule the aggregate follows: an unrated quote is
  // still worth showing, but it must not draw five stars it never earned.
  it("draws no stars for a quote with no usable rating", () => {
    render(
      <ProductTestimonials
        headline="H"
        items={[quote({ rating: undefined as unknown as number })]}
      />,
    );
    expect(screen.getByText(/morning flat white/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/out of 5 stars/)).not.toBeInTheDocument();
  });

  it("clamps a nonsense rating rather than painting it", () => {
    render(<ProductTestimonials headline="H" items={[quote({ rating: 50 })]} />);
    // 50 is not a usable rating, so no star row is drawn at all.
    expect(screen.queryByLabelText(/out of 5 stars/)).not.toBeInTheDocument();
  });

  it("omits the location separator when there is no location", () => {
    render(<ProductTestimonials headline="H" items={[quote({ location: "" })]} />);
    expect(screen.getByText("Sarah M.")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("renders an avatar only when one is set", () => {
    const { container, rerender } = render(
      <ProductTestimonials headline="H" items={[quote()]} />,
    );
    expect(container.querySelector("img")).toBeNull();

    rerender(
      <ProductTestimonials
        headline="H"
        items={[quote({ avatarUrl: "https://res.cloudinary.com/x/image/fetch/a.jpg" })]}
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    // Decorative: the name sits beside it, so an alt would just repeat it.
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("falls back to a neutral name rather than printing nothing", () => {
    render(<ProductTestimonials headline="H" items={[quote({ author: "" })]} />);
    expect(screen.getByText("A customer")).toBeInTheDocument();
  });
});
