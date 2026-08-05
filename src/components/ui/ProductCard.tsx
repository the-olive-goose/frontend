import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { Product } from "@/lib/defaults";
import { productPath } from "@/lib/products";
import { formatPrice } from "@/lib/cart";
import { useCart } from "@/contexts/CartContext";
import AddToCartButton from "@/components/ui/AddToCartButton";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

/**
 * The single source of truth for a single-product card across the storefront:
 * the homepage "featured category" strip, the scrapbook category pages, and the
 * shop grid all render THIS component. Shape, background, typography, badge and
 * button styling live here once — change them here and every surface updates.
 *
 * Per-surface knobs stay as props: `accent` (resolved from the global product
 * card theme + optional per-category override), `density` (compact strip vs the
 * roomier grid), and `isDark` (for dark category backgrounds). Everything else is
 * intentionally fixed so the same candle looks identical wherever it appears.
 */

const FALLBACK_IMGS = [m1, m2];

export type ProductCardDensity = "compact" | "regular";

const DENSITY: Record<ProductCardDensity, {
  padding: string;
  name: string;
  desc: string;
  button: "sm" | "md";
  price: string;
}> = {
  compact: {
    padding: "clamp(8px,1.2vw,12px) clamp(10px,1.4vw,14px) clamp(10px,1.4vw,14px)",
    name: "clamp(0.92rem,1.45vw,1.1rem)",
    desc: "clamp(0.56rem,0.85vw,0.68rem)",
    button: "sm",
    price: "clamp(0.95rem,1.5vw,1.15rem)",
  },
  regular: {
    // Two cards share a phone's width, so the padding scales down with it.
    padding: "clamp(11px,3.2vw,16px)",
    name: "clamp(1rem,1.6vw,1.25rem)",
    desc: "clamp(0.78rem,1vw,0.875rem)",
    button: "md",
    price: "clamp(1.05rem,1.7vw,1.3rem)",
  },
};

export interface ProductCardProps {
  product: Product;
  idx: number;
  /** Resolved accent (badge, name, price, button). Use resolveCardAccent(). */
  accent: string;
  /** Text colour on the accent button. Defaults to the theme's button text. */
  buttonTextColor?: string;
  density?: ProductCardDensity;
  isDark?: boolean;
}

const ProductCard = forwardRef<HTMLDivElement, ProductCardProps>(
  ({ product, idx, accent, buttonTextColor = "var(--btn-dark-text)", density = "regular", isDark = false }, ref) => {
    const img = product.image_url || FALLBACK_IMGS[idx % 2];
    const d = DENSITY[density];
    const { addToCart } = useCart();

    // undefined/null stock = "not tracked", always purchasable — only an explicit
    // 0 blocks the button. Checkout enforces this authoritatively either way.
    const outOfStock =
      product.stock !== undefined && product.stock !== null && Number(product.stock) <= 0;

    // Unified surface tokens — the same on every page. Dark categories get a
    // translucent-on-dark treatment; everything else uses the cream card token.
    const cardBg   = isDark ? "rgba(255,255,255,0.09)" : "var(--color-cream-card)";
    const border   = isDark ? "rgba(255,255,255,0.12)" : "var(--color-border)";
    const bodyText = isDark ? "rgba(230,225,255,0.78)" : "rgba(30,41,24,0.62)";
    const divider  = isDark ? "rgba(255,255,255,0.08)" : "var(--color-border)";
    const btnText  = isDark ? "#0a0a18" : buttonTextColor;

    // No sign-in gate: the basket is the shopper's until checkout, where the
    // account is actually needed. A guest's adds live in localStorage and merge
    // into their account the moment they sign in.
    const handleAddToCart = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (outOfStock) return;
      addToCart(product);
      toast.success(`${product.name} added to basket`, {
        description: formatPrice(product.price),
        duration: 2200,
      });
    };

    return (
      <motion.div
        ref={ref}
        layout
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.3, delay: (idx % 6) * 0.04 }}
        whileHover={{ y: -5, transition: { duration: 0.18 } }}
        style={{
          flex: "1 1 0",
          minWidth: 0,
          background: cardBg,
          border: `1px solid ${border}`,
          borderRadius: "var(--radius-card)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: isDark ? "0 8px 28px rgba(0,0,0,0.45)" : "0 4px 18px rgba(0,0,0,0.07)",
          cursor: "pointer",
        }}
      >
        {/* Image — 3/4 ratio, opens the product page */}
        <Link
          to={productPath(product)}
          aria-label={`View ${product.name}`}
          style={{
            aspectRatio: "3/4",
            overflow: "hidden",
            background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
            flexShrink: 0,
            position: "relative",
            display: "block",
          }}
        >
          <img
            src={img}
            alt={`${product.name} — handmade candle by The Olive Goose`}
            loading="lazy"
            decoding="async"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              mixBlendMode: isDark ? "lighten" : "multiply",
              opacity: isDark ? 0.9 : 1,
            }}
          />
          {outOfStock ? (
            <span style={badgeStyle("#6b6b6b", "#fff")}>Out of stock</span>
          ) : product.tag ? (
            <span style={badgeStyle(accent, isDark ? "#0a0a18" : "#fff")}>{product.tag}</span>
          ) : null}
        </Link>

        {/* Info */}
        <div style={{ padding: d.padding, flex: 1, display: "flex", flexDirection: "column" }}>
          <Link
            to={productPath(product)}
            style={{
              fontFamily: "'Fredoka',sans-serif",
              fontSize: d.name,
              color: accent,
              lineHeight: 1.15,
              marginBottom: 4,
              display: "block",
            }}
          >
            {product.name}
          </Link>

          {product.description && (
            <p
              className="og-card-desc"
              style={{
                fontFamily: "'Inter',sans-serif",
                fontSize: d.desc,
                color: bodyText,
                lineHeight: 1.45,
                flex: 1,
                marginBottom: 8,
              }}
            >
              {product.description}
            </p>
          )}

          {/* Price + CTA. `og-card-foot` stacks them on a phone (see index.css):
              at two cards per row there isn't width for a price and a 44px
              "Add to Cart" side by side, and a squeezed button is the one thing
              on the card a thumb has to hit. */}
          <div
            className="og-card-foot"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              marginTop: "auto",
              paddingTop: 8,
              borderTop: `1px solid ${divider}`,
            }}
          >
            <span
              style={{
                fontFamily: "'Fredoka',sans-serif",
                fontWeight: 700,
                fontSize: d.price,
                color: accent,
              }}
            >
              {formatPrice(product.price)}
            </span>
            <AddToCartButton
              size={d.button}
              accent={accent}
              textColor={btnText}
              onClick={handleAddToCart}
              disabled={outOfStock}
              title={outOfStock ? "Out of stock" : undefined}
              label={outOfStock ? "Out of Stock" : "Add to Cart"}
            />
          </div>
        </div>
      </motion.div>
    );
  },
);
ProductCard.displayName = "ProductCard";

const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
  position: "absolute",
  top: 8,
  left: 8,
  fontFamily: "'Fredoka',sans-serif",
  fontSize: "clamp(0.48rem,0.72vw,0.6rem)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color,
  background: bg,
  borderRadius: 20,
  padding: "2px 8px",
});

export default ProductCard;
