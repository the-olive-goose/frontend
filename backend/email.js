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
