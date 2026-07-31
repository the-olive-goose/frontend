import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type SiteContent } from "@/lib/defaults";
import FooterSection from "@/components/sections/FooterSection";
import PageHero from "@/components/PageHero";
import RichText from "@/lib/richtext";
import { useJsonLd } from "@/hooks/useJsonLd";
import { breadcrumbJsonLd } from "@/lib/seo";

const FounderDiaryPage = () => {
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
  const [candleStage, setCandleStage] = useState<"wrapped" | "ready" | "lit" | "blown">("wrapped");
  const [openPhoto, setOpenPhoto] = useState<number | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const diaryRef = useRef<HTMLElement>(null);

  useJsonLd("breadcrumb", breadcrumbJsonLd([["Home", "/"], ["About", "/about"], ["Founder Diary", "/our-story"]]));

  useEffect(() => {
    const load = async () => {
      try {
        const [announcementBar, navbar, ourStoryPage, footer] = await Promise.all([
          getContent("announcementBar", DEFAULT_CONTENT.announcementBar),
          getContent("navbar", DEFAULT_CONTENT.navbar),
          getContent("ourStoryPage", DEFAULT_CONTENT.ourStoryPage),
          getContent("footer", DEFAULT_CONTENT.footer),
        ]);
        setContent((prev) => ({ ...prev, announcementBar, navbar, ourStoryPage, footer }));
      } catch {
        /* fall back to defaults */
      }
    };
    load();
  }, []);

  const page = content.ourStoryPage;
  const diaryPhotos = page.photos.filter((photo) => photo.image_url);
  const candlePrompt = {
    wrapped: { title: page.candle_wrapped_title, action: page.candle_wrapped_action, note: page.candle_wrapped_note },
    ready: { title: page.candle_ready_title, action: page.candle_ready_action, note: page.candle_ready_note },
    lit: { title: page.candle_lit_title, action: page.candle_lit_action, note: page.candle_lit_note },
    blown: { title: page.diary_headline, action: "", note: "" },
  }[candleStage];
  const isDiaryRevealed = candleStage === "blown";

  useEffect(() => {
    if (!isDiaryRevealed) return;
    setCelebrating(true);
    const scrollTimer = window.setTimeout(() => {
      diaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 700);
    const celebrationTimer = window.setTimeout(() => setCelebrating(false), 2500);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(celebrationTimer);
    };
  }, [isDiaryRevealed]);

  const advanceCandle = () => {
    setCandleStage((stage) => stage === "wrapped" ? "ready" : stage === "ready" ? "lit" : stage === "lit" ? "blown" : "ready");
  };

  return (
    <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>
      <PageHero
        eyebrow={page.label}
        title={page.page_title}
        titleGold={page.page_title_gold}
        subtitle={page.page_subtitle}
      />

      <section className="max-w-6xl mx-auto px-6 sm:px-12 pt-[var(--page-body-pt)] pb-12 sm:pb-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.95fr] lg:items-center">
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2 font-display text-xs tracking-[0.14em] uppercase" style={{ color: "var(--color-forest-dark)" }}>
              {page.intro_tag_primary && <span className="rounded-full px-3 py-1.5" style={{ background: "var(--color-sage-pale)" }}><RichText text={page.intro_tag_primary} /></span>}
              {page.intro_tag_secondary && <span className="rounded-full px-3 py-1.5" style={{ background: "rgba(222,178,94,0.2)" }}><RichText text={page.intro_tag_secondary} /></span>}
            </div>
            <h2 className="font-display font-semibold" style={{ fontSize: "clamp(2rem,4vw,3.5rem)", color: "var(--color-forest-dark)", lineHeight: 1.04 }}>
              <RichText text={page.intro_headline} /> {page.intro_headline_gold && <span style={{ color: "var(--color-gold)" }}><RichText text={page.intro_headline_gold} /></span>}
            </h2>
            <div className="space-y-4">
              {page.intro.split("\n\n").map((para, index) => (
                <p key={index} className="font-sans text-base leading-relaxed" style={{ color: "rgba(30,41,24,0.72)" }}>
                  <RichText text={para} />
                </p>
              ))}
            </div>
            {page.intro_hint && <p className="font-display text-sm" style={{ color: "var(--color-sage-light)" }}><RichText text={page.intro_hint} /></p>}
          </div>

          <motion.div
            layout
            className="relative min-h-[410px] overflow-hidden rounded-[2rem] border p-5 sm:p-7"
            style={{ background: "linear-gradient(145deg, #35533c 0%, #213d2b 58%, #172d20 100%)", borderColor: "rgba(222,178,94,0.35)", boxShadow: candleStage === "lit" ? "0 24px 70px rgba(222,178,94,0.28)" : "0 20px 50px rgba(30,41,24,0.18)" }}
          >
            <div className="absolute -right-10 -top-12 h-44 w-44 rounded-full opacity-30 blur-2xl" style={{ background: "var(--color-gold)" }} />
            {page.candle_label && <p className="relative font-display text-xs uppercase tracking-[0.2em]" style={{ color: "var(--color-gold)" }}><RichText text={page.candle_label} /></p>}
            <p className="relative mt-2 max-w-[15rem] font-display text-2xl leading-tight" style={{ color: "var(--color-cream-text)" }}>{candlePrompt.title}</p>

            <button
              type="button"
              onClick={isDiaryRevealed ? undefined : advanceCandle}
              aria-label={candlePrompt.action || "Candle has been blown out"}
              disabled={isDiaryRevealed}
              className="group relative mx-auto mt-5 block h-60 w-56 cursor-pointer rounded-[2rem] outline-none focus-visible:ring-4 focus-visible:ring-amber-200"
            >
              <AnimatePresence mode="wait">
                {candleStage === "wrapped" ? (
                  <motion.div key="wrapped" initial={{ opacity: 0, rotate: -4, scale: 0.9 }} animate={{ opacity: 1, rotate: -2, scale: 1 }} exit={{ opacity: 0, y: 24, rotate: 5 }} className="absolute inset-x-4 bottom-4 top-7 rounded-2xl border-2 border-dashed p-4 shadow-xl" style={{ background: "#f4e4bd", borderColor: "#bc8a4a" }}>
                    <div className="flex h-full rotate-[-2deg] items-center justify-center rounded-xl border text-center font-display text-lg" style={{ color: "#6b3520", borderColor: "rgba(107,53,32,0.25)", background: "rgba(255,255,255,0.26)" }}>a candle<br />inside ♡</div>
                    <span className="absolute left-1/2 top-0 h-full w-5 -translate-x-1/2 opacity-50" style={{ background: "#c8834b" }} />
                  </motion.div>
                ) : (
                  <motion.div key="candle" initial={{ opacity: 0, y: 25, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="absolute inset-x-7 bottom-2 flex flex-col items-center">
                    {candleStage === "lit" && (
                      <motion.div animate={{ scaleY: [1, 1.2, 0.9, 1], x: [0, 2, -1, 0] }} transition={{ repeat: Infinity, duration: 1.35 }} className="mb-[-4px] h-16 w-9 rounded-[70%_30%_65%_35%] rounded-bl-[65%]" style={{ background: "linear-gradient(#fff3bd 0%, #f8bd49 47%, #e56c24 100%)", boxShadow: "0 0 42px 17px rgba(255,187,61,0.52)" }} />
                    )}
                    <div className="relative h-[174px] w-[158px] overflow-hidden rounded-[1.4rem] border-[5px] border-[#fff5dc] shadow-2xl" style={{ background: "#ebd2a2", boxShadow: candleStage === "lit" ? "0 18px 42px rgba(255,190,83,0.38)" : "0 18px 36px rgba(0,0,0,0.28)" }}>
                      {page.candle_image_url ? (
                        <img src={page.candle_image_url} alt="The Olive Goose iced latte candle" className="h-full w-full object-cover object-center" />
                      ) : (
                        <div className="grid h-full place-items-center text-4xl">☕</div>
                      )}
                      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.2), transparent 38%, rgba(52,28,11,0.18))" }} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
            {!isDiaryRevealed && <>
              <button type="button" onClick={advanceCandle} className="relative mt-1 flex w-full items-center justify-between rounded-full border px-4 py-3 text-left font-display text-sm transition-transform hover:-translate-y-0.5" style={{ color: "var(--color-cream-text)", borderColor: "rgba(255,255,255,0.28)", background: "rgba(255,255,255,0.1)" }}>
                <span><RichText text={candlePrompt.action} /></span><span aria-hidden="true">{candleStage === "lit" ? "✦" : "→"}</span>
              </button>
              {candlePrompt.note && <p className="relative mt-3 text-center font-sans text-xs" style={{ color: "rgba(245,239,230,0.7)" }}><RichText text={candlePrompt.note} /></p>}
            </>}
          </motion.div>
        </div>
      </section>

      {isDiaryRevealed && <motion.div ref={diaryRef} initial={{ opacity: 0, y: 36 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: "easeOut" }} style={{ scrollMarginTop: "calc(var(--nav-h) + 24px)" }}>
      <section className="max-w-6xl mx-auto px-6 sm:px-12 pb-16 sm:pb-24">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            {page.diary_label && <p className="font-display text-xs uppercase tracking-[0.2em]" style={{ color: "var(--color-sage-light)" }}><RichText text={page.diary_label} /></p>}
            <h2 className="mt-2 font-display text-3xl font-semibold sm:text-4xl" style={{ color: "var(--color-forest-dark)" }}><RichText text={page.diary_headline} /></h2>
          </div>
          {diaryPhotos.length > 0 && page.diary_hint && <p className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.65)" }}><RichText text={page.diary_hint} /></p>}
        </div>

        {diaryPhotos.length > 0 ? (
          <div className="grid auto-rows-[220px] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {diaryPhotos.map((photo, index) => {
              const featured = index % 5 === 0;
              return (
                <motion.button
                  key={photo.id || index}
                  type="button"
                  initial={{ opacity: 0, y: 28, rotate: index % 2 ? 1.5 : -1.5 }}
                  whileInView={{ opacity: 1, y: 0, rotate: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.45, delay: Math.min(index * 0.06, 0.3) }}
                  whileHover={{ y: -7, rotate: index % 2 ? -1 : 1, scale: 1.015 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setOpenPhoto(index)}
                  className={`group relative overflow-hidden rounded-[1.65rem] border text-left shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${featured ? "sm:col-span-2 sm:row-span-2" : ""}`}
                  style={{ borderColor: "rgba(30,41,24,0.12)", background: "var(--color-sage-pale)" }}
                >
                  <img src={photo.image_url} alt={photo.caption || "Founder diary photo"} className="h-full w-full object-cover transition duration-700 group-hover:scale-110" loading="lazy" decoding="async" />
                  <div className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/75 via-black/30 to-transparent p-5 pt-16 transition duration-300 group-hover:translate-y-0">
                    <p className="font-display text-sm leading-snug" style={{ color: "#fff8ea" }}><RichText text={photo.caption || "A little studio moment"} /></p>
                  </div>
                  <span className="absolute right-3 top-3 rounded-full px-2.5 py-1 font-display text-[10px] tracking-[0.14em] opacity-0 transition group-hover:opacity-100" style={{ color: "#25402d", background: "#fff8ea" }}>peek ↗</span>
                </motion.button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[1.65rem] border border-dashed p-10 text-center" style={{ borderColor: "rgba(30,41,24,0.25)", background: "rgba(226,235,214,0.45)" }}>
            <div className="text-4xl">📷</div>
            <p className="mt-3 font-display text-xl" style={{ color: "var(--color-forest-dark)" }}><RichText text={page.diary_empty_message} /></p>
          </div>
        )}
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-20 text-center sm:pb-28">
        <div className="rounded-[2rem] px-6 py-10 sm:px-12" style={{ background: "var(--color-sage-pale)" }}>
          {page.closing_label && <p className="font-display text-xs uppercase tracking-[0.2em]" style={{ color: "var(--color-sage-light)" }}><RichText text={page.closing_label} /></p>}
          <h2 className="mx-auto mt-3 max-w-2xl font-display text-3xl font-semibold sm:text-4xl" style={{ color: "var(--color-forest-dark)" }}><RichText text={page.closing_headline} /></h2>
          <p className="mx-auto mt-4 max-w-xl font-sans leading-relaxed" style={{ color: "rgba(30,41,24,0.72)" }}><RichText text={page.closing_body} /></p>
          {page.cta_text && <Link to={page.cta_href || "/shop"} className="mt-7 inline-flex items-center gap-2 rounded-full px-6 py-3 font-display text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-lg" style={{ color: "var(--color-cream-text)", background: "var(--color-forest-dark)" }}><RichText text={page.cta_text} /> <span aria-hidden="true">→</span></Link>}
        </div>
      </section>
      </motion.div>}

      <AnimatePresence>
        {openPhoto !== null && diaryPhotos[openPhoto] && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Photo diary image" onClick={() => setOpenPhoto(null)}>
            <motion.figure initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} className="relative max-h-full max-w-5xl overflow-hidden rounded-[1.5rem] bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <img src={diaryPhotos[openPhoto].image_url} alt={diaryPhotos[openPhoto].caption || "Founder diary photo"} className="max-h-[75vh] w-full object-contain" />
              <figcaption className="px-5 py-4 pr-14 font-sans text-sm" style={{ color: "var(--color-forest-dark)" }}><RichText text={diaryPhotos[openPhoto].caption || "A little studio moment"} /></figcaption>
              <button type="button" onClick={() => setOpenPhoto(null)} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full font-display text-lg" style={{ color: "var(--color-forest-dark)", background: "rgba(255,255,255,0.88)" }} aria-label="Close photo">×</button>
            </motion.figure>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {celebrating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center overflow-hidden" aria-live="polite" aria-label="Celebration! The photo diary is revealed.">
            {page.celebration_message && <motion.p initial={{ opacity: 0, y: 16, scale: 0.86 }} animate={{ opacity: [0, 1, 1, 0], y: [16, 0, 0, -16], scale: [0.86, 1, 1, 1.08] }} transition={{ duration: 2.15, ease: "easeOut" }} className="relative z-10 w-[min(90vw,30rem)] rounded-full px-6 py-4 text-center font-display text-xl shadow-2xl sm:text-2xl" style={{ color: "var(--color-forest-dark)", background: "#fff8ea" }}><RichText text={page.celebration_message} /></motion.p>}
            {Array.from({ length: 30 }, (_, index) => (
              <motion.span
                key={index}
                initial={{ opacity: 0, scale: 0, x: 0, y: 0, rotate: 0 }}
                animate={{ opacity: [0, 1, 1, 0], scale: [0, 1.35, 0.9, 0.5], x: ((index * 83) % 460) - 230, y: -120 - ((index * 47) % 360), rotate: index % 2 ? 230 : -230 }}
                transition={{ duration: 2.1, delay: (index % 8) * 0.035, ease: "easeOut" }}
                className="absolute left-1/2 top-[58%] text-2xl sm:text-4xl"
                style={{ color: ["#f8bd49", "#f17a5c", "#d7e7bd", "#fff8ea"][index % 4] }}
              >
                {index % 5 === 0 ? "🎉" : index % 3 === 0 ? "✦" : "•"}
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <FooterSection data={content.footer} />
    </div>
  );
};

export default FounderDiaryPage;
