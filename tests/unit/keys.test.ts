import { describe, expect, it, vi } from "vitest";
import { ignoreHeldEnter, isSingleClick } from "@/app/keys";

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

describe("isSingleClick", () => {
  it("passes a single click and a keyboard activation, not the second click of a double-click", () => {
    expect(isSingleClick({ detail: 1 })).toBe(true);
    expect(isSingleClick({ detail: 0 })).toBe(true);
    expect(isSingleClick({ detail: 2 })).toBe(false);
    expect(isSingleClick({ detail: 3 })).toBe(false);
  });
});
