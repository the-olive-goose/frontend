// ── Email sender ────────────────────────────────────────────────────────────────
// Sends transactional email via Resend when RESEND_API_KEY is configured.
// Until then it runs in "dev mode": the message is logged and `delivered:false`
// is returned so callers can surface the code in the API response for testing —
// mirroring the existing phone-OTP dev fallback.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.FROM_EMAIL || 'The Olive Goose <onboarding@resend.dev>';
// Overridable for the same reason META_GRAPH_ORIGIN is (backend/index.js): the
// only way to check what an email ACTUALLY looks like on the wire — its headers,
// its HTML, the address it goes to — is to point the sender at a local sink and
// read the request. Never set in production, where the default is the only value
// that can send anything.
const RESEND_ORIGIN  = String(process.env.RESEND_ORIGIN || 'https://api.resend.com').replace(/\/+$/, '');

/**
 * Whether this server can actually deliver mail, as opposed to logging it.
 *
 * Transactional callers do not need to ask — a welcome code that only reaches a
 * log is a bad day, not a disaster, and `delivered:false` already tells them.
 * The newsletter does need to ask, because it reports a headline number back to
 * whoever pressed Send: without this check a missing key produces "Sent to 214
 * subscribers" with nothing sent at all, and a recorded send that stops it ever
 * being retried.
 */
export const isEmailConfigured = () => !!RESEND_API_KEY;

/**
 * Send an email.
 *
 * `headers` carries per-message SMTP headers — used only by the newsletter,
 * which must send List-Unsubscribe. Gmail and Yahoo require a one-click
 * unsubscribe header from bulk senders and will start filtering a domain that
 * omits it, so this is deliverability, not decoration.
 *
 * @returns {Promise<{ delivered: boolean }>} delivered=false means dev mode (not actually sent).
 */
export async function sendEmail({ to, subject, html, text, headers }) {
  if (!RESEND_API_KEY) {
    console.log(`[email:dev] to=${to} subject="${subject}" (RESEND_API_KEY not set — not sent)`);
    return { delivered: false };
  }

  const res = await fetch(`${RESEND_ORIGIN}/emails`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL, to, subject, html, text,
      ...(headers && Object.keys(headers).length ? { headers } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
  return { delivered: true };
}

/**
 * Send a 6-digit password reset code.
 * @returns {Promise<{ delivered: boolean }>}
 */
export async function sendPasswordResetEmail(to, code) {
  const subject = `${code} — let's get you back in`;
  const text =
    `Locked out? Happens to the best of us. Here's your code to reset your Olive Goose password: ${code}.\n` +
    `It's good for 10 minutes. Didn't ask for this? No stress — ignore this email and nothing changes.`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1e2918">
    <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7a5e;margin:0 0 4px">The Olive Goose</p>
    <h1 style="font-size:20px;margin:0 0 16px;color:#1e2918">Let's get you back in</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Happens to the best of us. Pop in the code below to set a new password:</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:0.3em;text-align:center;background:#f1f5ee;border:1px solid #dbe4d4;border-radius:10px;padding:18px 0;margin:0 0 20px">${code}</div>
    <p style="font-size:13px;line-height:1.5;color:#6b7a5e;margin:0">Good for 10 minutes. Didn't ask for this? No stress — ignore this email and your password stays exactly as it is.</p>
  </div>`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Send an admin password-reset link (single-use, short-lived token in the URL).
 * @returns {Promise<{ delivered: boolean }>}
 */
export async function sendAdminPasswordResetEmail(to, resetUrl) {
  const subject = `Reset your Olive Goose admin password`;
  const text =
    `Someone requested a password reset for the Olive Goose admin account.\n` +
    `Reset it here: ${resetUrl}\n` +
    `This link expires in 15 minutes and can only be used once. If you didn't request this, ignore this email — your password won't change.`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1e2918">
    <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7a5e;margin:0 0 4px">The Olive Goose · Admin</p>
    <h1 style="font-size:20px;margin:0 0 16px;color:#1e2918">Reset your admin password</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Click below to choose a new admin password. This link expires in 15 minutes and can only be used once.</p>
    <a href="${resetUrl}" style="display:inline-block;margin-bottom:20px;padding:12px 22px;background:#1e2918;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none">Reset password</a>
    <p style="font-size:13px;line-height:1.5;color:#6b7a5e;margin:0">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  </div>`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Send a 6-digit verification code.
 * @returns {Promise<{ delivered: boolean }>}
 */
export async function sendOtpEmail(to, code) {
  const subject = `${code} — you're almost in`;
  const text =
    `Almost there! Drop this code in to finish setting up your Olive Goose account: ${code}.\n` +
    `It's good for 10 minutes. Didn't sign up? You can ignore this one.`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1e2918">
    <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7a5e;margin:0 0 4px">The Olive Goose</p>
    <h1 style="font-size:20px;margin:0 0 16px;color:#1e2918">You're almost in</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 20px">One quick step and you're set. Drop the code below in to finish setting up your account:</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:0.3em;text-align:center;background:#f1f5ee;border:1px solid #dbe4d4;border-radius:10px;padding:18px 0;margin:0 0 20px">${code}</div>
    <p style="font-size:13px;line-height:1.5;color:#6b7a5e;margin:0">Good for 10 minutes. Didn't sign up? No worries — you can ignore this email.</p>
  </div>`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Send a subscriber their single-use welcome discount code.
 * @returns {Promise<{ delivered: boolean }>}
 */
export async function sendDiscountCodeEmail(to, { code, discountPercent, shopUrl }) {
  const subject = `Welcome — here's ${discountPercent}% off, just because 🫒`;
  const text =
    `Hey, welcome to the Olive Goose fam. Here's ${discountPercent}% off your first order, on us — use code ${code} at checkout.\n` +
    `It's yours and yours only (single-use), so keep it somewhere safe. Come see what caught your eye: ${shopUrl}`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1e2918">
    <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7a5e;margin:0 0 4px">The Olive Goose</p>
    <h1 style="font-size:22px;margin:0 0 12px;color:#1e2918">Welcome to the fam 🫒</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 18px">Thanks for hopping on the list. Here's <strong>${discountPercent}% off your first order</strong> to get you started — no catch, just a little hello from us.</p>
    <div style="font-size:26px;font-weight:700;letter-spacing:0.14em;text-align:center;background:#f1f5ee;border:1px dashed #1e2918;border-radius:10px;padding:18px 0;margin:0 0 18px;color:#1e2918">${code}</div>
    <a href="${shopUrl}" style="display:inline-block;margin-bottom:18px;padding:12px 22px;background:#1e2918;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none">See what's new</a>
    <p style="font-size:13px;line-height:1.5;color:#6b7a5e;margin:0">Heads up — this code is single-use and just for you, so it works on one order. One welcome treat per person.</p>
  </div>`;

  return sendEmail({ to, subject, html, text });
}

// ── Order lifecycle emails ─────────────────────────────────────────────────────
// Every field below that can originate from a customer or admin free-text field
// (return/cancellation reasons, admin notes, message subject/body) must be
// escaped before going into an HTML template — none of it is trusted markup.
const escapeHtml = (str) => String(str ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// Shared wrapper matches the OTP emails' look so all transactional mail from
// Olive & Goose feels consistent, regardless of which flow triggered it.
const wrap = (heading, bodyHtml) => `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1e2918">
    <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7a5e;margin:0 0 4px">The Olive Goose</p>
    <h1 style="font-size:20px;margin:0 0 16px;color:#1e2918">${heading}</h1>
    ${bodyHtml}
  </div>`;

const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;margin-top:8px;padding:12px 22px;background:#1e2918;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none">${label}</a>`;

export async function sendOrderConfirmationEmail(to, { trackingNumber, total, orderUrl }) {
  const subject = `It's official — order #${trackingNumber} is in 🎉`;
  const text = `Yesss, thank you! We've got order #${trackingNumber} (total €${total}) and we're already packing it up. Track it here: ${orderUrl}`;
  const html = wrap('You did a good thing', `
    <p style="font-size:15px;line-height:1.5;margin:0 0 12px">Thanks for shopping with us — order's in and we're already boxing it up with care.</p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#3d4a37">Order <strong>#${trackingNumber}</strong> · Total <strong>€${total}</strong></p>
    ${button(orderUrl, 'Track your order')}
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendOrderStatusUpdateEmail(to, { trackingNumber, status, orderUrl }) {
  const subject = `Update on #${trackingNumber} — it's now ${status}`;
  const text = `Quick update: your order #${trackingNumber} is now ${status}. Keep an eye on it here: ${orderUrl}`;
  const html = wrap('Your order just moved', `
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px">Little update — order <strong>#${trackingNumber}</strong> is now <strong>${status}</strong>. One step closer to your door.</p>
    ${button(orderUrl, 'View tracking')}
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendCancellationRequestedEmail(to, { trackingNumber }) {
  const subject = `Got it — we're on your cancellation for #${trackingNumber}`;
  const text = `We got your request to cancel order #${trackingNumber}. A real human's going to take a look and we'll email you the moment there's an update.`;
  const html = wrap('Got it — leave it with us', `
    <p style="font-size:15px;line-height:1.5;margin:0">We've got your request to cancel order <strong>#${trackingNumber}</strong>. A real person on our team is going to look it over, and we'll email you the second there's news. Nothing else you need to do for now.</p>
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendCancellationRequestAdminAlert(to, { trackingNumber, userEmail, reason }) {
  const subject = `Action needed: cancellation request on #${trackingNumber}`;
  const text = `${userEmail} requested to cancel order #${trackingNumber}. Reason: ${reason || '(none given)'}`;
  const html = wrap('Cancellation request needs review', `
    <p style="font-size:15px;line-height:1.5;margin:0 0 8px"><strong>${escapeHtml(userEmail)}</strong> requested to cancel order <strong>#${trackingNumber}</strong>.</p>
    <p style="font-size:14px;line-height:1.5;color:#3d4a37;margin:0">Reason: ${escapeHtml(reason) || '(none given)'}</p>
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendCancellationDecisionEmail(to, { trackingNumber, decision, note }) {
  const approved = decision === 'approved';
  const subject = approved ? `Done — order #${trackingNumber} is cancelled` : `About your cancellation for #${trackingNumber}`;
  const text = approved
    ? `All sorted — order #${trackingNumber} is cancelled. If you already paid, your refund is on its way.${note ? ` Note: ${note}` : ''}`
    : `So sorry — we couldn't cancel order #${trackingNumber} this time.${note ? ` ${note}` : ''}`;
  const html = wrap(approved ? 'All sorted — you\'re cancelled' : 'About your cancellation', `
    <p style="font-size:15px;line-height:1.5;margin:0 0 8px">${approved
      ? `Done — order <strong>#${trackingNumber}</strong> is cancelled. If you already paid, we'll get your refund moving and let you know once it's through.`
      : `Ah — we couldn't cancel order <strong>#${trackingNumber}</strong> this time, it's already on its way to you. If it's not quite right when it lands, just reply and we'll sort it out together.`}</p>
    ${note ? `<p style="font-size:14px;line-height:1.5;color:#3d4a37;margin:0">${escapeHtml(note)}</p>` : ''}
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendReturnRequestedEmail(to, { productName, trackingNumber }) {
  const subject = `Got your return request — we're on it`;
  const text = `We've got your request to return ${productName} (order #${trackingNumber}). No worries, it happens — we'll take a look and email you with the next step.`;
  const html = wrap('Got it — we\'re on it', `
    <p style="font-size:15px;line-height:1.5;margin:0">We've got your request to return <strong>${escapeHtml(productName)}</strong> from order <strong>#${trackingNumber}</strong>. No worries at all — sometimes things just aren't the one. We'll take a look and email you with what's next.</p>
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendReturnDecisionEmail(to, { productName, status }) {
  const LABEL = { approved: 'approved', rejected: 'declined', refunded: 'refunded' };
  const label = LABEL[status] || status;
  const subject = `Your return for ${productName} — ${label}`;
  const text = `Update on your return for ${productName}: it's been ${label}.`;
  const html = wrap(`Return ${label}`, `
    <p style="font-size:15px;line-height:1.5;margin:0">Here's the update on your return for <strong>${escapeHtml(productName)}</strong> — it's been <strong>${label}</strong>.</p>
    ${status === 'approved' ? `<p style="font-size:14px;line-height:1.5;color:#3d4a37;margin-top:8px">Your refund's on the way, and we'll give you a shout the moment it's done.</p>` : ''}
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendRefundCompletedEmail(to, { trackingNumber }) {
  const subject = `Money's on its way back — order #${trackingNumber}`;
  const text = `Good news — your refund for order #${trackingNumber} is done and heading back to you. Give it a few days to land on your statement.`;
  const html = wrap('Money\'s on its way back', `
    <p style="font-size:15px;line-height:1.5;margin:0">All done — your refund for order <strong>#${trackingNumber}</strong> is through and heading back your way. Banks being banks, it can take a few days to show up on your statement. Hope to see you again soon 🫒</p>
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendCustomerMessageEmail(to, { subject, body, trackingNumber }) {
  const text = `${body}\n\n(Regarding order #${trackingNumber})`;
  const html = wrap(escapeHtml(subject), `
    <p style="font-size:15px;line-height:1.6;margin:0 0 12px;white-space:pre-wrap">${escapeHtml(body)}</p>
    <p style="font-size:13px;color:#6b7a5e;margin:0">Regarding order #${trackingNumber}</p>
  `);
  return sendEmail({ to, subject, html, text });
}

/**
 * Admin-facing reminder that a manual refund is still owed. Fired by the
 * refund-reminder sweep in scheduler.js on the configured day offsets
 * (default day 1 / 5 / 7) until the admin marks the refund done.
 */
export async function sendRefundReminderEmail(to, { day, source, orderTrackingNumber, total, daysElapsed }) {
  const what = source === 'return' ? 'return' : 'cancelled order';
  const subject = `Reminder (day ${day}): refund still owed on ${what} #${orderTrackingNumber}`;
  const text = `A refund on ${what} #${orderTrackingNumber} (€${total}) is still pending, ${daysElapsed} day(s) since it was approved. Please process it in Stripe/your bank and mark it done in the admin dashboard.`;
  const html = wrap('Refund reminder', `
    <p style="font-size:15px;line-height:1.5;margin:0 0 8px">A refund on ${what} <strong>#${orderTrackingNumber}</strong> (€${total}) is still pending — ${daysElapsed} day(s) since it was approved.</p>
    <p style="font-size:14px;line-height:1.5;color:#3d4a37;margin:0">Please process it manually and mark it as refunded in the admin dashboard so this reminder stops.</p>
  `);
  return sendEmail({ to, subject, html, text });
}

/**
 * Broadcast to a subscriber when a product an admin marked back in stock is
 * available again. Sent one-by-one (best effort) after an admin approves a
 * back_in_stock_notify decision — never automatic, always a human click first.
 */
export async function sendBackInStockEmail(to, { productName }) {
  const subject = `${productName} is back 👀`;
  const text = `You asked, we listened — ${productName} is back in stock at Olive Goose. It went fast last time, so maybe don't sleep on it.`;
  const html = wrap('It\'s back 👀', `
    <p style="font-size:15px;line-height:1.5;margin:0">You asked, we listened — <strong>${escapeHtml(productName)}</strong> is back in stock. It flew out the door last time, so maybe don't sleep on it.</p>
  `);
  return sendEmail({ to, subject, html, text });
}

// ── Newsletter broadcast ───────────────────────────────────────────────────────
// The one email on this site sent to a LIST rather than to a person who just did
// something. That difference is the whole design:
//
//   - it is marketing, not transactional, so it must carry a working unsubscribe
//     link and a List-Unsubscribe header. Both are legal requirements under GDPR
//     and ePrivacy, and Gmail/Yahoo enforce the header on bulk senders — a
//     domain that skips it gets quietly filtered, which looks like "nobody opens
//     our emails" rather than like a bug;
//   - the body is written by an admin in a plain textarea, so it is ESCAPED and
//     then paragraphed. Interpolating it raw would let a stray `<` mangle every
//     copy of the email, and would make the compose box an HTML-injection
//     surface into other people's inboxes.

// ── The newsletter's markup ───────────────────────────────────────────────────
// The SAME tiny grammar the storefront already uses for admin-editable copy
// (src/lib/richtext.tsx), plus one addition the storefront has no need for:
//
//   **bold**            →  <strong>
//   *italic*            →  <em>
//   __underline__       →  <u>
//   newline             →  <br>
//   blank line          →  new paragraph
//   ![alt](https://…)   →  an image, on a line of its own
//
// Reusing the storefront's syntax rather than inventing a second one is the
// whole point: an admin who has typed **bold** into a product description
// already knows how to write this email, and the B/I/U toolbar in the dashboard
// emits exactly these markers.
//
// STILL NOT AN HTML PIPELINE. The body is PARSED into a block/span tree and the
// text is escaped when it is emitted, so there is no path from the compose box
// to arbitrary markup in a subscriber's mailbox — a typed `<script>` arrives as
// visible text, the way it should.
//
// This grammar exists twice, here and in src/lib/newsletterMarkup.ts, because
// the backend deploys on its own and cannot import the app's TypeScript. The two
// are pinned together by src/lib/newsletterMarkupParity.test.ts — the same
// arrangement the address rules use, and for the same reason: a preview that
// quietly disagrees with the email is worse than no preview.

/** Only an https image URL is an image. See parseNewsletterBody. */
const NEWSLETTER_IMAGE_RE = /^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/;

/** Alternation order matters: ** and __ must win over their single-char forms. */
const NEWSLETTER_INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|\*([^*\n]+?)\*/s;

const parseSpans = (text, marks) => {
  const out = [];
  const push = (value) => {
    if (value !== '') out.push({ text: value, ...marks });
  };
  let rest = text;
  while (rest) {
    const m = NEWSLETTER_INLINE_RE.exec(rest);
    if (!m) { push(rest); break; }
    if (m.index > 0) push(rest.slice(0, m.index));
    if (m[1] !== undefined) out.push(...parseSpans(m[1], { ...marks, bold: true }));
    else if (m[2] !== undefined) out.push(...parseSpans(m[2], { ...marks, underline: true }));
    else out.push(...parseSpans(m[3], { ...marks, italic: true }));
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
};

/**
 * Admin-typed body → a block tree.
 *
 * Exported because the parity test compares this against the storefront's copy
 * of the same grammar. Every span carries all three marks as explicit booleans
 * so the two trees can be compared with a plain deep-equal.
 *
 * An image line whose URL is not https is NOT an image — it stays as literal
 * text. That is deliberate: an email lives in an inbox forever, a relative or
 * http URL cannot load there, and showing the admin their own broken markup in
 * the preview beats shipping a silent hole to every subscriber.
 */
export const parseNewsletterBody = (body) => {
  const blocks = [];
  for (const raw of String(body ?? '').split(/\n{2,}/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const image = NEWSLETTER_IMAGE_RE.exec(trimmed);
    if (image) {
      blocks.push({ type: 'image', url: image[2], alt: image[1].trim() });
      continue;
    }
    const spans = parseSpans(trimmed, { bold: false, italic: false, underline: false });
    if (spans.length) blocks.push({ type: 'paragraph', spans });
  }
  return blocks;
};

/** One span → escaped, wrapped in whichever of strong/em/u it carries. */
const spanHtml = (span) => {
  let html = escapeHtml(span.text).replace(/\n/g, '<br>');
  // Innermost first, so the nesting reads the way it was written.
  if (span.italic) html = `<em>${html}</em>`;
  if (span.underline) html = `<u>${html}</u>`;
  if (span.bold) html = `<strong>${html}</strong>`;
  return html;
};

// Email clients are not browsers: no stylesheets, no flexbox, and Outlook will
// happily render an image at its intrinsic width unless told otherwise. Hence
// inline styles on every element, an explicit width attribute on images, and
// display:block to kill the descender gap under them.
export const newsletterBodyHtml = (body) =>
  parseNewsletterBody(body)
    .map(block => block.type === 'image'
      ? `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt)}" width="472" ` +
        `style="display:block;width:100%;max-width:472px;height:auto;border-radius:10px;margin:0 0 16px">`
      : `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">${block.spans.map(spanHtml).join('')}</p>`)
    .join('');

/** Plain-text alternative — the same content with the markers taken out. */
const newsletterBodyText = (body) =>
  parseNewsletterBody(body)
    .map(block => block.type === 'image'
      ? (block.alt ? `[image: ${block.alt}]` : '[image]')
      : block.spans.map(s => s.text).join(''))
    .join('\n\n');

/**
 * Send one broadcast to one subscriber.
 *
 * `unsubscribeUrl` is per-recipient and required — there is no call path that
 * sends this without one, because an unsubscribe link that is missing or shared
 * between recipients is the failure this whole feature has to avoid.
 */
export async function sendNewsletterEmail(to, { subject, body, unsubscribeUrl }) {
  if (!unsubscribeUrl) throw new Error('sendNewsletterEmail requires an unsubscribeUrl');

  // The plain-text alternative carries the same words without the markers, so a
  // client that refuses HTML shows prose rather than a screenful of asterisks.
  const text =
    `${newsletterBodyText(body)}\n\n` +
    `Don't want these? Unsubscribe: ${unsubscribeUrl}`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1e2918">
    <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7a5e;margin:0 0 16px">The Olive Goose</p>
    ${newsletterBodyHtml(body)}
    <hr style="border:none;border-top:1px solid #e0d8ce;margin:28px 0 14px">
    <p style="font-size:12px;line-height:1.5;color:#6b7a5e;margin:0">
      You're getting this because you signed up at theolivegoose.ie.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7a5e">Unsubscribe</a> any time — no hard feelings.
    </p>
  </div>`;

  return sendEmail({
    to, subject, html, text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      // Tells the mail client the link can be POSTed to without a confirmation
      // page, which is what makes Gmail show its own one-click Unsubscribe.
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

// ── Abandoned-cart reminder ────────────────────────────────────────────────────
// One stored template, one email per shopper, and the difference between them is
// entirely in the tokens — the admin writes the words once in Ops → Abandoned
// Carts and the basket rows are filled in at send time from the LIVE catalogue.
//
// The grammar is the newsletter's (parseNewsletterBody above), so the same B/I/U
// toolbar and the same image lines work here, plus tokens. Two rules matter and
// both are pinned by src/lib/abandonedCartParity.test.ts against the TypeScript
// copy the admin's preview renders:
//
//   1. Tokens are substituted AFTER parsing. A candle called "Café **Noir**"
//      arrives as those literal characters instead of turning the rest of the
//      email bold — the same reasoning that makes the newsletter escape its body.
//   2. The basket and the button are appended when the body omits them. An
//      abandoned-cart email that shows no basket is worse than no email, and the
//      way that happens is an admin editing copy and deleting a token.
//
// @see src/lib/abandonedCart.ts — the copy the live preview is built from.

const ABANDONED_CART_ITEMS_TOKEN = '{cart_items}';
const ABANDONED_CART_BUTTON_TOKEN = '{cart_button}';

/** One run of text, with the inline tokens filled in. Unknown tokens are kept. */
export const applyAbandonedCartTokens = (text, ctx) =>
  String(text ?? '').replace(
    /\{(first_name|cart_url|cart_total|item_count|discount_code|discount_value|free_shipping|shop_name)\}/g,
    (whole, key) => {
      switch (key) {
        case 'first_name':     return ctx.first_name;
        case 'cart_url':       return ctx.cart_url;
        case 'cart_total':     return ctx.cart_total;
        case 'item_count':     return String(ctx.item_count);
        case 'discount_code':  return ctx.discount_code;
        case 'discount_value': return ctx.discount_value;
        case 'free_shipping':  return ctx.free_shipping;
        case 'shop_name':      return ctx.shop_name;
        default:               return whole;
      }
    },
  );

const abandonedCartBlockText = (block) =>
  block.type === 'paragraph' ? block.spans.map(s => s.text).join('').trim() : '';

/** Admin body + one shopper's context → the blocks their email is built from. */
export const parseAbandonedCartBody = (body, ctx) => {
  const out = [];
  let hasItems = false;
  let hasButton = false;

  for (const block of parseNewsletterBody(body)) {
    const text = abandonedCartBlockText(block);
    if (text === ABANDONED_CART_ITEMS_TOKEN)  { out.push({ type: 'items' });  hasItems = true;  continue; }
    if (text === ABANDONED_CART_BUTTON_TOKEN) { out.push({ type: 'button' }); hasButton = true; continue; }
    if (block.type === 'image') { out.push(block); continue; }
    const spans = block.spans
      .map(s => ({ ...s, text: applyAbandonedCartTokens(s.text, ctx) }))
      .filter(s => s.text !== '');
    if (spans.length) out.push({ type: 'paragraph', spans });
  }

  if (!hasItems)  out.push({ type: 'items' });
  if (!hasButton) out.push({ type: 'button' });
  return out;
};

/** The plain-text alternative — same content, markers and markup taken out. */
export const abandonedCartBodyText = (body, ctx) =>
  parseAbandonedCartBody(body, ctx)
    .map(block => {
      if (block.type === 'items')
        return ctx.items
          .map(i => `• ${i.name} × ${i.quantity} — ${i.line_total}`)
          .concat(`Subtotal: ${ctx.cart_total}`)
          .join('\n');
      if (block.type === 'button') return `${ctx.cta_label}: ${ctx.cart_url}`;
      if (block.type === 'image')  return block.alt ? `[image: ${block.alt}]` : '[image]';
      return block.spans.map(s => s.text).join('');
    })
    .join('\n\n');

// Tables, not flexbox: Outlook renders this and Outlook has no CSS layout. The
// thumbnail is a fixed-width cell with an explicit width attribute for the same
// reason the newsletter's images carry one.
const cartItemsHtml = (ctx) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="width:100%;border-collapse:collapse;margin:0 0 16px">
    ${ctx.items.map(item => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #ece6dd;width:64px;vertical-align:top">
        ${item.image_url
          ? `<img src="${escapeHtml(item.image_url)}" alt="" width="56"
                  style="display:block;width:56px;height:56px;object-fit:cover;border-radius:8px">`
          : ''}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #ece6dd;vertical-align:top">
        <p style="font-size:15px;line-height:1.4;margin:0;color:#1e2918">${escapeHtml(item.name)}</p>
        <p style="font-size:13px;line-height:1.4;margin:2px 0 0;color:#6b7a5e">Qty ${escapeHtml(String(item.quantity))}</p>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #ece6dd;text-align:right;vertical-align:top;white-space:nowrap">
        <p style="font-size:15px;line-height:1.4;margin:0;color:#1e2918">${escapeHtml(item.line_total)}</p>
      </td>
    </tr>`).join('')}
    <tr>
      <td colspan="2" style="padding:12px 0 0"><p style="font-size:14px;margin:0;color:#6b7a5e">Subtotal</p></td>
      <td style="padding:12px 0 0;text-align:right;white-space:nowrap">
        <p style="font-size:16px;font-weight:600;margin:0;color:#1e2918">${escapeHtml(ctx.cart_total)}</p>
      </td>
    </tr>
  </table>`;

const abandonedCartBodyHtml = (body, ctx) =>
  parseAbandonedCartBody(body, ctx)
    .map(block => {
      if (block.type === 'items')  return cartItemsHtml(ctx);
      if (block.type === 'button') return `<p style="margin:0 0 20px">${button(escapeHtml(ctx.cart_url), escapeHtml(ctx.cta_label))}</p>`;
      if (block.type === 'image')
        return `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt)}" width="472" ` +
               `style="display:block;width:100%;max-width:472px;height:auto;border-radius:10px;margin:0 0 16px">`;
      return `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">${block.spans.map(spanHtml).join('')}</p>`;
    })
    .join('');

/**
 * Send one shopper their basket back.
 *
 * `unsubscribeUrl` is required and per-recipient, on the same terms as the
 * newsletter's. This email is marketing under GDPR/ePrivacy even though it is
 * triggered by something the person did, so it carries a working opt-out and the
 * List-Unsubscribe headers Gmail and Yahoo expect — a sender that skips them
 * doesn't get an error, it gets quietly filtered.
 *
 * The preheader is the grey line beside the subject in most inboxes. Left
 * unset, mail clients fill it with the first words of the email, which here
 * would be "Hi there," — a wasted line in the only place a shopper decides
 * whether to open.
 */
export async function sendAbandonedCartEmail(to, { subject, preheader, body, ctx, unsubscribeUrl }) {
  if (!unsubscribeUrl) throw new Error('sendAbandonedCartEmail requires an unsubscribeUrl');

  // The subject and the preheader take the SAME tokens the body does, and for the
  // same reason: they are the two lines a shopper reads before deciding whether
  // to open anything, so "Still thinking it over, {first_name}?" arriving with
  // the braces intact is the most visible possible way for this feature to look
  // broken. (This shipped unresolved once; e2e/abandoned-cart.spec.ts is what
  // caught it, and now pins it.)
  const renderedSubject = applyAbandonedCartTokens(subject, ctx);
  const renderedPreheader = applyAbandonedCartTokens(preheader ?? '', ctx);

  const text =
    `${abandonedCartBodyText(body, ctx)}\n\n` +
    `Don't want basket reminders? Opt out: ${unsubscribeUrl}`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1e2918">
    ${renderedPreheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(renderedPreheader)}</div>` : ''}
    <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7a5e;margin:0 0 16px">${escapeHtml(ctx.shop_name)}</p>
    ${abandonedCartBodyHtml(body, ctx)}
    <hr style="border:none;border-top:1px solid #e0d8ce;margin:28px 0 14px">
    <p style="font-size:12px;line-height:1.5;color:#6b7a5e;margin:0">
      You're getting this because you left something in your basket at theolivegoose.ie.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7a5e">Stop basket reminders</a> any time.
    </p>
  </div>`;

  return sendEmail({
    to, subject: renderedSubject, html, text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}
