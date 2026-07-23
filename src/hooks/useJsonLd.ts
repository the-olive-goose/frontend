import { useEffect } from "react";
import { setJsonLd } from "@/lib/seo";

/**
 * Inject a JSON-LD structured-data block for the lifetime of the calling page.
 * `data` may be null while content is still loading — the script is only
 * written once real data exists, and is removed when the page unmounts.
 */
export function useJsonLd(id: string, data: object | object[] | null) {
  const serialized = data === null ? null : JSON.stringify(data);

  useEffect(() => {
    if (serialized !== null) setJsonLd(id, JSON.parse(serialized));
    return () => setJsonLd(id, null);
  }, [id, serialized]);
}
