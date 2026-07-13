import { useEffect, useState } from "react";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type SiteContent } from "@/lib/defaults";
import CandleCareSection from "@/components/sections/CandleCareSection";
import FooterSection from "@/components/sections/FooterSection";
import PageHero from "@/components/PageHero";

const CandleCarePage = () => {
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);

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
      {/* top padding = announcement bar (38px) + nav (~56px) */}
      <div className="pt-[var(--nav-h,112px)]">
        <PageHero
          eyebrow="The Guide"
          title={<>{content.candleCare.headline_part1}{" "}<span style={{ color: "var(--color-gold)" }}>{content.candleCare.headline_part2}</span></>}
          subtitle="Everything you need to get the most out of your Olive Goose candle — no cap."
        />

        <CandleCareSection data={content.candleCare} />
        <FooterSection data={content.footer} />
      </div>
    </div>
  );
};

export default CandleCarePage;
