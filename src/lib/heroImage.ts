/**
 * Screen-sized renditions of the hero photograph.
 *
 * The sister of heroVideo.ts, and it answers the same question — what should
 * *this* device be sent? — but it answers it without a second stored URL,
 * because unlike a video encode, a still can be re-cut on delivery.
 *
 * The problem it solves is the hero's fixed heights. The photo is wide (the
 * current one is 1600x878) and the frame on a phone is tall (100vw x 440),
 * so `object-cover` paints a little under half the picture's width. Left
 * alone, that means a phone downloads every pixel of a full-width photograph,
 * discards more than half of them, and rescales the rest — measured on the
 * live hero, 102 KB fetched to paint what 46 KB would have covered.
 *
 * So each band asks Cloudinary for the rectangle that band actually paints,
 * cropped from the centre — the rectangle `object-cover` was taking anyway.
 * The bytes change; the composition does not.
 *
 * Which is the limit of what delivery can decide on its own. A centred cut is
 * the right *default* and not necessarily the right picture: on the current
 * hero it keeps the goose and loses half a menu board, and no rule derivable
 * from the URL knows whether that matters. So an admin can overrule it for
 * phones by giving them a photograph of their own, and that URL is then passed
 * through untouched — see `bg_image_mobile_url`.
 *
 * Everything here is derived from the URL the admin saved, at render time.
 * That is the one exception to the rule the rest of the image pipeline keeps
 * (rewrite in admin, ship the stored value) and it exists because no single
 * stored URL can be the right shape for a phone and a desktop at once. The
 * admin's URL stays the source of truth: it is what desktops are served, it is
 * the fallback whenever a rendition cannot be built, and every rendition is
 * cut from the original behind it rather than layered on top of it.
 *
 * @see src/lib/heroVideo.ts — the same question for the background clip
 * @see src/lib/cloudinaryImage.ts — how a rendition URL is built
 */

import { buildImageRendition } from "./cloudinaryImage";

/** One `<source>`: which screens it is for, and the copies it offers them. */
export type HeroImageSource = { media: string; srcSet: string };

/**
 * The bands, in the order a browser tests them — first match wins, so they run
 * narrowest first.
 *
 * `media` mirrors the hero's own height breakpoints (`h-[440px] sm:h-[620px]
 * lg:h-[760px]`). Desktops get no band at all: at `lg` the frame is within a
 * few percent of a wide photo's own shape, so the stored URL already is the
 * right rendition.
 *
 * The widths span 1x to 3x of each band, and are handed over as a `srcSet` with
 * `sizes="100vw"` so the browser picks by its own pixel ratio.
 *
 * `aspect` is the frame's own shape at a representative width inside the band:
 * a 390px phone, and an 800px tablet. Viewports either side of those paint a
 * slightly different shape and `object-cover` trims the difference — a few
 * percent, not the half a picture this is here to stop.
 */
const BANDS: { media: string; aspect: number; widths: number[] }[] = [
  { media: "(max-width: 639px)",  aspect: 390 / 440, widths: [400, 600, 800, 1200] },
  { media: "(max-width: 1023px)", aspect: 800 / 620, widths: [800, 1200, 1600] },
];

/** The band an admin's own phone photograph replaces. */
const PHONE_BAND = BANDS[0].media;

/**
 * The `<source>` list for a hero photograph.
 *
 * `mobileUrl` is an admin's own photograph for phones. It is used exactly as
 * saved — no widths, no re-derivation — because every rendition here is cut
 * from the *original* behind a URL, and doing that to a picture already framed
 * for a phone would centre-cut it a second time.
 *
 * Returns [] when there is nothing to derive from and no override — a bundled
 * asset, an `/uploads/…` path served by our own backend, an empty field. An
 * empty list is not a failure: every screen gets the plain `<img>`, which is
 * what the hero did before any of this existed.
 */
export const buildHeroImageSources = (url: string, mobileUrl?: string): HeroImageSource[] => {
  const override = (mobileUrl ?? "").trim();

  return BANDS.flatMap(({ media, aspect, widths }) => {
    if (override && media === PHONE_BAND) return [{ media, srcSet: override }];

    const srcSet = widths
      .map(width => ({ width, url: buildImageRendition(url, width, width / aspect) }))
      .filter(({ url: rendition }) => !!rendition)
      .map(({ width, url: rendition }) => `${rendition} ${width}w`)
      .join(", ");

    return srcSet ? [{ media, srcSet }] : [];
  });
};
