import { describe, expect, it, vi } from "vitest";
import { ignoreHeldEnter } from "@/app/keys";

describe("ignoreHeldEnter", () => {
  const press = (key: string, repeat: boolean) => {
    const preventDefault = vi.fn();
    ignoreHeldEnter({ key, repeat, preventDefault });
    return preventDefault.mock.calls.length > 0;
  };

  it("swallows only a repeated Enter", () => {
    expect(press("Enter", true)).toBe(true);
    // A fresh Enter still activates the button, and a held Tab still moves focus on.
    expect(press("Enter", false)).toBe(false);
    expect(press("Tab", true)).toBe(false);
    expect(press(" ", true)).toBe(false);
  });
});
