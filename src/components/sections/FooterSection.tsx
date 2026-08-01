import React from "react";
import type { ReactElement } from "react";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { useContent } from "@/hooks/useContent";
import { SkelText } from "@/components/ui/ContentSkeleton";

// ── Social icons ─────────────────────────────────────────────────────────────
const SocialIcon = ({ platform, href }: { platform: string; href: string }) => {
  const icons: Record<string, ReactElement> = {
    Instagram: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    TikTok: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.73a4.85 4.85 0 0 1-1.01-.04z"/>
      </svg>
    ),
  };

  return (
    // The glyph stays 20px; the link around it is finger-sized.
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="transition-opacity hover:opacity-60 inline-flex items-center justify-center"
      style={{ color: "var(--text-primary)", minWidth: 44, minHeight: 44 }} aria-label={platform}>
      {icons[platform] ?? <span className="font-sans text-sm">{platform}</span>}
    </a>
  );
};

// ── Payment method badges ─────────────────────────────────────────────────────
const PaymentBadge = ({ label, children }: { label: string; children: ReactElement }) => (
  <span
    title={label}
    className="inline-flex items-center justify-center"
    style={{
      width: 46, height: 30,
      borderRadius: "var(--radius-payment)",
      border: "1px solid var(--color-border)",
      background: "var(--color-white)",
      overflow: "hidden", flexShrink: 0,
    }}
  >
    {children}
  </span>
);

// Mirrors the methods enabled in the Stripe Dashboard (Settings → Payment methods),
// which are what Checkout actually offers now that the backend uses dynamic payment
// methods. Card brands (Visa/Mastercard/Amex) stand in for "Cards"; the rest are the
// wallets toggled on (Amazon Pay, Apple Pay, Google Pay, Link, Revolut Pay).
// Fixed columns instead of flex-wrap: 8 badges wrap into a ragged last row at some
// widths, so the rows are pinned to even counts — 2×4 on phones, a single row of 8
// from sm up (8×46px + gaps ≈ 424px, comfortable at 640px).
const PaymentIcons = () => (
  <div className="mx-auto grid w-fit grid-cols-4 items-center justify-items-center gap-2 sm:grid-cols-8">
    {/* Visa */}
    <PaymentBadge label="Visa">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <text x="23" y="21" textAnchor="middle" fill="#1A1F71" fontSize="14" fontWeight="bold" fontFamily="Arial" fontStyle="italic">VISA</text>
      </svg>
    </PaymentBadge>
    {/* Mastercard */}
    <PaymentBadge label="Mastercard">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <circle cx="18" cy="15" r="9" fill="#EB001B"/>
        <circle cx="28" cy="15" r="9" fill="#F79E1B"/>
        <path d="M23 8.5a9 9 0 0 1 0 13A9 9 0 0 1 23 8.5z" fill="#FF5F00"/>
      </svg>
    </PaymentBadge>
    {/* Amex */}
    <PaymentBadge label="American Express">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#2557D6"/>
        <text x="23" y="20" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" fontFamily="Arial">AMEX</text>
      </svg>
    </PaymentBadge>
    {/* Apple Pay */}
    <PaymentBadge label="Apple Pay">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <g transform="translate(7,9) scale(0.5)" fill="#000">
          <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.635 0 2.928.06 4.42 2.16-.113.07-2.612 1.53-2.612 4.57 0 3.56 3.11 4.83 3.157 4.83z"/>
        </g>
        <text x="21" y="20" fill="#000" fontSize="10" fontWeight="600" fontFamily="Arial">Pay</text>
      </svg>
    </PaymentBadge>
    {/* Google Pay */}
    <PaymentBadge label="Google Pay">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <text x="23" y="20" textAnchor="middle" fontSize="12" fontWeight="700" fontFamily="Arial">
          <tspan fill="#4285F4">G</tspan><tspan fill="#5F6368"> Pay</tspan>
        </text>
      </svg>
    </PaymentBadge>
    {/* Amazon Pay */}
    <PaymentBadge label="Amazon Pay">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <text x="23" y="14" textAnchor="middle" fill="#232F3E" fontSize="8.5" fontWeight="700" fontFamily="Arial">amazon</text>
        <text x="23" y="24" textAnchor="middle" fill="#F90" fontSize="8" fontWeight="700" fontFamily="Arial">pay</text>
      </svg>
    </PaymentBadge>
    {/* Revolut Pay */}
    <PaymentBadge label="Revolut Pay">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#191C1F"/>
        <text x="23" y="19" textAnchor="middle" fill="#fff" fontSize="8.5" fontWeight="700" fontFamily="Georgia, serif">Revolut</text>
      </svg>
    </PaymentBadge>
    {/* Link */}
    <PaymentBadge label="Link">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#33DDB3"/>
        <text x="23" y="20" textAnchor="middle" fill="#011E0F" fontSize="11" fontWeight="700" fontFamily="Arial">link</text>
      </svg>
    </PaymentBadge>
  </div>
);

// ── Main footer ───────────────────────────────────────────────────────────────
/**
 * Loads its own copy. Every page used to pass it in, and half of them passed the
 * bundled DEFAULT_CONTENT.footer with no fetch at all — so the account, orders
 * and legal pages showed placeholder quick links and a placeholder copyright
 * permanently, while the pages that did fetch flashed the same placeholders on
 * the way to the real thing. Owning the fetch here means there is exactly one
 * footer, and it is always the admin's.
 */
const FooterSection = () => {
  const { data, ready } = useContent("footer", DEFAULT_CONTENT.footer);
  const links = ready ? (data.links ?? []) : [];
  const socialLinks = ready ? (data.social_links ?? []) : [];
  const policyLinks = ready ? (data.policy_links ?? []) : [];

  return (
    <footer>
      {/* ── Quick Links ──────────────────────────────────────── */}
      <div className="w-full py-12 px-6" style={{ background: "var(--bg-footer)" }}>
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h3
            className="h-rounded"
            style={{ fontSize: "1.3rem", color: "var(--text-primary)" }}
          >
            Quick links
          </h3>
          {/* Each link gets a 44px-tall row so it can be tapped reliably —
              type size and the wrapped layout are unchanged. */}
          {!ready && (
            <nav className="flex flex-wrap items-center justify-center gap-x-8" style={{ color: "var(--text-primary)" }}>
              {[0, 1, 2, 3].map(i => (
                <span key={i} className="inline-flex items-center min-h-11 px-1">
                  <SkelText width={i % 2 ? "92px" : "76px"} style={{ fontSize: "0.875rem" }} />
                </span>
              ))}
            </nav>
          )}
          {links.length > 0 && (
            <nav className="flex flex-wrap items-center justify-center gap-x-8">
              {links.map((link, i) => (
                <a
                  key={i}
                  href={link.href}
                  className="font-sans text-sm transition-opacity hover:opacity-60 inline-flex items-center min-h-11 px-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  {link.label}
                </a>
              ))}
            </nav>
          )}
          {socialLinks.length > 0 && (
            <div className="flex items-center justify-center gap-6 pt-2">
              {socialLinks.map((social, i) => (
                <SocialIcon key={i} platform={social.platform} href={social.href} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Payment icons ────────────────────────────────────── */}
      <div
        className="w-full py-6 px-6 border-t"
        style={{ background: "var(--bg-footer)", borderColor: "var(--color-border)" }}
      >
        <div className="max-w-2xl mx-auto">
          <PaymentIcons />
        </div>
      </div>

      {/* ── Policy links + copyright ──────────────────────────── */}
      <div
        className="w-full py-4 px-6 border-t"
        style={{ background: "var(--bg-footer)", borderColor: "var(--color-border)" }}
      >
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
          <span className="font-sans text-xs" style={{ color: "var(--text-muted)" }}>
            {ready ? <RichText text={data.copyright} /> : <SkelText width="240px" style={{ fontSize: "0.75rem" }} />}
          </span>
          {policyLinks.map((link, i) => (
            <React.Fragment key={i}>
              <span className="font-sans text-xs" style={{ color: "rgba(29,43,27,0.3)" }}> · </span>
              <a
                href={link.href}
                className="font-sans text-xs transition-opacity hover:opacity-60 inline-flex items-center min-h-11 px-1"
                style={{ color: "var(--text-muted)" }}
              >
                {link.label}
              </a>
            </React.Fragment>
          ))}
        </div>
      </div>
    </footer>
  );
};

export default FooterSection;
