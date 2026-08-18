import { fetchWithTimeout, RequestTimeoutError } from './fetchTimeout';
import { API_URL } from './apiBase';
import { readContent, readContentFresh, writeContent } from './contentStore';

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
    throw new Error(`Cannot reach the backend at ${API_URL || location.origin}/api — check the /api proxy in public/_redirects (prod) or that the API is running on :3001 (dev)`);
  }
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try { const body = await res.json(); errMsg = body.error || errMsg; } catch { /* retain HTTP fallback */ }
    throw new Error(errMsg);
  }
  const { token } = await res.json();
  localStorage.setItem('admin_token', token);
};

export const logout = (): void => {
  localStorage.removeItem('admin_token');
};

// Always resolves with a generic message, whether or not the email is a
// registered admin — the backend intentionally doesn't reveal which.
export const requestAdminPasswordReset = async (email: string): Promise<{ message: string }> => {
  const res = await fetchWithTimeout(`${API_URL}/api/auth/admin/password/forgot`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email }),
  });
  return res.json();
};

export const confirmAdminPasswordReset = async (token: string, newPassword: string): Promise<void> => {
  const res = await fetchWithTimeout(`${API_URL}/api/auth/admin/password/reset`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ token, newPassword }),
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try { const body = await res.json(); errMsg = body.error || errMsg; } catch { /* retain HTTP fallback */ }
    throw new Error(errMsg);
  }
};

// Change the signed-in admin's own password. The server bumps token_version,
// which invalidates the token this call was made with — so it hands back a fresh
// one that we swap in immediately, otherwise the very next request would 401 and
// bounce the admin to the login screen straight after a successful change.
export const changeAdminPassword = async (
  currentPassword: string,
  newPassword: string,
): Promise<string> => {
  const res = await fetchWithTimeout(`${API_URL}/api/auth/admin/password`, {
    method: 'PUT',
    headers: authHeaders(true),
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  const { token, message } = body as { token: string; message: string };
  localStorage.setItem('admin_token', token);
  return message;
};

export const isLoggedIn = (): boolean => !!getToken();

// ── Generic content API ────────────────────────────────────────────────────────
// All site sections stored under /api/content/:section, read through the session
// cache in lib/contentStore so a section is fetched once per visit rather than
// once per component mount. Falls back to `fallback` when the backend is
// unavailable.

export const getContent = <T>(section: string, fallback: T): Promise<T> =>
  readContent(section, fallback);

// Cache-bypassing read for the admin dashboard: the editor must always load what
// is actually stored, never a value the storefront cached earlier in the session.
export const getContentFresh = <T>(section: string, fallback: T): Promise<T> =>
  readContentFresh(section, fallback);

export const saveContent = async <T>(section: string, data: T): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/content/${section}`, {
    method: 'PUT', headers: authHeaders(true), body: JSON.stringify(data),
  }));
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to save');
  }
  // Keep the cache honest about what the server now holds — otherwise the rest of
  // this session would keep serving the pre-save value.
  writeContent(section, data);
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

// Same shape as uploadImage, but videos run to 200MB, so the timeout gets
// headroom to match — a phone clip over hotel wifi is minutes, not seconds.
export const uploadVideo = async (file: File): Promise<string> => {
  const form = new FormData();
  form.append('video', file);
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/upload/video`, {
    method: 'POST',
    headers,
    body: form,
  }, 300_000));
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Upload failed');
  }
  const json = await res.json();
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

// Returned when the signup-popup discount is enabled and a code is available.
// `code` is always present so the signup card can show it even if the welcome
// email failed to send; `email_delivered` says whether the email actually went.
export interface SubscribeDiscount {
  discount_percent: number;
  email_delivered: boolean;
  // No `code`. The welcome code is deliberately never sent to the browser — it is
  // delivered by email only, so claiming the offer requires owning the mailbox.
}

export interface SubscribeResult {
  discount: SubscribeDiscount | null;
  // True when the email was already on the list but still had an unused code we
  // handed back (vs. a brand-new signup).
  alreadySubscribed: boolean;
}

// Thrown when the email is already subscribed and there's no code left to give
// (already redeemed, or the offer is off). `alreadyUsed` distinguishes the two
// so the card can say "you've used your welcome offer" vs. a generic message.
export class AlreadySubscribedError extends Error {
  code = '23505';
  alreadyUsed: boolean;
  constructor(alreadyUsed: boolean) {
    super('already_subscribed');
    this.name = 'AlreadySubscribedError';
    this.alreadyUsed = alreadyUsed;
  }
}

export const subscribe = async (email: string): Promise<SubscribeResult> => {
  const res = await fetchWithTimeout(`${API_URL}/api/subscribers`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) throw new AlreadySubscribedError(!!(err as { already_used?: boolean }).already_used);
    throw { code: 'unknown', message: (err as { error?: string }).error };
  }
  const body = await res.json().catch(() => ({})) as { discount?: SubscribeDiscount; already_subscribed?: boolean };
  return { discount: body.discount ?? null, alreadySubscribed: !!body.already_subscribed };
};

export interface DiscountCodeRecord {
  id: string;
  code: string;
  email: string | null;
  discount_percent: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: string;
  max_redemptions: number;
  redemption_count: number;
  is_active: boolean;
  one_per_customer: boolean;
  label: string | null;
  source: string;
  redeemed_at: string | null;
  order_id: string | null;
  created_at: string;
}

export const getAdminDiscountCodes = async (): Promise<{ codes: DiscountCodeRecord[]; stats: { issued: number; redeemed: number } }> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/discount-codes`, { headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to load discount codes');
  return res.json();
};

export interface CreateDiscountCodeInput {
  code?: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  max_redemptions?: number;
  // Defaults to true server-side: max uses then counts customers, not orders.
  one_per_customer?: boolean;
  label?: string;
}

// Mint a custom promo code. Throws with the server's message (e.g. duplicate
// code, bad value) so the admin UI can surface it inline.
export const createDiscountCode = async (input: CreateDiscountCodeInput): Promise<DiscountCodeRecord> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/discount-codes`, {
    method: 'POST', headers: authHeaders(true), body: JSON.stringify(input),
  }));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Failed to create discount code');
  return body as DiscountCodeRecord;
};

export const setDiscountCodeActive = async (id: string, isActive: boolean): Promise<DiscountCodeRecord> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/discount-codes/${id}`, {
    method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ is_active: isActive }),
  }));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Failed to update discount code');
  return body as DiscountCodeRecord;
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

// Shared for the whole visit, like the content sections: the navbar dropdown,
// the scrapbook, the new-arrivals strip, the shop grid and the product page all
// want the same list, and they were each fetching it separately on every page.
let shopCategoriesRequest: Promise<ShopCategory[]> | null = null;

export const getShopCategories = (options?: { fresh?: boolean }): Promise<ShopCategory[]> => {
  // The admin edits categories, so it must never read a list cached earlier.
  if (options?.fresh) shopCategoriesRequest = null;

  shopCategoriesRequest ??= fetchWithTimeout(`${API_URL}/api/shop/categories`)
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => [] as ShopCategory[]);

  return shopCategoriesRequest;
};

/** Drops the cached category list — after an admin save, and in tests. */
export const invalidateShopCategories = (): void => { shopCategoriesRequest = null; };

export const saveShopCategory = async (cat: Partial<ShopCategory> & { id?: string }): Promise<ShopCategory> => {
  const method = cat.id ? 'PUT' : 'POST';
  const url = cat.id ? `${API_URL}/api/shop/categories/${cat.id}` : `${API_URL}/api/shop/categories`;
  const res = await checkStatus(await fetchWithTimeout(url, { method, headers: authHeaders(true), body: JSON.stringify(cat) }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as {error?:string}).error || 'Failed'); }
  invalidateShopCategories();
  return res.json();
};

export const deleteShopCategory = async (id: string): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/shop/categories/${id}`, { method: 'DELETE', headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to delete category');
  invalidateShopCategories();
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
  published: boolean;
  created_at: string;
}

export const getAdminUsers = async (): Promise<AppUserRecord[]> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/users`, { headers: authHeaders(true) }));
  return res.json();
};

export const submitFeedback = async (data: {
  name: string; email: string; rating: number; message: string; photo_url: string; website?: string;
}): Promise<void> => {
  // This used to ignore the response entirely, so a rejected review (rate limit,
  // validation, server error) still showed the shopper a "Thank you!" and the
  // feedback was simply lost. Surface the server's own message instead.
  const res = await fetchWithTimeout(`${API_URL}/api/feedback`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Could not send your feedback. Please try again.');
  }
};

// Public counterpart of uploadImage — the review form is used by shoppers, who
// have no admin token and were silently 401ing against the admin uploader.
export const uploadFeedbackPhoto = async (file: File): Promise<string> => {
  const form = new FormData();
  form.append('image', file);
  const res = await fetchWithTimeout(`${API_URL}/api/feedback/photo`, { method: 'POST', body: form }, 30_000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Upload failed');
  }
  // Returns the bare `/uploads/…` path, not an absolute URL: that is what the
  // server accepts back on submit (it only stores paths it issued itself).
  const json = await res.json();
  return String(json.path ?? '');
};

// Stored photo values are relative paths for review photos but full URLs for
// older admin-uploaded ones — resolve either to something an <img> can load.
export const resolveUploadUrl = (value: string): string =>
  !value ? '' : /^https?:\/\//i.test(value) ? value : `${API_URL}${value}`;

export const setFeedbackPublished = async (id: string, published: boolean): Promise<FeedbackRecord> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/feedback/${id}`, {
    method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ published }),
  }));
  return res.json();
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
  stripe_payment_intent_id: string | null;
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

// Only for orders settled outside Stripe (no payment intent) — e.g. a pickup
// order paid in store. The backend rejects Stripe-managed orders.
export const updateOrderPaymentStatus = async (id: string, payment_status: 'paid' | 'unpaid'): Promise<AdminOrderRecord> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/orders/${id}/payment-status`, {
    method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ payment_status }),
  }));
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'Failed to update payment status'); }
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
  type: 'return_approve_suggested' | 'return_reject_suggested' | 'fraud_review' | 'stuck_order_followup' | 'back_in_stock_notify' | 'oversell_alert';
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

// ── Analytics (admin) ───────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  // The window that was actually measured — NOT necessarily the one requested
  // (a range longer than two years is shortened). The panel prints these, so a
  // shortened window can never be read as a fall in trade.
  start: string; // YYYY-MM-DD, inclusive
  end: string;   // YYYY-MM-DD, inclusive
  days: number;
  /** True when the requested range was longer than the 2-year cap and was cut. */
  clamped?: boolean;
  timezone: string; // IANA zone every day boundary was resolved in
  filters: { device: string | null; source: string | null; attr: 'source' | 'medium' | 'campaign' };
  // True when device/source filters are active — sales then cover only the
  // orders whose purchase could be tied back to a matching session.
  attributed: boolean;
  abandoned: { checkout_sessions: number; abandoned_sessions: number; lost_revenue: number };
  // The storefront's single sign-in gate ("Proceed to Checkout"). null when no
  // session in the window went through it — a window predating the event must
  // show nothing rather than a row of confident zeroes.
  signin_wall: {
    gate_sessions: number;      // pressed the button at all
    walled_sessions: number;    // …as a guest, so a sign-in was demanded
    walled_continued: number;   // …and still reached the checkout page
    walled_purchased: number;
    passed_sessions: number;    // pressed it already signed in (the control group)
    passed_purchased: number;
    blocked_basket_value: number; // in the baskets that never got past the gate
  } | null;
  // Dates inside this window on which a metric's definition changed. Comparing
  // across one of these reads an instrumentation change as shopper behaviour.
  measurement_notes: Array<{ date: string; note: string }>;
  traffic: {
    visitors: number; sessions: number; pageviews: number;
    pages_per_session: number; bounce_rate: number;
    new_visitors: number; returning_visitors: number;
    // % of visitors whose id survives the tab. The rest count as "new" on every
    // visit. Not about the cookie answer — first-party measurement doesn't
    // depend on it — but about browsers that refuse storage outright.
    // null when there were no visitors.
    identified_visitor_pct: number | null;
    prev: { visitors: number; sessions: number; pageviews: number };
  };
  sales: {
    revenue: number; orders: number; aov: number; conversion_rate: number;
    // Orders in the window that carry a tracked session. Below `orders` means
    // the funnel, conversion rate and attribution table under-count real sales.
    attributed_orders: number;
    prev: { revenue: number; orders: number; aov: number };
  };
  customers: {
    total_customers: number; lifetime_repeat_customers: number;
    new_customers: number; returning_customers: number;
    avg_lifetime_value: number; avg_orders_per_customer: number;
  };
  funnel: Array<{ stage: string; sessions: number }>;
  daily: Array<{ day: string; visitors: number; sessions: number; pageviews: number; orders: number; revenue: number }>;
  // view_to_cart_pct / cart_to_buy_pct are null when the stage below them had no
  // traffic — "unknown", which must not be rendered as 0%.
  top_products: Array<{
    name: string; units: number; revenue: number; add_to_carts: number;
    views: number; view_to_cart_pct: number | null; cart_to_buy_pct: number | null;
  }>;
  top_pages: Array<{ path: string; views: number; sessions: number }>;
  sources: Array<{ source: string; sessions: number; orders: number; revenue: number }>;
  devices: Array<{ device: string; sessions: number }>;
  /**
   * Roughly where visitors were, resolved once per session from its landing
   * event. `city` is "Unknown" when we never learned it; `country` is an ISO
   * two-letter code, or '' alongside an unknown city.
   */
  locations: Array<{ city: string; country: string; sessions: number; orders: number; revenue: number }>;
  web_vitals: Array<{ metric: string; p75: number; samples: number }>;
  /** The same metrics per page, so a bad site-wide score can be traced to a page. */
  web_vitals_by_page: Array<{ path: string; metric: string; p75: number; samples: number }>;
}

export interface AnalyticsQuery {
  start: string;
  end: string;
  device?: string;  // mobile | tablet | desktop
  source?: string;  // a traffic-source name as shown in the sources table
  attr?: 'source' | 'medium' | 'campaign';
}

// Fetch analytics for an explicit calendar window (both dates inclusive) — the
// backend compares it against the equally-sized period immediately before it.
//
// Given its own generous timeout: this one request runs fifteen aggregates over
// the whole event history, and a year-long window on a cold Railway instance
// takes far longer than an ordinary API call. On the shared 10s budget those
// windows aborted, and an aborted load left the panel showing the PREVIOUS
// period's numbers under the newly-picked dates — the failure mode that reads,
// from the outside, as "the date picker does nothing".
const ANALYTICS_TIMEOUT_MS = 60_000;

export const getAdminAnalytics = async (q: AnalyticsQuery): Promise<AnalyticsOverview> => {
  const params = new URLSearchParams({ start: q.start, end: q.end });
  if (q.device) params.set('device', q.device);
  if (q.source) params.set('source', q.source);
  if (q.attr) params.set('attr', q.attr);
  const res = await checkStatus(await fetchWithTimeout(
    `${API_URL}/api/admin/analytics?${params}`,
    { headers: authHeaders(true) },
    ANALYTICS_TIMEOUT_MS,
  ));
  if (!res.ok) {
    // Surface the server's own reason (an invalid range is a 400 with a message)
    // rather than a blanket failure the reader can't act on.
    let msg = 'Failed to load analytics';
    try { const body = await res.json(); if (body?.error) msg = body.error; } catch { /* keep the default */ }
    throw new Error(msg);
  }
  return res.json();
};

export interface AnalyticsLive {
  active_sessions: number;
  active_visitors: number;
  top_pages: Array<{ path: string; sessions: number }>;
}

export const getAdminAnalyticsLive = async (): Promise<AnalyticsLive> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/analytics/live`, { headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to load live analytics');
  return res.json();
};

// ── Internal traffic (admin) ────────────────────────────────────────────────────
// Which browsing is the shop's own rather than a customer's, and which hostnames
// have been sending events — the two things that decide whether "Visitors" is a
// count of people or a count of browser storage.
export interface AnalyticsInternal {
  emails: string[];
  networks: string[];
  /** The address this admin request came from — offered so the owner can exclude it. */
  current_ip: string;
  current_ip_excluded: boolean;
  excluded_visitors: Array<{ visitor_id: string; reason: string; created_at: string }>;
  counted_origins: string[];
  origins_seen: Array<{ origin: string; visitors: number; events: number }>;
}

export const getAnalyticsInternal = async (): Promise<AnalyticsInternal> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/analytics/internal`, { headers: authHeaders(true) }));
  if (!res.ok) throw new Error('Failed to load internal-traffic settings');
  return res.json();
};

// Send only the list being changed — the backend keeps the other one as it is, so
// the two controls can't wipe each other.
export const saveAnalyticsInternal = async (
  patch: { emails?: string[]; networks?: string[]; visitor_id?: string }
): Promise<{ emails: string[]; networks: string[] }> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/analytics/internal`, {
    method: 'PUT',
    headers: { ...authHeaders(true), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }));
  if (!res.ok) throw new Error('Failed to save');
  return res.json();
};

export const setAnalyticsInternalBrowser = async (visitorId: string, enabled: boolean): Promise<void> => {
  const res = await checkStatus(await fetchWithTimeout(`${API_URL}/api/admin/analytics/internal/browser`, {
    method: 'POST',
    headers: { ...authHeaders(true), 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitor_id: visitorId, enabled }),
  }));
  if (!res.ok) throw new Error('Failed to update this browser');
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
