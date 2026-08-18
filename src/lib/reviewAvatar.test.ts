import { describe, it, expect } from "vitest";
import {
  durableAvatarUrl,
  isPubliclyFetchableOrigin,
  plainAvatarUrl,
  publicAvatarSource,
} from "./reviewAvatar";

const LIVE = "https://theolivegoose.ie";
const PATH = "/uploads/review-1786898805172-73e3b955c1dd.jpeg";

describe("isPubliclyFetchableOrigin", () => {
  it("accepts the live site", () => {
    expect(isPubliclyFetchableOrigin(LIVE)).toBe(true);
    expect(isPubliclyFetchableOrigin("https://frontend-production-a1bd.up.railway.app")).toBe(true);
  });

  it("rejects the machine the admin is sitting at", () => {
    // The dev dashboard edits live content, so anything resolved against these
    // would ship a URL only its author can load.
    for (const origin of [
      "http://localhost:8080",
      "https://localhost:8080",
      "https://127.0.0.1:3001",
      "https://[::1]:8080",
      "https://0.0.0.0:8080",
      "https://macbook.local:8080",
    ]) {
      expect(isPubliclyFetchableOrigin(origin), origin).toBe(false);
    }
  });

  it("rejects plain http and nonsense", () => {
    expect(isPubliclyFetchableOrigin("http://theolivegoose.ie")).toBe(false);
    expect(isPubliclyFetchableOrigin("")).toBe(false);
  });

  it("is not fooled by a public host that merely starts with a private one", () => {
    expect(isPubliclyFetchableOrigin("https://localhost.evil.com")).toBe(true);
    expect(isPubliclyFetchableOrigin("https://127.0.0.1.evil.com")).toBe(true);
  });
});

describe("durableAvatarUrl", () => {
  it("hands the photo to Cloudinary at its own public URL", () => {
    expect(durableAvatarUrl(PATH, LIVE)).toBe(
      `https://res.cloudinary.com/asravqmm/image/fetch/f_auto,q_auto,w_800,c_limit/${LIVE}${PATH}`
    );
  });

  it("sizes for the carousel card, not for a small circle", () => {
    // The testimonial photo is painted ~830px wide; 400 would arrive soft.
    expect(durableAvatarUrl(PATH, LIVE)).toContain("w_800");
  });

  it("uses the live site by default, whatever origin admin is open on", () => {
    // The dashboard is routinely driven from a dev server against the live DB,
    // and the customer uploaded the photo to the live site — so the default must
    // not follow the browser to localhost.
    expect(durableAvatarUrl(PATH)).toBe(
      `https://res.cloudinary.com/asravqmm/image/fetch/f_auto,q_auto,w_800,c_limit/${LIVE}${PATH}`
    );
  });

  it("declines rather than baking in an origin nobody else can reach", () => {
    expect(durableAvatarUrl(PATH, "http://localhost:8080")).toBe("");
  });

  it("declines on an empty or non-upload value", () => {
    expect(durableAvatarUrl("", LIVE)).toBe("");
    expect(durableAvatarUrl("   ", LIVE)).toBe("");
    expect(durableAvatarUrl("uploads/x.jpg", LIVE)).toBe("");
  });

  it("optimises a value that is already a full URL", () => {
    expect(durableAvatarUrl("https://i.ibb.co/abc/photo.jpg", LIVE)).toBe(
      "https://res.cloudinary.com/asravqmm/image/fetch/f_auto,q_auto,w_800,c_limit/https://i.ibb.co/abc/photo.jpg"
    );
  });

  it("re-sizes rather than wrapping a URL Cloudinary already serves", () => {
    // Cloudinary rejects a doubly-wrapped fetch URL outright, so promoting the
    // same review twice must not stack one chain on another.
    const once = durableAvatarUrl(PATH, LIVE);
    expect(durableAvatarUrl(once, LIVE)).toBe(once);
  });
});

describe("plainAvatarUrl", () => {
  it("keeps the server's own path, with no API base in front of it", () => {
    expect(plainAvatarUrl(PATH)).toBe(PATH);
    expect(plainAvatarUrl(`  ${PATH}  `)).toBe(PATH);
    expect(plainAvatarUrl("")).toBe("");
  });
});

describe("publicAvatarSource", () => {
  it("makes an already-stored path optimisable from admin", () => {
    expect(publicAvatarSource(PATH, LIVE)).toBe(`${LIVE}${PATH}`);
    expect(publicAvatarSource(PATH)).toBe(`${LIVE}${PATH}`);
  });

  it("leaves absolute and empty values alone", () => {
    expect(publicAvatarSource("https://i.ibb.co/abc/photo.jpg", LIVE)).toBe("https://i.ibb.co/abc/photo.jpg");
    expect(publicAvatarSource("", LIVE)).toBe("");
  });

  it("leaves the path alone when the origin is not reachable", () => {
    expect(publicAvatarSource(PATH, "http://localhost:8080")).toBe(PATH);
  });
});
