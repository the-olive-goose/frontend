import { useEffect, useRef, useState } from "react";

/**
 * CoffeePourHero
 * An SVG scene where coffee pours from a drip machine into a glass jar,
 * which morphs into a candle — complete with flickering flame and steam.
 * Runs entirely in CSS + SVG; no external dependencies.
 */
const CoffeePourHero = () => {
  const [phase, setPhase] = useState<"idle" | "pouring" | "candle" | "done">("idle");
  const rafRef = useRef<number>(0);
  const fillRef = useRef<SVGRectElement>(null);
  const streamRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    // Short delay then kick off pour
    const t1 = setTimeout(() => setPhase("pouring"), 600);
    const t2 = setTimeout(() => setPhase("candle"), 3200);
    const t3 = setTimeout(() => setPhase("done"), 4200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Animated fill level (0 → 1)
  const fillProgress = useRef(0);
  useEffect(() => {
    if (phase !== "pouring") return;
    const start = performance.now();
    const dur = 2200;
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1);
      // ease-out cubic
      fillProgress.current = 1 - Math.pow(1 - p, 3);
      if (fillRef.current) {
        const maxH = 72; // max fill height in SVG units
        const h = fillProgress.current * maxH;
        fillRef.current.setAttribute("height", String(h));
        fillRef.current.setAttribute("y", String(196 - h));
      }
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  const isPouring = phase === "pouring";
  const isCandle  = phase === "candle" || phase === "done";
  const isDone    = phase === "done";

  return (
    <div className="relative flex items-center justify-center select-none" aria-hidden="true">
      {/* Ambient warm glow behind the scene */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isCandle
            ? "radial-gradient(ellipse 60% 50% at 50% 70%, hsl(35 90% 55% / 0.22) 0%, transparent 70%)"
            : "radial-gradient(ellipse 50% 40% at 50% 60%, hsl(25 70% 30% / 0.15) 0%, transparent 70%)",
          transition: "background 1.8s ease",
        }}
      />

      <svg
        viewBox="0 0 280 300"
        className="w-full max-w-xs sm:max-w-sm relative z-10"
        style={{ filter: "drop-shadow(0 20px 40px hsl(220 10% 5% / 0.5))" }}
      >
        <defs>
          {/* Clip path for jar fill */}
          <clipPath id="jar-clip">
            <path d="M98 124 L88 196 Q88 200 92 200 L188 200 Q192 200 192 196 L182 124 Z" />
          </clipPath>

          {/* Coffee liquid gradient */}
          <linearGradient id="coffee-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="hsl(25 60% 28%)" />
            <stop offset="100%" stopColor="hsl(20 50% 20%)" />
          </linearGradient>

          {/* Candle wax gradient */}
          <linearGradient id="wax-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="hsl(40 70% 88%)" />
            <stop offset="100%" stopColor="hsl(35 55% 78%)" />
          </linearGradient>

          {/* Flame gradient */}
          <radialGradient id="flame-grad" cx="50%" cy="80%" r="50%">
            <stop offset="0%"   stopColor="hsl(50 100% 90%)" />
            <stop offset="40%"  stopColor="hsl(35 100% 65%)" />
            <stop offset="100%" stopColor="hsl(15 90% 45%)"  stopOpacity="0" />
          </radialGradient>

          {/* Inner flame highlight */}
          <radialGradient id="flame-inner" cx="50%" cy="75%" r="40%">
            <stop offset="0%"  stopColor="hsl(55 100% 95%)" />
            <stop offset="100%" stopColor="hsl(45 100% 70%)" stopOpacity="0" />
          </radialGradient>

          {/* Jar glass gradient */}
          <linearGradient id="jar-glass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="hsl(200 30% 80% / 0.12)" />
            <stop offset="30%"  stopColor="hsl(200 20% 90% / 0.06)" />
            <stop offset="70%"  stopColor="hsl(200 20% 90% / 0.06)" />
            <stop offset="100%" stopColor="hsl(200 30% 80% / 0.18)" />
          </linearGradient>

          {/* Machine body gradient */}
          <linearGradient id="machine-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="hsl(220 12% 22%)" />
            <stop offset="100%" stopColor="hsl(220 10% 14%)" />
          </linearGradient>

          {/* Stream gradient */}
          <linearGradient id="stream-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="hsl(25 65% 32%)" />
            <stop offset="100%" stopColor="hsl(22 55% 26%)" />
          </linearGradient>

          {/* Candle highlight */}
          <linearGradient id="candle-highlight" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.0)" />
            <stop offset="30%"  stopColor="rgba(255,255,255,0.18)" />
            <stop offset="70%"  stopColor="rgba(255,255,255,0.05)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.0)" />
          </linearGradient>
        </defs>

        {/* ── COFFEE MACHINE ─────────────────────────────────────────── */}
        <g>
          {/* Machine body */}
          <rect x="85" y="20" width="110" height="80" rx="10" fill="url(#machine-grad)" />
          {/* Machine top accent */}
          <rect x="85" y="20" width="110" height="8" rx="5" fill="hsl(220 12% 28%)" />
          {/* Portafilter handle */}
          <rect x="96" y="92" width="88" height="12" rx="6" fill="hsl(220 10% 18%)" />
          {/* Drip spout */}
          <rect x="133" y="104" width="14" height="18" rx="3" fill="hsl(220 10% 18%)" />
          {/* Spout tip */}
          <ellipse cx="140" cy="122" rx="6" ry="3" fill="hsl(220 8% 16%)" />
          {/* Machine display */}
          <rect x="100" y="30" width="30" height="18" rx="3" fill="hsl(180 40% 20%)" />
          <rect x="102" y="32" width="26" height="14" rx="2" fill="hsl(175 50% 30% / 0.8)" />
          {/* Power button */}
          <circle cx="158" cy="40" r="7" fill="hsl(220 10% 18%)" />
          <circle cx="158" cy="40" r="4" fill={isPouring || isCandle ? "hsl(120 50% 40%)" : "hsl(0 0% 30%)"} />
          <circle cx="158" cy="40" r="4"
            fill="transparent"
            style={{
              opacity: isPouring ? 0.7 : 0,
              filter: "blur(4px)",
              transition: "opacity 0.4s",
            }}
          />
          {/* Knob */}
          <circle cx="176" cy="55" r="8" fill="hsl(220 10% 20%)" />
          <circle cx="176" cy="55" r="5" fill="hsl(35 60% 45%)" />
          {/* Drip tray */}
          <rect x="92" y="200" width="96" height="8" rx="4" fill="hsl(220 10% 18%)" />
          <rect x="96" y="203" width="88" height="3" rx="1" fill="hsl(220 8% 25%)" />
        </g>

        {/* ── POUR STREAM ────────────────────────────────────────────── */}
        {isPouring && (
          <g>
            {/* Main stream */}
            <path
              ref={streamRef}
              d="M138 122 C137 135, 136 148, 137 162 C138 176, 139 184, 140 190"
              fill="none"
              stroke="url(#stream-grad)"
              strokeWidth="5"
              strokeLinecap="round"
              className="animate-pour-stream"
            />
            {/* Stream highlight */}
            <path
              d="M139 122 C138.5 135, 138 148, 138.5 162 C139 176, 139.5 184, 140 190"
              fill="none"
              stroke="hsl(35 50% 60% / 0.4)"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="animate-pour-stream"
              style={{ animationDelay: "0.05s" }}
            />
            {/* Falling drops */}
            <circle cx="140" cy="135" r="2.5" fill="hsl(25 55% 30%)" className="animate-drop-1" />
            <circle cx="139" cy="130" r="2"   fill="hsl(25 55% 30%)" className="animate-drop-2" />
            <circle cx="141" cy="128" r="1.5" fill="hsl(25 55% 30%)" className="animate-drop-3" />
          </g>
        )}

        {/* ── JAR / GLASS VESSEL ─────────────────────────────────────── */}
        <g>
          {/* Jar outline */}
          <path
            d="M98 124 L88 196 Q88 204 96 204 L184 204 Q192 204 192 196 L182 124 Z"
            fill={isCandle ? "url(#wax-grad)" : "hsl(200 15% 85% / 0.08)"}
            stroke={isCandle ? "hsl(35 40% 75%)" : "hsl(200 20% 70% / 0.35)"}
            strokeWidth="1.5"
            style={{ transition: "fill 1.2s ease, stroke 1.2s ease" }}
          />

          {/* Liquid fill (coffee) — hidden once it's a candle */}
          {!isCandle && (
            <g clipPath="url(#jar-clip)">
              <rect
                ref={fillRef}
                x="88" y="196" width="104" height="0"
                fill="url(#coffee-grad)"
              />
              {/* Coffee surface shimmer */}
              <ellipse cx="140" cy="196" rx="52" ry="4"
                fill="hsl(25 50% 38% / 0.6)"
                style={{
                  transform: `translateY(-${fillProgress.current * 72}px)`,
                  transition: "none",
                }}
              />
            </g>
          )}

          {/* Jar glass sheen overlay */}
          <path
            d="M98 124 L88 196 Q88 204 96 204 L184 204 Q192 204 192 196 L182 124 Z"
            fill="url(#jar-glass)"
          />

          {/* Jar top rim */}
          <rect x="94" y="120" width="92" height="8" rx="4"
            fill={isCandle ? "hsl(35 35% 72%)" : "hsl(200 15% 72% / 0.5)"}
            style={{ transition: "fill 1.2s ease" }}
          />

          {/* Jar label band */}
          {isCandle && (
            <g className="animate-candle">
              <rect x="104" y="148" width="72" height="32" rx="4"
                fill="hsl(40 30% 92% / 0.9)" />
              <rect x="104" y="148" width="72" height="32" rx="4"
                fill="none" stroke="hsl(35 25% 68%)" strokeWidth="0.8" />
              {/* Label text lines (decorative) */}
              <line x1="112" y1="158" x2="168" y2="158" stroke="hsl(30 25% 55%)" strokeWidth="1" strokeLinecap="round" />
              <line x1="116" y1="164" x2="164" y2="164" stroke="hsl(30 25% 65%)" strokeWidth="0.7" strokeLinecap="round" />
              <line x1="120" y1="169" x2="160" y2="169" stroke="hsl(30 25% 65%)" strokeWidth="0.7" strokeLinecap="round" />
            </g>
          )}

          {/* Wax drip on candle side */}
          {isCandle && (
            <path
              d="M172 128 Q174 138, 173 148 Q172 154 170 156"
              fill="none"
              stroke="hsl(38 60% 84%)"
              strokeWidth="4"
              strokeLinecap="round"
              className="animate-wax-drip"
            />
          )}
        </g>

        {/* ── CANDLE WICK ────────────────────────────────────────────── */}
        {isCandle && (
          <line
            x1="140" y1="120" x2="140" y2="108"
            stroke="hsl(25 40% 30%)"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="animate-candle"
          />
        )}

        {/* ── FLAME ──────────────────────────────────────────────────── */}
        {isCandle && (
          <g className="animate-candle">
            {/* Outer flame glow */}
            <circle cx="140" cy="96" r="22"
              fill="hsl(35 90% 55% / 0.15)"
              className="animate-flame-glow"
            />
            {/* Flame body */}
            <g className="animate-flame" style={{ transformOrigin: "140px 108px" }}>
              <path
                d="M140 108 C134 100, 128 88, 133 76 C136 68, 138 62, 140 56 C142 62, 144 68, 147 76 C152 88, 146 100, 140 108 Z"
                fill="url(#flame-grad)"
              />
              {/* Inner flame highlight */}
              <path
                d="M140 105 C137 100, 134 92, 136 84 C137.5 78, 139 74, 140 70 C141 74, 142.5 78, 144 84 C146 92, 143 100, 140 105 Z"
                fill="url(#flame-inner)"
              />
            </g>
          </g>
        )}

        {/* ── STEAM ──────────────────────────────────────────────────── */}
        {isDone && (
          <g>
            <path d="M132 55 Q128 45, 132 35 Q136 25, 132 15"
              fill="none" stroke="hsl(200 15% 85% / 0.5)" strokeWidth="1.5" strokeLinecap="round"
              className="animate-steam-1"
            />
            <path d="M140 50 Q136 40, 140 30 Q144 20, 140 10"
              fill="none" stroke="hsl(200 15% 85% / 0.4)" strokeWidth="1.5" strokeLinecap="round"
              className="animate-steam-2"
            />
            <path d="M148 55 Q152 45, 148 35 Q144 25, 148 15"
              fill="none" stroke="hsl(200 15% 85% / 0.5)" strokeWidth="1.5" strokeLinecap="round"
              className="animate-steam-3"
            />
          </g>
        )}

        {/* ── FLOOR SHADOW ───────────────────────────────────────────── */}
        <ellipse cx="140" cy="210" rx="52" ry="6"
          fill="hsl(220 10% 5% / 0.3)"
        />
      </svg>

      {/* Warm light cast on floor */}
      {isCandle && (
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-40 h-12 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 50% 100%, hsl(35 90% 55% / 0.25) 0%, transparent 70%)",
            transition: "opacity 2s ease",
          }}
        />
      )}
    </div>
  );
};

export default CoffeePourHero;
