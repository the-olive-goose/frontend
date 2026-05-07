import { BrandStoryContent } from "@/lib/defaults";

interface Props { data: BrandStoryContent }

const BrandStorySection = ({ data }: Props) => (
  <section id="story" className="bg-cream py-24 lg:py-32">
    <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
      {/* Text column */}
      <div className="space-y-6">
        <p className="font-sans text-xs tracking-[0.2em] uppercase text-primary font-medium">
          {data.label}
        </p>
        <h2 className="font-serif text-4xl sm:text-5xl text-charcoal leading-tight">
          {data.headline}
        </h2>
        <div className="space-y-4">
          {(data.body ?? "").split("\n\n").filter(Boolean).map((para, i) => (
            <p key={i} className="font-sans text-base text-charcoal/70 leading-relaxed">
              {para}
            </p>
          ))}
        </div>
        {data.cta_text && (
          <a
            href={data.cta_href}
            className="inline-flex items-center gap-2 font-sans text-sm font-medium text-primary hover:text-olive-light transition-colors group"
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
      <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-cream-dark">
        {data.image_url ? (
          <img
            src={data.image_url}
            alt="Brand story"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-3 p-8">
              <div className="w-16 h-16 rounded-full bg-primary/10 mx-auto flex items-center justify-center">
                <svg className="w-8 h-8 text-primary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="font-sans text-xs text-charcoal/30">Add image URL in admin</p>
            </div>
          </div>
        )}
      </div>
    </div>
  </section>
);

export default BrandStorySection;
