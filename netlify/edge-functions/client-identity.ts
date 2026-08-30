// Who a visitor is, for the only two things that need to know: what the shop's
// rate limits count, and which city an analytics row belongs to.
//
// ── Why anything has to say this at all ──────────────────────────────────────
//
// Requests reach the backend through TWO proxies (Netlify, then Railway), so the
// address it sees for itself is whichever proxy spoke to it last — the SAME
// value for every shopper on the site. Every limit keyed on that was therefore
// one shared bucket: twenty sign-in attempts for the whole shop, four hundred
// API calls for the whole shop, ten newsletter signups for the whole shop.
//
// On a quiet day nobody notices. On the best day of the year — an ad lands, a
// post does well, everyone arrives at once — the shop starts refusing real
// customers, and tells them they have been trying too often when what actually
// happened is that a stranger used the allowance first. It fails hardest exactly
// when it costs the most, and it looks like the customer's fault.
//
// Netlify already knows the real address; it resolved it in order to route the
// request. Attaching it here is what lets the backend count per visitor.
//
// ── Why the address is signed ────────────────────────────────────────────────
//
// `x-og-client-ip` on its own is worth nothing for anything that matters. The
// backend's Railway address is public — it is sitting in public/_redirects — so
// anyone can skip Netlify entirely and call it with whatever headers they like.
// A backend that believed an unsigned header would have turned a shared-but-real
// brute-force limit into no limit whatsoever: rotate the header, get a fresh
// twenty sign-in attempts per invented address, forever.
//
// So the edge also sends a secret that only it and the backend know. The backend
// believes the address ONLY when that secret matches, and otherwise counts by
// proxy address — the shared bucket, exactly as it did before any of this. See
// edgeVouchedIp and limiterKey in backend/index.js.
//
// ── Every way this can fail, and what happens ────────────────────────────────
//
//   secret unset on either side   → shared bucket (previous behaviour)
//   request never met Netlify     → shared bucket (previous behaviour)
//   a client supplies its own     → stripped below, before anything is read
//   anything here throws          → request continues completely untouched
//
// There is no path on which a visitor gets to choose their own bucket, and none
// on which the shop is worse off than it was. That matters more than usual here,
// because unlike the geo headers this now runs in front of the whole API —
// checkout and sign-in included — which is why every step is inside the try.
import type { Config, Context } from '@netlify/edge-functions';

// Set in the Netlify dashboard and on Railway; the two must be the same string.
// Absent, this sends no key, the backend trusts no address, and every limit
// behaves exactly as it did before — degraded, but never broken or unsafe.
const EDGE_SHARED_SECRET = Netlify.env.get('EDGE_SHARED_SECRET') || '';

// Geo stays deliberately narrow. It is the analytics routes' business and
// nobody else's: the shop's consent-banner exemption rests on first-party
// measurement that retains no personal data, and quietly attaching a location to
// checkout and sign-in traffic would be a change to what the shop collects, not
// a change to how it counts. The identity headers below carry no such weight —
// they are a bucket name, compared in memory and discarded with the request.
const GEO_PATHS = new Set(['/api/analytics/events', '/api/admin/analytics/internal']);

export default async (request: Request, context: Context) => {
  try {
    const headers = new Headers(request.headers);

    // Strip FIRST, and strip unconditionally. These are our own header names on
    // an inbound request, so anything already carrying them is a client claiming
    // to be someone, or somewhere, it is not. This is the line that makes the
    // signature meaningful: the key below can only ever be one this edge set.
    headers.delete('x-og-client-ip');
    headers.delete('x-og-edge-key');
    headers.delete('x-og-geo-city');
    headers.delete('x-og-geo-country');

    // The visitor's actual address, as the edge sees it before any proxy hop.
    // Sent whether or not a secret is configured, because two things that are
    // NOT security decisions already depend on it: the owner's own-network
    // exclusion, and the "which network am I on?" answer the admin screen shows
    // (ipIsInternal in backend/index.js). Withholding it when the secret is
    // missing would quietly break both.
    if (context.ip) headers.set('x-og-client-ip', context.ip);

    // The signature, and the only reason the address above may be used to decide
    // anything. Set separately and only when configured, so the line between
    // "the edge observed this" and "the edge will VOUCH for this" stays visible
    // — the backend refuses to count by an address that arrives without it.
    if (context.ip && EDGE_SHARED_SECRET) headers.set('x-og-edge-key', EDGE_SHARED_SECRET);

    if (GEO_PATHS.has(new URL(request.url).pathname)) {
      const city = context.geo?.city;
      const country = context.geo?.country?.code;
      // encodeURIComponent because a header value must be Latin-1 and city names
      // are not: "Málaga" or "München" would throw and cost us the whole request.
      if (city) headers.set('x-og-geo-city', encodeURIComponent(city));
      if (country) headers.set('x-og-geo-country', country);
    }

    return context.next(new Request(request, { headers }));
  } catch {
    // A per-visitor budget and a city name are both nice to have. Serving the
    // shop is not optional, so anything unexpected here costs us the former and
    // never the latter.
    return context.next();
  }
};

export const config: Config = {
  // The whole API, because sign-in and browsing are what were sharing a bucket.
  // The route is declared inline on purpose: Netlify picks this directory up
  // automatically, so the shop gains an edge function without gaining a
  // netlify.toml — and a netlify.toml would override the build settings
  // currently held in the Netlify dashboard, which is a far larger thing to
  // risk. Stripe's webhook is under this path too and is deliberately left
  // unaffected: it is exempt from rate limiting in the backend, and this only
  // ever adds headers.
  path: '/api/*',
};
