import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeSection,
  peekContent,
  primeContent,
  readContent,
  readContentFresh,
  resetContentCache,
  writeContent,
} from "./contentStore";

/**
 * The store is what stops the storefront painting bundled DEFAULT_* copy as if it
 * were real data, so the contract these tests pin is narrow but load-bearing:
 * "not known yet" must be distinguishable from "known and empty", and a section
 * must be fetched once per visit rather than once per component mount.
 */

const FALLBACK = { heading: "bundled heading", intro: "bundled intro" };

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetContentCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetContentCache();
});

describe("mergeSection", () => {
  it("keeps the fallback when the server has nothing stored", () => {
    expect(mergeSection(FALLBACK, null)).toEqual(FALLBACK);
    expect(mergeSection(FALLBACK, undefined)).toEqual(FALLBACK);
  });

  it("merges an object over the fallback so new fields still have a value", () => {
    expect(mergeSection(FALLBACK, { heading: "saved heading" })).toEqual({
      heading: "saved heading",
      intro: "bundled intro",
    });
  });

  it("replaces an array wholesale — its order and length are the admin's", () => {
    expect(mergeSection(["a", "b", "c"], ["x"])).toEqual(["x"]);
    // Notably: an emptied list stays empty rather than falling back to three items.
    expect(mergeSection(["a", "b", "c"], [])).toEqual([]);
  });
});

describe("peekContent", () => {
  it("returns undefined while the answer is genuinely unknown", () => {
    expect(peekContent("hero", FALLBACK)).toBeUndefined();
  });

  it("returns the fallback once the prime proves the section has no stored row", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ navbar: { links: [] } }));
    await primeContent();
    expect(peekContent("hero", FALLBACK)).toEqual(FALLBACK);
  });

  it("returns the merged value once primed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hero: { heading: "saved" } }));
    await primeContent();
    expect(peekContent("hero", FALLBACK)).toEqual({ heading: "saved", intro: "bundled intro" });
  });
});

describe("primeContent", () => {
  it("fetches once no matter how many callers ask", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ hero: { heading: "saved" } }));
    await Promise.all([primeContent(), primeContent(), primeContent()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/content$/);
  });

  it("never rejects when the endpoint is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(primeContent()).resolves.toBeUndefined();
  });
});

describe("readContent", () => {
  it("serves later callers from cache instead of re-fetching per mount", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ hero: { heading: "saved" } }));

    const first  = await readContent("hero", FALLBACK);
    const second = await readContent("hero", FALLBACK);

    expect(first).toEqual({ heading: "saved", intro: "bundled intro" });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the per-section route when the bulk endpoint is missing", async () => {
    // An older backend that doesn't serve GET /api/content yet.
    fetchMock.mockResolvedValueOnce(jsonResponse(null, false));
    fetchMock.mockResolvedValueOnce(jsonResponse({ heading: "from section route" }));

    const value = await readContent("hero", FALLBACK);

    expect(value).toEqual({ heading: "from section route", intro: "bundled intro" });
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/content\/hero$/);
  });

  it("dedupes concurrent per-section fetches", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, false));
    fetchMock.mockResolvedValue(jsonResponse({ heading: "from section route" }));

    await Promise.all([readContent("hero", FALLBACK), readContent("hero", FALLBACK)]);

    // One bulk attempt + exactly one section fetch shared by both callers.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hands back the fallback, not a hanging promise, when everything fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(readContent("hero", FALLBACK)).resolves.toEqual(FALLBACK);
    // And the answer counts as known, so callers stop showing skeletons.
    expect(peekContent("hero", FALLBACK)).toEqual(FALLBACK);
  });
});

describe("writeContent", () => {
  it("makes a save visible to the rest of the session", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hero: { heading: "old" } }));
    await primeContent();

    writeContent("hero", { heading: "just saved" });

    expect(peekContent("hero", FALLBACK)).toEqual({ heading: "just saved", intro: "bundled intro" });
  });
});

describe("readContentFresh", () => {
  it("bypasses the cache and refreshes it — the admin edits live values", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hero: { heading: "cached" } }));
    await primeContent();

    fetchMock.mockResolvedValueOnce(jsonResponse({ heading: "live" }));
    const value = await readContentFresh("hero", FALLBACK);

    expect(value).toEqual({ heading: "live", intro: "bundled intro" });
    expect(peekContent("hero", FALLBACK)).toEqual({ heading: "live", intro: "bundled intro" });
  });
});
