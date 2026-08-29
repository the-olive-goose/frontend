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
    getAnalyticsSessions: vi.fn().mockResolvedValue({ days: 7, host: "production", sessions: [] }),
    setAnalyticsInternalVisitor: vi.fn().mockResolvedValue(undefined),
  };
});

const { getAdminAnalytics, getAnalyticsInternal, saveAnalyticsInternal, getAnalyticsSessions } = await import("@/lib/api");

const internal = (o: Partial<AnalyticsInternal> = {}): AnalyticsInternal => ({
  emails: [], networks: [], current_ip: "203.0.113.7", current_ip_excluded: false,
  excluded_visitors: [], counted_origins: ["https://theolivegoose.ie"], origins_seen: [],
  ...o,
});

const overview = (o: Partial<AnalyticsOverview> = {}): AnalyticsOverview => ({
  start: "2026-07-01", end: "2026-07-30", days: 30, timezone: "Europe/Dublin",
  filters: { device: null, source: null, attr: "source", host: "production" },
  attributed: false,
  abandoned: { checkout_sessions: 3, abandoned_sessions: 1, lost_revenue: 75 },
  signin_wall: null,
  measurement_notes: [],
  searches: [],
  landing_pages: [],
  hosts: [{ host: "production", sessions: 6 }],
  machine_sessions: 0,
  machines_included: false,
  accounts: { newsletter_signups: 4, account_signups: 2, sign_ins: 7 },
  traffic: {
    visitors: 6, sessions: 6, pageviews: 9, pages_per_session: 1.5, bounce_rate: 16.7,
    new_visitors: 6, returning_visitors: 0, identified_visitor_pct: 100,
    // Deliberately a value nothing else in this file produces: an assertion that
    // matches two tiles at once passes for the wrong reason, or fails for one.
    engagement_rate: 58.3, avg_engagement_seconds: 47.2,
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
    name: "Candle A", units: 3, revenue: 130, add_to_carts: 2, removals: 0,
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
        name: "Never viewed", units: 0, revenue: 0, add_to_carts: 0, removals: 0,
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
  // ── Whose visits count ──────────────────────────────────────────────────────
  // This card used to hold three controls that guessed who was behind a visit —
  // exclude my wifi, exclude my account, mark this browser. They were wrong in
  // the worst direction and silently: the wifi rule hid everyone else in the
  // house, the account rule reached backwards through a browser's whole history,
  // and the browser mark attached itself to whatever opened the admin panel.
  // Between them they hid three real card payments and most of the shop's real
  // browsing. They are gone, and what replaces them has to state the rule that
  // now applies rather than leave a blank where a control used to be.
  describe("whose visits count", () => {
    const render_ = async () => {
      vi.mocked(getAdminAnalytics).mockResolvedValue(overview());
      render(<AnalyticsPanel />);
      await screen.findByText("Whose visits count");
    };

    it("states the rule: the live shop counts, testing goes to localhost", async () => {
      await render_();
      expect(screen.getByText(/Every visit to/)).toBeInTheDocument();
      expect(screen.getByText("theolivegoose.ie")).toBeInTheDocument();
      expect(screen.getByText(/recorded\s*separately/)).toBeInTheDocument();
    });

    it("offers no control that guesses who was behind a visit", async () => {
      await render_();
      // The exact controls that were removed. A button here that no longer acts
      // would be worse than the bug it was meant to fix.
      expect(screen.queryByText(/Your network/)).not.toBeInTheDocument();
      expect(screen.queryByText(/exclude your wifi/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/203\.0\.113\.7/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /this browser/i })).not.toBeInTheDocument();
    });

    it("points at the one manual exception that does still exist", async () => {
      await render_();
      // Named as the exact words on the button, and pointed at the table that
      // carries it — a rule that says "use the other control" and doesn't say
      // which one sends the reader hunting.
      expect(screen.getByText("This was me")).toBeInTheDocument();
      expect(screen.getAllByText(/Recent visits/).length).toBeGreaterThan(0);
    });

    it("promises revenue that reconciles with Stripe", async () => {
      // The figure an investor is most likely to check against another source.
      await render_();
      expect(screen.getByText(/reconciles with your Stripe dashboard/)).toBeInTheDocument();
      expect(screen.getByText(/To take money out of it, refund it/)).toBeInTheDocument();
    });
  });

  // ── Totals that have to reconcile ─────────────────────────────────────────
  // Every card re-derives its own row set, so each one is a chance to present a
  // total that quietly disagrees with the tile above it. Where a card genuinely
  // cannot cover everything, the shortfall is printed rather than left for the
  // reader to notice by adding up a column.
  describe("reconciliation", () => {
    it("names the sessions the attribution table cannot trace, instead of losing them", async () => {
      mocked.mockResolvedValue(overview({
        // All 6 sessions are in the table. Two of them have no source of their
        // own — one visit began before this period, one is a confirmed sale with
        // no browsing recorded — and each gets a named row rather than an
        // absence, so the column still totals to the Sessions tile.
        sources: [
          { source: "google", sessions: 3, orders: 1, revenue: 100 },
          { source: "direct", sessions: 1, orders: 0, revenue: 0 },
          { source: "(visit began before this period)", sessions: 1, orders: 1, revenue: 80 },
          { source: "(source not recorded)", sessions: 1, orders: 0, revenue: 0 },
        ],
      }));
      render(<AnalyticsPanel />);

      expect(await screen.findByText(/Adds up to all 6 sessions/i)).toBeInTheDocument();
      expect(screen.getByText(/2 of them can't be traced to a source/i)).toBeInTheDocument();
      // The carried-over orders keep their own row in the table…
      expect(screen.getByRole("cell", { name: "(visit began before this period)" })).toBeInTheDocument();
      // …but it is not a source anyone can filter the dashboard by.
      expect(screen.queryByRole("option", { name: "(visit began before this period)" })).not.toBeInTheDocument();
    });

    it("stays quiet when the attribution table covers every session", async () => {
      mocked.mockResolvedValue(overview({
        sources: [{ source: "google", sessions: 6, orders: 1, revenue: 100 }],
      }));
      render(<AnalyticsPanel />);

      await screen.findByText("Attribution");
      expect(screen.queryByText(/Adds up to \d+ of the/i)).not.toBeInTheDocument();
    });

    it("never prints two location rows under the same label", async () => {
      mocked.mockResolvedValue(overview({
        locations: [
          { city: "Unknown", country: "", sessions: 28, orders: 3, revenue: 190 },
          { city: "Unknown", country: "DE", sessions: 1, orders: 0, revenue: 0 },
          { city: "Dublin", country: "IE", sessions: 4, orders: 2, revenue: 120 },
        ],
      }));
      render(<AnalyticsPanel />);

      // Rows are grouped by city AND country, so an unknown city with a known
      // country is a different row — and two rows both labelled "Unknown" with
      // different numbers is unreadable.
      await screen.findByText("Where visitors are");
      expect(screen.getByRole("cell", { name: "Unknown, DE" })).toBeInTheDocument();
      expect(screen.getAllByRole("cell", { name: "Unknown" })).toHaveLength(1);
    });

    it("explains why the daily chart adds up to more than the period", async () => {
      mocked.mockResolvedValue(overview());
      render(<AnalyticsPanel />);

      // Per-day uniques exceed the period's uniques by design. Unexplained, the
      // chart and the Visitors tile look like they contradict each other.
      expect(await screen.findByText(/Each day counts its own unique visitors and sessions/i)).toBeInTheDocument();
    });
  });

  // ── The exported file ─────────────────────────────────────────────────────
  // The CSV is the panel's only output that outlives the screen: it gets
  // forwarded, quoted and totted up by people who never saw the caveats. So a
  // figure that needs a qualifier has to carry it into the file.
  describe("CSV export", () => {
    /** Clicks Export CSV and returns the text the file would contain. */
    const exportedCsv = (): string => {
      // jsdom's Blob has no .text(), so the parts are captured on the way in.
      // URL.createObjectURL doesn't exist there either, and the anchor click
      // must not try to navigate.
      const written: string[] = [];
      class CapturingBlob {
        constructor(parts: unknown[]) { written.push(parts.join("")); }
      }
      vi.stubGlobal("Blob", CapturingBlob);
      Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
      vi.unstubAllGlobals();
      expect(written).toHaveLength(1);
      return written[0];
    };

    it("carries the same caveats the screen shows", async () => {
      mocked.mockResolvedValue(overview({
        clamped: true,
        start: "2024-08-17", end: "2026-08-17", days: 731,
        sources: [
          { source: "google", sessions: 4, orders: 1, revenue: 100 },
          { source: "(visit began before this period)", sessions: 2, orders: 1, revenue: 80 },
        ],
      }));
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");

      const csv = exportedCsv();
      // The window that was measured, not the one requested.
      expect(csv).toMatch(/2024-08-17 to 2026-08-17/);
      expect(csv).toMatch(/longer than two years/i);
      // The tracking gap, the attribution shortfall, and the daily-uniques rule.
      expect(csv).toMatch(/have no tracked session/i);
      expect(csv).toMatch(/Attribution adds up to all 6 sessions/i);
      expect(csv).toMatch(/add up to more than the period totals/i);
    });

    it("exports the same product rates the table renders", async () => {
      mocked.mockResolvedValue(overview({
        top_products: [{
          name: "Candle A", units: 3, revenue: 300, add_to_carts: 2, removals: 1,
          views: 2, view_to_cart_pct: 100, cart_to_buy_pct: 50,
        }],
      }));
      render(<AnalyticsPanel />);
      await screen.findByText("Top products");

      const csv = exportedCsv();
      // views, carts, PUT BACK, view→cart, cart→buy, units, revenue — the
      // removals column travels with the file, or a spreadsheet read next month
      // is missing the column the screen showed.
      expect(csv).toMatch(/Candle A,2,2,1,100,50,3,300/);
    });
  });

  // ── The date range ────────────────────────────────────────────────────────
  // The reported symptom was "I pick dates and nothing on the page changes".
  // Every case below is a way that could happen while each individual piece
  // looked like it was working: the request never carrying the dates, a failed
  // load leaving the last period's figures sitting under the new ones, or the
  // heading naming a window the numbers were not measured over.
  describe("date range", () => {
    const openCustom = () => fireEvent.click(screen.getByRole("button", { name: "Custom…" }));

    it("asks the server for exactly the dates that were picked", async () => {
      mocked.mockResolvedValue(overview());
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");

      openCustom();
      fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-04-01" } });
      fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-06-30" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      await waitFor(() => expect(mocked).toHaveBeenLastCalledWith(
        expect.objectContaining({ start: "2026-04-01", end: "2026-06-30" })
      ));
    });

    it("clears the figures when a range fails to load, instead of leaving the last ones on screen", async () => {
      mocked.mockResolvedValueOnce(overview());
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");

      mocked.mockRejectedValueOnce(new Error("Request timed out — check your connection and try again."));
      openCustom();
      fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-04-01" } });
      fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-06-30" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      // Numbers measured over July must not be sitting under April–June dates:
      // left in place they are not stale, they are wrong, and nothing on screen
      // distinguishes them from a real answer for the new range.
      expect(await screen.findByText(/Request timed out/i)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText("Session conversion")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });

    it("heads the page with the window the server measured, not the one requested", async () => {
      // The server shortens anything past two years. Printing the request would
      // caption a 731-day window with a 5-year range, and the months that were
      // never measured would read as a collapse in trade.
      mocked.mockResolvedValue(overview({ start: "2024-08-17", end: "2026-08-17", days: 731, clamped: true }));
      render(<AnalyticsPanel />);

      expect(await screen.findByText(/longer than two years/i)).toBeInTheDocument();
      expect(screen.getByText(/not missing trade/i)).toBeInTheDocument();
      // The heading carries the measured window, alongside the period's name.
      const heading = screen.getAllByText(
        (_, el) => el?.tagName === "P" && /Last 30 days.*17 Aug 2024 – 17 Aug 2026/.test(el.textContent ?? "")
      );
      expect(heading.length).toBeGreaterThan(0);
    });

    it("refuses to ask for days that haven't happened yet", async () => {
      mocked.mockResolvedValue(overview());
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");

      const today = new Date();
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const nextYear = iso(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()));

      openCustom();
      fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-01-01" } });
      fireEvent.change(screen.getByLabelText("End date"), { target: { value: nextYear } });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      // Empty future days in the window drag every per-day average down.
      await waitFor(() => expect(mocked).toHaveBeenLastCalledWith(
        expect.objectContaining({ start: "2026-01-01", end: iso(today) })
      ));
    });
  });

  // ── Whose numbers are these ─────────────────────────────────────────────────
  // The control the owner asked for after finding the dashboard reporting the
  // test suite. Its job is not really filtering — it is making it impossible to
  // read a figure without knowing whose it is.
  describe("the hostname slicer", () => {
    const withHosts = (hosts: Array<{ host: string; sessions: number }>, host = "production") =>
      overview({ hosts, filters: { device: null, source: null, attr: "source", host } });

    it("stays off screen while the shop is the only hostname", async () => {
      // A dropdown with one option cannot change anything, and a control that
      // does nothing is worse than no control.
      vi.mocked(getAdminAnalytics).mockResolvedValue(withHosts([{ host: "production", sessions: 6 }]));
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");
      expect(screen.queryByRole("option", { name: /The shop/ })).not.toBeInTheDocument();
    });

    it("appears, in the owner's words, once anything else has been recorded", async () => {
      vi.mocked(getAdminAnalytics).mockResolvedValue(withHosts([
        { host: "production", sessions: 6 }, { host: "localhost", sessions: 41 },
      ]));
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");
      // Named as a place the owner recognises, not as the database's label,
      // and sized so it is obvious how much is being kept out.
      expect(screen.getByRole("option", { name: "The shop (theolivegoose.ie)" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /My computer \(localhost\) — 41 visits/ })).toBeInTheDocument();
    });

    it("says loudly, in the page body, when the numbers are not the shop's", async () => {
      // Not a footnote: a screenshot carries no dropdown with it, so a view that
      // isn't the shop has to announce itself somewhere that can't be cropped.
      vi.mocked(getAdminAnalytics).mockResolvedValue(withHosts([
        { host: "production", sessions: 6 }, { host: "localhost", sessions: 41 },
      ], "localhost"));
      render(<AnalyticsPanel />);
      expect(await screen.findByText(/These are not the shop's numbers/)).toBeInTheDocument();
      // Scoped to the banner: the dropdown names the same hostname, and an
      // assertion that matches either one would pass with the banner missing.
      const banner = screen.getByText(/These are not the shop's numbers/).parentElement!;
      expect(within(banner).getByText("My computer (localhost)")).toBeInTheDocument();
      expect(within(banner).getByRole("button", { name: "Show the shop only" })).toBeInTheDocument();
    });

    it("names the automated visits it left out, and offers them back", async () => {
      // Nine of these arrived on the live shop in three days, every one a single
      // page view claiming five seconds to the millisecond. Left in, they made
      // the shop look four times busier than it was. Left out silently, the
      // figure just reads low and nobody can tell why — so it says so.
      vi.mocked(getAdminAnalytics).mockResolvedValue(
        overview({ machine_sessions: 9, machines_included: false }));
      render(<AnalyticsPanel />);
      expect(await screen.findByText(/9 automated visits were left out/)).toBeInTheDocument();
      expect(screen.getByText(/Scrapers, not shoppers/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Count them anyway" })).toBeInTheDocument();
    });

    it("says so the other way round when they are being counted", async () => {
      vi.mocked(getAdminAnalytics).mockResolvedValue(
        overview({ machine_sessions: 9, machines_included: true }));
      render(<AnalyticsPanel />);
      expect(await screen.findByText(/9 of the visits above are automated/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Leave them out" })).toBeInTheDocument();
    });

    it("stays silent when no automated visit reached the window", async () => {
      vi.mocked(getAdminAnalytics).mockResolvedValue(overview({ machine_sessions: 0 }));
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");
      expect(screen.queryByText(/automated/)).not.toBeInTheDocument();
    });

    it("says how many visits the shop's view is leaving out", async () => {
      // A page showing 6 visits where the table holds 47 invites the reader to
      // assume it is broken, and an investor meeting is not the moment to be
      // asked. The figure explains itself instead.
      vi.mocked(getAdminAnalytics).mockResolvedValue(withHosts([
        { host: "production", sessions: 6 },
        { host: "localhost", sessions: 20 },
        { host: "(not recorded)", sessions: 21 },
      ]));
      render(<AnalyticsPanel />);
      expect(await screen.findByText(/41 more visits reached this window/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show everything recorded" })).toBeInTheDocument();
    });

    it("stays quiet when there is nothing to leave out", async () => {
      vi.mocked(getAdminAnalytics).mockResolvedValue(withHosts([{ host: "production", sessions: 6 }]));
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");
      expect(screen.queryByText(/more visits reached this window/)).not.toBeInTheDocument();
    });

    it("says nothing at all when they are", async () => {
      vi.mocked(getAdminAnalytics).mockResolvedValue(withHosts([
        { host: "production", sessions: 6 }, { host: "localhost", sessions: 41 },
      ]));
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");
      expect(screen.queryByText(/These are not the shop's numbers/)).not.toBeInTheDocument();
    });

    it("asks the server for the shop by default, never for everything", async () => {
      vi.mocked(getAdminAnalytics).mockResolvedValue(withHosts([{ host: "production", sessions: 6 }]));
      render(<AnalyticsPanel />);
      await screen.findByText("Session conversion");
      // Omitted, not "all": the server's own default is production, and the two
      // must not be able to drift apart.
      const [call] = vi.mocked(getAdminAnalytics).mock.calls.at(-1)!;
      expect(call.host).toBeUndefined();
    });
  });

  // ── Why a visit was retired ─────────────────────────────────────────────────
  // A retired row with no stated cause reads as "the dashboard has decided this
  // doesn't count", and the owner's own €0.50 card payment sitting in the Retired
  // tab looked exactly like a real sale being thrown away. It was in fact a test
  // purchase made from the shop's own network — which is the feature working —
  // but nothing on screen said so.
  describe("recent visits say why a visit is out of the numbers", () => {
    const visit = (o: Record<string, unknown> = {}) => ({
      session_id: "s1", visitor_id: "v1",
      started_at: "2026-08-27T00:32:00.000Z", last_at: "2026-08-27T00:35:00.000Z",
      pageviews: 4, events: 12, signed_in: true, entry_path: "/", device: "desktop",
      source: "direct", city: "Dublin", country: "IE", orders: 1, revenue: 0.5,
      excluded: true, excluded_reason: "marked from recent visits", excluded_detail: "", automated: false,
      ...o,
    });

    const showVisits = async (row: Record<string, unknown>) => {
      vi.mocked(getAdminAnalytics).mockResolvedValue(overview());
      vi.mocked(getAnalyticsSessions).mockResolvedValue({ days: 7, host: "production", sessions: [row] as never });
      render(<AnalyticsPanel />);
      // The visit itself, so the assertions below are reading the right table.
      await screen.findByText("Dublin, IE");
    };

    it("says a hidden visit was hidden by hand, and stays reversible", async () => {
      // The only reason a visit can be out of the numbers now. Nothing infers it
      // from a network or an account any more, so a row that is hidden was hidden
      // by somebody pressing a button, and the row should say so.
      await showVisits(visit());
      expect(await screen.findByText("you retired this")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Count it" })).toBeInTheDocument();
    });

    it("says nothing about visits that DO count", async () => {
      await showVisits(visit({ excluded: false, excluded_reason: "", excluded_detail: "" }));
      expect(await screen.findByRole("button", { name: "This was me" })).toBeInTheDocument();
      expect(screen.queryByText("you retired this")).not.toBeInTheDocument();
    });
  });
});
