import React from "react";
// Static brand-tagline section — cream background, Permanent Marker font
const SmellsLikeSection = () => (
  <section
    className="w-full flex items-center justify-center py-16 px-6"
    style={{ background: "#f0e8d6" }}
  >
    <div className="relative text-center select-none">
      {/* Pink bow */}
      <span
        className="absolute text-4xl sm:text-5xl pointer-events-none"
        style={{ top: "-0.6em", right: "18%", transform: "rotate(-10deg)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.08))" }}
        aria-hidden
      >🎀</span>

      {/* Extra Gen-Z stickers */}
      <span className="absolute pointer-events-none" style={{ top: "-0.9em", left: "8%", fontSize: "2rem", transform: "rotate(12deg)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))" }} aria-hidden>⭐</span>
      <span className="absolute pointer-events-none" style={{ bottom: "-1em", right: "6%", fontSize: "1.6rem", transform: "rotate(-8deg)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))" }} aria-hidden>✨</span>
      <span className="absolute pointer-events-none" style={{ bottom: "-0.8em", left: "18%", fontSize: "1.5rem", transform: "rotate(6deg)", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.1))" }} aria-hidden>🌸</span>
      <span className="absolute pointer-events-none" style={{ top: "-0.5em", left: "38%", fontSize: "1.2rem", transform: "rotate(-5deg)", opacity: 0.8 }} aria-hidden>💅</span>

      <h2
        className="font-sketch leading-tight"
        style={{
          fontSize: "clamp(2rem, 6vw, 4.2rem)",
          color: "#3d2410",
          letterSpacing: "0.04em",
        }}
      >
        SMELLS LIKE YOUR
        <br />
        CAFé ERA.
      </h2>
    </div>
  </section>
);

export default SmellsLikeSection;
