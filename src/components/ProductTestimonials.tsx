import RichText from "@/lib/richtext";
import type { ProductTestimonial } from "@/lib/defaults";
import { clampRating } from "@/lib/productTestimonials";

/**
 * Curated customer quotes for one candle, shown on its product page.
 *
 * Deliberately NOT a reviews system. Nothing here is collected, moderated or
 * aggregated on its own — the quotes are picked by the shop in Admin → Home Page
 * → Testimonials → Product Page Testimonials, exactly like the homepage
 * carousel, and this component only renders what was chosen. That keeps one
 * editing surface for every testimonial on the site instead of two systems with
 * two ideas of what a review is.
 *
 * Renders nothing when a candle has no quotes against it, which is the normal
 * state for a new product — an empty "what people say" heading reads worse than
 * no section at all.
 */

const Stars = ({ rating }: { rating: number }) => {
  // Same helper the structured data uses, so the stars on screen and the rating
  // handed to Google can never describe different numbers. A quote with no
  // usable rating draws no stars rather than a default five.
  const filled = clampRating(rating);
  if (filled === null) return null;
  return (
    <span
      className="tracking-tight"
      style={{ color: "var(--color-gold)", fontSize: "0.95rem" }}
      aria-label={`${filled} out of 5 stars`}
      role="img"
    >
      {"★".repeat(filled)}
      <span style={{ opacity: 0.3 }}>{"☆".repeat(5 - filled)}</span>
    </span>
  );
};

const QuoteCard = ({ item }: { item: ProductTestimonial }) => (
  <figure
    className="flex flex-col gap-3 p-5 h-full"
    style={{
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-card)",
      background: "var(--color-cream-card)",
    }}
  >
    <Stars rating={item.rating} />
    <blockquote
      className="font-sans text-sm leading-relaxed flex-1"
      style={{ color: "var(--text-primary)" }}
    >
      <RichText text={item.quote} />
    </blockquote>
    <figcaption className="flex items-center gap-3">
      {item.avatarUrl && (
        <img
          src={item.avatarUrl}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
          className="rounded-full object-cover shrink-0"
          style={{ width: 36, height: 36 }}
        />
      )}
      <span className="font-sans text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {item.author || "A customer"}
        </span>
        {item.location && <> · {item.location}</>}
      </span>
    </figcaption>
  </figure>
);

interface Props {
  /** Already filtered to this product by the caller. */
  items: ProductTestimonial[];
  headline: string;
}

const ProductTestimonials = ({ items, headline }: Props) => {
  if (items.length === 0) return null;

  return (
    <section className="max-w-6xl mx-auto px-6 pb-16 lg:pb-20">
      <h2
        className="font-display mb-6"
        style={{ fontSize: "var(--text-display-sm)", color: "var(--text-primary)" }}
      >
        <RichText text={headline} />
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((item) => (
          <QuoteCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
};

export default ProductTestimonials;
