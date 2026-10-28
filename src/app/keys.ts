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
