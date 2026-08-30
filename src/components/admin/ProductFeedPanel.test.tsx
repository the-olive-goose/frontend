import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProductFeedPanel from "./ProductFeedPanel";
import { DEFAULT_PRODUCT_FEED } from "@/lib/defaults";
import type { Product, PickupSettingsContent, ProductFeedContent } from "@/lib/defaults";

// What this panel is for: telling the owner what the ad platforms are going to
// receive, *before* it is sent. Google and Meta report a bad feed as a
// disapproval days later, with a reason that rarely names the real cause — so
// the promises made here have to be exactly true. A product shown as included
// that the feed then drops is the failure mode worth guarding.

const product = (over: Partial<Product> = {}): Product => ({
  id: "1",
  name: "Iced Matcha Latte Candle",
  description: "Smooth matcha with a cozy creamy finish.",
  price: "25",
  image_url: "https://i.ibb.co/abc/matcha.jpg",
  tag: "BESTSELLER",
  ...over,
});

// The real shipping settings from the live shop — a flat rate under a threshold
// no single candle reaches, which is the case the shipping copy has to get right.
const PICKUP = { flat_shipping_rate: 4.99, free_shipping_threshold: 45 } as unknown as PickupSettingsContent;

const setup = (over: {
  data?: Partial<ProductFeedContent>;
  products?: Product[];
  pickup?: PickupSettingsContent;
} = {}) => {
  const onChange = vi.fn();
  const onSave = vi.fn();
  render(
    <ProductFeedPanel
      data={{ ...DEFAULT_PRODUCT_FEED, ...over.data }}
      products={over.products ?? [product()]}
      pickup={over.pickup ?? PICKUP}
      siteName="The Olive Goose"
      onChange={onChange}
      onSave={onSave}
      saving={false}
    />,
  );
  return { onChange, onSave };
};

describe("ProductFeedPanel", () => {
  it("counts what would actually be sent, not how many products exist", () => {
    setup({ products: [product(), product({ id: "2", price: "0" }), product({ id: "3" })] });
    expect(screen.getByText(/2 of 3 products would be sent/i)).toBeInTheDocument();
  });

  it("names each excluded product and why, so a missing candle is diagnosable here", () => {
    setup({ products: [product({ id: "2", name: "Broken One", image_url: "/uploads/local.jpg" })] });
    expect(screen.getByText(/left out: no image/i)).toBeInTheDocument();
  });

  it("treats a sold-out product as included while it is still being listed", () => {
    setup({ data: { include_out_of_stock: true }, products: [product({ stock: 0 })] });
    expect(screen.getByText(/1 of 1 products would be sent/i)).toBeInTheDocument();
  });

  it("drops it once the owner chooses not to list sold-out stock", () => {
    setup({ data: { include_out_of_stock: false }, products: [product({ stock: 0 })] });
    expect(screen.getByText(/0 of 1 products would be sent/i)).toBeInTheDocument();
    expect(screen.getByText(/left out: out of stock/i)).toBeInTheDocument();
  });

  it("hides the feed address until the feed is actually turned on", () => {
    setup({ data: { enabled: false } });
    expect(screen.queryByText(/feed\.xml/)).not.toBeInTheDocument();
  });

  it("shows the address to paste once it is on", () => {
    setup({ data: { enabled: true } });
    expect(screen.getByText("https://theolivegoose.ie/feed.xml")).toBeInTheDocument();
  });

  it("states the real shipping figure rather than a placeholder", () => {
    setup();
    expect(screen.getByText(/€4\.99/)).toBeInTheDocument();
    expect(screen.getByText(/€45\.00 or more, which is listed as free/)).toBeInTheDocument();
  });

  it("says plainly that no shipping is sent when none is configured", () => {
    setup({ pickup: {} as PickupSettingsContent });
    expect(screen.getByText(/No shipping rate is set in Pickup & Delivery/i)).toBeInTheDocument();
  });

  it("falls back to the site name for the brand", () => {
    setup({ data: { brand: "" } });
    expect(screen.getByText(/sent as “The Olive Goose”/)).toBeInTheDocument();
  });

  it("uses an explicit brand once one is set", () => {
    setup({ data: { brand: "Olive Goose Candles" } });
    expect(screen.getByText(/sent as “Olive Goose Candles”/)).toBeInTheDocument();
  });

  it("reports a change without mutating the object it was handed", () => {
    const data = { ...DEFAULT_PRODUCT_FEED };
    const onChange = vi.fn();
    render(
      <ProductFeedPanel
        data={data}
        products={[product()]}
        pickup={PICKUP}
        siteName="The Olive Goose"
        onChange={onChange}
        onSave={vi.fn()}
        saving={false}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Publish the product feed/i));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_PRODUCT_FEED, enabled: true });
    expect(data.enabled).toBe(false);
  });

  it("keeps the barcode switch off by default — on is what gets a feed rejected", () => {
    setup();
    expect(screen.getByLabelText(/These products have barcodes/i)).not.toBeChecked();
  });

  it("copes with an empty catalogue instead of showing a bare zero", () => {
    setup({ products: [] });
    expect(screen.getByText(/No products in the catalogue yet/i)).toBeInTheDocument();
  });
});
