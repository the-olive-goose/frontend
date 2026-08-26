// The production Content-Security-Policy is served by the host (Netlify reads
// public/_headers; the Vercel config mirrors it), so it exists nowhere in the app
// bundle and the dev server serves no CSP at all. That makes it invisible to both
// the unit suite and the Playwright e2e run — a directive that blocks a real
// feature ships green and only fails on the live site.
//
// This happened: frame-src was never listed, so embedded video fell back to
// default-src 'self' and every YouTube/Vimeo/Instagram reel the studio rail plays
// was blocked in production while working perfectly in dev.
//
// So: read the deployed policy off disk and assert it actually permits the URLs
// the app is capable of generating.
import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { toEmbedUrl } from "./defaults";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Parse a CSP header value into { directive: [source, …] }. */
const parseCsp = (header: string): Record<string, string[]> =>
  Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name.toLowerCase(), sources];
      })
  );

const netlifyCsp = () => {
  const headers = readFileSync(path.join(REPO_ROOT, "public", "_headers"), "utf8");
  const line = headers
    .split("\n")
    .find((l) => l.trim().toLowerCase().startsWith("content-security-policy:"));
  if (!line) throw new Error("no Content-Security-Policy in public/_headers");
  return parseCsp(line.slice(line.indexOf(":") + 1).trim());
};

const vercelCsp = () => {
  const cfg = JSON.parse(readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf8"));
  const header = cfg.headers
    .flatMap((h: { headers: { key: string; value: string }[] }) => h.headers)
    .find((h: { key: string }) => h.key === "Content-Security-Policy");
  if (!header) throw new Error("no Content-Security-Policy in vercel.json");
  return parseCsp(header.value);
};

// The third copy: backend/index.js sets the same headers on everything it
// serves. It matters because that server also serves the SPA — on the Railway
// origin directly, and on any deploy without the CDN in front — so a directive
// missing here blocks the same features the CDN copies allow. It drifted exactly
// that way: frame-src was added to _headers and vercel.json and never here.
const backendCsp = () => {
  const src = readFileSync(path.join(REPO_ROOT, "backend", "index.js"), "utf8");
  const block = src.match(/const CSP = \[([\s\S]*?)\]\.join\('; '\)/);
  if (!block) throw new Error("no CSP array in backend/index.js");
  const directives = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (!directives.length) throw new Error("CSP array in backend/index.js is empty");
  return parseCsp(directives.join("; "));
};

/**
 * Does `policy` allow `url` for `directive`, honouring the CSP fallback chain
 * (frame-src → child-src → default-src)?
 */
const allows = (policy: Record<string, string[]>, directive: string, url: string) => {
  const chain = directive === "frame-src" ? ["frame-src", "child-src", "default-src"] : [directive, "default-src"];
  const sources = chain.map((d) => policy[d]).find(Boolean);
  if (!sources) return true; // nothing constrains it
  const { origin, protocol } = new URL(url);
  return sources.some((s) => s === "*" || s === origin || s === protocol || s === `${protocol}//`);
};

// Every shape Admin → Content → Videos accepts, as the admin field's own
// placeholder advertises them.
const ADMIN_VIDEO_URLS = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtu.be/dQw4w9WgXcQ",
  "https://youtube.com/shorts/dQw4w9WgXcQ?si=JtZcqcmQ5AO_F7hs",
  "https://vimeo.com/76979871",
  "https://www.instagram.com/reel/DaAwNjpoSuB/",
  "https://www.instagram.com/p/DaAwNjpoSuB/",
];

describe.each([
  ["public/_headers (Netlify — live)", netlifyCsp],
  ["vercel.json", vercelCsp],
  ["backend/index.js (Railway origin + SPA fallback)", backendCsp],
])("%s CSP", (_name, load) => {
  it("frames every embed URL the video admin can produce", () => {
    const policy = load();
    const blocked = ADMIN_VIDEO_URLS.map((raw) => toEmbedUrl(raw)).filter(
      (embed) => !allows(policy, "frame-src", embed)
    );
    expect(blocked).toEqual([]);
  });

  it("still keeps frame-src to an explicit host allowlist", () => {
    const policy = load();
    // A blanket `https:` would pass the test above while re-opening the site to
    // being framed around arbitrary third-party content.
    expect(policy["frame-src"]).toBeDefined();
    expect(policy["frame-src"]).not.toContain("*");
    expect(policy["frame-src"]).not.toContain("https:");
  });

  it("reaches the API and Stripe over connect-src", () => {
    const policy = load();
    expect(allows(policy, "connect-src", "https://theolivegoose.ie/api/health")).toBe(true);
  });

  // Scripts are the one directive where a relaxation is game over, so this is
  // asserted as an exact value rather than a set of "not" checks: 'self' plus
  // the two tag hosts, in that order, and nothing else.
  //
  //   googletagmanager.com — gtag.js, for the optional GA4 tag (src/lib/ga.ts),
  //   connect.facebook.net — fbevents.js, for the optional Meta Pixel
  //                          (src/lib/meta.ts).
  //
  // Both are switched on by the owner in Admin → Analytics, and both are for
  // measurement the shop cannot do first-party — GA4 because the property is
  // Google's, Meta because ad attribution only exists inside Meta's own system.
  // The shop's own analytics remain first-party and need no script host at all.
  // If this list ever grows a fourth entry, that is a decision someone must make
  // on purpose — which is exactly what an exact-equality assertion forces.
  it("allows exactly 'self' and the two tag hosts, nothing more", () => {
    const policy = load();
    expect(policy["script-src"]).toEqual([
      "'self'",
      "https://www.googletagmanager.com",
      "https://connect.facebook.net",
    ]);
  });

  it("loads gtag.js for the GA4 tag", () => {
    const policy = load();
    expect(
      allows(policy, "script-src", "https://www.googletagmanager.com/gtag/js?id=G-ABC1234567")
    ).toBe(true);
  });

  it("loads fbevents.js, and the per-pixel config it pulls in after it", () => {
    const policy = load();
    // The install script is only the first request. fbevents.js then fetches the
    // pixel's own configuration and any plugins it needs from the same host —
    // allow the script and forget the config, and the pixel loads, reports
    // nothing, and gives no clue why.
    for (const url of [
      "https://connect.facebook.net/en_US/fbevents.js",
      "https://connect.facebook.net/signals/config/1234567890123456?v=2.9.180",
    ]) {
      expect(allows(policy, "script-src", url)).toBe(true);
    }
  });

  it("still blocks every other third-party tag host", () => {
    const policy = load();
    // The hosts a "just add this snippet" integration reaches for next.
    for (const url of [
      "https://cdn.segment.com/analytics.js/v1/abc/analytics.min.js",
      "https://static.hotjar.com/c/hotjar-123.js",
      "https://www.google-analytics.com/analytics.js",
      "https://analytics.tiktok.com/i18n/pixel/events.js",
      "https://snap.licdn.com/li.lms-analytics/insight.min.js",
      // Meta's TAG host is allowed; Meta's collection host is not a script host
      // and has no business serving one.
      "https://www.facebook.com/tr.js",
    ]) {
      expect(allows(policy, "script-src", url)).toBe(false);
    }
  });

  it("keeps inline and eval out of script-src", () => {
    const policy = load();
    // gtag.js needs neither, and a tag host is not a reason to hand one over.
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
    expect(policy["script-src"]).not.toContain("'unsafe-eval'");
    expect(policy["script-src"]).not.toContain("https:");
    expect(policy["script-src"]).not.toContain("*");
  });

  it("reaches GA4's collection endpoint over connect-src", () => {
    const policy = load();
    // gtag.js posts hits to this host; blocked here, the tag loads and silently
    // measures nothing.
    expect(allows(policy, "connect-src", "https://www.google-analytics.com/g/collect")).toBe(true);
    expect(allows(policy, "connect-src", "https://analytics.google.com/g/collect")).toBe(true);
  });

  it("reaches Meta's collection endpoint, by fetch and by image beacon", () => {
    const policy = load();
    // fbevents.js reports through https://www.facebook.com/tr — as a fetch where
    // it can and as an <img> where it can't, and it silently falls back between
    // them. Allowing one and not the other is a pixel that works in Chrome and
    // measures nothing in Safari, with no error in either.
    expect(allows(policy, "connect-src", "https://www.facebook.com/tr/")).toBe(true);
    expect(allows(policy, "img-src", "https://www.facebook.com/tr?id=1234567890123456&ev=PageView")).toBe(true);
  });
});

it("Netlify and Vercel serve the same policy", () => {
  expect(netlifyCsp()).toEqual(vercelCsp());
});

// Whichever origin answers, the SPA must run under the same rules — otherwise a
// feature works on one host and is silently blocked on the other.
it("the backend serves the same policy as the CDN copies", () => {
  expect(backendCsp()).toEqual(netlifyCsp());
});
