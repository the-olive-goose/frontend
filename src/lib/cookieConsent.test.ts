import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "@/test/memoryStorage";
import {
  CONSENT_KEY,
  CONSENT_TTL_MS,
  cookieBannerAnswered,
  cookiesAccepted,
  readCookieConsent,
  writeCookieConsent,
} from "./cookieConsent";

/**
 * A cookie choice is an answer with a date on it, not a permanent setting. What
 * these pin down:
 *
 *  • a fresh answer stands;
 *  • an answer older than the re-ask interval is treated as no answer, and is
 *    cleared so the analytics gates can't keep reading it;
 *  • an answer stored before timestamps existed (or seeded by a test) is
 *    grandfathered from now rather than re-prompting every visitor at once;
 *  • a blocked storage means "no consent", never "assume yes".
 */

installMemoryStorage(); // this jsdom build ships without Web Storage

const AT_KEY = "og_cookie_consent_at";
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("a current answer", () => {
  it("stands, and records when it was given", () => {
    writeCookieConsent("accepted");
    expect(readCookieConsent()).toBe("accepted");
    expect(cookiesAccepted()).toBe(true);
    expect(Number(localStorage.getItem(AT_KEY))).toBeGreaterThan(0);
  });

  it("keeps a decline a decline", () => {
    writeCookieConsent("declined");
    expect(cookieBannerAnswered()).toBe(true);
    expect(cookiesAccepted()).toBe(false);
  });
});

describe("a lapsed answer", () => {
  it("counts as no answer once the interval has passed", () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    localStorage.setItem(AT_KEY, String(Date.now() - CONSENT_TTL_MS - DAY));

    expect(readCookieConsent()).toBeNull();
    expect(cookieBannerAnswered()).toBe(false);
    // …and analytics must not keep running on it.
    expect(cookiesAccepted()).toBe(false);
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  it("still stands a day before the interval is up", () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    localStorage.setItem(AT_KEY, String(Date.now() - CONSENT_TTL_MS + DAY));
    expect(readCookieConsent()).toBe("accepted");
  });
});

describe("an answer from before timestamps existed", () => {
  it("is grandfathered from now, not re-prompted immediately", () => {
    localStorage.setItem(CONSENT_KEY, "accepted"); // no _at key — the old format

    expect(readCookieConsent()).toBe("accepted");
    // Stamped on read, so it lapses an interval from today rather than never.
    expect(Number(localStorage.getItem(AT_KEY))).toBeGreaterThan(Date.now() - 5000);
  });
});

describe("junk and blocked storage", () => {
  it("treats an unrecognised value as unanswered", () => {
    localStorage.setItem(CONSENT_KEY, "maybe");
    expect(readCookieConsent()).toBeNull();
  });

  it("treats a throwing storage as no consent", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readCookieConsent()).toBeNull();
    expect(cookiesAccepted()).toBe(false);
  });
});
