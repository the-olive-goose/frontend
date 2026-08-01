import { DEFAULT_CONTENT } from "@/lib/defaults";
import LegalPageLayout from "@/components/LegalPageLayout";

const PrivacyPolicyPage = () => (
  <LegalPageLayout eyebrow="Privacy" section="privacyPolicy" fallback={DEFAULT_CONTENT.privacyPolicy} />
);

export default PrivacyPolicyPage;
