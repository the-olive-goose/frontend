import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HeroSection from "./HeroSection";
import { DEFAULT_CONTENT, type HeroContent } from "@/lib/defaults";

/**
 * The hero's background load budget.
 *
 * The background clip is the only video on the site that every visitor meets,
 * on the first paint, looping for as long as they stay. That makes the rules
 * about when it is *not* loaded the important part: the still image is a
 * complete hero on its own, so anything doubtful — reduced motion, a metered
 * connection, a slow one, a scroll past the section — resolves to the still.
 *
 * These tests hold that budget, and hold the two encodes apart: a phone is sent
 * the phone's copy, never the desktop one it would decode in full to paint 390
 * pixels of.
 */

const CLOUDINARY = "https://res.cloudinary.com/asravqmm/video/upload";
const DESKTOP_VIDEO = `${CLOUDINARY}/f_mp4,vc_h264,w_1440,c_limit,q_auto:good,ac_none/v1/hero.mp4`;
const MOBILE_VIDEO = `${CLOUDINARY}/f_mp4,vc_h264,w_960,c_limit,q_auto:eco,ac_none/v1/hero.mp4`;
const STILL = "https://res.cloudinary.com/asravqmm/image/upload/w_1600/still.jpg";

const hero = (patch: Partial<HeroContent> = {}): HeroContent => ({
  ...DEFAULT_CONTENT.hero,
  bg_image_url: STILL,
  bg_video_url: DESKTOP_VIDEO,
  bg_video_mobile_url: MOBILE_VIDEO,
  ...patch,
});

/** What matchMedia reports, keyed by the query the component asks for. */
let media: Record<string, boolean> = {};
/** What navigator.connection reports, or undefined for a browser without it. */
let connection: { saveData?: boolean; effectiveType?: string } | undefined;
/** Whether the hero is on screen, as the stubbed observer sees it. */
let onScreen = true;

beforeEach(() => {
  media = {};
  connection = { saveData: false, effectiveType: "4g" };
  onScreen = true;

  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: !!media[query],
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

  // jsdom has no IntersectionObserver; the hero uses one to release the decoder
  // once the visitor has scrolled past.
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ isIntersecting: onScreen, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve() {} disconnect() {} takeRecords() { return []; }
  });

  Object.defineProperty(navigator, "connection", {
    configurable: true,
    get: () => connection,
  });

  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Render, then let the still finish loading — the clip is deliberately held
 * back until it has, so a test that skipped this would see the "before" state
 * of every case rather than the one it meant to assert.
 */
const renderHero = (data: HeroContent = hero(), ready = true) => {
  const view = render(
    <MemoryRouter><HeroSection data={data} ready={ready} /></MemoryRouter>,
  );
  const still = view.container.querySelector("img");
  if (still) fireEvent.load(still);
  return view;
};

const video = (container: HTMLElement) => container.querySelector("video");

describe("hero background video", () => {
  it("plays the desktop encode over the still on a desktop", () => {
    const { container } = renderHero();
    expect(video(container)).toHaveAttribute("src", DESKTOP_VIDEO);
    // The still is still there underneath, so there is never a black frame.
    expect(container.querySelector("img")).toHaveAttribute("src", STILL);
  });

  it("sends a phone its own narrower encode", () => {
    media["(max-width: 639px)"] = true;
    const { container } = renderHero();
    expect(video(container)).toHaveAttribute("src", MOBILE_VIDEO);
  });

  it("loads nothing at all when no clip is configured", () => {
    const { container } = renderHero(hero({ bg_video_url: "", bg_video_mobile_url: "" }));
    expect(video(container)).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", STILL);
  });

  it("shows only the still when the visitor asked for reduced motion", () => {
    media["(prefers-reduced-motion: reduce)"] = true;
    expect(video(renderHero().container)).toBeNull();
  });

  it("shows only the still on Save-Data or a slow connection", () => {
    connection = { saveData: true, effectiveType: "4g" };
    expect(video(renderHero().container)).toBeNull();

    connection = { saveData: false, effectiveType: "3g" };
    expect(video(renderHero().container)).toBeNull();
  });

  it("plays where the browser reports no connection at all", () => {
    // Safari has no navigator.connection; that is not evidence of a slow one.
    connection = undefined;
    expect(video(renderHero().container)).toHaveAttribute("src", DESKTOP_VIDEO);
  });

  it("mounts no player while the hero is scrolled past", () => {
    onScreen = false;
    expect(video(renderHero().container)).toBeNull();
  });

  it("holds the clip back until the still has painted", () => {
    // The still is the hero's LCP image. Racing the clip against it is what
    // leaves the headline sitting over an empty frame on a phone.
    const { container } = render(
      <MemoryRouter><HeroSection data={hero()} /></MemoryRouter>,
    );
    expect(video(container)).toBeNull();

    fireEvent.load(container.querySelector("img")!);
    expect(video(container)).toHaveAttribute("src", DESKTOP_VIDEO);
  });

  it("still plays when the still image fails to load", () => {
    // Waiting on a load event that is never coming would leave a hero with
    // neither a photo nor a clip.
    const { container } = render(
      <MemoryRouter><HeroSection data={hero()} /></MemoryRouter>,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(video(container)).toHaveAttribute("src", DESKTOP_VIDEO);
  });

  it("autoplays muted and inline, which is the only way a phone will play it", () => {
    const el = video(renderHero().container)!;
    expect(el).toHaveAttribute("autoplay");
    expect(el).toHaveAttribute("playsinline");
    expect(el).toHaveAttribute("loop");
    expect((el as HTMLVideoElement).muted).toBe(true);
    // Decoration: it carries nothing the still and its alt text do not.
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("takes the decorative emoji off a hero that has a clip", () => {
    // Pinned stickers read as part of a still photograph. Over moving footage
    // they read as three emoji stuck to the screen.
    const { container } = renderHero();
    expect(container.textContent).not.toContain("✨");
    expect(container.textContent).not.toContain("🌿");
    expect(container.textContent).not.toContain("🕯️");
  });

  it("keeps them on a hero that is still a photograph", () => {
    const { container } = renderHero(hero({ bg_video_url: "", bg_video_mobile_url: "" }));
    expect(container.textContent).toContain("✨");
  });

  it("takes them off for everyone, not only whoever the clip plays for", () => {
    // Otherwise a visitor on reduced motion gets a different hero layout from
    // the one next to them, decided by a setting neither of them can see.
    media["(prefers-reduced-motion: reduce)"] = true;
    const { container } = renderHero();
    expect(video(container)).toBeNull();
    expect(container.textContent).not.toContain("✨");
  });

  it("leaves the clip out of the way of a finger and of AirPlay", () => {
    // A long press on a background video offers "Save Video" over the headline,
    // and an untouched one can be picked up by AirPlay as if it were content.
    const el = video(renderHero().container)!;
    expect(el).toHaveStyle({ pointerEvents: "none" });
    expect(el).toHaveAttribute("disablepictureinpicture");
    expect(el).toHaveAttribute("disableremoteplayback");
  });

  it("keeps the headline and CTA above the background", () => {
    renderHero();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /shop/i })).toBeInTheDocument();
  });

  it("offers phones a narrow copy of the photo and desktops the admin's own URL", () => {
    const { container } = renderHero();

    // The stored URL stays the <img> src: it is what desktops load, and the
    // fallback for any browser that ignores <source>.
    expect(container.querySelector("img")).toHaveAttribute("src", STILL);

    const phone = container.querySelector('source[media="(max-width: 639px)"]')!;
    expect(phone).toBeInTheDocument();
    expect(phone).toHaveAttribute("sizes", "100vw");
    // Narrower than the 1600px still, so a phone is not sent the whole picture
    // to crop for itself.
    expect(phone.getAttribute("srcset")).toContain("w_400,");
  });

  it("sends phones the admin's crop when one is saved", () => {
    const crop = "https://res.cloudinary.com/asravqmm/image/upload/c_crop,x_0.5,y_0,w_0.26,h_0.99/f_auto,q_auto,w_800,h_903,c_fill/v1/hero.jpg";
    const { container } = renderHero(hero({ bg_image_mobile_url: crop }));

    // The admin's own framing, untouched — and only for phones. Larger screens
    // still show the photo they chose.
    expect(container.querySelector('source[media="(max-width: 639px)"]'))
      .toHaveAttribute("srcset", crop);
    expect(container.querySelector('source[media="(max-width: 1023px)"]')?.getAttribute("srcset"))
      .toContain("c_fill,g_center");
    expect(container.querySelector("img")).toHaveAttribute("src", STILL);
  });

  it("leaves a photo Cloudinary cannot re-cut to the plain img", () => {
    const { container } = renderHero(hero({ bg_image_url: "/uploads/hero.jpg" }));

    expect(container.querySelectorAll("source")).toHaveLength(0);
    expect(container.querySelector("img")).toHaveAttribute("src", "/uploads/hero.jpg");
  });

  it("dims the whole background once, not the photo and the clip separately", () => {
    // Brightness on both layers would compound where they overlap and the hero
    // would brighten as the clip faded in.
    const { container } = renderHero(hero({ bg_opacity: 0.5 }));
    // The layer wraps the <picture> and the clip together — the photo's own
    // parent is the <picture> the responsive sources hang off.
    const layer = container.querySelector("picture")!.parentElement!;
    expect(layer).toHaveStyle({ opacity: "0.5" });
    expect(container.querySelector("picture")).not.toHaveStyle({ opacity: "0.5" });
    expect(container.querySelector("img")).not.toHaveStyle({ opacity: "0.5" });
  });
});
