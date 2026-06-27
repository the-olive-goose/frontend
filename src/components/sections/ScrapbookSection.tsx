import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import useIsMobile from "@/hooks/useIsMobile";
import { getShopCategories, getContent, type ShopCategory } from "@/lib/api";
import { DEFAULT_CONTENT, type Product } from "@/lib/defaults";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

export interface ScrapbookSettings {
  flipDuration: number;
  autoFlipInterval: number;
  newArrivalsCategoryId: string;
}
export const DEFAULT_SCRAPBOOK_SETTINGS: ScrapbookSettings = {
  flipDuration: 0.76,
  autoFlipInterval: 5000,
  newArrivalsCategoryId: "",
};

// ── Fallback categories (shown when DB is empty) ───────────────────────────────
// Product data comes from the Products admin section; fallback uses placeholder cards.

const FALLBACK_CATS: ShopCategory[] = [
  { id: "f1", name: "Coffee Shop Chaos",   slug: "coffee-shop-chaos",   mood_description: "espresso shots & situationships",         tags: ["#chaotic","#caffeinated"],  bg_color: "#f5e4cb", page_bg_color: "#ede0c8", accent_color: "#6b3520", text_color: "#2c1508", stickers: [{ emoji:"☕", top:"5%", left:"5%", rotate:-12, size:2.2 },{ emoji:"✨", top:"6%", left:"88%", rotate:18, size:1.6 },{ emoji:"🎵", top:"88%", left:"4%", rotate:8, size:1.4 }], product_ids: [], display_order: 0, is_active: true },
  { id: "f2", name: "Matcha Therapy",      slug: "matcha-therapy",      mood_description: "calm girl era · no thoughts, just vibes",  tags: ["#calm","#cleangirl"],       bg_color: "#e8f0df", page_bg_color: "#dde9d3", accent_color: "#2d5a27", text_color: "#1a3318", stickers: [{ emoji:"🍵", top:"5%", left:"5%", rotate:-9,  size:2.2 },{ emoji:"🌿", top:"6%", left:"87%", rotate:12, size:2.0 },{ emoji:"💚", top:"89%", left:"89%", rotate:-6, size:1.4 }], product_ids: [], display_order: 1, is_active: true },
  { id: "f3", name: "Late Night Cravings", slug: "late-night-cravings", mood_description: "3am thoughts & dark academia",             tags: ["#darkacademia","#moody"],   bg_color: "#1e1b2e", page_bg_color: "#17152a", accent_color: "#9b8fcc", text_color: "#e8e4f0", stickers: [{ emoji:"🌙", top:"5%", left:"5%", rotate:-8,  size:2.2 },{ emoji:"✨", top:"5%", left:"88%", rotate:18, size:1.8 },{ emoji:"🕯️", top:"88%", left:"4%", rotate:6,  size:2.0 }], product_ids: [], display_order: 2, is_active: true },
  { id: "f4", name: "Bakery Core",         slug: "bakery-core",         mood_description: "warm & soft · your nan's kitchen",         tags: ["#bakery","#cozy"],          bg_color: "#fdf0e3", page_bg_color: "#f5e5d0", accent_color: "#c0572a", text_color: "#3b1a0a", stickers: [{ emoji:"🧁", top:"5%", left:"88%", rotate:14, size:2.2 },{ emoji:"🍞", top:"4%", left:"5%",  rotate:-10, size:2.0 },{ emoji:"💛", top:"91%", left:"89%", rotate:-10, size:1.5 }], product_ids: [], display_order: 3, is_active: true },
  { id: "f5", name: "Soft Girl Era",       slug: "soft-girl-era",       mood_description: "pink flags & soft launches",               tags: ["#softgirl","#coquette"],    bg_color: "#fde8ec", page_bg_color: "#f8d8df", accent_color: "#c0325a", text_color: "#3d0a18", stickers: [{ emoji:"🎀", top:"4%", left:"5%",  rotate:-8,  size:2.0 },{ emoji:"🌸", top:"5%", left:"88%", rotate:18, size:2.2 },{ emoji:"🦋", top:"90%", left:"89%", rotate:-15,size:1.8 }], product_ids: [], display_order: 4, is_active: true },
  { id: "f6", name: "Sunday Reset",        slug: "sunday-reset",        mood_description: "clean girl era · no drama",                tags: ["#sundayreset","#healing"],  bg_color: "#eef7f1", page_bg_color: "#e2f0e8", accent_color: "#1d6b45", text_color: "#0d3322", stickers: [{ emoji:"🪴", top:"4%", left:"5%",  rotate:-7,  size:2.2 },{ emoji:"🌿", top:"5%", left:"88%", rotate:12, size:2.0 },{ emoji:"💚", top:"91%", left:"89%", rotate:-10, size:1.6 }], product_ids: [], display_order: 5, is_active: true },
];

const FALLBACK_IMGS = [m1, m2];

// ── Candle card ────────────────────────────────────────────────────────────────

export const CandleCard = ({ product, accent, isDark, idx }: {
  product: Product; accent: string; isDark: boolean; idx: number;
}) => {
  const img      = product.image_url || FALLBACK_IMGS[idx % 2];
  const cardBg   = isDark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.93)";
  const border   = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)";
  const bodyText = isDark ? "rgba(230,225,255,0.78)" : "rgba(30,20,10,0.65)";
  const { user, openAuthModal } = useAuth();
  const { addToCart } = useCart();

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { openAuthModal(); return; }
    addToCart(product);
    toast.success(`${product.name} added to basket`, { description: product.price, duration: 2000 });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.28 }}
      whileHover={{ y: -5, transition: { duration: 0.18 } }}
      style={{ flex: "1 1 0", minWidth: 0, background: cardBg, border: `1px solid ${border}`, borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: isDark ? "0 8px 28px rgba(0,0,0,0.45)" : "0 6px 22px rgba(0,0,0,0.1)", cursor: "pointer" }}
    >
      {/* Image — 3/4 ratio matches ShopPage */}
      <div style={{ aspectRatio: "3/4", overflow: "hidden", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", flexShrink: 0, position: "relative" }}>
        <img src={img} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover", mixBlendMode: isDark ? "lighten" : "multiply", opacity: 0.9 }} />
        {product.tag && (
          <span style={{ position: "absolute", top: 8, left: 8, fontFamily: "'Fredoka',sans-serif", fontSize: "clamp(0.48rem,0.72vw,0.6rem)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: isDark ? "#0a0a18" : "#fff", background: accent, borderRadius: 20, padding: "2px 8px" }}>
            {product.tag}
          </span>
        )}
      </div>

      <div style={{ padding: "clamp(8px,1.2vw,12px) clamp(10px,1.4vw,14px) clamp(10px,1.4vw,14px)", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Name — Fredoka, the unified heading/display font */}
        <p style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "clamp(0.92rem,1.45vw,1.1rem)", color: accent, lineHeight: 1.15, marginBottom: 4 }}>
          {product.name}
        </p>

        {/* Description */}
        {product.description && (
          <p style={{ fontFamily: "'Inter',sans-serif", fontSize: "clamp(0.56rem,0.85vw,0.68rem)", color: bodyText, lineHeight: 1.45, flex: 1, marginBottom: 8 }}>
            {product.description}
          </p>
        )}

        {/* Price + Add to Cart */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}` }}>
          <span style={{ fontFamily: "'Fredoka',sans-serif", fontWeight: 700, fontSize: "clamp(0.95rem,1.5vw,1.15rem)", color: accent }}>
            {product.price}
          </span>
          <motion.button
            whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.94 }}
            onClick={handleAddToCart}
            style={{ fontFamily: "'Fredoka',sans-serif", fontWeight: 600, fontSize: "clamp(0.6rem,0.9vw,0.74rem)", letterSpacing: "0.02em", background: accent, color: isDark ? "#0a0a18" : "#fff", border: "none", borderRadius: 30, padding: "clamp(4px,0.7vw,6px) clamp(9px,1.3vw,14px)", cursor: "pointer", whiteSpace: "nowrap", boxShadow: `0 3px 10px ${accent}50` }}
          >
            {user ? "Add to Cart" : "Buy Now"}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

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

export const CategoryPage = ({ cat, products, candleOffset, setCandleOffset, interactive }: {
  cat: ShopCategory;
  products: Product[];
  candleOffset: number;
  setCandleOffset: (n: number) => void;
  interactive: boolean;
}) => {
  const isMobile  = useIsMobile();
  const perView   = isMobile ? 1 : CANDLES_PER_VIEW;
  const isDark    = cat.bg_color.startsWith("#1") || cat.bg_color.startsWith("#17");
  const maxOffset = Math.max(0, products.length - perView);
  const visible   = products.slice(candleOffset, candleOffset + perView);
  const canPrev   = candleOffset > 0;
  const canNext   = candleOffset < maxOffset;
  const dimText   = isDark ? "rgba(220,210,255,0.55)" : `${cat.text_color}88`;

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
              {cat.mood_description}
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
          style={{ display:"inline-flex", alignItems:"center", gap:6, fontFamily:"'Fredoka',sans-serif", fontSize: isMobile ? "0.82rem" : "clamp(0.88rem,1.4vw,1.08rem)", background:cat.accent_color, color: isDark ? "#0a0a18" : "#fff", borderRadius:50, padding: isMobile ? "6px 14px" : "9px 20px", alignSelf:"flex-start", textDecoration:"none", boxShadow:`0 4px 16px ${cat.accent_color}44`, transform: isMobile ? "none" : "rotate(-2deg)", transformOrigin:"left center", whiteSpace:"nowrap", flexShrink:0 }}>
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
                  style={{ width:34, height:34, borderRadius:"50%", border:`1.5px solid ${active ? cat.accent_color : cat.accent_color+"40"}`, background: active ? `${cat.accent_color}18` : "transparent", color: active ? cat.accent_color : cat.accent_color+"40", cursor: active ? "pointer" : "default", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1rem", fontWeight:600 }}>
                  {label}
                </motion.button>
              ))}
            </div>
          )}
        </div>

        {/* Cards row */}
        <div style={{ flex:1, display:"flex", gap:"clamp(6px,1.4vw,14px)", alignItems:"stretch", minHeight:0 }}>
          {products.length === 0 ? (
            <>
              <PlaceholderCard accent={cat.accent_color} isDark={isDark} label={"add products via\nAdmin → Shop By Category"} />
              {!isMobile && <PlaceholderCard accent={cat.accent_color} isDark={isDark} label={"they'll appear\nhere automatically"} />}
            </>
          ) : (
            <AnimatePresence mode="sync">
              {visible.map((p, i) => (
                <CandleCard key={p.id} product={p} accent={cat.accent_color} isDark={isDark} idx={candleOffset + i} />
              ))}
              {Array.from({ length: perView - visible.length }).map((_, i) => (
                <div key={`spacer-${i}`} style={{ flex:"1 1 0", minWidth:0 }} />
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Dots */}
        {products.length > perView && (
          <div style={{ display:"flex", justifyContent:"center", gap:5, marginTop:10, flexShrink:0 }}>
            {Array.from({ length: maxOffset+1 }).map((_, i) => (
              <motion.button key={i} onClick={e => { e.stopPropagation(); if (interactive) setCandleOffset(i); }}
                animate={{ width: i===candleOffset ? 18 : 6, background: i===candleOffset ? cat.accent_color : `${cat.accent_color}45` }}
                style={{ height:6, borderRadius:3, border:"none", cursor:"pointer", padding:0 }}
                transition={{ duration:0.25 }} />
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
  const [categories, setCategories]   = useState<ShopCategory[]>(FALLBACK_CATS);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [settings, setSettings]       = useState<ScrapbookSettings>(DEFAULT_SCRAPBOOK_SETTINGS);

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

  const totalPages = categories.length + 1;

  // Fetch categories + products + scrapbook settings
  useEffect(() => {
    getShopCategories().then(cats => { if (cats.length > 0) setCategories(cats); });
    getContent<{ label: string; headline: string; subtext: string; items: Product[] }>("products", DEFAULT_CONTENT.products)
      .then(data => setAllProducts(data?.items ?? []));
    getContent<ScrapbookSettings>("scrapbookSettings", DEFAULT_SCRAPBOOK_SETTINGS)
      .then(s => { if (s) setSettings(s); });
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
    if (pageIdx === 0) return <CoverPage totalCategories={categories.length} onFlip={live ? manualNext : undefined} />;
    const cat = categories[pageIdx - 1];
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
      />
    );
  };

  return (
    <section
      id="shop-by-category"
      style={{ background:"var(--color-cream-section)", padding:"clamp(44px,7vw,84px) 0" }}
    >
      {/* Book */}
      <div style={{ maxWidth:"min(96vw,1240px)", margin:"0 auto", padding:"0 clamp(14px,3.5vw,44px)", position:"relative" }}>

        <motion.button onClick={manualPrev} whileHover={{ scale:1.12 }} whileTap={{ scale:0.9 }} aria-label="Previous page"
          style={{ position:"absolute", left:-4, top:"48%", transform:"translateY(-50%)", zIndex:30, background:"rgba(255,255,255,0.92)", border:"1.5px solid rgba(0,0,0,0.1)", borderRadius:"50%", width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", backdropFilter:"blur(8px)", boxShadow:"0 4px 14px rgba(0,0,0,0.1)", fontSize:"1rem", color:"var(--color-forest-dark)" }}>←</motion.button>

        {/* Book with page-stack depth */}
        <div style={{ position:"relative" }}>
          <div style={{ position:"absolute", inset:0, borderRadius:"clamp(10px,1.6vw,18px)", background:"#e8dcc8", transform:"translateX(3px) translateY(-2px)", zIndex:0 }} />
          <div style={{ position:"absolute", inset:0, borderRadius:"clamp(10px,1.6vw,18px)", background:"#f0e4cc", transform:"translateX(6px) translateY(-4px)", zIndex:-1 }} />

          <div style={{ height:"clamp(400px,62vw,620px)", borderRadius:"clamp(8px,1.6vw,18px)", overflow:"hidden", boxShadow:"0 24px 70px rgba(0,0,0,0.2),0 8px 20px rgba(0,0,0,0.1)", position:"relative", zIndex:1 }}>
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

              {/* Spine */}
              <div style={{ position:"absolute", left:"26%", top:0, bottom:0, width:4, background:"linear-gradient(to right,rgba(0,0,0,0.14),rgba(0,0,0,0.04),transparent)", zIndex:15, pointerEvents:"none" }} />
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
          style={{ position:"absolute", right:-4, top:"48%", transform:"translateY(-50%)", zIndex:30, background:"rgba(255,255,255,0.92)", border:"1.5px solid rgba(0,0,0,0.1)", borderRadius:"50%", width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", backdropFilter:"blur(8px)", boxShadow:"0 4px 14px rgba(0,0,0,0.1)", fontSize:"1rem", color:"var(--color-forest-dark)" }}>→</motion.button>

        {/* Dots */}
        <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:20 }}>
          {Array.from({ length:totalPages }).map((_, i) => (
            <motion.button key={i} onClick={() => manualTo(i, i>currentPage ? 1 : -1)}
              animate={{ width: i===currentPage ? 20 : 7, background: i===currentPage ? "var(--color-forest-dark)" : "rgba(30,41,24,0.2)" }}
              style={{ height:7, borderRadius:4, border:"none", cursor:"pointer", padding:0 }}
              transition={{ duration:0.28 }} aria-label={`Page ${i}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.p key={currentPage} initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-4 }} transition={{ duration:0.22 }}
            style={{ textAlign:"center", fontFamily:"'Permanent Marker',cursive", fontSize:"clamp(0.58rem,0.9vw,0.72rem)", color:"rgba(30,41,24,0.4)", marginTop:8 }}>
            {currentPage === 0
              ? "cover · flip to start"
              : `${categories[currentPage-1]?.name} · page ${currentPage} of ${categories.length}`}
          </motion.p>
        </AnimatePresence>
      </div>
    </section>
  );
};

export default ScrapbookSection;
