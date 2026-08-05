import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { getContent, getShopCategories, type ShopCategory } from "@/lib/api";
import {
  DEFAULT_CONTENT,
  DEFAULT_PRODUCT_CARD_THEME,
  resolveCardAccent,
  type Product,
  type ProductCardTheme,
} from "@/lib/defaults";
import { productPath } from "@/lib/products";
import { track } from "@/lib/analytics";
import { useJsonLd } from "@/hooks/useJsonLd";
import { SITE_URL, SITE_NAME, parsePriceValue, breadcrumbJsonLd } from "@/lib/seo";
import ProductCard from "@/components/ui/ProductCard";
import { SkelBlock, SkelProductCard } from "@/components/ui/ContentSkeleton";
import { useContent } from "@/hooks/useContent";
import PageHero from "@/components/PageHero";
import FooterSection from "@/components/sections/FooterSection";

// ── Shop Page ──────────────────────────────────────────────────────────────────

/** The mood row is a single unwrapped line, so it can only carry so many. */
const MAX_CATEGORY_TAGS = 3;

const ShopPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories]   = useState<ShopCategory[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [cardTheme, setCardTheme]     = useState<ProductCardTheme>(DEFAULT_PRODUCT_CARD_THEME);
  const [loading, setLoading]         = useState(true);
  // The page's own heading copy. The navbar, announcement bar and footer used to
  // be fetched here too, into state this page never rendered — Layout and
  // FooterSection own those.
  const shopPage = useContent("shopPage", DEFAULT_CONTENT.shopPage);

  const activeSlug   = searchParams.get("category") ?? "all";
  const searchTerm   = searchParams.get("search") ?? "";

  useEffect(() => {
    Promise.all([
      getContent("products", DEFAULT_CONTENT.products),
      getShopCategories(),
      getContent<ProductCardTheme>("productCardTheme", DEFAULT_PRODUCT_CARD_THEME),
    ]).then(([products, cats, theme]) => {
      setAllProducts(products.items ?? []);
      setCategories(cats);
      if (theme) setCardTheme(theme);
    }).finally(() => setLoading(false));
  }, []);

  // Resolve products for the active category / search
  const visibleProducts: Product[] = (() => {
    let base = allProducts;
    if (activeSlug !== "all") {
      const cat = categories.find(c => c.slug === activeSlug);
      if (!cat || !cat.product_ids?.length) return [];
      base = cat.product_ids.map(id => allProducts.find(p => p.id === id)).filter((p): p is Product => !!p);
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      base = base.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.tag?.toLowerCase().includes(q)
      );
    }
    return base;
  })();

  const activeCat = categories.find(c => c.slug === activeSlug);
  const isAllView = !searchTerm && activeSlug === "all";

  // view_item_list — the funnel stage that used to be guessed from the URL.
  // A page_view on /shop only proves the route was entered; this fires when a
  // grid of products was actually rendered, so an empty category or a search
  // with no hits is correctly NOT counted as browsing the catalogue.
  //
  // Keyed on the list's identity rather than on visibleProducts, which is
  // rebuilt on every render and would re-fire the event continuously. `loading`
  // is in the key so the real list is recorded, not the empty pre-fetch state.
  const listKey = `${activeSlug}|${searchTerm}`;
  useEffect(() => {
    if (loading || visibleProducts.length === 0) return;
    track("view_item_list", {
      list_id: searchTerm ? "search" : activeSlug,
      list_name: searchTerm ? `Search: ${searchTerm}` : (activeCat?.name || "All candles"),
      item_count: visibleProducts.length,
    });
  }, [listKey, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Categories are often saved with all their moods in one "• a • b • c" string.
  // Split those back out so each mood is its own pill instead of one long pill
  // that wraps into three ragged lines on a phone. Capped at three: the row is
  // one unwrapped line, and a fourth pill would have nowhere to go.
  const activeTags = (activeCat?.tags ?? [])
    .flatMap(tag => tag.split("•"))
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, MAX_CATEGORY_TAGS);

  // Breadcrumb trail for the canonical /shop view.
  useJsonLd("breadcrumb", breadcrumbJsonLd([["Home", "/"], ["Shop", "/shop"]]));

  // CollectionPage + Product/ItemList structured data for the full catalogue
  // (canonical /shop view). Only real, loaded product data — no fabricated
  // ratings or reviews.
  useJsonLd(
    "shop-products",
    allProducts.length === 0
      ? null
      : {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "@id": `${SITE_URL}/shop`,
          url: `${SITE_URL}/shop`,
          name: "Shop Handmade Soy Candles Ireland",
          description:
            "The full collection of luxury handmade candles by The Olive Goose — coffee, bakery and café-inspired scented soy candles, hand-poured in Dublin, Ireland.",
          isPartOf: { "@id": `${SITE_URL}/#website` },
          mainEntity: {
          "@type": "ItemList",
          name: "Handmade candles by The Olive Goose",
          itemListElement: allProducts.map((p, i) => {
            const price = parsePriceValue(p.price);
            return {
              "@type": "ListItem",
              position: i + 1,
              item: {
                "@type": "Product",
                name: p.name,
                description: p.description,
                sku: p.id,
                ...(p.image_url && {
                  image: p.image_url.startsWith("http") ? p.image_url : `${SITE_URL}${p.image_url}`,
                }),
                brand: { "@type": "Brand", name: SITE_NAME },
                ...(price && {
                  offers: {
                    "@type": "Offer",
                    price,
                    priceCurrency: "EUR",
                    availability:
                      p.stock !== undefined && p.stock !== null && Number(p.stock) <= 0
                        ? "https://schema.org/OutOfStock"
                        : "https://schema.org/InStock",
                    url: `${SITE_URL}${productPath(p)}`,
                  },
                }),
              },
            };
          }),
          },
        },
  );

  const setCategory = (slug: string) => {
    if (slug === "all") setSearchParams({});
    else setSearchParams({ category: slug });
    window.scrollTo({ top: 300, behavior: "smooth" });
  };

  return (
    <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>

      {/* ── Hero ── (shared band: owns the nav offset + page rhythm) */}
      {/* Only the unfiltered view uses the configured headline — a search or a
          category titles itself, so there is no gold half to apply. */}
      <PageHero
        eyebrow="The Collection"
        title={searchTerm ? `"${searchTerm}"` : isAllView ? shopPage.data.page_title : (activeCat?.name ?? "Shop")}
        titleGold={isAllView ? shopPage.data.page_title_gold : undefined}
        subtitle={activeSlug === "all"
          ? "Handpoured small-batch candles crafted for every mood, moment and era."
          : (activeCat?.mood_description ?? "")}
        ready={searchTerm ? true : isAllView ? shopPage.ready : !loading}
      />

      {/* ── Category filter pills ──
          The strip keeps its row while the categories are still in flight: it is
          ~71px tall, and letting it appear only once they land shoved the whole
          product grid down that far mid-load — the single biggest layout shift
          on this page. Skeleton pills hold the row instead. */}
      {(loading || categories.length > 0) && (
        <div style={{ background: "var(--color-sage-mid)", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
          <div className="max-w-7xl mx-auto px-6 sm:px-12 py-4 flex items-center gap-3 overflow-x-auto no-scrollbar">
            {/* Pill height = text-sm line box (20px) + py-2 (16px) + 1.5px border
                either side, so the real pills drop straight into these slots. */}
            {loading && [88, 116, 104, 96].map((w, i) => (
              <SkelBlock key={i} height="39px" width={`${w}px`} radius="9999px"
                style={{ flex: "0 0 auto", color: "var(--color-forest-dark)" }} />
            ))}

            {/* An aggregate view is only useful when there is more than one category. */}
            {categories.length > 1 && (
              <button
                onClick={() => setCategory("all")}
                className="shrink-0 font-display text-sm font-semibold px-5 py-2 rounded-full transition-all"
                style={{
                  background: activeSlug === "all" ? "var(--color-forest-dark)" : "rgba(255,255,255,0.22)",
                  color: activeSlug === "all" ? "var(--color-cream-text)" : "var(--color-forest-dark)",
                  border: "1.5px solid transparent",
                }}
              >
                All
              </button>
            )}

            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.slug)}
                className="shrink-0 font-display text-sm font-semibold px-5 py-2 rounded-full transition-all"
                style={{
                  background: activeSlug === cat.slug ? cat.accent_color : "rgba(255,255,255,0.22)",
                  color: activeSlug === cat.slug ? "#fff" : "var(--color-forest-dark)",
                  border: `1.5px solid ${activeSlug === cat.slug ? cat.accent_color : "transparent"}`,
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Product grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 pt-[var(--page-body-pt)] pb-8 sm:pb-14">

        {/* Category mood bar (when filtered).
            The mood line is deliberately NOT repeated here — the hero directly
            above already states it, and squeezing a second copy of it next to
            the tag pills was what made this strip unreadable on a phone.

            One line, always: the pills scale with the viewport rather than
            wrapping, since a wrapped second row read as clutter rather than as
            part of the same strip. Type and padding shrink together down to a
            floor, each pill may shrink past its content, and anything still too
            long ends in an ellipsis — so an over-enthusiastic mood can't push
            the row off the side of the phone. */}
        {activeCat && activeSlug !== "all" && activeTags.length > 0 && (
          <motion.div
            key={activeSlug}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-nowrap items-center mb-6 sm:mb-10"
            style={{ gap: "clamp(5px, 1.6vw, 8px)" }}
          >
            <div
              className="rounded-full shrink-0"
              style={{ width: 10, height: 10, background: activeCat.accent_color }}
            />
            {activeTags.map(tag => (
              <span
                key={tag}
                className="font-sans rounded-full whitespace-nowrap overflow-hidden text-ellipsis min-w-0"
                style={{
                  fontSize: "clamp(0.6rem, 2.85vw, 0.75rem)",
                  padding: "3px clamp(7px, 2.2vw, 12px)",
                  background: `${activeCat.accent_color}18`,
                  color: activeCat.accent_color,
                  border: `1px solid ${activeCat.accent_color}35`,
                }}
              >
                {tag}
              </span>
            ))}
          </motion.div>
        )}

        {/* Loading — placeholder cards in the grid's own shape, so the real
            candles drop straight into place instead of pushing the page around. */}
        {loading && (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <SkelProductCard key={i} />)}
          </div>
        )}

        {/* Empty state */}
        {!loading && visibleProducts.length === 0 && (
          <div className="py-20 text-center space-y-4">
            <p className="text-4xl">🕯️</p>
            <p className="font-serif text-xl" style={{ color: "var(--color-forest-dark)" }}>
              {activeSlug === "all" ? "No products yet" : "No products in this category yet"}
            </p>
            <p className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.55)" }}>
              {activeSlug === "all"
                ? "Products will appear here once added in the admin panel."
                : "Try another category or browse all candles."}
            </p>
            {activeSlug !== "all" && (
              <button
                onClick={() => setCategory("all")}
                className="mt-4 font-display text-sm font-semibold px-6 py-2.5 rounded-full"
                style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
              >
                Browse all candles →
              </button>
            )}
          </div>
        )}

        {/* Grid */}
        {!loading && visibleProducts.length > 0 && (
          <>
            <p className="font-sans text-xs text-right mb-6" style={{ color: "rgba(30,41,24,0.45)" }}>
              {visibleProducts.length} candle{visibleProducts.length !== 1 ? "s" : ""}
            </p>
            {/* Two per row on a phone: the whole catalogue is scannable at a
                glance and a tap opens the one that catches the eye. */}
            <motion.div layout className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
              <AnimatePresence mode="popLayout">
                {visibleProducts.map((p, i) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    idx={i}
                    accent={resolveCardAccent(cardTheme, activeCat)}
                    buttonTextColor={cardTheme.buttonTextColor}
                    density="regular"
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </>
        )}
      </div>

      <FooterSection />
    </div>
  );
};

export default ShopPage;
