import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

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
  'http://localhost:8080',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

const JWT_SECRET   = process.env.JWT_SECRET   || 'changeme-use-a-real-secret-in-production';
const FRONTEND_URL = process.env.FRONTEND_URL  || 'http://localhost:8080';
const BACKEND_URL  = process.env.BACKEND_URL   || 'http://localhost:3001';

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
const requireUserAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.userId) return res.status(401).json({ error: 'Not a user token' });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Admin login ────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
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

// ── POST /api/user/register ────────────────────────────────────────────────────
app.post('/api/user/register', async (req, res) => {
  const { email, password, full_name = '' } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const hash    = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, provider)
       VALUES ($1, $2, $3, 'email')
       RETURNING id, email, full_name, provider, avatar_url`,
      [email.toLowerCase().trim(), hash, full_name.trim()]
    );
    const user  = rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/user/login ───────────────────────────────────────────────────────
app.post('/api/user/login', async (req, res) => {
  const { email, password } = req.body;
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

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, full_name: user.full_name, avatar_url: user.avatar_url, provider: user.provider } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/user/me ───────────────────────────────────────────────────────────
app.get('/api/user/me', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, phone, full_name, provider, avatar_url FROM users WHERE id = $1`,
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

    const user  = rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`);
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

    const user  = rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`);
  } catch (err) {
    console.error('[facebook callback]', err);
    res.redirect(`${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(err.message)}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PHONE OTP
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/phone/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const otp       = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  try {
    await pool.query(
      `INSERT INTO phone_otps (phone, otp, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE SET otp = $2, expires_at = $3`,
      [phone, otp, expiresAt]
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
      // Dev mode — return OTP in response so it can be shown in the UI
      console.log(`[DEV OTP] ${phone} → ${otp}`);
      res.json({ success: true, dev_otp: otp });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/phone/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM phone_otps WHERE phone = $1',
      [phone]
    );
    if (!rows.length)         return res.status(400).json({ error: 'No OTP found for this number' });
    if (new Date() > new Date(rows[0].expires_at))
                              return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    if (rows[0].otp !== otp.trim())
                              return res.status(400).json({ error: 'Invalid code. Try again.' });

    await pool.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);

    const { rows: userRows } = await pool.query(
      `INSERT INTO users (phone, provider)
       VALUES ($1, 'phone')
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, email, phone, full_name, avatar_url, provider`,
      [phone]
    );
    const user  = userRows[0];
    const token = jwt.sign({ userId: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
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

app.post('/api/cart/items', requireUserAuth, async (req, res) => {
  const { product_id, product_data, quantity = 1 } = req.body;
  if (!product_id || !product_data)
    return res.status(400).json({ error: 'product_id and product_data required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO user_carts (user_id, product_id, product_data, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, product_id) DO UPDATE
         SET quantity = user_carts.quantity + $4
       RETURNING *`,
      [req.user.userId, product_id, JSON.stringify(product_data), quantity]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cart/items/:productId', requireUserAuth, async (req, res) => {
  const { quantity } = req.body;
  if (quantity === undefined) return res.status(400).json({ error: 'quantity required' });
  try {
    if (quantity <= 0) {
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

    CREATE TABLE IF NOT EXISTS user_carts (
      id           UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id      UUID  REFERENCES users(id) ON DELETE CASCADE,
      product_id   TEXT  NOT NULL,
      product_data JSONB NOT NULL,
      quantity     INT   NOT NULL DEFAULT 1,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, product_id)
    );

    INSERT INTO site_settings (key, value)
    VALUES ('hero', '{
      "headline":       "Something beautiful is coming",
      "subtext":        "Handcrafted candles designed to elevate your space",
      "cta_text":       "Join the Waiting List",
      "show_countdown": false,
      "launch_date":    null
    }')
    ON CONFLICT (key) DO NOTHING;
  `);
  console.log('✅ Database ready');
}

const PORT = process.env.PORT || 3001;
initDb()
  .then(() => app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`)))
  .catch((err) => { console.error('DB init failed:', err); process.exit(1); });
