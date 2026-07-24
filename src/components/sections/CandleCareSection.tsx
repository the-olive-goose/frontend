import { CandleCareContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";

interface Props { data: CandleCareContent }

// Just the care cards — the page headline lives in CandleCarePage's PageHero,
// so this section deliberately has no header of its own (it used to repeat the
// same label + headline directly under the hero).
const CandleCareSection = ({ data }: Props) => {
  const cards = data.cards ?? [];
  return (
  <section id="care" className="py-24 lg:py-32" style={{ background: "var(--bg-page)" }}>
    <div className="max-w-7xl mx-auto px-6">
      {/* Cards */}
      <div className="grid sm:grid-cols-3 gap-6">
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
