import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { diaryMediaKind, toEmbedUrl, type OurStoryPhoto } from "@/lib/defaults";
import { buildPosterUrl } from "@/lib/cloudinaryVideo";
import { tuneEmbed } from "@/components/sections/VideosSection";
import RichText, { stripRichText } from "@/lib/richtext";
import useBodyScrollLock from "@/hooks/useBodyScrollLock";

// ── The photo diary, as a reel ────────────────────────────────────────────────
// The diary used to be a masonry grid: every photo visible at once, each one a
// thumbnail you had to open before you could read it. Visitors already know how
// to read a photo diary on a phone — one photo a screenful, thumbed upwards —
// so the diary is that instead, and the captions come along for the ride rather
// than hiding behind a hover state no touch screen has.
//
// The scrolling is the browser's own snap scrolling, not a JS-stepped carousel:
// momentum, rubber-banding at the ends and changing your mind mid-flick all come
// free that way, which is most of what makes the gesture feel native. The same
// rail drives the inline stage and the full-screen viewer.

const FALLBACK_CAPTION = "A little studio moment";

/**
 * How many slides either side of the one being read keep real media mounted.
 *
 * This is a load budget, not a nicety. A diary is a handful of untouched phone
 * captures — the photos are 1–3 MB each and the Cloudinary videos are tens of
 * megabytes apiece when their URL still points at the original upload. Mounting
 * every slide at the moment the diary is revealed meant the whole diary started
 * downloading at once, so the first photo (the only one anybody can see) queued
 * behind everything else and the reveal stalled. One slide either side is
 * enough: `active` is recomputed while the flick is still moving, so the next
 * photo mounts before it arrives.
 */
const PRELOAD_RADIUS = 1;

interface ReelChrome {
  photos: OurStoryPhoto[];
  /** Whose diary this is — shown as the handle above each caption. */
  handle: string;
}

interface ReelSlidesProps extends ReelChrome {
  /** The photo being read. Its neighbours load ahead so the next flick has
      something to show — a diary opened on photo five must not start black. */
  priority: number;
  /** Full-screen viewer: videos get controls and a shot at sound, embeds get
      their player back. In the rail everything plays as a muted moving poster. */
  interactive?: boolean;
}

/**
 * Snap rail plumbing: which photo is filling the frame, and how to send the
 * rail to another one. The index is read back from the scroll position rather
 * than driven by state, so a finger flick and a button press agree.
 */
const useReelRail = (count: number, initialIndex = 0) => {
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(initialIndex);

  // Opening on the fifth photo should start on the fifth photo — not flick
  // through the four before it — so this jumps before the first paint.
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail || !initialIndex) return;
    rail.scrollTop = initialIndex * rail.clientHeight;
  }, [initialIndex]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const height = rail.clientHeight || 1;
      setActive(Math.max(0, Math.min(Math.round(rail.scrollTop / height), count - 1)));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      rail.removeEventListener("scroll", onScroll);
    };
  }, [count]);

  const goTo = useCallback((index: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const target = Math.max(0, Math.min(index, count - 1));
    rail.scrollTo({ top: target * rail.clientHeight, behavior: "smooth" });
  }, [count]);

  return { railRef, active, goTo };
};

/**
 * A diary entry that is a video file. Only the slide being read plays — the
 * rail is a stack of full-frame videos, and letting them all run would turn a
 * phone into a hand warmer. In the rail it plays as a moving photo: muted,
 * looping, no chrome. The viewer hands over controls and asks for sound, and
 * falls back to muted when the browser refuses autoplay-with-sound (most do).
 *
 * Only the slide being read is allowed to fetch anything: a neighbour sits on
 * its poster until it is the one being read, because `preload="metadata"` on an
 * untransformed phone capture is not the small request it sounds like — the
 * index of a QuickTime recording can live at the end of the file, so asking for
 * metadata can drag in most of the video.
 */
const DiaryVideo = ({ src, poster, label, active, interactive }: {
  src: string;
  poster: string;
  label: string;
  active: boolean;
  interactive: boolean;
}) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!active) { video.pause(); return; }
    video.muted = !interactive;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => { /* nothing more to try; the frame stands as a photo */ });
    });
  }, [active, interactive]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster || undefined}
      className="og-diary-photo"
      aria-label={label}
      loop
      playsInline
      muted={!interactive}
      controls={interactive}
      preload={active ? "auto" : "none"}
    />
  );
};

/**
 * A photo — or a video's first frame — in the reel's frame. Studio shots arrive
 * portrait, square and landscape, and cropping them to a common frame beheads
 * half of them, so the image is contained and its own blur fills whatever is
 * left over: the same trick every reel app uses.
 *
 * The blur is a second `<img>` at the same URL, which the browser serves from
 * the one decode — but only if it is never asked for a URL the frame in front
 * of it doesn't need, which is why this only ever renders inside the preload
 * window.
 */
const StillFrame = ({ src, label }: { src: string; label: string }) => (
  <>
    <img src={src} alt="" aria-hidden="true" className="og-diary-blur" decoding="async" />
    <img src={src} alt={label} className="og-diary-photo" decoding="async" />
  </>
);

const ReelSlides = ({ photos, handle, priority, interactive = false }: ReelSlidesProps) => (
  <>
    {photos.map((photo, index) => {
      const kind = diaryMediaKind(photo.image_url);
      const label = stripRichText(photo.caption) || `Founder diary ${kind === "image" ? "photo" : "video"} ${index + 1}`;
      const active = index === priority;
      // Neighbours are worth the bytes — the next flick must have something to
      // show, and a diary opened on photo five must not start black. Anything
      // further out stays unmounted until it is flicked towards.
      const near = Math.abs(index - priority) <= PRELOAD_RADIUS;
      // In the rail, embeds a flick away are worth mounting: muted autoplay
      // means the next slide is already moving when it arrives. In the viewer
      // the player asks for sound, so only the slide being read may exist —
      // two YouTube frames talking over each other is not a diary.
      const mounted = interactive ? active : near;
      // A Cloudinary still of the first frame is ~40 KB, so an out-of-window
      // video reads as a photo instead of a black rectangle. Non-Cloudinary
      // videos have no still to derive; those get the placeholder.
      const poster = kind === "video" ? buildPosterUrl(photo.image_url) : "";
      return (
        <figure key={photo.id || index} className="og-diary-slide">
          {kind === "image" && (near
            ? <StillFrame src={photo.image_url} label={label} />
            : <div className="og-diary-wait" aria-hidden="true">📷</div>
          )}
          {kind === "video" && (mounted ? (
            <DiaryVideo
              src={toEmbedUrl(photo.image_url)}
              poster={poster}
              label={label}
              active={active}
              interactive={interactive}
            />
          ) : poster ? (
            <StillFrame src={poster} label={label} />
          ) : (
            <div className="og-diary-wait" aria-hidden="true">▶</div>
          ))}
          {kind === "embed" && (mounted ? (
            <>
              <iframe
                src={tuneEmbed(toEmbedUrl(photo.image_url), interactive ? "lightbox" : "rail")}
                title={label}
                className="og-diary-embed"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
              {/* The rail's gesture must not vanish into the player: the shield
                  soaks up the touch so a flick scrolls the diary, and the tap it
                  swallows bubbles up to open the viewer, where the shield is
                  gone and the player's own controls work. */}
              {!interactive && <div className="og-diary-shield" aria-hidden="true" />}
            </>
          ) : (
            <div className="og-diary-embed-wait" aria-hidden="true">▶</div>
          ))}
          <div className="og-diary-veil" aria-hidden="true" />
          <figcaption className={`og-diary-caption${kind !== "image" && interactive ? " og-diary-caption-raised" : ""}`}>
            <span className="og-diary-handle">
              <span className="og-diary-avatar" aria-hidden="true">🕯️</span>
              {handle}
            </span>
            <p className="og-diary-text"><RichText text={photo.caption || FALLBACK_CAPTION} /></p>
          </figcaption>
        </figure>
      );
    })}
  </>
);

/** One tick per photo would turn into a ladder on a long diary; a proportional
    thumb reads the same at six photos and at sixty. */
const ReelProgress = ({ count, active }: { count: number; active: number }) => (
  <div className="og-diary-track" aria-hidden="true">
    <span
      className="og-diary-thumb"
      style={{ height: `${100 / count}%`, top: `${(active * 100) / count}%` }}
    />
  </div>
);

const ReelSteps = ({ count, active, goTo }: { count: number; active: number; goTo: (i: number) => void }) => (
  <>
    <button
      type="button"
      className="og-diary-step og-diary-step-up"
      onClick={() => goTo(active - 1)}
      disabled={active === 0}
      aria-label="Previous photo"
    >↑</button>
    <button
      type="button"
      className="og-diary-step og-diary-step-down"
      onClick={() => goTo(active + 1)}
      disabled={active === count - 1}
      aria-label="Next photo"
    >↓</button>
  </>
);

interface DiaryReelProps extends ReelChrome {
  /** Admin copy nudging the first-timer into the gesture. */
  hint?: string;
  onExpand: (index: number) => void;
}

/** How long the nudge waits for someone who never touches the reel at all. */
const HINT_TIMEOUT_MS = 6000;

export const DiaryReel = ({ photos, handle, hint, onExpand }: DiaryReelProps) => {
  const { railRef, active, goTo } = useReelRail(photos.length);
  // A tap opens the photo; a drag must not. Comparing the rail's scroll position
  // across the gesture tells the two apart without fighting the native scroll.
  const scrollAtPress = useRef(0);
  // The nudge is spent the moment it has been understood. Tying it to "we're on
  // the first photo" instead meant it came back every time someone scrolled up
  // again — a hint that keeps re-explaining a gesture you've already made reads
  // as a sticker, not a hint. One interaction of any kind retires it for good,
  // and if none comes it retires itself.
  const [hintSpent, setHintSpent] = useState(false);
  const spendHint = useCallback(() => setHintSpent(true), []);

  useEffect(() => {
    if (hintSpent) return;
    const timer = window.setTimeout(spendHint, HINT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [hintSpent, spendHint]);

  return (
    <div className="og-diary-stage">
      <div
        ref={railRef}
        className="og-diary-rail no-scrollbar"
        tabIndex={0}
        role="group"
        aria-label={`Photo diary, ${photos.length} photos. Scroll for the next one.`}
        onScroll={spendHint}
        onPointerDown={() => {
          scrollAtPress.current = railRef.current?.scrollTop ?? 0;
          spendHint();
        }}
        onClick={() => {
          if (Math.abs((railRef.current?.scrollTop ?? 0) - scrollAtPress.current) < 6) onExpand(active);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); goTo(active + 1); spendHint(); }
          if (event.key === "ArrowUp") { event.preventDefault(); goTo(active - 1); spendHint(); }
          if (event.key === "Enter") { event.preventDefault(); onExpand(active); }
        }}
      >
        <ReelSlides photos={photos} handle={handle} priority={active} />
      </div>

      <span className="og-diary-count">{active + 1} / {photos.length}</span>
      <button
        type="button"
        className="og-diary-expand"
        onClick={() => { spendHint(); onExpand(active); }}
        aria-label="Open the photo diary full screen"
      >⤢</button>
      <ReelProgress count={photos.length} active={active} />
      <ReelSteps count={photos.length} active={active} goTo={(index) => { spendHint(); goTo(index); }} />

      <AnimatePresence>
        {hint && !hintSpent && (
          <motion.p
            className="og-diary-hint"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
          >
            <span className="og-diary-hint-pill"><RichText text={hint} /></span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
};

interface DiaryReelViewerProps extends ReelChrome {
  index: number;
  onClose: () => void;
}

export const DiaryReelViewer = ({ photos, handle, index, onClose }: DiaryReelViewerProps) => {
  useBodyScrollLock(true);
  const { railRef, active, goTo } = useReelRail(photos.length, index);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowDown" || event.key === "PageDown") { event.preventDefault(); goTo(active + 1); }
      if (event.key === "ArrowUp" || event.key === "PageUp") { event.preventDefault(); goTo(active - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, goTo, onClose]);

  return (
    <motion.div
      className="og-diary-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo diary"
    >
      <button type="button" className="og-diary-close" onClick={onClose} aria-label="Close the photo diary">✕</button>

      <div className="og-diary-full-stage">
        {/* Full screen owns the gesture, so this rail keeps the overscroll to
            itself — nothing behind it should creep while a photo is being read. */}
        <div
          ref={railRef}
          className="og-diary-rail og-diary-rail-full no-scrollbar"
          tabIndex={0}
          role="group"
          aria-label={`Photo diary, ${photos.length} photos. Scroll for the next one.`}
        >
          <ReelSlides photos={photos} handle={handle} priority={active} interactive />
        </div>

        <span className="og-diary-count">{active + 1} / {photos.length}</span>
        <ReelProgress count={photos.length} active={active} />
        <ReelSteps count={photos.length} active={active} goTo={goTo} />
      </div>
    </motion.div>
  );
};

export default DiaryReel;
