import { DEFAULT_CONTENT } from "@/lib/defaults";
import LegalPageLayout from "@/components/LegalPageLayout";

const ShippingPolicyPage = () => (
  <LegalPageLayout eyebrow="Shipping" section="shippingPolicy" fallback={DEFAULT_CONTENT.shippingPolicy} />
);

export default ShippingPolicyPage;
