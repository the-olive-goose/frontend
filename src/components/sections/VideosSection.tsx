import { VideosContent, toEmbedUrl, isEmbedUrl, isDirectVideo } from "@/lib/defaults";

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

  return (
    <section id="journal" style={{ background: "var(--bg-videos)" }} className="py-20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <span
            className="pill-tag inline-block mb-3"
            style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
          >
            {data.label || "as seen on"}
          </span>
          <h2
            className="h-display"
            style={{ fontSize: "var(--text-display-lg)", color: "var(--text-primary)" }}
          >
            {data.headline || "catch our vibe ✨"}
          </h2>
          {data.subtext && (
            <p className="font-sans text-sm mt-3 max-w-md mx-auto" style={{ color: "var(--text-muted)" }}>
              {data.subtext}
            </p>
          )}
        </div>

        <div className={`grid gap-6 items-start ${
          items.length === 1 ? "grid-cols-1 max-w-xs mx-auto" :
          items.length === 2 ? "grid-cols-2 max-w-lg mx-auto" :
          "grid-cols-2 sm:grid-cols-3"
        }`}>
          {items.map((item, i) => (
            <VideoPlayer key={item.id ?? i} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default VideosSection;
