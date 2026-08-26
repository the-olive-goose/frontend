import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useContent } from "@/hooks/useContent";
import { DEFAULT_CONTENT, type GoogleAnalyticsContent } from "@/lib/defaults";
import { CONSENT_EVENT, type CookieChoice } from "@/lib/cookieConsent";
import {
  applyGoogleAnalyticsConsent,
  configureGoogleAnalytics,
  mirrorPageView,
  startGoogleAnalyticsMirror,
} from "@/lib/ga";

/**
 * Renders nothing — boots the GA4 tag from the settings the owner saved in
 * Admin → Analytics → Google Analytics, and keeps it in step with the visit.
 *
 * Three things move it:
 *   - the settings landing (they arrive from the content API, so the tag starts
 *     a beat after the page does — deliberate: hard-coding a measurement id into
 *     the bundle would mean a redeploy every time it changed),
 *   - the visitor answering the cookie banner, which is the moment consent
 *     turns a blocked tag into a live one,
 *   - navigation, because this is a single-page app: no further documents load,
 *     so gtag would record one page_view for the whole visit if the router
 *     didn't send them itself.
 *
 * Every decision about whether anything is allowed to load lives in lib/ga.ts.
 * This component only tells it when to re-decide.
 */
const GoogleAnalytics = () => {
  const { pathname } = useLocation();
  const { data: settings, ready } = useContent<GoogleAnalyticsContent>(
    "googleAnalytics",
    DEFAULT_CONTENT.googleAnalytics
  );

  // Subscribe to the first-party event stream once. The subscription is inert
  // until the tag is live, so registering it early costs nothing and means no
  // event is missed in the gap between mount and the settings arriving.
  useEffect(() => { startGoogleAnalyticsMirror(); }, []);

  useEffect(() => {
    if (!ready) return; // don't act on bundled defaults — see useContent
    if (configureGoogleAnalytics(settings) !== "prerendering") return;
    // Chrome is speculatively loading this page and nobody has asked for it yet.
    // Nothing may be sent until that changes — and when it does, this is the
    // moment the visit actually begins, so the tag boots then.
    const onActivate = () => configureGoogleAnalytics(settings);
    document.addEventListener("prerenderingchange", onActivate, { once: true });
    return () => document.removeEventListener("prerenderingchange", onActivate);
  }, [ready, settings]);

  useEffect(() => {
    if (!ready) return;
    const onConsent = (e: Event) => {
      const choice = (e as CustomEvent<CookieChoice>).detail;
      applyGoogleAnalyticsConsent(settings, choice === "accepted");
    };
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, [ready, settings]);

  // `ready` is in the deps, not just `pathname`: the settings almost always
  // arrive after the first render, and without it the landing page — the one
  // page every visit has — would never be reported. mirrorPageView drops a
  // repeat of the path it just sent, so overlapping with the tag's own boot
  // page_view is harmless.
  useEffect(() => {
    if (!ready) return;
    mirrorPageView(pathname);
  }, [pathname, ready]);

  return null;
};

export default GoogleAnalytics;
