import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "@/test/memoryStorage";

/**
 * Engagement time — the metric a leader asks about straight after "how many
 * people", and the one this dashboard had no answer for at all.
 *
 * It lives in its own file deliberately. initAnalytics() registers listeners on
 * the shared jsdom `document`, and those SURVIVE vi.resetModules() — so a test
 * that boots the module in a file where earlier tests already did picks up their
 * flushes as well as its own, and an assertion about "the batch that was sent"
 * quietly becomes an assertion about eight of them.
 */

installMemoryStorage();

/** A fresh copy of the module, as a newly-opened tab would load it. */
const newTab = async () => {
  vi.resetModules();
  return import("./analytics");
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

// Engagement time is the metric a leader asks about after "how many people", and
// it is only worth reporting if it means what Google means by it: time the page
// was in the FOREGROUND AND VISIBLE. Wall-clock session length is a different
// number wearing the same name — a tab left open over lunch is not two hours of
// interest, and reporting it as such is how a dashboard ends up quoting
// engagement nobody would recognise.
describe("engagement time is foreground time", () => {
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("counts time in front and ignores time in a background tab", async () => {
    vi.useFakeTimers();
    const sent: Array<{ engagement_ms: number }> = [];
    vi.stubGlobal("fetch", vi.fn((_u: string, o: { body: string }) => {
      sent.push(JSON.parse(o.body));
      return Promise.resolve({ ok: true });
    }));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });

    const mod = await newTab();
    mod.initAnalytics();
    mod.track("page_view");

    vi.advanceTimersByTime(4000);   // four seconds actually reading
    setVisibility("hidden");        // → pauses the clock and flushes
    expect(sent).toHaveLength(1);
    expect(sent[0].engagement_ms).toBe(4000);

    // Twenty minutes in a background tab. None of it is engagement.
    vi.advanceTimersByTime(20 * 60 * 1000);
    setVisibility("visible");
    mod.track("page_view");
    vi.advanceTimersByTime(3000);
    setVisibility("hidden");

    // Asserted as a TOTAL, not per batch: where the flush interval happens to
    // fall inside the reading decides how the same seven seconds get split up,
    // and pinning the split would be pinning an accident. What must hold is that
    // the seconds are all there and the twenty idle minutes are not.
    const total = sent.reduce((n, b) => n + b.engagement_ms, 0);
    expect(total).toBe(7000); // 4s + 3s — not 1 207 000
    vi.useRealTimers();
  });

  it("carries the last slice out even when no event is left to carry it", async () => {
    vi.useFakeTimers();
    const sent: Array<{ engagement_ms: number; events: Array<{ type: string }> }> = [];
    vi.stubGlobal("fetch", vi.fn((_u: string, o: { body: string }) => {
      sent.push(JSON.parse(o.body));
      return Promise.resolve({ ok: true });
    }));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });

    const mod = await newTab();
    mod.initAnalytics();
    mod.track("page_view");

    // First hide. The web-vitals report fires here too and fills the queue, so
    // this batch has events of its own to carry the time — which is exactly why
    // it is not the interesting case.
    vi.advanceTimersByTime(2000);
    setVisibility("hidden");
    setVisibility("visible");
    const beforeTail = sent.length;

    // Now the shopper reads for eight more seconds and closes the tab. Vitals
    // have already reported, nothing new has been tracked, and the queue is
    // empty — so this time there is no event to attach the eight seconds to. It
    // is the dwell time on the page they actually left from, and losing it
    // shortened every visit the shop has ever measured.
    vi.advanceTimersByTime(8000);
    setVisibility("hidden");

    expect(sent.length).toBeGreaterThan(beforeTail);
    const tail = sent[sent.length - 1];
    expect(tail.events.map(e => e.type)).toContain("user_engagement");
    expect(tail.engagement_ms).toBe(8000);
    vi.useRealTimers();
  });

  it("sends a delta each time, so the server only ever adds up", async () => {
    vi.useFakeTimers();
    const sent: Array<{ engagement_ms: number }> = [];
    vi.stubGlobal("fetch", vi.fn((_u: string, o: { body: string }) => {
      sent.push(JSON.parse(o.body));
      return Promise.resolve({ ok: true });
    }));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });

    const mod = await newTab();
    mod.initAnalytics();
    mod.track("page_view");
    vi.advanceTimersByTime(5000);   // the flush interval fires
    mod.track("page_view");
    vi.advanceTimersByTime(5000);   // and again

    expect(sent.length).toBeGreaterThanOrEqual(2);
    // Each batch carries only its own slice. Cumulative totals here would have
    // the server counting the first five seconds twice.
    expect(sent[0].engagement_ms).toBe(5000);
    expect(sent[1].engagement_ms).toBe(5000);
    vi.useRealTimers();
  });
});

