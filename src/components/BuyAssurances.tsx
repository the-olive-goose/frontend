import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import RichText from "@/lib/richtext";
import { fillOfferTokens, resolveOfferValues, type OfferValues } from "@/lib/offerTokens";
import { DEFAULT_CONTENT, type ProductAssurancesContent } from "@/lib/defaults";
import { SkelCopy } from "@/components/ui/ContentSkeleton";

// The box's own frame, shared by the real rows and the placeholder so the two
// reserve identical space.
const SHELL: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  background: "linear-gradient(160deg, var(--color-sage-pale) 0%, var(--color-cream-card) 130%)",
};

// One emoji badge per row. Fixed rather than admin-editable: they are the row's
// icon, not its copy, and a blank one would leave the text hanging in space.
const ICONS = { shipping: "🚚", delivery: "⚡", returns: "💅" } as const;

interface Row {
  key: string;
  icon: string;
  text: string;
  detail: string;
}

/**
 * One line, with the detail it opens.
 *
 * The panel animates to a MEASURED pixel height rather than to `auto`, which is
 * not animatable. The usual substitute is a grid row transitioned from `0fr` to
 * `1fr`; a measured height is used instead because it is the version whose end
 * state can be asserted — the e2e suite opens a row and checks the detail is
 * genuinely visible, which needs a height that does not depend on how a
 * particular browser resolves a flexible track mid-transition.
 */
const AssuranceRow = ({
  row, isOpen, onToggle, panelId,
}: {
  row: Row;
  isOpen: boolean;
  onToggle: () => void;
  panelId: string;
}) => {
  const inner = useRef<HTMLDivElement>(null);
  const [detailHeight, setDetailHeight] = useState(0);
  const expandable = row.detail.trim() !== "";

  // Re-measured whenever the copy or its wrapping changes — an admin's longer
  // sentence, a rotated phone — so the panel never opens to a stale height.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    setDetailHeight(el.offsetHeight);
  }, [row.detail]);

  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setDetailHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const body = (
    <>
      {/* The bit of delight: the badge tilts and swells while its row is open,
          and leans in on hover. */}
      <span
        aria-hidden
        className="shrink-0 grid place-items-center transition-transform duration-300 group-hover:scale-110"
        style={{
          width: 30, height: 30, borderRadius: 999,
          background: isOpen ? "var(--color-gold-soft)" : "rgba(255,255,255,0.6)",
          fontSize: "0.95rem", lineHeight: 1,
          transform: isOpen ? "rotate(-10deg) scale(1.12)" : undefined,
          transitionProperty: "transform, background-color",
        }}
      >
        {row.icon}
      </span>

      <span className="flex-1 min-w-0 leading-6">
        <span className={isOpen ? "squiggle" : undefined}><RichText text={row.text} /></span>
      </span>

      {expandable && (
        <span
          aria-hidden
          className="shrink-0 grid place-items-center text-xs transition-transform duration-200"
          style={{
            width: 20, height: 20, borderRadius: 999,
            background: "rgba(29,43,27,0.07)",
            color: "var(--text-primary)",
            transform: isOpen ? "rotate(180deg)" : undefined,
          }}
        >
          ▾
        </span>
      )}
    </>
  );

  return (
    <li className="font-sans text-sm" style={{ color: "var(--text-primary)" }}>
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={panelId}
          // 44px of thumb, per the site's touch baseline.
          className="group w-full flex items-center gap-2.5 text-left px-2 py-2 min-h-11 rounded-xl
                     transition-all duration-200 hover:translate-x-0.5 active:scale-[0.99]"
          style={{ background: isOpen ? "rgba(255,255,255,0.45)" : "transparent" }}
        >
          {body}
        </button>
      ) : (
        <div className="w-full flex items-center gap-2.5 px-2 py-2 min-h-11">{body}</div>
      )}

      {expandable && (
        // `visibility` — delayed on the way out so the copy is still there while
        // the panel closes — is what takes the detail out of the page for
        // assistive tech and for anything measuring it. Clipped-but-laid-out
        // text still counts as visible without it.
        <div
          id={panelId}
          style={{
            height: isOpen ? detailHeight : 0,
            opacity: isOpen ? 1 : 0,
            visibility: isOpen ? "visible" : "hidden",
            overflow: "hidden",
            transition: `height 220ms ease-out, opacity 180ms ease-out, visibility 0s linear ${isOpen ? "0s" : "220ms"}`,
          }}
        >
          <div ref={inner}>
            <p
              className="font-sans text-xs pl-14 pr-4 pb-2.5"
              style={{ color: "var(--text-muted)", lineHeight: 1.55 }}
            >
              <RichText text={row.detail} />
            </p>
          </div>
        </div>
      )}
    </li>
  );
};

/**
 * Shipping cost, delivery time and returns, under the buy button — the three
 * questions a shopper asks in the second before they commit.
 *
 * Every line is admin copy (Content → Shop Page → Product Page). The shipping
 * line runs through fillOfferTokens so `{shipping_cost}` / `{shipping_rate}`
 * resolve against the live Pickup & Delivery settings: the figure read here is
 * the figure checkout charges, and it stays right when an admin moves the bar.
 *
 * Each row can carry a second line of detail, and rows that have one open on tap
 * — the headline stays scannable while the reassurance is a thumb away. Rows
 * without detail render as plain text, not as a button that does nothing, so an
 * admin who leaves the field blank gets an honest control. Empty headline copy
 * drops its row entirely rather than leaving an orphan badge.
 *
 * Every animation here is a CSS transition, so the site's global
 * prefers-reduced-motion rule already flattens all of it for visitors who ask.
 */
const BuyAssurances = ({
  data,
  offer,
}: {
  data: ProductAssurancesContent;
  offer: OfferValues;
}) => {
  // One open at a time — an accordion reads as deliberate where three
  // independently open panels read as a page coming apart.
  const [open, setOpen] = useState<string | null>(null);
  const baseId = useId();

  const rows = [
    { key: "shipping", text: data.shipping_text, detail: data.shipping_detail },
    { key: "delivery", text: data.delivery_text, detail: data.delivery_detail },
    { key: "returns",  text: data.returns_text,  detail: data.returns_detail },
  ]
    .map(r => ({
      ...r,
      icon: ICONS[r.key as keyof typeof ICONS],
      text: fillOfferTokens(r.text, offer),
      detail: fillOfferTokens(r.detail, offer),
    }))
    .filter(r => r.text.trim() !== "");

  if (!data.enabled || rows.length === 0) return null;

  return (
    <ul className="mt-4 flex flex-col px-2 py-2" style={SHELL}>
      {rows.map(row => (
        <AssuranceRow
          key={row.key}
          row={row}
          isOpen={open === row.key}
          onToggle={() => setOpen(open === row.key ? null : row.key)}
          panelId={`${baseId}-${row.key}`}
        />
      ))}
    </ul>
  );
};

/**
 * The box's placeholder, while the product page's content is still loading.
 *
 * Sized by laying out the bundled default copy invisibly rather than by a fixed
 * height: the shipping line wraps to two lines on a phone and one on a desktop,
 * so a single px value would under-reserve on mobile and everything below would
 * jump when the real lines land. Only the collapsed rows are reserved — opening
 * one is the shopper's own doing, which costs no layout-shift score.
 */
export const BuyAssurancesSkeleton = () => {
  const copy = DEFAULT_CONTENT.productPage.assurances;
  // Resolved against the bundled settings purely for length — the text is laid
  // out invisibly, never painted, and the token on its own ("{shipping_cost}")
  // is far shorter than the sentence it becomes.
  const offer = resolveOfferValues(
    DEFAULT_CONTENT.pickupSettings, DEFAULT_CONTENT.subscribePopup, DEFAULT_CONTENT.returnPolicy);
  return (
    <div className="mt-4 flex flex-col px-2 py-2" style={SHELL} aria-hidden>
      {[copy.shipping_text, copy.delivery_text, copy.returns_text].map((text, i) => (
        // Same row shape as the real line — badge, gap, copy — so the
        // placeholder wraps where the sentence will.
        <div key={i} className="font-sans text-sm flex items-center gap-2.5 px-2 py-2 min-h-11">
          <span className="shrink-0" style={{ width: 30, height: 30 }} />
          <SkelCopy lineHeight={24 / 14} style={{ display: "block", flex: 1, lineHeight: "1.5rem" }}>
            {fillOfferTokens(text, offer)}
          </SkelCopy>
        </div>
      ))}
    </div>
  );
};

export default BuyAssurances;
