import { fetchWithTimeout, RequestTimeoutError } from './fetchTimeout';

// In dev the backend runs on a separate port; in production the same Railway
// service serves both the SPA and the API, so use a same-origin relative URL.
// VITE_API_URL can override either (e.g. split frontend/backend deployments).
const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

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
    res = await fetchWithTimeout(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password }),
    });
  } catch (networkErr) {
    if (networkErr instanceof RequestTimeoutError) throw networkErr;
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
    const res = await fetchWithTimeout(`${API_URL}/api/content/${section}`);
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
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/content/${section}`, {
    method: 'PUT', headers: authHeaders(true), body: JSON.stringify(data),
  }));
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to save');
  }
};

export const uploadImage = async (file: File): Promise<string> => {
  const form = new FormData();
  form.append('image', file);
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Images can be up to 20MB — give uploads more headroom than the default timeout.
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/upload/image`, {
    method: 'POST',
    headers,
    body: form,
  }, 30_000));
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Upload failed');
  }
  const json = await res.json();
  // Backend returns a relative path; prepend API_URL so the image always loads
  // from the same origin as the API (localhost in dev, Railway in production).
  return `${API_URL}${json.path}`;
};

// ── Legacy settings API ────────────────────────────────────────────────────────
export const getSettings = async (): Promise<HeroSettings> => {
  const res = await fetchWithTimeout(`${API_URL}/api/settings`);
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
};

export const saveSettings = async (data: HeroSettings): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/settings`, {
    method: 'PUT', headers: authHeaders(true), body: JSON.stringify(data),
  }));
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to save settings');
  }
};

// ── Subscribers ────────────────────────────────────────────────────────────────
export const subscribe = async (email: string): Promise<void> => {
  const res = await fetchWithTimeout(`${API_URL}/api/subscribers`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw { code: res.status === 409 ? '23505' : 'unknown', message: err.error };
  }
};

export const getSubscribers = async (): Promise<Subscriber[]> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/subscribers`, {
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
    const res = await fetchWithTimeout(`${API_URL}/api/shop/categories`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
};

export const saveShopCategory = async (cat: Partial<ShopCategory> & { id?: string }): Promise<ShopCategory> => {
  const method = cat.id ? 'PUT' : 'POST';
  const url = cat.id ? `${API_URL}/api/shop/categories/${cat.id}` : `${API_URL}/api/shop/categories`;
  const res = await checkStatus(await fetchWithTimeout(url, { method, headers: authHeaders(true), body: JSON.stringify(cat) }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as {error?:string}).error || 'Failed'); }
  return res.json();
};

export const deleteShopCategory = async (id: string): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/shop/categories/${id}`, { method: 'DELETE', headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to delete category');
};

export const saveShopCandle = async (candle: Partial<ShopCandle> & { id?: string }): Promise<ShopCandle> => {
  const method = candle.id ? 'PUT' : 'POST';
  const url = candle.id ? `${API_URL}/api/shop/candles/${candle.id}` : `${API_URL}/api/shop/candles`;
  const res = await checkStatus(await fetchWithTimeout(url, { method, headers: authHeaders(true), body: JSON.stringify(candle) }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as {error?:string}).error || 'Failed'); }
  return res.json();
};

export const deleteShopCandle = async (id: string): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/shop/candles/${id}`, { method: 'DELETE', headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to delete candle');
};

export interface AppUserRecord {
  id: string;
  email: string;
  full_name: string;
  provider: string;
  avatar_url: string;
  created_at: string;
}

export interface FeedbackRecord {
  id: string;
  name: string;
  email: string;
  rating: number;
  message: string;
  photo_url: string;
  created_at: string;
}

export const getAdminUsers = async (): Promise<AppUserRecord[]> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/users`, { headers: authHeaders(true) }));
  return res.json();
};

export const submitFeedback = async (data: { name: string; email: string; rating: number; message: string; photo_url: string }): Promise<void> => {
  await fetchWithTimeout(`${API_URL}/api/feedback`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
};

export const getAdminFeedback = async (): Promise<FeedbackRecord[]> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/feedback`, { headers: authHeaders(true) }));
  return res.json();
};

export const deleteAdminFeedback = async (id: string): Promise<void> => {
  await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/feedback/${id}`, { method: 'DELETE', headers: authHeaders(true) }));
};

export const deleteSubscriber = async (id: string): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/subscribers/${id}`, { method: 'DELETE', headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to delete subscriber');
};

// ── Orders (admin) ────────────────────────────────────────────────────────────

// Present on both orders and returns — the most recent customer-visible thing
// they were told, so the admin can see it in the list without opening details.
export interface LastNotificationFields {
  last_notification_type: string | null;
  last_notification_title: string | null;
  last_notification_at: string | null;
}

export interface AdminOrderRecord extends LastNotificationFields {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  items: Array<{ product_id: string; product_data: Record<string, unknown>; quantity: number }>;
  subtotal: string;
  shipping: string;
  total: string;
  tracking_number: string;
  shipping_address: Record<string, unknown>;
  fulfillment_type: 'delivery' | 'pickup';
  discount_percent: string;
  discount_amount: string;
  status: string;
  payment_status: string;
  tracking: { stages: string[]; stage_index: number; delivered: boolean; cancelled: boolean };
  cancellation_status: 'none' | 'requested' | 'approved' | 'rejected';
  cancellation_reason: string;
  cancellation_requested_at: string | null;
  refund_status: 'not_applicable' | 'pending' | 'refunded';
  created_at: string;
}

export interface OrderTimelineEvent {
  id: string;
  type: string;
  actor: 'system' | 'admin' | 'customer';
  title: string;
  detail: string;
  meta: Record<string, unknown>;
  customer_visible: boolean;
  created_at: string;
}

export interface RefundReminder {
  id: string;
  order_id: string;
  source: 'return' | 'cancellation';
  source_id: string;
  eligible_at: string;
  resolved_at: string | null;
  reminders_sent: number[];
}

export const getAdminOrders = async (): Promise<AdminOrderRecord[]> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/orders`, { headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to load orders');
  return res.json();
};

// Mirrors DELIVERY_STAGES / PICKUP_STAGES in backend/index.js — the admin-settable
// tracking statuses, keyed by fulfillment type.
export const ORDER_STAGES: Record<'delivery' | 'pickup', string[]> = {
  delivery: ['Order Placed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered'],
  pickup: ['Order Placed', 'Preparing Order', 'Ready for Pickup', 'Picked Up'],
};

export const updateOrderStatus = async (id: string, status: string): Promise<AdminOrderRecord> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/orders/${id}`, {
    method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
  }));
  if (!res.ok) throw new Error('Failed to update order status');
  return res.json();
};

export const getAdminOrderDetail = async (id: string): Promise<AdminOrderRecord & { timeline: OrderTimelineEvent[]; refund_reminders: RefundReminder[] }> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/orders/${id}`, { headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to load order');
  return res.json();
};

export const decideCancellation = async (id: string, decision: 'approved' | 'rejected', note = ''): Promise<AdminOrderRecord> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/orders/${id}/cancellation`, {
    method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ decision, note }),
  }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'Failed to record decision'); }
  return res.json();
};

export const markRefundDone = async (id: string): Promise<{ via_stripe: boolean }> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/orders/${id}/refund-status`, {
    method: 'PUT', headers: authHeaders(true),
  }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'Failed to mark refund done'); }
  return res.json();
};

export const sendOrderMessage = async (id: string, subject: string, body: string): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/orders/${id}/message`, {
    method: 'POST', headers: authHeaders(true), body: JSON.stringify({ subject, body }),
  }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'Failed to send message'); }
};

// ── Ops overview & automation settings ──────────────────────────────────────────

export interface AutomationSettings {
  refund_reminder_days: number[];
  refund_reminder_enabled: boolean;
  stuck_order_days: number;
  low_stock_threshold: number;
  decision_engine_enabled: boolean;
  auto_approvable_return_reasons: string[];
  return_window_days: number;
  fraud_review_threshold: number;
  stuck_order_followup_enabled: boolean;
  refund_automation_enabled: boolean;
  back_in_stock_notify_enabled: boolean;
  underperforming_bundle_days: number;
}

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
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

export interface OpsOverview {
  settings: AutomationSettings;
  stuck_orders: Array<{ id: string; tracking_number: string; status: string; created_at: string; user_email: string; user_name: string }>;
  pending_cancellations: Array<{ id: string; tracking_number: string; cancellation_requested_at: string; cancellation_reason: string; user_email: string; user_name: string }>;
  pending_returns_count: number;
  refunds_due: Array<{ id: string; order_id: string; source: 'return' | 'cancellation'; source_id: string; tracking_number: string; total: string; user_email: string; user_name: string; days_elapsed: number }>;
  low_stock_products: Array<{ id: string; name: string; stock: number }>;
  subscriber_stats: { total: number; new_7d: number; new_30d: number };
  underperforming_bundles: Array<{ id: string; name: string }>;
}

export const getOpsOverview = async (): Promise<OpsOverview> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/ops-overview`, { headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to load ops overview');
  return res.json();
};

export const getAutomationSettings = (): Promise<AutomationSettings> =>
  getContent('automationSettings', DEFAULT_AUTOMATION_SETTINGS);

export const saveAutomationSettings = (data: AutomationSettings): Promise<void> =>
  saveContent('automationSettings', data);

// ── Decisions (admin) — the approval queue for the automated suggestion engine ──

export interface AdminDecision {
  id: string;
  type: 'return_approve_suggested' | 'return_reject_suggested' | 'fraud_review' | 'stuck_order_followup' | 'back_in_stock_notify';
  order_id: string | null;
  return_id: string | null;
  product_id: string | null;
  reasoning: string;
  suggested_action: Record<string, unknown>;
  status: 'pending' | 'approved' | 'dismissed';
  created_at: string;
  tracking_number: string | null;
  return_product_name: string | null;
}

export const getAdminDecisions = async (): Promise<AdminDecision[]> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/decisions`, { headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to load decisions');
  return res.json();
};

export const approveDecision = async (id: string): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/decisions/${id}/approve`, {
    method: 'POST', headers: authHeaders(true),
  }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'Failed to approve decision'); }
};

export const dismissDecision = async (id: string): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/decisions/${id}/dismiss`, {
    method: 'POST', headers: authHeaders(true),
  }));
  if (!res.ok) throw new Error('Failed to dismiss decision');
};

// History of what was already approved/dismissed — so a resolved decision
// doesn't just silently vanish with no record of it having happened.
export const getResolvedDecisions = async (): Promise<(AdminDecision & { resolved_at: string })[]> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/decisions/resolved`, { headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to load decision history');
  return res.json();
};

// ── Returns (admin) ─────────────────────────────────────────────────────────────

export interface AdminReturnRecord extends LastNotificationFields {
  id: string;
  order_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  product_id: string;
  product_name: string;
  reason: string;
  status: 'requested' | 'approved' | 'rejected' | 'refunded';
  created_at: string;
}

export const getAdminReturns = async (): Promise<AdminReturnRecord[]> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/returns`, { headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to load returns');
  return res.json();
};

export const updateReturnStatus = async (id: string, status: AdminReturnRecord['status']): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/returns/${id}`, {
    method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
  }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'Failed to update return status'); }
};
