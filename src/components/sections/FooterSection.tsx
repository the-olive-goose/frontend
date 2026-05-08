import React from "react";
import type { ReactElement } from "react";
import { FooterContent } from "@/lib/defaults";

interface Props { data: FooterContent }

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
    Pinterest: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
      </svg>
    ),
  };

  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="transition-opacity hover:opacity-60" style={{ color: "var(--text-primary)" }} aria-label={platform}>
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

const PaymentIcons = () => (
  <div className="flex flex-wrap items-center justify-center gap-2">
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
        <rect width="46" height="30" rx="4" fill="#000"/>
        <text x="23" y="13" textAnchor="middle" fill="white" fontSize="7" fontFamily="Arial"></text>
        <text x="23" y="21" textAnchor="middle" fill="white" fontSize="8" fontWeight="500" fontFamily="-apple-system,Arial">Pay</text>
        <text x="16" y="14" textAnchor="middle" fill="white" fontSize="10" fontFamily="-apple-system,Arial"></text>
      </svg>
    </PaymentBadge>
    {/* Google Pay */}
    <PaymentBadge label="Google Pay">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <text x="7" y="20" fill="#4285F4" fontSize="9" fontWeight="bold" fontFamily="Arial">G</text>
        <text x="14" y="20" fill="#34A853" fontSize="9" fontWeight="bold" fontFamily="Arial">o</text>
        <text x="20" y="20" fill="#FBBC05" fontSize="9" fontWeight="bold" fontFamily="Arial">o</text>
        <text x="26" y="20" fill="#EA4335" fontSize="9" fontWeight="bold" fontFamily="Arial">g</text>
        <text x="32" y="20" fill="#4285F4" fontSize="9" fontWeight="bold" fontFamily="Arial">le</text>
      </svg>
    </PaymentBadge>
    {/* Maestro */}
    <PaymentBadge label="Maestro">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <circle cx="18" cy="15" r="9" fill="#EB001B" opacity="0.9"/>
        <circle cx="28" cy="15" r="9" fill="#0099DF" opacity="0.9"/>
        <ellipse cx="23" cy="15" rx="4" ry="9" fill="#7B3FBE" opacity="0.7"/>
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
    {/* PayPal */}
    <PaymentBadge label="PayPal">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <text x="8" y="20" fill="#003087" fontSize="11" fontWeight="bold" fontFamily="Arial">Pay</text>
        <text x="26" y="20" fill="#009CDE" fontSize="11" fontWeight="bold" fontFamily="Arial">Pal</text>
      </svg>
    </PaymentBadge>
    {/* Shop Pay */}
    <PaymentBadge label="Shop Pay">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#5A31F4"/>
        <text x="23" y="19" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="Arial">Shop</text>
      </svg>
    </PaymentBadge>
    {/* UnionPay */}
    <PaymentBadge label="UnionPay">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <rect x="4" y="5" width="13" height="20" rx="2" fill="#E21836"/>
        <rect x="18" y="5" width="10" height="20" rx="2" fill="#00447C"/>
        <rect x="29" y="5" width="13" height="20" rx="2" fill="#007B40"/>
      </svg>
    </PaymentBadge>
    {/* Visa */}
    <PaymentBadge label="Visa">
      <svg viewBox="0 0 46 30" width="46" height="30">
        <rect width="46" height="30" rx="4" fill="#fff"/>
        <text x="23" y="21" textAnchor="middle" fill="#1A1F71" fontSize="14" fontWeight="bold" fontFamily="Arial" fontStyle="italic">VISA</text>
      </svg>
    </PaymentBadge>
  </div>
);

// ── Main footer ───────────────────────────────────────────────────────────────
const FooterSection = ({ data }: Props) => {
  const links = data.links ?? [];
  const socialLinks = data.social_links ?? [];
  const policyLinks = data.policy_links ?? [];

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
          {links.length > 0 && (
            <nav className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
              {links.map((link, i) => (
                <a
                  key={i}
                  href={link.href}
                  className="font-sans text-sm transition-opacity hover:opacity-60"
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
            {data.copyright}
          </span>
          {policyLinks.map((link, i) => (
            <React.Fragment key={i}>
              <span className="font-sans text-xs" style={{ color: "rgba(29,43,27,0.3)" }}> · </span>
              <a
                href={link.href}
                className="font-sans text-xs transition-opacity hover:opacity-60"
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
