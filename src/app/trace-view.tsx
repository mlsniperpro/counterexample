import { Fragment } from "react";
import type { TraceEvent } from "@/lib/agent/trace";
import type { Example } from "@/lib/problems/types";
import { fmtArgs, ms } from "./format";
import { splitCode } from "./inline-code";
import { researchFacts } from "./stream";

/**
 * One live-trace event row: its elapsed time, stage, message, the model-call "why", and any research citations.
 * Kept as a pure component (no hooks, no state) so the trace — the headline artifact — is unit-tested field by field,
 * which the stateful AttackUI around it is not.
 */
export function TraceEventLine({ e }: { e: TraceEvent }) {
  return (
    <li className={`ev ${e.kind}`}>
      <span className="t">{ms(e.t)}</span>
      <span className="st">{e.stage}</span>
      <span className="msg">{e.msg}</span>
      {e.kind === "model_call" && e.data && <span className="why">{String(e.data.why)}</span>}
      {e.kind === "research" && researchFacts(e.data).length > 0 && (
        <ul className="facts">
          {researchFacts(e.data).map((f, i) => (
            <li key={i}>
              {f.fact}{" "}
              <a href={f.url} target="_blank" rel="noreferrer">
                source
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One of a problem's worked examples: solve(args) -> output. Pure, so its args and output are unit-tested. */
export function ExampleLine({ e }: { e: Example }) {
  return (
    <li>
      <code>
        solve({fmtArgs(e.args)}) → {JSON.stringify(e.output)}
      </code>
    </li>
  );
}

/** A built-in problem's statement (with inline code) and its worked examples, as the attack form shows them. Pure, so unit-tested. */
export function ProblemBrief({ statement, examples }: { statement: string; examples: Example[] }) {
  return (
    <>
      <p className="statement">
        {splitCode(statement).map((p, i) => (p.code ? <code key={i}>{p.text}</code> : <Fragment key={i}>{p.text}</Fragment>))}
      </p>
      <ul className="examples">
        {examples.map((e, i) => (
          <ExampleLine key={i} e={e} />
        ))}
      </ul>
    </>
  );
}
