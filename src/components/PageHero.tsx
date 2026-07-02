import type { ReactNode } from "react";

interface Props {
  eyebrow: string;
  title: ReactNode;
  subtitle?: string;
}

// Shared dark hero banner for brand/marketing pages (About, Care Instructions,
// Delivery & Returns, Contacts) — keeps the footer's Quick Links visually consistent.
const PageHero = ({ eyebrow, title, subtitle }: Props) => (
  <div className="w-full py-12 sm:py-16 px-6 text-center" style={{ background: "var(--color-forest-dark)" }}>
    <p className="font-display text-xs tracking-[0.2em] uppercase mb-3" style={{ color: "var(--color-gold)" }}>
      🕯️ &nbsp; {eyebrow} &nbsp; 🕯️
    </p>
    <h1 className="font-display font-semibold mb-4" style={{ fontSize: "clamp(1.9rem,7vw,4rem)", color: "var(--color-cream-text)", lineHeight: 1.05 }}>
      {title}
    </h1>
    {subtitle && (
      <p className="font-sans text-base max-w-md mx-auto leading-relaxed" style={{ color: "rgba(245,239,230,0.7)" }}>
        {subtitle}
      </p>
    )}
  </div>
);

export default PageHero;
