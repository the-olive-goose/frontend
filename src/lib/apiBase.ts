// Where every API call goes. Single source of truth — api.ts, userApi.ts and
// analytics.ts all import this, so the storefront can never end up split across
// two origins because one of them drifted.
//
// PRODUCTION IS ALWAYS SAME-ORIGIN. Netlify serves the SPA and proxies /api/* (and
// /uploads/*) through to the Railway backend — see public/_redirects — so a request
// leaves the browser as https://theolivegoose.ie/api/... and the backend is never
// contacted directly.
//
// That is load-bearing, not a style choice. The customer session is an httpOnly
// cookie, and a cookie is only reliably stored and re-sent when it is first-party.
// Pointing the bundle straight at the backend's *.up.railway.app origin makes the
// session cookie third-party: Safari's ITP drops it outright, and Chrome does the
// same in incognito / with tracking protection on. The failure is nasty because
// login still *looks* fine — POST /api/user/login returns 200 with the user, so the
// UI flips to signed-in — but the Set-Cookie was discarded, so the very next
// authenticated call (add-to-cart) 401s and the global 401 handler bounces the
// shopper straight back to the sign-in modal, again and again.
//
// VITE_API_URL therefore only applies in dev, where the Vite server (:8080) and the
// API (:3001) genuinely are different origins with no proxy in front. It is ignored
// in a production build on purpose: a stray build-time env var in the Netlify (or
// Vercel) dashboard must not be able to reintroduce the cross-site split.
export const API_URL: string = import.meta.env.DEV
  ? (import.meta.env.VITE_API_URL ?? "http://localhost:3001")
  : "";
