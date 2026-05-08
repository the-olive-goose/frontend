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
    <section className="py-24 lg:py-32" style={{ background: "var(--bg-newsletter)" }}>
      <div className="max-w-3xl mx-auto px-6 text-center space-y-6">
        <p className="eyebrow" style={{ color: "rgba(245,239,230,0.6)" }}>{data.label}</p>
        <h2
          className="font-serif leading-tight"
          style={{ fontSize: "var(--text-serif-lg)", color: "var(--text-on-dark)" }}
        >
          {data.headline}
        </h2>
        {data.subtext && (
          <p
            className="font-sans text-base max-w-md mx-auto leading-relaxed"
            style={{ color: "var(--text-muted-on-dark)" }}
          >
            {data.subtext}
          </p>
        )}

        {status === "done" ? (
          <div className="flex items-center justify-center gap-3 py-4">
            <svg className="w-6 h-6" style={{ color: "var(--text-on-dark)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="font-sans font-medium" style={{ color: "var(--text-on-dark)" }}>You're on the list!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 mt-4 max-w-md mx-auto">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={data.placeholder}
              required
              className="flex-1 font-sans text-sm focus:outline-none focus:ring-2"
              style={{
                padding: "12px 20px",
                borderRadius: "var(--radius-input)",
                background: "rgba(245,239,230,0.1)",
                border: "1px solid rgba(245,239,230,0.2)",
                color: "var(--text-on-dark)",
              }}
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="font-sans text-sm font-medium transition-all disabled:opacity-60 shrink-0"
              style={{
                padding: "12px 28px",
                borderRadius: "var(--radius-pill)",
                background: "var(--color-cream-button)",
                color: "var(--color-forest-dark)",
                letterSpacing: "var(--tracking-cta)",
              }}
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
