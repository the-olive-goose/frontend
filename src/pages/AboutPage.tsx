import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import NavbarSection from "@/components/sections/NavbarSection";
import FooterSection from "@/components/sections/FooterSection";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay },
});

const AboutPage = () => {
  const [content, setContent] = useState(DEFAULT_CONTENT);

  useEffect(() => {
    Promise.all([
      getContent("announcementBar", DEFAULT_CONTENT.announcementBar),
      getContent("navbar",          DEFAULT_CONTENT.navbar),
      getContent("brandStory",      DEFAULT_CONTENT.brandStory),
      getContent("welcomeClub",     DEFAULT_CONTENT.welcomeClub),
      getContent("footer",          DEFAULT_CONTENT.footer),
    ]).then(([announcementBar, navbar, brandStory, welcomeClub, footer]) => {
      setContent(prev => ({ ...prev, announcementBar, navbar, brandStory, welcomeClub, footer }));
    });
  }, []);

  const story = content.brandStory;
  const founder = content.welcomeClub;

  return (
    <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>
      <NavbarSection data={content.navbar} announcement={content.announcementBar} />

      {/* ── Hero ── */}
      <div className="w-full pt-[94px]" style={{ background: "var(--color-forest-dark)" }}>
        <div className="max-w-6xl mx-auto px-6 sm:px-12 py-20 sm:py-28 text-center">
          <motion.p {...fadeUp(0)}
            className="font-display text-xs tracking-[0.2em] uppercase mb-5"
            style={{ color: "var(--color-gold)" }}
          >
            ✦ &nbsp; Our Story
          </motion.p>
          <motion.h1 {...fadeUp(0.1)}
            className="font-serif font-semibold mb-6"
            style={{ fontSize: "clamp(2.8rem,6vw,5rem)", color: "var(--color-cream-text)", lineHeight: 1.05 }}
          >
            {story.headline}
          </motion.h1>
          <motion.p {...fadeUp(0.2)}
            className="font-sans text-base leading-relaxed max-w-xl mx-auto"
            style={{ color: "rgba(245,239,230,0.65)" }}
          >
            Handcrafted with intention. Poured with love. Made for moments that matter.
          </motion.p>
        </div>
      </div>

      {/* ── Brand story ── */}
      <section className="max-w-6xl mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          {/* Image */}
          <motion.div {...fadeUp(0)} className="order-2 md:order-1">
            <div
              className="w-full rounded-2xl overflow-hidden"
              style={{ aspectRatio: "4/5", background: "var(--color-sage-pale)" }}
            >
              {story.image_url ? (
                <img src={story.image_url} alt="Brand story" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span style={{ fontSize: "6rem", opacity: 0.35 }}>🕯️</span>
                </div>
              )}
            </div>
          </motion.div>

          {/* Text */}
          <div className="order-1 md:order-2 space-y-6">
            <motion.p {...fadeUp(0)}
              className="font-display text-xs tracking-[0.18em] uppercase"
              style={{ color: "var(--color-sage-light)" }}
            >
              {story.label}
            </motion.p>
            <motion.h2 {...fadeUp(0.08)}
              className="font-serif font-semibold"
              style={{ fontSize: "clamp(1.8rem,3.5vw,2.8rem)", color: "var(--color-forest-dark)", lineHeight: 1.15 }}
            >
              {story.headline}
            </motion.h2>
            {story.body.split("\n\n").map((para, i) => (
              <motion.p key={i} {...fadeUp(0.12 + i * 0.06)}
                className="font-sans text-base leading-relaxed"
                style={{ color: "rgba(30,41,24,0.72)" }}
              >
                {para}
              </motion.p>
            ))}
            {story.cta_text && (
              <motion.a {...fadeUp(0.24)}
                href={story.cta_href || "#"}
                className="inline-flex items-center gap-2 font-display text-sm font-semibold px-6 py-3 rounded-full transition-all hover:opacity-90 hover:-translate-y-0.5"
                style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
              >
                {story.cta_text} &nbsp;→
              </motion.a>
            )}
          </div>
        </div>
      </section>

      {/* ── Values strip ── */}
      <section style={{ background: "var(--color-sage-mid)" }}>
        <div className="max-w-6xl mx-auto px-6 sm:px-12 py-16 sm:py-20">
          <motion.h2 {...fadeUp(0)}
            className="font-serif text-2xl sm:text-3xl text-center mb-12"
            style={{ color: "var(--color-forest-dark)" }}
          >
            What we believe in
          </motion.h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { icon: "🌿", title: "Sustainably Sourced",  body: "Every ingredient is chosen with the planet in mind — soy wax, cotton wicks, recycled packaging." },
              { icon: "🤝", title: "Small Batch",          body: "We pour in small batches to guarantee quality, freshness and a personal touch in every candle." },
              { icon: "💛", title: "Made with Intention",  body: "Each scent is designed around a feeling — because the right candle can transform any room." },
            ].map((v, i) => (
              <motion.div key={v.title} {...fadeUp(i * 0.1)}
                className="text-center space-y-4 p-6 rounded-2xl"
                style={{ background: "rgba(255,255,255,0.35)" }}
              >
                <span style={{ fontSize: "2.2rem" }}>{v.icon}</span>
                <h3 className="font-serif text-lg" style={{ color: "var(--color-forest-dark)" }}>{v.title}</h3>
                <p className="font-sans text-sm leading-relaxed" style={{ color: "rgba(30,41,24,0.7)" }}>{v.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Founder ── */}
      <section className="max-w-6xl mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div className="space-y-6">
            <motion.p {...fadeUp(0)}
              className="font-display text-xs tracking-[0.18em] uppercase"
              style={{ color: "var(--color-sage-light)" }}
            >
              Meet the maker
            </motion.p>
            <motion.h2 {...fadeUp(0.08)}
              className="font-serif font-semibold"
              style={{ fontSize: "clamp(1.8rem,3.5vw,2.8rem)", color: "var(--color-forest-dark)", lineHeight: 1.15 }}
            >
              {founder.headline}
            </motion.h2>
            <motion.p {...fadeUp(0.14)}
              className="font-sans text-base font-medium"
              style={{ color: "var(--color-forest-dark)" }}
            >
              {founder.name_line}
            </motion.p>
            <motion.p {...fadeUp(0.18)}
              className="font-sans text-base leading-relaxed"
              style={{ color: "rgba(30,41,24,0.72)" }}
            >
              {founder.bio}
            </motion.p>
            {founder.cta_text && (
              <motion.a {...fadeUp(0.24)}
                href={founder.cta_href || "#"}
                className="inline-flex items-center gap-2 font-display text-sm font-semibold px-6 py-3 rounded-full border transition-all hover:opacity-80"
                style={{ border: "1.5px solid var(--color-forest-dark)", color: "var(--color-forest-dark)" }}
              >
                {founder.cta_text} &nbsp;→
              </motion.a>
            )}
          </div>

          <motion.div {...fadeUp(0.1)}>
            <div
              className="w-full rounded-full overflow-hidden mx-auto"
              style={{ width: "min(380px, 100%)", aspectRatio: "1/1", background: "var(--color-sage-pale)" }}
            >
              {founder.photo_url ? (
                <img src={founder.photo_url} alt="Founder" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span style={{ fontSize: "5rem", opacity: 0.35 }}>🌿</span>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      <FooterSection data={content.footer} />
    </div>
  );
};

export default AboutPage;
