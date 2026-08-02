/**
 * The Olive Goose — session management regression suite
 *
 * The storefront used to run on bare JWTs: the cookie WAS the session. That is
 * fine right up to the day a customer needs to end one. "Sign out" only deleted
 * the cookie in the browser doing the asking — a copy lifted off a shared laptop
 * stayed valid for its full 30 days, a password change did nothing to whoever was
 * already inside the account, and nobody could see where they were signed in.
 *
 * Sessions are now rows in user_sessions that the cookie merely names, and every
 * test here is one of the promises that only becomes true because of it:
 *
 *   1. sign-out kills the session server-side, not just locally;
 *   2. changing your password boots every OTHER device and keeps yours;
 *   3. resetting your password boots everything, including the intruder;
 *   4. the customer can list their devices and cut any one of them off;
 *   5. one shopper can never see or revoke another's session;
 *   6. "remember me" off is a genuinely shorter session, not just a cookie flag.
 *
 * Runs against the ISOLATED test stack, where emails are in dev mode so the OTP
 * comes back inline.
 */

import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:3001";

const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };

const freshEmail = (tag: string) =>
  `e2e-session-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;

interface SessionRow {
  id: string;
  current: boolean;
  device: string;
  ip: string;
  last_seen_at: string;
  expires_at: string;
}

/** A signed-in browser context for a brand-new verified account. */
async function newShopper(tag: string, password = "E2eSession123") {
  const email = freshEmail(tag);
  const ctx = await pwRequest.newContext({ baseURL: API });
  const start = await ctx.post(`/api/user/register/start`, {
    data: { email, password, full_name: "E2E Session Tester" },
  });
  expect(start.ok(), `register/start must succeed: ${await start.text()}`).toBeTruthy();
  const { dev_otp: otp } = await start.json();
  const verify = await ctx.post(`/api/user/register/verify`, { data: { email, otp } });
  expect(verify.ok(), `verify must succeed: ${await verify.text()}`).toBeTruthy();
  return { email, password, ctx };
}

/** A second signed-in device for an existing account — a different browser. */
async function signInAgain(email: string, password: string, userAgent?: string) {
  const ctx = await pwRequest.newContext({
    baseURL: API,
    ...(userAgent ? { extraHTTPHeaders: { "User-Agent": userAgent } } : {}),
  });
  const res = await ctx.post(`/api/user/login`, { data: { email, password } });
  expect(res.ok(), `login must succeed: ${await res.text()}`).toBeTruthy();
  return ctx;
}

const listSessions = async (ctx: APIRequestContext): Promise<SessionRow[]> => {
  const res = await ctx.get(`/api/user/sessions`);
  expect(res.ok(), `sessions must be listable: ${await res.text()}`).toBeTruthy();
  return res.json();
};

const isSignedIn = async (ctx: APIRequestContext) => (await ctx.get(`/api/user/me`)).ok();

// ─── 1. Sign-out ends the session on the server ──────────────────────────────

test.describe("Sign-out", () => {
  test("a copy of the cookie is dead after sign-out", async () => {
    // The whole point of server-side sessions. `stolen` holds the exact same
    // cookie; under the old JWT-only scheme it kept working for 30 more days.
    const { ctx } = await newShopper("stolen");
    const cookies = await ctx.storageState().then(s => s.cookies);
    const stolen = await pwRequest.newContext({ baseURL: API, storageState: { cookies, origins: [] } });
    expect(await isSignedIn(stolen), "the copied cookie starts out valid").toBeTruthy();

    expect((await ctx.post(`/api/user/logout`)).ok()).toBeTruthy();

    expect(await isSignedIn(stolen), "signing out must invalidate the session itself").toBeFalsy();
    await stolen.dispose();
    await ctx.dispose();
  });

  test("signing out works even when the session has already gone", async () => {
    // Sign-out must never 401 — a customer clicking it twice, or after their
    // session lapsed, should still land signed out rather than on an error.
    const { ctx } = await newShopper("double-out");
    expect((await ctx.post(`/api/user/logout`)).ok()).toBeTruthy();
    expect((await ctx.post(`/api/user/logout`)).ok(), "a second sign-out must still succeed").toBeTruthy();
    await ctx.dispose();
  });
});

// ─── 2. Password change boots the other devices ──────────────────────────────

test.describe("Password change", () => {
  test("ends every other session and keeps the one asking", async () => {
    const { email, password, ctx } = await newShopper("pwchange");
    const other = await signInAgain(email, password);
    expect(await isSignedIn(other)).toBeTruthy();

    const change = await ctx.put(`/api/user/me/password`, {
      data: { current_password: password, new_password: "E2eSession456" },
    });
    expect(change.ok(), `password change must succeed: ${await change.text()}`).toBeTruthy();
    expect((await change.json()).signed_out_sessions, "the customer is told what was signed out").toBe(1);

    expect(await isSignedIn(other), "the other device must be signed out immediately").toBeFalsy();
    expect(await isSignedIn(ctx), "the device that changed the password stays signed in").toBeTruthy();

    await other.dispose();
    await ctx.dispose();
  });

  test("a rejected password change signs nothing out", async () => {
    const { email, password, ctx } = await newShopper("pwwrong");
    const other = await signInAgain(email, password);

    const change = await ctx.put(`/api/user/me/password`, {
      data: { current_password: "NotThePassword1", new_password: "E2eSession456" },
    });
    expect(change.ok()).toBeFalsy();
    expect(await isSignedIn(other), "a failed attempt must not disturb other devices").toBeTruthy();

    await other.dispose();
    await ctx.dispose();
  });
});

// ─── 3. Password reset boots everything ──────────────────────────────────────

test("a password reset ends every existing session, including the intruder's", async () => {
  // This is the "someone else is in my account" lever: the person resetting has
  // no access to the intruder's device, so the reset itself has to end it.
  const { email, password, ctx } = await newShopper("reset");
  const intruder = await signInAgain(email, password);
  expect(await isSignedIn(intruder)).toBeTruthy();

  const fresh = await pwRequest.newContext({ baseURL: API });
  const forgot = await fresh.post(`/api/user/password/forgot`, { data: { email } });
  expect(forgot.ok()).toBeTruthy();
  const { dev_otp: otp } = await forgot.json();
  const reset = await fresh.post(`/api/user/password/reset`, {
    data: { email, otp, new_password: "E2eSession789" },
  });
  expect(reset.ok(), `reset must succeed: ${await reset.text()}`).toBeTruthy();

  expect(await isSignedIn(intruder), "the intruder's session must be gone").toBeFalsy();
  expect(await isSignedIn(ctx), "the customer's own older session goes too").toBeFalsy();
  expect(await isSignedIn(fresh), "the reset signs the customer in on this device").toBeTruthy();

  await Promise.all([intruder.dispose(), fresh.dispose(), ctx.dispose()]);
});

// ─── 4. The signed-in devices list ───────────────────────────────────────────

test.describe("Signed-in devices", () => {
  test("lists each device once, flags the current one, and never leaks a token", async () => {
    const { email, password, ctx } = await newShopper("list");
    const other = await signInAgain(email, password,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");

    const rows = await listSessions(ctx);
    expect(rows.length, "both devices must appear").toBe(2);
    expect(rows.filter(r => r.current).length, "exactly one row is 'this device'").toBe(1);
    expect(rows.some(r => r.device.includes("iPhone")), "the UA must be readable as a device").toBeTruthy();

    // The row must carry nothing that could stand in for the session cookie.
    const serialised = JSON.stringify(rows);
    expect(serialised, "no session token may appear in the list").not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);

    await other.dispose();
    await ctx.dispose();
  });

  test("revoking one device signs out exactly that device", async () => {
    const { email, password, ctx } = await newShopper("revoke-one");
    const other = await signInAgain(email, password);
    const third = await signInAgain(email, password);

    const rows = await listSessions(ctx);
    const target = rows.find(r => !r.current)!;
    const del = await ctx.delete(`/api/user/sessions/${target.id}`);
    expect(del.ok(), `revoke must succeed: ${await del.text()}`).toBeTruthy();

    // One of the two other devices is out; this one is untouched; the list shrank.
    const stillIn = [await isSignedIn(other), await isSignedIn(third)];
    expect(stillIn.filter(Boolean).length, "exactly one other device was signed out").toBe(1);
    expect(await isSignedIn(ctx), "the device doing the revoking stays signed in").toBeTruthy();
    expect((await listSessions(ctx)).length).toBe(2);

    // Revoking the same row twice is not a silent success — it would tell the
    // customer they'd just cut off a device that was already gone.
    expect((await ctx.delete(`/api/user/sessions/${target.id}`)).status()).toBe(404);

    await Promise.all([other.dispose(), third.dispose(), ctx.dispose()]);
  });

  test("'sign out everywhere else' leaves exactly this device", async () => {
    const { email, password, ctx } = await newShopper("revoke-others");
    const a = await signInAgain(email, password);
    const b = await signInAgain(email, password);

    const res = await ctx.post(`/api/user/sessions/revoke-others`);
    expect(res.ok(), `revoke-others must succeed: ${await res.text()}`).toBeTruthy();
    expect((await res.json()).revoked).toBe(2);

    expect(await isSignedIn(a)).toBeFalsy();
    expect(await isSignedIn(b)).toBeFalsy();
    expect(await isSignedIn(ctx), "you must not sign yourself out doing this").toBeTruthy();
    expect((await listSessions(ctx)).length).toBe(1);

    await Promise.all([a.dispose(), b.dispose(), ctx.dispose()]);
  });

  test("revoking your own current session is just signing out", async () => {
    const { ctx } = await newShopper("revoke-self");
    const [me] = await listSessions(ctx);
    const del = await ctx.delete(`/api/user/sessions/${me.id}`);
    expect(del.ok()).toBeTruthy();
    expect((await del.json()).current, "the client is told to clear its local auth state").toBe(true);
    expect(await isSignedIn(ctx)).toBeFalsy();
    await ctx.dispose();
  });
});

// ─── 5. One shopper can never touch another's session ────────────────────────

test.describe("Isolation between accounts", () => {
  test("the list only ever contains your own devices", async () => {
    const alice = await newShopper("alice");
    const bob = await newShopper("bob");

    const aliceRows = await listSessions(alice.ctx);
    const bobRows = await listSessions(bob.ctx);
    const bobIds = new Set(bobRows.map(r => r.id));
    expect(aliceRows.some(r => bobIds.has(r.id)), "no session may appear in both lists").toBeFalsy();

    await Promise.all([alice.ctx.dispose(), bob.ctx.dispose()]);
  });

  test("you cannot revoke someone else's session even with its id", async () => {
    const alice = await newShopper("alice-revoke");
    const bob = await newShopper("bob-revoke");
    const [bobSession] = await listSessions(bob.ctx);

    const attempt = await alice.ctx.delete(`/api/user/sessions/${bobSession.id}`);
    expect(attempt.ok(), "revoking across accounts must fail").toBeFalsy();
    expect(await isSignedIn(bob.ctx), "Bob must still be signed in").toBeTruthy();

    await Promise.all([alice.ctx.dispose(), bob.ctx.dispose()]);
  });

  test("a session listing requires a session", async () => {
    const anon = await pwRequest.newContext({ baseURL: API });
    expect((await anon.get(`/api/user/sessions`)).status()).toBe(401);
    expect((await anon.post(`/api/user/sessions/revoke-others`)).status()).toBe(401);
    await anon.dispose();
  });
});

// ─── 6. "Remember me" is a real difference, not just a cookie flag ───────────

test("'remember me' off is a genuinely shorter session", async () => {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const short = await ctx.post(`/api/user/login`, { data: { ...SHOPPER, remember: false } });
  expect(short.ok()).toBeTruthy();

  // This shared account is signed in from other specs too, so pick the row this
  // login actually created rather than whichever sorted first.
  const row = (await listSessions(ctx)).find(r => r.current)!;
  const hoursLeft = (new Date(row.expires_at).getTime() - Date.now()) / 3_600_000;
  expect(hoursLeft, "an un-remembered session must expire within the day").toBeLessThanOrEqual(13);
  expect(hoursLeft, "…but must not be so short it dies during a shop").toBeGreaterThan(1);

  // And the remembered variant is measured in days, not hours.
  const long = await pwRequest.newContext({ baseURL: API });
  await long.post(`/api/user/login`, { data: { ...SHOPPER, remember: true } });
  const remembered = (await listSessions(long)).find(r => r.current)!;
  const daysLeft = (new Date(remembered.expires_at).getTime() - Date.now()) / 86_400_000;
  expect(daysLeft).toBeGreaterThan(20);

  await Promise.all([ctx.dispose(), long.dispose()]);
});
