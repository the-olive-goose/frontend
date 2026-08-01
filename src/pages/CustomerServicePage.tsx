import { DEFAULT_CONTENT } from "@/lib/defaults";
import { Link } from "react-router-dom";
import PageHero from "@/components/PageHero";
import FooterSection from "@/components/sections/FooterSection";
import { useContent } from "@/hooks/useContent";
import { SkelText } from "@/components/ui/ContentSkeleton";

const CustomerServicePage = () => {
  const { data: content, ready } = useContent("customerService", DEFAULT_CONTENT.customerService);

  return (
    <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>
      <div>
        <PageHero eyebrow="We're Here to Help" title={content.heading} titleGold={content.heading_gold} subtitle={content.intro} ready={ready} />

        <div className="max-w-2xl mx-auto px-6 sm:px-12 pt-[var(--page-body-pt)] pb-12 sm:pb-16 space-y-6">
          <div className="bg-white rounded-2xl p-6 sm:p-8 space-y-4" style={{ border: "1px solid var(--color-border)" }}>
            <div className="flex flex-wrap gap-6" style={{ color: "var(--color-forest-dark)" }}>
              {!ready && <SkelText width="220px" style={{ fontSize: "0.875rem" }} />}
              {ready && <a href={`mailto:${content.contact_email}`}
                className="font-sans text-sm font-semibold hover:underline" style={{ color: "var(--color-forest-dark)" }}>
                ✉ &nbsp;{content.contact_email}
              </a>}
              {ready && content.contact_phone && (
                <a href={`tel:${content.contact_phone}`}
                  className="font-sans text-sm font-semibold hover:underline" style={{ color: "var(--color-forest-dark)" }}>
                  ☎ &nbsp;{content.contact_phone}
                </a>
              )}
            </div>
          </div>

          {/* FAQs live on their own page now — point people there. */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 space-y-2" style={{ border: "1px solid var(--color-border)" }}>
            <p className="font-sans text-sm font-semibold" style={{ color: "var(--color-forest-dark)" }}>
              Looking for quick answers?
            </p>
            <p className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.72)" }}>
              Shipping times, order changes and candle safety are covered in our{" "}
              <Link to="/faq" className="font-semibold underline" style={{ color: "var(--color-forest-dark)" }}>
                frequently asked questions
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
      <FooterSection />
    </div>
  );
};

export default CustomerServicePage;
