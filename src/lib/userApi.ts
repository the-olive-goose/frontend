// Same-origin in production (Railway serves SPA + API together); separate port in dev.
const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');
const TOKEN_KEY = 'og_user_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const authHeaders = () => ({
  'Content-Type': 'application/json',
  ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
});

export interface AppUser {
  id: string;
  email?: string;
  phone?: string;
  full_name?: string;
  avatar_url?: string;
  provider: string;
}

// Step 1 of signup: validate + email a verification code. Returns dev_otp only
// when the backend has no email provider configured (dev mode).
export const registerStart = async (email: string, password: string, full_name: string) => {
  const res = await fetch(`${API_URL}/api/user/register/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, full_name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not start sign up');
  return data as { success: true; dev_otp?: string };
};

// Step 2 of signup: confirm the code and create the verified account.
export const registerVerify = async (email: string, otp: string) => {
  const res = await fetch(`${API_URL}/api/user/register/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Verification failed');
  return data as { token: string; user: AppUser };
};

export const userLogin = async (email: string, password: string) => {
  const res = await fetch(`${API_URL}/api/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data as { token: string; user: AppUser };
};

export const userMe = async (): Promise<AppUser | null> => {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}/api/user/me`, { headers: authHeaders() });
    if (!res.ok) { clearToken(); return null; }
    return await res.json();
  } catch {
    return null;
  }
};

export const sendOtp = async (phone: string): Promise<{ dev_otp?: string }> => {
  const res = await fetch(`${API_URL}/api/auth/phone/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
  return data;
};

export const verifyOtp = async (phone: string, otp: string) => {
  const res = await fetch(`${API_URL}/api/auth/phone/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'OTP verification failed');
  return data as { token: string; user: AppUser };
};

export const googleOAuthUrl  = () => `${API_URL}/api/auth/google`;
export const facebookOAuthUrl = () => `${API_URL}/api/auth/facebook`;

// ── Cart ──────────────────────────────────────────────────────────────────────

export interface CartRow {
  id: string;
  product_id: string;
  product_data: Record<string, unknown>;
  quantity: number;
}

export const fetchCart = async (): Promise<CartRow[]> => {
  const token = getToken();
  if (!token) return [];
  const res = await fetch(`${API_URL}/api/cart`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
};

export const apiAddToCart = async (productId: string, productData: unknown, quantity = 1) => {
  await fetch(`${API_URL}/api/cart/items`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ product_id: productId, product_data: productData, quantity }),
  });
};

export const apiUpdateCartItem = async (productId: string, quantity: number) => {
  await fetch(`${API_URL}/api/cart/items/${productId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ quantity }),
  });
};

export const apiRemoveCartItem = async (productId: string) => {
  await fetch(`${API_URL}/api/cart/items/${productId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
};

export const apiClearCart = async () => {
  await fetch(`${API_URL}/api/cart`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
};
