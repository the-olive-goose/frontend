import { DEFAULT_CONTENT } from "@/lib/defaults";
import { useContent } from "@/hooks/useContent";
import CandleCareSection from "@/components/sections/CandleCareSection";
import FooterSection from "@/components/sections/FooterSection";
import PageHero from "@/components/PageHero";
import { useJsonLd } from "@/hooks/useJsonLd";
import { breadcrumbJsonLd } from "@/lib/seo";

const CandleCarePage = () => {
  // Navbar, announcement bar and footer own their own copy elsewhere; this page
  // only needs the care content it actually renders.
  const { data: candleCare, ready } = useContent("candleCare", DEFAULT_CONTENT.candleCare);

  useJsonLd("breadcrumb", breadcrumbJsonLd([["Home", "/"], ["Candle Care Guide", "/candle-care"]]));

  return (
    <div className="w-full">
      {/* PageHero owns the nav offset — don't re-add pt-[var(--nav-h)] here. */}
      <div>
        <PageHero
          eyebrow={candleCare.label}
          title={candleCare.headline_part1}
          titleGold={candleCare.headline_part2}
          subtitle={candleCare.hero_subtitle ?? DEFAULT_CONTENT.candleCare.hero_subtitle}
          ready={ready}
        />

        <CandleCareSection data={candleCare} ready={ready} />
        <FooterSection />
      </div>
    </div>
  );
};

export default CandleCarePage;
