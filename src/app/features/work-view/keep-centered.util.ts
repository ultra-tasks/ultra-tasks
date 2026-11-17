/**
 * Keeps an element in the middle of its scroller while the list around it settles.
 *
 * Rows far down a long list hold an estimated height until the browser first
 * renders them (`content-visibility: auto`), so jumping to one lands where the
 * estimates put it, and the rows that render around the landing then move it.
 * This re-applies the centred scroll position on the next frames until it has been
 * right for a few frames in a row, or `maxFrames` have passed.
 *
 * `getCenteredTop` returns the scroll position that centres the element, or null
 * when it is gone. Returns a function that stops the loop.
 */
export const keepCentered = (
  container: HTMLElement,
  getCenteredTop: () => number | null,
  maxFrames: number = 30,
): (() => void) => {
  let frame = 0;
  let stableFrames = 0;
  let rafId = 0;

  const step = (): void => {
    const target = getCenteredTop();
    if (target === null) {
      return;
    }
    if (Math.abs(container.scrollTop - target) <= 1) {
      stableFrames++;
    } else {
      stableFrames = 0;
      container.scrollTop = target;
    }
    frame++;
    if (stableFrames < 3 && frame < maxFrames) {
      rafId = requestAnimationFrame(step);
    }
  };

  rafId = requestAnimationFrame(step);
  return () => cancelAnimationFrame(rafId);
};
