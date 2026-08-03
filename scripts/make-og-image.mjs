// Regenerates public/og-share.jpg — the image Facebook, WhatsApp, iMessage and
// LinkedIn show when someone shares a link to the site.  Run with:
//
//     npm run og:image
//
// The source is src/assets/logo.jpg, the same lockup the site header uses, so
// the share card and the site agree.  It is 358x166: under the 200x200 floor
// Facebook enforces and the 300x200 WhatsApp wants before it will draw a large
// card, which is why this exists rather than pointing og:image straight at the
// asset.  The logo is scaled to 1200x630 and the leftover height is filled with
// its own background green, sampled from the file — nothing is cropped, and
// nothing is added but more of the green that is already there.
//
// If the share image ever changes, give the output file a NEW name and update
// index.html + DEFAULT_OG_IMAGE together: WhatsApp caches share images by URL
// and offers no way to purge them, so reusing the name means people keep seeing
// the old picture indefinitely.
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const SOURCE = fileURLToPath(new URL("src/assets/logo.jpg", root));
const OUT = fileURLToPath(new URL("public/og-share.jpg", root));

const WIDTH = 1200;
const HEIGHT = 630;
/** Fraction of the card width the lockup spans; the rest is its own green, so
 *  no part of the logo sits on the boundary of whatever crop a platform applies. */
const LOGO_WIDTH_RATIO = 0.92;

const logoDataUrl = `data:image/jpeg;base64,${readFileSync(SOURCE).toString("base64")}`;

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.setContent("<body></body>");

  const { dataUrl, bg } = await page.evaluate(
    async ({ logoUrl, WIDTH, HEIGHT, LOGO_WIDTH_RATIO }) => {
      const img = new Image();
      img.src = logoUrl;
      await img.decode();

      const src = document.createElement("canvas");
      src.width = img.naturalWidth;
      src.height = img.naturalHeight;
      const srcCtx = src.getContext("2d");
      srcCtx.drawImage(img, 0, 0);

      // Sample the background from patches set in from each corner. The
      // outermost row of a JPEG carries compression fringing; matching that
      // instead of the true background is what leaves a seam around the logo.
      const INSET = 4;
      const PATCH = 8;
      const pixels = [
        [INSET, INSET],
        [src.width - INSET - PATCH, INSET],
        [INSET, src.height - INSET - PATCH],
        [src.width - INSET - PATCH, src.height - INSET - PATCH],
      ].flatMap(([x, y]) => {
        const { data } = srcCtx.getImageData(x, y, PATCH, PATCH);
        const out = [];
        for (let i = 0; i < data.length; i += 4) out.push([data[i], data[i + 1], data[i + 2]]);
        return out;
      });
      const channel = (i) => Math.round(pixels.reduce((n, p) => n + p[i], 0) / pixels.length);
      const bg = `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;

      const card = document.createElement("canvas");
      card.width = WIDTH;
      card.height = HEIGHT;
      const ctx = card.getContext("2d");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const TRIM = 3; // drop the same fringed edge rather than scaling it up 3x
      const sw = img.naturalWidth - TRIM * 2;
      const sh = img.naturalHeight - TRIM * 2;
      const dw = Math.round(WIDTH * LOGO_WIDTH_RATIO);
      const dh = Math.round((sh / sw) * dw);
      ctx.drawImage(img, TRIM, TRIM, sw, sh, Math.round((WIDTH - dw) / 2), Math.round((HEIGHT - dh) / 2), dw, dh);

      return { dataUrl: card.toDataURL("image/jpeg", 0.94), bg };
    },
    { logoUrl: logoDataUrl, WIDTH, HEIGHT, LOGO_WIDTH_RATIO },
  );

  writeFileSync(OUT, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`wrote ${OUT} — ${WIDTH}x${HEIGHT}, background ${bg}`);
} finally {
  await browser.close();
}
