import { useMemo, useState } from "react";
import type { ProductFeedContent, Product, PickupSettingsContent } from "@/lib/defaults";
import { partitionFeedProducts, feedPriceValue } from "@/lib/productFeed";
import { probeAll, probeImage } from "@/lib/imageProbe";
import {
  feedImageIssue, feedImageRefs, summariseImageChecks, type FeedImageCheck,
} from "@/lib/feedImageChecks";

// Admin → Ops → Product Feed.
//
// The feed document itself is built by the API (backend/productFeed.js) and
// served at /feed.xml; this panel is only the settings and a preview of what
// that document will contain. The preview's inclusion rules live in
// src/lib/productFeed.ts, which productFeed.test.ts pins to the backend's
// copy — a preview that disagrees with the feed is worse than no preview,
// because the disagreement surfaces days later as a disapproved product with an
// unhelpful reason.

const Card = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="font-sans text-sm font-semibold text-foreground">{title}</p>
    {desc && <p className="font-sans text-xs text-muted-foreground mt-0.5">{desc}</p>}
    <div className="mt-3">{children}</div>
  </div>
);

const Switch = ({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) => (
  <label className="flex items-start gap-3 cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="accent-primary mt-0.5 w-4 h-4 shrink-0"
    />
    <span className="min-w-0">
      <span className="block font-sans text-sm text-foreground">{label}</span>
      {hint && <span className="block font-sans text-xs text-muted-foreground mt-0.5">{hint}</span>}
    </span>
  </label>
);

const TextInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${props.className ?? ""}`}
  />
);

const Labelled = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label className="block text-sm font-sans font-medium text-foreground">{label}</label>
    {children}
    {hint && <p className="text-xs text-muted-foreground font-sans">{hint}</p>}
  </div>
);

const FEED_PATH = "/feed.xml";

const ProductFeedPanel = ({ data, products, pickup, siteName, onChange, onSave, saving }: {
  data: ProductFeedContent;
  products: Product[];
  pickup: PickupSettingsContent;
  siteName: string;
  onChange: (next: ProductFeedContent) => void;
  onSave: () => void;
  saving: boolean;
}) => {
  const set = <K extends keyof ProductFeedContent>(key: K, value: ProductFeedContent[K]) =>
    onChange({ ...data, [key]: value });

  const { included, excluded } = useMemo(
    () => partitionFeedProducts(products, data),
    [products, data],
  );

  // ── Image pre-flight ───────────────────────────────────────────────────────
  // On demand, never automatic: it loads every image in the feed, which is real
  // bandwidth and slow on a cold CDN. The feed itself cannot do this — it would
  // mean a dozen network calls every time a crawler asks for the document — so
  // this is the one place the shop can find out that a well-formed URL is dead
  // before a platform finds out for them, days later, as a disapproval.
  const [checks, setChecks] = useState<FeedImageCheck[] | null>(null);
  const [checking, setChecking] = useState(false);

  const runImageCheck = async () => {
    setChecking(true);
    setChecks(null);
    try {
      const refs = feedImageRefs(included, data.include_gallery_images);
      const results = await probeAll(refs, async (ref) => {
        const probe = await probeImage(ref.url);
        return { ...ref, probe, issue: feedImageIssue(probe) };
      });
      setChecks(results);
    } finally {
      setChecking(false);
    }
  };

  const summary = checks ? summariseImageChecks(checks) : null;

  const feedUrl = `${typeof window !== "undefined" ? window.location.origin : ""}${FEED_PATH}`;
  const brand = data.brand.trim() || siteName;
  const flat = Number(pickup?.flat_shipping_rate);
  const threshold = Number(pickup?.free_shipping_threshold);

  return (
    <div className="space-y-6">
      <div className="mb-2 pb-4 border-b border-border">
        <h2 className="font-serif text-2xl text-foreground">Product Feed</h2>
        <p className="font-sans text-sm text-muted-foreground mt-1">
          A list of your products in the format Google and Meta read to build
          their shopping catalogues. It updates itself from this admin — change a
          price here and the ad platforms pick it up on their next visit. Off
          until you turn it on.
        </p>
      </div>

      <Card
        title="Turn the feed on"
        desc="While this is off the address returns nothing, which is the right state until your prices and photos are final — the platforms cache the first version they fetch and are slow to re-review it."
      >
        <div className="space-y-4">
          <Switch
            checked={data.enabled}
            onChange={(v) => set("enabled", v)}
            label="Publish the product feed"
            hint={`${included.length} of ${products.length} products would be sent.`}
          />
          {data.enabled && (
            <div className="rounded-lg border border-border bg-background p-3 space-y-1.5">
              <p className="font-sans text-xs text-muted-foreground">Paste this address into Google Merchant Center and Meta Commerce Manager:</p>
              <code className="block font-mono text-xs text-foreground break-all">{feedUrl}</code>
              <a
                href={FEED_PATH}
                target="_blank"
                rel="noreferrer"
                className="inline-block font-sans text-xs text-primary hover:underline"
              >
                Open the feed to check it →
              </a>
            </div>
          )}
        </div>
      </Card>

      <Card title="What gets sent" desc="Worked out from your catalogue using the same rules the feed itself uses.">
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {included.map((p) => (
              <li key={p.id} className="flex items-start gap-2 font-sans text-sm">
                <span aria-hidden className="font-semibold shrink-0 w-4 text-center" style={{ color: "#0ca30c" }}>✓</span>
                <span className="min-w-0 text-foreground">
                  {p.name}
                  <span className="text-muted-foreground"> — €{feedPriceValue(p.price).toFixed(2)}</span>
                </span>
              </li>
            ))}
            {excluded.map(({ product, reason }) => (
              <li key={product.id} className="flex items-start gap-2 font-sans text-sm">
                <span aria-hidden className="font-semibold shrink-0 w-4 text-center" style={{ color: "#b26a00" }}>!</span>
                <span className="min-w-0 text-foreground">
                  {product.name || <em>Unnamed product</em>}
                  <span className="text-muted-foreground"> — left out: {reason.toLowerCase()}</span>
                </span>
              </li>
            ))}
          </ul>
          {products.length === 0 && (
            <p className="font-sans text-sm text-muted-foreground">No products in the catalogue yet.</p>
          )}
        </div>
      </Card>

      <Card
        title="Check the images"
        desc="Loads every photo the feed sends and reports the ones an ad platform would reject. Worth doing before you submit the feed, and again after changing a product photo."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runImageCheck}
              disabled={checking || included.length === 0}
              className="px-4 py-2 rounded-lg font-sans text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50"
            >
              {checking ? "Checking…" : "Check images"}
            </button>
            {included.length === 0 && (
              <span className="font-sans text-xs text-muted-foreground">
                No products are going into the feed yet.
              </span>
            )}
            {summary && !checking && (
              <span className="font-sans text-sm text-foreground">
                {summary.errors === 0 && summary.warnings === 0
                  ? `All ${summary.total} images are fine.`
                  : `Of ${summary.total} images: ` + [
                      summary.errors > 0 ? `${summary.errors} would be rejected` : "",
                      summary.warnings > 0 ? `${summary.warnings} could be sharper` : "",
                    ].filter(Boolean).join(", ") + "."}
              </span>
            )}
          </div>

          {checking && (
            <p className="font-sans text-sm text-muted-foreground">
              Loading each photo — this can take a moment on a slow connection.
            </p>
          )}

          {checks && !checking && (
            <ul className="space-y-2">
              {checks.map((check, i) => (
                <li key={`${check.productId}-${i}`} className="flex items-start gap-2 font-sans text-sm">
                  <span
                    aria-hidden
                    className="font-semibold shrink-0 w-4 text-center"
                    style={{ color: check.issue?.level === "error" ? "#c0392b" : check.issue ? "#b26a00" : "#0ca30c" }}
                  >
                    {check.issue?.level === "error" ? "✕" : check.issue ? "!" : "✓"}
                  </span>
                  <span className="min-w-0">
                    <span className="text-foreground">{check.productName}</span>
                    <span className="text-muted-foreground">
                      {" "}— {check.primary ? "main photo" : "extra photo"}
                      {check.probe.ok && ` · ${check.probe.width}×${check.probe.height}`}
                    </span>
                    {check.issue && (
                      <span className="block text-muted-foreground">{check.issue.message}</span>
                    )}
                    <span className="block font-mono text-[11px] text-muted-foreground break-all">
                      {check.url}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="font-sans text-xs text-muted-foreground">
            Meta is the stricter of the two: it needs at least 500×500 and prefers 1024×1024, where
            Google would accept far smaller. Passing here means passing both.
          </p>
        </div>
      </Card>

      <Card title="How your products are described" desc="These apply to every product in the feed.">
        <div className="space-y-4">
          <Labelled
            label="Brand"
            hint={`Blank uses your site name — currently "${siteName}".`}
          >
            <TextInput
              value={data.brand}
              placeholder={siteName}
              onChange={(e) => set("brand", e.target.value)}
            />
          </Labelled>

          <Labelled
            label="Google product category"
            hint="Google's own list of categories. Getting this right is what puts your candles in front of people shopping for candles rather than for homeware in general. Paste either the full path or its number from Google's product taxonomy."
          >
            <TextInput
              value={data.google_product_category}
              placeholder="Home & Garden > Decor > Home Fragrances > Candles"
              onChange={(e) => set("google_product_category", e.target.value)}
            />
          </Labelled>

          <Labelled
            label="Your own product type (optional)"
            hint='Your grouping, not Google&apos;s — useful later for splitting campaigns. e.g. "Café Collection".'
          >
            <TextInput
              value={data.product_type}
              placeholder="Café Collection"
              onChange={(e) => set("product_type", e.target.value)}
            />
          </Labelled>

          <Labelled
            label="Campaign label (optional)"
            hint="A free-text tag sent with every product, so you can target or report on this feed separately inside the ad platforms."
          >
            <TextInput
              value={data.custom_label_0}
              placeholder="core-range"
              onChange={(e) => set("custom_label_0", e.target.value)}
            />
          </Labelled>

          <Labelled label="Condition" hint="Handmade stock is always new.">
            <select
              value={data.condition}
              onChange={(e) => set("condition", e.target.value as ProductFeedContent["condition"])}
              className="w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="new">New</option>
              <option value="refurbished">Refurbished</option>
              <option value="used">Used</option>
            </select>
          </Labelled>
        </div>
      </Card>

      <Card title="Barcodes and stock">
        <div className="space-y-4">
          <Switch
            checked={data.identifier_exists}
            onChange={(v) => set("identifier_exists", v)}
            label="These products have barcodes (GTIN) or manufacturer part numbers"
            hint="Leave this OFF for handmade candles. Off tells Google the products genuinely have no barcode, which is what stops it rejecting the whole feed for missing one. Only turn it on once you actually have barcodes to send."
          />
          <Switch
            checked={data.include_out_of_stock}
            onChange={(v) => set("include_out_of_stock", v)}
            label="Keep sold-out products in the feed, marked out of stock"
            hint="Recommended. Removing and re-adding a product resets everything the platforms have learned about it; marking it out of stock does not."
          />
          <Switch
            checked={data.include_gallery_images}
            onChange={(v) => set("include_gallery_images", v)}
            label="Send gallery photos as extra images"
            hint="Up to ten per product. Only full https:// addresses are sent — anything else is skipped rather than risking a rejection."
          />
        </div>
      </Card>

      <Card
        title="How long you take to make it"
        desc="You pour each candle after the order comes in, so the parcel doesn't leave the day it's bought. This is where you say so."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <Labelled label="Fastest (working days)" hint="Best case, order to parcel leaving.">
              <TextInput
                type="number"
                min={0}
                max={30}
                value={String(data.min_handling_time ?? 0)}
                onChange={(e) => set("min_handling_time", Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                className="max-w-[7rem]"
              />
            </Labelled>
            <Labelled label="Slowest (working days)" hint="Worst case. Be honest — this is the promise.">
              <TextInput
                type="number"
                min={0}
                max={30}
                value={String(data.max_handling_time ?? 0)}
                onChange={(e) => set("max_handling_time", Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                className="max-w-[7rem]"
              />
            </Labelled>
          </div>
          <div className="rounded-lg border border-border bg-background p-3 space-y-2">
            <p className="font-sans text-xs text-muted-foreground">
              Google prints an estimated delivery date in the ad itself. Left at zero it assumes you
              post the same day and advertises a date you can&apos;t meet — which annoys customers
              before they click, and counts against you afterwards, because Google checks promised
              dates against what actually happens.
            </p>
            <p className="font-sans text-xs text-muted-foreground">
              Your products stay listed as <strong className="text-foreground">in stock</strong>, which is
              right: you can take the order. Making time is a separate thing from having none left, and
              telling Google you&apos;re out of stock — or on preorder — would just hide your ads.
            </p>
            {(data.min_handling_time ?? 0) > 0 && (data.max_handling_time ?? 0) > 0 && (
              <p className="font-sans text-xs text-foreground">
                Ads will say the parcel leaves in{" "}
                {data.min_handling_time === data.max_handling_time
                  ? `${data.min_handling_time} working day${data.min_handling_time === 1 ? "" : "s"}`
                  : `${Math.min(data.min_handling_time, data.max_handling_time)}–${Math.max(data.min_handling_time, data.max_handling_time)} working days`}
                , then the courier&apos;s own time on top.
              </p>
            )}
            {((data.min_handling_time ?? 0) === 0 || (data.max_handling_time ?? 0) === 0) && (
              <p className="font-sans text-xs" style={{ color: "#b26a00" }}>
                Nothing is being declared, so Google will assume you post the same day. Set both.
              </p>
            )}
            <p className="font-sans text-xs text-muted-foreground">
              Keep this honest against the delivery line on your product pages
              (Shop Page → Product Page → the “at your door in…” text). Google reads both and a feed
              that promises faster than the website is the kind of contradiction it acts on.
            </p>
          </div>
        </div>
      </Card>

      <Card
        title="Shipping"
        desc="Taken from Pickup & Delivery so the feed can never quote a rate your shipping page contradicts. Change it there."
      >
        <div className="space-y-4">
          <Labelled label="Country the rate applies to" hint="Two-letter code, e.g. IE for Ireland.">
            <TextInput
              value={data.shipping_country}
              maxLength={2}
              onChange={(e) => set("shipping_country", e.target.value.toUpperCase().slice(0, 2))}
              className="max-w-[6rem]"
            />
          </Labelled>
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="font-sans text-xs text-muted-foreground">
              {Number.isFinite(flat) ? (
                <>
                  Every product is listed with <strong className="text-foreground">€{flat.toFixed(2)}</strong> shipping
                  {Number.isFinite(threshold) && threshold > 0 && (
                    <> — except any priced at €{threshold.toFixed(2)} or more, which is listed as free.</>
                  )}
                  {" "}Google asks what one item costs to deliver on its own, so your free-shipping
                  threshold only applies to a product that clears it by itself.
                </>
              ) : (
                <>No shipping rate is set in Pickup &amp; Delivery, so no shipping cost will be sent.</>
              )}
            </p>
          </div>
        </div>
      </Card>

      <Card title="What happens next">
        <ol className="space-y-2 font-sans text-sm text-foreground list-decimal pl-4">
          <li>Turn the feed on above and save.</li>
          <li>
            In Google Merchant Center, go to <strong>Products → Feeds → Add feed</strong>,
            choose <strong>Scheduled fetch</strong>, and paste the address shown above.
            Set it to fetch daily.
          </li>
          <li>
            In Meta Commerce Manager, go to <strong>Catalogue → Data sources → Add
            items → Scheduled feed</strong> and paste the same address.
          </li>
          <li>
            Both take a day or two to review the products the first time. Anything
            rejected shows up in their diagnostics with the product id from this
            catalogue.
          </li>
        </ol>
        <p className="font-sans text-xs text-muted-foreground mt-3">
          Products are sent as “{brand}”. The feed lives at a fixed address, so
          you only ever paste it once — the contents change on their own.
        </p>
      </Card>

      <button
        onClick={onSave}
        disabled={saving}
        className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium hover:bg-olive-light transition-all disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );
};

export default ProductFeedPanel;
