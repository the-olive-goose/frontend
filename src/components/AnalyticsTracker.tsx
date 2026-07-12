import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { initAnalytics, trackPageView } from "@/lib/analytics";

// Renders nothing — mounts once inside the router to boot the analytics queue
// and record a page_view on every client-side navigation.
const AnalyticsTracker = () => {
  const { pathname } = useLocation();

  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => { trackPageView(pathname); }, [pathname]);

  return null;
};

export default AnalyticsTracker;
