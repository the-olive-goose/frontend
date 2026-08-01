import React from "react";
import { Link } from "react-router-dom";
import { WelcomeClubContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { SkelBlock, SkelText } from "@/components/ui/ContentSkeleton";

const pillBase = "inline-flex items-center justify-center font-sans text-sm font-medium transition-all";
const pillLayout: React.CSSProperties = {
  borderRadius: "var(--radius-pill)",
  letterSpacing: "var(--tracking-cta)",
  padding: "12px 40px",
};

// Both buttons in this block are the same solid-white pill. They used to differ:
// the story button was a transparent outline that filled white on hover, so the
// pair read as primary + secondary when they are really two equal ways into the
// same story, and the hover repainted the whole button — a flash against the dark
// section rather than a nudge. Shared here so the two cannot drift apart again.
const pillSolid: React.CSSProperties = {
  ...pillLayout,
  background: "var(--color-white)",
  border: "1.5px solid var(--color-white)",
  color: "var(--color-forest-dark)",
};

// Fade-and-lift, not a colour swap: the fill already carries the button, so hover
// only has to acknowledge the pointer.
const pillHover = "hover:opacity-90 hover:-translate-y-0.5";

interface Props {
  data: WelcomeClubContent;
  /** False while the club copy is still loading. */
  ready?: boolean;
}

const WelcomeSection = ({ data, ready = true }: Props) => (
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
          {!ready ? (
            <SkelBlock radius="50%" style={{ color: "var(--color-white)" }} />
          ) : data.photo_url ? (
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
          {ready ? <RichText text={data.headline} /> : <SkelText width="min(360px,70vw)" lineHeight={1.2} style={{ color: "var(--color-white)" }} />}
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
          {ready ? <RichText text={data.name_line} /> : <SkelText width="min(280px,60vw)" lineHeight={1.4} style={{ color: "var(--color-white)" }} />}
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
          {ready ? <RichText text={data.bio} /> : <SkelText lines={3} width="min(560px,84vw)" lineHeight={1.6} style={{ color: "var(--color-white)" }} />}
        </p>

        {/* Two buttons, one row — they wrap rather than shrink on narrow phones
            so neither label is ever clipped. The diary button is an in-app
            route, so it goes through Link and skips the full page reload. */}
        <div className="mt-2 flex flex-wrap items-center justify-center md:justify-start gap-3">
          {!ready && (
            <>
              <SkelBlock height="45px" width="180px" radius="var(--radius-pill)" style={{ color: "var(--color-white)" }} />
              <SkelBlock height="45px" width="160px" radius="var(--radius-pill)" style={{ color: "var(--color-white)" }} />
            </>
          )}
          {ready && data.diary_cta_text && (
            <Link
              to={data.diary_cta_href || "/our-story"}
              className={`${pillBase} ${pillHover}`}
              style={pillSolid}
            >
              <RichText text={data.diary_cta_text} />
            </Link>
          )}

          {ready && (
            <a
              href={data.cta_href || "#"}
              className={`${pillBase} ${pillHover}`}
              style={pillSolid}
            >
              {data.cta_text}
            </a>
          )}
        </div>
      </div>
    </div>
  </section>
);

export default WelcomeSection;
