import { useEffect, useState } from "react";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type GiftCardsContent } from "@/lib/defaults";
import FooterSection from "@/components/sections/FooterSection";

const GiftCardsPage = () => {
  const [content, setContent] = useState<GiftCardsContent>(DEFAULT_CONTENT.giftCards);
  const [email, setEmail] = useState("");
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    getContent("giftCards", DEFAULT_CONTENT.giftCards).then(setContent);
  }, []);

  const handleNotify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setNotified(true);
  };

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[112px]">
        <div className="max-w-2xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>{content.heading}</h1>
          <div className="mt-3 mb-5" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-2xl mx-auto px-3 sm:px-8 py-4 sm:py-6 space-y-4">
          <div className="bg-white rounded-xl p-6 space-y-5 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <p className="font-sans text-sm leading-relaxed" style={{ color: "#333" }}>{content.intro}</p>

            <div className="flex flex-wrap justify-center gap-3">
              {content.denominations.map(d => (
                <div key={d} className="px-6 py-4 rounded-xl font-display font-bold text-lg"
                  style={{ background: "#f5efe6", border: "1px solid var(--color-gold, #C9B26D)", color: "#1D2B1B", opacity: content.available ? 1 : 0.55 }}>
                  {d}
                </div>
              ))}
            </div>

            <p className="font-sans text-xs" style={{ color: "#555" }}>{content.note}</p>

            {content.available ? (
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
      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default GiftCardsPage;
