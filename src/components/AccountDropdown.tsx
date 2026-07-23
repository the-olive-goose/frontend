import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  onClose: () => void;
}

const ICONS = {
  profile: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  ),
  lock: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" />
    </svg>
  ),
  box: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" />
    </svg>
  ),
  truck: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="1" y="6" width="13" height="11" rx="1" /><path d="M14 10h4l3 3v4h-7z" />
      <circle cx="6" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" />
    </svg>
  ),
  basket: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" />
    </svg>
  ),
  pin: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
  ),
  undo: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 10h10a5 5 0 010 10H8" /><path d="M7 5L3 10l4 5" />
    </svg>
  ),
  gift: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="8" width="18" height="4" /><rect x="5" y="12" width="14" height="9" />
      <path d="M12 8v13" /><path d="M12 8C10 4 6 4 6 6.5S9 8 12 8s6-.5 6-1.5S14 4 12 8z" />
    </svg>
  ),
  help: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 1.8-2.5 3.5" /><path d="M12 17.5h.01" />
    </svg>
  ),
  faq: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M7.9 20A9 9 0 104 16.1L2 22z" />
      <path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 1.8-2.5 3.5" /><path d="M12 16.5h.01" />
    </svg>
  ),
};

const AccountDropdown = ({ onClose }: Props) => {
  const { user, openAuthModal, signOut } = useAuth();
  const navigate = useNavigate();

  // Account/orders pages require sign-in; gift cards & customer service are public.
  const go = (path: string, requiresAuth = true) => {
    if (!requiresAuth || user) navigate(path);
    else openAuthModal();
    onClose();
  };

  const sections: { title: string; items: { label: string; icon: keyof typeof ICONS; path: string; public?: boolean }[] }[] = [
    {
      title: "Your Account",
      items: [
        { label: "Your Account", icon: "profile", path: "/account" },
        { label: "Login & Security", icon: "lock", path: "/account/security" },
        { label: "Your Addresses", icon: "pin", path: "/account/addresses" },
      ],
    },
    {
      title: "Orders",
      items: [
        { label: "Your Orders", icon: "box", path: "/orders" },
        { label: "Track Order", icon: "truck", path: "/track-order" },
        { label: "Returns & Refunds", icon: "undo", path: "/returns", public: true },
      ],
    },
    {
      title: "More",
      items: [
        { label: "Gift Cards", icon: "gift", path: "/gift-cards", public: true },
        { label: "FAQs", icon: "faq", path: "/faq", public: true },
        { label: "Customer Service", icon: "help", path: "/customer-service", public: true },
      ],
    },
  ];

  const firstName = user?.full_name?.trim().split(" ")[0] || user?.email?.split("@")[0] || null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="absolute top-full right-0 mt-2 z-50"
      style={{ width: 300 }}
    >
      <div className="flex justify-end pr-6 mb-1">
        <div className="w-3 h-3 rotate-45" style={{ background: "var(--color-cream-card)", border: "1px solid var(--color-border)", marginBottom: -8 }} />
      </div>
      <div className="rounded-xl overflow-hidden"
        style={{ background: "var(--color-cream-card)", border: "1px solid var(--color-border)", boxShadow: "0 12px 36px rgba(0,0,0,0.16)" }}>

        {/* Header */}
        <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          {user ? (
            <>
              <p className="font-display text-base font-semibold" style={{ color: "var(--color-forest-dark)" }}>
                Hello, {firstName}
              </p>
              <button
                onClick={() => { signOut(); onClose(); }}
                className="font-sans text-xs mt-1 opacity-60 hover:opacity-100 hover:underline transition-opacity"
                style={{ color: "var(--color-forest-dark)" }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <p className="font-display text-base font-semibold mb-2" style={{ color: "var(--color-forest-dark)" }}>
                Hello, sign in
              </p>
              <button
                onClick={() => { openAuthModal(); onClose(); }}
                className="w-full font-sans text-sm font-bold py-2 rounded-full transition-all hover:brightness-95 active:scale-95 mb-2"
                style={{ background: "var(--btn-primary-bg)", border: "1px solid var(--color-gold)", color: "var(--btn-primary-text)" }}
              >
                Sign in
              </button>
              <p className="font-sans text-xs text-center" style={{ color: "rgba(30,41,24,0.6)" }}>
                New customer?{" "}
                <button onClick={() => { openAuthModal(); onClose(); }} className="underline hover:opacity-70" style={{ color: "var(--color-forest-dark)" }}>
                  Start here
                </button>
              </p>
            </>
          )}
        </div>

        {/* Sections */}
        {sections.map(section => (
          <div key={section.title} className="py-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <p className="px-4 pb-1 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(30,41,24,0.45)" }}>
              {section.title}
            </p>
            {section.items.map(item => (
              <button
                key={item.label}
                onClick={() => go(item.path, !item.public)}
                className="flex items-center gap-3 w-full px-4 py-2 text-left transition-colors hover:bg-black/[0.04] group"
              >
                <span className="shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: "var(--color-forest-dark)" }}>
                  {ICONS[item.icon]}
                </span>
                <span className="font-sans text-sm" style={{ color: "var(--color-forest-dark)" }}>{item.label}</span>
              </button>
            ))}
          </div>
        ))}

        {/* Basket */}
        <div className="py-2">
          <button
            onClick={() => { navigate("/basket"); onClose(); }}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors hover:bg-black/[0.04] group"
          >
            <span className="shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: "var(--color-forest-dark)" }}>
              {ICONS.basket}
            </span>
            <span className="font-sans text-sm font-semibold" style={{ color: "var(--color-forest-dark)" }}>Your Basket</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default AccountDropdown;
