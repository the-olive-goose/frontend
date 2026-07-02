import PageHero from "@/components/PageHero";
import FooterSection from "@/components/sections/FooterSection";
import { DEFAULT_CONTENT, type LegalPageContent } from "@/lib/defaults";

interface Props {
  eyebrow: string;
  data: LegalPageContent;
}

// Shared shell for simple heading + intro + sections policy pages
// (Privacy Policy, Terms of Service, Shipping Policy).
const LegalPageLayout = ({ eyebrow, data }: Props) => (
  <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>
    <div className="pt-[112px]">
      <PageHero eyebrow={eyebrow} title={data.heading} subtitle={data.intro} />

      <div className="max-w-3xl mx-auto px-6 sm:px-12 py-12 sm:py-16">
        <div className="bg-white rounded-2xl p-6 sm:p-8 space-y-6" style={{ border: "1px solid var(--color-border)" }}>
          {data.sections.map(section => (
            <div key={section.title}>
              <h3 className="font-serif text-lg font-semibold mb-1" style={{ color: "var(--color-forest-dark)" }}>{section.title}</h3>
              <p className="font-sans text-sm leading-relaxed" style={{ color: "rgba(30,41,24,0.72)" }}>{section.body}</p>
            </div>
          ))}
          <p className="font-sans text-xs" style={{ color: "rgba(30,41,24,0.6)" }}>
            Questions? Email us at <a href={`mailto:${data.contact_email}`} className="hover:underline font-semibold" style={{ color: "var(--color-forest-dark)" }}>{data.contact_email}</a>
          </p>
        </div>
      </div>
    </div>
    <FooterSection data={DEFAULT_CONTENT.footer} />
  </div>
);

export default LegalPageLayout;
