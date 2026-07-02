import { useEffect, useState } from "react";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type CustomerServiceContent } from "@/lib/defaults";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import PageHero from "@/components/PageHero";
import FooterSection from "@/components/sections/FooterSection";

const CustomerServicePage = () => {
  const [content, setContent] = useState<CustomerServiceContent>(DEFAULT_CONTENT.customerService);

  useEffect(() => {
    getContent("customerService", DEFAULT_CONTENT.customerService).then(setContent);
  }, []);

  return (
    <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>
      <div className="pt-[112px]">
        <PageHero eyebrow="We're Here to Help" title={content.heading} subtitle={content.intro} />

        <div className="max-w-2xl mx-auto px-6 sm:px-12 py-12 sm:py-16 space-y-6">
          <div className="bg-white rounded-2xl p-6 sm:p-8 space-y-4" style={{ border: "1px solid var(--color-border)" }}>
            <div className="flex flex-wrap gap-6">
              <a href={`mailto:${content.contact_email}`}
                className="font-sans text-sm font-semibold hover:underline" style={{ color: "var(--color-forest-dark)" }}>
                ✉ &nbsp;{content.contact_email}
              </a>
              {content.contact_phone && (
                <a href={`tel:${content.contact_phone}`}
                  className="font-sans text-sm font-semibold hover:underline" style={{ color: "var(--color-forest-dark)" }}>
                  ☎ &nbsp;{content.contact_phone}
                </a>
              )}
            </div>
          </div>

          {content.faqs.length > 0 && (
            <div className="bg-white rounded-2xl px-6 sm:px-8" style={{ border: "1px solid var(--color-border)" }}>
              <Accordion type="single" collapsible>
                {content.faqs.map((faq, i) => (
                  <AccordionItem key={i} value={`faq-${i}`}>
                    <AccordionTrigger className="font-sans text-sm font-semibold text-left" style={{ color: "var(--color-forest-dark)" }}>
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.72)" }}>
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}
        </div>
      </div>
      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default CustomerServicePage;
