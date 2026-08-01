import React from "react";
import { MomentPillContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { SkelText } from "@/components/ui/ContentSkeleton";

interface Props {
  data: MomentPillContent;
  /** False while the pill copy is still loading. */
  ready?: boolean;
}

// Bundle every image in src/assets/ at build time
const assetMap = import.meta.glob(
  "@/assets/*.{jpg,jpeg,png,gif,webp,svg}",
  { eager: true, import: "default" }
) as Record<string, string>;

/**
 * Accepts either a bare filename ("hero-bg.jpg") or any URL.
 * Bare filenames are resolved to the Vite-bundled asset URL.
 */
function resolveAsset(nameOrUrl: string): string {
  if (!nameOrUrl) return "";
  if (nameOrUrl.startsWith("http") || nameOrUrl.startsWith("/")) return nameOrUrl;
  const key = Object.keys(assetMap).find((k) => k.endsWith("/" + nameOrUrl));
  return key ? assetMap[key] : nameOrUrl;
}

/** The photo sits on the line it belongs to, like a word. Scales with the copy. */
const InlineImage = ({ src, alt }: { src: string; alt: string }) => {
  const resolved = resolveAsset(src);
  // An unset photo renders nothing at all — a grey "img" chip mid-sentence
  // reads as a broken image to a customer, and the line still scans without it.
  if (!resolved) return null;
  return (
    <span
      className="block overflow-hidden shrink-0"
      style={{
        width: "clamp(46px,12vw,72px)",
        height: "clamp(24px,6.4vw,38px)",
        borderRadius: "var(--radius-pill)",
        background: "var(--color-sage-pale)",
      }}
    >
      <img src={resolved} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover" />
    </span>
  );
};

const ALT1 = "A lit Olive Goose candle at home";
const ALT2 = "Calm, nature-inspired candlelight";

const MomentPillSection = ({ data, ready = true }: Props) => {
  // Admin copy routinely arrives with a leading or trailing blank line (the
  // fields used to carry a literal "/n" line break). Untrimmed, that renders as
  // an empty row inside the pill and reads as a spacing bug rather than content.
  const line1 = (data.text1 ?? "").trim();
  const line2 = (data.text2 ?? "").trim();
  const line3 = (data.text3 ?? "").trim();

  // One layout at every width — phone and desktop read identically. Type, photo
  // and padding are all fluid instead, so the two lines still fit across a
  // 390px phone without breaking apart.
  // The whole row (type, photo, gaps) scales with the viewport, so a line that
  // fits on one phone fits on every phone down to ~285px instead of breaking
  // apart on the narrow ones.
  const lineStyle: React.CSSProperties = {
    fontSize: "clamp(0.86rem,4.1vw,1.25rem)",
    color: "var(--text-primary)",
  };
  const rowClass = "font-display flex items-center justify-center";
  const rowStyle: React.CSSProperties = { gap: "clamp(6px,1.8vw,12px)" };

  return (
    <section
      className="w-full flex items-center justify-center py-12 sm:py-14 px-4 sm:px-6"
      style={{ background: "var(--bg-moment-pill)" }}
    >
      {/* Width follows the copy (capped at 3xl) rather than always filling the
          row — a fixed-width stadium around two short lines is what left all
          that empty space around the words. */}
      <div
        className="max-w-3xl inline-flex flex-col items-center justify-center gap-1.5"
        style={{
          background: "var(--color-white)",
          borderRadius: "var(--radius-pill)",
          border: "2px solid var(--color-forest-dark)",
          lineHeight: 1.5,
          padding: "clamp(20px,3vw,28px) clamp(18px,7vw,56px)",
        }}
      >
        {/* Two lines, each a flex row so a photo can never be orphaned onto a
            line of its own: line 1 is text1 + photo 1, line 2 runs
            text2 + photo 2 + text3 straight through. */}
        {ready ? (
          <>
            <p className={rowClass} style={{ ...rowStyle, ...lineStyle }}>
              <span><RichText text={line1} /></span>
              <InlineImage src={data.image1_url} alt={ALT1} />
            </p>
            <p className={rowClass} style={{ ...rowStyle, ...lineStyle }}>
              <span><RichText text={line2} /></span>
              <InlineImage src={data.image2_url} alt={ALT2} />
              {line3 && <span><RichText text={line3} /></span>}
            </p>
          </>
        ) : (
          <>
            <p className={rowClass} style={{ ...rowStyle, ...lineStyle }}>
              <SkelText width="min(300px,64vw)" lineHeight={1.5} />
            </p>
            <p className={rowClass} style={{ ...rowStyle, ...lineStyle }}>
              <SkelText width="min(340px,72vw)" lineHeight={1.5} />
            </p>
          </>
        )}
      </div>
    </section>
  );
};

export default MomentPillSection;
