import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ProductsContent, type Product } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { formatPrice } from "@/lib/cart";
import { isOutOfStock, productPath } from "@/lib/products";
import { useCart } from "@/contexts/CartContext";

interface Props { data: ProductsContent }

const ProductsSection = ({ data }: Props) => {
  const items = data.items ?? [];
  const { addToCart } = useCart();

  // Same rule as the shop grid: anyone can fill a basket. Signing in is asked
  // for at checkout, and a guest basket merges into the account at that point.
  const handleAddToCart = async (product: Product) => {
    await addToCart(product);
    toast.success(`${product.name} added to cart`, {
      description: formatPrice(product.price),
      duration: 2500,
    });
  };

  return (
    <section id="collection" style={{ background: "var(--bg-products)" }} className="py-16 lg:py-20">
      <div className="max-w-6xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-12 space-y-2">
          <p className="eyebrow"><RichText text={data.label} /></p>
          <h2
            className="h-display"
            style={{ fontSize: "var(--text-display-md)", color: "var(--text-primary)" }}
          >
            <RichText text={data.headline} />
          </h2>
          {data.subtext && (
            <p
              className="font-sans text-sm max-w-xl mx-auto leading-relaxed mt-2"
              style={{ color: "var(--text-muted)" }}
            >
              <RichText text={data.subtext} />
            </p>
          )}
        </div>

        {/* Products grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((product) => {
            const outOfStock = isOutOfStock(product);
            return (
            <div
              key={product.id}
              className="group flex flex-col overflow-hidden transition-transform duration-300 hover:-translate-y-2"
              style={{ borderRadius: "var(--radius-product)", background: "transparent" }}
            >
              {/* Image */}
              <Link
                to={productPath(product)}
                aria-label={`View ${product.name}`}
                className="relative block w-full overflow-hidden"
                style={{
                  borderRadius: "var(--radius-product)",
                  aspectRatio: "3/4",
                  background: "var(--color-sage-pale)",
                }}
              >
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={`${product.name} — handmade candle by The Olive Goose`}
                    loading="lazy"
                    decoding="async"
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
                {product.tag && !outOfStock && (
                  <span
                    className="absolute top-4 left-4 pill-tag"
                    style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
                  >
                    {product.tag}
                  </span>
                )}
                {outOfStock && (
                  <span
                    className="absolute top-4 left-4 pill-tag"
                    style={{ background: "#6b6b6b", color: "#fff" }}
                  >
                    Out of stock
                  </span>
                )}
              </Link>

              {/* Info */}
              <div className="pt-4 pb-2 px-1 space-y-1.5 text-center">
                <h3
                  className="h-rounded"
                  style={{ fontSize: "1.1rem", color: "var(--text-primary)" }}
                >
                  <Link to={productPath(product)} className="hover:underline">{product.name}</Link>
                </h3>
                <p
                  className="font-sans text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  <RichText text={product.description} />
                </p>
                <p
                  className="font-rounded font-bold text-base"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatPrice(product.price)}
                </p>
                <button
                  onClick={() => handleAddToCart(product)}
                  disabled={outOfStock}
                  title={outOfStock ? "Out of stock" : undefined}
                  className="mt-1 w-full py-2.5 font-sans text-sm font-semibold transition-all hover:opacity-85 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: "var(--btn-dark-bg)",
                    color: "var(--btn-dark-text)",
                    borderRadius: "var(--radius-pill)",
                  }}
                >
                  {outOfStock ? "Out of Stock" : "Add to Cart"}
                </button>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default ProductsSection;
