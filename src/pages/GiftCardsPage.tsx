import { useState } from "react";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { useContent } from "@/hooks/useContent";
import { SkelBlock, SkelCopy } from "@/components/ui/ContentSkeleton";
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
            {ready ? <RichText text={content.heading} /> : <SkelCopy lineHeight={1.2}><RichText text={content.heading} /></SkelCopy>}
          </h1>
          <div className="mt-3 mb-5" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-2xl mx-auto px-3 sm:px-8 py-4 sm:py-6 space-y-4">
          <div className="bg-white rounded-xl p-6 space-y-5 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            {/* Every placeholder on this card is sized against the copy it is
                standing in for (hidden, never painted) — a guessed line count
                left the card growing under the visitor as each field landed. */}
            <p className="font-sans text-sm leading-relaxed" style={{ color: "#333" }}>
              {ready ? <RichText text={content.intro} /> : <SkelCopy lineHeight={1.625}><RichText text={content.intro} /></SkelCopy>}
            </p>

            <div className="flex flex-wrap justify-center gap-3" style={{ color: "#1D2B1B" }}>
              {/* Sized like the real €-chips (px-6 py-4 around text-lg), so the
                  three of them stay on one row on a phone — at 104px wide they
                  wrapped onto a second row and the card collapsed by 70px when
                  the real denominations landed. */}
              {!ready && content.denominations.map(d => (
                <SkelBlock key={d} height="62px" width="84px" radius="12px" />
              ))}
              {ready && content.denominations.map(d => (
                <div key={d} className="px-6 py-4 rounded-xl font-display font-bold text-lg"
                  style={{ background: "#f5efe6", border: "1px solid var(--color-gold, #C9B26D)", color: "#1D2B1B", opacity: content.available ? 1 : 0.55 }}>
                  {d}
                </div>
              ))}
            </div>

            <p className="font-sans text-xs" style={{ color: "#555" }}>
              {ready ? <RichText text={content.note} /> : <SkelCopy lineHeight={1.5}><RichText text={content.note} /></SkelCopy>}
            </p>

            {/* The button and the notify form are different heights, so the
                placeholder follows whichever one the fallback says is coming. */}
            {!ready ? (
              <SkelBlock
                height={content.available ? "42px" : "94px"}
                width={content.available ? "180px" : "min(384px,100%)"}
                radius={content.available ? "var(--radius-pill)" : "var(--radius-card)"}
                style={{ color: "#1D2B1B", margin: "0 auto" }}
              />
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
