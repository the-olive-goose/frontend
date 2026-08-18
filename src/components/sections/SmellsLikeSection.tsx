import React from "react";
import { HeroContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { SkelText } from "@/components/ui/ContentSkeleton";

interface Props {
  /** Hero Banner content — this band is the hero's tagline, edited alongside it. */
  data: HeroContent;
  /** False while the hero copy is still loading — a skeleton stands in for it. */
  ready?: boolean;
}

/**
 * The cream tagline band under the hero image. The words come from
 * Admin → Hero Banner → Tagline Band; the stickers are decoration and stay put.
 */
const SmellsLikeSection = ({ data, ready = true }: Props) => {
  const tagline = (data.tagline ?? "").trim();

  // An admin who clears the tagline wants the band gone — a strip of floating
  // emoji around nothing reads as a broken section, not as a design choice.
  if (ready && !tagline) return null;

  return (
    <section
      className="w-full flex items-center justify-center py-16 px-6"
      style={{ background: "var(--bg-smells-like)" }}
    >
      <div className="relative text-center select-none">
        {/* Gen-Z stickers */}
        <span className="absolute text-4xl sm:text-5xl pointer-events-none" style={{ top: "-0.6em", right: "18%", transform: "rotate(-10deg)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.08))" }} aria-hidden>🎀</span>
        <span className="absolute pointer-events-none" style={{ top: "-0.9em", left: "8%", fontSize: "2rem", transform: "rotate(12deg)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))" }} aria-hidden>⭐</span>
        <span className="absolute pointer-events-none" style={{ bottom: "-1em", right: "6%", fontSize: "1.6rem", transform: "rotate(-8deg)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))" }} aria-hidden>✨</span>
        <span className="absolute pointer-events-none" style={{ bottom: "-0.8em", left: "18%", fontSize: "1.5rem", transform: "rotate(6deg)", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.1))" }} aria-hidden>🌸</span>
        <span className="absolute pointer-events-none" style={{ top: "-0.5em", left: "38%", fontSize: "1.2rem", transform: "rotate(-5deg)", opacity: 0.8 }} aria-hidden>💅</span>

        <h2
          className="h-statement leading-tight"
          style={{ color: "#3d2410" }}
        >
          {/* Two skeleton lines match the band's usual wrap, so the real words
              land in the same box and the swap shifts nothing. */}
          {ready
            ? <RichText text={tagline} />
            : <SkelText lines={2} width="min(520px,80vw)" lineHeight={1.1} center />}
        </h2>
      </div>
    </section>
  );
};

export default SmellsLikeSection;
