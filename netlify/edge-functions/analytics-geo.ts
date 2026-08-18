// Attaches the visitor's city and country to analytics ingestion, and nothing else.
//
// WHY AT THE EDGE. Netlify already knows roughly where a request came from — it
// resolved that to route the request at all. Reading it here means the shop
// learns "Dublin, IE" without an IP address ever being sent anywhere or written
// down: not to a lookup service, not into the database, not into a log. That is
// the whole point. The analytics on this site carry a consent-banner exemption
// because they are first-party measurement with no personal data retained and
// nothing shared with anyone, and an IP-based geo lookup done any other way
// would have spent that exemption for a city name.
//
// SCOPE. Deliberately bound to the single analytics route by the `config.path`
// below, rather than to /api/*. Everything else the shop does over that path —
// checkout, sign-in, order lookups — never enters this code at all, so a mistake
// here cannot take the till down with it. For the same reason every step below
// is wrapped: if anything goes wrong the request continues unmodified, and the
// worst case is analytics without a location.
//
// The route is declared inline on purpose. Netlify picks this directory up
// automatically, so the shop gains an edge function without gaining a
// netlify.toml — and a netlify.toml would override the build settings currently
// held in the Netlify dashboard, which is a far larger thing to risk than a
// city name.
//
// The headers are advisory. The backend treats them as a hint from its own
// proxy, sanitises what it reads (see geoFromHeaders in backend/index.js), and
// works perfectly well when they are absent — which is what happens on every
// request that does not come through Netlify, including local development.
import type { Config, Context } from '@netlify/edge-functions';

export default async (request: Request, context: Context) => {
  try {
    const headers = new Headers(request.headers);

    // Strip first. These are OUR header names on an inbound request, so anything
    // already carrying them is a client claiming to be somewhere it isn't.
    headers.delete('x-og-geo-city');
    headers.delete('x-og-geo-country');
    headers.delete('x-og-client-ip');

    const city = context.geo?.city;
    const country = context.geo?.country?.code;

    // The visitor's actual address, as the edge sees it before any proxy hop.
    //
    // The backend cannot work this out for itself: requests reach it through TWO
    // proxies (Netlify, then Railway), so its own view of "the client" is really
    // the address of whichever proxy spoke to it last. Excluding "your network"
    // on that basis would have matched a shared edge address — and therefore
    // every shopper on the site at once, silently reporting an empty shop.
    //
    // Used only to compare against the owner's own excluded networks, in memory,
    // and then discarded. Nothing here is written down: see ipIsInternal and
    // geoFromHeaders in backend/index.js.
    if (context.ip) headers.set('x-og-client-ip', context.ip);

    // encodeURIComponent because a header value must be Latin-1 and city names
    // are not: "Málaga" or "München" would throw and cost us the whole request.
    if (city) headers.set('x-og-geo-city', encodeURIComponent(city));
    if (country) headers.set('x-og-geo-country', country);

    return context.next(new Request(request, { headers }));
  } catch {
    // A location is a nice-to-have; recording the visit is not.
    return context.next();
  }
};

export const config: Config = {
  // Ingestion, plus the one admin route that has to show the owner which network
  // they are on in order to offer to exclude it. Nothing else — checkout,
  // sign-in and order lookups never pass through this code.
  path: ['/api/analytics/events', '/api/admin/analytics/internal'],
};
