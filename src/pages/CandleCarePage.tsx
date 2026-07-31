import { useEffect, useState } from "react";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type SiteContent } from "@/lib/defaults";
import CandleCareSection from "@/components/sections/CandleCareSection";
import FooterSection from "@/components/sections/FooterSection";
import PageHero from "@/components/PageHero";
import { useJsonLd } from "@/hooks/useJsonLd";
import { breadcrumbJsonLd } from "@/lib/seo";

const CandleCarePage = () => {
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);

  useJsonLd("breadcrumb", breadcrumbJsonLd([["Home", "/"], ["Candle Care Guide", "/candle-care"]]));

  useEffect(() => {
    const load = async () => {
      try {
        const [announcementBar, navbar, candleCare, footer] = await Promise.all([
          getContent("announcementBar", DEFAULT_CONTENT.announcementBar),
          getContent("navbar",          DEFAULT_CONTENT.navbar),
          getContent("candleCare",      DEFAULT_CONTENT.candleCare),
          getContent("footer",          DEFAULT_CONTENT.footer),
        ]);
        setContent((prev) => ({ ...prev, announcementBar, navbar, candleCare, footer }));
      } catch {
        /* fall back to defaults */
      }
    };
    load();
  }, []);

  return (
    <div className="w-full">
      {/* PageHero owns the nav offset — don't re-add pt-[var(--nav-h)] here. */}
      <div>
        <PageHero
          eyebrow={content.candleCare.label}
          title={content.candleCare.headline_part1}
          titleGold={content.candleCare.headline_part2}
          subtitle={content.candleCare.hero_subtitle ?? DEFAULT_CONTENT.candleCare.hero_subtitle}
        />

        <CandleCareSection data={content.candleCare} />
        <FooterSection data={content.footer} />
      </div>
    </div>
  );
};

export default CandleCarePage;
