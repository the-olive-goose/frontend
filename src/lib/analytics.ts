// First-party behavioural analytics for the storefront.
//
// Events are queued in memory and flushed in batches to POST /api/analytics/events
// — every few seconds while browsing, and via sendBeacon when the tab is hidden
// or closed so the tail of a session isn't lost. No third-party scripts, no
// cookies, and the data never leaves our own server.
//
// MEASURES EVERY VISITOR, whatever they answered on the cookie banner. This is
// deliberate, and it is why these numbers can be trusted: they count the whole
// shop rather than only the subset who pressed Accept.
//
// The legal basis is the nature of the measurement, not a loophole: this is
// first-party audience measurement — our own site, our own database, aggregate
// reporting, nothing shared with anyone, no cross-site profile — which EU
// regulators treat as exempt from the consent requirement. There is no
// third-party analytics tag on this site; that is what keeps the exemption
// available. Adding one would put its data outside this reasoning entirely and
// would have to be gated on Accept.
//
// 'purchase' is intentionally never sent from here — the backend writes it when
// Stripe confirms the order (see finalizeCheckoutSession in backend/index.js).

import { API_URL } from './apiBase';
import { priceToNumber } from './cart';

const VISITOR_KEY = 'og_analytics_vid';
const SESSION_KEY = 'og_analytics_sid';
const SESSION_LAST_SEEN_KEY = 'og_analytics_last';
const UTM_KEY = 'og_analytics_utm';
// Set from Admin → Analytics to mark this browser as the shop's own, so a
// morning spent checking the homepage on a phone doesn't arrive as shopper
// traffic. See INTERNAL_KEY's use in payload().
const INTERNAL_KEY = 'og_analytics_internal';
// Consent (and whether it is still current) lives in lib/cookieConsent.

const SESSION_IDLE_MS = 30 * 60 * 1000; // rotate the session after 30 min idle
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 25;

// The vocabulary is GA4's, deliberately: same names, same meanings, so the two
// systems can be compared line for line and the funnel below is the one every
// ecommerce report in the world is built from. `purchase` is written by the
// backend, not from here.
//
// Funnel order — each stage is a real thing the shopper did, never a guess from
// the URL:
//   page_view → view_item_list → view_item → add_to_cart → view_cart
//             → checkout_gate → begin_checkout → add_shipping_info
//             → add_payment_info → purchase
//
// checkout_gate is ours, not GA4's, and exists because the storefront asks for a
// sign-in exactly once — at "Proceed to Checkout". Without it, a guest who
// refuses to make an account is indistinguishable from someone who wandered off
// the basket page, and the cost of that gate is unmeasurable. props.outcome is
// 'signin_required' when the wall went up and 'passed' when it didn't.
export type EventType =
  | 'page_view'
  | 'view_item_list'      // a grid of products was actually shown (shop, deals, home)
  | 'select_item'         // a specific card in that grid was clicked
  | 'view_item'           // a product detail page was actually shown
  | 'add_to_cart' | 'remove_from_cart'
  | 'view_cart'           // the basket page was actually shown
  | 'checkout_gate'       // pressed "Proceed to Checkout" — props.outcome says whether a sign-in was demanded
  | 'begin_checkout'
  | 'add_shipping_info'   // delivery/pickup chosen and the address accepted
  | 'add_payment_info'    // handed off to Stripe — the last step we can observe
  | 'search'
  | 'user_engagement'     // carries the last slice of foreground time out — see flush()
  | 'newsletter_signup' | 'signup' | 'login' | 'web_vital';

interface QueuedEvent {
  type: EventType;
  path: string;
  referrer: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  device: string;
  props: Record<string, unknown>;
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// Web Storage is not guaranteed to exist: Safari private mode, storage-blocking
// extensions and locked-down corporate builds all throw on access rather than
// returning null. Every read/write goes through these so a refusing browser
// costs us that one value, not the whole event — an unguarded throw inside
// track() would silently drop the visitor from the numbers entirely, which is
// the exact under-counting this change set exists to remove.
const readStore = (store: 'local' | 'session', key: string): string | null => {
  try {
    return (store === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch { return null; }
};

const writeStore = (store: 'local' | 'session', key: string, value: string): boolean => {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, value);
    return true;
  } catch { return false; }
};

/** Whether this browser lets us keep an id across visits at all. */
const canPersist = () => readStore('local', VISITOR_KEY) !== null;

// Last resort when nothing can be stored: keep one id for the life of the page
// so at least the events in this pageload group into a single visitor instead of
// one per event.
let memoryVisitorId = '';

// Visitor id: a random opaque token, persistent for everyone.
//
// It used to live in sessionStorage for anyone who declined cookies, which meant
// the same person returning tomorrow counted as a brand-new visitor — so
// "Visitors" was inflated and "New vs returning" was close to meaningless for
// however much of the shop's traffic declined. It carries no personal data and
// is never sent anywhere but our own API.
//
// Any id previously minted in sessionStorage is promoted rather than replaced,
// so a visitor mid-session keeps one continuous history instead of forking into
// two on the deploy that shipped this.
export const getVisitorId = (): string => {
  const stored = readStore('local', VISITOR_KEY);
  if (stored) return stored;

  const id = readStore('session', VISITOR_KEY) || memoryVisitorId || newId();
  if (!writeStore('local', VISITOR_KEY, id)) {
    // No persistent store — keep it for this tab, and for this pageload if even
    // that is refused, so the session still resolves to one visitor.
    writeStore('session', VISITOR_KEY, id);
    memoryVisitorId = id;
  }
  return id;
};

// Session id: ends after 30 minutes of inactivity, and is shared by every tab on
// the browser — the rule Shopify's `_shopify_s` and GA4's session cookie both
// use, so these numbers mean the same thing theirs do.
//
// It used to be sessionStorage-scoped, which is per-TAB: a shopper comparing
// three candles in three tabs was counted as three sessions, inflating the
// session total and dragging every per-session average (pages, duration,
// conversion) down with it. A tab-scoped id minted before this shipped is
// promoted rather than replaced, so nobody's session is split in two by the
// deploy. Falls back to a pageload-scoped id when storage is refused, so the
// funnel still sees one coherent session rather than a separate one per event.
let memorySessionId = '';

/**
 * Read a key, promoting it out of the old tab-scoped store if that is where it
 * still lives. Reading the legacy value without moving it would leave every
 * OTHER tab minting its own id — the exact split this replaces.
 */
const readEitherStore = (key: string) => {
  const shared = readStore('local', key);
  if (shared !== null) return shared;

  const carried = readStore('session', key);
  if (carried !== null && writeStore('local', key, carried)) {
    try { sessionStorage.removeItem(key); } catch { /* nothing to tidy */ }
  }
  return carried;
};

/** Write persistently, falling back to the tab when the browser refuses. */
const writeEitherStore = (key: string, value: string) => {
  if (!writeStore('local', key, value)) writeStore('session', key, value);
};

const clearBothStores = (key: string) => {
  for (const store of [localStorage, sessionStorage]) {
    try { store.removeItem(key); } catch { /* refused — nothing to clear */ }
  }
};

export const getSessionId = (): string => {
  const now = Date.now();
  const last = Number(readEitherStore(SESSION_LAST_SEEN_KEY) || 0);
  let id = readEitherStore(SESSION_KEY) || memorySessionId;
  if (!id || now - last > SESSION_IDLE_MS) {
    id = newId();
    memorySessionId = id;
    clearBothStores(SESSION_KEY);
    writeEitherStore(SESSION_KEY, id);
    clearBothStores(UTM_KEY); // new session → re-capture campaign params
  }
  writeEitherStore(SESSION_LAST_SEEN_KEY, String(now));
  return id;
};

// UTM params are captured from the landing URL once per session so every event
// in the session carries its acquisition source. Same store as the session it
// belongs to — a second tab must not re-capture (or blank) the campaign that
// brought the visitor in.
const getUtm = (): { utm_source: string; utm_medium: string; utm_campaign: string } => {
  const saved = readEitherStore(UTM_KEY);
  if (saved) { try { return JSON.parse(saved); } catch { /* fall through */ } }
  const q = new URLSearchParams(window.location.search);
  const utm = {
    utm_source: q.get('utm_source') || '',
    utm_medium: q.get('utm_medium') || '',
    utm_campaign: q.get('utm_campaign') || '',
  };
  // A prerender is a guess about a page nobody has opened. Writing its campaign
  // to storage would leave the guess behind after the guess is thrown away, and
  // the next real visit in the same session window would be credited to it.
  if (!isPrerendering()) writeEitherStore(UTM_KEY, JSON.stringify(utm));
  return utm;
};

// A hint, not a verdict. The backend classifies the device from the User-Agent
// header (see classifyDevice) and only falls back to this when the UA can't
// settle it — chiefly an iPad in desktop mode, which reports a macOS UA and is
// distinguishable only by being touch-capable.
//
// Deliberately NOT viewport width. Width called anything under 1024px a
// "tablet": a half-screen window on a 1080p monitor, a laptop at 125% browser
// zoom, devtools docked to the side, a phone in landscape. That is how a shop
// with no tablet visitors ended up reporting tablet traffic — the number was
// measuring window size and being read as hardware.
const getDeviceHint = (): string => {
  try {
    const touch = (navigator.maxTouchPoints ?? 0) > 1;
    // iPadOS 13+ Safari asks for desktop sites by default and sends a
    // "Macintosh" UA. A Mac with a touchscreen does not exist; this is an iPad.
    if (touch && /Macintosh/.test(navigator.userAgent)) return 'tablet';
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    if (uaData?.mobile === true) return 'mobile';
    if (!touch && window.matchMedia('(pointer: fine)').matches) return 'desktop';
  } catch { /* fall through — the server's UA parse decides */ }
  return '';
};

// External referrer only — internal navigation is already captured as the
// pageview sequence, and a same-origin referrer would misfile sessions as
// "referral" traffic from ourselves.
/**
 * Hosts we deliberately send the shopper to and expect back — our own checkout,
 * continued on someone else's domain.
 *
 * A shopper returning from paying is not a new visitor referred by Stripe, and
 * counting them as one is the classic self-referral defect: it invents a traffic
 * source out of our own funnel, and it does it on the highest-value sessions
 * there are — the ones that just paid. Left in, "checkout.stripe.com" climbs the
 * source report until it looks like the shop's best channel, and the campaign
 * that actually won the sale is the one that looks worthless.
 *
 * Session source is resolved from a session's LANDING event, so most returns are
 * already safe. This covers the case that isn't: a payment slow enough (3-D
 * Secure, a bank app, a distracted shopper) that the session rotated while they
 * were away, making the return the landing event of a brand-new session.
 */
export const PAYMENT_REDIRECT_HOSTS = [
  'checkout.stripe.com',
  'pay.stripe.com',
  'hooks.stripe.com',
];

/** True when this document was opened by coming back from paying. */
export const isPaymentReturn = (): boolean => {
  try {
    if (!document.referrer) return false;
    return PAYMENT_REDIRECT_HOSTS.includes(new URL(document.referrer).hostname);
  } catch { return false; }
};

const getReferrer = (): string => {
  const ref = document.referrer;
  if (!ref) return '';
  try {
    const url = new URL(ref);
    if (url.origin === window.location.origin) return '';
    // Our own checkout, finished on Stripe's domain — not a referral.
    if (PAYMENT_REDIRECT_HOSTS.includes(url.hostname)) return '';
    return ref;
  } catch { return ''; }
};

// ── Pages nobody has actually visited ─────────────────────────────────────────
// Chrome PRERENDERS a page it predicts you are about to open — from the address
// bar, from a speculation rule — by loading it fully and running its JavaScript,
// in a hidden tab that is thrown away if the prediction was wrong.
//
// Analytics cannot tell the difference on its own, so a prediction that never
// came true arrived as a complete phantom visit: a visitor, a session, a page
// view, a bounce. Someone typing "olive" into the address bar and changing their
// mind was a shopper. There is no way to spot these afterwards, and they land in
// exactly the numbers that get quoted.
//
// The flush is gated instead of the recording: events are still QUEUED during a
// prerender, because a page that IS activated must keep the page view that
// brought the shopper in. Nothing leaves the browser until the visit is real —
// and if it never becomes real, the hidden page is destroyed and the queue with
// it, which is precisely the right outcome.
//
// `document.prerendering` is undefined everywhere else, so this is inert on
// every browser that doesn't do it.
const isPrerendering = () =>
  (document as Document & { prerendering?: boolean }).prerendering === true;

/**
 * Milliseconds of prerender that happened before the shopper asked for anything.
 *
 * Every paint timestamp is measured from the moment the PRERENDER started, so on
 * an activated page they include time the shopper never waited through. Without
 * this, prerendering — a feature that makes the site feel instant — makes its
 * own Core Web Vitals look worse, and the shop chases a slow LCP that no visitor
 * has ever experienced.
 */
const activationStart = (): number => {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      (PerformanceNavigationTiming & { activationStart?: number }) | undefined;
    return nav?.activationStart ?? 0;
  } catch { return 0; }
};

// ── How long anyone actually spent here ───────────────────────────────────────
// The metric this dashboard had no answer for at all, and the first one a leader
// asks about after "how many people".
//
// Measured GA4's way, because a number called "engagement time" has to mean what
// every benchmark it will be compared against means: time the page was in the
// FOREGROUND AND VISIBLE. Not time since the session started — a tab left open
// over lunch is not two hours of interest, and counting it that way is how
// dashboards end up reporting engagement that nobody would recognise.
//
// The accumulator is sent as a DELTA with each batch and reset, so the server
// only ever adds up; a dropped batch loses that slice rather than double-counting
// the rest. A prerendered page never becomes visible, so it accumulates nothing —
// the gate is automatic rather than another special case.
let engagedMs = 0;
let activeSince: number | null = null;

const isVisible = () => {
  try { return document.visibilityState === 'visible'; } catch { return false; }
};

/** Fold the open interval, if any, into the accumulator. */
const pauseEngagement = () => {
  if (activeSince === null) return;
  engagedMs += Math.max(0, Date.now() - activeSince);
  activeSince = null;
};

const resumeEngagement = () => {
  if (activeSince === null && isVisible()) activeSince = Date.now();
};

/**
 * Everything accumulated since the last call, in milliseconds, and reset.
 *
 * Clamped at an hour: this is a delta between two flushes of the same page, and
 * a value larger than that means a clock change or a machine resumed from sleep,
 * neither of which is someone reading about candles.
 */
const takeEngagement = (): number => {
  const now = Date.now();
  if (activeSince !== null) {
    engagedMs += Math.max(0, now - activeSince);
    activeSince = now;
  }
  const total = Math.min(Math.round(engagedMs), 60 * 60 * 1000);
  engagedMs = 0;
  return total;
};

/** Whether any foreground time is waiting to be reported. */
const hasPendingEngagement = () => engagedMs > 0 || activeSince !== null;

const queue: QueuedEvent[] = [];

// 'persistent' — the visitor id survives in localStorage, so this person is
// recognisable on a later visit. 'session' — the id could not be persisted and
// dies with the tab, so the same human returning tomorrow counts as a brand-new
// visitor. The dashboard needs this to say how much of "Visitors" and "New vs
// returning" it can actually stand over.
//
// Since the cookie answer no longer decides this, the only remaining cause of
// 'session' is a browser that refuses persistent storage outright (Safari
// private mode, storage-blocking extensions). That is a small, honest residue
// rather than the large chunk of traffic it used to be.
const visitorScope = () => (canPersist() ? 'persistent' : 'session');

// ── The shop's own browsing ────────────────────────────────────────────────────
// A "visitor" is an id in this browser's localStorage, which makes the owner's
// own testing indistinguishable from a customer's visit — and worse than
// indistinguishable, because testing means clearing storage, opening private
// windows and switching devices, each of which mints another visitor. An hour of
// that reads as a small rush of shoppers.
//
// Marking the browser is the only signal that survives all of it, so the flag is
// carried on every batch rather than used to silence the client: the backend
// needs the visitor id to exclude what this browser already sent, not just what
// it sends next.

// Where api.ts keeps the admin session token. Duplicated rather than imported so
// this file stays free of the API layer; analyticsEventParity.test.ts pins the
// two spellings together, because a rename here would fail silently — the shop
// would simply go back to counting its own owner.
const ADMIN_TOKEN_KEY = 'admin_token';

/**
 * A browser that is signed in to the admin panel is, definitionally, the shop's.
 *
 * This is the signal that needed no setting up, and its absence is why the
 * owner's own visits kept appearing. Every other route can be defeated by an
 * ordinary afternoon: the marker flag is per-browser and per-origin and dies
 * with a cleared cache or a private window; the account list only catches the
 * part of a visit spent signed in as a CUSTOMER, which the owner rarely is; and
 * the home-network rule matches on the address a visit arrives from, so a VPN —
 * or a phone that dropped to mobile data — walks straight past it and lands in
 * the numbers as a stranger in whichever city the exit node was in.
 *
 * Nothing about a VPN changes what is in this browser's own storage. So the
 * moment a device has been used to administer the shop, it stops counting as a
 * shopper on that device, wherever it appears to be and whoever is signed in.
 */
export const isAdminBrowser = (): boolean => readStore('local', ADMIN_TOKEN_KEY) !== null;

/**
 * Whether this browser has been marked as the shop's own in Admin → Analytics.
 * Checks both stores: a browser that refuses localStorage still gets to exclude
 * itself for the life of the tab rather than not at all.
 *
 * Deliberately does NOT fold in isAdminBrowser(): this is the state the panel's
 * toggle owns and reports, and conflating the two would show the owner a switch
 * that reads "on" and cannot be turned off. What ingestion asks is the OR of
 * both — see countsAsInternal.
 */
export const isInternalBrowser = (): boolean =>
  readStore('local', INTERNAL_KEY) === '1' || readStore('session', INTERNAL_KEY) === '1';

/** What ingestion is told: marked by hand, or signed in to admin right now. */
const countsAsInternal = (): boolean => isInternalBrowser() || isAdminBrowser();

/** Mark or release this browser. Returns false if storage refused the change. */
export const setInternalBrowser = (internal: boolean): boolean => {
  if (!internal) {
    clearBothStores(INTERNAL_KEY);
    return true;
  }
  return writeStore('local', INTERNAL_KEY, '1') || writeStore('session', INTERNAL_KEY, '1');
};

/**
 * The query parameter that marks whatever browser opens the link.
 *
 * The last device that nothing else can reach. A browser signed in to admin
 * excludes itself; a named account excludes itself; a device on the home wifi
 * excludes itself. What none of those covers is the household phone that has
 * never opened the admin panel, never signs in, and is out of the house on
 * mobile data — or on a VPN — when it looks at the shop. From the outside it is
 * indistinguishable from a stranger, and no rule can be written that catches it
 * without also catching real shoppers.
 *
 * So it is marked by hand, once, by opening a link: the owner sends it to the
 * phone, the tablet, a partner's laptop, and each one drops out for good without
 * anyone needing the admin password. `?not-a-shopper=0` undoes it on that device.
 *
 * Sharing the link costs nothing worth protecting: the only thing anyone can do
 * with it is remove THEIR OWN visits from the count. There is no way to use it
 * to add traffic, to see anything, or to affect anyone else's measurement.
 */
export const INTERNAL_MARK_PARAM = 'not-a-shopper';

/**
 * Honour that link, then take it back out of the address bar — so the marker
 * isn't carried into a shared URL, a bookmark or a referrer, where it would
 * silently exclude whoever opened it next.
 */
const applyInternalMarkLink = () => {
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get(INTERNAL_MARK_PARAM);
    if (value === null) return;
    setInternalBrowser(value !== '0');
    url.searchParams.delete(INTERNAL_MARK_PARAM);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch { /* a URL we can't parse is not worth a broken page */ }
};

const payload = () => JSON.stringify({
  visitor_id: getVisitorId(),
  session_id: getSessionId(),
  visitor_scope: visitorScope(),
  internal: countsAsInternal(),
  // Foreground time since the last batch. The server sums these per session.
  engagement_ms: takeEngagement(),
  events: queue.splice(0, MAX_BATCH),
});

const flush = (useBeacon = false) => {
  // Not a visit yet — see isPrerendering. Keeps the queue for activation.
  if (isPrerendering()) return;
  if (!queue.length) {
    // The last slice of engagement has nothing to travel with.
    //
    // Time keeps accruing after the final event of a visit, and that slice is
    // usually the biggest one — it is the dwell time on the page someone
    // actually leaves from, the article they finished, the product they thought
    // about. With no event left to carry it, every visit lost its tail and the
    // shop's average engagement time was systematically short.
    //
    // GA4 solves this with an event whose only job is to carry the number, and
    // this is that event, under the same name. Sent only on the way out, and
    // only when there is something to say.
    if (!useBeacon || !hasPendingEngagement()) return;
    track('user_engagement', {});
    if (!queue.length) return; // refused (an admin page) — nothing to send
  }
  const body = payload();
  const url = `${API_URL}/api/analytics/events`;
  if (useBeacon && navigator.sendBeacon) {
    // text/plain is CORS-safelisted, so the beacon needs no preflight — the
    // backend route parses it back to JSON.
    navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
    return;
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // lets the backend stitch events to the logged-in customer
    keepalive: true,
    body,
  }).catch(() => { /* analytics must never surface errors to the shopper */ });
};

/**
 * Record an event. Safe to call anywhere — never throws, never blocks.
 *
 * `path` overrides the current URL, and exists for measurements that describe a
 * moment other than the one they are reported in — see reportWebVitals, where a
 * page's load speed must be filed under the page that loaded, not whichever page
 * the shopper had wandered to by the time the tab closed.
 */
export const track = (type: EventType, props: Record<string, unknown> = {}, path?: string) => {
  try {
    const at = path ?? window.location.pathname;
    if (at.startsWith('/admin')) return; // don't count ourselves
    queue.push({
      type,
      path: at,
      referrer: getReferrer(),
      ...getUtm(),
      device: getDeviceHint(),
      props,
    });
    notifyObservers(type, props, at);
    if (queue.length >= MAX_BATCH) flush();
  } catch { /* ignore */ }
};

/**
 * Watch every event this module records, without this module knowing who is
 * watching.
 *
 * Exists so the optional GA4 tag (lib/ga.ts) can mirror the funnel without a
 * single `track(...)` call site having to fire twice — one list of call sites,
 * one vocabulary, and no chance of the two systems drifting because someone
 * added an event to one and forgot the other.
 *
 * It is an observer rather than a direct call for a reason worth keeping: this
 * file must not import the third-party tag. Everything here is first-party by
 * construction, and an import edge pointing at Google would make that
 * accidental rather than structural — as well as putting gtag in the bundle for
 * every visitor, including the ones who will never consent to it.
 *
 * Observers are called inside track()'s try, so a throwing observer can't lose
 * the first-party event; each is also wrapped on its own so one bad observer
 * can't silence the others.
 */
export type TrackObserver = (type: EventType, props: Record<string, unknown>, path: string) => void;

const observers = new Set<TrackObserver>();

/** Register an observer. Returns the function that removes it again. */
export const onTrack = (fn: TrackObserver): (() => void) => {
  observers.add(fn);
  return () => { observers.delete(fn); };
};

const notifyObservers = (type: EventType, props: Record<string, unknown>, path: string) => {
  for (const fn of observers) {
    try { fn(type, props, path); } catch { /* a mirror must never break the original */ }
  }
};

export const trackPageView = (path: string) => {
  if (path.startsWith('/admin')) return;
  track('page_view', {});
};

// ── Web vitals ─────────────────────────────────────────────────────────────────
// Minimal native capture (no web-vitals dependency): LCP, CLS and INP via
// PerformanceObserver, TTFB from navigation timing. Each reports once per page
// load, when the page is first hidden.
//
// These are Google's definitions or they are nothing: the whole value of LCP,
// CLS and INP is that a number here means the same as the number in Search
// Console, PageSpeed Insights and every guide the owner will ever read. An
// approximation that drifts from the standard is worse than no metric, because
// it still gets acted on.

/** The fields of a `layout-shift` entry that CLS is computed from. */
export interface LayoutShift {
  value: number;
  startTime: number;
  hadRecentInput: boolean;
}

/**
 * CLS, to Google's definition: the worst *session window* of shifting, not the
 * total amount of it. A window groups shifts that are less than 1s apart and
 * spans at most 5s; the score is the largest window's sum.
 *
 * This replaces a plain running total, which on a single-page storefront meant
 * the score climbed for as long as someone kept browsing — the life of the
 * "page" is the whole visit here, so twenty individually harmless shifts over
 * twenty minutes added up to a "Poor" grade nobody could have perceived. The
 * metric was measuring how long a visit lasted more than how stable it looked.
 *
 * Exported for its own tests: this is the arithmetic that decides a pass or a
 * fail against Google's threshold, and it is invisible in the browser.
 */
export const newClsWindows = () => {
  let sessionValue = 0;
  let sessionStart = 0;
  let sessionLast = 0;
  let worst = 0;
  return {
    /** Folds in a batch of entries and returns the score so far. */
    add(entries: LayoutShift[]): number {
      for (const e of entries) {
        // A shift within 500ms of a real interaction is one the shopper asked
        // for — opening a menu, expanding a section — and the browser flags it
        // so it can be excluded. Counting those would penalise the site for
        // doing what it was told.
        if (e.hadRecentInput) continue;
        const continues = sessionValue !== 0
          && e.startTime - sessionLast < 1000
          && e.startTime - sessionStart < 5000;
        if (continues) {
          sessionValue += e.value;
        } else {
          sessionValue = e.value;
          sessionStart = e.startTime;
        }
        sessionLast = e.startTime;
        if (sessionValue > worst) worst = sessionValue;
      }
      return +worst.toFixed(4);
    },
  };
};

const observeWebVitals = () => {
  if (typeof PerformanceObserver === 'undefined') return;
  const vitals: Record<string, number> = {};

  // The page whose load this describes. Captured NOW, at the start of the page
  // load, because the report fires when the tab is hidden — by which point a
  // shopper who landed on a slow /shop and browsed to /basket would file /shop's
  // paint time under /basket. That is how the slowest page in the field data
  // came to be /checkout: not because checkout paints slowly, but because it is
  // where people stop. Per-page vitals are unusable without this.
  const landingPath = window.location.pathname;

  try {
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      // Measured from ACTIVATION on a prerendered page, which is the only moment
      // the shopper started waiting — the raw timestamp counts the prerender
      // too, and reports a page as slow precisely because it was made fast.
      // Google's own definition subtracts this; ours must, or the number stops
      // meaning what Search Console and PageSpeed mean by it.
      if (last) vitals.LCP = Math.max(0, Math.round(last.startTime - activationStart()));
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* unsupported */ }

  try {
    // CLS is the largest burst of shifting, not the total amount of it: the
    // score is the worst "session window" — shifts no more than 1s apart, span
    // capped at 5s — and that is what Google grades and what PageSpeed reports.
    //
    // This used to sum every shift for the life of the page. On a storefront
    // that is a single-page app, the life of the page is the whole visit, so the
    // longer someone browsed the worse their CLS looked, and a visit spread over
    // twenty minutes could be graded "Poor" on twenty separate, individually
    // harmless shifts. The number rose with engagement rather than with anything
    // a shopper would notice.
    const windows = newClsWindows();
    // Reported even when nothing shifts. Absent CLS was being read as "no data",
    // so the p75 was computed only over page loads that DID shift — the good
    // ones were silently excluded from their own average.
    vitals.CLS = 0;
    new PerformanceObserver(list => {
      vitals.CLS = windows.add(list.getEntries() as unknown as LayoutShift[]);
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* unsupported — leave CLS unreported rather than claiming a 0 */
    delete vitals.CLS;
  }

  try {
    let maxInp = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        // Only entries with an interactionId are real user interactions. The
        // 'event' stream also carries non-interactive events whose durations are
        // not INP candidates — counting those inflated p75 and graded healthy
        // pages "Poor".
        //
        // The worst single interaction is INP itself while a visit stays under
        // ~50 interactions, which every visit to a shop this size does; above
        // that Google starts discarding outliers, and this would read slightly
        // high. Erring high on responsiveness is the safe direction.
        const e = entry as unknown as { duration: number; interactionId?: number };
        if (!e.interactionId) continue;
        if (e.duration > maxInp) { maxInp = e.duration; vitals.INP = Math.round(maxInp); }
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch { /* unsupported */ }

  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    // activationStart is non-zero only on a prerendered page, where the clock
    // starts before the shopper asked for anything; without it a prerender that
    // did its work early reports a TTFB of several seconds it never cost anyone.
    if (nav) vitals.TTFB = Math.max(0, Math.round(nav.responseStart - activationStart()));
  } catch { /* unsupported */ }

  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    for (const [metric, value] of Object.entries(vitals)) {
      track('web_vital', { metric, value }, landingPath);
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') report();
  });
  window.addEventListener('pagehide', report);
};

// ── Bootstrap ──────────────────────────────────────────────────────────────────

let initialized = false;

/** Idempotent — wires the flush loop, unload beacon, and web-vitals capture. */
export const initAnalytics = () => {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  // Before anything is queued, so a device arriving on the marker link is never
  // counted even once.
  applyInternalMarkLink();
  // Make the admin signal STICK. Signing in to the admin panel excludes this
  // browser from the moment it happens (see countsAsInternal), but signing out
  // again would hand it straight back to the shopper numbers — and a device the
  // owner administers the shop from is still theirs the next morning. Promoting
  // it to the ordinary marker flag once per load is what makes it permanent,
  // and it stays undoable from the panel's own toggle.
  if (isAdminBrowser()) setInternalBrowser(true);
  // Start the engagement clock if the page is already in front. A prerendered
  // page is 'hidden' until activation, so this is a no-op there and starts on
  // the visibilitychange that activation fires.
  resumeEngagement();
  setInterval(() => flush(), FLUSH_INTERVAL_MS);
  // Vitals are wired up FIRST so its hide/pagehide listeners run before the
  // flush listeners registered below — same events, and listeners fire in
  // registration order. Flushing first sent an empty queue and left the vitals
  // sitting in it, so every sample from a closing tab was dropped and the p75s
  // were built from whoever happened to switch tabs and come back.
  observeWebVitals();
  // The moment a prediction turns into a real visit, send what was queued during
  // it rather than waiting out the interval — a shopper who lands and leaves
  // inside five seconds would otherwise be lost on the way back out.
  document.addEventListener('prerenderingchange', () => { resumeEngagement(); flush(); }, { once: true });
  document.addEventListener('visibilitychange', () => {
    // Order matters: stop the clock BEFORE flushing, so the slice that just
    // ended travels with this batch instead of waiting for a batch that may
    // never come — the tab is being hidden, and most of them never come back.
    if (document.visibilityState === 'hidden') { pauseEngagement(); flush(true); }
    else resumeEngagement();
  });
  window.addEventListener('pagehide', () => { pauseEngagement(); flush(true); });
};

/**
 * Send everything queued, right now, before the page is deliberately abandoned.
 *
 * The unload listeners below are not enough on their own, and this was measured
 * rather than assumed: a checkout that reaches Stripe loses `add_shipping_info`
 * and `add_payment_info` every time, while the same journey with the redirect
 * blocked records both. The two stages closest to the money, missing from every
 * completed order — which is precisely the population that matters.
 *
 * The events are queued milliseconds before `window.location.href` hands the
 * shopper to Stripe, so the interval flush has not come round and the pagehide
 * beacon does not reliably win the race against a cross-origin navigation.
 * Calling this first removes the race: sendBeacon is handed to the browser
 * process and survives the document being torn down.
 *
 * Deliberately exported for exactly one caller — the checkout handover. It is
 * not a general-purpose "flush now"; ordinary events are better off batched.
 */
export const flushBeforeLeaving = () => flush(true);

/**
 * The products in a basket (or a grid), in the shape every event here uses for
 * them: `line_items`, never `items`.
 *
 * The name is forced. `view_cart` and `begin_checkout` have carried an `items`
 * prop since the first day, and it is a COUNT — reusing it for an array would
 * silently change the type of a field the dashboard's SQL already reads.
 *
 * CAPPED AT TEN, and the ceiling is not a matter of taste. Ingestion truncates
 * each event's props to 2000 characters and then re-parses them —
 * `JSON.stringify(props).slice(0, 2000)` — so a payload that runs over does not
 * lose its tail: the truncation breaks the JSON, the parse fails, and the whole
 * props object is replaced with `{}`. Every field goes, silently, and the event
 * still records. Twenty lines of UUID-keyed items measures ~2700 characters and
 * takes `total`, `fulfillment_type` and the rest down with it.
 *
 * Ten lines of the worst realistic shape measures ~1400. Raising this means
 * re-checking that arithmetic against backend/index.js's limit, not guessing —
 * and src/lib/analytics.test.ts holds it to the same number.
 */
export const lineItems = (
  entries: Array<{ product: { id: string; name: string; price: string | number | null }; quantity?: number }>
) =>
  entries.slice(0, 10).map(({ product, quantity }) => ({
    product_id: product.id,
    name: product.name,
    // priceToNumber, never Number(): prices are admin free text and arrive as
    // "€38". Number("€38") is NaN and `|| 0` would price the candle at nothing.
    price: priceToNumber(product.price),
    ...(quantity === undefined ? {} : { quantity }),
  }));

/** Ids the checkout flow forwards so the backend can attribute the purchase. */
export const getAnalyticsIds = () => ({ visitor_id: getVisitorId(), session_id: getSessionId() });
