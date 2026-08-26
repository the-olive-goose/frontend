/**
 * The visitor's cookie choice, and — the part that didn't exist before — when
 * they made it.
 *
 * The banner used to write "accepted" once and read it back forever, so a choice
 * made on one visit in 2025 still governed that browser years later with no way
 * to revisit it short of clearing site data. Consent isn't meant to be permanent:
 * the widely-followed practice in the EU (and what the DPC's cookie guidance
 * points at) is to ask again periodically, six months being the common interval.
 *
 * Storage is deliberately split across two keys rather than one JSON blob:
 * `og_cookie_consent` keeps holding the bare choice string, because ga.ts,
 * analytics.ts and the e2e suites all seed and read exactly that. The timestamp
 * rides alongside in its own key, so nothing that predates this file breaks.
 */

export const CONSENT_KEY = 'og_cookie_consent';
const CONSENT_AT_KEY = 'og_cookie_consent_at';

/** Ask again this long after the last answer. */
export const CONSENT_TTL_MS = 182 * 24 * 60 * 60 * 1000; // ~6 months

export type CookieChoice = 'accepted' | 'declined';

/**
 * The visitor's current, unexpired choice — or `null`, meaning "ask them".
 *
 * An expired answer is cleared as it is read, so every later reader (the GA
 * loader, the analytics visitor id, the signup modal's "wait for the banner"
 * check) sees one consistent answer without each having to know about TTLs.
 */
export const readCookieConsent = (): CookieChoice | null => {
  try {
    const choice = localStorage.getItem(CONSENT_KEY);
    if (choice !== 'accepted' && choice !== 'declined') return null;

    const at = Number(localStorage.getItem(CONSENT_AT_KEY));
    // Answered before this file existed (or seeded by a test): no timestamp to
    // judge it by. Grandfather it from now rather than re-prompting everyone at
    // once — they get asked again a TTL from today.
    if (!at) {
      localStorage.setItem(CONSENT_AT_KEY, String(Date.now()));
      return choice;
    }

    if (Date.now() - at > CONSENT_TTL_MS) {
      localStorage.removeItem(CONSENT_KEY);
      localStorage.removeItem(CONSENT_AT_KEY);
      return null;
    }
    return choice;
  } catch {
    return null; // storage blocked — treat as "not answered", i.e. no consent
  }
};

/** True only for a live "accepted" — what every analytics gate should ask. */
export const cookiesAccepted = () => readCookieConsent() === 'accepted';

/** True once the visitor has answered the banner, either way. */
export const cookieBannerAnswered = () => readCookieConsent() !== null;

/**
 * Broadcast when the visitor answers the banner.
 *
 * Anything gated on consent has to react in the same moment they press the
 * button, not on the next page load — a shopper who accepts and then buys
 * something in the same visit would otherwise be missing from Google Analytics
 * entirely, which is the visit that matters most. An event rather than a direct
 * call keeps this module unaware of who is listening.
 */
export const CONSENT_EVENT = 'og:cookie-consent';

export const writeCookieConsent = (choice: CookieChoice) => {
  try {
    localStorage.setItem(CONSENT_KEY, choice);
    localStorage.setItem(CONSENT_AT_KEY, String(Date.now()));
  } catch { /* best effort — a blocked store simply means we ask again */ }
  try {
    window.dispatchEvent(new CustomEvent<CookieChoice>(CONSENT_EVENT, { detail: choice }));
  } catch { /* no window (tests, SSR) — nothing is listening anyway */ }
};
