/**
 * Pre-flight checks on the images the product feed publishes.
 *
 * The feed itself only checks that an image URL *looks* absolute. That is the
 * right call for building the document — it must not make a dozen network calls
 * every time a crawler asks for it — but it leaves one failure the shop cannot
 * see: a URL that is well-formed and dead. Google and Meta both reject the whole
 * ITEM when a listed image 404s, and they report it days later as a
 * disapproval whose stated reason is rarely the real one.
 *
 * So this runs on demand, from Admin → Ops → Product Feed, before anything is
 * submitted.
 *
 * The size rule is the one worth being precise about, because the two platforms
 * disagree and the stricter one wins:
 *
 *   - Google Merchant Center accepts 100×100 for non-apparel.
 *   - META REQUIRES 500×500 for a catalogue image, and recommends 1024×1024.
 *
 * A 300×300 photo therefore sails through Merchant Center and is rejected by
 * Commerce Manager, which is exactly the kind of split that costs an afternoon.
 * Checking against Meta's floor means passing here means passing both.
 */
import type { ImageProbeResult } from "./imageProbe";

/** Meta's hard minimum for a catalogue image. Google's is far lower. */
export const META_MIN_IMAGE_PX = 500;
/** Meta's recommendation — below this is fine, but worth knowing about. */
export const META_RECOMMENDED_IMAGE_PX = 1024;
/**
 * Below this, an image that "loaded" is more likely to be a host's own
 * not-found graphic than a product photo.
 *
 * This is not a guess about a threshold; it is a real failure mode. A dead
 * i.ibb.co link answers 404 *with an image in the body*, which a browser paints
 * without complaint — so the load succeeds, `ok` is true, and the only evidence
 * that the photo is gone is that what arrived is 180×180.
 */
export const PLACEHOLDER_SUSPECT_PX = 250;

export type FeedImageLevel = "error" | "warning";

export interface FeedImageIssue {
  level: FeedImageLevel;
  /** Admin-facing, and says what to do rather than naming a field. */
  message: string;
}

/**
 * What is wrong with one probed image, or null when nothing is.
 *
 * `error` means an ad platform will reject the item. `warning` means it will be
 * accepted but is worse than it needs to be — worth showing, never worth
 * blocking on.
 */
export const feedImageIssue = (probe: ImageProbeResult): FeedImageIssue | null => {
  if (!probe.ok) {
    return {
      level: "error",
      message: "This image didn't load. Both Google and Meta reject the whole product when a listed image is missing.",
    };
  }
  const smallest = Math.min(probe.width, probe.height);
  if (smallest < META_MIN_IMAGE_PX) {
    return {
      level: "error",
      message:
        `Too small for Meta at ${probe.width}×${probe.height}. Meta needs at least ` +
        `${META_MIN_IMAGE_PX}×${META_MIN_IMAGE_PX} — Google would accept this, Meta will not.` +
        // Observed on a real dead i.ibb.co link: the host answered 404 but with
        // an "image not found" graphic in the body, which a browser renders
        // happily. The load therefore SUCCEEDS and only the size gives it away.
        // Anything this small is far more likely to be that than a product
        // photo, and "your image is missing" is a different job from "your image
        // is small" — so the reader is told to go and look.
        (smallest < PLACEHOLDER_SUSPECT_PX
          ? ` At this size it is probably not your photo at all — open the address and check the picture is still there.`
          : ""),
    };
  }
  if (smallest < META_RECOMMENDED_IMAGE_PX) {
    return {
      level: "warning",
      message: `${probe.width}×${probe.height} is accepted, but Meta recommends ${META_RECOMMENDED_IMAGE_PX}×${META_RECOMMENDED_IMAGE_PX} for the sharpest ads.`,
    };
  }
  return null;
};

export interface FeedImageRef {
  productId: string;
  productName: string;
  url: string;
  /** The main image_link, as opposed to an additional_image_link. */
  primary: boolean;
}

export interface FeedImageCheck extends FeedImageRef {
  probe: ImageProbeResult;
  issue: FeedImageIssue | null;
}

/**
 * Every image URL the feed would publish for one product, in the order it
 * publishes them.
 *
 * The gallery filter mirrors backend/productFeed.js exactly — absolute http(s)
 * only, never a duplicate of the main image, at most ten. Checking a URL the
 * feed would silently drop would report a problem the platforms never see.
 */
export const feedImageRefs = (
  products: Array<{ id: string; name: string; image_url?: string; gallery_urls?: string[] }>,
  includeGallery: boolean,
): FeedImageRef[] => {
  const refs: FeedImageRef[] = [];
  for (const product of products) {
    const main = String(product.image_url ?? "").trim();
    if (main) refs.push({ productId: product.id, productName: product.name, url: main, primary: true });
    if (!includeGallery) continue;
    const extras = (product.gallery_urls ?? [])
      .map((u) => String(u ?? "").trim())
      .filter((u) => /^https?:\/\//i.test(u) && u !== main)
      .slice(0, 10);
    for (const url of extras) {
      refs.push({ productId: product.id, productName: product.name, url, primary: false });
    }
  }
  return refs;
};

/** How many of each level, for the one-line verdict above the list. */
export const summariseImageChecks = (checks: FeedImageCheck[]) => ({
  total: checks.length,
  errors: checks.filter((c) => c.issue?.level === "error").length,
  warnings: checks.filter((c) => c.issue?.level === "warning").length,
});
