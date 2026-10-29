/** A repeated Enter (the key held down) does not activate a button; other repeated keys (Tab, arrows) pass. */
export function ignoreHeldEnter(e: { key: string; repeat: boolean; preventDefault: () => void }): void {
  if (e.repeat && e.key === "Enter") e.preventDefault();
}

/** How long after a button changes under the pointer or the focus a repeated activation is taken as an echo of the first. */
export const ECHO_MS = 600;

/**
 * Whether activating Attack echoes a cancel just made: the second click of a double-click on Cancel (Attack grows into
 * its place as it goes away) or a second, quick Enter or Space (focus moved to Attack). A single click right after a
 * cancel is a reader starting again on purpose, and still starts a run.
 */
export function echoesCancel(e: { detail: number }, msSinceCancel: number): boolean {
  return e.detail !== 1 && msSinceCancel < ECHO_MS;
}

/** How soon after the start a single click on Cancel is taken as the second tap of a double tap (taps carry no click count). */
export const TAP_ECHO_MS = 300;

/**
 * Whether activating Cancel echoes the start just made: the second click of a double-click on Attack's edge (Cancel
 * appears there), a second Enter or Space (focus moved to Cancel), or a quick second tap. A single click after
 * TAP_ECHO_MS is a reader cancelling on purpose.
 */
export function echoesStart(e: { detail: number }, msSinceStart: number): boolean {
  return e.detail === 1 ? msSinceStart < TAP_ECHO_MS : msSinceStart < ECHO_MS;
}

/** Whether a scroller is at (or within 24 px of) its bottom, so new content should keep it there. */
export function nearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

/** What the trace remembers between scroll events: whether it follows new events, and where it was. */
export type TraceFollow = { follow: boolean; lastTop: number; autoTop: number; prevMax: number };

/**
 * The trace's follow state after a scroll event. Its own automatic scroll changes nothing; a scroll up stops
 * following; a scroll down that reaches the bottom (or the bottom as it was one render ago, when an event rendered
 * between the reader's End and its scroll event) follows again. Scrolling down to anywhere else keeps the reader there.
 */
export function followAfterScroll(s: TraceFollow, el: { scrollHeight: number; scrollTop: number; clientHeight: number }): TraceFollow {
  const up = el.scrollTop < s.lastTop - 1;
  const next = { ...s, lastTop: el.scrollTop };
  if (Math.abs(el.scrollTop - s.autoTop) < 1) return next;
  if (up) return { ...next, follow: false };
  if (nearBottom(el) || el.scrollTop >= s.prevMax - 1) return { ...next, follow: true };
  return next;
}
