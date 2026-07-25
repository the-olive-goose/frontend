import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { VideosContent, toEmbedUrl, isEmbedUrl, isDirectVideo } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import useIsMobile from "@/hooks/useIsMobile";
import useSwipe from "@/hooks/useSwipe";

interface Props { data: VideosContent }

const isInstagramUrl = (url: string) =>
  url.includes("instagram.com/reel/") || url.includes("instagram.com/p/");

// Append autoplay + loop params to YouTube / Vimeo embed URLs
const toLoopingEmbedUrl = (embed: string): string => {
  if (embed.includes("youtube.com/embed/")) {
    const videoId = embed.split("/embed/")[1]?.split("?")[0];
    return `${embed}${embed.includes("?") ? "&" : "?"}autoplay=1&mute=1&loop=1&playlist=${videoId}&controls=0&modestbranding=1`;
  }
  if (embed.includes("player.vimeo.com")) {
    return `${embed}${embed.includes("?") ? "&" : "?"}autoplay=1&loop=1&muted=1&background=1`;
  }
  return embed;
};

const InstagramEmbed = ({ url }: { url: string }) => {
  const reelMatch = url.match(/instagram\.com\/reel\/([^/?#\s]+)/);
  const postMatch = url.match(/instagram\.com\/p\/([^/?#\s]+)/);
  const id = reelMatch?.[1] ?? postMatch?.[1];
  const type = reelMatch ? "reel" : "p";
  if (!id) return null;

  return (
    <div style={{
      position: "relative",
      width: "100%",
      paddingBottom: "177.78%",
      overflow: "hidden",
      borderRadius: "20px",
      background: "#111",
    }}>
      <iframe
        src={`https://www.instagram.com/${type}/${id}/embed/`}
        style={{ position: "absolute", top: "-56px", left: 0, width: "100%", height: "calc(100% + 200px)", border: 0 }}
        allow="autoplay; encrypted-media"
        scrolling="no"
      />
    </div>
  );
};

const VideoPlayer = ({ item }: { item: VideosContent["items"][number] }) => {
  const raw = item.video_url ?? "";

  if (isInstagramUrl(raw)) {
    return (
      <div className="flex flex-col gap-3">
        <InstagramEmbed url={raw} />
        {item.title && (
          <p className="font-display text-base text-center" style={{ color: "var(--text-primary)" }}>
            {item.title}
          </p>
        )}
      </div>
    );
  }

  const embed = toEmbedUrl(raw);
  const loopingEmbed = toLoopingEmbedUrl(embed);

  return (
    <div className="flex flex-col gap-3">
      <div
        className="aspect-[9/16] overflow-hidden"
        style={{ background: "var(--color-forest-dark)", borderRadius: "var(--radius-card)" }}
      >
        {embed && isEmbedUrl(embed) ? (
          <iframe
            src={loopingEmbed}
            title={item.title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : embed && isDirectVideo(embed) ? (
          <video
            src={embed}
            className="w-full h-full object-cover"
            autoPlay
            loop
            muted
            playsInline
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3" style={{ color: "rgba(245,239,230,0.3)" }}>
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-sans text-xs">Add a video URL in admin — YouTube, Vimeo, Instagram, or a direct .mp4 link</p>
          </div>
        )}
      </div>
      {item.title && (
        <p className="font-display text-base text-center" style={{ color: "var(--text-primary)" }}>
          {item.title}
        </p>
      )}
    </div>
  );
};

const VideosSection = ({ data }: Props) => {
  const items = data.items ?? [];

  // One reel at a time on a phone, three across on desktop. A 2-up mobile grid
  // squeezed each 9:16 reel to ~150px and wrapped the odd one onto its own row,
  // which read as a vertical stack rather than a set.
  const isMobile  = useIsMobile();
  const perView   = isMobile ? 1 : Math.min(3, Math.max(items.length, 1));
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, items.length - perView);
  const canPrev   = offset > 0;
  const canNext   = offset < maxOffset;
  const paged     = items.length > perView;

  // Rotating the phone changes how many fit; don't strand the window past the end.
  useEffect(() => { setOffset(o => Math.min(o, maxOffset)); }, [maxOffset]);

  const swipe = useSwipe({
    onSwipeLeft:  () => setOffset(o => Math.min(o + 1, maxOffset)),
    onSwipeRight: () => setOffset(o => Math.max(o - 1, 0)),
    enabled: paged,
  });

  const visible = items.slice(offset, offset + perView);

  return (
    <section id="journal" style={{ background: "var(--bg-videos)" }} className="py-20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <span
            className="pill-tag inline-block mb-3"
            style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
          >
            {data.label ? <RichText text={data.label} /> : "as seen on"}
          </span>
          <h2
            className="h-display"
            style={{ fontSize: "var(--text-display-lg)", color: "var(--text-primary)" }}
          >
            {data.headline ? <RichText text={data.headline} /> : "catch our vibe ✨"}
          </h2>
          {data.subtext && (
            <p className="font-sans text-sm mt-3 max-w-md mx-auto" style={{ color: "var(--text-muted)" }}>
              <RichText text={data.subtext} />
            </p>
          )}
        </div>

        {/* Counter + arrows — only when there's more than one screenful */}
        {paged && (
          <div className="flex items-center justify-between mb-4 max-w-xs sm:max-w-none mx-auto">
            <p className="font-sans text-xs" style={{ color: "var(--text-muted)" }}>
              {offset + 1}–{Math.min(offset + perView, items.length)} of {items.length}
            </p>
            <div className="flex gap-2">
              {[
                { dir: -1, active: canPrev, label: "←", aria: "Previous videos" },
                { dir:  1, active: canNext, label: "→", aria: "Next videos" },
              ].map(({ dir, active, label, aria }) => (
                <motion.button
                  key={label}
                  onClick={() => { if (active) setOffset(o => Math.min(Math.max(o + dir, 0), maxOffset)); }}
                  whileHover={active ? { scale: 1.12 } : {}}
                  whileTap={active ? { scale: 0.9 } : {}}
                  aria-label={aria}
                  disabled={!active}
                  style={{
                    width: 40, height: 40, borderRadius: "50%",
                    border: `1.5px solid ${active ? "var(--color-forest-dark)" : "rgba(29,43,27,0.22)"}`,
                    background: active ? "rgba(29,43,27,0.08)" : "transparent",
                    color: active ? "var(--color-forest-dark)" : "rgba(29,43,27,0.28)",
                    cursor: active ? "pointer" : "default",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1rem", fontWeight: 600,
                  }}
                >
                  {label}
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Reels — swipeable on touch, arrows above are the pointer equivalent */}
        <div
          {...swipe}
          className={`grid gap-6 items-start ${perView === 1 ? "max-w-xs mx-auto" : ""}`}
          style={{ gridTemplateColumns: `repeat(${perView}, minmax(0, 1fr))`, ...swipe.style }}
        >
          {visible.map((item, i) => (
            <VideoPlayer key={item.id ?? offset + i} item={item} />
          ))}
        </div>

        {/* Dots — small dot, finger-sized button around it */}
        {paged && (
          <div className="flex items-center justify-center mt-2">
            {Array.from({ length: maxOffset + 1 }).map((_, i) => (
              <button
                key={i}
                onClick={() => setOffset(i)}
                aria-label={`Show video ${i + 1} of ${maxOffset + 1}`}
                aria-current={i === offset}
                style={{ border: "none", background: "none", cursor: "pointer", padding: "10px 3px", display: "flex", alignItems: "center" }}
              >
                <motion.span
                  animate={{ width: i === offset ? 18 : 6, background: i === offset ? "var(--color-forest-dark)" : "rgba(29,43,27,0.25)" }}
                  style={{ height: 6, borderRadius: 3, display: "block", width: i === offset ? 18 : 6, background: i === offset ? "var(--color-forest-dark)" : "rgba(29,43,27,0.25)" }}
                  transition={{ duration: 0.25 }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default VideosSection;
