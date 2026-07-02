import { useEffect, useState } from "react";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type LegalPageContent } from "@/lib/defaults";
import LegalPageLayout from "@/components/LegalPageLayout";

const ShippingPolicyPage = () => {
  const [content, setContent] = useState<LegalPageContent>(DEFAULT_CONTENT.shippingPolicy);

  useEffect(() => {
    getContent("shippingPolicy", DEFAULT_CONTENT.shippingPolicy).then(setContent);
  }, []);

  return <LegalPageLayout eyebrow="Shipping" data={content} />;
};

export default ShippingPolicyPage;
