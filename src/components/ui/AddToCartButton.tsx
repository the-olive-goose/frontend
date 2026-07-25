import { motion } from "framer-motion";
import type { ReactNode, MouseEvent } from "react";

/**
 * The single source of truth for every "Add to Cart" / "Buy Now" button in the
 * storefront (home candle cards, shop grid, deals bundles, product page).
 *
 * Canonical, always-consistent traits live here: font, weight, pill shape,
 * letter-spacing, hover/tap motion, disabled styling. Per-surface knobs stay
 * configurable via props — `accent` (background), `textColor`, `size`,
 * `fullWidth`, `label`. Change the look once here and it propagates everywhere.
 */

export type AddToCartSize = "sm" | "md" | "lg";

const SIZES: Record<AddToCartSize, { fontSize: string; padding: string }> = {
  sm: { fontSize: "clamp(0.62rem,0.9vw,0.75rem)", padding: "6px 13px" },
  md: { fontSize: "clamp(0.8rem,1.1vw,0.95rem)",  padding: "10px 22px" },
  lg: { fontSize: "0.9rem",                        padding: "16px 26px" },
};

export interface AddToCartButtonProps {
  label?: ReactNode;
  /** Background colour. Defaults to the brand dark button token. */
  accent?: string;
  /** Foreground/text colour. Defaults to the brand cream-on-dark token. */
  textColor?: string;
  size?: AddToCartSize;
  fullWidth?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  className?: string;
  type?: "button" | "submit";
  "aria-label"?: string;
}

const AddToCartButton = ({
  label = "Add to Cart",
  accent = "var(--btn-dark-bg)",
  textColor = "var(--btn-dark-text)",
  size = "md",
  fullWidth = false,
  disabled = false,
  onClick,
  title,
  className,
  type = "button",
  "aria-label": ariaLabel,
}: AddToCartButtonProps) => {
  const s = SIZES[size];
  return (
    <motion.button
      type={type}
      whileHover={disabled ? undefined : { scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      // `og-cta` is the hook for the phone-only 44px touch-target floor in
      // index.css — these paddings alone come out ~26–36px tall, under the size
      // the rest of the mobile UI is built to.
      className={["og-cta", className].filter(Boolean).join(" ")}
      style={{
        fontFamily: "'Fredoka',sans-serif",
        fontWeight: 600,
        fontSize: s.fontSize,
        letterSpacing: "var(--tracking-cta)",
        lineHeight: 1,
        background: accent,
        color: textColor,
        border: "none",
        borderRadius: "var(--radius-pill)",
        padding: s.padding,
        width: fullWidth ? "100%" : undefined,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
        boxShadow: disabled ? "none" : "0 3px 12px rgba(0,0,0,0.14)",
        transition: "opacity 0.2s, box-shadow 0.2s",
      }}
    >
      {label}
    </motion.button>
  );
};

export default AddToCartButton;
