import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type SiteContent } from "@/lib/defaults";
import logo from "@/assets/logo.jpg";
import FeedbackModal      from "@/components/FeedbackModal";
import HeroSection        from "@/components/sections/HeroSection";
import SmellsLikeSection  from "@/components/sections/SmellsLikeSection";
import ScrapbookSection  from "@/components/sections/ScrapbookSection";
import NewArrivalsSection from "@/components/sections/NewArrivalsSection";
import MomentPillSection  from "@/components/sections/MomentPillSection";
import WelcomeSection     from "@/components/sections/WelcomeSection";
import VideosSection          from "@/components/sections/VideosSection";
import TestimonialsSection    from "@/components/sections/TestimonialsSection";
import FooterSection          from "@/components/sections/FooterSection";

const Index = () => {
  const [content, setContent]       = useState<SiteContent>(DEFAULT_CONTENT);
  const [loaded, setLoaded]         = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [
          announcementBar,
          navbar,
          hero,
          momentPill,
          welcomeClub,
          products,
          candleCare,
          brandStory,
          videos,
          testimonials,
          newsletter,
          footer,
        ] = await Promise.all([
          getContent("announcementBar", DEFAULT_CONTENT.announcementBar),
          getContent("navbar",          DEFAULT_CONTENT.navbar),
          getContent("hero",            DEFAULT_CONTENT.hero),
          getContent("momentPill",      DEFAULT_CONTENT.momentPill),
          getContent("welcomeClub",     DEFAULT_CONTENT.welcomeClub),
          getContent("products",        DEFAULT_CONTENT.products),
          getContent("candleCare",      DEFAULT_CONTENT.candleCare),
          getContent("brandStory",      DEFAULT_CONTENT.brandStory),
          getContent("videos",          DEFAULT_CONTENT.videos),
          getContent("testimonials",    DEFAULT_CONTENT.testimonials),
          getContent("newsletter",      DEFAULT_CONTENT.newsletter),
          getContent("footer",          DEFAULT_CONTENT.footer),
        ]);
        setContent({
          announcementBar, navbar, hero, momentPill, welcomeClub,
          products, candleCare, brandStory, videos, testimonials, newsletter, footer,
        });
      } catch {
        /* fall back to defaults */
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, []);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-hero)" }}>
        <img src={logo} alt="The Olive Goose" className="w-24 h-24 og-logo-reveal" width={512} height={512} />
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Fixed header: announcement bar (38px) + nav (~56px) = 94px */}

      <div style={{ marginTop: 0, paddingTop: 0 }}>
        {/* 1. Hero — full-width image, flush from top of viewport behind navbar */}
        <HeroSection data={content.hero} />

        {/* 2. "SMELLS LIKE YOUR CAFÉ ERA." — cream bg */}
        <SmellsLikeSection />

        {/* 3. New Arrivals — products tagged "new" */}
        <NewArrivalsSection />

        {/* 4. Shop By Category — scrapbook */}
        <ScrapbookSection />

        {/* 4. "Live in the moment" pill — green bg */}
        <MomentPillSection data={content.momentPill} />

        {/* 5. Welcome to the Olive Goose Club */}
        <WelcomeSection data={content.welcomeClub} />

        {/* 6. Videos */}
        <VideosSection data={content.videos} />

        {/* 7. Testimonials — cream bg, animated card stack */}
        <TestimonialsSection data={content.testimonials} />

        {/* 7b. Feedback trigger */}
        <section style={{ background: "var(--color-cream-section)", paddingBottom: "clamp(32px,5vw,60px)" }}>
          <div className="text-center">
            <p style={{ fontFamily: "'Permanent Marker',cursive", fontSize: "clamp(0.62rem,0.96vw,0.78rem)", color: "var(--color-sage-light)", marginBottom: 10, transform: "rotate(-0.5deg)", display: "inline-block" }}>
              ✦ your voice matters
            </p>
            <div>
              <motion.button
                onClick={() => setFeedbackOpen(true)}
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.96 }}
                style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "clamp(1rem,1.6vw,1.2rem)", background: "var(--color-forest-dark)", color: "var(--color-cream-text)", border: "none", borderRadius: 50, padding: "clamp(10px,1.5vw,14px) clamp(24px,3.5vw,40px)", cursor: "pointer", boxShadow: "0 8px 28px rgba(30,41,24,0.22)", display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: "1.2rem" }}>✍️</span>
                Share Your Experience
              </motion.button>
            </div>
          </div>
        </section>

        {/* 8. Footer — white quick links + copyright */}
        <FooterSection data={content.footer} />

        {/* Global feedback modal */}
        <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      </div>
    </div>
  );
};

export default Index;
