import { useEffect, useState, useCallback, useRef, useMemo, Fragment } from "react";
import {
  isLoggedIn,
  logout,
  getContent,
  saveContent,
  uploadImage,
  getSubscribers,
  deleteSubscriber,
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
  type LegalPageContent,
  type CandleCareCard,
  type VideoItem,
  type Testimonial,
  type NavLink,
  type SocialLink,
} from "@/lib/defaults";
import { useToast } from "@/hooks/use-toast";
import AdminLogin from "@/components/AdminLogin";
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
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      onChange({ ...data, bg_image_url: url });
      toast({ title: "Image uploaded!" });
    } catch {
      toast({ title: "Upload failed", description: "Check file type (jpg/png/webp) and size (max 20 MB)", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

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

      {/* Background image — upload or URL */}
      <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
        <p className="font-sans text-sm font-semibold text-foreground">Background Image</p>

        {/* Live preview */}
        {data.bg_image_url && (
          <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: "16/5" }}>
            <img src={data.bg_image_url} alt="Hero background preview"
              className="w-full h-full object-cover"
              style={{ opacity: data.overlay_opacity ?? 0.55 }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-sans text-xs text-white bg-black/50 px-2 py-1 rounded">
                Preview at {Math.round((data.overlay_opacity ?? 0.55) * 100)}% opacity
              </span>
            </div>
          </div>
        )}

        {/* Upload button */}
        <div className="flex gap-3 items-center">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-sans text-sm font-medium hover:bg-primary/5 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Uploading…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                </svg>
                Upload image
              </>
            )}
          </button>
          <span className="font-sans text-xs text-muted-foreground">or paste a URL below</span>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </div>

        <Field label="Image URL" hint="Direct URL to jpg, png, or webp image">
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
};

const OrderDetailPanel = ({ order, onUpdate }: { order: AdminOrderRecord; onUpdate: (o: AdminOrderRecord) => void }) => {
  const [detail, setDetail] = useState<(AdminOrderRecord & { timeline: OrderTimelineEvent[]; refund_reminders: RefundReminder[] }) | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decisionNote, setDecisionNote] = useState("");
  const [markingRefund, setMarkingRefund] = useState(false);
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
// Aggregated by customer: one table per customer, one row per order. Tracking
// status is admin-controlled here — it never advances on its own server-side.

const OrdersPanel = () => {
  const [items, setItems] = useState<AdminOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback((showSpinner = true) => {
    if (showSpinner) setLoading(true);
    return getAdminOrders().then(o => setItems(o)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    // New orders come from customers placing them elsewhere — poll so they
    // show up here without the admin needing to leave and reopen this tab.
    const interval = setInterval(() => load(false), 15000);
    return () => clearInterval(interval);
  }, [load]);

  const currency = (n: string | number) => `€${Number(n).toFixed(2)}`;

  const customers = useMemo(() => {
    const byUser = new Map<string, { name: string; email: string; orders: AdminOrderRecord[] }>();
    for (const o of items) {
      if (!byUser.has(o.user_id)) byUser.set(o.user_id, { name: o.user_name || o.user_email, email: o.user_email, orders: [] });
      byUser.get(o.user_id)!.orders.push(o);
    }
    return Array.from(byUser.values());
  }, [items]);

  const handleStatusChange = async (order: AdminOrderRecord, status: string) => {
    setSavingId(order.id);
    try {
      const updated = await updateOrderStatus(order.id, status);
      setItems(prev => prev.map(o => o.id === order.id ? updated : o));
      toast({ title: "Tracking updated" });
    } catch {
      toast({ title: "Could not update tracking", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading title="Orders" desc="All orders placed by customers, grouped by customer. Update a delivery/pickup tracking status here." />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground font-sans">
          {items.length} order{items.length !== 1 ? "s" : ""} · {customers.length} customer{customers.length !== 1 ? "s" : ""}
        </p>
        <button onClick={() => load()}
          className="font-sans text-xs font-medium text-primary hover:underline shrink-0">
          Refresh
        </button>
      </div>
      {loading && <p className="text-sm text-muted-foreground font-sans">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted-foreground font-sans">No orders yet.</p>}

      <div className="space-y-6">
        {customers.map(c => (
          <div key={c.email} className="border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-sans text-sm font-semibold text-foreground">{c.name}</p>
                <p className="font-sans text-xs text-muted-foreground">{c.email}</p>
              </div>
              <span className="font-sans text-xs text-muted-foreground shrink-0">
                {c.orders.length} order{c.orders.length !== 1 ? "s" : ""}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/10">
                  <th className="text-left px-4 py-2 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Order #</th>
                  <th className="text-left px-4 py-2 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-2 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Total</th>
                  <th className="text-left px-4 py-2 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Payment</th>
                  <th className="text-left px-4 py-2 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Tracking status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {c.orders.map(o => (
                  <Fragment key={o.id}>
                    <tr className="border-t border-border hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-sans font-medium text-foreground whitespace-nowrap">
                        {o.tracking_number}
                        {o.cancellation_status === "requested" && (
                          <span className="block font-sans text-[10px] font-semibold mt-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 w-fit">
                            Cancellation pending
                          </span>
                        )}
                        {o.refund_status === "pending" && (
                          <span className="block font-sans text-[10px] font-semibold mt-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 w-fit">
                            Refund owed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-sans text-muted-foreground whitespace-nowrap">{new Date(o.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 font-sans capitalize text-muted-foreground">{o.fulfillment_type}</td>
                      <td className="px-4 py-3 font-sans text-foreground whitespace-nowrap">
                        {currency(o.total)}
                        {Number(o.discount_percent) > 0 && (
                          <span className="text-muted-foreground text-xs"> ({o.discount_percent}% off)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`font-sans text-xs font-medium px-2 py-0.5 rounded-full ${
                          o.payment_status === "paid" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                        }`}>
                          {o.payment_status === "paid" ? "Paid" : o.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={o.status}
                          disabled={savingId === o.id}
                          onChange={e => handleStatusChange(o, e.target.value)}
                          className="px-2 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                        >
                          {ORDER_STAGES[o.fulfillment_type].map(stage => (
                            <option key={stage} value={stage}>{stage}</option>
                          ))}
                        </select>
                        <LastNotified title={o.last_notification_title} at={o.last_notification_at} />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => setExpandedId(p => p === o.id ? null : o.id)}
                          className="font-sans text-xs text-primary hover:underline"
                        >
                          {expandedId === o.id ? "Hide details" : "View details"}
                        </button>
                      </td>
                    </tr>
                    {expandedId === o.id && (
                      <tr className="border-t border-border bg-muted/10">
                        <td colSpan={7} className="px-4 py-4">
                          <OrderDetailPanel order={o} onUpdate={(updated) => setItems(prev => prev.map(x => x.id === updated.id ? updated : x))} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
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
      toast({ title: "Return updated — customer notified" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
  };

  const STATUS_OPTIONS: AdminReturnRecord["status"][] = ["requested", "approved", "rejected", "refunded"];

  return (
    <div className="space-y-6">
      <SectionHeading title="Returns & Refunds" desc="Customer return requests submitted from the Returns & Refunds page." />
      <p className="text-sm text-muted-foreground font-sans">{items.length} request{items.length !== 1 ? "s" : ""}</p>
      {loading && <p className="text-sm text-muted-foreground font-sans">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted-foreground font-sans">No return requests yet.</p>}
      <div className="space-y-4">
        {items.map(r => (
          <div key={r.id} className="rounded-xl border border-border bg-card p-5 space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-sans text-sm font-semibold text-foreground">{r.product_name}</span>
                  <span className="font-sans text-xs text-muted-foreground">{r.user_name || r.user_email}</span>
                </div>
                <p className="font-sans text-sm text-foreground leading-relaxed">{r.reason}</p>
                <p className="font-sans text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
                {refundDueFor(r.id) && (
                  <span className="inline-block font-sans text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                    Refund due — {refundDueFor(r.id)!.days_elapsed}d since approved
                  </span>
                )}
              </div>
              <div className="shrink-0 text-right">
                <select
                  value={r.status}
                  disabled={r.status === "refunded"}
                  onChange={(e) => handleStatusChange(r.id, e.target.value as AdminReturnRecord["status"])}
                  className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs capitalize disabled:opacity-60 disabled:cursor-not-allowed"
                  title={r.status === "refunded" ? "Refunded is final — this can't be changed further." : undefined}
                >
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <LastNotified title={r.last_notification_title} at={r.last_notification_at} />
              </div>
            </div>
          </div>
        ))}
      </div>
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

// ── Signed Up Users panel ─────────────────────────────────────────────────────

const UsersPanel = () => {
  const [users, setUsers] = useState<AppUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getAdminUsers().then(u => { setUsers(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  return (
    <div className="space-y-6">
      <SectionHeading title="Signed Up Users" desc="All users who have registered via email or OAuth." />
      <p className="text-sm text-muted-foreground font-sans">{users.length} user{users.length !== 1 ? "s" : ""} registered</p>
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
            {users.map(u => (
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

  return (
    <div className="space-y-6">
      <SectionHeading title="Customer Feedback" desc="Reviews and feedback submitted by customers on the homepage." />
      <p className="text-sm text-muted-foreground font-sans">{items.length} review{items.length !== 1 ? "s" : ""}</p>
      {loading && <p className="text-sm text-muted-foreground font-sans">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted-foreground font-sans">No feedback yet.</p>}
      <div className="space-y-4">
        {items.map(f => (
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
  | "ops";

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
      { id: "brandStory",      label: "Brand Story",      icon: "✦" },
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
      { id: "pickupSettings",  label: "Pickup & Delivery", icon: "🏬" },
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
      { id: "subscribers", label: "Subscribers",       icon: "◉" },
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
    ],
  },
];

const groupIdForTab = (tab: TabId): string =>
  NAV_GROUPS.find((g) => g.items.some((i) => i.id === tab))?.id ?? NAV_GROUPS[0].id;

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
    const [announcementBar, navbar, hero, momentPill, welcomeClub, brandStory, products, candleCare, videos, testimonials, newsletter, footer, returnPolicy, giftCards, customerService, pickupSettings, privacyPolicy, termsOfService, shippingPolicy] =
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
        getContent("privacyPolicy",   DEFAULT_CONTENT.privacyPolicy),
        getContent("termsOfService",  DEFAULT_CONTENT.termsOfService),
        getContent("shippingPolicy",  DEFAULT_CONTENT.shippingPolicy),
      ]);
    setContent({ announcementBar, navbar, hero, momentPill, welcomeClub, brandStory, products, candleCare, videos, testimonials, newsletter, footer, returnPolicy, giftCards, customerService, pickupSettings, privacyPolicy, termsOfService, shippingPolicy });

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
          <div className="max-w-2xl mx-auto">
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
            {activeTab === "subscribers"  && <SubscribersPanel   subscribers={subscribers}   onDelete={handleDeleteSubscriber} />}
            {activeTab === "users"        && <UsersPanel />}
            {activeTab === "feedback"     && <FeedbackPanel />}
            {activeTab === "orders"       && <OrdersPanel />}
            {activeTab === "returns"      && <ReturnsPanel />}
            {activeTab === "ops"          && <OpsPanel />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
