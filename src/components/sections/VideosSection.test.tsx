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

beforeEach(() => {
  // jsdom has neither of these, and DirectVideo uses both to keep the reel in
  // focus playing when the phone tries to pause it.
  vi.stubGlobal("IntersectionObserver", class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
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
  it("mounts one player on a phone no matter how many reels there are", () => {
    setViewport(375);
    const { container } = render(<VideosSection data={content(6)} />);

    // The reel in focus, and only it.
    expect(players(container)).toHaveLength(1);
    // Every card still shows something — five stills plus the focused card's own.
    expect(posters(container).length).toBeGreaterThanOrEqual(5);
  });

  it("does not grow the number of players as reels are added", () => {
    setViewport(375);
    for (const count of [3, 6, 12, 40]) {
      const { container, unmount } = render(<VideosSection data={content(count)} />);
      expect(players(container), `${count} reels`).toHaveLength(1);
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
