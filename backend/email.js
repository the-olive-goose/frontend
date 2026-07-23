// ── Email sender ────────────────────────────────────────────────────────────────
// Sends transactional email via Resend when RESEND_API_KEY is configured.
// Until then it runs in "dev mode": the message is logged and `delivered:false`
// is returned so callers can surface the code in the API response for testing —
// mirroring the existing phone-OTP dev fallback.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.FROM_EMAIL || 'The Olive Goose <onboarding@resend.dev>';

/**
 * Send an email.
 * @returns {Promise<{ delivered: boolean }>} delivered=false means dev mode (not actually sent).
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    console.log(`[email:dev] to=${to} subject="${subject}" (RESEND_API_KEY not set — not sent)`);
    return { delivered: false };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, text }),
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
