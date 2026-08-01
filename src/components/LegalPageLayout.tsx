import PageHero from "@/components/PageHero";
import FooterSection from "@/components/sections/FooterSection";
import { DEFAULT_CONTENT, type LegalPageContent } from "@/lib/defaults";
import { useContent } from "@/hooks/useContent";
import RichText from "@/lib/richtext";
import { SkelText } from "@/components/ui/ContentSkeleton";
import { fillOfferTokens, resolveOfferValues } from "@/lib/offerTokens";

interface Props {
  eyebrow: string;
  /** Which content section holds this page's copy, e.g. "privacyPolicy". */
  section: string;
  fallback: LegalPageContent;
}

// Shared shell for simple heading + intro + sections policy pages
// (Privacy Policy, Terms of Service, Shipping Policy).
//
// Policy bodies may quote the free-shipping threshold or the welcome discount, so
// they go through fillOfferTokens here — resolved centrally rather than per page,
// so a new policy page cannot forget to do it and reintroduce a hardcoded figure.
const LegalPageLayout = ({ eyebrow, section, fallback }: Props) => {
  const page   = useContent(section, fallback);
  const pickup = useContent("pickupSettings", DEFAULT_CONTENT.pickupSettings);
  const popup  = useContent("subscribePopup", DEFAULT_CONTENT.subscribePopup);

  // The body and the figures it quotes have to land together: a policy rendered
  // against fallback settings would state a threshold the shop doesn't offer.
  const ready = page.ready && pickup.ready && popup.ready;
  const data  = page.data;
  const offer = resolveOfferValues(pickup.data, popup.data);
  const fill  = (text: string) => fillOfferTokens(text, offer);

  return (
  <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>
    <div>
      <PageHero
        eyebrow={eyebrow}
        title={data.heading}
        titleGold={data.heading_gold}
        subtitle={ready ? fill(data.intro) : undefined}
        ready={ready}
      />

      <div className="max-w-3xl mx-auto px-6 sm:px-12 pt-[var(--page-body-pt)] pb-12 sm:pb-16">
        <div className="bg-white rounded-2xl p-6 sm:p-8 space-y-6" style={{ border: "1px solid var(--color-border)" }}>
          {ready ? (
            <>
              {data.sections.map(section => (
                <div key={section.title}>
                  <h3 className="font-serif text-lg font-semibold mb-1" style={{ color: "var(--color-forest-dark)" }}><RichText text={fill(section.title)} /></h3>
                  <p className="font-sans text-sm leading-relaxed" style={{ color: "rgba(30,41,24,0.72)" }}><RichText text={fill(section.body)} /></p>
                </div>
              ))}
              <p className="font-sans text-xs" style={{ color: "rgba(30,41,24,0.6)" }}>
                Questions? Email us at <a href={`mailto:${data.contact_email}`} className="hover:underline font-semibold" style={{ color: "var(--color-forest-dark)" }}>{data.contact_email}</a>
              </p>
            </>
          ) : (
            [0, 1, 2, 3].map(i => (
              <div key={i} style={{ color: "var(--color-forest-dark)" }}>
                <div className="mb-2"><SkelText width="42%" style={{ fontSize: "1.125rem" }} /></div>
                <SkelText lines={3} lineHeight={1.6} style={{ fontSize: "0.875rem" }} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
    <FooterSection />
  </div>
  );
};

export default LegalPageLayout;
