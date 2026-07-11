// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface Bundle {
  id: string;
  name: string;
  description: string;
  product_ids: string[];
  discount_type: "percentage" | "fixed";
  discount_value: number;
  is_active: boolean;
  display_order: number;
}

export interface DealsContent {
  page_title: string;
  page_subtitle: string;
  bundles: Bundle[];
}

export const DEFAULT_DEALS: DealsContent = {
  page_title: "Today's Deals",
  page_subtitle: "Bundle & Save — handpicked combos at a special price",
  bundles: [],
};

export interface AnnouncementBarContent {
  messages: string[];
  interval_ms: number; // how long each message shows (ms)
}

export interface NavLink { label: string; href: string; }
export interface SocialLink { platform: string; href: string; }

export interface Product {
  id: string;
  name: string;
  description: string;
  price: string;
  image_url: string;
  tag: string;
  // Optional inventory count. Undefined/null means "not tracked" — existing
  // products keep working unchanged unless an admin opts in by setting a number.
  stock?: number | null;
}

export interface CandleCareCard {
  number: string;
  title: string;
  description: string;
}

export interface VideoItem {
  id: string;
  title: string;
  description: string;
  video_url: string;
}

export interface Testimonial {
  id: string;
  quote: string;
  author: string;
  location: string;
  rating: number;
  avatarUrl?: string;
}

export interface NavbarContent {
  brand_name: string;
  links: NavLink[];
  cta_text: string;
  cta_href: string;
}

export interface HeroContent {
  headline: string;
  subtext: string;
  cta_text: string;
  cta_href: string;
  bg_image_url: string;
  bg_opacity: number;       // background image opacity 0–1 (default 1.0 = original)
  tint_color: string;       // hex colour of the overlay tint
  tint_opacity: number;     // opacity of the tint overlay 0–1
  overlay_opacity?: number; // legacy — ignored, kept for DB back-compat
  show_countdown: boolean;
  launch_date: string | null;
}

export interface BrandStoryContent {
  label: string;
  headline: string;
  body: string;
  image_url: string;
  cta_text: string;
  cta_href: string;
}

export interface ProductsContent {
  label: string;
  headline: string;
  subtext: string;
  items: Product[];
}

export interface CandleCareContent {
  label: string;
  headline_part1: string;
  headline_part2: string;
  cards: CandleCareCard[];
}

export interface VideosContent {
  label: string;
  headline: string;
  subtext: string;
  items: VideoItem[];
}

export interface TestimonialsContent {
  label: string;
  headline: string;
  items: Testimonial[];
}

export interface NewsletterContent {
  label: string;
  headline: string;
  subtext: string;
  placeholder: string;
  cta_text: string;
}

export interface MomentPillContent {
  text1: string;
  image1_url: string;
  text2: string;
  image2_url: string;
  text3: string;
}

export interface WelcomeClubContent {
  headline: string;
  photo_url: string;
  name_line: string;
  bio: string;
  cta_text: string;
  cta_href: string;
}

export interface FooterContent {
  brand_name: string;
  tagline: string;
  links: NavLink[];
  social_links: SocialLink[];
  policy_links: NavLink[];
  copyright: string;
}

export interface ReturnPolicySection {
  title: string;
  body: string;
}

export interface ReturnPolicyContent {
  heading: string;
  intro: string;
  sections: ReturnPolicySection[];
  contact_email: string;
}

// Privacy policy, terms of service, and shipping policy are all simple
// heading + intro + sections pages, so they share the return policy's shape.
export type LegalPageContent = ReturnPolicyContent;

export interface GiftCardsContent {
  heading: string;
  intro: string;
  denominations: string[];
  note: string;
  cta_text: string;
  available: boolean;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface CustomerServiceContent {
  heading: string;
  intro: string;
  contact_email: string;
  contact_phone: string;
  faqs: FaqItem[];
}

export interface PickupSettingsContent {
  enabled: boolean;
  location_name: string;
  address_line1: string;
  city: string;
  eircode: string;
  country: string;
  hours: string;
  discount_percent: number;
  notes: string;
  free_shipping_threshold: number;
  flat_shipping_rate: number;
}

export interface SiteContent {
  announcementBar: AnnouncementBarContent;
  navbar: NavbarContent;
  hero: HeroContent;
  momentPill: MomentPillContent;
  welcomeClub: WelcomeClubContent;
  brandStory: BrandStoryContent;
  products: ProductsContent;
  candleCare: CandleCareContent;
  videos: VideosContent;
  testimonials: TestimonialsContent;
  newsletter: NewsletterContent;
  footer: FooterContent;
  returnPolicy: ReturnPolicyContent;
  giftCards: GiftCardsContent;
  customerService: CustomerServiceContent;
  pickupSettings: PickupSettingsContent;
  privacyPolicy: LegalPageContent;
  termsOfService: LegalPageContent;
  shippingPolicy: LegalPageContent;
}

// ── Default content ────────────────────────────────────────────────────────────

export const DEFAULT_CONTENT: SiteContent = {
  announcementBar: {
    messages: [
      "✨ Free shipping on orders over €65",
      "🕯️ New café collection dropping soon — Shop now →",
      "💌 Sign up for early access & 10% off your first order",
    ],
    interval_ms: 1500,
  },

  navbar: {
    brand_name: "The Olive Goose",
    links: [
      { label: "Home",         href: "/" },
      { label: "Shop",         href: "/shop" },
      { label: "Candle Care",  href: "/candle-care" },
      { label: "Today's Deals", href: "/deals" },
      { label: "About",        href: "/about" },
    ],
    cta_text: "Shop Now",
    cta_href: "#collection",
  },

  hero: {
    headline: "Café-inspired candles for everyday moments",
    subtext: "Candles poured with intention — scents that smell like your favourite cozy corner.",
    cta_text: "Shop the Collection",
    cta_href: "#collection",
    bg_image_url: "",
    bg_opacity: 1.0,
    tint_color: "#1e2918",
    tint_opacity: 0.45,
    show_countdown: false,
    launch_date: null,
  },

  momentPill: {
    text1: "Live in the moment.",
    image1_url: "",
    text2: "Because after all,",
    image2_url: "",
    text3: "isn't it the most important?",
  },

  welcomeClub: {
    headline: "Welcome to the Olive Goose Club!",
    photo_url: "",
    name_line: "I'm Meghna, the person behind The Olive Goose.",
    bio: "I create café-inspired pieces designed to bring warmth and calm into everyday life.",
    cta_text: "Our Story",
    cta_href: "#story",
  },

  brandStory: {
    label: "OUR STORY",
    headline: "Born from a love of slow living",
    body: "The Olive Goose began in a small kitchen, with nothing but beeswax, essential oils, and an obsession with creating the perfect scent. Each candle is hand-poured in small batches, using sustainably sourced soy wax and botanicals chosen for their ability to calm, energise, or ground the senses.\n\nWe believe your home should feel like a sanctuary — and that the right scent can transform any space.",
    image_url: "",
    cta_text: "Learn More",
    cta_href: "#",
  },

  products: {
    label: "THE COLLECTION",
    headline: "Scents for every season",
    subtext: "Each candle is hand-poured using sustainably sourced soy wax and premium fragrance oils.",
    items: [
      {
        id: "1",
        name: "Forest & Cedar",
        description: "Grounding. Woody. Earthy.",
        price: "€38",
        image_url: "",
        tag: "BESTSELLER",
      },
      {
        id: "2",
        name: "White Jasmine",
        description: "Floral. Clean. Serene.",
        price: "€38",
        image_url: "",
        tag: "NEW",
      },
      {
        id: "3",
        name: "Amber & Sandalwood",
        description: "Warm. Sensual. Timeless.",
        price: "€42",
        image_url: "",
        tag: "",
      },
    ],
  },

  candleCare: {
    label: "CANDLECARE",
    headline_part1: "Love it long.",
    headline_part2: "Burn it right.",
    cards: [
      {
        number: "01",
        title: "First Light",
        description:
          "On your first burn, let the wax pool reach the edges of the vessel — about 2–3 hours. This prevents tunnelling.",
      },
      {
        number: "02",
        title: "Trim Your Wick",
        description:
          "Before each burn, trim your wick to ¼ inch. This keeps the flame clean, extends burn time, and prevents soot.",
      },
      {
        number: "03",
        title: "Safe Burns Only",
        description:
          "Never burn for more than 4 hours at a time. Discontinue when ½ inch of wax remains.",
      },
    ],
  },

  videos: {
    label: "IN THE STUDIO",
    headline: "Watch how it's made",
    subtext: "From pour to packaging — a glimpse into our craft",
    items: [
      {
        id: "1",
        title: "The Pour",
        description: "Hand-pouring our signature soy blend",
        video_url: "",
      },
      {
        id: "2",
        title: "The Fragrance",
        description: "Blending natural essential oils",
        video_url: "",
      },
      {
        id: "3",
        title: "The Finish",
        description: "Labelling and packaging each candle",
        video_url: "",
      },
    ],
  },

  testimonials: {
    label: "RATE THE VIBES",
    headline: "What our customers say",
    items: [
      {
        id: "1",
        quote:
          "The most beautiful candles I've ever owned. The scent lasts for weeks and the vessel is stunning.",
        author: "Sarah M.",
        location: "Melbourne, AU",
        rating: 5,
      },
      {
        id: "2",
        quote:
          "Bought as a gift and immediately ordered one for myself. Absolutely divine.",
        author: "James K.",
        location: "Sydney, AU",
        rating: 5,
      },
      {
        id: "3",
        quote:
          "The packaging alone made me feel special. The candle exceeded all expectations.",
        author: "Priya R.",
        location: "London, UK",
        rating: 5,
      },
    ],
  },

  newsletter: {
    label: "JOIN THE FAMILY",
    headline: "First to know, first to glow",
    subtext:
      "Subscribe for new releases, seasonal collections, and candle care tips.",
    placeholder: "Enter your email address",
    cta_text: "Subscribe",
  },

  footer: {
    brand_name: "The Olive Goose",
    tagline: "Handcrafted with intention.",
    links: [
      { label: "About", href: "/about" },
      { label: "Delivery & Returns", href: "/returns" },
      { label: "Care Instructions", href: "/candle-care" },
      { label: "Contacts", href: "/customer-service" },
    ],
    social_links: [
      { platform: "Instagram", href: "#" },
      { platform: "TikTok", href: "#" },
      { platform: "Pinterest", href: "#" },
    ],
    policy_links: [
      { label: "Privacy policy",      href: "/privacy-policy" },
      { label: "Terms of service",    href: "/terms-of-service" },
      { label: "Refund policy",       href: "/returns" },
      { label: "Shipping policy",     href: "/shipping-policy" },
      { label: "Contact information", href: "/customer-service" },
    ],
    copyright: `© ${new Date().getFullYear()}, The Olive Goose`,
  },

  returnPolicy: {
    heading: "Delivery & Returns",
    intro: "Not the perfect scent? No worries — we want you to love what you burn. Here's how shipping and returns work at The Olive Goose.",
    sections: [
      {
        title: "Shipping & delivery",
        body: "Orders are handmade to order and typically ship within 2–4 business days, with delivery in 3–7 days depending on your location. You'll get a tracking link by email as soon as your order ships.",
      },
      {
        title: "Return window",
        body: "You can request a return within 30 days of delivery, as long as the candle is unused and in its original packaging.",
      },
      {
        title: "How refunds work",
        body: "Once we receive and inspect your return, we'll refund your original payment method within 5–7 business days.",
      },
      {
        title: "Damaged or incorrect items",
        body: "If your order arrived damaged or incorrect, contact us and we'll send a replacement or refund at no extra cost — no return needed.",
      },
    ],
    contact_email: "hello@theolivegoose.com",
  },

  giftCards: {
    heading: "Gift Cards",
    intro: "Give the gift of good scents. Olive Goose gift cards can be redeemed on anything in the shop.",
    denominations: ["€25", "€50", "€100"],
    note: "Gift cards are delivered by email and never expire.",
    cta_text: "Notify Me When Available",
    available: false,
  },

  customerService: {
    heading: "Contact Us",
    intro: "Questions about an order, a candle, or anything else? We're happy to help.",
    contact_email: "hello@theolivegoose.com",
    contact_phone: "",
    faqs: [
      {
        question: "How long does shipping take?",
        answer: "Orders are handmade to order and typically ship within 2–4 business days, with delivery in 3–7 days depending on your location.",
      },
      {
        question: "Can I change or cancel my order?",
        answer: "Reach out as soon as possible after ordering — we can usually make changes before an order ships.",
      },
      {
        question: "Are your candles safe for pets?",
        answer: "Our candles use cotton wicks and phthalate-free fragrance oils. As with any open flame, keep lit candles out of reach of pets.",
      },
    ],
  },

  pickupSettings: {
    enabled: true,
    location_name: "The Olive Goose Studio",
    address_line1: "14 Beacon Court",
    city: "Dublin 18",
    eircode: "D18 K7W2",
    country: "Ireland",
    hours: "Tue–Sat, 10am–5pm",
    discount_percent: 10,
    notes: "Bring your order confirmation email — we'll have it ready and waiting.",
    free_shipping_threshold: 65,
    flat_shipping_rate: 4.99,
  },

  privacyPolicy: {
    heading: "Privacy Policy",
    intro: "Your privacy matters to us. Here's what we collect, why, and how you're in control of it.",
    sections: [
      {
        title: "What we collect",
        body: "When you create an account, place an order, or sign up for our newsletter, we collect your name, email, shipping address, and order history. Payment details are handled directly by Stripe — we never see or store your card number.",
      },
      {
        title: "How we use it",
        body: "We use your information to process orders, provide customer support, and — only if you've opted in — send you emails about new collections and offers. We don't sell your data to third parties.",
      },
      {
        title: "Your rights",
        body: "You can access, correct, or request deletion of your personal data at any time by emailing us. You can unsubscribe from marketing emails using the link in any newsletter.",
      },
    ],
    contact_email: "hello@theolivegoose.com",
  },

  termsOfService: {
    heading: "Terms of Service",
    intro: "The basics of using our site and ordering from The Olive Goose.",
    sections: [
      {
        title: "Using our site",
        body: "You agree to use this site for lawful purposes only, and not to misuse, disrupt, or attempt to gain unauthorized access to any part of it.",
      },
      {
        title: "Orders & payment",
        body: "All orders are subject to availability. Prices are shown in euro and include applicable taxes unless stated otherwise. Payment is processed securely at checkout — your order is confirmed once payment succeeds.",
      },
      {
        title: "Limitation of liability",
        body: "Candles are handcrafted and should be burned in line with our candle care guidance. The Olive Goose is not liable for damage caused by improper use of our products.",
      },
    ],
    contact_email: "hello@theolivegoose.com",
  },

  shippingPolicy: {
    heading: "Shipping Policy",
    intro: "How we get your candles from our studio to your door.",
    sections: [
      {
        title: "Processing time",
        body: "Orders are handmade to order and typically ship within 2–4 business days. During busy seasonal periods this may extend slightly — we'll always email you if there's a delay.",
      },
      {
        title: "Delivery times & rates",
        body: "Standard delivery takes 3–7 business days depending on your location. Shipping is free on orders over €65; a flat rate applies below that. You'll receive a tracking link by email as soon as your order ships.",
      },
      {
        title: "In-store pickup",
        body: "Prefer to skip shipping altogether? Choose in-store pickup at checkout to collect your order from our studio and get a small discount.",
      },
    ],
    contact_email: "hello@theolivegoose.com",
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert any YouTube/Vimeo/Instagram URL to an embeddable src */
export const toEmbedUrl = (url: string): string => {
  if (!url) return "";
  // Already an embed
  if (
    url.includes("youtube.com/embed/") ||
    url.includes("player.vimeo.com") ||
    url.includes("instagram.com/reel/") && url.endsWith("/embed/") ||
    url.includes("instagram.com/p/") && url.endsWith("/embed/")
  ) return url;
  // YouTube watch or short URL
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/\s]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0`;
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  // Instagram Reel
  const igReelMatch = url.match(/instagram\.com\/reel\/([^/?#\s]+)/);
  if (igReelMatch) return `https://www.instagram.com/reel/${igReelMatch[1]}/embed/`;
  // Instagram Post
  const igPostMatch = url.match(/instagram\.com\/p\/([^/?#\s]+)/);
  if (igPostMatch) return `https://www.instagram.com/p/${igPostMatch[1]}/embed/`;
  // Fallback — treat as direct src
  return url;
};

export const isEmbedUrl = (url: string) =>
  url.includes("youtube.com/embed") ||
  url.includes("player.vimeo.com") ||
  (url.includes("instagram.com") && url.includes("/embed/"));

export const isDirectVideo = (url: string) =>
  /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
