import { useEffect, useRef, useState } from "react";
import { peekContent, readContent } from "@/lib/contentStore";

/**
 * Reads one admin-editable content section.
 *
 * `ready` is the important half. It is false only while the value is genuinely
 * unknown — render a skeleton then, never the fallback, because the fallback is
 * bundled placeholder copy and showing it is exactly the flash this replaces.
 * Once the session has the section cached (which after the boot prime is almost
 * always), `ready` is true on the very first frame, so navigating between pages
 * shows no skeleton at all.
 *
 * `data` is always safe to read: it is the fallback until the real value lands,
 * so layout and prop types never have to cope with undefined.
 */
export function useContent<T>(section: string, fallback: T): { data: T; ready: boolean } {
  // The fallback is usually an inline object literal, so it is a new reference
  // every render — pin it to keep it out of the effect's dependencies.
  const fallbackRef = useRef(fallback);
  const [value, setValue] = useState<T | undefined>(() => peekContent(section, fallbackRef.current));

  useEffect(() => {
    if (peekContent(section, fallbackRef.current) !== undefined) return;
    let cancelled = false;
    readContent(section, fallbackRef.current).then((loaded) => {
      if (!cancelled) setValue(loaded);
    });
    return () => { cancelled = true; };
  }, [section]);

  return { data: value ?? fallbackRef.current, ready: value !== undefined };
}

/**
 * The same contract for a page that needs several sections at once. `ready` is
 * all-or-nothing on purpose: a page that filled its heading but not its body
 * would pop in line by line, which reads as broken.
 */
export function useContentSections<T extends Record<string, unknown>>(
  fallbacks: T
): { data: T; ready: boolean } {
  const fallbacksRef = useRef(fallbacks);
  const sections = useRef(Object.keys(fallbacksRef.current)).current;

  const peekAll = (): T | undefined => {
    const out = {} as T;
    for (const section of sections) {
      const value = peekContent(section, fallbacksRef.current[section]);
      if (value === undefined) return undefined;
      out[section as keyof T] = value as T[keyof T];
    }
    return out;
  };

  const [value, setValue] = useState<T | undefined>(peekAll);

  useEffect(() => {
    if (peekAll() !== undefined) return;
    let cancelled = false;
    Promise.all(
      sections.map((section) => readContent(section, fallbacksRef.current[section]))
    ).then((loaded) => {
      if (cancelled) return;
      const out = {} as T;
      sections.forEach((section, i) => { out[section as keyof T] = loaded[i] as T[keyof T]; });
      setValue(out);
    });
    return () => { cancelled = true; };
    // `sections` is captured once from the first render's keys — the set of
    // sections a page reads is fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  return { data: value ?? fallbacksRef.current, ready: value !== undefined };
}
