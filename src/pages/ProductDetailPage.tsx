import { useState, useEffect, useMemo } from "react";
import useSwipe from "@/hooks/useSwipe";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { getContent, getShopCategories, subscribe, AlreadySubscribedError, type ShopCategory } from "@/lib/api";
import {
  DEFAULT_CONTENT, DEFAULT_DEALS,
  type DealsContent, type PickupSettingsContent, type Product, type ProductPageContent,
  type ProductsContent, type ReturnPolicyContent, type SubscribePopupContent,
} from "@/lib/defaults";
import { resolveOfferValues } from "@/lib/offerTokens";
import {
  bundlesForProduct, findProduct, isOutOfStock, productImages, productParagraphs,
  productPath, recommendationsFor, type BundlePricing,
} from "@/lib/products";
import { useCart } from "@/contexts/CartContext";
import { track } from "@/lib/analytics";
import { formatPrice, MAX_CART_QTY } from "@/lib/cart";
import { useJsonLd } from "@/hooks/useJsonLd";
import { applyMeta, SITE_URL, SITE_NAME, parsePriceValue, breadcrumbJsonLd } from "@/lib/seo";
import FooterSection from "@/components/sections/FooterSection";
import AddToCartButton from "@/components/ui/AddToCartButton";
import BuyAssurances, { BuyAssurancesSkeleton } from "@/components/BuyAssurances";
import { SkelBlock, SkelText } from "@/components/ui/ContentSkeleton";
import RichText, { stripRichText } from "@/lib/richtext";
import m1 from "@/assets/M1.png";

const euro = (n: number) => `€${n.toFixed(2)}`;

// ── Gallery ────────────────────────────────────────────────────────────────────

const Gallery = ({ product }: { product: Product }) => {
  const images = productImages(product);
  const shots = images.length > 0 ? images : [m1];
  const [active, setActive] = useState(0);

  // Reset to the first shot when navigating between products.
  useEffect(() => { setActive(0); }, [product.id]);

  // Swiping the photo is how a phone expects to browse a product's shots; the
  // thumbnails below stay as the pointer equivalent. Wraps around, so there's
  // no dead end at either edge of the roll.
  const swipe = useSwipe({
    onSwipeLeft:  () => setActive(i => (i + 1) % shots.length),
    onSwipeRight: () => setActive(i => (i - 1 + shots.length) % shots.length),
    enabled: shots.length > 1,
  });

  return (
    // Sticky on desktop so the candle stays in view while the buy box, bundle
    // picker and long copy scroll past it.
    <div className="flex flex-col gap-4 lg:sticky lg:self-start lg:top-[calc(var(--nav-h,112px)+24px)]">
      <div {...swipe} className="relative w-full" style={swipe.style}>
        <motion.div
          key={shots[active]}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="w-full overflow-hidden"
          style={{
            borderRadius: "var(--radius-card)",
            background: "var(--color-sage-pale)",
            aspectRatio: "1/1",
            border: "1px solid var(--color-border)",
          }}
        >
          <img
            src={shots[active]}
            alt={`${product.name} — handmade candle by The Olive Goose`}
            className="w-full h-full object-cover"
            decoding="async"
          />
        </motion.div>

        {/* Position counter — tells you there's more to swipe to */}
        {shots.length > 1 && (
          <span
            className="absolute bottom-3 right-3 font-sans text-xs px-2.5 py-1 rounded-full pointer-events-none"
            style={{ background: "rgba(29,43,27,0.72)", color: "var(--color-cream-text)" }}
          >
            {active + 1} / {shots.length}
          </span>
        )}
      </div>

      {shots.length > 1 && (
        <div className="flex gap-3 flex-wrap">
          {shots.map((src, i) => (
            <button
              key={src}
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1} of ${product.name}`}
              aria-current={i === active}
              className="overflow-hidden transition-all"
              style={{
                width: 88, height: 88,
                borderRadius: "var(--radius-input)",
                border: i === active ? "2px solid var(--color-forest-dark)" : "1px solid var(--color-border)",
                opacity: i === active ? 1 : 0.75,
                background: "var(--color-sage-pale)",
              }}
            >
              <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Quantity stepper ───────────────────────────────────────────────────────────

const QuantityStepper = ({
  value, onChange, max, disabled,
}: { value: number; onChange: (n: number) => void; max: number; disabled?: boolean }) => {
  const clamp = (n: number) => Math.min(Math.max(n, 1), max);

  return (
    <div
      className="inline-flex items-center"
      style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-input)", background: "var(--color-white)" }}
    >
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= 1}
        aria-label="Decrease quantity"
        className="px-4 py-3 text-lg leading-none disabled:opacity-35"
        style={{ color: "var(--text-primary)" }}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={value}
        disabled={disabled}
        aria-label="Quantity"
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isNaN(n) ? 1 : clamp(n));
        }}
        className="w-14 text-center font-sans text-base bg-transparent focus:outline-none"
        style={{ color: "var(--text-primary)" }}
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
        className="px-4 py-3 text-lg leading-none disabled:opacity-35"
        style={{ color: "var(--text-primary)" }}
      >
        +
      </button>
    </div>
  );
};

// ── Bundle deal (sourced from Today's Deals) ───────────────────────────────────

const BundleDeal = ({
  deals, label, onAdd, addingId,
}: {
  deals: BundlePricing[];
  label: string;
  onAdd: (deal: BundlePricing) => void;
  addingId: string | null;
}) => {
  const [selected, setSelected] = useState(deals[0]?.bundle.id ?? "");
  const active = deals.find(d => d.bundle.id === selected) ?? deals[0];
  if (!active) return null;

  const adding = addingId === active.bundle.id;

  return (
    <div className="mt-8">
      {/* Divider with label */}
      <div className="flex items-center gap-4 mb-5">
        <span className="flex-1 h-px" style={{ background: "var(--color-border)" }} />
        <span
          className="font-display text-xs font-semibold uppercase"
          style={{ letterSpacing: "var(--tracking-eyebrow)", color: "var(--text-primary)" }}
        >
          {label}
        </span>
        <span className="flex-1 h-px" style={{ background: "var(--color-border)" }} />
      </div>

      {/* Bundle selector — one tab per active deal featuring this product */}
      {deals.length > 1 && (
        <div className="flex flex-wrap gap-0 mb-5" role="tablist">
          {deals.map((d, i) => {
            const on = d.bundle.id === active.bundle.id;
            return (
              <button
                key={d.bundle.id}
                role="tab"
                aria-selected={on}
                onClick={() => setSelected(d.bundle.id)}
                className="flex-1 min-w-[140px] py-3 px-4 font-display text-sm font-semibold transition-all"
                style={{
                  background: on ? "var(--color-forest-dark)" : "transparent",
                  color: on ? "var(--color-cream-text)" : "var(--text-primary)",
                  border: "1.5px solid var(--color-forest-dark)",
                  borderRadius: i === 0
                    ? "var(--radius-pill) 0 0 var(--radius-pill)"
                    : i === deals.length - 1 ? "0 var(--radius-pill) var(--radius-pill) 0" : "0",
                  marginLeft: i === 0 ? 0 : -1.5,
                }}
              >
                {d.products.length} for {euro(d.bundlePrice)}
              </button>
            );
          })}
        </div>
      )}

      {deals.length === 1 && (
        <p className="font-display text-base text-center mb-5" style={{ color: "var(--text-primary)" }}>
          {active.bundle.name} — {active.products.length} for {euro(active.bundlePrice)}
        </p>
      )}

      {/* Products in the selected bundle */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {active.products.map(p => (
          <div
            key={p.id}
            className="flex flex-col p-3 gap-2"
            style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", background: "var(--color-cream-card)" }}
          >
            <Link to={productPath(p)} className="block overflow-hidden" style={{ borderRadius: "var(--radius-input)" }}>
              <img
                src={p.image_url || m1}
                alt={`${p.name} — handmade candle by The Olive Goose`}
                loading="lazy"
                decoding="async"
                className="w-full object-cover"
                style={{ aspectRatio: "1/1", background: "var(--color-sage-pale)" }}
              />
            </Link>
            <Link
              to={productPath(p)}
              className="font-display text-sm font-semibold leading-tight hover:underline"
              style={{ color: "var(--text-primary)" }}
            >
              {p.name}
            </Link>
            <span className="font-sans text-xs" style={{ color: "var(--text-muted)" }}>
              {formatPrice(p.price)}
            </span>
          </div>
        ))}
      </div>

      {/* Total + CTA */}
      <div
        className="flex items-center justify-between mt-4 px-4 py-3"
        style={{ background: "rgba(29,43,27,0.06)", borderRadius: "var(--radius-input)" }}
      >
        <span className="font-sans text-sm" style={{ color: "var(--text-muted)" }}>
          Total{" "}
          <span style={{ textDecoration: "line-through" }}>{euro(active.originalTotal)}</span>
        </span>
        <span className="font-display text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          {euro(active.bundlePrice)}
        </span>
      </div>

      <AddToCartButton
        className="mt-3"
        size="lg"
        fullWidth
        onClick={() => onAdd(active)}
        disabled={adding}
        label={adding ? "Adding…" : `Add bundle — save ${euro(active.discount)}`}
      />
      <p className="text-center font-sans text-xs mt-2" style={{ color: "var(--text-muted)" }}>
        From <Link to="/deals" className="underline">Today's Deals</Link>
      </p>
    </div>
  );
};

// ── Join the Olive Goose Circle (writes to the subscribers table) ──────────────

const CircleSignup = ({ data }: { data: ProductPageContent["circle"] }) => {
  const [email, setEmail]   = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    try {
      const result = await subscribe(email);
      setStatus("done");
      setEmail("");
      // The code is never shown on the site — it goes to the mailbox, so claiming
      // the offer means owning the address. Same rule as the signup modal.
      toast.success(data.success_text, {
        description: result.discount
          ? `Your ${result.discount.discount_percent}% welcome code is on its way to ${email} — check your inbox and spam.`
          : "You'll hear from us when something new is poured.",
      });
    } catch (err: unknown) {
      setStatus("idle");
      if (err instanceof AlreadySubscribedError) {
        toast.info("You're already in the Circle", {
          description: err.alreadyUsed ? "Your welcome offer has already been used." : "You're on the list already!",
        });
        return;
      }
      const error = err as { code?: string };
      if (error.code === "23505") toast.info("You're already in the Circle");
      else toast.error("Something went wrong", { description: "Please try again in a moment." });
    }
  };

  return (
    <section className="py-16 lg:py-20" style={{ background: "var(--bg-newsletter)" }}>
      <div className="max-w-2xl mx-auto px-6 text-center space-y-4">
        <h2
          className="font-display leading-tight"
          style={{ fontSize: "var(--text-display-sm)", color: "var(--text-on-dark)" }}
        >
          <RichText text={data.headline} />
        </h2>
        {data.subtext && (
          <p className="font-sans text-sm max-w-md mx-auto leading-relaxed" style={{ color: "var(--text-muted-on-dark)" }}>
            <RichText text={data.subtext} />
          </p>
        )}

        {status === "done" ? (
          <p className="font-sans font-medium pt-2" style={{ color: "var(--text-on-dark)" }}>
            ✓ <RichText text={data.success_text} />
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 mt-4 max-w-md mx-auto">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={data.placeholder}
              aria-label="Email address"
              required
              className="flex-1 font-sans text-sm focus:outline-none focus:ring-2"
              style={{
                padding: "12px 20px",
                borderRadius: "var(--radius-input)",
                background: "rgba(245,239,230,0.1)",
                border: "1px solid rgba(245,239,230,0.2)",
                color: "var(--text-on-dark)",
              }}
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="font-sans text-sm font-medium transition-all disabled:opacity-60 shrink-0"
              style={{
                padding: "12px 28px",
                borderRadius: "var(--radius-pill)",
                background: "var(--color-cream-button)",
                color: "var(--color-forest-dark)",
                letterSpacing: "var(--tracking-cta)",
              }}
            >
              {status === "loading" ? "…" : data.cta_text}
            </button>
          </form>
        )}
      </div>
    </section>
  );
};

// ── Recommendation card ────────────────────────────────────────────────────────

const RecommendationCard = ({ product }: { product: Product }) => (
  <Link
    to={productPath(product)}
    className="group flex flex-col transition-transform duration-300 hover:-translate-y-1.5"
  >
    <div
      className="relative w-full overflow-hidden"
      style={{ borderRadius: "var(--radius-card)", aspectRatio: "1/1", background: "var(--color-sage-pale)" }}
    >
      <img
        src={product.image_url || m1}
        alt={`${product.name} — handmade candle by The Olive Goose`}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
      />
      {isOutOfStock(product) && (
        <span
          className="absolute top-3 left-3 font-display text-xs font-semibold uppercase px-3 py-1"
          style={{ background: "#6b6b6b", color: "#fff", borderRadius: "var(--radius-badge)" }}
        >
          Out of stock
        </span>
      )}
    </div>
    <div className="pt-3 text-center space-y-1">
      <h3 className="font-display text-base leading-tight" style={{ color: "var(--text-primary)" }}>
        {product.name}
      </h3>
      <p className="font-sans text-xs" style={{ color: "var(--text-muted)" }}><RichText text={product.description} /></p>
      <p className="font-display font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
        {formatPrice(product.price)}
      </p>
    </div>
  </Link>
);

// ── Page ───────────────────────────────────────────────────────────────────────

const ProductDetailPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const { addToCart } = useCart();

  const [products, setProducts]     = useState<Product[]>([]);
  const [pageCopy, setPageCopy]     = useState<ProductPageContent>(DEFAULT_CONTENT.productPage);
  const [deals, setDeals]           = useState<DealsContent>(DEFAULT_DEALS);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [loading, setLoading]       = useState(true);
  // The buy-box assurance lines quote the shipping rate, the free-shipping bar
  // and the returns window via tokens, so the page needs the three settings
  // sections that own those figures.
  const [offer, setOffer]           = useState(() =>
    resolveOfferValues(
      DEFAULT_CONTENT.pickupSettings, DEFAULT_CONTENT.subscribePopup, DEFAULT_CONTENT.returnPolicy));

  const [quantity, setQuantity]   = useState(1);
  const [adding, setAdding]       = useState(false);
  const [addingBundle, setAddingBundle] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getContent<ProductsContent>("products", DEFAULT_CONTENT.products),
      getContent<ProductPageContent>("productPage", DEFAULT_CONTENT.productPage),
      getContent<DealsContent>("deals", DEFAULT_DEALS),
      getContent<PickupSettingsContent>("pickupSettings", DEFAULT_CONTENT.pickupSettings),
      getContent<SubscribePopupContent>("subscribePopup", DEFAULT_CONTENT.subscribePopup),
      getContent<ReturnPolicyContent>("returnPolicy", DEFAULT_CONTENT.returnPolicy),
      getShopCategories(),
    ]).then(([productsData, productPage, dealsData, pickup, popup, returnPolicy, cats]) => {
      setProducts(productsData?.items ?? []);
      // Merge over defaults so a partially-saved section can't blank the page.
      setPageCopy({
        ...DEFAULT_CONTENT.productPage,
        ...(productPage ?? {}),
        assurances: { ...DEFAULT_CONTENT.productPage.assurances, ...(productPage?.assurances ?? {}) },
        circle: { ...DEFAULT_CONTENT.productPage.circle, ...(productPage?.circle ?? {}) },
      });
      setDeals(dealsData ?? DEFAULT_DEALS);
      setOffer(resolveOfferValues(pickup, popup, returnPolicy));
      setCategories(cats);
    }).finally(() => setLoading(false));
  }, []);

  const product = useMemo(() => findProduct(products, slug), [products, slug]);

  // New product → reset the buy box.
  useEffect(() => { setQuantity(1); }, [slug]);

  // view_item — the funnel stage between browsing a grid and adding to the
  // basket, and the denominator for this product's view→cart→purchase rate.
  //
  // Waits for `product` rather than firing on mount: the catalogue is fetched
  // after the first render, so a mount-time event would record a view of a
  // product we hadn't resolved yet, with no id on it. Keyed on product.id so a
  // re-render (quantity, image carousel, a bundle loading in) can't inflate the
  // count — one view per product actually shown.
  useEffect(() => {
    if (!product) return;
    // A product has no category of its own — categories own a product_ids list —
    // so it is resolved by lookup. Categories arrive in the same Promise.all as
    // the catalogue, so they are loaded by the time a product resolves.
    track("view_item", {
      product_id: product.id,
      name: product.name,
      price: product.price,
      category: categories.find(c => c.product_ids?.includes(product.id))?.name || "",
    });
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const outOfStock = product ? isOutOfStock(product) : false;
  const maxQty = product?.stock != null ? Math.min(Number(product.stock), MAX_CART_QTY) : MAX_CART_QTY;

  const bundles = useMemo(
    () => (product ? bundlesForProduct(deals.bundles ?? [], products, product.id) : []),
    [deals, products, product],
  );

  const recommendations = useMemo(
    () => (product
      ? recommendationsFor(product, products, {
          categories,
          bundles: deals.bundles ?? [],
          limit: pageCopy.recommendations_count,
        })
      : []),
    [product, products, categories, deals, pageCopy.recommendations_count],
  );

  const paragraphs = useMemo(() => (product ? productParagraphs(product) : []), [product]);

  // Per-product <head> tags. SeoManager applies the route-level defaults first;
  // this effect runs after it, so the product-specific title/description win.
  useEffect(() => {
    if (!product) return;
    const image = productImages(product)[0];
    applyMeta({
      title: `${product.name} | Handmade Candle | ${SITE_NAME}`,
      description:
        stripRichText(paragraphs[0] || product.description || `${product.name} — a hand-poured candle by ${SITE_NAME}.`)
          .slice(0, 155),
      path: productPath(product),
      ogType: "product",
      ...(image?.startsWith("http") && { ogImage: image }),
    });
  }, [product, paragraphs]);

  // Breadcrumb trail: Home > Shop > this candle.
  useJsonLd(
    "breadcrumb",
    product
      ? breadcrumbJsonLd([["Home", "/"], ["Shop", "/shop"], [product.name, productPath(product)]])
      : null,
  );

  useJsonLd(
    "product-detail",
    product
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.name,
          description: stripRichText(paragraphs.join(" ") || product.description),
          sku: product.id,
          ...(productImages(product).length > 0 && {
            image: productImages(product).map(url => (url.startsWith("http") ? url : `${SITE_URL}${url}`)),
          }),
          brand: { "@type": "Brand", name: SITE_NAME },
          ...(parsePriceValue(product.price) && {
            offers: {
              "@type": "Offer",
              price: parsePriceValue(product.price),
              priceCurrency: "EUR",
              availability: outOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
              url: `${SITE_URL}${productPath(product)}`,
            },
          }),
        }
      : null,
  );

  // Same rule as every other buy button on the site: no sign-in to add. The
  // account is asked for once, at checkout, and the basket follows the shopper
  // into it.
  const handleAddToCart = () => {
    if (!product || outOfStock) return;
    setAdding(true);
    addToCart(product, quantity)
      .then(() => {
        toast.success(`${product.name} added to basket`, {
          description: `${quantity} × ${formatPrice(product.price)}`,
          duration: 2500,
        });
      })
      .catch(() => toast.error("Couldn't add to basket", { description: "Please try again." }))
      .finally(() => setAdding(false));
  };

  const handleAddBundle = async (deal: BundlePricing) => {
    setAddingBundle(deal.bundle.id);
    try {
      for (const p of deal.products) {
        await addToCart(p, 1);
      }
      toast.success(`${deal.bundle.name} added to basket!`, {
        description: `You save ${euro(deal.discount)}`,
        duration: 3000,
      });
    } catch {
      toast.error("Couldn't add the bundle", { description: "Please try again." });
    } finally {
      setAddingBundle(null);
    }
  };

  // Placeholders in the page's own shape rather than a spinner, so the candle
  // drops into a layout that is already the right size.
  //
  // Every branch below wraps its content in the exact same shell — an outer
  // `min-h-screen` and an inner `pt-[var(--nav-h)]`. React reuses DOM nodes
  // across the loading → loaded swap, so when the nav offset lived on the outer
  // div here and on the inner div in the loaded tree, the reused node lost a
  // whole navbar's worth of padding and the page jumped ~156px up the moment the
  // product landed: 0.54 of layout shift, the worst on the site. Keep the two
  // wrappers identical in every branch.
  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-page)", color: "var(--text-primary)" }}>
        <div className="pt-[var(--nav-h,112px)]">
          {/* Breadcrumb row — reserved so the gallery doesn't slide up under it */}
          <div className="max-w-6xl mx-auto px-6 pt-6">
            <SkelText width="180px" style={{ fontSize: "0.75rem" }} />
          </div>
          <div className="max-w-6xl mx-auto px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14">
            {/* Same 1/1 shot and 88px thumbnail row the Gallery renders, so the
                buy box below starts at the same y in both states. */}
            <div className="flex flex-col gap-4">
              <SkelBlock style={{ aspectRatio: "1/1", width: "100%", height: "auto" }} />
              <div className="flex gap-3 flex-wrap">
                {[0, 1].map(i => (
                  <SkelBlock key={i} height="88px" width="88px" radius="var(--radius-input)" />
                ))}
              </div>
            </div>
            <div className="space-y-5">
              <SkelText lines={2} width="80%" style={{ fontSize: "var(--text-display-md)" }} />
              <SkelText width="30%" style={{ fontSize: "1.6rem" }} />
              <SkelText lines={4} lineHeight={1.6} />
              <SkelBlock height="48px" width="220px" radius="var(--radius-pill)" />
              {/* The shipping / delivery / returns box, at the height its own
                  copy needs on this viewport, so nothing jumps when it lands. */}
              <BuyAssurancesSkeleton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-page)" }}>
        <div className="pt-[var(--nav-h,112px)]">
          <div className="max-w-xl mx-auto px-6 py-24 text-center space-y-4">
            <p className="text-4xl">🕯️</p>
            <h1 className="font-display" style={{ fontSize: "var(--text-display-sm)", color: "var(--text-primary)" }}>
              We couldn't find that candle
            </h1>
            <p className="font-sans text-sm" style={{ color: "var(--text-muted)" }}>
              It may have sold out or been renamed.
            </p>
            <Link
              to="/shop"
              className="inline-block mt-4 font-display text-sm font-semibold px-6 py-2.5"
              style={{ background: "var(--btn-dark-bg)", color: "var(--btn-dark-text)", borderRadius: "var(--radius-pill)" }}
            >
              Browse all candles →
            </Link>
          </div>
        </div>
        <FooterSection />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-page)" }}>
      <div className="pt-[var(--nav-h,112px)]">

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="max-w-6xl mx-auto px-6 pt-6">
          <ol className="flex items-center gap-2 font-sans text-xs" style={{ color: "var(--text-muted)" }}>
            <li><Link to="/" className="hover:underline">Home</Link></li>
            <li aria-hidden>/</li>
            <li><Link to="/shop" className="hover:underline">Shop</Link></li>
            <li aria-hidden>/</li>
            <li aria-current="page" style={{ color: "var(--text-primary)" }}>{product.name}</li>
          </ol>
        </nav>

        {/* Gallery + buy box */}
        <div className="max-w-6xl mx-auto px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14">
          <Gallery product={product} />

          <div>
            {product.tag && !outOfStock && (
              <span
                className="inline-block font-display text-xs font-semibold uppercase px-3 py-1 mb-3"
                style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)", borderRadius: "var(--radius-badge)", letterSpacing: "var(--tracking-eyebrow)" }}
              >
                {product.tag}
              </span>
            )}

            <h1
              className="font-display leading-tight mb-3"
              style={{ fontSize: "var(--text-display-md)", color: "var(--text-primary)" }}
            >
              {product.name}
            </h1>

            <p className="font-display font-semibold mb-1" style={{ fontSize: "1.6rem", color: "var(--text-primary)" }}>
              {formatPrice(product.price)}
            </p>
            <p className="font-sans text-xs mb-6" style={{ color: "var(--text-muted)" }}>
              Taxes included. <Link to="/shipping-policy" className="underline">Shipping</Link> calculated at checkout.
            </p>

            {/* Long-form copy — the shopper reads what the candle is before deciding */}
            {paragraphs.length > 0 && (
              <div className="space-y-4 mb-8">
                {paragraphs.map((text, i) => (
                  <p
                    key={i}
                    className="font-sans"
                    style={{ fontSize: "var(--text-body-md)", lineHeight: "var(--leading-relaxed)", color: "var(--text-muted)" }}
                  >
                    <RichText text={text} />
                  </p>
                ))}
              </div>
            )}

            {/* Quantity */}
            <p className="font-sans text-sm mb-2" style={{ color: "var(--text-primary)" }}>
              <RichText text={pageCopy.quantity_label} />
            </p>
            <QuantityStepper value={quantity} onChange={setQuantity} max={Math.max(maxQty, 1)} disabled={outOfStock} />

            {product.stock != null && !outOfStock && Number(product.stock) <= 5 && (
              <p className="font-sans text-xs mt-2" style={{ color: "#a45b32" }}>
                Only {product.stock} left — small batch.
              </p>
            )}

            {/* Buy button — same label signed in or out; the basket is the shopper's
                either way and only checkout needs an account. */}
            <AddToCartButton
              className="mt-5"
              size="lg"
              fullWidth
              onClick={handleAddToCart}
              disabled={outOfStock || adding}
              title={outOfStock ? "Out of stock" : undefined}
              label={outOfStock ? "Out of Stock" : adding ? "Adding…" : "Add to Cart"}
            />

            {/* What it costs to get here, when it lands, and how to send it back */}
            <BuyAssurances data={pageCopy.assurances} offer={offer} />

            {/* Bundle deal — pulled from Today's Deals */}
            {bundles.length > 0 && (
              <BundleDeal
                deals={bundles}
                label={pageCopy.bundle_label}
                onAdd={handleAddBundle}
                addingId={addingBundle}
              />
            )}
          </div>
        </div>

        {/* You may also like */}
        {recommendations.length > 0 && (
          <section className="max-w-6xl mx-auto px-6 pb-16 lg:pb-20">
            <h2
              className="font-display mb-6"
              style={{ fontSize: "var(--text-display-sm)", color: "var(--text-primary)" }}
            >
              <RichText text={pageCopy.recommendations_headline} />
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {recommendations.map(p => <RecommendationCard key={p.id} product={p} />)}
            </div>
          </section>
        )}
      </div>

      {pageCopy.circle.enabled && <CircleSignup data={pageCopy.circle} />}

      <FooterSection />
    </div>
  );
};

export default ProductDetailPage;
