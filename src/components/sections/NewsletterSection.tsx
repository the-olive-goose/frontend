import { useState } from "react";
import { NewsletterContent } from "@/lib/defaults";
import { subscribe } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Props { data: NewsletterContent }

const NewsletterSection = ({ data }: Props) => {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    try {
      await subscribe(email);
      setStatus("done");
      setEmail("");
      toast({ title: "You're in!", description: "Thanks for subscribing." });
    } catch (err: unknown) {
      setStatus("idle");
      const error = err as { code?: string };
      if (error.code === "23505") {
        toast({ title: "Already subscribed", description: "You're already on the list!" });
      } else {
        toast({ title: "Something went wrong", variant: "destructive" });
      }
    }
  };

  return (
    <section className="bg-primary py-24 lg:py-32">
      <div className="max-w-3xl mx-auto px-6 text-center space-y-6">
        <p className="font-sans text-xs tracking-[0.2em] uppercase text-primary-foreground/60 font-medium">
          {data.label}
        </p>
        <h2 className="font-serif text-4xl sm:text-5xl text-primary-foreground leading-tight">
          {data.headline}
        </h2>
        {data.subtext && (
          <p className="font-sans text-base text-primary-foreground/70 max-w-md mx-auto leading-relaxed">
            {data.subtext}
          </p>
        )}

        {status === "done" ? (
          <div className="flex items-center justify-center gap-3 py-4">
            <svg className="w-6 h-6 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="font-sans text-primary-foreground font-medium">You're on the list!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 mt-4 max-w-md mx-auto">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={data.placeholder}
              required
              className="flex-1 px-5 py-3 rounded-full bg-primary-foreground/10 border border-primary-foreground/20 text-primary-foreground placeholder:text-primary-foreground/40 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary-foreground/30"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="px-7 py-3 rounded-full bg-primary-foreground text-primary font-sans text-sm font-medium hover:bg-cream-dark transition-all disabled:opacity-60 shrink-0"
            >
              {status === "loading" ? "..." : data.cta_text}
            </button>
          </form>
        )}
      </div>
    </section>
  );
};

export default NewsletterSection;
