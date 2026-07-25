import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { submitFeedback, uploadImage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import useBodyScrollLock from "@/hooks/useBodyScrollLock";

interface Props {
  open: boolean;
  onClose: () => void;
}

const Star = ({ filled, onClick }: { filled: boolean; onClick: () => void }) => (
  <button type="button" onClick={onClick}
    className="transition-transform hover:scale-110 active:scale-95"
    style={{ fontSize: "2rem", color: filled ? "#f0c14b" : "#ddd", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>
    {filled ? "★" : "☆"}
  </button>
);

const FeedbackModal = ({ open, onClose }: Props) => {
  const { user } = useAuth();
  useBodyScrollLock(open);
  const [rating,    setRating]    = useState(5);
  const [name,      setName]      = useState(user?.full_name?.trim() || user?.email?.split("@")[0] || "");
  const [email,     setEmail]     = useState(user?.email ?? "");
  const [message,   setMessage]   = useState("");
  const [photoUrl,  setPhotoUrl]  = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting,setSubmitting]= useState(false);
  const [done,      setDone]      = useState(false);
  const [error,     setError]     = useState("");
  const fileRef  = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setRating(5); setMessage(""); setPhotoUrl("");
        setDone(false); setError(""); setUploading(false);
      }, 300);
    }
  }, [open]);

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try { setPhotoUrl(await uploadImage(file)); }
    catch { setError("Photo upload failed — you can still submit without it."); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (!message.trim()) { setError("Please write your feedback."); return; }
    setSubmitting(true);
    try {
      await submitFeedback({ name: name.trim(), email: email.trim(), rating, message: message.trim(), photo_url: photoUrl });
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={overlayRef}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center p-4 overflow-y-auto overscroll-contain"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={e => { if (e.target === overlayRef.current) onClose(); }}>

          {/* Scrolls within the overlay rather than being clipped — the review
              form is taller than a phone screen once the keyboard is up. */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="relative w-full max-w-lg my-auto rounded-2xl overflow-hidden"
            style={{ background: "#fdf6ef", boxShadow: "0 32px 80px rgba(0,0,0,0.28)" }}>

            {/* Paper grain */}
            <div style={{ position: "absolute", inset: 0, backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`, pointerEvents: "none", zIndex: 0 }} />

            {/* Tape */}
            <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%) rotate(-2deg)", width: 68, height: 24, background: "rgba(255,220,120,0.65)", borderRadius: 3, zIndex: 10, boxShadow: "0 2px 5px rgba(0,0,0,0.1)", border: "1px solid rgba(255,255,255,0.4)" }} />

            {/* Close */}
            <button onClick={onClose}
              className="absolute top-4 right-5 font-sans text-2xl font-light text-gray-400 hover:text-gray-700 transition-colors z-20"
              style={{ lineHeight: 1 }}>×</button>

            <div className="relative z-10 px-8 pt-9 pb-8">
              {done ? (
                <div className="text-center py-6 space-y-4">
                  <div style={{ fontSize: "3rem" }}>🕯️</div>
                  <h2 style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "2rem", color: "#6b3520" }}>Thank you!</h2>
                  <p style={{ fontFamily: "'Permanent Marker',cursive", fontSize: "0.82rem", color: "rgba(30,20,10,0.55)", transform: "rotate(-0.8deg)" }}>
                    Your feedback lights up our day ✨
                  </p>
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={onClose}
                    style={{ fontFamily: "'Fredoka',sans-serif", fontWeight: 600, background: "#6b3520", color: "#fff", border: "none", borderRadius: 50, padding: "10px 28px", cursor: "pointer", fontSize: "0.95rem", boxShadow: "0 4px 16px rgba(107,53,32,0.35)", marginTop: 8 }}>
                    Close
                  </motion.button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Heading */}
                  <div className="text-center mb-2">
                    <h2 style={{ fontFamily: "'Fredoka',sans-serif", fontSize: "1.9rem", color: "#6b3520", lineHeight: 1, marginBottom: 4 }}>
                      Share Your Experience
                    </h2>
                    <p style={{ fontFamily: "'Permanent Marker',cursive", fontSize: "0.72rem", color: "rgba(30,20,10,0.5)", transform: "rotate(-0.8deg)" }}>
                      🕯️ we'd love to hear from you 🕯️
                    </p>
                  </div>

                  {/* Star rating */}
                  <div className="flex flex-col items-center gap-1">
                    <p style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.78rem", color: "rgba(30,20,10,0.55)", fontWeight: 500 }}>How would you rate us?</p>
                    <div className="flex">
                      {[1,2,3,4,5].map(n => <Star key={n} filled={n <= rating} onClick={() => setRating(n)} />)}
                    </div>
                  </div>

                  {/* Name + Email */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-sans text-xs font-medium mb-1" style={{ color: "#3b1a0a" }}>Name</label>
                      <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
                        className="w-full px-3 py-2.5 font-sans text-sm rounded-lg outline-none"
                        style={{ background: "#fff", border: "1px solid rgba(107,53,32,0.25)", color: "#111" }} />
                    </div>
                    <div>
                      <label className="block font-sans text-xs font-medium mb-1" style={{ color: "#3b1a0a" }}>Email <span style={{ color: "rgba(30,20,10,0.4)" }}>(optional)</span></label>
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com"
                        className="w-full px-3 py-2.5 font-sans text-sm rounded-lg outline-none"
                        style={{ background: "#fff", border: "1px solid rgba(107,53,32,0.25)", color: "#111" }} />
                    </div>
                  </div>

                  {/* Message */}
                  <div>
                    <label className="block font-sans text-xs font-medium mb-1" style={{ color: "#3b1a0a" }}>Your feedback <span style={{ color: "#c0572a" }}>*</span></label>
                    <textarea value={message} onChange={e => setMessage(e.target.value)}
                      placeholder="Tell us what you loved about your candle…"
                      rows={4} className="w-full px-3 py-2.5 font-sans text-sm rounded-lg outline-none resize-none"
                      style={{ background: "#fff", border: "1px solid rgba(107,53,32,0.25)", color: "#111" }} />
                  </div>

                  {/* Photo upload */}
                  <div>
                    <label className="block font-sans text-xs font-medium mb-2" style={{ color: "#3b1a0a" }}>Photo <span style={{ color: "rgba(30,20,10,0.4)" }}>(optional)</span></label>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg font-sans text-sm font-medium transition-all hover:opacity-80 disabled:opacity-50"
                        style={{ background: "rgba(107,53,32,0.12)", color: "#6b3520", border: "1.5px solid rgba(107,53,32,0.3)" }}>
                        {uploading ? "Uploading…" : (
                          <>
                            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                            </svg>
                            Upload photo
                          </>
                        )}
                      </button>
                      {photoUrl && (
                        <div className="flex items-center gap-2">
                          <img src={photoUrl} alt="preview" className="w-12 h-12 rounded-lg object-cover" />
                          <button type="button" onClick={() => setPhotoUrl("")} className="text-xs text-red-500 hover:underline">Remove</button>
                        </div>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                  </div>

                  {error && <p className="font-sans text-sm rounded-lg px-3 py-2" style={{ background: "#fff3cd", color: "#856404", border: "1px solid #ffc107" }}>{error}</p>}

                  <motion.button type="submit" disabled={submitting}
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    className="w-full py-3 font-sans font-bold text-sm rounded-full transition-all disabled:opacity-50"
                    style={{ background: "#6b3520", color: "#fff", boxShadow: "0 4px 16px rgba(107,53,32,0.35)", borderRadius: 50 }}>
                    {submitting ? "Submitting…" : "Submit Feedback"}
                  </motion.button>
                </form>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FeedbackModal;
