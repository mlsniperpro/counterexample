import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Load `.env.local`, then `.env`, from `dir` into process.env, as Next.js does for the app, so `pnpm preflight` and
 * `pnpm bench --live` see the keys the README asks for. A variable already set (in the shell, or by the first file) wins.
 * Returns the files that were loaded.
 */
export function loadEnvFiles(dir: string): string[] {
  const files = [".env.local", ".env"].map((f) => join(dir, f)).filter((f) => existsSync(f));
  for (const f of files) process.loadEnvFile(f);
  return files;
}

loadEnvFiles(process.cwd());
