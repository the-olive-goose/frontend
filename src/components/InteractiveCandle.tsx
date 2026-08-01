import { AnimatePresence, motion } from "framer-motion";

export type CandleStage = "wrapped" | "ready" | "lit" | "blown";

interface InteractiveCandleProps {
  imageUrl: string;
  stage: CandleStage;
  /** Where the wick meets the wax in the artwork, as a % of the visible frame. */
  wickX: number;
  wickY: number;
  /** True for the couple of seconds after the flame is blown out. */
  smoking: boolean;
}

/** Feathers the photo into the card instead of framing it, so the candle sits in the scene. */
const PHOTO_MASK = "radial-gradient(60% 57% at 50% 47%, #000 40%, rgba(0,0,0,0.5) 70%, transparent 88%)";

/** Fades the char out at its edges so it reads as soot on the wax, not a patch stuck on the photo. */
const CHAR_MASK = "radial-gradient(50% 50% at 50% 50%, #000 40%, rgba(0,0,0,0.6) 66%, transparent 92%)";

/**
 * InteractiveCandle
 * The candle artwork with a flame that burns at the wick itself — the visible wick
 * is charred over and swallowed by the flame, the wax around it catches the light,
 * and blowing it out leaves a wisp of smoke behind.
 */
const InteractiveCandle = ({ imageUrl, stage, wickX, wickY, smoking }: InteractiveCandleProps) => {
  const isLit = stage === "lit";
  const wasBurnt = stage === "lit" || stage === "blown";
  const anchor = { left: `${wickX}%`, top: `${wickY}%` };

  return (
    <div className="relative h-[200px] w-[180px]" aria-hidden="true">
      {/* Warm bloom thrown onto the card behind the candle */}
      <AnimatePresence>
        {isLit && (
          <motion.span
            key="bloom"
            initial={{ opacity: 0, scale: 0.55 }}
            animate={{ opacity: [0.85, 1, 0.9, 1], scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ opacity: { duration: 3.1, repeat: Infinity, ease: "easeInOut" }, scale: { duration: 0.75, ease: "easeOut" }, default: { duration: 0.6 } }}
            className="pointer-events-none absolute block h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ ...anchor, background: "radial-gradient(circle, rgba(255,199,104,0.42) 0%, rgba(255,171,60,0.16) 36%, rgba(255,166,54,0) 68%)" }}
          />
        )}
      </AnimatePresence>

      {/* Contact shadow so the jar sits on something rather than floating */}
      <span className="pointer-events-none absolute bottom-[8px] left-1/2 block h-6 w-[120px] -translate-x-1/2 rounded-[50%] blur-md" style={{ background: "rgba(9,20,13,0.45)" }} />

      <div className="absolute inset-0" style={{ maskImage: PHOTO_MASK, WebkitMaskImage: PHOTO_MASK }}>
        {imageUrl ? (
          <img src={imageUrl} alt="The Olive Goose iced latte candle" className="h-full w-full object-cover object-center" style={{ filter: "brightness(0.93) saturate(0.95)" }} />
        ) : (
          <div className="grid h-full place-items-center text-4xl">☕</div>
        )}
        {/* Blend the photo's own backdrop into the dark card */}
        <span className="pointer-events-none absolute inset-0 block" style={{ background: "radial-gradient(58% 55% at 50% 47%, transparent 26%, rgba(26,48,34,0.6) 62%, rgba(23,45,32,1) 90%)" }} />
        <span className="pointer-events-none absolute inset-0 block" style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.14), transparent 40%, rgba(20,38,26,0.3))" }} />
        {/* The photo's own wick, charred over. Without this the pale wick in the artwork
            survives the flame and reads as a second, unburnt wick beside the drawn one. */}
        <AnimatePresence>
          {wasBurnt && (
            <motion.span
              key="char"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="pointer-events-none absolute block h-[24px] w-[16px]"
              style={{
                left: `${wickX}%`,
                top: `${wickY}%`,
                transform: "translate(-50%, -100%) translateY(3px)",
                backdropFilter: "blur(3px) brightness(0.3) saturate(0.55)",
                WebkitBackdropFilter: "blur(3px) brightness(0.3) saturate(0.55)",
                background: "radial-gradient(48% 46% at 50% 52%, rgba(12,9,5,0.55), rgba(12,9,5,0.2) 60%, transparent 85%)",
                maskImage: CHAR_MASK,
                WebkitMaskImage: CHAR_MASK,
              }}
            />
          )}
        </AnimatePresence>

        {/* Candlelight falling on the wax and glass, brightest at the wick */}
        <motion.span
          className="pointer-events-none absolute inset-0 block"
          style={{ background: `radial-gradient(72px 82px at ${wickX}% ${wickY}%, rgba(255,206,120,0.55), rgba(255,174,64,0.2) 44%, transparent 74%)`, mixBlendMode: "screen" }}
          initial={false}
          animate={{ opacity: isLit ? [0.88, 1, 0.92, 1] : 0 }}
          transition={isLit ? { duration: 1.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.55, ease: "easeOut" }}
        />
      </div>

      {/* The wick: charred once it has been lit, with the flame growing out of it */}
      <div className="pointer-events-none absolute z-10" style={anchor}>
        <AnimatePresence>
          {wasBurnt && (
            <motion.span
              key="wick"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="absolute bottom-[-1px] left-[-1.25px] block h-[13px] w-[2.5px] rotate-[-3deg] rounded-full"
              style={{ transformOrigin: "bottom center", background: "linear-gradient(#141009 0%, #241a12 55%, #4a3626 100%)" }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isLit && (
            <>
              {/* Ignition spark */}
              <motion.span
                key="spark"
                initial={{ opacity: 0.95, scale: 0.2 }}
                animate={{ opacity: 0, scale: 2.6 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
                className="absolute bottom-[2px] left-[-9px] block h-[18px] w-[18px] rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,247,214,0.95) 0%, rgba(255,190,80,0.55) 45%, transparent 72%)" }}
              />
              <motion.span
                key="flame"
                initial={{ opacity: 0, scaleX: 0.35, scaleY: 0.12 }}
                animate={{ opacity: 1, scaleX: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleX: 0.45, scaleY: 0.15, rotate: -22, x: 5, transition: { duration: 0.42, ease: "easeIn" } }}
                transition={{ duration: 0.5, ease: "backOut" }}
                className="absolute bottom-[-2px] left-[-9px] block h-[38px] w-[18px] origin-bottom"
              >
                {/* Two loops at different speeds so the flicker never looks mechanical */}
                <motion.span
                  animate={{ rotate: [0, 1.8, -1.4, 0.8, 0], x: [0, 0.6, -0.5, 0] }}
                  transition={{ duration: 2.35, repeat: Infinity, ease: "easeInOut" }}
                  className="block h-full w-full origin-bottom"
                >
                  <motion.span
                    animate={{ scaleY: [1, 1.13, 0.94, 1.05, 1], scaleX: [1, 0.95, 1.04, 0.98, 1] }}
                    transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut" }}
                    className="block h-full w-full origin-bottom"
                  >
                    <svg viewBox="0 0 20 40" className="h-full w-full" style={{ filter: "drop-shadow(0 0 6px rgba(255,176,56,0.85))" }}>
                      <defs>
                        <linearGradient id="og-flame-body" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#fff6cd" />
                          <stop offset="42%" stopColor="#f9c452" />
                          <stop offset="100%" stopColor="#e2661f" />
                        </linearGradient>
                        <linearGradient id="og-flame-core" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#fffdf2" />
                          <stop offset="100%" stopColor="#ffe093" />
                        </linearGradient>
                      </defs>
                      <path d="M10 1c1 9.4 8.5 13.2 8.5 23.6 0 8-3.9 14.4-8.5 14.4S1.5 32.6 1.5 24.6C1.5 15 9 10.4 10 1Z" fill="url(#og-flame-body)" opacity="0.94" />
                      <path d="M10 14.5c.6 5.4 4.2 7.8 4.2 13.4 0 5-1.9 8.6-4.2 8.6s-4.2-3.6-4.2-8.6c0-5.6 3.6-8 4.2-13.4Z" fill="url(#og-flame-core)" opacity="0.92" />
                      <ellipse cx="10" cy="36" rx="4.4" ry="3" fill="#8ec5ff" opacity="0.42" style={{ mixBlendMode: "screen" }} />
                    </svg>
                  </motion.span>
                </motion.span>
              </motion.span>
            </>
          )}
        </AnimatePresence>

        {/* Ember still glowing on the wick, then smoke curling off it */}
        <AnimatePresence>
          {smoking && (
            <>
              <motion.span
                key="ember"
                initial={{ opacity: 0.8, scale: 1 }}
                animate={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 1.1, ease: "easeOut" }}
                className="absolute bottom-[8px] left-[-6px] block h-[12px] w-[12px] rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,150,52,0.85) 0%, rgba(255,120,40,0.25) 55%, transparent 75%)" }}
              />
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={`smoke-${i}`}
                  initial={{ opacity: 0, y: 0, x: 0, scale: 0.45 }}
                  animate={{ opacity: [0, 0.42, 0.26, 0], y: -62 - i * 12, x: [0, i % 2 ? 7 : -6, i % 2 ? -4 : 5, i % 2 ? 9 : -8], scale: 1.9 }}
                  transition={{ duration: 1.9, delay: i * 0.22, ease: "easeOut" }}
                  className="absolute bottom-[6px] left-[-7px] block h-[14px] w-[14px] rounded-full blur-[5px]"
                  style={{ background: "radial-gradient(circle, rgba(233,231,222,0.75) 0%, rgba(206,204,196,0.32) 55%, transparent 78%)" }}
                />
              ))}
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default InteractiveCandle;
