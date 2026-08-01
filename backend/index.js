import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import crypto from 'crypto';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Railway terminates TLS at a proxy — trust it so rate limiting sees real client IPs.
app.set('trust proxy', 1);

const IS_PROD = process.env.NODE_ENV === 'production';

// ── Security headers ───────────────────────────────────────────────────────────
// Applied to every response (API + the SPA this server also serves). Scripts are
// locked to 'self' — the Vite bundle has no inline scripts — while inline styles
// (React style props) and Google Fonts stay allowed so the site keeps rendering.
app.disable('x-powered-by');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https:",
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
  if (file.mimetype.startsWith(mimePrefix) && allowedExts.has(ext)) cb(null, true);
  else cb(new Error(`Only ${label} files are allowed (${[...allowedExts].join(', ')})`));
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
  'http://localhost:5173',
  'http://localhost:5199',
  'http://localhost:8080',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(toOrigin(origin) ?? origin)) return cb(null, true);
    const err = new Error('Origin not allowed');
    err.status = 403; // a rejected origin is a client error, not a server crash
    cb(err);
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
const refundViaStripe = async (paymentIntentId, amountCents) => {
  if (!stripe) throw new Error('Stripe is not configured');
  if (!paymentIntentId) throw new Error('This order has no Stripe payment to refund');
  return stripe.refunds.create({ payment_intent: paymentIntentId, amount: Math.round(amountCents) });
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

const BCRYPT_ROUNDS = 12;

// ── Session cookie (customer-facing auth) ──────────────────────────────────────
// httpOnly so it's invisible to page JS (no XSS token theft). In production the
// storefront (theolivegoose.ie) and this API (…up.railway.app) are different
// registrable sites, so the cookie is cross-site on every fetch() from the shop.
// A SameSite=Lax cookie is NOT attached to cross-site XHR/fetch, which would make
// checkout behave as if logged out — so production must use SameSite=None; Secure
// (Secure is mandatory for None, and Railway serves HTTPS). Dev stays Lax because
// SameSite=None requires Secure, which a browser won't honour over http://localhost.
const SESSION_COOKIE = 'og_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — sliding, see requireUserAuth

// Decide Secure/SameSite from the actual connection, not just NODE_ENV: Railway
// terminates TLS at its proxy, and with `trust proxy` set req.secure reflects
// x-forwarded-proto. If NODE_ENV is ever left unset on a real HTTPS deploy, a
// NODE_ENV-only check would emit a Lax, non-Secure cookie that browsers refuse
// to store from a cross-site response — login then "succeeds" but no session
// persists. Keying on req.secure keeps the cookie None+Secure on any HTTPS
// deploy while dev over plain http stays Lax (None requires Secure, which
// browsers won't honour on http://localhost).
const sessionCookieOptions = (res, maxAge) => {
  const secure = IS_PROD || Boolean(res.req?.secure);
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
    ...(maxAge ? { maxAge } : {}), // omit maxAge → browser-session cookie ("remember me" off)
  };
};

const setSessionCookie = (res, userPayload, { remember = true } = {}) => {
  const token = jwt.sign({ ...userPayload, remember }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(res, remember ? SESSION_MAX_AGE_MS : undefined));
};

const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(res));
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
const analyticsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 150,
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

const sixDigitCode = () => Math.floor(100000 + Math.random() * 900000).toString();

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
  `OG${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 9000 + 1000)}`;

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

  const blocked = await welcomeCodeBlockReason(pool, row, userId, await canonicalEmailForUser(userId));
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

  const client = await pool.connect();
  try {
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

    // Recipient binding + one-welcome-per-person, evaluated inside the same
    // transaction that holds the FOR UPDATE lock (see welcomeCodeBlockReason).
    const blocked = await welcomeCodeBlockReason(client, target, userId, userCanonical);
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

// Spend the code for good, at order finalization. Idempotent and defensive: the
// per-user NOT EXISTS guard is a second line of defence behind the reservation
// so a redeem can never hand one account a second welcome discount.
const redeemDiscountCode = async (code, userId, orderId) => {
  const normalized = normalizeCode(code);
  if (!normalized) return;
  await pool.query(
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
    `SELECT id, stripe_session_id FROM pending_checkouts
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
// facing session token is never exposed to page JS). On every successful check it
// reissues the cookie with a fresh expiry ("sliding session"), so an active shopper
// is never abruptly logged out mid-visit; only real inactivity lets it lapse.
const requireUserAuth = (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.userId) return res.status(401).json({ error: 'Not a user token' });
    req.user = payload;
    setSessionCookie(res, { userId: payload.userId, email: payload.email, phone: payload.phone }, { remember: payload.remember !== false });
    next();
  } catch {
    clearSessionCookie(res);
    res.status(401).json({ error: 'Invalid or expired session' });
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
    setSessionCookie(res, { userId: user.id, email: user.email });
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

    setSessionCookie(res, { userId: user.id, email: user.email }, { remember: !!remember });
    res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, avatar_url: user.avatar_url, provider: user.provider } });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ── POST /api/user/logout ──────────────────────────────────────────────────────
app.post('/api/user/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
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
    res.json({ success: true });
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
    setSessionCookie(res, { userId: user.id, email: user.email });
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
    setSessionCookie(res, { userId: user.id, email: user.email });
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
    setSessionCookie(res, { userId: user.id, email: user.email });
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

  const otp       = Math.floor(100000 + Math.random() * 900000).toString();
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
    setSessionCookie(res, { userId: user.id, phone: user.phone });
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
app.post('/api/checkout/session', requireUserAuth, async (req, res) => {
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
    const analyticsIds = {
      visitor_id: analyticsId(req.body.analytics?.visitor_id),
      session_id: analyticsId(req.body.analytics?.session_id),
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
        await refundViaStripe(order.stripe_payment_intent_id, Math.round(Number(order.total) * 100));
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

  try {
    const { rows: orderRows } = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [order_id, req.user.userId]
    );
    if (!orderRows.length) return res.status(404).json({ error: 'Order not found' });

    const item = (orderRows[0].items || []).find(i => i.product_id === product_id);
    if (!item) return res.status(400).json({ error: 'That item is not part of this order' });

    const { rows } = await pool.query(
      `INSERT INTO returns (order_id, user_id, product_id, product_name, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [order_id, req.user.userId, product_id, item.product_data?.name || '', reason]
    );
    const ret = rows[0];

    await addOrderEvent(order_id, {
      type: 'return_requested', actor: 'customer', title: `Return requested: ${ret.product_name}`,
      detail: reason, meta: { return_id: ret.id },
    });
    if (req.user.email) {
      sendReturnRequestedEmail(req.user.email, { productName: ret.product_name, trackingNumber: orderRows[0].tracking_number })
        .catch(err => console.error('[sendReturnRequestedEmail]', err));
    }
    getAutomationSettings().then(settings => evaluateReturnDecision(ret, orderRows[0], settings)).catch(err => console.error('[evaluateReturnDecision]', err));

    res.status(201).json(ret);
  } catch (err) {
    sendServerError(res, err);
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
            await refundViaStripe(order.stripe_payment_intent_id, amount * 100);
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
const CLIENT_EVENT_TYPES = new Set([
  'page_view', 'add_to_cart', 'remove_from_cart', 'begin_checkout',
  'newsletter_signup', 'signup', 'login', 'web_vital',
]);

// Client-generated opaque ids (crypto.randomUUID or similar) — anything else is
// dropped so junk can't be smuggled into GROUP BY keys.
const ANALYTICS_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const analyticsId = (v) => (typeof v === 'string' && ANALYTICS_ID_RE.test(v) ? v : null);
const clip = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Best-effort: tag events with the logged-in customer when the session cookie is
// present and valid, so the journey stitches visitor → account. Never rejects.
const userIdFromSessionCookie = (req) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET).userId || null; } catch { return null; }
};

const OBVIOUS_BOT_RE = /bot|crawler|spider|scraper|headless|lighthouse|pingdom/i;

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
  if (OBVIOUS_BOT_RE.test(req.headers['user-agent'] || '')) return res.status(204).end();

  const userId = userIdFromSessionCookie(req);
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
      clip(e.device, 20), props,
    );
    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`);
  }
  if (!values.length) return res.status(204).end();

  try {
    await pool.query(
      `INSERT INTO analytics_events (visitor_id, session_id, user_id, event_type, path, referrer, utm_source, utm_medium, utm_campaign, device, props)
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
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = isoDay(Date.now());

  let start = DATE_RE.test(String(req.query.start)) ? req.query.start : null;
  let end   = DATE_RE.test(String(req.query.end))   ? req.query.end   : null;
  if (!start || !end || end < start) {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 730);
    end = today;
    start = isoDay(Date.parse(today) - (days - 1) * 86400000);
  }
  // Cap the window at 2 years so a mistyped range can't scan unbounded history.
  let lenDays = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  if (lenDays > 731) { lenDays = 731; start = isoDay(Date.parse(end) - 730 * 86400000); }

  const endExcl   = isoDay(Date.parse(end) + 86400000);          // $2 — end-exclusive
  const prevStart = isoDay(Date.parse(start) - lenDays * 86400000); // $3 — previous window start
  const w = [start, endExcl, prevStart];

  // Orders that count toward revenue: paid and not refunded.
  const PAID = `payment_status = 'paid' AND refund_status <> 'refunded'`;

  // Session source, derivable per event row: UTM params are stamped on every
  // event of a session and document.referrer survives SPA navigation, so this
  // expression is stable across a session without a per-session lookup.
  const SRC_EXPR = `COALESCE(NULLIF(utm_source, ''), NULLIF(regexp_replace(referrer, '^https?://([^/]+).*$', '\\1'), ''), 'direct')`;

  // ── Dimension filters ─────────────────────────────────────────────────────
  // ?device=mobile|tablet|desktop and ?source=<name> scope every event-derived
  // metric. When either is active, sales figures switch from the orders table
  // to session-attributed purchase events (the orders table has no device or
  // source), and the response flags this via `attributed: true`.
  const device = ['mobile', 'tablet', 'desktop'].includes(String(req.query.device)) ? String(req.query.device) : null;
  const rawSource = typeof req.query.source === 'string' ? req.query.source.slice(0, 100) : '';
  const source = rawSource && rawSource !== 'all' ? rawSource : null;
  const filtered = !!(device || source);

  // Appends "AND …" clauses starting at parameter $nextIdx. Always spread the
  // returned params after the query's base params — never share one filter
  // object between queries with different base-param counts.
  const evf = (nextIdx) => {
    let sql = '';
    const params = [];
    if (device) { sql += ` AND device = $${nextIdx + params.length}`; params.push(device); }
    if (source) { sql += ` AND ${SRC_EXPR} = $${nextIdx + params.length}`; params.push(source); }
    return { sql, params };
  };

  // ?attr=source|medium|campaign switches the attribution table's grouping.
  const ATTR_EXPRS = {
    source: SRC_EXPR,
    medium: `COALESCE(NULLIF(utm_medium, ''), '(none)')`,
    campaign: `COALESCE(NULLIF(utm_campaign, ''), '(none)')`,
  };
  const attr = ['source', 'medium', 'campaign'].includes(String(req.query.attr)) ? String(req.query.attr) : 'source';

  // Guarded numeric read of the total stashed on purchase/begin_checkout events.
  const PROPS_TOTAL = `CASE WHEN props->>'total' ~ '^[0-9.]+$' THEN (props->>'total')::numeric END`;

  try {
    const f3 = evf(3); // filter clauses for queries with 2 base params
    const f4 = evf(4); // filter clauses for queries with 3 base params

    const [traffic, newVsReturning, funnel, daily, sales, customers, topProducts, topPages, sources, devices, vitals, abandoned] = await Promise.all([

      // Traffic KPIs — current window vs the previous window of the same length.
      pool.query(
        `SELECT
           COUNT(DISTINCT visitor_id) FILTER (WHERE created_at >= $1)::int AS visitors,
           COUNT(DISTINCT session_id) FILTER (WHERE created_at >= $1)::int AS sessions,
           COUNT(*) FILTER (WHERE event_type = 'page_view' AND created_at >= $1)::int AS pageviews,
           COUNT(DISTINCT visitor_id) FILTER (WHERE created_at < $1)::int AS prev_visitors,
           COUNT(DISTINCT session_id) FILTER (WHERE created_at < $1)::int AS prev_sessions,
           COUNT(*) FILTER (WHERE event_type = 'page_view' AND created_at < $1)::int AS prev_pageviews
         FROM analytics_events
         WHERE created_at >= $3 AND created_at < $2 AND event_type <> 'web_vital'${f4.sql}`,
        [...w, ...f4.params]
      ),

      // New vs returning + bounce, over the current window only. A visitor is
      // "new" when their first event ever falls inside the window; a bounced
      // session viewed exactly one page. first_seen stays unfiltered — whether
      // a visitor is returning depends on their whole history, not the slice.
      pool.query(
        `WITH first_seen AS (
           SELECT visitor_id, MIN(created_at) AS first_at FROM analytics_events GROUP BY visitor_id
         ), window_visitors AS (
           SELECT DISTINCT visitor_id FROM analytics_events WHERE created_at >= $1 AND created_at < $2${f3.sql}
         ), session_pages AS (
           SELECT session_id, COUNT(*) FILTER (WHERE event_type = 'page_view') AS pages
           FROM analytics_events WHERE created_at >= $1 AND created_at < $2${f3.sql} GROUP BY session_id
         )
         SELECT
           (SELECT COUNT(*) FROM window_visitors wv JOIN first_seen fs USING (visitor_id) WHERE fs.first_at >= $1)::int AS new_visitors,
           (SELECT COUNT(*) FROM window_visitors wv JOIN first_seen fs USING (visitor_id) WHERE fs.first_at < $1)::int AS returning_visitors,
           (SELECT COUNT(*) FROM session_pages WHERE pages = 1)::int AS bounced_sessions,
           (SELECT COUNT(*) FROM session_pages WHERE pages > 0)::int AS pageview_sessions`,
        [start, endExcl, ...f3.params]
      ),

      // Conversion funnel — distinct sessions reaching each stage in the window.
      pool.query(
        `SELECT
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'page_view')::int AS visited,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'page_view' AND (path LIKE '/shop%' OR path LIKE '/deals%'))::int AS browsed,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'add_to_cart')::int AS carted,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'begin_checkout')::int AS checkout,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'purchase')::int AS purchased
         FROM analytics_events WHERE created_at >= $1 AND created_at < $2${f3.sql}`,
        [start, endExcl, ...f3.params]
      ),

      // Daily series — traffic from events, zero-filled. Sales come from the
      // orders table (exact) normally, or from session-attributed purchase
      // events when a device/source filter is active.
      pool.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                COALESCE(e.visitors, 0) AS visitors, COALESCE(e.sessions, 0) AS sessions,
                COALESCE(e.pageviews, 0) AS pageviews,
                COALESCE(o.orders, 0) AS orders, COALESCE(o.revenue, 0) AS revenue
         FROM generate_series($1::date, $2::date - 1, '1 day') AS day
         LEFT JOIN (
           SELECT created_at::date AS day, COUNT(DISTINCT visitor_id)::int AS visitors,
                  COUNT(DISTINCT session_id)::int AS sessions,
                  COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS pageviews
           FROM analytics_events WHERE created_at >= $1 AND created_at < $2 AND event_type <> 'web_vital'${f3.sql}
           GROUP BY 1
         ) e USING (day)
         LEFT JOIN (
           ${filtered
             ? `SELECT created_at::date AS day, COUNT(*)::int AS orders,
                       COALESCE(ROUND(SUM(${PROPS_TOTAL}), 2), 0)::float AS revenue
                FROM analytics_events
                WHERE event_type = 'purchase' AND created_at >= $1 AND created_at < $2${f3.sql}
                GROUP BY 1`
             : `SELECT created_at::date AS day, COUNT(*)::int AS orders, ROUND(SUM(total), 2)::float AS revenue
                FROM orders WHERE created_at >= $1 AND created_at < $2 AND ${PAID}
                GROUP BY 1`}
         ) o USING (day)
         ORDER BY day`,
        [start, endExcl, ...f3.params]
      ),

      // Sales KPIs — current vs previous window. Same source switch as above.
      pool.query(
        filtered
          ? `SELECT
               COUNT(*) FILTER (WHERE created_at >= $1)::int AS orders,
               COALESCE(ROUND(SUM(pt) FILTER (WHERE created_at >= $1), 2), 0)::float AS revenue,
               COALESCE(ROUND(AVG(pt) FILTER (WHERE created_at >= $1), 2), 0)::float AS aov,
               COUNT(*) FILTER (WHERE created_at < $1)::int AS prev_orders,
               COALESCE(ROUND(SUM(pt) FILTER (WHERE created_at < $1), 2), 0)::float AS prev_revenue,
               COALESCE(ROUND(AVG(pt) FILTER (WHERE created_at < $1), 2), 0)::float AS prev_aov
             FROM (
               SELECT created_at, ${PROPS_TOTAL} AS pt FROM analytics_events
               WHERE event_type = 'purchase' AND created_at >= $3 AND created_at < $2${f4.sql}
             ) p`
          : `SELECT
               COUNT(*) FILTER (WHERE created_at >= $1)::int AS orders,
               COALESCE(ROUND(SUM(total) FILTER (WHERE created_at >= $1), 2), 0)::float AS revenue,
               COALESCE(ROUND(AVG(total) FILTER (WHERE created_at >= $1), 2), 0)::float AS aov,
               COUNT(*) FILTER (WHERE created_at < $1)::int AS prev_orders,
               COALESCE(ROUND(SUM(total) FILTER (WHERE created_at < $1), 2), 0)::float AS prev_revenue,
               COALESCE(ROUND(AVG(total) FILTER (WHERE created_at < $1), 2), 0)::float AS prev_aov
             FROM orders WHERE created_at >= $3 AND created_at < $2 AND ${PAID}`,
        filtered ? [...w, ...f4.params] : w
      ),

      // Customer KPIs — lifetime view plus what happened inside the window.
      // "New customer" = first-ever paid order falls inside the window; "repeat
      // customer in window" = ordered in the window with an earlier paid order.
      pool.query(
        `WITH paid_orders AS (
           SELECT user_id, total, created_at FROM orders WHERE ${PAID}
         ), per_customer AS (
           SELECT user_id, COUNT(*) AS orders, SUM(total) AS spent, MIN(created_at) AS first_order
           FROM paid_orders GROUP BY user_id
         )
         SELECT
           (SELECT COUNT(*) FROM per_customer)::int AS total_customers,
           (SELECT COUNT(*) FROM per_customer WHERE orders > 1)::int AS lifetime_repeat_customers,
           (SELECT COUNT(*) FROM per_customer WHERE first_order >= $1 AND first_order < $2)::int AS new_customers,
           (SELECT COUNT(DISTINCT p.user_id) FROM paid_orders p JOIN per_customer c USING (user_id)
             WHERE p.created_at >= $1 AND p.created_at < $2 AND c.first_order < $1)::int AS returning_customers,
           COALESCE((SELECT ROUND(AVG(spent), 2) FROM per_customer), 0)::float AS avg_lifetime_value,
           COALESCE((SELECT ROUND(AVG(orders), 2) FROM per_customer), 0)::float AS avg_orders_per_customer`,
        [start, endExcl]
      ),

      // Top products by revenue from order line items, joined with add-to-cart
      // counts from events so cart-to-purchase leaks are visible per product.
      // Under a filter, only orders whose purchase event landed in a matching
      // session are counted (purchase props carry the order id).
      pool.query(
        `WITH line_items AS (
           SELECT item->>'product_id' AS product_id,
                  item->'product_data'->>'name' AS name,
                  (item->>'quantity')::int AS qty,
                  COALESCE(NULLIF(regexp_replace(item->'product_data'->>'price', '[^0-9.]', '', 'g'), ''), '0')::numeric AS price
           FROM orders o, jsonb_array_elements(o.items) AS item
           WHERE o.created_at >= $1 AND o.created_at < $2 AND ${PAID}
           ${filtered ? `AND o.id::text IN (
             SELECT props->>'order_id' FROM analytics_events
             WHERE event_type = 'purchase' AND created_at >= $1 AND created_at < $2${f3.sql})` : ''}
         ), carts AS (
           SELECT props->>'product_id' AS product_id, COUNT(*)::int AS add_to_carts
           FROM analytics_events
           WHERE event_type = 'add_to_cart' AND created_at >= $1 AND created_at < $2${f3.sql}
           GROUP BY 1
         )
         SELECT COALESCE(li.name, 'Unknown') AS name,
                SUM(li.qty)::int AS units,
                ROUND(SUM(li.qty * li.price), 2)::float AS revenue,
                COALESCE(MAX(c.add_to_carts), 0)::int AS add_to_carts
         FROM line_items li LEFT JOIN carts c USING (product_id)
         GROUP BY li.product_id, li.name ORDER BY revenue DESC LIMIT 10`,
        [start, endExcl, ...f3.params]
      ),

      // Top pages by views + unique sessions.
      pool.query(
        `SELECT path, COUNT(*)::int AS views, COUNT(DISTINCT session_id)::int AS sessions
         FROM analytics_events
         WHERE event_type = 'page_view' AND created_at >= $1 AND created_at < $2${f3.sql}
         GROUP BY path ORDER BY views DESC LIMIT 10`,
        [start, endExcl, ...f3.params]
      ),

      // Attribution table — grouped by source (default), medium, or campaign.
      // Sessions are attributed by their landing event; purchases join back on
      // session so each row shows the revenue it actually produced.
      pool.query(
        `WITH landing AS (
           SELECT DISTINCT ON (session_id) session_id, ${ATTR_EXPRS[attr]} AS source
           FROM analytics_events
           WHERE created_at >= $1 AND created_at < $2 AND event_type <> 'web_vital'${f3.sql}
           ORDER BY session_id, created_at ASC
         ), purchases AS (
           SELECT session_id, COUNT(*)::int AS orders,
                  ROUND(SUM(COALESCE(${PROPS_TOTAL}, 0)), 2)::float AS revenue
           FROM analytics_events
           WHERE event_type = 'purchase' AND created_at >= $1 AND created_at < $2${f3.sql}
           GROUP BY session_id
         )
         SELECT l.source, COUNT(*)::int AS sessions,
                COALESCE(SUM(p.orders), 0)::int AS orders,
                COALESCE(ROUND(SUM(p.revenue)::numeric, 2), 0)::float AS revenue
         FROM landing l LEFT JOIN purchases p USING (session_id)
         GROUP BY l.source ORDER BY sessions DESC LIMIT 10`,
        [start, endExcl, ...f3.params]
      ),

      // Device mix by sessions.
      pool.query(
        `SELECT COALESCE(NULLIF(device, ''), 'unknown') AS device, COUNT(DISTINCT session_id)::int AS sessions
         FROM analytics_events
         WHERE created_at >= $1 AND created_at < $2 AND event_type <> 'web_vital'${f3.sql}
         GROUP BY 1 ORDER BY sessions DESC`,
        [start, endExcl, ...f3.params]
      ),

      // Web vitals — p75 per metric (the threshold Google grades against).
      pool.query(
        `SELECT props->>'metric' AS metric,
                ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY (props->>'value')::numeric)::numeric, 4)::float AS p75,
                COUNT(*)::int AS samples
         FROM analytics_events
         WHERE event_type = 'web_vital' AND created_at >= $1 AND created_at < $2
           AND props->>'value' ~ '^[0-9.]+$'${f3.sql}
         GROUP BY 1`,
        [start, endExcl, ...f3.params]
      ),

      // Checkout abandonment — sessions that started checkout but never
      // purchased, with the basket value they walked away from.
      pool.query(
        `WITH s AS (
           SELECT session_id,
                  BOOL_OR(event_type = 'begin_checkout') AS started,
                  BOOL_OR(event_type = 'purchase') AS purchased,
                  MAX(CASE WHEN event_type = 'begin_checkout' THEN ${PROPS_TOTAL} END) AS checkout_total
           FROM analytics_events
           WHERE created_at >= $1 AND created_at < $2 AND event_type IN ('begin_checkout', 'purchase')${f3.sql}
           GROUP BY session_id
         )
         SELECT COUNT(*) FILTER (WHERE started)::int AS checkout_sessions,
                COUNT(*) FILTER (WHERE started AND NOT purchased)::int AS abandoned_sessions,
                COALESCE(ROUND(SUM(checkout_total) FILTER (WHERE started AND NOT purchased), 2), 0)::float AS lost_revenue
         FROM s`,
        [start, endExcl, ...f3.params]
      ),
    ]);

    const t = traffic.rows[0];
    const nvr = newVsReturning.rows[0];
    const s = sales.rows[0];
    const f = funnel.rows[0];

    res.json({
      start, end, days: lenDays,
      filters: { device, source, attr },
      // True when device/source filters forced sales onto session-attributed
      // purchase events instead of the exact orders table.
      attributed: filtered,
      abandoned: abandoned.rows[0],
      traffic: {
        visitors: t.visitors, sessions: t.sessions, pageviews: t.pageviews,
        pages_per_session: t.sessions ? +(t.pageviews / t.sessions).toFixed(2) : 0,
        bounce_rate: nvr.pageview_sessions ? +(nvr.bounced_sessions / nvr.pageview_sessions * 100).toFixed(1) : 0,
        new_visitors: nvr.new_visitors, returning_visitors: nvr.returning_visitors,
        prev: { visitors: t.prev_visitors, sessions: t.prev_sessions, pageviews: t.prev_pageviews },
      },
      sales: {
        revenue: s.revenue, orders: s.orders, aov: s.aov,
        conversion_rate: t.sessions ? +(f.purchased / t.sessions * 100).toFixed(2) : 0,
        prev: { revenue: s.prev_revenue, orders: s.prev_orders, aov: s.prev_aov },
      },
      customers: customers.rows[0],
      funnel: [
        { stage: 'Visited site', sessions: f.visited },
        { stage: 'Browsed products', sessions: f.browsed },
        { stage: 'Added to cart', sessions: f.carted },
        { stage: 'Started checkout', sessions: f.checkout },
        { stage: 'Purchased', sessions: f.purchased },
      ],
      daily: daily.rows,
      top_products: topProducts.rows,
      top_pages: topPages.rows,
      sources: sources.rows,
      devices: devices.rows,
      web_vitals: vitals.rows,
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
         FROM analytics_events
         WHERE created_at > NOW() - INTERVAL '5 minutes' AND event_type <> 'web_vital'`
      ),
      // Where each active session currently is — its most recent page view.
      pool.query(
        `SELECT path, COUNT(*)::int AS sessions FROM (
           SELECT DISTINCT ON (session_id) session_id, path FROM analytics_events
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
          // Always return the code so the signup card can show it right away — the
          // email is a nice-to-have, but the customer must never be left without
          // their discount just because mail delivery is flaky or misconfigured.
          // (Single-use, per-email welcome code, so echoing it here is low-risk.)
          discount = { discount_percent: Number(codeRow.discount_percent), email_delivered: delivered, code: codeRow.code };
        }
      }
    } catch (err) {
      console.error('[issueSubscriberDiscountCode]', err);
    }

    // "This mailbox already spent its welcome discount" outranks "this exact
    // spelling is new to the list". A +tag alias of a redeemed address is a genuinely
    // new subscriber row, but answering 201-with-no-discount would show the signup
    // card's success view with an empty space where the code belongs. Say plainly
    // that the discount is gone — that's the part the shopper is asking about, and
    // they stay subscribed either way.
    if (alreadyUsed) return res.status(409).json({ error: 'already_subscribed', already_used: true });
    if (isNew) return res.status(201).json({ email, already_subscribed: false, discount });
    // Already on the list. If there's still an unused code, hand it over (200);
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

// ── GET /api/admin/discount-codes (admin only) ───────────────────────────────
app.get('/api/admin/discount-codes', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, email, discount_percent, discount_type, discount_value,
              max_redemptions, redemption_count, is_active, label, source,
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
           (code, email, source, discount_type, discount_value, discount_percent, max_redemptions, label)
         VALUES ($1, NULL, 'admin', $2, $3, $4, $5, $6)
         RETURNING id, code, email, discount_percent, discount_type, discount_value,
                   max_redemptions, redemption_count, is_active, label, source,
                   redeemed_at, order_id, created_at`,
        [code, discountType, discountValue, legacyPercent, maxRedemptions, label]
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
                 max_redemptions, redemption_count, is_active, label, source,
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
  try {
    const { rows } = await pool.query("SELECT value FROM site_settings WHERE key = 'content_seo'");
    const configured = String(rows[0]?.value?.favicon_url || '').trim();
    if (configured) {
      // Uploaded through the admin: serve the bytes from disk so the crawler gets
      // a 200 with the real image rather than a hop it may not follow.
      const uploaded = configured.match(/\/uploads\/([A-Za-z0-9._-]+)$/);
      if (uploaded) {
        const onDisk = path.join(uploadDir, uploaded[1]);
        if (existsSync(onDisk)) return res.sendFile(onDisk);
      } else if (/^https?:\/\//i.test(configured)) {
        return res.redirect(302, configured);
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
    CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events (created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_type    ON analytics_events (event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events (session_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor ON analytics_events (visitor_id, created_at);

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
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
    startRefundReminderScheduler(pool);
    setTimeout(runDecisionSweep, 45 * 1000);
    setInterval(runDecisionSweep, 60 * 60 * 1000);
    setTimeout(pruneAnalyticsEvents, 90 * 1000);
    setInterval(pruneAnalyticsEvents, 24 * 60 * 60 * 1000);
  })
  .catch((err) => { console.error('DB init failed:', err); process.exit(1); });
