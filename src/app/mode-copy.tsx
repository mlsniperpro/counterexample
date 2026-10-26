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
        Nemotron <b>Ultra</b> writes a brute-force oracle, Nemotron <b>Super</b> designs adversarial generators, thousands of inputs run in a sandbox, and any mismatch is shrunk to a minimal
        counterexample. Ultra explains it and proposes a fix, which is re-attacked before it is called fixed.
      </>
    );
  }
  if (mode === "replay") {
    return (
      <>
        Replay mode: no model runs. Hand-written stand-ins for the answers of Nemotron <b>Ultra</b> (oracle, explanation, fix) and Nemotron <b>Super</b> (adversarial generators) are served instead, while
        thousands of inputs really run in a sandbox and any mismatch is really shrunk to a minimal counterexample. The fix is really re-attacked before it is called fixed.
      </>
    );
  }
  return (
    <>
      With a key on the server, Nemotron <b>Ultra</b> writes the oracle, explains the bug and proposes a fix, and Nemotron <b>Super</b> designs the adversarial generators. Without one, hand-written
      stand-ins answer in their place. Either way, thousands of inputs run in a sandbox, any mismatch is shrunk to a minimal counterexample, and the fix is re-attacked before it is called fixed.
    </>
  );
}
