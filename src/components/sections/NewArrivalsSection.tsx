import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useIsMobile from "@/hooks/useIsMobile";
import useSwipe from "@/hooks/useSwipe";
import { getShopCategories, getContent, type ShopCategory } from "@/lib/api";
import {
  DEFAULT_CONTENT,
  DEFAULT_PRODUCT_CARD_THEME,
  resolveCardAccent,
  type Product,
  type ProductCardTheme,
} from "@/lib/defaults";
import RichText from "@/lib/richtext";
import {
  CandleCard,
  PlaceholderCard,
  CANDLES_PER_VIEW,
  CANDLES_PER_VIEW_MOBILE,
  DEFAULT_SCRAPBOOK_SETTINGS,
  type ScrapbookSettings,
} from "@/components/sections/ScrapbookSection";

const NewArrivalsSection = () => {
  const [cat, setCat]               = useState<ShopCategory | null>(null);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [candleOffset, setCandleOffset] = useState(0);
  const [show, setShow]             = useState(true);
  const [cardTheme, setCardTheme]   = useState<ProductCardTheme>(DEFAULT_PRODUCT_CARD_THEME);

  useEffect(() => {
    Promise.all([
      getShopCategories(),
      getContent<ScrapbookSettings>("scrapbookSettings", DEFAULT_SCRAPBOOK_SETTINGS),
      getContent<{ label: string; headline: string; subtext: string; items: Product[] }>(
        "products",
        DEFAULT_CONTENT.products
      ),
      getContent<ProductCardTheme>("productCardTheme", DEFAULT_PRODUCT_CARD_THEME),
    ]).then(([cats, settings, productsData, theme]) => {
      const id = settings?.newArrivalsCategoryId;
      setShow(settings?.showNewArrivals ?? true);
      setCat(id ? (cats.find(c => c.id === id && c.is_active) ?? null) : null);
      setAllProducts(productsData?.items ?? []);
      if (theme) setCardTheme(theme);
    });
  }, []);

  const isMobile  = useIsMobile(); // must be above any early return
  const perView   = isMobile ? CANDLES_PER_VIEW_MOBILE : CANDLES_PER_VIEW;

  const resolveProducts = useCallback((category: ShopCategory): Product[] => {
    if (!category.product_ids?.length) return [];
    return category.product_ids
      .map(id => allProducts.find(p => p.id === id))
      .filter((p): p is Product => !!p);
  }, [allProducts]);

  // Everything the swipe handler needs is derived above the early return, so
  // the hooks below run on every render.
  const products  = useMemo(() => (cat ? resolveProducts(cat) : []), [cat, resolveProducts]);
  const maxOffset = Math.max(0, products.length - perView);

  // Rotating the phone changes how many cards fit; don't leave the window
  // parked past the end of the list.
  useEffect(() => { setCandleOffset(o => Math.min(o, maxOffset)); }, [maxOffset]);

  const swipe = useSwipe({
    onSwipeLeft:  () => setCandleOffset(o => Math.min(o + 1, maxOffset)),
    onSwipeRight: () => setCandleOffset(o => Math.max(o - 1, 0)),
    enabled: products.length > perView,
  });

  if (!show || !cat) return null;
  const isDark    = cat.bg_color.startsWith("#1") || cat.bg_color.startsWith("#17");
  // Cards use the global accent unless this category opted into its own.
  const cardAccent = resolveCardAccent(cardTheme, cat);
  const visible   = products.slice(candleOffset, candleOffset + perView);
  const canPrev   = candleOffset > 0;
  const canNext   = candleOffset < maxOffset;
  const dimText   = isDark ? "rgba(220,210,255,0.55)" : `${cat.text_color}88`;

  return (
    <section style={{
      background: "var(--color-cream-section)",
      padding: "clamp(44px,7vw,84px) 0",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Background grain */}
      <div style={{ position:"absolute", inset:0, backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E")`, pointerEvents:"none" }} />

      <div style={{ maxWidth:"min(96vw,1240px)", margin:"0 auto", padding:"0 clamp(14px,3.5vw,44px)", position:"relative", zIndex:1 }}>

        {/* ── One seamless card: name header + candle cards ── */}
        <motion.div
          initial={{ opacity:0, y:20 }}
          whileInView={{ opacity:1, y:0 }}
          viewport={{ once:true }}
          transition={{ duration:0.5 }}
          style={{ position:"relative" }}
        >
          {/* Page-stack depth layers */}
          <div style={{ position:"absolute", inset:0, borderRadius:"6px 20px 10px 16px / 16px 8px 20px 6px", background: cat.page_bg_color, transform:"rotate(1.6deg) translate(6px,-5px)", zIndex:0, opacity:0.65 }} />
          <div style={{ position:"absolute", inset:0, borderRadius:"10px 6px 18px 8px / 8px 18px 6px 14px", background: cat.bg_color, transform:"rotate(-1deg) translate(-5px,-2px)", zIndex:0, opacity:0.45 }} />

          {/* Main card — name area + cards in one shape */}
          <div style={{
            position:"relative", zIndex:1,
            background: cat.bg_color,
            borderRadius:"8px 22px 12px 18px / 18px 8px 22px 8px",
            boxShadow:`8px 12px 36px rgba(0,0,0,0.18), -4px -3px 14px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.4)`,
            transform:"rotate(-0.6deg)",
            overflow:"hidden",
          }}>
            {/* Paper grain */}
            <div style={{ position:"absolute", inset:0, backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`, pointerEvents:"none", zIndex:0 }} />

            {/* Tape strips */}
            <div style={{ position:"absolute", top:-13, left:"18%", width:64, height:24, background: isDark ? "rgba(160,140,100,0.45)" : "rgba(255,220,120,0.6)", borderRadius:3, transform:"rotate(-3deg)", boxShadow:"0 2px 5px rgba(0,0,0,0.1)", border:"1px solid rgba(255,255,255,0.35)", zIndex:10 }} />
            <div style={{ position:"absolute", top:-11, right:"22%", width:56, height:22, background: isDark ? "rgba(160,140,100,0.4)" : "rgba(200,230,180,0.65)", borderRadius:3, transform:"rotate(2.5deg)", boxShadow:"0 2px 5px rgba(0,0,0,0.1)", border:"1px solid rgba(255,255,255,0.35)", zIndex:10 }} />

            {/* ── Name / heading area ── */}
            <div style={{ padding:"clamp(28px,4vw,44px) clamp(20px,4vw,48px) clamp(18px,3vw,28px)", textAlign:"center", position:"relative", zIndex:2 }}>
              {/* Category stickers */}
              {(cat.stickers ?? []).slice(0,2).map((s,i) => (
                <motion.span key={i}
                  initial={{scale:0,opacity:0}} whileInView={{scale:1,opacity:1}} viewport={{once:true}}
                  transition={{delay:0.15+i*0.07, ease:"backOut"}}
                  style={{position:"absolute", top:s.top, left:s.left, fontSize:`${s.size*0.8}rem`, transform:`rotate(${s.rotate}deg)`, filter:"drop-shadow(0 2px 4px rgba(0,0,0,0.18))", userSelect:"none"}}>
                  {s.emoji}
                </motion.span>
              ))}

              {/* Category name */}
              <motion.h2
                initial={{opacity:0, scale:0.92}} whileInView={{opacity:1, scale:1}} viewport={{once:true}}
                transition={{delay:0.12, ease:"backOut", duration:0.45}}
                style={{fontFamily:"'Fredoka',sans-serif", fontSize:"clamp(1.8rem,4vw,3.4rem)", color:cat.accent_color, lineHeight:0.95, marginBottom:10}}>
                {cat.name}
              </motion.h2>

              {/* Wavy underline */}
              <motion.div initial={{scaleX:0}} whileInView={{scaleX:1}} viewport={{once:true}} transition={{delay:0.25, duration:0.45}}
                style={{transformOrigin:"center", display:"flex", justifyContent:"center", marginBottom:10}}>
                <svg width="120" height="12" viewBox="0 0 120 12">
                  <path d="M4 8 Q16 2 28 8 Q40 14 52 8 Q64 2 76 8 Q88 14 100 8 Q110 3 116 8" fill="none" stroke={cat.accent_color} strokeWidth="2.2" strokeLinecap="round" opacity="0.7"/>
                </svg>
              </motion.div>

              {/* Mood description */}
              {cat.mood_description && (
                <motion.p initial={{opacity:0}} whileInView={{opacity:1}} viewport={{once:true}} transition={{delay:0.2}}
                  style={{fontFamily:"'Permanent Marker',cursive", fontSize:"clamp(0.6rem,0.92vw,0.75rem)", color:dimText, marginBottom:14, transform:"rotate(-1deg)"}}>
                  <RichText text={cat.mood_description} />
                </motion.p>
              )}

              {/* Tags centered */}
              <motion.div initial={{opacity:0}} whileInView={{opacity:1}} viewport={{once:true}} transition={{delay:0.28}}
                style={{display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center"}}>
                {(cat.tags ?? []).map(tag => (
                  <span key={tag} style={{fontFamily:"'Fredoka',sans-serif", fontSize:"clamp(0.6rem,0.9vw,0.72rem)", background: isDark ? "rgba(255,255,255,0.12)" : `${cat.accent_color}1a`, color:cat.accent_color, border:`1px solid ${cat.accent_color}45`, borderRadius:20, padding:"3px 10px", fontWeight:500}}>
                    {tag}
                  </span>
                ))}
              </motion.div>
            </div>

            {/* ── Divider between name and cards ── */}
            <div style={{ margin:"0 clamp(20px,4vw,48px)", height:1, background: isDark ? "rgba(255,255,255,0.08)" : `${cat.accent_color}20`, position:"relative", zIndex:2 }} />

            {/* ── Candle cards area ── */}
            <div style={{ background: cat.page_bg_color, padding:"clamp(16px,2.5vw,28px)", position:"relative", zIndex:2 }}>
              {/* Row header + nav */}
              <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"clamp(10px,1.6vw,16px)"}}>
                <p style={{fontFamily:"'Permanent Marker',cursive", fontSize:"clamp(0.58rem,0.9vw,0.7rem)", color: isDark ? "rgba(220,210,255,0.45)" : `${cat.text_color}55`, transform:"rotate(-1deg)"}}>
                  {products.length === 0
                    ? "no products added yet"
                    : products.length > perView
                      ? `${candleOffset+1}–${Math.min(candleOffset+perView, products.length)} of ${products.length}`
                      : `${products.length} product${products.length !== 1 ? "s" : ""}`}
                </p>
                <div style={{display:"flex", alignItems:"center", gap:10}}>
                  {products.length > perView && (
                    <div style={{display:"flex", gap:6}}>
                      {[{dir:-1, active:canPrev, label:"←"},{dir:1, active:canNext, label:"→"}].map(({dir, active, label}) => (
                        <motion.button key={label}
                          onClick={() => { if (active) setCandleOffset(candleOffset + dir); }}
                          whileHover={active ? {scale:1.12} : {}} whileTap={active ? {scale:0.9} : {}}
                          style={{width:40, height:40, borderRadius:"50%", border:`1.5px solid ${active ? cat.accent_color : cat.accent_color+"40"}`, background: active ? `${cat.accent_color}18` : "transparent", color: active ? cat.accent_color : cat.accent_color+"40", cursor: active ? "pointer" : "default", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1rem", fontWeight:600}}>
                          {label}
                        </motion.button>
                      ))}
                    </div>
                  )}
                  <a href={`/shop?category=${cat.slug}`}
                    style={{display:"inline-flex", alignItems:"center", minHeight:40, padding:"0 4px", fontFamily:"'Fredoka',sans-serif", fontSize:"clamp(0.82rem,1.2vw,0.95rem)", color:cat.accent_color, textDecoration:"none", opacity:0.8}}>
                    Shop All →
                  </a>
                </div>
              </div>

              {/* Cards — swipeable; the arrows above are the pointer equivalent */}
              <div
                {...swipe}
                style={{display:"flex", gap:"clamp(8px,1.4vw,14px)", alignItems:"stretch", ...swipe.style}}
              >
                {products.length === 0 ? (
                  <>
                    {["add products via\nAdmin → Shop By Category", "they'll appear\nhere automatically", "assign products\nto this category"]
                      .slice(0, perView)
                      .map(label => (
                        <PlaceholderCard key={label} accent={cat.accent_color} isDark={isDark} label={label} />
                      ))}
                  </>
                ) : (
                  <AnimatePresence mode="sync">
                    {visible.map((p,i) => (
                      <CandleCard key={p.id} product={p} accent={cardAccent} isDark={isDark} idx={candleOffset+i} buttonTextColor={cardTheme.buttonTextColor} />
                    ))}
                    {Array.from({length: perView - visible.length}).map((_,i) => (
                      <div key={`spacer-${i}`} style={{flex:"1 1 0", minWidth:0}} />
                    ))}
                  </AnimatePresence>
                )}
              </div>

              {/* Dots — the dot stays 6px tall, but the button around it carries
                  transparent padding so a fingertip can actually land on it */}
              {products.length > perView && (
                <div style={{display:"flex", justifyContent:"center", alignItems:"center", marginTop:6}}>
                  {Array.from({length: maxOffset+1}).map((_,i) => (
                    <button key={i} onClick={() => setCandleOffset(i)}
                      aria-label={`Show candle ${i+1} of ${maxOffset+1}`}
                      aria-current={i===candleOffset}
                      style={{border:"none", background:"none", cursor:"pointer", padding:"10px 3px", display:"flex", alignItems:"center"}}>
                      <motion.span
                        animate={{width: i===candleOffset ? 18 : 6, background: i===candleOffset ? cat.accent_color : `${cat.accent_color}45`}}
                        style={{height:6, borderRadius:3, display:"block", width: i===candleOffset ? 18 : 6, background: i===candleOffset ? cat.accent_color : `${cat.accent_color}45`}}
                        transition={{duration:0.25}} />
                    </button>
                  ))}
                </div>
              )}

              {/* Watermark */}
              <div style={{position:"absolute", bottom:"4%", right:"3%", fontFamily:"'Permanent Marker',cursive", fontSize:"clamp(0.48rem,0.72vw,0.58rem)", color: isDark ? "rgba(255,255,255,0.05)" : `${cat.accent_color}18`, transform:"rotate(-3deg)", pointerEvents:"none", userSelect:"none", lineHeight:2}}>
                {cat.name} · handmade · small batch ·
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default NewArrivalsSection;
