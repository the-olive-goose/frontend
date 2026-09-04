import { describe, it, expect } from "vitest";
import { sortByDisplayOrder, nextDisplayOrder, productsInCategory } from "@/lib/products";
import type { Product } from "@/lib/defaults";

const product = (id: string, display_order?: number | null): Product => ({
  id,
  name: id,
  description: "",
  price: "25",
  image_url: "",
  tag: "",
  ...(display_order === undefined ? {} : { display_order }),
});

const ids = (list: Product[]) => list.map(p => p.id);

describe("sortByDisplayOrder", () => {
  it("orders by the admin's number, lowest first", () => {
    const items = [product("c", 3), product("a", 1), product("b", 2)];
    expect(ids(sortByDisplayOrder(items))).toEqual(["a", "b", "c"]);
  });

  it("keeps unnumbered products last, in the order they were added", () => {
    const items = [product("unset-1"), product("numbered", 2), product("unset-2", null)];
    expect(ids(sortByDisplayOrder(items))).toEqual(["numbered", "unset-1", "unset-2"]);
  });

  it("leaves an entirely unnumbered catalogue exactly as it is", () => {
    const items = [product("a"), product("b"), product("c")];
    expect(ids(sortByDisplayOrder(items))).toEqual(["a", "b", "c"]);
  });

  it("breaks ties on the admin list order", () => {
    const items = [product("a", 1), product("b", 1)];
    expect(ids(sortByDisplayOrder(items))).toEqual(["a", "b"]);
  });

  it("treats blank text as unnumbered rather than as zero", () => {
    // Not reachable from the admin box (it writes null), but hand-edited or
    // imported content can carry "" — and Number("") is 0, which would jump the
    // candle to the front of the grid.
    const blank = { ...product("imported"), display_order: "" as unknown as number };
    const items = [product("numbered", 1), blank];
    expect(ids(sortByDisplayOrder(items))).toEqual(["numbered", "imported"]);
  });

  it("sorts a number saved as text, since content can be edited by hand", () => {
    const asText = { ...product("text-two"), display_order: "2" as unknown as number };
    const items = [product("three", 3), asText, product("one", 1)];
    expect(ids(sortByDisplayOrder(items))).toEqual(["one", "text-two", "three"]);
  });

  it("does not mutate the array it was given", () => {
    const items = [product("b", 2), product("a", 1)];
    sortByDisplayOrder(items);
    expect(ids(items)).toEqual(["b", "a"]);
  });
});

describe("nextDisplayOrder", () => {
  it("lands a new product after the highest number in use", () => {
    expect(nextDisplayOrder([product("a", 1), product("b", 7), product("c", 3)])).toBe(8);
  });

  it("ignores unnumbered products when finding the highest", () => {
    expect(nextDisplayOrder([product("a"), product("b", null), product("c", 2)])).toBe(3);
  });

  // The behaviour an admin who never opens this feature still depends on: a new
  // candle joins the END of the shop grid. Numbering it 1 would put it in front
  // of the whole catalogue.
  it("leaves a new product unnumbered when nothing is numbered yet", () => {
    expect(nextDisplayOrder([product("a"), product("b"), product("c", null)])).toBeNull();
  });

  it("leaves the very first product of an empty catalogue unnumbered", () => {
    expect(nextDisplayOrder([])).toBeNull();
  });
});

describe("productsInCategory", () => {
  // The order candles were ticked into a category is not an order anyone chose,
  // so it must never be the order they are shown in. Every surface that renders a
  // category — the shop grid, the home strip, the flipbook — comes through here.
  const CATALOGUE = [
    product("added-first", 3),
    product("added-second", 1),
    product("added-third", 2),
    product("unnumbered"),
  ];

  it("lists a category in display order, not the order it was ticked together", () => {
    const picked = ["added-first", "added-third", "added-second"];
    expect(ids(productsInCategory(picked, CATALOGUE))).toEqual([
      "added-second", "added-third", "added-first",
    ]);
  });

  it("keeps an unnumbered member last, as the full grid does", () => {
    const picked = ["unnumbered", "added-second"];
    expect(ids(productsInCategory(picked, CATALOGUE))).toEqual(["added-second", "unnumbered"]);
  });

  it("drops ids with no matching product, rather than rendering a hole", () => {
    expect(ids(productsInCategory(["added-second", "deleted-candle"], CATALOGUE)))
      .toEqual(["added-second"]);
  });

  it("is empty for a category with no products, and for one with none set", () => {
    expect(productsInCategory([], CATALOGUE)).toEqual([]);
    expect(productsInCategory(undefined, CATALOGUE)).toEqual([]);
  });

  it("does not mutate the catalogue it was given", () => {
    const items = [product("b", 2), product("a", 1)];
    productsInCategory(["a", "b"], items);
    expect(ids(items)).toEqual(["b", "a"]);
  });
});
