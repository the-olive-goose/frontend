import { useState } from "react";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { useContent } from "@/hooks/useContent";
import { SkelBlock, SkelText } from "@/components/ui/ContentSkeleton";
import FooterSection from "@/components/sections/FooterSection";
import RichText from "@/lib/richtext";
import { useJsonLd } from "@/hooks/useJsonLd";
import { breadcrumbJsonLd } from "@/lib/seo";

const GiftCardsPage = () => {
  const { data: content, ready } = useContent("giftCards", DEFAULT_CONTENT.giftCards);

  useJsonLd("breadcrumb", breadcrumbJsonLd([["Home", "/"], ["Gift Cards", "/gift-cards"]]));
  const [email, setEmail] = useState("");
  const [notified, setNotified] = useState(false);

  const handleNotify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setNotified(true);
  };

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[var(--nav-h,112px)]">
        <div className="max-w-2xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>
            {ready ? <RichText text={content.heading} /> : <SkelText width="340px" />}
          </h1>
          <div className="mt-3 mb-5" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-2xl mx-auto px-3 sm:px-8 py-4 sm:py-6 space-y-4">
          <div className="bg-white rounded-xl p-6 space-y-5 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <p className="font-sans text-sm leading-relaxed" style={{ color: "#333" }}>
              {ready ? <RichText text={content.intro} /> : <SkelText lines={2} lineHeight={1.6} center />}
            </p>

            <div className="flex flex-wrap justify-center gap-3" style={{ color: "#1D2B1B" }}>
              {!ready && [0, 1, 2].map(i => <SkelBlock key={i} height="60px" width="104px" radius="12px" />)}
              {ready && content.denominations.map(d => (
                <div key={d} className="px-6 py-4 rounded-xl font-display font-bold text-lg"
                  style={{ background: "#f5efe6", border: "1px solid var(--color-gold, #C9B26D)", color: "#1D2B1B", opacity: content.available ? 1 : 0.55 }}>
                  {d}
                </div>
              ))}
            </div>

            <p className="font-sans text-xs" style={{ color: "#555" }}>
              {ready ? <RichText text={content.note} /> : <SkelText width="70%" center />}
            </p>

            {!ready ? (
              <SkelBlock height="42px" width="180px" radius="var(--radius-pill)" style={{ color: "#1D2B1B", margin: "0 auto" }} />
            ) : content.available ? (
              <a href="/shop" className="inline-block font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                Buy a Gift Card
              </a>
            ) : (
              <form onSubmit={handleNotify} className="flex flex-col sm:flex-row gap-2 justify-center max-w-sm mx-auto">
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 px-3 py-2 rounded-lg font-sans text-sm outline-none"
                  style={{ border: "1px solid #ccc", background: "#fff", color: "#111" }} />
                <button type="submit"
                  className="font-sans text-sm font-bold px-5 py-2 rounded-lg transition-all hover:brightness-95 active:scale-95 whitespace-nowrap"
                  style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                  {content.cta_text}
                </button>
              </form>
            )}
            {notified && (
              <p className="font-sans text-sm font-semibold" style={{ color: "#007600" }}>
                Thanks — we'll email you when gift cards launch ✓
              </p>
            )}
          </div>
        </div>
      </div>
      <FooterSection />
    </div>
  );
};

export default GiftCardsPage;
