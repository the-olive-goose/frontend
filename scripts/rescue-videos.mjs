/**
 * Downloads every Cloudinary-hosted video the live site references, at its
 * ORIGINAL quality, into ./video-originals/.
 *
 * Why this exists: on 2026-08-18 the `asravqmm` account was disabled for
 * exceeding its free quota, and the 16 clips it hosted turned out to exist
 * nowhere else — not on the server, not on this machine. There was no copy to
 * migrate. Run this the moment delivery works again, before anything else.
 *
 * Usage:  node scripts/rescue-videos.mjs
 */
const SITE = process.env.SITE ?? "https://theolivegoose.ie";
const SECTIONS = ["videos", "ourStoryPage", "hero"];
const OUT = "video-originals";

const VIDEO_RE = /https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/[^"'\\ ]+/g;

/** Strip the transformation chain: what is left is the untouched original. */
const toOriginal = (url) => {
  const [, cloud, rest] = url.match(/res\.cloudinary\.com\/([^/]+)\/video\/upload\/(.+)$/) ?? [];
  if (!cloud) return null;
  // Drop any leading transform segments; keep from the version marker onward.
  const at = rest.search(/v\d+\//);
  const path = at >= 0 ? rest.slice(at) : rest;
  return { cloud, publicId: path.replace(/\.[a-z0-9]+$/i, "") };
};

const { mkdir, writeFile } = await import("node:fs/promises");
await mkdir(OUT, { recursive: true });

const seen = new Map();
for (const section of SECTIONS) {
  const res = await fetch(`${SITE}/api/content/${section}`);
  if (!res.ok) { console.warn(`! ${section}: HTTP ${res.status}`); continue; }
  for (const raw of (await res.text()).match(VIDEO_RE) ?? []) {
    const o = toOriginal(raw.replace(/\\/g, ""));
    if (o) seen.set(o.publicId, o);
  }
}

console.log(`${seen.size} distinct video assets referenced\n`);

let ok = 0, failed = [];
for (const { cloud, publicId } of seen.values()) {
  const name = publicId.split("/").pop();
  // No transform chain at all = Cloudinary serves the stored original.
  for (const ext of ["mov", "mp4"]) {
    const url = `https://res.cloudinary.com/${cloud}/video/upload/${publicId}.${ext}`;
    const r = await fetch(url);
    if (!r.ok) continue;
    await writeFile(`${OUT}/${name}.${ext}`, Buffer.from(await r.arrayBuffer()));
    const mb = (Number(r.headers.get("content-length") ?? 0) / 1048576).toFixed(1);
    console.log(`  saved ${name}.${ext}  ${mb} MB`);
    ok++;
    break;
  }
}
console.log(`\n${ok}/${seen.size} recovered into ./${OUT}/`);
if (ok < seen.size) console.log("Some failed — the account is still disabled, or the extension differs.");
