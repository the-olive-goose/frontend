import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import crypto from 'crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { sendOtpEmail, sendPasswordResetEmail, sendOrderConfirmationEmail, sendOrderStatusUpdateEmail,
  sendCancellationRequestedEmail, sendCancellationRequestAdminAlert, sendCancellationDecisionEmail,
  sendReturnRequestedEmail, sendReturnDecisionEmail, sendRefundCompletedEmail, sendCustomerMessageEmail,
  sendBackInStockEmail, sendAdminPasswordResetEmail, sendDiscountCodeEmail } from './email.js';
import { startRefundReminderScheduler } from './scheduler.js';
import {
  validateAddress, normalizeAddress, toE164, phoneError as validatePhone,
  nameError as validateName, tidy, ACCOUNT_NAME_COPY,
} from './addressRules.js';
// The Meta Conversions API's matching rules — pure, exacting, and silently
// destructive when wrong, so they live on their own where the unit suite can
// reach them. See backend/metaCapi.js.
import { metaPixelId, metaBrowserId, metaTestCode, metaUserData, hashExternalId } from './metaCapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Railway terminates TLS at a proxy — trust it so rate limiting sees real client IPs.
app.set('trust proxy', 1);

const IS_PROD = process.env.NODE_ENV === 'production';

// ── Security headers ───────────────────────────────────────────────────────────
// Applied to every response (API + the SPA this server also serves). Scripts are
// 'self' plus two hosts and nothing else — the Vite bundle has no inline
// scripts, the shop's own analytics is first-party, and those two hosts are
// there solely to serve gtag.js for the optional GA4 tag and fbevents.js for the
// optional Meta Pixel (both under Admin → Analytics). Inline styles (React style
// props) and Google Fonts stay allowed so the site keeps rendering.
//
// Must match the policy the CDN serves for the same SPA (public/_headers and
// vercel.json); src/lib/csp.test.ts holds all three to each other.
app.disable('x-powered-by');

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.googletagmanager.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https:",
  // Same explicit host list as public/_headers: this server also serves the SPA
  // (the Railway origin, and any deploy where the CDN isn't in front), so without
  // frame-src the studio rail's YouTube/Vimeo/Instagram embeds fall back to
  // default-src 'self' and are blocked — the exact regression _headers already
  // fixed on the Netlify half.
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.instagram.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Block legacy Adobe cross-domain policy files and DNS prefetch leaks — cheap,
  // no legitimate traffic depends on either.
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  next();
});

// ── Video upload (multer) ──────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

// Uploaded files are served back from /uploads on this origin, so both the
// extension and the stored name are security-sensitive: the extension is
// allowlisted (never taken from the client verbatim — an uploaded .html/.svg
// would execute script when viewed) and the name is regenerated with random
// bytes so a request can't influence the path at all.
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

const makeUploadStorage = (prefix) => multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const makeUploadFilter = (mimePrefix, allowedExts, label) => (_req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (file.mimetype.startsWith(mimePrefix) && allowedExts.has(ext)) return cb(null, true);
  // /api/upload/image hands multer's error straight to the global handler, which
  // defaults to 500 — so a rejected .svg read as "the uploader is broken" rather
  // than "that file type isn't allowed". The refusal is the caller's fault, and
  // the status has to say so or admin shows the wrong message.
  const err = new Error(`Only ${label} files are allowed (${[...allowedExts].join(', ')})`);
  err.status = 400;
  cb(err);
};

const upload = multer({
  storage: makeUploadStorage('video'),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
  fileFilter: makeUploadFilter('video/', VIDEO_EXTS, 'video'),
});

const uploadImage = multer({
  storage: makeUploadStorage('image'),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: makeUploadFilter('image/', IMAGE_EXTS, 'image'),
});

// Review photos arrive from anonymous visitors, so they get a much smaller cap
// than the admin uploader (which is trusted and used for hero/product art).
const uploadFeedbackPhoto = multer({
  storage: makeUploadStorage('review'),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: makeUploadFilter('image/', IMAGE_EXTS, 'image'),
});

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

// An `Origin` header is always scheme://host[:port] — no trailing slash, no path,
// and the scheme/host are lowercase. A FRONTEND_URL copied out of a browser bar
// ("https://shop.example.com/") therefore never matches, and the whole storefront
// gets 403s on launch with nothing in the logs but "Origin not allowed". Normalise
// to an origin before comparing, and accept a comma-separated list so an apex +
// www pair (or a staging domain) can be configured without a code change.
const toOrigin = (value) => {
  try {
    return new URL(String(value).trim()).origin;
  } catch {
    return null; // not a usable URL — drop it rather than allowing a bad entry
  }
};

const allowedOrigins = [
  ...String(process.env.FRONTEND_URL || '').split(',').map(toOrigin),
  // Local development origins are deliberately excluded from production. A
  // production API must only accept the explicitly configured storefronts.
  ...(!IS_PROD ? [
    'http://localhost:5173',
    'http://localhost:5199',
    'http://localhost:8080',
    'http://localhost:3000',
  ] : []),
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(toOrigin(origin) ?? origin)) return cb(null, true);
    // Do not throw from CORS: a malicious Origin header is routine internet
    // traffic, not an application error worth emitting a stack trace for. The
    // CSRF middleware below still returns 403 for state-changing requests.
    cb(null, false);
  },
  credentials: true, // required so the browser sends/accepts the session cookie cross-port in dev
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Stripe ────────────────────────────────────────────────────────────────────
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Only called when the admin has opted into `refund_automation_enabled` — off
// by default, since this moves real money. Throws on failure so callers never
// mark a refund "done" when Stripe didn't actually process it.
const refundViaStripe = async (paymentIntentId, amountCents, idempotencyKey) => {
  if (!stripe) throw new Error('Stripe is not configured');
  if (!paymentIntentId) throw new Error('This order has no Stripe payment to refund');
  return stripe.refunds.create(
    { payment_intent: paymentIntentId, amount: Math.round(amountCents) },
    // Retrying the same admin action (or two requests racing) must resolve to
    // one Stripe refund rather than risking two money movements.
    idempotencyKey ? { idempotencyKey } : undefined,
  );
};

// Registered before express.json() — Stripe's webhook signature check needs the
// raw, unparsed request body, not the JSON-parsed object the rest of the API uses.
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(500).send('Stripe webhook not configured');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await finalizeCheckoutSession(session.id);
    }
    res.json({ received: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// Explicit body cap — a giant JSON body is rejected before parsing rather than
// relying on the implicit default.
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// ── CSRF defence: verify the Origin/Referer on state-changing requests ──────────
// The customer session cookie is SameSite=None in production (the storefront and
// this API are different registrable sites, so a Lax cookie wouldn't be sent on
// checkout's cross-site fetch). SameSite=None means the browser WILL attach the
// cookie to a cross-site request — and CORS only blocks the attacker from reading
// the *response*, not from triggering the handler's side effect. So a plain
// cross-site <form> POST (a "simple" request that skips preflight) could otherwise
// forge cookie-authed actions like cancelling an order or logging the user out.
//
// This is the OWASP-recommended defence ("Verifying Origin With Standard Headers"):
// for any mutating method, if the browser sent an Origin/Referer it MUST be one we
// allow. A real browser always attaches Origin on a cross-site request and a page
// on evil.com cannot suppress or spoof it, so a forged request is rejected here.
// Requests with no Origin/Referer at all (server-to-server, curl, native mobile)
// are not browser-driven and therefore not a CSRF vector, so they're allowed
// through to the existing auth checks — this adds a layer without breaking clients.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const originAllowed = (value) => {
  if (!value) return null; // header absent
  try { return allowedOrigins.includes(new URL(value).origin); }
  catch { return false; } // present but unparseable → treat as disallowed
};
app.use('/api', (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  // Stripe posts webhooks server-to-server with a signed body (verified in the
  // route itself) and never sends a browser Origin — exempt it explicitly.
  if (req.path.startsWith('/webhooks/')) return next();

  const originOk = originAllowed(req.headers.origin);
  if (originOk === false) return res.status(403).json({ error: 'Cross-site request blocked.' });
  if (originOk === null) {
    // No Origin — fall back to Referer when present; only reject if it's a
    // real, disallowed browser Referer. Absent entirely → non-browser caller.
    const refererOk = originAllowed(req.headers.referer);
    if (refererOk === false) return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  next();
});

// Every admin and customer session token is signed with this secret — a
// hardcoded fallback would let anyone forge a valid admin/customer token if
// JWT_SECRET is ever left unset on a real deploy. Fail closed in production
// instead of silently booting with a guessable secret; keep the dev fallback
// for local convenience only.
if (IS_PROD && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production.');
  process.exit(1);
}
const JWT_SECRET   = process.env.JWT_SECRET   || 'changeme-use-a-real-secret-in-production';
// FRONTEND_URL may list several allowed origins (see the CORS allowlist above);
// links we *build* — OAuth callbacks, Stripe return URLs, order and reset emails —
// must use exactly one, so take the first entry as the canonical site address.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:8080')
  .split(',')[0].trim().replace(/\/+$/, '');
// Public base for URLs the *browser* is sent to as part of an auth flow — the
// Google/Facebook OAuth redirect_uri, and uploaded-media links. It must be the
// address the shopper's browser already has open, NOT the platform hostname the
// container happens to answer on: the OAuth callback sets the session cookie, and
// a cookie set on a different registrable domain than the storefront is a
// third-party cookie that Safari drops and Chrome drops in incognito. With the
// storefront on Netlify proxying /api/* through to this service (public/_redirects),
// the right value is the site itself — https://theolivegoose.ie — which also keeps
// the redirect_uri registered in Google Cloud Console stable if the API ever moves.
const BACKEND_URL  = process.env.BACKEND_URL   || 'http://localhost:3001';

// ── Boot-time config sanity check ──────────────────────────────────────────────
// These misconfigurations break sign-in in a way that reads as an app bug rather
// than a config bug: login returns 200 with the user, the UI flips to signed-in,
// the Set-Cookie is silently discarded by the browser, and the next request 401s.
// Nothing in the logs says why. Say it out loud at boot instead.
//
// Last-two-labels rather than a real Public Suffix List lookup — enough to catch
// the case that matters (a shop on one domain, the API on the platform's own), and
// it never fires falsely on a same-site pair. Under a multi-label suffix like
// .co.uk it just under-warns, which is the right way for a heuristic to fail.
const registrableDomain = (url) => {
  try { return new URL(url).hostname.split('.').slice(-2).join('.'); }
  catch { return null; }
};

const warnOnMisconfiguration = () => {
  const warn = (msg) => console.warn(`[config] ${msg}`);
  const frontIsPublic = /^https:/.test(FRONTEND_URL);

  if (frontIsPublic && !IS_PROD)
    warn(`NODE_ENV is "${process.env.NODE_ENV ?? 'unset'}" but FRONTEND_URL is public (${FRONTEND_URL}). ` +
         `HSTS is off, error responses leak stack traces, and signup OTPs are returned in the API response when email delivery fails. Set NODE_ENV=production.`);

  if (frontIsPublic && /localhost/.test(BACKEND_URL))
    warn(`BACKEND_URL is still ${BACKEND_URL} on a public deploy — Google/Facebook will reject the OAuth callback with redirect_uri_mismatch ("Access blocked"). Set BACKEND_URL to ${FRONTEND_URL}.`);
  else if (frontIsPublic && registrableDomain(BACKEND_URL) !== registrableDomain(FRONTEND_URL))
    warn(`BACKEND_URL (${BACKEND_URL}) is a different site than FRONTEND_URL (${FRONTEND_URL}). ` +
         `The OAuth callback would set the session cookie on ${registrableDomain(BACKEND_URL)}, where the storefront can't use it — social sign-in will appear to succeed and then log the user straight back out. Set BACKEND_URL to ${FRONTEND_URL}.`);
};

// These services are core to the customer journey, rather than optional
// enhancements: without them a production checkout can be paid without an
// order ever being created, and email signup/reset can appear to succeed while
// no customer receives a code. Refuse to boot in that state instead of exposing
// a deceptively working but incomplete shop.
const assertProductionConfiguration = () => {
  if (!IS_PROD) return;

  const frontendOrigin = toOrigin(FRONTEND_URL);
  const backendOrigin = toOrigin(BACKEND_URL);
  const problems = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (!process.env.JWT_SECRET) problems.push('JWT_SECRET is required');
  if (!frontendOrigin || !frontendOrigin.startsWith('https://'))
    problems.push('FRONTEND_URL must be an HTTPS storefront URL');
  if (!backendOrigin || !backendOrigin.startsWith('https://'))
    problems.push('BACKEND_URL must be an HTTPS public API/proxy URL');
  if (!process.env.STRIPE_SECRET_KEY) problems.push('STRIPE_SECRET_KEY is required for payments');
  if (!process.env.STRIPE_WEBHOOK_SECRET) problems.push('STRIPE_WEBHOOK_SECRET is required to finalize payments');
  if (!process.env.RESEND_API_KEY) problems.push('RESEND_API_KEY is required for email verification and resets');

  if (problems.length) throw new Error(`Production configuration invalid: ${problems.join('; ')}`);
};

const BCRYPT_ROUNDS = 12;

// ── Session cookie (customer-facing auth) ──────────────────────────────────────
// httpOnly so it's invisible to page JS (no XSS token theft).
//
// SameSite=Lax, not None. This used to be None because the storefront
// (theolivegoose.ie) and this API (…up.railway.app) were different registrable
// sites, which made the session cookie cross-site on every fetch() from the shop
// — and a Lax cookie is not attached to cross-site XHR. That is no longer how
// production is wired: Netlify serves the SPA and proxies /api/* through to this
// backend (public/_redirects), the bundle hardcodes a same-origin API base
// (src/lib/apiBase.ts pins API_URL to "" in any production build), and the OAuth
// redirect_uri comes back to theolivegoose.ie/api/... too. Every request that
// carries this cookie is therefore same-site already.
//
// Keeping None once same-origin is a live CSRF weakening rather than a no-op: a
// None cookie is attached to cross-site requests by the browser, which leaves the
// Origin/Referer check the *only* thing standing between evil.com and a
// cookie-authed POST. Lax means the browser never sends it on cross-site XHR in
// the first place, so that check becomes the second layer instead of the only
// one. og_oauth_state has run Lax on this exact origin in production all along.
//
// Dev stays Lax as well (identical behaviour over http://localhost, where the
// browser would refuse a None cookie anyway for lacking Secure).
//
// Escape hatch: set SESSION_COOKIE_SAMESITE=none to restore the old behaviour
// without a code change if a future deploy ever puts the API back on its own
// origin — the storefront would otherwise look permanently signed out there.
const SESSION_COOKIE = 'og_session';

// ── Session lifetimes ─────────────────────────────────────────────────────────
// Two clocks, as every serious storefront runs them:
//
//   idle    — how long a session survives with no activity. Slides forward while
//             the shopper is browsing (see touchSession), so an active basket is
//             never dropped mid-checkout.
//   absolute— a hard ceiling from sign-in that activity CANNOT extend. Without it
//             a single sign-in on a shared or stolen device is valid forever,
//             because a sliding window renews itself indefinitely.
//
// "Remember me" only changes the idle window (and whether the cookie survives a
// browser restart) — it never lifts the absolute cap.
const SESSION_IDLE_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_IDLE_SHORT_MS    = 12 * 60 * 60 * 1000;      // 12 hours ("remember me" off)
const SESSION_ABSOLUTE_MS      = 180 * 24 * 60 * 60 * 1000; // 180 days, re-auth after

// last_seen_at/idle_expires_at are only written when the row is this stale, so a
// shopper clicking through the site doesn't cause a DB write per request. The
// cost is that the effective idle window is up to this much shorter than the
// nominal one — immaterial against a 12h/30d window.
const SESSION_TOUCH_MS = 5 * 60 * 1000;

// Re-issue the cookie once less than this share of the idle window is left. The
// old code sent Set-Cookie on EVERY authenticated response; renewing lazily keeps
// the sliding behaviour without an unnecessary header on every API call.
const SESSION_RENEW_AT = 0.5;

const sessionIdleMs = (remember) => (remember ? SESSION_IDLE_REMEMBER_MS : SESSION_IDLE_SHORT_MS);

// Decide Secure from the actual connection, not just NODE_ENV: Railway terminates
// TLS at its proxy, and with `trust proxy` set req.secure reflects
// x-forwarded-proto. If NODE_ENV is ever left unset on a real HTTPS deploy, a
// NODE_ENV-only check would emit a non-Secure cookie on an https response.
// SameSite is Lax on every deploy (see the note above SESSION_COOKIE) unless
// SESSION_COOKIE_SAMESITE explicitly asks for none, which the browser only
// honours together with Secure.
const SESSION_SAMESITE =
  String(process.env.SESSION_COOKIE_SAMESITE || '').toLowerCase() === 'none' ? 'none' : 'lax';
const sessionCookieOptions = (res, maxAge) => {
  const secure = IS_PROD || Boolean(res.req?.secure);
  return {
    httpOnly: true,
    secure,
    // 'none' requires Secure; fall back to lax on a plain-http dev connection.
    sameSite: SESSION_SAMESITE === 'none' && secure ? 'none' : 'lax',
    path: '/',
    ...(maxAge ? { maxAge } : {}), // omit maxAge → browser-session cookie ("remember me" off)
  };
};

// ── Server-side session records ───────────────────────────────────────────────
// The cookie carries a signed JWT, but the JWT is only half the credential: it
// names a row in user_sessions that has to still be there, unrevoked and unexpired.
// That is what a bare JWT can't give a shop:
//   • sign out actually ends the session — clearing a cookie does nothing to a
//     copy of it that was already lifted off the device;
//   • changing your password can boot every other device, immediately;
//   • the customer can see where they're signed in and cut a device off.
// One indexed primary-key lookup per authenticated request buys all of it.

// A phone/tablet/desktop label from the User-Agent — enough for a shopper to
// recognise their own device in the list, and deliberately no more (no
// fingerprinting, no third-party UA database).
const describeDevice = (ua = '') => {
  const s = String(ua);
  if (!s.trim()) return 'Unknown device';
  const browser =
    /\bEdgA?\//.test(s)                        ? 'Edge'
    : /\bOPR\/|\bOpera/.test(s)                ? 'Opera'
    : /\bFirefox\/|\bFxiOS\//.test(s)          ? 'Firefox'
    : /\bSamsungBrowser\//.test(s)             ? 'Samsung Internet'
    : /\bCriOS\//.test(s)                      ? 'Chrome'
    // Chrome's UA also says "Safari", so Safari is what's left after Chrome.
    : /\bChrome\/|\bChromium\//.test(s)        ? 'Chrome'
    : /\bSafari\//.test(s)                     ? 'Safari'
    : 'Browser';
  const os =
    /\biPhone\b/.test(s)                       ? 'iPhone'
    : /\biPad\b/.test(s)                       ? 'iPad'
    : /\bAndroid\b/.test(s)                    ? 'Android'
    : /\bWindows NT\b/.test(s)                 ? 'Windows'
    : /\bMac OS X\b|\bMacintosh\b/.test(s)     ? 'Mac'
    : /\bCrOS\b/.test(s)                       ? 'ChromeOS'
    : /\bLinux\b/.test(s)                      ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
};

// Behind Railway's proxy `trust proxy` makes req.ip the real client address.
// Stored only so the shopper can spot a session they don't recognise; truncated
// to keep an IPv6 address from bloating the row.
const clipText = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const requestIp = (req) => clipText(req.ip || req.socket?.remoteAddress || '', 45);
const requestUserAgent = (req) => clipText(req.get('user-agent') || '', 300);

// The JWT never outlives the session row's own limits, so a leaked token stops
// verifying on its own even if the DB is never consulted again.
const signSessionToken = (payload, ttlMs) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: Math.max(60, Math.floor(ttlMs / 1000)) });

// Writes the cookie for an existing session row. maxAge is omitted when
// "remember me" is off, making it a browser-session cookie that dies with the tab.
const writeSessionCookie = (res, session, payload) => {
  const idleMs = sessionIdleMs(session.remember);
  // Never hand out a token that outlives the absolute cap.
  const ttlMs = Math.min(idleMs, new Date(session.absolute_expires_at).getTime() - Date.now());
  if (ttlMs <= 0) return false;
  const token = signSessionToken(
    { userId: session.user_id, email: payload.email, phone: payload.phone, sid: session.id, remember: session.remember },
    ttlMs
  );
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(res, session.remember ? idleMs : undefined));
  return true;
};

// Start a brand-new session. Always a new row (never a reused id), so signing in
// rotates the session identifier and a fixation attempt can't survive the login.
const createUserSession = async (req, res, user, { remember = true } = {}) => {
  const idleMs = sessionIdleMs(remember);
  const { rows } = await pool.query(
    `INSERT INTO user_sessions (user_id, remember, user_agent, ip, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' milliseconds')::interval, NOW() + ($6 || ' milliseconds')::interval)
     RETURNING *`,
    [user.id ?? user.userId, !!remember, requestUserAgent(req), requestIp(req), String(idleMs), String(SESSION_ABSOLUTE_MS)]
  );
  const session = rows[0];
  writeSessionCookie(res, session, { email: user.email, phone: user.phone });
  return session;
};

const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(res));
};

const revokeSession = (sessionId, reason) =>
  pool.query(
    `UPDATE user_sessions SET revoked_at = NOW(), revoked_reason = $2
     WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason]
  );

// Used by "sign out everywhere" and, more importantly, by password change/reset:
// a shopper who suspects someone else is in their account changes the password,
// and that has to end the intruder's session on the spot.
const revokeUserSessions = (userId, { exceptId = null, reason } = {}) =>
  pool.query(
    `UPDATE user_sessions SET revoked_at = NOW(), revoked_reason = $3
     WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, exceptId, reason]
  );

// Rows are kept a little past death so a support question ("when did that
// device last sign in?") is still answerable, then dropped.
const pruneUserSessions = async () => {
  try {
    await pool.query(
      `DELETE FROM user_sessions
       WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days')
          OR absolute_expires_at < NOW() - INTERVAL '30 days'`
    );
  } catch (err) {
    console.error('[session prune]', err);
  }
};

// ── OAuth state (CSRF protection for the Google/Facebook flows) ───────────────
// A random nonce is set as a short-lived cookie when the flow starts and must
// round-trip through the provider's `state` param — a forged callback link
// (login CSRF: silently signing the victim into an attacker's account) fails
// the comparison because the attacker can't set the victim's cookie.
// Stays SameSite=Lax (not None): the callback arrives as a top-level GET navigation
// from Google, which Lax allows, so it never needs the cross-site relaxation the
// session cookie does. Secure is derived from the live connection rather than
// NODE_ENV for the same reason as the session cookie above — a deploy that forgets
// NODE_ENV=production would otherwise hand out a plaintext-transmissible nonce.
const OAUTH_STATE_COOKIE = 'og_oauth_state';
const oauthStateCookieOptions = (res) => ({
  httpOnly: true,
  secure: IS_PROD || Boolean(res.req?.secure),
  sameSite: 'lax',
  path: '/',
  maxAge: 10 * 60 * 1000,
});

const issueOauthState = (res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions(res));
  return state;
};

const consumeOauthState = (req, res) => {
  const expected = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, { ...oauthStateCookieOptions(res), maxAge: undefined });
  const got = req.query.state;
  if (!expected || typeof got !== 'string' || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
};

// ── Rate limiters ───────────────────────────────────────────────────────────────
// General limiter for auth endpoints; a tighter one for code-sending endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 20/15min in production. Overridable via env so an automated e2e run (which
  // logs in many times from one IP) isn't throttled mid-suite — never lowered
  // for real traffic, only raised on a trusted test host.
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});
// Overridable like the auth/API limiters so a full e2e run — which signs up
// several throwaway accounts — doesn't starve later suites of their codes.
// Left at 5/15min everywhere else.
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.OTP_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many codes requested. Please wait a few minutes and try again.' },
});
// Safety-net limiter over the whole API — generous enough that real shoppers
// never hit it, but it blunts scripted scraping/brute-force floods from a
// single IP. Registered here (after the Stripe webhook route above) so
// Stripe's own retries are never rate-limited.
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  // 400/5min in production — a real shopper never approaches it. Overridable via
  // env so an automated e2e run (hundreds of content fetches from one IP) isn't
  // throttled; only ever raised on a trusted test host, never lowered for prod.
  max: Number(process.env.API_RATE_LIMIT_MAX) || 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
});
app.use('/api', apiLimiter);
// Creating a Checkout Session also creates Stripe-side state (and, where a
// discount applies, a one-time coupon). The broad API limit is intentionally
// generous for browsing, so use a tight per-account cap here to prevent a
// compromised customer account from being used to exhaust Stripe resources.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.CHECKOUT_RATE_LIMIT_MAX) || 12,
  keyGenerator: (req) => `account:${String(req.user?.userId || 'unknown')}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checkout attempts. Please wait a few minutes and try again.' },
});
// Unauthenticated write endpoints (newsletter signup, feedback) get a much
// tighter budget — nothing legitimate submits these dozens of times.
const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Overridable (like the API/auth limiters) so the e2e suite — which subscribes
  // and submits feedback many times from one IP — can raise it; 10 in production.
  max: Number(process.env.PUBLIC_WRITE_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});
// Feedback gets its own budget rather than sharing the newsletter's: a shopper
// who just subscribed should still be able to leave a review, and a review flood
// should not silently eat the signup allowance. Deliberately tighter than the
// shared public-write budget — nobody legitimately writes five reviews an hour.
const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.FEEDBACK_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reviews submitted. Please try again in a little while.' },
});
// Photo uploads are the most expensive public write (disk + bandwidth), so they
// get the tightest budget of all — one review carries at most one photo.
const feedbackPhotoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.FEEDBACK_PHOTO_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many photo uploads. Please try again in a little while.' },
});
// Trying discount codes is a guessing game: welcome codes are 8 random characters
// and effectively unguessable, but an admin can mint a short memorable one
// ("SPRING20"), and the global 400/5min budget is plenty of room to enumerate
// those. A real shopper types one or two codes, so this stays well clear of them.
const discountValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Overridable like the other limiters so an e2e run (dozens of validate calls
  // from one IP) isn't throttled; only ever raised on a trusted test host.
  max: Number(process.env.DISCOUNT_VALIDATE_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many discount codes tried. Please wait a few minutes and try again.' },
});
// Analytics ingestion gets its own budget: the tracker batches client-side and
// flushes at most every few seconds, so even a long, very active session stays
// far below this — while a scripted flood from one IP is still capped.
// Ingestion's budget, PER VISITOR — and the "per visitor" is the whole point.
//
// Keyed on req.ip, it was not per visitor at all. In production this app sits
// behind two proxies (Netlify, then Railway) with `trust proxy` set to 1, so
// req.ip is Netlify's egress address — THE SAME VALUE FOR EVERY SHOPPER ON THE
// SITE. The budget was therefore a single shared bucket: ~150 requests per five
// minutes for the entire shop, after which every visitor's events were dropped.
//
// Nothing surfaced it. The storefront swallows ingestion errors on purpose
// (analytics must never interrupt shopping), so a 429 is silent, and what the
// dashboard showed was not an outage but something far worse — plausible
// numbers. Sessions truncated mid-journey, add-to-carts and checkouts missing
// while server-written purchases still landed, so the funnel collapsed and
// abandonment climbed. And it got worse exactly when it mattered: a launch, a
// post that did well, a demo. Quiet days measured fine.
//
// So the key is the address the EDGE vouched for — the same header the geo and
// own-network logic already trust, set by netlify/edge-functions/analytics-geo.ts
// on this exact route and stripped there if a client tries to supply its own. It
// is never stored; it is a bucket name and is discarded with the request.
//
// Falls back to req.ip when the edge didn't speak (local development, a request
// that bypassed Netlify). That is the shared bucket again, which is why the
// budget below is generous: a single browser flushing every five seconds for the
// whole window sends about sixty requests, so 600 leaves an order of magnitude
// of headroom while still blunting a scripted flood.
const analyticsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  keyGenerator: (req) => {
    const edge = String(req.headers['x-og-client-ip'] || '').trim().toLowerCase();
    // Bounded and shape-checked: this becomes a key in an in-memory store, so a
    // caller must not be able to make it arbitrarily long or numerous.
    return edge && edge.length <= 45 && /^[0-9a-f:.]+$/.test(edge) ? `edge:${edge}` : `ip:${req.ip}`;
  },
  // Overridable like every other limiter here: the e2e suites drive hundreds of
  // page loads from one IP in a few minutes, and each one beacons.
  max: Number(process.env.ANALYTICS_RATE_LIMIT_MAX) || 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many events.' },
});

// ── Validation helpers ──────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Canonical form of an address, for "one per real person" rules like the welcome
// discount. Sub-addressing (`me+deals@…`) is delivered to `me@…` by essentially
// every provider, and Google additionally ignores dots — so me@gmail.com,
// m.e@gmail.com and me+1@gmail.com are ONE mailbox. Without this, a shopper can
// subscribe as me+1, me+2, me+3…, verify each signup from the same inbox, and mint
// an unlimited supply of "first order" discounts. Only ever used for abuse checks;
// mail is still sent to, and accounts still keyed on, the address as typed.
const GOOGLE_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const canonicalEmail = (raw) => {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (GOOGLE_MAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return local ? `${local}@${domain}` : email;
};

// The canonical address behind a signed-in account, read from the users row (a JWT
// minted before an email change would otherwise carry a stale address). Only a
// *verified* address counts: a phone-signup account can type any email into its
// profile, and treating that as proof would let anyone claim a code issued to
// someone else simply by naming their address. Returns null when the account has
// nothing it can prove.
const canonicalEmailForUser = async (userId) => {
  if (!userId) return null;
  const { rows } = await pool.query(
    'SELECT email, email_verified FROM users WHERE id = $1', [userId]
  );
  if (!rows[0]?.email_verified) return null;
  return canonicalEmail(rows[0].email) || null;
};

// Returns an error string if invalid, or null if the password is acceptable.
const validatePassword = (pw) => {
  if (typeof pw !== 'string' || pw.length < 8)
    return 'Password must be at least 8 characters long.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw))
    return 'Password must include at least one letter and one number.';
  return null;
};

const sixDigitCode = () => crypto.randomInt(100000, 1_000_000).toString();

// ── Order tracking ───────────────────────────────────────────────────────────
// Status is set explicitly by an admin (see PUT /api/admin/orders/:id) and
// persisted on the order row — it never advances on its own. Pickup orders
// skip the shipping legs entirely (no courier involved).
const DELIVERY_STAGES = ['Order Placed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered'];
const PICKUP_STAGES = ['Order Placed', 'Preparing Order', 'Ready for Pickup', 'Picked Up'];

const stagesFor = (order) => order.fulfillment_type === 'pickup' ? PICKUP_STAGES : DELIVERY_STAGES;

const withTracking = (order) => {
  const stages = stagesFor(order);
  if (order.status === 'Cancelled') {
    return { ...order, tracking: { stages, stage_index: -1, delivered: false, cancelled: true }, cancellation_eligible: false };
  }
  const status = stages.includes(order.status) ? order.status : stages[0];
  const stageIndex = stages.indexOf(status);
  return {
    ...order,
    status,
    tracking: {
      stages,
      stage_index: stageIndex,
      delivered: stageIndex === stages.length - 1,
      cancelled: false,
    },
    cancellation_eligible: isCancellable(order),
  };
};

// A customer can request cancellation while the order is still in its first two
// pipeline stages (not yet shipped / not yet ready for pickup) and no
// cancellation decision has already been made on it.
const isCancellable = (order) => {
  if (order.status === 'Cancelled') return false;
  if (order.cancellation_status && order.cancellation_status !== 'none') return false;
  const idx = stagesFor(order).indexOf(order.status);
  return idx >= 0 && idx <= 1;
};

const addOrderEvent = async (orderId, { type, actor = 'system', title, detail = '', meta = {}, customerVisible = true }) => {
  await pool.query(
    `INSERT INTO order_events (order_id, type, actor, title, detail, meta, customer_visible)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [orderId, type, actor, title, detail, JSON.stringify(meta), customerVisible]
  );
};

// Best-effort — decrements stock for products that opted into tracking (a numeric
// `stock` field on the item in content_products). Products with no stock field
// are left untouched, so this is fully optional per-product.
// Uses SELECT ... FOR UPDATE inside a transaction to serialize concurrent
// decrements against the same row — without this, two checkouts completing
// at the same instant for the last unit(s) of a product can both read the
// same pre-decrement stock and both succeed, overselling it.
// Returns `{ shortfalls }` — one entry per tracked product whose ordered quantity
// exceeded the stock still on hand at decrement time. Stock is validated at
// checkout-session creation, but that gate is advisory: a concurrent order can
// take the last unit(s) during the (potentially minutes-long) window the shopper
// spends on Stripe's hosted page. Payment has already succeeded by the time we
// get here, so we never reject — we floor stock at 0 and report the shortfall so
// the caller can surface it for deliberate fulfillment (restock / partial refund)
// instead of overselling silently.
const decrementStock = async (items) => {
  const client = await pool.connect();
  const shortfalls = [];
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT value FROM site_settings WHERE key = 'content_products' FOR UPDATE`
    );
    const content = rows[0]?.value;
    if (!content?.items?.length) { await client.query('ROLLBACK'); return { shortfalls }; }
    let changed = false;
    const updatedItems = content.items.map((p) => {
      const line = items.find(i => i.product_id === p.id);
      if (!line || p.stock === undefined || p.stock === null) return p;
      changed = true;
      const available = Number(p.stock);
      if (line.quantity > available) {
        shortfalls.push({ product_id: p.id, name: p.name, requested: line.quantity, available: Math.max(0, available) });
      }
      return { ...p, stock: Math.max(0, available - line.quantity) };
    });
    if (changed) {
      await client.query(
        `UPDATE site_settings SET value = $1, updated_at = NOW() WHERE key = 'content_products'`,
        [JSON.stringify({ ...content, items: updatedItems })]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[decrementStock]', err);
  } finally {
    client.release();
  }
  return { shortfalls };
};

const genTrackingNumber = () =>
  `OG${Date.now().toString(36).toUpperCase()}${crypto.randomInt(1000, 10_000)}`;

// Free-text fields (reasons, notes, admin message subject/body) come straight
// from request bodies — coerce to a bounded string so a non-string value can't
// crash a route (e.g. `{}.trim()`) and a giant string can't bloat storage/email.
const safeText = (v, max = 2000) => typeof v === 'string' ? v.trim().slice(0, max) : '';

// Public free text is rendered back in the admin panel and (once promoted) on
// the storefront. React escapes markup for us, but zero-width and bidi control
// characters survive escaping and are the standard trick for hiding text or
// flipping how a name reads — strip them, keeping newlines and tabs.
const stripControlChars = (s) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');

const FEEDBACK_MAX_LEN = 2000;

// A stored photo URL is later loaded by the admin's browser, so accepting any
// https:// link would let a submitter beacon the admin's IP/user-agent (or point
// at something they can swap out later). Only paths this server itself issued.
const isOwnUploadPath = (url) => /^\/uploads\/[A-Za-z0-9._-]+$/.test(url);

// Truncated HMAC — enough to compare two submissions from the same source,
// not enough to be a useful record of who visited.
const hashIp = (ip) =>
  crypto.createHmac('sha256', JWT_SECRET).update(String(ip ?? '')).digest('hex').slice(0, 32);

// Unexpected 5xx errors must never echo raw driver/library messages to the
// client in production (SQL constraint names, file paths, Stripe internals are
// all reconnaissance material). Errors thrown intentionally with a .status
// keep their message — those are written to be user-facing.
const sendServerError = (res, err) => {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  // 22P02 is Postgres refusing to read a value as the column's type — reached by
  // putting anything that isn't a UUID in an `:id` route (/api/orders/not-a-uuid,
  // a truncated link out of an email, a scanner). Every id here is server-issued,
  // so a value the type system rejects cannot match a row: this is "not found",
  // not "the server broke". Handled once, centrally, because the alternative is
  // a guard on every one of the ~20 `:id` routes and remembering it on the next.
  // Still logged: 22P02 can also mean a query of ours built a badly-typed value,
  // and answering 404 without a line in the log would hide that completely.
  if (err?.code === '22P02') {
    console.warn('[22P02] treated as not-found:', err.message);
    return res.status(404).json({ error: 'Not found' });
  }
  console.error(err);
  res.status(500).json({ error: IS_PROD ? 'Something went wrong. Please try again.' : err.message });
};

// ── Shared helpers (dedupe price parsing / bundle logic used by checkout + ops) ─
const parsePrice = (price) => {
  const n = parseFloat(String(price ?? '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
};

const bundleIsSatisfied = (bundle, items) =>
  !!bundle.is_active && !!bundle.product_ids?.length &&
  bundle.product_ids.every(pid => items.some(i => i.product_id === pid));

// Authoritative Today's Deals bundle savings. Bundles can share candles, so a
// basket may satisfy several at once — every product UNIT counts toward at most
// one bundle to avoid stacking the discount on the same candle. Greedily apply
// the highest-value bundle instance we can still form from the unclaimed units,
// consume them, and repeat. Mirrors src/lib/bundleSavings.ts exactly (including
// the deterministic bundle ordering) so the saving shown in the basket/checkout
// matches what's actually charged — keep the two in sync.
const computeBundleSavings = (bundles, items, validProductIds) => {
  const remaining = new Map();
  const price = new Map();
  for (const i of items) {
    remaining.set(i.product_id, (remaining.get(i.product_id) || 0) + i.quantity);
    price.set(i.product_id, parsePrice(i.product_data?.price));
  }

  // Drop bundle product_ids that no longer exist in the catalogue (orphaned after a
  // product delete) — otherwise the bundle could never be satisfied and would never
  // discount. Matches src/lib/bundleSavings.ts.
  const catalog = validProductIds ? new Set(validProductIds) : null;
  const effectiveIds = (b) =>
    catalog && catalog.size > 0 ? b.product_ids.filter(pid => catalog.has(pid)) : (b.product_ids || []);

  const active = (bundles || [])
    .filter(b => b.is_active && effectiveIds(b).length > 0)
    .sort((a, b) => (a.display_order - b.display_order) || String(a.id).localeCompare(String(b.id)));

  const instanceSaving = (ids, b) => {
    const base = ids.reduce((s, pid) => s + (price.get(pid) || 0), 0);
    return b.discount_type === 'percentage' ? base * (b.discount_value / 100) : b.discount_value;
  };

  const applied = new Map();
  let totalSavings = 0;

  for (;;) {
    let best = null;
    let bestIds = [];
    let bestSaving = 0;
    for (const b of active) {
      const ids = effectiveIds(b);
      if (ids.every(pid => (remaining.get(pid) || 0) >= 1)) {
        const sv = instanceSaving(ids, b);
        if (sv > bestSaving) { bestSaving = sv; best = b; bestIds = ids; }
      }
    }
    if (!best || bestSaving <= 0) break;

    for (const pid of bestIds) remaining.set(pid, (remaining.get(pid) || 0) - 1);
    totalSavings += bestSaving;
    const rec = applied.get(best.id) || { bundle: best, instances: 0, savings: 0 };
    rec.instances += 1;
    rec.savings += bestSaving;
    applied.set(best.id, rec);
  }

  return { applied: [...applied.values()], totalSavings };
};

// Write-side counterpart to computeBundleSavings' orphan tolerance: strip bundle
// product_ids that reference products no longer in the catalogue, so the persisted
// deals stay honest (the admin editor and the discount engine then agree on what a
// bundle contains). A missing/empty catalogue is treated as "unknown" — leave the
// bundles untouched rather than nuking every product_id. Returns the cleaned bundles
// and whether anything changed.
const sanitizeBundles = (bundles, products) => {
  const validIds = new Set((products || []).map(p => p?.id).filter(Boolean));
  if (validIds.size === 0 || !Array.isArray(bundles)) return { bundles: bundles || [], changed: false };
  let changed = false;
  const cleaned = bundles.map(b => {
    if (!Array.isArray(b?.product_ids)) return b;
    const kept = b.product_ids.filter(pid => validIds.has(pid));
    if (kept.length === b.product_ids.length) return b;
    changed = true;
    return { ...b, product_ids: kept };
  });
  return { bundles: cleaned, changed };
};

// Deleting/renaming a product can orphan bundle references — after products are
// saved, re-clean the stored deals so no bundle points at a product that's gone.
const cascadeCleanDeals = async (products) => {
  const { rows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_deals'`);
  const deals = rows[0]?.value;
  if (!deals || !Array.isArray(deals.bundles)) return;
  const { bundles, changed } = sanitizeBundles(deals.bundles, products);
  if (!changed) return;
  await pool.query(
    `UPDATE site_settings SET value = $1, updated_at = NOW() WHERE key = 'content_deals'`,
    [JSON.stringify({ ...deals, bundles })]
  );
};

// ── Discount codes ───────────────────────────────────────────────────────────
// Unambiguous alphabet — no 0/O/1/I/L so a code read off an email can't be
// mistyped into an ambiguous variant.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genDiscountCode = () => {
  const bytes = crypto.randomBytes(8);
  let body = '';
  for (let i = 0; i < 8; i++) body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `OG-${body}`;
};

const DISCOUNT_RESERVATION_MINUTES = 30;

// Normalize any user-entered code to the canonical stored form so "og-abc123 "
// and "OG-ABC123" resolve to the same row.
const normalizeCode = (raw) => (typeof raw === 'string' ? raw.trim().toUpperCase() : '');

// Euro value of a code against a given subtotal. Percentage scales with the
// basket; fixed is a flat amount, clamped so it can never exceed the subtotal
// (which would drive the order total negative).
const computeCodeDiscount = (type, value, subtotal) => {
  const v = Math.max(Number(value) || 0, 0);
  if (type === 'fixed') return Math.min(v, subtotal);
  // Percentages are validated at 0–100 on the way in, but a row written before
  // that check existed must not be able to discount more than the basket is worth.
  return subtotal * (Math.min(v, 100) / 100);
};

// Issue the one welcome code for a subscriber email. Idempotent on the unique
// canonical_email index: if a code already exists for that mailbox it's returned
// rather than a second one being minted — and because the lookup is canonical,
// subscribing again as me+2@gmail.com hands back the code me@gmail.com already
// has instead of a fresh discount. Retries only on the astronomically unlikely
// event of a random-code collision.
const issueSubscriberDiscountCode = async (email, discountPercent) => {
  const canonical = canonicalEmail(email);
  // Clamp: the percent comes from admin-editable popup settings, which go through
  // the generic content PUT and aren't range-checked there. A typo'd 1000 must not
  // become a 1000%-off code sitting in the table.
  const percent = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);

  const existing = await pool.query(
    `SELECT * FROM discount_codes
      WHERE source = 'subscribe' AND (canonical_email = $1 OR email = $2)
      ORDER BY created_at ASC LIMIT 1`,
    [canonical, email]
  );
  if (existing.rows.length) return existing.rows[0];

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO discount_codes (code, email, canonical_email, discount_percent, discount_value, discount_type, source)
         VALUES ($1, $2, $3, $4, $4, 'percentage', 'subscribe') RETURNING *`,
        [genDiscountCode(), email, canonical, percent]
      );
      return rows[0];
    } catch (err) {
      // 23505 on (email, source) or the canonical index → another request just
      // issued it (or an alias of the same mailbox already holds one); return that.
      if (err.code === '23505') {
        const { rows } = await pool.query(
          `SELECT * FROM discount_codes
            WHERE source = 'subscribe' AND (canonical_email = $1 OR email = $2)
            ORDER BY created_at ASC LIMIT 1`,
          [canonical, email]
        );
        if (rows.length) return rows[0];
        // else it was a code collision — loop and try a fresh code.
      } else {
        throw err;
      }
    }
  }
  throw new Error('Could not generate a unique discount code');
};

// The two person-level guards on a welcome (subscribe) code, shared by the
// read-only inspect and the authoritative reserve so the checkout can never be
// stricter or looser than what the shopper was told at "Apply".
//   1. Recipient binding — a welcome code is the *account holder's* first-order
//      discount, not a bearer token. Without this, someone can farm codes on
//      throwaway addresses (or buy one off a stranger) and spend them anywhere.
//   2. One per person — enforced on canonical email as well as user id, so
//      registering a second account from the same mailbox via a +tag alias
//      doesn't buy a second "first order" discount.
// `db` is the pool or an open transaction client, so reserve keeps its FOR UPDATE
// lock while these run.
const welcomeCodeBlockReason = async (db, target, userId, userCanonical) => {
  if (target.source !== 'subscribe') return null; // admin promo codes are exempt

  // Bound codes need a *proven* match: an account with no verified address (phone
  // signup) can't claim one, or naming the recipient's address in your profile
  // would be enough to take their discount. Codes issued before canonical_email
  // existed are backfilled at boot, so they bind too — a subscriber whose account
  // sits on a different address than the one they subscribed with is told to
  // subscribe again with the account's address, which mints them their own code.
  if (target.canonical_email && target.canonical_email !== userCanonical) {
    return userCanonical
      ? 'This welcome code was issued to a different email address. Subscribe with this account’s address to get your own code.'
      : 'Sign in with the email address this welcome code was sent to in order to use it.';
  }

  const { rows } = await db.query(
    `SELECT 1 FROM discount_codes
      WHERE source = 'subscribe' AND code <> $2
        AND ( redeemed_by_user_id = $1
              OR ( $3::text IS NOT NULL AND canonical_email = $3 AND redeemed_at IS NOT NULL )
              OR ( reserved_by_user_id = $1 AND redeemed_at IS NULL
                   AND reserved_at > NOW() - INTERVAL '${DISCOUNT_RESERVATION_MINUTES} minutes' ) )
      LIMIT 1`,
    [userId, target.code, userCanonical]
  );
  return rows.length ? "You've already used a welcome discount." : null;
};

// One redemption of a given code per account, unless the admin deliberately made
// it repeatable. This is what makes "max uses" mean "this many customers": a
// shared promo like SPRING20 with 100 uses is otherwise 100 discounted orders for
// whoever finds it first. Welcome codes are single-use anyway, so this only ever
// bites on multi-use admin codes. Reads the redemption ledger rather than
// redeemed_by_user_id, which only remembers the most recent redeemer.
// `db` is the pool or an open transaction client (reserve holds its row lock).
const codeUsedByUserReason = async (db, target, userId) => {
  if (!target.one_per_customer || !userId) return null;
  const { rows } = await db.query(
    'SELECT 1 FROM discount_redemptions WHERE code_id = $1 AND user_id = $2 LIMIT 1',
    [target.id, userId]
  );
  return rows.length ? "You've already used this code." : null;
};

// Read-only validation for the pre-checkout "apply code" UX. Never mutates —
// the authoritative check + hold happens in reserveDiscountCode at session time.
const inspectDiscountCode = async (code, userId) => {
  const normalized = normalizeCode(code);
  if (!normalized) return { valid: false, message: 'Enter a code to apply.' };

  const { rows } = await pool.query('SELECT * FROM discount_codes WHERE code = $1', [normalized]);
  const row = rows[0];
  if (!row) return { valid: false, message: "That code isn't valid." };
  if (!row.is_active) return { valid: false, message: 'This code is no longer active.' };
  const singleUse = Number(row.max_redemptions) <= 1;
  if (row.redemption_count >= row.max_redemptions) {
    return { valid: false, message: singleUse ? 'This code has already been used.' : 'This code has been fully redeemed.' };
  }

  const blocked = (await codeUsedByUserReason(pool, row, userId))
    || (await welcomeCodeBlockReason(pool, row, userId, await canonicalEmailForUser(userId)));
  if (blocked) return { valid: false, message: blocked };

  // Held by someone else's in-flight checkout right now. Only single-use codes
  // take an exclusive hold; multi-use codes rely on the atomic redeem cap instead.
  const heldByOther = singleUse &&
    row.reserved_at &&
    row.redemption_count < row.max_redemptions &&
    row.reserved_by_user_id !== userId &&
    new Date(row.reserved_at).getTime() > Date.now() - DISCOUNT_RESERVATION_MINUTES * 60_000;
  if (heldByOther) return { valid: false, message: 'This code is being used in another checkout right now.' };

  return {
    valid: true,
    code: normalized,
    discount_type: row.discount_type,
    discount_value: Number(row.discount_value),
    // Retained for older clients that still read discount_percent.
    discount_percent: row.discount_type === 'percentage' ? Number(row.discount_value) : 0,
  };
};

// Authoritative validate + hold, run in a transaction at checkout-session time.
// Returns { ok:true, percent } or { ok:false, message }. The two guards close the
// loopholes: (1) the per-user check stops one account from stacking two welcome
// codes across parallel checkouts; (2) the conditional UPDATE is atomic, so two
// checkouts racing for the *same* code can't both win.
const reserveDiscountCode = async (code, userId, sessionId) => {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, message: 'Enter a code to apply.' };

  // Resolved before BEGIN so the transaction holding the row lock stays short.
  const userCanonical = await canonicalEmailForUser(userId);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Lock the target row so a concurrent reserve of the same code serializes here.
    const { rows: targetRows } = await client.query(
      'SELECT * FROM discount_codes WHERE code = $1 FOR UPDATE', [normalized]
    );
    const target = targetRows[0];
    if (!target) { await client.query('ROLLBACK'); return { ok: false, message: "That code isn't valid." }; }
    if (!target.is_active) { await client.query('ROLLBACK'); return { ok: false, message: 'This code is no longer active.' }; }
    const singleUse = Number(target.max_redemptions) <= 1;
    if (target.redemption_count >= target.max_redemptions) {
      await client.query('ROLLBACK');
      return { ok: false, message: singleUse ? 'This code has already been used.' : 'This code has been fully redeemed.' };
    }

    // Recipient binding, one-welcome-per-person and one-use-per-customer, all
    // evaluated inside the same transaction that holds the FOR UPDATE lock (see
    // welcomeCodeBlockReason / codeUsedByUserReason).
    const blocked = (await codeUsedByUserReason(client, target, userId))
      || (await welcomeCodeBlockReason(client, target, userId, userCanonical));
    if (blocked) { await client.query('ROLLBACK'); return { ok: false, message: blocked }; }

    // A single-use code already committed to a checkout that can still be paid.
    // The exclusive hold below lapses after 30 minutes, but a Stripe Checkout
    // session stays payable for ~24h and asynchronous methods (Klarna, SEPA) settle
    // long after that — so without this, a shopper could open a coded checkout, wait
    // out the hold, open a second one with the same code, and pay BOTH at a
    // discount. redeemDiscountCode only ever fires once, so the second order would
    // keep its discount with nothing spent for it. Multi-use codes are exempt: their
    // capacity is enforced atomically at redeem, so concurrent checkouts are fine.
    // The shopper's own earlier sessions were expired before we got here (see
    // expirePriorCheckouts), so this can't lock someone out of their own code.
    if (singleUse) {
      const { rows: liveRows } = await client.query(
        `SELECT 1 FROM pending_checkouts
          WHERE consumed_at IS NULL AND expired_at IS NULL
            AND created_at > NOW() - INTERVAL '24 hours'
            AND payload->>'discount_code' = $1
          LIMIT 1`,
        [normalized]
      );
      if (liveRows.length) {
        await client.query('ROLLBACK');
        return { ok: false, message: 'This code is being used in another checkout right now.' };
      }
    }

    // Claim it. For single-use codes the hold is exclusive (free, already ours,
    // or a stale hold). Multi-use codes skip the exclusive hold — capacity is
    // enforced atomically at redeem — so parallel shoppers can all reserve.
    const { rows: claimed } = await client.query(
      `UPDATE discount_codes
          SET reserved_at = NOW(), reserved_by_user_id = $1, reserved_session_id = $3
        WHERE code = $2 AND is_active AND redemption_count < max_redemptions
          AND ( max_redemptions > 1
                OR reserved_at IS NULL
                OR reserved_by_user_id = $1
                OR reserved_at < NOW() - INTERVAL '${DISCOUNT_RESERVATION_MINUTES} minutes' )
        RETURNING discount_type, discount_value`,
      [userId, normalized, sessionId]
    );
    if (!claimed.length) {
      await client.query('ROLLBACK');
      return { ok: false, message: 'This code is being used in another checkout right now.' };
    }

    await client.query('COMMIT');
    return {
      ok: true,
      code: normalized,
      discount_type: claimed[0].discount_type,
      discount_value: Number(claimed[0].discount_value),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// Spend the code for good, at order finalization: bumps the counter and writes
// the redemption ledger row that one-per-customer is read from. Idempotent and
// defensive — the per-user NOT EXISTS guard is a second line of defence behind
// the reservation so a redeem can never hand one account a second welcome
// discount, and the ledger's (code, order) uniqueness absorbs a replayed finalize.
const redeemDiscountCode = async (code, userId, orderId) => {
  const normalized = normalizeCode(code);
  if (!normalized) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the code so two redeems of the same code serialize here: the ledger
    // check, the counter increment and the ledger write have to be one step, or
    // a multi-use code could record fewer redemptions than orders it funded.
    const { rows: targetRows } = await client.query(
      'SELECT id, one_per_customer FROM discount_codes WHERE code = $1 FOR UPDATE', [normalized]
    );
    const target = targetRows[0];
    if (!target) { await client.query('ROLLBACK'); return; }

    // Same one-per-customer rule reserve applied, re-checked now that the order
    // is real — a shopper who somehow reached payment twice on one code still
    // only ever spends it once.
    if (await codeUsedByUserReason(client, target, userId)) {
      await client.query('ROLLBACK');
      return;
    }

    const { rowCount } = await client.query(
      `UPDATE discount_codes dc
        SET redemption_count = dc.redemption_count + 1,
            redeemed_at = CASE WHEN dc.redemption_count + 1 >= dc.max_redemptions
                               THEN NOW() ELSE dc.redeemed_at END,
            redeemed_by_user_id = $1, order_id = $3,
            reserved_at = NULL, reserved_by_user_id = NULL, reserved_session_id = NULL
      WHERE dc.code = $2 AND dc.redemption_count < dc.max_redemptions
        AND ( dc.source <> 'subscribe' OR NOT EXISTS (
          SELECT 1 FROM discount_codes o
           WHERE o.source = 'subscribe' AND o.id <> dc.id
             AND ( o.redeemed_by_user_id = $1
                   -- …or the same mailbox already spent its welcome discount under
                   -- a different address spelling / a second account.
                   OR ( o.canonical_email IS NOT NULL
                        AND o.canonical_email = dc.canonical_email
                        AND o.redeemed_at IS NOT NULL ) ) ) )`,
      [userId, normalized, orderId]
    );

    // Ledger row only when the counter actually moved, so "rows in the ledger"
    // and "redemption_count" stay the same number. ON CONFLICT makes a replayed
    // finalize (same code, same order) a no-op instead of a duplicate entry.
    if (rowCount) {
      await client.query(
        `INSERT INTO discount_redemptions (code_id, user_id, order_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [target.id, userId, orderId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// Retire a shopper's earlier, still-payable checkout sessions before starting a
// new one. Stripe keeps a Checkout Session payable for ~24h, so a shopper who
// abandons a coded checkout and starts another would otherwise be left holding two
// live sessions for the same basket — pay both and the single-use code funds two
// discounted orders (the second redeem is a silent no-op). Expiring the old ones
// makes "one live checkout per shopper" true at Stripe, not just in our tables.
// Best-effort per session: `expire` legitimately fails for a session that's already
// complete or expired, and that must never block the new checkout.
const expirePriorCheckouts = async (userId) => {
  const { rows } = await pool.query(
    `SELECT id, stripe_session_id, payload->>'discount_code' AS discount_code
       FROM pending_checkouts
      WHERE user_id = $1 AND consumed_at IS NULL AND expired_at IS NULL
        AND created_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  for (const row of rows) {
    try {
      const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id);
      // Already paid (or paying) — leave it alone so finalizeCheckoutSession can
      // still turn it into the order the shopper's money belongs to.
      if (session.payment_status === 'paid' || session.status === 'complete') continue;
      if (session.status === 'open') await stripe.checkout.sessions.expire(row.stripe_session_id);
      await pool.query('UPDATE pending_checkouts SET expired_at = NOW() WHERE id = $1', [row.id]);
      // The session is dead, so its hold on the code should die with it rather
      // than linger for the rest of the 30 minutes. Matters when the shopper
      // holds more than one welcome code: a stale hold on the abandoned one
      // otherwise reads as "already using a welcome discount" and blocks the
      // other. Only ever clears an unredeemed hold this same shopper placed.
      if (row.discount_code) await releaseDiscountReservation(row.discount_code, userId);
    } catch (err) {
      console.error('[expirePriorCheckouts]', row.stripe_session_id, err?.message || err);
    }
  }
};

// Release an in-flight hold placed by reserveDiscountCode when the checkout it was
// reserved for never completes (the total resolved to <= 0, or Stripe failed to
// create the session). Only clears an *unredeemed* hold still owned by this user,
// so it can never disturb a code that was already spent or one another shopper is
// actively holding. Best-effort — a failed release just lets the 30-min hold lapse.
const releaseDiscountReservation = async (code, userId) => {
  const normalized = normalizeCode(code);
  if (!normalized) return;
  try {
    await pool.query(
      `UPDATE discount_codes
          SET reserved_at = NULL, reserved_by_user_id = NULL, reserved_session_id = NULL
        WHERE code = $1 AND redeemed_at IS NULL AND reserved_by_user_id = $2`,
      [normalized, userId]
    );
  } catch (err) {
    console.error('[releaseDiscountReservation]', err);
  }
};

const DEFAULT_AUTOMATION_SETTINGS = {
  refund_reminder_days: [1, 5, 7],
  refund_reminder_enabled: true,
  stuck_order_days: 3,
  low_stock_threshold: 5,
  decision_engine_enabled: true,
  auto_approvable_return_reasons: ['defective', 'damaged', 'wrong item'],
  return_window_days: 30,
  fraud_review_threshold: 300,
  stuck_order_followup_enabled: true,
  refund_automation_enabled: false,
  back_in_stock_notify_enabled: true,
  underperforming_bundle_days: 30,
};

const getAutomationSettings = async () => {
  const { rows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_automationSettings'`);
  return { ...DEFAULT_AUTOMATION_SETTINGS, ...(rows[0]?.value || {}) };
};

// ── Decision engine: "suggest, don't act" ───────────────────────────────────────
// Every rule below creates a row here instead of taking action directly. Dedupe
// is enforced by checking for an existing unresolved decision of the same type
// against the same order/return/product before inserting.
const createDecisionIfNew = async ({ type, orderId = null, returnId = null, productId = null, reasoning, suggestedAction }) => {
  const { rows: existing } = await pool.query(
    `SELECT id FROM admin_decisions
     WHERE type = $1 AND status = 'pending'
       AND order_id IS NOT DISTINCT FROM $2
       AND return_id IS NOT DISTINCT FROM $3
       AND product_id IS NOT DISTINCT FROM $4`,
    [type, orderId, returnId, productId]
  );
  if (existing.length) return null;
  const { rows } = await pool.query(
    `INSERT INTO admin_decisions (type, order_id, return_id, product_id, reasoning, suggested_action)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [type, orderId, returnId, productId, reasoning, JSON.stringify(suggestedAction)]
  );
  return rows[0];
};

// Evaluated synchronously right after a return is filed, and again as a backfill
// in the hourly sweep — either path is safe since createDecisionIfNew dedupes.
const evaluateReturnDecision = async (ret, order, settings) => {
  if (!settings.decision_engine_enabled) return;
  const reasonLower = (ret.reason || '').toLowerCase();
  const autoApprovable = (settings.auto_approvable_return_reasons || [])
    .some(r => reasonLower.includes(String(r).toLowerCase()));
  const daysSinceOrder = (Date.now() - new Date(order.created_at).getTime()) / 86400000;
  const withinWindow = daysSinceOrder <= (Number(settings.return_window_days) || 30);

  if (autoApprovable && withinWindow) {
    await createDecisionIfNew({
      type: 'return_approve_suggested', orderId: order.id, returnId: ret.id,
      reasoning: `Reason "${ret.reason}" matches an auto-approvable return reason and the order is within the ${settings.return_window_days}-day return window.`,
      suggestedAction: { type: 'update_return_status', return_id: ret.id, status: 'approved' },
    });
  } else {
    const why = !withinWindow
      ? `Order was placed ${Math.floor(daysSinceOrder)} days ago, outside the ${settings.return_window_days}-day return window.`
      : `Reason "${ret.reason}" doesn't match an auto-approvable reason — needs manual review.`;
    await createDecisionIfNew({
      type: 'return_reject_suggested', orderId: order.id, returnId: ret.id,
      reasoning: why,
      suggestedAction: { type: 'update_return_status', return_id: ret.id, status: 'rejected' },
    });
  }
};

// Evaluated synchronously right after an order is placed.
const evaluateFraudReviewDecision = async (order, settings) => {
  if (!settings.decision_engine_enabled) return;
  const threshold = Number(settings.fraud_review_threshold) || 300;
  if (Number(order.total) < threshold) return;
  await createDecisionIfNew({
    type: 'fraud_review', orderId: order.id,
    reasoning: `Order total €${Number(order.total).toFixed(2)} exceeds the €${threshold} review threshold.`,
    suggestedAction: { type: 'acknowledge' },
  });
};

// Evaluated by the hourly sweep (scheduler.js) — time-based idleness can't be
// caught by an event hook, it has to be polled. Reuses the same "stuck" query
// as the Ops overview.
const evaluateStuckOrderDecisions = async (settings) => {
  if (!settings.decision_engine_enabled || !settings.stuck_order_followup_enabled) return;
  const { rows: stuckOrders } = await pool.query(
    `SELECT o.id, o.tracking_number, o.status, o.created_at
     FROM orders o
     WHERE o.status NOT IN ('Delivered', 'Picked Up', 'Cancelled')
       AND o.created_at < NOW() - ($1 || ' days')::interval`,
    [String(Number(settings.stuck_order_days) || 3)]
  );
  for (const o of stuckOrders) {
    const days = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 86400000);
    await createDecisionIfNew({
      type: 'stuck_order_followup', orderId: o.id,
      reasoning: `Order #${o.tracking_number} has been "${o.status}" for ${days} days.`,
      suggestedAction: {
        type: 'send_message',
        subject: `An update on your order #${o.tracking_number}`,
        body: `Hi! We wanted to check in — your order #${o.tracking_number} is currently "${o.status}". We're on it and will let you know as soon as it moves forward. Thanks for your patience!`,
      },
    });
  }
};

// Evaluated inside PUT /api/content/products — diffs incoming stock against
// what was previously stored so it only fires on an actual 0/null → positive
// transition, not every unrelated content edit.
const evaluateBackInStockDecisions = async (previousItems, newItems, settings) => {
  if (!settings.decision_engine_enabled || !settings.back_in_stock_notify_enabled) return;
  for (const item of newItems || []) {
    const prev = (previousItems || []).find(p => p.id === item.id);
    const wasOut = !prev || prev.stock === undefined || prev.stock === null || Number(prev.stock) <= 0;
    const isNowIn = item.stock !== undefined && item.stock !== null && Number(item.stock) > 0;
    if (wasOut && isNowIn) {
      await createDecisionIfNew({
        type: 'back_in_stock_notify', productId: item.id,
        reasoning: `${item.name} is back in stock (${item.stock} available) after being unavailable.`,
        suggestedAction: { type: 'notify_subscribers_back_in_stock', product_id: item.id, product_name: item.name },
      });
    }
  }
};

// ── Stripe checkout → order handoff ─────────────────────────────────────────────
// An order is only ever created once Stripe confirms the charge succeeded — never
// on request from the browser directly — so there's no way to get an order without
// paying for it. Called from both the webhook (source of truth) and the success-page
// poll (so checkout still works end-to-end in dev without a webhook configured).
// Idempotent: safe to call multiple times for the same session.
const finalizeCheckoutSession = async (sessionId) => {
  const { rows: pendingRows } = await pool.query(
    'SELECT * FROM pending_checkouts WHERE stripe_session_id = $1', [sessionId]
  );
  if (!pendingRows.length) return null;
  const pending = pendingRows[0];

  if (pending.consumed_at) {
    const { rows: existing } = await pool.query('SELECT * FROM orders WHERE stripe_session_id = $1', [sessionId]);
    return existing.length ? withTracking(existing[0]) : null;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') return null;

  // Superseded by a later checkout from the same shopper (expirePriorCheckouts).
  // Stripe refuses payment on an expired session, so this should be unreachable —
  // if it ever fires, the shopper's money is real and the order still stands, but
  // it's logged loudly because it means the one-live-checkout guarantee slipped and
  // a single-use code may have funded two discounted orders.
  if (pending.expired_at) {
    console.error('[finalizeCheckoutSession] paid a superseded session:', sessionId);
  }

  const p = pending.payload;
  try {
    const { rows } = await pool.query(
      `INSERT INTO orders (user_id, items, subtotal, shipping, total, tracking_number, shipping_address, fulfillment_type, discount_percent, discount_amount, payment_status, stripe_session_id, stripe_payment_intent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'paid',$11,$12) RETURNING *`,
      [pending.user_id, JSON.stringify(p.items), p.subtotal, p.shipping, p.total, p.tracking_number,
       JSON.stringify(p.shipping_address), p.fulfillment_type, p.discount_percent, p.discount_amount,
       sessionId, session.payment_intent]
    );
    await pool.query('UPDATE pending_checkouts SET consumed_at = NOW() WHERE id = $1', [pending.id]);
    await pool.query('DELETE FROM user_carts WHERE user_id = $1', [pending.user_id]);

    const order = rows[0];
    await addOrderEvent(order.id, { type: 'order_placed', actor: 'system', title: 'Order placed', detail: `Order #${order.tracking_number} received` });

    // Decrement inventory. If a concurrent order emptied stock between this
    // order's checkout-time gate and its payment confirmation, decrementStock
    // reports the shortfall — the paid order still stands (we never lose a
    // customer's money/order), but we raise an admin decision + internal event so
    // the oversell is handled deliberately rather than silently.
    const { shortfalls } = await decrementStock(p.items);
    if (shortfalls.length) {
      const summary = shortfalls.map(s => `${s.name} (ordered ${s.requested}, ${s.available} in stock)`).join('; ');
      createDecisionIfNew({
        type: 'oversell_alert', orderId: order.id,
        reasoning: `Order #${order.tracking_number} oversold: ${summary}. Stock was available when checkout started but sold out before payment confirmed — review fulfillment (restock or partial refund).`,
        suggestedAction: { type: 'acknowledge' },
      }).catch(err => console.error('[oversell_alert]', err));
      addOrderEvent(order.id, {
        type: 'oversell', actor: 'system', title: 'Oversold at fulfillment',
        detail: summary, customerVisible: false,
      }).catch(err => console.error('[oversell event]', err));
    }

    // Spend the welcome code (if one was applied) now that payment is confirmed
    // and the order exists. Best-effort — the money's already been charged at the
    // discounted amount by Stripe, so a bookkeeping hiccup must never fail the order.
    if (p.discount_code) {
      try {
        await redeemDiscountCode(p.discount_code, order.user_id, order.id);
      } catch (err) {
        console.error('[redeemDiscountCode]', err);
      }
    }

    // Server-authored purchase event — the only place 'purchase' rows are
    // created, keyed to the browsing session that started this checkout (if the
    // client sent its analytics ids). Never allowed to fail the order.
    try {
      const a = p.analytics || {};
      await pool.query(
        `INSERT INTO analytics_events (visitor_id, session_id, user_id, event_type, path, props)
         VALUES ($1, $2, $3, 'purchase', '/checkout/success', $4)`,
        [a.visitor_id || 'server', a.session_id || 'server', pending.user_id,
         JSON.stringify({
           order_id: order.id,
           total: Number(order.total),
           items: p.items.reduce((sum, i) => sum + i.quantity, 0),
           fulfillment_type: p.fulfillment_type,
         })]
      );
    } catch (err) {
      console.error('[analytics purchase event]', err);
    }

    // The same purchase, reported to Google Analytics if the owner has that
    // switched on. Fire-and-forget for the same reason as the row above: a
    // measurement call must never stand between a paying customer and their
    // order. GA4 deduplicates on transaction_id, so the webhook and the
    // success-page poll racing each other cannot double the revenue.
    reportPurchaseToGa4(order, p).catch(err => console.error('[ga4 purchase]', err));
    // And to Meta, on the same terms: fire-and-forget, deduplicated on the
    // order's id so the webhook and the success-page poll racing each other
    // cannot report the sale twice, and silent unless the shopper consented.
    reportPurchaseToMeta(order, p).catch(err => console.error('[meta purchase]', err));

    getAutomationSettings().then(settings => evaluateFraudReviewDecision(order, settings)).catch(err => console.error('[evaluateFraudReviewDecision]', err));
    const { rows: userForEmail } = await pool.query('SELECT email FROM users WHERE id = $1', [order.user_id]);
    if (userForEmail[0]?.email) {
      sendOrderConfirmationEmail(userForEmail[0].email, {
        trackingNumber: order.tracking_number, total: Number(order.total).toFixed(2),
        orderUrl: `${FRONTEND_URL}/orders/${order.id}`,
      }).catch(err => console.error('[sendOrderConfirmationEmail]', err));
    }

    return withTracking(order);
  } catch (err) {
    // Unique violation on stripe_session_id — a concurrent call (webhook + poll
    // racing) already inserted it. Fetch and return that row instead of erroring.
    if (err.code === '23505') {
      const { rows: existing } = await pool.query('SELECT * FROM orders WHERE stripe_session_id = $1', [sessionId]);
      return existing.length ? withTracking(existing[0]) : null;
    }
    throw err;
  }
};

// ── Admin auth middleware ──────────────────────────────────────────────────────
// Beyond signature/expiry, this checks the token's tokenVersion against the
// admins row: a password reset bumps token_version, which immediately
// invalidates every JWT issued before the reset — not just the one the admin
// is currently holding — even though JWTs are otherwise stateless for 7 days.
const requireAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT token_version FROM admins WHERE email = $1', [payload.email]);
    if (!rows.length || rows[0].token_version !== payload.tokenVersion)
      return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ── User auth middleware ───────────────────────────────────────────────────────
// Reads the httpOnly session cookie (not an Authorization header — the customer-
// facing session token is never exposed to page JS), then resolves it against the
// user_sessions row it names. A valid signature is not sufficient: the row must
// exist, be unrevoked, and be inside BOTH the idle and absolute windows. That is
// what makes "sign out", "sign out everywhere" and "password change ends other
// sessions" real rather than cosmetic.
//
// Activity slides the idle window forward (throttled — see SESSION_TOUCH_MS) so an
// active shopper is never dropped mid-checkout, and the cookie is re-issued only
// once the window is half spent instead of on every single response.
const denySession = (res, message = 'Invalid or expired session') => {
  clearSessionCookie(res);
  return res.status(401).json({ error: message });
};

const requireUserAuth = async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return denySession(res);
  }
  if (!payload.userId) return denySession(res, 'Not a user token');

  try {
    // Cookies issued before the session store existed carry no sid. Rather than
    // signing every logged-in shopper out on deploy day, the still-valid token is
    // upgraded once into a real session row.
    if (!payload.sid) {
      const session = await createUserSession(req, res,
        { id: payload.userId, email: payload.email, phone: payload.phone },
        { remember: payload.remember !== false });
      req.user = { ...payload, sid: session.id };
      req.userSession = session;
      return next();
    }

    const { rows } = await pool.query(
      `SELECT * FROM user_sessions WHERE id = $1 AND user_id = $2`,
      [payload.sid, payload.userId]
    );
    const session = rows[0];
    if (!session) return denySession(res, 'Session ended');
    if (session.revoked_at) return denySession(res, 'This session was signed out');
    const now = Date.now();
    if (now > new Date(session.absolute_expires_at).getTime())
      return denySession(res, 'Please sign in again to continue');
    if (now > new Date(session.idle_expires_at).getTime())
      return denySession(res, 'Signed out after a long time away');

    // Touch: slide the idle window and record the device we last saw. Throttled,
    // so a burst of API calls costs one UPDATE, not one per request.
    const lastSeen = new Date(session.last_seen_at).getTime();
    if (now - lastSeen > SESSION_TOUCH_MS) {
      const idleMs = sessionIdleMs(session.remember);
      await pool.query(
        `UPDATE user_sessions
            SET last_seen_at = NOW(),
                idle_expires_at = LEAST(NOW() + ($2 || ' milliseconds')::interval, absolute_expires_at),
                user_agent = COALESCE(NULLIF($3, ''), user_agent),
                ip = COALESCE(NULLIF($4, ''), ip)
          WHERE id = $1`,
        [session.id, String(idleMs), requestUserAgent(req), requestIp(req)]
      );
      session.idle_expires_at = new Date(Math.min(now + idleMs, new Date(session.absolute_expires_at).getTime()));
    }

    // Lazy cookie renewal — only once the idle window is more than half spent.
    const remaining = new Date(session.idle_expires_at).getTime() - now;
    if (remaining < sessionIdleMs(session.remember) * SESSION_RENEW_AT)
      writeSessionCookie(res, session, { email: payload.email, phone: payload.phone });

    req.user = payload;
    req.userSession = session;
    next();
  } catch (err) {
    sendServerError(res, err);
  }
};

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Dynamic sitemap ────────────────────────────────────────────────────────────
// Served to crawlers as /sitemap.xml via a Netlify proxy rule (see
// public/_redirects). Static marketing routes plus one URL per product, so new
// candles are discoverable without redeploying the frontend. Slug rules must
// stay in lockstep with src/lib/products.ts (admin slug → slugified name → id).

const SITEMAP_SITE_URL = process.env.PUBLIC_SITE_URL || 'https://theolivegoose.ie';

const sitemapSlugify = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// [path, changefreq, priority] — public, indexable routes only (mirror of the
// frontend's ROUTE_META minus noindex entries).
const SITEMAP_STATIC_ROUTES = [
  ['/',                 'weekly',  '1.0'],
  ['/shop',             'weekly',  '0.9'],
  ['/deals',            'weekly',  '0.7'],
  ['/about',            'monthly', '0.8'],
  ['/candle-care',      'monthly', '0.6'],
  ['/gift-cards',       'monthly', '0.6'],
  ['/customer-service', 'monthly', '0.5'],
  ['/faq',              'monthly', '0.6'],
  ['/track-order',      'yearly',  '0.3'],
  ['/shipping-policy',  'yearly',  '0.3'],
  ['/returns',          'yearly',  '0.3'],
  ['/privacy-policy',   'yearly',  '0.2'],
  ['/terms-of-service', 'yearly',  '0.2'],
];

app.get('/api/sitemap.xml', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT value, updated_at FROM site_settings WHERE key = 'content_products'"
    );
    const products = rows[0]?.value?.items || [];
    const productsLastmod = (rows[0]?.updated_at ? new Date(rows[0].updated_at) : new Date())
      .toISOString().slice(0, 10);

    const urls = [];
    for (const [path, changefreq, priority] of SITEMAP_STATIC_ROUTES) {
      urls.push(
        `  <url>\n` +
        `    <loc>${xmlEscape(SITEMAP_SITE_URL + (path === '/' ? '/' : path))}</loc>\n` +
        `    <changefreq>${changefreq}</changefreq>\n` +
        `    <priority>${priority}</priority>\n` +
        `  </url>`
      );
    }
    for (const p of products) {
      const slug = sitemapSlugify(p.slug?.trim() || p.name || '') || p.id;
      if (!slug) continue;
      const image = typeof p.image_url === 'string' && p.image_url.startsWith('http')
        ? `\n    <image:image>\n      <image:loc>${xmlEscape(p.image_url)}</image:loc>\n      <image:title>${xmlEscape(`${p.name} — handmade candle by The Olive Goose`)}</image:title>\n    </image:image>`
        : '';
      urls.push(
        `  <url>\n` +
        `    <loc>${xmlEscape(`${SITEMAP_SITE_URL}/products/${encodeURIComponent(slug)}`)}</loc>\n` +
        `    <lastmod>${productsLastmod}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>0.8</priority>${image}\n` +
        `  </url>`
      );
    }

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
      `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
      urls.join('\n') + `\n</urlset>\n`
    );
  } catch (err) { sendServerError(res, err); }
});

// A fixed dummy hash to compare against when no admin row matches — keeps the
// login response time roughly constant whether or not the email exists, so a
// timing side-channel can't be used to enumerate the admin email.
const DUMMY_BCRYPT_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8g9wYQpBhaC4PVeWZQhBw1lB9O.k0.';

// ── Admin login ────────────────────────────────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const normEmail = (email || '').toLowerCase().trim();
  if (!normEmail || !password) return res.status(401).json({ error: 'Invalid credentials' });

  const { rows } = await pool.query('SELECT * FROM admins WHERE email = $1', [normEmail]);
  const admin = rows[0];

  const valid = await bcrypt.compare(password, admin ? admin.password_hash : DUMMY_BCRYPT_HASH);
  if (!admin || !valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ email: admin.email, tokenVersion: admin.token_version }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// ── PUT /api/auth/admin/password — change password while signed in ─────────────
// Until now the only way to change an admin password was the emailed reset link,
// which is useless if the mailbox is gone and means the hash in the environment
// silently drifts out of date. Requires the current password (a stolen admin
// token alone must not be enough to lock the real owner out) and returns a fresh
// JWT, because bumping token_version invalidates the caller's own token.
app.put('/api/auth/admin/password', authLimiter, requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both your current and new password are required.' });

  const pwError = validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });
  if (currentPassword === newPassword)
    return res.status(400).json({ error: 'Your new password must be different from the current one.' });

  try {
    const { rows } = await pool.query('SELECT * FROM admins WHERE email = $1', [req.user.email]);
    const admin = rows[0];
    // Compare against a dummy hash when the row is missing so this can't be used
    // to probe which admin emails exist, same as the login route.
    const valid = await bcrypt.compare(currentPassword, admin ? admin.password_hash : DUMMY_BCRYPT_HASH);
    if (!admin || !valid) return res.status(401).json({ error: 'Your current password is not correct.' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await pool.query(
      `UPDATE admins SET password_hash = $1, token_version = token_version + 1, updated_at = NOW()
       WHERE email = $2 RETURNING email, token_version`,
      [passwordHash, admin.email]
    );
    // Any reset link already in an inbox must stop working the moment the
    // password changes by another route.
    await pool.query(
      `UPDATE admin_password_resets SET used_at = NOW() WHERE admin_email = $1 AND used_at IS NULL`,
      [admin.email]
    );

    const token = jwt.sign(
      { email: updated.rows[0].email, tokenVersion: updated.rows[0].token_version },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, message: 'Password updated. Other signed-in sessions have been logged out.' });
  } catch (err) { sendServerError(res, err); }
});

// ── Admin password reset (forgot) ───────────────────────────────────────────────
// Always returns the same generic message regardless of whether the email
// matches an admin, so this endpoint can't be used to enumerate admin accounts.
app.post('/api/auth/admin/password/forgot', otpSendLimiter, async (req, res) => {
  const normEmail = (req.body.email || '').toLowerCase().trim();
  const genericMsg = { message: 'If that email is registered as an admin, a reset link has been sent.' };

  if (!EMAIL_RE.test(normEmail)) return res.json(genericMsg);

  try {
    const { rows } = await pool.query('SELECT email FROM admins WHERE email = $1', [normEmail]);
    if (rows.length) {
      const rawToken  = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min, single-use

      await pool.query(
        `INSERT INTO admin_password_resets (admin_email, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [normEmail, tokenHash, expiresAt]
      );

      const resetUrl = `${FRONTEND_URL}/admin/reset-password?token=${rawToken}`;
      sendAdminPasswordResetEmail(normEmail, resetUrl).catch(err => console.error('[admin reset email]', err));
    }
  } catch (err) {
    console.error('[admin password forgot]', err);
  }

  res.json(genericMsg);
});

// ── Admin password reset (confirm) ──────────────────────────────────────────────
app.post('/api/auth/admin/password/reset', authLimiter, async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Missing token or new password.' });

  const pwError = validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const { rows } = await pool.query(
      `SELECT * FROM admin_password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    if (!rows.length) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

    const record = rows[0];
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Bumping token_version invalidates every JWT issued before this reset —
    // a leaked/stolen admin session token stops working the moment the
    // password changes, instead of remaining valid for its full 7-day life.
    await pool.query(
      `UPDATE admins SET password_hash = $1, token_version = token_version + 1, updated_at = NOW() WHERE email = $2`,
      [passwordHash, record.admin_email]
    );
    // Consume this token and any other outstanding ones for the same admin,
    // so a second, unused reset link can't be replayed after this one lands.
    await pool.query(
      `UPDATE admin_password_resets SET used_at = NOW() WHERE admin_email = $1 AND used_at IS NULL`,
      [record.admin_email]
    );

    res.json({ message: 'Password reset. Please sign in with your new password.' });
  } catch (err) {
    console.error('[admin password reset]', err);
    res.status(500).json({ error: 'Could not reset password.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// USER AUTH
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/user/register/start ────────────────────────────────────────────
// Validates the signup, emails a 6-digit code, and stashes the pending account
// (with already-hashed password) in email_otps. No users row is created until
// the code is verified, so unverified accounts never exist.
app.post('/api/user/register/start', otpSendLimiter, async (req, res) => {
  const { email, password, full_name = '' } = req.body;
  const normEmail = (email || '').toLowerCase().trim();

  if (!EMAIL_RE.test(normEmail))
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });

  try {
    const { rows: existing } = await pool.query('SELECT 1 FROM users WHERE email = $1', [normEmail]);
    if (existing.length) return res.status(409).json({ error: 'Email already in use' });

    // 60s resend cooldown
    const { rows: prior } = await pool.query(
      `SELECT created_at FROM email_otps WHERE email = $1 AND purpose = 'signup'`,
      [normEmail]
    );
    if (prior.length && (Date.now() - new Date(prior[0].created_at).getTime()) < 60 * 1000)
      return res.status(429).json({ error: 'Please wait a moment before requesting another code.' });

    const code         = sixDigitCode();
    const otpHash      = await bcrypt.hash(code, 8);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const expiresAt    = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    const payload      = { full_name: full_name.trim(), password_hash: passwordHash };

    await pool.query(
      `INSERT INTO email_otps (email, purpose, otp_hash, payload, attempts, expires_at, created_at)
       VALUES ($1, 'signup', $2, $3, 0, $4, NOW())
       ON CONFLICT (email, purpose)
       DO UPDATE SET otp_hash = $2, payload = $3, attempts = 0, expires_at = $4, created_at = NOW()`,
      [normEmail, otpHash, JSON.stringify(payload), expiresAt]
    );

    const { delivered } = await sendOtpEmail(normEmail, code);
    // In dev mode (no email provider) return the code so the flow stays testable.
    // Gated on IS_PROD (not just `delivered`) so a misconfigured prod deploy
    // (RESEND_API_KEY missing) fails to send rather than leaking the code.
    res.json(delivered || IS_PROD ? { success: true } : { success: true, dev_otp: code });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/user/register/verify ───────────────────────────────────────────
// Confirms the code and creates the verified account.
app.post('/api/user/register/verify', authLimiter, async (req, res) => {
  const { email, otp } = req.body;
  const normEmail = (email || '').toLowerCase().trim();
  if (!normEmail || !otp) return res.status(400).json({ error: 'Email and code required' });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM email_otps WHERE email = $1 AND purpose = 'signup'`,
      [normEmail]
    );
    if (!rows.length) return res.status(400).json({ error: 'No pending signup found. Please start again.' });

    const record = rows[0];
    if (new Date() > new Date(record.expires_at)) {
      await pool.query(`DELETE FROM email_otps WHERE email = $1 AND purpose = 'signup'`, [normEmail]);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }
    if (record.attempts >= 5) {
      await pool.query(`DELETE FROM email_otps WHERE email = $1 AND purpose = 'signup'`, [normEmail]);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please start again.' });
    }

    const valid = await bcrypt.compare(String(otp).trim(), record.otp_hash);
    if (!valid) {
      await pool.query(
        `UPDATE email_otps SET attempts = attempts + 1 WHERE email = $1 AND purpose = 'signup'`,
        [normEmail]
      );
      return res.status(400).json({ error: 'Invalid code. Please try again.' });
    }

    const { full_name = '', password_hash } = record.payload || {};
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, provider, email_verified)
       VALUES ($1, $2, $3, 'email', true)
       RETURNING id, email, full_name, provider, avatar_url`,
      [normEmail, password_hash, full_name]
    );
    await pool.query(`DELETE FROM email_otps WHERE email = $1 AND purpose = 'signup'`, [normEmail]);

    const user = userRows[0];
    await createUserSession(req, res, user);
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    sendServerError(res, err);
  }
});

// ── POST /api/user/login ───────────────────────────────────────────────────────
app.post('/api/user/login', authLimiter, async (req, res) => {
  const { email, password, remember = true } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE email = $1 AND provider = 'email'`,
      [email.toLowerCase().trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await createUserSession(req, res, user, { remember: !!remember });
    res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, avatar_url: user.avatar_url, provider: user.provider } });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/user/logout ──────────────────────────────────────────────────────
// Revokes the session server-side as well as clearing the cookie, so a copy of
// the cookie taken off the device is dead the moment the customer signs out.
// Deliberately not behind requireUserAuth: signing out must succeed even when the
// session is already expired or unreadable — it should never fail with a 401.
app.post('/api/user/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  clearSessionCookie(res);
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.sid) await revokeSession(payload.sid, 'signed_out');
    } catch {
      // Unreadable/expired token — nothing left to revoke; the cookie is gone.
    }
  }
  res.json({ success: true });
});

// ── Signed-in devices ──────────────────────────────────────────────────────────
// The "where you're signed in" list every serious account area has. Only ever
// exposes the caller's own sessions, and never the session token — the id here is
// the row id, which is useless as a credential without the signed cookie.
app.get('/api/user/sessions', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, user_agent, ip, remember, created_at, last_seen_at, idle_expires_at, absolute_expires_at
         FROM user_sessions
        WHERE user_id = $1 AND revoked_at IS NULL
          AND idle_expires_at > NOW() AND absolute_expires_at > NOW()
        ORDER BY last_seen_at DESC`,
      [req.user.userId]
    );
    res.json(rows.map(r => ({
      id: r.id,
      current: r.id === req.user.sid,
      device: describeDevice(r.user_agent),
      ip: r.ip || '',
      remember: r.remember,
      created_at: r.created_at,
      last_seen_at: r.last_seen_at,
      // What the shopper cares about is when this device gets signed out, which is
      // whichever limit bites first.
      expires_at: new Date(Math.min(
        new Date(r.idle_expires_at).getTime(),
        new Date(r.absolute_expires_at).getTime()
      )),
    })));
  } catch (err) {
    sendServerError(res, err);
  }
});

// Sign one device out. Scoped by user_id so a session id guessed or leaked from
// another account can't be used to log a stranger out.
app.delete('/api/user/sessions/:id', requireUserAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW(), revoked_reason = 'revoked_by_user'
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [req.params.id, req.user.userId]
    );
    if (!rowCount) return res.status(404).json({ error: 'That session is already signed out.' });
    // Revoking the device you're holding is just signing out.
    if (req.params.id === req.user.sid) clearSessionCookie(res);
    res.json({ success: true, current: req.params.id === req.user.sid });
  } catch (err) {
    // An id that isn't a UUID reaches Postgres as a cast error, not a server fault.
    if (err?.code === '22P02') return res.status(400).json({ error: 'Unknown session.' });
    sendServerError(res, err);
  }
});

// "Sign out everywhere else" — the one-click answer to "I left myself logged in
// on a shared computer", without logging the customer out of the device they're
// asking from.
app.post('/api/user/sessions/revoke-others', requireUserAuth, async (req, res) => {
  try {
    const { rowCount } = await revokeUserSessions(req.user.userId, {
      exceptId: req.user.sid, reason: 'revoked_by_user',
    });
    res.json({ success: true, revoked: rowCount });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/user/me ───────────────────────────────────────────────────────────
app.get('/api/user/me', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, phone, full_name, provider, avatar_url,
              address_line1, address_line2, city, state, postal_code, country
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── PUT /api/user/me — update the account's contact details ──────────────────
// Contact details only. The six address columns on the users row are a *mirror*
// of whichever address book row is currently the default (syncDefaultAddressToUser
// maintains them), so a direct write here would be both unvalidated and transient
// — silently clobbered the next time the address book changed. Address edits go
// through /api/user/addresses, which applies the full per-country rules.
const PROFILE_ADDRESS_FIELDS =
  ['address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country'];

app.put('/api/user/me', requireUserAuth, async (req, res) => {
  if (PROFILE_ADDRESS_FIELDS.some(f => req.body[f] !== undefined)) {
    return res.status(400).json({
      error: 'Addresses are managed in your address book. Use /api/user/addresses to add or edit a delivery address.',
    });
  }

  // The account name goes on pickup notices and prefills the parcel label, so it
  // is held to the same standard as a recipient name — this endpoint is not a
  // back door around the form. Absent means "leave it alone" (the COALESCE
  // below); present is validated and stored tidied.
  let full_name = req.body.full_name;
  if (full_name !== undefined && full_name !== null) {
    const problem = validateName(full_name, ACCOUNT_NAME_COPY);
    if (problem) return res.status(400).json({ error: problem });
    full_name = tidy(full_name);
  }

  try {
    // The account phone is what checkout falls back to when an address carries no
    // number of its own, so it's held to the same standard and stored in E.164.
    // An explicit empty string still clears it; only a number that's actually
    // there has to be dialable. A bare number with no country code is read
    // against the account's own country — the same reading the profile form
    // applies — falling back to Ireland for an account that has no address yet.
    let phone = req.body.phone;
    if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
      let homeCountry = '';
      if (!String(phone).trim().startsWith('+')) {
        const { rows: own } = await pool.query(`SELECT country FROM users WHERE id = $1`, [req.user.userId]);
        homeCountry = own[0]?.country || '';
      }
      phone = toE164(phone, homeCountry);
      const problem = validatePhone(phone);
      if (problem) return res.status(400).json({ error: problem });
    }

    const { rows } = await pool.query(
      `UPDATE users SET
         full_name = COALESCE($1, full_name),
         phone     = COALESCE($2, phone)
       WHERE id = $3
       RETURNING id, email, phone, full_name, provider, avatar_url,
                 address_line1, address_line2, city, state, postal_code, country`,
      [full_name, phone, req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Phone number already in use' });
    sendServerError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADDRESS BOOK — many delivery addresses per user (see user_addresses table)
// ══════════════════════════════════════════════════════════════════════════════

// Mirror the legacy single-address columns on the users row to whichever address
// is currently the default, so checkout prefill and GET /api/user/me keep reading
// one canonical "default address" without knowing this table exists. Only the six
// address columns are synced — the account's full_name/phone identity is left alone
// (an address may carry a different recipient name/phone than the account holder).
async function syncDefaultAddressToUser(userId) {
  const { rows } = await pool.query(
    `SELECT address_line1, address_line2, city, state, postal_code, country
     FROM user_addresses WHERE user_id = $1 AND is_default = true LIMIT 1`,
    [userId]
  );
  const a = rows[0] || { address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '' };
  await pool.query(
    `UPDATE users SET
       address_line1 = $1, address_line2 = $2, city = $3,
       state = $4, postal_code = $5, country = $6
     WHERE id = $7`,
    [a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.country, userId]
  );
}

// Saved addresses go through validateAddress/normalizeAddress from addressRules.js
// — the same per-country postal, county and phone rules the form applies. The API
// is not a back door around the form: an address book row is what dispatch prints,
// so it is stored in exactly one shape and only when a courier could deliver to it.

const ADDRESS_COLS =
  'id, full_name, phone, address_line1, address_line2, city, state, postal_code, country, is_default, created_at';

// ── GET /api/user/addresses — list the address book (default first) ─────────────
app.get('/api/user/addresses', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ADDRESS_COLS} FROM user_addresses WHERE user_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [req.user.userId]
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/user/addresses — add an address ───────────────────────────────────
app.post('/api/user/addresses', requireUserAuth, async (req, res) => {
  const b = req.body || {};
  const err = validateAddress(b);
  if (err) return res.status(400).json({ error: err });
  const a = normalizeAddress(b);
  try {
    // The very first address a user saves is always their default; after that,
    // only make it default when explicitly asked (make_default).
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM user_addresses WHERE user_id = $1', [req.user.userId]
    );
    const makeDefault = b.make_default === true || countRows[0].n === 0;
    // Clear the old default first — the partial unique index allows only one.
    if (makeDefault)
      await pool.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.user.userId]);

    const { rows } = await pool.query(
      `INSERT INTO user_addresses
        (user_id, full_name, phone, address_line1, address_line2, city, state, postal_code, country, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${ADDRESS_COLS}`,
      [req.user.userId, a.full_name, a.phone, a.address_line1, a.address_line2,
       a.city, a.state, a.postal_code, a.country, makeDefault]
    );
    if (makeDefault) await syncDefaultAddressToUser(req.user.userId);
    res.status(201).json(rows[0]);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── PUT /api/user/addresses/:id — edit an address ───────────────────────────────
app.put('/api/user/addresses/:id', requireUserAuth, async (req, res) => {
  const b = req.body || {};
  const err = validateAddress(b);
  if (err) return res.status(400).json({ error: err });
  const a = normalizeAddress(b);
  try {
    const { rows: owned } = await pool.query(
      'SELECT is_default FROM user_addresses WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (!owned.length) return res.status(404).json({ error: 'Address not found' });

    // Editing keeps whatever default status it had; passing make_default promotes it.
    // (You clear a default by making a different address the default, not by editing.)
    const makeDefault = b.make_default === true || owned[0].is_default;
    if (makeDefault)
      await pool.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.user.userId]);

    const { rows } = await pool.query(
      `UPDATE user_addresses SET
         full_name=$1, phone=$2, address_line1=$3, address_line2=$4,
         city=$5, state=$6, postal_code=$7, country=$8, is_default=$9
       WHERE id=$10 AND user_id=$11
       RETURNING ${ADDRESS_COLS}`,
      [a.full_name, a.phone, a.address_line1, a.address_line2, a.city,
       a.state, a.postal_code, a.country, makeDefault, req.params.id, req.user.userId]
    );
    await syncDefaultAddressToUser(req.user.userId);
    res.json(rows[0]);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/user/addresses/:id/default — make an address the default ──────────
app.post('/api/user/addresses/:id/default', requireUserAuth, async (req, res) => {
  try {
    const { rows: owned } = await pool.query(
      'SELECT id FROM user_addresses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]
    );
    if (!owned.length) return res.status(404).json({ error: 'Address not found' });
    await pool.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.user.userId]);
    await pool.query('UPDATE user_addresses SET is_default = true WHERE id = $1', [req.params.id]);
    await syncDefaultAddressToUser(req.user.userId);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── DELETE /api/user/addresses/:id — remove an address ──────────────────────────
app.delete('/api/user/addresses/:id', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM user_addresses WHERE id = $1 AND user_id = $2 RETURNING is_default',
      [req.params.id, req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Address not found' });
    // If the default was removed, promote the most recently added remaining address.
    if (rows[0].is_default)
      await pool.query(
        `UPDATE user_addresses SET is_default = true
         WHERE id = (SELECT id FROM user_addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`,
        [req.user.userId]
      );
    await syncDefaultAddressToUser(req.user.userId);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── PUT /api/user/me/password — change password (email accounts only) ───────
app.put('/api/user/me/password', requireUserAuth, authLimiter, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Current and new password are required' });
  const pwError = validatePassword(new_password);
  if (pwError) return res.status(400).json({ error: pwError });

  try {
    const { rows } = await pool.query(
      `SELECT password_hash, provider FROM users WHERE id = $1`,
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const { password_hash, provider } = rows[0];
    if (provider !== 'email' || !password_hash)
      return res.status(400).json({ error: 'This account signs in via ' + provider + ' and has no password to change.' });

    // 400, not 401: the caller is already authenticated (requireUserAuth passed) —
    // this is a validation failure, not a session problem. The frontend's global
    // 401 handler treats every 401 as "session expired" and force-logs the user
    // out, which would otherwise fire here and hide the real "wrong password" error.
    const valid = await bcrypt.compare(current_password, password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, req.user.userId]);

    // Changing your password is how a customer takes their account back. That only
    // means anything if it ends every OTHER signed-in device immediately — this one
    // keeps its session so they aren't bounced out of the form they just submitted.
    const { rowCount } = await revokeUserSessions(req.user.userId, {
      exceptId: req.user.sid, reason: 'password_change',
    });
    res.json({ success: true, signed_out_sessions: rowCount });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/user/password/forgot — request a reset code ───────────────────
// Always responds success (even for unknown emails) so this can't be used to
// enumerate registered accounts; only sends an email when the account exists.
app.post('/api/user/password/forgot', otpSendLimiter, async (req, res) => {
  const normEmail = (req.body.email || '').toLowerCase().trim();
  if (!EMAIL_RE.test(normEmail)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  try {
    const { rows: userRows } = await pool.query(
      `SELECT id FROM users WHERE email = $1 AND provider = 'email'`, [normEmail]
    );
    if (!userRows.length) return res.json({ success: true });

    const { rows: prior } = await pool.query(
      `SELECT created_at FROM email_otps WHERE email = $1 AND purpose = 'reset'`, [normEmail]
    );
    if (prior.length && (Date.now() - new Date(prior[0].created_at).getTime()) < 60 * 1000)
      return res.status(429).json({ error: 'Please wait a moment before requesting another code.' });

    const code      = sixDigitCode();
    const otpHash   = await bcrypt.hash(code, 8);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO email_otps (email, purpose, otp_hash, attempts, expires_at, created_at)
       VALUES ($1, 'reset', $2, 0, $3, NOW())
       ON CONFLICT (email, purpose)
       DO UPDATE SET otp_hash = $2, attempts = 0, expires_at = $3, created_at = NOW()`,
      [normEmail, otpHash, expiresAt]
    );

    const { delivered } = await sendPasswordResetEmail(normEmail, code);
    res.json(delivered || IS_PROD ? { success: true } : { success: true, dev_otp: code });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/user/password/reset — confirm code + set new password ─────────
// Auto-signs the user in on success so a password reset never leaves them
// stranded on the sign-in screen — they land back in the app already logged in.
app.post('/api/user/password/reset', authLimiter, async (req, res) => {
  const { email, otp, new_password } = req.body;
  const normEmail = (email || '').toLowerCase().trim();
  if (!normEmail || !otp || !new_password)
    return res.status(400).json({ error: 'Email, code, and new password are required' });
  const pwError = validatePassword(new_password);
  if (pwError) return res.status(400).json({ error: pwError });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM email_otps WHERE email = $1 AND purpose = 'reset'`, [normEmail]
    );
    if (!rows.length) return res.status(400).json({ error: 'No pending reset found. Please request a new code.' });

    const record = rows[0];
    if (new Date() > new Date(record.expires_at)) {
      await pool.query(`DELETE FROM email_otps WHERE email = $1 AND purpose = 'reset'`, [normEmail]);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }
    if (record.attempts >= 5) {
      await pool.query(`DELETE FROM email_otps WHERE email = $1 AND purpose = 'reset'`, [normEmail]);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }

    const valid = await bcrypt.compare(String(otp).trim(), record.otp_hash);
    if (!valid) {
      await pool.query(
        `UPDATE email_otps SET attempts = attempts + 1 WHERE email = $1 AND purpose = 'reset'`, [normEmail]
      );
      return res.status(400).json({ error: 'Invalid code. Please try again.' });
    }

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    const { rows: userRows } = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE email = $2 AND provider = 'email'
       RETURNING id, email, full_name, provider, avatar_url`,
      [newHash, normEmail]
    );
    if (!userRows.length) return res.status(404).json({ error: 'Account not found' });
    await pool.query(`DELETE FROM email_otps WHERE email = $1 AND purpose = 'reset'`, [normEmail]);

    const user = userRows[0];
    // A reset is the "someone else is in my account" lever, so it ends EVERY
    // existing session — including any the intruder is holding — before the fresh
    // one below is issued.
    await revokeUserSessions(user.id, { reason: 'password_reset' });
    await createUserSession(req, res, user);
    res.json({ user });
  } catch (err) {
    sendServerError(res, err);
  }
});

// Lets the frontend hide social-login buttons it can't actually complete,
// instead of hard-navigating to an error page when a provider isn't configured.
app.get('/api/auth/providers', (_req, res) => {
  res.json({
    google:   !!process.env.GOOGLE_CLIENT_ID,
    facebook: !!process.env.FACEBOOK_APP_ID,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE OAUTH
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/auth/google', (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID)
    return res.status(500).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID.' });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',     process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri',  `${BACKEND_URL}/api/auth/google/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope',         'openid email profile');
  // Online access only: we use the one-time access token at the callback to read
  // the profile and never touch a refresh token. Requesting offline access issues
  // a refresh token / "offline access granted" grant, which makes Google email the
  // user a security notification on (re-)grant — spamming them on repeat logins for
  // a capability we don't use.
  url.searchParams.set('access_type',   'online');
  url.searchParams.set('state',         issueOauthState(res));
  res.redirect(url.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
  if (!consumeOauthState(req, res)) return res.redirect(`${FRONTEND_URL}/auth/callback?error=state_mismatch`);
  const { code } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}/auth/callback?error=no_code`);

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${BACKEND_URL}/api/auth/google/callback`,
        grant_type:    'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.id_token) throw new Error('No id_token from Google');

    // Read the profile from the OIDC id_token instead of calling the userinfo API.
    // We requested the `openid email profile` scope, so the id_token already carries
    // email/email_verified/name/picture/sub. Hitting googleapis.com/userinfo on every
    // login makes Google email the user a "here's the data you shared" summary each
    // time — reading the id_token claims we were just handed over TLS avoids that API
    // access entirely (no signature re-verify needed: it came straight from Google's
    // token endpoint in this request, authenticated by our client secret).
    const claims = jwt.decode(tokenData.id_token) || {};
    const gUser = {
      email:          claims.email,
      verified_email: claims.email_verified,
      name:           claims.name,
      picture:        claims.picture,
      id:             claims.sub,
    };

    // Never trust an unverified provider email as proof of ownership — anyone who
    // can obtain a Google identity reporting a victim's address (e.g. an unverified
    // Workspace alias) could otherwise sign in as that victim.
    if (!gUser.verified_email) {
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=email_not_verified`);
    }

    // ── Account linking ────────────────────────────────────────────────────────
    // Attaching this Google identity to an existing account is safe only when BOTH
    // sides have independently proven control of the same mailbox. Google has, just
    // above. The local side is proven when the account was created through the
    // password signup flow: /api/user/register/verify writes no users row until an
    // emailed OTP comes back, so a provider='email' account cannot exist for an
    // address its owner doesn't control. Same mailbox, both proven — same person,
    // and linking is not a takeover. This is the standard rule (GitHub, Slack, …).
    //
    // A Facebook- or phone-created account that merely carries this email has not
    // met that bar, so it is still refused. Both halves of the check are load-bearing:
    // email_verified is now set honestly at every insert site and repaired for old
    // rows (see repair_email_verified_by_provider in initDb), and provider='email'
    // is what ties it to the OTP guarantee above.
    const { rows: existingRows } = await pool.query(
      'SELECT provider, email_verified FROM users WHERE email = $1', [gUser.email]
    );
    const existing = existingRows[0];
    const linkable = existing?.provider === 'email' && existing.email_verified;

    if (existing && existing.provider !== 'google' && !linkable) {
      // Pass the existing provider back so the callback screen can tell the user
      // how they actually signed up ("use your password") instead of showing them
      // a bare error code they can't act on.
      return res.redirect(
        `${FRONTEND_URL}/auth/callback?error=account_exists&provider=${encodeURIComponent(existing.provider)}`
      );
    }

    const { rows } = await pool.query(
      `INSERT INTO users (email, full_name, avatar_url, provider, provider_id, email_verified)
       VALUES ($1, $2, $3, 'google', $4, true)
       ON CONFLICT (email) DO UPDATE SET
         -- Fill blanks from Google, never overwrite: a name or picture the shopper
         -- set themselves must survive every subsequent sign-in.
         full_name   = COALESCE(NULLIF(users.full_name,  ''), EXCLUDED.full_name),
         avatar_url  = COALESCE(NULLIF(users.avatar_url, ''), EXCLUDED.avatar_url),
         -- provider is deliberately NOT overwritten. On a linked account it has to
         -- stay 'email', because /api/user/login matches on provider = 'email' —
         -- flipping it to 'google' would silently stop accepting the password the
         -- shopper still has and still expects to work.
         provider_id = CASE WHEN users.provider = 'google'
                            THEN EXCLUDED.provider_id ELSE users.provider_id END
       RETURNING id, email, full_name, avatar_url, provider`,
      [gUser.email, gUser.name, gUser.picture, gUser.id]
    );

    const user = rows[0];
    await createUserSession(req, res, user);
    res.redirect(`${FRONTEND_URL}/auth/callback`);
  } catch (err) {
    console.error('[google callback]', err);
    res.redirect(`${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(IS_PROD ? 'oauth_failed' : err.message)}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// FACEBOOK OAUTH
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/auth/facebook', (_req, res) => {
  if (!process.env.FACEBOOK_APP_ID)
    return res.status(500).json({ error: 'Facebook OAuth not configured. Set FACEBOOK_APP_ID.' });

  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  url.searchParams.set('client_id',     process.env.FACEBOOK_APP_ID);
  url.searchParams.set('redirect_uri',  `${BACKEND_URL}/api/auth/facebook/callback`);
  url.searchParams.set('scope',         'email,public_profile');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state',         issueOauthState(res));
  res.redirect(url.toString());
});

app.get('/api/auth/facebook/callback', async (req, res) => {
  if (!consumeOauthState(req, res)) return res.redirect(`${FRONTEND_URL}/auth/callback?error=state_mismatch`);
  const { code } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}/auth/callback?error=no_code`);

  try {
    const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id',     process.env.FACEBOOK_APP_ID);
    tokenUrl.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET);
    tokenUrl.searchParams.set('redirect_uri',  `${BACKEND_URL}/api/auth/facebook/callback`);
    tokenUrl.searchParams.set('code',          code);

    const tokenRes  = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token from Facebook');

    const userRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${tokenData.access_token}`
    );
    const fbUser = await userRes.json();

    const email     = fbUser.email || `fb_${fbUser.id}@noemail.local`;
    const avatarUrl = fbUser.picture?.data?.url || '';

    // Graph API doesn't expose a reliable "email verified" flag, so treat every
    // Facebook email as unverified proof of ownership: never merge into an
    // account that already exists under a different provider.
    const { rows: existingRows } = await pool.query(
      'SELECT provider FROM users WHERE email = $1', [email]
    );
    if (existingRows.length && existingRows[0].provider !== 'facebook') {
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=account_exists`);
    }

    const { rows } = await pool.query(
      // email_verified stays false: as noted above, Facebook gives us no reliable
      // proof of address ownership, and this may not even be a real address.
      `INSERT INTO users (email, full_name, avatar_url, provider, provider_id, email_verified)
       VALUES ($1, $2, $3, 'facebook', $4, false)
       ON CONFLICT (email) DO UPDATE SET
         full_name   = COALESCE(EXCLUDED.full_name,   users.full_name),
         avatar_url  = COALESCE(EXCLUDED.avatar_url,  users.avatar_url),
         provider    = 'facebook',
         provider_id = EXCLUDED.provider_id
       RETURNING id, email, full_name, avatar_url, provider`,
      [email, fbUser.name, avatarUrl, fbUser.id]
    );

    const user = rows[0];
    await createUserSession(req, res, user);
    res.redirect(`${FRONTEND_URL}/auth/callback`);
  } catch (err) {
    console.error('[facebook callback]', err);
    res.redirect(`${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(IS_PROD ? 'oauth_failed' : err.message)}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PHONE OTP
// ══════════════════════════════════════════════════════════════════════════════

const PHONE_RE = /^\+?[0-9\s().-]{6,20}$/;

app.post('/api/auth/phone/send-otp', otpSendLimiter, async (req, res) => {
  const { phone } = req.body;
  if (!phone || typeof phone !== 'string' || !PHONE_RE.test(phone.trim()))
    return res.status(400).json({ error: 'Please enter a valid phone number' });

  const otp       = sixDigitCode();
  const otpHash   = await bcrypt.hash(otp, 8);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  try {
    await pool.query(
      `INSERT INTO phone_otps (phone, otp, otp_hash, expires_at, attempts)
       VALUES ($1, $2, $2, $3, 0)
       ON CONFLICT (phone) DO UPDATE SET otp = $2, otp_hash = $2, expires_at = $3, attempts = 0`,
      [phone, otpHash, expiresAt]
    );

    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const { default: twilio } = await import('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: `Your The Olive Goose code: ${otp}. Expires in 10 minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to:   phone,
      });
      res.json({ success: true });
    } else {
      // Dev mode — return OTP in response so it can be shown in the UI.
      // Never in production: if Twilio env vars are missing on a prod deploy,
      // fail closed rather than leaking the code in the API response.
      console.log(`[DEV OTP] ${phone} → ${otp}`);
      res.json(IS_PROD ? { success: true } : { success: true, dev_otp: otp });
    }
  } catch (err) {
    sendServerError(res, err);
  }
});

app.post('/api/auth/phone/verify-otp', authLimiter, async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM phone_otps WHERE phone = $1',
      [phone]
    );
    if (!rows.length)         return res.status(400).json({ error: 'No OTP found for this number' });
    if (new Date() > new Date(rows[0].expires_at)) {
      await pool.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }
    if (rows[0].attempts >= 5) {
      await pool.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }

    const valid = await bcrypt.compare(String(otp).trim(), rows[0].otp_hash || '');
    if (!valid) {
      await pool.query('UPDATE phone_otps SET attempts = attempts + 1 WHERE phone = $1', [phone]);
      return res.status(400).json({ error: 'Invalid code. Try again.' });
    }

    await pool.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);

    const { rows: userRows } = await pool.query(
      // email_verified stays false: this account has no email address at all, and
      // one added later from the profile page is self-asserted, not verified.
      `INSERT INTO users (phone, provider, email_verified)
       VALUES ($1, 'phone', false)
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, email, phone, full_name, avatar_url, provider`,
      [phone]
    );
    const user = userRows[0];
    await createUserSession(req, res, user);
    res.json({ user });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CART
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/cart', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM user_carts WHERE user_id = $1 ORDER BY created_at ASC',
      [req.user.userId]
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

// Cart quantities are attacker-controlled input — without bounds, a negative
// value could be walked (via repeated adds) into an existing row to drag the
// checkout subtotal down, and an unbounded positive value has no real-world
// justification. 99 mirrors typical retail cart limits.
const MAX_CART_QTY = 99;
const isValidQty = (q) => Number.isInteger(q) && q >= 1 && q <= MAX_CART_QTY;

// Stripe refuses to create a Checkout Session whose total due is under €0.50
// ("amount_too_small"), so we have to catch that ourselves — the raw Stripe error
// is a 500 the shopper only ever sees as "Something went wrong". Mirrored by
// MIN_CHARGE_EUR in src/lib/cart.ts so the button explains it before it's clicked.
const MIN_CHARGE_EUR = 0.5;

app.post('/api/cart/items', requireUserAuth, async (req, res) => {
  const { product_id, product_data, quantity = 1 } = req.body;
  if (!product_id || !product_data)
    return res.status(400).json({ error: 'product_id and product_data required' });
  if (!isValidQty(quantity))
    return res.status(400).json({ error: `Quantity must be a whole number between 1 and ${MAX_CART_QTY}.` });
  try {
    const { rows } = await pool.query(
      `INSERT INTO user_carts (user_id, product_id, product_data, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, product_id) DO UPDATE
         SET quantity = LEAST(user_carts.quantity + $4, $5)
       RETURNING *`,
      [req.user.userId, product_id, JSON.stringify(product_data), quantity, MAX_CART_QTY]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    sendServerError(res, err);
  }
});

app.put('/api/cart/items/:productId', requireUserAuth, async (req, res) => {
  const { quantity } = req.body;
  if (quantity === undefined || !Number.isInteger(quantity))
    return res.status(400).json({ error: 'quantity must be a whole number' });
  if (quantity > MAX_CART_QTY)
    return res.status(400).json({ error: `Quantity can't exceed ${MAX_CART_QTY}.` });
  try {
    if (quantity <= 0) {
      // Setting to zero (or below) removes the item — same as the basket page's "remove" action.
      await pool.query(
        'DELETE FROM user_carts WHERE user_id = $1 AND product_id = $2',
        [req.user.userId, req.params.productId]
      );
    } else {
      await pool.query(
        'UPDATE user_carts SET quantity = $1 WHERE user_id = $2 AND product_id = $3',
        [quantity, req.user.userId, req.params.productId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.delete('/api/cart/items/:productId', requireUserAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM user_carts WHERE user_id = $1 AND product_id = $2',
      [req.user.userId, req.params.productId]
    );
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.delete('/api/cart', requireUserAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_carts WHERE user_id = $1', [req.user.userId]);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/checkout/session — start a Stripe Checkout for the current basket ──
// fulfillment_type: 'delivery' (default) ships to an address; 'pickup' collects
// from the configured store location instead, at the admin-configured discount.
// Nothing is written to `orders` here — the order only gets created once Stripe
// confirms payment (see finalizeCheckoutSession), so there's no way to end up
// with an order that was never paid for.
app.post('/api/checkout/session', requireUserAuth, checkoutLimiter, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Online payments are not configured yet.' });

  const fulfillmentType = req.body.fulfillment_type === 'pickup' ? 'pickup' : 'delivery';
  const addressOverride = req.body.shipping_address || {};
  const contactPhone    = req.body.contact_phone || '';
  // Hoisted so the total-guard and the catch block can release its hold if this
  // checkout fails after the code was reserved (see releaseDiscountReservation).
  let appliedCode = null;

  try {
    const { rows: cartRows } = await pool.query(
      'SELECT * FROM user_carts WHERE user_id = $1 ORDER BY created_at ASC',
      [req.user.userId]
    );
    if (!cartRows.length) return res.status(400).json({ error: 'Your basket is empty' });

    // Retire any earlier still-payable session for this shopper before we price a
    // new one, so only ever one checkout of theirs can be paid. Also what keeps a
    // shopper who abandoned a coded checkout from being locked out of their own
    // code by the live-checkout guard in reserveDiscountCode.
    await expirePriorCheckouts(req.user.userId);

    const { rows: userRows } = await pool.query(
      `SELECT email, full_name, phone, address_line1, address_line2, city, state, postal_code, country
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const profile = userRows[0] || {};

    const items = cartRows.map(r => ({
      product_id: r.product_id,
      product_data: r.product_data,
      quantity: r.quantity,
    }));

    // Authoritative price + stock gate — the one place every cart path (shop,
    // bundles, upsell nudges) funnels through before payment. `product_data` on
    // a cart row originates from the browser (POST /api/cart/items accepts it
    // as-is) and must never be trusted for pricing — a tampered request could
    // otherwise set an arbitrary price there and have it flow straight into the
    // Stripe charge. Re-snapshot every item from the real catalog here instead;
    // reject outright if a product was removed from the catalog since it was added.
    const { rows: catalogRows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_products'`);
    const catalog = catalogRows[0]?.value?.items || [];
    for (const i of items) {
      const catalogProduct = catalog.find(p => p.id === i.product_id);
      if (!catalogProduct) {
        return res.status(400).json({ error: 'One of the items in your basket is no longer available. Please remove it and try again.' });
      }
      i.product_data = { ...catalogProduct };
      if (catalogProduct.stock !== undefined && catalogProduct.stock !== null && i.quantity > Number(catalogProduct.stock)) {
        return res.status(400).json({
          error: Number(catalogProduct.stock) <= 0
            ? `${catalogProduct.name} is out of stock.`
            : `Only ${catalogProduct.stock} of ${catalogProduct.name} left — please lower the quantity in your basket.`,
        });
      }
    }

    const subtotal = items.reduce((sum, i) => sum + parsePrice(i.product_data?.price) * i.quantity, 0);

    const { rows: pickupRows } = await pool.query(
      `SELECT value FROM site_settings WHERE key = 'content_pickupSettings'`
    );
    const pickup = pickupRows[0]?.value || {};
    // Same ?? / isFinite treatment as the flat rate below: a threshold of 0 means
    // "free shipping on everything", and `|| 65` would quietly reinstate a €65 bar.
    // The storefront honours the raw 0, so the mismatch would show FREE in the
    // basket and still bill shipping at Stripe.
    const rawThreshold = Number(pickup.free_shipping_threshold);
    const freeShippingThreshold = Number.isFinite(rawThreshold) ? rawThreshold : 65;
    // Use ?? / isFinite (not ||) so an admin-set rate of 0 is honored — 0 is falsy.
    const rawFlatRate = Number(pickup.flat_shipping_rate);
    const flatShippingRate = Number.isFinite(rawFlatRate) ? rawFlatRate : 4.99;

    let shipping = 0;
    let discountPercent = 0;
    let shippingAddress = {};

    if (fulfillmentType === 'pickup') {
      if (!pickup.enabled) return res.status(400).json({ error: 'In-store pickup is not available right now.' });

      discountPercent = Number(pickup.discount_percent) || 0;
      // Someone has to be reachable when the order is ready to collect — the
      // shopper's own number if they gave one, otherwise the account's.
      const pickupPhone = toE164(contactPhone || profile.phone || '', pickup.country || 'Ireland');
      const pickupPhoneProblem = validatePhone(pickupPhone);
      if (pickupPhoneProblem) return res.status(400).json({ error: pickupPhoneProblem });

      shippingAddress = {
        fulfillment_type: 'pickup',
        location_name:   pickup.location_name || 'The Olive Goose',
        address_line1:   pickup.address_line1 || '',
        city:            pickup.city || 'Dublin 18',
        eircode:         pickup.eircode || '',
        country:         pickup.country || 'Ireland',
        hours:           pickup.hours || '',
        contact_name:    profile.full_name || '',
        contact_phone:   pickupPhone,
      };
    } else {
      shipping = subtotal >= freeShippingThreshold ? 0 : flatShippingRate;
      // Last gate before money moves: the address stored on the order is the one
      // dispatch prints, so it gets the full rules rather than a line1/city
      // presence check that let "4444, d" through to a picking slip.
      const merged = {
        full_name:      addressOverride.full_name ?? profile.full_name ?? '',
        phone:          addressOverride.phone ?? profile.phone ?? '',
        address_line1:  addressOverride.address_line1 ?? profile.address_line1 ?? '',
        address_line2:  addressOverride.address_line2 ?? profile.address_line2 ?? '',
        city:           addressOverride.city ?? profile.city ?? '',
        state:          addressOverride.state ?? profile.state ?? '',
        postal_code:    addressOverride.postal_code ?? profile.postal_code ?? '',
        country:        addressOverride.country ?? profile.country ?? '',
      };
      const addressProblem = validateAddress(merged);
      if (addressProblem) return res.status(400).json({ error: addressProblem });
      shippingAddress = { fulfillment_type: 'delivery', ...normalizeAddress(merged) };
    }

    // Today's Deals bundle savings — per-unit, non-overlapping allocation (same
    // algorithm the basket/checkout pages display), so what's shown matches what's
    // charged even when bundles share candles.
    const { rows: dealsRows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_deals'`);
    const bundles = dealsRows[0]?.value?.bundles || [];
    const { totalSavings: bundleSavings } = computeBundleSavings(bundles, items, catalog.map(p => p.id));

    // Welcome / subscriber discount code (optional). Reserved here so the hold is
    // in place before the shopper is handed to Stripe; it's only spent for good
    // once the order finalizes. An invalid or already-used code is a hard error —
    // never a silent full-price charge after the shopper applied one.
    let codeDiscountAmount = 0;
    if (req.body.discount_code) {
      const reservation = await reserveDiscountCode(req.body.discount_code, req.user.userId, null);
      if (!reservation.ok) return res.status(400).json({ error: reservation.message });
      appliedCode = reservation.code;
      codeDiscountAmount = computeCodeDiscount(reservation.discount_type, reservation.discount_value, subtotal);
    }

    const pickupDiscountAmount = subtotal * (discountPercent / 100);
    // Clamp the combined discount to the subtotal. Fixed codes are already capped
    // individually, but bundle savings aren't — so a generous stack (pickup % +
    // bundle + code) could otherwise exceed the order value and push the total
    // negative, hard-blocking an otherwise legitimate checkout.
    const discountAmount = +Math.min(pickupDiscountAmount + bundleSavings + codeDiscountAmount, subtotal).toFixed(2);
    const total = +(subtotal - discountAmount + shipping).toFixed(2);
    // Pickup is where a real basket meets Stripe's €0.50 floor: it drops the
    // shipping line, so a low-priced or heavily discounted basket that pays fine
    // for delivery has nothing left to carry it over the minimum. Answer with the
    // reason instead of letting Stripe's amount_too_small surface as a blank 500.
    if (total <= 0 || total < MIN_CHARGE_EUR) {
      if (appliedCode) await releaseDiscountReservation(appliedCode, req.user.userId);
      return res.status(400).json({
        error: total <= 0
          ? 'Order total must be greater than zero.'
          : `Card payments need a total of at least €${MIN_CHARGE_EUR.toFixed(2)} — yours comes to €${total.toFixed(2)}. Please add another item to your basket.`,
      });
    }
    const trackingNumber = genTrackingNumber();

    const line_items = items.map(i => ({
      price_data: {
        currency: 'eur',
        product_data: { name: String(i.product_data?.name || 'Candle').slice(0, 500) },
        unit_amount: Math.round(parsePrice(i.product_data?.price) * 100),
      },
      quantity: i.quantity,
    }));
    if (shipping > 0) {
      line_items.push({
        price_data: { currency: 'eur', product_data: { name: 'Shipping' }, unit_amount: Math.round(shipping * 100) },
        quantity: 1,
      });
    }

    // Stripe computes the discount itself from a coupon rather than us pre-discounting
    // each line item. An amount-off coupon (vs. percent-off) lets pickup discount and
    // bundle savings combine into a single figure that matches our `discountAmount`
    // to the cent regardless of how it was made up.
    let discounts;
    if (discountAmount > 0) {
      const coupon = await stripe.coupons.create({ amount_off: Math.round(discountAmount * 100), currency: 'eur', duration: 'once' });
      discounts = [{ coupon: coupon.id }];
    }

    // Analytics session ids ride along so the purchase event written when the
    // order finalizes (finalizeCheckoutSession) can be attributed to the same
    // browsing session that started checkout. Validated here; absent is fine.
    // The GA4 pair rides along too, when that tag is running in the shopper's
    // browser — it is what lets the server-written purchase land in the same GA4
    // session as the browsing that produced it. Absent is the normal case (GA4
    // off, or cookies declined) and reports nothing to Google. See
    // reportPurchaseToGa4.
    const analyticsIds = {
      visitor_id: analyticsId(req.body.analytics?.visitor_id),
      session_id: analyticsId(req.body.analytics?.session_id),
      ga_client_id: gaClientId(req.body.analytics?.ga_client_id),
      ga_session_id: gaSessionId(req.body.analytics?.ga_session_id),
      // The Meta half. `meta_consent` is the browser's own answer to "was the
      // pixel allowed to run for this person" — see getMetaIds in
      // src/lib/meta.ts — and reportPurchaseToMeta sends nothing without it.
      meta_consent: req.body.analytics?.meta_consent === true ? true : undefined,
      fbp: metaBrowserId(req.body.analytics?.fbp),
      fbc: metaBrowserId(req.body.analytics?.fbc),
      // CAPTURED HERE, FROM THE SHOPPER'S OWN REQUEST, and stored — not read
      // later. The purchase is reported from the Stripe webhook, where `req` is
      // Stripe's: its user agent is `Stripe/1.0` and its address is a datacentre.
      // Sending those to Meta would describe every customer this shop has as the
      // same bot in the same building, which is worse than sending nothing — it
      // actively poisons the match.
      ua: clip(req.headers['user-agent'], 500) || undefined,
      // The address, ONLY if the edge vouched for it — and today it does not on
      // this route, so this is normally absent and Meta gets no IP at all.
      //
      // That is deliberate, and it is the safe answer rather than a gap. In
      // production this app sits behind two proxies, so `req.ip` here is
      // Netlify's egress address: THE SAME VALUE FOR EVERY SHOPPER. Handing that
      // to Meta as "the customer's IP" would tell it that every order this shop
      // has ever taken came from one machine — which is not a missing signal but
      // a false one, and false is the direction that quietly ruins a match rate.
      // The same trap has already been documented twice in this file (see the
      // analytics limiter's key and edgeClientIp); this is the third door into it.
      //
      // netlify/edge-functions/analytics-geo.ts is the only thing that can state
      // a real client address, and it is bound to the analytics routes on purpose
      // — keeping checkout out of any edge code that could take the till down. If
      // that trade is ever revisited, adding '/api/checkout/session' to its
      // `config.path` is all this line needs.
      ip: edgeClientIp(req) || undefined,
      // The page the shopper was on when they started checkout. Meta checks it
      // against the pixel's own domain.
      source_url: `${FRONTEND_URL}/checkout`,
    };

    const payload = {
      items, subtotal, shipping, total, tracking_number: trackingNumber,
      shipping_address: shippingAddress, fulfillment_type: fulfillmentType,
      discount_percent: discountPercent, discount_amount: discountAmount,
      discount_code: appliedCode,
      analytics: analyticsIds,
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // No explicit payment_method_types → Stripe Checkout offers every method
      // enabled in the Dashboard (Settings → Payment methods) that's eligible for
      // the customer's country and this EUR charge: cards + Apple/Google Pay always,
      // plus Link / Klarna / iDEAL / Bancontact / SEPA etc. once toggled on there.
      // Some of those settle asynchronously, which is safe here: the order is only
      // created once the webhook/poll sees payment_status: 'paid' (finalizeCheckoutSession).
      customer_email: profile.email || undefined,
      line_items,
      discounts,
      success_url: `${FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/checkout?canceled=true`,
    });

    await pool.query(
      `INSERT INTO pending_checkouts (user_id, stripe_session_id, payload) VALUES ($1, $2, $3)`,
      [req.user.userId, session.id, JSON.stringify(payload)]
    );

    res.status(201).json({ url: session.url });
  } catch (err) {
    // The code was reserved but this checkout failed (Stripe/session/DB error) —
    // free the hold so the shopper can retry immediately instead of hitting
    // "being used in another checkout" for the next 30 minutes.
    if (appliedCode) await releaseDiscountReservation(appliedCode, req.user.userId);
    sendServerError(res, err);
  }
});

// ── GET /api/checkout/session/:sessionId — poll after redirect back from Stripe ──
// Finalizes the order if Stripe confirms payment (acts as a fallback to the
// webhook so this works in dev without STRIPE_WEBHOOK_SECRET configured).
app.get('/api/checkout/session/:sessionId', requireUserAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Online payments are not configured yet.' });
  try {
    const { rows: pendingRows } = await pool.query(
      'SELECT id FROM pending_checkouts WHERE stripe_session_id = $1 AND user_id = $2',
      [req.params.sessionId, req.user.userId]
    );
    if (!pendingRows.length) return res.status(404).json({ error: 'Checkout session not found' });

    const order = await finalizeCheckoutSession(req.params.sessionId);
    res.json(order || { pending: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/orders — order history, most recent first ──────────────────────
app.get('/api/orders', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    res.json(rows.map(withTracking));
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/orders/:id — single order + tracking + timeline ────────────────
app.get('/api/orders/:id', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const { rows: events } = await pool.query(
      `SELECT id, type, title, detail, meta, created_at FROM order_events
       WHERE order_id = $1 AND customer_visible = true ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ ...withTracking(rows[0]), timeline: events });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/orders/:id/cancel — customer requests cancellation ────────────
// Only allowed while the order is still early in its pipeline (see isCancellable).
// This just files the request — an admin reviews and decides (see
// PUT /api/admin/orders/:id/cancellation) so nothing is cancelled automatically.
app.post('/api/orders/:id/cancel', requireUserAuth, async (req, res) => {
  const reason = safeText(req.body.reason);
  try {
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = rows[0];
    if (!isCancellable(order))
      return res.status(400).json({ error: 'This order can no longer be cancelled online. Please start a return instead once it arrives.' });

    await pool.query(
      `UPDATE orders SET cancellation_status = 'requested', cancellation_reason = $1, cancellation_requested_at = NOW() WHERE id = $2`,
      [reason, order.id]
    );
    await addOrderEvent(order.id, { type: 'cancellation_requested', actor: 'customer', title: 'Cancellation requested', detail: reason });

    if (req.user.email) {
      sendCancellationRequestedEmail(req.user.email, { trackingNumber: order.tracking_number }).catch(err => console.error('[sendCancellationRequestedEmail]', err));
    }
    if (process.env.ADMIN_EMAIL) {
      sendCancellationRequestAdminAlert(process.env.ADMIN_EMAIL, { trackingNumber: order.tracking_number, userEmail: req.user.email, reason })
        .catch(err => console.error('[sendCancellationRequestAdminAlert]', err));
    }

    const { rows: updated } = await pool.query('SELECT * FROM orders WHERE id = $1', [order.id]);
    res.json(withTracking(updated[0]));
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/admin/orders (admin only) — all orders across all users ────────
// Most recent customer-visible event per order, so the admin can see at a
// glance whether — and what — the customer was last told, without opening
// each order's timeline.
const LAST_NOTIFICATION_JOIN = `
  LEFT JOIN LATERAL (
    SELECT type, title, created_at FROM order_events
    WHERE order_id = o.id AND customer_visible = true
    ORDER BY created_at DESC LIMIT 1
  ) le ON true`;

app.get('/api/admin/orders', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, u.email AS user_email, u.full_name AS user_name,
              le.type AS last_notification_type, le.title AS last_notification_title, le.created_at AS last_notification_at
       FROM orders o JOIN users u ON u.id = o.user_id
       ${LAST_NOTIFICATION_JOIN}
       ORDER BY o.created_at DESC`
    );
    res.json(rows.map(withTracking));
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── PUT /api/admin/orders/:id (admin only) — update tracking status ─────────
app.put('/api/admin/orders/:id', requireAuth, async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT o.*, u.email AS user_email, u.full_name AS user_name
       FROM orders o JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });

    const stages = stagesFor(rows[0]);
    if (!stages.includes(status)) return res.status(400).json({ error: 'Invalid status for this order type' });

    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    if (status !== rows[0].status) {
      await addOrderEvent(req.params.id, { type: 'status_changed', actor: 'admin', title: `Status: ${status}`, meta: { status } });
      sendOrderStatusUpdateEmail(rows[0].user_email, {
        trackingNumber: rows[0].tracking_number, status, orderUrl: `${FRONTEND_URL}/orders/${req.params.id}`,
      }).catch(err => console.error('[sendOrderStatusUpdateEmail]', err));
    }
    res.json(withTracking({ ...rows[0], status }));
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── PUT /api/admin/orders/:id/payment-status (admin only) ───────────────────
// Marks an order paid/unpaid for payments settled outside Stripe — e.g. a
// pickup order paid by cash or card in store. Orders that went through Stripe
// carry a payment intent and are managed automatically, so they can't be
// flipped here (that would desync refunds, which key off payment_status).
app.put('/api/admin/orders/:id/payment-status', requireAuth, async (req, res) => {
  const { payment_status } = req.body;
  if (!['paid', 'unpaid'].includes(payment_status)) {
    return res.status(400).json({ error: 'payment_status must be paid or unpaid' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT o.*, u.email AS user_email, u.full_name AS user_name
       FROM orders o JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = rows[0];

    if (order.stripe_payment_intent_id) {
      return res.status(400).json({ error: 'This order was paid through Stripe — its payment status is managed automatically.' });
    }
    if (order.payment_status !== payment_status) {
      await pool.query('UPDATE orders SET payment_status = $1 WHERE id = $2', [payment_status, req.params.id]);
      await addOrderEvent(req.params.id, {
        type: 'payment_status_changed', actor: 'admin',
        title: payment_status === 'paid' ? 'Payment received' : 'Marked as unpaid',
        detail: payment_status === 'paid' ? 'Marked as paid by admin (settled in store / outside Stripe)' : 'Payment status reverted by admin',
        meta: { payment_status }, customerVisible: false,
      });
    }
    res.json(withTracking({ ...order, payment_status }));
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/admin/orders/:id (admin only) — full detail + timeline ─────────
app.get('/api/admin/orders/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, u.email AS user_email, u.full_name AS user_name
       FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const { rows: events } = await pool.query(
      `SELECT id, type, actor, title, detail, meta, customer_visible, created_at
       FROM order_events WHERE order_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    const { rows: refunds } = await pool.query(
      `SELECT * FROM refund_reminders WHERE order_id = $1 ORDER BY created_at DESC`, [req.params.id]
    );
    res.json({ ...withTracking(rows[0]), timeline: events, refund_reminders: refunds });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── PUT /api/admin/orders/:id/cancellation (admin only) — approve/reject ────
// Human-in-the-loop decision on a customer's cancellation request. Approving a
// paid order starts the refund-reminder clock (see refund_reminders) — the
// actual refund is still done manually, this just makes sure it isn't forgotten.
app.put('/api/admin/orders/:id/cancellation', requireAuth, async (req, res) => {
  const { decision } = req.body;
  const note = safeText(req.body.note);
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });
  try {
    const { rows } = await pool.query(
      `SELECT o.*, u.email AS user_email, u.full_name AS user_name
       FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = rows[0];
    if (order.cancellation_status !== 'requested')
      return res.status(400).json({ error: 'No pending cancellation request on this order' });

    if (decision === 'approved') {
      const needsRefund = order.payment_status === 'paid';
      await pool.query(
        `UPDATE orders SET status = 'Cancelled', cancellation_status = 'approved', refund_status = $1 WHERE id = $2`,
        [needsRefund ? 'pending' : 'not_applicable', order.id]
      );
      if (needsRefund) {
        await pool.query(
          `INSERT INTO refund_reminders (order_id, source, source_id, eligible_at) VALUES ($1, 'cancellation', $2, NOW())`,
          [order.id, order.id]
        );
      }
      await addOrderEvent(order.id, { type: 'cancellation_approved', actor: 'admin', title: 'Cancellation approved', detail: note });
      sendCancellationDecisionEmail(order.user_email, { trackingNumber: order.tracking_number, decision, note }).catch(err => console.error('[sendCancellationDecisionEmail]', err));
    } else {
      await pool.query(`UPDATE orders SET cancellation_status = 'rejected' WHERE id = $1`, [order.id]);
      await addOrderEvent(order.id, { type: 'cancellation_rejected', actor: 'admin', title: 'Cancellation rejected', detail: note });
      sendCancellationDecisionEmail(order.user_email, { trackingNumber: order.tracking_number, decision, note }).catch(err => console.error('[sendCancellationDecisionEmail]', err));
    }

    const { rows: updated } = await pool.query(
      `SELECT o.*, u.email AS user_email, u.full_name AS user_name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [order.id]
    );
    res.json(withTracking(updated[0]));
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── PUT /api/admin/orders/:id/refund-status (admin only) — resolve a refund ──
// When `refund_automation_enabled` is off (the default), the refund is done by
// hand (Stripe dashboard / bank) and this just stops the reminder clock. When
// it's on, this actually calls Stripe first — a failed charge never gets marked done.
app.put('/api/admin/orders/:id/refund-status', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = rows[0];
    if (order.refund_status !== 'pending') return res.status(400).json({ error: 'No refund pending on this order' });

    const settings = await getAutomationSettings();
    let viaStripe = false;
    if (settings.refund_automation_enabled && order.stripe_payment_intent_id) {
      try {
        await refundViaStripe(order.stripe_payment_intent_id, Math.round(Number(order.total) * 100), `order-refund:${order.id}`);
        viaStripe = true;
      } catch (err) {
        return res.status(502).json({ error: `Stripe refund failed: ${err.message}` });
      }
    }

    await pool.query(`UPDATE orders SET refund_status = 'refunded' WHERE id = $1`, [order.id]);
    await pool.query(
      `UPDATE refund_reminders SET resolved_at = NOW() WHERE source = 'cancellation' AND source_id = $1 AND resolved_at IS NULL`,
      [order.id]
    );
    await addOrderEvent(order.id, { type: 'refund_completed', actor: 'admin', title: viaStripe ? 'Refund processed via Stripe' : 'Refund marked as completed' });
    // The rest of the order comes back out of Google's revenue, as it already
    // comes out of ours. Fire-and-forget: a measurement call must never fail a
    // refund.
    //
    // "The rest", not "the whole", because a line may already have been refunded
    // through a return — and GA4 SUMS refunds against a transaction rather than
    // replacing them. Sending the full total after a partial would take more out
    // of Google's revenue than the shop ever took in, and the figure would be
    // wrong in the flattering direction with nothing to reveal it. Stripe would
    // have capped the money at the charge; this caps the measurement to match.
    reportRefundToGa4(order.id, { value: await unrefundedTotal(order) })
      .catch(err => console.error('[ga4 refund]', err));
    sendRefundCompletedEmail(order.user_email, { trackingNumber: order.tracking_number }).catch(err => console.error('[sendRefundCompletedEmail]', err));
    res.json({ success: true, via_stripe: viaStripe });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── Reusable: email the customer about an order + log it to the timeline ────
// Used by the direct admin "message customer" route below and by decision
// approval (a stuck-order follow-up suggestion executes the same way).
const sendAdminMessageToOrder = async (orderId, subject, body) => {
  const { rows } = await pool.query(
    `SELECT o.*, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
    [orderId]
  );
  if (!rows.length) { const e = new Error('Order not found'); e.status = 404; throw e; }
  const order = rows[0];
  await sendCustomerMessageEmail(order.user_email, { subject, body, trackingNumber: order.tracking_number });
  await addOrderEvent(order.id, { type: 'message', actor: 'admin', title: subject, detail: body, meta: { subject, body }, customerVisible: true });
};

// ── POST /api/admin/orders/:id/message (admin only) — email the customer ────
// The human-in-the-loop step the whole lifecycle builds toward: once a decision
// is made, the admin can tell the customer about it directly from here.
app.post('/api/admin/orders/:id/message', requireAuth, async (req, res) => {
  const subject = safeText(req.body.subject, 200);
  const body = safeText(req.body.body, 5000);
  if (!subject || !body) return res.status(400).json({ error: 'subject and body are required' });
  try {
    await sendAdminMessageToOrder(req.params.id, subject, body);
    res.status(201).json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// RETURNS
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/returns — request a return for an item on a past order ────────
app.post('/api/returns', requireUserAuth, async (req, res) => {
  const { order_id, product_id } = req.body;
  const reason = safeText(req.body.reason);
  if (!order_id || !product_id || !reason)
    return res.status(400).json({ error: 'order_id, product_id and reason are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise requests for the same order line. A double-tap or parallel
    // request must not create two return records that two admins could later
    // each refund. PostgreSQL advisory locks work across every app instance.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`return:${req.user.userId}:${order_id}:${product_id}`]
    );
    const { rows: orderRows } = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [order_id, req.user.userId]
    );
    if (!orderRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    const order = orderRows[0];
    if (order.payment_status !== 'paid' || !withTracking(order).tracking.delivered) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Returns can be requested after a paid order has been delivered or collected.' });
    }

    const item = (order.items || []).find(i => i.product_id === product_id);
    if (!item) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That item is not part of this order' });
    }

    const { rows: existing } = await client.query(
      `SELECT id FROM returns
       WHERE order_id = $1 AND user_id = $2 AND product_id = $3
         AND status IN ('requested', 'approved', 'refunded')
       LIMIT 1`,
      [order_id, req.user.userId, product_id]
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A return for this item is already in progress or has been completed.' });
    }

    const { rows } = await client.query(
      `INSERT INTO returns (order_id, user_id, product_id, product_name, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [order_id, req.user.userId, product_id, item.product_data?.name || '', reason]
    );
    const ret = rows[0];
    await client.query('COMMIT');

    await addOrderEvent(order_id, {
      type: 'return_requested', actor: 'customer', title: `Return requested: ${ret.product_name}`,
      detail: reason, meta: { return_id: ret.id },
    });
    if (req.user.email) {
      sendReturnRequestedEmail(req.user.email, { productName: ret.product_name, trackingNumber: order.tracking_number })
        .catch(err => console.error('[sendReturnRequestedEmail]', err));
    }
    getAutomationSettings().then(settings => evaluateReturnDecision(ret, order, settings)).catch(err => console.error('[evaluateReturnDecision]', err));

    res.status(201).json(ret);
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {});
    sendServerError(res, err);
  } finally {
    client?.release();
  }
});

// ── GET /api/returns — the current user's return requests ───────────────────
app.get('/api/returns', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM returns WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/admin/returns (admin only) ──────────────────────────────────────
app.get('/api/admin/returns', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.email AS user_email, u.full_name AS user_name,
              le.type AS last_notification_type, le.title AS last_notification_title, le.created_at AS last_notification_at
       FROM returns r JOIN users u ON u.id = r.user_id
       LEFT JOIN LATERAL (
         SELECT type, title, created_at FROM order_events
         WHERE customer_visible = true AND meta->>'return_id' = r.id::text
         ORDER BY created_at DESC LIMIT 1
       ) le ON true
       ORDER BY r.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

/**
 * What is still left to refund on an order — its total, less anything already
 * refunded through a return. Never below zero.
 */
const unrefundedTotal = async (order) => {
  const { rows } = await pool.query(
    `SELECT product_id FROM returns WHERE order_id = $1 AND status = 'refunded'`,
    [order.id]
  );
  if (!rows.length) return Number(order.total);
  const already = rows.reduce((sum, r) => {
    const line = (order.items || []).find(i => i.product_id === r.product_id);
    if (!line) return sum;
    return sum + parsePrice(line.product_data?.price) * (Number(line.quantity) || 1);
  }, 0);
  return Math.max(0, +(Number(order.total) - already).toFixed(2));
};

/** Price one returned line off the order it belongs to, then report it to GA4. */
const reportPartialRefundForReturn = async (ret) => {
  const { rows } = await pool.query('SELECT items FROM orders WHERE id = $1', [ret.order_id]);
  const line = (rows[0]?.items || []).find(i => i.product_id === ret.product_id);
  if (!line) return;
  const price = parsePrice(line.product_data?.price);
  const quantity = Number(line.quantity) || 1;
  await reportRefundToGa4(ret.order_id, {
    value: +(price * quantity).toFixed(2),
    items: [{
      item_id: String(ret.product_id),
      item_name: String(line.product_data?.name ?? ret.product_name ?? '').slice(0, 100),
      price,
      quantity,
    }],
  });
};

// ── Reusable: change a return's status (+ refund-reminder clock, event, email) ─
// Used by the direct admin PUT route below and by decision approval (a
// return_approve_suggested/return_reject_suggested decision executes this).
// When transitioning to 'refunded' with refund_automation_enabled on, this
// calls Stripe for the specific item's amount first — a failed charge throws
// and the status is never updated.
const applyReturnStatusChange = async (returnId, status) => {
  if (!['requested', 'approved', 'rejected', 'refunded'].includes(status)) {
    const e = new Error('Invalid status'); e.status = 400; throw e;
  }
  const { rows: existing } = await pool.query(
    `SELECT r.*, u.email AS user_email FROM returns r JOIN users u ON u.id = r.user_id WHERE r.id = $1`,
    [returnId]
  );
  if (!existing.length) { const e = new Error('Return not found'); e.status = 404; throw e; }
  const prevStatus = existing[0].status;
  // Refunded is terminal — once the customer's been told (and possibly actually
  // refunded via Stripe), it can't be silently flipped again from under them.
  if (prevStatus === 'refunded') {
    const e = new Error('This return has already been refunded and can\'t be changed further.'); e.status = 400; throw e;
  }
  let viaStripe = false;

  if (status === 'refunded' && prevStatus !== 'refunded') {
    const settings = await getAutomationSettings();
    if (settings.refund_automation_enabled) {
      const { rows: orderRows } = await pool.query('SELECT * FROM orders WHERE id = $1', [existing[0].order_id]);
      const order = orderRows[0];
      if (order?.payment_status === 'paid' && order.stripe_payment_intent_id) {
        const item = (order.items || []).find(i => i.product_id === existing[0].product_id);
        const amount = item ? parsePrice(item.product_data?.price) * item.quantity : 0;
        if (amount > 0) {
          try {
            await refundViaStripe(order.stripe_payment_intent_id, amount * 100, `return-refund:${returnId}`);
            viaStripe = true;
          } catch (err) {
            const e = new Error(`Stripe refund failed: ${err.message}`); e.status = 502; throw e;
          }
        }
      }
    }
  }

  const { rows } = await pool.query('UPDATE returns SET status = $1 WHERE id = $2 RETURNING *', [status, returnId]);
  const ret = rows[0];

  if (status !== prevStatus) {
    if (status === 'approved') {
      await pool.query(
        `INSERT INTO refund_reminders (order_id, source, source_id, eligible_at) VALUES ($1, 'return', $2, NOW())`,
        [ret.order_id, ret.id]
      );
    }
    if (status !== 'approved') {
      // Moving away from 'approved' (to refunded, rejected, or back to
      // requested) always means no refund is currently owed — stop the
      // reminder clock either way so a rejected return never shows "refund due".
      await pool.query(
        `UPDATE refund_reminders SET resolved_at = NOW() WHERE source = 'return' AND source_id = $1 AND resolved_at IS NULL`,
        [ret.id]
      );
    }
    await addOrderEvent(ret.order_id, {
      type: 'return_status_changed', actor: 'admin',
      title: `Return ${status}${viaStripe ? ' (refunded via Stripe)' : ''}: ${ret.product_name}`,
      meta: { return_id: ret.id, status },
    });
    if (status === 'refunded') {
      // One line, not the order — a partial refund in GA4's terms. Priced from
      // the order's own snapshot so it matches what was actually charged for
      // that line, which is the figure our own revenue query removes.
      reportPartialRefundForReturn(ret).catch(err => console.error('[ga4 refund]', err));
    }
    sendReturnDecisionEmail(existing[0].user_email, { productName: ret.product_name, status }).catch(err => console.error('[sendReturnDecisionEmail]', err));
  }
  return ret;
};

// ── PUT /api/admin/returns/:id (admin only) — update return status ──────────
app.put('/api/admin/returns/:id', requireAuth, async (req, res) => {
  try {
    const ret = await applyReturnStatusChange(req.params.id, req.body.status);
    res.json(ret);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DECISIONS — the admin approval queue for the automated suggestion engine
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/decisions (admin only) — pending suggestions ─────────────
app.get('/api/admin/decisions', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, o.tracking_number, r.product_name AS return_product_name
       FROM admin_decisions d
       LEFT JOIN orders o ON o.id = d.order_id
       LEFT JOIN returns r ON r.id = d.return_id
       WHERE d.status = 'pending'
       ORDER BY d.created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/admin/decisions/resolved (admin only) — history ────────────────
// So an admin can confirm what was already approved/dismissed (and when)
// instead of a resolved decision just silently vanishing from the queue.
app.get('/api/admin/decisions/resolved', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, o.tracking_number, r.product_name AS return_product_name
       FROM admin_decisions d
       LEFT JOIN orders o ON o.id = d.order_id
       LEFT JOIN returns r ON r.id = d.return_id
       WHERE d.status != 'pending'
       ORDER BY d.resolved_at DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/admin/decisions/:id/approve (admin only) — execute the suggestion ─
// Dispatches to the same reusable functions the manual admin actions call —
// approving a suggestion takes exactly the action a human would have taken by hand.
app.post('/api/admin/decisions/:id/approve', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM admin_decisions WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Decision not found' });
    const decision = rows[0];
    if (decision.status !== 'pending') return res.status(400).json({ error: 'This decision was already resolved' });

    const action = decision.suggested_action || {};
    switch (action.type) {
      case 'update_return_status':
        await applyReturnStatusChange(action.return_id, action.status);
        break;
      case 'send_message':
        await sendAdminMessageToOrder(decision.order_id, action.subject, action.body);
        break;
      case 'notify_subscribers_back_in_stock': {
        const { rows: subs } = await pool.query('SELECT email FROM subscribers');
        for (const s of subs) {
          sendBackInStockEmail(s.email, { productName: action.product_name }).catch(err => console.error('[sendBackInStockEmail]', err));
        }
        break;
      }
      case 'acknowledge':
      default:
        break; // fraud_review and unknown types just get marked resolved below
    }

    await pool.query(`UPDATE admin_decisions SET status = 'approved', resolved_at = NOW() WHERE id = $1`, [decision.id]);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/admin/decisions/:id/dismiss (admin only) — take no action ─────
app.post('/api/admin/decisions/:id/dismiss', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE admin_decisions SET status = 'dismissed', resolved_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Decision not found or already resolved' });
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/admin/ops-overview (admin only) — fulfillment/inventory/marketing ──
// Read-only aggregation over data this feature already tracks (or that already
// existed) — no separate automation, just surfacing what needs attention.
app.get('/api/admin/ops-overview', requireAuth, async (_req, res) => {
  try {
    const settings = await getAutomationSettings();

    const { rows: stuckOrders } = await pool.query(
      `SELECT o.id, o.tracking_number, o.status, o.created_at, u.email AS user_email, u.full_name AS user_name
       FROM orders o JOIN users u ON u.id = o.user_id
       WHERE o.status NOT IN ('Delivered', 'Picked Up', 'Cancelled')
         AND o.created_at < NOW() - ($1 || ' days')::interval
       ORDER BY o.created_at ASC`,
      [String(Number(settings.stuck_order_days) || 3)]
    );

    const { rows: pendingCancellations } = await pool.query(
      `SELECT o.id, o.tracking_number, o.cancellation_requested_at, o.cancellation_reason, u.email AS user_email, u.full_name AS user_name
       FROM orders o JOIN users u ON u.id = o.user_id WHERE o.cancellation_status = 'requested'
       ORDER BY o.cancellation_requested_at ASC`
    );

    const { rows: pendingReturnsRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM returns WHERE status = 'requested'`);

    const { rows: refundsDue } = await pool.query(
      `SELECT rr.id, rr.order_id, rr.source, rr.source_id, rr.eligible_at, rr.reminders_sent,
              o.tracking_number, o.total, u.email AS user_email, u.full_name AS user_name
       FROM refund_reminders rr
       JOIN orders o ON o.id = rr.order_id
       JOIN users u ON u.id = o.user_id
       WHERE rr.resolved_at IS NULL
       ORDER BY rr.eligible_at ASC`
    );

    const { rows: productsRows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_products'`);
    const products = productsRows[0]?.value?.items || [];
    const lowStockThreshold = Number(settings.low_stock_threshold) || 5;
    const lowStockProducts = products.filter(p => p.stock !== undefined && p.stock !== null && Number(p.stock) <= lowStockThreshold);

    const { rows: subscriberStatsRows } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE subscribed_at > NOW() - INTERVAL '7 days')::int AS new_7d,
              COUNT(*) FILTER (WHERE subscribed_at > NOW() - INTERVAL '30 days')::int AS new_30d
       FROM subscribers`
    );

    // Underperforming bundles — active bundles matched by zero orders in the
    // configured window. Small order volume at this scale, so a JS scan over
    // recent orders is simpler than a JSONB-array SQL query and plenty fast.
    const { rows: dealsRows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_deals'`);
    const bundles = dealsRows[0]?.value?.bundles || [];
    const bundleWindowDays = Number(settings.underperforming_bundle_days) || 30;
    const { rows: recentOrders } = await pool.query(
      `SELECT items FROM orders WHERE created_at > NOW() - ($1 || ' days')::interval`,
      [String(bundleWindowDays)]
    );
    const underperformingBundles = bundles.filter(b => {
      if (!b.is_active || !b.product_ids?.length) return false;
      return !recentOrders.some(o => bundleIsSatisfied(b, o.items || []));
    }).map(b => ({ id: b.id, name: b.name }));

    res.json({
      settings,
      stuck_orders: stuckOrders,
      pending_cancellations: pendingCancellations,
      pending_returns_count: pendingReturnsRows[0]?.count || 0,
      refunds_due: refundsDue.map(r => ({ ...r, days_elapsed: Math.floor((Date.now() - new Date(r.eligible_at).getTime()) / 86400000) })),
      low_stock_products: lowStockProducts,
      subscriber_stats: subscriberStatsRows[0],
      underperforming_bundles: underperformingBundles,
    });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════════════════════════════════════════════

// Events the browser is allowed to report. 'purchase' is deliberately absent —
// it's written server-side in finalizeCheckoutSession from the Stripe-confirmed
// order, so revenue/conversion numbers can't be inflated by hand-crafted requests.
// Allowlist for ingest — anything not named here is dropped silently, so a new
// client event MUST be added here or it never reaches the database. Mirrors
// EventType in src/lib/analytics.ts; the names are GA4's so the shop dashboard
// and GA4 can be read side by side.
const CLIENT_EVENT_TYPES = new Set([
  'page_view', 'view_item_list', 'select_item', 'view_item',
  'add_to_cart', 'remove_from_cart', 'view_cart',
  'checkout_gate', 'begin_checkout', 'add_shipping_info', 'add_payment_info',
  'search', 'user_engagement', 'newsletter_signup', 'signup', 'login', 'web_vital',
]);

// Client-generated opaque ids (crypto.randomUUID or similar) — anything else is
// dropped so junk can't be smuggled into GROUP BY keys.
const ANALYTICS_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const analyticsId = (v) => (typeof v === 'string' && ANALYTICS_ID_RE.test(v) ? v : null);
const clip = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// ── Google Analytics 4, server side ───────────────────────────────────────────
//
// The browser's gtag.js reports everything a browser can see. It cannot report
// the purchase: by the time Stripe confirms payment the shopper has been
// redirected to Stripe's domain, and whether they ever land back on the success
// page is not something revenue figures can depend on. A shopper who pays and
// then closes the tab has bought something, and both measurement systems must
// say so.
//
// So 'purchase' reaches GA4 the same way it reaches our own tables: written
// here, once, from the Stripe-confirmed order — via the Measurement Protocol,
// GA4's server-to-server endpoint. The browser's contribution is only the pair
// of ids it forwarded at checkout (see getGaIds in src/lib/ga.ts), which is what
// lets Google file this purchase under the session that led to it instead of as
// a stranger appearing at the till.
//
// Two ids, two homes, on purpose:
//   - the MEASUREMENT ID is public — it ships in the page source of every site
//     that uses GA4 — so it lives in content_googleAnalytics with the rest of
//     the owner's settings and is served by the public /api/content route.
//   - the API SECRET is a credential. It is stored under a key WITHOUT the
//     `content_` prefix, which is the whole reason it can't leak: /api/content
//     and /api/content/:section both filter on that prefix, so no route the
//     storefront can call will ever return it.

const GA4_SECRET_KEY = 'ga4_api_secret';
const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
// Same payload, but Google answers with what it thinks of it instead of 204.
// Used by the admin panel's "Send a test event" button — a silent 204 is not
// evidence that anything was configured correctly.
const GA4_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';

// GA4's own id formats, from the cookies gtag.js writes: `_ga` yields
// "1234567890.1700000000" and the per-stream cookie a plain timestamp. Neither
// passes ANALYTICS_ID_RE (the dot), so they get their own guards rather than a
// loosened shared one.
const gaClientId = (v) => (typeof v === 'string' && /^\d{1,20}\.\d{1,20}$/.test(v) ? v : null);
const gaSessionId = (v) => (typeof v === 'string' && /^\d{1,20}$/.test(v) ? v : null);
const gaMeasurementId = (v) => (typeof v === 'string' && /^G-[A-Z0-9]{4,}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null);

/** The owner's GA4 settings, as saved in Admin → Analytics → Google Analytics. */
const getGoogleAnalyticsSettings = async () => {
  const { rows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_googleAnalytics'`);
  const v = rows[0]?.value || {};
  return {
    enabled: v.enabled === true,
    measurementId: gaMeasurementId(v.measurement_id) || '',
    trackEcommerce: v.track_ecommerce !== false,
    debugMode: v.debug_mode === true,
  };
};

/**
 * The Measurement Protocol API secret, from the environment if it is set there.
 *
 * Env var first, deliberately, because that is where a credential belongs and it
 * is the pattern this server already uses for STRIPE_SECRET_KEY and JWT_SECRET:
 * set once on the host, never in the database, never in a form, rotatable
 * without anyone opening the admin panel. Set GA4_API_SECRET on Railway and the
 * panel stops asking for it.
 *
 * It cannot be hardcoded. In the frontend bundle it would be published to every
 * visitor; in this file it would be committed to git and impossible to rotate
 * without a redeploy. Anyone holding it can write events into the property —
 * invented revenue, forged conversions — so it gets the same handling as the
 * Stripe key.
 *
 * The stored fallback exists so the owner can get GA4 working today without a
 * redeploy or a Railway login. Whichever is in force, the value is never sent
 * back to the browser.
 */
const getGa4ApiSecret = async () => {
  const fromEnv = String(process.env.GA4_API_SECRET || '').trim();
  if (fromEnv) return fromEnv;
  const { rows } = await pool.query('SELECT value FROM site_settings WHERE key = $1', [GA4_SECRET_KEY]);
  const v = rows[0]?.value;
  return typeof v === 'string' && v ? v : null;
};

/** Where the secret in force came from — the panel says so rather than guessing. */
const ga4SecretSource = async () => {
  if (String(process.env.GA4_API_SECRET || '').trim()) return 'env';
  const { rows } = await pool.query('SELECT value FROM site_settings WHERE key = $1', [GA4_SECRET_KEY]);
  return typeof rows[0]?.value === 'string' && rows[0].value ? 'stored' : null;
};

const setGa4ApiSecret = async (secret) => {
  if (!secret) {
    await pool.query('DELETE FROM site_settings WHERE key = $1', [GA4_SECRET_KEY]);
    return;
  }
  await pool.query(
    `INSERT INTO site_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [GA4_SECRET_KEY, JSON.stringify(secret)]
  );
};

/**
 * POST one event to GA4's Measurement Protocol.
 *
 * `debug: true` sends it to the validation endpoint instead, which never records
 * anything and answers with a list of what is wrong with the payload.
 *
 * Returns a small result rather than throwing: the only caller that must not
 * fail is the one finalizing a paid order, and no analytics call is ever allowed
 * to come between a customer and their receipt.
 */
const sendGa4Event = async ({ measurementId, apiSecret, clientId, sessionId, name, params, debug = false }) => {
  const url = `${debug ? GA4_DEBUG_ENDPOINT : GA4_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  const body = {
    // client_id and nothing else identifies the shopper.
    //
    // No user_id, deliberately. The browser never sets one (that would mean
    // handing Google an account identifier, which this shop doesn't do), so
    // sending one HERE would set it on the purchase and on nothing else — and
    // an inconsistently-set user_id is a known way to end up with GA4 counting
    // the same person as two users under the User-ID reporting identity. The
    // client_id is what stitches this purchase to the session that produced it,
    // and it is the only stitching that has to work.
    client_id: clientId,
    // GA4 drops events older than 72 hours; a payment confirmed by webhook
    // minutes later is well inside that, but stamping it explicitly means the
    // purchase is filed at the moment it happened rather than the moment we
    // got round to reporting it.
    timestamp_micros: Date.now() * 1000,
    non_personalized_ads: true,
    events: [{
      name,
      params: {
        ...params,
        // Without a session id GA4 files the event against a brand-new session,
        // and the purchase detaches from the browsing that produced it — the
        // acquisition report then credits every sale to "(direct)".
        ...(sessionId ? { session_id: sessionId } : {}),
        engagement_time_msec: 1,
      },
    }],
  };

  // One retry, because there is no second chance at this. Unlike a browser
  // event — which is one of hundreds and whose loss rounds away — a purchase is
  // a single irreplaceable fact about money, sent once, from a server, with
  // nothing downstream that would ever notice it went missing. A transient
  // socket error would silently cost the shop a whole order in Google's revenue.
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      // 5xx is worth a second go; 4xx is a payload or credential problem that a
      // retry cannot fix, and hammering it would only delay the answer.
      if (res.status < 500 || attempt >= 1) break;
    } catch (err) {
      if (attempt >= 1) throw err;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // The live endpoint answers 204 with an empty body whatever it thought of the
  // payload; only the debug endpoint says anything useful.
  const text = debug ? await res.text().catch(() => '') : '';
  let validation = [];
  if (text) {
    try { validation = JSON.parse(text).validationMessages || []; } catch { /* not JSON — report the status alone */ }
  }
  return { ok: res.ok, status: res.status, validation };
};

/**
 * Report a completed order to GA4. Called from finalizeCheckoutSession, and
 * never allowed to fail it.
 *
 * Silently does nothing — which is the correct outcome, not a failure — when:
 * GA4 is off, no measurement id or API secret is saved, ecommerce mirroring is
 * off, or the shopper's browser sent no GA4 client id (they declined cookies, so
 * their visit was never in GA4 to attach a purchase to).
 */
const reportPurchaseToGa4 = async (order, p) => {
  const clientId = gaClientId(p.analytics?.ga_client_id);
  if (!clientId) return;

  const settings = await getGoogleAnalyticsSettings();
  if (!settings.enabled || !settings.measurementId || !settings.trackEcommerce) return;

  const apiSecret = await getGa4ApiSecret();
  if (!apiSecret) return;

  await sendGa4Event({
    measurementId: settings.measurementId,
    apiSecret,
    clientId,
    sessionId: gaSessionId(p.analytics?.ga_session_id),
    name: 'purchase',
    params: {
      // GA4 deduplicates purchases on transaction_id, so this must be the
      // order's own stable id: a webhook and the success-page poll can both
      // finalize the same session, and a retry must not double the revenue.
      transaction_id: String(order.id),
      currency: 'EUR',
      value: Number(order.total),
      shipping: Number(order.shipping) || 0,
      ...(Number(order.discount_amount) ? { coupon: p.discount_code || 'discount' } : {}),
      // Same authoritative snapshot the Stripe charge was built from — a cart
      // row's product_data comes from the browser, but by this point it has been
      // re-read from the catalogue (see the checkout route), so GA4's revenue
      // and the money actually taken agree line for line.
      items: (p.items || []).map((i) => ({
        item_id: String(i.product_id ?? 'unknown'),
        item_name: String(i.product_data?.name ?? 'unknown').slice(0, 100),
        price: parsePrice(i.product_data?.price),
        quantity: Number(i.quantity) || 1,
      })),
      // GA4's DebugView is the only way to watch events arrive in real time, and
      // a server-side event with no browser behind it is exactly the kind that
      // needs watching while it's being set up.
      ...(settings.debugMode ? { debug_mode: true } : {}),
    },
  });
};

/**
 * Take a refunded order (or one refunded line) back out of GA4.
 *
 * Without this the two systems drift apart in the one direction that flatters
 * the shop: our own revenue query already excludes refunded orders and refunded
 * lines, while GA4 would keep the original purchase for ever. Every refund would
 * make Google's revenue a little more wrong than the shop's own, and nothing
 * would ever correct it.
 *
 * GA4 handles both shapes through one event: a `refund` with items is partial,
 * a `refund` without them is the whole order.
 *
 * The client id is the one the browser sent at checkout, kept on the pending
 * checkout payload — a refund happens days later with no browser present, so
 * there is nothing else to attribute it to.
 */
const reportRefundToGa4 = async (orderId, { items, value } = {}) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.total, o.stripe_session_id, pc.payload
       FROM orders o
       LEFT JOIN pending_checkouts pc ON pc.stripe_session_id = o.stripe_session_id
      WHERE o.id = $1`,
    [orderId]
  );
  const order = rows[0];
  if (!order) return;

  const clientId = gaClientId(order.payload?.analytics?.ga_client_id);
  if (!clientId) return; // never reported as a purchase, so nothing to take back

  const settings = await getGoogleAnalyticsSettings();
  if (!settings.enabled || !settings.measurementId || !settings.trackEcommerce) return;

  const apiSecret = await getGa4ApiSecret();
  if (!apiSecret) return;

  await sendGa4Event({
    measurementId: settings.measurementId,
    apiSecret,
    clientId,
    // Deliberately no session_id: this is happening days after that session
    // ended, and attaching it to a session that has closed is how a refund ends
    // up credited to the campaign that made the sale.
    sessionId: null,
    name: 'refund',
    params: {
      transaction_id: String(order.id),
      currency: 'EUR',
      value: value ?? Number(order.total),
      ...(items ? { items } : {}),
      ...(settings.debugMode ? { debug_mode: true } : {}),
    },
  });
};

// ── Meta Pixel, server side (Conversions API) ─────────────────────────────────
//
// The browser's pixel reports everything a browser can see. It cannot report the
// purchase, for exactly the reason gtag.js cannot: by the time Stripe confirms
// payment the shopper is on Stripe's domain, and whether they ever land back on
// the success page is not something a shop's ad reporting can depend on. A
// shopper who pays and closes the tab has bought something, and the campaign
// that found them has to be credited for it.
//
// So 'Purchase' reaches Meta the way it reaches our own tables and GA4: written
// here, once, from the Stripe-confirmed order — through the Conversions API,
// Meta's server-to-server endpoint. This is not a nice-to-have. It is the half
// of a Meta setup that still works when the shopper runs an ad blocker, browses
// in Safari with ITP capping first-party cookies at seven days, or simply never
// returns to the site after paying.
//
// WHAT MAKES A SERVER-SIDE EVENT USEFUL IS THE MATCHING, and matching is the
// part that is easy to get silently wrong. Meta has no cookie of its own on this
// request — there is no browser here — so every identifier has to be carried to
// it deliberately:
//
//   fbp / fbc          the pixel's own cookies, forwarded by the browser when
//                      checkout started (see getMetaIds in src/lib/meta.ts);
//                      fbc is the ad click itself and is the single strongest
//                      attribution signal there is,
//   ip / user agent    captured AT CHECKOUT TIME and stored on the pending
//                      checkout. NOT read here: this code usually runs from the
//                      Stripe webhook, where the request's IP is Stripe's and
//                      its user agent is Stripe's. Sending those would tell Meta
//                      that every one of the shop's customers is a datacentre in
//                      Ireland running a bot,
//   hashed PII         email, phone, name, city, county, postcode, country from
//                      the order — SHA-256 of the normalised value, never the
//                      plaintext.
//
// Two ids, two homes, the same split as GA4's next door:
//   - the PIXEL ID is public — it ships in the page source of every site with a
//     pixel — so it lives in content_metaPixel with the rest of the owner's
//     settings and is served by the public /api/content route.
//   - the ACCESS TOKEN is a credential. Stored under a key WITHOUT the
//     `content_` prefix, which is the whole reason it cannot leak: /api/content
//     and /api/content/:section both filter on that prefix, so no route the
//     storefront can call will ever return it.

const META_TOKEN_KEY = 'meta_capi_token';
// Pinned rather than left to default, and overridable without a redeploy.
// Graph API versions are retired roughly two years after release; when this one
// goes, Meta answers with an explicit "version is deprecated" error that the
// admin panel's test button prints verbatim, and the fix is one Railway variable
// rather than a code change.
const META_GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || 'v23.0').trim();
const metaEndpoint = (pixelId) =>
  `https://graph.facebook.com/${encodeURIComponent(META_GRAPH_VERSION)}/${encodeURIComponent(pixelId)}/events`;

/** The owner's Meta Pixel settings, as saved in Admin → Analytics → Meta Pixel. */
const getMetaPixelSettings = async () => {
  const { rows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_metaPixel'`);
  const v = rows[0]?.value || {};
  return {
    enabled: v.enabled === true,
    pixelId: metaPixelId(v.pixel_id) || '',
    trackEcommerce: v.track_ecommerce !== false,
    advancedMatching: v.advanced_matching !== false,
    testEventCode: metaTestCode(v.test_event_code) || '',
  };
};

/**
 * The Conversions API access token, from the environment if it is set there.
 *
 * Same precedence and the same reasoning as GA4_API_SECRET above: env var first,
 * because that is where a credential belongs and it is what this server already
 * does for STRIPE_SECRET_KEY and JWT_SECRET. Set META_CAPI_TOKEN on Railway and
 * the panel stops asking for it.
 *
 * It cannot be hardcoded and it cannot go in the frontend bundle. This token can
 * write conversions into the owner's pixel — inventing purchases, forging
 * revenue, and (worse than either) teaching the ad delivery system to chase
 * whoever the forger says converted. It gets the same handling as the Stripe key.
 */
const getMetaAccessToken = async () => {
  const fromEnv = String(process.env.META_CAPI_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  const { rows } = await pool.query('SELECT value FROM site_settings WHERE key = $1', [META_TOKEN_KEY]);
  const v = rows[0]?.value;
  return typeof v === 'string' && v ? v : null;
};

/** Where the token in force came from — the panel says so rather than guessing. */
const metaTokenSource = async () => {
  if (String(process.env.META_CAPI_TOKEN || '').trim()) return 'env';
  const { rows } = await pool.query('SELECT value FROM site_settings WHERE key = $1', [META_TOKEN_KEY]);
  return typeof rows[0]?.value === 'string' && rows[0].value ? 'stored' : null;
};

const setMetaAccessToken = async (token) => {
  if (!token) {
    await pool.query('DELETE FROM site_settings WHERE key = $1', [META_TOKEN_KEY]);
    return;
  }
  await pool.query(
    `INSERT INTO site_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [META_TOKEN_KEY, JSON.stringify(token)]
  );
};

/**
 * POST one event to Meta's Conversions API.
 *
 * Unlike GA4's Measurement Protocol — which accepts anything and answers 204 —
 * the Graph API AUTHENTICATES. A wrong token, a wrong pixel id or a malformed
 * payload all come back as a JSON error with a human-readable message, which is
 * what makes the admin panel's test button able to prove something rather than
 * merely reach something.
 *
 * Returns a small result rather than throwing: the only caller that must not
 * fail is the one finalizing a paid order, and no measurement call is ever
 * allowed to come between a customer and their receipt.
 */
const sendMetaEvent = async ({ pixelId, accessToken, event, testEventCode }) => {
  const body = {
    data: [event],
    access_token: accessToken,
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };

  // One retry, because there is no second chance at this. Unlike a browser
  // event — one of hundreds, whose loss rounds away — a purchase is a single
  // irreplaceable fact about money, sent once, from a server, with nothing
  // downstream that would ever notice it went missing.
  let res, text;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(metaEndpoint(pixelId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      text = await res.text().catch(() => '');
      // 5xx and 429 are worth a second go; a 4xx is a credential or payload
      // problem that a retry cannot fix, and hammering it only delays the answer.
      if ((res.status < 500 && res.status !== 429) || attempt >= 1) break;
    } catch (err) {
      if (attempt >= 1) throw err;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON — the status stands alone */ }

  return {
    ok: res.ok && !parsed?.error,
    status: res.status,
    // Meta's own words. Printed verbatim by the admin panel rather than
    // paraphrased: "Invalid parameter" and "(#190) Invalid OAuth access token"
    // point at completely different fixes, and a summary loses that.
    error: parsed?.error?.error_user_msg || parsed?.error?.message || (res.ok ? null : `HTTP ${res.status}`),
    eventsReceived: typeof parsed?.events_received === 'number' ? parsed.events_received : null,
    messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
  };
};

/**
 * Report a completed order to Meta. Called from finalizeCheckoutSession, and
 * never allowed to fail it.
 *
 * Silently does nothing — the correct outcome, not a failure — when: the pixel
 * is off, no pixel id or access token is saved, ecommerce mirroring is off, or
 * the shopper never consented (in which case the browser sent no `meta_consent`
 * and there is no lawful basis to tell Meta anything about them at all).
 */
const reportPurchaseToMeta = async (order, p) => {
  const analytics = p.analytics || {};
  // The consent the BROWSER actually checked before the pixel ran. Absent means
  // the visitor declined, or the pixel was off for them — either way this sale
  // is not Meta's to know about.
  if (analytics.meta_consent !== true) return;

  const settings = await getMetaPixelSettings();
  if (!settings.enabled || !settings.pixelId || !settings.trackEcommerce) return;

  const accessToken = await getMetaAccessToken();
  if (!accessToken) return;

  // The account behind the order, for the matching fields the shipping address
  // doesn't carry — the email above all, which is Meta's strongest single match
  // key and is never typed into the checkout form.
  const { rows: profileRows } = await pool.query(
    `SELECT email, full_name, phone, city, state, postal_code, country FROM users WHERE id = $1`,
    [order.user_id]
  );
  const profile = profileRows[0] || {};

  const address = p.shipping_address || {};
  const result = await sendMetaEvent({
    pixelId: settings.pixelId,
    accessToken,
    testEventCode: settings.testEventCode,
    event: {
      event_name: 'Purchase',
      // Seconds, not milliseconds. Meta rejects an event more than seven days
      // old and treats one dated in the future as a clock problem; a payment
      // confirmed by webhook minutes after the fact is comfortably inside that,
      // and stamping it explicitly files the sale at the moment it happened
      // rather than the moment we got round to reporting it.
      event_time: Math.floor(Date.now() / 1000),
      // THE ORDER'S OWN ID, and this is what makes a double-send harmless. Meta
      // deduplicates on event_name + event_id: the Stripe webhook and the
      // success-page poll both call finalizeCheckoutSession, and without this a
      // race between them would report the shop's revenue twice.
      event_id: `order-${order.id}`,
      action_source: 'website',
      // Where the shopper was when they bought. Meta uses it to sanity-check the
      // event against the pixel's own domain, and an event_source_url that
      // doesn't belong to the pixel is a well-known cause of silently poor
      // attribution.
      ...(p.analytics?.source_url ? { event_source_url: p.analytics.source_url } : {}),
      user_data: metaUserData({
        analytics,
        profile,
        address,
        advancedMatching: settings.advancedMatching,
      }),
      custom_data: {
        currency: 'EUR',
        // Rounded to the cent, and that is not cosmetic. `orders.total` is a
        // numeric column that arrives as a string and can carry float noise —
        // 25 + 4.99 is stored as 29.990000000000002 — so the raw Number() is
        // what would be reported to Meta as this shop's revenue. It agrees with
        // the money Stripe took (both round to 2999 cents), but it is not the
        // number on the receipt, and revenue that does not match the receipt is
        // the one figure nobody should ever have to explain.
        value: +Number(order.total).toFixed(2),
        // The order id again, in the field Meta's reporting shows — so a
        // conversion in Events Manager can be traced back to a row in the orders
        // table without anyone guessing from a timestamp.
        order_id: String(order.id),
        content_type: 'product',
        content_ids: (p.items || []).map(i => String(i.product_id ?? 'unknown')),
        contents: (p.items || []).map(i => ({
          id: String(i.product_id ?? 'unknown'),
          quantity: Number(i.quantity) || 1,
          // parsePrice, never Number(): prices are admin free text and arrive as
          // "€38". Number("€38") is NaN, and a NaN here is dropped by
          // JSON.stringify, so the line would silently reach Meta priceless.
          item_price: +parsePrice(i.product_data?.price).toFixed(2),
        })),
        num_items: (p.items || []).reduce((sum, i) => sum + (Number(i.quantity) || 1), 0),
      },
    },
  });

  if (!result.ok) console.error('[meta purchase]', order.id, result.status, result.error);
};

// Best-effort: tag events with the logged-in customer when the session cookie is
// present and valid, so the journey stitches visitor → account. Never rejects.
const userIdFromSessionCookie = (req) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET).userId || null; } catch { return null; }
};

// ── Traffic that isn't a person ───────────────────────────────────────────────
// Ingestion needs a browser that runs JavaScript, which keeps most crawlers out
// by construction. What it does NOT keep out is anything scripted deliberately —
// and a probe run at this endpoint with curl, python-requests or a headless
// browser landed in the visitor count as a shopper. On a number shown to
// investors, that is the wrong direction of error to leave open.
//
// Grouped so each addition can be judged on its own, and written to be SAFE IN
// ONE DIRECTION: nothing here may match a real shopper. That rules out the
// obvious-looking tokens — `facebook`, `instagram`, `linkedin`, `pinterest`,
// `tiktok`/`bytedance`, `snapchat` all appear in the IN-APP BROWSERS real people
// shop from, so only the specific fetcher spellings are listed. `(?<!cu)bot`
// catches Googlebot, bingbot and every named crawler while sparing Cubot, which
// is a budget Android phone brand and was being turned away as a robot.
const OBVIOUS_BOT_RE = new RegExp([
  // Says so in the name.
  '(?<!cu)bot|crawler|spider|scraper|crawling',
  // Headless browsers and automation drivers — these DO run JavaScript, so they
  // are the only entries here that could otherwise reach this route unaided.
  'headless|phantomjs|puppeteer|playwright|selenium|webdriver|prerender',
  // Auditing, monitoring and speed tools.
  'lighthouse|pingdom|gtmetrix|statuscake|site24x7|inspectiontool|pagespeed',
  // HTTP libraries. A real browser is never any of these.
  'curl/|wget|python-requests|python-urllib|aiohttp|httpx/|go-http-client|java/',
  'okhttp|axios/|node-fetch|guzzle|libwww|lwp::|restsharp|apache-httpclient',
  'postmanruntime|insomnia|scrapy|mechanize|typhoeus|winhttp',
  // Link-preview fetchers whose names don't contain "bot".
  'facebookexternalhit|whatsapp/|skypeuripreview|embedly|quora link preview',
  'vkshare|flipboard|nuzzel|feedfetcher',
].join('|'), 'i');

// A browser always identifies itself. An empty User-Agent is a script that
// couldn't be bothered, never a shopper.
const isNonHuman = (ua) => !String(ua || '').trim() || OBVIOUS_BOT_RE.test(ua);

// ── Which origins count as "the shop" ─────────────────────────────────────────
// A visitor id lives in localStorage, and localStorage is scoped to an ORIGIN —
// so the same person is a different visitor on every hostname the shop answers
// to, with nothing to reconcile them by. This app answers to several:
//
//   • theolivegoose.ie — Netlify, the real storefront;
//   • frontend-production-*.up.railway.app — this very service, which serves the
//     identical SPA from its catch-all at the bottom of this file;
//   • deploy-preview-*.netlify.app — every preview build;
//   • localhost:8080 — a developer's machine, which backend/.env points at this
//     same PRODUCTION database, so each reload wrote a fresh visitor into the
//     live numbers.
//
// Only the first is a customer. The rest are the shop looking at itself, and
// counting them is how one person testing for an hour became "6 visitors".
//
// Override with ANALYTICS_ORIGINS (comma-separated) for a domain change or a
// second storefront; the default is the canonical domain and its www alias.
const countedOrigins = (() => {
  const configured = String(process.env.ANALYTICS_ORIGINS || '').split(',').map(toOrigin).filter(Boolean);
  return configured.length ? configured : ['https://theolivegoose.ie', 'https://www.theolivegoose.ie'];
})();

// The origin a batch was sent from. Fetch requires an Origin header on every
// non-GET/HEAD request, and ingestion is always a POST (including sendBeacon's),
// so real browsers always identify themselves here; Referer is a fallback.
const requestOrigin = (req) => toOrigin(req.headers.origin) || toOrigin(req.headers.referer) || '';

// ── Where the visitor is ──────────────────────────────────────────────────────
// City and country as resolved by Netlify's edge, which knew them already in
// order to route the request (see netlify/edge-functions/analytics-geo.ts). No
// IP address is looked up, sent anywhere or stored to produce this — the shop
// receives a city name and nothing else, which is what keeps this inside the
// same first-party, no-personal-data-retained design as the rest of the
// analytics.
//
// Treated strictly as a hint from our own proxy and sanitised accordingly: the
// edge function strips any inbound copy of these headers, but a request that
// reaches the backend without passing through Netlify — the Railway hostname
// direct, curl — can still set them freely, and a GROUP BY key must never be
// attacker-shaped. Absent or unusable means 'unknown', never a guess.
// The visitor's address as Netlify's edge saw it, or null.
//
// DELIBERATELY NOT req.ip. In production this app sits behind TWO proxies —
// Netlify, then Railway — and `trust proxy` is set to 1, so req.ip is whichever
// proxy spoke last, not the shopper. Matching "the owner's home network" against
// that would compare a shared edge address to itself and exclude EVERY visitor,
// reporting an empty shop with no error anywhere to explain it.
//
// So the only address trusted for this is the one the edge states explicitly
// (netlify/edge-functions/analytics-geo.ts, which strips any inbound copy first).
// When it is absent — local development, a request that bypassed Netlify — the
// answer is null and network matching does not run at all. That is the safe
// direction: a visit that should have been excluded is counted, rather than
// every visit being excluded.
const edgeClientIp = (req) => {
  const raw = String(req.headers['x-og-client-ip'] || '').trim();
  if (!raw || raw.length > 45) return null;
  const addr = normaliseIp(raw);
  return addr && (ipv4Int(addr) !== null || ipv6Prefix(addr) !== null) ? addr : null;
};

const GEO_CITY_RE = /^[\p{L}\p{M}\s'.\-()]{1,80}$/u;
const geoFromHeaders = (req) => {
  let city = '';
  try {
    // The edge percent-encodes it: header values are Latin-1 and "München" is not.
    const raw = decodeURIComponent(String(req.headers['x-og-geo-city'] || '')).trim();
    if (GEO_CITY_RE.test(raw)) city = raw.slice(0, 80);
  } catch { /* malformed encoding — no city rather than a mangled one */ }

  const country = /^[A-Za-z]{2}$/.test(String(req.headers['x-og-geo-country'] || '').trim())
    ? String(req.headers['x-og-geo-country']).trim().toUpperCase()
    : '';

  // A city without its country is ambiguous to the point of being misleading —
  // there is a Dublin in Ohio — so the pair travels together or not at all.
  return country ? { city, country } : { city: '', country: '' };
};

// Deliberately fails OPEN. An origin we cannot read is recorded rather than
// dropped, so if Netlify's proxy ever stops forwarding the header the shop keeps
// measuring itself instead of silently reporting zero traffic. The origins this
// exists to exclude — localhost, the Railway hostname, preview builds — are all
// real browser POSTs that do send the header, so they are still excluded.
const originCounts = (origin) => !origin || countedOrigins.includes(origin);

// ── The shop's own browsing ───────────────────────────────────────────────────
// Accounts and networks listed here are the shop's, not customers'. Read on
// every ingest batch and changed about once a year, so it's cached; a failed
// refresh keeps the last known set rather than briefly counting internal traffic
// as real.
let internalUserIds = new Set();
let internalNetworks = [];
let internalLoadedAt = 0;
const INTERNAL_TTL_MS = 60_000;

// A home network is one address for every device on it — the owner's laptop, a
// spouse's phone, a tablet — which is the only signal that covers people who
// never sign in and never touch the admin panel.
//
// NO VISITOR'S IP IS EVER STORED. The address is compared in memory against this
// list and then discarded; what gets written down is only that a visitor id
// belongs to the shop. That matters beyond tidiness: this site's exemption from
// the consent banner rests on it being plain first-party audience measurement
// with no personal data retained, and an IP column would be exactly that.
//
// IPv6 is matched on its /64 prefix, because a home connection hands every
// device — and every privacy-extension rotation — a different address inside one
// prefix. IPv4 is matched whole, or as a CIDR block if one is given.
const normaliseIp = (raw) => {
  const s = String(raw || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  // ::ffff:192.0.2.1 — an IPv4 client arriving on a dual-stack socket.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  return mapped ? mapped[1] : s.replace(/%.*$/, '').replace(/:\d+$/, (m) => (s.includes('.') ? '' : m));
};

/** The /64 an IPv6 address sits in, or null for anything else. */
const ipv6Prefix = (ip) => {
  if (!ip.includes(':')) return null;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const gap = 8 - left.length - right.length;
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(gap, 0)).fill('0'), ...right] : left;
  if (groups.length < 4) return null;
  return groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':');
};

/** IPv4 as a 32-bit integer, or null if it isn't one. */
const ipv4Int = (ip) => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!/^\d{1,3}$/.test(p) || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
};

/**
 * The entry in `networks` that `ip` sits on, or null.
 *
 * Returns WHICH one, not just whether: the match is recorded against the visitor
 * (analytics_internal_visitors.detail) so that removing one network later
 * releases exactly the visitors that network excluded. Without it the only
 * options were releasing every network-excluded visitor at once or — what the
 * code actually did — releasing none of them, which left real shoppers hidden
 * for good the moment a second network was ever added.
 */
const matchedNetwork = (ip, networks) => {
  const addr = normaliseIp(ip);
  if (!addr) return null;
  const prefix = ipv6Prefix(addr);
  const asInt = ipv4Int(addr);
  return networks.find((entry) => {
    const [base, bitsRaw] = String(entry).split('/');
    const target = normaliseIp(base);
    if (!target) return false;
    if (asInt !== null) {
      const targetInt = ipv4Int(target);
      if (targetInt === null) return false;
      const bits = bitsRaw ? Math.min(Math.max(parseInt(bitsRaw, 10) || 32, 0), 32) : 32;
      // >>> 0 keeps the mask unsigned; a /0 shift by 32 is undefined in JS, so it
      // is spelled out rather than computed.
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      return ((asInt & mask) >>> 0) === ((targetInt & mask) >>> 0);
    }
    return !!prefix && prefix === ipv6Prefix(target);
  }) ?? null;
};

/** True when `ip` is on one of the shop's own networks. */
const ipIsInternal = (ip, networks) => matchedNetwork(ip, networks) !== null;

const getInternalConfig = async () => {
  if (internalLoadedAt && Date.now() - internalLoadedAt < INTERNAL_TTL_MS) {
    return { userIds: internalUserIds, networks: internalNetworks };
  }
  try {
    const { rows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'analytics_internal'`);
    const emails = (Array.isArray(rows[0]?.value?.emails) ? rows[0].value.emails : [])
      .map((e) => String(e).toLowerCase().trim()).filter(Boolean);
    // Same rule the orders side uses (see NOT_INTERNAL_ORDER): an entry starting
    // with '@' matches every address at that domain, so the QA harness accounts
    // are covered without listing each one.
    const exact = emails.filter((e) => !e.startsWith('@'));
    const domains = emails.filter((e) => e.startsWith('@'));
    const ids = emails.length
      ? (await pool.query(
          `SELECT id FROM users
            WHERE LOWER(email) = ANY($1::text[])
               OR EXISTS (SELECT 1 FROM unnest($2::text[]) d WHERE LOWER(email) LIKE '%' || d)`,
          [exact, domains]
        )).rows.map((r) => r.id)
      : [];
    internalUserIds = new Set(ids);
    internalNetworks = (Array.isArray(rows[0]?.value?.networks) ? rows[0].value.networks : [])
      .map((n) => String(n).trim()).filter(Boolean);
    internalLoadedAt = Date.now();
  } catch (err) {
    console.error('Could not refresh internal analytics config:', err.message);
  }
  return { userIds: internalUserIds, networks: internalNetworks };
};

// Device class from the User-Agent the browser sent with this request, with the
// client's capability hint as a tie-breaker.
//
// The browser cannot be wrong about what it is running on, whereas the previous
// client-side rule — viewport width, tablet = 768–1023px — was wrong constantly:
// it labelled every desktop browser in a narrow window a "tablet". Order matters
// below, because Android tablet UAs also contain "Android", and only phones add
// "Mobile".
const classifyDevice = (ua, hint) => {
  const s = String(ua || '');
  if (/\biPad\b/i.test(s)) return 'tablet';
  if (/Android/i.test(s) && !/Mobile/i.test(s)) return 'tablet';
  if (/\b(Tablet|PlayBook|Silk|Kindle)\b/i.test(s)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(s)) return 'mobile';
  // The one thing a UA cannot express: iPadOS 13+ requests desktop sites by
  // default and identifies as macOS. The client's touch hint is the only tell.
  // Consulted ONLY on a Mac UA — anywhere else the browser has already said
  // what it is, and a hint must never be able to talk it out of that.
  if (/Macintosh/i.test(s)) return hint === 'tablet' ? 'tablet' : 'desktop';
  if (/Windows NT|X11|CrOS/i.test(s)) return 'desktop';
  return ['mobile', 'tablet', 'desktop'].includes(hint) ? hint : 'unknown';
};

// The timezone every analytics day boundary is resolved in. created_at is
// TIMESTAMPTZ, so without this a "day" would silently mean a UTC day — an hour
// off from the trading day for half the year, sliding late-evening orders into
// the wrong bucket. Interpolated into SQL, so it's pinned to a validated
// IANA-shaped constant and never comes from a request.
const STORE_TZ = /^[A-Za-z]+\/[A-Za-z_+-]+$/.test(process.env.ANALYTICS_TZ || '')
  ? process.env.ANALYTICS_TZ
  : 'Europe/Dublin';

// Dates on which a metric's DEFINITION changed, newest last. A window spanning
// one of these is comparing two different measurements, and no amount of SQL can
// reconcile that — so the dashboard says so instead of letting the step read as
// a change in shopper behaviour. Append here whenever instrumentation moves.
const MEASUREMENT_CHANGES = [
  {
    date: '2026-08-04',
    note: 'Adding to the basket stopped requiring a sign-in. Before this date "Added to cart" counted signed-in shoppers only, so earlier figures under-report it — and the sign-in gate moved to "Proceed to Checkout", where it is now measured.',
  },
  {
    date: '2026-08-24',
    note: 'Engagement rate and average engagement time began being measured on this date, so earlier periods show them as not measured rather than as zero. They follow Google Analytics\' definitions — foreground, visible time, and a session counting as engaged at ten seconds, a second page view, or a purchase — so they can be compared with any published benchmark. The shop\'s own visits are now removed from past periods as well as future ones. Naming one of your own accounts used to take effect only from that account\'s next visit; it now retires everything it ever browsed, and any visit can be retired by hand from "Recent visits". Traffic figures for earlier periods may therefore be lower than they read before this date — the difference is your own testing leaving the numbers, not a fall in trade.',
  },
];

// Purchase events written by finalizeCheckoutSession when the client never sent
// its analytics ids land on this sentinel id. It is not a real browsing session:
// every such order would otherwise collapse into ONE distinct session_id and add
// a phantom visitor to traffic, so it's excluded from every session/visitor count.
const NO_SESSION = 'server';

// ── Who is on the shop's own list ─────────────────────────────────────────────
// The accounts the owner has named in Admin → Analytics, as SQL. An entry
// beginning with '@' matches every address at that domain, which is how the QA
// harness accounts (…@olivegoose-test.local) stay out without anyone listing
// them one by one.
//
// Module scope on purpose: this same list has to decide three different things —
// which EVENTS count, which ORDERS count, and which visitor ids to retire when
// the list changes — and a copy that lived in only one of them is exactly how
// the shop's own browsing stayed in the numbers while its money was taken out.
//
// Fails OPEN: an unset or malformed list matches nobody, so a configuration
// mistake shows too much rather than silently hiding real trade.
const INTERNAL_EMAIL_ENTRIES = `
  SELECT LOWER(entry) AS entry
    FROM site_settings ss, LATERAL jsonb_array_elements_text(ss.value->'emails') AS entry
   WHERE ss.key = 'analytics_internal'`;

/** True when the given email column is on the internal list, by name or domain. */
const INTERNAL_EMAIL_MATCH = (emailCol) => `EXISTS (
  SELECT 1 FROM (${INTERNAL_EMAIL_ENTRIES}) ie
   WHERE LOWER(${emailCol}) = ie.entry
      OR (ie.entry LIKE '@%' AND LOWER(${emailCol}) LIKE '%' || ie.entry))`;

/**
 * Visitor ids that have ever sent an event while signed in as an internal
 * account, with the account that identified them.
 */
const INTERNAL_ACCOUNT_VISITORS = `
  SELECT DISTINCT ae.visitor_id, ae.user_id
    FROM analytics_events ae JOIN users iu ON iu.id = ae.user_id
   WHERE ${INTERNAL_EMAIL_MATCH('iu.email')}`;

// ── Reading a number out of client-supplied JSON ──────────────────────────────
// `props` is whatever the browser posted. Postgres does not fail softly on a bad
// cast: `'1.2.3'::numeric` RAISES, which aborts the whole statement — and every
// one of these casts sits inside the admin dashboard's aggregates.
//
// One POST to the PUBLIC, unauthenticated ingest route carrying
// {"metric":"LCP","value":"1.2.3"} was therefore enough to take the entire
// Analytics page down permanently, for every date range containing that row,
// with no way back except deleting it from the database. Worse, the error code
// (22P02) is the one sendServerError deliberately reports as 404 "Not found" —
// correct for a mistyped :id in a URL, and here it turned a broken dashboard
// into a page that claimed it did not exist.
//
// The guards this replaces looked like guards and were not: `^[0-9.]+$` accepts
// "1.2.3", "...", and a lone ".". The rule below is a full match on an actual
// number, with both halves bounded so a long digit string cannot overflow the
// target type either. Anything else reads as NULL — absent, which every
// aggregate here already handles — instead of taking the page with it.
// NOTE THE DOUBLE BACKSLASH. This is a JS template literal, so `\.` here would
// reach Postgres as a bare `.` — a wildcard matching ANY character. That is not
// a nitpick: the guard then accepts "1x9", which passes straight into ::numeric
// and raises exactly the error this constant exists to prevent, while looking
// completely correct on the page. e2e/analytics-accuracy.mjs feeds it a value of
// that shape for precisely this reason.
const NUMERIC_TEXT = `'^[0-9]{1,12}(\\.[0-9]{1,6})?$'`;
/** A JSONB prop as a number, or NULL when it isn't one. */
const PROP_NUM = (key) =>
  `CASE WHEN props->>'${key}' ~ ${NUMERIC_TEXT} THEN (props->>'${key}')::numeric END`;
/** Any JSON text expression as a whole number, or NULL — bounded against int4 overflow. */
const PROP_INT_EXPR = (expr) =>
  `CASE WHEN ${expr} ~ '^[0-9]{1,9}$' THEN (${expr})::int END`;

/** A JSONB prop as a whole number, bounded so it cannot overflow int4. */
const PROP_INT = (key) =>
  `CASE WHEN props->>'${key}' ~ '^[0-9]{1,9}$' THEN (props->>'${key}')::int END`;

/**
 * A price out of an order's stored product_data ("€38.00", "1,299.00") as a
 * number.
 *
 * Same hazard as PROP_NUM, one step further from the browser: these strings are
 * typed by an admin and frozen onto the order, so "€1.2.3" — or a stray second
 * decimal point in any product's price, ever — would abort Revenue, Top products
 * and the daily chart together. Stripping non-digits first and THEN taking the
 * leading number reproduces exactly what parsePrice() does in JS, so SQL and the
 * checkout agree on what a price is worth; unreadable reads as 0 rather than as
 * an outage.
 */
const PRICE_NUM = (expr) =>
  `COALESCE(substring(regexp_replace(${expr}, '[^0-9.]', '', 'g') from '^[0-9]*\\.?[0-9]+'), '0')::numeric`;

// What the dashboard reads instead of the raw table: the same rows, minus every
// visitor known to be the shop testing itself (see analytics_internal_visitors).
//
// It is a drop-in for `analytics_events` — aliased back to that name at each use
// site — precisely so the exclusion cannot be forgotten in one of the twenty-odd
// queries below and leave two figures on the same screen disagreeing about who
// counts. The filter is by visitor, so marking a browser retroactively removes
// its whole history, not just what it does next.
//
// TWO clauses, because the marked-visitor table alone was never enough. It is
// populated at INGEST, so it only ever knew about a browser that came back after
// the owner named their account: adding an address to the list today did nothing
// whatsoever to the test checkouts that account had already run, and the panel
// said it did. The second clause settles that in SQL — an event carrying an
// internal account is not shopper traffic, whenever it was recorded and whether
// or not its browser was ever seen again. Saving the list also backfills the
// visitor table from it (see the PUT below), which is what additionally retires
// the ANONYMOUS browsing either side of that sign-in.
const EXCLUDE_INTERNAL = `
  SELECT * FROM analytics_events ae
   WHERE NOT EXISTS (SELECT 1 FROM analytics_internal_visitors iv WHERE iv.visitor_id = ae.visitor_id)
     AND NOT EXISTS (SELECT 1 FROM users iu WHERE iu.id = ae.user_id AND ${INTERNAL_EMAIL_MATCH('iu.email')})`;
const EVENTS = `(${EXCLUDE_INTERNAL})`;

// ── POST /api/analytics/events — batched ingestion from the storefront ────────
// Accepts application/json (normal batched fetch) and text/plain (sendBeacon's
// CORS-safelisted content type, used for the final flush on page hide).
app.post('/api/analytics/events', analyticsLimiter, express.text({ type: 'text/plain', limit: '100kb' }), async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid payload' }); }
  }
  const events = Array.isArray(body?.events) ? body.events.slice(0, 25) : [];
  const visitorId = analyticsId(body?.visitor_id);
  const sessionId = analyticsId(body?.session_id);
  if (!visitorId || !sessionId || !events.length) return res.status(400).json({ error: 'Invalid payload' });
  if (isNonHuman(req.headers['user-agent'])) return res.status(204).end();

  // Preview builds, the raw Railway hostname and localhost are the shop looking
  // at itself on a different origin — each with its own localStorage, so each
  // inventing visitors that never existed. 204 so the browser never retries.
  const origin = requestOrigin(req);
  if (!originCounts(origin)) return res.status(204).end();

  const { city, country } = geoFromHeaders(req);

  const userId = userIdFromSessionCookie(req);

  // The owner's own browsing, by either route: signed in as an internal account,
  // or a browser they've explicitly marked in Admin → Analytics.
  //
  // What's remembered is the VISITOR, not the moment. The same browser was
  // testing anonymously before the sign-in and will be again after the sign-out,
  // and those events are just as much the shop's own traffic — so once a visitor
  // id is known to be internal, everything it ever did is excluded, backwards as
  // well as forwards (see EVENTS in the dashboard query below).
  const { userIds, networks } = await getInternalConfig();
  const flaggedByBrowser = body?.internal === true;
  const isInternalAccount = !!userId && userIds.has(userId);
  // Compared and discarded — see ipIsInternal. The address is never written down,
  // and is only consulted when the edge vouched for it (see edgeClientIp).
  const edgeIp = edgeClientIp(req);
  // WHICH network matched is recorded alongside the mark, so removing that one
  // network later releases exactly these visitors and no others.
  const onNetwork = edgeIp ? matchedNetwork(edgeIp, networks) : null;
  const reason = onNetwork ? 'own network'
    : isInternalAccount ? 'internal account'
    : 'browser marked in admin';
  // Which network, or which account. Same purpose in both cases: an exclusion
  // that cannot name its own cause cannot be released when that cause goes, and
  // the release below would then have to guess.
  const detail = onNetwork || (isInternalAccount ? String(userId) : '');
  try {
    if (flaggedByBrowser || isInternalAccount || onNetwork) {
      await pool.query(
        `INSERT INTO analytics_internal_visitors (visitor_id, reason, detail) VALUES ($1, $2, $3)
         ON CONFLICT (visitor_id) DO NOTHING`,
        [visitorId, reason, detail]
      );
      return res.status(204).end();
    }
    const known = await pool.query(`SELECT 1 FROM analytics_internal_visitors WHERE visitor_id = $1`, [visitorId]);
    if (known.rowCount) return res.status(204).end();
  } catch (err) {
    // Never let the exclusion lookup cost us a real customer's events — an
    // over-count is recoverable at query time, a dropped event is not.
    console.error('Internal-visitor check failed, recording event anyway:', err.message);
  }
  // Classified once per batch from this request's own User-Agent — never from
  // the browser's viewport, which is what made narrow desktop windows "tablets".
  const device = classifyDevice(req.headers['user-agent'], clip(body?.events?.[0]?.device, 20));
  const scope = body?.visitor_scope === 'persistent' ? 'persistent' : 'session';
  // Foreground time since this browser's last batch. Clamped to an hour: it is a
  // delta between two flushes of one page, so anything larger is a clock change
  // or a machine waking from sleep, and an unbounded value here would move the
  // shop's average engagement time on its own.
  const engagementMs = Math.min(Math.max(Math.round(Number(body?.engagement_ms) || 0), 0), 60 * 60 * 1000);
  const values = [];
  const params = [];
  for (const e of events) {
    if (!CLIENT_EVENT_TYPES.has(e?.type)) continue;
    let props = '{}';
    try { props = JSON.stringify(e.props ?? {}).slice(0, 2000); JSON.parse(props); } catch { props = '{}'; }
    const base = params.length;
    params.push(
      visitorId, sessionId, userId, e.type,
      clip(e.path, 200), clip(e.referrer, 500),
      clip(e.utm_source, 100), clip(e.utm_medium, 100), clip(e.utm_campaign, 100),
      device, props, scope, clip(origin, 200), city, country,
      // The batch's engagement delta belongs to the batch, not to each event in
      // it. On the first row only, so SUM over a session is the session's total
      // rather than that total multiplied by how many events happened to share
      // the flush.
      values.length === 0 ? engagementMs : 0,
    );
    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16})`);
  }
  if (!values.length) return res.status(204).end();

  try {
    await pool.query(
      `INSERT INTO analytics_events (visitor_id, session_id, user_id, event_type, path, referrer, utm_source, utm_medium, utm_campaign, device, props, visitor_scope, origin, geo_city, geo_country, engagement_ms)
       VALUES ${values.join(',')}`,
      params
    );
    res.status(204).end();
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/admin/analytics — aggregated dashboard payload ───────────────────
// Window is either an explicit calendar period (?start=YYYY-MM-DD&end=YYYY-MM-DD,
// both inclusive — quarters, months, years, anything) or a trailing ?days=N
// (default 30). Every number is computed in SQL over analytics_events + orders;
// the window is always compared against the equally-sized period immediately
// before it so the dashboard can show direction, not just magnitude.
app.get('/api/admin/analytics', requireAuth, async (req, res) => {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // isoDay is pure calendar arithmetic on UTC midnights (no DST hazard when
  // adding whole days); "today" is resolved in the store's timezone so the
  // dashboard's day boundaries match the ones the shop actually trades in.
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: STORE_TZ });

  // A range the caller *asked for* and got something else back is the one
  // failure this endpoint must never paper over: the dashboard would print the
  // requested dates above numbers measured over a different period, and no
  // reader could tell. So an explicit range that can't be honoured is a 400,
  // and only a caller that supplied no range at all gets the trailing default.
  const askedStart = req.query.start !== undefined ? String(req.query.start) : null;
  const askedEnd   = req.query.end   !== undefined ? String(req.query.end)   : null;
  if (askedStart !== null || askedEnd !== null) {
    if (!DATE_RE.test(askedStart || '') || !DATE_RE.test(askedEnd || '')) {
      return res.status(400).json({ error: 'start and end must both be YYYY-MM-DD dates' });
    }
    if (askedEnd < askedStart) {
      return res.status(400).json({ error: 'end must be on or after start' });
    }
  }

  let start = askedStart && DATE_RE.test(askedStart) ? askedStart : null;
  let end   = askedEnd   && DATE_RE.test(askedEnd)   ? askedEnd   : null;
  if (!start || !end) {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 730);
    end = today;
    start = isoDay(Date.parse(today) - (days - 1) * 86400000);
  }
  // Cap the window at 2 years so a mistyped range can't scan unbounded history.
  // Reported back as `clamped` — the panel shows the window that was actually
  // measured, and a silently shortened one would read as a drop in trade.
  let lenDays = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const clamped = lenDays > 731;
  if (clamped) { lenDays = 731; start = isoDay(Date.parse(end) - 730 * 86400000); }

  const endExcl   = isoDay(Date.parse(end) + 86400000);          // $2 — end-exclusive
  const prevStart = isoDay(Date.parse(start) - lenDays * 86400000); // $3 — previous window start
  const w = [start, endExcl, prevStart];

  // Every window bound is resolved in the store's timezone (see STORE_TZ).
  // $1 = window start, $2 = window end (exclusive), $3 = previous window start.
  const T1 = `($1::date AT TIME ZONE '${STORE_TZ}')`;
  const T2 = `($2::date AT TIME ZONE '${STORE_TZ}')`;
  const T3 = `($3::date AT TIME ZONE '${STORE_TZ}')`;
  const DAY = (col) => `(${col} AT TIME ZONE '${STORE_TZ}')::date`;

  // The window end plus a short grace period, for the one thing that legitimately
  // lands after it: a checkout entered at 23:55 on the last day and confirmed at
  // 00:03 the next. That sale belongs to the session that started it.
  //
  // The grace is bounded on purpose. These predicates used to have no upper bound
  // at all ("purchase at any point from the window start onward"), which is
  // harmless while the window ends today and quietly wrong the moment it doesn't:
  // asking for last June counted every purchase made SINCE June as a June
  // conversion, so a past month's funnel, conversion rate and abandonment were
  // scored against a future the shopper hadn't reached yet. Six hours covers the
  // midnight hand-over and nothing else.
  const T2G = `(${T2} + INTERVAL '6 hours')`;

  // Orders that count as a sale: paid, not refunded in full, and not the shop's
  // own.
  //
  // THAT LAST CLAUSE LIVES HERE ON PURPOSE. Every query below that touches the
  // orders table goes through this one predicate, so a test checkout cannot leak
  // into Revenue, AOV, Orders, the daily chart, Top products, Customers,
  // lifetime value or checkout abandonment — and a query added next year cannot
  // reintroduce the leak by forgetting a filter. Excluding internal traffic from
  // analytics_events alone was never enough: browsing lives in the events table
  // but MONEY lives here, so the owner's own €0.20 test order was still landing
  // in the revenue figures, in average order value, and at the top of the
  // products table under the name "Test Product 1".
  //
  // The list itself is defined once at module scope (INTERNAL_EMAIL_ENTRIES),
  // because the identical rule decides which EVENTS count as well — see
  // EXCLUDE_INTERNAL. Two copies of it is how browsing and money came to
  // disagree about whose visits were the shop's own.
  //
  // Requires the orders row to be aliased `o`, which every use site below does.
  const NOT_INTERNAL_ORDER = `NOT EXISTS (
    SELECT 1 FROM users iu
     WHERE iu.id = o.user_id AND ${INTERNAL_EMAIL_MATCH('iu.email')})`;

  const PAID = `payment_status = 'paid' AND refund_status <> 'refunded' AND ${NOT_INTERNAL_ORDER}`;

  // Money handed back through an approved return, which `refund_status` does NOT
  // record: applyReturnStatusChange refunds a single line (its price × quantity)
  // and updates the *return*, leaving the order still "paid, not refunded". So a
  // part-refunded order was counting at its full value in Revenue, AOV, lifetime
  // value and Top products. This deducts exactly what that code refunds.
  // `o` must be the alias of the orders row in scope.
  const LINE_VALUE = (item) =>
    `${PRICE_NUM(`${item}->'product_data'->>'price'`)}
     * COALESCE(${PROP_INT_EXPR(`${item}->>'quantity'`)}, 0)`;
  const REFUNDED_VALUE = `COALESCE((
    SELECT SUM(${LINE_VALUE('it')})
    FROM returns r JOIN LATERAL jsonb_array_elements(o.items) AS it ON it->>'product_id' = r.product_id
    WHERE r.order_id = o.id AND r.status = 'refunded'
  ), 0)`;
  // Never below zero: a return refunds the pre-discount line value, which on a
  // heavily discounted order can exceed the order's share of what was charged.
  const NET_TOTAL = `GREATEST(o.total - ${REFUNDED_VALUE}, 0)`;
  // True when the whole order has been handed back line by line — it should drop
  // out of the order *count*, not just contribute zero revenue.
  const FULLY_RETURNED = `${REFUNDED_VALUE} >= o.total`;

  // Session source from a single event row. Host is normalised (scheme, www.,
  // port, query and fragment stripped) so google.com and www.google.com don't
  // split into two sources. Only ever evaluated on a session's *landing* row —
  // see SESSION_DIMS for why it must not be applied row-by-row.
  //
  // substring(), not regexp_replace(): regexp_replace returns the subject
  // UNCHANGED when the pattern doesn't match, so any referrer that wasn't a
  // plain http(s) URL became a "source" spelled out as a whole URL — one row per
  // distinct link, each one pushing a real source out of the top ten. The old
  // host class `[^/:]+` had the same effect on its own, keeping the query string
  // attached: `t.co?ref=x` and `t.co?ref=y` were two different sources.
  //
  // The scheme is matched generically so app referrers keep their identity —
  // android-app://com.google.android.gm reads as the Gmail app, which is a real
  // answer. Only a referrer that is present but unparseable falls through, and
  // it is labelled as such rather than folded into "direct": direct means nobody
  // referred them, and quietly inflating it flatters the shop's organic reach.
  const SRC_EXPR = `COALESCE(
    NULLIF(utm_source, ''),
    substring(referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:www\\.)?([^/:?#]+)'),
    CASE WHEN NULLIF(referrer, '') IS NULL THEN 'direct' ELSE '(unrecognised referrer)' END)`;

  // ── Dimension filters ─────────────────────────────────────────────────────
  // ?device=mobile|tablet|desktop and ?source=<name> scope every event-derived
  // metric. Both are properties of a *session*, not of individual event rows:
  //   • purchase rows are written server-side with no device/referrer/UTM, so a
  //     row-level filter drops every purchase and zeroes revenue, conversion and
  //     top products while showing 100% checkout abandonment;
  //   • a mid-session full page load clears document.referrer, so later rows in
  //     an organic session look "direct" and a row-level source filter splits
  //     one session across two sources.
  // So dimensions are resolved once per session from its landing event, and the
  // filter is session membership.
  const device = ['mobile', 'tablet', 'desktop'].includes(String(req.query.device)) ? String(req.query.device) : null;
  const rawSource = typeof req.query.source === 'string' ? req.query.source.slice(0, 100) : '';
  const source = rawSource && rawSource !== 'all' ? rawSource : null;
  const filtered = !!(device || source);

  // One row per session: the device and source of its first tracked browsing
  // event. Spans both windows ($3 → $2) so the same definition serves the
  // current period and the one it's compared against.
  const SESSION_DIMS = `
    SELECT DISTINCT ON (session_id) session_id,
           COALESCE(NULLIF(device, ''), 'unknown') AS device,
           ${SRC_EXPR} AS source
    FROM ${EVENTS} analytics_events
    WHERE created_at >= ${T3} AND created_at < ${T2}
      AND event_type NOT IN ('purchase', 'web_vital')
      AND session_id <> '${NO_SESSION}'
    ORDER BY session_id, created_at ASC, id ASC`;

  // Filter params start at $4 and are identical for every query, so the whole
  // set can share one params array — no per-query index bookkeeping.
  const filterParams = [];
  const dimConds = [];
  if (device) { dimConds.push(`sd.device = $${4 + filterParams.length}`); filterParams.push(device); }
  if (source) { dimConds.push(`sd.source = $${4 + filterParams.length}`); filterParams.push(source); }
  /** ` AND <col> IN (…matching sessions…)`, or '' when no filter is active. */
  const SF = (col = 'session_id') =>
    filtered ? ` AND ${col} IN (SELECT sd.session_id FROM (${SESSION_DIMS}) sd WHERE ${dimConds.join(' AND ')})` : '';

  // Restricts the orders table to orders whose purchase event belongs to a
  // matching session. Keeps filtered revenue on the authoritative order total
  // (refunds excluded, discounts applied) instead of the props snapshot, so a
  // filtered figure is always a true subset of the unfiltered one.
  const ORDER_ATTR = (idCol) =>
    filtered
      ? ` AND ${idCol}::text IN (SELECT props->>'order_id' FROM ${EVENTS} analytics_events
           WHERE event_type = 'purchase'
             AND created_at >= ${T3} AND created_at < ${T2G}${SF()})`
      : '';

  // ?attr=source|medium|campaign switches the attribution table's grouping.
  const ATTR_EXPRS = {
    source: SRC_EXPR,
    medium: `COALESCE(NULLIF(utm_medium, ''), '(none)')`,
    campaign: `COALESCE(NULLIF(utm_campaign, ''), '(none)')`,
  };
  const attr = ['source', 'medium', 'campaign'].includes(String(req.query.attr)) ? String(req.query.attr) : 'source';

  // The total stashed on begin_checkout events — the basket a shopper walked
  // away from. Read through the shared guard (see PROP_NUM): this is browser
  // input, and a bad cast here aborts the abandonment card and the sign-in wall.
  const PROPS_TOTAL = PROP_NUM('total');

  // A session counts as converted if it has a purchase event inside the window
  // or in the short grace period just after it (see T2G) — a checkout at 23:55
  // that pays at 00:03 is a sale, not an abandonment, but a purchase two months
  // later is not this window's conversion.
  const CONVERTED = `
    SELECT DISTINCT session_id FROM ${EVENTS} analytics_events
    WHERE event_type = 'purchase' AND created_at >= ${T1} AND created_at < ${T2G}
      AND session_id <> '${NO_SESSION}'`;

  try {
    // Current-window queries reference $3 only when a filter is active; the
    // two that always compare against the previous window pass it unconditionally.
    const PC = filtered ? [...w, ...filterParams] : [start, endExcl];
    const PW = [...w, ...filterParams];

    const [traffic, newVsReturning, funnel, daily, sales, customers, topProducts, topPages, landingPages, sources, devices, vitals, locations, vitalsByPage, abandoned, signinWall, accounts, searches] = await Promise.all([

      // Traffic KPIs — current window vs the previous window of the same length.
      pool.query(
        `SELECT
           COUNT(DISTINCT visitor_id) FILTER (WHERE created_at >= ${T1})::int AS visitors,
           COUNT(DISTINCT session_id) FILTER (WHERE created_at >= ${T1})::int AS sessions,
           COUNT(*) FILTER (WHERE event_type = 'page_view' AND created_at >= ${T1})::int AS pageviews,
           COUNT(DISTINCT visitor_id) FILTER (WHERE created_at < ${T1})::int AS prev_visitors,
           COUNT(DISTINCT session_id) FILTER (WHERE created_at < ${T1})::int AS prev_sessions,
           COUNT(*) FILTER (WHERE event_type = 'page_view' AND created_at < ${T1})::int AS prev_pageviews
         FROM ${EVENTS} analytics_events
         WHERE created_at >= ${T3} AND created_at < ${T2}
           AND event_type <> 'web_vital' AND session_id <> '${NO_SESSION}'${SF()}`,
        PW
      ),

      // New vs returning + bounce, over the current window only. A visitor is
      // "new" when their first event ever falls inside the window — first_seen
      // looks at each visitor's whole history, not the slice, but is restricted
      // to visitors seen in the window so it rides the (visitor_id, created_at)
      // index instead of grouping the entire table.
      // Bounce = one page view AND no engagement. Counting a session that added
      // to cart from a single product page as a bounce is a false positive.
      pool.query(
        `WITH scoped AS (
           SELECT visitor_id, session_id, event_type, visitor_scope, engagement_ms FROM ${EVENTS} analytics_events
           WHERE created_at >= ${T1} AND created_at < ${T2}
             AND event_type <> 'web_vital' AND session_id <> '${NO_SESSION}'${SF()}
         ), first_seen AS (
           SELECT visitor_id, MIN(created_at) AS first_at FROM ${EVENTS} analytics_events
           WHERE visitor_id IN (SELECT visitor_id FROM scoped) GROUP BY visitor_id
         ), sess AS (
           SELECT session_id,
                  COUNT(*) FILTER (WHERE event_type = 'page_view') AS pages,
                  -- A bounce is a session that arrived and DID nothing, so this
                  -- list is deliberate actions only. The view_* events are
                  -- deliberately absent: they fire automatically when a page
                  -- renders, so counting them would mark every single-page
                  -- landing as engaged and quietly drive the bounce rate to
                  -- zero. Searching, clicking a product, or signing up are
                  -- things the shopper chose to do, and were previously missed —
                  -- only cart and checkout counted, which overstated bounces.
                  BOOL_OR(event_type IN (
                    'select_item', 'search',
                    'add_to_cart', 'begin_checkout',
                    'add_shipping_info', 'add_payment_info', 'purchase',
                    'newsletter_signup', 'signup', 'login'
                  )) AS engaged,
                  -- GA4's definition of an ENGAGED session, and deliberately its
                  -- definition rather than one of our own: lasted at least ten
                  -- seconds, OR saw more than one page, OR converted. A metric
                  -- named "engagement rate" gets compared against every industry
                  -- benchmark the reader has ever seen, so it has to be the same
                  -- measurement those benchmarks are.
                  SUM(engagement_ms)::bigint AS engaged_ms,
                  BOOL_OR(event_type = 'purchase') AS purchased
           FROM scoped GROUP BY session_id
         ), vis AS (
           -- A visitor is recognisable across visits only when their id could be
           -- persisted; otherwise it dies with the tab and the same person
           -- returning tomorrow is counted as new. This no longer tracks the
           -- cookie answer — first-party measurement doesn't depend on it — so
           -- the remaining gap is browsers that refuse storage outright (Safari
           -- private mode, storage-blocking extensions). Tracking that share is
           -- what lets the panel state how far these two numbers can be trusted.
           SELECT visitor_id, BOOL_OR(visitor_scope = 'persistent') AS persistent
           FROM scoped GROUP BY visitor_id
         )
         SELECT
           (SELECT COUNT(*) FROM vis JOIN first_seen USING (visitor_id) WHERE first_at >= ${T1})::int AS new_visitors,
           (SELECT COUNT(*) FROM vis JOIN first_seen USING (visitor_id) WHERE first_at < ${T1})::int AS returning_visitors,
           (SELECT COUNT(*) FROM vis WHERE persistent)::int AS identified_visitors,
           (SELECT COUNT(*) FROM vis)::int AS total_visitors,
           (SELECT COUNT(*) FROM sess WHERE pages = 1 AND NOT engaged)::int AS bounced_sessions,
           (SELECT COUNT(*) FROM sess WHERE pages > 0)::int AS pageview_sessions,
           (SELECT COUNT(*) FROM sess
             WHERE engaged_ms >= 10000 OR pages >= 2 OR purchased)::int AS engaged_sessions,
           (SELECT COUNT(*) FROM sess)::int AS all_sessions,
           (SELECT COALESCE(SUM(engaged_ms), 0) FROM sess)::bigint AS total_engaged_ms,
           -- Whether this window has any engagement measurement AT ALL. Rows
           -- written before the column existed carry 0, and a window made
           -- entirely of those must report "not measured" rather than a
           -- confident 0% engagement and 0s average — which would read as a shop
           -- nobody looks at, and would get acted on.
           (SELECT COUNT(*) FROM sess WHERE engaged_ms > 0)::int AS timed_sessions`,
        PC
      ),

      // Conversion funnel — the GA4 ecommerce funnel, session by session.
      //
      // Two rules make it watertight:
      //
      // 1. MONOTONIC. Each stage counts sessions that reached it *or any later
      //    stage*, so the funnel can never widen as it descends: someone who
      //    lands straight on /products/<slug> from Instagram and buys is
      //    credited with browsing too. Counting stages independently produced
      //    ">100% of previous" steps and understated overall conversion.
      //
      // 2. EVENT-DRIVEN, WITH A PATH FALLBACK FOR HISTORY. Each stage is a thing
      //    the shopper did (view_item_list, view_item, view_cart…), not a guess
      //    from the URL — a /shop page_view proves the route was entered, not
      //    that any product was rendered, so an empty category used to count as
      //    browsing. The old path predicates are kept OR'd in purely so windows
      //    that predate the events still report: drop them and every historical
      //    funnel collapses to zero.
      //
      // The checkout stage keys on the /checkout page_view rather than on
      // begin_checkout alone, because begin_checkout changed meaning: it used to
      // fire on pressing Pay (post-validation) and now fires on arrival. The
      // page_view is the one signal that means the same thing on both sides of
      // that deploy, so the stage stays comparable across the boundary.
      //
      // Stage 1 uses the same predicate as the sessions KPI, so the funnel's
      // conversion figure and the Session conversion tile always agree.
      pool.query(
        `WITH scoped AS (
           SELECT session_id, event_type, path FROM ${EVENTS} analytics_events
           WHERE created_at >= ${T1} AND created_at < ${T2}
             AND event_type <> 'web_vital' AND session_id <> '${NO_SESSION}'${SF()}
         ), converted AS (${CONVERTED}
         ), sess AS (
           SELECT s.session_id,
             BOOL_OR(s.event_type = 'view_item_list'
                     OR (s.event_type = 'page_view' AND (s.path LIKE '/shop%' OR s.path LIKE '/deals%'))) AS browsed,
             -- Clicking a card in a grid. GA4's own stage, fired by the shared
             -- ProductCard, and until now visible in no section: it is the only
             -- thing that separates a shelf nobody scrolls from one whose
             -- products disappoint on the second click.
             BOOL_OR(s.event_type = 'select_item') AS selected,
             BOOL_OR(s.event_type = 'view_item'
                     OR (s.event_type = 'page_view' AND s.path LIKE '/products%')) AS viewed_item,
             BOOL_OR(s.event_type = 'add_to_cart') AS carted,
             BOOL_OR(s.event_type = 'view_cart'
                     OR (s.event_type = 'page_view' AND s.path LIKE '/basket%')) AS viewed_cart,
             -- Pressed "Proceed to Checkout". Sits between the basket and the
             -- checkout page because that is exactly where the sign-in gate
             -- stands: the gap between this stage and the next one IS the cost
             -- of demanding an account, and nothing else measures it.
             BOOL_OR(s.event_type = 'checkout_gate') AS gate,
             BOOL_OR(s.event_type = 'begin_checkout'
                     OR (s.event_type = 'page_view' AND s.path LIKE '/checkout%')) AS checkout,
             BOOL_OR(s.event_type = 'add_shipping_info') AS shipping,
             BOOL_OR(s.event_type = 'add_payment_info') AS payment,
             BOOL_OR(c.session_id IS NOT NULL) AS purchased
           FROM scoped s LEFT JOIN converted c USING (session_id)
           GROUP BY s.session_id
         )
         SELECT
           COUNT(*)::int AS visited,
           COUNT(*) FILTER (WHERE browsed OR selected OR viewed_item OR carted OR viewed_cart OR gate OR checkout OR shipping OR payment OR purchased)::int AS browsed,
           COUNT(*) FILTER (WHERE selected OR viewed_item OR carted OR viewed_cart OR gate OR checkout OR shipping OR payment OR purchased)::int AS selected,
           COUNT(*) FILTER (WHERE viewed_item OR carted OR viewed_cart OR gate OR checkout OR shipping OR payment OR purchased)::int AS viewed_item,
           COUNT(*) FILTER (WHERE carted OR viewed_cart OR gate OR checkout OR shipping OR payment OR purchased)::int AS carted,
           COUNT(*) FILTER (WHERE viewed_cart OR gate OR checkout OR shipping OR payment OR purchased)::int AS viewed_cart,
           COUNT(*) FILTER (WHERE gate OR checkout OR shipping OR payment OR purchased)::int AS gate,
           COUNT(*) FILTER (WHERE checkout OR shipping OR payment OR purchased)::int AS checkout,
           COUNT(*) FILTER (WHERE shipping OR payment OR purchased)::int AS shipping,
           COUNT(*) FILTER (WHERE payment OR purchased)::int AS payment,
           COUNT(*) FILTER (WHERE purchased)::int AS purchased,
           -- Did the deeper checkout steps exist at all in this window? Without
           -- this, a window from before they were instrumented shows a cliff
           -- from "Reached checkout" to a handful of purchasers and reads as
           -- catastrophic abandonment rather than as missing measurement.
           COUNT(*) FILTER (WHERE shipping)::int AS shipping_raw,
           COUNT(*) FILTER (WHERE payment)::int AS payment_raw,
           COUNT(*) FILTER (WHERE gate)::int AS gate_raw,
           COUNT(*) FILTER (WHERE selected)::int AS selected_raw
         FROM sess`,
        PC
      ),

      // Daily series — traffic from events, zero-filled. Sales always come from
      // the orders table; a device/source filter narrows *which orders* count
      // (via their purchase event's session) but never changes the money, so a
      // filtered bar is always a true subset of the unfiltered one.
      pool.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
                COALESCE(e.visitors, 0) AS visitors, COALESCE(e.sessions, 0) AS sessions,
                COALESCE(e.pageviews, 0) AS pageviews,
                COALESCE(o.orders, 0) AS orders, COALESCE(o.revenue, 0) AS revenue
         FROM (SELECT gs::date AS d FROM generate_series($1::date, $2::date - 1, '1 day') gs) days
         LEFT JOIN (
           SELECT ${DAY('created_at')} AS d, COUNT(DISTINCT visitor_id)::int AS visitors,
                  COUNT(DISTINCT session_id)::int AS sessions,
                  COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS pageviews
           FROM ${EVENTS} analytics_events
           WHERE created_at >= ${T1} AND created_at < ${T2}
             AND event_type <> 'web_vital' AND session_id <> '${NO_SESSION}'${SF()}
           GROUP BY 1
         ) e USING (d)
         LEFT JOIN (
           SELECT ${DAY('o.created_at')} AS d, COUNT(*)::int AS orders, ROUND(SUM(${NET_TOTAL}), 2)::float AS revenue
           FROM orders o
           WHERE o.created_at >= ${T1} AND o.created_at < ${T2} AND ${PAID}
             AND NOT (${FULLY_RETURNED})${ORDER_ATTR('o.id')}
           GROUP BY 1
         ) o USING (d)
         ORDER BY d`,
        PC
      ),

      // Sales KPIs — current vs previous window, always off the orders table so
      // revenue is money actually kept: charged total, less anything handed back
      // as a full refund or an approved return. attributed_orders reports how
      // many of this window's orders could be tied back to a tracked session;
      // anything less than `orders` is the exact amount by which the funnel,
      // conversion rate and attribution table under-report.
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE created_at >= ${T1})::int AS orders,
           COALESCE(ROUND(SUM(net) FILTER (WHERE created_at >= ${T1}), 2), 0)::float AS revenue,
           COALESCE(ROUND(AVG(net) FILTER (WHERE created_at >= ${T1}), 2), 0)::float AS aov,
           COUNT(*) FILTER (WHERE created_at < ${T1})::int AS prev_orders,
           COALESCE(ROUND(SUM(net) FILTER (WHERE created_at < ${T1}), 2), 0)::float AS prev_revenue,
           COALESCE(ROUND(AVG(net) FILTER (WHERE created_at < ${T1}), 2), 0)::float AS prev_aov,
           COUNT(*) FILTER (WHERE created_at >= ${T1} AND attributed)::int AS attributed_orders
         FROM (
           SELECT o.created_at, ${NET_TOTAL} AS net,
                  o.id::text IN (
                    SELECT props->>'order_id' FROM ${EVENTS} analytics_events
                    WHERE event_type = 'purchase'
                      AND created_at >= ${T3} AND created_at < ${T2G}
                      AND session_id <> '${NO_SESSION}'
                  ) AS attributed
           FROM orders o
           WHERE o.created_at >= ${T3} AND o.created_at < ${T2} AND ${PAID}
             AND NOT (${FULLY_RETURNED})${ORDER_ATTR('o.id')}
         ) s`,
        PW
      ),

      // Customer KPIs — lifetime view plus what happened inside the window.
      // "New customer" = first-ever paid order falls inside the window; "repeat
      // customer in window" = ordered in the window with an earlier paid order.
      pool.query(
        `WITH paid_orders AS (
           SELECT o.user_id, ${NET_TOTAL} AS total, o.created_at FROM orders o
           WHERE ${PAID} AND o.user_id IS NOT NULL AND NOT (${FULLY_RETURNED})
         ), per_customer AS (
           SELECT user_id, COUNT(*) AS orders, SUM(total) AS spent, MIN(created_at) AS first_order
           FROM paid_orders GROUP BY user_id
         )
         SELECT
           (SELECT COUNT(*) FROM per_customer)::int AS total_customers,
           (SELECT COUNT(*) FROM per_customer WHERE orders > 1)::int AS lifetime_repeat_customers,
           (SELECT COUNT(*) FROM per_customer WHERE first_order >= ${T1} AND first_order < ${T2})::int AS new_customers,
           (SELECT COUNT(DISTINCT p.user_id) FROM paid_orders p JOIN per_customer c USING (user_id)
             WHERE p.created_at >= ${T1} AND p.created_at < ${T2} AND c.first_order < ${T1})::int AS returning_customers,
           COALESCE((SELECT ROUND(AVG(spent), 2) FROM per_customer), 0)::float AS avg_lifetime_value,
           COALESCE((SELECT ROUND(AVG(orders), 2) FROM per_customer), 0)::float AS avg_orders_per_customer`,
        [start, endExcl]
      ),

      // Top products. Revenue is the line's share of what was actually charged:
      // the order's discount is prorated across its lines, so these figures roll
      // up to the Revenue KPI minus shipping instead of overstating every line by
      // the discount. Products added to cart but never bought are kept (FULL
      // JOIN) — a product with demand and no sales is exactly the leak ops needs
      // to see, and dropping it was hiding the worst rows.
      pool.query(
        `WITH line_items AS (
           SELECT item->>'product_id' AS product_id,
                  item->'product_data'->>'name' AS name,
                  COALESCE(${PROP_INT_EXPR(`item->>'quantity'`)}, 0) AS qty,
                  ${PRICE_NUM(`item->'product_data'->>'price'`)}
                    * COALESCE(${PROP_INT_EXPR(`item->>'quantity'`)}, 0)
                    * COALESCE(1 - COALESCE(o.discount_amount, 0) / NULLIF(o.subtotal, 0), 1) AS net
           FROM orders o, jsonb_array_elements(o.items) AS item
           WHERE o.created_at >= ${T1} AND o.created_at < ${T2} AND ${PAID}${ORDER_ATTR('o.id')}
             -- A line the customer returned and was refunded for was not sold.
             -- Leaving it in overstated both units and revenue for that product.
             AND NOT EXISTS (
               SELECT 1 FROM returns r
               WHERE r.order_id = o.id AND r.status = 'refunded'
                 AND r.product_id = item->>'product_id'
             )
         ), sold AS (
           SELECT product_id, MAX(name) AS name, SUM(qty)::int AS units,
                  ROUND(SUM(net), 2)::float AS revenue
           FROM line_items GROUP BY product_id
         ), sess_prod AS (
           -- What each session did with each product, one row per pair. Both
           -- rates below are shares of a session set, so their numerators must
           -- be the INTERSECTION of two sets, not two independent counts:
           --
           --   • view→cart was every carting session over every viewing one. A
           --     product added straight from the shop grid never fires
           --     view_item, so four carts over one view printed "400%" — a
           --     share of a set, larger than the set.
           --   • cart→buy was UNITS over carting sessions. One shopper buying
           --     three candles, out of two sessions that added them, read as
           --     "100% of carts converted" when the truth was half — and the
           --     card tells the reader that a low cart→buy means the loss is at
           --     checkout, so this overstated checkout health on every
           --     multi-unit line.
           --
           -- Counted per session, not per event, so re-reading a page or adding
           -- twice doesn't move the rate.
           SELECT props->>'product_id' AS product_id, session_id,
                  MAX(props->>'name') AS name,
                  BOOL_OR(event_type = 'view_item') AS viewed,
                  BOOL_OR(event_type = 'add_to_cart') AS carted,
                  -- Taking something back OUT of the basket was recorded from
                  -- the first day and reported nowhere. It is the sharpest
                  -- single signal a product has: someone wanted it enough to add
                  -- it and then changed their mind, which is a different problem
                  -- from never being added at all — usually price, delivery cost
                  -- or a second look at the description.
                  BOOL_OR(event_type = 'remove_from_cart') AS removed
           FROM ${EVENTS} analytics_events
           WHERE event_type IN ('view_item', 'add_to_cart', 'remove_from_cart')
             AND created_at >= ${T1} AND created_at < ${T2}
             AND props->>'product_id' IS NOT NULL AND session_id <> '${NO_SESSION}'${SF()}
           GROUP BY 1, 2
         ), buyers AS (
           -- The sessions that actually paid for each product.
           SELECT DISTINCT item->>'product_id' AS product_id, e.session_id
           FROM orders o
           JOIN LATERAL jsonb_array_elements(o.items) AS item ON TRUE
           JOIN ${EVENTS} e ON e.props->>'order_id' = o.id::text AND e.event_type = 'purchase'
           WHERE o.created_at >= ${T1} AND o.created_at < ${T2} AND ${PAID}
             AND e.session_id <> '${NO_SESSION}'${SF('e.session_id')}
             AND NOT EXISTS (
               SELECT 1 FROM returns r
               WHERE r.order_id = o.id AND r.status = 'refunded'
                 AND r.product_id = item->>'product_id'
             )
         ), engagement AS (
           -- Views is the denominator that turns "12 add-to-carts" into "12 out
           -- of 400 people who looked" — the difference between a product
           -- nobody finds and one everybody rejects, which units and revenue
           -- alone cannot tell apart.
           SELECT sp.product_id, MAX(sp.name) AS name,
                  COUNT(*) FILTER (WHERE sp.viewed)::int AS views,
                  COUNT(*) FILTER (WHERE sp.carted)::int AS add_to_carts,
                  COUNT(*) FILTER (WHERE sp.viewed AND sp.carted)::int AS viewed_then_carted,
                  COUNT(*) FILTER (WHERE sp.removed)::int AS removals,
                  COUNT(*) FILTER (WHERE sp.carted AND b.session_id IS NOT NULL)::int AS carted_then_bought
           FROM sess_prod sp
           LEFT JOIN buyers b ON b.product_id = sp.product_id AND b.session_id = sp.session_id
           GROUP BY sp.product_id
         ), joined AS (
           SELECT COALESCE(s.name, e.name, 'Unknown') AS name,
                  COALESCE(s.units, 0)::int AS units,
                  COALESCE(s.revenue, 0)::float AS revenue,
                  COALESCE(e.add_to_carts, 0)::int AS add_to_carts,
                  COALESCE(e.removals, 0)::int AS removals,
                  COALESCE(e.views, 0)::int AS views,
                  -- NULL, not 0, when nothing was viewed: no views means the rate
                  -- is unknown, and a 0% would read as "everyone rejected it".
                  CASE WHEN COALESCE(e.views, 0) > 0
                       THEN ROUND(e.viewed_then_carted::numeric * 100 / e.views, 1)::float
                  END AS view_to_cart_pct,
                  CASE WHEN COALESCE(e.add_to_carts, 0) > 0
                       THEN ROUND(e.carted_then_bought::numeric * 100 / e.add_to_carts, 1)::float
                  END AS cart_to_buy_pct
           FROM sold s FULL JOIN engagement e USING (product_id)
         ), ranked AS (
           SELECT *, ROW_NUMBER() OVER (ORDER BY revenue DESC, add_to_carts DESC, views DESC, name ASC) AS rn
           FROM joined
         )
         -- Folded, not truncated. The panel prints this table under the Revenue
         -- tile and the reader tots the column against it — so a bare LIMIT
         -- meant that the moment the shop listed an eleventh product the two
         -- stopped agreeing, with the difference appearing nowhere. The rates on
         -- the fold row are NULL because a blended view-to-cart across a dozen
         -- unrelated products is not a number anyone should act on.
         SELECT name, units, revenue, add_to_carts, removals, views,
                view_to_cart_pct, cart_to_buy_pct, rn AS ord
         FROM ranked WHERE rn <= 10
         UNION ALL
         SELECT '+ ' || COUNT(*) || ' more', SUM(units)::int, ROUND(SUM(revenue)::numeric, 2)::float,
                SUM(add_to_carts)::int, SUM(removals)::int, SUM(views)::int,
                NULL::float, NULL::float, 999999::bigint
         FROM ranked WHERE rn > 10 HAVING COUNT(*) > 0
         ORDER BY ord`,
        PC
      ),

      // Top pages by views + unique sessions.
      //
      // Folded past the top ten so the VIEWS column still totals to the Page
      // views tile. Its `sessions` is deliberately NULL on the fold row and
      // nowhere else: one visitor reads several pages, so per-page session
      // counts overlap and adding them up produces a number larger than the
      // sessions that exist. A dash says "cannot be added"; a total would be a
      // confident wrong answer, which is worse than no answer.
      pool.query(
        `WITH grouped AS (
           SELECT path, COUNT(*)::int AS views, COUNT(DISTINCT session_id)::int AS sessions
           FROM ${EVENTS} analytics_events
           WHERE event_type = 'page_view' AND created_at >= ${T1} AND created_at < ${T2}
             AND session_id <> '${NO_SESSION}'${SF()}
           GROUP BY path
         ), ranked AS (
           SELECT *, ROW_NUMBER() OVER (ORDER BY views DESC, path ASC) AS rn FROM grouped
         )
         SELECT path, views, sessions, rn AS ord FROM ranked WHERE rn <= 10
         UNION ALL
         SELECT '+ ' || COUNT(*) || ' more', SUM(views)::int, NULL::int, 999999::bigint
         FROM ranked WHERE rn > 10 HAVING COUNT(*) > 0
         ORDER BY ord`,
        PC
      ),

      // Landing pages — where visits BEGIN, with how many of them ended in a
      // sale. A standard report in both GA4 and Shopify, and absent here.
      //
      // It is not Top pages re-sorted. Top pages is dominated by whatever
      // everyone passes through on the way somewhere else; this is the front
      // door, and it is the only table that can tell you a page brings people
      // who buy rather than merely people. The two answer different questions
      // and routinely disagree about which page matters.
      //
      // Everything past the top ten is folded rather than dropped, for the same
      // reason the location table folds: every session has a landing page, so a
      // reader will total this column.
      pool.query(
        `WITH landing AS (
           SELECT DISTINCT ON (session_id) session_id, path
           FROM ${EVENTS} analytics_events
           WHERE event_type = 'page_view'
             AND created_at >= ${T1} AND created_at < ${T2}
             AND session_id <> '${NO_SESSION}'${SF()}
           ORDER BY session_id, created_at ASC, id ASC
         ), converted AS (${CONVERTED}
         ), grouped AS (
           SELECT l.path, COUNT(*)::int AS sessions,
                  COUNT(*) FILTER (WHERE c.session_id IS NOT NULL)::int AS purchased
           FROM landing l LEFT JOIN converted c USING (session_id)
           GROUP BY l.path
         ), ranked AS (
           SELECT *, ROW_NUMBER() OVER (ORDER BY sessions DESC, path ASC) AS rn FROM grouped
         )
         SELECT path, sessions, purchased, rn AS ord FROM ranked WHERE rn <= 10
         UNION ALL
         SELECT '+ ' || COUNT(*) || ' more', SUM(sessions)::int, SUM(purchased)::int, 999999::bigint
         FROM ranked WHERE rn > 10 HAVING COUNT(*) > 0
         ORDER BY ord`,
        PC
      ),

      // Attribution — grouped by source (default), medium, or campaign. Sessions
      // are attributed by their landing event; purchases join back on session and
      // read the charged order total, so a refunded order stops counting here the
      // same moment it stops counting in the Revenue KPI.
      // Purchases are deliberately NOT re-filtered by dimension: `landing` has
      // already restricted the session set, and purchase rows carry no device or
      // referrer of their own — filtering them again zeroed every row's revenue.
      // Everything past the top 10 is folded into one row so the columns still
      // add up to the session and revenue totals above.
      pool.query(
        `WITH landing AS (
           SELECT DISTINCT ON (session_id) session_id, ${ATTR_EXPRS[attr]} AS source
           FROM ${EVENTS} analytics_events
           WHERE created_at >= ${T1} AND created_at < ${T2}
             AND event_type NOT IN ('web_vital', 'purchase') AND session_id <> '${NO_SESSION}'${SF()}
           ORDER BY session_id, created_at ASC, id ASC
         ), attributed AS (
           -- One row per ORDER in the window that carries a tracked purchase
           -- event. Keyed on the order and deduped with DISTINCT ON: a
           -- re-flushed beacon or a retried finalize can write the same purchase
           -- twice, and counting event rows billed that order to this table
           -- twice — one €100 sale showed up as two orders and €200.
           --
           -- Selected by the ORDER's date, not the event's, so this table counts
           -- exactly the orders the Revenue KPI above counts.
           SELECT DISTINCT ON (o.id) e.session_id, o.id, ${NET_TOTAL} AS net
           FROM orders o
           JOIN ${EVENTS} e ON e.props->>'order_id' = o.id::text AND e.event_type = 'purchase'
           WHERE o.created_at >= ${T1} AND o.created_at < ${T2} AND ${PAID}
             AND NOT (${FULLY_RETURNED}) AND e.session_id <> '${NO_SESSION}'${SF('e.session_id')}
           ORDER BY o.id, e.created_at ASC
         ), purchases AS (
           SELECT session_id, COUNT(*)::int AS orders, SUM(net) AS revenue
           FROM attributed GROUP BY session_id
         ), grouped AS (
           SELECT l.source, COUNT(*)::int AS sessions,
                  COALESCE(SUM(p.orders), 0)::int AS orders,
                  COALESCE(SUM(p.revenue), 0) AS revenue
           FROM landing l LEFT JOIN purchases p USING (session_id)
           GROUP BY l.source
           UNION ALL
           -- Orders bought by a session that started BEFORE this window — a
           -- visit that spanned the boundary, or a checkout resumed later. They
           -- count in the Revenue KPI, so omitting them here would leave this
           -- table quietly failing to add up to the figure above it.
           SELECT '(visit began before this period)', 0, COUNT(*)::int, SUM(net)
           FROM attributed WHERE session_id NOT IN (SELECT session_id FROM landing)
           HAVING COUNT(*) > 0
         ), ranked AS (
           SELECT *, ROW_NUMBER() OVER (ORDER BY sessions DESC, source ASC) AS rn FROM grouped
         )
         SELECT source, sessions, orders, ROUND(revenue, 2)::float AS revenue, rn AS ord
         FROM ranked WHERE rn <= 10
         UNION ALL
         SELECT '+ ' || COUNT(*) || ' more', SUM(sessions)::int, SUM(orders)::int,
                ROUND(SUM(revenue), 2)::float, 999999::bigint
         FROM ranked WHERE rn > 10 HAVING COUNT(*) > 0
         ORDER BY ord`,
        PC
      ),

      // Device mix by sessions. The device is a property of the session (taken
      // from its landing event), not of each row: counting rows put any session
      // with a server-written purchase row into 'unknown' *as well as* its real
      // device, so the shares summed past 100%.
      pool.query(
        `SELECT COALESCE(sd.device, 'unknown') AS device, COUNT(DISTINCT e.session_id)::int AS sessions
         FROM ${EVENTS} e
         LEFT JOIN (${SESSION_DIMS}) sd USING (session_id)
         WHERE e.created_at >= ${T1} AND e.created_at < ${T2}
           AND e.event_type <> 'web_vital' AND e.session_id <> '${NO_SESSION}'${SF('e.session_id')}
         GROUP BY 1 ORDER BY sessions DESC`,
        PW
      ),

      // Web vitals — p75 per metric (the threshold Google grades against).
      pool.query(
        `SELECT props->>'metric' AS metric,
                ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY ${PROP_NUM('value')})::numeric, 4)::float AS p75,
                COUNT(*)::int AS samples
         FROM ${EVENTS} analytics_events
         WHERE event_type = 'web_vital' AND created_at >= ${T1} AND created_at < ${T2}
           AND ${PROP_NUM('value')} IS NOT NULL${SF()}
         GROUP BY 1`,
        PC
      ),

      // Where visitors are, by session and by what they spent.
      //
      // Resolved once per session from its landing event, for the same reason
      // device and source are (see SESSION_DIMS): a purchase row is written
      // server-side with no geo at all, so counting rows would report every
      // paying session as "Unknown" and make the location table useless exactly
      // where it matters most. DISTINCT ON picks the session's first browsing
      // event and the whole session — orders included — is credited to it.
      //
      // '' is reported as Unknown rather than dropped: a location table that
      // silently omits a third of the traffic invites the reader to treat the
      // rest as the whole picture.
      pool.query(
        `WITH sess_geo AS (
           -- Every session the Sessions KPI counts, so the table covers the
           -- same traffic the tiles do. Purchase rows are included but sorted
           -- LAST: they are written server-side with no geo, so a session with
           -- any located browsing event is placed by that, and only a session
           -- with nothing located at all falls through to Unknown.
           --
           -- They have to be in the set at all because a visit that began
           -- before the window and paid inside it has no other row here — it
           -- used to drop out of this table entirely, taking its revenue with
           -- it, so the busiest city by revenue could be a city with less
           -- revenue than the amount silently missing.
           SELECT DISTINCT ON (session_id) session_id,
                  COALESCE(NULLIF(geo_city, ''), 'Unknown') AS city,
                  COALESCE(NULLIF(geo_country, ''), '') AS country
           FROM ${EVENTS} analytics_events
           WHERE created_at >= ${T1} AND created_at < ${T2}
             AND event_type <> 'web_vital'
             AND session_id <> '${NO_SESSION}'${SF()}
           ORDER BY session_id, (NULLIF(geo_city, '') IS NULL), created_at ASC, id ASC
         ), sess_orders AS (
           -- Deduped by ORDER, then rolled up per session: DISTINCT ON the
           -- session credited only one order to a session that placed two, and
           -- counting raw event rows credited one order twice when its purchase
           -- beacon was flushed twice. Bounded by the order's own date so a
           -- past window can't collect revenue earned after it ended.
           SELECT session_id, COUNT(*)::int AS orders, SUM(net) AS net
           FROM (
             SELECT DISTINCT ON (o.id) e.session_id, o.id, ${NET_TOTAL} AS net
             FROM orders o
             JOIN ${EVENTS} e ON e.props->>'order_id' = o.id::text AND e.event_type = 'purchase'
             WHERE o.created_at >= ${T1} AND o.created_at < ${T2}
               AND e.session_id <> '${NO_SESSION}' AND ${PAID} AND NOT (${FULLY_RETURNED})
             ORDER BY o.id, e.created_at ASC
           ) x
           GROUP BY session_id
         ), grouped AS (
           SELECT g.city, g.country,
                  COUNT(*)::int AS sessions,
                  COALESCE(SUM(so.orders), 0)::int AS orders,
                  COALESCE(ROUND(SUM(so.net)::numeric, 2), 0)::float AS revenue
           FROM sess_geo g LEFT JOIN sess_orders so USING (session_id)
           GROUP BY 1, 2
         ), ranked AS (
           SELECT *, ROW_NUMBER() OVER (ORDER BY sessions DESC, revenue DESC, city ASC) AS rn
           FROM grouped
         )
         -- Everything past the top 15 is FOLDED into one row rather than
         -- dropped. This table is read as a distribution — the card is called
         -- "Where visitors are" and a reader tots the column up against the
         -- Sessions tile — so a bare LIMIT quietly lost every city past the
         -- fifteenth along with its revenue. A shop trading in one country and a
         -- dozen towns passes that limit easily, and the gap appears nowhere:
         -- no total, no note, just a column that no longer adds up to the
         -- headline figure above it, with the orders of the missing cities gone
         -- from the map while still counted in Revenue.
         SELECT city, country, sessions, orders, revenue, rn AS ord
         FROM ranked WHERE rn <= 15
         UNION ALL
         SELECT '+ ' || COUNT(*) || ' more', '', SUM(sessions)::int, SUM(orders)::int,
                ROUND(SUM(revenue)::numeric, 2)::float, 999999::bigint
         FROM ranked WHERE rn > 15 HAVING COUNT(*) > 0
         ORDER BY ord`,
        PC
      ),

      // The same metrics per page. A single site-wide "LCP 3.1s" says something
      // is slow but never which thing, and the answer is rarely uniform — one
      // heavy page can carry the whole site's grade. This is what turns the
      // number into an instruction.
      //
      // Pages with only a handful of samples are excluded: a p75 over three
      // visits is one unlucky phone on a train, and chasing it wastes the time
      // the real offender deserves.
      pool.query(
        `SELECT path,
                props->>'metric' AS metric,
                ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY ${PROP_NUM('value')})::numeric, 4)::float AS p75,
                COUNT(*)::int AS samples
         FROM ${EVENTS} analytics_events
         WHERE event_type = 'web_vital' AND created_at >= ${T1} AND created_at < ${T2}
           AND props->>'metric' IN ('LCP', 'INP', 'CLS')
           AND ${PROP_NUM('value')} IS NOT NULL
           AND path <> ''${SF()}
         GROUP BY 1, 2
        HAVING COUNT(*) >= 5
         ORDER BY 2, 3 DESC`,
        PC
      ),

      // Checkout abandonment — sessions that reached checkout but never bought,
      // with the basket value they walked away from. "Converted" is unbounded at
      // the top end (see CONVERTED): a payment started at 23:55 and confirmed at
      // 00:03 is a sale, and counting it as abandoned was a nightly false positive.
      //
      // Deliberately the SAME predicate as the funnel's checkout stage, so
      // `checkout_sessions` here and "Reached checkout" there are always the
      // same number. They were previously derived differently, which let the
      // card and the funnel disagree on screen about how many people got that
      // far. MAX(total) takes the basket at its largest — begin_checkout now
      // fires on arrival, so a session that reached checkout without pressing
      // Pay still carries the value it was about to spend.
      pool.query(
        `WITH checkout AS (
           SELECT session_id, MAX(${PROPS_TOTAL}) AS basket
           FROM ${EVENTS} analytics_events
           WHERE (event_type IN ('begin_checkout', 'add_shipping_info', 'add_payment_info')
                  OR (event_type = 'page_view' AND path LIKE '/checkout%'))
             AND created_at >= ${T1} AND created_at < ${T2}
             AND session_id <> '${NO_SESSION}'${SF()}
           GROUP BY session_id
         ), converted AS (${CONVERTED}
         ), reached AS (
           -- The funnel's checkout stage is monotonic: a session credited with a
           -- deeper stage counts as having reached checkout even if the shallower
           -- event never arrived (a dropped beacon, a hard reload mid-flush). This
           -- card must use the SAME session set or the two disagree on screen —
           -- which is precisely what the comment above used to promise and the
           -- old begin_checkout-only predicate could not deliver.
           SELECT session_id, basket FROM checkout
           UNION
           SELECT session_id, NULL::numeric FROM converted
           WHERE session_id IN (
             SELECT session_id FROM ${EVENTS} analytics_events
             WHERE created_at >= ${T1} AND created_at < ${T2}
               AND session_id <> '${NO_SESSION}'${SF()}
           )
         ), per_session AS (
           SELECT session_id, MAX(basket) AS basket FROM reached GROUP BY session_id
         )
         SELECT COUNT(*)::int AS checkout_sessions,
                COUNT(*) FILTER (WHERE c.session_id IS NULL)::int AS abandoned_sessions,
                COALESCE(ROUND(SUM(k.basket) FILTER (WHERE c.session_id IS NULL), 2), 0)::float AS lost_revenue
         FROM per_session k LEFT JOIN converted c USING (session_id)`,
        PC
      ),

      // The sign-in wall — the storefront's only gate, and the one number that
      // says what it costs. A session that pressed "Proceed to Checkout" as a
      // guest was asked to sign in; whether it then reached checkout at all is
      // the difference between a gate people walk through and a door they turn
      // around at. `blocked_basket_value` is the money sitting in the baskets
      // that never got past it — not a forecast, just what was in them.
      //
      // Signed-in presses are counted separately as the control group: if they
      // convert far better than guests from the same stage, the wall is the
      // difference, not the basket.
      pool.query(
        `WITH gate AS (
           SELECT session_id,
                  BOOL_OR(props->>'outcome' = 'signin_required') AS walled,
                  MAX(${PROPS_TOTAL}) AS basket
           FROM ${EVENTS} analytics_events
           WHERE event_type = 'checkout_gate'
             AND created_at >= ${T1} AND created_at < ${T2}
             AND session_id <> '${NO_SESSION}'${SF()}
           GROUP BY session_id
         ), reached AS (
           SELECT DISTINCT session_id FROM ${EVENTS} analytics_events
           WHERE (event_type = 'begin_checkout' OR (event_type = 'page_view' AND path LIKE '/checkout%'))
             AND created_at >= ${T1} AND created_at < ${T2}
             AND session_id <> '${NO_SESSION}'${SF()}
         ), converted AS (${CONVERTED}
         )
         SELECT
           COUNT(*)::int AS gate_sessions,
           COUNT(*) FILTER (WHERE g.walled)::int AS walled_sessions,
           COUNT(*) FILTER (WHERE g.walled AND r.session_id IS NOT NULL)::int AS walled_continued,
           COUNT(*) FILTER (WHERE g.walled AND c.session_id IS NOT NULL)::int AS walled_purchased,
           COUNT(*) FILTER (WHERE NOT g.walled)::int AS passed_sessions,
           COUNT(*) FILTER (WHERE NOT g.walled AND c.session_id IS NOT NULL)::int AS passed_purchased,
           COALESCE(ROUND(SUM(g.basket) FILTER (WHERE g.walled AND r.session_id IS NULL), 2), 0)::float
             AS blocked_basket_value
         FROM gate g
         LEFT JOIN reached r USING (session_id)
         LEFT JOIN converted c USING (session_id)`,
        PC
      ),

      // Joining the list, opening an account, coming back to sign in.
      //
      // All three have been recorded since analytics shipped and appeared in no
      // section — they existed only inside the bounce rule, as evidence that
      // SOMETHING deliberate had happened, with the number itself thrown away.
      // Newsletter signups in particular are the one number a shop can act on
      // when a month is quiet: the audience kept growing, or it didn't.
      //
      // Counted by SESSION, not by event, so a shopper who submits the form
      // twice because the first press didn't look like it worked is one signup.
      pool.query(
        `SELECT
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'newsletter_signup')::int AS newsletter_signups,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'signup')::int AS account_signups,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'login')::int AS sign_ins
         FROM ${EVENTS} analytics_events
         WHERE created_at >= ${T1} AND created_at < ${T2}
           AND event_type IN ('newsletter_signup', 'signup', 'login')
           AND session_id <> '${NO_SESSION}'${SF()}`,
        PC
      ),

      // What shoppers typed into the search box — recorded since the search
      // event shipped and, until now, reported nowhere at all.
      //
      // It is the only place on the whole dashboard where the shopper says what
      // they wanted in their own words. Everything else can only describe what
      // they did with what the shop already had: a candle nobody stocks cannot
      // appear in Top products, cannot show up as a lost basket, and leaves no
      // trace in the funnel — the shopper simply leaves, and every number reads
      // as a normal quiet day.
      //
      // `no_results` is the sharpest half. A busy term that finds nothing is a
      // request for something to stock, or a name the shop's own copy doesn't
      // use for a thing it already sells — and either one is fixable the same
      // afternoon.
      //
      // Only the submitted term is recorded, never the live keystrokes (see
      // handleSearch in NavbarSection), so these are whole searches rather than
      // prefixes of them. Trimmed and lowercased so "Candle" and "candle " are
      // one row.
      pool.query(
        `WITH grouped AS (
           SELECT LOWER(TRIM(props->>'query')) AS term,
                  COUNT(*)::int AS searches,
                  COUNT(DISTINCT session_id)::int AS sessions,
                  COUNT(*) FILTER (WHERE ${PROP_INT('results')} = 0)::int AS no_results
           FROM ${EVENTS} analytics_events
           WHERE event_type = 'search'
             AND created_at >= ${T1} AND created_at < ${T2}
             AND session_id <> '${NO_SESSION}'
             AND NULLIF(TRIM(props->>'query'), '') IS NOT NULL${SF()}
           GROUP BY 1
         ), ranked AS (
           SELECT *, ROW_NUMBER() OVER (ORDER BY searches DESC, sessions DESC, term ASC) AS rn
           FROM grouped
         )
         -- Folded like every other table here, so "how many searches found
         -- nothing" is answerable from the column rather than being however many
         -- the top fifteen happened to contain. The sessions column is NULL on
         -- the fold for the same reason it is on Top pages: one visitor searches
         -- several times, so those counts overlap and cannot be added.
         -- (No backticks in these comments: this is a JS template literal, and
         -- one would end the string mid-query.)
         SELECT term, searches, sessions, no_results, rn AS ord
         FROM ranked WHERE rn <= 15
         UNION ALL
         SELECT '+ ' || COUNT(*) || ' more', SUM(searches)::int, NULL::int, SUM(no_results)::int, 999999::bigint
         FROM ranked WHERE rn > 15 HAVING COUNT(*) > 0
         ORDER BY ord`,
        PC
      ),
    ]);

    const t = traffic.rows[0];
    const nvr = newVsReturning.rows[0];
    const s = sales.rows[0];
    const f = funnel.rows[0];

    // f.visited uses the same predicate as t.sessions, so the funnel's first
    // stage and the Sessions tile are the same number by construction — and the
    // conversion rate below is the funnel's own end-to-end rate, not a second
    // figure computed against a different denominator.
    const conversionRate = t.sessions ? +(f.purchased / t.sessions * 100).toFixed(2) : 0;

    res.json({
      // The window that was ACTUALLY measured. The panel prints these, never the
      // dates it asked for, so a clamped range can't be read as a fall in trade.
      start, end, days: lenDays, timezone: STORE_TZ,
      clamped,
      filters: { device, source, attr },
      // True when a device/source filter is active, so event-derived metrics
      // cover only orders that could be tied back to a matching session.
      attributed: filtered,
      abandoned: abandoned.rows[0],
      // Null when nothing in this window went through the gate — a window that
      // predates the event must show nothing rather than a row of confident
      // zeroes, same rule the funnel's optional stages follow.
      signin_wall: signinWall.rows[0]?.gate_sessions > 0 ? signinWall.rows[0] : null,
      // Instrumentation changes that fall inside the requested window. A number
      // whose DEFINITION moved mid-window is the one kind of inaccuracy no query
      // can fix, and comparing across the boundary silently reads the change as
      // shopper behaviour. Surfacing them is the honest option.
      measurement_notes: MEASUREMENT_CHANGES
        .filter(c => c.date >= start && c.date <= end)
        .map(({ date, note }) => ({ date, note })),
      traffic: {
        visitors: t.visitors, sessions: t.sessions, pageviews: t.pageviews,
        pages_per_session: t.sessions ? +(t.pageviews / t.sessions).toFixed(2) : 0,
        bounce_rate: nvr.pageview_sessions ? +(nvr.bounced_sessions / nvr.pageview_sessions * 100).toFixed(1) : 0,
        // GA4's engagement rate and average engagement time, or null when this
        // window predates the measurement. Null, never 0: the two are opposite
        // conclusions — "we have not measured this" versus "nobody engaged".
        engagement_rate: nvr.timed_sessions > 0 && nvr.all_sessions
          ? +(nvr.engaged_sessions / nvr.all_sessions * 100).toFixed(1)
          : null,
        avg_engagement_seconds: nvr.timed_sessions > 0 && nvr.all_sessions
          ? +(Number(nvr.total_engaged_ms) / nvr.all_sessions / 1000).toFixed(1)
          : null,
        new_visitors: nvr.new_visitors, returning_visitors: nvr.returning_visitors,
        // Share of this window's visitors carrying an id that survives the tab.
        // The rest cannot be recognised on a return visit, so they land in
        // "new" every time and inflate the visitor count — the panel says so
        // rather than presenting "returning" as a complete figure.
        identified_visitor_pct: nvr.total_visitors
          ? +(nvr.identified_visitors / nvr.total_visitors * 100).toFixed(1)
          : null,
        prev: { visitors: t.prev_visitors, sessions: t.prev_sessions, pageviews: t.prev_pageviews },
      },
      sales: {
        revenue: s.revenue, orders: s.orders, aov: s.aov,
        conversion_rate: conversionRate,
        // Orders in this window that carry a tracked session. When this is below
        // `orders`, the funnel, conversion rate and attribution table are
        // measuring fewer sales than actually happened — the panel says so
        // rather than letting the gap read as a genuine drop.
        attributed_orders: s.attributed_orders,
        prev: { revenue: s.prev_revenue, orders: s.prev_orders, aov: s.prev_aov },
      },
      customers: customers.rows[0],
      // The GA4 ecommerce funnel. Stages whose events did not exist anywhere in
      // this window are omitted entirely rather than reported as zero: a window
      // predating the checkout-step instrumentation would otherwise show a
      // cliff at "Added delivery details" that looks like every shopper
      // abandoning, when it only means nothing was measuring there yet. An
      // absent row is honest; a zero row is a lie the shop would act on.
      funnel: [
        { stage: 'Sessions', sessions: f.visited },
        { stage: 'Browsed a collection', sessions: f.browsed },
        ...(f.selected_raw > 0 ? [{ stage: 'Clicked a product', sessions: f.selected }] : []),
        { stage: 'Viewed a product', sessions: f.viewed_item },
        { stage: 'Added to cart', sessions: f.carted },
        { stage: 'Viewed basket', sessions: f.viewed_cart },
        ...(f.gate_raw > 0 ? [{ stage: 'Pressed checkout', sessions: f.gate }] : []),
        { stage: 'Reached checkout', sessions: f.checkout },
        ...(f.shipping_raw > 0 ? [{ stage: 'Added delivery details', sessions: f.shipping }] : []),
        ...(f.payment_raw > 0 ? [{ stage: 'Went to payment', sessions: f.payment }] : []),
        { stage: 'Purchased', sessions: f.purchased },
      ],
      daily: daily.rows,
      top_products: topProducts.rows.map(({ ord, ...row }) => row),
      top_pages: topPages.rows.map(({ ord, ...row }) => row),
      landing_pages: landingPages.rows.map(({ ord, ...row }) => row),
      // Zeroes here are honest and worth showing, unlike a missing funnel stage:
      // "nobody joined the list this month" is a real, actionable answer.
      accounts: accounts.rows[0],
      searches: searches.rows.map(({ ord, ...row }) => row),
      sources: sources.rows.map(({ ord, ...row }) => row),
      devices: devices.rows,
      locations: locations.rows.map(({ ord, ...row }) => row),
      web_vitals: vitals.rows,
      web_vitals_by_page: vitalsByPage.rows,
    });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── GET /api/admin/analytics/live — who's on the site right now ───────────────
// "Active" = any tracked event in the last 5 minutes. Cheap enough to poll.
app.get('/api/admin/analytics/live', requireAuth, async (_req, res) => {
  try {
    const [counts, pages] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT session_id)::int AS active_sessions,
                COUNT(DISTINCT visitor_id)::int AS active_visitors
         FROM ${EVENTS} analytics_events
         WHERE created_at > NOW() - INTERVAL '5 minutes'
           AND event_type <> 'web_vital' AND session_id <> '${NO_SESSION}'`
      ),
      // Where each active session currently is — its most recent page view.
      pool.query(
        `SELECT path, COUNT(*)::int AS sessions FROM (
           SELECT DISTINCT ON (session_id) session_id, path FROM ${EVENTS} analytics_events
           WHERE created_at > NOW() - INTERVAL '5 minutes' AND event_type = 'page_view'
           ORDER BY session_id, created_at DESC
         ) t GROUP BY path ORDER BY sessions DESC LIMIT 5`
      ),
    ]);
    res.json({ ...counts.rows[0], top_pages: pages.rows });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── Internal traffic — keeping the shop's own browsing out of the numbers ──────
// Two mechanisms, because neither covers the other's gap:
//
//   • ACCOUNTS survive a storage wipe but only catch the part of a visit that
//     happened after signing in — though because the exclusion is keyed on the
//     visitor, one sign-in retroactively clears that browser's whole history.
//   • A MARKED BROWSER catches purely anonymous testing (the common case: the
//     owner checking the homepage on a phone), but is a localStorage flag, so
//     clearing site data forgets it and it must be set again.
//
// Also reports which origins have been sending events, because the single most
// confusing way to invent visitors is to open the shop on two hostnames.
app.get('/api/admin/analytics/internal', requireAuth, async (req, res) => {
  try {
    const [setting, visitors, origins] = await Promise.all([
      pool.query(`SELECT value FROM site_settings WHERE key = 'analytics_internal'`),
      pool.query(`SELECT visitor_id, reason, detail, created_at FROM analytics_internal_visitors ORDER BY created_at DESC LIMIT 200`),
      pool.query(
        `SELECT COALESCE(NULLIF(origin, ''), '(not recorded)') AS origin,
                COUNT(DISTINCT visitor_id)::int AS visitors, COUNT(*)::int AS events
           FROM analytics_events
          WHERE created_at >= NOW() - INTERVAL '90 days'
          GROUP BY 1 ORDER BY events DESC LIMIT 20`
      ),
    ]);
    const value = setting.rows[0]?.value || {};
    const networks = Array.isArray(value.networks) ? value.networks : [];
    // Only ever the edge's answer. Offering req.ip here would invite the owner to
    // exclude a proxy address — or, from localhost, the loopback address, which
    // silently protects nothing.
    const ip = edgeClientIp(req);
    res.json({
      emails: Array.isArray(value.emails) ? value.emails : [],
      networks,
      // So the owner can add the network they're on without having to go and
      // look it up, and can see at a glance whether it's already covered.
      current_ip: ip || '',
      current_ip_excluded: !!ip && ipIsInternal(ip, networks),
      excluded_visitors: visitors.rows,
      counted_origins: countedOrigins,
      origins_seen: origins.rows,
    });
  } catch (err) { sendServerError(res, err); }
});

// Saves the account list, the network list, or both — whichever the body carries,
// so the two controls in the panel can't wipe each other by omission.
app.put('/api/admin/analytics/internal', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'analytics_internal'`);
    const current = rows[0]?.value || {};

    const emails = Array.isArray(req.body?.emails)
      ? req.body.emails.map((e) => String(e).toLowerCase().trim())
          // Either a full address, or '@domain' for every address at a domain.
          // '@' alone would match every account the shop has ever had.
          .filter((e) => e.length > 1 && e.length <= 200 && e.includes('@')
                      && (e.startsWith('@') ? /^@[^@\s]+\.[^@\s]+$/.test(e) : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))
          .slice(0, 50)
      : (Array.isArray(current.emails) ? current.emails : []);

    // An entry has to be an address this code can actually match, or it is a
    // silent no-op that reads as "excluded" on screen.
    const networks = Array.isArray(req.body?.networks)
      ? req.body.networks.map((n) => String(n).trim().toLowerCase())
          .filter((n) => {
            const [base] = n.split('/');
            const addr = normaliseIp(base);
            return !!addr && (ipv4Int(addr) !== null || ipv6Prefix(addr) !== null);
          }).slice(0, 50)
      : (Array.isArray(current.networks) ? current.networks : []);

    await pool.query(
      `INSERT INTO site_settings (key, value) VALUES ('analytics_internal', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify({ emails, networks })]
    );

    const priorNetworks = Array.isArray(current.networks) ? current.networks : [];
    const added   = networks.filter((n) => !priorNetworks.includes(n));
    const removed = priorNetworks.filter((n) => !networks.includes(n));

    // ── Accounts: make the list mean what the panel says it means ─────────────
    // Naming an account here has always been described as "your own testing
    // stops counting". It only ever did so from the account's NEXT visit,
    // because the visitor table is written at ingest — so the test checkouts
    // that account had already run stayed in the numbers, and nothing on screen
    // said otherwise.
    //
    // Two halves make it true. The dashboard's own view excludes any event
    // carrying an internal account outright (EXCLUDE_INTERNAL), which covers the
    // signed-in rows however old they are. This backfill covers the rest of the
    // same browsing: a test checkout is anonymous page views, then a sign-in,
    // then more anonymous page views, and only the middle of that carries the
    // account. Retiring the VISITOR takes the whole visit.
    await pool.query(
      `INSERT INTO analytics_internal_visitors (visitor_id, reason, detail)
       SELECT v.visitor_id, 'internal account', v.user_id::text
         FROM (${INTERNAL_ACCOUNT_VISITORS}) v
       ON CONFLICT (visitor_id) DO NOTHING`
    );

    // …and removing an account gives its browsing back. An exclusion the owner
    // has undone must never keep hiding traffic — that is a silent under-count,
    // which is the one direction of error nothing else on the dashboard can
    // reveal. Only marks made BY the account route are reconsidered; a browser
    // the owner marked by hand stays marked.
    //
    // TWO ways a mark can still be justified, and it needs only one:
    //
    //   • the account it names is still on the list. This is the load-bearing
    //     clause. Once a browser is marked, ingestion DROPS its batches — so a
    //     browser that has only ever visited while the account was already
    //     listed has no stored events naming that account at all, and a release
    //     that looked only for events would throw the mark away the next time
    //     any setting was saved, handing a morning of testing back to the
    //     numbers with nothing on screen to say why they moved;
    //   • it still has stored events carrying an internal account — which is
    //     what covers rows written before `detail` existed, and any browser
    //     whose sign-in predates the account being listed.
    //
    // Compared as text so a `detail` holding a network address (a different
    // reason, but the same column) can never reach a uuid cast.
    await pool.query(
      `DELETE FROM analytics_internal_visitors iv
        WHERE iv.reason = 'internal account'
          AND NOT EXISTS (SELECT 1 FROM users iu
                           WHERE iu.id::text = iv.detail
                             AND ${INTERNAL_EMAIL_MATCH('iu.email')})
          AND NOT EXISTS (SELECT 1 FROM (${INTERNAL_ACCOUNT_VISITORS}) v
                           WHERE v.visitor_id = iv.visitor_id)`
    );

    // ── Networks ──────────────────────────────────────────────────────────────
    // Adding a network cannot reach backwards on its own: no visitor's IP is
    // stored, so there is nothing to match yesterday's rows against. Each device
    // on the network clears its own history the next time it loads the shop, and
    // the browser doing the excluding — which is on that network, by definition —
    // clears its own straight away, so the owner sees the number move now rather
    // than wondering whether the setting took.
    //
    // Keyed on the address this request actually arrived from rather than on the
    // list having grown: adding one network while removing another leaves the
    // count unchanged, and the old length comparison silently did nothing.
    const visitorId = analyticsId(req.body?.visitor_id);
    const callerNetwork = added.length
      ? (matchedNetwork(edgeClientIp(req) || '', added)
         // The edge could not vouch for this request's address — the panel open
         // on a local copy, or a request that didn't pass through Netlify. The
         // panel only sends its visitor id when the owner pressed the button for
         // the network they are ON, so one added entry is unambiguous. Two would
         // not be, and a mark that can't name its network can never be released
         // precisely, so it is not made at all.
         ?? (added.length === 1 ? added[0] : null))
      : null;
    if (visitorId && callerNetwork) {
      await pool.query(
        `INSERT INTO analytics_internal_visitors (visitor_id, reason, detail)
         VALUES ($1, 'own network', $2)
         ON CONFLICT (visitor_id) DO NOTHING`,
        [visitorId, callerNetwork]
      );
    }

    // Visitors excluded by a network that has just been removed are released
    // again, and ONLY those — each mark records which network made it.
    //
    // This used to release nothing at all unless the last network was removed,
    // so taking one of two networks off the list left every device it had ever
    // excluded hidden permanently, with no control anywhere that could get them
    // back. Rows written before `detail` existed carry no network, so they are
    // released only when nothing is left to justify them.
    if (removed.length) {
      await pool.query(
        `DELETE FROM analytics_internal_visitors
          WHERE reason = 'own network'
            AND (detail = ANY($1::text[]) OR (detail = '' AND $2::int = 0))`,
        [removed, networks.length]
      );
    }

    // The ingest cache would otherwise serve the old list for up to a minute,
    // which reads as "I saved it and it did nothing".
    internalLoadedAt = 0;
    res.json({ success: true, emails, networks });
  } catch (err) { sendServerError(res, err); }
});

// Mark (or release) one browser. The id comes from the admin's own browser,
// which is the same visitor id it uses to shop — the admin panel is served from
// the storefront's origin, so there is exactly one id per browser.
app.post('/api/admin/analytics/internal/browser', requireAuth, async (req, res) => {
  const visitorId = analyticsId(req.body?.visitor_id);
  if (!visitorId) return res.status(400).json({ error: 'Invalid visitor id' });
  try {
    if (req.body?.enabled === false) {
      await pool.query(`DELETE FROM analytics_internal_visitors WHERE visitor_id = $1`, [visitorId]);
      return res.json({ success: true, enabled: false });
    }
    await pool.query(
      `INSERT INTO analytics_internal_visitors (visitor_id, reason, detail) VALUES ($1, 'browser marked in admin', '')
       ON CONFLICT (visitor_id) DO NOTHING`,
      [visitorId]
    );
    res.json({ success: true, enabled: true });
  } catch (err) { sendServerError(res, err); }
});

// ── GET /api/admin/analytics/sessions — the last few visits, one row each ─────
// The gap every other control leaves open. A browser is excluded by a flag in
// its own storage, a network by the address a visit arrives from, an account by
// who is signed in — and a visit that matched none of them at the time can never
// be reconsidered afterwards. That is not a corner case:
//
//   • a VPN puts the owner's own laptop on someone else's address, so the home
//     network never matches and the visit lands in the numbers as a shopper in
//     whichever city the VPN surfaced in;
//   • testing means private windows and cleared site data, each of which mints a
//     brand-new visitor with no flag on it;
//   • a phone, a spouse's laptop, a friend asked to "have a look at the site" —
//     none of them ever open the admin panel.
//
// So this lists what actually arrived, with enough of each visit to recognise it
// — when, roughly where, on what, how far it got, whether it bought — and the
// route below retires any one of them. It reads the RAW table on purpose:
// already-excluded visits are shown too, marked as such, because an exclusion
// nobody can see is one nobody can undo.
//
// No email, no address, no identity: the only new fact on screen is whether the
// visit was signed in at all. Tying a session to a person here would spend the
// same consent exemption the rest of this design exists to keep.
app.get('/api/admin/analytics/sessions', requireAuth, async (req, res) => {
  const days  = Math.min(Math.max(parseInt(req.query.days, 10)  || 7, 1), 90);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const only  = ['counted', 'excluded'].includes(String(req.query.only)) ? String(req.query.only) : 'all';

  // Same source rule the dashboard uses, so a row here reads the same as the
  // attribution table it will be compared against.
  const SRC = `COALESCE(
    NULLIF(utm_source, ''),
    substring(referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:www\\.)?([^/:?#]+)'),
    CASE WHEN NULLIF(referrer, '') IS NULL THEN 'direct' ELSE '(unrecognised referrer)' END)`;

  try {
    const { rows } = await pool.query(
      `WITH scoped AS (
         SELECT ae.*,
                EXISTS (SELECT 1 FROM users iu
                         WHERE iu.id = ae.user_id AND ${INTERNAL_EMAIL_MATCH('iu.email')}) AS internal_account
           FROM analytics_events ae
          WHERE ae.created_at >= NOW() - make_interval(days => $1::int)
            AND ae.session_id <> '${NO_SESSION}'
            AND ae.event_type <> 'web_vital'
       ), agg AS (
         SELECT session_id, MIN(visitor_id) AS visitor_id,
                MIN(created_at) AS started_at, MAX(created_at) AS last_at,
                COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS pageviews,
                COUNT(*)::int AS events,
                BOOL_OR(user_id IS NOT NULL) AS signed_in,
                BOOL_OR(internal_account) AS internal_account
           FROM scoped GROUP BY session_id
       ), landing AS (
         -- The session's first BROWSING event: a server-written purchase row
         -- carries no device, referrer or path, so letting it land first would
         -- describe every paying visit as an unknown device arriving from
         -- nowhere — exactly the rows the owner most needs to identify.
         SELECT DISTINCT ON (session_id) session_id, path AS entry_path,
                COALESCE(NULLIF(device, ''), 'unknown') AS device, ${SRC} AS source
           FROM scoped WHERE event_type <> 'purchase'
          ORDER BY session_id, created_at ASC, id ASC
       ), geo AS (
         -- Located rows first, so a session is placed by wherever it browsed
         -- from and only falls through to Unknown when nothing was located.
         SELECT DISTINCT ON (session_id) session_id,
                COALESCE(NULLIF(geo_city, ''), 'Unknown') AS city,
                COALESCE(NULLIF(geo_country, ''), '') AS country
           FROM scoped
          ORDER BY session_id, (NULLIF(geo_city, '') IS NULL), created_at ASC, id ASC
       ), ord AS (
         -- Deduped by ORDER: a re-flushed purchase beacon would otherwise bill
         -- the same sale to the visit twice.
         SELECT session_id, COUNT(*)::int AS orders, ROUND(SUM(total), 2)::float AS revenue
           FROM (
             SELECT DISTINCT ON (o.id) e.session_id, o.id, o.total
               FROM orders o
               JOIN scoped e ON e.props->>'order_id' = o.id::text AND e.event_type = 'purchase'
              WHERE o.payment_status = 'paid'
              ORDER BY o.id, e.created_at ASC
           ) x GROUP BY session_id
       )
       SELECT a.session_id, a.visitor_id, a.started_at, a.last_at,
              a.pageviews, a.events, a.signed_in,
              COALESCE(l.entry_path, '') AS entry_path,
              COALESCE(l.device, 'unknown') AS device,
              COALESCE(l.source, 'direct') AS source,
              COALESCE(g.city, 'Unknown') AS city, COALESCE(g.country, '') AS country,
              COALESCE(o.orders, 0)::int AS orders, COALESCE(o.revenue, 0)::float AS revenue,
              (iv.visitor_id IS NOT NULL OR a.internal_account) AS excluded,
              COALESCE(iv.reason, CASE WHEN a.internal_account THEN 'internal account' ELSE '' END) AS excluded_reason,
              COALESCE(iv.detail, '') AS excluded_detail
         FROM agg a
         LEFT JOIN landing l USING (session_id)
         LEFT JOIN geo g USING (session_id)
         LEFT JOIN ord o USING (session_id)
         LEFT JOIN analytics_internal_visitors iv ON iv.visitor_id = a.visitor_id
        WHERE $3 = 'all'
           OR ($3 = 'excluded' AND (iv.visitor_id IS NOT NULL OR a.internal_account))
           OR ($3 = 'counted'  AND iv.visitor_id IS NULL AND NOT a.internal_account)
        ORDER BY a.started_at DESC
        LIMIT $2`,
      [days, limit, only]
    );
    res.json({ days, sessions: rows });
  } catch (err) { sendServerError(res, err); }
});

// Retire (or restore) any visitor by id — the one from a row in the list above.
//
// Separate from /internal/browser, which is specifically "the browser I am
// sitting at", because the reason it writes is what the release logic keys on:
// a visit retired by hand from this list must survive the owner later clearing
// their account list or swapping broadband, and must never be swept up by either.
app.post('/api/admin/analytics/internal/visitor', requireAuth, async (req, res) => {
  const visitorId = analyticsId(req.body?.visitor_id);
  if (!visitorId) return res.status(400).json({ error: 'Invalid visitor id' });
  try {
    if (req.body?.enabled === false) {
      // Only marks made from this list are undone here. A visitor excluded
      // because it is signed in as an internal account cannot be released from
      // this button — the account list is where that decision lives, and
      // pretending otherwise would put a control on screen that silently fails.
      const { rowCount } = await pool.query(
        `DELETE FROM analytics_internal_visitors
          WHERE visitor_id = $1 AND reason <> 'internal account'`,
        [visitorId]
      );
      return res.json({ success: true, enabled: false, released: rowCount > 0 });
    }
    await pool.query(
      `INSERT INTO analytics_internal_visitors (visitor_id, reason, detail)
       VALUES ($1, 'marked from recent visits', '')
       ON CONFLICT (visitor_id) DO NOTHING`,
      [visitorId]
    );
    res.json({ success: true, enabled: true });
  } catch (err) { sendServerError(res, err); }
});

// ── Google Analytics 4: the half that can't live in content ────────────────────
//
// Everything the owner sets about GA4 is ordinary content (see
// content_googleAnalytics) with one exception: the Measurement Protocol API
// secret, which is a credential and must never be readable by the storefront.
// Anyone holding it can write events into the property — inventing revenue,
// forging conversions — so it lives behind admin auth, and the value itself is
// never sent back out. The panel gets a hint (last four characters) and a yes/no,
// which is enough to answer "is one saved, and is it the one I pasted?".

app.get('/api/admin/ga4', requireAuth, async (_req, res) => {
  try {
    const [settings, secret, source] = await Promise.all([
      getGoogleAnalyticsSettings(), getGa4ApiSecret(), ga4SecretSource(),
    ]);
    res.json({
      measurement_id: settings.measurementId,
      enabled: settings.enabled,
      api_secret_set: !!secret,
      api_secret_source: source,
      api_secret_hint: secret ? `••••${secret.slice(-4)}` : null,
    });
  } catch (err) { sendServerError(res, err); }
});

app.put('/api/admin/ga4/secret', requireAuth, async (req, res) => {
  // The env var is the better home for this, so it wins — but it must win
  // loudly. Silently ignoring a value the owner typed and saved would leave them
  // believing they had changed something they hadn't.
  if (String(process.env.GA4_API_SECRET || '').trim())
    return res.status(409).json({ error: 'GA4_API_SECRET is set on the server, and that takes precedence. Change it there rather than here.' });

  const raw = req.body?.api_secret;
  if (raw !== null && typeof raw !== 'string') return res.status(400).json({ error: 'api_secret must be a string, or null to clear it' });
  const secret = typeof raw === 'string' ? raw.trim() : '';
  // Google's secrets are opaque, so this only rejects the obviously-wrong: an
  // empty-ish paste, or something long enough to be a whole config file.
  if (secret && (secret.length < 8 || secret.length > 200))
    return res.status(400).json({ error: "That doesn't look like a Measurement Protocol API secret." });
  try {
    await setGa4ApiSecret(secret || null);
    res.json({
      success: true,
      api_secret_set: !!secret,
      api_secret_hint: secret ? `••••${secret.slice(-4)}` : null,
    });
  } catch (err) { sendServerError(res, err); }
});

/**
 * Exercise the server-side half, before an order depends on it.
 *
 * The purchase event is the one measurement here that nobody can verify by
 * browsing the shop: it is written by the server, minutes after the fact, from a
 * credential the owner pasted once. Without this button the first evidence of a
 * broken setup is an empty revenue report weeks later.
 *
 * WHAT THIS CAN AND CANNOT PROVE — and the answer is smaller than it looks, so
 * the response copy has to be honest about it. The Measurement Protocol does not
 * authenticate. Its validation endpoint checks the shape of the payload and
 * nothing else: a wrong measurement id, a wrong API secret, or NO api_secret at
 * all all come back 200 with an empty validationMessages list. (Verified against
 * the live endpoint, not assumed.) So:
 *
 *   provable here  — the server can reach Google, and the payload we build is
 *                    one GA4 accepts;
 *   NOT provable   — that the credentials point at the owner's property.
 *
 * Which makes the useful design a directed check the owner finishes in GA4: send
 * one live `admin_test` event and tell them exactly where to look for it and
 * what its absence means. `admin_test` is a name of ours — it is not a purchase,
 * so it cannot contaminate revenue whichever property it lands in.
 */
app.post('/api/admin/ga4/test', requireAuth, async (_req, res) => {
  try {
    const settings = await getGoogleAnalyticsSettings();
    if (!settings.measurementId)
      return res.json({ ok: false, problem: 'No measurement ID saved yet. Add one above and save.' });

    const apiSecret = await getGa4ApiSecret();
    if (!apiSecret)
      return res.json({ ok: false, problem: 'No API secret saved yet — the server can only report purchases with one.' });

    const clientId = `${Math.floor(Math.random() * 1e9)}.${Math.floor(Date.now() / 1000)}`;
    const common = { measurementId: settings.measurementId, apiSecret, clientId };

    const check = await sendGa4Event({
      ...common,
      name: 'purchase',
      params: {
        transaction_id: `admin-test-${Date.now()}`,
        currency: 'EUR', value: 1, shipping: 0,
        items: [{ item_id: 'admin-test', item_name: 'Admin test item', price: 1, quantity: 1 }],
      },
      debug: true,
    });

    if (!check.ok)
      return res.json({ ok: false, problem: `Couldn't reach Google's collection endpoint (HTTP ${check.status}). That's a network problem between this server and Google, not a settings one.` });
    if (check.validation.length)
      return res.json({ ok: false, problem: `Google rejected the purchase payload: ${check.validation.map(v => v.description).join(' ')}`, validation: check.validation });

    // The payload is one GA4 will take. Now send a real event so the owner can
    // go and confirm the half this server cannot check for them.
    const live = await sendGa4Event({
      ...common,
      name: 'admin_test',
      params: { source: 'admin_panel', debug_mode: true },
    });

    res.json({
      ok: live.ok,
      delivered: live.ok,
      message: live.ok
        ? `Sent an 'admin_test' event to ${settings.measurementId}. Now go and look for it: GA4 → Reports → Realtime, or Admin → DebugView. It should appear within a minute.\n\nThat last step is the actual test. Google's collection endpoint accepts any measurement ID and any API secret without complaint — it never says whether they're yours — so if nothing shows up in GA4, one of the two is wrong.`
        : "Google didn't accept the live send. Try again in a moment.",
      problem: live.ok ? undefined : "Google didn't accept the live send. Try again in a moment.",
    });
  } catch (err) {
    // A network failure here is information, not a server fault: it is what the
    // owner needs to see.
    res.json({ ok: false, problem: `Couldn't reach Google: ${err.message}` });
  }
});


// ── Meta Pixel: the half that can't live in content ────────────────────────────
//
// Same split as GA4 above. Everything the owner sets about the pixel is ordinary
// content (see content_metaPixel) with one exception: the Conversions API access
// token, which is a credential and must never be readable by the storefront.
// Anyone holding it can write conversions into the pixel — inventing revenue,
// forging purchases, and teaching the ad delivery system to chase whoever they
// say converted — so it lives behind admin auth, and the value itself is never
// sent back out. The panel gets a hint (last four characters) and a yes/no,
// which is enough to answer "is one saved, and is it the one I pasted?".

app.get('/api/admin/meta', requireAuth, async (_req, res) => {
  try {
    const [settings, token, source] = await Promise.all([
      getMetaPixelSettings(), getMetaAccessToken(), metaTokenSource(),
    ]);
    res.json({
      pixel_id: settings.pixelId,
      enabled: settings.enabled,
      access_token_set: !!token,
      access_token_source: source,
      access_token_hint: token ? `••••${token.slice(-4)}` : null,
      graph_version: META_GRAPH_VERSION,
    });
  } catch (err) { sendServerError(res, err); }
});

app.put('/api/admin/meta/token', requireAuth, async (req, res) => {
  // The env var is the better home for this, so it wins — but it must win
  // loudly. Silently ignoring a value the owner typed and saved would leave them
  // believing they had changed something they hadn't.
  if (String(process.env.META_CAPI_TOKEN || '').trim())
    return res.status(409).json({ error: 'META_CAPI_TOKEN is set on the server, and that takes precedence. Change it there rather than here.' });

  const raw = req.body?.access_token;
  if (raw !== null && typeof raw !== 'string') return res.status(400).json({ error: 'access_token must be a string, or null to clear it' });
  const token = typeof raw === 'string' ? raw.trim() : '';
  // Meta's system-user tokens are long opaque strings — usually 150+ characters
  // and starting EAA. This rejects only the obviously-wrong: a truncated paste,
  // or something long enough to be a whole config file. Deliberately not an
  // `EAA` prefix check, because Meta has changed that prefix before and a
  // panel that refuses a valid token is worse than one that accepts a bad one
  // (the test button below catches the bad one in five seconds).
  if (token && (token.length < 20 || token.length > 500))
    return res.status(400).json({ error: "That doesn't look like a Conversions API access token — they're a long string, usually starting EAA." });
  try {
    await setMetaAccessToken(token || null);
    res.json({
      success: true,
      access_token_set: !!token,
      access_token_hint: token ? `••••${token.slice(-4)}` : null,
    });
  } catch (err) { sendServerError(res, err); }
});

/**
 * Prove the server-side half works, before an order depends on it.
 *
 * THIS TEST CAN PROVE MORE THAN THE GA4 ONE NEXT DOOR, and the difference is
 * worth stating because it changes what the owner should conclude from a green
 * result. GA4's Measurement Protocol does not authenticate: a wrong measurement
 * id and a wrong API secret both come back 200, so that button can only ever say
 * "the payload is well-formed, now go and look in GA4". Meta's Graph API DOES
 * authenticate, and answers with which thing is wrong:
 *
 *   (#190) Invalid OAuth access token    — the token is wrong or expired
 *   (#200) Permissions error             — the token is real but has no access
 *                                          to THIS pixel
 *   (#803) … does not exist              — the pixel id is wrong
 *   Unsupported post request             — usually the pixel id is an ad
 *                                          account id or a business id
 *
 * So a success here means the credentials genuinely belong together and Meta
 * accepted the event. Its exact words are passed through rather than
 * paraphrased: each of the above points at a different fix.
 *
 * The event is called `AdminTest`, not `Purchase`. A test that wrote a purchase
 * into the pixel would put invented revenue in the owner's ad reporting and, far
 * worse, into what the delivery system learns about who buys.
 */
app.post('/api/admin/meta/test', requireAuth, async (_req, res) => {
  try {
    const settings = await getMetaPixelSettings();
    if (!settings.pixelId)
      return res.json({ ok: false, problem: 'No pixel ID saved yet. Add one above and press Save Changes.' });

    const accessToken = await getMetaAccessToken();
    if (!accessToken)
      return res.json({ ok: false, problem: 'No access token saved yet — the server can only report purchases with one.' });

    const result = await sendMetaEvent({
      pixelId: settings.pixelId,
      accessToken,
      testEventCode: settings.testEventCode,
      event: {
        event_name: 'AdminTest',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `admin-test-${Date.now()}`,
        action_source: 'website',
        event_source_url: `${FRONTEND_URL}/`,
        // A real-shaped identifier so Meta exercises the same matching path a
        // purchase will, without describing an actual person — and hashed by the
        // same function the purchase uses, so this is a rehearsal of the real
        // payload rather than a differently-shaped one that happens to be taken.
        user_data: {
          client_user_agent: 'OliveGooseAdminTest/1.0',
          external_id: hashExternalId(`admin-test-${Date.now()}`),
        },
        custom_data: { source: 'admin_panel' },
      },
    });

    if (!result.ok)
      return res.json({ ok: false, problem: `Meta rejected it: ${result.error}` });

    const where = settings.testEventCode
      ? `Events Manager → your pixel → Test Events. It's tagged ${settings.testEventCode}, so it should appear there within seconds.`
      : 'Events Manager → your pixel → Overview. With no Test Events code set it goes to your live stream, which can take up to 20 minutes to show — set a Test Events code above if you want to watch it arrive now.';

    res.json({
      ok: true,
      delivered: true,
      events_received: result.eventsReceived,
      message: `Meta accepted an 'AdminTest' event for pixel ${settings.pixelId}.\n\nThat is a real check, not just a reachable server: Meta authenticates this call, so an accepted event means the access token is valid AND has permission for this exact pixel. Purchases will be reported.\n\nTo see it: ${where}`
        + (result.messages.length ? `\n\nMeta also said: ${result.messages.join(' ')}` : ''),
    });
  } catch (err) {
    // A network failure here is information, not a server fault: it is what the
    // owner needs to see.
    res.json({ ok: false, problem: `Couldn't reach Meta: ${err.message}` });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// LEGACY ADMIN CONTENT ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/settings', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM site_settings WHERE key = 'hero'");
    res.json(rows[0]?.value || {});
  } catch (err) { sendServerError(res, err); }
});

app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO site_settings (key, value) VALUES ('hero', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(req.body)]
    );
    res.json({ success: true });
  } catch (err) { sendServerError(res, err); }
});

// Every section in one round trip. The storefront primes its content cache from
// this on boot: fetching the ~28 sections individually left a window where pages
// had nothing to render but the bundled defaults, and that window was long enough
// to see. Same exposure as the per-section GET below — it is the same rows.
app.get('/api/content', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM site_settings WHERE key LIKE 'content\\_%'"
    );
    const sections = {};
    for (const row of rows) sections[row.key.slice('content_'.length)] = row.value;
    res.json(sections);
  } catch (err) { sendServerError(res, err); }
});

app.get('/api/content/:section', async (req, res) => {
  const key = `content_${req.params.section}`;
  try {
    const { rows } = await pool.query('SELECT value FROM site_settings WHERE key = $1', [key]);
    res.json(rows[0]?.value || null);
  } catch (err) { sendServerError(res, err); }
});

app.put('/api/content/:section', requireAuth, async (req, res) => {
  const section = req.params.section;
  const key = `content_${section}`;
  try {
    let body = req.body;

    if (section === 'products') {
      const { rows: prevRows } = await pool.query('SELECT value FROM site_settings WHERE key = $1', [key]);
      getAutomationSettings()
        .then(settings => evaluateBackInStockDecisions(prevRows[0]?.value?.items, req.body?.items, settings))
        .catch(err => console.error('[evaluateBackInStockDecisions]', err));
    }

    // Deals save: drop bundle product_ids that don't match a real product, so a stale
    // or mistyped reference can't be stored and silently break the discount.
    if (section === 'deals' && Array.isArray(body?.bundles)) {
      const { rows: prodRows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_products'`);
      const { bundles } = sanitizeBundles(body.bundles, prodRows[0]?.value?.items || []);
      body = { ...body, bundles };
    }

    await pool.query(
      `INSERT INTO site_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(body)]
    );

    // Products save: a delete/rename here can orphan bundle references — cascade-clean
    // the deals so no bundle points at a product that no longer exists.
    if (section === 'products') {
      await cascadeCleanDeals(body?.items || []);
    }

    res.json({ success: true });
  } catch (err) { sendServerError(res, err); }
});

app.post('/api/subscribers', publicWriteLimiter, async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254)
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  try {
    // Insert the subscriber if new; a duplicate is fine — an already-subscribed
    // person who never received (or lost) their unused welcome code should still
    // be able to get it, not be stonewalled. This also backfills everyone who
    // subscribed before the discount feature existed.
    const insert = await pool.query(
      `INSERT INTO subscribers (email) VALUES ($1)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email]
    );
    const isNew = insert.rows.length > 0;

    // Resolve the welcome discount for this email, driven by the admin's signup-
    // popup settings. Best-effort throughout: a mail hiccup must never 500.
    let discount = null;   // code available to show/apply
    let alreadyUsed = false; // subscribed, but the welcome code is already spent
    try {
      const { rows: popupRows } = await pool.query(
        `SELECT value FROM site_settings WHERE key = 'content_subscribePopup'`
      );
      const popup = popupRows[0]?.value || {};
      const percent = Number(popup.discount_percent) || 0;
      const offerOn = popup.enabled !== false && percent > 0;
      if (offerOn) {
        // Idempotent: returns the existing code for this email, or mints one.
        const codeRow = await issueSubscriberDiscountCode(email, percent);
        if (codeRow.redeemed_at) {
          alreadyUsed = true;
        } else {
          const { delivered } = await sendDiscountCodeEmail(email, {
            code: codeRow.code,
            discountPercent: Number(codeRow.discount_percent),
            shopUrl: `${FRONTEND_URL}/shop`,
          }).catch((err) => {
            // Log the actual Resend failure (unverified sending domain, restricted
            // key, invalid recipient, etc.) so a "no email arrived" report is
            // diagnosable from the server logs rather than a silent swallow.
            console.error('[sendDiscountCodeEmail] delivery failed:', err?.message || err);
            return { delivered: false };
          });
          // The code itself is NOT returned to the browser. Email is the only way
          // to receive it, which is what makes the offer cost something to claim:
          // echoing it in the response turned the signup card into a code
          // dispenser — type any made-up address, read the code off the screen (or
          // out of the network tab), repeat. Delivering it to the mailbox means a
          // claimer has to own the mailbox. If delivery fails the shopper is told
          // so and the code still exists server-side, so the admin can look it up
          // under Ops → Discount codes and send it on.
          discount = { discount_percent: Number(codeRow.discount_percent), email_delivered: delivered };
        }
      }
    } catch (err) {
      console.error('[issueSubscriberDiscountCode]', err);
    }

    // "This mailbox already spent its welcome discount" outranks "this exact
    // spelling is new to the list". A +tag alias of a redeemed address is a genuinely
    // new subscriber row, but answering 201-with-no-discount would show the signup
    // card's success view promising an email that is never coming. Say plainly that
    // the discount is gone — that's the part the shopper is asking about, and they
    // stay subscribed either way.
    if (alreadyUsed) return res.status(409).json({ error: 'already_subscribed', already_used: true });
    if (isNew) return res.status(201).json({ email, already_subscribed: false, discount });
    // Already on the list. If there's still an unused code, re-send it (200);
    // otherwise there's genuinely nothing to give (offer switched off) → 409, and
    // the signup card invites them to try a different email.
    if (discount) return res.status(200).json({ email, already_subscribed: true, discount });
    return res.status(409).json({ error: 'already_subscribed', already_used: false });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/discount/validate — pre-checkout "apply code" check (customer) ──
// Read-only: tells the checkout page whether a code is usable and for what %.
// The binding hold + authoritative re-check happen at session creation.
app.post('/api/discount/validate', requireUserAuth, discountValidateLimiter, async (req, res) => {
  try {
    const result = await inspectDiscountCode(req.body?.code, req.user.userId);
    res.json(result);
  } catch (err) { sendServerError(res, err); }
});

// ── GET /api/discount/mine — this shopper's own unspent welcome code ─────────
// The code is emailed at subscribe time and shown nowhere else, so a shopper who
// deleted or never received that email had no way back to it and simply paid full
// price. This returns only a code already bound to this account's *verified*
// address — the same binding reserveDiscountCode enforces — so it hands over
// nothing the signed-in shopper couldn't already spend by typing it. Answers
// `{ code: null }` (never an error) when there's nothing to offer, including when
// the welcome discount has already been used: an empty pocket is not a failure,
// and checkout shouldn't render an error for it.
app.get('/api/discount/mine', requireUserAuth, async (req, res) => {
  try {
    const canonical = await canonicalEmailForUser(req.user.userId);
    if (!canonical) return res.json({ code: null });

    const { rows } = await pool.query(
      `SELECT * FROM discount_codes
        WHERE source = 'subscribe' AND canonical_email = $1
          AND is_active AND redemption_count < max_redemptions
        ORDER BY created_at ASC LIMIT 1`,
      [canonical]
    );
    const row = rows[0];
    if (!row) return res.json({ code: null });

    // Same person-level guards "Apply" would run, so checkout never dangles a
    // code the shopper would then be refused.
    const blocked = (await codeUsedByUserReason(pool, row, req.user.userId))
      || (await welcomeCodeBlockReason(pool, row, req.user.userId, canonical));
    if (blocked) return res.json({ code: null });

    res.json({
      code: row.code,
      discount_type: row.discount_type,
      discount_value: Number(row.discount_value),
    });
  } catch (err) { sendServerError(res, err); }
});

// ── GET /api/admin/discount-codes (admin only) ───────────────────────────────
app.get('/api/admin/discount-codes', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, email, discount_percent, discount_type, discount_value,
              max_redemptions, redemption_count, is_active, one_per_customer, label, source,
              redeemed_at, order_id, created_at
         FROM discount_codes
        ORDER BY created_at DESC
        LIMIT 500`
    );
    const { rows: stat } = await pool.query(
      `SELECT COUNT(*)::int AS issued,
              COALESCE(SUM(redemption_count), 0)::int AS redeemed
         FROM discount_codes`
    );
    res.json({ codes: rows, stats: stat[0] || { issued: 0, redeemed: 0 } });
  } catch (err) { sendServerError(res, err); }
});

// ── POST /api/admin/discount-codes (admin only) ──────────────────────────────
// Mint a custom promo code. `code` optional — omit it to auto-generate an
// unguessable one. Percentage or fixed-euro; single-use by default.
app.post('/api/admin/discount-codes', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const discountType = body.discount_type === 'fixed' ? 'fixed' : 'percentage';
    const discountValue = Number(body.discount_value);
    if (!Number.isFinite(discountValue) || discountValue <= 0)
      return res.status(400).json({ error: 'Enter a discount value greater than zero.' });
    if (discountType === 'percentage' && discountValue > 100)
      return res.status(400).json({ error: 'A percentage discount cannot exceed 100%.' });

    let maxRedemptions = body.max_redemptions == null ? 1 : Math.floor(Number(body.max_redemptions));
    if (!Number.isFinite(maxRedemptions) || maxRedemptions < 1)
      return res.status(400).json({ error: 'Max uses must be a whole number of at least 1.' });

    // Defaults to on, so "max uses" means "this many customers" unless the admin
    // deliberately makes the code repeatable for the same shopper.
    const onePerCustomer = body.one_per_customer === false ? false : true;

    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : null;

    // Custom code: normalize + charset-check. Otherwise generate one.
    let code;
    if (body.code != null && String(body.code).trim() !== '') {
      code = normalizeCode(body.code);
      if (!/^[A-Z0-9-]{3,32}$/.test(code))
        return res.status(400).json({ error: 'Code must be 3–32 characters: letters, numbers, or hyphens.' });
    } else {
      code = genDiscountCode();
    }

    // discount_percent kept in sync for percentage codes so any legacy reader
    // still sees the right number; fixed codes leave it at 0.
    const legacyPercent = discountType === 'percentage' ? discountValue : 0;
    try {
      const { rows } = await pool.query(
        `INSERT INTO discount_codes
           (code, email, source, discount_type, discount_value, discount_percent, max_redemptions, label, one_per_customer)
         VALUES ($1, NULL, 'admin', $2, $3, $4, $5, $6, $7)
         RETURNING id, code, email, discount_percent, discount_type, discount_value,
                   max_redemptions, redemption_count, is_active, one_per_customer, label, source,
                   redeemed_at, order_id, created_at`,
        [code, discountType, discountValue, legacyPercent, maxRedemptions, label, onePerCustomer]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'That code already exists.' });
      throw err;
    }
  } catch (err) { sendServerError(res, err); }
});

// ── PATCH /api/admin/discount-codes/:id (admin only) — activate/deactivate ────
app.patch('/api/admin/discount-codes/:id', requireAuth, async (req, res) => {
  try {
    if (typeof req.body?.is_active !== 'boolean')
      return res.status(400).json({ error: 'is_active must be true or false.' });
    const { rows } = await pool.query(
      `UPDATE discount_codes SET is_active = $2 WHERE id = $1
       RETURNING id, code, email, discount_percent, discount_type, discount_value,
                 max_redemptions, redemption_count, is_active, one_per_customer, label, source,
                 redeemed_at, order_id, created_at`,
      [req.params.id, req.body.is_active]
    );
    if (!rows.length) return res.status(404).json({ error: 'Code not found.' });
    res.json(rows[0]);
  } catch (err) { sendServerError(res, err); }
});

// ── GET /api/admin/users (admin only) ────────────────────────────────────────
app.get('/api/admin/users', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, full_name, provider, avatar_url, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) { sendServerError(res, err); }
});

// ── POST /api/feedback/photo (public) ─────────────────────────────────────────
// The review form used to post to the admin-only /api/upload/image, so every
// photo a real (non-admin) shopper attached failed with a 401. This is the
// public counterpart: same allowlisted extensions and randomised filenames, but
// a 5MB cap and its own rate-limit budget.
app.post('/api/feedback/photo', feedbackPhotoLimiter, (req, res) => {
  uploadFeedbackPhoto.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    res.json({ path: `/uploads/${req.file.filename}` });
  });
});

// ── POST /api/feedback (public) ───────────────────────────────────────────────
app.post('/api/feedback', feedbackLimiter, async (req, res) => {
  // Every field here is unauthenticated public input — bound lengths, force the
  // rating into the DB's valid range (a bad value would otherwise 500 on the
  // CHECK constraint), and only accept photo paths we ourselves issued so a
  // stored URL can never point the admin's browser at a third-party host.

  // Honeypot: a field hidden from humans by CSS that scripted spam fills in
  // anyway. Answer 201 rather than an error so the bot has no signal to tune
  // against, but write nothing.
  if (safeText(req.body.website, 100)) return res.status(201).json({ ok: true });

  const name    = stripControlChars(safeText(req.body.name, 100));
  const email   = safeText(req.body.email, 254).toLowerCase();
  const message = stripControlChars(safeText(req.body.message, FEEDBACK_MAX_LEN + 1));
  const photoUrl = safeText(req.body.photo_url, 500);
  const rating  = Number(req.body.rating ?? 5);
  if (!message) return res.status(400).json({ error: 'Feedback message is required' });
  if (message.length > FEEDBACK_MAX_LEN)
    return res.status(400).json({ error: `Please keep your feedback under ${FEEDBACK_MAX_LEN} characters.` });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating must be a whole number between 1 and 5.' });
  if (photoUrl && !isOwnUploadPath(photoUrl))
    return res.status(400).json({ error: 'Photo must be one uploaded through this form.' });

  // IPs are only ever stored hashed: enough to spot one source flooding reviews
  // or to de-dupe a double-tapped submit button, without keeping the address.
  const ipHash = hashIp(req.ip);
  try {
    // Rate limits cap volume; this catches the same review arriving twice from a
    // double click or a retry, which would otherwise pass every other check.
    const dupe = await pool.query(
      `SELECT 1 FROM feedback
       WHERE message = $1 AND (ip_hash = $2 OR (email <> '' AND email = $3))
         AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
      [message, ipHash, email]
    );
    if (dupe.rowCount) return res.status(409).json({ error: 'Looks like you already sent us this one — thank you!' });

    const { rows } = await pool.query(
      `INSERT INTO feedback (name, email, rating, message, photo_url, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, email, rating, message, photoUrl, ipHash]
    );
    res.status(201).json(rows[0]);
  } catch (err) { sendServerError(res, err); }
});

// ── GET /api/admin/feedback (admin only) ──────────────────────────────────────
app.get('/api/admin/feedback', requireAuth, async (_req, res) => {
  try {
    // ip_hash stays server-side — the admin UI has no use for it.
    const { rows } = await pool.query(
      `SELECT id, name, email, rating, message, photo_url, published, created_at
       FROM feedback ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) { sendServerError(res, err); }
});

// ── PATCH /api/admin/feedback/:id (admin only) ────────────────────────────────
// Marks a review as published so the Testimonials editor can show at a glance
// which submissions have already been promoted onto the homepage.
app.patch('/api/admin/feedback/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE feedback SET published = $1 WHERE id = $2
       RETURNING id, name, email, rating, message, photo_url, published, created_at`,
      [req.body.published === true, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Feedback not found' });
    res.json(rows[0]);
  } catch (err) { sendServerError(res, err); }
});

// ── DELETE /api/admin/feedback/:id (admin only) ───────────────────────────────
app.delete('/api/admin/feedback/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM feedback WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { sendServerError(res, err); }
});

app.get('/api/subscribers', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM subscribers ORDER BY subscribed_at DESC');
    res.json(rows);
  } catch (err) { sendServerError(res, err); }
});

app.delete('/api/subscribers/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM subscribers WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { sendServerError(res, err); }
});

app.get('/api/shop/categories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM shop_categories WHERE is_active = true ORDER BY display_order ASC, created_at ASC'
    );
    res.json(rows);
  } catch (err) { sendServerError(res, err); }
});

app.post('/api/shop/categories', requireAuth, async (req, res) => {
  const { name, slug, mood_description = '', tags = [], bg_color = '#f5e4cb',
    page_bg_color = '#ede0c8', accent_color = '#6b3520', text_color = '#2c1508',
    stickers = [], product_ids = [], display_order = 0 } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO shop_categories (name, slug, mood_description, tags, bg_color, page_bg_color, accent_color, text_color, stickers, product_ids, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, slug, mood_description, JSON.stringify(tags), bg_color, page_bg_color,
       accent_color, text_color, JSON.stringify(stickers), JSON.stringify(product_ids), display_order]
    );
    res.status(201).json(rows[0]);
  } catch (err) { sendServerError(res, err); }
});

app.put('/api/shop/categories/:id', requireAuth, async (req, res) => {
  const { name, slug, mood_description, tags, bg_color, page_bg_color,
    accent_color, text_color, stickers, product_ids, display_order, is_active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE shop_categories SET name=$1, slug=$2, mood_description=$3, tags=$4, bg_color=$5,
       page_bg_color=$6, accent_color=$7, text_color=$8, stickers=$9, product_ids=$10,
       display_order=$11, is_active=$12 WHERE id=$13 RETURNING *`,
      [name, slug, mood_description, JSON.stringify(tags), bg_color, page_bg_color,
       accent_color, text_color, JSON.stringify(stickers), JSON.stringify(product_ids ?? []),
       display_order, is_active ?? true, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { sendServerError(res, err); }
});

app.delete('/api/shop/categories/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM shop_categories WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { sendServerError(res, err); }
});

app.post('/api/shop/candles', requireAuth, async (req, res) => {
  const { name, price = '$0', scent_notes = '', tagline = '', category_id,
    image_url = '', rotation = 0, pos_top = '10%', pos_left = '10%', display_order = 0 } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO shop_candles (name, price, scent_notes, tagline, category_id, image_url, rotation, pos_top, pos_left, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, price, scent_notes, tagline, category_id, image_url, rotation, pos_top, pos_left, display_order]
    );
    res.status(201).json(rows[0]);
  } catch (err) { sendServerError(res, err); }
});

app.put('/api/shop/candles/:id', requireAuth, async (req, res) => {
  const { name, price, scent_notes, tagline, category_id, image_url,
    rotation, pos_top, pos_left, display_order, is_active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE shop_candles SET name=$1, price=$2, scent_notes=$3, tagline=$4, category_id=$5,
       image_url=$6, rotation=$7, pos_top=$8, pos_left=$9, display_order=$10, is_active=$11
       WHERE id=$12 RETURNING *`,
      [name, price, scent_notes, tagline, category_id, image_url,
       rotation, pos_top, pos_left, display_order, is_active ?? true, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { sendServerError(res, err); }
});

app.delete('/api/shop/candles/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM shop_candles WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { sendServerError(res, err); }
});

// ── POST /api/upload/video (admin only) ───────────────────────────────────────
app.post('/api/upload/video', requireAuth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  const url = `${BACKEND_URL}/uploads/${req.file.filename}`;
  // `path` matches the image endpoint: the frontend prepends its own API_URL,
  // so the file is fetched through the same origin/proxy as every other asset.
  res.json({ url, path: `/uploads/${req.file.filename}` });
});

// ── POST /api/upload/image (admin only) ───────────────────────────────────────
app.post('/api/upload/image', requireAuth, uploadImage.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  // Return a relative path — the frontend prepends its own API_URL so the URL
  // works correctly regardless of whether pointing at localhost or Railway.
  res.json({ path: `/uploads/${req.file.filename}` });
});

app.use('/uploads', express.static(uploadDir, {
  dotfiles: 'deny',
  // Belt-and-braces on top of the upload allowlist: even if a scriptable file
  // ever lands in uploads/, this CSP stops it executing when viewed directly.
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
  },
}));

const distPath = path.join(__dirname, '../dist');

// ── GET /api/favicon/:file — the icon Google shows beside the search result ────
// Google fetches favicons over plain HTTP and does not run the page's JavaScript
// while doing it, so swapping <link rel="icon"> at runtime is invisible to it:
// whatever bytes live at the icon URLs declared in the served index.html are what
// end up in search. Netlify rewrites those URLs here (see public/_redirects) so
// an icon uploaded in Admin → Ops → SEO is what the crawler downloads, with the
// icon shipped in the build as the fallback.
const SHIPPED_ICONS = new Set([
  'favicon.ico', 'favicon.png', 'favicon-48.png', 'favicon-96.png',
  'favicon-192.png', 'apple-touch-icon.png', 'icon-512.png',
]);

// An icon configured as an external URL is fetched here and streamed back rather
// than redirected to. Google's favicon crawler indexes the bytes it can download
// from the URL named in the page, and a cross-origin hop to an image host is the
// difference between a new icon showing up in search and the old cached one
// sticking around. Cached in memory so the crawler and every page load don't each
// cost an upstream request; keyed by URL, so changing it in the admin takes effect
// on the next request rather than waiting out the TTL.
const REMOTE_ICON_TTL_MS = 60 * 60 * 1000;
const REMOTE_ICON_MAX_BYTES = 2 * 1024 * 1024;
const REMOTE_ICON_MAX_REDIRECTS = 3;
const remoteIconCache = new Map();

// A favicon URL is administrator-configured, but fetching it still makes the
// server a network client. Do not let a compromised admin session turn this
// public endpoint into an SSRF primitive against Railway, the database network,
// or cloud metadata services. Validate every redirect as well as the first URL.
const isPrivateNetworkAddress = (address) => {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
  }
  if (kind === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::' || normalized === '::1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') || normalized.startsWith('::ffff:') ||
      normalized.startsWith('2001:db8:');
  }
  // DNS lookup only gives IP literals; treat anything else as unsafe rather
  // than accidentally allowing a parsing edge case.
  return true;
};

const validateRemoteIconUrl = async (value) => {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error('invalid URL');
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
    throw new Error('URL must be an unauthenticated HTTP(S) URL');

  const hostname = target.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost'))
    throw new Error('local hosts are not allowed');

  const resolved = isIP(hostname)
    ? [{ address: hostname }]
    : await dnsLookup(hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some(({ address }) => isPrivateNetworkAddress(address)))
    throw new Error('private network addresses are not allowed');
  return target;
};

const readRemoteIconBody = async (upstream) => {
  const declaredLength = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > REMOTE_ICON_MAX_BYTES)
    throw new Error(`upstream declared ${declaredLength} bytes`);
  if (!upstream.body) throw new Error('upstream sent no body');

  const reader = upstream.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > REMOTE_ICON_MAX_BYTES)
        throw new Error(`upstream exceeded ${REMOTE_ICON_MAX_BYTES} bytes`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!length) throw new Error('upstream sent no bytes');
  return Buffer.concat(chunks, length);
};

async function fetchRemoteIcon(url) {
  const cached = remoteIconCache.get(url);
  if (cached && Date.now() - cached.at < REMOTE_ICON_TTL_MS) return cached;

  let target = await validateRemoteIconUrl(url);
  for (let redirects = 0; redirects <= REMOTE_ICON_MAX_REDIRECTS; redirects++) {
    const upstream = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get('location');
      if (!location) throw new Error('redirect had no location');
      if (redirects === REMOTE_ICON_MAX_REDIRECTS) throw new Error('too many redirects');
      target = await validateRemoteIconUrl(new URL(location, target).toString());
      continue;
    }

    if (!upstream.ok) throw new Error(`upstream responded ${upstream.status}`);
    const type = String(upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    // The SEO editor asks for a PNG; keep this proxy raster-only so it cannot
    // become a vector-document delivery endpoint if a browser ever navigates to
    // it directly.
    if (!new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon']).has(type))
      throw new Error(`upstream sent unsupported content type ${type || 'none'}`);

    const entry = { body: await readRemoteIconBody(upstream), type, at: Date.now() };
    remoteIconCache.set(url, entry);
    return entry;
  }
  throw new Error('too many redirects');
}

app.get('/api/favicon/:file', async (req, res) => {
  // Only ever serve a known icon name: the path is attacker-supplied and both
  // branches below turn it into a filesystem read.
  const file = path.basename(req.params.file || '');
  if (!SHIPPED_ICONS.has(file)) return res.status(404).json({ error: 'Not found' });

  const sendShipped = () =>
    res.sendFile(path.join(distPath, file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });

  res.setHeader('Cache-Control', 'public, max-age=3600');
  // This route may serve an administrator-chosen image. It is not an HTML
  // document, but sandbox it anyway in case a browser opens it directly.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  try {
    const { rows } = await pool.query("SELECT value FROM site_settings WHERE key = 'content_seo'");
    const configured = String(rows[0]?.value?.favicon_url || '').trim();
    if (configured) {
      // Either way the crawler gets a 200 with the real image rather than a hop it
      // may not follow: uploads are read off disk, external URLs are fetched above.
      const uploaded = configured.match(/\/uploads\/([A-Za-z0-9._-]+)$/);
      if (uploaded) {
        const onDisk = path.join(uploadDir, uploaded[1]);
        if (existsSync(onDisk)) return res.sendFile(onDisk);
      } else if (/^https?:\/\//i.test(configured)) {
        try {
          const icon = await fetchRemoteIcon(configured);
          return res.type(icon.type).send(icon.body);
        } catch (err) {
          console.error('[favicon] could not fetch configured remote icon —', err.message);
        }
      }
      // Configured but unusable (file deleted, or a path we can't resolve) —
      // fall through to the shipped icon rather than 404ing the site's favicon.
    }
  } catch (err) {
    console.error('[favicon]', err);
  }
  sendShipped();
});

// Unknown API routes must return a JSON 404 — without this they fall through to
// the SPA catch-all below and return index.html with a 200, which masks bugs and
// makes automated probing of the API surface noisier to reason about.
app.all('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Serve React frontend (SPA catch-all) ──────────────────────────────────────
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    // Vite emits content-hashed filenames under /assets — safe to cache forever.
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get('*', (_req, res) => {
  // index.html must always revalidate or new deploys never reach returning visitors.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distPath, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches malformed JSON bodies and any other unhandled errors so we never
// leak stack traces / server file paths via Express's default HTML error page.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Something went wrong. Please try again.' });
});

// ══════════════════════════════════════════════════════════════════════════════
// DATABASE INIT
// ══════════════════════════════════════════════════════════════════════════════

async function initDb() {
  await pool.query(`
    -- Marker table for data migrations that must run exactly once. The DDL in this
    -- block is all CREATE/ALTER ... IF NOT EXISTS, so re-running it every boot is
    -- harmless — but an UPDATE is not self-limiting that way, and one placed here
    -- re-applies on every single deploy. See runOnce() after this query.
    CREATE TABLE IF NOT EXISTS schema_migrations (
      key        TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      key        TEXT        UNIQUE NOT NULL,
      value      JSONB       DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      email         TEXT        UNIQUE NOT NULL,
      subscribed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shop_categories (
      id               UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
      name             TEXT  NOT NULL,
      slug             TEXT  UNIQUE NOT NULL,
      mood_description TEXT  DEFAULT '',
      tags             JSONB DEFAULT '[]',
      bg_color         TEXT  DEFAULT '#f5e4cb',
      page_bg_color    TEXT  DEFAULT '#ede0c8',
      accent_color     TEXT  DEFAULT '#6b3520',
      text_color       TEXT  DEFAULT '#2c1508',
      stickers         JSONB DEFAULT '[]',
      product_ids      JSONB DEFAULT '[]',
      display_order    INT   DEFAULT 0,
      is_active        BOOL  DEFAULT true,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE shop_categories ADD COLUMN IF NOT EXISTS product_ids JSONB DEFAULT '[]';

    CREATE TABLE IF NOT EXISTS feedback (
      id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      name       TEXT        DEFAULT '',
      email      TEXT        DEFAULT '',
      rating     INT         DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
      message    TEXT        NOT NULL,
      photo_url  TEXT        DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- published: promoted onto the homepage Testimonials section from Admin.
    -- ip_hash: HMAC of the submitter's IP, used only to de-dupe repeat sends.
    ALTER TABLE feedback ADD COLUMN IF NOT EXISTS published BOOL DEFAULT false;
    ALTER TABLE feedback ADD COLUMN IF NOT EXISTS ip_hash TEXT DEFAULT '';
    CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback (created_at DESC);

    CREATE TABLE IF NOT EXISTS shop_candles (
      id            UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
      name          TEXT  NOT NULL,
      price         TEXT  DEFAULT '$0',
      scent_notes   TEXT  DEFAULT '',
      tagline       TEXT  DEFAULT '',
      category_id   UUID  REFERENCES shop_categories(id) ON DELETE CASCADE,
      image_url     TEXT  DEFAULT '',
      rotation      INT   DEFAULT 0,
      pos_top       TEXT  DEFAULT '10%',
      pos_left      TEXT  DEFAULT '10%',
      display_order INT   DEFAULT 0,
      is_active     BOOL  DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id            UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
      email         TEXT  UNIQUE,
      phone         TEXT  UNIQUE,
      password_hash TEXT,
      full_name     TEXT  DEFAULT '',
      provider      TEXT  DEFAULT 'email',
      provider_id   TEXT,
      avatar_url    TEXT  DEFAULT '',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS phone_otps (
      phone      TEXT PRIMARY KEY,
      otp        TEXT        NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    -- otp_hash/attempts bring phone OTP in line with the email OTP flow's
    -- bcrypt-hashed, attempt-limited pattern (see email_otps) instead of a
    -- plaintext code with no per-number lockout.
    ALTER TABLE phone_otps ADD COLUMN IF NOT EXISTS otp_hash TEXT;
    ALTER TABLE phone_otps ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
    -- Deliberately NO backfill here. This block re-runs on every boot, so the
    -- "UPDATE users SET email_verified = true WHERE email_verified = false" that
    -- used to sit on this line re-applied on every deploy — permanently forcing
    -- the column true for every row, including Google/Facebook/phone accounts whose
    -- inserts never set it. That made the flag useless as a security signal: it
    -- said "verified" for accounts nobody had verified. The corrected, run-once
    -- version is repair_email_verified_by_provider below; each insert site now sets
    -- the column explicitly so no backfill is needed for new rows at all.

    ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line1 TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line2 TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS city           TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS state          TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code    TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS country        TEXT DEFAULT '';

    -- Address book: many delivery addresses per user. The single address stored on
    -- the users row above is kept in sync with whichever entry here is is_default
    -- (see syncDefaultAddressToUser), so checkout prefill and GET /api/user/me keep
    -- reading one canonical "default address" without knowing about this table.
    CREATE TABLE IF NOT EXISTS user_addresses (
      id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id       UUID        REFERENCES users(id) ON DELETE CASCADE,
      full_name     TEXT        DEFAULT '',
      phone         TEXT        DEFAULT '',
      address_line1 TEXT        DEFAULT '',
      address_line2 TEXT        DEFAULT '',
      city          TEXT        DEFAULT '',
      state         TEXT        DEFAULT '',
      postal_code   TEXT        DEFAULT '',
      country       TEXT        DEFAULT '',
      is_default    BOOLEAN     NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_addresses_user_idx ON user_addresses(user_id);
    -- At most one default per user, enforced at the DB level.
    CREATE UNIQUE INDEX IF NOT EXISTS user_addresses_one_default_uidx
      ON user_addresses(user_id) WHERE is_default;

    -- One-time backfill: seed the address book from the legacy single address on
    -- each users row, so existing customers keep their saved address as the default.
    INSERT INTO user_addresses
      (user_id, full_name, phone, address_line1, address_line2, city, state, postal_code, country, is_default)
    SELECT id, full_name, phone, address_line1, address_line2, city, state, postal_code, country, true
    FROM users u
    WHERE COALESCE(u.address_line1, '') <> ''
      AND NOT EXISTS (SELECT 1 FROM user_addresses a WHERE a.user_id = u.id);

    CREATE TABLE IF NOT EXISTS email_otps (
      email      TEXT        NOT NULL,
      purpose    TEXT        NOT NULL DEFAULT 'signup',
      otp_hash   TEXT        NOT NULL,
      payload    JSONB       DEFAULT '{}',
      attempts   INT         NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (email, purpose)
    );

    CREATE TABLE IF NOT EXISTS user_carts (
      id           UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id      UUID  REFERENCES users(id) ON DELETE CASCADE,
      product_id   TEXT  NOT NULL,
      product_data JSONB NOT NULL,
      quantity     INT   NOT NULL DEFAULT 1,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id           UUID        REFERENCES users(id) ON DELETE CASCADE,
      items             JSONB       NOT NULL,
      subtotal          NUMERIC     NOT NULL DEFAULT 0,
      shipping          NUMERIC     NOT NULL DEFAULT 0,
      total             NUMERIC     NOT NULL DEFAULT 0,
      tracking_number   TEXT        NOT NULL,
      shipping_address  JSONB       DEFAULT '{}',
      created_at        TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'delivery';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_percent NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount  NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS status           TEXT    NOT NULL DEFAULT 'Order Placed';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status   TEXT    NOT NULL DEFAULT 'unpaid';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_session_id        TEXT UNIQUE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

    -- Cart-to-order data staged while the customer is on Stripe's hosted checkout
    -- page. Promoted into orders only once Stripe confirms the charge succeeded
    -- (see finalizeCheckoutSession) — never created directly from the browser.
    CREATE TABLE IF NOT EXISTS pending_checkouts (
      id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id           UUID        REFERENCES users(id) ON DELETE CASCADE,
      stripe_session_id TEXT        UNIQUE NOT NULL,
      payload           JSONB       NOT NULL,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      consumed_at       TIMESTAMPTZ
    );

    -- Single-use welcome discount codes. One 'subscribe' code is issued per
    -- subscriber email (enforced by the unique index below), emailed to them, and
    -- redeemable exactly once — see the reserve/redeem logic around checkout for
    -- how double-spend and per-account stacking are prevented. Defined here,
    -- after users + orders, because it references both.
    CREATE TABLE IF NOT EXISTS discount_codes (
      id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      code                TEXT        UNIQUE NOT NULL,
      email               TEXT        NOT NULL,
      discount_percent    NUMERIC     NOT NULL DEFAULT 0,
      source              TEXT        NOT NULL DEFAULT 'subscribe',
      -- Held while an in-flight checkout is using the code, so a second parallel
      -- checkout can't spend it too. Goes stale after 30 min (see reserveDiscountCode).
      reserved_at         TIMESTAMPTZ,
      reserved_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
      reserved_session_id TEXT,
      -- Set once, at order finalization. A non-null redeemed_at means spent for good.
      redeemed_at         TIMESTAMPTZ,
      redeemed_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
      order_id            UUID        REFERENCES orders(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );
    -- One welcome code per email address: makes re-subscribing (or racing two
    -- signups) unable to mint a second code for the same person. NULL emails
    -- (admin-created campaign codes) are treated as distinct by Postgres, so any
    -- number of them coexist under source='admin'.
    CREATE UNIQUE INDEX IF NOT EXISTS discount_codes_email_source_uidx
      ON discount_codes (email, source);

    -- Generalization from welcome-only codes to admin-created promo codes:
    -- percentage OR fixed-euro value, an optional multi-use cap (default 1 =
    -- single-use, preserving the original guarantee), an active toggle, and an
    -- admin label. discount_percent is retained for back-compat; new code paths
    -- read discount_type/discount_value.
    ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS discount_type    TEXT    NOT NULL DEFAULT 'percentage';
    ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS discount_value   NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS max_redemptions  INT     NOT NULL DEFAULT 1;
    ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS redemption_count INT     NOT NULL DEFAULT 0;
    ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS is_active        BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS label            TEXT;
    -- Backfill existing (percentage) rows into the canonical value column.
    UPDATE discount_codes SET discount_value = discount_percent
      WHERE discount_value = 0 AND discount_percent > 0;
    -- Admin codes carry no email; welcome codes still do.
    ALTER TABLE discount_codes ALTER COLUMN email DROP NOT NULL;

    -- The mailbox behind the address (see canonicalEmail): +tag aliases and Gmail
    -- dot variants all collapse to one value, so "one welcome code per person" can
    -- actually mean per person rather than per spelling.
    ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS canonical_email TEXT;

    -- Marks a pending checkout that was superseded by a later one from the same
    -- shopper and expired at Stripe, so it can no longer be paid (see
    -- expirePriorCheckouts) and no longer counts as a live hold on its code.
    ALTER TABLE pending_checkouts ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

    -- Looking up "is this code committed to a live checkout" on every reserve.
    CREATE INDEX IF NOT EXISTS pending_checkouts_live_code_idx
      ON pending_checkouts ((payload->>'discount_code'))
      WHERE consumed_at IS NULL AND expired_at IS NULL;

    -- "Max uses" on a shared promo code reads as how many *customers* it's good
    -- for, so by default a code is one-per-customer: without this, one shopper
    -- can spend all 100 uses of SPRING20 across 100 of their own orders. Admins
    -- can switch it off per code for a deliberately repeatable offer.
    ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS one_per_customer BOOLEAN NOT NULL DEFAULT true;

    -- Who has actually spent a code. discount_codes only ever kept the *last*
    -- redeemer in redeemed_by_user_id, which can't answer "has this shopper used
    -- this code before" for a multi-use code. Written in the same transaction
    -- that increments redemption_count (see redeemDiscountCode), so the ledger
    -- and the counter can never disagree.
    CREATE TABLE IF NOT EXISTS discount_redemptions (
      id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      code_id    UUID        NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
      user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      order_id   UUID        REFERENCES orders(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    -- One row per code per order: makes a replayed redeem a no-op rather than a
    -- second ledger entry for the same money.
    CREATE UNIQUE INDEX IF NOT EXISTS discount_redemptions_code_order_uidx
      ON discount_redemptions (code_id, order_id);
    CREATE INDEX IF NOT EXISTS discount_redemptions_code_user_idx
      ON discount_redemptions (code_id, user_id);
    -- Backfill from the single-redeemer columns so codes spent before the ledger
    -- existed still count against their redeemer's one-per-customer allowance.
    INSERT INTO discount_redemptions (code_id, user_id, order_id, created_at)
      SELECT id, redeemed_by_user_id, order_id, redeemed_at FROM discount_codes
       WHERE redeemed_at IS NOT NULL AND order_id IS NOT NULL
    ON CONFLICT DO NOTHING;

    CREATE TABLE IF NOT EXISTS returns (
      id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      order_id     UUID        REFERENCES orders(id) ON DELETE CASCADE,
      user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
      product_id   TEXT        NOT NULL,
      product_name TEXT        DEFAULT '',
      reason       TEXT        NOT NULL,
      status       TEXT        NOT NULL DEFAULT 'requested',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_status       TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason       TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status             TEXT NOT NULL DEFAULT 'not_applicable';

    -- Unified audit trail + customer-visible timeline + admin→customer messages.
    -- Internal-only entries (e.g. refund_reminder_sent, which goes to the admin,
    -- not the customer) are written with customer_visible = false.
    CREATE TABLE IF NOT EXISTS order_events (
      id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      order_id         UUID        REFERENCES orders(id) ON DELETE CASCADE,
      type             TEXT        NOT NULL,
      actor            TEXT        NOT NULL DEFAULT 'system',
      title            TEXT        NOT NULL,
      detail           TEXT        DEFAULT '',
      meta             JSONB       DEFAULT '{}',
      customer_visible BOOLEAN     DEFAULT true,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );

    -- Tracks the manual-refund clock for an approved return or an approved
    -- cancellation on a paid order. The reminder sweep (scheduler.js) emails the
    -- admin at the configured day offsets until resolved_at is set.
    CREATE TABLE IF NOT EXISTS refund_reminders (
      id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      order_id       UUID        REFERENCES orders(id) ON DELETE CASCADE,
      source         TEXT        NOT NULL,
      source_id      UUID        NOT NULL,
      eligible_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at    TIMESTAMPTZ,
      reminders_sent JSONB       DEFAULT '[]',
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );

    -- Generalized "suggest, don't act" queue: rules in scheduler.js and a few
    -- event hooks below create rows here; an admin approves or dismisses each
    -- one from the Ops tab. Approving dispatches to the same reusable functions
    -- the manual admin actions already call — nothing here executes on its own.
    CREATE TABLE IF NOT EXISTS admin_decisions (
      id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      type             TEXT        NOT NULL,
      order_id         UUID        REFERENCES orders(id) ON DELETE CASCADE,
      return_id        UUID        REFERENCES returns(id) ON DELETE CASCADE,
      product_id       TEXT,
      reasoning        TEXT        NOT NULL,
      suggested_action JSONB       NOT NULL DEFAULT '{}',
      status           TEXT        NOT NULL DEFAULT 'pending',
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      resolved_at      TIMESTAMPTZ
    );

    INSERT INTO site_settings (key, value)
    VALUES ('content_automationSettings', '{
      "refund_reminder_days":       [1, 5, 7],
      "refund_reminder_enabled":    true,
      "stuck_order_days":           3,
      "low_stock_threshold":        5,
      "decision_engine_enabled":    true,
      "auto_approvable_return_reasons": ["defective", "damaged", "wrong item"],
      "return_window_days":         30,
      "fraud_review_threshold":     300,
      "stuck_order_followup_enabled": true,
      "refund_automation_enabled":  false,
      "back_in_stock_notify_enabled": true,
      "underperforming_bundle_days": 30
    }')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO site_settings (key, value)
    VALUES ('hero', '{
      "headline":       "Something beautiful is coming",
      "subtext":        "Handcrafted candles designed to elevate your space",
      "cta_text":       "Join the Waiting List",
      "show_countdown": false,
      "launch_date":    null
    }')
    ON CONFLICT (key) DO NOTHING;

    -- Seeded (not just a frontend fallback) so pickup actually works out of the
    -- box — the checkout endpoint reads this row directly, it doesn't go through
    -- the same getContent()-with-fallback path the frontend uses for display copy.
    INSERT INTO site_settings (key, value)
    VALUES ('content_pickupSettings', '{
      "enabled":          true,
      "location_name":    "The Olive Goose Studio",
      "address_line1":    "14 Beacon Court",
      "city":             "Dublin 18",
      "eircode":          "D18 K7W2",
      "country":          "Ireland",
      "hours":            "Tue–Sat, 10am–5pm",
      "discount_percent": 10,
      "free_shipping_threshold": 65,
      "flat_shipping_rate": 4.99,
      "notes":            "Bring your order confirmation email — we''ll have it ready and waiting."
    }')
    ON CONFLICT (key) DO NOTHING;

    -- One row per signed-in device. The session cookie's JWT names a row here, and
    -- requireUserAuth refuses a token whose row is missing, revoked, or past either
    -- expiry — that is what makes "sign out", "sign out everywhere" and "changing
    -- your password ends other sessions" actually end a session, instead of only
    -- clearing a cookie the attacker already copied. Two clocks: idle_expires_at
    -- slides while the shopper is active, absolute_expires_at never moves.
    CREATE TABLE IF NOT EXISTS user_sessions (
      id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      remember            BOOLEAN     NOT NULL DEFAULT true,
      user_agent          TEXT        NOT NULL DEFAULT '',
      ip                  TEXT        NOT NULL DEFAULT '',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      idle_expires_at     TIMESTAMPTZ NOT NULL,
      absolute_expires_at TIMESTAMPTZ NOT NULL,
      revoked_at          TIMESTAMPTZ,
      revoked_reason      TEXT
    );
    -- The device list reads by user; the prune sweep reads by expiry.
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user    ON user_sessions (user_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (absolute_expires_at);

    -- Admin accounts live in the DB (not just env vars) so a password reset can
    -- actually persist. token_version is bumped on every password change and
    -- checked on every request (see requireAuth) so a stolen JWT issued before
    -- a reset stops working immediately instead of staying valid for its full 7d.
    CREATE TABLE IF NOT EXISTS admins (
      id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      email         TEXT        UNIQUE NOT NULL,
      password_hash TEXT        NOT NULL,
      token_version INT         NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- First-party behavioural analytics. One row per event, batched in from the
    -- storefront (see POST /api/analytics/events); 'purchase' rows are written
    -- server-side by finalizeCheckoutSession so revenue attribution can't be
    -- forged from the browser. visitor_id/session_id are client-generated opaque
    -- ids — no cookies, and the visitor id is only persisted across visits when
    -- the customer accepted the cookie banner.
    CREATE TABLE IF NOT EXISTS analytics_events (
      id           BIGSERIAL   PRIMARY KEY,
      visitor_id   TEXT        NOT NULL,
      session_id   TEXT        NOT NULL,
      user_id      UUID,
      event_type   TEXT        NOT NULL,
      path         TEXT        DEFAULT '',
      referrer     TEXT        DEFAULT '',
      utm_source   TEXT        DEFAULT '',
      utm_medium   TEXT        DEFAULT '',
      utm_campaign TEXT        DEFAULT '',
      device       TEXT        DEFAULT '',
      props        JSONB       DEFAULT '{}',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    -- 'persistent' when the visitor id survives in localStorage (cookie banner
    -- accepted) and the person is recognisable on a later visit; 'session' when
    -- it dies with the tab, so the same human returning tomorrow counts as new.
    -- Without this the dashboard cannot say how far "Visitors" and "New vs
    -- returning" can be trusted. '' on rows written before this column existed.
    ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS visitor_scope TEXT NOT NULL DEFAULT '';
    -- The origin the batch was sent from. A visitor id is localStorage, and
    -- localStorage is per-origin: the same person on theolivegoose.ie and on the
    -- Railway hostname that serves the identical SPA is two unreconcilable
    -- visitors. Ingestion now refuses everything but the real storefront (see
    -- countedOrigins), and this column is what makes that auditable rather than
    -- a matter of belief. '' on rows written before it existed.
    ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT '';
    -- Roughly where the visitor was, as Netlify's edge had already resolved it in
    -- order to route the request. No IP is looked up, transmitted or stored to
    -- get this: see netlify/edge-functions/analytics-geo.ts and geoFromHeaders.
    -- '' means we never learned it — a request that did not come through Netlify,
    -- or a header that failed validation — and is reported as "Unknown" rather
    -- than guessed at.
    ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS geo_city    TEXT NOT NULL DEFAULT '';
    ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS geo_country TEXT NOT NULL DEFAULT '';

    -- Foreground, visible time in milliseconds — GA4's "user engagement", not
    -- wall-clock session length, so a tab left open over lunch is not counted as
    -- two hours of interest. Carried as a DELTA on each ingest batch and written
    -- to that batch's FIRST row only, so summing a session gives its total
    -- exactly once. 0 on rows written before this column existed, which is why
    -- the dashboard reports engagement as null rather than zero for a window
    -- that predates it.
    ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS engagement_ms INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events (created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_type    ON analytics_events (event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events (session_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor ON analytics_events (visitor_id, created_at);
    -- Signed-in rows only. The dashboard now excludes an event whose account is
    -- on the internal list (see EXCLUDE_INTERNAL), which is a correlated lookup
    -- on this column; user_id is NULL for most rows, so a partial index keeps it
    -- small and keeps the lookup off a sequential scan.
    CREATE INDEX IF NOT EXISTS idx_analytics_events_user
      ON analytics_events (user_id) WHERE user_id IS NOT NULL;

    -- Browsers whose events are the shop testing itself, not a customer
    -- shopping. Populated at ingest — from a session signed in as an internal
    -- account, or from a browser the owner marked in Admin → Analytics — and
    -- applied to the WHOLE history of each visitor id, so a checkout rehearsal
    -- stops counting from its first anonymous page view, not from the sign-in.
    CREATE TABLE IF NOT EXISTS analytics_internal_visitors (
      visitor_id TEXT        PRIMARY KEY,
      reason     TEXT        NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    -- WHICH network (or which account) put this visitor on the list. Without it
    -- an exclusion cannot be undone precisely: removing one of two excluded
    -- networks used to release either everything or — the actual behaviour —
    -- nothing at all, leaving real shoppers permanently hidden with no way to
    -- get them back. '' on rows written before this column existed.
    ALTER TABLE analytics_internal_visitors ADD COLUMN IF NOT EXISTS detail TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS idx_analytics_internal_reason
      ON analytics_internal_visitors (reason);

    -- Reset tokens are single-use, short-lived, and stored as a SHA-256 digest
    -- (not bcrypt) so they can be looked up by an indexed equality match — the
    -- token itself already carries 256 bits of entropy from crypto.randomBytes,
    -- so a fast deterministic hash is appropriate here (unlike user passwords).
    CREATE TABLE IF NOT EXISTS admin_password_resets (
      id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      admin_email TEXT        NOT NULL,
      token_hash  TEXT        UNIQUE NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ── Once-only data migrations ───────────────────────────────────────────────
  // Everything above is idempotent DDL, safe to re-run on every boot. Data changes
  // are not: an UPDATE written as a "one-time backfill" up there silently re-applies
  // on every deploy forever. Route anything that rewrites existing rows through here.
  //
  // The marker row and the data change commit in one transaction, so a crash
  // mid-migration can't leave a marker claiming work that never happened — that
  // would skip it silently forever, the same failure in a new costume. The unique
  // key doubles as a lock: if two instances boot at once the second blocks until
  // the first commits, then sees rowCount 0 and skips.
  const runOnce = async (key, run) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`,
        [key]
      );
      if (rowCount === 0) { await client.query('ROLLBACK'); return; } // earlier boot
      await run(client);
      await client.query('COMMIT');
      console.log(`🗃️  migration applied: ${key}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => { /* connection already gone */ });
      throw err;
    } finally {
      client.release();
    }
  };

  // Repairs the damage left by the old always-on backfill: restores email_verified
  // to what each account can actually prove about its address.
  //   email    — /api/user/register/verify writes no users row until an emailed OTP
  //              is confirmed, so every password account is genuinely verified.
  //   google   — the callback refuses to proceed unless Google reports
  //              email_verified, so every Google account is genuinely verified too.
  //   facebook — the Graph API exposes no reliable verified flag (see that
  //              callback), and the address may be a synthetic fb_<id>@noemail.local.
  //   phone    — signs up with no email at all.
  // Runs on the migration's own transaction (hence `client`, not `pool`) so the
  // rewrite and its marker land together.
  await runOnce('repair_email_verified_by_provider', (client) => client.query(`
    UPDATE users
       SET email_verified = (provider IN ('email', 'google'))
     WHERE email_verified IS DISTINCT FROM (provider IN ('email', 'google'))
  `));

  // Seed the "this is us, not a customer" account list so the exclusion is live on
  // the deploy that ships it rather than after someone remembers to configure it.
  // Two sources: every admin login (whoever can open the dashboard is the shop),
  // plus the owner's shopper accounts, which are ordinary customer records and so
  // appear nowhere else. Once-only — the list is editable in Admin → Analytics and
  // a re-run would keep resurrecting entries the owner deleted.
  await runOnce('seed_analytics_internal_accounts', async (client) => {
    const { rows } = await client.query(`SELECT LOWER(email) AS email FROM admins`);
    const emails = [...new Set([
      ...rows.map((r) => r.email),
      'akash.rocks73@gmail.com',
      'bhardwajakash166@gmail.com',
      // The end-to-end suite signs up real accounts on this domain and puts real
      // orders through Stripe test mode. They are not customers, and a domain
      // entry means a new fixture account is excluded the day it is created
      // rather than the day someone notices it in the revenue figures.
      '@olivegoose-test.local',
    ].filter(Boolean))];
    await client.query(
      `INSERT INTO site_settings (key, value) VALUES ('analytics_internal', $1)
       ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify({ emails })]
    );
    console.log(`   analytics excludes ${emails.length} internal account(s)`);
  });

  // Fill canonical_email for welcome codes issued before the column existed, so the
  // "one per mailbox" rule applies to the existing subscriber base too and isn't
  // only enforced from this deploy forward. Canonicalisation is JS-side (the Gmail
  // dot rule is awkward in SQL), so this reads and rewrites row by row.
  await runOnce('backfill_discount_codes_canonical_email', async (client) => {
    const { rows } = await client.query(
      `SELECT id, email FROM discount_codes WHERE canonical_email IS NULL AND email IS NOT NULL`
    );
    for (const row of rows) {
      const canonical = canonicalEmail(row.email);
      if (!canonical) continue;
      await client.query('UPDATE discount_codes SET canonical_email = $2 WHERE id = $1', [row.id, canonical]);
    }
    if (rows.length) console.log(`   canonicalised ${rows.length} welcome code email(s)`);
  });

  // Belt-and-braces behind issueSubscriberDiscountCode's canonical lookup: makes a
  // second welcome code for the same mailbox impossible even under a race. Created
  // best-effort — a store that already handed out aliased duplicates before this
  // deploy would fail the index build, and that's not a reason to refuse to boot.
  // The application-level check still holds the line in that case.
  try {
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS discount_codes_canonical_subscribe_uidx
         ON discount_codes (canonical_email)
       WHERE source = 'subscribe' AND canonical_email IS NOT NULL`
    );
  } catch (err) {
    console.error(
      '[discount_codes canonical index] not created — existing rows share a mailbox. ' +
      'Welcome codes are still capped per mailbox in application code. Detail:', err?.message || err
    );
  }

  // One-time bootstrap: seed the admins table from the env vars if it's empty.
  // After this, ADMIN_EMAIL/ADMIN_PASSWORD_HASH are only a fallback for the very
  // first boot — password changes/resets live in the DB from then on.
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH) {
    await pool.query(
      `INSERT INTO admins (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
      [process.env.ADMIN_EMAIL.toLowerCase().trim(), process.env.ADMIN_PASSWORD_HASH]
    );
  }

  // Heal any bundle product_ids orphaned by past product deletions so the persisted
  // deals match the live catalogue (the discount engine already tolerates orphans at
  // read time — this cleans the stored data too, e.g. the "Classics Duo" that carried
  // a deleted product id). Best-effort: a failure here must never block boot.
  try {
    const [dRows, pRows] = await Promise.all([
      pool.query(`SELECT value FROM site_settings WHERE key = 'content_deals'`),
      pool.query(`SELECT value FROM site_settings WHERE key = 'content_products'`),
    ]);
    const deals = dRows.rows[0]?.value;
    const products = pRows.rows[0]?.value?.items || [];
    if (deals && Array.isArray(deals.bundles) && products.length) {
      const { bundles, changed } = sanitizeBundles(deals.bundles, products);
      if (changed) {
        await pool.query(
          `UPDATE site_settings SET value = $1, updated_at = NOW() WHERE key = 'content_deals'`,
          [JSON.stringify({ ...deals, bundles })]
        );
        console.log('🧹 Cleaned orphaned bundle product references in content_deals');
      }
    }
  } catch (err) {
    console.error('[bundle sanitize on boot]', err);
  }

  console.log('✅ Database ready');
}

// Time-based decision rules (stuck orders) can't be caught by an event hook —
// they have to be polled. Also backfills return suggestions for any return
// that somehow didn't get evaluated at creation time (e.g. the setting was
// enabled after the return was filed). Lives here rather than scheduler.js
// since it needs direct access to the evaluator closures above.
const runDecisionSweep = async () => {
  try {
    const settings = await getAutomationSettings();
    await evaluateStuckOrderDecisions(settings);
    const { rows: openReturns } = await pool.query(
      `SELECT r.*, o.created_at AS order_created_at FROM returns r JOIN orders o ON o.id = r.order_id WHERE r.status = 'requested'`
    );
    for (const r of openReturns) {
      await evaluateReturnDecision(r, { id: r.order_id, created_at: r.order_created_at }, settings);
    }
  } catch (err) {
    console.error('[decision sweep]', err);
  }
};

// Raw event rows are only needed for the trailing 13 months of reporting
// (enough for a year-over-year comparison) — prune beyond that daily so the
// table can't grow without bound.
const pruneAnalyticsEvents = async () => {
  try {
    await pool.query(`DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL '400 days'`);
  } catch (err) {
    console.error('[analytics prune]', err);
  }
};

const PORT = process.env.PORT || 3001;
warnOnMisconfiguration();
try {
  assertProductionConfiguration();
} catch (err) {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
}
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
    startRefundReminderScheduler(pool);
    setTimeout(runDecisionSweep, 45 * 1000);
    setInterval(runDecisionSweep, 60 * 60 * 1000);
    setTimeout(pruneAnalyticsEvents, 90 * 1000);
    setInterval(pruneAnalyticsEvents, 24 * 60 * 60 * 1000);
    setTimeout(pruneUserSessions, 120 * 1000);
    setInterval(pruneUserSessions, 24 * 60 * 60 * 1000);
  })
  .catch((err) => { console.error('DB init failed:', err); process.exit(1); });
