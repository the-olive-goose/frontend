const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Token helpers ──────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('admin_token');

const authHeaders = (includeAuth = false): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(includeAuth && getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
});

// ── Types ──────────────────────────────────────────────────────────────────────
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
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Login failed');
  }
  const { token } = await res.json();
  localStorage.setItem('admin_token', token);
};

export const logout = (): void => {
  localStorage.removeItem('admin_token');
};

export const isLoggedIn = (): boolean => !!getToken();

// ── Settings ───────────────────────────────────────────────────────────────────
export const getSettings = async (): Promise<HeroSettings> => {
  const res = await fetch(`${API_URL}/api/settings`);
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
};

export const saveSettings = async (data: HeroSettings): Promise<void> => {
  const res = await fetch(`${API_URL}/api/settings`, {
    method: 'PUT',
    headers: authHeaders(true),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to save settings');
  }
};

// ── Subscribers ────────────────────────────────────────────────────────────────
export const subscribe = async (email: string): Promise<void> => {
  const res = await fetch(`${API_URL}/api/subscribers`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw { code: res.status === 409 ? '23505' : 'unknown', message: err.error };
  }
};

export const getSubscribers = async (): Promise<Subscriber[]> => {
  const res = await fetch(`${API_URL}/api/subscribers`, {
    headers: authHeaders(true),
  });
  if (!res.ok) throw new Error('Unauthorized');
  return res.json();
};

export const deleteSubscriber = async (id: string): Promise<void> => {
  const res = await fetch(`${API_URL}/api/subscribers/${id}`, {
    method: 'DELETE',
    headers: authHeaders(true),
  });
  if (!res.ok) throw new Error('Failed to delete subscriber');
};
