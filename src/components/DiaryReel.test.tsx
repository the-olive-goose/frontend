import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiaryReel, DiaryReelViewer } from "./DiaryReel";
import type { OurStoryPhoto } from "@/lib/defaults";

/**
 * The diary's load budget.
 *
 * A diary entry is an untouched phone capture: the photos are 1–3 MB each and a
 * Cloudinary video whose URL still points at the original upload is 35–100 MB.
 * The reel used to mount every slide the moment the candle was blown out, so a
 * ten-entry diary began downloading all of itself at once and the one photo the
 * visitor could actually see queued behind the nine they couldn't. The rule that
 * replaced it — only the slide being read and its immediate neighbours hold real
 * media, everything else holds a ~40 KB still or nothing — is what these tests
 * hold in place.
 */

const CLOUDINARY = "https://res.cloudinary.com/asravqmm/video/upload";

const photo = (id: number, url: string): OurStoryPhoto => ({
  id: `diary-${id}`,
  image_url: url,
  caption: `Entry ${id}`,
});

/** Six stills and four phone videos — the shape of the real diary. */
const mixedDiary = (): OurStoryPhoto[] => [
  photo(0, "https://i.ibb.co/a/one.jpg"),
  photo(1, `${CLOUDINARY}/v1785628891/clip-a.mov`),
  photo(2, `${CLOUDINARY}/v1785629716/clip-b.mov`),
  photo(3, "https://i.ibb.co/b/two.avif"),
  photo(4, `${CLOUDINARY}/v1785630179/clip-c.mov`),
  photo(5, `${CLOUDINARY}/v1785631006/clip-d.mov`),
  photo(6, "https://i.ibb.co/c/three.jpg"),
  photo(7, "https://i.ibb.co/d/four.png"),
  photo(8, "https://i.ibb.co/e/five.png"),
  photo(9, "https://i.ibb.co/f/six.avif"),
];

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every URL the reel has actually asked the network for. */
const fetched = (container: HTMLElement) => [
  ...[...container.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? ""),
  ...[...container.querySelectorAll("video")].map((video) => video.getAttribute("src") ?? ""),
  ...[...container.querySelectorAll("iframe")].map((frame) => frame.getAttribute("src") ?? ""),
];

/** Real media, as opposed to a ~40 KB poster still (which ends `.jpg`). */
const originals = (container: HTMLElement) =>
  fetched(container).filter((src) => /i\.ibb\.co/.test(src) || /\.(mov|mp4)$/.test(src));

/** The rail's derived cut of a stored clip — never the stored clip itself. */
const RAIL = "f_mp4,vc_h264,w_720,c_limit,q_auto:eco";

describe("DiaryReel load budget", () => {
  it("leaves every slide past the first neighbour unfetched", () => {
    const { container } = render(
      <DiaryReel photos={mixedDiary()} handle="The Olive Goose" onExpand={() => {}} />,
    );

    // All ten slides exist — the rail's height and its snap points depend on it.
    expect(container.querySelectorAll(".og-diary-slide")).toHaveLength(10);

    // Slide 0 is the photo being read and slide 1 is its neighbour. The eight
    // behind them are worth nothing until they are flicked towards.
    expect(originals(container)).toEqual([
      "https://i.ibb.co/a/one.jpg", // the photo itself…
      "https://i.ibb.co/a/one.jpg", // …and the blur behind it, one decode
      `${CLOUDINARY}/${RAIL}/v1785628891/clip-a.mp4`,
    ]);
    expect(container.querySelectorAll(".og-diary-wait").length).toBeGreaterThan(0);

    // The stored .mov is 35–100 MB. Whatever the diary mounts, it is never that
    // — the ceiling is the code's, not the admin's.
    expect(fetched(container).some((src) => src.endsWith(".mov"))).toBe(false);
  });

  it("shows an out-of-window video as its Cloudinary still, not a black frame", () => {
    const { container } = render(
      <DiaryReel photos={mixedDiary()} handle="The Olive Goose" onExpand={() => {}} />,
    );

    const stills = fetched(container).filter((src) => src.includes("so_0,f_jpg"));
    // Slides 2, 4 and 5 are videos out of the window: a still each, and the
    // blur behind it reuses the same URL.
    expect(new Set(stills).size).toBe(3);
    for (const still of stills) expect(still).toContain("w_640");
    expect(stills.some((src) => src.endsWith(".mov"))).toBe(false);
  });

  it("buffers the very next slide, so a flick lands on a moving frame", () => {
    const { container } = render(
      <DiaryReel photos={mixedDiary()} handle="The Olive Goose" onExpand={() => {}} />,
    );

    const videos = [...container.querySelectorAll("video")];
    expect(videos).toHaveLength(1); // the neighbour at index 1
    // The diary opens on slide 0 (a photo), so slide 1 is the next thing the
    // visitor will see. A video that only starts loading once it becomes the
    // active slide sits on its still for over a second — long enough to read as
    // broken — so the slide about to arrive is warmed now.
    expect(videos[0].getAttribute("preload")).toBe("auto");
    // The still stays underneath regardless, so there is never a black frame.
    expect(videos[0].getAttribute("poster")).toContain("so_0,f_jpg");
  });

  it("warms exactly one slide ahead, never a window of them", () => {
    // Opening deep into the diary puts videos on both sides of the reader.
    // Only the one ahead may buffer: these are 1080p captures, and a stack of
    // them downloading at once is the thing a phone cannot take.
    const { container } = render(
      <DiaryReelViewer photos={mixedDiary()} handle="The Olive Goose" index={2} onClose={() => {}} />,
    );
    const preloads = [...container.querySelectorAll("video")].map((v) => v.getAttribute("preload"));
    expect(preloads.filter((p) => p === "auto").length).toBeLessThanOrEqual(2);
  });

  it("opens the viewer on the photo asked for, not on the first one", () => {
    const { container } = render(
      <DiaryReelViewer photos={mixedDiary()} handle="The Olive Goose" index={6} onClose={() => {}} />,
    );

    // Entry 6 is a still, and entry 7 behind it comes along for the flick.
    // Nothing else does — not even entry 5, because in the viewer a video is a
    // player asking for sound, so only the slide being read may hold one.
    expect(originals(container)).toEqual([
      "https://i.ibb.co/c/three.jpg",
      "https://i.ibb.co/c/three.jpg",
      "https://i.ibb.co/d/four.png",
      "https://i.ibb.co/d/four.png",
    ]);
    expect(container.querySelectorAll("video")).toHaveLength(0);
    // Entry 5 is still a picture rather than a black frame — its first frame.
    expect(fetched(container).filter((src) => src.includes("clip-d"))).toEqual([
      `${CLOUDINARY}/so_0,f_jpg,q_auto,w_640,c_limit/v1785631006/clip-d.jpg`,
      `${CLOUDINARY}/so_0,f_jpg,q_auto,w_640,c_limit/v1785631006/clip-d.jpg`,
    ]);
  });

  it("keeps a diary of plain photos to three slides of media", () => {
    const stills = Array.from({ length: 12 }, (_, i) => photo(i, `https://i.ibb.co/x/p${i}.jpg`));
    const { container } = render(
      <DiaryReel photos={stills} handle="The Olive Goose" onExpand={() => {}} />,
    );

    // Two slides in the window at the top of the rail, each with its blur twin.
    expect(new Set(originals(container)).size).toBe(2);
  });
});
