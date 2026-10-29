/**
 * Browser smoke test for the UI wiring that unit tests cannot reach: the
 * components, the NDJSON stream, cancel, share links and the 390 px layout, in
 * a real Chromium against a real `next start`.
 *
 *   pnpm build && pnpm e2e
 *
 * It starts the production server itself on a free port in replay mode (no
 * keys, local executor), puts a small proxy in front of it so a stream can be
 * slowed down and an aborted request observed, drives the page with
 * Playwright, and always stops the server. Exits non-zero on the first failed
 * check, or if the page threw. Needs a build in .next and Chromium installed
 * for Playwright (`pnpm exec playwright install chromium`).
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const VIEWPORT = { width: 390, height: 844 };
const LONG_URL = "https://example.com/" + "a".repeat(70); // 90 characters, no break opportunity
const LONG_ARGS = Array.from({ length: 60 }, (_, i) => 1_000_000 + i * 7919);

if (!existsSync(`${root}.next/BUILD_ID`)) {
  console.error("e2e: no production build found (.next/BUILD_ID is missing). Run `pnpm build` first, then `pnpm e2e`.");
  process.exit(2);
}

// A stale build would test yesterday's UI: refuse when any source file is newer than the build.
function newestUnder(dir) {
  let newest = { path: "", mtimeMs: 0 };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    const found = entry.isDirectory() ? newestUnder(path) : { path, mtimeMs: statSync(path).mtimeMs };
    if (found.mtimeMs > newest.mtimeMs) newest = found;
  }
  return newest;
}
const builtAt = statSync(`${root}.next/BUILD_ID`).mtimeMs;
const newest = newestUnder(`${root}src`);
if (newest.mtimeMs > builtAt) {
  console.error(`e2e: the build is older than ${newest.path.slice(root.length)} (changed ${new Date(newest.mtimeMs).toISOString()}, built ${new Date(builtAt).toISOString()}). Run \`pnpm build\` again, then \`pnpm e2e\`.`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// ---------------------------------------------------------------- the server

const cleanups = [];
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const fn of cleanups.reverse()) await fn().catch(() => {});
}
const serverPort = await freePort();
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const serverEnv = { ...process.env, NODE_ENV: "production", REPLAY: "1", ALLOW_LOCAL_EXECUTOR: "1", REPLAY_RATE_LIMIT_PER_HOUR: "1000" };
for (const k of ["NEBIUS_API_KEY", "TAVILY_API_KEY", "JUDGE0_URL", "VERCEL"]) delete serverEnv[k];
const server = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(serverPort)], { cwd: root, env: serverEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
// Last resort if the process is killed or crashes: the server must not outlive the test.
const killNow = () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
};
process.on("exit", killNow);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => cleanup().finally(() => process.exit(130)));
let serverLog = "";
let serverExit = null;
for (const stream of [server.stdout, server.stderr]) stream.on("data", (d) => (serverLog = (serverLog + d).slice(-4000)));
server.on("exit", (code, signal) => (serverExit = `exited with ${code ?? signal}`));
cleanups.push(async () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    return;
  }
  for (let i = 0; i < 30 && serverExit === null; i++) await sleep(100);
  killNow();
});

// -------------------------------------------------------------- the proxy

/** Sits between the browser and next: can pace /api/attack line by line, and records requests the browser dropped. */
const pace = { lineDelayMs: 0 };
const attacks = [];
const proxy = http.createServer((req, res) => {
  const record = req.url === "/api/attack" ? { aborted: false, finished: false } : null;
  if (record) attacks.push(record);
  const up = http.request({ host: "127.0.0.1", port: serverPort, path: req.url, method: req.method, headers: req.headers }, async (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, upRes.headers);
    res.on("close", () => {
      if (record && !res.writableEnded) record.aborted = true;
      upRes.destroy();
    });
    try {
      if (!record) {
        upRes.pipe(res);
        return;
      }
      let buf = "";
      for await (const chunk of upRes) {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          res.write(buf.slice(0, nl + 1));
          buf = buf.slice(nl + 1);
          if (pace.lineDelayMs) await sleep(pace.lineDelayMs);
        }
      }
      res.end(buf);
      record.finished = true;
    } catch {
      res.destroy();
    }
  });
  up.on("error", () => res.destroy());
  req.pipe(up);
});
const proxyPort = await freePort();
await new Promise((r) => proxy.listen(proxyPort, "127.0.0.1", r));
cleanups.push(() => new Promise((r) => (proxy.closeAllConnections(), proxy.close(() => r()))));
const base = `http://127.0.0.1:${proxyPort}`;

// ------------------------------------------------------------------ checks

const pageErrors = [];
let step = "";
const ok = (name) => console.log(`ok    ${name}`);
const check = (cond, message) => {
  if (!cond) throw new Error(`${step}: ${message}`);
};
const eq = (actual, expected, what) => check(actual === expected, `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/** The page must not scroll sideways; on failure, name the elements that stick out. */
async function noHorizontalOverflow(page, what) {
  const r = await page.evaluate(() => {
    const width = window.innerWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > width + 1 && !el.closest(".scroll, .trace-scroll, .code-out, textarea, .sr-only"))
      .slice(0, 4)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    return { over: document.documentElement.scrollWidth > width, scrollWidth: document.documentElement.scrollWidth, width, wide };
  });
  check(!r.over, `${what}: the page scrolls sideways (${r.scrollWidth} px in a ${r.width} px window; wide: ${r.wide.join(", ") || "none"})`);
}

const attackButton = (page) => page.getByRole("button", { name: "Attack this solution", exact: true });

/** A complete report as the server sends it, with long unbreakable text in every place the page shows it. */
function longTextReport() {
  const stage = { stage: "oracle", purpose: "oracle", role: "reasoning", model: "nvidia/model", why: "why", calls: 1, promptTokens: 1, completionTokens: 1, costUsd: 0.001, latencyMs: 10, simulated: false };
  return {
    verdict: "counterexample",
    message: `See ${LONG_URL} for the details.`,
    problem: { id: "binary-search", title: "Binary search" },
    solution: { language: "python", code: "def solve(a, t):\n    return -1\n", entry: "solve" },
    setup: { provider: "replay", executor: "Local", research: "none", routing: "routed", reasoningModel: "u", fastModel: "s" },
    research: { queries: ["q"], facts: [{ fact: `Documented at ${LONG_URL}`, url: "https://example.com/doc" }], influencedFamilies: [LONG_URL] },
    families: [{ name: "f", rationale: "r", citations: [], source: "model", generated: 1, dropped: 0, tested: 1, mismatches: 1, oracleSkipped: 0 }],
    counterexample: { args: [[0], 0], expected: 0, got: "-1", original: { args: [LONG_ARGS], family: "f" }, shrinkSteps: 1, shrinkEvals: 1, shrinkExhausted: false },
    explanation: `It fails because of ${LONG_URL}`,
    fix: { code: "def solve(a, t):\n    return 0\n", verified: true, attempts: 1, reattackInputs: 10, reattackMismatches: 0, reattackUnjudged: 0 },
    stats: { modelCalls: 1, runs: 1, inputsTested: 1, wallMs: 1, timeToFirstCounterexampleMs: 1, costUsd: 0.001, unpricedCalls: 0, simulatedModelMs: 0 },
    stages: [stage],
  };
}

/** A solution that never loaded: every example "mismatches", but there is no counterexample to time or show. */
function compileErrorReport() {
  const r = longTextReport();
  delete r.counterexample;
  delete r.explanation;
  delete r.fix;
  delete r.research;
  return { ...r, verdict: "compile_error", message: "SyntaxError: invalid syntax", stats: { ...r.stats, timeToFirstCounterexampleMs: null, simulatedModelMs: 7000 } };
}

async function main() {
  // Wait for the server (or learn why it died).
  for (let i = 0; ; i++) {
    if (serverExit) throw new Error(`next start ${serverExit}:\n${serverLog}`);
    if (await fetch(`http://127.0.0.1:${serverPort}/api/problems`).then((r) => r.ok, () => false)) break;
    if (i > 300) throw new Error(`next start did not answer in 30 s:\n${serverLog}`);
    await sleep(100);
  }

  const browser = await chromium.launch();
  cleanups.push(() => browser.close());
  const ctx = await browser.newContext({ viewport: VIEWPORT, permissions: ["clipboard-read", "clipboard-write"] });
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
    // Chromium logs "Failed to load resource" for the failures this script injects on purpose (a 504, a reset connection); anything else is a real error.
    p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && pageErrors.push(`console.error: ${m.text()}`));
  });
  const page = await ctx.newPage();

  step = "attack a built-in to a verdict";
  await page.goto(base);
  await page.getByText("Replay mode: hand-written stand-ins for model answers, real execution").waitFor({ timeout: 15_000 });
  await attackButton(page).click();
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  eq(await page.locator("h2.verdict").innerText(), "Broken: minimal counterexample found", "verdict");
  check(/^solve\(/.test(await page.locator(".cx code.big").innerText()), "the minimal counterexample is shown");
  check((await page.locator(".trace li.ev").count()) > 5, "the live trace has events");
  check((await page.locator("p.sr-only[role=status]").innerText()).startsWith("Broken"), "the verdict is announced");
  await attackButton(page).waitFor();
  eq(await page.locator("p.err[role=alert]").count(), 0, "no error alert after a clean run");
  const firstCx = await page.locator(".cx code.big").innerText();
  // The claims the page makes: the sandbox it ran in, why each model was chosen, and the problem's examples.
  check((await page.locator(".badges .badge").allInnerTexts()).some((t) => /local|judge0/i.test(t)), "the executor badge names where the code ran");
  check((await page.locator(".trace .why").count()) > 0 && (await page.locator(".trace .why").first().innerText()).trim().length > 0, "model calls in the trace say why that model was chosen");
  check((await page.locator("ul.examples li").count()) > 0, "the problem's examples are listed");
  // Every research fact is cited, in the live trace and in the report, with a link to its https source.
  const traceSources = await page.locator(".trace .facts a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  const traceTargets = await page.locator(".trace .facts a").evaluateAll((as) => as.map((a) => a.getAttribute("target") ?? ""));
  check(traceTargets.length > 0 && traceTargets.every((t) => t === "_blank"), `each research source opens in a new tab, not the running one (${traceTargets.join(", ")})`);
  const reportSources = await page.locator(".result .facts a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  check(traceSources.length > 0 && traceSources.every((h) => h.startsWith("https://")), `the trace cites each research fact's source (${traceSources.join(", ")})`);
  check(reportSources.length > 0 && reportSources.every((h) => h.startsWith("https://")), `the report cites each research fact's source (${reportSources.join(", ")})`);
  check((await page.locator(".result .facts li").first().innerText()).replace(/\s*source$/, "").trim().length > 10, "the report shows the research fact's text");
  await noHorizontalOverflow(page, "report at 390 px");
  ok(step);

  step = "share link round trip";
  await page.getByRole("button", { name: "Share link" }).click();
  const link = await page.locator("input.share-link").inputValue();
  check(link.startsWith(`${base}/#r=1.`), `the link points at this page's fragment (${link.slice(0, 60)})`);
  await page.locator(".result .live", { hasText: "Link copied" }).waitFor();
  eq(await page.evaluate(() => navigator.clipboard.readText()), link, "clipboard");
  const shared = await ctx.newPage();
  await shared.goto(link);
  await shared.locator(".shared h2.verdict").waitFor({ timeout: 15_000 });
  eq(await shared.locator(".shared h2.verdict").innerText(), "Broken: minimal counterexample found", "shared verdict");
  eq(await shared.locator(".shared .cx code.big").innerText(), firstCx, "shared counterexample");
  check((await shared.locator(".shared > .row p").innerText()).includes("decoded in your browser"), "the shared banner says it was decoded locally");
  eq(await shared.locator(".shared > .row p").getAttribute("role"), "status", "the shared banner's role (opening a link is announced)");
  const banner = await shared.locator(".shared > .row p").innerText();
  check(banner.includes("(Broken: minimal counterexample found)"), `the shared banner names the verdict (${banner.slice(0, 80)})`);
  check(banner.includes("a link can say anything, so re-run the attack to check it"), "the shared banner says a link can say anything");
  // A second report of the same problem and verdict (another run: its timings differ, so its link does): announced too.
  await page.getByRole("button", { name: "Attack this solution", exact: true }).click();
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "Share link" }).click();
  const sameProblem = await page.locator("input.share-link").inputValue();
  check(sameProblem !== link, "a second run of the same problem has its own link");
  await shared.evaluate(() => {
    window.__banner = 0;
    new MutationObserver((ms) => ms.forEach((m) => (window.__banner += m.addedNodes.length))).observe(document.querySelector(".shared > .row p"), { childList: true, subtree: true });
  });
  await shared.evaluate((l) => (window.location.hash = new URL(l).hash), sameProblem);
  await shared.waitForFunction(() => window.__banner > 0, null, { timeout: 15_000 }).catch(() => check(false, "a second shared report of the same problem and verdict is announced"));
  await noHorizontalOverflow(shared, "shared report at 390 px");
  ok(step);

  step = "a second share link starts a fresh report view";
  await shared.locator(".shared").getByRole("button", { name: "Copy report" }).click();
  await shared.locator(".shared .result .live", { hasText: "Copied to the clipboard" }).waitFor();
  check((await shared.evaluate(() => navigator.clipboard.readText())).startsWith("# Counterexample report: "), "Copy report on a shared report puts its Markdown on the clipboard");
  await shared.locator(".shared").getByRole("button", { name: "Show full fix" }).click();
  await shared.locator(".shared").getByRole("button", { name: "Show changes only" }).waitFor();
  // The full view is the corrected solution, not the submitted code: the binary-search fix loops while lo <= hi.
  const fullFix = await shared.locator(".shared pre.code-out").innerText();
  check(fullFix.includes("while lo <= hi") && !fullFix.includes("while lo < hi"), `"Show full fix" shows the fix (${fullFix.slice(0, 80)})`);
  // Make a second, different report and open its link in the same tab (a hash change, not a reload).
  await page.getByRole("button", { name: "Integer square root", exact: true }).click();
  await attackButton(page).click();
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "Share link" }).click();
  const link2 = await page.locator("input.share-link").inputValue();
  check(link2 !== link, "the second report has its own link");
  await shared.evaluate((l) => (window.location.hash = new URL(l).hash), link2);
  await shared.locator(".shared .cx code.big", { hasText: "2147483647" }).waitFor({ timeout: 15_000 });
  eq(await shared.locator(".shared .result .live").allInnerTexts().then((t) => t.join("")), "", "the second report must not show the first one's 'Copied' note");
  await shared.locator(".shared").getByRole("button", { name: "Show full fix" }).waitFor({ timeout: 2_000 });
  ok(step);

  step = "keyboard focus stays where the reader put it";
  const focused = (p) => p.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.textContent?.trim().slice(0, 40) ?? ""}`);
  await shared.locator(".shared").getByRole("button", { name: "Show full fix" }).focus();
  await shared.keyboard.press("Enter");
  eq(await focused(shared), "BUTTON:Show changes only", "focus after showing the full fix");
  await shared.keyboard.press("Enter");
  eq(await focused(shared), "BUTTON:Show full fix", "focus after showing the changes only");
  await shared.getByRole("button", { name: "Close", exact: true }).focus();
  await shared.keyboard.press("Enter");
  eq(await focused(shared), "BUTTON:Attack this solution", "focus after closing the shared report");
  // Editing the code while a run streams: the run's end must not pull focus to the Attack button.
  pace.lineDelayMs = 40;
  const cancelButton = page.getByRole("button", { name: "Cancel", exact: true });
  await attackButton(page).click();
  await cancelButton.waitFor({ timeout: 15_000 });
  await page.locator("textarea.code").click();
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  pace.lineDelayMs = 0;
  eq(await page.evaluate(() => document.activeElement?.tagName), "TEXTAREA", "focus in the code editor after the run ended");
  // A run started and ended from the keyboard still returns focus to the Attack button.
  pace.lineDelayMs = 40;
  await attackButton(page).focus();
  await page.keyboard.press("Enter");
  await cancelButton.waitFor({ timeout: 15_000 });
  eq(await focused(page), "BUTTON:Cancel", "focus while a keyboard run is on");
  pace.lineDelayMs = 0;
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  await attackButton(page).waitFor();
  eq(await focused(page), "BUTTON:Attack this solution", "focus after a keyboard run ended");
  // Enter held down on Attack: its repeats land on Cancel once focus moves there, and must not cancel the run; held
  // past the run's end, they land on Attack again and must not start another.
  const heldFrom = attacks.length;
  await page.keyboard.down("Enter");
  await cancelButton.waitFor({ timeout: 15_000 });
  for (let i = 0; i < 3; i++) await page.keyboard.down("Enter");
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Attack this solution", null, { timeout: 15_000 });
  for (let i = 0; i < 3; i++) await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await sleep(500);
  eq(await page.locator(".note", { hasText: "Attack cancelled" }).count(), 0, "cancel notes after holding Enter on Attack");
  eq(attacks.length - heldFrom, 1, "attacks started by holding Enter on Attack");
  // Enter tapped twice quickly: the second press lands on Cancel as the run starts, and must not cancel it.
  pace.lineDelayMs = 40;
  const tappedFrom = attacks.length;
  await attackButton(page).focus();
  await page.keyboard.press("Enter");
  await sleep(60);
  await page.keyboard.press("Enter");
  pace.lineDelayMs = 0;
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  eq(await page.locator(".note", { hasText: "Attack cancelled" }).count(), 0, "cancel notes after a double-tapped Enter on Attack");
  eq(attacks.length - tappedFrom, 1, "attacks started by a double-tapped Enter on Attack");
  // Space tapped twice the same way.
  pace.lineDelayMs = 40;
  const spacedFrom = attacks.length;
  await attackButton(page).focus();
  await page.keyboard.press(" ");
  await sleep(60);
  await page.keyboard.press(" ");
  pace.lineDelayMs = 0;
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  eq(await page.locator(".note", { hasText: "Attack cancelled" }).count(), 0, "cancel notes after a double-tapped Space on Attack");
  eq(attacks.length - spacedFrom, 1, "attacks started by a double-tapped Space on Attack");
  // A double-click on Attack's right edge, where Cancel appears: one run, not cancelled.
  pace.lineDelayMs = 40;
  const edgeFrom = attacks.length;
  const box = await attackButton(page).boundingBox();
  await page.mouse.dblclick(box.x + box.width - 4, box.y + box.height / 2);
  pace.lineDelayMs = 0;
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  eq(await page.locator(".note", { hasText: "Attack cancelled" }).count(), 0, "cancel notes after a double-click on Attack's right edge");
  eq(attacks.length - edgeFrom, 1, "attacks started by a double-click on Attack's right edge");
  // A second click in Attack's centre while the run goes on (left of where Cancel appears): the button is disabled, no second run.
  pace.lineDelayMs = 300;
  const centreFrom = attacks.length;
  await attackButton(page).click();
  await page.waitForTimeout(700);
  // While it runs the button reads "Attacking…".
  const go = page.locator("button.go");
  check((await go.innerText()) === "Attacking…" && (await go.isDisabled()), "Attack is disabled while a run goes on");
  const centre = await go.boundingBox();
  await page.mouse.click(centre.x + centre.width * 0.25, centre.y + centre.height / 2);
  pace.lineDelayMs = 0;
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  eq(attacks.length - centreFrom, 1, "attacks started by a second click on Attack's left half during a run");
  // Cancelling from the keyboard, then a quick second Enter that lands on Attack as focus returns: no new run.
  pace.lineDelayMs = 300;
  const keyCancelFrom = attacks.length;
  await attackButton(page).focus();
  await page.keyboard.press("Enter");
  await cancelButton.waitFor({ timeout: 15_000 });
  await sleep(700);
  await page.keyboard.press("Enter");
  await page.locator(".note", { hasText: "Attack cancelled" }).waitFor({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await sleep(500);
  pace.lineDelayMs = 0;
  eq(attacks.length - keyCancelFrom, 1, "attacks started by Enter, Enter on Cancel, then a quick Enter on Attack");
  eq(await cancelButton.count(), 0, "Cancel buttons after a quick Enter that follows a keyboard cancel");
  // A deliberate click on Cancel shortly after the start (past the 300 ms tap window) does cancel.
  pace.lineDelayMs = 300;
  await attackButton(page).click();
  await cancelButton.waitFor({ timeout: 15_000 });
  await sleep(400);
  await cancelButton.click();
  await page.locator(".note", { hasText: "Attack cancelled" }).waitFor({ timeout: 15_000 });
  pace.lineDelayMs = 0;
  ok(step);

  step = "switching problems or starting a run lets go of what came before";
  // Picking another problem mid-run must abort the request, or the server keeps the attack (a slot and its spend) for up to 50 s.
  pace.lineDelayMs = 300;
  const beforeSwitch = attacks.length;
  await attackButton(page).click();
  await cancelButton.waitFor({ timeout: 15_000 });
  await page.locator(".trace li.ev").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Integer square root", exact: true }).click();
  await sleep(500);
  pace.lineDelayMs = 0;
  const switched = attacks[beforeSwitch];
  check(switched !== undefined, "the attack request reached the server");
  check(switched.aborted && !switched.finished, "picking another problem aborted the running attack's request");
  // A share link opened during a run, then closed: Attack is disabled then, so focus goes to Cancel, not to <body>.
  pace.lineDelayMs = 300;
  await attackButton(page).click();
  await cancelButton.waitFor({ timeout: 15_000 });
  await page.evaluate((l) => (window.location.hash = new URL(l).hash), link2);
  await page.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Enter");
  eq(await focused(page), "BUTTON:Cancel", "focus after closing a shared report during a run");
  await cancelButton.click();
  pace.lineDelayMs = 0;
  // Picking a problem while a shared report is open closes the report along with its link.
  const reader = await ctx.newPage();
  await reader.goto(link2);
  await reader.locator(".shared", { hasText: "Shared report for" }).waitFor({ timeout: 15_000 });
  await reader.getByRole("button", { name: "Binary search", exact: true }).click();
  eq(await reader.locator(".shared").count(), 0, "shared reports open after picking a problem");
  eq(await reader.evaluate(() => window.location.hash), "", "the share fragment after picking a problem");
  await reader.close();
  // A run started on a page opened from a share link drops the link from the address bar.
  await shared.evaluate((l) => (window.location.hash = new URL(l).hash), link2);
  await shared.locator(".shared .cx code.big").waitFor({ timeout: 15_000 });
  await attackButton(shared).click();
  eq(await shared.evaluate(() => window.location.hash), "", "the share fragment after starting a run");
  await shared.locator("h2.verdict").waitFor({ timeout: 90_000 });
  ok(step);

  step = "the form sends what it shows, and the report's tools work";
  // Mid-run, the trace is a bounded scroller that shows the newest event as each one arrives.
  pace.lineDelayMs = 150;
  await attackButton(page).click();
  await page.waitForFunction(() => {
    const el = document.querySelector(".trace-scroll");
    return el && el.scrollHeight - el.clientHeight > 100;
  }, null, { timeout: 60_000 });
  check(await page.getByRole("button", { name: "Cancel" }).isVisible(), "the trace overflows its box while the run is still going");
  const traceCount = await page.locator(".trace-scroll li").count();
  await page.waitForFunction((n) => document.querySelectorAll(".trace-scroll li").length > n, traceCount, { timeout: 30_000 });
  await page.waitForTimeout(100);
  const midBehind = await page.locator(".trace-scroll").evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  check(midBehind <= 2, `mid-run, the trace shows its newest event (${midBehind} px short)`);
  pace.lineDelayMs = 0;
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  const bodies = [];
  await page.route("**/api/attack", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.continue();
  });
  const settled = () => page.waitForFunction(() => !document.querySelector("button.go")?.disabled, null, { timeout: 90_000 });
  await page.getByRole("button", { name: "Integer square root", exact: true }).click();
  const demoLanguage = await page.getByLabel("Language").inputValue();
  await attackButton(page).click();
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  eq(JSON.stringify([bodies[0]?.problemId, bodies[0]?.routing, bodies[0]?.research, bodies[0]?.language]), JSON.stringify(["isqrt", "routed", "auto", demoLanguage]), "request body by default");
  // The trace follows the newest event, and its download is the same events, one JSON object per line.
  const scroll = await page.locator(".trace-scroll").evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  check(scroll <= 2, `the trace is scrolled to its newest event (${scroll} px short)`);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "trace.jsonl" }).click()]);
  const jsonl = readFileSync(await dl.path(), "utf8");
  check(jsonl.endsWith("\n"), "the trace download ends with a newline");
  const traced = jsonl.trim().split("\n").map((l) => JSON.parse(l));
  eq(traced.length, await page.locator(".trace li.ev").count(), "events in the trace download");
  // Share puts the report's link in the address bar too.
  await page.getByRole("button", { name: "Share link" }).click();
  const linked = await page.waitForFunction(() => window.location.hash.startsWith("#r=1."), null, { timeout: 15_000 }).then(() => true, () => false);
  check(linked, "the address bar holds the share link after Share");
  // A share whose clipboard answers after the reader moved on must not put its old link back in the address bar.
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => new Promise((resolve) => setTimeout(() => resolve(write(t)), 1_500));
  });
  await page.getByRole("button", { name: "Share link" }).click();
  await page.getByRole("button", { name: "Integer square root", exact: true }).click();
  await sleep(2_500);
  eq(await page.evaluate(() => window.location.hash), "", "the address bar after a late share for a report no longer shown");
  // Every control the reader can change reaches the request.
  const otherLanguage = demoLanguage === "python" ? "javascript" : "python";
  // One option at a time, so that two options wired to each other's fields cannot pass.
  await page.getByLabel("Ultra for everything (baseline)").check();
  await page.getByLabel("Language").selectOption(otherLanguage);
  await attackButton(page).click();
  await settled();
  eq(JSON.stringify([bodies[1]?.problemId, bodies[1]?.routing, bodies[1]?.research, bodies[1]?.language]), JSON.stringify(["isqrt", "ultra-only", "auto", otherLanguage]), "request body with Ultra ticked and the language changed");
  await page.getByLabel("Ultra for everything (baseline)").uncheck();
  check((await page.getByLabel("Research the web (Tavily)").getAttribute("aria-describedby")) === "research-hint" && (await page.locator("#research-hint").isVisible()), "the research option's explanation is shown and tied to its checkbox");
  eq(await page.locator("#research-hint").innerText(), "In replay mode no web search runs: research shows hand-written stand-in results for the built-in problems, in place of Tavily's.", "the research option's explanation in replay mode");
  await page.getByLabel("Research the web (Tavily)").check();
  await page.getByRole("button", { name: "Your own", exact: true }).click();
  check((await page.getByRole("textbox", { name: "Problem statement" }).count()) === 1, "the statement box has a name of its own");
  const [phColor, mutedColor] = await page.locator("textarea.statement-in").evaluate((el) => [getComputedStyle(el, "::placeholder").color, getComputedStyle(document.querySelector(".sub")).color]);
  eq(phColor, mutedColor, "the statement placeholder's colour (the muted text colour, 5.3:1 and 7.5:1)");
  await page.locator("textarea.statement-in").fill("Return x + 1.");
  await page.locator("textarea.code").fill("def solve(x):\n    return x + 1\n");
  await attackButton(page).click();
  await settled();
  const own = bodies[2] ?? {};
  check(!("problemId" in own) && own.statement === "Return x + 1." && own.code.startsWith("def solve") && own.routing === "routed" && own.research === "force", `"Your own" sends the statement, no problem id, and research ticked alone (${JSON.stringify(own).slice(0, 160)})`);
  await page.getByLabel("Research the web (Tavily)").uncheck();
  await page.unroute("**/api/attack");
  // A new run clears the last report's share note, and a share still waiting on the clipboard when it starts writes nothing.
  // The own report's share note (the first live region on the page is the shared-report banner's).
  const shareNote = page.locator("section.result").last().locator("p.live").first();
  await page.getByRole("button", { name: "Integer square root", exact: true }).click();
  await attackButton(page).click();
  await settled();
  await page.getByRole("button", { name: "Share link" }).click();
  await page.locator("p.live", { hasText: "Link copied" }).waitFor({ timeout: 15_000 });
  await attackButton(page).click();
  await settled();
  eq(await shareNote.innerText(), "", "the share note after a new run");
  await page.getByRole("button", { name: "Share link" }).click();
  await attackButton(page).click();
  await settled();
  await sleep(2_500);
  eq(await page.evaluate(() => window.location.hash), "", "the address bar after a late share for a report a new run replaced");
  eq(await shareNote.innerText(), "", "the share note after a late share for a report a new run replaced");
  // A share link pasted into the tab while a share still waits on the clipboard: the pasted link stays in the address bar.
  await page.getByRole("button", { name: "Share link" }).click();
  const pasted = new URL(link2).hash;
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate((h) => (window.location.hash = h), pasted);
  await page.locator(".shared .cx code.big").waitFor({ timeout: 15_000 });
  // The shared report opens far above the reader's own: it is brought into view.
  const bannerTop = await page.locator(".shared").evaluate((el) => el.getBoundingClientRect().top);
  check(bannerTop >= -1 && bannerTop < 200, `the pasted shared report is scrolled into view (its top is at ${Math.round(bannerTop)} px)`);
  await sleep(2_500);
  eq(await page.evaluate(() => window.location.hash), pasted, "the address bar after a late share while a pasted link opened");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // Copy twice: the same "Copied" note twice is two announcements (a new node each time), not one.
  await page.evaluate(() => {
    window.__notes = 0;
    const region = [...document.querySelectorAll("section.result")].at(-1)?.querySelectorAll("p.live")[1];
    new MutationObserver((ms) => ms.forEach((m) => (window.__notes += m.addedNodes.length))).observe(region, { childList: true, subtree: true });
  });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Copy report" }).click();
    await page.waitForFunction((n) => window.__notes >= n, i + 1, { timeout: 15_000 }).catch(() => check(false, `copy ${i + 1} announces a note`));
  }
  // What was copied is the report, as Markdown.
  await sleep(1_700);
  check((await page.evaluate(() => navigator.clipboard.readText())).startsWith("# Counterexample report: "), "Copy report puts the Markdown report on the clipboard");
  // Share twice: two announcements as well.
  await page.evaluate(() => {
    window.__shares = 0;
    const region = [...document.querySelectorAll("section.result")].at(-1)?.querySelectorAll("p.live")[0];
    new MutationObserver((ms) => ms.forEach((m) => (window.__shares += m.addedNodes.length))).observe(region, { childList: true, subtree: true });
  });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Share link" }).click();
    await page.waitForFunction((n) => window.__shares >= n, i + 1, { timeout: 15_000 }).catch(() => check(false, `share ${i + 1} announces a note`));
  }
  // A clipboard that refuses: the note says to copy the link by hand, not that it was copied.
  await page.evaluate(() => (navigator.clipboard.writeText = () => Promise.reject(new Error("denied"))));
  await page.getByRole("button", { name: "Share link" }).click();
  await page.locator("p.live", { hasText: "Copy this link" }).waitFor({ timeout: 15_000 });
  // A new run lets go of the last report's share link, and of a shared report open above it.
  await page.evaluate((l) => (window.location.hash = new URL(l).hash), link2);
  await page.locator(".shared .cx code.big").waitFor({ timeout: 15_000 });
  await attackButton(page).click();
  await settled();
  eq(await page.locator("input.share-link").count(), 0, "share-link fields after a new run");
  eq(await page.locator(".shared").count(), 0, "shared reports open after a new run");
  ok(step);

  step = "cancel a run mid-stream";
  await page.getByRole("button", { name: "Binary search", exact: true }).click();
  pace.lineDelayMs = 300;
  const before = attacks.length;
  await attackButton(page).click();
  await page.locator(".trace li.ev").first().waitFor({ timeout: 30_000 });
  await sleep(700); // a deliberate cancel, after the window in which a second click or key press counts as an echo of Attack
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".note", { hasText: "Attack cancelled; the partial trace is shown." }).waitFor({ timeout: 15_000 });
  eq(await page.locator("h2.verdict").count(), 0, "no verdict after a cancel");
  eq(await page.locator("p.err[role=alert]").count(), 0, "no error alert after a cancel");
  await attackButton(page).waitFor({ timeout: 2_000 });
  // Cancel must tear the request down, not just hide it: the browser drops the connection while the server is still sending.
  const mine = attacks[before];
  check(mine !== undefined, "the attack request reached the server");
  for (let i = 0; i < 50 && !mine.aborted; i++) await sleep(100);
  check(mine.aborted && !mine.finished, "cancelling aborted the request (the stream was still running when the browser hung up)");
  const shown = await page.locator(".trace li.ev").count();
  await sleep(1_200);
  eq(await page.locator(".trace li.ev").count(), shown, "the trace stops growing after a cancel");
  // A double-click on Cancel: its second click lands where Attack grows into Cancel's place, and must not start a run.
  const beforeDouble = attacks.length;
  await attackButton(page).click();
  await page.locator(".trace li.ev").first().waitFor({ timeout: 30_000 });
  await sleep(700); // a deliberate cancel, after the window in which a second click or key press counts as an echo of Attack
  await page.getByRole("button", { name: "Cancel", exact: true }).dblclick();
  await sleep(1_000);
  eq(attacks.length - beforeDouble, 1, "attacks started by a run and a double-click on its Cancel");
  eq(await page.getByRole("button", { name: "Cancel", exact: true }).count(), 0, "Cancel buttons after a double-click on Cancel");
  pace.lineDelayMs = 0;
  ok(step);

  step = "a bad response shows a readable error and the page survives";
  const respond = (body, status = 200) => (route) => route.fulfill({ status, contentType: "application/x-ndjson", body });
  const expectAlert = async (text) => {
    await attackButton(page).click();
    await page.locator("p.err[role=alert]", { hasText: text }).waitFor({ timeout: 15_000 });
    await attackButton(page).waitFor({ timeout: 2_000 });
    check(!(await page.locator("body").innerText()).includes("Something went wrong"), "the error boundary did not take over the page");
  };
  await page.route("**/api/attack", respond('{"type":"event"}\n'));
  await expectAlert("The server sent an unreadable response.");
  await page.unroute("**/api/attack");
  await page.route("**/api/attack", (route) => route.fulfill({ status: 504, contentType: "text/html", body: "<html>gateway timeout</html>" }));
  await expectAlert("The server returned HTTP 504.");
  await page.unroute("**/api/attack");
  await page.route("**/api/attack", respond('{"type":"error","error":""}\n'));
  await expectAlert("The server reported an error without details.");
  await page.unroute("**/api/attack");
  await page.route("**/api/attack", (route) => route.abort("connectionreset"));
  await expectAlert("Could not reach the server.");
  await page.unroute("**/api/attack");
  ok(step);

  step = "long unbreakable text does not widen the page at 390 px";
  const lines = [
    { type: "mode", mode: "replay", executor: "Local" },
    { type: "event", event: { seq: 0, t: 1, stage: "research", kind: "research", msg: `Fetched ${LONG_URL}`, data: { facts: [{ fact: `Documented at ${LONG_URL}`, url: "https://example.com/doc" }] } } },
    { type: "report", report: longTextReport() },
  ];
  await page.route("**/api/attack", respond(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
  await attackButton(page).click();
  await page.locator("h2.verdict").waitFor({ timeout: 10_000 });
  check((await page.locator(".cx p.muted").innerText()).includes("…"), "the long original arguments are cut with an ellipsis");
  await noHorizontalOverflow(page, "report with long text");
  await page.unroute("**/api/attack");
  // A report too large for a link (incompressible code) is downloaded as JSON instead, and the note says so.
  const big = longTextReport();
  big.solution.code = Array.from({ length: 4000 }, (_, i) => ((i * 2654435761) >>> 0).toString(36)).join(" ");
  // The stream's report carries the oracle's code and may carry the trace; neither may reach the download.
  big.oracle = { code: "def oracle(a, t):\n    return 0\n", attempts: 1 };
  big.trace = [];
  await page.route("**/api/attack", respond([{ type: "mode", mode: "replay", executor: "Local" }, { type: "report", report: big }].map((l) => JSON.stringify(l)).join("\n") + "\n"));
  await attackButton(page).click();
  await page.locator("h2.verdict").waitFor({ timeout: 10_000 });
  const download = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("button", { name: "Share link" }).click();
  const file = await download;
  check(file.suggestedFilename().startsWith("report-"), "a report too large for a link is downloaded");
  const saved = JSON.parse(readFileSync(await file.path(), "utf8"));
  check(saved.verdict === "counterexample" && !("oracle" in saved) && !("trace" in saved), "the download holds what a link would carry (no oracle code, no trace)");
  await page.locator("p.live", { hasText: "downloaded as JSON instead" }).waitFor({ timeout: 15_000 });
  await page.unroute("**/api/attack");
  // An error line ends the stream (it is terminal, like a report), so a long error is checked in its own run.
  await page.route("**/api/attack", respond([{ type: "mode", mode: "replay", executor: "Local" }, { type: "error", error: `Failed to reach ${LONG_URL}` }].map((l) => JSON.stringify(l)).join("\n") + "\n"));
  await attackButton(page).click();
  await page.locator("p.err", { hasText: "Failed to reach" }).waitFor();
  await noHorizontalOverflow(page, "error with long text");
  await page.unroute("**/api/attack");
  ok(step);

  step = "bad share links and a failed status check say so";
  {
    const p = await ctx.newPage();
    await p.goto(base);
    await attackButton(p).waitFor({ timeout: 15_000 });
    // A damaged link, then a link of a format this page does not read, pasted into the tab while scrolled down.
    for (const [hash, says] of [["#r=1.not-a-report", "Could not open the shared report"], ["#r=2.abc", "a format this page does not read"]]) {
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await p.evaluate((h) => (window.location.hash = h), hash);
      const alert = p.locator("p.share-err[role=alert]");
      await alert.waitFor({ timeout: 15_000 });
      check((await alert.innerText()).includes(says), `the alert for ${hash} says "${says}" (got "${await alert.innerText()}")`);
      const top = await alert.evaluate((el) => el.getBoundingClientRect().top);
      check(top >= -1 && top < 200, `the alert for ${hash} is scrolled into view (its top is at ${Math.round(top)} px)`);
    }
    // A second bad link that fails the same way, pasted without a reload: shown again, in view. (A spacer makes the page
    // tall enough that the alert is out of view unless it is scrolled to.)
    await p.evaluate(() => document.body.appendChild(Object.assign(document.createElement("div"), { style: "height: 5000px" })));
    // Two links that fail with the same message, one after the other: the second must still be shown.
    await p.evaluate(() => (window.location.hash = "#r=1.not-a-report"));
    await p.locator("p.share-err", { hasText: "does not decompress" }).waitFor({ timeout: 15_000 });
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // Count alert nodes inserted from here: the repeat must be a new node, or a screen reader hears nothing.
    await p.evaluate(() => {
      window.__alerts = 0;
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && n.getAttribute("role") === "alert" && window.__alerts++))).observe(document.body, { childList: true, subtree: true });
    });
    await p.evaluate(() => (window.location.hash = "#r=1.also-broken"));
    await p.waitForFunction(() => (document.querySelector("p.share-err")?.getBoundingClientRect().top ?? -1e9) > -2, null, { timeout: 15_000 }).catch(() => check(false, "a repeated bad link's alert is scrolled into view"));
    check((await p.evaluate(() => window.__alerts)) >= 1, "a repeated bad link inserts a new alert, so it is announced again");
    // Picking a problem drops any report link from the address bar, also one of another format.
    await p.evaluate(() => (window.location.hash = "#r=2.abc"));
    await p.locator("p.share-err", { hasText: "a format this page does not read" }).waitFor({ timeout: 15_000 });
    await p.getByRole("button", { name: "Binary search", exact: true }).click();
    eq(await p.evaluate(() => window.location.hash), "", "the address bar after picking a problem with a #r=2 link open");
    await p.goto(`${base}/`);
    await attackButton(p).waitFor({ timeout: 15_000 });
    // The status region is a polite live region.
    eq(await p.locator("p.sr-only[role=status]").getAttribute("aria-live"), "polite", "the status region's aria-live");
    // The status check fails: the badge says so instead of claiming a mode.
    await p.route("**/api/problems", (route) => route.fulfill({ status: 500, body: "down" }));
    await p.reload();
    await p.getByText("Server mode unknown (status check failed)").waitFor({ timeout: 15_000 });
    eq(await p.getByText("Live: Nebius Token Factory").count(), 0, "live badges after a failed status check");
    check((await p.locator("#research-hint").innerText()).startsWith("On a live server with a Tavily key,"), "the research explanation claims no search after a failed status check");
    await p.close();
  }
  ok(step);

  step = "accessibility: axe finds nothing at 390 and 1280 px, light and dark";
  /** Contrast of an element's border against the background of the card it sits on. */
  const borderRatio = (loc) =>
    loc.evaluate((el) => {
      const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = (c) => rgb(c).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const style = getComputedStyle(el);
      // A border that is not drawn has no contrast, whatever its colour.
      if (parseFloat(style.borderTopWidth) < 1 || style.borderTopStyle === "none" || style.borderTopStyle === "hidden") return 0;
      const a = lum(style.borderTopColor);
      const b = lum(getComputedStyle(el.closest(".card")).backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  /** axe-core's violations on the page as it stands, as "rule (impact): selectors" lines. */
  const axeViolations = async (p) => {
    await p.evaluate(AXE_SOURCE);
    const found = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`));
    return found.join("; ");
  };
  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"]) {
      const where = `${width} px, ${colorScheme}`;
      const a11y = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme, permissions: ["clipboard-read", "clipboard-write"] });
      const p = await a11y.newPage();
      p.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
      await p.goto(base);
      await attackButton(p).waitFor({ timeout: 15_000 });
      eq(await axeViolations(p), "", `axe violations on the form (${where})`);
      await attackButton(p).click();
      await p.locator("h2.verdict").waitFor({ timeout: 90_000 });
      eq(await axeViolations(p), "", `axe violations on the report (${where})`);
      // The full-fix view is its own state (a focusable region); axe it and check its tab stop and name.
      await p.getByRole("button", { name: "Show full fix" }).click();
      const fixPre = p.locator("pre.code-out").first();
      eq(await fixPre.evaluate((el) => [el.tabIndex, el.getAttribute("role"), el.getAttribute("aria-label")].join("|")), "0|region|Proposed fix", `the full-fix view is a named tab stop (${where})`);
      eq(await axeViolations(p), "", `axe violations with the full fix shown (${where})`);
      await p.getByRole("button", { name: "Show changes only" }).click();
      await p.getByRole("button", { name: "Share link" }).click();
      await p.locator("input.share-link").waitFor({ timeout: 15_000 });
      const linkRatio = await borderRatio(p.locator("input.share-link"));
      check(linkRatio >= 3, `the share link's border is ${linkRatio.toFixed(2)}:1 on the card (${where})`);
      eq(await axeViolations(p), "", `axe violations with the share link shown (${where})`);
      await p.goto(link);
      await p.locator(".shared h2.verdict").waitFor({ timeout: 15_000 });
      eq(await axeViolations(p), "", `axe violations on a shared report (${where})`);
      // A report without a counterexample: its own verdict heading, no time to a counterexample, sections as headings.
      await p.route("**/api/attack", respond([{ type: "mode", mode: "replay", executor: "Local" }, { type: "report", report: compileErrorReport() }].map((l) => JSON.stringify(l)).join("\n") + "\n"));
      await p.goto(base);
      await attackButton(p).click();
      await p.locator("h2.verdict", { hasText: "Solution does not compile" }).waitFor({ timeout: 15_000 });
      eq(await p.locator(".stats div", { hasText: "to first counterexample" }).locator("b").innerText(), "–", "a compile-error report's time to first counterexample");
      eq((await p.getByRole("heading", { level: 3 }).allInnerTexts()).map((t) => t.toLowerCase()).join("|"), "attack families|why ultra here, super there", "a compile-error report's section headings");
      eq(await axeViolations(p), "", `axe violations on a compile-error report (${where})`);
      await p.unroute("**/api/attack");
      // An unknown address gets the app's own 404 page: a status, a title that says so, and a main landmark.
      const missing = await p.goto(`${base}/nope`);
      eq(missing.status(), 404, "an unknown address's status");
      check((await p.title()).startsWith("404"), "the 404 page's title says 404");
      eq(await axeViolations(p), "", `axe violations on the 404 page (${where})`);
      await p.getByRole("link", { name: "Go to Counterexample" }).click();
      await attackButton(p).waitFor({ timeout: 15_000 });
      eq(new URL(p.url()).pathname, "/", `the 404 page's link leads home (${where})`);
      // "Your own" (the statement box and the replay warning) and its error alert.
      await p.getByRole("button", { name: "Your own", exact: true }).click();
      await p.locator("textarea.statement-in").waitFor();
      eq(await axeViolations(p), "", `axe violations on "Your own" (${where})`);
      // Text-field borders (WCAG 1.4.11): at least 3:1 against the card they sit on. axe does not check non-text contrast.
      for (const sel of ["textarea.code", "textarea.statement-in", "select"]) {
        const ratio = await borderRatio(p.locator(sel).first());
        check(ratio >= 3, `${sel}'s border is ${ratio.toFixed(2)}:1 on the card (${where})`);
      }
      await a11y.close();
    }
  }
  // What axe does not check: the chips say which problem is picked, and the trace scroller can be reached and named.
  await page.goto(base);
  await attackButton(page).waitFor({ timeout: 15_000 });
  const chips = await page.locator("button.chip").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-pressed")));
  eq(chips.filter((x) => x === "true").length, 1, "chips marked as pressed");
  eq(chips.filter((x) => x === "false").length, chips.length - 1, "chips marked as not pressed");
  // The picked chip looks picked, and "Your own" says it is pressed once picked.
  const [onBg, offBg] = await page.evaluate(() => [getComputedStyle(document.querySelector("button.chip.on")).backgroundColor, getComputedStyle(document.querySelector("button.chip:not(.on)")).backgroundColor]);
  check(onBg !== offBg, `the picked chip is filled differently from the others (${onBg} against ${offBg})`);
  await page.getByRole("button", { name: "Your own", exact: true }).click();
  eq(await page.getByRole("button", { name: "Your own", exact: true }).getAttribute("aria-pressed"), "true", '"Your own" pressed once picked');
  await page.locator("button.chip").first().click();
  await attackButton(page).click();
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  const scroller = await page.locator(".trace-scroll").evaluate((el) => [el.tabIndex, el.getAttribute("role"), el.getAttribute("aria-label")].join("|"));
  eq(scroller, "0|region|Live trace events", "the trace scroller's tab stop, role and name");
  // Keyboard focus on each scroll region is visible (WCAG 2.4.7); axe does not check focus styles.
  for (const sel of [".trace-scroll", ".scroll", "pre.code-out"]) {
    const el = page.locator(sel).first();
    // A key press first: Chromium shows :focus-visible for script focus only after keyboard use, as a Tab user would have.
    await page.keyboard.press("Shift");
    await el.focus();
    const outline = await el.evaluate((n) => [getComputedStyle(n).outlineStyle, parseFloat(getComputedStyle(n).outlineWidth)]);
    check(outline[0] !== "none" && outline[1] >= 1, `${sel} shows a focus outline (${outline.join(" ")})`);
  }
  ok(step);

  step = "no page errors";
  eq(pageErrors.join("\n"), "", "page errors and console errors");
  ok(step);
}

let failed = false;
try {
  await main();
  console.log("e2e smoke: all checks passed");
} catch (e) {
  failed = true;
  console.error(`FAIL  ${e instanceof Error ? e.message : String(e)}`);
  if (pageErrors.length) console.error(`page errors so far:\n${pageErrors.join("\n")}`);
  if (serverLog.trim()) console.error(`next start output (tail):\n${serverLog}`);
} finally {
  await cleanup();
}
process.exit(failed ? 1 : 0);
