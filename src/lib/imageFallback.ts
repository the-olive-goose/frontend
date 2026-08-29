/**
 * What an <img> should do when its URL turns out to be dead.
 *
 * Product photos are not hosted by this shop — they are absolute URLs the owner
 * pastes or generates in the admin panel, pointing at whichever host that image
 * lives on. Those URLs outlive the thing they point at: an image host's free
 * tier stops serving, an optimisation account is disabled, a link is rotated. It
 * has already happened once, and the basket and checkout pages showed a row of
 * broken-image icons the shopper could do nothing about.
 *
 * `src` alone has no answer for that — the browser has already committed to the
 * URL by the time it fails. So every product <img> in a buying flow carries this
 * as well: one swap to the packaged placeholder, and the page still reads as a
 * basket rather than as something broken.
 *
 * Guarded against looping. If the placeholder itself somehow fails the handler
 * would fire again on the element it just changed, so the swap happens once per
 * element and then takes itself off.
 */
export const fallbackOnError =
  (fallbackSrc: string) =>
  (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    if (el.dataset.fellBack === "1") return;
    el.dataset.fellBack = "1";
    el.src = fallbackSrc;
  };
