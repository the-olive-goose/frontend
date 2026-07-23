import { BrandStoryContent } from "@/lib/defaults";

interface Props { data: BrandStoryContent }

const BrandStorySection = ({ data }: Props) => (
  <section id="story" className="py-24 lg:py-32" style={{ background: "var(--bg-page)" }}>
    <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
      {/* Text column */}
      <div className="space-y-6">
        <p className="eyebrow">{data.label}</p>
        <h2
          className="font-serif leading-tight"
          style={{ fontSize: "var(--text-serif-lg)", color: "var(--text-primary)" }}
        >
          {data.headline}
        </h2>
        <div className="space-y-4">
          {(data.body ?? "").split("\n\n").filter(Boolean).map((para, i) => (
            <p key={i} className="font-sans text-base leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {para}
            </p>
          ))}
        </div>
        {data.cta_text && (
          <a
            href={data.cta_href}
            className="inline-flex items-center gap-2 font-sans text-sm font-medium transition-colors group"
            style={{ color: "var(--text-primary)" }}
          >
            {data.cta_text}
            <svg
              className="w-4 h-4 transform group-hover:translate-x-1 transition-transform"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </a>
        )}
      </div>

      {/* Image column */}
      <div
        className="aspect-[4/5] overflow-hidden"
        style={{ borderRadius: "var(--radius-card)", background: "var(--color-cream-button)" }}
      >
        {data.image_url ? (
          <img
            src={data.image_url}
            alt="The Olive Goose story — hand-pouring candles in Dublin"
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-3 p-8">
              <div
                className="w-16 h-16 rounded-full mx-auto flex items-center justify-center"
                style={{ background: "rgba(29,43,27,0.08)" }}
              >
                <svg className="w-8 h-8" style={{ color: "rgba(29,43,27,0.3)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="font-sans text-xs" style={{ color: "var(--text-muted)" }}>Add image URL in admin</p>
            </div>
          </div>
        )}
      </div>
    </div>
  </section>
);

export default BrandStorySection;
