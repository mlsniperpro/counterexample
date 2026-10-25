/** Shown after a clipboard write, so the click always gets a visible answer. */
export const COPIED = "Copied to the clipboard as Markdown.";
export const COPY_FAILED = "Could not copy: the browser blocked clipboard access.";

/**
 * Run a clipboard write and say how it went. A denied permission, an
 * insecure page without navigator.clipboard, or a write that throws
 * synchronously all become COPY_FAILED instead of an uncaught rejection.
 */
export async function copyNote(write: () => Promise<void> | void): Promise<string> {
  try {
    await write();
    return COPIED;
  } catch {
    return COPY_FAILED;
  }
}
