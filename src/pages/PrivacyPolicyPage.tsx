import { useEffect, useState } from "react";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type LegalPageContent } from "@/lib/defaults";
import LegalPageLayout from "@/components/LegalPageLayout";

const PrivacyPolicyPage = () => {
  const [content, setContent] = useState<LegalPageContent>(DEFAULT_CONTENT.privacyPolicy);

  useEffect(() => {
    getContent("privacyPolicy", DEFAULT_CONTENT.privacyPolicy).then(setContent);
  }, []);

  return <LegalPageLayout eyebrow="Privacy" data={content} />;
};

export default PrivacyPolicyPage;
