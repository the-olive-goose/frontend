import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// The event vocabulary exists twice: `EventType` here in the storefront, and
// CLIENT_EVENT_TYPES in backend/index.js, which is an allow-list — an event
// whose name the backend doesn't recognise is dropped on ingestion, silently
// and permanently.
//
// That makes drift here uniquely expensive. Every other kind of mismatch shows
// up as an error somewhere; this one shows up as a metric that reads zero, or
// a funnel stage that quietly stops filling, months later, with no way to
// recover the events that were thrown away in the meantime. Nothing else in the
// stack notices — the backend answers 204, the client thinks it reported, and
// the dashboard draws a confident line through data that was never written.
//
// So the two lists are pinned together here, and so are the event names the
// dashboard's own SQL depends on.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const backendSrc = readFileSync(path.join(REPO, "backend/index.js"), "utf8");
const clientSrc = readFileSync(path.join(REPO, "src/lib/analytics.ts"), "utf8");
const apiSrc = readFileSync(path.join(REPO, "src/lib/api.ts"), "utf8");
const adminSrc = readFileSync(path.join(REPO, "src/pages/AdminDashboard.tsx"), "utf8");
const gaSrc = readFileSync(path.join(REPO, "src/lib/ga.ts"), "utf8");
const metaSrc = readFileSync(path.join(REPO, "src/lib/meta.ts"), "utf8");

/** The names the API will accept and store. */
const serverTypes = (): string[] => {
  const block = backendSrc.match(/const CLIENT_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error("CLIENT_EVENT_TYPES not found in backend/index.js");
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
};

/** The names the storefront can emit. */
const clientTypes = (): string[] => {
  const block = clientSrc.match(/export type EventType =([\s\S]*?);\n/);
  if (!block) throw new Error("EventType not found in src/lib/analytics.ts");
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
};

describe("analytics event vocabulary", () => {
  it("is the same list on both sides", () => {
    expect([...new Set(clientTypes())].sort()).toEqual([...new Set(serverTypes())].sort());
  });

  it("finds a non-empty list on each side", () => {
    // Guards the extraction itself: two empty arrays would compare equal and
    // this file would pass while checking nothing.
    expect(serverTypes().length).toBeGreaterThan(10);
    expect(clientTypes().length).toBeGreaterThan(10);
  });

  it("only counts engagement for events that can actually arrive", () => {
    // The bounce rule lists the events that mean a shopper did something
    // deliberate. A name that no longer exists silently stops matching, and
    // every session it described becomes a bounce.
    const block = backendSrc.match(/BOOL_OR\(event_type IN \(([\s\S]*?)\)\) AS engaged/);
    expect(block).toBeTruthy();
    const engaged = [...block![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    expect(engaged.length).toBeGreaterThan(0);
    // 'purchase' is written server-side, so it is deliberately not in the
    // client allow-list — every other name must be something a browser sends.
    const known = new Set([...serverTypes(), "purchase"]);
    expect(engaged.filter(e => !known.has(e))).toEqual([]);
  });

  it("knows where the admin token is kept", () => {
    // isAdminBrowser() is what stops the owner's own devices counting as
    // shoppers, and it works by looking for api.ts's admin token in
    // localStorage under a key it spells out for itself rather than imports.
    //
    // A rename in api.ts would therefore break it in complete silence: no type
    // error, no failing request, no console warning — just the shop quietly
    // going back to counting its owner as traffic, which is the one defect
    // nothing on the dashboard can reveal because the numbers only get bigger.
    const apiKey = apiSrc.match(/localStorage\.getItem\('([^']+)'\)/)?.[1];
    const analyticsKey = clientSrc.match(/const ADMIN_TOKEN_KEY = '([^']+)'/)?.[1];
    expect(apiKey).toBeTruthy();
    expect(analyticsKey).toBe(apiKey);
  });

  it("does not let the admin panel mark the browser that opened it", () => {
    // The reverse of what this used to pin, and pinned just as hard.
    //
    // Opening the dashboard used to flag that browser as the shop's own — locally
    // and on the server — and the flag reached backwards through everything it
    // had ever recorded. It also gated the GA4 tag and the Meta Pixel, so looking
    // at your own numbers once stopped both firing for you on the real site,
    // permanently and silently, while the shop's own analytics carried on
    // counting you: two measurement systems disagreeing for a reason nothing on
    // screen could explain.
    //
    // The live shop is the live shop. Work happens on localhost, which is
    // recorded under its own hostname and never reaches the figures, and a single
    // visit can still be taken out by hand from Recent visits. Re-adding either
    // of these calls would break nothing visible and fail no other test.
    expect(adminSrc).not.toMatch(/setInternalBrowser\(/);
    expect(adminSrc).not.toMatch(/setAnalyticsInternalBrowser\(/);
  });

  it("gates the third-party tags on the hostname, not on a flag in the browser", () => {
    // Both tags must ask the same question about whether to LOAD AT ALL, and it
    // must be about WHERE the page is, not about who is looking at it. Gating on
    // a browser flag is what silently killed measurement for good on any device
    // that had once opened the admin panel.
    for (const src of [gaSrc, metaSrc]) {
      expect(src).toMatch(/isDevelopmentOrigin\(\)/);
      // The retired per-browser flag, gone with the rule it fed.
      expect(src).not.toMatch(/isInternalBrowser\(/);
      // No blocked-reason may be derived from who the browser belongs to.
      expect(src).not.toMatch(/isAdminBrowser\(\)\)\s*return/);
    }
  });

  it("asks the consent module the question, rather than reading its key", () => {
    // Both tags must decide "declined" vs "not asked yet" through
    // cookieBannerAnswered, which is the only reader that knows a choice
    // EXPIRES. A local `localStorage.getItem('og_cookie_consent') !== null`
    // answers a different question — "is there a value there" — and so reports
    // a six-month-old refusal, or an unreadable one, as a settled no.
    //
    // The cost is a panel that states the wrong reason for its own silence:
    // the owner is told a visitor refused when nobody has been asked since
    // the answer lapsed. It was fixed in meta.ts and left standing in ga.ts,
    // which is exactly the drift this file exists to catch — the two gates are
    // written to be identical and nothing else compares them.
    for (const src of [gaSrc, metaSrc]) {
      expect(src).toMatch(/cookieBannerAnswered\(\)/);
      expect(src).not.toMatch(/getItem\(\s*'og_cookie_consent'\s*\)/);
    }
  });

  it("labels the owner's own live-site visits rather than hiding them", () => {
    // The other half of the same decision, and the half that is easy to lose.
    //
    // Not blocking the owner is right — but it leaves their browsing in the
    // property, and these numbers go to investors. GA4's own hook for that is
    // `traffic_type: 'internal'`, which its Internal Traffic filter matches on:
    // the events still exist, so nothing is silently missing, and the exclusion
    // happens where it can be seen and undone.
    //
    // Delete this and the shop counts itself, in the one report it cannot
    // afford to have wrong, with nothing on screen to reveal it.
    expect(gaSrc).toMatch(/traffic_type: 'internal'/);
    expect(gaSrc).toMatch(/isAdminBrowser\(\)\s*\?\s*\{\s*traffic_type/);
  });

  it("builds the funnel from events the API accepts", () => {
    // Every event_type the dashboard query compares against, anywhere.
    const compared = [...backendSrc.matchAll(/event_type\s*(?:=|<>|IN|NOT IN)\s*\(?\s*((?:'[a-z_]+'\s*,?\s*)+)/g)]
      .flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
    expect(compared.length).toBeGreaterThan(5);
    const known = new Set([...serverTypes(), "purchase"]);
    expect([...new Set(compared)].filter(e => !known.has(e))).toEqual([]);
  });
});
