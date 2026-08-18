/**
 * Whether the hero plays its background clip at all, and which encode it gets.
 *
 * A hero background video is decoration. The headline, the subtext and the CTA
 * are the page; the clip behind them is atmosphere, and the still image is a
 * complete substitute for it. That asymmetry is the whole argument here: there
 * is no visitor for whom playing the video is worth a page that stutters, so
 * every doubt resolves to "show the still".
 *
 * Four things withhold it:
 *
 * - **Reduced motion.** A looping background is exactly the thing that setting
 *   exists to stop. Not a performance call — a correctness one.
 * - **Save-Data.** The visitor has told the browser they are paying for bytes.
 *   Spending megabytes on decoration against that is indefensible.
 * - **A slow connection.** Below 4G the clip cannot arrive faster than it plays,
 *   so it buffers, stalls, and janks the first thing anyone sees — while
 *   competing for the connection with the product images further down.
 * - **Nothing configured.** The common case, and it must cost nothing.
 *
 * Everything is passed in rather than read from `window` so the rule is a pure
 * function: this is the part worth testing, and none of it needs a browser.
 *
 * @see src/components/sections/HeroSection.tsx — reads the browser and applies this
 * @see src/lib/cloudinaryVideo.ts — builds the two encodes chosen between here
 */

/**
 * `effectiveType` is the browser's own estimate of the connection, and it is
 * reported for wifi too — a congested café connection reports "3g" whatever the
 * radio underneath is. That is the right basis for this decision: what matters
 * is the throughput the video would actually get.
 *
 * 3g is on the list deliberately. The phone encode runs around 1 Mbps and a
 * connection the browser calls 3g delivers roughly half of that, so the clip
 * would spend the visit buffering rather than playing.
 */
export const SLOW_CONNECTION_TYPES = ["slow-2g", "2g", "3g"];

export interface HeroVideoEnv {
  /** Phone-width viewport, so the narrower encode is the one to send. */
  isMobileViewport: boolean;
  /** `(prefers-reduced-motion: reduce)`. */
  reducedMotion: boolean;
  /** `navigator.connection.saveData`. */
  saveData: boolean;
  /** `navigator.connection.effectiveType`, when the browser reports one. */
  effectiveType?: string;
}

export interface HeroVideoSources {
  /** `hero.bg_video_url` — the desktop delivery. */
  desktop?: string;
  /** `hero.bg_video_mobile_url` — the phone's narrower encode, when one exists. */
  mobile?: string;
}

/**
 * The video URL the hero should load, or `""` for "show the still and load
 * nothing" — which is a complete, finished hero, not a degraded one.
 *
 * A phone with no mobile encode saved still gets the desktop one: an admin who
 * pasted a URL without pressing Optimise should get a working background, and
 * the admin panel is where that costs them a warning.
 */
export const resolveHeroVideoSrc = (sources: HeroVideoSources, env: HeroVideoEnv): string => {
  const desktop = (sources.desktop ?? "").trim();
  const mobile = (sources.mobile ?? "").trim();
  if (!desktop && !mobile) return "";

  if (env.reducedMotion || env.saveData) return "";
  if (env.effectiveType && SLOW_CONNECTION_TYPES.includes(env.effectiveType)) return "";

  // Desktop never gets the phone encode: it would be upscaled across the width
  // of a monitor. A phone with no encode of its own falls back to the desktop
  // one, because a heavy background beats no background.
  return env.isMobileViewport ? (mobile || desktop) : (desktop || mobile);
};
