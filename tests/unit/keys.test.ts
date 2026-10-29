import { describe, expect, it, vi } from "vitest";
import { ECHO_MS, echoesCancel, echoesStart, followAfterScroll, ignoreHeldEnter, nearBottom, TAP_ECHO_MS } from "@/app/keys";

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
  it("uses the documented windows: 600 ms for keys and click bursts, 300 ms for a single click or tap", () => {
    expect(ECHO_MS).toBe(600);
    expect(TAP_ECHO_MS).toBe(300);
  });

  it("drops a second click, tap-free key press or click burst on Attack right after a cancel, not a deliberate single click", () => {
    expect(echoesCancel({ detail: 2 }, 100)).toBe(true);
    expect(echoesCancel({ detail: 3 }, ECHO_MS - 1)).toBe(true);
    // A quick second Enter or Space (detail 0) lands on Attack as focus moves there.
    expect(echoesCancel({ detail: 0 }, 60)).toBe(true);
    // A single click, or anything long after the cancel, starts a run.
    expect(echoesCancel({ detail: 1 }, 100)).toBe(false);
    expect(echoesCancel({ detail: 2 }, ECHO_MS)).toBe(false);
    expect(echoesCancel({ detail: 0 }, Infinity)).toBe(false);
  });

  it("drops a double-click on Attack's edge, a second key press or a quick second tap that lands on Cancel, not a later deliberate click", () => {
    for (const detail of [0, 2]) {
      expect(echoesStart({ detail }, 60)).toBe(true);
      expect(echoesStart({ detail }, ECHO_MS - 1)).toBe(true);
      expect(echoesStart({ detail }, ECHO_MS)).toBe(false);
    }
    expect(echoesStart({ detail: 1 }, 100)).toBe(true);
    expect(echoesStart({ detail: 1 }, TAP_ECHO_MS)).toBe(false);
  });
});

describe("nearBottom", () => {
  it("follows the trace only within 24 px of its bottom", () => {
    expect(nearBottom({ scrollHeight: 1000, clientHeight: 200, scrollTop: 800 })).toBe(true);
    expect(nearBottom({ scrollHeight: 1000, clientHeight: 200, scrollTop: 777 })).toBe(true);
    expect(nearBottom({ scrollHeight: 1000, clientHeight: 200, scrollTop: 776 })).toBe(false);
    expect(nearBottom({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })).toBe(false);
  });
});

describe("followAfterScroll", () => {
  // A trace 200 px high whose content has grown to 2000 px; the last automatic scroll left it at 1000.
  const at = (scrollTop: number, scrollHeight = 2000) => ({ scrollTop, scrollHeight, clientHeight: 200 });
  const following = { follow: true, lastTop: 1000, autoTop: 1000, prevMax: 1000 };

  it("ignores its own automatic scroll", () => {
    expect(followAfterScroll(following, at(1000)).follow).toBe(true);
  });

  it("stops following on any scroll up, and stays stopped when the reader scrolls back down short of the bottom", () => {
    const up = followAfterScroll(following, at(960));
    expect(up.follow).toBe(false);
    // Events kept arriving: the bottom is now 1800. Scrolling down past the old automatic position is not the bottom.
    const down = followAfterScroll({ ...up, prevMax: 1700 }, at(1400));
    expect(down.follow).toBe(false);
    expect(down.lastTop).toBe(1400);
  });

  it("follows again at the bottom, or at the bottom as it was one render ago (End, then an event)", () => {
    const stopped = { follow: false, lastTop: 400, autoTop: 1000, prevMax: 1700 };
    expect(followAfterScroll(stopped, at(1790)).follow).toBe(true);
    expect(followAfterScroll(stopped, at(1700, 2100)).follow).toBe(true);
    expect(followAfterScroll(stopped, at(1690, 2100)).follow).toBe(false);
  });
});
