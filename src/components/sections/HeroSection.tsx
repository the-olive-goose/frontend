import { HeroContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { SkelBlock, SkelText } from "@/components/ui/ContentSkeleton";
import CountdownTimer from "@/components/CountdownTimer";
import { useAuth } from "@/contexts/AuthContext";
import heroBg from "@/assets/hero-bg.jpg";

interface Props {
  data: HeroContent;
  /** False while the hero copy is still loading — skeletons stand in for it. */
  ready?: boolean;
}

const hexToRgba = (hex: string, alpha: number) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const HeroSection = ({ data, ready = true }: Props) => {
  const bgImage     = data.bg_image_url || heroBg;
  const bgOpacity   = data.bg_opacity   ?? 1.0;
  const tintColor   = data.tint_color   ?? "#1e2918";
  const tintOpacity = data.tint_opacity ?? 0.45;
  const { user, openAuthModal } = useAuth();

  // The image starts exactly below the fixed navbar. It reads --nav-h — which
  // NavbarSection publishes from its own measurement — rather than measuring
  // #site-navbar a second time here: two independent measurements drift the
  // moment the header changes height (an admin with no announcement messages has
  // no announcement bar), and this one left a gap under the navbar.
  return (
    <section
      id="hero"
      className="relative w-full"
      style={{ marginTop: "var(--nav-h, 112px)" }}
    >
      {/* ── Image fills a responsive fixed height so the centered text overlay
             always has room, regardless of the image's own aspect ratio ── */}
      <div className="relative w-full h-[440px] sm:h-[620px] lg:h-[760px]">
        {/* Held back until the hero content is known: the admin can point this at
            their own photo, and rendering the bundled one first would swap the
            whole hero out from under the visitor. */}
        {ready && (
          <img
            src={bgImage}
            alt="Handmade café-inspired candles by The Olive Goose, Dublin"
            // React 18 only passes the LCP fetch hint through as a lowercase DOM
            // attribute (camelCase fetchPriority lands in React 19).
            {...({ fetchpriority: "high" } as React.ImgHTMLAttributes<HTMLImageElement>)}
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              opacity: Math.max(0.05, bgOpacity),
            }}
          />
        )}
        {!ready && (
          <div className="absolute inset-0" style={{ background: "var(--bg-hero)" }} />
        )}

        {/* Configurable tint overlay */}
        {tintOpacity > 0 && (
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(100deg,
                ${hexToRgba(tintColor, tintOpacity)} 0%,
                ${hexToRgba(tintColor, tintOpacity * 0.5)} 50%,
                ${hexToRgba(tintColor, 0)} 100%)`,
            }}
          />
        )}

        {/* Floating stickers */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Decorative emoji — hidden on small screens so they don't cover the photo */}
          <div className="hidden sm:block">
            <span style={{ position:"absolute", top:"12%", right:"8%",  fontSize:"2.8rem", transform:"rotate(15deg)",  filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.35))", opacity:0.9  }}>✨</span>
            <span style={{ position:"absolute", top:"22%", right:"14%", fontSize:"1.6rem", transform:"rotate(-8deg)",  filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.3))",  opacity:0.85 }}>🌿</span>
            <span style={{ position:"absolute", bottom:"22%",right:"6%",fontSize:"2.2rem", transform:"rotate(-18deg)", filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.35))", opacity:0.88 }}>🕯️</span>
          </div>
          {/* SMALL BATCH stamp — smaller and tucked into the corner on mobile */}
          <div
            className="absolute flex flex-col items-center justify-center rotate-[-12deg] w-[60px] h-[60px] top-2 right-2 sm:w-[88px] sm:h-[88px] sm:top-[10%] sm:right-[4%]"
            style={{
              borderRadius:"50%",
              background:"var(--color-gold)",
              border:"3px dashed rgba(255,255,255,0.6)",
              boxShadow:"var(--shadow-stamp)",
            }}
          >
            <span style={{ fontSize:"0.5rem", fontWeight:700, letterSpacing:"0.12em", color:"var(--color-forest-dark)", textTransform:"uppercase", lineHeight:1.4, textAlign:"center", padding:"0 6px" }} className="sm:!text-[0.55rem]">
              Small{"\n"}Batch
            </span>
            <span style={{ fontSize:"1rem" }} className="sm:!text-[1.1rem]">🫶</span>
          </div>
        </div>

        {/* ── Centered content overlay ── */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-end sm:justify-center text-center"
          style={{ paddingTop: "clamp(60px,12vw,160px)", paddingBottom: "clamp(40px,6vw,80px)", paddingLeft: "clamp(16px,5vw,48px)", paddingRight: "clamp(16px,5vw,48px)" }}
        >
          {/* Headline */}
          <h1
            className="font-serif font-semibold animate-fade-up"
            style={{
              fontSize: "var(--text-hero)",
              lineHeight: "var(--leading-display)",
              color: "var(--text-on-dark)",
              marginBottom: "var(--space-5)",
              maxWidth: 720,
            }}
          >
            {/* When the admin leaves the headline blank (text baked into the hero
                image), keep a screen-reader/crawler-visible H1 so the homepage
                never ships an empty heading. */}
            {!ready ? (
              <SkelText lines={2} width="min(560px,86vw)" lineHeight={1.1} center />
            ) : data.headline ? (
              <RichText text={data.headline} />
            ) : (
              <span className="sr-only">The Olive Goose — handmade café-inspired candles, Dublin</span>
            )}
          </h1>

          {/* Subtext */}
          <p
            className="font-sans text-base leading-relaxed animate-fade-up-delay-1"
            style={{
              color: "var(--text-muted-on-dark)",
              maxWidth: 480,
              marginBottom: "var(--space-10)",
            }}
          >
            {ready ? <RichText text={data.subtext} /> : <SkelText lines={2} width="min(420px,80vw)" lineHeight={1.5} center />}
          </p>

          {/* Countdown */}
          {data.show_countdown && data.launch_date && (
            <div className="mb-10 animate-fade-up-delay-1">
              <CountdownTimer targetDate={data.launch_date} />
            </div>
          )}

          {/* CTA — single centered button */}
          <div className="animate-fade-up-delay-2">
            {!ready ? (
              <SkelBlock height="49px" width="196px" radius="var(--radius-pill)" style={{ color: "var(--text-on-dark)" }} />
            ) : user ? (
              <a
                href={data.cta_href}
                className="inline-flex items-center gap-2 font-sans text-sm font-medium transition-all hover:opacity-90 hover:-translate-y-0.5"
                style={{
                  background: "var(--btn-primary-bg)",
                  color: "var(--btn-primary-text)",
                  borderRadius: "var(--radius-pill)",
                  padding: "14px 36px",
                  letterSpacing: "var(--tracking-cta)",
                }}
              >
                {data.cta_text} &nbsp;→
              </a>
            ) : (
              <button
                onClick={openAuthModal}
                className="inline-flex items-center gap-2 font-sans text-sm font-medium transition-all hover:opacity-90 hover:-translate-y-0.5"
                style={{
                  background: "var(--btn-primary-bg)",
                  color: "var(--btn-primary-text)",
                  borderRadius: "var(--radius-pill)",
                  padding: "14px 36px",
                  letterSpacing: "var(--tracking-cta)",
                }}
              >
                {data.cta_text} &nbsp;→
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scroll hint */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 hidden sm:flex flex-col items-center gap-1 animate-bounce"
        style={{ color: "var(--text-muted-on-dark)", zIndex: 10 }}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
};

export default HeroSection;
