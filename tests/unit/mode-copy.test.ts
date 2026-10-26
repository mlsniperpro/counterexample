import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroText, MODE_LABEL } from "@/app/mode-copy";

const text = (mode: Parameters<typeof HeroText>[0]["mode"]) => renderToStaticMarkup(createElement(HeroText, { mode })).replace(/<[^>]+>/g, "");

describe("mode copy", () => {
  it("claims a live model only in live mode", () => {
    expect(text("live")).toMatch(/^Nemotron Ultra writes a brute-force oracle/);
    for (const mode of ["replay", "unknown", null] as const) expect(text(mode)).not.toMatch(/^Nemotron Ultra writes/);
  });

  it("says no model runs in replay mode, and names the stand-ins", () => {
    expect(text("replay")).toMatch(/^Replay mode: no model runs\. Hand-written stand-ins/);
    expect(MODE_LABEL.replay).toBe("Replay mode: hand-written stand-ins for model answers, real execution");
    expect(MODE_LABEL.replay).not.toMatch(/recorded/i);
  });

  it("is conditional while the mode is unknown or still loading", () => {
    expect(text(null)).toMatch(/^With a key on the server/);
    expect(text("unknown")).toBe(text(null));
  });
});
