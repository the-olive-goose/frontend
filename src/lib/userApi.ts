import { fetchWithTimeout } from './fetchTimeout';
import { API_URL } from './apiBase';

// The session lives in an httpOnly cookie set by the backend — never touched by
// page JS. Every request just needs `credentials: 'include'` so the browser
// attaches/accepts it; there's no client-side token to manage.
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CREDENTIALS: RequestCredentials = 'include';

// Thrown when a request comes back 401 — the session cookie is missing/expired.
// Also fires a window event so AuthContext can react in one place (clear user,
// prompt sign-in) regardless of which call site triggered it.
export class SessionExpiredError extends Error {
  constructor() { super('Your session has expired — please sign in again.'); this.name = 'SessionExpiredError'; }
}

const checkAuth = (res: Response): Response => {
  if (res.status === 401) {
    window.dispatchEvent(new Event('og:session-expired'));
    throw new SessionExpiredError();
  }
  return res;
};

export interface AppUser {
  id: string;
  email?: string;
  phone?: string;
  full_name?: string;
  avatar_url?: string;
  provider: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

// Contact details only. The address columns on AppUser mirror the default
// address book entry and are maintained server-side, so they are edited through
// the address endpoints (createAddress/updateAddress/setDefaultAddress) — PUT
// /api/user/me rejects them rather than taking an unvalidated write.
export interface ProfileUpdate {
  full_name?: string;
  phone?: string;
}

// Step 1 of signup: validate + email a verification code. Returns dev_otp only
// when the backend has no email provider configured (dev mode).
export const registerStart = async (email: string, password: string, full_name: string) => {
  const res = await fetchWithTimeout(`${API_URL}/api/user/register/start`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password, full_name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not start sign up');
  return data as { success: true; dev_otp?: string };
};

// Step 2 of signup: confirm the code, create the verified account, and sign in.
export const registerVerify = async (email: string, otp: string) => {
  const res = await fetchWithTimeout(`${API_URL}/api/user/register/verify`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ email, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Verification failed');
  return data as { user: AppUser };
};

export const userLogin = async (email: string, password: string, remember = true) => {
  const res = await fetchWithTimeout(`${API_URL}/api/user/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ email, password, remember }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data as { user: AppUser };
};

// Resolves the session against the server. `null` means the server actively said
// "not signed in" (401) — the only answer that should log someone out of the UI.
// A dropped connection or a 500 THROWS instead of resolving null: those say
// nothing about whether the session is valid, and treating them as "signed out"
// is how a shopper on a flaky train connection loses their basket page.
// Deliberately not routed through checkAuth — this call is the session check
// itself, so a 401 here is an answer, not a global "session expired" event.
export const userMe = async (): Promise<AppUser | null> => {
  const res = await fetchWithTimeout(`${API_URL}/api/user/me`, { credentials: CREDENTIALS });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Could not reach your account');
  return await res.json();
};

export const logoutUser = async (): Promise<void> => {
  try {
    await fetchWithTimeout(`${API_URL}/api/user/logout`, { method: 'POST', credentials: CREDENTIALS });
  } catch {
    // best-effort — local state is cleared regardless by the caller
  }
};

export const sendOtp = async (phone: string): Promise<{ dev_otp?: string }> => {
  const res = await fetchWithTimeout(`${API_URL}/api/auth/phone/send-otp`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
  return data;
};

export const verifyOtp = async (phone: string, otp: string) => {
  const res = await fetchWithTimeout(`${API_URL}/api/auth/phone/verify-otp`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ phone, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'OTP verification failed');
  return data as { user: AppUser };
};

export const googleOAuthUrl  = () => `${API_URL}/api/auth/google`;
export const facebookOAuthUrl = () => `${API_URL}/api/auth/facebook`;

// Lets the UI hide social-login buttons that would otherwise hard-navigate to
// a raw error page when the provider's credentials aren't configured.
export const getAuthProviders = async (): Promise<{ google: boolean; facebook: boolean }> => {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/auth/providers`);
    if (!res.ok) return { google: false, facebook: false };
    return await res.json();
  } catch {
    return { google: false, facebook: false };
  }
};

// ── Password reset ──────────────────────────────────────────────────────────────

export const forgotPassword = async (email: string): Promise<{ dev_otp?: string }> => {
  const res = await fetchWithTimeout(`${API_URL}/api/user/password/forgot`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not send reset code');
  return data;
};

export const resetPassword = async (email: string, otp: string, newPassword: string) => {
  const res = await fetchWithTimeout(`${API_URL}/api/user/password/reset`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ email, otp, new_password: newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not reset password');
  return data as { user: AppUser };
};

export const updateProfile = async (update: ProfileUpdate): Promise<AppUser> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/user/me`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify(update),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not update profile');
  return data;
};

// ── Address book ────────────────────────────────────────────────────────────────

// A saved delivery address. Shares the shipping fields with DeliveryAddress, plus
// its id and whether it's the account's default. The users-row single address is
// kept mirrored to whichever entry is the default (see backend syncDefaultAddressToUser).
export interface SavedAddress {
  id: string;
  full_name: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  created_at: string;
}

// Fields the client sends when creating/editing an address. make_default asks the
// backend to promote it to the default (the first address a user saves always is).
export type AddressInput = DeliveryAddress & { make_default?: boolean };

export const fetchAddresses = async (): Promise<SavedAddress[]> => {
  const res = await fetchWithTimeout(`${API_URL}/api/user/addresses`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  return res.json();
};

export const createAddress = async (input: AddressInput): Promise<SavedAddress> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/user/addresses`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify(input),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save address');
  return data;
};

export const updateAddress = async (id: string, input: AddressInput): Promise<SavedAddress> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/user/addresses/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify(input),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not update address');
  return data;
};

export const setDefaultAddress = async (id: string): Promise<void> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/user/addresses/${id}/default`, {
    method: 'POST',
    credentials: CREDENTIALS,
  }));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not set default address');
  }
};

export const deleteAddress = async (id: string): Promise<void> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/user/addresses/${id}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
  }));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not delete address');
  }
};

export const changePassword = async (currentPassword: string, newPassword: string) => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/user/me/password`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not change password');
  // How many other devices this password change signed out — worth telling the
  // customer, since that's the whole point of changing it.
  return data as { signed_out_sessions?: number };
};

// ── Signed-in devices ─────────────────────────────────────────────────────────

// One signed-in device. `id` is the session row id, not a credential — the actual
// session token lives in an httpOnly cookie and never reaches page JS.
export interface UserSession {
  id: string;
  current: boolean;
  device: string;
  ip: string;
  remember: boolean;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export const fetchSessions = async (): Promise<UserSession[]> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/user/sessions`, { credentials: CREDENTIALS }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load your signed-in devices');
  return data;
};

// Signing out a device. Returns whether the revoked session was this browser's —
// the caller has to drop local auth state in that case.
export const revokeSession = async (id: string): Promise<{ current: boolean }> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/user/sessions/${id}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not sign that device out');
  return data;
};

export const revokeOtherSessions = async (): Promise<{ revoked: number }> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/user/sessions/revoke-others`, {
    method: 'POST',
    credentials: CREDENTIALS,
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not sign the other devices out');
  return data;
};

// ── Cart ──────────────────────────────────────────────────────────────────────

export interface CartRow {
  id: string;
  product_id: string;
  product_data: Record<string, unknown>;
  quantity: number;
}

export const fetchCart = async (): Promise<CartRow[]> => {
  const res = await fetchWithTimeout(`${API_URL}/api/cart`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  return res.json();
};

export const apiAddToCart = async (productId: string, productData: unknown, quantity = 1) => {
  checkAuth(await fetchWithTimeout(`${API_URL}/api/cart/items`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ product_id: productId, product_data: productData, quantity }),
  }));
};

export const apiUpdateCartItem = async (productId: string, quantity: number) => {
  checkAuth(await fetchWithTimeout(`${API_URL}/api/cart/items/${productId}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ quantity }),
  }));
};

export const apiRemoveCartItem = async (productId: string) => {
  checkAuth(await fetchWithTimeout(`${API_URL}/api/cart/items/${productId}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
  }));
};

export const apiClearCart = async () => {
  checkAuth(await fetchWithTimeout(`${API_URL}/api/cart`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
  }));
};

// ── Orders ────────────────────────────────────────────────────────────────────

export interface OrderItem {
  product_id: string;
  product_data: Record<string, unknown>;
  quantity: number;
}

export type FulfillmentType = 'delivery' | 'pickup';

export interface OrderTimelineEvent {
  id: string;
  type: string;
  title: string;
  detail: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface Order {
  id: string;
  user_id: string;
  items: OrderItem[];
  subtotal: string;
  shipping: string;
  total: string;
  tracking_number: string;
  shipping_address: Record<string, unknown>;
  created_at: string;
  status: string;
  fulfillment_type: FulfillmentType;
  discount_percent: string;
  discount_amount: string;
  payment_status: string;
  tracking: {
    stages: string[];
    stage_index: number;
    delivered: boolean;
    cancelled: boolean;
  };
  cancellation_status: 'none' | 'requested' | 'approved' | 'rejected';
  cancellation_eligible: boolean;
  refund_status: 'not_applicable' | 'pending' | 'refunded';
  timeline?: OrderTimelineEvent[];
}

export interface DeliveryAddress {
  full_name?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface CheckoutInput {
  fulfillment_type: FulfillmentType;
  shipping_address?: DeliveryAddress;
  contact_phone?: string;
  // A welcome/subscriber discount code the shopper applied, if any. Re-validated
  // and held server-side before checkout starts — never trusted from here.
  discount_code?: string;
  // Analytics visitor/session ids — lets the backend attribute the eventual
  // purchase event to the browsing session that started this checkout.
  analytics?: { visitor_id: string; session_id: string };
}

export interface DiscountValidation {
  valid: boolean;
  message?: string;
  code?: string;
  discount_type?: 'percentage' | 'fixed';
  discount_value?: number;
  // Legacy: still sent for percentage codes; prefer discount_type/value.
  discount_percent?: number;
}

// Read-only pre-checkout check so the summary can show the discount before the
// shopper commits. The binding hold + authoritative re-check happen server-side
// when the Stripe session is created.
export const validateDiscountCode = async (code: string): Promise<DiscountValidation> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/discount/validate`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ code }),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not validate code');
  return data;
};

export interface MyDiscountCode {
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
}

// The signed-in shopper's own unspent welcome code, so checkout can offer it
// instead of relying on them still having the email it was sent in. Returns null
// when there's nothing to offer — including on any error, because a failed
// lookup of a *bonus* is not something to interrupt a checkout with.
export const fetchMyDiscountCode = async (): Promise<MyDiscountCode | null> => {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/discount/mine`, { credentials: CREDENTIALS });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.code ? data as MyDiscountCode : null;
  } catch {
    return null;
  }
};

// Starts a Stripe Checkout session for the current basket and returns the hosted
// payment page URL to redirect the browser to. No order is created yet — that
// only happens once Stripe confirms the charge (see getCheckoutSession).
export const createCheckoutSession = async (input: CheckoutInput): Promise<{ url: string }> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/checkout/session`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify(input),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not start checkout');
  return data;
};

// Polled by the post-payment success page. Returns the finalized order once
// Stripe confirms payment, or { pending: true } while still waiting (e.g. the
// webhook hasn't landed yet).
export const getCheckoutSession = async (sessionId: string): Promise<Order | { pending: true }> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/checkout/session/${sessionId}`, {
    credentials: CREDENTIALS,
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not check payment status');
  return data;
};

export const fetchOrders = async (): Promise<Order[]> => {
  const res = await fetchWithTimeout(`${API_URL}/api/orders`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  return res.json();
};

export const fetchOrder = async (id: string): Promise<Order | null> => {
  const res = await fetchWithTimeout(`${API_URL}/api/orders/${id}`, { credentials: CREDENTIALS });
  if (!res.ok) return null;
  return res.json();
};

// Files a cancellation request for admin review — doesn't cancel the order
// immediately, see OrderTrackingPage for the resulting pending-review state.
export const requestOrderCancellation = async (id: string, reason: string): Promise<Order> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/orders/${id}/cancel`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ reason }),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not request cancellation');
  return data;
};

// ── Returns ───────────────────────────────────────────────────────────────────

export interface ReturnRequest {
  id: string;
  order_id: string;
  user_id: string;
  product_id: string;
  product_name: string;
  reason: string;
  status: 'requested' | 'approved' | 'rejected' | 'refunded';
  created_at: string;
}

export const submitReturn = async (orderId: string, productId: string, reason: string): Promise<ReturnRequest> => {
  const res = checkAuth(await fetchWithTimeout(`${API_URL}/api/returns`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: CREDENTIALS,
    body: JSON.stringify({ order_id: orderId, product_id: productId, reason }),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not submit return request');
  return data;
};

export const fetchReturns = async (): Promise<ReturnRequest[]> => {
  const res = await fetchWithTimeout(`${API_URL}/api/returns`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  return res.json();
};
