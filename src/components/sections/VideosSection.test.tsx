import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VideosSection from "./VideosSection";
import type { VideosContent } from "@/lib/defaults";

/**
 * The rail's load budget.
 *
 * Six reels used to mount six autoplaying players at once. With phone footage
 * behind them that was ~330 MB of video and six hardware decoders on a device
 * that will give a tab neither, which is what crashed mobile browsers mid-scroll.
 * The rule that replaced it — only reels in view get a player, everything else
 * gets a ~40 KB still — is what these tests hold in place.
 *
 * "In view" is two tests, not one, and both are held here: the card has to be
 * the one being looked at *along the rail*, and the rail has to be on screen at
 * all. The second was missing for a while, which put ~15 MB of video and a live
 * decoder behind a section 2,700 px below the fold on every first load.
 */

const CLOUDINARY = "https://res.cloudinary.com/asravqmm/video/upload";

const content = (count: number): VideosContent => ({
  enabled: true,
  label: "IN THE STUDIO",
  headline: "Watch how it's made",
  subtext: "",
  ticker: [],
  items: Array.from({ length: count }, (_, i) => ({
    id: String(i),
    title: `Reel ${i}`,
    description: "",
    tag: "",
    video_url: `${CLOUDINARY}/v1785190731/reel${i}.mp4`,
  })),
});

const setViewport = (width: number) => {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
};

/**
 * What the stubbed observer reports. The rail asks it whether the section is on
 * screen, so a test that wants the un-scrolled-to homepage flips this to false
 * before rendering.
 */
let onScreen = true;

/** Every rootMargin the rail asked for, so the warm-up distance is testable. */
let observerMargins: string[] = [];

beforeEach(() => {
  // jsdom has no IntersectionObserver. Two things here want one: the rail, to
  // decide whether any player is worth mounting, and DirectVideo, to keep the
  // reel in focus playing when the phone tries to pause it. Reporting through
  // to the callback rather than swallowing it is what makes the rail's gate
  // testable at all.
  onScreen = true;
  observerMargins = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      if (options?.rootMargin) observerMargins.push(options.rootMargin);
    }
    observe(target: Element) {
      this.callback(
        [{ isIntersecting: onScreen, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve() {} disconnect() {} takeRecords() { return []; }
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const players = (container: HTMLElement) => container.querySelectorAll("video, iframe");
const posters = (container: HTMLElement) => container.querySelectorAll("img");

describe("VideosSection reel rail", () => {
  it("plays the reel in focus and warms the next, on a phone", () => {
    setViewport(375);
    const { container } = render(<VideosSection data={content(6)} />);

    // The reel being looked at, plus the one the next swipe will land on. A
    // player downloads nothing until it exists, so a reel mounted only once it
    // has been swiped to can never start instantly.
    expect(players(container)).toHaveLength(2);
    // Every card still shows something — the rest are ~40 KB stills.
    expect(posters(container).length).toBeGreaterThanOrEqual(5);
  });

  it("does not grow the number of players as reels are added", () => {
    setViewport(375);
    for (const count of [3, 6, 12, 40]) {
      const { container, unmount } = render(<VideosSection data={content(count)} />);
      // Two on a phone however long the rail is — the budget is what stops a
      // rail of forty reels from being forty downloads and forty decoders.
      expect(players(container), `${count} reels`).toHaveLength(2);
      unmount();
    }
  });

  it("mounts the neighbours too on a wide screen, where three cards are visible", () => {
    setViewport(1280);
    const { container } = render(<VideosSection data={content(6)} />);
    // Focused card plus one either side — capped, so a long rail stays bounded.
    expect(players(container).length).toBeLessThanOrEqual(3);
    expect(players(container).length).toBeGreaterThan(1);
  });

  it("mounts no player at all while the rail is still below the fold", () => {
    setViewport(375);
    onScreen = false;
    const { container } = render(<VideosSection data={content(6)} />);

    // A visitor who has only ever seen the hero pays for stills and nothing
    // else — no download, no decoder, for a section they have not reached.
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(posters(container).length).toBe(6);
  });

  it("mounts no player below the fold on a wide screen either", () => {
    setViewport(1280);
    onScreen = false;
    const { container } = render(<VideosSection data={content(6)} />);
    expect(players(container)).toHaveLength(0);
  });

  it("starts loading well before the rail arrives, not as it lands", () => {
    setViewport(375);
    render(<VideosSection data={content(6)} />);

    // A player only begins downloading once it is mounted, so mounting as the
    // rail touches the screen leaves the first reel a frozen still while the
    // visitor is already looking at it — measured at 1.6s on a 4G phone. Two
    // viewports of lead is what a brisk thumb flick needs to cover the distance
    // and still arrive on something moving. As a percentage, so it scales with
    // the device instead of assuming a phone.
    expect(observerMargins.some((margin) => /^\d+%/.test(margin) && parseInt(margin) >= 200)).toBe(true);
  });

  it("restarts a reel that is on screen but has stopped", async () => {
    vi.useFakeTimers();
    try {
      setViewport(375);
      const play = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
      const { container } = render(<VideosSection data={content(6)} />);
      const video = container.querySelector("video")!;
      // Whatever the browser did on mount, we start counting from here.
      play.mockClear();

      // The card is on screen and the reel is not moving. Nothing raises an
      // event to say so — an autoplay policy or a power-saving mode simply
      // refuses, and that is precisely the case a listener cannot catch.
      Object.defineProperty(video, "paused", { configurable: true, value: true });

      vi.advanceTimersByTime(3000);
      expect(play).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops watching a reel once it has left the screen", () => {
    vi.useFakeTimers();
    try {
      setViewport(375);
      onScreen = false;
      const play = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
      render(<VideosSection data={content(6)} />);
      play.mockClear();
      // Nothing is mounted below the fold, so nothing should be ticking.
      vi.advanceTimersByTime(5000);
      expect(play).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives unmounted cards a still derived from the video", () => {
    setViewport(375);
    const { container } = render(<VideosSection data={content(6)} />);
    const srcs = [...posters(container)].map(img => img.getAttribute("src") ?? "");
    expect(srcs.every(src => src.includes("so_0,f_jpg"))).toBe(true);
  });

  it("prefers a poster an admin set over the derived one", () => {
    setViewport(375);
    const data = content(2);
    data.items[1].poster_url = "https://example.com/chosen.jpg";
    const { container } = render(<VideosSection data={data} />);
    const srcs = [...posters(container)].map(img => img.getAttribute("src") ?? "");
    expect(srcs).toContain("https://example.com/chosen.jpg");
  });

  it("renders nothing at all when the section is switched off", () => {
    setViewport(375);
    const data = { ...content(6), enabled: false };
    const { container } = render(<VideosSection data={data} />);
    expect(players(container)).toHaveLength(0);
  });

  it("shows the skeleton rather than any player while content loads", () => {
    setViewport(375);
    const { container } = render(<VideosSection data={content(6)} ready={false} />);
    expect(players(container)).toHaveLength(0);
    expect(screen.queryByText("Watch how it's made")).toBeNull();
  });
});
