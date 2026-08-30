import { useCallback, useEffect, useMemo, useState } from "react";
import { RichTextarea } from "@/components/admin/RichTextInput";
import AbandonedCartPreview from "@/components/admin/AbandonedCartPreview";
import { useToast } from "@/hooks/use-toast";
import {
  ABANDONED_CART_TOKENS, DEFAULT_ABANDONED_CART_SETTINGS, applyAbandonedCartTokens,
  normalizeAbandonedCartSettings, type AbandonedCartSettings,
} from "@/lib/abandonedCart";
import {
  getAbandonedCarts, saveAbandonedCartSettings, sendAbandonedCartTest, sendAbandonedCartReminders,
  type AbandonedCartOverview, type AbandonedCartCandidate,
} from "@/lib/api";

/**
 * Admin → Ops → Abandoned Carts.
 *
 * One template, two ways out: the server's quarter-hourly sweep when automatic
 * sending is on, and the Send now buttons on this page. They share every line of
 * sending code — see backend/abandonedCart.js — so what an admin tests here is
 * what goes out at 3am without them.
 *
 * The screen is deliberately arranged as: what happened → who is waiting → what
 * they will be sent. An admin arriving because "did the emails go out?" should
 * get the answer above the fold, not after scrolling past a form.
 *
 * Every basket in the waiting list carries the server's own verdict, including
 * why it is being skipped. A list that quietly omits people is indistinguishable
 * from a broken feature, and the reasons ("they ordered since", "still inside the
 * cooldown") are the ones an admin would otherwise ask about.
 */

const Card = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="font-sans text-sm font-semibold text-foreground">{title}</p>
    {desc && <p className="font-sans text-xs text-muted-foreground mt-0.5">{desc}</p>}
    <div className="mt-3">{children}</div>
  </div>
);

const TextInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${props.className ?? ""}`}
  />
);

const Labelled = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label className="block text-sm font-sans font-medium text-foreground">{label}</label>
    {children}
    {hint && <p className="text-xs text-muted-foreground font-sans">{hint}</p>}
  </div>
);

const Tile = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="rounded-xl border border-border p-4">
    <p className="font-sans text-2xl font-semibold text-foreground">{value}</p>
    <p className="font-sans text-xs text-muted-foreground">{label}</p>
    {hint && <p className="font-sans text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
  </div>
);

const euro = (n: number) => `€${Number(n || 0).toFixed(2)}`;

/** "3 hours" / "2 days" — an idle time an admin can judge at a glance. */
const idleLabel = (hours: number) =>
  hours < 1 ? "under an hour" : hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;

const AbandonedCartPanel = () => {
  const [data, setData] = useState<AbandonedCartOverview | null>(null);
  const [draft, setDraft] = useState<AbandonedCartSettings>(DEFAULT_ABANDONED_CART_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback((keepDraft = false) => {
    setLoading(true);
    getAbandonedCarts()
      .then(d => {
        setData(d);
        if (!keepDraft) setDraft(d.settings);
      })
      .catch(err => toast({
        title: "Couldn't load abandoned carts",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof AbandonedCartSettings>(key: K, value: AbandonedCartSettings[K]) =>
    setDraft(d => ({ ...d, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      // The server normalises and returns what it actually stored, and that is
      // what goes back into the form — so a clamped value is visible immediately
      // rather than the next time this page is opened.
      const result = await saveAbandonedCartSettings(normalizeAbandonedCartSettings(draft));
      setDraft(result.settings);
      toast({
        title: "Abandoned-cart settings saved",
        description: result.discount_problem || undefined,
        variant: result.discount_problem ? "destructive" : undefined,
      });
      load(true);
    } catch (err) {
      toast({
        title: "Couldn't save",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { delivered } = await sendAbandonedCartTest(testTo.trim(), normalizeAbandonedCartSettings(draft));
      toast({
        title: delivered ? "Test sent — go and look at it" : "Not sent: email sending isn't configured",
        description: delivered
          ? "It uses a sample basket, and its opt-out link is a placeholder that explains itself."
          : "RESEND_API_KEY is missing on the server, so nothing left the building.",
        variant: delivered ? undefined : "destructive",
      });
    } catch (err) {
      toast({
        title: "Test failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally { setTesting(false); }
  };

  /**
   * Send for real. Naming the person (or the number of people) is the point of
   * the prompt — "Are you sure?" is a reflex to click through, "email 6 shoppers"
   * is a thing you read.
   */
  const send = async (candidate?: AbandonedCartCandidate) => {
    const dueCount = data?.carts.filter(c => c.due).length ?? 0;
    const ok = confirm(
      candidate
        ? `Email ${candidate.email} about their basket (${euro(candidate.cart_total)})?\n\nThis can't be undone or recalled.`
        : `Send reminders to the ${dueCount} ${dueCount === 1 ? "shopper" : "shoppers"} due right now?\n\nThis can't be undone or recalled.`
    );
    if (!ok) return;
    setSendingId(candidate?.user_id ?? "all");
    try {
      const { sent, skipped, failed } = await sendAbandonedCartReminders(candidate?.user_id);
      toast({
        title: sent > 0 ? `Sent ${sent} reminder${sent === 1 ? "" : "s"}` : "Nothing was sent",
        description: [
          skipped ? `${skipped} skipped — opted out of basket reminders.` : "",
          failed ? `${failed} could not be delivered — check the server logs.` : "",
        ].filter(Boolean).join(" ") || undefined,
        variant: failed > 0 ? "destructive" : undefined,
      });
      load(true);
    } catch (err) {
      toast({
        title: "Couldn't send",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally { setSendingId(null); }
  };

  // The preview resolves against the server's context, with the two fields an
  // admin can change without saving (the button's words, the shop name) taken
  // from the draft — so typing in the form is visible immediately.
  const previewCtx = useMemo(() => {
    const base = data?.sample_context;
    if (!base) return null;
    return { ...base, cta_label: draft.cta_label || base.cta_label };
  }, [data?.sample_context, draft.cta_label]);

  const waiting = data?.carts ?? [];
  const due = waiting.filter(c => c.due);
  const stats = data?.stats;

  return (
    <div className="space-y-6">
      <div className="mb-2 pb-4 border-b border-border">
        <h2 className="font-serif text-2xl text-foreground">Abandoned Carts</h2>
        <p className="font-sans text-sm text-muted-foreground mt-1">
          One email, written once here, filled in with whatever that shopper actually left in their
          basket. It goes out automatically once a basket has sat untouched for the delay below — or
          whenever you press Send now.
        </p>
      </div>

      {!loading && data && !data.email_configured && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-sans text-sm text-foreground">
            Email sending isn't configured on the server (<code>RESEND_API_KEY</code> is missing), so
            nothing can go out — automatically or by hand.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tile label="Baskets waiting" value={loading ? "…" : waiting.length} />
        <Tile label="Due right now" value={loading ? "…" : due.length} hint="What Send now would email" />
        <Tile label="Reminders sent (30d)" value={loading ? "…" : stats?.sent_30d ?? 0} />
        <Tile label="Recovered (30d)" value={loading ? "…" : stats?.recovered_30d ?? 0} hint="Orders within 7 days of a reminder" />
        <Tile label="Recovered revenue (30d)" value={loading ? "…" : euro(stats?.recovered_revenue_30d ?? 0)} />
      </div>

      {/* ── When it fires ───────────────────────────────────────────────────── */}
      <Card
        title="When it sends"
        desc="Automatic sending uses the shop's own clock. Everything here is also what the Send now buttons below respect — except quiet hours and the cadence, which a deliberate click overrides."
      >
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={draft.enabled}
              onChange={e => set("enabled", e.target.checked)}
              className="accent-primary mt-0.5 w-4 h-4 shrink-0" />
            <span className="min-w-0">
              <span className="block font-sans text-sm text-foreground">Send automatically</span>
              <span className="block font-sans text-xs text-muted-foreground mt-0.5">
                Off means nothing goes out on its own. You can still send by hand from the list below.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Labelled label="Send after (hours)" hint="How long a basket sits untouched first.">
              <TextInput aria-label="Send after (hours)" type="number" min={1} max={168} value={draft.delay_hours}
                onChange={e => set("delay_hours", Number(e.target.value))} />
            </Labelled>
            <Labelled label="Reminders per basket" hint="1–3. Counted per basket, not per shopper.">
              <TextInput type="number" min={1} max={3} value={draft.max_reminders}
                onChange={e => set("max_reminders", Number(e.target.value))} />
            </Labelled>
            <Labelled label="Gap between them (hours)" hint="Only used when more than one is allowed.">
              <TextInput type="number" min={1} max={168} value={draft.followup_hours}
                onChange={e => set("followup_hours", Number(e.target.value))} />
            </Labelled>
            <Labelled label="Cooldown (days)" hint="Before the same shopper can start a new series.">
              <TextInput type="number" min={0} max={90} value={draft.cooldown_days}
                onChange={e => set("cooldown_days", Number(e.target.value))} />
            </Labelled>
            <Labelled label="Quiet from (hour)" hint="24-hour clock, Irish time.">
              <TextInput type="number" min={0} max={23} value={draft.quiet_hours_start}
                onChange={e => set("quiet_hours_start", Number(e.target.value))} />
            </Labelled>
            <Labelled label="Quiet until (hour)" hint="Set both the same for no quiet period.">
              <TextInput type="number" min={0} max={23} value={draft.quiet_hours_end}
                onChange={e => set("quiet_hours_end", Number(e.target.value))} />
            </Labelled>
          </div>
        </div>
      </Card>

      {/* ── The email ───────────────────────────────────────────────────────── */}
      <Card
        title="The email"
        desc="Select text and use B / I / U. Leave a blank line between paragraphs. The tokens below are filled in per shopper."
      >
        <div className="space-y-4">
          <Labelled label="Subject" hint="What shows in the inbox list.">
            <TextInput aria-label="Subject" value={draft.subject} maxLength={200}
              onChange={e => set("subject", e.target.value)} />
          </Labelled>

          <Labelled label="Preheader"
            hint="The grey line beside the subject. Left empty, mail clients use the first words of the email instead — usually 'Hi there,'.">
            <TextInput aria-label="Preheader" value={draft.preheader} maxLength={200}
              onChange={e => set("preheader", e.target.value)} />
          </Labelled>

          <Labelled label="Message"
            hint="{cart_items} and {cart_button} each go on a line of their own. If you delete them, they're added back at the end — an email about a basket has to show the basket.">
            <RichTextarea rows={10} value={draft.body}
              onChange={e => set("body", e.target.value)}
              extraTools={(insert) => (
                <span className="flex flex-wrap gap-1">
                  {ABANDONED_CART_TOKENS.map(token => (
                    <button key={token} type="button" onClick={() => insert(token)}
                      className="px-2 py-1 rounded border border-border bg-card font-mono text-[11px] text-muted-foreground hover:text-foreground">
                      {token}
                    </button>
                  ))}
                </span>
              )} />
          </Labelled>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Labelled label="Button words" hint="What the button back to the basket says.">
              <TextInput aria-label="Button words" value={draft.cta_label} maxLength={60}
                onChange={e => set("cta_label", e.target.value)} />
            </Labelled>
            <Labelled label="Discount code (optional)"
              hint="An existing code from Ops → Discount Codes. Use {discount_code} and {discount_value} in the message to mention it.">
              <TextInput aria-label="Discount code" value={draft.discount_code} maxLength={60} placeholder="e.g. COMEBACK10"
                onChange={e => set("discount_code", e.target.value.toUpperCase())} />
            </Labelled>
          </div>

          {data?.discount_problem && (
            <p className="font-sans text-xs" style={{ color: "var(--color-error, #a2542f)" }}>
              {data.discount_problem}
            </p>
          )}
          {!data?.discount_problem && data?.discount_value && (
            <p className="font-sans text-xs text-muted-foreground">
              That code is worth <strong>{data.discount_value}</strong> — which is what{" "}
              <code>{"{discount_value}"}</code> puts in the email.
            </p>
          )}
        </div>
      </Card>

      {/* ── Attribution ─────────────────────────────────────────────────────── */}
      <Card
        title="How the sale gets counted"
        desc="These tags ride on the link back to the basket. Without them a recovered sale arrives looking like direct traffic, and GA4 hands it to whichever ad campaign touched that shopper last — which inflates the ROAS of ads that had nothing to do with it."
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Labelled label="utm_source">
              <TextInput aria-label="utm_source" value={draft.utm_source} onChange={e => set("utm_source", e.target.value)} />
            </Labelled>
            <Labelled label="utm_medium" hint="Keep this 'email' — it's what GA4 maps to the Email channel.">
              <TextInput aria-label="utm_medium" value={draft.utm_medium} onChange={e => set("utm_medium", e.target.value)} />
            </Labelled>
            <Labelled label="utm_campaign">
              <TextInput aria-label="utm_campaign" value={draft.utm_campaign} onChange={e => set("utm_campaign", e.target.value)} />
            </Labelled>
          </div>
          {previewCtx && (
            <p className="font-sans text-xs text-muted-foreground break-all">
              Link in the email: <code>{previewCtx.cart_url}</code>
            </p>
          )}
          <p className="font-sans text-xs text-muted-foreground">
            Purchases made within 7 days of a reminder are credited to it — the same click-through
            window Meta and Google both default to, so "recovered revenue" above can be read beside
            Ads Manager and GA4 without translating between two definitions. No ad click id is ever
            added to these links: inventing one to make an email look like an ad click breaks both
            platforms' terms and corrupts the very numbers the shop buys ads on.
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={save} disabled={saving}
          className="px-5 py-2 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium hover:bg-olive-light transition-all disabled:opacity-50">
          {saving ? "Saving…" : "Save settings"}
        </button>
        <button onClick={() => { setDraft(data?.settings ?? DEFAULT_ABANDONED_CART_SETTINGS); }}
          className="px-4 py-2 rounded-lg border border-border bg-card font-sans text-sm text-foreground">
          Undo changes
        </button>
      </div>

      {/* ── Preview ─────────────────────────────────────────────────────────── */}
      {previewCtx && (
        <div className="space-y-2">
          <p className="font-sans text-xs text-muted-foreground">
            {data?.sample_is_real
              ? "Previewed with a basket that is actually waiting right now."
              : "Previewed with a sample basket — no baskets are waiting at the moment."}
          </p>
          {/* The subject and preheader are token-resolved here for the same
              reason the email resolves them: they take the same tokens, and a
              preview showing a raw {"{first_name}"} where the inbox will show a
              name is a preview of the wrong email. */}
          <AbandonedCartPreview
            subject={applyAbandonedCartTokens(draft.subject, previewCtx)}
            preheader={applyAbandonedCartTokens(draft.preheader, previewCtx)}
            body={draft.body}
            ctx={previewCtx}
          />
        </div>
      )}

      {/* ── Test ────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-4">
        <div>
          <h3 className="font-sans text-sm font-semibold text-foreground">Send yourself a test first</h3>
          <p className="font-sans text-xs text-muted-foreground">
            Uses whatever is in the form right now, saved or not, with a sample basket. A real
            delivery to a real mailbox is the only thing that catches a mangled subject line or a
            sending problem while it still costs nothing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[220px]">
            <TextInput aria-label="Test recipient" type="email" value={testTo} placeholder="you@example.com"
              onChange={e => setTestTo(e.target.value)} />
          </div>
          <button type="button" onClick={handleTest} disabled={testing || !testTo.trim()}
            className="px-4 py-2.5 rounded-lg border border-border bg-card font-sans text-sm text-foreground disabled:opacity-50">
            {testing ? "Sending…" : "Send test"}
          </button>
        </div>
      </div>

      {/* ── Who is waiting ──────────────────────────────────────────────────── */}
      <Card
        title="Baskets waiting"
        desc="Every signed-in shopper with something in their basket, and whether a reminder is due. Send now ignores the timing rules — but never someone's opt-out."
      >
        {loading ? (
          <p className="font-sans text-sm text-muted-foreground">Loading…</p>
        ) : waiting.length === 0 ? (
          <p className="font-sans text-sm text-muted-foreground">
            Nobody has anything sitting in a basket right now.
          </p>
        ) : (
          <div className="space-y-3">
            <button type="button" onClick={() => send()}
              disabled={due.length === 0 || sendingId !== null || !data?.email_configured}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium disabled:opacity-50">
              {sendingId === "all" ? "Sending…" : `Send to everyone due (${due.length})`}
            </button>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Shopper</th>
                    <th className="py-2 pr-3 font-medium">Basket</th>
                    <th className="py-2 pr-3 font-medium">Value</th>
                    <th className="py-2 pr-3 font-medium">Idle</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.map(cart => (
                    <tr key={cart.user_id} className="border-t border-border align-top">
                      <td className="py-2.5 pr-3 font-sans text-sm text-foreground">
                        {cart.email}
                        {cart.full_name && (
                          <span className="block text-xs text-muted-foreground">{cart.full_name}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-sans text-xs text-muted-foreground">
                        {cart.items.map(i => `${i.name} × ${i.quantity}`).join(", ")}
                        {cart.missing_products > 0 && (
                          <span className="block">
                            {cart.missing_products} item{cart.missing_products === 1 ? "" : "s"} no longer in the
                            catalogue — left out of the email.
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-sans text-sm text-foreground whitespace-nowrap">
                        {euro(cart.cart_total)}
                      </td>
                      <td className="py-2.5 pr-3 font-sans text-sm text-muted-foreground whitespace-nowrap">
                        {idleLabel(cart.idle_hours)}
                      </td>
                      <td className="py-2.5 pr-3 font-sans text-xs">
                        {cart.due ? (
                          <span className="text-foreground">Due now</span>
                        ) : cart.blocked_reason ? (
                          <span className="text-muted-foreground">{cart.blocked_reason}</span>
                        ) : !cart.is_abandoned ? (
                          <span className="text-muted-foreground">
                            Still shopping — not idle {draft.delay_hours}h yet
                          </span>
                        ) : cart.quiet_hours ? (
                          <span className="text-muted-foreground">Waiting for quiet hours to end</span>
                        ) : (
                          <span className="text-muted-foreground">Not due</span>
                        )}
                        {cart.reminders_sent > 0 && (
                          <span className="block text-muted-foreground">
                            {cart.reminders_sent} sent for this basket
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        <button type="button" onClick={() => send(cart)}
                          disabled={sendingId !== null || !data?.email_configured}
                          className="px-3 py-1.5 rounded-lg border border-border bg-card font-sans text-xs text-foreground disabled:opacity-50">
                          {sendingId === cart.user_id ? "Sending…" : "Send now"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* ── History ─────────────────────────────────────────────────────────── */}
      <Card title="Recent reminders" desc="The last 20, and whether each one brought the shopper back.">
        {loading ? (
          <p className="font-sans text-sm text-muted-foreground">Loading…</p>
        ) : (data?.history.length ?? 0) === 0 ? (
          <p className="font-sans text-sm text-muted-foreground">Nothing has been sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Sent</th>
                  <th className="py-2 pr-3 font-medium">To</th>
                  <th className="py-2 pr-3 font-medium">Basket</th>
                  <th className="py-2 pr-3 font-medium">How</th>
                  <th className="py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {data?.history.map(row => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="py-2.5 pr-3 font-sans text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(row.sent_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-3 font-sans text-sm text-foreground">{row.email}</td>
                    <td className="py-2.5 pr-3 font-sans text-sm text-foreground whitespace-nowrap">
                      {euro(Number(row.cart_total))}
                    </td>
                    <td className="py-2.5 pr-3 font-sans text-xs text-muted-foreground">
                      {row.trigger_source === "manual" ? "By hand" : "Automatic"}
                      {row.reminder_number > 1 && ` · #${row.reminder_number}`}
                    </td>
                    <td className="py-2.5 font-sans text-xs">
                      {!row.delivered ? (
                        <span style={{ color: "var(--color-error, #a2542f)" }}>Not delivered</span>
                      ) : row.recovered_at ? (
                        <span className="text-foreground">
                          Recovered {euro(Number(row.recovered_total ?? 0))}
                          {row.recovered_order_number && ` · #${row.recovered_order_number}`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Sent</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AbandonedCartPanel;
