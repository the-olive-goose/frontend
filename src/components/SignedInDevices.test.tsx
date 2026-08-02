import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignedInDevices, { relativeTime, expiryLabel } from "./SignedInDevices";
import type { UserSession } from "@/lib/userApi";

/**
 * The device list is the customer-facing half of server-side sessions, so the
 * things worth pinning are the ones that decide whether a worried shopper can
 * actually cut a device off:
 *
 *  • the device you're using is labelled as such and never quietly revoked as if
 *    it were someone else's;
 *  • revoking THIS device hands back to the page so local auth state is cleared
 *    (otherwise the UI keeps rendering a session the server has already killed);
 *  • "sign out everywhere else" leaves exactly one session standing;
 *  • a failed revoke says so and leaves the row in place — a device silently
 *    vanishing from the list would tell the shopper it's gone when it isn't.
 */

vi.mock("@/lib/userApi", () => ({
  fetchSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
}));

const { fetchSessions, revokeSession, revokeOtherSessions } = await import("@/lib/userApi");

const HOUR = 3_600_000;

const session = (over: Partial<UserSession> = {}): UserSession => ({
  id: "s1",
  current: false,
  device: "Chrome on Windows",
  ip: "10.0.0.1",
  remember: true,
  created_at: new Date(Date.now() - 5 * HOUR).toISOString(),
  last_seen_at: new Date(Date.now() - 2 * HOUR).toISOString(),
  expires_at: new Date(Date.now() + 30 * 24 * HOUR).toISOString(),
  ...over,
});

const thisDevice = session({ id: "cur", current: true, device: "Safari on iPhone" });

beforeEach(() => {
  vi.mocked(fetchSessions).mockReset();
  vi.mocked(revokeSession).mockReset();
  vi.mocked(revokeOtherSessions).mockReset();
});

describe("relativeTime", () => {
  const now = Date.parse("2026-08-02T12:00:00Z");
  it("reads as 'just now' inside the touch window", () => {
    expect(relativeTime("2026-08-02T11:59:30Z", now)).toBe("just now");
  });
  it("counts minutes, then hours, then days", () => {
    expect(relativeTime("2026-08-02T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-08-02T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-08-01T12:00:00Z", now)).toBe("1 day ago");
  });
  it("falls back to a date once 'days ago' stops meaning anything", () => {
    expect(relativeTime("2026-05-02T12:00:00Z", now)).toBe(new Date("2026-05-02T12:00:00Z").toLocaleDateString());
  });
});

describe("expiryLabel", () => {
  const now = Date.parse("2026-08-02T12:00:00Z");
  it("promises a sign-out date, in the unit that reads best", () => {
    expect(expiryLabel("2026-08-02T20:00:00Z", now)).toBe("Signs out in 8 hours");
    expect(expiryLabel("2026-09-01T12:00:00Z", now)).toBe("Signs out in 30 days");
  });
  it("never promises a sign-out that has already happened", () => {
    expect(expiryLabel("2026-08-01T12:00:00Z", now)).toBe("Expired");
  });
});

describe("SignedInDevices", () => {
  it("marks the session you're using and shows when the others were last active", async () => {
    vi.mocked(fetchSessions).mockResolvedValue([thisDevice, session()]);
    render(<SignedInDevices onSelfRevoked={vi.fn()} />);

    expect(await screen.findByText("Safari on iPhone")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText(/Active now/)).toBeInTheDocument();
    expect(screen.getByText(/Last used 2 hours ago/)).toBeInTheDocument();
  });

  it("hands back to the page when you sign out the device you're on", async () => {
    vi.mocked(fetchSessions).mockResolvedValue([thisDevice]);
    vi.mocked(revokeSession).mockResolvedValue({ current: true });
    const onSelfRevoked = vi.fn();
    render(<SignedInDevices onSelfRevoked={onSelfRevoked} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(onSelfRevoked).toHaveBeenCalled());
  });

  it("drops only the revoked row when it's another device", async () => {
    vi.mocked(fetchSessions).mockResolvedValue([thisDevice, session()]);
    vi.mocked(revokeSession).mockResolvedValue({ current: false });
    render(<SignedInDevices onSelfRevoked={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out device" }));

    await waitFor(() => expect(screen.queryByText("Chrome on Windows")).not.toBeInTheDocument());
    expect(screen.getByText("Safari on iPhone")).toBeInTheDocument();
    expect(screen.getByText("Chrome on Windows was signed out.")).toBeInTheDocument();
  });

  it("keeps the row, and says why, when the revoke fails", async () => {
    vi.mocked(fetchSessions).mockResolvedValue([thisDevice, session()]);
    vi.mocked(revokeSession).mockRejectedValue(new Error("Network unreachable"));
    render(<SignedInDevices onSelfRevoked={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out device" }));

    expect(await screen.findByText("Network unreachable")).toBeInTheDocument();
    expect(screen.getByText("Chrome on Windows")).toBeInTheDocument();
  });

  it("leaves exactly this device standing after 'sign out everywhere else'", async () => {
    vi.mocked(fetchSessions).mockResolvedValue([thisDevice, session(), session({ id: "s2", device: "Firefox on Mac" })]);
    vi.mocked(revokeOtherSessions).mockResolvedValue({ revoked: 2 });
    render(<SignedInDevices onSelfRevoked={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out everywhere else" }));

    await waitFor(() => expect(screen.getByText("Signed out of 2 other devices.")).toBeInTheDocument());
    expect(screen.getByText("Safari on iPhone")).toBeInTheDocument();
    expect(screen.queryByText("Firefox on Mac")).not.toBeInTheDocument();
  });

  it("offers nothing to revoke when this is the only device", async () => {
    vi.mocked(fetchSessions).mockResolvedValue([thisDevice]);
    render(<SignedInDevices onSelfRevoked={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Sign out everywhere else" })).toBeDisabled();
  });
});
