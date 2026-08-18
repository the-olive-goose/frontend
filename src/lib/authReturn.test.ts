import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "@/test/memoryStorage";
import {
  AUTH_RETURN_KEY, clearAuthReturn, consumeAuthReturn, rememberAuthReturn,
} from "./authReturn";

/**
 * Where a shopper lands after signing in with Google. What these pin down:
 *
 *  • the destination survives the round trip through sessionStorage, so a
 *    sign-in started at checkout comes back to checkout and not the homepage;
 *  • it is consumed exactly once — a second callback can't replay it;
 *  • an off-site value in storage never becomes a redirect (an open redirect
 *    hanging off our own sign-in is the one thing this file must not allow);
 *  • storage that throws degrades to "go home", never to a callback that dies.
 */

installMemoryStorage(); // this jsdom build ships without Web Storage

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("round trip", () => {
  it("gives back the path that was remembered", () => {
    rememberAuthReturn("/checkout");
    expect(consumeAuthReturn()).toBe("/checkout");
  });

  it("keeps the query string — it can carry the thing being resumed", () => {
    rememberAuthReturn("/checkout?pickup=1");
    expect(consumeAuthReturn()).toBe("/checkout?pickup=1");
  });

  it("falls back to the current page when no path is named", () => {
    window.history.replaceState({}, "", "/basket");
    rememberAuthReturn();
    expect(consumeAuthReturn()).toBe("/basket");
  });

  it("falls back to the current page when the named path is unusable", () => {
    window.history.replaceState({}, "", "/checkout");
    rememberAuthReturn("https://evil.example/steal");
    expect(consumeAuthReturn()).toBe("/checkout");
  });
});

describe("single use", () => {
  it("clears on read, so the next callback starts empty", () => {
    rememberAuthReturn("/checkout");
    expect(consumeAuthReturn()).toBe("/checkout");
    expect(consumeAuthReturn()).toBeNull();
    expect(sessionStorage.getItem(AUTH_RETURN_KEY)).toBeNull();
  });

  it("clearAuthReturn drops an abandoned attempt", () => {
    rememberAuthReturn("/checkout");
    clearAuthReturn();
    expect(consumeAuthReturn()).toBeNull();
  });

  it("returns null when nothing was ever stored", () => {
    expect(consumeAuthReturn()).toBeNull();
  });
});

describe("only same-origin paths come back out", () => {
  // Storage is writable by devtools and anything else on the page, so the value
  // is re-validated on read rather than trusted because we wrote it.
  const offSite = [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "javascript:alert(1)",
    "checkout",                 // relative — resolves against whatever page reads it
    "/checkout\nhttps://evil",  // header/URL smuggling attempt
    "",
  ];

  for (const value of offSite) {
    it(`rejects ${JSON.stringify(value)} planted in storage`, () => {
      sessionStorage.setItem(AUTH_RETURN_KEY, value);
      expect(consumeAuthReturn()).toBeNull();
    });
  }

  it("refuses to bounce back to the callback itself", () => {
    sessionStorage.setItem(AUTH_RETURN_KEY, "/auth/callback");
    expect(consumeAuthReturn()).toBeNull();
  });

  it("drops an absurdly long path", () => {
    sessionStorage.setItem(AUTH_RETURN_KEY, `/${"a".repeat(600)}`);
    expect(consumeAuthReturn()).toBeNull();
  });
});

describe("storage unavailable", () => {
  // Safari private mode and blocked-cookie setups throw on read AND write, so the
  // store is replaced outright rather than spied on — a spy on Storage.prototype
  // would miss the memory store installed above and the tests would pass without
  // ever hitting the failure they claim to cover.
  const withBlockedStorage = (run: () => void) => {
    const real = sessionStorage;
    const blocked = new Proxy({} as Storage, {
      get() { throw new Error("SecurityError"); },
    });
    Object.defineProperty(globalThis, "sessionStorage", { value: blocked, configurable: true });
    try { run(); } finally {
      Object.defineProperty(globalThis, "sessionStorage", { value: real, configurable: true });
    }
  };

  it("remembering doesn't throw when storage is blocked", () => {
    withBlockedStorage(() => expect(() => rememberAuthReturn("/checkout")).not.toThrow());
  });

  it("reading a blocked store means the homepage, not a crash", () => {
    withBlockedStorage(() => expect(consumeAuthReturn()).toBeNull());
  });

  it("clearing a blocked store doesn't throw", () => {
    withBlockedStorage(() => expect(() => clearAuthReturn()).not.toThrow());
  });
});
