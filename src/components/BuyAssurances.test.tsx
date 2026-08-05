import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BuyAssurances from "./BuyAssurances";
import { DEFAULT_CONTENT, type ProductAssurancesContent } from "@/lib/defaults";
import { resolveOfferValues } from "@/lib/offerTokens";

/**
 * The three lines under the buy button are the last thing read before a shopper
 * commits, so what matters is that they say what the shop actually does:
 *
 *  • the shipping line is resolved against the live Pickup & Delivery settings,
 *    never against the bundled defaults;
 *  • the admin's own wording ships — no line is rewritten at render time;
 *  • a row with detail opens on tap, one at a time;
 *  • a row WITHOUT detail is not a button — a control that opens nothing is a
 *    worse answer than plain text;
 *  • an emptied headline drops its row instead of leaving an orphan badge.
 */

const assurances = (o: Partial<ProductAssurancesContent> = {}): ProductAssurancesContent => ({
  ...DEFAULT_CONTENT.productPage.assurances,
  ...o,
});

// A shop configured differently from the bundled defaults, so a component that
// quietly read DEFAULT_CONTENT instead of these values would fail.
const liveOffer = resolveOfferValues(
  { free_shipping_threshold: 40, flat_shipping_rate: 3.5 },
  { discount_percent: 5 },
);

describe("BuyAssurances", () => {
  it("quotes the live shipping rate and free-shipping bar", () => {
    render(<BuyAssurances data={assurances()} offer={liveOffer} />);
    expect(screen.getByText("€3.50 shipping — free on orders over €40")).toBeInTheDocument();
    expect(screen.queryByText(/€4\.99|€65/)).toBeNull();
  });

  it("says free rather than €0 when the shop charges nothing", () => {
    const free = resolveOfferValues({ free_shipping_threshold: 0, flat_shipping_rate: 0 }, {});
    render(<BuyAssurances data={assurances()} offer={free} />);
    expect(screen.getByText("Free shipping on all orders")).toBeInTheDocument();
  });

  it("renders the admin's delivery time and returns wording verbatim", () => {
    render(
      <BuyAssurances
        data={assurances({ delivery_text: "ships next day from Dublin", returns_text: "free returns for 60 days" })}
        offer={liveOffer}
      />,
    );
    expect(screen.getByText("ships next day from Dublin")).toBeInTheDocument();
    expect(screen.getByText("free returns for 60 days")).toBeInTheDocument();
  });

  // The closed panel stays in the DOM so it can animate — so "closed" has to
  // mean invisible to eyes AND to assistive tech, not merely clipped.
  it("opens a row's detail on tap and closes it again", () => {
    render(<BuyAssurances data={assurances()} offer={liveOffer} />);
    const row = screen.getByRole("button", { name: /at your door in 3–7 days/i });
    const detail = screen.getByText(/hand-poured in Dublin/i);

    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(detail).not.toBeVisible();

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(detail).toBeVisible();

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(detail).not.toBeVisible();
  });

  // Three panels open at once reads as the page coming apart.
  it("keeps only one row open at a time", () => {
    render(<BuyAssurances data={assurances()} offer={liveOffer} />);
    const delivery = screen.getByRole("button", { name: /at your door/i });
    const returns  = screen.getByRole("button", { name: /no drama/i });

    fireEvent.click(delivery);
    fireEvent.click(returns);

    expect(delivery).toHaveAttribute("aria-expanded", "false");
    expect(returns).toHaveAttribute("aria-expanded", "true");
  });

  it("renders a row with no detail as plain text, not as a dead button", () => {
    render(<BuyAssurances data={assurances({ returns_detail: "" })} offer={liveOffer} />);
    expect(screen.queryByRole("button", { name: /no drama/i })).toBeNull();
    expect(screen.getByText(/no drama/i)).toBeInTheDocument();
  });

  it("drops a row the admin has emptied", () => {
    render(<BuyAssurances data={assurances({ returns_text: "" })} offer={liveOffer} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).queryByText(/no drama/i)).toBeNull();
  });

  it("renders nothing at all when switched off", () => {
    const { container } = render(<BuyAssurances data={assurances({ enabled: false })} offer={liveOffer} />);
    expect(container).toBeEmptyDOMElement();
  });
});
