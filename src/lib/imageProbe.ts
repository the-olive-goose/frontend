/**
 * Load an image URL and report what actually came back.
 *
 * Deliberately an `<img>` load rather than a `fetch`. The images this checks are
 * on third-party hosts (i.ibb.co, Cloudinary) that send no CORS headers, so a
 * fetch — even a HEAD — is blocked by the browser and fails for every URL,
 * including the healthy ones. An image element has no such restriction: it is
 * how the page would load the picture anyway, which makes it the honest test.
 *
 * The cost is that the response body is not readable, so file size cannot be
 * measured here. Dimensions can, and dimensions are the thing the ad platforms
 * actually reject on.
 */

/** Long enough for a cold CDN, short enough that a button never hangs forever. */
export const IMAGE_PROBE_TIMEOUT_MS = 12_000;

export interface ImageProbeResult {
  ok: boolean;
  width: number;
  height: number;
}

/**
 * Probe one image.
 *
 * `naturalWidth > 1` rather than `> 0` is not fussiness: Cloudinary answers a
 * source it could not download with a 1×1 placeholder and HTTP 200, so an
 * `onload` alone would report a dead image as healthy. The size of what came
 * back is the real answer — the same check ImageOptimiser makes before writing a
 * URL into a field.
 */
export const probeImage = (
  url: string,
  timeoutMs: number = IMAGE_PROBE_TIMEOUT_MS,
): Promise<ImageProbeResult> =>
  new Promise((resolve) => {
    const trimmed = (url ?? "").trim();
    if (!trimmed) { resolve({ ok: false, width: 0, height: 0 }); return; }

    const img = new Image();
    const settle = (result: ImageProbeResult) => {
      img.onload = null;
      img.onerror = null;
      resolve(result);
    };
    const timer = setTimeout(() => settle({ ok: false, width: 0, height: 0 }), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      const { naturalWidth: width, naturalHeight: height } = img;
      settle({ ok: width > 1, width, height });
    };
    img.onerror = () => { clearTimeout(timer); settle({ ok: false, width: 0, height: 0 }); };
    img.src = trimmed;
  });

/** Whether an image URL paints at all. The older, narrower question. */
export const imageLoads = async (url: string, timeoutMs?: number): Promise<boolean> =>
  (await probeImage(url, timeoutMs)).ok;

/**
 * Run `probe` over `items` a few at a time.
 *
 * Serial would take a minute over a dozen images on a cold CDN; all at once
 * makes a browser queue them anyway and turns one slow host into one long stall.
 * Results come back in the input's order regardless of what finished first.
 */
export const probeAll = async <T, R>(
  items: T[],
  probe: (item: T) => Promise<R>,
  concurrency = 4,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await probe(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
};
