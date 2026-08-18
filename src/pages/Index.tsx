import { useState } from "react";
import { motion } from "framer-motion";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { useContent } from "@/hooks/useContent";
import FeedbackModal      from "@/components/FeedbackModal";
import SubscribePopupCard from "@/components/SubscribePopupCard";
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Each section reads what it needs and skeletons until that arrives. The page
  // used to hide behind a full-screen logo splash while one Promise.all covered
  // every section, which meant the slowest section held up the whole homepage.
  // The navbar, announcement bar and footer own their own content elsewhere, so
  // they are deliberately not fetched here.
  const hero         = useContent("hero",           DEFAULT_CONTENT.hero);
  const momentPill   = useContent("momentPill",     DEFAULT_CONTENT.momentPill);
  const welcomeClub  = useContent("welcomeClub",    DEFAULT_CONTENT.welcomeClub);
  const videos       = useContent("videos",         DEFAULT_CONTENT.videos);
  const testimonials = useContent("testimonials",   DEFAULT_CONTENT.testimonials);
  const subscribe    = useContent("subscribePopup", DEFAULT_CONTENT.subscribePopup);

  return (
    <div className="w-full">
      {/* Fixed header height is published by NavbarSection as the --nav-h CSS var
          (it varies by breakpoint); the hero measures #site-navbar directly. */}

      <div style={{ marginTop: 0, paddingTop: 0 }}>
        {/* 1. Hero — full-width image, flush from top of viewport behind navbar */}
        <HeroSection data={hero.data} ready={hero.ready} />

        {/* 2. Hero tagline band ("SMELLS LIKE YOUR CAFÉ ERA.") — cream bg */}
        <SmellsLikeSection data={hero.data} ready={hero.ready} />

        {/* 3. New Arrivals — products tagged "new" */}
        <NewArrivalsSection />

        {/* 4. Shop By Category — scrapbook */}
        <ScrapbookSection />

        {/* 4. "Live in the moment" pill — green bg */}
        <MomentPillSection data={momentPill.data} ready={momentPill.ready} />

        {/* 5. Welcome to the Olive Goose Club */}
        <WelcomeSection data={welcomeClub.data} ready={welcomeClub.ready} />

        {/* 6. Videos */}
        <VideosSection data={videos.data} ready={videos.ready} />

        {/* 7. Testimonials — cream bg, animated card stack */}
        <TestimonialsSection data={testimonials.data} ready={testimonials.ready} />

        {/* 7b. Feedback trigger */}
        <section style={{ background: "var(--color-cream-section)", paddingBottom: "clamp(32px,5vw,60px)" }}>
          <div className="text-center">
            <p style={{ fontFamily: "'Permanent Marker',cursive", fontSize: "clamp(0.62rem,0.96vw,0.78rem)", color: "var(--color-sage-light)", marginBottom: 10, transform: "rotate(-0.5deg)", display: "inline-block" }}>
              🕯️ your voice matters 🕯️
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
        <FooterSection />

        {/* Global feedback modal */}
        <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

        {/* First-visit subscribe playcard — bottom left, once per session */}
        <SubscribePopupCard data={subscribe.data} ready={subscribe.ready} />
      </div>
    </div>
  );
};

export default Index;
