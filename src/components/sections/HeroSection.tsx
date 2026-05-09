import { HeroContent } from "@/lib/defaults";
import CountdownTimer from "@/components/CountdownTimer";
import { useAuth } from "@/contexts/AuthContext";
import heroBg from "@/assets/hero-bg.jpg";

interface Props { data: HeroContent }

const HeroSection = ({ data }: Props) => {
  const bgImage = data.bg_image_url || heroBg;
  const { user, openAuthModal } = useAuth();

  return (
    <section
      id="hero"
      className="relative flex items-center overflow-hidden"
      style={{ minHeight: "100vh", background: "var(--bg-hero)" }}
    >
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-no-repeat"
        style={{
          backgroundImage: `url(${bgImage})`,
          backgroundPosition: "center 60%",
          opacity: 0.55,
        }}
      />

      {/* Directional overlay — heavier on left for text legibility */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(100deg, rgba(30,41,24,0.80) 0%, rgba(30,41,24,0.45) 55%, rgba(30,41,24,0.20) 100%)",
        }}
      />

      {/* ── Gen-Z floating stickers ───────────────────────────────── */}
      <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
        <span style={{ position:"absolute", top:"12%", right:"8%", fontSize:"2.8rem", transform:"rotate(15deg)", filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.35))", opacity:0.9 }}>✨</span>
        <span style={{ position:"absolute", top:"22%", right:"14%", fontSize:"1.6rem", transform:"rotate(-8deg)", filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.3))", opacity:0.85 }}>🌿</span>
        <span style={{ position:"absolute", bottom:"22%", right:"6%", fontSize:"2.2rem", transform:"rotate(-18deg)", filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.35))", opacity:0.88 }}>🕯️</span>
        <span style={{ position:"absolute", top:"48%", right:"22%", fontSize:"1.4rem", transform:"rotate(10deg)", opacity:0.7 }}>💫</span>
        {/* Gold dashed stamp badge */}
        <div style={{
          position:"absolute", top:"10%", right:"4%",
          width:88, height:88, borderRadius:"50%",
          background:"var(--color-gold)",
          border:"3px dashed rgba(255,255,255,0.6)",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          transform:"rotate(-12deg)",
          boxShadow:"var(--shadow-stamp)",
        }}>
          <span style={{ fontSize:"0.55rem", fontWeight:700, letterSpacing:"0.12em", color:"var(--color-forest-dark)", textTransform:"uppercase", lineHeight:1.2, textAlign:"center", padding:"0 6px" }}>Small{"\n"}Batch</span>
          <span style={{ fontSize:"1.1rem" }}>🫶</span>
        </div>
      </div>

      {/* Content — top padding absorbs the fixed navbar height (94px) */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-8 sm:px-12" style={{ paddingTop: "calc(94px + 5rem)", paddingBottom: "5rem" }}>
        <div className="max-w-xl">

          {/* Eyebrow */}
          <p
            className="eyebrow-gold flex items-center gap-2 mb-6 animate-fade-up"
          >
            <span>✦</span>
            <span>Handmade</span>
            <span style={{ opacity: 0.55 }}>·</span>
            <span>Small Batch</span>
            <span style={{ opacity: 0.55 }}>·</span>
            <span>Café Inspired</span>
          </p>

          {/* Headline */}
          <h1
            className="font-serif font-semibold animate-fade-up"
            style={{
              fontSize: "var(--text-hero)",
              lineHeight: "var(--leading-display)",
              color: "var(--text-on-dark)",
              marginBottom: "var(--space-5)",
            }}
          >
            {data.headline}
          </h1>

          {/* Subtext */}
          <p
            className="font-sans text-base leading-relaxed animate-fade-up-delay-1"
            style={{
              color: "var(--text-muted-on-dark)",
              maxWidth: "400px",
              marginBottom: "var(--space-10)",
            }}
          >
            {data.subtext}
          </p>

          {/* Countdown (optional) */}
          {data.show_countdown && data.launch_date && (
            <div className="mb-10 animate-fade-up-delay-1">
              <CountdownTimer targetDate={data.launch_date} />
            </div>
          )}

          {/* CTAs */}
          <div className="flex items-center gap-3 flex-wrap animate-fade-up-delay-2">
            {/* Primary — cream pill (gated: requires login) */}
            {user ? (
              <a
                href={data.cta_href}
                className="inline-flex items-center gap-2 font-sans text-sm font-medium transition-all hover:opacity-90 hover:-translate-y-0.5"
                style={{
                  background: "var(--btn-primary-bg)",
                  color: "var(--btn-primary-text)",
                  borderRadius: "var(--radius-pill)",
                  padding: "14px 28px",
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
                  padding: "14px 28px",
                  letterSpacing: "var(--tracking-cta)",
                }}
              >
                {data.cta_text} &nbsp;→
              </button>
            )}
            {/* Secondary — ghost pill */}
            <a
              href="#story"
              className="inline-flex items-center gap-2 font-sans text-sm font-medium transition-all hover:opacity-90 hover:-translate-y-0.5"
              style={{
                background: "rgba(245,239,230,0.15)",
                color: "var(--btn-ghost-text)",
                border: "1.5px solid var(--btn-ghost-border)",
                borderRadius: "var(--radius-pill)",
                padding: "14px 28px",
                letterSpacing: "var(--tracking-cta)",
              }}
            >
              Our Story
            </a>
          </div>
        </div>
      </div>

      {/* Scroll hint */}
      <div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce"
        style={{ color: "var(--text-muted-on-dark)" }}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
};

export default HeroSection;
