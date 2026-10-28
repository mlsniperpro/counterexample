"use client";

import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { showValue } from "@/lib/core/compare";
import type { Example } from "@/lib/problems/types";
import { decodeReport, encodeReport, fragmentBudget, isShareFragment, toShared } from "@/lib/share";
import { attackRun } from "./attack-run";
import { fmtArgs, ms, toMarkdown } from "./format";
import { splitCode } from "./inline-code";
import ReportView from "./report-view";
import { MODE_LABEL, HeroText, type UIMode } from "./mode-copy";
import { buildAttackBody } from "./request";
import { CANCELLED, focusIsIdle, initialRun, runReducer } from "./run-state";
import { saveFile } from "./save-file";
import { echoesCancel, echoesStart, ignoreHeldEnter } from "./keys";
import { initialShare, shareReducer } from "./share-state";
import { researchFacts } from "./stream";

export type UIProblem = { id: string; title: string; statement: string; examples: Example[]; language: "python" | "javascript"; code: string };

const CUSTOM = "custom";


export default function AttackUI({ problems }: { problems: UIProblem[] }) {
  const first = problems[0];
  const [mode, setMode] = useState<UIMode | null>(null);
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
  const [{ shared, key: sharedKey, error: shareError }, dispatchShare] = useReducer(shareReducer, initialShare);
  const [shareNote, setShareNote] = useState("");
  const [shareLink, setShareLink] = useState("");
  /** Bumped whenever the page shows something else (a run starts, a problem is picked, a shared link opens): async share work checks it before writing. */
  const view = useRef(0);
  /** Set when a link is pasted into this tab, so the shared report it opens is scrolled into view. */
  const revealShared = useRef(false);
  const sharedBox = useRef<HTMLDivElement | null>(null);
  // A shared report link (#r=...) is decoded here in the browser; the fragment never reaches the server.
  // Also on hashchange: pasting a link into a tab that already shows the app only changes the hash.
  useEffect(() => {
    const open = () => {
      const hash = window.location.hash;
      if (!isShareFragment(hash)) return;
      // The page now shows this shared report: a share of the earlier one still in flight must not write its link.
      view.current++;
      dispatchShare({ type: "decoding", key: hash });
      decodeReport(hash)
        .then((report) => dispatchShare({ type: "opened", report, key: hash }))
        .catch((e: Error) => dispatchShare({ type: "failed", message: e.message, key: hash }));
    };
    open();
    // A link pasted into a tab that already shows a report opens far above where the reader is: bring it into view.
    const pasted = () => {
      revealShared.current = true;
      open();
    };
    window.addEventListener("hashchange", pasted);
    return () => window.removeEventListener("hashchange", pasted);
  }, []);
  useEffect(() => {
    if (!revealShared.current || (!shared && !shareError)) return;
    revealShared.current = false;
    sharedBox.current?.scrollIntoView({ block: "start" });
  }, [shared, shareError]);
  const [{ events, report, executor, running, error, note, status }, dispatch] = useReducer(runReducer, initialRun);
  const goButton = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  /**
   * Set when a run starts: when it ends (done, failed or cancelled), focus returns to the Attack button instead of
   * falling to <body>, but only from Cancel or nowhere. Focus the reader moved (into the code, say) stays put, so
   * the next keypress is not an accidental new attack.
   */
  const refocusGo = useRef(false);
  useEffect(() => {
    if (running) cancelButton.current?.focus();
    else if (refocusGo.current) {
      refocusGo.current = false;
      if (focusIsIdle(document.activeElement, cancelButton.current)) goButton.current?.focus();
    }
  }, [running]);
  const abort = useRef<AbortController | null>(null);
  const lastRun = useRef(0);
  useEffect(() => () => abort.current?.abort(), []);
  const traceEnd = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = traceEnd.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  /** Drop a share fragment from the address bar once the page shows something else. */
  function clearShareHash() {
    if (isShareFragment(window.location.hash)) window.history.replaceState(null, "", window.location.pathname);
  }

  /** Abort the in-flight request, if any. The reducer has already disowned the run, so it cannot touch the page. */
  function abortRun(reason?: string) {
    const ac = abort.current;
    abort.current = null;
    ac?.abort(reason);
  }

  /** When the last run started and the last cancel happened (event timestamps), to tell a repeated activation from a new one. */
  const startedAt = useRef(-Infinity);
  const cancelledAt = useRef(-Infinity);

  function cancel() {
    dispatch({ type: "cancel" });
    abortRun(CANCELLED);
  }

  function pick(id: string) {
    view.current++;
    // The chip keeps focus: a run ended by this pick must not pull it to the Attack button.
    refocusGo.current = false;
    dispatch({ type: "reset" });
    abortRun();
    // The page now shows another problem: the shared report goes with its link, not just the link.
    dispatchShare({ type: "clear" });
    clearShareHash();
    setPid(id);
    const p = problems.find((x) => x.id === id);
    if (p) {
      setCode(p.code);
      setLanguage(p.language);
    } else {
      setCode("");
    }
  }

  async function run() {
    view.current++;
    abortRun();
    refocusGo.current = true;
    const ac = new AbortController();
    abort.current = ac;
    const runId = ++lastRun.current;
    dispatch({ type: "start", runId });
    setShareNote("");
    setShareLink("");
    dispatchShare({ type: "clear" });
    clearShareHash();
    const outcome = await attackRun({
      controller: ac,
      body: buildAttackBody({ problemId: pid === CUSTOM ? null : pid, statement, code, language, ultraOnly, researchWeb }),
      onMsg: (msg) => dispatch({ type: "msg", runId, msg }),
    });
    if (abort.current === ac) abort.current = null;
    dispatch({ type: "finish", runId, outcome });
  }

  const jsonl = useMemo(() => events.map((e) => showValue(e)).join("\n") + "\n", [events]);
  const download = () => saveFile(`trace-${pid}.jsonl`, jsonl, "application/jsonl");
  const copyReport = async () => {
    if (report) await navigator.clipboard.writeText(toMarkdown(report));
  };
  const shareReport = async () => {
    if (!report) return;
    const shown = view.current;
    let enc: Awaited<ReturnType<typeof encodeReport>>;
    try {
      enc = await encodeReport(report, fragmentBudget(window.location.origin, window.location.pathname));
    } catch (e) {
      if (view.current !== shown) return;
      // No CompressionStream (an old browser): say so rather than leave an unhandled rejection.
      setShareLink("");
      setShareNote(`This browser could not build a report link (${e instanceof Error ? e.message : String(e)}). Use Copy report instead.`);
      return;
    }
    // The page moved on while the report was compressed: no link, note or download for a report no longer shown.
    if (view.current !== shown) return;
    if (!enc.ok) {
      setShareLink("");
      // Same content a link would carry (no trace, no oracle code), as a file instead.
      saveFile(`report-${report.problem.id}.json`, showValue(toShared(report), 2), "application/json");
      setShareNote(
        enc.reason === "too_large"
          ? `This report is too large for a link (${enc.length.toLocaleString()} characters), so it was downloaded as JSON instead.`
          : `This report could not be put in a link (${enc.detail}), so it was downloaded as JSON instead.`,
      );
      return;
    }
    const link = `${window.location.origin}${window.location.pathname}${enc.fragment}`;
    setShareLink(link);
    let copied = true;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      copied = false;
    }
    // The page moved on while the clipboard answered: this link belongs to a report no longer shown.
    if (view.current !== shown) return;
    setShareNote(copied ? "Link copied. The report is inside the link itself; nothing is stored on the server." : "Copy this link (the report is inside it; nothing is stored on the server):");
    window.history.replaceState(null, "", enc.fragment);
  };
  const closeShared = () => {
    dispatchShare({ type: "clear" });
    clearShareHash();
    // The Close button goes away with the banner; keep keyboard focus on the page's main action (Cancel while a run is on, as Attack is disabled then).
    (running ? cancelButton : goButton).current?.focus();
  };

  return (
    <main className="wrap">
      <header className="hero">
        <h1>
          Counter<span className="accent">example</span>
        </h1>
        <p className="tagline">A coding agent that breaks your code before your interviewer does.</p>
        <p className="sub">
          <HeroText mode={mode} />
        </p>
        <div className="badges">
          {mode && <span className={`badge ${mode}`}>{MODE_LABEL[mode]}</span>}
          {executor && <span className="badge">{executor}</span>}
        </div>
      </header>

      {shareError && (
        <p className="err share-err" role="alert">
          {shareError}
        </p>
      )}

      {/* The note's live region stays mounted and only its text changes: a region inserted together with its text is often not announced. */}
      <div className={shared ? "shared" : undefined} ref={sharedBox}>
        <div className={shared ? "row between" : undefined}>
          <p className="small muted live" role="status">
            {shared && (
              <>
                Shared report for <b>{shared.problem.title}</b>, decoded in your browser from the link. Nothing was sent to the server, and nothing in it was re-run or verified here: a link can say anything, so re-run the attack to check it.
              </>
            )}
          </p>
          {shared && (
            <button className="ghost" onClick={closeShared}>
              Close
            </button>
          )}
        </div>
        {shared && <ReportView key={sharedKey} r={shared} onCopy={() => navigator.clipboard.writeText(toMarkdown(shared))} />}
      </div>

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
            <p className="statement">
              {splitCode(current.statement).map((p, i) => (p.code ? <code key={i}>{p.text}</code> : <Fragment key={i}>{p.text}</Fragment>))}
            </p>
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
        <div className="go-row">
          <button className="go" ref={goButton} onClick={(e) => {
              if (echoesCancel(e, e.timeStamp - cancelledAt.current)) return;
              startedAt.current = e.timeStamp;
              void run();
            }} disabled={running} onKeyDown={ignoreHeldEnter}>
            {running ? "Attacking…" : "Attack this solution"}
          </button>
          {/* A held Enter repeats: on Cancel it would cancel the run it started, on Attack start one run after another. Other repeated keys (Tab) pass. */}
          {running && (
            <button className="ghost cancel" ref={cancelButton} onClick={(e) => {
                if (echoesStart(e, e.timeStamp - startedAt.current)) return;
                cancelledAt.current = e.timeStamp;
                cancel();
              }} onKeyDown={ignoreHeldEnter}>
              Cancel
            </button>
          )}
        </div>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        {note && <p className="small muted note">{note}</p>}
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
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
            {/* The scroller is the wrapper, not the list: a region role on the <ol> would orphan its items. */}
            <div className="trace-scroll" ref={traceEnd} tabIndex={0} role="region" aria-label="Live trace events">
              <ol>
                {events.map((e) => (
                  <li key={e.seq} className={`ev ${e.kind}`}>
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
                ))}
              </ol>
            </div>
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
