// Meta Pixel — the shop's advertising measurement.
//
// Structurally a sibling of lib/ga.ts, and deliberately so. Both are optional
// third-party tags the owner switches on in Admin → Analytics; both subscribe to
// the SAME first-party event stream (lib/analytics.ts's onTrack) rather than
// adding their own `track(...)` call sites; both are gated behind the same four
// conditions. One vocabulary, one set of call sites, three systems that cannot
// drift apart because nobody has to remember to update more than one of them.
//
// FOUR THINGS MUST ALL BE TRUE before a single byte reaches Meta:
//   1. the owner enabled it in Admin → Analytics → Meta Pixel,
//   2. a pixel id that looks like one is saved,
//   3. this is the real shop and not a copy of it running on a developer's
//      machine (see isDevelopmentOrigin),
//   4. the visitor accepted cookies — unless the owner deliberately turned that
//      requirement off.
//
// (3) IS ABOUT LOCALHOST, NOT ABOUT WHOSE BROWSER IT IS, and that is a change of
// mind worth recording. It used to exclude any browser that had opened the admin
// panel — but a visit to theolivegoose.ie is a real visit whoever made it, and
// the old rule meant the owner could never see their own pixel working on their
// own site, which cost a day of debugging something that was never broken.
//
// What it still catches is the case that genuinely poisons the data: the copy of
// the shop a developer runs locally, which seeds its content from production and
// therefore carries the real pixel id. Five such events reached the live pixel
// before this guard existed. It matters more here than anywhere else, because
// these events do not merely get counted — they teach Meta who to show the ads
// to, and a week of reloading a checkout under debug teaches it to go looking
// for more people doing that.
//
// The cost of the trade, stated plainly: the owner's own browsing of the live
// shop now reaches Meta, and unlike GA4 — which tags such hits `traffic_type:
// 'internal'` so they can be filtered afterwards — META HAS NO SUCH LEVER. A hit
// that has reached the pixel has reached it. That is judged acceptable because
// the volume is negligible against real traffic and because Meta's numbers are
// not the ones anybody reports; the shop's own first-party analytics, which do
// still exclude the owner, are.
//
// (4) is not optional in the EU in the way it is arguable for first-party
// measurement. The Meta Pixel is a third-party advertising tag: it writes
// identifiers, it is used for cross-site profiling, and no first-party
// audience-measurement exemption stretches to cover it. It loads after Accept.
//
// THE PURCHASE IS SENT TWICE, ON PURPOSE, AND COUNTED ONCE. This is Meta's own
// "redundant setup" and it is what every mature ecommerce pixel does:
//
//   - the SERVER sends it (reportPurchaseToMeta in backend/index.js) the moment
//     Stripe confirms payment. That copy is the one that cannot be missed: by
//     then the shopper is on Stripe's domain and whether they ever come back is
//     not something a shop's ad reporting may depend on. It also survives an ad
//     blocker and a browser that refuses third-party scripts outright.
//   - the BROWSER sends it (mirrorMetaPurchase, called from the success page)
//     when the shopper does come back. That copy is the one that survives the
//     server's own failures — an access token that expired, was revoked, or was
//     never set — which is the failure mode with nothing to announce it, because
//     Meta is never asked and so never complains.
//
// Both carry the SAME `eventID`, `order-<order id>`, which is exactly how Meta is
// told they are one sale: it deduplicates on event name + event id, keeps the
// first to arrive, and enriches it from the second. Get that string wrong on
// either side and the shop's revenue doubles in Events Manager, so the two are
// pinned to each other by test rather than by memory (see meta.test.ts).
//
// The browser also contributes the pair of cookies it forwards at checkout — see
// getMetaIds — which is what lets the server-side copy be matched to the person
// who clicked the ad.

import {
  onTrack, isDevelopmentOrigin, getVisitorId, type EventType,
} from './analytics';
import { cookieBannerAnswered, cookiesAccepted } from './cookieConsent';
import type { MetaPixelContent } from './defaults';

const CURRENCY = 'EUR';
const SCRIPT_ID = 'meta-pixel';
const SCRIPT_SRC = 'https://connect.facebook.net/en_US/fbevents.js';
// Where a click-id is kept when the browser's own `_fbc` cookie isn't there to
// read. See getMetaIds.
const FBCLID_KEY = 'og_meta_fbclid';

/**
 * A Meta Pixel id: 15 or 16 digits, AND IT CANNOT START WITH A ZERO.
 *
 * Narrow on purpose. The three things an owner is likely to paste here instead
 * are an ad account id (`act_123…`), a Business Manager id, or the whole install
 * snippet — and every one of them fails this, which is the difference between a
 * panel that says "that isn't a pixel id" and a pixel that silently measures
 * nothing for a fortnight.
 *
 * THE LEADING ZERO IS NOT PEDANTRY, it is the exact failure above. This was
 * `/^\d{15,16}$/`, which accepts `000000000000001` — and fbevents.js does not.
 * Loaded with such an id it logs `[Meta Pixel] - Invalid PixelID: null`, never
 * requests the pixel's config, discards every queued call and sends nothing,
 * ever. Observed against the live library, not reasoned about: a valid-shaped id
 * fetches `connect.facebook.net/signals/config/<id>` within a second, and one
 * with a leading zero fetches nothing at all.
 *
 * Meta issues ids from a counter, so a real one never starts with zero. Without
 * this the admin panel would tick "Pixel ID saved ✓" over a pixel that could not
 * load — the one failure this shop's measurement is least able to notice.
 */
export const PIXEL_ID_RE = /^[1-9]\d{14,15}$/;

export const isPixelId = (id: string): boolean => PIXEL_ID_RE.test(id.trim());

/**
 * The Test Events code from Events Manager → Test Events. Always `TEST` plus
 * digits.
 */
export const TEST_EVENT_CODE_RE = /^TEST\d{1,12}$/i;

export const isTestEventCode = (code: string): boolean => TEST_EVENT_CODE_RE.test(code.trim());

type FbqFn = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: FbqFn;
    _fbq?: FbqFn;
  }
}

/**
 * Why the pixel is not running — or `null` when it is.
 *
 * Same union as lib/ga.ts's, so the two admin panels can explain themselves the
 * same way. A tag that is quietly off looks exactly like one that is quietly on;
 * the only cure is for the panel to be able to state the actual reason.
 */
export type MetaBlockedReason =
  | 'disabled'
  | 'no_pixel_id'
  | 'bad_pixel_id'
  | 'development_origin'
  | 'admin_path'
  | 'prerendering'
  | 'awaiting_consent'
  | 'consent_declined';

export const META_BLOCKED_COPY: Record<MetaBlockedReason, string> = {
  disabled: 'Turned off — nothing is sent to Meta.',
  no_pixel_id: 'No pixel ID saved yet.',
  bad_pixel_id: "That isn't a Meta Pixel ID (15 or 16 digits, never starting with a zero).",
  development_origin: 'This is a copy of the site running on localhost, so the pixel never loads here. The live shop always reports — a visit to it is a real visit, whoever made it.',
  admin_path: 'The admin panel is never measured.',
  prerendering: 'The browser is speculatively loading this page — it is not a visit until someone looks at it.',
  awaiting_consent: 'Waiting for this visitor to answer the cookie banner.',
  consent_declined: 'This visitor declined cookies, so the pixel stays off for them.',
};

/**
 * The check every caller shares. Pure — no side effects — so the admin panel can
 * ask "would this run right now?" without loading anything.
 */
export const metaBlockedReason = (
  settings: MetaPixelContent,
  opts: { path?: string; ignoreConsent?: boolean } = {}
): MetaBlockedReason | null => {
  if (!settings.enabled) return 'disabled';
  const id = settings.pixel_id?.trim() ?? '';
  if (!id) return 'no_pixel_id';
  if (!isPixelId(id)) return 'bad_pixel_id';

  const path = opts.path ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  if (path.startsWith('/admin')) return 'admin_path';

  // A prerendered page is not a visit. Chrome loads and runs pages nobody has
  // asked for yet, and most are never activated — see the same guard in
  // lib/ga.ts and isPrerendering in lib/analytics. Without it Meta collects a
  // PageView for a page the shopper never saw, which is invented traffic that
  // looks exactly like a real visitor who left immediately.
  if (isPrerendering()) return 'prerendering';

  // Same rule as the GA4 tag, and for the same reason: the live shop is trade,
  // localhost is work. A flag on the owner's browser used to gate this, which
  // meant opening the admin panel once stopped the Pixel firing for them on the
  // real site for good.
  if (settings.exclude_internal && isDevelopmentOrigin()) return 'development_origin';

  if (settings.require_consent && !opts.ignoreConsent) {
    if (!cookiesAccepted()) {
      // Not yet answered vs. answered "no" are different states to the owner:
      // one resolves itself, the other never will for this visitor.
      //
      // cookieConsent's own reader, not a second copy of it. This read the
      // `og_cookie_consent` key directly, which answers "there is a value in
      // storage" — a different question. A choice older than CONSENT_TTL_MS has
      // expired and the visitor is due to be asked again, and only
      // cookieBannerAnswered knows that, so a "declined" from eight months ago
      // reported itself here as a settled no rather than the "we are about to ask
      // them again" it actually is.
      return cookieBannerAnswered() ? 'consent_declined' : 'awaiting_consent';
    }
  }
  return null;
};

const isPrerendering = () =>
  typeof document !== 'undefined' &&
  (document as Document & { prerendering?: boolean }).prerendering === true;

// ── The pixel ──────────────────────────────────────────────────────────────────

let loadedId: string | null = null;
let active: MetaPixelContent | null = null;
let lastPageViewPath: string | null = null;

/**
 * Events recorded before the settings had arrived — held, then replayed.
 *
 * Identical reasoning to lib/ga.ts's buffer, and the same real failure: the
 * settings come over the network because they're admin-editable, so there is a
 * window of a few hundred milliseconds at the start of every visit during which
 * the shopper is already doing things. On a product page opened straight from an
 * ad, `view_item` lands inside that window — so Meta would see the PageView and
 * the AddToCart with no ViewContent between them, and the one audience an
 * advertiser most wants ("people who viewed this product") would be
 * systematically short.
 *
 * `settled` is what stops this becoming an unbounded queue: once the answer is
 * known it is either replay (the pixel is live) or discard (it isn't — and for
 * the awaiting-consent case, discarding is the entire point).
 */
type PendingEvent = [type: EventType, props: Record<string, unknown>, path: string];
const pending: PendingEvent[] = [];
const MAX_PENDING = 30;
let settled = false;

/**
 * Meta's own install snippet, to the letter.
 *
 *   !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
 *   n.callMethod.apply(n,arguments):n.queue.push(arguments)};
 *   if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];…}
 *
 * Written out here rather than injected as an inline <script> because the site's
 * CSP has no 'unsafe-inline' and is not going to grow one for a tag (see
 * public/_headers). Every property below is load-bearing:
 *
 *   - a `function`, NOT an arrow — the body reads `arguments`, which an arrow
 *     function does not have. This is the same class of mistake as pushing an
 *     array into gtag's dataLayer (see lib/ga.ts): the page looks completely
 *     healthy and not one event is ever sent.
 *   - `n.queue` is what fbevents.js drains when it finishes downloading. Calls
 *     made in the meantime — which on a fast connection is most of the landing
 *     page — are kept rather than dropped.
 *   - `n.push = n` and `n.loaded`/`n.version` are read by fbevents.js itself to
 *     recognise its own stub. Omit them and it installs a second, empty queue
 *     over the top of the one holding the visit's first events.
 */
const bootstrapFbq = () => {
  if (window.fbq) return;
  const n = function (this: unknown) {
    // eslint-disable-next-line prefer-rest-params
    const args = arguments;
    // eslint-disable-next-line prefer-spread
    if (n.callMethod) n.callMethod.apply(n, args as unknown as unknown[]);
    // The Arguments object itself, NOT a copy of it — this is what fbevents.js
    // drains, and it applies each entry back through callMethod.
    else n.queue!.push(args);
  } as FbqFn;
  window.fbq = n;
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
};

/** Call the pixel. Safe before fbevents.js has loaded — the stub queues it. */
const fbq = (...args: unknown[]) => {
  window.fbq?.(...args);
};

const loadScript = () => {
  if (document.getElementById(SCRIPT_ID)) return;
  const el = document.createElement('script');
  el.id = SCRIPT_ID;
  el.async = true;
  el.src = SCRIPT_SRC;
  document.head.appendChild(el);
};

/**
 * What the browser knows about the person, for Advanced Matching.
 *
 * Set by components/MetaPixel.tsx from the signed-in account. THE PLAINTEXT
 * NEVER LEAVES THE PAGE: fbevents.js normalises each field and SHA-256-hashes it
 * before building the request — verified by reading the `ud[…]` parameters off a
 * live hit, not taken on trust. That is also why plain values are passed here
 * rather than hashed ones: Meta's normaliser is the reference implementation,
 * and any difference between it and ours is a silent failure to match rather
 * than an error. (The server has no such luxury and has to reproduce those rules
 * byte for byte — see backend/metaCapi.js, where each one is written down.)
 *
 * Applies ONLY at the pixel's first init. See setMetaUserData.
 */
export interface MetaUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** Our own opaque visitor id — no personal data, but a strong join key. */
  externalId?: string;
}

let userData: MetaUserData = {};

/**
 * Meta's advanced-matching keys, built from what we know.
 *
 * Empty when the owner has advanced matching switched off, so the switch means
 * what it says rather than "mostly off".
 */
const matchPayload = (): Record<string, string> => {
  const out: Record<string, string> = {};

  // Sent whatever the switch says, and the switch is still honoured — because
  // this is not what the switch is about. Advanced matching is the promise that
  // the shop decides whether a shopper's EMAIL, PHONE AND NAME reach Meta. A
  // random first-party token says nothing about who anybody is, and it is what
  // joins these browser events to the sale the server writes at the end. See
  // metaUserData in backend/metaCapi.js, where the server sends the same value
  // hashed the same way.
  if (userData.externalId) out.external_id = userData.externalId;

  if (!active?.advanced_matching) return out;

  const email = userData.email?.trim().toLowerCase();
  if (email && email.includes('@')) out.em = email;
  // Digits only, country code included — the shape Meta's own normaliser
  // produces. Our stored numbers are already E.164 ("+353871234567").
  const phone = userData.phone?.replace(/\D/g, '');
  if (phone && phone.length >= 7) out.ph = phone;
  const first = userData.firstName?.trim().toLowerCase();
  if (first) out.fn = first;
  const last = userData.lastName?.trim().toLowerCase();
  if (last) out.ln = last;
  return out;
};

/**
 * Tell the pixel who this is. Safe to call on every render.
 *
 * ONE CHANCE, AND IT IS AT INIT. fbevents.js takes advanced-matching data from
 * the FIRST `fbq('init', <pixel>, …)` for a pixel and ignores every later one:
 * a second init with an email attached changes nothing, and neither does
 * `fbq('set', 'userData', …)`. Both were tried against the live library and
 * neither moved the `ud[…]` parameters on the wire by a single byte, while both
 * return silently as though they had worked. The pixel's own state object still
 * held only the identifier it started with.
 *
 * So this records what is known, and components/MetaPixel.tsx waits for the
 * signed-in account to resolve before letting the pixel boot — because that is
 * the only moment the answer can be given.
 *
 * A shopper who signs in MID-visit is therefore not re-identified to the pixel,
 * and that is not the hole it looks like: their browser events keep carrying
 * `external_id`, which is stable for this browser, and the purchase the server
 * writes at the end carries that same `external_id` alongside their hashed email
 * and phone. Meta joins the two. The identity reaches it either way — over the
 * connection that does not depend on a third-party script being allowed to run.
 */
export const setMetaUserData = (next: MetaUserData) => {
  userData = next;
};

/**
 * Boot (or re-boot) the pixel for the given settings.
 *
 * Idempotent and safe to call on every settings change, every consent change and
 * every mount. Returns the reason it did nothing, or null if the pixel is live.
 *
 * fbevents.js cannot be unloaded once it is in the page, so "turning the pixel
 * off" while a tab is open means: stop mirroring events, and revoke consent so
 * the script itself stops sending and storing. The next page load simply never
 * fetches it.
 */
export const configureMetaPixel = (settings: MetaPixelContent): MetaBlockedReason | null => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'disabled';

  const blocked = metaBlockedReason(settings);
  if (blocked) {
    if (loadedId) {
      fbq('consent', 'revoke');
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
    // Including the sale. A visitor who declined cookies does not get their
    // purchase sent to Meta a moment later because the tag settled after it.
    pendingPurchase = null;
    return blocked;
  }

  const id = settings.pixel_id.trim();
  active = settings;
  rememberClickId();

  if (loadedId === id) {
    // Already loaded — either an ordinary settings change (mirrorMetaPageView
    // dedupes and this is a no-op) or the pixel coming back after being switched
    // off, in which case the page it has come back on is its landing page and has
    // to be reported or the resumed visit has none.
    fbq('consent', 'grant');
    mirrorMetaPageView(window.location.pathname);
    flushPending();
    return null;
  }

  bootstrapFbq();
  // Consent BEFORE init, which is the whole contract of Meta's consent API: a
  // grant issued after the pixel has already decided it may not send is applied
  // to nothing that came before it. We only get here when sending is permitted,
  // so this is a grant.
  fbq('consent', 'grant');

  // Automatic configuration OFF, and this one is a decision rather than a
  // tidy-up. Left on (the default), fbevents.js helps itself to the page:
  // Automatic Advanced Matching scrapes form fields for email addresses and
  // phone numbers and attaches whatever it finds, and it does so whatever the
  // owner set the advanced-matching switch to. The form in question is the
  // checkout address form. A tag taking what is typed into that, while the
  // admin panel tells the owner they decide whether a shopper's details are
  // sent, would make that promise simply untrue — so the pixel goes on manual
  // and every event it sends is one this file decided to send.
  //
  // It also stops the automatic button-click and microdata events, which is a
  // fair price: they arrive in Events Manager as untyped noise no ad, audience
  // or report can use.
  //
  // WHAT IT DOES NOT DO, checked rather than assumed: it does not stop
  // fbevents.js sending a PageView of its own on every history.pushState. That
  // behaviour survives autoConfig: false — see mirrorMetaPageView.
  fbq('set', 'autoConfig', false, id);

  // The one and only chance to say who this is — see setMetaUserData.
  fbq('init', id, matchPayload());
  loadScript();
  loadedId = id;

  // The PageView for the document that started the visit. Later navigations come
  // through the router.
  mirrorMetaPageView(window.location.pathname);
  // Then everything the shopper did while the settings were in flight, in the
  // order they did it — after the PageView, so Meta attributes them to the page
  // they happened on.
  flushPending();
  return null;
};

const flushPending = () => {
  settled = true;
  const held = pending.splice(0, pending.length);
  for (const [type, props, path] of held) send(type, props, path);
  // The sale last, so it lands after the browsing that produced it. Cleared
  // before sending so a throw inside cannot leave it to be replayed twice — the
  // reportedOrders guard would catch that anyway, and both together is the point.
  const purchase = pendingPurchase;
  pendingPurchase = null;
  if (purchase) sendPurchase(purchase);
};

/**
 * Called by the cookie banner the moment the visitor answers.
 *
 * Accept has to reach a pixel that may not exist yet (the usual case — consent
 * was required, so nothing loaded), which is why this re-runs the full configure
 * rather than only sending a consent update.
 */
export const applyMetaPixelConsent = (settings: MetaPixelContent, accepted: boolean) => {
  if (!accepted) {
    if (loadedId) fbq('consent', 'revoke');
    active = null;
    // The same forget configureMetaPixel performs when it blocks, and for the
    // same reason: whatever page this visit resumes on has to be reportable. Left
    // set, a pixel that came back while the shopper was still standing on the
    // page it was switched off on would dedupe its own resumed landing page away
    // and the resumed visit would have no PageView at all.
    lastPageViewPath = null;
    settled = true;
    pending.length = 0;
    return;
  }
  configureMetaPixel(settings);
};

/** Test seam — forget that anything was ever loaded. */
export const resetMetaPixelForTests = () => {
  loadedId = null;
  active = null;
  lastPageViewPath = null;
  settled = false;
  pending.length = 0;
  pendingPurchase = null;
  reportedOrders.clear();
  arrivalFbclid = readFbclid();
  userData = {};
  delete window.fbq;
  delete window._fbq;
  document.getElementById(SCRIPT_ID)?.remove();
};

/** Is the pixel live in this page right now? */
export const isMetaPixelActive = () => active !== null && loadedId !== null;

// ── Event mirroring ────────────────────────────────────────────────────────────

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v.slice(0, 100) : undefined;

const newEventId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** One entry of Meta's `contents` array, built from the props our events carry. */
const content = (props: Record<string, unknown>) => {
  const entry: Record<string, unknown> = { id: str(props.product_id) ?? 'unknown' };
  const quantity = num(props.quantity);
  entry.quantity = quantity ?? 1;
  const price = num(props.price);
  // `item_price`, and omitted rather than zeroed when unknown — a 0 here is a
  // product Meta will optimise towards as if it were worthless, and there is
  // nothing downstream that would ever flag it.
  if (price !== undefined) entry.item_price = price;
  return entry;
};

/** The basket (or grid) an event carried, as Meta `contents`. */
const contentsFrom = (props: Record<string, unknown>) => {
  const raw = props.line_items;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const list = raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map(content);
  return list.length ? list : undefined;
};

/**
 * Meta's standard events, exactly — the seventeen names `fbq('track', …)`
 * accepts.
 *
 * Anything outside this list has to go through `trackCustom`, and that is not a
 * detail: `fbq('track', 'SomethingElse')` is reported by the Meta Pixel Helper
 * extension as an invalid event, which is precisely the tool the owner will be
 * looking at while deciding whether this works. Our own vocabulary earns a
 * custom event or nothing.
 */
const STANDARD_EVENTS = new Set([
  'AddPaymentInfo', 'AddToCart', 'AddToWishlist', 'CompleteRegistration', 'Contact',
  'CustomizeProduct', 'Donate', 'FindLocation', 'InitiateCheckout', 'Lead', 'Purchase',
  'Schedule', 'Search', 'StartTrial', 'SubmitApplication', 'Subscribe', 'ViewContent',
]);

export interface MetaEvent {
  name: string;
  params: Record<string, unknown>;
  /** `trackCustom` rather than `track` — see STANDARD_EVENTS. */
  custom?: boolean;
  /**
   * The id Meta deduplicates on, when it has to AGREE with something else.
   *
   * Only the Purchase sets this, because only the Purchase is sent twice — see
   * the header. Everything else gets a fresh random one, which is right: an id
   * shared by two events that are not the same event silently deletes one of
   * them.
   */
  eventId?: string;
}

/**
 * Our event vocabulary → Meta's.
 *
 * Deliberately NOT one-to-one. Meta's event list is an advertising vocabulary,
 * not an analytics one: it exists so that campaigns can be optimised towards
 * these actions and audiences built from them. Sending it events it has no
 * meaning for — `remove_from_cart`, `add_shipping_info`, `web_vital` — would put
 * rows in Events Manager that no ad, audience or report can ever use, while
 * making the ones that matter harder to find. Those stay in the Analytics tab
 * and in GA4, which are the systems built to answer that kind of question.
 *
 * Returns null for everything Meta should not receive.
 */
export const toMetaEvent = (
  type: EventType,
  props: Record<string, unknown>
): MetaEvent | null => {
  const contents = contentsFrom(props);
  const ids = contents?.map((c) => c.id as string);
  const value = num(props.total);

  switch (type) {
    case 'view_item': {
      const price = num(props.price);
      const name = str(props.name);
      const category = str(props.category);
      return {
        name: 'ViewContent',
        params: {
          content_type: 'product',
          content_ids: [str(props.product_id) ?? 'unknown'],
          contents: [content(props)],
          ...(name ? { content_name: name } : {}),
          ...(category ? { content_category: category } : {}),
          // Currency is sent with every value, always. Left off, Meta reads the
          // number against the ad account's currency — so a property set up in
          // dollars silently values €38 candles at $38, and no screen anywhere
          // looks wrong.
          ...(price !== undefined ? { currency: CURRENCY, value: price } : {}),
        },
      };
    }

    case 'add_to_cart': {
      const price = num(props.price);
      const qty = num(props.quantity) ?? 1;
      const name = str(props.name);
      return {
        name: 'AddToCart',
        params: {
          content_type: 'product',
          content_ids: [str(props.product_id) ?? 'unknown'],
          contents: [content(props)],
          ...(name ? { content_name: name } : {}),
          ...(price !== undefined ? { currency: CURRENCY, value: +(price * qty).toFixed(2) } : {}),
        },
      };
    }

    case 'begin_checkout':
      return {
        name: 'InitiateCheckout',
        params: {
          content_type: 'product',
          ...(ids ? { content_ids: ids } : {}),
          ...(contents ? { contents } : {}),
          // Omitted when unknown. `num_items: 0` is a checkout Meta will report
          // as containing nothing, averaged into basket size, and
          // indistinguishable from a real empty one.
          ...(num(props.items) ?? contents?.length
            ? { num_items: num(props.items) ?? contents!.length }
            : {}),
          ...(value !== undefined ? { currency: CURRENCY, value } : {}),
        },
      };

    case 'add_payment_info':
      return {
        name: 'AddPaymentInfo',
        params: {
          content_type: 'product',
          ...(ids ? { content_ids: ids } : {}),
          ...(contents ? { contents } : {}),
          ...(value !== undefined ? { currency: CURRENCY, value } : {}),
        },
      };

    case 'search': {
      // A Search with no term is a row in Meta's reports that says a search
      // happened and refuses to say what for. The navbar only fires this on
      // submit with a non-empty term, so this is belt and braces — but the
      // belt is what keeps a future call site from putting blanks in there.
      const term = str(props.query);
      if (!term) return null;
      // The products the search actually turned up, so "searched for something we
      // sell" is a retargetable audience rather than a bare string. Ids only —
      // there is no basket here, so no quantity and no value to state, and Meta
      // reads `contents` without `item_price` as a set of worthless products.
      const found = Array.isArray(props.result_ids)
        ? props.result_ids.filter((v): v is string => typeof v === 'string' && !!v).slice(0, 10)
        : [];
      return {
        name: 'Search',
        params: {
          search_string: term,
          ...(found.length ? { content_type: 'product', content_ids: found } : {}),
        },
      };
    }

    case 'signup':
      return {
        name: 'CompleteRegistration',
        params: { status: true, content_name: str(props.method) ?? 'email' },
      };

    // A newsletter signup is a Lead, not a Subscribe: Meta's `Subscribe` means a
    // paid subscription and carries a value, and reporting an email address as
    // one would put a phantom revenue line in Events Manager.
    case 'newsletter_signup':
      return { name: 'Lead', params: { content_name: 'newsletter' } };

    // Ours, not Meta's — a product grid was shown. Worth sending because a
    // "viewed this collection" audience is a real retargeting audience, but it
    // is not one of the seventeen names `track` accepts, so it goes out as a
    // custom event rather than as an invalid standard one.
    case 'view_item_list': {
      const listName = str(props.list_name);
      return {
        name: 'ViewCategory',
        custom: true,
        params: {
          content_type: 'product',
          // Omitted, not blanked. An empty string is a category in Meta's
          // reports — a real row, named nothing, that every unnamed grid on the
          // site accumulates into.
          ...(listName ? { content_category: listName } : {}),
          ...(ids ? { content_ids: ids.slice(0, 10) } : {}),
        },
      };
    }

    // Everything else — select_item, remove_from_cart, view_cart, checkout_gate,
    // add_shipping_info, login, user_engagement, web_vital — has no advertising
    // meaning. page_view is handled by mirrorMetaPageView, which knows the
    // resolved router path.
    default:
      return null;
  }
};

const ECOMMERCE_EVENTS = new Set<EventType>([
  'view_item_list', 'view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info',
]);

/** Map one first-party event and hand it to the pixel. The single send path. */
const send = (type: EventType, props: Record<string, unknown>, _path: string) => {
  if (!active) return;
  if (!active.track_ecommerce && ECOMMERCE_EVENTS.has(type)) return;
  const mapped = toMetaEvent(type, props);
  if (!mapped) return;
  emit(mapped);
};

/**
 * Hand one mapped event to fbq.
 *
 * Every event carries an `eventID`. Nothing sends a duplicate of these today —
 * the one server-side event is `Purchase`, which the browser never sends — but
 * an event id is what Meta deduplicates on, and adding one later to a pixel that
 * has been running without them is how a shop ends up counting the same
 * conversion twice for a fortnight before anyone notices.
 */
const emit = ({ name, params, custom, eventId }: MetaEvent) => {
  // `eventID` is the ONLY key fbevents.js documents for this fourth argument, and
  // it is the only one passed. The owner's Test Events code is deliberately not
  // smuggled in here: it is a Conversions API parameter, browser events are
  // tested through Events Manager's own "Test browser events" box instead, and
  // handing a third-party library an undocumented option to see what it does
  // with it is not a thing to do to a live shop's measurement.
  fbq(custom ? 'trackCustom' : 'track', name, params, { eventID: eventId ?? newEventId() });
};

/**
 * One PageView per page. Called on boot and from the router on every navigation.
 *
 * `lastPageViewPath` is because two callers legitimately want to report the
 * landing page — the pixel's own boot and the router effect that fires on the
 * render where the settings arrive — and neither can be dropped.
 *
 * WHAT ACTUALLY REACHES META ON AN IN-APP NAVIGATION IS NOT THIS CALL, and it is
 * worth knowing which. fbevents.js hooks the History API and sends its own
 * PageView on every pushState, then treats ours for the same URL as a duplicate
 * and drops it — observed on the wire: after a pushState, two explicit
 * `fbq('track','PageView')` calls produced no requests at all, while a custom
 * event issued in the same breath went out normally.
 *
 * The count is therefore right — exactly one PageView per page, on full loads
 * (ours) and on router navigations (theirs) alike — and the only thing lost is
 * our event id on the in-app ones, which nothing needs: the server never sends a
 * PageView, so there is no second copy to deduplicate against.
 *
 * This call stays regardless. On a full page load it is the only PageView there
 * is, and on an in-app one it is the safety net for the day Meta stops doing
 * that for us. It costs nothing to keep: it is already being deduplicated.
 */
export const mirrorMetaPageView = (path: string) => {
  if (!active || path.startsWith('/admin')) return;
  if (path === lastPageViewPath) return;
  lastPageViewPath = path;
  emit({ name: 'PageView', params: {} });
};

/**
 * The id both halves of a purchase use, and the reason neither is counted twice.
 *
 * `order-<id>` — the same string backend/index.js stamps on the Conversions API
 * copy (`event_id: `order-${order.id}``). Meta deduplicates on event name + event
 * id, so the two arrive as one sale. There is no error for getting this wrong:
 * the shop's revenue simply doubles in Events Manager and in every campaign
 * report built on it. meta.test.ts reads the backend source and pins the two
 * together, because a constant that has to match a string in another language in
 * another file will not stay matched on its own.
 */
export const metaPurchaseEventId = (orderId: string) => `order-${orderId}`;

/** One line of a finished order, as the success page has it. */
export interface MetaPurchaseItem {
  product_id?: unknown;
  quantity?: unknown;
  price?: unknown;
}

export interface MetaPurchase {
  orderId: string;
  /** The order total, as charged. A string ("29.99") is fine — it is parsed. */
  total: unknown;
  items: MetaPurchaseItem[];
}

/** Orders this page has already reported, so a refresh or a re-render can't repeat one. */
const reportedOrders = new Set<string>();

/**
 * Report a completed order from the BROWSER, as the redundant half of the sale.
 *
 * Called by the success page once the order exists — see the header for why the
 * purchase is sent from both ends. Everything about it is deliberately the same
 * as the server's copy: the same event id, the same currency, the same rounding,
 * the same `contents` shape. Where the two disagree, Meta believes the first one
 * to arrive and the difference becomes invisible.
 *
 * Silent — and correctly so — when the pixel is not live for this shopper: it is
 * off, they declined, or this is the shop's own browser. The server's copy is
 * gated on the same permission via `meta_consent`, so a sale is either reported
 * by both halves or by neither.
 */
/**
 * A purchase that arrived before the pixel had finished booting.
 *
 * ONE SLOT, AND IT IS NOT THE SAME AS THE EVENT BUFFER ABOVE. Ordinary events
 * are held in a capped queue and are allowed to be dropped once the answer is
 * "this pixel may not run". A purchase gets its own slot because there is only
 * ever one in flight and because losing it is not the same class of loss: it is
 * the sale.
 *
 * DEFENSIVE, NOT A FIX FOR AN OBSERVED FAILURE — and the distinction is recorded
 * because it was briefly got wrong. An earlier reading of the e2e output had this
 * sale being dropped on the success page; it was not. fbevents.js sends a
 * Purchase as a POST (the basket and eleven matching fields are too long for a
 * URL) and the test's decoder read only the query string, so it was blind to the
 * one event it most needed to see. The sale was firing the whole time.
 *
 * What remains true is that this function had no buffer while every other event
 * did, so a purchase arriving before the pixel booted would be dropped rather
 * than held. Today that window is not reachable — the success page's poll and the
 * pixel's boot are both gated on the same signed-in session, so neither can run
 * first — but it is one refactor away from becoming reachable, and the cost of
 * being wrong is the sale. The server's copy carries the same event id, so a
 * replay can never double-count; the worst this can do is send a Purchase Meta
 * already has.
 */
let pendingPurchase: MetaPurchase | null = null;

/** Send one purchase. Assumes the pixel is live; mirrorMetaPurchase decides that. */
const sendPurchase = (order: MetaPurchase) => {
  if (!active || !active.track_ecommerce) return;

  const id = String(order.orderId || '');
  if (!id || reportedOrders.has(id)) return;

  // No value, no event. A Purchase Meta cannot price is not a smaller signal than
  // a priced one — it is a conversion with no revenue against it, which drags the
  // shop's reported ROAS down every time it happens and looks like a real sale
  // that earned nothing.
  const value = num(order.total);
  if (value === undefined) return;

  reportedOrders.add(id);

  const items = Array.isArray(order.items) ? order.items : [];
  const contents = items.map((i) => content({
    product_id: i.product_id,
    quantity: i.quantity,
    price: i.price,
  }));

  emit({
    name: 'Purchase',
    eventId: metaPurchaseEventId(id),
    params: {
      currency: CURRENCY,
      value: +value.toFixed(2),
      content_type: 'product',
      content_ids: contents.map((c) => c.id as string),
      contents,
      num_items: items.reduce((sum, i) => sum + (num(i.quantity) ?? 1), 0),
      // Meta's own reporting shows this, so a conversion in Events Manager can be
      // traced back to a row in the orders table without guessing from a clock.
      order_id: id,
    },
  });
};

/**
 * Report a completed sale from the browser.
 *
 * Held rather than dropped when the pixel has not booted yet — see
 * pendingPurchase. `settled` is what keeps that honest: once it is known that the
 * pixel may NOT run (consent declined, switched off, the shop's own machine),
 * nothing is held and nothing is replayed, which is what "blocked" has to mean.
 */
export const mirrorMetaPurchase = (order: MetaPurchase) => {
  if (!active) {
    if (!settled) pendingPurchase = order;
    return;
  }
  sendPurchase(order);
};

/**
 * Subscribe the pixel to the first-party event stream. Registered once, for the
 * life of the page — the `active` check inside is what turns mirroring on and
 * off, so consent and settings changes take effect without re-subscribing.
 */
let unsubscribe: (() => void) | null = null;

export const startMetaPixelMirror = () => {
  if (unsubscribe) return;
  unsubscribe = onTrack((type, props, path) => {
    // page_view is mirrored by the router, which knows the resolved path; the
    // first-party copy would arrive with the same path and double the count.
    if (type === 'page_view') return;

    if (!active) {
      // Not yet known whether the pixel may run — hold it. Once that is settled
      // this branch never buffers again: a blocked pixel drops events on the
      // floor, which is what "blocked" has to mean.
      if (!settled && pending.length < MAX_PENDING) pending.push([type, props, path]);
      return;
    }
    send(type, props, path);
  });
};

// ── Handing the visit to the server ────────────────────────────────────────────

const readCookie = (name: string): string | undefined => {
  if (typeof document === 'undefined') return undefined;
  const prefix = `${name}=`;
  const hit = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : undefined;
};

const readFbclid = (): string | null => {
  try { return new URLSearchParams(window.location.search).get('fbclid'); }
  catch { return null; }
};

/**
 * The click id THIS DOCUMENT WAS OPENED WITH, read at import and held in memory.
 *
 * Read here rather than where it is used because by then it is usually gone. See
 * rememberClickId.
 *
 * `let` only so that resetMetaPixelForTests can re-read it, which is how a test
 * says "a fresh document loaded at this URL". Nothing else ever assigns it.
 */
let arrivalFbclid: string | null = typeof window === 'undefined' ? null : readFbclid();

/**
 * Keep the click id from the ad that brought this visitor, if there was one.
 *
 * fbevents.js writes `_fbc` itself when it sees `?fbclid=` in the URL, and that
 * cookie is what the Conversions API needs to credit the sale back to the ad
 * that earned it. But the cookie is a first-party cookie set from script, which
 * Safari's ITP caps at SEVEN DAYS — and a shopper who clicks an ad, thinks about
 * a EUR 60 candle for a fortnight and then buys is exactly the journey a shop
 * most wants to see attributed. So the click id is also kept where a longer-lived
 * store can hold it, in Meta's own `fb.<subdomainIndex>.<timestamp>.<fbclid>`
 * format, and used only as a fallback for a missing cookie.
 *
 * Only ever called from configureMetaPixel, i.e. only when the pixel is
 * permitted to run at all — so nothing is stored about a visitor who declined.
 *
 * WHICH IS WHY THE CURRENT URL IS NOT ENOUGH. By the time the pixel is permitted
 * the `?fbclid=` the visitor arrived with is very often gone: consent is
 * required, so this first runs when the banner is answered, and a shopper who
 * lands from an ad and opens a product before answering it has already had the
 * query string replaced by the router. fbevents.js is no help either — it reads
 * the URL at init, which is that same late moment. The click that earned the sale
 * would then be attributed to nothing at all, and the failure is invisible: the
 * Purchase still reaches Meta, still matches the person, and is simply credited
 * to no campaign. Hence arrivalFbclid, captured while the document was still the
 * one the ad linked to. Memory is not storage — nothing is written, and nothing
 * survives the tab, until this function is reached and the pixel is permitted.
 */
const rememberClickId = () => {
  const fbclid = readFbclid() ?? arrivalFbclid;
  if (!fbclid) return;
  try {
    // ALREADY KEPT? LEAVE THE TIMESTAMP ALONE. It is the moment of the CLICK, and
    // Meta reads it as such — it is how an `fbc` is aged against the attribution
    // window. configureMetaPixel runs again on every settings change and again on
    // consent, so re-stamping here would walk the click forward through the visit
    // and file a Tuesday's ad click under Friday.
    const held = localStorage.getItem(FBCLID_KEY);
    if (held && held.endsWith(`.${fbclid}`)) return;
    // subdomainIndex 1 = the registrable domain (`theolivegoose.ie`), which is
    // where fbevents.js sets the cookie and therefore what Meta expects to see.
    localStorage.setItem(FBCLID_KEY, `fb.1.${Date.now()}.${fbclid}`);
  } catch { /* storage blocked — the cookie path still works */ }
};

/**
 * What checkout forwards so the server can report the sale to Meta.
 *
 * `meta_consent` is the permission itself — the server sends nothing without it.
 */
export interface MetaCheckoutIds {
  meta_consent?: true;
  fbp?: string;
  fbc?: string;
}

/**
 * Meta's own identifiers for this browser, for the server to send with the sale.
 *
 * The purchase is written by the backend when Stripe confirms payment — never by
 * the browser, which by then has been redirected away and may never come back.
 * For that server-side event to be matched to the person who clicked the ad,
 * Meta needs these two:
 *
 *   _fbp = fb.1.1787691830.1098115397          (this browser)
 *   _fbc = fb.1.1787691830.IwAR2xyz…           (the ad click that brought them)
 *
 * Both absent is the normal case for a visitor who declined cookies, or who
 * arrived without clicking an ad — the sale is then reported with whatever
 * matching the order itself provides (hashed email, phone, address) and no
 * browser identifier, which is correct rather than broken.
 *
 * Returns nothing at all unless the pixel is actually live, so a shop with the
 * pixel switched off never forwards identifiers it has no business collecting.
 */
export const getMetaIds = (): MetaCheckoutIds => {
  // `meta_consent` and not "the cookies are here": an ad blocker can stop
  // `_fbp` from ever being written while the shopper has genuinely accepted, and
  // making the server infer permission from a cookie's existence would silence
  // exactly the sales that CAPI exists to recover. So the browser states the
  // permission it actually checked, and the identifiers are optional extras
  // that improve the match when they are there.
  if (!isMetaPixelActive()) return {};
  const out: MetaCheckoutIds = { meta_consent: true };

  const fbp = readCookie('_fbp');
  if (fbp) out.fbp = fbp;

  // The cookie first — fbevents.js wrote it and it is authoritative. Ours is the
  // fallback for when ITP has expired it.
  const fbc = readCookie('_fbc');
  if (fbc) {
    out.fbc = fbc;
  } else {
    try {
      const stored = localStorage.getItem(FBCLID_KEY);
      if (stored) out.fbc = stored;
    } catch { /* storage blocked */ }
  }

  return out;
};

/** The opaque first-party id both sides use as `external_id`. */
export const getMetaExternalId = (): string => getVisitorId();
