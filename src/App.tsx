import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import AuthModal from "@/components/AuthModal";
import CookieConsent from "@/components/CookieConsent";
import Layout from "@/components/Layout";
import Index from "./pages/Index.tsx";
import AdminDashboard from "./pages/AdminDashboard.tsx";
import AdminResetPassword from "./pages/AdminResetPassword.tsx";
import CandleCarePage from "./pages/CandleCarePage.tsx";
import ShopPage from "./pages/ShopPage.tsx";
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
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage.tsx";
import TermsOfServicePage from "./pages/TermsOfServicePage.tsx";
import ShippingPolicyPage from "./pages/ShippingPolicyPage.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <Routes>
              {/* Public pages share one persistent navbar via Layout */}
              <Route element={<Layout />}>
                <Route path="/" element={<Index />} />
                <Route path="/shop" element={<ShopPage />} />
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
                <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                <Route path="/terms-of-service" element={<TermsOfServicePage />} />
                <Route path="/shipping-policy" element={<ShippingPolicyPage />} />
              </Route>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/reset-password" element={<AdminResetPassword />} />
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
