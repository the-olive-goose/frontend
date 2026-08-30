/**
 * Cloudinary delivery URLs for photographs.
 *
 * The sister of cloudinaryVideo.ts, and it exists for the same reason: what gets
 * pasted into admin is whatever the image host handed out, which is the original
 * file. Measured on the live site, that has meant a 4284x5712 camera photo
 * behind a 120px circle, and 1.8 MB PNGs behind 164px product cards — a PNG
 * being roughly sixteen times a JPEG of the same photograph, which is what makes
 * one product's card snap in and the next one crawl.
 *
 * Unlike the video helper, this cannot assume the asset is already on
 * Cloudinary, because it usually is not — photos are pasted from wherever they
 * are hosted. Cloudinary's *fetch* delivery covers that: given a public URL it
 * downloads the image once, re-encodes it, and serves the result from its CDN.
 * No re-upload, and the URL an admin already has keeps working.
 *
 * As with video, the rewrite happens in admin so the stored URL is the one that
 * ships — nothing in the render path rewrites what an admin saved.
 *
 * Fetch is not guaranteed: Cloudinary has to be able to download the source, and
 * some hosts stall or refuse it. `buildOptimizedImageUrl` therefore only builds
 * the URL; admin checks that it actually loads before writing it into a field,
 * because storing a broken photo is far worse than storing a heavy one.
 *
 * @see src/lib/cloudinaryVideo.ts — the same idea for reels
 */

/**
 * The site's own Cloudinary account — the one already serving the reels. A
 * fetch URL has to name the account doing the fetching, so unlike the video
 * helper (which reads the account out of the URL it was given) this one has to
 * know it. It is public in every reel URL on the site.
 */
export const CLOUDINARY_CLOUD = "asravqmm";

const FETCH_BASE = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch/`;

/** `https://res.cloudinary.com/<cloud>/image/upload/` + everything after it. */
const UPLOAD_RE = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/i;

/** `https://res.cloudinary.com/<cloud>/image/fetch/` + everything after it. */
const FETCH_RE = /^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/fetch\/(.+)$/i;

/** Same shape as the video helper's: comma-separated `xx_yyy` pairs. */
const TRANSFORM_SEG = /^[a-z]{1,3}_[^/,]+(?:,[a-z]{1,3}_[^/,]+)*$/i;

/** Only an absolute http(s) URL can be handed to Cloudinary to fetch. A
 *  `/uploads/…` path is served by our own backend and is not reachable under
 *  that name from outside, so it is left alone. */
const ABSOLUTE_RE = /^https?:\/\//i;

export type ImageSize = "thumb" | "card" | "wide";

/**
 * Three sizes, named for what they are actually behind rather than for a number.
 * Every one is generous: the widest thing on the site is a full-bleed hero, and
 * a phone showing a product card is painting about 200 CSS px.
 *
 * `f_auto` lets Cloudinary send WebP or AVIF to browsers that take them, which
 * is most of the saving on a photograph saved as PNG. `c_limit` means these are
 * ceilings — an image already smaller than the tier is never blown up.
 */
export const IMAGE_SIZES: Record<ImageSize, { label: string; hint: string; width: number }> = {
  thumb: {
    label: "Small — profile photos and avatars",
    width: 400,
    hint: "400px wide. For the founder photo, testimonial avatars and anything else shown in a small circle.",
  },
  card: {
    label: "Medium — product cards (recommended)",
    width: 800,
    hint: "800px wide. Twice what the largest product card paints, so it stays sharp on a high-resolution screen.",
  },
  wide: {
    label: "Large — full-width photos",
    width: 1600,
    hint: "1600px wide. For the hero background and anything else that spans the whole screen.",
  },
};

export const DEFAULT_IMAGE_SIZE: ImageSize = "card";

const chainFor = (size: ImageSize): string => {
  const { width } = IMAGE_SIZES[size] ?? IMAGE_SIZES[DEFAULT_IMAGE_SIZE];
  return `f_auto,q_auto,w_${width},c_limit`;
};

/**
 * A source URL is normally embedded in a fetch URL as-is, which keeps the stored
 * value readable — an admin can see at a glance what it points at. A URL with a
 * query string or a fragment cannot be: Cloudinary would read those as its own,
 * so that one gets encoded.
 */
const embedSource = (url: string): string =>
  /[?#]/.test(url) ? encodeURIComponent(url) : url;

/**
 * The original image behind a URL: for a Cloudinary fetch URL, the source it
 * wraps; for anything else, the URL itself.
 *
 * Everything else here is built on this, which is what makes optimising twice —
 * or at a different size — replace the previous chain instead of wrapping a
 * wrapper. Cloudinary rejects a doubly-wrapped fetch URL outright (400), so this
 * is correctness, not tidiness.
 */
export const originalImageUrl = (url: string): string => {
  const rest = (url ?? "").trim().match(FETCH_RE)?.[1];
  if (!rest) return (url ?? "").trim();

  // The source is the tail that starts at its own scheme; anything before that
  // is Cloudinary's transformation chain. Encoded sources are decoded back.
  const at = rest.search(/https?(:\/\/|%3A%2F%2F)/i);
  if (at < 0) return (url ?? "").trim();

  const source = rest.slice(at);
  return /^https?%3A/i.test(source) ? decodeURIComponent(source) : source;
};

/** A Cloudinary image URL of either kind (an upload we host, or a fetch). */
export const isCloudinaryImage = (url: string): boolean =>
  UPLOAD_RE.test((url ?? "").trim()) || FETCH_RE.test((url ?? "").trim());

/**
 * Whether this URL already asks Cloudinary to resize. True for a fetch URL
 * carrying a width, and for an upload URL whose chain sets one — including a
 * chain an admin wrote by hand.
 */
export const isOptimizedImageUrl = (url: string): boolean => {
  const trimmed = (url ?? "").trim();

  const fetchRest = trimmed.match(FETCH_RE)?.[1];
  if (fetchRest) {
    const at = fetchRest.search(/https?(:\/\/|%3A%2F%2F)/i);
    return at > 0 && /(^|,|\/)(w|h|q|c)_/i.test(fetchRest.slice(0, at));
  }

  const uploadRest = trimmed.match(UPLOAD_RE)?.[2];
  if (!uploadRest) return false;
  const segments = uploadRest.split(/[?#]/)[0].split("/").filter(Boolean);
  return segments.slice(0, -1).some(seg => TRANSFORM_SEG.test(seg) && /(^|,)(w|h|q)_/i.test(seg));
};

/**
 * Whether it is worth offering to optimise this URL at all. Absolute http(s)
 * only: a relative `/uploads/…` path, a data URI or an empty field has nothing
 * an external service could fetch.
 */
export const canOptimizeImage = (url: string): boolean => ABSOLUTE_RE.test((url ?? "").trim());

/**
 * Rewrite an image URL to deliver a web-sized, modern-format copy.
 *
 * An image already on Cloudinary is re-delivered through `image/upload` with a
 * fresh chain — that is a plain transformation of an asset we hold. Anything
 * else goes through `image/fetch`, which asks Cloudinary to pull it once and
 * serve the re-encoded copy from then on.
 *
 * Returns the URL unchanged when there is nothing safe to do with it.
 */
export const buildOptimizedImageUrl = (url: string, size: ImageSize = DEFAULT_IMAGE_SIZE): string => {
  const original = originalImageUrl(url);
  if (!canOptimizeImage(original)) return (url ?? "").trim();
  return deliver(original, chainFor(size));
};

/**
 * The same idea, sized and encoded for an EMAIL rather than a browser.
 *
 * Two deliberate differences from {@link buildOptimizedImageUrl}:
 *
 *   - `f_jpg`, not `f_auto`. Format negotiation is a browser feature: Outlook on
 *     Windows renders mail through Word's engine and cannot display WebP or
 *     AVIF, so `f_auto` is a coin-flip on whether a subscriber sees the photo at
 *     all. JPEG is the format every mail client since 1995 can read. The cost is
 *     transparency — a PNG logo with a see-through background gains a white one
 *     — which is the right trade for photographs and worth knowing about for
 *     anything else.
 *   - 944px, twice the 472px column the newsletter renders at, so it stays sharp
 *     on a phone without shipping a 3MB original to every subscriber.
 *
 * Returns the URL unchanged when there is nothing safe to do with it, exactly
 * like its sibling.
 */
export const buildEmailImageUrl = (url: string): string => {
  const original = originalImageUrl(url);
  if (!canOptimizeImage(original)) return (url ?? "").trim();
  return deliver(original, "f_jpg,q_auto,w_944,c_limit");
};

/** Puts `chain` in front of an original, by whichever delivery type suits it. */
const deliver = (original: string, chain: string): string => {
  const upload = original.match(UPLOAD_RE);
  if (upload) {
    const [, base, rest] = upload;
    const segments = rest.split("/").filter(Boolean);
    // Drop any chain already there rather than stacking a contradictory one.
    // The final segment is the asset itself and is never treated as a chain.
    while (segments.length > 1 && TRANSFORM_SEG.test(segments[0])) segments.shift();
    return `${base}${chain}/${segments.join("/")}`;
  }

  return `${FETCH_BASE}${chain}/${embedSource(original)}`;
};

/**
 * A rendition of an image at exactly `width`x`height` pixels.
 *
 * Where {@link buildOptimizedImageUrl} caps a photo's width and leaves its shape
 * alone, this one commits to a shape — which is what a responsive `<source>`
 * needs. A phone showing a wide photograph in a tall frame paints under half of
 * its width, and asking for a capped-width copy would send the whole picture for
 * the browser to throw most of away and rescale the rest. Asking Cloudinary for
 * the rectangle the frame actually is sends the pixels that get painted and no
 * others.
 *
 * The crop is `g_center`, deliberately: it is the same rectangle `object-cover`
 * would have taken, so this changes what is *sent* without changing what is
 * *seen*. Choosing a different part of the photograph to show is a composition
 * decision — `g_auto` would make it automatically and invisibly, which is why
 * it is not offered here. An admin who wants phones framed differently gives
 * them their own photograph instead (`bg_image_mobile_url`), which is a
 * decision made on a picture they can see rather than by a rule.
 *
 * Returns "" when the URL is not something Cloudinary can fetch, so a caller can
 * leave the `<source>` out and let the plain `<img>` serve everyone.
 */
export const buildImageRendition = (url: string, width: number, height: number): string => {
  const original = originalImageUrl(url);
  if (!canOptimizeImage(original)) return "";
  return deliver(original, `f_auto,q_auto,w_${Math.round(width)},h_${Math.round(height)},c_fill,g_center`);
};
