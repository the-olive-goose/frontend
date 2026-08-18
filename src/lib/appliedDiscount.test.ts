import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "@/test/memoryStorage";
import {
  APPLIED_DISCOUNT_KEY, clearAppliedDiscount, readAppliedDiscount, writeAppliedDiscount,
} from "./appliedDiscount";

/**
 * The discount code a shopper applied, remembered across page loads. What these
 * pin down:
 *
 *  • it survives a round trip, so going back to the basket (or pressing back on
 *    Stripe's page) doesn't silently return the summary to full price;
 *  • junk in storage — an old shape, a truncated write, a hand-edited value —
 *    yields "no code", never a summary line reading "NaN off";
 *  • removing a code really forgets it, so a shopper who removed one doesn't
 *    find it reapplied on the next page load;
 *  • storage that throws (Safari private mode, blocked cookies) degrades to "no
 *    code remembered" rather than taking checkout down.
 *
 * What it deliberately does NOT pin down: whether the code is still valid. That
 * is the server's answer, re-asked on every checkout mount — storage is only
 * ever a cache of what the shopper typed.
 */

installMemoryStorage(); // this jsdom build ships without Web Storage

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("round trip", () => {
  it("reads back what was written", () => {
    writeAppliedDiscount({ code: "OG-ABCD2345", type: "percentage", value: 15 });
    expect(readAppliedDiscount()).toEqual({ code: "OG-ABCD2345", type: "percentage", value: 15 });
  });

  it("keeps a fixed-euro code's type and value distinct from a percentage", () => {
    writeAppliedDiscount({ code: "TENOFF", type: "fixed", value: 10 });
    expect(readAppliedDiscount()).toEqual({ code: "TENOFF", type: "fixed", value: 10 });
  });

  it("normalizes the code to the form the backend stores", () => {
    writeAppliedDiscount({ code: " og-abcd2345 ", type: "percentage", value: 15 });
    expect(readAppliedDiscount()?.code).toBe("OG-ABCD2345");
  });

  it("forgets the code when it's removed", () => {
    writeAppliedDiscount({ code: "OG-ABCD2345", type: "percentage", value: 15 });
    clearAppliedDiscount();
    expect(readAppliedDiscount()).toBeNull();
    expect(localStorage.getItem(APPLIED_DISCOUNT_KEY)).toBeNull();
  });
});

describe("junk in storage", () => {
  it("returns null for nothing stored", () => {
    expect(readAppliedDiscount()).toBeNull();
  });

  const junk: Array<[string, string]> = [
    ["not JSON at all", "OG-ABCD"],
    ["a truncated write", '{"code":"OG-ABCD","type":"percen'],
    ["an array from an older build", '[{"code":"OG-ABCD"}]'],
    ["a missing code", '{"type":"percentage","value":15}'],
    ["an empty code", '{"code":"   ","type":"percentage","value":15}'],
    ["an unknown discount type", '{"code":"OG-ABCD","type":"buy_one_get_one","value":15}'],
    ["a value that isn’t a number", '{"code":"OG-ABCD","type":"percentage","value":"15"}'],
    ["a NaN value", '{"code":"OG-ABCD","type":"percentage","value":null}'],
    ["a zero value", '{"code":"OG-ABCD","type":"percentage","value":0}'],
    ["a negative value", '{"code":"OG-ABCD","type":"fixed","value":-5}'],
  ];

  for (const [what, raw] of junk) {
    it(`ignores ${what}`, () => {
      localStorage.setItem(APPLIED_DISCOUNT_KEY, raw);
      expect(readAppliedDiscount()).toBeNull();
    });
  }
});

describe("storage that throws", () => {
  it("reads as no code rather than crashing checkout", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage blocked");
    });
    expect(readAppliedDiscount()).toBeNull();
  });

  it("swallows a failed write — the code still applies for this page load", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeAppliedDiscount({ code: "OG-ABCD2345", type: "percentage", value: 15 })).not.toThrow();
  });

  it("swallows a failed remove", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError: storage blocked");
    });
    expect(() => clearAppliedDiscount()).not.toThrow();
  });
});
