import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type CustomerServiceContent } from "@/lib/defaults";
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
  const [content, setContent] = useState<CustomerServiceContent>(DEFAULT_CONTENT.customerService);

  useEffect(() => {
    getContent("customerService", DEFAULT_CONTENT.customerService).then(setContent);
  }, []);

  useJsonLd("breadcrumb", breadcrumbJsonLd([["Home", "/"], ["FAQs", "/faq"]]));

  // FAQPage structured data mirroring the visible Q&A accordion below.
  useJsonLd(
    "faq",
    content.faqs.length === 0
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
      <div className="pt-[var(--nav-h,112px)]">
        <PageHero
          eyebrow="Good to Know"
          title="Frequently Asked Questions"
          subtitle="Shipping, orders, ingredients and candle safety — answered."
        />

        <div className="max-w-2xl mx-auto px-6 sm:px-12 py-12 sm:py-16 space-y-6">
          {content.faqs.length > 0 && (
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
      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default FAQPage;
