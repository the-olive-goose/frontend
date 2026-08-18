/**
 * Cloudinary delivery URLs for the reel rail.
 *
 * Cloudinary hands out a URL pointing at the *original* upload, and that is what
 * gets pasted into admin. For our reels the original is a 2160x3840 phone capture
 * of around 100 MB — roughly nine times the pixels a phone can physically show in
 * a 240px card, delivered at a bitrate no storefront needs. Six of those playing
 * at once is what takes a phone browser down.
 *
 * Cloudinary re-encodes on demand when the URL carries a transformation chain, so
 * fixing this is a URL rewrite rather than a re-upload. The rewrite happens in
 * admin (Admin → Content → Videos → "Optimise for web") so the stored URL is the
 * one that ships: nothing in the render path rewrites what an admin saved, and an
 * admin can always hand-edit or paste a chain of their own.
 *
 * @see src/pages/AdminDashboard.tsx — the Videos editor that writes these
 * @see src/components/sections/VideosSection.tsx — the rail that plays them
 */

/** `https://res.cloudinary.com/<cloud>/video/upload/` + everything after it. */
const UPLOAD_RE = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)$/i;

/**
 * A transformation segment is comma-separated `xx_yyy` pairs (`w_1080,c_limit`).
 * A version segment (`v1785190731`) has no underscore and a public id normally
 * starts with something other than one-to-three letters + `_`, so this only
 * matches what it should. The last segment is never tested — it is the asset.
 */
const TRANSFORM_SEG = /^[a-z]{1,3}_[^/,]+(?:,[a-z]{1,3}_[^/,]+)*$/i;

/** Anything Cloudinary will re-encode into, plus the containers we accept. */
const VIDEO_EXT_RE = /\.(mp4|webm|ogv|ogg|mov|m4v|avi|mkv|3gp)$/i;

/** `https://res.cloudinary.com/<cloud>/video/…` — upload or any other delivery. */
const CLOUDINARY_VIDEO_PATH_RE = /^https?:\/\/res\.cloudinary\.com\/[^/]+\/video\//i;

/**
 * Whether a URL is a video file the browser can play in a `<video>` element,
 * rather than a photo or a page that happens to contain a video.
 *
 * Deliberately narrow: a file extension we know, or a Cloudinary video delivery
 * URL (whose transformation chain often means there is no extension left to
 * read). A YouTube or Instagram link is *not* one of these — those are embeds,
 * and an embed cannot be a background.
 */
export const isVideoUrl = (url: string): boolean => {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return false;
  if (CLOUDINARY_VIDEO_PATH_RE.test(trimmed)) return true;
  return VIDEO_EXT_RE.test(trimmed.split(/[?#]/)[0]);
};

export interface ParsedCloudinaryVideo {
  /** `https://res.cloudinary.com/<cloud>/video/upload/` */
  base: string;
  /** Transformation segments already present, outermost first. */
  transforms: string[];
  /** `v<version>/<public-id>.<ext>` — the asset itself. */
  path: string;
}

/**
 * Split a Cloudinary video URL into its base, any transformation chain already
 * on it, and the asset path. Returns null for every other kind of URL (YouTube,
 * Vimeo, Instagram, a plain file on someone else's CDN), which is the signal to
 * leave that URL completely alone.
 */
export const parseCloudinaryVideo = (url: string): ParsedCloudinaryVideo | null => {
  const match = (url ?? "").trim().match(UPLOAD_RE);
  if (!match) return null;

  const [, base, rest] = match;
  const segments = rest.split(/[?#]/)[0].replace(/\/+$/, "").split("/").filter(Boolean);
  if (!segments.length) return null;

  const transforms: string[] = [];
  // Stop at the final segment no matter what: that one is the asset, even when
  // its public id happens to look like a transformation.
  while (segments.length > 1 && TRANSFORM_SEG.test(segments[0])) {
    transforms.push(segments.shift() as string);
  }

  return { base, transforms, path: segments.join("/") };
};

export const isCloudinaryVideo = (url: string): boolean => parseCloudinaryVideo(url) !== null;

/** Swap whatever container the original was uploaded in for the delivered one. */
const withExtension = (path: string, ext: string): string =>
  VIDEO_EXT_RE.test(path) ? path.replace(VIDEO_EXT_RE, `.${ext}`) : `${path}.${ext}`;

export type VideoQuality = "max" | "high" | "balanced";

/**
 * The rail card tops out at 240 CSS px and the lightbox at the width of the
 * phone, so even the smallest tier here is sampled above what the screen can
 * resolve. These trade file size against headroom for large, high-DPI screens —
 * none of them trade away visible quality on a phone.
 *
 * What they *do* trade is whether the reel can stream at all. Measured on a 4G
 * phone (4 Mbps) against a real 34.8s reel:
 *
 *   Maximum / High (q_auto:best)  3.7 Mbps — needs almost the whole connection.
 *                                 The reel is still frozen when it comes into
 *                                 view and plays 1.4s of footage in 3s: it
 *                                 stutters, because it cannot download in real
 *                                 time.
 *   Balanced (q_auto:good)        2.0 Mbps — ready to play through before it is
 *                                 on screen, and runs at real speed.
 *
 * Which is why Balanced is the recommendation and the default. The higher tiers
 * are there for a shop whose visitors are on wifi, or reels short enough that
 * buffering the whole thing is quick.
 */
export const QUALITY_TIERS: Record<VideoQuality, {
  label: string;
  hint: string;
  chain: string;
}> = {
  max: {
    label: "Maximum",
    hint: "1440px wide. Headroom for a tablet or desktop at full screen.",
    chain: "f_mp4,vc_h264,w_1440,c_limit,q_auto:best",
  },
  high: {
    label: "High",
    hint: "1080px wide at the best automatic quality. Sharpest, but at roughly 3.7 Mbps it needs most of a 4G connection — a reel this size can stutter, or sit still until it has buffered.",
    chain: "f_mp4,vc_h264,w_1080,c_limit,q_auto:best",
  },
  balanced: {
    label: "Balanced — recommended",
    hint: "1080px wide at a lighter bitrate — about half the data of High, still sharp on a phone. Measured on 4G this is the point where a reel is ready before it reaches the screen and plays without stalling.",
    chain: "f_mp4,vc_h264,w_1080,c_limit,q_auto:good",
  },
};

/**
 * Balanced, not High: a reel that looks marginally sharper but cannot stream on
 * a phone is the worse reel. See the measurements above QUALITY_TIERS.
 */
export const DEFAULT_QUALITY: VideoQuality = "balanced";

/**
 * Rewrite a Cloudinary URL to deliver a web-sized H.264 mp4. Any transformation
 * chain already on the URL is replaced rather than appended to, so pressing the
 * button twice — or after changing tier — is idempotent instead of stacking
 * contradictory chains. Non-Cloudinary URLs are returned untouched.
 */
export const buildOptimizedUrl = (url: string, quality: VideoQuality = DEFAULT_QUALITY): string => {
  const parsed = parseCloudinaryVideo(url);
  if (!parsed) return url;
  const { chain } = QUALITY_TIERS[quality] ?? QUALITY_TIERS[DEFAULT_QUALITY];
  return `${parsed.base}${chain}/${withExtension(parsed.path, "mp4")}`;
};

/**
 * The rail's own copy of a reel.
 *
 * The rail is a *thumbnail*: a 341 CSS px card playing muted, on a loop, behind
 * a scrim and a caption — the code elsewhere calls it a moving poster, which is
 * exactly right. The stored URL is sized for the other thing a reel does, which
 * is fill a phone at full screen with sound, and those two jobs pull opposite
 * ways.
 *
 * Measured on a 4G phone, that mismatch is the whole problem: the stored encode
 * runs at 3.7 Mbps, so one reel needs almost the entire connection and cannot
 * start promptly however early it is mounted. This delivery is 0.93 Mbps — a
 * quarter of the data, a fraction of a second to buffer enough to start, and
 * indistinguishable in a card that size.
 *
 * It derives from the stored URL rather than replacing it, in exactly the way
 * `buildPosterUrl` does: what the admin saved is still what plays when a reel is
 * opened full screen. The rail simply asks Cloudinary for a thumbnail-weight cut
 * of the same asset. Non-Cloudinary URLs (YouTube, Vimeo, Instagram, a file on
 * someone else's CDN) come back untouched — there is nothing to ask.
 */
export const buildRailVideoUrl = (url: string): string => {
  const parsed = parseCloudinaryVideo(url);
  if (!parsed) return url;
  return `${parsed.base}f_mp4,vc_h264,w_720,c_limit,q_auto:eco/${withExtension(parsed.path, "mp4")}`;
};

/**
 * A still of the first frame, for cards that are not the one playing. At ~40 KB
 * this is what makes a rail of six reels cost less than a single photo.
 *
 * The width is an argument because the hero uses the same still very differently:
 * there it is the full-bleed image behind the headline and the thing the visitor
 * sees before a frame of video has arrived, so 640px would be visibly soft.
 */
export const buildPosterUrl = (url: string, width = 640): string => {
  const parsed = parseCloudinaryVideo(url);
  if (!parsed) return "";
  return `${parsed.base}so_0,f_jpg,q_auto,w_${width},c_limit/${withExtension(parsed.path, "jpg")}`;
};

/**
 * Whether this URL already asks Cloudinary for a resized delivery. Used by admin
 * to tell "still pointing at the 100 MB original" apart from "already handled",
 * including chains an admin wrote themselves.
 */
export const isOptimizedUrl = (url: string): boolean => {
  const parsed = parseCloudinaryVideo(url);
  if (!parsed) return false;
  return parsed.transforms.some(seg => /(^|,)(w|h|q|br)_/i.test(seg));
};

/* ── Hero background video ────────────────────────────────────────────────────

   A hero background is not a reel, and encoding it like one gets both ends
   wrong. Three differences drive everything below:

   - It is **landscape and full-bleed**, so the reel rail's 1080px (chosen for a
     240px portrait card) is too narrow for a 1440px browser window and the shot
     goes soft across the whole top of the homepage.
   - It is **always muted** — every browser requires that before it will autoplay
     anything — so the audio track it ships with is pure cost. `ac_none` drops
     it, which is ~16 KB of every second nobody can hear.
   - It **loops forever while the visitor reads**, so the bitrate is not paid
     once. This is the thing that decides whether a phone stays responsive, and
     it is why the mobile encode below is a separate, narrower delivery rather
     than the desktop one scaled down by the browser: an 1800px video painted
     into a 390px frame costs the full decode either way.

   @see buildHeroVideoUrl — desktop delivery
   @see buildHeroMobileVideoUrl — the phone's own, narrower encode            */

export type HeroVideoQuality = "max" | "balanced" | "light";

/**
 * Widths are ceilings (`c_limit`), so a clip filmed smaller is never blown up.
 *
 * The megabit figures are for a 10-second 1080p clip of ordinary café footage
 * and are what a visitor pays *per loop*, which is the number that matters —
 * a hero that costs 3 MB every eight seconds is a hero that never stops
 * downloading for as long as the homepage is open.
 */
export const HERO_VIDEO_TIERS: Record<HeroVideoQuality, {
  label: string;
  hint: string;
  width: number;
  quality: string;
}> = {
  max: {
    label: "Sharp — large desktop screens",
    width: 1920,
    quality: "q_auto:good",
    hint: "1920px wide. Sharpest on a large monitor, and the heaviest — best kept for a clip of a few seconds.",
  },
  balanced: {
    label: "Balanced — recommended",
    width: 1440,
    quality: "q_auto:good",
    hint: "1440px wide. Sharp across a normal laptop screen at roughly half the data of Sharp. Phones are served their own smaller copy either way.",
  },
  light: {
    label: "Light — longest clips, slowest connections",
    width: 1280,
    quality: "q_auto:eco",
    hint: "1280px wide at a lighter bitrate. For a longer clip, or when the footage is soft-focus enough that nobody will see the difference behind the tint.",
  },
};

export const DEFAULT_HERO_QUALITY: HeroVideoQuality = "balanced";

/**
 * The phone's encode. 960px covers a 390px viewport at better than 2x, which is
 * as much as anyone resolves in moving footage sitting behind a colour tint, and
 * it is roughly a quarter of the pixels of the desktop delivery.
 */
export const HERO_MOBILE_WIDTH = 960;

/** The still is the hero's LCP image, so it is sized for the widest screen. */
export const HERO_POSTER_WIDTH = 1920;

/**
 * A hero loops, so length is bitrate spent again and again. Ten seconds is long
 * enough to read as footage rather than a GIF and short enough that a phone has
 * the whole thing after one pass.
 */
export const HERO_TRIM_SECONDS = 10;

/** Past this, offering to trim is worth doing loudly. */
export const HERO_LONG_SECONDS = 15;

const heroChain = (width: number, quality: string, trimSeconds?: number): string =>
  [
    trimSeconds ? `so_0,du_${trimSeconds}` : "",
    // ac_none: a background is muted by definition, so the audio track is waste.
    `f_mp4,vc_h264,w_${width},c_limit,${quality},ac_none`,
  ].filter(Boolean).join("/");

const buildHero = (url: string, width: number, quality: string, trimSeconds?: number): string => {
  const parsed = parseCloudinaryVideo(url);
  if (!parsed) return url;
  // Any chain already on the URL is replaced, never appended to, so pressing the
  // button twice or changing tier is idempotent rather than contradictory.
  return `${parsed.base}${heroChain(width, quality, trimSeconds)}/${withExtension(parsed.path, "mp4")}`;
};

/**
 * The desktop delivery for a hero background. Non-Cloudinary URLs come back
 * untouched — a plain .mp4 on someone else's CDN still plays, it just cannot be
 * re-encoded by us.
 */
export const buildHeroVideoUrl = (
  url: string,
  quality: HeroVideoQuality = DEFAULT_HERO_QUALITY,
  trimSeconds?: number,
): string => {
  const tier = HERO_VIDEO_TIERS[quality] ?? HERO_VIDEO_TIERS[DEFAULT_HERO_QUALITY];
  return buildHero(url, tier.width, tier.quality, trimSeconds);
};

/**
 * The phone's delivery: narrower, and always at the lighter quality setting.
 * Stored as its own field rather than derived when the page renders, so what an
 * admin sees in the field is what a phone is actually sent.
 */
export const buildHeroMobileVideoUrl = (url: string, trimSeconds?: number): string =>
  buildHero(url, HERO_MOBILE_WIDTH, "q_auto:eco", trimSeconds);

/**
 * The clip a URL delivers, ignoring the transformation chain in front of it.
 *
 * The phone's clip is usually the phone encode of the desktop one, written by
 * the optimiser — so when the desktop clip is replaced, that encode is of a
 * video which is no longer the hero and has to go. A *different* clip an admin
 * chose for phones must survive the same edit, and this is what tells the two
 * apart.
 */
export const videoAssetKey = (url: string): string => {
  const parsed = parseCloudinaryVideo(url);
  if (!parsed) return (url ?? "").trim();
  // The container is ours to pick — every encode is delivered as mp4 whatever
  // the original was uploaded as — so it cannot be part of the identity.
  return parsed.path.replace(VIDEO_EXT_RE, "");
};

/** Whether two video URLs are two encodes of one clip. */
export const isSameVideoAsset = (a: string, b: string): boolean => {
  const key = videoAssetKey(a);
  return !!key && key === videoAssetKey(b);
};
