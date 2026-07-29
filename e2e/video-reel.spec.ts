/**
 * The Olive Goose — Studio Reel Suite
 *
 * The video rail fails silently. `toEmbedUrl` has a catch-all fallback that
 * treats anything it doesn't recognise as a direct file src, so an unsupported
 * URL doesn't throw, doesn't log, and doesn't 404 — the card just renders the
 * "Add a video URL in admin" placeholder. Nothing in the suite looked at the
 * rendered rail, so this shipped and sat live on the home page:
 *
 *   video_url: "https://youtube.com/shorts/--Q_WkPaXBY?si=JtZcqcmQ5AO_F7hs"
 *
 * A YouTube Shorts link — the obvious thing to paste for a 9:16 reel — which
 * `toEmbedUrl` didn't handle. Two of the four studio reels were blank frames in
 * production. The unit suite passed the whole time because it asserted on a
 * hand-written list of URL shapes copied out of the admin field's placeholder
 * text, never on a URL a person had actually saved.
 *
 * So this suite drives real URLs through the admin API and asserts on what the
 * home page RENDERS: a playing iframe or a <video>, never the placeholder. The
 * point is the assertion direction — the rail is asked to prove it plays, and
 * an unrecognised shape fails loudly here instead of quietly in front of a
 * customer.
 *
 * Only the src is asserted, not that YouTube/Vimeo actually loads: the frame's
 * src is what this codebase controls, and reaching a third party would make the
 * suite fail on a bad network rather than on a bug.
 */
import { test, expect, APIRequestContext, request as pwRequest, Page } from "@playwright/test";

const API  = process.env.E2E_API  ?? "http://localhost:3001";
const BASE = process.env.E2E_BASE ?? "http://localhost:8080";
const ADMIN = {
  email:    process.env.E2E_ADMIN_EMAIL    ?? "e2e-admin@test.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin123!",
};
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const PLACEHOLDER = /Add a video URL in admin/i;

let admin: APIRequestContext;
let TOKEN: string;
let originalVideos: Record<string, unknown> = {};

test.beforeAll(async () => {
  admin = await pwRequest.newContext({ baseURL: API, extraHTTPHeaders: { Origin: BASE } });
  const login = await admin.post("/api/auth/login", { data: ADMIN });
  expect(login.ok(), "admin login should succeed — run seed-fixtures.mjs").toBeTruthy();
  TOKEN = (await login.json()).token;
  originalVideos = await (await admin.get("/api/content/videos")).json();
});

test.afterAll(async () => {
  // The rail is customer-facing; never leave test URLs behind on it.
  if (Object.keys(originalVideos).length) {
    await admin.put("/api/content/videos", { headers: auth(TOKEN), data: originalVideos });
  }
  await admin.dispose();
});

/** Put exactly one reel on the rail, so index 0 is unambiguous. */
async function setReel(video_url: string) {
  const res = await admin.put("/api/content/videos", {
    headers: auth(TOKEN),
    data: { ...originalVideos, items: [{ id: "e2e-reel", title: "E2E reel", description: "", tag: "", video_url }] },
  });
  expect(res.ok(), "saving videos content must succeed").toBeTruthy();
}

async function openRail(page: Page) {
  await page.goto(`${BASE}/`);
  const rail = page.locator("#journal");
  await expect(rail).toBeVisible();
  return rail.locator(".og-reel-card").first();
}

/** Every shape a person can plausibly paste, and what the rail must do with it. */
const PLAYABLE: Array<{ name: string; url: string; media: "iframe" | "video"; src: string | RegExp }> = [
  {
    // The exact shape that was live and blank. Keep it first: it is the bug.
    name: "YouTube Shorts link with a ?si= share token",
    url: "https://youtube.com/shorts/--Q_WkPaXBY?si=JtZcqcmQ5AO_F7hs",
    media: "iframe",
    src: /^https:\/\/www\.youtube\.com\/embed\/--Q_WkPaXBY\?/,
  },
  {
    name: "YouTube watch link",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    media: "iframe",
    src: /^https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ\?/,
  },
  {
    // A phone's share sheet puts other params ahead of v=.
    name: "YouTube mobile watch link with v= after another param",
    url: "https://m.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ",
    media: "iframe",
    src: /^https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ\?/,
  },
  {
    name: "youtu.be short link with a ?si= share token",
    url: "https://youtu.be/dQw4w9WgXcQ?si=JtZcqcmQ5AO_F7hs",
    media: "iframe",
    src: /^https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ\?/,
  },
  {
    name: "Vimeo link",
    url: "https://vimeo.com/76979871",
    media: "iframe",
    src: /^https:\/\/player\.vimeo\.com\/video\/76979871/,
  },
  {
    name: "Cloudinary delivery URL carrying a file extension",
    url: "https://res.cloudinary.com/demo/video/upload/v1/dog.mp4",
    media: "video",
    src: "https://res.cloudinary.com/demo/video/upload/v1/dog.mp4",
  },
  {
    // Cloudinary's own UI hands you an extension-less URL when the format is
    // negotiated by the delivery chain (f_auto). It is still a video.
    name: "Cloudinary delivery URL with no file extension",
    url: "https://res.cloudinary.com/demo/video/upload/f_auto,q_auto/v1/dog",
    media: "video",
    src: "https://res.cloudinary.com/demo/video/upload/f_auto,q_auto/v1/dog.mp4",
  },
  {
    name: "an uploaded file served from this site",
    url: "/videos/V2.mp4",
    media: "video",
    src: /\/videos\/V2\.mp4$/,
  },
];

for (const shape of PLAYABLE) {
  test(`rail plays ${shape.name}`, async ({ page }) => {
    await setReel(shape.url);
    const card = await openRail(page);

    const media = card.locator(shape.media);
    await expect(media, `${shape.url} must render a <${shape.media}>, not the placeholder`).toHaveCount(1);
    await expect(media).toHaveAttribute("src", shape.src as string & RegExp);
    await expect(card.getByText(PLACEHOLDER)).toHaveCount(0);
  });
}

test("an Instagram reel still embeds", async ({ page }) => {
  // Instagram is the one source that will not autoplay — it shows a still until
  // tapped — but it must embed rather than fall through to the placeholder.
  await setReel("https://www.instagram.com/reel/DaAwNjpoSuB/");
  const card = await openRail(page);
  await expect(card.locator("iframe")).toHaveAttribute(
    "src", "https://www.instagram.com/reel/DaAwNjpoSuB/embed/"
  );
  await expect(card.getByText(PLACEHOLDER)).toHaveCount(0);
});

test("a URL that is a web page, not a video, shows the admin placeholder", async ({ page }) => {
  // The negative case earns the positives above: it proves the placeholder is
  // what an unplayable URL looks like, so its absence elsewhere means something.
  // A Drive share link is a page, not a file, and frame-src blocks it anyway.
  await setReel("https://drive.google.com/file/d/abc123/view?usp=sharing");
  const card = await openRail(page);
  await expect(card.getByText(PLACEHOLDER)).toBeVisible();
  await expect(card.locator("iframe, video")).toHaveCount(0);
});

test("the whole configured rail plays — no blank frames", async ({ page }) => {
  // The per-shape tests each run a rail of one. This is the check that was
  // missing entirely: whatever is actually saved, every card plays something.
  const items = [
    { id: "e2e-1", title: "Shorts",     description: "", tag: "", video_url: "https://youtube.com/shorts/--Q_WkPaXBY?si=abc" },
    { id: "e2e-2", title: "Local file", description: "", tag: "", video_url: "/videos/V2.mp4" },
    { id: "e2e-3", title: "Vimeo",      description: "", tag: "", video_url: "https://vimeo.com/76979871" },
  ];
  const res = await admin.put("/api/content/videos", {
    headers: auth(TOKEN), data: { ...originalVideos, items },
  });
  expect(res.ok()).toBeTruthy();

  await page.goto(`${BASE}/`);
  const cards = page.locator("#journal .og-reel-card");
  await expect(cards).toHaveCount(items.length);
  await expect(page.locator("#journal").getByText(PLACEHOLDER)).toHaveCount(0);

  for (let i = 0; i < items.length; i++) {
    await expect(
      cards.nth(i).locator("iframe, video"),
      `reel ${i + 1} (${items[i].video_url}) must render playable media`
    ).toHaveCount(1);
  }
});
