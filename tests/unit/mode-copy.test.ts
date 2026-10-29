import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroText, MODE_LABEL, researchHint } from "@/app/mode-copy";

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

describe("the research option's explanation", () => {
  it("says replay mode runs no web search, and names Tavily only when it may run", () => {
    expect(researchHint("replay")).toMatch(/^In replay mode no web search runs: research shows hand-written stand-in results/);
    expect(researchHint("replay")).not.toMatch(/searches the web/);
    for (const m of ["live", "unknown", null] as const) expect(researchHint(m)).toMatch(/^Research searches the web \(Tavily\) for the problem's official constraints/);
  });
});
