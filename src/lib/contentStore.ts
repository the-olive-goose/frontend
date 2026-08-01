import { fetchWithTimeout } from './fetchTimeout';
import { API_URL } from './apiBase';

/**
 * Session cache for admin-editable content.
 *
 * Before this existed, every page seeded its state with the bundled DEFAULT_*
 * copy, painted it, and swapped in the real values when its own fetch landed —
 * so the storefront flashed placeholder text (a €65 free-shipping bar that had
 * been deleted months earlier, headings nobody had used in a year) on every
 * mount, and re-fetched the same sections on every navigation.
 *
 * The store fixes both halves:
 *   - `peekContent` distinguishes "not known yet" (render a skeleton) from
 *     "known" (render it), so defaults are never mistaken for data.
 *   - one bulk prime fills every section, and the values are reused for the rest
 *     of the session, so navigation renders correct copy on the first frame.
 *
 * Deliberately in-module memory only — no sessionStorage. Several e2e specs
 * PUT content and then `page.goto(...)` expecting the new value; they rely on a
 * document load starting from an empty cache.
 */

// Raw server values, keyed by section. `null` means "the server has no row for
// this section" — a known answer, not a miss, so callers stop waiting on it.
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

let primePromise: Promise<void> | null = null;
// True once the bulk fetch has succeeded — after that, a section missing from
// the cache genuinely has no stored value, so its fallback IS the answer.
let bulkLoaded = false;

/**
 * How a stored value combines with its fallback. Mirrors what `getContent` did
 * inline: an array replaces the fallback wholesale (element order and length are
 * the admin's), an object merges over it so a newly added field still has a
 * sensible value on rows saved before that field existed.
 */
export const mergeSection = <T>(fallback: T, raw: unknown): T => {
  if (raw === null || raw === undefined) return fallback;
  if (Array.isArray(fallback)) return raw as T;
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw as T;
  if (typeof fallback !== 'object' || fallback === null) return raw as T;
  return { ...fallback, ...(raw as object) } as T;
};

/**
 * The section's value if it is already known, else `undefined`.
 *
 * `undefined` is the signal to render a skeleton — it means the answer has not
 * arrived, NOT that the section is empty. An empty section resolves to its
 * fallback, which is a known answer.
 */
export const peekContent = <T>(section: string, fallback: T): T | undefined => {
  if (cache.has(section)) return mergeSection(fallback, cache.get(section));
  if (bulkLoaded) return fallback;
  return undefined;
};

/** True once the bulk prime has resolved (successfully or not). */
export const isContentPrimed = (): boolean => bulkLoaded;

/**
 * One request for every section. Started from main.tsx before React mounts, so
 * it is already in flight while the first render happens.
 *
 * Never rejects: if the endpoint is missing (older backend) or unreachable,
 * callers fall through to the per-section fetch, and that in turn falls back to
 * the bundled defaults. A dead backend must show defaults, not skeletons
 * forever.
 */
export const primeContent = (): Promise<void> => {
  primePromise ??= fetchWithTimeout(`${API_URL}/api/content`)
    .then(async (res) => {
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      for (const [section, value] of Object.entries(data)) cache.set(section, value);
      bulkLoaded = true;
    })
    .catch(() => { /* fall through to per-section fetches */ });
  return primePromise;
};

// Single-section fetch, deduped so ten components asking at once make one call.
// A failed request caches `null` rather than retrying: the caller then gets its
// fallback, which is the same thing the old getContent did on error.
const fetchSection = (section: string): Promise<unknown> => {
  const pending = inflight.get(section);
  if (pending) return pending;

  const request = fetchWithTimeout(`${API_URL}/api/content/${section}`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((raw: unknown) => {
      cache.set(section, raw ?? null);
      inflight.delete(section);
      return raw ?? null;
    });

  inflight.set(section, request);
  return request;
};

/** The section's value, waiting for the prime (and then a direct fetch) as needed. */
export const readContent = async <T>(section: string, fallback: T): Promise<T> => {
  const cached = peekContent(section, fallback);
  if (cached !== undefined) return cached;

  await primeContent();
  const primed = peekContent(section, fallback);
  if (primed !== undefined) return primed;

  return mergeSection(fallback, await fetchSection(section));
};

/**
 * Straight to the server, bypassing the cache — for the admin dashboard, which
 * must always edit live values. The response still refreshes the cache so the
 * storefront half of the session agrees with what the editor just read.
 */
export const readContentFresh = async <T>(section: string, fallback: T): Promise<T> => {
  const raw = await fetchWithTimeout(`${API_URL}/api/content/${section}`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  cache.set(section, raw ?? null);
  return mergeSection(fallback, raw ?? null);
};

/** Keeps the cache in step with a successful save, so an admin sees their own edit. */
export const writeContent = (section: string, value: unknown): void => {
  cache.set(section, value ?? null);
};

/** Test seam — drops everything the session has learned. */
export const resetContentCache = (): void => {
  cache.clear();
  inflight.clear();
  primePromise = null;
  bulkLoaded = false;
};
