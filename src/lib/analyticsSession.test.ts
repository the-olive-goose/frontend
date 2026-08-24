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
describe("marking a device with a link", () => {
  const withUrl = (search: string) => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", { href: `https://shop.test/shop${search}`, pathname: "/shop", search, hash: "" });
    vi.stubGlobal("history", { replaceState });
    return replaceState;
  };

  it("marks the browser and takes the parameter back out of the address bar", async () => {
    const replaceState = withUrl("?not-a-shopper=1");
    const mod = await newTab();
    mod.initAnalytics();
    expect(mod.isInternalBrowser()).toBe(true);
    expect(replaceState).toHaveBeenCalledWith({}, "", "/shop");
  });

  it("keeps the rest of the query string", async () => {
    const replaceState = withUrl("?utm_source=insta&not-a-shopper=1");
    const mod = await newTab();
    mod.initAnalytics();
    expect(replaceState).toHaveBeenCalledWith({}, "", "/shop?utm_source=insta");
  });

  it("undoes it on that device with =0", async () => {
    withUrl("?not-a-shopper=1");
    const first = await newTab();
    first.initAnalytics();
    expect(first.isInternalBrowser()).toBe(true);

    withUrl("?not-a-shopper=0");
    const second = await newTab();
    second.initAnalytics();
    expect(second.isInternalBrowser()).toBe(false);
  });

  it("leaves an ordinary visit alone", async () => {
    withUrl("?utm_source=insta");
    const mod = await newTab();
    mod.initAnalytics();
    expect(mod.isInternalBrowser()).toBe(false);
  });
});

// A browser that has been used to administer the shop is the shop's, wherever it
// looks like it is browsing from — the one signal a VPN cannot defeat, because
// it has nothing to do with the address a visit arrives from.
describe("a browser that administers the shop", () => {
  it("excludes itself without anyone marking it", async () => {
    localStorage.setItem("admin_token", "a.b.c");
    const mod = await newTab();
    expect(mod.isAdminBrowser()).toBe(true);
    mod.initAnalytics();
    // Promoted to the ordinary marker, so it stays excluded after signing out
    // of admin rather than quietly rejoining the shopper numbers.
    expect(mod.isInternalBrowser()).toBe(true);
  });

  it("does not claim an ordinary browser", async () => {
    const mod = await newTab();
    expect(mod.isAdminBrowser()).toBe(false);
    mod.initAnalytics();
    expect(mod.isInternalBrowser()).toBe(false);
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
