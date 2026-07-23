import React from "react";
import { MomentPillContent } from "@/lib/defaults";

interface Props { data: MomentPillContent }

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

const InlineImage = ({ src, alt }: { src: string; alt: string }) => {
  const resolved = resolveAsset(src);
  return (
    <span
      className="inline-block align-middle mx-2 overflow-hidden shrink-0"
      style={{
        width: "72px",
        height: "38px",
        borderRadius: "var(--radius-pill)",
        background: "var(--color-sage-pale)",
        verticalAlign: "middle",
      }}
    >
      {resolved ? (
        <img src={resolved} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : (
        <span className="w-full h-full flex items-center justify-center text-xs" style={{ color: "var(--text-primary)" }}>
          img
        </span>
      )}
    </span>
  );
};

const MomentPillSection = ({ data }: Props) => (
  <section
    className="w-full flex items-center justify-center py-14 px-6"
    style={{ background: "var(--bg-moment-pill)" }}
  >
    <div
      className="w-full max-w-3xl flex flex-wrap items-center justify-center gap-y-1 px-8 py-8"
      style={{
        background: "var(--color-white)",
        borderRadius: "var(--radius-pill)",
        border: "2px solid var(--color-forest-dark)",
        lineHeight: 1.5,
      }}
    >
      <p
        className="font-display text-center w-full"
        style={{ fontSize: "clamp(1rem, 2.5vw, 1.25rem)", color: "var(--text-primary)" }}
      >
        {data.text1}
        <InlineImage src={data.image1_url} alt="A lit Olive Goose candle at home" />
        {data.text2}
        <InlineImage src={data.image2_url} alt="Calm, nature-inspired candlelight" />
      </p>
      <p
        className="font-display text-center w-full"
        style={{ fontSize: "clamp(1rem, 2.5vw, 1.25rem)", color: "var(--text-primary)" }}
      >
        {data.text3}
      </p>
    </div>
  </section>
);

export default MomentPillSection;
