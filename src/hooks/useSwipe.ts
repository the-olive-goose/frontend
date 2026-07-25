import { useCallback, useRef } from "react";
import type { CSSProperties, MouseEvent, TouchEvent } from "react";

/**
 * Return `false` to decline the swipe — the gesture then carries on to an
 * outer carousel, so swiping past the last card in a row turns the page it
 * sits on instead of dying against the end of the row.
 */
export type SwipeHandler = () => boolean | void;

export interface UseSwipeOptions {
  onSwipeLeft?: SwipeHandler;
  onSwipeRight?: SwipeHandler;
  /** Horizontal travel (px) required before a gesture counts as a swipe. */
  threshold?: number;
  /** Set false to leave the element inert (e.g. a single-page carousel). */
  enabled?: boolean;
}

export interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
  onTouchCancel: () => void;
  onClickCapture: (e: MouseEvent) => void;
  style: CSSProperties;
}

/** Movement (px) before we commit to treating the gesture as horizontal or vertical. */
const AXIS_LOCK = 10;

/**
 * Horizontal swipe detection for touch devices.
 *
 * The first ~10px of travel decide the axis: a mostly-vertical drag is handed
 * straight back to the page so the visitor can keep scrolling, and only a
 * mostly-horizontal one is treated as a swipe. `touch-action: pan-y pinch-zoom`
 * tells the browser the same thing, so vertical scrolling and pinch-to-zoom stay
 * native and smooth while we own the horizontal axis.
 *
 * Nesting works: an inner carousel that recognises a swipe stops the event, so a
 * swipe over the cards moves the cards, and a swipe over the surrounding page
 * moves the page.
 */
const useSwipe = ({
  onSwipeLeft,
  onSwipeRight,
  threshold = 45,
  enabled = true,
}: UseSwipeOptions): SwipeHandlers => {
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"undecided" | "x" | "y">("undecided");
  // Set when a swipe fires, so the tap that ends the gesture doesn't also
  // activate the card/link the finger happened to lift over.
  const justSwiped = useRef(false);

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || e.touches.length !== 1) { start.current = null; return; }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    axis.current = "undecided";
  }, [enabled]);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!start.current || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    if (axis.current === "undecided" && Math.hypot(dx, dy) > AXIS_LOCK) {
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
  }, []);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    const origin = start.current;
    start.current = null;
    if (!origin || axis.current !== "x") return;

    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - origin.x;
    if (Math.abs(dx) < threshold) return;

    const handled = dx < 0 ? onSwipeLeft?.() : onSwipeRight?.();
    if (handled === false) return; // declined — let an ancestor carousel take it

    // Otherwise the swipe belongs to this carousel; no ancestor should also
    // act on it, and the lift-off must not register as a tap.
    e.stopPropagation();
    justSwiped.current = true;
  }, [onSwipeLeft, onSwipeRight, threshold]);

  const onTouchCancel = useCallback(() => { start.current = null; }, []);

  const onClickCapture = useCallback((e: MouseEvent) => {
    if (!justSwiped.current) return;
    justSwiped.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onClickCapture,
    style: { touchAction: enabled ? "pan-y pinch-zoom" : undefined },
  };
};

export default useSwipe;
