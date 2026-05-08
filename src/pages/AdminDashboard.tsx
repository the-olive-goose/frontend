import { useEffect, useState, useCallback } from "react";
import {
  isLoggedIn,
  logout,
  getContent,
  saveContent,
  getSubscribers,
  deleteSubscriber,
  getShopCategories,
  saveShopCategory,
  deleteShopCategory,
  saveShopCandle,
  deleteShopCandle,
  SessionExpiredError,
  type Subscriber,
  type ShopCategory,
  type ShopCandle,
} from "@/lib/api";
import {
  DEFAULT_CONTENT,
  type SiteContent,
  type Product,
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
  type Product,
  type CandleCareCard,
  type VideoItem,
  type Testimonial,
  type NavLink,
  type SocialLink,
} from "@/lib/defaults";
import { useToast } from "@/hooks/use-toast";
import AdminLogin from "@/components/AdminLogin";
import logo from "@/assets/logo.jpg";

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
}) => (
  <div className="space-y-6">
    <SectionHeading title="Hero Section" desc="The full-screen banner at the top of the page." />
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
    <Field label="Background Image URL" hint="Paste a direct image URL (jpg, png, webp)">
      <Input
        placeholder="https://…"
        value={data.bg_image_url}
        onChange={(e) => onChange({ ...data, bg_image_url: e.target.value })}
      />
    </Field>
    <Field label={`Overlay Opacity: ${Math.round(data.overlay_opacity * 100)}%`}>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(data.overlay_opacity * 100)}
        onChange={(e) => onChange({ ...data, overlay_opacity: Number(e.target.value) / 100 })}
        className="w-full accent-primary"
      />
    </Field>
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
            <Field label="Price">
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
        </Card>
      ))}
      <AddButton
        label="Add product"
        onClick={() => {
          const newProduct: Product = {
            id: Date.now().toString(),
            name: "New Product",
            description: "",
            price: "$0",
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
    <Field label="Image 1 filename" hint="Filename from src/assets/ folder — e.g. hero-bg.jpg. Drop the file there first, then enter its name here.">
      <Input placeholder="hero-bg.jpg" value={data.image1_url} onChange={(e) => onChange({ ...data, image1_url: e.target.value })} />
    </Field>
    <Field label="Text 2" hint={`e.g. "Because after all,"`}>
      <Input value={data.text2} onChange={(e) => onChange({ ...data, text2: e.target.value })} />
    </Field>
    <Field label="Image 2 filename" hint="Filename from src/assets/ folder — e.g. logo.jpg. Drop the file there first, then enter its name here.">
      <Input placeholder="logo.jpg" value={data.image2_url} onChange={(e) => onChange({ ...data, image2_url: e.target.value })} />
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
      <SectionHeading title="Videos" desc="Drop .mp4 files into public/videos/ in your project, then type /videos/filename.mp4 below. Or paste a YouTube / Vimeo link." />
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
            <Field label="Video URL" hint="Local file: drop .mp4 into public/videos/ → type /videos/filename.mp4  |  Or paste a YouTube / Vimeo link">
              <Input
                placeholder="/videos/my-reel.mp4  or  https://youtube.com/watch?v=…"
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

const SubscribersPanel = ({
  subscribers,
  onDelete,
}: {
  subscribers: Subscriber[];
  onDelete: (id: string) => void;
}) => {
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

  return (
    <div className="space-y-6">
      <SectionHeading title="Subscribers" desc="Email addresses collected via the newsletter form." />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground font-sans">
          {subscribers.length} subscriber{subscribers.length !== 1 ? "s" : ""}
        </p>
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
            {subscribers.map((sub) => (
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
            {subscribers.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground font-sans">
                  No subscribers yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
  const { toast } = useToast();

  useEffect(() => { setCats(initCats); }, [initCats]);

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
              <Input value={editingCat.name ?? ""} onChange={e => setEditingCat(p => ({ ...p!, name: e.target.value }))} />
            </Field>
            <Field label="Slug" hint='e.g. "coffee-shop-chaos"'>
              <Input value={editingCat.slug ?? ""} onChange={e => setEditingCat(p => ({ ...p!, slug: e.target.value }))} />
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
  | "momentPill"
  | "welcomeClub"
  | "brandStory"
  | "products"
  | "candleCare"
  | "videos"
  | "testimonials"
  | "newsletter"
  | "footer"
  | "subscribers";

const NAV_ITEMS: { id: TabId; label: string; icon: string }[] = [
  { id: "announcementBar", label: "Announcement Bar", icon: "📢" },
  { id: "navbar",          label: "Navbar",           icon: "☰" },
  { id: "hero",            label: "Hero",             icon: "★" },
  { id: "shopCategories",  label: "Shop By Category", icon: "📖" },
  { id: "products",        label: "Products",         icon: "◈" },
  { id: "momentPill",      label: "Moment Pill",      icon: "💊" },
  { id: "welcomeClub",     label: "Welcome Club",     icon: "🫶" },
  { id: "brandStory",      label: "Brand Story",      icon: "✦" },
  { id: "candleCare",      label: "Candle Care",      icon: "♨" },
  { id: "videos",          label: "Videos",           icon: "▶" },
  { id: "testimonials",    label: "Testimonials",     icon: "❝" },
  { id: "newsletter",      label: "Newsletter",       icon: "✉" },
  { id: "footer",          label: "Footer",           icon: "⊘" },
  { id: "subscribers",     label: "Subscribers",      icon: "◉" },
];

// ── Main Dashboard ─────────────────────────────────────────────────────────────

const AdminDashboard = () => {
  const [session, setSession] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("hero");
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
    const [announcementBar, navbar, hero, momentPill, welcomeClub, brandStory, products, candleCare, videos, testimonials, newsletter, footer] =
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
      ]);
    setContent({ announcementBar, navbar, hero, momentPill, welcomeClub, brandStory, products, candleCare, videos, testimonials, newsletter, footer });

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
        <aside className="w-52 shrink-0 border-r border-border bg-card overflow-y-auto">
          <nav className="py-4">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-5 py-2.5 text-left font-sans text-sm transition-colors ${
                  activeTab === item.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <span className="text-base leading-none">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl mx-auto">
            {activeTab === "shopCategories" && <ShopEditor categories={shopCategories} allProducts={content.products.items} onRefresh={loadData} saving={saving} setSaving={setSaving} onError={handleError} />}
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
            {activeTab === "subscribers"  && <SubscribersPanel   subscribers={subscribers}   onDelete={handleDeleteSubscriber} />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
