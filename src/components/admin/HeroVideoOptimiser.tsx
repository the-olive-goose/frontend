import { useEffect, useState } from "react";
import {
  DEFAULT_HERO_QUALITY,
  HERO_LONG_SECONDS,
  HERO_MOBILE_WIDTH,
  HERO_POSTER_WIDTH,
  HERO_TRIM_SECONDS,
  HERO_VIDEO_TIERS,
  buildHeroMobileVideoUrl,
  buildHeroVideoUrl,
  buildPosterUrl,
  isCloudinaryVideo,
  isOptimizedUrl,
  isVideoUrl,
  type HeroVideoQuality,
} from "@/lib/cloudinaryVideo";

const PROBE_FAILED =
  "This video would not load in the browser. Check the link opens on its own — a Cloudinary video URL ends in the file itself, not a share or preview page.";

/** What the clip turns out to be, once the browser has read its header. */
type VideoFacts = { width: number; height: number; seconds: number } | "failed" | null;

/**
 * Read a video's real dimensions and length without downloading it.
 *
 * `preload="metadata"` fetches the header only — a few kilobytes — which is
 * enough for both numbers and is the whole diagnosis. A 4K 40-second clip
 * behind a hero looks perfect in the admin preview; what it costs is invisible
 * until it is on a phone, and by then it is the first thing every visitor
 * meets.
 */
const useVideoFacts = (url: string): VideoFacts => {
  const [facts, setFacts] = useState<VideoFacts>(null);

  useEffect(() => {
    setFacts(null);
    if (!isVideoUrl(url)) return;

    const video = document.createElement("video");
    let live = true;
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      if (!live) return;
      setFacts({
        width: video.videoWidth,
        height: video.videoHeight,
        // Live streams and some containers report Infinity rather than a length.
        seconds: Number.isFinite(video.duration) ? video.duration : 0,
      });
    };
    video.onerror = () => { if (live) setFacts("failed"); };
    video.src = url;

    return () => { live = false; video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); };
  }, [url]);

  return facts;
};

const megapixels = (f: { width: number; height: number }) => (f.width * f.height) / 1e6;

/**
 * "Optimise for web" for the hero's background clip.
 *
 * The sibling of ImageOptimiser and CloudinaryOptimiser, and it exists for a
 * sharper version of the same reason. A reel is one card in a rail that a
 * visitor may never scroll to; the hero background is on screen for every
 * visitor, on the first paint, and it loops for as long as they stay. A 4K
 * original there is not a slow section — it is a homepage that never settles.
 *
 * Two things are written, not one. The desktop encode is what a laptop gets;
 * the mobile encode is a separate, narrower delivery, because a phone painting
 * a 1440px video into a 390px frame pays for every pixel it then throws away.
 * Both are stored, so what ships is what an admin can see and edit — nothing is
 * rewritten at render time.
 *
 * @see src/lib/cloudinaryVideo.ts — the tiers and the URLs
 * @see src/lib/heroVideo.ts — when the storefront plays it at all
 */
export const HeroVideoOptimiser = ({ url, target = "desktop", onOptimise }: {
  url: string;
  /**
   * Which background this clip is. A desktop clip is encoded at a tier the
   * admin picks and also yields the phone encode of itself; a clip an admin
   * chose *for* phones has one sensible width and no tier to choose.
   */
  target?: "desktop" | "mobile";
  /** Given both encodes, plus a still cut from the clip's first frame. */
  onOptimise: (next: { video: string; mobile: string; poster: string }) => void;
}) => {
  const [quality, setQuality] = useState<HeroVideoQuality>(DEFAULT_HERO_QUALITY);
  const [trim, setTrim] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const facts = useVideoFacts(url);

  if (!isVideoUrl(url)) return null;

  const sized = facts && facts !== "failed" ? facts : null;
  const long = !!sized && sized.seconds > HERO_LONG_SECONDS;
  const seconds = sized ? Math.round(sized.seconds) : 0;

  // Not on Cloudinary: still worth telling an admin what they have pasted, but
  // there is nothing here that can re-encode it.
  if (!isCloudinaryVideo(url)) {
    return (
      <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3 space-y-1">
        <p className="text-xs font-sans text-foreground">
          This video is not hosted on Cloudinary, so it cannot be optimised here —
          it will be served exactly as it is.
          {sized && (
            <> It is {sized.width}&nbsp;×&nbsp;{sized.height}{seconds ? ` and ${seconds} seconds long` : ""}.</>
          )}
        </p>
        <p className="text-xs font-sans text-muted-foreground">
          Upload the clip to Cloudinary and paste that link to get a web-sized
          copy and a separate, lighter one for phones.
        </p>
        {facts === "failed" && <p className="text-xs font-sans text-destructive">{PROBE_FAILED}</p>}
      </div>
    );
  }

  const trimSeconds = trim ? HERO_TRIM_SECONDS : undefined;
  const forPhones = target === "mobile";

  const apply = () => {
    const mobile = buildHeroMobileVideoUrl(url, trimSeconds);
    // A phone clip is only ever the phone encode — there is no second screen
    // for it to also be sized for.
    const video = forPhones ? mobile : buildHeroVideoUrl(url, quality, trimSeconds);
    const poster = buildPosterUrl(url, HERO_POSTER_WIDTH);
    setChecking(true);
    setError("");

    // Load the rewritten URL before storing it. A transformation Cloudinary
    // refuses answers with an error rather than a video, and a broken hero
    // background is far worse than a heavy one.
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.onloadedmetadata = () => {
      setChecking(false);
      onOptimise({ video, mobile, poster });
    };
    probe.onerror = () => {
      setChecking(false);
      setError(PROBE_FAILED);
    };
    probe.src = video;
  };

  const tiers = (
    <select
      value={quality}
      onChange={(e) => setQuality(e.target.value as HeroVideoQuality)}
      aria-label="Video quality"
      className="px-3 py-2 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      {(Object.keys(HERO_VIDEO_TIERS) as HeroVideoQuality[]).map((key) => (
        <option key={key} value={key}>{HERO_VIDEO_TIERS[key].label}</option>
      ))}
    </select>
  );

  const trimBox = (
    <label className="flex items-center gap-2 text-xs font-sans text-foreground cursor-pointer">
      <input
        type="checkbox"
        checked={trim}
        onChange={(e) => setTrim(e.target.checked)}
        className="w-4 h-4 rounded border-border text-primary"
      />
      Use only the first {HERO_TRIM_SECONDS} seconds
    </label>
  );

  const failure = error && <p className="text-xs font-sans text-destructive">{error}</p>;

  const controls = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!forPhones && tiers}
        <button
          type="button"
          onClick={apply}
          disabled={checking}
          className="px-3 py-2 rounded-lg bg-primary text-primary-foreground font-sans text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          {checking ? "Checking…" : isOptimizedUrl(url) ? "Re-apply" : "Optimise for web"}
        </button>
      </div>
      {trimBox}
      <p className="text-xs text-muted-foreground font-sans">
        {forPhones
          ? `${HERO_MOBILE_WIDTH}px wide and silent — about a quarter of the pixels of the desktop copy, which is what keeps a phone responsive while it loops.`
          : `${HERO_VIDEO_TIERS[quality].hint} Phones are sent a separate ${HERO_MOBILE_WIDTH}px copy.`}
      </p>
      {failure}
    </>
  );

  if (isOptimizedUrl(url)) {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-xs font-sans text-emerald-600 dark:text-emerald-400">
          {forPhones
            ? "✓ Optimised — Cloudinary delivers this clip at a phone size."
            : "✓ Optimised — Cloudinary delivers a web-sized copy of this clip, and a lighter one to phones."}
        </p>
        {controls}
      </div>
    );
  }

  const warn = long || (!!sized && sized.width > 1920);

  return (
    <div className={`mt-2 rounded-lg border p-3 space-y-2 ${warn ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-muted/30"}`}>
      <p className="text-xs font-sans text-foreground">
        {sized ? (
          <>
            <strong>
              This clip is {sized.width}&nbsp;×&nbsp;{sized.height} ({megapixels(sized).toFixed(1)}&nbsp;megapixels)
              {seconds ? ` and ${seconds} seconds long` : ""}.
            </strong>{" "}
            {long ? (
              <>A hero background loops for as long as someone is on the page, so
              its length is paid over and over. Optimising delivers a web-sized,
              silent copy, and trimming it keeps the loop short enough that a
              phone has the whole thing after one pass.</>
            ) : (
              forPhones ? (
                <>Optimising delivers a silent, phone-sized copy of the same clip.
                Nothing is re-uploaded and the video looks the same.</>
              ) : (
                <>Optimising delivers a web-sized, silent copy of the same clip and a
                lighter one for phones. Nothing is re-uploaded and the video looks
                the same.</>
              )
            )}
          </>
        ) : facts === "failed" ? (
          <>{PROBE_FAILED}</>
        ) : (
          <>Deliver this clip at a web size, silently, with a lighter copy for
          phones. Nothing is re-uploaded and the video looks the same.</>
        )}
      </p>
      {controls}
    </div>
  );
};

export default HeroVideoOptimiser;
