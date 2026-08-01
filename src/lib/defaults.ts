import { DEFAULT_SEO, type SeoSettings } from "@/lib/seo";

export type { SeoSettings };

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
  /** Tail of the banner headline shown in gold — see src/lib/pageTitle.ts. */
  page_title_gold: string;
  page_subtitle: string;
  bundles: Bundle[];
}

export const DEFAULT_DEALS: DealsContent = {
  page_title: "Today's",
  page_title_gold: "Deals",
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

  // ── Product-page fields (all optional — products saved before the product page
  // existed keep working, the page just falls back to name/description/image) ──
  /** URL segment for /products/:slug. Blank = slugified name, else the id. */
  slug?: string;
  /** Extra images for the gallery thumbnail strip; `image_url` is always first. */
  gallery_urls?: string[];
  /** Long-form copy under the buy box — one paragraph per entry. */
  detail_paragraphs?: string[];
  /** Manual "You may also like" picks. Empty = auto-recommended. */
  recommended_ids?: string[];
}

// ── Product card theme ─────────────────────────────────────────────────────────
// The single source of truth for how product cards look across the whole
// storefront (homepage strip, scrapbook, shop grid, deals bundles). Stored as one
// content blob under the "productCardTheme" key and edited in Admin → Shop By
// Category → "Product Card Style". Change it once, it propagates everywhere.
export interface ProductCardTheme {
  /** Global accent — badge, name, price, and "Add to Cart" button. */
  accent: string;
  /** Text colour on top of the accent button. */
  buttonTextColor: string;
  /** Category IDs allowed to override `accent` with their own `accent_color`. */
  categoriesUsingOwnAccent: string[];
}

export const DEFAULT_PRODUCT_CARD_THEME: ProductCardTheme = {
  accent: "#6b3520",
  buttonTextColor: "#F5EFE6",
  categoriesUsingOwnAccent: [],
};

/**
 * Resolve the accent a product card should use in a given context. Defaults to
 * the global accent; a category only tints its own cards when the admin has
 * opted it into `categoriesUsingOwnAccent`.
 */
export const resolveCardAccent = (
  theme: ProductCardTheme | null | undefined,
  category?: { id: string; accent_color: string } | null,
): string => {
  const t = theme ?? DEFAULT_PRODUCT_CARD_THEME;
  if (category && t.categoriesUsingOwnAccent?.includes(category.id)) {
    return category.accent_color;
  }
  return t.accent;
};

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
  /**
   * The little sticker in the reel's top corner ("how'd they do that").
   * Blank or absent hides it — videos saved before the sticker existed have
   * no tag, so nothing appears until an admin writes one.
   */
  tag?: string;
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

/**
 * The photo-and-text story block on /about — the only page that renders it.
 *
 * It used to carry the About banner's headline too, which left two unrelated
 * "About page title" fields in the admin; the banner now belongs entirely to
 * {@link AboutPageContent}.
 */
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

// Shared copy for every /products/:slug page. Per-product copy (gallery,
// paragraphs, recommendations) lives on the Product itself.
export interface ProductCircleContent {
  enabled: boolean;
  headline: string;
  subtext: string;
  placeholder: string;
  cta_text: string;
  success_text: string;
}

export interface ProductPageContent {
  quantity_label: string;
  bundle_label: string;
  recommendations_headline: string;
  /** How many "You may also like" cards to show (auto-picked unless overridden). */
  recommendations_count: number;
  circle: ProductCircleContent;
}

/**
 * The /shop banner. Only the headline lives here — the eyebrow and the per-
 * category subtitle come from the shop categories themselves. The headline is
 * used for the "All Candles" view; a category or search view titles itself.
 */
export interface ShopPageContent {
  page_title: string;
  page_title_gold: string;
}

export interface CandleCareContent {
  label: string;
  headline_part1: string;
  headline_part2: string;
  /** Line under the page headline. Optional because older saved content predates it. */
  hero_subtitle?: string;
  cards: CandleCareCard[];
}

export interface VideosContent {
  label: string;
  headline: string;
  subtext: string;
  /** Phrases in the scrolling strip above the reels. Empty hides the strip. */
  ticker: string[];
  items: VideoItem[];
  /**
   * Whether the studio reel section shows on the home page. Optional and ON by
   * default: content saved before this toggle existed has no `enabled` key, and
   * a missing key must not read as "off" — that would silently pull a live
   * section off the storefront the moment this ships. Only an explicit `false`
   * hides it, which is what {@link isVideosEnabled} encodes.
   */
  enabled?: boolean;
}

/** Read the videos toggle. Absent means on — see {@link VideosContent.enabled}. */
export const isVideosEnabled = (data: Pick<VideosContent, "enabled">) => data.enabled !== false;

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

/** One card in the "What we believe in" strip on /about. */
export interface AboutValue {
  icon: string;
  title: string;
  body: string;
}

/**
 * The parts of /about that belong to that page alone — the hero band and the
 * values strip under the story.
 *
 * The story block above the strip and the maker block below it are shared with
 * the home page (Brand Story and Welcome Club respectively), so they are edited
 * in their own sections; everything the About page owns outright lives here.
 */
export interface AboutPageContent {
  /** Small gold line above the banner headline, between the two candles. */
  hero_eyebrow: string;
  page_title: string;
  /** Tail of the banner headline shown in gold — see src/lib/pageTitle.ts. */
  page_title_gold: string;
  page_subtitle: string;
  /** Heading over the values strip. Blank hides the strip's heading. */
  values_heading: string;
  /** The strip's cards. An empty list hides the whole strip. */
  values: AboutValue[];
}

export interface WelcomeClubContent {
  headline: string;
  photo_url: string;
  name_line: string;
  bio: string;
  cta_text: string;
  cta_href: string;
  /**
   * Button shown before the main CTA — opens the founder's photo diary page.
   * Blank text hides it.
   */
  diary_cta_text: string;
  diary_cta_href: string;
}

/**
 * The "Meet the maker" block on /about.
 *
 * It started life as a straight mirror of the home page's Welcome Club section,
 * which meant the About page could never say anything the home page didn't. The
 * mirror is still the default (`use_home_content`), so nothing changes for a
 * store that never opens this editor — but switching it off lets the About page
 * carry its own photo and words.
 *
 * The label, the two buttons and the maker photo's alt text always belong to
 * this page: they exist nowhere in the Welcome Club section, and the buttons
 * point at things (the block itself, the Our Story page) that only exist here.
 */
export interface AboutFounderContent {
  /** true → photo/headline/name line/bio come from Home Page → Welcome Club. */
  use_home_content: boolean;
  /** Small uppercase label above the block, e.g. "Meet the maker". */
  label: string;
  headline: string;
  photo_url: string;
  name_line: string;
  bio: string;
  /** Button under the bio — opens the photo diary page. Blank hides it. */
  cta_text: string;
  cta_href: string;
  /**
   * The button beside the story block's own CTA further up the page, which
   * scrolls down to this block. Blank hides it.
   */
  jump_cta_text: string;
}

export interface OurStoryPhoto {
  id: string;
  /** A photo URL — or a video: a direct file (.mp4 …), a YouTube/Shorts,
      Vimeo, Instagram or Cloudinary link. {@link diaryMediaKind} tells the
      reel which one it's holding. */
  image_url: string;
  caption: string;
}

/** The photo diary at /our-story that the maker block's button opens. */
export interface OurStoryPageContent {
  label: string;
  page_title: string;
  page_title_gold: string;
  page_subtitle: string;
  /** Blank lines separate paragraphs, as everywhere else. */
  intro: string;
  intro_tag_primary: string;
  intro_tag_secondary: string;
  intro_headline: string;
  intro_headline_gold: string;
  intro_hint: string;
  candle_label: string;
  candle_image_url: string;
  /** Where the wick meets the wax in the candle artwork, as a % of the visible frame — the flame burns from there. */
  candle_wick_x: number;
  candle_wick_y: number;
  candle_wrapped_title: string;
  candle_wrapped_action: string;
  candle_wrapped_note: string;
  candle_ready_title: string;
  candle_ready_action: string;
  candle_ready_note: string;
  candle_lit_title: string;
  candle_lit_action: string;
  candle_lit_note: string;
  celebration_message: string;
  diary_label: string;
  diary_headline: string;
  diary_hint: string;
  diary_empty_message: string;
  photos: OurStoryPhoto[];
  closing_label: string;
  closing_headline: string;
  closing_body: string;
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
  /** Tail of the banner headline shown in gold — see src/lib/pageTitle.ts. */
  heading_gold: string;
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
  /** Tail of the banner headline shown in gold — see src/lib/pageTitle.ts. */
  heading_gold: string;
  intro: string;
  contact_email: string;
  contact_phone: string;
  faqs: FaqItem[];
  /** The /faq page banner. Its Q&As are `faqs` below, so its copy lives here too. */
  faq_heading: string;
  faq_heading_gold: string;
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

// Bottom-left signup playcard shown once per session to first-time visitors on
// the home page. Copy fields may include a {discount} token — it renders as the
// configured discount percent.
export interface SubscribePopupContent {
  enabled: boolean;
  discount_percent: number;
  eyebrow: string;
  headline: string;
  subtext: string;
  placeholder: string;
  cta_text: string;
  success_text: string;
  delay_seconds: number;
}

export interface SiteContent {
  announcementBar: AnnouncementBarContent;
  navbar: NavbarContent;
  hero: HeroContent;
  momentPill: MomentPillContent;
  welcomeClub: WelcomeClubContent;
  brandStory: BrandStoryContent;
  aboutPage: AboutPageContent;
  aboutFounder: AboutFounderContent;
  ourStoryPage: OurStoryPageContent;
  products: ProductsContent;
  productPage: ProductPageContent;
  shopPage: ShopPageContent;
  candleCare: CandleCareContent;
  videos: VideosContent;
  testimonials: TestimonialsContent;
  newsletter: NewsletterContent;
  footer: FooterContent;
  returnPolicy: ReturnPolicyContent;
  giftCards: GiftCardsContent;
  customerService: CustomerServiceContent;
  pickupSettings: PickupSettingsContent;
  subscribePopup: SubscribePopupContent;
  privacyPolicy: LegalPageContent;
  termsOfService: LegalPageContent;
  shippingPolicy: LegalPageContent;
  // Search-engine metadata (titles, descriptions, icons). The shape and the
  // fallbacks live in src/lib/seo.ts next to the code that applies them.
  seo: SeoSettings;
}

// ── Default content ────────────────────────────────────────────────────────────

export const DEFAULT_CONTENT: SiteContent = {
  announcementBar: {
    messages: [
      "✨ Free shipping {free_shipping}",
      "🕯️ New café collection dropping soon — Shop now →",
      "💌 Sign up for early access & {discount}% off your first order",
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
    subtext: "Soy candles hand-poured in Dublin — scents that smell like your favourite cozy corner.",
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
    diary_cta_text: "Founder's Diary",
    diary_cta_href: "/our-story",
  },

  brandStory: {
    label: "OUR STORY",
    headline: "Born from a love of slow living",
    body: "The Olive Goose began in a small Dublin kitchen, with a pot of soy wax, a shelf of fragrance oils, and an obsession with creating the perfect scent. Each candle is hand-poured in small batches in Ireland, using sustainably sourced soy wax and fragrances chosen for their ability to calm, energise, or ground the senses.\n\nWe believe your home should feel like a sanctuary — and that the right scent can transform any space.",
    image_url: "",
    cta_text: "Learn More",
    cta_href: "#values",
  },

  aboutPage: {
    hero_eyebrow: "Our Story",
    // These two also become the page's search-result title, so they read as one
    // headline rather than the old "Our Story" + "About" pair, which rendered
    // "Our Story About" under an eyebrow that already said "Our Story".
    page_title: "From Café Moments to",
    page_title_gold: "Candle Glow",
    page_subtitle: "Handcrafted with intention. Poured with love. Made for moments that matter.",
    values_heading: "What we believe in",
    values: [
      {
        icon: "🌿",
        title: "Sustainably Sourced",
        body: "Every ingredient is chosen with the planet in mind — soy wax, cotton wicks, recycled packaging.",
      },
      {
        icon: "🤝",
        title: "Small Batch",
        body: "We pour in small batches to guarantee quality, freshness and a personal touch in every candle.",
      },
      {
        icon: "💛",
        title: "Made with Intention",
        body: "Each scent is designed around a feeling — because the right candle can transform any room.",
      },
    ],
  },

  aboutFounder: {
    use_home_content: true,
    label: "Meet the maker",
    headline: "Welcome to the Olive Goose Club!",
    photo_url: "",
    name_line: "Hi, I'm Meghna — the person behind The Olive Goose.",
    bio: "I create café-inspired pieces designed to bring warmth and calm into everyday life.",
    cta_text: "Founder's Diary",
    cta_href: "/our-story",
    jump_cta_text: "Meet the Founder",
  },

  ourStoryPage: {
    label: "Behind the pour",
    page_title: "A Day in the",
    page_title_gold: "Studio",
    page_subtitle: "The pours, the spills and the small wins behind every Olive Goose candle.",
    intro:
      "The Olive Goose is a one-person studio in Dublin. Every candle starts as a block of soy wax on the kitchen counter and ends up wrapped by hand, and these are the bits in between.",
    intro_tag_primary: "photo dump ✦",
    intro_tag_secondary: "made in dublin",
    intro_headline: "Little studio moments,",
    intro_headline_gold: "big main-character energy.",
    intro_hint: "Tap the candle, then take a wander ↓",
    candle_label: "The cosy little experiment",
    candle_image_url: "https://i.ibb.co/fz8G0NTb/44a9703e-bfab-4d84-a8d2-41ca7ff4df87.jpg",
    candle_wick_x: 51.2,
    candle_wick_y: 28.1,
    candle_wrapped_title: "A tiny parcel, just for you",
    candle_wrapped_action: "Unbox the candle",
    candle_wrapped_note: "Tap the parcel to peel it open",
    candle_ready_title: "Okay, now make it cosy",
    candle_ready_action: "Light the candle",
    candle_ready_note: "One little tap and we’re glowing",
    candle_lit_title: "The studio is officially glowing",
    candle_lit_action: "Blow out the candle",
    candle_lit_note: "Make a wish — the photo diary is next",
    celebration_message: "Pop! The photo diary is unlocked.",
    diary_label: "The daily photo diary",
    diary_headline: "Proof we were here ✷",
    diary_hint: "Swipe up for the next one ✦ tap to go full-screen",
    diary_empty_message: "The next studio snapshots are loading soon.",
    photos: [],
    closing_label: "From my hands to yours",
    closing_headline: "Made by hand, one batch at a time",
    closing_body:
      "Every candle you order is poured, cured, trimmed and packed by the same pair of hands you've just been looking at.",
    cta_text: "Shop the candles",
    cta_href: "/shop",
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

  productPage: {
    quantity_label: "How many would you like?",
    bundle_label: "BUNDLE DEAL",
    recommendations_headline: "You may also like",
    recommendations_count: 4,
    circle: {
      enabled: true,
      headline: "Join the Olive Goose Circle",
      subtext: "Early access to new pours, small-batch restocks and members-only offers.",
      placeholder: "your@email.com",
      cta_text: "Join the Circle",
      success_text: "You're in the Circle!",
    },
  },

  shopPage: {
    page_title: "All",
    page_title_gold: "Candles",
  },

  candleCare: {
    label: "CANDLE CARE",
    headline_part1: "Love it long.",
    headline_part2: "Burn it right.",
    hero_subtitle: "Everything you need to get the most out of your Olive Goose candle.",
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
    enabled: true,
    label: "IN THE STUDIO",
    headline: "Watch how it's made",
    subtext: "From pour to packaging — a glimpse into our craft",
    ticker: [
      "poured by hand",
      "no two the same",
      "straight from the studio",
      "unfiltered, unedited",
      "yes, that's the real wax",
    ],
    items: [
      {
        id: "1",
        title: "The Pour",
        description: "Hand-pouring our signature soy blend",
        video_url: "",
        tag: "how'd they do that",
      },
      {
        id: "2",
        title: "The Fragrance",
        description: "Blending natural essential oils",
        video_url: "",
        tag: "the secret bit",
      },
      {
        id: "3",
        title: "The Finish",
        description: "Labelling and packaging each candle",
        video_url: "",
        tag: "wait for the end",
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
    tagline: "Handcrafted with intention in Dublin, Ireland.",
    links: [
      { label: "About", href: "/about" },
      { label: "Delivery & Returns", href: "/returns" },
      { label: "Care Instructions", href: "/candle-care" },
      { label: "FAQs", href: "/faq" },
      { label: "Contacts", href: "/customer-service" },
    ],
    social_links: [
      { platform: "Instagram", href: "#" },
      { platform: "TikTok", href: "#" },
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
    heading: "Delivery &",
    heading_gold: "Returns",
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
    heading: "Contact",
    heading_gold: "Us",
    intro: "Questions about an order, a candle, or anything else? We're happy to help.",
    contact_email: "hello@theolivegoose.com",
    contact_phone: "",
    faq_heading: "Frequently Asked",
    faq_heading_gold: "Questions",
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
      {
        question: "What are your candles made of?",
        answer: "Every candle is hand-poured in Dublin using sustainably sourced soy wax, cotton wicks and premium phthalate-free fragrance oils.",
      },
      {
        question: "Are The Olive Goose candles made in Ireland?",
        answer: "Yes — every candle is handmade in small batches at our Dublin studio and shipped from Ireland.",
      },
      {
        question: "How long do your candles burn for?",
        answer: "Burn time depends on the size of the candle and how it's cared for. Letting the wax pool reach the edge on the first burn and trimming the wick to ¼ inch before each use gives the longest, cleanest burn — see our Candle Care guide for details.",
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

  subscribePopup: {
    enabled: true,
    discount_percent: 10,
    eyebrow: "✨ psst… it's giving savings",
    headline: "wanna be an insider?",
    subtext: "drop your email & score {discount}% off your first order. no spam, just main-character candle content. 🕯️",
    placeholder: "your email, bestie",
    cta_text: "claim my {discount}% off",
    success_text: "you're in! 🎉 welcome to the soft life.",
    delay_seconds: 3,
  },

  privacyPolicy: {
    heading: "Privacy",
    heading_gold: "Policy",
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
    heading: "Terms of",
    heading_gold: "Service",
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
    heading: "Shipping",
    heading_gold: "Policy",
    intro: "How we get your candles from our studio to your door.",
    sections: [
      {
        title: "Processing time",
        body: "Orders are handmade to order and typically ship within 2–4 business days. During busy seasonal periods this may extend slightly — we'll always email you if there's a delay.",
      },
      {
        title: "Delivery times & rates",
        // Deliberately no "a flat rate applies below that" tail: with a threshold
        // of 0 the {free_shipping} clause reads "on all orders", and the tail would
        // then contradict it. The clause implies the charge on its own.
        body: "Standard delivery takes 3–7 business days depending on your location. Shipping is free {free_shipping}. You'll receive a tracking link by email as soon as your order ships.",
      },
      {
        title: "In-store pickup",
        body: "Prefer to skip shipping altogether? Choose in-store pickup at checkout to collect your order from our studio and get a small discount.",
      },
    ],
    contact_email: "hello@theolivegoose.com",
  },

  seo: DEFAULT_SEO,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert any video URL the admin can paste into something the reel rail can
 * actually play.
 *
 * What people paste is whatever the share button handed them, which is rarely
 * the canonical `watch?v=` form: a Shorts link (the natural match for a 9:16
 * reel), a `youtu.be` link carrying a `?si=` tracking param, a mobile link with
 * `v=` after some other query param, or a Cloudinary delivery URL whose
 * transformation chain left no file extension. Anything unrecognised falls
 * through as a direct file src, and a direct src that isn't a video file renders
 * the empty placeholder — i.e. the video silently never appears on the home
 * page. So every shape that can be resolved is resolved here.
 */
export const toEmbedUrl = (url: string): string => {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  // Already an embed
  if (
    /youtube(-nocookie)?\.com\/embed\//.test(raw) ||
    raw.includes("player.vimeo.com") ||
    raw.includes("instagram.com/reel/") && raw.endsWith("/embed/") ||
    raw.includes("instagram.com/p/") && raw.endsWith("/embed/")
  ) return raw;
  // YouTube — youtu.be, /shorts/, /live/, /v/, or a `v=` param in any position
  const ytId =
    raw.match(/youtu\.be\/([^/?#&\s]+)/)?.[1] ??
    raw.match(/youtube(?:-nocookie)?\.com\/(?:shorts|live|v|e)\/([^/?#&\s]+)/)?.[1] ??
    raw.match(/youtube(?:-nocookie)?\.com\/\S*[?&]v=([^&#\s]+)/)?.[1];
  if (ytId) return `https://www.youtube.com/embed/${ytId}?rel=0`;
  // Vimeo
  const vimeoMatch = raw.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  // Instagram Reel
  const igReelMatch = raw.match(/instagram\.com\/reel\/([^/?#\s]+)/);
  if (igReelMatch) return `https://www.instagram.com/reel/${igReelMatch[1]}/embed/`;
  // Instagram Post
  const igPostMatch = raw.match(/instagram\.com\/p\/([^/?#\s]+)/);
  if (igPostMatch) return `https://www.instagram.com/p/${igPostMatch[1]}/embed/`;
  // Cloudinary video delivery — extension-less URLs are common (the format is
  // negotiated by the delivery chain); asking for .mp4 makes it a plain file src.
  if (/res\.cloudinary\.com\/\S+\/video\/upload\//.test(raw) && !isDirectVideo(raw)) {
    return `${raw.split(/[?#]/)[0].replace(/\/+$/, "")}.mp4`;
  }
  // Fallback — treat as direct src
  return raw;
};

export const isEmbedUrl = (url: string) =>
  /youtube(-nocookie)?\.com\/embed/.test(url) ||
  url.includes("player.vimeo.com") ||
  (url.includes("instagram.com") && url.includes("/embed/"));

export const isDirectVideo = (url: string) =>
  /\.(mp4|webm|ogg|ogv|mov|m4v)([?#].*)?$/i.test(url);

/**
 * What a diary entry's media URL actually holds. The founder diary takes
 * photos and videos through the same field, so the URL itself has to say
 * which it is: anything {@link toEmbedUrl} resolves to a player iframe is an
 * "embed", a video file (or a Cloudinary video delivery URL) is a "video",
 * and everything else — the common case — is a photo. Defaulting to "image"
 * rather than a placeholder matters: an unrecognised URL was pasted as a
 * picture, and an <img> that fails to load is honest about that.
 */
export type DiaryMediaKind = "image" | "video" | "embed";

export const diaryMediaKind = (url: string): DiaryMediaKind => {
  const embed = toEmbedUrl(url);
  if (!embed) return "image";
  if (isEmbedUrl(embed)) return "embed";
  if (isDirectVideo(embed)) return "video";
  return "image";
};
