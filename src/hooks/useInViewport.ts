import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Whether the element handed the returned ref is on screen, or close enough to
 * it to be worth paying for.
 *
 * This exists for media that costs real memory to exist at all — a `<video>`
 * holds a decoder and a download whether or not anyone can see it. Gating on
 * "is this section actually on screen" is the difference between a visitor
 * paying for the reel rail when they reach it and paying for it while they are
 * still looking at the hero.
 *
 * Two deliberate choices:
 *
 * - A **callback ref**, not an object ref. The elements this watches are often
 *   rendered only once their content has arrived, and a callback ref fires at
 *   exactly that moment; an effect with an empty dependency list would already
 *   have run, against nothing, and would never look again.
 * - A browser with no IntersectionObserver reports **true**. A missing API must
 *   never be the reason a visitor sees an empty frame — the fallback is the old
 *   behaviour, which was correct, only expensive.
 *
 * The value goes back to false on the way out, so whatever it gates is
 * unmounted again and its memory released.
 */
const useInViewport = (rootMargin = "0px") => {
  const [inView, setInView] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((node: Element | null) => {
    observer.current?.disconnect();
    observer.current = null;

    if (!node) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }

    observer.current = new IntersectionObserver(
      entries => setInView(entries.some(entry => entry.isIntersecting)),
      { rootMargin },
    );
    observer.current.observe(node);
  }, [rootMargin]);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, inView };
};

export default useInViewport;
