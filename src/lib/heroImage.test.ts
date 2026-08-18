import { describe, expect, it } from "vitest";
import { buildHeroImageSources } from "./heroImage";
import { CLOUDINARY_CLOUD, originalImageUrl } from "./cloudinaryImage";

/**
 * What each screen is sent for the hero photograph.
 *
 * The property that matters is not which numbers come out — those follow the
 * hero's heights and will move with them — but that a phone is never handed a
 * full-width photograph to crop itself, and that a photo Cloudinary cannot
 * reach still reaches the visitor.
 */

const IBB = "https://i.ibb.co/abc/hero.png";
const FETCH = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch`;
const UPLOAD = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload`;

/** Every URL in a srcSet, paired with the width descriptor it was offered at. */
const entries = (srcSet: string) =>
  srcSet.split(", ").map(entry => {
    const [url, descriptor] = entry.split(" ");
    return { url, width: Number(descriptor.replace("w", "")) };
  });

/** The `w_`/`h_` Cloudinary was asked for. */
const size = (url: string) => ({
  w: Number(url.match(/[,/]w_(\d+)/)![1]),
  h: Number(url.match(/[,/]h_(\d+)/)![1]),
});

describe("buildHeroImageSources", () => {
  it("offers a phone band and a tablet band, narrowest first", () => {
    const sources = buildHeroImageSources(IBB);

    expect(sources.map(s => s.media)).toEqual([
      "(max-width: 639px)",
      "(max-width: 1023px)",
    ]);
  });

  it("asks for a tall rectangle on phones and a wide one on tablets", () => {
    const [phone, tablet] = buildHeroImageSources(IBB);

    // The hero is 440px tall on a phone and 620px on a tablet, so the phone's
    // share of a wide photograph is the taller shape of the two.
    for (const { url } of entries(phone.srcSet)) {
      const { w, h } = size(url);
      expect(h).toBeGreaterThan(w);
    }
    for (const { url } of entries(tablet.srcSet)) {
      const { w, h } = size(url);
      expect(w).toBeGreaterThan(h);
    }
  });

  it("crops from the centre in both bands", () => {
    for (const source of buildHeroImageSources(IBB)) {
      for (const { url } of entries(source.srcSet)) {
        expect(url, url).toContain("c_fill,g_center");
      }
    }
  });

  it("labels every copy with the width it really is", () => {
    for (const source of buildHeroImageSources(IBB)) {
      for (const { url, width } of entries(source.srcSet)) {
        expect(size(url).w, url).toBe(width);
      }
    }
  });

  it("covers 1x through 3x screens in each band", () => {
    for (const source of buildHeroImageSources(IBB)) {
      const widths = entries(source.srcSet).map(e => e.width);
      expect(widths.length).toBeGreaterThanOrEqual(3);
      // Ascending, and the widest is at least triple the narrowest.
      expect([...widths].sort((a, b) => a - b)).toEqual(widths);
      expect(widths[widths.length - 1] / widths[0]).toBeGreaterThanOrEqual(2);
    }
  });

  it("never reframes the shot", () => {
    for (const source of buildHeroImageSources(IBB)) {
      for (const { url } of entries(source.srcSet)) {
        // Picking a different part of the photograph to show is a composition
        // decision, not a delivery one.
        expect(url, url).not.toContain("g_auto");
      }
    }
  });

  it("cuts every rendition from the original, not from a chain already on it", () => {
    const alreadyOptimised = `${FETCH}/f_auto,q_auto,w_1600,c_limit/${IBB}`;

    for (const source of buildHeroImageSources(alreadyOptimised)) {
      for (const { url } of entries(source.srcSet)) {
        // A doubly-wrapped fetch URL is a 400 from Cloudinary, and a stacked
        // width would fight the one being asked for here.
        expect(originalImageUrl(url), url).toBe(IBB);
        expect(url, url).not.toContain("w_1600,c_limit");
      }
    }
  });

  it("re-delivers an image already on Cloudinary through upload, not fetch", () => {
    const [phone] = buildHeroImageSources(`${UPLOAD}/w_1600,c_limit/v1/hero.jpg`);

    for (const { url } of entries(phone.srcSet)) {
      expect(url, url).toContain(`${UPLOAD}/`);
      expect(url, url).not.toContain("/image/fetch/");
      expect(url, url).toMatch(/\/v1\/hero\.jpg$/);
    }
  });

  it("offers nothing for a photo Cloudinary cannot reach", () => {
    // Each of these still has to render — the plain <img> serves everyone, which
    // is what the hero did before any of this existed.
    for (const url of ["", "/uploads/hero.jpg", "/src/assets/hero-bg.jpg", "data:image/png;base64,AA"]) {
      expect(buildHeroImageSources(url), url).toEqual([]);
    }
  });

  it("hands phones the admin's own photograph, exactly as saved", () => {
    const phonePhoto = `${UPLOAD}/f_auto,q_auto,w_800,h_903,c_fill/v1/hero-portrait.jpg`;
    const [phone, tablet] = buildHeroImageSources(IBB, phonePhoto);

    expect(phone.media).toBe("(max-width: 639px)");
    // Verbatim: no width descriptors, and above all no re-derivation. Cutting a
    // fresh rendition out of this URL would centre-cut a picture that was
    // already framed for a phone, a second time.
    expect(phone.srcSet).toBe(phonePhoto);
    expect(phone.srcSet).not.toContain("g_center");

    // Only phones — tablets and desktops are unaffected by it.
    expect(tablet.srcSet).toContain("c_fill,g_center");
  });

  it("falls back to the derived centre cut when the override is blank", () => {
    for (const blank of ["", "   ", undefined]) {
      const [phone] = buildHeroImageSources(IBB, blank);
      expect(phone.srcSet, JSON.stringify(blank)).toContain("c_fill,g_center");
    }
  });

  it("still serves the phone photograph when the desktop one cannot be re-cut", () => {
    // A bundled asset derives nothing — but the phone's own photograph is a
    // finished URL and stands on its own.
    const phonePhoto = `${UPLOAD}/f_auto,q_auto,w_800,h_903,c_fill/v1/hero-portrait.jpg`;

    expect(buildHeroImageSources("/src/assets/hero-bg.jpg", phonePhoto))
      .toEqual([{ media: "(max-width: 639px)", srcSet: phonePhoto }]);
  });
});
