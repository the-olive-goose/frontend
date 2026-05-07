import { useEffect, useState } from "react";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type SiteContent } from "@/lib/defaults";
import NavbarSection from "@/components/sections/NavbarSection";
import CandleCareSection from "@/components/sections/CandleCareSection";
import FooterSection from "@/components/sections/FooterSection";

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
      <NavbarSection data={content.navbar} announcement={content.announcementBar} />
      {/* top padding = announcement bar (38px) + nav (~56px) */}
      <div className="pt-[94px]">
        {/* Page hero banner */}
        <div
          className="w-full py-16 px-6 text-center"
          style={{ background: "#1E2918" }}
        >
          <p
            className="font-sans text-xs font-semibold tracking-[0.22em] uppercase mb-3"
            style={{ color: "#C9B26D" }}
          >
            ✦ &nbsp; The Guide
          </p>
          <h1
            className="font-display text-4xl sm:text-5xl mb-4"
            style={{ color: "#F5EFE6" }}
          >
            {content.candleCare.headline_part1}{" "}
            <span style={{ color: "#C9B26D" }}>{content.candleCare.headline_part2}</span>
          </h1>
          <p
            className="font-sans text-sm max-w-md mx-auto leading-relaxed"
            style={{ color: "rgba(245,239,230,0.72)" }}
          >
            Everything you need to get the most out of your Olive Goose candle — no cap.
          </p>
        </div>

        <CandleCareSection data={content.candleCare} />
        <FooterSection data={content.footer} />
      </div>
    </div>
  );
};

export default CandleCarePage;
