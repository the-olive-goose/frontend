import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { installMemoryStorage } from "@/test/memoryStorage";
import { onTrack } from "@/lib/analytics";
import type { Product } from "@/lib/defaults";
import {
  ProductListScope,
  resetProductListImpressions,
  trackSelectItem,
  useProductList,
} from "./ProductListScope";

/**
 * Impression counting is the one measurement here with no natural ceiling.
 * A click either happened or it didn't; an impression is a judgement about
 * whether something was "shown", and every easy version of that judgement
 * over-counts. Over-counting is the direction these numbers must never fail in
 * — it silently deflates click-through rate, which is the only thing an
 * item-list report is for.
 *
 * So each rule that holds the count down is pinned here.
 */

installMemoryStorage(); // this jsdom build ships without Web Storage

// jsdom has no IntersectionObserver, and useInViewport treats that as "assume
// visible" — which would make every test below pass for the wrong reason. This
// is a real one we can drive by hand.
type Watched = { cb: IntersectionObserverCallback; el: Element };
let watched: Watched[] = [];

class TestIntersectionObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) { watched.push({ cb: this.cb, el }); }
  unobserve() {}
  disconnect() { watched = watched.filter((w) => w.cb !== this.cb); }
  takeRecords() { return []; }
}

const setVisible = (isIntersecting: boolean) =>
  act(() => {
    for (const { cb, el } of [...watched]) {
      cb([{ isIntersecting, target: el } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });

// Priced the way the shop actually stores prices — an admin free-text field, and
// the bundled defaults are written "€38". A fixture of "25.00" would let a
// `Number(price)` bug through: it parses, so every assertion passes, and the
// defect only appears once someone types a euro sign into the admin panel.
const product = (id: string): Product =>
  ({ id, name: `Candle ${id}`, price: "€25" }) as Product;

type Recorded = { type: string; props: Record<string, unknown> };
let recorded: Recorded[] = [];
let stopRecording: (() => void) | null = null;

const impressions = () => recorded.filter((e) => e.type === "view_item_list");

const List = ({ id = "shelf", name = "Shelf", products }: { id?: string; name?: string; products: Product[] }) => (
  <ProductListScope id={id} name={name} products={products}>
    {(ref) => <div ref={ref}>{products.map((p) => <span key={p.id}>{p.name}</span>)}</div>}
  </ProductListScope>
);

beforeEach(() => {
  watched = [];
  recorded = [];
  resetProductListImpressions();
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    TestIntersectionObserver;
  stopRecording = onTrack((type, props) => { recorded.push({ type, props }); });
});

afterEach(() => {
  stopRecording?.();
  cleanup();
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe("when a list counts as shown", () => {
  it("reports nothing while it is off screen", () => {
    // The bug this replaces: firing on mount meant every visitor who read the
    // hero and left was recorded as having seen every rail further down the
    // home page. Impressions that only ever go up, for something nobody looked at.
    render(<List products={[product("1"), product("2")]} />);
    expect(impressions()).toHaveLength(0);
  });

  it("reports once it is actually scrolled to", () => {
    render(<List products={[product("1"), product("2")]} />);
    setVisible(true);
    expect(impressions()).toHaveLength(1);
    expect(impressions()[0].props).toMatchObject({
      list_id: "shelf",
      list_name: "Shelf",
      item_count: 2,
    });
  });

  it("reports the products that were on screen, not a whole catalogue", () => {
    // Carousels hand this the visible window only. Reporting everything behind
    // the swipe would credit impressions to cards nobody ever reached.
    render(<List products={[product("1"), product("2")]} />);
    setVisible(true);
    expect(impressions()[0].props.line_items).toEqual([
      { product_id: "1", name: "Candle 1", price: 25 },
      { product_id: "2", name: "Candle 2", price: 25 },
    ]);
  });

  it("never reports an empty list", () => {
    // An empty category or a search with no hits is not browsing the catalogue.
    render(<List products={[]} />);
    setVisible(true);
    expect(impressions()).toHaveLength(0);
  });
});

describe("what must not be counted twice", () => {
  it("stays at one across re-renders", () => {
    const products = [product("1")];
    const { rerender } = render(<List products={products} />);
    setVisible(true);
    // A new array identity every render is the normal case — these lists are
    // rebuilt by .map() on every pass.
    rerender(<List products={[product("1")]} />);
    rerender(<List products={[product("1")]} />);
    expect(impressions()).toHaveLength(1);
  });

  it("stays at one when the same list is mounted several times at once", () => {
    // THE case this guard exists for. The home page's flipbook renders the
    // incoming category up to three times simultaneously — behind the current
    // page, and on the back face of the flipping layer — so a per-component
    // guard would report two or three impressions for one page turn.
    render(
      <>
        <List id="category_cafe" products={[product("1")]} />
        <List id="category_cafe" products={[product("1")]} />
        <List id="category_cafe" products={[product("1")]} />
      </>
    );
    setVisible(true);
    expect(impressions()).toHaveLength(1);
  });

  it("stays at one when the visitor scrolls away and back", () => {
    render(<List products={[product("1")]} />);
    setVisible(true);
    setVisible(false);
    setVisible(true);
    expect(impressions()).toHaveLength(1);
  });
});

describe("what genuinely is a second impression", () => {
  it("reports the new window when a carousel is swiped", () => {
    const { rerender } = render(<List products={[product("1"), product("2")]} />);
    setVisible(true);
    rerender(<List products={[product("3"), product("4")]} />);
    expect(impressions()).toHaveLength(2);
    expect(impressions()[1].props.item_count).toBe(2);
  });

  it("keeps two different lists apart", () => {
    render(
      <>
        <List id="shop" name="All candles" products={[product("1")]} />
        <List id="recommendations" name="You may also like" products={[product("1")]} />
      </>
    );
    setVisible(true);
    expect(impressions().map((e) => e.props.list_id)).toEqual(["shop", "recommendations"]);
  });
});

describe("joining a click back to its impression", () => {
  it("hands the list down to the cards inside it", () => {
    const Card = ({ p }: { p: Product }) => {
      const list = useProductList();
      return <button onClick={() => trackSelectItem(p, 1, list)}>{p.name}</button>;
    };
    const { getByRole } = render(
      <ProductListScope id="category_cafe" name="Cafe Candles" products={[product("1")]}>
        {(ref) => <div ref={ref}><Card p={product("1")} /></div>}
      </ProductListScope>
    );
    setVisible(true);
    act(() => { getByRole("button").click(); });

    const select = recorded.find((e) => e.type === "select_item");
    expect(select?.props).toEqual({
      product_id: "1",
      name: "Candle 1",
      price: 25,
      position: 2,
      list_id: "category_cafe",
      list_name: "Cafe Candles",
    });
  });

  it("still reports a click from a card outside any list", () => {
    const Card = () => {
      const list = useProductList();
      return <button onClick={() => trackSelectItem(product("9"), 0, list)}>go</button>;
    };
    const { getByRole } = render(<Card />);
    act(() => { getByRole("button").click(); });

    const select = recorded.find((e) => e.type === "select_item");
    expect(select?.props).toMatchObject({ product_id: "9", position: 1 });
    expect(select?.props.list_id).toBeUndefined();
  });
});
