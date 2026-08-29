import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "@/test/memoryStorage";

/**
 * What counts as one analytics session.
 *
 * The rule is Shopify's `_shopify_s` and GA4's: thirty minutes of inactivity ends
 * a session, and every tab on the browser is in the SAME one. The second half is
 * what these pin down — the id used to live in sessionStorage, so a shopper
 * comparing three candles in three tabs was counted as three sessions and every
 * per-session average was measured against an inflated denominator.
 *
 * A tab is simulated by resetting the module (clearing its in-memory fallbacks)
 * while leaving the browser's storage in place — which is exactly what a second
 * tab of the same site sees.
 */

installMemoryStorage();

const SESSION_KEY = "og_analytics_sid";
const SESSION_LAST_SEEN_KEY = "og_analytics_last";
const UTM_KEY = "og_analytics_utm";
const MINUTE = 60 * 1000;

/** A fresh copy of the module, as a newly-opened tab would load it. */
const newTab = async () => {
  vi.resetModules();
  return import("./analytics");
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  // restoreAllMocks does NOT undo stubGlobal. Without this, the stubbed
  // location from the marker-link tests would leak into every test after them.
  vi.unstubAllGlobals();
});

describe("one session across tabs", () => {
  it("gives a second tab the same session id", async () => {
    const first = (await newTab()).getSessionId();
    const second = (await newTab()).getSessionId();
    expect(second).toBe(first);
  });

  it("keeps the campaign that brought them in when a second tab opens", async () => {
    // A session already under way: id and a recent touch, plus the campaign.
    localStorage.setItem(SESSION_KEY, "live-session");
    localStorage.setItem(SESSION_LAST_SEEN_KEY, String(Date.now() - MINUTE));
    localStorage.setItem(UTM_KEY, JSON.stringify({
      utm_source: "instagram", utm_medium: "social", utm_campaign: "candle-launch",
    }));
    const before = localStorage.getItem(UTM_KEY);

    expect((await newTab()).getSessionId()).toBe("live-session");
    expect(localStorage.getItem(UTM_KEY)).toBe(before);
  });
});

describe("when a session ends", () => {
  it("mints a new id after thirty minutes of inactivity", async () => {
    const first = (await newTab()).getSessionId();

    // Last activity was 31 minutes ago — they went away and came back.
    localStorage.setItem(SESSION_LAST_SEEN_KEY, String(Date.now() - 31 * MINUTE));
    localStorage.setItem(UTM_KEY, JSON.stringify({ utm_source: "instagram", utm_medium: "", utm_campaign: "" }));

    const second = (await newTab()).getSessionId();
    expect(second).not.toBe(first);
    // The old campaign is dropped, so a fresh visit is re-attributed from its own
    // landing URL rather than being credited to whatever brought them last time.
    expect(localStorage.getItem(UTM_KEY)).toBeNull();
  });

  it("holds the session together across a 29-minute gap", async () => {
    const first = (await newTab()).getSessionId();
    localStorage.setItem(SESSION_LAST_SEEN_KEY, String(Date.now() - 29 * MINUTE));
    expect((await newTab()).getSessionId()).toBe(first);
  });
});

describe("upgrading from the old tab-scoped id", () => {
  it("promotes an in-flight session rather than splitting it in two", async () => {
    // A visitor mid-session when this shipped: their id is in the old store.
    sessionStorage.setItem(SESSION_KEY, "legacy-session-id");
    sessionStorage.setItem(SESSION_LAST_SEEN_KEY, String(Date.now() - MINUTE));

    expect((await newTab()).getSessionId()).toBe("legacy-session-id");
    // …and it now lives where every tab can see it.
    expect(localStorage.getItem(SESSION_KEY)).toBe("legacy-session-id");
  });
});

// The last device the automatic rules can't reach: a household phone that never
// opens the admin panel, never signs in, and is on mobile data when it looks at
// the shop. Opening one link marks it — and the link must not then travel on in
// a bookmark or a shared URL, or it would silently exclude whoever opened it
// next, which is an under-count nothing on the dashboard could reveal.
// The live shop is the live shop. Nothing infers whose visit it is any more —
// not the address it arrives from, not the account signed in, and not a flag
// written into whatever browser opened the admin panel. Work happens on
// localhost, which is recorded under its own hostname and never reaches the
// shop's figures.
describe("what separates testing from trade", () => {
  const at = (hostname: string) => {
    vi.stubGlobal("location", { href: `https://${hostname}/shop`, hostname, pathname: "/shop", search: "", hash: "" });
  };

  it("the live shop is not a development origin", async () => {
    at("theolivegoose.ie");
    const mod = await newTab();
    expect(mod.isDevelopmentOrigin()).toBe(false);
  });

  it("localhost is", async () => {
    at("localhost");
    const mod = await newTab();
    expect(mod.isDevelopmentOrigin()).toBe(true);
  });

  it("…and so is the loopback address", async () => {
    at("127.0.0.1");
    const mod = await newTab();
    expect(mod.isDevelopmentOrigin()).toBe(true);
  });

  it("a browser that administers the shop is still an ordinary visitor on it", async () => {
    // This is the one that used to go wrong, and it went wrong permanently:
    // opening the admin panel flagged the browser, the flag reached backwards
    // through everything it had ever recorded, and it also stopped the GA4 tag
    // and the Meta Pixel firing for the owner on the real site for good.
    at("theolivegoose.ie");
    localStorage.setItem("admin_token", "a.b.c");
    const mod = await newTab();
    expect(mod.isAdminBrowser()).toBe(true);
    mod.initAnalytics();
    expect(mod.isDevelopmentOrigin()).toBe(false);
  });

  it("does not rewrite the address bar on an ordinary visit", async () => {
    // The ?not-a-shopper= marker link is gone with the rule it fed.
    const replaceState = vi.fn();
    at("theolivegoose.ie");
    vi.stubGlobal("history", { replaceState });
    const mod = await newTab();
    mod.initAnalytics();
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("when the browser refuses storage", () => {
  it("still resolves one id for the pageload instead of one per event", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });

    const tab = await newTab();
    expect(tab.getSessionId()).toBe(tab.getSessionId());
  });
});
