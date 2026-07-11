import { ProductsContent } from "@/lib/defaults";
import { formatPrice } from "@/lib/cart";

interface Props { data: ProductsContent }

const ProductsSection = ({ data }: Props) => {
  const items = data.items ?? [];

  return (
    <section id="collection" style={{ background: "var(--bg-products)" }} className="py-16 lg:py-20">
      <div className="max-w-6xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-12 space-y-2">
          <p className="eyebrow">{data.label}</p>
          <h2
            className="h-display"
            style={{ fontSize: "var(--text-display-md)", color: "var(--text-primary)" }}
          >
            {data.headline}
          </h2>
          {data.subtext && (
            <p
              className="font-sans text-sm max-w-xl mx-auto leading-relaxed mt-2"
              style={{ color: "var(--text-muted)" }}
            >
              {data.subtext}
            </p>
          )}
        </div>

        {/* Products grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((product) => (
            <div
              key={product.id}
              className="group flex flex-col overflow-hidden transition-transform duration-300 hover:-translate-y-2"
              style={{ borderRadius: "var(--radius-product)", background: "transparent" }}
            >
              {/* Image */}
              <div
                className="relative w-full overflow-hidden"
                style={{
                  borderRadius: "var(--radius-product)",
                  aspectRatio: "3/4",
                  background: "var(--color-sage-pale)",
                }}
              >
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-16 h-16 opacity-30" fill="none" stroke="var(--color-forest-dark)" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
                {product.tag && (
                  <span
                    className="absolute top-4 left-4 pill-tag"
                    style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
                  >
                    {product.tag}
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="pt-4 pb-2 px-1 space-y-1.5 text-center">
                <h3
                  className="h-rounded"
                  style={{ fontSize: "1.1rem", color: "var(--text-primary)" }}
                >
                  {product.name}
                </h3>
                <p
                  className="font-sans text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {product.description}
                </p>
                <p
                  className="font-rounded font-bold text-base"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatPrice(product.price)}
                </p>
                <button
                  className="mt-1 w-full py-2.5 font-sans text-sm font-semibold transition-all hover:opacity-85 active:scale-95"
                  style={{
                    background: "var(--btn-dark-bg)",
                    color: "var(--btn-dark-text)",
                    borderRadius: "var(--radius-pill)",
                  }}
                >
                  Add to Cart
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProductsSection;
