import { HeroContent } from "@/lib/defaults";
import CountdownTimer from "@/components/CountdownTimer";
import heroBg from "@/assets/hero-bg.jpg";

interface Props { data: HeroContent }

const HeroSection = ({ data }: Props) => {
  const bgImage = data.bg_image_url || heroBg;

  return (
    <section
      id="hero"
      className="relative flex items-center overflow-hidden"
      style={{ minHeight: "calc(100vh - 88px)", background: "#1E2918" }}
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

      {/* Directional overlay — heavier on the left for text legibility */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(100deg, rgba(30,41,24,0.80) 0%, rgba(30,41,24,0.45) 55%, rgba(30,41,24,0.20) 100%)",
        }}
      />

      {/* ── Gen-Z floating stickers ───────────────────────────────── */}
      <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
        {/* top-right sparkle cluster */}
        <span style={{ position:"absolute", top:"12%", right:"8%", fontSize:"2.8rem", transform:"rotate(15deg)", filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.35))", opacity:0.9 }}>✨</span>
        <span style={{ position:"absolute", top:"22%", right:"14%", fontSize:"1.6rem", transform:"rotate(-8deg)", filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.3))", opacity:0.85 }}>🌿</span>
        {/* bottom-right sticker */}
        <span style={{ position:"absolute", bottom:"22%", right:"6%", fontSize:"2.2rem", transform:"rotate(-18deg)", filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.35))", opacity:0.88 }}>🕯️</span>
        {/* mid-right accent */}
        <span style={{ position:"absolute", top:"48%", right:"22%", fontSize:"1.4rem", transform:"rotate(10deg)", opacity:0.7 }}>💫</span>
        {/* stamp badge — top right */}
        <div style={{
          position:"absolute", top:"10%", right:"4%",
          width:88, height:88, borderRadius:"50%",
          background:"#C9B26D", border:"3px dashed rgba(255,255,255,0.6)",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          transform:"rotate(-12deg)",
          boxShadow:"0 4px 16px rgba(0,0,0,0.25)",
        }}>
          <span style={{ fontSize:"0.55rem", fontWeight:700, letterSpacing:"0.12em", color:"#1D2B1B", textTransform:"uppercase", lineHeight:1.2, textAlign:"center", padding:"0 6px" }}>Small{"\n"}Batch</span>
          <span style={{ fontSize:"1.1rem" }}>🫶</span>
        </div>
      </div>

      {/* Content — left-aligned like the Canva */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-8 sm:px-12 py-24">
        <div className="max-w-xl">

          {/* Badge */}
          <p
            className="font-sans text-xs font-medium tracking-[0.18em] uppercase flex items-center gap-2 mb-6 animate-fade-up"
            style={{ color: "#C9B26D" }}
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
            className="font-serif font-semibold leading-[1.08] mb-5 animate-fade-up"
            style={{ fontSize: "clamp(2.4rem, 5vw, 3.6rem)", color: "#F5EFE6" }}
          >
            {data.headline}
          </h1>

          {/* Subtext */}
          <p
            className="font-sans text-base leading-relaxed mb-10 animate-fade-up-delay-1"
            style={{ color: "rgba(245,239,230,0.80)", maxWidth: "400px" }}
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
            {/* Primary — cream pill */}
            <a
              href={data.cta_href}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-sans text-sm font-medium transition-all hover:opacity-90 hover:-translate-y-0.5"
              style={{ background: "#F2EDE3", color: "#1D2B1B" }}
            >
              {data.cta_text} &nbsp;→
            </a>
            {/* Secondary — ghost pill */}
            <a
              href="#story"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-sans text-sm font-medium transition-all hover:opacity-90 hover:-translate-y-0.5"
              style={{
                background: "rgba(245,239,230,0.15)",
                color: "#F5EFE6",
                border: "1.5px solid rgba(245,239,230,0.50)",
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
        style={{ color: "rgba(245,239,230,0.35)" }}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
};

export default HeroSection;
