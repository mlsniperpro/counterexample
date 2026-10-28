/**
 * Captures the 390 px evidence screenshots (and a 1200 x 800 thumbnail) in docs/screenshots against a
 * running dev server (replay mode is fine): the form with "Research the web"
 * ticked, the report after an attack, and that report reopened from its share
 * link in a fresh page. Needs Playwright with Chromium installed.
 *
 *   pnpm dev --port 3125 &
 *   BASE_URL=http://localhost:3125 pnpm screenshots
 */
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = new URL("../docs/screenshots/", import.meta.url).pathname;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
// Hide Next's dev-only overlay (build indicator) so screenshots show only the app.
const hideDevOverlay = () =>
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.head.append(style);
  });
await ctx.addInitScript(hideDevOverlay);
const errors = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base);
await page.waitForSelector(".badge");
await page.check("text=Research the web (Tavily)");
await page.screenshot({ path: `${out}390-1-form.png`, fullPage: true });
const [request] = await Promise.all([page.waitForRequest("**/api/attack"), page.click("text=Attack this solution")]);
await page.waitForSelector(".verdict", { timeout: 60_000 });
await page.click("text=Share link");
const link = await page.inputValue(".share-link");
await page.screenshot({ path: `${out}390-2-report.png`, fullPage: true });
const shared = await ctx.newPage();
shared.on("pageerror", (e) => errors.push(e.message));
await shared.goto(link);
await shared.waitForSelector(".shared .verdict");
await shared.screenshot({ path: `${out}390-3-shared-link.png`, fullPage: true });
// A 3:2 desktop view for the Devpost thumbnail and gallery: the verdict, the minimal counterexample and the live trace side by side.
const desk = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await desk.addInitScript(hideDevOverlay);
const deskPage = await desk.newPage();
deskPage.on("pageerror", (e) => errors.push(e.message));
await deskPage.goto(base);
await deskPage.waitForSelector(".badge");
await deskPage.click("text=Attack this solution");
await deskPage.waitForSelector(".verdict", { timeout: 60_000 });
await deskPage.evaluate(() => document.querySelector(".verdict")?.scrollIntoView({ block: "start" }));
await deskPage.evaluate(() => window.scrollBy(0, -24));
await deskPage.screenshot({ path: `${out}devpost-thumbnail-1200x800.png` });
const overflow = await Promise.all([page, shared, deskPage].map((p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
console.log({ research: JSON.parse(request.postData() ?? "{}").research, linkLength: link.length, horizontalOverflow: overflow, errors });
await browser.close();
if (errors.length || overflow.some(Boolean)) process.exit(1);
