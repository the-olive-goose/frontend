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
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed'));
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
    // allow requests with no origin (curl, Postman, etc.) and any listed origin
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'changeme-use-a-real-secret-in-production';

// ── Auth middleware ────────────────────────────────────────────────────────────
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

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── POST /api/auth/login ───────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

  // Temporary debug — remove after login is confirmed working
  console.log('[login] received email:', email);
  console.log('[login] expected email:', adminEmail);
  console.log('[login] hash configured:', !!adminPasswordHash);

  if (!adminEmail || !adminPasswordHash) {
    return res.status(500).json({ error: 'Admin credentials not configured' });
  }

  if (email !== adminEmail) {
    console.log('[login] email mismatch — rejecting');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, adminPasswordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// ── GET /api/settings ──────────────────────────────────────────────────────────
app.get('/api/settings', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM site_settings WHERE key = 'hero'");
    res.json(rows[0]?.value || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/settings (admin only) ────────────────────────────────────────────
app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO site_settings (key, value)
       VALUES ('hero', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(req.body)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/content/:section (public) ────────────────────────────────────────
// Generic endpoint — any section name maps to a row in site_settings
app.get('/api/content/:section', async (req, res) => {
  const key = `content_${req.params.section}`;
  try {
    const { rows } = await pool.query(
      'SELECT value FROM site_settings WHERE key = $1',
      [key]
    );
    res.json(rows[0]?.value || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/content/:section (admin only) ────────────────────────────────────
app.put('/api/content/:section', requireAuth, async (req, res) => {
  const key = `content_${req.params.section}`;
  try {
    await pool.query(
      `INSERT INTO site_settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(req.body)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/subscribers ──────────────────────────────────────────────────────
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
    if (err.code === '23505') {
      res.status(409).json({ error: 'already_subscribed' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// ── GET /api/subscribers (admin only) ─────────────────────────────────────────
app.get('/api/subscribers', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM subscribers ORDER BY subscribed_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/subscribers/:id (admin only) ──────────────────────────────────
app.delete('/api/subscribers/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM subscribers WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/shop/categories (public) ────────────────────────────────────────
app.get('/api/shop/categories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM shop_categories WHERE is_active = true ORDER BY display_order ASC, created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/shop/categories (admin) ─────────────────────────────────────────
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/shop/categories/:id (admin) ──────────────────────────────────────
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/shop/categories/:id (admin) ───────────────────────────────────
app.delete('/api/shop/categories/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM shop_categories WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/shop/candles (admin) ────────────────────────────────────────────
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/shop/candles/:id (admin) ─────────────────────────────────────────
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/shop/candles/:id (admin) ──────────────────────────────────────
app.delete('/api/shop/candles/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM shop_candles WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Database initialisation ────────────────────────────────────────────────────
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      key   TEXT        UNIQUE NOT NULL,
      value JSONB       DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      email         TEXT        UNIQUE NOT NULL,
      subscribed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shop_categories (
      id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      name          TEXT        NOT NULL,
      slug          TEXT        UNIQUE NOT NULL,
      mood_description TEXT     DEFAULT '',
      tags          JSONB       DEFAULT '[]',
      bg_color      TEXT        DEFAULT '#f5e4cb',
      page_bg_color TEXT        DEFAULT '#ede0c8',
      accent_color  TEXT        DEFAULT '#6b3520',
      text_color    TEXT        DEFAULT '#2c1508',
      stickers      JSONB       DEFAULT '[]',
      product_ids   JSONB       DEFAULT '[]',
      display_order INT         DEFAULT 0,
      is_active     BOOL        DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE shop_categories ADD COLUMN IF NOT EXISTS product_ids JSONB DEFAULT '[]';

    CREATE TABLE IF NOT EXISTS shop_candles (
      id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      name          TEXT        NOT NULL,
      price         TEXT        DEFAULT '$0',
      scent_notes   TEXT        DEFAULT '',
      tagline       TEXT        DEFAULT '',
      category_id   UUID        REFERENCES shop_categories(id) ON DELETE CASCADE,
      image_url     TEXT        DEFAULT '',
      rotation      INT         DEFAULT 0,
      pos_top       TEXT        DEFAULT '10%',
      pos_left      TEXT        DEFAULT '10%',
      display_order INT         DEFAULT 0,
      is_active     BOOL        DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW()
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

// ── Serve React frontend (SPA catch-all) ──────────────────────────────────────
const distPath = path.join(__dirname, '../dist');
// ── POST /api/upload/video (admin only) ───────────────────────────────────────
app.post('/api/upload/video', requireAuth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  const url = `${baseUrl}/uploads/${req.file.filename}`;
  res.json({ url });
});

// ── Serve uploaded videos ──────────────────────────────────────────────────────
app.use('/uploads', express.static(uploadDir));

app.use(express.static(distPath));
// Any route not matched by the API above returns index.html so React Router works
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
initDb()
  .then(() => app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`)))
  .catch((err) => {
    console.error('DB init failed:', err);
    process.exit(1);
  });
