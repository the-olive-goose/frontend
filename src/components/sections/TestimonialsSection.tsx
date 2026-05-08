import { TestimonialsContent } from "@/lib/defaults";
import { CircularTestimonials } from "@/components/ui/circular-testimonials";

interface Props { data: TestimonialsContent }

// Unsplash fallbacks when no avatar URL is provided
const FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80",
];

const TestimonialsSection = ({ data }: Props) => {
  const items = (data.items ?? []).filter((t) => t.quote);
  if (items.length === 0) return null;

  const mapped = items.map((item, i) => ({
    quote: item.quote,
    name: item.author,
    designation: item.location || "Verified Customer",
    src: item.avatarUrl || FALLBACK_IMAGES[i % FALLBACK_IMAGES.length],
  }));

  return (
    <section style={{ background: "var(--color-cream-section)" }} className="py-20">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header — same style as Videos section */}
        <div className="text-center mb-8">
          <span
            className="pill-tag inline-block mb-3"
            style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
          >
            {data.label}
          </span>
          <h2
            className="h-display"
            style={{ fontSize: "var(--text-display-lg)", color: "var(--text-primary)" }}
          >
            {data.headline}
          </h2>
        </div>

        {/* Circular testimonials — centred */}
        <div className="flex justify-center">
          <CircularTestimonials
            testimonials={mapped}
            autoplay={true}
            colors={{
              name: "var(--text-primary, #1B2A1B)",
              designation: "var(--text-muted, #6b7280)",
              testimony: "var(--text-primary, #1B2A1B)",
              arrowBackground: "var(--color-forest-dark, #1B2A1B)",
              arrowForeground: "var(--color-cream-text, #F5EFE6)",
              arrowHoverBackground: "var(--color-sage-mid, #5C7A5C)",
            }}
            fontSizes={{
              name: "1.375rem",
              designation: "0.875rem",
              quote: "1.0625rem",
            }}
          />
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
