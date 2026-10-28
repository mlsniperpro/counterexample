/** A repeated Enter (the key held down) does not activate a button; other repeated keys (Tab, arrows) pass. */
export function ignoreHeldEnter(e: { key: string; repeat: boolean; preventDefault: () => void }): void {
  if (e.repeat && e.key === "Enter") e.preventDefault();
}

/** How long after a button changes under the pointer or the focus a repeated activation is taken as an echo of the first. */
export const ECHO_MS = 600;

/**
 * Whether a click on Attack is the second click of a double-click on Cancel: as Cancel goes away, Attack grows into its
 * place and takes that click. Only right after a cancel: a reader clicking Attack quickly on purpose still starts a run.
 */
export function echoesCancel(e: { detail: number }, msSinceCancel: number): boolean {
  return e.detail > 1 && msSinceCancel < ECHO_MS;
}

/**
 * Whether a keyboard activation of Cancel is a second, quick Enter on Attack: focus moves to Cancel as the run starts,
 * so a double-tapped Enter would cancel the run it just started. A click (detail 1 or more) always cancels.
 */
export function echoesStart(e: { detail: number }, msSinceStart: number): boolean {
  return e.detail === 0 && msSinceStart < ECHO_MS;
}
