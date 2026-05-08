import { useEffect, useState } from "react";
import type { HeroSettings } from "@/lib/api";

interface ScarcityBarProps {
  settings: HeroSettings;
}

const ScarcityBar = ({ settings }: ScarcityBarProps) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  const total     = settings.batch_total   ?? 150;
  const claimed   = settings.batch_claimed ?? 87;
  const pct       = Math.min((claimed / total) * 100, 100);
  const batchName = settings.batch_name ?? "Batch 01";

  return (
    <div
      className={`w-full transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}
    >
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "hsl(220 14% 11% / 0.88)",
          border: "1px solid hsl(38 30% 45% / 0.16)",
          boxShadow: "0 4px 28px hsl(220 10% 4% / 0.45), inset 0 1px 0 hsl(40 45% 75% / 0.07)",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Top accent shimmer */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, hsl(35 75% 52% / 0.45), transparent)" }}
        />

        <div className="px-5 py-4 sm:px-6">
          {/* Row: batch label + claimed count */}
          <div className="flex items-center justify-between mb-2.5 gap-2">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
              <span
                className="font-sans text-xs uppercase tracking-[0.16em] font-medium"
                style={{ color: "hsl(38 78% 60%)" }}
              >
                {batchName} — Limited batch
              </span>
            </div>
            <span className="font-sans text-sm" style={{ color: "hsl(40 20% 75%)" }}>
              <span className="font-semibold" style={{ color: "hsl(42 80% 65%)" }}>{claimed}</span>
              <span style={{ color: "hsl(40 15% 45%)" }}> / {total} claimed</span>
            </span>
          </div>

          {/* Progress bar */}
          <div
            className="relative h-1.5 rounded-full overflow-hidden mb-2.5"
            style={{ background: "hsl(220 12% 20%)" }}
          >
            <div
              className="h-full rounded-full animate-progress"
              style={{
                width: `${pct}%`,
                background: "linear-gradient(90deg, hsl(28 65% 40%), hsl(35 82% 55%), hsl(44 88% 63%))",
                boxShadow: "0 0 8px hsl(35 78% 52% / 0.55)",
              }}
            />
          </div>

          {/* FOMO microcopy */}
          <p
            className="font-sans text-xs uppercase tracking-widest"
            style={{ color: "hsl(40 15% 42%)" }}
          >
            Not restocked · First drop only · Early access
          </p>
        </div>
      </div>
    </div>
  );
};

export default ScarcityBar;
