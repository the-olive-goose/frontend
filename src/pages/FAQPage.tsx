import { Link } from "react-router-dom";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { useContent } from "@/hooks/useContent";
import { SkelText } from "@/components/ui/ContentSkeleton";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import PageHero from "@/components/PageHero";
import RichText, { stripRichText } from "@/lib/richtext";
import FooterSection from "@/components/sections/FooterSection";
import { useJsonLd } from "@/hooks/useJsonLd";
import { breadcrumbJsonLd } from "@/lib/seo";

/**
 * Dedicated FAQ page. The Q&As come from the same admin-managed
 * "customerService" content store as the contact page, so editing FAQs in the
 * admin panel updates both this page and its FAQPage structured data.
 */
const FAQPage = () => {
  const { data: content, ready } = useContent("customerService", DEFAULT_CONTENT.customerService);

  useJsonLd("breadcrumb", breadcrumbJsonLd([["Home", "/"], ["FAQs", "/faq"]]));

  // FAQPage structured data mirroring the visible Q&A accordion below.
  useJsonLd(
    "faq",
    !ready || content.faqs.length === 0
      ? null
      : {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: content.faqs.map((faq) => ({
            "@type": "Question",
            name: stripRichText(faq.question),
            acceptedAnswer: { "@type": "Answer", text: stripRichText(faq.answer) },
          })),
        },
  );

  return (
    <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>
      <div>
        <PageHero
          eyebrow="Good to Know"
          title={content.faq_heading}
          titleGold={content.faq_heading_gold}
          subtitle="Shipping, orders, ingredients and candle safety — answered."
          ready={ready}
        />

        <div className="max-w-2xl mx-auto px-6 sm:px-12 pt-[var(--page-body-pt)] pb-12 sm:pb-16 space-y-6">
          {!ready && (
            <div className="bg-white rounded-2xl px-6 sm:px-8 py-4 space-y-6" style={{ border: "1px solid var(--color-border)", color: "var(--color-forest-dark)" }}>
              {[0, 1, 2, 3, 4].map(i => (
                <SkelText key={i} width={i % 2 ? "78%" : "62%"} style={{ fontSize: "0.875rem" }} />
              ))}
            </div>
          )}

          {ready && content.faqs.length > 0 && (
            <div className="bg-white rounded-2xl px-6 sm:px-8" style={{ border: "1px solid var(--color-border)" }}>
              <Accordion type="single" collapsible>
                {content.faqs.map((faq, i) => (
                  <AccordionItem key={i} value={`faq-${i}`}>
                    <AccordionTrigger className="font-sans text-sm font-semibold text-left" style={{ color: "var(--color-forest-dark)" }}>
                      <RichText text={faq.question} />
                    </AccordionTrigger>
                    <AccordionContent className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.72)" }}>
                      <RichText text={faq.answer} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}

          {/* Still stuck? Route people to a human. */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 text-center space-y-2" style={{ border: "1px solid var(--color-border)" }}>
            <p className="font-sans text-sm font-semibold" style={{ color: "var(--color-forest-dark)" }}>
              Didn't find your answer?
            </p>
            <p className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.72)" }}>
              Our team is happy to help with anything else —{" "}
              <Link to="/customer-service" className="font-semibold underline" style={{ color: "var(--color-forest-dark)" }}>
                contact customer service
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

export default FAQPage;
