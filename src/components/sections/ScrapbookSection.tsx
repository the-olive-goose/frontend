import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useIsMobile from "@/hooks/useIsMobile";
import useSwipe from "@/hooks/useSwipe";
import { getShopCategories, type ShopCategory } from "@/lib/api";
import {
  DEFAULT_CONTENT,
  DEFAULT_PRODUCT_CARD_THEME,
  resolveCardAccent,
  type Product,
  type ProductCardTheme,
} from "@/lib/defaults";
import RichText from "@/lib/richtext";
import ProductCard from "@/components/ui/ProductCard";
import { ProductListScope } from "@/components/ProductListScope";
import { SkelBlock } from "@/components/ui/ContentSkeleton";
import { useContent } from "@/hooks/useContent";

export interface ScrapbookSettings {
  flipDuration: number;
  autoFlipInterval: number;
  newArrivalsCategoryId: string;
  showNewArrivals: boolean;
  showShopByCategory: boolean;
}
export const DEFAULT_SCRAPBOOK_SETTINGS: ScrapbookSettings = {
  flipDuration: 0.76,
  autoFlipInterval: 5000,
  newArrivalsCategoryId: "",
  showNewArrivals: true,
  showShopByCategory: true,
};

// ── Candle card ────────────────────────────────────────────────────────────────
// Thin wrapper over the shared <ProductCard>, in the compact density used inside
// the scrapbook / featured-category strips. `accent` is already resolved by the
// caller (global theme accent, or a category's own accent when opted in), so the
// card looks identical to the shop grid apart from its tighter spacing.

export const CandleCard = ({ product, accent, isDark, idx, buttonTextColor }: {
  product: Product; accent: string; isDark: boolean; idx: number; buttonTextColor?: string;
}) => (
  <ProductCard product={product} idx={idx} accent={accent} isDark={isDark} density="compact" buttonTextColor={buttonTextColor} />
);

// ── Placeholder card (when category has no products assigned yet) ──────────────

export const PlaceholderCard = ({ accent, isDark, label }: { accent: string; isDark: boolean; label: string }) => (
  <div style={{ flex: "1 1 0", minWidth: 0, background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.5)", border: `1.5px dashed ${accent}40`, borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 20, opacity: 0.65 }}>
    <span style={{ fontSize: "1.8rem" }}>🕯️</span>
    <p style={{ fontFamily: "'Permanent Marker',cursive", fontSize: "0.68rem", color: isDark ? "rgba(220,210,255,0.5)" : `${accent}80`, textAlign: "center", lineHeight: 1.4 }}>{label}</p>
  </div>
);

// ── Cover page ─────────────────────────────────────────────────────────────────

const CoverPage = ({ totalCategories, onFlip }: { totalCategories: number; onFlip?: () => void }) => (
  <div style={{ width:"100%", height:"100%", background:"#f0e8d6", position:"relative", overflow:"hidden", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
    {/* Paper grain */}
    <div style={{ position:"absolute", inset:0, backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`, pointerEvents:"none" }} />

    {/* Corner stickers — same as New Arrivals card */}
    {[{e:"🕯️",t:"5%",l:"4%",r:-12,s:1.6},{e:"✨",t:"5%",l:"88%",r:14,s:1.3},{e:"🌿",t:"87%",l:"88%",r:-10,s:1.4},{e:"☕",t:"87%",l:"4%",r:8,s:1.4}].map((s,i) => (
      <motion.span key={i} initial={{scale:0,opacity:0}} animate={{scale:1,opacity:1}} transition={{delay:0.1+i*0.07,ease:"backOut",duration:0.45}}
        style={{position:"absolute",top:s.t,left:s.l,fontSize:`${s.s}rem`,transform:`rotate(${s.r}deg)`,zIndex:3,filter:"drop-shadow(0 2px 5px rgba(0,0,0,0.18))",userSelect:"none"}}>
        {s.e}
      </motion.span>
    ))}

    {/* Tape at top — same as New Arrivals card */}
    <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%) rotate(-2deg)",width:72,height:26,background:"rgba(255,220,120,0.6)",borderRadius:"0 0 3px 3px",boxShadow:"0 2px 6px rgba(0,0,0,0.12)",border:"1px solid rgba(255,255,255,0.4)",zIndex:10}} />

    <div style={{position:"relative",zIndex:10,textAlign:"center",padding:"0 8%"}}>
      {/* Heading — identical font/size to New Arrivals cat.name */}
      <motion.h2 initial={{opacity:0,scale:0.92}} animate={{opacity:1,scale:1}} transition={{delay:0.18,ease:"backOut",duration:0.45}}
        style={{fontFamily:"'Fredoka',sans-serif",fontSize:"clamp(1.8rem,4vw,3.4rem)",color:"#6b3520",lineHeight:0.95,marginBottom:10}}>
        Shop By Category
      </motion.h2>

      {/* Wavy underline — identical to New Arrivals */}
      <motion.div initial={{scaleX:0}} animate={{scaleX:1}} transition={{delay:0.28,duration:0.45}}
        style={{transformOrigin:"center",display:"flex",justifyContent:"center",marginBottom:12}}>
        <svg width="120" height="12" viewBox="0 0 120 12">
          <path d="M4 8 Q16 2 28 8 Q40 14 52 8 Q64 2 76 8 Q88 14 100 8 Q110 3 116 8" fill="none" stroke="#6b3520" strokeWidth="2.2" strokeLinecap="round" opacity="0.7"/>
        </svg>
      </motion.div>

      {/* Mood line — identical Permanent Marker style to New Arrivals mood_description */}
      <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.22}}
        style={{fontFamily:"'Permanent Marker',cursive",fontSize:"clamp(0.6rem,0.92vw,0.75rem)",color:"rgba(30,41,24,0.55)",marginBottom:14,transform:"rotate(-1deg)"}}>
        {totalCategories} mood{totalCategories!==1?"s":""} · handmade · all vibes welcome
      </motion.p>

      {/* Tags — identical pill style to New Arrivals */}
      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.3}}
        style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginBottom:22}}>
        {["#handmade","#smallbatch","#moodcandles"].map(tag=>(
          <span key={tag} style={{fontFamily:"'Fredoka',sans-serif",fontSize:"clamp(0.6rem,0.9vw,0.72rem)",background:"rgba(107,53,32,0.1)",color:"#6b3520",border:"1px solid rgba(107,53,32,0.28)",borderRadius:20,padding:"3px 10px",fontWeight:500}}>
            {tag}
          </span>
        ))}
      </motion.div>

      {/* CTA — styled like New Arrivals "Shop All →" */}
      <motion.button onClick={onFlip} whileHover={{scale:1.06}} whileTap={{scale:0.95}}
        initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.38,ease:"backOut"}}
        style={{fontFamily:"'Fredoka',sans-serif",fontSize:"clamp(0.88rem,1.4vw,1.08rem)",background:"#6b3520",color:"#fff",borderRadius:50,padding:"8px 22px",border:"none",cursor:"pointer",boxShadow:"0 4px 16px rgba(107,53,32,0.44)"}}>
        flip the page →
      </motion.button>
    </div>

    {/* Watermark — same as category pages */}
    <div style={{position:"absolute",bottom:"4%",right:"3%",fontFamily:"'Permanent Marker',cursive",fontSize:"clamp(0.48rem,0.72vw,0.58rem)",color:"rgba(107,53,32,0.12)",transform:"rotate(-3deg)",pointerEvents:"none",userSelect:"none",lineHeight:2}}>
      handmade · small batch · crafted for you
    </div>
  </div>
);

// ── Category page ──────────────────────────────────────────────────────────────

export const CANDLES_PER_VIEW = 3;
/** Phones show two candles at once — one per screen made the row feel empty and
 *  hid the rest of the collection behind a swipe. */
export const CANDLES_PER_VIEW_MOBILE = 2;

export const CategoryPage = ({ cat, products, candleOffset, setCandleOffset, interactive, cardTheme }: {
  cat: ShopCategory;
  products: Product[];
  candleOffset: number;
  setCandleOffset: (n: number) => void;
  interactive: boolean;
  cardTheme?: ProductCardTheme;
}) => {
  const isMobile  = useIsMobile();
  const perView   = isMobile ? CANDLES_PER_VIEW_MOBILE : CANDLES_PER_VIEW;
  const isDark    = cat.bg_color.startsWith("#1") || cat.bg_color.startsWith("#17");
  // Product cards use the global accent by default; the category tints them only
  // when it has been opted into `categoriesUsingOwnAccent`. The category's own
  // chrome (heading, tags, arrows, Shop-All button) always keeps its accent_color.
  const cardAccent = cardTheme ? resolveCardAccent(cardTheme, cat) : cat.accent_color;
  const maxOffset = Math.max(0, products.length - perView);
  const visible   = products.slice(candleOffset, candleOffset + perView);
  const canPrev   = candleOffset > 0;
  const canNext   = candleOffset < maxOffset;
  const dimText   = isDark ? "rgba(220,210,255,0.55)" : `${cat.text_color}88`;

  // Swiping the cards steps through this category's candles. At either end the
  // gesture is declined so it falls through to the book and turns the page —
  // one continuous swipe carries you from the last candle here to the next
  // category.
  const cardSwipe = useSwipe({
    onSwipeLeft:  () => { if (!canNext) return false; setCandleOffset(candleOffset + 1); },
    onSwipeRight: () => { if (!canPrev) return false; setCandleOffset(candleOffset - 1); },
    enabled: interactive && products.length > perView,
  });

  return (
    <div style={{ width:"100%", height:"100%", background:cat.bg_color, position:"relative", overflow:"hidden", display:"flex", flexDirection: isMobile ? "column" : "row" }}>
      {/* Paper grain */}
      <div style={{ position:"absolute", inset:0, backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E")`, pointerEvents:"none", zIndex:1 }} />

      {/* Stickers — desktop only */}
      {!isMobile && (cat.stickers || []).map((s, i) => (
        <motion.span key={i} initial={{ scale:0.6, opacity:0 }} animate={{ scale:1, opacity:1 }} transition={{ delay:0.06+i*0.06, ease:"backOut", duration:0.4 }}
          style={{ position:"absolute", top:s.top, left:s.left, fontSize:`${s.size}rem`, transform:`rotate(${s.rotate}deg)`, zIndex:3, pointerEvents:"none", filter:"drop-shadow(0 2px 5px rgba(0,0,0,0.18))", userSelect:"none" }}>
          {s.emoji}
        </motion.span>
      ))}

      {/* LEFT PANEL — full width compact strip on mobile, sidebar on desktop */}
      <div style={{
        width: isMobile ? "100%" : "26%",
        minWidth: isMobile ? 0 : 150,
        padding: isMobile ? "10px 14px 8px" : "clamp(14px,2.5vw,28px) clamp(12px,2vw,22px)",
        display:"flex",
        flexDirection: isMobile ? "row" : "column",
        alignItems: isMobile ? "center" : undefined,
        justifyContent: isMobile ? "space-between" : "center",
        flexShrink: 0,
        position:"relative", zIndex:10,
        borderRight: isMobile ? "none" : `1.5px solid ${isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}`,
        borderBottom: isMobile ? `1.5px solid ${isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}` : "none",
        gap: isMobile ? 8 : 0,
      }}>
        {/* Name + tags row on mobile */}
        <div style={{ display:"flex", flexDirection: isMobile ? "column" : "column", flex: isMobile ? 1 : undefined, minWidth:0 }}>
          <motion.h2 initial={{ x:-20, opacity:0 }} animate={{ x:0, opacity:1 }} transition={{ delay:0.1, duration:0.45 }}
            style={{ fontFamily:"'Fredoka',sans-serif", fontSize: isMobile ? "1.1rem" : "clamp(1.2rem,2.4vw,2.2rem)", lineHeight:1, color:cat.accent_color, marginBottom: isMobile ? 4 : 10 }}>
            {cat.name}
          </motion.h2>
          {!isMobile && <>
            <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.2 }}
              style={{ fontFamily:"'Permanent Marker',cursive", fontSize:"clamp(0.6rem,0.95vw,0.78rem)", color:dimText, marginBottom:14, transform:"rotate(-1.5deg)", transformOrigin:"left" }}>
              <RichText text={cat.mood_description} />
            </motion.p>
            <motion.div initial={{ scaleX:0 }} animate={{ scaleX:1 }} transition={{ delay:0.25, duration:0.4 }} style={{ transformOrigin:"left", marginBottom:14 }}>
              <svg width="65" height="11" viewBox="0 0 65 11"><path d="M2 7 Q10 2 18 7 Q26 12 34 7 Q42 2 50 7 Q57 12 63 7" fill="none" stroke={cat.accent_color} strokeWidth="2" strokeLinecap="round"/></svg>
            </motion.div>
          </>}
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.28 }}
            style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom: isMobile ? 0 : 22 }}>
            {(cat.tags || []).map(tag => (
              <span key={tag} style={{ fontFamily:"'Fredoka',sans-serif", fontSize: isMobile ? "0.6rem" : "clamp(0.55rem,0.88vw,0.7rem)", background: isDark ? "rgba(255,255,255,0.1)" : `${cat.accent_color}18`, color:cat.accent_color, border:`1px solid ${cat.accent_color}40`, borderRadius:20, padding:"2px 7px", fontWeight:500 }}>
                {tag}
              </span>
            ))}
          </motion.div>
        </div>
        {!isMobile && products.length > 0 && (
          <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.32 }}
            style={{ fontFamily:"'Inter',sans-serif", fontSize:"clamp(0.58rem,0.88vw,0.7rem)", color:dimText, marginBottom:16 }}>
            {products.length} product{products.length !== 1 ? "s" : ""} in this collection
          </motion.p>
        )}
        <motion.a href={`/shop?category=${cat.slug}`} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.36, ease:"backOut" }}
          whileHover={{ scale:1.06, transition:{ duration:0.18 } }} whileTap={{ scale:0.95 }}
          style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", minHeight:40, gap:6, fontFamily:"'Fredoka',sans-serif", fontSize: isMobile ? "0.82rem" : "clamp(0.88rem,1.4vw,1.08rem)", background:cat.accent_color, color: isDark ? "#0a0a18" : "#fff", borderRadius:50, padding: isMobile ? "6px 16px" : "9px 20px", alignSelf:"flex-start", textDecoration:"none", boxShadow:`0 4px 16px ${cat.accent_color}44`, transform: isMobile ? "none" : "rotate(-2deg)", transformOrigin:"left center", whiteSpace:"nowrap", flexShrink:0 }}>
          Shop All →
        </motion.a>
      </div>

      {/* RIGHT PANEL */}
      <div style={{ flex:1, background:cat.page_bg_color, position:"relative", display:"flex", flexDirection:"column", padding:"clamp(10px,2vw,26px) clamp(10px,2vw,22px)", overflow:"hidden", zIndex:10 }}>
        {/* Row header + nav arrows */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"clamp(8px,1.2vw,16px)", flexShrink:0 }}>
          <p style={{ fontFamily:"'Permanent Marker',cursive", fontSize:"clamp(0.55rem,0.9vw,0.7rem)", color: isDark ? "rgba(220,210,255,0.45)" : `${cat.text_color}55`, transform:"rotate(-1deg)" }}>
            {products.length === 0
              ? "no products added yet"
              : products.length > perView
                ? `${candleOffset+1}–${Math.min(candleOffset+perView, products.length)} of ${products.length}`
                : `${products.length} product${products.length !== 1 ? "s" : ""}`}
          </p>
          {products.length > perView && (
            <div style={{ display:"flex", gap:6 }}>
              {[{ dir:-1, active:canPrev, label:"←" }, { dir:1, active:canNext, label:"→" }].map(({ dir, active, label }) => (
                <motion.button key={label}
                  onClick={e => { e.stopPropagation(); if (interactive && active) setCandleOffset(candleOffset + dir); }}
                  whileHover={active ? { scale:1.12 } : {}}
                  whileTap={active ? { scale:0.9 } : {}}
                  style={{ width:40, height:40, borderRadius:"50%", border:`1.5px solid ${active ? cat.accent_color : cat.accent_color+"40"}`, background: active ? `${cat.accent_color}18` : "transparent", color: active ? cat.accent_color : cat.accent_color+"40", cursor: active ? "pointer" : "default", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1rem", fontWeight:600 }}>
                  {label}
                </motion.button>
              ))}
            </div>
          )}
        </div>

        {/* Cards row.
            `visible` and not `products`: this is a carousel, and only the cards
            in the current window were ever on screen. Reporting the whole
            category would credit impressions to candles nobody swiped to.
            Swiping reports the new window, which is a real impression. The ref
            goes on the row itself — it is the element that has to be on screen
            for these cards to count as seen. */}
        <ProductListScope id={`category_${cat.slug}`} name={cat.name} products={visible}>
          {(listRef) => (
            <div
              {...cardSwipe}
              ref={listRef}
              style={{ flex:1, display:"flex", gap:"clamp(6px,1.4vw,14px)", alignItems:"stretch", minHeight:0, ...cardSwipe.style }}
            >
              {products.length === 0 ? (
                <>
                  {["add products via\nAdmin → Shop By Category", "they'll appear\nhere automatically"]
                    .slice(0, perView)
                    .map(label => (
                      <PlaceholderCard key={label} accent={cat.accent_color} isDark={isDark} label={label} />
                    ))}
                </>
              ) : (
                <AnimatePresence mode="sync">
                  {visible.map((p, i) => (
                    <CandleCard key={p.id} product={p} accent={cardAccent} isDark={isDark} idx={candleOffset + i} buttonTextColor={cardTheme?.buttonTextColor} />
                  ))}
                  {Array.from({ length: perView - visible.length }).map((_, i) => (
                    <div key={`spacer-${i}`} style={{ flex:"1 1 0", minWidth:0 }} />
                  ))}
                </AnimatePresence>
              )}
            </div>
          )}
        </ProductListScope>

        {/* Dots — small dot, finger-sized button around it */}
        {products.length > perView && (
          <div style={{ display:"flex", justifyContent:"center", alignItems:"center", marginTop:4, flexShrink:0 }}>
            {Array.from({ length: maxOffset+1 }).map((_, i) => (
              <button key={i} onClick={e => { e.stopPropagation(); if (interactive) setCandleOffset(i); }}
                aria-label={`Show candle ${i+1} of ${maxOffset+1}`}
                aria-current={i===candleOffset}
                style={{ border:"none", background:"none", cursor:"pointer", padding:"9px 3px", display:"flex", alignItems:"center" }}>
                <motion.span
                  animate={{ width: i===candleOffset ? 18 : 6, background: i===candleOffset ? cat.accent_color : `${cat.accent_color}45` }}
                  style={{ height:6, borderRadius:3, display:"block", width: i===candleOffset ? 18 : 6, background: i===candleOffset ? cat.accent_color : `${cat.accent_color}45` }}
                  transition={{ duration:0.25 }} />
              </button>
            ))}
          </div>
        )}

        {/* Watermark */}
        <div style={{ position:"absolute", bottom:"4%", right:"3%", fontFamily:"'Permanent Marker',cursive", fontSize:"clamp(0.48rem,0.75vw,0.6rem)", color: isDark ? "rgba(255,255,255,0.05)" : `${cat.accent_color}18`, transform:"rotate(-3deg)", pointerEvents:"none", userSelect:"none", lineHeight:2 }}>
          {cat.name} · handmade · small batch ·
        </div>
      </div>
    </div>
  );
};

// ── Main ScrapbookSection ──────────────────────────────────────────────────────

const ScrapbookSection = () => {
  const isMobile = useIsMobile();
  // `null` = not loaded yet. This used to start as six invented categories
  // ("Coffee Shop Chaos", "Matcha Therapy"…) with no products, so the book
  // opened on placeholder tiles for made-up categories before the real ones
  // arrived. An empty array now means genuinely no categories.
  const [categories, setCategories]   = useState<ShopCategory[] | null>(null);
  const products  = useContent("products", DEFAULT_CONTENT.products);
  const settingsC = useContent("scrapbookSettings", DEFAULT_SCRAPBOOK_SETTINGS);
  const themeC    = useContent<ProductCardTheme>("productCardTheme", DEFAULT_PRODUCT_CARD_THEME);
  const allProducts = products.data?.items ?? [];
  const settings    = settingsC.data;
  const cardTheme   = themeC.data;
  const ready = categories !== null && products.ready && settingsC.ready && themeC.ready;

  // page: 0=cover, 1..N=categories
  const [currentPage, setCurrentPage]   = useState(0);
  const [incomingPage, setIncomingPage] = useState<number | null>(null);
  const [isFlipping, setIsFlipping]     = useState(false);
  const [flipEndAngle, setFlipEndAngle] = useState(-180);
  const [flipOrigin, setFlipOrigin]     = useState("0% 50%");
  const [candleOffsets, setCandleOffsets] = useState<Record<number, number>>({});
  // Auto-flip runs until the visitor manually navigates; then it stops for the
  // rest of the session (reset on page refresh).
  const [autoPlay, setAutoPlay] = useState(true);
  const flipLock = useRef(false);

  const cats = categories ?? [];
  const totalPages = cats.length + 1;

  useEffect(() => {
    getShopCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  // Resolve product_ids → actual Product objects for a category
  const resolveProducts = useCallback((cat: ShopCategory): Product[] => {
    if (!cat.product_ids || cat.product_ids.length === 0) return [];
    return cat.product_ids
      .map(id => allProducts.find(p => p.id === id))
      .filter((p): p is Product => !!p);
  }, [allProducts]);

  const candleOffset = candleOffsets[currentPage] ?? 0;
  const setCandleOffset = useCallback((n: number) => {
    setCandleOffsets(prev => ({ ...prev, [currentPage]: n }));
  }, [currentPage]);

  const flipTo = useCallback((target: number, dir: 1 | -1) => {
    if (flipLock.current) return;
    const t = ((target % totalPages) + totalPages) % totalPages;
    if (t === currentPage) return;
    flipLock.current = true;
    setFlipOrigin(dir > 0 ? "0% 50%" : "100% 50%");
    setFlipEndAngle(dir > 0 ? -180 : 180);
    setIncomingPage(t);
    setIsFlipping(true);
  }, [currentPage, totalPages]);

  const flipNext = useCallback(() => flipTo((currentPage + 1) % totalPages, 1), [currentPage, totalPages, flipTo]);
  const flipPrev = useCallback(() => flipTo((currentPage - 1 + totalPages) % totalPages, -1), [currentPage, totalPages, flipTo]);

  // Manual navigation — permanently stops auto-flip for this session.
  const manualNext = useCallback(() => { setAutoPlay(false); flipNext(); }, [flipNext]);
  const manualPrev = useCallback(() => { setAutoPlay(false); flipPrev(); }, [flipPrev]);
  const manualTo   = useCallback((t: number, dir: 1 | -1) => { setAutoPlay(false); flipTo(t, dir); }, [flipTo]);

  // Swiping across the book turns its pages, the way the arrows and the corner
  // curl do. A swipe that started on the candle row is handled there first and
  // only reaches this when that row has nowhere left to go.
  const bookSwipe = useSwipe({
    onSwipeLeft:  manualNext,
    onSwipeRight: manualPrev,
  });

  const onFlipDone = useCallback(() => {
    if (!flipLock.current || incomingPage === null) return;
    setCurrentPage(incomingPage);
    setIncomingPage(null);
    setIsFlipping(false);
    flipLock.current = false;
  }, [incomingPage]);

  // Auto-advance the book on its own, until the visitor takes manual control.
  // The timer resets after every auto-flip (flipNext changes with currentPage).
  useEffect(() => {
    if (!autoPlay) return;
    const id = setInterval(flipNext, settings.autoFlipInterval);
    return () => clearInterval(id);
  }, [autoPlay, flipNext, settings.autoFlipInterval]);

  const renderPage = (pageIdx: number, live = false) => {
    if (pageIdx === 0) return <CoverPage totalCategories={cats.length} onFlip={live ? manualNext : undefined} />;
    const cat = cats[pageIdx - 1];
    if (!cat) return null;
    const products = resolveProducts(cat);
    const offset = live ? (candleOffsets[pageIdx] ?? 0) : 0;
    return (
      <CategoryPage
        cat={cat}
        products={products}
        candleOffset={offset}
        setCandleOffset={live ? (n => setCandleOffsets(prev => ({ ...prev, [pageIdx]: n }))) : () => {}}
        interactive={live}
        cardTheme={cardTheme}
      />
    );
  };

  // The book keeps its footprint while the real categories are in flight, so the
  // homepage doesn't shuffle when they land.
  if (!ready) {
    return (
      <section
        id="shop-by-category"
        style={{ background:"var(--color-cream-section)", padding:"clamp(44px,7vw,84px) 0", color:"var(--text-primary)" }}
      >
        <div style={{ maxWidth:"min(96vw,1240px)", margin:"0 auto", padding:"0 clamp(14px,3.5vw,44px)" }}>
          <SkelBlock height="clamp(400px,62vw,620px)" radius="clamp(8px,1.6vw,18px)" />
        </div>
      </section>
    );
  }

  if (!settings.showShopByCategory) return null;

  return (
    <section
      id="shop-by-category"
      style={{ background:"var(--color-cream-section)", padding:"clamp(44px,7vw,84px) 0" }}
    >
      {/* Book */}
      <div style={{ maxWidth:"min(96vw,1240px)", margin:"0 auto", padding:"0 clamp(14px,3.5vw,44px)", position:"relative" }}>

        <motion.button onClick={manualPrev} whileHover={{ scale:1.12 }} whileTap={{ scale:0.9 }} aria-label="Previous page"
          style={{ position:"absolute", left:-4, top:"48%", transform:"translateY(-50%)", zIndex:30, background:"rgba(255,255,255,0.92)", border:"1.5px solid rgba(0,0,0,0.1)", borderRadius:"50%", width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", backdropFilter:"blur(8px)", boxShadow:"0 4px 14px rgba(0,0,0,0.1)", fontSize:"1rem", color:"var(--color-forest-dark)" }}>←</motion.button>

        {/* Book with page-stack depth */}
        <div style={{ position:"relative" }}>
          <div style={{ position:"absolute", inset:0, borderRadius:"clamp(10px,1.6vw,18px)", background:"#e8dcc8", transform:"translateX(3px) translateY(-2px)", zIndex:0 }} />
          <div style={{ position:"absolute", inset:0, borderRadius:"clamp(10px,1.6vw,18px)", background:"#f0e4cc", transform:"translateX(6px) translateY(-4px)", zIndex:-1 }} />

          <div
            {...bookSwipe}
            style={{ height:"clamp(400px,62vw,620px)", borderRadius:"clamp(8px,1.6vw,18px)", overflow:"hidden", boxShadow:"0 24px 70px rgba(0,0,0,0.2),0 8px 20px rgba(0,0,0,0.1)", position:"relative", zIndex:1, ...bookSwipe.style }}
          >
            <div style={{ position:"absolute", inset:0, perspective:"2200px" }}>

              {/* Incoming page (sits behind) */}
              <div style={{ position:"absolute", inset:0, zIndex:1, borderRadius:"inherit", overflow:"hidden" }}>
                {incomingPage !== null && renderPage(incomingPage, false)}
              </div>

              {/* Flipping layer */}
              <motion.div
                animate={{ rotateY: isFlipping ? flipEndAngle : 0 }}
                transition={isFlipping ? { duration:settings.flipDuration, ease:[0.65,0,0.35,1] } : { duration:0, type:"tween" }}
                onAnimationComplete={() => { if (flipLock.current && incomingPage !== null) onFlipDone(); }}
                style={{ position:"absolute", inset:0, zIndex:2, transformStyle:"preserve-3d", transformOrigin:flipOrigin, willChange:"transform", borderRadius:"inherit" }}
              >
                {/* Front */}
                <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden", overflow:"hidden", borderRadius:"inherit" }}>
                  {renderPage(currentPage, true)}
                  {isFlipping && (
                    <motion.div initial={{ opacity:0 }} animate={{ opacity:[0,0.35,0] }} transition={{ duration:settings.flipDuration }}
                      style={{ position:"absolute", inset:0, pointerEvents:"none", zIndex:20, background: flipEndAngle < 0 ? "linear-gradient(to right,transparent 50%,rgba(0,0,0,0.28) 100%)" : "linear-gradient(to left,transparent 50%,rgba(0,0,0,0.28) 100%)" }} />
                  )}
                </div>
                {/* Back */}
                <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden", transform:"rotateY(180deg)", overflow:"hidden", borderRadius:"inherit" }}>
                  {incomingPage !== null && renderPage(incomingPage, false)}
                </div>
              </motion.div>

              {/* Spine — aligns with the 26% sidebar on desktop; hidden on mobile
                  where the page uses a top-strip column layout (no vertical crease) */}
              {!isMobile && (
                <div style={{ position:"absolute", left:"26%", top:0, bottom:0, width:4, background:"linear-gradient(to right,rgba(0,0,0,0.14),rgba(0,0,0,0.04),transparent)", zIndex:15, pointerEvents:"none" }} />
              )}
            </div>

            {/* Page-curl corner hint */}
            {!isFlipping && (
              <motion.div onClick={manualNext} animate={{ opacity:[0.35,0.65,0.35] }} transition={{ repeat:Infinity, duration:2.4 }}
                style={{ position:"absolute", bottom:10, right:12, zIndex:25, cursor:"pointer", width:26, height:26 }}>
                <svg viewBox="0 0 26 26" fill="none"><path d="M26 26 Q17 21 21 11 Q24 3 26 0" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" fill="rgba(255,255,255,0.45)"/></svg>
              </motion.div>
            )}
          </div>
        </div>

        <motion.button onClick={manualNext} whileHover={{ scale:1.12 }} whileTap={{ scale:0.9 }} aria-label="Next page"
          style={{ position:"absolute", right:-4, top:"48%", transform:"translateY(-50%)", zIndex:30, background:"rgba(255,255,255,0.92)", border:"1.5px solid rgba(0,0,0,0.1)", borderRadius:"50%", width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", backdropFilter:"blur(8px)", boxShadow:"0 4px 14px rgba(0,0,0,0.1)", fontSize:"1rem", color:"var(--color-forest-dark)" }}>→</motion.button>

        {/* Dots — small dot, finger-sized button around it */}
        <div style={{ display:"flex", justifyContent:"center", alignItems:"center", marginTop:12 }}>
          {Array.from({ length:totalPages }).map((_, i) => (
            <button key={i} onClick={() => manualTo(i, i>currentPage ? 1 : -1)}
              aria-label={i === 0 ? "Cover" : `Page ${i}: ${cats[i-1]?.name ?? ""}`}
              aria-current={i===currentPage}
              style={{ border:"none", background:"none", cursor:"pointer", padding:"10px 3px", display:"flex", alignItems:"center" }}>
              {/* Width and colour are also set statically: `animate` alone
                  leaves the dot 0px wide until framer's first frame lands. */}
              <motion.span
                animate={{ width: i===currentPage ? 20 : 7, background: i===currentPage ? "var(--color-forest-dark)" : "rgba(30,41,24,0.2)" }}
                style={{ height:7, borderRadius:4, display:"block", width: i===currentPage ? 20 : 7, background: i===currentPage ? "var(--color-forest-dark)" : "rgba(30,41,24,0.2)" }}
                transition={{ duration:0.28 }} />
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.p key={currentPage} initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-4 }} transition={{ duration:0.22 }}
            style={{ textAlign:"center", fontFamily:"'Permanent Marker',cursive", fontSize:"clamp(0.58rem,0.9vw,0.72rem)", color:"rgba(30,41,24,0.4)", marginTop:8 }}>
            {currentPage === 0
              ? "cover · flip to start"
              : `${cats[currentPage-1]?.name} · page ${currentPage} of ${cats.length}`}
          </motion.p>
        </AnimatePresence>
      </div>
    </section>
  );
};

export default ScrapbookSection;
