import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Client-side navigation keeps whatever scroll offset the reader was at, so a
 * link that sits low on a page — the maker block's "Our Story" button, say —
 * opens the next page halfway down, past its heading. Reset to the top on
 * forward navigation, and leave back/forward alone so the browser can restore
 * where the reader actually was. Hash links keep their own anchor behaviour.
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    if (hash || navigationType === "POP") return;
    window.scrollTo(0, 0);
  }, [pathname, hash, navigationType]);

  return null;
};

export default ScrollToTop;
