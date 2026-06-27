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
import CandleCarePage from "./pages/CandleCarePage.tsx";
import ShopPage from "./pages/ShopPage.tsx";
import BasketPage from "./pages/BasketPage.tsx";
import DealsPage from "./pages/DealsPage.tsx";
import AboutPage from "./pages/AboutPage.tsx";
import AuthCallback from "./pages/AuthCallback.tsx";
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
                <Route path="/deals" element={<DealsPage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/candle-care" element={<CandleCarePage />} />
              </Route>
              <Route path="/admin" element={<AdminDashboard />} />
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
