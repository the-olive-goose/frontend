import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import useInViewport from "@/hooks/useInViewport";
import { track, lineItems } from "@/lib/analytics";
import { priceToNumber } from "@/lib/cart";
import type { Product } from "@/lib/defaults";

/**
 * A grid, rail or carousel of products, as both measurement systems understand
 * one — GA4 calls it an item list.
 *
 * Two things have to be true for a list report to mean anything, and neither
 * happens on its own:
 *
 *  1. `view_item_list` fires when the products were ACTUALLY SHOWN. Firing it
 *     on mount is the easy version and it is wrong: the home page's rails sit
 *     well below the fold, so every visitor who read the hero and left would
 *     have been recorded as having seen every product on the page. That is an
 *     impression count that only goes up, which makes click-through rate — the
 *     entire point of the report — read low for reasons that never happened.
 *     So it is gated on the list actually entering the viewport.
 *
 *  2. `select_item` says WHICH list the click came from. Without it GA4 can
 *     count impressions and count clicks and never join the two, so "this rail
 *     is shown constantly and never clicked" is unanswerable — which is the one
 *     question worth asking about a shelf.
 *
 * Scope supplies both: it watches for the list appearing, and it tells the cards
 * inside it which list they are in.
 */
export interface ProductListInfo {
  /** Stable across copy edits — it is the reporting key. */
  id: string;
  /** Human-readable, for the report's own sake. */
  name: string;
}

const ProductListContext = createContext<ProductListInfo | null>(null);

/** The list the calling card is inside, or null if it isn't in one. */
export const useProductList = () => useContext(ProductListContext);

/**
 * Which lists have already been reported this page load.
 *
 * MODULE-LEVEL, not per component, and that is the whole point of it. The home
 * page's flipbook renders the incoming category three times at once — behind
 * the current page, and on the back face of the flipping layer — so a
 * per-instance guard would let the same list report two or three impressions
 * for one page turn. Over-counting is the one direction these numbers must
 * never fail in, so the guard lives where every instance shares it.
 *
 * Page-lifetime, so a shopper who flips back to a category they already saw
 * generates no second impression. That is deliberately the cautious side of the
 * trade: a repeat view of the same shelf in one visit is worth little, and
 * counting it is worth less than the risk of inflating the denominator.
 */
const reportedLists = new Set<string>();

/** Test seam — forget what this page has already reported. */
export const resetProductListImpressions = () => reportedLists.clear();

export const ProductListScope = ({ id, name, products, children }: {
  id: string;
  name: string;
  /** Exactly the products on screen — for a carousel, the visible window only. */
  products: Product[];
  /** Attach the ref to the element that holds the cards. */
  children: (ref: (node: Element | null) => void) => ReactNode;
}) => {
  const { ref, inView } = useInViewport();

  // Identity of THIS set of products, so swiping a carousel to a new window
  // reports the new impressions while a re-render reports nothing.
  const key = `${id}|${products.map((p) => p.id).join(",")}`;

  useEffect(() => {
    if (!inView || products.length === 0) return;
    if (reportedLists.has(key)) return;
    reportedLists.add(key);
    track("view_item_list", {
      list_id: id,
      list_name: name,
      item_count: products.length,
      line_items: lineItems(products.map((product) => ({ product }))),
    });
  }, [inView, key, id, name, products]);

  const list = useMemo(() => ({ id, name }), [id, name]);
  return <ProductListContext.Provider value={list}>{children(ref)}</ProductListContext.Provider>;
};

/**
 * The click that turns a grid of cards into a product page.
 *
 * One helper rather than a call at each of the four surfaces that render
 * products, so the props — and the 1-based position, which reads as "position 1
 * is the first card" — cannot drift apart between them.
 */
export const trackSelectItem = (product: Product, index: number, list: ProductListInfo | null) =>
  track("select_item", {
    product_id: product.id,
    name: product.name,
    price: priceToNumber(product.price),
    // 1-based, so "position 1" reads as the first card rather than the second.
    position: index + 1,
    ...(list ? { list_id: list.id, list_name: list.name } : {}),
  });
