/**
 * A working `localStorage` / `sessionStorage` for tests.
 *
 * This jsdom build ships without Web Storage — the globals exist but hold
 * `undefined`, and Node prints "localStorage is not available because
 * --localstorage-file was not provided". That matters more than it sounds:
 * storefront code treats a throwing store as "can't tell, do nothing", so
 * without this every storage-gated test passes for the wrong reason — the
 * feature is skipped, not exercised.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  [key: string]: unknown;
}

/** Installs both stores if the environment lacks them. Idempotent. */
export const installMemoryStorage = () => {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    // The property exists but holds undefined, so an `in` check isn't enough.
    if (!globalThis[name]) {
      Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true });
    }
  }
};
