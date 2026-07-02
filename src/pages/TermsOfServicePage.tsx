import { useEffect, useState } from "react";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type LegalPageContent } from "@/lib/defaults";
import LegalPageLayout from "@/components/LegalPageLayout";

const TermsOfServicePage = () => {
  const [content, setContent] = useState<LegalPageContent>(DEFAULT_CONTENT.termsOfService);

  useEffect(() => {
    getContent("termsOfService", DEFAULT_CONTENT.termsOfService).then(setContent);
  }, []);

  return <LegalPageLayout eyebrow="Terms" data={content} />;
};

export default TermsOfServicePage;
