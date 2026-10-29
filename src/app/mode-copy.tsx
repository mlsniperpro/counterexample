/** What the page says about the server's mode, so a replay run never claims a live model ran. */
export type UIMode = "live" | "replay" | "unknown";

export const MODE_LABEL: Record<UIMode, string> = {
  live: "Live: Nebius Token Factory",
  replay: "Replay mode: hand-written stand-ins for model answers, real execution",
  unknown: "Server mode unknown (status check failed)",
};

/** The hero paragraph. `null` is the moment before /api/problems has answered; it and "unknown" claim no live model. */
export function HeroText({ mode }: { mode: UIMode | null }) {
  if (mode === "live") {
    return (
      <>
        Nemotron <b>Ultra</b> writes a brute-force oracle, Nemotron <b>Super</b> designs adversarial generators, up to a few hundred inputs before a counterexample, hundreds to over a thousand when nothing breaks (thousands of runs, with the fix&apos;s re-attack), go through a sandbox, and any mismatch is shrunk to a minimal
        counterexample. Ultra explains it and proposes a fix, which is re-attacked before it is called fixed.
      </>
    );
  }
  if (mode === "replay") {
    return (
      <>
        Replay mode: no model runs. Hand-written stand-ins for the answers of Nemotron <b>Ultra</b> (oracle, explanation, fix) and Nemotron <b>Super</b> (adversarial generators) are served instead, while
        up to a few hundred inputs before a counterexample, hundreds to over a thousand when nothing breaks (thousands of runs, with the fix&apos;s re-attack), really go through a sandbox and any mismatch is really shrunk to a minimal counterexample. The fix is really re-attacked before it is called fixed.
      </>
    );
  }
  return (
    <>
      With a key on the server, Nemotron <b>Ultra</b> writes the oracle, explains the bug and proposes a fix, and Nemotron <b>Super</b> designs the adversarial generators. Without one, hand-written
      stand-ins answer in their place. Either way, up to a few hundred inputs before a counterexample, hundreds to over a thousand when nothing breaks (thousands of runs, with the fix&apos;s re-attack), go through a sandbox, any mismatch is shrunk to a minimal counterexample, and the fix is re-attacked before it is called fixed.
    </>
  );
}

/** The research panel's heading: replay research is a hand-written stand-in, never a Tavily search. */
export function researchHeading(setupResearch: string): string {
  return setupResearch === "replay" ? "Research (hand-written stand-in for Tavily)" : "Research (Tavily)";
}

/** What "Research the web" does, said under the checkbox: replay mode runs no web search, and live mode needs a Tavily key. */
export function researchHint(mode: UIMode | null): string {
  const what = "the problem's official constraints and the documentation of risky APIs your code calls (default sort order, 32-bit bitwise operators, rounding), even if the statement cites no sources";
  if (mode === "replay") return "In replay mode no web search runs: research shows hand-written stand-in results for the built-in problems, in place of Tavily's.";
  if (mode === "live") return `With TAVILY_API_KEY set on the server, research searches the web (Tavily) for ${what}; without it, no search runs and the report says so.`;
  return `On a live server with a Tavily key, research searches the web for ${what}; otherwise no web search runs (replay mode shows hand-written stand-in results for the built-in problems).`;
}
