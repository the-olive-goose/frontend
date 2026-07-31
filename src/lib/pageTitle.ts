// ── Two-tone page banner headlines ─────────────────────────────────────────────
// Every routed page's <PageHero> headline is written by an admin as two fields:
// the plain part (rendered in the on-dark text colour) and the gold part. The
// Candle Care page has worked this way since it shipped ("Love it long." +
// "Burn it right."); this module is that idea generalised so every page can do
// it from the admin panel.

export interface PageTitleParts {
  plain: string;
  gold: string;
}

/**
 * Resolve the two halves of a banner headline.
 *
 * The gold half is *deduplicated off the end of the plain half*, which matters
 * for two reasons:
 *
 *  1. Migration — the shipped defaults used to hold the whole headline in the
 *     plain field ("Delivery & Returns", "Today's Deals"). Content saved before
 *     the gold field existed keeps that full string in the database and picks up
 *     the new gold default on merge, which would otherwise render "Delivery &
 *     Returns Returns".
 *  2. Intent — an admin who types the full headline in one box and the word they
 *     want gold in the other means "make that word gold", never "print it twice".
 *
 * Matching is case-insensitive so a heading recased after the fact still splits.
 */
export function splitPageTitle(title: string, gold?: string): PageTitleParts {
  const goldPart = (gold ?? "").trim();
  const plainPart = (title ?? "").trim();
  if (!goldPart) return { plain: plainPart, gold: "" };

  const plain = plainPart.toLowerCase().endsWith(goldPart.toLowerCase())
    ? plainPart.slice(0, plainPart.length - goldPart.length).trim()
    : plainPart;

  return { plain, gold: goldPart };
}

/** The headline as one line — for <title> tags, JSON-LD and other plain-text uses. */
export function joinPageTitle(title: string, gold?: string): string {
  const { plain, gold: goldPart } = splitPageTitle(title, gold);
  return [plain, goldPart].filter(Boolean).join(" ");
}
