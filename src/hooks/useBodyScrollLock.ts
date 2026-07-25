import { useEffect } from "react";

/**
 * Freezes the page behind an open overlay (modal, drawer, expanded nav).
 *
 * Without this, a finger dragged over a modal on a phone scrolls the storefront
 * underneath it, so closing the overlay drops the visitor somewhere they never
 * meant to go. Nested overlays are counted rather than toggled, so closing the
 * topmost one doesn't unfreeze the page while another is still open.
 */
let lockCount = 0;
let restoreOverflow = "";

const useBodyScrollLock = (active: boolean) => {
  useEffect(() => {
    if (!active) return;

    if (lockCount === 0) {
      restoreOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = restoreOverflow;
    };
  }, [active]);
};

export default useBodyScrollLock;
