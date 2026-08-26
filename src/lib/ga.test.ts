import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMemoryStorage } from "@/test/memoryStorage";
import { track } from "./analytics";
import { writeCookieConsent } from "./cookieConsent";
import type { GoogleAnalyticsContent } from "./defaults";
import {
  configureGoogleAnalytics,
  applyGoogleAnalyticsConsent,
  gaBlockedReason,
  getGaIds,
  isGoogleAnalyticsActive,
  isMeasurementId,
  mirrorPageView,
  resetGoogleAnalyticsForTests,
  startGoogleAnalyticsMirror,
  toGa4Event,
} from "./ga";

/**
 * The GA4 tag is the only third-party code the shop loads, and every guard that
 * decides whether it loads is invisible from the outside — a tag that is quietly
 * off looks exactly like one that is quietly on and reporting the owner's own
 * browsing to Google. So each guard is pinned here:
 *
 *  • off, unconfigured or misconfigured never loads anything;
 *  • the shop's own browsers never load it, which is stricter than the
 *    first-party rule because a GA4 hit can't be retracted afterwards;
 *  • consent is required by default, and Accept is what starts it mid-visit;
 *  • the funnel that reaches GA4 is the same funnel the first-party events
 *    describe, reshaped into GA4's conventions rather than renamed.
 */

installMemoryStorage(); // this jsdom build ships without Web Storage

const ON: GoogleAnalyticsContent = {
  enabled: true,
  measurement_id: "G-ABC1234567",
  require_consent: true,
  exclude_internal: true,
  track_ecommerce: true,
  debug_mode: false,
};

/** Every gtag call this page has made, as [command, ...args] tuples. */
const dataLayer = () => (window.dataLayer ?? []) as unknown[][];
const events = () => dataLayer().filter((a) => a[0] === "event");
const eventNames = () => events().map((a) => a[1]);
const paramsFor = (name: string) =>
  events().find((a) => a[1] === name)?.[2] as Record<string, unknown> | undefined;

const clearCookies = () => {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
};

beforeEach(() => {
  Object.defineProperty(document, "prerendering", { value: false, configurable: true });
  Object.defineProperty(document, "referrer", { value: "", configurable: true });
  localStorage.clear();
  sessionStorage.clear();
  clearCookies();
  resetGoogleAnalyticsForTests();
  window.history.replaceState({}, "", "/");
});

afterEach(() => resetGoogleAnalyticsForTests());

describe("measurement id", () => {
  it("accepts a GA4 web stream id", () => {
    expect(isMeasurementId("G-ABC1234567")).toBe(true);
  });

  it("rejects the ids people paste by mistake", () => {
    // UA- is retired Universal Analytics, GTM- is Tag Manager. Both are things
    // an owner will genuinely have to hand, and neither works here.
    for (const id of ["UA-12345-1", "GTM-ABC123", "G-", "ABC1234567", ""]) {
      expect(isMeasurementId(id)).toBe(false);
    }
  });
});

describe("what blocks the tag", () => {
  it("is off until the owner turns it on", () => {
    expect(gaBlockedReason({ ...ON, enabled: false })).toBe("disabled");
  });

  it("needs a measurement id, and a real one", () => {
    expect(gaBlockedReason({ ...ON, measurement_id: "" })).toBe("no_measurement_id");
    expect(gaBlockedReason({ ...ON, measurement_id: "UA-12345-1" })).toBe("bad_measurement_id");
  });

  it("never loads on the admin panel", () => {
    writeCookieConsent("accepted");
    expect(gaBlockedReason(ON, { path: "/admin" })).toBe("admin_path");
  });

  it("waits for the cookie banner, and stays off if it was declined", () => {
    expect(gaBlockedReason(ON)).toBe("awaiting_consent");
    writeCookieConsent("declined");
    expect(gaBlockedReason(ON)).toBe("consent_declined");
    writeCookieConsent("accepted");
    expect(gaBlockedReason(ON)).toBe(null);
  });

  it("measures everyone when the owner turns the consent gate off", () => {
    expect(gaBlockedReason({ ...ON, require_consent: false })).toBe(null);
  });

  it("treats a prerendered page as not a visit yet", () => {
    // Chrome loads and runs pages nobody has asked for. Most are never
    // activated. Counted, they arrive as a page_view, a session and a bounce
    // for a page the shopper never saw — invented traffic that looks exactly
    // like a real visitor who left immediately.
    writeCookieConsent("accepted");
    Object.defineProperty(document, "prerendering", { value: true, configurable: true });
    expect(gaBlockedReason(ON)).toBe("prerendering");
    configureGoogleAnalytics(ON);
    expect(document.getElementById("ga4-gtag")).toBeNull();
    expect(window.dataLayer).toBeUndefined();

    // Activation is what turns it into a visit.
    Object.defineProperty(document, "prerendering", { value: false, configurable: true });
    expect(gaBlockedReason(ON)).toBe(null);
  });

  it("keeps what a prerendered page did, and sends it once activated", () => {
    // "Not yet" is not "no": the events between prerender and activation belong
    // to the visit that is about to start.
    writeCookieConsent("accepted");
    Object.defineProperty(document, "prerendering", { value: true, configurable: true });
    startGoogleAnalyticsMirror();
    track("view_item", { product_id: "p1", name: "Olive", price: 24 });
    configureGoogleAnalytics(ON);
    expect(window.dataLayer).toBeUndefined();

    Object.defineProperty(document, "prerendering", { value: false, configurable: true });
    configureGoogleAnalytics(ON);
    expect(eventNames()).toEqual(["page_view", "view_item"]);
  });

  it("never loads on a browser marked as the shop's own", () => {
    // The standing rule, applied harder than it is first-party: our own events
    // can be marked internal and filtered out afterwards, but a hit that has
    // reached a GA4 property can never be taken back out of it.
    writeCookieConsent("accepted");
    localStorage.setItem("og_analytics_internal", "1");
    expect(gaBlockedReason(ON)).toBe("internal_browser");
  });

  it("never loads on a browser signed in to admin", () => {
    writeCookieConsent("accepted");
    localStorage.setItem("admin_token", "a.jwt.value");
    expect(gaBlockedReason(ON)).toBe("internal_browser");
  });

  it("still loads on the owner's browser if they explicitly stop excluding it", () => {
    writeCookieConsent("accepted");
    localStorage.setItem("og_analytics_internal", "1");
    expect(gaBlockedReason({ ...ON, exclude_internal: false })).toBe(null);
  });
});

describe("loading the tag", () => {
  it("adds no script and sends nothing while it is blocked", () => {
    configureGoogleAnalytics(ON); // no consent yet
    expect(document.getElementById("ga4-gtag")).toBeNull();
    expect(isGoogleAnalyticsActive()).toBe(false);
    expect(window.dataLayer).toBeUndefined();
  });

  it("loads gtag.js for the configured property once consent is in", () => {
    writeCookieConsent("accepted");
    expect(configureGoogleAnalytics(ON)).toBe(null);
    const script = document.getElementById("ga4-gtag") as HTMLScriptElement | null;
    expect(script?.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-ABC1234567");
    expect(isGoogleAnalyticsActive()).toBe(true);
  });

  it("queues commands the way gtag.js recognises them", () => {
    // THE bug, pinned. Google's snippet is `function gtag(){dataLayer.push(arguments)}`
    // and the `arguments` object is not decoration: gtag.js tells a COMMAND from
    // a data push by its type, and it recognises commands by [object Arguments].
    // Push a plain array and every command is read as data and discarded.
    //
    // What that looks like from the page is the reason this test exists rather
    // than a comment: the script tag is present, window.google_tag_manager is
    // defined, the container registers under the right measurement ID, and the
    // dataLayer fills with entries that look perfectly correct. Every check
    // available says "installed". Confirmed on the network — with an array push,
    // zero requests to google-analytics.com/g/collect. With arguments, hits.
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    startGoogleAnalyticsMirror();
    track("add_to_cart", { product_id: "p1", name: "Olive", price: 24 });

    const entries = window.dataLayer!;
    expect(entries.length).toBeGreaterThan(4);
    for (const entry of entries) {
      expect(Object.prototype.toString.call(entry)).toBe("[object Arguments]");
      expect(Array.isArray(entry)).toBe(false);
    }
  });

  it("requests gtag.js from the host and path Google's snippet names", () => {
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    const script = document.getElementById("ga4-gtag") as HTMLScriptElement;
    // Exactly the snippet's src, and async as the snippet has it — a blocking
    // tag would put a third-party round trip in front of the first paint.
    expect(script.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-ABC1234567");
    expect(script.async).toBe(true);
  });

  it("issues the snippet's four commands, in the snippet's order", () => {
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    const commands = dataLayer().map((a) => a[0]);
    // consent defaults must precede everything (they govern what gtag.js does
    // as it initialises); then js, then config — the snippet's own sequence.
    expect(commands.slice(0, 4)).toEqual(["consent", "consent", "js", "config"]);
    expect(dataLayer()[2][1]).toBeInstanceOf(Date);
    expect(dataLayer()[3][1]).toBe("G-ABC1234567");
  });

  it("denies every advertising signal, permanently", () => {
    // This shop does not advertise through Google. A measurement tag has no
    // business writing an advertising identifier, before or after consent.
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    const consents = dataLayer().filter((a) => a[0] === "consent");
    expect(consents.length).toBeGreaterThan(0);
    for (const [, , state] of consents) {
      const s = state as Record<string, string>;
      expect(s.ad_storage).toBe("denied");
      expect(s.ad_user_data).toBe("denied");
      expect(s.ad_personalization).toBe("denied");
    }
    // The default arrives before the library can act on anything.
    expect(consents[0][1]).toBe("default");
    expect((consents[0][2] as Record<string, string>).analytics_storage).toBe("denied");
    expect((consents[1][2] as Record<string, string>).analytics_storage).toBe("granted");
  });

  it("does not let Stripe become a traffic source", () => {
    // The shopper leaves for checkout.stripe.com and comes back. That is our own
    // funnel continuing, not an arrival from Stripe — and left alone it credits
    // the sale to Stripe on the highest-value sessions there are.
    //
    // `ignore_referrer` alone is not enough and this is why the referrer is
    // overridden outright: the flag is a processing hint that Google may honour
    // server-side, but the hit still carries `dr=checkout.stripe.com`. Setting
    // page_referrer to our own origin makes it an internal navigation, which is
    // observable on the wire and is what it actually was.
    writeCookieConsent("accepted");
    Object.defineProperty(document, "referrer", {
      value: "https://checkout.stripe.com/c/pay/cs_test_123",
      configurable: true,
    });
    configureGoogleAnalytics(ON);
    const config = dataLayer().find((a) => a[0] === "config")![2] as Record<string, unknown>;
    expect(config.ignore_referrer).toBe("true"); // the STRING — a boolean is ignored
    expect(config.page_referrer).toBe(window.location.origin);
  });

  it("leaves a genuine referral alone", () => {
    writeCookieConsent("accepted");
    Object.defineProperty(document, "referrer", { value: "https://example.com/blog", configurable: true });
    configureGoogleAnalytics(ON);
    const config = dataLayer().find((a) => a[0] === "config")![2] as Record<string, unknown>;
    expect(config.ignore_referrer).toBeUndefined();
    expect(config.page_referrer).toBeUndefined();
  });

  it("turns off gtag's own page_view so the SPA can send its own", () => {
    // Left on, gtag records one page_view at load and nothing after it: no
    // further documents load in a single-page app, so every session would read
    // as one page deep.
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    const config = dataLayer().find((a) => a[0] === "config");
    expect((config?.[2] as Record<string, unknown>).send_page_view).toBe(false);
  });

  it("loads the script once across repeated configures", () => {
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    configureGoogleAnalytics(ON);
    configureGoogleAnalytics(ON);
    expect(document.querySelectorAll("#ga4-gtag")).toHaveLength(1);
  });

  it("reports the landing page exactly once, however many callers ask", () => {
    // Both the tag's boot and the router's first effect legitimately want to
    // report the landing page; neither can be dropped, so the duplicate is.
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    mirrorPageView("/");
    expect(eventNames().filter((n) => n === "page_view")).toHaveLength(1);
  });

  it("reports each navigation after that", () => {
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    mirrorPageView("/shop");
    mirrorPageView("/products/olive");
    expect(eventNames().filter((n) => n === "page_view")).toHaveLength(3);
  });

  it("never reports an admin page", () => {
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    mirrorPageView("/admin");
    expect(paramsFor("page_view")?.page_path).toBe("/");
  });
});

describe("consent changing mid-visit", () => {
  it("starts the tag the moment the visitor accepts", () => {
    configureGoogleAnalytics(ON);
    expect(isGoogleAnalyticsActive()).toBe(false);

    writeCookieConsent("accepted");
    applyGoogleAnalyticsConsent(ON, true);
    expect(isGoogleAnalyticsActive()).toBe(true);
  });

  it("withdraws storage permission and stops mirroring on a decline", () => {
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    startGoogleAnalyticsMirror();

    applyGoogleAnalyticsConsent(ON, false);
    expect(isGoogleAnalyticsActive()).toBe(false);

    const last = dataLayer().filter((a) => a[0] === "consent").at(-1);
    expect((last?.[2] as Record<string, string>).analytics_storage).toBe("denied");

    const before = events().length;
    track("view_item", { product_id: "p1", name: "Olive", price: 24 });
    expect(events()).toHaveLength(before);
  });
});

describe("mirroring the shop's own events", () => {
  beforeEach(() => {
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    startGoogleAnalyticsMirror();
  });

  it("forwards a funnel event with GA4's item shape", () => {
    track("add_to_cart", { product_id: "p1", name: "Olive Grove", price: 24.5, quantity: 2 });
    const params = paramsFor("add_to_cart")!;
    expect(params.currency).toBe("EUR");
    expect(params.value).toBe(49);
    expect(params.items).toEqual([
      { item_id: "p1", item_name: "Olive Grove", price: 24.5, quantity: 2 },
    ]);
  });

  it("does not double-count page views", () => {
    // The router owns page_view; the first-party copy would arrive with the same
    // path and double every session's page count.
    const before = eventNames().filter((n) => n === "page_view").length;
    track("page_view", {});
    expect(eventNames().filter((n) => n === "page_view")).toHaveLength(before);
  });

  it("holds back shopping events when the owner turns them off", () => {
    configureGoogleAnalytics({ ...ON, track_ecommerce: false });
    track("add_to_cart", { product_id: "p1", name: "Olive", price: 24 });
    track("search", { query: "candle" });
    expect(eventNames()).toContain("search");
    expect(eventNames()).not.toContain("add_to_cart");
  });

  it("keeps mirroring out of the first-party pipeline's way", () => {
    // A throwing observer must never cost the shop its own event, which is the
    // one that always has to be recorded.
    expect(() => track("view_item", { product_id: "p1" })).not.toThrow();
  });
});

describe("the window before the settings arrive", () => {
  // The settings come over the network, so there is a gap at the start of every
  // visit during which the shopper is already doing things. Whatever happens in
  // that gap has to be either replayed or deliberately dropped — never lost by
  // accident, and never sent when consent said no.

  it("replays what happened while the settings were in flight", () => {
    writeCookieConsent("accepted");
    startGoogleAnalyticsMirror();

    // A product page opened straight from a search result: view_item fires
    // before the tag can possibly exist.
    track("view_item", { product_id: "p1", name: "Olive", price: 24 });
    track("add_to_cart", { product_id: "p1", name: "Olive", price: 24, quantity: 1 });
    expect(window.dataLayer).toBeUndefined();

    configureGoogleAnalytics(ON);
    expect(eventNames()).toEqual(["page_view", "view_item", "add_to_cart"]);
  });

  it("replays them in the order they happened, after the page_view", () => {
    writeCookieConsent("accepted");
    startGoogleAnalyticsMirror();
    track("view_item_list", { list_id: "all", list_name: "All", item_count: 3 });
    track("select_item", { product_id: "p1", name: "Olive", price: 24, position: 1 });
    configureGoogleAnalytics(ON);
    expect(eventNames()).toEqual(["page_view", "view_item_list", "select_item"]);
  });

  it("throws the held events away rather than sending them without consent", () => {
    startGoogleAnalyticsMirror();
    track("view_item", { product_id: "p1", name: "Olive", price: 24 });

    configureGoogleAnalytics(ON); // no consent yet → blocked
    expect(window.dataLayer).toBeUndefined();

    // Accepting later measures from here on. It must NOT resurrect what the
    // visitor did before they agreed to be measured.
    writeCookieConsent("accepted");
    applyGoogleAnalyticsConsent(ON, true);
    expect(eventNames()).toEqual(["page_view"]);
  });

  it("stops buffering once the answer is known, so it can't grow unbounded", () => {
    startGoogleAnalyticsMirror();
    configureGoogleAnalytics({ ...ON, enabled: false }); // settled: no
    for (let i = 0; i < 200; i++) track("view_item", { product_id: `p${i}` });

    writeCookieConsent("accepted");
    applyGoogleAnalyticsConsent(ON, true);
    expect(eventNames()).toEqual(["page_view"]);
  });

  it("reports the page it is on when it comes back after being switched off", () => {
    writeCookieConsent("accepted");
    configureGoogleAnalytics(ON);
    mirrorPageView("/shop");
    applyGoogleAnalyticsConsent(ON, false);
    configureGoogleAnalytics(ON);
    // Not deduped against the path from before the gap — the new session needs
    // a page_view or it has no landing page at all.
    expect(eventNames().filter((n) => n === "page_view")).toHaveLength(3);
  });
});

describe("translating the vocabulary", () => {
  it("renames only where GA4 insists", () => {
    expect(toGa4Event("signup", { method: "google" }, "/")!.name).toBe("sign_up");
    expect(toGa4Event("login", { method: "email" }, "/")!.name).toBe("login");
    expect(toGa4Event("view_cart", { total: 42 }, "/basket")!.name).toBe("view_cart");
  });

  it("keeps the shop's own sign-in gate under its own name", () => {
    // checkout_gate is ours, not GA4's. Renaming it to fit would lose the one
    // stage that measures what the sign-in wall costs.
    const mapped = toGa4Event("checkout_gate", { outcome: "signin_required", total: 60 }, "/basket")!;
    expect(mapped.name).toBe("checkout_gate");
    expect(mapped.params).toMatchObject({ outcome: "signin_required", value: 60, currency: "EUR" });
  });

  it("maps the fulfillment choice onto GA4's shipping tier", () => {
    const mapped = toGa4Event("add_shipping_info", { total: 30, fulfillment_type: "pickup" }, "/checkout")!;
    expect(mapped.params.shipping_tier).toBe("pickup");
  });

  it("scales CLS so GA4's integer values don't flatten it to zero", () => {
    const cls = toGa4Event("web_vital", { metric: "CLS", value: 0.101 }, "/")!;
    expect(cls.params.metric_value).toBe(101);
    const lcp = toGa4Event("web_vital", { metric: "LCP", value: 2400 }, "/")!;
    expect(lcp.params.metric_value).toBe(2400);
  });

  it("keeps milliseconds out of GA4's money column", () => {
    // `value` in GA4 is monetary — it feeds the Event value metric and sits in
    // the same column as revenue. A page-speed number there is added to the
    // shop's takings, and nothing about the report looks wrong.
    const lcp = toGa4Event("web_vital", { metric: "LCP", value: 2400 }, "/")!;
    expect(lcp.params.value).toBeUndefined();
    expect(lcp.params.currency).toBeUndefined();
  });

  it("only ever pairs a value with a currency", () => {
    // GA4's contract: currency is required whenever value is set. An event that
    // breaks it has its value read against the property's default currency.
    const everyEvent: Array<[Parameters<typeof toGa4Event>[0], Record<string, unknown>]> = [
      ["page_view", {}],
      ["view_item_list", { list_id: "all", line_items: [{ product_id: "p1", price: 25 }] }],
      ["select_item", { product_id: "p1", price: 25 }],
      ["view_item", { product_id: "p1", price: 25 }],
      ["view_item", { product_id: "p1" }],
      ["add_to_cart", { product_id: "p1", price: 25, quantity: 2 }],
      ["add_to_cart", { product_id: "p1", quantity: 2 }],
      ["remove_from_cart", { product_id: "p1", price: 25, quantity: 1 }],
      ["view_cart", { total: 50 }],
      ["checkout_gate", { total: 50, outcome: "passed" }],
      ["begin_checkout", { total: 54.99, shipping: 4.99 }],
      ["add_shipping_info", { total: 54.99, shipping: 4.99 }],
      ["add_payment_info", { total: 54.99, shipping: 4.99 }],
      ["search", { query: "candle" }],
      ["signup", {}], ["login", {}], ["newsletter_signup", {}],
      ["web_vital", { metric: "LCP", value: 2400 }],
    ];
    for (const [type, props] of everyEvent) {
      const mapped = toGa4Event(type, props, "/");
      if (!mapped) continue;
      if (mapped.params.value !== undefined) {
        expect(mapped.params.currency, `${type} sets value without currency`).toBe("EUR");
      }
    }
  });

  it("explains the gap between an event's value and its items", () => {
    // Items carry list prices; value is what the shopper would pay. Shipping and
    // the coupon are what reconcile them — without both, GA4 shows an event
    // whose value contradicts its own items and nothing accounts for it.
    const mapped = toGa4Event("begin_checkout", {
      total: 54.99, shipping: 4.99, discount: 5, coupon: "OG-WELCOME",
      line_items: [{ product_id: "p1", name: "Olive", price: 55, quantity: 1 }],
    }, "/checkout")!;
    expect(mapped.params.value).toBe(54.99);
    expect(mapped.params.shipping).toBe(4.99);
    expect(mapped.params.coupon).toBe("OG-WELCOME");
  });

  it("still says a discount applied when there was no code", () => {
    // A bundle saving has no coupon code, but GA4 has no event-level discount
    // field — so `coupon` is what carries "a discount was applied here".
    const mapped = toGa4Event("checkout_gate", {
      total: 45, discount: 5, outcome: "passed",
      line_items: [{ product_id: "p1", price: 50, quantity: 1 }],
    }, "/basket")!;
    expect(mapped.params.coupon).toBe("discount");
  });

  it("names the currency on every event that carries a price", () => {
    // Left off, GA4 reads the number against the PROPERTY's default currency, so
    // a property created in dollars reports €25 candles as $25 — a wrong figure
    // that looks entirely normal, in the report the shop is judged on.
    const priced: Array<[Parameters<typeof toGa4Event>[0], Record<string, unknown>]> = [
      ["view_item", { product_id: "p1", price: 25 }],
      ["add_to_cart", { product_id: "p1", price: 25, quantity: 1 }],
      ["remove_from_cart", { product_id: "p1", price: 25, quantity: 1 }],
      ["select_item", { product_id: "p1", price: 25 }],
      ["view_item_list", { list_id: "all", line_items: [{ product_id: "p1", price: 25 }] }],
      ["view_cart", { total: 25 }],
      ["begin_checkout", { total: 25 }],
      ["add_shipping_info", { total: 25 }],
      ["add_payment_info", { total: 25 }],
      ["checkout_gate", { total: 25 }],
    ];
    for (const [type, props] of priced) {
      const mapped = toGa4Event(type, props, "/")!;
      expect(mapped.params.currency, `${type} must declare its currency`).toBe("EUR");
    }
  });

  it("drops the events GA4 measures for itself", () => {
    // gtag keeps its own engagement time; ours would double it.
    expect(toGa4Event("user_engagement", {}, "/")).toBeNull();
  });

  it("says nothing rather than zero when a price is unknown", () => {
    // `value: 0` is not "we don't know" — GA4 reports it as a product worth
    // nothing, averaged into order value and item revenue, indistinguishable
    // from something genuinely free.
    const viewed = toGa4Event("view_item", { product_id: "p1", name: "Olive" }, "/")!;
    expect(viewed.params.value).toBeUndefined();
    expect(viewed.params.currency).toBeUndefined();

    const added = toGa4Event("add_to_cart", { product_id: "p1", name: "Olive", quantity: 2 }, "/")!;
    expect(added.params.value).toBeUndefined();
  });

  it("leaves a field out rather than inventing a value for it", () => {
    // The earlier version defaulted item_name to the product id, which put
    // strings like "p1" in the item name column of GA4's product report. Data
    // that is missing can be noticed; data that is wrong cannot.
    const mapped = toGa4Event("view_item", { product_id: "p1" }, "/products/x")!;
    expect(mapped.params.items).toEqual([{ item_id: "p1" }]);
  });

  it("maps a whole basket when the event carried one", () => {
    const mapped = toGa4Event("begin_checkout", {
      total: 74,
      items: 3,
      line_items: [
        { product_id: "p1", name: "Olive", price: 25, quantity: 2 },
        { product_id: "p2", name: "Matcha", price: 24, quantity: 1 },
      ],
    }, "/checkout")!;
    expect(mapped.params.value).toBe(74);
    expect(mapped.params.items).toEqual([
      { item_id: "p1", item_name: "Olive", price: 25, quantity: 2, index: 1 },
      { item_id: "p2", item_name: "Matcha", price: 24, quantity: 1, index: 2 },
    ]);
  });

  it("never mistakes the item COUNT for the item list", () => {
    // `items` has been a number in these props since the first day, and the
    // dashboard's SQL reads it as one. Reusing the name for GA4's array would
    // have changed a stored field's type in place.
    const mapped = toGa4Event("view_cart", { items: 3, total: 60 }, "/basket")!;
    expect(mapped.params.items).toBeUndefined();
    expect(mapped.params.value).toBe(60);
  });

  it("joins a click back to the list it came from", () => {
    const mapped = toGa4Event("select_item", {
      product_id: "p1", name: "Olive", price: 25, position: 2,
      list_id: "category_cafe", list_name: "Cafe Candles",
    }, "/")!;
    expect(mapped.params).toEqual({
      currency: "EUR",
      item_list_id: "category_cafe",
      item_list_name: "Cafe Candles",
      items: [{
        item_id: "p1", item_name: "Olive", price: 25, index: 2,
        item_list_id: "category_cafe", item_list_name: "Cafe Candles",
      }],
    });
  });

  it("still reports a click from a card that isn't in a list", () => {
    const mapped = toGa4Event("select_item", { product_id: "p1", name: "Olive", price: 25 }, "/")!;
    expect(mapped.params.item_list_id).toBeUndefined();
    expect(mapped.params.items).toEqual([{ item_id: "p1", item_name: "Olive", price: 25 }]);
  });

  it("stamps the list onto every impression it reports", () => {
    const mapped = toGa4Event("view_item_list", {
      list_id: "cafe", list_name: "Cafe Candles", item_count: 2,
      line_items: [{ product_id: "p1", name: "Olive", price: 25 }],
    }, "/shop")!;
    expect(mapped.params.items).toEqual([
      { item_id: "p1", item_name: "Olive", price: 25, index: 1, item_list_id: "cafe", item_list_name: "Cafe Candles" },
    ]);
  });
});

describe("handing the visit to the server", () => {
  it("reads the session id out of the CURRENT (GS2) cookie format", () => {
    // Copied verbatim from a live cookie written by gtag.js. GS2 packs its
    // fields as `s<session>$o<n>$g…` and is NOT dot-delimited, so a parser
    // written for the older GS1 shape finds nothing here.
    //
    // Getting this wrong is silent and expensive: the purchase still reaches
    // GA4 and still counts its revenue, attached to no session — so every sale
    // is credited to "(direct) / (none)" and every campaign that actually
    // earned it looks worthless.
    document.cookie = "_ga=GA1.1.1546987988.1787691831; path=/";
    document.cookie = "_ga_CG102GMHD0=GS2.1.s1787691830$o1$g0$t1787691830$j60$l0$h0; path=/";
    expect(getGaIds()).toEqual({
      ga_client_id: "1546987988.1787691831",
      ga_session_id: "1787691830",
    });
  });

  it("still reads the legacy (GS1) cookie format", () => {
    document.cookie = "_ga=GA1.1.1234567890.1700000000; path=/";
    document.cookie = "_ga_ABC1234567=GS1.1.1700000500.1.1.1700000600.0.0.0; path=/";
    expect(getGaIds()).toEqual({
      ga_client_id: "1234567890.1700000000",
      ga_session_id: "1700000500",
    });
  });

  it("returns nothing when the tag never ran", () => {
    // The normal case for a visitor who declined cookies — and the reason the
    // backend simply doesn't report that purchase to Google.
    expect(getGaIds()).toEqual({});
  });
});

// ── Invariants nothing else would catch ────────────────────────────────────────

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

describe("the two systems stay in step", () => {
  it("has a deliberate answer for every event the shop can record", () => {
    // toGa4Event ends in `default: return null`, which is the right shape but a
    // silent one: add an event to EventType and GA4 stops short of it with
    // nothing anywhere reporting a problem — the funnel just has a hole in it
    // that only shows up as a stage that never fills.
    //
    // So every name in the vocabulary must be accounted for here: mapped, or
    // listed below as something GA4 measures for itself.
    const NOT_SENT = new Set(["user_engagement"]);
    const block = read("src/lib/analytics.ts").match(/export type EventType =([\s\S]*?);\n/);
    expect(block).toBeTruthy();
    const types = [...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(10);

    const unhandled = types.filter((t) => {
      const mapped = toGa4Event(t as Parameters<typeof toGa4Event>[0], {}, "/");
      return mapped === null && !NOT_SENT.has(t);
    });
    expect(unhandled).toEqual([]);
  });

  it("keeps the Measurement Protocol secret out of the public content store", () => {
    // /api/content and /api/content/:section both select on the `content_`
    // prefix, and the storefront calls them without any auth at all. A key
    // stored with that prefix is a key published to the internet — which for
    // this one means anyone can write invented revenue into the owner's GA4
    // property. Nothing in the code would look wrong; the leak would be one
    // string.
    const backend = read("backend/index.js");
    const key = backend.match(/const GA4_SECRET_KEY = '([^']+)'/)?.[1];
    expect(key).toBeTruthy();
    expect(key!.startsWith("content_")).toBe(false);
  });

  it("has checkout forward GA4's ids so the server can attribute the purchase", () => {
    // The purchase is written server-side, minutes later, from a browser that
    // has been redirected to Stripe. Drop these ids and every sale still
    // arrives in GA4 — attached to no session, so the acquisition report
    // credits the lot to "(direct)" and the shop's marketing looks worthless.
    const checkout = read("src/pages/CheckoutPage.tsx");
    expect(checkout).toMatch(/getGaIds\(\)/);
    const backend = read("backend/index.js");
    expect(backend).toMatch(/ga_client_id: gaClientId\(req\.body\.analytics\?\.ga_client_id\)/);
    expect(backend).toMatch(/reportPurchaseToGa4\(order, p\)/);
  });

  it("dedupes the purchase on the order id", () => {
    // A webhook and the success-page poll can both finalize the same session.
    // Our own table is protected by a unique constraint; GA4's only protection
    // is transaction_id, so it has to be the order's own stable id and not, say,
    // a timestamp.
    const backend = read("backend/index.js");
    expect(backend).toMatch(/transaction_id: String\(order\.id\)/);
  });
});
