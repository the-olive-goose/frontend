// The video admin is a free-text URL field, so what lands in it is whatever a
// share button produced. A shape toEmbedUrl doesn't recognise doesn't error —
// it falls through as a direct file src, fails isDirectVideo, and the reel
// renders the empty placeholder. That is exactly how a YouTube Shorts link
// (https://youtube.com/shorts/ID?si=…) sat live on the home page showing
// nothing. These cases pin the shapes the field claims to accept.
import { describe, it, expect } from "vitest";
import { toEmbedUrl, isEmbedUrl, isDirectVideo } from "./defaults";

/** What the rail does with a URL: iframe, <video>, or the empty placeholder. */
const renderAs = (raw: string) => {
  const embed = toEmbedUrl(raw);
  if (embed && isEmbedUrl(embed)) return "iframe";
  if (embed && isDirectVideo(embed)) return "video";
  return "placeholder";
};

describe("toEmbedUrl — YouTube", () => {
  const ID = "dQw4w9WgXcQ";

  it.each([
    ["watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["watch with params before v", "https://m.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ"],
    ["watch with params after v", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"],
    ["youtu.be", "https://youtu.be/dQw4w9WgXcQ"],
    ["youtu.be with share token", "https://youtu.be/dQw4w9WgXcQ?si=JtZcqcmQ5AO_F7hs"],
    ["shorts", "https://youtube.com/shorts/dQw4w9WgXcQ"],
    ["shorts with share token", "https://youtube.com/shorts/dQw4w9WgXcQ?si=mQNWnZJ4Qn48qtax"],
    ["live", "https://www.youtube.com/live/dQw4w9WgXcQ"],
  ])("embeds a %s link", (_name, raw) => {
    expect(toEmbedUrl(raw)).toBe(`https://www.youtube.com/embed/${ID}?rel=0`);
    expect(renderAs(raw)).toBe("iframe");
  });

  it("leaves an already-embedded URL alone", () => {
    const embed = `https://www.youtube-nocookie.com/embed/${ID}`;
    expect(toEmbedUrl(embed)).toBe(embed);
    expect(renderAs(embed)).toBe("iframe");
  });

  it("keeps IDs that start with a dash", () => {
    // The live studio rail runs one of these; a greedy `[^&?/]` class is fine
    // but an over-eager `\w` class would silently drop the leading dashes.
    expect(toEmbedUrl("https://youtube.com/shorts/--Q_WkPaXBY?si=x")).toBe(
      "https://www.youtube.com/embed/--Q_WkPaXBY?rel=0"
    );
  });
});

describe("toEmbedUrl — other sources", () => {
  it("embeds Vimeo", () => {
    expect(toEmbedUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(renderAs("https://vimeo.com/76979871")).toBe("iframe");
  });

  it.each([
    ["reel", "https://www.instagram.com/reel/DaAwNjpoSuB/"],
    ["post", "https://www.instagram.com/p/DaAwNjpoSuB/?igsh=abc"],
  ])("embeds an Instagram %s", (_name, raw) => {
    expect(renderAs(raw)).toBe("iframe");
  });

  it.each([
    ["mp4", "https://res.cloudinary.com/demo/video/upload/v1/dog.mp4"],
    ["webm", "https://cdn.example.com/reels/pour.webm"],
    ["mov", "https://cdn.example.com/reels/pour.mov"],
    ["query string", "https://cdn.example.com/reels/pour.mp4?token=abc"],
    ["site-relative file", "/videos/V2.mp4"],
  ])("plays a direct %s URL as a file", (_name, raw) => {
    expect(renderAs(raw)).toBe("video");
  });

  it("asks Cloudinary for .mp4 when the delivery URL has no extension", () => {
    expect(toEmbedUrl("https://res.cloudinary.com/demo/video/upload/f_auto,q_auto/v1/dog")).toBe(
      "https://res.cloudinary.com/demo/video/upload/f_auto,q_auto/v1/dog.mp4"
    );
    expect(renderAs("https://res.cloudinary.com/demo/video/upload/f_auto,q_auto/v1/dog")).toBe("video");
  });

  it("does not mangle a Cloudinary URL that already names a file", () => {
    const raw = "https://res.cloudinary.com/demo/video/upload/v1/dog.mp4";
    expect(toEmbedUrl(raw)).toBe(raw);
  });
});

describe("toEmbedUrl — what it can't rescue", () => {
  it.each([
    ["empty", ""],
    ["a Drive share page", "https://drive.google.com/file/d/abc123/view?usp=sharing"],
    ["a bare page URL", "https://example.com/our-video"],
  ])("falls back to the placeholder for %s", (_name, raw) => {
    expect(renderAs(raw)).toBe("placeholder");
  });
});
