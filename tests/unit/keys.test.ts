import { describe, expect, it, vi } from "vitest";
import { ECHO_MS, echoesCancel, echoesStart, ignoreHeldEnter } from "@/app/keys";

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

describe("echoesCancel / echoesStart (a repeated activation, not a new one)", () => {
  it("drops the second click of a double-click on Cancel, and only right after a cancel", () => {
    expect(echoesCancel({ detail: 2 }, 100)).toBe(true);
    expect(echoesCancel({ detail: 3 }, ECHO_MS - 1)).toBe(true);
    // A single click, a keyboard activation, or rapid clicks long after any cancel all start a run.
    expect(echoesCancel({ detail: 1 }, 100)).toBe(false);
    expect(echoesCancel({ detail: 0 }, 100)).toBe(false);
    expect(echoesCancel({ detail: 2 }, ECHO_MS)).toBe(false);
    expect(echoesCancel({ detail: 2 }, Infinity)).toBe(false);
  });

  it("drops a quick second Enter that lands on Cancel as the run starts, never a click", () => {
    expect(echoesStart({ detail: 0 }, 60)).toBe(true);
    expect(echoesStart({ detail: 0 }, ECHO_MS)).toBe(false);
    expect(echoesStart({ detail: 1 }, 60)).toBe(false);
  });
});
