import { describe, it, expect, beforeEach } from "vitest";
import {
  applyBranding,
  applyMeta,
  isRouteLevelMetaCurrent,
  metaForPath,
  setSeoSettings,
  DEFAULT_SEO,
  ROUTE_META,
  SITE_NAME,
  type SeoSettings,
} from "@/lib/seo";

const seo = (o: Partial<SeoSettings> = {}): SeoSettings => ({ ...DEFAULT_SEO, ...o });

const metaContent = (selector: string) =>
  document.head.querySelector<HTMLMetaElement>(selector)?.getAttribute("content");

beforeEach(() => {
  document.head.innerHTML = "";
  setSeoSettings(DEFAULT_SEO);
});

describe("metaForPath", () => {
  it("returns the built-in copy — titles/descriptions are not admin-configurable", () => {
    setSeoSettings(seo({ site_name: "Goose Candles" }));
    expect(metaForPath("/")).toEqual(ROUTE_META["/"]);
    expect(metaForPath("/products/matcha-hour")).toEqual(ROUTE_META["/products/*"]);
  });
});

describe("applyMeta", () => {
  it("writes the configured share image and site name", () => {
    setSeoSettings(seo({ site_name: "Goose Candles", og_image: "https://cdn.test/share.jpg" }));
    applyMeta({ ...metaForPath("/"), path: "/", routeLevel: true });

    expect(metaContent('meta[property="og:image"]')).toBe("https://cdn.test/share.jpg");
    expect(metaContent('meta[name="twitter:image"]')).toBe("https://cdn.test/share.jpg");
    expect(metaContent('meta[property="og:site_name"]')).toBe("Goose Candles");
  });

  it("lets a page-level image win over the configured default", () => {
    setSeoSettings(seo({ og_image: "https://cdn.test/share.jpg" }));
    applyMeta({ ...metaForPath("/products/x"), path: "/products/x", ogImage: "https://cdn.test/candle.jpg" });
    expect(metaContent('meta[property="og:image"]')).toBe("https://cdn.test/candle.jpg");
  });

  // SeoManager re-applies route meta when the settings arrive; this flag is how
  // it knows a product page already wrote its own title in the meantime.
  it("tracks whether the current meta is route-level or page-level", () => {
    applyMeta({ ...metaForPath("/products/x"), path: "/products/x", routeLevel: true });
    expect(isRouteLevelMetaCurrent()).toBe(true);

    applyMeta({ title: "Matcha Hour", description: "A candle.", path: "/products/x" });
    expect(isRouteLevelMetaCurrent()).toBe(false);
  });
});

describe("applyBranding", () => {
  const organizationJsonLd = () => {
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = "site-organization-jsonld";
    el.textContent = JSON.stringify({ "@type": "Organization", name: SITE_NAME, logo: "https://old/logo.png" });
    document.head.appendChild(el);
    return el;
  };

  it("replaces the shipped icons with the configured favicon", () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.ico" sizes="48x48" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" />';
    setSeoSettings(seo({ favicon_url: "https://cdn.test/icon.png" }));
    applyBranding();

    const icons = [...document.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')];
    expect(icons).toHaveLength(2);
    expect(icons.every((el) => el.getAttribute("href") === "https://cdn.test/icon.png")).toBe(true);
  });

  it("keeps the shipped icons when no favicon is configured", () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.ico" sizes="48x48" />';
    applyBranding();
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/favicon.ico");
  });

  it("patches the organization logo and name in the static JSON-LD", () => {
    const el = organizationJsonLd();
    setSeoSettings(seo({ site_name: "Goose Candles", logo_url: "https://cdn.test/logo.png" }));
    applyBranding();

    expect(JSON.parse(el.textContent!)).toMatchObject({
      "@type": "Organization",
      name: "Goose Candles",
      logo: "https://cdn.test/logo.png",
    });
  });

  it("leaves a malformed JSON-LD block untouched rather than blanking it", () => {
    const el = organizationJsonLd();
    el.textContent = "{not json";
    setSeoSettings(seo({ logo_url: "https://cdn.test/logo.png" }));
    applyBranding();
    expect(el.textContent).toBe("{not json");
  });
});
