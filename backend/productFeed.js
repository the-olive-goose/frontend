// Product feed for Google Merchant Center and Meta Commerce Manager.
//
// Both read the same dialect — RSS 2.0 with Google's `g:` namespace — so one
// document serves both catalogues and there is only ever one thing to keep
// correct. Served at /feed.xml (Netlify proxies it to /api/feed.xml, the same
// arrangement as the sitemap) and re-crawled by the platforms on their own
// schedule, so a price edited in admin reaches the ad platforms without a
// redeploy.
//
// Everything an admin can change lives in the `productFeed` content section
// (Admin → Ops → Product Feed). Nothing here reads a hardcoded shipping rate or
// brand name: shipping comes from Pickup & Delivery so the feed can never
// contradict the shipping copy on the site, and the brand falls back to the SEO
// site name.
//
// Slug rules must stay in lockstep with src/lib/products.ts and the sitemap —
// a feed link that 404s gets the whole account suspended, not just that item.

/** Mirror of sitemapSlugify / src/lib/products.ts slugify. */
const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** "€24.00" / "24" / 24 → 24. Same permissive parse as src/lib/products.ts. */
const priceValue = (price) => {
  const n = parseFloat(String(price ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Product copy is written for humans, in a light markdown the product page
 * renders: `**bold**`, `*italic*`, emoji, hard line breaks. Feed descriptions are
 * plain text — Google shows them raw, so unstripped asterisks appear in the ad.
 */
const plainText = (value) =>
  String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')     // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // links → their text
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Explicit 0 blocks purchase; undefined/null means "not tracked". */
const isOutOfStock = (product) =>
  product.stock !== undefined && product.stock !== null && Number(product.stock) <= 0;

const DEFAULTS = {
  enabled: false,
  brand: '',
  condition: 'new',
  google_product_category: 'Home & Garden > Decor > Home Fragrances > Candles',
  product_type: '',
  identifier_exists: false,
  include_out_of_stock: true,
  include_gallery_images: true,
  shipping_country: 'IE',
  // Working days to make and dispatch. See the note on ProductFeedContent in
  // src/lib/defaults.ts for why a made-to-order shop must declare this and must
  // NOT switch availability to preorder/backorder to express the same thing.
  min_handling_time: 2,
  max_handling_time: 4,
  custom_label_0: '',
};

/** A whole, non-negative number of days, or null when nothing usable was set. */
const handlingDays = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Why a product was left out. Surfaced in admin so a silently-missing candle is
 * diagnosable without reading the XML — the platforms only report it days later,
 * as a disapproval, and the reason they give is rarely the real one.
 */
const excludeReason = (product, settings) => {
  if (!String(product.name || '').trim()) return 'No name';
  if (priceValue(product.price) <= 0) return 'No price';
  if (!/^https?:\/\//i.test(String(product.image_url || '').trim())) return 'No image, or the image URL is not a full https:// address';
  if (!settings.include_out_of_stock && isOutOfStock(product)) return 'Out of stock';
  return null;
};

/**
 * Split the catalogue into what the feed will carry and what it will not.
 * Pure, and shared with the admin preview so the count shown there is produced
 * by the same code that builds the document rather than a lookalike of it.
 */
export function partitionFeedProducts(products, settings = {}) {
  const merged = { ...DEFAULTS, ...settings };
  const included = [];
  const excluded = [];
  for (const product of products || []) {
    const reason = excludeReason(product, merged);
    if (reason) excluded.push({ product, reason });
    else included.push(product);
  }
  return { included, excluded };
}

/**
 * Per-item shipping. Google asks what one unit costs to deliver on its own, so a
 * free-shipping threshold only applies to items that clear it by themselves —
 * a €25 candle under a €45 threshold ships at the flat rate, which is exactly
 * what that shopper would pay. Understating this gets items disapproved for
 * price mismatch; overstating it loses the click.
 */
const shippingFor = (product, pickup, country) => {
  const threshold = Number(pickup?.free_shipping_threshold);
  const flat = Number(pickup?.flat_shipping_rate);
  if (!Number.isFinite(flat) || flat < 0) return null;
  const free = Number.isFinite(threshold) && threshold > 0 && priceValue(product.price) >= threshold;
  return { country, price: free ? 0 : flat };
};

/**
 * Build the feed document.
 *
 * @param {object}   opts
 * @param {object[]} opts.products   content_products.items
 * @param {object}   opts.settings   content_productFeed
 * @param {object}   opts.pickup     content_pickupSettings — shipping rates
 * @param {string}   opts.siteUrl    absolute origin, no trailing slash
 * @param {string}   opts.siteName   channel title and brand fallback
 * @param {string}   opts.currency   ISO 4217, e.g. "EUR"
 * @returns {{ xml: string, included: number, excluded: object[] }}
 */
export function buildProductFeed({
  products = [],
  settings = {},
  pickup = {},
  siteUrl = 'https://theolivegoose.ie',
  siteName = 'The Olive Goose',
  currency = 'EUR',
} = {}) {
  const cfg = { ...DEFAULTS, ...settings };
  const brand = String(cfg.brand || '').trim() || siteName;
  const origin = String(siteUrl).replace(/\/+$/, '');
  const { included, excluded } = partitionFeedProducts(products, cfg);

  const items = included.map((product) => {
    const slug = slugify(product.slug?.trim() || product.name || '') || product.id;
    const link = `${origin}/products/${encodeURIComponent(slug)}`;
    const price = priceValue(product.price).toFixed(2);
    const description =
      plainText(product.description) ||
      plainText((product.detail_paragraphs || [])[0]) ||
      `${product.name} — a handmade candle by ${brand}.`;

    const lines = [
      `    <g:id>${xmlEscape(product.id)}</g:id>`,
      `    <title>${xmlEscape(String(product.name).slice(0, 150))}</title>`,
      `    <description>${xmlEscape(description.slice(0, 5000))}</description>`,
      `    <link>${xmlEscape(link)}</link>`,
      `    <g:image_link>${xmlEscape(String(product.image_url).trim())}</g:image_link>`,
    ];

    if (cfg.include_gallery_images) {
      // Google takes up to 10 extras and rejects the item if a listed one 404s,
      // so anything that isn't plainly an absolute URL is dropped rather than sent.
      const extras = (product.gallery_urls || [])
        .map((u) => String(u || '').trim())
        .filter((u) => /^https?:\/\//i.test(u) && u !== String(product.image_url).trim())
        .slice(0, 10);
      for (const url of extras) lines.push(`    <g:additional_image_link>${xmlEscape(url)}</g:additional_image_link>`);
    }

    lines.push(
      `    <g:availability>${isOutOfStock(product) ? 'out_of_stock' : 'in_stock'}</g:availability>`,
      `    <g:price>${price} ${xmlEscape(currency)}</g:price>`,
      `    <g:condition>${xmlEscape(cfg.condition)}</g:condition>`,
      `    <g:brand>${xmlEscape(brand)}</g:brand>`,
    );

    // Handmade goods carry no GTIN and no manufacturer part number. Saying so
    // explicitly is required — left unsaid, Google assumes the identifiers are
    // simply missing and disapproves every item in the feed.
    if (!cfg.identifier_exists) lines.push(`    <g:identifier_exists>no</g:identifier_exists>`);

    if (String(cfg.google_product_category || '').trim())
      lines.push(`    <g:google_product_category>${xmlEscape(cfg.google_product_category.trim())}</g:google_product_category>`);
    if (String(cfg.product_type || '').trim())
      lines.push(`    <g:product_type>${xmlEscape(cfg.product_type.trim())}</g:product_type>`);
    if (String(cfg.custom_label_0 || '').trim())
      lines.push(`    <g:custom_label_0>${xmlEscape(cfg.custom_label_0.trim())}</g:custom_label_0>`);

    // Handling time is an ITEM-level attribute in Google's spec, not part of the
    // shipping block — it describes the shop, not the courier. Sent as a pair:
    // a max on its own is read as "exactly this many days", which would promise
    // the slowest case every time.
    const minHandling = handlingDays(cfg.min_handling_time);
    const maxHandling = handlingDays(cfg.max_handling_time);
    if (minHandling !== null && maxHandling !== null) {
      // A transposed pair would advertise a range running backwards, which
      // Google rejects the item for. Order them rather than refusing to publish.
      const [lo, hi] = minHandling <= maxHandling ? [minHandling, maxHandling] : [maxHandling, minHandling];
      lines.push(
        `    <g:min_handling_time>${lo}</g:min_handling_time>`,
        `    <g:max_handling_time>${hi}</g:max_handling_time>`,
      );
    }

    const shipping = shippingFor(product, pickup, cfg.shipping_country);
    if (shipping) {
      lines.push(
        `    <g:shipping>`,
        `      <g:country>${xmlEscape(shipping.country)}</g:country>`,
        `      <g:price>${shipping.price.toFixed(2)} ${xmlEscape(currency)}</g:price>`,
        `    </g:shipping>`,
      );
    }

    return `  <item>\n${lines.join('\n')}\n  </item>`;
  });

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n` +
    `<channel>\n` +
    `  <title>${xmlEscape(siteName)}</title>\n` +
    `  <link>${xmlEscape(origin)}</link>\n` +
    `  <description>${xmlEscape(`Product feed for ${siteName}`)}</description>\n` +
    (items.length ? items.join('\n') + '\n' : '') +
    `</channel>\n` +
    `</rss>\n`;

  return { xml, included: included.length, excluded };
}

export { DEFAULTS as PRODUCT_FEED_DEFAULTS, slugify, priceValue, plainText, isOutOfStock, excludeReason };
