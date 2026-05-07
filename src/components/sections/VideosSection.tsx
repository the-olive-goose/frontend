import { VideosContent, toEmbedUrl, isEmbedUrl, isDirectVideo } from "@/lib/defaults";

interface Props { data: VideosContent }

const VideoPlayer = ({ item }: { item: VideosContent["items"][number] }) => {
  const embed = toEmbedUrl(item.video_url);

  return (
    <div className="space-y-4">
      {/* Video frame */}
      <div className="aspect-video rounded-2xl overflow-hidden bg-charcoal/10">
        {embed && isEmbedUrl(embed) ? (
          <iframe
            src={embed}
            title={item.title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : embed && isDirectVideo(embed) ? (
          <video src={embed} controls className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-charcoal/30">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-sans text-xs">Paste a video URL in admin</p>
          </div>
        )}
      </div>

      {/* Caption */}
      <div>
        <h3 className="font-serif text-lg text-charcoal">{item.title}</h3>
        {item.description && (
          <p className="font-sans text-sm text-charcoal/55 mt-1">{item.description}</p>
        )}
      </div>
    </div>
  );
};

const VideosSection = ({ data }: Props) => {
  const items = data.items ?? [];
  return (
  <section id="journal" className="bg-background py-24 lg:py-32">
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="text-center mb-16 space-y-4">
        <p className="font-sans text-xs tracking-[0.2em] uppercase text-primary font-medium">
          {data.label}
        </p>
        <h2 className="font-serif text-4xl sm:text-5xl text-charcoal">{data.headline}</h2>
        {data.subtext && (
          <p className="font-sans text-base text-charcoal/60 max-w-xl mx-auto leading-relaxed">
            {data.subtext}
          </p>
        )}
      </div>

      {/* Video grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {items.map((item, i) => (
          <VideoPlayer key={item.id ?? i} item={item} />
        ))}
      </div>
    </div>
  </section>
  );
};

export default VideosSection;
