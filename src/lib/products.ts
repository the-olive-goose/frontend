// ── Product-page helpers ───────────────────────────────────────────────────────
// Slugs, gallery/copy fallbacks, bundle pricing and "you may also like" picks —
// everything the /products/:slug page needs that isn't rendering.

import type { Bundle, Product } from "@/lib/defaults";
import type { ShopCategory } from "@/lib/api";

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * URL segment for a product: the admin-set slug, else a slugified name, else the
 * raw id (products named only with emoji/symbols still get a working URL).
 */
export const productSlug = (product: Product): string =>
  slugify(product.slug?.trim() || product.name || "") || product.id;

export const productPath = (product: Product): string =>
  `/products/${productSlug(product)}`;

/** Resolve a :slug route param against the catalogue — slug first, then id. */
export const findProduct = (products: Product[], param: string | undefined): Product | undefined => {
  if (!param) return undefined;
  const key = decodeURIComponent(param).toLowerCase();
  return (
    products.find(p => productSlug(p).toLowerCase() === key) ??
    products.find(p => p.id.toLowerCase() === key)
  );
};

/** Gallery images: main image first, then extras, de-duped and blank-free. */
export const productImages = (product: Product): string[] => {
  const all = [product.image_url, ...(product.gallery_urls ?? [])]
    .map(url => (url ?? "").trim())
    .filter(Boolean);
  return [...new Set(all)];
};

/** Long-form copy, falling back to the short card description. */
export const productParagraphs = (product: Product): string[] => {
  const paragraphs = (product.detail_paragraphs ?? []).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 0) return paragraphs;
  return product.description?.trim() ? [product.description.trim()] : [];
};

export const priceValue = (price: string | number | null | undefined): number => {
  const n = parseFloat(String(price ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ── Catalogue order ────────────────────────────────────────────────────────────

/**
 * A product's sort key. An unset Display Order (blank, null, or a value that
 * isn't a number) sorts to the end rather than to position 0 — otherwise the
 * moment the admin numbered one product, every product they hadn't got to yet
 * would jump ahead of it.
 */
const displayRank = (product: Product): number => {
  const raw = product.display_order;
  if (raw === null || raw === undefined) return Infinity;
  // Blank text counts as unset, not as zero. The admin box writes null when it is
  // cleared, but content saved by hand or carried in from elsewhere can hold "" —
  // and Number("") is 0, which would silently pin that candle to the front.
  if (typeof raw === "string" && (raw as string).trim() === "") return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Infinity;
};

/**
 * The catalogue in the order the admin arranged it: Display Order ascending,
 * unnumbered products last. Ties (and unnumbered products) keep the order they
 * sit in inside the admin list, since Array.prototype.sort is stable.
 */
export const sortByDisplayOrder = <T extends Product>(products: T[]): T[] =>
  [...products].sort((a, b) => displayRank(a) - displayRank(b));

/**
 * The products of one shop category, in the order the Shop grid uses.
 *
 * Filtered out of the sorted catalogue rather than mapped from `product_ids`,
 * because `product_ids` holds the order the admin happened to tick the boxes in
 * — which is nobody's chosen order. Every surface that renders a category goes
 * through here (the shop grid, the home strip, the flipbook), so the same
 * category cannot read one way on the home page and another in the shop.
 */
export const productsInCategory = <T extends Product>(
  productIds: string[] | undefined,
  products: T[],
): T[] => {
  if (!productIds?.length) return [];
  const inCategory = new Set(productIds);
  return sortByDisplayOrder(products).filter(p => inCategory.has(p.id));
};

/**
 * The number to pre-fill on a newly added product: one past the highest in use.
 *
 * Null when the catalogue isn't numbered at all — an admin who has never touched
 * Display Order must keep the behaviour they have today, where a new candle joins
 * the END of the shop grid. Numbering it 1 would put it in front of everything.
 */
export const nextDisplayOrder = (products: Product[]): number | null => {
  const highest = products.reduce((max, p) => {
    const rank = displayRank(p);
    return Number.isFinite(rank) ? Math.max(max, rank) : max;
  }, -Infinity);
  return Number.isFinite(highest) ? highest + 1 : null;
};

/** Explicit 0 stock blocks purchase; undefined/null means "not tracked". */
export const isOutOfStock = (product: Product): boolean =>
  product.stock !== undefined && product.stock !== null && Number(product.stock) <= 0;

// ── Bundles (Today's Deals) ────────────────────────────────────────────────────

export interface BundlePricing {
  bundle: Bundle;
  products: Product[];
  originalTotal: number;
  discount: number;
  bundlePrice: number;
}

/** Price a bundle the same way the Deals page does, resolving its product ids. */
export const bundlePricing = (bundle: Bundle, allProducts: Product[]): BundlePricing => {
  const products = (bundle.product_ids ?? [])
    .map(id => allProducts.find(p => p.id === id))
    .filter((p): p is Product => !!p);

  const originalTotal = products.reduce((sum, p) => sum + priceValue(p.price), 0);
  const discount = bundle.discount_type === "percentage"
    ? originalTotal * (bundle.discount_value / 100)
    : bundle.discount_value;

  return {
    bundle,
    products,
    originalTotal,
    discount: Math.min(discount, originalTotal),
    bundlePrice: Math.max(0, originalTotal - discount),
  };
};

/**
 * Active Today's Deals bundles that feature this product, priced and ordered the
 * way the admin arranged them. Bundles whose other products have since been
 * deleted are dropped — a one-product "bundle" isn't a deal.
 */
export const bundlesForProduct = (
  bundles: Bundle[],
  allProducts: Product[],
  productId: string,
): BundlePricing[] =>
  (bundles ?? [])
    .filter(b => b.is_active && (b.product_ids ?? []).includes(productId))
    .sort((a, b) => a.display_order - b.display_order)
    .map(b => bundlePricing(b, allProducts))
    .filter(p => p.products.length > 1);

// ── Recommendations ────────────────────────────────────────────────────────────

interface RecommendationOptions {
  categories?: ShopCategory[];
  bundles?: Bundle[];
  limit?: number;
}

/**
 * "You may also like" — drawn from every other product in the catalogue.
 *
 * An admin can pin picks per product (`recommended_ids`); anything left over is
 * filled automatically by relevance: products sharing a shop category rank
 * highest, then products the admin has bundled with this one, then a shared
 * badge/tag, with the closest price winning ties. Out-of-stock products sink to
 * the bottom rather than disappearing, so the row is never short.
 */
export const recommendationsFor = (
  product: Product,
  allProducts: Product[],
  { categories = [], bundles = [], limit = 4 }: RecommendationOptions = {},
): Product[] => {
  const others = allProducts.filter(p => p.id !== product.id);
  if (others.length === 0 || limit <= 0) return [];

  const pinned = (product.recommended_ids ?? [])
    .map(id => others.find(p => p.id === id))
    .filter((p): p is Product => !!p);

  const categoryPeers = new Set(
    categories
      .filter(c => (c.product_ids ?? []).includes(product.id))
      .flatMap(c => c.product_ids ?? []),
  );
  const bundlePeers = new Set(
    bundles
      .filter(b => (b.product_ids ?? []).includes(product.id))
      .flatMap(b => b.product_ids ?? []),
  );

  const basePrice = priceValue(product.price);
  const tag = product.tag?.trim().toLowerCase();

  const scored = others
    .filter(p => !pinned.some(pin => pin.id === p.id))
    .map((p, index) => {
      let score = 0;
      if (categoryPeers.has(p.id)) score += 4;
      if (bundlePeers.has(p.id)) score += 3;
      if (tag && p.tag?.trim().toLowerCase() === tag) score += 1;
      if (isOutOfStock(p)) score -= 5;
      return { product: p, score, priceGap: Math.abs(priceValue(p.price) - basePrice), index };
    })
    .sort((a, b) =>
      b.score - a.score ||
      a.priceGap - b.priceGap ||
      a.index - b.index,
    )
    .map(s => s.product);

  return [...pinned, ...scored].slice(0, limit);
};
