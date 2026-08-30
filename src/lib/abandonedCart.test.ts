import { describe, expect, it } from "vitest";
import {
  ABANDONED_CART_LIMITS, DEFAULT_ABANDONED_CART_SETTINGS, abandonedCartBodyText,
  applyAbandonedCartTokens, isQuietHour, normalizeAbandonedCartSettings,
  parseAbandonedCartBody, recoveryUrl, type AbandonedCartContext,
} from "./abandonedCart";

/**
 * The rules this email has to keep, stated as behaviour rather than as parity
 * with the backend (that is abandonedCartParity.test.ts's job).
 */

const ctx = (over: Partial<AbandonedCartContext> = {}): AbandonedCartContext => ({
  first_name: "Aoife",
  cart_url: "https://theolivegoose.ie/basket?utm_medium=email",
  cart_total: "€48.50",
  item_count: 3,
  discount_code: "COMEBACK10",
  discount_value: "10%",
  free_shipping: "on orders over €65",
  shop_name: "The Olive Goose",
  cta_label: "Back to my basket",
  items: [
    { name: "Café Noir", quantity: 1, line_total: "€25.00", image_url: "https://example.com/a.jpg" },
    { name: "Sunday Linen", quantity: 2, line_total: "€23.50", image_url: "" },
  ],
  ...over,
});

describe("the basket is guaranteed", () => {
  it("appends the basket and the button when the body has neither", () => {
    const blocks = parseAbandonedCartBody("Just some words.", ctx());
    expect(blocks.map(b => b.type)).toEqual(["paragraph", "items", "button"]);
  });

  it("appends only what is missing, and leaves what the admin placed alone", () => {
    expect(parseAbandonedCartBody("{cart_button}\n\nWords.", ctx()).map(b => b.type))
      .toEqual(["button", "paragraph", "items"]);
    expect(parseAbandonedCartBody("{cart_items}\n\nWords.", ctx()).map(b => b.type))
      .toEqual(["items", "paragraph", "button"]);
  });

  it("keeps the admin's own order when both are present", () => {
    expect(parseAbandonedCartBody("{cart_button}\n\n{cart_items}", ctx()).map(b => b.type))
      .toEqual(["button", "items"]);
  });

  it("does not treat a block token as a block when it shares its line", () => {
    const blocks = parseAbandonedCartBody("look {cart_items} inline", ctx());
    // Still a paragraph — and the basket is appended, so nothing is lost.
    expect(blocks.map(b => b.type)).toEqual(["paragraph", "items", "button"]);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
  });

  it("sends something worth reading even from an empty body", () => {
    expect(parseAbandonedCartBody("", ctx()).map(b => b.type)).toEqual(["items", "button"]);
  });
});

describe("tokens", () => {
  it("fills in every documented token", () => {
    const text = applyAbandonedCartTokens(
      "{first_name} {cart_total} {item_count} {discount_code} {discount_value} {free_shipping} {shop_name} {cart_url}",
      ctx(),
    );
    expect(text).toBe(
      "Aoife €48.50 3 COMEBACK10 10% on orders over €65 The Olive Goose https://theolivegoose.ie/basket?utm_medium=email",
    );
  });

  /**
   * The subject and the preheader take the same tokens as the body — they are
   * the two lines a shopper reads before deciding to open anything, so braces
   * arriving intact there is the most visible way this feature can look broken.
   * It shipped that way once (the body was rendered, the subject was not) and
   * e2e/abandoned-cart.spec.ts caught it; both now go through this function.
   */
  it("renders a subject line, not just a body", () => {
    expect(applyAbandonedCartTokens("Still thinking it over, {first_name}?", ctx()))
      .toBe("Still thinking it over, Aoife?");
    expect(applyAbandonedCartTokens("Your {item_count} items — {cart_total}", ctx()))
      .toBe("Your 3 items — €48.50");
  });

  it("leaves an unknown token exactly as typed, so the admin sees their own typo", () => {
    expect(applyAbandonedCartTokens("{first_nam} {} {}", ctx())).toBe("{first_nam} {} {}");
  });

  /**
   * The rule that makes a product name safe: substitution happens after the
   * markup is parsed, so a candle called "Café **Noir**" cannot turn the rest of
   * the email bold — the asterisks arrive as characters.
   */
  it("does not let a token's value become markup", () => {
    const blocks = parseAbandonedCartBody("Hi {first_name}, welcome.", ctx({ first_name: "**Noir**" }));
    const paragraph = blocks.find(b => b.type === "paragraph");
    expect(paragraph).toBeDefined();
    if (paragraph?.type !== "paragraph") throw new Error("expected a paragraph");
    expect(paragraph.spans.map(s => s.text).join("")).toBe("Hi **Noir**, welcome.");
    expect(paragraph.spans.every(s => !s.bold)).toBe(true);
  });

  it("still parses the admin's own markup around a token", () => {
    const blocks = parseAbandonedCartBody("**{first_name}**", ctx());
    const paragraph = blocks[0];
    if (paragraph?.type !== "paragraph") throw new Error("expected a paragraph");
    expect(paragraph.spans).toEqual([{ text: "Aoife", bold: true, italic: false, underline: false }]);
  });
});

describe("the plain-text alternative", () => {
  it("lists the basket, the subtotal and the link, without markup", () => {
    const text = abandonedCartBodyText("**Hi** {first_name},\n\n{cart_items}\n\n{cart_button}", ctx());
    expect(text).toBe(
      "Hi Aoife,\n\n" +
      "• Café Noir × 1 — €25.00\n" +
      "• Sunday Linen × 2 — €23.50\n" +
      "Subtotal: €48.50\n\n" +
      "Back to my basket: https://theolivegoose.ie/basket?utm_medium=email",
    );
  });
});

describe("quiet hours", () => {
  it("wraps midnight", () => {
    expect(isQuietHour(23, 22, 8)).toBe(true);
    expect(isQuietHour(3, 22, 8)).toBe(true);
    expect(isQuietHour(8, 22, 8)).toBe(false);
    expect(isQuietHour(12, 22, 8)).toBe(false);
  });

  it("treats a same-hour window as no window, never as all day", () => {
    for (let hour = 0; hour < 24; hour++) expect(isQuietHour(hour, 9, 9)).toBe(false);
  });

  it("handles a plain daytime window", () => {
    expect(isQuietHour(9, 8, 17)).toBe(true);
    expect(isQuietHour(17, 8, 17)).toBe(false);
  });
});

describe("the recovery link", () => {
  it("carries the campaign tags GA4 reads", () => {
    expect(recoveryUrl("https://theolivegoose.ie", DEFAULT_ABANDONED_CART_SETTINGS)).toBe(
      "https://theolivegoose.ie/basket?utm_source=olive_goose&utm_medium=email&utm_campaign=abandoned_cart",
    );
  });

  it("does not double a trailing slash", () => {
    expect(recoveryUrl("https://theolivegoose.ie/", DEFAULT_ABANDONED_CART_SETTINGS))
      .toContain("https://theolivegoose.ie/basket?");
  });

  it("drops empty tags rather than sending utm_source=", () => {
    expect(recoveryUrl("https://x.ie", { utm_source: "", utm_medium: "email", utm_campaign: "" }))
      .toBe("https://x.ie/basket?utm_medium=email");
  });

  /**
   * Not a stylistic choice: a fabricated gclid/fbclid would make a recovered
   * sale look like an ad click to Google and Meta, which breaks both platforms'
   * terms and corrupts the ROAS the shop actually buys on.
   */
  it("never invents an ad click id", () => {
    const url = recoveryUrl("https://theolivegoose.ie", DEFAULT_ABANDONED_CART_SETTINGS);
    expect(url).not.toMatch(/gclid|fbclid|wbraid|gbraid|msclkid/i);
  });
});

describe("settings normalisation", () => {
  it("clamps a blank or zero delay up to the minimum, not down to nothing", () => {
    expect(normalizeAbandonedCartSettings({ delay_hours: 0 }).delay_hours).toBe(ABANDONED_CART_LIMITS.minDelayHours);
    expect(normalizeAbandonedCartSettings({ delay_hours: -20 }).delay_hours).toBe(ABANDONED_CART_LIMITS.minDelayHours);
    expect(normalizeAbandonedCartSettings({ delay_hours: 99999 }).delay_hours).toBe(ABANDONED_CART_LIMITS.maxDelayHours);
  });

  it("caps how many reminders one basket can earn", () => {
    expect(normalizeAbandonedCartSettings({ max_reminders: 50 }).max_reminders)
      .toBe(ABANDONED_CART_LIMITS.maxReminders);
    expect(normalizeAbandonedCartSettings({ max_reminders: 0 }).max_reminders).toBe(1);
  });

  it("falls back to the shipped copy when a field is blanked", () => {
    const s = normalizeAbandonedCartSettings({ subject: "   ", body: "  ", cta_label: "" });
    expect(s.subject).toBe(DEFAULT_ABANDONED_CART_SETTINGS.subject);
    expect(s.body).toBe(DEFAULT_ABANDONED_CART_SETTINGS.body);
    expect(s.cta_label).toBe(DEFAULT_ABANDONED_CART_SETTINGS.cta_label);
  });

  /** A blank preheader is a real choice — unlike a blank subject, which is a mistake. */
  it("allows an empty preheader", () => {
    expect(normalizeAbandonedCartSettings({ preheader: "  " }).preheader).toBe("");
  });

  it("normalises a typed discount code to the shape the codes table uses", () => {
    expect(normalizeAbandonedCartSettings({ discount_code: "  comeback10 " }).discount_code).toBe("COMEBACK10");
  });

  it("keeps automatic sending off unless it is explicitly on", () => {
    expect(normalizeAbandonedCartSettings({}).enabled).toBe(false);
    expect(normalizeAbandonedCartSettings({ enabled: true }).enabled).toBe(true);
  });
});
