import { Outlet } from "react-router-dom";
import NavbarSection from "@/components/sections/NavbarSection";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { useContent } from "@/hooks/useContent";
import { resolveOfferValues } from "@/lib/offerTokens";

/**
 * Persistent shell for all public pages. The navbar is mounted ONCE here and
 * stays put across route changes — so the nav links (incl. "Today's Deals")
 * never reload or flash, and the active-tab highlight slides as you navigate.
 */
const Layout = () => {
  const navbar       = useContent("navbar", DEFAULT_CONTENT.navbar);
  const announcement = useContent("announcementBar", DEFAULT_CONTENT.announcementBar);
  // Announcement copy quotes the free-shipping bar and the welcome discount via
  // tokens (see lib/offerTokens), so the bar needs the settings that own those
  // figures — otherwise it would have to hardcode them and could drift.
  const pickup = useContent("pickupSettings", DEFAULT_CONTENT.pickupSettings);
  const popup  = useContent("subscribePopup", DEFAULT_CONTENT.subscribePopup);
  const returns = useContent("returnPolicy", DEFAULT_CONTENT.returnPolicy);
  const offer  = resolveOfferValues(pickup.data, popup.data, returns.data);

  // The bar is only allowed to paint once its copy AND the figures that copy
  // interpolates are both real — a message rendered against fallback settings
  // would quote a threshold the shop doesn't actually offer.
  const ready = navbar.ready && announcement.ready && pickup.ready && popup.ready && returns.ready;

  return (
    <>
      <NavbarSection
        data={navbar.data}
        announcement={announcement.data}
        offer={offer}
        ready={ready}
      />
      <Outlet />
    </>
  );
};

export default Layout;
