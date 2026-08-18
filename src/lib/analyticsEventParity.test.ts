import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// The event vocabulary exists twice: `EventType` here in the storefront, and
// CLIENT_EVENT_TYPES in backend/index.js, which is an allow-list — an event
// whose name the backend doesn't recognise is dropped on ingestion, silently
// and permanently.
//
// That makes drift here uniquely expensive. Every other kind of mismatch shows
// up as an error somewhere; this one shows up as a metric that reads zero, or
// a funnel stage that quietly stops filling, months later, with no way to
// recover the events that were thrown away in the meantime. Nothing else in the
// stack notices — the backend answers 204, the client thinks it reported, and
// the dashboard draws a confident line through data that was never written.
//
// So the two lists are pinned together here, and so are the event names the
// dashboard's own SQL depends on.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const backendSrc = readFileSync(path.join(REPO, "backend/index.js"), "utf8");
const clientSrc = readFileSync(path.join(REPO, "src/lib/analytics.ts"), "utf8");

/** The names the API will accept and store. */
const serverTypes = (): string[] => {
  const block = backendSrc.match(/const CLIENT_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error("CLIENT_EVENT_TYPES not found in backend/index.js");
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
};

/** The names the storefront can emit. */
const clientTypes = (): string[] => {
  const block = clientSrc.match(/export type EventType =([\s\S]*?);\n/);
  if (!block) throw new Error("EventType not found in src/lib/analytics.ts");
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
};

describe("analytics event vocabulary", () => {
  it("is the same list on both sides", () => {
    expect([...new Set(clientTypes())].sort()).toEqual([...new Set(serverTypes())].sort());
  });

  it("finds a non-empty list on each side", () => {
    // Guards the extraction itself: two empty arrays would compare equal and
    // this file would pass while checking nothing.
    expect(serverTypes().length).toBeGreaterThan(10);
    expect(clientTypes().length).toBeGreaterThan(10);
  });

  it("only counts engagement for events that can actually arrive", () => {
    // The bounce rule lists the events that mean a shopper did something
    // deliberate. A name that no longer exists silently stops matching, and
    // every session it described becomes a bounce.
    const block = backendSrc.match(/BOOL_OR\(event_type IN \(([\s\S]*?)\)\) AS engaged/);
    expect(block).toBeTruthy();
    const engaged = [...block![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    expect(engaged.length).toBeGreaterThan(0);
    // 'purchase' is written server-side, so it is deliberately not in the
    // client allow-list — every other name must be something a browser sends.
    const known = new Set([...serverTypes(), "purchase"]);
    expect(engaged.filter(e => !known.has(e))).toEqual([]);
  });

  it("builds the funnel from events the API accepts", () => {
    // Every event_type the dashboard query compares against, anywhere.
    const compared = [...backendSrc.matchAll(/event_type\s*(?:=|<>|IN|NOT IN)\s*\(?\s*((?:'[a-z_]+'\s*,?\s*)+)/g)]
      .flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
    expect(compared.length).toBeGreaterThan(5);
    const known = new Set([...serverTypes(), "purchase"]);
    expect([...new Set(compared)].filter(e => !known.has(e))).toEqual([]);
  });
});
