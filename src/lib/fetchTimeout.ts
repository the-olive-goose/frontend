// Railway can cold-start or hang under load; plain `fetch` has no timeout of its
// own, so a slow backend would otherwise spin the UI forever instead of failing
// fast with an actionable error.
const DEFAULT_TIMEOUT_MS = 10_000;

export class RequestTimeoutError extends Error {
  constructor() {
    super('Request timed out — check your connection and try again.');
    this.name = 'RequestTimeoutError';
  }
}

export const fetchWithTimeout = async (
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new RequestTimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
  }
};
