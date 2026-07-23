import { lazy, Suspense } from "react";
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
import SeoManager from "@/components/SeoManager";
import Index from "./pages/Index.tsx";
import CandleCarePage from "./pages/CandleCarePage.tsx";
import ShopPage from "./pages/ShopPage.tsx";
import ProductDetailPage from "./pages/ProductDetailPage.tsx";
import BasketPage from "./pages/BasketPage.tsx";
import CheckoutPage from "./pages/CheckoutPage.tsx";
import CheckoutSuccessPage from "./pages/CheckoutSuccessPage.tsx";
import DealsPage from "./pages/DealsPage.tsx";
import AboutPage from "./pages/AboutPage.tsx";
import AuthCallback from "./pages/AuthCallback.tsx";
import AccountPage from "./pages/AccountPage.tsx";
import SecurityPage from "./pages/SecurityPage.tsx";
import AddressesPage from "./pages/AddressesPage.tsx";
import OrdersPage from "./pages/OrdersPage.tsx";
import OrderTrackingPage from "./pages/OrderTrackingPage.tsx";
import TrackOrderPage from "./pages/TrackOrderPage.tsx";
import ReturnPolicyPage from "./pages/ReturnPolicyPage.tsx";
import GiftCardsPage from "./pages/GiftCardsPage.tsx";
import CustomerServicePage from "./pages/CustomerServicePage.tsx";
import FAQPage from "./pages/FAQPage.tsx";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage.tsx";
import TermsOfServicePage from "./pages/TermsOfServicePage.tsx";
import ShippingPolicyPage from "./pages/ShippingPolicyPage.tsx";
import NotFound from "./pages/NotFound.tsx";

// Admin bundles (incl. recharts) are heavy and admin-only — keep them out of
// the main chunk so storefront visitors never download them.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard.tsx"));
const AdminResetPassword = lazy(() => import("./pages/AdminResetPassword.tsx"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <SeoManager />
        <AnalyticsTracker />
        <AuthProvider>
          <CartProvider>
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
              <Route path="/admin" element={<Suspense fallback={null}><AdminDashboard /></Suspense>} />
              <Route path="/admin/reset-password" element={<Suspense fallback={null}><AdminResetPassword /></Suspense>} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            {/* Global overlays */}
            <AuthModal />
            <CookieConsent />
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
