const BADGES = [
  { icon: "🔒", label: "Secure checkout" },
  { icon: "🔐", label: "Encrypted payment" },
  { icon: "↩️", label: "30-day returns" },
];

const TrustBadges = ({ compact = false }: { compact?: boolean }) => (
  <div className={`flex flex-wrap justify-center ${compact ? "gap-x-3 gap-y-1" : "gap-x-5 gap-y-2"}`}>
    {BADGES.map(b => (
      <span key={b.label} className="font-sans text-xs flex items-center gap-1 whitespace-nowrap" style={{ color: "#555" }}>
        <span aria-hidden>{b.icon}</span>{b.label}
      </span>
    ))}
  </div>
);

export default TrustBadges;
