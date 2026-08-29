import "@testing-library/jest-dom";

// jsdom has no ResizeObserver; Recharts' ResponsiveContainer constructs one on
// mount, so any component rendering a chart throws without this stub.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// ── No test may reach the network ─────────────────────────────────────────────
// This is not tidiness. `track()` is called for real by the GA4 and Meta Pixel
// tests — they assert what those tags receive, and the first-party beacon goes
// out alongside as a side effect. Under vitest `import.meta.env.DEV` is true, so
// API_URL resolves to http://localhost:3001 (see src/lib/apiBase.ts), which is
// the dev backend — and backend/.env points that at the PRODUCTION database.
//
// So a plain `npm test`, run with the dev backend up, posted every fixture event
// in the suite into the live analytics table: p1 "Olive" €24, p0…p200, searches,
// add-to-carts, newsletter signups. Nothing rejected them — Node's fetch sends
// no Origin header (the ingest gate fails open on a missing one, on purpose, so
// a proxy that stops forwarding it can't zero the numbers) and a User-Agent of
// "node", which the bot filter did not know. 6,953 of the 7,000 rows in the
// production table were this. The dashboard was reporting the test suite.
//
// The backend now turns away anything that isn't a browser, so this can't reach
// production again from any machine. This stops it at the other end too: a test
// run should not be able to talk to a server at all, whichever one is listening.
// Tests that care what was sent stub `fetch` themselves (vi.stubGlobal), which
// still overrides this.
// Resolved, not thrown: analytics deliberately swallows its own send failures, so
// throwing here would be silently caught and prove nothing, while a hard failure
// in unrelated component tests would only be noise. A 204 is what the real
// ingest route answers, and nothing leaves the machine.
vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

// Only if the environment actually has one. jsdom does not, and analytics.ts
// picks its transport with `navigator.sendBeacon &&` — so DEFINING one here
// would silently move every test off the fetch path and onto a beacon nothing is
// watching, which is a change to what the suite proves, not to what it leaks.
// Where a beacon does exist, it must not be a real one.
if ("sendBeacon" in window.navigator) {
  Object.defineProperty(window.navigator, "sendBeacon", {
    writable: true,
    configurable: true,
    value: vi.fn(() => true),
  });
}

// stubGlobal survives restoreAllMocks but NOT unstubAllGlobals, which a test file
// may call in afterEach to undo its own stubs. Put the safe default back.
afterEach(() => {
  if (typeof globalThis.fetch !== "function" || !("mock" in globalThis.fetch)) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  }
});
