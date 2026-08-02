import { useEffect, useState } from "react";
import { fetchSessions, revokeSession, revokeOtherSessions, type UserSession } from "@/lib/userApi";

// "Where you're signed in" — the panel every account area needs and almost no
// small shop has. It's the customer-facing half of server-side sessions: without
// somewhere to SEE the devices, being able to revoke them helps nobody.
//
// The list deliberately shows only what a person needs to recognise their own
// device (browser + OS, when it was last used, the IP). The session id it holds is
// a row id, not a credential — revoking still requires the caller's own cookie.

// Relative time reads faster than a timestamp when the question is "is that me,
// right now?". Falls back to a date once "days ago" stops being meaningful.
export const relativeTime = (iso: string, now: number = Date.now()): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = now - then;
  if (diff < 90_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days <= 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString();
};

// When this device gets signed out if it's simply left alone. Shoppers read
// "expires" as a promise, so a lapsed row says so plainly rather than "in -3 days".
export const expiryLabel = (iso: string, now: number = Date.now()): string => {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "";
  const left = at - now;
  if (left <= 0) return "Expired";
  const hours = Math.round(left / 3_600_000);
  if (hours < 24) return `Signs out in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Signs out in ${days} day${days === 1 ? "" : "s"}`;
};

const btnPrimary = { background: "#f0c14b", border: "1px solid #a88734", color: "#111" } as const;
const btnQuiet = { background: "#fff", border: "1px solid #ccc", color: "#111" } as const;

interface Props {
  /** Called when the customer revokes the session they're currently using. */
  onSelfRevoked: () => void;
}

const SignedInDevices = ({ onSelfRevoked }: Props) => {
  const [sessions, setSessions] = useState<UserSession[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = () => {
    setError("");
    fetchSessions()
      .then(setSessions)
      .catch(err => {
        setSessions([]);
        setError(err instanceof Error ? err.message : "Could not load your signed-in devices");
      });
  };

  useEffect(load, []);

  const handleRevoke = async (session: UserSession) => {
    setBusyId(session.id);
    setError("");
    setNotice("");
    try {
      const { current } = await revokeSession(session.id);
      // Signing out the device you're holding is just signing out — hand back to
      // the page, which clears local auth state rather than leaving a dead session
      // rendered as if it were live.
      if (current) { onSelfRevoked(); return; }
      setSessions(prev => (prev ?? []).filter(s => s.id !== session.id));
      setNotice(`${session.device} was signed out.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign that device out");
    } finally {
      setBusyId(null);
    }
  };

  const handleRevokeOthers = async () => {
    setBusyId("others");
    setError("");
    setNotice("");
    try {
      const { revoked } = await revokeOtherSessions();
      setSessions(prev => (prev ?? []).filter(s => s.current));
      setNotice(revoked === 0
        ? "You're not signed in anywhere else."
        : `Signed out of ${revoked} other device${revoked === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign the other devices out");
    } finally {
      setBusyId(null);
    }
  };

  const others = (sessions ?? []).filter(s => !s.current);

  return (
    <div className="bg-white rounded-xl p-6 space-y-4"
      style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
      <div>
        <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>Where you're signed in</h2>
        <p className="font-sans text-sm mt-1" style={{ color: "#555" }}>
          Devices currently signed in to your account. Don't recognise one? Sign it out and change your password.
        </p>
      </div>

      {sessions === null && (
        <p className="font-sans text-sm" style={{ color: "#555" }}>Loading your devices…</p>
      )}

      {sessions !== null && sessions.length > 0 && (
        <ul className="divide-y" style={{ borderColor: "#eee" }}>
          {sessions.map(s => (
            <li key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>
                  {s.device}
                  {s.current && (
                    <span className="ml-2 font-sans text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "#e7f5e9", color: "#007600" }}>This device</span>
                  )}
                </p>
                <p className="font-sans text-xs mt-0.5" style={{ color: "#555" }}>
                  {s.current ? "Active now" : `Last used ${relativeTime(s.last_seen_at)}`}
                  {s.ip ? ` · ${s.ip}` : ""} · {expiryLabel(s.expires_at)}
                </p>
              </div>
              <button
                onClick={() => handleRevoke(s)}
                disabled={busyId !== null}
                // 44px min target — the same touch baseline as the rest of the account area.
                className="font-sans text-sm font-bold px-4 min-h-[44px] rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                style={btnQuiet}>
                {busyId === s.id ? "Signing out…" : s.current ? "Sign out" : "Sign out device"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{error}</p>}
      {notice && <p className="font-sans text-sm font-semibold" style={{ color: "#007600" }}>{notice}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleRevokeOthers}
          disabled={busyId !== null || others.length === 0}
          className="font-sans text-sm font-bold px-6 min-h-[44px] rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
          style={btnPrimary}>
          {busyId === "others" ? "Signing out…" : "Sign out everywhere else"}
        </button>
        <button onClick={load} disabled={busyId !== null}
          className="font-sans text-sm px-4 min-h-[44px] rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
          style={btnQuiet}>
          Refresh
        </button>
      </div>
    </div>
  );
};

export default SignedInDevices;
