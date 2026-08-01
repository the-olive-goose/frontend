import type { CSSProperties } from "react";

/**
 * Placeholders for admin-editable content that has not loaded yet.
 *
 * The rule these exist to enforce: never paint the bundled DEFAULT_* copy as if
 * it were real data. A visitor should see a placeholder shape, then the true
 * copy — never someone else's headline, or a free-shipping threshold that was
 * deleted a year ago, for the half second before the fetch lands.
 *
 * Everything is sized in `em` and inherits `currentColor` (see `.og-skel` in
 * index.css), so a skeleton dropped inside a heading takes that heading's size
 * and colour context automatically. Give it the same wrapper/margins the real
 * element has and the swap costs zero layout shift.
 */

interface SkelTextProps {
  /** Number of lines to reserve. Matches the real copy's typical wrap. */
  lines?: number;
  /** Width of the block. The last line is shortened so it reads as prose. */
  width?: string;
  /** Line box height, in em of the inherited font-size. */
  lineHeight?: number;
  /** Centres the lines — for the many centred headings on this site. */
  center?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const SkelText = ({
  lines = 1,
  width = "100%",
  lineHeight = 1.15,
  center = false,
  className,
  style,
}: SkelTextProps) => (
  <span
    aria-hidden="true"
    className={className}
    style={{
      display: "flex",
      flexDirection: "column",
      gap: `${Math.max(lineHeight * 0.32, 0.22)}em`,
      alignItems: center ? "center" : "stretch",
      width,
      maxWidth: "100%",
      marginInline: center ? "auto" : undefined,
      ...style,
    }}
  >
    {Array.from({ length: lines }, (_, i) => (
      <span
        key={i}
        className="og-skel"
        style={{
          height: `${lineHeight}em`,
          // A last line at full width reads as a bar, not a sentence.
          width: lines > 1 && i === lines - 1 ? "62%" : "100%",
        }}
      />
    ))}
  </span>
);

interface SkelBlockProps {
  /** Any CSS length — images, hero panels and video tiles size in px or %. */
  height?: string;
  width?: string;
  radius?: string;
  className?: string;
  style?: CSSProperties;
}

/** A solid placeholder for a non-text element: image, video tile, hero panel. */
export const SkelBlock = ({
  height = "100%",
  width = "100%",
  radius = "var(--radius-card)",
  className,
  style,
}: SkelBlockProps) => (
  <span
    aria-hidden="true"
    className={`og-skel ${className ?? ""}`}
    style={{ height, width, borderRadius: radius, ...style }}
  />
);

/**
 * Stands in for one ProductCard. Mirrors its 3/4 image ratio, padding and the
 * name / description / price rhythm, so a grid of these settles into the real
 * grid without a jump. Phones show two per row (see `og-card-foot`), which the
 * flex basis here matches.
 */
export const SkelProductCard = ({ isDark = false }: { isDark?: boolean }) => (
  <div
    aria-hidden="true"
    style={{
      flex: "1 1 0",
      minWidth: 0,
      background: isDark ? "rgba(255,255,255,0.09)" : "var(--color-cream-card)",
      border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "var(--color-border)"}`,
      borderRadius: "var(--radius-card)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      boxShadow: isDark ? "0 8px 28px rgba(0,0,0,0.45)" : "0 4px 18px rgba(0,0,0,0.07)",
    }}
  >
    <span className="og-skel" style={{ aspectRatio: "3/4", width: "100%", borderRadius: 0 }} />
    <div style={{ padding: "clamp(11px,3.2vw,16px)", display: "flex", flexDirection: "column", gap: 8 }}>
      <SkelText width="72%" style={{ fontSize: "clamp(1rem,1.6vw,1.25rem)" }} />
      <SkelText lines={2} lineHeight={1.45} style={{ fontSize: "clamp(0.78rem,1vw,0.875rem)" }} />
      <SkelText width="45%" style={{ fontSize: "clamp(1.05rem,1.7vw,1.3rem)" }} />
    </div>
  </div>
);

/** Stands in for a scrapbook category tile while the real categories load. */
export const SkelCategoryCard = ({ height = "clamp(190px,26vw,260px)" }: { height?: string }) => (
  <div
    aria-hidden="true"
    style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}
  >
    <SkelBlock height={height} />
    <SkelText width="66%" style={{ fontSize: "clamp(0.9rem,1.4vw,1.05rem)" }} />
  </div>
);
