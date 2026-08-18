/**
 * The Olive Goose — Sign-up / sign-in regression suite
 *
 * Sign-in and sign-up worked locally and broke on production. The reason that
 * class of bug survives a normal e2e run is that the local stack is SAME-SITE
 * (frontend and backend both on localhost) while production is CROSS-SITE — the
 * Netlify frontend calls the Railway backend on a different registrable domain.
 * A session cookie without `SameSite=None; Secure` is simply dropped by the
 * browser there: the login request returns 200, and the shopper stays logged out.
 *
 * Nothing about that is visible in a same-site test, so this suite asserts the
 * cookie ATTRIBUTES the backend emits, and forces the production code path by
 * sending `X-Forwarded-Proto: https` (the app runs behind `trust proxy`, so that
 * is exactly what Railway's proxy does — `req.secure` becomes true).
 *
 * It also covers the full account lifecycle the storefront depends on: signup →
 * emailed OTP → verified account → sign in → session persistence → sign out,
 * plus the edge cases that decide whether a real customer gets in or gives up
 * (wrong code, expired code, duplicate email, casing/whitespace, enumeration).
 *
 * Runs against the ISOLATED test stack (backend :3002, frontend :8081), where
 * emails are in dev mode so `register/start` returns `dev_otp` inline.
 */

import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:3001";
const BASE = process.env.E2E_BASE ?? "http://localhost:8080";

const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };

const freshEmail = (tag: string) =>
  `e2e-auth-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;

/** All Set-Cookie headers on a response, as raw strings. */
function setCookies(res: { headersArray: () => Array<{ name: string; value: string }> }): string[] {
  return res.headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
}

const sessionCookie = (res: Parameters<typeof setCookies>[0]) =>
  setCookies(res).find((c) => c.startsWith("og_session=")) ?? "";

/** The og_oauth_state nonce cookie, if the response set one. */
const oauthStateCookie = (res: Parameters<typeof setCookies>[0]) =>
  setCookies(res).find((c) => c.startsWith("og_oauth_state=")) ?? "";

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await pwRequest.newContext({ baseURL: API });
});
test.afterAll(async () => { await api?.dispose(); });

// ─── 1. The production cookie contract ───────────────────────────────────────
//
// The rule used to be "HTTPS ⇒ SameSite=None+Secure", because the shop
// (theolivegoose.ie) called the API on its own Railway origin and a Lax cookie
// is not attached to cross-site XHR — that mismatch is what broke the live
// launch. That is no longer the architecture: Netlify proxies /api/* through to
// the backend (public/_redirects) and the bundle pins a same-origin API base
// (src/lib/apiBase.ts), so every request carrying this cookie is same-site.
//
// Once same-origin, None is not merely redundant but weaker: the browser keeps
// attaching the cookie to cross-site requests, leaving the Origin/Referer check
// as the only thing between evil.com and a cookie-authed POST. So the contract
// is now Lax on every deploy, Secure whenever the connection is HTTPS.
// SESSION_COOKIE_SAMESITE=none restores the old behaviour if the API is ever
// moved back onto its own site.

test.describe("Session cookie attributes", () => {
  test("behind an HTTPS proxy the session cookie is SameSite=Lax; Secure", async () => {
    // `trust proxy` is on, so this is byte-for-byte what Railway's proxy sends.
    const res = await api.post(`/api/user/login`, {
      headers: { "X-Forwarded-Proto": "https" },
      data: SHOPPER,
    });
    expect(res.ok(), "login must succeed").toBeTruthy();

    const cookie = sessionCookie(res);
    expect(cookie, "login must set the og_session cookie").toBeTruthy();
    expect(cookie, "production is same-origin (Netlify proxies /api), so the cookie must not ride cross-site requests")
      .toMatch(/SameSite=Lax/i);
    expect(cookie, "an HTTPS session cookie must be Secure").toMatch(/;\s*Secure/i);
    expect(cookie, "the session cookie must stay out of reach of JS").toMatch(/HttpOnly/i);
  });

  test("over plain http the cookie stays Lax (browsers reject None without Secure)", async () => {
    const res = await api.post(`/api/user/login`, { data: SHOPPER });
    expect(res.ok()).toBeTruthy();

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie, "a Secure cookie would never be stored over http://localhost")
      .not.toMatch(/;\s*Secure/i);
  });

  test("sign-out clears the cookie with matching attributes", async () => {
    // A clear whose attributes don't match the original leaves the cookie in
    // place — the shopper clicks "sign out" and stays signed in.
    const ctx = await pwRequest.newContext({ baseURL: API });
    await ctx.post(`/api/user/login`, { headers: { "X-Forwarded-Proto": "https" }, data: SHOPPER });

    const out = await ctx.post(`/api/user/logout`, { headers: { "X-Forwarded-Proto": "https" } });
    expect(out.ok()).toBeTruthy();
    const cleared = sessionCookie(out);
    expect(cleared, "the clear must carry the same SameSite/Secure pair").toMatch(/SameSite=Lax/i);
    expect(cleared).toMatch(/;\s*Secure/i);

    await ctx.dispose();
  });

  test("'remember me' off issues a browser-session cookie (no Max-Age)", async () => {
    const remembered = await api.post(`/api/user/login`, { data: { ...SHOPPER, remember: true } });
    expect(sessionCookie(remembered), "remembered logins must persist across restarts")
      .toMatch(/Max-Age=\d+/i);

    const notRemembered = await api.post(`/api/user/login`, { data: { ...SHOPPER, remember: false } });
    expect(sessionCookie(notRemembered), "without remember-me the cookie must die with the browser")
      .not.toMatch(/Max-Age=/i);
  });

  test("the session cookie is not readable from JavaScript", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.post(`${API}/api/user/login`, { data: SHOPPER });
    expect(res.ok()).toBeTruthy();
    const visible = await page.evaluate(() => document.cookie);
    expect(visible, "og_session must be HttpOnly").not.toContain("og_session");
  });
});

// ─── 2. Signup, all the way through ──────────────────────────────────────────

test.describe("Signup lifecycle", () => {
  test("signup → OTP → verified account → signed in → can sign in again", async () => {
    const ctx = await pwRequest.newContext({ baseURL: API });
    const email = freshEmail("full");
    const password = "E2eBrandNew123";

    const start = await ctx.post(`/api/user/register/start`, {
      data: { email, password, full_name: "E2E New Customer" },
    });
    expect(start.ok(), `register/start must succeed: ${await start.text()}`).toBeTruthy();
    const { dev_otp: otp } = await start.json();
    expect(otp, "dev mode must return the OTP so the flow stays testable").toBeTruthy();

    const verify = await ctx.post(`/api/user/register/verify`, { data: { email, otp } });
    expect(verify.ok(), `verify must succeed: ${await verify.text()}`).toBeTruthy();

    // Verification signs the new customer straight in.
    const me = await ctx.get(`/api/user/me`);
    expect(me.ok(), "verifying must establish a session").toBeTruthy();
    expect((await me.json()).email).toBe(email);

    // And the credentials work on a fresh context afterwards.
    const second = await pwRequest.newContext({ baseURL: API });
    const login = await second.post(`/api/user/login`, { data: { email, password } });
    expect(login.ok(), "the new account must be able to sign in normally").toBeTruthy();
    await second.dispose();
    await ctx.dispose();
  });

  test("a wrong code never creates the account", async () => {
    const ctx = await pwRequest.newContext({ baseURL: API });
    const email = freshEmail("wrongotp");

    const start = await ctx.post(`/api/user/register/start`, {
      data: { email, password: "E2eBrandNew123", full_name: "Wrong Code" },
    });
    const { dev_otp: real } = await start.json();
    const wrong = String((Number(real) + 1) % 1_000_000).padStart(6, "0");

    const verify = await ctx.post(`/api/user/register/verify`, { data: { email, otp: wrong } });
    expect(verify.ok(), "a wrong code must not verify").toBeFalsy();

    // No session, and the account must not exist yet.
    expect((await ctx.get(`/api/user/me`)).status()).toBe(401);
    const login = await ctx.post(`/api/user/login`, { data: { email, password: "E2eBrandNew123" } });
    expect(login.ok(), "an unverified signup must not be a usable account").toBeFalsy();
    await ctx.dispose();
  });

  test("the correct code still works after a wrong attempt", async () => {
    const ctx = await pwRequest.newContext({ baseURL: API });
    const email = freshEmail("retry");

    const { dev_otp: otp } = await (await ctx.post(`/api/user/register/start`, {
      data: { email, password: "E2eBrandNew123", full_name: "Retry" },
    })).json();

    await ctx.post(`/api/user/register/verify`, { data: { email, otp: "000000" } });
    const good = await ctx.post(`/api/user/register/verify`, { data: { email, otp } });
    expect(good.ok(), "one typo must not lock a real customer out").toBeTruthy();
    await ctx.dispose();
  });

  test("signing up with an address that already has an account is refused", async () => {
    const res = await api.post(`/api/user/register/start`, {
      data: { email: SHOPPER.email, password: "E2eBrandNew123", full_name: "Dupe" },
    });
    // Either a clean rejection, or a silent no-op that still never mints a
    // second account — what must never happen is a 500.
    expect(res.status(), "duplicate signup must be handled, not crash").toBeLessThan(500);
    if (!res.ok()) expect((await res.json()).error).toBeTruthy();
  });

  test("email casing and stray whitespace resolve to one account", async () => {
    const res = await api.post(`/api/user/login`, {
      data: { email: `  ${SHOPPER.email.toUpperCase()}  `, password: SHOPPER.password },
    });
    expect(res.ok(), "a customer typing Their@Email.com must still get in").toBeTruthy();
  });

  test("a missing or malformed email is rejected cleanly", async () => {
    for (const email of ["", "not-an-email", "@nodomain.com", "spaces in@email.com"]) {
      const res = await api.post(`/api/user/register/start`, { data: { email, password: "E2eBrandNew123" } });
      expect(res.status(), `"${email}" must be a clean 4xx, never a 500`).toBeGreaterThanOrEqual(400);
      expect(res.status()).toBeLessThan(500);
    }
  });
});

// ─── 3. Sign in ──────────────────────────────────────────────────────────────

test.describe("Sign in", () => {
  test("valid credentials establish a working session", async () => {
    const ctx = await pwRequest.newContext({ baseURL: API });
    const login = await ctx.post(`/api/user/login`, { data: SHOPPER });
    expect(login.ok()).toBeTruthy();

    const me = await ctx.get(`/api/user/me`);
    expect(me.ok()).toBeTruthy();
    expect((await me.json()).email).toBe(SHOPPER.email);

    // The session survives subsequent requests (sliding expiry must not drop it).
    expect((await ctx.get(`/api/user/me`)).ok()).toBeTruthy();
    expect((await ctx.get(`/api/cart`)).ok()).toBeTruthy();
    await ctx.dispose();
  });

  test("a wrong password is refused and leaves no session", async () => {
    const ctx = await pwRequest.newContext({ baseURL: API });
    const login = await ctx.post(`/api/user/login`, { data: { ...SHOPPER, password: "definitely-wrong" } });
    expect(login.status()).toBe(401);
    expect((await ctx.get(`/api/user/me`)).status()).toBe(401);
    await ctx.dispose();
  });

  test("an unknown address gets the same answer as a wrong password", async () => {
    // Different messages here would tell an attacker which emails have accounts.
    const unknown = await api.post(`/api/user/login`, {
      data: { email: freshEmail("ghost"), password: "definitely-wrong" },
    });
    const wrongPw = await api.post(`/api/user/login`, { data: { ...SHOPPER, password: "definitely-wrong" } });

    expect(unknown.status()).toBe(wrongPw.status());
    expect((await unknown.json()).error).toBe((await wrongPw.json()).error);
  });

  test("a password must actually be supplied", async () => {
    for (const data of [{ email: SHOPPER.email }, { email: SHOPPER.email, password: "" }, {}]) {
      const res = await api.post(`/api/user/login`, { data });
      expect(res.ok(), `credentials ${JSON.stringify(data)} must not sign anyone in`).toBeFalsy();
      expect(res.status()).toBeLessThan(500);
    }
  });

  test("signing out really ends the session", async () => {
    const ctx = await pwRequest.newContext({ baseURL: API });
    await ctx.post(`/api/user/login`, { data: SHOPPER });
    expect((await ctx.get(`/api/user/me`)).ok()).toBeTruthy();

    await ctx.post(`/api/user/logout`);
    expect((await ctx.get(`/api/user/me`)).status(), "signed out must mean signed out").toBe(401);
    await ctx.dispose();
  });
});

// ─── 4. Forged sessions ──────────────────────────────────────────────────────

test.describe("Session integrity", () => {
  test("a forged or tampered session cookie is rejected", async () => {
    const forged = [
      "og_session=not-a-jwt",
      "og_session=eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiIxIn0.",
      "og_session=" + "a".repeat(200),
    ];
    for (const cookie of forged) {
      const res = await api.get(`/api/user/me`, { headers: { Cookie: cookie } });
      expect(res.status(), `"${cookie.slice(0, 30)}…" must not authenticate`).toBe(401);
    }
  });

  test("a customer session cannot reach the admin API", async () => {
    const ctx = await pwRequest.newContext({ baseURL: API });
    await ctx.post(`/api/user/login`, { data: SHOPPER });
    const res = await ctx.get(`/api/admin/users`);
    expect(res.status(), "a shopper cookie must never be admin").toBe(401);
    await ctx.dispose();
  });
});

// ─── 5. Google sign-in entry point ───────────────────────────────────────────

test.describe("Social sign-in", () => {
  test("the providers endpoint reports what the storefront should offer", async () => {
    const res = await api.get(`/api/auth/providers`);
    expect(res.ok()).toBeTruthy();
    // Shape only — which providers are enabled is a deployment decision.
    expect(typeof (await res.json())).toBe("object");
  });

  test("the Google entry point redirects to Google with CSRF state", async () => {
    const providers = await (await api.get(`/api/auth/providers`)).json();
    test.skip(!providers?.google, "Google OAuth not configured on this stack");

    const res = await api.get(`/api/auth/google`, { maxRedirects: 0 });
    expect([302, 303, 307]).toContain(res.status());
    const location = res.headers()["location"] ?? "";
    expect(location).toContain("accounts.google.com");
    expect(location, "the state nonce guards against login CSRF").toMatch(/[?&]state=/);
    expect(oauthStateCookie(res), "the state nonce must be stored to compare on callback").toBeTruthy();
  });

  test("a callback without matching state is refused", async () => {
    const providers = await (await api.get(`/api/auth/providers`)).json();
    test.skip(!providers?.google, "Google OAuth not configured on this stack");

    // No state cookie in this context → the comparison must fail closed.
    const res = await api.get(`/api/auth/google/callback?code=fake&state=forged`, { maxRedirects: 0 });
    expect(res.status(), "a forged callback must never mint a session").not.toBe(200);
    expect(setCookies(res).some((c) => c.startsWith("og_session=") && !c.includes("og_session=;")))
      .toBeFalsy();
  });
});
