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
  const subject = `${code} is your Olive Goose password reset code`;
  const text =
    `Use this code to reset your The Olive Goose password: ${code}.\n` +
    `It expires in 10 minutes. If you didn't request this, you can ignore this email — your password won't change.`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1e2918">
    <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7a5e;margin:0 0 4px">The Olive Goose</p>
    <h1 style="font-size:20px;margin:0 0 16px;color:#1e2918">Reset your password</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Use the code below to reset your password:</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:0.3em;text-align:center;background:#f1f5ee;border:1px solid #dbe4d4;border-radius:10px;padding:18px 0;margin:0 0 20px">${code}</div>
    <p style="font-size:13px;line-height:1.5;color:#6b7a5e;margin:0">This code expires in 10 minutes. If you didn't request it, your password won't change — you can safely ignore this email.</p>
  </div>`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Send a 6-digit verification code.
 * @returns {Promise<{ delivered: boolean }>}
 */
export async function sendOtpEmail(to, code) {
  const subject = `${code} is your Olive Goose verification code`;
  const text =
    `Your The Olive Goose verification code is ${code}.\n` +
    `It expires in 10 minutes. If you didn't request this, you can ignore this email.`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1e2918">
    <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7a5e;margin:0 0 4px">The Olive Goose</p>
    <h1 style="font-size:20px;margin:0 0 16px;color:#1e2918">Verify your email</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Use the code below to finish creating your account:</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:0.3em;text-align:center;background:#f1f5ee;border:1px solid #dbe4d4;border-radius:10px;padding:18px 0;margin:0 0 20px">${code}</div>
    <p style="font-size:13px;line-height:1.5;color:#6b7a5e;margin:0">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
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
  const subject = `Order confirmed — #${trackingNumber}`;
  const text = `Thanks for your order! Order #${trackingNumber}, total €${total}. Track it at ${orderUrl}`;
  const html = wrap('Order confirmed', `
    <p style="font-size:15px;line-height:1.5;margin:0 0 12px">Thanks for shopping with us — we've got your order and are getting it ready.</p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#3d4a37">Order <strong>#${trackingNumber}</strong> · Total <strong>€${total}</strong></p>
    ${button(orderUrl, 'Track your order')}
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendOrderStatusUpdateEmail(to, { trackingNumber, status, orderUrl }) {
  const subject = `Order #${trackingNumber} update: ${status}`;
  const text = `Your order #${trackingNumber} is now: ${status}. Track it at ${orderUrl}`;
  const html = wrap('Your order has moved', `
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px">Order <strong>#${trackingNumber}</strong> is now: <strong>${status}</strong></p>
    ${button(orderUrl, 'View tracking')}
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendCancellationRequestedEmail(to, { trackingNumber }) {
  const subject = `We received your cancellation request — #${trackingNumber}`;
  const text = `We received your request to cancel order #${trackingNumber}. We'll email you once it's reviewed.`;
  const html = wrap('Cancellation request received', `
    <p style="font-size:15px;line-height:1.5;margin:0">We received your request to cancel order <strong>#${trackingNumber}</strong>. Our team will review it shortly and email you with the outcome.</p>
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
  const subject = approved ? `Order #${trackingNumber} cancelled` : `Update on your cancellation request — #${trackingNumber}`;
  const text = approved
    ? `Order #${trackingNumber} has been cancelled. If you paid, a refund will follow.${note ? ` Note: ${note}` : ''}`
    : `We're unable to cancel order #${trackingNumber}.${note ? ` ${note}` : ''}`;
  const html = wrap(approved ? 'Your order was cancelled' : 'Cancellation request declined', `
    <p style="font-size:15px;line-height:1.5;margin:0 0 8px">${approved
      ? `Order <strong>#${trackingNumber}</strong> has been cancelled. If it was already paid for, we'll process your refund and confirm once it's done.`
      : `We're unable to cancel order <strong>#${trackingNumber}</strong> — it's already on its way.`}</p>
    ${note ? `<p style="font-size:14px;line-height:1.5;color:#3d4a37;margin:0">${escapeHtml(note)}</p>` : ''}
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendReturnRequestedEmail(to, { productName, trackingNumber }) {
  const subject = `We received your return request`;
  const text = `We received your return request for ${productName} (order #${trackingNumber}). We'll email you once it's reviewed.`;
  const html = wrap('Return request received', `
    <p style="font-size:15px;line-height:1.5;margin:0">We received your request to return <strong>${escapeHtml(productName)}</strong> from order <strong>#${trackingNumber}</strong>. We'll email you once it's reviewed.</p>
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendReturnDecisionEmail(to, { productName, status }) {
  const LABEL = { approved: 'approved', rejected: 'declined', refunded: 'refunded' };
  const label = LABEL[status] || status;
  const subject = `Your return has been ${label} — ${productName}`;
  const text = `Your return request for ${productName} has been ${label}.`;
  const html = wrap(`Return ${label}`, `
    <p style="font-size:15px;line-height:1.5;margin:0">Your return request for <strong>${escapeHtml(productName)}</strong> has been <strong>${label}</strong>.</p>
    ${status === 'approved' ? `<p style="font-size:14px;line-height:1.5;color:#3d4a37;margin-top:8px">Your refund will be processed and we'll confirm once it's done.</p>` : ''}
  `);
  return sendEmail({ to, subject, html, text });
}

export async function sendRefundCompletedEmail(to, { trackingNumber }) {
  const subject = `Refund processed — order #${trackingNumber}`;
  const text = `Your refund for order #${trackingNumber} has been processed.`;
  const html = wrap('Refund processed', `
    <p style="font-size:15px;line-height:1.5;margin:0">Your refund for order <strong>#${trackingNumber}</strong> has been processed. It may take a few days to appear on your statement.</p>
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
  const subject = `${productName} is back in stock!`;
  const text = `Good news — ${productName} is back in stock at The Olive Goose. Come take a look before it sells out again.`;
  const html = wrap('Back in stock!', `
    <p style="font-size:15px;line-height:1.5;margin:0">Good news — <strong>${escapeHtml(productName)}</strong> is back in stock. Come take a look before it sells out again.</p>
  `);
  return sendEmail({ to, subject, html, text });
}
