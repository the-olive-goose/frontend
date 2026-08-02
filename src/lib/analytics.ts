// First-party behavioural analytics for the storefront.
//
// Events are queued in memory and flushed in batches to POST /api/analytics/events
// — every few seconds while browsing, and via sendBeacon when the tab is hidden
// or closed so the tail of a session isn't lost. No third-party scripts, no
// cookies: the visitor id lives in localStorage only when the customer accepted
// the cookie banner; otherwise it lives in sessionStorage and dies with the tab.
//
// 'purchase' is intentionally never sent from here — the backend writes it when
// Stripe confirms the order (see finalizeCheckoutSession in backend/index.js).

import { API_URL } from './apiBase';

const VISITOR_KEY = 'og_analytics_vid';
const SESSION_KEY = 'og_analytics_sid';
const SESSION_LAST_SEEN_KEY = 'og_analytics_last';
const UTM_KEY = 'og_analytics_utm';
const CONSENT_KEY = 'og_cookie_consent'; // written by CookieConsent.tsx

const SESSION_IDLE_MS = 30 * 60 * 1000; // rotate the session after 30 min idle
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 25;

type EventType =
  | 'page_view' | 'add_to_cart' | 'remove_from_cart' | 'begin_checkout'
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

const consentGiven = () => localStorage.getItem(CONSENT_KEY) === 'accepted';

// Visitor id: persistent across visits only with cookie consent, else tab-scoped.
export const getVisitorId = (): string => {
  const store = consentGiven() ? localStorage : sessionStorage;
  let id = store.getItem(VISITOR_KEY);
  if (!id) {
    // If consent was granted after a sessionStorage id was minted, promote it so
    // the visitor's history stays continuous instead of forking.
    id = sessionStorage.getItem(VISITOR_KEY) || newId();
    store.setItem(VISITOR_KEY, id);
  }
  return id;
};

// Session id: sessionStorage-scoped, rotated after 30 minutes of inactivity.
export const getSessionId = (): string => {
  const now = Date.now();
  const last = Number(sessionStorage.getItem(SESSION_LAST_SEEN_KEY) || 0);
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id || now - last > SESSION_IDLE_MS) {
    id = newId();
    sessionStorage.setItem(SESSION_KEY, id);
    sessionStorage.removeItem(UTM_KEY); // new session → re-capture campaign params
  }
  sessionStorage.setItem(SESSION_LAST_SEEN_KEY, String(now));
  return id;
};

// UTM params are captured from the landing URL once per session so every event
// in the session carries its acquisition source.
const getUtm = (): { utm_source: string; utm_medium: string; utm_campaign: string } => {
  const saved = sessionStorage.getItem(UTM_KEY);
  if (saved) { try { return JSON.parse(saved); } catch { /* fall through */ } }
  const q = new URLSearchParams(window.location.search);
  const utm = {
    utm_source: q.get('utm_source') || '',
    utm_medium: q.get('utm_medium') || '',
    utm_campaign: q.get('utm_campaign') || '',
  };
  sessionStorage.setItem(UTM_KEY, JSON.stringify(utm));
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
// recognisable on a later visit. 'session' — consent wasn't given, the id lives
// in sessionStorage and dies with the tab, so the same human returning tomorrow
// counts as a brand-new visitor. The dashboard needs this to say how much of
// "Visitors" and "New vs returning" it can actually stand over.
const visitorScope = () => (consentGiven() ? 'persistent' : 'session');

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
