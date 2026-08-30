import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { confirmUnsubscribe, getUnsubscribeInfo, type UnsubscribeInfo } from "@/lib/api";

/**
 * Where the unsubscribe link in a newsletter lands.
 *
 * The page asks before it acts, and that is not politeness — mail clients and
 * security scanners prefetch every link in an email, so a page that unsubscribed
 * on load would remove people who never clicked. The server enforces the same
 * split (GET describes, POST performs); this is the half a human sees.
 *
 * Reachable without signing in, by design. Requiring a login to leave a mailing
 * list is the pattern that gets senders reported as spam.
 */

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div
    className="min-h-screen flex items-center justify-center px-6 py-20"
    style={{ background: "var(--bg-page)" }}
  >
    <div
      className="w-full max-w-md text-center p-8"
      style={{
        background: "var(--color-cream-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      {children}
    </div>
  </div>
);

const Title = ({ children }: { children: React.ReactNode }) => (
  <h1
    className="font-display mb-3"
    style={{ fontSize: "var(--text-display-sm)", color: "var(--text-primary)" }}
  >
    {children}
  </h1>
);

const Body = ({ children }: { children: React.ReactNode }) => (
  <p className="font-sans text-sm mb-6" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
    {children}
  </p>
);

const BackLink = () => (
  <Link
    to="/"
    className="font-sans text-sm underline"
    style={{ color: "var(--text-primary)" }}
  >
    Back to the shop
  </Link>
);

const UnsubscribePage = () => {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [info, setInfo] = useState<UnsubscribeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [donePage, setDonePage] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;
    getUnsubscribeInfo(token)
      .then(result => { if (!cancelled) setInfo(result); })
      .catch(() => { if (!cancelled) setInfo(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const handleUnsubscribe = async () => {
    setWorking(true);
    setError("");
    try {
      await confirmUnsubscribe(token);
      setDonePage(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return <Shell><Body>One moment…</Body></Shell>;
  }

  // A test send's link. Saying so plainly beats "invalid link", which would send
  // the shop owner hunting for a bug that isn't there.
  if (info?.preview) {
    return (
      <Shell>
        <Title>This was a test email</Title>
        <Body>
          The unsubscribe link in a test send isn't attached to anyone, so there's nothing to
          remove. In a real send this link works properly for each recipient.
        </Body>
        <BackLink />
      </Shell>
    );
  }

  if (!token || !info) {
    return (
      <Shell>
        <Title>That link didn't work</Title>
        <Body>
          It may have already been used, or been broken in half by your email app. If you're still
          getting emails you don't want, reply to any one of them and we'll take you off the list
          by hand.
        </Body>
        <BackLink />
      </Shell>
    );
  }

  // The same link arrives from two different lists, and saying "you're
  // unsubscribed from the newsletter" to someone who clicked "stop basket
  // reminders" is how a shop loses a subscriber it never had to lose. The server
  // says which list the token belongs to; this page says it back to them.
  const isCart = info.kind === "cart_reminders";

  if (donePage || info.already_unsubscribed) {
    return (
      <Shell>
        <Title>{isCart ? "No more basket reminders 🫒" : "You're unsubscribed 🫒"}</Title>
        <Body>
          {info.email
            ? <><strong>{info.email}</strong> won't get any more {isCart ? "reminders about an unfinished basket" : "newsletters"} from us. </>
            : null}
          {isCart
            ? "Everything else stays as it is — including the newsletter, if you're on it, and your order and delivery emails."
            : "You'll still get order and delivery emails if you buy something — those aren't marketing, and you'd want them."}
        </Body>
        <BackLink />
      </Shell>
    );
  }

  return (
    <Shell>
      <Title>{isCart ? "Stop basket reminders?" : "Unsubscribe?"}</Title>
      <Body>
        {isCart
          ? <>We'll stop emailing <strong>{info.email}</strong> about baskets left unfinished. This is separate from the newsletter — that one carries on unless you unsubscribe from it too.</>
          : <>We'll stop sending newsletters to <strong>{info.email}</strong>. You'll still get order and delivery emails if you buy something.</>}
      </Body>
      {error && (
        <p className="font-sans text-sm mb-4" style={{ color: "var(--color-error, #a2542f)" }}>
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleUnsubscribe}
        disabled={working}
        className="w-full py-3 font-sans text-sm font-semibold rounded-full transition-opacity disabled:opacity-50 mb-4"
        style={{ background: "var(--text-primary)", color: "var(--color-cream-card)" }}
      >
        {working ? "Saving…" : isCart ? "Yes, stop basket reminders" : "Yes, unsubscribe me"}
      </button>
      <BackLink />
    </Shell>
  );
};

export default UnsubscribePage;
