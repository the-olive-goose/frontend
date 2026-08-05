import { fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubscribePopupCard from "./SubscribePopupCard";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { installMemoryStorage } from "@/test/memoryStorage";

/**
 * The popup is a blocking dialog — it stops the storefront until it is answered
 * or closed — so the rules worth pinning are the ones that decide when it is
 * allowed to interrupt, and what it is allowed to reveal:
 *
 *  • it waits the admin-set few seconds after landing, and otherwise catches
 *    someone heading for the exit — whichever comes first;
 *  • a pointer flick at the toolbar in the first moments after landing is not a
 *    visitor leaving, and must not trigger it;
 *  • once per VISIT — not once per tab — and it asks again on their next visit;
 *    closing it is "not now", not "never";
 *  • subscribing retires it for good on that device;
 *  • the discount code is NEVER printed on the page. It is emailed, so claiming
 *    the offer costs the visitor a mailbox they own — printing it would make the
 *    card a code dispenser for anyone typing a fresh made-up address.
 */

vi.mock("@/lib/api", () => ({
  subscribe: vi.fn(),
  AlreadySubscribedError: class extends Error {},
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { subscribe } = await import("@/lib/api");

let authState: { user: unknown; loading: boolean; showAuthModal: boolean } =
  { user: null, loading: false, showAuthModal: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState }));

// The card treats a throwing storage as "can't tell — don't risk nagging", so
// without a working one every case below would pass for the wrong reason.
installMemoryStorage();

const DISMISSED_KEY = "og_subscribe_popup_dismissed";
const SEEN_KEY = "og_subscribe_popup_seen";
const VISIT_KEY = "og_subscribe_popup_visit";
const MINUTE = 60 * 1000;

const content = { ...DEFAULT_CONTENT.subscribePopup, delay_seconds: 3 };

const mount = (over: Partial<typeof content> = {}) =>
  render(<SubscribePopupCard data={{ ...content, ...over }} ready />);

/** The pointer leaving through the top of the window (toward the tab bar). */
const leaveViaTop = () =>
  fireEvent(document, new MouseEvent("mouseout", { clientY: 0, bubbles: true }));

const isOpen = () => screen.queryByRole("dialog", { name: /newsletter signup offer/i }) !== null;

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  authState = { user: null, loading: false, showAuthModal: false };
  vi.mocked(subscribe).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  // The card holds back until the cookie banner has been answered.
  localStorage.setItem("og_cookie_consent", "accepted");
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("when it appears", () => {
  it("waits the admin-set delay after landing", () => {
    mount();
    advance(2000);
    expect(isOpen()).toBe(false);
    advance(1500);
    expect(isOpen()).toBe(true);
  });

  it("catches a visitor on their way out before the delay is up", () => {
    mount({ delay_seconds: 60 });
    advance(5000);
    leaveViaTop();
    expect(isOpen()).toBe(true);
  });

  it("ignores a pointer flick at the toolbar right after landing", () => {
    mount({ delay_seconds: 60 });
    advance(1000);
    leaveViaTop();
    expect(isOpen()).toBe(false);
  });

  it("ignores the pointer leaving sideways or downward", () => {
    mount({ delay_seconds: 60 });
    advance(5000);
    fireEvent(document, new MouseEvent("mouseout", { clientY: 400, bubbles: true }));
    expect(isOpen()).toBe(false);
  });

  it("stays away from signed-in customers", () => {
    authState = { user: { id: "u1" }, loading: false, showAuthModal: false };
    mount();
    advance(5000);
    expect(isOpen()).toBe(false);
  });

  it("waits while the visitor is partway through signing in", () => {
    authState = { user: null, loading: false, showAuthModal: true };
    mount();
    advance(5000);
    expect(isOpen()).toBe(false);
  });

  it("stays away while the popup settings are still loading", () => {
    render(<SubscribePopupCard data={content} ready={false} />);
    advance(5000);
    expect(isOpen()).toBe(false);
  });
});

describe("how often it appears", () => {
  it("claims the visit the moment it appears", () => {
    mount();
    advance(3500);
    expect(isOpen()).toBe(true);
    expect(sessionStorage.getItem(SEEN_KEY)).toBe("1");
    expect(JSON.parse(localStorage.getItem(VISIT_KEY)!).lastShown).toBeGreaterThan(0);
  });

  it("shows at most once in a tab", () => {
    sessionStorage.setItem(SEEN_KEY, "1");
    mount();
    advance(5000);
    expect(isOpen()).toBe(false);
  });

  it("does not repeat in a second tab of the same visit", () => {
    // Another tab showed it a minute ago and pinged just now — one visit, still.
    const now = Date.now();
    localStorage.setItem(VISIT_KEY, JSON.stringify({
      lastShown: now - MINUTE, lastPing: now, visitStart: now - 2 * MINUTE,
    }));
    mount();                    // fresh tab: nothing in sessionStorage
    advance(5000);
    expect(isOpen()).toBe(false);
  });

  it("asks again on the visitor's next visit — closing is 'not now', not 'never'", () => {
    const first = mount();
    advance(3500);
    fireEvent.click(screen.getByLabelText(/close signup offer/i));
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
    first.unmount();

    // They come back later: same device, same storage, new tab, and a gap since
    // the last page load long enough to count as leaving and returning.
    sessionStorage.clear();
    const visit = JSON.parse(localStorage.getItem(VISIT_KEY)!);
    localStorage.setItem(VISIT_KEY, JSON.stringify({
      ...visit, lastShown: visit.lastShown - 45 * MINUTE, lastPing: Date.now() - 45 * MINUTE,
    }));

    mount();
    advance(3500);
    expect(isOpen()).toBe(true);
  });

  it("never returns to a device that has already subscribed", () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    mount();
    advance(5000);
    expect(isOpen()).toBe(false);
  });
});

describe("as a blocking dialog", () => {
  it("declares itself modal and freezes the page behind it", () => {
    mount();
    advance(3500);
    expect(screen.getByRole("dialog", { name: /newsletter signup offer/i }))
      .toHaveAttribute("aria-modal", "true");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("hands the page back once it is closed", () => {
    mount();
    advance(3500);
    fireEvent.click(screen.getByLabelText(/close signup offer/i));
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("closes on Esc as well as the X", () => {
    mount();
    advance(3500);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("the discount code", () => {
  const fillAndSubmit = async () => {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "shopper@example.com" } });
    await act(async () => { fireEvent.submit(screen.getByRole("textbox").closest("form")!); });
  };

  it("is never printed on the page — it goes to the mailbox only", async () => {
    vi.mocked(subscribe).mockResolvedValue({
      discount: { discount_percent: 10, email_delivered: true },
      alreadySubscribed: false,
    });
    mount();
    advance(3500);
    await fillAndSubmit();

    expect(screen.getByRole("dialog")).toHaveTextContent(/shopper@example\.com/);
    expect(screen.getByRole("dialog")).toHaveTextContent(/emailed/i);
    // Nothing that looks like a code, and no way to copy one.
    expect(document.body.textContent).not.toMatch(/OG-[A-Z2-9]{6,}/);
    expect(screen.queryByText(/tap to copy/i)).toBeNull();
  });

  it("says so plainly when the email could not be delivered", async () => {
    vi.mocked(subscribe).mockResolvedValue({
      discount: { discount_percent: 10, email_delivered: false },
      alreadySubscribed: false,
    });
    mount();
    advance(3500);
    await fillAndSubmit();

    expect(screen.getByRole("dialog")).toHaveTextContent(/couldn't get the email through/i);
    expect(document.body.textContent).not.toMatch(/OG-[A-Z2-9]{6,}/);
  });

  it("retires the popup on that device once they have subscribed", async () => {
    vi.mocked(subscribe).mockResolvedValue({
      discount: { discount_percent: 10, email_delivered: true },
      alreadySubscribed: false,
    });
    mount();
    advance(3500);
    await fillAndSubmit();
    expect(localStorage.getItem(DISMISSED_KEY)).toBe("1");
  });
});
