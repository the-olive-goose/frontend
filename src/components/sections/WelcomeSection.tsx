import React from "react";
import { WelcomeClubContent } from "@/lib/defaults";

interface Props { data: WelcomeClubContent }

const WelcomeSection = ({ data }: Props) => (
  <section
    id="story"
    className="w-full py-20 px-6"
    style={{ background: "#a5ba85" }}
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
            background: "#8fa672",
            border: "3px solid rgba(255,255,255,0.5)",
          }}
        >
          {data.photo_url ? (
            <img
              src={data.photo_url}
              alt="Founder"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs font-sans" style={{ color: "rgba(255,255,255,0.6)" }}>
              Add photo<br />in admin
            </div>
          )}
        </div>
      </div>

      {/* Text — center/right */}
      <div className="flex flex-col items-center md:items-start text-center md:text-left gap-5">
        {/* Headline in Pacifico with wide letter-spacing */}
        <h2
          className="font-display leading-tight"
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2.6rem)",
            color: "#ffffff",
            letterSpacing: "0.06em",
          }}
        >
          {data.headline}
        </h2>

        {/* Name line */}
        <p
          className="font-sans font-light"
          style={{
            fontSize: "clamp(0.85rem, 2vw, 1.05rem)",
            color: "rgba(255,255,255,0.9)",
            letterSpacing: "0.12em",
            maxWidth: "600px",
          }}
        >
          {data.name_line}
        </p>

        {/* Bio */}
        <p
          className="font-sans font-light"
          style={{
            fontSize: "clamp(0.82rem, 1.8vw, 0.97rem)",
            color: "rgba(255,255,255,0.75)",
            letterSpacing: "0.1em",
            maxWidth: "580px",
          }}
        >
          {data.bio}
        </p>

        {/* CTA */}
        <a
          href={data.cta_href || "#"}
          className="mt-2 inline-flex items-center justify-center px-10 py-3 font-sans text-sm font-medium transition-all hover:bg-white hover:text-[#1D2B1B]"
          style={{
            borderRadius: "100px",
            border: "1.5px solid #ffffff",
            color: "#ffffff",
            letterSpacing: "0.05em",
          }}
        >
          {data.cta_text}
        </a>
      </div>
    </div>
  </section>
);

export default WelcomeSection;
