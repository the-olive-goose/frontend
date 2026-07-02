import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { sendOtpEmail, sendPasswordResetEmail, sendOrderConfirmationEmail, sendOrderStatusUpdateEmail,
  sendCancellationRequestedEmail, sendCancellationRequestAdminAlert, sendCancellationDecisionEmail,
  sendReturnRequestedEmail, sendReturnDecisionEmail, sendRefundCompletedEmail, sendCustomerMessageEmail,
  sendBackInStockEmail } from './email.js';
import { startRefundReminderScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Railway terminates TLS at a proxy — trust it so rate limiting sees real client IPs.
app.set('trust proxy', 1);

// ── Video upload (multer) ──────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `video-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed'));
  },
});

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `image-${Date.now()}${ext}`);
  },
});
const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5199',
  'http://localhost:8080',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true, // required so the browser sends/accepts the session cookie cross-port in dev
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
    res.status(500).json({ error: err.message });
  }
});

app.use(express.json());
app.use(cookieParser());

const IS_PROD      = process.env.NODE_ENV === 'production';
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
const FRONTEND_URL = process.env.FRONTEND_URL  || 'http://localhost:8080';
const BACKEND_URL  = process.env.BACKEND_URL   || 'http://localhost:3001';

const BCRYPT_ROUNDS = 12;

// ── Session cookie (customer-facing auth) ──────────────────────────────────────
// httpOnly so it's invisible to page JS (no XSS token theft), Secure in production
// (Railway serves over HTTPS), SameSite=Lax (localhost:8080 ↔ localhost:3001 count
// as the same "site" since SameSite ignores port, so this works in dev too).
const SESSION_COOKIE = 'og_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — sliding, see requireUserAuth

const sessionCookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: IS_PROD,
  sameSite: 'lax',
  path: '/',
  ...(maxAge ? { maxAge } : {}), // omit maxAge → browser-session cookie ("remember me" off)
});

const setSessionCookie = (res, userPayload, { remember = true } = {}) => {
  const token = jwt.sign({ ...userPayload, remember }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(remember ? SESSION_MAX_AGE_MS : undefined));
};

const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: IS_PROD, sameSite: 'lax', path: '/' });
};

// ── Rate limiters ───────────────────────────────────────────────────────────────
// General limiter for auth endpoints; a tighter one for code-sending endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many codes requested. Please wait a few minutes and try again.' },
});

// ── Validation helpers ──────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
const decrementStock = async (items) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_products'`);
    const content = rows[0]?.value;
    if (!content?.items?.length) return;
    let changed = false;
    const updatedItems = content.items.map((p) => {
      const line = items.find(i => i.product_id === p.id);
      if (!line || p.stock === undefined || p.stock === null) return p;
      changed = true;
      return { ...p, stock: Math.max(0, Number(p.stock) - line.quantity) };
    });
    if (changed) {
      await pool.query(
        `UPDATE site_settings SET value = $1, updated_at = NOW() WHERE key = 'content_products'`,
        [JSON.stringify({ ...content, items: updatedItems })]
      );
    }
  } catch (err) {
    console.error('[decrementStock]', err);
  }
};

const genTrackingNumber = () =>
  `OG${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 9000 + 1000)}`;

// Free-text fields (reasons, notes, admin message subject/body) come straight
// from request bodies — coerce to a bounded string so a non-string value can't
// crash a route (e.g. `{}.trim()`) and a giant string can't bloat storage/email.
const safeText = (v, max = 2000) => typeof v === 'string' ? v.trim().slice(0, max) : '';

// ── Shared helpers (dedupe price parsing / bundle logic used by checkout + ops) ─
const parsePrice = (price) => {
  const n = parseFloat(String(price ?? '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
};

const bundleIsSatisfied = (bundle, items) =>
  !!bundle.is_active && !!bundle.product_ids?.length &&
  bundle.product_ids.every(pid => items.some(i => i.product_id === pid));

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
    await decrementStock(p.items);
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
const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
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

// ── Admin login ────────────────────────────────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const adminEmail        = process.env.ADMIN_EMAIL;
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

  console.log('[login] received email:', email);
  if (!adminEmail || !adminPasswordHash)
    return res.status(500).json({ error: 'Admin credentials not configured' });
  if (email !== adminEmail)
    return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, adminPasswordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/user/me — update profile & address ──────────────────────────────
app.put('/api/user/me', requireUserAuth, async (req, res) => {
  const {
    full_name, phone, address_line1, address_line2, city, state, postal_code, country,
  } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET
         full_name     = COALESCE($1, full_name),
         phone         = COALESCE($2, phone),
         address_line1 = COALESCE($3, address_line1),
         address_line2 = COALESCE($4, address_line2),
         city          = COALESCE($5, city),
         state         = COALESCE($6, state),
         postal_code   = COALESCE($7, postal_code),
         country       = COALESCE($8, country)
       WHERE id = $9
       RETURNING id, email, phone, full_name, provider, avatar_url,
                 address_line1, address_line2, city, state, postal_code, country`,
      [full_name, phone, address_line1, address_line2, city, state, postal_code, country, req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Phone number already in use' });
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
  url.searchParams.set('access_type',   'offline');
  res.redirect(url.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
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
    if (!tokenData.access_token) throw new Error('No access token from Google');

    const userRes   = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const gUser = await userRes.json();

    const { rows } = await pool.query(
      `INSERT INTO users (email, full_name, avatar_url, provider, provider_id)
       VALUES ($1, $2, $3, 'google', $4)
       ON CONFLICT (email) DO UPDATE SET
         full_name   = COALESCE(EXCLUDED.full_name,   users.full_name),
         avatar_url  = COALESCE(EXCLUDED.avatar_url,  users.avatar_url),
         provider    = 'google',
         provider_id = EXCLUDED.provider_id
       RETURNING id, email, full_name, avatar_url, provider`,
      [gUser.email, gUser.name, gUser.picture, gUser.id]
    );

    const user = rows[0];
    setSessionCookie(res, { userId: user.id, email: user.email });
    res.redirect(`${FRONTEND_URL}/auth/callback`);
  } catch (err) {
    console.error('[google callback]', err);
    res.redirect(`${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(err.message)}`);
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
  res.redirect(url.toString());
});

app.get('/api/auth/facebook/callback', async (req, res) => {
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

    const { rows } = await pool.query(
      `INSERT INTO users (email, full_name, avatar_url, provider, provider_id)
       VALUES ($1, $2, $3, 'facebook', $4)
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
    res.redirect(`${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(err.message)}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PHONE OTP
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/phone/send-otp', otpSendLimiter, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

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
    res.status(500).json({ error: err.message });
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
      `INSERT INTO users (phone, provider)
       VALUES ($1, 'phone')
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, email, phone, full_name, avatar_url, provider`,
      [phone]
    );
    const user = userRows[0];
    setSessionCookie(res, { userId: user.id, phone: user.phone });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// Cart quantities are attacker-controlled input — without bounds, a negative
// value could be walked (via repeated adds) into an existing row to drag the
// checkout subtotal down, and an unbounded positive value has no real-world
// justification. 99 mirrors typical retail cart limits.
const MAX_CART_QTY = 99;
const isValidQty = (q) => Number.isInteger(q) && q >= 1 && q <= MAX_CART_QTY;

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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cart', requireUserAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_carts WHERE user_id = $1', [req.user.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

  try {
    const { rows: cartRows } = await pool.query(
      'SELECT * FROM user_carts WHERE user_id = $1 ORDER BY created_at ASC',
      [req.user.userId]
    );
    if (!cartRows.length) return res.status(400).json({ error: 'Your basket is empty' });

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
    const freeShippingThreshold = Number(pickup.free_shipping_threshold) || 65;

    let shipping = 0;
    let discountPercent = 0;
    let shippingAddress = {};

    if (fulfillmentType === 'pickup') {
      if (!pickup.enabled) return res.status(400).json({ error: 'In-store pickup is not available right now.' });

      discountPercent = Number(pickup.discount_percent) || 0;
      shippingAddress = {
        fulfillment_type: 'pickup',
        location_name:   pickup.location_name || 'The Olive Goose',
        address_line1:   pickup.address_line1 || '',
        city:            pickup.city || 'Dublin 18',
        eircode:         pickup.eircode || '',
        country:         pickup.country || 'Ireland',
        hours:           pickup.hours || '',
        contact_name:    profile.full_name || '',
        contact_phone:   contactPhone || profile.phone || '',
      };
    } else {
      shipping = subtotal >= freeShippingThreshold ? 0 : 4.99;
      shippingAddress = {
        fulfillment_type: 'delivery',
        full_name:      addressOverride.full_name ?? profile.full_name ?? '',
        phone:          addressOverride.phone ?? profile.phone ?? '',
        address_line1:  addressOverride.address_line1 ?? profile.address_line1 ?? '',
        address_line2:  addressOverride.address_line2 ?? profile.address_line2 ?? '',
        city:           addressOverride.city ?? profile.city ?? '',
        state:          addressOverride.state ?? profile.state ?? '',
        postal_code:    addressOverride.postal_code ?? profile.postal_code ?? '',
        country:        addressOverride.country ?? profile.country ?? '',
      };
      if (!shippingAddress.address_line1 || !shippingAddress.city)
        return res.status(400).json({ error: 'Please provide a delivery address.' });
    }

    // Today's Deals bundle savings — applied whenever the basket fully satisfies
    // an active bundle's product list, same rule the basket/checkout pages use to
    // decide whether to display the discount, so what's shown matches what's charged.
    const { rows: dealsRows } = await pool.query(`SELECT value FROM site_settings WHERE key = 'content_deals'`);
    const bundles = dealsRows[0]?.value?.bundles || [];
    const bundleSavings = bundles.reduce((sum, b) => {
      if (!bundleIsSatisfied(b, items)) return sum;
      const base = b.product_ids.reduce((s, pid) => {
        const item = items.find(i => i.product_id === pid);
        return item ? s + parsePrice(item.product_data?.price) * item.quantity : s;
      }, 0);
      return sum + (b.discount_type === 'percentage' ? base * (b.discount_value / 100) : b.discount_value);
    }, 0);

    const pickupDiscountAmount = subtotal * (discountPercent / 100);
    const discountAmount = +(pickupDiscountAmount + bundleSavings).toFixed(2);
    const total = +(subtotal - discountAmount + shipping).toFixed(2);
    if (total <= 0) return res.status(400).json({ error: 'Order total must be greater than zero.' });
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

    const payload = {
      items, subtotal, shipping, total, tracking_number: trackingNumber,
      shipping_address: shippingAddress, fulfillment_type: fulfillmentType,
      discount_percent: discountPercent, discount_amount: discountAmount,
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// LEGACY ADMIN CONTENT ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/settings', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM site_settings WHERE key = 'hero'");
    res.json(rows[0]?.value || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO site_settings (key, value) VALUES ('hero', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(req.body)]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/content/:section', async (req, res) => {
  const key = `content_${req.params.section}`;
  try {
    const { rows } = await pool.query('SELECT value FROM site_settings WHERE key = $1', [key]);
    res.json(rows[0]?.value || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/content/:section', requireAuth, async (req, res) => {
  const key = `content_${req.params.section}`;
  try {
    if (req.params.section === 'products') {
      const { rows: prevRows } = await pool.query('SELECT value FROM site_settings WHERE key = $1', [key]);
      getAutomationSettings()
        .then(settings => evaluateBackInStockDecisions(prevRows[0]?.value?.items, req.body?.items, settings))
        .catch(err => console.error('[evaluateBackInStockDecisions]', err));
    }
    await pool.query(
      `INSERT INTO site_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(req.body)]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/subscribers', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO subscribers (email) VALUES ($1) RETURNING *',
      [email.trim().toLowerCase()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') res.status(409).json({ error: 'already_subscribed' });
    else                      res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/users (admin only) ────────────────────────────────────────
app.get('/api/admin/users', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, full_name, provider, avatar_url, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/feedback (public) ───────────────────────────────────────────────
app.post('/api/feedback', async (req, res) => {
  const { name = '', email = '', rating = 5, message, photo_url = '' } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Feedback message is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO feedback (name, email, rating, message, photo_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name.trim(), email.trim(), rating, message.trim(), photo_url]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/admin/feedback (admin only) ──────────────────────────────────────
app.get('/api/admin/feedback', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM feedback ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/admin/feedback/:id (admin only) ───────────────────────────────
app.delete('/api/admin/feedback/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM feedback WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/subscribers', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM subscribers ORDER BY subscribed_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/subscribers/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM subscribers WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/shop/categories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM shop_categories WHERE is_active = true ORDER BY display_order ASC, created_at ASC'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/shop/categories/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM shop_categories WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/shop/candles/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM shop_candles WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/upload/video (admin only) ───────────────────────────────────────
app.post('/api/upload/video', requireAuth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  const url = `${BACKEND_URL}/uploads/${req.file.filename}`;
  res.json({ url });
});

// ── POST /api/upload/image (admin only) ───────────────────────────────────────
app.post('/api/upload/image', requireAuth, uploadImage.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  // Return a relative path — the frontend prepends its own API_URL so the URL
  // works correctly regardless of whether pointing at localhost or Railway.
  res.json({ path: `/uploads/${req.file.filename}` });
});

app.use('/uploads', express.static(uploadDir));

// ── Serve React frontend (SPA catch-all) ──────────────────────────────────────
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

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
    -- Backfill existing accounts as verified so they aren't affected by the new flow.
    UPDATE users SET email_verified = true WHERE email_verified = false;

    ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line1 TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line2 TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS city           TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS state          TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code    TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS country        TEXT DEFAULT '';

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
      "notes":            "Bring your order confirmation email — we''ll have it ready and waiting."
    }')
    ON CONFLICT (key) DO NOTHING;
  `);
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

const PORT = process.env.PORT || 3001;
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
    startRefundReminderScheduler(pool);
    setTimeout(runDecisionSweep, 45 * 1000);
    setInterval(runDecisionSweep, 60 * 60 * 1000);
  })
  .catch((err) => { console.error('DB init failed:', err); process.exit(1); });
