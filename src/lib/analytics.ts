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

const VISITOR_KEY = 'og_analytics_vid';
const SESSION_KEY = 'og_analytics_sid';
const SESSION_LAST_SEEN_KEY = 'og_analytics_last';
const UTM_KEY = 'og_analytics_utm';
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
  writeEitherStore(UTM_KEY, JSON.stringify(utm));
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
const getReferrer = (): string => {
  const ref = document.referrer;
  if (!ref) return '';
  try { return new URL(ref).origin === window.location.origin ? '' : ref; } catch { return ''; }
};

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

const payload = () => JSON.stringify({
  visitor_id: getVisitorId(),
  session_id: getSessionId(),
  visitor_scope: visitorScope(),
  events: queue.splice(0, MAX_BATCH),
});

const flush = (useBeacon = false) => {
  if (!queue.length) return;
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

/** Record an event. Safe to call anywhere — never throws, never blocks. */
export const track = (type: EventType, props: Record<string, unknown> = {}) => {
  try {
    if (window.location.pathname.startsWith('/admin')) return; // don't count ourselves
    queue.push({
      type,
      path: window.location.pathname,
      referrer: getReferrer(),
      ...getUtm(),
      device: getDeviceHint(),
      props,
    });
    if (queue.length >= MAX_BATCH) flush();
  } catch { /* ignore */ }
};

export const trackPageView = (path: string) => {
  if (path.startsWith('/admin')) return;
  track('page_view', {});
};

// ── Web vitals ─────────────────────────────────────────────────────────────────
// Minimal native capture (no web-vitals dependency): LCP, CLS and INP via
// PerformanceObserver, TTFB from navigation timing. Each reports once per page
// load, when the page is first hidden.

const observeWebVitals = () => {
  if (typeof PerformanceObserver === 'undefined') return;
  const vitals: Record<string, number> = {};

  try {
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) vitals.LCP = Math.round(last.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* unsupported */ }

  try {
    let cls = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        const e = entry as unknown as { value: number; hadRecentInput: boolean };
        if (!e.hadRecentInput) cls += e.value;
      }
      vitals.CLS = +cls.toFixed(4);
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* unsupported */ }

  try {
    let maxInp = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        // Only entries with an interactionId are real user interactions. The
        // 'event' stream also carries non-interactive events whose durations are
        // not INP candidates — counting those inflated p75 and graded healthy
        // pages "Poor".
        const e = entry as unknown as { duration: number; interactionId?: number };
        if (!e.interactionId) continue;
        if (e.duration > maxInp) { maxInp = e.duration; vitals.INP = Math.round(maxInp); }
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch { /* unsupported */ }

  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) vitals.TTFB = Math.round(nav.responseStart);
  } catch { /* unsupported */ }

  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    for (const [metric, value] of Object.entries(vitals)) {
      track('web_vital', { metric, value });
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
  setInterval(() => flush(), FLUSH_INTERVAL_MS);
  // Vitals are wired up FIRST so its hide/pagehide listeners run before the
  // flush listeners registered below — same events, and listeners fire in
  // registration order. Flushing first sent an empty queue and left the vitals
  // sitting in it, so every sample from a closing tab was dropped and the p75s
  // were built from whoever happened to switch tabs and come back.
  observeWebVitals();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
};

/** Ids the checkout flow forwards so the backend can attribute the purchase. */
export const getAnalyticsIds = () => ({ visitor_id: getVisitorId(), session_id: getSessionId() });
