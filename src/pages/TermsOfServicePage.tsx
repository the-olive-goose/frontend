import { DEFAULT_CONTENT } from "@/lib/defaults";
import LegalPageLayout from "@/components/LegalPageLayout";

const TermsOfServicePage = () => (
  <LegalPageLayout eyebrow="Terms" section="termsOfService" fallback={DEFAULT_CONTENT.termsOfService} />
);

export default TermsOfServicePage;
