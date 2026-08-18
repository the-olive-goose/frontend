/**
 * The avatar URL stored when a customer review is promoted onto the homepage.
 *
 * A photo attached to the "Share Your Experience" form is uploaded to the
 * backend's own `uploads/` directory and comes back as a bare `/uploads/…` path.
 * Storing that path on the testimonial is what "Add to testimonials" used to do,
 * and it fails in two ways that both look identical from the homepage — the
 * quote arrives, the photo does not:
 *
 *   - The directory is on the container's disk, which is replaced whenever the
 *     backend redeploys. This is the same disk the admin upload buttons write
 *     to, and it is why pasting an external URL is the standing advice there.
 *     The testimonial keeps its `avatarUrl`, the file behind it stops existing,
 *     and the card is left with a blank frame.
 *   - It is whatever came out of a phone camera, delivered as-is: the one on the
 *     live site is 3024x4032 and 2.2 MB, served with `max-age=0` so it is
 *     re-fetched on every visit. That is slow enough on a phone to read as
 *     missing, and big enough that a browser can decline to paint it at all.
 *
 * One fix covers both. The path is resolved against the site's own public origin
 * and handed to Cloudinary's fetch delivery, which downloads the photo once and
 * serves a web-sized copy from its CDN from then on — measured on the live photo,
 * 2.22 MB becomes 41 KB. The stored value stops depending on the file surviving
 * on the backend's disk.
 *
 * Nothing here rewrites anything at render time: the URL is resolved in admin, so
 * the value the admin saves is the value the homepage ships.
 *
 * @see src/lib/cloudinaryImage.ts — the delivery URLs themselves
 */
import { buildOptimizedImageUrl } from "./cloudinaryImage";
import { SITE_URL } from "./seo";

/** Absolute http(s), as opposed to a `/uploads/…` path. */
const ABSOLUTE_RE = /^https?:\/\//i;

/**
 * Hosts that exist only on the machine running the browser. Cloudinary fetches
 * the source from its own servers, so a dev backend is unreachable to it — and
 * `http:` is not worth handing over even when it resolves.
 */
const PRIVATE_HOST_RE =
  /^https:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|[^/:]*\.local)(?::|\/|$)/i;

/** Whether Cloudinary could reach a photo hosted at this origin. */
export const isPubliclyFetchableOrigin = (origin: string): boolean => {
  const trimmed = (origin ?? "").trim();
  return /^https:\/\//i.test(trimmed) && !PRIVATE_HOST_RE.test(trimmed);
};

/**
 * What to store when Cloudinary cannot be used — the path exactly as the server
 * issued it.
 *
 * Deliberately not `resolveUploadUrl`: that prefixes the API base, which in dev
 * is `http://localhost:3001`. The admin dashboard in dev edits the same content
 * the live site reads, so a localhost URL written here would ship to the
 * homepage and show nothing to everyone but the person who saved it. A bare path
 * is same-origin, which is correct on the live site whoever saved it.
 */
export const plainAvatarUrl = (photoPath: string): string => (photoPath ?? "").trim();

/**
 * The durable, web-sized URL for a review photo, or `""` when there isn't one.
 * The caller falls back to {@link plainAvatarUrl} then, so a photo is never
 * dropped just because it could not be improved.
 *
 * `siteOrigin` defaults to the site's **canonical public address**, deliberately
 * not `window.location.origin`. The dashboard is routinely driven from a dev
 * server against the live database, and reviews are submitted by customers on
 * the live site — so the photo being promoted is almost always sitting at
 * `https://theolivegoose.ie/uploads/…` no matter where the admin's browser is.
 * Resolving against the browser's own origin instead produced a `localhost` URL
 * Cloudinary cannot fetch, which meant every promote done from dev silently fell
 * back to the bare path and saved that to production.
 *
 * A photo that genuinely only exists on the admin's machine is handled by the
 * caller, not by a guess here: the built URL is loaded before it is stored, so
 * one Cloudinary cannot pull fails its probe and the bare path is kept — which a
 * dev server serves through its own `/uploads` proxy (see vite.config.ts).
 *
 * Sized for what the homepage actually paints. The field is called an avatar, but
 * the testimonial carousel shows the photo as a card roughly 830px wide, not as a
 * small circle, so the 400px tier would arrive visibly soft.
 */
export const durableAvatarUrl = (photoPath: string, siteOrigin: string = SITE_URL): string => {
  const path = plainAvatarUrl(photoPath);
  if (!path) return "";
  // A legacy value that is already a full URL is optimisable on its own terms.
  if (ABSOLUTE_RE.test(path)) return buildOptimizedImageUrl(path, "card");
  if (!path.startsWith("/") || !isPubliclyFetchableOrigin(siteOrigin)) return "";
  return buildOptimizedImageUrl(`${siteOrigin}${path}`, "card");
};

/**
 * A review photo as an absolute URL, so the admin's "Optimise for web" control
 * has something Cloudinary can fetch.
 *
 * This is for testimonials saved before promote started storing a durable URL:
 * their `avatarUrl` is a bare path, and the optimiser is only offered for
 * absolute URLs, so those rows had no way to be fixed from admin at all.
 * Returns the value untouched when there is nothing useful to resolve against.
 */
export const publicAvatarSource = (avatarUrl: string, siteOrigin: string = SITE_URL): string => {
  const value = (avatarUrl ?? "").trim();
  if (!value || ABSOLUTE_RE.test(value) || !value.startsWith("/")) return value;
  return isPubliclyFetchableOrigin(siteOrigin) ? `${siteOrigin}${value}` : value;
};
