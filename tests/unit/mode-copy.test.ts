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
  it("never claims a web search it cannot promise: replay runs none, live needs a Tavily key, an unknown mode says both", () => {
    expect(researchHint("replay")).toMatch(/^In replay mode no web search runs: research shows hand-written stand-in results/);
    expect(researchHint("replay")).not.toMatch(/searches the web/);
    expect(researchHint("live")).toBe("With TAVILY_API_KEY set on the server, research searches the web (Tavily) for the problem's official constraints and the documentation of risky APIs your code calls (default sort order, 32-bit bitwise operators, rounding), even if the statement cites no sources; without it, no search runs and the report says so.");
    expect(researchHint("live")).toMatch(/^With TAVILY_API_KEY set on the server, research searches the web \(Tavily\) for the problem's official constraints .*; without it, no search runs and the report says so\.$/);
    for (const m of ["unknown", null] as const) expect(researchHint(m)).toMatch(/^On a live server with a Tavily key, research searches the web .*; otherwise no web search runs \(replay mode shows hand-written stand-in results/);
  });
});
