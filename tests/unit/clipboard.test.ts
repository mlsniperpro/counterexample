import { describe, expect, it } from "vitest";
import { COPIED, COPY_FAILED, copyNote } from "@/app/clipboard";

describe("copyNote (feedback for clipboard writes)", () => {
  it("reports a successful write", async () => {
    let wrote = "";
    expect(await copyNote(async () => void (wrote = "md"))).toBe(COPIED);
    expect(wrote).toBe("md");
  });

  it("turns a denied permission into a visible note instead of a rejection", async () => {
    expect(await copyNote(() => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")))).toBe(COPY_FAILED);
  });

  it("catches a write that throws synchronously (no navigator.clipboard on an insecure page)", async () => {
    const nav: { clipboard?: { writeText(t: string): Promise<void> } } = {};
    expect(await copyNote(() => (nav.clipboard as NonNullable<typeof nav.clipboard>).writeText("x"))).toBe(COPY_FAILED);
  });
});
