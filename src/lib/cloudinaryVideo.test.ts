import { describe, expect, it } from "vitest";
import {
  buildHeroMobileVideoUrl,
  buildHeroVideoUrl,
  buildLightboxVideoUrl,
  buildOptimizedUrl,
  buildPosterUrl,
  buildRailVideoUrl,
  HERO_MOBILE_WIDTH,
  HERO_POSTER_WIDTH,
  isSameVideoAsset,
  isVideoUrl,
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

describe("buildRailVideoUrl", () => {
  const BASE = "https://res.cloudinary.com/asravqmm/video/upload";
  const RAIL = "f_mp4,vc_h264,w_720,c_limit,q_auto:eco";

  it("asks for a thumbnail-weight cut of the same reel", () => {
    expect(buildRailVideoUrl(`${BASE}/v1785190731/reel.mp4`)).toBe(`${BASE}/${RAIL}/v1785190731/reel.mp4`);
  });

  it("replaces whatever chain the stored URL carried", () => {
    // The stored URL is sized for full screen; the rail is a 341px card. It is
    // the same asset delivered twice, not two assets.
    const stored = `${BASE}/f_mp4,vc_h264,w_1080,c_limit,q_auto:best/v1/reel.mp4`;
    const rail = buildRailVideoUrl(stored);
    expect(rail).toBe(`${BASE}/${RAIL}/v1/reel.mp4`);
    expect(rail).not.toContain("q_auto:best");
    expect(rail.match(/\/video\/upload\//g)).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = buildRailVideoUrl(`${BASE}/v1/reel.mp4`);
    expect(buildRailVideoUrl(once)).toBe(once);
  });

  it("points at the same asset the stored URL does", () => {
    // The lightbox plays the stored URL and the rail plays this one; if they
    // ever named different assets the card and the full screen would disagree.
    const stored = `${BASE}/f_mp4,w_1080/v1785190731/1785188976153295_whqy1c.mp4`;
    expect(buildRailVideoUrl(stored)).toContain("v1785190731/1785188976153295_whqy1c.mp4");
  });

  it("leaves anything that is not a Cloudinary video exactly as it was", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=abc",
      "https://player.vimeo.com/video/123",
      "https://example.com/clip.mp4",
      "",
    ]) {
      expect(buildRailVideoUrl(url), url).toBe(url);
    }
  });
});

describe("buildLightboxVideoUrl", () => {
  const BASE = "https://res.cloudinary.com/ajlu9eld/video/upload";
  const BOX = "f_mp4,vc_h264,w_1080,c_limit,q_auto:good";

  it("derives a full-screen cut instead of playing the stored file", () => {
    expect(buildLightboxVideoUrl(`${BASE}/v1787066277/1_bbht7b.mp4`)).toBe(
      `${BASE}/${BOX}/v1787066277/1_bbht7b.mp4`,
    );
  });

  it("never delivers a raw original, however large the stored one is", () => {
    // The regression this guards: a re-upload left the six reels stored as raw
    // camera .mov files totalling 331 MB, one of them 97.5 MB, and the lightbox
    // handed that straight to the visitor. At a 25-credit free tier that is
    // ~256 full-screen opens before the account is disabled again.
    const raw = `${BASE}/v1787066277/1_bbht7b.mov`;
    const out = buildLightboxVideoUrl(raw);
    expect(out).not.toBe(raw);
    expect(out).toContain(BOX);
  });

  it("forces mp4, because a .mov original does not play in Chrome", () => {
    const out = buildLightboxVideoUrl(`${BASE}/v1/reel.mov`);
    expect(out).toMatch(/\.mp4$/);
    expect(out).toContain("f_mp4");
  });

  it("replaces whatever chain the stored URL carried", () => {
    const stored = `${BASE}/f_mp4,vc_h264,w_1080,c_limit,q_auto:best/v1/reel.mp4`;
    const out = buildLightboxVideoUrl(stored);
    expect(out).toBe(`${BASE}/${BOX}/v1/reel.mp4`);
    expect(out).not.toContain("q_auto:best");
    expect(out.match(/\/video\/upload\//g)).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = buildLightboxVideoUrl(`${BASE}/v1/reel.mp4`);
    expect(buildLightboxVideoUrl(once)).toBe(once);
  });

  it("names the same asset the rail does", () => {
    const stored = `${BASE}/v1787066277/1_bbht7b.mov`;
    expect(buildLightboxVideoUrl(stored)).toContain("v1787066277/1_bbht7b");
    expect(buildRailVideoUrl(stored)).toContain("v1787066277/1_bbht7b");
  });

  it("leaves anything that is not a Cloudinary video exactly as it was", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=abc",
      "https://player.vimeo.com/video/123",
      "https://example.com/clip.mp4",
      "",
    ]) {
      expect(buildLightboxVideoUrl(url), url).toBe(url);
    }
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

describe("isVideoUrl", () => {
  it("recognises a Cloudinary video delivery, chain or no chain", () => {
    expect(isVideoUrl(ORIGINAL)).toBe(true);
    // A transformed URL can end in the chain rather than a readable extension.
    expect(isVideoUrl(buildHeroVideoUrl(ORIGINAL))).toBe(true);
  });

  it("recognises a plain video file anywhere else", () => {
    expect(isVideoUrl("https://cdn.example.com/loop.mp4")).toBe(true);
    expect(isVideoUrl("https://cdn.example.com/loop.mov?v=2")).toBe(true);
  });

  it("rejects embeds and photos, which cannot be a background", () => {
    expect(isVideoUrl("https://youtube.com/shorts/abc123")).toBe(false);
    expect(isVideoUrl("https://instagram.com/reel/abc123")).toBe(false);
    expect(isVideoUrl("https://cdn.example.com/hero.jpg")).toBe(false);
    expect(isVideoUrl("")).toBe(false);
  });
});

describe("buildHeroVideoUrl", () => {
  it("asks for an mp4 at the tier's width, with no audio track", () => {
    expect(buildHeroVideoUrl(ORIGINAL, "balanced")).toBe(
      "https://res.cloudinary.com/asravqmm/video/upload/" +
      "f_mp4,vc_h264,w_1440,c_limit,q_auto:good,ac_none/v1785190731/1785188976153295_whqy1c.mp4",
    );
  });

  it("sends phones their own narrower encode", () => {
    const mobile = buildHeroMobileVideoUrl(ORIGINAL);
    expect(mobile).toContain(`w_${HERO_MOBILE_WIDTH},c_limit,q_auto:eco,ac_none`);
    expect(mobile).not.toBe(buildHeroVideoUrl(ORIGINAL));
  });

  it("trims to the first seconds when asked, and not otherwise", () => {
    expect(buildHeroVideoUrl(ORIGINAL, "balanced", 10)).toContain("/so_0,du_10/");
    expect(buildHeroVideoUrl(ORIGINAL, "balanced")).not.toContain("du_");
  });

  it("replaces an existing chain rather than stacking on it", () => {
    // Pressing the button twice, or changing tier, must not compound: two width
    // instructions in one URL is a URL Cloudinary answers with an error.
    const once = buildHeroVideoUrl(ORIGINAL, "max", 10);
    expect(buildHeroVideoUrl(once, "max", 10)).toBe(once);
    expect(buildHeroVideoUrl(once, "light")).toBe(buildHeroVideoUrl(ORIGINAL, "light"));
    expect(buildHeroMobileVideoUrl(once)).toBe(buildHeroMobileVideoUrl(ORIGINAL));
  });

  it("leaves a video hosted anywhere else exactly as it is", () => {
    const other = "https://cdn.example.com/loop.mp4";
    expect(buildHeroVideoUrl(other)).toBe(other);
    expect(buildHeroMobileVideoUrl(other)).toBe(other);
  });

  it("reads as optimised once applied, so admin stops warning about it", () => {
    expect(isOptimizedUrl(buildHeroVideoUrl(ORIGINAL))).toBe(true);
    expect(isOptimizedUrl(buildHeroMobileVideoUrl(ORIGINAL))).toBe(true);
  });
});

describe("buildPosterUrl", () => {
  it("cuts the hero's still wider than a reel card's", () => {
    expect(buildPosterUrl(ORIGINAL, HERO_POSTER_WIDTH)).toContain(`w_${HERO_POSTER_WIDTH},c_limit`);
    // The rail's callers pass no width and must keep the size they had.
    expect(buildPosterUrl(ORIGINAL)).toContain("w_640,c_limit");
  });
});

describe("isSameVideoAsset", () => {
  // What this answers: has the *clip* changed, or only the chain in front of
  // it? A phone can now have a clip of its own, so "the desktop clip changed"
  // must not throw away a different clip an admin chose deliberately.
  it("sees through the transformation chain to the clip underneath", () => {
    expect(isSameVideoAsset(buildHeroVideoUrl(ORIGINAL), ORIGINAL)).toBe(true);
    expect(isSameVideoAsset(buildHeroMobileVideoUrl(ORIGINAL), buildHeroVideoUrl(ORIGINAL, "max", 10))).toBe(true);
    // The container is delivery's choice — .mov in, .mp4 out, same clip.
    expect(isSameVideoAsset(buildHeroVideoUrl(ORIGINAL), ORIGINAL.replace(".mov", ".mp4"))).toBe(true);
  });

  it("tells two different clips apart", () => {
    const other = "https://res.cloudinary.com/asravqmm/video/upload/v1785190731/another_x9z8.mov";
    expect(isSameVideoAsset(buildHeroMobileVideoUrl(other), ORIGINAL)).toBe(false);
  });

  it("is false when either side is empty, so nothing is cleared on a hunch", () => {
    expect(isSameVideoAsset("", ORIGINAL)).toBe(false);
    expect(isSameVideoAsset(ORIGINAL, "")).toBe(false);
    expect(isSameVideoAsset("", "")).toBe(false);
  });
});
