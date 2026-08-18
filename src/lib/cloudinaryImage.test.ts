import { describe, expect, it } from "vitest";
import {
  CLOUDINARY_CLOUD,
  DEFAULT_IMAGE_SIZE,
  IMAGE_SIZES,
  buildOptimizedImageUrl,
  canOptimizeImage,
  isCloudinaryImage,
  isOptimizedImageUrl,
  originalImageUrl,
  type ImageSize,
} from "./cloudinaryImage";

/**
 * The rules that keep an optimised photo URL correct.
 *
 * The one that bites hardest is idempotency: Cloudinary answers a doubly-wrapped
 * fetch URL with a 400, so pressing the button twice — or at a different size —
 * has to replace the chain, never wrap the wrapper. Everything here is built on
 * unwrapping back to the original first, and these hold that in place.
 */

const IBB = "https://i.ibb.co/Ld7p4DMJ/photo.png";
const FETCH = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch`;
const UPLOAD = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload`;

describe("originalImageUrl", () => {
  it("leaves a plain URL alone", () => {
    expect(originalImageUrl(IBB)).toBe(IBB);
  });

  it("unwraps a fetch URL back to the photo it wraps", () => {
    expect(originalImageUrl(`${FETCH}/f_auto,q_auto,w_800,c_limit/${IBB}`)).toBe(IBB);
  });

  it("unwraps an encoded source too", () => {
    const src = "https://example.com/p.jpg?v=2";
    expect(originalImageUrl(`${FETCH}/f_auto,w_400/${encodeURIComponent(src)}`)).toBe(src);
  });

  it("trims, and survives an empty field", () => {
    expect(originalImageUrl(`  ${IBB}  `)).toBe(IBB);
    expect(originalImageUrl("")).toBe("");
  });
});

describe("buildOptimizedImageUrl", () => {
  it("wraps an off-site photo in a fetch delivery", () => {
    expect(buildOptimizedImageUrl(IBB, "card")).toBe(`${FETCH}/f_auto,q_auto,w_800,c_limit/${IBB}`);
  });

  it("is idempotent — optimising twice does not nest", () => {
    const once = buildOptimizedImageUrl(IBB, "card");
    expect(buildOptimizedImageUrl(once, "card")).toBe(once);
    // Cloudinary 400s on a fetch URL inside a fetch URL, so this is the check
    // that matters most: exactly one /image/fetch/ in the result.
    expect(buildOptimizedImageUrl(once, "card").match(/\/image\/fetch\//g)).toHaveLength(1);
  });

  it("replaces the chain when the size changes rather than stacking one", () => {
    const card = buildOptimizedImageUrl(IBB, "card");
    const thumb = buildOptimizedImageUrl(card, "thumb");
    expect(thumb).toBe(`${FETCH}/f_auto,q_auto,w_400,c_limit/${IBB}`);
    expect(thumb).not.toContain("w_800");
  });

  it("transforms an image already on Cloudinary directly, without fetching it", () => {
    const out = buildOptimizedImageUrl(`${UPLOAD}/v123/candle.jpg`, "card");
    expect(out).toBe(`${UPLOAD}/f_auto,q_auto,w_800,c_limit/v123/candle.jpg`);
    expect(out).not.toContain("/image/fetch/");
  });

  it("replaces an existing chain on a Cloudinary upload URL", () => {
    const out = buildOptimizedImageUrl(`${UPLOAD}/w_2000,q_100/v123/candle.jpg`, "thumb");
    expect(out).toBe(`${UPLOAD}/f_auto,q_auto,w_400,c_limit/v123/candle.jpg`);
  });

  it("never mistakes the asset itself for a transformation", () => {
    // A public id that looks like a chain must survive — it is the last segment.
    const out = buildOptimizedImageUrl(`${UPLOAD}/w_100,c_fill/v1/f_auto,q_auto`, "card");
    expect(out).toBe(`${UPLOAD}/f_auto,q_auto,w_800,c_limit/v1/f_auto,q_auto`);
  });

  it("encodes a source carrying a query string, so it is not read as Cloudinary's", () => {
    const src = "https://example.com/p.jpg?width=4000";
    const out = buildOptimizedImageUrl(src, "card");
    expect(out).toBe(`${FETCH}/f_auto,q_auto,w_800,c_limit/${encodeURIComponent(src)}`);
    expect(originalImageUrl(out)).toBe(src);
  });

  it("leaves alone what it cannot help with", () => {
    // Our own backend's uploads are not reachable under a relative path from
    // outside, and there is nothing to fetch in a blank field.
    for (const url of ["/uploads/photo.jpg", "", "   ", "data:image/png;base64,AAAA"]) {
      expect(buildOptimizedImageUrl(url, "card")).toBe(url.trim());
    }
  });

  it("asks for a modern format and never upscales, at every size", () => {
    for (const size of Object.keys(IMAGE_SIZES) as ImageSize[]) {
      const out = buildOptimizedImageUrl(IBB, size);
      expect(out, size).toContain("f_auto");
      expect(out, size).toContain("c_limit");
      expect(out, size).toContain(`w_${IMAGE_SIZES[size].width}`);
    }
  });

  it("defaults to the product-card size", () => {
    expect(buildOptimizedImageUrl(IBB)).toBe(buildOptimizedImageUrl(IBB, DEFAULT_IMAGE_SIZE));
  });
});

describe("isOptimizedImageUrl", () => {
  it("recognises what it just built, at every size", () => {
    for (const size of Object.keys(IMAGE_SIZES) as ImageSize[]) {
      expect(isOptimizedImageUrl(buildOptimizedImageUrl(IBB, size)), size).toBe(true);
    }
  });

  it("is false for the raw original", () => {
    expect(isOptimizedImageUrl(IBB)).toBe(false);
    expect(isOptimizedImageUrl(`${UPLOAD}/v123/candle.jpg`)).toBe(false);
  });

  it("credits a chain an admin wrote themselves", () => {
    expect(isOptimizedImageUrl(`${UPLOAD}/w_900/v1/candle.jpg`)).toBe(true);
    expect(isOptimizedImageUrl(`${FETCH}/w_600/${IBB}`)).toBe(true);
  });
});

describe("canOptimizeImage", () => {
  it("accepts absolute http(s) only", () => {
    expect(canOptimizeImage(IBB)).toBe(true);
    expect(canOptimizeImage("http://example.com/a.jpg")).toBe(true);
    for (const url of ["/uploads/a.jpg", "", "data:image/png;base64,AA", "ftp://x/a.jpg"]) {
      expect(canOptimizeImage(url), url).toBe(false);
    }
  });
});

describe("isCloudinaryImage", () => {
  it("tells Cloudinary images from everything else", () => {
    expect(isCloudinaryImage(`${UPLOAD}/v1/a.jpg`)).toBe(true);
    expect(isCloudinaryImage(`${FETCH}/w_800/${IBB}`)).toBe(true);
    expect(isCloudinaryImage(IBB)).toBe(false);
    // A video on the same account is the other helper's job.
    expect(isCloudinaryImage(`https://res.cloudinary.com/${CLOUDINARY_CLOUD}/video/upload/v1/r.mp4`)).toBe(false);
  });
});
