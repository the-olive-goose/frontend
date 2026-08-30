// ── Abandoned carts: who is owed a reminder, and sending it ────────────────────
//
// Lives in its own file rather than in index.js because it is the whole feature
// in one place: the eligibility rules, the send, and the recovery bookkeeping.
// index.js keeps the HTTP surface (four admin endpoints) and the schema; the
// scheduler keeps the clock.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: nobody gets the same basket emailed at
// them twice. Every guard below is one way that could happen —
//
//   * the basket is fingerprinted, so editing it starts a new series rather than
//     re-arming the old one, and NOT editing it cannot re-arm anything;
//   * `max_reminders` caps a series, `followup_hours` spaces it, `cooldown_days`
//     spaces the next series;
//   * a row is written for every send, delivered or not, so a crashed sweep
//     resumes instead of restarting;
//   * quiet hours exist because a 3am marketing email is how a shop earns a spam
//     complaint it can't undo.
//
// @see src/lib/abandonedCart.ts — the settings shape and token grammar, in TS.

import crypto from 'crypto';
import { sendAbandonedCartEmail } from './email.js';

const SETTINGS_KEY = 'abandoned_cart_settings';

/**
 * How long after a reminder a purchase still counts as recovered by it.
 *
 * Seven days is the window Meta and Google both default to for click-through
 * attribution, so the shop's own "recovered by email" figure can be read beside
 * Ads Manager and GA4 without translating between two definitions.
 */
export const RECOVERY_ATTRIBUTION_DAYS = 7;

export const DEFAULT_ABANDONED_CART_SETTINGS = {
  enabled: false,
  delay_hours: 4,
  max_reminders: 1,
  followup_hours: 24,
  cooldown_days: 14,
  quiet_hours_start: 22,
  quiet_hours_end: 8,
  subject: 'You left something behind 🫒',
  preheader: 'Your basket is still here — pick up where you left off.',
  body:
    'Hi {first_name},\n\n' +
    'You were *this* close. Your basket is still sitting here, exactly as you left it:\n\n' +
    '{cart_items}\n\n' +
    '{cart_button}\n\n' +
    "No rush — but our small batches do run out, and we'd hate for you to miss this one.",
  cta_label: 'Back to my basket',
  discount_code: '',
  utm_source: 'olive_goose',
  utm_medium: 'email',
  utm_campaign: 'abandoned_cart',
};

const LIMITS = {
  minDelayHours: 1,
  maxDelayHours: 168,
  maxReminders: 3,
  minFollowupHours: 1,
  maxCooldownDays: 90,
};

/**
 * Clamp rather than reject. These arrive from text inputs in a dashboard, and a
 * blank box that becomes "every 0 hours, to everyone, forever" is the failure
 * worth designing out. Mirrors normalizeAbandonedCartSettings in TS.
 */
export const normalizeAbandonedCartSettings = (raw) => {
  const d = DEFAULT_ABANDONED_CART_SETTINGS;
  const s = { ...d, ...(raw || {}) };
  const num = (v, fallback, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const text = (v, fallback, max) => {
    const t = typeof v === 'string' ? v.trim() : '';
    return (t || fallback).slice(0, max);
  };
  return {
    enabled: !!s.enabled,
    delay_hours:       num(s.delay_hours, d.delay_hours, LIMITS.minDelayHours, LIMITS.maxDelayHours),
    max_reminders:     num(s.max_reminders, d.max_reminders, 1, LIMITS.maxReminders),
    followup_hours:    num(s.followup_hours, d.followup_hours, LIMITS.minFollowupHours, LIMITS.maxDelayHours),
    cooldown_days:     num(s.cooldown_days, d.cooldown_days, 0, LIMITS.maxCooldownDays),
    quiet_hours_start: num(s.quiet_hours_start, d.quiet_hours_start, 0, 23),
    quiet_hours_end:   num(s.quiet_hours_end, d.quiet_hours_end, 0, 23),
    subject:   text(s.subject, d.subject, 200),
    preheader: typeof s.preheader === 'string' ? s.preheader.trim().slice(0, 200) : d.preheader,
    body:      text(s.body, d.body, 20000),
    cta_label: text(s.cta_label, d.cta_label, 60),
    discount_code: (typeof s.discount_code === 'string' ? s.discount_code.trim().toUpperCase() : '').slice(0, 60),
    utm_source:   text(s.utm_source, d.utm_source, 100),
    utm_medium:   text(s.utm_medium, d.utm_medium, 100),
    utm_campaign: text(s.utm_campaign, d.utm_campaign, 100),
  };
};

export const getAbandonedCartSettings = async (pool) => {
  const { rows } = await pool.query('SELECT value FROM site_settings WHERE key = $1', [SETTINGS_KEY]);
  return normalizeAbandonedCartSettings(rows[0]?.value);
};

export const saveAbandonedCartSettings = async (pool, raw) => {
  const settings = normalizeAbandonedCartSettings(raw);
  await pool.query(
    `INSERT INTO site_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(settings)]
  );
  return settings;
};

// ── Small pure helpers, mirrored in src/lib/abandonedCart.ts ──────────────────

/** Wraps midnight; start === end means "no quiet window", never "all day". */
export const isQuietHour = (hour, start, end) => {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
};

/** The hour of the shop's own clock, not the server's — Railway runs in UTC. */
const shopHour = (date, timeZone = 'Europe/Dublin') => {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date));
  } catch {
    return date.getUTCHours();
  }
};

/**
 * What makes two baskets "the same basket".
 *
 * Product ids and quantities, sorted — not the row ids, and not the timestamps.
 * Adding a candle makes a new fingerprint (a new series is fair: they came back
 * and did something), removing one does too, and idly reloading the basket page
 * changes nothing.
 */
export const cartFingerprint = (items) =>
  crypto.createHash('sha256').update(
    items
      .map(i => `${i.product_id}:${i.quantity}`)
      .sort()
      .join('|')
  ).digest('hex').slice(0, 32);

const euro = (n) => `€${Number(n).toFixed(2)}`;

const parsePrice = (price) => {
  const n = parseFloat(String(price ?? '').replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

/** https only: a /uploads/ path renders in the dashboard and breaks in a mailbox. */
const emailableImage = (url) => (/^https:\/\/[^\s]+$/i.test(String(url ?? '').trim()) ? String(url).trim() : '');

const firstName = (fullName) => {
  const first = String(fullName ?? '').trim().split(/\s+/)[0] || '';
  // "there" reads as written English in "Hi there," — an empty string leaves
  // "Hi ,", which is the classic sign of a mail merge nobody checked.
  return first || 'there';
};

// ── Finding the carts ─────────────────────────────────────────────────────────

/**
 * Every non-empty basket, with the shopper, priced from the LIVE catalogue.
 *
 * The catalogue re-price is not a nicety: `product_data` on a cart row is a
 * snapshot the browser sent when the item was added, and it goes stale — dead
 * image URLs and old prices outlive the catalogue edit that fixed them. An email
 * quoting a price the basket no longer charges is a complaint waiting to happen,
 * so the snapshot is used for nothing but the id.
 *
 * Returns candidates in "most recently active first" order, each annotated with
 * why it is or is not sendable right now. The admin screen shows the lot,
 * reasons included — an empty list with no explanation is indistinguishable from
 * a broken feature.
 */
export const findAbandonedCarts = async (pool, settings, { now = new Date() } = {}) => {
  const { rows: cartRows } = await pool.query(
    `SELECT c.user_id, c.product_id, c.product_data, c.quantity,
            GREATEST(c.created_at, COALESCE(c.updated_at, c.created_at)) AS touched_at,
            u.email, u.full_name
       FROM user_carts c
       JOIN users u ON u.id = c.user_id
      WHERE u.email IS NOT NULL AND u.email <> ''
      ORDER BY c.created_at ASC`
  );
  if (!cartRows.length) return [];

  const { rows: catalogRows } = await pool.query(
    `SELECT value FROM site_settings WHERE key = 'content_products'`
  );
  const catalog = catalogRows[0]?.value?.items || [];

  // Group by shopper.
  const byUser = new Map();
  for (const row of cartRows) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = {
        user_id: row.user_id,
        email: String(row.email).toLowerCase(),
        full_name: row.full_name || '',
        last_activity: row.touched_at,
        items: [],
        missing_products: 0,
      };
      byUser.set(row.user_id, entry);
    }
    if (new Date(row.touched_at) > new Date(entry.last_activity)) entry.last_activity = row.touched_at;

    const live = catalog.find(p => String(p.id) === String(row.product_id));
    if (!live) { entry.missing_products++; continue; }
    const unit = parsePrice(live.price);
    entry.items.push({
      product_id: row.product_id,
      name: live.name || 'Item',
      quantity: row.quantity,
      unit_price: unit,
      line_total: unit * row.quantity,
      image_url: emailableImage(live.image_url || (Array.isArray(live.gallery_urls) ? live.gallery_urls[0] : '')),
    });
  }

  const users = [...byUser.values()].filter(u => u.items.length > 0);
  if (!users.length) return [];
  const userIds = users.map(u => u.user_id);

  // Everything else the decision needs, in three queries rather than three per
  // shopper: what we have already sent them, whether they have opted out, and
  // when they last ordered.
  const [{ rows: sends }, { rows: optOuts }, { rows: orders }] = await Promise.all([
    pool.query(
      `SELECT user_id, cart_fingerprint, reminder_number, sent_at
         FROM abandoned_cart_sends WHERE user_id = ANY($1::uuid[]) ORDER BY sent_at ASC`,
      [userIds]
    ),
    pool.query(
      `SELECT email FROM cart_reminder_optouts WHERE opted_out_at IS NOT NULL AND email = ANY($1::text[])`,
      [users.map(u => u.email)]
    ),
    pool.query(
      `SELECT user_id, MAX(created_at) AS last_order_at FROM orders
        WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`,
      [userIds]
    ),
  ]);

  const optedOut = new Set(optOuts.map(r => r.email));
  const lastOrderAt = new Map(orders.map(r => [r.user_id, r.last_order_at]));

  const hoursSince = (t) => (now.getTime() - new Date(t).getTime()) / 3_600_000;
  const quiet = isQuietHour(shopHour(now), settings.quiet_hours_start, settings.quiet_hours_end);

  const candidates = users.map(u => {
    const fingerprint = cartFingerprint(u.items);
    const mine = sends.filter(s => s.user_id === u.user_id);
    const forThisCart = mine.filter(s => s.cart_fingerprint === fingerprint);
    const lastSend = mine.length ? mine[mine.length - 1] : null;
    const cartTotal = u.items.reduce((sum, i) => sum + i.line_total, 0);
    const idleHours = hoursSince(u.last_activity);
    const lastOrder = lastOrderAt.get(u.user_id) || null;

    // Ordered *after* the basket was last touched — the leftovers of a checkout
    // that only partly cleared, or a second basket they've since bought from.
    // Either way, emailing "you forgot something" would be wrong.
    const orderedSince = !!lastOrder && new Date(lastOrder) > new Date(u.last_activity);

    let blocked = null;
    if (optedOut.has(u.email)) blocked = 'They opted out of basket reminders.';
    else if (orderedSince) blocked = 'They have ordered since this basket was last touched.';
    else if (forThisCart.length >= settings.max_reminders)
      blocked = `Already had ${forThisCart.length} reminder${forThisCart.length === 1 ? '' : 's'} for this exact basket.`;
    else if (forThisCart.length > 0 && hoursSince(forThisCart[forThisCart.length - 1].sent_at) < settings.followup_hours)
      blocked = `Follow-up isn't due yet (${settings.followup_hours}h between reminders).`;
    else if (forThisCart.length === 0 && lastSend && hoursSince(lastSend.sent_at) < settings.cooldown_days * 24)
      blocked = `Within the ${settings.cooldown_days}-day cooldown from their last reminder.`;

    return {
      user_id: u.user_id,
      email: u.email,
      full_name: u.full_name,
      items: u.items,
      missing_products: u.missing_products,
      cart_total: cartTotal,
      cart_fingerprint: fingerprint,
      last_activity: u.last_activity,
      idle_hours: Math.floor(idleHours),
      reminders_sent: forThisCart.length,
      last_reminder_at: lastSend?.sent_at || null,
      // Old enough to count as abandoned rather than "still shopping".
      is_abandoned: idleHours >= settings.delay_hours,
      // Why the sweep would skip them. Manual sends ignore everything except the
      // opt-out — see sendAbandonedCartReminder.
      blocked_reason: blocked,
      quiet_hours: quiet,
      /** True when tonight's sweep would send this one. */
      due: idleHours >= settings.delay_hours && !blocked && !quiet,
    };
  });

  return candidates.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
};

// ── Opting out ────────────────────────────────────────────────────────────────

/**
 * The token behind this recipient's "stop basket reminders" link.
 *
 * Issued at send time and stored, because the opt-out page resolves a token to
 * an address and an HMAC cannot be reversed — and putting the address in the URL
 * instead would turn the link into a way to unsubscribe anyone whose email you
 * can guess. Same reasoning as the newsletter's tokens next door.
 */
export const optOutTokenFor = async (pool, email) => {
  const token = crypto.randomBytes(24).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO cart_reminder_optouts (email, token) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING token`,
    [String(email).toLowerCase(), token]
  );
  return rows[0].token;
};

// ── Sending ───────────────────────────────────────────────────────────────────

/**
 * The link back to the basket, tagged for the ad platforms.
 *
 * Mirrors recoveryUrl in src/lib/abandonedCart.ts, where the reasoning is
 * written out: an untagged click from an email looks like direct traffic, and
 * GA4 will hand that sale to whichever ad campaign touched the shopper last.
 * The tags keep the recovery in the Email channel where it belongs, so the ROAS
 * the shop buys on stays honest. No gclid/fbclid is invented — that is against
 * both platforms' terms and would corrupt the same numbers.
 */
export const recoveryUrl = (frontendUrl, settings, extraParams = {}) => {
  const base = String(frontendUrl || '').replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (settings.utm_source) params.set('utm_source', settings.utm_source);
  if (settings.utm_medium) params.set('utm_medium', settings.utm_medium);
  if (settings.utm_campaign) params.set('utm_campaign', settings.utm_campaign);
  for (const [k, v] of Object.entries(extraParams)) if (v) params.set(k, v);
  const query = params.toString();
  return `${base}/basket${query ? `?${query}` : ''}`;
};

/**
 * What the configured code is actually worth, read from the codes table.
 *
 * Never from the settings row: an admin who types "SAVE10" and later edits that
 * code to be worth 5% must not have an email still promising 10. `problem` is
 * what the dashboard shows them — a code that does not exist, is switched off,
 * or is already fully redeemed still sends, because the words in the email are
 * the admin's to write, but they get told before it goes out.
 */
export const describeDiscount = async (pool, code) => {
  if (!code) return { code: '', value: '', problem: null };
  const { rows } = await pool.query(
    `SELECT discount_type, discount_value, discount_percent, is_active,
            max_redemptions, redemption_count
       FROM discount_codes WHERE UPPER(code) = UPPER($1) LIMIT 1`,
    [code]
  );
  const row = rows[0];
  if (!row) return { code, value: '', problem: 'No discount code by that name exists in Ops → Discount Codes.' };

  const value = Number(row.discount_value) || Number(row.discount_percent) || 0;
  const formatted = row.discount_type === 'fixed'
    ? `€${Number.isInteger(value) ? value : value.toFixed(2)}`
    : `${value}%`;

  let problem = null;
  if (!row.is_active) problem = 'That code is switched off, so it will be refused at checkout.';
  else if (row.max_redemptions > 0 && row.redemption_count >= row.max_redemptions)
    problem = 'That code has been fully redeemed already, so it will be refused at checkout.';

  return { code, value: formatted, problem };
};

/**
 * Build one shopper's template context.
 *
 * Everything the template can say about money is computed here, once, from the
 * live catalogue and the live shipping settings — never from the cart snapshot
 * and never in the template.
 */
export const buildContext = async (pool, { candidate, settings, frontendUrl, shopName = 'The Olive Goose' }) => {
  const [{ rows: pickupRows }, discount] = await Promise.all([
    pool.query(`SELECT value FROM site_settings WHERE key = 'content_pickupSettings'`),
    describeDiscount(pool, settings.discount_code),
  ]);
  const rawThreshold = Number(pickupRows[0]?.value?.free_shipping_threshold);
  const threshold = Number.isFinite(rawThreshold) ? rawThreshold : 65;

  return {
    first_name: firstName(candidate.full_name),
    cart_url: recoveryUrl(frontendUrl, settings),
    cart_total: euro(candidate.cart_total),
    item_count: candidate.items.reduce((sum, i) => sum + i.quantity, 0),
    discount_code: discount.code,
    discount_value: discount.value,
    // Same clause the storefront's {free_shipping} token resolves to, so the
    // email cannot promise a threshold the basket does not honour.
    free_shipping: threshold <= 0
      ? 'on all orders'
      : `on orders over €${Number.isInteger(threshold) ? threshold : threshold.toFixed(2)}`,
    shop_name: shopName,
    cta_label: settings.cta_label,
    items: candidate.items.map(i => ({
      name: i.name,
      quantity: i.quantity,
      line_total: euro(i.line_total),
      image_url: i.image_url,
    })),
  };
};

/**
 * Send one reminder and record it.
 *
 * `trigger` is 'automatic' (the sweep) or 'manual' (the admin pressed Send now).
 * A manual send deliberately ignores the cadence guards — timing is the admin's
 * call at that point — but NOT the opt-out, which is the one thing no button in
 * a dashboard may override.
 *
 * The row is written whatever the outcome, `delivered` included, so a failed
 * send is visible in the admin's history instead of looking like it never
 * happened, and so a crashed sweep cannot re-send what it already sent.
 */
export const sendAbandonedCartReminder = async (pool, { candidate, settings, frontendUrl, trigger = 'automatic' }) => {
  const { rows: optOut } = await pool.query(
    `SELECT opted_out_at FROM cart_reminder_optouts WHERE email = $1`, [candidate.email]
  );
  if (optOut[0]?.opted_out_at) return { sent: false, reason: 'opted_out' };

  const token = await optOutTokenFor(pool, candidate.email);
  const ctx = await buildContext(pool, { candidate, settings, frontendUrl });

  let delivered = false;
  let error = null;
  try {
    ({ delivered } = await sendAbandonedCartEmail(candidate.email, {
      subject: settings.subject,
      preheader: settings.preheader,
      body: settings.body,
      ctx,
      unsubscribeUrl: `${String(frontendUrl).replace(/\/+$/, '')}/unsubscribe?token=${encodeURIComponent(token)}`,
    }));
  } catch (err) {
    error = err?.message || String(err);
  }

  await pool.query(
    `INSERT INTO abandoned_cart_sends
       (user_id, email, cart_fingerprint, reminder_number, trigger_source, items, cart_total, delivered)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      candidate.user_id, candidate.email, candidate.cart_fingerprint,
      candidate.reminders_sent + 1, trigger,
      JSON.stringify(candidate.items), candidate.cart_total, delivered,
    ]
  );

  return { sent: delivered, error, reason: delivered ? null : (error ? 'send_failed' : 'not_configured') };
};

/**
 * The sweep. Sends to everyone the settings say is due, and to nobody else.
 *
 * Returns counts rather than throwing on a single bad address: one shopper whose
 * mailbox bounces must not stop the other nine.
 */
export const sweepAbandonedCarts = async (pool, { frontendUrl, now = new Date() } = {}) => {
  const settings = await getAbandonedCartSettings(pool);
  if (!settings.enabled) return { skipped: 'disabled', sent: 0, failed: 0 };

  const candidates = await findAbandonedCarts(pool, settings, { now });
  const due = candidates.filter(c => c.due);
  let sent = 0;
  let failed = 0;
  for (const candidate of due) {
    try {
      const result = await sendAbandonedCartReminder(pool, { candidate, settings, frontendUrl, trigger: 'automatic' });
      if (result.sent) sent++; else failed++;
    } catch (err) {
      failed++;
      console.error('[abandoned cart send]', candidate.email, err?.message || err);
    }
  }
  return { sent, failed, considered: candidates.length, due: due.length };
};

/**
 * Credit an order to the reminder that brought it back, if one did.
 *
 * Server-side and by shopper, not by a token in the URL: the link may be opened
 * on a phone and the purchase finished on a laptop, and a click-id scheme would
 * lose exactly the recoveries the shop most wants to count. Called from
 * finalizeCheckoutSession, and never allowed to fail an order.
 */
export const markCartRecovered = async (pool, { userId, orderId, total }) => {
  await pool.query(
    `UPDATE abandoned_cart_sends
        SET recovered_at = NOW(), recovered_order_id = $2, recovered_total = $3
      WHERE id = (
        SELECT id FROM abandoned_cart_sends
         WHERE user_id = $1 AND recovered_at IS NULL AND delivered = TRUE
           AND sent_at > NOW() - ($4 || ' days')::interval
         ORDER BY sent_at DESC LIMIT 1
      )`,
    [userId, orderId, total, String(RECOVERY_ATTRIBUTION_DAYS)]
  );
};

/** Headline numbers for the admin panel: sent, recovered, and what it earned. */
export const abandonedCartStats = async (pool) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS sent_total,
            COUNT(*) FILTER (WHERE sent_at > NOW() - INTERVAL '30 days')::int AS sent_30d,
            COUNT(*) FILTER (WHERE recovered_at IS NOT NULL)::int AS recovered_total,
            COUNT(*) FILTER (WHERE recovered_at > NOW() - INTERVAL '30 days')::int AS recovered_30d,
            COALESCE(SUM(recovered_total), 0)::float AS recovered_revenue,
            COALESCE(SUM(recovered_total) FILTER (WHERE recovered_at > NOW() - INTERVAL '30 days'), 0)::float AS recovered_revenue_30d
       FROM abandoned_cart_sends`
  );
  return rows[0];
};

/** The last 20 sends, for the history table under the composer. */
export const abandonedCartHistory = async (pool, limit = 20) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.email, s.reminder_number, s.trigger_source, s.cart_total, s.delivered,
            s.sent_at, s.recovered_at, s.recovered_total, s.items,
            o.tracking_number AS recovered_order_number
       FROM abandoned_cart_sends s
       LEFT JOIN orders o ON o.id = s.recovered_order_id
      ORDER BY s.sent_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
};
