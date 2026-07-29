import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { VideosContent, VideoItem, toEmbedUrl, isEmbedUrl, isDirectVideo } from "@/lib/defaults";
import RichText, { stripRichText } from "@/lib/richtext";
import useIsMobile from "@/hooks/useIsMobile";
import useSwipe from "@/hooks/useSwipe";
import useBodyScrollLock from "@/hooks/useBodyScrollLock";

interface Props { data: VideosContent }

const isInstagramUrl = (url: string) =>
  url.includes("instagram.com/reel/") || url.includes("instagram.com/p/");

/**
 * Rail playback: muted, looping, chrome-free — a moving poster.
 * Lightbox playback: sound on, controls on, the visitor is in charge.
 */
const tuneEmbed = (embed: string, mode: "rail" | "lightbox"): string => {
  const join = embed.includes("?") ? "&" : "?";
  if (embed.includes("youtube.com/embed/")) {
    const id = embed.split("/embed/")[1]?.split("?")[0];
    return mode === "rail"
      ? `${embed}${join}autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&modestbranding=1&playsinline=1&rel=0`
      : `${embed}${join}autoplay=1&loop=1&playlist=${id}&controls=1&modestbranding=1&playsinline=1&rel=0`;
  }
  if (embed.includes("player.vimeo.com")) {
    return mode === "rail"
      ? `${embed}${join}autoplay=1&loop=1&muted=1&background=1`
      : `${embed}${join}autoplay=1&loop=1`;
  }
  return embed;
};

const instagramId = (url: string) => {
  const reel = url.match(/instagram\.com\/reel\/([^/?#\s]+)/);
  const post = url.match(/instagram\.com\/p\/([^/?#\s]+)/);
  const id = reel?.[1] ?? post?.[1];
  return id ? { id, type: reel ? "reel" : "p" } : null;
};

/**
 * An .mp4 always plays. In the rail it's muted so the browser lets it start;
 * in the lightbox we ask for sound and, if autoplay-with-sound is refused (most
 * browsers refuse it), drop back to muted rather than leaving a frozen frame.
 *
 * Starting once isn't enough to stay playing: phones pause video when the tab
 * goes to the background or the element leaves the screen, and nothing restarts
 * it on the way back. The rail copy is therefore nudged awake whenever it's
 * visible again, so a reel is never sitting there as a still frame.
 */
const DirectVideo = ({ src, interactive }: { src: string; interactive: boolean }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = !interactive;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => { /* nothing more to try; controls are there */ });
    });
  }, [interactive, src]);

  useEffect(() => {
    const video = ref.current;
    // The lightbox copy is the visitor's to pause — only the rail self-heals.
    if (!video || interactive) return;

    let lastTry = 0;
    const resume = () => {
      const now = Date.now();
      // Throttled so a browser that refuses playback can't be asked in a spin.
      if (document.hidden || video.paused === false || now - lastTry < 1000) return;
      lastTry = now;
      video.play().catch(() => { /* refused; the next trigger can try again */ });
    };

    const observer = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) resume(); },
      { threshold: 0.15 },
    );
    observer.observe(video);
    video.addEventListener("pause", resume);
    document.addEventListener("visibilitychange", resume);

    return () => {
      observer.disconnect();
      video.removeEventListener("pause", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [interactive]);

  return (
    <video
      ref={ref}
      src={src}
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        // The rail fills its 9:16 frame; the lightbox shows the whole shot,
        // whatever ratio it was actually filmed in.
        objectFit: interactive ? "contain" : "cover",
      }}
      autoPlay
      loop
      playsInline
      preload="auto"
      muted={!interactive}
      controls={interactive}
    />
  );
};

/* ── Media ────────────────────────────────────────────────────────────────────
   `interactive` is the difference between the rail and the lightbox. In the
   rail nothing is clickable: a shield sits over the frame so a finger dragged
   across a reel scrolls the rail instead of vanishing into the iframe, which is
   what used to strand visitors on the last reel with no way back. In the
   lightbox the shield is gone, so Instagram's play button and YouTube's
   controls work normally.                                                     */
const ReelMedia = ({ item, interactive }: { item: VideoItem; interactive: boolean }) => {
  const raw = item.video_url ?? "";
  const mode = interactive ? "lightbox" : "rail";

  if (isInstagramUrl(raw)) {
    const ig = instagramId(raw);
    if (!ig) return null;
    // Instagram's embed ships its own header and action bar; the negative
    // offset and extra height crop them so only the reel itself shows.
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#111" }}>
        <iframe
          src={`https://www.instagram.com/${ig.type}/${ig.id}/embed/`}
          title={stripRichText(item.title) || "Instagram reel"}
          style={{ position: "absolute", top: -56, left: 0, width: "100%", height: "calc(100% + 200px)", border: 0 }}
          allow="autoplay; encrypted-media"
          scrolling="no"
        />
      </div>
    );
  }

  const embed = toEmbedUrl(raw);

  if (embed && isEmbedUrl(embed)) {
    return (
      <iframe
        src={tuneEmbed(embed, mode)}
        title={stripRichText(item.title)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  if (embed && isDirectVideo(embed)) {
    return <DirectVideo src={embed} interactive={interactive} />;
  }

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center"
      style={{ color: "rgba(245,239,230,0.32)" }}
    >
      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p className="font-sans text-xs">Add a video URL in admin — a direct .mp4 link, or YouTube (watch or Shorts) or Vimeo</p>
    </div>
  );
};

/* ── Ticker ───────────────────────────────────────────────────────────────────
   The phrases come from admin, so the strip can't assume they fill the screen:
   one short phrase would leave a visible gap every time the loop came round.
   The run is measured and repeated until a half-track out-runs the strip, and
   the duration is derived from that width so a long list doesn't whip past.  */
const MARQUEE_SPEED = 55; // px per second

const Marquee = ({ words }: { words: string[] }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState({ copies: 2, duration: 26 });

  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const run = runRef.current;
      if (!wrap || !run) return;
      const runWidth = run.offsetWidth;
      if (!runWidth) return;
      const copies = Math.max(2, Math.ceil(wrap.offsetWidth / runWidth) + 1);
      setLayout({ copies, duration: (runWidth * copies) / MARQUEE_SPEED });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [words]);

  if (!words.length) return null;

  // Two identical halves; sliding the track one half-width loops seamlessly.
  const runs = Array.from({ length: layout.copies * 2 });

  return (
    <div className="og-marquee" ref={wrapRef} aria-hidden="true">
      <div className="og-marquee-track" style={{ animationDuration: `${layout.duration}s` }}>
        {runs.map((_, copy) => (
          <span className="og-marquee-run" key={copy} ref={copy === 0 ? runRef : undefined}>
            {words.map((word, i) => (
              <span key={`${word}-${i}`}>
                <span className="og-marquee-word">{word}</span>
                <span className="og-marquee-star">✷</span>
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
};

/* ── Rail card ─────────────────────────────────────────────────────────────── */
const ReelCard = ({
  item, index, total, isFocused, isCue, onOpen,
}: {
  item: VideoItem;
  index: number;
  total: number;
  /** Full size and opacity — on a phone only the reel you're looking at. */
  isFocused: boolean;
  /** The one card whose full-screen button pulses, so the cue reads once. */
  isCue: boolean;
  onOpen: () => void;
}) => (
  <motion.div
    className={`og-reel-card${isCue ? " og-reel-card-active" : ""}`}
    animate={{ scale: isFocused ? 1 : 0.955, opacity: isFocused ? 1 : 0.72 }}
    transition={{ type: "spring", stiffness: 260, damping: 30 }}
    style={{ originY: 0.5 }}
  >
    <div className="og-reel-frame">
      <ReelMedia item={item} interactive={false} />

      {/* Shield — swallows the touch the iframe would have eaten, so the rail
          keeps scrolling, and turns the whole reel into one big open-me tap. */}
      <button
        type="button"
        className="og-reel-shield"
        onClick={onOpen}
        aria-label={`Open ${stripRichText(item.title) || `reel ${index + 1}`} full screen`}
      >
        <span className="og-reel-scrim" />

        <span className="og-reel-index">
          {String(index + 1).padStart(2, "0")}
          <span style={{ opacity: 0.5 }}>/{String(total).padStart(2, "0")}</span>
        </span>

        {item.tag && (
          <span className="og-reel-peek">
            <span className="og-reel-dot" />
            {item.tag}
          </span>
        )}

        <span className="og-reel-caption">
          {item.title && <span className="og-reel-title"><RichText text={item.title} /></span>}
          {item.description && <span className="og-reel-desc"><RichText text={item.description} /></span>}
          {/* The reel is already playing, so this offers the thing it can't do
              inline: the whole screen, with sound. */}
          <span className="og-reel-cta">
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M4.6 1H1v3.6M7.4 1H11v3.6M11 7.4V11H7.4M1 7.4V11h3.6"
                fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
              />
            </svg>
            full screen
          </span>
        </span>
      </button>
    </div>
  </motion.div>
);

/* ── Lightbox ──────────────────────────────────────────────────────────────── */
const ReelLightbox = ({
  items, index, onClose, onStep,
}: {
  items: VideoItem[];
  index: number;
  onClose: () => void;
  onStep: (delta: number) => void;
}) => {
  useBodyScrollLock(true);
  const stageRef = useRef<HTMLDivElement>(null);

  // The overlay already fills the screen; this hands the reel to the device's
  // own full-screen mode, which on a phone also drops the browser chrome.
  const goFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stage.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onStep(1);
      if (e.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  // The stage itself is interactive, so the swipe lives on the backdrop around
  // it — the same wide margin a phone gives you on any reel viewer.
  const swipe = useSwipe({
    onSwipeLeft:  () => onStep(1),
    onSwipeRight: () => onStep(-1),
  });

  const item = items[index];
  if (!item) return null;

  return (
    <motion.div
      className="og-reel-lightbox"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label={stripRichText(item.title) || "Video"}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      {...swipe}
      style={swipe.style}
    >
      <button type="button" className="og-reel-close" onClick={onClose} aria-label="Close video">✕</button>

      <button
        type="button"
        className="og-reel-expand"
        onClick={goFullscreen}
        aria-label="Toggle device full screen"
      >
        <svg width="15" height="15" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M4.6 1H1v3.6M7.4 1H11v3.6M11 7.4V11H7.4M1 7.4V11h3.6"
            fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        type="button"
        className="og-reel-nav og-reel-nav-prev"
        onClick={() => onStep(-1)}
        disabled={index === 0}
        aria-label="Previous video"
      >←</button>

      <motion.div
        key={item.id ?? index}
        ref={stageRef}
        className="og-reel-stage"
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
      >
        <ReelMedia item={item} interactive />
      </motion.div>

      <button
        type="button"
        className="og-reel-nav og-reel-nav-next"
        onClick={() => onStep(1)}
        disabled={index === items.length - 1}
        aria-label="Next video"
      >→</button>

      <div className="og-reel-lightbox-meta">
        {item.title && <p className="og-reel-lightbox-title"><RichText text={item.title} /></p>}
        <p className="og-reel-lightbox-count">{index + 1} / {items.length}</p>
      </div>
    </motion.div>
  );
};

/* ── Section ───────────────────────────────────────────────────────────────── */
const VideosSection = ({ data }: Props) => {
  const items = data.items ?? [];
  const isMobile = useIsMobile();

  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: false, overflowing: false });
  const [open, setOpen] = useState<number | null>(null);

  const syncFromScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const cards = Array.from(rail.children) as HTMLElement[];
    if (!cards.length) return;

    const railBox = rail.getBoundingClientRect();
    const centre = railBox.left + railBox.width / 2;

    let nearest = 0;
    let nearestDist = Infinity;

    cards.forEach((card, i) => {
      const box = card.getBoundingClientRect();
      const dist = Math.abs(box.left + box.width / 2 - centre);
      if (dist < nearestDist) { nearestDist = dist; nearest = i; }
    });

    setActive(nearest);
    setEdges({
      start: rail.scrollLeft <= 2,
      end: rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2,
      // Three reels on a wide screen all fit; dots and arrows would be lying.
      overflowing: rail.scrollWidth > rail.clientWidth + 4,
    });
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncFromScroll);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    syncFromScroll();
    return () => {
      cancelAnimationFrame(frame);
      rail.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [syncFromScroll, items.length]);

  const scrollToCard = useCallback((i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const card = rail.children[Math.max(0, Math.min(i, rail.children.length - 1))] as HTMLElement | undefined;
    if (!card) return;
    // Measured live rather than from offsetLeft so it holds whatever the rail's
    // padding and card width work out to at this breakpoint.
    const delta = card.getBoundingClientRect().left - rail.getBoundingClientRect().left;
    const pad = parseFloat(getComputedStyle(rail).paddingLeft) || 0;
    rail.scrollBy({ left: delta - pad, behavior: "smooth" });
  }, []);

  const step = useCallback((delta: number) => {
    setOpen(o => (o === null ? o : Math.max(0, Math.min(o + delta, items.length - 1))));
  }, [items.length]);

  // Reading a reel in the lightbox should leave the rail parked on it.
  useEffect(() => { if (open !== null) scrollToCard(open); }, [open, scrollToCard]);

  if (!items.length) return null;

  return (
    <section id="journal" style={{ background: "var(--bg-videos)", overflow: "hidden" }} className="py-16 sm:py-20">
      <div className="max-w-6xl mx-auto">
        {/* ── Header ── */}
        <div className="text-center mb-6 px-6">
          <span className="og-reel-live">
            <span className="og-reel-live-dot" />
            {data.label ? <RichText text={data.label} /> : "as seen on"}
          </span>
          <h2 className="h-display" style={{ fontSize: "var(--text-display-lg)", color: "var(--text-primary)" }}>
            {data.headline ? <RichText text={data.headline} /> : "catch our vibe ✨"}
          </h2>
          {data.subtext && (
            <p className="font-sans text-sm mt-3 max-w-md mx-auto" style={{ color: "var(--text-muted)" }}>
              <RichText text={data.subtext} />
            </p>
          )}
        </div>

        {/* ── Ticker — the low hum that says there's more going on back here ── */}
        <Marquee words={data.ticker ?? []} />

        {/* ── Rail — native scroll-snap, so momentum, rubber-banding and
             direction changes are the phone's own, not a re-implementation ── */}
        <div className="og-reel-rail-wrap">
          <div ref={railRef} className="og-reel-rail no-scrollbar">
            {items.map((item, i) => (
              <ReelCard
                key={item.id ?? i}
                item={item}
                index={i}
                total={items.length}
                isFocused={!isMobile || i === active}
                isCue={i === active}
                onOpen={() => setOpen(i)}
              />
            ))}
          </div>

          {edges.overflowing && (
            <>
              <button
                type="button"
                className="og-rail-arrow og-rail-arrow-prev"
                onClick={() => scrollToCard(active - 1)}
                disabled={edges.start}
                aria-label="Previous videos"
              >←</button>
              <button
                type="button"
                className="og-rail-arrow og-rail-arrow-next"
                onClick={() => scrollToCard(active + 1)}
                disabled={edges.end}
                aria-label="Next videos"
              >→</button>
            </>
          )}
        </div>

        {/* ── Progress — one tick per reel, finger-sized hit area ── */}
        {edges.overflowing && (
          <div className="flex items-center justify-center mt-1">
            {items.map((item, i) => (
              <button
                key={item.id ?? i}
                onClick={() => scrollToCard(i)}
                aria-label={`Show video ${i + 1} of ${items.length}`}
                aria-current={i === active}
                style={{ border: "none", background: "none", cursor: "pointer", padding: "10px 3px", display: "flex", alignItems: "center" }}
              >
                <motion.span
                  animate={{
                    width: i === active ? 20 : 6,
                    background: i === active ? "var(--color-forest-dark)" : "rgba(29,43,27,0.25)",
                  }}
                  transition={{ duration: 0.25 }}
                  style={{ height: 6, borderRadius: 3, display: "block", width: i === active ? 20 : 6 }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {open !== null && (
          <ReelLightbox items={items} index={open} onClose={() => setOpen(null)} onStep={step} />
        )}
      </AnimatePresence>
    </section>
  );
};

export default VideosSection;
