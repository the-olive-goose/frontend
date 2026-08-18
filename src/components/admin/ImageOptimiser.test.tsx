import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImageOptimiser from "./ImageOptimiser";
import { CLOUDINARY_CLOUD } from "@/lib/cloudinaryImage";

/**
 * The admin-side "Optimise for web" button for photos.
 *
 * The rule that matters most here is that nothing is written into the field
 * until the rewritten URL has been loaded and seen to work. Cloudinary has to
 * download the photo from wherever it is hosted and cannot always manage it —
 * measured against the live image host, a large file failed twice before going
 * through. A heavy photo is a problem; a stored URL that renders nothing is
 * worse, so a failed check must leave the original exactly where it was.
 */

const HUGE = "https://i.ibb.co/abc/IMG-0210.jpg";

/**
 * A stand-in for the browser's image loader. Every `new Image()` records the src
 * it was given and waits; the test then decides what that URL turns out to be.
 * Cloudinary reports a photo it could not fetch as a 1x1 placeholder rather than
 * a network error, so "loaded" and "worked" have to be separable here.
 */
let pending: { src: string; succeed: (w?: number, h?: number) => void; fail: () => void }[] = [];

beforeEach(() => {
  pending = [];
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    #src = "";
    set src(value: string) {
      this.#src = value;
      pending.push({
        src: value,
        succeed: (w = 4284, h = 5712) => { this.naturalWidth = w; this.naturalHeight = h; this.onload?.(); },
        fail: () => this.onerror?.(),
      });
    }
    get src() { return this.#src; }
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Resolve the component's initial "how big is this really?" probe. */
const settleFacts = async (width = 4284, height = 5712) => {
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  const probe = pending.shift()!;
  // The load fires outside React's own event flow, exactly as a real one would.
  act(() => probe.succeed(width, height));
};

describe("ImageOptimiser", () => {
  it("says nothing about a field with no photo in it", () => {
    const { container } = render(<ImageOptimiser url="" onOptimise={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing about a photo it could not help with anyway", () => {
    // Our own backend's uploads are not reachable under a relative path.
    const { container } = render(<ImageOptimiser url="/uploads/photo.jpg" onOptimise={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reports the photo's real size once it knows it", async () => {
    render(<ImageOptimiser url={HUGE} onOptimise={vi.fn()} />);
    await settleFacts();
    expect(await screen.findByText(/4284/)).toBeInTheDocument();
    expect(screen.getByText(/24\.5\s*megapixels/)).toBeInTheDocument();
  });

  it("does not cry wolf over a photo that is already a sensible size", async () => {
    render(<ImageOptimiser url={HUGE} onOptimise={vi.fn()} />);
    await settleFacts(700, 700);
    expect(screen.queryByText(/megapixels/)).toBeNull();
    // The offer is still there — just not as a warning.
    expect(screen.getByRole("button", { name: /optimise for web/i })).toBeInTheDocument();
  });

  it("stores the rewritten URL once it has checked that it loads", async () => {
    const onOptimise = vi.fn();
    render(<ImageOptimiser url={HUGE} onOptimise={onOptimise} />);
    await settleFacts();

    fireEvent.click(screen.getByRole("button", { name: /optimise for web/i }));
    // Nothing stored yet — the rewritten URL is still being checked.
    expect(onOptimise).not.toHaveBeenCalled();

    await waitFor(() => expect(pending.length).toBe(1));
    expect(pending[0].src).toBe(
      `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch/f_auto,q_auto,w_800,c_limit/${HUGE}`,
    );
    act(() => pending[0].succeed(800, 1066));

    await waitFor(() => expect(onOptimise).toHaveBeenCalledWith(
      `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch/f_auto,q_auto,w_800,c_limit/${HUGE}`,
    ));
  });

  it("stores nothing when Cloudinary cannot fetch the photo", async () => {
    const onOptimise = vi.fn();
    render(<ImageOptimiser url={HUGE} onOptimise={onOptimise} />);
    await settleFacts();

    fireEvent.click(screen.getByRole("button", { name: /optimise for web/i }));
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => pending[0].fail());

    expect(await screen.findByText(/could not download this photo/i)).toBeInTheDocument();
    expect(onOptimise).not.toHaveBeenCalled();
  });

  it("treats Cloudinary's 1x1 failure placeholder as a failure, not a success", async () => {
    const onOptimise = vi.fn();
    render(<ImageOptimiser url={HUGE} onOptimise={onOptimise} />);
    await settleFacts();

    fireEvent.click(screen.getByRole("button", { name: /optimise for web/i }));
    await waitFor(() => expect(pending.length).toBe(1));
    // 200 OK, decodes fine, and is a single transparent pixel.
    act(() => pending[0].succeed(1, 1));

    expect(await screen.findByText(/could not download this photo/i)).toBeInTheDocument();
    expect(onOptimise).not.toHaveBeenCalled();
  });

  it("offers the size the photo is actually shown at", async () => {
    const onOptimise = vi.fn();
    render(<ImageOptimiser url={HUGE} defaultSize="thumb" onOptimise={onOptimise} />);
    await settleFacts();

    fireEvent.click(screen.getByRole("button", { name: /optimise for web/i }));
    await waitFor(() => expect(pending.length).toBe(1));
    expect(pending[0].src).toContain("w_400");
  });

  it("shows an already-optimised photo as done, and can re-apply at another size", async () => {
    const done = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch/f_auto,q_auto,w_800,c_limit/${HUGE}`;
    const onOptimise = vi.fn();
    render(<ImageOptimiser url={done} onOptimise={onOptimise} />);
    await settleFacts();

    expect(screen.getByText(/✓ Optimised/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /optimise for web/i })).toBeNull();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "thumb" } });
    fireEvent.click(screen.getByRole("button", { name: /re-apply/i }));
    await waitFor(() => expect(pending.length).toBe(1));

    // Replaced, not wrapped — Cloudinary rejects a fetch URL inside a fetch URL.
    expect(pending[0].src.match(/\/image\/fetch\//g)).toHaveLength(1);
    expect(pending[0].src).toContain("w_400");
  });

  it("measures the original photo, not the optimised copy, once optimised", async () => {
    const done = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch/f_auto,q_auto,w_800,c_limit/${HUGE}`;
    render(<ImageOptimiser url={done} onOptimise={vi.fn()} />);
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    expect(pending[0].src).toBe(HUGE);
  });
});
