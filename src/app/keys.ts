/** A repeated Enter (the key held down) does not activate a button; other repeated keys (Tab, arrows) pass. */
export function ignoreHeldEnter(e: { key: string; repeat: boolean; preventDefault: () => void }): void {
  if (e.repeat && e.key === "Enter") e.preventDefault();
}

/**
 * Whether a click is a single click (or a keyboard activation, whose detail is 0). The second click of a double-click
 * on Cancel lands on the Attack button, which grows into Cancel's place as Cancel goes away: it must not start a run.
 */
export function isSingleClick(e: { detail: number }): boolean {
  return e.detail <= 1;
}
