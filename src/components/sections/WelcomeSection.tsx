import React from "react";
import { WelcomeClubContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";

interface Props { data: WelcomeClubContent }

const WelcomeSection = ({ data }: Props) => (
  <section
    id="story"
    className="w-full py-20 px-6"
    style={{ background: "var(--bg-welcome)" }}
  >
    <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-10 md:gap-14">

      {/* Circular photo — left */}
      <div className="shrink-0">
        <div
          className="overflow-hidden"
          style={{
            width: "clamp(120px, 18vw, 180px)",
            height: "clamp(120px, 18vw, 180px)",
            borderRadius: "50%",
            background: "var(--color-sage-light)",
            border: "3px solid rgba(255,255,255,0.5)",
          }}
        >
          {data.photo_url ? (
            <img
              src={data.photo_url}
              alt="The founder of The Olive Goose"
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs font-sans" style={{ color: "rgba(255,255,255,0.6)" }}>
              Add photo<br />in admin
            </div>
          )}
        </div>
      </div>

      {/* Text */}
      <div className="flex flex-col items-center md:items-start text-center md:text-left gap-5">
        <h2
          className="font-display leading-tight"
          style={{
            fontSize: "var(--text-display-sm)",
            color: "var(--color-white)",
            letterSpacing: "var(--tracking-nav)",
          }}
        >
          <RichText text={data.headline} />
        </h2>

        <p
          className="font-sans font-light"
          style={{
            fontSize: "clamp(0.85rem, 2vw, 1.05rem)",
            color: "rgba(255,255,255,0.9)",
            letterSpacing: "0.12em",
            maxWidth: "600px",
          }}
        >
          <RichText text={data.name_line} />
        </p>

        <p
          className="font-sans font-light"
          style={{
            fontSize: "clamp(0.82rem, 1.8vw, 0.97rem)",
            color: "var(--text-muted-on-dark)",
            letterSpacing: "0.1em",
            maxWidth: "580px",
          }}
        >
          <RichText text={data.bio} />
        </p>

        <a
          href={data.cta_href || "#"}
          className="mt-2 inline-flex items-center justify-center font-sans text-sm font-medium transition-all hover:bg-white"
          style={{
            borderRadius: "var(--radius-pill)",
            border: "1.5px solid var(--color-white)",
            color: "var(--color-white)",
            letterSpacing: "var(--tracking-cta)",
            padding: "12px 40px",
          }}
        >
          {data.cta_text}
        </a>
      </div>
    </div>
  </section>
);

export default WelcomeSection;
