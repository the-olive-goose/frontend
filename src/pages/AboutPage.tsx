import { useRef } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { useContentSections } from "@/hooks/useContent";
import { SkelBlock, SkelCopy, SkelText } from "@/components/ui/ContentSkeleton";
import PageHero from "@/components/PageHero";
import FooterSection from "@/components/sections/FooterSection";
import RichText from "@/lib/richtext";
import { resolveAboutFounder } from "@/lib/aboutFounder";
import { useJsonLd } from "@/hooks/useJsonLd";
import { breadcrumbJsonLd } from "@/lib/seo";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay },
});

const FounderCta = ({ href, text }: { href?: string; text?: string }) => {
  if (!text) return null;
  const isExternal = href?.startsWith("http://") || href?.startsWith("https://");
  const className = "inline-flex items-center gap-2 font-display text-sm font-semibold px-6 py-3 rounded-full transition-all hover:opacity-90 hover:-translate-y-0.5";
  const style = { background: "var(--color-forest-dark)", color: "var(--color-cream-text)" };

  if (isExternal || (!href?.startsWith("/"))) {
    return (
      <a href={href || "#"} className={className} style={style}>
        <RichText text={text} /> &nbsp;→
      </a>
    );
  }

  return (
    <Link to={href || "/about"} className={className} style={style}>
      <RichText text={text} /> &nbsp;→
    </Link>
  );
};

const AboutPage = () => {
  // Navbar / announcement / footer copy is owned elsewhere — this page only reads
  // the sections it renders.
  const { data: content, ready } = useContentSections({
    brandStory:   DEFAULT_CONTENT.brandStory,
    aboutPage:    DEFAULT_CONTENT.aboutPage,
    welcomeClub:  DEFAULT_CONTENT.welcomeClub,
    aboutFounder: DEFAULT_CONTENT.aboutFounder,
  });

  const story = content.brandStory;
  const aboutPageContent = content.aboutPage;
  const founder = resolveAboutFounder(content.aboutFounder, content.welcomeClub);
  // Removing every card in the admin removes the strip, so the story block can
  // run straight into the maker block.
  const values = ready ? (aboutPageContent.values ?? []) : [];

  // The story CTA ("Learn More" by default) has no page to go to — it walks the
  // reader down to the values strip, which leaves the maker section peeking in
  // below it. A real (non-hash) link from the admin still navigates as written.
  const valuesRef = useRef<HTMLElement>(null);
  const scrollToStoryTarget = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const href = story.cta_href || "#";
    if (!href.startsWith("#")) return;
    e.preventDefault();
    const named = href.length > 1 ? document.querySelector(href) : null;
    // With the strip emptied there is no values section to land on, so the CTA
    // falls through to the maker block rather than doing nothing at all.
    (named ?? valuesRef.current ?? founderRef.current)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // "Meet the Founder" sits beside that CTA and jumps straight past the values
  // strip to the maker block, for readers who came for the person, not the wax.
  const founderRef = useRef<HTMLElement>(null);
  const scrollToFounder = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    founderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useJsonLd("breadcrumb", breadcrumbJsonLd([["Home", "/"], ["Our Story", "/about"]]));

  return (
    <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>

      {/* ── Hero ── (shared band: owns the nav offset + page rhythm) */}
      <PageHero
        eyebrow={aboutPageContent.hero_eyebrow}
        title={aboutPageContent.page_title}
        titleGold={aboutPageContent.page_title_gold}
        subtitle={aboutPageContent.page_subtitle}
        ready={ready}
      />

      {/* ── Brand story ── */}
      <section className="max-w-6xl mx-auto px-6 sm:px-12 pt-[var(--page-body-pt)] pb-20 sm:pb-28">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          {/* Image */}
          {/* Photo leads on mobile — it sits above the story copy; on md+ it takes
              the left column as before. */}
          <motion.div {...fadeUp(0)}>
            <div
              className="w-full rounded-2xl overflow-hidden"
              style={{ aspectRatio: "4/5", background: "var(--color-sage-pale)" }}
            >
              {!ready ? (
                <SkelBlock height="100%" radius="0" style={{ color: "var(--color-forest-dark)" }} />
              ) : story.image_url ? (
                <img src={story.image_url} alt="The Olive Goose story — hand-poured candles from Dublin" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span style={{ fontSize: "6rem", opacity: 0.35 }}>🕯️</span>
                </div>
              )}
            </div>
          </motion.div>

          {/* Text */}
          <div className="space-y-6">
            <motion.p {...fadeUp(0)}
              className="font-display text-xs tracking-[0.2em] uppercase"
              style={{ color: "var(--color-sage-light)" }}
            >
              {ready ? story.label : <SkelCopy>{story.label}</SkelCopy>}
            </motion.p>
            <motion.h2 {...fadeUp(0.08)}
              className="font-serif font-semibold"
              style={{ fontSize: "clamp(1.8rem,3.5vw,2.8rem)", color: "var(--color-forest-dark)", lineHeight: 1.15 }}
            >
              {ready ? story.headline : <SkelCopy lineHeight={1.15}>{story.headline}</SkelCopy>}
            </motion.h2>
            {/* One placeholder paragraph per real paragraph, each sized against
                the copy it stands in for — a fixed five-line block left this
                column growing by ~130px when the story landed. */}
            {!ready && story.body.split("\n\n").map((para, i) => (
              <p key={i} className="font-sans text-base leading-relaxed" style={{ color: "rgba(30,41,24,0.72)" }}>
                <SkelCopy lineHeight={1.625}>{para}</SkelCopy>
              </p>
            ))}
            {ready && story.body.split("\n\n").map((para, i) => (
              <motion.p key={i} {...fadeUp(0.12 + i * 0.06)}
                className="font-sans text-base leading-relaxed"
                style={{ color: "rgba(30,41,24,0.72)" }}
              >
                {para}
              </motion.p>
            ))}
            {/* Two buttons, one row — they wrap rather than shrink on narrow
                phones so neither label is ever clipped. */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Placeholder pills carry the buttons' own padding and label, so
                  the row is already their height and width before they land. */}
              {!ready && story.cta_text && (
                <span className="inline-flex items-center gap-2 font-display text-sm font-semibold px-6 py-3" style={{ color: "var(--color-forest-dark)" }}>
                  <SkelCopy lineHeight={1.5}>{story.cta_text} &nbsp;→</SkelCopy>
                </span>
              )}
              {!ready && founder.jump_cta_text && (
                <span className="inline-flex items-center gap-2 font-display text-sm font-semibold px-6 py-3" style={{ color: "var(--color-forest-dark)", border: "1.5px solid transparent" }}>
                  <SkelCopy lineHeight={1.5}><RichText text={founder.jump_cta_text} /> &nbsp;↓</SkelCopy>
                </span>
              )}
              {ready && story.cta_text && (
                <motion.a {...fadeUp(0.24)}
                  href={story.cta_href || "#values"}
                  onClick={scrollToStoryTarget}
                  className="inline-flex items-center gap-2 font-display text-sm font-semibold px-6 py-3 rounded-full transition-all hover:opacity-90 hover:-translate-y-0.5"
                  style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
                >
                  {story.cta_text} &nbsp;→
                </motion.a>
              )}
              {ready && founder.jump_cta_text && (
                <motion.a {...fadeUp(0.3)}
                  href="#meet-the-maker"
                  onClick={scrollToFounder}
                  className="inline-flex items-center gap-2 font-display text-sm font-semibold px-6 py-3 rounded-full border transition-all hover:opacity-80 hover:-translate-y-0.5"
                  style={{ border: "1.5px solid var(--color-forest-dark)", color: "var(--color-forest-dark)" }}
                >
                  <RichText text={founder.jump_cta_text} /> &nbsp;↓
                </motion.a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Values strip ── (scroll target for the story CTA; scroll-margin keeps
           the heading clear of the fixed nav. Cards come from About → Page &
           Values in the admin, and the strip disappears when they are all
           removed.) */}
      {values.length > 0 && (
        <section
          id="values"
          ref={valuesRef}
          style={{ background: "var(--color-sage-mid)", scrollMarginTop: "var(--nav-h, 112px)" }}
        >
          <div className="max-w-6xl mx-auto px-6 sm:px-12 py-16 sm:py-20">
            {aboutPageContent.values_heading && (
              <motion.h2 {...fadeUp(0)}
                className="font-serif text-2xl sm:text-3xl text-center mb-12"
                style={{ color: "var(--color-forest-dark)" }}
              >
                <RichText text={aboutPageContent.values_heading} />
              </motion.h2>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
              {values.map((v, i) => (
                <motion.div key={i} {...fadeUp(i * 0.1)}
                  className="text-center space-y-4 p-6 rounded-2xl"
                  style={{ background: "rgba(255,255,255,0.35)" }}
                >
                  <span style={{ fontSize: "2.2rem" }}>{v.icon}</span>
                  <h3 className="font-serif text-lg" style={{ color: "var(--color-forest-dark)" }}>
                    <RichText text={v.title} />
                  </h3>
                  <p className="font-sans text-sm leading-relaxed" style={{ color: "rgba(30,41,24,0.7)" }}>
                    <RichText text={v.body} />
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Meet the maker ── (scroll target for the "Meet the Founder" button;
           one centred column so the reading order — label, face, greeting, name,
           bio, button — is the same on a phone as on a desktop) */}
      {/* The block renders the same either way — whether the words are mirrored
          from the home page or this page's own is settled in resolveAboutFounder,
          not here. */}
      <section
        id="meet-the-maker"
        ref={founderRef}
        className="max-w-3xl mx-auto px-6 sm:px-12 py-20 sm:py-28 text-center"
        style={{ scrollMarginTop: "var(--nav-h, 112px)" }}
      >
        <motion.p {...fadeUp(0)}
          className="font-display text-xs tracking-[0.2em] uppercase"
          style={{ color: "var(--color-sage-light)" }}
        >
          {ready ? <RichText text={founder.label} /> : <SkelText width="150px" center />}
        </motion.p>

        <motion.div {...fadeUp(0.06)} className="mt-8 mb-8 flex justify-center">
          <div
            className="rounded-full overflow-hidden"
            style={{
              width: "min(300px, 68vw)",
              aspectRatio: "1/1",
              background: "var(--color-sage-pale)",
              border: "3px solid rgba(255,255,255,0.6)",
            }}
          >
            {!ready ? (
              <SkelBlock height="100%" radius="0" style={{ color: "var(--color-forest-dark)" }} />
            ) : founder.photo_url ? (
              <img src={founder.photo_url} alt="The founder of The Olive Goose" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span style={{ fontSize: "5rem", opacity: 0.35 }}>🌿</span>
              </div>
            )}
          </div>
        </motion.div>

        <motion.h2 {...fadeUp(0.12)}
          className="font-serif font-semibold"
          style={{ fontSize: "clamp(1.8rem,3.5vw,2.8rem)", color: "var(--color-forest-dark)", lineHeight: 1.15 }}
        >
          {ready ? <RichText text={founder.headline} /> : <SkelText width="min(420px,80%)" lineHeight={1.15} center />}
        </motion.h2>

        <motion.p {...fadeUp(0.16)}
          className="font-sans text-base font-medium mt-5"
          style={{ color: "var(--color-forest-dark)" }}
        >
          {ready ? <RichText text={founder.name_line} /> : <SkelText width="220px" center />}
        </motion.p>

        <motion.p {...fadeUp(0.2)}
          className="font-sans text-base leading-relaxed mt-4"
          style={{ color: "rgba(30,41,24,0.72)" }}
        >
          {ready ? <RichText text={founder.bio} /> : <SkelText lines={4} lineHeight={1.6} center />}
        </motion.p>

        {ready && founder.cta_text && (
          <motion.div {...fadeUp(0.26)} className="mt-8">
            <FounderCta href={founder.cta_href} text={founder.cta_text} />
          </motion.div>
        )}
      </section>

      <FooterSection />
    </div>
  );
};

export default AboutPage;
