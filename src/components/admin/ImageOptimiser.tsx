import { useEffect, useState } from "react";
import {
  DEFAULT_IMAGE_SIZE,
  IMAGE_SIZES,
  buildOptimizedImageUrl,
  canOptimizeImage,
  isOptimizedImageUrl,
  originalImageUrl,
  type ImageSize,
} from "@/lib/cloudinaryImage";

/**
 * Cloudinary has to download the photo from wherever it lives, and some hosts
 * stall on that — measured against the current image host, a large file failed
 * twice and went through on the third try. Cloudinary then caches its own
 * failure for a minute or so, which is why "try again shortly" is the honest
 * advice rather than "this will never work".
 */
const FETCH_FAILED =
  "Cloudinary could not download this photo from where it is hosted — that often clears on a second try, so give it a minute and press the button again. If it keeps failing, upload the file here instead of pasting the link.";

/** What a photo's own file turns out to be, once the browser has loaded it. */
type ImageFacts = { width: number; height: number } | "failed" | null;

/**
 * Load a photo just to find out how big it really is.
 *
 * The dimensions are the whole diagnosis. A 4284x5712 photo behind a 120px
 * circle is not something an admin can see by looking at the page — it looks
 * perfect, it is just costing ninety megabytes of phone memory to look that way.
 * Reading them needs no special permission from the host, which is why this
 * measures pixels rather than trying to read a file size across origins.
 */
const useImageFacts = (url: string): ImageFacts => {
  const [facts, setFacts] = useState<ImageFacts>(null);

  useEffect(() => {
    setFacts(null);
    if (!canOptimizeImage(url)) return;

    const img = new Image();
    let live = true;
    img.onload = () => {
      // Cloudinary answers a fetch it could not complete with a 1x1 placeholder
      // rather than a network error, so a "successful" pixel is not enough.
      if (live) setFacts(img.naturalWidth > 1 ? { width: img.naturalWidth, height: img.naturalHeight } : "failed");
    };
    img.onerror = () => { if (live) setFacts("failed"); };
    img.src = url;

    return () => { live = false; img.onload = null; img.onerror = null; };
  }, [url]);

  return facts;
};

const megapixels = (f: { width: number; height: number }) => (f.width * f.height) / 1e6;

/**
 * "Optimise for web" for any photo URL, wherever one can be pasted.
 *
 * The image half of CloudinaryOptimiser, and it exists because the same thing
 * kept happening: what gets pasted is the original file. Measured on the live
 * site, that meant 1.8 MB PNGs behind 164px product cards taking nine seconds to
 * arrive on a phone, next to a 0.11 MB JPEG of the same kind of photo that took
 * two — which is why photo loading felt unpredictable rather than simply slow.
 *
 * Photos are usually not on Cloudinary, so this uses fetch delivery: Cloudinary
 * downloads the image once, re-encodes it to WebP or AVIF at a sensible width,
 * and serves it from its CDN from then on. Nothing is re-uploaded and the
 * original URL keeps working.
 *
 * Cloudinary is not always able to download the source — some hosts stall on it.
 * So the rewritten URL is loaded and checked here *before* it is written into
 * the field: a photo that is slow is a problem, a photo that is broken is worse.
 */
export const ImageOptimiser = ({ url, defaultSize = DEFAULT_IMAGE_SIZE, onOptimise }: {
  url: string;
  /** Where this photo is shown, so the offered size starts sensible. */
  defaultSize?: ImageSize;
  onOptimise: (optimised: string) => void;
}) => {
  const [size, setSize] = useState<ImageSize>(defaultSize);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const facts = useImageFacts(originalImageUrl(url));

  if (!canOptimizeImage(url)) return null;

  const optimised = isOptimizedImageUrl(url);
  const target = IMAGE_SIZES[size].width;
  // Null until the photo has loaded, and for one that could not be loaded at all.
  const sized = facts && facts !== "failed" ? facts : null;
  // Only worth shouting about when the file really is bigger than the place it
  // is shown — an already-sensible photo gets the quiet offer, not a warning.
  const oversized = !!sized && sized.width > target * 1.5;

  const apply = () => {
    const next = buildOptimizedImageUrl(url, size);
    if (next === url) return;
    setChecking(true);
    setError("");

    // Load it before storing it. Cloudinary reports a source it could not pull
    // as a 1x1 placeholder, so the size of what came back is the real answer.
    const probe = new Image();
    probe.onload = () => {
      setChecking(false);
      if (probe.naturalWidth > 1) onOptimise(next);
      else setError(FETCH_FAILED);
    };
    probe.onerror = () => {
      setChecking(false);
      setError(FETCH_FAILED);
    };
    probe.src = next;
  };

  const sizes = (
    <select
      value={size}
      onChange={(e) => setSize(e.target.value as ImageSize)}
      className="px-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      {(Object.keys(IMAGE_SIZES) as ImageSize[]).map((key) => (
        <option key={key} value={key}>{IMAGE_SIZES[key].label}</option>
      ))}
    </select>
  );

  const failure = error && (
    <p className="text-xs font-sans text-destructive">{error}</p>
  );

  if (optimised) {
    return (
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-sans text-emerald-600 dark:text-emerald-400">
            ✓ Optimised — Cloudinary delivers a web-sized copy of this photo.
          </p>
          {sizes}
          <button
            type="button"
            onClick={apply}
            disabled={checking}
            className="px-2 py-1 rounded-md border border-border font-sans text-xs hover:bg-muted disabled:opacity-50"
          >
            {checking ? "Checking…" : "Re-apply"}
          </button>
        </div>
        {failure}
      </div>
    );
  }

  return (
    <div className={`mt-2 rounded-lg border p-3 space-y-2 ${oversized ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-muted/30"}`}>
      <p className="text-xs font-sans text-foreground">
        {sized && oversized ? (
          <>
            <strong>
              This photo is {sized.width}&nbsp;×&nbsp;{sized.height} ({megapixels(sized).toFixed(1)}&nbsp;megapixels).
            </strong>{" "}
            It is shown far smaller than that, so every visitor downloads and holds
            the full-size original — which is slow on a phone and can use enough
            memory to crash the browser tab. Optimising delivers a web-sized copy
            of the same photo in a modern format. Nothing is re-uploaded and the
            picture looks the same.
          </>
        ) : (
          <>Deliver this photo through Cloudinary at a web size, in a modern format.
          Nothing is re-uploaded and the picture looks the same.</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {sizes}
        <button
          type="button"
          onClick={apply}
          disabled={checking}
          className="px-3 py-2 rounded-lg bg-primary text-primary-foreground font-sans text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          {checking ? "Checking…" : "Optimise for web"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground font-sans">{IMAGE_SIZES[size].hint}</p>
      {failure}
    </div>
  );
};

export default ImageOptimiser;
