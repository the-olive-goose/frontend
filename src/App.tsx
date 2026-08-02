import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import AuthModal from "@/components/AuthModal";
import CookieConsent from "@/components/CookieConsent";
import Layout from "@/components/Layout";
import ScrollToTop from "@/components/ScrollToTop";
import SeoManager from "@/components/SeoManager";

// The landing page is the one route worth paying for up front: it is the most
// common entry, and making it a chunk of its own would put a network round trip
// between the HTML and the first paint. Everything else is split out.
import Index from "./pages/Index.tsx";

/**
 * Route chunks.
 *
 * Every page used to be imported eagerly, so a visitor landing on the home page
 * downloaded and parsed the checkout, the account screens, the order tracker and
 * all seven policy pages before anything could render — 810 KB of JavaScript, on
 * phones where parse time hurts more than download time.
 *
 * Splitting on its own would only trade one delay for another: the first tap on
 * "Shop" would then wait on a round trip. So each chunk keeps a handle on its
 * own import, and {@link RoutePrefetcher} warms the likely ones while the
 * browser is idle. The split pays for itself at load; the prefetch means nobody
 * pays for it at navigation.
 */
type PrefetchableRoute = ComponentType & { preload: () => Promise<unknown> };

const route = (factory: () => Promise<{ default: ComponentType<never> }>): PrefetchableRoute => {
  const Component = lazy(factory) as unknown as PrefetchableRoute;
  Component.preload = factory;
  return Component;
};

/* The rest of the shop — reachable in a tap or two from anywhere, so these are
   the chunks worth having in cache before they're asked for. */
const ShopPage            = route(() => import("./pages/ShopPage.tsx"));
const ProductDetailPage   = route(() => import("./pages/ProductDetailPage.tsx"));
const BasketPage          = route(() => import("./pages/BasketPage.tsx"));
const DealsPage           = route(() => import("./pages/DealsPage.tsx"));

/* Further in: reached deliberately, and never on the first tap. */
const CheckoutPage        = route(() => import("./pages/CheckoutPage.tsx"));
const CheckoutSuccessPage = route(() => import("./pages/CheckoutSuccessPage.tsx"));
const AboutPage           = route(() => import("./pages/AboutPage.tsx"));
const FounderDiaryPage    = route(() => import("./pages/FounderDiaryPage.tsx"));
const CandleCarePage      = route(() => import("./pages/CandleCarePage.tsx"));
const AccountPage         = route(() => import("./pages/AccountPage.tsx"));
const SecurityPage        = route(() => import("./pages/SecurityPage.tsx"));
const AddressesPage       = route(() => import("./pages/AddressesPage.tsx"));
const OrdersPage          = route(() => import("./pages/OrdersPage.tsx"));
const OrderTrackingPage   = route(() => import("./pages/OrderTrackingPage.tsx"));
const TrackOrderPage      = route(() => import("./pages/TrackOrderPage.tsx"));
const ReturnPolicyPage    = route(() => import("./pages/ReturnPolicyPage.tsx"));
const GiftCardsPage       = route(() => import("./pages/GiftCardsPage.tsx"));
const CustomerServicePage = route(() => import("./pages/CustomerServicePage.tsx"));
const FAQPage             = route(() => import("./pages/FAQPage.tsx"));
const PrivacyPolicyPage   = route(() => import("./pages/PrivacyPolicyPage.tsx"));
const TermsOfServicePage  = route(() => import("./pages/TermsOfServicePage.tsx"));
const ShippingPolicyPage  = route(() => import("./pages/ShippingPolicyPage.tsx"));
const AuthCallback        = route(() => import("./pages/AuthCallback.tsx"));
const NotFound            = route(() => import("./pages/NotFound.tsx"));

// Admin bundles (incl. recharts) are heavy and admin-only — keep them out of
// the main chunk so storefront visitors never download them. Deliberately not
// prefetched: a shopper has no use for them.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard.tsx"));
const AdminResetPassword = lazy(() => import("./pages/AdminResetPassword.tsx"));

/**
 * Pulls the routes a visitor is most likely to reach next into cache once the
 * browser has nothing better to do. Idle-time only, so it never competes with
 * the current page's own content, images or fonts for bandwidth.
 */
const PREFETCH: PrefetchableRoute[] = [ShopPage, ProductDetailPage, BasketPage, DealsPage];

const RoutePrefetcher = () => {
  useEffect(() => {
    // Metered or slow connections are exactly where a speculative download is a
    // cost rather than a saving, so on those we let navigation fetch on demand.
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || /2g/.test(connection?.effectiveType ?? "")) return;

    const idle = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(() => cb({
      didTimeout: false, timeRemaining: () => 0,
    } as IdleDeadline), 1200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;

    // One at a time: a burst of parallel chunk requests on a phone is the same
    // contention the prefetch is meant to avoid. Queued from a copy so a remount
    // (React's development double-invoke, most obviously) starts from the full
    // list rather than whatever the last pass left behind.
    const queue = [...PREFETCH];
    let stopped = false;
    let handle = idle(function next() {
      if (stopped) return;
      const route = queue.shift();
      if (!route) return;
      route.preload().catch(() => { /* a failed prefetch just means a normal load later */ })
        .then(() => { if (!stopped) handle = idle(next); });
    });

    return () => { stopped = true; cancel(handle); };
  }, []);

  return null;
};

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ScrollToTop />
        <SeoManager />
        <AnalyticsTracker />
        <RoutePrefetcher />
        <AuthProvider>
          <CartProvider>
            {/* One boundary around the whole table: the navbar and footer live
                in Layout and stay put, so a route still resolving leaves the
                page frame intact rather than blanking the screen. */}
            <Suspense fallback={null}>
              <Routes>
                {/* Public pages share one persistent navbar via Layout */}
                <Route element={<Layout />}>
                  <Route path="/" element={<Index />} />
                  <Route path="/shop" element={<ShopPage />} />
                  <Route path="/products/:slug" element={<ProductDetailPage />} />
                  <Route path="/basket" element={<BasketPage />} />
                  <Route path="/checkout" element={<CheckoutPage />} />
                  <Route path="/checkout/success" element={<CheckoutSuccessPage />} />
                  <Route path="/deals" element={<DealsPage />} />
                  <Route path="/about" element={<AboutPage />} />
                  <Route path="/our-story" element={<FounderDiaryPage />} />
                  <Route path="/candle-care" element={<CandleCarePage />} />
                  <Route path="/account" element={<AccountPage />} />
                  <Route path="/account/security" element={<SecurityPage />} />
                  <Route path="/account/addresses" element={<AddressesPage />} />
                  <Route path="/orders" element={<OrdersPage />} />
                  <Route path="/orders/:id" element={<OrderTrackingPage />} />
                  <Route path="/track-order" element={<TrackOrderPage />} />
                  <Route path="/returns" element={<ReturnPolicyPage />} />
                  <Route path="/gift-cards" element={<GiftCardsPage />} />
                  <Route path="/customer-service" element={<CustomerServicePage />} />
                  <Route path="/faq" element={<FAQPage />} />
                  <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                  <Route path="/terms-of-service" element={<TermsOfServicePage />} />
                  <Route path="/shipping-policy" element={<ShippingPolicyPage />} />
                </Route>
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/reset-password" element={<AdminResetPassword />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            {/* Global overlays. Outside <Suspense> on purpose: the sign-in modal
                is how a session starts, so it must not be gated on whichever
                route chunk happens to be loading. */}
            <AuthModal />
            <CookieConsent />
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
