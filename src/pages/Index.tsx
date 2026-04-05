import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";
import heroBg from "@/assets/hero-bg.jpg";
import EmailCapture from "@/components/EmailCapture";
import CountdownTimer from "@/components/CountdownTimer";

interface HeroSettings {
  headline: string;
  subtext: string;
  cta_text: string;
  show_countdown: boolean;
  launch_date: string | null;
}

const defaultHero: HeroSettings = {
  headline: "Something beautiful is coming",
  subtext: "Handcrafted candles designed to elevate your space",
  cta_text: "Join the Waiting List",
  show_countdown: false,
  launch_date: null,
};

const Index = () => {
  const [hero, setHero] = useState<HeroSettings>(defaultHero);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "hero")
        .single();

      if (data?.value) {
        setHero(data.value as unknown as HeroSettings);
      }
      setLoaded(true);
    };
    fetchSettings();
  }, []);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-charcoal">
        <img
          src={logo}
          alt="The Olive Goose"
          className="w-24 h-24 animate-logo-reveal"
          width={512}
          height={512}
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${heroBg})` }}
      />

      {/* Dark Overlay */}
      <div className="absolute inset-0 bg-charcoal/70" />

      {/* Warm Glow Effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-warm-glow/10 blur-[120px] animate-glow-pulse pointer-events-none" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-1/3 bg-gradient-to-t from-warm-glow/5 to-transparent pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 w-full max-w-2xl mx-auto px-6 py-20 text-center">
        {/* Logo */}
        <div className="animate-logo-reveal mb-10">
          <img
            src={logo}
            alt="The Olive Goose"
            className="w-28 h-28 sm:w-36 sm:h-36 mx-auto drop-shadow-2xl"
            width={512}
            height={512}
          />
        </div>

        {/* Headline */}
        <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-primary-foreground font-light leading-tight mb-6 animate-fade-up text-glow tracking-tight">
          {hero.headline}
        </h1>

        {/* Subtext */}
        <p className="font-sans text-base sm:text-lg text-primary-foreground/70 mb-10 animate-fade-up-delay-1 max-w-lg mx-auto leading-relaxed">
          {hero.subtext}
        </p>

        {/* Countdown */}
        {hero.show_countdown && hero.launch_date && (
          <div className="mb-10">
            <CountdownTimer targetDate={hero.launch_date} />
          </div>
        )}

        {/* Email Capture */}
        <EmailCapture />

        {/* Shimmer Line */}
        <div className="mt-16 animate-shimmer h-px w-48 mx-auto opacity-30" />
      </div>

      {/* Footer */}
      <footer className="absolute bottom-6 left-0 right-0 text-center">
        <p className="text-primary-foreground/30 text-xs font-sans tracking-widest uppercase">
          © {new Date().getFullYear()} The Olive Goose
        </p>
      </footer>
    </div>
  );
};

export default Index;
