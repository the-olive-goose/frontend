import { describe, expect, it } from "vitest";
import {
  META_MIN_IMAGE_PX,
  META_RECOMMENDED_IMAGE_PX,
  feedImageIssue,
  feedImageRefs,
  summariseImageChecks,
  type FeedImageCheck,
} from "./feedImageChecks";

const probe = (width: number, height = width, ok = true) => ({ ok, width, height });

describe("feedImageIssue", () => {
  it("passes a large, healthy image", () => {
    expect(feedImageIssue(probe(1200))).toBeNull();
    expect(feedImageIssue(probe(1024))).toBeNull();
  });

  it("errors on an image that did not load", () => {
    expect(feedImageIssue({ ok: false, width: 0, height: 0 })?.level).toBe("error");
  });

  // The whole point of this check: Google would take it, Meta would not, and the
  // shop only finds out days later from Commerce Manager.
  it("errors below Meta's floor even though Google would accept it", () => {
    const issue = feedImageIssue(probe(300));
    expect(issue?.level).toBe("error");
    expect(issue?.message).toMatch(/Meta/);
    expect(issue?.message).toContain("300×300");
  });

  it("uses the SHORTER side, so a wide-but-short banner still fails", () => {
    // 2000 wide but 200 tall — plenty of pixels, unusable as a catalogue image.
    expect(feedImageIssue(probe(2000, 200))?.level).toBe("error");
  });

  it("treats exactly the minimum as acceptable, not as a failure", () => {
    const issue = feedImageIssue(probe(META_MIN_IMAGE_PX));
    expect(issue?.level).toBe("warning");
  });

  it("warns between the minimum and the recommendation", () => {
    const issue = feedImageIssue(probe(800));
    expect(issue?.level).toBe("warning");
    expect(issue?.message).toContain(String(META_RECOMMENDED_IMAGE_PX));
  });

  it("stops warning at the recommended size", () => {
    expect(feedImageIssue(probe(META_RECOMMENDED_IMAGE_PX))).toBeNull();
  });

  // A dead image reports 0×0, and "too small" would be a misleading way to say
  // "this URL is broken".
  it("reports a dead image as not loading rather than as too small", () => {
    expect(feedImageIssue({ ok: false, width: 0, height: 0 })?.message).toMatch(/didn't load/);
  });

  // Observed for real: a dead i.ibb.co link answers 404 with an "image not
  // found" graphic in the body, which a browser paints happily — so the load
  // SUCCEEDS at 180x180 and only the size betrays it. The message has to send
  // the reader to look at the picture, not to go hunting for a bigger version of
  // a photo that no longer exists.
  it("suspects a placeholder when a loaded image is tiny", () => {
    const issue = feedImageIssue(probe(180));
    expect(issue?.level).toBe("error");
    expect(issue?.message).toMatch(/probably not your photo/);
  });

  it("does not cry placeholder at a merely undersized photo", () => {
    const issue = feedImageIssue(probe(400));
    expect(issue?.level).toBe("error");
    expect(issue?.message).not.toMatch(/probably not your photo/);
  });
});

describe("feedImageRefs", () => {
  const products = [
    { id: "1", name: "Matcha", image_url: "https://a.test/main.jpg",
      gallery_urls: ["https://a.test/two.jpg", "https://a.test/three.jpg"] },
    { id: "2", name: "Coffee", image_url: "https://b.test/main.jpg" },
  ];

  it("lists the main image first for each product", () => {
    const refs = feedImageRefs(products, true);
    expect(refs[0]).toMatchObject({ productId: "1", url: "https://a.test/main.jpg", primary: true });
    expect(refs.filter(r => r.primary).map(r => r.productId)).toEqual(["1", "2"]);
  });

  it("includes gallery images when the feed would send them", () => {
    expect(feedImageRefs(products, true)).toHaveLength(4);
  });

  it("skips gallery images when that setting is off", () => {
    const refs = feedImageRefs(products, false);
    expect(refs).toHaveLength(2);
    expect(refs.every(r => r.primary)).toBe(true);
  });

  // Each of these mirrors a filter in backend/productFeed.js. Checking a URL the
  // feed silently drops would report a problem no platform ever sees.
  it("drops a gallery entry that repeats the main image", () => {
    const refs = feedImageRefs(
      [{ id: "1", name: "X", image_url: "https://a.test/m.jpg", gallery_urls: ["https://a.test/m.jpg"] }],
      true,
    );
    expect(refs).toHaveLength(1);
  });

  it("drops a gallery entry that is not an absolute URL", () => {
    const refs = feedImageRefs(
      [{ id: "1", name: "X", image_url: "https://a.test/m.jpg", gallery_urls: ["/uploads/a.jpg", ""] }],
      true,
    );
    expect(refs).toHaveLength(1);
  });

  it("stops at ten gallery images, as the feed does", () => {
    const many = Array.from({ length: 15 }, (_, i) => `https://a.test/${i}.jpg`);
    const refs = feedImageRefs([{ id: "1", name: "X", image_url: "https://a.test/m.jpg", gallery_urls: many }], true);
    expect(refs).toHaveLength(11); // main + 10
  });

  it("skips a product with no main image rather than probing an empty string", () => {
    expect(feedImageRefs([{ id: "1", name: "X" }], true)).toHaveLength(0);
  });
});

describe("summariseImageChecks", () => {
  const check = (level: "error" | "warning" | null): FeedImageCheck => ({
    productId: "1", productName: "X", url: "u", primary: true,
    probe: { ok: true, width: 1200, height: 1200 },
    issue: level ? { level, message: "m" } : null,
  });

  it("counts each level separately", () => {
    expect(summariseImageChecks([check("error"), check("warning"), check(null), check("error")]))
      .toEqual({ total: 4, errors: 2, warnings: 1 });
  });

  it("reports a clean run as zero of both", () => {
    expect(summariseImageChecks([check(null)])).toEqual({ total: 1, errors: 0, warnings: 0 });
  });

  it("handles nothing to check", () => {
    expect(summariseImageChecks([])).toEqual({ total: 0, errors: 0, warnings: 0 });
  });
});
