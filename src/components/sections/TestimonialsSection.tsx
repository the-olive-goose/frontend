import { TestimonialsContent } from "@/lib/defaults";

interface Props { data: TestimonialsContent }

const Stars = ({ rating }: { rating: number }) => (
  <div className="flex gap-0.5">
    {Array.from({ length: 5 }).map((_, i) => (
      <svg
        key={i}
        className={`w-4 h-4 ${i < rating ? "text-warm-glow" : "text-charcoal/20"}`}
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
    ))}
  </div>
);

const TestimonialsSection = ({ data }: Props) => {
  const items = data.items ?? [];
  return (
  <section className="bg-cream py-24 lg:py-32">
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="text-center mb-16 space-y-4">
        <p className="font-sans text-xs tracking-[0.2em] uppercase text-primary font-medium">
          {data.label}
        </p>
        <h2 className="font-serif text-4xl sm:text-5xl text-charcoal">{data.headline}</h2>
      </div>

      {/* Testimonial cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map((item, i) => (
          <div
            key={item.id ?? i}
            className="bg-card rounded-2xl p-8 border border-border/60 space-y-5 flex flex-col"
          >
            <Stars rating={item.rating} />
            <blockquote className="font-serif text-xl text-charcoal leading-relaxed flex-1">
              "{item.quote}"
            </blockquote>
            <div className="pt-4 border-t border-border/60">
              <p className="font-sans text-sm font-medium text-charcoal">{item.author}</p>
              {item.location && (
                <p className="font-sans text-xs text-charcoal/50 mt-0.5">{item.location}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
  );
};

export default TestimonialsSection;
