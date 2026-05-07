import { CandleCareContent } from "@/lib/defaults";

interface Props { data: CandleCareContent }

const CandleCareSection = ({ data }: Props) => {
  const cards = data.cards ?? [];
  return (
  <section id="care" className="bg-cream py-24 lg:py-32">
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="text-center mb-16">
        <p className="font-sans text-xs tracking-[0.25em] uppercase text-primary font-medium mb-6">
          {data.label}
        </p>
        <h2 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-charcoal">
          {data.headline_part1}{" "}
          <em className="text-primary not-italic" style={{ fontStyle: "italic" }}>
            {data.headline_part2}
          </em>
        </h2>
      </div>

      {/* Cards */}
      <div className="grid sm:grid-cols-3 gap-6">
        {cards.map((card, i) => (
          <div
            key={`${card.number}-${i}`}
            className="bg-card rounded-2xl p-8 border border-border/60 space-y-5"
          >
            <span className="font-serif text-6xl text-primary/40 leading-none italic select-none">
              {card.number}
            </span>
            <div className="space-y-3">
              <h3 className="font-serif text-xl font-semibold text-charcoal">{card.title}</h3>
              <p className="font-sans text-sm text-charcoal/65 leading-relaxed">{card.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
  );
};

export default CandleCareSection;
