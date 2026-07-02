import { DEFAULT_FREE_SHIPPING_THRESHOLD } from "@/lib/cart";

const FreeShippingBar = ({
  subtotal,
  threshold = DEFAULT_FREE_SHIPPING_THRESHOLD,
  compact = false,
}: {
  subtotal: number;
  threshold?: number;
  compact?: boolean;
}) => {
  const remaining = Math.max(0, threshold - subtotal);
  const qualified = remaining <= 0;
  const pct = threshold > 0 ? Math.min(100, (subtotal / threshold) * 100) : 100;

  return (
    <div>
      <p className={`font-sans ${compact ? "text-xs" : "text-sm"} font-semibold mb-1.5`} style={{ color: qualified ? "#007600" : "#0F1111" }}>
        {qualified ? "🎉 You've unlocked FREE shipping!" : `You're €${remaining.toFixed(2)} away from FREE shipping`}
      </p>
      <div className="w-full rounded-full overflow-hidden" style={{ height: compact ? 5 : 7, background: "#e8e8e8" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: qualified ? "#007600" : "#e77600", transitionDuration: "400ms" }}
        />
      </div>
    </div>
  );
};

export default FreeShippingBar;
