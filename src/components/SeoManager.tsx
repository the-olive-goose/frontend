import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { applyMeta, metaForPath } from "@/lib/seo";

/**
 * Route-driven <head> manager for this client-rendered SPA. Mounted once inside
 * BrowserRouter (before <Routes>, so page-level overrides win the effect order).
 * On every navigation it applies the matching entry from ROUTE_META: title,
 * description, canonical (query strings stripped — filter/search params on /shop
 * canonicalise to the clean URL), robots, and OG/Twitter tags.
 */
const SeoManager = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    applyMeta({ ...metaForPath(pathname), path: pathname });
  }, [pathname]);

  return null;
};

export default SeoManager;
