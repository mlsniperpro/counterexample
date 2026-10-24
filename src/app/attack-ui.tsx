"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Report } from "@/lib/agent/run";
import type { TraceEvent } from "@/lib/agent/trace";
import type { Example } from "@/lib/problems/types";

export type UIProblem = { id: string; title: string; statement: string; examples: Example[]; language: "python" | "javascript"; code: string };
type ReportNoTrace = Omit<Report, "trace">;

const CUSTOM = "custom";
const fmtArgs = (a: unknown[]) => a.map((x) => JSON.stringify(x)).join(", ");
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);
const usd = (x: number) => `$${x < 0.01 ? x.toFixed(5) : x.toFixed(3)}`;

const VERDICT: Record<Report["verdict"], string> = {
  counterexample: "Broken: minimal counterexample found",
  no_counterexample: "Survived the attack",
  oracle_unreliable: "Oracle unreliable: no bug claimed",
  compile_error: "Solution does not compile",
  budget_exhausted: "Budget exhausted",
  error: "Error",
};

export default function AttackUI({ problems }: { problems: UIProblem[] }) {
  const [mode, setMode] = useState<"live" | "replay" | null>(null);
  useEffect(() => {
    fetch("/api/problems")
      .then((r) => r.json())
      .then((j) => setMode(j.mode))
      .catch(() => setMode(null));
  }, []);
  const [pid, setPid] = useState(problems[0].id);
  const current = problems.find((p) => p.id === pid);
  const [code, setCode] = useState(problems[0].code);
  const [language, setLanguage] = useState<"python" | "javascript">(problems[0].language);
  const [statement, setStatement] = useState("");
  const [routing, setRouting] = useState<"routed" | "ultra-only">("routed");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [report, setReport] = useState<ReportNoTrace | null>(null);
  const [executor, setExecutor] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const traceEnd = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const el = traceEnd.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  function pick(id: string) {
    setPid(id);
    const p = problems.find((x) => x.id === id);
    if (p) {
      setCode(p.code);
      setLanguage(p.language);
    } else {
      setCode("");
    }
    setEvents([]);
    setReport(null);
    setError("");
  }

  async function run() {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setEvents([]);
    setReport(null);
    setError("");
    try {
      const res = await fetch("/api/attack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId: pid === CUSTOM ? undefined : pid, statement, code, language, routing }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(j.error ?? res.statusText);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.type === "event") setEvents((xs) => [...xs, msg.event]);
          else if (msg.type === "report") setReport(msg.report);
          else if (msg.type === "mode") setExecutor(msg.executor);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const jsonl = useMemo(() => events.map((e) => JSON.stringify(e)).join("\n") + "\n", [events]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([jsonl], { type: "application/jsonl" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `trace-${pid}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copyReport = async () => {
    if (report) await navigator.clipboard.writeText(toMarkdown(report));
  };

  return (
    <main className="wrap">
      <header className="hero">
        <h1>
          Counter<span className="accent">example</span>
        </h1>
        <p className="tagline">A coding agent that breaks your code before your interviewer does.</p>
        <p className="sub">
          Nemotron <b>Ultra</b> writes a brute-force oracle, Nemotron <b>Super</b> designs adversarial generators, thousands of inputs run in a sandbox, and any
          mismatch is shrunk to a minimal counterexample. Ultra explains it and proposes a fix, which is re-attacked before it is called fixed.
        </p>
        <div className="badges">
          {mode && <span className={`badge ${mode}`}>{mode === "live" ? "Live: Nebius Token Factory" : "Replay mode: recorded model responses, real execution"}</span>}
          {executor && <span className="badge">{executor}</span>}
        </div>
      </header>

      <section className="card">
        <h2>1. Problem</h2>
        <div className="chips" role="tablist">
          {problems.map((p) => (
            <button key={p.id} className={`chip ${p.id === pid ? "on" : ""}`} onClick={() => pick(p.id)} role="tab" aria-selected={p.id === pid}>
              {p.title}
            </button>
          ))}
          <button className={`chip ${pid === CUSTOM ? "on" : ""}`} onClick={() => pick(CUSTOM)} role="tab" aria-selected={pid === CUSTOM}>
            Your own
          </button>
        </div>
        {current ? (
          <>
            <p className="statement">{current.statement}</p>
            <ul className="examples">
              {current.examples.map((e, i) => (
                <li key={i}>
                  <code>
                    solve({fmtArgs(e.args)}) → {JSON.stringify(e.output)}
                  </code>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <textarea className="statement-in" rows={5} placeholder="Paste the problem statement, with constraints and examples." value={statement} onChange={(e) => setStatement(e.target.value)} />
            {mode === "replay" && <p className="warn">Custom problems need live mode (NEBIUS_API_KEY on the server). Replay mode covers the five built-ins.</p>}
          </>
        )}
      </section>

      <section className="card">
        <h2>2. Solution under attack</h2>
        <div className="row">
          <select value={language} onChange={(e) => setLanguage(e.target.value as "python" | "javascript")} aria-label="Language">
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
          </select>
          <label className="toggle">
            <input type="checkbox" checked={routing === "ultra-only"} onChange={(e) => setRouting(e.target.checked ? "ultra-only" : "routed")} /> Ultra for everything (baseline)
          </label>
        </div>
        <textarea className="code" spellCheck={false} rows={14} value={code} onChange={(e) => setCode(e.target.value)} aria-label="Solution code" />
        <button className="go" onClick={run} disabled={running}>
          {running ? "Attacking…" : "Attack this solution"}
        </button>
        {error && <p className="err">{error}</p>}
      </section>

      {(events.length > 0 || report) && (
        <div className="grid">
          <section className="card trace">
            <div className="row between">
              <h2>Live trace</h2>
              <button className="ghost" onClick={download} disabled={!events.length}>
                trace.jsonl
              </button>
            </div>
            <ol ref={traceEnd}>
              {events.map((e) => (
                <li key={e.seq} className={`ev ${e.kind}`}>
                  <span className="t">{ms(e.t)}</span>
                  <span className="st">{e.stage}</span>
                  <span className="msg">{e.msg}</span>
                  {e.kind === "model_call" && e.data && <span className="why">{String(e.data.why)}</span>}
                  {e.kind === "research" && Array.isArray(e.data?.facts) && (
                    <ul className="facts">
                      {(e.data.facts as { fact: string; url: string }[]).map((f, i) => (
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
              ))}
            </ol>
          </section>

          {report && <ReportView r={report} onCopy={copyReport} />}
        </div>
      )}

      <footer className="foot">
        MIT licensed · Built for the Nebius x NVIDIA Global AI Hackathon by the AlgoCracked team · <a href="https://github.com/mlsniperpro/counterexample">source</a>
      </footer>
    </main>
  );
}

function ReportView({ r, onCopy }: { r: ReportNoTrace; onCopy: () => void }) {
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
          <span>model cost</span>
        </div>
        <div>
          <b>{r.stats.timeToFirstCounterexampleMs === null ? "–" : ms(r.stats.timeToFirstCounterexampleMs)}</b>
          <span>to first counterexample</span>
        </div>
      </div>
    </section>
  );
}

function toMarkdown(r: ReportNoTrace): string {
  const lines = [`# Counterexample report: ${r.problem.title}`, "", `**Verdict:** ${VERDICT[r.verdict]}. ${r.message}`, ""];
  if (r.counterexample) {
    lines.push("## Minimal counterexample", "", "```", `solve(${fmtArgs(r.counterexample.args)})`, `expected: ${JSON.stringify(r.counterexample.expected)}`, `got:      ${r.counterexample.got}`, "```", "");
  }
  if (r.explanation) lines.push("## Why", "", r.explanation, "");
  if (r.fix) lines.push(`## Fix (${r.fix.verified ? "verified" : "NOT verified"} on ${r.fix.reattackInputs} inputs)`, "", "```" + r.solution.language, r.fix.code.trim(), "```", "");
  lines.push("## Model routing", "", "| step | model | calls | cost | latency |", "| --- | --- | --- | --- | --- |");
  for (const s of r.stages) lines.push(`| ${s.purpose} | ${s.model} | ${s.calls} | ${usd(s.costUsd)} | ${ms(s.latencyMs)}${s.simulated ? " (simulated)" : ""} |`);
  lines.push("", `${r.stats.inputsTested} inputs, ${r.stats.runs} sandbox runs, ${r.stats.modelCalls} model calls, ${usd(r.stats.costUsd)}. Provider: ${r.setup.provider}; executor: ${r.setup.executor}.`);
  return lines.join("\n");
}
