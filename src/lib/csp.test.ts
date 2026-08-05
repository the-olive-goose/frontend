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
  // asserted as an exact value rather than a set of "not" checks: script-src is
  // 'self' and nothing else. The shop's analytics is first-party
  // (src/lib/analytics.ts posts to our own API), so no third-party script host
  // has any reason to appear here. A GA4 tag was briefly wired up and widened
  // this to allow googletagmanager.com; it was removed, and this test is what
  // stops that host — or any other — creeping back in unnoticed.
  it("locks script-src to 'self' with no third-party hosts", () => {
    const policy = load();
    expect(policy["script-src"]).toEqual(["'self'"]);
  });

  it("blocks a third-party tag host outright", () => {
    const policy = load();
    expect(
      allows(policy, "script-src", "https://www.googletagmanager.com/gtag/js?id=G-ABC1234567")
    ).toBe(false);
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
