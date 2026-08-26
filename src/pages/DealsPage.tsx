import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { DEFAULT_CONTENT, DEFAULT_DEALS, DEFAULT_PRODUCT_CARD_THEME, resolveCardAccent, type Product, type Bundle, type DealsContent, type ProductCardTheme } from "@/lib/defaults";
import useIsMobile from "@/hooks/useIsMobile";
import { useCart } from "@/contexts/CartContext";
import { ProductListScope, trackSelectItem } from "@/components/ProductListScope";
import { formatPrice } from "@/lib/cart";
import { productPath } from "@/lib/products";
import { useJsonLd } from "@/hooks/useJsonLd";
import { SITE_URL, breadcrumbJsonLd } from "@/lib/seo";
import PageHero from "@/components/PageHero";
import FooterSection from "@/components/sections/FooterSection";
import AddToCartButton from "@/components/ui/AddToCartButton";
import { SkelBlock } from "@/components/ui/ContentSkeleton";
import { useContent } from "@/hooks/useContent";
import RichText, { stripRichText } from "@/lib/richtext";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];

const BundleCard = ({ bundle, allProducts, idx, accent, buttonTextColor }: { bundle: Bundle; allProducts: Product[]; idx: number; accent: string; buttonTextColor: string }) => {
  const { addToCart } = useCart();
  const [adding, setAdding] = useState(false);
  const isMobile = useIsMobile();

  const bundleProducts = bundle.product_ids
    .map(id => allProducts.find(p => p.id === id))
    .filter((p): p is Product => !!p);

  if (bundleProducts.length === 0) return null;

  const originalTotal = bundleProducts.reduce((sum, p) => {
    const n = parseFloat(p.price.replace(/[^0-9.]/g, ""));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  const discount = bundle.discount_type === "percentage"
    ? originalTotal * (bundle.discount_value / 100)
    : bundle.discount_value;
  const bundlePrice = Math.max(0, originalTotal - discount);

  const handleAddBundle = async () => {
    setAdding(true);
    try {
      // Always add every product in the bundle (incrementing quantity if it is
      // already in the basket). Bundles share candles, so skipping items that
      // happen to be in the cart used to leave the button permanently locked.
      for (const p of bundleProducts) {
        await addToCart(p);
      }
      toast.success(`${bundle.name} added to basket!`, {
        description: `You save €${discount.toFixed(2)}`,
        duration: 3000,
      });
    } catch {
      toast.error("Couldn't add the bundle", { description: "Please try again." });
    } finally {
      setAdding(false);
    }
  };

  const rotate = idx % 2 === 0 ? "-0.8deg" : "0.6deg";
  const discountLabel = bundle.discount_type === "percentage"
    ? `${bundle.discount_value}% OFF`
    : `€${bundle.discount_value} OFF`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: idx * 0.1, duration: 0.45 }}
      style={{
        position: "relative",
        background: "#fdf6ef",
        borderRadius: "8px 20px 10px 18px / 18px 8px 20px 8px",
        boxShadow: "6px 10px 32px rgba(0,0,0,0.13), -3px -2px 10px rgba(0,0,0,0.05)",
        transform: `rotate(${rotate})`,
        overflow: "visible",
      }}
    >
      {/* Tape */}
      <div style={{ position: "absolute", top: -13, left: "50%", transform: "translateX(-50%) rotate(-2deg)", width: 68, height: 24, background: "rgba(255,220,120,0.65)", borderRadius: 3, boxShadow: "0 2px 5px rgba(0,0,0,0.1)", border: "1px solid rgba(255,255,255,0.4)", zIndex: 10 }} />

      {/* Paper grain */}
      <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E")`, pointerEvents: "none" }} />

      {/* Discount badge — a corner ribbon on desktop. On a phone the card is only
          as wide as the screen, so the ribbon would sit on top of the bundle
          name; there it becomes a centred pill in the flow above the name. */}
      {!isMobile && (
        <div style={{ position: "absolute", top: 16, right: -10, background: accent, color: "#fff", fontFamily: "'Fredoka',sans-serif", fontSize: "0.95rem", padding: "4px 14px 4px 10px", borderRadius: "4px 0 0 4px", boxShadow: "2px 2px 8px rgba(0,0,0,0.2)", zIndex: 5 }}>
          {discountLabel}
        </div>
      )}

      {/* Header — the paddings are tighter at the small end than the type scale
          would suggest on purpose: a phone should show a second bundle peeking
          below the fold rather than one card filling the whole screen. */}
      <div style={{ padding: "clamp(18px,4vw,36px) clamp(16px,3.5vw,32px) clamp(12px,2.5vw,24px)", textAlign: "center", position: "relative", zIndex: 2 }}>
        {isMobile && (
          <span style={{ display: "inline-block", background: accent, color: "#fff", fontFamily: "'Fredoka',sans-serif", fontSize: "0.8rem", padding: "3px 12px", borderRadius: "var(--radius-pill)", marginBottom: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.16)" }}>
            {discountLabel}
          </span>
        )}
        <h3 style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "clamp(1.35rem,3vw,2.2rem)", color: accent, lineHeight: 1, marginBottom: 8 }}>
          {bundle.name}
        </h3>
        {bundle.description && (
          <p style={{ fontFamily: "'Permanent Marker',cursive", fontSize: "clamp(0.6rem,0.9vw,0.75rem)", color: "rgba(30,20,10,0.55)", transform: "rotate(-1deg)" }}>
            <RichText text={bundle.description} />
          </p>
        )}
      </div>

      {/* Divider */}
      <div style={{ margin: "0 clamp(16px,3.5vw,32px)", height: 1, background: `${accent}18` }} />

      {/* Products.
          Each bundle is its own item list: that is what the shopper is actually
          looking at, and it makes the report answer the question the page is
          for — which bundle's candles get clicked through to. */}
      <ProductListScope id={`bundle_${bundle.id}`} name={bundle.name} products={bundleProducts}>
        {(listRef) => (
      <div ref={listRef} style={{ display: "flex", gap: "clamp(8px,1.5vw,16px)", padding: "clamp(12px,2.5vw,24px) clamp(16px,3.5vw,32px)", position: "relative", zIndex: 2, background: "#f5e8d8", borderTop: "none" }}>
        {bundleProducts.map((p, i) => {
          const img = p.image_url || FALLBACK_IMGS[i % 2];
          // Both links are the same decision, so both report it — exactly as
          // the shared ProductCard does.
          const select = () => trackSelectItem(p, i, { id: `bundle_${bundle.id}`, name: bundle.name });
          return (
            <div key={p.id} style={{ flex: "1 1 0", minWidth: 0, textAlign: "center", position: "relative" }}>
              <Link to={productPath(p)} onClick={select} style={{ display: "block", aspectRatio: "3/4", borderRadius: 10, overflow: "hidden", marginBottom: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <img src={img} alt={`${p.name} — handmade candle by The Olive Goose`} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", mixBlendMode: "multiply" }} />
              </Link>
              <Link to={productPath(p)} onClick={select} style={{ display: "block", fontFamily: "'Fredoka',sans-serif", fontSize: "clamp(0.82rem,1.3vw,1rem)", color: accent, lineHeight: 1.1, marginBottom: 2 }}>{p.name}</Link>
              <p style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "clamp(0.72rem,1.1vw,0.88rem)", color: "rgba(30,20,10,0.55)", textDecoration: "line-through" }}>{formatPrice(p.price)}</p>
              {/* "+" between two candles. It anchors to this product cell (which
                  is `position: relative`) and centres itself in the gap — before,
                  the nearest positioned ancestor was the whole bundle card, so
                  every "+" piled up on the card's right edge. */}
              {i < bundleProducts.length - 1 && (
                <span style={{ position: "absolute", top: "36%", right: 0, transform: "translate(50%,-50%)", marginRight: "calc(clamp(8px,1.5vw,16px) / -2)", fontFamily: "'Fredoka',sans-serif", fontSize: "1.2rem", color: accent, zIndex: 3 }}>+</span>
              )}
            </div>
          );
        })}
      </div>
        )}
      </ProductListScope>

      {/* Pricing + CTA */}
      <div style={{ padding: "clamp(12px,2vw,20px) clamp(16px,3.5vw,32px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, position: "relative", zIndex: 2 }}>
        <div>
          <p style={{ fontFamily: "'Inter',sans-serif", fontSize: "clamp(0.6rem,0.85vw,0.7rem)", color: "rgba(30,20,10,0.45)", textDecoration: "line-through" }}>
            Was €{originalTotal.toFixed(2)}
          </p>
          <p style={{ fontFamily: "'Fredoka',sans-serif", fontWeight: 700, fontSize: "clamp(1.2rem,2vw,1.6rem)", color: accent }}>
            Bundle €{bundlePrice.toFixed(2)}
          </p>
        </div>
        <AddToCartButton
          size="md"
          accent={accent}
          textColor={buttonTextColor}
          onClick={handleAddBundle}
          disabled={adding}
          label={adding ? "Adding…" : "Add Bundle to Basket"}
        />
      </div>

      {/* Watermark */}
      <div style={{ position: "absolute", bottom: "3%", right: "2%", fontFamily: "'Permanent Marker',cursive", fontSize: "0.5rem", color: `${accent}14`, transform: "rotate(-3deg)", pointerEvents: "none" }}>
        handmade · small batch
      </div>
    </motion.div>
  );
};

const DealsPage = () => {
  // Navbar / announcement / footer copy used to be fetched here into state this
  // page never rendered — Layout and FooterSection own those.
  const dealsC    = useContent<DealsContent>("deals", DEFAULT_DEALS);
  const productsC = useContent("products", DEFAULT_CONTENT.products);
  const themeC    = useContent<ProductCardTheme>("productCardTheme", DEFAULT_PRODUCT_CARD_THEME);

  const deals       = dealsC.data;
  const allProducts = productsC.data?.items ?? [];
  const cardTheme   = themeC.data;
  const ready       = dealsC.ready && productsC.ready && themeC.ready;

  // Bundles aren't tied to one category, so they always use the global accent.
  const bundleAccent = resolveCardAccent(cardTheme, null);

  const activeBundles = ready ? deals.bundles.filter(b => b.is_active) : [];

  useJsonLd("breadcrumb", breadcrumbJsonLd([["Home", "/"], ["Candle Gift Sets & Deals", "/deals"]]));

  // OfferCatalog mirroring the visible bundles — real names and computed prices only.
  useJsonLd(
    "deals-catalog",
    activeBundles.length === 0
      ? null
      : {
          "@context": "https://schema.org",
          "@type": "OfferCatalog",
          name: "Candle gift sets & bundle deals by The Olive Goose",
          url: `${SITE_URL}/deals`,
          itemListElement: activeBundles.map(b => ({
            "@type": "Offer",
            name: b.name,
            ...(b.description && { description: stripRichText(b.description) }),
            url: `${SITE_URL}/deals`,
            priceCurrency: "EUR",
          })),
        },
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--color-cream-section)" }}>

      <div>
        {/* Hero — shared band: owns the nav offset + page rhythm */}
        <PageHero
          eyebrow="Limited Time Offers"
          title={deals.page_title}
          titleGold={deals.page_title_gold}
          subtitle={deals.page_subtitle}
          ready={ready}
        />

        {/* Bundles */}
        <div
          className="max-w-5xl mx-auto"
          style={{
            paddingTop: "var(--page-body-pt)",
            paddingBottom: "clamp(32px,5vw,72px)",
            paddingInline: "clamp(12px,4vw,32px)",
          }}
        >
          {!ready ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "clamp(26px,5vw,56px)", paddingBottom: 32, color: "var(--color-forest-dark)" }}>
              {[0, 1, 2].map(i => <SkelBlock key={i} height="clamp(340px,42vw,420px)" />)}
            </div>
          ) : activeBundles.length === 0 ? (
            <div className="text-center py-20">
              <p style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "2rem", color: "var(--color-forest-dark)", opacity: 0.4 }}>No deals right now</p>
              <a href="/shop" style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "1rem", color: "#6b3520" }}>Browse all candles →</a>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "clamp(26px,5vw,56px)", paddingBottom: 32 }}>
              {activeBundles
                .sort((a, b) => a.display_order - b.display_order)
                .map((bundle, i) => (
                  <BundleCard key={bundle.id} bundle={bundle} allProducts={allProducts} idx={i} accent={bundleAccent} buttonTextColor={cardTheme.buttonTextColor} />
                ))}
            </div>
          )}
        </div>
      </div>

      <FooterSection />
    </div>
  );
};

export default DealsPage;
