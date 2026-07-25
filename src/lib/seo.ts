// ── Site-wide SEO constants & head-management helpers ──────────────────────────
// This is a client-rendered SPA, so per-route metadata is applied at runtime.
// Googlebot renders JS and picks these up; social crawlers (FB/Twitter) only see
// the static tags in index.html, which carry matching site-wide defaults.

export const SITE_URL = "https://theolivegoose.ie";
export const SITE_NAME = "The Olive Goose";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.jpg`;

export interface RouteMeta {
  /** SEO title, ≤60 chars, primary keyword + brand */
  title: string;
  /** Meta description, ≤155 chars */
  description: string;
  /** Set true for private/thin/utility pages that must not be indexed */
  noindex?: boolean;
  /** Open Graph type (default "website") */
  ogType?: string;
}

/**
 * Per-route metadata. Keys are exact pathnames; dynamic segments use a trailing
 * "*" (longest-prefix match). Every public route MUST have an entry — routes
 * without one fall back to `DEFAULT_META` and are flagged noindex so thin or
 * forgotten pages never leak into the index.
 */
export const ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title: "The Olive Goose — the goose insisted, we made candles",
    description:
      "Luxury handmade candles from Dublin, Ireland. Coffee-scented, café-inspired soy candles, hand-poured in small batches. Free Irish shipping over €65.",
  },
  "/shop": {
    title: "Shop Handmade Soy Candles Ireland | The Olive Goose",
    description:
      "Shop luxury handmade candles online in Ireland — coffee, bakery and café-inspired scented soy candles, hand-poured in Dublin and shipped nationwide.",
  },
  // Product pages set their own title/description/OG image at runtime (see
  // ProductDetailPage); this entry is the indexable baseline SeoManager applies
  // on navigation, before the product data has loaded.
  "/products/*": {
    title: "Handmade Candles | The Olive Goose",
    description:
      "Hand-poured, café-culture-inspired soy candles made in Dublin, Ireland. Explore the scent, the story and the bundle deals at The Olive Goose.",
    ogType: "product",
  },
  "/deals": {
    title: "Candle Gift Sets & Bundle Deals | The Olive Goose",
    description:
      "Save on luxury candle gift sets from The Olive Goose. Handmade café-inspired candle bundles, poured in Dublin and shipped across Ireland.",
  },
  "/about": {
    title: "Our Story | Irish Candle Makers in Dublin | The Olive Goose",
    description:
      "Meet the maker behind The Olive Goose — an independent Irish candle company hand-pouring café-inspired soy candles in small batches in Dublin.",
  },
  "/candle-care": {
    title: "Candle Care Guide: Burn Times, Wick Trimming | The Olive Goose",
    description:
      "How to care for a handmade soy candle: the first burn, wick trimming, burn times and candle safety — expert tips from Dublin candle makers.",
  },
  "/gift-cards": {
    title: "Candle Gift Cards Ireland | The Olive Goose",
    description:
      "Luxury candle gift cards from The Olive Goose, Dublin. The easy gift for candle and coffee lovers in Ireland — delivered by email, never expires.",
  },
  "/customer-service": {
    title: "Customer Service & Contact | The Olive Goose",
    description:
      "Need help with an order or a candle? Contact The Olive Goose customer care team — we're happy to help.",
  },
  "/faq": {
    title: "FAQs | Shipping, Ingredients & Candle Safety | The Olive Goose",
    description:
      "Answers about The Olive Goose handmade candles: Irish shipping times, soy wax ingredients, pet safety, order changes and candle care.",
  },
  "/track-order": {
    title: "Track Your Order | The Olive Goose",
    description:
      "Track your Olive Goose candle order. Enter your order details to see delivery status for shipments across Ireland.",
  },
  "/shipping-policy": {
    title: "Shipping Policy | The Olive Goose",
    description:
      "Shipping rates, delivery times and coverage for The Olive Goose handmade candles, shipped from Dublin across Ireland and the EU.",
  },
  "/returns": {
    title: "Returns & Refunds | The Olive Goose",
    description:
      "Our returns and refund policy for handmade candles from The Olive Goose. How to start a return and what to expect.",
  },
  "/privacy-policy": {
    title: "Privacy Policy | The Olive Goose",
    description:
      "How The Olive Goose collects, uses and protects your personal data when you shop with us or join our mailing list.",
  },
  "/terms-of-service": {
    title: "Terms of Service | The Olive Goose",
    description:
      "The terms and conditions that apply when you browse or buy from The Olive Goose online candle store.",
  },
  // ── Private / utility routes: real titles for the tab bar, but noindex ──
  "/basket": { title: "Your Basket | The Olive Goose", description: "Review the candles in your basket.", noindex: true },
  "/checkout": { title: "Checkout | The Olive Goose", description: "Securely complete your order.", noindex: true },
  "/checkout/success": { title: "Order Confirmed | The Olive Goose", description: "Thank you for your order.", noindex: true },
  "/account": { title: "My Account | The Olive Goose", description: "Manage your account.", noindex: true },
  "/account/security": { title: "Account Security | The Olive Goose", description: "Manage your sign-in and security settings.", noindex: true },
  "/account/addresses": { title: "My Addresses | The Olive Goose", description: "Manage your delivery addresses.", noindex: true },
  "/orders": { title: "My Orders | The Olive Goose", description: "View your order history.", noindex: true },
  "/orders/*": { title: "Order Details | The Olive Goose", description: "Track this order.", noindex: true },
  "/admin": { title: "Admin | The Olive Goose", description: "Store administration.", noindex: true },
  "/admin/*": { title: "Admin | The Olive Goose", description: "Store administration.", noindex: true },
  "/auth/*": { title: "Signing you in… | The Olive Goose", description: "Completing sign-in.", noindex: true },
};

export const DEFAULT_META: RouteMeta = {
  title: "The Olive Goose | Handmade Café-Inspired Candles",
  description:
    "Hand-poured, café-culture-inspired candles made in Dublin, Ireland.",
  noindex: true, // unknown routes are 404s / unmapped pages — keep them out of the index
};

/** Longest-prefix lookup: exact key first, then wildcard ancestors. */
export function metaForPath(pathname: string): RouteMeta {
  const exact = ROUTE_META[pathname];
  if (exact) return exact;
  let path = pathname.replace(/\/+$/, "");
  while (path.length > 0) {
    const wildcard = ROUTE_META[`${path}/*`];
    if (wildcard) return wildcard;
    path = path.slice(0, path.lastIndexOf("/"));
  }
  return DEFAULT_META;
}

// ── DOM helpers ─────────────────────────────────────────────────────────────────

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export interface ApplyMetaOptions extends RouteMeta {
  /** Pathname used for the canonical URL (query strings are always stripped). */
  path: string;
  ogImage?: string;
}

/** Write title/description/canonical/robots/OG/Twitter tags into <head>. */
export function applyMeta(opts: ApplyMetaOptions) {
  document.title = opts.title;
  const canonical = `${SITE_URL}${opts.path === "/" ? "/" : opts.path.replace(/\/+$/, "")}`;
  const image = opts.ogImage ?? DEFAULT_OG_IMAGE;

  upsertMeta("name", "description", opts.description);
  upsertMeta("name", "robots", opts.noindex ? "noindex, nofollow" : "index, follow");
  upsertLink("canonical", canonical);

  upsertMeta("property", "og:title", opts.title);
  upsertMeta("property", "og:description", opts.description);
  upsertMeta("property", "og:type", opts.ogType ?? "website");
  upsertMeta("property", "og:url", canonical);
  upsertMeta("property", "og:site_name", SITE_NAME);
  upsertMeta("property", "og:locale", "en_IE");
  upsertMeta("property", "og:image", image);

  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", opts.title);
  upsertMeta("name", "twitter:description", opts.description);
  upsertMeta("name", "twitter:image", image);
}

/**
 * Inject (or replace) a JSON-LD <script> identified by `id`.
 * Pass `null` to remove it. Returns a cleanup function.
 */
export function setJsonLd(id: string, data: object | object[] | null) {
  const domId = `jsonld-${id}`;
  let el = document.getElementById(domId);
  if (data === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("script");
    el.setAttribute("type", "application/ld+json");
    el.id = domId;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

/** Parse a display price like "€24.00" / "24" into a schema.org-safe number string. */
export function parsePriceValue(price: string): string | null {
  const n = parseFloat(String(price).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/**
 * Build a BreadcrumbList JSON-LD object from [name, path] pairs, e.g.
 * breadcrumbJsonLd([["Home", "/"], ["Shop", "/shop"], ["Espresso Candle", "/products/espresso"]]).
 * Pass the result to useJsonLd("breadcrumb", …) so Google can show the trail
 * in place of the raw URL in search results.
 */
export function breadcrumbJsonLd(crumbs: Array<[name: string, path: string]>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE_URL}${path === "/" ? "/" : path.replace(/\/+$/, "")}`,
    })),
  };
}
