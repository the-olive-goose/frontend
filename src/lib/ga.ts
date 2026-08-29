// Google Analytics 4 — the shop's optional second measurement system.
//
// This file is the entire third-party surface of the site. Nothing outside it
// knows gtag exists: lib/analytics.ts (first-party) publishes events through
// onTrack and this module mirrors them, so there is one vocabulary, one set of
// call sites, and no way for the two systems to drift apart.
//
// FOUR THINGS MUST ALL BE TRUE before a single byte reaches Google:
//   1. the owner enabled it in Admin → Analytics → Google Analytics,
//   2. a measurement id that looks like one is saved,
//   3. this is the live shop and not a copy on localhost (isDevelopmentOrigin),
//   4. the visitor accepted cookies — unless the owner deliberately turned that
//      requirement off.
//
// (3) draws the line at work vs. trade: a copy on localhost never reports,
// because a hit that reaches a GA4 property is in it for good and there is no
// undo. The live shop always reports.
//
// That leaves the owner's own visits to the live site, which ARE hits like any
// other. They are not blocked — blocking them silently is what the old
// browser-flag rule did, and it disabled GA4 for good on any device that ever
// opened the admin panel. Instead they are LABELLED: a browser signed in to
// admin sends `traffic_type: 'internal'`, which is GA4's own designed hook for
// this, and GA4's Internal Traffic filter excludes them at reporting time.
// Visible, reversible, and it cannot silently swallow a real customer.
//
// IT DOES NOTHING UNTIL THE FILTER IS SWITCHED ON. GA4 ships that filter in
// "Testing" mode, which excludes nothing — see the admin panel's own note.
//
// (4) is what keeps the shop's legal footing. The first-party analytics measure
// everyone precisely because the data never leaves our own server; a GA4 tag is
// a different animal and is gated on Accept. See lib/analytics.ts's header for
// the full reasoning and lib/defaults.ts for the consequence — GA4 will always
// report fewer visitors than the Analytics tab, and that is correct, not a bug.

import { onTrack, isDevelopmentOrigin, isAdminBrowser, isPaymentReturn, type EventType } from './analytics';
import { cookieBannerAnswered, cookiesAccepted } from './cookieConsent';
import type { GoogleAnalyticsContent } from './defaults';

const CURRENCY = 'EUR';
const SCRIPT_ID = 'ga4-gtag';
const TAG_HOST = 'https://www.googletagmanager.com';

/** A GA4 web data stream's measurement id. Property ids (UA-…, GTM-…) are not. */
export const MEASUREMENT_ID_RE = /^G-[A-Z0-9]{4,}$/;

export const isMeasurementId = (id: string): boolean => MEASUREMENT_ID_RE.test(id.trim().toUpperCase());

type GtagArgs = [command: string, ...rest: unknown[]];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagArgs) => void;
  }
}

/**
 * Why the tag is not running — or `null` when it is.
 *
 * Every early return in this module resolves to one of these, so the admin panel
 * can state the actual reason instead of leaving the owner to guess between "not
 * saved yet", "you're the one browsing" and "nobody has accepted cookies". A
 * silent tag with no explanation is the single most common way GA4 setups get
 * abandoned half-finished.
 */
export type GaBlockedReason =
  | 'disabled'
  | 'no_measurement_id'
  | 'bad_measurement_id'
  | 'development_origin'
  | 'admin_path'
  | 'prerendering'
  | 'awaiting_consent'
  | 'consent_declined';

export const GA_BLOCKED_COPY: Record<GaBlockedReason, string> = {
  disabled: 'Turned off — nothing is sent to Google.',
  no_measurement_id: 'No measurement ID saved yet.',
  bad_measurement_id: "That measurement ID isn't a GA4 web stream id (they look like G-XXXXXXXXXX).",
  development_origin: 'This is a copy of the site running on localhost, so the tag never loads here. The live shop always reports — a visit to it is a real visit, whoever made it.',
  admin_path: 'The admin panel is never measured.',
  prerendering: 'The browser is speculatively loading this page — it is not a visit until someone looks at it.',
  awaiting_consent: 'Waiting for this visitor to answer the cookie banner.',
  consent_declined: 'This visitor declined cookies, so the tag stays off for them.',
};

/**
 * The check every caller shares. Pure — no side effects — so the admin panel can
 * ask "would this run right now?" without loading anything.
 */
export const gaBlockedReason = (
  settings: GoogleAnalyticsContent,
  opts: { path?: string; ignoreConsent?: boolean } = {}
): GaBlockedReason | null => {
  if (!settings.enabled) return 'disabled';
  const id = settings.measurement_id?.trim() ?? '';
  if (!id) return 'no_measurement_id';
  if (!isMeasurementId(id)) return 'bad_measurement_id';

  const path = opts.path ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  if (path.startsWith('/admin')) return 'admin_path';

  // A prerendered page is not a visit. Chrome loads and runs pages nobody has
  // asked for yet — from the omnibox, or from a speculation rule — and most of
  // them are never activated. The first-party pipeline already refuses to send
  // anything during a prerender (see isPrerendering in lib/analytics); without
  // the same rule here, GA4 would collect a page_view, a session and a bounce
  // for a page the shopper never saw. That is invented traffic, and it is
  // invisible: it looks exactly like a real visitor who left immediately.
  if (isPrerendering()) return 'prerendering';

  // Work in progress, not trade. The live shop always reports; a copy running on
  // localhost never does, because a hit that reaches a GA4 property is in it for
  // good and there is no undo.
  //
  // This used to key on a flag written into whatever browser opened the admin
  // panel — so looking at your own dashboard once stopped GA4 firing for you on
  // the real site, permanently and silently, while the shop's own analytics went
  // on counting you. Two systems that disagree for a reason nobody can see are
  // worse than one.
  if (settings.exclude_internal && isDevelopmentOrigin()) return 'development_origin';

  if (settings.require_consent && !opts.ignoreConsent) {
    if (!cookiesAccepted()) {
      // Not yet answered vs. answered "no" are different states to the owner:
      // one resolves itself, the other never will for this visitor.
      //
      // cookieConsent's own reader, not a second copy of it. This read the
      // `og_cookie_consent` key directly, which answers "is there a value in
      // storage" — a different question. Anything readCookieConsent refuses to
      // recognise (junk, a half-written value, another browser's data) is NOT
      // an answer, and it stays in the slot, so the raw read reported it as a
      // settled "declined" for ever and the panel blamed a visitor for a
      // decision they never made.
      //
      // The expiry case survived only by luck: cookiesAccepted() above runs
      // first and readCookieConsent clears an expired choice as it reads it, so
      // the slot is already empty by the time this line runs. Relying on that
      // is what made the bug hard to see. Fixed in lib/meta.ts first; the two
      // gates are pinned together by analyticsEventParity.test.ts.
      return cookieBannerAnswered() ? 'consent_declined' : 'awaiting_consent';
    }
  }
  return null;
};

const isPrerendering = () =>
  typeof document !== 'undefined' &&
  (document as Document & { prerendering?: boolean }).prerendering === true;

// ── The tag ────────────────────────────────────────────────────────────────────

let loadedId: string | null = null;
let active: GoogleAnalyticsContent | null = null;

/**
 * Events recorded before the tag had a chance to exist.
 *
 * A real false negative, and it hit the most valuable events in the visit. The
 * settings arrive over the network (they're admin-editable, so they can't be
 * baked into the bundle), which means there is a window at the start of every
 * visit — a few hundred milliseconds — where the shopper is already doing
 * things. On a product page opened straight from a search result, `view_item`
 * lands inside that window, so GA4 would show the session, the page_view and the
 * add_to_cart, but no view_item: a funnel with its second stage systematically
 * short, in a way that looks like shoppers adding things they never looked at.
 *
 * So events are held until the settings resolve, then replayed. `settled` is
 * what stops this becoming an unbounded queue: once the answer is known, it is
 * either replay (the tag is live) or discard (it isn't, and — importantly for
 * the consent case — those events must never be sent), and nothing is buffered
 * again after that.
 */
type PendingEvent = [type: EventType, props: Record<string, unknown>, path: string];
const pending: PendingEvent[] = [];
const MAX_PENDING = 30;
let settled = false;

/**
 * The `gtag()` from Google's own install snippet, to the letter:
 *
 *   window.dataLayer = window.dataLayer || [];
 *   function gtag(){dataLayer.push(arguments);}
 *
 * It MUST push the `arguments` object and not an array, and this is not a
 * stylistic detail — gtag.js decides whether a dataLayer entry is a COMMAND or a
 * data push by its type, and it recognises commands by `[object Arguments]`. An
 * array is read as data and the command is discarded.
 *
 * The failure that causes is the worst kind there is: gtag.js downloads, runs,
 * and defines everything it normally defines, so the tag looks installed by
 * every check available from the page — the script tag is there,
 * window.google_tag_manager exists, the dataLayer fills up with what look like
 * correct entries. And not one hit is ever sent. Confirmed by watching the
 * network: with an array push, zero requests to google-analytics.com/g/collect.
 *
 * Pushing directly rather than calling window.gtag is deliberate and matches the
 * snippet's own behaviour: the queue is what gtag.js drains when it arrives, so
 * commands issued before the script finishes downloading are kept, not dropped.
 */
function gtag(..._args: GtagArgs) {
  window.dataLayer = window.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

const loadScript = (id: string) => {
  if (document.getElementById(SCRIPT_ID)) return;
  const el = document.createElement('script');
  el.id = SCRIPT_ID;
  el.async = true;
  el.src = `${TAG_HOST}/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(el);
};

/**
 * Boot (or re-boot) the tag for the given settings.
 *
 * Idempotent and safe to call on every settings change, every consent change and
 * every mount. Returns the reason it did nothing, or null if the tag is live.
 *
 * gtag.js cannot be unloaded once it is in the page, so "turning GA off" while a
 * tab is open means: stop mirroring events, and revoke consent so the script
 * itself stops storing anything. The next page load simply never fetches it.
 */
export const configureGoogleAnalytics = (settings: GoogleAnalyticsContent): GaBlockedReason | null => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'disabled';

  const blocked = gaBlockedReason(settings);
  if (blocked) {
    if (loadedId) {
      // Already in the page from earlier in this visit — withdraw its storage
      // permission and stop feeding it.
      gtag('consent', 'update', DENIED);
      // So that turning it back on reports whatever page they're on by then,
      // rather than being deduped against a path from before the gap.
      lastPageViewPath = null;
    }
    active = null;
    if (blocked === 'prerendering') {
      // Not a "no" — a "not yet". Activation is what turns this into a visit, so
      // keep holding what the page has done and let the caller re-run then.
      return blocked;
    }
    // The answer is known and it is "no". Anything held is dropped unsent —
    // which for the awaiting-consent case is the entire point.
    settled = true;
    pending.length = 0;
    return blocked;
  }

  const id = settings.measurement_id.trim().toUpperCase();
  active = settings;

  if (loadedId === id) {
    // Already loaded — either an ordinary settings change (mirrorPageView dedupes
    // and this is a no-op) or the tag coming back after being switched off, in
    // which case the page it has come back on is its landing page and has to be
    // reported or the resumed session has none.
    gtag('consent', 'update', granted());
    mirrorPageView(window.location.pathname);
    flushPending();
    return null;
  }

  // Consent defaults go in BEFORE the library loads, which is the whole contract
  // of Consent Mode: a default arriving after gtag.js has initialised is too
  // late to govern what it already did. Ads storage is denied permanently —
  // this shop does not advertise through Google, and a measurement tag has no
  // business writing an advertising identifier.
  gtag('consent', 'default', DENIED);
  gtag('consent', 'update', granted());

  window.dataLayer = window.dataLayer || [];
  gtag('js', new Date());
  gtag('config', id, {
    // Page views are sent by hand from the router (see mirrorPageView). Left on,
    // gtag.js records one page_view at load and then nothing for the rest of the
    // visit, because this is a single-page app and no further documents load —
    // so every session would read as one page deep.
    send_page_view: false,
    // The shop's own IP-based location work is first-party; GA4 gets no help
    // narrowing a visitor down beyond what it derives itself.
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    // Coming back from Stripe is not an arrival from Stripe. Set at config time
    // rather than per event, which is both what Google documents for a site that
    // redirects through a payment processor and naturally correct: it applies to
    // the document that carries the payment referrer and to no other.
    //
    // THE STRING 'true', NOT THE BOOLEAN. gtag accepts a boolean here without
    // complaint and does nothing with it — the referrer goes out on the hit
    // exactly as before. Confirmed by watching the `dr` parameter: boolean, and
    // Stripe is still reported as the traffic source; string, and it is gone.
    ...(isPaymentReturn() ? { ignore_referrer: 'true', page_referrer: window.location.origin } : {}),
    // The shop's own browsing of its own live site, labelled rather than
    // blocked. A browser that has been signed in to the admin panel is the
    // shop's by definition (see isAdminBrowser), and `traffic_type: 'internal'`
    // is the parameter GA4's Internal Traffic filter matches on.
    //
    // Labelling instead of blocking is the whole point: the events still exist,
    // so nothing is silently missing, and the exclusion happens in GA4 where it
    // can be seen, changed and undone. Blocking was the old behaviour and it
    // turned off measurement permanently for any device that ever opened admin.
    ...(isAdminBrowser() ? { traffic_type: 'internal' } : {}),
    ...(settings.debug_mode ? { debug_mode: true } : {}),
  });

  loadScript(id);
  loadedId = id;

  // The page_view for the document that started the visit. Later navigations
  // come through the router.
  mirrorPageView(window.location.pathname);
  // Then everything the shopper did while the settings were in flight, in the
  // order they did it — after the page_view, so GA4 attributes them to the page
  // they happened on.
  flushPending();
  return null;
};

const flushPending = () => {
  settled = true;
  const held = pending.splice(0, pending.length);
  for (const [type, props, path] of held) send(type, props, path);
};

/** Map one first-party event and hand it to gtag. The single send path. */
const send = (type: EventType, props: Record<string, unknown>, path: string) => {
  if (!active) return;
  if (!active.track_ecommerce && ECOMMERCE_EVENTS.has(type)) return;
  const mapped = toGa4Event(type, props, path);
  if (!mapped) return;
  gtag('event', mapped.name, {
    // Every event says which page it happened on, rather than inheriting
    // whichever page gtag believes is current. Two cases need it: a replayed
    // event from the buffer above, and web_vital, which is filed under the page
    // that loaded rather than the page the shopper had wandered to by the time
    // the tab closed.
    ...pageViewParams(path),
    ...mapped.params,
  });
};

const DENIED = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
} as const;

const granted = () => ({ ...DENIED, analytics_storage: 'granted' as const });

/**
 * Called by the cookie banner the moment the visitor answers.
 *
 * Accept has to reach a tag that may not exist yet (the usual case — consent was
 * required, so nothing loaded), which is why this re-runs the full configure
 * rather than only sending a consent update.
 */
export const applyGoogleAnalyticsConsent = (settings: GoogleAnalyticsContent, accepted: boolean) => {
  if (!accepted) {
    if (loadedId) gtag('consent', 'update', DENIED);
    active = null;
    return;
  }
  configureGoogleAnalytics(settings);
};

/** Test seam — forget that anything was ever loaded. */
export const resetGoogleAnalyticsForTests = () => {
  loadedId = null;
  active = null;
  lastPageViewPath = null;
  settled = false;
  pending.length = 0;
  delete window.dataLayer;
  document.getElementById(SCRIPT_ID)?.remove();
};

/** Is the tag live in this page right now? */
export const isGoogleAnalyticsActive = () => active !== null && loadedId !== null;

// ── Event mirroring ────────────────────────────────────────────────────────────

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v.slice(0, 100) : undefined;

/**
 * One GA4 `items` entry built from the props our own events already carry.
 *
 * A field is omitted when we don't know it, never filled with a stand-in. An
 * earlier version defaulted `item_name` to the product id when no name was
 * given, which put strings like "p1" in the item name column of GA4's product
 * report — data that is not missing but WRONG, and impossible to spot as wrong
 * once it is in the property. GA4 needs only one of item_id/item_name, and
 * item_id is always present here.
 */
const item = (props: Record<string, unknown>) => {
  const entry: Record<string, unknown> = { item_id: str(props.product_id) ?? 'unknown' };
  const name = str(props.name);
  if (name) entry.item_name = name;
  const price = num(props.price);
  if (price !== undefined) entry.price = price;
  const quantity = num(props.quantity);
  if (quantity !== undefined) entry.quantity = quantity;
  const category = str(props.category);
  if (category) entry.item_category = category;
  const position = num(props.position);
  if (position !== undefined) entry.index = position;
  return entry;
};

/**
 * The basket (or grid) an event carried, as GA4 `items`.
 *
 * `line_items` and not `items`: our own events have carried an `items` prop
 * since day one and it is a COUNT. See lineItems() in lib/analytics.
 */
const itemsFrom = (props: Record<string, unknown>) => {
  const raw = props.line_items;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry, i) => ({ ...item(entry), index: i + 1 }));
};

/**
 * Our event vocabulary → GA4's.
 *
 * Most names pass straight through: lib/analytics.ts deliberately borrowed GA4's
 * vocabulary in the first place, so this is mostly about reshaping props into
 * GA4's `items` / `value` / `currency` conventions rather than renaming.
 *
 * Returns null for events GA4 should not receive — `user_engagement` is gtag's
 * own metric and sending our copy of it would double-count engagement time.
 */
export const toGa4Event = (
  type: EventType,
  props: Record<string, unknown>,
  path: string
): { name: string; params: Record<string, unknown> } | null => {
  const value = num(props.total);
  const items = itemsFrom(props);
  // What sits between the items' list prices and the value the shopper would
  // actually pay. Sent whenever it is known, so an event's value is never an
  // unexplained disagreement with its own items — the shape `purchase` uses,
  // applied to every stage that has the figures.
  const shipping = num(props.shipping);
  const discount = num(props.discount);
  const coupon = str(props.coupon);
  const withValue = (extra: Record<string, unknown> = {}) => ({
    ...(value !== undefined ? { currency: CURRENCY, value } : {}),
    ...(items ? { items } : {}),
    ...(shipping !== undefined ? { shipping } : {}),
    // GA4 has no discount field at event level; `coupon` is what carries the
    // fact that one was applied, so a non-zero saving with no code still says so.
    ...(discount ? { coupon: coupon || 'discount' } : {}),
    ...extra,
  });

  switch (type) {
    case 'page_view':
      return { name: 'page_view', params: pageViewParams(path) };

    case 'view_item_list': {
      const listName = str(props.list_name) ?? '';
      return {
        name: 'view_item_list',
        params: {
          // Every event whose items carry a price says which currency that price
          // is in. Left off, GA4 reads the number against the PROPERTY's default
          // currency — so a property created in dollars silently reports €25
          // candles as $25, and nothing anywhere looks wrong.
          currency: CURRENCY,
          item_list_id: str(props.list_id) ?? '',
          item_list_name: listName,
          item_count: num(props.item_count) ?? 0,
          // Each card the grid showed, so item-list impressions are real
          // numbers rather than an empty report. The list is stamped onto every
          // entry, which is how GA4 attributes an impression to a list.
          ...(items ? { items: items.map(i => ({ ...i, item_list_id: str(props.list_id) ?? '', item_list_name: listName })) } : {}),
        },
      };
    }

    case 'select_item': {
      // The list is what joins this click back to the impression that earned it
      // — without it GA4 can count both and never relate them, which is the
      // whole question an item-list report answers. Absent for a card rendered
      // outside a list scope, and omitted rather than guessed at.
      const listId = str(props.list_id);
      const listName = str(props.list_name);
      return {
        name: 'select_item',
        params: {
          currency: CURRENCY,
          ...(listId ? { item_list_id: listId } : {}),
          ...(listName ? { item_list_name: listName } : {}),
          items: [{
            ...item(props),
            ...(listId ? { item_list_id: listId } : {}),
            ...(listName ? { item_list_name: listName } : {}),
          }],
        },
      };
    }

    // The two below say nothing rather than say zero when the price is unknown.
    // A missing value is visibly missing; `value: 0` is a product GA4 will
    // report as worth nothing, averaged into order value and item revenue, with
    // no way to tell it apart from something genuinely free.
    case 'view_item': {
      const price = num(props.price);
      return {
        name: 'view_item',
        params: {
          ...(price !== undefined ? { currency: CURRENCY, value: price } : {}),
          items: [item(props)],
        },
      };
    }

    case 'add_to_cart': {
      const price = num(props.price);
      const qty = num(props.quantity) ?? 1;
      return {
        name: 'add_to_cart',
        params: {
          ...(price !== undefined ? { currency: CURRENCY, value: +(price * qty).toFixed(2) } : {}),
          items: [item(props)],
        },
      };
    }

    case 'remove_from_cart': {
      // Value is what was taken back out of the basket — the figure that makes
      // abandonment readable as money rather than as a count.
      const price = num(props.price);
      const qty = num(props.quantity) ?? 1;
      return {
        name: 'remove_from_cart',
        params: {
          currency: CURRENCY,
          ...(price !== undefined ? { value: +(price * qty).toFixed(2) } : {}),
          items: [item(props)],
        },
      };
    }

    case 'view_cart':
      return { name: 'view_cart', params: withValue() };

    case 'checkout_gate':
      // Ours, not GA4's — the sign-in wall at "Proceed to Checkout". Kept under
      // its own name so the two systems' funnels line up stage for stage.
      return { name: 'checkout_gate', params: withValue({ outcome: str(props.outcome) ?? '' }) };

    case 'begin_checkout':
      return { name: 'begin_checkout', params: withValue() };

    case 'add_shipping_info':
      return {
        name: 'add_shipping_info',
        params: withValue({ shipping_tier: str(props.fulfillment_type) ?? '' }),
      };

    case 'add_payment_info':
      return { name: 'add_payment_info', params: withValue() };

    case 'search':
      return { name: 'search', params: { search_term: str(props.query) ?? '' } };

    case 'signup':
      return { name: 'sign_up', params: { method: str(props.method) ?? 'email' } };

    case 'login':
      return { name: 'login', params: { method: str(props.method) ?? 'email' } };

    case 'newsletter_signup':
      return { name: 'newsletter_signup', params: {} };

    case 'web_vital': {
      const metric = str(props.metric) ?? '';
      return {
        name: 'web_vital',
        params: {
          metric_name: metric,
          // `metric_value`, NOT `value`. In GA4 `value` is a MONETARY field: it
          // feeds the Event value metric, sits in the same column as revenue,
          // and is what "currency is required when value is set" is about.
          // Putting milliseconds there means an LCP of 1112 is added to the
          // shop's event value alongside real euros — a number that is wrong in
          // a report about money and looks like nothing is amiss.
          //
          // GA4 truncates event values to integers, and CLS is a fraction below
          // 1 — unscaled, every sample would land as 0. Multiplying by 1000 is
          // what Google's own web-vitals recipe does, so a CLS of 0.101 arrives
          // as 101 and stays comparable with everyone else's dashboards.
          metric_value: Math.round((num(props.value) ?? 0) * (metric === 'CLS' ? 1000 : 1)),
        },
      };
    }

    // gtag measures its own engagement time. Ours would double it.
    case 'user_engagement':
      return null;

    default:
      return null;
  }
};

const pageViewParams = (path: string) => ({
  page_path: path,
  page_location: typeof window === 'undefined' ? path : `${window.location.origin}${path}`,
  page_title: typeof document === 'undefined' ? '' : document.title,
});

// The last path reported, so the same one is never sent twice in a row.
//
// Two callers legitimately want to report the landing page: the tag's own boot,
// and the router effect that fires on the render where the settings arrive.
// Neither can be dropped — boot covers consent being granted mid-visit, when the
// router has nothing new to say, and the router covers every navigation after
// that. Deduping here lets both call unconditionally.
let lastPageViewPath: string | null = null;

/** Send one page_view. Called on boot and from the router on every navigation. */
export const mirrorPageView = (path: string) => {
  if (!active || path.startsWith('/admin')) return;
  if (path === lastPageViewPath) return;
  lastPageViewPath = path;
  gtag('event', 'page_view', pageViewParams(path));
};

/**
 * Subscribe the tag to the first-party event stream. Registered once, for the
 * life of the page — the `active` check inside is what turns mirroring on and
 * off, so consent and settings changes take effect without re-subscribing.
 */
let unsubscribe: (() => void) | null = null;

export const startGoogleAnalyticsMirror = () => {
  if (unsubscribe) return;
  unsubscribe = onTrack((type, props, path) => {
    // page_view is mirrored by the router, which knows the resolved path; the
    // first-party copy would arrive with the same path and double the count.
    if (type === 'page_view') return;

    if (!active) {
      // Not yet known whether the tag may run — hold it. Once that is settled
      // this branch never buffers again: a blocked tag drops events on the
      // floor, which is what "blocked" has to mean.
      if (!settled && pending.length < MAX_PENDING) pending.push([type, props, path]);
      return;
    }
    send(type, props, path);
  });
};

const ECOMMERCE_EVENTS = new Set<EventType>([
  'view_item_list', 'select_item', 'view_item', 'add_to_cart', 'remove_from_cart',
  'view_cart', 'checkout_gate', 'begin_checkout', 'add_shipping_info', 'add_payment_info',
]);

/**
 * Wait — briefly — for gtag to have dispatched what it is holding.
 *
 * Same race as the first-party flush above: events pushed a moment before a
 * cross-origin navigation can die with the document. gtag processes its queue
 * asynchronously, so `add_payment_info` is typically still in it when Stripe
 * takes over.
 *
 * `gtag('get', …)` is used as the barrier rather than sending a flush event of
 * our own: its callback runs once the queue ahead of it has been processed, and
 * it adds nothing to the property. A phantom `ga_flush` event would show up in
 * the shop's own reports for ever.
 *
 * Always resolves, and never later than `timeoutMs`. A measurement call must
 * never be the reason a shopper cannot reach the payment page — if the tag is
 * slow or absent, the redirect goes ahead without it.
 */
export const awaitGaDelivery = (timeoutMs = 400): Promise<void> => {
  if (!active || !loadedId || typeof window === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settledOnce = false;
    const finish = () => { if (!settledOnce) { settledOnce = true; resolve(); } };
    window.setTimeout(finish, timeoutMs);
    try { gtag('get', loadedId, 'client_id', finish); } catch { finish(); }
  });
};

// ── Handing the visit to the server ────────────────────────────────────────────

/**
 * GA4's own identifiers for this browser, read out of the cookies gtag.js sets.
 *
 * The purchase event is written by the backend when Stripe confirms payment —
 * never by the browser, which by then has been redirected away and may never
 * come back. For the backend to file that purchase under the same GA4 user and
 * session as the browsing that led to it, it needs these two ids, so checkout
 * sends them along with the first-party ids it already forwards.
 *
 *   _ga           = GA1.1.1546987988.1787691831
 *   _ga_<STREAM>  = GS2.1.s1787691830$o1$g0$t1787691830$j60$l0$h0   (current)
 *                 = GS1.1.1787691830.1.1.1787691840.0.0.0          (legacy)
 *
 * THE SESSION COOKIE HAS TWO FORMATS AND THE NEW ONE IS NOT DOT-DELIMITED.
 * GS2 packs its fields as `s<session>$o<n>$g…`, so a parser written for GS1's
 * third dotted field finds `s1787691830$o1$g0$…`, rejects it as non-numeric and
 * returns nothing. Both shapes are read here because getting this wrong is
 * silent and expensive: the purchase still reaches GA4, still counts its
 * revenue, and is simply attached to no session — so every sale the shop ever
 * makes is credited to "(direct) / (none)" and every campaign, every referral
 * and every search result looks like it earned nothing. Verified against a live
 * cookie, not assumed.
 *
 * NOTHING IS RETURNED UNLESS THE TAG IS ACTUALLY LIVE FOR THIS VISITOR, and
 * that gate is the whole correctness of this function rather than a tidy-up.
 *
 * Reading the cookies alone was wrong, and wrong in the direction that matters.
 * `_ga` is written with a TWO-YEAR expiry; a consent answer lapses after
 * CONSENT_TTL_MS, which is six months. Declining does not delete the cookie —
 * `consent update DENIED` only stops gtag.js writing new ones, and no code
 * anywhere removes it. So a shopper who accepted once and later declined (or
 * simply let the answer lapse and then said no) still carries a perfectly valid
 * `_ga`, and checkout forwarded it, and the server posted their purchase to
 * Google.
 *
 * Two things wrong at once: a visitor who refused was reported to a third party
 * anyway, and the sale arrived in a property that holds NO browsing for them —
 * the tag never loaded — so GA4 filed a conversion with no session behind it and
 * credited it to "(direct) / (none)". Revenue the shop really earned, attached
 * to a journey that does not exist, quietly inflating direct attribution at the
 * expense of the campaign that actually earned it.
 *
 * `isGoogleAnalyticsActive()` is the same question getMetaIds() asks via
 * isMetaPixelActive(): not "is there a cookie" but "were we permitted to measure
 * this person on this page". An ad blocker that stops gtag.js loading costs
 * nothing here — the cookies would not exist either way.
 *
 * Both absent is the normal case for a visitor who declined cookies — the
 * purchase is then simply not reported to GA4, which is the correct outcome.
 */
export const getGaIds = (): { ga_client_id?: string; ga_session_id?: string } => {
  if (typeof document === 'undefined') return {};
  if (!isGoogleAnalyticsActive()) return {};
  const jar = document.cookie.split(';').map(c => c.trim());

  const out: { ga_client_id?: string; ga_session_id?: string } = {};

  const ga = jar.find(c => c.startsWith('_ga='))?.slice('_ga='.length);
  if (ga) {
    const parts = ga.split('.');
    // GA1.1.1234567890.1700000000 → "1234567890.1700000000"
    if (parts.length >= 4) out.ga_client_id = `${parts[2]}.${parts[3]}`;
  }

  const stream = jar.find(c => /^_ga_[A-Z0-9]+=/.test(c));
  if (stream) {
    const value = stream.slice(stream.indexOf('=') + 1);
    // GS2: the session id is the `s`-prefixed field, after a dot or a $.
    const packed = value.match(/(?:^|[.$])s(\d+)/);
    if (packed) {
      out.ga_session_id = packed[1];
    } else {
      // GS1: third dotted field.
      const parts = value.split('.');
      if (parts.length >= 3 && /^\d+$/.test(parts[2])) out.ga_session_id = parts[2];
    }
  }

  return out;
};
