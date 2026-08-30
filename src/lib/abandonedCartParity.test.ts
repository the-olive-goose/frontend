import { describe, expect, it } from "vitest";
import * as backend from "../../backend/email.js";
import * as backendCart from "../../backend/abandonedCart.js";
import {
  applyAbandonedCartTokens, parseAbandonedCartBody, abandonedCartBodyText,
  normalizeAbandonedCartSettings, isQuietHour, recoveryUrl, DEFAULT_ABANDONED_CART_SETTINGS,
  type AbandonedCartContext,
} from "./abandonedCart";

/**
 * The abandoned-cart template exists twice: in TypeScript for the admin's live
 * preview, and in plain JS for the API, which builds the email that is actually
 * sent and cannot import the app's TS.
 *
 * Same arrangement as the newsletter's parity test next door, and the same
 * reason for it: the preview is the only look anyone gets at an email before it
 * becomes unrecallable, so a preview that renders differently from the send is
 * worse than no preview at all.
 *
 * This one has more to hold together than the newsletter's, because this email
 * is not just markup — it is markup, a token substitution, and two block-level
 * tokens that turn into a basket and a button. Every one of those is a place the
 * two copies could drift.
 */

const CTX: AbandonedCartContext = {
  first_name: "Aoife",
  cart_url: "https://theolivegoose.ie/basket?utm_source=olive_goose&utm_medium=email&utm_campaign=abandoned_cart",
  cart_total: "€48.50",
  item_count: 3,
  discount_code: "COMEBACK10",
  discount_value: "10%",
  free_shipping: "on orders over €65",
  shop_name: "The Olive Goose",
  cta_label: "Back to my basket",
  items: [
    { name: "Café Noir", quantity: 1, line_total: "€25.00", image_url: "https://example.com/a.jpg" },
    { name: 'Sarah\'s "favourite" & best', quantity: 2, line_total: "€23.50", image_url: "" },
  ],
};

const BODIES: string[] = [
  // The shipped default — the one most shops will never edit.
  DEFAULT_ABANDONED_CART_SETTINGS.body,
  // Every inline token, alone and in prose.
  "{first_name}",
  "Hi {first_name}, your {item_count} items come to {cart_total}.",
  "Use {discount_code} for {discount_value} off, and shipping is free {free_shipping}.",
  "Straight to it: {cart_url}",
  "From all of us at {shop_name}.",
  // Unknown tokens stay literal — the admin sees their own typo.
  "{not_a_token} and {first_nam} and {}",
  // Block tokens, alone on their line.
  "{cart_items}",
  "{cart_button}",
  "Before.\n\n{cart_items}\n\n{cart_button}\n\nAfter.",
  // …and NOT alone, which must stay text rather than become a basket.
  "look {cart_items} inline",
  "{cart_items} plus words",
  // Order is the admin's: a button above the basket is allowed.
  "{cart_button}\n\n{cart_items}",
  // Omissions — both are appended, in a fixed order.
  "Just some words with no tokens at all.",
  "Only the basket:\n\n{cart_items}",
  "Only the button:\n\n{cart_button}",
  // Markup around and inside tokens.
  "**{first_name}**, look:\n\n{cart_items}",
  "*Psst* — {discount_code} is __yours__.",
  // A token whose VALUE contains markup characters must not become markup.
  "Your candle: {first_name}",
  // Escaping is the emitter's job, but the tree must carry the text through.
  "<script>alert(1)</script> {first_name}",
  "Ampersands & angle < brackets > {cart_total}",
  // Images, and the near-misses that are not images.
  "![A lit candle](https://example.com/a.jpg)\n\n{cart_items}",
  "![](http://example.com/a.jpg)",
  // Whitespace and emptiness.
  "",
  "   ",
  "\n\n\n",
  "  leading and trailing  \n\n  {cart_items}  ",
];

describe("abandoned-cart body: preview vs email", () => {
  it.each(BODIES)("parses identically: %j", (body) => {
    expect(parseAbandonedCartBody(body, CTX)).toEqual(backend.parseAbandonedCartBody(body, CTX));
  });

  it.each(BODIES)("renders the same plain text: %j", (body) => {
    expect(abandonedCartBodyText(body, CTX)).toEqual(backend.abandonedCartBodyText(body, CTX));
  });
});

describe("token substitution: preview vs email", () => {
  const RUNS = [
    "Hi {first_name}",
    "{cart_total} for {item_count} items",
    "{discount_code} · {discount_value} · {free_shipping} · {shop_name}",
    "{cart_url}",
    "{unknown} stays",
    "{first_name}{first_name}",
    "no tokens here",
    "",
  ];
  it.each(RUNS)("substitutes identically: %j", (run) => {
    expect(applyAbandonedCartTokens(run, CTX)).toEqual(backend.applyAbandonedCartTokens(run, CTX));
  });
});

describe("settings normalisation: form vs server", () => {
  const CASES: unknown[] = [
    undefined,
    null,
    {},
    DEFAULT_ABANDONED_CART_SETTINGS,
    { delay_hours: 0, max_reminders: 0, followup_hours: 0, cooldown_days: -5 },
    { delay_hours: 9999, max_reminders: 99, followup_hours: 9999, cooldown_days: 9999 },
    { delay_hours: "6", max_reminders: "2", quiet_hours_start: "23", quiet_hours_end: "7" },
    { delay_hours: "not a number", quiet_hours_start: 99, quiet_hours_end: -1 },
    { subject: "   ", body: "   ", cta_label: "   " },
    { discount_code: "  comeback10  " },
    { preheader: "   " },
    { enabled: "yes", utm_medium: "" },
    { delay_hours: 4.6, cooldown_days: 2.4 },
  ];
  it.each(CASES.map((c, i) => [i, c] as const))("clamps case %i the same way", (_i, raw) => {
    expect(normalizeAbandonedCartSettings(raw as never))
      .toEqual(backendCart.normalizeAbandonedCartSettings(raw));
  });

  it("ships the same defaults on both sides", () => {
    expect(DEFAULT_ABANDONED_CART_SETTINGS).toEqual(backendCart.DEFAULT_ABANDONED_CART_SETTINGS);
  });
});

describe("quiet hours and the recovery link: form vs server", () => {
  it("agrees on every hour of a wrapping and a non-wrapping window", () => {
    for (const [start, end] of [[22, 8], [8, 22], [0, 0], [13, 13], [23, 0], [0, 1]]) {
      for (let hour = 0; hour < 24; hour++) {
        expect(isQuietHour(hour, start, end)).toBe(backendCart.isQuietHour(hour, start, end));
      }
    }
  });

  it("builds the same tagged URL", () => {
    for (const base of ["https://theolivegoose.ie", "https://theolivegoose.ie/", "http://localhost:8080"]) {
      expect(recoveryUrl(base, DEFAULT_ABANDONED_CART_SETTINGS))
        .toBe(backendCart.recoveryUrl(base, DEFAULT_ABANDONED_CART_SETTINGS));
    }
    const noTags = { utm_source: "", utm_medium: "", utm_campaign: "" };
    expect(recoveryUrl("https://theolivegoose.ie", noTags))
      .toBe(backendCart.recoveryUrl("https://theolivegoose.ie", noTags));
  });
});
