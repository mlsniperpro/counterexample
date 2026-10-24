"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TraceEvent } from "@/lib/agent/trace";
import type { Example } from "@/lib/problems/types";
import { decodeReport, encodeReport, fragmentBudget, isShareFragment, toShared, type SharedReport } from "@/lib/share";
import { fmtArgs, ms, toMarkdown, type ReportNoTrace } from "./format";
import ReportView from "./report-view";
import { buildAttackBody } from "./request";
import { saveFile } from "./save-file";

export type UIProblem = { id: string; title: string; statement: string; examples: Example[]; language: "python" | "javascript"; code: string };

const CUSTOM = "custom";
const MODE_LABEL = {
  live: "Live: Nebius Token Factory",
  replay: "Replay mode: recorded model responses, real execution",
  unknown: "Server mode unknown (status check failed)",
} as const;

export default function AttackUI({ problems }: { problems: UIProblem[] }) {
  const first = problems[0];
  const [mode, setMode] = useState<"live" | "replay" | "unknown" | null>(null);
  useEffect(() => {
    fetch("/api/problems")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((j: { mode: "live" | "replay" }) => setMode(j.mode))
      .catch(() => setMode("unknown"));
  }, []);
  const [pid, setPid] = useState(first?.id ?? CUSTOM);
  const current = problems.find((p) => p.id === pid);
  const [code, setCode] = useState(first?.code ?? "");
  const [language, setLanguage] = useState<"python" | "javascript">(first?.language ?? "python");
  const [statement, setStatement] = useState("");
  const [ultraOnly, setUltraOnly] = useState(false);
  const [researchWeb, setResearchWeb] = useState(false);
  const [shared, setShared] = useState<SharedReport | null>(null);
  const [shareNote, setShareNote] = useState("");
  const [shareLink, setShareLink] = useState("");
  // A shared report link (#r=...) is decoded here in the browser; the fragment never reaches the server.
  // Also on hashchange: pasting a link into a tab that already shows the app only changes the hash.
  useEffect(() => {
    const open = () => {
      const hash = window.location.hash;
      if (!isShareFragment(hash)) return;
      decodeReport(hash)
        .then((r) => {
          setShared(r);
          setError("");
        })
        .catch((e: Error) => setError(`Could not open the shared report: ${e.message}`));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
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

  /** Drop a share fragment from the address bar once the page shows something else. */
  function clearShareHash() {
    if (isShareFragment(window.location.hash)) window.history.replaceState(null, "", window.location.pathname);
  }

  function pick(id: string) {
    clearShareHash();
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
    setShareNote("");
    setShareLink("");
    setError("");
    setShared(null);
    clearShareHash();
    try {
      const res = await fetch("/api/attack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildAttackBody({ problemId: pid === CUSTOM ? null : pid, statement, code, language, ultraOnly, researchWeb })),
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
          else if (msg.type === "error") setError(msg.error);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const jsonl = useMemo(() => events.map((e) => JSON.stringify(e)).join("\n") + "\n", [events]);
  const download = () => saveFile(`trace-${pid}.jsonl`, jsonl, "application/jsonl");
  const copyReport = async () => {
    if (report) await navigator.clipboard.writeText(toMarkdown(report));
  };
  const shareReport = async () => {
    if (!report) return;
    const enc = await encodeReport(report, fragmentBudget(window.location.origin, window.location.pathname));
    if (!enc.ok) {
      setShareLink("");
      // Same content a link would carry (no trace, no oracle code), as a file instead.
      saveFile(`report-${report.problem.id}.json`, JSON.stringify(toShared(report), null, 2), "application/json");
      setShareNote(
        enc.reason === "too_large"
          ? `This report is too large for a link (${enc.length.toLocaleString()} characters), so it was downloaded as JSON instead.`
          : `This report could not be put in a link (${enc.detail}), so it was downloaded as JSON instead.`,
      );
      return;
    }
    const link = `${window.location.origin}${window.location.pathname}${enc.fragment}`;
    setShareLink(link);
    try {
      await navigator.clipboard.writeText(link);
      setShareNote("Link copied. The report is inside the link itself; nothing is stored on the server.");
    } catch {
      setShareNote("Copy this link (the report is inside it; nothing is stored on the server):");
    }
    window.history.replaceState(null, "", enc.fragment);
  };
  const closeShared = () => {
    setShared(null);
    setError("");
    clearShareHash();
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
          {mode && <span className={`badge ${mode}`}>{MODE_LABEL[mode]}</span>}
          {executor && <span className="badge">{executor}</span>}
        </div>
      </header>

      {shared && (
        <div className="shared">
          <div className="row between">
            <p className="small muted" role="status">
              Shared report for <b>{shared.problem.title}</b>, decoded in your browser from the link. Nothing was sent to the server, and nothing in it was re-run or verified here: a link can say anything, so re-run the attack to check it.
            </p>
            <button className="ghost" onClick={closeShared}>
              Close
            </button>
          </div>
          <ReportView r={shared} onCopy={() => navigator.clipboard.writeText(toMarkdown(shared))} />
        </div>
      )}

      <section className="card">
        <h2>1. Problem</h2>
        <div className="chips" role="group" aria-label="Problem">
          {problems.map((p) => (
            <button key={p.id} className={`chip ${p.id === pid ? "on" : ""}`} onClick={() => pick(p.id)} aria-pressed={p.id === pid}>
              {p.title}
            </button>
          ))}
          <button className={`chip ${pid === CUSTOM ? "on" : ""}`} onClick={() => pick(CUSTOM)} aria-pressed={pid === CUSTOM}>
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
            <input type="checkbox" checked={ultraOnly} onChange={(e) => setUltraOnly(e.target.checked)} /> Ultra for everything (baseline)
          </label>
          <label className="toggle" title="Search the web with Tavily for the problem's official constraints and for the documentation of risky APIs your code calls (default sort order, 32-bit bitwise operators, rounding), even if the statement cites no sources">
            <input type="checkbox" checked={researchWeb} onChange={(e) => setResearchWeb(e.target.checked)} /> Research the web (Tavily)
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

          {report && <ReportView r={report} onCopy={copyReport} onShare={shareReport} shareNote={shareNote} shareLink={shareLink} />}
        </div>
      )}

      <footer className="foot">
        MIT licensed · Built for the Nebius x NVIDIA Global AI Hackathon by the AlgoCracked team · <a href="https://github.com/mlsniperpro/counterexample">source</a>
      </footer>
    </main>
  );
}
