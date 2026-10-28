/** A repeated Enter (the key held down) does not activate a button; other repeated keys (Tab, arrows) pass. */
export function ignoreHeldEnter(e: { key: string; repeat: boolean; preventDefault: () => void }): void {
  if (e.repeat && e.key === "Enter") e.preventDefault();
}
