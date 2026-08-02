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
    label: "High — recommended",
    hint: "1080px wide at the best automatic quality. Indistinguishable from the original on any phone.",
    chain: "f_mp4,vc_h264,w_1080,c_limit,q_auto:best",
  },
  balanced: {
    label: "Balanced",
    hint: "1080px wide at a lighter bitrate. Noticeably smaller, still sharp on a phone.",
    chain: "f_mp4,vc_h264,w_1080,c_limit,q_auto:good",
  },
};

export const DEFAULT_QUALITY: VideoQuality = "high";

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
 * A still of the first frame, for cards that are not the one playing. At ~40 KB
 * this is what makes a rail of six reels cost less than a single photo.
 */
export const buildPosterUrl = (url: string): string => {
  const parsed = parseCloudinaryVideo(url);
  if (!parsed) return "";
  return `${parsed.base}so_0,f_jpg,q_auto,w_640,c_limit/${withExtension(parsed.path, "jpg")}`;
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
