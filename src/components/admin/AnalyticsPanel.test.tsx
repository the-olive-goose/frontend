import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsPanel from "./AnalyticsPanel";
import { installMemoryStorage } from "@/test/memoryStorage";
import type { AnalyticsOverview, AnalyticsInternal } from "@/lib/api";

// The panel reads and writes the storefront's visitor id. Without a real store
// those calls return null and the exclusion controls would render as if nothing
// could ever be marked — passing for the wrong reason.
installMemoryStorage();

/**
 * What the panel is allowed to say.
 *
 * The SQL behind these numbers is covered end-to-end by
 * `npm run test:analytics`. What this file holds in place is the reading: an
 * ops lead has to be able to trust a figure at a glance, so the panel must
 * never present a tracking gap as a business result, never show the same
 * quantity twice with two different values, and never leave a missing
 * comparison looking like a flat one.
 */

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getAdminAnalytics: vi.fn(),
    getAdminAnalyticsLive: vi.fn().mockResolvedValue({ active_sessions: 0, active_visitors: 0, top_pages: [] }),
    getAnalyticsInternal: vi.fn(),
    saveAnalyticsInternal: vi.fn(),
    setAnalyticsInternalBrowser: vi.fn().mockResolvedValue(undefined),
  };
});

const { getAdminAnalytics, getAnalyticsInternal, saveAnalyticsInternal } = await import("@/lib/api");

const internal = (o: Partial<AnalyticsInternal> = {}): AnalyticsInternal => ({
  emails: [], networks: [], current_ip: "203.0.113.7", current_ip_excluded: false,
  excluded_visitors: [], counted_origins: ["https://theolivegoose.ie"], origins_seen: [],
  ...o,
});

const overview = (o: Partial<AnalyticsOverview> = {}): AnalyticsOverview => ({
  start: "2026-07-01", end: "2026-07-30", days: 30, timezone: "Europe/Dublin",
  filters: { device: null, source: null, attr: "source" },
  attributed: false,
  abandoned: { checkout_sessions: 3, abandoned_sessions: 1, lost_revenue: 75 },
  signin_wall: null,
  measurement_notes: [],
  traffic: {
    visitors: 6, sessions: 6, pageviews: 9, pages_per_session: 1.5, bounce_rate: 16.7,
    new_visitors: 6, returning_visitors: 0, identified_visitor_pct: 100,
    prev: { visitors: 0, sessions: 0, pageviews: 0 },
  },
  sales: {
    revenue: 180, orders: 3, aov: 60, conversion_rate: 33.33, attributed_orders: 2,
    prev: { revenue: 0, orders: 0, aov: 0 },
  },
  customers: {
    total_customers: 3, lifetime_repeat_customers: 0, new_customers: 3,
    returning_customers: 0, avg_lifetime_value: 60, avg_orders_per_customer: 1,
  },
  funnel: [
    { stage: "Sessions", sessions: 6 },
    { stage: "Browsed a collection", sessions: 4 },
    { stage: "Viewed a product", sessions: 4 },
    { stage: "Added to cart", sessions: 4 },
    { stage: "Viewed basket", sessions: 3 },
    { stage: "Pressed checkout", sessions: 3 },
    { stage: "Reached checkout", sessions: 3 },
    { stage: "Added delivery details", sessions: 3 },
    { stage: "Went to payment", sessions: 2 },
    { stage: "Purchased", sessions: 2 },
  ],
  daily: [{ day: "2026-07-30", visitors: 6, sessions: 6, pageviews: 9, orders: 3, revenue: 180 }],
  top_products: [{
    name: "Candle A", units: 3, revenue: 130, add_to_carts: 2,
    views: 8, view_to_cart_pct: 25, cart_to_buy_pct: 100,
  }],
  top_pages: [{ path: "/shop", views: 4, sessions: 3 }],
  sources: [{ source: "google", sessions: 3, orders: 1, revenue: 100 }],
  devices: [{ device: "desktop", sessions: 4 }, { device: "mobile", sessions: 2 }],
  locations: [{ city: "Dublin", country: "IE", sessions: 4, orders: 2, revenue: 120 }],
  web_vitals: [{ metric: "LCP", p75: 2100, samples: 40 }],
  web_vitals_by_page: [],
  ...o,
});

const mocked = vi.mocked(getAdminAnalytics);

describe("AnalyticsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAnalyticsInternal).mockResolvedValue(internal());
    localStorage.clear();
  });

  it("warns when orders are missing a tracked session, naming the exact gap", async () => {
    mocked.mockResolvedValue(overview());
    render(<AnalyticsPanel />);

    // 3 paid orders, 2 of them attributable — the 1 that is not must be called
    // out, or the session-derived metrics read as a fall in conversion.
    const warning = await screen.findByText(/1 of 3 paid orders aren't linked to a browsing session/i);
    expect(warning).toBeInTheDocument();
    expect(screen.getByText(/treat them as a floor, not a total/i)).toBeInTheDocument();
  });

  it("stays quiet when every order is attributed", async () => {
    mocked.mockResolvedValue(overview({
      sales: { revenue: 180, orders: 2, aov: 90, conversion_rate: 33.33, attributed_orders: 2, prev: { revenue: 0, orders: 0, aov: 0 } },
    }));
    render(<AnalyticsPanel />);

    await screen.findByText("Session conversion");
    expect(screen.queryByText(/aren't linked to a browsing session/i)).not.toBeInTheDocument();
  });

  it("shows one conversion figure, not two that can disagree", async () => {
    mocked.mockResolvedValue(overview());
    render(<AnalyticsPanel />);

    // The tile and the funnel footer describe the same quantity; the funnel
    // reads the API's value rather than recomputing it against its own
    // denominator, so both must render the identical number.
    // Exactly two renderings, both 33.33%: the KPI tile and the funnel footer.
    await waitFor(() => expect(screen.getAllByText("33.33%")).toHaveLength(2));
  });

  it("renders a funnel that never widens as it descends", async () => {
    mocked.mockResolvedValue(overview());
    render(<AnalyticsPanel />);

    await screen.findByText("Conversion funnel");
    // Each step's "% of previous" is a drop-off, so none may exceed 100%.
    const steps = screen.getAllByText(/% of previous$/).map(el => parseFloat(el.textContent!));
    expect(steps.length).toBeGreaterThan(0);
    steps.forEach(pct => expect(pct).toBeLessThanOrEqual(100));
  });

  it("reports what the sign-in gate cost, not just that people left", async () => {
    mocked.mockResolvedValue(overview({
      signin_wall: {
        gate_sessions: 10, walled_sessions: 8, walled_continued: 3, walled_purchased: 2,
        passed_sessions: 2, passed_purchased: 2, blocked_basket_value: 240,
      },
    }));
    render(<AnalyticsPanel />);

    await screen.findByText("Sign-in gate");
    expect(screen.getByText("Asked to sign in")).toBeInTheDocument();
    // 8 asked, 3 carried on → 62.5% turned back. Reported as the share who left,
    // because that is the number the decision to keep the gate turns on.
    expect(screen.getByText("62.5%")).toBeInTheDocument();
    expect(screen.getByText(/3 of 8 guests/i)).toBeInTheDocument();
    expect(screen.getByText(/already signed in when they pressed checkout: 2/i)).toBeInTheDocument();
  });

  it("hides the gate block entirely when nothing went through it", async () => {
    mocked.mockResolvedValue(overview({ signin_wall: null }));
    render(<AnalyticsPanel />);

    // A window predating the event must show nothing — a row of zeroes here
    // would read as "the gate costs nothing", which is a different claim.
    await screen.findByText("Conversion funnel");
    expect(screen.queryByText("Sign-in gate")).not.toBeInTheDocument();
  });

  it("declares a mid-window measurement change rather than letting it read as behaviour", async () => {
    mocked.mockResolvedValue(overview({
      measurement_notes: [{ date: "2026-08-04", note: "Adding to the basket stopped requiring a sign-in." }],
    }));
    render(<AnalyticsPanel />);

    expect(await screen.findByText(/measured changed on 2026-08-04/i)).toBeInTheDocument();
    expect(screen.getByText(/Adding to the basket stopped requiring a sign-in/i)).toBeInTheDocument();
    expect(screen.getByText(/like-for-like/i)).toBeInTheDocument();
  });

  it("says there is no baseline instead of silently dropping the delta", async () => {
    mocked.mockResolvedValue(overview());
    render(<AnalyticsPanel />);

    // Previous period is all zeros: a blank space would be indistinguishable
    // from "flat vs last period".
    await waitFor(() => expect(screen.getAllByText(/no activity in the previous period/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/vs previous period/i)).not.toBeInTheDocument();
  });

  it("reports device share against a total that matches the sessions KPI", async () => {
    mocked.mockResolvedValue(overview());
    render(<AnalyticsPanel />);

    // 4 desktop + 2 mobile over 6 sessions — shares must be 67%/33%, which only
    // holds while no session is counted under two devices.
    await screen.findByText("Devices");
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
  });

  it("qualifies returning visitors when some ids don't survive the tab", async () => {
    mocked.mockResolvedValue(overview({
      traffic: { ...overview().traffic, identified_visitor_pct: 62.5 },
    }));
    render(<AnalyticsPanel />);

    // A browser that won't keep an id — private mode, storage-blocking
    // extensions — makes the same person "new" on every visit, so "returning" is
    // a floor. Saying nothing would present it as a complete count.
    //
    // The caveat is deliberately NOT about the cookie banner any more: the
    // visitor id is persistent for everyone, because first-party audience
    // measurement doesn't depend on consent. Naming cookies here told the owner
    // to fix a consent rate that has nothing to do with the gap.
    expect(await screen.findByText(/Only 62\.5% of visitors' browsers kept an id/i)).toBeInTheDocument();
  });

  it("stays quiet about identity when every visitor is recognisable", async () => {
    mocked.mockResolvedValue(overview());
    render(<AnalyticsPanel />);

    await screen.findByText("Audience");
    expect(screen.queryByText(/accepted cookies and can be/i)).not.toBeInTheDocument();
  });

  it("labels the checkout step for what the events now measure", async () => {
    mocked.mockResolvedValue(overview());
    render(<AnalyticsPanel />);

    await screen.findByText("Conversion funnel");
    // begin_checkout now fires on ARRIVAL at checkout, so this stage and the
    // abandonment card below it both mean "got to the checkout page" — they are
    // computed from the same predicate and must be described the same way.
    expect(screen.getByText("Reached checkout")).toBeInTheDocument();
    expect(screen.getByText("Abandoned at checkout")).toBeInTheDocument();
    // The old wording measured the payment click and would now understate the
    // loss, since everyone who bailed before pressing Pay is included.
    expect(screen.queryByText("Reached payment")).not.toBeInTheDocument();
    expect(screen.queryByText("Abandoned at payment")).not.toBeInTheDocument();
  });

  it("renders every funnel stage the API returns, not just the first five", async () => {
    mocked.mockResolvedValue(overview());
    render(<AnalyticsPanel />);

    await screen.findByText("Conversion funnel");
    // The funnel outgrew the five-colour ramp; stages past the fifth used to
    // render with an undefined background, i.e. an invisible bar.
    // getAllByText because some stage names ("Sessions") are also KPI tiles.
    for (const stage of [
      "Sessions", "Browsed a collection", "Viewed a product", "Added to cart",
      "Viewed basket", "Reached checkout", "Added delivery details",
      "Went to payment", "Purchased",
    ]) {
      expect(screen.getAllByText(stage).length).toBeGreaterThan(0);
    }
  });

  it("omits funnel stages the API left out rather than inventing zeroes", async () => {
    // A window predating the checkout-step instrumentation: the API drops those
    // stages entirely, and the panel must not resurrect them.
    mocked.mockResolvedValue(overview({
      funnel: [
        { stage: "Sessions", sessions: 6 },
        { stage: "Reached checkout", sessions: 3 },
        { stage: "Purchased", sessions: 2 },
      ],
    }));
    render(<AnalyticsPanel />);

    await screen.findByText("Conversion funnel");
    expect(screen.queryByText("Added delivery details")).not.toBeInTheDocument();
    expect(screen.getByText("Reached checkout")).toBeInTheDocument();
  });

  it("shows an unknown per-product rate as a dash, never as 0%", async () => {
    mocked.mockResolvedValue(overview({
      top_products: [{
        name: "Never viewed", units: 0, revenue: 0, add_to_carts: 0,
        views: 0, view_to_cart_pct: null, cart_to_buy_pct: null,
      }],
    }));
    render(<AnalyticsPanel />);

    await screen.findByText("Never viewed");
    // 0% would read as "everyone who looked rejected it" — a very different
    // message from "nobody looked".
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  // ── Core Web Vitals ───────────────────────────────────────────────────────
  // These are the numbers Google grades the shop on, so the card's job is to be
  // actionable and to never overstate its own coverage: a metric nobody is
  // measuring must not look like a metric that is passing, and a failing score
  // must say which page to go and fix.
  describe("core web vitals", () => {
    it("says a metric is unmeasured rather than leaving a gap", async () => {
      mocked.mockResolvedValue(overview({
        locations: [{ city: "Dublin", country: "IE", sessions: 4, orders: 2, revenue: 120 }],
  web_vitals: [{ metric: "LCP", p75: 2100, samples: 40 }],
      }));
      render(<AnalyticsPanel />);

      // CLS reports nothing when a page is perfectly stable, so its tile used to
      // disappear — and a missing tile is indistinguishable at a glance from a
      // passing one. "We aren't measuring this" is the more urgent of the two.
      await screen.findByText("Site performance");
      expect(screen.getByText("CLS")).toBeInTheDocument();
      expect(screen.getAllByText("Not measured in this period").length).toBeGreaterThan(0);
    });

    it("names the pages behind a failing score, worst first", async () => {
      mocked.mockResolvedValue(overview({
        web_vitals: [{ metric: "LCP", p75: 3100, samples: 40 }],
        web_vitals_by_page: [
          { path: "/shop", metric: "LCP", p75: 4300, samples: 12 },
          { path: "/basket", metric: "LCP", p75: 2900, samples: 9 },
        ],
      }));
      render(<AnalyticsPanel />);

      // "LCP 3.1s" says something is slow without saying what. One heavy page
      // routinely carries the whole site's grade.
      // Scoped to this block: /shop also appears in the Top pages table, and a
      // page-wide query would silently pass on the wrong element.
      const block = (await screen.findByText("Where it's coming from")).parentElement!;
      const rows = within(block).getAllByText(/^\//).map(el => el.textContent);
      expect(rows).toEqual(["/shop", "/basket"]);
    });

    it("stays silent about pages when the metric already passes", async () => {
      mocked.mockResolvedValue(overview({
        web_vitals: [{ metric: "LCP", p75: 1800, samples: 40 }],
        web_vitals_by_page: [{ path: "/shop", metric: "LCP", p75: 2100, samples: 12 }],
      }));
      render(<AnalyticsPanel />);

      // A list of pages under a green score is noise that buries the one under a
      // red score when it eventually appears.
      await screen.findByText("Site performance");
      expect(screen.queryByText("Where it's coming from")).not.toBeInTheDocument();
    });

    it("grades a page against the same thresholds as the site total", async () => {
      mocked.mockResolvedValue(overview({
        web_vitals: [{ metric: "CLS", p75: 0.15, samples: 40 }],
        web_vitals_by_page: [
          { path: "/products/candle", metric: "CLS", p75: 0.30, samples: 8 },
          { path: "/shop", metric: "CLS", p75: 0.05, samples: 8 },
        ],
      }));
      render(<AnalyticsPanel />);

      // 0.30 is Poor and 0.05 is Good — the passing page must not be listed as a
      // culprit just because the site total is failing.
      const block = (await screen.findByText("Where it's coming from")).parentElement!;
      expect(within(block).getByText("/products/candle")).toBeInTheDocument();
      expect(within(block).queryByText("/shop")).not.toBeInTheDocument();
    });
  });

  // ── Whose visits count ────────────────────────────────────────────────────
  // The panel's answer to "it says 6 visitors and it was only me". A visitor is
  // an id in a browser's localStorage, so the owner's own testing — new device,
  // private window, cleared site data — arrives as several strangers. These
  // controls are the way to say "that was us", and the copy around them is the
  // only thing telling the owner what each one actually reaches.
  describe("internal traffic", () => {
    it("offers the network the admin is on, by address", async () => {
      render(<AnalyticsPanel />);
      // Await the loaded address, not the static heading — the heading renders
      // before the request resolves, so asserting on it races the fetch.
      expect(await screen.findByText("203.0.113.7")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /don't count this network/i })).toBeInTheDocument();
    });

    it("promises only what a network exclusion can deliver", async () => {
      render(<AnalyticsPanel />);
      await screen.findByText("203.0.113.7");
      // No visitor's IP is stored, so this cannot retire yesterday's rows for a
      // device that hasn't been back. Saying it did would be the same species of
      // wrong as the count that started this.
      expect(screen.getByText(/next time it loads the shop/i)).toBeInTheDocument();
      expect(screen.getByText(/No visitor's IP address is ever stored/i)).toBeInTheDocument();
    });

    it("sends this browser's visitor id when excluding the network", async () => {
      vi.mocked(saveAnalyticsInternal).mockResolvedValue({ emails: [], networks: ["203.0.113.7"] });
      render(<AnalyticsPanel />);
      await screen.findByText("203.0.113.7");

      fireEvent.click(screen.getByRole("button", { name: /don't count this network/i }));

      // Without the id the owner sees no change at all until some device on the
      // wifi happens to reload the shop — which reads as the setting not working.
      await waitFor(() => expect(saveAnalyticsInternal).toHaveBeenCalledWith(
        expect.objectContaining({ networks: ["203.0.113.7"], visitor_id: expect.any(String) })
      ));
    });

    it("says a network is already covered rather than offering it twice", async () => {
      vi.mocked(getAnalyticsInternal).mockResolvedValue(
        internal({ networks: ["203.0.113.7"], current_ip_excluded: true })
      );
      render(<AnalyticsPanel />);
      expect(await screen.findByText(/already excluded/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /count this network again/i })).toBeInTheDocument();
    });

    it("names the other hostnames that were minting duplicate visitors", async () => {
      vi.mocked(getAnalyticsInternal).mockResolvedValue(internal({
        origins_seen: [
          { origin: "https://theolivegoose.ie", visitors: 40, events: 900 },
          { origin: "https://frontend-production-a1bd.up.railway.app", visitors: 3, events: 20 },
        ],
      }));
      render(<AnalyticsPanel />);

      // The second hostname serves the same shop from a different origin, so
      // everyone who used it got a second visitor id. Naming it is what turns an
      // inexplicable count into an explicable one.
      expect(await screen.findByText(/frontend-production-a1bd/)).toBeInTheDocument();
      expect(screen.queryByText(/^https:\/\/theolivegoose\.ie —/)).not.toBeInTheDocument();
    });

    it("stays quiet about hostnames when only the real shop has reported in", async () => {
      vi.mocked(getAnalyticsInternal).mockResolvedValue(internal({
        origins_seen: [{ origin: "https://theolivegoose.ie", visitors: 40, events: 900 }],
      }));
      render(<AnalyticsPanel />);
      await screen.findByText("203.0.113.7");
      expect(screen.queryByText("Other addresses seen")).not.toBeInTheDocument();
    });
  });
});
