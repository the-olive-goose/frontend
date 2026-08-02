import { describe, expect, it } from "vitest";
import {
  buildOptimizedUrl,
  buildPosterUrl,
  isCloudinaryVideo,
  isOptimizedUrl,
  parseCloudinaryVideo,
  QUALITY_TIERS,
} from "./cloudinaryVideo";

// The shape Cloudinary actually hands back after an upload, taken from a reel
// live on the home page: a version segment, a generated public id, and the
// original container (.mov straight off a phone).
const ORIGINAL =
  "https://res.cloudinary.com/asravqmm/video/upload/v1785190731/1785188976153295_whqy1c.mov";

describe("parseCloudinaryVideo", () => {
  it("splits a bare upload URL into base and asset path", () => {
    expect(parseCloudinaryVideo(ORIGINAL)).toEqual({
      base: "https://res.cloudinary.com/asravqmm/video/upload/",
      transforms: [],
      path: "v1785190731/1785188976153295_whqy1c.mov",
    });
  });

  it("peels off an existing transformation chain", () => {
    const parsed = parseCloudinaryVideo(
      "https://res.cloudinary.com/asravqmm/video/upload/f_mp4,w_1080/v1785190731/reel.mp4",
    );
    expect(parsed?.transforms).toEqual(["f_mp4,w_1080"]);
    expect(parsed?.path).toBe("v1785190731/reel.mp4");
  });

  it("never mistakes the asset itself for a transformation", () => {
    // `so_something` looks exactly like a transformation segment, but it is the
    // last segment, so it is the asset.
    const parsed = parseCloudinaryVideo(
      "https://res.cloudinary.com/asravqmm/video/upload/so_reel.mp4",
    );
    expect(parsed?.transforms).toEqual([]);
    expect(parsed?.path).toBe("so_reel.mp4");
  });

  it("ignores query strings and trailing slashes", () => {
    expect(parseCloudinaryVideo(`${ORIGINAL}?x=1`)?.path).toBe(
      "v1785190731/1785188976153295_whqy1c.mov",
    );
  });

  it("returns null for everything that is not a Cloudinary video", () => {
    for (const url of [
      "https://youtube.com/shorts/abc123",
      "https://player.vimeo.com/video/12345",
      "https://www.instagram.com/reel/abc/embed/",
      "https://res.cloudinary.com/asravqmm/image/upload/v1/photo.jpg",
      "https://example.com/reel.mp4",
      "",
    ]) {
      expect(parseCloudinaryVideo(url), url).toBeNull();
      expect(isCloudinaryVideo(url), url).toBe(false);
    }
  });
});

describe("buildOptimizedUrl", () => {
  it("asks for a web-sized mp4 and drops the .mov container", () => {
    expect(buildOptimizedUrl(ORIGINAL, "high")).toBe(
      "https://res.cloudinary.com/asravqmm/video/upload/" +
        "f_mp4,vc_h264,w_1080,c_limit,q_auto:best/v1785190731/1785188976153295_whqy1c.mp4",
    );
  });

  it("replaces an existing chain instead of stacking a second one", () => {
    const once = buildOptimizedUrl(ORIGINAL, "high");
    expect(buildOptimizedUrl(once, "high")).toBe(once);
    // Switching tier rewrites rather than appends — otherwise two contradictory
    // widths would end up on the same URL.
    const balanced = buildOptimizedUrl(once, "balanced");
    expect(balanced).toContain(QUALITY_TIERS.balanced.chain);
    expect(balanced).not.toContain(QUALITY_TIERS.high.chain);
  });

  it("appends an extension when the public id has none", () => {
    expect(
      buildOptimizedUrl("https://res.cloudinary.com/asravqmm/video/upload/v1/reel"),
    ).toMatch(/\/v1\/reel\.mp4$/);
  });

  it("leaves non-Cloudinary URLs exactly as they are", () => {
    const yt = "https://youtube.com/shorts/abc123";
    expect(buildOptimizedUrl(yt)).toBe(yt);
  });
});

describe("buildPosterUrl", () => {
  it("takes the first frame as a jpg", () => {
    expect(buildPosterUrl(ORIGINAL)).toBe(
      "https://res.cloudinary.com/asravqmm/video/upload/" +
        "so_0,f_jpg,q_auto,w_640,c_limit/v1785190731/1785188976153295_whqy1c.jpg",
    );
  });

  it("derives the same poster whether given the original or the optimised URL", () => {
    expect(buildPosterUrl(buildOptimizedUrl(ORIGINAL))).toBe(buildPosterUrl(ORIGINAL));
  });

  it("is empty for URLs it cannot derive a frame from", () => {
    expect(buildPosterUrl("https://youtube.com/shorts/abc")).toBe("");
  });
});

describe("isOptimizedUrl", () => {
  it("is false for a raw upload and true once resized", () => {
    expect(isOptimizedUrl(ORIGINAL)).toBe(false);
    expect(isOptimizedUrl(buildOptimizedUrl(ORIGINAL))).toBe(true);
  });

  it("accepts a chain an admin wrote by hand", () => {
    expect(
      isOptimizedUrl("https://res.cloudinary.com/asravqmm/video/upload/w_720/v1/reel.mp4"),
    ).toBe(true);
  });

  it("does not count a chain that resizes nothing", () => {
    expect(
      isOptimizedUrl("https://res.cloudinary.com/asravqmm/video/upload/f_mp4/v1/reel.mp4"),
    ).toBe(false);
  });
});
