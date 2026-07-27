import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getContent } from "@/lib/api";
import {
  applyBranding,
  applyMeta,
  isRouteLevelMetaCurrent,
  metaForPath,
  setSeoSettings,
  DEFAULT_SEO,
  type RouteMeta,
  type SeoSettings,
} from "@/lib/seo";
import { resolveRouteMeta } from "@/lib/seoContent";

/**
 * Route-driven <head> manager for this client-rendered SPA. Mounted once inside
 * BrowserRouter (before <Routes>, so page-level overrides win the effect order).
 * On every navigation it applies the matching entry from ROUTE_META: title,
 * description, canonical (query strings stripped — filter/search params on /shop
 * canonicalise to the clean URL), robots, and OG/Twitter tags.
 *
 * Each route's title and description then come from the admin section that owns
 * that page's copy (see src/lib/seoContent.ts), and the branding settings from
 * Admin → Ops → SEO. Both arrive asynchronously, so the ROUTE_META baseline is
 * written synchronously first and upgraded in place — never on top of meta a
 * page has written for itself, which a product page does once its data lands.
 */
const SeoManager = () => {
  const { pathname } = useLocation();
  const [seo, setSeo] = useState<SeoSettings>(DEFAULT_SEO);
  const appliedPath = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getContent<SeoSettings>("seo", DEFAULT_SEO).then((settings) => {
      if (cancelled) return;
      setSeoSettings(settings);
      applyBranding();
      setSeo(settings);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // `seo` is a dependency so freshly loaded settings take effect on the page
    // the visitor landed on, not just the next navigation. Neither that re-run
    // nor the async upgrade below may clobber meta a page wrote for itself.
    void seo;
    let cancelled = false;
    const apply = (meta: RouteMeta) => {
      if (cancelled || (appliedPath.current === pathname && !isRouteLevelMetaCurrent())) return;
      appliedPath.current = pathname;
      applyMeta({ ...meta, path: pathname, routeLevel: true });
    };

    apply(metaForPath(pathname));
    resolveRouteMeta(pathname).then(apply);

    return () => { cancelled = true; };
  }, [pathname, seo]);

  return null;
};

export default SeoManager;
