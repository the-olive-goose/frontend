import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useContent } from "@/hooks/useContent";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_CONTENT, type MetaPixelContent } from "@/lib/defaults";
import { CONSENT_EVENT, type CookieChoice } from "@/lib/cookieConsent";
import {
  applyMetaPixelConsent,
  configureMetaPixel,
  getMetaExternalId,
  mirrorMetaPageView,
  setMetaUserData,
  startMetaPixelMirror,
} from "@/lib/meta";

/**
 * Splits "Aoife Ní Bhriain" into the two fields Meta's advanced matching wants.
 *
 * One field, so anything past the first space is the surname — which is right
 * for compound surnames ("van der Berg") and wrong for a middle name, and both
 * are hashed before they leave the page, so the cost of the wrong guess is a
 * match that doesn't land rather than anything disclosed.
 */
const splitName = (full?: string): { firstName?: string; lastName?: string } => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

/**
 * Renders nothing — boots the Meta Pixel from the settings the owner saved in
 * Admin → Analytics → Meta Pixel, and keeps it in step with the visit.
 *
 * The same four movers as its GA4 sibling (see components/GoogleAnalytics.tsx),
 * plus one this one has and that one doesn't:
 *
 *   - the settings landing (they arrive from the content API, so the pixel
 *     starts a beat after the page does — deliberate: hard-coding a pixel id
 *     into the bundle would mean a redeploy every time it changed),
 *   - the visitor answering the cookie banner, which is the moment consent turns
 *     a blocked pixel into a live one,
 *   - navigation, because this is a single-page app: no further documents load,
 *     so the pixel would record one PageView for the whole visit if the router
 *     didn't send them itself,
 *   - WHO THIS IS, which is why it waits: the pixel can be told the signed-in
 *     shopper's (hashed) identity exactly once, at init, and never again.
 *
 * Mounted inside AuthProvider, unlike GoogleAnalytics, for that last one alone.
 *
 * Every decision about whether anything is allowed to load lives in lib/meta.ts.
 * This component only tells it when to re-decide.
 */
const MetaPixel = () => {
  const { pathname } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { data: settings, ready } = useContent<MetaPixelContent>(
    "metaPixel",
    DEFAULT_CONTENT.metaPixel
  );

  // Subscribe to the first-party event stream once. The subscription is inert
  // until the pixel is live, so registering it early costs nothing and means no
  // event is missed in the gap between mount and the settings arriving.
  useEffect(() => { startMetaPixelMirror(); }, []);

  // Who this is, recorded before the pixel is configured below. Effects run in
  // declaration order within a component, and the configure effect is gated on
  // the session having resolved — together, that is what puts the identity in
  // the pixel's one and only init.
  useEffect(() => {
    const { firstName, lastName } = splitName(user?.full_name);
    setMetaUserData(
      user
        ? { email: user.email, phone: user.phone, firstName, lastName, externalId: getMetaExternalId() }
        : { externalId: getMetaExternalId() }
    );
  }, [user]);

  // fbevents.js takes advanced-matching data from the FIRST init for a pixel and
  // silently ignores every later one (see setMetaUserData in lib/meta.ts, where
  // that is written down against what the live library actually does). So when
  // the owner wants advanced matching, booting the pixel before the session has
  // resolved means booting it as an anonymous browser for the whole visit.
  //
  // Waiting costs nothing: events are buffered until the pixel exists and
  // replayed in order. But it must be BOUNDED — a session check that never
  // settles must not be able to switch the shop's measurement off — so this
  // gives up after a few seconds and boots without an identity, which is the
  // same outcome a signed-out visitor gets and strictly better than nothing.
  const [waitedForAuth, setWaitedForAuth] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaitedForAuth(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  const identityPending = settings.advanced_matching && authLoading && !waitedForAuth;

  useEffect(() => {
    if (!ready) return; // don't act on bundled defaults — see useContent
    if (identityPending) return;
    if (configureMetaPixel(settings) !== "prerendering") return;
    // Chrome is speculatively loading this page and nobody has asked for it yet.
    // Nothing may be sent until that changes — and when it does, this is the
    // moment the visit actually begins, so the pixel boots then.
    const onActivate = () => configureMetaPixel(settings);
    document.addEventListener("prerenderingchange", onActivate, { once: true });
    return () => document.removeEventListener("prerenderingchange", onActivate);
  }, [ready, settings, identityPending]);

  useEffect(() => {
    if (!ready) return;
    const onConsent = (e: Event) => {
      const choice = (e as CustomEvent<CookieChoice>).detail;
      applyMetaPixelConsent(settings, choice === "accepted");
    };
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, [ready, settings]);

  // `ready` is in the deps, not just `pathname`: the settings almost always
  // arrive after the first render, and without it the landing page — the one
  // page every visit has, and the one an ad click lands on — would never be
  // reported. mirrorMetaPageView drops a repeat of the path it just sent, so
  // overlapping with the pixel's own boot PageView is harmless.
  useEffect(() => {
    if (!ready) return;
    mirrorMetaPageView(pathname);
  }, [pathname, ready]);

  return null;
};

export default MetaPixel;
