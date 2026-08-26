import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { installMemoryStorage } from "@/test/memoryStorage";
import { lineItems } from "./analytics";
import type { Product } from "./defaults";

installMemoryStorage(); // this jsdom build ships without Web Storage

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Ingestion truncates each event's props to a fixed number of characters and
 * then re-parses them. That is not a tail-trim: the cut lands mid-string, the
 * JSON no longer parses, and the WHOLE props object is replaced with `{}`.
 *
 * So an event that grows past the limit does not lose its least important
 * field — it loses every field, keeps recording, and reports nothing. Nothing
 * errors and nothing in the dashboard can reveal it. `line_items` is the only
 * prop here that scales with what the shopper is doing, which makes it the only
 * one that can push an event over on its own.
 */
const propsLimit = (): number => {
  const src = readFileSync(path.join(REPO, "backend", "index.js"), "utf8");
  const m = src.match(/JSON\.stringify\(e\.props \?\? \{\}\)\.slice\(0, (\d+)\)/);
  if (!m) throw new Error("props truncation limit not found in backend/index.js");
  return Number(m[1]);
};

// The worst shape the shop can realistically produce: a full basket of
// UUID-keyed products with long names, on the event that carries the most.
const bulkyItem = (i: number) =>
  ({
    id: `7f3a9c21-4b6e-4d18-9f52-1c8e4a2b${String(i).padStart(4, "0")}`,
    name: "Iced Matcha Latte Candle Limited Edition",
    price: "€25.00",
  }) as Product;

describe("line items and the ingest size limit", () => {
  it("reads the limit the server actually applies", () => {
    expect(propsLimit()).toBeGreaterThan(500);
  });

  it("keeps the heaviest event comfortably inside it", () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ product: bulkyItem(i), quantity: 2 }));
    const props = {
      total: 1999.99,
      items: 80,
      fulfillment_type: "delivery",
      shipping: 4.99,
      discount: 5,
      coupon: "OG-WELCOME1",
      line_items: lineItems(entries),
    };
    const size = JSON.stringify(props).length;
    expect(size).toBeLessThan(propsLimit());
    // Headroom, not a squeak past: a longer product name must not tip it over.
    expect(size).toBeLessThan(propsLimit() * 0.8);
  });

  it("caps the list rather than trusting the basket to be small", () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ product: bulkyItem(i), quantity: 1 }));
    expect(lineItems(entries)).toHaveLength(10);
  });

  it("parses prices the way the shop stores them", () => {
    const entries = [{ product: bulkyItem(0), quantity: 3 }];
    expect(lineItems(entries)[0]).toMatchObject({ price: 25, quantity: 3 });
  });
});
