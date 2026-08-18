import { describe, expect, it } from "vitest";
import { resolveHeroVideoSrc, type HeroVideoEnv } from "./heroVideo";

const DESKTOP = "https://res.cloudinary.com/asravqmm/video/upload/w_1440/v1/hero.mp4";
const MOBILE = "https://res.cloudinary.com/asravqmm/video/upload/w_960/v1/hero.mp4";

/** A laptop on a good connection with no accessibility preference set. */
const base: HeroVideoEnv = {
  isMobileViewport: false,
  reducedMotion: false,
  saveData: false,
  effectiveType: "4g",
};

const src = (env: Partial<HeroVideoEnv>, sources = { desktop: DESKTOP, mobile: MOBILE }) =>
  resolveHeroVideoSrc(sources, { ...base, ...env });

describe("resolveHeroVideoSrc", () => {
  it("plays the desktop encode on a desktop and the phone one on a phone", () => {
    expect(src({})).toBe(DESKTOP);
    expect(src({ isMobileViewport: true })).toBe(MOBILE);
  });

  it("costs nothing when no clip is configured", () => {
    expect(resolveHeroVideoSrc({}, base)).toBe("");
    expect(resolveHeroVideoSrc({ desktop: "   " }, base)).toBe("");
  });

  it("withholds it entirely from a visitor who asked for reduced motion", () => {
    // A looping background is the thing that setting exists to stop, so this
    // holds on desktop and on a fast connection too.
    expect(src({ reducedMotion: true })).toBe("");
    expect(src({ reducedMotion: true, isMobileViewport: true })).toBe("");
  });

  it("withholds it on Save-Data and on connections slower than 4g", () => {
    expect(src({ saveData: true })).toBe("");
    expect(src({ effectiveType: "3g" })).toBe("");
    expect(src({ effectiveType: "2g" })).toBe("");
    expect(src({ effectiveType: "slow-2g" })).toBe("");
  });

  it("plays where the browser reports nothing about the connection", () => {
    // Safari reports no connection at all; that is not evidence of a slow one.
    expect(src({ effectiveType: undefined })).toBe(DESKTOP);
  });

  it("falls back to the encode that exists when only one was saved", () => {
    // An admin who pasted a URL without pressing Optimise still gets a working
    // background; the warning about its weight belongs in the admin panel.
    expect(src({ isMobileViewport: true }, { desktop: DESKTOP, mobile: "" })).toBe(DESKTOP);
    expect(src({}, { desktop: "", mobile: MOBILE })).toBe(MOBILE);
  });

  it("never sends a desktop the phone encode when both exist", () => {
    // It would be upscaled across the width of a monitor.
    expect(src({})).not.toBe(MOBILE);
  });
});
