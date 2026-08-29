import { useEffect, useState } from "react";
import {
  getMetaServerState, saveMetaAccessToken, testMetaConnection,
  type MetaServerState,
} from "@/lib/api";
import { isPixelId, isTestEventCode } from "@/lib/meta";
import type { MetaPixelContent } from "@/lib/defaults";

// ── Small local primitives, matching the Google Analytics panel next door ──────

const Card = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="font-sans text-sm font-semibold text-foreground">{title}</p>
    {desc && <p className="font-sans text-xs text-muted-foreground mt-0.5">{desc}</p>}
    <div className="mt-3">{children}</div>
  </div>
);

const Switch = ({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean;
}) => (
  <label className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="accent-primary mt-0.5 w-4 h-4 shrink-0"
    />
    <span className="min-w-0">
      <span className="block font-sans text-sm text-foreground">{label}</span>
      {hint && <span className="block font-sans text-xs text-muted-foreground mt-0.5">{hint}</span>}
    </span>
  </label>
);

const TextInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${props.className ?? ""}`}
  />
);

// A readiness line: green when this part of the setup is done, amber when it is
// the thing standing in the way, grey when it doesn't apply yet.
const Check = ({ state, children }: { state: "ok" | "todo" | "off"; children: React.ReactNode }) => {
  const mark = state === "ok" ? "✓" : state === "todo" ? "!" : "–";
  const color = state === "ok" ? "#0ca30c" : state === "todo" ? "#b26a00" : "rgba(30,41,24,0.4)";
  return (
    <li className="flex items-start gap-2 font-sans text-sm">
      <span aria-hidden className="font-semibold shrink-0 w-4 text-center" style={{ color }}>{mark}</span>
      <span className="min-w-0 text-foreground">{children}</span>
    </li>
  );
};

// The Meta events the shop sends, in the order a shopper triggers them. Shown so
// the owner knows what to expect in Events Manager rather than discovering it by
// absence — and so the deliberate gaps are visible as decisions rather than bugs.
const SENT_EVENTS: Array<[string, string]> = [
  ["PageView", "every page, including in-app navigation"],
  ["ViewCategory", "a grid of products was shown — a custom event, not one of Meta's"],
  ["ViewContent", "a product page was shown"],
  ["AddToCart", "something was added to the basket, guests included"],
  ["InitiateCheckout", "the checkout page was reached"],
  ["AddPaymentInfo", "handed over to Stripe"],
  ["Purchase", "sent by the server when Stripe confirms payment"],
  ["Search", "the shop was searched"],
  ["CompleteRegistration", "an account was created"],
  ["Lead", "someone joined the newsletter"],
];

const MetaPixelPanel = ({ data, onChange, onSave, saving }: {
  data: MetaPixelContent;
  onChange: (next: MetaPixelContent) => void;
  onSave: () => void;
  saving: boolean;
}) => {
  const [server, setServer] = useState<MetaServerState | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getMetaServerState().then(setServer).catch(() => setNote("Couldn't load the server-side settings."));
  }, []);

  const id = data.pixel_id.trim();
  const idValid = isPixelId(id);
  const idProblem = id.length > 0 && !idValid;

  const testCode = data.test_event_code.trim();
  const testCodeProblem = testCode.length > 0 && !isTestEventCode(testCode);

  const saveToken = async (value: string | null) => {
    setBusy(true);
    setTestResult(null);
    try {
      const saved = await saveMetaAccessToken(value);
      setServer((s) => (s ? { ...s, ...saved } : s));
      setTokenDraft("");
      setNote(value ? "Access token saved." : "Access token removed — purchases will no longer be reported to Meta.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't save that.");
    } finally { setBusy(false); }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testMetaConnection();
      setTestResult({ ok: result.ok, text: result.ok ? (result.message ?? "Meta accepted it.") : (result.problem ?? "That didn't work.") });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : "The test could not be run." });
    } finally { setTesting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="mb-2 pb-4 border-b border-border">
        <h2 className="font-serif text-2xl text-foreground">Meta Pixel</h2>
        <p className="font-sans text-sm text-muted-foreground mt-1">
          Measure the shop for Facebook and Instagram ads — what people looked at,
          what they added, and what they bought — so a campaign can be judged on
          sales rather than clicks. Off until you turn it on.
        </p>
      </div>

      {/* ── Live test banner ────────────────────────────────────────────────── */}
      {testCode && isTestEventCode(testCode) && (
        <div className="rounded-xl border p-4" style={{ borderColor: "#b26a00", background: "rgba(178,106,0,0.06)" }}>
          <p className="font-sans text-sm font-semibold" style={{ color: "#b26a00" }}>
            Test mode is on — real purchases are going to Test Events, not to your reporting.
          </p>
          <p className="font-sans text-sm text-foreground/80 mt-1 leading-relaxed">
            While <code className="font-mono text-xs">{testCode}</code> is set, every
            sale this shop makes is tagged as a test event. Meta puts those in the
            Test Events tab and leaves them out of your ad reporting and out of what
            the delivery system learns. Clear the box below the moment you've seen
            what you needed to see.
          </p>
        </div>
      )}

      {/* ── What is and isn't running ───────────────────────────────────────── */}
      <Card title="Setup" desc="All four have to be true before anything reaches Meta.">
        <ul className="space-y-2">
          <Check state={data.enabled ? "ok" : "todo"}>
            {data.enabled ? "Turned on." : "Turned off — nothing is sent to Meta."}
          </Check>
          <Check state={idValid ? "ok" : "todo"}>
            {idValid
              ? <>Pixel ID <code className="font-mono text-xs">{id}</code> saved.</>
              : idProblem
                ? "That isn't a pixel ID — they're a 15- or 16-digit number."
                : "No pixel ID yet. Events Manager → Data sources → your pixel."}
          </Check>
          <Check state={server?.access_token_set ? "ok" : "todo"}>
            {server?.access_token_set
              ? server.access_token_source === "env"
                ? <>Access token set on the server as <code className="font-mono text-xs">META_CAPI_TOKEN</code> — purchases are reported from the server.</>
                : <>Access token saved ({server.access_token_hint}) — purchases are reported from the server.</>
              : "No access token. Browsing events still work, but no purchase, no revenue, and no way to judge an ad by what it sold."}
          </Check>
          <Check state={data.require_consent ? "ok" : "off"}>
            {data.require_consent
              ? "Loads only for visitors who accept cookies."
              : "Loads for every visitor, regardless of the cookie banner. This is an advertising tag — make very sure that's a decision you've taken deliberately, with advice."}
          </Check>
        </ul>

        {server && server.pixel_id !== id && idValid && (
          <p className="font-sans text-xs mt-3" style={{ color: "#b26a00" }}>
            The pixel ID above hasn't been saved yet — press Save Changes to put it live.
          </p>
        )}
      </Card>

      {/* ── The switch and the id ───────────────────────────────────────────── */}
      <Card title="Pixel" desc="What the shopper's browser loads.">
        <div className="space-y-4">
          <Switch
            checked={data.enabled}
            onChange={(enabled) => onChange({ ...data, enabled })}
            label="Send traffic to Meta"
            hint="Loads Meta's fbevents.js on the storefront. Never on this admin panel."
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-sans font-medium text-foreground">Pixel ID</label>
            <TextInput
              value={data.pixel_id}
              placeholder="1234567890123456"
              spellCheck={false}
              inputMode="numeric"
              onChange={(e) => onChange({ ...data, pixel_id: e.target.value.trim() })}
            />
            <p className="text-xs text-muted-foreground font-sans">
              In Meta: Events Manager → Data sources → your pixel. It's the long
              number under the name. This one is public — it ships in the page
              source, as it does on every site with a pixel.
            </p>
            {idProblem && (
              <p className="text-xs font-sans" style={{ color: "#b3282f" }}>
                That isn't a pixel ID. An ID starting <code className="font-mono">act_</code> is
                an ad account, and a Business Manager ID is something else again —
                neither will work here. The pixel's own ID is 15 or 16 digits, and
                it never starts with a zero.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* ── Purchases ───────────────────────────────────────────────────────── */}
      <Card
        title="Purchases and revenue"
        desc="Sent by the server through the Conversions API, because the browser can't be relied on to be there."
      >
        <p className="font-sans text-sm text-foreground/80 leading-relaxed">
          When someone pays, they're on Stripe's site — and whether they ever come
          back to the shop is not something your ad reporting should depend on. So
          the sale is sent to Meta by our server the moment Stripe confirms the
          payment. This is also the half that keeps working when the shopper has
          an ad blocker, or is in Safari, which now expires the pixel's own
          cookies after seven days.
        </p>
        <p className="font-sans text-sm text-foreground/80 leading-relaxed mt-3">
          It needs an access token, which is the one thing here that is a
          password: anyone holding it can write purchases into your pixel — and
          teach Meta to go looking for more people like whoever they invented — so
          it's stored on the server and never shown again.
        </p>

        {server?.access_token_source === "env" ? (
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
            <p className="font-sans text-sm text-foreground">
              Nothing to do here — the token is set on the server as{" "}
              <code className="font-mono text-xs">META_CAPI_TOKEN</code> ({server.access_token_hint}),
              and that takes precedence over anything typed on this page.
            </p>
            <p className="font-sans text-xs text-muted-foreground mt-2">
              That's the right home for it: alongside the Stripe key, set once,
              never in the database, and rotatable without touching the shop. To
              change it, change it there.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <label className="block text-sm font-sans font-medium text-foreground">
              Conversions API access token
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                type="password"
                value={tokenDraft}
                placeholder={server?.access_token_set ? `Saved (${server.access_token_hint}) — paste a new one to replace it` : "Paste the token from Events Manager"}
                spellCheck={false}
                autoComplete="off"
                className="flex-1 min-w-[240px]"
                onChange={(e) => setTokenDraft(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || !tokenDraft.trim()}
                onClick={() => saveToken(tokenDraft.trim())}
                className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium hover:bg-olive-light transition-all disabled:opacity-50"
              >
                Save token
              </button>
              {server?.access_token_set && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => saveToken(null)}
                  className="px-4 py-2.5 rounded-lg border border-border font-sans text-sm text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-sans">
              In Meta: Events Manager → your pixel → Settings → Conversions API →
              Generate access token. Prefer to keep it out of the panel entirely?
              Set <code className="font-mono">META_CAPI_TOKEN</code> on the server
              (Railway → Variables) and this box disappears.
            </p>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-border">
          <p className="font-sans text-sm text-foreground/80 leading-relaxed">
            <strong>This test proves something.</strong> Meta checks who is
            calling, so if it accepts the event below, the token is valid{" "}
            <em>and</em> has permission for this exact pixel — and if it doesn't,
            Meta says which of the two is wrong and you'll see its own words here.
            The event is called <code className="font-mono text-xs">AdminTest</code>,
            not a purchase, so it can't put invented revenue in your reporting.
          </p>
          <button
            type="button"
            disabled={testing}
            onClick={runTest}
            className="mt-3 px-4 py-2.5 rounded-lg border border-border font-sans text-sm text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
          >
            {testing ? "Asking Meta…" : "Send a test event"}
          </button>
          {testResult && (
            <div className="mt-3 space-y-2">
              {testResult.text.split("\n\n").map((para, i) => (
                <p
                  key={i}
                  className="font-sans text-sm leading-relaxed"
                  // Only the first line reports the outcome; the follow-up is
                  // instructions, and colouring those green would read as "done".
                  style={{ color: i === 0 ? (testResult.ok ? "#006300" : "#b3282f") : undefined }}
                >
                  {para}
                </p>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ── Seeing it work ──────────────────────────────────────────────────── */}
      <Card title="Checking it yourself" desc="Two tools, and they answer different questions.">
        <ol className="space-y-4">
          <li className="font-sans text-sm text-foreground/80 leading-relaxed">
            <strong className="text-foreground">1. Meta Pixel Helper</strong> — the
            free Chrome extension. Install it, then open the shop{" "}
            <em>in a browser that isn't this one</em> and accept the cookie banner.
            The extension's icon should show your pixel ID and a{" "}
            <code className="font-mono text-xs">PageView</code>; click a product and
            a <code className="font-mono text-xs">ViewContent</code> appears, add it
            to the basket and so does{" "}
            <code className="font-mono text-xs">AddToCart</code>.
            <span className="block mt-1 text-muted-foreground">
              Two reasons it might show nothing, and both are this page working as
              intended: you haven't accepted cookies yet, or you're on a browser
              that has opened this admin panel — those are excluded on purpose.
              Use a private window on a different browser and it'll be there.
            </span>
          </li>
          <li className="font-sans text-sm text-foreground/80 leading-relaxed">
            <strong className="text-foreground">2. Test Events</strong> — Events
            Manager → your pixel → Test Events. Paste the shop's address into
            "Test browser events" and browse: every event above arrives in that
            list live, with its parameters, which is more than the extension shows
            you.
            <span className="block mt-1 text-muted-foreground">
              For the <code className="font-mono text-xs">Purchase</code> — the one
              event no amount of browsing will produce, because our server sends it
              — copy the <code className="font-mono text-xs">TEST…</code> code from
              that same tab into the box below, then place a real order. It'll
              appear within seconds. Then clear the code.
            </span>
          </li>
        </ol>

        <div className="mt-5 space-y-1.5">
          <label className="block text-sm font-sans font-medium text-foreground">Test Events code</label>
          <TextInput
            value={data.test_event_code}
            placeholder="TEST12345 — leave empty in normal operation"
            spellCheck={false}
            onChange={(e) => onChange({ ...data, test_event_code: e.target.value.trim() })}
          />
          {testCodeProblem ? (
            <p className="text-xs font-sans" style={{ color: "#b3282f" }}>
              A Test Events code is the word <code className="font-mono">TEST</code> followed
              by digits, exactly as Events Manager shows it.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground font-sans">
              Affects the server-sent purchase only. Browser events don't need it —
              the "Test browser events" box above covers those.
            </p>
          )}
        </div>
      </Card>

      {/* ── Who gets measured ───────────────────────────────────────────────── */}
      <Card title="Who gets measured" desc="These default to the protective setting. There are good reasons to leave them alone.">
        <div className="space-y-4">
          <Switch
            checked={data.require_consent}
            onChange={(require_consent) => onChange({ ...data, require_consent })}
            label="Only load the pixel after the visitor accepts cookies"
            hint="This one is not really a choice in the EU. The shop's own analytics measure everyone because the data never leaves our server; the Meta Pixel is a third-party advertising tag that writes identifiers and profiles people across sites, and no first-party exemption stretches to cover it. Turning this off is a decision to take with your own legal advice."
          />
          <Switch
            checked={data.exclude_internal}
            onChange={(exclude_internal) => onChange({ ...data, exclude_internal })}
            label="Never load the pixel while working on localhost"
            hint="The live shop always reports — a visit to theolivegoose.ie is a real visit whoever made it. This covers the copy of the site you run on your own machine while working on it, and it matters more here than anywhere else: these events don't just count, they teach Meta who to show your ads to. A week of reloading a checkout you are debugging teaches it to go looking for more people like that."
          />
          <Switch
            checked={data.track_ecommerce}
            onChange={(track_ecommerce) => onChange({ ...data, track_ecommerce })}
            label="Send shopping events (products, basket, checkout, purchase)"
            hint="Off leaves page views, searches and sign-ups only — and with them, no way to optimise a campaign for sales."
          />
          <Switch
            checked={data.advanced_matching}
            onChange={(advanced_matching) => onChange({ ...data, advanced_matching })}
            label="Advanced matching"
            hint="Sends a signed-in shopper's email, phone and name — scrambled beyond recovery before they leave the page, and again before the server sends the sale — so an ad seen on a phone can be connected to a purchase made on a laptop. Without it, that sale looks like it came from nowhere. It is still a real disclosure to Meta, and it only ever applies to someone who is signed in."
          />
        </div>
      </Card>

      {/* ── What to expect ──────────────────────────────────────────────────── */}
      <Card title="What Meta will show you" desc="And where it will disagree with the other two tabs.">
        <p className="font-sans text-sm text-foreground/80 leading-relaxed">
          <strong>Meta will report fewer people than the Analytics tab does, and
          that is correct.</strong> Everyone who declines cookies is still measured
          by the shop's own analytics — first-party, on our own server — and is
          deliberately absent from Meta. Your own devices are missing from both.
          Treat the Analytics tab as the count of what actually happened, and Meta
          as the view of the subset who consented.
        </p>
        <ul className="mt-4 space-y-1.5">
          {SENT_EVENTS.map(([name, what]) => (
            <li key={name} className="font-sans text-sm text-foreground/80">
              <code className="font-mono text-xs text-foreground">{name}</code>
              <span className="text-muted-foreground"> — {what}</span>
            </li>
          ))}
        </ul>
        <p className="font-sans text-xs text-muted-foreground mt-4 leading-relaxed">
          Two deliberate gaps. Meta has no event for a refund, so a refunded order
          stays in its numbers for good — the Analytics tab and Google Analytics
          both take it back out, so Meta's revenue will read slightly high on any
          month with returns in it. And events with no advertising meaning
          (removing something from the basket, page speed, the sign-in wall) aren't
          sent at all: they'd sit in Events Manager where no ad, audience or report
          could ever use them, while making the ones that matter harder to find.
        </p>
        <p className="font-sans text-xs text-muted-foreground mt-3 leading-relaxed">
          <strong className="text-foreground">Before you build a product
          catalogue.</strong> Every event above identifies products by this shop's
          own IDs — the same ones in the address bar of the admin's product list.
          If you later set up a Meta catalogue for dynamic ads, its items have to
          carry those same IDs, or Meta will receive perfectly good events about
          products it can't recognise and the ads will show nothing. Nothing here
          breaks in the meantime; it is only worth knowing on the day you start,
          because it is easier to match the feed to the shop than to change the
          shop.
        </p>
      </Card>

      {note && <p className="font-sans text-sm text-muted-foreground">{note}</p>}

      <button
        onClick={onSave}
        disabled={saving}
        className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium hover:bg-olive-light transition-all disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );
};

export default MetaPixelPanel;
