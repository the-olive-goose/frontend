import React from "react";
import { MomentPillContent } from "@/lib/defaults";

interface Props { data: MomentPillContent }

const InlineImage = ({ src, alt }: { src: string; alt: string }) => (
  <span
    className="inline-block align-middle mx-2 overflow-hidden shrink-0"
    style={{
      width: "72px",
      height: "38px",
      borderRadius: "100px",
      background: "#c8d8b0",
      verticalAlign: "middle",
    }}
  >
    {src ? (
      <img src={src} alt={alt} className="w-full h-full object-cover" />
    ) : (
      <span className="w-full h-full flex items-center justify-center text-xs" style={{ color: "#1D2B1B" }}>
        img
      </span>
    )}
  </span>
);

const MomentPillSection = ({ data }: Props) => (
  <section
    className="w-full flex items-center justify-center py-14 px-6"
    style={{ background: "#a5ba85" }}
  >
    {/* The pill */}
    <div
      className="w-full max-w-3xl flex flex-wrap items-center justify-center gap-y-1 px-8 py-8"
      style={{
        background: "#ffffff",
        borderRadius: "100px",
        border: "2px solid #1D2B1B",
        lineHeight: 1.5,
      }}
    >
      <p
        className="font-sans text-center w-full"
        style={{ fontSize: "clamp(1rem, 2.5vw, 1.25rem)", color: "#1D2B1B" }}
      >
        {data.text1}
        <InlineImage src={data.image1_url} alt="moment" />
        {data.text2}
        <InlineImage src={data.image2_url} alt="nature" />
      </p>
      <p
        className="font-sans text-center w-full"
        style={{ fontSize: "clamp(1rem, 2.5vw, 1.25rem)", color: "#1D2B1B" }}
      >
        {data.text3}
      </p>
    </div>
  </section>
);

export default MomentPillSection;
