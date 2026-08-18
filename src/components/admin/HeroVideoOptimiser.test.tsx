import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HeroVideoOptimiser from "./HeroVideoOptimiser";

/**
 * The admin half of the hero background clip.
 *
 * What it writes is what ships — nothing rewrites a stored URL at render time —
 * so these tests are about the stored values: two encodes, not one, and a still
 * filled in only when the admin has not chosen a photo of their own.
 */

const ORIGINAL = "https://res.cloudinary.com/asravqmm/video/upload/v1785190731/hero_a1b2c3.mov";

/** Every `<video>` the component made, so a test can answer its probes. */
let probes: HTMLVideoElement[] = [];

beforeEach(() => {
  probes = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const el = create(tag, options);
    if (tag === "video") probes.push(el as HTMLVideoElement);
    return el;
  });
});

afterEach(() => vi.restoreAllMocks());

/**
 * jsdom parses a `<video>` but never loads one, so nothing it is given ever
 * resolves on its own. Answering the probe by hand is what makes the component's
 * "check it works before storing it" rule testable at all.
 */
const answerProbe = (index: number, event: "loadedmetadata" | "error", facts = { width: 3840, height: 2160, seconds: 34 }) => {
  const probe = probes[index];
  if (!probe) throw new Error(`no probe ${index} — the component made ${probes.length}`);
  if (event === "loadedmetadata") {
    Object.defineProperty(probe, "videoWidth", { configurable: true, value: facts.width });
    Object.defineProperty(probe, "videoHeight", { configurable: true, value: facts.height });
    Object.defineProperty(probe, "duration", { configurable: true, value: facts.seconds });
  }
  fireEvent(probe, new Event(event));
};

describe("HeroVideoOptimiser", () => {
  it("stays out of the way until there is a video URL", () => {
    const { container } = render(<HeroVideoOptimiser url="" onOptimise={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();

    // An image URL in the field is not a video, whatever else it is.
    const { container: photo } = render(
      <HeroVideoOptimiser url="https://cdn.example.com/hero.jpg" onOptimise={vi.fn()} />,
    );
    expect(photo).toBeEmptyDOMElement();
  });

  it("writes a desktop and a phone encode, plus a still, in one press", async () => {
    const onOptimise = vi.fn();
    render(<HeroVideoOptimiser url={ORIGINAL} onOptimise={onOptimise} />);

    answerProbe(0, "loadedmetadata");
    fireEvent.click(await screen.findByRole("button", { name: /optimise for web/i }));
    answerProbe(1, "loadedmetadata");

    await waitFor(() => expect(onOptimise).toHaveBeenCalledTimes(1));
    const { video, mobile, poster } = onOptimise.mock.calls[0][0];
    // A phone must never be handed the desktop encode: it decodes every pixel
    // it then throws away.
    expect(video).toContain("w_1440,c_limit,q_auto:good,ac_none");
    expect(mobile).toContain("w_960,c_limit,q_auto:eco,ac_none");
    expect(poster).toContain("so_0,f_jpg");
    // Silent by construction — the hero is muted, so the audio track is waste.
    expect(video).toContain("ac_none");
  });

  it("stores nothing when the rewritten URL does not load", async () => {
    // A heavy background is a problem; a broken one is worse.
    const onOptimise = vi.fn();
    render(<HeroVideoOptimiser url={ORIGINAL} onOptimise={onOptimise} />);

    answerProbe(0, "loadedmetadata");
    fireEvent.click(await screen.findByRole("button", { name: /optimise for web/i }));
    answerProbe(1, "error");

    await screen.findByText(/would not load/i);
    expect(onOptimise).not.toHaveBeenCalled();
  });

  it("trims the loop to the first seconds only when asked", async () => {
    const onOptimise = vi.fn();
    render(<HeroVideoOptimiser url={ORIGINAL} onOptimise={onOptimise} />);

    answerProbe(0, "loadedmetadata");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /optimise for web/i }));
    answerProbe(1, "loadedmetadata");

    await waitFor(() => expect(onOptimise).toHaveBeenCalled());
    expect(onOptimise.mock.calls[0][0].video).toContain("so_0,du_10");
    expect(onOptimise.mock.calls[0][0].mobile).toContain("so_0,du_10");
  });

  it("says what the clip actually is, which is the whole diagnosis", async () => {
    render(<HeroVideoOptimiser url={ORIGINAL} onOptimise={vi.fn()} />);
    answerProbe(0, "loadedmetadata", { width: 3840, height: 2160, seconds: 34 });

    // A 4K 34-second clip looks perfect in the admin preview; what it costs is
    // invisible until it is the first thing a phone meets.
    expect(await screen.findByText(/3840/)).toBeInTheDocument();
    expect(screen.getByText(/34 seconds long/)).toBeInTheDocument();
    expect(screen.getByText(/loops for as long as someone is on the page/)).toBeInTheDocument();
  });

  it("reports an already-optimised URL instead of warning about it again", async () => {
    const done = "https://res.cloudinary.com/asravqmm/video/upload/f_mp4,vc_h264,w_1440,c_limit,q_auto:good,ac_none/v1/hero.mp4";
    render(<HeroVideoOptimiser url={done} onOptimise={vi.fn()} />);
    answerProbe(0, "loadedmetadata", { width: 1440, height: 810, seconds: 8 });

    expect(await screen.findByText(/✓ Optimised/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-apply/i })).toBeInTheDocument();
  });

  it("is honest that a clip hosted elsewhere cannot be optimised here", async () => {
    render(<HeroVideoOptimiser url="https://cdn.example.com/loop.mp4" onOptimise={vi.fn()} />);
    answerProbe(0, "loadedmetadata", { width: 1920, height: 1080, seconds: 12 });

    expect(await screen.findByText(/not hosted on Cloudinary/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /optimise/i })).not.toBeInTheDocument();
  });
});

describe("HeroVideoOptimiser for phones", () => {
  it("encodes at the phone width with no tier to choose", async () => {
    // A clip chosen *for* phones has one sensible size. Offering "Sharp — large
    // desktop screens" against it would be offering the wrong thing.
    const onOptimise = vi.fn();
    render(<HeroVideoOptimiser url={ORIGINAL} target="mobile" onOptimise={onOptimise} />);

    answerProbe(0, "loadedmetadata", { width: 1080, height: 1920, seconds: 6 });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /optimise for web/i }));
    answerProbe(1, "loadedmetadata");

    await waitFor(() => expect(onOptimise).toHaveBeenCalled());
    const { video, mobile } = onOptimise.mock.calls[0][0];
    expect(video).toContain("w_960,c_limit,q_auto:eco,ac_none");
    // Both names carry the same URL: for a phone clip there is no second encode.
    expect(mobile).toBe(video);
  });

  it("still offers the trim, which is what a looping background needs most", async () => {
    const onOptimise = vi.fn();
    render(<HeroVideoOptimiser url={ORIGINAL} target="mobile" onOptimise={onOptimise} />);

    answerProbe(0, "loadedmetadata");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /optimise for web/i }));
    answerProbe(1, "loadedmetadata");

    await waitFor(() => expect(onOptimise).toHaveBeenCalled());
    expect(onOptimise.mock.calls[0][0].video).toContain("so_0,du_10");
  });
});
