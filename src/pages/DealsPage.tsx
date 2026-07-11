import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, DEFAULT_DEALS, type Product, type Bundle, type DealsContent } from "@/lib/defaults";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { formatPrice } from "@/lib/cart";
import FooterSection from "@/components/sections/FooterSection";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];

const BundleCard = ({ bundle, allProducts, idx }: { bundle: Bundle; allProducts: Product[]; idx: number }) => {
  const { user, openAuthModal } = useAuth();
  const { addToCart, items } = useCart();
  const [adding, setAdding] = useState(false);

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

  const allInCart = bundleProducts.every(p => items.some(i => i.product.id === p.id));

  const handleAddBundle = async () => {
    if (!user) { openAuthModal(); return; }
    setAdding(true);
    for (const p of bundleProducts) {
      if (!items.some(i => i.product.id === p.id)) {
        await addToCart(p);
      }
    }
    setAdding(false);
    toast.success(`${bundle.name} added to basket!`, {
      description: `You save €${discount.toFixed(2)}`,
      duration: 3000,
    });
  };

  const rotate = idx % 2 === 0 ? "-0.8deg" : "0.6deg";
  const accent = "#6b3520";

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

      {/* Discount badge */}
      <div style={{ position: "absolute", top: 16, right: -10, background: accent, color: "#fff", fontFamily: "'Fredoka',sans-serif", fontSize: "0.95rem", padding: "4px 14px 4px 10px", borderRadius: "4px 0 0 4px", boxShadow: "2px 2px 8px rgba(0,0,0,0.2)", zIndex: 5 }}>
        {bundle.discount_type === "percentage" ? `${bundle.discount_value}% OFF` : `€${bundle.discount_value} OFF`}
      </div>

      {/* Header */}
      <div style={{ padding: "clamp(24px,4vw,36px) clamp(20px,3.5vw,32px) clamp(16px,2.5vw,24px)", textAlign: "center", position: "relative", zIndex: 2 }}>
        <h3 style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "clamp(1.5rem,3vw,2.2rem)", color: accent, lineHeight: 1, marginBottom: 8 }}>
          {bundle.name}
        </h3>
        {bundle.description && (
          <p style={{ fontFamily: "'Permanent Marker',cursive", fontSize: "clamp(0.6rem,0.9vw,0.75rem)", color: "rgba(30,20,10,0.55)", transform: "rotate(-1deg)" }}>
            {bundle.description}
          </p>
        )}
      </div>

      {/* Divider */}
      <div style={{ margin: "0 clamp(20px,3.5vw,32px)", height: 1, background: `${accent}18` }} />

      {/* Products */}
      <div style={{ display: "flex", gap: "clamp(8px,1.5vw,16px)", padding: "clamp(16px,2.5vw,24px) clamp(20px,3.5vw,32px)", position: "relative", zIndex: 2, background: "#f5e8d8", borderTop: "none" }}>
        {bundleProducts.map((p, i) => {
          const img = p.image_url || FALLBACK_IMGS[i % 2];
          return (
            <div key={p.id} style={{ flex: "1 1 0", minWidth: 0, textAlign: "center" }}>
              <div style={{ aspectRatio: "3/4", borderRadius: 10, overflow: "hidden", marginBottom: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <img src={img} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover", mixBlendMode: "multiply" }} />
              </div>
              <p style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "clamp(0.82rem,1.3vw,1rem)", color: accent, lineHeight: 1.1, marginBottom: 2 }}>{p.name}</p>
              <p style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "clamp(0.72rem,1.1vw,0.88rem)", color: "rgba(30,20,10,0.55)", textDecoration: "line-through" }}>{formatPrice(p.price)}</p>
              {i < bundleProducts.length - 1 && (
                <span style={{ position: "absolute", top: "50%", right: -14, transform: "translateY(-50%)", fontFamily: "'Fredoka',sans-serif", fontSize: "1.2rem", color: accent, zIndex: 3 }}>+</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Pricing + CTA */}
      <div style={{ padding: "clamp(14px,2vw,20px) clamp(20px,3.5vw,32px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, position: "relative", zIndex: 2 }}>
        <div>
          <p style={{ fontFamily: "'Inter',sans-serif", fontSize: "clamp(0.6rem,0.85vw,0.7rem)", color: "rgba(30,20,10,0.45)", textDecoration: "line-through" }}>
            Was €{originalTotal.toFixed(2)}
          </p>
          <p style={{ fontFamily: "'Fredoka',sans-serif", fontWeight: 700, fontSize: "clamp(1.2rem,2vw,1.6rem)", color: accent }}>
            Bundle €{bundlePrice.toFixed(2)}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.95 }}
          onClick={handleAddBundle}
          disabled={adding || allInCart}
          style={{ fontFamily: "'Fredoka',sans-serif", fontWeight: 600, fontSize: "clamp(0.82rem,1.2vw,1rem)", background: allInCart ? "rgba(107,53,32,0.18)" : accent, color: allInCart ? accent : "#fff", border: allInCart ? `1.5px solid ${accent}` : "none", borderRadius: 50, padding: "10px 24px", cursor: allInCart ? "default" : "pointer", boxShadow: allInCart ? "none" : `0 4px 16px ${accent}44`, transition: "all 0.2s", whiteSpace: "nowrap" }}
        >
          {adding ? "Adding…" : allInCart ? "✓ In Basket" : "Add Bundle to Basket"}
        </motion.button>
      </div>

      {/* Watermark */}
      <div style={{ position: "absolute", bottom: "3%", right: "2%", fontFamily: "'Permanent Marker',cursive", fontSize: "0.5rem", color: `${accent}14`, transform: "rotate(-3deg)", pointerEvents: "none" }}>
        handmade · small batch
      </div>
    </motion.div>
  );
};

const DealsPage = () => {
  const [deals, setDeals]       = useState<DealsContent>(DEFAULT_DEALS);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [content, setContent]   = useState(DEFAULT_CONTENT);

  useEffect(() => {
    Promise.all([
      getContent("announcementBar", DEFAULT_CONTENT.announcementBar),
      getContent("navbar",          DEFAULT_CONTENT.navbar),
      getContent("footer",          DEFAULT_CONTENT.footer),
      getContent<DealsContent>("deals", DEFAULT_DEALS),
      getContent<{ label: string; headline: string; subtext: string; items: Product[] }>("products", DEFAULT_CONTENT.products),
    ]).then(([announcementBar, navbar, footer, dealsData, productsData]) => {
      setContent(prev => ({ ...prev, announcementBar, navbar, footer }));
      setDeals(dealsData ?? DEFAULT_DEALS);
      setAllProducts(productsData?.items ?? []);
    });
  }, []);

  const activeBundles = deals.bundles.filter(b => b.is_active);

  return (
    <div className="min-h-screen" style={{ background: "var(--color-cream-section)" }}>

      <div className="pt-[112px]">
        {/* Hero */}
        <div style={{ background: "var(--color-forest-dark)", padding: "clamp(40px,6vw,72px) 0" }}>
          <div className="max-w-5xl mx-auto px-6 text-center">
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="font-display text-xs tracking-[0.2em] uppercase mb-3"
              style={{ color: "var(--color-gold)" }}>
              🕯️ limited time offers 🕯️
            </motion.p>
            <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
              style={{ fontFamily: "'Fredoka',sans-serif", fontWeight: 600, fontSize: "clamp(2.4rem,5vw,4rem)", color: "var(--color-cream-text)", lineHeight: 1.05, marginBottom: 12 }}>
              {deals.page_title}
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}
              className="font-sans text-base leading-relaxed max-w-xl mx-auto"
              style={{ color: "rgba(245,239,230,0.7)" }}>
              {deals.page_subtitle}
            </motion.p>
          </div>
        </div>

        {/* Bundles */}
        <div className="max-w-5xl mx-auto" style={{ padding: "clamp(32px,5vw,72px) clamp(12px,4vw,32px)" }}>
          {activeBundles.length === 0 ? (
            <div className="text-center py-20">
              <p style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "2rem", color: "var(--color-forest-dark)", opacity: 0.4 }}>No deals right now</p>
              <a href="/shop" style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "1rem", color: "#6b3520" }}>Browse all candles →</a>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "clamp(40px,5vw,56px)", paddingBottom: 32 }}>
              {activeBundles
                .sort((a, b) => a.display_order - b.display_order)
                .map((bundle, i) => (
                  <BundleCard key={bundle.id} bundle={bundle} allProducts={allProducts} idx={i} />
                ))}
            </div>
          )}
        </div>
      </div>

      <FooterSection data={content.footer} />
    </div>
  );
};

export default DealsPage;
