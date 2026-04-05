import { useEffect, useState } from "react";

interface CountdownTimerProps {
  targetDate: string;
}

const CountdownTimer = ({ targetDate }: CountdownTimerProps) => {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const target = new Date(targetDate).getTime();

    const update = () => {
      const now = Date.now();
      const diff = Math.max(0, target - now);
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  const units = [
    { label: "Days", value: timeLeft.days },
    { label: "Hours", value: timeLeft.hours },
    { label: "Minutes", value: timeLeft.minutes },
    { label: "Seconds", value: timeLeft.seconds },
  ];

  return (
    <div className="flex gap-4 sm:gap-6 justify-center animate-fade-up-delay-3">
      {units.map((unit) => (
        <div key={unit.label} className="text-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-foreground/5 backdrop-blur-sm border border-primary-foreground/10 flex items-center justify-center mb-2">
            <span className="font-serif text-2xl sm:text-3xl text-primary-foreground font-light">
              {String(unit.value).padStart(2, "0")}
            </span>
          </div>
          <span className="text-primary-foreground/50 text-xs font-sans uppercase tracking-widest">
            {unit.label}
          </span>
        </div>
      ))}
    </div>
  );
};

export default CountdownTimer;
