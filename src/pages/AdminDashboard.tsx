import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
import {
  isLoggedIn,
  logout,
  getContent,
  saveContent,
  getSubscribers,
  deleteSubscriber,
  getAdminDiscountCodes,
  type DiscountCodeRecord,
  getAdminUsers,
  getAdminFeedback,
  deleteAdminFeedback,
  getShopCategories,
  saveShopCategory,
  deleteShopCategory,
  saveShopCandle,
  deleteShopCandle,
  getAdminReturns,
  updateReturnStatus,
  getAdminOrders,
  updateOrderStatus,
  updateOrderPaymentStatus,
  getAdminOrderDetail,
  decideCancellation,
  markRefundDone,
  sendOrderMessage,
  getOpsOverview,
  getAutomationSettings,
  saveAutomationSettings,
  getAdminDecisions,
  approveDecision,
  dismissDecision,
  getResolvedDecisions,
  ORDER_STAGES,
  DEFAULT_AUTOMATION_SETTINGS,
  SessionExpiredError,
  type Subscriber,
  type AppUserRecord,
  type FeedbackRecord,
  type ShopCategory,
  type ShopCandle,
  type AdminReturnRecord,
  type AdminOrderRecord,
  type OrderTimelineEvent,
  type RefundReminder,
  type OpsOverview,
  type AutomationSettings,
  type AdminDecision,
} from "@/lib/api";
import {
  DEFAULT_CONTENT,
  DEFAULT_DEALS,
  type SiteContent,
  type Product,
  type Bundle,
  type DealsContent,
  type AnnouncementBarContent,
  type NavbarContent,
  type HeroContent,
  type MomentPillContent,
  type WelcomeClubContent,
  type BrandStoryContent,
  type ProductsContent,
  type CandleCareContent,
  type VideosContent,
  type TestimonialsContent,
  type NewsletterContent,
  type FooterContent,
  type ReturnPolicyContent,
  type GiftCardsContent,
  type CustomerServiceContent,
  type PickupSettingsContent,
  type SubscribePopupContent,
  type LegalPageContent,
  type CandleCareCard,
  type VideoItem,
  type Testimonial,
  type NavLink,
  type SocialLink,
} from "@/lib/defaults";
import { useToast } from "@/hooks/use-toast";
import AdminLogin from "@/components/AdminLogin";
import AnalyticsPanel from "@/components/admin/AnalyticsPanel";
import logo from "@/assets/logo.jpg";
import { DEFAULT_SCRAPBOOK_SETTINGS, type ScrapbookSettings } from "@/components/sections/ScrapbookSection";

// ── Shared UI helpers ──────────────────────────────────────────────────────────

const Field = ({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) => (
  <div className="space-y-1.5">
    <label className="block text-sm font-sans font-medium text-foreground">{label}</label>
    {children}
    {hint && <p className="text-xs text-muted-foreground font-sans">{hint}</p>}
  </div>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${props.className ?? ""}`}
  />
);

const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    className={`w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none ${props.className ?? ""}`}
  />
);

const SaveButton = ({
  onClick,
  saving,
}: {
  onClick: () => void;
  saving: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={saving}
    className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium hover:bg-olive-light transition-all disabled:opacity-50"
  >
    {saving ? "Saving…" : "Save Changes"}
  </button>
);

// Shows what the customer was last told (and when) right next to whatever
// admin control could re-trigger a notification — so it's never ambiguous
// whether contact has already happened for this order/return.
const LastNotified = ({ title, at }: { title: string | null; at: string | null }) => (
  <p className="font-sans text-[11px] text-muted-foreground mt-1 max-w-[180px] truncate" title={title ? `${title} · ${new Date(at!).toLocaleString()}` : undefined}>
    {title ? <>✉ {title} · {new Date(at!).toLocaleDateString()}</> : "No notification sent yet"}
  </p>
);

const SectionHeading = ({ title, desc }: { title: string; desc?: string }) => (
  <div className="mb-8 pb-4 border-b border-border">
    <h2 className="font-serif text-2xl text-foreground">{title}</h2>
    {desc && <p className="font-sans text-sm text-muted-foreground mt-1">{desc}</p>}
  </div>
);

const AddButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-border text-muted-foreground font-sans text-sm hover:border-primary hover:text-primary transition-colors"
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
    {label}
  </button>
);

const RemoveButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="p-1.5 rounded text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
    title="Remove"
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
);

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-muted/40 border border-border rounded-xl p-5 space-y-4">{children}</div>
);

// ── Section editors ────────────────────────────────────────────────────────────

const AnnouncementBarEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: AnnouncementBarContent;
  onChange: (d: AnnouncementBarContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading
      title="Announcement Bar"
      desc="The coloured strip above the navbar. Messages rotate automatically."
    />

    <div className="space-y-3">
      <label className="block text-sm font-sans font-medium text-foreground">
        Messages (up to 5)
      </label>
      {data.messages.map((msg, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            placeholder={`Message ${i + 1}`}
            value={msg}
            onChange={(e) => {
              const messages = [...data.messages];
              messages[i] = e.target.value;
              onChange({ ...data, messages });
            }}
          />
          <RemoveButton
            onClick={() => onChange({ ...data, messages: data.messages.filter((_, j) => j !== i) })}
          />
        </div>
      ))}
      {data.messages.length < 5 && (
        <AddButton
          label="Add message"
          onClick={() => onChange({ ...data, messages: [...data.messages, ""] })}
        />
      )}
    </div>

    <Field
      label={`Display time per message: ${data.interval_ms / 1000}s`}
      hint="How long each message stays visible before the next one appears"
    >
      <input
        type="range"
        min={500}
        max={8000}
        step={100}
        value={data.interval_ms}
        onChange={(e) => onChange({ ...data, interval_ms: Number(e.target.value) })}
        className="w-full accent-primary"
      />
      <div className="flex justify-between text-xs text-muted-foreground font-sans mt-1">
        <span>0.5 s</span><span>8 s</span>
      </div>
    </Field>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

const NavbarEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: NavbarContent;
  onChange: (d: NavbarContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Navbar" desc="Configure the top navigation bar." />
    <Field label="Brand Name">
      <Input value={data.brand_name} onChange={(e) => onChange({ ...data, brand_name: e.target.value })} />
    </Field>
    <Field label="CTA Button Text">
      <Input value={data.cta_text} onChange={(e) => onChange({ ...data, cta_text: e.target.value })} />
    </Field>
    <Field label="CTA Button Link">
      <Input value={data.cta_href} onChange={(e) => onChange({ ...data, cta_href: e.target.value })} />
    </Field>

    <div className="space-y-2">
      <label className="block text-sm font-sans font-medium text-foreground">Nav Links</label>
      {data.links.map((link, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            placeholder="Label"
            value={link.label}
            onChange={(e) => {
              const links = [...data.links];
              links[i] = { ...links[i], label: e.target.value };
              onChange({ ...data, links });
            }}
          />
          <Input
            placeholder="Href"
            value={link.href}
            onChange={(e) => {
              const links = [...data.links];
              links[i] = { ...links[i], href: e.target.value };
              onChange({ ...data, links });
            }}
          />
          <RemoveButton onClick={() => {
            const links = data.links.filter((_, j) => j !== i);
            onChange({ ...data, links });
          }} />
        </div>
      ))}
      <AddButton
        label="Add link"
        onClick={() => onChange({ ...data, links: [...data.links, { label: "", href: "#" }] })}
      />
    </div>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

const HeroEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: HeroContent;
  onChange: (d: HeroContent) => void;
  onSave: () => void;
  saving: boolean;
}) => {
  return (
    <div className="space-y-6">
      <SectionHeading title="Home Page" desc="The full-screen hero banner at the top of the homepage." />

      <Field label="Headline">
        <Input value={data.headline} onChange={(e) => onChange({ ...data, headline: e.target.value })} />
      </Field>
      <Field label="Subtext">
        <Textarea rows={2} value={data.subtext} onChange={(e) => onChange({ ...data, subtext: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="CTA Button Text">
          <Input value={data.cta_text} onChange={(e) => onChange({ ...data, cta_text: e.target.value })} />
        </Field>
        <Field label="CTA Button Link">
          <Input value={data.cta_href} onChange={(e) => onChange({ ...data, cta_href: e.target.value })} />
        </Field>
      </div>

      {/* Background image — direct URL */}
      <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
        <p className="font-sans text-sm font-semibold text-foreground">Background Image</p>

        {/* Live preview */}
        {data.bg_image_url && (
          <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: "16/5" }}>
            <img src={data.bg_image_url} alt="Hero background preview"
              className="w-full h-full object-cover" />
          </div>
        )}

        <Field label="Image URL" hint="Paste a direct link to a hosted image (jpg, png, or webp). The site loads it straight from this URL.">
          <Input
            placeholder="https://…"
            value={data.bg_image_url}
            onChange={(e) => onChange({ ...data, bg_image_url: e.target.value })}
          />
        </Field>
      </div>

      {/* Image brightness */}
      <Field
        label={`Image brightness: ${Math.round((data.bg_opacity ?? 1.0) * 100)}%`}
        hint="100% = original photo, no fading. Lower = more faded."
      >
        <input type="range" min={10} max={100}
          value={Math.round((data.bg_opacity ?? 1.0) * 100)}
          onChange={e => onChange({ ...data, bg_opacity: Number(e.target.value) / 100 })}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground font-sans mt-1">
          <span>10% (very faded)</span><span>100% (original)</span>
        </div>
      </Field>

      {/* Tint overlay */}
      <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
        <p className="font-sans text-sm font-semibold text-foreground">Colour Tint Overlay</p>
        <p className="font-sans text-xs text-muted-foreground">Sits over the photo to make text readable. Set strength to 0% to remove.</p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tint colour">
            <div className="flex gap-2 items-center">
              <input type="color"
                value={data.tint_color ?? "#1e2918"}
                onChange={e => onChange({ ...data, tint_color: e.target.value })}
                className="w-10 h-9 rounded border border-border cursor-pointer shrink-0"
              />
              <Input value={data.tint_color ?? "#1e2918"}
                onChange={e => onChange({ ...data, tint_color: e.target.value })} />
            </div>
          </Field>
          <Field label={`Tint strength: ${Math.round((data.tint_opacity ?? 0.45) * 100)}%`}
            hint="0% = no tint, transparent">
            <input type="range" min={0} max={90}
              value={Math.round((data.tint_opacity ?? 0.45) * 100)}
              onChange={e => onChange({ ...data, tint_opacity: Number(e.target.value) / 100 })}
              className="w-full accent-primary mt-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground font-sans mt-1">
              <span>0% (none)</span><span>90% (heavy)</span>
            </div>
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="countdown"
          checked={data.show_countdown}
          onChange={(e) => onChange({ ...data, show_countdown: e.target.checked })}
          className="w-4 h-4 rounded border-border text-primary"
        />
        <label htmlFor="countdown" className="text-sm font-sans text-foreground">Show Countdown Timer</label>
      </div>
      {data.show_countdown && (
        <Field label="Launch Date">
          <Input
            type="datetime-local"
            value={data.launch_date || ""}
            onChange={(e) => onChange({ ...data, launch_date: e.target.value })}
          />
        </Field>
      )}
      <SaveButton onClick={onSave} saving={saving} />
    </div>
  );
};

const BrandStoryEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: BrandStoryContent;
  onChange: (d: BrandStoryContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Brand Story" desc="The 'Our Story' two-column section." />
    <Field label="Section Label" hint="Small uppercase label above the headline">
      <Input value={data.label} onChange={(e) => onChange({ ...data, label: e.target.value })} />
    </Field>
    <Field label="Headline">
      <Input value={data.headline} onChange={(e) => onChange({ ...data, headline: e.target.value })} />
    </Field>
    <Field label="Body Text" hint="Use blank lines to separate paragraphs">
      <Textarea rows={6} value={data.body} onChange={(e) => onChange({ ...data, body: e.target.value })} />
    </Field>
    <Field label="Image URL">
      <Input
        placeholder="https://…"
        value={data.image_url}
        onChange={(e) => onChange({ ...data, image_url: e.target.value })}
      />
    </Field>
    <div className="grid grid-cols-2 gap-4">
      <Field label="CTA Button Text">
        <Input value={data.cta_text} onChange={(e) => onChange({ ...data, cta_text: e.target.value })} />
      </Field>
      <Field label="CTA Button Link">
        <Input value={data.cta_href} onChange={(e) => onChange({ ...data, cta_href: e.target.value })} />
      </Field>
    </div>
    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

const ProductsEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: ProductsContent;
  onChange: (d: ProductsContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Products / Collection" desc="Product cards shown in the grid." />
    <Field label="Section Label">
      <Input value={data.label} onChange={(e) => onChange({ ...data, label: e.target.value })} />
    </Field>
    <Field label="Section Headline">
      <Input value={data.headline} onChange={(e) => onChange({ ...data, headline: e.target.value })} />
    </Field>
    <Field label="Section Subtext">
      <Textarea rows={2} value={data.subtext} onChange={(e) => onChange({ ...data, subtext: e.target.value })} />
    </Field>

    <div className="space-y-4">
      <label className="block text-sm font-sans font-medium text-foreground">Products</label>
      {data.items.map((product, i) => (
        <Card key={product.id}>
          <div className="flex items-center justify-between">
            <span className="font-sans text-sm font-medium text-foreground">Product {i + 1}</span>
            <RemoveButton onClick={() => onChange({ ...data, items: data.items.filter((_, j) => j !== i) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={product.name} onChange={(e) => {
                const items = [...data.items];
                items[i] = { ...items[i], name: e.target.value };
                onChange({ ...data, items });
              }} />
            </Field>
            <Field label="Price (€)" hint="Just enter the number — it's shown in euro (€) on the storefront by default.">
              <Input value={product.price} onChange={(e) => {
                const items = [...data.items];
                items[i] = { ...items[i], price: e.target.value };
                onChange({ ...data, items });
              }} />
            </Field>
          </div>
          <Field label="Description">
            <Input value={product.description} onChange={(e) => {
              const items = [...data.items];
              items[i] = { ...items[i], description: e.target.value };
              onChange({ ...data, items });
            }} />
          </Field>
          <Field label="Image URL">
            <Input placeholder="https://…" value={product.image_url} onChange={(e) => {
              const items = [...data.items];
              items[i] = { ...items[i], image_url: e.target.value };
              onChange({ ...data, items });
            }} />
          </Field>
          <Field label="Badge / Tag" hint={`e.g. "NEW", "BESTSELLER" — leave blank to hide`}>
            <Input value={product.tag} onChange={(e) => {
              const items = [...data.items];
              items[i] = { ...items[i], tag: e.target.value };
              onChange({ ...data, items });
            }} />
          </Field>
          <Field label="Stock" hint="Optional — leave blank to not track inventory for this product. When set, it's decremented automatically on each purchase and flagged in Ops once low.">
            <Input type="number" min={0} placeholder="Not tracked"
              value={product.stock ?? ""}
              onChange={(e) => {
                const items = [...data.items];
                const v = e.target.value;
                items[i] = { ...items[i], stock: v === "" ? null : Number(v) };
                onChange({ ...data, items });
              }} />
          </Field>
        </Card>
      ))}
      <AddButton
        label="Add product"
        onClick={() => {
          const newProduct: Product = {
            id: Date.now().toString(),
            name: "New Product",
            description: "",
            price: "0",
            image_url: "",
            tag: "",
          };
          onChange({ ...data, items: [...data.items, newProduct] });
        }}
      />
    </div>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

const MomentPillEditor = ({
  data, onChange, onSave, saving,
}: { data: MomentPillContent; onChange: (d: MomentPillContent) => void; onSave: () => void; saving: boolean }) => (
  <div className="space-y-6">
    <SectionHeading title="'Live in the Moment' Pill" desc="The white pill section between Products and Welcome." />
    <Field label="Text 1" hint={`e.g. "Live in the moment."`}>
      <Input value={data.text1} onChange={(e) => onChange({ ...data, text1: e.target.value })} />
    </Field>
    <Field label="Image 1 URL" hint="Paste a direct image link — shown inline inside the pill. The site loads it straight from this URL.">
      <Input placeholder="https://…" value={data.image1_url} onChange={(e) => onChange({ ...data, image1_url: e.target.value })} />
    </Field>
    <Field label="Text 2" hint={`e.g. "Because after all,"`}>
      <Input value={data.text2} onChange={(e) => onChange({ ...data, text2: e.target.value })} />
    </Field>
    <Field label="Image 2 URL" hint="Paste a direct image link — shown inline inside the pill. The site loads it straight from this URL.">
      <Input placeholder="https://…" value={data.image2_url} onChange={(e) => onChange({ ...data, image2_url: e.target.value })} />
    </Field>
      <Field label="Text 3" hint={`e.g. "isn't it the most important?"`}>
      <Input value={data.text3} onChange={(e) => onChange({ ...data, text3: e.target.value })} />
    </Field>
    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

const WelcomeClubEditor = ({
  data, onChange, onSave, saving,
}: { data: WelcomeClubContent; onChange: (d: WelcomeClubContent) => void; onSave: () => void; saving: boolean }) => (
  <div className="space-y-6">
    <SectionHeading title="Welcome to the Club" desc="Green section with founder photo and bio." />
    <Field label="Headline" hint={`e.g. "Welcome to the Olive Goose Club!"`}>
      <Input value={data.headline} onChange={(e) => onChange({ ...data, headline: e.target.value })} />
    </Field>
    <Field label="Founder Photo URL" hint="Circular profile photo — paste a direct image URL">
      <Input placeholder="https://…" value={data.photo_url} onChange={(e) => onChange({ ...data, photo_url: e.target.value })} />
    </Field>
    <Field label="Name Line" hint={`e.g. "I'm Meghna, the person behind The Olive Goose."`}>
      <Input value={data.name_line} onChange={(e) => onChange({ ...data, name_line: e.target.value })} />
    </Field>
    <Field label="Bio">
      <Textarea rows={3} value={data.bio} onChange={(e) => onChange({ ...data, bio: e.target.value })} />
    </Field>
    <div className="grid grid-cols-2 gap-4">
      <Field label="Button Text">
        <Input value={data.cta_text} onChange={(e) => onChange({ ...data, cta_text: e.target.value })} />
      </Field>
      <Field label="Button Link">
        <Input value={data.cta_href} onChange={(e) => onChange({ ...data, cta_href: e.target.value })} />
      </Field>
    </div>
    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

const CandleCareEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: CandleCareContent;
  onChange: (d: CandleCareContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Candle Care" desc='The "Love it long. Burn it right." instruction section.' />
    <Field label="Section Label">
      <Input value={data.label} onChange={(e) => onChange({ ...data, label: e.target.value })} />
    </Field>
    <div className="grid grid-cols-2 gap-4">
      <Field label="Headline Part 1 (plain)" hint={`e.g. "Love it long."`}>
        <Input value={data.headline_part1} onChange={(e) => onChange({ ...data, headline_part1: e.target.value })} />
      </Field>
      <Field label="Headline Part 2 (italic / olive)" hint={`e.g. "Burn it right."`}>
        <Input value={data.headline_part2} onChange={(e) => onChange({ ...data, headline_part2: e.target.value })} />
      </Field>
    </div>

    <div className="space-y-4">
      <label className="block text-sm font-sans font-medium text-foreground">Care Cards</label>
      {data.cards.map((card, i) => (
        <Card key={i}>
          <div className="flex items-center justify-between">
            <span className="font-sans text-sm font-medium text-foreground">Card {i + 1}</span>
            <RemoveButton onClick={() => onChange({ ...data, cards: data.cards.filter((_, j) => j !== i) })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Number" hint={`e.g. "01"`}>
              <Input value={card.number} onChange={(e) => {
                const cards = [...data.cards];
                cards[i] = { ...cards[i], number: e.target.value };
                onChange({ ...data, cards });
              }} />
            </Field>
            <div className="col-span-2">
              <Field label="Title">
                <Input value={card.title} onChange={(e) => {
                  const cards = [...data.cards];
                  cards[i] = { ...cards[i], title: e.target.value };
                  onChange({ ...data, cards });
                }} />
              </Field>
            </div>
          </div>
          <Field label="Description">
            <Textarea rows={3} value={card.description} onChange={(e) => {
              const cards = [...data.cards];
              cards[i] = { ...cards[i], description: e.target.value };
              onChange({ ...data, cards });
            }} />
          </Field>
        </Card>
      ))}
      <AddButton
        label="Add card"
        onClick={() => {
          const newCard: CandleCareCard = { number: `0${data.cards.length + 1}`, title: "", description: "" };
          onChange({ ...data, cards: [...data.cards, newCard] });
        }}
      />
    </div>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

const VideosEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: VideosContent;
  onChange: (d: VideosContent) => void;
  onSave: () => void;
  saving: boolean;
}) => {
  return (
    <div className="space-y-6">
      <SectionHeading title="Videos" desc="Paste a video URL for each item — a YouTube, Vimeo, or Instagram link, or a direct .mp4 / .webm URL. The site plays it straight from the URL." />
      <Field label="Section Label">
        <Input value={data.label} onChange={(e) => onChange({ ...data, label: e.target.value })} />
      </Field>
      <Field label="Section Headline">
        <Input value={data.headline} onChange={(e) => onChange({ ...data, headline: e.target.value })} />
      </Field>
      <Field label="Section Subtext">
        <Input value={data.subtext} onChange={(e) => onChange({ ...data, subtext: e.target.value })} />
      </Field>

      <div className="space-y-4">
        <label className="block text-sm font-sans font-medium text-foreground">Videos</label>
        {data.items.map((item, i) => (
          <Card key={item.id}>
            <div className="flex items-center justify-between">
              <span className="font-sans text-sm font-medium text-foreground">Video {i + 1}</span>
              <RemoveButton onClick={() => onChange({ ...data, items: data.items.filter((_, j) => j !== i) })} />
            </div>
            <Field label="Title">
              <Input value={item.title} onChange={(e) => {
                const items = [...data.items];
                items[i] = { ...items[i], title: e.target.value };
                onChange({ ...data, items });
              }} />
            </Field>
            <Field label="Video URL" hint="YouTube, Vimeo, or Instagram link, or a direct .mp4 / .webm URL. Played straight from this URL.">
              <Input
                placeholder="https://youtube.com/watch?v=…  or  https://…/reel.mp4"
                value={item.video_url}
                onChange={(e) => {
                  const items = [...data.items];
                  items[i] = { ...items[i], video_url: e.target.value };
                  onChange({ ...data, items });
                }}
              />
              {item.video_url && (
                <p className="text-xs text-muted-foreground truncate mt-1">✓ {item.video_url}</p>
              )}
            </Field>
          </Card>
        ))}
        <AddButton
          label="Add video"
          onClick={() => {
            const newVideo: VideoItem = { id: Date.now().toString(), title: "", description: "", video_url: "" };
            onChange({ ...data, items: [...data.items, newVideo] });
          }}
        />
      </div>

      <SaveButton onClick={onSave} saving={saving} />
    </div>
  );
};

const TestimonialsEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: TestimonialsContent;
  onChange: (d: TestimonialsContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Testimonials" desc="Customer review cards." />
    <Field label="Section Label">
      <Input value={data.label} onChange={(e) => onChange({ ...data, label: e.target.value })} />
    </Field>
    <Field label="Section Headline">
      <Input value={data.headline} onChange={(e) => onChange({ ...data, headline: e.target.value })} />
    </Field>

    <div className="space-y-4">
      <label className="block text-sm font-sans font-medium text-foreground">Testimonials</label>
      {data.items.map((item, i) => (
        <Card key={item.id}>
          <div className="flex items-center justify-between">
            <span className="font-sans text-sm font-medium text-foreground">Testimonial {i + 1}</span>
            <RemoveButton onClick={() => onChange({ ...data, items: data.items.filter((_, j) => j !== i) })} />
          </div>
          <Field label="Quote">
            <Textarea rows={3} value={item.quote} onChange={(e) => {
              const items = [...data.items];
              items[i] = { ...items[i], quote: e.target.value };
              onChange({ ...data, items });
            }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Author Name">
              <Input value={item.author} onChange={(e) => {
                const items = [...data.items];
                items[i] = { ...items[i], author: e.target.value };
                onChange({ ...data, items });
              }} />
            </Field>
            <Field label="Location">
              <Input value={item.location} onChange={(e) => {
                const items = [...data.items];
                items[i] = { ...items[i], location: e.target.value };
                onChange({ ...data, items });
              }} />
            </Field>
          </div>
          <Field label={`Star Rating: ${item.rating} / 5`}>
            <input
              type="range"
              min={1}
              max={5}
              value={item.rating}
              onChange={(e) => {
                const items = [...data.items];
                items[i] = { ...items[i], rating: Number(e.target.value) };
                onChange({ ...data, items });
              }}
              className="w-full accent-primary"
            />
          </Field>
          <Field label="Avatar Image URL" hint="Optional — paste a photo URL to show a profile picture">
            <Input
              value={item.avatarUrl ?? ""}
              placeholder="https://…"
              onChange={(e) => {
                const items = [...data.items];
                items[i] = { ...items[i], avatarUrl: e.target.value };
                onChange({ ...data, items });
              }}
            />
          </Field>
        </Card>
      ))}
      <AddButton
        label="Add testimonial"
        onClick={() => {
          const newT: Testimonial = { id: Date.now().toString(), quote: "", author: "", location: "", rating: 5 };
          onChange({ ...data, items: [...data.items, newT] });
        }}
      />
    </div>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

const NewsletterEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: NewsletterContent;
  onChange: (d: NewsletterContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Newsletter Section" desc="The olive-green email sign-up banner." />
    <Field label="Section Label">
      <Input value={data.label} onChange={(e) => onChange({ ...data, label: e.target.value })} />
    </Field>
    <Field label="Headline">
      <Input value={data.headline} onChange={(e) => onChange({ ...data, headline: e.target.value })} />
    </Field>
    <Field label="Subtext">
      <Textarea rows={2} value={data.subtext} onChange={(e) => onChange({ ...data, subtext: e.target.value })} />
    </Field>
    <Field label="Input Placeholder">
      <Input value={data.placeholder} onChange={(e) => onChange({ ...data, placeholder: e.target.value })} />
    </Field>
    <Field label="Submit Button Text">
      <Input value={data.cta_text} onChange={(e) => onChange({ ...data, cta_text: e.target.value })} />
    </Field>
    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

const FooterEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: FooterContent;
  onChange: (d: FooterContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Footer" desc="Dark footer with links, social, and copyright." />
    <Field label="Brand Name" hint="Shown next to the logo in the footer">
      <Input value={data.brand_name ?? ""} onChange={(e) => onChange({ ...data, brand_name: e.target.value })} />
    </Field>
    <Field label="Tagline">
      <Input value={data.tagline} onChange={(e) => onChange({ ...data, tagline: e.target.value })} />
    </Field>
    <Field label="Copyright Text">
      <Input value={data.copyright} onChange={(e) => onChange({ ...data, copyright: e.target.value })} />
    </Field>

    <div className="space-y-2">
      <label className="block text-sm font-sans font-medium text-foreground">Footer Links</label>
      {(data.links ?? []).map((link, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            placeholder="Label"
            value={link.label}
            onChange={(e) => {
              const links = [...(data.links ?? [])];
              links[i] = { ...links[i], label: e.target.value };
              onChange({ ...data, links });
            }}
          />
          <Input
            placeholder="Href"
            value={link.href}
            onChange={(e) => {
              const links = [...(data.links ?? [])];
              links[i] = { ...links[i], href: e.target.value };
              onChange({ ...data, links });
            }}
          />
          <RemoveButton onClick={() => onChange({ ...data, links: (data.links ?? []).filter((_, j) => j !== i) })} />
        </div>
      ))}
      <AddButton
        label="Add link"
        onClick={() => onChange({ ...data, links: [...(data.links ?? []), { label: "", href: "#" }] })}
      />
    </div>

    <div className="space-y-2">
      <label className="block text-sm font-sans font-medium text-foreground">Social Links</label>
      {(data.social_links ?? []).map((social, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            placeholder="Platform name"
            value={social.platform}
            onChange={(e) => {
              const social_links = [...(data.social_links ?? [])];
              social_links[i] = { ...social_links[i], platform: e.target.value };
              onChange({ ...data, social_links });
            }}
          />
          <Input
            placeholder="URL"
            value={social.href}
            onChange={(e) => {
              const social_links = [...(data.social_links ?? [])];
              social_links[i] = { ...social_links[i], href: e.target.value };
              onChange({ ...data, social_links });
            }}
          />
          <RemoveButton onClick={() => onChange({ ...data, social_links: (data.social_links ?? []).filter((_, j) => j !== i) })} />
        </div>
      ))}
      <AddButton
        label="Add social"
        onClick={() => onChange({ ...data, social_links: [...(data.social_links ?? []), { platform: "", href: "#" }] })}
      />
    </div>

    <div className="space-y-2">
      <label className="block text-sm font-sans font-medium text-foreground">Policy Links</label>
      <p className="text-xs text-muted-foreground font-sans">Links shown in the bottom copyright bar (Privacy policy, Terms of service, etc.)</p>
      {(data.policy_links ?? []).map((link, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            placeholder="Label"
            value={link.label}
            onChange={(e) => {
              const policy_links = [...(data.policy_links ?? [])];
              policy_links[i] = { ...policy_links[i], label: e.target.value };
              onChange({ ...data, policy_links });
            }}
          />
          <Input
            placeholder="Href"
            value={link.href}
            onChange={(e) => {
              const policy_links = [...(data.policy_links ?? [])];
              policy_links[i] = { ...policy_links[i], href: e.target.value };
              onChange({ ...data, policy_links });
            }}
          />
          <RemoveButton onClick={() => onChange({ ...data, policy_links: (data.policy_links ?? []).filter((_, j) => j !== i) })} />
        </div>
      ))}
      <AddButton
        label="Add policy link"
        onClick={() => onChange({ ...data, policy_links: [...(data.policy_links ?? []), { label: "", href: "#" }] })}
      />
    </div>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

// ── Return Policy editor ───────────────────────────────────────────────────────

const ReturnPolicyEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: ReturnPolicyContent;
  onChange: (d: ReturnPolicyContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Return Policy" desc="Content shown on the Returns & Refunds page, plus the return-request form." />
    <Field label="Heading">
      <Input value={data.heading} onChange={(e) => onChange({ ...data, heading: e.target.value })} />
    </Field>
    <Field label="Intro">
      <Textarea rows={2} value={data.intro} onChange={(e) => onChange({ ...data, intro: e.target.value })} />
    </Field>
    <Field label="Contact Email">
      <Input value={data.contact_email} onChange={(e) => onChange({ ...data, contact_email: e.target.value })} />
    </Field>

    <div className="space-y-4">
      <label className="block text-sm font-sans font-medium text-foreground">Policy Sections</label>
      {data.sections.map((section, i) => (
        <Card key={i}>
          <div className="flex items-center justify-between">
            <span className="font-sans text-sm font-medium text-foreground">Section {i + 1}</span>
            <RemoveButton onClick={() => onChange({ ...data, sections: data.sections.filter((_, j) => j !== i) })} />
          </div>
          <Field label="Title">
            <Input value={section.title} onChange={(e) => {
              const sections = [...data.sections];
              sections[i] = { ...sections[i], title: e.target.value };
              onChange({ ...data, sections });
            }} />
          </Field>
          <Field label="Body">
            <Textarea rows={3} value={section.body} onChange={(e) => {
              const sections = [...data.sections];
              sections[i] = { ...sections[i], body: e.target.value };
              onChange({ ...data, sections });
            }} />
          </Field>
        </Card>
      ))}
      <AddButton
        label="Add section"
        onClick={() => onChange({ ...data, sections: [...data.sections, { title: "", body: "" }] })}
      />
    </div>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

// ── Legal page editor (Privacy Policy / Terms of Service / Shipping Policy) ──────
// All three share the same heading + intro + sections + contact email shape.

const LegalPageEditor = ({
  title,
  desc,
  data,
  onChange,
  onSave,
  saving,
}: {
  title: string;
  desc: string;
  data: LegalPageContent;
  onChange: (d: LegalPageContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title={title} desc={desc} />
    <Field label="Heading">
      <Input value={data.heading} onChange={(e) => onChange({ ...data, heading: e.target.value })} />
    </Field>
    <Field label="Intro">
      <Textarea rows={2} value={data.intro} onChange={(e) => onChange({ ...data, intro: e.target.value })} />
    </Field>
    <Field label="Contact Email">
      <Input value={data.contact_email} onChange={(e) => onChange({ ...data, contact_email: e.target.value })} />
    </Field>

    <div className="space-y-4">
      <label className="block text-sm font-sans font-medium text-foreground">Sections</label>
      {data.sections.map((section, i) => (
        <Card key={i}>
          <div className="flex items-center justify-between">
            <span className="font-sans text-sm font-medium text-foreground">Section {i + 1}</span>
            <RemoveButton onClick={() => onChange({ ...data, sections: data.sections.filter((_, j) => j !== i) })} />
          </div>
          <Field label="Title">
            <Input value={section.title} onChange={(e) => {
              const sections = [...data.sections];
              sections[i] = { ...sections[i], title: e.target.value };
              onChange({ ...data, sections });
            }} />
          </Field>
          <Field label="Body">
            <Textarea rows={3} value={section.body} onChange={(e) => {
              const sections = [...data.sections];
              sections[i] = { ...sections[i], body: e.target.value };
              onChange({ ...data, sections });
            }} />
          </Field>
        </Card>
      ))}
      <AddButton
        label="Add section"
        onClick={() => onChange({ ...data, sections: [...data.sections, { title: "", body: "" }] })}
      />
    </div>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

// ── Gift Cards editor ───────────────────────────────────────────────────────────

const GiftCardsEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: GiftCardsContent;
  onChange: (d: GiftCardsContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Gift Cards" desc="Content shown on the Gift Cards page." />
    <Field label="Heading">
      <Input value={data.heading} onChange={(e) => onChange({ ...data, heading: e.target.value })} />
    </Field>
    <Field label="Intro">
      <Textarea rows={2} value={data.intro} onChange={(e) => onChange({ ...data, intro: e.target.value })} />
    </Field>

    <div className="space-y-2">
      <label className="block text-sm font-sans font-medium text-foreground">Denominations</label>
      {data.denominations.map((d, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input value={d} onChange={(e) => {
            const denominations = [...data.denominations];
            denominations[i] = e.target.value;
            onChange({ ...data, denominations });
          }} />
          <RemoveButton onClick={() => onChange({ ...data, denominations: data.denominations.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <AddButton label="Add denomination" onClick={() => onChange({ ...data, denominations: [...data.denominations, ""] })} />
    </div>

    <Field label="Note" hint="Small print shown under the denominations">
      <Input value={data.note} onChange={(e) => onChange({ ...data, note: e.target.value })} />
    </Field>
    <Field label="CTA Button Text" hint={`Shown when gift cards aren't available yet, e.g. "Notify Me When Available"`}>
      <Input value={data.cta_text} onChange={(e) => onChange({ ...data, cta_text: e.target.value })} />
    </Field>

    <label className="flex items-center gap-2">
      <input type="checkbox" checked={data.available} onChange={(e) => onChange({ ...data, available: e.target.checked })} className="accent-primary" />
      <span className="text-sm font-sans text-foreground">Gift cards are available for purchase</span>
    </label>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

// ── Customer Service editor ─────────────────────────────────────────────────────

const CustomerServiceEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: CustomerServiceContent;
  onChange: (d: CustomerServiceContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Customer Service" desc="Content shown on the Customer Service page, including FAQs." />
    <Field label="Heading">
      <Input value={data.heading} onChange={(e) => onChange({ ...data, heading: e.target.value })} />
    </Field>
    <Field label="Intro">
      <Textarea rows={2} value={data.intro} onChange={(e) => onChange({ ...data, intro: e.target.value })} />
    </Field>
    <div className="grid grid-cols-2 gap-4">
      <Field label="Contact Email">
        <Input value={data.contact_email} onChange={(e) => onChange({ ...data, contact_email: e.target.value })} />
      </Field>
      <Field label="Contact Phone" hint="Optional">
        <Input value={data.contact_phone} onChange={(e) => onChange({ ...data, contact_phone: e.target.value })} />
      </Field>
    </div>

    <div className="space-y-4">
      <label className="block text-sm font-sans font-medium text-foreground">FAQs</label>
      {data.faqs.map((faq, i) => (
        <Card key={i}>
          <div className="flex items-center justify-between">
            <span className="font-sans text-sm font-medium text-foreground">FAQ {i + 1}</span>
            <RemoveButton onClick={() => onChange({ ...data, faqs: data.faqs.filter((_, j) => j !== i) })} />
          </div>
          <Field label="Question">
            <Input value={faq.question} onChange={(e) => {
              const faqs = [...data.faqs];
              faqs[i] = { ...faqs[i], question: e.target.value };
              onChange({ ...data, faqs });
            }} />
          </Field>
          <Field label="Answer">
            <Textarea rows={2} value={faq.answer} onChange={(e) => {
              const faqs = [...data.faqs];
              faqs[i] = { ...faqs[i], answer: e.target.value };
              onChange({ ...data, faqs });
            }} />
          </Field>
        </Card>
      ))}
      <AddButton label="Add FAQ" onClick={() => onChange({ ...data, faqs: [...data.faqs, { question: "", answer: "" }] })} />
    </div>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

// ── Pickup & Delivery editor ─────────────────────────────────────────────────────

const PickupSettingsEditor = ({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: PickupSettingsContent;
  onChange: (d: PickupSettingsContent) => void;
  onSave: () => void;
  saving: boolean;
}) => (
  <div className="space-y-6">
    <SectionHeading title="Pickup & Delivery" desc="Controls the in-store pickup option shown at checkout, including its discount." />

    <label className="flex items-center gap-2">
      <input type="checkbox" checked={data.enabled} onChange={(e) => onChange({ ...data, enabled: e.target.checked })} className="accent-primary" />
      <span className="text-sm font-sans text-foreground">Offer in-store pickup at checkout</span>
    </label>

    <Field label="Location Name">
      <Input value={data.location_name} onChange={(e) => onChange({ ...data, location_name: e.target.value })} />
    </Field>
    <Field label="Address">
      <Input value={data.address_line1} onChange={(e) => onChange({ ...data, address_line1: e.target.value })} />
    </Field>
    <div className="grid grid-cols-3 gap-4">
      <Field label="City / Area">
        <Input value={data.city} onChange={(e) => onChange({ ...data, city: e.target.value })} />
      </Field>
      <Field label="Eircode">
        <Input value={data.eircode} onChange={(e) => onChange({ ...data, eircode: e.target.value })} />
      </Field>
      <Field label="Country">
        <Input value={data.country} onChange={(e) => onChange({ ...data, country: e.target.value })} />
      </Field>
    </div>
    <Field label="Pickup Hours">
      <Input value={data.hours} onChange={(e) => onChange({ ...data, hours: e.target.value })} placeholder="e.g. Tue–Sat, 10am–5pm" />
    </Field>
    <Field label={`Pickup Discount: ${data.discount_percent}%`} hint="Applied to the order subtotal when a customer chooses in-store pickup instead of delivery">
      <input
        type="range" min={0} max={50} step={1}
        value={data.discount_percent}
        onChange={(e) => onChange({ ...data, discount_percent: Number(e.target.value) })}
        className="w-full accent-primary"
      />
    </Field>
    <Field label="Pickup Notes" hint="Shown to customers after they choose pickup at checkout">
      <Textarea rows={2} value={data.notes} onChange={(e) => onChange({ ...data, notes: e.target.value })} />
    </Field>

    <div className="pt-2 border-t border-border">
      <h3 className="font-serif text-lg text-foreground mt-6 mb-4">Shipping</h3>
      <Field label="Flat Shipping Rate (€)" hint="Charged on delivery orders below the free-shipping threshold. This is the actual amount added to the order total at checkout.">
        <Input
          type="number" min={0} step={0.01}
          value={data.flat_shipping_rate}
          onChange={(e) => onChange({ ...data, flat_shipping_rate: Number(e.target.value) })}
        />
      </Field>
      <Field label="Free Shipping Threshold (€)" hint="Orders at or above this subtotal ship free. Shown on the basket, checkout, and cart with a progress bar.">
        <Input
          type="number" min={0} step={1}
          value={data.free_shipping_threshold}
          onChange={(e) => onChange({ ...data, free_shipping_threshold: Number(e.target.value) })}
        />
      </Field>
    </div>

    <SaveButton onClick={onSave} saving={saving} />
  </div>
);

// ── Order detail: cancellation decisions, refund tracking, messaging, timeline ──
// The human-in-the-loop step: automated events populate the timeline below, but
// cancellations, refunds, and outbound messages all require an explicit admin
// click here before anything happens.

const EVENT_ICON: Record<string, string> = {
  order_placed: "🧾", status_changed: "📦", cancellation_requested: "⚠️",
  cancellation_approved: "✅", cancellation_rejected: "🚫", return_requested: "↩",
  return_status_changed: "↩", message: "✉", refund_completed: "💳",
  payment_status_changed: "💶",
};

const OrderDetailPanel = ({ order, onUpdate }: { order: AdminOrderRecord; onUpdate: (o: AdminOrderRecord) => void }) => {
  const [detail, setDetail] = useState<(AdminOrderRecord & { timeline: OrderTimelineEvent[]; refund_reminders: RefundReminder[] }) | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decisionNote, setDecisionNote] = useState("");
  const [markingRefund, setMarkingRefund] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [refundAutomationEnabled, setRefundAutomationEnabled] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => {
    getAdminOrderDetail(order.id).then(setDetail);
  }, [order.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getAutomationSettings().then(s => setRefundAutomationEnabled(s.refund_automation_enabled)); }, []);

  const handleDecision = async (decision: "approved" | "rejected") => {
    setDeciding(true);
    try {
      const updated = await decideCancellation(order.id, decision, decisionNote.trim());
      onUpdate(updated);
      setDecisionNote("");
      load();
      toast({ title: decision === "approved" ? "Cancellation approved" : "Cancellation rejected" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Could not record decision", variant: "destructive" });
    } finally {
      setDeciding(false);
    }
  };

  const handleMarkRefund = async () => {
    setMarkingRefund(true);
    try {
      const { via_stripe } = await markRefundDone(order.id);
      onUpdate({ ...order, refund_status: "refunded" });
      load();
      toast({ title: via_stripe ? "Refund processed via Stripe" : "Refund marked as completed" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Could not update refund status", variant: "destructive" });
    } finally {
      setMarkingRefund(false);
    }
  };

  const handleSetPaymentStatus = async (paymentStatus: "paid" | "unpaid") => {
    setMarkingPaid(true);
    try {
      const updated = await updateOrderPaymentStatus(order.id, paymentStatus);
      onUpdate(updated);
      load();
      toast({ title: paymentStatus === "paid" ? "Order marked as paid" : "Order marked as unpaid" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Could not update payment status", variant: "destructive" });
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleSendMessage = async () => {
    if (!msgSubject.trim() || !msgBody.trim()) return;
    setSendingMsg(true);
    try {
      await sendOrderMessage(order.id, msgSubject.trim(), msgBody.trim());
      setMsgSubject("");
      setMsgBody("");
      load();
      toast({ title: "Message sent to customer" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Could not send message", variant: "destructive" });
    } finally {
      setSendingMsg(false);
    }
  };

  // Most recent event of a given type, so a resolved action shows *when* the
  // customer was told instead of the banner just silently disappearing.
  const lastEventOf = (types: string[]) => detail ? [...detail.timeline].reverse().find(e => types.includes(e.type)) : undefined;
  const cancellationEvent = lastEventOf(["cancellation_approved", "cancellation_rejected"]);
  const refundEvent = lastEventOf(["refund_completed"]);
  const lastMessage = lastEventOf(["message"]);
  const paymentEvent = lastEventOf(["payment_status_changed"]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {order.items.map(item => (
          <div key={item.product_id} className="flex items-center justify-between font-sans text-xs text-muted-foreground">
            <span>{(item.product_data?.name as string) || item.product_id} × {item.quantity}</span>
            <span>{(item.product_data?.price as string) || ""}</span>
          </div>
        ))}
        <p className="font-sans text-xs text-muted-foreground pt-1">
          {order.fulfillment_type === "pickup" ? "Pickup" : "Shipping"} address:{" "}
          {[order.shipping_address?.address_line1, order.shipping_address?.city, order.shipping_address?.country]
            .filter(Boolean).join(", ") || "—"}
        </p>
      </div>

      {order.payment_status !== "paid" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-center justify-between gap-3">
          <p className="font-sans text-xs text-amber-800">
            Unpaid — €{Number(order.total).toFixed(2)} outstanding.
            {order.fulfillment_type === "pickup"
              ? " If the customer paid in store (cash/card), mark it as paid so it counts toward revenue."
              : " Mark it as paid once payment is settled outside Stripe."}
          </p>
          <button onClick={() => handleSetPaymentStatus("paid")} disabled={markingPaid}
            className="font-sans text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 shrink-0">
            {markingPaid ? "Saving…" : "Mark as paid"}
          </button>
        </div>
      )}
      {order.payment_status === "paid" && !order.stripe_payment_intent_id && paymentEvent && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 flex items-center justify-between gap-3">
          <p className="font-sans text-xs text-muted-foreground">
            ✅ Marked paid by admin {new Date(paymentEvent.created_at).toLocaleString()} (settled outside Stripe)
          </p>
          <button onClick={() => handleSetPaymentStatus("unpaid")} disabled={markingPaid}
            className="font-sans text-xs font-medium px-2.5 py-1 rounded-lg border border-border hover:bg-muted disabled:opacity-50 shrink-0">
            {markingPaid ? "Saving…" : "Undo"}
          </button>
        </div>
      )}

      {order.cancellation_status === "requested" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <p className="font-sans text-xs font-semibold text-amber-800">Cancellation requested — needs a decision</p>
          {order.cancellation_reason && <p className="font-sans text-xs text-amber-700">"{order.cancellation_reason}"</p>}
          <Input placeholder="Optional note to include in the customer email…" value={decisionNote} onChange={e => setDecisionNote(e.target.value)} className="text-xs !py-1.5" />
          <div className="flex gap-2">
            <button onClick={() => handleDecision("approved")} disabled={deciding}
              className="font-sans text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
              Approve cancellation
            </button>
            <button onClick={() => handleDecision("rejected")} disabled={deciding}
              className="font-sans text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50">
              Reject
            </button>
          </div>
        </div>
      )}

      {order.cancellation_status !== "none" && order.cancellation_status !== "requested" && cancellationEvent && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="font-sans text-xs text-muted-foreground">
            ✅ Cancellation {order.cancellation_status} — customer notified {new Date(cancellationEvent.created_at).toLocaleString()}
          </p>
        </div>
      )}

      {order.refund_status === "pending" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 flex items-center justify-between gap-3">
          <p className="font-sans text-xs text-red-800">
            {refundAutomationEnabled
              ? `Refund still owed — clicking will charge Stripe for €${Number(order.total).toFixed(2)}.`
              : "Refund still owed — process it manually (Stripe/bank), then mark it done here."}
          </p>
          <button onClick={handleMarkRefund} disabled={markingRefund}
            className="font-sans text-xs font-medium px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 shrink-0">
            {markingRefund ? "Saving…" : refundAutomationEnabled ? `Refund via Stripe (€${Number(order.total).toFixed(2)})` : "Mark refund done"}
          </button>
        </div>
      )}
      {order.refund_status === "refunded" && refundEvent && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="font-sans text-xs text-muted-foreground">
            ✅ Refund completed — customer notified {new Date(refundEvent.created_at).toLocaleString()}
          </p>
        </div>
      )}

      {/* Return-based refunds live on the return, not the order's refund_status —
          surface them here so the row's "Refund owed (return)" badge and this
          panel never disagree. They're resolved from the Returns tab. */}
      {detail && detail.refund_reminders.some(r => r.source === "return" && !r.resolved_at) && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="font-sans text-xs text-red-800">
            Refund owed for an approved <strong>return</strong> on this order
            {(() => { const r = detail.refund_reminders.find(x => x.source === "return" && !x.resolved_at)!;
              const days = Math.floor((Date.now() - new Date(r.eligible_at).getTime()) / 86400000);
              return days > 0 ? ` — ${days}d since approved` : ""; })()}
            . Mark the return as <em>refunded</em> in the <strong>Returns</strong> tab to resolve it.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border p-3 space-y-2">
        <p className="font-sans text-xs font-semibold text-foreground">Message customer</p>
        {lastMessage && (
          <p className="font-sans text-xs text-muted-foreground">
            Last sent: "{lastMessage.title}" — {new Date(lastMessage.created_at).toLocaleString()}
          </p>
        )}
        <Input placeholder="Subject" value={msgSubject} onChange={e => setMsgSubject(e.target.value)} className="text-xs !py-1.5" />
        <Textarea rows={3} placeholder="Message…" value={msgBody} onChange={e => setMsgBody(e.target.value)} className="text-xs" />
        <button onClick={handleSendMessage} disabled={sendingMsg || !msgSubject.trim() || !msgBody.trim()}
          className="font-sans text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-olive-light disabled:opacity-50">
          {sendingMsg ? "Sending…" : "Send email"}
        </button>
      </div>

      {detail && detail.timeline.length > 0 && (
        <div className="rounded-lg border border-border p-3 space-y-1.5">
          <p className="font-sans text-xs font-semibold text-foreground mb-1">Timeline</p>
          {[...detail.timeline].reverse().map(ev => (
            <div key={ev.id} className="font-sans text-xs text-muted-foreground flex items-start justify-between gap-3">
              <span>{EVENT_ICON[ev.type] || "•"} {ev.title}{ev.detail ? ` — ${ev.detail}` : ""} {!ev.customer_visible && <em>(internal)</em>}</span>
              <span className="shrink-0">{new Date(ev.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Orders panel ───────────────────────────────────────────────────────────────
// One unified, interactive table for every order — search, filter, sort, and an
// optional group-by-customer view. Tracking status is admin-controlled here; it
// never advances on its own server-side.

const PaymentBadge = ({ status }: { status: string }) => (
  <span className={`font-sans text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap capitalize ${
    status === "paid" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
  }`}>
    {status === "paid" ? "Paid" : status}
  </span>
);

// A refund can be owed two ways: a cancellation sets the order's own
// refund_status='pending', while a return-based refund lives in refund_reminders
// (order.refund_status stays 'not_applicable'). RefundInfo unifies both so the
// Orders table never hides an outstanding refund.
type RefundKind = "none" | "owed" | "refunded";
type RefundInfo = { kind: RefundKind; days?: number; source?: "return" | "cancellation" };

const RefundCell = ({ info }: { info: RefundInfo }) => {
  if (info.kind === "owed") return (
    <span
      className="font-sans text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap"
      title={info.source ? `Refund owed via ${info.source}${info.days != null ? ` — ${info.days}d elapsed` : ""}` : undefined}
    >
      Owed{info.days != null && info.days > 0 ? ` · ${info.days}d` : ""}
    </span>
  );
  if (info.kind === "refunded") return <span className="font-sans text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">Refunded</span>;
  return <span className="font-sans text-xs text-muted-foreground/50">—</span>;
};

// Compact KPI tile for the row of summary stats above the table.
const StatTile = ({ label, value, tone = "default", onClick, active }: {
  label: string; value: string | number; tone?: "default" | "red" | "amber" | "green"; onClick?: () => void; active?: boolean;
}) => {
  const toneCls = {
    default: "text-foreground",
    red: "text-red-600",
    amber: "text-amber-600",
    green: "text-green-600",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`text-left rounded-xl border p-4 transition-colors ${
        active ? "border-primary bg-primary/5" : "border-border bg-card"
      } ${onClick ? "hover:border-primary/50 cursor-pointer" : "cursor-default"}`}
    >
      <p className={`font-serif text-2xl leading-none ${toneCls}`}>{value}</p>
      <p className="font-sans text-xs text-muted-foreground mt-1.5">{label}</p>
    </button>
  );
};

type OrderSortKey = "date" | "total" | "order" | "payment";
type AttentionFilter = "all" | "attention" | "unpaid" | "refund" | "cancellation";

const ALL_ORDER_STAGES = Array.from(new Set([...ORDER_STAGES.delivery, ...ORDER_STAGES.pickup]));

const OrdersPanel = () => {
  const [items, setItems] = useState<AdminOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "delivery" | "pickup">("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [attention, setAttention] = useState<AttentionFilter>("all");
  const [sortKey, setSortKey] = useState<OrderSortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [groupByCustomer, setGroupByCustomer] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [refundsDue, setRefundsDue] = useState<OpsOverview["refunds_due"]>([]);
  const { toast } = useToast();

  const load = useCallback((showSpinner = true) => {
    if (showSpinner) setLoading(true);
    // Refund reminders (returns + cancellations) come from the ops overview —
    // an order can owe a refund without its own refund_status being 'pending'.
    getOpsOverview().then(o => setRefundsDue(o.refunds_due)).catch(() => {});
    return getAdminOrders().then(o => setItems(o)).finally(() => setLoading(false));
  }, []);

  // order_id → outstanding refund reminder (keep the oldest / most-elapsed one).
  const refundOwedByOrder = useMemo(() => {
    const m = new Map<string, { days: number; source: "return" | "cancellation" }>();
    for (const r of refundsDue) {
      const prev = m.get(r.order_id);
      if (!prev || r.days_elapsed > prev.days) m.set(r.order_id, { days: r.days_elapsed, source: r.source });
    }
    return m;
  }, [refundsDue]);

  // Unified refund state for a row. The order's own refund_status is
  // authoritative — it's what changes when the admin acts *in this tab* (marks a
  // refund done, approves a cancellation). The ops-overview reminder only
  // *supplements* it, surfacing return-based refunds the order's refund_status
  // never records. So a resolved order-level state always wins over a snapshot
  // reminder that may not have been re-polled yet.
  const refundInfo = useCallback((o: AdminOrderRecord): RefundInfo => {
    if (o.refund_status === "refunded") return { kind: "refunded" };
    const reminder = refundOwedByOrder.get(o.id);
    if (o.refund_status === "pending") return { kind: "owed", source: "cancellation", days: reminder?.days };
    if (reminder) return { kind: "owed", source: reminder.source, days: reminder.days };
    return { kind: "none" };
  }, [refundOwedByOrder]);

  useEffect(() => {
    load();
    // New orders come from customers placing them elsewhere — poll so they
    // show up here without the admin needing to leave and reopen this tab.
    const interval = setInterval(() => load(false), 15000);
    return () => clearInterval(interval);
  }, [load]);

  const currency = (n: string | number) => `€${Number(n).toFixed(2)}`;
  const unitCount = (o: AdminOrderRecord) => o.items.reduce((n, i) => n + i.quantity, 0);
  const itemSummary = (o: AdminOrderRecord) =>
    o.items.map(i => `${(i.product_data?.name as string) || i.product_id} ×${i.quantity}`).join(", ");

  const handleStatusChange = async (order: AdminOrderRecord, status: string) => {
    setSavingId(order.id);
    try {
      const updated = await updateOrderStatus(order.id, status);
      // The PUT response omits the last-notification join fields, and changing
      // status sends the customer a fresh notification — merge (so we don't blank
      // out fields the response doesn't carry) then reconcile from the server so
      // "Last notified" reflects the new email instead of going stale.
      setItems(prev => prev.map(o => o.id === order.id ? { ...o, ...updated } : o));
      toast({ title: "Tracking updated" });
      load(false);
    } catch {
      toast({ title: "Could not update tracking", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  // Detail-panel actions (mark refund done, approve/reject a cancellation) mutate
  // order-level state — patch it in immediately, then resync the refund-reminder
  // snapshot so a resolved/created reminder doesn't lag behind the action.
  const handleOrderUpdate = useCallback((updated: AdminOrderRecord) => {
    setItems(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x));
    getOpsOverview().then(o => setRefundsDue(o.refunds_due)).catch(() => {});
  }, []);

  // ── Summary stats (over all orders, not the current filter) ──────────────────
  const stats = useMemo(() => {
    let revenue = 0, unpaid = 0, refundsOwed = 0, cancellations = 0;
    const customerIds = new Set<string>();
    for (const o of items) {
      customerIds.add(o.user_id);
      if (o.payment_status === "paid") revenue += Number(o.total); else unpaid += 1;
      if (refundInfo(o).kind === "owed") refundsOwed += 1;
      if (o.cancellation_status === "requested") cancellations += 1;
    }
    return { revenue, unpaid, refundsOwed, cancellations, customers: customerIds.size };
  }, [items, refundInfo]);

  // ── Filter + sort ────────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = items.filter(o => {
      if (typeFilter !== "all" && o.fulfillment_type !== typeFilter) return false;
      if (paymentFilter === "paid" && o.payment_status !== "paid") return false;
      if (paymentFilter === "unpaid" && o.payment_status === "paid") return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      const owed = refundInfo(o).kind === "owed";
      if (attention === "attention" && !(o.cancellation_status === "requested" || owed)) return false;
      if (attention === "refund" && !owed) return false;
      if (attention === "cancellation" && o.cancellation_status !== "requested") return false;
      if (attention === "unpaid" && o.payment_status === "paid") return false;
      if (q) {
        const hay = [o.tracking_number, o.user_name, o.user_email, o.status, itemSummary(o)].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (sortKey === "total") cmp = Number(a.total) - Number(b.total);
      else if (sortKey === "order") cmp = a.tracking_number.localeCompare(b.tracking_number);
      else if (sortKey === "payment") cmp = a.payment_status.localeCompare(b.payment_status);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [items, search, typeFilter, paymentFilter, statusFilter, attention, sortKey, sortDir, refundInfo]);

  const groups = useMemo(() => {
    const byUser = new Map<string, { user_id: string; name: string; email: string; orders: AdminOrderRecord[] }>();
    for (const o of visible) {
      if (!byUser.has(o.user_id)) byUser.set(o.user_id, { user_id: o.user_id, name: o.user_name || o.user_email, email: o.user_email, orders: [] });
      byUser.get(o.user_id)!.orders.push(o);
    }
    return Array.from(byUser.values());
  }, [visible]);

  const toggleSort = (k: OrderSortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "date" || k === "total" ? "desc" : "asc"); }
  };

  const toggleCollapse = (userId: string) =>
    setCollapsed(prev => { const next = new Set(prev); if (next.has(userId)) next.delete(userId); else next.add(userId); return next; });

  const exportCSV = () => {
    const header = ["Order", "Date", "Customer", "Email", "Type", "Units", "Total", "Discount %", "Payment", "Tracking", "Refund", "Cancellation"];
    const rows = visible.map(o => {
      const info = refundInfo(o);
      const refundText = info.kind === "owed" ? `owed${info.source ? ` (${info.source})` : ""}` : info.kind;
      return [
        o.tracking_number, new Date(o.created_at).toISOString(), o.user_name || "", o.user_email,
        o.fulfillment_type, unitCount(o), Number(o.total).toFixed(2), o.discount_percent || "0",
        o.payment_status, o.status, refundText, o.cancellation_status,
      ];
    });
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `olive-goose-orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const colCount = groupByCustomer ? 9 : 10;
  const selectCls = "px-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40";
  const chipCls = (active: boolean) => `font-sans text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
  }`;

  const SortTh = ({ label, k, className = "" }: { label: string; k: OrderSortKey; className?: string }) => (
    <th className={`px-4 py-2.5 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider ${className}`}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors uppercase">
        {label}
        <span className={`text-[9px] ${sortKey === k ? "text-primary" : "text-muted-foreground/40"}`}>{sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "▲▼"}</span>
      </button>
    </th>
  );

  const renderRow = (o: AdminOrderRecord, showCustomer: boolean) => {
    const rinfo = refundInfo(o);
    return (
    <Fragment key={o.id}>
      <tr className="border-t border-border hover:bg-muted/20 transition-colors align-top">
        <td className="px-4 py-3 font-sans font-medium text-foreground whitespace-nowrap">
          {o.tracking_number}
          {(o.cancellation_status === "requested" || rinfo.kind === "owed") && (
            <div className="flex flex-col gap-1 mt-1">
              {o.cancellation_status === "requested" && (
                <span className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 w-fit">Cancellation pending</span>
              )}
              {rinfo.kind === "owed" && (
                <span className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 w-fit">
                  Refund owed{rinfo.source === "return" ? " (return)" : ""}
                </span>
              )}
            </div>
          )}
        </td>
        {showCustomer && (
          <td className="px-4 py-3">
            <div className="font-sans text-sm text-foreground whitespace-nowrap">{o.user_name || "—"}</div>
            <div className="font-sans text-xs text-muted-foreground">{o.user_email}</div>
          </td>
        )}
        <td className="px-4 py-3 font-sans text-muted-foreground whitespace-nowrap">{new Date(o.created_at).toLocaleDateString()}</td>
        <td className="px-4 py-3 font-sans capitalize text-muted-foreground">{o.fulfillment_type}</td>
        <td className="px-4 py-3 font-sans text-muted-foreground whitespace-nowrap" title={itemSummary(o)}>
          {unitCount(o)} item{unitCount(o) !== 1 ? "s" : ""}
        </td>
        <td className="px-4 py-3 font-sans text-foreground whitespace-nowrap">
          {currency(o.total)}
          {Number(o.discount_percent) > 0 && <span className="text-muted-foreground text-xs"> ({o.discount_percent}% off)</span>}
        </td>
        <td className="px-4 py-3 whitespace-nowrap"><PaymentBadge status={o.payment_status} /></td>
        <td className="px-4 py-3 whitespace-nowrap"><RefundCell info={rinfo} /></td>
        <td className="px-4 py-3">
          <select
            value={o.status}
            disabled={savingId === o.id}
            onChange={e => handleStatusChange(o, e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          >
            {ORDER_STAGES[o.fulfillment_type].map(stage => <option key={stage} value={stage}>{stage}</option>)}
          </select>
          <LastNotified title={o.last_notification_title} at={o.last_notification_at} />
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <button onClick={() => setExpandedId(p => p === o.id ? null : o.id)} className="font-sans text-xs text-primary hover:underline">
            {expandedId === o.id ? "Hide" : "Details"}
          </button>
        </td>
      </tr>
      {expandedId === o.id && (
        <tr className="border-t border-border bg-muted/10">
          <td colSpan={colCount} className="px-4 py-4">
            <OrderDetailPanel order={o} onUpdate={handleOrderUpdate} />
          </td>
        </tr>
      )}
    </Fragment>
  );
  };

  const hasFilters = search.trim() !== "" || typeFilter !== "all" || paymentFilter !== "all" || statusFilter !== "all" || attention !== "all";
  const clearFilters = () => { setSearch(""); setTypeFilter("all"); setPaymentFilter("all"); setStatusFilter("all"); setAttention("all"); };

  return (
    <div className="space-y-6">
      <SectionHeading title="Orders" desc="Every order in one place. Search, filter, and sort — then open a row to update tracking, handle cancellations, refunds, and message the customer." />

      {/* Summary — clickable tiles double as quick filters */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Total orders" value={items.length} onClick={() => setAttention("all")} active={attention === "all"} />
        <StatTile label="Customers" value={stats.customers} />
        <StatTile label="Paid revenue" value={currency(stats.revenue)} tone="green" />
        <StatTile label="Unpaid" value={stats.unpaid} tone="amber" onClick={() => setAttention("unpaid")} active={attention === "unpaid"} />
        <StatTile label="Refunds owed" value={stats.refundsOwed} tone="red" onClick={() => setAttention("refund")} active={attention === "refund"} />
        <StatTile label="Cancellations" value={stats.cancellations} tone="amber" onClick={() => setAttention("cancellation")} active={attention === "cancellation"} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">⌕</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search order #, customer, email, product…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)} className={selectCls}>
          <option value="all">All types</option>
          <option value="delivery">Delivery</option>
          <option value="pickup">Pickup</option>
        </select>
        <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value as typeof paymentFilter)} className={selectCls}>
          <option value="all">Any payment</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="all">Any status</option>
          {ALL_ORDER_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-2 font-sans text-xs text-muted-foreground px-2 cursor-pointer select-none">
          <input type="checkbox" checked={groupByCustomer} onChange={e => setGroupByCustomer(e.target.checked)} className="accent-primary" />
          Group by customer
        </label>
        <button onClick={exportCSV} className="font-sans text-xs font-medium px-3 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">Export CSV</button>
        <button onClick={() => load()} className="font-sans text-xs font-medium px-3 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">Refresh</button>
      </div>

      {/* Quick attention chips */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setAttention("all")} className={chipCls(attention === "all")}>All</button>
        <button onClick={() => setAttention("attention")} className={chipCls(attention === "attention")}>Needs attention</button>
        <button onClick={() => setAttention("unpaid")} className={chipCls(attention === "unpaid")}>Unpaid</button>
        <button onClick={() => setAttention("refund")} className={chipCls(attention === "refund")}>Refund owed</button>
        <button onClick={() => setAttention("cancellation")} className={chipCls(attention === "cancellation")}>Cancellations</button>
        <span className="font-sans text-xs text-muted-foreground ml-auto">
          {visible.length} of {items.length} order{items.length !== 1 ? "s" : ""}
          {hasFilters && <button onClick={clearFilters} className="ml-2 text-primary hover:underline">Clear</button>}
        </span>
      </div>

      {loading && <p className="text-sm text-muted-foreground font-sans">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted-foreground font-sans">No orders yet.</p>}
      {!loading && items.length > 0 && visible.length === 0 && (
        <p className="text-sm text-muted-foreground font-sans">No orders match your filters. <button onClick={clearFilters} className="text-primary hover:underline">Clear filters</button></p>
      )}

      {visible.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-left">
                  <SortTh label="Order #" k="order" />
                  {!groupByCustomer && <th className="px-4 py-2.5 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Customer</th>}
                  <SortTh label="Date" k="date" />
                  <th className="px-4 py-2.5 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="px-4 py-2.5 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Items</th>
                  <SortTh label="Total" k="total" />
                  <SortTh label="Payment" k="payment" />
                  <th className="px-4 py-2.5 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Refund</th>
                  <th className="px-4 py-2.5 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Tracking status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {groupByCustomer
                  ? groups.map(g => {
                      const isCollapsed = collapsed.has(g.user_id);
                      const owed = g.orders.filter(o => refundInfo(o).kind === "owed").length;
                      const pendingCancel = g.orders.filter(o => o.cancellation_status === "requested").length;
                      return (
                        <Fragment key={g.user_id}>
                          <tr className="bg-muted/20 border-t border-border cursor-pointer hover:bg-muted/30" onClick={() => toggleCollapse(g.user_id)}>
                            <td colSpan={colCount} className="px-4 py-2.5">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className={`text-muted-foreground text-[10px] transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▶</span>
                                <span className="font-sans text-sm font-semibold text-foreground">{g.name}</span>
                                <span className="font-sans text-xs text-muted-foreground">{g.email}</span>
                                <span className="font-sans text-xs text-muted-foreground">· {g.orders.length} order{g.orders.length !== 1 ? "s" : ""}</span>
                                {owed > 0 && <span className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">{owed} refund{owed !== 1 ? "s" : ""} owed</span>}
                                {pendingCancel > 0 && <span className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{pendingCancel} cancellation{pendingCancel !== 1 ? "s" : ""}</span>}
                              </div>
                            </td>
                          </tr>
                          {!isCollapsed && g.orders.map(o => renderRow(o, false))}
                        </Fragment>
                      );
                    })
                  : visible.map(o => renderRow(o, true))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Returns management panel ───────────────────────────────────────────────────

const ReturnsPanel = () => {
  const [items, setItems] = useState<AdminReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refundsDue, setRefundsDue] = useState<OpsOverview["refunds_due"]>([]);
  const { toast } = useToast();

  const load = () => {
    setLoading(true);
    getAdminReturns().then(r => { setItems(r); setLoading(false); }).catch(() => setLoading(false));
    getOpsOverview().then(o => setRefundsDue(o.refunds_due)).catch(() => {});
  };
  useEffect(load, []);

  const refundDueFor = (returnId: string) => refundsDue.find(r => r.source_id === returnId);

  const handleStatusChange = async (id: string, status: AdminReturnRecord["status"]) => {
    try {
      await updateReturnStatus(id, status);
      setItems(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      // A status change moves the refund-reminder clock server-side (approved
      // starts it, refunded/rejected resolves it) — resync so the "Refund due"
      // badges and KPI reflect the new state immediately.
      getOpsOverview().then(o => setRefundsDue(o.refunds_due)).catch(() => {});
      toast({ title: "Return updated — customer notified" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
  };

  const STATUS_OPTIONS: AdminReturnRecord["status"][] = ["requested", "approved", "rejected", "refunded"];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AdminReturnRecord["status"]>("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { requested: 0, approved: 0, rejected: 0, refunded: 0 };
    for (const r of items) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q) {
        const hay = [r.product_name, r.user_name, r.user_email, r.reason].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, statusFilter]);

  const STATUS_TONE: Record<AdminReturnRecord["status"], string> = {
    requested: "bg-amber-100 text-amber-700",
    approved: "bg-blue-100 text-blue-700",
    rejected: "bg-muted text-muted-foreground",
    refunded: "bg-green-100 text-green-700",
  };

  return (
    <div className="space-y-6">
      <SectionHeading title="Returns & Refunds" desc="Customer return requests submitted from the Returns & Refunds page. Update a status to notify the customer." />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile label="Total requests" value={items.length} onClick={() => setStatusFilter("all")} active={statusFilter === "all"} />
        <StatTile label="Requested" value={counts.requested} tone="amber" onClick={() => setStatusFilter("requested")} active={statusFilter === "requested"} />
        <StatTile label="Approved" value={counts.approved} onClick={() => setStatusFilter("approved")} active={statusFilter === "approved"} />
        <StatTile label="Refunded" value={counts.refunded} tone="green" onClick={() => setStatusFilter("refunded")} active={statusFilter === "refunded"} />
        <StatTile label="Refunds due" value={refundsDue.length} tone="red" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product, customer, reason…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-xs capitalize focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="all">Any status</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={load} className="font-sans text-xs font-medium px-3 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">Refresh</button>
        <span className="font-sans text-xs text-muted-foreground ml-auto">{visible.length} of {items.length}</span>
      </div>

      {loading && <p className="text-sm text-muted-foreground font-sans">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted-foreground font-sans">No return requests yet.</p>}
      {!loading && items.length > 0 && visible.length === 0 && <p className="text-sm text-muted-foreground font-sans">No returns match your filters.</p>}

      {visible.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-left">
                  {["Date", "Product", "Customer", "Reason", "Status"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const due = refundDueFor(r.id);
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/20 transition-colors align-top">
                      <td className="px-4 py-3 font-sans text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 font-sans font-medium text-foreground">{r.product_name}</td>
                      <td className="px-4 py-3">
                        <div className="font-sans text-sm text-foreground whitespace-nowrap">{r.user_name || "—"}</div>
                        <div className="font-sans text-xs text-muted-foreground">{r.user_email}</div>
                      </td>
                      <td className="px-4 py-3 font-sans text-sm text-foreground max-w-[320px]">
                        <p className="leading-relaxed">{r.reason}</p>
                        {due && (
                          <span className="inline-block mt-1 font-sans text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                            Refund due — {due.days_elapsed}d since approved
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`font-sans text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_TONE[r.status]}`}>{r.status}</span>
                          <select
                            value={r.status}
                            disabled={r.status === "refunded"}
                            onChange={(e) => handleStatusChange(r.id, e.target.value as AdminReturnRecord["status"])}
                            className="px-2 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs capitalize disabled:opacity-60 disabled:cursor-not-allowed"
                            title={r.status === "refunded" ? "Refunded is final — this can't be changed further." : undefined}
                          >
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <LastNotified title={r.last_notification_title} at={r.last_notification_at} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Ops panel ──────────────────────────────────────────────────────────────────
// Read-only aggregation over data the order-lifecycle feature already tracks
// (or that already existed) so nothing needs digging through separate tabs —
// plus the automation knobs (refund reminder cadence, thresholds) that drive it.

const OpsSettingsForm = ({ onSaved }: { onSaved: () => void }) => {
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_AUTOMATION_SETTINGS);
  const [daysText, setDaysText] = useState("1, 5, 7");
  const [reasonsText, setReasonsText] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    getAutomationSettings().then(s => {
      setSettings(s);
      setDaysText(s.refund_reminder_days.join(", "));
      setReasonsText((s.auto_approvable_return_reasons || []).join(", "));
    });
  }, []);

  const save = async () => {
    const days = daysText.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
    const reasons = reasonsText.split(",").map(s => s.trim()).filter(Boolean);
    const toSave = {
      ...settings,
      refund_reminder_days: days.length ? days : DEFAULT_AUTOMATION_SETTINGS.refund_reminder_days,
      auto_approvable_return_reasons: reasons.length ? reasons : DEFAULT_AUTOMATION_SETTINGS.auto_approvable_return_reasons,
    };
    setSaving(true);
    try {
      await saveAutomationSettings(toSave);
      setSettings(toSave);
      toast({ title: "Automation settings saved" });
      onSaved();
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border p-5 space-y-4">
      <p className="font-sans text-sm font-semibold text-foreground">Automation settings</p>

      <div className="space-y-2">
        <label className="flex items-center gap-2 font-sans text-sm text-foreground">
          <input type="checkbox" checked={settings.refund_reminder_enabled}
            onChange={e => setSettings(s => ({ ...s, refund_reminder_enabled: e.target.checked }))} className="accent-primary" />
          Email me refund reminders
        </label>
        <label className="flex items-center gap-2 font-sans text-sm text-foreground">
          <input type="checkbox" checked={settings.decision_engine_enabled}
            onChange={e => setSettings(s => ({ ...s, decision_engine_enabled: e.target.checked }))} className="accent-primary" />
          Suggest decisions (returns, fraud review, stuck-order follow-up, back-in-stock)
        </label>
        <label className="flex items-center gap-2 font-sans text-sm text-foreground">
          <input type="checkbox" checked={settings.stuck_order_followup_enabled}
            onChange={e => setSettings(s => ({ ...s, stuck_order_followup_enabled: e.target.checked }))} className="accent-primary" />
          Suggest a check-in email for stuck orders
        </label>
        <label className="flex items-center gap-2 font-sans text-sm text-foreground">
          <input type="checkbox" checked={settings.back_in_stock_notify_enabled}
            onChange={e => setSettings(s => ({ ...s, back_in_stock_notify_enabled: e.target.checked }))} className="accent-primary" />
          Suggest notifying subscribers when a product is back in stock
        </label>
        <label className="flex items-center gap-2 font-sans text-sm" style={{ color: settings.refund_automation_enabled ? "#b91c1c" : undefined }}>
          <input type="checkbox" checked={settings.refund_automation_enabled}
            onChange={e => setSettings(s => ({ ...s, refund_automation_enabled: e.target.checked }))} className="accent-destructive" />
          Refund via Stripe automatically when marked done (moves real money — off by default)
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Reminder days" hint="Comma-separated days since approval, e.g. 1, 5, 7">
          <Input value={daysText} onChange={e => setDaysText(e.target.value)} />
        </Field>
        <Field label="Stuck order after (days)">
          <Input type="number" min={1} value={settings.stuck_order_days}
            onChange={e => setSettings(s => ({ ...s, stuck_order_days: Number(e.target.value) }))} />
        </Field>
        <Field label="Low stock at or below">
          <Input type="number" min={0} value={settings.low_stock_threshold}
            onChange={e => setSettings(s => ({ ...s, low_stock_threshold: Number(e.target.value) }))} />
        </Field>
        <Field label="Return window (days)">
          <Input type="number" min={1} value={settings.return_window_days}
            onChange={e => setSettings(s => ({ ...s, return_window_days: Number(e.target.value) }))} />
        </Field>
        <Field label="Fraud review at or above (€)">
          <Input type="number" min={0} value={settings.fraud_review_threshold}
            onChange={e => setSettings(s => ({ ...s, fraud_review_threshold: Number(e.target.value) }))} />
        </Field>
        <Field label="Underperforming bundle window (days)">
          <Input type="number" min={1} value={settings.underperforming_bundle_days}
            onChange={e => setSettings(s => ({ ...s, underperforming_bundle_days: Number(e.target.value) }))} />
        </Field>
      </div>
      <Field label="Auto-approvable return reasons" hint="Comma-separated — a return is suggested for approval when its reason contains one of these">
        <Input value={reasonsText} onChange={e => setReasonsText(e.target.value)} />
      </Field>

      <button onClick={save} disabled={saving}
        className="px-5 py-2 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium hover:bg-olive-light transition-all disabled:opacity-50">
        {saving ? "Saving…" : "Save automation settings"}
      </button>
    </div>
  );
};

// ── Decisions queue — the human-in-the-loop centerpiece ─────────────────────
// Every rule the backend evaluates lands here as a suggestion; nothing happens
// until an admin clicks Approve (which executes it) or Dismiss (which doesn't).

const DECISION_LABEL: Record<AdminDecision["type"], string> = {
  return_approve_suggested: "Approve this return?",
  return_reject_suggested: "Reject this return?",
  fraud_review: "Review this high-value order",
  stuck_order_followup: "Send a check-in email?",
  back_in_stock_notify: "Notify subscribers it's back in stock?",
};

const DecisionsPanel = ({ decisions, onResolved }: { decisions: AdminDecision[]; onResolved: () => void }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();

  if (!decisions.length) return null;

  const approve = async (d: AdminDecision) => {
    setBusyId(d.id);
    try {
      await approveDecision(d.id);
      toast({ title: "Decision approved" });
      onResolved();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Could not approve", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (d: AdminDecision) => {
    setBusyId(d.id);
    try {
      await dismissDecision(d.id);
      toast({ title: "Dismissed" });
      onResolved();
    } catch {
      toast({ title: "Could not dismiss", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border-2 border-primary/40 p-5 space-y-3">
      <p className="font-sans text-sm font-semibold text-foreground">Decisions ({decisions.length})</p>
      <p className="font-sans text-xs text-muted-foreground -mt-2">Suggestions from the automated rules — nothing happens until you approve.</p>
      {decisions.map(d => (
        <div key={d.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-sans text-xs font-semibold text-foreground">{DECISION_LABEL[d.type] || d.type}</span>
            {(d.tracking_number || d.return_product_name) && (
              <span className="font-sans text-xs text-muted-foreground">
                {d.tracking_number ? `#${d.tracking_number}` : ""}{d.return_product_name ? ` · ${d.return_product_name}` : ""}
              </span>
            )}
          </div>
          <p className="font-sans text-xs text-muted-foreground">{d.reasoning}</p>
          <div className="flex gap-2">
            <button onClick={() => approve(d)} disabled={busyId === d.id}
              className="font-sans text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
              Approve
            </button>
            <button onClick={() => dismiss(d)} disabled={busyId === d.id}
              className="font-sans text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50">
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

// History of resolved decisions — so an approved/dismissed suggestion doesn't
// just vanish with no trace of what happened or when. Loaded lazily since it's
// secondary to the actionable queue above it.
const RESOLVED_DECISION_LABEL: Record<string, string> = { approved: "Approved", dismissed: "Dismissed" };

const ResolvedDecisionsPanel = () => {
  const [items, setItems] = useState<(AdminDecision & { resolved_at: string })[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = () => { getResolvedDecisions().then(setItems).catch(() => setItems([])); };

  return (
    <div className="rounded-xl border border-border p-5 space-y-3">
      <button onClick={() => { setExpanded(e => !e); if (!items) load(); }}
        className="font-sans text-sm font-semibold text-foreground hover:underline">
        {expanded ? "Hide" : "Show"} resolved decisions
      </button>
      {expanded && (
        items === null ? (
          <p className="font-sans text-xs text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="font-sans text-xs text-muted-foreground">Nothing resolved yet.</p>
        ) : (
          <div className="space-y-2">
            {items.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-3 font-sans text-xs text-muted-foreground">
                <span>
                  <span className={`font-medium ${d.status === "approved" ? "text-green-700" : "text-muted-foreground"}`}>
                    {RESOLVED_DECISION_LABEL[d.status] || d.status}
                  </span>
                  {" · "}{DECISION_LABEL[d.type] || d.type}
                  {(d.tracking_number || d.return_product_name) && ` · ${d.tracking_number ? `#${d.tracking_number}` : ""}${d.return_product_name ? ` ${d.return_product_name}` : ""}`}
                </span>
                <span className="shrink-0">{new Date(d.resolved_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

const OpsPanel = () => {
  const [ops, setOps] = useState<OpsOverview | null>(null);
  const [decisions, setDecisions] = useState<AdminDecision[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([getOpsOverview(), getAdminDecisions()])
      .then(([o, d]) => { setOps(o); setDecisions(d); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <SectionHeading title="Ops" desc="Fulfillment, inventory, and marketing signals that need attention — plus the automation that drives them." />

      {loading && <p className="text-sm text-muted-foreground font-sans">Loading…</p>}

      {ops && (
        <>
          <DecisionsPanel decisions={decisions} onResolved={load} />
          <ResolvedDecisionsPanel />

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border p-4">
              <p className="font-sans text-2xl font-semibold text-foreground">{ops.stuck_orders.length}</p>
              <p className="font-sans text-xs text-muted-foreground">Orders stuck &gt; {ops.settings.stuck_order_days}d</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="font-sans text-2xl font-semibold text-foreground">{ops.pending_cancellations.length}</p>
              <p className="font-sans text-xs text-muted-foreground">Cancellations awaiting decision</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="font-sans text-2xl font-semibold text-foreground">{ops.pending_returns_count}</p>
              <p className="font-sans text-xs text-muted-foreground">Return requests awaiting decision</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="font-sans text-2xl font-semibold text-foreground">{ops.refunds_due.length}</p>
              <p className="font-sans text-xs text-muted-foreground">Refunds owed to customers</p>
            </div>
          </div>

          {ops.stuck_orders.length > 0 && (
            <div className="rounded-xl border border-border p-5 space-y-2">
              <p className="font-sans text-sm font-semibold text-foreground">Stuck orders</p>
              {ops.stuck_orders.map(o => (
                <div key={o.id} className="flex items-center justify-between font-sans text-xs text-muted-foreground">
                  <span>{o.tracking_number} · {o.user_name || o.user_email} · stuck at "{o.status}"</span>
                  <span>{new Date(o.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}

          {ops.refunds_due.length > 0 && (
            <div className="rounded-xl border border-border p-5 space-y-2">
              <p className="font-sans text-sm font-semibold text-foreground">Refunds due</p>
              {ops.refunds_due.map(r => (
                <div key={r.id} className="flex items-center justify-between font-sans text-xs text-muted-foreground">
                  <span>{r.source === "return" ? "Return" : "Cancellation"} · #{r.tracking_number} · {r.user_name || r.user_email} · €{Number(r.total).toFixed(2)}</span>
                  <span className="font-medium text-red-700">{r.days_elapsed}d</span>
                </div>
              ))}
            </div>
          )}

          {ops.low_stock_products.length > 0 && (
            <div className="rounded-xl border border-border p-5 space-y-2">
              <p className="font-sans text-sm font-semibold text-foreground">Low stock</p>
              {ops.low_stock_products.map(p => (
                <div key={p.id} className="flex items-center justify-between font-sans text-xs text-muted-foreground">
                  <span>{p.name}</span>
                  <span className="font-medium text-amber-700">{p.stock} left</span>
                </div>
              ))}
            </div>
          )}

          {ops.underperforming_bundles.length > 0 && (
            <div className="rounded-xl border border-border p-5 space-y-2">
              <p className="font-sans text-sm font-semibold text-foreground">Underperforming bundles</p>
              <p className="font-sans text-xs text-muted-foreground -mt-1">No orders matched these active bundles in the last {ops.settings.underperforming_bundle_days} days.</p>
              {ops.underperforming_bundles.map(b => (
                <div key={b.id} className="font-sans text-xs text-muted-foreground">{b.name}</div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-border p-5">
            <p className="font-sans text-sm font-semibold text-foreground mb-1">Subscribers</p>
            <p className="font-sans text-xs text-muted-foreground">
              {ops.subscriber_stats.total} total · +{ops.subscriber_stats.new_7d} in the last 7 days · +{ops.subscriber_stats.new_30d} in the last 30 days
            </p>
          </div>

          <OpsSettingsForm onSaved={load} />
        </>
      )}
    </div>
  );
};

// ── Deals / Bundle & Save editor ──────────────────────────────────────────────

const EMPTY_BUNDLE = (): Bundle => ({
  id: Date.now().toString(),
  name: "",
  description: "",
  product_ids: [],
  discount_type: "percentage",
  discount_value: 10,
  is_active: true,
  display_order: 0,
});

const DealsEditor = ({
  allProducts,
  saving,
  setSaving,
  onError,
}: {
  allProducts: Product[];
  saving: boolean;
  setSaving: (v: boolean) => void;
  onError: (err: unknown, msg?: string) => void;
}) => {
  const [deals, setDeals] = useState<DealsContent>(DEFAULT_DEALS);
  const { toast } = useToast();

  useEffect(() => {
    getContent<DealsContent>("deals", DEFAULT_DEALS).then(d => { if (d) setDeals(d); });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveContent("deals", deals);
      toast({ title: "Deals saved!" });
    } catch (e) { onError(e, "Failed to save deals"); }
    finally { setSaving(false); }
  };

  const addBundle = () => setDeals(d => ({ ...d, bundles: [...d.bundles, EMPTY_BUNDLE()] }));
  const removeBundle = (id: string) => setDeals(d => ({ ...d, bundles: d.bundles.filter(b => b.id !== id) }));
  const updateBundle = (id: string, patch: Partial<Bundle>) =>
    setDeals(d => ({ ...d, bundles: d.bundles.map(b => b.id === id ? { ...b, ...patch } : b) }));

  return (
    <div className="space-y-6">
      <SectionHeading title="Today's Deals" desc="Create Bundle & Save offers. Discounts apply automatically when all bundle products are in the basket." />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Page Title">
          <Input value={deals.page_title} onChange={e => setDeals(d => ({ ...d, page_title: e.target.value }))} />
        </Field>
        <Field label="Page Subtitle">
          <Input value={deals.page_subtitle} onChange={e => setDeals(d => ({ ...d, page_subtitle: e.target.value }))} />
        </Field>
      </div>

      <div className="space-y-4">
        {deals.bundles.map((bundle, bi) => (
          <div key={bundle.id} className="border border-border rounded-xl p-5 space-y-4 bg-muted/30">
            <div className="flex items-center justify-between">
              <h3 className="font-sans text-sm font-semibold text-foreground">Bundle {bi + 1}</h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 font-sans text-sm text-foreground">
                  <input type="checkbox" checked={bundle.is_active} onChange={e => updateBundle(bundle.id, { is_active: e.target.checked })} className="accent-primary" />
                  Active
                </label>
                <RemoveButton onClick={() => removeBundle(bundle.id)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Bundle Name" hint='e.g. "Café Duo"'>
                <Input value={bundle.name} onChange={e => updateBundle(bundle.id, { name: e.target.value })} />
              </Field>
              <Field label="Display Order">
                <Input type="number" value={bundle.display_order} onChange={e => updateBundle(bundle.id, { display_order: Number(e.target.value) })} />
              </Field>
            </div>

            <Field label="Description" hint='e.g. "morning ritual starter pack"'>
              <Input value={bundle.description} onChange={e => updateBundle(bundle.id, { description: e.target.value })} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Discount Type">
                <select
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value={bundle.discount_type}
                  onChange={e => updateBundle(bundle.id, { discount_type: e.target.value as "percentage" | "fixed" })}
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed amount (€)</option>
                </select>
              </Field>
              <Field label={`Discount Value (${bundle.discount_type === "percentage" ? "%" : "€"})`}>
                <Input type="number" min={0} step={bundle.discount_type === "percentage" ? 1 : 0.5}
                  value={bundle.discount_value} onChange={e => updateBundle(bundle.id, { discount_value: Number(e.target.value) })} />
              </Field>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-sans font-medium text-foreground">Products in this bundle</label>
              <select className="w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                value="" onChange={e => { const id = e.target.value; if (id && !bundle.product_ids.includes(id)) updateBundle(bundle.id, { product_ids: [...bundle.product_ids, id] }); e.currentTarget.value = ""; }}>
                <option value="">+ add a product →</option>
                {allProducts.filter(p => !bundle.product_ids.includes(p.id)).map(p => (
                  <option key={p.id} value={p.id}>{p.name} — {p.price}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {bundle.product_ids.map(pid => {
                  const p = allProducts.find(x => x.id === pid);
                  return p ? (
                    <div key={pid} className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-border bg-card text-sm font-sans text-foreground">
                      {p.name}
                      <button onClick={() => updateBundle(bundle.id, { product_ids: bundle.product_ids.filter(x => x !== pid) })} className="text-destructive hover:text-destructive/80 ml-1 font-bold">×</button>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <AddButton onClick={addBundle} label="Add bundle" />
      <SaveButton onClick={save} saving={saving} />
    </div>
  );
};

const SubscribersPanel = ({
  subscribers,
  onDelete,
  popup,
  onPopupChange,
  onPopupSave,
  saving,
}: {
  subscribers: Subscriber[];
  onDelete: (id: string) => void;
  popup: SubscribePopupContent;
  onPopupChange: (d: SubscribePopupContent) => void;
  onPopupSave: () => void;
  saving: boolean;
}) => {
  const [search, setSearch] = useState("");
  const [codes, setCodes] = useState<DiscountCodeRecord[]>([]);
  const [codeStats, setCodeStats] = useState<{ issued: number; redeemed: number }>({ issued: 0, redeemed: 0 });
  useEffect(() => {
    getAdminDiscountCodes()
      .then(({ codes, stats }) => { setCodes(codes); setCodeStats(stats); })
      .catch(() => { /* non-fatal — panel still shows subscribers */ });
  }, []);
  const exportCSV = () => {
    const csv = ["Email,Subscribed At", ...subscribers.map((s) => `${s.email},${s.subscribed_at}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subscribers.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const visible = subscribers.filter(s => s.email.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-6">
      <SectionHeading title="Subscribers & Signup Popup" desc="The home-page signup playcard offer, and every email it (and the newsletter form) has collected." />

      {/* ── Signup popup settings ─────────────────────────────────────────── */}
      <div className="border border-border rounded-xl bg-card p-5 space-y-4 max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-sans text-sm font-semibold text-foreground">Signup popup</p>
            <p className="font-sans text-xs text-muted-foreground">
              A playcard shown once per session, bottom-left of the home page, to visitors who aren't signed in.
              Use <code>{"{discount}"}</code> in any text field to insert the discount percent.
            </p>
          </div>
          <label className="flex items-center gap-2 font-sans text-sm shrink-0">
            <input
              type="checkbox"
              checked={popup.enabled}
              onChange={(e) => onPopupChange({ ...popup, enabled: e.target.checked })}
              className="accent-primary"
            />
            Enabled
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Discount (%)" hint="The offer shown on the card — the {discount} token everywhere renders as this.">
            <Input
              type="number" min={0} max={100}
              value={popup.discount_percent}
              onChange={(e) => onPopupChange({ ...popup, discount_percent: Number(e.target.value) })}
            />
          </Field>
          <Field label="Delay before showing (seconds)">
            <Input
              type="number" min={0}
              value={popup.delay_seconds}
              onChange={(e) => onPopupChange({ ...popup, delay_seconds: Number(e.target.value) })}
            />
          </Field>
          <Field label="Eyebrow line">
            <Input value={popup.eyebrow} onChange={(e) => onPopupChange({ ...popup, eyebrow: e.target.value })} />
          </Field>
          <Field label="Headline">
            <Input value={popup.headline} onChange={(e) => onPopupChange({ ...popup, headline: e.target.value })} />
          </Field>
          <Field label="Email placeholder">
            <Input value={popup.placeholder} onChange={(e) => onPopupChange({ ...popup, placeholder: e.target.value })} />
          </Field>
          <Field label="Button text">
            <Input value={popup.cta_text} onChange={(e) => onPopupChange({ ...popup, cta_text: e.target.value })} />
          </Field>
        </div>
        <Field label="Subtext">
          <Textarea rows={2} value={popup.subtext} onChange={(e) => onPopupChange({ ...popup, subtext: e.target.value })} />
        </Field>
        <Field label="Success message" hint="Shown after a visitor subscribes from the card.">
          <Input value={popup.success_text} onChange={(e) => onPopupChange({ ...popup, success_text: e.target.value })} />
        </Field>
        <SaveButton onClick={onPopupSave} saving={saving} />
      </div>

      {/* ── Welcome discount codes ─────────────────────────────────────────── */}
      <div className="border border-border rounded-xl bg-card p-5 space-y-3 max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-sans text-sm font-semibold text-foreground">Welcome discount codes</p>
            <p className="font-sans text-xs text-muted-foreground">Single-use codes emailed to new subscribers and redeemed at checkout.</p>
          </div>
          <div className="flex gap-4 shrink-0 text-right">
            <div>
              <p className="font-serif text-lg text-foreground leading-none">{codeStats.issued}</p>
              <p className="font-sans text-[11px] text-muted-foreground">issued</p>
            </div>
            <div>
              <p className="font-serif text-lg text-foreground leading-none">{codeStats.redeemed}</p>
              <p className="font-sans text-[11px] text-muted-foreground">redeemed</p>
            </div>
          </div>
        </div>
        {codes.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 text-[11px] font-sans font-medium text-muted-foreground uppercase tracking-wider">Code</th>
                  <th className="text-left px-3 py-2 text-[11px] font-sans font-medium text-muted-foreground uppercase tracking-wider">Email</th>
                  <th className="text-left px-3 py-2 text-[11px] font-sans font-medium text-muted-foreground uppercase tracking-wider">%</th>
                  <th className="text-left px-3 py-2 text-[11px] font-sans font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {codes.slice(0, 25).map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-3 py-2 text-xs font-mono text-foreground">{c.code}</td>
                    <td className="px-3 py-2 text-xs font-sans text-muted-foreground truncate max-w-[180px]">{c.email}</td>
                    <td className="px-3 py-2 text-xs font-sans text-foreground">{Number(c.discount_percent)}%</td>
                    <td className="px-3 py-2 text-xs font-sans">
                      {c.redeemed_at
                        ? <span className="px-2 py-0.5 rounded-full" style={{ background: "#eef6ee", color: "#007600" }}>Redeemed</span>
                        : <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Unused</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Subscriber list ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search email…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <span className="font-sans text-xs text-muted-foreground">{visible.length} of {subscribers.length}</span>
        <button
          onClick={exportCSV}
          className="px-4 py-2 rounded-lg border border-border text-sm font-sans text-foreground hover:bg-muted transition-colors"
        >
          Export CSV
        </button>
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left px-4 py-3 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-3 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Date</th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody>
            {visible.map((sub) => (
              <tr key={sub.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-sm font-sans text-foreground">{sub.email}</td>
                <td className="px-4 py-3 text-sm font-sans text-muted-foreground">
                  {new Date(sub.subscribed_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onDelete(sub.id)}
                    className="text-destructive hover:text-destructive/80 transition-colors text-xs font-sans"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground font-sans">
                  {subscribers.length === 0 ? "No subscribers yet" : "No subscribers match your search"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Signed Up Users panel ─────────────────────────────────────────────────────

const UsersPanel = () => {
  const [users, setUsers] = useState<AppUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  useEffect(() => {
    getAdminUsers().then(u => { setUsers(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  const visible = users.filter(u => {
    const q = search.trim().toLowerCase();
    return !q || [u.full_name, u.email, u.provider].join(" ").toLowerCase().includes(q);
  });
  return (
    <div className="space-y-6">
      <SectionHeading title="Signed Up Users" desc="All users who have registered via email or OAuth." />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, provider…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <span className="font-sans text-xs text-muted-foreground">{visible.length} of {users.length} user{users.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left px-4 py-3 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-3 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Provider</th>
              <th className="text-left px-4 py-3 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground font-sans">Loading…</td></tr>}
            {!loading && users.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground font-sans">No users yet</td></tr>}
            {!loading && users.length > 0 && visible.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground font-sans">No users match your search</td></tr>}
            {visible.map(u => (
              <tr key={u.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-sm font-sans text-foreground flex items-center gap-2">
                  {u.avatar_url
                    ? <img src={u.avatar_url} className="w-7 h-7 rounded-full object-cover shrink-0" />
                    : <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0">{(u.full_name?.[0] ?? u.email?.[0] ?? "?").toUpperCase()}</div>}
                  {u.full_name || "—"}
                </td>
                <td className="px-4 py-3 text-sm font-sans text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3 text-sm font-sans text-muted-foreground capitalize">{u.provider}</td>
                <td className="px-4 py-3 text-sm font-sans text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Customer Feedback panel ───────────────────────────────────────────────────

const FeedbackPanel = () => {
  const [items, setItems] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState<"all" | "5" | "4" | "3" | "2" | "1">("all");
  const { toast } = useToast();

  const load = () => {
    setLoading(true);
    getAdminFeedback().then(f => { setItems(f); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this feedback?")) return;
    try { await deleteAdminFeedback(id); toast({ title: "Deleted" }); load(); }
    catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

  const avg = items.length ? (items.reduce((s, f) => s + f.rating, 0) / items.length).toFixed(1) : "—";
  const visible = items.filter(f => {
    if (ratingFilter !== "all" && f.rating !== Number(ratingFilter)) return false;
    const q = search.trim().toLowerCase();
    return !q || [f.name, f.email, f.message].join(" ").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <SectionHeading title="Customer Feedback" desc="Reviews and feedback submitted by customers on the homepage." />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, message…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <select value={ratingFilter} onChange={e => setRatingFilter(e.target.value as typeof ratingFilter)}
          className="px-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="all">Any rating</option>
          {[5, 4, 3, 2, 1].map(n => <option key={n} value={String(n)}>{n} ★</option>)}
        </select>
        <span className="font-sans text-xs text-muted-foreground">{visible.length} of {items.length} · avg {avg}★</span>
      </div>
      {loading && <p className="text-sm text-muted-foreground font-sans">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted-foreground font-sans">No feedback yet.</p>}
      {!loading && items.length > 0 && visible.length === 0 && <p className="text-sm text-muted-foreground font-sans">No feedback matches your filters.</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visible.map(f => (
          <div key={f.id} className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-sans text-sm font-semibold text-foreground">{f.name || "Anonymous"}</span>
                  {f.email && <span className="font-sans text-xs text-muted-foreground">{f.email}</span>}
                  <span className="text-amber-500 text-sm tracking-tighter">{stars(f.rating)}</span>
                </div>
                <p className="font-sans text-sm text-foreground leading-relaxed">{f.message}</p>
                {f.photo_url && <img src={f.photo_url} alt="Customer photo" className="mt-2 h-24 rounded-lg object-cover" />}
                <p className="font-sans text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString()}</p>
              </div>
              <button onClick={() => handleDelete(f.id)} className="text-destructive hover:text-destructive/80 text-xs font-sans shrink-0">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Shop By Category editor ────────────────────────────────────────────────────

const EMPTY_CATEGORY: Partial<ShopCategory> = {
  name: "", slug: "", mood_description: "", tags: [],
  bg_color: "#f5e4cb", page_bg_color: "#ede0c8",
  accent_color: "#6b3520", text_color: "#2c1508",
  stickers: [], product_ids: [], display_order: 0,
};

const ShopEditor = ({
  categories: initCats,
  allProducts,
  onRefresh,
  saving,
  setSaving,
  onError,
}: {
  categories: ShopCategory[];
  allProducts: Product[];
  onRefresh: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
  onError: (err: unknown, msg?: string) => void;
}) => {
  const [cats, setCats]           = useState<ShopCategory[]>(initCats);
  const [editingCat, setEditingCat] = useState<Partial<ShopCategory> | null>(null);
  const [scrapSettings, setScrapSettings] = useState<ScrapbookSettings>(DEFAULT_SCRAPBOOK_SETTINGS);
  const { toast } = useToast();

  useEffect(() => { setCats(initCats); }, [initCats]);

  useEffect(() => {
    getContent<ScrapbookSettings>("scrapbookSettings", DEFAULT_SCRAPBOOK_SETTINGS)
      .then(s => { if (s) setScrapSettings(s); });
  }, []);

  const saveScrapSettings = async () => {
    setSaving(true);
    try {
      await saveContent("scrapbookSettings", scrapSettings);
      toast({ title: "Scrapbook settings saved!" });
    } catch (e: unknown) {
      onError(e, "Failed to save scrapbook settings");
    } finally { setSaving(false); }
  };


  // ── Category CRUD ──────────────────────────────────────────────────────────
  const saveCat = async () => {
    if (!editingCat) return;
    setSaving(true);
    try {
      await saveShopCategory(editingCat);
      toast({ title: "Saved!" });
      setEditingCat(null);
      onRefresh();
    } catch (e: unknown) {
      onError(e, "Failed to save category");
    } finally { setSaving(false); }
  };

  const deleteCat = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    setSaving(true);
    try {
      await deleteShopCategory(id);
      toast({ title: "Deleted" });
      onRefresh();
    } catch (e: unknown) {
      onError(e, "Failed to delete category");
    } finally { setSaving(false); }
  };

  // ── Product assignment (saves immediately) ─────────────────────────────────
  const addProductToCat = async (cat: ShopCategory, productId: string) => {
    if ((cat.product_ids ?? []).includes(productId)) return;
    const updated = { ...cat, product_ids: [...(cat.product_ids ?? []), productId] };
    setSaving(true);
    try {
      await saveShopCategory(updated);
      onRefresh();
    } catch (e: unknown) {
      onError(e, "Failed to update category");
    } finally { setSaving(false); }
  };

  const removeProductFromCat = async (cat: ShopCategory, productId: string) => {
    const updated = { ...cat, product_ids: (cat.product_ids ?? []).filter(id => id !== productId) };
    setSaving(true);
    try {
      await saveShopCategory(updated);
      onRefresh();
    } catch (e: unknown) {
      onError(e, "Failed to update category");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Shop By Category"
        desc="Each category becomes a page in the scrapbook book. Assign products from the Products section to each category."
      />

      {/* How it works */}
      <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 space-y-1">
        <p className="font-sans text-xs font-semibold text-foreground">How it works</p>
        <p className="font-sans text-xs text-muted-foreground">
          1. Add products in the <strong>Products</strong> tab (name, price, image, description).
          &nbsp;2. Create a category below.
          &nbsp;3. Pick products from the dropdown inside each category — they appear as candle cards in the scrapbook.
        </p>
      </div>

      {/* ── Scrapbook animation settings ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="font-sans text-sm font-semibold text-foreground">Scrapbook Settings</p>

        <Field
          label="New Arrivals category"
          hint="This category will appear as a dedicated section above the scrapbook on the homepage."
        >
          <select
            className="w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={scrapSettings.newArrivalsCategoryId}
            onChange={e => setScrapSettings(s => ({ ...s, newArrivalsCategoryId: e.target.value }))}
          >
            <option value="">— none (hide the section) —</option>
            {cats.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field
          label={`Page flip duration: ${scrapSettings.flipDuration.toFixed(2)}s`}
          hint="How long the page-turn animation takes"
        >
          <input
            type="range"
            min={0.2}
            max={2.0}
            step={0.05}
            value={scrapSettings.flipDuration}
            onChange={e => setScrapSettings(s => ({ ...s, flipDuration: Number(e.target.value) }))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground font-sans mt-1">
            <span>0.2 s (fast)</span><span>2.0 s (slow)</span>
          </div>
        </Field>

        <Field
          label={`Auto-flip interval: ${(scrapSettings.autoFlipInterval / 1000).toFixed(1)}s`}
          hint="How long each category page stays before auto-flipping"
        >
          <input
            type="range"
            min={2000}
            max={15000}
            step={500}
            value={scrapSettings.autoFlipInterval}
            onChange={e => setScrapSettings(s => ({ ...s, autoFlipInterval: Number(e.target.value) }))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground font-sans mt-1">
            <span>2 s</span><span>15 s</span>
          </div>
        </Field>

        <SaveButton onClick={saveScrapSettings} saving={saving} />
      </div>

      {allProducts.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-sans text-amber-800">
          ⚠️ No products yet — go to the <strong>Products</strong> tab first and add your candles, then come back here.
        </div>
      )}

      {/* Category form (add / edit) */}
      {editingCat && (
        <div className="border border-primary/30 rounded-xl p-5 space-y-4 bg-primary/5">
          <h3 className="font-sans text-sm font-semibold text-foreground">
            {editingCat.id ? "Edit Category" : "New Category"}
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category Name" hint='e.g. "Coffee Shop Chaos"'>
              <Input value={editingCat.name ?? ""} onChange={e => {
                const name = e.target.value;
                const autoSlug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                setEditingCat(p => ({
                  ...p!,
                  name,
                  slug: !p?.id ? autoSlug : (p?.slug ?? autoSlug),
                }));
              }} />
            </Field>
            <Field label="Slug" hint="Auto-generated from name — URL-friendly, no spaces">
              <Input value={editingCat.slug ?? ""} onChange={e => setEditingCat(p => ({ ...p!, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }))} />
            </Field>
          </div>

          <Field label="Mood Description" hint='e.g. "espresso shots & situationships"'>
            <Input value={editingCat.mood_description ?? ""} onChange={e => setEditingCat(p => ({ ...p!, mood_description: e.target.value }))} />
          </Field>

          <Field label="Tags (comma separated)" hint='e.g. "#chaotic, #caffeinated"'>
            <Input
              value={(editingCat.tags ?? []).join(", ")}
              onChange={e => setEditingCat(p => ({ ...p!, tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Page Background", key: "bg_color",      def: "#f5e4cb" },
              { label: "Right Panel",     key: "page_bg_color", def: "#ede0c8" },
              { label: "Accent Color",    key: "accent_color",  def: "#6b3520" },
              { label: "Text Color",      key: "text_color",    def: "#2c1508" },
            ].map(({ label, key, def }) => (
              <Field key={key} label={label}>
                <div className="flex gap-2 items-center">
                  <input type="color"
                    value={(editingCat as Record<string,string>)[key] ?? def}
                    onChange={e => setEditingCat(p => ({ ...p!, [key]: e.target.value }))}
                    className="w-10 h-9 rounded border border-border cursor-pointer flex-shrink-0"
                  />
                  <Input
                    value={(editingCat as Record<string,string>)[key] ?? def}
                    onChange={e => setEditingCat(p => ({ ...p!, [key]: e.target.value }))}
                  />
                </div>
              </Field>
            ))}
          </div>

          <Field label="Display Order" hint="Lower = appears earlier in the book">
            <Input type="number" value={editingCat.display_order ?? 0}
              onChange={e => setEditingCat(p => ({ ...p!, display_order: Number(e.target.value) }))} />
          </Field>

          {/* ── Product picker inside the form ── */}
          <div className="space-y-2 pt-1 border-t border-border">
            <label className="block text-sm font-sans font-medium text-foreground pt-2">
              Products shown in this category
            </label>
            <p className="text-xs text-muted-foreground font-sans">
              Select which products appear as candle cards on this scrapbook page.
            </p>

            {allProducts.length === 0 ? (
              <p className="text-xs text-amber-700 font-sans bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No products available — add some in the <strong>Products</strong> tab first.
              </p>
            ) : (
              <div className="space-y-2">
                {/* Dropdown to add a product */}
                <select
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value=""
                  onChange={e => {
                    const id = e.target.value;
                    if (!id) return;
                    const current = editingCat.product_ids ?? [];
                    if (!current.includes(id)) {
                      setEditingCat(p => ({ ...p!, product_ids: [...current, id] }));
                    }
                    e.currentTarget.value = "";
                  }}
                >
                  <option value="">+ pick a product to add →</option>
                  {allProducts
                    .filter(p => !(editingCat.product_ids ?? []).includes(p.id))
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.price ? ` · ${p.price}` : ""}{p.tag ? ` · ${p.tag}` : ""}
                      </option>
                    ))}
                </select>

                {/* Selected products list */}
                {(editingCat.product_ids ?? []).length > 0 && (
                  <div className="space-y-1.5">
                    {(editingCat.product_ids ?? []).map(id => {
                      const p = allProducts.find(x => x.id === id);
                      if (!p) return null;
                      return (
                        <div key={id} className="flex items-center gap-3 bg-card border border-border rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="font-sans text-sm text-foreground truncate">{p.name}</span>
                            {p.price && <span className="font-sans text-xs text-muted-foreground ml-2">{p.price}</span>}
                          </div>
                          <button
                            onClick={() => setEditingCat(prev => ({ ...prev!, product_ids: (prev!.product_ids ?? []).filter(x => x !== id) }))}
                            className="text-destructive/60 hover:text-destructive text-xs font-sans shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <SaveButton onClick={saveCat} saving={saving} />
            <button onClick={() => setEditingCat(null)}
              className="px-4 py-2.5 rounded-lg border border-border text-sm font-sans text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Category list — product assignment always visible */}
      <div className="space-y-6">
        {cats.map(cat => {
          const assignedIds = cat.product_ids ?? [];
          const assigned    = assignedIds.map(id => allProducts.find(p => p.id === id)).filter(Boolean) as Product[];
          const unassigned  = allProducts.filter(p => !assignedIds.includes(p.id));

          return (
            <div key={cat.id} className="border border-border rounded-xl overflow-hidden">

              {/* Category header */}
              <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-4 h-4 rounded-full shrink-0" style={{ background: cat.accent_color }} />
                  <span className="font-sans text-sm font-semibold text-foreground truncate">{cat.name}</span>
                  {cat.mood_description && (
                    <span className="text-xs text-muted-foreground font-sans truncate hidden sm:inline">— {cat.mood_description}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <button
                    onClick={() => setEditingCat({ ...cat })}
                    className="px-3 py-1.5 text-xs font-sans rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Edit category
                  </button>
                  <RemoveButton onClick={() => deleteCat(cat.id)} />
                </div>
              </div>

              <div className="p-4 space-y-4">

                {/* ── ADD PRODUCT DROPDOWN ── */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-sans font-medium text-foreground">
                    Add product to this category
                  </label>
                  <p className="text-xs text-muted-foreground font-sans">
                    Products are managed in the <strong>Products</strong> tab. Select one from the dropdown to add it here.
                  </p>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      value=""
                      onChange={e => { if (e.target.value) addProductToCat(cat, e.target.value); e.currentTarget.value = ""; }}
                    >
                      <option value="">— pick a product to add —</option>
                      {unassigned.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.price ? ` · ${p.price}` : ""}{p.tag ? ` · ${p.tag}` : ""}
                        </option>
                      ))}
                      {unassigned.length === 0 && allProducts.length > 0 && (
                        <option disabled>All products already added to this category</option>
                      )}
                      {allProducts.length === 0 && (
                        <option disabled>No products yet — add them in the Products tab first</option>
                      )}
                    </select>
                  </div>
                </div>

                {/* ── ASSIGNED PRODUCTS ── */}
                <div className="space-y-2">
                  <p className="text-xs font-sans font-medium text-muted-foreground uppercase tracking-wide">
                    Products in this category ({assigned.length})
                  </p>

                  {assigned.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
                      <p className="text-xs text-muted-foreground font-sans">
                        No products assigned yet.<br />Use the dropdown above to add some.
                      </p>
                    </div>
                  ) : (
                    assigned.map(p => (
                      <div key={p.id} className="flex items-center gap-3 bg-muted/20 rounded-lg px-3 py-2.5 border border-border/50">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} className="w-9 h-9 rounded object-cover shrink-0" />
                        ) : (
                          <div className="w-9 h-9 rounded bg-muted flex items-center justify-center shrink-0 text-base">🕯️</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-sans text-sm font-medium text-foreground truncate">{p.name}</p>
                          {p.description && (
                            <p className="font-sans text-xs text-muted-foreground truncate">{p.description}</p>
                          )}
                        </div>
                        <span className="font-sans text-sm font-semibold text-foreground shrink-0">{p.price}</span>
                        {p.tag && (
                          <span className="text-xs font-sans bg-muted text-muted-foreground px-2 py-0.5 rounded-full shrink-0">{p.tag}</span>
                        )}
                        <RemoveButton onClick={() => removeProductFromCat(cat, p.id)} />
                      </div>
                    ))
                  )}
                </div>

              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {cats.length === 0 && !editingCat && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-3">
          <p className="text-2xl">📖</p>
          <p className="font-sans text-sm font-medium text-foreground">No categories yet</p>
          <p className="font-sans text-xs text-muted-foreground">
            Each category becomes a page in the scrapbook. Add one, then assign products to it.
          </p>
          <div className="pt-2">
            <button onClick={() => setEditingCat({ ...EMPTY_CATEGORY })}
              className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium hover:opacity-90 transition-opacity">
              + Add First Category
            </button>
          </div>
        </div>
      )}

      {cats.length > 0 && !editingCat && (
        <AddButton label="Add category" onClick={() => setEditingCat({ ...EMPTY_CATEGORY })} />
      )}
    </div>
  );
};

// ── Sidebar nav ────────────────────────────────────────────────────────────────

type TabId =
  | "announcementBar"
  | "navbar"
  | "hero"
  | "shopCategories"
  | "deals"
  | "momentPill"
  | "welcomeClub"
  | "brandStory"
  | "products"
  | "candleCare"
  | "videos"
  | "testimonials"
  | "newsletter"
  | "footer"
  | "returnPolicy"
  | "giftCards"
  | "customerService"
  | "pickupSettings"
  | "privacyPolicy"
  | "termsOfService"
  | "shippingPolicy"
  | "subscribers"
  | "users"
  | "feedback"
  | "orders"
  | "returns"
  | "ops"
  | "analytics";

type NavItem = { id: TabId; label: string; icon: string };
type NavGroup = { id: string; label: string; icon: string; items: NavItem[] };

// Sections are grouped by which real site page they control, so the sidebar
// reads as "pages" rather than a flat list of every content block.
const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    label: "Home Page",
    icon: "🏠",
    items: [
      { id: "announcementBar", label: "Announcement Bar", icon: "📢" },
      { id: "navbar",          label: "Navbar",           icon: "☰" },
      { id: "hero",            label: "Hero Banner",      icon: "🖼️" },
      { id: "momentPill",      label: "Moment Pill",      icon: "💊" },
      { id: "welcomeClub",     label: "Welcome Club",     icon: "🫶" },
      { id: "brandStory",      label: "Brand Story",      icon: "🕯️" },
      { id: "products",        label: "Products",         icon: "◈" },
      { id: "candleCare",      label: "Candle Care",      icon: "♨" },
      { id: "videos",          label: "Videos",           icon: "▶" },
      { id: "testimonials",    label: "Testimonials",     icon: "❝" },
      { id: "newsletter",      label: "Newsletter",       icon: "✉" },
      { id: "footer",          label: "Footer",           icon: "⊘" },
    ],
  },
  {
    id: "shop",
    label: "Shop Page",
    icon: "🛍️",
    items: [
      { id: "shopCategories", label: "Shop By Category", icon: "📖" },
      { id: "deals",          label: "Today's Deals",    icon: "🏷️" },
    ],
  },
  {
    id: "policies",
    label: "Policy & Info Pages",
    icon: "📄",
    items: [
      { id: "returnPolicy",    label: "Return Policy",    icon: "↩" },
      { id: "giftCards",       label: "Gift Cards",       icon: "🎁" },
      { id: "customerService", label: "Customer Service", icon: "🎧" },
      { id: "privacyPolicy",   label: "Privacy Policy",   icon: "🔒" },
      { id: "termsOfService",  label: "Terms of Service", icon: "📜" },
      { id: "shippingPolicy",  label: "Shipping Policy",  icon: "🚚" },
    ],
  },
  {
    id: "customers",
    label: "Customers & Orders",
    icon: "👥",
    items: [
      { id: "users",       label: "Signed Up Users",   icon: "👤" },
      { id: "feedback",    label: "Customer Feedback", icon: "💬" },
      { id: "orders",      label: "Orders",            icon: "🧾" },
      { id: "returns",     label: "Returns",           icon: "📦" },
    ],
  },
  {
    id: "ops",
    label: "Ops",
    icon: "⚙️",
    items: [
      { id: "ops", label: "Ops Overview", icon: "📊" },
      { id: "analytics", label: "Analytics", icon: "📈" },
      { id: "subscribers", label: "Subscribers & Signup Popup", icon: "◉" },
      { id: "pickupSettings",  label: "Pickup & Delivery", icon: "🏬" },
    ],
  },
];

const groupIdForTab = (tab: TabId): string =>
  NAV_GROUPS.find((g) => g.items.some((i) => i.id === tab))?.id ?? NAV_GROUPS[0].id;

// Tabs that render dense tables/dashboards rather than a settings form — these
// get the full working width so nothing is clipped.
const WIDE_TABS = new Set<TabId>([
  "shopCategories", "deals", "subscribers", "users", "feedback", "orders", "returns", "ops", "analytics",
]);

// ── Main Dashboard ─────────────────────────────────────────────────────────────

const AdminDashboard = () => {
  const [session, setSession] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("hero");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set([groupIdForTab("hero")]));
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [shopCategories, setShopCategories] = useState<ShopCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setSession(isLoggedIn());
  }, []);

  const loadData = useCallback(async () => {
    // ── Content sections (getContent never throws — falls back to defaults) ──
    const [announcementBar, navbar, hero, momentPill, welcomeClub, brandStory, products, candleCare, videos, testimonials, newsletter, footer, returnPolicy, giftCards, customerService, pickupSettings, subscribePopup, privacyPolicy, termsOfService, shippingPolicy] =
      await Promise.all([
        getContent("announcementBar", DEFAULT_CONTENT.announcementBar),
        getContent("navbar",          DEFAULT_CONTENT.navbar),
        getContent("hero",            DEFAULT_CONTENT.hero),
        getContent("momentPill",      DEFAULT_CONTENT.momentPill),
        getContent("welcomeClub",     DEFAULT_CONTENT.welcomeClub),
        getContent("brandStory",      DEFAULT_CONTENT.brandStory),
        getContent("products",        DEFAULT_CONTENT.products),
        getContent("candleCare",      DEFAULT_CONTENT.candleCare),
        getContent("videos",          DEFAULT_CONTENT.videos),
        getContent("testimonials",    DEFAULT_CONTENT.testimonials),
        getContent("newsletter",      DEFAULT_CONTENT.newsletter),
        getContent("footer",          DEFAULT_CONTENT.footer),
        getContent("returnPolicy",    DEFAULT_CONTENT.returnPolicy),
        getContent("giftCards",       DEFAULT_CONTENT.giftCards),
        getContent("customerService", DEFAULT_CONTENT.customerService),
        getContent("pickupSettings",  DEFAULT_CONTENT.pickupSettings),
        getContent("subscribePopup",  DEFAULT_CONTENT.subscribePopup),
        getContent("privacyPolicy",   DEFAULT_CONTENT.privacyPolicy),
        getContent("termsOfService",  DEFAULT_CONTENT.termsOfService),
        getContent("shippingPolicy",  DEFAULT_CONTENT.shippingPolicy),
      ]);
    setContent({ announcementBar, navbar, hero, momentPill, welcomeClub, brandStory, products, candleCare, videos, testimonials, newsletter, footer, returnPolicy, giftCards, customerService, pickupSettings, subscribePopup, privacyPolicy, termsOfService, shippingPolicy });

    // ── Shop categories ───────────────────────────────────────────────────────
    try {
      const cats = await getShopCategories();
      setShopCategories(cats);
    } catch { /* non-fatal */ }

    // ── Subscribers (separate — can throw if auth fails) ──────────────────────
    try {
      const subs = await getSubscribers();
      setSubscribers(subs);
    } catch {
      // Token may be expired; subscribers list stays empty — not fatal
    }
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // Central error handler — detects expired sessions and auto-logs out
  const handleError = useCallback((err: unknown, fallbackMsg = "Something went wrong") => {
    if (err instanceof SessionExpiredError) {
      toast({ title: "Session expired", description: "Signing you out…", variant: "destructive" });
      setTimeout(() => { logout(); setSession(false); }, 1200);
    } else {
      const message = err instanceof Error ? err.message : fallbackMsg;
      toast({ title: "Error", description: message, variant: "destructive" });
    }
  }, [toast]);

  const handleSave = async (section: keyof SiteContent) => {
    setSaving(true);
    try {
      await saveContent(section, content[section]);
      toast({ title: "Saved!", description: `${section} updated.` });
    } catch (err: unknown) {
      handleError(err, "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSubscriber = async (id: string) => {
    try {
      await deleteSubscriber(id);
      setSubscribers((prev) => prev.filter((s) => s.id !== id));
      toast({ title: "Deleted" });
    } catch (err: unknown) {
      handleError(err, "Failed to delete");
    }
  };

  if (session === null) return null;
  if (!session) return <AdminLogin onLogin={() => setSession(true)} />;

  const update = <K extends keyof SiteContent>(section: K) =>
    (value: SiteContent[K]) => setContent((prev) => ({ ...prev, [section]: value }));

  const selectTab = (id: TabId) => {
    setActiveTab(id);
    setExpandedGroups((prev) => new Set(prev).add(groupIdForTab(id)));
  };

  const toggleGroup = (id: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Top header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between bg-card shrink-0">
        <div className="flex items-center gap-3">
          <img src={logo} alt="The Olive Goose" className="w-9 h-9" width={512} height={512} />
          <div>
            <h1 className="font-serif text-base text-foreground leading-tight">The Olive Goose</h1>
            <p className="text-xs text-muted-foreground font-sans">Admin Dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors font-sans flex items-center gap-1"
          >
            View Site
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          <button
            onClick={() => { logout(); setSession(false); }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors font-sans"
          >
            Sign Out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r border-border bg-card overflow-y-auto">
          <nav className="py-4">
            {NAV_GROUPS.map((group) => {
              const isExpanded = expandedGroups.has(group.id);
              const isActiveGroup = group.items.some((i) => i.id === activeTab);
              return (
                <div key={group.id} className="mb-1">
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className={`w-full flex items-center justify-between gap-2 px-5 py-2.5 text-left font-sans text-xs font-semibold uppercase tracking-wide transition-colors ${
                      isActiveGroup ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm leading-none">{group.icon}</span>
                      {group.label}
                    </span>
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="pb-2">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => selectTab(item.id)}
                          className={`w-full flex items-center gap-3 pl-8 pr-5 py-2 text-left font-sans text-sm border-l-2 transition-colors ${
                            activeTab === item.id
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          }`}
                        >
                          <span className="text-sm leading-none">{item.icon}</span>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-8">
          {/* Data-heavy panels need the full width; form editors read better in a narrow column. */}
          <div className={`mx-auto ${WIDE_TABS.has(activeTab) ? "max-w-[1400px]" : "max-w-2xl"}`}>
            {activeTab === "shopCategories" && <ShopEditor categories={shopCategories} allProducts={content.products.items} onRefresh={loadData} saving={saving} setSaving={setSaving} onError={handleError} />}
            {activeTab === "deals"         && <DealsEditor allProducts={content.products.items} saving={saving} setSaving={setSaving} onError={handleError} />}
            {activeTab === "announcementBar" && <AnnouncementBarEditor data={content.announcementBar} onChange={update("announcementBar")} onSave={() => handleSave("announcementBar")} saving={saving} />}
            {activeTab === "momentPill"   && <MomentPillEditor   data={content.momentPill}   onChange={update("momentPill")}   onSave={() => handleSave("momentPill")}   saving={saving} />}
            {activeTab === "welcomeClub"  && <WelcomeClubEditor  data={content.welcomeClub}  onChange={update("welcomeClub")}  onSave={() => handleSave("welcomeClub")}  saving={saving} />}
            {activeTab === "navbar"       && <NavbarEditor       data={content.navbar}       onChange={update("navbar")}       onSave={() => handleSave("navbar")}       saving={saving} />}
            {activeTab === "hero"         && <HeroEditor         data={content.hero}         onChange={update("hero")}         onSave={() => handleSave("hero")}         saving={saving} />}
            {activeTab === "brandStory"   && <BrandStoryEditor   data={content.brandStory}   onChange={update("brandStory")}   onSave={() => handleSave("brandStory")}   saving={saving} />}
            {activeTab === "products"     && <ProductsEditor     data={content.products}     onChange={update("products")}     onSave={() => handleSave("products")}     saving={saving} />}
            {activeTab === "candleCare"   && <CandleCareEditor   data={content.candleCare}   onChange={update("candleCare")}   onSave={() => handleSave("candleCare")}   saving={saving} />}
            {activeTab === "videos"       && <VideosEditor       data={content.videos}       onChange={update("videos")}       onSave={() => handleSave("videos")}       saving={saving} />}
            {activeTab === "testimonials" && <TestimonialsEditor data={content.testimonials} onChange={update("testimonials")} onSave={() => handleSave("testimonials")} saving={saving} />}
            {activeTab === "newsletter"   && <NewsletterEditor   data={content.newsletter}   onChange={update("newsletter")}   onSave={() => handleSave("newsletter")}   saving={saving} />}
            {activeTab === "footer"       && <FooterEditor       data={content.footer}       onChange={update("footer")}       onSave={() => handleSave("footer")}       saving={saving} />}
            {activeTab === "returnPolicy"    && <ReturnPolicyEditor    data={content.returnPolicy}    onChange={update("returnPolicy")}    onSave={() => handleSave("returnPolicy")}    saving={saving} />}
            {activeTab === "giftCards"       && <GiftCardsEditor       data={content.giftCards}       onChange={update("giftCards")}       onSave={() => handleSave("giftCards")}       saving={saving} />}
            {activeTab === "customerService" && <CustomerServiceEditor data={content.customerService} onChange={update("customerService")} onSave={() => handleSave("customerService")} saving={saving} />}
            {activeTab === "pickupSettings"  && <PickupSettingsEditor  data={content.pickupSettings}  onChange={update("pickupSettings")}  onSave={() => handleSave("pickupSettings")}  saving={saving} />}
            {activeTab === "privacyPolicy"   && <LegalPageEditor title="Privacy Policy"   desc="Content shown on the Privacy Policy page."   data={content.privacyPolicy}  onChange={update("privacyPolicy")}  onSave={() => handleSave("privacyPolicy")}  saving={saving} />}
            {activeTab === "termsOfService"  && <LegalPageEditor title="Terms of Service" desc="Content shown on the Terms of Service page." data={content.termsOfService} onChange={update("termsOfService")} onSave={() => handleSave("termsOfService")} saving={saving} />}
            {activeTab === "shippingPolicy"  && <LegalPageEditor title="Shipping Policy"  desc="Content shown on the Shipping Policy page."  data={content.shippingPolicy} onChange={update("shippingPolicy")} onSave={() => handleSave("shippingPolicy")} saving={saving} />}
            {activeTab === "subscribers"  && <SubscribersPanel   subscribers={subscribers}   onDelete={handleDeleteSubscriber} popup={content.subscribePopup} onPopupChange={update("subscribePopup")} onPopupSave={() => handleSave("subscribePopup")} saving={saving} />}
            {activeTab === "users"        && <UsersPanel />}
            {activeTab === "feedback"     && <FeedbackPanel />}
            {activeTab === "orders"       && <OrdersPanel />}
            {activeTab === "returns"      && <ReturnsPanel />}
            {activeTab === "ops"          && <OpsPanel />}
            {activeTab === "analytics"    && <AnalyticsPanel />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
