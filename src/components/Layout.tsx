import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import NavbarSection from "@/components/sections/NavbarSection";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { resolveOfferValues, type OfferValues } from "@/lib/offerTokens";

/**
 * Persistent shell for all public pages. The navbar is mounted ONCE here and
 * stays put across route changes — so the nav links (incl. "Today's Deals")
 * never reload or flash, and the active-tab highlight slides as you navigate.
 */
const Layout = () => {
  const [navbar, setNavbar]             = useState(DEFAULT_CONTENT.navbar);
  const [announcement, setAnnouncement] = useState(DEFAULT_CONTENT.announcementBar);
  // Announcement copy quotes the free-shipping bar and the welcome discount via
  // tokens (see lib/offerTokens), so the bar needs the settings that own those
  // figures — otherwise it would have to hardcode them and could drift.
  const [offer, setOffer] = useState<OfferValues>(
    resolveOfferValues(DEFAULT_CONTENT.pickupSettings, DEFAULT_CONTENT.subscribePopup)
  );

  useEffect(() => {
    getContent("navbar", DEFAULT_CONTENT.navbar).then(setNavbar);
    getContent("announcementBar", DEFAULT_CONTENT.announcementBar).then(setAnnouncement);
    Promise.all([
      getContent("pickupSettings", DEFAULT_CONTENT.pickupSettings),
      getContent("subscribePopup", DEFAULT_CONTENT.subscribePopup),
    ]).then(([pickup, popup]) => setOffer(resolveOfferValues(pickup, popup)));
  }, []);

  return (
    <>
      <NavbarSection data={navbar} announcement={announcement} offer={offer} />
      <Outlet />
    </>
  );
};

export default Layout;
