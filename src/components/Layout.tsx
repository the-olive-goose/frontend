import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import NavbarSection from "@/components/sections/NavbarSection";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT } from "@/lib/defaults";

/**
 * Persistent shell for all public pages. The navbar is mounted ONCE here and
 * stays put across route changes — so the nav links (incl. "Today's Deals")
 * never reload or flash, and the active-tab highlight slides as you navigate.
 */
const Layout = () => {
  const [navbar, setNavbar]             = useState(DEFAULT_CONTENT.navbar);
  const [announcement, setAnnouncement] = useState(DEFAULT_CONTENT.announcementBar);

  useEffect(() => {
    getContent("navbar", DEFAULT_CONTENT.navbar).then(setNavbar);
    getContent("announcementBar", DEFAULT_CONTENT.announcementBar).then(setAnnouncement);
  }, []);

  return (
    <>
      <NavbarSection data={navbar} announcement={announcement} />
      <Outlet />
    </>
  );
};

export default Layout;
