import { useEffect, useState } from "react";
import {
  getGa4ServerState, saveGa4ApiSecret, testGa4Connection,
  type Ga4ServerState,
} from "@/lib/api";
import { isMeasurementId } from "@/lib/ga";
import type { GoogleAnalyticsContent } from "@/lib/defaults";

// ── Small local primitives, matching the Analytics panel next door ─────────────

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

// The GA4 events the shop sends, in the order a shopper triggers them. Shown so
// the owner knows what to expect in GA4 rather than discovering it by absence.
const MIRRORED_EVENTS: Array<[string, string]> = [
  ["page_view", "every page, including in-app navigation"],
  ["view_item_list", "a grid of products was shown"],
  ["select_item", "a product card was clicked"],
  ["view_item", "a product page was shown"],
  ["add_to_cart / remove_from_cart", "basket changes, guests included"],
  ["view_cart", "the basket page was shown"],
  ["checkout_gate", "ours — the sign-in wall at Proceed to Checkout"],
  ["begin_checkout", "checkout page reached"],
  ["add_shipping_info", "delivery or pickup details accepted"],
  ["add_payment_info", "handed over to Stripe"],
  ["purchase", "written by the server when Stripe confirms payment"],
  ["search, sign_up, login, newsletter_signup", "account and interest events"],
  ["web_vital", "LCP, CLS, INP and TTFB samples"],
];

const GoogleAnalyticsPanel = ({ data, onChange, onSave, saving }: {
  data: GoogleAnalyticsContent;
  onChange: (next: GoogleAnalyticsContent) => void;
  onSave: () => void;
  saving: boolean;
}) => {
  const [server, setServer] = useState<Ga4ServerState | null>(null);
  const [secretDraft, setSecretDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getGa4ServerState().then(setServer).catch(() => setNote("Couldn't load the server-side settings."));
  }, []);

  const id = data.measurement_id.trim();
  const idValid = isMeasurementId(id);
  const idProblem = id.length > 0 && !idValid;

  const saveSecret = async (value: string | null) => {
    setBusy(true);
    setTestResult(null);
    try {
      const saved = await saveGa4ApiSecret(value);
      setServer((s) => (s ? { ...s, ...saved } : s));
      setSecretDraft("");
      setNote(value ? "API secret saved." : "API secret removed — purchases will no longer be reported to Google.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't save that.");
    } finally { setBusy(false); }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testGa4Connection();
      setTestResult({ ok: result.ok, text: result.ok ? (result.message ?? "Google accepted it.") : (result.problem ?? "That didn't work.") });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : "The test could not be run." });
    } finally { setTesting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="mb-2 pb-4 border-b border-border">
        <h2 className="font-serif text-2xl text-foreground">Google Analytics</h2>
        <p className="font-sans text-sm text-muted-foreground mt-1">
          Send the shop's traffic to a Google Analytics 4 property, alongside the
          shop's own figures in the Analytics tab. Off until you turn it on.
        </p>
      </div>

      {/* ── What is and isn't running ───────────────────────────────────────── */}
      <Card
        title="Setup"
        desc="All four have to be true before anything reaches Google."
      >
        <ul className="space-y-2">
          <Check state={data.enabled ? "ok" : "todo"}>
            {data.enabled ? "Turned on." : "Turned off — nothing is sent to Google."}
          </Check>
          <Check state={idValid ? "ok" : "todo"}>
            {idValid
              ? <>Measurement ID <code className="font-mono text-xs">{id}</code> saved.</>
              : idProblem
                ? "That measurement ID isn't a GA4 web stream id — they look like G-XXXXXXXXXX."
                : "No measurement ID yet. GA4 → Admin → Data streams → your web stream."}
          </Check>
          <Check state={server?.api_secret_set ? "ok" : "todo"}>
            {server?.api_secret_set
              ? server.api_secret_source === "env"
                ? <>API secret set on the server as <code className="font-mono text-xs">GA4_API_SECRET</code> — purchases are reported from the server.</>
                : <>API secret saved ({server.api_secret_hint}) — purchases are reported from the server.</>
              : "No API secret. Everything else works without one, but purchases and revenue will be missing."}
          </Check>
          <Check state={data.require_consent ? "ok" : "off"}>
            {data.require_consent
              ? "Loads only for visitors who accept cookies."
              : "Loads for every visitor, regardless of the cookie banner. Make sure that's a decision you've taken deliberately."}
          </Check>
        </ul>

        {server && server.measurement_id !== id.toUpperCase() && idValid && (
          <p className="font-sans text-xs mt-3" style={{ color: "#b26a00" }}>
            The measurement ID above hasn't been saved yet — press Save Changes to
            put it live.
          </p>
        )}
      </Card>

      {/* ── The switch and the id ───────────────────────────────────────────── */}
      <Card title="Tag" desc="What the shopper's browser loads.">
        <div className="space-y-4">
          <Switch
            checked={data.enabled}
            onChange={(enabled) => onChange({ ...data, enabled })}
            label="Send traffic to Google Analytics"
            hint="Loads Google's gtag.js on the storefront. Never on this admin panel."
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-sans font-medium text-foreground">Measurement ID</label>
            <TextInput
              value={data.measurement_id}
              placeholder="G-XXXXXXXXXX"
              spellCheck={false}
              onChange={(e) => onChange({ ...data, measurement_id: e.target.value.trim() })}
            />
            <p className="text-xs text-muted-foreground font-sans">
              In GA4: Admin → Data streams → your web stream. It starts with{" "}
              <code className="font-mono">G-</code>. This one is public — it ships in
              the page source, as it does on every site using GA4.
            </p>
            {idProblem && (
              <p className="text-xs font-sans" style={{ color: "#b3282f" }}>
                That isn't a GA4 measurement ID. A <code className="font-mono">UA-</code> id is
                the retired Universal Analytics; a <code className="font-mono">GTM-</code> id is
                Tag Manager. Neither will work here.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* ── Purchases ───────────────────────────────────────────────────────── */}
      <Card
        title="Purchases and revenue"
        desc="Written by the server, because the browser can't be relied on to be there."
      >
        <p className="font-sans text-sm text-foreground/80 leading-relaxed">
          When someone pays, they're on Stripe's site — and whether they ever come
          back to the shop is not something your revenue figures should depend on.
          So the purchase is sent to Google by our server the moment Stripe
          confirms the payment. That needs an API secret, which is the one thing
          here that is a password: anyone holding it can write events into your
          property, so it's stored on the server and never shown again.
        </p>

        {server?.api_secret_source === "env" ? (
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
            <p className="font-sans text-sm text-foreground">
              Nothing to do here — the secret is set on the server as{" "}
              <code className="font-mono text-xs">GA4_API_SECRET</code> ({server.api_secret_hint}),
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
            Measurement Protocol API secret
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              type="password"
              value={secretDraft}
              placeholder={server?.api_secret_set ? `Saved (${server.api_secret_hint}) — paste a new one to replace it` : "Paste the secret from GA4"}
              spellCheck={false}
              autoComplete="off"
              className="flex-1 min-w-[240px]"
              onChange={(e) => setSecretDraft(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || !secretDraft.trim()}
              onClick={() => saveSecret(secretDraft.trim())}
              className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium hover:bg-olive-light transition-all disabled:opacity-50"
            >
              Save secret
            </button>
            {server?.api_secret_set && (
              <button
                type="button"
                disabled={busy}
                onClick={() => saveSecret(null)}
                className="px-4 py-2.5 rounded-lg border border-border font-sans text-sm text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-sans">
            In GA4: Admin → Data streams → your web stream → Measurement Protocol
            API secrets → Create. Prefer to keep it out of the panel entirely?
            Set <code className="font-mono">GA4_API_SECRET</code> on the server
            (Railway → Variables) and this box disappears.
          </p>
        </div>
        )}

        <div className="mt-5 pt-4 border-t border-border">
          <p className="font-sans text-sm text-foreground/80 leading-relaxed">
            Google's collection endpoint accepts any measurement ID and any API
            secret without complaint — it will never tell you they're wrong. So
            this sends one <code className="font-mono text-xs">admin_test</code>{" "}
            event and points you at where it should land: if it doesn't appear in
            GA4 within a minute, one of the two is wrong.
          </p>
          <button
            type="button"
            disabled={testing}
            onClick={runTest}
            className="mt-3 px-4 py-2.5 rounded-lg border border-border font-sans text-sm text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
          >
            {testing ? "Asking Google…" : "Send a test event"}
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

      {/* ── Who gets measured ───────────────────────────────────────────────── */}
      <Card title="Who gets measured" desc="Both of these default to the protective setting. There are good reasons to leave them alone.">
        <div className="space-y-4">
          <Switch
            checked={data.require_consent}
            onChange={(require_consent) => onChange({ ...data, require_consent })}
            label="Only load the tag after the visitor accepts cookies"
            hint="The shop's own analytics measure everyone because the data never leaves our server — that's what makes them exempt from asking. Google Analytics is a third party receiving the same visits, and that reasoning doesn't stretch to cover it. Turning this off is a decision to take with your own legal advice."
          />
          <Switch
            checked={data.exclude_internal}
            onChange={(exclude_internal) => onChange({ ...data, exclude_internal })}
            label="Never load the tag on the shop's own browsers"
            hint="Uses the same signal as the Analytics tab's internal-traffic controls. Stricter here on purpose: an excluded visit can be filtered out of our own reports afterwards, but once a hit is in a GA4 property it is in it for good — so the tag simply never loads."
          />
          <Switch
            checked={data.track_ecommerce}
            onChange={(track_ecommerce) => onChange({ ...data, track_ecommerce })}
            label="Send shopping events (products, basket, checkout, purchase)"
            hint="Off leaves page views, searches and sign-ups only."
          />
          <Switch
            checked={data.debug_mode}
            onChange={(debug_mode) => onChange({ ...data, debug_mode })}
            label="Debug mode"
            hint="Tags every event so it appears in GA4 → Admin → DebugView while you're setting things up. Turn it off afterwards."
          />
        </div>
      </Card>

      {/* ── What to expect ──────────────────────────────────────────────────── */}
      <Card title="What Google will show you" desc="And where it will disagree with the Analytics tab.">
        <p className="font-sans text-sm text-foreground/80 leading-relaxed">
          <strong>Google will report fewer visitors than the Analytics tab does,
          and that is correct.</strong> Everyone who declines cookies is still
          measured by the shop's own analytics — first-party, on our own server —
          and is deliberately absent from Google. Your own devices are missing
          from both. Treat the Analytics tab as the count of what actually
          happened, and Google as the view of the subset who consented.
        </p>
        <ul className="mt-4 space-y-1.5">
          {MIRRORED_EVENTS.map(([name, what]) => (
            <li key={name} className="font-sans text-sm text-foreground/80">
              <code className="font-mono text-xs text-foreground">{name}</code>
              <span className="text-muted-foreground"> — {what}</span>
            </li>
          ))}
        </ul>
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

export default GoogleAnalyticsPanel;
