const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Token helpers ──────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('admin_token');

const authHeaders = (includeAuth = false): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(includeAuth && getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
});

// Thrown when the server returns 401 — callers can catch this to auto-logout
export class SessionExpiredError extends Error {
  constructor() { super('Session expired — please sign in again.'); this.name = 'SessionExpiredError'; }
}

const checkStatus = async (res: Response): Promise<Response> => {
  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    throw new SessionExpiredError();
  }
  return res;
};

// ── Legacy types (kept for backward compat) ────────────────────────────────────
export interface HeroSettings {
  headline: string;
  subtext: string;
  cta_text: string;
  show_countdown: boolean;
  launch_date: string | null;
}

export interface Subscriber {
  id: string;
  email: string;
  subscribed_at: string;
}

// ── Auth ───────────────────────────────────────────────────────────────────────
export const login = async (email: string, password: string): Promise<void> => {
  console.log('[api] login → POST', `${API_URL}/api/auth/login`);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password }),
    });
  } catch (networkErr) {
    throw new Error(`Cannot reach backend at ${API_URL} — check VITE_API_URL env var`);
  }
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try { const body = await res.json(); errMsg = body.error || errMsg; } catch {}
    throw new Error(errMsg);
  }
  const { token } = await res.json();
  localStorage.setItem('admin_token', token);
};

export const logout = (): void => {
  localStorage.removeItem('admin_token');
};

export const isLoggedIn = (): boolean => !!getToken();

// ── Generic content API ────────────────────────────────────────────────────────
// All site sections stored under /api/content/:section.
// Falls back to `fallback` when the backend is unavailable.

export const getContent = async <T>(section: string, fallback: T): Promise<T> => {
  try {
    const res = await fetch(`${API_URL}/api/content/${section}`);
    if (!res.ok) return fallback;
    const data = await res.json();
    if (!data) return fallback;
    if (Array.isArray(fallback)) return data as T;
    return { ...fallback, ...data } as T;
  } catch {
    return fallback;
  }
};

export const saveContent = async <T>(section: string, data: T): Promise<void> => {
  const res = await checkStatus(await fetch(`${API_URL}/api/content/${section}`, {
    method: 'PUT', headers: authHeaders(true), body: JSON.stringify(data),
  }));
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to save');
  }
};

// ── Legacy settings API ────────────────────────────────────────────────────────
export const getSettings = async (): Promise<HeroSettings> => {
  const res = await fetch(`${API_URL}/api/settings`);
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
};

export const saveSettings = async (data: HeroSettings): Promise<void> => {
  const res = await checkStatus(await fetch(`${API_URL}/api/settings`, {
    method: 'PUT', headers: authHeaders(true), body: JSON.stringify(data),
  }));
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to save settings');
  }
};

// ── Subscribers ────────────────────────────────────────────────────────────────
export const subscribe = async (email: string): Promise<void> => {
  const res = await fetch(`${API_URL}/api/subscribers`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw { code: res.status === 409 ? '23505' : 'unknown', message: err.error };
  }
};

export const getSubscribers = async (): Promise<Subscriber[]> => {
  const res = await checkStatus(await fetch(`${API_URL}/api/subscribers`, {
    headers: authHeaders(true),
  }));
  if (!res.ok) throw new Error('Unauthorized');
  return res.json();
};

// ── Shop categories & candles ──────────────────────────────────────────────────

export interface ShopCandle {
  id: string;
  name: string;
  price: string;
  scent_notes: string;
  tagline: string;
  category_id: string;
  image_url: string;
  rotation: number;
  pos_top: string;
  pos_left: string;
  display_order: number;
  is_active: boolean;
}

export interface ShopCategory {
  id: string;
  name: string;
  slug: string;
  mood_description: string;
  tags: string[];
  bg_color: string;
  page_bg_color: string;
  accent_color: string;
  text_color: string;
  stickers: Array<{ emoji: string; top: string; left: string; rotate: number; size: number }>;
  product_ids: string[];   // IDs referencing items in content_products
  display_order: number;
  is_active: boolean;
}

export const getShopCategories = async (): Promise<ShopCategory[]> => {
  try {
    const res = await fetch(`${API_URL}/api/shop/categories`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
};

export const saveShopCategory = async (cat: Partial<ShopCategory> & { id?: string }): Promise<ShopCategory> => {
  const method = cat.id ? 'PUT' : 'POST';
  const url = cat.id ? `${API_URL}/api/shop/categories/${cat.id}` : `${API_URL}/api/shop/categories`;
  const res = await checkStatus(await fetch(url, { method, headers: authHeaders(true), body: JSON.stringify(cat) }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as {error?:string}).error || 'Failed'); }
  return res.json();
};

export const deleteShopCategory = async (id: string): Promise<void> => {
  const res = await checkStatus(await fetch(`${API_URL}/api/shop/categories/${id}`, { method: 'DELETE', headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to delete category');
};

export const saveShopCandle = async (candle: Partial<ShopCandle> & { id?: string }): Promise<ShopCandle> => {
  const method = candle.id ? 'PUT' : 'POST';
  const url = candle.id ? `${API_URL}/api/shop/candles/${candle.id}` : `${API_URL}/api/shop/candles`;
  const res = await checkStatus(await fetch(url, { method, headers: authHeaders(true), body: JSON.stringify(candle) }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as {error?:string}).error || 'Failed'); }
  return res.json();
};

export const deleteShopCandle = async (id: string): Promise<void> => {
  const res = await checkStatus(await fetch(`${API_URL}/api/shop/candles/${id}`, { method: 'DELETE', headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to delete candle');
};

export const deleteSubscriber = async (id: string): Promise<void> => {
  const res = await checkStatus(await fetch(`${API_URL}/api/subscribers/${id}`, { method: 'DELETE', headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to delete subscriber');
};
