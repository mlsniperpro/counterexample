"use client";

import { useMemo, useState } from "react";
import { showValue } from "@/lib/core/compare";
import { lineDiff } from "@/lib/diff";
import type { SharedReport } from "@/lib/share";
import { copyNote } from "./clipboard";
import { researchHeading } from "./mode-copy";
import { cxHeading, ellipsize, fixSummary, fmtArgs, ms, usd, VERDICT } from "./format";

type Props = {
  r: SharedReport;
  /** Writes the report to the clipboard; a rejection is shown as a note, not thrown. */
  onCopy: () => Promise<void> | void;
  /** Absent for a report opened from a link. */
  onShare?: () => void;
  shareNote?: string;
  /** Bumped with every share note, even an identical one, so a repeated note is a new node and is announced again. */
  shareNoteKey?: number;
  shareLink?: string;
};

export default function ReportView({ r, onCopy, onShare, shareNote, shareNoteKey = 0, shareLink }: Props) {
  // The note and a count: a second "Copied" (or "Could not copy") is a new node, so a screen reader announces it again.
  const [copied, setCopied] = useState({ text: "", n: 0 });
  // A shared report can sit above the reader's own: its regions need names of their own (one name, one landmark).
  const name = (label: string) => (onShare ? label : `Shared report: ${label.charAt(0).toLowerCase()}${label.slice(1)}`);
  const copy = async () => {
    const text = await copyNote(onCopy);
    setCopied((c) => ({ text, n: c.n + 1 }));
  };
  return (
    <section className="card result">
      <div className="row between">
        <h2 className={`verdict ${r.verdict}`}>{VERDICT[r.verdict]}</h2>
        <div className="row">
          {onShare && (
            <button className="ghost" onClick={onShare}>
              Share link
            </button>
          )}
          <button className="ghost" onClick={copy}>
            Copy report
          </button>
        </div>
      </div>
      {/* Live regions stay mounted and only their text changes: a region inserted together with its text is often not announced. */}
      <p className="small muted live" role="status">
        <span key={shareNoteKey}>{shareNote}</span>
      </p>
      <p className="small muted live" role="status">
        <span key={copied.n}>{copied.text}</span>
      </p>
      {shareLink && <input className="share-link" readOnly value={shareLink} aria-label="Shareable report link" onFocus={(e) => e.currentTarget.select()} />}
      <p className="muted">{r.message}</p>

      {r.counterexample && (
        <div className="cx">
          <div className="label">{cxHeading(r.counterexample)}</div>
          <code className="big">solve({fmtArgs(r.counterexample.args)})</code>
          <div className="cmp">
            <div>
              <span className="label">expected</span>
              <code>{showValue(r.counterexample.expected)}</code>
            </div>
            <div>
              <span className="label">got</span>
              <code className="bad">{r.counterexample.got}</code>
            </div>
          </div>
          <p className="muted small">
            Shrunk from <code>{ellipsize(fmtArgs(r.counterexample.original.args), 120)}</code> (family {r.counterexample.original.family}) in {r.counterexample.shrinkSteps} steps,{" "}
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
              {fixSummary(r.fix)}
            </span>
          </div>
          <FixView before={r.solution.code} after={r.fix.code} name={name} />
        </>
      )}

      {r.research && (
        <>
          <div className="label">{researchHeading(r.setup.research)}</div>
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
      <div className="scroll" tabIndex={0} role="region" aria-label={name("Attack families table")}>
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
      <div className="scroll" tabIndex={0} role="region" aria-label={name("Model routing per step table")}>
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
                  {s.simulated && <span className="small muted"> (replay)</span>}
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
      {r.stages.some((s) => s.simulated) && <p className="muted small">* Replay mode: no model ran. A hand-written stand-in answered each step, so the model column names the model that step uses live; token counts are estimated from text length and latency is simulated.</p>}

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

/** The proposed fix as a diff against the submitted code (default), or in full. */
function FixView({ before, after, name }: { before: string; after: string; name: (label: string) => string }) {
  const [full, setFull] = useState(false);
  // Quadratic in the number of lines: compute once per (before, after), not on every render.
  const diff = useMemo(() => lineDiff(before, after), [before, after]);
  const changed = diff ? diff.filter((l) => l.op !== "same").length : 0;
  // One toggle button in a fixed place, so it keeps keyboard focus when the view switches.
  const toggle = diff && (
    <div className="row between">
      <span className="small muted">
        {changed} changed line{changed === 1 ? "" : "s"} against your code
      </span>
      <button className="ghost small" onClick={() => setFull(!full)}>
        {full ? "Show changes only" : "Show full fix"}
      </button>
    </div>
  );
  if (!diff || full) {
    return (
      <>
        {toggle}
        <pre className="code-out" tabIndex={0} role="region" aria-label={name("Proposed fix")}>
          {after}
        </pre>
      </>
    );
  }
  return (
    <>
      {toggle}
      <pre className="code-out diff" tabIndex={0} role="region" aria-label={name("Diff of the proposed fix against your code")}>
        {diff.map((l, i) => (
          <div key={i} className={`dl ${l.op}`}>
            <span className="sign" aria-hidden="true">
              {l.op === "add" ? "+" : l.op === "del" ? "-" : " "}
            </span>
            {l.op !== "same" && <span className="sr-only">{l.op === "add" ? "added: " : "removed: "}</span>}
            {l.text || " "}
          </div>
        ))}
      </pre>
    </>
  );
}
