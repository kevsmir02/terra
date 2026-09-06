/**
 * Root-level paint order.
 *
 * Nothing between these surfaces and `<html>` opens a stacking context at the
 * default app zoom, so they compete directly with the `z-50` the shadcn
 * overlay primitives portal into `document.body` with. Both must stay below
 * it: a surface painted above the overlay layer swallows every menu, dialog
 * and toast opened over it, and Radix marks the body inert meanwhile, so the
 * app reads as frozen rather than as covered.
 */

/** Wallpaper wash. Above app chrome, which tops out at z-20. */
export const WASH_Z = 40;

/** Web preview. Above the wash so the iframe stays pixel-accurate. */
export const PREVIEW_Z = 41;
