/**
 * Live-path preflight: `pnpm preflight` (reads .env.local via your shell or
 * `node --env-file`). Exits 1 if any check fails; skipped checks name the
 * missing credential.
 */
import { formatChecks, preflight } from "../src/lib/preflight";

preflight().then(
  (checks) => {
    console.log(formatChecks(checks));
    const failed = checks.filter((c) => c.status === "fail").length;
    const skipped = checks.filter((c) => c.status === "skip").length;
    console.log(`\n${checks.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
    if (failed) process.exit(1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
