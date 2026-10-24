import { fmtArgs, ms, usd, VERDICT, type ReportNoTrace } from "./format";

export default function ReportView({ r, onCopy }: { r: ReportNoTrace; onCopy: () => void }) {
  return (
    <section className="card result">
      <div className="row between">
        <h2 className={`verdict ${r.verdict}`}>{VERDICT[r.verdict]}</h2>
        <button className="ghost" onClick={onCopy}>
          Copy report
        </button>
      </div>
      <p className="muted">{r.message}</p>

      {r.counterexample && (
        <div className="cx">
          <div className="label">Minimal counterexample</div>
          <code className="big">solve({fmtArgs(r.counterexample.args)})</code>
          <div className="cmp">
            <div>
              <span className="label">expected</span>
              <code>{JSON.stringify(r.counterexample.expected)}</code>
            </div>
            <div>
              <span className="label">got</span>
              <code className="bad">{r.counterexample.got}</code>
            </div>
          </div>
          <p className="muted small">
            Shrunk from <code>{fmtArgs(r.counterexample.original.args).slice(0, 120)}</code> (family {r.counterexample.original.family}) in {r.counterexample.shrinkSteps} steps,{" "}
            {r.counterexample.shrinkEvals} candidate runs.
          </p>
        </div>
      )}

      {r.explanation && (
        <>
          <div className="label">Why it fails</div>
          <p>{r.explanation}</p>
        </>
      )}
      {r.fix && (
        <>
          <div className="label">
            Proposed fix ·{" "}
            <span className={r.fix.verified ? "good" : "bad"}>
              {r.fix.verified ? `re-attacked on ${r.fix.reattackInputs} inputs: 0 failures` : `still fails on ${r.fix.reattackMismatches} of ${r.fix.reattackInputs} inputs`}
            </span>
          </div>
          <pre className="code-out">{r.fix.code}</pre>
        </>
      )}

      {r.research && (
        <>
          <div className="label">Research (Tavily)</div>
          <ul className="facts">
            {r.research.facts.map((f, i) => (
              <li key={i}>
                {f.fact}{" "}
                <a href={f.url} target="_blank" rel="noreferrer">
                  source
                </a>
              </li>
            ))}
          </ul>
          {r.research.influencedFamilies.length > 0 && <p className="muted small">Shaped generator families: {r.research.influencedFamilies.join(", ")}</p>}
        </>
      )}

      <div className="label">Attack families</div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>family</th>
              <th>tested</th>
              <th>mismatches</th>
              <th>why</th>
            </tr>
          </thead>
          <tbody>
            {r.families.map((f) => (
              <tr key={f.name}>
                <td>
                  <code>{f.name}</code>
                </td>
                <td>{f.tested}</td>
                <td className={f.mismatches ? "bad" : ""}>{f.mismatches}</td>
                <td className="small">{f.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="label">Why Ultra here, Super there</div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>step</th>
              <th>model</th>
              <th>calls</th>
              <th>tokens</th>
              <th>cost</th>
              <th>latency</th>
            </tr>
          </thead>
          <tbody>
            {r.stages.map((s) => (
              <tr key={s.purpose}>
                <td>
                  {s.purpose}
                  <div className="small muted">{s.why}</div>
                </td>
                <td>
                  <code>{s.model.split("/").pop()}</code>
                </td>
                <td>{s.calls}</td>
                <td>{s.promptTokens + s.completionTokens}</td>
                <td>{usd(s.costUsd)}</td>
                <td>
                  {ms(s.latencyMs)}
                  {s.simulated ? "*" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.stages.some((s) => s.simulated) && <p className="muted small">* Replay mode: token counts estimated from text length, latency simulated.</p>}

      <div className="stats">
        <div>
          <b>{r.stats.inputsTested.toLocaleString()}</b>
          <span>inputs attacked</span>
        </div>
        <div>
          <b>{r.stats.runs.toLocaleString()}</b>
          <span>sandbox runs</span>
        </div>
        <div>
          <b>{r.stats.modelCalls}</b>
          <span>model calls</span>
        </div>
        <div>
          <b>{usd(r.stats.costUsd)}</b>
          <span>model cost{r.stats.unpricedCalls ? ` (+${r.stats.unpricedCalls} unpriced)` : ""}</span>
        </div>
        <div>
          <b>{r.stats.timeToFirstCounterexampleMs === null ? "–" : ms(r.stats.timeToFirstCounterexampleMs)}</b>
          <span>to first counterexample</span>
        </div>
      </div>
    </section>
  );
}
