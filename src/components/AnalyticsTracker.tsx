import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { initAnalytics, trackPageView } from "@/lib/analytics";
import { resetProductListImpressions } from "@/components/ProductListScope";

// Renders nothing — mounts once inside the router to boot the analytics queue
// and record a page_view on every client-side navigation.
const AnalyticsTracker = () => {
  const { pathname } = useLocation();
  const firstPage = useRef(true);

  useEffect(() => { initAnalytics(); }, []);

  useEffect(() => {
    // A page view is the boundary an impression belongs to. Product lists dedupe
    // themselves so a re-render or a scroll-away-and-back can't inflate the
    // count, but that guard is deliberately keyed on the list and the products
    // shown — not the page — so without this a rail that shows the same items on
    // two different pages would report only the first. "You may also like" is
    // exactly that: recommend the same three candles from two product pages and
    // the second page's impressions would vanish.
    //
    // Skipped on the first page so the landing page's own lists aren't cleared
    // out from under them mid-commit.
    if (firstPage.current) firstPage.current = false;
    else resetProductListImpressions();

    trackPageView(pathname);
  }, [pathname]);

  return null;
};

export default AnalyticsTracker;
