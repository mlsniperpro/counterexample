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
import { existsSync, readdirSync, statSync } from "node:fs";
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
  await noHorizontalOverflow(shared, "shared report at 390 px");
  ok(step);

  step = "a second share link starts a fresh report view";
  await shared.locator(".shared").getByRole("button", { name: "Copy report" }).click();
  await shared.locator(".shared .result .live", { hasText: "Copied to the clipboard" }).waitFor();
  await shared.locator(".shared").getByRole("button", { name: "Show full fix" }).click();
  await shared.locator(".shared").getByRole("button", { name: "Show changes only" }).waitFor();
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
  await cancelButton.waitFor({ timeout: 5_000 });
  await page.locator("textarea.code").click();
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  pace.lineDelayMs = 0;
  eq(await page.evaluate(() => document.activeElement?.tagName), "TEXTAREA", "focus in the code editor after the run ended");
  // A run started and ended from the keyboard still returns focus to the Attack button.
  await attackButton(page).focus();
  await page.keyboard.press("Enter");
  await cancelButton.waitFor({ timeout: 5_000 });
  await page.locator("h2.verdict").waitFor({ timeout: 90_000 });
  await attackButton(page).waitFor();
  eq(await focused(page), "BUTTON:Attack this solution", "focus after a keyboard run ended");
  ok(step);

  step = "cancel a run mid-stream";
  await page.getByRole("button", { name: "Binary search", exact: true }).click();
  pace.lineDelayMs = 300;
  const before = attacks.length;
  await attackButton(page).click();
  await page.locator(".trace li.ev").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".note", { hasText: "Attack cancelled; the partial trace is shown." }).waitFor({ timeout: 5_000 });
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
  pace.lineDelayMs = 0;
  ok(step);

  step = "a bad response shows a readable error and the page survives";
  const respond = (body, status = 200) => (route) => route.fulfill({ status, contentType: "application/x-ndjson", body });
  const expectAlert = async (text) => {
    await attackButton(page).click();
    await page.locator("p.err[role=alert]", { hasText: text }).waitFor({ timeout: 5_000 });
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
  // An error line ends the stream (it is terminal, like a report), so a long error is checked in its own run.
  await page.route("**/api/attack", respond([{ type: "mode", mode: "replay", executor: "Local" }, { type: "error", error: `Failed to reach ${LONG_URL}` }].map((l) => JSON.stringify(l)).join("\n") + "\n"));
  await attackButton(page).click();
  await page.locator("p.err", { hasText: "Failed to reach" }).waitFor();
  await noHorizontalOverflow(page, "error with long text");
  await page.unroute("**/api/attack");
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
