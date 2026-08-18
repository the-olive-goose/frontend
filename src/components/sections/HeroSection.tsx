import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HeroContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { SkelBlock, SkelText } from "@/components/ui/ContentSkeleton";
import CountdownTimer from "@/components/CountdownTimer";
import useInViewport from "@/hooks/useInViewport";
import { resolveHeroVideoSrc, type HeroVideoEnv } from "@/lib/heroVideo";
import { buildHeroImageSources } from "@/lib/heroImage";
import heroBg from "@/assets/hero-bg.jpg";

interface Props {
  data: HeroContent;
  /** False while the hero copy is still loading — skeletons stand in for it. */
  ready?: boolean;
}

const hexToRgba = (hex: string, alpha: number) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

/** Matches the `sm:` breakpoint the hero's own heights switch at. */
const MOBILE_QUERY = "(max-width: 639px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type ConnectionInfo = {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

/** Not in the DOM lib yet, and absent entirely on Safari. */
const connection = (): ConnectionInfo | undefined =>
  typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { connection?: ConnectionInfo }).connection;

const matches = (query: string): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;

const readEnv = (): HeroVideoEnv => {
  const conn = connection();
  return {
    isMobileViewport: matches(MOBILE_QUERY),
    reducedMotion: matches(REDUCED_MOTION_QUERY),
    saveData: !!conn?.saveData,
    effectiveType: conn?.effectiveType,
  };
};

/**
 * The browser conditions {@link resolveHeroVideoSrc} decides on, kept current.
 *
 * Re-read on change rather than once on mount because all three move under a
 * visitor mid-visit: a phone rotates into the desktop breakpoint, reduced motion
 * is a system toggle, and a connection dropping to 3g on the move is the exact
 * case the slow-connection rule exists for.
 */
const useHeroVideoEnv = (): HeroVideoEnv => {
  const [env, setEnv] = useState<HeroVideoEnv>(readEnv);

  useEffect(() => {
    const update = () => setEnv(readEnv());
    const lists = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? [window.matchMedia(MOBILE_QUERY), window.matchMedia(REDUCED_MOTION_QUERY)]
      : [];
    const conn = connection();

    lists.forEach(list => list.addEventListener?.("change", update));
    conn?.addEventListener?.("change", update);
    // The first read happened during render, before any of this was subscribed.
    update();

    return () => {
      lists.forEach(list => list.removeEventListener?.("change", update));
      conn?.removeEventListener?.("change", update);
    };
  }, []);

  return env;
};

/**
 * The background clip: muted, looping, and layered over the still.
 *
 * It is `aria-hidden` and untabbable because it carries no information — the
 * still underneath is the same shot, and the alt text already on that image is
 * the accessible description of the hero.
 *
 * Two things keep it from being expensive. It fades in only once a frame has
 * decoded, so the still is never replaced by a black rectangle; and the caller
 * only mounts it while the hero is on screen, so scrolling to the shop stops
 * a decoder running behind a page nobody is looking at.
 */
const HeroBackgroundVideo = ({ src }: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(false), [src]);

  // Phones pause video when the tab goes to the background and nothing starts it
  // again on the way back, which leaves the homepage showing one frozen frame.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const resume = () => {
      // A clip already decoded — served from cache, or still buffered from a
      // previous mount — can pass `canplay` before React has that listener
      // attached, which would leave it playing at opacity 0 forever.
      if (video.readyState >= 3) setReady(true);
      if (document.hidden || !video.paused) return;
      video.play().catch(() => { /* refused; the next trigger can try again */ });
    };

    video.addEventListener("pause", resume);
    video.addEventListener("canplay", resume);
    document.addEventListener("visibilitychange", resume);
    resume();

    return () => {
      video.removeEventListener("pause", resume);
      video.removeEventListener("canplay", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      // Every one of these is load-bearing on a phone: iOS refuses to autoplay
      // anything that is not muted, and without playsInline it takes the video
      // fullscreen over the page the moment it starts.
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      // A background is not a video the visitor is watching: it should not be
      // offered to AirPlay, and it should not answer a long press with "Save
      // Video" over the headline. `pointer-events: none` also guarantees a
      // finger dragged across the hero scrolls the page and nothing else.
      disablePictureInPicture
      {...({ disableRemotePlayback: true } as React.VideoHTMLAttributes<HTMLVideoElement>)}
      className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
      style={{ opacity: ready ? 1 : 0, objectPosition: "center", pointerEvents: "none" }}
    />
  );
};

const HeroSection = ({ data, ready = true }: Props) => {
  const bgImage     = data.bg_image_url || heroBg;
  const bgOpacity   = data.bg_opacity   ?? 1.0;
  const tintColor   = data.tint_color   ?? "#1e2918";
  const tintOpacity = data.tint_opacity ?? 0.45;

  // Derived, not stored: one saved URL cannot be the right shape for a phone
  // and a desktop at once. The phone's share of a wide photograph is small
  // enough to be a composition decision, so an admin's own crop wins when they
  // have made one. Memoised — it is a handful of string builds per render.
  const imageSources = useMemo(
    () => buildHeroImageSources(bgImage, data.bg_image_mobile_url),
    [bgImage, data.bg_image_mobile_url],
  );

  const env = useHeroVideoEnv();
  const videoSrc = resolveHeroVideoSrc(
    { desktop: data.bg_video_url, mobile: data.bg_video_mobile_url },
    env,
  );

  // The still is the hero's LCP image, and the clip is decoration. Holding the
  // video back until the still has painted keeps them from racing for the same
  // connection, which on a phone is the difference between the headline
  // appearing over a photo and appearing over an empty frame.
  const [stillPainted, setStillPainted] = useState(false);
  // Unmounted once the visitor scrolls past, which releases the decoder and
  // stops a clip looping — and draining a battery — behind the rest of the page.
  const { ref: frameRef, inView } = useInViewport("200px");
  const showVideo = ready && !!videoSrc && stillPainted && inView;

  // Whether this hero is a video hero at all — which is a question about what
  // the admin saved, not about what this particular visitor's browser agreed to
  // play. The decorative stickers below key off it.
  const hasVideo = !!(data.bg_video_url ?? "").trim() || !!(data.bg_video_mobile_url ?? "").trim();

  // Where the CTA points is the admin's call (Hero → CTA link). "/shop" and any
  // other in-app path route client-side; "#anchor" and external URLs stay plain
  // anchors so they behave exactly as written.
  const ctaHref = data.cta_href || "/shop";
  const isRoute = ctaHref.startsWith("/") && !ctaHref.startsWith("//");
  const ctaClass = "inline-flex items-center gap-2 font-sans text-sm font-medium transition-all hover:opacity-90 hover:-translate-y-0.5";
  const ctaStyle = {
    background: "var(--btn-primary-bg)",
    color: "var(--btn-primary-text)",
    borderRadius: "var(--radius-pill)",
    padding: "14px 36px",
    letterSpacing: "var(--tracking-cta)",
  };

  // The image starts exactly below the fixed navbar. It reads --nav-h — which
  // NavbarSection publishes from its own measurement — rather than measuring
  // #site-navbar a second time here: two independent measurements drift the
  // moment the header changes height (an admin with no announcement messages has
  // no announcement bar), and this one left a gap under the navbar.
  return (
    <section
      id="hero"
      className="relative w-full"
      style={{ marginTop: "var(--nav-h, 112px)" }}
    >
      {/* ── Image fills a responsive fixed height so the centered text overlay
             always has room, regardless of the image's own aspect ratio ── */}
      <div ref={frameRef} className="relative w-full h-[440px] sm:h-[620px] lg:h-[760px]">
        {/* Held back until the hero content is known: the admin can point this at
            their own photo, and rendering the bundled one first would swap the
            whole hero out from under the visitor. */}
        {ready && (
          // Brightness lives on the layer, not on each of its children: with the
          // clip fading in over the still, a half-faded video over a half-faded
          // photo would compound into something brighter than what was set.
          <div className="absolute inset-0" style={{ opacity: Math.max(0.05, bgOpacity) }}>
            {/* Phones and tablets are served the rectangle they actually paint,
                rather than a full-width photograph they would download whole
                and then crop. The <img> keeps the admin's own URL: it is what
                desktops get, and it is what everyone gets when the photo is not
                something Cloudinary can re-cut. */}
            <picture>
              {imageSources.map(({ media, srcSet }) => (
                <source key={media} media={media} sizes="100vw" srcSet={srcSet} />
              ))}
              <img
                src={bgImage}
                alt="Handmade café-inspired candles by The Olive Goose, Dublin"
                // React 18 only passes the LCP fetch hint through as a lowercase DOM
                // attribute (camelCase fetchPriority lands in React 19).
                {...({ fetchpriority: "high" } as React.ImgHTMLAttributes<HTMLImageElement>)}
                decoding="async"
                // A photo that fails still releases the clip: waiting on an onLoad
                // that is never coming would mean a hero with neither. A photo
                // already in cache can finish before React has its listener
                // attached, which `complete` is the only way to notice.
                ref={node => { if (node?.complete) setStillPainted(true); }}
                onLoad={() => setStillPainted(true)}
                onError={() => setStillPainted(true)}
                className="absolute inset-0 w-full h-full object-cover"
              />
            </picture>
            {showVideo && <HeroBackgroundVideo src={videoSrc} />}
          </div>
        )}
        {!ready && (
          <div className="absolute inset-0" style={{ background: "var(--bg-hero)" }} />
        )}

        {/* Configurable tint overlay — a vignette, drawn in from every edge
            and clearing in the middle, so the photograph is brightest where the
            subject is and settles down towards the frame.

            Only the colours are set here. The shape of the ramp lives in
            `.og-hero-tint`, which gives phones their own: they are cropped to
            well under half the picture's width, so the subject fills much more
            of the frame and the desktop stops would close in over it.

            All three stops are the same colour and differ only in alpha. Fading
            to `transparent` would fade through transparent *black*, which greys
            the middle of the ramp on a coloured tint. */}
        {tintOpacity > 0 && (
          <div
            className="absolute inset-0 og-hero-tint"
            style={{
              "--og-tint-clear": hexToRgba(tintColor, 0),
              "--og-tint-mid": hexToRgba(tintColor, tintOpacity * 0.45),
              "--og-tint-edge": hexToRgba(tintColor, tintOpacity),
            } as React.CSSProperties}
          />
        )}

        {/* Floating stickers */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Decorative emoji — hidden on small screens so they don't cover the
              photo, and hidden entirely once the background is a video. Pinned
              stickers read as part of a still photograph; over moving footage
              they read as three emoji stuck to the screen, and the footage is
              already carrying the atmosphere they were there to add.

              Keyed off the video being *configured*, not off it playing, so the
              hero is one design for everyone — a visitor on reduced motion sees
              the same layout as the one watching the clip, rather than stickers
              that appear because their phone declined to autoplay. */}
          {!hasVideo && <div className="hidden sm:block">
            <span style={{ position:"absolute", top:"12%", right:"8%",  fontSize:"2.8rem", transform:"rotate(15deg)",  filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.35))", opacity:0.9  }}>✨</span>
            <span style={{ position:"absolute", top:"22%", right:"14%", fontSize:"1.6rem", transform:"rotate(-8deg)",  filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.3))",  opacity:0.85 }}>🌿</span>
            <span style={{ position:"absolute", bottom:"22%",right:"6%",fontSize:"2.2rem", transform:"rotate(-18deg)", filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.35))", opacity:0.88 }}>🕯️</span>
          </div>}
          {/* SMALL BATCH stamp — pinned to the top-right corner, and hidden below
              `md` for the same reason the emoji above are hidden below `sm`.

              The photo is `object-cover`, so a narrow viewport crops it hard
              from the sides and the corner the stamp sits in lands much further
              into the middle of the picture than it does on a desktop. On the
              current hero that put the stamp straight over the "new autumn
              collection" list, and no corner survives the mobile crop: every one
              of them is on a menu board, the counter, or the goose. Above `md`
              the crop is loose enough that the corner is backdrop again. */}
          <div
            className="absolute hidden md:flex flex-col items-center justify-center rotate-[-12deg] w-[88px] h-[88px] top-[10%] right-[4%]"
            style={{
              borderRadius:"50%",
              background:"var(--color-gold)",
              border:"3px dashed rgba(255,255,255,0.6)",
              boxShadow:"var(--shadow-stamp)",
            }}
          >
            <span style={{ fontSize:"0.55rem", fontWeight:700, letterSpacing:"0.12em", color:"var(--color-forest-dark)", textTransform:"uppercase", lineHeight:1.4, textAlign:"center", padding:"0 6px" }}>
              Small{"\n"}Batch
            </span>
            <span style={{ fontSize:"1.1rem" }}>🫶</span>
          </div>
        </div>

        {/* ── Centered content overlay ── */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-end sm:justify-center text-center"
          style={{ paddingTop: "clamp(60px,12vw,160px)", paddingBottom: "clamp(40px,6vw,80px)", paddingLeft: "clamp(16px,5vw,48px)", paddingRight: "clamp(16px,5vw,48px)" }}
        >
          {/* Headline */}
          <h1
            className="font-serif font-semibold animate-fade-up"
            style={{
              fontSize: "var(--text-hero)",
              lineHeight: "var(--leading-display)",
              color: "var(--text-on-dark)",
              marginBottom: "var(--space-5)",
              maxWidth: 720,
            }}
          >
            {/* When the admin leaves the headline blank (text baked into the hero
                image), keep a screen-reader/crawler-visible H1 so the homepage
                never ships an empty heading. */}
            {!ready ? (
              <SkelText lines={2} width="min(560px,86vw)" lineHeight={1.1} center />
            ) : data.headline ? (
              <RichText text={data.headline} />
            ) : (
              <span className="sr-only">The Olive Goose — handmade café-inspired candles, Dublin</span>
            )}
          </h1>

          {/* Subtext */}
          <p
            className="font-sans text-base leading-relaxed animate-fade-up-delay-1"
            style={{
              color: "var(--text-muted-on-dark)",
              maxWidth: 480,
              marginBottom: "var(--space-10)",
            }}
          >
            {ready ? <RichText text={data.subtext} /> : <SkelText lines={2} width="min(420px,80vw)" lineHeight={1.5} center />}
          </p>

          {/* Countdown */}
          {data.show_countdown && data.launch_date && (
            <div className="mb-10 animate-fade-up-delay-1">
              <CountdownTimer targetDate={data.launch_date} />
            </div>
          )}

          {/* CTA — single centered button. It is a plain link for everyone:
              browsing the shop needs no account, and gating the hero's only CTA
              behind the sign-in modal stopped first-time visitors at the door. */}
          {/* Offset down off the goose, who the centred stack lands the button
              squarely on top of. A relative `top` moves the button alone — the
              headline and the subtext stay where the composition wants them.

              The amounts are tuned to land the button on the bare counter at
              the front of the shot — below the goose, and below the "hand
              poured with good vibes" placard — which is the one band of this
              hero that carries nothing. They scale with the hero's own heights
              (440/620/760px) and still leave the button 16-40px clear of the
              bottom edge. Phones get the smallest push because 440px of
              picture is the least to spend; there the placard's last line
              stays tucked behind the button. */}
          <div className="animate-fade-up-delay-2 relative top-6 sm:top-32 lg:top-40">
            {!ready ? (
              <SkelBlock height="49px" width="196px" radius="var(--radius-pill)" style={{ color: "var(--text-on-dark)" }} />
            ) : isRoute ? (
              // In-app path (e.g. "/shop") — route it client-side so the SPA
              // doesn't do a full reload of the bundle to change page.
              <Link to={ctaHref} className={ctaClass} style={ctaStyle}>
                {data.cta_text} &nbsp;→
              </Link>
            ) : (
              // Hash anchor or external URL, exactly as the admin wrote it.
              <a href={ctaHref} className={ctaClass} style={ctaStyle}>
                {data.cta_text} &nbsp;→
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Scroll hint */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 hidden sm:flex flex-col items-center gap-1 animate-bounce"
        style={{ color: "var(--text-muted-on-dark)", zIndex: 10 }}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
};

export default HeroSection;
