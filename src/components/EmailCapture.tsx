import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const EmailCapture = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from("subscribers")
        .insert({ email: email.trim().toLowerCase() });

      if (error) {
        if (error.code === "23505") {
          toast({
            title: "Already on the list",
            description: "This email is already registered. We'll be in touch!",
          });
        } else {
          throw error;
        }
      } else {
        setIsSuccess(true);
        setEmail("");
      }
    } catch {
      toast({
        title: "Something went wrong",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="animate-fade-up text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
          <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="font-serif text-2xl text-primary-foreground mb-2">You're on the list</h3>
        <p className="text-primary-foreground/70 text-sm font-sans">
          We'll notify you when we launch. Something beautiful awaits.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="animate-fade-up-delay-2 w-full max-w-md mx-auto">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          required
          className="flex-1 px-5 py-3.5 rounded-lg bg-foreground/5 backdrop-blur-sm border border-primary-foreground/20 text-primary-foreground placeholder:text-primary-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent transition-all duration-300 font-sans text-sm"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-8 py-3.5 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium tracking-wider uppercase hover:bg-olive-light transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-primary/20"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
              </svg>
              Joining...
            </span>
          ) : (
            "Join the Waiting List"
          )}
        </button>
      </div>
    </form>
  );
};

export default EmailCapture;
