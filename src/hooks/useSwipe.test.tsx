import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import useSwipe, { type UseSwipeOptions } from "@/hooks/useSwipe";

/**
 * jsdom has no touch input, so each test plays back the touch sequence a finger
 * would produce: start, a couple of moves, then lift.
 */
const touchList = (x: number, y: number) => [{ clientX: x, clientY: y, identifier: 1 }];

const drag = (el: HTMLElement, { dx, dy = 0 }: { dx: number; dy?: number }) => {
  const [x0, y0] = [200, 200];
  fireEvent.touchStart(el, { touches: touchList(x0, y0) });
  fireEvent.touchMove(el, { touches: touchList(x0 + dx * 0.4, y0 + dy * 0.4) });
  fireEvent.touchMove(el, { touches: touchList(x0 + dx, y0 + dy) });
  fireEvent.touchEnd(el, { changedTouches: touchList(x0 + dx, y0 + dy) });
};

const Row = ({ label = "row", ...options }: UseSwipeOptions & { label?: string }) => {
  const swipe = useSwipe(options);
  return <div {...swipe} data-testid={label} style={swipe.style}>{label}</div>;
};

describe("useSwipe", () => {
  it("reports a left swipe and a right swipe", () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    render(<Row onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />);
    const row = screen.getByTestId("row");

    drag(row, { dx: -120 });
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).not.toHaveBeenCalled();

    drag(row, { dx: 120 });
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it("ignores a mostly-vertical drag so the page keeps scrolling", () => {
    const onSwipeLeft = vi.fn();
    render(<Row onSwipeLeft={onSwipeLeft} />);

    drag(screen.getByTestId("row"), { dx: -60, dy: -200 });
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("ignores travel below the threshold", () => {
    const onSwipeLeft = vi.fn();
    render(<Row onSwipeLeft={onSwipeLeft} threshold={45} />);

    drag(screen.getByTestId("row"), { dx: -30 });
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const onSwipeLeft = vi.fn();
    render(<Row onSwipeLeft={onSwipeLeft} enabled={false} />);

    drag(screen.getByTestId("row"), { dx: -120 });
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  // Asserted on the value the hook hands back rather than on the rendered
  // node: jsdom's CSS parser drops multi-value `touch-action`, though browsers
  // apply it fine.
  it("leaves vertical scrolling and pinch-zoom to the browser", () => {
    const { result } = renderHook(() => useSwipe({ onSwipeLeft: vi.fn() }));
    expect(result.current.style.touchAction).toBe("pan-y pinch-zoom");
  });

  it("claims no touch-action while disabled", () => {
    const { result } = renderHook(() => useSwipe({ onSwipeLeft: vi.fn(), enabled: false }));
    expect(result.current.style.touchAction).toBeUndefined();
  });

  describe("nested carousels", () => {
    const Nested = ({ inner, outer }: { inner: UseSwipeOptions; outer: UseSwipeOptions }) => {
      const outerSwipe = useSwipe(outer);
      const innerSwipe = useSwipe(inner);
      return (
        <div {...outerSwipe} data-testid="outer" style={outerSwipe.style}>
          <div {...innerSwipe} data-testid="inner" style={innerSwipe.style}>inner</div>
        </div>
      );
    };

    it("keeps the swipe in the inner row when it can still move", () => {
      const innerLeft = vi.fn();
      const outerLeft = vi.fn();
      render(<Nested inner={{ onSwipeLeft: innerLeft }} outer={{ onSwipeLeft: outerLeft }} />);

      drag(screen.getByTestId("inner"), { dx: -120 });
      expect(innerLeft).toHaveBeenCalledTimes(1);
      expect(outerLeft).not.toHaveBeenCalled();
    });

    it("hands the swipe to the outer carousel when the inner row declines it", () => {
      // Returning false is how a row at its last card passes the gesture up.
      const innerLeft = vi.fn(() => false);
      const outerLeft = vi.fn();
      render(<Nested inner={{ onSwipeLeft: innerLeft }} outer={{ onSwipeLeft: outerLeft }} />);

      drag(screen.getByTestId("inner"), { dx: -120 });
      expect(innerLeft).toHaveBeenCalledTimes(1);
      expect(outerLeft).toHaveBeenCalledTimes(1);
    });
  });

  it("swallows the click that ends a swipe so no card is opened by accident", () => {
    const onClick = vi.fn();
    const Card = () => {
      const swipe = useSwipe({ onSwipeLeft: vi.fn() });
      return (
        <div {...swipe} data-testid="row" style={swipe.style}>
          <button onClick={onClick}>Open candle</button>
        </div>
      );
    };
    render(<Card />);

    drag(screen.getByTestId("row"), { dx: -120 });
    fireEvent.click(screen.getByText("Open candle"));
    expect(onClick).not.toHaveBeenCalled();

    // A later, ordinary tap still works.
    fireEvent.click(screen.getByText("Open candle"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
