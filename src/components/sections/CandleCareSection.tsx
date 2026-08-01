import { CandleCareContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { SkelText } from "@/components/ui/ContentSkeleton";

interface Props {
  data: CandleCareContent;
  /** False while the care copy is still loading. */
  ready?: boolean;
}

// Just the care cards — the page headline lives in CandleCarePage's PageHero,
// so this section deliberately has no header of its own (it used to repeat the
// same label + headline directly under the hero).
const CandleCareSection = ({ data, ready = true }: Props) => {
  const cards = ready ? (data.cards ?? []) : [];
  return (
  <section
    id="care"
    style={{
      background: "var(--bg-page)",
      // Top gap is the shared hero→body rhythm (index.css). It used to be
      // py-24/py-32, which left this page with a ~128px void the other nav
      // pages didn't have.
      paddingTop: "var(--page-body-pt)",
      paddingBottom: "clamp(3rem,6vw,5rem)",
    }}
  >
    <div className="max-w-7xl mx-auto px-6">
      {/* Cards */}
      <div className="grid sm:grid-cols-3 gap-6">
        {!ready && [0, 1, 2].map(i => (
          <div
            key={`skel-${i}`}
            className="p-8 space-y-5"
            style={{ background: "var(--color-cream-card)", borderRadius: "var(--radius-card)", border: "1px solid var(--color-border)", color: "var(--text-primary)" }}
          >
            <SkelText width="1.4em" style={{ fontSize: "var(--text-serif-xl)" }} />
            <div className="space-y-3">
              <SkelText width="64%" style={{ fontSize: "var(--text-serif-sm)" }} />
              <SkelText lines={3} lineHeight={1.6} style={{ fontSize: "0.875rem" }} />
            </div>
          </div>
        ))}
        {cards.map((card, i) => (
          <div
            key={`${card.number}-${i}`}
            className="p-8 space-y-5"
            style={{
              background: "var(--color-cream-card)",
              borderRadius: "var(--radius-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <span
              className="font-serif leading-none italic select-none block"
              style={{ fontSize: "var(--text-serif-xl)", color: "rgba(29,43,27,0.35)" }}
            >
              {card.number}
            </span>
            <div className="space-y-3">
              <h3
                className="font-serif font-semibold"
                style={{ fontSize: "var(--text-serif-sm)", color: "var(--text-primary)" }}
              >
                <RichText text={card.title} />
              </h3>
              <p
                className="font-sans text-sm leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                <RichText text={card.description} />
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
  );
};

export default CandleCareSection;
