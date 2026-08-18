/**
 * Where to put the shopper back after a sign-in that leaves the app.
 *
 * The in-page sign-in modal doesn't need this: AuthContext holds the pending
 * action in a ref and re-runs it the moment sign-in succeeds. Google/Facebook
 * are different — they are a full-page navigation to the backend and back, so
 * every ref in the app is destroyed on the way. /auth/callback used to send
 * everyone to the homepage, which meant a shopper who signed in from checkout
 * (the storefront's one and only gate) landed on the homepage with their basket
 * intact and no idea they were one click from paying.
 *
 * sessionStorage, not localStorage: the destination belongs to this one tab's
 * sign-in attempt and must not outlive it, or a later visit resumes a checkout
 * the shopper has since abandoned.
 *
 * Every path is validated on the way in AND on the way out. The value round-trips
 * through storage, which devtools and any other script on the page can write, so
 * treating it as trusted would hand an attacker an open redirect off the back of
 * our sign-in flow. Only same-origin paths ("/checkout", never "//evil.example"
 * or "https://…") survive, and every access is wrapped: storage-blocked browsers
 * must degrade to "go home", never to a callback screen that throws.
 */

export const AUTH_RETURN_KEY = "og_auth_return";

// Reject anything that isn't a plain in-app path. A leading "//" or "/\" is
// protocol-relative — the browser reads it as another origin — and a path
// containing a scheme or a newline is someone trying their luck.
const isInternalPath = (path: unknown): path is string => {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > 512) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  if (/[\s\\]/.test(path)) return false;
  // Bouncing back to the callback itself would sign the shopper in, land on a
  // spinner, and consume nothing — a dead end.
  if (path.startsWith("/auth/callback")) return false;
  return true;
};

const currentPath = () => {
  try {
    return `${window.location.pathname}${window.location.search}`;
  } catch {
    return "/";
  }
};

/**
 * Called just before handing the browser to an OAuth provider. `path` is the
 * destination the shopper was heading for (the basket's "Proceed to Checkout"
 * passes "/checkout"); with no path it defaults to wherever they are now, which
 * is right for a sign-in started from the page itself.
 */
export const rememberAuthReturn = (path?: string | null) => {
  const target = isInternalPath(path) ? path : currentPath();
  try {
    if (!isInternalPath(target)) sessionStorage.removeItem(AUTH_RETURN_KEY);
    else sessionStorage.setItem(AUTH_RETURN_KEY, target);
  } catch {
    /* storage unavailable — the callback will fall back to the homepage */
  }
};

/** Reads and clears the destination. Null when there isn't a usable one. */
export const consumeAuthReturn = (): string | null => {
  try {
    const raw = sessionStorage.getItem(AUTH_RETURN_KEY);
    sessionStorage.removeItem(AUTH_RETURN_KEY);
    return isInternalPath(raw) ? raw : null;
  } catch {
    return null;
  }
};

export const clearAuthReturn = () => {
  try {
    sessionStorage.removeItem(AUTH_RETURN_KEY);
  } catch {
    /* nothing to clear if storage isn't there */
  }
};
