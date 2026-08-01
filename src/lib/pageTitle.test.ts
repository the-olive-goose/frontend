import { describe, expect, it } from "vitest";
import { joinPageTitle, splitPageTitle } from "@/lib/pageTitle";
import { DEFAULT_CONTENT, DEFAULT_DEALS } from "@/lib/defaults";

describe("splitPageTitle", () => {
  it("keeps the two halves as written", () => {
    expect(splitPageTitle("All", "Candles")).toEqual({ plain: "All", gold: "Candles" });
  });

  it("leaves the headline one colour when no gold part is set", () => {
    expect(splitPageTitle("Gift Cards", "")).toEqual({ plain: "Gift Cards", gold: "" });
    expect(splitPageTitle("Gift Cards")).toEqual({ plain: "Gift Cards", gold: "" });
  });

  it("does not repeat the gold part when the plain half still holds the whole headline", () => {
    // What content saved before the gold field existed looks like after it is
    // merged with the new defaults.
    expect(splitPageTitle("Delivery & Returns", "Returns")).toEqual({
      plain: "Delivery &",
      gold: "Returns",
    });
    expect(splitPageTitle("Today's Deals", "Deals")).toEqual({ plain: "Today's", gold: "Deals" });
  });

  it("matches the tail regardless of case", () => {
    expect(splitPageTitle("PRIVACY POLICY", "Policy")).toEqual({ plain: "PRIVACY", gold: "Policy" });
  });

  it("renders gold only when the whole headline is the gold part", () => {
    expect(splitPageTitle("Deals", "Deals")).toEqual({ plain: "", gold: "Deals" });
  });

  it("only strips a matching tail, never a match elsewhere in the headline", () => {
    expect(splitPageTitle("Returns & Delivery", "Returns")).toEqual({
      plain: "Returns & Delivery",
      gold: "Returns",
    });
  });

  it("trims the stray whitespace an admin leaves behind", () => {
    expect(splitPageTitle("  Terms of  ", " Service ")).toEqual({ plain: "Terms of", gold: "Service" });
  });
});

describe("joinPageTitle", () => {
  it("reads as one headline for <title> tags", () => {
    expect(joinPageTitle("Contact", "Us")).toBe("Contact Us");
    expect(joinPageTitle("Delivery & Returns", "Returns")).toBe("Delivery & Returns");
    expect(joinPageTitle("Gift Cards", "")).toBe("Gift Cards");
  });
});

// The shipped defaults are what a fresh install renders, so they should already
// say what the design asks for — a plain half, then a gold half.
describe("shipped page headlines", () => {
  const cases: Array<[string, string, string]> = [
    ["shop", DEFAULT_CONTENT.shopPage.page_title, DEFAULT_CONTENT.shopPage.page_title_gold],
    ["candle care", DEFAULT_CONTENT.candleCare.headline_part1, DEFAULT_CONTENT.candleCare.headline_part2],
    ["deals", DEFAULT_DEALS.page_title, DEFAULT_DEALS.page_title_gold],
    ["about", DEFAULT_CONTENT.aboutPage.page_title, DEFAULT_CONTENT.aboutPage.page_title_gold],
    ["returns", DEFAULT_CONTENT.returnPolicy.heading, DEFAULT_CONTENT.returnPolicy.heading_gold],
    ["faq", DEFAULT_CONTENT.customerService.faq_heading, DEFAULT_CONTENT.customerService.faq_heading_gold],
    ["customer service", DEFAULT_CONTENT.customerService.heading, DEFAULT_CONTENT.customerService.heading_gold],
    ["privacy policy", DEFAULT_CONTENT.privacyPolicy.heading, DEFAULT_CONTENT.privacyPolicy.heading_gold],
    ["terms of service", DEFAULT_CONTENT.termsOfService.heading, DEFAULT_CONTENT.termsOfService.heading_gold],
    ["shipping policy", DEFAULT_CONTENT.shippingPolicy.heading, DEFAULT_CONTENT.shippingPolicy.heading_gold],
  ];

  it.each(cases)("%s has both halves filled in", (_page, plain, gold) => {
    const parts = splitPageTitle(plain, gold);
    expect(parts.plain).not.toBe("");
    expect(parts.gold).not.toBe("");
  });

  it.each(cases)("%s does not repeat its gold half", (_page, plain, gold) => {
    expect(joinPageTitle(plain, gold).match(new RegExp(gold, "gi"))).toHaveLength(1);
  });
});
