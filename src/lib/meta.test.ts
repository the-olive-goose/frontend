import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { installMemoryStorage } from "@/test/memoryStorage";
import { track } from "./analytics";
import { writeCookieConsent } from "./cookieConsent";
import type { MetaPixelContent } from "./defaults";
import {
  applyMetaPixelConsent,
  configureMetaPixel,
  getMetaIds,
  isMetaPixelActive,
  isPixelId,
  isTestEventCode,
  metaBlockedReason,
  metaPurchaseEventId,
  mirrorMetaPageView,
  mirrorMetaPurchase,
  resetMetaPixelForTests,
  setMetaUserData,
  startMetaPixelMirror,
  toMetaEvent,
} from "./meta";

/**
 * The Meta Pixel is the second third-party tag the shop loads, and the one with
 * the most ways to be quietly wrong. Every guard that decides whether it loads is
 * invisible from the outside; every event it sends is invisible until it is
 * already in someone's ad account. So each of them is pinned here:
 *
 *  • off, unconfigured or misconfigured never loads anything;
 *  • the shop's own browsers never load it — stricter than the first-party rule,
 *    because these events don't only get counted, they teach ad delivery;
 *  • consent is required by default, and Accept is what starts it mid-visit;
 *  • the install snippet is Meta's own, down to the Arguments object;
 *  • only Meta's seventeen standard event names go through `track`;
 *  • the identifiers the server needs are read back exactly as the pixel wrote
 *    them, and only ever when the pixel was allowed to run.
 */

installMemoryStorage(); // this jsdom build ships without Web Storage

const ON: MetaPixelContent = {
  enabled: true,
  pixel_id: "1234567890123456",
  require_consent: true,
  exclude_internal: true,
  track_ecommerce: true,
  advanced_matching: true,
  test_event_code: "",
};

/** Every fbq call this page has made, as [command, ...args] arrays. */
const calls = (): unknown[][] =>
  Array.from((window.fbq?.queue ?? []) as ArrayLike<IArguments>).map((a) => Array.from(a));
const commands = () => calls().map((c) => c[0]);
const sent = () => calls().filter((c) => c[0] === "track" || c[0] === "trackCustom");
const sentNames = () => sent().map((c) => c[1]);
const paramsFor = (name: string) => sent().find((c) => c[1] === name)?.[2] as Record<string, unknown> | undefined;
const optsFor = (name: string) => sent().find((c) => c[1] === name)?.[3] as Record<string, unknown> | undefined;

const clearCookies = () => {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
};

beforeEach(() => {
  Object.defineProperty(document, "prerendering", { value: false, configurable: true });
  localStorage.clear();
  sessionStorage.clear();
  clearCookies();
  resetMetaPixelForTests();
  window.history.replaceState({}, "", "/");
});

afterEach(() => resetMetaPixelForTests());

describe("pixel id", () => {
  it("accepts the 15- and 16-digit ids Meta issues", () => {
    expect(isPixelId("123456789012345")).toBe(true);
    expect(isPixelId("1234567890123456")).toBe(true);
    expect(isPixelId("  1234567890123456  ")).toBe(true);
  });

  it("rejects the ids people paste by mistake", () => {
    // An ad account id, a Business Manager id and a truncated paste are all
    // things an owner genuinely has to hand, and none of them works here.
    for (const id of ["act_1234567890123456", "1234567890", "G-ABC1234567", "12345678901234567", "", "abc"]) {
      expect(isPixelId(id)).toBe(false);
    }
  });

  it("rejects an id starting with a zero, because fbevents.js does", () => {
    // Read off the live library, not reasoned about. Loaded with a leading-zero
    // id, fbevents.js logs `[Meta Pixel] - Invalid PixelID: null`, never requests
    // connect.facebook.net/signals/config/<id>, discards the queued calls and
    // sends nothing — while a well-formed id fetches that config within a second.
    //
    // Accepting one here would put a green tick beside a pixel that cannot load,
    // which is the exact failure this validator exists to prevent.
    for (const id of ["000000000000001", "0123456789012345", "0000000000000000"]) {
      expect(isPixelId(id)).toBe(false);
    }
  });
});

describe("test events code", () => {
  it("accepts what Events Manager shows, and nothing else", () => {
    expect(isTestEventCode("TEST12345")).toBe(true);
    expect(isTestEventCode("test999")).toBe(true);
    for (const c of ["TEST", "12345", "TESTABC", ""]) expect(isTestEventCode(c)).toBe(false);
  });
});

describe("what blocks the pixel", () => {
  it("is off until the owner turns it on", () => {
    expect(metaBlockedReason({ ...ON, enabled: false })).toBe("disabled");
  });

  it("needs a pixel id, and a real one", () => {
    expect(metaBlockedReason({ ...ON, pixel_id: "" })).toBe("no_pixel_id");
    expect(metaBlockedReason({ ...ON, pixel_id: "act_1234567890123456" })).toBe("bad_pixel_id");
  });

  it("never loads on the admin panel", () => {
    writeCookieConsent("accepted");
    expect(metaBlockedReason(ON, { path: "/admin" })).toBe("admin_path");
  });

  it("waits for the cookie banner, and stays off if it was declined", () => {
    expect(metaBlockedReason(ON)).toBe("awaiting_consent");
    writeCookieConsent("declined");
    expect(metaBlockedReason(ON)).toBe("consent_declined");
    writeCookieConsent("accepted");
    expect(metaBlockedReason(ON)).toBe(null);
  });

  it("measures everyone when the owner turns the consent gate off", () => {
    expect(metaBlockedReason({ ...ON, require_consent: false })).toBe(null);
  });

  it("treats a prerendered page as not a visit yet", () => {
    writeCookieConsent("accepted");
    Object.defineProperty(document, "prerendering", { value: true, configurable: true });
    expect(metaBlockedReason(ON)).toBe("prerendering");
    configureMetaPixel(ON);
    expect(document.getElementById("meta-pixel")).toBeNull();
    expect(window.fbq).toBeUndefined();

    Object.defineProperty(document, "prerendering", { value: false, configurable: true });
    expect(metaBlockedReason(ON)).toBe(null);
  });

  it("keeps what a prerendered page did, and sends it once activated", () => {
    writeCookieConsent("accepted");
    Object.defineProperty(document, "prerendering", { value: true, configurable: true });
    startMetaPixelMirror();
    track("view_item", { product_id: "p1", name: "Olive", price: 24 });
    configureMetaPixel(ON);
    expect(window.fbq).toBeUndefined();

    Object.defineProperty(document, "prerendering", { value: false, configurable: true });
    configureMetaPixel(ON);
    expect(sentNames()).toEqual(["PageView", "ViewContent"]);
  });

  it("always loads on the live shop, whoever is at the keyboard", () => {
    // This used to be gated on a flag written into whatever browser opened the
    // admin panel — so looking at your own dashboard once stopped the pixel
    // firing for you on the real site, permanently and silently, while the
    // shop's own analytics carried on counting you.
    writeCookieConsent("accepted");
    localStorage.setItem("admin_token", "a.b.c");
    expect(metaBlockedReason({ ...ON, exclude_internal: true })).toBeNull();
  });

  it("never loads on a copy running on localhost", () => {
    // The one separation left: the live shop is trade, localhost is work. A hit
    // that reaches the property is in it for good, so this is the strict side.
    writeCookieConsent("accepted");
    const live = window.location;
    vi.stubGlobal("location", { ...live, hostname: "localhost" });
    expect(metaBlockedReason({ ...ON, exclude_internal: true })).toBe("development_origin");
    vi.stubGlobal("location", live);
  });

  it("…unless the owner has turned that off", () => {
    writeCookieConsent("accepted");
    const live = window.location;
    vi.stubGlobal("location", { ...live, hostname: "localhost" });
    expect(metaBlockedReason({ ...ON, exclude_internal: false })).toBeNull();
    vi.stubGlobal("location", live);
  });

  it("still loads on the owner's browser if they explicitly stop excluding it", () => {
    writeCookieConsent("accepted");
    localStorage.setItem("og_analytics_internal", "1");
    expect(metaBlockedReason({ ...ON, exclude_internal: false })).toBe(null);
  });
});

describe("loading the pixel", () => {
  it("adds no script and sends nothing while it is blocked", () => {
    configureMetaPixel(ON); // no consent yet
    expect(document.getElementById("meta-pixel")).toBeNull();
    expect(isMetaPixelActive()).toBe(false);
    expect(window.fbq).toBeUndefined();
  });

  it("loads fbevents.js from the host and path Meta's snippet names", () => {
    writeCookieConsent("accepted");
    expect(configureMetaPixel(ON)).toBe(null);
    const script = document.getElementById("meta-pixel") as HTMLScriptElement;
    expect(script.src).toBe("https://connect.facebook.net/en_US/fbevents.js");
    // async as the snippet has it — a blocking tag would put a third-party round
    // trip in front of the first paint.
    expect(script.async).toBe(true);
    expect(isMetaPixelActive()).toBe(true);
  });

  it("installs the stub exactly as Meta's snippet does", () => {
    // THE bug class, pinned, and it is the same one gtag has (see ga.test.ts):
    // a stub that looks installed and queues nothing. fbevents.js recognises its
    // own placeholder by these properties and drains `queue` when it arrives —
    // get one of them wrong and it installs a SECOND, empty queue over the top
    // of the one holding this visit's first events. The page looks perfectly
    // healthy and the landing page's PageView is simply never sent.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    const fbq = window.fbq!;
    expect(typeof fbq).toBe("function");
    expect(fbq.push).toBe(fbq);
    expect(fbq.loaded).toBe(true);
    expect(fbq.version).toBe("2.0");
    expect(Array.isArray(fbq.queue)).toBe(true);
    expect(window._fbq).toBe(fbq);
  });

  it("queues each call as the Arguments object fbevents.js expects", () => {
    // Meta's snippet is `n.queue.push(arguments)`. An arrow function has no
    // `arguments` at all, and a rest-array is a different shape than the drain
    // routine reads.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    startMetaPixelMirror();
    track("add_to_cart", { product_id: "p1", name: "Olive", price: 24 });

    const entries = window.fbq!.queue!;
    expect(entries.length).toBeGreaterThan(2);
    for (const entry of entries) {
      expect(Object.prototype.toString.call(entry)).toBe("[object Arguments]");
      expect(Array.isArray(entry)).toBe(false);
    }
  });

  it("grants consent and goes manual before it initialises, never after", () => {
    // Order is the whole contract here. A consent grant issued after the pixel
    // has decided it may not send applies to nothing that came before it, and
    // `autoConfig` has to be set before the pixel it names is initialised or the
    // automatic behaviour is already installed.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    expect(commands().slice(0, 4)).toEqual(["consent", "set", "init", "track"]);
    expect(calls()[0][1]).toBe("grant");
    expect(calls()[1].slice(1)).toEqual(["autoConfig", false, "1234567890123456"]);
    expect(calls()[2][1]).toBe("1234567890123456");
  });

  it("turns off the automatic behaviour it never asked for", () => {
    // Automatic Advanced Matching scrapes the page's form fields for an email
    // and attaches what it finds, whatever the owner set the advanced-matching
    // switch to — and the form in question is the checkout address form. A tag
    // helping itself to that while the panel promises the owner decides is a
    // promise that isn't true.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    const set = calls().find((c) => c[0] === "set" && c[1] === "autoConfig");
    expect(set).toBeDefined();
    expect(set![2]).toBe(false);
    // Named for this pixel, and issued before its init — after it, the automatic
    // behaviour is already installed.
    expect(set![3]).toBe("1234567890123456");
    expect(calls().indexOf(set!)).toBeLessThan(calls().findIndex((c) => c[0] === "init"));
  });

  it("loads the script once across repeated configures", () => {
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    configureMetaPixel(ON);
    configureMetaPixel(ON);
    expect(document.querySelectorAll("#meta-pixel")).toHaveLength(1);
  });

  it("reports the landing page exactly once, however many callers ask", () => {
    // Both the pixel's boot and the router's first effect legitimately want to
    // report the landing page; neither can be dropped, so the duplicate is.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    mirrorMetaPageView("/");
    mirrorMetaPageView("/");
    expect(sentNames().filter((n) => n === "PageView")).toHaveLength(1);
  });

  it("reports every navigation, because no second document ever loads", () => {
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    mirrorMetaPageView("/shop");
    mirrorMetaPageView("/products/olive");
    expect(sentNames().filter((n) => n === "PageView")).toHaveLength(3);
  });

  it("never reports an admin page", () => {
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    mirrorMetaPageView("/admin/orders");
    expect(sentNames().filter((n) => n === "PageView")).toHaveLength(1);
  });

  it("revokes consent when the owner switches it off mid-visit", () => {
    // fbevents.js cannot be unloaded once it is in the page, so "off" has to
    // mean: stop mirroring, and tell the script itself to stop.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    expect(configureMetaPixel({ ...ON, enabled: false })).toBe("disabled");
    expect(calls().filter((c) => c[0] === "consent" && c[1] === "revoke")).toHaveLength(1);
    expect(isMetaPixelActive()).toBe(false);
  });
});

describe("consent, arriving mid-visit", () => {
  it("holds what happened before the banner was answered, then sends it", () => {
    // The settings arrive over the network, so there is a window at the start of
    // every visit where the shopper is already doing things. On a product page
    // opened straight from an ad, view_item lands inside it.
    startMetaPixelMirror();
    track("view_item", { product_id: "p1", name: "Olive", price: 24 });
    track("add_to_cart", { product_id: "p1", name: "Olive", price: 24, quantity: 2 });
    expect(window.fbq).toBeUndefined();

    writeCookieConsent("accepted");
    applyMetaPixelConsent(ON, true);
    expect(sentNames()).toEqual(["PageView", "ViewContent", "AddToCart"]);
  });

  it("drops what it was holding if the visitor says no", () => {
    // The entire point of the buffer's `settled` flag: a declined banner must
    // not retroactively send the browsing that preceded it.
    startMetaPixelMirror();
    track("view_item", { product_id: "p1", name: "Olive", price: 24 });
    applyMetaPixelConsent(ON, false);
    expect(window.fbq).toBeUndefined();

    // And nothing after it, either.
    track("add_to_cart", { product_id: "p1", price: 24 });
    expect(window.fbq).toBeUndefined();
  });
});

describe("advanced matching", () => {
  it("hands Meta the signed-in shopper's details for it to hash", () => {
    writeCookieConsent("accepted");
    setMetaUserData({
      email: "  Aoife@Example.com ",
      phone: "+353 87 123 4567",
      firstName: "Aoife",
      lastName: "Ní Bhriain",
      externalId: "visitor-123",
    });
    configureMetaPixel(ON);
    const init = calls().find((c) => c[0] === "init")![2] as Record<string, string>;
    // Normalised the way Meta's own in-browser normaliser does, because the
    // plaintext is what fbevents.js hashes — our job is only to hand it clean
    // values.
    expect(init.em).toBe("aoife@example.com");
    expect(init.ph).toBe("353871234567");
    expect(init.fn).toBe("aoife");
    expect(init.ln).toBe("ní bhriain");
    expect(init.external_id).toBe("visitor-123");
  });

  it("sends nothing about the PERSON when the owner turns it off", () => {
    // The switch is about email, phone and name. The opaque first-party token
    // stays: it says nothing about who anybody is, it is the join key between
    // these events and the sale the server writes — and without it Meta REJECTS
    // a thin event outright (error 2804050, verified against the live endpoint).
    writeCookieConsent("accepted");
    setMetaUserData({ email: "aoife@example.com", phone: "+353871234567", firstName: "Aoife", externalId: "visitor-123" });
    configureMetaPixel({ ...ON, advanced_matching: false });
    expect(calls().find((c) => c[0] === "init")![2]).toEqual({ external_id: "visitor-123" });
  });

  it("omits what it doesn't know rather than sending an empty field", () => {
    writeCookieConsent("accepted");
    setMetaUserData({ email: "not-an-email", phone: "12", externalId: "visitor-123" });
    configureMetaPixel(ON);
    const payload = calls().find((c) => c[0] === "init")![2] as Record<string, string>;
    // A value with no @ is not an email and a two-digit phone is not a phone.
    // Hashing them would fill Meta's match pool with noise.
    expect(payload.em).toBeUndefined();
    expect(payload.ph).toBeUndefined();
    expect(payload.external_id).toBe("visitor-123");
  });

  it("initialises the pixel exactly once, because a second init is ignored", () => {
    // Not a style choice — a property of the library. fbevents.js takes advanced
    // matching from the FIRST init for a pixel and silently ignores every later
    // one; `fbq('set','userData',…)` does nothing either. Both were tried
    // against the live script and neither moved the `ud[…]` parameters on the
    // wire, while both returned as though they had worked. So issuing a second
    // init would be a lie told in code — the identity would look updated and
    // nothing would have changed.
    writeCookieConsent("accepted");
    setMetaUserData({ externalId: "visitor-123" });
    configureMetaPixel(ON);
    expect(calls().filter((c) => c[0] === "init")).toHaveLength(1);

    setMetaUserData({ email: "aoife@example.com", externalId: "visitor-123" });
    configureMetaPixel(ON);
    expect(calls().filter((c) => c[0] === "init")).toHaveLength(1);
    // The identity still reaches Meta — over the Conversions API, attached to
    // the same external_id. See reportPurchaseToMeta.
    expect(calls().find((c) => c[0] === "init")![2]).toEqual({ external_id: "visitor-123" });
  });
});

describe("the funnel Meta receives", () => {
  const boot = () => {
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    startMetaPixelMirror();
  };

  it("uses only names Meta's `track` accepts", () => {
    // `fbq('track', 'SomethingElse')` is flagged as an invalid event by the Meta
    // Pixel Helper extension — which is the tool the owner will be looking at
    // while deciding whether any of this works. Ours go through `trackCustom`.
    const STANDARD = new Set([
      "AddPaymentInfo", "AddToCart", "AddToWishlist", "CompleteRegistration", "Contact",
      "CustomizeProduct", "Donate", "FindLocation", "InitiateCheckout", "Lead", "Purchase",
      "Schedule", "Search", "StartTrial", "SubmitApplication", "Subscribe", "ViewContent",
      "PageView",
    ]);
    boot();
    track("view_item_list", { list_id: "shop", list_name: "Shop", item_count: 3, line_items: [{ product_id: "p1" }] });
    track("view_item", { product_id: "p1", name: "Olive", price: 24 });
    track("add_to_cart", { product_id: "p1", price: 24 });
    track("begin_checkout", { total: 48, items: 2, line_items: [{ product_id: "p1", price: 24, quantity: 2 }] });
    track("add_payment_info", { total: 48, line_items: [{ product_id: "p1", price: 24, quantity: 2 }] });
    track("search", { query: "candle" });
    track("signup", { method: "email" });
    track("newsletter_signup", {});

    for (const c of sent()) {
      if (c[0] === "track") expect(STANDARD.has(c[1] as string)).toBe(true);
      else expect(STANDARD.has(c[1] as string)).toBe(false);
    }
    expect(sentNames()).toEqual([
      "PageView", "ViewCategory", "ViewContent", "AddToCart",
      "InitiateCheckout", "AddPaymentInfo", "Search", "CompleteRegistration", "Lead",
    ]);
  });

  it("gives every event an id, so a future server copy can be deduplicated", () => {
    boot();
    track("view_item", { product_id: "p1", price: 24 });
    const ids = sent().map((c) => (c[3] as Record<string, unknown>).eventID);
    expect(ids.every((id) => typeof id === "string" && (id as string).length > 8)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length); // never reused
  });

  it("passes fbevents.js no option it doesn't document", () => {
    // Only `eventID`. The owner's Test Events code is a Conversions API
    // parameter and is deliberately not smuggled in here.
    boot();
    track("view_item", { product_id: "p1", price: 24 });
    for (const c of sent()) expect(Object.keys(c[3] as object)).toEqual(["eventID"]);
  });

  it("prices a product view in the shop's own currency", () => {
    // Left off, Meta reads the number against the ad account's currency — so an
    // account set up in dollars silently values a €38 candle at $38, and no
    // screen anywhere looks wrong.
    boot();
    track("view_item", { product_id: "p1", name: "Olive", price: 38, category: "Candles" });
    expect(paramsFor("ViewContent")).toEqual({
      content_type: "product",
      content_ids: ["p1"],
      contents: [{ id: "p1", quantity: 1, item_price: 38 }],
      content_name: "Olive",
      content_category: "Candles",
      currency: "EUR",
      value: 38,
    });
  });

  it("values an add-to-cart at what was actually added", () => {
    boot();
    track("add_to_cart", { product_id: "p1", name: "Olive", price: 24, quantity: 3 });
    const p = paramsFor("AddToCart")!;
    expect(p.value).toBe(72);
    expect(p.currency).toBe("EUR");
    expect(p.contents).toEqual([{ id: "p1", quantity: 3, item_price: 24 }]);
  });

  it("says nothing rather than zero when a price is unknown", () => {
    // `value: 0` is a product Meta will treat as worthless and optimise towards
    // accordingly, and nothing downstream would ever flag it.
    boot();
    track("view_item", { product_id: "p1", name: "Olive" });
    const p = paramsFor("ViewContent")!;
    expect(p.value).toBeUndefined();
    expect(p.currency).toBeUndefined();
    expect((p.contents as Record<string, unknown>[])[0].item_price).toBeUndefined();
  });

  it("carries the whole basket into checkout", () => {
    boot();
    track("begin_checkout", {
      total: 86,
      items: 3,
      line_items: [
        { product_id: "p1", price: 24, quantity: 2 },
        { product_id: "p2", price: 38, quantity: 1 },
      ],
    });
    expect(paramsFor("InitiateCheckout")).toEqual({
      content_type: "product",
      content_ids: ["p1", "p2"],
      contents: [
        { id: "p1", quantity: 2, item_price: 24 },
        { id: "p2", quantity: 1, item_price: 38 },
      ],
      num_items: 3,
      currency: "EUR",
      value: 86,
    });
  });

  it("omits an unnamed grid's category rather than reporting a blank one", () => {
    // An empty string is a real row in Meta's category reports, named nothing,
    // that every unnamed grid on the site accumulates into.
    boot();
    track("view_item_list", { list_id: "x", line_items: [{ product_id: "p1" }] });
    expect(paramsFor("ViewCategory")).not.toHaveProperty("content_category");
  });

  it("says nothing at all rather than reporting an empty search", () => {
    boot();
    track("search", { query: "" });
    expect(sentNames()).not.toContain("Search");
  });

  it("omits num_items rather than claiming a checkout held nothing", () => {
    // `num_items: 0` is a checkout Meta reports as containing nothing, averaged
    // into basket size and indistinguishable from a real empty one.
    boot();
    track("begin_checkout", { total: 24 });
    expect(paramsFor("InitiateCheckout")).not.toHaveProperty("num_items");
  });

  it("sends a newsletter signup as a Lead, not a Subscribe", () => {
    // Meta's `Subscribe` means a paid subscription and carries a value.
    // Reporting an email address as one puts phantom revenue in Events Manager.
    boot();
    track("newsletter_signup", {});
    expect(paramsFor("Lead")).toEqual({ content_name: "newsletter" });
    expect(sentNames()).not.toContain("Subscribe");
  });

  it("stays quiet about everything with no advertising meaning", () => {
    boot();
    track("select_item", { product_id: "p1" });
    track("remove_from_cart", { product_id: "p1", price: 24 });
    track("view_cart", { total: 24 });
    track("checkout_gate", { outcome: "passed" });
    track("add_shipping_info", { total: 24 });
    track("login", { method: "email" });
    track("web_vital", { metric: "LCP", value: 1112 });
    track("user_engagement", { engagement_time_msec: 4000 });
    expect(sentNames()).toEqual(["PageView"]);
  });

  it("keeps the shopping events out when the owner turns them off", () => {
    writeCookieConsent("accepted");
    configureMetaPixel({ ...ON, track_ecommerce: false });
    startMetaPixelMirror();
    track("view_item", { product_id: "p1", price: 24 });
    track("add_to_cart", { product_id: "p1", price: 24 });
    track("begin_checkout", { total: 24 });
    track("search", { query: "candle" });
    track("signup", { method: "email" });
    // Page views, searches and sign-ups only.
    expect(sentNames()).toEqual(["PageView", "Search", "CompleteRegistration"]);
  });
});

describe("the mapping in isolation", () => {
  it("returns null for everything Meta should not receive", () => {
    for (const type of ["select_item", "remove_from_cart", "view_cart", "checkout_gate",
      "add_shipping_info", "login", "user_engagement", "web_vital", "page_view"] as const) {
      expect(toMetaEvent(type, {})).toBeNull();
    }
  });

  it("marks the one event that is ours, not Meta's", () => {
    const mapped = toMetaEvent("view_item_list", { list_name: "Shop", line_items: [{ product_id: "p1" }] });
    expect(mapped).toMatchObject({ name: "ViewCategory", custom: true });
  });

  it("caps how much of a grid it describes", () => {
    // A category impression is a retargeting signal, not an inventory dump: the
    // shop page can show forty cards, and forty ids in every PageView-adjacent
    // event is payload for no extra meaning.
    const line_items = Array.from({ length: 25 }, (_, i) => ({ product_id: `p${i}` }));
    const mapped = toMetaEvent("view_item_list", { list_name: "Shop", line_items });
    expect((mapped!.params.content_ids as string[]).length).toBe(10);
  });
});

describe("what checkout forwards to the server", () => {
  it("forwards nothing at all when the pixel never ran", () => {
    // A shop with the pixel off — or a visitor who declined — must not have
    // identifiers collected about them and posted to our own API either.
    document.cookie = "_fbp=fb.1.1787691830.1098115397";
    expect(getMetaIds()).toEqual({});
  });

  it("states the permission, and the two cookies Meta matches on", () => {
    writeCookieConsent("accepted");
    document.cookie = "_fbp=fb.1.1787691830.1098115397";
    document.cookie = "_fbc=fb.1.1787691830.IwAR2abcDEF";
    configureMetaPixel(ON);
    expect(getMetaIds()).toEqual({
      meta_consent: true,
      fbp: "fb.1.1787691830.1098115397",
      fbc: "fb.1.1787691830.IwAR2abcDEF",
    });
  });

  it("says the permission even when an ad blocker ate the cookies", () => {
    // Inferring consent from a cookie's existence would silence exactly the
    // sales the Conversions API exists to recover.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    expect(getMetaIds()).toEqual({ meta_consent: true });
  });

  it("keeps the ad click when Safari has expired the cookie", () => {
    // `_fbc` is a script-set first-party cookie, which ITP caps at seven days —
    // and a shopper who clicks an ad, thinks about a €60 candle for a fortnight
    // and then buys is exactly the journey a shop most wants attributed.
    writeCookieConsent("accepted");
    window.history.replaceState({}, "", "/?fbclid=IwAR2rememberme");
    configureMetaPixel(ON);
    clearCookies();
    const ids = getMetaIds();
    expect(ids.fbc).toMatch(/^fb\.1\.\d+\.IwAR2rememberme$/);
  });

  it("prefers the cookie the pixel itself wrote", () => {
    writeCookieConsent("accepted");
    window.history.replaceState({}, "", "/?fbclid=IwAR2fromtheurl");
    configureMetaPixel(ON);
    document.cookie = "_fbc=fb.1.1787691830.IwAR2fromthecookie";
    expect(getMetaIds().fbc).toBe("fb.1.1787691830.IwAR2fromthecookie");
  });
});

describe("the ad click that paid for the visit", () => {
  // The single most expensive thing this file can get wrong. Every other failure
  // shows up as a missing event; this one shows up as a real sale, correctly
  // reported, correctly matched to a real person — and credited to no campaign,
  // so the ad that earned it looks like it earned nothing.
  it("keeps the click even when consent is answered a page later", () => {
    // Land from an ad. The banner hasn't been answered, so nothing may load and
    // nothing may be stored.
    window.history.replaceState({}, "", "/?fbclid=IwAR2fromthead");
    resetMetaPixelForTests(); // i.e. this document loaded at that URL
    expect(configureMetaPixel(ON)).toBe("awaiting_consent");
    expect(localStorage.getItem("og_meta_fbclid")).toBeNull();

    // They browse to a candle first — the router replaces the query string, and
    // with it the only copy of the click id the page ever had — and accept there.
    window.history.replaceState({}, "", "/product/olive");
    writeCookieConsent("accepted");
    applyMetaPixelConsent(ON, true);

    expect(getMetaIds().fbc).toMatch(/^fb\.1\.\d+\.IwAR2fromthead$/);
  });

  it("stores nothing about a visitor who says no", () => {
    window.history.replaceState({}, "", "/?fbclid=IwAR2fromthead");
    resetMetaPixelForTests();
    configureMetaPixel(ON);
    writeCookieConsent("declined");
    applyMetaPixelConsent(ON, false);
    expect(localStorage.getItem("og_meta_fbclid")).toBeNull();
    expect(getMetaIds()).toEqual({});
  });

  it("dates the click when it happened, not when it was last looked at", () => {
    // `fb.1.<timestamp>.<id>` — the timestamp is how Meta ages an fbc against
    // the attribution window. configureMetaPixel runs again on every settings
    // change, so re-stamping would walk a Tuesday's click forward to Friday.
    writeCookieConsent("accepted");
    window.history.replaceState({}, "", "/?fbclid=IwAR2stableclick");
    configureMetaPixel(ON);
    const first = localStorage.getItem("og_meta_fbclid");

    configureMetaPixel({ ...ON, advanced_matching: false });
    applyMetaPixelConsent(ON, true);

    expect(localStorage.getItem("og_meta_fbclid")).toBe(first);
  });
});

describe("a visit that is switched off and on again", () => {
  it("reports the page it comes back on", () => {
    // Both halves of "blocked" have to forget the last page reported, or a pixel
    // that resumes while the shopper is still standing where it stopped dedupes
    // its own landing page away and the resumed visit has none at all.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    expect(sentNames()).toContain("PageView");

    applyMetaPixelConsent(ON, false);
    const before = sentNames().length;
    applyMetaPixelConsent(ON, true);

    expect(sentNames().slice(before)).toContain("PageView");
  });
});

describe("search", () => {
  it("carries the products it turned up, so the term is retargetable", () => {
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    track("search", { query: "olive", results: 2, result_ids: ["p1", "p2"] });
    expect(paramsFor("Search")).toEqual({
      search_string: "olive",
      content_type: "product",
      content_ids: ["p1", "p2"],
    });
  });

  it("still reports a search that found nothing at all", () => {
    // The one search result worth acting on. An empty content_ids must not turn
    // it into no event.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    track("search", { query: "lavender", results: 0, result_ids: [] });
    expect(paramsFor("Search")).toEqual({ search_string: "lavender" });
  });

  it("caps how many it names", () => {
    expect(
      (toMetaEvent("search", {
        query: "candle",
        result_ids: Array.from({ length: 40 }, (_, i) => `p${i}`),
      })!.params.content_ids as string[]).length
    ).toBe(10);
  });
});

describe("the purchase, from the browser", () => {
  const ORDER = {
    orderId: "0f2a51c4-9d3b-4a0e-8d61-2b7c1e5a44f0",
    total: "29.99",
    items: [
      { product_id: "p1", quantity: 2, price: 12.5 },
      { product_id: "p2", quantity: 1, price: 4.99 },
    ],
  };

  it("uses the exact event id the server stamps on its own copy", () => {
    // Meta deduplicates on event name + event id, and there is no error for
    // getting this wrong — the shop's revenue simply doubles. The two live in
    // different languages in different files, so they are pinned to each other
    // here rather than trusted to stay in step.
    const backend = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../backend/index.js"),
      "utf8"
    );
    expect(backend).toContain("event_id: `order-${order.id}`");
    expect(metaPurchaseEventId("abc")).toBe("order-abc");
  });

  it("sends the sale with the value, the basket and that id", () => {
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    mirrorMetaPurchase(ORDER);

    expect(paramsFor("Purchase")).toEqual({
      currency: "EUR",
      value: 29.99,
      content_type: "product",
      content_ids: ["p1", "p2"],
      contents: [
        { id: "p1", quantity: 2, item_price: 12.5 },
        { id: "p2", quantity: 1, item_price: 4.99 },
      ],
      num_items: 3,
      order_id: ORDER.orderId,
    });
    expect(optsFor("Purchase")).toEqual({ eventID: `order-${ORDER.orderId}` });
  });

  it("holds a sale that arrives before the pixel has booted, then sends it", () => {
    // THE RACE THIS EXISTS FOR. The success page polls for the finalized order,
    // and when the Stripe webhook has already won, that poll returns in a few
    // hundred milliseconds — while the pixel is deliberately slower, because it
    // waits for the signed-in session so advanced matching lands in its one and
    // only init. Dropped rather than held, the browser's copy of the sale is
    // lost exactly when the server is fast. Reproduced on the wire before this
    // guard existed: the same end-to-end test passed once and failed once, on
    // nothing but who won that race.
    writeCookieConsent("accepted");
    mirrorMetaPurchase(ORDER);            // pixel not configured yet
    expect(window.fbq).toBeUndefined();   // nothing sent, nothing lost

    configureMetaPixel(ON);               // the pixel comes up
    expect(sentNames().filter((n) => n === "Purchase")).toHaveLength(1);
    expect(optsFor("Purchase")).toEqual({ eventID: `order-${ORDER.orderId}` });
    expect(paramsFor("Purchase")!.value).toBe(29.99);
  });

  it("sends a held sale after the browsing that produced it, not before", () => {
    // Meta reads the order events arrive in. A Purchase that lands ahead of the
    // ViewContent and AddToCart it followed describes a funnel that ran backwards.
    writeCookieConsent("accepted");
    startMetaPixelMirror();
    track("view_item", { product_id: "p1", name: "Olive", price: 24 });
    mirrorMetaPurchase(ORDER);
    configureMetaPixel(ON);

    const names = sentNames();
    expect(names.indexOf("Purchase")).toBeGreaterThan(names.indexOf("ViewContent"));
  });

  it("never sends a held sale to a shopper who then declines", () => {
    // The settled flag, applied to the sale. A visitor who says no does not get
    // their purchase sent a moment later because the tag made its mind up after
    // the page did.
    mirrorMetaPurchase(ORDER);          // held — consent not answered yet
    writeCookieConsent("declined");
    applyMetaPixelConsent(ON, false);
    configureMetaPixel(ON);
    expect(window.fbq).toBeUndefined();
    expect(sentNames()).not.toContain("Purchase");
  });

  it("never sends a held sale twice, however the pixel is re-configured", () => {
    writeCookieConsent("accepted");
    mirrorMetaPurchase(ORDER);
    configureMetaPixel(ON);
    configureMetaPixel(ON);
    configureMetaPixel({ ...ON, debug: true } as typeof ON);
    expect(sentNames().filter((n) => n === "Purchase")).toHaveLength(1);
  });

  it("holds only the sale, never a growing queue of them", () => {
    // One slot, not a list: there is only ever one purchase in flight, and an
    // unbounded buffer on the money path is not a thing to leave lying around.
    writeCookieConsent("accepted");
    mirrorMetaPurchase({ ...ORDER, orderId: "order-a" });
    mirrorMetaPurchase({ ...ORDER, orderId: "order-b" });
    configureMetaPixel(ON);
    expect(sentNames().filter((n) => n === "Purchase")).toHaveLength(1);
    expect(paramsFor("Purchase")!.order_id).toBe("order-b");
  });

  it("reports one order once, however often the page asks", () => {
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    mirrorMetaPurchase(ORDER);
    mirrorMetaPurchase(ORDER);
    mirrorMetaPurchase(ORDER);
    expect(sentNames().filter((n) => n === "Purchase")).toHaveLength(1);
  });

  it("says nothing when the pixel never ran for this shopper", () => {
    // The server's copy is gated on the same permission (`meta_consent`), so a
    // sale is reported by both halves or by neither.
    configureMetaPixel(ON); // no consent
    mirrorMetaPurchase(ORDER);
    expect(sentNames()).not.toContain("Purchase");
  });

  it("stays quiet when the owner turned the shopping events off", () => {
    writeCookieConsent("accepted");
    configureMetaPixel({ ...ON, track_ecommerce: false });
    mirrorMetaPurchase(ORDER);
    expect(sentNames()).not.toContain("Purchase");
  });

  it("refuses to report a sale it cannot price", () => {
    // A Purchase with no value is not a smaller signal than a priced one — it is
    // a conversion that earned nothing, and it drags reported ROAS down for real.
    writeCookieConsent("accepted");
    configureMetaPixel(ON);
    mirrorMetaPurchase({ ...ORDER, total: "€ unknown" });
    expect(sentNames()).not.toContain("Purchase");
  });
});
