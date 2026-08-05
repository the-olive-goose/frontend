import { describe, expect, it } from "vitest";
import { newClsWindows, type LayoutShift } from "./analytics";

/**
 * Cumulative Layout Shift, checked against Google's definition rather than a
 * plausible-looking approximation of it.
 *
 * This matters more here than the arithmetic suggests. CLS is a *graded* metric:
 * 0.1 is a pass and 0.11 is a fail, in Search Console and in every report the
 * owner will ever compare this dashboard against. A number that drifts from the
 * standard is worse than no number, because it still gets acted on — and the
 * previous implementation drifted in the one direction that quietly punishes
 * success: it summed every shift for the life of the page, so on a single-page
 * storefront the score grew with how long someone browsed.
 */

const shift = (startTime: number, value: number, hadRecentInput = false): LayoutShift =>
  ({ startTime, value, hadRecentInput });

describe("CLS session windows", () => {
  it("is zero before anything shifts", () => {
    expect(newClsWindows().add([])).toBe(0);
  });

  it("adds up shifts that land close together", () => {
    // Three shifts inside one second — one burst, one score.
    const cls = newClsWindows();
    expect(cls.add([shift(100, 0.02), shift(400, 0.03), shift(700, 0.01)])).toBeCloseTo(0.06, 4);
  });

  it("starts a new window after a gap of a second or more", () => {
    const cls = newClsWindows();
    // 0.06 of shifting, then a quiet second, then 0.04. The score is the worse
    // of the two bursts — NOT 0.10, which is what summing everything gives and
    // which is exactly the threshold between a pass and a fail.
    const score = cls.add([
      shift(100, 0.02), shift(400, 0.04),
      shift(2000, 0.03), shift(2500, 0.01),
    ]);
    expect(score).toBeCloseTo(0.06, 4);
  });

  it("caps a window at five seconds even when shifts keep coming", () => {
    const cls = newClsWindows();
    // A shift every 800ms for eight seconds: never a 1s gap, so a naive
    // implementation treats it as one enormous window. The spec closes the
    // window at 5s regardless.
    const entries = Array.from({ length: 11 }, (_, i) => shift(i * 800, 0.02));
    // First window: 0ms–4800ms, seven shifts (0, 800 … 4800) → 0.14.
    expect(cls.add(entries)).toBeCloseTo(0.14, 4);
  });

  it("keeps the worst window, not the most recent one", () => {
    const cls = newClsWindows();
    const score = cls.add([
      shift(100, 0.20),                    // a bad burst early on
      shift(5000, 0.01), shift(5500, 0.01), // a mild one later
    ]);
    expect(score).toBeCloseTo(0.20, 4);
  });

  it("ignores shifts the shopper asked for", () => {
    const cls = newClsWindows();
    // Opening a menu moves the page; the browser flags it, and the spec excludes
    // it. Counting it would score the site down for responding to a tap.
    expect(cls.add([shift(100, 0.5, true), shift(200, 0.03)])).toBeCloseTo(0.03, 4);
  });

  it("accumulates across batches the way the observer delivers them", () => {
    // PerformanceObserver fires repeatedly with whatever has arrived since last
    // time, so window state has to survive between calls. Splitting one burst
    // across two callbacks must not split it into two windows.
    const cls = newClsWindows();
    cls.add([shift(100, 0.02)]);
    expect(cls.add([shift(400, 0.03)])).toBeCloseTo(0.05, 4);
  });

  it("does not let a long quiet visit inflate the score", () => {
    // The defect this replaces, stated as a test: twenty small, well-separated
    // shifts over twenty minutes. Summed, that is 0.40 — a "Poor" grade. Scored
    // properly it is 0.02, because no single burst was ever perceptible.
    const cls = newClsWindows();
    const entries = Array.from({ length: 20 }, (_, i) => shift(i * 60_000, 0.02));
    expect(cls.add(entries)).toBeCloseTo(0.02, 4);
  });
});
