import type { ReactNode } from "react";
import { motion } from "framer-motion";
import RichText from "@/lib/richtext";
import { splitPageTitle } from "@/lib/pageTitle";
import { SkelText } from "@/components/ui/ContentSkeleton";

interface Props {
  eyebrow: string;
  title: ReactNode;
  /**
   * The tail of the headline to render in gold, e.g. title "All" + titleGold
   * "Candles". Admin-configurable per page; blank leaves the headline one
   * colour. Ignored when `title` is a node rather than a string.
   */
  titleGold?: string;
  subtitle?: string;
  /**
   * False while the page's copy is still loading. The band then renders
   * placeholder lines at the same size — the headline and subtitle here are
   * admin-editable on every page that uses it, so painting the bundled text
   * first would flash last month's wording.
   */
  ready?: boolean;
}

/**
 * The one dark hero band used by every routed page (Shop, Candle Care, Today's
 * Deals, About, plus the legal/help pages). It owns three things so no page can
 * drift out of step with the others:
 *
 *  1. the nav offset — the band's top padding clears the fixed navbar
 *     (--nav-h), so consumers must NOT wrap it in their own pt-[var(--nav-h)];
 *  2. the band height — --page-hero-py above and below the copy;
 *  3. the type scale and colours of eyebrow / headline / subtitle — including
 *     the two-tone headline (plain + gold tail), so no page hand-rolls its own
 *     gold <span> and drifts to a different gold.
 *
 * The gap *below* the band is the first body block's --page-body-pt.
 * See the "Page Chrome Rhythm" tokens in index.css.
 *
 * The copy fades in on mount (`animate`), never on scroll (`whileInView`) — this
 * band is always above the fold, so an in-view observer may never fire for it
 * and the copy would sit at opacity 0 forever.
 */
const PageHero = ({ eyebrow, title, titleGold, subtitle, ready = true }: Props) => {
  const parts = typeof title === "string" ? splitPageTitle(title, titleGold) : null;

  return (
  <div
    className="w-full px-6 text-center"
    style={{
      background: "var(--color-forest-dark)",
      paddingTop: "calc(var(--nav-h, 112px) + var(--page-hero-py))",
      paddingBottom: "var(--page-hero-py)",
    }}
  >
    <motion.p
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="font-display text-xs tracking-[0.2em] uppercase mb-3"
      style={{ color: "var(--text-gold)" }}
    >
      🕯️ &nbsp; <RichText text={eyebrow} /> &nbsp; 🕯️
    </motion.p>
    <motion.h1
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
      className="font-display font-semibold mb-4"
      style={{ fontSize: "clamp(2.4rem,5vw,4rem)", color: "var(--text-on-dark)", lineHeight: 1.05 }}
    >
      {!ready ? (
        <SkelText width="min(520px,80vw)" lineHeight={1.05} center />
      ) : parts ? (
        <>
          {parts.plain && <RichText text={parts.plain} />}
          {parts.plain && parts.gold && " "}
          {parts.gold && (
            <span style={{ color: "var(--color-gold)" }}><RichText text={parts.gold} /></span>
          )}
        </>
      ) : title}
    </motion.h1>
    {!ready ? (
      <p className="font-sans text-base max-w-xl mx-auto leading-relaxed" style={{ color: "var(--text-muted-on-dark)" }}>
        <SkelText lines={2} width="min(480px,78vw)" lineHeight={1.6} center />
      </p>
    ) : subtitle ? (
      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}
        className="font-sans text-base max-w-xl mx-auto leading-relaxed"
        style={{ color: "var(--text-muted-on-dark)" }}
      >
        <RichText text={subtitle} />
      </motion.p>
    ) : null}
  </div>
  );
};

export default PageHero;
