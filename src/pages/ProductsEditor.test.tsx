import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProductsEditor } from "./AdminDashboard";
import type { Product, ProductsContent } from "@/lib/defaults";

/**
 * Display order is the only control an admin has over the Shop grid's sequence,
 * so the box has to hold "no number" as a real value — clearing it means "put
 * this one at the end", not "put it first".
 */

const product = (id: string, name: string, display_order?: number | null): Product => ({
  id, name, description: "", price: "25", image_url: "", tag: "",
  ...(display_order === undefined ? {} : { display_order }),
});

const setup = (items: Product[]) => {
  const onChange = vi.fn();
  const data: ProductsContent = { label: "", headline: "", subtext: "", items };
  render(
    <MemoryRouter>
      <ProductsEditor data={data} onChange={onChange} onSave={() => {}} saving={false} />
    </MemoryRouter>,
  );
  return onChange;
};

const orderBoxes = () => screen.getAllByLabelText("Display order") as HTMLInputElement[];

describe("products editor — display order", () => {
  it("shows each product's number, and an empty box when it has none", () => {
    setup([product("a", "Espresso", 2), product("b", "Vanilla")]);
    expect(orderBoxes().map(box => box.value)).toEqual(["2", ""]);
  });

  it("stores a typed number against that product only", () => {
    const onChange = setup([product("a", "Espresso", 2), product("b", "Vanilla", 1)]);
    fireEvent.change(orderBoxes()[1], { target: { value: "3" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      items: [
        expect.objectContaining({ id: "a", display_order: 2 }),
        expect.objectContaining({ id: "b", display_order: 3 }),
      ],
    }));
  });

  it("clears to null — unnumbered, not zero", () => {
    const onChange = setup([product("a", "Espresso", 2)]);
    fireEvent.change(orderBoxes()[0], { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ display_order: null })],
    }));
  });

  it("gives a newly added product the next free number", () => {
    const onChange = setup([product("a", "Espresso", 2), product("b", "Vanilla")]);
    fireEvent.click(screen.getByText("Add product"));

    const items = onChange.mock.calls[0][0].items as Product[];
    expect(items[items.length - 1].display_order).toBe(3);
  });

  it("leaves a new product unnumbered while the catalogue is unnumbered", () => {
    // Otherwise an admin who has never used this feature would find their newest
    // candle at the front of the shop instead of the end.
    const onChange = setup([product("a", "Espresso"), product("b", "Vanilla")]);
    fireEvent.click(screen.getByText("Add product"));

    const items = onChange.mock.calls[0][0].items as Product[];
    expect(items[items.length - 1].display_order).toBeNull();
  });

  it("can rearrange the admin list to match the shop grid", () => {
    const onChange = setup([product("a", "Espresso", 2), product("b", "Vanilla", 1)]);
    fireEvent.click(screen.getByText("Sort this list by display order"));

    const items = onChange.mock.calls[0][0].items as Product[];
    expect(items.map(p => p.id)).toEqual(["b", "a"]);
  });
});
