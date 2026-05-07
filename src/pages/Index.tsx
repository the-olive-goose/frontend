import { useEffect, useState } from "react";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type SiteContent } from "@/lib/defaults";
import logo from "@/assets/logo.png";

import NavbarSection      from "@/components/sections/NavbarSection";
import HeroSection        from "@/components/sections/HeroSection";
import SmellsLikeSection  from "@/components/sections/SmellsLikeSection";
import ProductsSection    from "@/components/sections/ProductsSection";
import MomentPillSection  from "@/components/sections/MomentPillSection";
import WelcomeSection     from "@/components/sections/WelcomeSection";
import FooterSection      from "@/components/sections/FooterSection";

const Index = () => {
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
  const [loaded, setLoaded] = useState(false);

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
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#1E2918" }}>
        <img src={logo} alt="The Olive Goose" className="w-24 h-24 animate-logo-reveal" width={512} height={512} />
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Fixed header: announcement bar (38px) + nav (~56px) = 94px */}
      <NavbarSection data={content.navbar} announcement={content.announcementBar} />

      <div className="pt-[94px]">
        {/* 1. Hero — full-width image */}
        <HeroSection data={content.hero} />

        {/* 2. "SMELLS LIKE YOUR CAFÉ ERA." — cream bg */}
        <SmellsLikeSection />

        {/* 3. Products — green bg */}
        <ProductsSection data={content.products} />

        {/* 4. "Live in the moment" pill — green bg */}
        <MomentPillSection data={content.momentPill} />

        {/* 5. "Welcome to the Olive Goose Club!" — green bg */}
        <WelcomeSection data={content.welcomeClub} />

        {/* 6. Footer — white quick links + copyright */}
        <FooterSection data={content.footer} />
      </div>
    </div>
  );
};

export default Index;
